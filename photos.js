/* photos.js — Progress Photos tab (Before / Goal / After)
 *
 * Storage strategy:
 *   1. Client compresses the image (max 1600px long-edge, JPEG q=0.85).
 *   2. Uploads to the Cloudflare Worker (POST /photo?key=<slot>) under the
 *      user's Firebase ID token, so photos appear on every signed-in device.
 *   3. Mirrors to localStorage as an offline fallback, so the tile still
 *      shows on cold-load before the worker responds.
 *
 * DRY: one SLOTS config drives Before/Goal/After — add a fourth by adding
 * one entry, not by copy-pasting three event listeners.
 */

const PHOTO_WORKER_URL = window.HEALTH_WORKER_URL || '';
const MAX_LONG_EDGE    = 1600;   // px  — keeps most phone photos under ~600KB
const JPEG_QUALITY     = 0.85;

const SLOTS = [
  { key: 'before', label: 'Before' },
  { key: 'goal',   label: 'Goal'   },
  { key: 'after',  label: 'After'  },
];

const lsKey = key => 'photos_img_' + key;

// ── Preview rendering ────────────────────────────────────────────────────
function _photosSetPreview(key, dataUrl) {
  const el = document.getElementById('photos-' + key + '-preview');
  if (!el) return;
  el.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = key + ' progress photo';
  img.style.cssText = 'width:100%;height:auto;border-radius:8px;display:block';
  el.appendChild(img);
}

function _photosSetStatus(key, text, tone) {
  const el = document.getElementById('photos-' + key + '-status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = tone === 'error' ? '#dc2626'
                 : tone === 'ok'    ? '#16a34a'
                 : '#6d7a95';
}

// ── Client-side compression ─────────────────────────────────────────────
// Downscales huge phone photos to something KV-friendly. Returns a JPEG
// dataURL string.
function _compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Worker I/O (auth-gated) ─────────────────────────────────────────────
async function _authHeaders() {
  if (!window.fbUser || typeof window.fbUser.getIdToken !== 'function') return null;
  const token = await window.fbUser.getIdToken();
  return { Authorization: 'Bearer ' + token };
}

async function _cloudGet(key) {
  if (!PHOTO_WORKER_URL) return null;
  const auth = await _authHeaders();
  if (!auth) return null;
  const resp = await fetch(`${PHOTO_WORKER_URL}/photo?key=${key}`, { headers: auth });
  if (!resp.ok) throw new Error('GET ' + resp.status);
  const body = await resp.json();
  return body.dataUrl || null;
}

async function _cloudPut(key, dataUrl) {
  if (!PHOTO_WORKER_URL) throw new Error('no worker configured');
  const auth = await _authHeaders();
  if (!auth) throw new Error('sign in to sync photos');
  const resp = await fetch(`${PHOTO_WORKER_URL}/photo?key=${key}`, {
    method:  'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dataUrl }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`POST ${resp.status} ${txt}`);
  }
}

// ── Upload flow ─────────────────────────────────────────────────────────
async function photosHandleUpload(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;

  _photosSetStatus(key, 'Compressing…');
  let dataUrl;
  try {
    dataUrl = await _compressImage(file);
  } catch (ex) {
    _photosSetStatus(key, 'Could not read that image.', 'error');
    return;
  }

  // Show the preview immediately — perceived-latency win.
  _photosSetPreview(key, dataUrl);

  // Always try to mirror locally first (survives offline / signed-out).
  try {
    localStorage.setItem(lsKey(key), dataUrl);
  } catch {
    // Full localStorage; not fatal — cloud sync is the source of truth.
  }

  // Then push to cloud (source of truth across devices).
  _photosSetStatus(key, 'Uploading to cloud…');
  try {
    await _cloudPut(key, dataUrl);
    _photosSetStatus(key, 'Synced across devices', 'ok');
  } catch (ex) {
    _photosSetStatus(key, 'Saved on this device only (' + ex.message + ')', 'error');
  }
}

// ── Boot ────────────────────────────────────────────────────────────────
function _wireSlot(slot) {
  const btn   = document.getElementById('photos-' + slot.key + '-btn');
  const input = document.getElementById('photos-' + slot.key + '-input');
  if (btn && input) {
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', function () { photosHandleUpload(slot.key, this); });
  }
  // Restore localStorage copy immediately for a warm-looking cold load.
  const cached = localStorage.getItem(lsKey(slot.key));
  if (cached) _photosSetPreview(slot.key, cached);
}

async function _syncFromCloud() {
  for (const slot of SLOTS) {
    try {
      const dataUrl = await _cloudGet(slot.key);
      if (dataUrl) {
        _photosSetPreview(slot.key, dataUrl);
        try { localStorage.setItem(lsKey(slot.key), dataUrl); } catch { /* ignore */ }
      }
    } catch (ex) {
      _photosSetStatus(slot.key, 'Cloud sync failed (' + ex.message + ')', 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  SLOTS.forEach(_wireSlot);
  // If auth is already resolved, sync now. Otherwise wait for the event.
  if (window.fbUser) {
    _syncFromCloud();
  } else {
    document.addEventListener('firebase-auth-changed', e => {
      if (e.detail && e.detail.user) _syncFromCloud();
    }, { once: true });
  }
});
