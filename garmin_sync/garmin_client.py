"""Garmin Connect API client wrapper.

Handles authentication, session caching, and data fetching
from Garmin Connect using the garminconnect package.
"""

import json
import logging
from datetime import date, timedelta
from pathlib import Path

from garminconnect import Garmin

logger = logging.getLogger(__name__)

SESSION_FILE = Path(__file__).parent / ".garmin_session"


def get_client(email: str, password: str) -> Garmin:
    """Authenticate with Garmin Connect, reusing cached session if valid."""
    client = Garmin(email, password)

    if SESSION_FILE.exists():
        try:
            saved = json.loads(SESSION_FILE.read_text())
            client.garth.loads(saved)
            client.display_name  # quick check — throws if session expired
            logger.info("Reused cached Garmin session")
            return client
        except Exception:
            logger.info("Cached session expired, re-authenticating")

    client.login()
    SESSION_FILE.write_text(json.dumps(client.garth.dumps()))
    logger.info("Logged in to Garmin Connect, session cached")
    return client


def fetch_daily_summary(client: Garmin, day: date) -> dict:
    """Fetch the daily stats summary for a given date."""
    iso = day.isoformat()
    try:
        stats = client.get_stats(iso)
    except Exception as e:
        logger.warning("Failed to get stats for %s: %s", iso, e)
        return {}

    return {
        "date": iso,
        "steps": stats.get("totalSteps", 0),
        "distance": round((stats.get("totalDistanceMeters") or 0) / 1609.34, 2),
        "floorsClimbed": stats.get("floorsAscended", 0),
        "activeCalories": stats.get("activeKilocalories", 0),
        "totalCalories": stats.get("totalKilocalories", 0),
        "restingCalories": stats.get("bmrKilocalories", 0),
        "restingHR": stats.get("restingHeartRate"),
        "minHR": stats.get("minHeartRate"),
        "maxHR": stats.get("maxHeartRate"),
        "avgHR": stats.get("averageHeartRate"),
        "stressLevel": stats.get("averageStressLevel"),
        "maxStress": stats.get("maxStressLevel"),
        "bodyBattery": _extract_body_battery(stats),
        "intensityMinutes": (
            (stats.get("moderateIntensityMinutes") or 0)
            + (stats.get("vigorousIntensityMinutes") or 0)
        ),
        "moderateIntensity": stats.get("moderateIntensityMinutes", 0),
        "vigorousIntensity": stats.get("vigorousIntensityMinutes", 0),
    }


def fetch_sleep(client: Garmin, day: date) -> dict:
    """Fetch sleep data for a given date."""
    iso = day.isoformat()
    try:
        sleep = client.get_sleep_data(iso)
    except Exception as e:
        logger.warning("Failed to get sleep for %s: %s", iso, e)
        return {}

    daily = sleep.get("dailySleepDTO", {})
    if not daily:
        return {}

    duration_secs = daily.get("sleepTimeSeconds") or 0
    hours = duration_secs / 3600
    deep_secs = daily.get("deepSleepSeconds") or 0
    light_secs = daily.get("lightSleepSeconds") or 0
    rem_secs = daily.get("remSleepSeconds") or 0
    awake_secs = daily.get("awakeSleepSeconds") or 0

    return {
        "sleepHours": round(hours, 1),
        "sleepDuration": f"{int(hours)}h {int((hours % 1) * 60)}m",
        "sleepScore": daily.get("sleepScores", {}).get("overall", {}).get("value"),
        "sleepStart": daily.get("sleepStartTimestampLocal"),
        "sleepEnd": daily.get("sleepEndTimestampLocal"),
        "deepSleep": round(deep_secs / 3600, 1),
        "lightSleep": round(light_secs / 3600, 1),
        "remSleep": round(rem_secs / 3600, 1),
        "awakeSleep": round(awake_secs / 3600, 1),
        "sleepStages": {
            "deep": round(deep_secs / 3600, 2),
            "light": round(light_secs / 3600, 2),
            "rem": round(rem_secs / 3600, 2),
            "awake": round(awake_secs / 3600, 2),
        },
    }


def fetch_hrv(client: Garmin, day: date) -> dict:
    """Fetch heart rate variability data."""
    iso = day.isoformat()
    try:
        hrv = client.get_hrv_data(iso)
    except Exception as e:
        logger.warning("Failed to get HRV for %s: %s", iso, e)
        return {}

    summary = hrv.get("hrvSummary", {})
    return {
        "hrvWeeklyAvg": summary.get("weeklyAvg"),
        "hrvLastNight": summary.get("lastNightAvg"),
        "hrvStatus": summary.get("status"),
        "hrvBaseline": {
            "low": summary.get("baselineLowUpper"),
            "balanced": summary.get("baselineBalancedUpper"),
        },
    }


def fetch_training_status(client: Garmin, day: date) -> dict:
    """Fetch VO2 max, training load, and fitness age."""
    try:
        metrics = client.get_max_metrics(day.isoformat())
    except Exception as e:
        logger.warning("Failed to get training metrics: %s", e)
        return {}

    if not metrics:
        return {}

    # metrics can be a list — take the latest entry
    entry = metrics[0] if isinstance(metrics, list) else metrics
    generic = entry.get("generic", {})
    return {
        "vo2Max": generic.get("vo2MaxPreciseValue"),
        "fitnessAge": generic.get("fitnessAge"),
    }


def fetch_activities(client: Garmin, day: date, limit: int = 10) -> list:
    """Fetch recent activities (workouts)."""
    try:
        activities = client.get_activities_by_date(
            day.isoformat(),
            day.isoformat(),
        )
    except Exception as e:
        logger.warning("Failed to get activities: %s", e)
        return []

    result = []
    for act in (activities or [])[:limit]:
        result.append({
            "name": act.get("activityName", "Unknown"),
            "type": act.get("activityType", {}).get("typeKey", "other"),
            "startTime": act.get("startTimeLocal"),
            "duration": round((act.get("duration") or 0) / 60, 1),
            "distance": round((act.get("distance") or 0) / 1609.34, 2),
            "calories": act.get("calories", 0),
            "avgHR": act.get("averageHR"),
            "maxHR": act.get("maxHR"),
            "avgPace": _format_pace(act.get("averageSpeed")),
            "elevationGain": round((act.get("elevationGain") or 0) * 3.281, 0),
        })
    return result


def fetch_body_composition(client: Garmin, day: date) -> dict:
    """Fetch body composition from Garmin (scale data)."""
    iso = day.isoformat()
    try:
        data = client.get_body_composition(iso, iso)
    except Exception as e:
        logger.warning("Failed to get body composition: %s", e)
        return {}

    weights = data.get("dateWeightList") or []
    if not weights:
        return {}

    latest = weights[-1]
    return {
        "garminWeight": round((latest.get("weight") or 0) / 1000 * 2.205, 1),
        "garminBMI": latest.get("bmi"),
        "garminBodyFat": latest.get("bodyFat"),
        "garminMuscle": latest.get("muscleMass"),
        "garminBone": round((latest.get("boneMass") or 0) / 1000 * 2.205, 2),
        "garminWater": latest.get("bodyWater"),
    }


def fetch_all_for_day(client: Garmin, day: date) -> dict:
    """Fetch all available data for a single day and merge into one dict."""
    result = fetch_daily_summary(client, day)
    result.update(fetch_sleep(client, day))
    result.update(fetch_hrv(client, day))
    result.update(fetch_training_status(client, day))
    result.update(fetch_body_composition(client, day))
    result["activities"] = fetch_activities(client, day)
    result["lastUpdated"] = _now_iso()
    return result


def fetch_history(client: Garmin, days: int = 7) -> list[dict]:
    """Fetch data for the last N days."""
    today = date.today()
    history = []
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        logger.info("Fetching data for %s", day.isoformat())
        data = fetch_all_for_day(client, day)
        if data.get("steps") or data.get("sleepHours"):
            history.append(data)
    return history


# ── Private helpers ──────────────────────────────────────────────
def _extract_body_battery(stats: dict) -> int | None:
    """Pull highest body battery from daily stats."""
    charged = stats.get("bodyBatteryChargedValue")
    drained = stats.get("bodyBatteryDrainedValue")
    highest = stats.get("bodyBatteryHighestValue")
    return highest or charged


def _format_pace(speed_mps: float | None) -> str | None:
    """Convert m/s to min:sec per mile pace string."""
    if not speed_mps or speed_mps <= 0:
        return None
    secs_per_mile = 1609.34 / speed_mps
    mins = int(secs_per_mile // 60)
    secs = int(secs_per_mile % 60)
    return f"{mins}:{secs:02d}"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
