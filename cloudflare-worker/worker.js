/**
 * Glucose Relay Worker
 * Receives xDrip+ uploads (Nightscout format) and serves them
 * as glucose.json for the weight dashboard.
 *
 * KV binding required: GLUCOSE_KV
 * Set secret: API_SECRET (matches xDrip+ API_SECRET setting)
 *
 * Endpoints:
 *   POST /api/v1/entries         ← xDrip+ uploads here
 *   GET  /glucose.json           ← dashboard reads from here
 *   GET  /workout-schedule       ← dashboard reads day-of-week overrides (token-gated)
 *   POST /workout-schedule       ← dashboard writes day-of-week overrides (token-gated)
 *   POST /weight/openscale-webhook ← openScale's built-in Webhook sync (bulk syncs write KV + git, see its own comment)
 *   POST /weight/manual-add        ← add-weighin.html, one hand-entered reading (writes KV + git)
 *
 * IMPORTANT — every runtime env var this Worker reads (API_SECRET,
 * API_SECRET_V2, ALLOWED_EMAILS, ANTHROPIC_API_KEY, WEIGHT_TRACKER_GITHUB_TOKEN)
 * MUST be set as a **Secret** in the dashboard/via `wrangler secret put`, never as a plain
 * Variable. `wrangler deploy` treats wrangler.toml as the complete,
 * authoritative binding list for everything EXCEPT true secrets — a plain
 * Variable not declared in wrangler.toml gets silently deleted on the next
 * automated deploy. This bit us for real: ALLOWED_EMAILS was a plain
 * Variable, the first automated deploy wiped it, and every Firebase-gated
 * endpoint (weight.json, /photo, /workout-schedule) started 401ing for
 * everyone even with a perfectly valid token, since requireUser() fails
 * closed when the allow-list is empty.
 */

const MAX_READINGS = 288; // 24h at 5-min intervals

// Progress-photo slots we accept. Whitelisted so a bad client can't
// spam arbitrary KV keys under 'photo:*'.
const ALLOWED_PHOTO_KEYS = ['before', 'goal', 'after'];

// KV per-value cap is 25MB; leave headroom for base64 overhead + slack.
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const ARCHIVE_DAYS = 15;  // rolling archive: 14 full days + today, feeds GMI

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
  'Access-Control-Allow-Headers': 'Content-Type, API-SECRET, api-secret, Authorization',
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
  // Accept EITHER API_SECRET (legacy — Garmin/Exist Python scripts on djtwo)
  // OR API_SECRET_V2 (Kage Health Bridge Android app). This lets us rotate
  // secrets per client without a big-bang break. Either value can be sent
  // plain-text or SHA-1 hashed (xDrip+-compatible).
  const secrets = [env.API_SECRET, env.API_SECRET_V2].filter(Boolean);
  if (!secrets.length) return true;
  const header = request.headers.get('API-SECRET') || request.headers.get('api-secret');
  if (!header) return false;
  for (const s of secrets) {
    if (header === s) return true;
    if (header === await sha1(s)) return true;
  }
  return false;
}

// ── Firebase ID-token verification ─────────────────────────────────────────
// The dashboard's weight data is private. GET /weight.json requires a valid
// Firebase ID token (RS256 JWT) whose email is on the allow-list. We verify
// the signature against Google's rotating public keys (JWK set) with WebCrypto
// — no external deps. This is the REAL lock: even if someone knows the URL,
// without a signed-in-as-David token they get 401.
const FIREBASE_PROJECT_ID = 'weight-dashboard-6b5f3';
const FIREBASE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Module-scope JWK cache (persists across requests in the same isolate).
let _jwkCache = { keys: null, exp: 0 };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getFirebaseJwks() {
  const now = Date.now();
  if (_jwkCache.keys && now < _jwkCache.exp) return _jwkCache.keys;
  const resp = await fetch(FIREBASE_JWK_URL);
  const data = await resp.json();
  const cc   = resp.headers.get('cache-control') || '';
  const m    = /max-age=(\d+)/.exec(cc);
  const ttl  = m ? parseInt(m[1], 10) * 1000 : 3600_000;
  _jwkCache  = { keys: data.keys || [], exp: now + ttl };
  return _jwkCache.keys;
}

// Returns the decoded payload if the token is valid, else null.
async function verifyFirebaseToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try { header = b64urlToJson(parts[0]); payload = b64urlToJson(parts[1]); }
  catch { return null; }

  // Claim checks (per Firebase docs)
  const now = Math.floor(Date.now() / 1000);
  const iss = 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== iss)                 return null;
  if (!payload.sub)                        return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 300) return null;

  // Signature check against the matching Google public key
  const jwks = await getFirebaseJwks();
  const jwk  = jwks.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
  return ok ? payload : null;
}

function allowedEmails(env) {
  return (env.ALLOWED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Verify the Bearer token AND enforce the email allow-list.
// Returns the token payload, or null if unauthorized.
async function requireUser(request, env) {
  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
  const payload = await verifyFirebaseToken(token);
  if (!payload) return null;
  const allow = allowedEmails(env);
  // If ALLOWED_EMAILS is unset we fail CLOSED for data reads (better safe
  // than sorry for a private health endpoint). Set it as a Worker var.
  if (!allow.length) return null;
  if (!payload.email || !allow.includes(payload.email.toLowerCase())) return null;
  return payload;
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

      // Fold the deduped 24h window into the rolling 14-day archive.
      // Merging `sorted` (not just this upload) means the archive seeds
      // itself from existing data on first run and self-heals gaps.
      const archive = await env.GLUCOSE_KV.get('archive', { type: 'json' }) ?? [];
      const archMap = new Map();
      for (const r of archive) archMap.set(r.time, r.value);
      for (const r of sorted)  archMap.set(r.time, r.value);
      const cutoff = Date.now() - ARCHIVE_DAYS * 86400000;
      const archSorted = [...archMap.entries()]
        .map(([time, value]) => ({ time, value }))
        .filter(r => new Date(r.time).getTime() >= cutoff)
        .sort((a, b) => new Date(a.time) - new Date(b.time));
      await env.GLUCOSE_KV.put('archive', JSON.stringify(archSorted));
      await env.GLUCOSE_KV.put('gmi', JSON.stringify(buildGmiPayload(archSorted)));

      return cors(JSON.stringify({ ok: true, saved: parsed.length }));
    }

    // ── GET /glucose.json  (dashboard fetch) ───────────────────────────
    if (method === 'GET' && url.pathname === '/glucose.json') {
      const payload = await env.GLUCOSE_KV.get('payload', { type: 'json' });
      if (!payload) return cors(JSON.stringify({ current: null, readings: [], updatedAt: null }));
      return cors(JSON.stringify(payload));
    }

    // ── GET /gmi.json  (14-day GMI for dashboard) ──────────────────────
    if (method === 'GET' && url.pathname === '/gmi.json') {
      let payload = await env.GLUCOSE_KV.get('gmi', { type: 'json' });
      if (!payload) {
        const archive = await env.GLUCOSE_KV.get('archive', { type: 'json' }) ?? [];
        payload = buildGmiPayload(archive);
      }
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
        'restingHR','minHR','maxHR','avgHR','currentHR','stressLevel','bodyBattery','fitnessAge',
        // Activity
        'steps','intensityMinutes','workoutsMins','activeCalories','totalCalories','floorsClimbed',
        // v0.3.4 Kage additions: distance today, blood oxygen, HRV, VO2 max,
        // bedtime/waketime bounds from the last sleep session.
        'distanceMeters','spo2Avg','spo2Min','hrvRmssd','vo2Max','bedtime','waketime',
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
        : type === 'pdf'
        ? [ { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } },
            { type: 'text', text: prompt } ]
        : prompt + '\n\nDocument:\n' + content;

      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1500,
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

    // ── POST /ai-ask  (Q&A card — LLM fallback for questions the
    //    deterministic parser in weight-qa.js can't match) ──────────────
    if (method === 'POST' && url.pathname === '/ai-ask') {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) return cors('{"error":"ANTHROPIC_API_KEY secret not set on this Worker"}', 503);

      // This endpoint is called straight from the public dashboard with no
      // per-user auth (the Firebase login gates the page, not this Worker).
      // Cap total volume per hour so a stray loop or bot traffic can't run
      // up the API bill, regardless of who's calling it.
      const hourBucket = Math.floor(Date.now() / 3600000);
      const rlKey       = 'ai_ask_count:' + hourBucket;
      const count       = parseInt((await env.GLUCOSE_KV.get(rlKey)) ?? '0', 10);
      if (count >= 30) return cors('{"error":"Rate limit reached — try again in a bit"}', 429);
      await env.GLUCOSE_KV.put(rlKey, String(count + 1), { expirationTtl: 3700 });

      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const { question, digest } = body;
      if (!question) return cors('{"error":"question required"}', 400);

      const prompt = 'You are a helpful assistant answering questions about a personal weight-loss '
        + 'tracking dashboard. Answer ONLY using the data below — do not guess or invent numbers, '
        + "and don't use outside knowledge about this specific person. Be concise (1-3 sentences), "
        + "warm, and direct. If the data doesn't contain what's needed to answer, say so plainly "
        + 'instead of guessing.\n\nDATA:\n' + (digest || '(no data provided)')
        + '\n\nQUESTION: ' + question;

      const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 300,
          messages: [{ role: 'user', content: prompt }] }),
      });

      const aiData = await aiResp.json();
      if (aiData.error) return cors(JSON.stringify({ error: aiData.error.message }), aiResp.status);
      const answer = aiData.content[0].text.trim();
      return cors(JSON.stringify({ answer }));
    }

    // ── GET /weight.json  (token-gated dashboard fetch) ────────────────
    // The private replacement for the public data.json. Requires a valid
    // Firebase ID token whose email is on ALLOWED_EMAILS.
    if (method === 'GET' && url.pathname === '/weight.json') {
      const user = await requireUser(request, env);
      if (!user) return cors('{"error":"Unauthorized"}', 401);
      const data = await env.GLUCOSE_KV.get('weight', { type: 'json' }) ?? [];
      return cors(JSON.stringify(data));
    }

    // ── GET /photo?key=<slot>  (token-gated photo fetch) ───────────────
    // Serves a base64 data URL previously stored via POST /photo.
    // Returns { key, dataUrl }  (dataUrl is null when the slot is empty).
    if (method === 'GET' && url.pathname === '/photo') {
      const user = await requireUser(request, env);
      if (!user) return cors('{"error":"Unauthorized"}', 401);
      const key = (url.searchParams.get('key') || '').toLowerCase();
      if (!ALLOWED_PHOTO_KEYS.includes(key)) return cors('{"error":"invalid key"}', 400);
      const dataUrl = await env.GLUCOSE_KV.get('photo:' + key);
      return cors(JSON.stringify({ key, dataUrl: dataUrl || null }));
    }

    // ── POST /photo?key=<slot>  (token-gated photo upload) ────────────
    // Body: { dataUrl: 'data:image/jpeg;base64,....' }
    if (method === 'POST' && url.pathname === '/photo') {
      const user = await requireUser(request, env);
      if (!user) return cors('{"error":"Unauthorized"}', 401);
      const key = (url.searchParams.get('key') || '').toLowerCase();
      if (!ALLOWED_PHOTO_KEYS.includes(key)) return cors('{"error":"invalid key"}', 400);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const dataUrl = body && body.dataUrl;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return cors('{"error":"expected {dataUrl: \"data:image/...\"}"}', 400);
      }
      if (dataUrl.length > MAX_PHOTO_BYTES) {
        return cors('{"error":"image too large (limit ~15MB post-compression)"}', 413);
      }
      await env.GLUCOSE_KV.put('photo:' + key, dataUrl);
      return cors(JSON.stringify({ ok: true, key, bytes: dataUrl.length }));
    }

    // ── GET /workout-schedule  (token-gated day-of-week overrides) ─────
    // Returns { schedule: { <dayId>: <0-6>, ... } }. Empty object means
    // "use the built-in defaults" — the dashboard fills those in client-side.
    if (method === 'GET' && url.pathname === '/workout-schedule') {
      const user = await requireUser(request, env);
      if (!user) return cors('{"error":"Unauthorized"}', 401);
      const schedule = await env.GLUCOSE_KV.get('workout_schedule', { type: 'json' }) ?? {};
      return cors(JSON.stringify({ schedule }));
    }

    // ── POST /workout-schedule  (token-gated day-of-week overrides) ────
    // Body: { schedule: { <dayId>: <0-6>, ... } }. Send {} to clear back
    // to defaults on every device.
    if (method === 'POST' && url.pathname === '/workout-schedule') {
      const user = await requireUser(request, env);
      if (!user) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const schedule = body && typeof body.schedule === 'object'
        && body.schedule !== null && !Array.isArray(body.schedule)
        ? body.schedule : null;
      if (!schedule) return cors('{"error":"expected {schedule: {...}}"}', 400);
      const entries = Object.entries(schedule);
      if (entries.length > 20) return cors('{"error":"too many entries"}', 400);
      const clean = {};
      for (const [dayId, dow] of entries) {
        if (typeof dayId !== 'string' || !dayId || dayId.length > 40) {
          return cors('{"error":"invalid day id"}', 400);
        }
        const n = Number(dow);
        if (!Number.isInteger(n) || n < 0 || n > 6) {
          return cors('{"error":"weekday must be an integer 0-6"}', 400);
        }
        clean[dayId] = n;
      }
      await env.GLUCOSE_KV.put('workout_schedule', JSON.stringify(clean));
      return cors(JSON.stringify({ ok: true, schedule: clean }));
    }

    // ── POST /weight  (sync job pushes the full weight array) ──────────
    // Protected by API_SECRET (same as the other write endpoints). Accepts
    // either a bare array of readings or { data: [...] }.
    if (method === 'POST' && url.pathname === '/weight') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      const rows = Array.isArray(body) ? body
                 : (Array.isArray(body.data) ? body.data : null);
      if (!rows) return cors('{"error":"expected an array of readings or {data:[...]}"}', 400);
      await env.GLUCOSE_KV.put('weight', JSON.stringify(rows));
      return cors(JSON.stringify({ ok: true, count: rows.length }));
    }

    // ── POST /weight/manual-add  (add-weighin.html, a single hand-entered
    // reading -- e.g. "the pipeline was down, log this one manually") ─────
    // Protected by API_SECRET, same as /weight above -- add-weighin.html
    // used to commit straight to GitHub from the browser with a user-pasted
    // repo-scope PAT; as of 2026-08-24 it POSTs here instead, so the only
    // credential that ever needs to live in a browser is the same scoped
    // Worker API_SECRET other clients (Kage, xDrip+) already use, not a
    // broad GitHub token. Body is a data.json-shaped entry (date string
    // with its "-0600" offset already applied, weight, and any optional
    // fields) -- no id; merge-by-date assigns one, same as everywhere else.
    // Writes KV immediately, then also commits to Weight-tracker/data.json
    // on GitHub (writeWeightToGitHub) since this is a rare, deliberate
    // action -- unlike the webhook's real-time auto-fires, a commit per
    // manual add is exactly the right frequency, not too noisy.
    if (method === 'POST' && url.pathname === '/weight/manual-add') {
      if (!await isAuthorized(request, env)) return cors('{"error":"Unauthorized"}', 401);
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }
      if (!body || typeof body.weight !== 'number' || typeof body.date !== 'string') {
        return cors('{"error":"expected {date, weight, ...optional fields}"}', 400);
      }

      const stored = await env.GLUCOSE_KV.get('weight', { type: 'json' }) ?? [];
      const { merged, entry } = mergeWeightEntry(stored, body);
      await env.GLUCOSE_KV.put('weight', JSON.stringify(merged));

      const gitResult = await writeWeightToGitHub(env, merged, `Add manual weigh-in: ${entry.weight} lb at ${entry.date}`);
      if (!gitResult.committed) {
        await env.GLUCOSE_KV.put('openscale_webhook_debug', JSON.stringify({
          receivedAt: new Date().toISOString(),
          note: 'manual-add succeeded to KV but git commit failed',
          reason: gitResult.reason,
        }));
      }
      return cors(JSON.stringify({
        ok: true,
        id: entry.id,
        total: merged.length,
        git: gitResult.committed ? 'committed' : `skipped (${gitResult.reason})`,
      }));
    }

    // ── POST /weight/openscale-webhook  (openScale's built-in Webhook sync) ─
    // Two payload shapes observed from openScale itself (2026-08-23):
    //   1. Bulk (fired by "Test connection" / "Sync with Webhook"):
    //      { event, measurements: [ {...}, ... ] } -- the WHOLE history.
    //      Guarded full-replace, same regression protection as the MQTT
    //      bridge fix (refuse if it would shrink or go backwards in time).
    //      2026-08-24: also commits that same full table to
    //      Weight-tracker/data.json on GitHub (writeWeightToGitHub below) --
    //      the same "every sync is a full-table rewrite" convention MQTT
    //      already used, so a manual "Sync with Webhook" tap in openScale is
    //      now a one-button way to get a git-backed backup/history snapshot
    //      without the MQTT bridge running at all (see MQTT_BRIDGE.md -- MQTT
    //      is now optional/dormant). Best-effort: a failed git commit never
    //      blocks or fails the KV write, since KV is what the live dashboard
    //      actually reads -- see GET /weight/openscale-webhook-debug for why.
    //   2. Real-time auto-fire (a genuine new weigh-in): a flat measurement
    //      object directly, no wrapper. Safe merge-by-date upsert, KV-only --
    //      committing git on every single auto-fire would mean a commit per
    //      weigh-in instead of per-sync, so git just stays current as of the
    //      last bulk sync (same lag MQTT always had between full-table runs).
    // Auth: openScale's Webhook UI only exposes a raw "Authorization
    // header" field (not a named custom header), so this checks the
    // OPENSCALE_WEBHOOK_SECRET Worker secret against that header's literal
    // value -- set the same string in both places. If the secret isn't
    // configured, this endpoint stays open (fine for the initial capture/
    // test phase; set the secret before relying on this for real).
    if (method === 'POST' && url.pathname === '/weight/openscale-webhook') {
      const expected = env.OPENSCALE_WEBHOOK_SECRET;
      if (expected) {
        const got = request.headers.get('Authorization') || '';
        if (got !== expected) return cors('{"error":"Unauthorized"}', 401);
      }
      let body;
      try { body = await request.json(); } catch { return cors('{"error":"Invalid JSON"}', 400); }

      // Delete event: { event: "delete", userId, date } -- no weight/values,
      // just the UTC date of the entry to remove (confirmed shape,
      // 2026-08-24). Same exact-date-match convention as everything else.
      if (body && body.event === 'delete' && typeof body.date === 'string') {
        const dateStr = formatOpenScaleDate(body.date);
        if (!dateStr) return cors('{"error":"invalid date in delete event"}', 400);
        const stored = await env.GLUCOSE_KV.get('weight', { type: 'json' }) ?? [];
        const remaining = stored.filter((r) => r.date !== dateStr);
        if (remaining.length === stored.length) {
          return cors(JSON.stringify({ ok: true, note: `no entry found for ${dateStr}, nothing to delete` }));
        }
        await env.GLUCOSE_KV.put('weight', JSON.stringify(remaining));
        return cors(JSON.stringify({ ok: true, mode: 'delete', date: dateStr }));
      }

      const raw = Array.isArray(body.measurements) ? body.measurements
                : (body && typeof body.weight === 'number' ? [body] : null);
      if (!raw) {
        // Genuinely unrecognized shape (not a known measurement or delete
        // event) -- capture it instead of hard-failing, so openScale's own
        // retry loop doesn't get stuck. Check GET /weight/openscale-webhook-debug.
        await env.GLUCOSE_KV.put('openscale_webhook_debug', JSON.stringify({
          receivedAt: new Date().toISOString(),
          body,
        }));
        return cors(JSON.stringify({ ok: true, note: 'unrecognized shape, captured for review' }));
      }

      const converted = raw.map(convertOpenScaleMeasurement).filter(Boolean);
      if (!converted.length) return cors('{"error":"no usable measurements in payload"}', 400);

      const stored = await env.GLUCOSE_KV.get('weight', { type: 'json' }) ?? [];

      if (converted.length > 1) {
        // Retention guard, same threshold/reasoning as the MQTT bridge fix
        // (mqtt_bridge.py's MIN_RETENTION_RATIO): a legitimate full resync
        // can legitimately be a few entries SMALLER than what's live -- the
        // user deleted a bad reading in openScale and re-synced, which is
        // the documented way to remove one (see MQTT_BRIDGE.md). Only
        // refuse a payload that's catastrophically smaller (more than half
        // gone), which is what an empty/stale/malformed sync looks like.
        // This can't perfectly tell "intentional small deletion" apart from
        // "stale queued retry" by count alone -- neither could the bridge's
        // guard -- so it errs toward trusting a live openScale resync.
        const MIN_RETENTION_RATIO = 0.5;
        if (stored.length > 0 && converted.length < stored.length * MIN_RETENTION_RATIO) {
          return cors(JSON.stringify({
            error: `refusing: payload has only ${converted.length} entries, ` +
                   `well below the ${stored.length} already live -- looks stale/malformed`,
          }), 409);
        }
        const sorted = converted.slice().sort((a, b) => (a.date > b.date ? 1 : -1))
          .map((e, i) => ({ ...e, id: i + 1 }));
        await env.GLUCOSE_KV.put('weight', JSON.stringify(sorted));

        const gitResult = await writeWeightToGitHub(env, sorted, `openScale webhook sync: ${sorted.length} entries`);
        if (!gitResult.committed) {
          // Don't fail the request over this -- KV (the live dashboard) is
          // already updated and that's the part that must not break.
          // Capture the reason so it's inspectable instead of silently lost.
          await env.GLUCOSE_KV.put('openscale_webhook_debug', JSON.stringify({
            receivedAt: new Date().toISOString(),
            note: 'bulk sync succeeded to KV but git commit failed',
            reason: gitResult.reason,
          }));
        }
        return cors(JSON.stringify({
          ok: true,
          mode: 'bulk-replace',
          count: sorted.length,
          git: gitResult.committed ? 'committed' : `skipped (${gitResult.reason})`,
        }));
      }

      const { merged, entry } = mergeWeightEntry(stored, converted[0]);
      await env.GLUCOSE_KV.put('weight', JSON.stringify(merged));
      return cors(JSON.stringify({ ok: true, mode: 'merge', date: entry.date, id: entry.id }));
    }

    // Diagnostic for whatever the fallback capture above catches (a
    // genuinely unrecognized webhook shape, not the now-handled delete
    // event). Gated by a ?key= query param (not a header) so it's still
    // checkable by just pasting a URL into a browser -- a plain navigation
    // can't set custom headers, which is exactly the /weight.json 401 trap
    // from earlier. Reuses OPENSCALE_WEBHOOK_SECRET, no new secret needed.
    if (method === 'GET' && url.pathname === '/weight/openscale-webhook-debug') {
      const secret = env.OPENSCALE_WEBHOOK_SECRET;
      if (secret && url.searchParams.get('key') !== secret) return cors('{"error":"Unauthorized"}', 401);
      const data = await env.GLUCOSE_KV.get('openscale_webhook_debug', { type: 'json' });
      return cors(JSON.stringify(data ?? { note: 'nothing captured yet' }));
    }

    return cors('{"error":"Not found"}', 404);
  },
};

// ── Convert one openScale webhook measurement into data.json's shape ────────
// openScale sends weight/bone in kg (convert to lbs, matching data.json's
// convention) and date as UTC ISO ("...Z"). data.json's date convention is a
// FIXED "-0600" local offset on every existing entry regardless of true DST
// -- Workers run in UTC with no real local timezone to read, so this applies
// that same fixed -06:00 shift rather than doing real timezone conversion,
// to stay consistent with the rest of the dataset.
const KG_TO_LBS = 2.20462;

// Shared by convertOpenScaleMeasurement and the delete handler -- both need
// to turn openScale's UTC ISO date into the same "-0600" local string data
// entries are keyed by, so a delete's date string actually matches the
// entry it's meant to remove.
function formatOpenScaleDate(isoUtc) {
  const utc = new Date(isoUtc);
  if (isNaN(utc)) return null;
  const local = new Date(utc.getTime() - 6 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}-0600`;
}

function convertOpenScaleMeasurement(m) {
  if (!m || typeof m.weight !== 'number' || !m.date) return null;
  const dateStr = formatOpenScaleDate(m.date);
  if (!dateStr) return null;

  // openScale duplicates fat/water/muscle at the top level AND inside
  // "values" (which also carries bmi/bmr/tdee/bone/impedance) -- prefer the
  // top-level field when present, fall back to "values" for everything else.
  const byKey = {};
  for (const v of (Array.isArray(m.values) ? m.values : [])) {
    if (v && v.key) byKey[v.key] = v.value;
  }
  const round2 = (n) => Math.round(n * 100) / 100;

  const entry = {
    date: dateStr,
    weight: round2(m.weight * KG_TO_LBS),
    weight_kg: round2(m.weight),
  };
  if (typeof byKey.bmi === 'number')  entry.bmi = round2(byKey.bmi);
  if (typeof byKey.bmr === 'number')  entry.bmr = round2(byKey.bmr);
  if (typeof byKey.tdee === 'number') entry.tdee = round2(byKey.tdee);
  if (typeof byKey.bone === 'number') entry.bone = round2(byKey.bone * KG_TO_LBS);
  const bodyFat = typeof m.body_fat === 'number' ? m.body_fat : byKey.body_fat;
  if (typeof bodyFat === 'number') entry.bodyFat = bodyFat;
  const muscle = typeof m.muscle === 'number' ? m.muscle : byKey.muscle;
  if (typeof muscle === 'number') entry.muscle = muscle;
  const water = typeof m.water === 'number' ? m.water : byKey.water;
  if (typeof water === 'number') entry.water = water;

  return entry;
}

// ── Merge one weight reading into the stored array by exact date match ──────
// Same date string -> replace in place (keeps the existing id). New date ->
// append with the next id. Mirrors mqtt_bridge.py's single-reading update.
function mergeWeightEntry(stored, entry) {
  const idx = stored.findIndex((r) => r.date === entry.date);
  if (idx >= 0) {
    const merged = [...stored];
    merged[idx] = { ...stored[idx], ...entry, id: stored[idx].id };
    return { merged, entry: merged[idx] };
  }
  const withId = { ...entry, id: (stored.reduce((m, r) => Math.max(m, r.id || 0), 0) || 0) + 1 };
  const merged = [...stored, withId].sort((a, b) => (a.date > b.date ? 1 : -1));
  return { merged, entry: withId };
}

// ── Commit the full weight table to Weight-tracker/data.json on GitHub ──────
// Called from the openScale webhook's bulk-sync branch and from
// /weight/manual-add below -- see the webhook comment for why real-time
// single-record auto-fires stay KV-only instead. Best-effort: callers must
// not let a failure here block or fail the KV write, since KV is what the
// live dashboard actually reads. Requires the WEIGHT_TRACKER_GITHUB_TOKEN
// secret (a GitHub token with Contents: read/write on
// davelane26/weight-tracker) -- set as a Secret, never a plain Variable,
// same "wrangler deploy silently deletes undeclared plain Variables" trap
// documented at the top of wrangler.toml. If it's unset, this endpoint just
// skips the git write and keeps working KV-only, same as before 2026-08-24.
async function writeWeightToGitHub(env, sorted, message) {
  const token = env.WEIGHT_TRACKER_GITHUB_TOKEN;
  if (!token) return { committed: false, reason: 'no WEIGHT_TRACKER_GITHUB_TOKEN configured' };

  const apiUrl = 'https://api.github.com/repos/davelane26/weight-tracker/contents/data.json';
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'glucose-relay-worker',
    Accept: 'application/vnd.github+json',
  };

  try {
    // Need the current file's blob SHA -- GitHub's Contents API requires it
    // on every update, as a safeguard against overwriting a change it hasn't
    // seen (same idea as an ETag/If-Match).
    const getRes = await fetch(`${apiUrl}?ref=main`, { headers });
    if (!getRes.ok) {
      return { committed: false, reason: `GET data.json failed: HTTP ${getRes.status}` };
    }
    const current = await getRes.json();

    // Match data.json's existing formatting (2-space indent, trailing newline).
    const content = JSON.stringify(sorted, null, 2) + '\n';
    // btoa only handles Latin1; data.json is plain-ASCII JSON so this is
    // safe, but the encodeURIComponent/unescape round-trip guards against
    // any stray non-ASCII character (e.g. in a future note field) instead
    // of throwing.
    const encoded = btoa(unescape(encodeURIComponent(content)));

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encoded,
        sha: current.sha,
        branch: 'main',
      }),
    });
    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '');
      return { committed: false, reason: `PUT data.json failed: HTTP ${putRes.status} ${errText.slice(0, 200)}` };
    }
    return { committed: true };
  } catch (e) {
    return { committed: false, reason: `${e.name}: ${e.message}` };
  }
}

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

// ── Build the 14-day GMI payload ────────────────────────────────────────────
// GMI (Glucose Management Indicator) is the clinical-standard estimate of
// lab A1C from CGM data: GMI% = 3.31 + 0.02392 × mean glucose (mg/dL),
// meant to be read over ≥14 days of wear.
function buildGmiPayload(archive) {
  const byDay = new Map();
  for (const r of archive) {
    const day = r.time.slice(0, 10); // reading's own local date (offset preserved by xDrip)
    let d = byDay.get(day);
    if (!d) { d = { date: day, sum: 0, count: 0, min: Infinity, max: -Infinity, inRange: 0 }; byDay.set(day, d); }
    d.sum += r.value; d.count++;
    d.min = Math.min(d.min, r.value);
    d.max = Math.max(d.max, r.value);
    if (r.value >= 70 && r.value <= 180) d.inRange++;
  }
  const kept = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  const totalSum   = kept.reduce((a, d) => a + d.sum, 0);
  const totalCount = kept.reduce((a, d) => a + d.count, 0);
  const mean = totalCount ? totalSum / totalCount : null;
  return {
    gmi:          mean != null ? +(3.31 + 0.02392 * mean).toFixed(1) : null,
    meanGlucose:  mean != null ? Math.round(mean) : null,
    daysWithData: kept.length,
    readingCount: totalCount,
    days: kept.map(d => ({
      date:  d.date,
      avg:   Math.round(d.sum / d.count),
      min:   d.min,
      max:   d.max,
      count: d.count,
      tir:   Math.round((d.inRange / d.count) * 100),
    })),
    updatedAt: new Date().toISOString(),
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
