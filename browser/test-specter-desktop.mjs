import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1512, height: 1050 } });
const page = await context.newPage();
const requests = [];
const consoleErrors = [];
const failedRequests = [];
const desktopNavigations = [];
const hwiResponses = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => consoleErrors.push(error.stack || error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on('request', request => {
  if (request.isNavigationRequest() && request.url().includes('/specter-desktop/app/')) {
    desktopNavigations.push({ type: 'request', url: request.url(), method: request.method() });
  }
});
page.on('framenavigated', frame => {
  if (frame.url().includes('/specter-desktop/app/')) desktopNavigations.push({ type: 'navigation', url: frame.url() });
});
page.on('response', response => {
  if (response.url().includes('/specter-desktop/hwi/api/')) {
    response.text().then(body => hwiResponses.push({ status: response.status(), body })).catch(() => {});
  }
  if (response.url().includes('/specter-desktop/app/spc/welcome')) {
    desktopNavigations.push({ type: 'response', status: response.status(), location: response.headers()['location'] || null, url: response.url() });
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyProvenance() {
  const pointerResponse = await page.request.get(`${base}/browser/specter-desktop-current.json`);
  assert(pointerResponse.ok(), 'Specter Desktop build pointer is not deployed');
  const pointer = await pointerResponse.json();
  assert(pointer.repository === 'cryptoadvance/specter-desktop', 'Desktop pointer repository changed');
  assert(/^[a-f0-9]{40}$/.test(pointer.commit) && pointer.build.includes(pointer.commit), 'Desktop pointer does not pin an exact upstream commit');
  const infoResponse = await page.request.get(`${base}${pointer.build}build-info.json`);
  assert(infoResponse.ok(), 'Specter Desktop provenance manifest is missing');
  const info = await infoResponse.json();
  assert(info.repository === pointer.repository && info.commit === pointer.commit, 'Desktop build metadata does not match the pointer');
  assert(info.diy_repository === 'cryptoadvance/specter-diy' && /^[a-f0-9]{40}$/.test(info.diy_commit), 'DIY firmware provenance is missing');
  assert(info.web_simulator_repository === 'cryptoadvance/specter-diy-web-simulator' && /^[a-f0-9]{40}$/.test(info.web_simulator_commit), 'DIY simulator provenance is missing');
  assert(info.runtime.pyodide === '0.27.7' && info.runtime.python === '3.12.7', 'Python/WASM runtime version is not recorded');
  const archiveResponse = await page.request.get(`${base}${pointer.build}${info.source_archive.path}`);
  assert(archiveResponse.ok(), 'Upstream Desktop Python source archive is not deployed');
  const archive = await archiveResponse.body();
  const digest = createHash('sha256').update(archive).digest('hex');
  assert(digest === info.source_archive.sha256, 'The deployed upstream source archive failed its SHA-256 check');
  return { pointer, info };
}

const provenance = await verifyProvenance();
const externalHosts = new Set();
let diyRunning = false;
let desktopReady = false;

try {
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) externalHosts.add(url.hostname);
  });
  await page.goto(`${base}/specter-desktop/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#diy-app').waitFor({ timeout: 15000 });
  await page.locator('#diy-app').contentFrame().locator('#screen').waitFor({ timeout: 90000 });
  await page.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
  diyRunning = true;

  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  desktopReady = true;
  const desktop = page.frameLocator('#desktop-app');
  await page.waitForFunction(() => document.querySelector('#desktop-app')?.contentDocument?.title === 'Specter', null, { timeout: 120000 });
  await desktop.locator('body').waitFor({ timeout: 30000 });
  const desktopTitle = await page.locator('#desktop-app').evaluate(frame => frame.contentDocument?.title || '');
  assert(desktopTitle === 'Specter', `Expected upstream Specter title, got ${desktopTitle}`);

  const health = await page.evaluate(async () => {
    const response = await fetch('/specter-desktop/app/healthz/liveness', { cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  });
  assert(health.status === 200 && health.body.message === 'i am alive', 'The real Flask liveness route did not execute through the WSGI bridge');

  const routeResponse = await desktop.locator('body').evaluate(async () => {
    const response = await fetch('/specter-desktop/app/spc/welcome/', { cache: 'no-store' });
    const text = await response.text();
    return { status: response.status, text, contentType: response.headers.get('Content-Type') };
  });
  assert(routeResponse.status === 200 && routeResponse.text.includes('<title>Specter</title>'), 'The upstream Flask welcome route did not return its real Jinja template');
  assert(routeResponse.text.includes('static/typography.css') && routeResponse.contentType?.includes('text/html'), 'The upstream template/static URL generation did not execute');

  const appStatic = await page.evaluate(async () => {
    const response = await fetch('/specter-desktop/static/typography.css', { cache: 'no-store' });
    return { status: response.status, type: response.headers.get('Content-Type'), body: await response.text() };
  });
  assert(appStatic.status === 200 && appStatic.type?.includes('text/css') && appStatic.body.includes('@font-face'), 'The real upstream Desktop static assets are not served through WSGI');

  const diyPointer = await (await page.request.get(`${base}/browser/current.json`)).json();
  const diyManifest = await (await page.request.get(`${base}${diyPointer.build}build-info.json`)).json();
  assert(diyPointer.build.includes(diyManifest.commit) && diyManifest.repository === 'cryptoadvance/specter-diy', 'DIY iframe is not pinned to the upstream WebAssembly firmware');
  assert(await page.locator('#diy-app').getAttribute('src') === '/?embedded=1&gallery=1&variant=diy&qr-bridge=1', 'The existing Specter DIY simulator iframe is not reused');
  assert(await page.locator('#desktop-app').isVisible(), 'Real Desktop and DIY are not visible simultaneously');
  const mediaHeadings = await page.locator('.media-grid > .media-group h3').allTextContents();
  assert(mediaHeadings.join('|') === 'Virtual SD card|Virtual MemoryCards|Cable Connection', `Removable media must have three separate boxes: ${mediaHeadings.join('|')}`);
  assert(await page.locator('.cable-file').count() === 0, 'The Cable Connection box still contains the removed File chip');
  const cableLabels = await page.locator('.cable-route .cable-endpoint').allTextContents();
  assert(cableLabels.join('|') === 'Specter DIY|Specter Desktop', `Unexpected cable endpoints: ${cableLabels.join('|')}`);

  const desktopFrame = page.frameLocator('#desktop-app');
  await page.waitForFunction(() => document.querySelector('#desktop-app')?.contentDocument?.title === 'Specter', { timeout: 120000 });
  await desktopFrame.locator('body').waitFor({ timeout: 30000 });
  const appFrame = page.frames().find(frame => frame !== page.mainFrame() && frame.url().startsWith(`${base}/specter-desktop/`));
  assert(appFrame, 'Could not find the upstream Flask page frame');
  const response = await appFrame.goto(`${base}/specter-desktop/app/spc/devices/new_device_manual/`, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `The upstream manual device route failed: HTTP ${response?.status()}`);
  await appFrame.locator('qr-scanner').waitFor({ timeout: 15000 });
  const scannerReady = await appFrame.evaluate(() => ({
    defined: Boolean(customElements.get('qr-scanner')),
    scanner: document.querySelector('qr-scanner'),
    sources: [...(document.querySelector('qr-scanner')?.shadowRoot?.querySelectorAll('button') || [])].map(button => button.textContent.trim()),
  }));
  assert(scannerReady.defined && scannerReady.scanner, 'The real upstream scanner custom element was not loaded by its normal route');
  assert(scannerReady.sources.includes('Use camera') && scannerReady.sources.includes('Scan from Specter DIY'), 'The upstream QR scanner does not offer both camera and DIY frame sources');

  const actualParser = await appFrame.evaluate(() => new Promise(resolve => {
    const scanner = document.querySelector('qr-scanner');
    scanner.addEventListener('scan', event => resolve(event.detail.result), { once: true });
    scanner.shadowRoot.getElementById('diy-choice').click();
    scanner.receiveFrame('p1of2 SPEC');
    scanner.receiveFrame('p2of2 TER');
  }));
  assert(actualParser === 'SPECTER', 'Animated legacy QR frames did not reach Specter Desktop\'s upstream partial-frame parser');

  const qrSource = await appFrame.evaluate(async () => {
    const component = document.createElement('qr-code');
    component.id = 'diy-bridge-qr';
    component.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5000';
    component.setAttribute('width', '320');
    component.setAttribute('value', 'specter-desktop-rendered-qr-frame');
    document.body.append(component);
    await new Promise(resolve => setTimeout(resolve, 200));
    const box = component.shadowRoot?.querySelector('.qr-code');
    const rendered = box?.querySelector('img, canvas');
    if (!rendered) return null;
    const canvas = document.createElement('canvas');
    const width = rendered.tagName === 'CANVAS' ? rendered.width : rendered.naturalWidth;
    const height = rendered.tagName === 'CANVAS' ? rendered.height : rendered.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(rendered, 0, 0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height);
    return window.parent.jsQR(pixels.data, width, height)?.data || null;
  });
  assert(qrSource === 'specter-desktop-rendered-qr-frame', `The upstream Desktop QR component did not render a decodable QR image: ${qrSource}`);

  const staticDesktopScan = await appFrame.evaluate(value => new Promise(resolve => {
    const scanner = document.querySelector('qr-scanner');
    scanner.addEventListener('scan', event => resolve(event.detail.result), { once: true });
    scanner.shadowRoot.getElementById('diy-choice').click();
    scanner.receiveFrame(value);
  }), qrSource);
  assert(staticDesktopScan === qrSource, 'Specter Desktop did not pass a decoded static QR through its upstream scanner callback');

  async function startDiyProbe(kind, readyMarker) {
    await page.locator('#diy-app').evaluate((frame, probe) => {
      frame.src = `/?embedded=1&gallery=1&variant=diy&qr-bridge=1&probe=${probe}`;
    }, kind);
    await page.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
    await page.waitForFunction(marker => {
      const log = document.querySelector('#diy-app')?.contentDocument?.querySelector('#debug-log');
      return log?.textContent?.includes(marker);
    }, readyMarker, { timeout: 90000 });
    await page.locator('#diy-scanner-controls').waitFor({ state: 'visible', timeout: 30000 });
  }

  async function createVisibleDesktopQr(value, { animate = false } = {}) {
    await appFrame.evaluate(({ value, animate }) => {
      const component = document.getElementById('diy-bridge-qr');
      component.removeAttribute('animate');
      if (animate) component.setAttribute('animate', 'on');
      component.setAttribute('value', value);
    }, { value, animate });
  }

  async function expectDiyQrPayload(payloadBytes) {
    const expectedHex = Buffer.from(payloadBytes).toString('hex');
    await page.waitForFunction(expected => {
      const log = document.querySelector('#diy-app')?.contentDocument?.querySelector('#debug-log');
      return log?.textContent?.includes(`QR_PROBE_HEX ${expected}`);
    }, expectedHex, { timeout: 90000 });
  }

  const desktopToDiyStatic = 'Specter Desktop to DIY static QR';
  await startDiyProbe('qr', 'QR_PROBE_READY');
  await page.locator('#diy-scanner-controls').waitFor({ state: 'visible' });
  await createVisibleDesktopQr(desktopToDiyStatic);
  await page.locator('[data-diy-source="desktop"]').click();
  await expectDiyQrPayload(Buffer.from(desktopToDiyStatic));
  await page.locator('#diy-scanner-controls').waitFor({ state: 'hidden', timeout: 30000 });

  await startDiyProbe('qr', 'QR_PROBE_READY');
  const psbtBytes = Buffer.concat([Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]), Buffer.from(Array.from({ length: 900 }, (_, index) => (index * 37 + 11) & 0xff))]);
  await createVisibleDesktopQr(`crypto-psbt:${psbtBytes.toString('base64')}`);
  // Point the scanner at the changing source only after it already displays an animated UR.
  // Otherwise the previous static test QR would be the scanner's first frame and close QRHost.
  await page.locator('[data-diy-source="desktop"]').click();
  await expectDiyQrPayload(psbtBytes);
  await page.locator('#diy-scanner-controls').waitFor({ state: 'hidden', timeout: 30000 });

  async function startDesktopDiyScan(expectedText) {
    const resultPromise = appFrame.evaluate(() => new Promise(resolve => {
      const scanner = document.querySelector('qr-scanner');
      scanner.addEventListener('scan', event => resolve(event.detail.result), { once: true });
      scanner.shadowRoot.getElementById('diy-choice').click();
    }));
    return { resultPromise, expectedText };
  }

  async function setDiyOutputProbe(kind) {
    const probe = kind === 'animated' ? 'qr-output-animated' : 'qr-output-static';
    await page.locator('#diy-app').evaluate((frame, name) => {
      frame.src = `/?embedded=1&gallery=1&variant=diy&probe=${name}`;
    }, probe);
    await page.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('#diy-app')?.contentDocument?.querySelector('#debug-log')?.textContent?.includes('DIY_QR_OUTPUT_READY'), null, { timeout: 90000 });
  }

  await setDiyOutputProbe('static');
  let diyToDesktop = await startDesktopDiyScan('Specter DIY static QR frame test');
  assert(await diyToDesktop.resultPromise === diyToDesktop.expectedText, 'Desktop did not scan the static QR rendered by Specter DIY');
  await setDiyOutputProbe('animated');
  diyToDesktop = await startDesktopDiyScan('Specter DIY animated QR frame test:');
  const animatedDesktopResult = await diyToDesktop.resultPromise;
  const expectedAnimatedDiyBytes = Buffer.concat([
    Buffer.from(diyToDesktop.expectedText),
    ...Array.from({ length: 3 }, () => Buffer.from(Array.from({ length: 256 }, (_, index) => index))),
  ]);
  const decodedAnimatedDesktopBytes = Buffer.from(animatedDesktopResult, 'base64');
  assert(decodedAnimatedDesktopBytes.equals(expectedAnimatedDiyBytes), `Desktop animated QR mismatch: result=${JSON.stringify(animatedDesktopResult.slice(0, 96))}, actualBytes=${decodedAnimatedDesktopBytes.length}, expectedBytes=${expectedAnimatedDiyBytes.length}, actualPrefix=${decodedAnimatedDesktopBytes.subarray(0, 48).toString('hex')}, expectedPrefix=${expectedAnimatedDiyBytes.subarray(0, 48).toString('hex')}`);

  const diyRuntimeFrame = page.frames().find(frame => frame.url().includes('variant=diy'));
  assert(diyRuntimeFrame, 'The running Specter DIY simulator frame was not found');
  await diyRuntimeFrame.evaluate(() => {
    window.__specterCableRequests = [];
    window.addEventListener('message', event => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'peripheral-command') return;
      if (event.data.command?.type !== 'usb-data') return;
      const request = new TextDecoder().decode(new Uint8Array(event.data.command.bytes));
      const command = request.split(/\r?\n/).filter(Boolean).at(-1) || '';
      window.__specterCableRequests.push(request);
      if (command !== 'fingerprint') return;
      event.stopImmediatePropagation();
      parent.postMessage({ type: 'simulator-usb-output', variant: 'diy',
        bytes: new TextEncoder().encode('ACK\r\ndeadbeef\r\n') }, location.origin);
    }, true);
    parent.postMessage({ type: 'simulator-usb-state', variant: 'diy', enabled: true }, location.origin);
  });
  await page.evaluate(() => {
    window.__specterCableMessages = [];
    window.addEventListener('message', event => {
      if (/usb|cable/i.test(event.data?.type || '')) window.__specterCableMessages.push(event.data.type);
    });
  });
  await page.waitForFunction(() => {
    const toggle = document.querySelector('#cable-toggle');
    return toggle && !toggle.disabled;
  }, null, { timeout: 30000 });
  await page.locator('#cable-toggle').check();
  await page.locator('.cable-panel.connected').waitFor({ state: 'visible', timeout: 10000 });
  assert(await appFrame.evaluate(() => window.hwi?.url) === '/specter-desktop/hwi/api/', 'Specter Desktop HWI requests are not routed through the browser WSGI bridge');
  await appFrame.evaluate(() => {
    window.__desktopCableEnumeration = window.hwi.enumerate('', false);
  });
  const cableEnumeration = await appFrame.evaluate(async () => await window.__desktopCableEnumeration);
  assert(cableEnumeration.some(device => device.type === 'specter' && device.fingerprint === 'deadbeef'), `Specter Desktop did not discover the DIY over USB: ${JSON.stringify(cableEnumeration)}`);
  const usbRequest = await diyRuntimeFrame.evaluate(() => window.__specterCableRequests[0] || '');
  assert(usbRequest.split(/\r?\n/).filter(Boolean).at(-1) === 'fingerprint', `Specter Desktop did not send the expected fingerprint query over USB: ${JSON.stringify(usbRequest)}`);

  const secretBefore = await page.evaluate(() => localStorage.getItem('specter-desktop-browser-secret'));
  const databaseNamesBefore = await page.evaluate(async () => (await indexedDB.databases?.() || []).map(db => db.name));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#diy-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 90000 });
  await page.locator('#desktop-status').getByText('Running locally', { exact: true }).waitFor({ timeout: 360000 });
  await page.waitForFunction(() => document.querySelector('#desktop-app')?.contentDocument?.title === 'Specter', null, { timeout: 120000 });
  const secretAfter = await page.evaluate(() => localStorage.getItem('specter-desktop-browser-secret'));
  assert(secretBefore && secretAfter === secretBefore, 'Browser session key did not survive an ordinary reload');
  const databaseNamesAfter = await page.evaluate(async () => (await indexedDB.databases?.() || []).map(db => db.name));
  assert(databaseNamesBefore.length > 0 && databaseNamesAfter.some(name => databaseNamesBefore.includes(name)), 'Desktop filesystem database did not persist after reload');
  await page.locator('#desktop-reset').click();
  await page.locator('#desktop-status').getByText('Desktop data reset', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#desktop-app')?.contentDocument?.title === 'Specter', null, { timeout: 60000 });
  const secretAfterReset = await page.evaluate(() => localStorage.getItem('specter-desktop-browser-secret'));
  assert(secretAfterReset && secretAfterReset !== secretBefore, 'Reset did not rotate the browser session key');

  for (const hostname of externalHosts) {
    assert(['cdn.jsdelivr.net', 'pypi.org', 'files.pythonhosted.org'].includes(hostname), `Unexpected network destination while running Desktop: ${hostname}`);
  }
  assert(!requests.some(url => /localhost|127\.0\.0\.1:(?:8332|25441)|\/rpc\//i.test(url)), 'Wallet or RPC data leaked to a localhost/external node endpoint');
  assert(!consoleErrors.some(error => /livereload|localhost:35729/i.test(error)), 'The upstream debug server attempted to connect to localhost');

  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/specter-desktop-diy.png', fullPage: true });
  console.log(`Verified Specter Desktop ${provenance.pointer.commit} with real Flask routes, QR parser, and DIY ${diyManifest.commit}`);
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/specter-desktop-diy-failure.png', fullPage: true }).catch(() => {});
  console.error(JSON.stringify({
    diyRunning,
    desktopReady,
    url: page.url(),
    status: {
      desktop: await page.locator('#desktop-status').textContent().catch(() => null),
      diy: await page.locator('#diy-status').textContent().catch(() => null),
      detail: await page.locator('#loader-detail').textContent().catch(() => null),
      diyLog: await page.locator('#diy-app').evaluate(frame => frame.contentDocument?.querySelector('#debug-log')?.textContent?.slice(-2000)).catch(() => null),
      diyScan: await page.locator('#diy-scan-status').textContent().catch(() => null),
      iframe: await page.locator('#desktop-app').evaluate(frame => ({ src: frame.src, hidden: frame.hidden, readyState: frame.contentDocument?.readyState, title: frame.contentDocument?.title, text: frame.contentDocument?.body?.innerText?.slice(0, 400) })).catch(error => String(error)),
      frames: page.frames().map(frame => frame.url()),
    },
    externalHosts: [...externalHosts],
    failedRequests,
    hwiResponses,
    hwiRequests: requests.filter(url => /hwi\/api/i.test(url)),
    cableMessages: await page.evaluate(() => window.__specterCableMessages || []).catch(() => []),
    desktopNavigations,
    consoleErrors,
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}
