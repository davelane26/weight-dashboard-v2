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

  updateSnapshot();
  generateInsights();

  // Optional renderers from sibling feature scripts (heatmap.js etc).
  // Use feature-detection so we never crash if a script hasn't loaded.
  if (typeof renderHeatmap      === 'function') renderHeatmap(allData);
  if (typeof renderReportCard   === 'function') renderReportCard();
  if (typeof refreshHealthScore === 'function') refreshHealthScore();
  if (typeof renderChartsTab    === 'function' && localStorage.getItem('wt_v2_tab') === 'charts') renderChartsTab(allData);

  // Expose globally so medication.js can use weight readings for effectiveness calc
  window.allWeightData = allData;

  // Cache the parsed data so reloads have something to draw if the fetch fails
  try { localStorage.setItem('wt_v2_data', JSON.stringify(allData)); } catch {}
}

// ── Data loading ─────────────────────────────────────────────────────
async function loadData() {
  try {
    const resp = await fetch(DATA_URL + '?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const raw = await resp.json();
    if (!raw.length) throw new Error('empty');
    allData = raw
      .map(r => ({ ...r, date: parseDate(r.date) }))
      .filter(r => r.date && r.weight)
      .sort((a, b) => a.date - b.date);
    renderAll();
    return true;
  } catch (e) {
    console.warn('Fetch failed:', e.message);
    return false;
  }
}

// ── AI Weekly Summary loader ─────────────────────────────────────────
async function loadAISummary() {
  const textEl = document.getElementById('ai-summary-text');
  const dateEl = document.getElementById('ai-summary-date');
  if (!textEl) return;
  try {
    const resp = await fetch('./weekly-summary.json?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.summary) {
      textEl.textContent = data.summary;
      if (dateEl && data.week_ending) {
        const d = new Date(data.week_ending + 'T12:00:00');
        dateEl.textContent = 'Week of ' + d.toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric' });
      }
    } else {
      textEl.textContent = 'Your first AI summary will appear here after the workflow runs on Sunday. '
        + 'You can also trigger it manually from the GitHub Actions tab.';
      if (dateEl) dateEl.textContent = 'Not yet generated';
    }
  } catch(e) {
    if (textEl) textEl.textContent = 'Could not load AI summary (offline or not yet generated).';
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
          .map(r => ({ ...r, date: new Date(r.date) }))
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

// ── Manual trigger for the AI Summary workflow ────────────────────────
// We don't ship a Personal Access Token in client-side JS (the repo is
// public — that'd leak it instantly). Instead, pop the GitHub Actions
// page in a new tab where the user is already authenticated and can hit
// "Run workflow" with one click. After they trigger it, we poll
// weekly-summary.json every 20s for ~10 minutes so the new summary
// appears the moment the workflow commits.
const REPO_ACTIONS_URL =
  'https://github.com/davelane26/weight-dashboard-v2/actions/workflows/weekly-summary.yml';

function triggerWeeklySummary() {
  const btn   = document.getElementById('ai-summary-trigger');
  const dateEl = document.getElementById('ai-summary-date');

  // Open the Actions page in a new tab — single click of "Run workflow" there.
  window.open(REPO_ACTIONS_URL, '_blank', 'noopener');

  if (btn) {
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.textContent = '⏳ Waiting for new summary…';
  }
  if (dateEl) {
    const prev = dateEl.textContent;
    dateEl.textContent = 'Run "Weekly AI Health Summary" in the new tab — this page will auto-refresh.';
    dateEl.dataset.prev = prev;
  }

  // Poll the JSON for up to ~10 minutes. As soon as the week_ending
  // changes (or first appears) we know the workflow finished.
  const startedAt = Date.now();
  const POLL_MS   = 20_000;
  const MAX_MS    = 10 * 60_000;

  // Capture the current summary so we know when it changes.
  let baseline = null;
  fetch('./weekly-summary.json?t=' + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(j => { baseline = j ? j.week_ending + '|' + (j.summary || '').length : ''; })
    .catch(() => { baseline = ''; });

  const tick = async () => {
    if (Date.now() - startedAt > MAX_MS) return resetTriggerBtn('Timed out — refresh the page once the workflow finishes.');
    try {
      const resp = await fetch('./weekly-summary.json?t=' + Date.now(), { cache: 'no-store' });
      if (resp.ok) {
        const j   = await resp.json();
        const sig = (j.week_ending || '') + '|' + ((j.summary || '').length);
        if (baseline !== null && sig !== baseline && j.summary) {
          await loadAISummary();
          return resetTriggerBtn();
        }
      }
    } catch (e) { /* network blip — try again next tick */ }
    setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
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
