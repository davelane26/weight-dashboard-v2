/* ════════════════════════════════════════════════════════════════════
   dexa.js — DEXA scan logging + scale calibration
   A DEXA scan is the gold-standard body-comp reference. This stores
   scan(s), computes the offset between DEXA and the nearest scale
   reading for BOTH fat % and muscle %, and exposes those offsets so
   rate-analysis.js / app-kpis.js can calibrate the displayed trends.

   Two different DEXA numbers matter here, and they are NOT the same:
     - leanPct: the report's raw whole-body Lean Mass. Broad category
       (organs/water/bone included) — NOT comparable to the scale's
       isolated Muscle %. Shown only as its own reference marker.
     - musclePct: appendicular lean mass (arms+legs lean mass only,
       excluding trunk/head) — the standard muscle-comparable proxy.
       THIS is what gets compared against the scale's Muscle % to
       compute a real calibration offset, same as fat.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const STORAGE_KEY = 'wt_v2_dexa_v1';

  // Shipped default: David's July 27, 2026 DEXA scan at HPCRL (Colorado
  // State). Fat % (31.5) and its offset (vs the nearest scale reading,
  // July 25 at 28.81%) are straight off the report. Lean % (31.4) is the
  // appendicular-lean-mass figure — arms+legs lean mass only — NOT the
  // report's raw whole-body Lean Mass (65.6%), which includes
  // organs/water and isn't comparable to the scale's isolated muscle
  // estimate; musclePct/muscleOffset use that same 31.4 figure against
  // the scale's muscle reading that same day (33.21%). This is only a
  // fallback: any scan logged via the form (localStorage) takes
  // precedence permanently once saved, and an explicit "Remove scan" is
  // respected rather than reverting to this default.
  const SHIPPED_DEFAULT = [{
    date: '2026-07-27', fatPct: 31.5, leanPct: 31.4, musclePct: 31.4, weight: null,
    nearestScaleDate: '2026-07-25', nearestScaleFat: 28.81, fatOffset: 2.69,
    nearestScaleMuscle: 33.21, muscleOffset: -1.81,
  }];

  function loadScans() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // null means the key was never set — safe to use the shipped
      // default. Any stored value (including "[]" from an explicit
      // Remove) must be respected as-is, not overridden.
      if (raw === null) return SHIPPED_DEFAULT;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return SHIPPED_DEFAULT; }
  }

  function saveScans(scans) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
  }

  function latestScan() {
    const scans = loadScans();
    return scans.length ? scans[scans.length - 1] : null;
  }

  // Nearest scale reading (by bodyFat presence) to a given DEXA date —
  // used to compute the calibration offset.
  function nearestScaleReading(dateStr) {
    const data = (typeof allData !== 'undefined' && allData.length) ? allData : [];
    if (!data.length) return null;
    const target = new Date(dateStr + 'T12:00:00').getTime();
    let best = null, bestDiff = Infinity;
    data.forEach(r => {
      if (r.bodyFat == null || !r.date) return;
      const diff = Math.abs(r.date.getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    });
    return best;
  }

  function toggleDexaForm() {
    const form = document.getElementById('dexa-form');
    if (!form) return;
    form.style.display = form.style.display === 'grid' ? 'none' : 'grid';
  }
  window.toggleDexaForm = toggleDexaForm;

  function saveDexaScan() {
    const date    = document.getElementById('dexa-date')?.value;
    const fat     = parseFloat(document.getElementById('dexa-fat')?.value);
    const lean    = parseFloat(document.getElementById('dexa-lean')?.value);
    const muscle  = parseFloat(document.getElementById('dexa-muscle')?.value);
    const wt      = parseFloat(document.getElementById('dexa-weight')?.value);
    if (!date || isNaN(fat) || isNaN(lean)) {
      alert('Date, body fat %, and lean mass % are required.');
      return;
    }
    const nearest = nearestScaleReading(date);
    const hasMuscle = !isNaN(muscle);
    const scan = {
      date, fatPct: fat, leanPct: lean,
      musclePct: hasMuscle ? muscle : null,
      weight: isNaN(wt) ? null : wt,
      nearestScaleDate: nearest ? nearest.date.toISOString().slice(0, 10) : null,
      nearestScaleFat:  nearest ? nearest.bodyFat : null,
      fatOffset: (nearest && nearest.bodyFat != null) ? (fat - nearest.bodyFat) : 0,
      nearestScaleMuscle: (nearest && nearest.muscle != null) ? nearest.muscle : null,
      muscleOffset: (hasMuscle && nearest && nearest.muscle != null) ? (muscle - nearest.muscle) : 0,
    };
    // Single-scan scope for now: replace rather than accumulate.
    saveScans([scan]);
    toggleDexaForm();
    renderDexaPanel();
    if (typeof renderRateAnalysis === 'function') renderRateAnalysis();
  }
  window.saveDexaScan = saveDexaScan;

  function clearDexaScan() {
    if (!confirm('Remove the logged DEXA scan?')) return;
    saveScans([]);
    renderDexaPanel();
    if (typeof renderRateAnalysis === 'function') renderRateAnalysis();
  }
  window.clearDexaScan = clearDexaScan;

  function renderDexaPanel() {
    const scan = latestScan();
    const summary = document.getElementById('dexa-summary');
    const toggleBtn = document.getElementById('dexa-toggle-btn');
    if (!summary) return;
    if (!scan) {
      summary.style.display = 'none';
      if (toggleBtn) toggleBtn.textContent = '+ Add scan';
      return;
    }
    summary.style.display = 'block';
    if (toggleBtn) toggleBtn.textContent = 'Update scan';
    const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    set('dexa-sum-date', new Date(scan.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    set('dexa-sum-fat',  scan.fatPct.toFixed(1) + '%');
    set('dexa-sum-lean', scan.leanPct.toFixed(1) + '%');
    const muscleEl = document.getElementById('dexa-sum-muscle');
    if (muscleEl) muscleEl.textContent = scan.musclePct != null ? scan.musclePct.toFixed(1) + '%' : '—';
    const note = document.getElementById('dexa-sum-note');
    if (note) {
      const parts = [];
      if (scan.nearestScaleFat != null) {
        const dir = scan.fatOffset > 0 ? 'understated' : 'overstated';
        parts.push(`Scale read ${scan.nearestScaleFat.toFixed(1)}% fat around ${scan.nearestScaleDate} — the scale ${dir} fat by ${Math.abs(scan.fatOffset).toFixed(1)}pp. Body Fat above is corrected by that offset going forward.`);
      } else {
        parts.push('No nearby scale reading found to calibrate fat against — Body Fat above is shown uncalibrated.');
      }
      if (scan.musclePct != null && scan.nearestScaleMuscle != null) {
        const mdir = scan.muscleOffset > 0 ? 'understated' : 'overstated';
        parts.push(`Scale read ${scan.nearestScaleMuscle.toFixed(1)}% muscle that day — the scale ${mdir} muscle (vs this scan's appendicular lean mass) by ${Math.abs(scan.muscleOffset).toFixed(1)}pp. Muscle % is now corrected by that offset too.`);
      }
      note.textContent = parts.join(' ');
    }
  }
  window.renderDexaPanel = renderDexaPanel;

  // Public API consumed by rate-analysis.js / app-kpis.js
  window.DexaCal = {
    getFatOffset: function () {
      const scan = latestScan();
      return scan ? (scan.fatOffset || 0) : 0;
    },
    getMuscleOffset: function () {
      const scan = latestScan();
      return scan ? (scan.muscleOffset || 0) : 0;
    },
    getScan: latestScan,
  };

  document.addEventListener('DOMContentLoaded', renderDexaPanel);
})();
