/* ═══════════════════════════════════════════════════════════════════
   plateau-radar.js
   "How much runway before the plateau?" early-warning monitor.

   The Titration Readiness card answers "is the dose working RIGHT NOW?"
   — a snapshot. This card answers the SECOND-order question the 5mg
   experience taught us to fear: "is my pace itself DECELERATING, and
   if so, how many weeks until it craters?"

   The 5mg lesson: pace halved every ~2 weeks (3.85 → 2.82 → 1.34 →
   0.88) and stalled in ~5 weeks. By the time the readiness card said
   READY, weeks of momentum were already gone. This radar watches the
   *slope of the pace* so the plateau telegraphs itself with lead time
   — enough to fill a pre-loaded next dose and catch a whoosh instead
   of a stall.

   Method:
     - Compute the 28-day regression pace as-of several weekly anchor
       dates within the CURRENT dose (so a dose change can't pollute).
     - Regress those pace values vs time → deceleration (lbs/wk per wk).
     - Extrapolate to find weeks-of-runway until pace crosses the
       "act" trigger.

   Source of truth (mirrors titration-readiness.js):
     - Shots:  localStorage['glp1_v4']  (medication.js)
     - Weight: window.allWeightData     (app.js) via TitrationUtils
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[plateau-radar] TitrationUtils missing — card disabled');
    return;
  }

  // ── Policy / thresholds ───────────────────────────────────────
  const PACE_WINDOW_DAYS = 28;   // rolling regression window per anchor
  const ANCHOR_STEP_DAYS = 7;    // one pace sample per week
  const MIN_WIN_READINGS = 4;    // readings needed inside a window to trust its pace
  const MIN_ANCHORS      = 3;    // pace samples needed to estimate deceleration
  const TRIGGER_WATCH    = 1.5;  // lbs/wk — pace heading here → start paying attention
  const TRIGGER_ACT      = 1.0;  // lbs/wk — cross here → pull the pre-loaded dose
  const RUNWAY_SOON_WKS  = 3;    // runway under this → act now
  const RUNWAY_WATCH_WKS = 8;    // runway under this → decelerating

  const COLORS = {
    GATHERING: '#6d7a95',
    STEADY:    '#2a8703',
    SOFTENING: '#0053e2',
    DECEL:     '#995213',
    IMMINENT:  '#ea1100',
  };
  const STATUS = {
    GATHERING: { color: COLORS.GATHERING, label: 'GATHERING',      blurb: 'Not enough pace history on this dose yet to read a deceleration trend.' },
    STEADY:    { color: COLORS.STEADY,    label: 'STEADY',         blurb: 'Your 4-week pace is holding (or rising). No plateau forming — floor is far off.' },
    SOFTENING: { color: COLORS.SOFTENING, label: 'SOFTENING',      blurb: 'Pace is easing gently. Plenty of runway — nothing to do but keep logging.' },
    DECEL:     { color: COLORS.DECEL,     label: 'DECELERATING',   blurb: 'Pace is trending down. The floor is on the radar — confirm your next dose is pre-loaded.' },
    IMMINENT:  { color: COLORS.IMMINENT,  label: 'STALL IMMINENT', blurb: 'Pace is cratering toward the trigger. This is the whoosh-timing window — act now.' },
  };

  // ── Data helpers ──────────────────────────────────────────────
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

  // Least-squares slope of ys vs xs (both plain number arrays).
  function linSlope(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den === 0 ? null : num / den;
  }

  // Build the weekly pace series within the current dose window.
  // Returns { anchors:[{weeksChrono, pace, date}], doseStart, currentDose }.
  function buildPaceSeries() {
    const shots = sortedShots();
    const currentDose = shots.length ? shots[shots.length - 1].dose : null;

    // Confine to the current dose so a titration step can't pollute the
    // deceleration read. Fallback: last 70 days if no shot data.
    const doseStart = shots.length
      ? TU.currentDoseStart(shots)
      : new Date(Date.now() - 70 * TU.MS_PER_DAY);
    if (!doseStart) return { anchors: [], doseStart: null, currentDose };

    const now = new Date();
    // Earliest anchor whose 28-day window sits ENTIRELY inside the dose.
    const earliestAnchorMs = doseStart.getTime() + PACE_WINDOW_DAYS * TU.MS_PER_DAY;

    const anchors = [];
    for (let offset = 0; ; offset += ANCHOR_STEP_DAYS) {
      const anchor = new Date(now.getTime() - offset * TU.MS_PER_DAY);
      if (anchor.getTime() < earliestAnchorMs) break;
      const winStart = new Date(anchor.getTime() - PACE_WINDOW_DAYS * TU.MS_PER_DAY);
      const win = TU.dedupeByDay(TU.readingsBetween(winStart, anchor));
      if (win.length >= MIN_WIN_READINGS) {
        const pace = TU.slopePerWeek(win);           // positive = losing
        if (pace != null) anchors.push({ date: anchor, pace });
      }
      if (offset > 120) break;                        // hard safety stop
    }
    anchors.reverse();                                // chronological: oldest → newest
    if (anchors.length) {
      const t0 = anchors[0].date.getTime();
      anchors.forEach(a => { a.weeksChrono = (a.date.getTime() - t0) / (7 * TU.MS_PER_DAY); });
    }
    return { anchors, doseStart, currentDose };
  }

  // ── Analysis ──────────────────────────────────────────────────
  function analyze() {
    const { anchors, currentDose } = buildPaceSeries();
    if (anchors.length < MIN_ANCHORS) {
      return { status: 'GATHERING', anchors, currentDose, need: MIN_ANCHORS - anchors.length };
    }

    const xs = anchors.map(a => a.weeksChrono);
    const ys = anchors.map(a => a.pace);
    const decelPerWk = linSlope(xs, ys);              // <0 → pace dropping over time
    const paceNow    = anchors[anchors.length - 1].pace;
    const xNow       = xs[xs.length - 1];

    // Runway: weeks until the fitted pace line crosses the ACT trigger.
    let runwayWks = null;
    if (decelPerWk != null && decelPerWk < -0.02 && paceNow > TRIGGER_ACT) {
      runwayWks = (paceNow - TRIGGER_ACT) / (-decelPerWk);
    }

    let status;
    if (paceNow <= TRIGGER_ACT)                              status = 'IMMINENT';
    else if (decelPerWk == null || decelPerWk >= -0.05)      status = 'STEADY';
    else if (runwayWks != null && runwayWks <= RUNWAY_SOON_WKS)  status = 'IMMINENT';
    else if (runwayWks != null && runwayWks <= RUNWAY_WATCH_WKS) status = 'DECEL';
    else                                                    status = 'SOFTENING';

    return { status, anchors, currentDose, decelPerWk, paceNow, runwayWks, xNow };
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('pr-card-body');
    if (!root) return;

    const a = analyze();
    const s = STATUS[a.status];

    if (a.status === 'GATHERING') {
      root.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.7rem">
          <span style="display:inline-block;padding:0.35rem 0.8rem;border-radius:999px;
            background:${s.color}18;color:${s.color};font-size:0.78rem;font-weight:800;
            letter-spacing:0.06em">${s.label}</span>
        </div>
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">
          ${s.blurb} Need about ${a.need} more weekly weigh-in cluster${a.need === 1 ? '' : 's'}
          (the radar needs ${MIN_ANCHORS}+ rolling 28-day pace samples inside the current dose).
        </p>`;
      return;
    }

    const decelStr = a.decelPerWk == null ? '—'
      : (a.decelPerWk <= 0 ? '' : '+') + a.decelPerWk.toFixed(2) + ' lb/wk each wk';
    const paceStr  = a.paceNow.toFixed(2) + ' lb/wk';
    const runwayStr = a.runwayWks == null ? '—'
      : a.runwayWks >= 26 ? '6+ mo'
      : a.runwayWks.toFixed(1) + ' wk';

    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.9rem">
        <span style="display:inline-block;padding:0.35rem 0.8rem;border-radius:999px;
          background:${s.color}18;color:${s.color};font-size:0.78rem;font-weight:800;
          letter-spacing:0.06em">${s.label}</span>
        ${a.currentDose ? `<span style="font-size:0.78rem;color:#1a2340;font-weight:700">on ${a.currentDose}mg</span>` : ''}
      </div>

      ${renderRadarSvg(a, s.color)}

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.6rem;margin:0.9rem 0">
        ${cell('Current pace', paceStr, s.color)}
        ${cell('Deceleration', decelStr, a.decelPerWk != null && a.decelPerWk < -0.05 ? COLORS.DECEL : COLORS.STEADY)}
        ${cell('Runway to ' + TRIGGER_ACT.toFixed(1), runwayStr, a.runwayWks != null && a.runwayWks <= RUNWAY_WATCH_WKS ? COLORS.DECEL : s.color)}
      </div>

      <div style="background:${s.color}0d;border-left:3px solid ${s.color};
        padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.7rem">
        <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;
          letter-spacing:0.08em;color:${s.color};margin-bottom:0.25rem">Read</p>
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">
          ${s.blurb} ${reasoning(a)}
        </p>
      </div>

      <p style="font-size:0.65rem;color:#9aa5b4;margin:0;line-height:1.4">
        "Deceleration" is the slope of your rolling 28-day pace over the last few weeks
        — the trend of the trend. "Runway" linearly extrapolates that to when pace would
        cross ${TRIGGER_ACT.toFixed(1)} lb/wk (the pre-load-the-next-dose trigger). Leading
        indicator, not a prophecy — every dose decision is your prescriber's call.
      </p>`;
  }

  function reasoning(a) {
    const decel = a.decelPerWk;
    if (a.status === 'STEADY')
      return `Pace is essentially flat at ${a.paceNow.toFixed(2)} lb/wk with no downward drift — the floor isn't in sight, so keep riding and burn your current supply.`;
    if (a.status === 'SOFTENING')
      return `Pace is easing about ${Math.abs(decel).toFixed(2)} lb/wk per week — gentle, with ~${a.runwayWks >= 26 ? '6+ months' : a.runwayWks.toFixed(0) + ' weeks'} of runway before the ${TRIGGER_ACT.toFixed(1)} trigger. No action; just watch.`;
    if (a.status === 'DECEL')
      return `Pace is dropping ~${Math.abs(decel).toFixed(2)} lb/wk each week — at this rate you'd hit the ${TRIGGER_ACT.toFixed(1)} trigger in ~${a.runwayWks.toFixed(0)} weeks. Make sure the next dose is pre-loaded so you can move the day the trigger fires.`;
    if (a.status === 'IMMINENT')
      return a.paceNow <= TRIGGER_ACT
        ? `Pace has already fallen to ${a.paceNow.toFixed(2)} lb/wk — at/below the trigger. This is exactly the 5mg-style stall onset; if the next dose is loaded, this is the whoosh-timing moment to discuss pulling it.`
        : `Pace is diving fast — only ~${a.runwayWks.toFixed(1)} weeks of runway to the ${TRIGGER_ACT.toFixed(1)} trigger. Confirm the pre-loaded dose and be ready to act within days.`;
    return '';
  }

  function cell(label, value, color) {
    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.6rem;text-align:center">
        <p style="font-size:0.56rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.07em;color:#6d7a95;margin-bottom:0.2rem">${label}</p>
        <p style="font-size:0.95rem;font-weight:800;color:${color};margin:0">${value}</p>
      </div>`;
  }

  // Inline-SVG: the weekly pace points + fitted decel line, extended
  // (dashed) to the trigger crossing. A horizontal trigger line makes
  // the "when do I cross the floor" question visual.
  function renderRadarSvg(a, color) {
    const pts = a.anchors;
    if (!pts || pts.length < 2) return '';
    const W = 100, H = 42, PADX = 3, PADY = 5;
    const innerW = W - PADX * 2, innerH = H - PADY * 2;

    // x domain: from first anchor to (now + runway, capped) so the
    // projected crossing is visible when there is one.
    const xNow = a.xNow;
    const projSpan = (a.runwayWks != null && a.runwayWks <= 20) ? a.runwayWks : 0;
    const xMax = Math.max(xNow + projSpan, xNow + 1);
    const xMin = 0;

    // y domain: 0 → a little above max pace, always including trigger.
    const paces = pts.map(p => p.pace);
    const yTop = Math.max(...paces, TRIGGER_WATCH) * 1.15;
    const yBot = 0;

    const xOf = w => PADX + ((w - xMin) / (xMax - xMin || 1)) * innerW;
    const yOf = v => PADY + (1 - (v - yBot) / (yTop - yBot || 1)) * innerH;

    // fitted line params (pace = m*x + b) via the same anchors
    const xs = pts.map(p => p.weeksChrono), ys = pts.map(p => p.pace);
    const m = linSlope(xs, ys) || 0;
    const b = (ys.reduce((s2, v) => s2 + v, 0) / ys.length) - m * (xs.reduce((s2, v) => s2 + v, 0) / xs.length);
    const fit = x => m * x + b;

    const trigY = yOf(TRIGGER_ACT).toFixed(2);
    const watchY = yOf(TRIGGER_WATCH).toFixed(2);

    // solid fit over observed range, dashed over projection
    const solid = `M ${xOf(xMin).toFixed(2)} ${yOf(fit(xMin)).toFixed(2)} L ${xOf(xNow).toFixed(2)} ${yOf(fit(xNow)).toFixed(2)}`;
    const dash  = projSpan > 0
      ? `M ${xOf(xNow).toFixed(2)} ${yOf(fit(xNow)).toFixed(2)} L ${xOf(xMax).toFixed(2)} ${yOf(fit(xMax)).toFixed(2)}`
      : '';

    const dots = pts.map(p =>
      `<circle cx="${xOf(p.weeksChrono).toFixed(2)}" cy="${yOf(p.pace).toFixed(2)}" r="1.2" fill="${color}"/>`
    ).join('');

    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.55rem 0.7rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.3rem">
          <span style="font-size:0.6rem;font-weight:700;text-transform:uppercase;
            letter-spacing:0.08em;color:#6d7a95">Pace trend (lb/wk over recent weeks)</span>
          <span style="font-size:0.62rem;color:#9aa5b4">trigger ${TRIGGER_ACT.toFixed(1)}</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
             style="width:100%;height:64px;display:block" role="img"
             aria-label="Pace trend with projected trigger crossing">
          <line x1="${PADX}" y1="${watchY}" x2="${W - PADX}" y2="${watchY}" stroke="#f59f00" stroke-width="0.4" stroke-dasharray="1 1.5" opacity="0.7"/>
          <line x1="${PADX}" y1="${trigY}" x2="${W - PADX}" y2="${trigY}" stroke="#ea1100" stroke-width="0.5" stroke-dasharray="1.5 1.5" opacity="0.8"/>
          <path d="${solid}" fill="none" stroke="${color}" stroke-width="0.8"/>
          ${dash ? `<path d="${dash}" fill="none" stroke="${color}" stroke-width="0.8" stroke-dasharray="1.5 1.2" opacity="0.7"/>` : ''}
          ${dots}
        </svg>
      </div>`;
  }

  window.renderPlateauRadar = render;

  // ── Wire into projector tab (mirror titration-readiness pattern) ──
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__prHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[plateau-radar]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__prHooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => { if (installHook() || ++tries > 40) clearInterval(t); }, 100);
    }
    if (TU.registerProjectorRenderer) TU.registerProjectorRenderer(render);
  });
})();
