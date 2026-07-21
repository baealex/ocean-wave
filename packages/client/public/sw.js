const VERSION = 'ocean-wave-v1';
const SHELL_CACHE = `${VERSION}:shell`;
const AUDIO_PREFIX = `${VERSION}:playlist:`;
const STAGING_PREFIX = `${VERSION}:staging:`;
const CORE = ['/', '/offline.html', '/manifest.webmanifest', '/brand-logo.svg', '/default-artwork.jpg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('ocean-wave-') && !name.startsWith(VERSION)).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

const notify = async payload => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => client.postMessage(payload));
};

self.addEventListener('message', event => {
  const { type, playlistId, urls = [] } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'REMOVE_PLAYLIST') event.waitUntil(caches.delete(`${AUDIO_PREFIX}${playlistId}`).then(() => notify({ type: 'OFFLINE_REMOVED', playlistId })));
  if (type === 'DOWNLOAD_PLAYLIST') event.waitUntil((async () => {
    const stagingName = `${STAGING_PREFIX}${playlistId}`;
    await caches.delete(stagingName);
    const staging = await caches.open(stagingName);
    try {
      for (let index = 0; index < urls.length; index += 1) {
        const response = await fetch(urls[index], { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Download failed with ${response.status}`);
        await staging.put(urls[index], response);
        await notify({ type: 'OFFLINE_PROGRESS', playlistId, completed: index + 1, total: urls.length });
      }
      const targetName = `${AUDIO_PREFIX}${playlistId}`;
      await caches.delete(targetName);
      const target = await caches.open(targetName);
      for (const request of await staging.keys()) await target.put(request, await staging.match(request));
      await caches.delete(stagingName);
      await notify({ type: 'OFFLINE_COMPLETE', playlistId, count: urls.length });
    } catch (error) {
      await caches.delete(stagingName);
      await notify({ type: 'OFFLINE_FAILED', playlistId, message: error instanceof Error ? error.message : 'Download failed' });
    }
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/audio/')) {
    event.respondWith((async () => {
      for (const name of (await caches.keys()).filter(name => name.startsWith(AUDIO_PREFIX))) {
        const response = await caches.open(name).then(cache => cache.match(event.request.url));
        if (response) return response;
      }
      return fetch(event.request);
    })());
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(SHELL_CACHE).then(cache => cache.put('/', copy)); return response; }).catch(async () => (await caches.match('/')) || caches.match('/offline.html')));
    return;
  }
  if (['style', 'script', 'image', 'font'].includes(event.request.destination)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(event.request, response.clone())); return response; })));
  }
});
