// ── activity.js ── Garmin Connect data display (overhauled) ────────────
// Reads from Firebase /garmin/latest.json + /garmin/{date}.json
// ───────────────────────────────────────────────────────────────────

const FIREBASE_GARMIN_URL = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';

// Chart instances for cleanup
let actStepsChartInst = null;
let actSleepChartInst = null;
let actHRChartInst    = null;

window.actStepsChartInst  = null;
window.actSleepChartInst  = null;
window.actHRChartInst     = null;

// ── Helpers ──────────────────────────────────────────────────────────
const _el = id => document.getElementById(id);
const _set = (id, v) => { const e = _el(id); if (e) e.textContent = v ?? '—'; };
const _html = (id, v) => { const e = _el(id); if (e) e.innerHTML = v; };
const _fmtK = n => n != null ? Math.round(n).toLocaleString() : '—';

// Bug 4 helpers: detect ghost data + render a friendly empty state on canvas
const _allZero = arr => arr.every(v => !v || v === 0);
function _emptyChart(inst, canvas, msg = 'No data yet for this period') {
  if (inst) { inst.destroy(); }
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.font = '13px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#6d7a95';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, canvas.width / 2, Math.max(canvas.height / 2, 30));
  ctx.restore();
  return null;
}

function _stressLabel(level) {
  if (!level) return '';
  if (level <= 25) return '🟢 Resting';
  if (level <= 50) return '🟡 Low';
  if (level <= 75) return '🟠 Medium';
  return '🔴 High';
}

function _sleepQuality(score) {
  if (!score) return '';
  if (score >= 80) return '🟢 Excellent';
  if (score >= 60) return '🟡 Good';
  if (score >= 40) return '🟠 Fair';
  return '🔴 Poor';
}

// Estimate sleep score using stage data when available, duration-only fallback
// Factors: duration (35), efficiency (25), deep % (20), REM % (20), awakenings penalty (-15)
function _calcSleepScore(data) {
  const hours = (typeof data === 'number') ? data : (data.sleepHours || 0);
  if (!hours) return null;

  const totalMins    = hours * 60;
  const deepMins     = ((typeof data === 'object' && data.sleepDeep)  || 0) * 60;
  const remMins      = ((typeof data === 'object' && data.sleepRem)   || 0) * 60;
  const tibMins      = ((typeof data === 'object' && data.timeInBed)  || 0) * 60 || totalMins * 1.05;
  const awakenings   =  (typeof data === 'object' && data.sleepAwakenings) || 0;
  const hasStages    = deepMins > 0 || remMins > 0;

  // Duration (0–35)
  let dur;
  if      (hours < 5)  dur = Math.round(10 + hours * 2);
  else if (hours <= 6) dur = Math.round(20 + (hours - 5) * 8);
  else if (hours <= 7) dur = Math.round(28 + (hours - 6) * 7);
  else if (hours <= 9) dur = 35;
  else                 dur = Math.max(20, Math.round(35 - (hours - 9) * 5));

  // Efficiency (0–25)
  const eff = Math.min(100, (totalMins / tibMins) * 100);
  const effScore = eff >= 90 ? 25 : eff >= 85 ? 20 : eff >= 80 ? 15 : eff >= 75 ? 10 : 5;

  // Deep sleep % (0–20) — neutral if no stage data
  const deepPct  = totalMins > 0 ? (deepMins / totalMins) * 100 : 0;
  const deepScore = !hasStages ? 10
    : deepPct >= 20 ? 20 : deepPct >= 15 ? 16 : deepPct >= 10 ? 12 : deepPct >= 5 ? 8 : 4;

  // REM % (0–20) — neutral if no stage data
  const remPct   = totalMins > 0 ? (remMins / totalMins) * 100 : 0;
  const remScore  = !hasStages ? 10
    : remPct >= 22 ? 20 : remPct >= 18 ? 16 : remPct >= 14 ? 12 : remPct >= 10 ? 8 : 4;

  // Awakenings penalty (0 to −15)
  const awakePenalty = awakenings > 20 ? -15 : awakenings > 15 ? -10
    : awakenings > 10 ? -6 : awakenings > 5 ? -3 : 0;

  return Math.min(100, Math.max(0, dur + effScore + deepScore + remScore + awakePenalty));
}

function _destroyChart(inst) {
  if (inst) inst.destroy();
  return null;
}

// ── Load today's data ───────────────────────────────────────────────
// Tries Cloudflare Worker /health.json first, falls back to Firebase
async function loadActivityData() {
  let data    = null;
  let allDays = [];   // full 30-day history for charts
  let source  = '';

  // 1. Try Cloudflare Worker (fed by Exist.io via GitHub Actions)
  try {
    const workerBase = (window.GLUCOSE_WORKER_URL || '').replace('/glucose.json', '');
    if (workerBase) {
      const res  = await fetch(`${workerBase}/health.json`);
      const json = await res.json();
      if (json?.days?.length) {
        allDays = json.days;
        data    = allDays[allDays.length - 1];
        source  = 'Exist.io via Cloudflare';
      }
    }
  } catch (e) {
    console.warn('Worker health.json failed, trying Firebase...', e);
  }

  // 2. Fall back to Firebase (legacy)
  if (!data) {
    try {
      const res = await fetch(`${FIREBASE_GARMIN_URL}/garmin/latest.json`);
      data    = await res.json();
      allDays = [data];
      source  = 'Garmin via Firebase';
    } catch (e) {
      console.error('Both data sources failed:', e);
      return;
    }
  }

  if (!data) return;

  renderActivityKPIs(data);
  renderSleepBreakdown(data);
  renderActivities(data.activities);
  loadActivityCharts(allDays);

  // Hide setup prompt
  const setup = _el('act-setup');
  if (setup) setup.style.display = 'none';

  // Show last updated
  const ts = data.lastUpdated || data.updatedAt;
  if (ts) {
    const d = new Date(ts);
    _set('act-updated', `Synced via ${source} · ${d.toLocaleString()}`);
  } else if (data.date) {
    _set('act-updated', `Data for ${data.date} · via ${source}`);
  }
}

// ── KPI Cards ──────────────────────────────────────────────────────
function renderActivityKPIs(data) {
  // Steps hero — Bug 2 fix: fall back to step-based distance when Garmin
  // doesn't include a distance field (avoids the "0 mi" display bug)
  const STEPS_PER_MILE = 2000;
  const stepGoal = 10000;
  const stepPct = Math.min(100, ((data.steps || 0) / stepGoal) * 100);
  const distMi = data.distance
    ? (+data.distance).toFixed(2)
    : (data.steps ? (data.steps / STEPS_PER_MILE).toFixed(2) : '0.00');
  _set('act-steps', _fmtK(data.steps));
  _set('act-steps-sub',
    `${distMi} mi · ${Math.round(stepPct)}% of ${_fmtK(stepGoal)} goal`);

  // Sleep — format decimal hours as "Xh Ym"
  const rawSleepH = data.sleepHours || 0;
  const sleepDisplay = rawSleepH
    ? (() => { const h = Math.floor(rawSleepH); const m = Math.round((rawSleepH - h) * 60); return m > 0 ? `${h}h ${m}m` : `${h}h`; })()
    : '—';
  _set('act-sleep', sleepDisplay);

  // Sleep score — only show if we have Garmin's actual score, not our estimate
  const score    = data.sleepScore ?? null;
  const hasScore = score !== null && score !== undefined;
  const scoreColor = !hasScore ? '#6d7a95'
    : score >= 85 ? '#2a8703'
    : score >= 70 ? '#0053e2'
    : score >= 50 ? '#995213'
    : '#ea1100';
  const scoreLabel = !hasScore ? 'not in sync data'
    : score >= 85 ? 'Excellent'
    : score >= 70 ? 'Good'
    : score >= 50 ? 'Fair'
    : 'Poor';
  if (_el('act-sleep-score-val')) {
    _el('act-sleep-score-val').textContent   = hasScore ? score : '—';
    _el('act-sleep-score-val').style.color   = scoreColor;
    _el('act-sleep-score-label').textContent = scoreLabel;
  }

  // ❤️ Resting HR
  _set('act-hr', data.restingHR || '—');
  _set('act-hr-sub', data.minHR && data.maxHR ? `${data.minHR}–${data.maxHR} bpm range` : '');

  // 💪 Intensity minutes
  _set('act-intensity', data.intensityMinutes || '—');

  // 🧠 Stress
  const stress = data.stressLevel || null;
  _set('act-stress', stress || '—');
  _set('act-stress-sub', stress
    ? (stress <= 25 ? '🟢 Resting' : stress <= 50 ? '🟡 Low' : stress <= 75 ? '🟠 Medium' : '🔴 High')
    : '');

  // 🔋 Body Battery
  _set('act-battery', data.bodyBattery ?? '—');

  // 🏃 Fitness Age
  _set('act-fitness-age', data.fitnessAge ?? '—');
  _set('act-fitness-age-sub', data.fitnessAge ? `Actual age: 44` : '');

  // 🔥 Calories
  _set('act-total-cal', data.totalCalories ? _fmtK(data.totalCalories) : '—');
  _set('act-cal-breakdown', data.activeCalories ? `${_fmtK(data.activeCalories)} active` : '');

  window.snapActivityNow = { steps: data.steps || 0, sleepHours: data.sleepHours || 0, sleepScore: data.sleepScore ?? null };
  if (typeof updateSnapshot === 'function') updateSnapshot();
}

// ── Sleep Breakdown ─────────────────────────────────────────────────────
function renderSleepBreakdown(data) {
  const container = _el('sleep-breakdown');
  const visual    = _el('sleep-stage-visual');
  if (!container || !visual) return;

  const stages = [
    { label: 'Deep',  val: data.sleepDeep  || data.sleepStages?.deep  || 0, color: '#1e3a5f' },
    { label: 'Light', val: data.sleepLight || data.sleepStages?.light || 0, color: '#4a90d9' },
    { label: 'REM',   val: data.sleepRem   || data.sleepStages?.rem   || 0, color: '#7c3aed' },
  ];
  const total = stages.reduce((s, st) => s + st.val, 0);

  container.style.display = 'block';

  if (total <= 0) {
    visual.innerHTML = '<span style="color:#6d7a95;font-size:0.72rem">'
      + 'Sleep stage breakdown not available — Garmin does not share deep/REM/light data via Health Connect.</span>';
    return;
  }

  const pct = v => Math.round((v / total) * 100);

  // Bar row
  const barSegs = stages.map(st => {
    const p = pct(st.val);
    return `<div style="flex:${p};background:${st.color};height:100%;border-radius:4px;min-width:4px"
      title="${st.label}: ${st.val.toFixed(1)}h (${p}%)"></div>`;
  }).join('');

  // Label row — same flex ratios so labels sit under their segment
  const labelSegs = stages.map(st => {
    const p = pct(st.val);
    return `<div style="flex:${p};min-width:4px;display:flex;flex-direction:column;align-items:center;gap:1px">
      <span style="font-size:0.85rem;font-weight:700;color:${st.color}">${st.label}</span>
      <span style="font-size:0.75rem;color:#6d7a95">${st.val.toFixed(1)}h &middot; ${p}%</span>
    </div>`;
  }).join('');

  visual.innerHTML =
    `<div style="display:flex;height:24px;gap:3px;border-radius:6px;overflow:hidden;margin-bottom:6px">${barSegs}</div>` +
    `<div style="display:flex;gap:3px">${labelSegs}</div>`;
}

// ── HRV Section ──────────────────────────────────────────────────────
function renderHRVSection(data, allDays = []) {
  const section = _el('hrv-section');
  if (!section) return;

  // Support both flat `hrv` (from Exist.io) and legacy nested fields
  const hrv = data.hrv || data.hrvLastNight || null;
  if (!hrv) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  // Weekly avg from history
  const recent = allDays.slice(-7).map(d => d.hrv || d.hrvLastNight || 0).filter(Boolean);
  const weeklyAvg = recent.length
    ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
    : null;

  _set('hrv-last-night', hrv + ' ms');
  _set('hrv-weekly-avg', weeklyAvg ? weeklyAvg + ' ms' : '—');
  _set('hrv-status', hrv >= 50 ? '🟢 Good' : hrv >= 35 ? '🟡 Moderate' : '🔴 Low');
  _set('hrv-baseline', '');
}

// ── Activities List ─────────────────────────────────────────────────
function renderActivities(activities) {
  const container = _el('act-list');
  if (!container) return;

  if (!activities || !activities.length) {
    container.innerHTML = '<p style="color:#6d7a95;font-size:0.8rem">No activities recorded today</p>';
    return;
  }

  const typeIcons = {
    running: '🏃', walking: '🚶', cycling: '🚴', swimming: '🏊',
    strength_training: '🏋️', yoga: '🧘', hiking: '⛰️',
    elliptical: '🧍', other: '🏅',
  };

  container.innerHTML = activities.map(act => {
    const icon = typeIcons[act.type] || typeIcons.other;
    const details = [];
    if (act.duration) details.push(`${Math.round(act.duration)} min`);
    if (act.distance) details.push(`${act.distance} mi`);
    if (act.calories) details.push(`${act.calories} cal`);
    if (act.avgHR) details.push(`❤️ ${act.avgHR} bpm`);
    if (act.avgPace) details.push(`⏱ ${act.avgPace}/mi`);
    if (act.elevationGain) details.push(`⬆️ ${Math.round(act.elevationGain)} ft`);

    return `<div class="activity-card">
      <div class="activity-icon">${icon}</div>
      <div class="activity-info">
        <div class="activity-name">${act.name}</div>
        <div class="activity-details">${details.join(' · ')}</div>
        ${act.startTime ? `<div class="activity-time">${new Date(act.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── History Charts (30-day) ───────────────────────────────────────────────
// history = array of day entries from the Worker (already sorted oldest→newest)
function loadActivityCharts(history = []) {
  // Use last 30 days, show MM/DD labels
  const recent = history.slice(-30);
  const labels = recent.map(h => {
    const d = new Date(h.date + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  });

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#6d7a95', font: { size: 9 }, maxTicksLimit: 10 } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#6d7a95', font: { size: 10 } } },
    },
  };

  // Steps chart — Bug 4 fix: show empty state instead of ghost zero bars
  const stepsCanvas = _el('actStepsChart');
  const stepsData = recent.map(h => h.steps || 0);
  if (stepsCanvas) {
    if (_allZero(stepsData)) {
      actStepsChartInst = _emptyChart(actStepsChartInst, stepsCanvas, 'No step data yet — keep moving! 🚶');
      window.actStepsChartInst = null;
    } else {
      actStepsChartInst = _destroyChart(actStepsChartInst);
      actStepsChartInst = new Chart(stepsCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: stepsData,
            backgroundColor: stepsData.map(s => s >= 10000
              ? 'rgba(42,135,3,0.7)' : 'rgba(42,135,3,0.35)'),
            borderColor: '#2a8703',
            borderWidth: 1,
            borderRadius: 6,
          }],
        },
        options: {
          ...chartDefaults,
          scales: {
            ...chartDefaults.scales,
            y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: v => _fmtK(v) } },
          },
        },
      });
      window.actStepsChartInst = actStepsChartInst;
    }
  }

  // Sleep chart (stacked bar) — Bug 4 fix: check for real data first
  const sleepCanvas = _el('actSleepChart');
  const sleepDeep  = recent.map(h => h.sleepDeep  || 0);
  const sleepLight = recent.map(h => h.sleepLight || 0);
  const sleepREM   = recent.map(h => h.sleepRem   || 0);
  if (sleepCanvas) {
    if ([sleepDeep, sleepLight, sleepREM].every(_allZero)) {
      actSleepChartInst = _emptyChart(actSleepChartInst, sleepCanvas, 'No sleep stage data yet');
      window.actSleepChartInst = null;
    } else {
      actSleepChartInst = _destroyChart(actSleepChartInst);
      actSleepChartInst = new Chart(sleepCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Deep',  data: sleepDeep,  backgroundColor: '#1e3a5f', borderRadius: 3 },
            { label: 'Light', data: sleepLight, backgroundColor: '#4a90d9', borderRadius: 3 },
            { label: 'REM',   data: sleepREM,   backgroundColor: '#7c3aed', borderRadius: 3 },
          ],
        },
        options: {
          ...chartDefaults,
          plugins: {
            legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(1)}h` } },
          },
          scales: {
            ...chartDefaults.scales,
            x: { ...chartDefaults.scales.x, stacked: true },
            y: { ...chartDefaults.scales.y, stacked: true, ticks: { ...chartDefaults.scales.y.ticks, callback: v => v + 'h' } },
          },
        },
      });
      window.actSleepChartInst = actSleepChartInst;
    }
  }

  // Workouts chart (replaces HR — we don't have HR from Exist.io)
  const hrCanvas      = _el('actHRChart');
  const workoutMins   = recent.map(h => h.workoutsMins || 0);
  const workoutMiles  = recent.map(h => h.workoutsKm ? +(h.workoutsKm * 0.621371).toFixed(2) : 0);
  if (hrCanvas) {
    if (_allZero(workoutMins)) {
      actHRChartInst = _emptyChart(actHRChartInst, hrCanvas, 'No workout data yet');
      window.actHRChartInst = null;
    } else {
      actHRChartInst = _destroyChart(actHRChartInst);
      actHRChartInst = new Chart(hrCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Mins',     data: workoutMins, backgroundColor: 'rgba(124,58,237,0.7)', borderRadius: 4, yAxisID: 'y' },
            { label: 'Km',       data: workoutKm,   backgroundColor: 'rgba(8,145,178,0.7)',  borderRadius: 4, yAxisID: 'y2' },
          ],
        },
        options: {
          ...chartDefaults,
          plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } } },
          scales: {
            x:  { ...chartDefaults.scales.x },
            y:  { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: v => v + 'm' } },
            y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => v + 'km' } },
          },
        },
      });
      window.actHRChartInst = actHRChartInst;
    }
  }

}

// ── Init ─────────────────────────────────────────────────────────────
loadActivityData();
setInterval(loadActivityData, 30000);
