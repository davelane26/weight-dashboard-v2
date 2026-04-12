// ── Config ───────────────────────────────────────────────────────────
const DATA_URL     = 'https://davelane26.github.io/Weight-tracker/data.json';
const START_WEIGHT = 315.0;
const START_DATE   = 'Jan 23, 2026';
const REFRESH_MS   = 30_000;
const ACTIVITY_LEVELS = {
  sedentary:   { label: 'Sedentary',   desc: 'Desk job, little or no exercise',       multiplier: 1.2   },
  light:       { label: 'Light',       desc: 'Light exercise 1-3 days/week',          multiplier: 1.375 },
  moderate:    { label: 'Moderate',    desc: 'Moderate exercise 3-5 days/week',       multiplier: 1.55  },
  active:      { label: 'Active',      desc: 'Hard exercise 6-7 days/week',           multiplier: 1.725 },
  very_active: { label: 'Very Active', desc: 'Physical job or twice-daily training',  multiplier: 1.9   },
};

const BMI_CATS = [
  { label: 'Normal Weight',  range: 'BMI < 25',    min: 18.5, max: 25,       icon: '🟢' },
  { label: 'Overweight',     range: 'BMI 25–29.9', min: 25,   max: 30,       icon: '🟡' },
  { label: 'Obese I',        range: 'BMI 30–34.9', min: 30,   max: 35,       icon: '🟠' },
  { label: 'Obese II',       range: 'BMI 35–39.9', min: 35,   max: 40,       icon: '🔴' },
  { label: 'Obese III',      range: 'BMI ≥ 40',   min: 40,   max: Infinity, icon: '⚫' },
];

// -- TDEE calculator (Katch-McArdle + activity multiplier) ----------------
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

// -- Activity level persistence --------------------------------------------
function loadActivityLevel() {
  const saved = localStorage.getItem('wt_v2_activity');
  if (saved && ACTIVITY_LEVELS[saved]) activityLevel = saved;
  syncActivityUI();
}
function setActivityLevel(level) {
  if (!ACTIVITY_LEVELS[level]) return;
  activityLevel = level;
  localStorage.setItem('wt_v2_activity', level);
  syncActivityUI();
  if (allData.length) renderAll();
}
function syncActivityUI() {
  const info = ACTIVITY_LEVELS[activityLevel];
  document.querySelectorAll('.activity-pill').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.level === activityLevel)
  );
  setText('activity-desc', info ? `${info.label} x${info.multiplier} - ${info.desc}` : '');
}
window.setActivityLevel = setActivityLevel;

// -- Tab switching ---------------------------------------------------------────
const TABS = ['weight', 'glucose', 'activity'];
function switchTab(name) {
  TABS.forEach(t => {
    const panel = el('tab-' + t);
    const btn   = el('tab-btn-' + t);
    if (panel) panel.hidden = (t !== name);
    if (btn) {
      btn.classList.toggle('active', t === name);
      btn.setAttribute('aria-selected', t === name);
    }
  });
  localStorage.setItem('wt_v2_tab', name);
  // Chart.js needs a nudge when its canvas becomes visible
  if (name === 'glucose') {
    setTimeout(() => {
      if (window.glucoseChartInstance) window.glucoseChartInstance.resize();
    }, 50);
  }
  if (name === 'activity') {
    setTimeout(() => {
      ['actStepsChartInst','actSleepChartInst','actHRChartInst'].forEach(k => {
        if (window[k]) window[k].resize();
      });
    }, 50);
  }
}
function restoreTab() {
  const saved = localStorage.getItem('wt_v2_tab');
  if (saved && TABS.includes(saved)) switchTab(saved);
}

// ── Dark mode ──────────────────────────────────────────────────────
function loadDark() {
  const dark = localStorage.getItem('wt_v2_dark') === '1';
  document.getElementById('root').classList.toggle('dark', dark);
  const btn = el('dark-btn');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}
function toggleDark() {
  const root = document.getElementById('root');
  const isDark = root.classList.toggle('dark');
  localStorage.setItem('wt_v2_dark', isDark ? '1' : '0');
  const btn = el('dark-btn');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

// ── State ───────────────────────────────────────────────────────────
let allData       = [];
let goalWeight    = null;
let calLog        = {};
let charts        = {};
let chartRange    = 'all';
let activityLevel = 'moderate';

// ── Formatters ─────────────────────────────────────────────────────────
const fmt    = (n, d = 1)  => n != null ? (+n).toFixed(d) : '—';
const fmtK   = n            => n != null ? Math.round(n).toLocaleString('en-US') : '—';
const fmtPct = (n, d = 1)  => n != null ? (+n).toFixed(d) + '%' : '—';

function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(d) {
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Date parsing ────────────────────────────────────────────────────────
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

// ── BMI category ────────────────────────────────────────────────────────
function bmiCategory(bmi) {
  if (bmi < 18.5) return ['Underweight',  'background:#dbeafe;color:#1d4ed8'];
  if (bmi < 25)   return ['Normal',        'background:#dcfce7;color:#166534'];
  if (bmi < 30)   return ['Overweight',    'background:#fef9c3;color:#854d0e'];
  if (bmi < 35)   return ['Obese I',       'background:#ffedd5;color:#c2410c'];
  if (bmi < 40)   return ['Obese II',      'background:#fee2e2;color:#991b1b'];
  return               ['Obese III',       'background:#fecaca;color:#7f1d1d'];
}

// ── Moving average ──────────────────────────────────────────────────────
function movingAvg(arr, window = 7) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

// ── Linear regression → lbs/day slope ───────────────────────────────────
// Uses last `days` of data so recent trend matters more than old data
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

// ── Streak counter ──────────────────────────────────────────────────────
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

// ── Delta arrow HTML ────────────────────────────────────────────────────
function delta(val, lowerIsBetter = true) {
  if (val == null) return '';
  const good = lowerIsBetter ? val <= 0 : val >= 0;
  const arrow = val < 0 ? '▼' : val > 0 ? '▲' : '●';
  const cls   = good ? 'down' : 'up';
  return `<span class="${cls}">${arrow} ${fmt(Math.abs(val))}</span>`;
}

// ── Set element text/html safely ────────────────────────────────────────
const el      = id => document.getElementById(id);
const setText = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const setHTML = (id, v) => { const e = el(id); if (e) e.innerHTML   = v; };

// ── Animated counter ────────────────────────────────────────────────────
function countUp(id, target, decimals = 1, suffix = '', duration = 900) {
  const e = el(id);
  const t = +target;
  if (!e || isNaN(t)) return;
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

// ── Destroy chart helper ────────────────────────────────────────────────
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// ── Render KPI cards ────────────────────────────────────────────────────
function renderKPIs(latest, prev) {
  countUp('kpi-weight', latest.weight, 1);
  const wd = prev ? latest.weight - prev.weight : null;
  setHTML('kpi-weight-sub', wd != null ? delta(wd) + ' lbs from last' : '');

  countUp('kpi-bmi', latest.bmi, 2);
  if (latest.bmi) {
    const [cat, style] = bmiCategory(latest.bmi);
    const bd = prev?.bmi ? latest.bmi - prev.bmi : null;
    setHTML('kpi-bmi-sub', `<span class="badge" style="${style}">${cat}</span>${bd != null ? ' ' + delta(bd) : ''}`);
  }

  latest.bodyFat ? countUp('kpi-fat', latest.bodyFat, 1, '%') : setText('kpi-fat', '—');
  const fd = prev?.bodyFat ? latest.bodyFat - prev.bodyFat : null;
  setHTML('kpi-fat-sub', fd != null ? delta(fd) + '% from last' : '');

  latest.muscle ? countUp('kpi-muscle', latest.muscle, 1, '%') : setText('kpi-muscle', '—');
  const md = prev?.muscle ? latest.muscle - prev.muscle : null;
  setHTML('kpi-muscle-sub', md != null ? delta(md, false) + '% from last' : '');

  latest.water ? countUp('kpi-water', latest.water, 0, '%') : setText('kpi-water', '—');
  const wad = prev?.water ? latest.water - prev.water : null;
  setHTML('kpi-water-sub', wad != null ? delta(wad, false) + '% from last' : '');

  latest.bone ? countUp('kpi-bone', latest.bone, 2) : setText('kpi-bone', '—');

  const energy = calcTDEE(latest);
  if (energy) {
    countUp('kpi-bmr',  energy.bmr,  0);
    countUp('kpi-tdee', energy.tdee, 0);
  } else {
    setText('kpi-bmr',  '—');
    setText('kpi-tdee', '—');
  }
}

// ── Journey duration ────────────────────────────────────────────────────
function renderJourneyDuration() {
  const start = new Date(START_DATE);
  const now   = new Date();
  const days  = Math.max(0, Math.floor((now - start) / 864e5));
  const weeks = Math.floor(days / 7);
  const months = (days / 30.44).toFixed(1);

  // Milestone flavour text
  let milestone = '';
  if      (days < 7)   milestone = '🌱 Just getting started!';
  else if (days < 30)  milestone = '🔥 First month coming up!';
  else if (days < 60)  milestone = '💪 Over a month strong!';
  else if (days < 90)  milestone = '🚀 Closing in on 3 months!';
  else if (days < 180) milestone = '⭐ Crushing it!';
  else if (days < 365) milestone = '🏆 Half a year of hard work!';
  else                  milestone = '🎉 Over a year — legendary!';

  setText('journey-duration',
    `Day ${days} · Week ${weeks} · ${months} months · ${milestone}`);
}

// ── Render journey ──────────────────────────────────────────────────────
function renderJourney(latest, data) {
  renderJourneyDuration();
  const lost = Math.max(0, START_WEIGHT - latest.weight);
  const pct  = Math.min(100, Math.max(0, (lost / START_WEIGHT) * 100));

  countUp('journey-current',  latest.weight, 1);
  setText('journey-date',     fmtDate(latest.date));
  countUp('journey-lost',     lost, 1);
  countUp('journey-pct-stat', pct, 1, '%');

  const bar = el('journey-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.textContent = pct >= 8 ? Math.round(pct) + '%' : '';
  }
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);

  // Rate of loss (lbs/week via linear regression on last 30 days)
  // Deduplicate to one reading per day first so we can report the real sample size
  const byDay30 = {};
  data.forEach(r => { byDay30[r.date.toDateString()] = r; });
  const dailyPts = Object.values(byDay30).sort((a, b) => a.date - b.date).slice(-30);
  const slopePerDay = weightTrendSlope(data);
  if (slopePerDay !== null) {
    const lbsPerWeek = Math.abs(slopePerDay * 7);
    countUp('journey-rate', lbsPerWeek, 1);
    setText('journey-rate-sub', `lbs/wk · ${dailyPts.length} day${dailyPts.length !== 1 ? 's' : ''} of data`);
  } else {
    setText('journey-rate', '—');
    setText('journey-rate-sub', 'not enough data yet');
  }

  // Personal best (all-time lowest weight)
  const best    = data.reduce((b, r) => r.weight < b.weight ? r : b, data[0]);
  countUp('journey-best', best.weight, 1);
  setText('journey-best-date', fmtDate(best.date));

  // Next milestone ETA
  const allTimeLow = Math.min(...data.map(r => r.weight));
  const floor  = goalWeight ? Math.floor(goalWeight / 10) * 10 : 220;
  const steps  = [];
  for (let w = Math.floor(START_WEIGHT / 10) * 10; w >= floor; w -= 10) steps.push(w);
  const nextMilestone = steps.find(w => allTimeLow > w);
  if (nextMilestone && slopePerDay && slopePerDay < 0) {
    const remaining = latest.weight - nextMilestone;
    const daysLeft  = remaining / Math.abs(slopePerDay);
    const projDate  = new Date(latest.date.getTime() + daysLeft * 86400000);
    setText('journey-next-eta',
      `${nextMilestone} lbs · ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  } else {
    setText('journey-next-eta', nextMilestone ? `${nextMilestone} lbs` : '🎉 All done!');
  }
}

// ── Milestones ──────────────────────────────────────────────────────
function renderMilestones(latest, data) {
  const row = el('milestones-row');
  if (!row) return;
  const current    = latest.weight;
  const allTimeLow = Math.min(...data.map(d => d.weight));
  // Build milestones every 10 lbs from START_WEIGHT down to goal or 220
  const floor = goalWeight ? Math.floor(goalWeight / 10) * 10 : 220;
  const steps = [];
  for (let w = Math.floor(START_WEIGHT / 10) * 10; w >= floor; w -= 10) steps.push(w);
  // Next uncompleted milestone based on all-time low
  const nextIdx = steps.findIndex(w => allTimeLow > w);
  row.innerHTML = steps.map((w, i) => {
    const done   = allTimeLow <= w;   // earned if all-time low crossed it
    const isCurr = i === nextIdx;
    const cls    = done ? 'done' : isCurr ? 'current' : 'future';
    const icon   = done ? '✓' : isCurr ? '▼' : w;
    return `<div class="milestone-ring ${cls}">
      <div class="milestone-circle">${icon}</div>
      <div class="milestone-label">${w} lbs</div>
    </div>`;
  }).join('');
}

// ── BMI Timeline ────────────────────────────────────────────────────
function renderBMITimeline(data, latest) {
  const box = el('bmi-timeline');
  if (!box || !latest.bmi || !latest.weight) return;
  // Derive height in meters from latest weight + BMI
  const weightKg = latest.weight / 2.205;
  const heightM  = Math.sqrt(weightKg / latest.bmi);
  // Get BMI slope (lbs/day on weight, convert to BMI/day)
  const slope = weightTrendSlope(data); // lbs/day
  const bmiSlopePerDay = slope ? slope / (2.205 * heightM * heightM) : null;
  const currentBmi = latest.bmi;
  box.innerHTML = BMI_CATS.slice().reverse().map(cat => {
    const bmiThreshold = cat.max === Infinity ? null : cat.max;
    const isCurrentCat = bmiThreshold
      ? currentBmi < bmiThreshold && currentBmi >= (BMI_CATS[BMI_CATS.findIndex(c => c.max === cat.max) - 1]?.max ?? 0)
      : currentBmi >= 40;
    // A category is "passed" only when BMI has dropped below its minimum
    const passed = currentBmi < cat.min;
    let dateStr = '';
    if (!passed && !isCurrentCat && bmiThreshold && bmiSlopePerDay && bmiSlopePerDay < 0) {
      const bmiToLose = currentBmi - bmiThreshold;
      const daysLeft  = bmiToLose / Math.abs(bmiSlopePerDay);
      const proj      = new Date(latest.date.getTime() + daysLeft * 86400000);
      dateStr = proj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const cls = passed ? 'achieved' : isCurrentCat ? 'current' : 'future';
    const statusIcon = passed ? '✓' : isCurrentCat ? '▶' : '';
    // Weight range in lbs for this category
    const bmiToLbs = b => Math.round(b * heightM * heightM * 2.205);
    const minLbs = bmiToLbs(cat.min);
    const maxLbs = cat.max === Infinity ? null : bmiToLbs(cat.max);
    const wtRange = maxLbs ? `${minLbs}–${maxLbs} lbs` : `${minLbs}+ lbs`;
    return `<div class="bmi-step ${cls}">
      <span class="bmi-step-icon">${cat.icon}</span>
      <div class="bmi-step-info">
        <div class="bmi-step-cat">${statusIcon ? statusIcon + ' ' : ''}${cat.label}</div>
        <div class="bmi-step-range">${cat.range} &middot; ${wtRange}</div>
      </div>
      <div class="bmi-step-date">${passed ? '✅ Cleared' : isCurrentCat ? '📍 You are here' : dateStr ? 'Est. ' + dateStr : '—'}</div>
    </div>`;
  }).join('');
}

// ── Happy Scale: Trend hero + decade badge ────────────────────────────
function renderTrendHero(data) {
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  const vals   = daily.map(r => r.weight);
  const avg7   = movingAvg(vals, 7);
  const trend  = avg7[avg7.length - 1];
  const raw    = daily[daily.length - 1]?.weight;

  // Direction: compare latest 7-day avg vs 7 days ago
  const prevTrend = avg7.length > 7 ? avg7[avg7.length - 8] : null;
  const dir = prevTrend == null ? 'neutral'
    : trend < prevTrend - 0.05 ? 'down'
    : trend > prevTrend + 0.05 ? 'up'
    : 'neutral';

  const trendEl = el('trend-value');
  if (trendEl) {
    trendEl.className = `trend-value ${dir}`;
    countUp('trend-value', trend, 1);
  }
  setText('trend-raw', fmt(raw));
  const dirLabel = dir === 'down' ? '↓ trending down 🟢'
                 : dir === 'up'   ? '↑ trending up 🔴'
                 : '— holding steady';
  setText('trend-dir', dirLabel);

  // Decade badge: e.g. "You’re in the 280s!"
  const badge = el('decade-badge');
  if (badge && trend != null) {
    const decade = Math.floor(trend / 10) * 10;
    badge.style.display = 'block';
    badge.innerHTML = `You’re in the<br><strong>${decade}s!</strong>`;
  }
}

// ── Happy Scale: Time range pills ────────────────────────────────────
function setRange(r) {
  chartRange = r;
  document.querySelectorAll('.range-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.range === r));
  if (allData.length) renderWeightChart(allData);
}

// ── Render KPIs ─────────────────────────────────────────────────────────
function renderStreak(data) {
  const streak = calcStreak(data);
  setText('streak-count', streak);
  setText('streak-label', streak === 1 ? 'day streak 🔥' : 'days in a row 🔥');
  setText('streak-total', data.length + ' total readings');
}

// ── Render calorie insights ─────────────────────────────────────────────
function renderCalories(latest) {
  const energy = calcTDEE(latest);
  if (!energy) return;
  countUp('cal-maintain', energy.tdee,        0);
  countUp('cal-lose1',    energy.tdee - 500,  0);
  countUp('cal-lose2',    energy.tdee - 1000, 0);
}

// ── Render weight chart ─────────────────────────────────────────────────
function renderWeightChart(data) {
  destroyChart('weight');
  // Filter by selected time range
  const days   = { '1m': 30, '3m': 90, '6m': 180 }[chartRange];
  const cutoff = days ? new Date(Date.now() - days * 86400000) : null;
  const filtered = cutoff ? data.filter(r => r.date >= cutoff) : data;
  const byDay = {};
  filtered.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  const labels = daily.map(r => fmtDate(r.date));
  const vals   = daily.map(r => r.weight);
  const avg7   = movingAvg(vals, 7);

  const ctx  = el('weightChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, 'rgba(0,83,226,0.15)');
  grad.addColorStop(1, 'rgba(0,83,226,0)');

  charts.weight = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Weight (lbs)',
          data: vals,
          borderColor: '#0053e2',
          backgroundColor: grad,
          fill: true,
          tension: 0.35,
          pointRadius: daily.length < 40 ? 4 : 2,
          pointHoverRadius: 6,
          pointBackgroundColor: '#0053e2',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        },
        {
          label: '7-day rolling avg (trend)',
          data: avg7,
          borderColor: '#ffc220',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.45,
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [6, 3],
        },
        ...(goalWeight ? [{
          label: `🟢 Goal (${goalWeight} lbs)`,
          data: labels.map(() => goalWeight),
          borderColor: '#2a8703',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [10, 5],
        }] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 20 } },
        tooltip: {
          backgroundColor: '#1a1f36', padding: 12, cornerRadius: 10,
          titleColor: '#fff', bodyColor: '#ccc',
          callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(1)} lbs` },
        },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 10 }, grid: { color: '#eee' } },
        y: { ticks: { color: '#6d7a95', font: { size: 11 }, callback: v => v + ' lbs' }, grid: { color: '#eee' } },
      },
    },
  });
}

// ── Render body composition charts ──────────────────────────────────────
function renderCompositionCharts(data) {
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  const labels = daily.map(r => fmtDate(r.date));

  // Fat vs Muscle trend
  destroyChart('comp');
  const ctxC = el('compChart').getContext('2d');
  charts.comp = new Chart(ctxC, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Body Fat %',
          data: daily.map(r => r.bodyFat),
          borderColor: '#ea1100', backgroundColor: 'rgba(234,17,0,0.08)',
          fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2,
        },
        {
          label: 'Muscle %',
          data: daily.map(r => r.muscle),
          borderColor: '#2a8703', backgroundColor: 'rgba(42,135,3,0.08)',
          fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 16 } },
        tooltip: { backgroundColor: '#1a1f36', padding: 10, cornerRadius: 8,
          callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 8 }, grid: { color: '#eee' } },
        y: { ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => (+v).toFixed(1) + '%' }, grid: { color: '#eee' } },
      },
    },
  });

  // Water % chart
  destroyChart('water');
  const ctxW = el('waterChart').getContext('2d');
  charts.water = new Chart(ctxW, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Body Water %',
        data: daily.map(r => r.water),
        borderColor: '#0891b2', backgroundColor: 'rgba(8,145,178,0.1)',
        fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 16 } },
        tooltip: { backgroundColor: '#1a1f36', padding: 10, cornerRadius: 8,
          callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(1)}%` } },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 8 }, grid: { color: '#eee' } },
        y: { ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => (+v).toFixed(1) + '%' }, grid: { color: '#eee' } },
      },
    },
  });
}

// ── Render week-over-week table ─────────────────────────────────────────────
function renderWoW(data) {
  if (data.length < 2) return;

  // Group readings by calendar week (Sun–Sat)
  const weeks = {};
  data.forEach(r => {
    const d = new Date(r.date);
    d.setDate(d.getDate() - d.getDay());
    const k = d.toDateString();
    if (!weeks[k]) weeks[k] = { sun: d, rows: [] };
    weeks[k].rows.push(r);
  });

  const sorted = Object.values(weeks).sort((a, b) => a.sun - b.sun);
  const tbody  = el('wow-body');
  tbody.innerHTML = '';

  sorted.forEach(wk => {
    const rs      = wk.rows.sort((a, b) => a.date - b.date);
    const first   = rs[0].weight;
    const last    = rs[rs.length - 1].weight;
    const lost    = first - last;  // positive = lost weight ✓
    const weekEnd = new Date(wk.sun);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekLabel = wk.sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + '–' + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let lostHtml;
    if (rs.length === 1) {
      lostHtml = '<span style="color:#c5c9d5">one reading</span>';
    } else if (lost > 0) {
      lostHtml = `<span class="down" style="font-size:1.1rem;font-weight:800">▼ ${fmt(lost)} lbs</span>`;
    } else if (lost < 0) {
      lostHtml = `<span class="up" style="font-size:1.1rem;font-weight:800">▲ ${fmt(Math.abs(lost))} lbs</span>`;
    } else {
      lostHtml = '<span style="color:#6d7a95">no change</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600;white-space:nowrap">${weekLabel}</td>
      <td style="color:#6d7a95">${fmt(first)} lbs</td>
      <td style="color:#6d7a95">${fmt(last)} lbs</td>
      <td>${lostHtml}</td>
      <td style="text-align:center">
        <span class="badge" style="background:#eff4ff;color:#0053e2">${rs.length}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Render goal section ─────────────────────────────────────────────────
function renderGoal(latest, data = []) {
  const content = el('goal-content');
  const empty   = el('goal-empty');
  if (!goalWeight) {
    content.style.display = 'none';
    empty.style.display   = 'block';
    return;
  }
  content.style.display = 'block';
  empty.style.display   = 'none';

  const remaining   = Math.max(0, latest.weight - goalWeight);
  const totalToLose = START_WEIGHT - goalWeight;
  const lost        = START_WEIGHT - latest.weight;
  const pct         = totalToLose > 0 ? Math.min(100, Math.max(0, (lost / totalToLose) * 100)) : 0;

  countUp('goal-target',    goalWeight,  1);
  countUp('goal-remaining', remaining,   1);
  countUp('goal-pct',       pct,         0, '%');
  el('goal-bar').style.width = pct + '%';
  el('goal-bar').textContent = pct >= 10 ? Math.round(pct) + '%' : '';

  if (remaining <= 0) {
    setText('goal-eta', '🎉 Goal reached!');
    return;
  }

  // Calorie-based projection using 7-day rolling average
  const avgCals = calAvg();
  const energy = calcTDEE(latest);
  if (avgCals && energy?.tdee) {
    const deficit = energy.tdee - avgCals;
    if (deficit > 0) {
      const lbsPerWeek = (deficit * 7) / 3500;
      const daysLeft   = remaining / (lbsPerWeek / 7);
      const projDate   = new Date(latest.date.getTime() + daysLeft * 86400000);
      const loggedDays = Object.keys(calLog).length;
      setText('goal-eta',
        `avg ${Math.round(avgCals).toLocaleString()} kcal (${loggedDays}d) · ${Math.round(deficit).toLocaleString()} deficit · ~${lbsPerWeek.toFixed(1)} lbs/wk · projected ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
      return;
    } else {
      setText('goal-eta', '⚠️ Eating at or above TDEE — no deficit to project from');
      return;
    }
  }

  // Fallback: linear regression on last 30 days
  const slopePerDay = weightTrendSlope(data);
  if (slopePerDay !== null && slopePerDay < 0) {
    const daysLeft    = remaining / Math.abs(slopePerDay);
    const projDate    = new Date(latest.date.getTime() + daysLeft * 86400000);
    const weeklyRate  = Math.abs(slopePerDay * 7);
    setText('goal-eta',
      `losing ~${weeklyRate.toFixed(1)} lbs/wk · projected ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  } else {
    const weeksLeft = Math.ceil(remaining / 1.5);
    const estDate   = new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
    setText('goal-eta', `~${weeksLeft} wk${weeksLeft !== 1 ? 's' : ''} at 1.5 lbs/wk · est. ${fmtDate(estDate)}`);
  }
}

// ── Goal persistence ────────────────────────────────────────────────────
function loadGoal() {
  try {
    const g = localStorage.getItem('wt_v2_goal');
    if (g) { goalWeight = parseFloat(g); el('goal-input').value = goalWeight; }
  } catch {}
}
function setGoal() {
  const v = parseFloat(el('goal-input').value);
  if (isNaN(v) || v <= 0) return;
  goalWeight = v;
  localStorage.setItem('wt_v2_goal', goalWeight);
  if (allData.length) {
    renderGoal(allData[allData.length - 1], allData);
    renderWeightChart(allData);
  }
}
function clearGoal() {
  goalWeight = null;
  el('goal-input').value = '';
  localStorage.removeItem('wt_v2_goal');
  if (allData.length) {
    renderGoal(allData[allData.length - 1], allData);
    renderWeightChart(allData);
  }
}

// ── Calorie log ───────────────────────────────────────────────────
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

function calAvg(days = 7) {
  const entries = Object.entries(calLog)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, days)
    .map(([, v]) => v);
  return entries.length ? entries.reduce((a, b) => a + b, 0) / entries.length : null;
}

function loadCalLog() {
  try {
    const stored = localStorage.getItem('wt_v2_cal_log');
    calLog = stored ? JSON.parse(stored) : {};
    // Migrate old single-value entry if present
    const old = localStorage.getItem('wt_v2_calories');
    if (old && !calLog[todayKey()]) {
      calLog[todayKey()] = parseFloat(old);
      localStorage.removeItem('wt_v2_calories');
      saveCalLog();
    }
    // Pre-fill today's input if already logged
    const todayVal = calLog[todayKey()];
    if (todayVal) el('cal-input').value = todayVal;
  } catch {}
}

function saveCalLog() {
  try { localStorage.setItem('wt_v2_cal_log', JSON.stringify(calLog)); } catch {}
}

function logCalories() {
  const v = parseFloat(el('cal-input').value);
  if (isNaN(v) || v <= 0) return;
  calLog[todayKey()] = v;
  // Keep only last 30 days
  const keys = Object.keys(calLog).sort().slice(-30);
  calLog = Object.fromEntries(keys.map(k => [k, calLog[k]]));
  saveCalLog();
  if (allData.length) {
    const latest = allData[allData.length - 1];
    renderCalLog(latest);
    renderGoal(latest, allData);
  renderCalLog(latest);
  }
}

function deleteCalEntry(dateKey) {
  delete calLog[dateKey];
  saveCalLog();
  if (allData.length) {
    const latest = allData[allData.length - 1];
    renderCalLog(latest);
    renderGoal(latest, allData);
  }
}

function renderCalLog(latest) {
  const content = el('cal-log-content');
  const body    = el('cal-log-body');
  if (!content || !body) return;

  const entries = Object.entries(calLog).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  if (!entries.length) { content.style.display = 'none'; return; }
  content.style.display = 'block';

  const avg = calAvg();
  const avgBadge = el('cal-avg-badge');
  if (avgBadge) avgBadge.textContent = avg ? Math.round(avg).toLocaleString() + ' kcal' : '—';

  const tdee = calcTDEE(latest)?.tdee || 0;
  body.innerHTML = entries.map(([dateKey, cals]) => {
    const d       = new Date(dateKey + 'T12:00:00');
    const label   = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const deficit = tdee ? Math.round(tdee - cals) : null;
    const defHtml = deficit != null
      ? deficit > 0
        ? `<span style="color:#2a8703;font-weight:600">−${deficit.toLocaleString()}</span>`
        : `<span style="color:#ea1100;font-weight:600">+${Math.abs(deficit).toLocaleString()} surplus</span>`
      : '—';
    const isToday = dateKey === todayKey();
    return `<tr class="${isToday ? 'today-row' : ''}">
      <td>${label}${isToday ? ' <span style="font-size:0.65rem;color:#0053e2">(today)</span>' : ''}</td>
      <td>${Math.round(cals).toLocaleString()} kcal</td>
      <td>${defHtml}</td>
      <td><button class="cal-log-delete" onclick="deleteCalEntry('${dateKey}')" aria-label="Delete">&#x2715;</button></td>
    </tr>`;
  }).join('');
}
window.setGoal   = setGoal;
window.clearGoal = clearGoal;

// ── Master render ───────────────────────────────────────────────────────
function renderAll() {
  if (!allData.length) return;
  const latest = allData[allData.length - 1];
  const prev   = allData.length > 1 ? allData[allData.length - 2] : null;

  // Header meta
  setText('last-updated', `${fmtDate(latest.date)} · ${fmtTime(latest.date)}`);
  const todayCount = allData.filter(r => r.date.toDateString() === latest.date.toDateString()).length;
  setText('readings-count', `${todayCount} reading${todayCount !== 1 ? 's' : ''} today · ${allData.length} total`);

  renderTrendHero(allData);
  renderMilestones(latest, allData);
  renderBMITimeline(allData, latest);
  renderKPIs(latest, prev);
  renderJourney(latest, allData);
  renderStreak(allData);
  renderCalories(latest);
  renderWeightChart(allData);
  renderCompositionCharts(allData);
  renderWoW(allData);
  renderGoal(latest, allData);

  // Save to localStorage
  try { localStorage.setItem('wt_v2_data', JSON.stringify(allData)); } catch {}
}

// ── Data loading ────────────────────────────────────────────────────────
async function loadData() {
  try {
    const resp = await fetch(DATA_URL + '?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const raw = await resp.json();
    if (!raw.length) throw new Error('empty');
    allData = raw
      .map(r => ({ ...r, date: parseDate(r.date) }))
      .filter(r => r.date && r.weight)
      .sort((a, b) => a.date - b.date);
    renderAll();
    return true;
  } catch (e) {
    console.warn('Fetch failed:', e.message);
    return false;
  }
}

async function init() {
  loadDark();
  restoreTab();
  loadActivityLevel();
  loadGoal();
  loadCalLog();
  const ok = await loadData();
  if (!ok) {
    // Fall back to cached localStorage data
    try {
      const saved = localStorage.getItem('wt_v2_data');
      if (saved) {
        allData = JSON.parse(saved).map(r => ({ ...r, date: new Date(r.date) })).filter(r => r.weight);
        renderAll();
        el('status-bar').textContent = '⚠ Showing cached data — live fetch failed';
        el('status-bar').style.display = 'block';
      }
    } catch {}
  }
}

init();
setInterval(loadData, REFRESH_MS);
