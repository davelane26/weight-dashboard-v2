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
    const sevenDaysAgo = new Date(latest.date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const older = allData.slice().reverse().find(r => r.date <= sevenDaysAgo);
    if (older) {
      const d    = latest.weight - older.weight;
      const sign = d > 0 ? '+' : '';
      setSnap('snap-weight-delta', sign + d.toFixed(1) + ' lbs vs 7d ago',
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

// ── Cross-modality insights ──────────────────────────────────────────
// Each "check" looks for a statistically meaningful pattern between
// two streams (sleep↔weight, stress↔glucose, steps↔weight, etc).
// All checks gracefully no-op when there isn't enough data yet.
function generateInsights() {
  const list  = document.getElementById('insights-list');
  const empty = document.getElementById('insights-empty');
  if (!list || !empty) return;

  list.innerHTML = '';
  const rows = [];

  const addInsight = (text, color) => {
    const row = document.createElement('div');
    row.className = 'insight-row';
    const dot = document.createElement('span');
    dot.className = 'insight-dot';
    dot.style.background = color;
    const span = document.createElement('span');
    span.textContent = text;
    row.appendChild(dot);
    row.appendChild(span);
    rows.push(row);
  };

  // ISO week key for a date (Mon-based)
  const weekKey = d => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };

  const days = window.snapActivityDays || [];

  // ── Check 1: Sleep score vs weight loss ──────────────────────────
  if (allData.length >= 28 && days.length >= 6) {
    const weightByWeek = {};
    allData.forEach(r => {
      const k = weekKey(r.date);
      if (!weightByWeek[k]) weightByWeek[k] = [];
      weightByWeek[k].push(r.weight);
    });

    const sleepByWeek = {};
    days.forEach(d => {
      if (d.sleepScore == null) return;
      const k = weekKey(new Date(d.date || d.lastUpdated || d.updatedAt));
      if (!sleepByWeek[k]) sleepByWeek[k] = [];
      sleepByWeek[k].push(d.sleepScore);
    });

    const weeks = Object.keys(weightByWeek).filter(k => sleepByWeek[k] && weightByWeek[k].length >= 2);
    const weekData = weeks.map(k => {
      const ws = weightByWeek[k];
      const loss = ws[0] - ws[ws.length - 1];
      const avgSleep = sleepByWeek[k].reduce((a, b) => a + b, 0) / sleepByWeek[k].length;
      return { loss, avgSleep };
    });

    const high = weekData.filter(w => w.avgSleep > 75);
    const low  = weekData.filter(w => w.avgSleep <= 75);
    if (high.length >= 3 && low.length >= 3) {
      const avgHigh = high.reduce((a, b) => a + b.loss, 0) / high.length;
      const avgLow  = low.reduce((a, b) => a + b.loss, 0) / low.length;
      const diff = avgHigh - avgLow;
      if (diff > 0.3) {
        addInsight(
          `On weeks where sleep score averaged above 75, you lost ${diff.toFixed(1)} lbs more than on lower-sleep weeks.`,
          '#2a8703'
        );
      }
    }
  }

  // ── Check 2: Stress vs glucose ───────────────────────────────────
  if (days.length >= 10 && window.snapGlucoseNow != null) {
    const stressDays = days.filter(d => d.stressLevel != null && d.sleepScore != null);
    const high = stressDays.filter(d => d.stressLevel > 60);
    const low  = stressDays.filter(d => d.stressLevel <= 60);
    if (high.length >= 5 && low.length >= 5) {
      const avgHigh = high.reduce((a, b) => a + (b.avgGlucose || b.glucose || 0), 0) / high.length;
      const avgLow  = low.reduce((a, b) => a + (b.avgGlucose || b.glucose || 0), 0) / low.length;
      const diff = avgHigh - avgLow;
      if (diff > 10) {
        addInsight(
          `High-stress days show glucose averaging ${Math.round(diff)} mg/dL higher.`,
          '#995213'
        );
      }
    }
  }

  // ── Check 3: Steps vs weight loss ───────────────────────────────
  if (allData.length >= 14 && days.length >= 4) {
    const stepsByWeek = {};
    days.forEach(d => {
      if (!d.steps) return;
      const k = weekKey(new Date(d.date || d.lastUpdated || d.updatedAt));
      if (!stepsByWeek[k]) stepsByWeek[k] = 0;
      stepsByWeek[k] += d.steps;
    });

    const weightByWeek2 = {};
    allData.forEach(r => {
      const k = weekKey(r.date);
      if (!weightByWeek2[k]) weightByWeek2[k] = [];
      weightByWeek2[k].push(r.weight);
    });

    const weeks = Object.keys(stepsByWeek).filter(k => weightByWeek2[k] && weightByWeek2[k].length >= 2);
    const weekData = weeks.map(k => {
      const ws = weightByWeek2[k];
      return { loss: ws[0] - ws[ws.length - 1], steps: stepsByWeek[k] };
    });

    const active   = weekData.filter(w => w.steps >= 60000);
    const inactive = weekData.filter(w => w.steps < 60000);
    if (active.length >= 2 && inactive.length >= 2) {
      const avgActive   = active.reduce((a, b) => a + b.loss, 0) / active.length;
      const avgInactive = inactive.reduce((a, b) => a + b.loss, 0) / inactive.length;
      const diff = avgActive - avgInactive;
      if (diff > 0.2) {
        addInsight(
          `Weeks with 60,000+ steps show faster weight loss (${diff.toFixed(1)} lbs/week more on average).`,
          '#0053e2'
        );
      }
    }
  }

  // ── Check 4: Sleep hours → next-morning weight change ───────────────────
  if (days.length >= 14 && allData.length >= 14) {
    const byDay = {};
    allData.forEach(r => {
      const k = r.date.toLocaleDateString('en-CA');
      if (!byDay[k] || r.date > byDay[k].date) byDay[k] = r;
    });
    const pairs = [];
    days.forEach(d => {
      const sleepH = d.sleepHours;
      if (!sleepH || sleepH < 2) return;
      const dateStr = (d.date || d.lastUpdated || d.updatedAt || '').slice(0, 10);
      if (!dateStr) return;
      const nextDay = new Date(dateStr + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextKey = nextDay.toLocaleDateString('en-CA');
      const prevKey = dateStr;
      if (byDay[nextKey] && byDay[prevKey]) {
        const delta = byDay[nextKey].weight - byDay[prevKey].weight;
        pairs.push({ sleepH, delta });
      }
    });
    const good = pairs.filter(p => p.sleepH >= 7);
    const poor = pairs.filter(p => p.sleepH < 7);
    if (good.length >= 5 && poor.length >= 5) {
      const avgGood = good.reduce((s, p) => s + p.delta, 0) / good.length;
      const avgPoor = poor.reduce((s, p) => s + p.delta, 0) / poor.length;
      const diff = avgPoor - avgGood; // positive = poor sleep nights → higher next-day weight
      if (diff > 0.15) {
        addInsight(
          `After 7+ hours of sleep you weigh ~${diff.toFixed(1)} lbs less the next morning vs nights under 7h.`,
          '#7c3aed'
        );
      }
    }
  }

  // ── Check 5: Day-over-day steps → next-morning weight ───────────────────
  if (days.length >= 14 && allData.length >= 14) {
    const byDay2 = {};
    allData.forEach(r => {
      const k = r.date.toLocaleDateString('en-CA');
      if (!byDay2[k] || r.date > byDay2[k].date) byDay2[k] = r;
    });
    const pairs2 = [];
    days.forEach(d => {
      const steps = d.steps;
      if (!steps) return;
      const dateStr = (d.date || d.lastUpdated || d.updatedAt || '').slice(0, 10);
      if (!dateStr) return;
      const nextDay = new Date(dateStr + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextKey = nextDay.toLocaleDateString('en-CA');
      const prevKey = dateStr;
      if (byDay2[nextKey] && byDay2[prevKey]) {
        pairs2.push({ steps, delta: byDay2[nextKey].weight - byDay2[prevKey].weight });
      }
    });
    const active2   = pairs2.filter(p => p.steps >= 10000);
    const inactive2 = pairs2.filter(p => p.steps < 10000);
    if (active2.length >= 5 && inactive2.length >= 5) {
      const avgA = active2.reduce((s, p)   => s + p.delta, 0) / active2.length;
      const avgI = inactive2.reduce((s, p) => s + p.delta, 0) / inactive2.length;
      const diff = avgI - avgA; // positive = low-step days → higher next-morning weight
      if (diff > 0.1) {
        addInsight(
          `On days you hit 10k+ steps, the next morning scale reads ~${diff.toFixed(1)} lbs lower than low-step days.`,
          '#0053e2'
        );
      }
    }
  }

  rows.forEach(r => list.appendChild(r));
  empty.style.display = rows.length > 0 ? 'none' : '';
}
