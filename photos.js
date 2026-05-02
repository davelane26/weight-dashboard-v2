/* photos.js — Progress Photos tab (password-protected) */

const PHOTOS_VALID_USER = 'davidl';
const PHOTOS_PWD_HASH   = '7fdea8308127cece9bcdcca362a887b96ca2c6e84462a4d53c64ef241a73d1e5';

async function _photosHash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function photosLogin() {
  const user  = (document.getElementById('photos-username').value || '').trim();
  const pass  = document.getElementById('photos-password').value || '';
  const errEl = document.getElementById('photos-login-error');
  if (user !== PHOTOS_VALID_USER) { errEl.style.display = 'block'; return; }
  const hash = await _photosHash(pass);
  if (hash !== PHOTOS_PWD_HASH) { errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  sessionStorage.setItem('photos_authed', '1');
  _photosShowContent();
}

function photosLogout() {
  sessionStorage.removeItem('photos_authed');
  document.getElementById('photos-login').style.display = '';
  document.getElementById('photos-content').style.display = 'none';
  document.getElementById('photos-username').value = '';
  document.getElementById('photos-password').value = '';
}

function _photosShowContent() {
  document.getElementById('photos-login').style.display = 'none';
  document.getElementById('photos-content').style.display = '';
  _photosLoadPreviews();
}

function _photosLoadPreviews() {
  ['before', 'after'].forEach(side => {
    const data = localStorage.getItem('photos_img_' + side);
    if (data) _photosSetPreview(side, data);
  });
}

function _photosSetPreview(side, dataUrl) {
  const el = document.getElementById('photos-' + side + '-preview');
  if (!el) return;
  el.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;height:auto;border-radius:8px;display:block';
  el.appendChild(img);
}

function photosHandleUpload(side, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    try {
      localStorage.setItem('photos_img_' + side, dataUrl);
    } catch (ex) {
      alert('Image is too large to store locally. Try a smaller or compressed photo.');
      return;
    }
    _photosSetPreview(side, dataUrl);
  };
  reader.readAsDataURL(file);
}

document.addEventListener('DOMContentLoaded', () => {
  const pwd = document.getElementById('photos-password');
  if (pwd) pwd.addEventListener('keydown', e => { if (e.key === 'Enter') photosLogin(); });

  const bBtn = document.getElementById('photos-before-btn');
  const aBtn = document.getElementById('photos-after-btn');
  if (bBtn) bBtn.addEventListener('click', () => document.getElementById('photos-before-input').click());
  if (aBtn) aBtn.addEventListener('click',  () => document.getElementById('photos-after-input').click());

  const bInput = document.getElementById('photos-before-input');
  const aInput = document.getElementById('photos-after-input');
  if (bInput) bInput.addEventListener('change', function() { photosHandleUpload('before', this); });
  if (aInput) aInput.addEventListener('change', function() { photosHandleUpload('after',  this); });

  if (sessionStorage.getItem('photos_authed') === '1') _photosShowContent();
});

window.photosLogin  = photosLogin;
window.photosLogout = photosLogout;
