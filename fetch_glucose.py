"""
fetch_glucose.py — pulls Dexcom G7 readings via the Share API and writes glucose.json.
Runs every 5 minutes via GitHub Actions.
Requires env vars: DEXCOM_USERNAME, DEXCOM_PASSWORD
"""

import json
import os
import sys
from datetime import datetime, timezone

from pydexcom import Dexcom

# ── Trend arrow mapping ───────────────────────────────────────────────────
TREND_ARROWS = {
    "None":              "?",
    "DoubleUp":          "↑↑",
    "SingleUp":          "↑",
    "FortyFiveUp":       "↗",
    "Flat":              "→",
    "FortyFiveDown":     "↘",
    "SingleDown":        "↓",
    "DoubleDown":        "↓↓",
    "NotComputable":     "—",
    "RateOutOfRange":    "⚡",
}

TREND_DESCRIPTIONS = {
    "None":              "Not available",
    "DoubleUp":          "Rising fast",
    "SingleUp":          "Rising",
    "FortyFiveUp":       "Rising slowly",
    "Flat":              "Steady",
    "FortyFiveDown":     "Falling slowly",
    "SingleDown":        "Falling",
    "DoubleDown":        "Falling fast",
    "NotComputable":     "Not computable",
    "RateOutOfRange":    "Rate out of range",
}

def main():
    username = os.environ.get("DEXCOM_USERNAME")
    password = os.environ.get("DEXCOM_PASSWORD")

    if not username or not password:
        print("ERROR: DEXCOM_USERNAME / DEXCOM_PASSWORD env vars not set", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to Dexcom Share as {username}...")
    dex = Dexcom(username=username, password=password)  # ous=True if outside the US
    print("Auth succeeded!")

    # Last 24 hours — 288 readings at 5-min intervals
    print("Fetching readings...")
    readings = dex.get_glucose_readings(minutes=1440, max_count=288)
    print(f"Got {len(readings) if readings else 0} readings")

    if readings:
        print(f"Latest: {readings[0].value} mg/dL at {readings[0].datetime}")

    if not readings:
        print("No readings returned — is Share ON in your G7 app? Is the follower invite accepted?")
        sys.exit(0)

    def serialize(r):
        return {
            "time":        r.datetime.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "value":       r.value,
            "trend":       r.trend_description,
            "trendArrow":  TREND_ARROWS.get(r.trend_description, "—"),
        }

    latest = readings[0]  # pydexcom returns newest first
    payload = {
        "current": {
            "value":       latest.value,
            "trend":       latest.trend_description,
            "trendArrow":  TREND_ARROWS.get(latest.trend_description, "—"),
            "trendDesc":   TREND_DESCRIPTIONS.get(latest.trend_description, ""),
            "time":        latest.datetime.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        # Oldest → newest so the chart renders left-to-right
        "readings":  [serialize(r) for r in reversed(readings)],
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    out_path = os.path.join(os.path.dirname(__file__), "glucose.json")
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {len(readings)} readings. Latest: {latest.value} mg/dL {TREND_ARROWS.get(latest.trend_description, '—')}")

if __name__ == "__main__":
    main()
