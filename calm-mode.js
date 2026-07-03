/* ════════════════════════════════════════════════════════════════════
   calm-mode.js — Two toggles for anxiety-friendly viewing:

   1. Calm Mode      — 7-day rolling avg instead of raw daily
   2. Sunday View    — chart + KPI show ONLY Sunday readings

   Both persist in localStorage and can be enabled independently.
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const CALM_KEY   = 'calm_mode';
  const SUNDAY_KEY = 'sunday_only';
  const WINDOW_DAYS = 7;
  const LOG = (...a) => console.log('[CalmMode]', ...a);

  // ── State ────────────────────────────────────────────────────────
  const getFlag = k => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  const setFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };
  const isCalmOn   = () => getFlag(CALM_KEY);
  const isSundayOn = () => getFlag(SUNDAY_KEY);

  // ── Data helpers ─────────────────────────────────────────────────
  function toMs(d) {
    if (d instanceof Date) return d.getTime();
    if (typeof d === 'number') return d;
    return new Date(d).getTime();
  }
  function toDate(d) {
    return d instanceof Date ? d : new Date(d);
  }
  function haveData() {
    return Array.isArray(window.allWeightData) && window.allWeightData.length > 0;
  }
  function sortedData() {
    return window.allWeightData.slice().sort((a, b) => toMs(a.date) - toMs(b.date));
  }
  function sundaysOnly(data) {
    return data.filter(r => toDate(r.date).getDay() === 0);
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
  function sundayComparison() {
    if (!haveData()) return null;
    const sundays = sundaysOnly(sortedData());
    if (sundays.length < 1) return null;
    const latest = sundays[sundays.length - 1];
    const prev   = sundays.length > 1 ? sundays[sundays.length - 2] : null;
    return {
      latest: latest.weight,
      latestDate: toDate(latest.date),
      prev: prev ? prev.weight : null,
      prevDate: prev ? toDate(prev.date) : null,
      delta: prev ? latest.weight - prev.weight : null,
    };
  }

  // ── Apply / Unapply Calm Mode ────────────────────────────────────
  let _applying = false;
  function applyCalm() {
    if (_applying) return;
    if (!isCalmOn()) { unapplyCalm(); return; }
    if (!haveData()) { LOG('calm: no data yet'); return; }

    _applying = true;
    document.body.classList.add('calm-mode');

    const roll = rollingAvg(WINDOW_DAYS);
    const wow  = weekOverWeek();
    const sun  = isSundayOn() ? sundayComparison() : null;

    const kpiWeight = document.getElementById('kpi-weight');
    const kpiSub    = document.getElementById('kpi-weight-sub');

    // When BOTH are on, prefer Sunday number (that's what the user is committing to)
    if (kpiWeight) {
      if (sun) {
        kpiWeight.textContent = sun.latest.toFixed(1);
      } else if (roll) {
        kpiWeight.textContent = roll.avg.toFixed(1);
      }
      kpiWeight.dataset.calmOverride = '1';
    }
    if (kpiSub) {
      if (sun && sun.delta != null) {
        const arrow = sun.delta < 0 ? 'down' : (sun.delta > 0 ? 'up' : '');
        const cls   = sun.delta < 0 ? 'calm-good' : (sun.delta > 0 ? 'calm-warn' : '');
        kpiSub.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(sun.delta).toFixed(2)} lbs vs last Sunday</span>`;
      } else if (wow) {
        const arrow = wow.delta < 0 ? 'down' : (wow.delta > 0 ? 'up' : '');
        const cls   = wow.delta < 0 ? 'calm-good' : (wow.delta > 0 ? 'calm-warn' : '');
        kpiSub.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(wow.delta).toFixed(2)} lbs vs last wk</span>`;
      } else {
        kpiSub.textContent = '7-day rolling average';
      }
    }

    const kpiCard = kpiWeight ? kpiWeight.closest('.kpi') : null;
    if (kpiCard) {
      const label = kpiCard.querySelector('.kpi-label');
      const unit  = kpiCard.querySelector('.kpi-unit');
      if (label && !label.dataset.calmOriginal) {
        label.dataset.calmOriginal = label.textContent;
        label.textContent = sun ? 'Weight (Sunday only)' : 'Weight (7-day avg)';
      } else if (label && sun) {
        label.textContent = 'Weight (Sunday only)';
      } else if (label && !sun) {
        label.textContent = 'Weight (7-day avg)';
      }
      if (unit && !unit.dataset.calmOriginal) {
        unit.dataset.calmOriginal = unit.textContent;
        unit.textContent = sun ? 'lbs - last Sunday' : 'lbs - smoothed';
      } else if (unit) {
        unit.textContent = sun ? 'lbs - last Sunday' : 'lbs - smoothed';
      }
    }

    const snapWeight = document.getElementById('snap-weight');
    const snapDelta  = document.getElementById('snap-weight-delta');
    if (snapWeight) {
      if (sun) snapWeight.textContent = sun.latest.toFixed(1);
      else if (roll) snapWeight.textContent = roll.avg.toFixed(1);
      snapWeight.dataset.calmOverride = '1';
    }
    if (snapDelta) {
      snapDelta.textContent = sun
        ? 'last Sunday reading'
        : ('avg of last ' + (roll ? roll.n : WINDOW_DAYS) + ' readings');
    }

    document.querySelectorAll('.card-title').forEach(h => {
      if (h.textContent.trim() === 'Latest Reading' && !h.dataset.calmOriginal) {
        h.dataset.calmOriginal = h.textContent;
      }
      if (h.dataset.calmOriginal === 'Latest Reading') {
        h.textContent = sun ? 'Last Sunday Reading' : 'Smoothed Trend (Calm Mode)';
      }
    });

    updateBadges();
    _applying = false;
    LOG('calm applied. mode:', sun ? 'sunday+calm' : 'calm-only');
  }

  function unapplyCalm() {
    document.body.classList.remove('calm-mode');
    document.querySelectorAll('[data-calm-original]').forEach(el => {
      el.textContent = el.dataset.calmOriginal;
      delete el.dataset.calmOriginal;
    });
    // Force re-render so raw values return
    if (typeof window.renderAll === 'function') {
      try { window.renderAll(); } catch (e) { LOG('renderAll on unapply', e); }
    }
    document.querySelectorAll('[data-calm-override]').forEach(el => delete el.dataset.calmOverride);
    updateBadges();
  }

  // ── Sunday View: swap chart data to Sundays only ─────────────────
  // Approach: wrap window.renderWeightChart. When Sunday mode is on,
  // filter the input `data` array to Sundays before delegating.
  function hookChart() {
    if (typeof window.renderWeightChart !== 'function') return false;
    if (window.renderWeightChart.__sundayHooked) return true;
    const orig = window.renderWeightChart;
    const wrapped = function (data) {
      if (isSundayOn() && Array.isArray(data)) {
        const filtered = sundaysOnly(data);
        if (filtered.length >= 2) {
          LOG('chart filtered to', filtered.length, 'Sundays (of', data.length, 'daily)');
          return orig.call(this, filtered);
        }
        LOG('sunday filter would leave <2 points, keeping full data');
      }
      return orig.call(this, data);
    };
    wrapped.__sundayHooked = true;
    window.renderWeightChart = wrapped;
    return true;
  }

  // ── renderKPIs hook: swap latest/prev to Sunday values ──────────
  // When Sunday View is on, every body-comp KPI (BMI, fat, muscle,
  // water, bone, BMR, TDEE) should reflect Sunday's reading, not the
  // latest weekday reading. Otherwise you get a Frankenstein view:
  // Sunday weight + Thursday body-fat = confusing and anxiety-inducing.
  function hookRenderKPIs() {
    if (typeof window.renderKPIs !== 'function') return false;
    if (window.renderKPIs.__sundayKpiHooked) return true;
    const orig = window.renderKPIs;
    const wrapped = function (latest, prev) {
      if (isSundayOn() && haveData()) {
        const sundays = sundaysOnly(sortedData());
        if (sundays.length >= 1) {
          const sunLatest = sundays[sundays.length - 1];
          const sunPrev   = sundays.length > 1 ? sundays[sundays.length - 2] : null;
          LOG('renderKPIs swapped to Sunday snapshot:', sunLatest.weight,
              '(prev:', sunPrev ? sunPrev.weight : 'none', ')');
          return orig.call(this, sunLatest, sunPrev);
        }
      }
      return orig.call(this, latest, prev);
    };
    wrapped.__sundayKpiHooked = true;
    window.renderKPIs = wrapped;
    return true;
  }

  // ── Master render hook: fires on every renderAll ─────────────────
  function hookRenderAll() {
    if (typeof window.renderAll !== 'function') return false;
    if (window.renderAll.__calmHooked) return true;
    const orig = window.renderAll;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      setTimeout(() => {
        if (isCalmOn()) applyCalm();
        else if (isSundayOn()) applySundayKPI();
      }, 30);
      return r;
    };
    wrapped.__calmHooked = true;
    window.renderAll = wrapped;
    return true;
  }

  // Sunday View KPI update (used when Calm is OFF but Sunday is ON)
  function applySundayKPI() {
    if (!isSundayOn() || !haveData()) return;
    const sun = sundayComparison();
    if (!sun) return;
    document.body.classList.add('sunday-mode');

    const kpiWeight = document.getElementById('kpi-weight');
    const kpiSub    = document.getElementById('kpi-weight-sub');
    if (kpiWeight) {
      kpiWeight.textContent = sun.latest.toFixed(1);
      kpiWeight.dataset.sundayOverride = '1';
    }
    if (kpiSub && sun.delta != null) {
      const arrow = sun.delta < 0 ? 'down' : (sun.delta > 0 ? 'up' : '');
      const cls   = sun.delta < 0 ? 'calm-good' : (sun.delta > 0 ? 'calm-warn' : '');
      kpiSub.innerHTML = `<span class="${cls}">${arrow} ${Math.abs(sun.delta).toFixed(2)} lbs vs last Sunday</span>`;
    } else if (kpiSub) {
      kpiSub.textContent = 'last Sunday reading';
    }
    const kpiCard = kpiWeight ? kpiWeight.closest('.kpi') : null;
    if (kpiCard) {
      const label = kpiCard.querySelector('.kpi-label');
      const unit  = kpiCard.querySelector('.kpi-unit');
      if (label && !label.dataset.sundayOriginal) {
        label.dataset.sundayOriginal = label.textContent;
        label.textContent = 'Weight (Sunday only)';
      }
      if (unit && !unit.dataset.sundayOriginal) {
        unit.dataset.sundayOriginal = unit.textContent;
        unit.textContent = 'lbs - last Sunday';
      }
    }
    const snapWeight = document.getElementById('snap-weight');
    const snapDelta  = document.getElementById('snap-weight-delta');
    if (snapWeight) {
      snapWeight.textContent = sun.latest.toFixed(1);
      snapWeight.dataset.sundayOverride = '1';
    }
    if (snapDelta) snapDelta.textContent = 'last Sunday reading';
    LOG('sunday KPI applied. latest Sunday:', sun.latest);
  }

  function unapplySundayKPI() {
    document.body.classList.remove('sunday-mode');
    document.querySelectorAll('[data-sunday-original]').forEach(el => {
      el.textContent = el.dataset.sundayOriginal;
      delete el.dataset.sundayOriginal;
    });
    if (typeof window.renderAll === 'function') {
      try { window.renderAll(); } catch {}
    }
    document.querySelectorAll('[data-sunday-override]').forEach(el => delete el.dataset.sundayOverride);
  }

  // ── Buttons in header ────────────────────────────────────────────
  function ensureButtons() {
    const header = document.querySelector('.header .header-inner');
    if (!header) return false;
    let injected = false;

    if (!document.getElementById('calm-mode-btn')) {
      const btn = mkBtn('calm-mode-btn', 'Toggle Calm Mode',
        'Calm Mode - hide daily raw weight, show 7-day rolling average', () => {
          setFlag(CALM_KEY, !isCalmOn());
          LOG('calm toggle ->', isCalmOn() ? 'ON' : 'OFF');
          isCalmOn() ? applyCalm() : unapplyCalm();
          updateBadges();
        });
      insertHeader(header, btn);
      injected = true;
    }
    if (!document.getElementById('sunday-mode-btn')) {
      const btn = mkBtn('sunday-mode-btn', 'Toggle Sunday View',
        'Sunday View - chart + KPI show only Sunday readings', () => {
          setFlag(SUNDAY_KEY, !isSundayOn());
          LOG('sunday toggle ->', isSundayOn() ? 'ON' : 'OFF');
          if (!isSundayOn()) {
            unapplySundayKPI();
          }
          // Trigger full re-render so renderKPIs picks up Sunday-swap
          // and chart re-renders through the hooked path
          if (typeof window.renderAll === 'function') {
            try { window.renderAll(); } catch (e) { LOG('renderAll on sunday-toggle', e); }
          }
          // Post-render label tweaks
          setTimeout(() => {
            if (isSundayOn()) {
              if (isCalmOn()) applyCalm(); else applySundayKPI();
            } else if (isCalmOn()) {
              applyCalm();
            }
            updateBadges();
          }, 60);
        });
      insertHeader(header, btn);
      injected = true;
    }
    if (injected) updateBadges();
    return true;
  }

  function mkBtn(id, aria, title, onclick) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.setAttribute('aria-label', aria);
    btn.title = title;
    btn.style.cssText =
      'background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);' +
      'border-radius:8px;padding:0.35rem 0.7rem;font-size:0.75rem;font-weight:700;' +
      'cursor:pointer;white-space:nowrap;backdrop-filter:blur(4px);margin-right:4px';
    btn.addEventListener('click', onclick);
    return btn;
  }
  function insertHeader(header, btn) {
    const dark = document.getElementById('dark-btn');
    if (dark && dark.parentNode) dark.parentNode.insertBefore(btn, dark);
    else header.appendChild(btn);
  }
  function updateBadges() {
    const cbtn = document.getElementById('calm-mode-btn');
    if (cbtn) {
      const on = isCalmOn();
      cbtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      cbtn.textContent = on ? 'Calm: ON' : 'Calm Mode';
      cbtn.style.background = on ? 'rgba(147,197,253,0.45)' : 'rgba(255,255,255,0.15)';
      cbtn.style.boxShadow  = on ? '0 0 0 2px rgba(147,197,253,0.6)' : 'none';
    }
    const sbtn = document.getElementById('sunday-mode-btn');
    if (sbtn) {
      const on = isSundayOn();
      sbtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      sbtn.textContent = on ? 'Sunday: ON' : 'Sunday View';
      sbtn.style.background = on ? 'rgba(250,204,21,0.45)' : 'rgba(255,255,255,0.15)';
      sbtn.style.boxShadow  = on ? '0 0 0 2px rgba(250,204,21,0.6)' : 'none';
    }
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
      'body.calm-mode #kpi-water-sub,',
      'body.sunday-mode #kpi-fat-sub,',
      'body.sunday-mode #kpi-fat-lbs-sub,',
      'body.sunday-mode #kpi-muscle-sub,',
      'body.sunday-mode #kpi-muscle-lbs-sub,',
      'body.sunday-mode #kpi-water-sub { opacity: 0.35; }',
      '.calm-good { color: #10b981; font-weight: 700; }',
      '.calm-warn { color: #f59e0b; font-weight: 700; }',
      '#calm-mode-btn:hover, #sunday-mode-btn:hover { filter: brightness(1.2); }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function boot() {
    injectCSS();
    let tries = 0;
    const maxTries = 120;
    const iv = setInterval(() => {
      tries++;
      ensureButtons();
      const rHooked = hookRenderAll();
      const cHooked = hookChart();
      const kHooked = hookRenderKPIs();
      const ready = haveData();
      if (ready) {
        if (isCalmOn()) applyCalm();
        else if (isSundayOn()) {
          applySundayKPI();
          if (typeof window.renderWeightChart === 'function') {
            try { window.renderWeightChart(sortedData()); } catch {}
          }
        }
        else updateBadges();
      }
      if (rHooked && cHooked && kHooked && ready) {
        clearInterval(iv);
        LOG('ready. calm:', isCalmOn(), 'sunday:', isSundayOn(),
            '| readings:', window.allWeightData.length,
            '| sundays:', sundaysOnly(window.allWeightData).length);
      }
      if (tries >= maxTries) { clearInterval(iv); LOG('boot timeout'); }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Debug handle
  window.CalmMode = {
    applyCalm, unapplyCalm, applySundayKPI, unapplySundayKPI,
    isCalmOn, isSundayOn, setCalm: v => setFlag(CALM_KEY, v), setSunday: v => setFlag(SUNDAY_KEY, v),
    rollingAvg, weekOverWeek, sundayComparison, sundaysOnly,
  };
})();
