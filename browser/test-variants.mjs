import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
await mkdir('test-results', { recursive: true });
const images = new Map();

async function unlockFirstSchnuartzLogin(page, canvas, tap) {
  const box = await canvas.boundingBox();
  const locked = await canvas.screenshot();
  // The browser MockUI entry point sets the test PIN to 21.
  for (const [x, y] of [[.50, .44], [.24, .44], [.75, .78]]) {
    await tap(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(900);
  if (locked.equals(await canvas.screenshot())) {
    throw new Error('schnuartz: test PIN did not open first-seed setup');
  }
}

for (const variant of [
  { id: 'play', repo: 'k9ert/specter-playground', pointer: '/browser/variants/specter-playground.json',
    targets: [[.24, .38], [.50, .38], [.75, .38], [.24, .55]] },
  { id: 'play-fast', url: '/?variant=play&buildVariant=fast', repo: 'schnuartz-ai/specter-playground', pointer: '/browser/variants/specter-playground-fast.json',
    targets: [[.24, .38], [.50, .38], [.75, .38], [.24, .55]] },
  { id: 'schnuartz', repo: 'Schnuartz/specter-playground', pointer: '/browser/variants/specter-playground-schnuartz.json',
    targets: [[.94, .03], [.50, .48], [.50, .85]] },
]) {
  const page = await browser.newPage({ viewport: { width: 850, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pointer = await (await page.request.get(`${base}${variant.pointer}`)).json();
  const manifest = await (await page.request.get(`${base}${pointer.build}build-info.json`)).json();
  if (manifest.repository !== variant.repo || manifest.entrypoint !== 'mockui' ||
      !pointer.build.includes('-mockui/')) throw new Error(`${variant.id}: wrong Playground application`);
  await page.goto(`${base}${variant.url || `/?variant=${variant.id}`}`);
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
  if (variant.id === 'schnuartz') {
    await unlockFirstSchnuartzLogin(page, canvas, (x, y) => page.mouse.click(x, y));
  }
  const before = await canvas.screenshot({ path: `test-results/${variant.id}-mockui-screen.png` });
  const png = PNG.sync.read(before);
  const colors = new Set();
  for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
  if (colors.size < 12) throw new Error(`${variant.id}: LVGL screen has only ${colors.size} colors`);
  images.set(variant.id, before);
  const box = await canvas.boundingBox();
  let changed = false;
  for (const [x, y] of variant.targets) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    await page.waitForTimeout(1600);
    changed = !before.equals(await canvas.screenshot());
    if (changed) break;
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
  { id: 'play', targets: [[.24, .38], [.50, .38], [.75, .38], [.24, .55]] },
  { id: 'schnuartz', targets: [[.94, .03], [.50, .48], [.50, .85]] },
]) {
  const page = await mobile.newPage();
  await page.goto(`${base}/?variant=${variant.id}`);
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 65000 });
  const canvas = page.locator('#screen');
  if (variant.id === 'schnuartz') {
    await unlockFirstSchnuartzLogin(page, canvas, (x, y) => page.touchscreen.tap(x, y));
  }
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  let changed = false;
  for (const [x, y] of variant.targets) {
    await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(1600);
    changed = !before.equals(await canvas.screenshot());
    if (changed) break;
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
