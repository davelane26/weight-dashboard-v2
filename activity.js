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
  renderHRVSection(data, allDays);
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

  // Sleep
  _set('act-sleep', data.sleepDuration || data.sleepHours || '—');
  const scoreHtml = data.sleepScore
    ? `Score: ${data.sleepScore} ${_sleepQuality(data.sleepScore)}`
    : '';
  _set('act-sleep-score', scoreHtml);

  // Heart rate
  _set('act-hr',  data.restingHR || '—');
  _set('act-hr-sub', data.avgHR ? `Avg: ${data.avgHR} bpm` : '');

  // HRV (reuses act-intensity slot)
  _set('act-intensity', data.hrv || '—');

  // Floors (reuses act-stress slot)
  _set('act-stress', data.floorsClimbed || '—');
  _set('act-stress-sub', data.floorsClimbed ? `${data.floorsClimbed} floors` : '');

  // Max HR (reuses act-battery slot)
  _set('act-battery', data.maxHR || '—');

  // Avg HR (reuses act-fitness-age slot)
  _set('act-fitness-age', data.avgHR || '—');
  _set('act-fitness-age-sub', '');

  // Active calories only — no redundant total cal
  _set('act-vo2max', data.activeCalories ? _fmtK(data.activeCalories) : '—');
}

// ── Sleep Breakdown ─────────────────────────────────────────────────────
function renderSleepBreakdown(data) {
  const container = _el('sleep-breakdown');
  if (!container) return;

  // Flat fields from Exist.io via Worker
  const stages = {
    deep:  data.sleepDeep  || data.sleepStages?.deep  || 0,
    light: data.sleepLight || data.sleepStages?.light || 0,
    rem:   data.sleepRem   || data.sleepStages?.rem   || 0,
  };
  const total = stages.deep + stages.light + stages.rem;
  if (total <= 0) return;
  container.style.display = 'block';

  const pct = (v) => Math.round((v / total) * 100);
  const bar = (color, val, label) => {
    const p = pct(val);
    return `<div style="flex:${p};background:${color};height:100%;border-radius:4px;min-width:${p > 3 ? '0' : '4px'}" title="${label}: ${val.toFixed(1)}h (${p}%)"></div>`;
  };

  _html('sleep-stage-bar',
    bar('#1e3a5f', stages.deep, 'Deep') +
    bar('#4a90d9', stages.light, 'Light') +
    bar('#7c3aed', stages.rem, 'REM')
  );

  _html('sleep-stage-legend',
    `<span style="color:#1e3a5f">● Deep ${stages.deep.toFixed(1)}h (${pct(stages.deep)}%)</span>` +
    `<span style="color:#4a90d9">● Light ${stages.light.toFixed(1)}h (${pct(stages.light)}%)</span>` +
    `<span style="color:#7c3aed">● REM ${stages.rem.toFixed(1)}h (${pct(stages.rem)}%)</span>`
  );
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

  // Heart rate chart — Bug 4 fix: check for real HR data first
  const hrCanvas    = _el('actHRChart');
  const hrData      = recent.map(h => h.restingHR || null);
  const avgHRData   = recent.map(h => h.avgHR     || null);
  if (hrCanvas) {
    if (_allZero(hrData.map(v => v || 0)) && _allZero(avgHRData.map(v => v || 0))) {
      actHRChartInst = _emptyChart(actHRChartInst, hrCanvas, 'No heart rate data yet');
      window.actHRChartInst = null;
    } else {
      actHRChartInst = _destroyChart(actHRChartInst);
      actHRChartInst = new Chart(hrCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Resting HR', data: hrData,    borderColor: '#ea1100', backgroundColor: 'rgba(234,17,0,0.08)', fill: true,  tension: 0.3, pointRadius: 5, pointBackgroundColor: '#ea1100', spanGaps: true, borderWidth: 2.5 },
            { label: 'Avg HR',     data: avgHRData, borderColor: '#f59e0b', backgroundColor: 'transparent',         fill: false, tension: 0.3, pointRadius: 3, spanGaps: true, borderWidth: 1.5, borderDash: [4, 3] },
          ],
        },
        options: {
          ...chartDefaults,
          plugins: { legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } } },
          scales: {
            ...chartDefaults.scales,
            y: { ...chartDefaults.scales.y, beginAtZero: false, ticks: { ...chartDefaults.scales.y.ticks, callback: v => v + ' bpm' } },
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
