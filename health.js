/* health.js — Doctor Visit & Health Metrics tab */

const _HEALTH_KEY         = 'wt_v2_health_data';
const _HEALTH_METRIC_KEYS = ['weight', 'bp', 'a1c', 'cholesterol', 'drnotes'];

function healthSave() {
  const d = {
    visitDate:  document.getElementById('health-visit-date').value,
    visitNotes: document.getElementById('health-visit-notes').value,
    nextAppt:   document.getElementById('health-next-appt').value,
    metrics: {}
  };
  _HEALTH_METRIC_KEYS.forEach(k => {
    const v = document.getElementById('hm-' + k + '-val');
    const s = document.getElementById('hm-' + k + '-status');
    if (v && s) d.metrics[k] = { val: v.value, status: s.value };
  });
  localStorage.setItem(_HEALTH_KEY, JSON.stringify(d));
}

function healthLoad() {
  let d;
  try { d = JSON.parse(localStorage.getItem(_HEALTH_KEY) || 'null'); } catch (e) { return; }
  if (!d) return;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  setVal('health-visit-date',  d.visitDate);
  setVal('health-visit-notes', d.visitNotes);
  setVal('health-next-appt',   d.nextAppt);
  if (d.metrics) {
    _HEALTH_METRIC_KEYS.forEach(k => {
      const m = d.metrics[k];
      if (!m) return;
      setVal('hm-' + k + '-val',    m.val);
      setVal('hm-' + k + '-status', m.status);
    });
  }
  document.querySelectorAll('.hm-status-select').forEach(_healthStyleBadge);
}

function _healthStyleBadge(sel) {
  const map = {
    good:      { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    watch:     { bg: '#fef9ec', color: '#995213', border: '#fde68a' },
    attention: { bg: '#fff1f0', color: '#ea1100', border: '#fecaca' },
  };
  const c = map[sel.value] || map.good;
  Object.assign(sel.style, { background: c.bg, color: c.color, borderColor: c.border });
}

document.addEventListener('DOMContentLoaded', () => {
  healthLoad();
  document.querySelectorAll('.hm-status-select').forEach(sel => {
    sel.addEventListener('change', () => { _healthStyleBadge(sel); healthSave(); });
  });
});

window.healthSave = healthSave;
