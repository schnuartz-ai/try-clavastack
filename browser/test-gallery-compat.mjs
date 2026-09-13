import { firefox, webkit } from 'playwright';
import { PNG } from 'pngjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
for (const [engine, launcher] of [['firefox', firefox], ['webkit', webkit]]) {
  const browser = await launcher.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 1100 } });
  await page.goto(`${base}/simulators/`);
  const transferable = await page.evaluate(() => Boolean(HTMLCanvasElement.prototype.transferControlToOffscreen));
  for (const name of ['diy', 'play', 'schnuartz']) {
    if (name !== 'diy' && !transferable) {
      await page.locator(`[data-device="${name}"] .device-status`)
        .getByText('without OffscreenCanvas', { exact: false }).waitFor({ timeout: 15000 });
      const fallback = page.frameLocator(`[data-device="${name}"] iframe`).locator('#loading a[href="/simulators/legacy/"]');
      await fallback.waitFor();
      continue;
    }
    await page.locator(`[data-device="${name}"] .device-status`).getByText('Running locally', { exact: false })
      .waitFor({ timeout: 90000 });
    await page.waitForTimeout(500);
    const image = PNG.sync.read(await page.frameLocator(`[data-device="${name}"] iframe`).locator('#screen').screenshot());
    const colors = new Set();
    for (let i = 0; i < image.data.length; i += 4) colors.add(`${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`);
    if (colors.size < 12) throw new Error(`${engine}: ${name} screen has ${colors.size} colors`);
  }
  if (transferable) {
    await page.locator('[data-slot="2"]').click();
    await page.locator('[data-target="play"]').click();
    await page.locator('[data-slot="2"] small').getByText('Inserted in device 2').waitFor();
  }
  console.log(JSON.stringify({ engine, gallery: transferable ? 'three firmware displays' : 'DIY and explicit Playground legacy fallbacks',
    card: transferable ? 'tap to device 2' : 'unsupported' }));
  await browser.close();
}
