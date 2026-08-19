# Samsung Health Bridge — Quick Start for djtwo

Read this on djtwo. When done, you'll have Galaxy Watch data flowing to
the weight dashboard automatically every hour.

For deeper reference (troubleshooting, design notes, quirks) see
`HEALTH_BRIDGE.md` in this same folder.

---

## Step 1 — Install rclone

PowerShell as Administrator:

```powershell
winget install Rclone.Rclone
```

Close and reopen PowerShell. Verify:

```powershell
rclone version
```

## Step 2 — Connect rclone to Google Drive

```powershell
rclone config
```

Answers to the prompts:

- `n` (new remote)
- Name: `gdrive`
- Storage: type `drive` (or the number for Google Drive)
- client_id: **blank** (press Enter)
- client_secret: **blank**
- scope: `1` (full access)
- service_account_file: **blank**
- Edit advanced config: `n`
- Use auto config: `y` — a browser opens, sign into the same Google
  account Health Sync writes to, click Allow
- Configure as Team Drive: `n`
- Keep this remote: `y`
- Then `q` to quit

Test:

```powershell
rclone ls gdrive:HealthSync
```

You should see a list of `... Samsung Health.csv` files. If the folder
name in your Drive isn't `HealthSync`, note the actual name — you'll
need it in Step 4.

## Step 3 — Clone the two repos

```powershell
cd C:\Users\djtwo\Downloads
git clone https://github.com/davelane26/weight-dashboard-v2.git
git clone https://<YOUR_PAT>@github.com/davelane26/Weight-tracker.git weight-tracker
```

Replace `<YOUR_PAT>` with the same GitHub PAT the MQTT bridge already
uses. PAT needs `repo` scope.

## Step 4 — Configure the bridge

```powershell
cd C:\Users\djtwo\Downloads\weight-dashboard-v2\samsung_health_bridge
copy bridge_config.example.json bridge_config.json
notepad bridge_config.json
```

Strip the `_comment_*` lines and set the real values. Should end up
looking like:

```json
{
  "rclone_remote": "gdrive",
  "drive_folder": "HealthSync",
  "cache_dir": "C:/Users/djtwo/samsung_health_cache",
  "weight_tracker_repo": "C:/Users/djtwo/Downloads/weight-tracker",
  "health_json_filename": "health.json"
}
```

Adjust `drive_folder` if Step 2 showed a different name.

## Step 5 — Run setup

Right-click `SETUP_BRIDGE.bat` in the samsung_health_bridge folder ->
**Run as Administrator**.

You'll see it verify tools, register the Scheduled Task, and trigger a
first run. Watch the output:

```powershell
type sync.log
```

Look for `[ok] wrote health.json: N days, ...` — that means it worked.

## Step 6 — Verify

1. Check https://github.com/davelane26/Weight-tracker/commits/main —
   you should see a fresh `health.json auto-update ...` commit from
   moments ago.
2. Wait ~60 seconds for GitHub Pages to deploy, then open
   https://davelane26.github.io/Weight-tracker/health.json in a
   browser. Should be a big JSON blob.
3. Open your dashboard -> Activity tab -> open DevTools Network panel
   -> refresh. You should see `health.json` come back 200, and the KPI
   cards should populate from Samsung Health data. The "Synced via"
   footer should say **"Samsung Health via djtwo"**.

---

## If something breaks

Open `HEALTH_BRIDGE.md` in this folder. Scroll to "**When the pipeline
is dead — checklist**." It's a top-down triage: task running? ->
rclone reaches Drive? -> phone still exporting? -> git push working?
Each step isolates one link.

## Manual controls

```powershell
schtasks /Run /TN SamsungHealthBridge        # run one sync now
python sync_and_push.py                      # run interactively, see live output
schtasks /Change /TN SamsungHealthBridge /DISABLE   # pause
schtasks /Change /TN SamsungHealthBridge /ENABLE    # resume
schtasks /Delete /TN SamsungHealthBridge /F         # nuke
```
