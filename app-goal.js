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
    setText('goal-eta', 'Goal reached!');
    return;
  }

  // Rate scenarios for range-based projections. Previously hardcoded
  // placeholder numbers (2.0/2.4/2.8) unrelated to actual trend data —
  // replaced with real regression rates off the shared engine so this
  // range reflects what's actually happening, not a guess. Anchored to
  // your latest reading (the engine's default) so this freezes cleanly
  // on days with no new weigh-in, like every other card.
  // regressionSlopeLbsPerDay returns lbs/DAY — must convert to lbs/wk.
  const rate14 = regressionSlopeLbsPerDay(data, 14);
  const rate28 = regressionSlopeLbsPerDay(data, 28);
  const rate14Abs = rate14 != null ? Math.abs(rate14) * 7 : null;
  const rate28Abs = rate28 != null ? Math.abs(rate28) * 7 : null;

  const calcEta = (rate) => {
    const weeksLeft = remaining / rate;
    return new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
  };

  const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (rate14Abs && rate28Abs) {
    const eta14 = calcEta(rate14Abs);
    const eta28 = calcEta(rate28Abs);
    // Don't assume the 14-day pace is always faster than the 28-day one
    // (it flipped this earlier: 14-day had slowed below 28-day, which
    // made the "always 14-day first" range print later-date-first).
    // Order by the actual dates instead, so the range always reads
    // soonest-to-latest regardless of which window is currently faster.
    const etaSoon = eta14 <= eta28 ? eta14 : eta28;
    const etaLate = eta14 <= eta28 ? eta28 : eta14;
    const rangeStr = `${fmtShort(etaSoon)} - ${fmtShort(etaLate)}`;
    setText('goal-eta', `${rangeStr} (currently ${rate28Abs.toFixed(2)} lbs/wk, 28-day)`);
  } else {
    setText('goal-eta', 'Not enough recent data to project a range yet');
  }
}

// -- Body-Fat Targets -------------------------------------------------
// For each target body-fat %, the weight you'd hit it at ASSUMING lean
// mass stays constant: targetWeight = leanMass / (1 - target/100).
// Lean mass is derived from the latest DEXA-calibrated body fat, so the
// whole table stays anchored to the scan, not the raw BIA reading.
//
// Calibration method: prefer the RATIO METHOD (propagate the DEXA
// anchor forward via the tracked fat-loss ratio) to match the Body Fat
// KPI card. Falls back to the constant-offset method (raw scale +
// fatOffset) when the anchor scan lacks a scan weight and the ratio
// method can't run. Justified by David's 5x/week resistance training,
// which makes the "lean mass held constant" assumption defensible —
// so the slightly more optimistic ratio-method lean estimate is fair
// game rather than double-optimism.
function renderBodyFatTargets(latest) {
  const host = el('bf-targets');
  if (!host) return;
  if (!latest || latest.bodyFat == null || !latest.weight) {
    host.innerHTML = '<p style="font-size:0.8rem;color:#6d7a95">No body-fat reading yet.</p>';
    return;
  }

  const fatOffset  = (typeof DexaCal !== 'undefined' && DexaCal.getFatOffset) ? DexaCal.getFatOffset() : 0;
  const ratioFat   = (typeof DexaCal !== 'undefined' && DexaCal.getRatioMethodFat)
    ? DexaCal.getRatioMethodFat(latest.weight) : null;
  const offsetFat  = latest.bodyFat + fatOffset;
  const calFat     = ratioFat != null ? ratioFat : offsetFat;  // primary: ratio method
  const lean       = latest.weight * (1 - calFat / 100);       // lbs of lean, held constant
  const curW       = latest.weight;
  const methodTag  = ratioFat != null ? 'DEXA ratio method' : 'DEXA offset method';

  const TARGETS = [25, 20, 15];
  const rows = TARGETS.map(t => {
    const w      = lean / (1 - t / 100);
    const toLose = curW - w;
    const done   = toLose <= 0;
    const color  = t >= 25 ? '#995213' : t >= 20 ? '#0053e2' : '#2a8703';
    const status = done
      ? '<span style="color:#2a8703;font-weight:700">reached</span>'
      : `${fmt(toLose)} lbs to go`;
    return `<tr>
      <td style="padding:0.4rem 0.5rem;font-weight:800;color:${color}">${t}%</td>
      <td style="padding:0.4rem 0.5rem;font-weight:700;color:var(--text)">${fmt(w)} lbs</td>
      <td style="padding:0.4rem 0.5rem;color:var(--text-sub);font-size:0.8rem">${status}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <p style="font-size:0.7rem;color:var(--text-sub);margin-bottom:0.5rem">
      Now: <strong style="color:var(--text)">${fmt(calFat)}% body fat</strong> at ${fmt(curW)} lbs
      &middot; lean mass held at <strong style="color:var(--text)">~${fmt(lean)} lbs</strong>
      &middot; <span style="opacity:0.75">${methodTag}</span>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
      <thead><tr style="text-align:left;color:var(--text-sub);font-size:0.62rem;text-transform:uppercase">
        <th style="padding:0.3rem 0.5rem;font-weight:700">Body Fat</th>
        <th style="padding:0.3rem 0.5rem;font-weight:700">Target Weight</th>
        <th style="padding:0.3rem 0.5rem;font-weight:700">From Now</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:0.62rem;color:var(--text-sub);margin-top:0.55rem;line-height:1.5;opacity:0.85">
      Assumes you keep every pound of lean mass — real loss usually shaves a little off, which would put each target at a slightly lower weight. A follow-up DEXA keeps this honest.
    </p>`;
}
window.renderBodyFatTargets = renderBodyFatTargets;

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

// ── Slowdown check (Weight Projector card) ───────────────────────────
// Fills the "Slowdown Check" panel: recent 4-wk regression rate vs the
// 4 weeks before it. Returns the slowdown object (or null) so
// computeProjection can also show a recent-pace arrival date.
function renderProjectorSlowdown() {
  const panel = document.getElementById('proj-slowdown');
  if (!panel) return null;

  const data = (typeof allData !== 'undefined' && allData.length) ? allData : null;
  const sd   = data ? computeWeightSlowdown(data, 28) : null;
  if (!sd) { panel.style.display = 'none'; return null; }
  panel.style.display = 'block';

  const set = (id, txt, color) => {
    const e = document.getElementById(id);
    if (e) { e.textContent = txt; if (color) e.style.color = color; }
  };
  const rateStr = r => `${r.toFixed(2)} lbs/wk`;
  set('proj-sd-prior',   rateStr(sd.priorRate));
  set('proj-sd-current', rateStr(sd.currentRate));

  let pctTxt, pctColor, note;
  if (sd.slowdownPct == null) {
    pctTxt   = '—';
    pctColor = '#6d7a95';
    note = 'Prior 4-week pace was near zero, so a percent change isn’t meaningful. Watch the raw rates instead.';
  } else if (sd.slowdownPct >= 15) {
    pctTxt   = `▼ ${Math.round(sd.slowdownPct)}% slower`;
    pctColor = '#ea1100';
    note = `Pace has slowed ${Math.round(sd.slowdownPct)}% vs the prior 4 weeks. The exponential decay model above accounts for this — the fitted rate eases smoothly toward an asymptote instead of extrapolating a straight line.`;
  } else if (sd.slowdownPct <= -15) {
    pctTxt   = `▲ ${Math.round(Math.abs(sd.slowdownPct))}% faster`;
    pctColor = '#2a8703';
    note = `Pace has picked up ${Math.round(Math.abs(sd.slowdownPct))}% vs the prior 4 weeks. The model only extrapolates deceleration, not speed-ups, so its projections may be conservative.`;
  } else {
    pctTxt   = `${sd.slowdownPct >= 0 ? '▼' : '▲'} ${Math.round(Math.abs(sd.slowdownPct))}%`;
    pctColor = '#6d7a95';
    note = 'Pace is holding roughly steady vs the prior 4 weeks — the modeled projection stays close to a straight line at your recent rate.';
  }
  set('proj-sd-pct', pctTxt, pctColor);
  set('proj-sd-note', note);
  return sd;
}

// ── Weight Projector ─────────────────────────────────────────────────
// Headline pace = plain linear-regression rate over the last 28
// calendar days of the FULL dataset — the exact same number and same
// engine (regressionSlopeLbsPerDay) the "28-Day Trend" card uses, so
// this card can never visually disagree with it.
//
// Previously used an exponential-decay curve fit confined to the
// current dose (see git history for computeExponentialDecayModel).
// That number was a genuinely different, smoothed quantity and looked
// like a bug sitting next to the 28-day trend card even though it
// technically wasn't one — simpler and consistent wins here.
function computeProjection() {
  const dateInput   = document.getElementById('proj-date-input');
  const weightInput = document.getElementById('proj-weight-input');
  const dateResult  = document.getElementById('proj-date-result');
  const weightResult= document.getElementById('proj-weight-result');
  renderProjectorSlowdown();

  const noTrend = () => {
    if (dateResult)   dateResult.textContent   = 'Need more data (< 30 days of readings)';
    if (weightResult) weightResult.textContent = 'Need more data (< 30 days of readings)';
  };

  if (!projSlopeLbsPerDay || !projLatestWeight || !projLatestDate) {
    noTrend(); return;
  }

  const MS_PER_DAY = 86_400_000;
  const data = (typeof allData !== 'undefined' && allData.length) ? allData : null;

  const rate28   = data ? regressionSlopeLbsPerDay(data, 28) : null; // lbs/day, negative = losing
  const useModel = rate28 != null && rate28 < 0;
  const fmtLongDate = d => d.toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric' });

  // Dose label is context only — the rate above is NOT dose-scoped.
  let currentDose = null;
  try {
    const shots = JSON.parse(localStorage.getItem('glp1_v4')) || [];
    const norm  = shots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);
    if (norm.length) currentDose = norm[norm.length - 1].dose;
  } catch (e) { /* label-only, fine to skip */ }
  const dosePrefix = currentDose != null ? `On ${currentDose}mg. ` : '';

  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb) {
    blurb.textContent = useModel
      ? `${dosePrefix}Losing ~${Math.abs(rate28 * 7).toFixed(2)} lbs/wk over the last 28 days. Pick a date or target below to see what this pace projects.`
      : `${dosePrefix}Not enough recent data (or trend is flat/gaining) to project a 28-day pace. Needs at least 3 weigh-ins in the last 28 days.`;
  }

  // ── Date → Projected weight ──
  if (dateInput && dateResult) {
    const targetDate = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : null;
    const recentEl   = document.getElementById('proj-date-recent');
    if (recentEl) recentEl.textContent = '';
    if (!targetDate || isNaN(targetDate)) {
      dateResult.textContent = 'Pick a date above';
    } else if (!useModel) {
      dateResult.textContent = 'Trend is flat or gaining — projection unavailable';
      dateResult.style.color = '#6d7a95';
    } else {
      const daysDiff  = (targetDate - projLatestDate) / MS_PER_DAY;
      const isFuture  = daysDiff > 0;
      const projected = projLatestWeight + rate28 * daysDiff;
      const rounded   = Math.round(projected * 10) / 10;
      if (!isFuture) {
        dateResult.textContent = 'Pick a future date';
      } else if (rounded < 100) {
        dateResult.textContent = "Way beyond goal — you'd be a ghost 👻";
      } else {
        const dateLabel   = fmtLongDate(targetDate);
        const lostNow     = projLatestWeight - rounded;          // change from current
        const lostTotal   = START_WEIGHT - rounded;              // total from 315.0
        const lostNowStr  = lostNow > 0
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
    } else if (!useModel) {
      hide('Trend is flat or gaining — projection unavailable');
    } else {
      const stillToGo   = projLatestWeight - targetW;
      const totalLost   = START_WEIGHT - targetW;
      const daysNeeded  = stillToGo / Math.abs(rate28);
      const arrivalDate = new Date(projLatestDate.getTime() + daysNeeded * MS_PER_DAY);
      const daysRounded = Math.round(daysNeeded);

      if (countdown) {
        countdown.style.display = 'block';
        document.getElementById('proj-cd-date').textContent  = fmtLongDate(arrivalDate);
        document.getElementById('proj-cd-days').textContent  =
          `${daysRounded} day${daysRounded !== 1 ? 's' : ''}`;
        document.getElementById('proj-cd-total').textContent =
          `${fmt(totalLost)} lbs from ${START_WEIGHT}`;
        document.getElementById('proj-cd-togo').textContent  =
          `${fmt(stillToGo)} lbs`;

        // No model-vs-linear comparison anymore — there's only one
        // projection now, so the comparison row stays hidden.
        const adjWrap = document.getElementById('proj-cd-adjusted-wrap');
        if (adjWrap) adjWrap.style.display = 'none';
      }
      weightResult.textContent = '';
    }
  }
}
window.computeProjection = computeProjection;
