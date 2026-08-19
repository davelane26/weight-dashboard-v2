# Glapp Shot Sync (zero-touch)

Headless Playwright cron that scrapes your Glapp shot log every hour
and pushes it to Firebase `/glapp_inbox/shots.json`. The dashboard's
Medication tab auto-imports the inbox on load (see `medication.js`
`importFromGlappInbox`), so once this is running you never touch
Glapp -> dashboard again.

Shares the exact same scraper code as the bookmarklet
(`bookmarklets/glapp-sync.js`) via `window.__glappSync` — DRY. Fix a
selector once, both paths benefit.

## Architecture

```
Glapp (phone or web) -- you log shots here (only manual step)
        |
Windows Task Scheduler (hourly)
        v
RUN_SYNC.bat -> glapp_sync.py
        |
        + loads glapp_state.json  (cookies + localStorage from login)
        + navigates headless to logs_url
        + injects bookmarklets/glapp-sync.js
        + awaits window.__glappSync()  ->  PUT /glapp_inbox/shots.json
        v
Firebase /glapp_inbox/shots.json
        |
Dashboard boot -> importFromGlappInbox() -> merges into localStorage['glp1_v4']
```

## One-time setup

1. **Create an isolated venv** (per repo convention -- keeps the
   Playwright install from bleeding into other projects):

   ```powershell
   cd C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\glapp_sync
   uv venv .glapp_venv
   .glapp_venv\Scripts\activate
   uv pip install --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple `
                  --allow-insecure-host pypi.ci.artifacts.walmart.com `
                  -r requirements.txt
   playwright install chromium
   ```

2. **Log in once** so the cron has a saved session to reuse:

   ```powershell
   python glapp_login.py
   ```

   A Chrome window opens. Log in normally. When you can see the
   "All logs" shot table, come back to the terminal and press Enter.
   The script saves `glapp_state.json` (cookies + localStorage).

3. **Confirm the URLs.** `glapp_config.json` has default guesses for
   `login_url` and `logs_url`. If Glapp uses different paths, edit
   those two values.

4. **Verify Firebase rules** — the RTDB must allow anon writes to
   `/glapp_inbox`:

   ```json
   "glapp_inbox": {
     ".read":  true,
     ".write": true
   }
   ```

5. **Register the scheduled task** (right-click, Run as Administrator):

   ```
   SETUP_SCHEDULER.bat
   ```

   Task Scheduler will run `RUN_SYNC.bat` every hour. First run happens
   immediately so you can `type sync.log` and see if it worked.

## Files

| File | Purpose |
|---|---|
| `glapp_login.py`      | One-time headed login. Saves `glapp_state.json`. |
| `glapp_sync.py`       | Headless scraper. Reads state, injects bookmarklet code, pushes. |
| `glapp_config.json`   | Overridable `login_url` / `logs_url`. |
| `glapp_state.json`    | Saved cookies + localStorage from `glapp_login.py`. Generated, gitignored. |
| `RUN_SYNC.bat`        | Task Scheduler entry point. Runs `glapp_sync.py`, appends to `sync.log`. |
| `SETUP_SCHEDULER.bat` | Registers the hourly task. Idempotent. |
| `sync.log`            | Append-only log. Grep-friendly timestamps. |
| `requirements.txt`    | `playwright` (Chromium installed via `playwright install chromium`). |

## Session lifetime

Glapp sessions appear to live for weeks or months. When the cron
starts failing with a redirect to the login page (visible in
`sync.log`), re-run `python glapp_login.py` to refresh
`glapp_state.json`. Everything else stays put.

## Troubleshooting

- **`ERROR: no saved session`** -- you haven't run `glapp_login.py` yet.
- **`ERROR: navigation failed`** -- Glapp URL changed. Edit
  `glapp_config.json` -> `logs_url`.
- **`shot-table-not-found`** in sync.log -- the logs page loaded but the
  scraper couldn't find the Date/Dosage headers. The layout may have
  changed. Fix `bookmarklets/glapp-sync.js` `findShotTable` -- the fix
  applies to BOTH the bookmarklet and this cron because they share code.
- **Dashboard doesn't show new shots** -- open the dashboard, F12
  console, run `await window.importFromGlapp()` -- it returns
  `{added, skipped}`. If `added > 0`, cache issue; hard-refresh.

## Why hourly and not per-week

Shots are weekly (Wednesdays), so hourly is overkill. But:
- The scraper is idempotent (deterministic ids `glapp_YYYY-MM-DD`).
- Hourly gives ~1-hour ceiling on how stale the dashboard ever is.
- Cost is one headless page load per hour on your idle home PC.
- Cheap insurance against you logging a Sunday shot mid-week and
  wanting it visible immediately.

Bump to `/sc daily /st 08:00` in `SETUP_SCHEDULER.bat` if you'd rather
run once a day.
