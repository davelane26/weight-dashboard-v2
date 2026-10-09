"""Garmin Connect API client wrapper.

Handles authentication, token persistence, and data fetching from Garmin Connect
using the modern python-garminconnect package (v0.3.x) with native curl_cffi auth.
"""

import base64
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

logger = logging.getLogger(__name__)

# Default directory where tokenstore saves session tokens
TOKEN_DIR = Path(__file__).parent / ".garmin_tokens"
TOKEN_FILE = TOKEN_DIR / "garmin_tokens.json"


def get_client(
    email: str | None = None,
    password: str | None = None,
    prompt_mfa: Callable[[], str] | None = None,
    tokenstore_dir: Path | str | None = None,
) -> Garmin:
    """Authenticate with Garmin Connect, reusing cached session if valid.

    Session priority:
      1. GARMIN_TOKENS or GARMIN_SESSION env var (JSON or base64 string, used in CI)
      2. Local token file (.garmin_tokens/garmin_tokens.json)
      3. Fresh login with email and password
    """
    token_dir = Path(tokenstore_dir) if tokenstore_dir else TOKEN_DIR
    token_file = token_dir / "garmin_tokens.json" if token_dir.is_dir() else token_dir

    client = Garmin(email=email or "", password=password or "", prompt_mfa=prompt_mfa)

    # 1. Try session from env var (CI / GitHub Actions)
    env_token = os.environ.get("GARMIN_TOKENS") or os.environ.get("GARMIN_SESSION")
    if env_token:
        try:
            token_json = _decode_env_token(env_token)
            if token_json:
                # Cache to disk first so python-garminconnect reads garmin_tokens.json
                token_dir.mkdir(parents=True, exist_ok=True)
                token_file.write_text(token_json, encoding="utf-8")
                try:
                    client.login(tokenstore=str(token_dir))
                except Exception:
                    client.login(tokenstore=str(token_file))
                logger.info("Reused Garmin session from environment variable")
                return client
        except Exception as e:
            logger.warning("Failed to authenticate with env token: %s", e)

    # 2. Try cached local token file
    if token_file.exists():
        try:
            token_json = token_file.read_text(encoding="utf-8").strip()
            if token_json:
                client.login(tokenstore=str(token_dir))
                logger.info("Reused cached Garmin session from %s", token_file.name)
                return client
        except Exception as e:
            logger.info("Cached session invalid or expired (%s), attempting fresh login...", e)

    # 3. Fresh login with credentials
    if not email or not password:
        email = email or os.environ.get("GARMIN_EMAIL")
        password = password or os.environ.get("GARMIN_PASSWORD")

    if not email or not password:
        raise GarminConnectAuthenticationError(
            "GARMIN_EMAIL and GARMIN_PASSWORD required for fresh login, or provide valid cached tokens."
        )

    logger.info("Performing fresh login to Garmin Connect as %s...", email)
    client.username = email
    client.password = password
    token_dir.mkdir(parents=True, exist_ok=True)

    client.login(tokenstore=str(token_dir))

    # Explicitly ensure token file exists
    try:
        if hasattr(client.client, "dumps"):
            token_file.write_text(client.client.dumps(), encoding="utf-8")
    except Exception as e:
        logger.debug("Client dump fallback note: %s", e)

    logger.info("Logged in successfully to Garmin Connect (session saved to %s)", token_file.name)
    return client


def _decode_env_token(raw_token: str) -> str | None:
    """Decode a token string from env var which might be base64 or raw JSON."""
    raw = raw_token.strip()
    if not raw:
        return None

    # Check if raw JSON directly
    if raw.startswith("{") and raw.endswith("}"):
        return raw

    # Attempt base64 decode
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        if decoded.startswith("{") and decoded.endswith("}"):
            return decoded
    except Exception:
        pass

    return raw


# ── Data Fetching Methods ───────────────────────────────────────────────────

def fetch_daily_summary(client: Garmin, day: date) -> dict:
    """Fetch daily stats summary (steps, calories, HR, stress, body battery)."""
    iso = day.isoformat()
    try:
        stats = client.get_stats(iso) or {}
    except Exception as e:
        logger.warning("Failed to get stats for %s: %s", iso, e)
        return {}

    dist_meters = stats.get("totalDistanceMeters") or 0
    dist_miles = round(dist_meters / 1609.34, 2) if dist_meters else 0.0

    return {
        "date": iso,
        "steps": stats.get("totalSteps", 0),
        "distance": dist_miles,
        "distanceMeters": dist_meters,
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
        "restStressPct": (
            round(stats.get("restStressPercentage"), 1)
            if stats.get("restStressPercentage") is not None
            else None
        ),
        "bodyBattery": _extract_body_battery(stats),
        "bodyBatteryCharged": stats.get("bodyBatteryChargedValue"),
        "bodyBatteryDrained": stats.get("bodyBatteryDrainedValue"),
        "bodyBatteryWake": stats.get("bodyBatteryAtWakeTime"),
        "respirationWaking": stats.get("avgWakingRespirationValue"),
        "respirationMin": stats.get("lowestRespirationValue"),
        "respirationMax": stats.get("highestRespirationValue"),
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
        sleep = client.get_sleep_data(iso) or {}
    except Exception as e:
        logger.warning("Failed to get sleep for %s: %s", iso, e)
        return {}

    daily = sleep.get("dailySleepDTO", {}) or {}
    if not daily:
        return {}

    duration_secs = daily.get("sleepTimeSeconds") or 0
    hours = round(duration_secs / 3600, 2)
    deep_secs = daily.get("deepSleepSeconds") or 0
    light_secs = daily.get("lightSleepSeconds") or 0
    rem_secs = daily.get("remSleepSeconds") or 0
    awake_secs = daily.get("awakeSleepSeconds") or 0

    # Official Garmin Sleep Score (0-100)
    score = (
        (daily.get("sleepScores") or {}).get("overall", {}).get("value")
        or daily.get("sleepScore")
    )

    resp_sleep = daily.get("averageRespirationValue")

    return {
        "sleepHours": hours,
        "sleepDuration": f"{int(hours)}h {int((hours % 1) * 60)}m",
        "sleepScore": int(score) if score is not None else None,
        "sleepStart": daily.get("sleepStartTimestampLocal"),
        "sleepEnd": daily.get("sleepEndTimestampLocal"),
        "bedtime": daily.get("sleepStartTimestampLocal"),
        "waketime": daily.get("sleepEndTimestampLocal"),
        "sleepDeep": round(deep_secs / 3600, 2),
        "sleepLight": round(light_secs / 3600, 2),
        "sleepRem": round(rem_secs / 3600, 2),
        "awakeSleep": round(awake_secs / 3600, 2),
        "sleepAwakenings": daily.get("awakeCount") or (1 if awake_secs > 0 else 0),
        "timeInBed": round((daily.get("unmeasurableSleepSeconds", 0) + duration_secs + awake_secs) / 3600, 2),
        "respirationSleep": resp_sleep,
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
        hrv = client.get_hrv_data(iso) or {}
    except Exception as e:
        logger.warning("Failed to get HRV for %s: %s", iso, e)
        return {}

    summary = hrv.get("hrvSummary", {}) or {}
    last_night = summary.get("lastNightAvg")
    return {
        "hrvWeeklyAvg": summary.get("weeklyAvg"),
        "hrvLastNight": last_night,
        "hrvRmssd": last_night,  # Map to Worker's hrvRmssd field
        "hrvStatus": summary.get("status"),
        "hrvBaseline": {
            "low": summary.get("baselineLowUpper"),
            "balanced": summary.get("baselineBalancedUpper"),
        },
    }


def fetch_respiration(client: Garmin, day: date) -> dict:
    """Fetch daily respiration summary if available."""
    iso = day.isoformat()
    try:
        resp = client.get_respiration_data(iso) or {}
        return {
            "respirationWaking": resp.get("avgWakingRespirationValue"),
            "respirationSleep": resp.get("avgSleepRespirationValue"),
            "respirationMin": resp.get("lowestRespirationValue"),
            "respirationMax": resp.get("highestRespirationValue"),
        }
    except Exception as e:
        logger.debug("get_respiration_data failed for %s: %s", iso, e)
        return {}


def fetch_training_status(client: Garmin, day: date) -> dict:
    """Fetch VO2 max, training load, and fitness age."""
    iso = day.isoformat()
    result = {}
    try:
        metrics = client.get_max_metrics(iso) or {}
        entry = metrics[0] if isinstance(metrics, list) and metrics else (metrics if isinstance(metrics, dict) else {})
        generic = entry.get("generic", {}) or {}
        vo2 = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        if vo2:
            result["vo2Max"] = round(vo2, 1)
        if generic.get("fitnessAge"):
            result["fitnessAge"] = round(generic.get("fitnessAge"), 1)
    except Exception as e:
        logger.debug("Failed to get max_metrics for %s: %s", iso, e)

    # vívosmart 5 & modern wellness devices have a dedicated fitness age endpoint
    try:
        fa = client.get_fitnessage_data(iso) or {}
        cur_fa = fa.get("fitnessAge")
        ach_fa = fa.get("achievableFitnessAge")
        if cur_fa:
            result["fitnessAge"] = round(cur_fa, 1)
        if ach_fa:
            result["achievableFitnessAge"] = round(ach_fa, 1)
    except Exception as e:
        logger.debug("Failed to get fitnessage_data for %s: %s", iso, e)

    return result


def fetch_activities(client: Garmin, day: date, limit: int = 10) -> list[dict]:
    """Fetch workout activities recorded on the date."""
    iso = day.isoformat()
    try:
        activities = client.get_activities_by_date(iso, iso) or []
    except Exception as e:
        logger.warning("Failed to get activities for %s: %s", iso, e)
        return []

    result = []
    for act in activities[:limit]:
        dist_m = act.get("distance") or 0
        result.append({
            "name": act.get("activityName", "Activity"),
            "type": act.get("activityType", {}).get("typeKey", "other"),
            "startTime": act.get("startTimeLocal"),
            "duration": round((act.get("duration") or 0) / 60, 1),
            "distance": round(dist_m / 1609.34, 2) if dist_m else 0.0,
            "calories": act.get("calories", 0),
            "avgHR": act.get("averageHR"),
            "maxHR": act.get("maxHR"),
            "avgPace": _format_pace(act.get("averageSpeed")),
            "elevationGain": round((act.get("elevationGain") or 0) * 3.281, 0),
        })
    return result


def fetch_body_composition(client: Garmin, day: date) -> dict:
    """Fetch Garmin scale/weight and body composition data."""
    iso = day.isoformat()
    try:
        data = client.get_body_composition(iso, iso) or {}
    except Exception as e:
        logger.warning("Failed to get body composition for %s: %s", iso, e)
        return {}

    weights = data.get("dateWeightList") or []
    if not weights:
        return {}

    latest = weights[-1]
    weight_g = latest.get("weight") or 0
    weight_lbs = round(weight_g / 1000 * 2.20462, 1) if weight_g else None
    bone_g = latest.get("boneMass") or 0

    return {
        "garminWeight": weight_lbs,
        "garminWeightKg": round(weight_g / 1000, 2) if weight_g else None,
        "garminBMI": latest.get("bmi"),
        "garminBodyFat": latest.get("bodyFat"),
        "garminMuscle": latest.get("muscleMass"),
        "garminBone": round(bone_g / 1000 * 2.20462, 2) if bone_g else None,
        "garminWater": latest.get("bodyWater"),
        "hcWeightTestLbs": weight_lbs,  # Optional Worker field for Activity tab
    }


def fetch_all_for_day(client: Garmin, day: date) -> dict:
    """Fetch all available Garmin metrics for a single date."""
    result = fetch_daily_summary(client, day)
    result.update(fetch_sleep(client, day))
    result.update(fetch_hrv(client, day))
    for k, v in fetch_respiration(client, day).items():
        if v is not None or k not in result:
            result[k] = v
    result.update(fetch_training_status(client, day))
    result.update(fetch_body_composition(client, day))
    result["activities"] = fetch_activities(client, day)
    result["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    return result


def fetch_history(client: Garmin, days: int = 7) -> list[dict]:
    """Fetch history for the past N days."""
    today = date.today()
    history = []
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        logger.info("Fetching Garmin data for %s", day.isoformat())
        data = fetch_all_for_day(client, day)
        if data.get("steps") or data.get("sleepHours") or data.get("restingHR"):
            history.append(data)
    return history


# ── Private Helpers ─────────────────────────────────────────────────────────

def _extract_body_battery(stats: dict) -> int | None:
    """Extract highest or current body battery level."""
    return (
        stats.get("bodyBatteryHighestValue")
        or stats.get("bodyBatteryChargedValue")
        or stats.get("bodyBatteryMostRecentValue")
    )


def _format_pace(speed_mps: float | None) -> str | None:
    """Convert speed (m/s) to pace string (min:sec per mile)."""
    if not speed_mps or speed_mps <= 0:
        return None
    secs_per_mile = 1609.34 / speed_mps
    mins = int(secs_per_mile // 60)
    secs = int(secs_per_mile % 60)
    return f"{mins}:{secs:02d}"
