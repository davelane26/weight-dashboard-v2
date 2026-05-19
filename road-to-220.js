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

  const TIPS = [
    { icon: '💉', bold: 'Never skip an injection.',
      body: 'One missed week resets appetite suppression by 3–5 days and stalls the scale. Same day, every week.' },
    { icon: '🥩', bold: 'Protein first, every meal.',
      body: 'Your muscle % is already rising while losing fat — that\'s rare. High protein is why. Keep it.' },
    { icon: '🏋️', bold: 'Resistance training is non-negotiable.',
      body: 'Every lb of muscle you keep raises your BMR floor. Losing muscle accelerates the slowdown you hit in April.' },
    { icon: '📈', bold: 'Titrate on schedule.',
      body: 'Your data shows losses are dose-gated. Every step up (7.5 → 10 → 15mg) unlocks the next phase. Don\'t delay.' },
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
    const eta         = etaFromSlope(latestW, latestDate, slope);
    const rateWeekly  = slope ? fmt(Math.abs(slope) * 7) : '—';
    const etaStr      = eta ? fmtDate(eta) : 'Keep logging — need 30+ days of data';
    const daysAway    = eta ? Math.round((eta - new Date()) / 86_400_000) : null;

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

    // ── ETA box ──
    const etaHTML = `
      <div style="background:#f5f0ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:0.9rem 1.1rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem">
        <div>
          <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;margin-bottom:0.2rem">📅 Regression ETA at 220 lbs</p>
          <p style="font-size:1.05rem;font-weight:900;color:#1a2340">${etaStr}</p>
        </div>
        ${daysAway != null ? `<div style="text-align:right">
          <p style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;margin-bottom:0.2rem">Days away</p>
          <p style="font-size:1.4rem;font-weight:900;color:#7c3aed">${daysAway}</p>
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
