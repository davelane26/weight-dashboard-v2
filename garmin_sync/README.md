# Garmin Sync

Syncs Garmin Connect data (steps, sleep, HRV, VO2 max, activities, body composition) to Firebase Realtime Database every 15 minutes via GitHub Actions.

---

## How It Works

```
Garmin Connect → garmin_client.py → firebase_push.py → Firebase → Dashboard
```

The GitHub Actions workflow (`garmin-sync.yml`) runs every 15 minutes and calls `sync_garmin.py --today`, which fetches today's stats and pushes them to Firebase at `/garmin/latest.json` and `/garmin/{date}.json`.

---

## First-Time Setup

### 1. Set GitHub Secrets

The following secrets must be set on the repo (`Settings → Secrets → Actions`):

| Secret | Description |
|---|---|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `FIREBASE_URL` | Firebase Realtime DB URL (no trailing slash) |
| `GARMIN_SESSION` | Auto-set by `generate_session.py` (see below) |

### 2. Generate a Garmin Session Token (run from home, not on VPN)

Garmin's Cloudflare protection blocks fresh logins from GitHub's cloud IPs.
The fix is to authenticate **once from your home machine** to create a reusable session token.

**Open a terminal in this folder:**

- **File Explorer:** Navigate to this folder → click the address bar → type `cmd` → hit Enter
- **Start Menu:** Win + R → `cmd` → then `cd` to this folder

**Run:**

```
.venv\Scripts\python.exe generate_session.py
```

- Enter your Garmin MFA code if prompted
- The script saves the session and **automatically pushes `GARMIN_SESSION` to GitHub**
- Done! The GitHub Action will now authenticate using the cached session

> **Session lasts ~30 days.** Re-run `generate_session.py` if the sync starts failing.

---

## Usage (Local)

> Local sync only works from home (not on corporate VPN/network — Garmin is blocked by proxy).

```bash
# Sync today only (fast)
.venv\Scripts\python.exe sync_garmin.py --today

# Sync last 7 days (default)
.venv\Scripts\python.exe sync_garmin.py

# Backfill last 30 days
.venv\Scripts\python.exe sync_garmin.py --days 30
```

### Windows Task Scheduler (optional local fallback)

Run `setup_scheduler.bat` **as Administrator** to create a scheduled task that syncs every 15 minutes:

```
setup_scheduler.bat
```

---

## File Structure

```
garmin_sync/
├── sync_garmin.py        # Main entry point (CLI)
├── garmin_client.py      # Garmin Connect API wrapper
├── firebase_push.py      # Firebase REST API helper
├── generate_session.py   # One-time session token setup
├── setup_scheduler.bat   # Windows Task Scheduler setup
├── requirements.txt      # Python dependencies
├── .env                  # Local secrets (never commit!)
├── .env.example          # Template for .env
└── .garmin_session       # Cached session token (never commit!)
```

---

## GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `garmin-sync.yml` | Every 15 min + manual | Syncs today's data |
| `garmin-backfill.yml` | Manual only | Backfills N days of history |

To manually trigger either workflow: **GitHub → Actions tab → select workflow → Run workflow**
