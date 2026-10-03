import { createCompanionMedia } from '/browser/companion-media.js';
const $ = selector => document.querySelector(selector);
const origin = location.origin;
const desktopStatus = $('#desktop-status');
const diyStatus = $('#diy-status');
const desktopLoader = $('#desktop-loader');
const desktopFrame = $('#desktop-app');
const diyFrame = $('#diy-app');
const diyScannerControls = $('#diy-scanner-controls');
const diyScanStatus = $('#diy-scan-status');
let desktopWorker;
let diyScannerActive = false;
let diySource = 'none';
let desktopFrameSeen = '';
let diyFrameSeen = '';
let lastDesktopFrameAt = 0;
let lastDiyFrameAt = 0;
let sourceBuildInfo;
let ready = false;
let diyRunning = false;
let diyUsbEnabled = false;
let cableConnected = false;
let pendingCableQuery;
const desktopRuntimeRevision = '2026-10-03.6';

const media = createCompanionMedia({
  container: $('#companion-media'), companionLabel: 'Specter Desktop',
  storageKey: 'clavastack-specter-removable-media-v1', ownersKey: 'specter-desktop-media-state-v1',
  isDiyRunning: () => diyRunning, isCompanionReady: () => ready,
  sendDiyMessage,
  getTargetZone: target => target === 'desktop' ? $('#desktop-drop') : diyFrame.closest('.device-frame'),
  onState: state => desktopFrame.contentWindow?.postMessage({ type: 'specter-media-state', ...state }, origin),
});
const renderMedia = () => media.render();
const notifyDesktopMediaState = () => media.notify();

function setStatus(element, message, state = 'loading') {
  element.textContent = message;
  element.classList.toggle('ready', state === 'ready');
  element.classList.toggle('error', state === 'error');
}

function makeSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadSourceInfo() {
  const pointer = await (await fetch('/browser/specter-desktop-current.json', { cache: 'no-store' })).json();
  if (!/^[a-f0-9]{40}$/.test(pointer.commit) || !pointer.build.includes(pointer.commit)) {
    throw new Error('The Desktop source pointer is invalid');
  }
  const base = pointer.build;
  const info = await (await fetch(`${base}build-info.json`, { cache: 'no-store' })).json();
  if (info.repository !== 'cryptoadvance/specter-desktop' || info.commit !== pointer.commit ||
      info.source_archive?.sha256?.length !== 64) {
    throw new Error('Specter Desktop source provenance did not verify');
  }
  sourceBuildInfo = { ...info, sourceUrl: `${base}${info.source_archive.path}` };
  const repository = $('#desktop-repository');
  repository.href = `https://github.com/${info.repository}`;
  repository.textContent = info.repository;
  const commit = $('#desktop-commit');
  commit.href = info.source_url;
  commit.textContent = info.commit;
  $('#desktop-built-at').textContent = `Built: ${info.built_at} · Source archive SHA-256: ${info.source_archive.sha256}`;

  const diyPointer = await (await fetch('/browser/current.json', { cache: 'no-store' })).json();
  const diyInfo = await (await fetch(`${diyPointer.build}build-info.json`, { cache: 'no-store' })).json();
  const diyRepository = $('#diy-repository');
  diyRepository.href = `https://github.com/${diyInfo.repository}`;
  diyRepository.textContent = diyInfo.repository;
  const diyCommit = $('#diy-commit');
  diyCommit.href = `https://github.com/${diyInfo.repository}/commit/${diyInfo.commit}`;
  diyCommit.textContent = diyInfo.commit;
  $('#diy-built-at').textContent = `Built: ${diyInfo.build_timestamp || diyInfo.built_at || 'see firmware manifest'} · Emscripten ${diyInfo.emscripten_version || '3.1.74'}`;
  $('#diy-source-link').href = diyCommit.href;
  $('#diy-source-link').textContent = `GitHub · ${diyInfo.commit.slice(0, 9)}`;
  $('#diy-build-label').textContent = `Upstream ${diyInfo.firmware_version ? `v${diyInfo.firmware_version}` : diyInfo.commit.slice(0, 9)}`;
  return diyInfo;
}

function startRuntime() {
  desktopWorker = new Worker(`/specter-desktop/runtime-worker.js?v=${desktopRuntimeRevision}`, { name: 'Specter Desktop · CPython WASM' });
  desktopWorker.addEventListener('message', event => {
    const data = event.data;
    if (data.type === 'progress') {
      $('#loader-detail').textContent = data.label;
      $('#loader-progress').style.width = `${data.progress}%`;
      setStatus(desktopStatus, 'Starting upstream app…');
    } else if (data.type === 'ready') {
      ready = true;
      $('#loader-progress').style.width = '100%';
      $('#loader-title').textContent = `Upstream Flask app ready · ${data.routeCount} routes`;
      $('#loader-detail').textContent = `${data.runtime} · ${data.sourceCommit}`;
      desktopLoader.hidden = true;
      desktopFrame.hidden = false;
      desktopFrame.src = '/specter-desktop/app/spc/welcome/';
      setStatus(desktopStatus, 'Running locally', 'ready');
      renderMedia();
      updateCableState();
      setTimeout(() => desktopFrame.contentWindow?.focus(), 1500);
    } else if (data.type === 'reset-complete') {
      setStatus(desktopStatus, 'Desktop data reset', 'ready');
      desktopFrame.src = `/specter-desktop/app/spc/welcome/?reset=${Date.now()}`;
    } else if (data.type === 'error') {
      $('#loader-title').textContent = 'Specter Desktop could not start';
      $('#loader-detail').textContent = data.error;
      $('#loader-detail').classList.add('error-text');
      setStatus(desktopStatus, 'Startup failed', 'error');
      ready = false;
      renderMedia();
      updateCableState();
    } else if (data.type === 'cable-query') {
      queueCableQuery(data);
    }
  });
  desktopWorker.addEventListener('error', event => {
    setStatus(desktopStatus, 'Browser worker failed', 'error');
    $('#loader-title').textContent = 'Specter Desktop browser worker failed';
    $('#loader-detail').textContent = event.message || 'The browser worker stopped unexpectedly.';
  });
}

async function startBridge() {
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support the request bridge required by Specter Desktop');
  await navigator.serviceWorker.register('/specter-desktop/service-worker.js', { scope: '/specter-desktop/', updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Browser request bridge did not take control of this page')), 10000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
      if (registration.active && navigator.serviceWorker.controller) { clearTimeout(timeout); resolve(); }
    });
  }
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'specter-session-cookies' && event.ports[0]) {
      for (const cookie of event.data.cookies || []) document.cookie = cookie;
      event.ports[0].postMessage({ ok: true });
      event.ports[0].close();
      return;
    }
    if (event.data?.type !== 'specter-wsgi-request' || !event.ports[0]) return;
    const channel = event.ports[0];
    const request = event.data.request;
    const sessionCookie = document.cookie.split(';').map(value => value.trim())
      .find(value => value.startsWith('session='));
    if (sessionCookie) request.headers.Cookie = sessionCookie;
    desktopWorker.postMessage({ type: 'request', request },
      request.body?.byteLength ? [channel, request.body] : [channel]);
  });
  return registration;
}

function sendDiyMessage(message) {
  diyFrame.contentWindow?.postMessage(message, origin);
}

function updateCableState() {
  const toggle = $('#cable-toggle');
  const panel = document.querySelector('.cable-panel');
  const status = $('#cable-status');
  const supported = crossOriginIsolated && typeof SharedArrayBuffer === 'function';
  const available = Boolean(diyUsbEnabled && diyRunning && ready && supported);
  const waitingFor = [
    !supported && 'an isolated browser context',
    !ready && 'Specter Desktop to finish starting',
    !diyRunning && 'Specter DIY to finish starting',
    !diyUsbEnabled && 'USB communication to be enabled in Specter DIY',
  ].filter(Boolean);
  const connected = Boolean(toggle.checked && available);
  panel.classList.toggle('connected', connected);
  panel.classList.toggle('armed', Boolean(toggle.checked && !available));
  status.textContent = connected ? 'Cable connected.' : toggle.checked
    ? `Cable is on; waiting for ${waitingFor.join(', ')}.` : 'Cable is off.';
  toggle.title = connected ? 'Disconnect the virtual USB cable.' : toggle.checked
    ? `Cable is on; waiting for ${waitingFor.join(', ')}.`
    : 'Connect Specter DIY and Specter Desktop.';
  toggle.setAttribute('aria-label', connected ? 'Cable connection on'
    : toggle.checked ? `Cable connection on, waiting for ${waitingFor.join(', ')}`
      : 'Cable connection off');
  if (connected !== cableConnected) {
    cableConnected = connected;
    desktopWorker?.postMessage({ type: 'cable-state', connected });
    if (!connected) finishCableQuery(null, new Error('The virtual USB cable was disconnected.'));
  }
}

$('#cable-toggle').addEventListener('change', updateCableState);

function findCrLf(bytes, start = 0) {
  for (let index = start; index + 1 < bytes.length; index++) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

function finishCableQuery(response, error) {
  const pending = pendingCableQuery;
  if (!pending) return;
  if (!error && response.length > pending.capacity) error = new Error('USB response exceeded the browser cable buffer.');
  pendingCableQuery = null;
  clearTimeout(pending.timer);
  const control = new Int32Array(pending.shared, 0, 4);
  if (error) {
    const message = new TextEncoder().encode(String(error.message || error));
    new Uint8Array(pending.shared, 16, message.length).set(message);
    Atomics.store(control, 1, message.length);
    Atomics.store(control, 0, -1);
  } else {
    new Uint8Array(pending.shared, 16, response.length).set(response);
    Atomics.store(control, 1, response.length);
    Atomics.store(control, 0, 1);
  }
  Atomics.notify(control, 0);
}

function queueCableQuery(data) {
  if (pendingCableQuery) {
    finishCableQuery(null, new Error('Another USB command is already in progress.'));
  }
  if (!cableConnected || !diyUsbEnabled || !diyRunning) {
    const shared = data.shared;
    const control = new Int32Array(shared, 0, 4);
    const message = new TextEncoder().encode('The virtual USB cable is not connected.');
    new Uint8Array(shared, 16, message.length).set(message);
    Atomics.store(control, 1, message.length);
    Atomics.store(control, 0, -1);
    Atomics.notify(control, 0);
    return;
  }
  const pending = {
    shared: data.shared,
    capacity: data.capacity,
    chunks: [],
    timer: setTimeout(() => finishCableQuery(null, new Error('Specter DIY did not answer the USB command in time.')), data.timeoutMs || 300000),
  };
  pendingCableQuery = pending;
  const bytes = base64ToBytes(data.bytes);
  sendDiyMessage({ type: 'peripheral-command', command: { type: 'usb-data', bytes: bytes.buffer } });
}

function receiveCableBytes(value) {
  const pending = pendingCableQuery;
  if (!pending) return;
  const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
  pending.chunks.push(chunk.slice());
  const size = pending.chunks.reduce((total, part) => total + part.length, 0);
  if (size > pending.capacity) {
    finishCableQuery(null, new Error('USB response exceeded the browser cable buffer.'));
    return;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of pending.chunks) { bytes.set(part, offset); offset += part.length; }
  const ackEnd = findCrLf(bytes);
  if (ackEnd < 0) return;
  const ack = new TextDecoder().decode(bytes.subarray(0, ackEnd));
  if (ack !== 'ACK') {
    finishCableQuery(null, new Error(`Specter DIY did not acknowledge USB input: ${ack || 'empty response'}`));
    return;
  }
  const responseEnd = findCrLf(bytes, ackEnd + 2);
  if (responseEnd < 0) return;
  finishCableQuery(bytes.slice(0, responseEnd + 2));
}

function decodeCanvas(canvas) {
  if (!canvas || canvas.width < 32 || canvas.height < 32 || !window.jsQR) return null;
  try {
    const context = scratchCanvas.getContext('2d', { willReadFrequently: true });
    scratchCanvas.width = canvas.width;
    scratchCanvas.height = canvas.height;
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
  } catch {
    return null;
  }
}

const scratchCanvas = document.createElement('canvas');

function captureDesktopQr() {
  try {
    const document = desktopFrame.contentDocument;
    if (!document) return null;
    for (const element of document.querySelectorAll('qr-code')) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40 || getComputedStyle(element).visibility === 'hidden') continue;
      const codeBox = element.shadowRoot?.querySelector('.qr-code');
      const canvas = codeBox?.querySelector('canvas');
      if (canvas) {
        const decoded = decodeCanvas(canvas);
        if (decoded?.data) return decoded.data;
      }
      const image = codeBox?.querySelector('img');
      if (image?.complete && image.naturalWidth > 0) {
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = image.naturalWidth;
        imageCanvas.height = image.naturalHeight;
        const context = imageCanvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
        const decoded = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
        if (decoded?.data) return decoded.data;
      }
    }
  } catch {
    // The desktop document may be between upstream route navigations.
  }
  return null;
}

function captureDiyQr() {
  try {
    const canvas = diyFrame.contentDocument?.querySelector('#screen');
    return decodeCanvas(canvas)?.data || null;
  } catch {
    return null;
  }
}

setInterval(() => {
  if (diyScannerActive && diySource === 'desktop') {
    const frame = captureDesktopQr();
    const now = performance.now();
    if (frame && (frame !== desktopFrameSeen || now - lastDesktopFrameAt > 1200) && now - lastDesktopFrameAt > 175) {
      desktopFrameSeen = frame;
      lastDesktopFrameAt = now;
      sendDiyMessage({ type: 'simulator-inject-qr', frame, requestId: `desktop-${Math.round(now)}` });
      diyScanStatus.textContent = frame.startsWith('ur:') || frame.startsWith('UR:')
        ? 'Reading a Specter Desktop animated UR frame…' : 'Reading the QR frame displayed by Specter Desktop…';
    }
  }
  if (document.activeElement !== diyFrame && !desktopFrame.hidden) {
    const scanners = [...(desktopFrame.contentDocument?.querySelectorAll('qr-scanner[open][data-scan-source="diy"]') || [])];
    if (scanners.length) {
      const frame = captureDiyQr();
      const now = performance.now();
      if (frame && (frame !== diyFrameSeen || now - lastDiyFrameAt > 1200) && now - lastDiyFrameAt > 175) {
        diyFrameSeen = frame;
        lastDiyFrameAt = now;
        for (const scanner of scanners) scanner.receiveFrame(frame);
      }
    }
  }
}, 90);

window.addEventListener('message', event => {
  if (event.origin !== origin || !event.data) return;
  if (event.source === diyFrame.contentWindow) {
    const data = event.data;
    if (media.handleDiyMessage(data)) {
      if (data.type === 'child-awaiting-peripherals') setStatus(diyStatus, 'Starting real firmware…');
    } else if (data.type === 'simulator-restarting') {
      diyRunning = false;
      diyUsbEnabled = false;
      setStatus(diyStatus, 'Restarting locally…');
      updateCableState();
    } else if (data.type === 'simulator-running') {
      diyRunning = true;
      setStatus(diyStatus, 'Running locally', 'ready');
      renderMedia();
      updateCableState();
    } else if (data.type === 'simulator-error') {
      diyRunning = false;
      diyUsbEnabled = false;
      setStatus(diyStatus, 'Firmware error', 'error');
      renderMedia();
      updateCableState();
    } else if (data.type === 'simulator-usb-state') {
      diyUsbEnabled = Boolean(data.enabled);
      updateCableState();
    } else if (data.type === 'simulator-usb-output') {
      receiveCableBytes(data.bytes);
    } else if (data.type === 'simulator-scanner-state') {
      diyScannerActive = Boolean(data.active);
      diyScannerControls.hidden = !diyScannerActive;
      if (diyScannerActive) {
        diySource = 'none';
        diyFrameSeen = '';
        diyScanStatus.textContent = 'Select camera or scan from Specter Desktop.';
        document.querySelectorAll('[data-diy-source]').forEach(button => button.setAttribute('aria-pressed', 'false'));
      } else {
        diySource = 'none';
      }
    } else if (data.type === 'simulator-qr-result') {
      if (!data.ok && diyScannerActive && diySource === 'desktop') diyScanStatus.textContent = data.message;
    }
    return;
  }
  if (event.source === desktopFrame.contentWindow) {
    const data = event.data;
    if (data.type === 'simulator-diy-scan') {
      desktopFrame.dataset.qrSource = 'diy';
    } else { media.handleCompanionMessage(data, message => desktopFrame.contentWindow.postMessage(message, origin)); }
  }
});

document.querySelectorAll('[data-diy-source]').forEach(button => {
  button.addEventListener('click', () => {
    if (!diyScannerActive) return;
    diySource = button.dataset.diySource;
    desktopFrameSeen = '';
    lastDesktopFrameAt = 0;
    document.querySelectorAll('[data-diy-source]').forEach(choice => {
      choice.setAttribute('aria-pressed', String(choice === button));
    });
    sendDiyMessage({ type: 'simulator-qr-source', source: diySource });
    diyScanStatus.textContent = diySource === 'camera'
      ? 'The firmware scanner will use your selected camera.'
      : 'Pointing the firmware scanner at the QR frame rendered by Specter Desktop.';
  });
});

$('#desktop-reset').addEventListener('click', () => {
  if (!ready) return;
  const secret = makeSecret();
  localStorage.setItem('specter-desktop-browser-secret', secret);
  document.cookie = 'session=; Max-Age=0; Path=/specter-desktop; SameSite=Lax';
  setStatus(desktopStatus, 'Resetting browser data…');
  desktopWorker.postMessage({ type: 'reset', secret });
});

$('#diy-restart').addEventListener('click', () => {
  if (!diyRunning) return;
  diyRunning = false;
  diyUsbEnabled = false;
  setStatus(diyStatus, 'Restarting firmware…');
  updateCableState();
  renderMedia();
  sendDiyMessage({ type: 'runtime-restart' });
});

async function boot() {
  try {
    const diyInfo = await loadSourceInfo();
    await media.init();
    diyFrame.addEventListener('load', () => {
      sendDiyMessage({ type: 'gallery-parent-ready' });
    });
    diyFrame.src = '/?embedded=1&gallery=1&variant=diy&qr-bridge=1';
    startRuntime();
    await startBridge();
    const secret = localStorage.getItem('specter-desktop-browser-secret') || makeSecret();
    localStorage.setItem('specter-desktop-browser-secret', secret);
    desktopWorker.postMessage({
      type: 'init',
      secret,
      sourceCommit: sourceBuildInfo.commit,
      sourceSha256: sourceBuildInfo.source_archive.sha256,
      sourceUrl: sourceBuildInfo.sourceUrl,
      publicDerivation: sourceBuildInfo.public_derivation,
    });
    $('#diy-build-label').classList.remove('diy-build-loading');
  } catch (error) {
    setStatus(desktopStatus, 'Browser setup failed', 'error');
    $('#loader-title').textContent = 'Specter browser setup failed';
    $('#loader-detail').textContent = error?.stack || String(error);
  }
}

boot();
