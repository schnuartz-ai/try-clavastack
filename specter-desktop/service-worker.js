const SCOPE_PREFIX = '/specter-desktop/';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function wsgiPath(pathname) {
  const appRoute = `${SCOPE_PREFIX}app`;
  if (pathname === appRoute) return '/spc';
  if (pathname.startsWith(`${appRoute}/`)) return pathname.slice(appRoute.length) || '/spc';
  const path = pathname.slice(SCOPE_PREFIX.length);
  return path ? `/${path}` : '/';
}

function needsWsgi(pathname) {
  return pathname.startsWith(`${SCOPE_PREFIX}app/`) ||
    pathname.startsWith(`${SCOPE_PREFIX}static/`) ||
    pathname.startsWith(`${SCOPE_PREFIX}spc/`) ||
    pathname.startsWith(`${SCOPE_PREFIX}hwi/`) ||
    pathname.startsWith(`${SCOPE_PREFIX}ext/`);
}

async function findBridgeClient() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const candidates = clients.filter(client => {
    const url = new URL(client.url);
    return url.pathname === '/specter-desktop/' || url.pathname === '/specter-desktop/index.html';
  });
  // Reloads replace a document's service-worker client. Never post to a cached
  // WindowClient: it can still look visible while no page is listening anymore.
  return candidates.find(client => client.visibilityState === 'visible') || candidates[0];
}

async function applySessionCookies(client, responseHeaders) {
  const cookies = responseHeaders
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => value);
  if (!cookies.length) return;
  const channel = new MessageChannel();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Specter session cookie adapter timed out')), 5000);
    channel.port1.onmessage = () => { clearTimeout(timeout); resolve(); channel.port1.close(); };
    client.postMessage({ type: 'specter-session-cookies', cookies }, [channel.port2]);
  });
}

async function routeThroughWsgi(request, url) {
  const client = await findBridgeClient();
  if (!client) return new Response('Specter Desktop browser worker is unavailable.', { status: 503 });
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? new ArrayBuffer(0) : await request.arrayBuffer();
  const channel = new MessageChannel();
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Specter WSGI request timed out')), 120000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      resolve(event.data);
      channel.port1.close();
    };
    channel.port1.onmessageerror = () => {
      clearTimeout(timeout);
      reject(new Error('Specter browser bridge response could not be decoded'));
    };
  });
  client.postMessage({
    type: 'specter-wsgi-request',
    request: {
      method: request.method,
      path: wsgiPath(url.pathname),
      query: url.search.slice(1),
      scheme: url.protocol.slice(0, -1),
      content_type: request.headers.get('Content-Type') || '',
      headers: Object.fromEntries(request.headers.entries()),
      body: body,
    },
  }, [channel.port2, body]);
  const result = await responsePromise;
  await applySessionCookies(client, result.headers || []);
  const responseHeaders = new Headers(result.headers || []);
  responseHeaders.set('Cache-Control', 'no-store');
  // Caddy cannot decorate responses synthesized by this service worker. Keep
  // the Flask document and its assets compatible with the site's COEP policy.
  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');
  responseHeaders.set('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'");
  responseHeaders.delete('Content-Length');
  return new Response(result.body || null, { status: Number(String(result.status).split(' ')[0]), headers: responseHeaders });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !needsWsgi(url.pathname)) return;
  event.respondWith(routeThroughWsgi(event.request, url).catch(error =>
    new Response(`Specter browser request failed: ${error.message}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  ));
});
