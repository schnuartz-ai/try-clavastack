// Disposable browser context: verify the reported Continue failure on HTTPS.
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';

const base = process.env.TEST_BASE_URL || 'https://try.clavastack.com';
const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true,
  args: base.startsWith('https://127.0.0.1:') ? ['--ignore-certificate-errors'] : [] });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(`${base}/specter-desktop/`);
  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  await page.frameLocator('#desktop-app').getByRole('link', { name: 'Add device', exact: true }).waitFor({ timeout: 60000 });
  const app = page.frames().find(frame => frame.url().includes('/specter-desktop/spc/'));
  await app.getByRole('link', { name: 'Add device', exact: true }).click();
  await app.getByRole('link', { name: 'Specter-DIY', exact: true }).click();
  await app.waitForLoadState('domcontentloaded');
  const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'ClavaStack public browser audit'));
  const keys = ['49h/0h/0h', '84h/0h/0h', '48h/0h/0h/1h', '48h/0h/0h/2h']
    .map(path => `[${root.fingerprint.toString('hex')}/${path}]${root.derivePath(`m/${path.replaceAll('h', "'")}`).neutered().toBase58()}`);
  await app.locator('#device_name').fill('CSRF Public Audit');
  await app.locator('#file').setInputFiles({ name: 'public-test-xpubs.txt', mimeType: 'text/plain', buffer: Buffer.from(keys.join('\n')) });
  await app.waitForFunction(() => Array.from(document.querySelectorAll('input[id$="-xpub-hidden"]'))
    .filter(input => input.value.startsWith('[2ee2ab10/')).length === 4);
  await app.getByRole('button', { name: 'Continue', exact: true }).click();
  await app.waitForURL(/\/devices\/device\/csrf_public_audit\//, { timeout: 60000 });
  await app.getByText('Device Added', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/specter-live-csrf.png', fullPage: true });
  await writeFile('test-results/specter-live-csrf.json', JSON.stringify({ base, device: 'CSRF Public Audit',
    keys: 4, continueSaved: true, errors }, null, 2));
  console.log(`PASS ${base}: four public keys, HTTPS Continue and saved device`);
} catch (error) {
  console.error(JSON.stringify({ errors, desktop: await page.locator('#desktop-status').innerText(),
    body: await page.frameLocator('#desktop-app').locator('body').innerText().catch(() => ''),
    keys: await page.frameLocator('#desktop-app').locator('input[id$="-xpub-hidden"]').evaluateAll(inputs => inputs.map(input => input.value)).catch(() => []) }));
  await page.screenshot({ path: 'test-results/specter-live-csrf-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
