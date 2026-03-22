const CACHE_NAME = 'ravebox-vj-v9';
const ASSETS = [
    '/',
    '/index.html',
    '/manager.html',
    '/visualdmx.html',
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

    // Bypass API routes completely
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/status') ||
        url.pathname.startsWith('/start') ||
        url.pathname.startsWith('/stop') ||
        url.pathname.startsWith('/restart') ||
        url.pathname.startsWith('/api')) {
        return; // Let the browser handle these normally
    }

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
