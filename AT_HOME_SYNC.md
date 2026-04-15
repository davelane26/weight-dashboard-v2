# 🏠 When You Get Home

Run the local Garmin sync to push your real stats (resting HR, stress,
body battery, sleep score) into the dashboard.

> Must be on **home WiFi** — Garmin Connect is blocked on Walmart VPN.

---

## First time only — refresh cookies

1. Open **Chrome** and go to `connect.garmin.com` (log in if needed)
2. Press `F12` → **Network** tab → type `connectapi` in the filter → press `F5`
3. Right-click **any** request in the list → **Copy** → **Copy as cURL (bash)**
4. Run the cookie extractor and paste when prompted:

```
cd C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\garmin_sync
.venv\Scripts\python.exe get_cookies.py
```

This saves `.garmin_cookies.json`. You only need to redo this every ~60-90 days when Garmin expires the session.

---

## Every time — run the sync

```
cd C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\garmin_sync
.venv\Scripts\python.exe garmin_local_sync.py
```

This patches the Cloudflare Worker with today's real Garmin data:
- ❤️ Resting HR
- 🧠 Stress level
- 🔋 Body Battery
- 💤 Sleep score + precise sleep hours
- 💪 Intensity minutes
- 🔥 Active + total calories

---

## Task Scheduler (runs automatically at home)

If the Task Scheduler task is set up, the sync runs automatically —
you don't need to do anything manually after the first cookie setup.

To check if it's running:

```
schtasks /query /tn "GarminLocalSync" /fo LIST
```

To set it up if it's missing:

```
cd C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\garmin_sync
SETUP_LOCAL_SYNC.bat
```

---

## Also — redeploy the Cloudflare Worker

The `worker.js` was updated to fix the batch merge (so Exist.io syncs
no longer wipe your Garmin patches). Paste the updated file into the
Cloudflare dashboard if you haven't already:

**File:** `C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\cloudflare-worker\worker.js`

**Dashboard:** https://dash.cloudflare.com → Workers & Pages → `glucose-relay` → Edit Code
