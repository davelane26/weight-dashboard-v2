/* ════════════════════════════════════════════════════════════════════
   app.js — boot module + master render orchestrator.
   Loaded LAST. Depends on: app-config, app-utils, app-tabs, app-kpis,
                            app-charts, app-goal, app-insights.

   The big monolith was split into focused sibling modules in Apr 2026.
   Classic <script> tags share one global lexical environment, so all
   top-level let/const/function bindings flow between files transparently.
   ──────────────────────────────────────────────────────────────────── */

// ── Master render: re-paints every section from current `allData` ────
function renderAll() {
  if (!allData.length) return;
  const latest = allData[allData.length - 1];
  const prev   = allData.length > 1 ? allData[allData.length - 2] : null;

  // Header meta
  setText('last-updated', `${fmtDate(latest.date)} · ${fmtTime(latest.date)}`);
  const todayStr   = new Date().toDateString();
  const todayCount = allData.filter(r => r.date.toDateString() === todayStr).length;
  setText('readings-count',
    todayCount > 0
      ? `${todayCount} reading${todayCount !== 1 ? 's' : ''} today · ${allData.length} total`
      : `no readings yet today · ${allData.length} total`
  );

  renderTrendHero(allData);
  renderMilestones(latest, allData);
  renderBMITimeline(allData, latest);
  renderKPIs(latest, prev);
  renderJourney(latest, allData);
  renderStreak(allData);
  renderCalories(latest);
  renderWeightChart(allData);
  renderWeeklyStats(allData);
  renderGoal(latest, allData);
  if (typeof renderBodyFatTargets === 'function') renderBodyFatTargets(latest);

  updateSnapshot();

  // Optional renderers from sibling feature scripts (heatmap.js etc).
  // Use feature-detection so we never crash if a script hasn't loaded.
  if (typeof renderHeatmap      === 'function') renderHeatmap(allData);
  if (typeof renderMultiWindowTrends === 'function') renderMultiWindowTrends(allData);
  if (typeof renderReportCard   === 'function') renderReportCard();
  if (typeof refreshHealthScore === 'function') refreshHealthScore();
  if (typeof renderRoadTo220    === 'function') renderRoadTo220();

  // Expose globally so medication.js can use weight readings for effectiveness calc
  window.allWeightData = allData;

  // Refresh AI summary dynamically from live scale readings
  if (typeof generateDynamicAISummary === 'function') {
    generateDynamicAISummary(false);
  }

  // Cache the parsed data so reloads have something to draw if the fetch fails
  try { localStorage.setItem('wt_v2_data', JSON.stringify(allData)); } catch {}
}

// ── Data loading ─────────────────────────────────────────────────────
let _lastDataKey = null;

// Fetch the weight array. Prefers the TOKEN-GATED worker endpoint
// (window.WEIGHT_WORKER_URL) using the signed-in user's Firebase ID
// token; falls back to the public DATA_URL only if the worker fetch
// fails (e.g. during migration before the public JSON is deleted).
// Once you delete the public JSON, the fallback simply stops working
// for anyone who isn't signed in as an allowed user — which is the goal.
async function fetchWeightRaw() {
  // DEV: on localhost, load the local snapshot so the dashboard renders
  // without the token-gated worker or a Firebase login. Inert in prod.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const resp = await fetch('./data.json?t=' + Date.now());
    if (resp.ok) return await resp.json();
    console.warn('[weight] local data.json not found, falling through');
  }

  const workerUrl = window.WEIGHT_WORKER_URL;
  if (workerUrl) {
    try {
      // Wait for Firebase to settle so we actually have a token on first load.
      if (window.authReadyPromise) { try { await window.authReadyPromise; } catch {} }
      const user = window.fbUser;
      if (user && typeof user.getIdToken === 'function') {
        const token = await user.getIdToken();
        const resp = await fetch(workerUrl + '?t=' + Date.now(), {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (resp.ok) return await resp.json();
        console.warn('[weight] worker fetch', resp.status, '— falling back to public URL');
      }
    } catch (e) {
      console.warn('[weight] worker fetch failed, falling back:', e.message);
    }
  }
  // Public fallback (remove once cutover is complete).
  const resp = await fetch(DATA_URL + '?t=' + Date.now());
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

async function loadData() {
  try {
    const raw = await fetchWeightRaw();
    if (!raw.length) throw new Error('empty');
    const parsed = raw
      .map(r => ({ ...r, date: parseDate(r.date), bmi: correctedBmi(r.weight) }))
      .filter(r => r.date && r.weight)
      .sort((a, b) => a.date - b.date);
    // Only re-render if the data actually changed (new reading or different latest weight)
    const latest  = parsed[parsed.length - 1];
    const dataKey = `${parsed.length}|${latest.date}|${latest.weight}`;
    if (dataKey === _lastDataKey) return true;
    _lastDataKey = dataKey;
    allData = parsed;
    renderAll();
    return true;
  } catch (e) {
    console.warn('Fetch failed:', e.message);
    return false;
  }
}

// ── AI Weekly Summary Engine (Dynamic + Live Scale Data) ─────────────
function computeAISummaryStats() {
  if (!allData || !allData.length) return null;
  const latest = allData[allData.length - 1];
  const latestWeight = Number(latest.weight);
  const startWeight = (typeof START_WEIGHT !== 'undefined') ? START_WEIGHT : 315.0;
  const totalLost = startWeight - latestWeight;
  const pctLost = ((totalLost / startWeight) * 100).toFixed(1);

  // 14-day window relative to latest reading date
  const cutoff14d = new Date(latest.date.getTime() - 14 * 86400000);
  const recent14d = allData.filter(r => r.date >= cutoff14d);
  let change14d = 0;
  let ratePerWeek = 0;
  if (recent14d.length > 1) {
    const firstInWindow = recent14d[0];
    const daysDiff = Math.max(1, (latest.date - firstInWindow.date) / 86400000);
    change14d = latestWeight - Number(firstInWindow.weight);
    ratePerWeek = (Number(firstInWindow.weight) - latestWeight) / (daysDiff / 7);
  } else if (allData.length > 1) {
    const prev = allData[allData.length - 2];
    change14d = latestWeight - Number(prev.weight);
    ratePerWeek = -change14d;
  }

  // Activity & Sleep from window.snapActivityDays
  const actDays = window.snapActivityDays || [];
  let avgSteps = null;
  let avgSleep = null;
  if (actDays.length) {
    const recentAct = actDays.slice(-7);
    const stepDays = recentAct.filter(d => typeof d.steps === 'number' && d.steps > 0);
    if (stepDays.length) {
      avgSteps = Math.round(stepDays.reduce((s, d) => s + d.steps, 0) / stepDays.length);
    }
    const sleepDays = recentAct.filter(d => typeof d.sleepHours === 'number' && d.sleepHours > 0);
    if (sleepDays.length) {
      avgSleep = Number((sleepDays.reduce((s, d) => s + d.sleepHours, 0) / sleepDays.length).toFixed(1));
    }
  }

  const dateStr = latest.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    latestWeight,
    startWeight,
    totalLost,
    pctLost,
    change14d,
    ratePerWeek,
    avgSteps,
    avgSleep,
    dateStr,
    latestDate: latest.date
  };
}

function generateLocalAISummaryText(stats) {
  const lostStr = `${stats.totalLost.toFixed(1)} lbs down from his starting weight (${stats.pctLost}% overall)`;
  let paceStr;
  if (stats.ratePerWeek >= 0.5) {
    paceStr = `Pacing is strong at ${stats.ratePerWeek.toFixed(1)} lbs/week over the last 14 days`;
  } else if (stats.ratePerWeek > 0) {
    paceStr = `Weight is progressing steadily at ${stats.ratePerWeek.toFixed(1)} lbs/week over the last 14 days`;
  } else if (Math.abs(stats.change14d) <= 0.3) {
    paceStr = `Weight has held stable within ${Math.abs(stats.change14d).toFixed(1)} lbs over the last 14 days`;
  } else {
    paceStr = `Weight fluctuated ${stats.change14d > 0 ? '+' : ''}${stats.change14d.toFixed(1)} lbs over the last 14 days as part of normal fluid variance`;
  }

  let actStr = '';
  if (stats.avgSteps && stats.avgSleep) {
    actStr = ` Daily habits remain consistent with an average of ${stats.avgSteps.toLocaleString()} steps and ${stats.avgSleep} hours of sleep nightly.`;
  } else if (stats.avgSteps) {
    actStr = ` Activity averaged ${stats.avgSteps.toLocaleString()} daily steps.`;
  } else if (stats.avgSleep) {
    actStr = ` Sleep averaged ${stats.avgSleep} hours nightly.`;
  }

  return `David is currently at ${stats.latestWeight.toFixed(1)} lbs, bringing his total progress to ${lostStr}. ${paceStr}.${actStr} Continue prioritizing lean protein intake, hydration, and steady recovery into the upcoming week.`;
}

function renderAISummaryToDOM(summaryText, label) {
  const textEl = document.getElementById('ai-summary-text');
  const dateEl = document.getElementById('ai-summary-date');
  if (textEl) textEl.textContent = summaryText;
  if (dateEl && label) dateEl.textContent = label;
}

async function generateDynamicAISummary(forceRefresh = false) {
  const stats = computeAISummaryStats();
  if (!stats) {
    return loadAISummary();
  }

  // Check cached summary from localStorage
  if (!forceRefresh) {
    try {
      const saved = localStorage.getItem('wt_live_ai_summary');
      if (saved) {
        const cached = JSON.parse(saved);
        const age = Date.now() - (cached.timestamp || 0);
        if (cached.summary && cached.latestWeight === stats.latestWeight && age < 12 * 3600 * 1000) {
          renderAISummaryToDOM(cached.summary, cached.updatedLabel || 'Live scale data');
          return;
        }
      }
    } catch {}
  }

  let summaryText = null;

  // Attempt to call AI Worker endpoint if configured
  if (window.AI_ASK_WORKER_URL) {
    try {
      const digest = [
        `Latest scale reading (${stats.dateStr}): ${stats.latestWeight.toFixed(1)} lbs`,
        `Starting weight: ${stats.startWeight.toFixed(1)} lbs (Total lost: ${stats.totalLost.toFixed(1)} lbs, ${stats.pctLost}% body weight)`,
        `14-day weight change: ${stats.change14d > 0 ? '+' : ''}${stats.change14d.toFixed(1)} lbs (Pace: ${stats.ratePerWeek.toFixed(1)} lbs/week)`,
        stats.avgSteps ? `7-day average steps: ${stats.avgSteps.toLocaleString()} steps/day` : null,
        stats.avgSleep ? `7-day average sleep: ${stats.avgSleep} hours/night` : null
      ].filter(Boolean).join('\n');

      const resp = await fetch(window.AI_ASK_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Write a 3-4 sentence weekly health progress summary for David using ONLY the provided numbers. Mention his current weight, total loss, recent 14-day pacing, and activity/sleep consistency. Keep it clinical, positive, and motivating, with one habit tip for next week.',
          digest
        })
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.answer && !json.error) {
          summaryText = json.answer.trim();
        }
      }
    } catch (err) {
      console.warn('[AI Summary] Worker call skipped/failed, using local generator:', err);
    }
  }

  // Resilient fallback with exact live metrics
  if (!summaryText) {
    summaryText = generateLocalAISummaryText(stats);
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const updatedLabel = `Updated today at ${timeStr} · Live scale data`;

  renderAISummaryToDOM(summaryText, updatedLabel);

  try {
    localStorage.setItem('wt_live_ai_summary', JSON.stringify({
      summary: summaryText,
      latestWeight: stats.latestWeight,
      updatedLabel,
      timestamp: Date.now()
    }));
  } catch {}
}
window.generateDynamicAISummary = generateDynamicAISummary;

// ── AI Weekly Summary initial loader ─────────────────────────────────
async function loadAISummary() {
  // 1. Instant paint from cached live summary if available
  try {
    const saved = localStorage.getItem('wt_live_ai_summary');
    if (saved) {
      const cached = JSON.parse(saved);
      if (cached.summary) {
        renderAISummaryToDOM(cached.summary, cached.updatedLabel || 'Live scale data');
      }
    }
  } catch {}

  // 2. If allData is already populated, run dynamic generator
  if (allData && allData.length > 0) {
    return generateDynamicAISummary(false);
  }

  // 3. Fall back to static weekly-summary.json until scale data arrives
  const textEl = document.getElementById('ai-summary-text');
  const dateEl = document.getElementById('ai-summary-date');
  if (!textEl) return;
  try {
    const resp = await fetch('./weekly-summary.json?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.summary && (!textEl.textContent || textEl.textContent === 'Loading…')) {
      textEl.textContent = data.summary;
      if (dateEl && data.week_ending) {
        const d = new Date(data.week_ending + 'T12:00:00');
        dateEl.textContent = 'Week of ' + d.toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric' });
      }
    }
  } catch(e) {
    if (textEl && (!textEl.textContent || textEl.textContent === 'Loading…')) {
      textEl.textContent = 'Could not load AI summary (offline or scale data pending).';
    }
  }
}

// ── Init ─────────────────────────────────────────────────────────────
async function init() {
  restoreTabOrder();
  initTabDrag();
  loadDark();
  loadActivityLevel();
  loadGoal();
  // Load data FIRST while the weight tab is still visible so Chart.js
  // can measure the canvas at its real size. Switch to the saved tab
  // only after the initial render is done.
  const ok = await loadData();
  restoreTab(); // ← charts already drawn at correct dimensions
  if (!ok) {
    // Fall back to cached localStorage data
    try {
      const saved = localStorage.getItem('wt_v2_data');
      if (saved) {
        allData = JSON.parse(saved)
          .map(r => ({ ...r, date: new Date(r.date), bmi: correctedBmi(r.weight) }))
          .filter(r => r.weight);
        renderAll();
        restoreTab();
        el('status-bar').textContent = '⚠ Showing cached data — live fetch failed';
        el('status-bar').style.display = 'block';
      }
    } catch {}
  }
}

init();
setInterval(loadData, REFRESH_MS);
loadAISummary();

// ── Manual trigger for the AI Summary ─────────────────────────────────
async function triggerWeeklySummary() {
  const btn    = document.getElementById('ai-summary-trigger');
  const dateEl = document.getElementById('ai-summary-date');

  if (btn) {
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.textContent = '⏳ Generating…';
  }
  if (dateEl) {
    dateEl.textContent = 'Generating fresh AI summary from your live scale data…';
  }

  try {
    await generateDynamicAISummary(true);
  } catch (err) {
    console.error('Failed to generate dynamic AI summary:', err);
    resetTriggerBtn('Generation encountered an issue — please try again.');
    return;
  }

  resetTriggerBtn();
}
window.triggerWeeklySummary = triggerWeeklySummary;

function resetTriggerBtn(msg) {
  const btn = document.getElementById('ai-summary-trigger');
  if (btn) {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.textContent = '⚡ Generate Now';
  }
  if (msg) {
    const dateEl = document.getElementById('ai-summary-date');
    if (dateEl) dateEl.textContent = msg;
  }
}
