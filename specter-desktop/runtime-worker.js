const PYODIDE_VERSION = '0.27.7';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide;
let appReady = false;
let browserCompat;
let requestQueue = Promise.resolve();
let cableConnectionAvailable = false;
const CABLE_RESPONSE_CAPACITY = 4 * 1024 * 1024;

function notify(type, data = {}) {
  self.postMessage({ type, ...data });
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

self.specterBrowserCableIsConnected = () => cableConnectionAvailable;
self.specterBrowserCableQuerySync = (requestBase64, timeoutMs = 300000) => {
  if (!cableConnectionAvailable) throw new Error('The virtual USB cable is not connected.');
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
    throw new Error('The virtual USB cable requires COOP/COEP browser isolation.');
  }
  const shared = new SharedArrayBuffer(16 + CABLE_RESPONSE_CAPACITY);
  const control = new Int32Array(shared, 0, 4);
  const timeout = Math.max(1000, Math.min(Number(timeoutMs) || 300000, 300000));
  notify('cable-query', { shared, capacity: CABLE_RESPONSE_CAPACITY, bytes: requestBase64, timeoutMs: timeout });
  const result = Atomics.wait(control, 0, 0, timeout);
  const status = Atomics.load(control, 0);
  if (status !== 1) {
    const length = Math.max(0, Math.min(Atomics.load(control, 1), CABLE_RESPONSE_CAPACITY));
    const message = new TextDecoder().decode(new Uint8Array(shared, 16, length));
    throw new Error(message || (result === 'timed-out' ? 'Specter DIY USB response timed out.' : 'The virtual USB cable failed.'));
  }
  const length = Atomics.load(control, 1);
  return encodeBase64(new Uint8Array(shared, 16, length));
};

function syncFilesystem(populate) {
  return new Promise((resolve, reject) => {
    pyodide.FS.syncfs(populate, error => error ? reject(error) : resolve());
  });
}

async function initialize(message) {
  const sourceBase = new URL('.', new URL(message.sourceUrl, self.location.href));
  const verifiedAssets = {};
  for (const name of ['secp256k1.js', 'secp256k1.wasm']) {
    const expected = message.publicDerivation?.files?.[name]?.sha256;
    if (!expected) throw new Error(`Missing public derivation checksum for ${name}`);
    const response = await fetch(new URL(name, sourceBase), { cache: 'no-store' });
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) throw new Error(`${name} SHA-256 mismatch`);
    verifiedAssets[name] = bytes;
  }
  self.specterVerifiedSecpWasm = verifiedAssets['secp256k1.wasm'];
  const moduleUrl = URL.createObjectURL(new Blob([verifiedAssets['secp256k1.js']], { type: 'text/javascript' }));
  let publicSecp;
  try { publicSecp = await import(moduleUrl); }
  finally { URL.revokeObjectURL(moduleUrl); delete self.specterVerifiedSecpWasm; }
  self.specterPublicPointCompress = (hex, compressed) => {
    const input = Uint8Array.from(hex.match(/../g) || [], value => parseInt(value, 16));
    if (!publicSecp.isPoint(input)) throw new Error('Invalid public key');
    return [...publicSecp.pointCompress(input, compressed)].map(value => value.toString(16).padStart(2, '0')).join('');
  };
  self.specterPublicPointAdd = (hex, tweakHex) => {
    const input = Uint8Array.from(hex.match(/../g) || [], value => parseInt(value, 16));
    const tweak = Uint8Array.from(tweakHex.match(/../g) || [], value => parseInt(value, 16));
    const result = publicSecp.pointAddScalar(input, tweak, false);
    return result ? [...result].map(value => value.toString(16).padStart(2, '0')).join('') : null;
  };
  notify('progress', { label: 'Loading CPython 3.12 WebAssembly…', progress: 4 });
  importScripts(`${PYODIDE_INDEX}pyodide.js`);
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
  notify('progress', { label: 'Loading Python cryptography and protocol runtime…', progress: 16 });
  await pyodide.loadPackage([
    'micropip', 'cryptography', 'requests', 'ssl', 'typing-extensions', 'protobuf', 'sqlite3'
  ]);
  const micropip = pyodide.pyimport('micropip');
  await micropip.install([
    'Flask==2.2.5',
    'Werkzeug==3.0.6',
    'Flask-Babel==3.1.0',
    'Flask-Cors==6.0.0',
    'Flask-Login==0.6.3',
    'Flask-RESTful==0.3.10',
    'Flask-HTTPAuth==4.8.1',
    'python-dotenv==1.2.2',
    'flask_wtf==1.2.1',
    'PyJWT==2.13.0',
    'pytimeparse==1.1.8',
    'mnemonic==0.21',
    'pyserial==3.5',
    'semver==3.0.4',
    'ecdsa==0.19.1',
    'noiseprotocol==0.3.1',
    'PySocks==1.7.1',
  ]);
  await micropip.install('Flask-SQLAlchemy==2.5.1', { deps: false });
  micropip.destroy();

  notify('progress', { label: 'Verifying pinned Specter Desktop upstream source…', progress: 48 });
  const archiveResponse = await fetch(message.sourceUrl, { cache: 'no-store' });
  if (!archiveResponse.ok) throw new Error(`Specter source archive returned HTTP ${archiveResponse.status}`);
  const archive = await archiveResponse.arrayBuffer();
  const archiveHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', archive))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (archiveHash !== message.sourceSha256) {
    throw new Error(`Specter Desktop source archive SHA-256 mismatch (expected ${message.sourceSha256}, received ${archiveHash})`);
  }
  pyodide.FS.mkdirTree('/specter-src');
  pyodide.FS.writeFile('/specter-source.zip', new Uint8Array(archive));
  const compatResponse = await fetch('/specter-desktop/browser-compat.py', { cache: 'no-store' });
  if (!compatResponse.ok) throw new Error('The browser compatibility adapter could not be loaded');
  pyodide.FS.writeFile('/browser-compat.py', await compatResponse.text());

  const mountPath = '/specter-browser-state';
  pyodide.FS.mkdirTree(mountPath);
  pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, mountPath);
  await syncFilesystem(true);
  pyodide.globals.set('__desktop_secret', message.secret);
  pyodide.globals.set('__source_commit', message.sourceCommit);
  await pyodide.runPythonAsync(`
import os, sys, zipfile, importlib.util
with zipfile.ZipFile('/specter-source.zip') as _source_bundle:
    _source_bundle.extractall('/specter-src')
sys.path.insert(0, '/specter-src')
_compat_spec = importlib.util.spec_from_file_location('specter_browser_compat', '/browser-compat.py')
specter_browser_compat = importlib.util.module_from_spec(_compat_spec)
sys.modules[_compat_spec.name] = specter_browser_compat
_compat_spec.loader.exec_module(specter_browser_compat)
specter_browser_app = specter_browser_compat.initialize(__desktop_secret)
`);
  browserCompat = pyodide.globals.get('specter_browser_compat');
  const routeCount = pyodide.runPython('len(specter_browser_app.view_functions)');
  if (routeCount < 50) throw new Error(`Only ${routeCount} upstream Specter routes registered`);
  appReady = true;
  await syncFilesystem(false);
  notify('ready', { routeCount, sourceCommit: message.sourceCommit, runtime: 'Pyodide 0.27.7 / CPython 3.12.7' });
}

async function dispatchRequest(request) {
  request = {
    ...request,
    body: encodeBase64(request.body instanceof ArrayBuffer ? new Uint8Array(request.body) : new Uint8Array(0)),
  };
  const requestJson = JSON.stringify(request);
  pyodide.globals.set('__request_json', requestJson);
  await pyodide.runPythonAsync(`
import base64, io, json
_request = json.loads(__request_json)
_request_body = base64.b64decode(_request.pop('body', ''))
_wsgi_status = []
_wsgi_headers = []
_environ = {
    'REQUEST_METHOD': _request['method'],
    'SCRIPT_NAME': '/specter-desktop',
    'PATH_INFO': _request['path'],
    'QUERY_STRING': _request['query'],
    'SERVER_NAME': _request.get('hostname', 'try.clavastack.com'),
    'SERVER_PORT': _request.get('port', '443'),
    'SERVER_PROTOCOL': 'HTTP/1.1',
    'wsgi.version': (1, 0),
    'wsgi.url_scheme': _request.get('scheme', 'https'),
    'wsgi.input': io.BytesIO(_request_body),
    'wsgi.errors': io.StringIO(),
    'wsgi.multithread': False,
    'wsgi.multiprocess': False,
    'wsgi.run_once': False,
    'CONTENT_LENGTH': str(len(_request_body)),
}
if _request.get('content_type'):
    _environ['CONTENT_TYPE'] = _request['content_type']
for _name, _value in _request['headers'].items():
    _key = _name.lower().replace('-', '_')
    if _key == 'content_type':
        _environ['CONTENT_TYPE'] = _value
    elif _key == 'content_length':
        _environ['CONTENT_LENGTH'] = _value
    elif _key not in ('host', 'connection', 'content_encoding', 'transfer_encoding'):
        _environ['HTTP_' + _key.upper()] = _value
def _start_response(status, headers, exc_info=None):
    _wsgi_status[:] = [status]
    _wsgi_headers[:] = headers
_response_iterable = specter_browser_app.wsgi_app(_environ, _start_response)
try:
    _response_body = b''.join(_response_iterable)
finally:
    if hasattr(_response_iterable, 'close'):
        _response_iterable.close()
__response_json = json.dumps({
    'status': _wsgi_status[0] if _wsgi_status else '500 Internal Server Error',
    'headers': _wsgi_headers,
    'body': base64.b64encode(_response_body).decode('ascii'),
})
`);
  const resultValue = pyodide.globals.get('__response_json');
  const result = resultValue.toString();
  if (typeof resultValue.destroy === 'function') resultValue.destroy();
  await syncFilesystem(false);
  const response = JSON.parse(result);
  let bytes = decodeBase64(response.body);
  const contentType = (response.headers || []).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
  if (/text\/html/i.test(contentType)) {
    const html = new TextDecoder().decode(bytes);
    if (!html.includes('/specter-desktop/desktop-bridge.js')) {
      const script = '<script src="/specter-desktop/desktop-bridge.js" defer></script>';
      const updated = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${script}</body>`) : `${html}${script}`;
      bytes = new TextEncoder().encode(updated);
    }
  }
  response.body = bytes.buffer;
  return response;
}

self.addEventListener('message', async event => {
  const { data, ports } = event;
  if (data?.type === 'cable-state') {
    cableConnectionAvailable = Boolean(data.connected);
    return;
  }
  if (data?.type === 'init') {
    try {
      await initialize(data);
    } catch (error) {
      notify('error', { error: `${error?.stack || error}` });
    }
    return;
  }
  if (data?.type === 'request') {
    const port = ports[0];
    requestQueue = requestQueue.then(() => handleRequest(data.request, port)).catch(error => {
      port.postMessage({ status: 500, headers: [['Content-Type', 'text/plain; charset=utf-8']], body: `${error?.stack || error}` });
    });
    return;
  }
  if (data?.type === 'reset' && appReady) {
    requestQueue = requestQueue.then(async () => {
      try {
        pyodide.globals.set('__desktop_secret', data.secret);
        pyodide.runPython(`specter_browser_compat.reset_data(); specter_browser_app.secret_key = __desktop_secret; specter_browser_app.config['SECRET_KEY'] = __desktop_secret`);
        await syncFilesystem(false);
        notify('reset-complete');
      } catch (error) {
        notify('error', { error: `${error?.stack || error}` });
      }
    });
  }
});

async function handleRequest(request, port) {
    if (!appReady) {
      const body = new TextEncoder().encode('Specter Desktop is still starting.');
      port.postMessage({ status: 503, headers: [['Content-Type', 'text/plain; charset=utf-8']], body: body.buffer }, [body.buffer]);
      return;
    }
    try {
      const response = await dispatchRequest(request);
      port.postMessage(response, [response.body]);
    } catch (error) {
      port.postMessage({ status: 500, headers: [['Content-Type', 'text/plain; charset=utf-8']], body: `${error?.stack || error}` });
    }
}
