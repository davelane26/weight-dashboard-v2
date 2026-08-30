/* ════════════════════════════════════════════════════════════════════
   app-config.js — constants + mutable global state
   Loaded FIRST. Everything else depends on these.
   ──────────────────────────────────────────────────────────────────── */

// ── Config ───────────────────────────────────────────────────────────
const DATA_URL     = 'https://davelane26.github.io/Weight-tracker/data.json';
const REFRESH_MS   = 30_000;

// David's own account (see cloudflare-worker/worker.js LEGACY_OWNER_EMAIL).
// Used client-side only to decide whether to show the first-run profile
// setup prompt — David's profile is never saved to the worker, so without
// this check every load would look like "new user, no profile saved yet".
const LEGACY_OWNER_EMAIL = 'djtwo6@gmail.com';

// START_WEIGHT/START_DATE/HEIGHT_IN are `let`, not `const`, on purpose:
// they're David's own numbers below, but for any OTHER signed-in user
// app.js's loadProfile() overwrites them at boot from the worker's
// per-user /profile endpoint before the first render. Every other script
// reads these by name (shared top-level scope, see file header) so a
// reassignment here is picked up everywhere without touching those files.
let START_WEIGHT = 315.0;
let START_DATE   = 'Jan 29, 2026';

// Reconciled Aug 12, 2026: doctor's office stadiometer reads 74.8 in
// across multiple visits, which supersedes both openScale's default
// (75.0 in, self-reported) and the Jul 27, 2026 DEXA one-off (74.0 in).
// Recurring stadiometer measurements beat a single lab snapshot; the
// 0.8 in gap between them is well within diurnal spinal-compression
// variation (~0.5-1 in through the day). BMI is recomputed against
// this constant in loadData() so the correction applies across all
// history, not just new readings.
let HEIGHT_IN = 74.8; // `let`, not `const` — see START_WEIGHT/START_DATE above

const ACTIVITY_LEVELS = {
  sedentary:   { label: 'Sedentary',   desc: 'Desk job, little or no exercise',       multiplier: 1.2   },
  light:       { label: 'Light',       desc: 'Light exercise 1-3 days/week',          multiplier: 1.375 },
  moderate:    { label: 'Moderate',    desc: 'Moderate exercise 3-5 days/week',       multiplier: 1.55  },
  active:      { label: 'Active',      desc: 'Hard exercise 6-7 days/week',           multiplier: 1.725 },
  very_active: { label: 'Very Active', desc: 'Physical job or twice-daily training',  multiplier: 1.9   },
};

const BMI_CATS = [
  { label: 'Normal Weight',  range: 'BMI < 25',    min: 18.5, max: 25,       icon: '🟢' },
  { label: 'Overweight',     range: 'BMI 25–29.9', min: 25,   max: 30,       icon: '🟡' },
  { label: 'Obese I',        range: 'BMI 30–34.9', min: 30,   max: 35,       icon: '🟠' },
  { label: 'Obese II',       range: 'BMI 35–39.9', min: 35,   max: 40,       icon: '🔴' },
  { label: 'Obese III',      range: 'BMI ≥ 40',    min: 40,   max: Infinity, icon: '⚫' },
];

// ── Module visibility toggles ────────────────────────────────────────
// Flip a module OFF to hide ALL its UI (snapshot chip, tab button in
// desktop + mobile nav, tab panel). Doesn't affect the background
// fetch pipeline -- flip back ON months later and the data is still
// there, no re-wiring needed.
const SHOW_GLUCOSE  = false;  // flip to true when tracking resumes

const ALL_TABS      = ['weight', 'charts', 'glucose', 'activity', 'workout', 'projector', 'medication', 'photos', 'health'];
const HIDDEN_TABS   = new Set([
  ...(SHOW_GLUCOSE ? [] : ['glucose']),
]);
const TABS          = ALL_TABS.filter(t => !HIDDEN_TABS.has(t));
const TAB_ORDER_KEY = 'wt_v2_tab_order';

// ── Mutable global state ─────────────────────────────────────────────
// These are top-level `let` bindings, shared across all scripts via
// the document's global lexical environment (see MDN: classic scripts
// share top-level let/const but they are NOT properties of `window`).
let allData            = [];
let goalWeight         = null;
let charts             = {};
let chartRange         = 'all';
let activityLevel      = 'moderate';

// Projection calculator state — updated by renderJourney on every data load
let projSlopeLbsPerDay = null;   // negative = losing weight
let projLatestWeight   = null;
let projLatestDate     = null;

