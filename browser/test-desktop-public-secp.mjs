// Exercise the production Python/JS point bridge against independent BIP32
// vectors and the original embit Python implementation in the same WASM VM.
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
const vectors = [];
for (const account of ["m/49'/0'/0'", "m/84'/0'/0'", "m/48'/0'/0'/1'", "m/48'/0'/0'/2'"]) {
  const key = root.derivePath(account).neutered();
  for (const path of ['0/0', '0/1', '0/20', '0/299', '1/0', '1/1', '1/299', '2147483647']) {
    vectors.push({ xpub: key.toBase58(), path, expected: key.derivePath(path).toBase58() });
  }
}
const workerSource = await readFile('specter-desktop/runtime-worker.js', 'utf8');
const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true,
  args: base.startsWith('https://127.0.0.1:') ? ['--ignore-certificate-errors'] : [] });
const context = await browser.newContext();
await context.route('**/specter-desktop/runtime-worker.js?*', route => route.fulfill({
  contentType: 'text/javascript', headers: { 'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin' }, body: `${workerSource}
self.addEventListener('message', event => {
  if (event.data.type !== 'public-secp-audit') return;
  requestQueue = requestQueue.then(() => {
    try {
      pyodide.globals.set('__audit_vectors', JSON.stringify(event.data.vectors));
      const result = pyodide.runPython(${JSON.stringify(`
import json
from embit import bip32
from embit.util import secp256k1 as fast, py_secp256k1 as original
_vectors = json.loads(__audit_vectors)
for _v in _vectors:
    assert bip32.HDKey.from_string(_v['xpub']).derive(_v['path']).to_base58() == _v['expected'], _v
_generator = bytes.fromhex('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')
_pub = fast.ec_pubkey_parse(_generator)
assert _pub == original.ec_pubkey_parse(_generator)
for _flag in (fast.EC_COMPRESSED, fast.EC_UNCOMPRESSED):
    assert fast.ec_pubkey_serialize(_pub, _flag) == original.ec_pubkey_serialize(_pub, _flag)
for _scalar in (0, 1, 2, 300, 65537):
    _tweak = _scalar.to_bytes(32, 'big')
    assert fast.ec_pubkey_add(_pub, _tweak) == original.ec_pubkey_add(_pub, _tweak)
    _mutable = bytearray(_pub)
    fast.ec_pubkey_tweak_add(_mutable, _tweak)
    assert _mutable == fast.ec_pubkey_add(_pub, _tweak)
_order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
assert fast.ec_pubkey_add(_pub, (_order - 1).to_bytes(32, 'big')) is None
for _operation in (
    lambda: fast.ec_pubkey_parse(b'\\x02' + b'\\xff' * 32),
    lambda: fast.ec_pubkey_parse(b'\\x04' + b'\\x00' * 64),
    lambda: fast.ec_pubkey_parse(b'\\x02'),
    lambda: fast.ec_pubkey_add(_pub, _order.to_bytes(32, 'big')),
    lambda: fast.ec_pubkey_add(_pub, b'\\x01'),
    lambda: fast.ec_pubkey_tweak_add(bytearray(_pub), (_order - 1).to_bytes(32, 'big')),
):
    try:
        _operation()
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid point/tweak accepted')
# Signing/private operations remain the upstream functions.
assert fast.ecdsa_sign is original.ecdsa_sign
assert fast.ec_pubkey_create is original.ec_pubkey_create
from cryptoadvance.specter.wallet.txlist import WalletAwareTxItem
_cached = dict.__new__(WalletAwareTxItem)
dict.update(_cached, category='selftransfer', flow_amount=0.0, utxo_amount=0.0, ismine=False)
assert _cached.category == 'selftransfer'
assert _cached.flow_amount == 0.0
assert _cached.utxo_amount == 0.0
assert _cached.ismine is False
json.dumps({'publicDerivations': len(_vectors), 'pointAndTweakChecks': True})
`)});
      self.postMessage({type: 'public-secp-result', result: JSON.parse(result)});
    } catch(error) { self.postMessage({type: 'public-secp-result', error: String(error)}); }
  });
});` }));
await context.addInitScript(() => {
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      if (String(url).includes('/specter-desktop/runtime-worker.js')) window.__auditWorker = this;
    }
  };
});
try {
  const page = await context.newPage();
  await page.goto(`${base}/specter-desktop/`);
  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  const result = await page.evaluate(vectors => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Public derivation test timed out')), 120000);
    window.__auditWorker.addEventListener('message', function receive(event) {
      if (event.data.type !== 'public-secp-result') return;
      clearTimeout(timeout);
      window.__auditWorker.removeEventListener('message', receive);
      resolve(event.data);
    });
    window.__auditWorker.postMessage({ type: 'public-secp-audit', vectors });
  }), vectors);
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.result.publicDerivations, 32);
  console.log('PASS 32 public BIP32 derivations, original Python point operations, invalid points/tweaks, infinity and cached zero/False transaction properties');
} finally { await browser.close(); }
