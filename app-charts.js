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
        annotation: { annotations: buildEventAnnotations(daily) },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 10 }, grid: { color: '#eee' } },
        y: { ticks: { color: '#6d7a95', font: { size: 11 }, callback: v => v + ' lbs' }, grid: { color: '#eee' } },
      },
    },
  });
}

// ── Event-band annotations for the weight chart ───────────────────────
// Maps each context event's date range to translucent vertical bands
// via chartjs-plugin-annotation. Silently returns {} if either the
// events module or the annotation plugin isn't loaded so the chart
// always renders cleanly.
function buildEventAnnotations(daily) {
  if (typeof window.getEventsInRange !== 'function' || !daily.length) return {};
  const firstDate = daily[0].date;
  const lastDate  = daily[daily.length - 1].date;
  const events    = window.getEventsInRange(firstDate, lastDate);
  if (!events.length) return {};

  // Find the chart label (formatted date string) closest to a given date.
  function nearestLabel(target) {
    let best = daily[0];
    let bestDelta = Math.abs(daily[0].date - target);
    for (let i = 1; i < daily.length; i++) {
      const delta = Math.abs(daily[i].date - target);
      if (delta < bestDelta) { best = daily[i]; bestDelta = delta; }
    }
    return fmtDate(best.date);
  }

  const annotations = {};
  events.forEach((e, idx) => {
    const t = (typeof window.getEventTypeByKey === 'function')
      ? window.getEventTypeByKey(e.type)
      : { color: '#6d7a95', label: e.type };
    const start = new Date(e.start);
    const end   = e.end ? new Date(e.end) : new Date();
    const xMin  = nearestLabel(start < firstDate ? firstDate : start);
    const xMax  = nearestLabel(end > lastDate ? lastDate : end);
    annotations['evt' + idx] = {
      type: 'box',
      xMin, xMax,
      backgroundColor: t.color + '22',
      borderColor:     t.color + '55',
      borderWidth:     1,
      label: {
        content:  t.label,
        display:  false,  // tooltip on hover is too noisy here
      },
      drawTime: 'beforeDatasetsDraw',
    };
  });
  return annotations;
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

  // ── Rolling 7-day trend (trailing 5-reading avg now vs ~7 days ago) ──
  // Point-to-point endpoints are noisy: a single low reading ~7 days ago
  // (or a data gap) makes today look like a gain even while the real trend
  // drops. Compare SMOOTHED trailing averages instead.
  const asc = [...sorted].reverse(); // oldest -> newest
  const trailAvg = (cutoffMs) => {
    const upto = asc.filter(r => new Date(r.date).getTime() <= cutoffMs);
    if (!upto.length) return null;
    const last5 = upto.slice(-5);
    return last5.reduce((s, r) => s + r.weight, 0) / last5.length;
  };
  const latest   = sorted[0];
  const latestMs = new Date(latest.date).getTime();
  const nowAvg7  = trailAvg(latestMs);
  const refAvg7  = trailAvg(latestMs - 7 * DAY);

  const r7Card = el('rolling7-card');
  if (r7Card) {
    if (nowAvg7 != null && refAvg7 != null) {
      const diff7  = nowAvg7 - refAvg7;
      const color7 = diff7 <= 0 ? '#2a8703' : '#ea1100';
      const icon7  = diff7 <= 0 ? '▼' : '▲';
      r7Card.innerHTML = `
        <p class="kpi-label" style="color:#7c3aed">Rolling 7-Day (trend)</p>
        <p class="kpi-value" style="color:${color7}">${icon7} ${fmt(Math.abs(diff7))}</p>
        <p class="kpi-unit">lbs difference</p>
        <p class="kpi-sub">${fmt(refAvg7)} → ${fmt(nowAvg7)} (5-day avgs)</p>
      `;
    } else {
      r7Card.innerHTML = `
        <p class="kpi-label" style="color:#7c3aed">Rolling 7-Day (trend)</p>
        <p class="kpi-value" style="color:#c5c9d5">—</p>
        <p class="kpi-sub">Not enough data</p>
      `;
    }
  }
}
