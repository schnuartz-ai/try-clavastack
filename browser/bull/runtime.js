// Browser peripherals and transport only. All wallet derivation, PSBT signing,
// scanning and transaction interpretation belong to the pinned Rust/Dart app.
import { createCompanionFileClient } from '../../../browser/companion-file-dialog.js';
const key = 'clava.bull-bitcoin.session';
const cleanupKey = 'clava.bull-bitcoin.reset-pending';
for (const retired of JSON.parse(sessionStorage.getItem(cleanupKey) ?? '[]')) {
  if (!/^[a-f0-9-]{36}$/.test(retired)) throw new Error('Invalid retired Bull session');
  const names = ['bullbitcoin_sqlite', 'payjoin'].map(name => `bull-bitcoin-${retired}-${name}`);
  for (const name of names) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Bull Bitcoin tabs to finish resetting their database.'));
    });
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const drift = await root.getDirectoryHandle('drift_db');
        await drift.removeEntry(name, {recursive:true});
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
  }
}
sessionStorage.removeItem(cleanupKey);
let session = sessionStorage.getItem(key);
if (!session) { session = crypto.randomUUID(); sessionStorage.setItem(key, session); }
const prefix = `clava.bull-bitcoin.${session}.`;
const load = (name, fallback = {}) => JSON.parse(sessionStorage.getItem(prefix + name) ?? JSON.stringify(fallback));
const save = (name, data) => sessionStorage.setItem(prefix + name, JSON.stringify(data));
const files = load('files');
const directories = new Set(load('directories', ['/tmp', '/documents', '/support', '/cache', '/downloads']));
const stores = load('stores');
const canonical = path => {
  const segments = String(path).replaceAll('\\', '/').split('/');
  const parts = [];
  for (const part of segments) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return '/' + parts.join('/');
};
const fileClient = createCompanionFileClient({ label: 'Bull Bitcoin' });
const encodeBytes = bytes => {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(value);
};
const fileName = name => {
  const value = String(name).replaceAll('\\', '/').split('/').pop();
  if (!value || value === '.' || value === '..') throw new Error('Invalid file name');
  return value;
};
window.bullPickFiles = async encoded => {
  try {
    const picked = await fileClient.pick(JSON.parse(encoded));
    const result = [];
    for (const file of picked) {
      const name = fileName(file.name);
      const path = `/tmp/import-${crypto.randomUUID()}/${name}`;
      const bytes = encodeBytes(new Uint8Array(await file.arrayBuffer()));
      files[path] = {bytes, modified:Date.now()};
      result.push({name, path, bytes});
    }
    save('files', files);
    return JSON.stringify(result);
  } catch (error) {
    if (error.code === 'OPERATION_CANCELED') return 'null';
    throw error;
  }
};
window.bullSaveFile = async encoded => {
  const value = JSON.parse(encoded);
  const name = fileName(value.name);
  const bytes = Uint8Array.from(atob(value.bytes), char => char.charCodeAt(0));
  try {
    await fileClient.save({name, bytes});
    const path = `/downloads/${name}`;
    files[path] = {bytes:value.bytes, modified:Date.now()};
    save('files', files);
    return JSON.stringify({path});
  } catch (error) {
    if (error.code === 'OPERATION_CANCELED') return JSON.stringify({path:null});
    throw error;
  }
};
const bdk = await import(new URL('native/bdk/bdkffi.js', import.meta.url));
const lwk = await import(new URL('native/lwk/bull_lwk.js', import.meta.url));
await import('./qr_transport.js');
await Promise.all([bdk.default(), lwk.default()]);
const snapshot = sessionStorage.getItem(prefix + 'bdk');
if (snapshot) bdk.bdk_store_import(snapshot);
const liquidSnapshot = load('lwk');
for (const [path, saved] of Object.entries(liquidSnapshot)) lwk.lwk_call('walletInit', JSON.stringify({path,...saved}));
const saveLiquid = () => sessionStorage.setItem(prefix+'lwk', lwk.lwk_call('walletExport', '{}'));
window.bullBdkCall = (name, argumentsJson) => {
  const result = bdk.bdk_call(name, argumentsJson);
  sessionStorage.setItem(prefix + 'bdk', bdk.bdk_store_export());
  return result;
};
window.bullBdkScan = async (handle, stopGap) => bdk.bdk_scan(handle, stopGap);
window.bullLwkCall = (operation, args) => { const result = lwk.lwk_call(operation,args); saveLiquid(); return result; };
window.bullLwkAsyncCall = async (operation, args) => { const result = await lwk.lwk_async_call(operation,args); saveLiquid(); return result; };
window.bullPayjoinCall = () => { throw new Error('Native Payjoin OHTTP is unavailable in a browser'); };
window.bullBroadcast = async encoded => {
  try {
    const {hex,txid,isTestnet,isLiquid} = JSON.parse(encoded);
    if (!/^(?:[a-f0-9]{2})+$/i.test(hex) || !/^[a-f0-9]{64}$/i.test(txid) || typeof isTestnet !== 'boolean' || typeof isLiquid !== 'boolean') throw new Error('Invalid native transaction transport request');
    const endpoint = isLiquid ? (isTestnet ? 'liquidtestnet/api' : 'liquid/api') : (isTestnet ? 'testnet/api' : 'api');
    const response = await fetch(`https://blockstream.info/${endpoint}/tx`, {
      method:'POST', body:hex, credentials:'omit', headers:{'Content-Type':'text/plain'}, signal:AbortSignal.timeout(20000),
    });
    const body = (await response.text()).trim();
    if (!response.ok) throw new Error(`Esplora broadcast rejected (${response.status}): ${body.slice(0,500)}`);
    if (body !== txid) throw new Error('Esplora returned a different transaction identifier');
    return JSON.stringify({txid:body});
  } catch (error) { return JSON.stringify({error:error.message}); }
};
window.bullIo = (operation, encoded) => {
  const value = JSON.parse(encoded);
  const path = typeof value === 'string' ? canonical(value) : null;
  let result;
  switch (operation) {
    case 'locale': result = navigator.language.replace('-', '_'); break;
    case 'url': result = location.href; break;
    case 'session': result = session; break;
    case 'exists': result = Object.hasOwn(files, path) || bdk.bdk_store_exists(path); break;
    case 'read': if (!Object.hasOwn(files, path)) throw new Error('File does not exist'); result = files[path].bytes; break;
    case 'write': files[canonical(value.path)] = {bytes:value.bytes, modified:Date.now()}; save('files', files); result = null; break;
    case 'modified': result = files[path]?.modified ?? null; break;
    case 'delete': delete files[path]; bdk.bdk_store_delete(path); save('files', files); sessionStorage.setItem(prefix+'bdk', bdk.bdk_store_export()); result = null; break;
    case 'mkdir': directories.add(path); save('directories', [...directories]); result = null; break;
    case 'directoryExists': result = directories.has(path) || JSON.parse(lwk.lwk_call('walletExists',JSON.stringify({path}))); break;
    case 'list': result = Object.keys(files).filter(name => name.startsWith(path+'/')); break;
    case 'rmdir': for (const name of Object.keys(files)) if (name.startsWith(path+'/')) delete files[name]; lwk.lwk_call('walletDelete',JSON.stringify({path})); saveLiquid(); directories.delete(path); save('files',files); save('directories',[...directories]); result = null; break;
    case 'storeRead': result = stores[value.store]?.[value.key] ?? null; break;
    case 'storeWrite': (stores[value.store] ??= {})[value.key] = value.value; save('stores', stores); result = null; break;
    case 'storeDelete': delete stores[value.store]?.[value.key]; save('stores', stores); result = null; break;
    case 'storeAll': result = {...(stores[value] ?? {})}; break;
    case 'storeClear': delete stores[value]; save('stores', stores); result = null; break;
    default: throw new Error(`Unknown Bull browser IO operation: ${operation}`);
  }
  return JSON.stringify(result);
};
window.bullNativeReady = true;
let appMounted = false;
const announceReady = () => {
  parent.postMessage({type:'bull-runtime-ready'},location.origin);
  if (appMounted) parent.postMessage({type:'bull-app-mounted'},location.origin);
};
const readyTimer = setInterval(announceReady,500);
announceReady();
window.bullAppMounted = () => {
  appMounted = true;
  parent.postMessage({type:'bull-app-mounted'},location.origin);
};
addEventListener('message',event=>{
  if(event.origin !== location.origin || event.source !== parent || !event.data) return;
  if(event.data.type === 'bull-runtime-ready-ack') {
    clearInterval(readyTimer);
    if(appMounted) parent.postMessage({type:'bull-app-mounted'},location.origin);
  }
  if(event.data.type === 'bull-reset') {
    window.bullQrStop();
    sessionStorage.setItem(cleanupKey, JSON.stringify([session]));
    for (let index=sessionStorage.length-1;index>=0;index--) {
      const stored = sessionStorage.key(index);
      if(stored === key || stored.startsWith(prefix)) sessionStorage.removeItem(stored);
    }
    location.href = location.pathname;
  }
});
// Start Flutter only after its actual native libraries have loaded successfully.
const bootstrap = document.createElement('script');
bootstrap.src = 'flutter_bootstrap.js';
document.body.append(bootstrap);
