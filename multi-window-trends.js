/* ─────────────────────────────────────────────────────────────────────
   multi-window-trends.js — rolling-window trend stats at two horizons.

   SHORT HORIZON (weeks): 7 / 14 / 21 / 28-day windows.
     Diagnostic: is my last month accelerating, plateauing, or noise?

   LONG HORIZON  (months): 30 / 60 / 90 days + lifetime.
     Diagnostic: is my recent hot/cold streak the real trend, or a mirage
     against the longer arc? Also visualises the classic GLP-1 decay
     curve — lifetime rate typically hotter than 90d rate (fast early
     drops) settling toward steady state.

   Cross-row read:
     - Short row hotter than long row  → recent acceleration
     - Short row cooler than long row  → recent stall / plateau
     - Rows roughly equal              → steady trend

   For each window we show:
     - Trailing average weight over that window
     - Linear-regression trend rate (lbs/wk) inside the window
     - Delta vs the immediately-prior same-length window (avg-to-avg)
       (lifetime card shows "since <start>" instead, since there is no
        prior lifetime to compare against)

   Depends on globals from app-config / app-utils (allData, el, fmt,
   START_DATE, START_WEIGHT, regressionSlopeLbsPerDay).
   Called from app.js::renderAll() via feature-detection.
   ────────────────────────────────────────────────────────────────── */

const MWT_WINDOWS      = [7, 14, 21, 28];
const MWT_LONG_WINDOWS = [30, 60, 90, 'lifetime'];

// Pure: compute stats for a single window. Returns null if no data.
// `days` may be a number OR the string 'lifetime' (→ whole-history window
// from START_DATE to latest reading, delta comparison is skipped).
function _mwtWindowStats(data, days) {
  if (!data || !data.length) return null;
  const DAY = 24 * 60 * 60 * 1000;
  const isLifetime = days === 'lifetime';

  // Anchor windows to your LATEST reading, not real "now" — a skipped
  // weigh-in day just leaves the window frozen instead of drifting.
  // Rate comes from the shared regressionSlopeLbsPerDay() engine (same
  // one Projector/Goal ETA/Slowdown Check use) instead of a separate
  // copy of the same math, so this card can't disagree with the others.
  const sorted   = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
  const latestMs = new Date(sorted[sorted.length - 1].date).getTime();

  let effectiveDays, cutoff, priorCut;
  if (isLifetime) {
    const startMs = new Date(START_DATE).getTime();
    effectiveDays = Math.max(1, Math.round((latestMs - startMs) / DAY));
    cutoff        = startMs;
    priorCut      = null;   // no prior-lifetime comparison
  } else {
    effectiveDays = days;
    cutoff        = latestMs - days * DAY;
    priorCut      = cutoff - days * DAY;
  }

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
  const prev = priorCut == null ? [] : dedupeByDay(data.filter(r => {
    const ms = new Date(r.date).getTime();
    return ms >= priorCut && ms < cutoff;
  }));
  if (!win.length) return null;

  const avg = arr => arr.reduce((s, r) => s + r.weight, 0) / arr.length;
  const slopePerDay = regressionSlopeLbsPerDay(win, effectiveDays, { anchor: 'latest' });
  const ratePerWk   = slopePerDay != null ? slopePerDay * 7 : null;

  return {
    days:      isLifetime ? 'Lifetime' : days,
    isLifetime,
    n:         win.length,
    avgW:      avg(win),
    prevAvgW:  prev.length ? avg(prev) : null,
    ratePerWk,
    minW:      Math.min(...win.map(r => r.weight)),
    maxW:      Math.max(...win.map(r => r.weight)),
    spanDays:  effectiveDays,
  };
}

// Paint one card given its stats. Uses the same visual language as the
// existing week-over-week cards for cohesion (kpi-label / kpi-value etc).
function _mwtPaintCard(cardEl, s) {
  if (!cardEl) return;
  const labelBase = cardEl.dataset.days === 'lifetime'
    ? 'Lifetime Trend'
    : `${cardEl.dataset.days}-Day Trend`;
  if (!s) {
    cardEl.innerHTML = `
      <p class="kpi-label" style="color:#0053e2">&#128200; ${labelBase}</p>
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

  // Delta row: for finite windows, compare avg vs prior same-length
  // window. For lifetime, that comparison doesn't exist — show total
  // loss from START_WEIGHT instead so the row still says something.
  let deltaTxt, deltaCol;
  if (s.isLifetime) {
    const totalLost = (typeof START_WEIGHT !== 'undefined') ? START_WEIGHT - s.avgW : null;
    deltaTxt = totalLost != null
      ? `▼ ${fmt(Math.abs(totalLost), 1)} lbs since start (${s.spanDays}d)`
      : `${s.spanDays} days of data`;
    deltaCol = '#2a8703';
  } else {
    const deltaAvg = s.prevAvgW != null ? s.avgW - s.prevAvgW : null;
    deltaTxt = deltaAvg != null
      ? `${deltaAvg <= 0 ? '▼' : '▲'} ${fmt(Math.abs(deltaAvg), 2)} lbs vs prior ${s.days}d`
      : `no prior ${s.days}d window`;
    deltaCol = deltaAvg == null ? '#6d7a95' : (deltaAvg <= 0 ? '#2a8703' : '#ea1100');
  }

  const unitLabel = s.isLifetime
    ? `lbs/wk · avg since start`
    : `lbs/wk · linear reg`;

  cardEl.innerHTML = `
    <p class="kpi-label" style="color:#0053e2">&#128200; ${labelBase}</p>
    <p class="kpi-value" style="color:${rateCol}">${rateTxt}</p>
    <p class="kpi-unit">${unitLabel}</p>
    <p class="kpi-sub">avg <b>${fmt(s.avgW, 2)}</b> · range ${fmt(s.minW, 1)}–${fmt(s.maxW, 1)} · ${s.n} reading${s.n === 1 ? '' : 's'}</p>
    <p class="kpi-sub" style="color:${deltaCol};margin-top:0.25rem">${deltaTxt}</p>
  `;
}

// Auto-generated one-liner comparing recent (14d) to trend (30d) so
// David doesn't have to eyeball the whole grid to answer "is this a
// mirage?". Tuned thresholds:
//   |delta| < 0.35 lbs/wk → "holding steady" (noise band)
//   0.35–0.8 lbs/wk      → "mild" language
//   > 0.8 lbs/wk         → "clear" language
function _mwtBuildDivergenceHint(shortStats, longStats) {
  if (!shortStats || !longStats) return null;
  const s = shortStats.ratePerWk;
  const l = longStats.ratePerWk;
  if (s == null || l == null) return null;

  // Both rates are negative when losing. "Hotter" = more negative.
  // Positive gap (s - l > 0) means short-window rate is SLOWER (less
  // negative) than trend → recent slowdown vs trend.
  const gap = s - l;   // lbs/wk
  const mag = Math.abs(gap);
  const strength = mag < 0.35 ? 'steady' : mag < 0.8 ? 'mild' : 'clear';

  if (strength === 'steady') {
    return `Recent 14d (${fmt(Math.abs(s), 2)} lbs/wk) matches 30d trend (${fmt(Math.abs(l), 2)}) — pace holding, no mirage either way.`;
  }
  const dir = gap < 0 ? 'acceleration' : 'slowdown';
  return `Recent 14d (${fmt(Math.abs(s), 2)} lbs/wk) is ${strength} ${dir} vs 30d trend (${fmt(Math.abs(l), 2)}). ${
    dir === 'acceleration'
      ? 'Recent streak is running above trend — partly real, partly regression-from-a-trough.'
      : 'Recent stretch is below trend — partly real, partly regression-from-a-peak.'
  }`;
}

// Public entry point — called from app.js::renderAll().
function renderMultiWindowTrends(data) {
  if (!data || data.length < 2) return;
  // Data is sorted ascending in loadData(); we don't mutate here.
  const shortStats = {};
  const longStats  = {};

  MWT_WINDOWS.forEach(days => {
    const stats = _mwtWindowStats(data, days);
    shortStats[days] = stats;
    _mwtPaintCard(el(`mwt-card-${days}`), stats);
  });

  MWT_LONG_WINDOWS.forEach(days => {
    const stats = _mwtWindowStats(data, days);
    longStats[days] = stats;
    _mwtPaintCard(el(`mwt-card-${days}`), stats);
  });

  // Cross-row narrative: is recent (14d) hotter/cooler than trend (30d)?
  const hintEl = el('mwt-divergence-hint');
  if (hintEl) {
    const hint = _mwtBuildDivergenceHint(shortStats[14], longStats[30]);
    hintEl.textContent = hint || '';
    hintEl.style.display = hint ? '' : 'none';
  }
}
