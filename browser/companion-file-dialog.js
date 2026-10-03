/** File dialogs backed by the shared companion-media protocol. No second SD store. */
export function createCompanionFileClient({ label, targetWindow = parent, targetOrigin = location.origin,
  FileClass = File, BlobClass = Blob, Url = URL }) {
  let sequence = 0;
  let sdInserted = false;
  const pending = new Map();
  addEventListener('message', event => {
    if (event.source !== targetWindow || event.origin !== targetOrigin || !event.data) return;
    const data = event.data;
    if (data.type === 'specter-media-state') sdInserted = data.sdOwner === 'desktop';
    if (!['specter-media-files', 'specter-media-written'].includes(data.type)) return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data);
  });
  function request(type, details = {}) {
    const id = `companion-file-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The virtual SD card did not respond.')); }, 15_000);
      pending.set(id, { resolve, reject, timer });
      targetWindow.postMessage({ type, id, ...details }, targetOrigin);
    });
  }
  function cancelled() { return Object.assign(new Error('CANCELLED'), { code: 'OPERATION_CANCELED' }); }
  function dialog(title, configure) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('dialog');
      element.setAttribute('aria-label', title);
      Object.assign(element.style, { width: 'calc(100% - 28px)', maxWidth: '480px', maxHeight: '80vh',
        overflow: 'auto', color: '#edf5fc', background: '#111c27', border: '1px solid #42607a',
        borderRadius: '10px', padding: '16px', font: '13px/1.5 system-ui' });
      const heading = document.createElement('h2');
      heading.textContent = title; heading.style.fontSize = '16px'; heading.style.margin = '0 0 12px';
      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'grid', gap: '8px' });
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true; element.remove();
        if (error) reject(error); else resolve(value);
      };
      const button = (text, action, disabled = false) => {
        const control = document.createElement('button'); control.type = 'button';
        control.textContent = text; control.disabled = disabled;
        Object.assign(control.style, { color: '#edf5fc', background: '#1b3043', border: '1px solid #45627c',
          borderRadius: '6px', padding: '9px', textAlign: 'left', font: 'inherit', overflowWrap: 'anywhere' });
        control.addEventListener('click', () => {
          // Invoke before awaiting to preserve the browser's user activation.
          let result;
          try { result = action(); } catch (error) { finish(null, error); return; }
          Promise.resolve(result).then(value => finish(value), error => finish(null, error));
        });
        actions.append(control); return control;
      };
      element.append(heading, actions);
      configure({ button, actions, finish });
      button('Cancel', () => { throw cancelled(); });
      element.addEventListener('cancel', event => { event.preventDefault(); finish(null, cancelled()); });
      document.body.append(element); element.showModal();
    });
  }
  function computerPicker(options = {}) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file';
      input.multiple = Boolean(options.allowMultiSelection); input.hidden = true;
      const finish = (files, error) => { input.remove(); if (error) reject(error); else resolve(files); };
      input.addEventListener('change', () => input.files?.length ? finish([...input.files]) : finish(null, cancelled()), { once: true });
      input.addEventListener('cancel', () => finish(null, cancelled()), { once: true });
      document.body.append(input); input.click();
    });
  }
  function pick(options) {
    return dialog('Open a file', ({ button }) => {
      button('Choose from computer', () => computerPicker(options));
      button('Open virtual SD card', async () => {
        const { files } = await request('specter-media-list');
        return dialog('Open SD card file', ({ button, actions }) => {
          if (!files.length) { const empty = document.createElement('p'); empty.textContent = 'No files on the virtual SD card.'; actions.append(empty); }
          for (const file of files) button(`${file.name} · ${file.bytes.byteLength.toLocaleString()} bytes`, () =>
            [new FileClass([file.bytes], file.name, { type: file.type || 'application/octet-stream' })]);
        });
      }, !sdInserted);
    });
  }
  function save({ name, bytes, type = 'application/octet-stream' }) {
    return dialog(`Save ${name}`, ({ button }) => {
      button(`Save to virtual SD card in ${label}`, () => request('specter-media-write', { name, bytes }), !sdInserted);
      button('Download to computer', () => {
        const url = Url.createObjectURL(new BlobClass([bytes], { type }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
        setTimeout(() => Url.revokeObjectURL(url), 1000);
        return { downloaded: true };
      });
    });
  }
  targetWindow.postMessage({ type: 'specter-media-bridge-ready' }, targetOrigin);
  return { pick, save, request, isInserted: () => sdInserted };
}
