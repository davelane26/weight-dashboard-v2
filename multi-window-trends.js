/* ──────────────────────────────────────────────────────────────────────
   multi-window-trends.js — 7 / 14 / 21 / 28-day rolling window stats.

   For each window we show:
     • Trailing average weight over that window
     • Linear-regression trend rate (lbs/wk) inside the window
     • Delta vs the immediately-prior same-length window (avg-to-avg)

   Reading the four cards side-by-side is a diagnostic tool:
     - If shorter windows are FASTER than longer windows → real acceleration
     - If shorter windows are SLOWER than longer windows → deceleration / plateau
     - If today's raw reading is far off the 7-day avg → likely a mirage

   Depends on globals from app-config / app-utils (allData, el, fmt).
   Called from app.js::renderAll() via feature-detection.
   ────────────────────────────────────────────────────────────────────── */

const MWT_WINDOWS = [7, 14, 21, 28];

// Pure: compute stats for a single window. Returns null if no data.
function _mwtWindowStats(data, days) {
  if (!data || !data.length) return null;
  const DAY = 24 * 60 * 60 * 1000;
  // Anchor windows to your LATEST reading, not real "now" — a skipped
  // weigh-in day just leaves the window frozen instead of drifting.
  // Rate comes from the shared regressionSlopeLbsPerDay() engine (same
  // one Projector/Goal ETA/Slowdown Check use) instead of a separate
  // copy of the same math, so this card can't disagree with the others.
  const sorted   = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
  const latestMs = new Date(sorted[sorted.length - 1].date).getTime();
  const cutoff   = latestMs - days * DAY;
  const priorCut = cutoff - days * DAY;

  // Dedupe to one reading per calendar day (keep latest). Multi-daily
  // weigh-ins otherwise weight heavy-scale days more than light-scale
  // ones and inject within-day noise (morning-vs-evening drift) into
  // the avg/range display.
  const dedupeByDay = rows => {
    const map = {};
    rows.forEach(r => {
      const ms = new Date(r.date).getTime();
      const key = new Date(r.date).toDateString();
      if (!map[key] || ms > new Date(map[key].date).getTime()) map[key] = r;
    });
    return Object.values(map).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  };

  const win  = dedupeByDay(data.filter(r => new Date(r.date).getTime() >= cutoff));
  const prev = dedupeByDay(data.filter(r => {
    const ms = new Date(r.date).getTime();
    return ms >= priorCut && ms < cutoff;
  }));
  if (!win.length) return null;

  const avg = arr => arr.reduce((s, r) => s + r.weight, 0) / arr.length;
  const slopePerDay = regressionSlopeLbsPerDay(win, days, { anchor: 'latest' });
  const ratePerWk   = slopePerDay != null ? slopePerDay * 7 : null;

  return {
    days,
    n:         win.length,
    avgW:      avg(win),
    prevAvgW:  prev.length ? avg(prev) : null,
    ratePerWk,
    minW:      Math.min(...win.map(r => r.weight)),
    maxW:      Math.max(...win.map(r => r.weight)),
  };
}

// Paint one card given its stats. Uses the same visual language as the
// existing week-over-week cards for cohesion (kpi-label / kpi-value etc).
function _mwtPaintCard(cardEl, s) {
  if (!cardEl) return;
  if (!s) {
    cardEl.innerHTML = `
      <p class="kpi-label" style="color:#0053e2">&#128200; ${cardEl.dataset.days}-Day Trend</p>
      <p class="kpi-value" style="color:#c5c9d5">—</p>
      <p class="kpi-sub">Not enough data</p>`;
    return;
  }

  const rate     = s.ratePerWk;
  const rateOk   = rate != null;
  const losing   = rateOk && rate < 0;
  const rateCol  = !rateOk ? '#6d7a95' : (losing ? '#2a8703' : '#ea1100');
  const rateIcn  = !rateOk ? '·'       : (losing ? '▼'       : '▲');
  const rateTxt  = rateOk ? `${rateIcn} ${fmt(Math.abs(rate), 2)}` : '—';

  const deltaAvg  = s.prevAvgW != null ? s.avgW - s.prevAvgW : null;
  const deltaTxt  = deltaAvg != null
    ? `${deltaAvg <= 0 ? '▼' : '▲'} ${fmt(Math.abs(deltaAvg), 2)} lbs vs prior ${s.days}d`
    : `no prior ${s.days}d window`;
  const deltaCol  = deltaAvg == null ? '#6d7a95' : (deltaAvg <= 0 ? '#2a8703' : '#ea1100');

  cardEl.innerHTML = `
    <p class="kpi-label" style="color:#0053e2">&#128200; ${s.days}-Day Trend</p>
    <p class="kpi-value" style="color:${rateCol}">${rateTxt}</p>
    <p class="kpi-unit">lbs/wk · linear reg</p>
    <p class="kpi-sub">avg <b>${fmt(s.avgW, 2)}</b> · range ${fmt(s.minW, 1)}–${fmt(s.maxW, 1)} · ${s.n} reading${s.n === 1 ? '' : 's'}</p>
    <p class="kpi-sub" style="color:${deltaCol};margin-top:0.25rem">${deltaTxt}</p>
  `;
}

// Public entry point — called from app.js::renderAll().
function renderMultiWindowTrends(data) {
  if (!data || data.length < 2) return;
  // Data is sorted ascending in loadData(); we don't mutate here.
  MWT_WINDOWS.forEach(days => {
    const card = el(`mwt-card-${days}`);
    _mwtPaintCard(card, _mwtWindowStats(data, days));
  });
}
