/* ════════════════════════════════════════════════════════════════════
   app-config.js — constants + mutable global state
   Loaded FIRST. Everything else depends on these.
   ──────────────────────────────────────────────────────────────────── */

// ── Config ───────────────────────────────────────────────────────────
const DATA_URL     = 'https://davelane26.github.io/Weight-tracker/data.json';
const START_WEIGHT = 315.0;
const START_DATE   = 'Jan 23, 2026';
const REFRESH_MS   = 30_000;

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

const TABS          = ['weight', 'glucose', 'activity', 'projector', 'medication', 'photos', 'health'];
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
