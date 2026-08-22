# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal health/weight dashboard: vanilla HTML/CSS/JS, no build step, no
framework, no `package.json`. Served as a static site via GitHub Pages
directly from `main` (https://davelane26.github.io/weight-dashboard-v2/).
**There is no CI build/deploy step for the dashboard itself** — whatever is
on `main` is what's live within a minute or two of pushing. A fix on a
feature branch does nothing for the live site until it's merged to `main`.

The repo also hosts several independent data-ingestion pipelines (Python
sync scripts, a Cloudflare Worker, an Android app) that feed the dashboard
different slices of health data. These pipelines deploy very differently
from each other and from the dashboard — see "Deployment surfaces" below,
since assuming "pushed to GitHub" means "live" is the most common way to
lose time here.

## Commands

**Local dev (dashboard):**
```bash
python -m http.server 8900
# open http://localhost:8900
```
No lint/build/test command exists for the JS/HTML/CSS — it's checked by
hand in a browser.

**Python sync scripts** (`garmin_sync/`, `glapp_sync/`, root-level
`fetch_*.py`): each has (or shares) a `requirements.txt`; `pip install -r
requirements.txt` then run the script directly. There's no pytest suite —
files like `garmin_sync/test_cookies.py` and `garmin_sync/proxy_test.py`
are standalone manual smoke-test scripts, run directly with `python`, not
part of an automated suite.

**Android app** (`android/`, package `com.davelane.kagehealth`, nicknamed
"Kage"): built by CI (`.github/workflows/android-build.yml`) on every push
touching `android/**` — produces a debug APK as a workflow artifact
(`kage-health-bridge-debug`), signed with a cached debug keystore so it
always installs as an update rather than conflicting. There's no Play
Store release path. After any `android/` change, a new APK must be
downloaded from the Actions run and manually sideloaded — editing the
Kotlin source does nothing to an already-installed phone until that
happens. Bump `versionCode`/`versionName` in `android/app/build.gradle.kts`
when changing what `WorkerClient.kt` sends, per existing convention.

## Architecture

### Dashboard script loading

`index.html` loads ~30 classic (non-module) scripts in a fixed order;
`app-config.js` must load first since later scripts depend on its
top-level `let`/`const` globals (shared via the document's lexical scope,
not `window` properties). `app-tabs.js` controls which tabs exist
(`ALL_TABS`/`HIDDEN_TABS`/`TABS` in `app-config.js`) — features are often
toggled off via a `SHOW_*` boolean rather than deleted, so a "missing"
tab may just be flagged off, not removed. Check `REMOVED_FEATURES.md`
before assuming a missing feature is a bug or reimplementing it from
scratch — it documents intentional removals with git-tag-based recovery
instructions (e.g. the glucose tab).

### Two separate data domains — don't conflate them

1. **Weight data** (the core dashboard: weight, BMI, body comp, goal
   projection) comes from a **different, private repo**
   (`Weight-tracker`), fetched cross-origin via `DATA_URL` in
   `app-config.js`. It's fed by openScale on the user's phone. This repo
   does not contain that data or its ingestion pipeline.
2. **Activity/health data** (steps, sleep, HR, workouts, etc. — the
   Activity tab, driven by `activity.js`) comes from **this repo's**
   `health.json`, assembled from multiple sources that get merged
   client-side. See next section.

### Activity data: multi-source merge

`activity.js` `loadActivityData()` fetches, in order, and merges
per-field (not per-record — a live source's non-null field overwrites the
static source's field for the same date, via `_mergeDaysByDate`):

1. **`health.json`** in this repo (static, historical) — written by
   `samsung_health_bridge/sync_and_push.py`, which runs as an **hourly
   Windows Scheduled Task on a separate home PC ("djtwo")**, not in CI.
   Pulls Galaxy Watch data via Samsung Health → Health Sync app → Google
   Drive → rclone → parsed → committed + pushed to this repo. See
   `samsung_health_bridge/HEALTH_BRIDGE.md` for the full pipeline diagram
   and a troubleshooting checklist — start there before assuming a code
   bug when Activity-tab data looks stale, since this pipeline has no CI
   visibility and can silently stop running.
2. **Cloudflare Worker `/health.json`** (live, KV-backed) — populated by
   the Kage Android app posting to `/health/patch` roughly every 15 min,
   plus (historically) Garmin sync scripts. This overlay is what makes
   steps/HR/calories feel "live" even when the Samsung Health static file
   is stale.
3. Firebase `/garmin/latest.json` — legacy last-resort fallback.

**Field-naming gotcha:** `intensityMinutes` and `workoutsMins` are two
*different* workout-minutes metrics that are deliberately NOT the same
field, by design, not oversight: `intensityMinutes` is meant to hold
Garmin's real HR-zone-based intensity minutes (moderate + 2×vigorous),
sourced from a manual browser bookmarklet (`bookmarklets/garmin-sync.js`)
run against Garmin Connect. `workoutsMins` is a simpler sum-of-session-
durations figure, written by both the Samsung Health bridge and Kage.
Kage deliberately does not send `intensityMinutes` (see the comment in
`WorkerClient.kt`) so it can't clobber the bookmarklet's more accurate
number. Dashboard KPI tiles that show "workout minutes" should read
`intensityMinutes ?? workoutsMins` (see `activity.js`), not just one or
the other, or they'll go blank for anyone not using the bookmarklet.

### Deployment surfaces — each is different, know which one you're touching

| Surface | Trigger | Notes |
|---|---|---|
| Dashboard (root JS/HTML/CSS) | Push to `main` | GitHub Pages, no build. Live within ~1-2 min. |
| `cloudflare-worker/worker.js` (Worker `glucose-relay`) | Push to `main` touching `cloudflare-worker/**` | `.github/workflows/deploy-worker.yml` runs `wrangler deploy`, using `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets and `cloudflare-worker/wrangler.toml` (declares the `GLUCOSE_KV` KV namespace and `WEIGHT_DB` D1 binding — **both must stay declared**, since `wrangler deploy` treats `wrangler.toml`'s binding list as authoritative and will silently drop any live binding missing from it). Runtime secrets (`API_SECRET`, `ALLOWED_EMAILS`, `ANTHROPIC_API_KEY`) live on the Worker itself, untouched by deploys. |
| `android/` (Kage app) | Push to `main` (or any branch) touching `android/**` | `android-build.yml` builds a debug APK artifact; still needs manual sideload onto the phone. |
| `samsung_health_bridge/` | **Nothing automatic** | Runs on djtwo's own Scheduled Task, outside GitHub entirely. Editing the parser in this repo doesn't affect the running bridge until someone pulls the change there. |
| Legacy Garmin pipelines (`garmin_sync/`, `.github/workflows/garmin-sync.yml`, `sync-garmin.yml`) | Cron via GitHub Actions, `self-hosted` runner | Every run has failed since ~April 2026 and the self-hosted runner appears offline — effectively dead, superseded by the Samsung Health bridge + Kage. Don't assume these still work; don't "fix" them without confirming the user actually wants this path revived rather than removed. |
