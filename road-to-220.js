/* ═══════════════════════════════════════════════════════════════════
   road-to-220.js
   "Road to 220" goal card for the Projector tab.
   Uses global state from app-config.js (projSlopeLbsPerDay etc.)
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const GOAL        = 220;
  const START_W     = 315.0;   // mirrors START_WEIGHT in app-config.js
  const TOTAL_TRIP  = START_W - GOAL;  // 95 lbs

  // Rate scenarios for range-based projections
  const RATE_SCENARIOS = {
    conservative: 2.00,  // Natural slowdown as you get lighter
    baseCase:     2.40,  // True rate continues
    optimistic:   2.80,  // Current 7.5mg pace holds
  };

  const TIPS = [
    { icon: '', bold: 'Never skip an injection.',
      body: 'One missed week resets appetite suppression by 3-5 days and stalls the scale. Same day, every week.' },
    { icon: '', bold: 'Protein first, every meal.',
      body: 'Your muscle % is already rising while losing fat - that\'s rare. High protein is why. Keep it.' },
    { icon: '', bold: 'Resistance training is non-negotiable.',
      body: 'Every lb of muscle you keep raises your BMR floor. Losing muscle accelerates the slowdown.' },
    { icon: '', bold: 'Titrate when needed.',
      body: 'If weight stalls for 2-3 weeks or appetite returns, bump the dose. You have 10, 12.5, 15mg left.' },
  ];

  // ── Helpers ────────────────────────────────────────────────────────
  function fmt(n, dec = 1) { return n.toFixed(dec); }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function etaFromSlope(latestW, latestDate, slope) {
    // slope is lbs/day (negative = losing)
    if (!slope || slope >= 0 || !latestDate) return null;
    const daysLeft = (latestW - GOAL) / Math.abs(slope);
    return new Date(latestDate.getTime() + daysLeft * 86_400_000);
  }

  function etaFromRate(latestW, latestDate, lbsPerWeek) {
    // lbsPerWeek is positive (lbs lost per week)
    if (!lbsPerWeek || lbsPerWeek <= 0 || !latestDate) return null;
    const remaining = latestW - GOAL;
    if (remaining <= 0) return new Date(); // already at goal
    const weeksLeft = remaining / lbsPerWeek;
    return new Date(latestDate.getTime() + weeksLeft * 7 * 86_400_000);
  }

  function fmtRange(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Render ───────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('road-to-220-content');
    if (!container) return;

    const latestW    = projLatestWeight  ?? (allData.length ? allData[allData.length - 1].weight : null);
    const latestDate = projLatestDate    ?? (allData.length ? allData[allData.length - 1].date   : null);
    const slope      = projSlopeLbsPerDay;

    if (!latestW) {
      container.innerHTML = '<p style="color:#6d7a95;font-size:0.8rem">Loading data…</p>';
      return;
    }

    const lostTotal   = START_W - latestW;
    const remaining   = Math.max(0, latestW - GOAL);
    const pct         = Math.min(100, (lostTotal / TOTAL_TRIP) * 100);
    const rateWeekly  = slope ? fmt(Math.abs(slope) * 7) : '—';

    // Calculate ETA range using scenarios
    const etaConservative = etaFromRate(latestW, latestDate, RATE_SCENARIOS.conservative);
    const etaBaseCase     = etaFromRate(latestW, latestDate, RATE_SCENARIOS.baseCase);
    const etaOptimistic   = etaFromRate(latestW, latestDate, RATE_SCENARIOS.optimistic);
    
    const daysAwayOpt  = etaOptimistic   ? Math.round((etaOptimistic - new Date()) / 86_400_000) : null;
    const daysAwayCons = etaConservative ? Math.round((etaConservative - new Date()) / 86_400_000) : null;

    // ── Stats grid ──
    const statsHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;margin-bottom:1.25rem">
        ${stat('Progress', fmt(pct, 0) + '%', '#7c3aed', '#f5f0ff')}
        ${stat('Lost total', fmt(lostTotal) + ' lbs', '#2a8703', '#f0fdf4')}
        ${stat('Still to go', fmt(remaining) + ' lbs', '#0053e2', '#f0f4ff')}
        ${stat('Current pace', rateWeekly + ' lbs/wk', '#995213', '#fffbeb')}
      </div>`;

    // ── Progress bar ──
    const barHTML = `
      <div style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;font-size:0.65rem;font-weight:700;color:#6d7a95;margin-bottom:0.35rem">
          <span>315 lbs (Jan 29)</span><span>220 lbs 🏁</span>
        </div>
        <div style="background:#e5e9f5;border-radius:99px;height:14px;overflow:hidden">
          <div style="height:100%;width:${pct.toFixed(1)}%;background:linear-gradient(90deg,#0053e2,#7c3aed);border-radius:99px;transition:width .4s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
            <span style="font-size:0.6rem;font-weight:800;color:#fff">${fmt(pct, 0)}%</span>
          </div>
        </div>
      </div>`;

    // ── ETA range box ──
    const hasRange = etaOptimistic && etaConservative;
    const rangeStr = hasRange
      ? `${fmtRange(etaOptimistic)} - ${fmtRange(etaConservative)}`
      : 'Keep logging - need more data';
    const daysRangeStr = (daysAwayOpt != null && daysAwayCons != null)
      ? `${daysAwayOpt} - ${daysAwayCons} days`
      : '';

    const etaHTML = `
      <div style="background:#f5f0ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:0.9rem 1.1rem;margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
          <div>
            <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;margin-bottom:0.2rem">ETA Range at 220 lbs</p>
            <p style="font-size:1.15rem;font-weight:900;color:#1a2340">${rangeStr}</p>
          </div>
          ${daysRangeStr ? `<div style="text-align:right">
            <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;margin-bottom:0.2rem">Days away</p>
            <p style="font-size:1.1rem;font-weight:900;color:#7c3aed">${daysRangeStr}</p>
          </div>` : ''}
        </div>
        ${hasRange ? `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;font-size:0.7rem">
          <div style="background:#fff7ed;padding:0.5rem;border-radius:8px;text-align:center">
            <p style="color:#995213;font-weight:700;margin-bottom:0.15rem">Conservative</p>
            <p style="color:#1a2340;font-weight:800">${fmtDate(etaConservative)}</p>
            <p style="color:#6d7a95;font-size:0.6rem">${RATE_SCENARIOS.conservative} lbs/wk</p>
          </div>
          <div style="background:#eff6ff;padding:0.5rem;border-radius:8px;text-align:center;border:2px solid #0053e2">
            <p style="color:#0053e2;font-weight:700;margin-bottom:0.15rem">Base Case</p>
            <p style="color:#1a2340;font-weight:800">${fmtDate(etaBaseCase)}</p>
            <p style="color:#6d7a95;font-size:0.6rem">${RATE_SCENARIOS.baseCase} lbs/wk</p>
          </div>
          <div style="background:#f0fdf4;padding:0.5rem;border-radius:8px;text-align:center">
            <p style="color:#2a8703;font-weight:700;margin-bottom:0.15rem">Optimistic</p>
            <p style="color:#1a2340;font-weight:800">${fmtDate(etaOptimistic)}</p>
            <p style="color:#6d7a95;font-size:0.6rem">${RATE_SCENARIOS.optimistic} lbs/wk</p>
          </div>
        </div>` : ''}
      </div>`;

    // ── Tips ──
    const tipsHTML = `
      <p style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.75rem">How to make it happen</p>
      <div style="display:flex;flex-direction:column;gap:0.65rem">
        ${TIPS.map(t => `
          <div style="display:flex;gap:0.75rem;align-items:flex-start;background:#f8f9fe;border-radius:10px;padding:0.75rem">
            <span style="font-size:1.4rem;line-height:1;flex-shrink:0">${t.icon}</span>
            <div style="font-size:0.8rem;color:#1a2340">
              <strong>${t.bold}</strong> ${t.body}
            </div>
          </div>`).join('')}
      </div>`;

    container.innerHTML = statsHTML + barHTML + etaHTML + tipsHTML;
  }

  function stat(label, value, color, bg) {
    return `<div style="background:${bg};border-radius:10px;padding:0.7rem;text-align:center">
      <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.2rem">${label}</p>
      <p style="font-size:1rem;font-weight:800;color:${color};line-height:1.2">${value}</p>
    </div>`;
  }

  // ── Public + tab hook ──────────────────────────────────────────────
  window.renderRoadTo220 = render;

  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__r220Hooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') setTimeout(() => { try { render(); } catch (e) {} }, 80);
      return out;
    };
    wrapped.__r220Hooked = true;
    // preserve any prior hooks already set on this function
    if (orig.__tjHooked) wrapped.__tjHooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => { if (installHook() || ++tries > 40) clearInterval(t); }, 100);
    }
  });
})();

