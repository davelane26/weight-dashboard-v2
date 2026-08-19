#  Samsung Health Bridge — Setup & Troubleshooting

How Galaxy Watch data (steps, sleep, heart rate, workouts) gets from
Samsung Health to the dashboard, and how to fix the pipeline when it stops.

```
Galaxy Watch
    ↓ (Bluetooth, all day)
Samsung Health app (Android phone)
    ↓ (auto-export on schedule)
Health Sync app  →  Google Drive folder
    ↓                    ↓ (rclone every hour)
    ↓        djtwo:  samsung_health_cache/*.csv
    ↓                    ↓
    ↓        samsung_health_parser.py  →  health.json
    ↓                    ↓
    ↓        git push davelane26/weight-dashboard-v2
    ↓                    ↓
Dashboard polls https://davelane26.github.io/weight-dashboard-v2/health.json
```

**Where things live (djtwo, user `djtwo`):**

| Thing                | Location                                                        |
|----------------------|------------------------------------------------------------------|
| Bridge scripts       | `<repo>/samsung_health_bridge/sync_and_push.py`                  |
| Parser               | `<repo>/samsung_health_bridge/samsung_health_parser.py`          |
| Config               | `<repo>/samsung_health_bridge/bridge_config.json` (git-ignored)  |
| Autostart setup      | `<repo>/samsung_health_bridge/SETUP_BRIDGE.bat`                  |
| Run log              | `<repo>/samsung_health_bridge/sync.log`                          |
| rclone config        | `%USERPROFILE%\AppData\Roaming\rclone\rclone.conf`               |
| Local CSV cache      | Whatever `cache_dir` in `bridge_config.json` points at           |
| Dashboard repo clone | Whatever `dashboard_repo` in `bridge_config.json` points at |
| Scheduled task       | `SamsungHealthBridge` (runs hourly)                              |

Unlike the openScale/MQTT pipeline, the bridge code IS in this repo —
so if djtwo dies, the code is recoverable from GitHub. Only the
`bridge_config.json` (with your local paths) needs to be recreated.

---

## First-time setup

### On the phone

1. Install **Health Sync** by appyhapps.nl from the Play Store (one-time ~$3).
2. Grant Health Connect permissions for **Steps, Sleep, Heart rate,
   Exercise**. Verify Samsung Health has Steps→Health Connect toggled ON
   under Samsung Health → Settings → Health Connect.
3. Open Health Sync → ⋮ menu → **"Samsung Health to Drive Sync"**
   (NOT "Health Connect to Drive Sync" — that path is missing Steps on
   this setup for reasons unknown to man).
4. Pick the four data types, sign into Google Drive, pick or create a
   folder (default: `HealthSync`), set auto-sync frequency to hourly.
5. Hit **Sync** once manually to prime the folder with data.

You should now see files like `Steps 33-2026 Samsung Health.csv` and
`Heart rate July 2026 Samsung Health.csv` appearing in the Drive folder.

### On djtwo (one-time, as Administrator)

1. **Install rclone.** Download from https://rclone.org/downloads/ (or
   `winget install Rclone.Rclone`). Ensure `rclone` is on PATH.

2. **Configure the Google Drive remote:**
   ```
   rclone config
   ```
   - Choose `n` (new remote)
   - Name: `gdrive` (or match your `bridge_config.json`)
   - Storage: `drive` (Google Drive)
   - client_id / client_secret: leave blank (uses rclone's defaults)
   - scope: `1` (full access) — needed to write; use `2` for read-only
   - service_account_file: blank
   - Edit advanced config: `n`
   - Use auto config: `y` (opens browser for OAuth)
   - Configure as a Team Drive: `n`
   - Confirm: `y`, then `q` to quit

3. **Clone the weight-dashboard-v2 repo** (the PUBLIC one — served via
   GitHub Pages, so `health.json` needs to live here, not in the
   private Weight-tracker repo) with a push-capable remote. Simplest:
   embed a GitHub PAT in the URL:
   ```
   git clone https://<PAT>@github.com/davelane26/weight-dashboard-v2.git C:\Users\djtwo\Downloads\weight-dashboard-v2
   ```
   The PAT needs `repo` scope. Reuse the same one the MQTT bridge uses.

4. **Set up bridge config:**
   ```
   cd <path to this repo>\samsung_health_bridge
   copy bridge_config.example.json bridge_config.json
   notepad bridge_config.json
   ```
   Edit the five paths to match your setup.

5. **Run the setup script as Administrator:**
   ```
   SETUP_BRIDGE.bat
   ```
   This registers a `SamsungHealthBridge` Scheduled Task (hourly) and
   triggers the first run immediately.

6. **Verify:**
   ```
   type sync.log
   ```
   Should show `[ok] wrote health.json: N days, ...`. Then check
   https://github.com/davelane26/weight-dashboard-v2/commits/main for a new
   `health.json auto-update ...` commit.

---

## When the pipeline is dead — checklist

Work top-down. Each step isolates one link.

1. **Is the Scheduled Task running?**
   ```
   schtasks /Query /TN SamsungHealthBridge /FO LIST /V
   ```
   Look at `Last Run Time` and `Last Result` (0 = success). If it's
   never run or is disabled, re-run `SETUP_BRIDGE.bat`.

2. **What did the last run say?**
   ```
   type sync.log
   ```
   The tail tells you exactly where it broke:
   - `rclone sync … exit 1` → rclone or Drive issue (step 3)
   - `[ok] wrote health.json` but no `git push` → nothing changed, OK
   - `git push … exit 128` → GitHub credential issue (step 5)

3. **Can rclone reach Drive?**
   ```
   rclone ls gdrive:HealthSync
   ```
   Should list `... Samsung Health.csv` files. If auth is expired:
   ```
   rclone config reconnect gdrive:
   ```

4. **Is the phone still pushing fresh files to Drive?**
   Open Google Drive → check `HealthSync/` timestamps. Files should be
   from within the last few hours. If they're stale:
   - Open Health Sync app on phone → hit **Sync** manually
   - Check that Health Sync has Google Drive OAuth still valid (it
     silently loses auth on Google password changes / 2FA changes)
   - Check the phone's battery-optimization settings for Health Sync;
     Samsung's One UI will kill background sync silently

5. **git push failing?**
   ```
   cd <dashboard_repo>
   git push
   ```
   If you get `remote: Support for password authentication was removed`,
   the PAT baked into the remote URL expired. Rotate it:
   ```
   git remote set-url origin https://<new-PAT>@github.com/davelane26/weight-dashboard-v2.git
   ```

6. **Dashboard still stale?** It caches `health.json` network-first, so
   a hard refresh after a successful push should show updated data.
   If not, check `https://davelane26.github.io/weight-dashboard-v2/health.json`
   directly in a browser — that URL should return the fresh JSON.

---

## Manual controls

- **Run one sync right now:** `schtasks /Run /TN SamsungHealthBridge`
- **Run interactively (see output):** `python sync_and_push.py`
- **Disable temporarily:** `schtasks /Change /TN SamsungHealthBridge /DISABLE`
- **Re-enable:** `schtasks /Change /TN SamsungHealthBridge /ENABLE`
- **Remove entirely:** `schtasks /Delete /TN SamsungHealthBridge /F`

---

## Data recovery & Samsung Health quirks

**The phone is the source of truth.** Health Sync re-exports weekly
rolling files, so a full history rebuild is:

1. In Health Sync → historical-data / backfill option → export all
2. Wait for Drive to populate (can take a few minutes)
3. Delete the local cache dir (`bridge_config.json` → `cache_dir`)
4. Run `python sync_and_push.py` — rebuilds the cache from Drive and
   pushes a fresh `health.json` with all history

**Known Samsung Health quirks the parser handles:**

- **Multi-night sleep files.** One `Sleep <date> ... Samsung Health.csv`
  often contains 3–4 nights lumped together. Parser splits sessions on
  inter-row gaps > 2 hours.
- **Overlapping sleep streams.** Some nights Samsung Health writes TWO
  parallel sensor streams (watch coarse + phone-side fine analysis).
  Naive summation inflates totals to ~2x. Parser resolves via interval
  union so time is never double-counted.
- **Weekly + monthly file overlap.** Steps/HR files come in both
  weekly (`WW-YYYY`) and monthly (`Month YYYY`) buckets that cover the
  same days. Parser deduplicates by exact timestamp (last-write-wins).
- **Steps=0 in workouts / near-empty step files.** This means Samsung
  Health hasn't been granted "write steps" permission in Health
  Connect. Fix: Samsung Health → Settings → Health Connect → Steps →
  ON. Otherwise reading via Samsung-Health-direct path bypasses the
  bug entirely.

---

## Design notes

- **Idempotent.** Running the script twice back-to-back is a no-op on
  the second run (content-diff check skips the git push).
- **Stdlib only.** No pip deps. Uses subprocess for rclone/git so the
  bridge dies gracefully if either is missing.
- **Log-on-append.** `sync.log` grows; rotate with any log-rotator if
  it ever becomes an issue (unlikely, few hundred bytes per run).
- **Config is git-ignored.** Only `bridge_config.example.json` is
  committed. The real config file lives outside version control since
  it contains local paths (and potentially secrets down the line).
