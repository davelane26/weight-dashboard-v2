/* ===================================================================
   trend-check.js
   The only question worth asking about a daily weigh-in:

       "Is the 14-day slope still negative?"

       Yes  -> nothing to do. Log tomorrow.
       Flat -> nothing to do. Log tomorrow.
       No   -> okay, NOW we can talk.

   Everything else (whoosh vs ceiling, stall duration, body-comp
   signal tri-panels, historical stall distribution) is noise dressed
   up as content. It gives the anxious brain more surface area to
   chew on without changing any decision. This card refuses to
   participate in that game.

   Replaces the old Stall Radar. Occupies the same DOM slot
   (#sr-card-body) so no index.html surgery is required beyond
   swapping the section title + description.
   =================================================================== */
(function () {
  'use strict';

  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[trend-check] TitrationUtils missing -- card disabled');
    return;
  }

  // -- Policy -----------------------------------------------------
  const WINDOW_DAYS   = 14;    // slope window
  const FLAT_EPS      = 0.25;  // lb/wk considered "flat" (within noise)
  const RAVG_WINDOW   = 7;     // for the sub-line 7-day average

  // Three (and only three) states. Deliberately few.
  const STATE = {
    DROPPING: {
      color: '#2a8703', label: 'STILL DROPPING',
      read: 'The 14-day trend is negative. Nothing to decide. Log tomorrow.',
    },
    FLAT: {
      color: '#6d7a95', label: 'HOLDING',
      read: 'The 14-day trend is inside daily-noise range. Not a stall, not progress -- just flat. Log tomorrow, revisit in a week.',
    },
    RISING: {
      color: '#ea1100', label: 'TRENDING UP',
      read: 'The 14-day trend is positive. This is the signal that actually warrants a conversation -- with yourself, your prescriber, or both.',
    },
    GATHERING: {
      color: '#6d7a95', label: 'GATHERING',
      read: 'Need at least 14 days of readings to compute a trend. Log a few more and check back.',
    },
  };

  // -- Analysis ---------------------------------------------------
  function analyze() {
    const all = TU.dedupeByDay(window.allWeightData || []);
    if (all.length < 5) return { state: STATE.GATHERING };

    const latest    = all[all.length - 1];
    const windowStart = new Date(latest.date.getTime() - WINDOW_DAYS * TU.MS_PER_DAY);
    const win       = all.filter(r => r.date >= windowStart);
    if (win.length < 4) return { state: STATE.GATHERING };

    // slopePerWeek returns lb/wk with LOSING as positive.
    const lossPerWeek = TU.slopePerWeek(win);
    if (lossPerWeek == null) return { state: STATE.GATHERING };

    // 7-day average (the number that actually deserves emotional weight)
    const ravgStart = new Date(latest.date.getTime() - RAVG_WINDOW * TU.MS_PER_DAY);
    const ravgRows  = all.filter(r => r.date >= ravgStart);
    const ravg = ravgRows.reduce((s, r) => s + r.weight, 0) / ravgRows.length;

    let state;
    if      (lossPerWeek >  FLAT_EPS) state = STATE.DROPPING;
    else if (lossPerWeek < -FLAT_EPS) state = STATE.RISING;
    else                              state = STATE.FLAT;

    return { state, lossPerWeek, ravg, latest, sampleN: win.length };
  }

  // -- Render -----------------------------------------------------
  function render() {
    const root = document.getElementById('sr-card-body');
    if (!root) return;
    const a = analyze();
    const s = a.state;

    if (s === STATE.GATHERING) {
      root.innerHTML = pillHtml(s) + readHtml(s);
      return;
    }

    root.innerHTML = pillHtml(s, formatSlope(a.lossPerWeek)) +
                     statsHtml(a) +
                     readHtml(s);
  }

  function formatSlope(lossPerWeek) {
    // lossPerWeek: positive = losing, negative = gaining
    const abs = Math.abs(lossPerWeek);
    if (Math.abs(lossPerWeek) <= FLAT_EPS) return `${lossPerWeek >= 0 ? '-' : '+'}${abs.toFixed(2)} lb/wk`;
    const sign = lossPerWeek > 0 ? '-' : '+';   // display in "weight change" sign convention
    return `${sign}${abs.toFixed(2)} lb/wk`;
  }

  function pillHtml(s, sub) {
    return `
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.9rem">
        <span style="display:inline-block;padding:0.35rem 0.8rem;border-radius:999px;
          background:${s.color}18;color:${s.color};font-size:0.78rem;font-weight:800;
          letter-spacing:0.06em">${s.label}</span>
        ${sub ? `<span style="font-size:0.78rem;color:#1a2340;font-weight:700">${sub}</span>` : ''}
      </div>`;
  }

  function statsHtml(a) {
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.9rem">
        ${tile('7-day avg',  `${a.ravg.toFixed(1)} lb`,        'the number worth trusting')}
        ${tile('Today raw',  `${a.latest.weight.toFixed(1)} lb`, 'noise around the avg')}
        ${tile('Samples',    `${a.sampleN}/${WINDOW_DAYS}`,     'readings in slope window')}
      </div>`;
  }

  function tile(label, value, hint) {
    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.55rem;text-align:center">
        <p style="font-size:0.56rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.07em;color:#6d7a95;margin-bottom:0.15rem">${label}</p>
        <p style="font-size:0.9rem;font-weight:800;color:#1a2340;margin:0 0 0.1rem">${value}</p>
        <p style="font-size:0.58rem;color:#6d7a95;margin:0">${hint}</p>
      </div>`;
  }

  function readHtml(s) {
    return `
      <div style="background:${s.color}0d;border-left:3px solid ${s.color};
        padding:0.7rem 0.9rem;border-radius:0 8px 8px 0">
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">${s.read}</p>
      </div>`;
  }

  window.renderTrendCheck = render;

  // -- Wire into projector renderer chain + tab switch -----------
  function installTabHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__tcHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'weight') {
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[trend-check]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__tcHooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!installTabHook()) {
      let tries = 0;
      const t = setInterval(() => { if (installTabHook() || ++tries > 40) clearInterval(t); }, 100);
    }
    if (TU.registerProjectorRenderer) TU.registerProjectorRenderer(render);
  });
})();
