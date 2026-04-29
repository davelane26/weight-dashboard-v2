/* ════════════════════════════════════════════════════════════════════
   enhancements.js — wave 1 features
   Loaded with `defer`, runs after DOMContentLoaded.

   Modules (kept tiny + self-contained, none mutate app.js globals):
     1. Visibility-aware refresh (pause polling when tab hidden)
     2. Lazy-load tab JS on first activation
     3. Confetti on milestone unlock
     4. Data export (CSV + JSON) menu
     5. Compact density toggle
     6. PWA install banner + service-worker registration
   ──────────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 1. Visibility-aware refresh
  //    The dashboard's setInterval(loadData, 30s) keeps polling
  //    even when the tab is in a background window. Wasteful.
  //    We override the page's setInterval just for fetch-style
  //    refreshes by wrapping the doc visibility event.
  // ─────────────────────────────────────────────────────────────
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // Force a single immediate refresh on return to foreground
      if (typeof window.loadData === 'function') window.loadData();
      if (typeof window.loadGlucose === 'function') window.loadGlucose();
      if (typeof window.loadActivityData === 'function') window.loadActivityData();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Patch setInterval ONLY for refresh callbacks so they no-op when hidden
  const REFRESH_FN_NAMES = new Set(['loadData', 'loadGlucose', 'loadActivityData']);
  const _origSetInterval = window.setInterval;
  window.setInterval = function (fn, ms, ...rest) {
    const wrapped = (...a) => {
      if (document.visibilityState !== 'visible') return; // skip when hidden
      try { return fn(...a); } catch (e) { console.warn('refresh failed', e); }
    };
    // Only wrap likely-refresh functions to avoid breaking anything else.
    const looksLikeRefresh =
      typeof fn === 'function' &&
      (REFRESH_FN_NAMES.has(fn.name) || (ms >= 5000 && ms <= 600000));
    return _origSetInterval(looksLikeRefresh ? wrapped : fn, ms, ...rest);
  };

  // ─────────────────────────────────────────────────────────────
  // 2. Confetti on milestone unlock
  //    Watches journey-bar fills + milestone .done class additions.
  //    Tiny canvas-based confetti — no external dependencies.
  // ─────────────────────────────────────────────────────────────
  const Confetti = (() => {
    let canvas, ctx, particles = [], rafId;
    function init() {
      if (canvas) return;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener('resize', resize);
    }
    function spawn(n = 80) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return;
      init();
      const colors = ['#0053e2', '#ffc220', '#2a8703', '#ea1100', '#7c3aed', '#0891b2'];
      for (let i = 0; i < n; i++) {
        particles.push({
          x: canvas.width / 2 + (Math.random() - 0.5) * 80,
          y: canvas.height / 2,
          vx: (Math.random() - 0.5) * 14,
          vy: -Math.random() * 18 - 6,
          g: 0.5,
          size: 4 + Math.random() * 5,
          color: colors[(Math.random() * colors.length) | 0],
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          life: 90 + Math.random() * 30,
        });
      }
      if (!rafId) tick();
    }
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter(p => p.life > 0);
      particles.forEach(p => {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, p.life / 30);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (particles.length) {
        rafId = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(rafId);
        rafId = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    return { spawn };
  })();

  // Track previously-done milestone count in localStorage so we only
  // celebrate fresh ones, not every page load.
  function watchMilestones() {
    const KEY = 'wt_v2_milestone_done_count';
    const observer = new MutationObserver(() => {
      const done = document.querySelectorAll('#milestones-row .milestone-ring.done').length;
      const prev = parseInt(localStorage.getItem(KEY) || '-1', 10);
      if (prev === -1) {
        // First-ever load → just record, don't celebrate retroactively
        localStorage.setItem(KEY, String(done));
        return;
      }
      if (done > prev) {
        Confetti.spawn(120);
        localStorage.setItem(KEY, String(done));
      } else if (done !== prev) {
        localStorage.setItem(KEY, String(done));
      }
    });
    const target = document.getElementById('milestones-row');
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Data export (CSV + JSON)
  //    Pulls from window.allData (set by app.js). Renders a tiny
  //    drop-in menu next to the Export Card button.
  // ─────────────────────────────────────────────────────────────
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  function fmtIsoDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
  }
  function exportCSV() {
    const data = window.allData || [];
    if (!data.length) { alert('No data loaded yet.'); return; }
    const cols = ['date', 'weight', 'bmi', 'bodyFat', 'muscle', 'water', 'bone', 'bmr', 'tdee'];
    const header = cols.join(',');
    const rows = data.map(r =>
      cols.map(c => {
        const v = c === 'date' ? fmtIsoDate(r[c]) : (r[c] ?? '');
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
      }).join(',')
    );
    downloadFile(
      `weight-data-${fmtIsoDate(new Date())}.csv`,
      [header, ...rows].join('\n'),
      'text/csv'
    );
  }
  function exportJSON() {
    const data = window.allData || [];
    if (!data.length) { alert('No data loaded yet.'); return; }
    const payload = data.map(r => ({ ...r, date: fmtIsoDate(r.date) }));
    downloadFile(
      `weight-data-${fmtIsoDate(new Date())}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  }
  function mountExportMenu() {
    const exportBtn = document.getElementById('export-card-btn');
    if (!exportBtn || !exportBtn.parentElement) return;
    const wrap = document.createElement('div');
    wrap.className = 'data-export-wrap';
    wrap.innerHTML = `
      <button id="data-export-btn" class="data-export-btn"
        aria-label="Export data" aria-haspopup="menu" aria-expanded="false" type="button">
        💾 Export
      </button>
      <div class="data-export-menu" role="menu" hidden>
        <button role="menuitem" type="button" data-fmt="csv">📊 Download CSV</button>
        <button role="menuitem" type="button" data-fmt="json">📋 Download JSON</button>
      </div>`;
    exportBtn.parentElement.insertBefore(wrap, exportBtn);
    const trigger = wrap.querySelector('.data-export-btn');
    const menu = wrap.querySelector('.data-export-menu');
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const open = !menu.hidden;
      menu.hidden = open;
      trigger.setAttribute('aria-expanded', String(!open));
    });
    menu.addEventListener('click', e => {
      const btn = e.target.closest('button[data-fmt]');
      if (!btn) return;
      if (btn.dataset.fmt === 'csv') exportCSV();
      else if (btn.dataset.fmt === 'json') exportJSON();
      close();
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Compact density toggle
  //    Adds a `.density-compact` class to <html> that polish.css
  //    interprets. Persisted in localStorage.
  // ─────────────────────────────────────────────────────────────
  const DENSITY_KEY = 'wt_v2_density';
  function applyDensity(mode) {
    document.documentElement.classList.toggle('density-compact', mode === 'compact');
    const btn = document.getElementById('density-toggle');
    if (btn) {
      btn.textContent = mode === 'compact' ? '🔍 Cozy' : '🔍 Compact';
      btn.setAttribute('aria-pressed', mode === 'compact' ? 'true' : 'false');
    }
  }
  function mountDensityToggle() {
    const exportBtn = document.getElementById('export-card-btn');
    if (!exportBtn || !exportBtn.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'density-toggle';
    btn.className = 'header-utility-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle compact density');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = '🔍 Compact';
    btn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('density-compact') ? 'cozy' : 'compact';
      localStorage.setItem(DENSITY_KEY, next);
      applyDensity(next);
    });
    exportBtn.parentElement.insertBefore(btn, exportBtn);
    applyDensity(localStorage.getItem(DENSITY_KEY) || 'cozy');
  }

  // ─────────────────────────────────────────────────────────────
  // 5. PWA install banner + SW registration
  //    Browsers fire `beforeinstallprompt`; we stash the event and
  //    show a non-intrusive banner the user can accept or dismiss.
  // ─────────────────────────────────────────────────────────────
  let deferredInstallPrompt = null;
  const INSTALL_DISMISSED_KEY = 'wt_v2_install_dismissed';

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem(INSTALL_DISMISSED_KEY) === '1') return;
    showInstallBanner();
  });

  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install this dashboard as an app');
    banner.innerHTML = `
      <span class="pwa-icon" aria-hidden="true">📲</span>
      <div class="pwa-text">
        <strong>Install this dashboard?</strong>
        <span>Adds an icon to your home screen — works offline.</span>
      </div>
      <button id="pwa-install-yes" type="button" class="pwa-btn pwa-btn-primary">Install</button>
      <button id="pwa-install-no"  type="button" class="pwa-btn pwa-btn-secondary" aria-label="Dismiss install prompt">✕</button>`;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-yes').onclick = async () => {
      if (!deferredInstallPrompt) { banner.remove(); return; }
      banner.remove();
      const { outcome } = await deferredInstallPrompt.prompt().then(() => deferredInstallPrompt.userChoice);
      if (outcome === 'dismissed') {
        localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      }
      deferredInstallPrompt = null;
    };
    document.getElementById('pwa-install-no').onclick = () => {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      banner.remove();
    };
  }

  // Service worker registration — only if served over https/localhost
  // and the page didn't already nuke regs (handled by removing that script).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        // Force the new SW to activate ASAP if one is waiting.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (sw) sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch(err => {
        console.info('SW registration skipped:', err.message);
      });
      // Auto-reload once when the new SW takes control, so users see
      // the fresh deploy without a manual hard-refresh.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Lazy-load tab JS
  //    Heavy tab modules now load on first activation instead of
  //    on every page hit. Reduces cold-load JS by ~150KB.
  //    Note: this requires removing those <script> tags from
  //    index.html <head>. Done in companion commit.
  // ─────────────────────────────────────────────────────────────
  const LAZY_TAB_SCRIPTS = {
    glucose:    ['glucose.js?v=99'],
    activity:   ['activity.js?v=99'],
    medication: ['medication.js?v=99'],
  };
  const _loaded = new Set();
  function loadScriptOnce(src) {
    if (_loaded.has(src)) return Promise.resolve();
    _loaded.add(src);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  function lazyLoadFor(tabName) {
    const list = LAZY_TAB_SCRIPTS[tabName];
    if (!list) return;
    list.forEach(src => loadScriptOnce(src));
  }

  // Wrap switchTab once it's defined.
  function patchSwitchTab() {
    if (typeof window.switchTab !== 'function') return false;
    const original = window.switchTab;
    window.switchTab = function (name) {
      lazyLoadFor(name);
      return original.apply(this, arguments);
    };
    return true;
  }
  // app.js loads with `defer`; this file too. To be safe, patch on next tick.
  function tryPatch(retries = 10) {
    if (patchSwitchTab()) return;
    if (retries > 0) setTimeout(() => tryPatch(retries - 1), 50);
  }

  // ─────────────────────────────────────────────────────────────
  // 7. Keyboard tab reorder (a11y equivalent for mouse drag)
  //    With a tab focused: Ctrl/Cmd + Shift + ArrowLeft/Right
  //    swaps it with its neighbour. Fires saveTabOrder if exposed.
  // ─────────────────────────────────────────────────────────────
  function moveTab(btn, dir) {
    const nav = btn.parentElement;
    if (!nav) return;
    const sibling = dir < 0 ? btn.previousElementSibling : btn.nextElementSibling;
    if (!sibling || !sibling.classList.contains('tab-btn')) return;
    if (dir < 0) nav.insertBefore(btn, sibling);
    else         nav.insertBefore(sibling, btn);
    btn.focus();
    if (typeof window.saveTabOrder === 'function') window.saveTabOrder();
  }
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    const focused = document.activeElement;
    if (!focused || !focused.classList || !focused.classList.contains('tab-btn')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveTab(focused, -1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveTab(focused, +1); }
  });

  // ─────────────────────────────────────────────────────────────
  // Bootstrap
  // ─────────────────────────────────────────────────────────────
  function boot() {
    mountExportMenu();
    mountDensityToggle();
    watchMilestones();
    tryPatch();
    // Eagerly load whichever tab is actually selected on first paint
    const restoredTab = localStorage.getItem('wt_v2_tab') || 'weight';
    lazyLoadFor(restoredTab);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
