import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createDemoFiles } from './demo-data.js';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';
import { networks, payments } from 'bitcoinjs-lib';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors = [];
const calls = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url().endsWith('/api/ab/electrum')) calls.push(JSON.parse(request.postData()));
});
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const readMedia = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('clavastack-specter-removable-media-v1');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const files = await new Promise(resolve => {
    const request = db.transaction('files').objectStore('files').getAll(); request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return Object.fromEntries(files.map(file => [file.path, Array.from(new Uint8Array(file.bytes))]));
});
const importDemo = async network => {
  await page.locator('#demo-network').selectOption(network);
  await page.locator('#demo-network:not(:disabled)').waitFor({ timeout: 30000 });
  assert(!/error/i.test(await page.locator('#media-status').innerText()));
};
const insert = async (token, target) => {
  await page.locator(token).click();
  await page.locator(`.device-hitbox[data-media-target="${target}"]`).click();
  await page.locator(`${token}:not(:disabled)`).waitFor();
};
try {
  await page.goto(`${base}/specter-desktop/`);
  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  await page.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
  const app = page.frameLocator('#desktop-app');
  await app.getByRole('link', { name: 'Connect to the Bitcoin network', exact: true }).click();
  assert.equal(await app.locator('#server-list').inputValue(), 'Blockstream Bitcoin Testnet');
  const info = app.locator('tr').filter({ hasText: 'Network' });
  assert.equal((await info.locator('td').last().innerText()).trim(), 'test');
  assert(calls.some(call => call.host === 'electrum.blockstream.info' && call.port === 60002));
  assert(!calls.some(call => call.port === 50002), 'Fresh startup contacted Mainnet');
  pass('Fresh Desktop boots the real Spectrum node on Bitcoin Testnet');
  const native = await (await page.locator('#desktop-app').elementHandle()).contentFrame();
  const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'ClavaStack public Testnet audit'), networks.testnet);
  const fingerprint = root.fingerprint.toString('hex');
  await native.goto(`${base}/specter-desktop/app/spc/devices/new_device_keys/specter/`);
  await native.locator('#device_name').fill('Testnet Public Audit');
  const keys = ['49h/1h/0h', '84h/1h/0h', '48h/1h/0h/1h', '48h/1h/0h/2h']
    .map(path => `[${fingerprint}/${path}]${root.derivePath(`m/${path.replaceAll('h', "'")}`).neutered().toBase58()}`);
  await native.locator('#file').setInputFiles({ name: 'public-testnet-xpubs.txt', mimeType: 'text/plain', buffer: Buffer.from(keys.join('\n')) });
  await native.waitForFunction(fp => [...document.querySelectorAll('input[id$="-xpub-hidden"]')].filter(input => input.value.startsWith(`[${fp}/`)).length === 4, fingerprint);
  await native.getByRole('button', { name: 'Continue', exact: true }).click();
  await native.waitForURL(/\/devices\/device\/testnet_public_audit\//);
  await native.locator('#new_device_popup').getByText('Close', { exact: true }).click();
  await native.getByRole('link', { name: 'Add wallet', exact: true }).click();
  await native.getByRole('link', { name: 'Single Signature', exact: true }).click();
  await native.locator('#testnet_public_audit').click();
  await native.locator('#wallet_name').fill('Testnet Default Audit');
  await native.getByRole('button', { name: 'Create wallet', exact: true }).click();
  await native.waitForURL(/\/wallet\/testnet_default_audit\//, { timeout: 240000 });
  await native.getByText('Skip', { exact: true }).click();
  await native.getByRole('link', { name: 'Receive', exact: true }).click();
  const expected = payments.p2wpkh({ pubkey: root.derivePath("m/84'/1'/0'/0/0").publicKey, network: networks.testnet }).address;
  assert.equal(await native.locator('#address_qr').getAttribute('value'), `bitcoin:${expected}`);
  assert(expected.startsWith('tb1'));
  pass('Default Testnet wallet derives the independently verified BIP84 tb1 address');

  assert.equal(await page.locator('.media-grid > .media-group').count(), 3);
  assert.equal(await page.locator('#demo-network').inputValue(), '');
  for (const token of await page.locator('.memory-token').all()) assert((await token.innerText()).includes('Not inserted'));
  await page.locator('#sd-picker').setInputFiles({ name: 'keep.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255, 42]) });
  await page.locator('#sd-files').getByText('keep.bin', { exact: false }).waitFor();
  for (const mode of ['drop', 'paste']) {
    await page.evaluate(mode => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([0, 128, 255])], `${mode}.bin`));
      const event = mode === 'drop' ? new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
        : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector('#sd-drop').dispatchEvent(event);
    }, mode);
    await page.locator('#sd-files').getByText(`${mode}.bin`, { exact: false }).waitFor();
  }
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#sd-files li').filter({ hasText: 'keep.bin' }).getByRole('button', { name: 'Download' }).click();
  const downloaded = await downloadPromise;
  assert.deepEqual([...await readFile(await downloaded.path())], [0, 255, 42]);
  pass('Binary file picker, native drop/paste events and actual SD download preserve exact bytes');
  await importDemo('testnet');
  const demo = createDemoFiles('testnet');
  let files = await readMedia();
  for (const file of demo.files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  for (const card of demo.cards) {
    assert.deepEqual(files[`cards/${card.slot}/secret.bin`], [...card.secret]);
    assert.deepEqual(files[`cards/${card.slot}/pin.bin`], [...card.pinDigest]);
    assert(files[`cards/${card.slot}/private.key`]?.length, 'Firmware did not create a real card identity');
  }
  assert.equal(await page.locator('.card-details').count(), 2);
  assert((await page.locator('#sd-location').innerText()).includes('Specter DIY'));
  pass('Identical SD bytes and genuine Ghost/Zoo MemoryCard payloads, cards stay ejected');
  const identities = [files['cards/1/private.key'], files['cards/2/private.key']];

  await insert('.memory-token[data-slot="1"]', 'diy');
  assert((await page.locator('.memory-token[data-slot="1"]').innerText()).includes('Inserted in Specter DIY'));
  await importDemo('mainnet');
  files = await readMedia();
  assert.deepEqual(files['cards/1/private.key'], identities[0]);
  assert.deepEqual(files['cards/1/secret.bin'], [...demo.cards[0].secret]);
  assert(!files['sd/testnet-multisig-unsigned.psbt']);
  for (const file of createDemoFiles('mainnet').files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  pass('Network switch preserves occupied card identity/seed and replaces only demo files');

  await page.locator('#sd-token').click(); // Eject.
  await page.locator('#sd-token:not(:disabled)').waitFor();
  await insert('#sd-token', 'desktop');
  await importDemo('testnet');
  assert((await page.locator('#sd-location').innerText()).includes('Specter Desktop'));
  await page.locator('#sd-token').click();
  await page.locator('#sd-token:not(:disabled)').waitFor();
  await insert('#sd-token', 'diy');
  await page.locator('#sd-refresh').click();
  await page.locator('#sd-refresh:not(:disabled)').waitFor();
  files = await readMedia();
  for (const file of demo.files) assert.deepEqual(files[`sd/${file.name}`], [...file.bytes]);
  pass('Same virtual SD card round-trips between Desktop and running DIY firmware');
  for (const mode of ['drop', 'paste']) {
    await page.locator('#sd-files li').filter({ hasText: `${mode}.bin` }).getByRole('button', { name: 'Delete' }).click();
    await page.locator('#sd-token:not(:disabled)').waitFor();
    assert(!(await readMedia())[`sd/${mode}.bin`]);
    assert(!/error/i.test(await page.locator('#media-status').innerText()));
  }
  pass('Delete updates the running DIY filesystem and persistent virtual SD storage');

  await importDemo('');
  files = await readMedia();
  assert.deepEqual(files['sd/keep.bin'], [0, 255, 42]);
  for (const file of demo.files) assert(!files[`sd/${file.name}`]);
  assert(!files['cards/1/secret.bin']?.length);
  assert(!files['cards/2/secret.bin']?.length);
  assert.equal(await page.locator('#sd-location').innerText(), 'Not inserted');
  assert.equal(await page.locator('.card-details:visible').count(), 0);
  pass('None removes imported demo data and retains unrelated binary files');

  await importDemo('testnet');
  const cardBeforeReset = (await readMedia())['cards/2/private.key'];
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.memory-token[data-slot="2"]').click({ button: 'right' });
  await page.locator('.memory-token[data-slot="2"]:not(:disabled)').waitFor();
  assert(!(await readMedia())['cards/2/private.key']);
  await importDemo('mainnet');
  assert.notDeepEqual((await readMedia())['cards/2/private.key'], cardBeforeReset);
  await importDemo('testnet');
  pass('Shared right-click reset clears the card and the next import creates a new firmware identity');
  await page.locator('#cable-toggle').check(); assert(await page.locator('#cable-toggle').isChecked());
  await page.locator('#cable-toggle').uncheck();
  for (const width of [1512, 800, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    assert(await page.locator('#demo-network').isVisible());
    assert(await page.locator('#cable-toggle').isEnabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Media panel overflows viewport');
  }
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.locator('#companion-media').screenshot({ path: 'test-results/companion-media.png' });
  pass('Three original boxes, clickable cable toggle, responsive desktop/tablet/mobile layout');
  const canvas = await page.frameLocator('#diy-app').locator('#screen').elementHandle();
  await page.locator('#desktop-reset').click();
  await page.locator('#desktop-status').getByText('Desktop data reset', { exact: true }).waitFor({ timeout: 360000 });
  await app.getByRole('link', { name: 'Connect to the Bitcoin network', exact: true }).click();
  assert.equal(await app.locator('#server-list').inputValue(), 'Blockstream Bitcoin Testnet');
  assert.equal(await app.getByRole('link', { name: /^Testnet Default Audit/ }).count(), 0);
  assert(await page.frameLocator('#diy-app').locator('#screen').evaluate((current, before) => current === before, canvas));
  await canvas.dispose();
  assert.deepEqual((await readMedia())['sd/keep.bin'], [0, 255, 42]);
  pass('Reset clears old wallets and restores Testnet while preserving DIY canvas and media');
  const offline = await browser.newPage();
  await offline.route('**/api/ab/electrum', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test outage"}' }));
  await offline.goto(`${base}/specter-desktop/`);
  await offline.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  await offline.frameLocator('#desktop-app').getByRole('link', { name: 'Connect to the Bitcoin network', exact: true }).click();
  assert.equal(await offline.frameLocator('#desktop-app').locator('#server-list').inputValue(), 'Blockstream Bitcoin Testnet');
  await offline.close();
  pass('Fresh offline startup remains usable with its Testnet node');
  await page.locator('#sd-clear').click();
  await page.locator('#sd-token:not(:disabled)').waitFor();
  assert(!(Object.keys(await readMedia()).some(path => path.startsWith('sd/'))));
  assert((await readMedia())['cards/1/secret.bin']?.length);
  pass('Clear empties the actual SD card while preserving MemoryCard data');
  assert.deepEqual(errors, []);
  assert(!calls.some(call => call.method === 'blockchain.transaction.broadcast'));
  await writeFile('test-results/companion-media.json', JSON.stringify({ checks, errors, ports: [...new Set(calls.map(call => call.port))] }, null, 2));
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/companion-media-failure.png', fullPage: true });
  console.error(await page.locator('#loader-detail').innerText().catch(() => ''));
  throw error;
} finally { await browser.close(); }
