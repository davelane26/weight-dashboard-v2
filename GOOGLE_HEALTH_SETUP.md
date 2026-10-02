# Google Health Premium Sync — Setup Guide

This sync pulls your **Google Health Premium** recovery metrics (sleep score, deep/light/REM stages, awakenings, HRV, resting heart rate, SpO2) into your dashboard every morning via GitHub Actions.

Your real-time steps continue to be tracked seamlessly by the **Kage** Android app — the two sources merge gracefully without conflicts.

---

## Architecture

```
Google Health App (Phone) → Google Health Cloud Servers
                                   ↓ Daily at 7:00 AM CST (GitHub Actions)
                         fetch_google_health.py
                                   ↓
                     Cloudflare Worker /health/patch
                                   ↓
                   (Merged with Kage real-time steps)
                                   ↓
                             🏃 Activity Tab
```

---

## Step 1: Create OAuth Credentials in Google Cloud Console

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your existing project (Project # `811571888069`) or create a new one.
3. Enable the **Google Health API**:
   - In the search bar at the top, search for **Google Health API**.
   - Click **Enable**.
4. Configure the OAuth Consent Screen (if not already done for Drive/Photos):
   - Navigate to **APIs & Services** → **OAuth consent screen**.
   - User Type: **External** → Click **Create**.
   - App Name: `Weight Dashboard Health Sync`
   - User support email & Developer contact: your email.
   - **Publishing status**: Move to **In production** (or add your email under Test Users).
5. Create your OAuth Client ID:
   - Navigate to **APIs & Services** → **Credentials**.
   - Click **+ Create Credentials** → **OAuth client ID**.
   - Application type: Select **Desktop app**.
   - Name: `Google Health Sync`.
   - Click **Create**.
6. Copy your:
   - **Client ID**
   - **Client Secret**

---

## Step 2: Run the One-Time Setup Script

Run this command in your terminal on your PC:

```bash
uv run --with requests python google_health_setup.py
```

- When prompted, paste your **Client ID** and **Client Secret**.
- The script will open your web browser asking you to log into your Google account and approve permissions for Sleep and Health Metrics.
- Once approved, the terminal will print your permanent **Refresh Token**.

---

## Step 3: Add GitHub Repository Secrets

Go to your repository settings on GitHub:
👉 https://github.com/davelane26/weight-dashboard-v2/settings/secrets/actions

Click **New repository secret** and add:

| Name | Value |
|---|---|
| `GOOGLE_HEALTH_CLIENT_ID` | *(your Google OAuth Client ID)* |
| `GOOGLE_HEALTH_CLIENT_SECRET` | *(your Google OAuth Client Secret)* |
| `GOOGLE_HEALTH_REFRESH_TOKEN` | *(the refresh token printed by Step 2)* |

*(Note: `API_SECRET_V2` should already exist from your Kage setup. If missing, add your Cloudflare Worker API secret).*

---

## Step 4: Run a Test Sync

Trigger the workflow manually in GitHub Actions to test:
👉 https://github.com/davelane26/weight-dashboard-v2/actions/workflows/sync-google-health.yml

Click **Run workflow** → **Run workflow**.

Once complete, open your dashboard's **Activity tab** to see your Google Health Premium sleep and recovery metrics live!
