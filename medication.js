/**
 * medication.js — Mounjaro journey tracker
 *
 * Storage strategy:
 *   • localStorage  = write-through cache (instant render, offline-friendly)
 *   • Firebase RTDB = source of truth (survives cache clears, cross-device sync)
 *
 * Flow:
 *   render()  → reads localStorage synchronously
 *   on boot   → fetches cloud in background, merges newest by updatedAt, re-renders
 *   save()    → stamps updatedAt, writes localStorage, pushes to cloud
 */

// ── Defaults (used if NEITHER localStorage NOR cloud has data) ────────────────
const MJ_DEFAULTS = {
  startDate: '2026-01-29',
  phases: [
    { dose: 2.5, weightStart: 315, weightEnd: 296 },
    { dose: 5.0, weightStart: 296, weightEnd: 287 },
    { dose: 5.0, weightStart: 287, weightEnd: null },  // current
  ],
};

const LS_KEY        = 'mj_journey_v1';
const FIREBASE_BASE = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com';
const CLOUD_URL     = `${FIREBASE_BASE}/medication/journey.json`;

// ── Cloud sync ──────────────────────────────────────────────────────────────────
async function fetchMedDataFromCloud() {
  try {
    const _fetchToken = window.fbUser ? await window.fbUser.getIdToken() : null;
    const resp = await fetch(CLOUD_URL + (_fetchToken ? "?auth=" + _fetchToken + "&t=" : "?t=") + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json && Array.isArray(json.phases) && json.phases.length) return json;
    return null;
  } catch (e) {
    console.warn('[medication] cloud fetch failed:', e.message);
    return null;
  }
}

async function pushMedDataToCloud(data) {
  try {
    const _pushToken = window.fbUser ? await window.fbUser.getIdToken() : null;
    const resp = await fetch(CLOUD_URL + (_pushToken ? "?auth=" + _pushToken : ""), {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return true;
  } catch (e) {
    console.warn('[medication] cloud push failed:', e.message);
    return false;
  }
}

// Background sync on boot: merge cloud ↔ local by `updatedAt`, then re-render.
async function syncMedDataWithCloud() {
  setSyncStatus('syncing');
  const [cloud, local] = [await fetchMedDataFromCloud(), loadMedData()];

  if (!cloud && !localStorage.getItem(LS_KEY)) {
    // Neither side has anything — push the on-screen defaults so the cloud
    // gets seeded for next device.
    const seeded = { ...local, updatedAt: new Date().toISOString() };
    persistMedData(seeded);
    pushMedDataToCloud(seeded);
    setSyncStatus('synced');
    return;
  }
  if (cloud && !localStorage.getItem(LS_KEY)) {
    // First load on a new device — cloud wins.
    persistMedData(cloud);
    renderMedAll();
    setSyncStatus('synced');
    return;
  }
  if (cloud && local) {
    const cloudT = Date.parse(cloud.updatedAt || 0) || 0;
    const localT = Date.parse(local.updatedAt || 0) || 0;
    if (cloudT > localT) {
      // Cloud is newer — adopt it
      persistMedData(cloud);
      renderMedAll();
    } else if (localT > cloudT) {
      // Local is newer — push it up
      pushMedDataToCloud(local);
    }
    // Equal timestamps = nothing to do
  }
  setSyncStatus('synced');
}

// Tiny pill in the bottom-right corner so you can see sync state at a glance.
function setSyncStatus(state) {
  let pill = document.getElementById('med-sync-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'med-sync-pill';
    pill.style.cssText = [
      'position:fixed', 'bottom:0.5rem', 'left:0.5rem', 'z-index:9998',
      'font-size:0.65rem', 'font-weight:700', 'padding:3px 8px',
      'border-radius:10px', 'pointer-events:none', 'opacity:0.85',
      'transition:opacity 0.4s, background-color 0.3s',
    ].join(';');
    document.body.appendChild(pill);
  }
  const styles = {
    syncing: { bg: '#fef9ec', fg: '#995213', text: '↻ syncing…' },
    synced:  { bg: '#dcfce7', fg: '#166534', text: '✓ synced'    },
    error:   { bg: '#fee2e2', fg: '#991b1b', text: '⚠ offline'  },
  }[state] || { bg: '#e5e7eb', fg: '#6d7a95', text: state };
  pill.style.background = styles.bg;
  pill.style.color      = styles.fg;
  pill.textContent      = styles.text;
  if (state === 'synced') {
    setTimeout(() => { if (pill) pill.style.opacity = '0'; }, 2500);
  } else {
    pill.style.opacity = '0.85';
  }
}

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
  // Push the reset state up so other devices match.
  const fresh = { ...JSON.parse(JSON.stringify(MJ_DEFAULTS)), updatedAt: new Date().toISOString() };
  persistMedData(fresh);
  pushMedDataToCloud(fresh);
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
  try { renderShotStatus();      } catch(e) { console.error('[med] renderShotStatus',      e); }
  try { renderSupply();          } catch(e) { console.error('[med] renderSupply',          e); }
  try { renderShotHistory();     } catch(e) { console.error('[med] renderShotHistory',     e); }
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
      updatedAt: new Date().toISOString(),
    };

    persistMedData(data);
    toggleMedEdit();
    renderMedAll();
    showMedToast('✓ Saved locally…');
    setSyncStatus('syncing');
    pushMedDataToCloud(data).then(ok => {
      setSyncStatus(ok ? 'synced' : 'error');
      if (ok) showMedToast('✓ Synced to cloud');
      else    showMedToast('⚠ Saved locally, cloud sync failed', true);
    });
  } catch (err) {
    console.error('[medication] save error:', err);
    showMedToast('Save failed: ' + err.message, true);
  }
}

// ── Shot Log ──────────────────────────────────────────────────────────────────

const SHOTS_KEY  = 'med_shots_v1';
const SUPPLY_KEY = 'med_supply_v1';

const SHOTS_SEED_VERSION = 2;

const SHOT_DEFAULTS = [
  { id:1,  date:'2026-01-29T17:30', medication:'Mounjaro 2.5mg', site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:2,  date:'2026-02-05T17:30', medication:'Mounjaro 2.5mg', site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:3,  date:'2026-02-12T17:30', medication:'Mounjaro 2.5mg', site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:4,  date:'2026-02-19T17:30', medication:'Mounjaro 2.5mg', site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:5,  date:'2026-02-26T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:6,  date:'2026-03-05T17:30', medication:'Mounjaro 5mg',   site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:7,  date:'2026-03-12T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:8,  date:'2026-03-19T17:30', medication:'Mounjaro 5mg',   site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:9,  date:'2026-03-26T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:10, date:'2026-04-02T17:30', medication:'Mounjaro 5mg',   site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:11, date:'2026-04-09T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:12, date:'2026-04-16T17:30', medication:'Mounjaro 5mg',   site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:13, date:'2026-04-23T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
  { id:14, date:'2026-04-30T17:30', medication:'Mounjaro 5mg',   site:'Lower Mid',           weight:null, foodNoise:'none', symptoms:[], notes:'No Pain' },
  { id:15, date:'2026-05-07T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'No Pain' },
  { id:16, date:'2026-05-14T17:30', medication:'Mounjaro 5mg',   site:'Abdomen Lower Left', weight:null, foodNoise:'none', symptoms:[], notes:'' },
];

// Tirzepatide: t½ ~5 days (120h), Tmax ~68h
// Semaglutide: t½ ~7 days (168h), Tmax ~63h
const PK_PARAMS = {
  tirzepatide: { ka: 0.030, ke: 0.00578, phasePeak: 48, phaseFade: 96  },
  semaglutide: { ka: 0.040, ke: 0.00412, phasePeak: 48, phaseFade: 96  },
};

function getPKParams(medication) {
  if (!medication) return PK_PARAMS.tirzepatide;
  const m = medication.toLowerCase();
  return (m.includes('ozempic') || m.includes('wegovy')) ? PK_PARAMS.semaglutide : PK_PARAMS.tirzepatide;
}

function pkConc(t, ka, ke) {
  if (t < 0) return 0;
  return Math.max(0, (Math.exp(-ke * t) - Math.exp(-ka * t)) / (ka - ke));
}

function buildPKCurve(pk) {
  const pts = [];
  for (let h = 0; h <= 168; h++) pts.push({ h, c: pkConc(h, pk.ka, pk.ke) });
  const maxC = Math.max(...pts.map(p => p.c));
  return pts.map(p => ({ h: p.h, pct: maxC > 0 ? (p.c / maxC) * 100 : 0 }));
}

function getShotPhase(hoursElapsed, pk) {
  if (hoursElapsed < 0)            return { label: 'Scheduled',  color: '#6d7a95', bg: '#f5f6f8', desc: 'Shot scheduled in the future' };
  if (hoursElapsed < pk.phasePeak) return { label: '↑ Rising',   color: '#0053e2', bg: '#eff4ff', desc: 'Drug absorbing — building toward peak effect' };
  if (hoursElapsed < pk.phaseFade) return { label: '⚡ Peak',    color: '#2a8703', bg: '#f0fdf4', desc: 'At maximum concentration — appetite suppression strongest' };
  if (hoursElapsed < 168)          return { label: '↓ Fading',   color: '#995213', bg: '#fef9ec', desc: 'Concentration declining — next dose approaching' };
  return                                   { label: '⚠ Overdue', color: '#ea1100', bg: '#fff1f0', desc: 'Shot overdue — concentration very low' };
}

function loadShots()     { try { return JSON.parse(localStorage.getItem(SHOTS_KEY) || '[]'); } catch { return []; } }
function saveShots(s)    { localStorage.setItem(SHOTS_KEY, JSON.stringify(s)); }
function loadSupply()    { try { return JSON.parse(localStorage.getItem(SUPPLY_KEY) || 'null') || { pens: 0, dosesPerPen: 4, expirationDate: '' }; } catch { return { pens: 0, dosesPerPen: 4, expirationDate: '' }; } }
function saveSupplyData(d) { localStorage.setItem(SUPPLY_KEY, JSON.stringify(d)); }

// ── Shot Form ────────────────────────────────────────────────────────────────

function toggleShotForm() {
  const panel = _mEl('shot-form-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (!opening) return;

  // Default to now
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (_mEl('shot-datetime')) _mEl('shot-datetime').value = local;

  // Default medication to current phase dose
  const curDose = loadMedData().phases.slice(-1)[0]?.dose;
  if (curDose) {
    const medEl = _mEl('shot-medication');
    if (medEl) for (const o of medEl.options) { if (o.value.includes(curDose + 'mg')) { o.selected = true; break; } }
  }

  // Suggest next rotation site
  const shots  = loadShots();
  const sites  = ['Abdomen Lower Left','Lower Mid','Abdomen Lower Right','Abdomen Upper Left','Abdomen Upper Right','Left Thigh','Right Thigh','Left Upper Arm','Right Upper Arm'];
  if (shots.length) {
    const lastSite = shots[shots.length - 1].site;
    const next     = sites[(sites.indexOf(lastSite) + 1) % sites.length];
    const siteEl   = _mEl('shot-site');
    if (siteEl) for (const o of siteEl.options) { if (o.value === next) { o.selected = true; break; } }
  }

  // Pre-fill weight from live KPI
  const wEl = _mEl('shot-weight');
  if (wEl) { const cw = currentWeight(); if (cw && !isNaN(cw)) wEl.value = cw.toFixed(1); }
}

function saveShot() {
  const datetime = _mEl('shot-datetime')?.value;
  if (!datetime) { showMedToast('Please select a date and time', true); return; }

  const symptoms = [];
  document.querySelectorAll('#shot-symptoms-check input:checked').forEach(cb => symptoms.push(cb.value));

  const shot = {
    id:        Date.now(),
    date:      datetime,
    medication:_mEl('shot-medication')?.value  || '',
    site:      _mEl('shot-site')?.value        || '',
    weight:    parseFloat(_mEl('shot-weight')?.value) || null,
    foodNoise: _mEl('shot-food-noise')?.value  || 'none',
    symptoms,
    notes:     _mEl('shot-notes')?.value?.trim() || '',
  };

  const shots = loadShots();
  shots.push(shot);
  shots.sort((a, b) => new Date(a.date) - new Date(b.date));
  saveShots(shots);

  // Reset checkboxes + notes
  document.querySelectorAll('#shot-symptoms-check input').forEach(cb => cb.checked = false);
  if (_mEl('shot-notes')) _mEl('shot-notes').value = '';

  toggleShotForm();
  renderShotStatus();
  renderShotHistory();
  showMedToast('✓ Shot logged');
}

function deleteShot(id) {
  saveShots(loadShots().filter(s => s.id !== id));
  renderShotStatus();
  renderShotHistory();
  showMedToast('Shot removed');
}

// ── PK Curve Chart ───────────────────────────────────────────────────────────

let pkChartInst = null;

function renderShotStatus() {
  const shots    = loadShots();
  const lastShot = shots.length ? shots[shots.length - 1] : null;
  const labelEl  = _mEl('shot-last-label');
  const badgeEl  = _mEl('shot-phase-badge');
  const descEl   = _mEl('shot-phase-desc');
  const cntEl    = _mEl('shot-countdown');

  if (!lastShot) {
    if (labelEl) labelEl.textContent = 'No shots logged yet';
    if (badgeEl) badgeEl.textContent = '—';
    if (descEl)  descEl.textContent  = 'Log your first shot to see the drug curve';
    if (cntEl)   cntEl.textContent   = '';
    renderPKChart(null, 0, PK_PARAMS.tirzepatide);
    return;
  }

  const shotDate   = new Date(lastShot.date);
  const now        = new Date();
  const hoursAgo   = (now - shotDate) / 3600000;
  const pk         = getPKParams(lastShot.medication);
  const phase      = getShotPhase(hoursAgo, pk);
  const nextShot   = new Date(shotDate.getTime() + 7 * 24 * 3600000);
  const hoursLeft  = (nextShot - now) / 3600000;

  if (labelEl) {
    const d = shotDate;
    labelEl.textContent = `Last: ${lastShot.medication} · ${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})} at ${d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${lastShot.site}`;
  }
  if (badgeEl) { badgeEl.textContent = phase.label; badgeEl.style.background = phase.bg; badgeEl.style.color = phase.color; }
  if (descEl)  descEl.textContent = phase.desc;
  if (cntEl) {
    if (hoursLeft > 0) {
      const d = Math.floor(hoursLeft / 24), h = Math.floor(hoursLeft % 24);
      cntEl.textContent = `Next shot in: ${d}d ${h}h`;
      cntEl.style.color = hoursLeft < 24 ? '#ea1100' : '#374151';
    } else {
      cntEl.textContent = 'Shot overdue!';
      cntEl.style.color = '#ea1100';
    }
  }

  renderPKChart(lastShot, hoursAgo, pk);
}

function renderPKChart(lastShot, hoursAgo, pk) {
  const canvas = _mEl('shotPKChart');
  if (!canvas) return;
  if (pkChartInst) { pkChartInst.destroy(); pkChartInst = null; }

  const curve      = buildPKCurve(pk);
  const labels     = curve.map(p => p.h % 24 === 0 ? `Day ${p.h / 24}` : '');
  const mainColor  = lastShot ? '#7c3aed' : 'rgba(124,58,237,0.3)';
  const fillColor  = lastShot ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.05)';

  const datasets = [{
    label: 'Drug level',
    data:  curve.map(p => p.pct),
    borderColor: mainColor,
    backgroundColor: fillColor,
    borderWidth: 2.5,
    fill: true,
    tension: 0.4,
    pointRadius: 0,
  }];

  if (lastShot) {
    const currentH   = Math.min(Math.round(hoursAgo), 168);
    const currentPct = curve.find(p => p.h === currentH)?.pct ?? 0;
    datasets.push({
      label: 'Now',
      data:  curve.map(p => p.h === currentH ? currentPct : null),
      borderColor: '#ea1100',
      backgroundColor: '#ea1100',
      pointRadius: 8,
      pointHoverRadius: 10,
      showLine: false,
    });
  }

  pkChartInst = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: item => item.parsed.y != null,
          callbacks: {
            title: items => `Hour ${items[0].dataIndex}`,
            label: c => c.dataset.label === 'Now' ? ' ← You are here' : ` ${c.parsed.y.toFixed(0)}% drug level`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { color: 'rgba(0,0,0,0.04)' } },
        y: { min: 0, max: 105, ticks: { color: '#6d7a95', font: { size: 10 }, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.04)' } },
      },
    },
  });
}

// ── Supply Tracker ────────────────────────────────────────────────────────────

function toggleSupplyEdit() {
  const form = _mEl('supply-edit-form');
  if (!form) return;
  const opening = form.style.display === 'none';
  form.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  const data = loadSupply();
  if (_mEl('supply-input-pens')) _mEl('supply-input-pens').value = data.pens;
  if (_mEl('supply-input-dpn'))  _mEl('supply-input-dpn').value  = data.dosesPerPen;
  if (_mEl('supply-input-exp'))  _mEl('supply-input-exp').value  = data.expirationDate || '';
}

function saveSupply() {
  saveSupplyData({
    pens:           parseInt(_mEl('supply-input-pens')?.value) || 0,
    dosesPerPen:    parseInt(_mEl('supply-input-dpn')?.value)  || 4,
    expirationDate: _mEl('supply-input-exp')?.value || '',
  });
  toggleSupplyEdit();
  renderSupply();
  showMedToast('✓ Supply updated');
}

function renderSupply() {
  const data       = loadSupply();
  const totalDoses = data.pens * data.dosesPerPen;

  _mSet('supply-pens',  data.pens);
  _mSet('supply-doses', totalDoses);
  _mSet('supply-weeks', totalDoses); // 1 dose/week

  const expEl      = _mEl('supply-expires');
  const daysLeftEl = _mEl('supply-days-left');
  if (data.expirationDate) {
    const exp      = new Date(data.expirationDate + 'T00:00:00');
    const daysLeft = Math.ceil((exp - new Date()) / 86400000);
    if (expEl)      expEl.textContent      = exp.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    if (daysLeftEl) {
      daysLeftEl.textContent = daysLeft > 0 ? `${daysLeft} days left` : 'EXPIRED';
      daysLeftEl.style.color = daysLeft < 30 ? '#ea1100' : '';
    }
  } else {
    if (expEl)      expEl.textContent      = '—';
    if (daysLeftEl) daysLeftEl.textContent = 'No expiry set';
  }
}

// ── Shot History + CSV Export ─────────────────────────────────────────────────

function renderShotHistory() {
  const tbody = _mEl('shot-history-body');
  if (!tbody) return;
  const shots = loadShots().slice().reverse();

  if (!shots.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:#6d7a95">No shots logged yet</td></tr>';
    return;
  }

  const fnColor = { none: '#6d7a95', mild: '#995213', moderate: '#ea6000', severe: '#ea1100' };
  const fnEmoji = { none: '🤫', mild: '😐', moderate: '😤', severe: '🍔' };

  tbody.innerHTML = shots.map(s => {
    const d    = new Date(s.date);
    const date = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    const syms = s.symptoms?.length ? s.symptoms.map(x => x.replace(/_/g,' ')).join(', ') : '—';
    const fn   = s.foodNoise || 'none';
    return `<tr style="border-bottom:1px solid #f0f0f5">
      <td style="padding:0.5rem 0.75rem;white-space:nowrap;font-weight:600">${date}<br><span style="font-size:0.7rem;color:#6d7a95;font-weight:400">${time}</span></td>
      <td style="padding:0.5rem 0.75rem;font-size:0.8rem">${s.medication}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.8rem;white-space:nowrap">${s.site}</td>
      <td style="padding:0.5rem 0.75rem;font-weight:700">${s.weight ? s.weight + ' lbs' : '—'}</td>
      <td style="padding:0.5rem 0.75rem;color:${fnColor[fn]};font-weight:600;white-space:nowrap">${fnEmoji[fn]} ${fn.charAt(0).toUpperCase()+fn.slice(1)}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.75rem;color:#6d7a95">${syms}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.75rem;color:#6d7a95;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.notes || '—'}</td>
      <td style="padding:0.5rem 0.5rem"><button onclick="deleteShot(${s.id})" title="Delete" style="background:#fff1f0;color:#ea1100;border:1px solid #fecaca;border-radius:4px;padding:0.2rem 0.4rem;font-size:0.72rem;cursor:pointer">✕</button></td>
    </tr>`;
  }).join('');
}

function exportShotsCSV() {
  const shots = loadShots();
  if (!shots.length) { showMedToast('No shots to export', true); return; }
  const headers = ['Date','Time','Medication','Site','Weight (lbs)','Food Noise','Symptoms','Notes'];
  const rows = shots.map(s => {
    const d = new Date(s.date);
    return [
      d.toLocaleDateString('en-CA'),
      d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }),
      s.medication, s.site, s.weight ?? '', s.foodNoise,
      (s.symptoms || []).join('; '), s.notes || '',
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'glp1-shot-log.csv'; a.click();
  URL.revokeObjectURL(url);
  showMedToast('✓ CSV exported');
}

// ── Init ───────────────────────────────────────────────────────────────────────────────────
function initMedication() {
  const seeded = parseInt(localStorage.getItem('med_shots_seed_v') || '0');
  if (seeded < SHOTS_SEED_VERSION) {
    const existing    = loadShots();
    const existingIds = new Set(existing.map(s => s.id));
    const toAdd       = SHOT_DEFAULTS.filter(s => !existingIds.has(s.id));
    if (toAdd.length) saveShots([...existing, ...toAdd].sort((a, b) => new Date(a.date) - new Date(b.date)));
    localStorage.setItem('med_shots_seed_v', String(SHOTS_SEED_VERSION));
  }
  renderMedAll();         // 1. Instant render from localStorage cache
  syncMedDataWithCloud(); // 2. Background merge with Firebase, re-render if newer
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initMedication, 800);
});
