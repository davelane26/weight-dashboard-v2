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
function weightTrendSlope(data, days = 30) {
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  const recent = daily.slice(-days);
  if (recent.length < 3) return null;
  const origin = recent[0].date.getTime();
  const pts    = recent.map(r => ({ x: (r.date.getTime() - origin) / 86400000, y: r.weight }));
  const n      = pts.length;
  const sx     = pts.reduce((s, p) => s + p.x, 0);
  const sy     = pts.reduce((s, p) => s + p.y, 0);
  const sxy    = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2    = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom  = n * sx2 - sx * sx;
  return denom === 0 ? null : (n * sxy - sx * sy) / denom; // lbs per day
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
