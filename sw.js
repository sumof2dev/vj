const isDev = self.location.hostname === 'localhost' || 
              self.location.hostname.includes('vj-') || 
              self.location.hostname.includes('.ravebox.love') || 
              self.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/);
const CACHE_NAME = 'ravebox-vj-1777846047'; // Bumping version

self.addEventListener('install', (event) => {
    // Cache each asset individually — skip any that fail (e.g. missing on GCS)
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const urls = [
                'manager.html',
                'visualdmx.html',
                'setup.html',
                'help.html',
                'profile.html',
                'fixture_ai.html',
                'robot_sim.html',
                'manifest.json',
                '/public/icon.png',
                '/public/background.png'
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
    // If we are on the dev server, bypass the service worker cache entirely
    if (isDev) {
        event.respondWith(fetch(event.request));
        return;
    }

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
            fetch(event.request).then(response => {
                // If Cloudflare returns a 404 or 502, force fallback to local offline cache
                if (!response.ok && response.status !== 0) {
                    throw new Error("Network returned " + response.status);
                }
                return response;
            }).catch(() => {
                return caches.match(event.request).then(cachedRes => {
                    if (cachedRes) return cachedRes;
                    // Fallback to home page if the specific page isn't cached
                    return caches.match('manager.html');
                });
            })
        );
        return;
    }

    // For other assets, try cache first, then network
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Return cached response OR try network, then fallback to a 404-safe state
            return response || fetch(event.request).catch(() => {
                console.warn('SW: Fetch failed for', event.request.url);
                return new Response('Network error occurred', { status: 408, headers: { 'Content-Type': 'text/plain' } });
            });
        })
    );
});
