import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });
const requests = [];
const errors = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
if (process.env.TEST_LOCAL_CHANGES === '1') {
  for (const [pattern, path, contentType] of [
    ['**/simulators/', 'simulators/index.html', 'text/html'],
    ['**/simulators/site.js', 'simulators/site.js', 'text/javascript'],
    ['**/simulators/demo-data.js', 'simulators/demo-data.js', 'text/javascript'],
  ]) {
    await page.route(pattern, async route => route.fulfill({
      contentType, headers: { 'Cross-Origin-Resource-Policy': 'same-origin' }, body: await readFile(path),
    }));
  }
}
await page.addInitScript(() => {
  if (window === top) top.__demoWorkerCount = 0;
  const NativeWorker = window.Worker;
  window.Worker = class CountingWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      try { top.__demoWorkerCount = (top.__demoWorkerCount || 0) + 1; } catch {}
    }
  };
});
await page.goto(`${base}/simulators/`);
for (const name of ['diy', 'play', 'schnuartz']) {
  await page.locator(`[data-device="${name}"] .device-status`).getByText('Running locally', { exact: false })
    .waitFor({ timeout: 75000 });
}
if (requests.some(url => url.includes('/simulators/demo-data.js'))) {
  throw new Error('Demo data loaded before the button click');
}
await page.locator('#demo-target').selectOption('play');
await page.locator('#demo-load').click();
await page.locator('#demo-status').getByText('does not implement a confirmed', { exact: false }).waitFor();
if (requests.some(url => url.includes('/simulators/demo-data.js'))) {
  throw new Error('Unsupported device selection loaded demo payloads');
}
await page.locator('#demo-target').selectOption('diy');
const workersBefore = await page.evaluate(() => top.__demoWorkerCount);
const canvases = {};
for (const name of ['diy', 'play', 'schnuartz']) {
  canvases[name] = await page.frameLocator(`[data-device="${name}"] iframe`).locator('#screen').elementHandle();
}
await page.locator('#demo-load').click();
await page.locator('#demo-status').getByText('demo files passed to Device 1', { exact: false })
  .waitFor({ timeout: 30000 });
await mkdir('test-results', { recursive: true });
await page.locator('.demo-data').screenshot({ path: 'test-results/demo-data-panel.png' });
for (const name of ['00-CLAVASTACK-DEMO-README.txt', '01-ghost-PUBLIC-TEST-SEED.txt',
  '02-zoo-bip85-child-1.txt', 'testnet-ghost-payment-high-fee.psbt']) {
  await page.locator('#sd-files').getByText(name, { exact: false }).waitFor();
}
if (!await page.locator('[data-slot="1"] small').getByText('Inserted in device 1', { exact: true }).isVisible()) {
  throw new Error('MemoryCard 1 was not prepared and inserted');
}
if (await page.evaluate(() => top.__demoWorkerCount) !== workersBefore) {
  throw new Error('Demo import created or restarted a worker');
}
for (const name of ['diy', 'play', 'schnuartz']) {
  if (!await page.frameLocator(`[data-device="${name}"] iframe`).locator('#screen')
    .evaluate((current, previous) => current === previous, canvases[name])) {
    throw new Error(`${name} canvas was replaced during demo import`);
  }
  await canvases[name].dispose();
}
if (requests.some(url => /ghost%20ghost|zoo%20zoo|\/api\/(allocate|heartbeat)|\/novnc\//i.test(url))) {
  throw new Error('Demo import leaked payload data or used a session API');
}
if (!await page.locator('#feedback-screenshot').isDisabled()) {
  throw new Error('Feedback screenshots remained enabled after loading seed data');
}
await page.setViewportSize({ width: 390, height: 844 });
if (!await page.locator('.demo-data').evaluate(panel => {
  const rect = panel.getBoundingClientRect();
  return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
})) throw new Error('Demo controls overflow the Pixel 5 viewport');
await page.locator('.demo-data').screenshot({ path: 'test-results/demo-data-panel-mobile.png' });
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
console.log(JSON.stringify({ result: 'pass', workers: workersBefore,
  lazyDemoRequest: requests.filter(url => url.includes('/simulators/demo-data.js')).length,
  files: 1, canvasReplacements: 0, restarts: 0 }));
await browser.close();
