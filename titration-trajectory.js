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

  // Shared math/data helpers live in titration-utils.js so every
  // Projector-tab card computes "baseline", "pace", etc. the same
  // way. If that script didn't load, bail loudly rather than fall
  // back to a divergent implementation.
  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[titration-trajectory] TitrationUtils missing — card disabled');
    return;
  }

  const JOURNEY_START_W = 315.0;  // Jan 29, 2026
  let selectedDose = null;

  function loadShots() {
    try {
      const raw = localStorage.getItem('glp1_v4');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function getDoseEpisodes() {
    const rawShots = loadShots();
    const sorted = rawShots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);

    if (!sorted.length) {
      return [{
        dose: 7.5,
        startDate: new Date('2026-05-21T12:00:00'),
        endDate: null,
        isCurrent: true,
        shots: []
      }];
    }

    const episodes = [];
    let cur = {
      dose: sorted[0].dose,
      startDate: sorted[0]._dt,
      endDate: null,
      shots: [sorted[0]]
    };

    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i];
      if (s.dose !== cur.dose) {
        cur.endDate = s._dt;
        episodes.push(cur);
        cur = {
          dose: s.dose,
          startDate: s._dt,
          endDate: null,
          shots: [s]
        };
      } else {
        cur.shots.push(s);
      }
    }
    cur.isCurrent = true;
    episodes.push(cur);
    return episodes;
  }

  function getActiveEpisode() {
    const episodes = getDoseEpisodes();
    if (selectedDose != null) {
      const match = episodes.find(e => Math.abs(e.dose - selectedDose) < 0.01);
      if (match) return { ep: match, all: episodes };
    }
    // Default to latest dose (e.g. 10mg)
    const latest = episodes[episodes.length - 1];
    selectedDose = latest.dose;
    return { ep: latest, all: episodes };
  }

  function renderDosePills(episodes, activeDose) {
    const container = document.getElementById('tj-dose-pills');
    if (!container) return;
    const reversed = [...episodes].reverse();
    container.innerHTML = reversed.map(ep => {
      const isSel = Math.abs(ep.dose - activeDose) < 0.01;
      const label = ep.isCurrent ? `⭐ ${ep.dose}mg (Active)` : `${ep.dose}mg`;
      return `<button type="button" onclick="window.setTrajectoryDose(${ep.dose})"
        style="background:${isSel ? '#0053e2' : '#f0f4ff'};color:${isSel ? '#ffffff' : '#0053e2'};
        border:1.5px solid ${isSel ? '#0053e2' : '#c7d7fe'};border-radius:20px;
        padding:0.25rem 0.75rem;font-size:0.75rem;font-weight:700;cursor:pointer;
        transition:all 0.15s ease">${label}</button>`;
    }).join('');
  }

  window.setTrajectoryDose = function(dose) {
    selectedDose = Number(dose);
    renderTitrationTrajectory();
  };

  // Start weight = last scale reading on or before shot day.
  function getProjBase() {
    if (typeof projLatestDate !== 'undefined' && projLatestDate != null) return new Date(projLatestDate);
    if (typeof allData !== 'undefined' && allData && allData.length) return new Date(allData[allData.length - 1].date);
    return new Date();
  }

  function getTitrationWeight(activeEp) {
    if (!activeEp) return null;
    const dataList = (typeof allData !== 'undefined' && allData) ? allData : [];
    const baseline = TU.preChangeBaseline(activeEp.startDate, dataList);
    if (baseline != null) return baseline;

    if (activeEp.shots && activeEp.shots.length && typeof activeEp.shots[0].weight === 'number') {
      return activeEp.shots[0].weight;
    }

    if (activeEp.dose === 2.5) return 315.0;
    if (activeEp.dose === 5.0) return 296.0;
    if (activeEp.dose === 7.5) return 268.5;
    if (activeEp.dose === 10.0) return 250.7;

    if (dataList.length) {
      const firstAfter = dataList.find(r => r.date && r.date >= activeEp.startDate);
      if (firstAfter) return firstAfter.weight;
      return dataList[dataList.length - 1].weight;
    }

    return null;
  }

  function getProjWeight() {
    if (typeof projLatestWeight !== 'undefined' && projLatestWeight != null) return projLatestWeight;
    if (typeof allData !== 'undefined' && allData && allData.length) return allData[allData.length - 1].weight;
    return null;
  }

  const SCENARIOS = [
    { key: 'cons', label: 'Conservative', rate: 2.00, color: '#995213', dash: [6, 4] },
    { key: 'mod',  label: 'Base Case',    rate: 2.40, color: '#0053e2', dash: []     },
    { key: 'opt',  label: 'Optimistic',   rate: 2.80, color: '#2a8703', dash: [3, 2] },
  ];

  const MILESTONES = [265, 260, 255, 250, 245, 240, 235, 230, 225, 220];
  const PROJ_WEEKS = 20;

  // ── Chart instance ─────────────────────────────────────────────────
  let _chart = null;

  const addDays     = TU.addDays;
  const dedupeByDay = TU.dedupeByDay;

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function postTitrationData(activeEp) {
    if (!allData || !allData.length || !activeEp) return [];
    const dayAfter = addDays(activeEp.startDate, 1);
    return dedupeByDay(allData.filter(r => {
      if (!r.date || r.date < dayAfter) return false;
      if (activeEp.endDate && r.date >= activeEp.endDate) return false;
      return true;
    }));
  }

  function getDaysOn(activeEp) {
    if (!activeEp) return 0;
    const end = activeEp.isCurrent ? Date.now() : activeEp.endDate.getTime();
    return Math.max(0, Math.floor((end - activeEp.startDate.getTime()) / 86_400_000));
  }

  function computePace(activeEp, latestReading, daysOn) {
    if (!latestReading || daysOn < 7 || !activeEp) return null;
    const baseW = getTitrationWeight(activeEp);
    if (!baseW) return null;
    return TU.paceFromBaseline(baseW, activeEp.startDate, latestReading);
  }

  function paceLabel(rate, dose) {
    if (rate == null) return { text: `Gathering data — check back after 7+ days on ${dose || ''}mg`, color: '#6d7a95' };

    const sorted = [...SCENARIOS].sort((a, b) => a.rate - b.rate);
    const cons   = sorted[0];

    if (rate < cons.rate / 2) {
      return { text: `${rate.toFixed(2)} lbs/wk — Below conservative`, color: '#ea1100' };
    }
    if (rate < cons.rate) {
      return { text: `${rate.toFixed(2)} lbs/wk — Below conservative`, color: '#995213' };
    }

    let bucket = sorted[0];
    for (const s of sorted) {
      if (rate >= s.rate) bucket = s;
    }
    return { text: `${rate.toFixed(2)} lbs/wk — ${bucket.label} pace`, color: bucket.color };
  }

  // ── Chart ──────────────────────────────────────────────────────────
  function buildChartData(activeEp) {
    const isCur = activeEp ? activeEp.isCurrent : true;
    const startW = isCur ? (getProjWeight() ?? getTitrationWeight(activeEp)) : getTitrationWeight(activeEp);
    const projBase = isCur ? getProjBase() : (activeEp ? activeEp.startDate : getProjBase());
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
        return Math.max(100, +(startW - s.rate * weeks).toFixed(1));
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
    const postData     = postTitrationData(activeEp);
    const actualPoints = dateObjs.map(d =>
      (postData.find(r => Math.abs(r.date - d) < 3 * 86_400_000) || {}).weight ?? null
    );

    const actualDataset = {
      label:           `Actual (${activeEp ? activeEp.dose : ''}mg)`,
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

  function renderChart(activeEp) {
    const canvas = document.getElementById('tj-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_chart) { _chart.destroy(); _chart = null; }

    const { labels, datasets } = buildChartData(activeEp);
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
  function renderMilestoneTable(activeEp) {
    const tbody  = document.getElementById('tj-milestones');
    if (!tbody || !activeEp) return;
    const isCur  = activeEp.isCurrent;
    const startW = isCur ? (getProjWeight() ?? getTitrationWeight(activeEp)) : getTitrationWeight(activeEp);
    const baseDate = isCur ? getProjBase() : activeEp.startDate;

    const rows = MILESTONES.filter(m => m < startW).map(m => {
      const cells = SCENARIOS.map(s => {
        const weeks  = (startW - m) / s.rate;
        const eta    = addDays(baseDate, weeks * 7);
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
  function renderPaceBadge(activeEp) {
    const badge = document.getElementById('tj-pace-badge');
    if (!badge || !activeEp) return;

    const post    = postTitrationData(activeEp);
    const latest  = post.length ? post[post.length - 1] : null;
    const daysOn  = getDaysOn(activeEp);
    const startW  = getTitrationWeight(activeEp);
    const dose    = activeEp.dose;
    const pace    = (latest && daysOn >= 7 && startW != null)
      ? TU.paceFromBaseline(startW, activeEp.startDate, latest)
      : null;
    const info    = paceLabel(pace, dose);
    const weeks   = Math.round((daysOn / 7) * 10) / 10;

    let mathStr = '';
    let cleanStr = '';
    if (pace != null && latest && startW != null) {
      const lost     = startW - latest.weight;
      const days     = (latest.date.getTime() - activeEp.startDate.getTime()) / 86_400_000;
      const wks      = (days / 7).toFixed(1);
      mathStr = `${lost.toFixed(1)} lbs / ${wks} wks · baseline ${startW.toFixed(1)} on ${fmtShort(activeEp.startDate)} → latest ${latest.weight.toFixed(1)} on ${fmtShort(latest.date)}`;

      try {
        const events = (typeof window.getEventsInRange === 'function')
          ? window.getEventsInRange(activeEp.startDate, activeEp.endDate || new Date())
          : [];
        const clean = TU.slopePerWeekClean(post, events, {
          tailDays: 3,
          minClean: 4,
        });
        if (clean.slope != null && clean.excludedCount > 0) {
          const sign = clean.slope >= 0 ? '−' : '+';
          cleanStr = `<span style="color:#2a8703">clean pace ${sign}${Math.abs(clean.slope).toFixed(2)} lbs/wk</span> · ${clean.excludedCount} flagged day${clean.excludedCount !== 1 ? 's' : ''} excluded (${clean.cleanCount} of ${clean.totalCount} readings)`;
        }
      } catch (e) { console.warn('[titration-trajectory] clean slope failed:', e); }
    } else if (daysOn < 7) {
      mathStr = `Gathering dose data (${daysOn} days in). Check back after 7+ days on ${dose}mg for full pace modeling.`;
    }

    badge.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
        <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                     letter-spacing:0.08em;color:#6d7a95">${activeEp.isCurrent ? `Current ${dose}mg Pace` : `Overall ${dose}mg Pace`}</span>
        <span style="font-size:0.85rem;font-weight:800;color:${info.color}">${info.text}</span>
        ${weeks > 0
          ? `<span style="font-size:0.7rem;color:#6d7a95">(${weeks} wk${weeks !== 1 ? 's' : ''} of data)</span>`
          : ''}
      </div>
      ${mathStr ? `<p style="margin:0.35rem 0 0;font-size:0.68rem;color:#9aa5b4;font-family:ui-monospace,monospace">${mathStr}</p>` : ''}
      ${cleanStr ? `<p style="margin:0.25rem 0 0;font-size:0.7rem;color:#6d7a95">${cleanStr}</p>` : ''}`;
  }

  // ── Stats strip ────────────────────────────────────────────────────
  function renderStatsStrip(activeEp) {
    const get = id => document.getElementById(id);
    const post   = postTitrationData(activeEp);
    const startW = getTitrationWeight(activeEp);
    const daysOn = getDaysOn(activeEp);
    const dose   = activeEp.dose;

    const latestW = post.length ? post[post.length - 1].weight
                   : (startW != null ? startW : null);
    const lost    = (startW != null && latestW != null) ? startW - latestW : null;
    const total   = latestW != null ? JOURNEY_START_W - latestW : null;

    // Header title & subtext
    const titleEl = get('tj-card-title');
    if (titleEl) titleEl.innerHTML = `&#128137; ${dose}mg Titration Trajectory`;

    const subDateEl = get('tj-first-shot-date');
    if (subDateEl) subDateEl.textContent = fmtDate(activeEp.startDate);

    const daysLabelEl = get('tj-stat-days-label');
    if (daysLabelEl) daysLabelEl.textContent = `Days on ${dose}mg`;

    if (get('tj-stat-days'))  get('tj-stat-days').textContent  =
      daysOn > 0 ? daysOn + ' days' : `Day 1 on ${dose}mg`;
    if (get('tj-stat-lost'))  {
      get('tj-stat-lost').textContent = (daysOn >= 0 && lost != null)
        ? (lost >= 0 ? '-' : '+') + Math.abs(lost).toFixed(1) + ' lbs'
        : '--';
      get('tj-stat-lost').style.color = (lost != null && lost >= 0) ? '#2a8703' : '#ea1100';
    }
    if (get('tj-stat-total')) get('tj-stat-total').textContent =
      total != null ? '-' + total.toFixed(1) + ' lbs' : '--';
    if (get('tj-stat-now'))   get('tj-stat-now').textContent   =
      latestW != null ? latestW.toFixed(1) + ' lbs' : '--';

    const preShotEl = get('tj-preshot-weight');
    if (preShotEl) {
      preShotEl.textContent = startW != null
        ? startW.toFixed(1) + ' lbs'
        : 'no weigh-in on shot day';
    }
  }

  // ── Main render ────────────────────────────────────────────────────
  function renderTitrationTrajectory() {
    const { ep, all } = getActiveEpisode();
    renderDosePills(all, ep.dose);
    renderStatsStrip(ep);
    renderPaceBadge(ep);
    renderChart(ep);
    renderMilestoneTable(ep);
  }
  window.renderTitrationTrajectory = renderTitrationTrajectory;

  // ── Hook into projector tab switch (instant render) ───────────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__tjHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        // requestAnimationFrame so the panel is visible (Chart.js
        // needs a measurable canvas) without the visible flash that
        // a longer setTimeout produced.
        requestAnimationFrame(() => {
          try { renderTitrationTrajectory(); } catch (e) { console.warn('[titration-trajectory]', e); }
        });
      }
      return out;
    };
    wrapped.__tjHooked = true;
    if (orig.__r220Hooked)   wrapped.__r220Hooked   = true;
    if (orig.__projChained)  wrapped.__projChained  = true;
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
    // Also register with the shared projector pipeline so this card
    // re-renders whenever the main data pipeline (renderAll) fires.
    if (window.TitrationUtils && window.TitrationUtils.registerProjectorRenderer) {
      window.TitrationUtils.registerProjectorRenderer(renderTitrationTrajectory);
    }
  });
})();
