/**
 * medication.js — Mounjaro journey tracker
 * Data sourced from MJ journey.xlsx — update PHASES when dose/weight changes.
 */

// ── Journey data ─────────────────────────────────────────────────────────────
const MJ_START   = new Date('2026-01-29');
const MJ_PHASES  = [
  { dose: 2.5,  weightStart: 315, weightEnd: 296 },
  { dose: 5.0,  weightStart: 296, weightEnd: 287 },
  { dose: 5.0,  weightStart: 287, weightEnd: null },  // current — no end yet
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const _mEl  = id => document.getElementById(id);
const _mSet = (id, v) => { const e = _mEl(id); if (e) e.textContent = v; };

function weeksOn() {
  return Math.floor((Date.now() - MJ_START) / (7 * 24 * 60 * 60 * 1000));
}

function currentWeight() {
  // Try to pull from the live weight data already on the page
  const liveEl = _mEl('kpi-weight');
  if (liveEl && liveEl.textContent && !isNaN(parseFloat(liveEl.textContent))) {
    return parseFloat(liveEl.textContent);
  }
  // Fall back to last known from spreadsheet
  const last = MJ_PHASES[MJ_PHASES.length - 1];
  return last.weightEnd ?? last.weightStart;
}

// ── Render KPI cards ──────────────────────────────────────────────────────────
function renderMedKPIs() {
  const startWeight = MJ_PHASES[0].weightStart;
  const curWeight   = currentWeight();
  const totalLost   = +(startWeight - curWeight).toFixed(1);
  const weeks       = weeksOn();
  const avgPerWeek  = weeks > 0 ? +(totalLost / weeks).toFixed(2) : 0;
  const curDose     = MJ_PHASES[MJ_PHASES.length - 1].dose;

  _mSet('med-current-dose',   curDose);
  _mSet('med-start-weight',   startWeight);
  _mSet('med-current-weight', curWeight);
  _mSet('med-total-lost',     totalLost);
  _mSet('med-weeks-on',       weeks);
  _mSet('med-avg-per-week',   avgPerWeek);
}

// ── Render dosage phase timeline ──────────────────────────────────────────────
function renderMedPhases() {
  const container = _mEl('med-phases');
  if (!container) return;

  const startWeight = MJ_PHASES[0].weightStart;
  const curWeight   = currentWeight();

  container.innerHTML = MJ_PHASES.map((phase, i) => {
    const isActive  = phase.weightEnd === null;
    const wStart    = phase.weightStart;
    const wEnd      = isActive ? curWeight : phase.weightEnd;
    const lost      = +(wStart - wEnd).toFixed(1);
    const phasePct  = +((lost / (startWeight - curWeight || 1)) * 100).toFixed(0);
    const label     = isActive ? 'Current' : `Phase ${i + 1}`;
    const color     = isActive ? '#7c3aed' : '#0053e2';
    const bg        = isActive ? '#f5f3ff'  : '#eff4ff';

    return `
      <div style="background:${bg};border:1px solid ${color}22;border-radius:10px;padding:0.8rem 1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="background:${color};color:#fff;font-size:0.7rem;font-weight:800;padding:3px 10px;border-radius:20px">
            ${label}
          </div>
          <div>
            <p style="font-size:1.1rem;font-weight:800;color:${color}">${phase.dose} mg</p>
            <p style="font-size:0.7rem;color:#6d7a95">${wStart} → ${isActive ? curWeight + ' (live)' : wEnd} lbs</p>
          </div>
        </div>
        <div style="text-align:right">
          <p style="font-size:1.3rem;font-weight:900;color:#2a8703">−${lost} lbs</p>
          <p style="font-size:0.7rem;color:#6d7a95">${isActive ? 'so far this phase' : `${phasePct}% of total`}</p>
        </div>
      </div>`;
  }).join('');
}

// ── Render progress chart ─────────────────────────────────────────────────────
let medChartInst = null;
window.medChartInst = null;

function renderMedChart() {
  const canvas = _mEl('medWeightChart');
  if (!canvas) return;

  const curWeight = currentWeight();
  const labels    = MJ_PHASES.map((p, i) => i === MJ_PHASES.length - 1 ? 'Now' : `Phase ${i + 1}\n${p.dose}mg`);
  const weights   = MJ_PHASES.map((p, i) =>
    i === MJ_PHASES.length - 1 ? curWeight : p.weightEnd ?? p.weightStart
  );
  const starts    = MJ_PHASES.map(p => p.weightStart);

  if (medChartInst) { medChartInst.destroy(); medChartInst = null; }

  medChartInst = window.medChartInst = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Weight (lbs)',
          data: weights,
          backgroundColor: weights.map((w, i) =>
            i === weights.length - 1 ? 'rgba(124,58,237,0.8)' : 'rgba(0,83,226,0.7)'
          ),
          borderRadius: 6,
          order: 1,
        },
        {
          label: 'Phase start',
          data: starts,
          type: 'line',
          borderColor: 'rgba(234,17,0,0.4)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 4,
          pointBackgroundColor: '#ea1100',
          fill: false,
          tension: 0,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => ` ${c.dataset.label}: ${c.parsed.y} lbs`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6d7a95', font: { size: 11 } } },
        y: {
          beginAtZero: false,
          min: Math.floor(Math.min(...weights, ...starts) - 5),
          ticks: { color: '#6d7a95', font: { size: 11 }, callback: v => v + ' lbs' },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
      },
    },
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initMedication() {
  renderMedKPIs();
  renderMedPhases();
  renderMedChart();
}

// Run when tab is visible — hook into the existing switchTab flow
document.addEventListener('DOMContentLoaded', () => {
  // Delay slightly so live weight KPI has time to populate
  setTimeout(initMedication, 800);
});
