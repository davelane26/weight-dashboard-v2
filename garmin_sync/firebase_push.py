"""Firebase Realtime Database push helper.

Uses the REST API — no firebase-admin SDK needed.
Just PUT/PATCH JSON to the database URL.
"""

import logging

import requests

logger = logging.getLogger(__name__)


def push_day(firebase_url: str, date_key: str, data: dict) -> bool:
    """Push a single day's data to Firebase at /garmin/{date_key}.json."""
    url = f"{firebase_url}/garmin/{date_key}.json"
    try:
        resp = requests.put(url, json=data, timeout=15)
        if resp.ok:
            logger.info("Pushed data for %s to Firebase", date_key)
            return True
        if resp.status_code == 401:
            logger.debug("Firebase RTDB locked (401) — skipping legacy fallback for %s", date_key)
            return False
        logger.warning("Firebase PUT note for %s: HTTP %s", date_key, resp.status_code)
    except Exception as e:
        logger.debug("Firebase push error: %s", e)
    return False


def push_latest(firebase_url: str, data: dict) -> bool:
    """Push data to /garmin/latest.json (what the dashboard reads first)."""
    url = f"{firebase_url}/garmin/latest.json"
    try:
        resp = requests.put(url, json=data, timeout=15)
        if resp.ok:
            logger.info("Pushed latest data to Firebase")
            return True
        if resp.status_code == 401:
            logger.debug("Firebase RTDB locked (401) — skipping legacy latest fallback")
            return False
        logger.warning("Firebase PUT note for latest: HTTP %s", resp.status_code)
    except Exception as e:
        logger.debug("Firebase latest push error: %s", e)
    return False


def push_history(firebase_url: str, history: list[dict]) -> int:
    """Push a list of daily data dicts to Firebase. Returns success count."""
    success = 0
    for day_data in history:
        date_key = day_data.get("date")
        if not date_key:
            continue
        if push_day(firebase_url, date_key, day_data):
            success += 1
    # Also update /garmin/latest with the most recent day
    if history:
        push_latest(firebase_url, history[-1])
    return success
