/* ===================================================================
   stall-radar.js
   "Am I in a stall RIGHT NOW, and if so -- whoosh coming or real ceiling?"

   Companion to plateau-radar.js. Where the Plateau Radar answers the
   forward-looking question ("when will my pace hit the trigger?"), this
   card answers the here-and-now question that causes 90% of GLP-1
   titration anxiety: "the scale hasn't moved in X days -- do I wait
   it out, or is the dose actually done?"

   Method:
     1. Find the CURRENT flat run of the 7-day rolling average
        (window in which ravg stays within +/- FLAT_BAND).
     2. During that flat window, score the "whoosh vs ceiling" signals
        derived from body-comp trends:
          - Body fat %  still dropping   -> whoosh-consistent
          - Muscle (lb) stable or rising -> whoosh-consistent
          - Water %     flat or dipping  -> whoosh-consistent
        Each ceiling-consistent trend counts against; whoosh-consistent
        counts for.
     3. Combine duration + score to output a status:
          CRUISING          -- not currently flat, keep going
          EARLY_STALL       -- < 10d flat, statistically nothing yet
          WHOOSH_IMMINENT   -- 7-14d flat + signals whoosh-consistent
          WATCH             -- 14-21d flat, mixed signals
          CEILING_CANDIDATE -- > 21d flat OR clear ceiling signals
     4. Compare current stall length against the historical distribution
        of the user's own past stalls so they see "am I in-range or
        out-of-range for me."

   Data source: window.allWeightData (schema r.date, r.weight, r.fat,
   r.muscle, r.water) via TitrationUtils.
   =================================================================== */
(function () {
  'use strict';

  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[stall-radar] TitrationUtils missing -- card disabled');
    return;
  }

  // -- Policy / tolds -----------------------------------------
  const FLAT_BAND        = 1.0;   // +/- lb around ravg to count as "flat"
  const MIN_STALL_DAYS   = 7;     // minimum flat days to call it a stall
  const RAVG_WINDOW      = 7;     // rolling avg window (days)
  const WATCH_DAYS       = 14;    // flat >= this -> WATCH tier
  const CEILING_DAYS     = 21;    // flat >= this -> CEILING regardless
  const BC_LOOKBACK      = 14;    // days back to measure BC trend
  const BF_DROP_EPS      = 0.15;  // pp drop over BC_LOOKBACK to count "dropping"
  const MU_RISE_EPS      = 0.10;  // lb over BC_LOOKBACK to count "rising"
  const WATER_RISE_EPS   = 0.30;  // pp rise = ceiling-consistent

  const COLORS = {
    CRUISING:  '#2a8703',
    EARLY:     '#0053e2',
    WHOOSH:    '#0d9488',
    WATCH:     '#b45309',
    CEILING:   '#ea1100',
    GATHERING: '#6d7a95',
  };

  const STATUS = {
    CRUISING: {
      color: COLORS.CRUISING, label: 'CRUISING',
      blurb: 'Not in a stall right now -- 7-day average is still moving. Keep logging, no decision needed.',
    },
    EARLY_STALL: {
      color: COLORS.EARLY, label: 'EARLY STALL',
      blurb: 'Scale is flat but you are well within your normal cadence. Statistically nothing yet -- most stalls this short break within days.',
    },
    WHOOSH_IMMINENT: {
      color: COLORS.WHOOSH, label: 'WHOOSH IMMINENT',
      blurb: 'You have been flat long enough that a whoosh is due, AND body-comp signals say fat is still leaving. Water is likely hiding real loss. Wait it out.',
    },
    WATCH: {
      color: COLORS.WATCH, label: 'WATCH',
      blurb: 'You are past the median stall length with mixed signals. Not urgent yet -- confirm your body-comp trend and appetite over the next few days.',
    },
    CEILING_CANDIDATE: {
      color: COLORS.CEILING, label: 'CEILING CANDIDATE',
      blurb: 'Stall is out of your normal distribution OR body-comp trend has gone flat. This is when a titration conversation is genuinely earned.',
    },
    GATHERING: {
      color: COLORS.GATHERING, label: 'GATHERING',
      blurb: 'Not enough recent data to score this card. Need at least a couple of weeks of daily readings.',
    },
  };

  // -- Data prep ---------------------------------------------------
  // Build daily-deduped, chronologically-ordered readings and attach a
  // rolling 7-day average of weight.
  function prep(readings) {
    const rows = TU.dedupeByDay(readings || []);
    for (let i = 0; i < rows.length; i++) {
      const window = [];
      for (let j = Math.max(0, i - RAVG_WINDOW + 1); j <= i; j++) {
        window.push(rows[j].weight);
      }
      rows[i]._ravg = window.reduce((a, b) => a + b, 0) / window.length;
    }
    return rows;
  }

  // Walk backward from the latest reading to find the current flat run.
  // Returns { flatDays, centerLb, startIdx, endIdx } or null if not flat.
  function currentFlatRun(rows) {
    if (rows.length < MIN_STALL_DAYS) return null;
    const endIdx = rows.length - 1;
    const anchor = rows[endIdx]._ravg;
    let startIdx = endIdx;
    for (let i = endIdx - 1; i >= 0; i--) {
      if (Math.abs(rows[i]._ravg - anchor) <= FLAT_BAND) {
        startIdx = i;
      } else {
        break;
      }
    }
    const flatDays = Math.round(
      (rows[endIdx].date.getTime() - rows[startIdx].date.getTime()) / TU.MS_PER_DAY
    ) + 1;
    if (flatDays < MIN_STALL_DAYS) return null;
    const centerLb = rows.slice(startIdx, endIdx + 1)
      .reduce((s, r) => s + r._ravg, 0) / (endIdx - startIdx + 1);
    return { flatDays, centerLb, startIdx, endIdx };
  }

  // Historical flat-run detection over the entire series. Used to
  // compute this user's own distribution (median, max) so we compare
  // apples to apples.
  function allFlatRuns(rows) {
    const runs = [];
    let i = 0;
    while (i < rows.length) {
      const anchor = rows[i]._ravg;
      let j = i;
      while (j < rows.length && Math.abs(rows[j]._ravg - anchor) <= FLAT_BAND) j++;
      const days = Math.round((rows[j - 1].date.getTime() - rows[i].date.getTime()) / TU.MS_PER_DAY) + 1;
      if (days >= MIN_STALL_DAYS) runs.push({ start: rows[i].date, end: rows[j - 1].date, days });
      i = (days >= MIN_STALL_DAYS) ? j : i + 1;
    }
    return runs;
  }

  // Simple slope (per day) of any field over the last N days.
  // Returns null if fewer than 4 non-null samples in the window.
  function fieldSlopePerDay(rows, field, days) {
    const end = rows[rows.length - 1].date;
    const start = new Date(end.getTime() - days * TU.MS_PER_DAY);
    const pts = rows.filter(r => r.date >= start && r[field] != null)
                    .map(r => ({ x: (r.date.getTime() - start.getTime()) / TU.MS_PER_DAY, y: r[field] }));
    if (pts.length < 4) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let num = 0, den = 0;
    for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    return den === 0 ? null : num / den;
  }

  // Score the three concurrent body-comp signals.
  // Returns { bf, mu, wa, score, verdict } where each of bf/mu/wa is
  // one of 'whoosh' | 'ceiling' | 'flat' | 'nodata', and score is the
  // net signal (+ = whoosh-consistent, - = ceiling-consistent).
  function scoreSignals(rows) {
    // Slopes are per day. Multiply by BC_LOOKBACK to get "change over
    // the window" so thresholds are in the units the user thinks in.
    const bfSlope = fieldSlopePerDay(rows, 'fat',    BC_LOOKBACK);
    const muSlope = fieldSlopePerDay(rows, 'muscle', BC_LOOKBACK);
    const waSlope = fieldSlopePerDay(rows, 'water',  BC_LOOKBACK);

    const bfChange = bfSlope == null ? null : bfSlope * BC_LOOKBACK;
    const muChange = muSlope == null ? null : muSlope * BC_LOOKBACK;
    const waChange = waSlope == null ? null : waSlope * BC_LOOKBACK;

    function tri(change, eps, positiveIs) {
      // positiveIs === 'ceiling' or 'whoosh': tells us which direction
      // is bad. eps is the threshold for "meaningfully moving."
      if (change == null) return 'nodata';
      if (Math.abs(change) < eps) return 'flat';
      if (change < 0) return positiveIs === 'ceiling' ? 'whoosh' : 'ceiling';
      return positiveIs === 'ceiling' ? 'ceiling' : 'whoosh';
    }

    // For BF and Water: RISING = ceiling-consistent (positiveIs=ceiling)
    // For Muscle: RISING = whoosh-consistent (positiveIs=whoosh)
    const bf = tri(bfChange, BF_DROP_EPS,    'ceiling');
    const mu = tri(muChange, MU_RISE_EPS,    'whoosh');
    const wa = tri(waChange, WATER_RISE_EPS, 'ceiling');

    const tally = t => (t === 'whoosh' ? 1 : t === 'ceiling' ? -1 : 0);
    const score = tally(bf) + tally(mu) + tally(wa);

    let verdict;
    if (score >= 2)   verdict = 'whoosh-consistent';
    else if (score <= -2) verdict = 'ceiling-consistent';
    else                  verdict = 'mixed';

    return { bf, mu, wa, bfChange, muChange, waChange, score, verdict };
  }

  // -- Analysis ---------------------------------------------------
  function analyze() {
    const rows = prep(window.allWeightData);
    if (rows.length < MIN_STALL_DAYS + 3) {
      return { status: 'GATHERING', rows };
    }

    const runs      = allFlatRuns(rows);
    const historyN  = runs.length;
    const medianLen = historyN
      ? runs.slice().sort((a, b) => a.days - b.days)[Math.floor(historyN / 2)].days
      : null;
    const maxLen    = historyN ? Math.max(...runs.map(r => r.days)) : null;

    const current = currentFlatRun(rows);
    const signals = scoreSignals(rows);
    const latest  = rows[rows.length - 1];

    // Not currently in a stall -> CRUISING.
    if (!current) {
      // Days since previous flat run ended -- useful "in your rhythm" stat.
      const lastRun = runs.length ? runs[runs.length - 1] : null;
      const daysSinceLast = lastRun
        ? Math.round((latest.date.getTime() - lastRun.end.getTime()) / TU.MS_PER_DAY)
        : null;
      return {
        status: 'CRUISING', rows, signals,
        historyN, medianLen, maxLen,
        daysSinceLast, latest, current: null,
      };
    }

    // Currently in a stall -> classify by duration + signals.
    let status;
    if (signals.verdict === 'ceiling-consistent') {
      status = 'CEILING_CANDIDATE';
    } else if (current.flatDays >= CEILING_DAYS) {
      status = 'CEILING_CANDIDATE';
    } else if (current.flatDays >= WATCH_DAYS) {
      status = signals.verdict === 'whoosh-consistent' ? 'WHOOSH_IMMINENT' : 'WATCH';
    } else if (current.flatDays >= MIN_STALL_DAYS + 3 && signals.verdict === 'whoosh-consistent') {
      status = 'WHOOSH_IMMINENT';
    } else {
      status = 'EARLY_STALL';
    }

    return {
      status, rows, signals,
      historyN, medianLen, maxLen,
      current, latest,
    };
  }

  // -- Render ------------------------------------------------------
  function render() {
    const root = document.getElementById('sr-card-body');
    if (!root) return;
    const a = analyze();
    const s = STATUS[a.status];

    if (a.status === 'GATHERING') {
      root.innerHTML = pillHtml(s) +
        `<p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0.7rem 0 0">${s.blurb}</p>`;
      return;
    }

    root.innerHTML = `
      ${pillHtml(s, a.current ? `${a.current.flatDays}d flat @ ${a.current.centerLb.toFixed(1)} lb`
                              : 'not stalled')}
      ${gaugeHtml(a)}
      ${signalsHtml(a.signals)}
      ${historyHtml(a)}
      ${readHtml(a, s)}
      <p style="font-size:0.65rem;color:#9aa5b4;margin:0.7rem 0 0;line-height:1.4">
        Concurrent signals: body fat trend, muscle trend, and water% trend over the
        last ${BC_LOOKBACK} days. Fat dropping + muscle steady + water flat = "water hiding
        fat" = whoosh-consistent. Fat flat + water rising = "real energy stall" =
        ceiling-consistent. Not a prescription -- your prescriber owns dose decisions.
      </p>
    `;
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

  // Stall-duration gauge: shows current flat-days vs 0 -> CEILING_DAYS
  // with WATCH and CEILING markers. Skipped when CRUISING.
  function gaugeHtml(a) {
    if (!a.current) return '';
    const pct = Math.min(100, (a.current.flatDays / CEILING_DAYS) * 100);
    const watchPct = (WATCH_DAYS   / CEILING_DAYS) * 100;
    return `
      <div style="background:#f0f4ff;border-radius:10px;padding:0.7rem 0.9rem;margin-bottom:0.9rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem">
          <span style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">
            Days flat / Stall duration
          </span>
          <span style="font-size:0.85rem;font-weight:800;color:#1a2340">${a.current.flatDays}d</span>
        </div>
        <div style="position:relative;height:10px;background:#dbe2f5;border-radius:6px;overflow:hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${pct.toFixed(1)}%;
            background:linear-gradient(90deg, #2a8703 0%, #b45309 ${(watchPct*100/pct||0).toFixed(0)}%, #ea1100 100%);"></div>
          <div style="position:absolute;left:${watchPct.toFixed(1)}%;top:-2px;bottom:-2px;width:2px;background:#b45309"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:#6d7a95;margin-top:0.3rem">
          <span>0d</span>
          <span>WATCH ${WATCH_DAYS}d</span>
          <span>CEILING ${CEILING_DAYS}d+</span>
        </div>
      </div>`;
  }

  function signalsHtml(sig) {
    if (!sig) return '';
    function tile(label, verdict, changeStr) {
      const map = {
        whoosh:  { color: '#0d9488', txt: 'whoosh-consistent' },
        ceiling: { color: '#ea1100', txt: 'ceiling-consistent' },
        flat:    { color: '#6d7a95', txt: 'flat / neutral' },
        nodata:  { color: '#9aa5b4', txt: 'no data' },
      };
      const m = map[verdict];
      return `
        <div style="background:#f0f4ff;border-radius:10px;padding:0.55rem;text-align:center">
          <p style="font-size:0.56rem;font-weight:700;text-transform:uppercase;
            letter-spacing:0.07em;color:#6d7a95;margin-bottom:0.15rem">${label}</p>
          <p style="font-size:0.72rem;font-weight:800;color:${m.color};margin:0 0 0.1rem">${m.txt}</p>
          <p style="font-size:0.6rem;color:#6d7a95;margin:0">${changeStr}</p>
        </div>`;
    }
    const bfStr = sig.bfChange == null ? '--' : (sig.bfChange > 0 ? '+' : '') + sig.bfChange.toFixed(2) + ' pp/14d';
    const muStr = sig.muChange == null ? '--' : (sig.muChange > 0 ? '+' : '') + sig.muChange.toFixed(2) + ' lb/14d';
    const waStr = sig.waChange == null ? '--' : (sig.waChange > 0 ? '+' : '') + sig.waChange.toFixed(2) + ' pp/14d';
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.9rem">
        ${tile('Body fat %', sig.bf, bfStr)}
        ${tile('Muscle',     sig.mu, muStr)}
        ${tile('Water %',    sig.wa, waStr)}
      </div>`;
  }

  function historyHtml(a) {
    if (!a.historyN) return '';
    const parts = [
      `<strong>${a.historyN}</strong> past stall${a.historyN === 1 ? '' : 's'}`,
      `median <strong>${a.medianLen}d</strong>`,
      `max <strong>${a.maxLen}d</strong>`,
    ];
    if (a.current) {
      const pct = Math.round((a.current.flatDays / a.maxLen) * 100);
      parts.push(`current is <strong>${pct}%</strong> of your max`);
    } else if (a.daysSinceLast != null) {
      parts.push(`<strong>${a.daysSinceLast}d</strong> since last`);
    }
    return `
      <div style="background:#f7f9fc;border:1px solid #e2e8f0;border-radius:8px;
        padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.72rem;color:#475569">
        Your history: ${parts.join(' &middot; ')}
      </div>`;
  }

  function readHtml(a, s) {
    let extra = '';
    if (a.status === 'CRUISING') {
      extra = a.daysSinceLast != null
        ? ` Last stall ended ${a.daysSinceLast} days ago -- next one is not on the radar yet.`
        : '';
    } else if (a.status === 'EARLY_STALL') {
      extra = ` You are only ${a.current.flatDays} days in vs your median of ${a.medianLen || 'N/A'}. Do nothing.`;
    } else if (a.status === 'WHOOSH_IMMINENT') {
      extra = ` Signals agree: fat leaving, water hiding it. Historical whoosh delivery window is now open.`;
    } else if (a.status === 'WATCH') {
      extra = ` Give it 3-5 more days. If body comp goes flat AND appetite/food noise return, escalate to CEILING.`;
    } else if (a.status === 'CEILING_CANDIDATE') {
      extra = a.current.flatDays >= CEILING_DAYS
        ? ` ${a.current.flatDays} days is beyond your prior max (${a.maxLen || '?'}). Genuine ceiling territory.`
        : ` Body-comp trend has flattened alongside the scale. That is the profile of a real ceiling, not a whoosh-hold.`;
    }
    return `
      <div style="background:${s.color}0d;border-left:3px solid ${s.color};
        padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.4rem">
        <p style="font-size:0.72rem;font-weight:800;text-transform:uppercase;
          letter-spacing:0.08em;color:${s.color};margin-bottom:0.25rem">Read</p>
        <p style="font-size:0.82rem;color:#1a2340;line-height:1.45;margin:0">
          ${s.blurb}${extra}
        </p>
      </div>`;
  }

  window.renderStallRadar = render;

  // -- Wire into projector renderer chain + tab switch -----------
  function installTabHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__srHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'weight') {
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[stall-radar]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__srHooked = true;
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
