/* ════════════════════════════════════════════════════════════════════
   glapp-sync.js — Glapp shot log scraper -> Firebase inbox
   ────────────────────────────────────────────────────────────────────
   DUAL USE:
     1. Bookmarklet on Glapp tab (human clicks, alert()s the summary)
     2. Playwright headless (glapp_sync/glapp_sync.py sets
        `window.__glappHeadless = true` BEFORE injecting this script,
        then awaits `window.__glappSync()` to get the summary as JSON).

   Both paths share ONE scraper implementation via `window.__glappSync`.

   MUST BE ON:  Glapp (any page whose DOM contains the "All logs" shot
                table with the Date / Medication / Dosage columns).

   FLOW (inside window.__glappSync):
     1. Locate the shot table by scanning for a header row containing
        both "Date" and "Dosage" — resilient to class-name churn.
     2. For each data row: extract Date, Medication, Dosage,
        Shot Site, Pain Level, Notes.
     3. Normalize into the dashboard's shot schema:
          { id, date, med, dose, site, pain, notes, imported, source }
        - id is deterministic: `glapp_<YYYY-MM-DD>` so re-syncs dedupe.
        - date defaults time to 17:30 (matches SHOT_SEED convention in
          medication.js) since Glapp only shows a calendar date.
     4. PUT the whole array to Firebase RTDB at
        `/glapp_inbox/shots.json`.  Dashboard's medication.js pulls
        this inbox on load and merges non-duplicate shots into
        `localStorage['glp1_v4']`.
     5. Return a summary object: { ok, count, first, last, error }.

   WHY AN INBOX PATH INSTEAD OF WRITING TO /medication/shots.json:
     - /medication/shots.json is auth-gated (?auth=<firebase-token>).
       The bookmarklet runs on the Glapp origin, which doesn't have the
       Firebase session cookie, so it can't authenticate. Same reason
       garmin-sync.js writes to /garmin/* (public-write path).
     - The dashboard side owns the merge, so Glapp can't overwrite
       hand-curated fields like `weight` that live only in the
       dashboard's shot log.

   FIREBASE RULES REQUIRED (add these to your RTDB rules):
     "glapp_inbox": {
       ".read":  true,
       ".write": true
     }

   MAINTENANCE HAZARDS:
     - If Glapp changes column names or the date-string format, the
       scraper needs a tweak. All parsing lives in ONE place
       (`parseGlappRow`), so fixes are localized.
     - Date strings look like "Wed., Aug 19, 2026" — we strip the
       leading day-of-week token before Date.parse().
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const FIREBASE = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';
  const INBOX    = FIREBASE + '/glapp_inbox/shots.json';

  // ── Helpers ──────────────────────────────────────────────────────
  // "Wed., Aug 19, 2026" -> Date object (local time, defaults to 17:30
  // to match the SHOT_SEED convention in medication.js so PK curves
  // line up with historical entries).
  function parseGlappDate(str) {
    if (!str) return null;
    // Strip leading weekday abbrev + comma/period, e.g. "Wed., "
    const cleaned = str.replace(/^[A-Za-z]{3,}\.?,?\s*/, '').trim();
    const d = new Date(cleaned + ' 17:30');
    return isNaN(d.getTime()) ? null : d;
  }

  function toISODate(d) {
    // YYYY-MM-DD in LOCAL time (avoid the UTC-shift gotcha)
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toISODateTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // "7.50 mg" -> 7.5   |   "10mg" -> 10   |   "2.5 mG" -> 2.5
  function parseDose(str) {
    if (!str) return null;
    const m = str.match(/([\d.]+)\s*mg/i);
    return m ? parseFloat(m[1]) : null;
  }

  // Normalize med + dose into the dashboard's "Mounjaro 7.5mg" style,
  // which medication.js uses for display and dose-comparison bucketing.
  function normalizeMed(medRaw, dose) {
    const med = (medRaw || 'Mounjaro').trim();
    if (dose == null) return med;
    // Strip any trailing dose the med field might already include so we
    // don't end up with "Mounjaro 7.5mg 7.5mg".
    const stripped = med.replace(/\s*[\d.]+\s*mg\s*$/i, '').trim();
    return `${stripped} ${dose}mg`;
  }

  // "Abdomen: Upper Left" -> "Abdomen Upper Left"
  // (SHOT_SEED uses space-separated form.)
  function normalizeSite(str) {
    return (str || '').replace(/:\s*/g, ' ').trim();
  }

  // ── Table scraping ──────────────────────────────────────────────
  // Find the header row that has both "Date" and "Dosage" cells, then
  // treat every subsequent sibling row as data. Header-driven so we
  // don't care about the framework's generated class names.
  function findShotTable() {
    // Try semantic <table> first
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const headers = Array.from(t.querySelectorAll('th, thead td'))
        .map(c => c.textContent.trim().toLowerCase());
      if (headers.includes('date') && headers.includes('dosage')) {
        return { kind: 'table', node: t };
      }
    }
    // Fallback: div-grid layouts. Look for a text node saying "Date"
    // and "Dosage" in the same ancestor. Walk up to find the common
    // parent and treat its direct children as rows.
    const spans = Array.from(document.querySelectorAll('div, span'));
    const dateCell   = spans.find(s => s.textContent.trim() === 'Date');
    const dosageCell = spans.find(s => s.textContent.trim() === 'Dosage');
    if (dateCell && dosageCell) {
      // Walk up until we find a common ancestor
      let n = dateCell;
      while (n && !n.contains(dosageCell)) n = n.parentElement;
      if (n) return { kind: 'grid', node: n.parentElement || n };
    }
    return null;
  }

  function scrapeRowsFromTable(t) {
    const rows = Array.from(t.querySelectorAll('tbody tr'));
    if (rows.length) return rows.map(r => Array.from(r.querySelectorAll('td, th')).map(c => c.textContent.trim()));
    const all = Array.from(t.querySelectorAll('tr'));
    return all.slice(1).map(r => Array.from(r.querySelectorAll('td, th')).map(c => c.textContent.trim()));
  }

  function scrapeRowsFromGrid(container) {
    const dateRe = /[A-Za-z]{3,}\.?,?\s+[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}/;
    const kids   = Array.from(container.children);
    return kids
      .filter(k => dateRe.test(k.textContent))
      .map(k => {
        const cells = Array.from(k.querySelectorAll('*'))
          .filter(el => el.children.length === 0)
          .map(el => el.textContent.trim())
          .filter(Boolean);
        return cells;
      });
  }

  // Convert a raw cell array into a shot object. Column order per
  // Glapp's UI: [Date, Medication, Dosage, Shot Site, Pain, Notes]
  function parseGlappRow(cells) {
    if (!cells || cells.length < 3) return null;
    const d = parseGlappDate(cells[0]);
    if (!d) return null;
    const dose = parseDose(cells[2]);
    return {
      id:       `glapp_${toISODate(d)}`,
      date:     toISODateTime(d),
      med:      normalizeMed(cells[1], dose),
      dose:     dose,
      site:     normalizeSite(cells[3] || ''),
      pain:     (cells[4] || '').trim() || null,
      notes:    (cells[5] || '').trim() || null,
      imported: true,
      source:   'glapp',
    };
  }

  // ── Core scrape + push, shared by bookmarklet and Playwright ─────
  async function glappSync() {
    const found = findShotTable();
    if (!found) {
      return { ok: false, count: 0, error: 'shot-table-not-found' };
    }
    const rawRows = found.kind === 'table'
      ? scrapeRowsFromTable(found.node)
      : scrapeRowsFromGrid(found.node);
    const shots = rawRows.map(parseGlappRow).filter(Boolean);
    if (!shots.length) {
      return { ok: false, count: 0, error: 'zero-rows-parsed', rawRows };
    }
    shots.sort((a, b) => new Date(a.date) - new Date(b.date));

    const payload = {
      lastUpdated: new Date().toISOString(),
      source:      'glapp-scraper',
      count:       shots.length,
      shots:       shots,
    };

    try {
      const res = await fetch(INBOX, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (e) {
      return { ok: false, count: shots.length, error: 'push-failed: ' + e.message };
    }

    return {
      ok:    true,
      count: shots.length,
      first: shots[0],
      last:  shots[shots.length - 1],
    };
  }

  // Expose for Playwright / headless callers.
  window.__glappSync = glappSync;

  // ── Auto-invoke unless the caller set the headless flag ─────────
  // Playwright side sets `window.__glappHeadless = true` before
  // injecting this script so it can await __glappSync() itself
  // without racing an unwanted alert.
  if (window.__glappHeadless) return;

  glappSync().then(result => {
    if (result.ok) {
      alert(
        `Glapp Sync: pushed ${result.count} shots to inbox.\n\n` +
        `First: ${result.first.date}  ${result.first.med}  ${result.first.site}\n` +
        `Last:  ${result.last.date}  ${result.last.med}  ${result.last.site}\n\n` +
        `Open the dashboard and click "Import from Glapp" to merge.`
      );
      console.log('[glapp-sync] pushed:', result);
    } else if (result.error === 'shot-table-not-found') {
      alert(
        'Glapp Sync: could not find the shot table on this page.\n\n' +
        'Make sure you are on the page that shows the "All logs" shot ' +
        'list (Date / Medication / Dosage columns visible) and click ' +
        'the bookmarklet again.'
      );
    } else if (result.error === 'zero-rows-parsed') {
      alert(
        'Glapp Sync: found the table but parsed 0 rows.\n\n' +
        'Open DevTools console for the raw cell dump.'
      );
      console.warn('[glapp-sync] raw rows:', result.rawRows);
    } else {
      alert(
        `Glapp Sync FAILED: ${result.error}\n\n` +
        `Most likely cause: Firebase rules do not allow anon writes to ` +
        `/glapp_inbox. Add this to your RTDB rules:\n\n` +
        `  "glapp_inbox": { ".read": true, ".write": true }`
      );
      console.error('[glapp-sync] failed:', result);
    }
  });
})();
