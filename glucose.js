// ── glucose.js — Dexcom G7 CGM integration ───────────────────────────────
// Fetches glucose.json (written by GitHub Action every 5 min) and renders
// the CGM section of the dashboard. Fully self-contained module.
// Depends on: Chart.js (global), el/setText/countUp helpers from app.js

// ⬇️ Replace this with your Cloudflare Worker URL after deploying
const GLUCOSE_URL    = window.GLUCOSE_WORKER_URL || './glucose.json';
const GMI_URL        = window.HEALTH_WORKER_URL ? window.HEALTH_WORKER_URL + '/gmi.json' : null;
const GLUCOSE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// Target range (mg/dL)
const TARGET_LOW  = 70;
const TARGET_HIGH = 180;

let glucoseChart = null;

// ── Color helpers ─────────────────────────────────────────────────────────
function glucoseColor(val) {
  if (val == null)   return '#6d7a95';
  if (val < TARGET_LOW)  return '#ea1100'; // low  → red
  if (val > TARGET_HIGH) return '#ffc220'; // high → yellow
  return '#2a8703';                        // in range → green
}

function glucoseLabel(val) {
  if (val == null)         return '—';
  if (val < TARGET_LOW)   return 'Low 🔴';
  if (val > TARGET_HIGH)  return 'High 🟡';
  return 'In Range 🟢';
}

// ── Time-in-range calculator ──────────────────────────────────────────────
function timeInRange(readings) {
  if (!readings.length) return null;
  const inRange = readings.filter(r => r.value >= TARGET_LOW && r.value <= TARGET_HIGH).length;
  return Math.round((inRange / readings.length) * 100);
}

// ── Estimated A1C from average glucose ────────────────────────────────────
// Formula: eA1C = (avgGlucose + 46.7) / 28.7
function estA1C(avgGlucose) {
  return ((avgGlucose + 46.7) / 28.7).toFixed(1);
}

// ── Compression-low detection ─────────────────────────────────────────────
// A compression low is a false low caused by pressure on the sensor (e.g.
// sleeping on it): a sharp V-shaped dip that snaps back to baseline within
// minutes. Real hypoglycemia doesn't recover that fast unassisted, so dips
// matching this shape are excluded from avg/TIR/eA1C/lows (still charted).
const CL_MAX_DIP_MIN = 45; // whole dip (baseline → baseline) must fit in this window
const CL_MIN_DROP    = 25; // mg/dL fall from pre-dip baseline to dip minimum
const CL_REBOUND_TOL = 20; // post-dip value must land within this of baseline

function flagCompressionLows(readings) {
  const flagged = new Array(readings.length).fill(false);
  let episodes = 0;
  let i = 0;
  while (i < readings.length) {
    if (!(readings[i].value < TARGET_LOW)) { i++; continue; }
    let end = i;
    while (end + 1 < readings.length && readings[end + 1].value < TARGET_LOW) end++;
    const prev = i > 0 ? readings[i - 1] : null;
    const next = end + 1 < readings.length ? readings[end + 1] : null;
    // Dips at the edges of the window have no baseline on both sides,
    // so they can't be verified as compression — leave them counted.
    if (prev && next) {
      const dipMin = (new Date(next.time) - new Date(prev.time)) / 60000;
      const minVal = Math.min(...readings.slice(i, end + 1).map(r => r.value));
      const vShaped = dipMin > 0 && dipMin <= CL_MAX_DIP_MIN
                   && prev.value - minVal >= CL_MIN_DROP
                   && next.value >= TARGET_LOW
                   && Math.abs(next.value - prev.value) <= CL_REBOUND_TOL;
      if (vShaped) {
        for (let k = i; k <= end; k++) flagged[k] = true;
        episodes++;
      }
    }
    i = end + 1;
  }
  return { flagged, episodes };
}

// ── Minutes since a reading ───────────────────────────────────────────────
function minutesAgo(isoTime) {
  if (!isoTime) return null;
  return Math.round((Date.now() - new Date(isoTime).getTime()) / 60000);
}

// ── Render hero tile ─────────────────────────────────────────────────────
function renderGlucoseHero(current) {
  const valEl   = el('glucose-value');
  const unitEl  = el('glucose-unit');
  const trendEl = el('glucose-trend-arrow');
  const descEl  = el('glucose-trend-desc');
  const agoEl   = el('glucose-ago');
  const labelEl = el('glucose-status-label');

  if (!current || !current.value) {
    if (valEl)   valEl.textContent   = '—';
    if (labelEl) labelEl.textContent = 'No data yet';
    return;
  }

  const color = glucoseColor(current.value);
  if (valEl)  {
    valEl.textContent = current.value;
    valEl.style.color = color;
  }
  if (unitEl)   unitEl.style.color   = color;
  if (trendEl)  trendEl.textContent  = current.trendArrow || '→';
  if (descEl)   descEl.textContent   = current.trendDesc  || '';
  if (labelEl) {
    labelEl.textContent = glucoseLabel(current.value);
    labelEl.style.color = color;
  }

  const ago = minutesAgo(current.time);
  if (agoEl) agoEl.textContent = ago != null ? `${ago} min ago` : '';
}

// ── Render stats chips ───────────────────────────────────────────────────
function renderGlucoseStats(readings, cl) {
  if (!readings.length) return;
  // Expose for export feature (CSV/JSON downloads)
  window.glucoseHistory = readings;

  // Stats are computed on readings with suspected compression lows removed
  let kept = cl ? readings.filter((_, idx) => !cl.flagged[idx]) : readings;
  if (!kept.length) kept = readings;

  const vals   = kept.map(r => r.value).filter(Boolean);
  const avg    = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min    = Math.min(...vals);
  const max    = Math.max(...vals);
  const tir    = timeInRange(kept);
  const a1c    = estA1C(avg);
  const lows   = kept.filter(r => r.value < TARGET_LOW).length;
  const highs  = kept.filter(r => r.value > TARGET_HIGH).length;

  setText('glucose-avg',   Math.round(avg) + ' mg/dL');
  setText('glucose-min',   min + ' mg/dL');
  setText('glucose-max',   max + ' mg/dL');
  setText('glucose-a1c',   a1c + '%');
  setText('glucose-count', readings.length + ' readings');

  const tirEl = el('glucose-tir');
  if (tirEl) {
    tirEl.textContent = tir + '%';
    tirEl.style.color = tir >= 70 ? '#2a8703' : tir >= 50 ? '#995213' : '#ea1100';
  }

  // Expose TIR globally for health score + other modules
  window.snapGlucoseTIR = tir;
  window.snapGlucoseAvg = Math.round(avg);
  if (typeof refreshHealthScore === 'function') refreshHealthScore();

  // Low / high event count badges
  setText('glucose-lows',  lows  + (lows  === 1 ? ' event' : ' events'));
  setText('glucose-highs', highs + (highs === 1 ? ' event' : ' events'));

  // Compression-low filter note
  const noteEl = el('glucose-compression-note');
  if (noteEl) {
    const episodes = cl ? cl.episodes : 0;
    if (episodes > 0) {
      const n = cl.flagged.filter(Boolean).length;
      noteEl.textContent = `🛏️ ${episodes} suspected compression low${episodes === 1 ? '' : 's'} (${n} reading${n === 1 ? '' : 's'}) excluded from stats — shown gray on the chart`;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }
  }
}

// ── Render 24h chart ─────────────────────────────────────────────────────
function renderGlucoseChart(readings, flagged) {
  const canvas = el('glucoseChart');
  if (!canvas || !readings.length) return;

  if (glucoseChart) { glucoseChart.destroy(); glucoseChart = null; }

  const labels = readings.map(r => {
    const d = new Date(r.time);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  });
  const values = readings.map(r => r.value);

  // Point color array — red/yellow/green per reading, gray for compression lows
  const pointColors = values.map((v, idx) => (flagged && flagged[idx]) ? '#8a94ad' : glucoseColor(v));

  const ctx = canvas.getContext('2d');

  glucoseChart = window.glucoseChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Glucose (mg/dL)',
          data: values,
          borderColor: '#0053e2',
          backgroundColor: 'rgba(0,83,226,0.07)',
          fill: true,
          tension: 0.35,
          pointRadius: readings.length < 60 ? 3 : 1,
          pointHoverRadius: 5,
          pointBackgroundColor: pointColors,
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          borderWidth: 2,
        },
        // Target high line
        {
          label: `High (${TARGET_HIGH})`,
          data: labels.map(() => TARGET_HIGH),
          borderColor: 'rgba(255,194,32,0.6)',
          backgroundColor: 'transparent',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        },
        // Target low line
        {
          label: `Low (${TARGET_LOW})`,
          data: labels.map(() => TARGET_LOW),
          borderColor: 'rgba(234,17,0,0.45)',
          backgroundColor: 'transparent',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 18 } },
        tooltip: {
          backgroundColor: '#1a1f36',
          padding: 12,
          cornerRadius: 10,
          titleColor: '#fff',
          bodyColor: '#ccc',
          callbacks: {
            label: c => {
              if (c.datasetIndex !== 0) return null; // skip target lines in tooltip
              const v = c.parsed.y;
              if (flagged && flagged[c.dataIndex]) return ` ${v} mg/dL  🛏️ suspected compression low`;
              return ` ${v} mg/dL  ${glucoseLabel(v)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6d7a95', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: '#eee' },
        },
        y: {
          min: 40,
          ticks: { color: '#6d7a95', font: { size: 11 }, callback: v => v + ' mg/dL' },
          grid: { color: '#eee' },
        },
      },
    },
  });
}

// ── Master glucose render ──────────────────────────────────────────────
function renderGlucose(data) {
  const section = el('glucose-section');
  if (!section) return;
  // visibility handled by tab system — no display toggle needed

  renderGlucoseHero(data.current);

  if (data.readings && data.readings.length) {
    const cl = flagCompressionLows(data.readings);
    renderGlucoseStats(data.readings, cl);
    renderGlucoseChart(data.readings, cl.flagged);
  }

  // Updated-at footer
  const updEl = el('glucose-updated');
  if (updEl && data.updatedAt) {
    const d = new Date(data.updatedAt);
    updEl.textContent = 'Last synced: ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  if (data.current) {
    window.snapGlucoseNow = data.current.value;
    if (typeof updateSnapshot === 'function') updateSnapshot();
  }
}

// ── Render 14-day GMI chip ───────────────────────────────────────────────
function renderGMI(g) {
  const valEl = el('glucose-gmi');
  const subEl = el('glucose-gmi-sub');
  if (!valEl) return;
  if (!g || g.gmi == null) {
    valEl.textContent = '—';
    if (subEl) subEl.textContent = 'collecting data';
    return;
  }
  valEl.textContent = g.gmi + '%';
  if (subEl) {
    subEl.textContent = g.daysWithData >= 14
      ? `14 days · ${g.meanGlucose} mg/dL avg`
      : `${g.daysWithData}/14 days — settling in`;
  }
}

// ── Data fetch ───────────────────────────────────────────────────────────
async function loadGlucose() {
  try {
    const resp = await fetch(GLUCOSE_URL + '?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.current) renderGlucose(data);
  } catch (e) {
    console.warn('Glucose fetch failed:', e.message);
  }
}

async function loadGMI() {
  if (!GMI_URL) return;
  try {
    const resp = await fetch(GMI_URL + '?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    renderGMI(await resp.json());
  } catch (e) {
    console.warn('GMI fetch failed:', e.message);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────
loadGlucose();
loadGMI();
setInterval(() => { loadGlucose(); loadGMI(); }, GLUCOSE_REFRESH_MS);
