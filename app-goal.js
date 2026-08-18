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
  // range reflects what's actually happening, not a guess. Conservative
  // = the slower 28-day trend, optimistic = the faster 14-day trend;
  // anchored to your latest reading (the engine's default) so this
  // freezes cleanly on days with no new weigh-in, like every other card.
  // regressionSlopeLbsPerDay returns lbs/DAY — must convert to lbs/wk.
  const rate14 = regressionSlopeLbsPerDay(data, 14);
  const rate28 = regressionSlopeLbsPerDay(data, 28);
  const optimisticRate   = rate14 != null ? Math.abs(rate14) * 7 : null;
  const conservativeRate = rate28 != null ? Math.abs(rate28) * 7 : null;

  const calcEta = (rate) => {
    const weeksLeft = remaining / rate;
    return new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
  };

  const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (optimisticRate && conservativeRate) {
    const etaOpt  = calcEta(optimisticRate);
    const etaCons = calcEta(conservativeRate);
    const rangeStr = `${fmtShort(etaOpt)} - ${fmtShort(etaCons)}`;
    setText('goal-eta', `${rangeStr} (currently ${conservativeRate.toFixed(2)} lbs/wk, 28-day)`);
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
// Headline numbers come from the exponential-decay model when there's
// enough data to fit one: weight(t) = W_now - (R0/k)(1 - e^-kt), t in
// weeks from today. R0 (current rate) and k (decay constant) are fit
// from overlapping trailing rate windows — see computeExponentialDecayModel
// in app-utils.js.
//
// IMPORTANT: the fit is confined to the CURRENT dose window (mirrors
// plateau-radar.js / titration-readiness.js). Pooling across a dose
// transition would treat the post-titration loss burst as part of a
// single decelerating trend, silently inflating R0 on the early side
// and biasing k. Confining to the current dose makes R0 and k mean
// what their labels say. The moment a new dose is logged, the fit
// resets — which is correct: all pre-titration projections are stale.
//
// When k <= 0 (no deceleration signal), too few windows, or too little
// data in the current dose, everything falls back to plain linear
// extrapolation at the current rate.
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

  // Restrict the fit to the current dose window so a titration step
  // can't pollute the deceleration read. Falls back to full history
  // when we have no shot data or TitrationUtils isn't loaded yet.
  let doseData = data, doseStart = null, currentDose = null;
  try {
    const shots = JSON.parse(localStorage.getItem('glp1_v4')) || [];
    const norm  = shots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);
    if (norm.length && window.TitrationUtils) {
      currentDose = norm[norm.length - 1].dose;
      doseStart   = window.TitrationUtils.currentDoseStart(norm);
      if (doseStart && data) {
        doseData = window.TitrationUtils.readingsSince(doseStart, data);
      }
    }
  } catch (e) { /* keep full-history fallback */ }

  const model    = (doseData && doseData.length)
    ? computeExponentialDecayModel(doseData) : null;
  const useModel = !!model;
  const fmtLongDate = d => d.toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric' });

  const doseLabel = currentDose != null ? `${currentDose}mg` : 'this dose';
  const sinceLabel = doseStart
    ? ` since ${doseStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb) {
    if (useModel) {
      const halfLifeWk = Math.log(2) / model.k;
      const easePctWk  = model.k * 100;
      blurb.textContent = `On ${doseLabel}${sinceLabel}. Losing ~${model.r0.toFixed(2)} lbs/wk right now, with adaptation slowing the pace ~${easePctWk.toFixed(1)}% per week (rate half-life ~${halfLifeWk.toFixed(0)} wk, fit from ${model.n} windows in the current dose). Pick a date or target below to see what this pace projects — assumes you stay on ${doseLabel}.`;
    } else {
      blurb.textContent = `On ${doseLabel}${sinceLabel} — not enough within-dose data yet to model deceleration, so projecting linearly at your current pace of ~${Math.abs(projSlopeLbsPerDay * 7).toFixed(2)} lbs/wk. Fit will improve as more ${doseLabel} readings accrue.`;
    }
  }

  // ── Date → Projected weight ──
  if (dateInput && dateResult) {
    const targetDate = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : null;
    const recentEl   = document.getElementById('proj-date-recent');
    if (recentEl) recentEl.textContent = '';
    if (!targetDate || isNaN(targetDate)) {
      dateResult.textContent = 'Pick a date above';
    } else {
      const daysDiff = (targetDate - projLatestDate) / MS_PER_DAY;
      const isFuture = daysDiff > 0;
      const weeks    = daysDiff / 7;
      const linear   = projLatestWeight + projSlopeLbsPerDay * daysDiff;

      let projected = linear, projLow = null, projHigh = null;
      if (useModel) {
        const range = exponentialLossRange(model, weeks);
        projected = projLatestWeight - range.loss;
        projLow   = projLatestWeight - range.lossHigh; // more loss => lower weight
        projHigh  = projLatestWeight - range.lossLow;
      }

      const rounded = Math.round(projected * 10) / 10;
      if (!isFuture) {
        dateResult.textContent = 'Pick a future date';
      } else if (rounded < 100) {
        dateResult.textContent = "Way beyond goal — you'd be a ghost 👻";
      } else {
        const dateLabel  = fmtLongDate(targetDate);
        const lostNow    = projLatestWeight - rounded;          // change from current
        const lostTotal  = START_WEIGHT - rounded;              // total from 315.0
        const lostNowStr = lostNow > 0
          ? `▼ ${fmt(lostNow)} lbs from now`
          : `▲ ${fmt(Math.abs(lostNow))} lbs from now`;
        const rangeStr = (useModel && projLow != null && projHigh != null)
          ? ` (range ${fmt(Math.round(projLow * 10) / 10)}–${fmt(Math.round(projHigh * 10) / 10)} lbs)`
          : '';
        const main = `~${fmt(rounded)} lbs${rangeStr} on ${dateLabel} · ${lostNowStr} · ✅ ${fmt(lostTotal)} lbs lost from ${START_WEIGHT}`;
        dateResult.textContent = main;
        dateResult.style.color = lostNow > 0 ? '#2a8703' : '#ea1100';

        // Comparison line: what plain linear extrapolation would have said,
        // plus a reminder this is a modeled scenario, not a guarantee.
        if (recentEl && useModel) {
          const linRounded = Math.round(linear * 10) / 10;
          const diff = linRounded - rounded;
          recentEl.textContent = `Assumes deceleration continues at the current trend. ⚖ Steady long-run average: ~${fmt(linRounded)} lbs` +
            (Math.abs(diff) >= 0.1
              ? ` (${diff > 0 ? '+' : ''}${fmt(diff)} lbs vs the modeled scenario).`
              : ' (about the same).');
        } else if (recentEl) {
          recentEl.textContent = '';
        }
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
    } else if (projSlopeLbsPerDay >= 0 && !useModel) {
      hide('Trend is flat or gaining — projection unavailable');
    } else {
      const stillToGo = projLatestWeight - targetW;
      const totalLost = START_WEIGHT - targetW;
      const avgDays   = projSlopeLbsPerDay < 0
        ? stillToGo / Math.abs(projSlopeLbsPerDay) : null;

      let daysNeeded = null, daysLow = null, daysHigh = null;
      if (useModel) {
        const wr = exponentialWeeksToLoseRange(model, stillToGo);
        if (wr.weeks     != null) daysNeeded = wr.weeks * 7;
        if (wr.weeksLow  != null) daysLow    = wr.weeksLow  * 7;
        if (wr.weeksHigh != null) daysHigh   = wr.weeksHigh * 7;
      } else {
        daysNeeded = avgDays;
      }

      if (daysNeeded == null) {
        // Target lies beyond what the within-dose deceleration reaches
        // in finite time. Don't leak the asymptote as a headline number
        // — it's a curve-fit artifact that swings wildly with water
        // cycling. Just tell the user the target isn't reachable at
        // the current within-dose pace and offer the linear estimate
        // as a reference.
        let msg = ` At the current within-dose pace, ${fmt(targetW)} lbs isn't reached before the model's deceleration flattens out. A dose change (or an intentional pace bump) would restart the projection.`;
        if (avgDays != null) {
          msg += ` For reference, at your steady long-run average you'd arrive ${fmtLongDate(new Date(projLatestDate.getTime() + avgDays * MS_PER_DAY))}.`;
        }
        hide(msg, '#995213');
      } else {
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

          // Range row: arrival date span implied by the decay-rate
          // uncertainty band, not a "same model, different average" comparison.
          const adjWrap = document.getElementById('proj-cd-adjusted-wrap');
          const adjEl   = document.getElementById('proj-cd-adjusted');
          if (adjWrap && adjEl) {
            if (useModel && daysLow != null && daysHigh != null) {
              const dateA = new Date(projLatestDate.getTime() + Math.min(daysLow, daysHigh) * MS_PER_DAY);
              const dateB = new Date(projLatestDate.getTime() + Math.max(daysLow, daysHigh) * MS_PER_DAY);
              adjEl.textContent = `${fmtLongDate(dateA)} – ${fmtLongDate(dateB)}`;
              adjWrap.style.display = 'block';
            } else if (useModel) {
              adjEl.textContent = 'Range unavailable at this target';
              adjWrap.style.display = 'block';
            } else {
              adjWrap.style.display = 'none';
            }
          }
        }
        weightResult.textContent = '';
      }
    }
  }
}
window.computeProjection = computeProjection;
