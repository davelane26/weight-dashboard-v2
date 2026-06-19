/* ═══════════════════════════════════════════════════════════════════
   titration-utils.js
   Pure helpers shared by every Projector-tab card that reasons about
   GLP-1 titration. Loaded BEFORE the cards that use it.

   Design rules:
     - No DOM access here. No rendering. No globals besides the
       single TitrationUtils export.
     - Functions accept readings as an argument (default:
       window.allWeightData) so they're testable in isolation.
     - This file is policy-free. Thresholds, scenarios, copy live
       in the cards that own that policy. We only do the math
       and data shaping.

   Public surface: window.TitrationUtils
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const MS_PER_DAY  = 86_400_000;
  const DOSE_LADDER = [2.5, 5, 7.5, 10, 12.5, 15];

  // ── Date helpers ───────────────────────────────────────────────────
  function addDays(date, days) {
    return new Date(date.getTime() + days * MS_PER_DAY);
  }

  function endOfDay(date) {
    return new Date(
      date.getFullYear(), date.getMonth(), date.getDate(),
      23, 59, 59, 999
    );
  }

  // ── Dose ladder helpers ────────────────────────────────────────────
  function nextDose(current) {
    const i = DOSE_LADDER.indexOf(current);
    if (i < 0 || i === DOSE_LADDER.length - 1) return null;
    return DOSE_LADDER[i + 1];
  }

  // First shot at the *current* dose (the up-titration moment).
  // shots: array of { date: ISO|Date, dose: number } sorted ascending
  // Returns Date or null.
  function currentDoseStart(shots) {
    if (!shots || !shots.length) return null;
    const norm = shots
      .map(s => ({ ...s, _dt: s._dt || new Date(s.date) }))
      .filter(s => !isNaN(s._dt) && typeof s.dose === 'number')
      .sort((a, b) => a._dt - b._dt);
    if (!norm.length) return null;
    const dose = norm[norm.length - 1].dose;
    for (let i = norm.length - 1; i >= 0; i--) {
      if (norm[i].dose !== dose) return norm[i + 1]._dt;
    }
    return norm[0]._dt;
  }

  // ── Reading filters ────────────────────────────────────────────────
  function _readings(arg) {
    return Array.isArray(arg) ? arg : (window.allWeightData || []);
  }

  function readingsSince(date, readings) {
    return _readings(readings)
      .filter(r => r.date && r.date.getTime() >= date.getTime())
      .sort((a, b) => a.date - b.date);
  }

  function readingsBetween(start, end, readings) {
    return _readings(readings)
      .filter(r => r.date && r.date >= start && r.date <= end)
      .sort((a, b) => a.date - b.date);
  }

  // Deduplicate — keep latest reading per calendar day
  function dedupeByDay(rows) {
    const map = {};
    rows.forEach(r => {
      const key = r.date.toDateString();
      if (!map[key] || r.date > map[key].date) map[key] = r;
    });
    return Object.values(map).sort((a, b) => a.date - b.date);
  }

  // ── Pre-change baseline ────────────────────────────────────────────
  // The last weigh-in on or before the END of doseStart day. This is
  // the apples-to-apples anchor for "loss on this dose" / "lost since
  // titration" — using the first POST-shot reading would absorb the
  // early water-weight whoosh and silently flatter the math.
  function preChangeBaseline(doseStart, readings) {
    const cutoff = endOfDay(doseStart);
    const candidates = _readings(readings)
      .filter(r => r.date && r.date <= cutoff)
      .sort((a, b) => a.date - b.date);
    return candidates.length
      ? candidates[candidates.length - 1].weight
      : null;
  }

  // ── Pace math ──────────────────────────────────────────────────────
  // Simple endpoint pace: lbs/week between baseline and a later reading.
  // Use when you want the headline "lost X over Y weeks" rate that
  // matches the visible stat tiles.
  function paceFromBaseline(baseline, baselineDate, latestReading) {
    if (baseline == null || !latestReading) return null;
    const days = (latestReading.date.getTime() - baselineDate.getTime()) / MS_PER_DAY;
    if (days < 7) return null;
    return (baseline - latestReading.weight) / (days / 7);
  }

  // Linear-regression slope in lbs per WEEK (positive = losing).
  // Use when you want the *current trajectory* through daily noise —
  // resistant to single-day spikes, but it answers a different
  // question than paceFromBaseline (trend slope vs lifetime average).
  function slopePerWeek(readings) {
    if (!readings || readings.length < 2) return null;
    const t0 = readings[0].date.getTime();
    const xs = readings.map(r => (r.date.getTime() - t0) / MS_PER_DAY);
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
    return -(num / den) * 7;  // negate so weight loss is positive
  }

  // ── Export ─────────────────────────────────────────────────────────
  window.TitrationUtils = {
    MS_PER_DAY,
    DOSE_LADDER,
    addDays,
    endOfDay,
    nextDose,
    currentDoseStart,
    readingsSince,
    readingsBetween,
    dedupeByDay,
    preChangeBaseline,
    paceFromBaseline,
    slopePerWeek,
  };
})();
