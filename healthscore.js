/**
 * healthscore.js — Daily Health Score (0–100)
 * Combines steps, sleep, and glucose TIR into a single composite score.
 * Rendered as an SVG ring in #health-score-card inside the Activity tab.
 * Call refreshHealthScore() after any data module updates its globals.
 */

const SCORE_KEY      = 'hs_last_score';
const SCORE_DATE_KEY = 'hs_last_date';

// ── Grade + colour thresholds ────────────────────────────────────────────────
const GRADE_BANDS = [
  { min: 90, grade: 'A+', color: '#2a8703' },
  { min: 80, grade: 'A',  color: '#2a8703' },
  { min: 70, grade: 'B',  color: '#0053e2' },
  { min: 60, grade: 'C',  color: '#995213' },
  { min: 45, grade: 'D',  color: '#ea1100' },
  { min: 0,  grade: 'F',  color: '#7f1d1d' },
];

function _gradeInfo(score) {
  return GRADE_BANDS.find(b => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];
}

// ── Score calculation ────────────────────────────────────────────────────────
function calcHealthScore() {
  const act  = window.snapActivityNow || {};
  const tir  = window.snapGlucoseTIR; // null if glucose not loaded

  // Steps component  — 10k steps = full marks
  const stepsRaw = Math.min((act.steps || 0) / 10000, 1) * 100;

  // Sleep component — prefer Garmin score, fall back to hours
  let sleepRaw = null;
  if (act.sleepScore != null) {
    sleepRaw = Math.min(act.sleepScore / 85, 1) * 100;
  } else if (act.sleepHours) {
    const h = act.sleepHours;
    sleepRaw = h >= 8 ? 100 : h >= 7 ? 88 : h >= 6 ? 65 : h >= 5 ? 40 : 20;
  }

  // Glucose TIR component — 90% TIR = full marks
  const glucoseRaw = tir != null ? Math.min(tir / 90, 1) * 100 : null;

  // Weighted pool — drop components with no data and rescale
  const pool = [
    { val: stepsRaw,  w: 30 },
    { val: sleepRaw,  w: 35 },
    { val: glucoseRaw,w: 35 },
  ].filter(c => c.val != null);

  if (!pool.length) return null;

  const totalW = pool.reduce((s, c) => s + c.w, 0);
  const raw    = pool.reduce((s, c) => s + (c.val / 100) * c.w, 0) / totalW * 100;
  return Math.round(raw);
}

// ── SVG ring renderer ────────────────────────────────────────────────────────
function _buildRingSVG(score, info) {
  const CIRC = 2 * Math.PI * 40; // r=40 → 251.3
  const dash = (score / 100) * CIRC;
  return `
    <svg viewBox="0 0 100 100" width="110" height="110" aria-label="Health score ${score}">
      <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" stroke-width="9"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="${info.color}" stroke-width="9"
        stroke-dasharray="${dash.toFixed(1)} ${CIRC.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 50 50)"
        style="transition:stroke-dasharray 0.7s ease"/>
      <text x="50" y="45" text-anchor="middle" font-size="22" font-weight="900"
        font-family="Inter,system-ui,sans-serif" fill="${info.color}">${score}</text>
      <text x="50" y="62" text-anchor="middle" font-size="13" font-weight="700"
        font-family="Inter,system-ui,sans-serif" fill="${info.color}">${info.grade}</text>
    </svg>`;
}

function _componentRow(icon, label, val, max, color) {
  const pct = val != null ? Math.round(Math.min(val / max, 1) * 100) : null;
  const barW = pct ?? 0;
  return `
    <div style="margin-bottom:0.55rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-size:0.72rem;font-weight:600;color:#6d7a95">${icon} ${label}</span>
        <span style="font-size:0.72rem;font-weight:700;color:${color}">${val != null ? val : '—'}</span>
      </div>
      <div style="height:5px;background:#e5e7eb;border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${barW}%;background:${color};border-radius:99px;transition:width 0.6s ease"></div>
      </div>
    </div>`;
}

// ── Main render ──────────────────────────────────────────────────────────────
function refreshHealthScore() {
  const card = document.getElementById('health-score-card');
  if (!card) return;

  const score = calcHealthScore();
  const act   = window.snapActivityNow || {};
  const tir   = window.snapGlucoseTIR;

  if (score == null) {
    card.innerHTML = '<p style="font-size:0.8rem;color:#6d7a95;text-align:center;padding:1rem">Loading health data…</p>';
    return;
  }

  const info     = _gradeInfo(score);
  const today    = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const stepsDisp = act.steps ? act.steps.toLocaleString() : null;
  const sleepDisp = act.sleepScore != null ? act.sleepScore + ' pts'
                  : act.sleepHours  ? act.sleepHours.toFixed(1) + 'h'
                  : null;
  const tirDisp  = tir != null ? tir + '%' : null;

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap">
      <div style="flex-shrink:0">${_buildRingSVG(score, info)}</div>
      <div style="flex:1;min-width:180px">
        <p style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.15rem">${today}</p>
        <p style="font-size:1rem;font-weight:800;color:${info.color};margin-bottom:0.75rem">
          ${score >= 90 ? '🏆 Outstanding day!' : score >= 70 ? '💪 Solid day!' : score >= 55 ? '👍 Getting there' : '😴 Room to improve'}
        </p>
        ${_componentRow('👟', 'Steps', stepsDisp, '10,000', '#0053e2')}
        ${_componentRow('💤', 'Sleep', sleepDisp, act.sleepScore ? '85 pts' : '8h', '#7c3aed')}
        ${_componentRow('🩸', 'Glucose TIR', tirDisp, '90%', '#2a8703')}
      </div>
    </div>`;

  // Persist for weekly summary to read
  localStorage.setItem(SCORE_KEY, score);
  localStorage.setItem(SCORE_DATE_KEY, new Date().toLocaleDateString('en-CA'));
}

window.refreshHealthScore = refreshHealthScore;
window.calcHealthScore    = calcHealthScore;
