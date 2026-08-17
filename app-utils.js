/* ════════════════════════════════════════════════════════════════════
   app-utils.js — pure helpers: formatters, date parsing, math, DOM
   No DOM event wiring. No render functions. Just utilities.
   ──────────────────────────────────────────────────────────────────── */

// ── BMI (recomputed, not trusted from the synced reading) ────────────
// openScale's synced `bmi` field is computed against whatever height is
// configured in the app, which was 75.0 in — 1 in taller than the 74.0 in
// clinically measured at the July 27 DEXA scan. Recomputing from HEIGHT_IN
// here means every reading, past and future, uses the correct height
// instead of trusting a value baked in with the wrong one.
function correctedBmi(weightLb) {
  return weightLb != null ? 703 * weightLb / (HEIGHT_IN * HEIGHT_IN) : null;
}

// ── Number formatters ────────────────────────────────────────────────
const fmt    = (n, d = 1)  => n != null ? (+n).toFixed(d) : '—';
const fmtK   = n            => n != null ? Math.round(n).toLocaleString('en-US') : '—';
const fmtPct = (n, d = 1)  => n != null ? (+n).toFixed(d) + '%' : '—';

// ── Date formatters ──────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(d) {
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Date parsing ─────────────────────────────────────────────────────
function fixTz(s) {
  // "2026-03-21T09:53-0600" → "2026-03-21T09:53-06:00"
  return typeof s === 'string' ? s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : s;
}
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  const d = new Date(fixTz(String(val)));
  return isNaN(d) ? null : d;
}

// ── BMI category lookup (returns [label, inline-style]) ──────────────
function bmiCategory(bmi) {
  if (bmi < 18.5) return ['Underweight',  'background:#dbeafe;color:#1d4ed8'];
  if (bmi < 25)   return ['Normal',        'background:#dcfce7;color:#166534'];
  if (bmi < 30)   return ['Overweight',    'background:#fef9c3;color:#854d0e'];
  if (bmi < 35)   return ['Obese I',       'background:#ffedd5;color:#c2410c'];
  if (bmi < 40)   return ['Obese II',      'background:#fee2e2;color:#991b1b'];
  return                ['Obese III',      'background:#fecaca;color:#7f1d1d'];
}

// ── Moving average ───────────────────────────────────────────────────
function movingAvg(arr, window = 7) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

// ── Linear regression → lbs/day slope ────────────────────────────────
// Uses last `days` of data so recent trend matters more than old data.
// ── Shared regression engine ─────────────────────────────────────────
// Single source of truth used by: journey projector, Charts tab, Road to 220,
// BMI timeline, goal ETA — everything. Uses a calendar-day window so all
// consumers compute identically regardless of how dense the readings are.
function regressionSlopeLbsPerDay(data, calendarDays = 28, opts = {}) {
  // anchor: 'latest' (default) uses the last reading in the passed-in
  //         data as the window's right edge, so every card stays frozen
  //         — not silently drifting — on days with no new weigh-in.
  //         'now' uses Date.now() instead; tried briefly (Aug 14) to
  //         make every card agree with each other, but the tradeoff
  //         (numbers changing daily with zero new data) was worse than
  //         the problem it solved. Reverted — 'latest' is now the only
  //         anchor every caller in this app actually uses.
  const anchor = opts.anchor || 'latest';
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  if (!daily.length) return null;
  const anchorMs = anchor === 'now'
    ? Date.now()
    : daily[daily.length - 1].date.getTime();
  const cutoff = anchorMs - calendarDays * 86_400_000;
  const win    = daily.filter(r => r.date.getTime() >= cutoff);
  if (win.length < 3) return null;
  const t0  = win[0].date.getTime();
  const pts = win.map(r => [(r.date.getTime() - t0) / 86_400_000, r.weight]);
  const n   = pts.length;
  const sx  = pts.reduce((s, p) => s + p[0], 0);
  const sy  = pts.reduce((s, p) => s + p[1], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const sx2 = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const den = n * sx2 - sx * sx;
  return den === 0 ? null : (n * sxy - sx * sy) / den; // lbs/day, negative = losing
}

function weightTrendSlope(data, days = 28) {
  return regressionSlopeLbsPerDay(data, days);
}

// ── Weight slowdown (deceleration) ───────────────────────────────────
// Compares the regression rate of the most recent `windowDays` against
// the window immediately before it (same length, ending where the
// current one starts). Rates are lbs/WEEK, positive = losing.
// slowdownPct > 0 means the pace is slowing; null when the prior rate
// is too close to zero for a percentage to mean anything.
function computeWeightSlowdown(data, windowDays = 28) {
  if (!data || data.length < 6) return null;
  const sorted = [...data].sort((a, b) => a.date - b.date);

  // Adjacent windows anchored to your LATEST reading, not real "now" —
  // so this stays frozen (not drifting) on days with no new weigh-in,
  // same as every other card.
  //   current = readings in [latest - 28d, latest]
  //   prior   = readings in [latest - 56d, latest - 28d)
  const latestMs   = sorted[sorted.length - 1].date.getTime();
  const currStart  = latestMs - windowDays * 86_400_000;
  const priorStart = latestMs - 2 * windowDays * 86_400_000;
  const currData   = sorted.filter(r => r.date.getTime() >= currStart);
  const priorData  = sorted.filter(r => {
    const t = r.date.getTime();
    return t >= priorStart && t < currStart;
  });

  const currentSlope = regressionSlopeLbsPerDay(currData,  windowDays, { anchor: 'latest' });
  const priorSlope   = regressionSlopeLbsPerDay(priorData, windowDays, { anchor: 'latest' });
  if (currentSlope == null || priorSlope == null) return null;

  const currentRate = -currentSlope * 7;
  const priorRate   = -priorSlope * 7;
  const slowdownPct = priorRate > 0.1
    ? ((priorRate - currentRate) / priorRate) * 100
    : null;
  return { currentRate, priorRate, slowdownPct, windowDays };
}

// ── Exponential-decay projection model ───────────────────────────────
// The old model eased the weekly rate down *linearly* to zero, which
// meant the projected weight flatlined at whatever value the rate hit
// zero — any date past that point gave the same answer. This model
// instead fits an exponential decay toward an asymptote, so the curve
// eases smoothly and never hard-stops.
//
// Step 1: estimate the weekly rate in overlapping trailing windows
// (21 days, stepped every 7 days) across the whole weigh-in history.
// Step 2: fit ln(rate) = a + b*x by least squares, where x is "weeks
// toward now" (0 = today, negative further back). Each window's rate
// is anchored at its time-*centroid* (the mean date of its readings),
// not its end date — a window's regression slope is the best estimate
// of the rate at its centroid, not its edge, and anchoring at the edge
// would bias every window's x by ~windowDays/2, which biases the
// extrapolated intercept (and so R0) while leaving the slope (k)
// unaffected. Because x=0 is "now" by construction, a = ln(R0)
// directly and the decay constant is k = -b.
function computeWeeklyRateWindows(data, windowDays = 21, stepDays = 7) {
  if (!data || data.length < 3) return [];
  const byDay = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily = Object.values(byDay).sort((a, b) => a.date - b.date);
  if (daily.length < 3) return [];

  const dayMs   = 86_400_000;
  const firstMs = daily[0].date.getTime();
  const lastMs  = daily[daily.length - 1].date.getTime();
  const windows = [];
  for (let endMs = lastMs; endMs - windowDays * dayMs >= firstMs; endMs -= stepDays * dayMs) {
    const startMs = endMs - windowDays * dayMs;
    const win = daily.filter(r => r.date.getTime() >= startMs && r.date.getTime() <= endMs);
    if (win.length < 3) continue;
    const t0  = win[0].date.getTime();
    const pts = win.map(r => [(r.date.getTime() - t0) / dayMs, r.weight]);
    const n   = pts.length;
    const sx  = pts.reduce((s, p) => s + p[0], 0);
    const sy  = pts.reduce((s, p) => s + p[1], 0);
    const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
    const sx2 = pts.reduce((s, p) => s + p[0] * p[0], 0);
    const den = n * sx2 - sx * sx;
    if (den === 0) continue;
    const slopePerDay = (n * sxy - sx * sy) / den;
    const centroidMs   = t0 + (sx / n) * dayMs;
    windows.push({
      x:    (centroidMs - lastMs) / (7 * dayMs), // weeks toward now: 0 = today, negative = further back
      rate: -slopePerDay * 7,                     // lbs/week, positive = losing
    });
  }
  return windows;
}

// Fits ln(rate) = a + b*x on the positive-rate windows (a negative or
// zero rate can't be logged, so those windows are dropped). Returns
// null when there aren't at least 3 usable windows. Also returns the
// standard error of b (== standard error of k) for the uncertainty band.
function fitExponentialDecay(data) {
  const pts = computeWeeklyRateWindows(data)
    .filter(w => w.rate > 0.01)
    .map(w => [w.x, Math.log(w.rate)]);
  const n = pts.length;
  if (n < 3) return null;

  const sx  = pts.reduce((s, p) => s + p[0], 0);
  const sy  = pts.reduce((s, p) => s + p[1], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const sx2 = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const den = n * sx2 - sx * sx;
  if (den === 0) return null;

  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;

  const meanX = sx / n;
  const sxx   = pts.reduce((s, p) => s + (p[0] - meanX) ** 2, 0);
  const resSS = pts.reduce((s, p) => s + (p[1] - (a + b * p[0])) ** 2, 0);
  const dof   = n - 2;
  const seB   = (dof > 0 && sxx > 0) ? Math.sqrt(resSS / dof / sxx) : null;

  return { k: -b, r0: Math.exp(a), seB, n };
}

// Minimum decay constant treated as "real" deceleration. Guards against
// floating-point noise around zero (a steady rate can fit k as a tiny
// positive number) blowing up r0/k into an absurd asymptote.
const MIN_DECAY_K = 1e-4;

// Builds the usable projection model, or null when the fit doesn't show
// real deceleration (k <= MIN_DECAY_K) or there isn't enough data (< 3
// usable rate windows). Callers should fall back to plain linear
// extrapolation at the current rate in that case, rather than dividing
// by a near-zero or negative k. kLow/kHigh (one standard error either
// side of k) give callers a range instead of a single point estimate.
function computeExponentialDecayModel(data) {
  const fit = fitExponentialDecay(data);
  if (!fit || !(fit.k > MIN_DECAY_K) || !(fit.r0 > 0.05)) return null;
  const se    = fit.seB;
  const kLow  = se != null ? Math.max(MIN_DECAY_K, fit.k - se) : fit.k;
  const kHigh = se != null ? fit.k + se : fit.k;
  return { r0: fit.r0, k: fit.k, kLow, kHigh, n: fit.n };
}

// Lbs lost after `weeks` under weight(t) = W_now - (r0/k)(1 - e^-kt).
function exponentialLossAt(r0, k, weeks) {
  if (weeks <= 0) return 0;
  return (r0 / k) * (1 - Math.exp(-k * weeks));
}

// { loss, lossLow, lossHigh }: point estimate plus the range implied by
// the k_low/k_high uncertainty band.
function exponentialLossRange(model, weeks) {
  const loss = exponentialLossAt(model.r0, model.k, weeks);
  const a    = exponentialLossAt(model.r0, model.kHigh, weeks);
  const b    = exponentialLossAt(model.r0, model.kLow,  weeks);
  return { loss, lossLow: Math.min(a, b), lossHigh: Math.max(a, b) };
}

// The model's long-run floor: total additional loss as t → ∞. Unlike
// the old linear-decay model, this is a smooth asymptote, not a hard
// stop at a specific date.
function exponentialAsymptote(model) {
  return model.r0 / model.k;
}

// Weeks needed to lose `lbs` at decay constant k, or null if `lbs`
// exceeds the asymptote (r0/k) and so is never reached in finite time.
function exponentialWeeksToLoseAtK(r0, k, lbs) {
  if (lbs <= 0) return 0;
  if (lbs >= r0 / k) return null;
  return -Math.log(1 - (lbs * k) / r0) / k;
}

// { weeks, weeksLow, weeksHigh } for the k_low/k_high band. `weeks` is
// null when the point-estimate k can't reach `lbs`; weeksLow/weeksHigh
// are null only when *neither* bound of the band can reach it.
function exponentialWeeksToLoseRange(model, lbs) {
  const weeks = exponentialWeeksToLoseAtK(model.r0, model.k, lbs);
  const vals  = [
    exponentialWeeksToLoseAtK(model.r0, model.kLow,  lbs),
    exponentialWeeksToLoseAtK(model.r0, model.kHigh, lbs),
  ].filter(w => w != null);
  return {
    weeks,
    weeksLow:  vals.length ? Math.min(...vals) : null,
    weeksHigh: vals.length ? Math.max(...vals) : null,
  };
}

// ── Current-dose projection rate ──────────────────────────────────────────────
// The number the Weight Projector uses as its "current pace." Both
// app-kpis.js and rate-analysis.js used to fill this from a lifetime
// average with a hardcoded 19-lb / 4-week phase-1 fudge, which drifts
// further from reality every week (early fast losses keep dragging the
// average up long after those losses are ancient history) and pooled
// across dose changes to boot.
//
// The honest answer is: linear regression through the last `windowDays`
// of readings, restricted to the current dose window when we have shot
// data. Same math as the Slowdown Check card's "last 4 wks" number, so
// the two cards now tell the same story. Falls back to full history
// when TitrationUtils isn't loaded or shot data is missing, and to
// unrestricted last-N-days when the current dose window is too fresh
// (< 3 readings) to fit a line.
//
// Returns lbs/day (NEGATIVE = losing), matching the sign convention
// projSlopeLbsPerDay callers already expect. Null when there simply
// aren't enough readings to fit anything.
function computeCurrentDoseRate(data, windowDays = 28) {
  if (!data || data.length < 2) return null;

  let scoped = data;
  try {
    const shots = JSON.parse(localStorage.getItem('glp1_v4')) || [];
    const norm  = shots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);
    if (norm.length && window.TitrationUtils) {
      const start = window.TitrationUtils.currentDoseStart(norm);
      if (start) {
        const doseData = window.TitrationUtils.readingsSince(start, data);
        if (doseData.length >= 3) scoped = doseData;
      }
    }
  } catch (e) { /* keep full-history fallback */ }

  return regressionSlopeLbsPerDay(scoped, windowDays);
}

// ── Streak counter (consecutive calendar-day readings) ───────────────
function calcStreak(data) {
  if (!data.length) return 0;
  const days = [...new Set(data.map(r => r.date.toDateString()))].sort(
    (a, b) => new Date(b) - new Date(a)
  );
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = (new Date(days[i - 1]) - new Date(days[i])) / 86400000;
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

// ── Delta arrow HTML (▼ green if good, ▲ red if bad) ─────────────────
function delta(val, lowerIsBetter = true) {
  if (val == null) return '';
  const good  = lowerIsBetter ? val <= 0 : val >= 0;
  const arrow = val < 0 ? '▼' : val > 0 ? '▲' : '●';
  const cls   = good ? 'down' : 'up';
  return `<span class="${cls}">${arrow} ${fmt(Math.abs(val))}</span>`;
}

// ── DOM helpers ──────────────────────────────────────────────────────
const el      = id => document.getElementById(id);
const setText = (id, v) => { const e = el(id); if (e) { e.textContent = v; e.classList.remove('skel'); } };
const setHTML = (id, v) => { const e = el(id); if (e) { e.innerHTML   = v; e.classList.remove('skel'); } };

// Generic collapse toggle. Assumes a body div, a header button with
// aria-expanded, and a chevron span. All three are addressed by id
// so any section can opt in without needing its own function.
function toggleCollapsible(bodyId, toggleId, chevronId) {
  const body = el(bodyId), tog = el(toggleId), chev = el(chevronId);
  if (!body || !tog || !chev) return;
  const isOpen = tog.getAttribute('aria-expanded') === 'true';
  body.style.display = isOpen ? 'none' : '';
  tog.setAttribute('aria-expanded', String(!isOpen));
  chev.classList.toggle('closed', isOpen);
}

// ── Animated counter ─────────────────────────────────────────────────
function countUp(id, target, decimals = 1, suffix = '', duration = 900) {
  const e = el(id);
  const t = +target;
  if (!e || isNaN(t)) return;
  e.classList.remove('skel');                          // strip skeleton now
  // Set correct value immediately — never let raw float leak to screen
  e.textContent = t.toFixed(decimals) + suffix;
  const start    = performance.now();
  const startVal = parseFloat(e.textContent) || 0;
  function tick(now) {
    const pct    = Math.min((now - start) / duration, 1);
    const eased  = 1 - Math.pow(1 - pct, 3);
    const current = startVal + (t - startVal) * eased;
    e.textContent = current.toFixed(decimals) + suffix;
    if (pct < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Chart instance helpers ───────────────────────────────────────────
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// ── TDEE calculator (Katch-McArdle + activity multiplier) ────────────
// LBM from the scale's body fat % means it auto-corrects as weight drops.
// Falls back to the scale's own value if body fat data is missing.
function calcTDEE(latest) {
  const multiplier = ACTIVITY_LEVELS[activityLevel]?.multiplier ?? 1.55;
  if (latest.bodyFat && latest.weight) {
    const weightKg = latest.weight / 2.205;
    const lbmKg    = weightKg * (1 - latest.bodyFat / 100);
    const bmr      = 370 + 21.6 * lbmKg;
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * multiplier), source: 'katch' };
  }
  if (latest.tdee) return { bmr: latest.bmr ?? null, tdee: latest.tdee, source: 'scale' };
  return null;
}

// ── Misc ─────────────────────────────────────────────────────────────
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
function calAvg() { return null; } // stub — calorie logger removed
