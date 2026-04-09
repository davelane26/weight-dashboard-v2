/**
 * activity.js — Garmin / Health Connect data via Tasker → Cloudflare Worker
 * Fetches /health.json and renders the Activity tab.
 */

const HEALTH_URL    = window.GLUCOSE_WORKER_URL?.replace('/glucose.json', '/health.json')
                      ?? 'https://glucose-relay.djtwo6.workers.dev/health.json';
const REFRESH_MS    = 5 * 60 * 1000; // 5 min
const STEP_GOAL     = 10_000;

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

  // Steps hero
  const stepPct = STEP_GOAL > 0 ? Math.round((today.steps / STEP_GOAL) * 100) : 0;
  if (elA('act-steps')) elA('act-steps').textContent = fmtNum(today.steps);
  if (elA('act-steps-sub'))
    elA('act-steps-sub').textContent =
      `${stepPct}% of ${STEP_GOAL.toLocaleString()} goal · synced via Garmin · Health Connect`;

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
}

// ── Mini chart helper ─────────────────────────────────────────────────────
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

// ── Render 7-day charts ───────────────────────────────────────────────────
function renderCharts(days) {
  const recent = days.slice(-7);
  const labels = recent.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  });

  miniChart('actStepsChart', 'actStepsChartInst', labels,
    recent.map(d => d.steps),          '#0053e2', 'steps');
  miniChart('actSleepChart', 'actSleepChartInst', labels,
    recent.map(d => d.sleepHours),     '#7c3aed', 'hrs');
  miniChart('actHRChart',    'actHRChartInst',    labels,
    recent.map(d => d.restingHR),      '#ea1100', 'bpm');
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
