/* ════════════════════════════════════════════════════════════════════
   app-insights.js — Snapshot strip + cross-modality Insights generator
   Reads from window.snap* globals exposed by glucose/activity/medication.
   ──────────────────────────────────────────────────────────────────── */

// ── Top-of-page snapshot strip ───────────────────────────────────────
function updateSnapshot() {
  const setSnap = (id, text, cls) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = text;
    e.classList.remove('skel');
    if (cls) { e.className = 'snap-delta ' + cls; }
  };

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
      const d    = nowAvg - priorAvg;
      const sign = d > 0 ? '+' : '';
      setSnap('snap-weight-delta', sign + d.toFixed(1) + ' lbs vs 7d ago (trend)',
              d < 0 ? 'good' : d > 0 ? 'bad' : 'neutral');
    } else {
      setSnap('snap-weight-delta', 'no 7d comparison', 'neutral');
    }
  }

  // Glucose
  const g = window.snapGlucoseNow;
  if (g != null) {
    setSnap('snap-glucose', g + ' mg/dL');
    const inRange = g >= 70 && g <= 180;
    setSnap('snap-glucose-delta', inRange ? 'in range' : 'out of range', inRange ? 'good' : 'bad');
  }

  // Steps & Sleep
  const act = window.snapActivityNow;
  if (act) {
    setSnap('snap-steps', act.steps.toLocaleString());
    const pct = Math.round((act.steps / 10000) * 100);
    setSnap('snap-steps-delta', pct + '% of 10k goal', pct >= 80 ? 'good' : 'bad');

    if (act.sleepHours) {
      const h = Math.floor(act.sleepHours);
      const m = Math.round((act.sleepHours - h) * 60);
      setSnap('snap-sleep', m > 0 ? h + 'h ' + m + 'm' : h + 'h');
    } else {
      setSnap('snap-sleep', '—');
    }
    if (act.sleepScore != null) {
      setSnap('snap-sleep-delta', 'score ' + act.sleepScore, act.sleepScore >= 70 ? 'good' : 'bad');
    } else {
      setSnap('snap-sleep-delta', '—', 'neutral');
    }
  }
}
