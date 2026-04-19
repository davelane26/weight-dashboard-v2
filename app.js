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
  if (name === 'weight') {
    setTimeout(() => {
      if (allData.length) {
        renderWeightChart(allData);
        renderCompositionCharts(allData);
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
}
function restoreTab() {
  const saved = localStorage.getItem('wt_v2_tab');
  if (saved && TABS.includes(saved)) switchTab(saved);
}

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
    saved.forEach(name => {
      const btn = document.getElementById('tab-btn-' + name);
      if (btn) nav.appendChild(btn);
    });
  } catch(e) {}
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
  const currentTab = localStorage.getItem('wt_v2_tab') || 'weight';
  if (TABS.includes(currentTab)) switchTab(currentTab);
}

let allData            = [];
let goalWeight         = null;
let charts             = {};
let chartRange         = 'all';
let activityLevel      = 'moderate';
let projSlopeLbsPerDay = null;
let projLatestWeight   = null;
let projLatestDate     = null;

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

function fixTz(s) {
  return typeof s === 'string' ? s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : s;
}
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  const d = new Date(fixTz(String(val)));
  return isNaN(d) ? null : d;
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return ['Underweight',  'background:#dbeafe;color:#1d4ed8'];
  if (bmi < 25)   return ['Normal',        'background:#dcfce7;color:#166534'];
  if (bmi < 30)   return ['Overweight',    'background:#fef9c3;color:#854d0e'];
  if (bmi < 35)   return ['Obese I',       'background:#ffedd5;color:#c2410c'];
  if (bmi < 40)   return ['Obese II',      'background:#fee2e2;color:#991b1b'];
  return               ['Obese III',       'background:#fecaca;color:#7f1d1d'];
}

function movingAvg(arr, window = 7) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

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
  return denom === 0 ? null : (n * sxy - sx * sy) / denom;
}

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

function delta(val, lowerIsBetter = true) {
  if (val == null) return '';
  const good = lowerIsBetter ? val <= 0 : val >= 0;
  const arrow = val < 0 ? '▼' : val > 0 ? '▲' : '●';
  const cls   = good ? 'down' : 'up';
  return `<span class="${cls}">${arrow} ${fmt(Math.abs(val))}</span>`;
}

const el      = id => document.getElementById(id);
const setText = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const setHTML = (id, v) => { const e = el(id); if (e) e.innerHTML   = v; };

function countUp(id, target, decimals = 1, suffix = '', duration = 900) {
  const e = el(id);
  const t = +target;
  if (!e || isNaN(t)) return;
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

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

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

function renderJourneyDuration() {
  const start = new Date(START_DATE);
  const now   = new Date();
  const days  = Math.max(0, Math.floor((now - start) / 864e5));
  const weeks = Math.floor(days / 7);
  const months = (days / 30.44).toFixed(1);
  let milestone = '';
  if      (days < 7)   milestone = '🌱 Just getting started!';
  else if (days < 30)  milestone = '🔥 First month coming up!';
  else if (days < 60)  milestone = '💪 Over a month strong!';
  else if (days < 90)  milestone = '🚀 Closing in on 3 months!';
  else if (days < 180) milestone = '⭐ Crushing it!';
  else if (days < 365) milestone = '🏆 Half a year of hard work!';
  else                  milestone = '🎉 Over a year — legendary!';
  setText('journey-duration', `Day ${days} · Week ${weeks} · ${months} months · ${milestone}`);
}

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
    const pctSafe = Math.max(1, pct);
    bar.style.background = `linear-gradient(90deg,#ea1100 0%,#ffc220 ${Math.min(100,(50/pctSafe)*100)}%,#2a8703 ${Math.min(100,(100/pctSafe)*100)}%)`;
  }
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);

  const slopePerDay = weightTrendSlope(data);
  projSlopeLbsPerDay = slopePerDay;
  projLatestWeight   = latest.weight;
  projLatestDate     = latest.date;

  const slider = document.getElementById('proj-weight-input');
  if (slider) {
    const maxVal = Math.floor(projLatestWeight) - 1;
    slider.max   = maxVal;
    const maxLbl = document.getElementById('proj-slider-max');
    if (maxLbl) maxLbl.textContent = maxVal;
    if (parseFloat(slider.value) >= projLatestWeight) {
      slider.value = goalWeight && goalWeight < projLatestWeight ? goalWeight : Math.round(projLatestWeight - 20);
    }
    const disp = document.getElementById('proj-slider-display');
    if (disp) disp.textContent = parseFlo
