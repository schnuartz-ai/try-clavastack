import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 1000 } });
const requests = [];
const errors = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
if (process.env.TEST_LOCAL_CHANGES === '1') {
  for (const [url, path, contentType] of [
    [`${base}/`, 'index.html', 'text/html'],
    [`${base}/browser/site.js`, 'browser/site.js', 'text/javascript'],
    [`${base}/browser/demo-data.js?v=20260916-provisioned-cards`, 'browser/demo-data.js', 'text/javascript'],
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
if (!await page.locator('.page > .demo-import').count() ||
    await page.locator('.sim-panel .demo-import').count()) throw new Error('Demo panel is not separated from peripherals');
const positions = await page.evaluate(() => ({
  demo: document.querySelector('.demo-import').getBoundingClientRect().top,
  cta: document.querySelector('.cta-section').getBoundingClientRect().bottom,
}));
if (positions.demo < positions.cta) throw new Error('Demo panel is not below the CTA box');
if (requests.some(url => url.includes('/browser/demo-data.js'))) throw new Error('Demo data loaded before click');
const workerCount = await page.evaluate(() => window.__workerCount);
const canvas = await page.locator('#screen').elementHandle();
await page.locator('#demo-load').click();
await page.locator('#demo-status').getByText('10 focused Testnet files', { exact: false }).waitFor({ timeout: 30000 });
for (const name of ['01-ghost-PUBLIC-TEST-SEED.txt', '02-zoo-bip85-child-1.txt',
  'testnet-ghost-zoo-mirror-2of3.json', 'testnet-ghost-payment-high-fee.psbt']) {
  await page.locator('#sd-files').getByText(name, { exact: false }).waitFor();
}
await page.locator('#sd-state').getByText('Inserted', { exact: true }).waitFor();
await page.locator('#card-slots > div').nth(0).getByText('Inserted', { exact: true }).waitFor();
await page.locator('#card-status-refresh').click();
for (const [slot, label, pin] of [[0, 'Ghost test seed', 'PIN 1234'], [1, 'Zoo test seed', 'PIN 5678']]) {
  const details = page.locator('#card-slots > div').nth(slot).locator('.card-details');
  await details.getByText(label, { exact: false }).waitFor();
  await details.getByText('Seedphrase · Plain text', { exact: false }).waitFor();
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
