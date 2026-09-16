import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
await mkdir('test-results', { recursive: true });
const images = new Map();
for (const variant of [
  { id: 'play', repo: 'k9ert/specter-playground', pointer: '/browser/variants/specter-playground.json', x: .24, y: .38 },
  { id: 'schnuartz', repo: 'Schnuartz/specter-playground', pointer: '/browser/variants/specter-playground-schnuartz.json', x: .94, y: .03 },
]) {
  const page = await browser.newPage({ viewport: { width: 850, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pointer = await (await page.request.get(`${base}${variant.pointer}`)).json();
  const manifest = await (await page.request.get(`${base}${pointer.build}build-info.json`)).json();
  if (manifest.repository !== variant.repo || manifest.entrypoint !== 'mockui' ||
      !pointer.build.includes('-mockui/')) throw new Error(`${variant.id}: wrong Playground application`);
  await page.goto(`${base}/?variant=${variant.id}`);
  try {
    await page.locator('#st').getByText('Running locally').waitFor({ timeout: 65000 });
  } catch (error) {
    // Preserve the worker's complete startup evidence when a variant never
    // reaches its ready marker; otherwise Playwright only reports a generic
    // locator timeout and hides the actual iframe/worker failure.
    console.error(JSON.stringify({
      variant: variant.id,
      pageErrors: errors,
      status: await page.locator('#st').textContent().catch(() => null),
      buildLabel: await page.locator('#build-repository-link').textContent().catch(() => null),
      debug: await page.locator('#debug-log').textContent().catch(() => null),
      error: String(error),
    }));
    throw error;
  }
  const buildRepositoryLink = page.locator('#build-repository-link');
  if (await buildRepositoryLink.textContent() !== variant.repo ||
      await buildRepositoryLink.getAttribute('href') !== `https://github.com/${variant.repo}`) {
    throw new Error(`${variant.id}: wrong hidden build repository details`);
  }
  await page.waitForTimeout(700);
  const canvas = page.locator('#screen');
  const before = await canvas.screenshot({ path: `test-results/${variant.id}-mockui-screen.png` });
  const png = PNG.sync.read(before);
  const colors = new Set();
  for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
  if (colors.size < 12) throw new Error(`${variant.id}: LVGL screen has only ${colors.size} colors`);
  images.set(variant.id, before);
  const box = await canvas.boundingBox();
  let changed = false;
  for (let attempt = 0; attempt < 3 && !changed; attempt++) {
    await page.mouse.click(box.x + box.width * variant.x, box.y + box.height * variant.y);
    await page.waitForTimeout(1000);
    changed = !before.equals(await canvas.screenshot());
  }
  if (!changed) throw new Error(`${variant.id}: pointer did not reach LVGL`);
  if (errors.length) throw new Error(`${variant.id}: ${errors.join('; ')}`);
  console.log(JSON.stringify({ variant: variant.id, application: 'original LVGL 9 MockUI scenario',
    boot: 'pass', colors: colors.size, pointer: 'pass' }));
  await page.close();
}
if (images.get('play').equals(images.get('schnuartz'))) throw new Error('Both Playground screens are identical');

const mobile = await browser.newContext({ ...devices['Pixel 5'],
  viewport: { width: 360, height: 740 }, deviceScaleFactor: 3 });
for (const variant of [
  { id: 'play', x: .24, y: .38 },
  { id: 'schnuartz', x: .94, y: .03 },
]) {
  const page = await mobile.newPage();
  await page.goto(`${base}/?variant=${variant.id}`);
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 65000 });
  const canvas = page.locator('#screen');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  let changed = false;
  for (let attempt = 0; attempt < 3 && !changed; attempt++) {
    await page.touchscreen.tap(box.x + box.width * variant.x, box.y + box.height * variant.y);
    await page.waitForTimeout(1000);
    changed = !before.equals(await canvas.screenshot());
  }
  if (!changed) {
    throw new Error(`${variant.id}: Android-scaled touch did not reach LVGL`);
  }
  console.log(JSON.stringify({ variant: variant.id, android: 'Pixel 5 / DPR 3',
    boot: 'pass', touch: 'pass' }));
  await page.close();
}
await mobile.close();
await browser.close();
