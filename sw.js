/* Service worker: app disponible sin conexión + envío en segundo plano (Background Sync). */
const VERSION = '0.1.0';
const SHELL = 'shell-' + VERSION;
const TILES = 'tiles-v1';
const MAX_TILES = 2500;

importScripts('js/config.js', 'js/form-schema.js', 'js/db.js', 'js/agol.js', 'js/sync.js');

const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/config.js', 'js/form-schema.js', 'js/db.js', 'js/agol.js', 'js/sync.js', 'js/geo.js', 'js/photos.js', 'js/scanner.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/zxing/zxing.min.js',
  'vendor/fonts/fonts.css',
  'vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'vendor/fonts/saira-semi-condensed-latin-500-normal.woff2', 'vendor/fonts/saira-semi-condensed-latin-600-normal.woff2', 'vendor/fonts/saira-semi-condensed-latin-700-normal.woff2',
  'vendor/fonts/ibm-plex-mono-latin-400-normal.woff2', 'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, TILES];
    for (const k of await caches.keys()) if (keep.indexOf(k) === -1) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = (u) => /(^|\.)arcgisonline\.com$/.test(u.hostname) && /\/tile\//.test(u.pathname) || /tile\.openstreetmap\.org$/.test(u.hostname);

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES + 200)) await c.delete(k);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos de ArcGIS: nunca se cachean.
  if (/\/rest\/services\//i.test(url.pathname) && !isTile(url)) return;

  if (isTile(url)) {
    event.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        if (resp.ok || resp.type === 'opaque') { c.put(req, resp.clone()); trimTiles(); }
        return resp;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(req); }
      catch (e) {
        if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
        return Response.error();
      }
    })());
  }
});

async function syncAndNotify() {
  const res = await Sync.run();
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((cl) => cl.postMessage({ type: 'sync-end', result: res }));
  return res;
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-' + APP_CONFIG.project) return;
  event.waitUntil(syncAndNotify().then((res) => {
    // Lanzar un error hace que el navegador vuelva a intentarlo más tarde.
    if (res && (res.status === 'offline' || res.status === 'busy')) throw new Error('reintentar');
  }));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sync') event.waitUntil(syncAndNotify());
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});
