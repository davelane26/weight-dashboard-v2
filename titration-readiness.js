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

  // ── Thresholds & ladder (top-of-file = easy to tweak) ──────────────
  const DOSE_LADDER       = [2.5, 5, 7.5, 10, 12.5, 15];  // mg
  const MIN_WEEKS_ON_DOSE = 4;     // label minimum before considering up-titration
  const READY_PACE_MAX    = 0.5;   // lbs/wk — under this for "ready"
  const WATCH_PACE_MAX    = 1.0;   // lbs/wk — under this for "watch"
  const PACE_WINDOW_DAYS  = 28;    // rolling window for pace calc
  const MIN_READINGS_FOR_PACE = 3; // need at least N readings in window

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

  // ── Helpers ────────────────────────────────────────────────────────
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

  function nextDose(current) {
    const i = DOSE_LADDER.indexOf(current);
    if (i < 0 || i === DOSE_LADDER.length - 1) return null;
    return DOSE_LADDER[i + 1];
  }

  // First shot at the *current* dose (i.e. the up-titration moment)
  function currentDoseStart(shots) {
    if (!shots.length) return null;
    const dose = shots[shots.length - 1].dose;
    for (let i = shots.length - 1; i >= 0; i--) {
      if (shots[i].dose !== dose) return shots[i + 1]._dt;
    }
    return shots[0]._dt;
  }

  // Linear-regression slope (lbs per day) over the readings provided.
  // Returns null if fewer than 2 points or zero day-span.
  function slopePerDay(readings) {
    if (readings.length < 2) return null;
    const t0 = readings[0].date.getTime();
    const xs = readings.map(r => (r.date.getTime() - t0) / 86_400_000);
    const ys = readings.map(r => r.weight);
    const n  = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    if (den === 0) return null;
    return num / den;
  }

  // Readings in the last `days` days, sorted ascending.
  function recentReadings(days) {
    const all = window.allWeightData || [];
    if (!all.length) return [];
    const cutoff = Date.now() - days * 86_400_000;
    return all
      .filter(r => r.date && r.date.getTime() >= cutoff)
      .sort((a, b) => a.date - b.date);
  }

  function readingsSince(date) {
    const all = window.allWeightData || [];
    return all
      .filter(r => r.date && r.date.getTime() >= date.getTime())
      .sort((a, b) => a.date - b.date);
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
    const { weeksOnDose, currentDose, nextDoseMg, rollingPace, lossOnDose } = ctx;
    const paceStr = rollingPace == null ? 'n/a' : rollingPace.toFixed(2) + ' lbs/wk';

    switch (status) {
      case 'HOLD':
        if (weeksOnDose < MIN_WEEKS_ON_DOSE) {
          const left = (MIN_WEEKS_ON_DOSE - weeksOnDose).toFixed(1);
          return `Only ${weeksOnDose.toFixed(1)} wks on ${currentDose}mg — Lilly's label asks for at least ${MIN_WEEKS_ON_DOSE} wks before stepping up. ${left} wks to go.`;
        }
        return `Not enough weigh-ins in the last ${PACE_WINDOW_DAYS} days to compute a reliable pace. Log a few more readings.`;
      case 'RIDE':
        return `Rolling 4-wk pace is ${paceStr} — ${currentDose}mg is still pulling its weight (you've lost ${lossOnDose.toFixed(1)} lbs on this dose). No reason to climb the ladder.`;
      case 'WATCH':
        return `Pace has slowed to ${paceStr}. Not stalled yet — but trending toward the threshold. One more weigh-in cycle should clarify.`;
      case 'READY':
        return `Pace is ${paceStr} over the last ${PACE_WINDOW_DAYS} days, after ${weeksOnDose.toFixed(1)} wks on ${currentDose}mg. By the "lowest effective dose for the longest time" rule you used on 5mg, this is the natural moment to discuss ${nextDoseMg}mg with your prescriber.`;
      case 'MAX':
        return `You're on the top rung (15mg). Further escalation isn't an option — focus shifts to nutrition, training, and maintenance strategy.`;
      case 'REGAIN':
        return `Pace is ${paceStr} (gaining). Don't titrate up to mask a behavioral or measurement issue — find the cause first (hydration, cycle, sodium, sleep, scale anomaly).`;
    }
    return '';
  }

  function watchFor(status, ctx) {
    const { currentDose, nextDoseMg } = ctx;
    switch (status) {
      case 'HOLD':
        return 'Log weigh-ins weekly (ideally pre-shot day) so the pace estimate stabilises.';
      case 'RIDE':
        return `When 4-wk pace drops under ${WATCH_PACE_MAX} lbs/wk, the widget will flip to WATCH. No action needed today.`;
      case 'WATCH':
        return `If pace stays under ${READY_PACE_MAX} lbs/wk for another 1–2 weigh-ins, this card will flip to READY.`;
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
    const doseStart   = currentDoseStart(shots);
    const weeksOnDose = (Date.now() - doseStart.getTime()) / (7 * 86_400_000);
    const nextDoseMg  = nextDose(currentDose);

    // Loss on current dose: first weight on/after doseStart vs latest
    const doseReadings = readingsSince(doseStart);
    const lossOnDose   = doseReadings.length >= 2
      ? doseReadings[0].weight - doseReadings[doseReadings.length - 1].weight
      : 0;

    // Rolling 4-week pace via linear regression
    const window28    = recentReadings(PACE_WINDOW_DAYS);
    const slopePerDayVal = slopePerDay(window28);
    const rollingPace = slopePerDayVal == null ? null : -slopePerDayVal * 7;  // positive = losing

    const ctx = { weeksOnDose, currentDose, nextDoseMg, rollingPace, lossOnDose,
                  paceReadings: window28.length };
    const status = decideStatus(ctx);
    const s = STATUS[status];

    const paceDisplay = rollingPace == null ? '—' :
      (rollingPace >= 0 ? rollingPace.toFixed(2) : '+' + Math.abs(rollingPace).toFixed(2)) + ' lbs/wk';

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

      <!-- 4-stat grid -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.6rem;margin-bottom:0.9rem">
        ${statCell('Wks on dose', weeksOnDose.toFixed(1), '#0053e2')}
        ${statCell('Loss on dose', lossDisplay, lossOnDose >= 0 ? '#2a8703' : '#ea1100')}
        ${statCell('4-wk pace', paceDisplay, s.color)}
        ${statCell('Readings (28d)', String(window28.length), '#1a2340')}
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

      <p style="font-size:0.65rem;color:#9aa5b4;margin:0">
        Heuristic guidance only — every titration decision is your prescriber's call.
      </p>`;
  }

  function statCell(label, value, color) {
    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.6rem;text-align:center">
        <p style="font-size:0.58rem;font-weight:700;text-transform:uppercase;
                  letter-spacing:0.08em;color:#6d7a95;margin-bottom:0.2rem">${label}</p>
        <p style="font-size:1rem;font-weight:800;color:${color};margin:0">${value}</p>
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
        setTimeout(() => {
          try { render(); } catch (e) { console.warn('[titration-readiness]', e); }
        }, 60);
      }
      return out;
    };
    Object.assign(wrapped, orig);  // preserve any __tjHooked / __r220Hooked flags
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
  });
})();
