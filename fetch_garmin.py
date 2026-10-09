"""fetch_garmin.py — Pulls daily health data from Garmin Connect using python-garminconnect (v0.3.x).

Authenticates via stored session tokens (local .garmin_tokens or GARMIN_TOKENS secret in CI).
Pushes metrics directly to the Cloudflare Worker (/health/patch).

Usage:
    python fetch_garmin.py
"""

import logging
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from datetime import date, timedelta
from pathlib import Path

# Add garmin_sync directory to Python path
repo_root = Path(__file__).parent
garmin_sync_dir = repo_root / "garmin_sync"
if str(garmin_sync_dir) not in sys.path:
    sys.path.insert(0, str(garmin_sync_dir))

from garmin_client import get_client, fetch_all_for_day
from push_worker import patch_garmin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("fetch_garmin")

WORKER_URL = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")
TODAY = date.today()


def main() -> int:
    logger.info("Connecting to Garmin Connect...")
    try:
        client = get_client()
    except Exception as e:
        logger.error("Authentication failed: %s", e)
        logger.info("Tip: Run 'python garmin_sync/setup_garmin.py' to generate your session token.")
        return 1

    days_to_sync = int(os.environ.get("SYNC_DAYS", "3"))
    logger.info("Syncing last %d days of Garmin metrics...", days_to_sync)

    all_ok = True
    for offset in range(days_to_sync - 1, -1, -1):
        target_date = TODAY - timedelta(days=offset)
        logger.info("Fetching Garmin metrics for %s", target_date.isoformat())
        data = fetch_all_for_day(client, target_date)

        if not data.get("steps") and not data.get("sleepHours") and not data.get("restingHR"):
            logger.warning("No activity or sleep data returned for %s yet", target_date.isoformat())

        ok = patch_garmin(target_date, data, worker_url=WORKER_URL)
        if not ok and offset == 0:
            all_ok = False

    if all_ok:
        logger.info("Done ✓ — Garmin metrics synced to Worker successfully")
        return 0
    else:
        logger.error("Failed to patch some Garmin metrics to Worker")
        return 1


if __name__ == "__main__":
    sys.exit(main())
