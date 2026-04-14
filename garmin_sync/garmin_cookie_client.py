"""Garmin Connect web cookie-based client.

Uses browser session cookies to call Garmin's web proxy API.
No OAuth/garth needed — just copy cookies from Chrome DevTools.

Cookies are read from GARMIN_COOKIES env var (JSON dict) or .garmin_cookies file.
"""

import json
import logging
import os
from datetime import date, timedelta
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

COOKIES_FILE = Path(__file__).parent / ".garmin_cookies"
BASE = "https://connect.garmin.com/proxy"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "NK": "NT",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}


def get_cookies() -> dict:
    """Load cookies from env var or file."""
    raw = os.environ.get("GARMIN_COOKIES")
    if raw:
        logger.info("Loaded Garmin cookies from GARMIN_COOKIES env var")
        return json.loads(raw)
    if COOKIES_FILE.exists():
        logger.info("Loaded Garmin cookies from file")
        return json.loads(COOKIES_FILE.read_text())
    raise RuntimeError(
        "No Garmin cookies found. Set GARMIN_COOKIES env var or run save_cookies.py."
    )


def _get(path: str, cookies: dict, params: dict | None = None) -> dict | list | None:
    """Make an authenticated GET request to the Garmin web proxy."""
    url = f"{BASE}/{path}"
    try:
        r = requests.get(url, cookies=cookies, headers=HEADERS, params=params, timeout=15)
        logger.debug("GET %s -> %d", url, r.status_code)
        if r.status_code in (401, 403):
            logger.warning("Auth failed (%d) for %s — cookies may be expired or IP-bound", r.status_code, path)
            return None
        if r.status_code == 302 or (r.text and r.text.strip().startswith("<")):
            logger.warning("Got redirect/HTML for %s — session likely expired or IP-bound", path)
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("Request failed for %s: %s", path, e)
        return None


def get_display_name(cookies: dict) -> str | None:
    """Get the user's Garmin display name."""
    data = _get("userprofile-service/userprofile/user-settings", cookies)
    if data:
        return data.get("userData", {}).get("displayName")
    return None


def fetch_daily_summary(cookies: dict, display_name: str, day: date) -> dict:
    """Fetch daily stats summary."""
    iso = day.isoformat()
    data = _get(
        f"usersummary-service/usersummary/daily/{display_name}",
        cookies,
        params={"calendarDate": iso},
    )
    if not data:
        return {}
    return {
        "date": iso,
        "steps": data.get("totalSteps", 0),
        "distance": round((data.get("totalDistanceMeters") or 0) / 1609.34, 2),
        "floorsClimbed": data.get("floorsAscended", 0),
        "activeCalories": data.get("activeKilocalories", 0),
        "totalCalories": data.get("totalKilocalories", 0),
        "restingCalories": data.get("bmrKilocalories", 0),
        "restingHR": data.get("restingHeartRate"),
        "minHR": data.get("minHeartRate"),
        "maxHR": data.get("maxHeartRate"),
        "avgHR": data.get("averageHeartRate"),
        "stressLevel": data.get("averageStressLevel"),
        "maxStress": data.get("maxStressLevel"),
        "bodyBattery": data.get("bodyBatteryHighestValue") or data.get("bodyBatteryChargedValue"),
        "intensityMinutes": (
            (data.get("moderateIntensityMinutes") or 0)
            + (data.get("vigorousIntensityMinutes") or 0)
        ),
        "moderateIntensity": data.get("moderateIntensityMinutes", 0),
        "vigorousIntensity": data.get("vigorousIntensityMinutes", 0),
    }


def fetch_sleep(cookies: dict, display_name: str, day: date) -> dict:
    """Fetch sleep data."""
    iso = day.isoformat()
    data = _get(
        f"sleep-service/sleep/{display_name}",
        cookies,
        params={"date": iso},
    )
    if not data:
        return {}
    daily = data.get("dailySleepDTO", {})
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


def fetch_activities(cookies: dict, day: date, limit: int = 10) -> list:
    """Fetch activities for a given day."""
    iso = day.isoformat()
    data = _get(
        "activitylist-service/activities/search/activities",
        cookies,
        params={"startDate": iso, "endDate": iso, "limit": limit},
    )
    if not data:
        return []
    result = []
    for act in (data if isinstance(data, list) else data.get("activityList", []))[:limit]:
        result.append({
            "name": act.get("activityName", "Unknown"),
            "type": act.get("activityType", {}).get("typeKey", "other"),
            "startTime": act.get("startTimeLocal"),
            "duration": round((act.get("duration") or 0) / 60, 1),
            "distance": round((act.get("distance") or 0) / 1609.34, 2),
            "calories": act.get("calories", 0),
            "avgHR": act.get("averageHR"),
            "maxHR": act.get("maxHR"),
        })
    return result


def fetch_all_for_day(cookies: dict, display_name: str, day: date) -> dict:
    """Fetch all data for a single day."""
    from datetime import datetime, timezone
    result = fetch_daily_summary(cookies, display_name, day)
    result.update(fetch_sleep(cookies, display_name, day))
    result["activities"] = fetch_activities(cookies, day)
    result["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    return result


def fetch_history(cookies: dict, display_name: str, days: int = 7) -> list[dict]:
    """Fetch data for the last N days."""
    today = date.today()
    history = []
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        logger.info("Fetching data for %s", day.isoformat())
        data = fetch_all_for_day(cookies, display_name, day)
        if data.get("steps") or data.get("sleepHours"):
            history.append(data)
    return history
