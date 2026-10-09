# Garmin Sync — Setup Guide

Wires up your Garmin Connect data (steps, sleep score & stages, resting HR, stress, body battery, intensity minutes, calories, and scale weight) to the Activity tab on the dashboard.

Powered by [`cyberjunky/python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) (v0.3.x).

---

## Architecture

```
Garmin Device → Garmin Connect → python-garminconnect
                                       ↓
                        Cloudflare Worker (/health/patch)
                                       ↓
                             🏃 Dashboard Activity Tab
```

---

## One-Time Setup

Garmin's Cloudflare protection blocks standard bots, but `python-garminconnect 0.3.x` uses native mobile TLS impersonation.

1. In `weight-dashboard-v2`:
   ```bash
   python garmin_setup.py
   ```
   *(Or double-click `garmin_sync/SETUP_GARMIN.bat`)*

2. Enter your Garmin Connect **email** and **password**.
3. If prompted, enter your **2FA / MFA code**.
4. The script saves your session token to `garmin_sync/.garmin_tokens/garmin_tokens.json`.

---

## Running the Sync

To sync today's stats immediately:
```bash
python garmin_sync/sync_garmin.py --today
```
*(Or double-click `garmin_sync/RUN_SYNC.bat`)*

---

## GitHub Actions Cloud Sync

Garmin data syncs automatically in the cloud every 30 minutes via GitHub Actions (`ubuntu-latest`).
Make sure these secrets are set under **GitHub Repo Settings → Secrets and variables → Actions**:
1. `GARMIN_TOKENS`: The base64 string printed by `garmin_setup.py`.
2. `API_SECRET` (or `API_SECRET_V2`): Your Cloudflare Worker API secret.
3. (Optional) `GARMIN_EMAIL` and `GARMIN_PASSWORD`: As fallback credentials if the token ever expires.

