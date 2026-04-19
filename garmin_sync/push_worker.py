"""Push precise Garmin data to the Cloudflare Worker."""

import logging
import os
from datetime import date

import requests

logger = logging.getLogger(__name__)

WORKER_URL = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")
API_SECRET = os.environ.get("WORKER_API_SECRET", "")

# Garmin cookie client field → Worker field (when names differ)
_FIELD_MAP = {
    "deepSleep":  "sleepDeep",
    "lightSleep": "sleepLight",
    "remSleep":   "sleepRem",
}

# All fields we want to patch (Worker field names)
_PATCH_FIELDS = [
    # Sleep
    "sleepScore", "sleepHours",
    "sleepDeep", "sleepLight", "sleepRem",
    "sleepAwakenings", "timeInBed",
    # Heart / stress / battery
    "restingHR", "minHR", "maxHR", "avgHR",
    "stressLevel", "bodyBattery",
    # Activity
    "steps", "intensityMinutes", "activeCalories",
    "totalCalories", "floorsClimbed",
]


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if API_SECRET:
        h["API-SECRET"] = API_SECRET
    return h


def _coerce(v):
    """Return a clean number or None — never NaN / empty string."""
    if v is None:
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def patch_garmin(day: date, garmin_data: dict) -> bool:
    """Patch all available Garmin fields into the Worker for a given day.

    ``garmin_data`` is the combined dict from fetch_all_for_day()
    (daily summary + sleep merged together).
    """
    payload: dict = {"date": day.isoformat()}

    # Remap any field names that differ between Garmin client and Worker
    normalised = {}
    for k, v in garmin_data.items():
        worker_key = _FIELD_MAP.get(k, k)
        normalised[worker_key] = v

    for field in _PATCH_FIELDS:
        val = _coerce(normalised.get(field))
        if val is not None:
            payload[field] = val

    if len(payload) <= 1:  # only "date" key — nothing to patch
        logger.warning("patch_garmin: no patchable fields found for %s", day)
        return False

    url = f"{WORKER_URL}/health/patch"
    try:
        resp = requests.post(url, json=payload, headers=_headers(), timeout=15)
        if resp.ok:
            patched = resp.json().get("patched", [])
            logger.info("Worker patched %s — %d fields: %s", day, len(patched), patched)
            return True
        logger.error(
            "Worker PATCH failed for %s: %s %s", day, resp.status_code, resp.text
        )
    except Exception as e:
        logger.error("Worker PATCH error for %s: %s", day, e)

    return False


# ── Backwards-compat alias (garmin_local_sync still calls this) ───────────────
def patch_sleep(day: date, data: dict) -> bool:
    return patch_garmin(day, data)
