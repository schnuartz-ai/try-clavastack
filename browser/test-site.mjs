import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { readFile, mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 850, height: 1000 }, acceptDownloads: true });
const requests = [];
const errors = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
const virtualHost = page.locator('#virtual-host');
if (await virtualHost.locator('summary').textContent().then(text => !text.includes('Connect to Specter Desktop'))) {
  throw new Error('Virtual Host download panel is missing');
}
const virtualHostDownloads = {
  '#virtual-host-download': 'https://github.com/Schnuartz/specter-virtual-host/releases/download/v1.0.4/Specter-Virtual-Host-Windows-x64.exe',
  '#virtual-host-download-linux': 'https://github.com/Schnuartz/specter-virtual-host/releases/download/v1.0.4/Specter-Virtual-Host-Linux-x64',
  '#virtual-host-download-macos-arm64': 'https://github.com/Schnuartz/specter-virtual-host/releases/download/v1.0.4/Specter-Virtual-Host-macOS-arm64',
  '#virtual-host-download-macos-amd64': 'https://github.com/Schnuartz/specter-virtual-host/releases/download/v1.0.4/Specter-Virtual-Host-macOS-x64',
};
for (const [selector, href] of Object.entries(virtualHostDownloads)) {
  if (await page.locator(selector).getAttribute('href') !== href) {
    throw new Error(`Virtual Host download is incorrect: ${selector}`);
  }
}
if (await virtualHost.evaluate(element => element.open)) {
  throw new Error('Virtual Host panel should be collapsed by default');
}
for (const href of Object.values(virtualHostDownloads)) {
  const releaseUrl = new URL(href);
  const filename = releaseUrl.pathname.split('/').pop();
  if (releaseUrl.hostname !== 'github.com' ||
      releaseUrl.pathname !== `/Schnuartz/specter-virtual-host/releases/download/v1.0.4/${filename}` ||
      !/^Specter-Virtual-Host-(Windows-x64\.exe|Linux-x64|macOS-(arm64|x64))$/.test(filename)) {
    throw new Error(`Virtual Host release URL is malformed: ${href}`);
  }
}
if (await page.locator('#sd-capacity').count()) throw new Error('Removed SD capacity text is visible');
const mainPointer = await (await page.request.get(`${base}/browser/current.json`)).json();
const mainManifest = await (await page.request.get(`${base}${mainPointer.build}build-info.json`)).json();
const sourceLink = page.locator('#source-commit-link');
const expectedRepositoryUrl = `https://github.com/${mainManifest.repository}`;
if (!(await sourceLink.textContent()).startsWith('GitHub') ||
    await sourceLink.getAttribute('href') !== expectedRepositoryUrl) {
  throw new Error('Main page does not link to its firmware repository below Restart');
}
if (!await page.locator('.phone-mockup').evaluate(img => img.complete && img.naturalWidth > 0)) {
  throw new Error('Specter Shield Metal device image did not load');
}
const isolated = await page.evaluate(() => crossOriginIsolated);
if (base.startsWith('https:') && !isolated) throw new Error('HTTPS simulator is not cross-origin isolated');
const canvas = page.locator('#screen');
const before = await canvas.screenshot({ path: 'test-results/specter-screen.png' });
const png = PNG.sync.read(before);
const colors = new Set();
for (let i = 0; i < png.data.length; i += 4) {
  colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
}
if (colors.size < 12) throw new Error(`Specter canvas has only ${colors.size} colors`);
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width * 0.17, box.y + box.height * 0.35);
await page.waitForTimeout(700);
const after = await canvas.screenshot();
if (before.equals(after)) throw new Error('Pointer input did not change the Specter screen');

await page.locator('#sd-toggle').click();
await page.locator('#sd-state').getByText('Inserted').waitFor();
if (await page.locator('#sd-hint').textContent() !== 'Click to remove' ||
    await page.locator('#sd-toggle').getAttribute('aria-pressed') !== 'true') {
  throw new Error('SD card image did not switch to the inserted state');
}
await page.locator('#sd-picker').setInputFiles([
  { name: 'probe.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 255]) },
  { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('second file') },
]);
await page.locator('#sd-files').getByText('probe.bin', { exact: false }).waitFor();
await page.locator('#sd-files').getByText('second.txt', { exact: false }).waitFor();
await page.evaluate(() => {
  const clipboard = new DataTransfer();
  clipboard.items.add(new File(['pasted one'], 'pasted-one.txt', { type: 'text/plain' }));
  clipboard.items.add(new File(['pasted two'], 'pasted-two.txt', { type: 'text/plain' }));
  dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
});
await page.locator('#sd-files').getByText('pasted-one.txt', { exact: false }).waitFor();
await page.locator('#sd-files').getByText('pasted-two.txt', { exact: false }).waitFor();
const probeDownload = page.locator('#sd-files li').filter({ hasText: 'probe.bin' })
  .getByRole('button', { name: 'Download', exact: true });
if (!(await probeDownload.getAttribute('title')).includes('(4 B)')) {
  throw new Error('Download tooltip does not expose the file size');
}
const downloadPromise = page.waitForEvent('download');
await probeDownload.click();
const download = await downloadPromise;
if (!(await readFile(await download.path())).equals(Buffer.from([0, 1, 2, 255]))) {
  throw new Error('Virtual SD export bytes differ from imported bytes');
}
await page.locator('#sd-toggle').click();
await page.locator('#sd-state').getByText('Ejected').waitFor();
if (await page.locator('#sd-hint').textContent() !== 'Click to insert' ||
    await page.locator('#sd-toggle').getAttribute('aria-pressed') !== 'false') {
  throw new Error('SD card image did not switch to the ejected state');
}
await page.locator('#sd-toggle').click();
await page.locator('#sd-state').getByText('Inserted').waitFor();

const previousCanvas = await canvas.elementHandle();
await page.locator('#restart-btn').click();
await page.waitForFunction(previous => document.querySelector('#screen') !== previous,
  previousCanvas, { timeout: 10000 });
await page.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
await previousCanvas.dispose();
if (await sourceLink.getAttribute('href') !== expectedRepositoryUrl) {
  throw new Error('Repository link changed after local restart');
}
await page.locator('#sd-state').getByText('Inserted').waitFor();
await page.locator('#sd-files').getByText('probe.bin', { exact: false }).waitFor();
await canvas.screenshot({ path: 'test-results/specter-after-restart.png' });
if (requests.some(url => /\/api\/(allocate|heartbeat)|\/novnc\//.test(url))) {
  throw new Error('Browser mode requested legacy VNC/session infrastructure');
}
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);

const probe = await page.evaluate(async () => {
  const { build, version } = await (await fetch('/browser/current.json')).json();
  return new Promise((resolve, reject) => {
    const worker = new Worker('/browser/runtime-worker.js');
    const canvas = new OffscreenCanvas(480, 800);
    const logs = [];
    let written;
    let checkingAtomicImport = false;
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(logs.join('\n'))); }, 10000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'log') logs.push(data.message);
      if (data.type === 'abort') { clearTimeout(timer); worker.terminate(); reject(new Error(data.message)); }
      if (data.type === 'log' && data.message === 'SD_PROBE_WRITTEN') {
        worker.postMessage({ type: 'snapshot', requestId: 1 });
      }
      if (data.type === 'snapshot' && data.requestId === 1) {
        const file = data.files.find(file => file.path === 'sd/written-by-specter.txt');
        written = file ? new TextDecoder().decode(file.bytes) : null;
        checkingAtomicImport = true;
        worker.postMessage({ type: 'state-import', files: [
          { path: 'sd/must-not-be-partial.bin', bytes: new Uint8Array([1]) },
          { path: 'invalid/outside.bin', bytes: new Uint8Array([2]) },
        ] });
      }
      if (data.type === 'operation-error' && checkingAtomicImport) {
        checkingAtomicImport = false;
        worker.postMessage({ type: 'snapshot', requestId: 2 });
      }
      if (data.type === 'snapshot' && data.requestId === 2) {
        const partial = data.files.some(file => file.path === 'sd/must-not-be-partial.bin');
        clearTimeout(timer); worker.terminate();
        resolve({ logs, written, partial });
      }
    };
    worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(new Error(error.message)); };
    worker.postMessage({ type: 'start', build, version, canvas, sdInserted: true, sdProbe: true,
      stateFiles: [{ path: 'sd/probe.bin', bytes: new Uint8Array([0, 1, 2, 255]) }] }, [canvas]);
  });
});
if (!probe.logs.includes('SD_PROBE_PRESENT True') ||
    !probe.logs.some(line => line.includes("b'\\x00\\x01\\x02\\xff'")) ||
    probe.written !== 'firmware-created file' || probe.partial) {
  throw new Error(`Specter SD platform read/write failed: ${probe.logs.join('; ')}`);
}

const usbProbe = await page.evaluate(async () => {
  const { build, version } = await (await fetch('/browser/current.json')).json();
  return new Promise((resolve, reject) => {
    const worker = new Worker('/browser/runtime-worker.js');
    const canvas = new OffscreenCanvas(480, 800);
    const logs = [];
    let enabled = false;
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(logs.join('\n'))); }, 10000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'log') logs.push(data.message);
      if (data.type === 'usb-state') enabled = data.enabled;
      if (data.type === 'usb-output') {
        clearTimeout(timer);
        worker.terminate();
        resolve({ logs, enabled, output: new TextDecoder().decode(data.bytes) });
      }
      if (data.type === 'abort' || data.type === 'worker-error') {
        clearTimeout(timer); worker.terminate(); reject(new Error(data.message));
      }
    };
    worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(new Error(error.message)); };
    worker.postMessage({ type: 'start', build, version, canvas, usbProbe: true }, [canvas]);
    const bytes = new TextEncoder().encode('virtual-host-probe');
    worker.postMessage({ type: 'usb-data', bytes }, [bytes.buffer]);
  });
});
if (!usbProbe.enabled || usbProbe.output !== 'ACK\r\nvirtual-host-probe\r\n' ||
    !usbProbe.logs.includes('USB_PROBE_DONE')) {
  throw new Error(`Specter USB bridge failed: ${JSON.stringify(usbProbe)}`);
}

const crashPage = await browser.newPage();
await crashPage.route('**/browser/runtime-worker.js*', route => route.abort());
await crashPage.goto(base);
await crashPage.locator('#st').getByText('Simulator error').waitFor({ timeout: 15000 });
if (!await crashPage.locator('[data-loading-actions]').isVisible()) throw new Error('Loading error actions are not visible');
if (!/Elapsed \d+\.\d+ s/.test(await crashPage.locator('[data-loading-timer]').textContent())) throw new Error('Loading timer is missing');
await crashPage.locator('[data-loading-details]').click();
if (!await crashPage.locator('#technical-details').evaluate(details => details.open)) throw new Error('Technical details did not open from loading error');
await crashPage.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mobilePage = await mobile.newPage();
await mobilePage.goto(base);
await mobilePage.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
const mobileCanvas = mobilePage.locator('#screen');
const mobileBefore = await mobileCanvas.screenshot();
const mobileBox = await mobileCanvas.boundingBox();
await mobilePage.touchscreen.tap(mobileBox.x + mobileBox.width * 0.17,
  mobileBox.y + mobileBox.height * 0.35);
await mobilePage.waitForTimeout(700);
if (mobileBefore.equals(await mobileCanvas.screenshot())) {
  throw new Error('Scaled mobile touch did not reach Specter');
}
await mobile.close();

const canvasBridgeMobile = await browser.newContext({ viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const canvasBridgePage = await canvasBridgeMobile.newPage();
await canvasBridgePage.addInitScript(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { value: undefined, configurable: true });
});
await canvasBridgePage.goto(base);
await canvasBridgePage.locator('#st').getByText('Running locally').waitFor({ timeout: 45000 });
await canvasBridgeMobile.close();

console.log(JSON.stringify({ result: 'pass', canvasColors: colors.size,
  crossOriginIsolated: isolated,
  pointer: 'changed Specter screen', sd: 'multi-select/paste/export/restart/Specter platform read+write',
  mobileTouch: 'changed Specter screen', workerCrash: 'handled',
  legacyRequestsInBrowserMode: 0 }, null, 2));
await browser.close();
