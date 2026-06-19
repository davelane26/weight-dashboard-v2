/* ═══════════════════════════════════════════════════════════════════
   goal-projector.js
   Personal Milestone Forecast card for the Projector tab.

   What it answers: "At MY actual current pace, when do I hit each
   meaningful weight?" This is different from titration-trajectory
   (which projects 3 fixed scenarios: 0.75 / 1.75 / 2.5 lbs/wk) and
   different from road-to-220 (which uses the lifetime average slope).
   This card uses the BEST pace estimate we have, in this order:
     1. Clean 28-day slope (events excluded) — most honest "right now"
     2. Raw 28-day slope                       — recent trajectory
     3. Lifetime projSlopeLbsPerDay            — fallback when sparse

   Each milestone gets three ETAs: at current pace, ±25% (a crude but
   honest confidence band based on real-world weight-loss variance).
   Goal weight gets highlighted.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const TU = window.TitrationUtils;
  if (!TU) {
    console.warn('[goal-projector] TitrationUtils missing — card disabled');
    return;
  }

  // Pull the same window + clean-tail constants the readiness card
  // uses so the two cards never disagree on what "clean" means.
  const PACE_WINDOW_DAYS    = 28;
  const CLEAN_TAIL_DAYS     = 3;
  const CLEAN_MIN_READINGS  = 10;
  const CONFIDENCE_PCT      = 0.25;  // ±25% band

  // ── Helpers ────────────────────────────────────────────────
  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysFromNow(d) {
    return Math.round((d.getTime() - Date.now()) / 86_400_000);
  }

  // Pick the best available pace estimate. Returns
  // { lbsPerWeek, source, note } where source ∈ 'clean'|'raw'|'lifetime'.
  function bestPace() {
    const cutoff = new Date(Date.now() - PACE_WINDOW_DAYS * TU.MS_PER_DAY);
    const window28 = TU.readingsSince(cutoff);

    // Clean trend (preferred)
    const events = (typeof window.getEventsInRange === 'function')
      ? window.getEventsInRange(cutoff, new Date())
      : [];
    const clean = TU.slopePerWeekClean(window28, events, {
      tailDays: CLEAN_TAIL_DAYS,
      minClean: CLEAN_MIN_READINGS,
    });
    if (clean.slope != null && clean.slope > 0) {
      return {
        lbsPerWeek: clean.slope,
        source:     'clean',
        note:       `clean 28-day slope (${clean.cleanCount} of ${clean.totalCount} on-protocol readings)`,
      };
    }

    // Raw trend (fallback 1)
    const raw = TU.slopePerWeek(window28);
    if (raw != null && raw > 0) {
      return {
        lbsPerWeek: raw,
        source:     'raw',
        note:       `raw 28-day slope (${window28.length} readings; not enough clean data for clean trend)`,
      };
    }

    // Lifetime (fallback 2)
    if (typeof projSlopeLbsPerDay === 'number' && projSlopeLbsPerDay < 0) {
      return {
        lbsPerWeek: -projSlopeLbsPerDay * 7,
        source:     'lifetime',
        note:       'lifetime average (28-day trend unavailable — keep logging)',
      };
    }

    return null;
  }

  // Build milestone list: descending by 5 from rounded-down current
  // weight down to the user's goal (or 220 fallback). Always include
  // the goal weight even if it's not a multiple of 5.
  function buildMilestones(currentW, goalW) {
    const start = Math.floor(currentW / 5) * 5;
    const end   = Math.ceil(goalW / 5) * 5;
    const list  = [];
    for (let w = start; w >= end; w -= 5) {
      if (w >= currentW) continue;  // skip milestones we've already passed
      list.push(w);
    }
    if (!list.includes(goalW)) list.push(goalW);
    return list.sort((a, b) => b - a);  // descending: heavier first
  }

  // ── Render ─────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('gp-card-body');
    if (!root) return;

    if (!window.allWeightData || !window.allWeightData.length) {
      root.innerHTML = `<p style="color:#6d7a95;font-size:0.85rem">Waiting for weight data…</p>`;
      return;
    }

    const sorted   = window.allWeightData.slice().sort((a, b) => a.date - b.date);
    const latest   = sorted[sorted.length - 1];
    const currentW = latest.weight;
    const goalW    = (typeof goalWeight === 'number' && goalWeight > 0)
      ? goalWeight
      : 220;

    if (currentW <= goalW) {
      root.innerHTML = `
        <div style="text-align:center;padding:1.5rem 1rem">
          <p style="font-size:1.8rem;font-weight:800;color:#2a8703;margin:0 0 0.4rem">Goal hit</p>
          <p style="font-size:0.95rem;font-weight:700;color:#2a8703;margin:0 0 0.3rem">
            You're already at or below your goal of ${goalW} lbs.
          </p>
          <p style="font-size:0.78rem;color:#6d7a95;margin:0">
            Set a new target in the Weight tab to see fresh projections.
          </p>
        </div>`;
      return;
    }

    const pace = bestPace();
    if (!pace) {
      root.innerHTML = `
        <p style="color:#6d7a95;font-size:0.85rem">
          Not enough recent data to project. Log a few more weigh-ins (need at least
          2 in the last ${PACE_WINDOW_DAYS} days) and check back.
        </p>`;
      return;
    }

    const lowerPace = pace.lbsPerWeek * (1 - CONFIDENCE_PCT);
    const upperPace = pace.lbsPerWeek * (1 + CONFIDENCE_PCT);
    const milestones = buildMilestones(currentW, goalW);

    const sourceColor = {
      clean:    '#0053e2',
      raw:      '#995213',
      lifetime: '#6d7a95',
    }[pace.source];

    const sourceLabel = {
      clean:    'Clean 28-day trend',
      raw:      'Raw 28-day trend',
      lifetime: 'Lifetime average',
    }[pace.source];

    // Headline pace strip
    const headlineHTML = `
      <div style="background:${sourceColor}0d;border-left:3px solid ${sourceColor};
                  padding:0.7rem 0.9rem;border-radius:0 8px 8px 0;margin-bottom:0.9rem">
        <p style="font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                  color:${sourceColor};margin:0 0 0.2rem">${sourceLabel}</p>
        <p style="font-size:1.05rem;font-weight:800;color:#1a2340;margin:0">
          ${pace.lbsPerWeek.toFixed(2)} lbs/wk
          <span style="font-size:0.7rem;color:#9aa5b4;font-weight:600">
            · band ${lowerPace.toFixed(2)} – ${upperPace.toFixed(2)}
          </span>
        </p>
        <p style="font-size:0.7rem;color:#6d7a95;margin:0.25rem 0 0">
          Using ${pace.note}.
        </p>
      </div>`;

    // Milestone table
    const rows = milestones.map(m => {
      const lbsToGo  = currentW - m;
      const wks      = lbsToGo / pace.lbsPerWeek;
      const wksLow   = lbsToGo / upperPace;  // faster pace = sooner
      const wksHigh  = lbsToGo / lowerPace;  // slower pace = later
      const eta      = new Date(Date.now() + wks    * 7 * 86_400_000);
      const etaLow   = new Date(Date.now() + wksLow * 7 * 86_400_000);
      const etaHigh  = new Date(Date.now() + wksHigh * 7 * 86_400_000);
      const days     = daysFromNow(eta);
      const isGoal   = m === goalW;

      const rowBg   = isGoal ? '#fef3c7' : 'transparent';
      const goalTag = isGoal ? '<span style="font-size:0.55rem;background:#f59f00;color:#fff;padding:0.1rem 0.4rem;border-radius:99px;font-weight:800;margin-left:0.4rem;letter-spacing:0.06em">GOAL</span>' : '';

      return `
        <tr style="background:${rowBg};border-bottom:1px solid #e5e9f5">
          <td style="padding:0.5rem 0.7rem;font-size:0.85rem;font-weight:800;color:#1a2340;white-space:nowrap">
            ${m} lbs${goalTag}
            <span style="display:block;font-size:0.6rem;color:#6d7a95;font-weight:600;margin-top:0.1rem">
              ${lbsToGo.toFixed(1)} lbs to go
            </span>
          </td>
          <td style="padding:0.5rem 0.7rem;font-size:0.82rem;font-weight:700;color:${sourceColor};white-space:nowrap">
            ${fmtDate(eta)}
            <span style="display:block;font-size:0.6rem;color:#6d7a95;font-weight:600;margin-top:0.1rem">
              ${days >= 0 ? days + ' days' : 'past'} · ${wks.toFixed(1)} wks
            </span>
          </td>
          <td style="padding:0.5rem 0.7rem;font-size:0.72rem;color:#6d7a95;white-space:nowrap;line-height:1.45">
            <span style="color:#2a8703">earliest ${fmtDate(etaLow)}</span><br>
            <span style="color:#995213">latest&nbsp;&nbsp;&nbsp;${fmtDate(etaHigh)}</span>
          </td>
        </tr>`;
    }).join('');

    const tableHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead>
            <tr style="border-bottom:2px solid #e5e9f5">
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.62rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                         color:#6d7a95">Milestone</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.62rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                         color:#6d7a95">At current pace</th>
              <th style="text-align:left;padding:0.5rem 0.7rem;font-size:0.62rem;
                         font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                         color:#6d7a95">±25% confidence band</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    const footnoteHTML = `
      <p style="font-size:0.65rem;color:#9aa5b4;margin:0.9rem 0 0;line-height:1.5">
        The ±25% band reflects real-world weight-loss variance — water weight,
        plateaus, dose escalation, and life all wobble the actual trajectory.
        Treat the headline ETA as your "most likely" and the band as the
        realistic range. Update your goal in the Weight tab.
      </p>`;

    root.innerHTML = headlineHTML + tableHTML + footnoteHTML;
  }

  window.renderGoalProjector = render;

  // ── Hook into projector tab switch (mirror trajectory pattern) ─────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__gpHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        requestAnimationFrame(() => {
          try { render(); } catch (e) { console.warn('[goal-projector]', e); }
        });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__gpHooked = true;
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
