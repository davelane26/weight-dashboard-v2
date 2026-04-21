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
const TABS = ['weight', 'glucose', 'activity', 'projector', 'medication'];
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
  // When switching to the weight tab, fully re-render the charts.
  // resize() alone isn't enough — if renderAll() fired while the tab
  // was hidden (e.g. the 30s interval refresh), Chart.js created new
  // instances into 0px canvases. A fresh render into the now-visible
  // panel is the only reliable fix.
  if (name === 'weight') {
    setTimeout(() => {
      if (allData.length) {
        renderWeightChart(allData);
      }
    }, 0);
  }
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
  if (name === 'medication') {
    setTimeout(() => {
      if (window.medChartInst) window.medChartInst.resize();
      else if (typeof initMedication === 'function') initMedication();
    }, 50);
  }
  document.querySelectorAll('.mob-tab').forEach(b => b.classList.remove('active'));
  const mobBtn = document.querySelector(`.mob-tab[data-tab="${name}"]`);
  if (mobBtn) mobBtn.classList.add('active');
}
function restoreTab() {
  const saved = localStorage.getItem('wt_v2_tab');
  if (saved && TABS.includes(saved)) switchTab(saved);
}

// ── Tab drag-to-reorder ─────────────────────────────────────────────────
const TAB_ORDER_KEY = 'wt_v2_tab_order';

function saveTabOrder() {
  const nav = document.querySelector('.tab-nav');
  if (!nav) return;
  const order = [...nav.querySelectorAll('[id^="tab-btn-"]')]
    .map(b => b.id.replace('tab-btn-', ''));
  localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order));
}

function restoreTabOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || 'null');
    if (!Array.isArray(saved) || !saved.length) return;
    const nav = document.querySelector('.tab-nav');
    if (!nav) return;
    // appendChild moves existing nodes — cheap reorder with no cloning
    saved.forEach(name => {
      const btn = document.getElementById('tab-btn-' + name);
      if (btn) nav.appendChild(btn);
    });
  } catch(e) { /* bad stored data, ignore */ }
}

function initTabDrag() {
  const nav = document.querySelector('.tab-nav');
  if (!nav) return;
  let dragSrc = null;

  nav.addEventListener('dragstart', e => {
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (!btn) return;
    dragSrc = btn;
    btn.classList.add('tab-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', btn.id);
  });

  nav.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (!btn || btn === dragSrc) return;
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    const mid = btn.getBoundingClientRect().left + btn.getBoundingClientRect().width / 2;
    btn.classList.add(e.clientX < mid ? 'tab-drag-over-left' : 'tab-drag-over-right');
  });

  nav.addEventListener('dragleave', e => {
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (btn) btn.classList.remove('tab-drag-over-left', 'tab-drag-over-right');
  });

  nav.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('[id^="tab-btn-"]');
    if (!target || target === dragSrc) return;
    const mid = target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
    nav.insertBefore(dragSrc, e.clientX < mid ? target : target.nextSibling);
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    saveTabOrder();
  });

  nav.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('tab-dragging');
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    dragSrc = null;
  });
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
  // Bug 1 fix: theme change must never disturb active tab state
  const currentTab = localStorage.getItem('wt_v2_tab') || 'weight';
  if (TABS.includes(currentTab)) switchTab(currentTab);
}

// ── State ──────────────────────────────────────────────────────────
let allData            = [];
let goalWeight         = null;
let charts             = {};
let chartRange         = 'all';
let activityLevel      = 'moderate';
// Projection calculator — updated by renderJourney on every data load
let projSlopeLbsPerDay = null;   // negative = losing weight
let projLatestWeight   = null;
let projLatestDate     = null;

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
    // Progress bar gradient: red → amber → yellow → green as journey advances
    // We scale the gradient so the colour at the leading edge always matches progress
    const pctSafe = Math.max(1, pct);
    bar.style.background = `linear-gradient(
      90deg,
      #ea1100 0%,
      #ffc220 ${Math.min(100, (50 / pctSafe) * 100)}%,
      #2a8703 ${Math.min(100, (100 / pctSafe) * 100)}%
    )`;
  }
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);

  // Rate of loss — use overall average from journey start to latest reading.
  // This gives the true sustained rate across the entire journey, not skewed
  // by a hot or cold 30-day window.
  const slopePerDay = weightTrendSlope(data);
  // Expose to projection calculator — updated every data refresh
  projSlopeLbsPerDay = slopePerDay;
  projLatestWeight   = latest.weight;
  projLatestDate     = latest.date;

  // Initialise slider bounds now that we know the current weight
  const slider = document.getElementById('proj-weight-input');
  if (slider) {
    const maxVal = Math.floor(projLatestWeight) - 1;
    slider.max   = maxVal;
    const maxLbl = document.getElementById('proj-slider-max');
    if (maxLbl) maxLbl.textContent = maxVal;
    // Clamp the current slider value if it crept above the new max
    if (parseFloat(slider.value) >= projLatestWeight) {
      slider.value = goalWeight && goalWeight < projLatestWeight
        ? goalWeight
        : Math.round(projLatestWeight - 20);
    }
    const disp = document.getElementById('proj-slider-display');
    if (disp) disp.textContent = parseFloat(slider.value).toFixed(1);
  }

  // Update projector blurb with current trend rate
  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb) {
    if (slopePerDay !== null) {
      const wkRate = Math.abs(slopePerDay * 7).toFixed(1);
      const dir    = slopePerDay < 0 ? 'losing' : 'gaining';
      blurb.textContent = `Based on your 30-day trend — currently ${dir} ~${wkRate} lbs/week`;
    } else {
      blurb.textContent = 'Not enough data yet for a trend (need ~30 days of readings)';
    }
  }

  // ── Avg rate: total loss from START_WEIGHT ÷ total elapsed days ──
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = (latest.date - startDate) / 86400000;
  const totalLostJourney = START_WEIGHT - latest.weight;

  if (totalDaysElapsed > 0 && totalLostJourney > 0) {
    const lbsPerWeek = (totalLostJourney / totalDaysElapsed) * 7;
    countUp('journey-rate', lbsPerWeek, 1);
    const weeksElapsed = Math.floor(totalDaysElapsed / 7);
    setText('journey-rate-sub', `lbs/wk · overall avg across ${weeksElapsed} weeks`);
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
  computeBestWeek(data);
  // Refresh projector if user already has inputs filled
  computeProjection();
}

function toggleWeightTrend() {
  const body    = document.getElementById('weight-trend-body');
  const chevron = document.getElementById('weight-trend-chevron');
  const toggle  = document.getElementById('weight-trend-toggle');
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  body.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
  if (isOpen === false && typeof renderWeightChart === 'function' && allData.length) {
    setTimeout(() => renderWeightChart(allData), 0);
  }
}

function toggleMilestones() {
  const row     = document.getElementById('milestones-row');
  const chevron = document.getElementById('milestones-chevron');
  const toggle  = document.getElementById('milestones-toggle');
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  row.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
}

function toggleBMI() {
  const timeline = document.getElementById('bmi-timeline');
  const chevron  = document.getElementById('bmi-chevron');
  const toggle   = document.getElementById('bmi-toggle');
  const isOpen   = toggle.getAttribute('aria-expanded') === 'true';
  timeline.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
}

function computeBestWeek(readings) {
  const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let bestLoss = -Infinity;
  let bestStart = null, bestEnd = null;

  for (let i = 0; i < readings.length; i++) {
    const end = readings[i];
    // Find the reading closest to 7 days before this one
    const target = end.date.getTime() - 7 * 86400000;
    let closest = null;
    for (let j = i - 1; j >= 0; j--) {
      const diff = Math.abs(readings[j].date.getTime() - target);
      if (!closest || diff < Math.abs(readings[j + 1 <= i - 1 ? j + 1 : j].date.getTime() - target)) {
        closest = readings[j];
        if (readings[j].date.getTime() <= target) break;
      }
    }
    if (!closest) continue;
    const daySpan = (end.date - closest.date) / 86400000;
    if (daySpan < 4 || daySpan > 10) continue;
    const loss = closest.weight - end.weight;
    if (loss > bestLoss) {
      bestLoss = loss;
      bestStart = closest.date;
      bestEnd = end.date;
    }
  }

  if (bestStart && bestLoss > 0) {
    setText('best-week-loss', '−' + bestLoss.toFixed(1) + ' lbs');
    setText('best-week-dates', fmtShort(bestStart) + ' – ' + fmtShort(bestEnd));
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

  // Decade badge: e.g. "You're in the 280s!"
  const badge = el('decade-badge');
  if (badge && trend != null) {
    const decade = Math.floor(trend / 10) * 10;
    badge.style.display = 'block';
    badge.innerHTML = `You're in the<br><strong>${decade}s!</strong>`;
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


// ── Weekly stats ─────────────────────────────────────────────────────────
function renderWeeklyStats(data) {
  if (data.length < 2) return;

  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  const nowMs  = new Date(sorted[0].date).getTime();
  const DAY    = 24 * 60 * 60 * 1000;
  const avg    = arr => arr.reduce((s, r) => s + r.weight, 0) / arr.length;

  // ── 7-day average comparison ──
  const thisWeek = sorted.filter(r => (nowMs - new Date(r.date).getTime()) < 7 * DAY);
  const lastWeek = sorted.filter(r => {
    const ago = nowMs - new Date(r.date).getTime();
    return ago >= 7 * DAY && ago < 14 * DAY;
  });
  const avgCard = el('weekly-avg-card');
  if (avgCard) {
    if (thisWeek.length && lastWeek.length) {
      const thisAvg = avg(thisWeek);
      const lastAvg = avg(lastWeek);
      const diff    = thisAvg - lastAvg;
      const color   = diff <= 0 ? '#2a8703' : '#ea1100';
      const icon    = diff <= 0 ? '▼' : '▲';
      avgCard.innerHTML = `
        <p class="kpi-label" style="color:#0053e2">📊 7-Day Avg vs Last Week</p>
        <p class="kpi-value" style="color:${color}">${icon} ${fmt(Math.abs(diff))}</p>
        <p class="kpi-unit">lbs difference</p>
        <p class="kpi-sub">${fmt(lastAvg)} last wk → ${fmt(thisAvg)} this wk</p>
      `;
    } else {
      avgCard.innerHTML = `
        <p class="kpi-label" style="color:#0053e2">📊 7-Day Avg vs Last Week</p>
        <p class="kpi-value" style="color:#c5c9d5">—</p>
        <p class="kpi-sub">Not enough data</p>
      `;
    }
  }

  // ── Rolling 7-day (latest vs closest reading 7 days ago) ──
  const latest   = sorted[0];
  const latestMs = new Date(latest.date).getTime();
  const target7  = latestMs - 7 * DAY;
  const ref7     = sorted.slice(1).reduce((best, r) => {
    const d = new Date(r.date).getTime();
    return Math.abs(d - target7) < Math.abs(new Date(best.date).getTime() - target7) ? r : best;
  }, sorted[sorted.length - 1]);

  const r7Card = el('rolling7-card');
  if (r7Card) {
    const diff7  = latest.weight - ref7.weight;
    const color7 = diff7 <= 0 ? '#2a8703' : '#ea1100';
    const icon7  = diff7 <= 0 ? '▼' : '▲';
    r7Card.innerHTML = `
      <p class="kpi-label" style="color:#7c3aed">📅 Rolling 7-Day</p>
      <p class="kpi-value" style="color:${color7}">${icon7} ${fmt(Math.abs(diff7))}</p>
      <p class="kpi-unit">lbs difference</p>
      <p class="kpi-sub">${fmtDate(new Date(ref7.date))} ${fmt(ref7.weight)} → ${fmtDate(new Date(latest.date))} ${fmt(latest.weight)}</p>
    `;
  }
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

  // Use overall journey average for a stable, realistic ETA
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = (latest.date - startDate) / 86400000;
  const totalLostJourney = START_WEIGHT - latest.weight;

  if (totalDaysElapsed > 0 && totalLostJourney > 0) {
    const lbsPerDay   = totalLostJourney / totalDaysElapsed;
    const daysLeft    = remaining / lbsPerDay;
    const projDate    = new Date(latest.date.getTime() + daysLeft * 86400000);
    const weeklyRate  = lbsPerDay * 7;
    setText('goal-eta',
      `losing ~${weeklyRate.toFixed(1)} lbs/wk avg · projected ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
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
function calAvg() { return null; } // stub — calorie logger removed
window.setGoal   = setGoal;
window.clearGoal = clearGoal;
window.setRange  = setRange;

// ── Monthly Summary

// ── Weight Projector ────────────────────────────────────────────────────
function computeProjection() {
  const dateInput   = document.getElementById('proj-date-input');
  const weightInput = document.getElementById('proj-weight-input');
  const dateResult  = document.getElementById('proj-date-result');
  const weightResult= document.getElementById('proj-weight-result');

  const noTrend = () => {
    if (dateResult)   dateResult.textContent   = 'Need more data (< 30 days of readings)';
    if (weightResult) weightResult.textContent = 'Need more data (< 30 days of readings)';
  };

  if (!projSlopeLbsPerDay || !projLatestWeight || !projLatestDate) {
    noTrend(); return;
  }

  const MS_PER_DAY = 86_400_000;

  // ── Date → Projected weight ───────────────────────────────────
  if (dateInput && dateResult) {
    const targetDate = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : null;
    if (!targetDate || isNaN(targetDate)) {
      dateResult.textContent = 'Pick a date above';
    } else {
      const daysDiff    = (targetDate - projLatestDate) / MS_PER_DAY;
      const projected   = projLatestWeight + projSlopeLbsPerDay * daysDiff;
      const isFuture    = daysDiff > 0;
      const rounded     = Math.round(projected * 10) / 10;
      if (!isFuture) {
        dateResult.textContent = 'Pick a future date';
      } else if (rounded < 100) {
        dateResult.textContent = "Way beyond goal — you'd be a ghost 👻";
      } else {
        const dateLabel  = targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const lostNow    = projLatestWeight - rounded;          // change from current
        const lostTotal  = START_WEIGHT - rounded;              // total from 315.0
        const lostNowStr = lostNow > 0
          ? `▼ ${fmt(lostNow)} lbs from now`
          : `▲ ${fmt(Math.abs(lostNow))} lbs from now`;
        dateResult.textContent = `~${fmt(rounded)} lbs on ${dateLabel} · ${lostNowStr} · ✅ ${fmt(lostTotal)} lbs lost from ${START_WEIGHT}`;
        dateResult.style.color = lostNow > 0 ? '#2a8703' : '#ea1100';
      }
    }
  }

  // ── Weight slider → Projected date + countdown card ────────────────
  if (weightInput && weightResult) {
    const targetW   = parseFloat(weightInput.value);
    const disp      = document.getElementById('proj-slider-display');
    const countdown = document.getElementById('proj-countdown');

    if (disp) disp.textContent = isNaN(targetW) ? '—' : targetW.toFixed(1);

    const hide = (msg, color = '#ea1100') => {
      if (countdown) countdown.style.display = 'none';
      weightResult.textContent  = msg;
      weightResult.style.color  = color;
    };

    if (isNaN(targetW)) {
      hide('', '#6d7a95');
    } else if (targetW >= projLatestWeight) {
      hide('Slide below your current weight');
    } else if (projSlopeLbsPerDay >= 0) {
      hide('Trend is flat or gaining — projection unavailable');
    } else {
      const daysNeeded = (projLatestWeight - targetW) / Math.abs(projSlopeLbsPerDay);
      const arrivalDate = new Date(projLatestDate.getTime() + daysNeeded * MS_PER_DAY);
      const dateLabel   = arrivalDate.toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' });
      const daysRounded = Math.round(daysNeeded);
      const totalLost   = START_WEIGHT - targetW;
      const stillToGo   = projLatestWeight - targetW;

      if (countdown) {
        countdown.style.display = 'block';
        document.getElementById('proj-cd-date').textContent  = dateLabel;
        document.getElementById('proj-cd-days').textContent  =
          `${daysRounded} day${daysRounded !== 1 ? 's' : ''}`;
        document.getElementById('proj-cd-total').textContent =
          `${fmt(totalLost)} lbs from ${START_WEIGHT}`;
        document.getElementById('proj-cd-togo').textContent  =
          `${fmt(stillToGo)} lbs`;
      }
      weightResult.textContent = '';
    }
  }
}
window.computeProjection = computeProjection;

// ── Master render
function renderAll() {
  if (!allData.length) return;
  const latest = allData[allData.length - 1];
  const prev   = allData.length > 1 ? allData[allData.length - 2] : null;

  // Header meta
  setText('last-updated', `${fmtDate(latest.date)} · ${fmtTime(latest.date)}`);
  const todayStr    = new Date().toDateString();
  const todayCount  = allData.filter(r => r.date.toDateString() === todayStr).length;
  const countLabel  = todayCount > 0
    ? `${todayCount} reading${todayCount !== 1 ? 's' : ''} today · ${allData.length} total`
    : `no readings yet today · ${allData.length} total`;
  setText('readings-count', countLabel);

  renderTrendHero(allData);
  renderMilestones(latest, allData);
  renderBMITimeline(allData, latest);
  renderKPIs(latest, prev);
  renderJourney(latest, allData);
  renderStreak(allData);
  renderCalories(latest);
  renderWeightChart(allData);
  renderWeeklyStats(allData);
  renderGoal(latest, allData);

  updateSnapshot();
  generateInsights();

  // Save to localStorage
  try { localStorage.setItem('wt_v2_data', JSON.stringify(allData)); } catch {}
}

function updateSnapshot() {
  // Weight
  const setSnap = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls) { el.className = 'snap-delta ' + cls; }
  };

  if (allData.length) {
    const latest = allData[allData.length - 1];
    setSnap('snap-weight', latest.weight.toFixed(1) + ' lbs');
    const sevenDaysAgo = new Date(latest.date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const older = allData.slice().reverse().find(r => r.date <= sevenDaysAgo);
    if (older) {
      const delta = latest.weight - older.weight;
      const sign = delta > 0 ? '+' : '';
      setSnap('snap-weight-delta', sign + delta.toFixed(1) + ' lbs vs 7d ago', delta < 0 ? 'good' : delta > 0 ? 'bad' : 'neutral');
    } else {
      setSnap('snap-weight-delta', 'no 7d comparison', 'neutral');
    }
  }

  // Glucose
  const g = window.snapGlucoseNow;
  if (g != null) {
    setSnap('snap-glucose', g + ' mg/dL');
    const inRange = g >= 70 && g <= 180;
    setSnap('snap-glucose-delta', inRange ? 'in range' : 'out of range', inRange ? 'good' : 'bad');
  }

  // Steps & Sleep
  const act = window.snapActivityNow;
  if (act) {
    setSnap('snap-steps', act.steps.toLocaleString());
    const pct = Math.round((act.steps / 10000) * 100);
    setSnap('snap-steps-delta', pct + '% of 10k goal', pct >= 80 ? 'good' : 'bad');

    if (act.sleepHours) {
      const h = Math.floor(act.sleepHours);
      const m = Math.round((act.sleepHours - h) * 60);
      setSnap('snap-sleep', m > 0 ? h + 'h ' + m + 'm' : h + 'h');
    } else {
      setSnap('snap-sleep', '—');
    }
    if (act.sleepScore != null) {
      setSnap('snap-sleep-delta', 'score ' + act.sleepScore, act.sleepScore >= 70 ? 'good' : 'bad');
    } else {
      setSnap('snap-sleep-delta', '—', 'neutral');
    }
  }
}

function generateInsights() {
  const list  = document.getElementById('insights-list');
  const empty = document.getElementById('insights-empty');
  if (!list || !empty) return;

  list.innerHTML = '';
  const rows = [];

  const addInsight = (text, color) => {
    const row = document.createElement('div');
    row.className = 'insight-row';
    const dot = document.createElement('span');
    dot.className = 'insight-dot';
    dot.style.background = color;
    const span = document.createElement('span');
    span.textContent = text;
    row.appendChild(dot);
    row.appendChild(span);
    rows.push(row);
  };

  // Helper: get the ISO week key for a date (Mon-based)
  const weekKey = d => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };

  const days = window.snapActivityDays || [];

  // ── Check 1: Sleep score vs weight loss ──────────────────────────
  if (allData.length >= 28 && days.length >= 6) {
    const weightByWeek = {};
    allData.forEach(r => {
      const k = weekKey(r.date);
      if (!weightByWeek[k]) weightByWeek[k] = [];
      weightByWeek[k].push(r.weight);
    });

    const sleepByWeek = {};
    days.forEach(d => {
      if (d.sleepScore == null) return;
      const k = weekKey(new Date(d.date || d.lastUpdated || d.updatedAt));
      if (!sleepByWeek[k]) sleepByWeek[k] = [];
      sleepByWeek[k].push(d.sleepScore);
    });

    const weeks = Object.keys(weightByWeek).filter(k => sleepByWeek[k] && weightByWeek[k].length >= 2);
    const weekData = weeks.map(k => {
      const ws = weightByWeek[k];
      const loss = ws[0] - ws[ws.length - 1];
      const avgSleep = sleepByWeek[k].reduce((a, b) => a + b, 0) / sleepByWeek[k].length;
      return { loss, avgSleep };
    });

    const high = weekData.filter(w => w.avgSleep > 75);
    const low  = weekData.filter(w => w.avgSleep <= 75);
    if (high.length >= 3 && low.length >= 3) {
      const avgHigh = high.reduce((a, b) => a + b.loss, 0) / high.length;
      const avgLow  = low.reduce((a, b) => a + b.loss, 0) / low.length;
      const diff = avgHigh - avgLow;
      if (diff > 0.3) {
        addInsight(
          `On weeks where sleep score averaged above 75, you lost ${diff.toFixed(1)} lbs more than on lower-sleep weeks.`,
          '#2a8703'
        );
      }
    }
  }

  // ── Check 2: Stress vs glucose ───────────────────────────────────
  if (days.length >= 10 && window.snapGlucoseNow != null) {
    const stressDays = days.filter(d => d.stressLevel != null && d.sleepScore != null);
    const high = stressDays.filter(d => d.stressLevel > 60);
    const low  = stressDays.filter(d => d.stressLevel <= 60);
    if (high.length >= 5 && low.length >= 5) {
      const avgHigh = high.reduce((a, b) => a + (b.avgGlucose || b.glucose || 0), 0) / high.length;
      const avgLow  = low.reduce((a, b) => a + (b.avgGlucose || b.glucose || 0), 0) / low.length;
      const diff = avgHigh - avgLow;
      if (diff > 10) {
        addInsight(
          `High-stress days show glucose averaging ${Math.round(diff)} mg/dL higher.`,
          '#995213'
        );
      }
    }
  }

  // ── Check 3: Steps vs weight loss ───────────────────────────────
  if (allData.length >= 14 && days.length >= 4) {
    const stepsByWeek = {};
    days.forEach(d => {
      if (!d.steps) return;
      const k = weekKey(new Date(d.date || d.lastUpdated || d.updatedAt));
      if (!stepsByWeek[k]) stepsByWeek[k] = 0;
      stepsByWeek[k] += d.steps;
    });

    const weightByWeek2 = {};
    allData.forEach(r => {
      const k = weekKey(r.date);
      if (!weightByWeek2[k]) weightByWeek2[k] = [];
      weightByWeek2[k].push(r.weight);
    });

    const weeks = Object.keys(stepsByWeek).filter(k => weightByWeek2[k] && weightByWeek2[k].length >= 2);
    const weekData = weeks.map(k => {
      const ws = weightByWeek2[k];
      return { loss: ws[0] - ws[ws.length - 1], steps: stepsByWeek[k] };
    });

    const active   = weekData.filter(w => w.steps >= 60000);
    const inactive = weekData.filter(w => w.steps < 60000);
    if (active.length >= 2 && inactive.length >= 2) {
      const avgActive   = active.reduce((a, b) => a + b.loss, 0) / active.length;
      const avgInactive = inactive.reduce((a, b) => a + b.loss, 0) / inactive.length;
      const diff = avgActive - avgInactive;
      if (diff > 0.2) {
        addInsight(
          `Weeks with 60,000+ steps show faster weight loss (${diff.toFixed(1)} lbs/week more on average).`,
          '#0053e2'
        );
      }
    }
  }

  rows.forEach(r => list.appendChild(r));
  empty.style.display = rows.length > 0 ? 'none' : '';
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
  restoreTabOrder();
  initTabDrag();
  loadDark();
  loadActivityLevel();
  loadGoal();
  // Load data FIRST while the weight tab is still visible so Chart.js
  // can measure the canvas at its real size. Switch to the saved tab
  // only after the initial render is done.
  const ok = await loadData();
  restoreTab(); // ← charts are already drawn at correct dimensions
  if (!ok) {
    // Fall back to cached localStorage data
    try {
      const saved = localStorage.getItem('wt_v2_data');
      if (saved) {
        allData = JSON.parse(saved).map(r => ({ ...r, date: new Date(r.date) })).filter(r => r.weight);
        renderAll();
        restoreTab(); // ← same here
        el('status-bar').textContent = '⚠ Showing cached data — live fetch failed';
        el('status-bar').style.display = 'block';
      }
    } catch {}
  }
}

init();
setInterval(loadData, REFRESH_MS);
