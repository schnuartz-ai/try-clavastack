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
let mediaDb;
const mediaFiles = new Map();
const cardOwners = new Map([[1, null], [2, null], [3, null]]);
let sdOwner = null;
let selectedMedia = null;
let mediaBusy = false;
let mediaDrag = null;
let mediaRequestId = 0;
const mediaRequests = new Map();
const SD_CAPACITY_BYTES = 8_000_000_000;
const MEDIA_DB_NAME = 'clavastack-specter-removable-media-v1';
const desktopRuntimeRevision = '2026-10-02.3';

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

function openMediaDatabase() {
  if (mediaDb) return Promise.resolve(mediaDb);
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(MEDIA_DB_NAME, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('files', { keyPath: 'path' });
    opening.onerror = () => reject(opening.error || new Error('Could not open virtual SD storage'));
    opening.onsuccess = () => { mediaDb = opening.result; resolve(mediaDb); };
  });
}

function idbDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Virtual SD storage failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Virtual SD storage was interrupted'));
  });
}

async function loadSharedMedia() {
  const database = await openMediaDatabase();
  const transaction = database.transaction('files', 'readonly');
  const records = await new Promise((resolve, reject) => {
    const request = transaction.objectStore('files').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not read virtual SD storage'));
  });
  for (const record of records) mediaFiles.set(record.path, new Uint8Array(record.bytes));
  try {
    const state = JSON.parse(localStorage.getItem('specter-desktop-media-state-v1') || '{}');
    sdOwner = ['desktop', 'diy'].includes(state.sdOwner) ? state.sdOwner : null;
    for (const slot of [1, 2, 3]) cardOwners.set(slot, state.cardOwners?.[slot] === 'diy' ? 'diy' : null);
  } catch {
    sdOwner = null;
  }
  renderMedia();
}

async function persistMedia() {
  const database = await openMediaDatabase();
  const transaction = database.transaction('files', 'readwrite');
  const store = transaction.objectStore('files');
  store.clear();
  for (const [path, bytes] of mediaFiles) {
    store.put({ path, bytes: bytes.slice().buffer });
  }
  await idbDone(transaction);
}

function persistMediaOwners() {
  localStorage.setItem('specter-desktop-media-state-v1', JSON.stringify({
    sdOwner,
    cardOwners: Object.fromEntries(cardOwners),
  }));
  notifyDesktopMediaState();
}

function notifyDesktopMediaState() {
  desktopFrame.contentWindow?.postMessage({ type: 'specter-media-state', sdOwner }, origin);
}

function reportMedia(message) {
  $('#media-status').textContent = message;
}

function mediaPrefix(kind, slot) { return kind === 'sd' ? 'sd/' : `cards/${slot}/`; }

function mediaFor(prefix) {
  return [...mediaFiles].filter(([path]) => path.startsWith(prefix))
    .map(([path, bytes]) => ({ path, bytes }));
}

function ownerFor(kind, slot) { return kind === 'sd' ? sdOwner : cardOwners.get(slot); }

function renderMedia() {
  $('#sd-location').textContent = sdOwner ? `Inserted in ${sdOwner === 'desktop' ? 'Specter Desktop' : 'Specter DIY'}` : 'Not inserted';
  $('#sd-token').setAttribute('aria-pressed', String(selectedMedia?.kind === 'sd'));
  $('#sd-token').setAttribute('aria-label', `Drag 8 GB SD card onto a device. ${sdOwner ? `Inserted in ${sdOwner === 'desktop' ? 'Specter Desktop' : 'Specter DIY'}.` : 'Not inserted.'}`);
  for (const token of document.querySelectorAll('.memory-token')) {
    const slot = Number(token.dataset.slot);
    const owner = cardOwners.get(slot);
    token.querySelector('small').textContent = owner ? 'Inserted in Specter DIY' : 'Not inserted';
    token.setAttribute('aria-pressed', String(selectedMedia?.kind === 'card' && selectedMedia.slot === slot));
    token.setAttribute('aria-label', `MemoryCard ${slot}. ${owner ? 'Inserted in Specter DIY' : 'Not inserted'}. Drag onto Specter DIY; right-click to reset.`);
  }
  const list = $('#sd-files');
  list.replaceChildren();
  const files = mediaFor('sd/');
  const used = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (!files.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No files on card';
    list.append(empty);
  }
  for (const file of files) {
    const row = document.createElement('li');
    const name = file.path.slice(3);
    const label = document.createElement('span');
    label.textContent = `${name} · ${file.bytes.byteLength.toLocaleString()} bytes`;
    const actions = document.createElement('span');
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'Download';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([file.bytes]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.disabled = mediaBusy;
    remove.addEventListener('click', () => runMediaOperation(async () => {
      if (sdOwner === 'diy') {
        sendDiyMessage({ type: 'peripheral-command', command: { type: 'sd-delete', name } });
        await getDiySnapshot();
        syncDiyMedia('sd/');
      } else mediaFiles.delete(file.path);
      await persistMedia();
      reportMedia(`Deleted ${name} from the virtual SD card.`);
    }));
    actions.append(download, remove);
    row.append(label, actions);
    list.append(row);
  }
  $('#sd-clear').disabled = mediaBusy || files.length === 0;
  $('#sd-refresh').disabled = mediaBusy || sdOwner !== 'diy';
  $('#sd-add').disabled = mediaBusy;
  document.querySelectorAll('.device-hitbox').forEach(hitbox => {
    const target = hitbox.dataset.mediaTarget;
    const canInsert = selectedMedia && !mediaBusy && (target === 'diy' ? diyRunning : ready) &&
      (target === 'diy' || selectedMedia.kind === 'sd') && ownerFor(selectedMedia.kind, selectedMedia.slot) !== target;
    hitbox.disabled = !canInsert;
    hitbox.classList.toggle('armed', Boolean(canInsert));
    hitbox.textContent = canInsert ? 'Insert here' : '';
  });
  $('#media-selection').textContent = selectedMedia
    ? `Selected ${selectedMedia.kind === 'sd' ? 'SD card' : `MemoryCard ${selectedMedia.slot}`} · tap a highlighted device to insert.`
    : 'Drag a card onto a device, or select a card and tap the device. Click an inserted card to eject it.';
  const sdDrop = $('#sd-drop');
  sdDrop.dataset.used = `${used}`;
  notifyDesktopMediaState();
}

function requestDiySnapshot() {
  if (!diyRunning) return Promise.reject(new Error('Specter DIY is not running yet.'));
  return new Promise((resolve, reject) => {
    const requestId = ++mediaRequestId;
    const timer = setTimeout(() => {
      mediaRequests.delete(requestId);
      reject(new Error('Specter DIY did not return the virtual card contents.'));
    }, 15000);
    mediaRequests.set(requestId, { resolve, reject, timer });
    sendDiyMessage({ type: 'peripherals-export', requestId });
  });
}

async function getDiySnapshot(prefix) {
  const files = await requestDiySnapshot();
  for (const path of [...mediaFiles.keys()]) if (path.startsWith(prefix)) mediaFiles.delete(path);
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    mediaFiles.set(file.path, file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes));
  }
  return files;
}

async function runMediaOperation(action) {
  if (mediaBusy) return;
  mediaBusy = true;
  renderMedia();
  try { await action(); }
  catch (error) { reportMedia(`Media error: ${error.message}`); }
  finally { mediaBusy = false; renderMedia(); }
}

async function detachMedia(kind, slot) {
  const owner = ownerFor(kind, slot);
  if (!owner) return;
  const prefix = mediaPrefix(kind, slot);
  if (owner === 'diy') {
    await getDiySnapshot(prefix);
    sendDiyMessage({ type: 'peripheral-command', command: kind === 'sd' ? { type: 'sd-eject' } : { type: 'card-remove' } });
    sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-remove-prefix', prefix } });
    await requestDiySnapshot(); // Wait for the ordered commands without replacing the card's saved files.
  }
  if (kind === 'sd') sdOwner = null;
  else cardOwners.set(slot, null);
  await persistMedia();
  persistMediaOwners();
}

async function insertMedia(kind, slot, target) {
  if (kind === 'card' && target !== 'diy') throw new Error('MemoryCards can only be inserted in Specter DIY.');
  if (target === 'desktop' && !ready) throw new Error('Specter Desktop is still starting.');
  if (target === 'diy' && !diyRunning) throw new Error('Specter DIY is still starting.');
  const currentOwner = ownerFor(kind, slot);
  if (currentOwner === target) return;
  if (kind === 'card') {
    const other = [...cardOwners].find(([otherSlot, owner]) => otherSlot !== slot && owner === 'diy');
    if (other) await detachMedia('card', other[0]);
  }
  await detachMedia(kind, slot);
  if (target === 'diy') {
    const prefix = mediaPrefix(kind, slot);
    const files = mediaFor(prefix);
    sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-import', files } });
    sendDiyMessage({ type: 'peripheral-command', command: kind === 'sd'
      ? { type: 'sd-insert' } : { type: 'card-insert', slot } });
    await getDiySnapshot(prefix);
  }
  if (kind === 'sd') sdOwner = target;
  else cardOwners.set(slot, target);
  await persistMedia();
  persistMediaOwners();
  reportMedia(`${kind === 'sd' ? 'Virtual SD card' : `MemoryCard ${slot}`} inserted in ${target === 'desktop' ? 'Specter Desktop' : 'Specter DIY'}.`);
}

function selectMedia(media) {
  const owner = ownerFor(media.kind, media.slot);
  if (owner) {
    selectedMedia = null;
    runMediaOperation(async () => {
      await detachMedia(media.kind, media.slot);
      reportMedia(`${media.kind === 'sd' ? 'SD card' : `MemoryCard ${media.slot}`} ejected from ${owner === 'desktop' ? 'Specter Desktop' : 'Specter DIY'}.`);
    });
  } else {
    selectedMedia = media;
    renderMedia();
    reportMedia('Tap a device to insert the selected card.');
  }
}

for (const token of document.querySelectorAll('.media-token')) {
  token.addEventListener('pointerdown', event => {
    if (event.button !== 0 || mediaBusy) return;
    event.preventDefault();
    token.setPointerCapture(event.pointerId);
    mediaDrag = { token, kind: token.dataset.media, slot: Number(token.dataset.slot) || null,
      x: event.clientX, y: event.clientY, ghost: null };
  });
  token.addEventListener('pointermove', event => {
    if (!mediaDrag || mediaDrag.token !== token) return;
    if (!mediaDrag.ghost && Math.hypot(event.clientX - mediaDrag.x, event.clientY - mediaDrag.y) > 7) {
      mediaDrag.ghost = document.createElement('div');
      mediaDrag.ghost.className = 'drag-ghost';
      mediaDrag.ghost.append((token.querySelector('img') || token.querySelector('.card-art')).cloneNode(true));
      document.body.append(mediaDrag.ghost);
      selectedMedia = null;
      renderMedia();
    }
    if (!mediaDrag.ghost) return;
    mediaDrag.ghost.style.left = `${event.clientX}px`;
    mediaDrag.ghost.style.top = `${event.clientY}px`;
    const target = mediaTargetAt(event.clientX, event.clientY, mediaDrag.kind);
    document.querySelectorAll('.desktop-runtime, .device-frame').forEach(zone => zone.classList.remove('drop-target'));
    if (target) mediaTargetZone(target).classList.add('drop-target');
  });
  token.addEventListener('pointerup', event => {
    if (!mediaDrag || mediaDrag.token !== token) return;
    const item = mediaDrag;
    const target = item.ghost && mediaTargetAt(event.clientX, event.clientY, item.kind);
    cleanupMediaDrag();
    if (target) {
      selectedMedia = null;
      runMediaOperation(() => insertMedia(item.kind, item.slot, target));
    } else if (!item.ghost) selectMedia({ kind: item.kind, slot: item.slot });
  });
  token.addEventListener('pointercancel', cleanupMediaDrag);
  if (token.dataset.media === 'card') token.addEventListener('contextmenu', event => {
    event.preventDefault();
    const slot = Number(token.dataset.slot);
    if (!confirm(`Reset MemoryCard ${slot}? Its simulated keys and PIN will be wiped.`)) return;
    runMediaOperation(async () => {
      await detachMedia('card', slot);
      for (const path of [...mediaFiles.keys()]) if (path.startsWith(`cards/${slot}/`)) mediaFiles.delete(path);
      await persistMedia();
      persistMediaOwners();
      reportMedia(`MemoryCard ${slot} reset.`);
    });
  });
}

function mediaTargetZone(target) { return target === 'desktop' ? $('#desktop-drop') : diyFrame.closest('.device-frame'); }
function mediaTargetAt(x, y, kind) {
  for (const target of ['desktop', 'diy']) {
    if (kind === 'card' && target !== 'diy') continue;
    const rect = mediaTargetZone(target).getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return target;
  }
  return null;
}
function cleanupMediaDrag() {
  mediaDrag?.ghost?.remove();
  mediaDrag = null;
  document.querySelectorAll('.desktop-runtime, .device-frame').forEach(zone => zone.classList.remove('drop-target'));
}
document.querySelectorAll('.device-hitbox').forEach(hitbox => hitbox.addEventListener('click', () => {
  if (!selectedMedia || mediaBusy) return;
  const media = selectedMedia;
  const target = hitbox.dataset.mediaTarget;
  if (media.kind === 'card' && target !== 'diy') return;
  selectedMedia = null;
  runMediaOperation(() => insertMedia(media.kind, media.slot, target));
}));
addEventListener('keydown', event => { if (event.key === 'Escape') { selectedMedia = null; cleanupMediaDrag(); renderMedia(); } });

const sdPicker = $('#sd-picker');
$('#sd-add').addEventListener('click', () => sdPicker.click());
sdPicker.addEventListener('change', () => {
  const files = [...sdPicker.files];
  sdPicker.value = '';
  if (!files.length) return;
  runMediaOperation(async () => {
    const sizes = new Map(mediaFor('sd/').map(file => [file.path, file.bytes.byteLength]));
    let projected = [...sizes.values()].reduce((total, size) => total + size, 0);
    for (const file of files) {
      const path = `sd/${file.name}`;
      projected += file.size - (sizes.get(path) || 0);
      sizes.set(path, file.size);
    }
    if (projected > SD_CAPACITY_BYTES) throw new Error('The virtual SD card is full (8 GB).');
    const imported = await Promise.all(files.map(async file => ({
      path: `sd/${file.name}`, bytes: new Uint8Array(await file.arrayBuffer()),
    })));
    for (const file of imported) mediaFiles.set(file.path, file.bytes);
    if (sdOwner === 'diy') {
      sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-import', files: imported } });
      await getDiySnapshot('sd/');
    }
    await persistMedia();
    reportMedia(`${files.length} file${files.length === 1 ? '' : 's'} added to the virtual SD card.`);
  });
});
const sdDrop = $('#sd-drop');
sdDrop.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
sdDrop.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  const files = [...event.dataTransfer.files];
  runMediaOperation(async () => {
    for (const file of files) mediaFiles.set(`sd/${file.name}`, new Uint8Array(await file.arrayBuffer()));
    if (sdOwner === 'diy') {
      sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-import', files: mediaFor('sd/') } });
      await getDiySnapshot('sd/');
    }
    await persistMedia();
    reportMedia(`${files.length} file${files.length === 1 ? '' : 's'} added to the virtual SD card.`);
  });
});
addEventListener('paste', event => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  runMediaOperation(async () => {
    for (const file of files) mediaFiles.set(`sd/${file.name}`, new Uint8Array(await file.arrayBuffer()));
    if (sdOwner === 'diy') {
      sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-import', files: mediaFor('sd/') } });
      await getDiySnapshot('sd/');
    }
    await persistMedia();
    reportMedia(`${files.length} file${files.length === 1 ? '' : 's'} added to the virtual SD card.`);
  });
});
$('#sd-clear').addEventListener('click', () => runMediaOperation(async () => {
  if (sdOwner === 'diy') {
    sendDiyMessage({ type: 'peripheral-command', command: { type: 'sd-clear' } });
    await getDiySnapshot('sd/');
  } else {
    for (const path of [...mediaFiles.keys()]) if (path.startsWith('sd/')) mediaFiles.delete(path);
  }
  await persistMedia();
  reportMedia('Virtual SD card cleared.');
}));
$('#sd-refresh').addEventListener('click', () => runMediaOperation(async () => {
  await getDiySnapshot('sd/');
  await persistMedia();
  reportMedia('Virtual SD card refreshed from Specter DIY.');
}));

function updateCableState() {
  const toggle = $('#cable-toggle');
  const panel = document.querySelector('.cable-panel');
  const status = $('#cable-status');
  const supported = crossOriginIsolated && typeof SharedArrayBuffer === 'function';
  const available = Boolean(diyUsbEnabled && diyRunning && ready && supported);
  toggle.disabled = !available;
  if (!available) toggle.checked = false;
  const connected = Boolean(toggle.checked && available);
  panel.classList.toggle('connected', connected);
  status.textContent = connected ? 'On' : 'Off';
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
    if (data.type === 'child-awaiting-peripherals') {
      const files = [];
      if (sdOwner === 'diy') files.push(...mediaFor('sd/'));
      for (const slot of [1, 2, 3]) if (cardOwners.get(slot) === 'diy') files.push(...mediaFor(`cards/${slot}/`));
      const cardSlot = [...cardOwners].find(([, owner]) => owner === 'diy')?.[0] || null;
      sendDiyMessage({ type: 'peripherals-provide', files, sdInserted: sdOwner === 'diy', cardSlot });
      sendDiyMessage({ type: 'gallery-parent-ready' });
      setStatus(diyStatus, 'Starting real firmware…');
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
    } else if (data.type === 'peripherals-snapshot') {
      const pending = mediaRequests.get(data.requestId);
      if (pending) {
        mediaRequests.delete(data.requestId);
        clearTimeout(pending.timer);
        pending.resolve(data.files || []);
      }
    } else if (data.type === 'peripheral-state') {
      if (data.sdInserted) sdOwner = 'diy';
      else if (sdOwner === 'diy') sdOwner = null;
      if (data.cardSlot) {
        for (const [slot, owner] of cardOwners) if (owner === 'diy') cardOwners.set(slot, null);
        cardOwners.set(data.cardSlot, 'diy');
      } else {
        for (const [slot, owner] of cardOwners) if (owner === 'diy') cardOwners.set(slot, null);
      }
      persistMediaOwners();
      renderMedia();
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
    } else if (data.type === 'specter-media-state-request' || data.type === 'specter-media-bridge-ready') {
      notifyDesktopMediaState();
    } else if (data.type === 'specter-media-list') {
      const files = sdOwner === 'desktop'
        ? mediaFor('sd/').map(file => ({ name: file.path.slice(3), bytes: file.bytes, type: 'application/octet-stream' }))
        : null;
      desktopFrame.contentWindow.postMessage({ type: 'specter-media-files', id: data.id,
        error: files ? undefined : 'Insert the virtual SD card in Specter Desktop first.', files: files || [] }, origin);
    } else if (data.type === 'specter-media-write') {
      const saveToCard = async () => {
        if (sdOwner !== 'desktop') throw new Error('Insert the virtual SD card in Specter Desktop first.');
        const name = String(data.name || '').replaceAll('\\', '/').split('/').pop();
        if (!name || name === '.' || name === '..') throw new Error('The SD card filename is invalid.');
        const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
        const previous = mediaFiles.get(`sd/${name}`)?.byteLength || 0;
        const used = mediaFor('sd/').reduce((total, file) => total + file.bytes.byteLength, 0);
        if (used - previous + bytes.byteLength > SD_CAPACITY_BYTES) throw new Error('The virtual SD card is full (8 GB).');
        mediaFiles.set(`sd/${name}`, bytes.slice());
        await persistMedia();
        renderMedia();
        reportMedia(`Specter Desktop saved ${name} to the virtual SD card.`);
      };
      saveToCard().then(() => desktopFrame.contentWindow.postMessage({ type: 'specter-media-written', id: data.id }, origin))
        .catch(error => desktopFrame.contentWindow.postMessage({ type: 'specter-media-written', id: data.id, error: error.message }, origin));
    }
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
    await loadSharedMedia();
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
    });
    $('#diy-build-label').classList.remove('diy-build-loading');
  } catch (error) {
    setStatus(desktopStatus, 'Browser setup failed', 'error');
    $('#loader-title').textContent = 'Specter browser setup failed';
    $('#loader-detail').textContent = error?.stack || String(error);
  }
}

boot();
