import { firefox, webkit } from 'playwright';
import { PNG } from 'pngjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
for (const [name, engine] of Object.entries({ firefox, webkit })) {
  if (process.env.TEST_ENGINE && process.env.TEST_ENGINE !== name) continue;
  const browser = await engine.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base);
  if (process.env.TEST_FEATURES) {
    console.log(name, await page.evaluate(() => ({ worker: 'Worker' in window,
      offscreen: 'OffscreenCanvas' in window,
      transfer: Boolean(HTMLCanvasElement.prototype.transferControlToOffscreen),
      bitmap: Boolean(globalThis.OffscreenCanvas?.prototype.transferToImageBitmap) })));
    await browser.close();
    continue;
  }
  try {
    await page.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
  } catch (error) {
    throw new Error(`${name}: ${error.message}; status=${await page.locator('#st').textContent()}; loading=${await page.locator('#loading').textContent()}; debug=${await page.locator('#debug-log').textContent()}; features=${JSON.stringify(await page.evaluate(() => ({ worker: 'Worker' in window, offscreen: 'OffscreenCanvas' in window, transfer: Boolean(HTMLCanvasElement.prototype.transferControlToOffscreen) })))}`);
  }
  const screenshot = PNG.sync.read(await page.locator('#screen-overlay canvas').screenshot());
  const colors = new Set();
  for (let i = 0; i < screenshot.data.length; i += 4) {
    colors.add(`${screenshot.data[i]},${screenshot.data[i + 1]},${screenshot.data[i + 2]}`);
  }
  if (colors.size < 20) throw new Error(`${name}: Specter screen has only ${colors.size} colors`);
  await page.locator('#card-panel').waitFor({ state: 'visible' });
  const canvas = page.locator('#screen-overlay canvas');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.17, box.y + box.height * 0.35);
  await page.waitForTimeout(700);
  if (before.equals(await canvas.screenshot())) throw new Error(`${name}: pointer did not reach LVGL`);
  await page.locator('#sd-toggle').click();
  await page.locator('#sd-state').getByText('Inserted').waitFor();
  await page.locator('#restart-btn').click();
  await page.locator('#st').getByText('Starting locally').waitFor();
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
  await page.locator('#sd-state').getByText('Inserted').waitFor();
  console.log(JSON.stringify({ engine: name, boot: 'pass', canvasColors: colors.size,
    pointer: 'pass', restart: 'pass', sdState: 'pass' }));
  for (const variant of ['play', 'schnuartz']) {
    const fork = await browser.newPage();
    await fork.goto(`${base}/?variant=${variant}`);
    const transferable = await fork.evaluate(() => Boolean(HTMLCanvasElement.prototype.transferControlToOffscreen));
    if (!transferable) {
      await fork.locator('#st').getByText('Simulator error').waitFor({ timeout: 10000 });
      await fork.locator('#loading').getByText('without OffscreenCanvas', { exact: false }).waitFor();
      await fork.locator('#loading a[href="/simulators/legacy/"]').waitFor();
      console.log(JSON.stringify({ engine: name, variant, display: 'legacy fallback' }));
      await fork.close();
      continue;
    }
    await fork.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
    const screenshot = PNG.sync.read(await fork.locator('#screen').screenshot());
    const unique = new Set();
    for (let i = 0; i < screenshot.data.length; i += 4) {
      unique.add(`${screenshot.data[i]},${screenshot.data[i + 1]},${screenshot.data[i + 2]}`);
    }
    if (unique.size < 20) throw new Error(`${name}/${variant}: LVGL screen has ${unique.size} colors`);
    console.log(JSON.stringify({ engine: name, variant, boot: 'pass', canvasColors: unique.size }));
    await fork.close();
  }
  await browser.close();
}
