// ── activity.js ── Galaxy Watch / Samsung Health data display ─────────
// Reads health.json served alongside the dashboard on GitHub Pages,
// fed by the Samsung Health bridge on djtwo (pushes to weight-dashboard-v2
// repo which is public and served via Pages). Legacy Cloudflare Worker
// (Exist.io -> Garmin) and Firebase (Garmin direct) paths remain as
// fallbacks for the transition period.
// ───────────────────────────────────────────────────────────────────

// Same-origin path so it works whether the dashboard is loaded from
// GitHub Pages, a local file, or a preview branch.
const SAMSUNG_HEALTH_URL  = 'health.json';
const FIREBASE_GARMIN_URL = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';

// Chart instances for cleanup. Only actSleepDonutInst is still active —
// the old actStepsChartInst / actSleepChartInst / actHRChartInst were part
// of the 30-day trends section, replaced by ring/donut/comparison cards.
// Keeping the null globals so app-tabs.js's chart-teardown loop doesn't
// crash on missing keys during tab switches.
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

  const raw = Math.min(100, Math.max(0, dur + effScore + deepScore + remScore + awakePenalty));

  // Duration reality-check cap. Even perfect stages can't turn a short
  // night into "Good" or "Excellent" — mirrors how Samsung Health scores
  // (which punishes short sleep aggressively via undocumented weights).
  // Thresholds line up with the Fair/Good/Excellent bands in the KPI
  // renderer so labels stay honest to the duration.
  let cap = 100;
  if      (hours < 4.5) cap = 49;   // Poor ceiling
  else if (hours < 5.5) cap = 69;   // Fair ceiling
  else if (hours < 6.5) cap = 84;   // Good ceiling (blocks Excellent)
  else if (hours < 7.0) cap = 92;
  return Math.min(raw, cap);
}

function _destroyChart(inst) {
  if (inst) inst.destroy();
  return null;
}

// ── Load today's data ──────────────────────────────────────────────
// Sources, in priority / merge order:
//   1. Samsung Health via GitHub Pages (djtwo bridge, historical trends)
//   2. Cloudflare Worker /health.json — MERGED IN on top for live data
//      (Kage Health Bridge Android app pushes today's steps every 15 min
//      to /health/patch, which lands in Worker KV and is served here).
//   3. Firebase /garmin/latest.json (Garmin direct, legacy fallback)
//
// Per-day merge is FIELD-level: Worker fields overwrite static fields
// when both exist for the same date. This lets djtwo push completed-day
// sleep/HR/workouts via the same endpoint later without clashing with
// the live steps stream from the Android app.
function _mergeDaysByDate(baseDays, overlayDays) {
  const map = new Map();
  for (const d of baseDays)    map.set(d.date, { ...d });
  for (const d of overlayDays) {
    const existing = map.get(d.date) || {};
    const merged   = { ...existing };
    for (const [k, v] of Object.entries(d)) {
      if (v !== null && v !== undefined) merged[k] = v;
    }
    map.set(d.date, merged);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadActivityData() {
  let data    = null;
  let allDays = [];   // full history for charts
  let source  = '';

  // 1. Samsung Health via djtwo bridge -> GitHub Pages (primary, historical)
  try {
    const res = await fetch(SAMSUNG_HEALTH_URL, { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      if (json?.days?.length) {
        allDays = json.days;
        source  = 'Samsung Health via djtwo';
      }
    }
  } catch (e) {
    console.warn('Samsung Health health.json failed, trying Worker...', e);
  }

  // 2. Merge in Cloudflare Worker data (live from Kage Health Bridge app + legacy Exist.io)
  try {
    const workerBase = window.HEALTH_WORKER_URL || '';
    if (workerBase) {
      const res  = await fetch(`${workerBase}/health.json`, { cache: 'no-cache' });
      const json = await res.json();
      if (json?.days?.length) {
        if (allDays.length) {
          allDays = _mergeDaysByDate(allDays, json.days);
          source += ' + Worker live';
        } else {
          allDays = json.days;
          source  = 'Worker live only';
        }
      }
    }
  } catch (e) {
    console.warn('Worker health.json fetch failed (non-fatal):', e);
  }

  if (allDays.length) data = allDays[allDays.length - 1];

  // 3. Fall back to Firebase (legacy)
  if (!data) {
    try {
      const _fbToken = window.fbUser ? await window.fbUser.getIdToken() : null;
      const res = await fetch(`${FIREBASE_GARMIN_URL}/garmin/latest.json${_fbToken ? "?auth=" + _fbToken : ""}`);
      data    = await res.json();
      allDays = [data];
      source  = 'Garmin via Firebase';
    } catch (e) {
      console.error('All data sources failed:', e);
      return;
    }
  }

  if (!data) return;

  window.snapActivityDays = allDays;
  renderActivityKPIs(data);
  renderActivities(data.activities);
  renderSleepDonut(data);
  renderProgressRings(data);
  renderWeeklyCompare(allDays);
  renderSystemHealth(data, source);

  // Hide setup prompt
  const setup = _el('act-setup');
  if (setup) setup.style.display = 'none';

  // Show last updated
  // Update the "synced" line with THIS refresh's wall clock, not just the
  // data record's own timestamp — lets the user visually confirm the
  // auto-refresh loop is ticking (line changes every 60s while tab visible).
  const nowStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const ts = data.lastUpdated || data.updatedAt;
  if (ts) {
    const d = new Date(ts);
    _set('act-updated', `Data: ${d.toLocaleString()} · via ${source} · checked ${nowStr}`);
  } else if (data.date) {
    _set('act-updated', `Data for ${data.date} · via ${source} · checked ${nowStr}`);
  } else {
    _set('act-updated', `via ${source} · checked ${nowStr}`);
  }
}

// ── KPI Cards ──────────────────────────────────────────────────────
function renderActivityKPIs(data) {
  // Steps hero. Distance preference order:
  //   1. data.distanceMeters (Kage v0.3.4+, GPS-accurate from Samsung Health)
  //   2. data.distance (legacy Garmin/other field, already in miles)
  //   3. steps / 2000 fallback estimate (avoids "0 mi" when no distance field)
  const STEPS_PER_MILE = 2000;
  const stepGoal = 10000;
  const stepPct = Math.min(100, ((data.steps || 0) / stepGoal) * 100);
  let distMi;
  if (data.distanceMeters != null && data.distanceMeters > 0) {
    distMi = (data.distanceMeters / 1609.344).toFixed(2);
  } else if (data.distance) {
    distMi = (+data.distance).toFixed(2);
  } else if (data.steps) {
    distMi = (data.steps / STEPS_PER_MILE).toFixed(2);
  } else {
    distMi = '0.00';
  }
  _set('act-steps', _fmtK(data.steps));
  _set('act-steps-sub',
    `${distMi} mi · ${Math.round(stepPct)}% of ${_fmtK(stepGoal)} goal`);

  // Sleep — format decimal hours as "Xh Ym"
  const rawSleepH = data.sleepHours || 0;
  const sleepDisplay = rawSleepH
    ? (() => { const h = Math.floor(rawSleepH); const m = Math.round((rawSleepH - h) * 60); return m > 0 ? `${h}h ${m}m` : `${h}h`; })()
    : '—';
  _set('act-sleep', sleepDisplay);

  // Sleep score - prefer Garmin's authoritative score, fall back to our
  // estimate from duration + stage data (Samsung Health path). The
  // estimate uses deep/REM %, efficiency, and awakenings when available.
  const rawScore  = data.sleepScore ?? null;
  const estScore  = rawScore == null ? _calcSleepScore(data) : null;
  const score     = rawScore ?? estScore;
  const hasScore  = score !== null && score !== undefined;
  const isEst     = rawScore == null && estScore != null;
  const scoreColor = !hasScore ? '#6d7a95'
    : score >= 85 ? '#2a8703'
    : score >= 70 ? '#0053e2'
    : score >= 50 ? '#995213'
    : '#ea1100';
  const baseLabel = !hasScore ? 'not in sync data'
    : score >= 85 ? 'Excellent'
    : score >= 70 ? 'Good'
    : score >= 50 ? 'Fair'
    : 'Poor';
  const scoreLabel = isEst ? baseLabel + ' (est)' : baseLabel;
  if (_el('act-sleep-score-val')) {
    _el('act-sleep-score-val').textContent   = hasScore ? score : '—';
    _el('act-sleep-score-val').style.color   = scoreColor;
    _el('act-sleep-score-label').textContent = scoreLabel;
  }

  // Heart Rate card: show today's AVG (matches Kage app's sync summary)
  // as the big number; sub-line breaks out resting + range so both live
  // in one glance. avgHR is populated live from all HR samples today;
  // restingHR is the once-daily overnight low Samsung calculates.
  _set('act-hr', data.avgHR != null ? Math.round(data.avgHR).toString() : (data.restingHR || '—'));
  const hrSubParts = []
  if (data.restingHR)                    hrSubParts.push(`resting ${data.restingHR}`)
  if (data.minHR && data.maxHR)          hrSubParts.push(`${data.minHR}–${data.maxHR} range`)
  _set('act-hr-sub', hrSubParts.join(' · '));

  // Intensity minutes (from workout sessions)
  _set('act-intensity', data.intensityMinutes || '—');

  // Active Calories (from ActiveCaloriesBurnedRecord)
  _set('act-active-cal', data.activeCalories ? _fmtK(data.activeCalories) : '—');

  // Total Calories (from TotalCaloriesBurnedRecord — includes BMR)
  _set('act-total-cal', data.totalCalories ? _fmtK(data.totalCalories) : '—');

  // v0.3.4 additions ---------------------------------------------------
  // SpO2 (blood oxygen). Show avg with min as sub. <90% min flags possible sleep apnea.
  if (data.spo2Avg != null) {
    _set('act-spo2', data.spo2Avg.toFixed(1) + '%');
    _set('act-spo2-sub', data.spo2Min != null ? `min ${data.spo2Min.toFixed(0)}%` : 'nightly avg');
  } else {
    _set('act-spo2', '—');
  }
  // NOTE: Floors, HRV, and VO2 Max tiles removed from the dashboard grid on 2026-08-21
  // because Rylo's device stack (Samsung Galaxy Watch 6 + Garmin Vivosmart 5) can't
  // reliably populate them: Vivosmart 5 has no altimeter (floors), Samsung's HRV to
  // Health Connect bridge is spotty, and VO2 Max requires qualifying outdoor runs he
  // doesn't do. The underlying data fields (floorsClimbed, hrvRmssd, vo2Max) are still
  // ingested by the Worker and available in /health.json if any tile wants to come back.

  window.snapActivityNow = { steps: data.steps || 0, sleepHours: data.sleepHours || 0, sleepScore: score };
  if (typeof updateSnapshot    === 'function') updateSnapshot();
  if (typeof generateInsights  === 'function') generateInsights();
  if (typeof refreshHealthScore=== 'function') refreshHealthScore();
  if (typeof renderReportCard  === 'function') renderReportCard();
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

// ── Sleep Stages Donut (last night) ─────────────────────────────────────
let actSleepDonutInst = null;
window.actSleepDonutInst = null;

// Cache last-rendered sleep values so the 60s auto-refresh doesn't
// re-animate an identical donut every minute (Chart.js does a fresh
// animation on every new Chart() and it's visually noisy for data that
// hasn't changed since you woke up).
let _lastSleepSig = '';

function renderSleepDonut(data) {
  const canvas = _el('actSleepDonut');
  if (!canvas) return;
  const deep  = +(data.sleepDeep  || 0);
  const light = +(data.sleepLight || 0);
  const rem   = +(data.sleepRem   || 0);
  const total = deep + light + rem;

  // Skip if nothing changed since last render.
  const sig = `${deep}|${light}|${rem}`;
  if (sig === _lastSleepSig && actSleepDonutInst) return;
  _lastSleepSig = sig;

  _set('actSleepTotal', total > 0 ? total.toFixed(1) + 'h' : '—');

  // Bedtime + Waketime line (v0.3.4). Only shows if we have both from Kage.
  const bedwake = _el('actSleepTimes');
  if (bedwake) {
    if (data.bedtime && data.waketime) {
      const fmt = iso => {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      bedwake.innerHTML = `<b>${fmt(data.bedtime)}</b> → <b>${fmt(data.waketime)}</b>`;
    } else {
      bedwake.innerHTML = '';
    }
  }

  const legend = _el('actSleepLegend');
  if (legend) {
    const row = (color, name, val) => `<div style="display:flex;justify-content:space-between"><span><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;margin-right:6px"></span>${name}</span><span style="font-weight:600">${val > 0 ? val.toFixed(2) + 'h' : '—'}</span></div>`;
    legend.innerHTML =
      row('#1e3a5f', 'Deep',  deep)  +
      row('#4a90d9', 'Light', light) +
      row('#7c3aed', 'REM',   rem);
  }

  actSleepDonutInst = _destroyChart(actSleepDonutInst);
  if (total <= 0) {
    actSleepDonutInst = _emptyChart(actSleepDonutInst, canvas, 'No sleep data yet');
    return;
  }
  actSleepDonutInst = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Deep', 'Light', 'REM'],
      datasets: [{
        data: [deep, light, rem],
        backgroundColor: ['#1e3a5f', '#4a90d9', '#7c3aed'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed.toFixed(2)}h` } },
      },
    },
  });
  window.actSleepDonutInst = actSleepDonutInst;
}

// ── Today's Progress Rings (Apple Watch style) ──────────────────────────
const STEP_GOAL      = 10000;
const INTENSITY_GOAL = 30;   // active min/day (WHO baseline recommendation)

function renderProgressRings(data) {
  const svg = _el('actRings');
  if (!svg) return;
  const steps      = +(data.steps || 0);
  const intensity  = +(data.intensityMinutes || data.workoutsMins || 0);
  const stepsPct   = Math.min(steps / STEP_GOAL, 1);
  const intenPct   = Math.min(intensity / INTENSITY_GOAL, 1);

  // Two concentric rings. r=80 outer (steps), r=60 inner (intensity).
  // Circumference = 2πr. Filled arc = circumference * pct.
  const ring = (r, pct, color) => {
    const c = 2 * Math.PI * r;
    const dash = c * pct;
    return `
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}22" stroke-width="14" />
      <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="14"
              stroke-linecap="round" stroke-dasharray="${dash} ${c}"
              transform="rotate(-90 100 100)" />`;
  };
  svg.innerHTML = ring(80, stepsPct, '#2a8703') + ring(58, intenPct, '#7c3aed');

  const legend = _el('actRingsLegend');
  if (legend) {
    legend.innerHTML = `
      <div style="margin-bottom:0.6rem">
        <div style="color:#2a8703;font-weight:700;font-size:0.75rem">STEPS</div>
        <div style="font-size:1.1rem;font-weight:700">${_fmtK(steps)}<span style="color:#94a3b8;font-weight:400;font-size:0.75rem"> / ${_fmtK(STEP_GOAL)}</span></div>
        <div style="font-size:0.7rem;color:#6d7a95">${Math.round(stepsPct * 100)}% of goal</div>
      </div>
      <div>
        <div style="color:#7c3aed;font-weight:700;font-size:0.75rem">ACTIVE MIN</div>
        <div style="font-size:1.1rem;font-weight:700">${intensity}<span style="color:#94a3b8;font-weight:400;font-size:0.75rem"> / ${INTENSITY_GOAL}</span></div>
        <div style="font-size:0.7rem;color:#6d7a95">${Math.round(intenPct * 100)}% of goal</div>
      </div>`;
  }
}

// ── This Week vs Last Week ──────────────────────────────────────────
function renderWeeklyCompare(history = []) {
  const box = _el('actWeeklyCompare');
  if (!box) return;
  if (history.length < 8) { box.innerHTML = '<span style="color:#94a3b8">Not enough history yet (need 14 days)</span>'; return; }

  // Split into last 7 and previous 7 by date (ignore any gaps, treat the
  // trailing 14 days chronologically). Days are already sorted ascending.
  const last14 = history.slice(-14);
  const thisWk = last14.slice(-7);
  const prevWk = last14.slice(0, 7);

  const sum   = (arr, field) => arr.reduce((s, d) => s + (+d[field] || 0), 0);
  const avg   = (arr, field) => { const vs = arr.map(d => +d[field]).filter(v => v > 0); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0; };
  const arrow = (t, p) => { if (!p) return ''; const d = ((t - p) / p) * 100; const c = d >= 0 ? '#2a8703' : '#c92a2a'; const s = d >= 0 ? '▲' : '▼'; return `<span style="color:${c};font-weight:700;font-size:0.75rem">${s} ${Math.abs(d).toFixed(0)}%</span>`; };
  const row   = (label, thisVal, prevVal, fmt) => `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0.75rem;padding:0.35rem 0;border-bottom:1px solid #f1f5f9"><span style="color:#475569">${label}</span><span style="font-weight:600;color:#334155">${fmt(thisVal)}</span><span style="color:#94a3b8">${fmt(prevVal)}</span>${arrow(thisVal, prevVal)}</div>`;

  const thisSteps = sum(thisWk, 'steps'),   prevSteps = sum(prevWk, 'steps');
  const thisSleep = avg(thisWk, 'sleepHours'), prevSleep = avg(prevWk, 'sleepHours');
  const thisRHR   = avg(thisWk, 'restingHR'), prevRHR   = avg(prevWk, 'restingHR');
  const thisAct   = sum(thisWk, 'intensityMinutes') || sum(thisWk, 'workoutsMins');
  const prevAct   = sum(prevWk, 'intensityMinutes') || sum(prevWk, 'workoutsMins');

  box.innerHTML =
    `<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:0.75rem;padding-bottom:0.35rem;border-bottom:2px solid #e2e8f0;font-size:0.7rem;font-weight:700;color:#6d7a95;text-transform:uppercase"><span>Metric</span><span>This wk</span><span>Last wk</span><span>Δ</span></div>` +
    row('Total steps',    thisSteps, prevSteps, v => _fmtK(v)) +
    row('Avg sleep',      thisSleep, prevSleep, v => v > 0 ? v.toFixed(1) + 'h' : '—') +
    row('Active minutes', thisAct,   prevAct,   v => v + 'min') +
    row('Resting HR',     thisRHR,   prevRHR,   v => v > 0 ? v.toFixed(0) + 'bpm' : '—');
}

// ── Live System Health (the nerd-flex card) ────────────────────────────
function renderSystemHealth(data, source) {
  const box = _el('actSystemHealth');
  if (!box) return;
  const ts    = data.updatedAt || data.lastUpdated;
  const now   = Date.now();
  let freshness = '—';
  let stale     = false;
  if (ts) {
    const ageMs  = now - new Date(ts).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    stale = ageMin > 30;
    freshness = ageMin < 1  ? 'just now'
              : ageMin < 60 ? `${ageMin} min ago`
              :               `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
  }
  const dot   = stale ? '' : '';  // visual live/stale indicator
  const state = stale ? 'STALE' : 'LIVE';

  box.innerHTML = [
    `<div><b>${dot} ${state}</b> · last data ${freshness}</div>`,
    `<div>source · ${source || 'unknown'}</div>`,
    `<div>pipeline · Samsung Health → Health Connect → Kage v0.3.3 → Cloudflare Worker → dashboard</div>`,
    `<div>next expected sync · within 15 min (Kage watchdog: 5 min)</div>`,
  ].join('');
}

// ── Init ───────────────────────────────────────────────────────────────────────
// Auto-refresh strategy:
//   * Fire immediately on load
//   * Fire every ACTIVITY_REFRESH_MS while the tab is visible
//   * Pause when the tab is hidden (Page Visibility API) to save bandwidth
//     and battery on mobile — no point polling a page nobody's looking at
//   * Immediately re-fetch when the tab regains focus (catches up on missed
//     ticks so you never see stale data after coming back from another tab)
// NOTE: renamed from REFRESH_MS to avoid collision with app-config.js's global
// REFRESH_MS (30_000) — duplicate `const` at global scope is a SyntaxError
// that kills the entire file's execution.
const ACTIVITY_REFRESH_MS = 60_000;  // 60s — balances freshness vs. Cloudflare
                                     // Worker request quota (100k/day free tier)
let _refreshTimer = null;

function _startAutoRefresh() {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadActivityData();
  }, ACTIVITY_REFRESH_MS);
}

function _stopAutoRefresh() {
  if (!_refreshTimer) return;
  clearInterval(_refreshTimer);
  _refreshTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadActivityData();       // catch up immediately
    _startAutoRefresh();      // resume ticking
  } else {
    _stopAutoRefresh();       // pause — no point polling a hidden tab
  }
});

loadActivityData();
_startAutoRefresh();

// Expose loadActivityData globally so a manual "Refresh" button (or the tab
// switcher in enhancements.js) can force a refetch on demand.
window.loadActivityData = loadActivityData;
