/* ════════════════════════════════════════════════════════════════════
   app-goal.js — Goal target tracking + Weight Projector
   Both deal with "where am I going" so they're co-located.
   ──────────────────────────────────────────────────────────────────── */

// ── Render goal section ──────────────────────────────────────────────
function renderGoal(latest, data = []) {
  const content = el('goal-content');
  const empty   = el('goal-empty');
  if (!goalWeight) {
    content.style.display = 'none';
    empty.style.display   = 'block';
    return;
  }
  content.style.display = 'block';
  empty.style.display   = 'none';

  const remaining   = Math.max(0, latest.weight - goalWeight);
  const totalToLose = START_WEIGHT - goalWeight;
  const lost        = START_WEIGHT - latest.weight;
  const pct         = totalToLose > 0 ? Math.min(100, Math.max(0, (lost / totalToLose) * 100)) : 0;

  countUp('goal-target',    goalWeight,  1);
  countUp('goal-remaining', remaining,   1);
  countUp('goal-pct',       pct,         0, '%');
  el('goal-bar').style.width = pct + '%';
  el('goal-bar').textContent = pct >= 10 ? Math.round(pct) + '%' : '';

  if (remaining <= 0) {
    setText('goal-eta', '🎉 Goal reached!');
    return;
  }

  // Use overall journey average for a stable, realistic ETA
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = (latest.date - startDate) / 86400000;
  const totalLostJourney = START_WEIGHT - latest.weight;

  if (totalDaysElapsed > 0 && totalLostJourney > 0) {
    const lbsPerDay   = totalLostJourney / totalDaysElapsed;
    const daysLeft    = remaining / lbsPerDay;
    const projDate    = new Date(latest.date.getTime() + daysLeft * 86400000);
    const weeklyRate  = lbsPerDay * 7;
    setText('goal-eta',
      `losing ~${weeklyRate.toFixed(1)} lbs/wk avg · projected ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  } else {
    const weeksLeft = Math.ceil(remaining / 1.5);
    const estDate   = new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
    setText('goal-eta', `~${weeksLeft} wk${weeksLeft !== 1 ? 's' : ''} at 1.5 lbs/wk · est. ${fmtDate(estDate)}`);
  }
}

// ── Goal persistence ─────────────────────────────────────────────────
function loadGoal() {
  try {
    const g = localStorage.getItem('wt_v2_goal');
    if (g) { goalWeight = parseFloat(g); el('goal-input').value = goalWeight; }
  } catch {}
}
function setGoal() {
  const v = parseFloat(el('goal-input').value);
  if (isNaN(v) || v <= 0) return;
  goalWeight = v;
  localStorage.setItem('wt_v2_goal', goalWeight);
  if (allData.length) {
    renderGoal(allData[allData.length - 1], allData);
    renderWeightChart(allData);
  }
}
function clearGoal() {
  goalWeight = null;
  el('goal-input').value = '';
  localStorage.removeItem('wt_v2_goal');
  if (allData.length) {
    renderGoal(allData[allData.length - 1], allData);
    renderWeightChart(allData);
  }
}
window.setGoal   = setGoal;
window.clearGoal = clearGoal;

// ── Weight Projector ─────────────────────────────────────────────────
function computeProjection() {
  const dateInput   = document.getElementById('proj-date-input');
  const weightInput = document.getElementById('proj-weight-input');
  const dateResult  = document.getElementById('proj-date-result');
  const weightResult= document.getElementById('proj-weight-result');

  const noTrend = () => {
    if (dateResult)   dateResult.textContent   = 'Need more data (< 30 days of readings)';
    if (weightResult) weightResult.textContent = 'Need more data (< 30 days of readings)';
  };

  if (!projSlopeLbsPerDay || !projLatestWeight || !projLatestDate) {
    noTrend(); return;
  }

  const MS_PER_DAY = 86_400_000;

  // ── Date → Projected weight ──
  if (dateInput && dateResult) {
    const targetDate = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : null;
    if (!targetDate || isNaN(targetDate)) {
      dateResult.textContent = 'Pick a date above';
    } else {
      const daysDiff    = (targetDate - projLatestDate) / MS_PER_DAY;
      const projected   = projLatestWeight + projSlopeLbsPerDay * daysDiff;
      const isFuture    = daysDiff > 0;
      const rounded     = Math.round(projected * 10) / 10;
      if (!isFuture) {
        dateResult.textContent = 'Pick a future date';
      } else if (rounded < 100) {
        dateResult.textContent = "Way beyond goal — you'd be a ghost 👻";
      } else {
        const dateLabel  = targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const lostNow    = projLatestWeight - rounded;          // change from current
        const lostTotal  = START_WEIGHT - rounded;              // total from 315.0
        const lostNowStr = lostNow > 0
          ? `▼ ${fmt(lostNow)} lbs from now`
          : `▲ ${fmt(Math.abs(lostNow))} lbs from now`;
        dateResult.textContent = `~${fmt(rounded)} lbs on ${dateLabel} · ${lostNowStr} · ✅ ${fmt(lostTotal)} lbs lost from ${START_WEIGHT}`;
        dateResult.style.color = lostNow > 0 ? '#2a8703' : '#ea1100';
      }
    }
  }

  // ── Weight slider → Projected date + countdown card ──
  if (weightInput && weightResult) {
    const targetW   = parseFloat(weightInput.value);
    const disp      = document.getElementById('proj-slider-display');
    const countdown = document.getElementById('proj-countdown');

    if (disp) disp.textContent = isNaN(targetW) ? '—' : targetW.toFixed(1);

    const hide = (msg, color = '#ea1100') => {
      if (countdown) countdown.style.display = 'none';
      weightResult.textContent  = msg;
      weightResult.style.color  = color;
    };

    if (isNaN(targetW)) {
      hide('', '#6d7a95');
    } else if (targetW >= projLatestWeight) {
      hide('Slide below your current weight');
    } else if (projSlopeLbsPerDay >= 0) {
      hide('Trend is flat or gaining — projection unavailable');
    } else {
      const daysNeeded = (projLatestWeight - targetW) / Math.abs(projSlopeLbsPerDay);
      const arrivalDate = new Date(projLatestDate.getTime() + daysNeeded * MS_PER_DAY);
      const dateLabel   = arrivalDate.toLocaleDateString('en-US',
        { month: 'long', day: 'numeric', year: 'numeric' });
      const daysRounded = Math.round(daysNeeded);
      const totalLost   = START_WEIGHT - targetW;
      const stillToGo   = projLatestWeight - targetW;

      if (countdown) {
        countdown.style.display = 'block';
        document.getElementById('proj-cd-date').textContent  = dateLabel;
        document.getElementById('proj-cd-days').textContent  =
          `${daysRounded} day${daysRounded !== 1 ? 's' : ''}`;
        document.getElementById('proj-cd-total').textContent =
          `${fmt(totalLost)} lbs from ${START_WEIGHT}`;
        document.getElementById('proj-cd-togo').textContent  =
          `${fmt(stillToGo)} lbs`;
      }
      weightResult.textContent = '';
    }
  }
}
window.computeProjection = computeProjection;
