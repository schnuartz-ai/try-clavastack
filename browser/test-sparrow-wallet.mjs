import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const legacyPanelTest = process.env.SPARROW_LEGACY_PANEL_TEST === 'true';
const fullRuntimeTest = process.env.SPARROW_FULL_RUNTIME_TEST === 'true';
const failedRequests = [];
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  if (legacyPanelTest) {
    const legacyHtml = execFileSync('git', ['show', 'HEAD:specter-desktop/index.html'], { encoding: 'utf8' });
    await page.route('**/specter-desktop/**', async route => {
      const pathname = new URL(route.request().url()).pathname.replace(/\/$/, '');
      if (pathname !== '/specter-desktop') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
        body: legacyHtml,
      });
    });
  }

  const response = await page.goto(`${base}/sparrow-wallet/`, { waitUntil: 'domcontentloaded' });
  assert(response?.ok(), `Sparrow page returned ${response?.status()}`);
  assert(await page.title() === 'Sparrow Wallet · ClavaStack', 'Page title does not identify Sparrow Wallet');
  assert(await page.getByRole('heading', { name: 'Sparrow does not run in this browser' }).count() === 1,
    'Browser compatibility note is missing');
  assert(await page.getByRole('link', { name: 'Download Sparrow' }).getAttribute('href') === 'https://sparrowwallet.com/download/',
    'Official Sparrow download link is missing');

  const workbench = page.frameLocator('#specter-workbench');
  try {
    await workbench.getByRole('heading', { name: 'Cable Connection' }).waitFor({ timeout: 12000 });
  } catch (error) {
    const frameUrls = page.frames().map(frame => frame.url());
    const frameState = await page.frameLocator('#specter-workbench').locator('body').innerText().catch(innerError => String(innerError));
    console.error('Embedded workbench diagnostic:', JSON.stringify({ frameUrls, frameState, failedRequests }));
    throw error;
  }
  assert(await workbench.locator('#desktop-app').count() === 1, 'Upstream Specter Desktop frame is missing');
  assert(await workbench.locator('#diy-app').count() === 1, 'Specter DIY frame is missing');
  const mediaGroupHeadings = await workbench.locator('.media-grid > .media-group h3').allTextContents();
  assert(mediaGroupHeadings.join('|') === 'Virtual SD card|Virtual MemoryCards|Cable Connection',
    `SD card, MemoryCards and cable must be three sibling media groups: ${mediaGroupHeadings.join('|')}`);
  assert(await workbench.locator('.memory-token').count() === 3, 'Expected three simulated MemoryCards');
  assert((await workbench.locator('.drop-help').allTextContents()).some(text => text.includes('Right-click a card to reset it')),
    'MemoryCard reset instruction is missing');
  assert(await workbench.locator('.cable-file').count() === 0, 'The cable panel should not contain a File chip');
  const cablePanel = workbench.locator('.media-grid > .media-group.cable-panel');
  assert(await cablePanel.locator('h3').textContent() === 'Cable Connection', 'Compact cable label is missing');
  assert(await cablePanel.locator('.cable-endpoint').allTextContents().then(labels => labels.join('|')) === 'Specter DIY|Specter Desktop',
    'Compact cable endpoints are missing or mislabeled');
  assert(await cablePanel.locator('.cable-toggle span').textContent() === 'On/Off', 'Compact cable toggle label is missing');
  assert(await cablePanel.locator('#cable-status').evaluate(element => element.classList.contains('visually-hidden')),
    'Cable status text should stay visually hidden');
  assert(await cablePanel.evaluate(element => element.parentElement?.classList.contains('media-grid') &&
    !element.closest('.memory-group') && !element.closest('#sd-drop')),
  'Cable connection should be a separate media group beside the SD card and MemoryCards');
  assert(await page.getByText('No wallet data is passed between Sparrow and the Specter workbench on this page.').count() === 1,
    'Sparrow and Specter integration boundary is not stated clearly');

  if (fullRuntimeTest) {
    await workbench.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
    await workbench.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
    await page.waitForFunction(() => {
      const shell = document.querySelector('#specter-workbench');
      return shell?.contentDocument?.querySelector('#desktop-app')?.contentDocument?.title === 'Specter';
    }, null, { timeout: 120000 });
    const desktopTitle = await page.locator('#specter-workbench').evaluate(frame => frame.contentDocument?.querySelector('#desktop-app')?.contentDocument?.title);
    assert(desktopTitle === 'Specter', `Expected the embedded upstream Specter app, got ${desktopTitle}`);
  }

  console.log(`Sparrow route, compatibility boundary, official download, embedded Specter Desktop + DIY, virtual USB, shared SD and resettable MemoryCards verified${legacyPanelTest ? ' with legacy cable-panel adaptation' : ''}${fullRuntimeTest ? ' with both browser applications running' : ''}.`);
} finally {
  await browser.close();
}
