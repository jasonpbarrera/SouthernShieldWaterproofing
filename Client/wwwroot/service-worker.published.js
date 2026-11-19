// Caution! Be sure you understand the caveats before publishing an application with
// offline support. See https://aka.ms/blazor-offline-considerations

self.importScripts('./service-worker-assets.js');
self.addEventListener('install', event => event.waitUntil(onInstall(event)));
self.addEventListener('activate', event => event.waitUntil(onActivate(event)));
self.addEventListener('fetch', event => event.respondWith(onFetch(event)));

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;
const offlineAssetsInclude = [ /\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.json$/, /\.css$/, /\.woff$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/, /\.webmanifest$/ ];
const offlineAssetsExclude = [ /^service-worker\.js$/ ];

const base = "/";
const baseUrl = new URL(base, self.origin);
const manifestUrlList = self.assetsManifest.assets.map(asset => new URL(asset.url, baseUrl).href);

async function onInstall(event) {
    console.info('Service worker: Install');
    self.skipWaiting();

    const assetsRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(asset.url, { integrity: asset.hash, cache: 'no-cache' }));
    await caches.open(cacheName).then(cache => cache.addAll(assetsRequests));
}

async function onActivate(event) {
    console.info('Service worker: Activate');

    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
        .filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));

    await self.clients.claim();
}

async function onFetch(event) {
    const requestUrl = new URL(event.request.url);

    // Always bypass service worker caching for API requests
    if (requestUrl.pathname.startsWith('/api/')) {
        return fetch(event.request);
    }

    if (event.request.method !== 'GET') {
        return fetch(event.request);
    }

    const shouldServeIndexHtml = event.request.mode === 'navigate'
        && !manifestUrlList.some(url => url === event.request.url);

    const isFreshnessCritical = shouldServeIndexHtml
        || requestUrl.pathname.endsWith('/index.html')
        || requestUrl.pathname.endsWith('.css')
        || requestUrl.pathname.endsWith('/appsettings.json');

    const cache = await caches.open(cacheName);
    const cacheRequest = shouldServeIndexHtml ? 'index.html' : event.request;

    if (isFreshnessCritical) {
        try {
            const networkResponse = await fetch(event.request);
            if (networkResponse && networkResponse.ok) {
                cache.put(cacheRequest, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
        } catch {
            const cached = await cache.match(cacheRequest);
            if (cached) return cached;
            throw new Error('Offline and no cached response available.');
        }
    }

    const cachedResponse = await cache.match(cacheRequest);
    return cachedResponse || fetch(event.request);
}
