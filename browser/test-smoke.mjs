import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 900 } });
page.setDefaultTimeout(15_000);
const errors = [];
const messages = [];
const requests = [];
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('request', request => requests.push(request.url()));
page.on('console', message => {
  messages.push(message.text());
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${base}/browser/${process.env.TEST_PAGE || 'smoke.html'}${process.env.TEST_QUERY || ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(Number(process.env.TEST_WAIT_MS || 8_000));
if (process.env.TEST_CLICK) {
  const [x, y] = process.env.TEST_CLICK.split(',').map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(1000);
}
try { await page.screenshot({ path: 'test-results/runtime-smoke.png', timeout: 5000 }); }
catch (error) { errors.push(error.message); }
console.log(JSON.stringify({ messages, errors }, null, 2));
const result = await page.evaluate(() => {
  const canvas = document.querySelector('#screen');
  let image;
  try { image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; }
  catch { image = []; }
  let nonBlack = 0;
  for (let i = 0; i < image.length; i += 4) {
    if (image[i] || image[i + 1] || image[i + 2]) nonBlack++;
  }
  return { log: document.querySelector('#log').textContent, nonBlack };
});
console.log(JSON.stringify({ ...result, errors, requests }, null, 2));
await browser.close();
if (!result.log.includes('SPECTER_BROWSER_BOOT') || result.nonBlack === 0 || errors.length) {
  process.exitCode = 1;
}
