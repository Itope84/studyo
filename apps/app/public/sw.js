// Studyo service worker: offline copies of the app and the library, and push notifications.
// See docs/offline-brief.md. `scripts/build-sw.mjs` fills in BUILD and SHELL after `expo export`;
// left as they are (dev), nothing is precached.
const BUILD = '__STUDYO_BUILD__';
const SHELL = [] /* __STUDYO_SHELL__ */;

const SHELL_CACHE = `shell-${BUILD}`;
/** API answers (GET), keyed by URL. */
const DATA_CACHE = 'data-v1';
/** Library files from /f/<token>/…, keyed without the token. Shared with the page (src/lib/offline.ts). */
const FILES_CACHE = 'files-v1';
/** How long to wait for the network before using a saved copy (plane Wi-Fi hangs rather than fails). */
const TIMEOUT_MS = 6000;
/** Marks an answer that came from a saved copy, so the app knows the server is out of reach. */
const OFFLINE_HEADER = 'x-studyo-offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (SHELL.length) {
        const cache = await caches.open(SHELL_CACHE);
        // One file failing (a deploy in progress) must not stop the rest; the page itself must succeed.
        await Promise.all(
          SHELL.map(async (path) => {
            try {
              const res = await fetch(path, { cache: 'reload' });
              if (res.ok) await cache.put(path, await plain(res));
              else if (path === '/') throw new Error(`/ answered ${res.status}`);
            } catch (e) {
              if (path === '/') throw e;
            }
          }),
        );
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('shell-') && name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if ((req.headers.get('accept') || '').includes('text/event-stream')) return;

  const file = fileKey(url);
  if (file) {
    if (url.searchParams.has('download')) return;
    event.respondWith(fromFiles(req, url, file));
    return;
  }
  if (req.headers.has('authorization')) {
    event.respondWith(networkFirst(req, DATA_CACHE, req.url));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(new Request(req.url, { mode: 'cors' }), FILES_CACHE));
    return;
  }
  if (url.origin !== self.location.origin || !SHELL.length) return;
  if (req.mode === 'navigate') {
    event.respondWith(page(req));
    return;
  }
  event.respondWith(fromShell(req, url));
});

/** `https://host/f/<token>/a/b` → `https://host/f/_/a/b`: the same file whatever the token. */
function fileKey(url) {
  if (url.origin === self.location.origin && /^\/(_expo|assets)\//.test(url.pathname)) return null;
  const m = url.pathname.match(/^(.*?\/f\/)[^/]+\/(.+)$/);
  return m ? `${url.origin}${m[1]}_/${m[2]}` : null;
}

/**
 * Library files. A file saved for offline (audio, docs) is served from the cache, including the byte ranges
 * media players ask for. Anything else goes to the network first and is saved when it is small.
 */
async function fromFiles(req, url, key) {
  const cache = await caches.open(FILES_CACHE);
  const range = req.headers.get('range');
  if (range) {
    const saved = await cache.match(key, { ignoreVary: true, ignoreSearch: true });
    if (saved) return ranged(saved, range);
    return fetch(req);
  }
  // Fetched as CORS (the server allows it) so the copy is readable, not opaque.
  const cors = new Request(url.origin + url.pathname, { mode: 'cors', credentials: 'omit' });
  return networkFirst(cors, FILES_CACHE, key, { ignoreSearch: true });
}

async function networkFirst(req, cacheName, key, matchOpts = {}) {
  const cache = await caches.open(cacheName);
  const network = fetch(req).then(async (res) => {
    if (res.ok && res.status === 200) {
      const len = Number(res.headers.get('content-length') || 0);
      if (len < 20 * 1024 * 1024) await cache.put(key, res.clone()).catch(() => {});
    }
    return res;
  });
  network.catch(() => {});
  const saved = () =>
    cache.match(key, { ignoreVary: true, ...matchOpts }).then((r) => (r ? marked(r) : null));
  try {
    const res = await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    // The tunnel answers 502/530 when the Mac is asleep or down: as good as offline.
    if (res.status >= 500) return (await saved()) || res;
    return res;
  } catch (e) {
    const copy = await saved();
    if (copy) return copy;
    // No copy: keep waiting for the network (a slow answer beats none).
    return network;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(req, { ignoreVary: true });
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone()).catch(() => {});
  return res;
}

/** The app's own files: the precached copy of this build, or the network (and keep it). */
async function fromShell(req, url) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = await cache.match(url.pathname);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok && /^\/(_expo|assets)\//.test(url.pathname)) await cache.put(url.pathname, res.clone());
  return res;
}

/** Pages: the network when it answers in time (an online launch gets the newest app), else this build's page. */
async function page(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    return await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (e) {
    const saved = await cache.match('/');
    if (saved) return saved;
    return fetch(req);
  }
}

/** A copy with headers that say it came from the cache. */
async function marked(res) {
  const headers = new Headers(res.headers);
  headers.set(OFFLINE_HEADER, '1');
  headers.set('access-control-expose-headers', OFFLINE_HEADER);
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

/** Safari refuses redirected responses for pages; store a plain copy. */
async function plain(res) {
  return new Response(await res.blob(), { status: res.status, headers: res.headers });
}

/** Answer `Range: bytes=a-b` from a saved file (Safari won't play audio without 206 answers). */
async function ranged(saved, range) {
  const blob = await saved.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'content-type': saved.headers.get('content-type') || 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      [OFFLINE_HEADER]: '1',
    },
  });
}

// ---- Push ---------------------------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Studyo', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Studyo', {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/' },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
