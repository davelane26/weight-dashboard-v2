/* health.js — Doctor Visit, Health Metrics & AI Analysis tab */

const _HEALTH_KEY         = 'wt_v2_health_data';
const _HEALTH_METRIC_KEYS = ['weight', 'bp', 'a1c', 'cholesterol', 'drnotes'];

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

// ── Init ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  healthLoad();
  document.querySelectorAll('.hm-status-select').forEach(sel => {
    sel.addEventListener('change', () => { _healthStyleBadge(sel); healthSave(); });
  });
  const uploadBtn   = document.getElementById('health-upload-btn');
  const uploadInput = document.getElementById('health-doc-input');
  if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', function() { healthHandleUpload(this); });
  }
});

window.healthSave         = healthSave;
window.healthAnalyzeDoc   = healthAnalyzeDoc;
window.healthHandleUpload = healthHandleUpload;
