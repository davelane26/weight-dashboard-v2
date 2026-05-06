/* photos.js — Progress Photos tab */

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
  _photosLoadPreviews();

  const bBtn = document.getElementById('photos-before-btn');
  const aBtn = document.getElementById('photos-after-btn');
  if (bBtn) bBtn.addEventListener('click', () => document.getElementById('photos-before-input').click());
  if (aBtn) aBtn.addEventListener('click',  () => document.getElementById('photos-after-input').click());

  const bInput = document.getElementById('photos-before-input');
  const aInput = document.getElementById('photos-after-input');
  if (bInput) bInput.addEventListener('change', function() { photosHandleUpload('before', this); });
  if (aInput) aInput.addEventListener('change', function() { photosHandleUpload('after',  this); });
});
