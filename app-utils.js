/* ════════════════════════════════════════════════════════════════════
   app-utils.js — pure helpers: formatters, date parsing, math, DOM
   No DOM event wiring. No render functions. Just utilities.
   ──────────────────────────────────────────────────────────────────── */

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
function regressionSlopeLbsPerDay(data, calendarDays = 28) {
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  if (!daily.length) return null;
  const cutoff = daily[daily.length - 1].date.getTime() - calendarDays * 86_400_000;
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
  const latestMs = sorted[sorted.length - 1].date.getTime();
  const cutoff   = latestMs - windowDays * 86_400_000;
  const priorData = sorted.filter(r => r.date.getTime() < cutoff);

  // regressionSlopeLbsPerDay anchors its window on the last reading of
  // whatever it's given, so passing only pre-cutoff readings yields the
  // prior window's slope with identical math to the current one.
  const currentSlope = regressionSlopeLbsPerDay(sorted, windowDays);
  const priorSlope   = regressionSlopeLbsPerDay(priorData, windowDays);
  if (currentSlope == null || priorSlope == null) return null;

  const currentRate = -currentSlope * 7;
  const priorRate   = -priorSlope * 7;
  const slowdownPct = priorRate > 0.1
    ? ((priorRate - currentRate) / priorRate) * 100
    : null;
  return { currentRate, priorRate, slowdownPct, windowDays };
}

// ── Slowdown-adjusted projection model ───────────────────────────────
// Extrapolates the observed deceleration: the weekly rate starts at the
// current 4-wk regression rate and keeps easing by the same amount it
// eased between the two windows. Units are lbs/WEEK; decel > 0 = slowing
// by that many lbs/wk each week. When the pace is steady or speeding up
// we do NOT extrapolate the acceleration — we project linearly at the
// current rate (the conservative choice).
function slowdownModel(sd) {
  if (!sd || sd.currentRate == null || sd.priorRate == null) return null;
  const r0    = sd.currentRate;
  const decel = (sd.priorRate - sd.currentRate) / (sd.windowDays / 7);
  return { r0, decel };
}

// Projected lbs lost after `weeks` under the decelerating model.
// Once the extrapolated rate reaches zero the curve flattens — we never
// project regain out of a decaying loss rate.
function slowdownLossAt(model, weeks) {
  const { r0, decel } = model;
  if (r0 <= 0 || weeks <= 0) return 0;
  if (decel <= 0) return r0 * weeks;
  const w = Math.min(weeks, r0 / decel);
  return r0 * w - (decel / 2) * w * w;
}

// Weeks needed to lose `lbs` under the model, or null if the pace is
// projected to stall before getting there.
function slowdownWeeksToLose(model, lbs) {
  const { r0, decel } = model;
  if (r0 <= 0 || lbs <= 0) return lbs <= 0 ? 0 : null;
  if (decel <= 0) return lbs / r0;
  const disc = r0 * r0 - 2 * decel * lbs;
  if (disc < 0) return null;
  return (r0 - Math.sqrt(disc)) / decel;
}

// Where the extrapolated pace hits zero: { weeks, loss } of additional
// loss remaining before the stall, or null when there's no deceleration.
function slowdownPlateau(model) {
  const { r0, decel } = model;
  if (r0 <= 0 || decel <= 0) return null;
  return { weeks: r0 / decel, loss: (r0 * r0) / (2 * decel) };
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
