/* ═══════════════════════════════════════════════════════════════════
   titration-readiness.js
   "Should I ask my prescriber about moving up?" widget.

   Renders a single decision card with:
     - Status badge (HOLD / RIDE / WATCH / READY / MAX / REGAIN)
     - Four key stats (wks on dose, loss on dose, 4-wk pace, # readings)
     - A one-paragraph reasoning blurb
     - "What to watch for next" coaching

   Source of truth:
     - Shots:   localStorage['glp1_v4']  (written by medication.js)
     - Weight:  window.allWeightData     (written by app.js)

   Decisions are heuristic — UI always tells the user to confirm with
   their prescriber. We render an opinion, not a prescription.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Shared math/data helpers (DOSE_LADDER, preChangeBaseline, etc.)
  // live in titration-utils.js. Bail loudly if it didn't load so we
  // never silently fall back to a divergent calculation.
  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[titration-readiness] TitrationUtils missing — card disabled');
    return;
  }

  // ── Thresholds (policy lives here, not in utils) ──────────────
  const MIN_WEEKS_ON_DOSE     = 4;     // Lilly label minimum before stepping up
  const READY_PACE_MAX        = 0.5;   // lbs/wk — under this for "ready"
  const WATCH_PACE_MAX        = 1.0;   // lbs/wk — under this for "watch"
  const PACE_WINDOW_DAYS      = 28;    // rolling window for trend-slope calc
  const MIN_READINGS_FOR_PACE = 3;     // need at least N readings in window
  const CLEAN_TAIL_DAYS       = 3;     // exclude this many days AFTER each event ends (water-weight lag)
  const CLEAN_MIN_READINGS    = 10;    // need this many clean-day readings before clean trend overrides raw

  const COLORS = {
    HOLD:   '#6d7a95',
    RIDE:   '#2a8703',
    WATCH:  '#995213',
    READY:  '#0053e2',
    MAX:    '#7c3aed',
    REGAIN: '#ea1100',
  };

  const STATUS = {
    HOLD:   { color: COLORS.HOLD,   label: 'HOLD',   blurb: 'Give the dose its full ramp-up period before judging.' },
    RIDE:   { color: COLORS.RIDE,   label: 'RIDE IT OUT', blurb: 'Still losing well on this dose. No need to escalate.' },
    WATCH:  { color: COLORS.WATCH,  label: 'WATCH',  blurb: 'Pace is slowing. Keep an eye on the next 1–2 weigh-ins.' },
    READY:  { color: COLORS.READY,  label: 'READY',  blurb: 'Pace has stalled at this dose. Worth discussing the next step with your prescriber.' },
    MAX:    { color: COLORS.MAX,    label: 'MAX DOSE', blurb: 'Top of the Mounjaro ladder — no further titration available.' },
    REGAIN: { color: COLORS.REGAIN, label: 'REGAIN',  blurb: 'Weight is trending up. Investigate before considering a dose change.' },
  };

  // ── Helpers ─────────────────────────────────────────────
  function loadShots() {
    try { return JSON.parse(localStorage.getItem('glp1_v4')) || []; }
    catch (e) { return []; }
  }

  function sortedShots() {
    return loadShots()
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);
  }

  // Readings in the last `days` days, sorted ascending.
  function recentReadings(days) {
    const cutoff = new Date(Date.now() - days * TU.MS_PER_DAY);
    return TU.readingsSince(cutoff);
  }

  // ── Status decision ────────────────────────────────────────────────
  function decideStatus({ weeksOnDose, currentDose, rollingPace, paceReadings }) {
    if (currentDose >= 15)              return 'MAX';
    if (weeksOnDose < MIN_WEEKS_ON_DOSE) return 'HOLD';
    if (rollingPace == null || paceReadings < MIN_READINGS_FOR_PACE) return 'HOLD';
    if (rollingPace < -0.3)             return 'REGAIN';
    if (rollingPace < READY_PACE_MAX)   return 'READY';
    if (rollingPace < WATCH_PACE_MAX)   return 'WATCH';
    return 'RIDE';
  }

  function reasoningFor(status, ctx) {
    const { weeksOnDose, currentDose, nextDoseMg, rollingPace, rawPace,
            cleanResult, decisionSource, lossOnDose } = ctx;
    const paceStr  = rollingPace == null ? 'n/a' : rollingPace.toFixed(2) + ' lbs/wk';
    const rawStr   = rawPace == null    ? 'n/a' : rawPace.toFixed(2)    + ' lbs/wk';
    const usingClean = decisionSource === 'clean';
    const ctxNote = usingClean
      ? ` (clean trend of ${cleanResult.cleanCount} on-protocol days out of ${cleanResult.totalCount}; raw was ${rawStr})`
      : '';

    switch (status) {
      case 'HOLD':
        if (weeksOnDose < MIN_WEEKS_ON_DOSE) {
          const left = (MIN_WEEKS_ON_DOSE - weeksOnDose).toFixed(1);
          return `Only ${weeksOnDose.toFixed(1)} wks on ${currentDose}mg — Lilly's label asks for at least ${MIN_WEEKS_ON_DOSE} wks before stepping up. ${left} wks to go.`;
        }
        return `Not enough weigh-ins in the last ${PACE_WINDOW_DAYS} days to compute a reliable pace. Log a few more readings.`;
      case 'RIDE':
        return `4-wk trend slope is ${paceStr}${ctxNote} — ${currentDose}mg is still pulling its weight (you've lost ${lossOnDose.toFixed(1)} lbs on this dose). No reason to climb the ladder.`;
      case 'WATCH':
        return `Trend has slowed to ${paceStr}${ctxNote}. Not stalled yet — but trending toward the threshold. One more weigh-in cycle should clarify.`;
      case 'READY':
        return `Current trend is ${paceStr}${ctxNote} over the last ${PACE_WINDOW_DAYS} days, after ${weeksOnDose.toFixed(1)} wks on ${currentDose}mg. By the "lowest effective dose for the longest time" rule you used on 5mg, this is the natural moment to discuss ${nextDoseMg}mg with your prescriber.`;
      case 'MAX':
        return `You're on the top rung (15mg). Further escalation isn't an option — focus shifts to nutrition, training, and maintenance strategy.`;
      case 'REGAIN':
        return `Trend is ${paceStr}${ctxNote} (gaining). Don't titrate up to mask a behavioral or measurement issue — find the cause first (hydration, cycle, sodium, sleep, scale anomaly).`;
    }
    return '';
  }

  function watchFor(status, ctx) {
    const { currentDose, nextDoseMg } = ctx;
    switch (status) {
      case 'HOLD':
        return 'Log weigh-ins weekly (ideally pre-shot day) so the pace estimate stabilises.';
      case 'RIDE':
        return `When 4-wk trend drops under ${WATCH_PACE_MAX} lbs/wk, the widget will flip to WATCH. No action needed today.`;
      case 'WATCH':
        return `If trend stays under ${READY_PACE_MAX} lbs/wk for another 1–2 weigh-ins, this card will flip to READY.`;
      case 'READY':
        return `Bring your trajectory data to your next prescriber visit and discuss ${nextDoseMg}mg. Stay on ${currentDose}mg until they approve the change.`;
      case 'MAX':
        return 'Protein target ≥1g per lb of goal weight, resistance training 2–3×/wk, watch for gallstones during rapid loss windows.';
      case 'REGAIN':
        return 'Check: hydration, sleep, sodium, alcohol, scale calibration, menstrual cycle. Re-evaluate after 7 days of clean data.';
    }
    return '';
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('tr-card-body');
    if (!root) return;

    const shots = sortedShots();
    if (!shots.length) {
      root.innerHTML = `<p style="color:#6d7a95;font-size:0.85rem">No shot data yet. Log a shot in the Medication tab to enable this widget.</p>`;
      return;
    }

    const currentDose = shots[shots.length - 1].dose;
    const doseStart   = TU.currentDoseStart(shots);
    const weeksOnDose = (Date.now() - doseStart.getTime()) / (7 * TU.MS_PER_DAY);
    const nextDoseMg  = TU.nextDose(currentDose);

    // Loss on current dose: pre-change baseline (last weigh-in on or
    // before the up-titration day) vs latest reading. Using this
    // anchor matches the trajectory card's "Lost since titration" so
    // both numbers always agree.
    const baseline      = TU.preChangeBaseline(doseStart);
    const doseReadings  = TU.readingsSince(doseStart);
    const latestReading = doseReadings.length
      ? doseReadings[doseReadings.length - 1]
      : null;
    const lossOnDose = (baseline != null && latestReading)
      ? baseline - latestReading.weight
      : 0;

    // 4-wk trend slope via linear regression. NOTE: this is the
    // *current trajectory* through daily noise — it answers "is the
    // dose still working RIGHT NOW?" and is intentionally different
    // from the trajectory card's lifetime-of-dose endpoint pace.
    // If the loss curve is flattening, this slope will be lower than
    // (lossOnDose / weeksOnDose). That's the signal we want.
    const window28    = recentReadings(PACE_WINDOW_DAYS);
    const rollingPace = TU.slopePerWeek(window28);

    // Pull any events overlapping the 28-day pace window so we can
    // tell the user "hey, this trend might be lifestyle, not pharmacology"
    const winStart = new Date(Date.now() - PACE_WINDOW_DAYS * TU.MS_PER_DAY);
    const ctxEvents = (typeof window.getEventsInRange === 'function')
      ? window.getEventsInRange(winStart, new Date())
      : [];

    // Clean trend = same regression with flagged days (plus tail)
    // excluded. When we have enough clean readings, this drives the
    // status verdict — it answers "what's my trend on the days I was
    // actually on protocol?" Raw rolling pace stays visible so the
    // user can see exactly what we computed and why we acted on it.
    const clean = TU.slopePerWeekClean(window28, ctxEvents, {
      tailDays: CLEAN_TAIL_DAYS,
      minClean: CLEAN_MIN_READINGS,
    });
    const decisionPace   = clean.slope != null ? clean.slope : rollingPace;
    const decisionSource = clean.slope != null ? 'clean' : 'raw';

    const ctx = { weeksOnDose, currentDose, nextDoseMg,
                  rollingPace: decisionPace, rawPace: rollingPace,
                  cleanResult: clean, decisionSource, lossOnDose,
                  paceReadings: window28.length };
    const status = decideStatus(ctx);
    const s = STATUS[status];

    const fmtPace = p => p == null ? '—' :
      (p >= 0 ? p.toFixed(2) : '+' + Math.abs(p).toFixed(2)) + ' lbs/wk';
    const paceDisplay      = fmtPace(rollingPace);
    const cleanPaceDisplay = fmtPace(clean.slope);

    const lossSign = lossOnDose >= 0 ? '−' : '+';
    const lossDisplay = lossSign + Math.abs(lossOnDose).toFixed(1) + ' lbs';

    root.innerHTML = `
      <!-- Badge + next-dose line -->
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.9rem">
        <span style="display:inline-block;padding:0.35rem 0.8rem;border-radius:999px;
                     background:${s.color}18;color:${s.color};font-size:0.78rem;
                     font-weight:800;letter-spacing:0.06em">${s.label}</span>
        <span style="font-size:0.78rem;color:#1a2340;font-weight:700">
          Current: ${currentDose}mg
          ${nextDoseMg ? `<span style="color:#6d7a95;font-weight:600"> · Next on ladder: ${nextDoseMg}mg</span>` : ''}
        </span>
      </div>

      <!-- 4-stat grid — swap Readings tile for Clean trend when available -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.6rem;margin-bottom:0.9rem">
        ${statCell('Wks on dose', weeksOnDose.toFixed(1), '#0053e2')}
        ${statCell('Loss on dose', lossDisplay, lossOnDose >= 0 ? '#2a8703' : '#ea1100')}
        ${statCell('4-wk trend (raw)', paceDisplay, decisionSource === 'clean' ? '#6d7a95' : s.color)}
        ${clean.slope != null
          ? statCell('Clean trend', cleanPaceDisplay, s.color, `${clean.cleanCount} of ${clean.totalCount}d`)
          : statCell('Readings (28d)', String(window28.length), '#1a2340',
              clean.excludedCount > 0 ? `${clean.cleanCount} clean (need ${CLEAN_MIN_READINGS})` : null)}
      </div>

      <!-- Reasoning -->
      <div style="background:${s.color}0d;border-left:3px solid ${s.color};
                  padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.7rem">
        <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;
                  letter-spacing:0.08em;color:${s.color};margin-bottom:0.25rem">Why</p>
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">
          ${s.blurb} ${reasoningFor(status, ctx)}
        </p>
      </div>

      <!-- Watch-for -->
      <div style="background:#f5f7fb;padding:0.7rem 0.9rem;border-radius:8px;margin-bottom:0.7rem">
        <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;
                  letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.25rem">Watching for</p>
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">
          ${watchFor(status, ctx)}
        </p>
      </div>

      ${ctxEvents.length ? renderContextBlock(ctxEvents) : ''}

      <p style="font-size:0.65rem;color:#9aa5b4;margin:0">
        “4-wk trend” is a linear-regression slope through your last
        ${PACE_WINDOW_DAYS} days of weigh-ins — it reads the
        <em>current</em> trajectory through daily noise and can differ
        from the trajectory card's lifetime-of-dose pace when the
        loss curve is bending. Heuristic guidance only — every
        titration decision is your prescriber's call.
      </p>`;
  }

  function statCell(label, value, color, subtext) {
    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.6rem;text-align:center">
        <p style="font-size:0.58rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.2rem">${label}</p>
        <p style="font-size:1rem;font-weight:800;color:${color};margin:0">${value}</p>
        ${subtext ? `<p style="font-size:0.6rem;color:#9aa5b4;margin:0.15rem 0 0">${subtext}</p>` : ''}
      </div>`;
  }

  // Render the "flagged context" block when events overlap the
  // 28-day pace window. Reading the trend slope alongside this list
  // is what makes the readiness verdict trustworthy in practice.
  function renderContextBlock(events) {
    const items = events.map(e => {
      const t = (typeof window.getEventTypeByKey === 'function')
        ? window.getEventTypeByKey(e.type)
        : { label: e.type, color: '#6d7a95' };
      const s = new Date(e.start);
      const en = e.end ? new Date(e.end) : null;
      const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const range = en && en.toDateString() !== s.toDateString()
        ? fmt(s) + ' \u2192 ' + fmt(en)
        : (!en ? fmt(s) + ' \u2192 ongoing' : fmt(s));
      return `
        <li style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;font-size:0.78rem;color:#1a2340">
          <span style="display:inline-block;width:0.55rem;height:0.55rem;border-radius:50%;background:${t.color};flex-shrink:0"></span>
          <span style="font-weight:700">${t.label}</span>
          <span style="color:#6d7a95;font-size:0.72rem">${range}</span>
        </li>`;
    }).join('');

    return `
      <div style="background:#fff7e6;border-left:3px solid #f59f00;
                  padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.7rem">
        <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;
                  letter-spacing:0.08em;color:#995213;margin-bottom:0.35rem">
          Context flags in this window
        </p>
        <ul style="list-style:none;padding:0;margin:0">${items}</ul>
        <p style="font-size:0.7rem;color:#6d7a95;margin:0.4rem 0 0;line-height:1.4">
          The trend above includes these days. If you suspect the slowdown is lifestyle (water, glycogen, sodium) rather than the dose plateauing, give it 10–14 clean days before reading this card as a titration signal.
        </p>
      </div>`;
  }

  window.renderTitrationReadiness = render;

  // ── Hook into projector tab switch (mirror trajectory pattern) ─────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__trHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        // requestAnimationFrame eliminates the flash-of-Loading that a
        // 60ms setTimeout produced; data is already populated by
        // renderAll() so there's nothing to wait for.
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[titration-readiness]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);  // preserve all prior __*Hooked flags
    wrapped.__trHooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => {
        if (installHook() || ++tries > 40) clearInterval(t);
      }, 100);
    }
    if (window.TitrationUtils && window.TitrationUtils.registerProjectorRenderer) {
      window.TitrationUtils.registerProjectorRenderer(render);
    }
  });
})();
