# Bookmarklets

Drag-to-install browser tools for the Weight Dashboard v2.

**Installer page (live):** https://davelane26.github.io/weight-dashboard-v2/bookmarklets/

---

## Current bookmarklets

### `garmin-sync.js` - Garmin Connect sync

Scrapes the currently-open Garmin Connect page (either the Activity dashboard or `/sleep`) and pushes the numbers to Firebase + your Cloudflare Worker backup.

**Data captured:**

| Page | Fields |
|---|---|
| Activity | `steps`, `restingHR`, `activeCalories`, `totalCalories`, `intensityMinutes`, `bodyBattery`, `stressLevel`, `fitnessAge` |
| Sleep    | `sleepHours`, `sleepScore`, `sleepDeep`, `sleepLight`, `sleepRem` |

**Data destinations:**

- `PUT` Firebase `/garmin/{YYYY-MM-DD}.json`
- `PUT` Firebase `/garmin/latest.json`
- `POST` Cloudflare Worker `/health/patch` (legacy backup path)

---

## Two install flavors

The installer page offers both:

### 1. Loader (recommended)

A tiny stable bookmarklet URL that fetches `garmin-sync.js` from GitHub Pages at click-time:

```js
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://davelane26.github.io/weight-dashboard-v2/bookmarklets/garmin-sync.js?t='+Date.now();
  document.head.appendChild(s);
})();
```

**Why prefer this:**
- Edit `garmin-sync.js`, `git push`, next click on any device uses the new code
- Small stable URL that never needs re-installing
- Full source lives in a real `.js` file (syntax highlighting, git diffs, editable)
- The `?t=${Date.now()}` cache-buster forces a fresh fetch every time

**Requires:** internet at click-time (fine for a sync bookmarklet, since it needs internet anyway)

### 2. Self-contained (offline-safe fallback)

The entire minified source packed into the `javascript:` URL. Bigger URL, but works even if GitHub Pages is down. Won't auto-update - you'd re-install if the source changes. The installer page auto-generates this at page load from `garmin-sync.js`.

---

## Modifying the sync logic

1. Edit `garmin-sync.js` in this folder
2. Keep it wrapped in an `(function(){ ... })()` IIFE - it will be `<script>`-injected and must self-execute
3. `git commit && git push`
4. Loader-version users get the new code on their next click (no re-install)
5. Self-contained users: revisit the installer page and drag the button again

### Common maintenance: Garmin UI changes

Garmin uses hash-based CSS class names (e.g. `DataBlock_large_ABC123`). When they redesign, selectors break silently - the alert() shows `--` for everything.

To fix:

1. Open `connect.garmin.com/modern` in Chrome, logged in
2. Right-click the broken element (e.g. Steps count) → **Inspect**
3. Find a stable-looking class fragment (e.g. `StatCard_something`)
4. Update the `document.querySelectorAll(...)` selector in `garmin-sync.js`
5. Test by clicking the bookmarklet on the same page

---

## Why bookmarklets over `sync.html`?

The repo already has `sync.html` for the same job. The bookmarklet has three wins:

| | `sync.html` | Bookmarklet |
|---|---|---|
| Tabs open | 2 (Garmin + sync page) | 1 (just Garmin) |
| Session cookies | Needs Cloudflare Worker relay | Just works (same-origin) |
| Discovery | Remember a URL | One click on your bookmarks bar |
| Sleep page support | Sleep-page-only if you navigate first | Auto-detects URL and switches scraper |

`sync.html` still exists as a manual fallback for when the bookmarklet fails.

---

## Adding a new bookmarklet

1. Create `bookmarklets/your-tool.js` wrapped in an IIFE
2. Add a new card to `bookmarklets/index.html` following the Garmin Sync pattern (drag-link + loader URL pointing at your file)
3. Update this README with a section for your tool
4. Test in a fresh browser profile before shipping

---

## Security & CORS notes

- Bookmarklets run in the origin of the current page. Fetching from `connect.garmin.com` context to `firebaseio.com` works because Firebase REST is CORS-open for writes.
- The bookmarklet does NOT need to read cookies directly - Garmin scraping is DOM-only (already-rendered HTML).
- The Cloudflare Worker fetch used to set `User-Agent` and `Origin` headers explicitly. The browser silently ignores those from client JS (they're browser-controlled), so I removed them in the readable source - kept only `Content-Type`. Functional identical, cleaner.
