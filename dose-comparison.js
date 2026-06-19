/* ═══════════════════════════════════════════════════════════════════
   dose-comparison.js
   Dose-vs-Dose Comparison card for the Projector tab.

   What it answers: "How is each dose actually performing for me?"
   Pulls every shot from localStorage and groups by dose level, then
   computes per-dose stats (weeks, lbs lost, pace) using the same
   pre-change-baseline logic as the rest of the projector cards. The
   table makes the prescriber pitch obvious: if 7.5mg is pulling 2.5x
   the pace of 5mg, you've got an evidence-based argument to climb
   the ladder. If a dose's pace ALSO slowed sharply at the end, that's
   the signal to escalate.

   Pace is computed two ways per dose:
     * Endpoint pace = (preBaseline - endWeight) / weeks
         Matches what the trajectory card shows for the current dose.
     * Regression slope through readings on this dose
         More resistant to single-day noise on the endpoints.

   Both are shown so the user can see when they agree vs disagree.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[dose-comparison] TitrationUtils missing — card disabled');
    return;
  }

  // ── Helpers ────────────────────────────────────────────────
  function loadShots() {
    try { return JSON.parse(localStorage.getItem('glp1_v4')) || []; }
    catch (e) { return []; }
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Group shots by dose into chronological "episodes" — each time
  // the dose changes (or starts), a new episode begins. An episode
  // ends when the next dose starts (or now, for the current dose).
  // Returns array of { dose, startDate, endDate, isCurrent, shotCount }.
  function buildEpisodes(shots) {
    const sorted = shots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);

    if (!sorted.length) return [];

    const episodes = [];
    let cur = {
      dose:      sorted[0].dose,
      startDate: sorted[0]._dt,
      endDate:   null,
      shotCount: 0,
    };

    sorted.forEach(s => {
      if (s.dose !== cur.dose) {
        cur.endDate = s._dt;
        episodes.push(cur);
        cur = {
          dose:      s.dose,
          startDate: s._dt,
          endDate:   null,
          shotCount: 1,
        };
      } else {
        cur.shotCount++;
      }
    });
    cur.endDate   = null;        // null = ongoing
    cur.isCurrent = true;
    episodes.push(cur);
    return episodes;
  }

  // Find a baseline weight for an episode using a fallback chain so we
  // never silently render empty rows. Strategy in order of fidelity:
  //   1. Last actual weigh-in on/before episode start (preChangeBaseline)
  //   2. Shot record's stamped `weight` field on/just before the start
  //      (medication.js stamps the at-shot weight as user-entered data)
  //   3. FIRST weigh-in DURING the episode (least ideal — absorbs the
  //      early water-weight whoosh — but better than rendering nothing)
  // Returns { weight, source } where source explains the provenance.
  function findBaseline(startDay, between, allShots, allReadings) {
    const w = TU.preChangeBaseline(startDay, allReadings);
    if (w != null) return { weight: w, source: 'pre-shot weigh-in' };

    // Walk shots backwards for the most recent stamped weight at or
    // before startDay
    const earlierShots = allShots
      .map(s => ({ ...s, _dt: new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.weight === 'number' && s._dt <= startDay)
      .sort((a, b) => a._dt - b._dt);
    if (earlierShots.length) {
      const m = earlierShots[earlierShots.length - 1];
      return { weight: m.weight, source: 'shot-stamped weight' };
    }

    // Last resort: first weigh-in during the episode
    if (between.length) {
      return { weight: between[0].weight, source: 'first reading on dose (est.)' };
    }

    return { weight: null, source: 'no data' };
  }

  // Per-episode stats. Pulls readings between the pre-change baseline
  // (last reading on or before startDate) and the end date (or now).
  // Returns enriched episode with weight + pace numbers.
  function enrichEpisode(ep, allReadings, allShots) {
    const startDay   = ep.startDate;
    const endDay     = ep.endDate || new Date();
    const dayAfter   = TU.addDays(startDay, 1);
    const between    = TU.readingsBetween(dayAfter, endDay, allReadings);
    const endReading = between.length ? between[between.length - 1] : null;
    const baseInfo   = findBaseline(startDay, between, allShots, allReadings);
    const baseline   = baseInfo.weight;

    const days       = (endDay.getTime() - startDay.getTime()) / 86_400_000;
    const weeks      = days / 7;
    const lostLbs    = (baseline != null && endReading)
      ? baseline - endReading.weight
      : null;
    const endpointPace = (lostLbs != null && weeks >= 1)
      ? lostLbs / weeks
      : null;
    const regressionPace = between.length >= 3
      ? TU.slopePerWeek(between)
      : null;

    return {
      ...ep,
      baseline,
      baselineSource: baseInfo.source,
      endReading,
      days, weeks,
      lostLbs,
      endpointPace,
      regressionPace,
      readingCount: between.length,
    };
  }

  // ── Render ─────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('dc-card-body');
    if (!root) return;

    const shots = loadShots();
    if (!shots.length) {
      root.innerHTML = `
        <p style="color:#6d7a95;font-size:0.85rem">
          No shots logged yet. Log a shot in the Medication tab to unlock this comparison.
        </p>`;
      return;
    }

    if (!window.allWeightData || !window.allWeightData.length) {
      root.innerHTML = `<p style="color:#6d7a95;font-size:0.85rem">Waiting for weight data…</p>`;
      return;
    }

    const episodes = buildEpisodes(shots).map(ep => enrichEpisode(ep, window.allWeightData, shots));

    if (episodes.length < 2) {
      const only = episodes[0];
      root.innerHTML = `
        <div style="background:#f5f7fb;border-left:3px solid #6d7a95;
                    padding:0.7rem 0.9rem;border-radius:0 8px 8px 0">
          <p style="font-size:0.82rem;color:#1a2340;line-height:1.5;margin:0">
            Only one dose logged so far (<strong>${only.dose}mg</strong>, started ${fmtDate(only.startDate)}).
            Once you've titrated up at least once, this card will compare each dose's
            performance side-by-side.
          </p>
        </div>`;
      return;
    }

    // Find best pace for color highlighting
    const validPaces = episodes
      .map(e => e.endpointPace)
      .filter(p => p != null && p > 0);
    const maxPace = validPaces.length ? Math.max(...validPaces) : 0;

    // Color-code pace cells: full color for best, fade for worse
    function paceColor(p) {
      if (p == null || p <= 0) return '#ea1100';
      if (p >= 2.0) return '#2a8703';
      if (p >= 1.25) return '#0053e2';
      if (p >= 0.5) return '#995213';
      return '#ea1100';
    }

    const rows = episodes.map((ep, i) => {
      const dur     = ep.weeks != null ? ep.weeks.toFixed(1) : '—';
      const lost    = ep.lostLbs != null
        ? (ep.lostLbs >= 0 ? '−' : '+') + Math.abs(ep.lostLbs).toFixed(1) + ' lbs'
        : '—';
      const endPace = ep.endpointPace != null ? ep.endpointPace.toFixed(2) + ' lbs/wk' : '—';
      const regPace = ep.regressionPace != null ? ep.regressionPace.toFixed(2) + ' lbs/wk' : '—';
      const rowBg   = ep.isCurrent ? '#dbeafe' : (i % 2 ? '#f8fafc' : 'transparent');
      const tag     = ep.isCurrent
        ? '<span style="font-size:0.55rem;background:#0053e2;color:#fff;padding:0.1rem 0.4rem;border-radius:99px;font-weight:800;margin-left:0.4rem;letter-spacing:0.06em">CURRENT</span>'
        : '';

      const dateRange = ep.endDate
        ? `${fmtShort(ep.startDate)} \u2192 ${fmtShort(ep.endDate)}`
        : `${fmtShort(ep.startDate)} \u2192 now`;

      // Mini bar visualizing endpoint pace vs the user's personal best
      const barPct = (ep.endpointPace != null && maxPace > 0)
        ? Math.max(2, Math.min(100, (ep.endpointPace / maxPace) * 100))
        : 0;
      const barHTML = ep.endpointPace != null
        ? `<div style="height:5px;background:#e5e9f5;border-radius:99px;margin-top:0.3rem;overflow:hidden">
             <div style="height:100%;width:${barPct}%;background:${paceColor(ep.endpointPace)};border-radius:99px"></div>
           </div>`
        : '';

      return `
        <tr style="background:${rowBg};border-bottom:1px solid #e5e9f5">
          <td style="padding:0.55rem 0.7rem;vertical-align:top">
            <p style="font-size:0.92rem;font-weight:800;color:#1a2340;margin:0">
              ${ep.dose}mg${tag}
            </p>
            <p style="font-size:0.6rem;color:#6d7a95;margin:0.15rem 0 0">
              ${dateRange}<br>
              ${ep.shotCount} shot${ep.shotCount !== 1 ? 's' : ''} \u00b7 ${ep.readingCount} reading${ep.readingCount !== 1 ? 's' : ''}
              ${ep.baselineSource && ep.baselineSource !== 'pre-shot weigh-in'
                ? `<br><span style="color:#995213;font-style:italic">baseline: ${ep.baselineSource}</span>`
                : ''}
            </p>
          </td>
          <td style="padding:0.55rem 0.7rem;font-size:0.85rem;font-weight:700;color:#1a2340;white-space:nowrap;vertical-align:top">
            ${dur} wks
          </td>
          <td style="padding:0.55rem 0.7rem;font-size:0.85rem;font-weight:700;color:${ep.lostLbs >= 0 ? '#2a8703' : '#ea1100'};white-space:nowrap;vertical-align:top">
            ${lost}
          </td>
          <td style="padding:0.55rem 0.7rem;vertical-align:top">
            <p style="font-size:0.85rem;font-weight:800;color:${paceColor(ep.endpointPace)};margin:0;white-space:nowrap">
              ${endPace}
            </p>
            ${barHTML}
          </td>
          <td style="padding:0.55rem 0.7rem;font-size:0.78rem;color:#6d7a95;white-space:nowrap;vertical-align:top">
            ${regPace}
          </td>
        </tr>`;
    }).join('');

    // Comparison insight: current vs prior dose
    let insightHTML = '';
    if (episodes.length >= 2) {
      const cur   = episodes[episodes.length - 1];
      const prev  = episodes[episodes.length - 2];
      if (cur.endpointPace != null && prev.endpointPace != null) {
        const delta = cur.endpointPace - prev.endpointPace;
        const pct   = prev.endpointPace > 0
          ? (delta / prev.endpointPace * 100).toFixed(0)
          : null;
        const direction = delta >= 0 ? 'faster' : 'slower';
        const color     = delta >= 0 ? '#2a8703' : '#ea1100';
        const pctStr    = pct != null ? ` (${delta >= 0 ? '+' : ''}${pct}%)` : '';

        insightHTML = `
          <div style="background:${color}0d;border-left:3px solid ${color};
                      padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.9rem">
            <p style="font-size:0.62rem;font-weight:800;text-transform:uppercase;
                      letter-spacing:0.08em;color:${color};margin:0 0 0.2rem">Comparison</p>
            <p style="font-size:0.85rem;color:#1a2340;line-height:1.5;margin:0">
              On <strong>${cur.dose}mg</strong> you're losing
              <strong style="color:${color}">${Math.abs(delta).toFixed(2)} lbs/wk ${direction}</strong>${pctStr}
              than you did on <strong>${prev.dose}mg</strong>
              (${cur.endpointPace.toFixed(2)} vs ${prev.endpointPace.toFixed(2)} lbs/wk).
            </p>
          </div>`;
      }
    }

    root.innerHTML = `
      ${insightHTML}
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead>
            <tr style="border-bottom:2px solid #e5e9f5">
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.6rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">Dose</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.6rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">Duration</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.6rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">Lost</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.6rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">Endpoint pace</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.6rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6d7a95">Regression</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:0.65rem;color:#9aa5b4;margin:0.9rem 0 0;line-height:1.5">
        <strong>Endpoint pace</strong> = pre-dose baseline minus end weight, divided by weeks
        \u2014 the headline number that matches the trajectory card.
        <strong>Regression</strong> = linear-regression slope through every reading on that dose
        \u2014 less swingy on noisy endpoints. When the two diverge, regression is usually more honest.
      </p>`;
  }

  window.renderDoseComparison = render;

  // ── Hook into projector tab switch (mirror trajectory pattern) ─────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__dcHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[dose-comparison]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__dcHooked = true;
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
