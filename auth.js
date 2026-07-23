import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

// Fill in from Firebase Console → Project Settings → Your apps → Web app
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDXkJd61sUGWdcTm5sOe7fIKxPNu-z0DjY",
  authDomain:        "weight-dashboard-6b5f3.firebaseapp.com",
  databaseURL:       "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com",
  projectId:         "weight-dashboard-6b5f3",
  storageBucket:     "weight-dashboard-6b5f3.firebasestorage.app",
  messagingSenderId: "811571888069",
  appId:             "1:811571888069:web:149ea5fe30a320384b95ac",
};

// -- Allow-list -------------------------------------------------------
// SECURITY: without this, ANY Google account on Earth can sign in and
// see the dashboard. List the exact email(s) allowed through. Everyone
// else gets bounced with an "access denied" message and signed out.
//
//   Replace the placeholder below with YOUR real Google email.
//   While the placeholder is still present we FAIL OPEN (allow anyone)
//   so you don't lock yourself out before configuring it -- but a loud
//   console warning fires every load until you fix it.
//
// NOTE: this is a client-side gate. It stops casual access to the UI,
// but the data.json is still public (see Fix #2 -- move data behind the
// Cloudflare Worker with token verification to truly protect it).
const ALLOWED_EMAILS = [
  'djtwo6@gmail.com',
];

function isAllowed(user) {
  if (!user || !user.email) return false;
  const email = user.email.toLowerCase();
  const stillPlaceholder = ALLOWED_EMAILS.some(e => e.startsWith('REPLACE_WITH_'));
  if (stillPlaceholder) {
    console.warn(
      '[auth] ALLOW-LIST NOT CONFIGURED -- failing OPEN (anyone can sign in). ' +
      'Edit ALLOWED_EMAILS in auth.js with your real Google email to lock this down.'
    );
    return true; // fail-open until configured, so you can't lock yourself out
  }
  return ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email);
}

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
  // Enforce the allow-list: a signed-in but NON-allowed user is treated
  // as unauthenticated (kick them back to the overlay and sign them out).
  const authed = isAllowed(user);

  if (user && !authed) {
    // Someone signed in with a Google account that isn't on the list.
    const errEl = document.getElementById('auth-error');
    if (errEl) {
      errEl.textContent = 'That account isn\u2019t authorized for this dashboard.';
      errEl.style.display = 'block';
    }
    signOut(auth);              // will re-fire onAuthStateChanged with null
    window.fbUser = null;
    return;
  }

  window.fbUser = authed ? user : null;

  // Resolve the auth-ready promise (window._resolveAuthReady set by index.html inline script)
  if (window._resolveAuthReady) {
    window._resolveAuthReady(window.fbUser);
    window._resolveAuthReady = null;
  }

  const overlay    = document.getElementById('auth-overlay');
  const signOutBtn = document.getElementById('header-signout-btn');
  if (overlay)    overlay.style.display    = authed ? 'none' : 'flex';
  if (signOutBtn) signOutBtn.style.display = authed ? '' : 'none';

  document.dispatchEvent(new CustomEvent('firebase-auth-changed', { detail: { user: window.fbUser } }));
});
