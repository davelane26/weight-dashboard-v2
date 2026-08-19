# Glapp Shot Sync -- zero-touch setup for HOME PC

Automates pulling shot logs from Glapp into the weight dashboard so you
only ever enter shots ONCE (in Glapp on your phone). Runs as an hourly
Windows scheduled task using a headless Chromium.

**Where this lives on GitHub:** https://github.com/davelane26/weight-dashboard-v2/tree/main/glapp_sync

## What actually happens once this is set up

```
Glapp (log shot on phone)                <- ONLY thing you do manually
       |
[Windows Task Scheduler, hourly]
       |
RUN_SYNC.bat -> glapp_sync.py (headless Chromium)
       |  * loads glapp_state.json (saved cookies from one-time login)
       |  * navigates to Glapp logs page
       |  * injects bookmarklets/glapp-sync.js
       |  * pushes shot table to Firebase /glapp_inbox/shots.json
       v
Firebase /glapp_inbox/shots.json
       |
Dashboard on load -> auto-runs importFromGlappInbox()
       |  * merges non-duplicate shots into localStorage['glp1_v4']
       |  * pushes merged store to /medication/shots (cross-device)
       v
Medication tab shows fresh shots. Zero clicks.
```

## Prerequisites (should already have these)

- Windows
- Python 3.10+
- `uv` (https://github.com/astral-sh/uv)
- Git
- `weight-dashboard-v2` cloned somewhere

## Step 1 -- find and pull the repo

Open PowerShell and locate your clone. If you don't remember where it is:

```powershell
Get-ChildItem -Path $HOME -Recurse -Directory -Filter "weight-dashboard-v2" -ErrorAction SilentlyContinue | Select-Object FullName
```

If nothing pops out, clone fresh:

```powershell
cd $HOME
git clone https://github.com/davelane26/weight-dashboard-v2.git
```

Then pull latest:

```powershell
cd <path-to>\weight-dashboard-v2
git pull origin main
```

## Step 2 -- create the venv and install Playwright

```powershell
cd glapp_sync
uv venv .glapp_venv
.glapp_venv\Scripts\activate
uv pip install -r requirements.txt
playwright install chromium
```

The venv lives at `glapp_sync\.glapp_venv\` and is gitignored. Both
`RUN_SYNC.bat` and manual runs auto-detect and use it.

## Step 3 -- one-time login (saves your session)

```powershell
python glapp_login.py
```

- A Chrome window opens on Glapp.
- Log in normally (Google, email, whatever).
- Navigate to the page with the shot log table (Date / Medication /
  Dosage columns visible).
- Come back to the terminal and press Enter.

The script saves `glapp_state.json` -- cookies + localStorage the
headless cron will reuse forever (Glapp sessions last weeks/months).

**If the script warns "Could not find Date/Dosage headers":** the URL
in `glapp_config.json` doesn't point at the shot log page. Edit
`glapp_config.json` -> `logs_url` to the correct URL, then re-run
`python glapp_login.py`.

## Step 4 -- verify Firebase rules (one-time)

In Firebase Console -> Realtime Database -> Rules, make sure this
node exists (add it inside the top-level `"rules"` object):

```json
"glapp_inbox": {
  ".read":  true,
  ".write": true
}
```

Without this, the sync will fail with `HTTP 401` in the log.

## Step 5 -- test one manual run BEFORE wiring the schedule

```powershell
python glapp_sync.py
type sync.log
```

Look for `OK: pushed N shots. First=... Last=...` in the log.

If it fails, see the Troubleshooting section below.

## Step 6 -- register the hourly Task Scheduler job

**Right-click `SETUP_SCHEDULER.bat` -> Run as Administrator**
(admin is needed for `/rl HIGHEST`).

Or from an already-elevated PowerShell:

```powershell
.\SETUP_SCHEDULER.bat
```

It creates a task named `GlappShotSync`, sets it to run hourly, and
runs it once immediately. After that it runs autonomously.

To confirm the task exists:

```powershell
schtasks /query /tn GlappShotSync
```

To remove it later:

```powershell
schtasks /delete /tn GlappShotSync /f
```

## Files in this folder

| File | Purpose |
|---|---|
| `glapp_login.py`      | One-time headed login. Saves `glapp_state.json`. |
| `glapp_sync.py`       | Headless scraper. Reads state, injects bookmarklet code, pushes. |
| `glapp_config.json`   | Overridable `login_url` / `logs_url`. |
| `glapp_state.json`    | Saved cookies + localStorage. Generated, gitignored. |
| `RUN_SYNC.bat`        | Task Scheduler entry point. Runs `glapp_sync.py`, appends to `sync.log`. |
| `SETUP_SCHEDULER.bat` | Registers the hourly task. Idempotent. |
| `sync.log`            | Append-only log with timestamps. Gitignored. |
| `requirements.txt`    | `playwright`. |
| `README.md`           | This file. |
| `.glapp_venv/`        | Local venv. Gitignored. |

## Troubleshooting

### `sync.log` says `shot-table-not-found`
The logs page loaded but the scraper couldn't find Date / Dosage headers.
Either the URL is wrong or Glapp's layout changed.

- Fix URL: edit `glapp_config.json` -> `logs_url`.
- Fix scraper: edit `..\bookmarklets\glapp-sync.js` -> `findShotTable`.
  Same file is used by the bookmarklet AND this cron, so one fix
  covers both paths.

### `sync.log` says `push-failed: HTTP 401`
Firebase rules missing. See Step 4.

### `sync.log` says `navigation failed` or times out
Glapp URL changed. Fix `glapp_config.json` -> `logs_url`.

### `sync.log` shows `no saved session`
`glapp_state.json` doesn't exist. Re-run `python glapp_login.py`.

### Sync used to work, now silently redirects to login
Glapp session expired. Re-run `python glapp_login.py` to refresh
`glapp_state.json`. Everything else stays put.

### Dashboard doesn't show shots even after cron ran
Open the dashboard, F12 console, run:

```javascript
await window.importFromGlapp()
```

If it returns `{added: N, skipped: M}` with N > 0, the cron worked --
you were just looking at a cached page. Hard-refresh
(`Ctrl+Shift+R`).

If it returns `{added: 0, skipped: 0, error: "..."}`, Firebase can't
be reached from the dashboard. Check `/glapp_inbox` in the Firebase
console -- if it's empty, the cron never wrote.

### Home PC sleeps overnight
Task Scheduler jobs don't run while the machine is asleep. Sync
resumes when the PC wakes -- not a bug, just something to know.
If you want it to wake the PC:

```powershell
schtasks /change /tn GlappShotSync /RL HIGHEST /IT
# Then in Task Scheduler UI: General tab -> "Wake the computer to run this task"
```

## Manual escape hatches (if the cron ever breaks)

You always have two backup paths that don't require this cron:

1. **Bookmarklet** -- drag "Glapp Sync" from
   https://davelane26.github.io/weight-dashboard-v2/bookmarklets/
   to your bookmarks bar. Click while on Glapp, then click
   "Import from Glapp" in the dashboard Medication tab.

2. **Manual entry** -- the dashboard's Medication tab still has the
   original Log Shot flow. Nothing about this cron removes that.

## Design notes (for future you)

- **Why an inbox path** instead of writing to `/medication/shots.json`
  directly: `/medication/shots.json` is auth-gated with Firebase
  tokens. Neither the bookmarklet (Glapp origin) nor the cron
  (headless, no user session) has access to those tokens. The public
  `/glapp_inbox` mirrors the Garmin pattern. The dashboard owns the
  merge, so Glapp can never clobber hand-curated fields like `weight`
  that live only in the dashboard.

- **Why deterministic IDs** (`glapp_YYYY-MM-DD`): re-running the
  bookmarklet or the cron is safe -- same shot always gets the same
  ID, so `importFromGlappInbox` dedupes cleanly.

- **Why share the JS scraper with the bookmarklet**: DRY. Fix Glapp's
  layout once in `bookmarklets/glapp-sync.js` `findShotTable` and
  both paths get it. The cron sets `window.__glappHeadless = true`
  before injection so it awaits the promise instead of hitting the
  bookmarklet's `alert()` branch.

- **Why hourly** despite shots being weekly: cron cost is one page
  load per hour on an idle PC, scraper is idempotent, and it caps
  dashboard staleness at ~1 hour. Change to `/sc daily /st 08:00`
  in `SETUP_SCHEDULER.bat` if that's overkill.
