import { createDemoImporter, demoImportTitle } from './demo-import.js';

export function createCompanionMedia({ container, companionLabel, storageKey, ownersKey = `${storageKey}-owners`, isDiyRunning, isCompanionReady, allowedDemoNetworks = ['testnet', 'mainnet'], sendDiyMessage, getTargetZone, onState = () => {} }) {
  const safeLabel = String(companionLabel).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  container.innerHTML = `<section class="removable-media" aria-labelledby="media-heading">
      <div class="media-heading"><div><p class="eyebrow">SHARED VIRTUAL STORAGE</p><h2 id="media-heading">Removable media</h2></div><p>Insert the same card into either application to move files between them.</p></div>
      <div class="media-grid">
        <section class="media-group" id="sd-drop" aria-labelledby="sd-heading">
          <h3 id="sd-heading">Virtual SD card</h3>
          <button class="media-token sd-token" id="sd-token" type="button" data-media="sd" aria-pressed="false" aria-label="Drag 8 GB SD card onto a device">
            <img src="/assets/sd-card-8gb.png" alt="8 GB microSD card">
            <small id="sd-location">Not inserted</small>
          </button>
          <div class="media-actions"><button type="button" id="sd-add">Add files</button><button type="button" id="sd-refresh">Refresh files</button><button type="button" id="sd-clear">Clear</button><select id="demo-network" aria-label="Import demo data"><option value="" selected>None</option><option value="testnet">Testnet Demos/Seed</option><option value="mainnet">Mainnet/Demos Seed</option></select><input id="sd-picker" type="file" multiple hidden></div>
          <p class="drop-help">Select, drop, or paste multiple files at once. Drag this card onto a device to insert it.</p>
          <ul id="sd-files" class="sd-files"><li>No files on card</li></ul>
        </section>
        <section class="media-group memory-group" aria-labelledby="memory-heading">
          <h3 id="memory-heading">Virtual MemoryCards</h3>
          <div class="memory-tray">
            <button class="media-token memory-token" type="button" data-media="card" data-slot="1" aria-pressed="false"><span class="card-art"><img class="card-photo" src="/assets/specter-smartcard-blank.png" alt=""><strong>MemoryCard 1</strong></span><small>Not inserted</small></button>
            <button class="media-token memory-token" type="button" data-media="card" data-slot="2" aria-pressed="false"><span class="card-art"><img class="card-photo" src="/assets/specter-smartcard-blank.png" alt=""><strong>MemoryCard 2</strong></span><small>Not inserted</small></button>
            <button class="media-token memory-token" type="button" data-media="card" data-slot="3" aria-pressed="false"><span class="card-art"><img class="card-photo" src="/assets/specter-smartcard-blank.png" alt=""><strong>MemoryCard 3</strong></span><small>Not inserted</small></button>
          </div>
          <p class="drop-help">Drag a MemoryCard onto Specter DIY. Right-click a card to reset it.</p>
        </section>
        <section class="media-group cable-group cable-panel" aria-labelledby="cable-heading">
          <h3 id="cable-heading">Cable Connection</h3>
          <div class="cable-route" role="group" aria-label="Bidirectional cable from Specter DIY to ${safeLabel}">
            <span class="cable-endpoint">Specter DIY</span>
            <span class="cable-link" aria-hidden="true"></span>
            <span class="cable-endpoint">${safeLabel}</span>
            <label class="cable-toggle"><input type="checkbox" id="cable-toggle"><span>On/Off</span></label>
          </div>
          <p class="visually-hidden" id="cable-status" role="status" aria-live="polite">Off</p>
        </section>
      </div>
      <p class="media-insertion" id="media-selection">Drag a card onto a device, or select a card and tap the device. Click an inserted card to eject it.</p>
      <p id="media-status" role="status" aria-live="polite">Cards are ejected.</p>
    </section>`;
  for (const option of container.querySelectorAll('#demo-network option')) { if (option.value && !allowedDemoNetworks.includes(option.value)) option.remove(); }

  const $ = selector => container.querySelector(selector);
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
const MEDIA_DB_NAME = storageKey;
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
    const state = JSON.parse(localStorage.getItem(ownersKey) || '{}');
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
  localStorage.setItem(ownersKey, JSON.stringify({
    sdOwner,
    cardOwners: Object.fromEntries(cardOwners),
  }));
  notifyDesktopMediaState();
}

function notifyDesktopMediaState() { onState({ sdOwner }); }

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
  document.querySelectorAll('.media-token').forEach(token => { token.disabled = mediaBusy; });
  $('#sd-location').textContent = sdOwner ? `Inserted in ${sdOwner === 'desktop' ? companionLabel : 'Specter DIY'}` : 'Not inserted';
  $('#sd-token').setAttribute('aria-pressed', String(selectedMedia?.kind === 'sd'));
  $('#sd-token').setAttribute('aria-label', `Drag 8 GB SD card onto a device. ${sdOwner ? `Inserted in ${sdOwner === 'desktop' ? companionLabel : 'Specter DIY'}.` : 'Not inserted.'}`);
  for (const token of document.querySelectorAll('.memory-token')) {
    const slot = Number(token.dataset.slot);
    const owner = cardOwners.get(slot);
    let details = token.parentElement.querySelector(`.card-details[data-slot="${slot}"]`);
    const demo = demoImporter.metadata.get(slot);
    if (demo && !details) { details = document.createElement('small'); details.className = 'card-details'; details.dataset.slot = slot; token.append(details); }
    if (details) { details.hidden = !demo; details.textContent = demo ? `PIN: ${demo.pin}\n${demo.seed}` : ''; }
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
        await getDiySnapshot('sd/');
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
  $('#demo-network').disabled = mediaBusy || !isDiyRunning();
  document.querySelectorAll('.device-hitbox').forEach(hitbox => {
    const target = hitbox.dataset.mediaTarget;
    const canInsert = selectedMedia && !mediaBusy && (target === 'diy' ? isDiyRunning() : isCompanionReady()) &&
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
  if (!isDiyRunning()) return Promise.reject(new Error('Specter DIY is not running yet.'));
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
  if (target === 'desktop' && !isCompanionReady()) throw new Error(`${companionLabel} is still starting.`);
  if (target === 'diy' && !isDiyRunning()) throw new Error('Specter DIY is still starting.');
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
  reportMedia(`${kind === 'sd' ? 'Virtual SD card' : `MemoryCard ${slot}`} inserted in ${target === 'desktop' ? companionLabel : 'Specter DIY'}.`);
}

function selectMedia(media) {
  const owner = ownerFor(media.kind, media.slot);
  if (owner) {
    selectedMedia = null;
    runMediaOperation(async () => {
      await detachMedia(media.kind, media.slot);
      reportMedia(`${media.kind === 'sd' ? 'SD card' : `MemoryCard ${media.slot}`} ejected from ${owner === 'desktop' ? companionLabel : 'Specter DIY'}.`);
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
      demoImporter.resetCard(slot);
      await detachMedia('card', slot);
      for (const path of [...mediaFiles.keys()]) if (path.startsWith(`cards/${slot}/`)) mediaFiles.delete(path);
      await persistMedia();
      persistMediaOwners();
      reportMedia(`MemoryCard ${slot} reset.`);
    });
  });
}

function mediaTargetZone(target) { return getTargetZone(target); }
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

async function importSdFiles(files) {
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
}

const sdPicker = $('#sd-picker');
$('#sd-add').addEventListener('click', () => sdPicker.click());
sdPicker.addEventListener('change', () => {
  const files = [...sdPicker.files];
  sdPicker.value = '';
  if (files.length) runMediaOperation(() => importSdFiles(files));
});
const sdDrop = $('#sd-drop');
sdDrop.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
sdDrop.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  const files = [...event.dataTransfer.files];
  runMediaOperation(() => importSdFiles(files));
});
addEventListener('paste', event => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  runMediaOperation(() => importSdFiles(files));
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

function handleDiyMessage(data) {
  if (data.type === 'child-awaiting-peripherals') {
    const files = [];
    if (sdOwner === 'diy') files.push(...mediaFor('sd/'));
    for (const slot of [1, 2, 3]) if (cardOwners.get(slot) === 'diy') files.push(...mediaFor(`cards/${slot}/`));
    const cardSlot = [...cardOwners].find(([, owner]) => owner === 'diy')?.[0] || null;
    sendDiyMessage({ type: 'peripherals-provide', files, sdInserted: sdOwner === 'diy', cardSlot });
    sendDiyMessage({ type: 'gallery-parent-ready' });
  } else if (data.type === 'peripherals-snapshot') {
    const pending = mediaRequests.get(data.requestId);
    if (pending) { mediaRequests.delete(data.requestId); clearTimeout(pending.timer); pending.resolve(data.files || []); }
  } else if (data.type === 'peripheral-state') {
    if (data.sdInserted) sdOwner = 'diy';
    else if (sdOwner === 'diy') sdOwner = null;
    for (const [slot, owner] of cardOwners) if (owner === 'diy') cardOwners.set(slot, null);
    if (data.cardSlot) cardOwners.set(data.cardSlot, 'diy');
    persistMediaOwners(); renderMedia();
  } else return false;
  return true;
}
function handleCompanionMessage(data, reply) {
if (data.type === 'specter-media-state-request' || data.type === 'specter-media-bridge-ready') {
      notifyDesktopMediaState();
    } else if (data.type === 'specter-media-list') {
      const files = sdOwner === 'desktop'
        ? mediaFor('sd/').map(file => ({ name: file.path.slice(3), bytes: file.bytes, type: 'application/octet-stream' }))
        : null;
      reply({ type: 'specter-media-files', id: data.id,
        error: files ? undefined : `Insert the virtual SD card in ${companionLabel} first.`, files: files || [] });
    } else if (data.type === 'specter-media-write') {
      const saveToCard = async () => {
        if (mediaBusy) throw new Error('Please wait for the current media operation to finish.');
        if (sdOwner !== 'desktop') throw new Error(`Insert the virtual SD card in ${companionLabel} first.`);
        const name = String(data.name || '').replaceAll('\\', '/').split('/').pop();
        if (!name || name === '.' || name === '..') throw new Error('The SD card filename is invalid.');
        const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
        const previous = mediaFiles.get(`sd/${name}`)?.byteLength || 0;
        const used = mediaFor('sd/').reduce((total, file) => total + file.bytes.byteLength, 0);
        if (used - previous + bytes.byteLength > SD_CAPACITY_BYTES) throw new Error('The virtual SD card is full (8 GB).');
        mediaFiles.set(`sd/${name}`, bytes.slice());
        await persistMedia();
        renderMedia();
        reportMedia(`${companionLabel} saved ${name} to the virtual SD card.`);
      };
      saveToCard().then(() => reply({ type: 'specter-media-written', id: data.id }))
        .catch(error => reply({ type: 'specter-media-written', id: data.id, error: error.message }));
    }
}
const demoImporter = createDemoImporter({
  allowedNetworks: allowedDemoNetworks,
  isRunning: isDiyRunning, capacity: SD_CAPACITY_BYTES,
  send: command => sendDiyMessage({ type: 'peripheral-command', command }),
  snapshot: async () => {
    const files = await requestDiySnapshot();
    for (const prefix of ['sd/', 'cards/']) {
      for (const path of [...mediaFiles.keys()]) if (path.startsWith(prefix)) mediaFiles.delete(path);
      for (const file of files) if (file.path.startsWith(prefix)) mediaFiles.set(file.path, new Uint8Array(file.bytes));
    }
    return files;
  },
  getSdOwner: () => sdOwner,
  getActiveCard: () => [...cardOwners].find(([, owner]) => owner === 'diy')?.[0] || null,
  setSdOwner: async owner => {
    if (owner) await insertMedia('sd', null, owner);
    else {
      // Keep the working mirror until the import's final snapshot preserves
      // ordinary files. Ejected firmware mounts are removed after persistence.
      sendDiyMessage({ type: 'peripheral-command', command: { type: 'sd-eject' } });
      sdOwner = null;
      persistMediaOwners();
    }
  },
});
const demoSelect = $('#demo-network');
demoSelect.title = demoImportTitle('');
demoSelect.addEventListener('change', () => runMediaOperation(async () => {
  demoSelect.title = demoImportTitle(demoSelect.value);
  // Mirror ejected media too so occupied cards and existing files are preserved.
  if (sdOwner === 'diy') await getDiySnapshot('sd/');
  for (const [slot, owner] of cardOwners) if (owner === 'diy') await getDiySnapshot(`cards/${slot}/`);
  sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-import', files: [...mediaFiles].map(([path, bytes]) => ({ path, bytes })) } });
  try { await demoImporter.apply(demoSelect.value); }
  finally {
    await persistMedia(); persistMediaOwners();
    for (const slot of [1, 2, 3]) if (cardOwners.get(slot) !== 'diy') sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-remove-prefix', prefix: `cards/${slot}/` } });
    if (sdOwner !== 'diy') sendDiyMessage({ type: 'peripheral-command', command: { type: 'state-remove-prefix', prefix: 'sd/' } });
  }
  reportMedia(demoSelect.value ? 'Demo data imported into the SD card and empty MemoryCards.' : 'Demo data removed.');
}));
return { init: loadSharedMedia, render: renderMedia, notify: notifyDesktopMediaState, handleDiyMessage, handleCompanionMessage };

}
