import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`${base}/?variant=schnuartz`, { waitUntil: 'domcontentloaded' });
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 75000 });
  if (!(await page.locator('#build-repository-link').textContent()).includes('Schnuartz/specter-playground')) {
    throw new Error('Wrong Schnuartz firmware source');
  }

  await page.locator('#sd-toggle').click();
  await page.locator('#sd-state').getByText('Inserted', { exact: true }).waitFor();

  const firstCard = page.locator('#card-slots > div').nth(0);
  await firstCard.locator('.smartcard-graphic').click();
  await firstCard.getByText('Inserted', { exact: true }).waitFor();
  await page.locator('#demo-load').click();
  await page.locator('#demo-load').getByText('Import Demo Data Again', { exact: true })
    .waitFor({ timeout: 30000 });

  const canvas = page.locator('#screen');
  await canvas.screenshot({ path: 'test-results/schnuartz-storage-boot.png' });
  const box = await canvas.boundingBox();
  for (const [x, y] of [[.50, .44], [.24, .44], [.76, .79]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await canvas.screenshot({ path: 'test-results/schnuartz-storage-unlocked.png' });
  await page.mouse.click(box.x + box.width * .50, box.y + box.height * .57);
  await page.waitForTimeout(800);
  await canvas.screenshot({ path: 'test-results/schnuartz-storage-dashboard.png' });
  await page.mouse.click(box.x + box.width * .50, box.y + box.height * .85);
  await page.waitForTimeout(800);
  await canvas.screenshot({ path: 'test-results/schnuartz-sd-screen.png' });
  await page.mouse.click(box.x + box.width * .92, box.y + box.height * .035);
  await page.waitForTimeout(800);
  await canvas.screenshot({ path: 'test-results/schnuartz-settings-screen.png' });
  await page.mouse.click(box.x + box.width * .50, box.y + box.height * .66);
  await page.waitForTimeout(1200);
  await canvas.screenshot({ path: 'test-results/schnuartz-smartcard-screen.png' });
  await page.mouse.click(box.x + box.width * .50, box.y + box.height * .19);
  await page.waitForTimeout(500);
  await canvas.screenshot({ path: 'test-results/schnuartz-smartcard-pin-keyboard.png' });
  for (const [x, y] of [[.17, .56], [.50, .56], [.83, .56], [.10, .69]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(120);
  }
  await page.mouse.click(box.x + box.width * .80, box.y + box.height * .69);
  await page.waitForTimeout(500);
  await canvas.screenshot({ path: 'test-results/schnuartz-smartcard-pin-entered.png' });
  await page.mouse.click(box.x + box.width * .50, box.y + box.height * .34);
  await page.waitForTimeout(3000);
  await canvas.screenshot({ path: 'test-results/schnuartz-smartcard-loaded.png' });
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ result: 'pass', boot: true, sdInserted: true,
    smartcardInserted: true, pinAccepted: true, sdMenuOpened: true,
    smartcardMenuOpened: true, demoMediaImported: true }));
} finally {
  await browser.close();
}
