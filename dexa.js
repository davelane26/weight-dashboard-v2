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

  // Fat-loss ratio used by the RATIO METHOD (see getRatioMethodFat below).
  // Empirically ~80% from Mar→Aug scale trend and ~83% when the endpoints
  // are DEXA-calibrated first. 0.82 is the honest middle. Only a second
  // DEXA can pin this down for real — until then it's a working number.
  const FAT_LOSS_RATIO = 0.82;

  // Shipped default: David's July 27, 2026 DEXA scan at HPCRL (Colorado
  // State). Fat % (31.5) and its offset (vs the nearest scale reading,
  // July 25 at 28.81%) are straight off the report. Lean % (31.4) is the
  // appendicular-lean-mass figure — arms+legs lean mass only — kept here
  // purely as a secondary reference marker. Scan weight is 252.4 lb,
  // which the ratio method needs as its anchor point.
  //
  // musclePct/muscleOffset instead target ESTIMATED TOTAL SKELETAL MUSCLE
  // (36.8% = 92.8 lb ÷ 252.4 lb scan weight), derived from the DXA
  // appendicular lean mass via Kim-2002 and cross-checked by the Lee-2000
  // anthropometric equation (93.9 lb). This is the number David wants
  // surfaced — the scale's BIA muscle low-balls true skeletal muscle, so
  // the offset is POSITIVE: 36.8 − 33.21 (scale that day) = +3.59 pp.
  // NOTE: total skeletal muscle is an ESTIMATE (formula-derived), not a
  // direct DXA measurement; only serial DXAs track true muscle change.
  // fallback: any scan logged via the form (localStorage) takes
  // precedence permanently once saved, and an explicit "Remove scan" is
  // respected rather than reverting to this default.
  const SHIPPED_DEFAULT = [{
    date: '2026-07-27', fatPct: 31.5, leanPct: 31.4, musclePct: 36.8, weight: 252.4,
    nearestScaleDate: '2026-07-25', nearestScaleFat: 28.81, fatOffset: 2.69,
    nearestScaleMuscle: 33.21, muscleOffset: 3.59,
  }];

  function loadScans() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // null means the key was never set — safe to use the shipped
      // default. Any stored value (including "[]" from an explicit
      // Remove) must be respected as-is, not overridden.
      if (raw === null) return SHIPPED_DEFAULT;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Migration: earlier shipped defaults stored the July 27 anchor
      // with weight:null, which disables the ratio method. If we find
      // that exact shape, backfill the known scan weight (252.4 lb) so
      // existing users get the ratio method without having to re-enter.
      return arr.map(scan => {
        if (scan && scan.date === '2026-07-27'
            && (scan.weight == null || scan.weight === 0)
            && Math.abs((scan.fatPct || 0) - 31.5) < 0.01) {
          return Object.assign({}, scan, { weight: 252.4 });
        }
        return scan;
      });
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

  // Convert a DEXA report's appendicular lean mass (ALM, lb) into an
  // estimated TOTAL skeletal muscle % of body weight, so the Muscle %
  // field stays on the total-skeletal-muscle basis the dashboard uses
  // (not raw appendicular lean). Kim-2002 equation:
  //   TSM(kg) = 1.19 x ALM(kg) - 1.65
  // then TSM% = TSM(lb) / scan weight (lb) x 100.
  const LB_PER_KG = 2.20462;
  function convertAlmToMuscle() {
    const alm = parseFloat(document.getElementById('dexa-alm')?.value);
    const wt  = parseFloat(document.getElementById('dexa-weight')?.value);
    if (isNaN(alm) || isNaN(wt) || wt <= 0) {
      alert('Enter both appendicular lean mass (lb) and scan weight (lb) first.');
      return;
    }
    const almKg = alm / LB_PER_KG;
    const tsmKg = 1.19 * almKg - 1.65;   // Kim-2002
    const tsmLb = tsmKg * LB_PER_KG;
    const pct   = +(tsmLb / wt * 100).toFixed(1);
    const field = document.getElementById('dexa-muscle');
    if (field) field.value = pct;
  }
  window.convertAlmToMuscle = convertAlmToMuscle;

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
        parts.push(`Scale read ${scan.nearestScaleMuscle.toFixed(1)}% muscle that day — the scale ${mdir} muscle (vs this scan's estimated total skeletal muscle) by ${Math.abs(scan.muscleOffset).toFixed(1)}pp. Muscle % is now corrected by that offset too.`);
      }
      note.textContent = parts.join(' ');
    }
  }
  window.renderDexaPanel = renderDexaPanel;

  // RATIO METHOD: propagate body-fat % forward from the DEXA anchor
  // using the known fat-loss ratio. Answers "if I've been losing at
  // FAT_LOSS_RATIO fat quality, what MUST my BF be at today's weight?"
  //
  // Math:
  //   anchorFatLbs = scan.weight * scan.fatPct / 100
  //   weightDelta  = scan.weight - currentWeight   (positive when losing)
  //   currentFatLbs = anchorFatLbs - weightDelta * FAT_LOSS_RATIO
  //   currentBF%   = currentFatLbs / currentWeight * 100
  //
  // Returns null if the anchor scan has no weight, or currentWeight is
  // missing/invalid. Callers should fall back to the constant-offset
  // method in that case.
  function getRatioMethodFat(currentWeight) {
    const scan = latestScan();
    if (!scan || !scan.weight || !currentWeight || currentWeight <= 0) return null;
    const anchorFatLbs  = scan.weight * scan.fatPct / 100;
    const weightDelta   = scan.weight - currentWeight;
    const currentFatLbs = anchorFatLbs - weightDelta * FAT_LOSS_RATIO;
    if (currentFatLbs < 0) return null;   // pathological — bail
    return currentFatLbs / currentWeight * 100;
  }

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
    getRatioMethodFat: getRatioMethodFat,
    getFatLossRatio: function () { return FAT_LOSS_RATIO; },
    getScan: latestScan,
  };

  document.addEventListener('DOMContentLoaded', renderDexaPanel);
})();
