/* photo-picker.js - Google Drive + Google Photos pickers
 *
 * Exposes two globals used by photos.js:
 *   window.openDrivePicker(slotKey)
 *   window.openPhotosPicker(slotKey)
 *
 * Both flows:
 *   1. Lazy-load Google Identity Services (GIS) and required libs
 *   2. Request an OAuth access token for the specific scope
 *   3. Show the picker (Drive Picker or Photos Picker session)
 *   4. Download the selected image bytes
 *   5. Hand the Blob to photos.js via window.photosAcceptDriveBlob / photosAcceptPhotosBlob
 *
 * Config (set on window in index.html):
 *   window.GOOGLE_OAUTH_CLIENT_ID  - OAuth 2.0 Web client ID
 *   window.GOOGLE_API_KEY          - Browser API key (Picker + Drive APIs)
 *   window.GOOGLE_APP_ID           - Cloud project number (Drive Picker only)
 *
 * When any of those is missing, the picker buttons show a helpful
 * "click here to configure" message instead of silently failing.
 */

const GIS_SRC    = 'https://accounts.google.com/gsi/client';
const GAPI_SRC   = 'https://apis.google.com/js/api.js';
const DRIVE_SCOPE  = 'https://www.googleapis.com/auth/drive.readonly';
const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

// -- Lazy script loader (DRY: same helper for GIS + gapi) ---------------
const _loaded = {};
function _loadScript(src) {
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
  return _loaded[src];
}

function _config() {
  return {
    clientId: window.GOOGLE_OAUTH_CLIENT_ID || '',
    apiKey:   window.GOOGLE_API_KEY || '',
    appId:    window.GOOGLE_APP_ID || '',
  };
}

function _configMissing(needAppId) {
  const c = _config();
  const missing = [];
  if (!c.clientId) missing.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!c.apiKey)   missing.push('GOOGLE_API_KEY');
  if (needAppId && !c.appId) missing.push('GOOGLE_APP_ID');
  return missing;
}

function _reportConfigMissing(slotKey, missing) {
  const el = document.getElementById('photos-' + slotKey + '-status');
  if (!el) return;
  el.textContent = 'Picker not configured (missing ' + missing.join(', ') + ') - see PHOTO_PICKER_SETUP.md';
  el.style.color = '#dc2626';
}

// -- OAuth token via GIS (Google Identity Services) ---------------------
// Returns a fresh access token for the requested scope. Uses the token
// client's popup flow the first time and silent renewal thereafter.
async function _getAccessToken(scope) {
  await _loadScript(GIS_SRC);
  const { clientId } = _config();
  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: response => {
          if (response && response.access_token) resolve(response.access_token);
          else reject(new Error(response.error || 'no access token'));
        },
        error_callback: err => reject(new Error(err.type || 'oauth error')),
      });
      client.requestAccessToken({ prompt: '' });    // '' = silent if already granted
    } catch (ex) {
      reject(ex);
    }
  });
}

// ======================================================================
//                          GOOGLE DRIVE PICKER
// ======================================================================
async function _loadPickerLib() {
  await _loadScript(GAPI_SRC);
  await new Promise(res => gapi.load('picker', res));
}

async function _downloadDriveFile(fileId, token) {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (!resp.ok) throw new Error('drive download ' + resp.status);
  return await resp.blob();
}

window.openDrivePicker = async function (slotKey) {
  const missing = _configMissing(true);
  if (missing.length) return _reportConfigMissing(slotKey, missing);

  const statusEl = document.getElementById('photos-' + slotKey + '-status');
  if (statusEl) { statusEl.textContent = 'Opening Google Drive...'; statusEl.style.color = '#6d7a95'; }

  try {
    const [token] = await Promise.all([
      _getAccessToken(DRIVE_SCOPE),
      _loadPickerLib(),
    ]);
    const { apiKey, appId } = _config();

    const view = new google.picker.View(google.picker.ViewId.DOCS_IMAGES);
    view.setMimeTypes('image/png,image/jpeg,image/jpg,image/gif,image/webp,image/heic');

    const picker = new google.picker.PickerBuilder()
      .setAppId(appId)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .addView(view)
      .addView(new google.picker.DocsUploadView())
      .setCallback(async data => {
        if (data.action !== google.picker.Action.PICKED) return;
        const file = data.docs && data.docs[0];
        if (!file) return;
        try {
          if (statusEl) statusEl.textContent = 'Downloading from Drive...';
          const blob = await _downloadDriveFile(file.id, token);
          window.photosAcceptDriveBlob(slotKey, blob);
        } catch (ex) {
          if (statusEl) { statusEl.textContent = 'Drive fetch failed: ' + ex.message; statusEl.style.color = '#dc2626'; }
        }
      })
      .build();
    picker.setVisible(true);
  } catch (ex) {
    if (statusEl) { statusEl.textContent = 'Drive picker failed: ' + ex.message; statusEl.style.color = '#dc2626'; }
  }
};

// ======================================================================
//                        GOOGLE PHOTOS PICKER
// ======================================================================
// The Photos Picker API (session-based, launched late 2024):
//   1. POST /v1/sessions        -> get pickerUri + id
//   2. Open pickerUri in a popup for the user to pick photos
//   3. Poll GET /v1/sessions/:id every ~pollInterval until mediaItemsSet
//   4. GET /v1/mediaItems?sessionId=... -> list of picked items with baseUrl
//   5. Download baseUrl (append =d for full-quality bytes)
//   6. DELETE /v1/sessions/:id  (cleanup)
const PHOTOS_API = 'https://photospicker.googleapis.com/v1';

async function _photosSession(token, method, path, body) {
  const resp = await fetch(PHOTOS_API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) throw new Error(`photos ${method} ${path} -> ${resp.status}`);
  if (resp.status === 204) return null;
  return await resp.json();
}

async function _pollUntilPicked(token, sessionId, initialInterval) {
  // Google returns pollingConfig.pollInterval as a duration string ("2s")
  let intervalMs = initialInterval || 2000;
  const deadline = Date.now() + 10 * 60 * 1000;  // 10-min cap
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const s = await _photosSession(token, 'GET', '/sessions/' + sessionId);
    if (s.mediaItemsSet) return s;
    if (s.pollingConfig && s.pollingConfig.pollInterval) {
      const m = /([\d.]+)s/.exec(s.pollingConfig.pollInterval);
      if (m) intervalMs = Math.max(1000, parseFloat(m[1]) * 1000);
    }
  }
  throw new Error('picker timed out');
}

async function _downloadPhotosItem(baseUrl, token) {
  // "=d" downloads original quality. Photos API base URLs don't need
  // Authorization but sending it doesn't hurt.
  const resp = await fetch(baseUrl + '=d', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!resp.ok) throw new Error('photos download ' + resp.status);
  return await resp.blob();
}

window.openPhotosPicker = async function (slotKey) {
  const missing = _configMissing(false);
  if (missing.length) return _reportConfigMissing(slotKey, missing);

  const statusEl = document.getElementById('photos-' + slotKey + '-status');
  const setStatus = (text, tone) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = tone === 'error' ? '#dc2626' : '#6d7a95';
  };

  let sessionId;
  let popup;
  try {
    setStatus('Opening Google Photos...');
    const token = await _getAccessToken(PHOTOS_SCOPE);

    // 1. Create session
    const session = await _photosSession(token, 'POST', '/sessions', {});
    sessionId = session.id;
    const initialInterval = (() => {
      const m = /([\d.]+)s/.exec(session.pollingConfig && session.pollingConfig.pollInterval);
      return m ? parseFloat(m[1]) * 1000 : 2000;
    })();

    // 2. Popup to pickerUri
    popup = window.open(session.pickerUri, 'photospicker', 'width=900,height=700');
    if (!popup) throw new Error('popup blocked - allow popups for this site');
    setStatus('Waiting for your photo selection...');

    // 3. Poll
    await _pollUntilPicked(token, sessionId, initialInterval);
    if (popup && !popup.closed) popup.close();

    // 4. List picked items
    const listing = await _photosSession(token, 'GET', '/mediaItems?sessionId=' + sessionId + '&pageSize=1');
    const items = listing && listing.mediaItems;
    if (!items || !items.length) throw new Error('no items picked');
    const mediaFile = items[0].mediaFile;
    if (!mediaFile || !mediaFile.baseUrl) throw new Error('picked item has no downloadable url');

    // 5. Download bytes
    setStatus('Downloading from Google Photos...');
    const blob = await _downloadPhotosItem(mediaFile.baseUrl, token);
    window.photosAcceptPhotosBlob(slotKey, blob);
  } catch (ex) {
    setStatus('Photos picker failed: ' + ex.message, 'error');
    if (popup && !popup.closed) popup.close();
  } finally {
    // 6. Cleanup session (best-effort)
    if (sessionId) {
      try {
        const token = await _getAccessToken(PHOTOS_SCOPE);
        await _photosSession(token, 'DELETE', '/sessions/' + sessionId);
      } catch { /* ignore */ }
    }
  }
};
