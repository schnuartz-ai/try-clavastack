// The Worker owns Emscripten MEMFS and the Specter Python application.
let runtimeReady = false;
const pending = [];
const qrQueue = [];
const usbQueue = [];
let scannerActive = false;
let usbEnabled = false;
let program = 'wallet';
self.screen = { width: 480, height: 800 };
const send = (type, details = {}) => postMessage({ type, ...details });
const workerRevision = '2026-10-04.abdev1';
// Unix firmware normally exits its process. A browser reboot must preserve
// MEMFS and ask the page to replace this Worker instead.
const rebootPython = `import platform
def reboot():
    with open('/bridge/reboot-requested', 'wb') as f:
        f.write(b'1')
platform.reboot = reboot
`;
function pollReboot() {
  const fs = Module.FS;
  if (!fs.analyzePath('/bridge/reboot-requested').exists) return;
  fs.unlink('/bridge/reboot-requested');
  send('reboot');
}
let inspectorEnabled = false;
// Runs on the firmware's own asyncio loop; never re-enter the WASM VM from JS.
const inspectorPython = `import os, gc, json, asyncio
def install(main):
    original = main.Specter.setup
    async def report(device):
        while True:
            try:
                with open('/bridge/inspector-request', 'r') as f:
                    request = json.loads(f.read())
                os.remove('/bridge/inspector-request')
                store = device.keystore
                screen = getattr(device.gui, 'scr', None)
                mnemonic = getattr(store, 'mnemonic', None)
                mnemonic_text = mnemonic if isinstance(mnemonic, str) else None
                root = getattr(store, 'root', None)
                enc_secret = getattr(store, 'enc_secret', None)
                data = {'requestId': int(request.get('requestId')), 'allocatedBytes': gc.mem_alloc(), 'freeBytes': gc.mem_free(),
                    'network': device.network, 'menu': getattr(device.current_menu, '__name__', 'unknown'),
                    'screen': type(screen).__name__ if screen is not None else 'unavailable',
                    'keystore': type(store).__name__ if store is not None else None,
                    'keystoreObjects': {
                        'keystore.mnemonic': {'present': mnemonic_text is not None,
                            'wordCount': len(mnemonic_text.split()) if mnemonic_text is not None else 0,
                            'utf8Bytes': len(mnemonic_text.encode()) if mnemonic_text is not None else 0},
                        'keystore.root': {'present': root is not None,
                            'type': type(root).__name__ if root is not None else None},
                        'keystore.enc_secret': {'loaded': enc_secret is not None,
                            'bytes': len(enc_secret) if enc_secret is not None else 0},
                        'bip39_seed': {'retainedAsKeystoreField': False,
                            'note': 'Temporary local value during mnemonic derivation.'}},
                    'apps': [type(app).__name__ for app in device.apps]}
                if request.get('includeSensitive') and mnemonic_text is not None:
                    data['sensitiveValues'] = {'keystore.mnemonic': mnemonic_text}
                with open('/bridge/inspector-state.json', 'w') as f:
                    json.dump(data, f)
            except OSError:
                pass
            except Exception as e:
                with open('/bridge/inspector-state.json', 'w') as f:
                    json.dump({'error': str(e)}, f)
            await asyncio.sleep_ms(100)
    started = [False]
    async def setup(device):
        if not started[0]:
            asyncio.create_task(report(device))
            started[0] = True
        return await original(device)
    main.Specter.setup = setup
`;
function inspectFiles(fs) {
  const files = [];
  for (const root of program === 'mockui' ? ['/state', '/flash'] : ['/state']) {
    for (const file of walk(fs, root)) {
      const path = `${root}/${file.path}`;
      // Hash every byte in bounded chunks; comparisons include same-size rewrites.
      let hash = 2166136261;
      const stream = fs.open(path, 'r');
      try {
        const buffer = new Uint8Array(65536);
        let count;
        while ((count = fs.read(stream, buffer, 0, buffer.length)) > 0) {
          for (let i = 0; i < count; i++) hash = Math.imul(hash ^ buffer[i], 16777619) >>> 0;
        }
      } finally { fs.close(stream); }
      files.push({ path, size: file.size, hash: hash.toString(16).padStart(8, '0') });
    }
  }
  return files;
}
function sendInspection(data, attempts = 0) {
  try { collectInspection(data, attempts); }
  catch (error) { send('operation-error', { operation: 'inspector-state', message: error.message || String(error) }); }
}
function collectInspection(data, attempts) {
  const fs = Module.FS;
  if (!inspectorEnabled) {
    const statePath = '/bridge/inspector-state.json';
    if (fs.analyzePath(statePath).exists) fs.unlink(statePath);
    return;
  }
  let firmware = null;
  if (fs.analyzePath('/bridge/inspector-state.json').exists) {
    firmware = JSON.parse(fs.readFile('/bridge/inspector-state.json', { encoding: 'utf8' }));
  }
  if (program === 'wallet' && firmware?.requestId !== data.requestId && attempts < 40) {
    setTimeout(() => sendInspection(data, attempts + 1), 50);
    return;
  }
  const matchingFirmware = firmware?.requestId === data.requestId ? firmware : null;
  const { sensitiveValues, ...firmwareState } = matchingFirmware || {};
  send('inspector-state', { requestId: data.requestId, files: data.includeFiles ? inspectFiles(fs) : null,
    memoryBytes: Module.HEAPU8.buffer.byteLength,
    firmware: matchingFirmware ? firmwareState : { error: program === 'mockui'
      ? 'This MockUI build does not expose Specter DIY keystore or firmware heap metrics.'
      : 'Firmware metrics unavailable during this operation; refresh to retry.' },
    sensitiveValues: data.includeSensitive ? sensitiveValues || {} : undefined,
    scannerActive, usbEnabled, qrQueued: qrQueue.length, usbQueued: usbQueue.length,
    sdInserted: fs.analyzePath('/bridge/sd-inserted').exists,
    cardSlot: fs.analyzePath('/bridge/card-slot').exists ? fs.readFile('/bridge/card-slot')[0] : null });
  if (data.includeSensitive && fs.analyzePath('/bridge/inspector-state.json').exists) {
    fs.unlink('/bridge/inspector-state.json');
  }
}
const SD_CAPACITY_BYTES = 8_000_000_000;
const SD_ENOSPC = 51;
let fatalReported = false;
function reportError(error, source, details = {}) {
  if (fatalReported) return;
  fatalReported = true;
  send('worker-error', { name: error?.name || 'WorkerError', message: error?.message || String(error),
    stack: error?.stack, source, ...details });
}
send('diagnostic', { event: 'worker-created', workerRevision, userAgent: navigator.userAgent,
  crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory ?? 'unavailable', OffscreenCanvas: typeof OffscreenCanvas,
  requestAnimationFrame: typeof self.requestAnimationFrame });
// Observe the actual Emscripten requests without cloning the large WASM response.
const nativeFetch = self.fetch.bind(self);
self.fetch = async (input, options) => {
  const url = String(input?.url || input);
  const started = performance.now();
  send('diagnostic', { event: 'asset-request', url, method: options?.method || 'GET' });
  try {
    const response = await nativeFetch(input, options);
    const mime = response.headers.get('content-type');
    send('diagnostic', { event: 'asset-response', url, status: response.status, mime,
      cacheControl: response.headers.get('cache-control'), contentLength: response.headers.get('content-length'),
      elapsedMs: Math.round(performance.now() - started) });
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
    if (/\.wasm(?:\?|$)/.test(url) && !/^application\/wasm(?:;|$)/i.test(mime || '')) {
      send('diagnostic', { event: 'mime-warning', message: `WASM MIME ${mime}; Emscripten will use ArrayBuffer compilation`, url });
    }
    return response;
  } catch (error) {
    reportError(error, 'asset-fetch', { url });
    throw error;
  }
};
self.addEventListener('error', event => {
  reportError(event.error || new Error(event.message || 'Unhandled worker error'), 'worker.error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});
self.addEventListener('unhandledrejection', event => {
  reportError(event.reason, 'unhandledrejection');
  event.preventDefault();
});

function relativePath(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Invalid SD path');
  }
  return name;
}
function mkdirs(fs, path) {
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += '/' + part;
    try { fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
function walk(fs, root, prefix = '') {
  const files = [];
  for (const name of fs.readdir(root)) {
    if (name === '.' || name === '..') continue;
    const path = `${root}/${name}`;
    const relative = prefix ? `${prefix}/${name}` : name;
    if (fs.isDir(fs.stat(path).mode)) files.push(...walk(fs, path, relative));
    else files.push({ path: relative, size: fs.stat(path).size });
  }
  return files;
}
function sdStorage(fs) {
  const files = walk(fs, '/state/sd');
  const usedBytes = files.reduce((total, file) => total + file.size, 0);
  return { files, usedBytes, freeBytes: SD_CAPACITY_BYTES - usedBytes,
    capacityBytes: SD_CAPACITY_BYTES };
}
function sendSdList(fs) {
  send('sd-list', sdStorage(fs));
}
function prepareStateImport(fs, files) {
  const storage = sdStorage(fs);
  const sizes = new Map(storage.files.map(file => [file.path, file.size]));
  let projected = storage.usedBytes;
  const prepared = [];
  for (const file of files || []) {
    const name = relativePath(file.path);
    if (!name.startsWith('sd/') && !/^cards\/[123]\//.test(name)) {
      throw new Error('Invalid peripheral path');
    }
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    if (name.startsWith('sd/')) {
      const sdName = name.slice(3);
      projected = projected - (sizes.get(sdName) || 0) + bytes.byteLength;
      sizes.set(sdName, bytes.byteLength);
    }
    prepared.push({ name, bytes });
  }
  if (projected > SD_CAPACITY_BYTES) {
    throw sdFullError(fs, storage.usedBytes, Math.max(0, projected - storage.usedBytes));
  }
  return prepared;
}
function isSdPath(path) {
  return path === '/state/sd' || path.startsWith('/state/sd/');
}
function sdFullError(fs, usedBytes, requestedBytes) {
  const error = new fs.ErrnoError(SD_ENOSPC);
  error.message = `Virtual SD card is full: ${usedBytes + requestedBytes} bytes would exceed its 8 GB (${SD_CAPACITY_BYTES} byte) capacity`;
  error.code = 'ENOSPC';
  error.capacityBytes = SD_CAPACITY_BYTES;
  error.usedBytes = usedBytes;
  error.requestedBytes = requestedBytes;
  return error;
}
function assertSdProjectedSize(fs, node, nextSize) {
  const currentSize = node.usedBytes ?? fs.stat(fs.getPath(node)).size;
  const usedBytes = sdStorage(fs).usedBytes;
  const projected = usedBytes - currentSize + nextSize;
  if (projected > SD_CAPACITY_BYTES) {
    throw sdFullError(fs, usedBytes, Math.max(0, nextSize - currentSize));
  }
}
function installSdQuota(fs) {
  if (fs.__specterSdQuotaInstalled) return;
  fs.__specterSdQuotaInstalled = true;

  const originalWrite = fs.write.bind(fs);
  fs.write = (stream, buffer, offset, length, position, canOwn) => {
    const path = fs.getPath(stream.node);
    if (isSdPath(path)) {
      const currentSize = stream.node.usedBytes ?? fs.stat(path).size;
      const writeAt = stream.seekable && (stream.flags & 1024)
        ? currentSize : (typeof position === 'undefined' ? stream.position : position);
      assertSdProjectedSize(fs, stream.node, Math.max(currentSize, writeAt + length));
    }
    return originalWrite(stream, buffer, offset, length, position, canOwn);
  };

  const originalWriteFile = fs.writeFile.bind(fs);
  fs.writeFile = (path, data, options) => {
    if (typeof path === 'string' && isSdPath(path)) {
      const result = fs.analyzePath(path);
      const node = result.exists ? result.object : { usedBytes: 0 };
      const byteLength = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
      assertSdProjectedSize(fs, node, byteLength);
    }
    return originalWriteFile(path, data, options);
  };

  const originalTruncate = fs.truncate.bind(fs);
  fs.truncate = (path, length) => {
    const node = typeof path === 'string' ? fs.lookupPath(path, { follow: true }).node : path;
    if (isSdPath(fs.getPath(node))) assertSdProjectedSize(fs, node, length);
    return originalTruncate(path, length);
  };

  const originalAllocate = fs.allocate.bind(fs);
  fs.allocate = (stream, offset, length) => {
    if (isSdPath(fs.getPath(stream.node))) {
      const currentSize = stream.node.usedBytes ?? 0;
      assertSdProjectedSize(fs, stream.node, Math.max(currentSize, offset + length));
    }
    return originalAllocate(stream, offset, length);
  };

  const originalMsync = fs.msync.bind(fs);
  fs.msync = (stream, buffer, offset, length, flags) => {
    if (isSdPath(fs.getPath(stream.node))) {
      const currentSize = stream.node.usedBytes ?? 0;
      assertSdProjectedSize(fs, stream.node, Math.max(currentSize, offset + length));
    }
    return originalMsync(stream, buffer, offset, length, flags);
  };

  const originalStatfs = fs.statfs.bind(fs);
  fs.statfs = path => {
    const stats = originalStatfs(path);
    const node = typeof path === 'string' ? fs.lookupPath(path, { follow: true }).node : path;
    if (!isSdPath(fs.getPath(node))) return stats;
    const storage = sdStorage(fs);
    const blockSize = 4096;
    return { ...stats, bsize: blockSize, frsize: blockSize,
      blocks: Math.floor(SD_CAPACITY_BYTES / blockSize),
      bfree: Math.floor(storage.freeBytes / blockSize),
      bavail: Math.floor(storage.freeBytes / blockSize) };
  };
}
function flushQr() {
  if (!runtimeReady || !qrQueue.length) return;
  const fs = Module.FS;
  if (fs.analyzePath('/bridge/qr.bin').exists) return;
  const bytes = qrQueue.shift();
  const framed = new Uint8Array(bytes.length + 2);
  framed.set(bytes);
  framed.set([13, 10], bytes.length);
  fs.writeFile('/bridge/qr.bin', framed);
  send('qr-delivered', { size: bytes.length });
}
function pollScanner() {
  if (!runtimeReady) return;
  const active = Module.FS.analyzePath('/bridge/scan-active').exists;
  if (active !== scannerActive) {
    scannerActive = active;
    send('scanner-state', { active });
  }
}
function flushUsb() {
  if (!runtimeReady || !usbQueue.length) return;
  const fs = Module.FS;
  if (fs.analyzePath('/bridge/usb-in.bin').exists) return;
  fs.writeFile('/bridge/usb-in.bin', usbQueue.shift());
}
function pollUsb() {
  if (!runtimeReady) return;
  const fs = Module.FS;
  const enabled = fs.analyzePath('/bridge/usb-enabled').exists;
  if (enabled !== usbEnabled) {
    usbEnabled = enabled;
    send('usb-state', { enabled });
  }
  if (fs.analyzePath('/bridge/usb-out.bin').exists) {
    const bytes = fs.readFile('/bridge/usb-out.bin');
    fs.unlink('/bridge/usb-out.bin');
    if (bytes.byteLength) send('usb-output', { bytes });
  }
  flushUsb();
}
function cardSlot(value) {
  if (![1, 2, 3].includes(value)) throw new Error('Invalid Smartcard slot');
  return value;
}
function cardInfo(fs) {
  const active = fs.analyzePath('/bridge/card-slot').exists
    ? fs.readFile('/bridge/card-slot')[0] : null;
  const slots = [1, 2, 3].map(slot => ({ slot,
    initialized: fs.analyzePath(`/state/cards/${slot}/private.key`).exists }));
  send('card-state', { active, slots });
}
function createCard(fs, slot) {
  const root = `/state/cards/${slot}`;
  mkdirs(fs, root);
  for (const name of fs.readdir(root)) {
    if (name !== '.' && name !== '..') fs.unlink(`${root}/${name}`);
  }
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  fs.writeFile(`${root}/private.key`, key);
  fs.writeFile(`${root}/attempts`, new Uint8Array([10]));
}
function handle(data) {
  const fs = Module.FS;
  try {
    if (data.type === 'inspector-enable') {
      inspectorEnabled = Boolean(data.enabled);
      if (!inspectorEnabled) {
        for (const path of ['/bridge/inspector-request', '/bridge/inspector-state.json']) {
          if (fs.analyzePath(path).exists) fs.unlink(path);
        }
      }
    } else if (data.type.startsWith('inspector-')) {
      if (!inspectorEnabled) throw new Error('Advanced Options are disabled');
      if (data.type === 'inspector-state') {
        fs.writeFile('/bridge/inspector-request', JSON.stringify({
          requestId: data.requestId,
          includeSensitive: data.includeSensitive === true,
        }));
        sendInspection(data);
      } else if (data.type === 'inspector-hide-sensitive') {
        const requestPath = '/bridge/inspector-request';
        if (fs.analyzePath(requestPath).exists) {
          try {
            const request = JSON.parse(fs.readFile(requestPath, { encoding: 'utf8' }));
            if (request.includeSensitive) fs.unlink(requestPath);
          } catch { fs.unlink(requestPath); }
        }
        const statePath = '/bridge/inspector-state.json';
        if (fs.analyzePath(statePath).exists) {
          try {
            const state = JSON.parse(fs.readFile(statePath, { encoding: 'utf8' }));
            delete state.sensitiveValues;
            fs.writeFile(statePath, JSON.stringify(state));
          } catch { fs.unlink(statePath); }
        }
      } else if (data.type === 'inspector-file') {
        const path = data.path;
        if (typeof path !== 'string' || !path.startsWith('/state/') && !(program === 'mockui' && path.startsWith('/flash/'))) throw new Error('Invalid inspector path');
        relativePath(path.slice(1));
        const size = fs.stat(path).size;
        const stream = fs.open(path, 'r');
        const bytes = new Uint8Array(Math.min(size, 65536));
        try { fs.read(stream, bytes, 0, bytes.length, 0); } finally { fs.close(stream); }
        send('inspector-file', { requestId: data.requestId, path, size, bytes });
      } else if (data.type === 'inspector-memory') {
        const address = data.address;
        if (!Number.isSafeInteger(address) || address < 0 || address >= Module.HEAPU8.length) throw new Error('RAM address is outside WebAssembly memory');
        send('inspector-memory', { address, bytes: Module.HEAPU8.slice(address, address + 256) });
      }
    } else if (data.type === 'pointer') {
      if (Module._browser_pointer) Module._browser_pointer(data.x, data.y, data.down);
      else throw new Error('Pointer bridge unavailable');
    } else if (data.type === 'sd-insert') {
      fs.writeFile('/bridge/sd-inserted', new Uint8Array([1]));
      send('sd-state', { inserted: true });
    } else if (data.type === 'sd-eject') {
      try { fs.unlink('/bridge/sd-inserted'); } catch { /* already ejected */ }
      send('sd-state', { inserted: false });
    } else if (data.type === 'sd-import') {
      const name = relativePath(data.name);
      const path = `/state/sd/${name}`;
      mkdirs(fs, path.substring(0, path.lastIndexOf('/')));
      fs.writeFile(path, new Uint8Array(data.bytes));
      sendSdList(fs);
    } else if (data.type === 'sd-delete') {
      fs.unlink(`/state/sd/${relativePath(data.name)}`);
      sendSdList(fs);
    } else if (data.type === 'sd-clear') {
      for (const { path } of walk(fs, '/state/sd')) fs.unlink(`/state/sd/${path}`);
      sendSdList(fs);
    } else if (data.type === 'sd-list') {
      sendSdList(fs);
    } else if (data.type === 'state-import') {
      for (const { name, bytes } of prepareStateImport(fs, data.files)) {
        const path = `/state/${name}`;
        mkdirs(fs, path.substring(0, path.lastIndexOf('/')));
        fs.writeFile(path, bytes);
      }
      sendSdList(fs);
      cardInfo(fs);
    } else if (data.type === 'state-remove-prefix') {
      const prefix = data.prefix;
      if (prefix !== 'sd/' && !/^cards\/[123]\/$/.test(prefix)) throw new Error('Invalid peripheral prefix');
      for (const { path } of walk(fs, '/state')) {
        if (path.startsWith(prefix)) fs.unlink(`/state/${path}`);
      }
      sendSdList(fs);
      cardInfo(fs);
    } else if (data.type === 'sd-export') {
      const name = relativePath(data.name);
      const bytes = fs.readFile(`/state/sd/${name}`);
      send('sd-file', { name, bytes });
    } else if (data.type === 'qr') {
      const bytes = new Uint8Array(data.bytes);
      if (bytes.length > 4094) throw new Error('QR payload exceeds scanner buffer');
      if (qrQueue.length >= 16) qrQueue.shift();
      qrQueue.push(bytes);
      flushQr();
    } else if (data.type === 'usb-data') {
      const bytes = new Uint8Array(data.bytes);
      if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw new Error('Invalid Virtual Host payload');
      if (usbQueue.length >= 64) throw new Error('Virtual Host input queue is full');
      usbQueue.push(bytes);
      flushUsb();
    } else if (data.type === 'usb-disconnect') {
      usbQueue.length = 0;
      for (const path of ['/bridge/usb-in.bin', '/bridge/usb-out.bin']) {
        if (fs.analyzePath(path).exists) fs.unlink(path);
      }
    } else if (data.type === 'card-insert') {
      const slot = cardSlot(data.slot);
      if (!fs.analyzePath(`/state/cards/${slot}/private.key`).exists) createCard(fs, slot);
      fs.writeFile('/bridge/card-slot', new Uint8Array([slot]));
      cardInfo(fs);
    } else if (data.type === 'card-create') {
      const slot = cardSlot(data.slot);
      if (!fs.analyzePath(`/state/cards/${slot}/private.key`).exists) createCard(fs, slot);
      cardInfo(fs);
    } else if (data.type === 'card-remove') {
      if (fs.analyzePath('/bridge/card-slot').exists) fs.unlink('/bridge/card-slot');
      cardInfo(fs);
    } else if (data.type === 'card-reset') {
      const slot = cardSlot(data.slot);
      createCard(fs, slot);
      if (fs.analyzePath('/bridge/card-slot').exists && fs.readFile('/bridge/card-slot')[0] === slot) {
        fs.unlink('/bridge/card-slot');
      }
      cardInfo(fs);
    } else if (data.type === 'card-list') {
      cardInfo(fs);
    } else if (data.type === 'snapshot') {
      const files = [];
      for (const { path } of walk(fs, '/state')) {
        if (path.startsWith('ramdisk/')) continue;
        files.push({ path, bytes: fs.readFile(`/state/${path}`) });
      }
      if (program === 'mockui') {
        for (const { path } of walk(fs, '/flash')) {
          files.push({ path: `flash/${path}`, bytes: fs.readFile(`/flash/${path}`) });
        }
      }
      send('snapshot', { requestId: data.requestId, files });
    }
  } catch (error) {
    const storage = error?.code === 'ENOSPC' ? sdStorage(fs) : {};
    send('operation-error', { operation: data.type, name: error?.name, code: error?.code,
      message: error?.message || String(error), ...storage });
  }
}
onmessage = async ({ data }) => {
  if (data.type !== 'start') {
    if (runtimeReady) handle(data); else pending.push(data);
    return;
  }
  try {
    const canvas = data.canvas;
    program = data.program === 'mockui' ? 'mockui' : 'wallet';
    const headlessDisplay = Boolean(data.headlessDisplay);
    const usbWalletProbe = data.usbWalletProbe
      ? await (await fetch('/browser/runtime/usb-wallet-probe.py', { cache: 'no-store' })).text() : null;
    const assetSuffix = data.version ? `?v=${encodeURIComponent(data.version)}` : '';
    send('diagnostic', { event: 'start-received', workerRevision, build: data.build, version: data.version,
      display: headlessDisplay ? 'Canvas-Pixelbridge' : 'OffscreenCanvas', canvasGetContext: typeof canvas?.getContext });
    if (canvas) {
      canvas.style = {};
      canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
        width: canvas.width, height: canvas.height });
    }
    const noop = () => {};
    self.document = {
      addEventListener: noop, removeEventListener: noop,
      getElementById: id => id === 'screen' || id === 'canvas' ? canvas : null,
      querySelector: selector => selector === '#screen' || selector === '#canvas' ? canvas : null,
      body: { addEventListener: noop, removeEventListener: noop, style: {} },
      documentElement: { addEventListener: noop, removeEventListener: noop, style: {} },
    };
    self.window = self;
    self.Module = {
      canvas,
      headlessDisplay,
      // Browser MicroPython heap is independent of hardware RAM. The full
      // wallet import needs the previously proven 64M; MockUI stays lean.
      arguments: ['-X', `heapsize=${program === 'mockui' ? '16M' : '64M'}`, data.usbWalletProbe ? '/browser/usb-wallet-probe.py' : data.usbProbe ? '/browser/usb-probe.py' : data.sdProbe ? '/browser/sd-probe.py' : data.qrProbe ? '/browser/qr-probe.py' : data.qrOutputProbe ? '/browser/qr-output-probe.py' : data.cardProbe ? '/browser/card-probe.py' : data.diag ? '/browser/diagnose.py' : data.program === 'mockui' ? '/browser/mockui-boot.py' : '/browser/boot.py', '/state', ...(data.qrOutputProbe ? [data.qrOutputAnimated ? 'animated' : 'static'] : [])],
      monitorRunDependencies: remaining => send('loading-progress', { remaining }),
      locateFile: path => data.build + path + assetSuffix,
      preRun: [() => {
        const fs = Module.FS;
        mkdirs(fs, '/state');
        mkdirs(fs, '/state/sd');
        mkdirs(fs, '/state/cards');
        mkdirs(fs, '/bridge');
        if (usbWalletProbe) fs.writeFile('/browser/usb-wallet-probe.py', usbWalletProbe);
        installSdQuota(fs);
        if (program === 'wallet' && !data.sdProbe && !data.qrProbe && !data.usbProbe && !data.cardProbe && !data.qrOutputProbe && !data.diag) {
          fs.writeFile('/browser/browser_inspector.py', inspectorPython);
          fs.writeFile('/browser/browser_reboot.py', rebootPython);
          const boot = fs.readFile('/browser/boot.py', { encoding: 'utf8' });
          fs.writeFile('/browser/boot.py', boot.replace('import main\n', 'import browser_reboot\nimport main\nimport browser_inspector\nbrowser_inspector.install(main)\n'));
        }
        for (const file of data.stateFiles || []) {
          if (!file.path || file.path.startsWith('ramdisk/')) continue;
          const name = relativePath(file.path);
          const path = program === 'mockui' && name.startsWith('flash/') ? `/${name}` : `/state/${name}`;
          mkdirs(fs, path.substring(0, path.lastIndexOf('/')));
          fs.writeFile(path, new Uint8Array(file.bytes));
        }
        if (data.sdInserted) fs.writeFile('/bridge/sd-inserted', new Uint8Array([1]));
        if (data.cardSlot) fs.writeFile('/bridge/card-slot', new Uint8Array([cardSlot(data.cardSlot)]));
      }],
      print: message => {
        if (message.startsWith('SIMULATOR_QR_OUTPUT:')) {
          const output = message.slice('SIMULATOR_QR_OUTPUT:'.length);
          const separator = output.indexOf(':');
          send('qr-output', separator < 0
            ? { token: '', frame: output }
            : { token: output.slice(0, separator), frame: output.slice(separator + 1) });
        } else if (message.startsWith('SIMULATOR_QR_CLEAR:')) {
          send('qr-clear', { token: message.slice('SIMULATOR_QR_CLEAR:'.length) });
        } else {
          send('log', { message });
        }
        if (message === 'SPECTER_MAIN_IMPORTED' || message === 'MOCKUI_READY' || message === 'DIAG_SPECTER_CREATED' || message === 'QR_PROBE_READY' || message === 'DIY_QR_OUTPUT_READY' || message === 'USB_PROBE_READY' || message === 'USB_WALLET_PROBE_READY' || message === 'SD_PROBE_WRITTEN' || message === 'CARD_PROBE_READY') {
          runtimeReady = true;
          for (const item of pending.splice(0)) handle(item);
          setInterval(flushQr, 50);
          setInterval(pollScanner, 80);
          setInterval(pollUsb, 20);
          setInterval(pollReboot, 50);
          pollScanner();
          pollUsb();
          setTimeout(() => send('running'), 500);
        }
      },
      printErr: message => send('debug', { message }),
      onAbort: reason => {
        if (!fatalReported) {
          fatalReported = true;
          send('abort', { message: String(reason), stack: new Error(String(reason)).stack });
        }
      },
      onRuntimeInitialized: () => send('wasm-ready', { memoryBytes: Module.HEAPU8?.buffer.byteLength }),
    };
    // importScripts does not expose HTTP headers. HEAD checks the script without
    // buffering another copy or altering classic-worker script execution.
    await self.fetch(data.build + 'micropython.js' + assetSuffix, { method: 'HEAD' });
    importScripts(data.build + 'micropython.js' + assetSuffix);
  } catch (error) {
    reportError(error, 'runtime-start');
  }
};
