// A unique name for the cache
const CACHE_NAME = 'rise-sourdough-calculator-v1';
// List of files to cache
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com'
];

// Install event: fires when the service worker is first installed.
self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event: fires for every network request.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response from cache
        if (response) {
          return response;
        }

        // Not in cache - fetch from network
        return fetch(event.request);
      }
    )
  );
});
