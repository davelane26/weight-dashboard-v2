/* ═══════════════════════════════════════════════════════════════════
   titration-trajectory.js
   7.5mg Mounjaro trajectory projector card for the Projector tab.

   Renders:
     1. Multi-line Chart.js projection (3 scenarios + actual weights)
     2. Milestone ETA table
     3. "Current pace" live badge (updates as actual data accumulates)

   Constants are top-of-file — easy to update on next titration.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── Titration constants ────────────────────────────────────────────
  const TITRATION_DATE  = new Date('2026-05-21T12:00:00');  // first 7.5mg shot
  const DOSE_LABEL      = '7.5mg Mounjaro';
  const JOURNEY_START_W = 315.0;  // Jan 29, 2026

  // Start weight = last scale reading on or before shot day.
  function getProjBase() {
    if (window.projLatestDate) return new Date(projLatestDate);
    if (window.allData && allData.length) return allData[allData.length - 1].weight;
    return new Date();
  }

  function getTitrationWeight() {
    // Returns pre-shot baseline weight (on or before shot day) for stats
    const endOfShotDay = new Date(TITRATION_DATE.getFullYear(), TITRATION_DATE.getMonth(), TITRATION_DATE.getDate(), 23, 59, 59, 999);
    const candidates = allData.filter(r => r.date <= endOfShotDay);
    return candidates.length ? candidates[candidates.length - 1].weight : 268.5;
  }

  function getProjWeight() {
    if (window.projLatestWeight) return projLatestWeight;
    if (window.allData && allData.length) return allData[allData.length - 1].weight;
    return 268.5;
  }

  const SCENARIOS = [
    { key: 'cons', label: 'Conservative', rate: 0.75, color: '#995213', dash: [6, 4] },
    { key: 'mod',  label: 'Moderate',     rate: 1.75, color: '#0053e2', dash: []     },
    { key: 'opt',  label: 'Optimistic',   rate: 2.50, color: '#2a8703', dash: [3, 2] },
  ];

  const MILESTONES = [265, 260, 255, 250, 245, 240, 235, 230, 225, 220];
  const PROJ_WEEKS = 20;

  // ── Chart instance ─────────────────────────────────────────────────
  let _chart = null;

  // ── Helpers ────────────────────────────────────────────────────────
  function addDays(date, days) {
    return new Date(date.getTime() + days * 86_400_000);
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Deduplicate — keep last reading per calendar day
  function dedupeByDay(rows) {
    const map = {};
    rows.forEach(r => {
      const key = r.date.toDateString();
      if (!map[key] || r.date > map[key].date) map[key] = r;
    });
    return Object.values(map).sort((a, b) => a.date - b.date);
  }

  // Readings strictly after the shot day (shot-day weight = pre-shot baseline)
  function postTitrationData() {
    if (!window.allData || !allData.length) return [];
    const dayAfter = addDays(TITRATION_DATE, 1);
    return dedupeByDay(allData.filter(r => r.date >= dayAfter));
  }

  // Compute lbs/week from readings spanning at least 7 days
  function computePace(readings) {
    if (readings.length < 2) return null;
    const first = readings[0];
    const last  = readings[readings.length - 1];
    const days  = (last.date - first.date) / 86_400_000;
    if (days < 7) return null;
    return (first.weight - last.weight) / (days / 7);
  }

  // Which scenario bucket does a rate fall in?
  function paceLabel(rate) {
    if (rate == null) return { text: 'No data yet — check back after 7+ days on 7.5mg', color: '#6d7a95' };
    if (rate < 0.3)   return { text: `${rate.toFixed(2)} lbs/wk — Below conservative`, color: '#ea1100' };
    if (rate < 1.25)  return { text: `${rate.toFixed(2)} lbs/wk — Conservative pace`, color: '#995213' };
    if (rate < 2.15)  return { text: `${rate.toFixed(2)} lbs/wk — Moderate pace`,     color: '#0053e2' };
    return               { text: `${rate.toFixed(2)} lbs/wk — Optimistic pace`,        color: '#2a8703' };
  }

  // ── Chart ──────────────────────────────────────────────────────────
  function buildChartData() {
    const startW  = getProjWeight();
    const projBase = getProjBase();
    const endDate = addDays(projBase, PROJ_WEEKS * 7);
    const labels  = [];
    const dateObjs = [];

    for (let d = new Date(projBase); d <= endDate; d = addDays(d, 7)) {
      labels.push(fmtShort(d));
      dateObjs.push(new Date(d));
    }

    const scenarioDatasets = SCENARIOS.map(s => ({
      label:           `${s.label} (${s.rate} lbs/wk)`,
      data:            dateObjs.map(d => {
        const weeks = (d - projBase) / (7 * 86_400_000);
        return Math.max(100, startW - s.rate * weeks);
      }),
      borderColor:     s.color,
      backgroundColor: s.color + '18',
      borderDash:      s.dash,
      borderWidth:     2,
      pointRadius:     0,
      pointHoverRadius: 4,
      fill:            false,
      tension:         0,
    }));

    // Actual post-titration weights overlaid as gold dots
    const postData     = postTitrationData();
    const actualPoints = dateObjs.map(d =>
      (postData.find(r => Math.abs(r.date - d) < 3 * 86_400_000) || {}).weight ?? null
    );

    const actualDataset = {
      label:           'Actual weight',
      data:            actualPoints,
      borderColor:     '#ffc220',
      backgroundColor: '#ffc220',
      borderWidth:     2,
      pointRadius:     5,
      pointHoverRadius: 7,
      showLine:        true,
      tension:         0,
      spanGaps:        false,
    };

    return { labels, datasets: [...scenarioDatasets, actualDataset] };
  }

  function renderChart() {
    const canvas = document.getElementById('tj-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_chart) { _chart.destroy(); _chart = null; }

    const { labels, datasets } = buildChartData();
    _chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display:  true,
            position: 'bottom',
            labels: {
              color: '#1a2340', font: { size: 11, weight: '600' },
              boxWidth: 16, padding: 12, usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: '#1a2340', padding: 10, cornerRadius: 8,
            titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
            callbacks: {
              label: c => c.parsed.y != null
                ? ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} lbs`
                : null,
            },
          },
        },
        scales: {
          x: {
            ticks:  { color: '#6d7a95', font: { size: 10 }, maxRotation: 0, maxTicksLimit: 8 },
            grid:   { color: 'rgba(0,0,0,0.06)' },
            border: { display: false },
          },
          y: {
            position: 'right',
            ticks:  { color: '#6d7a95', font: { size: 10 }, callback: v => v + ' lbs' },
            grid:   { color: 'rgba(0,0,0,0.06)', borderDash: [4, 4] },
            border: { display: false },
          },
        },
      },
    });
  }

  // ── Milestone table ────────────────────────────────────────────────
  function renderMilestoneTable() {
    const tbody  = document.getElementById('tj-milestones');
    if (!tbody) return;
    const startW = getProjWeight();

    const rows = MILESTONES.filter(m => m < startW).map(m => {
      const cells = SCENARIOS.map(s => {
        const weeks  = (startW - m) / s.rate;
        const eta    = addDays(getProjBase(), weeks * 7);
        const isPast = eta < new Date();
        return `<td style="padding:0.45rem 0.75rem;font-size:0.78rem;font-weight:700;
                  color:${isPast ? '#6d7a95' : s.color};white-space:nowrap">
                  ${fmtDate(eta)}${isPast ? ' \u2713' : ''}
                </td>`;
      }).join('');

      const totalFromJourney = (JOURNEY_START_W - m).toFixed(0);
      return `<tr style="border-bottom:1px solid #e5e9f5">
        <td style="padding:0.45rem 0.75rem;font-size:0.82rem;font-weight:800;color:#1a2340;white-space:nowrap">
          ${m} lbs
          <span style="font-size:0.65rem;color:#6d7a95;font-weight:600;margin-left:0.3rem">
            (${totalFromJourney} lost total)
          </span>
        </td>
        ${cells}
      </tr>`;
    }).join('');

    tbody.innerHTML = rows ||
      '<tr><td colspan="4" style="padding:1rem;color:#6d7a95;text-align:center">All milestones above current weight</td></tr>';
  }

  // ── Pace badge ─────────────────────────────────────────────────────
  function renderPaceBadge() {
    const badge = document.getElementById('tj-pace-badge');
    if (!badge) return;

    const post  = postTitrationData();
    const pace  = computePace(post);
    const info  = paceLabel(pace);
    const weeks = post.length
      ? Math.round((post[post.length - 1].date - TITRATION_DATE) / (7 * 86_400_000) * 10) / 10
      : 0;

    badge.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
        <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                     letter-spacing:0.08em;color:#6d7a95">Current 7.5mg Pace</span>
        <span style="font-size:0.85rem;font-weight:800;color:${info.color}">${info.text}</span>
        ${weeks > 0
          ? `<span style="font-size:0.7rem;color:#6d7a95">(${weeks} wk${weeks !== 1 ? 's' : ''} of data)</span>`
          : ''}
      </div>`;
  }

  // ── Stats strip ────────────────────────────────────────────────────
  function renderStatsStrip() {
    const get = id => document.getElementById(id);
    const post   = postTitrationData();
    const startW = getTitrationWeight();

    const daysOn  = Math.max(0, Math.floor((Date.now() - TITRATION_DATE) / 86_400_000));
    const latestW = post.length ? post[post.length - 1].weight : startW;
    const lost    = startW - latestW;
    const total   = JOURNEY_START_W - latestW;

    if (get('tj-stat-days'))  get('tj-stat-days').textContent  =
      daysOn > 0 ? daysOn + ' days' : 'Starting May 21';
    if (get('tj-stat-lost'))  {
      get('tj-stat-lost').textContent = daysOn > 0
        ? (lost >= 0 ? '-' : '+') + Math.abs(lost).toFixed(1) + ' lbs'
        : '--';
      get('tj-stat-lost').style.color = lost >= 0 ? '#2a8703' : '#ea1100';
    }
    if (get('tj-stat-total')) get('tj-stat-total').textContent = '-' + total.toFixed(1) + ' lbs';
    if (get('tj-stat-now'))   get('tj-stat-now').textContent   = latestW.toFixed(1) + ' lbs';
  }

  // ── Main render ────────────────────────────────────────────────────
  function renderTitrationTrajectory() {
    renderStatsStrip();
    renderPaceBadge();
    renderChart();
    renderMilestoneTable();
  }
  window.renderTitrationTrajectory = renderTitrationTrajectory;

  // ── Hook into projector tab switch ─────────────────────────────────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__tjHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        setTimeout(() => {
          try { renderTitrationTrajectory(); } catch (e) { console.warn('[titration-trajectory]', e); }
        }, 50);
      }
      return out;
    };
    wrapped.__tjHooked = true;
    if (orig.__r220Hooked) wrapped.__r220Hooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => {
        if (installHook() || ++tries > 40) clearInterval(t);
      }, 100);
    }
  });
})();



