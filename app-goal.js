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

  // Rate scenarios for range-based projections
  const RATES = { conservative: 2.0, baseCase: 2.4, optimistic: 2.8 };
  
  const calcEta = (rate) => {
    const weeksLeft = remaining / rate;
    return new Date(latest.date.getTime() + weeksLeft * 7 * 86400000);
  };
  
  const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  
  const etaOpt  = calcEta(RATES.optimistic);
  const etaCons = calcEta(RATES.conservative);
  
  // Show range: "Oct 2026 - Jan 2027"
  const rangeStr = `${fmtShort(etaOpt)} - ${fmtShort(etaCons)}`;
  
  // Also calculate journey average for context
  const startDate        = new Date(START_DATE);
  const totalDaysElapsed = (latest.date - startDate) / 86400000;
  const totalLostJourney = START_WEIGHT - latest.weight;
  const weeklyRate       = totalDaysElapsed > 0 ? (totalLostJourney / totalDaysElapsed) * 7 : 0;
  
  setText('goal-eta', `${rangeStr} (currently ${weeklyRate.toFixed(1)} lbs/wk)`);
}

// -- Body-Fat Targets -------------------------------------------------
// For each target body-fat %, the weight you'd hit it at ASSUMING lean
// mass stays constant: targetWeight = leanMass / (1 - target/100).
// Lean mass is derived from the latest DEXA-calibrated body fat, so the
// whole table stays anchored to the scan, not the raw BIA reading.
function renderBodyFatTargets(latest) {
  const host = el('bf-targets');
  if (!host) return;
  if (!latest || latest.bodyFat == null || !latest.weight) {
    host.innerHTML = '<p style="font-size:0.8rem;color:#6d7a95">No body-fat reading yet.</p>';
    return;
  }

  const fatOffset = (typeof DexaCal !== 'undefined' && DexaCal.getFatOffset) ? DexaCal.getFatOffset() : 0;
  const calFat    = latest.bodyFat + fatOffset;              // DEXA-calibrated %
  const lean      = latest.weight * (1 - calFat / 100);      // lbs of lean, held constant
  const curW      = latest.weight;

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
      <td style="padding:0.4rem 0.5rem;font-weight:700;color:#f1f5f9">${fmt(w)} lbs</td>
      <td style="padding:0.4rem 0.5rem;color:#94a3b8;font-size:0.8rem">${status}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <p style="font-size:0.7rem;color:#6d7a95;margin-bottom:0.5rem">
      Now: <strong style="color:#f1f5f9">${fmt(calFat)}% body fat</strong> at ${fmt(curW)} lbs
      &middot; lean mass held at <strong style="color:#f1f5f9">~${fmt(lean)} lbs</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
      <thead><tr style="text-align:left;color:#64748b;font-size:0.62rem;text-transform:uppercase">
        <th style="padding:0.3rem 0.5rem;font-weight:700">Body Fat</th>
        <th style="padding:0.3rem 0.5rem;font-weight:700">Target Weight</th>
        <th style="padding:0.3rem 0.5rem;font-weight:700">From Now</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:0.62rem;color:#475569;margin-top:0.55rem;line-height:1.5">
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
    note = `Pace has slowed ${Math.round(sd.slowdownPct)}% vs the prior 4 weeks. The projections above bake this in — the rate starts at your recent pace and keeps easing at the observed slowdown.`;
  } else if (sd.slowdownPct <= -15) {
    pctTxt   = `▲ ${Math.round(Math.abs(sd.slowdownPct))}% faster`;
    pctColor = '#2a8703';
    note = `Pace has picked up ${Math.round(Math.abs(sd.slowdownPct))}% vs the prior 4 weeks. Projections use your current rate without extrapolating the speed-up, so they may be conservative.`;
  } else {
    pctTxt   = `${sd.slowdownPct >= 0 ? '▼' : '▲'} ${Math.round(Math.abs(sd.slowdownPct))}%`;
    pctColor = '#6d7a95';
    note = 'Pace is holding roughly steady vs the prior 4 weeks — the slowdown-adjusted projection is close to linear at your recent rate.';
  }
  set('proj-sd-pct', pctTxt, pctColor);
  set('proj-sd-note', note);
  return sd;
}

// ── Weight Projector ─────────────────────────────────────────────────
function computeProjection() {
  const dateInput   = document.getElementById('proj-date-input');
  const weightInput = document.getElementById('proj-weight-input');
  const dateResult  = document.getElementById('proj-date-result');
  const weightResult= document.getElementById('proj-weight-result');
  const slowdown    = renderProjectorSlowdown();

  const noTrend = () => {
    if (dateResult)   dateResult.textContent   = 'Need more data (< 30 days of readings)';
    if (weightResult) weightResult.textContent = 'Need more data (< 30 days of readings)';
  };

  if (!projSlopeLbsPerDay || !projLatestWeight || !projLatestDate) {
    noTrend(); return;
  }

  const MS_PER_DAY = 86_400_000;

  // Slowdown-adjusted model drives the headline numbers when we have a
  // usable recent rate; otherwise everything falls back to the linear
  // de-skewed average exactly as before.
  const model    = slowdown ? slowdownModel(slowdown) : null;
  const useModel = !!(model && model.r0 > 0.05);
  const fmtLongDate = d => d.toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric' });

  const blurb = document.getElementById('proj-trend-blurb');
  if (blurb && useModel) {
    blurb.textContent = model.decel > 0.01
      ? `Slowdown-adjusted: losing ~${model.r0.toFixed(2)} lbs/wk now, easing ~${model.decel.toFixed(2)} lbs/wk each week (from your last 8 weeks)`
      : `Recent 4-wk pace ~${model.r0.toFixed(2)} lbs/wk · no slowdown detected — projecting linearly`;
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
      const linear   = projLatestWeight + projSlopeLbsPerDay * daysDiff;
      const projected = useModel
        ? projLatestWeight - slowdownLossAt(model, daysDiff / 7)
        : linear;
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
        let main = `~${fmt(rounded)} lbs on ${dateLabel} · ${lostNowStr} · ✅ ${fmt(lostTotal)} lbs lost from ${START_WEIGHT}`;
        const plateau = useModel ? slowdownPlateau(model) : null;
        if (plateau && daysDiff / 7 > plateau.weeks) {
          const stallDate = new Date(projLatestDate.getTime() + plateau.weeks * 7 * MS_PER_DAY);
          main += ` · ⚠ pace projected to stall ~${stallDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        }
        dateResult.textContent = main;
        dateResult.style.color = lostNow > 0 ? '#2a8703' : '#ea1100';

        // Comparison line: what the plain linear average would have said.
        if (recentEl && useModel) {
          const linRounded = Math.round(linear * 10) / 10;
          const diff = linRounded - rounded;
          recentEl.textContent = `⚖ At steady long-run average: ~${fmt(linRounded)} lbs` +
            (Math.abs(diff) >= 0.1
              ? ` (${diff > 0 ? '+' : ''}${fmt(diff)} lbs vs slowdown-adjusted)`
              : ' (same as slowdown-adjusted)');
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

      let daysNeeded = null;
      if (useModel) {
        const weeks = slowdownWeeksToLose(model, stillToGo);
        if (weeks != null) daysNeeded = weeks * 7;
      } else {
        daysNeeded = avgDays;
      }

      if (daysNeeded == null) {
        // Extrapolated pace hits zero before the target.
        const plateau   = slowdownPlateau(model);
        const stallDate = new Date(projLatestDate.getTime() + plateau.weeks * 7 * MS_PER_DAY);
        const short     = stillToGo - plateau.loss;
        let msg = `⚠ At the current slowdown, pace is projected to stall ~${fmt(short)} lbs short of ${fmt(targetW)} (around ${fmtLongDate(stallDate)}).`;
        if (avgDays != null) {
          msg += ` At your steady long-run average you'd arrive ${fmtLongDate(new Date(projLatestDate.getTime() + avgDays * MS_PER_DAY))}.`;
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

          // Comparison row: arrival at the steady long-run average.
          const adjWrap = document.getElementById('proj-cd-adjusted-wrap');
          const adjEl   = document.getElementById('proj-cd-adjusted');
          if (adjWrap && adjEl) {
            if (useModel && avgDays != null) {
              const avgDate   = new Date(projLatestDate.getTime() + avgDays * MS_PER_DAY);
              const deltaDays = Math.round(avgDays - daysNeeded);
              const deltaStr  = deltaDays === 0 ? 'same as slowdown-adjusted'
                : deltaDays > 0 ? `+${deltaDays} days later`
                : `${Math.abs(deltaDays)} days sooner`;
              adjEl.textContent = `${fmtLongDate(avgDate)} · ${deltaStr}`;
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
