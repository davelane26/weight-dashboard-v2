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

    // ── POST /health  (Tasker upload) ────────────────────────────────────
    if (method === 'POST' && url.pathname === '/health') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);

      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }

      const date = body.date ?? new Date().toISOString().slice(0, 10);
      const entry = {
        date,
        steps:          Number(body.steps          ?? 0),
        sleepHours:     Number(body.sleepHours     ?? 0),
        sleepScore:     Number(body.sleepScore     ?? 0),
        restingHR:      Number(body.restingHR      ?? 0),
        activeCalories: Number(body.activeCalories ?? 0),
        floorsClimbed:  Number(body.floorsClimbed  ?? 0),
        stressLevel:    Number(body.stressLevel    ?? 0),
        updatedAt:      new Date().toISOString(),
      };

      const stored  = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      const dedupMap = new Map();
      for (const r of stored) dedupMap.set(r.date, r);
      dedupMap.set(date, entry); // upsert today
      const sorted  = [...dedupMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-90); // keep 90 days

      await env.GLUCOSE_KV.put('health', JSON.stringify(sorted));
      return cors(JSON.stringify({ ok: true, date }));
    }

    // ── GET /health.json  (dashboard fetch) ───────────────────────────────
    if (method === 'GET' && url.pathname === '/health.json') {
      const data = await env.GLUCOSE_KV.get('health', { type: 'json' }) ?? [];
      return cors(JSON.stringify({ days: data, updatedAt: new Date().toISOString() }));
    }

    return cors('{"error":"Not found"}', 404);
  },
};

// ── Build the payload our dashboard expects ───────────────────────────────
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
