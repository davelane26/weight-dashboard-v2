/**
 * activity.js — Garmin / Health Connect data via Tasker → Cloudflare Worker
 * Fetches /health.json and renders the Activity tab.
 */

const HEALTH_URL    = window.GLUCOSE_WORKER_URL?.replace('/glucose.json', '/health.json')
                      ?? 'https://glucose-relay.djtwo6.workers.dev/health.json';
const REFRESH_MS    = 5 * 60 * 1000; // 5 min
const STEP_GOAL     = 10_000;
const STEPS_PER_MILE = 2000; // ~2k steps/mile; Garmin uses stride-based but this is a solid default

const elA = id => document.getElementById(id);

// ── Formatters ────────────────────────────────────────────────────────────
const fmtNum  = n  => n != null && n > 0 ? Math.round(n).toLocaleString() : '—';
const fmtDec  = n  => n != null && n > 0 ? (+n).toFixed(1) : '—';

// ── Stress label ──────────────────────────────────────────────────────────
function stressLabel(level) {
  if (!level || level <= 0) return '';
  if (level < 26)  return 'Resting';
  if (level < 51)  return 'Low';
  if (level < 76)  return 'Medium';
  return 'High';
}

// ── HR zone label ─────────────────────────────────────────────────────────
function hrLabel(bpm) {
  if (!bpm || bpm <= 0) return '';
  if (bpm < 60) return 'Athlete range';
  if (bpm < 70) return 'Excellent';
  if (bpm < 80) return 'Good';
  if (bpm < 90) return 'Average';
  return 'Above avg';
}

// ── Render today's hero + KPIs ────────────────────────────────────────────
function renderToday(today) {
  const setup = elA('act-setup');

  if (!today) {
    if (setup) setup.style.display = '';
    return;
  }
  if (setup) setup.style.display = 'none';

  // Steps hero — Bug 2 fix: calculate and display miles from step count
  const stepPct = STEP_GOAL > 0 ? Math.round((today.steps / STEP_GOAL) * 100) : 0;
  const stepMiles = today.steps > 0 ? (today.steps / STEPS_PER_MILE).toFixed(2) : '0.00';
  if (elA('act-steps')) elA('act-steps').textContent = fmtNum(today.steps);
  if (elA('act-steps-sub'))
    elA('act-steps-sub').textContent =
      `${stepMiles} mi · ${stepPct}% of ${STEP_GOAL.toLocaleString()} goal`;

  // Active cals
  if (elA('act-cal')) elA('act-cal').textContent = fmtNum(today.activeCalories);

  // Sleep
  if (elA('act-sleep')) elA('act-sleep').textContent = fmtDec(today.sleepHours);
  if (elA('act-sleep-score') && today.sleepScore > 0)
    elA('act-sleep-score').textContent = `Score: ${today.sleepScore}`;

  // Resting HR
  if (elA('act-hr'))     elA('act-hr').textContent     = fmtNum(today.restingHR);
  if (elA('act-hr-sub')) elA('act-hr-sub').textContent = hrLabel(today.restingHR);

  // Floors
  if (elA('act-floors')) elA('act-floors').textContent = fmtNum(today.floorsClimbed);

  // Stress
  if (elA('act-stress'))     elA('act-stress').textContent     = fmtNum(today.stressLevel);
  if (elA('act-stress-sub')) elA('act-stress-sub').textContent = stressLabel(today.stressLevel);

  // Updated
  if (elA('act-updated') && today.updatedAt) {
    const d = new Date(today.updatedAt);
    elA('act-updated').textContent =
      `Synced ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  // VO2 Max — Bug 3 fix: render with a meaningful fallback when data is absent
  const vo2El  = elA('act-vo2');
  const vo2Sub = elA('act-vo2-sub');
  if (vo2El) {
    if (today.vo2Max && today.vo2Max > 0) {
      vo2El.textContent = (+today.vo2Max).toFixed(1);
      if (vo2Sub) vo2Sub.textContent = 'mL/kg/min';
    } else {
      vo2El.textContent = '—';
      if (vo2Sub) vo2Sub.textContent = 'Needs outdoor GPS activity';
    }
  }
}

// ── Empty state helper — Bug 4 fix ───────────────────────────────────────
// Shows a friendly message in place of an empty chart so users aren't
// staring at a blank canvas wondering if something is broken.
function showEmptyState(canvasId, storeKey, message = 'No data yet for this period') {
  // Destroy any existing chart instance first
  if (window[storeKey]) { window[storeKey].destroy(); window[storeKey] = null; }
  const canvas = elA(canvasId);
  if (!canvas) return;
  // Clear the canvas and write the message directly
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#6d7a95';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

const hasRealData = values => values.some(v => v != null && v > 0);

// ── Mini chart helper ─────────────────────────────────────────────────
function miniChart(canvasId, storeKey, labels, values, color, unit) {
  const canvas = elA(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (window[storeKey]) { window[storeKey].destroy(); }

  window[storeKey] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data:            values,
        backgroundColor: color + '99',
        borderColor:     color,
        borderWidth:     1.5,
        borderRadius:    4,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => `${ctx.parsed.y.toLocaleString()} ${unit}` },
      }},
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Render 7-day charts — Bug 4 fix: check for real data before drawing ──
function renderCharts(days) {
  const recent = days.slice(-7);
  const labels = recent.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  });

  const stepsVals = recent.map(d => d.steps);
  const sleepVals = recent.map(d => d.sleepHours);
  const hrVals    = recent.map(d => d.restingHR);

  if (hasRealData(stepsVals)) {
    miniChart('actStepsChart', 'actStepsChartInst', labels, stepsVals, '#0053e2', 'steps');
  } else {
    showEmptyState('actStepsChart', 'actStepsChartInst', 'No step data yet — keep moving! 🚶');
  }

  if (hasRealData(sleepVals)) {
    miniChart('actSleepChart', 'actSleepChartInst', labels, sleepVals, '#7c3aed', 'hrs');
  } else {
    showEmptyState('actSleepChart', 'actSleepChartInst', 'No sleep data yet');
  }

  if (hasRealData(hrVals)) {
    miniChart('actHRChart', 'actHRChartInst', labels, hrVals, '#ea1100', 'bpm');
  } else {
    showEmptyState('actHRChart', 'actHRChartInst', 'No heart rate data yet');
  }
}

// ── Fetch + render ────────────────────────────────────────────────────────
async function refreshActivity() {
  try {
    const resp = await fetch(HEALTH_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    if (!data.days || !data.days.length) return; // no data yet — keep setup prompt

    const today = data.days[data.days.length - 1];
    renderToday(today);
    renderCharts(data.days);
  } catch (e) {
    console.warn('[activity] fetch error:', e.message);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
refreshActivity();
setInterval(refreshActivity, REFRESH_MS);
