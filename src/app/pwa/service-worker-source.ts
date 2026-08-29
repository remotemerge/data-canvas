/**
 * The service worker source, as a template string.
 *
 * Kept as a string rather than a module the bundler compiles because a service worker is a separate
 * script with its own global scope: it cannot import the application's modules, and running it
 * through the app's build would give it `window` assumptions it must not have. The Vite plugin in
 * `vite.config.ts` substitutes the precache list and writes this to `dist/service-worker.js`.
 *
 * `__PRECACHE_MANIFEST__` and `__CACHE_VERSION__` are replaced at build time.
 */
export const SERVICE_WORKER_SOURCE = String.raw`
/* Generated at build time. Edit src/app/pwa/service-worker-source.ts instead. */
const CACHE_NAME = 'data-canvas-__CACHE_VERSION__';
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

/*
 * Navigation requests are network-first so a deployment is picked up on the next load; every other
 * precached asset is hashed and immutable, so it is cache-first. Serving a stale index.html from
 * cache would pin the app to an old build indefinitely.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // The worker does not skip waiting on its own. The page prompts the user and posts
      // SKIP_WAITING, so an update never swaps assets under a session that is mid-analysis.
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match('/index.html');
    if (shell) return shell;
    throw error;
  }
};

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only. A cross-origin request is passed through untouched: this application makes
  // none at runtime, and caching one would quietly create the third-party dependency the privacy
  // claim says does not exist.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
`;
