#!/usr/bin/env python3
"""Garmin Connect → Dashboard sync script.

Uses python-garminconnect (v0.3.x) with native curl_cffi session persistence
to pull health, sleep, and body composition data from Garmin and push to:
  1. Cloudflare Worker (/health/patch) → powers the live Activity tab
  2. Firebase Realtime Database (/garmin/{date}.json) → fallback storage

Usage:
    python sync_garmin.py              # sync today + last 7 days
    python sync_garmin.py --today      # sync today only (fast)
    python sync_garmin.py --days 30    # backfill last 30 days
    python sync_garmin.py --dry-run    # inspect data without pushing
"""

import argparse
import logging
import os
import sys

# Ensure Unicode (emojis) prints properly on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

# Load .env from garmin_sync folder or repo root
_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")
load_dotenv(_script_dir.parent / ".env")

# Route proxy if set in .env (e.g. corporate proxy)
_proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
if _proxy:
    os.environ.setdefault("HTTP_PROXY", _proxy)
    os.environ.setdefault("HTTPS_PROXY", _proxy)

from garmin_client import get_client, fetch_all_for_day, fetch_history  # noqa: E402
from push_worker import patch_garmin  # noqa: E402
from firebase_push import push_day, push_latest, push_history  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("garmin_sync")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Garmin Connect data to Weight Dashboard")
    parser.add_argument("--today", action="store_true", help="Sync today's stats only (fast)")
    parser.add_argument("--days", type=int, default=None, help="Number of days to sync (default: 7)")
    parser.add_argument("--no-worker", action="store_true", help="Skip pushing to Cloudflare Worker")
    parser.add_argument("--no-firebase", action="store_true", help="Skip pushing to Firebase RTDB")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and print data without uploading")
    args = parser.parse_args()

    firebase_url = os.getenv("FIREBASE_URL")
    worker_url = os.getenv("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")

    # Authenticate with Garmin Connect (reusing cached .garmin_tokens if available)
    try:
        client = get_client()
    except Exception as e:
        logger.error("Garmin authentication failed: %s", e)
        logger.info("\nTip: Run 'python setup_garmin.py' to perform the initial login and save your session token.\n")
        return 1

    logger.info("Authenticated with Garmin Connect ✓ (User: %s)", getattr(client, "display_name", "Garmin User"))

    # Determine date range
    if args.today or args.days == 1:
        today = date.today()
        logger.info("Fetching Garmin data for today (%s)...", today.isoformat())
        data = fetch_all_for_day(client, today)
        _print_summary(data)

        if args.dry_run:
            logger.info("Dry-run mode: skipping upload.")
            return 0

        # Update local health.json in dashboard repo
        update_health_json([data])

        # Push to Worker
        if not args.no_worker:
            patch_garmin(today, data, worker_url=worker_url)

        # Push to Firebase
        if not args.no_firebase and firebase_url:
            push_day(firebase_url, today.isoformat(), data)
            push_latest(firebase_url, data)

    else:
        num_days = args.days if args.days else 7
        logger.info("Fetching Garmin data for the last %d days...", num_days)
        history = fetch_history(client, days=num_days)

        if not history:
            logger.warning("No data returned for the requested date range.")
            return 0

        # Update local health.json in dashboard repo
        update_health_json(history)

        for day_data in history:
            day_str = day_data.get("date")
            if not day_str:
                continue
            day_obj = date.fromisoformat(day_str)

            if not args.dry_run and not args.no_worker:
                patch_garmin(day_obj, day_data, worker_url=worker_url)

        if not args.dry_run and not args.no_firebase and firebase_url:
            count = push_history(firebase_url, history)
            logger.info("Pushed %d/%d days to Firebase", count, len(history))

        _print_summary(history[-1])

    logger.info("Garmin sync complete! ✓")
    return 0


def update_health_json(data_items: list[dict]) -> bool:
    """Merge Garmin data into the repo's health.json file."""
    import json
    from datetime import datetime, timezone
    health_json_path = _script_dir.parent / "health.json"
    if not health_json_path.exists():
        return False
    try:
        content = json.loads(health_json_path.read_text(encoding="utf-8"))
        days_list = content.get("days", [])
        by_date = {d["date"]: d for d in days_list if "date" in d}

        for item in data_items:
            dt = item.get("date")
            if not dt:
                continue
            existing = by_date.get(dt, {"date": dt})
            for k, v in item.items():
                if v is not None and k not in ("lastUpdated", "steps", "distance", "distanceMeters"):
                    existing[k] = v
            acts = existing.get("activities") or []
            if acts:
                existing["workoutsMins"] = round(sum(a.get("duration", 0) for a in acts), 1)
                existing["workoutsKm"] = round(sum(a.get("distance", 0) for a in acts) * 1.609344, 2)
            by_date[dt] = existing

        content["days"] = sorted(by_date.values(), key=lambda x: x["date"])
        content["lastUpdated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        health_json_path.write_text(json.dumps(content, indent=2), encoding="utf-8")
        logger.info("Updated %s with latest Garmin metrics ✓", health_json_path.name)
        return True
    except Exception as e:
        logger.warning("Could not update %s: %s", health_json_path.name, e)
        return False


def _print_summary(data: dict) -> None:
    """Print an attractive console summary of the synced Garmin metrics."""
    day_str = data.get("date", str(date.today()))
    print("\n" + "=" * 55)
    print(f"  📊 Garmin Summary for {day_str}")
    print("=" * 55)
    print(f"  👟 Steps:           {data.get('steps', 0):,} steps ({data.get('distance', 0)} mi)")
    print(f"  🔥 Calories:        {data.get('totalCalories', 0):,} kcal ({data.get('activeCalories', 0):,} active)")
    print(f"  ❤️  Resting HR:      {data.get('restingHR', '—')} bpm")
    if data.get('minHR') and data.get('maxHR'):
        print(f"  💓 HR Range:        {data['minHR']} – {data['maxHR']} bpm (avg: {data.get('avgHR', '—')})")

    sleep_score = data.get('sleepScore')
    sleep_dur = data.get('sleepDuration') or f"{data.get('sleepHours', 0)}h"
    score_str = f"score: {sleep_score}/100" if sleep_score is not None else "no score"
    print(f"  😴 Sleep:           {sleep_dur} ({score_str})")

    stages = data.get("sleepStages") or {}
    if any(stages.values()):
        print(f"     Deep: {stages.get('deep', 0)}h | Light: {stages.get('light', 0)}h | REM: {stages.get('rem', 0)}h | Awake: {stages.get('awake', 0)}h")

    if data.get('stressLevel') is not None:
        print(f"  🧠 Stress Level:    {data['stressLevel']}/100 avg")
    if data.get('bodyBattery') is not None:
        print(f"  🔋 Body Battery:    {data['bodyBattery']}/100")
    if data.get('intensityMinutes') is not None:
        print(f"  ⚡ Intensity:       {data['intensityMinutes']} min")
    if data.get('vo2Max'):
        print(f"  🎯 VO2 Max:         {data['vo2Max']}")
    if data.get('hrvLastNight'):
        print(f"  💚 HRV Last Night:  {data['hrvLastNight']} ms (weekly: {data.get('hrvWeeklyAvg', '—')} ms)")

    if data.get('garminWeight'):
        fat_str = f", fat: {data['garminBodyFat']}%" if data.get('garminBodyFat') else ""
        print(f"  ⚖️  Scale Weight:    {data['garminWeight']} lbs (BMI: {data.get('garminBMI', '—')}{fat_str})")

    activities = data.get("activities") or []
    if activities:
        print(f"  🏃 Activities ({len(activities)}):")
        for act in activities:
            print(f"     • {act.get('name', 'Workout')} ({act.get('duration', 0)} min, {act.get('calories', 0)} kcal)")

    print("=" * 55 + "\n")


if __name__ == "__main__":
    sys.exit(main())
