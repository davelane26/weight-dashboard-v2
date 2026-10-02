"""
fetch_google_health.py — Pulls daily sleep, HRV, and resting HR from Google Health API
and patches them into Cloudflare Worker /health/patch.

Preserves real-time steps tracked by the Kage phone app via field-level merging.

Required env vars:
  GOOGLE_HEALTH_CLIENT_ID
  GOOGLE_HEALTH_CLIENT_SECRET
  GOOGLE_HEALTH_REFRESH_TOKEN
  API_SECRET_V2 (or API_SECRET)
  WORKER_URL (optional, default: https://glucose-relay.djtwo6.workers.dev)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

# ── Config ──────────────────────────────────────────────────────────────────
CLIENT_ID     = os.environ.get("GOOGLE_HEALTH_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_HEALTH_CLIENT_SECRET", "")
REFRESH_TOKEN = os.environ.get("GOOGLE_HEALTH_REFRESH_TOKEN", "")
API_SECRET    = os.environ.get("API_SECRET_V2") or os.environ.get("API_SECRET", "")
WORKER_URL    = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev").rstrip("/")

BASE_API = "https://health.googleapis.com/v4/users/me/dataTypes"

def get_access_token():
    """Exchange refresh token for an ephemeral access token."""
    if not CLIENT_ID or not CLIENT_SECRET or not REFRESH_TOKEN:
        print("ERROR: Missing GOOGLE_HEALTH_CLIENT_ID, CLIENT_SECRET, or REFRESH_TOKEN", file=sys.stderr)
        sys.exit(1)

    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": REFRESH_TOKEN,
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"ERROR: Failed to refresh access token ({resp.status_code}): {resp.text}", file=sys.stderr)
        sys.exit(1)

    return resp.json().get("access_token")

def fetch_sleep(token, start_iso, end_iso):
    """Fetch sleep data points from Google Health API."""
    url = f"{BASE_API}/sleep/dataPoints"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"startTime": start_iso, "endTime": end_iso}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=20)
        if resp.status_code == 200:
            return resp.json().get("dataPoints", [])
        print(f"Notice: Sleep query returned HTTP {resp.status_code}: {resp.text[:120]}")
    except Exception as e:
        print(f"Warning: Sleep fetch failed: {e}")
    return []

def parse_sleep(data_points):
    """Aggregate sleep stages and total duration from data points."""
    if not data_points:
        return {}

    total_seconds = 0
    deep_secs = 0
    light_secs = 0
    rem_secs = 0
    awakenings = 0
    sleep_score = None

    for dp in data_points:
        val = dp.get("value", {})
        # Google Health sleep score if provided by Google Health Premium
        if "score" in val and val["score"] is not None:
            sleep_score = int(val["score"])
        elif "sleepScore" in val and val["sleepScore"] is not None:
            sleep_score = int(val["sleepScore"])

        stage = (val.get("stage") or val.get("sleepStage") or "").upper()
        dur = dp.get("durationSeconds") or val.get("durationSeconds")
        if not dur and "startTime" in dp and "endTime" in dp:
            try:
                t0 = datetime.fromisoformat(dp["startTime"].replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(dp["endTime"].replace("Z", "+00:00"))
                dur = (t1 - t0).total_seconds()
            except Exception:
                dur = 0
        dur = float(dur or 0)
        total_seconds += dur

        if stage == "DEEP":
            deep_secs += dur
        elif stage == "LIGHT":
            light_secs += dur
        elif stage == "REM":
            rem_secs += dur
        elif stage in ("AWAKE", "AWAKE_IN_BED"):
            awakenings += 1

    res = {
        "sleepHours": round(total_seconds / 3600.0, 2) if total_seconds > 0 else None,
        "sleepDeep": round(deep_secs / 3600.0, 2) if deep_secs > 0 else None,
        "sleepLight": round(light_secs / 3600.0, 2) if light_secs > 0 else None,
        "sleepRem": round(rem_secs / 3600.0, 2) if rem_secs > 0 else None,
        "sleepAwakenings": awakenings if awakenings > 0 else None,
    }
    if sleep_score is not None:
        res["sleepScore"] = sleep_score
    return res

def fetch_health_metrics(token, start_iso, end_iso):
    """Fetch resting heart rate, HRV, and SpO2 if available."""
    metrics = {}
    headers = {"Authorization": f"Bearer {token}"}

    # Heart Rate & Resting HR
    try:
        resp = requests.get(
            f"{BASE_API}/heart-rate/dataPoints",
            headers=headers,
            params={"startTime": start_iso, "endTime": end_iso},
            timeout=15,
        )
        if resp.status_code == 200:
            dps = resp.json().get("dataPoints", [])
            for dp in reversed(dps):
                val = dp.get("value", {})
                rhr = val.get("restingHeartRate") or val.get("restingBpm")
                if rhr is not None:
                    metrics["restingHR"] = int(rhr)
                    break
    except Exception as e:
        print(f"Warning: Heart rate fetch error: {e}")

    # HRV (RMSSD)
    try:
        resp = requests.get(
            f"{BASE_API}/heart-rate-variability/dataPoints",
            headers=headers,
            params={"startTime": start_iso, "endTime": end_iso},
            timeout=15,
        )
        if resp.status_code == 200:
            dps = resp.json().get("dataPoints", [])
            rmssds = [
                dp.get("value", {}).get("rmssd")
                for dp in dps
                if dp.get("value", {}).get("rmssd") is not None
            ]
            if rmssds:
                metrics["hrvRmssd"] = round(sum(rmssds) / len(rmssds), 1)
    except Exception as e:
        print(f"Warning: HRV fetch error: {e}")

    # SpO2
    try:
        resp = requests.get(
            f"{BASE_API}/oxygen-saturation/dataPoints",
            headers=headers,
            params={"startTime": start_iso, "endTime": end_iso},
            timeout=15,
        )
        if resp.status_code == 200:
            dps = resp.json().get("dataPoints", [])
            spo2_vals = [
                dp.get("value", {}).get("percentage")
                for dp in dps
                if dp.get("value", {}).get("percentage") is not None
            ]
            if spo2_vals:
                metrics["spo2Avg"] = round(sum(spo2_vals) / len(spo2_vals), 1)
                metrics["spo2Min"] = round(min(spo2_vals), 1)
    except Exception as e:
        print(f"Warning: SpO2 fetch error: {e}")

    return metrics

def main():
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # Look back 36 hours to encompass the most recent night's sleep
    start_time = (now - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end_time = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"Fetching Google Health data for {today_str} ({start_time} to {end_time})...")
    token = get_access_token()

    sleep_points = fetch_sleep(token, start_time, end_time)
    sleep_data = parse_sleep(sleep_points)
    health_metrics = fetch_health_metrics(token, start_time, end_time)

    payload = {"date": today_str}
    for k, v in {**sleep_data, **health_metrics}.items():
        if v is not None:
            payload[k] = v

    print("Google Health extracted payload:")
    print(json.dumps(payload, indent=2))

    if len(payload) <= 1:
        print("Notice: No new sleep or recovery metrics recorded for this window.")
        return

    # ── Push to Cloudflare Worker /health/patch ─────────────────────────────
    patch_url = f"{WORKER_URL}/health/patch"
    headers = {"Content-Type": "application/json"}
    if API_SECRET:
        headers["API-SECRET"] = API_SECRET

    print(f"Posting patch to {patch_url}...")
    resp = requests.post(patch_url, json=payload, headers=headers, timeout=20)
    print(f"Worker response: HTTP {resp.status_code} — {resp.text}")

    if resp.status_code != 200:
        print("ERROR: Worker rejected the patch.", file=sys.stderr)
        sys.exit(1)

    print("Done ✓ Merged Google Health Premium sleep and recovery metrics.")

if __name__ == "__main__":
    main()
