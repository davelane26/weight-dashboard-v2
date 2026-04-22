/**
 * medication.js — Mounjaro journey tracker
 * Data saved in localStorage — edit via the ✏️ Edit button on the tab.
 */

// ── Defaults (used if nothing in localStorage) ────────────────────────────────
const MJ_DEFAULTS = {
  startDate: '2026-01-29',
  phases: [
    { dose: 2.5, weightStart: 315, weightEnd: 296 },
    { dose: 5.0, weightStart: 296, weightEnd: 287 },
    { dose: 5.0, weightStart: 287, weightEnd: null },  // current
  ],
};

const LS_KEY = 'mj_journey_v1';

// ── Load / Save ───────────────────────────────────────────────────────────────
function loadMedData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Guard against corrupted saves: phases must be a non-empty array
      if (Array.isArray(parsed.phases) && parsed.phases.length > 0) return parsed;
    }
  } catch(e) { console.warn('[medication] bad localStorage, using defaults', e); }
  return JSON.parse(JSON.stringify(MJ_DEFAULTS));
}

function persistMedData(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function resetMedData() {
  localStorage.removeItem(LS_KEY);
  if (_mEl('med-edit-panel')) toggleMedEdit();
  renderMedAll();
  showMedToast('Reset to defaults');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _mEl  = id => document.getElementById(id);
const _mSet = (id, v) => { const e = _mEl(id); if (e) e.textContent = v; };

function currentWeight() {
  const liveEl = _mEl('kpi-weight');
  if (liveEl && !isNaN(parseFloat(liveEl.textContent))) return parseFloat(liveEl.textContent);
  const data  = loadMedData();
  const last  = data.phases[data.phases.length - 1];
  return last.weightEnd ?? last.weightStart;
}

function weeksOn(startDate) {
  return Math.floor((Date.now() - new Date(startDate)) / (7 * 24 * 60 * 60 * 1000));
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderMedKPIs() {
  const data        = loadMedData();
  const startWeight = data.phases[0].weightStart;
  const curWeight   = currentWeight();
  const totalLost   = +(startWeight - curWeight).toFixed(1);
  const weeks       = weeksOn(data.startDate);
  const avgPerWeek  = weeks > 0 ? +(totalLost / weeks).toFixed(2) : 0;
  const curDose     = data.phases[data.phases.length - 1].dose;

  _mSet('med-current-dose',   curDose);
  _mSet('med-start-weight',   startWeight);
  _mSet('med-current-weight', curWeight);
  _mSet('med-total-lost',     totalLost);
  _mSet('med-weeks-on',       weeks);
  _mSet('med-avg-per-week',   avgPerWeek);

  const sl = _mEl('med-start-label');
  if (sl) {
    const d = new Date(data.startDate);
    sl.textContent = `Started ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · GLP-1/GIP receptor agonist`;
  }
}

function renderMedPhases() {
  const container = _mEl('med-phases');
  if (!container) return;
  const data        = loadMedData();
  const startWeight = data.phases[0].weightStart;
  const curWeight   = currentWeight();

  container.innerHTML = data.phases.map((phase, i) => {
    const isActive = phase.weightEnd === null;
    const wStart   = phase.weightStart;
    const wEnd     = isActive ? curWeight : phase.weightEnd;
    const lost     = +(wStart - wEnd).toFixed(1);
    const phasePct = +((lost / (startWeight - curWeight || 1)) * 100).toFixed(0);
    const label    = isActive ? 'Current' : `Phase ${i + 1}`;
    const color    = isActive ? '#7c3aed' : '#0053e2';
    const bg       = isActive ? '#f5f3ff' : '#eff4ff';

    return `
      <div style="background:${bg};border:1px solid ${color}22;border-radius:10px;padding:0.8rem 1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="background:${color};color:#fff;font-size:0.7rem;font-weight:800;padding:3px 10px;border-radius:20px">${label}</div>
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

let medChartInst = null;
window.medChartInst = null;

function renderMedChart() {
  const canvas = _mEl('medWeightChart');
  if (!canvas) return;
  const data      = loadMedData();
  const curWeight = currentWeight();
  const labels    = data.phases.map((p, i) => i === data.phases.length - 1 ? 'Now' : `Phase ${i + 1}\n${p.dose}mg`);
  const weights   = data.phases.map((p, i) => i === data.phases.length - 1 ? curWeight : p.weightEnd ?? p.weightStart);
  const starts    = data.phases.map(p => p.weightStart);

  if (medChartInst) { medChartInst.destroy(); medChartInst = null; }

  medChartInst = window.medChartInst = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Weight (lbs)',
          data: weights,
          backgroundColor: weights.map((_, i) => i === weights.length - 1 ? 'rgba(124,58,237,0.8)' : 'rgba(0,83,226,0.7)'),
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
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y} lbs` } },
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

// ── Dose Effectiveness Chart ─────────────────────────────────────────────────────
// Estimates lbs/week per Mounjaro dose phase by matching weight readings
// to the weight range each phase spans. Needs window.allWeightData from app.js.

let medEffChart = null;
window.medEffChart = null;

function _phaseWeeks(phases, weightData) {
  // Sort weight readings oldest-first, deduplicate to one per calendar day
  const byDay = {};
  weightData.forEach(r => {
    const k = r.date.toLocaleDateString('en-CA');
    if (!byDay[k] || r.date > byDay[k].date) byDay[k] = r;
  });
  const sorted = Object.values(byDay).sort((a, b) => a.date - b.date);
  const today  = new Date();

  return phases.map((phase, i) => {
    const isActive   = phase.weightEnd === null;
    const wStart     = phase.weightStart;
    const wEnd       = isActive ? Math.min(...sorted.map(r => r.weight)) : phase.weightEnd;
    const lostPhase  = Math.max(0, +(wStart - wEnd).toFixed(1));

    // Estimate phase start: first reading ≤ wStart (+ 1 lb buffer)
    const startRec = sorted.find(r => r.weight <= wStart + 1);
    // Estimate phase end: first reading ≤ wEnd (+ 0.5 lb buffer) after start
    const startIdx = startRec ? sorted.indexOf(startRec) : 0;
    const endRec   = isActive
      ? null
      : sorted.slice(startIdx).find(r => r.weight <= wEnd + 0.5);

    const startDate = startRec ? startRec.date : new Date(today.getTime() - 30 * 86400000);
    const endDate   = isActive ? today : (endRec ? endRec.date : today);

    const msOn   = Math.max(1, endDate - startDate);
    const weeks  = msOn / (7 * 86400000);
    const rate   = weeks > 0.5 ? +(lostPhase / weeks).toFixed(2) : null;

    const label = `${phase.dose}mg${phases.filter((p,j) => j < i && p.dose === phase.dose).length > 0 ? ' (phase ' + (i + 1) + ')' : ''}`;
    return { label, dose: phase.dose, lostPhase, weeks: +weeks.toFixed(1), rate, isActive };
  });
}

function renderMedEffectiveness() {
  const canvas = _mEl('medEffectivenessChart');
  if (!canvas) return;

  const data   = loadMedData();
  const wData  = window.allWeightData;
  if (!wData || !wData.length) {
    // No weight data yet — just clear
    if (medEffChart) { medEffChart.destroy(); medEffChart = null; }
    return;
  }

  const curWeight = currentWeight();
  // Patch active phase for better end-weight estimate
  const patchedPhases = data.phases.map((p, i) =>
    i === data.phases.length - 1 ? { ...p, weightEnd: curWeight } : p
  );

  const phases = _phaseWeeks(data.phases, wData);
  const labels = phases.map(p => p.label);
  const rates  = phases.map(p => p.rate);
  const colors = phases.map(p =>
    p.isActive ? 'rgba(124,58,237,0.85)' : 'rgba(0,83,226,0.75)'
  );
  const borderColors = phases.map(p =>
    p.isActive ? '#7c3aed' : '#0053e2'
  );

  if (medEffChart) { medEffChart.destroy(); medEffChart = null; }

  medEffChart = window.medEffChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'lbs lost / week',
        data: rates,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 8,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const p = phases[ctx.dataIndex];
              const r = p.rate != null ? p.rate.toFixed(2) : '?';
              return [
                ` ${r} lbs/week`,
                ` −${p.lostPhase} lbs over ~${p.weeks.toFixed(0)} weeks`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: '#6d7a95',
            font: { size: 11 },
            callback: v => v + ' lbs/wk',
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        y: {
          ticks: { color: '#6d7a95', font: { size: 12, weight: '700' } },
          grid: { display: false },
        },
      },
    },
  });
}

function renderMedAll() {
  try { renderMedKPIs();         } catch(e) { console.error('[med] renderMedKPIs',         e); }
  try { renderMedPhases();       } catch(e) { console.error('[med] renderMedPhases',       e); }
  try { renderMedChart();        } catch(e) { console.error('[med] renderMedChart',        e); }
  try { renderMedEffectiveness();} catch(e) { console.error('[med] renderMedEffectiveness',e); }
}

// ── Edit Panel ────────────────────────────────────────────────────────────────

// Reads current phase rows out of the live DOM (preserves unsaved edits)
function readPhasesFromDOM() {
  const phases = [];
  let i = 0;
  while (document.getElementById(`med-p-dose-${i}`)) {
    const endVal = document.getElementById(`med-p-end-${i}`).value.trim();
    phases.push({
      dose:        parseFloat(document.getElementById(`med-p-dose-${i}`).value)  || 0,
      weightStart: parseFloat(document.getElementById(`med-p-start-${i}`).value) || 0,
      weightEnd:   endVal === '' ? null : parseFloat(endVal),
    });
    i++;
  }
  return phases;
}

function toggleMedEdit() {
  const panel = _mEl('med-edit-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) populateEditForm();
}

function populateEditForm() {
  const data = loadMedData();
  const startEl = _mEl('med-edit-start');
  if (startEl) startEl.value = data.startDate;
  renderEditPhases(data.phases);
}

function renderEditPhases(phases) {
  const container = _mEl('med-edit-phases');
  if (!container) return;
  container.innerHTML = phases.map((p, i) => [
    `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;`,
    `padding:0.6rem 0.75rem;display:grid;grid-template-columns:1fr 1fr 1fr auto;`,
    `gap:0.5rem;align-items:end">`,
      `<div><label style="font-size:0.65rem;font-weight:700;color:#6d7a95;display:block">DOSE (mg)</label>`,
      `<input type="number" step="2.5" value="${p.dose}" id="med-p-dose-${i}"`,
      ` style="width:100%;border:1px solid #d1d5db;border-radius:5px;padding:0.3rem 0.4rem;font-size:0.85rem;box-sizing:border-box"></div>`,
      `<div><label style="font-size:0.65rem;font-weight:700;color:#6d7a95;display:block">START WT (lbs)</label>`,
      `<input type="number" step="0.1" value="${p.weightStart}" id="med-p-start-${i}"`,
      ` style="width:100%;border:1px solid #d1d5db;border-radius:5px;padding:0.3rem 0.4rem;font-size:0.85rem;box-sizing:border-box"></div>`,
      `<div><label style="font-size:0.65rem;font-weight:700;color:#6d7a95;display:block">END WT (lbs)</label>`,
      `<input type="number" step="0.1" value="${p.weightEnd != null ? p.weightEnd : ''}" id="med-p-end-${i}"`,
      ` placeholder="Current" style="width:100%;border:1px solid #d1d5db;border-radius:5px;padding:0.3rem 0.4rem;font-size:0.85rem;box-sizing:border-box"></div>`,
      `<button onclick="medRemovePhase(${i})" title="Remove"`,
      ` style="background:#fff1f0;color:#ea1100;border:1px solid #fecaca;border-radius:5px;`,
      `padding:0.3rem 0.5rem;font-size:0.8rem;cursor:pointer;line-height:1">✕</button>`,
    `</div>`,
  ].join('')).join('');
}

// Add Phase: reads current DOM state first so unsaved edits are preserved
function medAddPhase() {
  const phases = readPhasesFromDOM();
  if (!phases.length) return;
  const last = phases[phases.length - 1];
  const lastEnd = last.weightEnd !== null ? last.weightEnd : currentWeight();
  last.weightEnd = lastEnd;  // close out current phase in form
  phases.push({ dose: last.dose, weightStart: lastEnd, weightEnd: null });
  renderEditPhases(phases);
}

// Remove Phase: reads current DOM state so unsaved edits are preserved
function medRemovePhase(idx) {
  const phases = readPhasesFromDOM();
  if (phases.length <= 1) return;
  phases.splice(idx, 1);
  phases[phases.length - 1].weightEnd = null;  // last phase always open
  renderEditPhases(phases);
}

function showMedToast(msg, isError) {
  let t = _mEl('med-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'med-toast';
    t.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;' +
      'padding:0.6rem 1.1rem;border-radius:8px;font-size:0.82rem;font-weight:700;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.15);transition:opacity 0.4s;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent  = msg;
  t.style.background = isError ? '#ea1100' : '#2a8703';
  t.style.color      = '#fff';
  t.style.opacity    = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function saveMedData() {
  try {
    const startEl = _mEl('med-edit-start');
    const phases  = readPhasesFromDOM();

    if (!phases.length) {
      showMedToast('No phases found — open the panel first', true);
      return;
    }

    // Last phase is always the active one (no end weight)
    phases[phases.length - 1].weightEnd = null;

    const data = {
      startDate: startEl ? startEl.value || MJ_DEFAULTS.startDate : MJ_DEFAULTS.startDate,
      phases,
    };

    persistMedData(data);
    toggleMedEdit();
    renderMedAll();
    showMedToast('✓ Saved!');
  } catch (err) {
    console.error('[medication] save error:', err);
    showMedToast('Save failed: ' + err.message, true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initMedication() {
  renderMedAll();
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initMedication, 800);
});
