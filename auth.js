import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Fill in from Firebase Console → Project Settings → Your apps → Web app
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "weight-dashboard-6b5f3.firebaseapp.com",
  databaseURL:       "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com",
  projectId:         "weight-dashboard-6b5f3",
  storageBucket:     "weight-dashboard-6b5f3.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app      = initializeApp(FIREBASE_CONFIG);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

window.fbUser = null;

window.fbSignIn = async () => {
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.style.display = 'none';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign-in failed:', e);
    if (errEl) errEl.style.display = 'block';
  }
};

window.fbSignOut = () => signOut(auth);

onAuthStateChanged(auth, user => {
  window.fbUser = user;

  // Resolve the auth-ready promise (window._resolveAuthReady set by index.html inline script)
  if (window._resolveAuthReady) {
    window._resolveAuthReady(user);
    window._resolveAuthReady = null;
  }

  const overlay    = document.getElementById('auth-overlay');
  const signOutBtn = document.getElementById('header-signout-btn');
  if (overlay)    overlay.style.display    = user ? 'none' : 'flex';
  if (signOutBtn) signOutBtn.style.display = user ? '' : 'none';

  document.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user } }));
});
