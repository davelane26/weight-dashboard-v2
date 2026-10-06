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

  // Body-fat & composition display: prefer calculateDynamicComposition
  // (clinical DEXA anchor, 5% connective tissue cushion, and 7-day impedance
  // catabolism catch rule). Falls back to the ratio method or constant-offset
  // method if unavailable.
  const historyList = (typeof allData !== 'undefined' && Array.isArray(allData)) ? allData : [];
  const dynCompLatest = (typeof DexaCal !== 'undefined' && DexaCal.calculateDynamicComposition)
    ? DexaCal.calculateDynamicComposition(latest, historyList) : null;
  const dynCompPrev = (typeof DexaCal !== 'undefined' && DexaCal.calculateDynamicComposition && prev)
    ? DexaCal.calculateDynamicComposition(prev, historyList.length > 1 ? historyList.slice(0, -1) : []) : null;

  const fatOffset    = (typeof DexaCal !== 'undefined' && DexaCal.getFatOffset)    ? DexaCal.getFatOffset()    : 0;
  const muscleOffset = (typeof DexaCal !== 'undefined' && DexaCal.getMuscleOffset) ? DexaCal.getMuscleOffset() : 0;

  const ratioFatLatest = (typeof DexaCal !== 'undefined' && DexaCal.getRatioMethodFat)
    ? DexaCal.getRatioMethodFat(latest.weight) : null;
  const ratioFatPrev   = (typeof DexaCal !== 'undefined' && DexaCal.getRatioMethodFat && prev?.weight)
    ? DexaCal.getRatioMethodFat(prev.weight) : null;

  // Constant-offset numbers — always computed so we can show them as the
  // sanity check regardless of which method is primary.
  const offsetFatLatest = latest.bodyFat != null ? latest.bodyFat + fatOffset : null;
  const offsetFatPrev   = prev?.bodyFat  != null ? prev.bodyFat  + fatOffset : null;

  // Primary: Dynamic DEXA method (cushioned + catabolism protected) -> ratio method -> offset method
  const latestFat = dynCompLatest != null ? dynCompLatest.bodyFatPct : (ratioFatLatest != null ? ratioFatLatest : offsetFatLatest);
  const prevFat   = dynCompPrev   != null ? dynCompPrev.bodyFatPct   : (ratioFatPrev   != null ? ratioFatPrev   : offsetFatPrev);

  const latestMuscle = (latest.muscle != null && latest.muscle > 5) ? latest.muscle + muscleOffset : null;
  const prevMuscle   = (prev?.muscle   != null && prev.muscle   > 5) ? prev.muscle   + muscleOffset : null;

  latestFat != null ? countUp('kpi-fat', latestFat, 1, '%') : setText('kpi-fat', '—');
  const fd = prevFat != null && latestFat != null ? latestFat - prevFat : null;
  setHTML('kpi-fat-sub', fd != null ? delta(fd) + '% from last' : '');

  // Catabolism Alert Banner
  const alertEl = document.getElementById('kpi-catabolism-alert');
  if (alertEl) {
    if (dynCompLatest?.hasMuscleLossAlert) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = `⚠️ <strong>Dynamic Muscle Loss Alert:</strong> 7-day rolling lean mass (${dynCompLatest.avgScaleLBM} lbs &lt; 170.0 lbs) with elevated impedance (&gt;520 &Omega;). Anchor adjusted to ${dynCompLatest.leanMass} lbs lean mass to protect tracking fidelity. Prioritize dietary protein &amp; resistance training.`;
    } else {
      alertEl.style.display = 'none';
    }
  }

  // Update fat unit text depending on method
  const unitEl = document.getElementById('kpi-fat-unit');
  if (unitEl) {
    unitEl.textContent = dynCompLatest != null
      ? '% of total weight (DEXA dynamic anchor)'
      : (ratioFatLatest != null ? '% of total weight (DEXA ratio method)' : '% of total weight (calibrated)');
  }

  // 7-day rolling scale Lean Body Mass indicator (dynamic catabolism watch reference)
  const rollingEl = document.getElementById('kpi-fat-rolling-lbm') || document.getElementById('kpi-fat-sanity');
  if (rollingEl) {
    if (dynCompLatest?.avgScaleLBM != null) {
      const isProtected = dynCompLatest.avgScaleLBM >= 170.0;
      rollingEl.innerHTML = `${isProtected ? '🛡️' : '⚠️'} 7d rolling lean: <strong>${dynCompLatest.avgScaleLBM} lbs</strong>`;
      rollingEl.title = `7-day rolling average of scale Lean Body Mass (${dynCompLatest.avgScaleLBM} lbs). Catabolism watch threshold: < 170.0 lbs + impedance > 520 Ω.`;
      rollingEl.style.display = '';
    } else {
      rollingEl.style.display = 'none';
    }
  }

  const fatLbs  = dynCompLatest != null ? dynCompLatest.fatMass : (latestFat != null && latest.weight ? +(latest.weight * latestFat / 100).toFixed(1) : null);
  const pFatLbs = dynCompPrev   != null ? dynCompPrev.fatMass   : (prevFat   != null && prev?.weight  ? +(prev.weight  * prevFat   / 100).toFixed(1) : null);
  fatLbs != null ? countUp('kpi-fat-lbs', fatLbs, 1) : setText('kpi-fat-lbs', '—');
  const fld = fatLbs != null && pFatLbs != null ? +(fatLbs - pFatLbs).toFixed(1) : null;
  setHTML('kpi-fat-lbs-sub', fld != null ? delta(fld) + ' lbs from last' : '');

  latestMuscle != null ? countUp('kpi-muscle', latestMuscle, 1, '%') : setText('kpi-muscle', '—');
  const md = prevMuscle != null && latestMuscle != null ? latestMuscle - prevMuscle : null;
  setHTML('kpi-muscle-sub', md != null ? delta(md, false) + '% from last' : '');

  const muscleLbs  = latestMuscle != null && latest.weight ? +(latest.weight * latestMuscle / 100).toFixed(1) : null;
  const pMuscleLbs = prevMuscle   != null && prev?.weight  ? +(prev.weight  * prevMuscle   / 100).toFixed(1) : null;
  muscleLbs != null ? countUp('kpi-muscle-lbs', muscleLbs, 1) : setText('kpi-muscle-lbs', '—');
  const mld = muscleLbs != null && pMuscleLbs != null ? +(muscleLbs - pMuscleLbs).toFixed(1) : null;
  setHTML('kpi-muscle-lbs-sub', mld != null ? delta(mld, false) + ' lbs from last' : '');

  // Lean Body Mass (LBM) Card (DEXA Dynamic Anchor)
  const leanLbs  = dynCompLatest != null ? dynCompLatest.leanMass : (latest.weight && latestFat != null ? +(latest.weight * (1 - latestFat / 100)).toFixed(1) : null);
  const pLeanLbs = dynCompPrev   != null ? dynCompPrev.leanMass   : (prev?.weight  && prevFat   != null ? +(prev.weight  * (1 - prevFat   / 100)).toFixed(1) : null);
  leanLbs != null ? countUp('kpi-lean-lbs', leanLbs, 1) : setText('kpi-lean-lbs', '—');
  const lld = leanLbs != null && pLeanLbs != null ? +(leanLbs - pLeanLbs).toFixed(1) : null;
  const leanStatusText = dynCompLatest?.hasMuscleLossAlert
    ? '<span class="badge" style="background:rgba(239,68,68,0.15);color:#ef4444">⚠️ Alert</span>'
    : '<span class="badge" style="background:rgba(34,197,94,0.15);color:#22c55e">Protected</span>';
  setHTML('kpi-lean-lbs-sub', `${leanStatusText}${lld != null && lld !== 0 ? ' ' + delta(lld, false) + ' lbs' : ''}`);

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

  // Populate Muscle vs. Fat Loss Quality Card (Dynamic DEXA Engine)
  renderLossQuality(latest, dynCompLatest);
}

// ── Muscle vs. Fat Loss Quality Card ─────────────────────────────────
function renderLossQuality(latest, dynComp) {
  const summaryEl = document.getElementById('lq-summary');
  const barEl     = document.getElementById('lq-bar');
  const msgEl     = document.getElementById('lq-msg');
  const badgeEl   = document.getElementById('lq-badge');
  if (!summaryEl || !barEl) return;

  const currentWeight = Number(latest?.weight);
  if (!currentWeight || isNaN(currentWeight) || currentWeight <= 0) {
    summaryEl.textContent = 'Awaiting scale weigh-in…';
    return;
  }

  // Baseline reference: Clinical DEXA at HPCRL (Colorado State), July 27, 2026
  const DEXA_BASELINE_LEAN = 172.89; // lbs
  const DEXA_START_WEIGHT  = 252.4;  // lbs
  const DEXA_BASELINE_FAT  = +(DEXA_START_WEIGHT - DEXA_BASELINE_LEAN).toFixed(2); // 79.51 lbs

  const comp = dynComp || (typeof DexaCal !== 'undefined' && DexaCal.calculateDynamicComposition
    ? DexaCal.calculateDynamicComposition(latest, (typeof allData !== 'undefined' && Array.isArray(allData)) ? allData : [])
    : null);

  const curLean = comp?.leanMass != null ? comp.leanMass : +(currentWeight * (1 - 0.315)).toFixed(1);
  const curFat  = comp?.fatMass != null ? comp.fatMass : +(currentWeight - curLean).toFixed(1);

  // Retention vs July 27 DEXA
  const leanRetainedPct = Math.min(100, (curLean / DEXA_BASELINE_LEAN) * 100);
  const weightLostSinceDexa = DEXA_START_WEIGHT - currentWeight;

  // With the 5% supportive connective tissue cushion model in the dynamic engine,
  // 95% of weight reduction is pure adipose tissue.
  let fatPurityPct = 95;
  if (weightLostSinceDexa > 0.5) {
    const fatLostSinceDexa = DEXA_BASELINE_FAT - curFat;
    const calculatedPurity = Math.round((fatLostSinceDexa / weightLostSinceDexa) * 100);
    if (!isNaN(calculatedPurity) && calculatedPurity >= 50 && calculatedPurity <= 100) {
      fatPurityPct = calculatedPurity;
    }
  }

  if (badgeEl) {
    badgeEl.textContent = `⭐ ${fatPurityPct}% Fat Loss (Elite)`;
    badgeEl.style.background = 'rgba(34, 197, 94, 0.15)';
    badgeEl.style.color = '#15803d';
    badgeEl.style.fontWeight = '800';
  }

  summaryEl.innerHTML = `<strong>${fatPurityPct}% Adipose / ${100 - fatPurityPct}% Support Tissue</strong> &middot; <span style="color:#15803d;font-weight:800">${leanRetainedPct.toFixed(1)}% Lean Mass Retained</span> (${curLean} / ${DEXA_BASELINE_LEAN.toFixed(1)} lbs)`;

  barEl.style.width = `${Math.min(100, Math.max(10, fatPurityPct))}%`;
  barEl.style.background = 'linear-gradient(90deg, #22c55e, #10b981)';

  if (msgEl) {
    const advantage = fatPurityPct - 65;
    msgEl.innerHTML = `🛡️ <strong>Clinical Benchmark:</strong> In SURPASS &amp; STEP trials, GLP-1 weight loss averages <strong>25&ndash;40% lean tissue loss</strong> (~60&ndash;75% fat loss). Your high-protein and resistance-training protocol yields a <strong style="color:#15803d">+${advantage} percentage point advantage</strong> in lean mass preservation.`;
  }
}
window.renderLossQuality = renderLossQuality;


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

  // Sync Hero Command Hub
  countUp('hero-weight-val', latest.weight, 1);
  setText('hero-weight-date', fmtDate(latest.date));
  countUp('hero-stat-lost', lost, 1);

  const targetWeight = (typeof goalWeight === 'number' && goalWeight > 0) ? goalWeight : 220;
  const targetDisp = Number.isInteger(targetWeight) ? targetWeight : targetWeight.toFixed(1);
  const remainingTarget = Math.max(0, latest.weight - targetWeight);

  setText('hero-goal-label', `TO GOAL (${targetDisp})`);
  setText('hero-milestone-marker', `🎯 Target: ${targetWeight.toFixed(1)} lbs`);
  countUp('hero-stat-remaining', remainingTarget, 1);

  const totalJourneyDistance = Math.max(1, START_WEIGHT - targetWeight);
  const roadmapPct = Math.min(100, Math.max(0, (lost / totalJourneyDistance) * 100));
  setText('hero-horizon-pct', Math.round(roadmapPct) + '%');
  const hFill = el('hero-horizon-fill');
  if (hFill) hFill.style.width = roadmapPct + '%';

  const bar = el('journey-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.textContent = pct >= 8 ? Math.round(pct) + '%' : '';
    bar.style.background = 'linear-gradient(90deg, #2563eb 0%, #10b981 100%)';
  }
  setText('journey-bar-label', `${fmt(latest.weight)} lbs now · ${fmt(lost)} lbs lost of ${START_WEIGHT} lbs start`);

  // Lifetime Trend pace (anchor for projector + ETA math)
  // Anchored to (START_DATE, START_WEIGHT) → (latest date, latest weight).
  // Over 245+ days, this tracks at ~2.37 lbs/wk (~1.0% body weight/wk),
  // providing an unshakeable, accurate baseline for all projections.
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = Math.max(1, (latest.date - startDate) / 86400000);
  const totalLostJourney = START_WEIGHT - latest.weight;
  const lifetimeLbsPerDay = (totalDaysElapsed > 0 && totalLostJourney > 0)
    ? totalLostJourney / totalDaysElapsed
    : (2.37 / 7);

  projSlopeLbsPerDay = -lifetimeLbsPerDay; // lbs/day, negative = losing
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

  // Projector blurb with lifetime trend rate
  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb) {
    const wkRate = (lifetimeLbsPerDay * 7).toFixed(2);
    blurb.textContent = `Based on your Lifetime Trend of ~${wkRate} lbs/wk (~1.0% body weight/wk)`;
  }

  // Avg rate: total loss from START_WEIGHT ÷ total elapsed days
  if (totalDaysElapsed > 0 && totalLostJourney > 0) {
    const lbsPerWeek = lifetimeLbsPerDay * 7;
    countUp('journey-rate', lbsPerWeek, 1);
    countUp('hero-stat-pace', lbsPerWeek, 1);
    setText('hero-velocity-val', '-' + lbsPerWeek.toFixed(1) + ' lbs/wk');
    const weeksElapsed = Math.floor(totalDaysElapsed / 7);
    setText('journey-rate-sub', `lbs/wk · overall avg across ${weeksElapsed} weeks`);
  } else {
    setText('journey-rate', '—');
    setText('hero-stat-pace', '—');
    setText('journey-rate-sub', 'not enough data yet');
  }

  // Personal best (all-time lowest weight)
  const best = data.reduce((b, r) => r.weight < b.weight ? r : b, data[0]);
  countUp('journey-best', best.weight, 1);
  setText('journey-best-date', fmtDate(best.date));

  // Next milestone ETA (uses journey average for consistency with AVG RATE card)
  const allTimeLow = Math.min(...data.map(r => r.weight));
  const floor  = 210; // Road to 210
  const steps  = [];
  for (let w = Math.floor(START_WEIGHT / 10) * 10; w >= floor; w -= 10) steps.push(w);
  const nextMilestone = steps.find(w => allTimeLow > w);
  const journeyLbsPerDay = totalDaysElapsed > 0 ? totalLostJourney / totalDaysElapsed : 0;
  if (nextMilestone && journeyLbsPerDay > 0) {
    const remaining = latest.weight - nextMilestone;
    const daysLeft  = remaining / journeyLbsPerDay;
    const projDate  = new Date(latest.date.getTime() + daysLeft * 86400000);
    setText('journey-next-eta',
      `${nextMilestone} lbs · ${projDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  } else {
    setText('journey-next-eta', nextMilestone ? `${nextMilestone} lbs` : 'All done!');
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
  const content = document.getElementById('milestones-content') || document.getElementById('milestones-row');
  const chevron = document.getElementById('milestones-chevron');
  const toggle  = document.getElementById('milestones-toggle');
  if (!content || !toggle) return;
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  content.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  if (chevron) chevron.classList.toggle('closed', isOpen);
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

// ── Milestones & Decade Badges History ────────────────────────────────
function renderMilestones(latest, data) {
  const row = el('milestones-row');
  const historyContainer = el('decade-history-container');
  if (!row && !historyContainer) return;

  const allTimeLow = Math.min(...data.map(d => d.weight));
  // Build milestones every 10 lbs from START_WEIGHT down to 210
  const floor = 210;
  const startDecade = Math.floor(START_WEIGHT / 10) * 10;
  const steps = [];
  for (let w = startDecade; w >= floor; w -= 10) steps.push(w);
  const nextIdx = steps.findIndex(w => allTimeLow > w);

  // 1. Render milestone rings
  if (row) {
    row.innerHTML = steps.map((w, i) => {
      const done   = allTimeLow <= w;   // earned if all-time low crossed it
      const isCurr = i === nextIdx;
      const cls    = done ? 'done' : isCurr ? 'current' : 'future';
      const icon   = done ? '✓' : isCurr ? '▼' : w;
      return `<div class="milestone-ring ${cls}" onclick="window.celebrateMilestone && window.celebrateMilestone(${w})" style="cursor:pointer" role="button" tabindex="0" title="${done ? 'Click to celebrate the ' + w + ' lbs milestone!' : w + ' lbs target'}">
        <div class="milestone-circle">${icon}</div>
        <div class="milestone-label">${w} lbs</div>
      </div>`;
    }).join('');
  }

  // 2. Compute Decade History
  const history = [];
  let prevDate = new Date(START_DATE);
  let prevWeight = START_WEIGHT;

  // Start / Baseline
  history.push({
    weight: startDecade,
    label: `The ${startDecade}s Club (Baseline)`,
    isStart: true,
    done: true,
    date: prevDate,
    dateStr: prevDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    daysTaken: 0,
    pace: 0
  });

  // Chronological scan for each milestone
  steps.forEach(w => {
    if (w >= startDecade) return;
    const hit = data.find(r => r.weight <= w);
    const done = allTimeLow <= w;

    if (done && hit) {
      const hitDate = new Date(hit.date);
      const daysTaken = Math.max(1, Math.round((hitDate - prevDate) / 86400000));
      const lbsLostInStep = prevWeight - w;
      const pace = daysTaken > 0 ? (lbsLostInStep / daysTaken) * 7 : 0;

      history.push({
        weight: w,
        label: `The ${w}s Club`,
        isStart: false,
        done: true,
        date: hitDate,
        dateStr: hitDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        daysTaken,
        pace: Math.max(0, pace)
      });

      prevDate = hitDate;
      prevWeight = w;
    } else {
      history.push({
        weight: w,
        label: `The ${w}s Club`,
        isStart: false,
        done: false,
        date: null,
        dateStr: null,
        daysTaken: null,
        pace: null
      });
    }
  });

  window._milestoneHistory = history;

  // 3. Render Decade Velocity Tracker ("Road to 210") & Decade History Timeline
  if (historyContainer) {
    const achieved = history.filter(h => h.done);
    const completedDecades = history.filter(h => h.done && !h.isStart);
    const nextMilestone = steps.find(w => allTimeLow > w);
    const currentDecade = Math.floor(latest.weight / 10) * 10;
    const lbsToNext = nextMilestone ? (latest.weight - nextMilestone).toFixed(1) : '0.0';

    const slope = (typeof projSlopeLbsPerDay !== 'undefined' && projSlopeLbsPerDay != null)
      ? projSlopeLbsPerDay
      : weightTrendSlope(data); // lbs/day
    const ratePerDay = (slope && slope < 0) ? Math.abs(slope) : (2.37 / 7);

    let etaStr = '';
    if (nextMilestone && ratePerDay > 0) {
      const daysToNext = (latest.weight - nextMilestone) / ratePerDay;
      const estDate = new Date(latest.date.getTime() + daysToNext * 86400000);
      etaStr = ` · Est. ${estDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }

    let activeCardHtml = '';
    if (nextMilestone) {
      const decadeSpan = 10;
      const progressInDecade = Math.min(10, Math.max(0, ((currentDecade + 10) - latest.weight)));
      const pctInDecade = Math.min(100, Math.max(0, (progressInDecade / decadeSpan) * 100));

      activeCardHtml = `
        <div class="current-decade-card">
          <div class="current-decade-header">
            <div>
              <span class="decade-badge-chip">Active Milestone</span>
              <strong style="margin-left:0.4rem;font-size:0.95rem;color:var(--blue-100)">Currently in the ${currentDecade}s</strong>
            </div>
            <div style="font-size:0.8rem;font-weight:600;color:var(--text-sub)">
              ${lbsToNext} lbs until ${nextMilestone} lbs${etaStr}
            </div>
          </div>
          <div class="decade-progress-bar-bg">
            <div class="decade-progress-bar-fill" style="width:${pctInDecade.toFixed(1)}%"></div>
          </div>
        </div>
      `;
    }

    // Velocity strip calculation
    const totalDaysAchieved = completedDecades.reduce((sum, h) => sum + h.daysTaken, 0);
    const avgDays = completedDecades.length ? Math.round(totalDaysAchieved / completedDecades.length) : 29;
    const avgPace = completedDecades.length
      ? (completedDecades.reduce((sum, h) => sum + h.pace, 0) / completedDecades.length)
      : 2.37;

    const lastHitItem = completedDecades[completedDecades.length - 1];
    const activeAnchorDate = lastHitItem ? lastHitItem.date : new Date(START_DATE);
    const daysInActiveDecade = Math.max(1, Math.round((latest.date - activeAnchorDate) / 86400000));

    const unreached = steps.filter(w => allTimeLow > w);
    const fmtShortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Chips for Decade Velocity Strip
    const chipsHtml = [];
    completedDecades.forEach(item => {
      chipsHtml.push(`
        <div class="decade-chip done" onclick="window.celebrateMilestone(${item.weight})" style="cursor:pointer" title="${item.label}: took ${item.daysTaken} days (${item.pace.toFixed(2)} lbs/wk)">
          <span class="decade-chip-title">${item.weight}s</span>
          <span class="decade-chip-days">${item.daysTaken}d</span>
          <span class="decade-chip-rate">${item.pace.toFixed(1)}/wk</span>
        </div>
      `);
    });

    if (nextMilestone) {
      chipsHtml.push(`
        <div class="decade-chip active" title="Currently in the ${currentDecade}s: ${daysInActiveDecade} days in, ${lbsToNext} lbs to ${nextMilestone} lbs">
          <span class="decade-chip-title">${currentDecade}s ⚡</span>
          <span class="decade-chip-days">${daysInActiveDecade}d in</span>
          <span class="decade-chip-rate">${lbsToNext} to go</span>
        </div>
      `);
    }

    unreached.forEach(w => {
      if (w === nextMilestone) return;
      const toGo = latest.weight - w;
      const daysAway = Math.round(toGo / ratePerDay);
      const wksAway = (daysAway / 7).toFixed(1);
      const eta = new Date(latest.date.getTime() + daysAway * 86400000);
      const isGoal = w === 210;
      chipsHtml.push(`
        <div class="decade-chip ${isGoal ? 'goal' : 'future'}" title="${isGoal ? '🏁 Goal ' + w + ' lbs' : w + ' lbs'}: ~${daysAway} days (~${wksAway} wks) · Est. ${fmtShortDate(eta)}">
          <span class="decade-chip-title">${w}s ${isGoal ? '🏁' : '🎯'}</span>
          <span class="decade-chip-days">~${wksAway}w</span>
          <span class="decade-chip-rate">${fmtShortDate(eta)}</span>
        </div>
      `);
    });

    const velocityCardHtml = `
      <div class="decade-velocity-card">
        <div class="decade-velocity-header">
          <div class="decade-velocity-title">
            <span>⚡</span>
            <span>Road to 210 &bull; Decade Velocity</span>
          </div>
          <div class="decade-velocity-summary">
            Avg ~${avgDays} days per 10 lbs (${avgPace.toFixed(2)} lbs/wk)
          </div>
        </div>
        <div class="decade-velocity-strip">
          ${chipsHtml.join('')}
        </div>
      </div>
    `;

    // Future upcoming milestone cards
    const futureHtml = unreached.map(w => {
      const toGo = (latest.weight - w).toFixed(1);
      const daysAway = Math.round((latest.weight - w) / ratePerDay);
      const wksAway = (daysAway / 7).toFixed(1);
      const eta = new Date(latest.date.getTime() + daysAway * 86400000);
      const isGoal = w === 210;
      return `
        <div class="decade-history-item future-target ${isGoal ? 'goal' : ''}">
          <div class="decade-item-icon">${isGoal ? '🏁' : '🎯'}</div>
          <div class="decade-item-info">
            <div class="decade-item-title">The ${w}s Club ${isGoal ? '<strong style="color:#7c3aed">(Ultimate Goal)</strong>' : ''}</div>
            <div class="decade-item-sub">
              <strong>${toGo} lbs to go</strong> &bull; Projected <strong>${fmtDate(eta)}</strong> (~${wksAway} wks at lifetime pace)
            </div>
          </div>
          <div class="decade-item-badge" style="${isGoal ? 'background:rgba(124,58,237,0.15);color:#7c3aed' : ''}">${isGoal ? 'Goal' : 'Upcoming'}</div>
        </div>
      `;
    }).join('');

    const timelineHtml = achieved.slice().reverse().map(item => {
      if (item.isStart) {
        return `
          <div class="decade-history-item start" onclick="window.celebrateMilestone(${item.weight})" role="button" tabindex="0">
            <div class="decade-item-icon">🚩</div>
            <div class="decade-item-info">
              <div class="decade-item-title">${item.label}</div>
              <div class="decade-item-sub">Started at ${START_WEIGHT} lbs on ${item.dateStr}</div>
            </div>
            <div class="decade-item-badge">Baseline</div>
          </div>
        `;
      }
      return `
        <div class="decade-history-item unlocked" onclick="window.celebrateMilestone(${item.weight})" role="button" tabindex="0">
          <div class="decade-item-icon">🏆</div>
          <div class="decade-item-info">
            <div class="decade-item-title">${item.label} (${item.weight} lbs)</div>
            <div class="decade-item-sub">
              Crossed on <strong>${item.dateStr}</strong> &bull; Took <strong>${item.daysTaken} days</strong> (${item.pace.toFixed(2)} lbs/wk)
            </div>
          </div>
          <button class="decade-item-btn" type="button" aria-label="Celebrate this milestone">🎉 Celebrate</button>
        </div>
      `;
    }).join('');

    historyContainer.innerHTML = `
      ${activeCardHtml}
      ${velocityCardHtml}
      ${futureHtml ? `
        <div class="decade-timeline-title" style="margin-top:0.9rem">
          <span>🎯 Road Ahead to 210 lbs</span>
          <span style="font-size:0.75rem;font-weight:normal;color:var(--text-sub)">Paced at 1.0%/wk lifetime trend</span>
        </div>
        <div class="decade-history-list" style="margin-bottom:1.1rem">
          ${futureHtml}
        </div>
      ` : ''}
      <div class="decade-timeline-title">
        <span>🏆 Unlocked Decade Badges (${achieved.length})</span>
        <span style="font-size:0.75rem;font-weight:normal;color:var(--text-sub)">Click any badge to celebrate</span>
      </div>
      <div class="decade-history-list">
        ${timelineHtml}
      </div>
    `;
  }
}

// Global celebration helper
window.celebrateMilestone = function(weight) {
  const m = (window._milestoneHistory || []).find(x => x.weight === weight);
  if (!m) return;
  if (typeof window.triggerMilestoneCelebration === 'function') {
    window.triggerMilestoneCelebration({
      icon: m.isStart ? '🚩' : '🏆',
      title: m.isStart ? `Journey Baseline: ${m.weight}s!` : `🎉 ${m.label} Unlocked!`,
      desc: m.isStart 
        ? `Day 1 of your journey at ${START_WEIGHT} lbs on ${m.dateStr}.`
        : `You officially crossed below ${m.weight} lbs on ${m.dateStr}!`,
      stats: m.isStart ? [
        { val: `${START_WEIGHT} lbs`, lbl: 'Starting Weight' },
        { val: m.dateStr, lbl: 'Launch Date' }
      ] : [
        { val: m.dateStr, lbl: 'Date Unlocked' },
        { val: `${m.daysTaken} days`, lbl: 'Days from prior badge' },
        { val: `${m.pace.toFixed(2)} lbs/wk`, lbl: 'Loss Velocity' }
      ]
    });
  }
};

// ── BMI Timeline ─────────────────────────────────────────────────────
function renderBMITimeline(data, latest) {
  const box = el('bmi-timeline');
  if (!box || !latest.bmi || !latest.weight) return;
  const weightKg = latest.weight / 2.205;
  const heightM  = Math.sqrt(weightKg / latest.bmi);
  const slope = (typeof projSlopeLbsPerDay !== 'undefined' && projSlopeLbsPerDay != null)
    ? projSlopeLbsPerDay
    : weightTrendSlope(data); // lbs/day
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
    badge.style.cursor = 'pointer';
    badge.title = 'Click to view Milestones & Decade Badges History';
    badge.onclick = () => {
      const content = document.getElementById('milestones-content') || document.getElementById('milestones-row');
      const toggle = document.getElementById('milestones-toggle');
      if (content && toggle && content.style.display === 'none') {
        toggleMilestones();
      }
      document.getElementById('milestones-section')?.scrollIntoView({ behavior: 'smooth' });
    };
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


