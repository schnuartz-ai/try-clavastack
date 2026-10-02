import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.inspectorMessages = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.inspectorTestWorker = this;
        this.addEventListener('message', event => window.inspectorMessages.push(event.data));
      }
    };
  });
  await page.goto(base);
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('#developer-inspector').isVisible(), false);
  await page.evaluate(() => window.inspectorTestWorker.postMessage({ type: 'inspector-memory', address: 0 }));
  await page.waitForFunction(() => window.inspectorMessages.some(m => m.type === 'operation-error' && m.message === 'Advanced Options are disabled'));
  await page.locator('#advanced-options').check();
  await page.waitForFunction(() => document.querySelector('#inspector-state').textContent.includes('allocatedBytes'));
  const state = JSON.parse(await page.locator('#inspector-state').textContent());
  assert(state.firmware.allocatedBytes > 0);
  assert(state.firmware.freeBytes > 0);
  assert(state.memoryBytes > state.firmware.allocatedBytes);
  assert.notEqual(state.firmware.screen, 'unavailable');
  await page.locator('#inspector-baseline').click();
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.startsWith('Baseline captured'));
  await page.evaluate(() => window.inspectorTestWorker.postMessage({ type: 'sd-import', name: 'inspector-test.txt', bytes: new TextEncoder().encode('<test>alpha</test>') }));
  await page.locator('#inspector-compare').click();
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.includes('Added: /state/sd/inspector-test.txt'));
  await page.locator('#inspector-files').selectOption('/state/sd/inspector-test.txt');
  await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('<test>alpha</test>'));
  assert.equal(await page.locator('#inspector-content test').count(), 0);
  await page.locator('#inspector-baseline').click();
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.startsWith('Baseline captured'));
  await page.evaluate(() => window.inspectorTestWorker.postMessage({ type: 'sd-import', name: 'inspector-test.txt', bytes: new TextEncoder().encode('<test>bravo</test>') }));
  await page.locator('#inspector-compare').click();
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.includes('Changed: /state/sd/inspector-test.txt'));
  await page.locator('#inspector-read-memory').click();
  await page.waitForFunction(() => document.querySelector('#inspector-memory').textContent.includes('00000000'));
  await page.locator('#inspector-address').fill('0xffffffff');
  await page.locator('#inspector-read-memory').click();
  await page.waitForFunction(() => document.querySelector('#inspector-status').textContent.includes('outside WebAssembly memory'));
  await page.screenshot({ path: 'test-results/developer-inspector.png', fullPage: true });
  await page.locator('#advanced-options').uncheck();
  assert.equal(await page.locator('#developer-inspector').isVisible(), false);
  assert.equal(await page.locator('#inspector-content').textContent(), '');
  await page.locator('#advanced-options').check();
  await page.waitForFunction(() => document.querySelector('#inspector-state').textContent.includes('allocatedBytes'));
  await page.locator('#inspector-baseline').click();
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.startsWith('Baseline captured'));
  await page.locator('#restart-btn').click();
  await page.locator('#st').getByText('Running locally').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#inspector-changes').textContent.includes('New firmware run'));
  await page.waitForFunction(() => document.querySelector('#inspector-state').textContent.includes('allocatedBytes'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/developer-inspector-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Inspector: opt-in, real heap/state, file text/hex, same-size diff, RAM bounds, cleared previews, restart and mobile layout passed.');
} finally { await browser.close(); }
