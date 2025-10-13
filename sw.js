const CACHE_NAME = 'tds-lottery-v4';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './background-1.jpg',
  './background-2.jpg',
  './background-3.jpg',
  './lottery machine.png',
  './compass-button.png',
  './当たり音.mp3',
  './外れ音.mp3',
  './抽選音.mp3',
  './読み込み音.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k)))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        try {
          const url = new URL(req.url);
          if (req.method === 'GET' && url.origin === location.origin) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          }
        } catch {}
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
