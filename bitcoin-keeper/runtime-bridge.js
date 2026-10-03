import { createCompanionFileClient } from '/browser/companion-file-dialog.js';

// React Native installs its own Blob/File/URL globals. Keep the browser's
// original constructors at this OS boundary, as with the DOM Element adapter.
const nativeDOM = globalThis.__keeperDOMConstructors;
globalThis.__keeperCompanionFiles = createCompanionFileClient({ label: 'Bitcoin Keeper',
  FileClass: nativeDOM.File, BlobClass: nativeDOM.Blob, Url: nativeDOM.URL });

(() => {
  const parentOrigin = location.origin;
  // The parent imports its shared UI asynchronously. Retry the handshake so
  // cached Keeper assets cannot announce readiness before its listener exists.
  const announceReady = () => parent.postMessage({ type: 'keeper-runtime-ready' }, parentOrigin);
  const readyTimer = setInterval(announceReady, 500);
  window.addEventListener('keeper-qr-output-frame', (event) => {
    const frame = event.detail?.frame;
    if (typeof frame === 'string' && frame.trim()) {
      parent.postMessage({ type: 'keeper-qr-output-frame', frame }, parentOrigin);
    }
  });
  window.addEventListener('keeper-qr-output-clear', () => {
    parent.postMessage({ type: 'keeper-qr-output-clear' }, parentOrigin);
  });
  window.addEventListener('keeper-direct-scan-state', (event) => {
    parent.postMessage({ type: 'keeper-scan-state', active: Boolean(event.detail?.active) }, parentOrigin);
  });

  addEventListener('message', (event) => {
    if (event.origin !== parentOrigin || event.source !== parent || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'keeper-runtime-ready-ack') {
      clearInterval(readyTimer);
      if (globalThis.__keeperAppMounted) parent.postMessage({ type: 'keeper-app-mounted' }, parentOrigin);
    } else if (event.data.type === 'keeper-direct-qr-frame' && typeof event.data.frame === 'string') {
      window.dispatchEvent(new CustomEvent('keeper-direct-qr-frame', { detail: { frame: event.data.frame } }));
    } else if (event.data.type === 'keeper-direct-qr-status' && typeof event.data.message === 'string') {
      window.dispatchEvent(new CustomEvent('keeper-direct-qr-status', { detail: { message: event.data.message } }));
    } else if (event.data.type === 'keeper-reset') {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith('keeper:') || key?.startsWith('keeper-web:')) sessionStorage.removeItem(key);
      }
      location.reload();
    }
  });
  announceReady();
})();
