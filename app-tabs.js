/* ════════════════════════════════════════════════════════════════════
   app-tabs.js — tab switching, drag-to-reorder, dark mode, activity level
   ──────────────────────────────────────────────────────────────────── */

// ── Activity level persistence ───────────────────────────────────────
function loadActivityLevel() {
  const saved = localStorage.getItem('wt_v2_activity');
  if (saved && ACTIVITY_LEVELS[saved]) activityLevel = saved;
  syncActivityUI();
}
function setActivityLevel(level) {
  if (!ACTIVITY_LEVELS[level]) return;
  activityLevel = level;
  localStorage.setItem('wt_v2_activity', level);
  syncActivityUI();
  if (allData.length) renderAll();
}
function syncActivityUI() {
  const info = ACTIVITY_LEVELS[activityLevel];
  document.querySelectorAll('.activity-pill').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.level === activityLevel)
  );
  setText('activity-desc', info ? `${info.label} x${info.multiplier} - ${info.desc}` : '');
}
window.setActivityLevel = setActivityLevel;

// ── Tab switching ────────────────────────────────────────────────────
function switchTab(name) {
  TABS.forEach(t => {
    const panel = el('tab-' + t);
    const btn   = el('tab-btn-' + t);
    if (panel) panel.hidden = (t !== name);
    if (btn) {
      btn.classList.toggle('active', t === name);
      btn.setAttribute('aria-selected', t === name);
    }
  });
  localStorage.setItem('wt_v2_tab', name);
  // When switching to the weight tab, fully re-render the charts.
  // resize() alone isn't enough — if renderAll() fired while the tab
  // was hidden (e.g. the 30s interval refresh), Chart.js created new
  // instances into 0px canvases. A fresh render into the now-visible
  // panel is the only reliable fix.
  if (name === 'weight') {
    setTimeout(() => {
      if (allData.length) {
        renderWeightChart(allData);
        if (typeof renderHeatmap === 'function') renderHeatmap(allData);
      }
    }, 0);
  }
  if (name === 'glucose') {
    setTimeout(() => {
      if (window.glucoseChartInstance) window.glucoseChartInstance.resize();
    }, 50);
  }
  if (name === 'activity') {
    setTimeout(() => {
      ['actStepsChartInst','actSleepChartInst','actHRChartInst'].forEach(k => {
        if (window[k]) window[k].resize();
      });
    }, 50);
  }
  if (name === 'medication') {
    setTimeout(() => {
      if (window.medChartInst)   window.medChartInst.resize();
      if (window.medEffChart)    window.medEffChart.resize();
      else if (typeof initMedication === 'function') initMedication();
    }, 50);
  }
  document.querySelectorAll('.mob-tab').forEach(b => {
    const isActive = b.dataset.tab === name;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}
function restoreTab() {
  const saved = localStorage.getItem('wt_v2_tab');
  if (saved && TABS.includes(saved)) switchTab(saved);
}

// ── Tab drag-to-reorder ──────────────────────────────────────────────
function saveTabOrder() {
  const nav = document.querySelector('.tab-nav');
  if (!nav) return;
  const order = [...nav.querySelectorAll('[id^="tab-btn-"]')]
    .map(b => b.id.replace('tab-btn-', ''));
  localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order));
}

function restoreTabOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || 'null');
    if (!Array.isArray(saved) || !saved.length) return;
    const nav = document.querySelector('.tab-nav');
    if (!nav) return;
    // appendChild moves existing nodes — cheap reorder with no cloning
    saved.forEach(name => {
      const btn = document.getElementById('tab-btn-' + name);
      if (btn) nav.appendChild(btn);
    });
  } catch(e) { /* bad stored data, ignore */ }
}

function initTabDrag() {
  const nav = document.querySelector('.tab-nav');
  if (!nav) return;
  let dragSrc = null;

  nav.addEventListener('dragstart', e => {
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (!btn) return;
    dragSrc = btn;
    btn.classList.add('tab-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', btn.id);
  });

  nav.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (!btn || btn === dragSrc) return;
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    const mid = btn.getBoundingClientRect().left + btn.getBoundingClientRect().width / 2;
    btn.classList.add(e.clientX < mid ? 'tab-drag-over-left' : 'tab-drag-over-right');
  });

  nav.addEventListener('dragleave', e => {
    const btn = e.target.closest('[id^="tab-btn-"]');
    if (btn) btn.classList.remove('tab-drag-over-left', 'tab-drag-over-right');
  });

  nav.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('[id^="tab-btn-"]');
    if (!target || target === dragSrc) return;
    const mid = target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
    nav.insertBefore(dragSrc, e.clientX < mid ? target : target.nextSibling);
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    saveTabOrder();
  });

  nav.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('tab-dragging');
    nav.querySelectorAll('.tab-drag-over-left,.tab-drag-over-right')
       .forEach(b => b.classList.remove('tab-drag-over-left', 'tab-drag-over-right'));
    dragSrc = null;
  });
}

// ── Dark mode ────────────────────────────────────────────────────────
function loadDark() {
  const dark = localStorage.getItem('wt_v2_dark') === '1';
  document.getElementById('root').classList.toggle('dark', dark);
  const btn = el('dark-btn');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}
function toggleDark() {
  const root = document.getElementById('root');
  const isDark = root.classList.toggle('dark');
  localStorage.setItem('wt_v2_dark', isDark ? '1' : '0');
  const btn = el('dark-btn');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
  // Bug 1 fix: theme change must never disturb active tab state
  const currentTab = localStorage.getItem('wt_v2_tab') || 'weight';
  if (TABS.includes(currentTab)) switchTab(currentTab);
}
