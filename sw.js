/* ════════════════════════════════════════════════════════════════════
   sw.js — David's Health Board service worker (v2)
   Strategy:
     • Pre-cache the app shell on install (HTML, CSS, JS, icon)
     • Network-first for data.json (always try fresh; fall back to cache)
     • Cache-first for everything else (instant repeat loads, offline)
     • Old caches purged on activate
   ──────────────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'health-board-v2-2';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './polish.css',
  './activity_styles.css',
  './app.js',
  './enhancements.js',
  './heatmap.js',
  './icon.svg',
  './manifest.json',
];

// ── Install: pre-cache the shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(() => {/* tolerate misses */}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: nuke old caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin third-party APIs (glucose worker, GitHub, etc.)
  // — they have their own caching + auth concerns.
  const sameOrigin = url.origin === self.location.origin;

  // Network-first for data.json (anywhere it lives)
  if (url.pathname.endsWith('/data.json') || url.pathname.endsWith('data.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache-first for same-origin shell-ish assets
  if (sameOrigin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Pass-through for everything else (CDN, fonts, third-party data)
  // but opportunistically cache successful responses.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify([]), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const fetchPromise = fetch(req).then(resp => {
    if (resp && resp.ok) {
      caches.open(RUNTIME_CACHE).then(cache => cache.put(req, resp.clone()));
    }
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}
