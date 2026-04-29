/* ════════════════════════════════════════════════════════════════════
   app-kpis.js — KPI cards, journey progress, milestones, BMI timeline,
                 trend hero (Happy Scale), streak, calories, time range
   ──────────────────────────────────────────────────────────────────── */

// ── Render KPI cards ─────────────────────────────────────────────────
function renderKPIs(latest, prev) {
  countUp('kpi-weight', latest.weight, 1);
  const wd = prev ? latest.weight - prev.weight : null;
  setHTML('kpi-weight-sub', wd != null ? delta(wd) + ' lbs from last' : '');

  countUp('kpi-bmi', latest.bmi, 2);
  if (latest.bmi) {
    const [cat, style] = bmiCategory(latest.bmi);
    const bd = prev?.bmi ? latest.bmi - prev.bmi : null;
    setHTML('kpi-bmi-sub', `<span class="badge" style="${style}">${cat}</span>${bd != null ? ' ' + delta(bd) : ''}`);
    // Dynamic tone: green=normal, gold=overweight/obese-I, red=obese-II+
    // The card visually celebrates progress as the BMI drops through tiers.
    const card = el('kpi-bmi-card');
    if (card) {
      const tone = latest.bmi >= 35 ? 'red'
                 : latest.bmi >= 25 ? 'gold'
                 : 'green';
      card.classList.remove('kpi--red', 'kpi--gold', 'kpi--green');
      card.classList.add('kpi--' + tone);
    }
  }

  latest.bodyFat ? countUp('kpi-fat', latest.bodyFat, 1, '%') : setText('kpi-fat', '—');
  const fd = prev?.bodyFat ? latest.bodyFat - prev.bodyFat : null;
  setHTML('kpi-fat-sub', fd != null ? delta(fd) + '% from last' : '');

  latest.muscle ? countUp('kpi-muscle', latest.muscle, 1, '%') : setText('kpi-muscle', '—');
  const md = prev?.muscle ? latest.muscle - prev.muscle : null;
  setHTML('kpi-muscle-sub', md != null ? delta(md, false) + '% from last' : '');

  latest.water ? countUp('kpi-water', latest.water, 0, '%') : setText('kpi-water', '—');
  const wad = prev?.water ? latest.water - prev.water : null;
  setHTML('kpi-water-sub', wad != null ? delta(wad, false) + '% from last' : '');

  latest.bone ? countUp('kpi-bone', latest.bone, 2) : setText('kpi-bone', '—');

  const energy = calcTDEE(latest);
  if (energy) {
    countUp('kpi-bmr',  energy.bmr,  0);
    countUp('kpi-tdee', energy.tdee, 0);
  } else {
    setText('kpi-bmr',  '—');
    setText('kpi-tdee', '—');
  }
}

// ── Journey duration headline ────────────────────────────────────────
function renderJourneyDuration() {
  const start = new Date(START_DATE);
  const now   = new Date();
  const days  = Math.max(0, Math.floor((now - start) / 864e5));
  const weeks = Math.floor(days / 7);
  const months = (days / 30.44).toFixed(1);

  let milestone = '';
  if      (days < 7)   milestone = '🌱 Just getting started!';
  else if (days < 30)  milestone = '🔥 First month coming up!';
  else if (days < 60)  milestone = '💪 Over a month strong!';
  else if (days < 90)  milestone = '🚀 Closing in on 3 months!';
  else if (days < 180) milestone = '⭐ Crushing it!';
  else if (days < 365) milestone = '🏆 Half a year of hard work!';
  else                  milestone = '🎉 Over a year — legendary!';

  setText('journey-duration',
    `Day ${days} · Week ${weeks} · ${months} months · ${milestone}`);
}

// ── Render journey progress ──────────────────────────────────────────
function renderJourney(latest, data) {
  renderJourneyDuration();
  const lost = Math.max(0, START_WEIGHT - latest.weight);
  const pct  = Math.min(100, Math.max(0, (lost / START_WEIGHT) * 100));

  countUp('journey-current',  latest.weight, 1);
  setText('journey-date',     fmtDate(latest.date));
  countUp('journey-lost',     lost, 1);
  countUp('journey-pct-stat', pct, 1, '%');

  const bar = el('journey-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.textContent = pct >= 8 ? Math.round(pct) + '%' : '';
    // Progress bar gradient: red → amber → yellow → green as journey advances.
    // Scale the gradient so the colour at the leading edge matches progress.
    const pctSafe = Math.max(1, pct);
    bar.style.background = `linear-gradient(
      90deg,
      #ea1100 0%,
      #ffc220 ${Math.min(100, (50 / pctSafe) * 100)}%,
      #2a8703 ${Math.min(100, (100 / pctSafe) * 100)}%
    )`;
  }
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);

  // Compute & expose current 30-day trend for projector + ETA math.
  const slopePerDay = weightTrendSlope(data);
  projSlopeLbsPerDay = slopePerDay;
  projLatestWeight   = latest.weight;
  projLatestDate     = latest.date;

  // Sync projector slider bounds with current weight
  const slider = document.getElementById('proj-weight-input');
  if (slider) {
    const maxVal = Math.floor(projLatestWeight) - 1;
    slider.max   = maxVal;
    const maxLbl = document.getElementById('proj-slider-max');
    if (maxLbl) maxLbl.textContent = maxVal;
    if (parseFloat(slider.value) >= projLatestWeight) {
      slider.value = goalWeight && goalWeight < projLatestWeight
        ? goalWeight
        : Math.round(projLatestWeight - 20);
    }
    const disp = document.getElementById('proj-slider-display');
    if (disp) disp.textContent = parseFloat(slider.value).toFixed(1);
  }

  // Projector blurb with current trend rate
  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb) {
    if (slopePerDay !== null) {
      const wkRate = Math.abs(slopePerDay * 7).toFixed(1);
      const dir    = slopePerDay < 0 ? 'losing' : 'gaining';
      blurb.textContent = `Based on your 30-day trend — currently ${dir} ~${wkRate} lbs/week`;
    } else {
      blurb.textContent = 'Not enough data yet for a trend (need ~30 days of readings)';
    }
  }

  // Avg rate: total loss from START_WEIGHT ÷ total elapsed days
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = (latest.date - startDate) / 86400000;
  const totalLostJourney = START_WEIGHT - latest.weight;

  if (totalDaysElapsed > 0 && totalLostJourney > 0) {
    const lbsPerWeek = (totalLostJourney / totalDaysElapsed) * 7;
    countUp('journey-rate', lbsPerWeek, 1);
    const weeksElapsed = Math.floor(totalDaysElapsed / 7);
    setText('journey-rate-sub', `lbs/wk · overall avg across ${weeksElapsed} weeks`);
  } else {
    setText('journey-rate', '—');
    setText('journey-rate-sub', 'not enough data yet');
  }

  // Personal best (all-time lowest weight)
  const best = data.reduce((b, r) => r.weight < b.weight ? r : b, data[0]);
  countUp('journey-best', best.weight, 1);
  setText('journey-best-date', fmtDate(best.date));

  // Next milestone ETA
  const allTimeLow = Math.min(...data.map(r => r.weight));
  const floor  = goalWeight ? Math.floor(goalWeight / 10) * 10 : 220;
  const steps  = [];
  for (let w = Math.floor(START_WEIGHT / 10) * 10; w >= floor; w -= 10) steps.push(w);
  const nextMilestone = steps.find(w => allTimeLow > w);
  if (nextMilestone && slopePerDay && slopePerDay < 0) {
    const remaining = latest.weight - nextMilestone;
    const daysLeft  = remaining / Math.abs(slopePerDay);
    const projDate  = new Date(latest.date.getTime() + daysLeft * 86400000);
    setText('journey-next-eta',
      `${nextMilestone} lbs · ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  } else {
    setText('journey-next-eta', nextMilestone ? `${nextMilestone} lbs` : '🎉 All done!');
  }
  computeBestWeek(data);
  computeProjection();
}

// ── Section toggles (collapse/expand chevrons) ───────────────────────
function toggleWeightTrend() {
  const body    = document.getElementById('weight-trend-body');
  const chevron = document.getElementById('weight-trend-chevron');
  const toggle  = document.getElementById('weight-trend-toggle');
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  body.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
  if (isOpen === false && typeof renderWeightChart === 'function' && allData.length) {
    setTimeout(() => renderWeightChart(allData), 0);
  }
}

function toggleMilestones() {
  const row     = document.getElementById('milestones-row');
  const chevron = document.getElementById('milestones-chevron');
  const toggle  = document.getElementById('milestones-toggle');
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  row.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
}

function toggleBMI() {
  const timeline = document.getElementById('bmi-timeline');
  const chevron  = document.getElementById('bmi-chevron');
  const toggle   = document.getElementById('bmi-toggle');
  const isOpen   = toggle.getAttribute('aria-expanded') === 'true';
  timeline.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
}

// ── Best Week computation ────────────────────────────────────────────
function computeBestWeek(readings) {
  const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let bestLoss = -Infinity;
  let bestStart = null, bestEnd = null;

  for (let i = 0; i < readings.length; i++) {
    const end = readings[i];
    // Find the reading closest to 7 days before this one
    const target = end.date.getTime() - 7 * 86400000;
    let closest = null;
    for (let j = i - 1; j >= 0; j--) {
      const diff = Math.abs(readings[j].date.getTime() - target);
      if (!closest || diff < Math.abs(readings[j + 1 <= i - 1 ? j + 1 : j].date.getTime() - target)) {
        closest = readings[j];
        if (readings[j].date.getTime() <= target) break;
      }
    }
    if (!closest) continue;
    const daySpan = (end.date - closest.date) / 86400000;
    if (daySpan < 4 || daySpan > 10) continue;
    const loss = closest.weight - end.weight;
    if (loss > bestLoss) {
      bestLoss = loss;
      bestStart = closest.date;
      bestEnd = end.date;
    }
  }

  if (bestStart && bestLoss > 0) {
    setText('best-week-loss', '−' + bestLoss.toFixed(1) + ' lbs');
    setText('best-week-dates', fmtShort(bestStart) + ' – ' + fmtShort(bestEnd));
  }
}

// ── Milestones ───────────────────────────────────────────────────────
function renderMilestones(latest, data) {
  const row = el('milestones-row');
  if (!row) return;
  const allTimeLow = Math.min(...data.map(d => d.weight));
  // Build milestones every 10 lbs from START_WEIGHT down to goal or 220
  const floor = goalWeight ? Math.floor(goalWeight / 10) * 10 : 220;
  const steps = [];
  for (let w = Math.floor(START_WEIGHT / 10) * 10; w >= floor; w -= 10) steps.push(w);
  const nextIdx = steps.findIndex(w => allTimeLow > w);
  row.innerHTML = steps.map((w, i) => {
    const done   = allTimeLow <= w;   // earned if all-time low crossed it
    const isCurr = i === nextIdx;
    const cls    = done ? 'done' : isCurr ? 'current' : 'future';
    const icon   = done ? '✓' : isCurr ? '▼' : w;
    return `<div class="milestone-ring ${cls}">
      <div class="milestone-circle">${icon}</div>
      <div class="milestone-label">${w} lbs</div>
    </div>`;
  }).join('');
}

// ── BMI Timeline ─────────────────────────────────────────────────────
function renderBMITimeline(data, latest) {
  const box = el('bmi-timeline');
  if (!box || !latest.bmi || !latest.weight) return;
  const weightKg = latest.weight / 2.205;
  const heightM  = Math.sqrt(weightKg / latest.bmi);
  const slope = weightTrendSlope(data); // lbs/day
  const bmiSlopePerDay = slope ? slope / (2.205 * heightM * heightM) : null;
  const currentBmi = latest.bmi;
  box.innerHTML = BMI_CATS.slice().reverse().map(cat => {
    const bmiThreshold = cat.max === Infinity ? null : cat.max;
    const isCurrentCat = bmiThreshold
      ? currentBmi < bmiThreshold && currentBmi >= (BMI_CATS[BMI_CATS.findIndex(c => c.max === cat.max) - 1]?.max ?? 0)
      : currentBmi >= 40;
    const passed = currentBmi < cat.min;
    let dateStr = '';
    if (!passed && !isCurrentCat && bmiThreshold && bmiSlopePerDay && bmiSlopePerDay < 0) {
      const bmiToLose = currentBmi - bmiThreshold;
      const daysLeft  = bmiToLose / Math.abs(bmiSlopePerDay);
      const proj      = new Date(latest.date.getTime() + daysLeft * 86400000);
      dateStr = proj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const cls = passed ? 'achieved' : isCurrentCat ? 'current' : 'future';
    const statusIcon = passed ? '✓' : isCurrentCat ? '▶' : '';
    const bmiToLbs = b => Math.round(b * heightM * heightM * 2.205);
    const minLbs = bmiToLbs(cat.min);
    const maxLbs = cat.max === Infinity ? null : bmiToLbs(cat.max);
    const wtRange = maxLbs ? `${minLbs}–${maxLbs} lbs` : `${minLbs}+ lbs`;
    return `<div class="bmi-step ${cls}">
      <span class="bmi-step-icon">${cat.icon}</span>
      <div class="bmi-step-info">
        <div class="bmi-step-cat">${statusIcon ? statusIcon + ' ' : ''}${cat.label}</div>
        <div class="bmi-step-range">${cat.range} &middot; ${wtRange}</div>
      </div>
      <div class="bmi-step-date">${passed ? '✅ Cleared' : isCurrentCat ? '📍 You are here' : dateStr ? 'Est. ' + dateStr : '—'}</div>
    </div>`;
  }).join('');
}

// ── Happy Scale: Trend hero + decade badge ───────────────────────────
function renderTrendHero(data) {
  const byDay  = {};
  data.forEach(r => { byDay[r.date.toDateString()] = r; });
  const daily  = Object.values(byDay).sort((a, b) => a.date - b.date);
  const vals   = daily.map(r => r.weight);
  const avg7   = movingAvg(vals, 7);
  const trend  = avg7[avg7.length - 1];
  const raw    = daily[daily.length - 1]?.weight;

  // Direction: compare latest 7-day avg vs 7 days ago
  const prevTrend = avg7.length > 7 ? avg7[avg7.length - 8] : null;
  const dir = prevTrend == null ? 'neutral'
    : trend < prevTrend - 0.05 ? 'down'
    : trend > prevTrend + 0.05 ? 'up'
    : 'neutral';

  const trendEl = el('trend-value');
  if (trendEl) {
    trendEl.className = `trend-value ${dir}`;
    countUp('trend-value', trend, 1);
  }
  setText('trend-raw', fmt(raw));
  const dirLabel = dir === 'down' ? '↓ trending down 🟢'
                 : dir === 'up'   ? '↑ trending up 🔴'
                 : '— holding steady';
  setText('trend-dir', dirLabel);

  // Decade badge: e.g. "You're in the 280s!"
  const badge = el('decade-badge');
  if (badge && trend != null) {
    const decade = Math.floor(trend / 10) * 10;
    badge.style.display = 'block';
    badge.innerHTML = `You're in the<br><strong>${decade}s!</strong>`;
  }
}

// ── Happy Scale: Time range pills ────────────────────────────────────
function setRange(r) {
  chartRange = r;
  document.querySelectorAll('.range-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.range === r));
  if (allData.length) renderWeightChart(allData);
}
window.setRange = setRange;

// ── Streak card ──────────────────────────────────────────────────────
function renderStreak(data) {
  const streak = calcStreak(data);
  setText('streak-count', streak);
  setText('streak-label', streak === 1 ? 'day streak 🔥' : 'days in a row 🔥');
  setText('streak-total', data.length + ' total readings');
}

// ── Calorie insights ─────────────────────────────────────────────────
function renderCalories(latest) {
  const energy = calcTDEE(latest);
  if (!energy) return;
  countUp('cal-maintain', energy.tdee,        0);
  countUp('cal-lose1',    energy.tdee - 500,  0);
  countUp('cal-lose2',    energy.tdee - 1000, 0);
}
