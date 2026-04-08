// ── Config ─────────────────────────────────────────────────────────────
const DATA_URL = 'https://davelane26.github.io/Weight-tracker/data.json';
const START_WEIGHT = 315.0;
const START_DATE   = 'Jan 23, 2026';
const REFRESH_MS   = 30_000;

// ── State ──────────────────────────────────────────────────────────────
let allData    = [];
let goalWeight = null;
let charts     = {};

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
  if (bmi < 18.5) return ['Underweight',    'background:#dbeafe;color:#1d4ed8'];
  if (bmi < 25)   return ['Normal',          'background:#dcfce7;color:#166534'];
  if (bmi < 30)   return ['Overweight',      'background:#fef9c3;color:#854d0e'];
  if (bmi < 35)   return ['Class I Obesity', 'background:#ffedd5;color:#c2410c'];
  if (bmi < 40)   return ['Class II Obesity','background:#fee2e2;color:#991b1b'];
  return               ['Class III Obesity', 'background:#fecaca;color:#7f1d1d'];
}

// ── Moving average ──────────────────────────────────────────────────────
function movingAvg(arr, window = 7) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
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
  latest.bmr  ? countUp('kpi-bmr',  latest.bmr,  0) : setText('kpi-bmr',  '—');
  latest.tdee ? countUp('kpi-tdee', latest.tdee, 0) : setText('kpi-tdee', '—');
}

// ── Render journey ──────────────────────────────────────────────────────
function renderJourney(latest) {
  const lost      = Math.max(0, START_WEIGHT - latest.weight);
  const pct       = Math.min(100, Math.max(0, (lost / START_WEIGHT) * 100));

  countUp('journey-current',  latest.weight, 1);
  setText('journey-date',     fmtDate(latest.date));
  countUp('journey-lost',     Math.max(0, START_WEIGHT - latest.weight), 1);
  countUp('journey-pct-stat', Math.min(100, Math.max(0, (lost / START_WEIGHT) * 100)), 1, '%');
  el('journey-bar').style.width = pct + '%';
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);
}

// ── Render streak ───────────────────────────────────────────────────────
function renderStreak(data) {
  const streak = calcStreak(data);
  setText('streak-count', streak);
  setText('streak-label', streak === 1 ? 'day streak 🔥' : 'days in a row 🔥');
  setText('streak-total', data.length + ' total readings');
}

// ── Render calorie insights ─────────────────────────────────────────────
function renderCalories(latest) {
  if (!latest.tdee) return;
  countUp('cal-maintain', latest.tdee,        0);
  countUp('cal-lose1',    latest.tdee - 500,  0);
  countUp('cal-lose2',    latest.tdee - 1000, 0);
}

// ── Render weight chart ─────────────────────────────────────────────────
function renderWeightChart(data) {
  destroyChart('weight');
  const byDay = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
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
          label: '7-day avg',
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
        y: { ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#eee' } },
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
          callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 8 }, grid: { color: '#eee' } },
        y: { ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#eee' } },
      },
    },
  });
}

// ── Render week-over-week table ─────────────────────────────────────────
function renderWoW(data) {
  if (data.length < 2) return;

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

  sorted.forEach((wk, i) => {
    const rs   = wk.rows.sort((a, b) => a.date - b.date);
    const avg  = rs.reduce((s, r) => s + r.weight, 0) / rs.length;
    const min  = Math.min(...rs.map(r => r.weight));
    const max  = Math.max(...rs.map(r => r.weight));
    const fats = rs.filter(r => r.bodyFat).map(r => r.bodyFat);
    const avgFat = fats.length ? fats.reduce((s, v) => s + v, 0) / fats.length : null;
    const weekEnd = new Date(wk.sun); weekEnd.setDate(weekEnd.getDate() + 6);

    // compare avg vs previous week
    const prevAvg  = i > 0 ? sorted[i - 1].rows.reduce((s, r) => s + r.weight, 0) / sorted[i - 1].rows.length : null;
    const diffAvg  = prevAvg != null ? avg - prevAvg : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-weight:600">${fmtDate(wk.sun)}</span><br>
          <span style="font-size:0.65rem;color:#6d7a95">${fmtDate(wk.sun)} – ${fmtDate(weekEnd)}</span></td>
      <td style="text-align:center"><span class="badge" style="background:#eff4ff;color:#0053e2">${rs.length}</span></td>
      <td style="font-weight:700">${fmt(avg)}</td>
      <td>${fmt(min)}</td>
      <td>${fmt(max)}</td>
      <td>${diffAvg != null ? (diffAvg <= 0
          ? `<span class="down">▼ ${fmt(Math.abs(diffAvg))}</span>`
          : `<span class="up">▲ ${fmt(Math.abs(diffAvg))}</span>`)
        : '<span style="color:#c5c9d5">—</span>'}</td>
      <td>${avgFat != null ? fmtPct(avgFat) : '<span style="color:#c5c9d5">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Render goal section ─────────────────────────────────────────────────
function renderGoal(latest) {
  const content = el('goal-content');
  const empty   = el('goal-empty');
  if (!goalWeight) {
    content.style.display = 'none';
    empty.style.display   = 'block';
    return;
  }
  content.style.display = 'block';
  empty.style.display   = 'none';

  const remaining  = Math.max(0, latest.weight - goalWeight);
  const totalToLose = START_WEIGHT - goalWeight;
  const lost        = START_WEIGHT - latest.weight;
  const pct         = totalToLose > 0 ? Math.min(100, Math.max(0, (lost / totalToLose) * 100)) : 0;

  setText('goal-target',    fmt(goalWeight));
  setText('goal-remaining', fmt(remaining));
  setText('goal-pct',       fmt(pct, 0) + '%');
  el('goal-bar').style.width = pct + '%';
  el('goal-bar').textContent = pct >= 10 ? fmt(pct, 0) + '%' : '';

  if (remaining > 0) {
    const weeksLeft = Math.ceil(remaining / 2);
    const estDate   = new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
    setText('goal-eta', `~${weeksLeft} wk${weeksLeft !== 1 ? 's' : ''} at 2 lbs/wk · est. ${fmtDate(estDate)}`);
  } else {
    setText('goal-eta', '🎉 Goal reached!');
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
    renderGoal(allData[allData.length - 1]);
    renderWeightChart(allData);
  }
}
function clearGoal() {
  goalWeight = null;
  el('goal-input').value = '';
  localStorage.removeItem('wt_v2_goal');
  if (allData.length) {
    renderGoal(allData[allData.length - 1]);
    renderWeightChart(allData);
  }
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

  renderKPIs(latest, prev);
  renderJourney(latest);
  renderStreak(allData);
  renderCalories(latest);
  renderWeightChart(allData);
  renderCompositionCharts(allData);
  renderWoW(allData);
  renderGoal(latest);

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
  loadGoal();
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
