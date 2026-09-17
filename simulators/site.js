const order = ['diy', 'play', 'schnuartz'];
const numbers = { diy: 1, play: 2, schnuartz: 3 };
const pointers = {
  diy: '/browser/current.json',
  play: '/browser/variants/specter-playground.json',
  schnuartz: '/browser/variants/specter-playground-schnuartz.json',
};
const schnuartzModes = {
  normal: { pointer: pointers.schnuartz, query: '' },
  alternative: { pointer: '/browser/variants/specter-playground-schnuartz-alternative.json', query: 'alternative' },
};
const feedbackRepositories = {
  diy: 'schnuartz-ai/specter-diy',
  play: 'k9ert/specter-playground',
  schnuartz: 'Schnuartz/specter-playground',
};
const feedbackVersions = {};
const feedbackBuilds = {};
const devices = Object.fromEntries(order.map(name => [name, document.querySelector(`[data-device="${name}"]`)]));
const frames = Object.fromEntries(order.map(name => [name, devices[name].querySelector('iframe')]));
const ready = new Set();
const childVersions = new Map();
const pending = new Map();
const mediaFiles = new Map();
const SD_CAPACITY_BYTES = 8_000_000_000;
const cardOwners = new Map([[1, null], [2, null], [3, null]]);
let sdOwner = null;
let requestId = 0;
let armed = null;
let busy = false;
let schnuartzMode = 'normal';
const metadataGeneration = new Map();

function pointerPath(name) {
  return name === 'schnuartz' ? schnuartzModes[schnuartzMode].pointer : pointers[name];
}

function message(name, data) {
  frames[name].contentWindow?.postMessage(data, location.origin);
}
function command(name, commandData) {
  message(name, { type: 'peripheral-command', command: commandData });
}
function snapshot(name) {
  if (!ready.has(name)) return Promise.reject(new Error(`Device ${numbers[name]} has not finished starting`));
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Device ${numbers[name]} did not return its card contents`));
    }, 15000);
    pending.set(id, { name, resolve: files => { clearTimeout(timer); resolve(files); } });
    message(name, { type: 'peripherals-export', requestId: id });
  });
}
function prefix(kind, slot) { return kind === 'sd' ? 'sd/' : `cards/${slot}/`; }
function saveMedia(files, pathPrefix) {
  if (pathPrefix === 'sd/') {
    const usedBytes = files.filter(file => file.path.startsWith(pathPrefix))
      .reduce((total, file) => total + file.bytes.byteLength, 0);
    if (usedBytes > SD_CAPACITY_BYTES) throw new Error('Virtual SD card exceeds its 8 GB capacity');
  }
  for (const path of [...mediaFiles.keys()]) if (path.startsWith(pathPrefix)) mediaFiles.delete(path);
  for (const file of files) if (file.path.startsWith(pathPrefix)) mediaFiles.set(file.path, file.bytes);
}
function filesFor(pathPrefix) {
  return [...mediaFiles].filter(([path]) => path.startsWith(pathPrefix))
    .map(([path, bytes]) => ({ path, bytes }));
}
function locationLabel(owner) { return owner ? `Inserted in device ${numbers[owner]}` : 'Not inserted'; }
function report(text) { document.querySelector('#transfer-state').textContent = text; }
function formatBytes(bytes) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(bytes === SD_CAPACITY_BYTES ? 0 : 2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}
function render() {
  document.querySelector('#sd-location').textContent = locationLabel(sdOwner);
  for (const slot of [1, 2, 3]) {
    const token = document.querySelector(`[data-slot="${slot}"]`);
    token.querySelector('small').textContent = locationLabel(cardOwners.get(slot));
    token.setAttribute('aria-label', `MemoryCard ${slot}. ${locationLabel(cardOwners.get(slot))}. Drag onto a device; right-click to reset.`);
  }
  document.querySelectorAll('.media-token').forEach(token => token.classList.toggle('selected',
    armed?.kind === token.dataset.media && (armed.kind === 'sd' || armed.slot === Number(token.dataset.slot))));
  document.querySelectorAll('.device-hitbox').forEach(hitbox => {
    hitbox.classList.toggle('armed', Boolean(armed));
    hitbox.textContent = armed ? 'Insert here' : '';
  });
  const list = document.querySelector('#sd-files');
  list.replaceChildren();
  const sdFiles = filesFor('sd/');
  const usedBytes = sdFiles.reduce((total, file) => total + file.bytes.byteLength, 0);
  const capacity = document.querySelector('#sd-capacity');
  if (capacity) capacity.textContent = `8 GB capacity · ${formatBytes(usedBytes)} used · ${formatBytes(SD_CAPACITY_BYTES - usedBytes)} free`;
  if (!sdFiles.length) { const empty = document.createElement('li'); empty.textContent = 'No files on card'; list.append(empty); }
  for (const file of sdFiles) {
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = `${file.path.slice(3)} (${file.bytes.length} B)`;
    const actions = document.createElement('span');
    const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Download';
    download.onclick = () => {
      const url = URL.createObjectURL(new Blob([file.bytes]));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.path.split('/').pop(); anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
    remove.onclick = () => perform(async () => {
      if (sdOwner) { command(sdOwner, { type: 'sd-delete', name: file.path.slice(3) }); saveMedia(await snapshot(sdOwner), 'sd/'); }
      else mediaFiles.delete(file.path);
      report(`Deleted ${file.path.slice(3)} from the virtual SD card.`);
    });
    actions.append(download, remove); row.append(label, actions); list.append(row);
  }
}
async function perform(action) {
  if (busy) return;
  busy = true;
  try { await action(); }
  catch (error) { report(`Transfer error: ${error.message}`); }
  finally { busy = false; render(); }
}
async function detach(kind, slot) {
  const owner = kind === 'sd' ? sdOwner : cardOwners.get(slot);
  if (!owner) return;
  const pathPrefix = prefix(kind, slot);
  saveMedia(await snapshot(owner), pathPrefix);
  command(owner, kind === 'sd' ? { type: 'sd-eject' } : { type: 'card-remove' });
  command(owner, { type: 'state-remove-prefix', prefix: pathPrefix });
  await snapshot(owner); // Finish the worker's ordered commands before offering the card elsewhere.
  if (kind === 'sd') sdOwner = null;
  else cardOwners.set(slot, null);
  render();
}
async function move(kind, slot, target) {
  if (!ready.has(target)) throw new Error(`Device ${numbers[target]} is still starting`);
  const owner = kind === 'sd' ? sdOwner : cardOwners.get(slot);
  if (owner === target) return;
  if (kind === 'card') {
    const occupied = [...cardOwners].find(([other, device]) => other !== slot && device === target);
    if (occupied) await detach('card', occupied[0]);
  }
  await detach(kind, slot);
  command(target, { type: 'state-import', files: filesFor(prefix(kind, slot)) });
  command(target, kind === 'sd' ? { type: 'sd-insert' } : { type: 'card-insert', slot });
  const files = await snapshot(target);
  saveMedia(files, prefix(kind, slot));
  if (kind === 'sd') sdOwner = target;
  else cardOwners.set(slot, target);
  report(`${kind === 'sd' ? 'SD card' : `MemoryCard ${slot}`} inserted in device ${numbers[target]}.`);
}
function disarm() { armed = null; render(); }
function select(media) {
  const owner = media.kind === 'sd' ? sdOwner : cardOwners.get(media.slot);
  if (owner) perform(async () => {
    await detach(media.kind, media.slot);
    report(`${media.kind === 'sd' ? 'SD card' : `MemoryCard ${media.slot}`} ejected from device ${numbers[owner]}.`);
  });
  else { armed = media; render(); report('Tap a device to insert the selected card.'); }
}

addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  const name = order.find(candidate => frames[candidate].contentWindow === event.source);
  if (!name || !event.data) return;
  const data = event.data;
  if (data.type === 'child-awaiting-peripherals' && data.variant === name) {
    message(name, { type: 'peripherals-provide', files: [] });
  } else if (data.type === 'simulator-running' && data.variant === name) {
    childVersions.set(name, { build: data.build, version: data.version });
    if (feedbackVersions[name] &&
        (data.version !== feedbackVersions[name] || data.build !== feedbackBuilds[name])) {
      ready.delete(name);
      devices[name].querySelector('.device-status').textContent = 'Build changed · reload this page';
      return;
    }
    ready.add(name);
    devices[name].querySelector('.device-status').textContent = 'Running locally · drag cards here';
  } else if (data.type === 'simulator-error') {
    ready.delete(name);
    devices[name].querySelector('.device-status').textContent = data.message;
  } else if (data.type === 'peripherals-snapshot' && data.variant === name) {
    const request = pending.get(data.requestId);
    if (request?.name === name) { pending.delete(data.requestId); request.resolve(data.files); }
  }
});

// Recover startup messages sent by cached child frames before this module registered its listener.
for (const name of order) message(name, { type: 'gallery-parent-ready' });

for (const name of order) {
  devices[name].querySelector('.device-hitbox').onclick = () => {
    if (!armed) return;
    const media = armed; disarm();
    perform(() => move(media.kind, media.slot, name));
  };
  if (name === 'schnuartz') {
    for (const button of devices[name].querySelectorAll('[data-schnuartz-mode]')) {
      button.onclick = () => {
        const nextMode = button.dataset.schnuartzMode;
        if (!schnuartzModes[nextMode] || nextMode === schnuartzMode) return;
        schnuartzMode = nextMode;
        for (const option of devices[name].querySelectorAll('[data-schnuartz-mode]')) {
          option.setAttribute('aria-pressed', String(option.dataset.schnuartzMode === schnuartzMode));
        }
        ready.delete(name);
        childVersions.delete(name);
        delete feedbackVersions[name];
        delete feedbackBuilds[name];
        devices[name].querySelector('.device-status').textContent = 'Restarting locally…';
        const url = new URL(frames[name].src, location.href);
        url.searchParams.delete('buildVariant');
        if (schnuartzModes[schnuartzMode].query) {
          url.searchParams.set('buildVariant', schnuartzModes[schnuartzMode].query);
        }
        frames[name].addEventListener('load', () => message(name, { type: 'gallery-parent-ready' }), { once: true });
        frames[name].src = url.href;
        loadBuildMetadata(name);
      };
    }
  } else {
    devices[name].querySelector('.restart-device').onclick = () => {
      message(name, { type: 'runtime-restart' });
      devices[name].querySelector('.device-status').textContent = 'Restarting locally…';
      ready.delete(name);
    };
  }
}

async function loadBuildMetadata(name) {
  const generation = (metadataGeneration.get(name) || 0) + 1;
  metadataGeneration.set(name, generation);
  const current = () => metadataGeneration.get(name) === generation;
  try {
    const pointer = await (await fetch(pointerPath(name), { cache: 'no-store' })).json();
    const info = await (await fetch(`${pointer.build}build-info.json`, { cache: 'no-store' })).json();
    const allowedRepositories = name === 'diy' ?
      ['cryptoadvance/specter-diy', 'schnuartz/specter-diy', 'schnuartz-ai/specter-diy'] :
      name === 'schnuartz' ?
        (schnuartzMode === 'alternative'
          ? ['schnuartz-ai/specter-playground-schnuartz']
          : ['schnuartz/specter-playground']) : [feedbackRepositories[name]];
    if (!/^[a-f0-9]{40}$/.test(info.commit) ||
        !allowedRepositories.map(repository => repository.toLowerCase())
          .includes(info.repository?.toLowerCase()) ||
        !pointer.build.includes(`/${info.commit}/`) ||
        pointer.version !== info.artifact_set_sha256?.slice(0, 16)) {
      throw new Error('Build manifest mismatch');
    }
    if (!current()) return;
    feedbackVersions[name] = pointer.version || info.commit?.slice(0, 7) || 'Unknown';
    feedbackBuilds[name] = pointer.build;
    const child = childVersions.get(name);
    if (child && (child.version !== feedbackVersions[name] || child.build !== feedbackBuilds[name])) {
      ready.delete(name);
      devices[name].querySelector('.device-status').textContent = 'Build changed · reload this page';
    }
    if (name === 'diy') {
      if (!/^\d+\.\d+\.\d+(?:-rc\d+)?$/.test(info.firmware_version)) {
        throw new Error('Missing firmware version in build manifest');
      }
      devices[name].querySelector('.subtitle').textContent =
        `newest v${info.firmware_version} Firmware`;
    }
    const link = devices[name].querySelector('.source-link');
    if (name === 'schnuartz') feedbackRepositories[name] = info.repository;
    const repositoryUrl = `https://github.com/${info.repository}`;
    const commitUrl = `${repositoryUrl}/commit/${info.commit}`;
    // The current local Schnuartz build can be ahead of the public repository.
    // Keep its link useful until that source commit is published on GitHub.
    const sourceUrl = name === 'schnuartz' && schnuartzMode === 'normal' ? repositoryUrl : commitUrl;
    link.href = sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = name === 'schnuartz' && schnuartzMode === 'normal'
      ? `GitHub · ${info.repository}`
      : info.firmware_version
      ? `GitHub · v${info.firmware_version}`
      : `GitHub · ${info.commit.slice(0, 7)}`;
    const technical = document.querySelector(`[data-tech-device="${name}"]`);
    if (technical) {
      const repository = technical.querySelector('[data-tech-repository]');
      repository.href = repositoryUrl;
      repository.target = '_blank';
      repository.rel = 'noopener noreferrer';
      repository.textContent = info.repository;
      const commit = technical.querySelector('[data-tech-commit]');
      commit.href = sourceUrl;
      commit.target = '_blank';
      commit.rel = 'noopener noreferrer';
      commit.textContent = info.commit.slice(0, 12);
      technical.querySelector('[data-tech-context]').textContent = [
        info.firmware_version && `Firmware: v${info.firmware_version}`,
        `Artifact: ${pointer.version}`,
      ].filter(Boolean).join(' · ');
    }
  } catch {
    if (!current()) return;
    devices[name].querySelector('.source-link').textContent = 'GitHub · unavailable';
    devices[name].querySelector('.device-status').textContent = 'Build information unavailable';
    const technical = document.querySelector(`[data-tech-device="${name}"]`);
    if (technical) {
      technical.querySelector('[data-tech-repository]').textContent = 'Unavailable';
      technical.querySelector('[data-tech-commit]').textContent = 'Unavailable';
      technical.querySelector('[data-tech-context]').textContent = 'Build information unavailable.';
    }
  }
}

for (const name of order) loadBuildMetadata(name);

const feedbackMessage = document.querySelector('#feedback-message');
const feedbackDevice = document.querySelector('#feedback-device');
const feedbackSubmit = document.querySelector('#feedback-submit');
const feedbackSave = document.querySelector('#feedback-save');
const feedbackStatus = document.querySelector('#feedback-status');
const feedbackList = document.querySelector('#feedback-list');
const feedbackScreenshot = document.querySelector('#feedback-screenshot');
const feedbackPreview = document.querySelector('#feedback-preview');
const feedbackApi = '/api/feedback';
const reactionStorageKey = 'try-clavastack-feedback-reactions-v1';
const statusLabels = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
let screenshotData = '';
let ownReactions = {};
try { ownReactions = JSON.parse(localStorage.getItem(reactionStorageKey) || '{}') || {}; } catch {}
let savedFeedback = [];
function renderFeedback() {
  feedbackList.replaceChildren();
  if (!savedFeedback.length) {
    const empty = document.createElement('li');
    empty.className = 'feedback-empty';
    empty.textContent = 'No shared comments yet.';
    feedbackList.append(empty);
    return;
  }
  for (const item of savedFeedback) {
    const entry = document.createElement('li');
    entry.className = 'feedback-item';
    const head = document.createElement('div');
    head.className = 'feedback-item-head';
    const label = document.createElement('strong');
    label.textContent = item.label;
    const time = document.createElement('time');
    time.dateTime = item.createdAt || '';
    const date = new Date(item.createdAt);
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    head.append(label, time);
    const body = document.createElement('p');
    body.textContent = item.comment;
    const details = document.createElement('div');
    details.className = 'feedback-item-details';
    details.textContent = `Firmware: ${item.version || 'Unknown'} · Browser: ${item.browser || 'Unknown'}`;
    const state = document.createElement('div');
    state.className = 'feedback-item-state';
    const stateLabel = document.createElement('span');
    stateLabel.textContent = 'Status';
    const stateSelect = document.createElement('select');
    stateSelect.className = 'feedback-status';
    stateSelect.setAttribute('aria-label', `Status for ${item.label}`);
    for (const [value, text] of Object.entries(statusLabels)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      stateSelect.append(option);
    }
    stateSelect.value = statusLabels[item.status] ? item.status : 'new';
    stateSelect.addEventListener('change', () => changeFeedbackStatus(item, stateSelect));
    state.append(stateLabel, stateSelect);
    entry.append(head, details, body, state);
    if (item.screenshotUrl && item.screenshotUrl.startsWith('/api/feedback/media/')) {
      const screenshotLink = document.createElement('a');
      screenshotLink.href = item.screenshotUrl;
      screenshotLink.target = '_blank';
      screenshotLink.rel = 'noopener noreferrer';
      const screenshot = document.createElement('img');
      screenshot.className = 'feedback-screenshot';
      screenshot.src = item.screenshotUrl;
      screenshot.alt = `Screenshot attached to ${item.label} feedback`;
      screenshot.loading = 'lazy';
      screenshotLink.append(screenshot);
      entry.append(screenshotLink);
    }
    const reactions = document.createElement('div');
    reactions.className = 'feedback-reactions';
    for (const [reaction, symbol, label] of [['like', '👍', 'Like'], ['dislike', '👎', 'Dislike']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${symbol} ${item[reaction === 'like' ? 'likes' : 'dislikes'] || 0}`;
      button.title = label;
      button.setAttribute('aria-label', `${label} this comment`);
      if (ownReactions[item.id]) {
        button.disabled = true;
        if (ownReactions[item.id] === reaction) button.classList.add('selected');
      }
      button.addEventListener('click', () => reactToFeedback(item, reaction));
      reactions.append(button);
    }
    entry.append(reactions);
    feedbackList.append(entry);
  }
}
function setFeedbackStatus(message) {
  feedbackStatus.textContent = message;
}
async function loadFeedback() {
  try {
    const response = await fetch(feedbackApi, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    savedFeedback = Array.isArray(data.comments) ? data.comments : [];
    renderFeedback();
    setFeedbackStatus(`${savedFeedback.length} shared comment${savedFeedback.length === 1 ? '' : 's'}.`);
  } catch {
    setFeedbackStatus('Shared comments could not be loaded. Please try again later.');
  }
}
async function changeFeedbackStatus(item, select) {
  const previous = item.status || 'new';
  select.disabled = true;
  try {
    const response = await fetch(`${feedbackApi}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: select.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.comment) throw new Error(data.error || `HTTP ${response.status}`);
    const index = savedFeedback.findIndex(candidate => candidate.id === item.id);
    if (index >= 0) savedFeedback[index] = data.comment;
    renderFeedback();
    setFeedbackStatus('Status updated for everyone.');
  } catch (error) {
    select.value = previous;
    setFeedbackStatus(`Status could not be updated: ${error.message}`);
  } finally {
    select.disabled = false;
  }
}
async function reactToFeedback(item, reaction) {
  if (ownReactions[item.id]) return;
  try {
    const response = await fetch(`${feedbackApi}/reaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, reaction }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.comment) throw new Error(data.error || `HTTP ${response.status}`);
    const index = savedFeedback.findIndex(candidate => candidate.id === item.id);
    if (index >= 0) savedFeedback[index] = data.comment;
    ownReactions[item.id] = reaction;
    try { localStorage.setItem(reactionStorageKey, JSON.stringify(ownReactions)); } catch {}
    renderFeedback();
  } catch (error) {
    setFeedbackStatus(`Reaction could not be saved: ${error.message}`);
  }
}
function currentFeedback() {
  const device = devices[feedbackDevice.value];
  return {
    variant: feedbackDevice.value,
    comment: feedbackMessage.value.trim(),
    label: feedbackDevice.selectedOptions[0].textContent,
    source: device.querySelector('.source-link').getAttribute('href') || 'Build information unavailable',
    version: feedbackVersions[feedbackDevice.value] || 'Loading…',
    browser: browserLabel(),
    screenshot: screenshotData || undefined,
  };
}
function browserLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other browser';
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other device';
  return `${browser} on ${platform}`;
}
function clearScreenshot() {
  screenshotData = '';
  feedbackScreenshot.value = '';
  feedbackPreview.replaceChildren();
  feedbackPreview.hidden = true;
}
feedbackScreenshot.addEventListener('change', () => {
  const file = feedbackScreenshot.files?.[0];
  if (!file) { clearScreenshot(); return; }
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    clearScreenshot();
    setFeedbackStatus('Screenshot must be PNG, JPEG, GIF or WebP up to 2 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    screenshotData = typeof reader.result === 'string' ? reader.result : '';
    feedbackPreview.replaceChildren();
    if (screenshotData) {
      const image = document.createElement('img');
      image.src = screenshotData;
      image.alt = 'Screenshot preview';
      feedbackPreview.append(image);
    }
    feedbackPreview.hidden = !screenshotData;
    setFeedbackStatus('Screenshot attached to the next comment.');
  };
  reader.readAsDataURL(file);
});
async function saveCurrentFeedback() {
  const current = currentFeedback();
  if (!current.comment) return;
  feedbackSave.disabled = true;
  feedbackSave.textContent = 'Saving…';
  setFeedbackStatus('Saving comment for everyone…');
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.comment) throw new Error(data.error || `HTTP ${response.status}`);
    savedFeedback = [data.comment, ...savedFeedback.filter(item => item.id !== data.comment.id)];
    renderFeedback();
    feedbackMessage.value = '';
    clearScreenshot();
    setFeedbackStatus('Comment saved and visible to everyone.');
  } catch (error) {
    setFeedbackStatus(`Comment could not be saved: ${error.message}`);
  } finally {
    feedbackSave.textContent = 'Save comment';
    updateFeedback();
  }
}
function updateFeedback() {
  const comment = feedbackMessage.value.trim();
  document.querySelector('#feedback-count').textContent = `${feedbackMessage.value.length} / 5000 characters`;
  const hasComment = comment.length > 0;
  const valid = comment.length >= 10;
  feedbackSave.disabled = !hasComment;
  feedbackSubmit.setAttribute('aria-disabled', String(!valid));
  if (!valid) { feedbackSubmit.href = '#feedback-message'; return; }
  const device = devices[feedbackDevice.value];
  const source = device.querySelector('.source-link').getAttribute('href') || 'Build information unavailable';
  const label = feedbackDevice.selectedOptions[0].textContent;
  const body = `${comment}\n\n---\nSimulator: ${label}\nFirmware source: ${source}\n\nBrowser simulator feedback; no seed phrases or private keys included.`;
  const query = new URLSearchParams({ title: `Simulator feedback: ${label}`, body });
  const repository = feedbackRepositories[feedbackDevice.value];
  feedbackSubmit.href = `https://github.com/${repository}/issues/new?${query}`;
}
feedbackMessage.addEventListener('input', updateFeedback);
feedbackDevice.addEventListener('change', updateFeedback);
feedbackSave.addEventListener('click', saveCurrentFeedback);
document.querySelector('#feedback-form').addEventListener('submit', event => event.preventDefault());
renderFeedback();
loadFeedback();
updateFeedback();

let drag;
for (const token of document.querySelectorAll('.media-token')) {
  token.onpointerdown = event => {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    token.setPointerCapture(event.pointerId);
    drag = { token, kind: token.dataset.media, slot: Number(token.dataset.slot) || null,
      x: event.clientX, y: event.clientY, ghost: null };
  };
  token.onpointermove = event => {
    if (!drag || drag.token !== token) return;
    if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 7) {
      drag.ghost = document.createElement('div'); drag.ghost.className = 'drag-ghost';
      drag.ghost.append((token.querySelector('img') || token.querySelector('.card-art')).cloneNode(true));
      document.body.append(drag.ghost); disarm();
    }
    if (!drag.ghost) return;
    drag.ghost.style.left = `${event.clientX}px`; drag.ghost.style.top = `${event.clientY}px`;
    for (const name of order) devices[name].classList.toggle('drop-target', Boolean(targetAt(event.clientX, event.clientY) === name));
  };
  token.onpointerup = event => {
    if (!drag || drag.token !== token) return;
    const item = drag;
    const target = item.ghost && targetAt(event.clientX, event.clientY);
    cleanupDrag();
    if (target) perform(() => move(item.kind, item.slot, target));
    else if (!item.ghost) select(item);
  };
  token.onpointercancel = cleanupDrag;
  if (token.dataset.media === 'card') token.oncontextmenu = event => {
    event.preventDefault();
    const slot = Number(token.dataset.slot);
    if (!confirm(`Reset MemoryCard ${slot}? Its simulated keys and PIN will be wiped.`)) return;
    perform(async () => {
      await detach('card', slot);
      for (const path of [...mediaFiles.keys()]) if (path.startsWith(`cards/${slot}/`)) mediaFiles.delete(path);
      report(`MemoryCard ${slot} reset.`);
    });
  };
}
function targetAt(x, y) {
  return order.find(name => {
    const rect = devices[name].querySelector('.device-frame').getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}
function cleanupDrag() {
  drag?.ghost?.remove(); drag = null;
  for (const name of order) devices[name].classList.remove('drop-target');
}
addEventListener('keydown', event => { if (event.key === 'Escape') disarm(); });

const picker = document.querySelector('#sd-picker');
document.querySelector('#sd-add').onclick = () => picker.click();
picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
const drop = document.querySelector('#sd-drop');
drop.ondragover = event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); };
drop.ondrop = event => { event.preventDefault(); addFiles(event.dataTransfer.files); };
function addFiles(files) {
  perform(async () => {
    const sizes = new Map(filesFor('sd/').map(file => [file.path, file.bytes.byteLength]));
    let projected = [...sizes.values()].reduce((total, size) => total + size, 0);
    for (const file of files) {
      const path = `sd/${file.name}`;
      projected = projected - (sizes.get(path) || 0) + file.size;
      sizes.set(path, file.size);
    }
    if (projected > SD_CAPACITY_BYTES) throw new Error('Virtual SD card is full: imported files would exceed its 8 GB capacity');
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (sdOwner) command(sdOwner, { type: 'sd-import', name: file.name, bytes });
      else mediaFiles.set(`sd/${file.name}`, bytes);
    }
    if (sdOwner) saveMedia(await snapshot(sdOwner), 'sd/');
    report(`${files.length} file${files.length === 1 ? '' : 's'} added to the virtual SD card.`);
  });
}
const demoButton = document.querySelector('#demo-load');
const demoStatus = document.querySelector('#demo-status');
demoButton.onclick = () => perform(async () => {
  if (!ready.has('diy')) throw new Error('Specter DIY is still starting.');
  demoButton.disabled = true;
  demoStatus.textContent = 'Importing demo data…';
  try {
    const { createDemoFiles } = await import('/browser/demo-data.js?v=20260916-multisig-psbt');
    const demo = createDemoFiles();

    if (sdOwner && sdOwner !== 'diy') await detach('sd', null);
    if (sdOwner !== 'diy') command('diy', { type: 'sd-insert' });
    for (const file of demo.files) {
      command('diy', { type: 'sd-import', name: file.name, bytes: file.bytes });
    }

    for (const card of demo.cards) {
      if (cardOwners.get(card.slot) && cardOwners.get(card.slot) !== 'diy') await detach('card', card.slot);
      command('diy', { type: 'state-import', files: [
        { path: `cards/${card.slot}/secret.bin`, bytes: card.secret },
        { path: `cards/${card.slot}/pin.bin`, bytes: card.pinDigest },
        { path: `cards/${card.slot}/attempts`, bytes: new Uint8Array([10]) },
      ] });
    }

    const imported = await snapshot('diy');
    saveMedia(imported, 'sd/');
    sdOwner = 'diy';
    for (const card of demo.cards) saveMedia(imported, prefix('card', card.slot));

    if (cardOwners.get(1) !== 'diy') {
      command('diy', { type: 'card-insert', slot: 1 });
      await snapshot('diy');
      cardOwners.set(1, 'diy');
    }
    cardOwners.set(2, null);
    report('Demo data imported into device 1.');
    demoButton.textContent = 'Import Demo Data Again';
    demoStatus.textContent = 'Demo data imported into device 1.';
  } finally {
    demoButton.disabled = false;
  }
});
document.querySelector('#sd-refresh').onclick = () => perform(async () => {
  if (sdOwner) saveMedia(await snapshot(sdOwner), 'sd/');
  report('SD files refreshed from Specter.');
});
document.querySelector('#sd-clear').onclick = () => perform(async () => {
  if (sdOwner) { command(sdOwner, { type: 'sd-clear' }); saveMedia(await snapshot(sdOwner), 'sd/'); }
  else for (const path of [...mediaFiles.keys()]) if (path.startsWith('sd/')) mediaFiles.delete(path);
  report('Virtual SD card cleared.');
});
render();
