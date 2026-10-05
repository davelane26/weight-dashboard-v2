# Garmin Sync for Weight Dashboard

Syncs Garmin Connect data (steps, sleep score/stages, resting HR, stress, body battery, intensity minutes, calories, VO2 max, and scale weight) to the Cloudflare Worker and Firebase Realtime Database.

Powered by [`cyberjunky/python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) (v0.3.x) with native mobile TLS impersonation (`curl_cffi`).

---

## How It Works

```
Garmin Watch / Scale
        ↓
Garmin Connect (Cloud)
        ↓  (python-garminconnect v0.3.x with mobile SSO & tokenstore)
garmin_sync/sync_garmin.py
   ├──→ Cloudflare Worker (/health/patch) → 🏃 Live Activity Tab
   └──→ Firebase RTDB (/garmin/{date}.json) → 💾 Historical Fallback
```

---

## Quick Start (One-Time Setup)

### Step 1: Run Setup
Open this folder in a terminal (or double-click `SETUP_GARMIN.bat`):

```bash
python setup_garmin.py
```

- Enter your Garmin Connect **email** and **password** when prompted.
- If Garmin prompts for **2FA / MFA**, enter the verification code sent to your phone/email.
- The script automatically saves your session token in `.garmin_tokens/garmin_tokens.json`.

> **Note**: Tokens are automatically refreshed on subsequent syncs. You only need to run setup again if your session is revoked or expires after many months.

### Step 2: (Optional) Set GitHub Actions Secret
If you use GitHub Actions to sync Garmin data automatically:
1. `setup_garmin.py` outputs a base64-encoded token string.
2. Go to: **Repo Settings → Secrets and variables → Actions**.
3. Add a secret named `GARMIN_TOKENS` and paste the base64 string.

---

## Daily Usage

### Run Sync Manually
Double-click `RUN_SYNC.bat`, or run from terminal:

```bash
# Sync today only (fast)
python sync_garmin.py --today

# Sync today + last 7 days
python sync_garmin.py

# Backfill last 30 days
python sync_garmin.py --days 30

# Inspect data without uploading
python sync_garmin.py --today --dry-run
```

### Windows Task Scheduler (Automatic Daily Sync)
You can schedule `RUN_SYNC.bat` to run daily or every hour via Windows Task Scheduler.

---

## File Structure

```
garmin_sync/
├── setup_garmin.py       # One-time interactive login & token setup
├── sync_garmin.py        # Main sync CLI (pulls from Garmin → Worker & Firebase)
├── garmin_client.py      # Garmin Connect API client (v0.3.x native auth & data fetchers)
├── push_worker.py        # Cloudflare Worker /health/patch pusher
├── firebase_push.py      # Firebase RTDB pusher
├── SETUP_GARMIN.bat      # One-click Windows setup launcher
├── RUN_SYNC.bat          # One-click Windows sync launcher
├── requirements.txt      # Python dependencies
├── .env                  # Configuration (GARMIN_EMAIL, WORKER_URL, FIREBASE_URL)
└── .garmin_tokens/       # Stored session tokens (never commit to git!)
```
