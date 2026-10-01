/* SPACE public offline shell. Member data and API responses never enter Cache Storage. */
const PUBLIC_CACHE = 'innovatex-public-v10';
const CACHE_PREFIX = 'innovatex-public-';
const scope = new URL(self.registration.scope);
const urlFor = path => new URL(path, scope).href;
const offlineUrl = urlFor('offline.html');
const publicFiles = [
  'offline.html',
  'about/index.html',
  'founders/index.html',
  'styles.css?v=space-members-20261001',
  'public-pages.css?v=space-members-20261001',
  'assets/club-about-lab.webp',
  'assets/space-wordmark.png',
  'assets/space-monogram.png',
  'assets/space-logo-poster.png',
  'assets/space-logo-intro.webm'
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

// Only short, generic text appears on the lock screen. The authenticated
// message itself is fetched by the app after the member opens it.
const notificationIcon = urlFor('icons/icon-192.png');
const allowedNotificationRoutes = new Set(['#messages', '#channels', '#notifications']);
function safeNotificationUrl(candidate) {
  try {
    const target = new URL(candidate || '#notifications', scope);
    if (target.origin === scope.origin && target.pathname === scope.pathname &&
        !target.search && allowedNotificationRoutes.has(target.hash)) return target.href;
  } catch {}
  return urlFor('#notifications');
}

async function showPush(event) {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const kind = payload.kind === 'message' ? 'message' : 'notification';
  const url = safeNotificationUrl(payload.url);
  const title = 'SPACE';
  const body = kind === 'message' ? 'You have a new club message.' : 'You have a new club notification.';
  const tag = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id || '') ? `innovatex-${payload.id}` : undefined;
  await self.registration.showNotification(title, {
    body, icon: notificationIcon, badge: notificationIcon, tag,
    data: { url }
  });
  // The backend deliberately sends no private data or unread total in push.
  // A dot alerts members while the app is closed; the open app sets the exact count.
  try { if (typeof self.navigator.setAppBadge === 'function') await self.navigator.setAppBadge(); }
  catch (error) { console.debug('App badge unavailable', error); }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === scope.origin && new URL(client.url).pathname.startsWith(scope.pathname))
      client.postMessage({ type: 'INNOVATEX_PUSH_RECEIVED', kind });
  }
}

self.addEventListener('push', event => { event.waitUntil(showPush(event)); });

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = safeNotificationUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(client => {
      try { const url = new URL(client.url); return url.origin === scope.origin && url.pathname === scope.pathname; }
      catch { return false; }
    });
    if (app) {
      let destination = app;
      try { destination = await app.navigate(target) || app; } catch {}
      await destination.focus();
    } else await self.clients.openWindow(target);
  })());
});
