/**
 * reportcard.js — Monthly Health Report Card
 * Grades each month across weight loss, steps, and sleep.
 * Reads from window.allWeightData + window.snapActivityDays.
 * Rendered into #report-card-body in the Weight tab.
 */

// ── Grade scale ──────────────────────────────────────────────────────────────
const RC_GRADES = [
  { min: 90, grade: 'A+', bg: '#f0fdf4', color: '#2a8703', border: '#bbf7d0' },
  { min: 80, grade: 'A',  bg: '#f0fdf4', color: '#2a8703', border: '#bbf7d0' },
  { min: 70, grade: 'B',  bg: '#eff4ff', color: '#0053e2', border: '#bfdbfe' },
  { min: 55, grade: 'C',  bg: '#fef9ec', color: '#995213', border: '#fde68a' },
  { min: 40, grade: 'D',  bg: '#fff1f0', color: '#ea1100', border: '#fecaca' },
  { min: 0,  grade: 'F',  bg: '#fff1f0', color: '#7f1d1d', border: '#fecaca' },
];

function _grade(score) {
  return RC_GRADES.find(g => score >= g.min) || RC_GRADES[RC_GRADES.length - 1];
}

// ── Metric scorers (0–100) ────────────────────────────────────────────────────
function _scoreWeightRate(lbsPerWeek) {
  // Healthy target: 1–2 lbs/week; plateau = 0, gaining = negative
  if (lbsPerWeek == null) return null;
  if (lbsPerWeek >= 2.0) return 95;
  if (lbsPerWeek >= 1.5) return 85;
  if (lbsPerWeek >= 1.0) return 72;
  if (lbsPerWeek >= 0.5) return 55;
  if (lbsPerWeek >= 0.0) return 35;
  return 10; // gaining
}

function _scoreSteps(avgSteps) {
  if (avgSteps == null) return null;
  if (avgSteps >= 12000) return 100;
  if (avgSteps >= 10000) return 88;
  if (avgSteps >= 7500)  return 72;
  if (avgSteps >= 5000)  return 55;
  if (avgSteps >= 2500)  return 35;
  return 15;
}

function _scoreSleep(avgScore, avgHours) {
  // Prefer Garmin score, fall back to hours
  if (avgScore != null) {
    if (avgScore >= 85) return 100;
    if (avgScore >= 75) return 85;
    if (avgScore >= 65) return 70;
    if (avgScore >= 55) return 52;
    return 30;
  }
  if (avgHours != null) {
    if (avgHours >= 8)  return 95;
    if (avgHours >= 7)  return 80;
    if (avgHours >= 6)  return 60;
    if (avgHours >= 5)  return 38;
    return 18;
  }
  return null;
}

// ── Monthly data aggregator ──────────────────────────────────────────────────
function _buildMonthly(weightData, actDays) {
  const months = {};

  // Weight readings → keyed by YYYY-MM
  (weightData || []).forEach(r => {
    const key = r.date.toLocaleDateString('en-CA').slice(0, 7);
    if (!months[key]) months[key] = { weights: [], steps: [], sleepScores: [], sleepHours: [] };
    months[key].weights.push({ date: r.date, w: r.weight });
  });

  // Activity days → steps + sleep (last 30 days available)
  (actDays || []).forEach(d => {
    const raw = d.date || d.lastUpdated || d.updatedAt || '';
    const key = raw.slice(0, 7);
    if (!key || !months[key]) return;
    if (d.steps)      months[key].steps.push(d.steps);
    if (d.sleepScore) months[key].sleepScores.push(d.sleepScore);
    if (d.sleepHours) months[key].sleepHours.push(d.sleepHours);
  });

  return months;
}

function _avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Row HTML ─────────────────────────────────────────────────────────────────
function _gradeChip(scoreOrNull, label) {
  if (scoreOrNull == null) return `<div class="rc-cell rc-na">N/A</div>`;
  const g = _grade(scoreOrNull);
  return `<div class="rc-cell" style="background:${g.bg};color:${g.color};border-color:${g.border}" title="${label}">
    ${g.grade}
  </div>`;
}

function _monthRow(key, data) {
  const d      = new Date(key + '-15');
  const label  = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  const wts    = data.weights.sort((a, b) => a.date - b.date);
  let wtRate   = null;
  if (wts.length >= 2) {
    const lost  = wts[0].w - wts[wts.length - 1].w;
    const weeks = (wts[wts.length - 1].date - wts[0].date) / (7 * 86400000) || 1;
    wtRate = +(lost / weeks).toFixed(2);
  }

  const avgSteps    = _avg(data.steps);
  const avgSleepSc  = _avg(data.sleepScores);
  const avgSleepH   = _avg(data.sleepHours);

  const wtScore    = _scoreWeightRate(wtRate);
  const stepsScore = _scoreSteps(avgSteps);
  const sleepScore = _scoreSleep(avgSleepSc, avgSleepH);

  const scores     = [wtScore, stepsScore, sleepScore].filter(s => s != null);
  const overall    = scores.length ? Math.round(_avg(scores)) : null;
  const ov         = overall != null ? _grade(overall) : null;

  const fmtRate = wtRate != null
    ? `${wtRate >= 0 ? '−' : '+'}${Math.abs(wtRate).toFixed(1)} lbs/wk`
    : 'N/A';
  const fmtSteps = avgSteps != null ? Math.round(avgSteps).toLocaleString() + ' avg' : 'N/A';
  const fmtSleep = avgSleepSc != null ? Math.round(avgSleepSc) + ' pts'
                 : avgSleepH  != null ? avgSleepH.toFixed(1) + 'h avg' : 'N/A';

  return `
    <div class="rc-row" role="row">
      <div class="rc-month">${label}</div>
      ${ov ? `<div class="rc-cell rc-overall" style="background:${ov.bg};color:${ov.color};border-color:${ov.border}">${ov.grade}</div>` : '<div class="rc-cell rc-na">—</div>'}
      ${_gradeChip(wtScore,    'Weight: ' + fmtRate)}
      ${_gradeChip(stepsScore, 'Steps: '  + fmtSteps)}
      ${_gradeChip(sleepScore, 'Sleep: '  + fmtSleep)}
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderReportCard() {
  const body  = document.getElementById('report-card-body');
  const empty = document.getElementById('report-card-empty');
  if (!body) return;

  const weightData = window.allWeightData || [];
  const actDays    = window.snapActivityDays || [];

  if (weightData.length < 7) {
    if (empty) empty.style.display = '';
    body.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  const months = _buildMonthly(weightData, actDays);

  // Sort months newest-first, keep last 6
  const keys = Object.keys(months)
    .filter(k => months[k].weights.length >= 3)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 6);

  if (!keys.length) {
    if (empty) empty.style.display = '';
    return;
  }

  body.innerHTML = `
    <div class="rc-header" role="row">
      <div class="rc-month" style="font-weight:700;color:#6d7a95;font-size:0.65rem">MONTH</div>
      <div class="rc-cell-hdr">OVERALL</div>
      <div class="rc-cell-hdr">⚖️ WEIGHT</div>
      <div class="rc-cell-hdr">👟 STEPS</div>
      <div class="rc-cell-hdr">💤 SLEEP</div>
    </div>
    ${keys.map(k => _monthRow(k, months[k])).join('')}`;
}

window.renderReportCard = renderReportCard;
