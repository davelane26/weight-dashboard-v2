/**
 * Glucose Relay Worker
 * Receives xDrip+ uploads (Nightscout format) and serves them
 * as glucose.json for the weight dashboard.
 *
 * KV binding required: GLUCOSE_KV
 * Set secret: API_SECRET (matches xDrip+ API_SECRET setting)
 *
 * Endpoints:
 *   POST /api/v1/entries     ← xDrip+ uploads here
 *   GET  /glucose.json       ← dashboard reads from here
 */

const MAX_READINGS = 288; // 24h at 5-min intervals

// ── Trend mappings (Nightscout direction strings → display) ───────────────
const ARROWS = {
  DoubleUp:       '↑↑',
  SingleUp:       '↑',
  FortyFiveUp:    '↗',
  Flat:           '→',
  FortyFiveDown:  '↘',
  SingleDown:     '↓',
  DoubleDown:     '↓↓',
  NotComputable:  '—',
  RateOutOfRange: '⚡',
};

const DESCS = {
  DoubleUp:       'Rising fast',
  SingleUp:       'Rising',
  FortyFiveUp:    'Rising slowly',
  Flat:           'Steady',
  FortyFiveDown:  'Falling slowly',
  SingleDown:     'Falling',
  DoubleDown:     'Falling fast',
  NotComputable:  'Not computable',
  RateOutOfRange: 'Rate out of range',
};

// Trend number → direction string (xDrip+ sometimes sends numbers)
const NUM_TO_DIR = {
  1: 'DoubleUp', 2: 'SingleUp', 3: 'FortyFiveUp',
  4: 'Flat', 5: 'FortyFiveDown', 6: 'SingleDown', 7: 'DoubleDown',
};

// ── CORS headers ─────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, API-SECRET, api-secret',
};

function cors(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

// ── Auth check (xDrip+ sends SHA1 hash of secret, not plain text) ───────────
async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(request, env) {
  const secret = env.API_SECRET;
  if (!secret) return true;
  const header = request.headers.get('API-SECRET') || request.headers.get('api-secret');
  if (!header) return false;
  if (header === secret) return true;           // plain text match
  const hashed = await sha1(secret);
  if (header === hashed) return true;           // SHA1 hash match (xDrip+)
  return false;
}

// ── Parse a single Nightscout entry → our format ─────────────────────────
function parseEntry(e) {
  const value = e.sgv ?? e.glucose ?? e.value;
  if (!value) return null;

  let direction = e.direction || NUM_TO_DIR[e.trend] || 'Flat';

  return {
    time:       e.dateString ?? new Date(e.date ?? Date.now()).toISOString(),
    value:      Math.round(value),
    trend:      DESCS[direction]  ?? 'Steady',
    trendArrow: ARROWS[direction] ?? '→',
  };
}

// ── Handler ───────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // Preflight
    if (method === 'OPTIONS') return cors('', 204);

    // ── POST /devicestatus  (xDrip+ heartbeat, just ack it) ────────────
    if (method === 'POST' && url.pathname.includes('devicestatus')) {
      return cors('{"ok":true}');
    }

    // ── POST /api/v1/entries  (xDrip+ upload) ──────────────────────────
    if (method === 'POST' && url.pathname.includes('entries')) {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);

      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }

      const entries = Array.isArray(body) ? body : [body];
      const parsed  = entries.map(parseEntry).filter(Boolean);

      if (!parsed.length) return cors('{"ok":true,"saved":0}');

      // Load existing readings from KV
      const stored  = await env.GLUCOSE_KV.get('readings', { type: 'json' }) ?? [];

      // Merge + deduplicate by time + keep latest MAX_READINGS
      const merged  = [...stored, ...parsed];
      const dedupMap = new Map();
      for (const r of merged) dedupMap.set(r.time, r);
      const sorted  = [...dedupMap.values()]
        .sort((a, b) => new Date(a.time) - new Date(b.time))
        .slice(-MAX_READINGS);

      await env.GLUCOSE_KV.put('readings', JSON.stringify(sorted));

      // Build and cache full payload
      const latest  = sorted[sorted.length - 1];
      const payload = buildPayload(latest, sorted);
      await env.GLUCOSE_KV.put('payload', JSON.stringify(payload));

      return cors(JSON.stringify({ ok: true, saved: parsed.length }));
    }

    // ── GET /glucose.json  (dashboard fetch) ───────────────────────────
    if (method === 'GET' && url.pathname === '/glucose.json') {
      const payload = await env.GLUCOSE_KV.get('payload', { type: 'json' });
      if (!payload) return cors(JSON.stringify({ current: null, readings: [], updatedAt: null }));
      return cors(JSON.stringify(payload));
    }

    // ── POST /health  (single day upsert) ───────────────────────────────
    if (method === 'POST' && url.pathname === '/health') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const stored   = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      const dedupMap = new Map();
      for (const r of stored) dedupMap.set(r.date, r);
      const entry = buildHealthEntry(body);
      dedupMap.set(entry.date, entry);
      const sorted = [...dedupMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      await env.GLUCOSE_KV.put('health', JSON.stringify(sorted));
      return cors(JSON.stringify({ ok: true, date: entry.date }));
    }

    // ── POST /health/batch  (bulk upsert — 30-day backfill) ────────────────────
    if (method === 'POST' && url.pathname === '/health/batch') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const days     = Array.isArray(body.days) ? body.days : [];
      const stored   = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      const dedupMap = new Map();
      for (const r of stored) dedupMap.set(r.date, r);
      for (const day of days) {
        const incoming = buildHealthEntry(day);
        const existing = dedupMap.get(incoming.date) ?? {};
        // Merge: never overwrite a non-null existing value with null/0.
        // This protects Garmin-patched fields (sleepScore, restingHR, etc.)
        // from being wiped out by Exist.io batch pushes that lack those fields.
        const merged = { ...existing };
        for (const [k, v] of Object.entries(incoming)) {
          if (k === 'date' || k === 'updatedAt') { merged[k] = v; continue; }
          if (v !== null && v !== undefined) {
            // For sleepHours: keep the more precise (non-integer) value.
            // Exist.io sends whole numbers; Garmin patches send e.g. 6.3.
            // If existing has decimals and incoming is a whole number with
            // the same integer part, the existing value is more accurate.
            if (k === 'sleepHours' && merged[k] != null) {
              const ex = Number(merged[k]), inc = Number(v);
              if (ex % 1 !== 0 && inc % 1 === 0 && Math.floor(ex) === Math.floor(inc)) continue;
            }
            merged[k] = v;
          }
        }
        dedupMap.set(incoming.date, merged);
      }
      const sorted = [...dedupMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      await env.GLUCOSE_KV.put('health', JSON.stringify(sorted));
      return cors(JSON.stringify({ ok: true, count: days.length }));
    }

    // ── GET /health.json  (dashboard fetch) ───────────────────────────────
    if (method === 'GET' && url.pathname === '/health.json') {
      const data = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      return cors(JSON.stringify({ days: data, updatedAt: new Date().toISOString() }));
    }

    // ── PATCH /health/patch  (merge specific fields into an existing day) ──
    // Used by the local Garmin sync to add sleepScore + precise sleepHours
    // without clobbering the richer Exist.io data already stored.
    if (method === 'POST' && url.pathname === '/health/patch') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const date = body.date;
      if (!date) return cors('{"error":"date required"}', 400);
      const stored   = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      const dedupMap = new Map();
      for (const r of stored) dedupMap.set(r.date, r);
      const existing = dedupMap.get(date) ?? { date };
      // Merge: only overwrite fields that are explicitly provided and non-null
      const patched = { ...existing };
      const allowed = [
        // Sleep
        'sleepScore','sleepHours','sleepDeep','sleepLight','sleepRem',
        'sleepAwakenings','timeInBed',
        // Heart / stress / battery
        'restingHR','minHR','maxHR','avgHR','stressLevel','bodyBattery','fitnessAge',
        // Activity
        'steps','intensityMinutes','activeCalories','totalCalories','floorsClimbed',
      ];
      for (const key of allowed) {
        if (body[key] !== undefined && body[key] !== null) patched[key] = body[key];
      }
      patched.updatedAt = new Date().toISOString();
      dedupMap.set(date, patched);
      const sorted = [...dedupMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      await env.GLUCOSE_KV.put('health', JSON.stringify(sorted));
      return cors(JSON.stringify({ ok: true, date, patched: Object.keys(body).filter(k => allowed.includes(k)) }));
    }
    // ── POST /ai-health  (AI health document analysis) ─────────────────
    if (method === 'POST' && url.pathname === '/ai-health') {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) return cors('{"error":"ANTHROPIC_API_KEY secret not set on this Worker"}', 503);

      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }

      const { type, content, mediaType } = body;
      if (!content) return cors('{"error":"content required"}', 400);

      const prompt = 'You are a helpful health assistant. Analyze this personal health document and return ONLY a valid JSON object with exactly this structure (no markdown code fences, no other text):\n\n{"analysis":"...","metrics":{"weight":null,"bp":null,"a1c":null,"cholesterol":null,"drnotes":null}}\n\nFor the \"analysis\" field: write a warm clear summary with these five markdown-bold sections: **Summary**, **Key Findings**, **Areas to Watch**, **Positive Signs**, **Suggested Next Steps**. Avoid jargon. This is for personal understanding not medical advice.\n\nFor the \"metrics\" field extract these values from the document (set to null if not mentioned):\n- \"weight\": body weight with unit e.g. \"285 lbs\"\n- \"bp\": blood pressure e.g. \"128/82 mmHg\"\n- \"a1c\": A1C percentage e.g. \"7.2%\"\n- \"cholesterol\": total cholesterol with unit e.g. \"195 mg/dL\"\n- \"drnotes\": one-sentence summary of main doctor recommendation or follow-up goal\n\nReturn ONLY the raw JSON object. No extra text.';

      const msgContent = type === 'image'
        ? [ { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: content } },
            { type: 'text', text: prompt } ]
        : prompt + '\n\nDocument:\n' + content;

      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500,
          messages: [{ role: 'user', content: msgContent }] }),
      });

      const aiData = await aiResp.json();
      if (aiData.error) return cors(JSON.stringify({ error: aiData.error.message }), aiResp.status);
      const rawText = aiData.content[0].text;
      let analysis = rawText;
      let metrics = null;
      try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.analysis) { analysis = parsed.analysis; metrics = parsed.metrics || null; }
      } catch (e) { /* fall back to plain text */ }
      return cors(JSON.stringify({ analysis, metrics }));
    }


    return cors('{"error":"Not found"}', 404);
  },
};

// ── Normalise a raw health payload into a stored entry ──────────────────────
function buildHealthEntry(body) {
  const n  = (v, d = 0)    => { const x = Number(v); return isNaN(x) ? d : x; };
  const nn = (v, d = null) => { const x = Number(v); return isNaN(x) ? d : x; };
  return {
    date:             body.date ?? new Date().toISOString().slice(0, 10),
    steps:            n(body.steps),
    sleepHours:       n(body.sleepHours),
    sleepScore:       nn(body.sleepScore),   // Garmin sleep quality score (0-100)
    sleepDeep:        n(body.sleepDeep),
    sleepLight:       n(body.sleepLight),
    sleepRem:         n(body.sleepRem),
    sleepAwakenings:  n(body.sleepAwakenings),
    timeInBed:        n(body.timeInBed),
    activeCalories:   n(body.activeCalories),
    floorsClimbed:    n(body.floorsClimbed),
    workouts:         n(body.workouts),
    workoutsMins:     n(body.workoutsMins),
    workoutsKm:       n(body.workoutsKm),
    updatedAt:        new Date().toISOString(),
  };
}

// ── Build the payload our dashboard expects ─────────────────────────────────
function buildPayload(latest, readings) {
  return {
    current: latest ? {
      value:      latest.value,
      trend:      latest.trend,
      trendArrow: latest.trendArrow,
      trendDesc:  latest.trend,
      time:       latest.time,
    } : null,
    readings,
    updatedAt: new Date().toISOString(),
  };
}
