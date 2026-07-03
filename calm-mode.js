/* ════════════════════════════════════════════════════════════════════
   calm-mode.js — Toggle to hide daily raw weight noise (v2)
   ────────────────────────────────────────────────────────────────────
   When ACTIVE:
     - The "Weight" KPI shows the 7-day rolling AVERAGE (not today's raw)
     - Day-over-day deltas on weight cards are replaced with week-over-week
     - Snapshot strip shows 7-day avg instead of last reading
     - Body gets `.calm-mode` class so CSS can dim/hide other noise
     - "Latest Reading" heading becomes "Smoothed Trend (Calm Mode)"
   When INACTIVE: dashboard renders exactly as before.

   State persisted in localStorage['calm_mode'].
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const STORAGE_KEY = 'calm_mode';
  const WINDOW_DAYS = 7;
  const LOG = (...a) => console.log('[CalmMode]', ...a);

  // ── State ────────────────────────────────────────────────────────
  function isOn() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }
  function setOn(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
  }

  // ── Compute rolling averages from window.allWeightData ───────────
  function toMs(d) {
    if (d instanceof Date) return d.getTime();
    if (typeof d === 'number') return d;
    return new Date(d).getTime();
  }
  function haveData() {
    return Array.isArray(window.allWeightData) && window.allWeightData.length > 0;
  }
  function sortedData() {
    return window.allWeightData.slice().sort((a, b) => toMs(a.date) - toMs(b.date));
  }
  function rollingAvg(days) {
    if (!haveData()) return null;
    const s = sortedData();
    const latestMs = toMs(s[s.length - 1].date);
    const cutoff = latestMs - days * 86400000;
    const w = s.filter(r => toMs(r.date) > cutoff && typeof r.weight === 'number');
    if (!w.length) return null;
    return { avg: w.reduce((sum, r) => sum + r.weight, 0) / w.length, n: w.length };
  }
  function weekOverWeek() {
    if (!haveData() || window.allWeightData.length < 2) return null;
    const s = sortedData();
    const latestMs = toMs(s[s.length - 1].date);
    const t0 = latestMs - 7 * 86400000;
    const t1 = latestMs - 14 * 86400000;
    const wk1 = s.filter(r => toMs(r.date) > t0);
    const wk2 = s.filter(r => toMs(r.date) > t1 && toMs(r.date) <= t0);
    if (!wk1.length || !wk2.length) return null;
    const a1 = wk1.reduce((sum, r) => sum + r.weight, 0) / wk1.length;
    const a2 = wk2.reduce((sum, r) => sum + r.weight, 0) / wk2.length;
    return { delta: a1 - a2, current: a1 };
  }

  // ── Apply / Unapply ──────────────────────────────────────────────
  let _applying = false;
  function apply() {
    if (_applying) return;
    if (!isOn()) { unapply(); return; }
    if (!haveData()) { LOG('no data yet, will retry when app renders'); return; }

    _applying = true;
    document.body.classList.add('calm-mode');

    const roll = rollingAvg(WINDOW_DAYS);
    const wow  = weekOverWeek();

    // KPI weight card
    const kpiWeight = document.getElementById('kpi-weight');
    const kpiSub    = document.getElementById('kpi-weight-sub');
    if (kpiWeight && roll) {
      kpiWeight.textContent = roll.avg.toFixed(1);
      kpiWeight.dataset.calmOverride = '1';
    }
    if (kpiSub) {
      if (wow) {
        const arrow = wow.delta < 0 ? 'down' : (wow.delta > 0 ? 'up' : '');
        const cls   = wow.delta < 0 ? 'calm-good' : (wow.delta > 0 ? 'calm-warn' : '');
        kpiSub.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(wow.delta).toFixed(2)} lbs vs last wk</span>`;
      } else {
        kpiSub.textContent = '7-day rolling average';
      }
    }

    // Card label + unit rewrite
    const kpiCard = kpiWeight ? kpiWeight.closest('.kpi') : null;
    if (kpiCard) {
      const label = kpiCard.querySelector('.kpi-label');
      const unit  = kpiCard.querySelector('.kpi-unit');
      if (label && !label.dataset.calmOriginal) {
        label.dataset.calmOriginal = label.textContent;
        label.textContent = 'Weight (7-day avg)';
      }
      if (unit && !unit.dataset.calmOriginal) {
        unit.dataset.calmOriginal = unit.textContent;
        unit.textContent = 'lbs - smoothed';
      }
    }

    // Snapshot strip
    const snapWeight = document.getElementById('snap-weight');
    const snapDelta  = document.getElementById('snap-weight-delta');
    if (snapWeight && roll) {
      snapWeight.textContent = roll.avg.toFixed(1);
      snapWeight.dataset.calmOverride = '1';
    }
    if (snapDelta) snapDelta.textContent = 'avg of last ' + (roll ? roll.n : WINDOW_DAYS) + ' readings';

    // Section heading rewrite
    document.querySelectorAll('.card-title').forEach(h => {
      if (h.textContent.trim() === 'Latest Reading' && !h.dataset.calmOriginal) {
        h.dataset.calmOriginal = h.textContent;
        h.textContent = 'Smoothed Trend (Calm Mode)';
      }
    });

    updateBadge();
    _applying = false;
    LOG('applied. 7d avg =', roll && roll.avg.toFixed(2), 'wow delta =', wow && wow.delta.toFixed(2));
  }

  function unapply() {
    document.body.classList.remove('calm-mode');

    document.querySelectorAll('[data-calm-original]').forEach(el => {
      el.textContent = el.dataset.calmOriginal;
      delete el.dataset.calmOriginal;
    });

    // Force a re-render so raw values return
    if (typeof window.renderAll === 'function') {
      try { window.renderAll(); } catch (e) { LOG('renderAll failed on unapply', e); }
    } else if (typeof window.renderKPIs === 'function' && haveData()) {
      const s = sortedData();
      try { window.renderKPIs(s[s.length - 1], s[s.length - 2] || null); } catch {}
    }
    document.querySelectorAll('[data-calm-override]').forEach(el => delete el.dataset.calmOverride);

    updateBadge();
    LOG('unapplied');
  }

  // ── Header toggle button ─────────────────────────────────────────
  function ensureButton() {
    if (document.getElementById('calm-mode-btn')) return true;
    const header = document.querySelector('.header .header-inner');
    if (!header) return false;

    const btn = document.createElement('button');
    btn.id = 'calm-mode-btn';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', isOn() ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Toggle Calm Mode');
    btn.title = 'Calm Mode - hide the noisy daily number, show the 7-day average instead';
    btn.style.cssText =
      'background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);' +
      'border-radius:8px;padding:0.35rem 0.7rem;font-size:0.75rem;font-weight:700;' +
      'cursor:pointer;white-space:nowrap;backdrop-filter:blur(4px);margin-right:4px';
    btn.addEventListener('click', () => {
      setOn(!isOn());
      LOG('click toggle -> now', isOn() ? 'ON' : 'OFF');
      isOn() ? apply() : unapply();
      updateBadge();
    });

    const dark = document.getElementById('dark-btn');
    if (dark && dark.parentNode) {
      dark.parentNode.insertBefore(btn, dark);
    } else {
      header.appendChild(btn);
    }
    updateBadge();
    LOG('button injected');
    return true;
  }

  function updateBadge() {
    const btn = document.getElementById('calm-mode-btn');
    if (!btn) return;
    const on = isOn();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Calm: ON' : 'Calm Mode';
    btn.style.background = on ? 'rgba(147,197,253,0.45)' : 'rgba(255,255,255,0.15)';
    btn.style.boxShadow  = on ? '0 0 0 2px rgba(147,197,253,0.6)' : 'none';
  }

  // ── CSS ──────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('calm-mode-styles')) return;
    const s = document.createElement('style');
    s.id = 'calm-mode-styles';
    s.textContent = [
      'body.calm-mode #kpi-fat-sub,',
      'body.calm-mode #kpi-fat-lbs-sub,',
      'body.calm-mode #kpi-muscle-sub,',
      'body.calm-mode #kpi-muscle-lbs-sub,',
      'body.calm-mode #kpi-water-sub { opacity: 0.35; }',
      '.calm-good { color: #10b981; font-weight: 700; }',
      '.calm-warn { color: #f59e0b; font-weight: 700; }',
      '#calm-mode-btn:hover { filter: brightness(1.2); }',
    ].join('\n');
    document.head.appendChild(s);
    LOG('css injected');
  }

  // ── Hook the app's real render cycle ─────────────────────────────
  function hookRenderAll() {
    if (typeof window.renderAll !== 'function') return false;
    if (window.renderAll.__calmHooked) return true;
    const orig = window.renderAll;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      if (isOn()) setTimeout(apply, 30);
      return r;
    };
    wrapped.__calmHooked = true;
    window.renderAll = wrapped;
    LOG('hooked renderAll');
    return true;
  }

  // ── Poll until app has data + renderAll exists, then hook + apply
  function boot() {
    injectCSS();
    let tries = 0;
    const maxTries = 120; // 60s at 500ms
    const iv = setInterval(() => {
      tries++;
      ensureButton();
      const hooked = hookRenderAll();
      const dataReady = haveData();
      if (dataReady) {
        if (isOn()) apply();
        else updateBadge();
      }
      if (hooked && dataReady) {
        clearInterval(iv);
        LOG('ready. state:', isOn() ? 'ON' : 'OFF', '| readings:', window.allWeightData.length);
      }
      if (tries >= maxTries) {
        clearInterval(iv);
        LOG('boot timeout; data=', dataReady, 'renderAll=', typeof window.renderAll);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Debug handle
  window.CalmMode = { apply, unapply, isOn, setOn, rollingAvg, weekOverWeek };
})();
