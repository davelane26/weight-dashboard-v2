/* ════════════════════════════════════════════════════════════════════
   calm-mode.js — Toggle to hide daily raw weight noise
   ────────────────────────────────────────────────────────────────────
   When ACTIVE:
     • The "Weight" KPI shows the 7-day rolling AVERAGE (not today's raw)
     • Day-over-day deltas on weight cards are hidden (removes the emotional whiplash)
     • Snapshot strip shows 7-day avg instead of last reading
     • Body gets `.calm-mode` class so CSS can dim/hide other noisy chips
     • "Latest Reading" heading becomes "Smoothed Trend"
   When INACTIVE: dashboard renders exactly as before.

   State persisted in localStorage['calm_mode']. Cross-device sync is
   intentionally NOT wired — Calm Mode is a personal comfort setting.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const STORAGE_KEY = 'calm_mode';
  const WINDOW_DAYS = 7;

  // ── State ────────────────────────────────────────────────────────
  function isOn() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }
  function setOn(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
  }

  // ── Compute rolling averages from window.allWeightData ───────────
  function rollingAvg(days) {
    const data = window.allWeightData;
    if (!Array.isArray(data) || !data.length) return null;
    // Data is already sorted ascending by app.js; be defensive anyway
    const sorted = data.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const latestDate = new Date(sorted[sorted.length - 1].date);
    const cutoff = new Date(latestDate.getTime() - days * 86400000);
    const window = sorted.filter(r => new Date(r.date) > cutoff && typeof r.weight === 'number');
    if (!window.length) return null;
    const sum = window.reduce((s, r) => s + r.weight, 0);
    return { avg: sum / window.length, n: window.length };
  }

  function weekOverWeek() {
    const data = window.allWeightData;
    if (!Array.isArray(data) || data.length < 2) return null;
    const sorted = data.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const latestDate = new Date(sorted[sorted.length - 1].date);
    const t0 = new Date(latestDate.getTime() - 7 * 86400000);
    const t1 = new Date(latestDate.getTime() - 14 * 86400000);
    const wk1 = sorted.filter(r => new Date(r.date) > t0);
    const wk2 = sorted.filter(r => new Date(r.date) > t1 && new Date(r.date) <= t0);
    if (!wk1.length || !wk2.length) return null;
    const a1 = wk1.reduce((s, r) => s + r.weight, 0) / wk1.length;
    const a2 = wk2.reduce((s, r) => s + r.weight, 0) / wk2.length;
    return { delta: a1 - a2, current: a1 };
  }

  // ── Apply / Unapply the visual override ──────────────────────────
  function apply() {
    if (!isOn()) { unapply(); return; }
    document.body.classList.add('calm-mode');

    const roll = rollingAvg(WINDOW_DAYS);
    const wow  = weekOverWeek();

    // KPI weight card → show 7-day avg
    const kpiWeight = document.getElementById('kpi-weight');
    const kpiSub    = document.getElementById('kpi-weight-sub');
    if (kpiWeight && roll) {
      kpiWeight.textContent = roll.avg.toFixed(1);
      kpiWeight.dataset.calmOverride = '1';
    }
    if (kpiSub) {
      if (wow) {
        const arrow = wow.delta < 0 ? '▼' : (wow.delta > 0 ? '▲' : '·');
        const cls   = wow.delta < 0 ? 'calm-good' : (wow.delta > 0 ? 'calm-warn' : '');
        kpiSub.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(wow.delta).toFixed(2)} lbs vs last wk</span>`;
      } else {
        kpiSub.textContent = '7-day rolling average';
      }
    }

    // Change the Weight card label + unit
    const kpiCard = kpiWeight ? kpiWeight.closest('.kpi') : null;
    if (kpiCard) {
      const label = kpiCard.querySelector('.kpi-label');
      const unit  = kpiCard.querySelector('.kpi-unit');
      if (label && !label.dataset.calmOriginal) {
        label.dataset.calmOriginal = label.textContent;
        label.textContent = ' Weight (7-day avg)';
      }
      if (unit && !unit.dataset.calmOriginal) {
        unit.dataset.calmOriginal = unit.textContent;
        unit.textContent = 'lbs — smoothed';
      }
    }

    // Snapshot strip → same treatment
    const snapWeight = document.getElementById('snap-weight');
    const snapDelta  = document.getElementById('snap-weight-delta');
    if (snapWeight && roll) {
      snapWeight.textContent = roll.avg.toFixed(1);
      snapWeight.dataset.calmOverride = '1';
    }
    if (snapDelta) snapDelta.textContent = 'avg of last ' + (roll ? roll.n : WINDOW_DAYS) + ' readings';

    // Change section heading
    document.querySelectorAll('.card-title').forEach(h => {
      if (h.textContent.trim() === 'Latest Reading' && !h.dataset.calmOriginal) {
        h.dataset.calmOriginal = h.textContent;
        h.textContent = 'Smoothed Trend (Calm Mode)';
      }
    });

    updateBadge();
  }

  function unapply() {
    document.body.classList.remove('calm-mode');

    // Restore original labels
    document.querySelectorAll('[data-calm-original]').forEach(el => {
      el.textContent = el.dataset.calmOriginal;
      delete el.dataset.calmOriginal;
    });
    // Note: we deliberately DON'T restore #kpi-weight / #snap-weight text —
    // the next renderKPIs() call will overwrite it with the real latest value.
    // If Calm was flipped OFF between renders, force a refresh:
    if (typeof window.renderKPIs === 'function' &&
        Array.isArray(window.allWeightData) &&
        window.allWeightData.length) {
      const sorted = window.allWeightData.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      const latest = sorted[sorted.length - 1];
      const prev   = sorted[sorted.length - 2];
      try { window.renderKPIs(latest, prev); } catch (e) { /* non-fatal */ }
    }
    updateBadge();
  }

  // ── Toggle button in the header ──────────────────────────────────
  function ensureButton() {
    if (document.getElementById('calm-mode-btn')) return;
    const header = document.querySelector('.header .header-inner');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = 'calm-mode-btn';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', isOn() ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Toggle Calm Mode');
    btn.title = 'Calm Mode — hide the noisy daily number, show the 7-day average instead';
    btn.style.cssText =
      'background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);' +
      'border-radius:8px;padding:0.35rem 0.7rem;font-size:0.75rem;font-weight:700;' +
      'cursor:pointer;white-space:nowrap;backdrop-filter:blur(4px)';
    btn.addEventListener('click', () => {
      setOn(!isOn());
      isOn() ? apply() : unapply();
    });

    // Insert BEFORE the dark-toggle if present, otherwise append
    const dark = document.getElementById('dark-btn');
    if (dark && dark.parentNode) {
      dark.parentNode.insertBefore(btn, dark);
    } else {
      header.appendChild(btn);
    }
    updateBadge();
  }

  function updateBadge() {
    const btn = document.getElementById('calm-mode-btn');
    if (!btn) return;
    const on = isOn();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = on ? ' <span>Calm: ON</span>' : ' <span>Calm Mode</span>';
    btn.style.background = on ? 'rgba(147,197,253,0.35)' : 'rgba(255,255,255,0.15)';
  }

  // ── Inject a small stylesheet ────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('calm-mode-styles')) return;
    const s = document.createElement('style');
    s.id = 'calm-mode-styles';
    s.textContent = `
      /* Calm Mode: dim daily-noise elements without hiding them entirely */
      body.calm-mode #kpi-fat-sub,
      body.calm-mode #kpi-fat-lbs-sub,
      body.calm-mode #kpi-muscle-sub,
      body.calm-mode #kpi-muscle-lbs-sub,
      body.calm-mode #kpi-water-sub,
      body.calm-mode #kpi-bmi-sub .badge + text { opacity: 0.35; }
      body.calm-mode .kpi--blue { position: relative; }
      body.calm-mode .kpi--blue::after {
        content: ""; position: absolute; top: 6px; right: 8px;
        font-size: 0.85rem; opacity: 0.55;
      }
      .calm-good { color: #10b981; font-weight: 700; }
      .calm-warn { color: #f59e0b; font-weight: 700; }
      #calm-mode-btn:hover { filter: brightness(1.15); }
      #calm-mode-btn[aria-pressed="true"] { box-shadow: 0 0 0 2px rgba(147,197,253,0.55); }
    `;
    document.head.appendChild(s);
  }

  // ── Keep applied through re-renders (renderKPIs fires often) ─────
  function watchForReRenders() {
    const target = document.getElementById('kpi-weight');
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (!isOn()) return;
      // If the app overwrote our value, re-apply
      if (target.dataset.calmOverride !== '1' ||
          target.textContent !== rollingAvgText()) {
        // debounce a tick so we don't fight the countUp animation
        clearTimeout(watchForReRenders._t);
        watchForReRenders._t = setTimeout(apply, 60);
      }
    });
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  }
  function rollingAvgText() {
    const r = rollingAvg(WINDOW_DAYS);
    return r ? r.avg.toFixed(1) : '';
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function init() {
    injectCSS();
    ensureButton();
    // Wait a beat for the app to render KPIs the first time
    setTimeout(() => { apply(); watchForReRenders(); }, 400);
    // And re-apply whenever data reloads
    document.addEventListener('weight-data-loaded', apply);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.CalmMode = { apply, unapply, isOn, setOn };
})();
