import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const requests = [];
const errors = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
if (process.env.TEST_LOCAL_CHANGES === '1') {
  for (const [url, path, contentType] of [
    [`${base}/`, 'index.html', 'text/html'],
    [`${base}/browser/site.js`, 'browser/site.js', 'text/javascript'],
    [`${base}/browser/demo-data.js?v=20260930-mainnet-bip84-psbt-v3`, 'browser/demo-data.js', 'text/javascript'],
  ]) await page.route(url, async route => route.fulfill({ contentType,
    headers: { 'Cross-Origin-Resource-Policy': 'same-origin' }, body: await readFile(path) }));
}
await page.addInitScript(() => {
  window.__workerCount = 0;
  const NativeWorker = window.Worker;
  window.Worker = class CountingWorker extends NativeWorker {
    constructor(...args) { super(...args); window.__workerCount++; }
  };
});
await page.goto(`${base}/`);
await page.locator('#st').getByText('Running locally').waitFor({ timeout: 75000 });
const controlOrder = await page.locator('.sd-actions').evaluate(element =>
  [...element.children].map(child => child.id));
if (controlOrder.join('|') !== 'sd-add|sd-clear|demo-network' ||
    await page.locator('#demo-network').inputValue() !== '') {
  throw new Error('Import controls are not beside the SD actions');
}
const actionRows = await page.locator('#sd-add, #sd-clear, #demo-network').evaluateAll(elements =>
  elements.map(element => Math.round(element.getBoundingClientRect().top)));
if (new Set(actionRows).size !== 1) throw new Error('Desktop SD and demo controls do not share a row');
await page.setViewportSize({ width: 390, height: 844 });
const mobileRows = await page.locator('#sd-add, #sd-clear, #demo-network').evaluateAll(elements =>
  elements.map(element => Math.round(element.getBoundingClientRect().top)));
if (mobileRows[0] !== mobileRows[1] || mobileRows[0] === mobileRows[2]) {
  throw new Error(`Mobile SD controls do not wrap cleanly: ${mobileRows.join(', ')}`);
}
await page.setViewportSize({ width: 1440, height: 1000 });
if (await page.locator('.cta-section, #demo-primary').count()) throw new Error('Removed marketing or demo selector is still present');
if (!await page.locator('.hardware-link').getByText('Everything above is a simulation of', { exact: false }).count()) {
  throw new Error('Subtle ClavaStack hardware link is missing');
}
if (requests.some(url => url.includes('/browser/demo-data.js'))) throw new Error('Demo data loaded before click');
const workerCount = await page.evaluate(() => window.__workerCount);
await page.evaluate(() => {
  window.__demoCardInsertMessages = [];
  const postMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, transfer) {
    if (message?.type === 'card-insert') window.__demoCardInsertMessages.push(message.slot);
    return postMessage.call(this, message, transfer);
  };
});
const canvas = await page.locator('#screen').elementHandle();
await page.locator('#demo-network').selectOption('testnet');
await page.locator('#sd-state').getByText('Inserted', { exact: true }).waitFor();
if (await page.locator('#sd-toggle').getAttribute('aria-pressed') !== 'true') {
  throw new Error('Selecting a demo set did not automatically insert the SD card');
}
if (await page.evaluate(() => window.__demoCardInsertMessages.length)) {
  throw new Error('Selecting a demo set sent a Smartcard insertion command');
}
for (const name of ['01-ghost-PUBLIC-TEST-SEED.txt', '02-zoo-bip85-child-1.txt',
  'testnet-ghost-zoo-mirror-2of3.json', 'testnet-ghost-payment-high-fee.psbt',
  'testnet-multisig-unsigned.psbt']) {
  await page.locator('#sd-files').getByText(name, { exact: false }).waitFor();
}
await page.locator('#sd-picker').setInputFiles([
  { name: 'mainnet-multisig-unsigned.psbt', mimeType: 'application/octet-stream', buffer: Buffer.from('retired demo') },
  { name: 'mainnet-ghost-zoo-mirror-2of3.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
]);
await page.locator('#sd-files').getByText('mainnet-multisig-unsigned.psbt', { exact: false }).waitFor();
await page.locator('#demo-network').selectOption('mainnet');
if (await page.evaluate(() => window.__demoCardInsertMessages.length)) {
  throw new Error('Switching demo sets sent a Smartcard insertion command');
}
if (!((await page.locator('#demo-network').getAttribute('title')) || '').includes('Never send or store real funds')) {
  throw new Error('Mainnet safety tooltip is missing');
}
for (const name of ['01-ghost-PUBLIC-MAINNET-DEMO-SEED.txt', 'mainnet-ghost-wallet.json',
  'mainnet-zoo-wallet.json', 'mainnet-ghost-payment-high-fee.psbt']) {
  await page.locator('#sd-files').getByText(name, { exact: false }).waitFor();
}
if (await page.locator('#sd-files').getByText('testnet-ghost-payment-high-fee.psbt', { exact: false }).count()) {
  throw new Error('Switching demo networks kept stale Testnet files on the SD card');
}
for (const retired of ['mainnet-multisig-unsigned.psbt', 'mainnet-ghost-zoo-mirror-2of3.json']) {
  if (await page.locator('#sd-files').getByText(retired, { exact: false }).count()) {
    throw new Error(`Switching to Mainnet kept retired demo file ${retired}`);
  }
}
await page.locator('#demo-network').selectOption('testnet');
await page.locator('#sd-files').getByText('testnet-ghost-payment-high-fee.psbt', { exact: false }).waitFor();
if (await page.locator('#sd-files').getByText('mainnet-ghost-wallet.json', { exact: false }).count()) {
  throw new Error('Switching back to Testnet kept stale Mainnet files on the SD card');
}
await page.locator('#demo-network').selectOption('');
await page.locator('#demo-network:not(:disabled)').waitFor();
for (const name of ['01-ghost-PUBLIC-TEST-SEED.txt', 'testnet-ghost-payment-high-fee.psbt',
  'mainnet-ghost-wallet.json', 'mainnet-ghost-payment-high-fee.psbt']) {
  if (await page.locator('#sd-files').getByText(name, { exact: false }).count()) {
    throw new Error(`Selecting None kept demo file ${name}`);
  }
}
if (await page.locator('#sd-toggle').getAttribute('aria-pressed') !== 'false') {
  throw new Error('Selecting None did not eject the SD card that the demo set inserted');
}
if (await page.locator('#card-slots .card-details').count()) {
  throw new Error('Selecting None kept demo seed details on the Smartcards');
}
for (let slot = 0; slot < 2; slot++) {
  const label = await page.locator('#card-slots > div').nth(slot).locator('button').getAttribute('aria-label');
  if (!label?.includes('Not inserted')) throw new Error(`Selecting None left Smartcard ${slot + 1} inserted`);
}
await page.locator('#demo-network').selectOption('testnet');
await page.locator('#sd-files').getByText('testnet-ghost-payment-high-fee.psbt', { exact: false }).waitFor();
await page.locator('#sd-state').getByText('Inserted', { exact: true }).waitFor();
await page.locator('#sd-picker').setInputFiles({ name: 'payment.signed.demo.psbt',
  mimeType: 'application/octet-stream', buffer: Buffer.from('signed public demo transaction') });
await page.locator('#sd-files').getByText('payment.signed.demo.psbt', { exact: false }).waitFor();
const groups = await page.locator('#sd-files .sd-group').allTextContents();
if (groups.join('|') !== 'Signed transactions|PSBT|Text|JSON') {
  throw new Error(`Unexpected SD group order: ${groups.join('|')}`);
}
await page.locator('#sd-state').getByText('Inserted', { exact: true }).waitFor();
for (const slot of [0, 1]) {
  const label = await page.locator('#card-slots > div').nth(slot).locator('button').getAttribute('aria-label');
  if (!label?.includes('Not inserted')) throw new Error(`Demo selection automatically inserted Smartcard ${slot + 1}`);
}
for (const [slot, seed, pin] of [[0, 'ghost-seed', 'PIN: 1234'], [1, 'zoo-seed', 'PIN: 21']]) {
  const details = page.locator('#card-slots > div').nth(slot).locator('.card-details');
  await details.getByText(seed, { exact: false }).waitFor();
  await details.getByText(pin, { exact: false }).waitFor();
}
if (await page.evaluate(() => window.__workerCount) !== workerCount) throw new Error('Demo import created or restarted a worker');
if (!await page.locator('#screen').evaluate((current, previous) => current === previous, canvas)) {
  throw new Error('Demo import replaced the firmware canvas');
}
await canvas.dispose();
if (requests.some(url => /ghost%20ghost|zoo%20zoo|\/api\/(allocate|heartbeat)|\/novnc\//i.test(url))) {
  throw new Error('Demo payload leaked into a request');
}
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({ result: 'pass', workers: workerCount, lazyLoads: 1,
  target: 'normal Specter DIY only', restarts: 0, canvasReplacements: 0 }));
await browser.close();
