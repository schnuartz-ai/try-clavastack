import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));

await page.addInitScript(() => {
  window.__testKeeperFrames = [];
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'keeper-qr-output-frame') window.__testKeeperFrames.push(event.data.frame);
  });
});

try {
  await page.goto(`${base}/bitcoin-keeper/`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Bitcoin Keeper is running in this browser (TESTNET).').waitFor({ timeout: 90_000 });
  const keeper = page.frameLocator('#keeper-runtime');

  await keeper.getByTestId('key_1').waitFor({ timeout: 90_000 });
  await keeper.getByText('Welcome', { exact: true }).waitFor();
  const fontsLoaded = await keeper.locator('body').evaluate(async () => {
    const families = ['Inter', 'Inter-Regular', 'Lora-Medium'];
    return Promise.all(families.map(async (family) => ({
      family, loaded: (await document.fonts.load(`14px "${family}"`)).length > 0,
    })));
  });
  if (fontsLoaded.some(({ loaded }) => !loaded)) {
    throw new Error(`Keeper's original fonts did not load: ${JSON.stringify(fontsLoaded)}`);
  }
  for (const digit of '12341234') {
    await keeper.getByTestId(`key_${digit}`).click();
    await page.waitForTimeout(325);
  }

  const createButton = keeper.getByTestId('btn_primaryText').first();
  const pinScreen = await keeper.locator('#keeper-native-root').innerText();
  if (!await createButton.isEnabled()) {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/keeper-pin-debug.png', fullPage: true });
    throw new Error(`Keeper did not accept the disposable PIN: ${pinScreen}`);
  }
  await createButton.click();
  await keeper.getByText('Continue', { exact: true }).last().click();
  await keeper.getByText('Cancel', { exact: true }).last().waitFor({ timeout: 15_000 });
  await keeper.getByText('Cancel', { exact: true }).last().click();
  await keeper.getByTestId('btn_skip').waitFor({ timeout: 30_000 });
  await keeper.getByTestId('btn_skip').click();
  await keeper.getByTestId('view_startNewTile').waitFor({ timeout: 30_000 });
  await keeper.getByTestId('view_startNewTile').click();

  await keeper.getByText('Next', { exact: true }).last().click();
  await keeper.locator('[data-testid^="wallet_item_"]').first().waitFor({ timeout: 60_000 });

  const recoveryModal = keeper.getByText('Protect Your Recovery Key', { exact: true });
  if (await recoveryModal.count()) {
    await keeper.getByText('Skip for Now', { exact: true }).click();
    await keeper.getByText('Skip Backup', { exact: true }).click();
  }

  await keeper.locator('[data-testid^="wallet_item_"]').first().click();
  // WalletDetails shows its real first-visit help modal. Close that modal
  // through Keeper's own close control before entering the receive screen.
  const walletHelp = keeper.getByText('Pull Down to Refresh', { exact: true });
  if (await walletHelp.count()) await keeper.getByTestId('btn_close_modal').last().click();
  await keeper.getByText('Receive\nBitcoin', { exact: true }).click();
  await keeper.getByTestId('view_recieveAddressQR').waitFor({ timeout: 30_000 });
  const addressTestId = await keeper.locator('[data-testid^="btn_copyToClipboard"]').getAttribute('data-testid');
  const address = addressTestId?.replace('btn_copyToClipboard', '') || '';
  if (!/^tb1[qp][0-9a-z]{30,}$/.test(address)) {
    throw new Error(`Keeper did not render a valid TESTNET receive address: ${address}`);
  }
  const receiveQr = keeper.locator('[data-testid="view_recieveAddressQR"] svg');
  await receiveQr.waitFor({ timeout: 20_000 });
  const decodedQr = await keeper.locator('[data-testid="view_recieveAddressQR"]').evaluate(async (root) => {
    const svg = root.querySelector('svg');
    if (!svg) return null;
    const source = new XMLSerializer().serializeToString(svg);
    const image = document.createElement('img');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(pixels.data, canvas.width, canvas.height)?.data || null;
  });
  if (decodedQr !== address) throw new Error(`Keeper's rendered QR decoded to ${decodedQr}, expected ${address}`);
  await page.waitForFunction((value) => window.__testKeeperFrames?.some((frame) => frame.includes(value)), address, { timeout: 15_000 });
  const bridgeFrames = await page.evaluate(() => window.__testKeeperFrames || []);

  const runtime = await page.frames().find((frame) => frame.url().includes('/bitcoin-keeper/runtime.html'))
    ?.evaluate(() => {
      const realm = JSON.parse(sessionStorage.getItem('keeper:realm-session-v1') || '{}');
      const app = realm.KeeperApp?.[0];
      const wallet = realm.Wallet?.[0];
      return {
        bodyText: document.body.innerText.slice(0, 3000),
        nativeExceptions: (globalThis.__keeperNativeExceptions || []).map((entry) => ({
          kind: entry.kind,
          message: entry.error?.message,
        })),
        reactErrors: (globalThis.__keeperReactErrors || []).map((entry) => entry.message),
        gestureRefDebug: globalThis.__keeperGestureRefDebug || null,
        sessionKeys: Object.keys(sessionStorage),
        app: app ? { networkType: app.networkType, enableAnalytics: app.enableAnalytics } : null,
        wallet: wallet ? {
          networkType: wallet.networkType,
          entityKind: wallet.entityKind,
          type: wallet.type,
          receiveAddress: wallet.specs?.receivingAddress || null,
          walletCount: realm.Wallet?.length || 0,
        } : null,
      };
    });

  if (runtime?.app?.networkType !== 'TESTNET' || runtime?.wallet?.walletCount !== 1) {
    throw new Error(`Keeper did not persist exactly one TESTNET wallet: ${JSON.stringify(runtime?.wallet)}`);
  }
  if (!bridgeFrames.some((frame) => frame.includes(address))) {
    throw new Error('Keeper QR output did not reach the page bridge.');
  }
  if (runtime?.nativeExceptions?.length || runtime?.reactErrors?.length) {
    throw new Error(`Keeper reported runtime errors: ${JSON.stringify({ native: runtime.nativeExceptions, react: runtime.reactErrors })}`);
  }
  const relevantFailedRequests = failedRequests.filter(({ url, error }) =>
    !(url.includes('/micropython.js') && error === 'net::ERR_ABORTED'));
  if (pageErrors.length || consoleErrors.length || relevantFailedRequests.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors, failedRequests: relevantFailedRequests })}`);
  }

  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/keeper-upstream-onboarding.png', fullPage: true });
  console.log(JSON.stringify({
    result: 'testnet-receive-screen-reached',
    fontsLoaded,
    receiveAddress: address,
    renderedQrSvg: true,
    decodedQr,
    keeperOutputBridge: bridgeFrames.includes(address),
    keeperText: runtime?.bodyText,
    nativeExceptions: runtime?.nativeExceptions,
    reactErrors: runtime?.reactErrors,
    app: runtime?.app,
    wallet: runtime?.wallet,
    gestureRefDebug: runtime?.gestureRefDebug,
    sessionKeys: runtime?.sessionKeys,
    pageErrors,
    consoleErrors,
    failedRequests,
  }, null, 2));
} catch (error) {
  const keeperFrame = page.frames().find((frame) => frame.url().includes('/bitcoin-keeper/runtime.html'));
  const diagnostic = await keeperFrame?.evaluate(() => {
    const realm = JSON.parse(sessionStorage.getItem('keeper:realm-session-v1') || '{}');
    return {
      bodyText: document.body.innerText.slice(0, 4000),
      walletCount: realm.Wallet?.length || 0,
      app: realm.KeeperApp?.[0] ? {
        networkType: realm.KeeperApp[0].networkType,
        enableAnalytics: realm.KeeperApp[0].enableAnalytics,
      } : null,
      nativeExceptions: (globalThis.__keeperNativeExceptions || []).map((entry) => entry.error?.message),
      reactErrors: (globalThis.__keeperReactErrors || []).map((entry) => ({
        message: entry.message,
        stack: entry.stack,
        componentStack: entry.componentStack,
      })),
    };
  });
  const keeperFrames = await page.evaluate(() => window.__testKeeperFrames || []);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/keeper-upstream-flow-failure.png', fullPage: true });
  console.error(JSON.stringify({ diagnostic, keeperFrames, pageErrors, consoleErrors, failedRequests }, null, 2));
  throw error;
} finally {
  await browser.close();
}
