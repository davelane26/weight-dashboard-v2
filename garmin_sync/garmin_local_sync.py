"""
Garmin Local Sync — runs on your home laptop via Task Scheduler.
Grabs cookies directly from Chrome (no login needed) and pushes to Firebase.

Install once:
    pip install browser-cookie3 requests

Then set up the scheduler by running setup_local_task.bat
"""
import json
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
DISPLAY_NAME = "davelane26"
DAYS_BACK = 2  # sync today + yesterday in case yesterday wasn't captured
LOG_FILE = Path.home() / "AppData" / "Local" / "Temp" / "garmin_local_sync.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

# ── load garmin_cookie_client from same folder ─────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from garmin_cookie_client import fetch_all_for_day, get_display_name
from firebase_push import push_day, push_latest


def get_garmin_cookies() -> dict:
    """Extract Garmin cookies from Chrome automatically."""
    try:
        import browser_cookie3
        jar = browser_cookie3.chrome(domain_name=".garmin.com")
        cookies = {c.name: c.value for c in jar}
        if not cookies:
            raise RuntimeError("No Garmin cookies found in Chrome — are you logged in to connect.garmin.com?")
        log.info("Got %d Garmin cookies from Chrome", len(cookies))
        return cookies
    except ImportError:
        log.error("browser-cookie3 not installed — run: pip install browser-cookie3")
        sys.exit(1)
    except Exception as e:
        log.error("Could not get cookies from Chrome: %s", e)
        log.error("Make sure you're logged into connect.garmin.com in Chrome.")
        sys.exit(1)


def main():
    log.info("=" * 50)
    log.info("Garmin Local Sync starting")

    cookies = get_garmin_cookies()

    # Verify auth works
    name = get_display_name(cookies)
    if not name:
        log.error("Auth failed — cookies are expired or invalid. Open Chrome and visit connect.garmin.com to refresh your session.")
        sys.exit(1)
    log.info("Authenticated as: %s", name)

    today = date.today()
    synced = 0

    for i in range(DAYS_BACK - 1, -1, -1):
        day = today - timedelta(days=i)
        log.info("Syncing %s...", day.isoformat())
        data = fetch_all_for_day(cookies, name, day)

        if not data.get("steps") and not data.get("sleepHours"):
            log.warning("No data for %s — skipping", day.isoformat())
            continue

        date_key = day.isoformat()
        if push_day(FIREBASE_URL, date_key, data):
            log.info("Pushed %s — steps: %s, sleep: %sh, bodyBattery: %s",
                     date_key,
                     data.get("steps", 0),
                     data.get("sleepHours", 0),
                     data.get("bodyBattery"))
            synced += 1
        else:
            log.warning("Failed to push %s to Firebase", date_key)

    # Push latest
    if synced > 0:
        today_data = fetch_all_for_day(cookies, name, today)
        if today_data:
            push_latest(FIREBASE_URL, today_data)
            log.info("Updated latest entry")

    log.info("Done — synced %d days", synced)


if __name__ == "__main__":
    main()
