const CACHE_NAME = 'ravebox-vj-1776699652';

self.addEventListener('install', (event) => {
    // Cache each asset individually — skip any that fail (e.g. missing on GCS)
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const urls = [
                'manager.html',
                'visualdmx.html',
                'setup.html',
                'gamepad.html',
                'help.html',
                'manifest.json',
                'icon.png',
                'background.png'
            ];
            return Promise.all(
                urls.map(url => cache.add(url).catch(() => console.log('SW: skipped', url)))
            );
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
    if (event.request.method !== 'GET') return;

    // Bypass API routes completely
    const url = new URL(event.request.url);
    if (url.pathname.includes('/status') ||
        url.pathname.includes('/start') ||
        url.pathname.includes('/stop') ||
        url.pathname.includes('/restart') ||
        url.pathname.includes('/api')) {
        return;
    }

    // For navigation requests, try network first, then cache
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(event.request) || caches.match('manager.html');
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
