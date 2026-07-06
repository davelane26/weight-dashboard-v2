/* ════════════════════════════════════════════════════════════════════
   weight-qa.js — deterministic Q&A engine for the "Ask About Your
   Journey" card. Pattern-matches a fixed set of question shapes and
   computes the answer directly from `allData` — no external API calls.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const UNIT_DAYS = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };

  function latestRecord() {
    return allData.length ? allData[allData.length - 1] : null;
  }

  // Nearest reading at or before `daysAgo` days before the latest reading.
  function recordDaysAgo(daysAgo) {
    const latest = latestRecord();
    if (!latest) return null;
    const target = new Date(latest.date);
    target.setDate(target.getDate() - daysAgo);
    for (let i = allData.length - 1; i >= 0; i--) {
      if (allData[i].date <= target) return allData[i];
    }
    return null;
  }

  function extractPeriodDays(q) {
    let m = q.match(/(?:last|past|previous)\s+(\d+)\s*(day|days|week|weeks|month|months)/);
    if (m) return parseInt(m[1], 10) * UNIT_DAYS[m[2]];
    m = q.match(/(\d+)\s*(day|days|week|weeks|month|months)\s+ago/);
    if (m) return parseInt(m[1], 10) * UNIT_DAYS[m[2]];
    m = q.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
    if (m) return parseInt(m[1], 10) * UNIT_DAYS[m[2]];
    if (/\bthis week\b/.test(q))  return 7;
    if (/\bthis month\b/.test(q)) return 30;
    if (/\byesterday\b/.test(q))  return 1;
    return null;
  }

  function periodLabel(days) {
    if (days >= 30 && days % 30 === 0) { const n = days / 30; return `${n} month${n === 1 ? '' : 's'}`; }
    if (days >= 7  && days % 7  === 0) { const n = days / 7;  return `${n} week${n === 1 ? '' : 's'}`;  }
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  const fmt2   = n => (+n).toFixed(1);
  const fmtLbs = n => Math.abs(n).toFixed(1) + ' lb' + (Math.abs(n) === 1 ? '' : 's');

  // ── Individual answerers ────────────────────────────────────────────
  function answerRateOrLoss(days) {
    const latest = latestRecord();
    if (!latest) return null;

    if (days == null) {
      const startDate = new Date(START_DATE);
      const totalDays = (latest.date - startDate) / 86400000;
      const totalLost = START_WEIGHT - latest.weight;
      if (totalDays <= 0) return "You don't have enough history yet to compute a rate.";
      const perWeek = (totalLost / totalDays) * 7;
      return `Your overall average since you started is ${fmtLbs(perWeek)}/week `
           + `(${fmtLbs(totalLost)} total over ${Math.round(totalDays / 7)} weeks).`;
    }

    const start = recordDaysAgo(days);
    if (!start) return `You don't have data going back ${periodLabel(days)} yet.`;
    const change = start.weight - latest.weight; // positive = lost
    const elapsedDays = (latest.date - start.date) / 86400000;
    if (elapsedDays < 1) return `Not enough spread of readings in the last ${periodLabel(days)} to compute a rate.`;
    const perWeek = (change / elapsedDays) * 7;
    const verb = change > 0 ? 'lost' : change < 0 ? 'gained' : 'held steady over';
    return `Over the last ${periodLabel(days)} you've ${verb} ${fmtLbs(change)} `
         + `(${fmtLbs(perWeek)}/week average), from ${fmt2(start.weight)} lbs `
         + `on ${fmtDate(start.date)} to ${fmt2(latest.weight)} lbs now.`;
  }

  function answerTotalLost() {
    const latest = latestRecord();
    if (!latest) return null;
    const lost = START_WEIGHT - latest.weight;
    const pct  = (lost / START_WEIGHT) * 100;
    return `You've lost ${fmtLbs(lost)} total (${pct.toFixed(1)}% of your starting body weight), `
         + `from ${fmt2(START_WEIGHT)} lbs down to ${fmt2(latest.weight)} lbs.`;
  }

  function answerStartingWeight() {
    return `You started at ${fmt2(START_WEIGHT)} lbs on ${START_DATE}.`;
  }

  function answerStreak() {
    return `You're on a ${calcStreak(allData)}-day weigh-in streak.`;
  }

  function answerBest() {
    if (!allData.length) return null;
    const best = allData.reduce((b, r) => r.weight < b.weight ? r : b, allData[0]);
    return `Your lowest weight so far is ${fmt2(best.weight)} lbs, on ${fmtDate(best.date)}.`;
  }

  function answerDaysTracking() {
    const latest = latestRecord();
    if (!latest) return null;
    const days = Math.round((latest.date - new Date(START_DATE)) / 86400000);
    return `You've been tracking for ${days} days (since ${START_DATE}).`;
  }

  function answerGoal() {
    const latest = latestRecord();
    if (!latest) return null;
    if (!goalWeight) return "You haven't set a goal weight yet — set one on the Weight tab to get an ETA.";
    const remaining = latest.weight - goalWeight;
    if (remaining <= 0) return `You've already reached your goal of ${fmt2(goalWeight)} lbs!`;
    const slope = regressionSlopeLbsPerDay(allData, 28); // negative = losing
    if (slope == null || slope >= 0) {
      return `You have ${fmtLbs(remaining)} left to reach your goal of ${fmt2(goalWeight)} lbs, `
           + `but your recent trend isn't losing, so there's no ETA to project.`;
    }
    const daysLeft = remaining / -slope;
    const projDate = new Date(latest.date.getTime() + daysLeft * 86400000);
    return `You have ${fmtLbs(remaining)} left to reach ${fmt2(goalWeight)} lbs. `
         + `At your recent trend (~${fmtLbs(-slope * 7)}/week), that's about `
         + `${Math.round(daysLeft)} days away — around ${fmtDate(projDate)}.`;
  }

  function answerCurrentMetric(field, label, unit) {
    const latest = latestRecord();
    if (!latest || latest[field] == null) return `No ${label} reading on file yet.`;
    return `Your latest ${label} is ${fmt2(latest[field])}${unit}, as of ${fmtDate(latest.date)}.`;
  }

  function answerCurrentWeight() {
    const latest = latestRecord();
    if (!latest) return null;
    return `Your latest weight is ${fmt2(latest.weight)} lbs, as of ${fmtDate(latest.date)}.`;
  }

  const METRICS = [
    { keys: ['bmi'],                                          field: 'bmi',    label: 'BMI',        unit: '' },
    { keys: ['body fat', 'bodyfat', 'fat %', 'fat percent'],   field: 'bodyFat',label: 'body fat',   unit: '%' },
    { keys: ['muscle'],                                        field: 'muscle',label: 'muscle %',   unit: '%' },
    { keys: ['water'],                                         field: 'water', label: 'body water', unit: '%' },
    { keys: ['bone'],                                           field: 'bone',  label: 'bone mass',  unit: ' lbs' },
    { keys: ['bmr'],                                            field: 'bmr',   label: 'BMR',        unit: ' cal' },
    { keys: ['tdee'],                                           field: 'tdee',  label: 'TDEE',       unit: ' cal' },
  ];

  // ── Main entry point ─────────────────────────────────────────────────
  function answerQuestion(raw) {
    const q = String(raw || '').toLowerCase().trim();
    if (!q) return 'Type a question first — try one of the examples above.';
    if (!allData.length) return 'No weight data loaded yet — try again once your data has synced.';

    const days = extractPeriodDays(q);

    if (/\b(average|avg\.?|rate)\b/.test(q)) return answerRateOrLoss(days);
    if (days != null && /(lost|lose|losing|gain|gained|change|down|up)/.test(q)) return answerRateOrLoss(days);

    if (/(total|overall|since (i )?start(ed)?|so far)/.test(q) && /(lost|loss|lose)/.test(q)) return answerTotalLost();

    if (/(start(ing)? weight|when i started|weigh.*started)/.test(q)) return answerStartingWeight();

    if (/streak/.test(q)) return answerStreak();

    if (/(lowest|best|personal best|minimum) weight/.test(q)) return answerBest();

    if (/(how (long|many days)|days).*(tracking|journey|been (going|on this))/.test(q)) return answerDaysTracking();

    if (/(goal|target)/.test(q) && /(day|when|eta|left|remaining|how (much|many))/.test(q)) return answerGoal();

    for (const m of METRICS) {
      if (m.keys.some(k => q.includes(k))) return answerCurrentMetric(m.field, m.label, m.unit);
    }
    if (/\bweight\b/.test(q) && days == null) return answerCurrentWeight();

    return "I couldn't quite parse that — try one of the example questions above, "
         + 'or phrase it like "average weight loss last 2 weeks" or "how much have I lost total".';
  }

  window.answerWeightQuestion = answerQuestion; // exposed for console/debugging

  // ── UI wiring ─────────────────────────────────────────────────────
  function handleAsk() {
    const input = document.getElementById('qa-input');
    const out   = document.getElementById('qa-answer');
    if (!input || !out) return;
    if (!input.value.trim()) return;
    out.textContent = answerQuestion(input.value);
    out.classList.add('qa-answer--visible');
  }

  const form  = document.getElementById('qa-form');
  const chips = document.getElementById('qa-examples');
  if (form) form.addEventListener('submit', e => { e.preventDefault(); handleAsk(); });
  if (chips) chips.addEventListener('click', e => {
    const btn = e.target.closest('.qa-example');
    if (!btn) return;
    const input = document.getElementById('qa-input');
    if (input) { input.value = btn.textContent; handleAsk(); }
  });
})();
