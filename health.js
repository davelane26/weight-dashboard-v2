/* health.js — Doctor Visit, Health Metrics & AI Analysis tab */

const _HEALTH_KEY         = 'wt_v2_health_data';
const _HEALTH_VISITS_KEY  = 'wt_v2_health_visits';
const _HEALTH_METRIC_KEYS = ['weight', 'bp', 'a1c', 'cholesterol', 'drnotes'];
const _HEALTH_METRIC_LABELS = {
  weight: 'Weight', bp: 'Blood Pressure', a1c: 'A1C',
  cholesterol: 'Cholesterol', drnotes: 'Dr. Notes'
};

let _healthImagePayload = null;

// ── Form persistence ─────────────────────────────────────────────────

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
  const prev = _healthData();
  if (prev && prev.lastAnalysis) d.lastAnalysis = prev.lastAnalysis;
  localStorage.setItem(_HEALTH_KEY, JSON.stringify(d));
}

function healthLoad() {
  const d = _healthData();
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
  if (d.lastAnalysis) _healthRenderAnalysis(d.lastAnalysis.text, d.lastAnalysis.date);
}

function _healthData() {
  try { return JSON.parse(localStorage.getItem(_HEALTH_KEY) || 'null'); } catch (e) { return null; }
}

// ── Status badge styling ─────────────────────────────────────────────

function _healthStyleBadge(sel) {
  const map = {
    good:      { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    watch:     { bg: '#fef9ec', color: '#995213', border: '#fde68a' },
    attention: { bg: '#fff1f0', color: '#ea1100', border: '#fecaca' },
  };
  const c = map[sel.value] || map.good;
  Object.assign(sel.style, { background: c.bg, color: c.color, borderColor: c.border });
}

// ── File upload ──────────────────────────────────────────────────────

function healthHandleUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  _healthImagePayload = null;
  const nameEl = document.getElementById('health-upload-name');
  if (nameEl) { nameEl.textContent = file.name; nameEl.style.display = 'inline'; }
  const ta = document.getElementById('health-doc-paste');
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      const b64 = e.target.result.split(',')[1];
      _healthImagePayload = { media_type: file.type, data: b64 };
      if (ta) ta.value = '[Image: ' + file.name + ' — will be analyzed by Claude]';
    };
    reader.readAsDataURL(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => { if (ta) ta.value = e.target.result; };
    reader.readAsText(file);
  }
}

// ── AI analysis ──────────────────────────────────────────────────────

async function healthAnalyzeDoc() {
  const workerUrl = window.AI_HEALTH_WORKER_URL;
  if (!workerUrl) { alert('AI Health Worker URL not configured.'); return; }
  const ta      = document.getElementById('health-doc-paste');
  const docText = ta ? ta.value.trim() : '';
  if (!docText && !_healthImagePayload) {
    alert('Please upload a file or paste your health summary first.');
    return;
  }
  const btn = document.getElementById('health-analyze-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  const body = _healthImagePayload
    ? { type: 'image', content: _healthImagePayload.data, mediaType: _healthImagePayload.media_type }
    : { type: 'text',  content: docText };
  try {
    const resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const dateStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    _healthRenderAnalysis(data.analysis, dateStr);
    if (data.metrics) _healthFillMetrics(data.metrics);
    const d = _healthData() || {};
    d.lastAnalysis = { text: data.analysis, date: dateStr };
    localStorage.setItem(_HEALTH_KEY, JSON.stringify(d));
  } catch (err) {
    alert('Analysis failed: ' + err.message + '\n\nMake sure the ANTHROPIC_API_KEY secret is set on your Cloudflare Worker.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze My Health'; }
  }
}

// ── Rendering ────────────────────────────────────────────────────────

function _healthRenderAnalysis(text, dateStr) {
  const wrap   = document.getElementById('health-analysis-wrap');
  const textEl = document.getElementById('health-analysis-text');
  const dateEl = document.getElementById('health-analysis-date');
  if (!wrap || !textEl) return;
  textEl.innerHTML = _healthMarkdown(text);
  if (dateEl) dateEl.textContent = 'Analyzed ' + dateStr;
  wrap.style.display = 'block';
}

function _healthMarkdown(raw) {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<p style="font-size:0.9rem;font-weight:800;color:#7c3aed;margin:1rem 0 0.3rem">$1</p>')
    .replace(/^[-*] (.+)$/gm, '<div style="margin:0.2rem 0 0.2rem 0.75rem">&bull; $1</div>')
    .replace(/\n\n/g, '<br><br>').replace(/\n/g, ' ');
}


function _healthFillMetrics(metrics) {
  const fieldMap = { weight: 'weight', bp: 'bp', a1c: 'a1c', cholesterol: 'cholesterol', drnotes: 'drnotes' };
  Object.entries(fieldMap).forEach(([key, field]) => {
    if (metrics[key] != null) {
      const el = document.getElementById('hm-' + field + '-val');
      if (el) el.value = metrics[key];
    }
  });
  healthSave();
}
function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Visit history ────────────────────────────────────────────────────

function _healthVisits() {
  try { return JSON.parse(localStorage.getItem(_HEALTH_VISITS_KEY) || '[]'); } catch (e) { return []; }
}

function _healthVisitsSave(visits) {
  localStorage.setItem(_HEALTH_VISITS_KEY, JSON.stringify(visits));
}

function healthSaveVisit() {
  const labelEl = document.getElementById('health-visit-label');
  const label   = labelEl ? labelEl.value.trim() : '';
  // Read directly from DOM to capture current form state regardless of
  // whether oninput/healthSave() has fired since page load.
  const getV = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const metrics = {};
  _HEALTH_METRIC_KEYS.forEach(k => {
    const v = document.getElementById('hm-' + k + '-val');
    const s = document.getElementById('hm-' + k + '-status');
    if (v && s) metrics[k] = { val: v.value, status: s.value };
  });
  const visitDate = getV('health-visit-date');
  const d = _healthData() || {};
  const visit = {
    id:         Date.now(),
    savedAt:    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    label:      label || visitDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    visitDate,
    visitNotes: getV('health-visit-notes'),
    nextAppt:   getV('health-next-appt'),
    metrics,
    analysis:   d.lastAnalysis || null,
  };
  const visits = _healthVisits();
  visits.push(visit);
  _healthVisitsSave(visits);
  if (labelEl) labelEl.value = '';
  healthRenderVisitHistory();
}

function healthDeleteVisit(id) {
  if (!confirm('Delete this saved visit?')) return;
  const visits = _healthVisits().filter(v => v.id !== id);
  _healthVisitsSave(visits);
  healthRenderVisitHistory();
  const wrap = document.getElementById('health-compare-wrap');
  if (wrap) wrap.style.display = 'none';
}

function healthUpdateVisit(id) {
  const visits = _healthVisits();
  const idx = visits.findIndex(v => v.id === id);
  if (idx === -1) return;
  const getV = elId => { const el = document.getElementById(elId); return el ? el.value : ""; };
  const metrics = {};
  _HEALTH_METRIC_KEYS.forEach(k => {
    const v = document.getElementById("hm-" + k + "-val");
    const s = document.getElementById("hm-" + k + "-status");
    if (v && s) metrics[k] = { val: v.value, status: s.value };
  });
  const d = _healthData() || {};
  visits[idx] = Object.assign({}, visits[idx], {
    visitDate:  getV("health-visit-date"),
    visitNotes: getV("health-visit-notes"),
    nextAppt:   getV("health-next-appt"),
    metrics,
    analysis: d.lastAnalysis || visits[idx].analysis,
  });
  _healthVisitsSave(visits);
  healthRenderVisitHistory();
}

function healthLoadVisit(id) {
  const visit = _healthVisits().find(v => v.id === id);
  if (!visit) return;
  const setVal = (elId, v) => { const el = document.getElementById(elId); if (el && v != null) el.value = v; };
  setVal('health-visit-date',  visit.visitDate);
  setVal('health-visit-notes', visit.visitNotes);
  setVal('health-next-appt',   visit.nextAppt);
  if (visit.metrics) {
    _HEALTH_METRIC_KEYS.forEach(k => {
      const m = visit.metrics[k];
      if (!m) return;
      setVal('hm-' + k + '-val',    m.val);
      setVal('hm-' + k + '-status', m.status);
    });
  }
  document.querySelectorAll('.hm-status-select').forEach(_healthStyleBadge);
  if (visit.analysis) _healthRenderAnalysis(visit.analysis.text, visit.analysis.date);
  healthSave();
}

function healthRenderVisitHistory() {
  const container = document.getElementById('health-visits-list');
  const selA = document.getElementById('health-compare-a');
  const selB = document.getElementById('health-compare-b');
  if (!container) return;
  const visits = _healthVisits();
  const emptyMsg = '<p style="font-size:0.8rem;color:#6d7a95;text-align:center;padding:1rem 0">No saved visits yet. Fill in your metrics and click Save This Visit.</p>';
  if (visits.length === 0) {
    container.innerHTML = emptyMsg;
    if (selA) selA.innerHTML = '<option value="">-- pick a visit --</option>';
    if (selB) selB.innerHTML = '<option value="">-- pick a visit --</option>';
    return;
  }
  const sorted = [...visits].sort((a, b) => b.id - a.id);
  const bgOf  = s => ({ good: '#dcfce7', watch: '#fef9ec', attention: '#fff1f0' }[s] || '#f8f9ff');
  const colOf = s => ({ good: '#166534', watch: '#995213', attention: '#ea1100' }[s] || '#1a2340');
  const bdrOf = s => ({ good: '#86efac', watch: '#fde68a', attention: '#fecaca' }[s] || '#d0d5e8');
  container.innerHTML = sorted.map(v => {
    const badges = _HEALTH_METRIC_KEYS
      .filter(k => v.metrics && v.metrics[k] && v.metrics[k].val)
      .map(k => {
        const m = v.metrics[k];
        return '<span style="font-size:0.65rem;font-weight:700;padding:0.15rem 0.45rem;border-radius:10px;border:1px solid ' + bdrOf(m.status) + ';background:' + bgOf(m.status) + ';color:' + colOf(m.status) + '">' + _HEALTH_METRIC_LABELS[k] + '</span>';
      }).join(' ');
    return '<div style="padding:0.8rem 0;border-bottom:1px solid #e5e9f5">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem">' +
      '<span style="font-size:0.88rem;font-weight:700;color:#1a2340">' + _esc(v.label) + '</span>' +
      '<span style="font-size:0.65rem;color:#6d7a95">Saved ' + _esc(v.savedAt) + '</span></div>' +
      (badges ? '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.5rem">' + badges + '</div>' : '') +
      '<div style="display:flex;gap:0.5rem">' +
      '<button onclick="healthLoadVisit(' + v.id + ')" class="btn-secondary" style="font-size:0.72rem;padding:0.3rem 0.7rem">Load</button>' +
      '<button onclick="healthUpdateVisit(' + v.id + ')" class="btn-secondary" style="font-size:0.72rem;padding:0.3rem 0.7rem;color:#0053e2;border-color:#bfdbfe">Update</button>' +
      '<button onclick="healthDeleteVisit(' + v.id + ')" class="btn-secondary" style="font-size:0.72rem;padding:0.3rem 0.7rem;color:#ea1100;border-color:#fecaca">Delete</button>' +
      '</div></div>';
  }).join('');
  const opts = sorted.map(v => '<option value="' + v.id + '">' + _esc(v.label) + ' (' + _esc(v.savedAt) + ')</option>').join('');
  const empty = '<option value="">-- pick a visit --</option>';
  if (selA) selA.innerHTML = empty + opts;
  if (selB) selB.innerHTML = empty + opts;
}

// ── Visit comparison ─────────────────────────────────────────────────

function healthCompare() {
  const idA = parseInt(document.getElementById('health-compare-a').value, 10);
  const idB = parseInt(document.getElementById('health-compare-b').value, 10);
  if (!idA || !idB || idA === idB) { alert('Please select two different visits to compare.'); return; }
  const visits = _healthVisits();
  let vA = visits.find(v => v.id === idA);
  let vB = visits.find(v => v.id === idB);
  if (!vA || !vB) return;
  if (vA.id > vB.id) { const tmp = vA; vA = vB; vB = tmp; }

  const score = { good: 0, watch: 1, attention: 2 };
  const bgOf  = s => ({ good: "#dcfce7", watch: "#fef9ec", attention: "#fff1f0" }[s] || "#f8f9ff");
  const colOf = s => ({ good: "#166534", watch: "#995213", attention: "#ea1100" }[s] || "#1a2340");
  const bdrOf = s => ({ good: "#86efac", watch: "#fde68a", attention: "#fecaca" }[s] || "#d0d5e8");
  const lowerBetter = { weight: true, bp: true, a1c: true, cholesterol: true, drnotes: false };
  const parseNum = str => { const m = String(str||"").match(/[0-9.]+/); return m ? parseFloat(m[0]) : null; };

  const rows = _HEALTH_METRIC_KEYS.map(k => {
    const mA = (vA.metrics && vA.metrics[k]) || { val: "", status: "good" };
    const mB = (vB.metrics && vB.metrics[k]) || { val: "", status: "good" };
    if (!mA.val && !mB.val) return null;
    const sA = score[mA.status] ?? 0;
    const sB = score[mB.status] ?? 0;
    let arrow, arrowColor, verdict;
    if (sB < sA) {
      arrow = "&#8593;"; arrowColor = "#16a34a"; verdict = "Better";
    } else if (sB > sA) {
      arrow = "&#8595;"; arrowColor = "#ea1100"; verdict = "Worse";
    } else if (mA.val !== mB.val) {
      const nA = parseNum(mA.val), nB = parseNum(mB.val);
      if (nA !== null && nB !== null && nA !== nB) {
        const improved = lowerBetter[k] ? nB < nA : nB > nA;
        arrow = improved ? "&#8593;" : "&#8595;";
        arrowColor = improved ? "#16a34a" : "#ea1100";
        verdict = improved ? "Better" : "Worse";
      } else { arrow = "&#8646;"; arrowColor = "#6d7a95"; verdict = "Changed"; }
    } else { arrow = "&#8594;"; arrowColor = "#6d7a95"; verdict = "Same"; }
    const badgeA = '<span style="font-size:0.75rem;font-weight:700;padding:0.2rem 0.55rem;border-radius:10px;background:' + bgOf(mA.status) + ';color:' + colOf(mA.status) + ';border:1px solid ' + bdrOf(mA.status) + '">' + _esc(mA.val || '—') + '</span>';
    const badgeB = '<span style="font-size:0.75rem;font-weight:700;padding:0.2rem 0.55rem;border-radius:10px;background:' + bgOf(mB.status) + ';color:' + colOf(mB.status) + ';border:1px solid ' + bdrOf(mB.status) + '">' + _esc(mB.val || '—') + '</span>';
    return '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0;border-bottom:1px solid #d1fae5;flex-wrap:wrap">' +
      '<span style="width:90px;font-size:0.68rem;font-weight:700;color:#6d7a95;text-transform:uppercase;flex-shrink:0">' + _HEALTH_METRIC_LABELS[k] + '</span>' +
      badgeA +
      '<span style="font-size:1.1rem;font-weight:800;color:' + arrowColor + ';flex-shrink:0">' + arrow + '</span>' +
      badgeB +
      '<span style="font-size:0.72rem;font-weight:700;color:' + arrowColor + '">' + verdict + '</span>' +
      '</div>';
  }).filter(Boolean);

  const rowsHtml = rows.length
    ? rows.join('')
    : '<p style="font-size:0.8rem;color:#6d7a95">No metric values were recorded for these visits. Make sure to fill in the Key Metrics fields before saving a visit.</p>';

  const html =
    '<div style="font-size:0.75rem;color:#166534;margin-bottom:0.85rem;line-height:1.5">' +
    '<strong>' + _esc(vA.label) + '</strong> <span style="color:#6d7a95">(' + _esc(vA.savedAt) + ')</span>' +
    ' &rarr; <strong>' + _esc(vB.label) + '</strong> <span style="color:#6d7a95">(' + _esc(vB.savedAt) + ')</span>' +
    '</div>' + rowsHtml;

  const wrap    = document.getElementById('health-compare-wrap');
  const content = document.getElementById('health-compare-content');
  if (content) content.innerHTML = html;
  if (wrap) { wrap.style.display = 'block'; wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// ── Init ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  healthLoad();
  healthRenderVisitHistory();
  document.querySelectorAll('.hm-status-select').forEach(sel => {
    sel.addEventListener('change', () => { _healthStyleBadge(sel); healthSave(); });
  });
  const uploadBtn   = document.getElementById('health-upload-btn');
  const uploadInput = document.getElementById('health-doc-input');
  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', function() { healthHandleUpload(this); });
  }
  const saveVisitBtn = document.getElementById('health-save-visit-btn');
  if (saveVisitBtn) saveVisitBtn.addEventListener('click', healthSaveVisit);
  const compareBtn = document.getElementById('health-compare-btn');
  if (compareBtn) compareBtn.addEventListener('click', healthCompare);
});

window.healthSave               = healthSave;
window.healthAnalyzeDoc         = healthAnalyzeDoc;
window.healthHandleUpload       = healthHandleUpload;
window.healthLoadVisit          = healthLoadVisit;
window.healthDeleteVisit        = healthDeleteVisit;
window.healthUpdateVisit        = healthUpdateVisit;
window.healthSaveVisit          = healthSaveVisit;
window.healthCompare            = healthCompare;
window.healthRenderVisitHistory = healthRenderVisitHistory;
