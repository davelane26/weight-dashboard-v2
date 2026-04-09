"""
fetch_glucose.py — pulls Dexcom G7 readings via the Share API and writes glucose.json.
Uses the raw Share API directly (more reliable than pydexcom for follower accounts).
Runs every 5 minutes via GitHub Actions.
Requires env vars: DEXCOM_USERNAME, DEXCOM_PASSWORD
"""

import json
import os
import sys
from datetime import datetime, timezone

import requests

# ── Dexcom Share API endpoints (US) ──────────────────────────────────────
BASE_URL     = "https://share2.dexcom.com/ShareWebServices/Services"
APP_ID       = "d8665ade-9673-4e27-9ff6-92db4ce13d13"  # Dexcom Follow app ID

# ── Trend arrow mapping ───────────────────────────────────────────────────
TREND_ARROWS = {
    1: "↑↑",  # DoubleUp
    2: "↑",   # SingleUp
    3: "↗",   # FortyFiveUp
    4: "→",   # Flat
    5: "↘",   # FortyFiveDown
    6: "↓",   # SingleDown
    7: "↓↓",  # DoubleDown
}

TREND_DESCS = {
    1: "Rising fast",
    2: "Rising",
    3: "Rising slowly",
    4: "Steady",
    5: "Falling slowly",
    6: "Falling",
    7: "Falling fast",
}

def get_session_id(username, password):
    """Authenticate and return a session ID."""
    # Step 1: get account ID
    resp = requests.post(
        f"{BASE_URL}/General/AuthenticatePublisherAccount",
        json={
            "accountName":       username,
            "password":          password,
            "applicationId":     APP_ID,
        },
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    account_id = resp.json()

    if not account_id or account_id == "00000000-0000-0000-0000-000000000000":
        print("ERROR: Bad account ID — check username/password", file=sys.stderr)
        sys.exit(1)

    print(f"Account ID: {account_id}")

    # Step 2: get session ID
    resp = requests.post(
        f"{BASE_URL}/General/LoginPublisherAccountById",
        json={
            "accountId":     account_id,
            "password":      password,
            "applicationId": APP_ID,
        },
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    session_id = resp.json()
    print(f"Session ID: {session_id}")
    return session_id


def get_readings(session_id, minutes=1440, max_count=288):
    """Fetch glucose readings — tries every known endpoint/method combo."""
    attempts = [
        # (method, endpoint, pass sessionId as)
        ("POST", "Publisher/ReadPublisherLatestGlucoseValues",  "params"),
        ("GET",  "Publisher/ReadPublisherLatestGlucoseValues",  "params"),
        ("POST", "Follower/ReadPublisherLatestGlucoseValues",   "params"),
        ("GET",  "Follower/ReadPublisherLatestGlucoseValues",   "params"),
        ("POST", "Follower/ReadPublisherLatestGlucoseValues",   "body"),
    ]

    for method, endpoint, sid_mode in attempts:
        url    = f"{BASE_URL}/{endpoint}"
        params = {"sessionId": session_id, "minutes": minutes, "maxCount": max_count}
        body   = {"sessionId": session_id, "minutes": minutes, "maxCount": max_count}

        print(f"Trying {method} {endpoint} (sessionId in {sid_mode})")
        try:
            if method == "GET":
                resp = requests.get(url, params=params, timeout=15)
            elif sid_mode == "params":
                resp = requests.post(url, params=params, timeout=15)
            else:
                resp = requests.post(url, json=body, timeout=15)

            print(f"  → HTTP {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"  → {len(data)} readings")
                if data:
                    return data
            else:
                # Print first 200 chars of response body to help diagnose
                print(f"  → {resp.text[:200]}")
        except Exception as e:
            print(f"  → Error: {e}")

    return []


def parse_dexcom_time(wt_str):
    """Convert Dexcom's /Date(ms)/ format to ISO 8601."""
    ms = int(wt_str.replace("/Date(", "").replace(")/", "").split("+")[0].split("-")[0])
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    username = os.environ.get("DEXCOM_USERNAME")
    password = os.environ.get("DEXCOM_PASSWORD")

    if not username or not password:
        print("ERROR: DEXCOM_USERNAME / DEXCOM_PASSWORD env vars not set", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting as {username}...")
    session_id = get_session_id(username, password)

    readings_raw = get_readings(session_id)

    if not readings_raw:
        print("No readings returned — Share may not be active or sensor needs time to sync")
        sys.exit(0)

    def serialize(r):
        trend    = r.get("Trend", 4)
        iso_time = parse_dexcom_time(r["WT"])
        return {
            "time":       iso_time,
            "value":      r["Value"],
            "trend":      TREND_DESCS.get(trend, "Steady"),
            "trendArrow": TREND_ARROWS.get(trend, "→"),
        }

    readings  = [serialize(r) for r in reversed(readings_raw)]  # oldest → newest
    latest_r  = readings_raw[0]
    trend     = latest_r.get("Trend", 4)

    payload = {
        "current": {
            "value":      latest_r["Value"],
            "trend":      TREND_DESCS.get(trend, "Steady"),
            "trendArrow": TREND_ARROWS.get(trend, "→"),
            "trendDesc":  TREND_DESCS.get(trend, "Steady"),
            "time":       parse_dexcom_time(latest_r["WT"]),
        },
        "readings":  readings,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    out_path = os.path.join(os.path.dirname(__file__), "glucose.json")
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"✓ Wrote {len(readings)} readings. Latest: {latest_r['Value']} mg/dL {TREND_ARROWS.get(trend, '→')}")


if __name__ == "__main__":
    main()
