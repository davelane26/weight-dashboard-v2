# Garmin Activity Sync — Setup Guide

This wires up your Garmin Connect data (steps, sleep, heart rate, stress, floors)
to the Activity tab on the dashboard. Runs automatically every night via GitHub Actions.

---

## How it works

```
Garmin Watch → Garmin Connect app → garth (Python)
                                          ↓ daily at 1:30am CST
                              Cloudflare Worker /health
                                          ↓
                                      KV Storage
                                          ↓
                                  🏃 Activity tab
```

---

## One-time setup (do this from home, NOT on Walmart network)

Garmin blocks logins from cloud/corporate IPs. You need to generate OAuth tokens
from your **home network** once — after that GitHub Actions uses the tokens silently.

### Step 1 — Clone the repo at home (if you haven't already)

```bash
git clone https://github.com/davelane26/weight-dashboard-v2.git
cd weight-dashboard-v2
```

### Step 2 — Run the setup script

```bash
uv run --with garth --with requests python garmin_setup.py
```

> No `uv`? Install it first: https://docs.astral.sh/uv/getting-started/installation/
> Or just use plain Python: `pip install garth requests && python garmin_setup.py`

- Enter your Garmin Connect **email** and **password** when prompted
- The script prints a big base64 string at the end — **copy the whole thing**

### Step 3 — Add it as a GitHub secret

👉 https://github.com/davelane26/weight-dashboard-v2/settings/secrets/actions

Click **New repository secret** and add:

| Name | Value |
|---|---|
| `GARMIN_TOKENS` | *(paste the base64 string from Step 1)* |

> You can delete `GARMIN_EMAIL` and `GARMIN_PASSWORD` secrets if you added them earlier — they're no longer needed.

### Step 4 — Test the workflow manually

👉 https://github.com/davelane26/weight-dashboard-v2/actions/workflows/sync-garmin.yml

Click **Run workflow** → watch the logs → should end with `Done ✓`

### Step 5 — Check the dashboard

Open the Activity tab on the dashboard — your steps, sleep, HR, and stress should appear.

---

## Schedule

The workflow runs automatically at **1:30 AM CST** every day (7:30 UTC).
You can also trigger it manually anytime from the Actions tab.

---

## Re-authenticating (if tokens expire)

Garmin OAuth tokens last a long time but if the workflow starts failing with auth errors,
just re-run `garmin_setup.py` from home and update the `GARMIN_TOKENS` secret.

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Failed to resolve sso.garmin.com` | You're on Walmart network — run from home |
| `429 Rate Limit` | Garmin is blocking the IP — tokens fix this |
| `Auth failed` | Tokens expired — re-run `garmin_setup.py` from home |
| `HTTP 401` from Worker | Check the Worker is deployed with the `/health` endpoint |
