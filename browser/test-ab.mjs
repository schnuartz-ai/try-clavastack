import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${base}/ab/`);
await page.locator('h1').getByText('Specter', { exact: true }).waitFor();
assert.equal(await page.locator('[data-device] h2').count(), 2);
assert.deepEqual(await page.locator('[data-device] h2').allTextContents(), ['Specter A', 'Specter B']);
assert.equal(await page.locator('.memory-token').count(), 3);
await page.locator('[data-device="diy"] .device-status').getByText('Running locally', { exact: false }).waitFor({ timeout: 60000 });
await page.locator('[data-device="play"] .device-status').getByText('Running locally', { exact: false }).waitFor({ timeout: 60000 });
const developerOptions = page.locator('#developer-options-toggle');
assert.equal(await developerOptions.isChecked(), false);
assert.equal(await page.locator('#developer-inspector-grid').isVisible(), false);
await developerOptions.check();
assert.equal(await page.locator('#developer-inspector-grid').isVisible(), true);
for (const variant of ['diy', 'play']) {
  const pane = page.locator(`[data-inspector-pane="${variant}"]`);
  await page.waitForFunction(name => {
    const state = document.querySelector(`[data-inspector-pane="${name}"] [data-inspector-state]`).textContent;
    return state.includes('"memoryBytes"');
  }, variant, { timeout: 20000 });
  const state = JSON.parse(await pane.locator('[data-inspector-state]').textContent());
  assert(state.memoryBytes > 0, `${variant} should expose its WebAssembly RAM size`);
  if (state.firmware?.keystoreObjects) {
    assert.equal(typeof state.firmware.keystoreObjects['keystore.mnemonic'].present, 'boolean');
    assert.equal(await pane.locator('[data-inspector-read-sensitive]').isDisabled(), false);
  } else {
    assert.match(state.firmware?.error || '', /MockUI/);
    assert.equal(await pane.locator('[data-inspector-keystore-note]').isVisible(), true);
    assert.equal(await pane.locator('[data-inspector-read-sensitive]').isDisabled(), true);
  }
  await page.waitForFunction(name =>
    document.querySelector(`[data-inspector-pane="${name}"] [data-inspector-files] option`)?.value,
  variant, { timeout: 10000 });
  await page.waitForFunction(name => {
    const pane = document.querySelector(`[data-inspector-pane="${name}"]`);
    const path = pane.querySelector('[data-inspector-files]').value;
    return path && pane.querySelector('[data-inspector-file-content]').textContent.startsWith(`${path} ·`);
  }, variant, { timeout: 10000 });
}
const panePositions = await page.evaluate(() => Object.fromEntries(['diy', 'play'].map(name => {
  const { x, y, right } = document.querySelector(`[data-inspector-pane="${name}"]`).getBoundingClientRect();
  return [name, { x, y, right }];
})));
assert(panePositions.diy.right <= panePositions.play.x, 'Specter A and B inspector panels should be side by side');

const paneA = page.locator('[data-inspector-pane="diy"]');
const paneB = page.locator('[data-inspector-pane="play"]');
await paneA.locator('[data-inspector-action="baseline"]').click();
await paneA.locator('[data-inspector-changes]').getByText('Baseline captured', { exact: false }).waitFor({ timeout: 15000 });
assert(!(await paneB.locator('[data-inspector-changes]').textContent()).includes('Baseline captured'),
  'Specter A baseline must not overwrite Specter B');
await paneB.locator('[data-inspector-read-memory]').click();
await paneB.locator('[data-inspector-memory]').getByText('00000000', { exact: false }).waitFor({ timeout: 10000 });
assert.equal(await paneA.locator('[data-inspector-memory]').textContent(), '', 'RAM read must stay in Specter B panel');

if (!(await paneA.locator('[data-inspector-read-sensitive]').isDisabled())) {
  await paneA.locator('[data-inspector-sensitive-panel] summary').click();
  await paneA.locator('[data-inspector-read-sensitive]').click();
  await page.waitForFunction(() => {
    const output = document.querySelector('[data-inspector-pane="diy"] [data-inspector-sensitive-values]');
    return !output.textContent.includes('Reading the live keystore value');
  }, null, { timeout: 15000 });
  assert.equal(await paneB.locator('[data-inspector-sensitive-values]').textContent(), '',
    'Specter A sensitive RAM read must not appear in Specter B');
} else {
  assert.match(await paneA.locator('[data-inspector-keystore-note]').textContent(), /no wallet keystore/i);
}
await developerOptions.uncheck();
assert.equal(await page.locator('#developer-inspector-grid').isVisible(), false);
for (const pane of [paneA, paneB]) {
  assert.equal(await pane.locator('[data-inspector-state]').textContent(), '');
  assert.equal(await pane.locator('[data-inspector-sensitive-values]').textContent(), '');
}
assert.deepEqual(errors, []);
await page.screenshot({ path: 'test-results/ab-two-devices.png', fullPage: true });
await browser.close();
console.log(JSON.stringify({ result: 'pass', page: '/ab/', devices: 2, isolatedDeveloperInspectors: 2, sharedMemoryCards: 3 }));
