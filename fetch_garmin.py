"""
fetch_garmin.py — Pulls daily health data from Garmin Connect
and POSTs it to the Cloudflare Worker /health endpoint.
Runs nightly via GitHub Actions.

Required env vars:
  GARMIN_EMAIL    — Garmin Connect login email
  GARMIN_PASSWORD — Garmin Connect password
  WORKER_URL      — e.g. https://glucose-relay.djtwo6.workers.dev
"""

import json
import os
import sys
from datetime import date, timedelta

import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

# ── Config ────────────────────────────────────────────────────────────────
EMAIL      = os.environ['GARMIN_EMAIL']
PASSWORD   = os.environ['GARMIN_PASSWORD']
WORKER_URL = os.environ.get('WORKER_URL', 'https://glucose-relay.djtwo6.workers.dev')
TODAY      = date.today().isoformat()

# ── Auth ──────────────────────────────────────────────────────────────────
print(f'Connecting to Garmin Connect as {EMAIL[:4]}***...')
try:
    api = Garmin(EMAIL, PASSWORD)
    api.login()
    print('Authenticated ✓')
except GarminConnectAuthenticationError as e:
    print(f'Auth failed: {e}', file=sys.stderr)
    sys.exit(1)

# ── Fetch helpers ─────────────────────────────────────────────────────────
def safe(fn, *args, default=0):
    try:
        return fn(*args) or default
    except Exception as e:
        print(f'  Warning: {fn.__name__} failed — {e}')
        return default

def get_steps():
    data = safe(api.get_steps_data, TODAY, default=[])
    return sum(d.get('steps', 0) for d in data) if isinstance(data, list) else 0

def get_sleep():
    data = safe(api.get_sleep_data, TODAY, default={})
    dto  = data.get('dailySleepDTO', {}) if isinstance(data, dict) else {}
    secs = dto.get('sleepTimeSeconds', 0) or 0
    score = (
        dto.get('sleepScores', {}).get('overall', {}).get('value', 0) or
        dto.get('sleepScore', 0) or 0
    )
    return round(secs / 3600, 2), int(score)

def get_hr():
    data = safe(api.get_heart_rates, TODAY, default={})
    return int(data.get('restingHeartRate', 0)) if isinstance(data, dict) else 0

def get_summary():
    data = safe(api.get_stats, TODAY, default={})
    if not isinstance(data, dict):
        return 0, 0, 0
    return (
        int(data.get('activeKilocalories', 0) or 0),
        int(data.get('floorsAscended',     0) or 0),
        int(data.get('averageStressLevel', 0) or 0),
    )

# ── Pull data ─────────────────────────────────────────────────────────────
print(f'Fetching data for {TODAY}...')

steps                            = get_steps()
sleep_hours, sleep_score         = get_sleep()
resting_hr                       = get_hr()
active_cal, floors, stress_level = get_summary()

payload = {
    'date':           TODAY,
    'steps':          steps,
    'sleepHours':     sleep_hours,
    'sleepScore':     sleep_score,
    'restingHR':      resting_hr,
    'activeCalories': active_cal,
    'floorsClimbed':  floors,
    'stressLevel':    stress_level,
}

print(json.dumps(payload, indent=2))

# ── Push to Worker ────────────────────────────────────────────────────────
resp = requests.post(f'{WORKER_URL}/health', json=payload, timeout=15)
print(f'Worker response: HTTP {resp.status_code} — {resp.text}')
if resp.status_code != 200:
    sys.exit(1)

print('Done ✓')
