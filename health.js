/* health.js — Doctor Visit, Health Metrics & AI Analysis tab */

const _HEALTH_KEY         = 'wt_v2_health_data';
const _HEALTH_API_KEY_LOC = 'wt_v2_health_api_key';
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

// ── API key ──────────────────────────────────────────────────────────

function healthSaveApiKey() {
  const keyEl = document.getElementById('health-api-key-input');
  const key   = (keyEl && keyEl.value || '').trim();
  if (!key) return;
  localStorage.setItem(_HEALTH_API_KEY_LOC, key);
  keyEl.value = '';
  const st = document.getElementById('health-api-key-status');
  if (st) st.style.display = 'block';
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
      if (ta) ta.value = '[Image: ' + file.name + ' — will be sent to Claude for visual analysis]';
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
  const apiKey = localStorage.getItem(_HEALTH_API_KEY_LOC);
  if (!apiKey) {
    const det = document.getElementById('health-api-settings');
    if (det) det.open = true;
    alert('Please save your Anthropic API key first (tap API Key above).');
    return;
  }
  const ta      = document.getElementById('health-doc-paste');
  const docText = ta ? ta.value.trim() : '';
  if (!docText && !_healthImagePayload) {
    alert('Please upload a file or paste your health summary first.');
    return;
  }
  const btn = document.getElementById('health-analyze-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }

  const prompt = 'You are a helpful health assistant. Analyze this personal health document and respond with these five bold sections:\n\n**Summary**\nPlain-language overview of what the document says.\n\n**Key Findings**\nThe most important numbers, results, or diagnoses.\n\n**Areas to Watch**\nAnything needing attention, follow-up, or improvement.\n\n**Positive Signs**\nWhat looks healthy or is trending in the right direction.\n\n**Suggested Next Steps**\nPractical things to discuss with the doctor or act on.\n\nBe warm, clear, and avoid jargon. This is for personal understanding, not medical advice.';

  let msgContent;
  if (_healthImagePayload) {
    msgContent = [
      { type: 'image', source: { type: 'base64', media_type: _healthImagePayload.media_type, data: _healthImagePayload.data } },
      { type: 'text', text: prompt }
    ];
  } else {
    msgContent = prompt + '\n\nDocument:\n' + docText;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: msgContent }]
      })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    const analysis = data.content[0].text;
    const dateStr  = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    _healthRenderAnalysis(analysis, dateStr);

    const d = _healthData() || {};
    d.lastAnalysis = { text: analysis, date: dateStr };
    localStorage.setItem(_HEALTH_KEY, JSON.stringify(d));

  } catch (err) {
    alert('Analysis failed: ' + err.message + '\n\nCheck that your API key is correct and has available credits.');
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
  if (localStorage.getItem(_HEALTH_API_KEY_LOC)) {
    const st = document.getElementById('health-api-key-status');
    if (st) st.style.display = 'block';
  }
});

window.healthSave         = healthSave;
window.healthSaveApiKey   = healthSaveApiKey;
window.healthAnalyzeDoc   = healthAnalyzeDoc;
window.healthHandleUpload = healthHandleUpload;
