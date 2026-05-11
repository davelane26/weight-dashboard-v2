/* ════════════════════════════════════════════════════════════════════
   rate-analysis.js — de-skewed weekly rate KPIs + body composition chart
   for the Charts tab. Hooks into the existing renderChartsTab() so it
   re-renders on tab switch + range-pill clicks.

   What it does:
     1. Reads medication phases (live or DEFAULTS) to compute:
          • Naive weekly rate     = total lost since med start ÷ weeks
          • TRUE weekly rate      = same but EXCLUDING phase 1 (water-skewed)
          • Last 4-week rate      = recent trajectory from real weigh-ins
          • Total lost since med  = weight delta from phase 1 start to now
     2. Renders body fat % and muscle % over time on one chart.

   Why a separate file:
     charts-tab.js owns its own state machine. Adding 200 lines to it
     would hurt cohesion. SRP/single-purpose module is cleaner.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // Match Charts tab's dark slate palette
  const FAT_COLOR    = '#f87171';   // red — fat (down is good)
  const MUSCLE_COLOR = '#34d399';   // green — muscle (up is good)
  const GRID_COLOR   = 'rgba(148,163,184,0.10)';
  const TICK_COLOR   = '#64748b';

  let bcChart = null;

  // ── Data helpers ────────────────────────────────────────────────────
  function loadMedPhases() {
    // Mirror charts-tab.js's local data loader (DRY-violation light: small
    // duplicated default that's also in medication.js + charts-tab.js).
    try {
      const raw = localStorage.getItem('mj_journey_v1');
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.phases) && p.phases.length) return p;
      }
    } catch (e) {}
    return {
      startDate: '2026-01-29',
      phases: [
        { dose: 2.5, weightStart: 315, weightEnd: 296 },
        { dose: 5.0, weightStart: 296, weightEnd: 287 },
        { dose: 5.0, weightStart: 287, weightEnd: null },
      ],
    };
  }

  // Estimated phase durations: titration is typically 4 weeks at each dose.
  // We don't store explicit phase end-dates, so 4 weeks per phase is the
  // standard tirzepatide protocol — close enough for rate math.
  const WEEKS_PER_PHASE = 4;

  function dedupeByDay(rows) {
    const byDay = {};
    rows.forEach(r => { byDay[r.date.toDateString()] = r; });
    return Object.values(byDay).sort((a, b) => a.date - b.date);
  }

  // ── Rate KPIs ────────────────────────────────────────────────────────
  function computeRateKPIs() {
    const med    = loadMedPhases();
    const phases = med.phases || [];
    const data   = (typeof allData !== 'undefined' && allData.length) ? allData : [];
    if (!phases.length) return null;

    const startDate  = new Date(med.startDate);
    const startWt    = phases[0].weightStart;
    const currentWt  = data.length ? data[data.length - 1].weight
                                   : (phases[phases.length - 1].weightEnd ?? phases[phases.length - 1].weightStart);
    const today      = data.length ? data[data.length - 1].date : new Date();
    const totalDays  = Math.max(1, (today - startDate) / 86_400_000);
    const totalWeeks = totalDays / 7;

    // Naive: total loss ÷ total weeks (includes water-skewed phase 1)
    const totalLost = startWt - currentWt;
    const naiveRate = totalLost / totalWeeks;

    // TRUE rate: skip phase 1 (water/inflammation phase)
    let trueRate = naiveRate;
    if (phases.length >= 2) {
      const phase1Loss  = phases[0].weightStart - (phases[0].weightEnd ?? phases[0].weightStart);
      const postLoss    = totalLost - phase1Loss;
      const postWeeks   = Math.max(0.1, totalWeeks - WEEKS_PER_PHASE);
      trueRate = postLoss / postWeeks;
    }

    // Last 4 weeks: real weigh-in data only
    let recentRate = null;
    if (data.length > 1) {
      const cutoff = today.getTime() - 28 * 86_400_000;
      const recent = data.filter(r => r.date.getTime() >= cutoff);
      if (recent.length >= 2) {
        const span = (recent[recent.length - 1].date - recent[0].date) / 86_400_000;
        if (span > 0) recentRate = (recent[0].weight - recent[recent.length - 1].weight) / (span / 7);
      }
    }

    return { naiveRate, trueRate, recentRate, totalLost };
  }

  function renderRateKPIs() {
    const k = computeRateKPIs();
    if (!k) return;
    const fmt = v => (v == null || isNaN(v)) ? '—' : v.toFixed(2);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('ra-naive-rate',      fmt(k.naiveRate));
    set('ra-true-rate',       fmt(k.trueRate));
    set('ra-recent-rate',     fmt(k.recentRate));
    set('ra-total-since-med', k.totalLost == null ? '—' : k.totalLost.toFixed(1));
  }

  // ── Body composition chart ──────────────────────────────────────────
  function rangeDays() {
    // Mirror charts-tab.js range pill state
    const map = { '1m': 30, '3m': 90, '6m': 180, 'all': null };
    return map[typeof chartRange !== 'undefined' ? chartRange : 'all'];
  }

  function fmtDateShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderBodyCompKPIs(filtered) {
    if (!filtered.length) return;
    const latest = filtered[filtered.length - 1];
    const first  = filtered[0];
    const fmt = v => (v == null || isNaN(v)) ? '—' : v.toFixed(1) + '%';
    const sgn = (d) => (d == null || isNaN(d)) ? ''
      : (d > 0 ? '+' : '') + d.toFixed(1) + ' pp';

    const fatDelta    = (latest.bodyFat != null && first.bodyFat != null) ? latest.bodyFat - first.bodyFat : null;
    const muscleDelta = (latest.muscle  != null && first.muscle  != null) ? latest.muscle  - first.muscle  : null;

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const setColored = (id, v, goodIfNegative) => {
      const el = $(id); if (!el) return;
      el.textContent = v;
      if (!v) { el.style.color = ''; return; }
      const isNeg = v.startsWith('-');
      const good  = goodIfNegative ? isNeg : !isNeg;
      el.style.color = good ? '#34d399' : '#f87171';
    };

    set('ra-bc-fat',    fmt(latest.bodyFat));
    set('ra-bc-muscle', fmt(latest.muscle));
    setColored('ra-bc-fat-delta',    sgn(fatDelta),    /*goodIfNeg*/ true);
    setColored('ra-bc-muscle-delta', sgn(muscleDelta), /*goodIfNeg*/ false);

    const summary = $('ra-bc-summary');
    if (summary) {
      const days = rangeDays();
      summary.textContent = days
        ? `Last ${days} days · ${filtered.length} readings`
        : `All-time · ${filtered.length} readings`;
    }
  }

  function renderBodyCompChart(filtered) {
    const canvas = $('ra-bodycomp-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (bcChart) { bcChart.destroy(); bcChart = null; }

    const labels = filtered.map(r => fmtDateShort(r.date));
    const fat    = filtered.map(r => r.bodyFat ?? null);
    const muscle = filtered.map(r => r.muscle  ?? null);

    if (!fat.some(v => v != null) && !muscle.some(v => v != null)) {
      const wrap = canvas.parentElement;
      if (wrap) {
        wrap.innerHTML =
          '<p style="text-align:center;color:#64748b;font-size:0.8rem;padding:2.5rem 1rem">' +
          'No body composition data in this range — smart-scale entries with bodyFat/muscle fields needed.' +
          '</p>';
      }
      return;
    }

    bcChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Body Fat %',
            data: fat,
            borderColor: FAT_COLOR,
            backgroundColor: FAT_COLOR,
            fill: false,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: filtered.length < 40 ? 2.5 : 0,
            pointHoverRadius: 5,
            spanGaps: true,
          },
          {
            label: 'Skeletal Muscle %',
            data: muscle,
            borderColor: MUSCLE_COLOR,
            backgroundColor: MUSCLE_COLOR,
            fill: false,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: filtered.length < 40 ? 2.5 : 0,
            pointHoverRadius: 5,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#cbd5e1',
              font: { size: 11, weight: '600' },
              boxWidth: 14,
              padding: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#1e293b',
            padding: 10,
            cornerRadius: 8,
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: {
              label: c => c.parsed.y != null
                ? ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%`
                : null,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: TICK_COLOR, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
            grid:  { color: GRID_COLOR, borderDash: [4, 4] },
            border: { display: false },
          },
          y: {
            position: 'right',
            ticks: { color: TICK_COLOR, font: { size: 10 }, callback: v => v + '%' },
            grid:  { color: GRID_COLOR, borderDash: [4, 4] },
            border: { display: false },
            title: { display: true, text: '% of body mass', color: TICK_COLOR, font: { size: 10, weight: '600' } },
          },
        },
      },
    });
  }

  // ── Public render ────────────────────────────────────────────────────
  function renderRateAnalysis() {
    const data = (typeof allData !== 'undefined' && allData.length) ? allData : null;
    if (!data) return;

    renderRateKPIs();

    const days     = rangeDays();
    const cutoff   = days ? Date.now() - days * 86_400_000 : 0;
    const filtered = dedupeByDay(data.filter(r => r.date && r.date.getTime() >= cutoff));
    if (!filtered.length) return;

    renderBodyCompKPIs(filtered);
    if (!$('tab-charts')?.hidden) renderBodyCompChart(filtered);
  }
  window.renderRateAnalysis = renderRateAnalysis;

  // ── Hook into renderChartsTab so range-pill clicks redraw both ──────
  function installHook() {
    const orig = window.renderChartsTab;
    if (typeof orig !== 'function') return false;
    if (orig.__rateHooked) return true;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try { renderRateAnalysis(); } catch (e) { console.warn('[rate-analysis]', e); }
      return out;
    };
    wrapped.__rateHooked = true;
    window.renderChartsTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof renderChartsTab === 'function' && !window.renderChartsTab) {
      window.renderChartsTab = renderChartsTab;
    }
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => {
        if (typeof renderChartsTab === 'function' && !window.renderChartsTab) {
          window.renderChartsTab = renderChartsTab;
        }
        if (installHook() || ++tries > 30) clearInterval(t);
      }, 100);
    }
  });
})();
