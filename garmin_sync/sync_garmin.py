#!/usr/bin/env python3
"""Garmin Connect → Firebase sync script.

Usage:
    python sync_garmin.py              # sync today + last 7 days
    python sync_garmin.py --days 30    # sync last 30 days (backfill)
    python sync_garmin.py --today      # sync today only (fast)

Requires a .env file with GARMIN_EMAIL, GARMIN_PASSWORD, and FIREBASE_URL.
"""

import argparse
import logging
import os
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

# Load .env FIRST so proxy vars are available before any network imports
load_dotenv(Path(__file__).parent / ".env")

# Configure proxy if set (e.g. corporate networks like Walmart sysproxy)
# Set HTTP_PROXY / HTTPS_PROXY in .env to route through corporate proxy
_proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
if _proxy:
    os.environ.setdefault("HTTP_PROXY", _proxy)
    os.environ.setdefault("HTTPS_PROXY", _proxy)

from garmin_client import get_client, fetch_all_for_day, fetch_history  # noqa: E402
from garmin_cookie_client import (
    get_cookies, get_display_name,
    fetch_all_for_day as cookie_fetch_day,
    fetch_history as cookie_fetch_history,
)  # noqa: E402
from firebase_push import push_day, push_latest, push_history  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Garmin Connect data to Firebase")
    parser.add_argument("--days", type=int, default=7, help="Number of days to sync (default: 7)")
    parser.add_argument("--today", action="store_true", help="Sync today only (fastest)")
    args = parser.parse_args()

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    firebase_url = os.getenv("FIREBASE_URL")

    if not all([email, password, firebase_url]):
        logger.error(
            "Missing env vars! Copy .env.example to .env and fill in:\n"
            "  GARMIN_EMAIL, GARMIN_PASSWORD, FIREBASE_URL"
        )
        return 1

    # Try cookie-based auth first (no rate limits, no OAuth headaches)
    use_cookies = bool(os.getenv("GARMIN_COOKIES"))
    if not use_cookies:
        from pathlib import Path as _Path
        use_cookies = (_Path(__file__).parent / ".garmin_cookies").exists()

    if use_cookies:
        logger.info("Using browser cookie auth...")
        try:
            cookies = get_cookies()
            display_name = get_display_name(cookies)
            if not display_name:
                logger.warning("Could not get display name from cookies, falling back to OAuth")
                use_cookies = False
            else:
                logger.info("Authenticated via cookies as %s", display_name)
        except Exception as e:
            logger.warning("Cookie auth failed: %s — falling back to OAuth", e)
            use_cookies = False

    if use_cookies:
        if args.today:
            today = date.today()
            logger.info("Fetching today's data (%s)...", today.isoformat())
            data = cookie_fetch_day(cookies, display_name, today)
            if not data.get("steps") and not data.get("sleepHours"):
                logger.warning("No data found for today yet")
                return 0
            push_day(firebase_url, today.isoformat(), data)
            push_latest(firebase_url, data)
            _print_summary(data)
        else:
            logger.info("Fetching last %d days of data...", args.days)
            history = cookie_fetch_history(cookies, display_name, days=args.days)
            if not history:
                logger.warning("No data found")
                return 0
            count = push_history(firebase_url, history)
            logger.info("Pushed %d/%d days to Firebase", count, len(history))
            _print_summary(history[-1])
        logger.info("Sync complete!")
        return 0

    # Fall back to OAuth/garth-based auth
    logger.info("Connecting to Garmin Connect as %s...", email)
    try:
        client = get_client(email, password)
    except Exception as e:
        logger.error("Authentication failed: %s", e)
        logger.info("Tip: If you use MFA, you may need to generate an app-specific password.")
        return 1

    logger.info("\u2705 Authenticated with Garmin Connect")

    if args.today:
        # Fast mode: today only
        today = date.today()
        logger.info("Fetching today's data (%s)...", today.isoformat())
        data = fetch_all_for_day(client, today)
        if not data.get("steps") and not data.get("sleepHours"):
            logger.warning("No data found for today yet")
            return 0

        push_day(firebase_url, today.isoformat(), data)
        push_latest(firebase_url, data)
        _print_summary(data)
    else:
        # Multi-day sync
        logger.info("Fetching last %d days of data...", args.days)
        history = fetch_history(client, days=args.days)
        if not history:
            logger.warning("No data found for the last %d days", args.days)
            return 0

        count = push_history(firebase_url, history)
        logger.info("\u2705 Pushed %d/%d days to Firebase", count, len(history))

        # Print latest summary
        _print_summary(history[-1])

    logger.info("\u2705 Sync complete!")
    return 0


def _print_summary(data: dict) -> None:
    """Print a nice summary of the synced data."""
    print("\n" + "=" * 50)
    print(f"  \U0001f3c3 Steps:      {data.get('steps', 0):,}")
    print(f"  \U0001f525 Calories:   {data.get('totalCalories', 0):,} total / {data.get('activeCalories', 0):,} active")
    print(f"  \u2764\ufe0f  Resting HR: {data.get('restingHR', '-')} bpm")
    print(f"  \U0001f4a4 Sleep:      {data.get('sleepDuration', '-')} (score: {data.get('sleepScore', '-')})")
    if data.get("sleepStages"):
        s = data["sleepStages"]
        print(f"     Deep: {s.get('deep', 0)}h | Light: {s.get('light', 0)}h | REM: {s.get('rem', 0)}h")
    print(f"  \U0001f614 Stress:     {data.get('stressLevel', '-')} avg")
    print(f"  \U0001f50b Battery:    {data.get('bodyBattery', '-')}")
    print(f"  \U0001f4aa Intensity:  {data.get('intensityMinutes', 0)} min")
    if data.get("vo2Max"):
        print(f"  \U0001f3af VO2 Max:    {data['vo2Max']:.1f}")
    if data.get("fitnessAge"):
        print(f"  \U0001f9d1 Fitness Age: {data['fitnessAge']}")
    if data.get("hrvLastNight"):
        print(f"  \U0001f49a HRV:        {data['hrvLastNight']} ms (weekly avg: {data.get('hrvWeeklyAvg', '-')})")
    if data.get("activities"):
        print(f"  \U0001f3cb\ufe0f  Activities: {len(data['activities'])}")
        for act in data["activities"]:
            print(f"     - {act['name']} ({act['duration']:.0f} min, {act.get('calories', 0)} cal)")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    sys.exit(main())
