/* ════════════════════════════════════════════════════════════════════
   workout.js — Workout tab for the health dashboard.

   David's 4-day Upper/Lower program (Wed-Sun), built for muscle
   preservation during the Mounjaro cut. Renders into #tab-workout.

   Features:
   - Auto-highlights TODAY's session based on the Wed-Sun schedule.
   - Tap-able per-exercise checkboxes, saved to localStorage.
   - Progress bars per day; checkmarks auto-reset each new week.
   - Zero dependencies, dark-mode aware. No charts, no network.
   ──────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── The program ────────────────────────────────────────────────────
  // dow = JS getDay() index (0=Sun .. 6=Sat). Sunday's session is optional.
  const PROGRAM = [
    {
      id: 'upperA', dow: 3, name: 'Upper A (Shoulder-Safe)',
      focus: 'Pull-focused - all pressing on hold for L shoulder',
      warmup: [
        '5 min easy cardio',
        'Rehab block: cable ER + serratus punch + face pull (below)',
        '1-3 lighter prep sets before rows',
      ],
      exercises: [
        { m: 'Rehab: Cable External Rotation (both sides)',   s: '3 x 15/side',     rir: 'Light - burn in rear shoulder, no pinch' },
        { m: 'Rehab: Cable Serratus Punch (both sides)',      s: '2-3 x 12-15/side', rir: 'Light - reach for the mug at end' },
        { m: 'Rehab: Face Pull (chest-height cable)',         s: '2-3 x 15-20',      rir: '2-3 RIR' },
        { m: 'Chest-Supported Machine Row (neutral grip)',    s: '4 x 8-10',         rir: '2 RIR' },
        { m: 'Neutral-grip Lat Pulldown',                     s: '3 x 10-12',        rir: '1-2 RIR' },
        { m: 'Triceps Pushdown (elbows glued to sides)',      s: '3 x 10-15',        rir: '1 RIR' },
      ],
    },
    {
      id: 'lowerA', dow: 4, name: 'Lower A',
      focus: 'Knee-aware lower body',
      warmup: ['5 min easy pain-free cardio', '1-3 lighter prep sets before squat/leg-press'],
      knee: true,
      exercises: [
        { m: 'Leg Press',                        s: '3 x 5-8', rir: '2 RIR' },
        { m: 'Back Extension (45-degree Hyper)', s: '2 x 10-15', rir: '1-2 RIR' },
        { m: 'Seated Leg Curl',                  s: '3 x 8-12', rir: '1 RIR' },
        { m: 'Standing Calf Raise',              s: '3 x 8-15', rir: '1 RIR' },
        { m: 'Machine Crunch',                   s: '3 x 10-15', rir: '1 RIR' },
      ],
    },
    {
      id: 'upperB', dow: 5, name: 'Upper B (Shoulder-Safe)',
      focus: 'Pull + rehab - all pressing on hold for L shoulder',
      warmup: [
        '5 min easy cardio',
        'Rehab block: cable ER + serratus punch + face pull (below)',
        '1-3 lighter prep sets before pulldown/row',
      ],
      exercises: [
        { m: 'Rehab: Cable External Rotation (both sides)',   s: '3 x 15/side',      rir: 'Light - burn in rear shoulder, no pinch' },
        { m: 'Rehab: Cable Serratus Punch (both sides)',      s: '2-3 x 12-15/side', rir: 'Light - reach for the mug at end' },
        { m: 'Rehab: Face Pull (chest-height cable)',         s: '2-3 x 15-20',      rir: '2-3 RIR' },
        { m: 'Neutral-grip Lat Pulldown',                     s: '3 x 8-12',         rir: '1-2 RIR' },
        { m: 'Seated Cable Row (neutral grip)',               s: '3 x 10-12',        rir: '1-2 RIR' },
        { m: 'Rear-delt Fly (thumbs-up, ~30 deg below horiz)',s: '2 x 12-20',        rir: '1-3 RIR' },
        { m: 'Machine Preacher Curl',                         s: '2 x 10-15',        rir: '1-3 RIR' },
      ],
    },
    {
      id: 'lowerB', dow: 6, name: 'Lower B',
      focus: 'Knee-aware lower body',
      warmup: ['5 min easy pain-free cardio', '1-3 lighter prep sets before leg press'],
      knee: true,
      exercises: [
        { m: 'Leg Press',                        s: '3 x 8-12', rir: '1-3 RIR' },
        { m: 'Back Extension (45-degree Hyper)', s: '3 x 10-15', rir: '1-3 RIR' },
        { m: 'Leg Extension (pain-free)',        s: '2 x 10-15', rir: '1-3 RIR' },
        { m: 'Seated Leg Curl',                  s: '2 x 10-15', rir: '1-3 RIR' },
        { m: 'Calf Raise',                       s: '3 x 10-15', rir: '1-3 RIR' },
      ],
    },
    {
      id: 'optional', dow: 0, name: 'Wing It (Sun) - Shoulder-Safe',
      focus: 'Arms only - keep elbows below shoulder height',
      exercises: [
        { m: 'Machine Preacher Curl / Cable Curl',        s: '3 x 10-12',  rir: '1-2 RIR' },
        { m: 'Triceps Pushdown (elbows tucked)',          s: '3 x 10-15',  rir: '1-2 RIR' },
        { m: 'Concentration Curl or Hammer Curl',         s: '2 x 10-15',  rir: '1 RIR' },
        { m: 'Cable Reverse Pushdown (rope)',             s: '2 x 12-15',  rir: '1 RIR' },
        { m: 'SKIP: Overhead tricep extension (bad angle)', s: '--',       rir: 'Do NOT do' },
        { m: 'OR longer incline walk / full rest',        s: '20-40 min',  rir: 'Easy' },
      ],
    },
  ];

  const KNEE_RULE = 'Knee rule: use a pain-free range & controlled tempo. Skip or swap any movement that aggravates the knee.';

  // Every lifting day finishes with the incline walk.
  const WALK = '15-20 min incline walk after lifting (skip before leg day).';

  const DOW_LABEL = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  const DOW_FULL  = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

  // ── Week-scoped localStorage key (auto-resets each new week) ─────────
  function weekKey() {
    const d = new Date();
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return 'wt_v2_workout_' + d.getFullYear() + '_w' + week;
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(weekKey()) || '{}'); }
    catch (e) { return {}; }
  }
  function saveState(state) {
    localStorage.setItem(weekKey(), JSON.stringify(state));
  }

  // ── Schedule overrides — lets the user move each session to a different
  //    day of the week instead of the hardcoded Wed-Sun layout. Persists
  //    across weeks (unlike the checkbox state above). ──────────────────
  const SCHEDULE_KEY = 'wt_v2_workout_schedule';
  function loadSchedule() {
    try { return JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveSchedule(map) {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(map));
  }
  function dowOf(day) {
    const overrides = loadSchedule();
    const v = overrides[day.id];
    return (v === 0 || v) ? v : day.dow;
  }

  // ── Cloud sync (Cloudflare Worker, Firebase-token gated) ─────────────
  // Same pattern as photos.js: local write is instant and always works;
  // the cloud push is best-effort so the schedule follows you to other
  // signed-in devices too. Silently no-ops if signed out or offline.
  const SCHEDULE_WORKER_URL = window.HEALTH_WORKER_URL || '';
  let scheduleSyncNote = '';

  async function _woAuthHeaders() {
    if (!window.fbUser || typeof window.fbUser.getIdToken !== 'function') return null;
    const token = await window.fbUser.getIdToken();
    return { Authorization: 'Bearer ' + token };
  }

  async function pushScheduleToCloud(map) {
    if (!SCHEDULE_WORKER_URL) return false;
    const auth = await _woAuthHeaders();
    if (!auth) return false;
    try {
      const resp = await fetch(SCHEDULE_WORKER_URL + '/workout-schedule', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: map }),
      });
      return resp.ok;
    } catch (e) { return false; }
  }

  // Pulls the cloud schedule on load. If the cloud already has a schedule
  // (set from another device), it wins and overwrites local. If the cloud
  // is empty but this device has local overrides, seed the cloud from
  // those instead — so the first signed-in device "wins" on first sync.
  async function syncScheduleFromCloud() {
    if (!SCHEDULE_WORKER_URL) return;
    const auth = await _woAuthHeaders();
    if (!auth) return;
    try {
      const resp = await fetch(SCHEDULE_WORKER_URL + '/workout-schedule', { headers: auth });
      if (!resp.ok) return; // 404 = worker not deployed yet, etc — local still works
      const body = await resp.json();
      const cloud = (body && typeof body.schedule === 'object' && body.schedule) || {};
      if (Object.keys(cloud).length) {
        saveSchedule(cloud);
        render();
      } else {
        const local = loadSchedule();
        if (Object.keys(local).length) await pushScheduleToCloud(local);
      }
    } catch (e) { /* offline — local-only still works */ }
  }

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── One-time style injection (dark-mode aware) ──────────────────────
  function injectStyles() {
    if (document.getElementById('workout-styles')) return;
    const css = `
      #tab-workout { padding: 0.5rem 0 4rem; }
      .wo-hero { background: linear-gradient(135deg,#0053e2,#2563eb); color:#fff;
        border-radius:14px; padding:1.1rem 1.25rem; margin:0 0 1rem; }
      .wo-hero .lbl { font-size:.66rem; font-weight:700; letter-spacing:.09em;
        text-transform:uppercase; opacity:.85; }
      .wo-hero .today { font-size:1.5rem; font-weight:800; margin:.15rem 0 .1rem; }
      .wo-hero .sub { font-size:.85rem; opacity:.9; }
      .wo-edit-days-btn { margin-top:.6rem; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.35);
        color:#fff; font-size:.75rem; font-weight:600; border-radius:8px; padding:.35rem .7rem; cursor:pointer; }
      .wo-edit-days-btn:hover { background:rgba(255,255,255,.28); }
      .wo-sync-note { font-size:.72rem; opacity:.85; margin-top:.4rem; }
      .wo-edit-panel { background:#fff; border:1.5px solid #d0d5e8; border-radius:12px;
        padding:.9rem 1rem; margin:0 0 1rem; }
      .wo-edit-hint { font-size:.78rem; color:#6d7a95; margin-bottom:.7rem; }
      .wo-edit-row { display:flex; align-items:center; justify-content:space-between;
        gap:.75rem; padding:.4rem 0; border-top:1px solid #eef1f8; }
      .wo-edit-row:first-of-type { border-top:none; }
      .wo-edit-name { font-size:.85rem; font-weight:600; color:#1a2340; }
      .wo-edit-row select { font-size:.85rem; padding:.3rem .5rem; border-radius:7px;
        border:1px solid #d0d5e8; background:#fff; color:#1a2340; }
      .wo-edit-actions { display:flex; gap:.5rem; margin-top:.85rem; flex-wrap:wrap; }
      .wo-edit-actions button { font-size:.78rem; font-weight:600; border-radius:8px;
        padding:.4rem .75rem; cursor:pointer; border:1px solid #d0d5e8; background:#fff; color:#1a2340; }
      .wo-edit-save { background:#0053e2 !important; border-color:#0053e2 !important; color:#fff !important; }
      .wo-edit-defaults:hover { border-color:#ef4444; color:#ef4444; }
      .wo-rules { display:flex; gap:.6rem; flex-wrap:wrap; margin:0 0 1.1rem; }
      .wo-rule { flex:1; min-width:180px; background:#fff7ed; border:1.5px solid #fdba74;
        border-radius:10px; padding:.7rem .85rem; }
      .wo-rule b { display:block; font-size:.7rem; text-transform:uppercase;
        letter-spacing:.06em; color:#9a3412; margin-bottom:.2rem; }
      .wo-rule span { font-size:.82rem; color:#7c2d12; }
      .wo-day { border:1.5px solid #d0d5e8; border-radius:12px; margin:0 0 .9rem;
        overflow:hidden; background:#fff; }
      .wo-day.is-today { border-color:#0053e2; box-shadow:0 0 0 2px rgba(0,83,226,.15); }
      .wo-day-head { display:flex; align-items:center; gap:.6rem; padding:.75rem .95rem;
        cursor:pointer; user-select:none; }
      .wo-badge { font-size:.6rem; font-weight:800; letter-spacing:.06em; padding:.15rem .45rem;
        border-radius:6px; text-transform:uppercase; }
      .wo-badge.today { background:#0053e2; color:#fff; }
      .wo-badge.dow { background:#eef2ff; color:#3730a3; }
      .wo-day-title { font-size:1rem; font-weight:800; color:#1a2340; }
      .wo-day-focus { font-size:.75rem; color:#6d7a95; }
      .wo-prog { margin-left:auto; text-align:right; min-width:74px; }
      .wo-prog .num { font-size:.72rem; font-weight:700; color:#6d7a95; }
      .wo-bar { height:6px; border-radius:4px; background:#e5e9f5; overflow:hidden; margin-top:.25rem; }
      .wo-bar i { display:block; height:100%; background:#16a34a; width:0; transition:width .2s; }
      .wo-caret { font-size:.8rem; color:#9aa4bf; transition:transform .2s; }
      .wo-day.open .wo-caret { transform:rotate(90deg); }
      .wo-ex-list { display:none; padding:.25rem .55rem .7rem; }
      .wo-day.open .wo-ex-list { display:block; }
      .wo-ex { display:flex; align-items:center; gap:.7rem; padding:.55rem .5rem;
        border-top:1px solid #eef1f8; }
      .wo-ex:first-child { border-top:none; }
      .wo-ex label { display:flex; align-items:center; gap:.7rem; cursor:pointer; flex:1; }
      .wo-ex input { width:22px; height:22px; accent-color:#16a34a; flex:none; cursor:pointer; }
      .wo-ex .m { font-size:.86rem; font-weight:600; color:#1a2340; }
      .wo-ex.done .m { text-decoration:line-through; color:#9aa4bf; }
      .wo-ex .meta { font-size:.72rem; color:#6d7a95; white-space:nowrap; }
      .wo-walk { font-size:.75rem; color:#0053e2; padding:.55rem .55rem .1rem; font-weight:600; }
      .wo-reset { background:none; border:1px solid #d0d5e8; color:#6d7a95; font-size:.7rem;
        border-radius:7px; padding:.3rem .6rem; cursor:pointer; margin:.5rem .55rem 0; }
      .wo-reset:hover { border-color:#ef4444; color:#ef4444; }
      /* dark mode */
      #root.dark .wo-edit-panel { background:#1a2236; border-color:#2c3550; }
      #root.dark .wo-edit-hint { color:#9aa4bf; }
      #root.dark .wo-edit-row { border-color:#252d44; }
      #root.dark .wo-edit-name { color:#e6ebf5; }
      #root.dark .wo-edit-row select { background:#1a2236; border-color:#2c3550; color:#e6ebf5; }
      #root.dark .wo-edit-actions button { background:#1a2236; border-color:#2c3550; color:#e6ebf5; }
      #root.dark .wo-edit-save { background:#0053e2 !important; border-color:#0053e2 !important; color:#fff !important; }
      #root.dark .wo-rule { background:#3a2a12; border-color:#a86a2a; }
      #root.dark .wo-rule b { color:#fdba74; }
      #root.dark .wo-rule span { color:#f5d0a9; }
      #root.dark .wo-day { background:#1a2236; border-color:#2c3550; }
      #root.dark .wo-day-title { color:#e6ebf5; }
      #root.dark .wo-badge.dow { background:#28304a; color:#a5b4fc; }
      #root.dark .wo-ex { border-color:#252d44; }
      #root.dark .wo-ex .m { color:#e6ebf5; }
      #root.dark .wo-bar { background:#2c3550; }
    `;
    const style = document.createElement('style');
    style.id = 'workout-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Render ──────────────────────────────────────────────────────────
  function render() {
    const panel = document.getElementById('tab-workout');
    if (!panel) return;
    injectStyles();

    const state = loadState();
    const todayDow = new Date().getDay();
    const todayDay = PROGRAM.find(d => dowOf(d) === todayDow);
    const isRestDay = !todayDay;         // days with no session assigned = rest

    const firstDay = PROGRAM.slice().sort((a, b) => {
      const da = dowOf(a), db = dowOf(b);
      return ((da - todayDow + 7) % 7) - ((db - todayDow + 7) % 7);
    })[0];

    const heroToday = isRestDay
      ? 'Rest day'
      : todayDay.name + ' - ' + todayDay.focus;
    const heroSub = isRestDay
      ? `Recover, hit your protein, easy walk if you like. Next up: ${esc(firstDay.name)} (${DOW_FULL[dowOf(firstDay)]}).`
      : (todayDay.id === 'optional'
          ? 'Optional day - train if fresh, otherwise walk or rest.'
          : WALK);

    const daySelectOptions = sel => [0, 1, 2, 3, 4, 5, 6].map(
      d => `<option value="${d}"${d === sel ? ' selected' : ''}>${DOW_FULL[d]}</option>`
    ).join('');

    const editRows = PROGRAM.map(day => `
      <div class="wo-edit-row">
        <span class="wo-edit-name">${esc(day.name)}</span>
        <select data-schedule="${day.id}">${daySelectOptions(dowOf(day))}</select>
      </div>`).join('');

    const editPanelHtml = `
      <div class="wo-edit-inner">
        <div class="wo-edit-hint">Move each session to whatever day fits your week. Changes are saved on this device.</div>
        ${editRows}
        <div class="wo-edit-actions">
          <button class="wo-edit-save" type="button">Save</button>
          <button class="wo-edit-defaults" type="button">Reset to default</button>
          <button class="wo-edit-cancel" type="button">Cancel</button>
        </div>
      </div>`;

    let html = `
      <div class="wo-hero">
        <div class="lbl">Today</div>
        <div class="today">${esc(heroToday)}</div>
        <div class="sub">${esc(heroSub)}</div>
        <button class="wo-edit-days-btn" type="button">&#9998; Edit schedule</button>
        ${scheduleSyncNote ? `<div class="wo-sync-note">${esc(scheduleSyncNote)}</div>` : ''}
      </div>
      <div id="wo-edit-panel" class="wo-edit-panel" hidden>${editPanelHtml}</div>
      <div class="wo-rules">
        <div class="wo-rule"><b>SHOULDER MOD ACTIVE</b><span>L shoulder impingement. No pressing, no laterals, no overhead. Rehab warm-up on Wed &amp; Fri. See PT this week.</span></div>
        <div class="wo-rule"><b>Protein first</b><span>~175-215 g/day. Front-load it early - Mounjaro fills you up fast.</span></div>
        <div class="wo-rule"><b>Keep it heavy (below-neck lifts)</b><span>Rows and lower body: maintain loads. Rehab work: stay LIGHT, form over weight.</span></div>
      </div>
    `;

    PROGRAM.forEach(day => {
      const dayDow = dowOf(day);
      const isToday = dayDow === todayDow;
      const done = day.exercises.filter(
        (_, i) => state[day.id + ':' + i]).length;
      const total = day.exercises.length;
      const pct = Math.round((done / total) * 100);

      let exHtml = '';
      day.exercises.forEach((ex, i) => {
        const key = day.id + ':' + i;
        const checked = !!state[key];
        exHtml += `
          <div class="wo-ex${checked ? ' done' : ''}">
            <label>
              <input type="checkbox" data-key="${key}"${checked ? ' checked' : ''}>
              <span class="m">${esc(ex.m)}</span>
            </label>
            <span class="meta">${esc(ex.s)} &middot; ${esc(ex.rir)}</span>
          </div>`;
      });

      const walkLine = (day.id === 'optional')
        ? ''
        : `<div class="wo-walk">Finish: ${esc(WALK)}</div>`;

      const warmupHtml = (day.warmup && day.warmup.length)
        ? `<div class="wo-warmup"><b>Warm-up</b>${
            day.warmup.map(w => `<span>&bull; ${esc(w)}</span>`).join('')}</div>`
        : '';

      const kneeHtml = day.knee
        ? `<div class="wo-knee">${esc(KNEE_RULE)}</div>`
        : '';

      html += `
        <div class="wo-day${isToday ? ' is-today open' : ''}" data-day="${day.id}">
          <div class="wo-day-head">
            <span class="wo-badge ${isToday ? 'today' : 'dow'}">${isToday ? 'TODAY' : DOW_LABEL[dayDow]}</span>
            <div>
              <div class="wo-day-title">${esc(day.name)}</div>
              <div class="wo-day-focus">${esc(day.focus)}</div>
            </div>
            <div class="wo-prog">
              <div class="num">${done}/${total}</div>
              <div class="wo-bar"><i style="width:${pct}%"></i></div>
            </div>
            <span class="wo-caret">&#9656;</span>
          </div>
          <div class="wo-ex-list">
            ${warmupHtml}
            ${exHtml}
            ${kneeHtml}
            ${walkLine}
            <button class="wo-reset" data-reset="${day.id}">Reset this day</button>
          </div>
        </div>`;
    });

    panel.innerHTML = html;
    wire(panel);
  }

  // ── Event wiring ────────────────────────────────────────────────────
  function wire(panel) {
    // Toggle expand/collapse on header click
    panel.querySelectorAll('.wo-day-head').forEach(head => {
      head.addEventListener('click', () => {
        head.parentElement.classList.toggle('open');
      });
    });

    // Checkbox toggles (stopPropagation so clicking doesn't collapse card)
    panel.querySelectorAll('.wo-ex input').forEach(box => {
      box.addEventListener('click', e => e.stopPropagation());
      box.addEventListener('change', () => {
        const state = loadState();
        if (box.checked) state[box.dataset.key] = 1;
        else delete state[box.dataset.key];
        saveState(state);
        render();
      });
    });

    // Per-day reset
    panel.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.reset;
        const state = loadState();
        Object.keys(state).forEach(k => {
          if (k.indexOf(id + ':') === 0) delete state[k];
        });
        saveState(state);
        render();
      });
    });

    // ── Edit-schedule panel ─────────────────────────────────────────────
    const editPanel = panel.querySelector('#wo-edit-panel');
    const editBtn = panel.querySelector('.wo-edit-days-btn');
    if (editBtn && editPanel) {
      editBtn.addEventListener('click', () => {
        editPanel.hidden = !editPanel.hidden;
      });
    }
    const saveBtn = panel.querySelector('.wo-edit-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const map = {};
        panel.querySelectorAll('[data-schedule]').forEach(sel => {
          map[sel.dataset.schedule] = parseInt(sel.value, 10);
        });
        saveSchedule(map);                       // local save is instant
        saveBtn.disabled = true;
        const ok = await pushScheduleToCloud(map);
        scheduleSyncNote = ok ? 'Synced across devices' : 'Saved on this device only';
        render();
      });
    }
    const defaultsBtn = panel.querySelector('.wo-edit-defaults');
    if (defaultsBtn) {
      defaultsBtn.addEventListener('click', async () => {
        localStorage.removeItem(SCHEDULE_KEY);
        defaultsBtn.disabled = true;
        const ok = await pushScheduleToCloud({});  // clear cloud too, so it resets everywhere
        scheduleSyncNote = ok ? 'Reset everywhere' : 'Reset on this device only';
        render();
      });
    }
    const cancelBtn = panel.querySelector('.wo-edit-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (editPanel) editPanel.hidden = true;
      });
    }
  }

  // ── Boot ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Pull the schedule from the cloud once we know who's signed in.
  // Auth resolves asynchronously (Firebase), so wait for it if it hasn't
  // fired yet — mirrors the pattern used in photos.js.
  if (window.fbUser) {
    syncScheduleFromCloud();
  } else {
    document.addEventListener('firebase-auth-changed', e => {
      if (e.detail && e.detail.user) syncScheduleFromCloud();
    }, { once: true });
  }

  // Expose for switchTab() if it ever wants to force a refresh.
  window.renderWorkout = render;
})();
