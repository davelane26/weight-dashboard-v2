/* ════════════════════════════════════════════════════════════════════
   weight-qa.js — deterministic Q&A engine for the "Ask About Your
   Journey" card. Pattern-matches a fixed set of question shapes and
   computes the answer directly from `allData` — no external API calls.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const UNIT_DAYS = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };
  const WEEKDAYS  = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const NUMBER_WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  // "two weeks ago" / "a month ago" → "2 weeks ago" / "1 month ago" so the
  // existing digit-based period regexes below can match them.
  function normalizeNumberWords(q) {
    return q.replace(
      /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s*(?:days?|weeks?|months?)\b)/g,
      w => String(NUMBER_WORDS[w])
    );
  }
  const FALLBACK_MESSAGE = "I couldn't quite parse that — try one of the example questions above, "
    + 'or phrase it like "average weight loss last 2 weeks" or "how much have I lost total".';

  function latestRecord() {
    return allData.length ? allData[allData.length - 1] : null;
  }

  // Nearest reading at or before `daysAgo` days before the latest reading.
  // A negative daysAgo means the resolved calendar date is more recent than
  // our latest sync — there's no data for it yet, so return null rather than
  // let the loop below fall through to (incorrectly) matching the latest row.
  function recordDaysAgo(daysAgo) {
    const latest = latestRecord();
    if (!latest || daysAgo < 0) return null;
    const target = new Date(latest.date);
    target.setDate(target.getDate() - daysAgo);
    for (let i = allData.length - 1; i >= 0; i--) {
      if (allData[i].date <= target) return allData[i];
    }
    return null;
  }

  function daysBefore(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() - n);
    return d;
  }

  // Converts an absolute calendar date into "days before the latest
  // reading" so the rest of the pipeline (recordDaysAgo etc.) can stay in
  // that unit. Anchoring resolution on the real current date — not the
  // latest synced reading — matters whenever the scale hasn't synced today:
  // "last Thursday" must mean the actual most recent Thursday relative to
  // now, not relative to however stale the last weigh-in happens to be.
  function daysAgoForCalendarDate(targetDate) {
    const latest = latestRecord();
    if (!latest) return null;
    return Math.round((latest.date - targetDate) / 86400000);
  }

  const MONTH_NAMES = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
    dec: 11, december: 11,
  };

  // Builds a midnight-normalized Date from a month/day, inferring the year
  // (this year, unless that lands in the future — then last year) when none
  // is given.
  function buildDate(month, day, year, today) {
    if (month == null || isNaN(month) || month < 0 || month > 11) return null;
    if (day == null || isNaN(day) || day < 1 || day > 31) return null;
    if (year == null) {
      year = today.getFullYear();
      if (new Date(year, month, day) > today) year -= 1;
    } else if (year < 100) {
      year += 2000;
    }
    const d = new Date(year, month, day);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // Explicit calendar dates — "7/4", "7/4/2026", "July 4", "Jul 4th, 2026" —
  // as opposed to the relative phrases (weekday names, "N days ago") below.
  function extractExplicitDate(q, today) {
    let m = q.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (m) {
      return buildDate(parseInt(m[1], 10) - 1, parseInt(m[2], 10),
        m[3] ? parseInt(m[3], 10) : null, today);
    }
    m = q.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
    if (m) {
      return buildDate(MONTH_NAMES[m[1]], parseInt(m[2], 10),
        m[3] ? parseInt(m[3], 10) : null, today);
    }
    return null;
  }

  function extractPeriodDays(q) {
    q = normalizeNumberWords(q);
    // Normalize to midnight so day-difference math is based on calendar
    // dates, not the current wall-clock time — otherwise "yesterday" asked
    // at 11pm can round to the wrong day relative to an 8am scale reading.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let targetDate = extractExplicitDate(q, today);
    let m;

    if (!targetDate) {
      m = q.match(/(?:last|past|previous)\s+(\d+)\s*(day|days|week|weeks|month|months)/);
      if (m) targetDate = daysBefore(today, parseInt(m[1], 10) * UNIT_DAYS[m[2]]);
    }

    if (!targetDate) {
      m = q.match(/\b(?:last|past|previous)\s+(day|week|month)\b/);
      if (m) targetDate = daysBefore(today, UNIT_DAYS[m[1]]);
    }

    if (!targetDate) {
      m = q.match(/\b(?:since\s+)?(?:last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (m) {
        const targetDow = WEEKDAYS.indexOf(m[1]);
        let offset = (today.getDay() - targetDow + 7) % 7;
        if (offset === 0) offset = 7; // "last Thursday" when today IS Thursday means a week ago
        targetDate = daysBefore(today, offset);
      }
    }

    if (!targetDate) {
      m = q.match(/(\d+)\s*(day|days|week|weeks|month|months)\s+ago/);
      if (m) targetDate = daysBefore(today, parseInt(m[1], 10) * UNIT_DAYS[m[2]]);
    }

    if (!targetDate) {
      m = q.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
      if (m) targetDate = daysBefore(today, parseInt(m[1], 10) * UNIT_DAYS[m[2]]);
    }

    if (!targetDate && /\bthis week\b/.test(q))  targetDate = daysBefore(today, 7);
    if (!targetDate && /\bthis month\b/.test(q)) targetDate = daysBefore(today, 30);
    if (!targetDate && /\byesterday\b/.test(q))  targetDate = daysBefore(today, 1);

    if (!targetDate) return null;
    return daysAgoForCalendarDate(targetDate);
  }

  // A weight mentioned as a hypothetical target — "at 220lbs", "hit 220",
  // "reach 220 lbs" — as opposed to the user's saved goalWeight.
  function extractTargetWeight(q) {
    const m = q.match(/(?:\bat\s+|\bto\s+|\bhits?\s+|\breach(?:ing|es)?\s+|\bget(?:s|ting)?\s+to\s+|\bweigh(?:s|ing)?\s+)(\d{2,3}(?:\.\d+)?)\s*(?:lbs?|pounds?)?\b/);
    return m ? parseFloat(m[1]) : null;
  }

  function periodLabel(days) {
    if (days >= 30 && days % 30 === 0) { const n = days / 30; return n === 1 ? 'month' : `${n} months`; }
    if (days >= 7  && days % 7  === 0) { const n = days / 7;  return n === 1 ? 'week'  : `${n} weeks`;  }
    return days === 1 ? 'day' : `${days} days`;
  }

  const fmt2   = n => (+n).toFixed(1);
  const fmtLbs = n => Math.abs(n).toFixed(1) + ' lb' + (Math.abs(n) === 1 ? '' : 's');

  function agoPhrase(days) {
    const label = periodLabel(days);
    if (label === 'day') return 'yesterday';
    if (label === 'week' || label === 'month') return `a ${label} ago`;
    return `${label} ago`;
  }

  // Real calendar days between a record's date and today — used for display
  // phrasing so "N days ago" always matches the shown date, regardless of
  // how many days it's been since the record nearest that internal lookup
  // offset (which is measured from the latest *sync*, not from today).
  function realDaysAgo(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return Math.round((today - d) / 86400000);
  }

  // ── Individual answerers ────────────────────────────────────────────
  // Direct historical value lookup — "what was my weight last Thursday" —
  // as opposed to answerRateOrLoss, which answers the *change* over a period.
  function answerHistoricalWeight(days) {
    if (days === 0) return answerCurrentWeight();
    if (days < 0) return staleSyncMessage();
    const record = recordDaysAgo(days);
    if (!record) return `You don't have data going back ${periodLabel(days)} yet.`;
    return `Your weight ${agoPhrase(realDaysAgo(record.date))} was ${fmt2(record.weight)} lbs, recorded on ${fmtDate(record.date)}.`;
  }

  // The resolved date is more recent than the latest sync — e.g. the scale
  // hasn't synced today and the question asks about a date after that gap.
  function staleSyncMessage() {
    const latest = latestRecord();
    return latest
      ? `Your last synced weigh-in is from ${fmtDate(latest.date)} — nothing recorded that recently yet.`
      : null;
  }

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

    if (days < 0) return staleSyncMessage();
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

  // Which weekday tends to run lightest/heaviest — measured as deviation from
  // a 7-day rolling trend, not a raw per-weekday average, so a weekday isn't
  // flagged just because it happened to fall in a lighter/heavier month.
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  const ORDINAL_WORDS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  };
  // "2nd to the lowest", "third highest", etc. — defaults to 1 (the actual
  // extreme) when no ordinal is mentioned.
  function extractRank(q) {
    const m = q.match(/\b(\d+)(?:st|nd|rd|th)\b/);
    if (m) return parseInt(m[1], 10);
    for (const word of Object.keys(ORDINAL_WORDS)) {
      if (new RegExp('\\b' + word + '\\b').test(q)) return ORDINAL_WORDS[word];
    }
    return 1;
  }

  function answerDayOfWeekPattern(wantLowest, rank) {
    const dedupMap = {};
    allData.forEach(r => { dedupMap[r.date.toDateString()] = r; });
    const daily = Object.values(dedupMap).sort((a, b) => a.date - b.date);
    if (daily.length < 14) {
      return "Not enough data yet to spot a day-of-week pattern — need at least a couple weeks of daily readings.";
    }
    const smoothed = movingAvg(daily.map(r => r.weight), 7);
    const sums = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    daily.forEach((r, i) => {
      if (smoothed[i] == null) return;
      sums[r.date.getDay()] += r.weight - smoothed[i]; // deviation from trend
      counts[r.date.getDay()]++;
    });
    const ranked = [];
    for (let i = 0; i < 7; i++) {
      if (counts[i] < 2) continue;
      ranked.push({ day: i, avgDev: sums[i] / counts[i], count: counts[i] });
    }
    if (!ranked.length) return "Not enough spread across weekdays yet to spot a pattern.";
    ranked.sort((a, b) => wantLowest ? a.avgDev - b.avgDev : b.avgDev - a.avgDev);

    const clampedRank = Math.min(Math.max(rank, 1), ranked.length);
    const picked = ranked[clampedRank - 1];
    const verb = wantLowest ? 'lowest' : 'highest';
    const label = clampedRank === 1 ? verb : `${ordinalSuffix(clampedRank)}-${verb}`;
    const sign = picked.avgDev >= 0 ? '+' : '−';
    const note = rank > ranked.length
      ? ` (only ${ranked.length} weekdays have enough data — showing the ${label} of those)`
      : '';
    return `Relative to your trend line, ${DOW_NAMES[picked.day]} is your ${label}-weight day of the week${note} `
         + `(averaging ${sign}${Math.abs(picked.avgDev).toFixed(2)} lbs vs. trend, across ${picked.count} ${DOW_NAMES[picked.day]} readings).`;
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

  // Hypothetical: "what % of my body weight will I have lost at 220 lbs" —
  // uses START_WEIGHT, not the user's saved goalWeight, since the target
  // here comes straight from the question text.
  function answerAtTargetWeight(target) {
    const change = START_WEIGHT - target; // positive = loss
    if (change < 0) {
      return `${fmt2(target)} lbs is above your starting weight of ${fmt2(START_WEIGHT)} lbs, `
           + `so that would be a gain, not a loss.`;
    }
    const pct = (change / START_WEIGHT) * 100;
    return `At ${fmt2(target)} lbs you'll have lost ${fmtLbs(change)} total — `
         + `${pct.toFixed(1)}% of your starting body weight of ${fmt2(START_WEIGHT)} lbs.`;
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

    if (days != null && /\b(what(?:'s| was| is| did)|weigh(?:ed)?)\b/.test(q)) return answerHistoricalWeight(days);

    if (/(total|overall|since (i )?start(ed)?|so far)/.test(q) && /(lost|loss|lose)/.test(q)) return answerTotalLost();

    if (/(start(ing)? weight|when i started|weigh.*started)/.test(q)) return answerStartingWeight();

    if (/streak/.test(q)) return answerStreak();

    if (/(lowest|best|personal best|minimum) weight/.test(q)) return answerBest();

    if (/\bweekday\b|(\bday\b.*\bweek\b|\bweek\b.*\bday\b)/.test(q)
        && /(lowest|lightest|smallest|highest|heaviest|biggest)/.test(q)) {
      return answerDayOfWeekPattern(/(lowest|lightest|smallest)/.test(q), extractRank(q));
    }

    if (/(how (long|many days)|days).*(tracking|journey|been (going|on this))/.test(q)) return answerDaysTracking();

    if (/(goal|target)/.test(q) && /(day|when|eta|left|remaining|how (much|many))/.test(q)) return answerGoal();

    const targetWeight = extractTargetWeight(q);
    if (targetWeight != null && /(lost|lose|losing|percent|percentage|%)/.test(q)) {
      return answerAtTargetWeight(targetWeight);
    }

    for (const m of METRICS) {
      if (m.keys.some(k => q.includes(k))) return answerCurrentMetric(m.field, m.label, m.unit);
    }
    // Only treat this as a direct "what's my weight" lookup for genuinely
    // short/plain phrasings or ones anchored with a "current/now" word —
    // NOT any sentence that merely mentions "weight" in passing (e.g. "am I
    // on track to hit my weight goal this year"), which should fall through
    // to the AI fallback instead of being misanswered as a bare lookup.
    const isBareWeightLookup = /^(what(?:'s| is) )?(my )?(current |latest )?weight\??$/.test(q);
    const hasTimeAnchoredWeight = /\b(current|latest|now|today)\b/.test(q) && /\bweight\b/.test(q);
    if (days == null && (isBareWeightLookup || hasTimeAnchoredWeight)) return answerCurrentWeight();

    return FALLBACK_MESSAGE;
  }

  window.answerWeightQuestion = answerQuestion; // exposed for console/debugging

  // ── AI fallback ───────────────────────────────────────────────────
  // Only called when the deterministic parser above can't match the
  // question. Sends a compact digest of the current data (not the full
  // history) to the Worker, which forwards it to Claude — no local
  // computation, so this covers open-ended/compound/correlational
  // questions the pattern matcher was never going to handle.
  function buildDigest() {
    const latest = latestRecord();
    if (!latest) return '';
    const lines = [];
    lines.push(
      `Latest reading (${fmtDate(latest.date)}): weight ${fmt2(latest.weight)} lbs` +
      (latest.bmi     != null ? `, BMI ${fmt2(latest.bmi)}`             : '') +
      (latest.bodyFat != null ? `, body fat ${fmt2(latest.bodyFat)}%`   : '') +
      (latest.muscle  != null ? `, muscle ${fmt2(latest.muscle)}%`      : '') +
      (latest.water   != null ? `, body water ${fmt2(latest.water)}%`   : '') +
      (latest.bone    != null ? `, bone mass ${fmt2(latest.bone)} lbs`  : '') +
      (latest.bmr     != null ? `, BMR ${fmt2(latest.bmr)} cal`         : '') +
      (latest.tdee    != null ? `, TDEE ${fmt2(latest.tdee)} cal`       : '')
    );
    lines.push(`Starting weight: ${fmt2(START_WEIGHT)} lbs on ${START_DATE}`);
    const totalLost = START_WEIGHT - latest.weight;
    lines.push(`Total lost so far: ${fmtLbs(totalLost)} (${(totalLost / START_WEIGHT * 100).toFixed(1)}% of starting body weight)`);
    if (goalWeight) lines.push(`Goal weight: ${fmt2(goalWeight)} lbs`);
    const best = allData.reduce((b, r) => r.weight < b.weight ? r : b, allData[0]);
    lines.push(`Personal best (lowest) weight: ${fmt2(best.weight)} lbs on ${fmtDate(best.date)}`);
    lines.push(`Current weigh-in streak: ${calcStreak(allData)} days`);
    const slope = regressionSlopeLbsPerDay(allData, 28);
    if (slope != null) lines.push(`Recent trend (last 28 days): ${fmtLbs(slope * 7)}/week ${slope < 0 ? 'loss' : 'gain'}`);

    // Weekly average rollup so the model has broader trend context
    // without needing every raw daily reading.
    const byWeek = {};
    allData.forEach(r => {
      const weekStart = new Date(r.date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      (byWeek[key] = byWeek[key] || []).push(r.weight);
    });
    const weeks = Object.keys(byWeek).sort().slice(-16);
    if (weeks.length) {
      const weeklyLine = weeks
        .map(k => `${k}: ${(byWeek[k].reduce((a, b) => a + b, 0) / byWeek[k].length).toFixed(1)}`)
        .join('; ');
      lines.push(`Weekly average weight, last ${weeks.length} weeks (week-start date: avg lbs): ${weeklyLine}`);
    }

    return lines.join('\n');
  }

  // AI answers commonly use light markdown (**bold**). Escape everything
  // first so the source text can never smuggle in real HTML, then
  // re-introduce only the specific tags we build ourselves from matched
  // markdown syntax — an AI response can never inject arbitrary markup.
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderMarkdownLite(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  async function askAI(question) {
    const url = window.AI_ASK_WORKER_URL;
    if (!url) throw new Error('AI Q&A worker URL not configured.');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, digest: buildDigest() }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.answer;
  }

  // ── UI wiring ─────────────────────────────────────────────────────
  async function handleAsk() {
    const input = document.getElementById('qa-input');
    const out   = document.getElementById('qa-answer');
    const btn   = document.getElementById('qa-ask-btn');
    if (!input || !out) return;
    const question = input.value;
    if (!question.trim()) return;

    const deterministic = answerQuestion(question);
    out.textContent = deterministic;
    out.classList.add('qa-answer--visible');

    if (deterministic !== FALLBACK_MESSAGE) return;

    if (btn) btn.disabled = true;
    out.textContent = '🤖 Thinking…';
    try {
      out.innerHTML = renderMarkdownLite(await askAI(question));
    } catch (err) {
      out.textContent = deterministic; // couldn't reach AI — fall back to the parser's message
    } finally {
      if (btn) btn.disabled = false;
    }
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
