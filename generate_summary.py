#!/usr/bin/env python3
"""
generate_summary.py — Weekly AI health summary via Anthropic Claude
Fetches recent weight + activity data, calls Claude, commits weekly-summary.json.
Runs via GitHub Actions every Sunday at 8 AM CT.
"""

import json
import os
import re
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

# Supported Anthropic Claude models in priority order
CLAUDE_MODELS = [
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
    "claude-3-5-sonnet-20241022",
]


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


def extract_fallback_weights_from_medication() -> list:
    """Extract known weights from medication.js seed data if remote weight endpoints are unavailable."""
    weights = []
    if os.path.exists("medication.js"):
        try:
            with open("medication.js", "r", encoding="utf-8") as f:
                content = f.read()
            # Find date and weight in SHOT_SEED
            matches = re.findall(r"date:\s*['\"]([^'\"]+)['\"].*?weight:\s*([0-9.]+)", content)
            for d_str, w_str in matches:
                try:
                    w = float(w_str)
                    if w > 100:
                        weights.append({"date": d_str, "weight": w})
                except ValueError:
                    pass
        except Exception as e:
            print(f"[warn] Could not extract weights from medication.js: {e}", file=sys.stderr)
    return weights


def fetch_weight_data() -> list:
    """Fetch weight data with multi-source fallback: Worker -> GitHub private repo -> Local data.json -> Seed data."""
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
            with open("data.json", "r", encoding="utf-8") as f:
                local_data = json.load(f)
                if isinstance(local_data, list) and len(local_data) > 0:
                    print(f"[info] Retrieved {len(local_data)} records from local data.json.")
                    return local_data
        except Exception as e:
            print(f"[warn] Failed to read local data.json: {e}", file=sys.stderr)

    # 5. Extract from medication.js seed as safe baseline
    seed_weights = extract_fallback_weights_from_medication()
    if seed_weights:
        print(f"[info] Using {len(seed_weights)} baseline readings extracted from medication history.")
        return seed_weights

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
        # Fall back to latest known reading
        valid = [r for r in readings if r.get("weight")]
        if not valid:
            return {}
        valid_sorted = sorted(valid, key=lambda r: _parse_date(r.get("date", "")))
        latest = valid_sorted[-1]
        last_wt = float(latest["weight"])
        first_wt = float(valid_sorted[-2]["weight"]) if len(valid_sorted) > 1 else last_wt
        return {
            "days_with_readings": len(valid_sorted),
            "latest_weight": round(last_wt, 1),
            "total_lost_from_start": round(START_WEIGHT - last_wt, 1),
            "change_last_14d": round(last_wt - first_wt, 1),
            "rate_lbs_per_week": round((first_wt - last_wt) / 2.0, 2) if first_wt > last_wt else 0.0,
            "avg_weight": round(last_wt, 1),
        }

    # Chronological sort
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
                with open("health.json", "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                pass

    if not data or "days" not in data:
        return {}

    day_entries = data.get("days", [])
    if not day_entries:
        return {}

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
    if step_list:    result["avg_steps_7d"]          = round(statistics.mean(step_list))
    if sleep_list:   result["avg_sleep_hrs_7d"]      = round(statistics.mean(sleep_list), 1)
    if hr_list:      result["avg_resting_hr_7d"]     = round(statistics.mean(hr_list))
    if workout_mins: result["total_workout_mins_7d"]  = round(workout_mins)
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


def generate_fallback_summary(wt: dict, act: dict) -> str:
    """Generate a warm, accurate summary directly from metrics if Anthropic API is unavailable."""
    latest_wt = wt.get("latest_weight")
    total_lost = wt.get("total_lost_from_start")
    rate = wt.get("rate_lbs_per_week")
    steps = act.get("avg_steps_7d")
    sleep = act.get("avg_sleep_hrs_7d")

    parts = []
    if latest_wt and total_lost:
        parts.append(f"David is currently at {latest_wt} lbs, bringing his total progress to {total_lost} lbs down from his starting weight.")
    elif total_lost:
        parts.append(f"David continues to make steady progress with an overall total loss of {total_lost} lbs.")
    else:
        parts.append("David maintained steady dedication to his wellness goals this week.")

    if steps and sleep:
        parts.append(f"Activity remained strong with an average of {steps:,} daily steps and {sleep} hours of nightly sleep supporting healthy recovery.")
    elif steps:
        parts.append(f"Activity stayed solid with an average of {steps:,} daily steps.")
    elif sleep:
        parts.append(f"Sleep averaged {sleep} hours per night, keeping rest on track.")

    if rate and rate > 0:
        parts.append(f"Pacing is on track at {rate} lbs/week—continue prioritizing protein intake and hydration to protect lean muscle into the upcoming week.")
    else:
        parts.append("Continue prioritizing consistent hydration, protein targets, and regular movement as the journey continues.")

    return " ".join(parts)


def call_claude(prompt: str, api_key: str, wt: dict, act: dict) -> str:
    """Call Claude with automatic model fallback, returning a data-driven summary on error."""
    client = anthropic.Anthropic(api_key=api_key)

    for model_name in CLAUDE_MODELS:
        try:
            print(f"[info] Trying Claude model: {model_name}...")
            message = client.messages.create(
                model=model_name,
                max_tokens=256,
                temperature=0.75,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text.strip()
            if text:
                print(f"[info] Successfully generated summary using {model_name}.")
                return text
        except Exception as e:
            print(f"[warn] Model {model_name} failed: {e}", file=sys.stderr)

    print("[warn] All Anthropic models failed or API key was rejected. Generating local fallback summary.", file=sys.stderr)
    return generate_fallback_summary(wt, act)


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

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if dry_run:
        print("[dry-run] Generating mock summary.")
        summary = generate_fallback_summary(wt, act)
    elif api_key:
        print("Calling Claude…")
        summary = call_claude(prompt, api_key, wt, act)
    else:
        print("[warn] ANTHROPIC_API_KEY not set in environment. Generating fallback summary from metrics.")
        summary = generate_fallback_summary(wt, act)

    print(f"Summary:\n{summary}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week_ending":  datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "summary":      summary,
        "stats":        {**wt, **act},
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"Written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
