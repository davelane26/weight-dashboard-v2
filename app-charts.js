/* ════════════════════════════════════════════════════════════════════
   app-charts.js — main weight chart + weekly stats cards
   ──────────────────────────────────────────────────────────────────── */

// ── Render weight chart ──────────────────────────────────────────────
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

// ── Weekly stats cards (7-day avg + rolling 7-day) ───────────────────
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
