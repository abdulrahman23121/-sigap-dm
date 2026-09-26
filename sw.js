/* SIGAP-DM — Service Worker
   Cache "app shell" sederhana supaya:
   1) Aplikasi memenuhi syarat "installable" (Add to Home Screen) di Android.
   2) Tetap bisa dibuka (tampilan dasar) walau koneksi internet putus-putus.
   Data pasien TETAP disimpan di localStorage, bukan di cache ini. */

const CACHE_NAME = 'sigapdm-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first untuk file sendiri (biar update selalu diambil bila online),
// fallback ke cache bila offline. Font Google tetap lewat jaringan normal.
self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return; // biarkan request font Google lewat apa adanya

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
