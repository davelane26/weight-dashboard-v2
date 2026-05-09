/* ════════════════════════════════════════════════════════════════════
   charts-tab.js — dose-phase-colored weight chart tab
   ──────────────────────────────────────────────────────────────────── */

window.chartsTabInst = {};

const CT_PHASE_COLORS = ['#9ca3af', '#7c3aed', '#3b82f6', '#a855f7', '#10b981', '#f59e0b'];

function ctLoadMedData() {
  try {
    const raw = localStorage.getItem('mj_journey_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.phases) && parsed.phases.length) return parsed;
    }
  } catch(e) {}
  return {
    startDate: '2026-01-29',
    phases: [
      { dose: 2.5, weightStart: 315, weightEnd: 296 },
      { dose: 5.0, weightStart: 296, weightEnd: 287 },
      { dose: 5.0, weightStart: 287, weightEnd: null },
    ],
  };
}

function renderChartsTab(data) {
  if (!data || !data.length) return;

  // ── Stat cards ────────────────────────────────────────────────────
  const sorted     = [...data].sort((a, b) => a.date - b.date);
  const latest     = sorted[sorted.length - 1];
  const totalLost  = START_WEIGHT - latest.weight;
  const pctLost    = ((totalLost / START_WEIGHT) * 100).toFixed(1);

  const fourWeeksAgo = new Date(Date.now() - 28 * 86400000);
  const recent = sorted.filter(r => r.date >= fourWeeksAgo);
  let weeklyAvg = '—';
  if (recent.length >= 2) {
    const diff  = recent[0].weight - recent[recent.length - 1].weight;
    const weeks = (recent[recent.length - 1].date - recent[0].date) / (7 * 86400000);
    if (weeks > 0) weeklyAvg = (diff / weeks).toFixed(1);
  }

  const toGoal  = goalWeight ? (latest.weight - goalWeight).toFixed(1) : null;
  const goalPct = goalWeight ? (((START_WEIGHT - latest.weight) / (START_WEIGHT - goalWeight)) * 100).toFixed(0) : null;

  const ctSet = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  ctSet('ct-total-lost', `-${totalLost.toFixed(1)} lbs`);
  ctSet('ct-bmi',        latest.bmi ? latest.bmi.toFixed(1) : '—');
  ctSet('ct-weight',     latest.weight.toFixed(1) + ' lbs');
  ctSet('ct-pct',        `-${pctLost}%`);
  ctSet('ct-weekly-avg', weeklyAvg !== '—' ? `-${weeklyAvg} lbs/wk` : '—');
  ctSet('ct-to-goal',    toGoal !== null ? `${toGoal} lbs (${goalPct}%)` : 'No goal set');

  // ── Build phase-colored datasets ──────────────────────────────────
  if (window.chartsTabInst.main) { window.chartsTabInst.main.destroy(); window.chartsTabInst.main = null; }
  const canvas = document.getElementById('ct-mainChart');
  if (!canvas) return;

  const med      = ctLoadMedData();
  const phases   = med.phases;
  const medStart = new Date(med.startDate || '2026-01-29');

  const readings = sorted.filter(r => r.date >= medStart);
  if (!readings.length) return;

  // Assign phase index — forward-only, never go back
  let pIdx = 0;
  const assigned = [];
  for (const r of readings) {
    while (pIdx < phases.length - 1) {
      const end = phases[pIdx].weightEnd;
      if (end !== null && r.weight <= end) { pIdx++; } else break;
    }
    assigned.push({ ...r, pIdx });
  }

  const allLabels = assigned.map(r => fmtDate(r.date));
  const datasets  = [];
  const badges    = [];

  phases.forEach((p, pi) => {
    const color = CT_PHASE_COLORS[pi % CT_PHASE_COLORS.length];
    const pts = assigned.map((r, i) => {
      if (r.pIdx === pi) return r.weight;
      // Include first point of next phase so lines connect at boundary
      if (r.pIdx === pi + 1 && i > 0 && assigned[i - 1].pIdx === pi) return r.weight;
      return null;
    });
    datasets.push({
      label: `${p.dose}mg`,
      data: pts,
      borderColor: color,
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.2,
      pointRadius: 4,
      pointBackgroundColor: color,
      pointBorderColor: '#0f172a',
      pointBorderWidth: 1.5,
      borderWidth: 2.5,
      spanGaps: false,
    });
    const firstIdx = assigned.findIndex(r => r.pIdx === pi);
    if (firstIdx >= 0) badges.push({ idx: firstIdx, weight: assigned[firstIdx].weight, dose: p.dose, color });
  });

  // Plugin: draw dose pill badges directly on canvas
  const badgePlugin = {
    id: 'doseBadges',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      if (!scales.x || !scales.y) return;
      badges.forEach(b => {
        const x = scales.x.getPixelForValue(b.idx);
        const y = scales.y.getPixelForValue(b.weight);
        const label = `${b.dose}mg`;
        ctx.save();
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const pw = tw + 16, ph = 20;
        const px = x - pw / 2, py = y - 34;
        // Pill background
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(px, py, pw, ph, 8);
        } else {
          const r2 = 8;
          ctx.moveTo(px + r2, py);
          ctx.lineTo(px + pw - r2, py); ctx.quadraticCurveTo(px + pw, py, px + pw, py + r2);
          ctx.lineTo(px + pw, py + ph - r2); ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r2, py + ph);
          ctx.lineTo(px + r2, py + ph); ctx.quadraticCurveTo(px, py + ph, px, py + ph - r2);
          ctx.lineTo(px, py + r2); ctx.quadraticCurveTo(px, py, px + r2, py);
          ctx.closePath();
        }
        ctx.fillStyle = b.color;
        ctx.fill();
        // Connector line to point
        ctx.beginPath();
        ctx.moveTo(x, py + ph);
        ctx.lineTo(x, y - 6);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Label text
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, py + ph / 2);
        ctx.restore();
      });
    },
  };

  window.chartsTabInst.main = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: allLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 44, right: 8, bottom: 8, left: 8 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 18, padding: 12 },
        },
        tooltip: {
          backgroundColor: '#1e293b', padding: 12, cornerRadius: 10,
          titleColor: '#f1f5f9', bodyColor: '#94a3b8',
          callbacks: { label: c => c.parsed.y !== null ? ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} lbs` : null },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
          grid: { color: 'rgba(255,255,255,0.06)', borderDash: [4, 4] },
          border: { display: false },
        },
        y: {
          position: 'right',
          ticks: { color: '#64748b', font: { size: 11 }, callback: v => v + ' lbs' },
          grid: { color: 'rgba(255,255,255,0.06)', borderDash: [4, 4] },
          border: { display: false },
        },
      },
    },
    plugins: [badgePlugin],
  });
}

function setChartsRange(range) {
  chartRange = range;
  document.querySelectorAll('.ct-range-pill').forEach(p => {
    const active = p.dataset.range === range;
    p.style.cssText = active
      ? 'background:#7c3aed;color:#fff;border:1.5px solid #7c3aed;border-radius:6px;padding:0.25rem 0.65rem;font-size:0.75rem;font-weight:700;cursor:pointer'
      : 'background:#1e293b;color:#64748b;border:1.5px solid #334155;border-radius:6px;padding:0.25rem 0.65rem;font-size:0.75rem;font-weight:700;cursor:pointer';
  });
  if (allData.length) renderChartsTab(allData);
}
window.setChartsRange = setChartsRange;
