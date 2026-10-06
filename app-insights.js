/* ════════════════════════════════════════════════════════════════════
   app-insights.js — Snapshot strip + cross-modality Insights generator
   Reads from window.snap* globals exposed by glucose/activity/medication.
   ──────────────────────────────────────────────────────────────────── */

// ── Top-of-page snapshot strip & Sparklines ───────────────────────────
function drawSnapshotSparkline(svgId, points, strokeColor) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  if (!points || points.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const w = 100;
  const h = 26;
  const pad = 3;
  const plotH = h - pad * 2;

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - pad - ((v - min) / range) * plotH;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  let linePath = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const p0 = coords[i - 1];
    const p1 = coords[i];
    const mx = (p0.x + p1.x) / 2;
    linePath += ` C ${mx} ${p0.y}, ${mx} ${p1.y}, ${p1.x} ${p1.y}`;
  }

  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L ${last.x} ${h} L ${coords[0].x} ${h} Z`;
  const gradId = 'grad-' + svgId;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.32" />
        <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${gradId})" />
    <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${last.x}" cy="${last.y}" r="2.5" fill="${strokeColor}" />
  `;
}

function updateSnapshot() {
  const setSnap = (id, text, cls) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = text;
    e.classList.remove('skel');
    if (cls) { e.className = 'snap-delta ' + cls; }
  };

  const isDark = document.getElementById('root')?.classList.contains('dark') || false;

  // Weight
  if (allData.length) {
    const latest = allData[allData.length - 1];
    setSnap('snap-weight', latest.weight.toFixed(1) + ' lbs');

    // Compare SMOOTHED trend, not single noisy readings. A raw point-to-point
    // diff can land on a lucky trough/peak (or a data gap) and lie about the
    // real direction. Trailing 5-reading average ending at-or-before a date.
    const trailingAvg = (cutoff) => {
      const upto = allData.filter(r => r.date <= cutoff);
      if (!upto.length) return null;
      const last5 = upto.slice(-5);
      return last5.reduce((s, r) => s + r.weight, 0) / last5.length;
    };
    const sevenDaysAgo = new Date(latest.date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    // Extend to end-of-day so a reading logged later in the day than the
    // latest sync's own timestamp still counts as "that day".
    sevenDaysAgo.setHours(23, 59, 59, 999);
    const nowAvg   = trailingAvg(latest.date);
    const priorAvg = trailingAvg(sevenDaysAgo);
    if (nowAvg != null && priorAvg != null) {
      const d     = nowAvg - priorAvg;
      const sign  = d > 0 ? '+' : '';
      const arrow = d < 0 ? '↓ ' : d > 0 ? '↑ ' : '';
      setSnap('snap-weight-delta', arrow + sign + d.toFixed(1) + ' lbs vs 7d',
              d < 0 ? 'good' : d > 0 ? 'bad' : 'neutral');
      const heroVel = document.getElementById('hero-velocity-val');
      if (heroVel) {
        heroVel.textContent = (d < 0 ? '' : '+') + d.toFixed(1) + ' lbs / 7d';
      }
    } else {
      setSnap('snap-weight-delta', 'no 7d comparison', 'neutral');
    }

    // Weight sparkline: last 14 readings
    const lastWeights = allData.slice(-14).map(r => r.weight);
    drawSnapshotSparkline('snap-sparkline-weight', lastWeights, isDark ? '#60a5fa' : '#2563eb');
  }

  // Glucose
  if (typeof SHOW_GLUCOSE !== 'undefined' && !SHOW_GLUCOSE) {
    const gCell = document.getElementById('snap-cell-glucose');
    if (gCell) {
      gCell.hidden = true;
      gCell.style.setProperty('display', 'none', 'important');
    }
  } else {
    const g = window.snapGlucoseNow;
    if (g != null) {
      setSnap('snap-glucose', g + ' mg/dL');
      const inRange = g >= 70 && g <= 180;
      const icon = inRange ? '✓ ' : '! ';
      setSnap('snap-glucose-delta', icon + (inRange ? 'in range' : 'out of range'), inRange ? 'good' : 'bad');

      // Glucose sparkline: recent readings from window.snapGlucoseReadings or window.glucoseHistory
      const readings = window.snapGlucoseReadings || window.glucoseHistory || [];
      if (readings.length) {
        const gPoints = readings.slice(-16).map(r => r.value != null ? r.value : r.sgv).filter(Boolean);
        if (gPoints.length >= 2) {
          drawSnapshotSparkline('snap-sparkline-glucose', gPoints, isDark ? '#4ade80' : '#16a34a');
        }
      }
    }
  }

  // Steps & Sleep
  const act = window.snapActivityNow;
  if (act) {
    setSnap('snap-steps', act.steps.toLocaleString());
    const pct = Math.round((act.steps / 10000) * 100);
    const arrow = pct >= 80 ? '↑ ' : '';
    setSnap('snap-steps-delta', arrow + pct + '% of 10k goal', pct >= 80 ? 'good' : 'bad');

    if (act.sleepHours) {
      const h = Math.floor(act.sleepHours);
      const m = Math.round((act.sleepHours - h) * 60);
      setSnap('snap-sleep', m > 0 ? h + 'h ' + m + 'm' : h + 'h');
    } else {
      setSnap('snap-sleep', '—');
    }
    if (act.sleepScore != null) {
      const star = act.sleepScore >= 70 ? '★ ' : '';
      setSnap('snap-sleep-delta', star + 'score ' + act.sleepScore, act.sleepScore >= 70 ? 'good' : 'bad');
    } else {
      setSnap('snap-sleep-delta', '—', 'neutral');
    }

    if (window.snapActivityDays && window.snapActivityDays.length) {
      const stepPts = window.snapActivityDays.slice(-7).map(d => d.steps || 0);
      if (stepPts.length >= 2) {
        drawSnapshotSparkline('snap-sparkline-steps', stepPts, isDark ? '#fbbf24' : '#d97706');
      }
      const sleepPts = window.snapActivityDays.slice(-7).map(d => d.sleepHours || 0);
      if (sleepPts.length >= 2) {
        drawSnapshotSparkline('snap-sparkline-sleep', sleepPts, isDark ? '#a78bfa' : '#7c3aed');
      }
    }
  }
}

