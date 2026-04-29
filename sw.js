/* ════════════════════════════════════════════════════════════════════
   sw.js — David's Health Board service worker (v3)
   Strategy:
     • Pre-cache the app shell on install (best-effort)
     • NETWORK-FIRST for HTML + JS — always try fresh on reload, fall
       back to cache offline. (Pure cache-first was too aggressive and
       served stale code after deploys.)
     • Network-first for data.json (always fresh; cache as fallback)
     • Stale-while-revalidate for CSS, fonts, icons (instant + updates)
     • Old caches purged on activate
   ──────────────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'health-board-v3-1';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './polish.css',
  './activity_styles.css',
  './enhancements.css',
  './tokens.css',
  './icon.svg',
  './manifest.json',
];

// ── Install ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(() => {/* tolerate */}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: nuke old caches, take over open clients ─────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch routing ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const path = url.pathname;

  // data.json: network-first (always try fresh)
  if (path.endsWith('data.json') || path.endsWith('weekly-summary.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // HTML + JS: NETWORK-FIRST so deploys are immediately visible.
  // Cache is the offline fallback only.
  if (sameOrigin && (path.endsWith('.html') || path.endsWith('.js') || path === '/' || path.endsWith('/'))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // CSS, icons, manifest: stale-while-revalidate (instant + auto-update)
  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Cross-origin (CDN, fonts): stale-while-revalidate, opportunistic cache
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
    return new Response('Offline', { status: 503 });
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

// ── Allow page to force-update the SW ─────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
