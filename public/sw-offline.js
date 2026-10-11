const CACHE_NAME = 'kmfri-offline-project-data-v1';
const RUNTIME_CACHE = 'kmfri-runtime-assets-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // Ignore individual asset failures during initial install
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== RUNTIME_CACHE && !key.startsWith('kmfri-')) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Never intercept Vite internal dev scripts or WebSocket requests
  if (
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/@fs') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/src/')
  ) {
    return;
  }

  // Network-First with Service Worker Cache fallback for KMFRI Database State & Supabase REST API
  if (
    url.pathname === '/api/db/state' ||
    url.pathname === '/offline-cache/kmfri-db-state.json' ||
    (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/rest/v1/'))
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, cloned);
            });
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          const fallbackState = await cache.match('/offline-cache/kmfri-db-state.json');
          if (fallbackState) {
            return fallbackState;
          }
          return new Response(JSON.stringify({ source: 'offline-sw-cache', state: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }

  // Network-First with offline fallback for navigation & static assets
  if (
    request.mode === 'navigate' ||
    url.origin === self.location.origin
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const cloned = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, cloned);
            });
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') {
            const rootCached = await cache.match('/index.html');
            if (rootCached) return rootCached;
          }
          return new Response('Offline', { status: 503 });
        })
    );
  }
});
