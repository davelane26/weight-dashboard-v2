// Service Worker — David's Weight Dashboard
const CACHE = 'weight-dash-v8';

// App shell — pre-cached for offline fallback only
const SHELL = [
  '/weight-dashboard-v2/',
  '/weight-dashboard-v2/index.html',
  '/weight-dashboard-v2/style.css',
  '/weight-dashboard-v2/app.js',
  '/weight-dashboard-v2/glucose.js',
  '/weight-dashboard-v2/activity.js',
  '/weight-dashboard-v2/icon.svg',
  '/weight-dashboard-v2/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
];

// ── Install: cache shell, activate immediately ───────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  // Take over straight away — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate: purge old caches ───────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for everything, cache as offline fallback ────────
// Using cache-first for the shell caused stale HTML/JS to be served on
// soft refresh, breaking the dashboard whenever code was deployed.
self.addEventListener('fetch', e => {
  // Only handle GET requests for our own origin + known external CDNs
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache a fresh copy for offline use
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // offline fallback
  );
});
