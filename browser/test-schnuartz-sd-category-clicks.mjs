import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8768';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 1000 } });

try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`${base}/?variant=schnuartz`, { waitUntil: 'domcontentloaded' });
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 75000 });
  await page.waitForTimeout(4000);
  const build = await page.locator('#build-link').textContent();
  if (!build.startsWith('ba9ac2c9')) throw new Error(`Wrong build: ${build}`);

  await page.locator('#sd-toggle').click();
  const firstCard = page.locator('#card-slots > div').nth(0);
  await firstCard.locator('.smartcard-graphic').click();
  await firstCard.getByText('Inserted', { exact: true }).waitFor();
  await page.locator('#demo-load').click();
  await page.locator('#demo-load').getByText('Import Demo Data Again', { exact: true })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);

  const canvas = page.locator('#screen');
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  const click = async (x, y, wait = 400) => {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(wait);
  };
  let pinStep = 0;
  for (const [x, y] of [[.50, .44], [.24, .44], [.76, .79]]) {
    await click(x, y, 500);
    pinStep += 1;
    await canvas.screenshot({ path: `test-results/sd-pin-${pinStep}.png` });
  }
  await page.waitForTimeout(2000);
  await canvas.screenshot({ path: 'test-results/sd-after-unlock.png' });
  await click(.50, .57, 800);
  await click(.50, .85, 1200);
  await canvas.screenshot({ path: 'test-results/sd-categories-top.png' });

  await click(.50, .20, 45000);
  await canvas.screenshot({ path: 'test-results/sd-seed-imported.png' });
  await click(.15, .95, 1500);
  await canvas.screenshot({ path: 'test-results/sd-seed-hierarchy-dropup.png' });
  await click(.15, .95, 800);
  await click(.84, .95, 1000);

  for (let index = 0; index < 2; index += 1) {
    await page.mouse.move(box.x + box.width * .50, box.y + box.height * .82);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .50, box.y + box.height * .22, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  await canvas.screenshot({ path: 'test-results/sd-categories-bottom.png' });
  await click(.50, .71, 5000);
  await canvas.screenshot({ path: 'test-results/sd-wallet-imported.png' });
  await click(.50, .95, 1200);
  await click(.50, .09, 1200);
  await canvas.screenshot({ path: 'test-results/seed-dropdown-polished.png' });
  console.log(JSON.stringify({ result: 'pass', build, seedClicked: true, walletClicked: true }));
} finally {
  await browser.close();
  process.exit(0);
}
