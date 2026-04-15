"""Push precise Garmin sleep data to the Cloudflare Worker.

Patches only sleep-specific fields so the richer Exist.io data
(workouts, deep/light/rem stages) is preserved — not overwritten.
"""

import logging
import os
from datetime import date

import requests

logger = logging.getLogger(__name__)

WORKER_URL = os.environ.get(
    "WORKER_URL", "https://glucose-relay.djtwo6.workers.dev"
)
API_SECRET = os.environ.get("WORKER_API_SECRET", "")


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if API_SECRET:
        h["API-SECRET"] = API_SECRET
    return h


def patch_sleep(day: date, sleep_data: dict) -> bool:
    """PATCH sleepScore + precise sleepHours into the Worker for a given day.

    ``sleep_data`` should come straight from garmin_cookie_client.fetch_sleep().
    Only non-None values are sent — the Worker merges them into the existing record.
    """
    score = sleep_data.get("sleepScore")
    hours = sleep_data.get("sleepHours")

    if score is None and hours is None:
        logger.warning("patch_sleep: nothing to patch for %s — skipping", day)
        return False

    payload: dict = {"date": day.isoformat()}
    if score is not None:
        payload["sleepScore"] = int(score)
    if hours is not None:
        # Store to 2dp so 6h 18m → 6.30, not 6.3 (avoids float weirdness)
        payload["sleepHours"] = round(float(hours), 2)

    url = f"{WORKER_URL}/health/patch"
    try:
        resp = requests.post(url, json=payload, headers=_headers(), timeout=15)
        if resp.ok:
            logger.info(
                "Worker patched %s — sleepScore=%s sleepHours=%s",
                day, payload.get("sleepScore"), payload.get("sleepHours"),
            )
            return True
        logger.error(
            "Worker PATCH failed for %s: %s %s", day, resp.status_code, resp.text
        )
    except Exception as e:
        logger.error("Worker PATCH error for %s: %s", day, e)

    return False
