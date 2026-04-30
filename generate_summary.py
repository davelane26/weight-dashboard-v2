#!/usr/bin/env python3
"""
generate_summary.py — Weekly AI health summary via Anthropic Claude
Fetches recent weight + activity data, calls Claude, commits weekly-summary.json.
Runs via GitHub Actions every Sunday at 8 AM CT.
"""

import json
import os
import statistics
import sys
from datetime import datetime, timedelta, timezone

import anthropic
import requests

# ── Config ─────────────────────────────────────────────────────────────────────
WEIGHT_DATA_URL  = "https://davelane26.github.io/Weight-tracker/data.json"
FIREBASE_URL     = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
OUTPUT_FILE = "weekly-summary.json"
START_WEIGHT = 315.0


def fetch_json(url: str, timeout: int = 15) -> dict | list | None:
    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[warn] fetch failed {url}: {e}", file=sys.stderr)
        return None


def recent_weight_stats(readings: list, days: int = 14) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent = [
        r for r in readings
        if r.get("weight") and _parse_date(r.get("date", "")) >= cutoff
    ]
    if not recent:
        return {}
    weights = [r["weight"] for r in recent]
    first, last = weights[0], weights[-1]
    return {
        "days_with_readings": len(recent),
        "latest_weight": round(last, 1),
        "total_lost_from_start": round(START_WEIGHT - last, 1),
        "change_last_14d": round(last - first, 1),
        "rate_lbs_per_week": round((first - last) / 2, 2),
        "avg_weight": round(statistics.mean(weights), 1),
    }


def recent_activity_stats(firebase_url: str, days: int = 7) -> dict:
    data = fetch_json(firebase_url + "/garmin.json?shallow=true")
    if not data:
        return {}
    dates = sorted(
        [k for k in data.keys() if k != "latest"],
        reverse=True
    )[:days]

    step_list, sleep_list, stress_list, battery_list = [], [], [], []
    for date_key in dates:
        day = fetch_json(f"{firebase_url}/garmin/{date_key}.json")
        if not day:
            continue
        if day.get("steps"):        step_list.append(day["steps"])
        if day.get("sleepHours"):   sleep_list.append(day["sleepHours"])
        if day.get("stressLevel"):  stress_list.append(day["stressLevel"])
        if day.get("bodyBattery"):  battery_list.append(day["bodyBattery"])

    result = {}
    if step_list:    result["avg_steps_7d"]      = round(statistics.mean(step_list))
    if sleep_list:   result["avg_sleep_hrs_7d"]  = round(statistics.mean(sleep_list), 1)
    if stress_list:  result["avg_stress_7d"]     = round(statistics.mean(stress_list))
    if battery_list: result["avg_battery_7d"]    = round(statistics.mean(battery_list))
    return result


def _parse_date(s: str) -> datetime:
    for fmt in ("%Y-%m-%dT%H:%M%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s[:len(fmt) + 5], fmt)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d
        except ValueError:
            continue
    return datetime.min.replace(tzinfo=timezone.utc)


def build_prompt(wt: dict, act: dict) -> str:
    lines = [
        "You are a supportive personal health coach writing David's weekly summary.",
        "David is on a weight-loss journey using Mounjaro (tirzepatide), a Dexcom G7 CGM,",
        "and a Garmin watch. He started at 315 lbs and is aiming for healthy sustained loss.",
        "",
        "Here are his stats for the past 7–14 days:",
        f"- Latest weight: {wt.get('latest_weight', 'unknown')} lbs",
        f"- Total lost from start (315 lbs): {wt.get('total_lost_from_start', 'unknown')} lbs",
        f"- Change in last 14 days: {wt.get('change_last_14d', 'unknown')} lbs",
        f"- Rate of loss: {wt.get('rate_lbs_per_week', 'unknown')} lbs/week (positive = losing)",
        f"- Days logged this period: {wt.get('days_with_readings', 'unknown')}",
    ]
    if act:
        lines += [
            f"- Avg daily steps (7d): {act.get('avg_steps_7d', 'N/A')}",
            f"- Avg sleep (7d): {act.get('avg_sleep_hrs_7d', 'N/A')} hours",
            f"- Avg stress level (7d): {act.get('avg_stress_7d', 'N/A')} / 100",
            f"- Avg body battery (7d): {act.get('avg_battery_7d', 'N/A')} / 100",
        ]

    lines += [
        "",
        "Write a short, warm, specific weekly health summary (3–4 sentences max).",
        "Highlight what went well, one area to focus on next week, and an encouraging note.",
        "Be specific using the numbers above. Avoid generic platitudes.",
        "Do NOT use markdown, headers, or bullet points — plain conversational prose only.",
        "Keep it under 120 words.",
    ]
    return "\n".join(lines)


def call_claude(prompt: str, api_key: str) -> str:
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        temperature=0.75,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY secret not set", file=sys.stderr)
        sys.exit(1)

    print("Fetching weight data…")
    raw = fetch_json(WEIGHT_DATA_URL) or []
    wt  = recent_weight_stats(raw)
    print(f"Weight stats: {wt}")

    print("Fetching activity data…")
    act = recent_activity_stats(FIREBASE_URL)
    print(f"Activity stats: {act}")

    print("Calling Claude…")
    prompt  = build_prompt(wt, act)
    summary = call_claude(prompt, api_key)
    print(f"Summary:\n{summary}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week_ending":  datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "summary":      summary,
        "stats":        {**wt, **act},
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
