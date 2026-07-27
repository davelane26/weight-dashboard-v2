/* ════════════════════════════════════════════════════════════════════
   dexa.js — DEXA scan logging + scale calibration
   A DEXA scan is the gold-standard body-comp reference. This stores
   scan(s), computes the offset between the DEXA fat% and the nearest
   scale reading, and exposes that offset so rate-analysis.js can
   calibrate the displayed body-fat trend.

   Lean mass (DEXA) is NOT blended into the scale's Muscle % — DEXA lean
   mass includes bone/organs/water, a broader category than the scale's
   isolated skeletal-muscle estimate. Shown as a separate chart marker.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const STORAGE_KEY = 'wt_v2_dexa_v1';

  // Shipped default: David's July 27, 2026 DEXA scan at HPCRL (Colorado
  // State). Fat % (31.5) and offset (vs the nearest scale reading, July 25
  // at 28.81%) are straight off the report. Lean % (31.4) is the
  // appendicular-lean-mass figure — arms+legs lean mass only, the standard
  // muscle-comparable proxy — NOT the report's raw whole-body Lean Mass
  // (65.6%), which includes organs/water and isn't comparable to the
  // scale's isolated muscle estimate. This is only a fallback: any scan
  // logged via the form (localStorage) takes precedence permanently once
  // saved, and an explicit "Remove scan" is respected rather than
  // reverting to this default.
  const SHIPPED_DEFAULT = [{
    date: '2026-07-27', fatPct: 31.5, leanPct: 31.4, weight: null,
    nearestScaleDate: '2026-07-25', nearestScaleFat: 28.81, fatOffset: 2.69,
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
    const date = document.getElementById('dexa-date')?.value;
    const fat  = parseFloat(document.getElementById('dexa-fat')?.value);
    const lean = parseFloat(document.getElementById('dexa-lean')?.value);
    const wt   = parseFloat(document.getElementById('dexa-weight')?.value);
    if (!date || isNaN(fat) || isNaN(lean)) {
      alert('Date, body fat %, and lean mass % are required.');
      return;
    }
    const nearest = nearestScaleReading(date);
    const scan = {
      date, fatPct: fat, leanPct: lean,
      weight: isNaN(wt) ? null : wt,
      nearestScaleDate: nearest ? nearest.date.toISOString().slice(0, 10) : null,
      nearestScaleFat:  nearest ? nearest.bodyFat : null,
      fatOffset: (nearest && nearest.bodyFat != null) ? (fat - nearest.bodyFat) : 0,
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
    const note = document.getElementById('dexa-sum-note');
    if (note) {
      if (scan.nearestScaleFat != null) {
        const dir = scan.fatOffset > 0 ? 'understated' : 'overstated';
        note.textContent = `Scale read ${scan.nearestScaleFat.toFixed(1)}% around ${scan.nearestScaleDate} — the scale ${dir} fat % by ${Math.abs(scan.fatOffset).toFixed(1)}pp vs this DEXA scan. Body Fat above is now corrected by that offset going forward.`;
      } else {
        note.textContent = 'No nearby scale reading found to calibrate against — Body Fat above is shown uncalibrated.';
      }
    }
  }
  window.renderDexaPanel = renderDexaPanel;

  // Public API consumed by rate-analysis.js
  window.DexaCal = {
    getFatOffset: function () {
      const scan = latestScan();
      return scan ? (scan.fatOffset || 0) : 0;
    },
    getScan: latestScan,
  };

  document.addEventListener('DOMContentLoaded', renderDexaPanel);
})();
