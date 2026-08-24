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
on every `android/` change, not just ones that change what `WorkerClient.kt`
sends — Android's installer silently refuses to install an APK whose
`versionCode` is lower than what's already on the phone (same signing
cert = treated as a downgrade), surfaced as the generic, misleading "App
not installed as package appears to be invalid" with no mention of
versions. This bit us on 2026-08-24: a `git revert` of the Kage
weight-sync detour correctly reverted the code but also reverted
`versionCode` from 17 back down to 15, silently breaking sideloading for
anyone who'd installed the detour builds. **Never let versionCode go
backwards** — even a revert-to-earlier-behavior commit must use a new,
higher versionCode than anything ever built and distributed. (The CI
"Verify APK signing cert" step printing `Not a signed jar file` is a red
herring, not a sign of a broken build: `keytool -printcert -jarfile` only
understands the legacy JAR v1 signing scheme, not the APK Signature
Scheme v2/v3 that AGP debug builds actually use — it prints that on every
build, working ones included.)

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
   (`Weight-tracker`), read live by the dashboard via the Worker's
   Firebase-gated `GET /weight.json` (KV-backed), falling back to the
   public `DATA_URL` in `app-config.js` if that fails. This repo does not
   contain that data. Two independent pipelines feed it, both sourced
   from openScale on the phone, firing off the *same* underlying weigh-in
   event but writing to different places:
   - **openScale's built-in Webhook service** → `POST
     /weight/openscale-webhook` in `worker.js` — the primary pipeline as of
     2026-08-24. Three payload shapes from openScale itself: a bulk
     `{event, measurements: [...]}` dump (guarded full-replace) from manual
     Test/Sync taps, a flat single-object payload (safe merge-by-date) on a
     real auto-fired weigh-in, and `{event: "delete", date}` (removes the
     matching entry) when a reading is deleted in the app — see
     `convertOpenScaleMeasurement`/`mergeWeightEntry`/`formatOpenScaleDate`
     in `worker.js`. Any other shape gets captured (not 400'd, so
     openScale's own retry queue doesn't get stuck) to KV for inspection
     via `GET /weight/openscale-webhook-debug?key=<OPENSCALE_WEBHOOK_SECRET>`.
     Gated by the `OPENSCALE_WEBHOOK_SECRET` Worker secret checked against
     the raw `Authorization` header value (openScale's Webhook UI only
     exposes that one auth field, not a named header). **Bulk syncs write
     both KV and git** (`writeWeightToGitHub` in `worker.js`, needs the
     `WEIGHT_TRACKER_GITHUB_TOKEN` secret — a token scoped to Contents:
     read/write on `davelane26/weight-tracker` only) — same "every sync is
     a full-table rewrite" convention MQTT used, so tapping "Sync with
     Webhook" in openScale is now a one-button way to get a git-backed
     backup/history snapshot without the MQTT bridge running. A failed git
     commit never blocks the KV write (KV is what the live dashboard
     reads) — it's just captured to the same debug key for inspection.
     Real-time single-record auto-fires stay KV-only (no commit-per-
     weigh-in); git just lags to the last bulk sync, same as MQTT always did.
   - **MQTT bridge** (home PC, `mqtt_bridge.py`, see `MQTT_BRIDGE.md`) — now
     **optional/dormant**, kept only as a secondary backup/history writer to
     git (`Weight-tracker/data.json`, full table rewrite each sync). Not
     needed for the live dashboard to work — the webhook covers that on its
     own. Safe to leave its autostart disabled and run it manually
     (`schtasks /run /tn WeightTrackerMQTTBridge`) whenever you want a
     cross-check/backup snapshot; every sync is a full-table dump so it
     doesn't matter how long it's been off. `Weight-tracker`'s own git→KV
     mirror Action (which used to be how MQTT's writes reached the live
     dashboard) is now redundant now that the webhook writes both sides
     directly — pending confirmation it's working, it can be retired.
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
| `cloudflare-worker/worker.js` (Worker `glucose-relay`) | Push to `main` touching `cloudflare-worker/**` | `.github/workflows/deploy-worker.yml` runs `wrangler deploy`, using `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets and `cloudflare-worker/wrangler.toml` (declares the `GLUCOSE_KV` KV namespace and `WEIGHT_DB` D1 binding — **both must stay declared**, since `wrangler deploy` treats `wrangler.toml`'s binding list as authoritative and will silently drop any live binding missing from it). Runtime env vars (`API_SECRET`, `API_SECRET_V2`, `ALLOWED_EMAILS`, `ANTHROPIC_API_KEY`) survive deploys **only if their type is set to Secret** (dashboard → Settings → Variables and Secrets), never plain Variable — the same "wrangler.toml is authoritative" rule that governs bindings also deletes any undeclared plain Variable. This already happened once: `ALLOWED_EMAILS` was a plain Variable, the first automated deploy silently wiped it, and every Firebase-gated dashboard endpoint (`weight.json`, `/photo`, `/workout-schedule`) 401'd for everyone until it was re-added as a Secret. Before ever running `wrangler deploy` again after a manual dashboard edit, check that panel for anything typed "Variable" instead of "Secret". Conversely, **adding or editing a secret through the dashboard doesn't necessarily make it live immediately** — Cloudflare's dashboard does versioned/gradual deployments, and a secret saved through the UI can land on a version that isn't the one actually serving production traffic yet. This bit us on 2026-08-24: `WEIGHT_TRACKER_GITHUB_TOKEN` was added, confirmed correctly named and persisted (survived a page refresh), but `GET /weight/openscale-webhook-debug` kept reporting it as unset for several minutes — a fresh `wrangler deploy` (triggered manually via `workflow_dispatch` on `deploy-worker.yml`) immediately fixed it. **After adding or changing a secret via the dashboard, trigger a redeploy** (push a no-op change, or run `deploy-worker.yml` via `workflow_dispatch`) rather than assuming "saved" means "live" — don't spend time debugging the Worker's logic first. |
| `android/` (Kage app) | Push to `main` (or any branch) touching `android/**` | `android-build.yml` builds a debug APK artifact; still needs manual sideload onto the phone. |
| `samsung_health_bridge/` | **Nothing automatic** | Runs on djtwo's own Scheduled Task, outside GitHub entirely. Editing the parser in this repo doesn't affect the running bridge until someone pulls the change there. |
| Legacy Garmin pipelines (`garmin_sync/`, `.github/workflows/garmin-sync.yml`, `sync-garmin.yml`) | Cron via GitHub Actions, `self-hosted` runner | Every run has failed since ~April 2026 and the self-hosted runner appears offline — effectively dead, superseded by the Samsung Health bridge + Kage. Don't assume these still work; don't "fix" them without confirming the user actually wants this path revived rather than removed. |
