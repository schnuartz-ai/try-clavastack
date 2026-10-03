// Read-only audit of a public BIP39 test wallet with existing mainnet history.
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true,
  args: base.startsWith('https://127.0.0.1:') ? ['--ignore-certificate-errors'] : [] });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' || message.text().startsWith('AUDIT ')) console.log(message.text()); });
if (process.env.PROFILE_DESKTOP) {
  const source = await readFile('specter-desktop/runtime-worker.js', 'utf8');
  await page.route('**/specter-desktop/runtime-worker.js?*', route => route.fulfill({
    contentType: 'text/javascript', headers: { 'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin' }, body: `${source}
const auditDispatch = dispatchRequest;
dispatchRequest = async request => {
  const start = performance.now();
  pyodide.runPython(${JSON.stringify(`
if '_audit_installed' not in globals():
    import time, functools
    from cryptoadvance.spectrum.spectrum import Spectrum
    from cryptoadvance.specter.wallet.tx_fetcher import TxFetcher
    from cryptoadvance.specter.wallet.txlist import TxList
    def _audit_wrap(original):
        @functools.wraps(original)
        def timed(*args, **kwargs):
            started = time.monotonic()
            try:
                return original(*args, **kwargs)
            finally:
                seconds = time.monotonic() - started
                if seconds > 0.5:
                    print('AUDIT %s %.1fs' % (original.__qualname__, seconds))
        return timed
    for cls, methods in ((Spectrum, ('importdescriptor', '_subcribe_scripts', 'sync_script')),
                         (TxFetcher, ('_fetch_transactions', 'interesting_txs', 'transform_to_dict_with_txid_as_key', 'extract_addresses')),
                         (TxList, ('add', 'get_transactions'))):
        for name in methods:
            setattr(cls, name, _audit_wrap(getattr(cls, name)))
    _audit_installed = True
`)});
  try { return await auditDispatch(request); }
  finally {
    if (performance.now() - start > 2000) {
      console.log('AUDIT ' + request.path + ' ' + ((performance.now()-start)/1000).toFixed(1) + 's');
    }
  }
};` }));
}
await mkdir('test-results', { recursive: true });
let started;
try {
  await page.goto(`${base}/specter-desktop/`);
  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  await page.frameLocator('#desktop-app').getByRole('link', { name: 'Connect to the Bitcoin network', exact: true }).waitFor({ timeout: 60000 });
  const app = page.frames().find(frame => frame.url().includes('/specter-desktop/spc/'));
  await app.getByRole('link', { name: 'Connect to the Bitcoin network', exact: true }).click();
  await app.locator('#server-list').selectOption('electrum.blockstream.info');
  await app.getByRole('button', { name: 'Connect', exact: true }).click();
  await app.locator('tr').filter({ hasText: 'Network' }).getByText('main', { exact: true }).waitFor({ state: 'attached', timeout: 90000 });
  console.log('PASS actual Blockstream TLS connection');
  const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
  assert.equal(root.fingerprint.toString('hex'), '73c5da0a');
  const keys = ["49h/0h/0h", "84h/0h/0h", "48h/0h/0h/1h", "48h/0h/0h/2h"]
    .map(path => `[73c5da0a/${path}]${root.derivePath(`m/${path.replaceAll('h', "'")}`).neutered().toBase58()}`);
  await app.goto(`${base}/specter-desktop/app/spc/devices/new_device_keys/specter/`);
  await app.locator('#device_name').fill('Public History Device');
  await app.locator('#file').setInputFiles({ name: 'public-test-xpubs.txt', mimeType: 'text/plain', buffer: Buffer.from(keys.join('\n')) });
  await app.waitForFunction(() => Array.from(document.querySelectorAll('input[id$="-xpub-hidden"]'))
    .filter(input => input.value.startsWith('[73c5da0a/')).length === 4);
  await app.getByRole('button', { name: 'Continue', exact: true }).click();
  await app.getByRole('button', { name: 'Create single key wallet', exact: true }).click();
  await app.locator('#wallet_name').fill('Public History Audit');
  started = Date.now();
  await app.getByRole('button', { name: 'Create wallet', exact: true }).click();
  await app.waitForURL(/\/wallet\/public_history_audit\//, { timeout: 300000 });
  console.log(`PASS wallet created in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await app.getByRole('button', { name: 'Skip', exact: true }).click();
  await app.getByRole('link', { name: 'Transactions', exact: true }).click();
  await app.locator('[id="column-txid"]').first().waitFor({ timeout: 300000 });
  const count = await app.locator('[id="column-txid"]').count();
  assert(count > 0);
  const seconds = (Date.now() - started) / 1000;
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/specter-public-history.png', fullPage: true });
  await writeFile('test-results/specter-public-history.json', JSON.stringify({ base, visibleTransactions: count,
    synchronisationSeconds: seconds, errors, broadcast: false }, null, 2));
  console.log(`PASS ${count} actual visible historical transactions; wallet sync and history ${seconds.toFixed(1)}s`);
} catch (error) {
  console.error(await page.frameLocator('#desktop-app').locator('body').innerText().catch(() => 'No Desktop frame'));
  await page.screenshot({ path: 'test-results/specter-public-history-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
