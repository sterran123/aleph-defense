const CACHE = 'byte-back-shell-v11-operations-visible';
const SHELL = ['/', '/app.js', '/manifest.webmanifest', '/app-icon.svg', '/offline.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => event.request.mode === 'navigate'
    ? caches.match('/offline.html') : caches.match(event.request)));
});
