const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
if (params.has('legacy')) location.replace('/legacy/');
const embedded = params.get('embedded') === '1' && window.parent !== window;
const gallery = embedded && params.get('gallery') === '1';
const variant = ['diy', 'play', 'schnuartz'].includes(params.get('variant')) ? params.get('variant') : 'diy';
const diagnosticQrProbe = params.get('probe') === 'qr' &&
  ['127.0.0.1', 'localhost', 'try.clavastack.com'].includes(location.hostname);
if (embedded) document.documentElement.classList.add('embedded');
if (gallery) document.documentElement.classList.add('gallery');
const notifyParent = message => { if (embedded) parent.postMessage(message, location.origin); };
const canvasBox = $('#screen-overlay');
const status = $('#st');
const dot = $('#dot');
const loading = $('#loading');
const loadingTitle = loading.querySelector('[data-loading-title]');
const loadingLabel = loading.querySelector('[data-loading-label]');
const loadingBar = loading.querySelector('[data-loading-bar]');
const loadingTimer = loading.querySelector('[data-loading-timer]');
const loadingActions = loading.querySelector('[data-loading-actions]');
const loadingSteps = [...loading.querySelectorAll('[data-loading-step]')];
const debug = $('#debug-log');
const fileList = $('#sd-files');
const picker = $('#sd-picker');
const video = $('#camera-preview');
const screenVideo = $('#camera-screen-video');
const screenCamera = $('#camera-screen');
const cameraSelect = $('#camera-select');
let worker;
let softwareContext;
let softwareFrame;
let build;
let version;
let program = 'wallet';
let stateFiles = [];
let inserted = false;
let activeCard = null;
let cameraStream;
let cameraLoop;
let scannerActive = false;
let scannerStopTimer;
let backupEnabled = false;
let cameraRequest = 0;
let lastQr = '';
let lastQrAt = 0;
let startupTimer;
let requestId = 0;
let workerDependencyCount = null;
let crashRetriesLeft = 2;
let runGeneration = 0;
let restartPromise;
let startupStartedAt;
let startupTicker;
const snapshots = new Map();

const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const startupTimeoutMs = mobileDevice ? 180000 : 90000;

function log(message) {
  debug.textContent = `${String(message)}\n${debug.textContent}`.slice(0, 7000);
}
function setStatus(message, running = false) {
  status.textContent = message;
  dot.classList.toggle('on', running);
}
function clearStartupTimer() {
  if (startupTimer !== undefined) clearTimeout(startupTimer);
  startupTimer = undefined;
}
function stopLoadingClock() {
  if (startupTicker !== undefined) clearInterval(startupTicker);
  startupTicker = undefined;
}
function updateLoadingClock() {
  if (startupStartedAt === undefined) return;
  loadingTimer.textContent = `Elapsed ${((performance.now() - startupStartedAt) / 1000).toFixed(1)} s`;
}
function startLoadingClock() {
  stopLoadingClock();
  startupStartedAt = performance.now();
  updateLoadingClock();
  startupTicker = setInterval(updateLoadingClock, 100);
}
function showLoading(stage = 'runtime', message = 'Preparing the browser runtime…', progress = 12) {
  loading.classList.remove('error');
  loadingTitle.textContent = 'Starting Specter Simulator';
  loadingLabel.textContent = message;
  loadingActions.hidden = true;
  loadingBar.style.width = `${progress}%`;
  loadingBar.parentElement.setAttribute('aria-valuenow', String(progress));
  const order = { runtime: 0, firmware: 1, display: 2 };
  const active = order[stage] ?? 0;
  loadingSteps.forEach((step, index) => {
    step.classList.toggle('active', index === active);
    step.classList.toggle('done', index < active);
  });
  loading.style.display = 'flex';
  startLoadingClock();
}
function showLoadingError(message) {
  stopLoadingClock();
  loading.classList.add('error');
  loadingTitle.textContent = 'Specter could not start';
  loadingLabel.textContent = String(message).split('\n', 1)[0];
  loadingBar.style.width = '100%';
  loadingBar.parentElement.setAttribute('aria-valuenow', '100');
  loadingActions.hidden = false;
  loadingSteps.forEach(step => { step.classList.remove('active'); step.classList.add('done'); });
  loading.style.display = 'flex';
}
function failure(message, generation = runGeneration) {
  if (generation !== runGeneration) return;
  runGeneration++;
  clearStartupTimer();
  stopCamera();
  const failedWorker = worker;
  worker = undefined;
  failedWorker?.terminate();
  setStatus('Simulator error');
  showLoadingError(message);
  log(message);
  notifyParent({ type: 'simulator-error', variant, message });
}
// A worker crash (e.g. an uncaught native-stack RangeError from deep
// recursion in the firmware) kills that worker outright - nothing left to
// send a normal restart message to. Auto-recover a couple of times with a
// fresh worker before giving up and showing the dead-end error UI, so a
// one-off crash doesn't strand the visitor on a page that looks broken.
function crashRecover(message) {
  clearTimeout(startupTimer);
  stopCamera();
  worker?.terminate();
  worker = undefined;
  if (crashRetriesLeft > 0) {
    crashRetriesLeft--;
    log(`${message} - recovering (${crashRetriesLeft} ${crashRetriesLeft === 1 ? 'retry' : 'retries'} left)`);
    setStatus('Recovering…');
    showLoading('runtime', 'Recovering from a worker crash…', 12);
    setTimeout(start, 500);
    return;
  }
  failure(message);
}
function send(message, transfer = []) {
  if (worker) worker.postMessage(message, transfer);
}
function pointer(event, down) {
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.max(0, Math.min(479, Math.floor((event.clientX - rect.left) * 480 / rect.width)));
  const y = Math.max(0, Math.min(799, Math.floor((event.clientY - rect.top) * 800 / rect.height)));
  send({ type: 'pointer', x, y, down });
}
function newCanvas() {
  canvasBox.querySelector('canvas')?.remove();
  const canvas = document.createElement('canvas');
  canvas.id = 'screen';
  canvas.width = 480;
  canvas.height = 800;
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    pointer(event, 1);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.buttons) pointer(event, 2);
  });
  canvas.addEventListener('pointerup', event => pointer(event, 0));
  canvas.addEventListener('pointercancel', event => pointer(event, 0));
  canvasBox.prepend(canvas);
  return canvas;
}
function drawFrame(pixels) {
  if (!softwareContext || pixels.length !== 480 * 800 * 4) return;
  if (!softwareFrame) softwareFrame = softwareContext.createImageData(480, 800);
  const output = softwareFrame.data;
  for (let i = 0; i < pixels.length; i += 4) {
    output[i] = pixels[i + 2];
    output[i + 1] = pixels[i + 1];
    output[i + 2] = pixels[i];
    output[i + 3] = 255;
  }
  softwareContext.putImageData(softwareFrame, 0, 0);
}
function renderFiles(files) {
  fileList.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No files on the virtual card';
    fileList.append(empty);
    return;
  }
  for (const file of files) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${file.path} (${file.size} B)`;
    const download = document.createElement('button');
    download.textContent = 'Download';
    download.title = `Download ${file.path}`;
    download.onclick = () => send({ type: 'sd-export', name: file.path });
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.title = `Delete ${file.path}`;
    remove.onclick = () => send({ type: 'sd-delete', name: file.path });
    row.append(label, download, remove);
    fileList.append(row);
  }
}
function renderCards(slots) {
  const tray = $('#card-slots');
  tray.replaceChildren();
  for (const { slot, initialized } of slots) {
    const row = document.createElement('div');
    row.className = activeCard === slot ? 'inserted' : '';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'smartcard-graphic';
    const label = document.createElement('strong');
    label.textContent = `MemoryCard ${slot}`;
    const cardStatus = document.createElement('small');
    cardStatus.textContent = activeCard === slot ? 'Inserted' : initialized ? 'MemoryCard' : 'Blank';
    card.append(label, cardStatus);
    card.title = `Click to ${activeCard === slot ? 'remove' : 'insert'} card ${slot}; right-click to reset it`;
    card.setAttribute('aria-label', `MemoryCard ${slot}, ${cardStatus.textContent}. Click to ${activeCard === slot ? 'remove' : 'insert'}; right-click to reset.`);
    card.onclick = () => send(activeCard === slot ? { type: 'card-remove' } : { type: 'card-insert', slot });
    card.oncontextmenu = event => {
      event.preventDefault();
      if (confirm(`Reset MemoryCard ${slot}? Its simulated keys and PIN will be wiped.`)) {
        send({ type: 'card-reset', slot });
      }
    };
    const hint = document.createElement('small');
    hint.className = 'card-hint';
    hint.textContent = activeCard === slot ? 'Click to remove' : 'Click to insert';
    row.append(card, hint);
    tray.append(row);
  }
}
function setLoadingMessage(message) {
  loadingLabel.textContent = message;
}
function onWorkerMessage({ data }, generation = runGeneration) {
  if (generation !== runGeneration) return;
  if (data.type === 'loading-progress') {
    workerDependencyCount = data.remaining;
    const steps = data.remaining === 1 ? 'startup step' : 'startup steps';
    setLoadingMessage(data.remaining > 0
      ? `Loading Specter runtime… (${data.remaining} ${steps} remaining)`
      : 'Starting Specter firmware…');
    loadingBar.style.width = data.remaining > 0 ? '28%' : '48%';
    loadingBar.parentElement.setAttribute('aria-valuenow', data.remaining > 0 ? '28' : '48');
    loadingSteps.forEach((step, index) => { step.classList.toggle('active', index === 0); step.classList.toggle('done', false); });
    setStatus('Loading runtime');
  } else if (data.type === 'wasm-ready') {
    setLoadingMessage('Starting Specter firmware…');
    loadingBar.style.width = '48%';
    loadingSteps.forEach((step, index) => { step.classList.toggle('active', index === 1); step.classList.toggle('done', index < 1); });
  } else if (data.type === 'running') {
    clearStartupTimer();
    stopLoadingClock();
    loading.style.display = 'none';
    setStatus('Running locally', true);
    crashRetriesLeft = 2; // a crash long after a healthy boot deserves fresh retries
    send({ type: 'sd-list' });
    send({ type: 'card-list' });
    notifyParent({ type: 'simulator-running', variant });
  } else if (data.type === 'log') {
    log(data.message);
  } else if (data.type === 'debug') {
    if (!data.message.includes('registerOrRemoveHandler')) log(data.message);
  } else if (data.type === 'worker-error') {
    const location = data.filename ? ` (${data.filename}:${data.lineno || 0}:${data.colno || 0})` : '';
    const detail = data.stack ? `${data.message}${location}\n${data.stack}` : `${data.message}${location}`;
    failure(`Worker crashed: ${detail}`, generation);
  } else if (data.type === 'abort') {
    failure(data.message);
  } else if (data.type === 'operation-error') {
    log(`${data.operation}: ${data.message}`);
    if (data.operation.startsWith('sd-')) $('#sd-state').textContent = `SD error: ${data.message}`;
  } else if (data.type === 'sd-state') {
    inserted = data.inserted;
    $('#sd-state').textContent = inserted ? 'Inserted' : 'Ejected';
    $('#sd-toggle').setAttribute('aria-label', inserted ? 'Remove SD card' : 'Insert SD card');
    $('#sd-toggle').setAttribute('aria-pressed', String(inserted));
    $('#sd-toggle').title = inserted ? 'Click to remove SD card' : 'Click to insert SD card';
    $('#sd-hint').textContent = inserted ? 'Click to remove' : 'Click to insert';
    $('#sd-stage').classList.toggle('inserted', inserted);
    notifyParent({ type: 'peripheral-state', variant, sdInserted: inserted, cardSlot: activeCard });
  } else if (data.type === 'sd-list') {
    renderFiles(data.files);
  } else if (data.type === 'sd-file') {
    const blob = new Blob([data.bytes]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = data.name.split('/').pop();
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (data.type === 'card-state') {
    activeCard = data.active;
    renderCards(data.slots);
    notifyParent({ type: 'peripheral-state', variant, sdInserted: inserted, cardSlot: activeCard });
  } else if (data.type === 'frame') {
    drawFrame(data.pixels);
  } else if (data.type === 'snapshot') {
    const resolve = snapshots.get(data.requestId);
    if (resolve) { snapshots.delete(data.requestId); resolve(data.files); }
  } else if (data.type === 'qr-delivered') {
    $('#camera-state').textContent = `QR delivered locally (${data.size} bytes)`;
  } else if (data.type === 'scanner-state') {
    scannerActive = data.active;
    clearTimeout(scannerStopTimer);
    if (scannerActive) {
      log('Specter scanner active');
      screenCamera.hidden = false;
      if (cameraStream) {
        screenVideo.hidden = false;
        screenCamera.classList.add('active');
      } else {
        startCamera();
      }
    } else {
      scannerStopTimer = setTimeout(() => {
        if (scannerActive) return;
        screenCamera.hidden = true;
        screenCamera.classList.remove('active');
        lastQr = '';
        if (!backupEnabled) stopCamera();
      }, 250);
    }
  }
}
async function start() {
  if (!('Worker' in window)) {
    failure('This browser needs Web Workers to run Specter locally.');
    return;
  }
  const canvas = newCanvas();
  const transferable = Boolean(canvas.transferControlToOffscreen);
  if (program === 'mockui' && !transferable) {
    failure('This browser cannot run the Playground LVGL 9 display without OffscreenCanvas. Open the legacy Playground at /simulators/legacy/.');
    const fallback = document.createElement('a');
    fallback.href = '/simulators/legacy/';
    fallback.textContent = 'Open legacy Playground';
    loading.append(fallback);
    return;
  }
  softwareContext = transferable ? undefined : canvas.getContext('2d');
  softwareFrame = undefined;
  if (!transferable && !softwareContext) {
    failure('This browser cannot create a 2D display canvas.');
    return;
  }
  showLoading('runtime', 'Starting Specter on this device…', 12);
  setStatus('Starting locally');
  clearStartupTimer();
  const generation = ++runGeneration;
  const startedAt = performance.now();
  workerDependencyCount = null;
  worker = new Worker('/browser/runtime-worker.js', { name: 'Specter DIY' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = event => crashRecover(`Worker crashed: ${event.message || 'unknown error'}`);
  worker.onmessageerror = () => crashRecover('Worker communication failed');
  startupTimer = setTimeout(() => {
    if (generation !== runGeneration) return;
    const elapsed = Math.round((performance.now() - startedAt) / 1000);
    const detail = workerDependencyCount > 0
      ? `The WebAssembly runtime is still loading (${workerDependencyCount} startup ${workerDependencyCount === 1 ? 'step' : 'steps'} pending).`
      : `The WebAssembly runtime did not report ready after ${elapsed} seconds.`;
    failure(`${detail} The first load can take longer on a mobile connection or a low-memory device.`, generation);
  }, startupTimeoutMs);
  const offscreen = transferable ? canvas.transferControlToOffscreen() : undefined;
  send({ type: 'start', build, version, program, canvas: offscreen, headlessDisplay: !transferable,
    stateFiles, sdInserted: inserted, cardSlot: activeCard, qrProbe: diagnosticQrProbe }, offscreen ? [offscreen] : []);
}
function snapshot(generation = runGeneration) {
  if (!worker || generation !== runGeneration) return Promise.resolve(stateFiles);
  return new Promise(resolve => {
    const id = ++requestId;
    const timeout = setTimeout(() => { snapshots.delete(id); resolve(stateFiles); }, 3000);
    snapshots.set(id, files => {
      clearTimeout(timeout);
      resolve(generation === runGeneration ? files : stateFiles);
    });
    send({ type: 'snapshot', requestId: id });
  });
}
async function restart(factory = false) {
  if (restartPromise) return restartPromise;
  restartPromise = (async () => {
    const generation = runGeneration;
    const previousWorker = worker;
    const files = await snapshot(generation);
    if (generation !== runGeneration) return;
    stateFiles = factory ? files.filter(file => file.path.startsWith('sd/') || file.path.startsWith('cards/')) : files;
    clearStartupTimer();
    runGeneration++;
    worker = undefined;
    previousWorker?.terminate();
    await start();
  })().finally(() => { restartPromise = undefined; });
  return restartPromise;
}
let restoreResolve;
let peripheralRetryTimer;
addEventListener('message', async event => {
  if (!embedded || event.source !== parent || event.origin !== location.origin) return;
  if (gallery && event.data?.type === 'gallery-parent-ready') {
    if (restoreResolve) notifyParent({ type: 'child-awaiting-peripherals', variant });
    if (status.textContent === 'Running locally') notifyParent({ type: 'simulator-running', variant });
  } else if (event.data?.type === 'peripherals-provide' && restoreResolve) {
    clearInterval(peripheralRetryTimer);
    restoreResolve(event.data.files || []);
    restoreResolve = undefined;
  } else if (event.data?.type === 'peripherals-export') {
    notifyParent({ type: 'peripherals-snapshot', variant,
      requestId: event.data.requestId, files: await snapshot() });
  } else if (gallery && event.data?.type === 'peripheral-command') {
    const command = event.data.command;
    if (['sd-insert', 'sd-eject', 'sd-import', 'sd-clear', 'sd-delete', 'card-insert',
      'card-remove', 'card-reset', 'state-import', 'state-remove-prefix'].includes(command?.type)) {
      send(command);
    }
  } else if (gallery && event.data?.type === 'runtime-restart') {
    restart(false).catch(error => failure(`Restart failed: ${error.stack || error}`, runGeneration));
  }
});
function awaitPeripherals() {
  if (!embedded) return Promise.resolve([]);
  return new Promise(resolve => {
    restoreResolve = resolve;
    const announce = () => notifyParent({ type: 'child-awaiting-peripherals', variant });
    announce();
    clearInterval(peripheralRetryTimer);
    peripheralRetryTimer = setInterval(() => {
      if (!restoreResolve) { clearInterval(peripheralRetryTimer); return; }
      announce();
    }, 250);
  });
}
if (embedded) {
  new ResizeObserver(() => notifyParent({ type: 'child-height', height: document.body.scrollHeight })).observe(document.body);
}
async function importFiles(files) {
  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer();
      send({ type: 'sd-import', name: file.name, bytes }, [bytes]);
    } catch (error) {
      $('#sd-state').textContent = `SD import error: ${error}`;
      log(`SD import error: ${error}`);
    }
  }
}
function stopCamera() {
  cameraRequest++;
  cancelAnimationFrame(cameraLoop);
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = undefined;
  video.srcObject = null;
  screenVideo.srcObject = null;
  video.hidden = true;
  screenVideo.hidden = true;
  screenCamera.classList.remove('active');
  $('#camera-toggle').textContent = 'Show backup preview';
  $('#camera-state').textContent = 'Camera off';
}
async function startCamera(deviceId) {
  const request = cameraRequest + 1;
  stopCamera();
  cameraRequest = request;
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#camera-state').textContent = 'Camera unavailable: secure context required';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
    });
    if (request !== cameraRequest) { stream.getTracks().forEach(track => track.stop()); return; }
    cameraStream = stream;
    log('Browser camera opened locally');
    video.srcObject = cameraStream;
    screenVideo.srcObject = cameraStream;
    video.hidden = !backupEnabled;
    screenVideo.hidden = !scannerActive;
    await video.play();
    if (scannerActive) { await screenVideo.play(); screenCamera.classList.add('active'); }
    $('#camera-toggle').textContent = backupEnabled ? 'Hide backup preview' : 'Show backup preview';
    $('#camera-state').textContent = 'Camera active — frames stay on this device';
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    cameraSelect.replaceChildren();
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${cameraSelect.length + 1}`;
      cameraSelect.append(option);
    }
    cameraSelect.hidden = devices.length < 2;
    const current = cameraStream.getVideoTracks()[0].getSettings().deviceId;
    if (current) cameraSelect.value = current;
    scanFrame();
  } catch (error) {
    stopCamera();
    $('#camera-state').textContent = error.name === 'NotAllowedError'
      ? 'Camera permission denied' : `Camera unavailable: ${error.message}`;
    screenCamera.classList.remove('active');
  }
}
const scanCanvas = document.createElement('canvas');
const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
function scanFrame() {
  if (!cameraStream) return;
  if (video.readyState >= 2 && video.videoWidth) {
    const scale = Math.min(1, 640 / video.videoWidth);
    scanCanvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    scanCanvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    scanContext.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const pixels = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
    const qr = window.jsQR?.(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    if (scannerActive && qr?.binaryData?.length) {
      const key = Array.from(qr.binaryData).join(',');
      const now = performance.now();
      if (key !== lastQr || now - lastQrAt > 1000) {
        const bytes = Uint8Array.from(qr.binaryData);
        send({ type: 'qr', bytes: bytes.buffer }, [bytes.buffer]);
        lastQr = key;
        lastQrAt = now;
      }
    }
  }
  cameraLoop = requestAnimationFrame(scanFrame);
}

function reportRestartFailure(error) {
  failure(`Restart failed: ${error.stack || error}`);
}
$('#restart-btn').onclick = () => restart(false).catch(reportRestartFailure);
$('#factory-btn').onclick = () => restart(true).catch(reportRestartFailure);
loading.querySelector('[data-loading-retry]').onclick = () => restart(false).catch(reportRestartFailure);
loading.querySelector('[data-loading-details]').onclick = event => {
  event.preventDefault();
  const details = $('#technical-details');
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#sd-toggle').onclick = () => send({ type: inserted ? 'sd-eject' : 'sd-insert' });
$('#sd-clear').onclick = () => send({ type: 'sd-clear' });
$('#sd-add').onclick = () => picker.click();
picker.onchange = () => { importFiles(picker.files); picker.value = ''; };
$('#sd-drop').ondragover = event => { event.preventDefault(); $('#sd-drop').classList.add('dragging'); };
$('#sd-drop').ondragleave = () => $('#sd-drop').classList.remove('dragging');
$('#sd-drop').ondrop = event => {
  event.preventDefault();
  $('#sd-drop').classList.remove('dragging');
  importFiles(event.dataTransfer.files);
};
$('#camera-toggle').onclick = () => {
  backupEnabled = !backupEnabled;
  if (backupEnabled) {
    video.hidden = false;
    $('#camera-toggle').textContent = 'Hide backup preview';
    if (!cameraStream) startCamera();
  } else {
    video.hidden = true;
    $('#camera-toggle').textContent = 'Show backup preview';
    if (!scannerActive) stopCamera();
  }
};
$('#camera-screen-start').onclick = () => startCamera();
$('#camera-screen-back').onclick = () => { screenCamera.hidden = true; };
cameraSelect.onchange = () => startCamera(cameraSelect.value);
addEventListener('pagehide', () => { stopCamera(); worker?.terminate(); });

try {
  stateFiles = await awaitPeripherals();
  const pointerPath = variant === 'diy' ? '/browser/current.json' :
    variant === 'play' ? '/browser/variants/specter-playground.json' :
    '/browser/variants/specter-playground-schnuartz.json';
  const pointer = await (await fetch(pointerPath, { cache: 'no-store' })).json();
  build = pointer.build;
  version = pointer.version;
  if (!/^\/builds\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/[a-f0-9]{40}\/$/.test(build)) throw new Error('Invalid build pointer');
  if (!/^[a-f0-9]{16}$/.test(version)) throw new Error('Invalid artifact version');
  const manifest = await (await fetch(`${build}build-info.json`, { cache: 'no-store' })).json();
  if (!build.includes(manifest.commit) || manifest.artifact_set_sha256?.slice(0, 16) !== version) {
    throw new Error('Build manifest mismatch');
  }
  const expectedRepos = variant === 'diy' ? ['schnuartz/specter-diy', 'schnuartz-ai/specter-diy'] :
    variant === 'play' ? ['k9ert/specter-playground'] : ['schnuartz-ai/specter-playground-schnuartz'];
  if (!expectedRepos.includes(manifest.repository?.toLowerCase())) throw new Error('Wrong firmware variant in build manifest');
  if (!/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('Invalid source commit in build manifest');
  program = manifest.entrypoint === 'mockui' ? 'mockui' : 'wallet';
  $('#build-label').textContent = `${manifest.repository} · ${manifest.commit.slice(0, 7)} · Browser / WASM`;
  const repositoryUrl = `https://github.com/${manifest.repository}`;
  const commitUrl = `${repositoryUrl}/commit/${manifest.commit}`;
  $('#source-commit-link').href = repositoryUrl;
  $('#source-commit-link').textContent = 'GitHub';
  $('#build-link').href = commitUrl;
  $('#build-link').textContent = manifest.commit.slice(0, 12);
  $('#build-details').textContent = JSON.stringify(manifest, null, 2);
  $('#card-panel').hidden = !manifest.capabilities?.smartcard;
  if (location.protocol === 'https:' && !window.crossOriginIsolated) {
    $('#isolation-warning').hidden = false;
    log('Cross-origin isolation missing: check COOP, COEP and CORP response headers.');
  }
  await start();
} catch (error) {
  failure(`Browser build failed to load: ${error.message}`);
}
