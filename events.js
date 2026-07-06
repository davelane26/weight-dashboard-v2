/* ═══════════════════════════════════════════════════════════════════
   events.js
   Context Events log — record off-protocol periods (travel, illness,
   etc.) so the titration readiness math can be interpreted with
   real-life context instead of mistaking a behavioral plateau for a
   pharmacological one.

   Storage:
     - Local:  localStorage['evt_v1']
     - Cloud:  Firebase Realtime DB at /medication/events.json
               (mirrors how medication.js syncs shots — same auth,
                same project, same merge strategy)

   Public API:
     - window.getEvents()                 → all events, sorted asc
     - window.getEventsInRange(start,end) → events overlapping range
     - window.renderEvents()              → re-render the card

   Renders into #events-card-body (form + chronological list).
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const STORAGE_KEY     = 'evt_v1';
  const CLOUD_URL       = 'https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com/medication/events.json';
  const MAX_NOTE_LENGTH = 200;

  // Type taxonomy. Colors are intentionally distinct from each other
  // and from the trajectory chart's scenario palette.
  const EVENT_TYPES = [
    { key: 'travel',   label: 'Travel',              color: '#0053e2' },
    { key: 'eating',   label: 'Off-Protocol Eating', color: '#f59f00' },
    { key: 'illness',  label: 'Illness',             color: '#ea1100' },
    { key: 'training', label: 'Reduced Training',    color: '#995213' },
    { key: 'alcohol',  label: 'Alcohol',             color: '#9333ea' },
    { key: 'stress',   label: 'Big Stress',          color: '#7c3aed' },
    { key: 'other',    label: 'Other',               color: '#6d7a95' },
  ];

  const TYPE_BY_KEY = Object.fromEntries(EVENT_TYPES.map(t => [t.key, t]));

  // ── Storage ────────────────────────────────────────────────────────
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }

  function saveLocal(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }

  function setSyncStatus(msg, color) {
    const el = document.getElementById('evt-sync-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = color || '#6d7a95';
    el.removeAttribute('hidden');
  }

  async function cloudURL() {
    const token = window.fbUser ? await window.fbUser.getIdToken() : null;
    return CLOUD_URL + (token ? '?auth=' + token : '');
  }

  async function fetchFromCloud() {
    try {
      const base = await cloudURL();
      const sep  = base.includes('?') ? '&' : '?';
      const resp = await fetch(base + sep + 't=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      return Array.isArray(json) ? json : [];
    } catch (e) {
      setSyncStatus('Cloud fetch failed: ' + e.message, '#e03131');
      console.warn('[events] cloud fetch failed:', e.message);
      return null;
    }
  }

  async function pushToCloud(events) {
    setSyncStatus('Syncing...', '#995213');
    try {
      const url  = await cloudURL();
      const resp = await fetch(url, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(events),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      setSyncStatus('Synced ' + new Date().toLocaleTimeString(), '#2a8703');
    } catch (e) {
      setSyncStatus('Sync push failed: ' + e.message, '#e03131');
      console.warn('[events] cloud push failed:', e.message);
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────
  function uid() {
    return 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalize(e) {
    return {
      id:        e.id || uid(),
      start:     e.start,
      end:       e.end || null,
      type:      TYPE_BY_KEY[e.type] ? e.type : 'other',
      note:      (e.note || '').slice(0, MAX_NOTE_LENGTH),
      createdAt: e.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function sortAsc(events) {
    return [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  function getAll() {
    return sortAsc(loadLocal());
  }

  function addEvent(payload) {
    const events = loadLocal();
    events.push(normalize(payload));
    saveLocal(events);
    pushToCloud(events);
    notifyDownstream();
  }

  function deleteEvent(id) {
    const events = loadLocal().filter(e => e.id !== id);
    saveLocal(events);
    pushToCloud(events);
    notifyDownstream();
  }

  // After any mutation, refresh consumers so the trajectory chart
  // and readiness card update immediately.
  function notifyDownstream() {
    render();
    if (typeof window.renderTitrationTrajectory === 'function') {
      try { window.renderTitrationTrajectory(); } catch (e) { /* swallow */ }
    }
    if (typeof window.renderTitrationReadiness === 'function') {
      try { window.renderTitrationReadiness(); } catch (e) { /* swallow */ }
    }
    // Main weight chart — lives on the home tab; only rerender if
    // it's already been built and allData is available.
    if (typeof window.renderWeightChart === 'function' &&
        Array.isArray(window.allWeightData) && window.allWeightData.length) {
      try { window.renderWeightChart(window.allWeightData); } catch (e) { /* swallow */ }
    }
  }

  // ── Query helpers (used by chart + readiness card) ─────────────────
  function getEventsInRange(rangeStart, rangeEnd) {
    return getAll().filter(e => {
      const s = new Date(e.start);
      const en = e.end ? new Date(e.end) : new Date();  // ongoing = up to now
      return en >= rangeStart && s <= rangeEnd;
    });
  }

  // ── Form & list render ─────────────────────────────────────────────
  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function fmtRange(start, end) {
    const s = new Date(start);
    const sFmt = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!end) return sFmt + ' \u2192 ongoing';
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return sFmt;
    const eFmt = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return sFmt + ' \u2192 ' + eFmt;
  }

  function eventRow(e) {
    const t = TYPE_BY_KEY[e.type] || TYPE_BY_KEY.other;
    return `
      <li style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.55rem 0;
                 border-bottom:1px solid #eef1f7">
        <span style="display:inline-block;width:0.7rem;height:0.7rem;border-radius:50%;
                     background:${t.color};margin-top:0.35rem;flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:baseline">
            <span style="font-weight:700;font-size:0.82rem;color:#1a2340">${t.label}</span>
            <span style="font-size:0.7rem;color:#6d7a95;white-space:nowrap">${fmtRange(e.start, e.end)}</span>
          </div>
          ${e.note ? `<p style="font-size:0.72rem;color:#6d7a95;margin:0.15rem 0 0;line-height:1.4">${escapeHtml(e.note)}</p>` : ''}
        </div>
        <button onclick="window.deleteEventConfirm('${e.id}')"
                aria-label="Delete event"
                style="background:none;border:none;color:#9aa5b4;font-size:0.95rem;
                       cursor:pointer;padding:0 0.25rem;line-height:1">&times;</button>
      </li>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function render() {
    const root = document.getElementById('events-card-body');
    if (!root) return;

    const events = getAll().reverse();  // newest first in the list
    const typeOpts = EVENT_TYPES.map(t =>
      `<option value="${t.key}">${t.label}</option>`).join('');

    root.innerHTML = `
      <!-- Add form -->
      <form id="evt-add-form" onsubmit="return window.submitNewEvent(event)"
            style="background:#f5f7fb;border-radius:10px;padding:0.8rem;
                   margin-bottom:0.9rem;display:grid;
                   grid-template-columns:1fr 1fr 1fr;gap:0.5rem;align-items:end">
        <label style="display:flex;flex-direction:column;gap:0.2rem">
          <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.06em;color:#6d7a95">Type</span>
          <select name="type" required
                  style="padding:0.4rem;border:1px solid #cbd5e1;border-radius:6px;
                         font-size:0.82rem;background:white">${typeOpts}</select>
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem">
          <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.06em;color:#6d7a95">Start</span>
          <input type="date" name="start" required value="${todayISO()}"
                 style="padding:0.4rem;border:1px solid #cbd5e1;border-radius:6px;
                        font-size:0.82rem">
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem">
          <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.06em;color:#6d7a95">End (blank = ongoing)</span>
          <input type="date" name="end"
                 style="padding:0.4rem;border:1px solid #cbd5e1;border-radius:6px;
                        font-size:0.82rem">
        </label>
        <label style="display:flex;flex-direction:column;gap:0.2rem;grid-column:1 / -1">
          <span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.06em;color:#6d7a95">Note (optional, max ${MAX_NOTE_LENGTH})</span>
          <input type="text" name="note" maxlength="${MAX_NOTE_LENGTH}"
                 placeholder="e.g. Vegas trip, way too many fries"
                 style="padding:0.4rem;border:1px solid #cbd5e1;border-radius:6px;
                        font-size:0.82rem">
        </label>
        <div style="grid-column:1 / -1;display:flex;justify-content:space-between;
                    align-items:center;gap:0.5rem">
          <span id="evt-sync-status" style="font-size:0.7rem;color:#6d7a95" hidden></span>
          <button type="submit"
                  style="background:#0053e2;color:white;border:none;border-radius:6px;
                         padding:0.45rem 1rem;font-size:0.78rem;font-weight:700;
                         cursor:pointer">Log event</button>
        </div>
      </form>

      <!-- Event list -->
      ${events.length
        ? `<ul style="list-style:none;padding:0;margin:0">${events.map(eventRow).join('')}</ul>`
        : `<p style="color:#9aa5b4;font-size:0.78rem;text-align:center;padding:0.75rem 0;margin:0">
            No events logged yet. Use the form above to flag off-protocol periods so the readiness widget can interpret your trend with context.
          </p>`}`;
  }

  // ── Form handlers (exposed to inline onclick/onsubmit) ─────────────
  window.submitNewEvent = function (ev) {
    ev.preventDefault();
    const fd   = new FormData(ev.target);
    const type = fd.get('type');
    const start = fd.get('start');
    const end   = fd.get('end') || null;
    const note  = fd.get('note') || '';
    if (!start) return false;
    if (end && new Date(end) < new Date(start)) {
      setSyncStatus('End date must be on or after start date', '#e03131');
      return false;
    }
    addEvent({ type, start, end, note });
    ev.target.reset();
    ev.target.elements.start.value = todayISO();
    return false;
  };

  window.deleteEventConfirm = function (id) {
    if (confirm('Delete this event?')) deleteEvent(id);
  };

  // ── Public API ─────────────────────────────────────────────────────
  window.getEvents          = getAll;
  window.getEventsInRange   = getEventsInRange;
  window.getEventTypes      = () => EVENT_TYPES.slice();
  window.getEventTypeByKey  = key => TYPE_BY_KEY[key] || TYPE_BY_KEY.other;
  window.renderEvents       = render;

  // ── Boot: fetch from cloud once auth is ready, then render ─────────
  async function init() {
    render();  // immediate paint from local
    // Wait briefly for fbUser to populate, then try cloud
    let tries = 0;
    while (!window.fbUser && tries < 20) {
      await new Promise(r => setTimeout(r, 150));
      tries++;
    }
    if (window.fbUser) {
      const cloudEvents = await fetchFromCloud();
      if (cloudEvents != null) {
        saveLocal(cloudEvents);
        notifyDownstream();
      }
    }
  }

  // ── Hook into projector tab switch ─────────────────────
  function installHook() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__evtHooked) return false;
    const wrapped = function (name) {
      const out = orig.apply(this, arguments);
      if (name === 'projector') {
        requestAnimationFrame(() => { try { render(); } catch (e) { /* swallow */ } });
      }
      return out;
    };
    Object.assign(wrapped, orig);
    wrapped.__evtHooked = true;
    window.switchTab = wrapped;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    if (!installHook()) {
      let tries = 0;
      const t = setInterval(() => {
        if (installHook() || ++tries > 40) clearInterval(t);
      }, 100);
    }
    if (window.TitrationUtils && window.TitrationUtils.registerProjectorRenderer) {
      window.TitrationUtils.registerProjectorRenderer(render);
    }
  });
})();

// ── Collapse toggle (global — matches toggleMilestones/toggleBMI pattern) ──
function toggleContextEvents() {
  const content = document.getElementById('events-content');
  const chevron = document.getElementById('events-chevron');
  const toggle  = document.getElementById('events-toggle');
  const isOpen  = toggle.getAttribute('aria-expanded') === 'true';
  content.style.display = isOpen ? 'none' : '';
  toggle.setAttribute('aria-expanded', !isOpen);
  chevron.classList.toggle('closed', isOpen);
}
