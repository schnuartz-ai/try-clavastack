const order = ['diy', 'play', 'schnuartz'];
const numbers = { diy: 1, play: 2, schnuartz: 3 };
const pointers = {
  diy: '/browser/current.json',
  play: '/browser/variants/specter-playground.json',
  schnuartz: '/browser/variants/specter-playground-schnuartz.json',
};
const devices = Object.fromEntries(order.map(name => [name, document.querySelector(`[data-device="${name}"]`)]));
const frames = Object.fromEntries(order.map(name => [name, devices[name].querySelector('iframe')]));
const ready = new Set();
const pending = new Map();
const mediaFiles = new Map();
const cardOwners = new Map([[1, null], [2, null], [3, null]]);
let sdOwner = null;
let requestId = 0;
let armed = null;
let busy = false;

function message(name, data) {
  frames[name].contentWindow.postMessage(data, location.origin);
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
  for (const path of [...mediaFiles.keys()]) if (path.startsWith(pathPrefix)) mediaFiles.delete(path);
  for (const file of files) if (file.path.startsWith(pathPrefix)) mediaFiles.set(file.path, file.bytes);
}
function filesFor(pathPrefix) {
  return [...mediaFiles].filter(([path]) => path.startsWith(pathPrefix))
    .map(([path, bytes]) => ({ path, bytes }));
}
function locationLabel(owner) { return owner ? `Inserted in device ${numbers[owner]}` : 'Not inserted'; }
function report(text) { document.querySelector('#transfer-state').textContent = text; }
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
    ready.add(name);
    devices[name].querySelector('.device-status').textContent = 'Running locally · drag cards here';
  } else if (data.type === 'simulator-error') {
    devices[name].querySelector('.device-status').textContent = data.message;
  } else if (data.type === 'peripherals-snapshot' && data.variant === name) {
    const request = pending.get(data.requestId);
    if (request?.name === name) { pending.delete(data.requestId); request.resolve(data.files); }
  }
});

for (const name of order) {
  devices[name].querySelector('.device-hitbox').onclick = () => {
    if (!armed) return;
    const media = armed; disarm();
    perform(() => move(media.kind, media.slot, name));
  };
  devices[name].querySelector('.restart-device').onclick = () => {
    message(name, { type: 'runtime-restart' });
    devices[name].querySelector('.device-status').textContent = 'Restarting locally…';
    ready.delete(name);
  };
  (async () => {
    try {
      const pointer = await (await fetch(pointers[name], { cache: 'no-store' })).json();
      const info = await (await fetch(`${pointer.build}build-info.json`, { cache: 'no-store' })).json();
      const link = devices[name].querySelector('.source-link');
      link.href = `${info.source_url}/commit/${info.commit}`;
      link.textContent = `GitHub · ${info.commit.slice(0, 7)}`;
    } catch { devices[name].querySelector('.device-status').textContent = 'Build information unavailable'; }
  })();
}

const feedbackMessage = document.querySelector('#feedback-message');
const feedbackDevice = document.querySelector('#feedback-device');
const feedbackSubmit = document.querySelector('#feedback-submit');
function updateFeedback() {
  const comment = feedbackMessage.value.trim();
  document.querySelector('#feedback-count').textContent = `${feedbackMessage.value.length} / 5000 characters`;
  const valid = comment.length >= 10;
  feedbackSubmit.setAttribute('aria-disabled', String(!valid));
  if (!valid) { feedbackSubmit.href = '#feedback-message'; return; }
  const device = devices[feedbackDevice.value];
  const source = device.querySelector('.source-link').href;
  const label = feedbackDevice.selectedOptions[0].textContent;
  const body = `${comment}\n\n---\nSimulator: ${label}\nFirmware source: ${source}\n\nBrowser simulator feedback; no seed phrases or private keys included.`;
  const query = new URLSearchParams({ title: `Simulator feedback: ${label}`, body });
  feedbackSubmit.href = `https://github.com/schnuartz-ai/try-clavastack/issues/new?${query}`;
}
feedbackMessage.addEventListener('input', updateFeedback);
feedbackDevice.addEventListener('change', updateFeedback);
document.querySelector('#feedback-form').addEventListener('submit', event => event.preventDefault());
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
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (sdOwner) command(sdOwner, { type: 'sd-import', name: file.name, bytes });
      else mediaFiles.set(`sd/${file.name}`, bytes);
    }
    if (sdOwner) saveMedia(await snapshot(sdOwner), 'sd/');
    report(`${files.length} file${files.length === 1 ? '' : 's'} added to the virtual SD card.`);
  });
}
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
