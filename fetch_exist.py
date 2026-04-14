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

ATTRS = ",".join([
    "steps",
    "sleep", "deep_sleep", "light_sleep", "rem_sleep", "sleep_awakenings",
    "sleep_start", "sleep_end", "time_in_bed",
    "floors",
    "active_energy",
    "workouts", "workouts_distance", "workouts_min",
])
DAYS = 30  # fetch rolling 30-day history
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

# ── Fetch 30 days from Exist.io ──────────────────────────────────────────────
print(f"Fetching {DAYS} days of Exist.io data (up to {TODAY})...")

resp = requests.get(
    "https://exist.io/api/2/attributes/with-values/",
    headers={"Authorization": f"Token {EXIST_TOKEN}"},
    params={"attributes": ATTRS, "date_max": TODAY, "days": DAYS},
    timeout=30,
)

if resp.status_code == 401:
    print("ERROR: Credentials rejected by Exist.io.", file=sys.stderr)
    sys.exit(1)

if resp.status_code != 200:
    print(f"ERROR: Exist.io returned {resp.status_code}: {resp.text}", file=sys.stderr)
    sys.exit(1)

# ── Reorganise: attr→[{date,value}] into date→{attr: value} ──────────────────
by_date: dict = {}
for attr in resp.json().get("results", []):
    for entry in attr.get("values", []):
        d = entry["date"]
        if d not in by_date:
            by_date[d] = {}
        if entry["value"] is not None:
            by_date[d][attr["name"]] = entry["value"]

if not by_date:
    print("WARNING: No data returned — Exist.io may not have synced yet.", file=sys.stderr)
    sys.exit(0)

# ── Build normalised entries ──────────────────────────────────────────────────
def mins_to_hrs(v):
    return round(int(v) / 60, 2) if v else 0

batch = []
for date_str in sorted(by_date):
    d = by_date[date_str]
    sleep_mins = int(d.get("sleep") or 0)
    batch.append({
        "date":             date_str,
        "steps":            int(d.get("steps")            or 0),
        "sleepHours":       mins_to_hrs(sleep_mins),
        "sleepDeep":        mins_to_hrs(d.get("deep_sleep")),
        "sleepLight":       mins_to_hrs(d.get("light_sleep")),
        "sleepRem":         mins_to_hrs(d.get("rem_sleep")),
        "sleepAwakenings":  int(d.get("sleep_awakenings") or 0),
        "activeCalories":   int(d.get("active_energy")    or 0),
        "floorsClimbed":    int(d.get("floors")           or 0),
        "workouts":         int(d.get("workouts")         or 0),
        "workoutsMins":     int(d.get("workouts_min")     or 0),
        "workoutsKm":       round(float(d.get("workouts_distance") or 0), 2),
        "stressLevel":      0,
    })

print(f"  Built {len(batch)} entries ({batch[0]['date']} → {batch[-1]['date']})")
today_e = next((b for b in reversed(batch) if b["date"] == TODAY), batch[-1])
print(f"  Today — Steps: {today_e['steps']:,} | Sleep: {today_e['sleepHours']}h "
      f"(D:{today_e['sleepDeep']}h L:{today_e['sleepLight']}h R:{today_e['sleepRem']}h) | "
      f"Active Cal: {today_e['activeCalories']} | Workouts: {today_e['workouts']} ({today_e['workoutsMins']}min)")

# ── Push batch to Cloudflare Worker ──────────────────────────────────────────
print(f"\nPushing {len(batch)} days to Worker...")
push = requests.post(f"{WORKER_URL}/health/batch", json={"days": batch}, timeout=20)
print(f"  HTTP {push.status_code} — {push.text}")

if push.status_code != 200:
    print("ERROR: Worker rejected the batch.", file=sys.stderr)
    sys.exit(1)

print("\nDone ✓")
