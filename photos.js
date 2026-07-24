/* photos.js - Progress Photos tab (Before / Goal / After)
 *
 * Upload sources (all funnel into the same _acceptBlob pipeline):
 *   - Native file input (mobile: opens the OS photo library incl. iCloud/Google Photos)
 *   - Google Drive Picker  (see photo-picker.js)
 *   - Google Photos Picker (see photo-picker.js)
 *
 * Storage strategy (per-upload):
 *   1. Compress client-side (max 1600px long-edge, JPEG q=0.85)
 *   2. Mirror to localStorage (offline fallback + cold-load render)
 *   3. Push to Cloudflare Worker (POST /photo?key=<slot>) so photos
 *      appear on every signed-in device. Silently skipped when the
 *      worker endpoint isn't deployed yet (HTTP 404).
 *
 * DRY: one SLOTS array drives all N tiles. Adding a 4th slot is a
 * one-line change, not three copy-pasted event listeners.
 */

const PHOTO_WORKER_URL = window.HEALTH_WORKER_URL || '';
const MAX_LONG_EDGE    = 1600;   // px  - keeps most phone photos under ~600KB
const JPEG_QUALITY     = 0.85;

const SLOTS = [
  { key: 'before', label: 'Before' },
  { key: 'goal',   label: 'Goal'   },
  { key: 'after',  label: 'After'  },
];

const lsKey = key => 'photos_img_' + key;

// -- Preview rendering ---------------------------------------------------
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

// -- Client-side compression --------------------------------------------
// Downscales huge phone photos to something KV-friendly. Returns a JPEG
// dataURL string. Accepts anything readable as a Blob (File | Blob).
function _compressImage(fileOrBlob) {
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
    reader.readAsDataURL(fileOrBlob);
  });
}

// -- Worker I/O (Firebase-token gated) ----------------------------------
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
  if (resp.status === 404) return null;                    // endpoint not deployed yet
  if (!resp.ok) throw new Error('GET ' + resp.status);
  const body = await resp.json();
  return body.dataUrl || null;
}

async function _cloudPut(key, dataUrl) {
  if (!PHOTO_WORKER_URL) throw new Error('no worker configured');
  const auth = await _authHeaders();
  if (!auth) throw new Error('sign in to sync');
  const resp = await fetch(`${PHOTO_WORKER_URL}/photo?key=${key}`, {
    method:  'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dataUrl }),
  });
  if (resp.status === 404) throw new Error('worker endpoint not deployed');
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`POST ${resp.status} ${txt}`);
  }
}

// -- The one true accept-a-blob pipeline --------------------------------
// Every upload source (native input, Drive, Photos) ends here.
async function _acceptBlob(key, blob, sourceLabel) {
  _photosSetStatus(key, `Compressing (${sourceLabel})...`);
  let dataUrl;
  try {
    dataUrl = await _compressImage(blob);
  } catch (ex) {
    _photosSetStatus(key, 'Could not read that image.', 'error');
    return;
  }

  // Immediate preview + local mirror (perceived-latency win, offline safe).
  _photosSetPreview(key, dataUrl);
  try { localStorage.setItem(lsKey(key), dataUrl); } catch { /* full disk, ignore */ }

  // Push to cloud (source of truth across devices).
  _photosSetStatus(key, 'Uploading to cloud...');
  try {
    await _cloudPut(key, dataUrl);
    _photosSetStatus(key, 'Synced across devices', 'ok');
  } catch (ex) {
    if (ex.message.includes('not deployed')) {
      _photosSetStatus(key, 'Saved on this device only', '');
    } else {
      _photosSetStatus(key, 'Saved locally (' + ex.message + ')', 'error');
    }
  }
}

// Public entry point for the native file input.
async function photosHandleUpload(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  await _acceptBlob(key, file, 'from device');
}

// Public entry points invoked by photo-picker.js
window.photosAcceptDriveBlob  = (key, blob) => _acceptBlob(key, blob, 'from Drive');
window.photosAcceptPhotosBlob = (key, blob) => _acceptBlob(key, blob, 'from Google Photos');

// -- Boot ---------------------------------------------------------------
function _wireSlot(slot) {
  const btn   = document.getElementById('photos-' + slot.key + '-btn');
  const input = document.getElementById('photos-' + slot.key + '-input');
  if (btn && input) {
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', function () { photosHandleUpload(slot.key, this); });
  }
  // Drive/Photos picker buttons (wired by photo-picker.js if present)
  const driveBtn  = document.getElementById('photos-' + slot.key + '-drive-btn');
  const photosBtn = document.getElementById('photos-' + slot.key + '-photos-btn');
  if (driveBtn && window.openDrivePicker) {
    driveBtn.addEventListener('click', () => window.openDrivePicker(slot.key));
  }
  if (photosBtn && window.openPhotosPicker) {
    photosBtn.addEventListener('click', () => window.openPhotosPicker(slot.key));
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
      // Don't yell about missing worker endpoints - just quietly skip.
      // Real network / auth errors still surface.
      if (!ex.message.includes('404')) {
        _photosSetStatus(slot.key, 'Cloud sync failed (' + ex.message + ')', 'error');
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  SLOTS.forEach(_wireSlot);
  if (window.fbUser) {
    _syncFromCloud();
  } else {
    document.addEventListener('firebase-auth-changed', e => {
      if (e.detail && e.detail.user) _syncFromCloud();
    }, { once: true });
  }
});
