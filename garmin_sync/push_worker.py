"""Push precise Garmin data to Cloudflare Worker (/health/patch).

Merges Garmin-authoritative metrics into the Worker's daily record:
  - sleepScore (Garmin's official 0-100 score), sleepHours, sleep stages (deep, light, rem)
  - restingHR, minHR, maxHR, avgHR, stressLevel, bodyBattery, fitnessAge
  - steps, intensityMinutes, activeCalories, totalCalories, floorsClimbed, distanceMeters
  - vo2Max, hrvRmssd, bedtime, waketime, hcWeightTestLbs
"""

import logging
import os
from datetime import date
from typing import Any

import requests

logger = logging.getLogger(__name__)

WORKER_URL = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")
API_SECRET = os.environ.get("API_SECRET") or os.environ.get("API_SECRET_V2") or os.environ.get("WORKER_API_SECRET", "")

# Exact fields permitted by cloudflare-worker/worker.js /health/patch endpoint
ALLOWED_PATCH_FIELDS = [
    # Sleep
    "sleepScore",
    "sleepHours",
    "sleepDeep",
    "sleepLight",
    "sleepRem",
    "sleepAwakenings",
    "timeInBed",
    # Heart, stress, battery
    "restingHR",
    "minHR",
    "maxHR",
    "avgHR",
    "currentHR",
    "stressLevel",
    "restStressPct",
    "bodyBattery",
    "bodyBatteryCharged",
    "bodyBatteryDrained",
    "bodyBatteryWake",
    "fitnessAge",
    "achievableFitnessAge",
    # Activity (Kage records steps & distance; Garmin enriches intensity & calories)
    "intensityMinutes",
    "workoutsMins",
    "activeCalories",
    "totalCalories",
    "floorsClimbed",
    # Biometrics & Sleep bounds
    "spo2Avg",
    "spo2Min",
    "hrvRmssd",
    "vo2Max",
    "respirationWaking",
    "respirationSleep",
    "respirationMin",
    "respirationMax",
    "bedtime",
    "waketime",
    # Scale test weight
    "hcWeightTestLbs",
]


def _headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Client": "garmin",
        "User-Agent": "GarminSync/1.0",
    }
    if API_SECRET:
        headers["API-SECRET"] = API_SECRET
    return headers


def _coerce(val: Any) -> Any:
    """Return a clean scalar (int, float, str) or None — never empty strings/NaN."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # Round floating point values to 2 decimals
        return int(val) if val == int(val) else round(float(val), 2)
    if isinstance(val, str):
        s = val.strip()
        return s if s else None
    return None


def patch_garmin(day: date, garmin_data: dict[str, Any], worker_url: str | None = None) -> bool:
    """Patch all available Garmin fields into the Worker for a given day."""
    url = f"{worker_url or WORKER_URL}/health/patch"
    payload: dict[str, Any] = {
        "date": day.isoformat(),
        "source": "garmin",
    }

    for field in ALLOWED_PATCH_FIELDS:
        val = _coerce(garmin_data.get(field))
        if val is not None:
            payload[field] = val

    # If only "date" and "source" are present, there is nothing meaningful to patch
    if len(payload) <= 2:
        logger.warning("patch_garmin: no patchable fields found for %s", day.isoformat())
        return False

    try:
        resp = requests.post(url, json=payload, headers=_headers(), timeout=15)
        if resp.ok:
            patched_keys = resp.json().get("patched", [])
            logger.info("Worker patched %s successfully (%d fields): %s", day.isoformat(), len(patched_keys), patched_keys)
            return True
        logger.error("Worker PATCH failed for %s: HTTP %s — %s", day.isoformat(), resp.status_code, resp.text)
    except Exception as e:
        logger.error("Worker PATCH error for %s: %s", day.isoformat(), e)

    return False


def patch_sleep(day: date, data: dict[str, Any]) -> bool:
    """Backwards-compatible alias for patch_garmin."""
    return patch_garmin(day, data)
