(() => {
  const parentOrigin = location.origin;
  const pending = new Map();
  let nextId = 0;
  let sdInserted = false;
  let toastTimer;

  function request(type, details = {}) {
    const id = `desktop-media-${++nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The shared virtual SD card did not respond.'));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ type, id, ...details }, parentOrigin);
    });
  }

  function showToast(message, isError = false) {
    let toast = document.getElementById('specter-browser-media-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'specter-browser-media-toast';
      Object.assign(toast.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        maxWidth: 'min(420px, calc(100vw - 36px))', padding: '11px 14px',
        borderRadius: '8px', color: '#f4f8fc', background: '#172838',
        border: '1px solid #44637d', boxShadow: '0 8px 30px #0008',
        font: '12px/1.45 system-ui, sans-serif',
      });
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.style.borderColor = isError ? '#a5535d' : '#44637d';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 4500);
  }

  function finishRequest(data) {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    clearTimeout(item.timer);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data);
  }

  window.addEventListener('message', event => {
    if (event.origin !== parentOrigin || event.source !== parent || !event.data) return;
    if (event.data.type === 'specter-media-state') {
      sdInserted = event.data.sdOwner === 'desktop';
    } else if (event.data.type === 'specter-media-files') {
      finishRequest(event.data);
    } else if (event.data.type === 'specter-media-written') {
      finishRequest(event.data);
    }
  });

  function fileAccepts(input, name) {
    if (!input.accept) return true;
    const extension = `.${name.split('.').pop().toLowerCase()}`;
    const commonMime = {
      psbt: 'application/psbt', pset: 'application/pset', json: 'application/json',
      txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg',
      jpeg: 'image/jpeg', pdf: 'application/pdf',
    }[extension.slice(1)];
    return input.accept.split(',').some(item => {
      const accept = item.trim().toLowerCase();
      return accept === extension || accept === commonMime || accept === '*/*' ||
        (accept.endsWith('/*') && (input.files?.[0]?.type || '').startsWith(accept.slice(0, -1)));
    });
  }

  function openCardPicker(input) {
    if (!sdInserted) {
      showToast('Insert the virtual SD card in Specter Desktop first.', true);
      return;
    }
    request('specter-media-list').then(({ files = [] }) => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', 'Open a file from the virtual SD card');
      Object.assign(dialog.style, {
        width: 'min(520px, calc(100vw - 30px))', maxHeight: 'min(75vh, 620px)',
        padding: '18px', border: '1px solid #42607a', borderRadius: '10px',
        color: '#edf5fc', background: '#111c27', boxShadow: '0 18px 60px #000b',
        font: '13px/1.5 system-ui, sans-serif',
      });
      const heading = document.createElement('h2');
      heading.textContent = 'Open SD card file';
      Object.assign(heading.style, { margin: '0 0 12px', fontSize: '16px' });
      const list = document.createElement('div');
      Object.assign(list.style, { display: 'grid', gap: '6px', maxHeight: '55vh', overflow: 'auto' });
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Cancel';
      Object.assign(close.style, buttonStyle());
      close.addEventListener('click', () => dialog.close());
      dialog.append(heading, list);
      if (!files.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No files on the virtual SD card.';
        list.append(empty);
      }
      for (const file of files.filter(item => fileAccepts(input, item.name))) {
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.textContent = `${file.name} · ${file.bytes.byteLength.toLocaleString()} bytes`;
        Object.assign(choose.style, { ...buttonStyle(), textAlign: 'left', overflowWrap: 'anywhere' });
        choose.addEventListener('click', () => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([file.bytes], file.name, { type: file.type || 'application/octet-stream' }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          dialog.close();
          showToast(`Opened ${file.name} from the virtual SD card.`);
        });
        list.append(choose);
      }
      dialog.append(close);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      document.body.append(dialog);
      dialog.showModal();
    }).catch(error => showToast(error.message, true));
  }

  function buttonStyle() {
    return {
      border: '1px solid #426783', borderRadius: '6px', padding: '8px 10px',
      color: '#eff8ff', background: '#1a3042', cursor: 'pointer',
      font: '12px/1.35 system-ui, sans-serif',
    };
  }

  function installPicker(input) {
    if (input.dataset.specterVirtualSd === '1' || input.hasAttribute('webkitdirectory')) return;
    input.dataset.specterVirtualSd = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open SD card';
    button.className = 'button specter-virtual-sd-button';
    button.setAttribute('aria-label', 'Open a file from the virtual SD card');
    button.style.margin = '4px';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openCardPicker(input);
    });
    const host = input.closest('label') || input.parentElement || input;
    host.insertAdjacentElement('beforeend', button);
  }

  function installPickers(root = document) {
    root.querySelectorAll?.('input[type="file"]').forEach(installPicker);
  }

  function decodeDataUrl(url) {
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error('Invalid download URL');
    const metadata = url.slice(0, comma);
    const contents = url.slice(comma + 1);
    if (/;base64/i.test(metadata)) {
      const binary = atob(contents);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    return new TextEncoder().encode(decodeURIComponent(contents));
  }

  async function saveOnCard(link) {
    const name = (link.download || '').trim();
    if (!name || !sdInserted) return false;
    try {
      let bytes;
      if (link.href.startsWith('data:')) bytes = decodeDataUrl(link.href);
      else {
        const response = await fetch(link.href);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const result = await request('specter-media-write', { name, bytes });
      if (result.error) throw new Error(result.error);
      showToast(`Saved ${name} to the virtual SD card.`);
      return true;
    } catch (error) {
      showToast(`Could not save ${name} to the virtual SD card: ${error.message}`, true);
      return false;
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[download]');
    if (!link || !sdInserted) return;
    event.preventDefault();
    saveOnCard(link);
  }, true);

  installPickers();
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('input[type="file"]')) installPicker(node);
        installPickers(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  parent.postMessage({ type: 'specter-media-bridge-ready' }, parentOrigin);
  parent.postMessage({ type: 'specter-media-state-request' }, parentOrigin);
})();
