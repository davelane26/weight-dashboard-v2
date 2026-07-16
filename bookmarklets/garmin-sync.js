/* ════════════════════════════════════════════════════════════════════
   garmin-sync.js — Garmin Connect DOM scraper + Firebase pusher
   ────────────────────────────────────────────────────────────────────
   RUN CONTEXT: bookmarklet — executes in the current tab.
   MUST BE ON:  https://connect.garmin.com (logged in)
                Specifically on the Activity dashboard OR /sleep page.

   FLOW:
     1. Detect URL to decide activity-mode vs sleep-mode
     2. Scrape the visible cards for numbers via CSS selectors
     3. PUT to Firebase /garmin/{date}.json and /garmin/latest.json
     4. POST same payload to Cloudflare Worker /health/patch (backup path)
     5. alert() summary so the user sees what was captured

   MAINTENANCE HAZARDS:
     - Garmin's CSS class names are hash-based (e.g. `DataBlock_large`).
       Every UI refresh could break the selectors. If numbers all show "--",
       inspect an element on connect.garmin.com and update the selector.
     - The Cloudflare Worker (glucose-relay) sets extra User-Agent/Origin
       headers on the outbound fetch. The browser silently ignores those
       from client JS (they're browser-controlled) — kept only for parity
       with the legacy code so future you doesn't wonder.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const FIREBASE = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';
  const WORKER   = 'https://glucose-relay.djtwo6.workers.dev';
  const dateKey  = new Date().toISOString().split('T')[0];
  const url      = window.location.href;

  const data = {
    date: dateKey,
    lastUpdated: new Date().toISOString(),
    source: 'garmin-web',
  };

  // ── Helpers ──────────────────────────────────────────────────────
  function parseTime(str) {
    if (!str) return 0;
    const hm = str.match(/(\d+)h\s*(\d+)m/);
    if (hm) return parseFloat((parseInt(hm[1]) + parseInt(hm[2]) / 60).toFixed(2));
    const hOnly = str.match(/(\d+)h/);
    if (hOnly) return parseInt(hOnly[1]);
    const mOnly = str.match(/(\d+)m/);
    if (mOnly) return parseFloat((parseInt(mOnly[1]) / 60).toFixed(2));
    return 0;
  }

  // ── Sleep page scraper ───────────────────────────────────────────
  function scrapeSleep() {
    // Duration — inside a DataBlock_large card labelled "Duration"
    document.querySelectorAll('[class*="DataBlock_large"]').forEach(card => {
      const labels = card.querySelectorAll('span');
      const values = card.querySelectorAll('div');
      labels.forEach(l => {
        if (l.textContent.trim() === 'Duration') {
          values.forEach(v => {
            if (/\d+h|\d+m/.test(v.textContent)) {
              data.sleepHours = parseTime(v.textContent);
            }
          });
        }
      });
    });

    // Sleep score
    const scoreEl = document.querySelector('[class*="SleepScoreSummary_dailySleepScoreValue"]');
    if (scoreEl) data.sleepScore = parseInt(scoreEl.textContent);

    // Sleep stages
    document.querySelectorAll('[class*="SleepScoreFactorCard_factorCardContainer"]').forEach(card => {
      const label = card.querySelector('[class*="sleepStageLabel"]');
      const value = card.querySelector('[class*="sleepTypeValues"]');
      if (!label || !value) return;
      const name  = label.textContent.trim().toLowerCase();
      const hours = parseTime(value.textContent);
      if (name === 'deep')  data.sleepDeep  = hours;
      if (name === 'light') data.sleepLight = hours;
      if (name === 'rem')   data.sleepRem   = hours;
    });

    alert(
      'Sleep synced!\n' +
      'Hours: ' + (data.sleepHours ?? '--') + '\n' +
      'Score: ' + (data.sleepScore ?? '--') + '\n' +
      'Deep: '  + (data.sleepDeep  ?? '--') + 'h\n' +
      'Light: ' + (data.sleepLight ?? '--') + 'h\n' +
      'REM: '   + (data.sleepRem   ?? '--') + 'h'
    );
  }

  // ── Activity dashboard scraper ───────────────────────────────────
  function scrapeActivity() {
    document.querySelectorAll('[class*="StatCard"],[class*="Gc5Card"],[class*="InFocusCard"]').forEach(card => {
      try {
        const text = card.innerText || card.textContent;

        if (text.startsWith('Steps\n')) {
          const m = text.match(/Steps\n([\d,]+)/);
          if (m) data.steps = parseInt(m[1].replace(/,/g, ''));
        }
        if (text.startsWith('Heart Rate\n')) {
          const m = text.match(/(\d+)\s*bpm/);
          if (m) data.restingHR = parseInt(m[1]);
        }
        if (text.startsWith('Calories Burned\n')) {
          const m = text.match(/Calories Burned\n([\d,]+)\n([\d,]+)\nActive/);
          if (m) {
            data.totalCalories  = parseInt(m[1].replace(/,/g, ''));
            data.activeCalories = parseInt(m[2].replace(/,/g, ''));
          }
        }
        if (text.startsWith('Intensity Minutes\n')) {
          const m = text.match(/Intensity Minutes\n(\d+)/);
          if (m) data.intensityMinutes = parseInt(m[1]);
        }
      } catch (e) { /* ignore per-card failures */ }
    });

    // Body Battery (in secondary cards)
    document.querySelectorAll('[class*="SecondaryStatCard"],[class*="Gc5Card"],[class*="InFocusCard"]').forEach(card => {
      try {
        const text = card.textContent;
        if (text.includes('Body Battery')) {
          const m = text.match(/Body Battery(\d+)/);
          if (m) data.bodyBattery = parseInt(m[1]);
        }
      } catch (e) {}
    });

    // Stress level (loose numeric match in any Stress-tagged element)
    document.querySelectorAll('[class*="Stress"],[class*="stress"]').forEach(el => {
      try {
        const m = el.textContent.trim().match(/^(\d{1,3})$/);
        if (m) data.stressLevel = parseInt(m[1]);
      } catch (e) {}
    });

    // Fitness Age
    const faEl = document.querySelector(
      '[class*="FitnessAgeSecondaryStatCard"] [class*="DataBlock_dataField"]'
    );
    if (faEl && !isNaN(parseInt(faEl.textContent))) {
      data.fitnessAge = parseInt(faEl.textContent);
    }

    alert(
      'Activity synced!\n' +
      'Steps: '        + (data.steps            ?? '--') + '\n' +
      'HR: '           + (data.restingHR        ?? '--') + ' bpm\n' +
      'Calories: '     + (data.activeCalories   ?? '--') + '\n' +
      'Intensity: '    + (data.intensityMinutes ?? '--') + ' min\n' +
      'Body Battery: ' + (data.bodyBattery      ?? '--') + '\n' +
      'Stress: '       + (data.stressLevel      ?? '--') + '\n' +
      'Fitness Age: '  + (data.fitnessAge       ?? '--')
    );
  }

  // ── Choose scraper based on URL ──────────────────────────────────
  if (url.includes('/sleep')) scrapeSleep();
  else scrapeActivity();

  // ── Push to Firebase + backup worker ─────────────────────────────
  // Report success/failure explicitly — fetch() does NOT reject on 4xx/5xx,
  // so a write that's rejected (e.g. 401 Unauthorized, Firebase permission
  // denied) would otherwise fail 100% silently: the scrape alert above still
  // shows real numbers, but nothing actually got persisted anywhere.
  const describe = (label, p) => p
    .then(res => `${label}: ${res.ok ? 'OK' : 'FAILED (' + res.status + ' ' + res.statusText + ')'}`)
    .catch(e => `${label}: FAILED (${e.message})`);

  Promise.all([
    describe('Firebase (day)', fetch(FIREBASE + '/garmin/' + dateKey + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })),
    describe('Firebase (latest)', fetch(FIREBASE + '/garmin/latest.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })),
    describe('Worker patch', fetch(WORKER + '/health/patch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })),
  ]).then(results => {
    console.log('[garmin-sync] Push results:\n' + results.join('\n'));
    const failed = results.filter(r => r.includes('FAILED'));
    if (failed.length) alert('Sync push had failures:\n\n' + results.join('\n'));
  });
})();
