import { strict as assert } from 'node:assert';
import { writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { script } from 'bitcoinjs-lib';
import * as secp from 'tiny-secp256k1';

const root = new URL('../', import.meta.url);
const work = new URL('../.browser-work/', import.meta.url);
await mkdir(work, { recursive: true });
await writeFile(new URL('bdk-probe.html', work), `<!doctype html><meta charset="utf-8"><title>Bull BDK acceptance</title>
<script type="module">
import init, { bdk_call } from '/.browser-work/bdk-web-pkg/bdkffi.js';
import { createDemoFiles } from '/browser/demo-data.js';
await init();
globalThis.bullBdkCall = (name, args) => bdk_call(name, args);
const demo = createDemoFiles('testnet');
globalThis.bullProbeInput = JSON.stringify({ mnemonic: demo.roots.ghost.mnemonic,
  psbt: new TextDecoder().decode(demo.files.find(f => f.name === 'testnet-ghost-payment-low-fee.psbt').bytes) });
globalThis.bullProbeDone = value => { globalThis.bullProbeResult = JSON.parse(value); };
const entry = document.createElement('script'); entry.src = '/.browser-work/bdk-probe.js'; document.body.append(entry);
</script>`);
const server = spawn('python', ['browser/test-isolated-server.py', '--port', '8777'],
  { cwd: root, stdio: 'ignore', windowsHide: true });
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch('http://127.0.0.1:8777/.browser-work/bdk-probe.html')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8777/.browser-work/bdk-probe.html');
  await page.waitForFunction(() => globalThis.bullProbeResult, { timeout: 30000 });
  const result = await page.evaluate(() => globalThis.bullProbeResult);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.address, /^tb1q/);
  assert.match(result.descriptor, /\[8c24a510\/84[h']/);
  assert.equal(result.balance, 0);
  assert.equal(result.finalized, true);
  const { Psbt } = await import('bitcoinjs-lib');
  const signed = Psbt.fromBase64(result.signed);
  const transaction = signed.extractTransaction();
  assert.equal(transaction.getId(), result.txid);
  const [encodedSignature, pubkey] = transaction.ins[0].witness;
  const decoded = script.signature.decode(encodedSignature);
  const scriptCode = script.compile([118, 169, Buffer.from(signed.data.inputs[0].witnessUtxo.script.subarray(2)), 136, 172]);
  const digest = transaction.hashForWitnessV0(0, scriptCode, signed.data.inputs[0].witnessUtxo.value, decoded.hashType);
  assert.equal(secp.verify(digest, pubkey, decoded.signature), true);
  assert.deepEqual(errors, []);
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../test-results/bull-bdk-acceptance.json', import.meta.url),
    JSON.stringify({ address: result.address, descriptor: result.descriptor,
      txid: result.txid, finalized: true, signatureVerified: true, errors }, null, 2));
  console.log('PASS original BDK Dart ABI checksums, Ghost address, real PSBT signing and independent ECDSA verification');
} finally {
  await browser?.close();
  server.kill();
}
