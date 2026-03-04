const CACHE_NAME = 'ravebox-vj-v4';
const ASSETS = [
    '/',
    '/index.html',
    '/manager.html',
    '/visualdmx.html',
    '/remote.html',
    '/setup.html',
    '/manifest.json',
    '/icon.png',
    '/background.png'
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
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // For navigation requests, try network first, then cache
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(event.request) || caches.match('/manager.html');
            })
        );
        return;
    }

    // For other assets, try cache first, then network
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
