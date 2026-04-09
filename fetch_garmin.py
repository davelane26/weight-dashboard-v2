"""
fetch_garmin.py — Pulls daily health data from Garmin Connect using garth.
Authenticates via stored OAuth tokens (no password needed in CI).

Required env vars:
  GARMIN_TOKENS — base64-encoded zip of garth token files (from garmin_setup.py)
  WORKER_URL    — e.g. https://glucose-relay.djtwo6.workers.dev
"""

import base64
import io
import json
import os
import pathlib
import sys
import tempfile
import zipfile
from datetime import date

import requests

try:
    import garth
except ImportError:
    os.system(f'{sys.executable} -m pip install garth')
    import garth

# ── Config ────────────────────────────────────────────────────────────────
TOKENS_B64 = os.environ.get('GARMIN_TOKENS', '')
WORKER_URL = os.environ.get('WORKER_URL', 'https://glucose-relay.djtwo6.workers.dev')
TODAY      = date.today().isoformat()

# ── Restore tokens from secret ────────────────────────────────────────────
if not TOKENS_B64:
    print('ERROR: GARMIN_TOKENS secret not set.', file=sys.stderr)
    print('Run garmin_setup.py on your home PC first.', file=sys.stderr)
    sys.exit(1)

tmp = pathlib.Path(tempfile.mkdtemp())
with zipfile.ZipFile(io.BytesIO(base64.b64decode(TOKENS_B64))) as z:
    z.extractall(tmp)

garth.resume(str(tmp))
print(f'Tokens loaded ✓ — fetching data for {TODAY}')

# ── Garmin Connect API calls ──────────────────────────────────────────────
BASE = 'https://connect.garmin.com'

def gc_get(path, default=None):
    try:
        return garth.get(BASE, path).json()
    except Exception as e:
        print(f'  Warning: GET {path} failed — {e}')
        return default or {}

def get_steps():
    data = gc_get(f'/proxy/usersummary-service/usersummary/daily/{TODAY}')
    return int(data.get('totalSteps', 0) or 0)

def get_sleep():
    data = gc_get(f'/proxy/wellness-service/wellness/dailySleepData/{TODAY}')
    dto  = data.get('dailySleepDTO', {}) or {}
    secs = int(dto.get('sleepTimeSeconds', 0) or 0)
    score = (
        (dto.get('sleepScores') or {}).get('overall', {}).get('value', 0) or
        dto.get('sleepScore', 0) or 0
    )
    return round(secs / 3600, 2), int(score)

def get_hr():
    data = gc_get(f'/proxy/wellness-service/wellness/dailyHeartRate/{TODAY}')
    return int(data.get('restingHeartRate', 0) or 0)

def get_stress():
    data = gc_get(f'/proxy/wellness-service/wellness/dailyStress/{TODAY}')
    return int(data.get('avgStressLevel', 0) or 0)

def get_floors():
    data = gc_get(f'/proxy/usersummary-service/usersummary/daily/{TODAY}')
    return int(data.get('floorsAscended', 0) or 0)

def get_active_cal():
    data = gc_get(f'/proxy/usersummary-service/usersummary/daily/{TODAY}')
    return int(data.get('activeKilocalories', 0) or 0)

# ── Pull data ─────────────────────────────────────────────────────────────
steps        = get_steps()
sleep_h, sleep_s = get_sleep()
resting_hr   = get_hr()
stress       = get_stress()
floors       = get_floors()
active_cal   = get_active_cal()

payload = {
    'date':           TODAY,
    'steps':          steps,
    'sleepHours':     sleep_h,
    'sleepScore':     sleep_s,
    'restingHR':      resting_hr,
    'activeCalories': active_cal,
    'floorsClimbed':  floors,
    'stressLevel':    stress,
}

print(json.dumps(payload, indent=2))

# ── Push to Worker ────────────────────────────────────────────────────────
resp = requests.post(f'{WORKER_URL}/health', json=payload, timeout=15)
print(f'Worker response: HTTP {resp.status_code} — {resp.text}')
if resp.status_code != 200:
    sys.exit(1)

print('Done ✓')
