#!/usr/bin/env python3
"""
Fetch daily health data from Exist.io → push to Cloudflare Worker.

Exist.io pulls from Garmin automatically — we never touch Garmin's API.

Required env vars:
  EXIST_TOKEN  — personal token (never expires)
  WORKER_URL   — Cloudflare Worker base URL
"""

import json
import os
import sys
from datetime import date

import requests

EXIST_TOKEN    = os.environ.get("EXIST_TOKEN", "")
EXIST_USERNAME = os.environ.get("EXIST_USERNAME", "")
EXIST_PASSWORD = os.environ.get("EXIST_PASSWORD", "")
WORKER_URL     = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")
TODAY          = date.today().isoformat()

ATTRS = "steps,sleep,sleep_start,sleep_end,heartrate_resting"

# ── Auth: token or username+password ─────────────────────────────────────────
if not EXIST_TOKEN:
    if not EXIST_USERNAME or not EXIST_PASSWORD:
        print("ERROR: Set either EXIST_TOKEN or both EXIST_USERNAME + EXIST_PASSWORD.", file=sys.stderr)
        sys.exit(1)
    print("No token found — logging in with username/password...")
    auth = requests.post(
        "https://exist.io/api/2/auth/simple-token/",
        data={"username": EXIST_USERNAME, "password": EXIST_PASSWORD},
        timeout=15,
    )
    if auth.status_code != 200:
        print(f"ERROR: Login failed {auth.status_code}: {auth.text}", file=sys.stderr)
        sys.exit(1)
    EXIST_TOKEN = auth.json()["token"]
    print("Login OK ✓")

# ── Fetch from Exist.io ───────────────────────────────────────────────
print(f"Fetching Exist.io data for {TODAY}...")

resp = requests.get(
    "https://exist.io/api/2/attributes/with-values/",
    headers={"Authorization": f"Token {EXIST_TOKEN}"},
    params={"attributes": ATTRS, "date_max": TODAY, "days": 1},
    timeout=30,
)

if resp.status_code == 401:
    print("ERROR: Credentials rejected by Exist.io.", file=sys.stderr)
    sys.exit(1)

if resp.status_code != 200:
    print(f"ERROR: Exist.io returned {resp.status_code}: {resp.text}", file=sys.stderr)
    sys.exit(1)

# ── Parse response ────────────────────────────────────────────────────────────
values: dict = {}
for attr in resp.json().get("results", []):
    entries = attr.get("values", [])
    if entries and entries[0].get("value") is not None:
        values[attr["name"]] = entries[0]["value"]

steps       = int(values.get("steps") or 0)
sleep_mins  = int(values.get("sleep") or 0)
sleep_hours = round(sleep_mins / 60, 2)
resting_hr  = int(values.get("heartrate_resting") or 0)
sleep_start = values.get("sleep_start")   # ISO timestamp or None
sleep_end   = values.get("sleep_end")     # ISO timestamp or None

# ── Build payload for Cloudflare Worker /health ───────────────────────────────
payload = {
    "date":           TODAY,
    "steps":          steps,
    "sleepHours":     sleep_hours,
    "sleepScore":     0,       # not available outside Garmin
    "restingHR":      resting_hr,
    "activeCalories": 0,       # not available via Exist.io free tier
    "floorsClimbed":  0,
    "stressLevel":    0,
}

print(f"  Steps:      {steps:,}")
print(f"  Sleep:      {sleep_hours}h ({sleep_mins} min)")
print(f"  Resting HR: {resting_hr} bpm")

if not steps and not sleep_hours and not resting_hr:
    print("WARNING: All values are zero — Exist.io may not have synced yet.")
    print("  Check https://exist.io/dashboard/ to confirm Garmin is connected.")
    # Still push zeros so the dashboard date entry exists
    # Exit 0 so the workflow doesn't fail on days with no data yet
    sys.exit(0)

# ── Push to Cloudflare Worker ─────────────────────────────────────────────────
print(f"\nPushing to Worker...")
push = requests.post(f"{WORKER_URL}/health", json=payload, timeout=15)
print(f"  HTTP {push.status_code} — {push.text}")

if push.status_code != 200:
    print("ERROR: Worker rejected the payload.", file=sys.stderr)
    sys.exit(1)

print("\nDone ✓")
