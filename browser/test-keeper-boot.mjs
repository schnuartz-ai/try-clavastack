import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
const errors = [];
const failedRequests = [];
page.on('pageerror', (error) => errors.push(error.stack || error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  await page.goto('http://127.0.0.1:8765/bitcoin-keeper/', { waitUntil: 'domcontentloaded' });
  await page.locator('#keeper-runtime').waitFor();
  await page.waitForTimeout(12_000);
  const keeper = page.frames().find((frame) => frame.url().includes('/bitcoin-keeper/runtime.html'));
  console.log(JSON.stringify({
    title: await page.title(),
    keeperUrl: keeper?.url(),
    keeperText: (await keeper?.locator('body').innerText().catch((error) => `ERROR: ${error.message}`) || '').slice(0, 5000),
    keeperHtml: (await keeper?.locator('#keeper-native-root').innerHTML().catch(() => '') || '').slice(0, 2000),
    keeperNativeExceptions: await keeper?.evaluate(() =>
      (globalThis.__keeperNativeExceptions || []).map((entry) => ({
        kind: entry.kind,
        message: entry.error?.message,
        stack: entry.error?.extraData?.rawStack?.split('\n').slice(0, 4).join('\n'),
      })),
    ),
    keeperReactErrors: await keeper?.evaluate(() =>
      (globalThis.__keeperReactErrors || []).map((entry) => ({
        message: entry.message,
        stack: entry.stack?.split('\n').slice(0, 5).join('\n'),
        componentStack: entry.componentStack?.split('\n').slice(0, 8).join('\n'),
      })),
    ),
    keeperRuntimeState: await keeper?.evaluate(() => ({
      bootMarkers: globalThis.__keeperBootMarkers || null,
      gestureRefDebug: globalThis.__keeperGestureRefDebug || null,
      appRegistryKeys: globalThis.RN$AppRegistry?.getAppKeys?.() || null,
      reactRootChildren: globalThis.__keeperReactRoot?._internalRoot?.current?.child?.type?.name || null,
      reactRootPending: globalThis.__keeperReactRoot?._internalRoot?.pendingLanes ?? null,
      sessionKeys: Object.keys(sessionStorage),
      rootChildren: document.getElementById('keeper-native-root')?.childElementCount,
      elementCheck: {
        elementType: typeof Element,
        windowElementType: typeof window.Element,
        elementSameAsWindow: Element === window.Element,
        createdElementInstance: document.createElement('div') instanceof Element,
        createdElementConstructor: document.createElement('div').constructor.name,
      },
    })),
    failedRequests,
    errors,
  }, null, 2));
  await page.screenshot({ path: 'test-results/keeper-native-boot.png', fullPage: true });
} finally {
  await browser.close();
}
