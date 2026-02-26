const CACHE_NAME = 'vj-v2';
const ASSETS = [
    './visualdmx.html',
    './vj_console.html',
    './manifest.json',
    './icon.png',
    './background.png',
    './remote.html',
    './manager.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
