import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });
const requests = [];
const errors = [];
page.on('request', request => requests.push(request.url()));
page.on('pageerror', error => errors.push(error.message));
await page.goto(`${base}/simulators/`);
for (const [name, title, subtitle] of [
  ['diy', 'Specter DIY', null],
  ['play', 'Playground', 'Specter 3.0 Draft Marco'],
  ['schnuartz', 'Alternative Playground', 'Specter 3.0 Draft Schnuartz'],
]) {
  const device = page.locator(`[data-device="${name}"]`);
  if (await device.locator('h2').textContent() !== title ||
      (subtitle !== null && await device.locator('.subtitle').textContent() !== subtitle)) {
    throw new Error(`${name} simulator label mismatch`);
  }
}
for (const name of ['diy', 'play', 'schnuartz']) {
  await page.locator(`[data-device="${name}"] .device-status`).getByText('Running locally', { exact: false })
    .waitFor({ timeout: 75000 });
  const pointerPath = name === 'diy' ? '/browser/current.json' :
    name === 'play' ? '/browser/variants/specter-playground.json' :
    '/browser/variants/specter-playground-schnuartz.json';
  const pointer = await (await page.request.get(`${base}${pointerPath}`)).json();
  const manifest = await (await page.request.get(`${base}${pointer.build}build-info.json`)).json();
  if (name === 'diy' && (!/^\d+\.\d+\.\d+(?:-rc\d+)?$/.test(manifest.firmware_version) ||
      await page.locator('[data-device="diy"] .subtitle').textContent() !==
        `newest v${manifest.firmware_version} Firmware`)) {
    throw new Error('DIY firmware version label is not derived from its build manifest');
  }
  const sourceLink = page.locator(`[data-device="${name}"] .source-link`);
  const expectedLabel = name === 'diy' && manifest.firmware_version
    ? `GitHub · v${manifest.firmware_version}`
    : name === 'schnuartz' ? `GitHub · ${manifest.repository}`
    : `GitHub · ${manifest.commit.slice(0, 7)}`;
  const expectedHref = name === 'schnuartz'
    ? `https://github.com/${manifest.repository}`
    : `https://github.com/${manifest.repository}/commit/${manifest.commit}`;
  if (await sourceLink.textContent() !== expectedLabel ||
      await sourceLink.getAttribute('href') !== expectedHref ||
      await sourceLink.getAttribute('target') !== '_blank') {
    throw new Error(`${name} does not link to its exact firmware commit below Restart`);
  }
  if (!await page.locator(`[data-device="${name}"] .device-shell`)
    .evaluate(img => img.complete && img.naturalWidth > 0)) {
    throw new Error(`${name} Specter Shield Metal device image did not load`);
  }
  const frame = page.frameLocator(`[data-device="${name}"] iframe`);
  await frame.locator('#screen').waitFor();
}
if (await page.locator('.pin-hint').textContent() !== 'A PIN may already be selected: “21”.') {
  throw new Error('PIN hint text mismatch');
}
const switchControl = page.locator('[data-device="schnuartz"] .restart-switch');
if (await switchControl.locator('button').count() !== 2 ||
    await switchControl.locator('[data-schnuartz-mode="normal"]').getAttribute('aria-pressed') !== 'true' ||
    await switchControl.locator('[data-schnuartz-mode="alternative"]').getAttribute('aria-pressed') !== 'false') {
  throw new Error('Schnuartz restart switch is not initialized on the normal build');
}
await switchControl.locator('[data-schnuartz-mode="alternative"]').click();
await page.locator('[data-device="schnuartz"] .device-status').getByText('Running locally', { exact: false })
  .waitFor({ timeout: 75000 });
const alternativePointer = await (await page.request.get(`${base}/browser/variants/specter-playground-schnuartz-alternative.json`)).json();
const alternativeManifest = await (await page.request.get(`${base}${alternativePointer.build}build-info.json`)).json();
const alternativeSource = page.locator('[data-device="schnuartz"] .source-link');
if (await alternativeSource.textContent() !== `GitHub · ${alternativeManifest.commit.slice(0, 7)}` ||
    await alternativeSource.getAttribute('href') !== `https://github.com/${alternativeManifest.repository}/commit/${alternativeManifest.commit}` ||
    await switchControl.locator('[data-schnuartz-mode="alternative"]').getAttribute('aria-pressed') !== 'true') {
  throw new Error('Schnuartz alternative build did not load through the switch');
}
await switchControl.locator('[data-schnuartz-mode="normal"]').click();
await page.locator('[data-device="schnuartz"] .device-status').getByText('Running locally', { exact: false })
  .waitFor({ timeout: 75000 });
const normalPointer = await (await page.request.get(`${base}/browser/variants/specter-playground-schnuartz.json`)).json();
const normalManifest = await (await page.request.get(`${base}${normalPointer.build}build-info.json`)).json();
if (await switchControl.locator('[data-schnuartz-mode="normal"]').getAttribute('aria-pressed') !== 'true' ||
    await page.locator('[data-device="schnuartz"] .source-link').getAttribute('href') !==
      `https://github.com/${normalManifest.repository}`) {
  throw new Error('Schnuartz switch did not return to the normal build');
}
await page.waitForTimeout(1200);
for (const name of ['diy', 'play', 'schnuartz']) {
  const png = PNG.sync.read(await page.frameLocator(`[data-device="${name}"] iframe`).locator('#screen').screenshot());
  const colors = new Set();
  for (let i = 0; i < png.data.length; i += 4) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
  if (colors.size < 12) throw new Error(`${name} Specter display has only ${colors.size} colors`);
}
for (const [name, targets] of [
  ['play', [[.24, .38], [.50, .38], [.75, .38], [.24, .55]]],
  ['schnuartz', [[.94, .03], [.50, .48], [.50, .85]]],
]) {
  const canvas = page.frameLocator(`[data-device="${name}"] iframe`).locator('#screen');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  let changed = false;
  for (const [x, y] of targets) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    await page.waitForTimeout(1600);
    changed = !before.equals(await canvas.screenshot());
    if (changed) break;
  }
  if (!changed) throw new Error(`${name} gallery pointer did not reach LVGL`);
}
await mkdir('test-results', { recursive: true });
await page.screenshot({ path: 'test-results/simulators-three-devices.png', fullPage: true });

async function drag(token, name) {
  const from = await token.boundingBox();
  const to = await page.locator(`[data-device="${name}"] .device-frame`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
}
async function childFiles(name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const iframe = document.querySelector(`[data-device="${name}"] iframe`);
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error('child snapshot timed out')), 15000);
    const listener = event => {
      if (event.source !== iframe.contentWindow || event.data?.requestId !== id ||
          event.data?.type !== 'peripherals-snapshot') return;
      clearTimeout(timer); removeEventListener('message', listener); resolve(event.data.files);
    };
    addEventListener('message', listener);
    iframe.contentWindow.postMessage({ type: 'peripherals-export', requestId: id }, location.origin);
  }), name);
}

await page.locator('#sd-picker').setInputFiles({ name: 'transfer.bin', mimeType: 'application/octet-stream',
  buffer: Buffer.from([0, 1, 2, 255]) });
await page.locator('#sd-files').getByText('transfer.bin', { exact: false }).waitFor();
if (await page.locator('#sd-capacity').count()) throw new Error('Removed shared SD capacity text is visible');
await drag(page.locator('#sd-token'), 'diy');
await page.locator('#sd-location').getByText('Inserted in device 1').waitFor();
const first = await childFiles('diy');
if (!first.some(file => file.path === 'sd/transfer.bin' &&
    Buffer.from(file.bytes).equals(Buffer.from([0, 1, 2, 255])))) throw new Error('SD bytes not in device 1');

await drag(page.locator('[data-slot="1"]'), 'diy');
await page.locator('[data-slot="1"] small').getByText('Inserted in device 1').waitFor();
const cardBefore = await childFiles('diy');
if (!cardBefore.some(file => file.path === 'cards/1/private.key')) throw new Error('Card not in device 1');

await drag(page.locator('#sd-token'), 'play');
await page.locator('#sd-location').getByText('Inserted in device 2').waitFor();
const second = await childFiles('play');
if (!second.some(file => file.path === 'sd/transfer.bin' &&
    Buffer.from(file.bytes).equals(Buffer.from([0, 1, 2, 255])))) throw new Error('SD bytes not transferred to device 2');
if ((await childFiles('diy')).some(file => file.path.startsWith('sd/'))) throw new Error('SD still in device 1');

await drag(page.locator('[data-slot="1"]'), 'play');
await page.locator('[data-slot="1"] small').getByText('Inserted in device 2').waitFor();
const cardAfter = await childFiles('play');
const oldKey = cardBefore.find(file => file.path === 'cards/1/private.key').bytes;
const newKey = cardAfter.find(file => file.path === 'cards/1/private.key')?.bytes;
if (!newKey || !Buffer.from(oldKey).equals(Buffer.from(newKey))) throw new Error('Smartcard key changed in transfer');
if ((await childFiles('diy')).some(file => file.path.startsWith('cards/1/'))) throw new Error('Card still in device 1');

await drag(page.locator('#sd-token'), 'schnuartz');
await page.locator('#sd-location').getByText('Inserted in device 3').waitFor();
await drag(page.locator('[data-slot="1"]'), 'schnuartz');
await page.locator('[data-slot="1"] small').getByText('Inserted in device 3').waitFor();
const third = await childFiles('schnuartz');
if (!third.some(file => file.path === 'sd/transfer.bin') ||
    !third.some(file => file.path === 'cards/1/private.key')) throw new Error('Media missing from device 3');

await page.locator('[data-slot="1"]').click();
await page.locator('[data-slot="1"] small').getByText('Not inserted').waitFor();
await page.locator('#sd-token').click();
await page.locator('#sd-location').getByText('Not inserted').waitFor();
await page.locator('[data-device="play"] .restart-device').click();
await page.locator('[data-device="play"] .device-status').getByText('Running locally', { exact: false }).waitFor({ timeout: 55000 });
await page.locator('[data-slot="1"]').click();
await page.locator('[data-target="diy"]').click();
await page.locator('[data-slot="1"] small').getByText('Inserted in device 1').waitFor();
page.once('dialog', dialog => dialog.accept());
await page.locator('[data-slot="1"]').click({ button: 'right' });
await page.locator('[data-slot="1"] small').getByText('Not inserted').waitFor();
await drag(page.locator('[data-slot="1"]'), 'diy');
await page.locator('[data-slot="1"] small').getByText('Inserted in device 1').waitFor();
const resetKey = (await childFiles('diy')).find(file => file.path === 'cards/1/private.key')?.bytes;
if (!resetKey || Buffer.from(resetKey).equals(Buffer.from(oldKey))) throw new Error('Right-click did not reset card identity');

if (requests.some(url => /\/api\/(allocate|heartbeat)|\/novnc\//.test(url))) {
  throw new Error('Three-device mode requested VNC or session API');
}
const cardBackground = await page.locator('[data-device="play"]').evaluate(node => getComputedStyle(node).backgroundColor);
const frameBackground = await page.frameLocator('[data-device="play"] iframe').locator('body')
  .evaluate(node => getComputedStyle(node).backgroundColor);
if (cardBackground !== 'rgba(0, 0, 0, 0)' || frameBackground !== 'rgba(0, 0, 0, 0)') {
  throw new Error('Simulator device has an unwanted rectangular background');
}
await page.locator('#feedback-device').selectOption('play');
await page.locator('#feedback-message').fill('The Playground screen does not react after I insert the SD card.');
const feedbackLink = page.locator('#feedback-submit');
const feedbackUrl = new URL(await feedbackLink.getAttribute('href'));
if (await feedbackLink.getAttribute('aria-disabled') !== 'false' ||
    feedbackUrl.origin !== 'https://github.com' ||
    !feedbackUrl.searchParams.get('body')?.includes('K9ert Playground') ||
    !feedbackUrl.searchParams.get('body')?.includes('The Playground screen does not react')) {
  throw new Error('Feedback draft did not become a reviewable GitHub issue');
}
if (errors.length) throw new Error(errors.join('; '));
const legacy = await (await page.request.get(`${base}/simulators/legacy/`)).text();
if (!legacy.includes("import RFB from '/novnc/core/rfb.js'")) throw new Error('Legacy fallback missing');
console.log(JSON.stringify({ result: 'pass', simultaneousWorkers: 3,
  sd: 'one binary card moved through three devices', smartcard: 'same private key moved through three devices',
  restart: 'local', tap: 'card to device', reset: 'right-click changed key',
  feedback: 'draft link with selected firmware source', pointer: 'gallery display to LVGL',
  legacy: 'available' }));
await browser.close();
