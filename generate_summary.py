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
WEIGHT_WORKER_URL = os.environ.get("WEIGHT_WORKER_URL", "https://glucose-relay.djtwo6.workers.dev/weight.json")
HEALTH_WORKER_URL = os.environ.get("HEALTH_WORKER_URL", "https://glucose-relay.djtwo6.workers.dev/health.json")
WEIGHT_DATA_URL   = os.environ.get("WEIGHT_DATA_URL", "https://davelane26.github.io/Weight-tracker/data.json")
OUTPUT_FILE       = "weekly-summary.json"
START_WEIGHT      = 315.0


def fetch_json(url: str, headers: dict = None, timeout: int = 15) -> dict | list | None:
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[warn] fetch failed {url}: {e}", file=sys.stderr)
        return None


def _parse_date(s: str) -> datetime:
    if not s:
        return datetime.min.replace(tzinfo=timezone.utc)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s[:len(fmt) + 5], fmt)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d
        except ValueError:
            continue
    return datetime.min.replace(tzinfo=timezone.utc)


def fetch_weight_data() -> list:
    """Fetch weight data with multi-source fallback: Worker -> GitHub private repo -> Local data.json."""
    # 1. Cloudflare Worker with API-SECRET
    api_secret = os.environ.get("API_SECRET") or os.environ.get("API_SECRET_V2")
    if api_secret:
        print("[info] Attempting to fetch weight data from Cloudflare Worker...")
        headers = {"API-SECRET": api_secret}
        data = fetch_json(WEIGHT_WORKER_URL, headers=headers)
        if data and isinstance(data, list) and len(data) > 0:
            print(f"[info] Retrieved {len(data)} weight records from Worker.")
            return data

    # 2. GitHub Raw / API token for private Weight-tracker repo
    gh_token = os.environ.get("WEIGHT_TRACKER_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if gh_token:
        print("[info] Attempting to fetch weight data from GitHub Weight-tracker repo...")
        gh_headers = {
            "Authorization": f"Bearer {gh_token}",
            "Accept": "application/vnd.github.raw+json",
            "User-Agent": "weight-summary-generator",
        }
        gh_url = "https://raw.githubusercontent.com/davelane26/Weight-tracker/main/data.json"
        data = fetch_json(gh_url, headers=gh_headers)
        if data and isinstance(data, list) and len(data) > 0:
            print(f"[info] Retrieved {len(data)} weight records from GitHub.")
            return data

    # 3. Public URL (fallback)
    print(f"[info] Attempting to fetch from public URL: {WEIGHT_DATA_URL}")
    data = fetch_json(WEIGHT_DATA_URL)
    if data and isinstance(data, list) and len(data) > 0:
        return data

    # 4. Local data.json (for local dev / offline)
    if os.path.exists("data.json"):
        try:
            with open("data.json", "r") as f:
                local_data = json.load(f)
                if isinstance(local_data, list) and len(local_data) > 0:
                    print(f"[info] Retrieved {len(local_data)} records from local data.json.")
                    return local_data
        except Exception as e:
            print(f"[warn] Failed to read local data.json: {e}", file=sys.stderr)

    print("[warn] No weight data could be fetched from any source.", file=sys.stderr)
    return []


def recent_weight_stats(readings: list, days: int = 14) -> dict:
    if not readings:
        return {}
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent = [
        r for r in readings
        if r.get("weight") and _parse_date(r.get("date", "")) >= cutoff
    ]
    if not recent:
        # If no readings within cutoff, take the latest reading as fallback
        valid = [r for r in readings if r.get("weight")]
        if not valid:
            return {}
        valid_sorted = sorted(valid, key=lambda r: _parse_date(r.get("date", "")))
        latest = valid_sorted[-1]
        return {
            "days_with_readings": 1,
            "latest_weight": round(float(latest["weight"]), 1),
            "total_lost_from_start": round(START_WEIGHT - float(latest["weight"]), 1),
            "change_last_14d": 0.0,
            "rate_lbs_per_week": 0.0,
            "avg_weight": round(float(latest["weight"]), 1),
        }

    # Ensure chronological sort
    sorted_recent = sorted(recent, key=lambda r: _parse_date(r.get("date", "")))
    weights = [float(r["weight"]) for r in sorted_recent]
    first, last = weights[0], weights[-1]
    return {
        "days_with_readings": len(sorted_recent),
        "latest_weight": round(last, 1),
        "total_lost_from_start": round(START_WEIGHT - last, 1),
        "change_last_14d": round(last - first, 1),
        "rate_lbs_per_week": round((first - last) / (days / 7.0), 2),
        "avg_weight": round(statistics.mean(weights), 1),
    }


def recent_activity_stats(days: int = 7) -> dict:
    """Fetch activity from Cloudflare Worker or local health.json."""
    data = fetch_json(HEALTH_WORKER_URL)
    if not data or not isinstance(data, dict) or "days" not in data:
        if os.path.exists("health.json"):
            try:
                with open("health.json", "r") as f:
                    data = json.load(f)
            except Exception:
                pass

    if not data or "days" not in data:
        return {}

    day_entries = data.get("days", [])
    if not day_entries:
        return {}

    # Sort descending by date
    sorted_days = sorted(
        [d for d in day_entries if d.get("date")],
        key=lambda x: str(x.get("date", "")),
        reverse=True
    )[:days]

    step_list = [d["steps"] for d in sorted_days if d.get("steps") and d["steps"] > 0]
    sleep_list = [d["sleepHours"] for d in sorted_days if d.get("sleepHours") and d["sleepHours"] > 0]
    hr_list = [
        d.get("restingHR") or d.get("meanHR")
        for d in sorted_days
        if (d.get("restingHR") or d.get("meanHR"))
    ]
    workout_mins = sum(
        d.get("workoutsMins") or d.get("duration") or 0
        for d in sorted_days
    )

    result = {}
    if step_list:    result["avg_steps_7d"]         = round(statistics.mean(step_list))
    if sleep_list:   result["avg_sleep_hrs_7d"]     = round(statistics.mean(sleep_list), 1)
    if hr_list:      result["avg_resting_hr_7d"]    = round(statistics.mean(hr_list))
    if workout_mins: result["total_workout_mins_7d"] = round(workout_mins)
    return result


def build_prompt(wt: dict, act: dict) -> str:
    lines = [
        "You are a supportive personal health coach writing David's weekly summary.",
        "David is on a weight-loss journey using Mounjaro (tirzepatide), an openScale smart scale,",
        "and a Galaxy Watch (Samsung Health). He started at 315 lbs on Jan 29, 2026 and is aiming",
        "for healthy sustained loss while preserving lean body mass.",
        "",
        "Here are his stats for the past 7–14 days:",
        f"- Latest weight: {wt.get('latest_weight', 'N/A')} lbs",
        f"- Total lost from start (315 lbs): {wt.get('total_lost_from_start', 'N/A')} lbs",
        f"- Change in last 14 days: {wt.get('change_last_14d', 'N/A')} lbs",
        f"- Rate of loss: {wt.get('rate_lbs_per_week', 'N/A')} lbs/week (positive = losing)",
        f"- Days logged this period: {wt.get('days_with_readings', 'N/A')}",
    ]
    if act:
        lines += [
            f"- Avg daily steps (7d): {act.get('avg_steps_7d', 'N/A')}",
            f"- Avg sleep (7d): {act.get('avg_sleep_hrs_7d', 'N/A')} hours",
            f"- Avg resting HR (7d): {act.get('avg_resting_hr_7d', 'N/A')} bpm",
            f"- Total workout minutes (7d): {act.get('total_workout_mins_7d', 'N/A')} mins",
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
    dry_run = "--dry-run" in sys.argv or "--mock" in sys.argv

    print("Fetching weight data…")
    raw = fetch_weight_data()
    wt  = recent_weight_stats(raw)
    print(f"Weight stats: {wt}")

    print("Fetching activity data…")
    act = recent_activity_stats(days=7)
    print(f"Activity stats: {act}")

    prompt = build_prompt(wt, act)
    print(f"Prompt prepared:\n{prompt}\n")

    if dry_run:
        print("[dry-run] Skipping Anthropic API call.")
        summary = "David is maintaining strong consistency on his journey, tracking key daily metrics and keeping healthy momentum toward his goals."
    else:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print("ERROR: ANTHROPIC_API_KEY secret not set", file=sys.stderr)
            sys.exit(1)
        print("Calling Claude…")
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
