/* InnovateX public offline shell. Member data and API responses never enter Cache Storage. */
const PUBLIC_CACHE = 'innovatex-public-v1';
const CACHE_PREFIX = 'innovatex-public-';
const scope = new URL(self.registration.scope);
const urlFor = path => new URL(path, scope).href;
const offlineUrl = urlFor('offline.html');
const publicFiles = [
  'offline.html',
  'about/index.html',
  'founders/index.html',
  'styles.css',
  'public-pages.css?v=20260927b',
  'assets/club-about-lab.webp'
];
const staticUrls = new Set(publicFiles.slice(3).map(urlFor));
const publicRoutes = new Map([
  [urlFor('about/'), urlFor('about/index.html')],
  [urlFor('about/index.html'), urlFor('about/index.html')],
  [urlFor('founders/'), urlFor('founders/index.html')],
  [urlFor('founders/index.html'), urlFor('founders/index.html')]
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PUBLIC_CACHE);
    await cache.addAll(publicFiles.map(urlFor));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== PUBLIC_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

const isPublicResponse = response => response.ok && response.status === 200 && response.type === 'basic';

async function publicNavigation(request, cacheKey) {
  const cache = await caches.open(PUBLIC_CACHE);
  try {
    const response = await fetch(request);
    if (isPublicResponse(response) && (response.headers.get('content-type') || '').includes('text/html')) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(cacheKey)) || (await cache.match(offlineUrl)) || Response.error();
  }
}

async function privateOrUnknownNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    // The workspace shell can contain private account content. Never replay it offline.
    return (await caches.match(offlineUrl)) || Response.error();
  }
}

async function publicAsset(request, url) {
  const cache = await caches.open(PUBLIC_CACHE);
  try {
    const response = await fetch(request);
    if (isPublicResponse(response)) await cache.put(url, response.clone());
    return response;
  } catch {
    return (await cache.match(url)) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization') || request.headers.has('apikey')) return;
  const url = new URL(request.url);

  // Never observe cross-origin requests or dynamic resources.
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;

  if (request.mode === 'navigate') {
    // Auth callbacks and all other query-string navigations bypass the worker.
    if (url.search) return;
    const cacheKey = publicRoutes.get(url.href);
    event.respondWith(cacheKey ? publicNavigation(request, cacheKey) : privateOrUnknownNavigation(request));
    return;
  }

  if (staticUrls.has(url.href)) event.respondWith(publicAsset(request, url.href));
});
