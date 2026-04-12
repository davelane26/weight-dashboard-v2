// Service Worker — David's Weight Dashboard
const CACHE     = 'weight-dash-v6'; // bumped version to force refresh
const DATA_URL  = 'https://davelane26.github.io/Weight-tracker/data.json';

// App shell — these are cached on install
const SHELL = [
  '/weight-dashboard-v2/',
  '/weight-dashboard-v2/index.html',
  '/weight-dashboard-v2/style.css',
  '/weight-dashboard-v2/app.js',
  '/weight-dashboard-v2/glucose.js',
  '/weight-dashboard-v2/icon.svg',
  '/weight-dashboard-v2/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
];

// ── Install: cache app shell ─────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
    // No skipWaiting — let the page decide when to activate
  );
});

// ── Message: page tells us to take over ──────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Activate: remove old caches ──────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for data, cache-first for shell ─────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always go network-first for glucose AND weight data (want fresh readings)
  if (url.includes('data.json') || url.includes('glucose.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)) // offline fallback
    );
    return;
  }

  // Cache-first for everything else (app shell)
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
      )
  );
});
