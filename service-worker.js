// Rise service worker: versioned app-shell precache.
//
// Every deploy bumps VERSION (it must match <html data-app-version>). A new
// worker precaches the whole shell into a fresh cache, then waits; the page
// shows an "Update ready" pill and only then does the worker take over, so
// nothing reloads under someone mid-recipe.

const VERSION = '2026.09.28-5';
const SDK_VERSION = '12.19.0'; // Firebase modular SDK; runtime-cached in Phase 2
const SHELL_CACHE = `rise-shell-${VERSION}`;
const SDK_CACHE = `rise-sdk-${SDK_VERSION}`;

// Resolved against this script's URL so the same file works on GitHub Pages
// (/rise-sourdough-app/) and at a domain root.
const SCOPE_PATH = new URL('./', self.location.href).pathname;
const INDEX_URL = new URL('./index.html', self.location.href).href;

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './app.js',
  './calc.js',
  './sync.js',
  './validation.js',
  './recipes.js',
  './share.js',
  './cloud.js',
  './timer.js',
  './fonts/inter-variable.woff2',
  './fonts/fraunces-variable.woff2',
  './icons/icon.svg',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/icon-maskable-192x192.png',
  './icons/icon-maskable-512x512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32x32.png',
  './favicon.ico'
];

// Files that may legitimately be absent (added one by one, failures ignored).
const OPTIONAL_PRECACHE = ['./firebase-config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: 'reload' bypasses the HTTP cache (GitHub Pages serves max-age=600),
    // so a new worker never precaches a stale copy of the shell.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    await Promise.all(
      OPTIONAL_PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== SHELL_CACHE && key !== SDK_CACHE).map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
    return;
  }

  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(SDK_CACHE, request, { store: true }));
  }
});

// The app shell is served from the versioned cache so HTML and modules always
// come from the same release. Other in-scope navigations go to the network and
// fall back to the shell when offline.
async function handleNavigation(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const isAppUrl = url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`;
  if (isAppUrl) {
    const cached = await cache.match(INDEX_URL);
    if (cached) return cached;
  }
  try {
    return await fetch(request);
  } catch (err) {
    const fallback = await cache.match(INDEX_URL);
    if (fallback) return fallback;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(cacheName, request, { store = false } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Never store opaque responses: they cannot be validated and Chrome pads
  // each one to several MB of quota.
  if (store && response.ok && response.type !== 'opaque') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
