"""Samsung Health CSV → dashboard-compatible health.json.

Reads all Samsung Health `... Samsung Health.csv` exports from an input
directory, deduplicates (weekly and monthly files overlap), aggregates
into per-day summaries, and writes a JSON payload shaped for the
existing `activity.js` consumer in weight-dashboard-v2.

Stdlib only. Runs on djtwo alongside mqtt_bridge.py.

Filename conventions handled:
  Steps <WW>-<YYYY> Samsung Health.csv
  Steps <Month> <YYYY> Samsung Health.csv
  Heart rate <WW>-<YYYY> Samsung Health.csv
  Heart rate <Month> <YYYY> Samsung Health.csv
  Sleep <YYYY>.<MM>.<DD> <HH>_<MM>_<SS> Samsung Health.csv
  <TYPE> <YYYY>.<MM>.<DD> <HH.MM> Samsung Health.csv   (workouts)
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean

# ---- Constants ---------------------------------------------------------------

# Samsung Health uses "2026.08.18 05:07:00" everywhere in the Date column.
SH_DATETIME = "%Y.%m.%d %H:%M:%S"

SLEEP_STAGES = {"light", "deep", "rem", "awake"}

# Split a multi-night sleep CSV into individual sessions when consecutive
# rows are more than this many seconds apart. 2h is generous enough to
# absorb long "get up to pee" gaps but small enough to always split
# separate naps or nights.
SLEEP_SESSION_GAP_SECONDS = 2 * 60 * 60

# HR sanity guardrail — reject clearly-broken samples (loose watch,
# pulse-ox glitch). Real human range with safety margin.
HR_MIN_VALID = 25
HR_MAX_VALID = 240

# Samsung Health workout summary filename:
#   "<TYPE> <YYYY>.<MM>.<DD> <HH.MM> Samsung Health.csv"
WORKOUT_FILENAME_RE = re.compile(
    r"^(?P<type>[A-Z_]+)\s+\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}\s+Samsung Health\.csv$"
)


# ---- Datetime helpers --------------------------------------------------------


def parse_sh_datetime(s: str) -> datetime:
    """Parse Samsung Health's Date column. Raises ValueError on garbage."""
    return datetime.strptime(s.strip(), SH_DATETIME)


def iso_date(dt: datetime) -> str:
    return dt.date().isoformat()


# ---- Per-file parsers --------------------------------------------------------


def parse_steps_file(path: Path) -> dict[datetime, int]:
    """Return {timestamp: steps}. Timestamps double as the dedup key."""
    out: dict[datetime, int] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            try:
                ts = parse_sh_datetime(row["Date"])
                steps = int(row["Steps"])
            except (KeyError, ValueError):
                continue
            out[ts] = steps
    return out


def parse_hr_file(path: Path) -> dict[datetime, int]:
    """Return {timestamp: bpm}. One sample per minute typically."""
    out: dict[datetime, int] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            try:
                ts = parse_sh_datetime(row["Date"])
                bpm = int(row["Heart rate"])
            except (KeyError, ValueError):
                continue
            if HR_MIN_VALID <= bpm <= HR_MAX_VALID:
                out[ts] = bpm
    return out


def parse_sleep_file(path: Path) -> list[dict]:
    """Return summaries for every sleep session in the file.

    Samsung Health lumps multiple nights into a single CSV; the filename
    reflects the FIRST session start, but rows can span days. Split on
    inter-row gaps > SLEEP_SESSION_GAP_SECONDS.
    """
    rows: list[tuple[datetime, int, str]] = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            try:
                ts = parse_sh_datetime(row["Date"])
                dur = int(row["Duration in seconds"])
                stage = row["Sleep stage"].strip().lower()
            except (KeyError, ValueError):
                continue
            if stage in SLEEP_STAGES:
                rows.append((ts, dur, stage))

    if not rows:
        return []

    rows.sort(key=lambda r: r[0])
    sessions: list[list[tuple[datetime, int, str]]] = [[rows[0]]]
    for prev, current in zip(rows, rows[1:]):
        gap = (current[0] - prev[0]).total_seconds()
        if gap > SLEEP_SESSION_GAP_SECONDS:
            sessions.append([current])
        else:
            sessions[-1].append(current)

    return [_summarize_sleep_session(s) for s in sessions]


def _summarize_sleep_session(rows: list[tuple[datetime, int, str]]) -> dict:
    """Compute per-stage totals using interval-union (no double-counting).

    Samsung Health often writes two overlapping streams for the same night
    (Galaxy Watch coarse blocks + phone-side fine analysis). Naive summing
    inflates totals to ~2x. We resolve this by sorting rows by
    (start ASC, duration ASC) and giving each row only the time NOT
    already claimed by an earlier row.
    """
    rows.sort(key=lambda r: (r[0], r[1]))
    session_start = rows[0][0]
    cursor = session_start
    session_end = session_start
    totals: dict[str, int] = defaultdict(int)

    for ts, dur, stage in rows:
        end = ts + timedelta(seconds=dur)
        effective_start = max(ts, cursor)
        if end > effective_start:
            totals[stage] += int((end - effective_start).total_seconds())
            cursor = end
        if end > session_end:
            session_end = end

    return {
        "session_start": session_start,
        "session_end": session_end,
        "deep_s": totals["deep"],
        "rem_s": totals["rem"],
        "light_s": totals["light"],
        "awake_s": totals["awake"],
    }


def parse_workout_file(path: Path) -> dict | None:
    """Return a single workout summary dict, or None if invalid."""
    m = WORKOUT_FILENAME_RE.match(path.name)
    if not m:
        return None
    with path.open(newline="", encoding="utf-8-sig") as fh:
        row = next(csv.DictReader(fh), None)
    if not row:
        return None
    try:
        start = parse_sh_datetime(row["Date"])
    except (KeyError, ValueError):
        return None
    return {
        "type": m.group("type").lower(),
        "start": start,
        "elapsed_s": _to_int(row.get("Elapsed time")),
        "active_s": _to_int(row.get("Active time")),
        "distance_mi": _to_float(row.get("Distance (miles)")),
        "calories": _to_float(row.get("Calories (kcal)")),
        "steps": _to_int(row.get("Steps")),
        "avg_hr": _to_int(row.get("Average heart rate")),
        "max_hr": _to_int(row.get("Max heart rate")),
    }


def _to_float(s: str | None) -> float | None:
    if s is None or s == "" or s.lower() == "null":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _to_int(s: str | None) -> int | None:
    v = _to_float(s)
    return int(v) if v is not None else None


# ---- Aggregation → dashboard schema ------------------------------------------


def _round_hours(seconds: int) -> float:
    return round(seconds / 3600, 2)


def _sleep_to_dashboard(session: dict) -> dict:
    """Convert internal sleep summary into activity.js-friendly fields.

    Bucket to session END date (wake time) — matches how humans think
    about \"last night's sleep\": Aug 18 22:00 → Aug 19 06:00 is Aug 19's
    sleep, not Aug 18's.
    """
    total_sleep_s = session["deep_s"] + session["rem_s"] + session["light_s"]
    return {
        "wake_date": iso_date(session["session_end"]),
        "sleepHours": _round_hours(total_sleep_s),
        "sleepDeep": _round_hours(session["deep_s"]),
        "sleepRem": _round_hours(session["rem_s"]),
        "sleepLight": _round_hours(session["light_s"]),
        "sleepAwake": _round_hours(session["awake_s"]),
        "sleepStart": session["session_start"].isoformat(),
        "sleepEnd": session["session_end"].isoformat(),
    }


def _workout_to_dashboard(wk: dict) -> dict:
    """Convert internal workout dict into activity.js activity schema."""
    return {
        "type": wk["type"],
        "name": wk["type"].replace("_", " ").title(),
        "startTime": wk["start"].isoformat(),
        "duration": round((wk["elapsed_s"] or 0) / 60) if wk["elapsed_s"] else None,
        "distance": wk["distance_mi"],
        "calories": round(wk["calories"]) if wk["calories"] is not None else None,
        "steps": wk["steps"],
        "avgHR": wk["avg_hr"],
        "maxHR": wk["max_hr"],
    }


def _aggregate_hr_daily(all_hr: dict[datetime, int]) -> dict[str, dict]:
    """Reduce raw HR samples to per-day min/max/mean/resting."""
    by_day: dict[str, list[int]] = defaultdict(list)
    for ts, bpm in all_hr.items():
        by_day[iso_date(ts)].append(bpm)
    out: dict[str, dict] = {}
    for date, bpms in by_day.items():
        bpms_sorted = sorted(bpms)
        n = len(bpms_sorted)
        # Resting HR proxy = 5th percentile (robust against single-sample lows).
        # Fall back to true min for tiny sample counts.
        p5_idx = max(0, int(n * 0.05) - 1) if n >= 20 else 0
        out[date] = {
            "restingHR": bpms_sorted[p5_idx],
            "minHR": bpms_sorted[0],
            "maxHR": bpms_sorted[-1],
            "meanHR": round(mean(bpms), 1),
            "hrSamples": n,
        }
    return out


def build_health_json(input_dir: Path) -> dict:
    """Walk input_dir, parse every Samsung Health CSV, return dashboard payload."""
    all_steps: dict[datetime, int] = {}
    all_hr: dict[datetime, int] = {}
    sleep_sessions: list[dict] = []
    workouts: list[dict] = []

    for path in sorted(input_dir.glob("*.csv")):
        name = path.name
        if not name.endswith("Samsung Health.csv"):
            continue  # skip Health Connect files, junk, etc.

        if name.startswith("Steps "):
            all_steps.update(parse_steps_file(path))
        elif name.startswith("Heart rate "):
            all_hr.update(parse_hr_file(path))
        elif name.startswith("Sleep "):
            sleep_sessions.extend(parse_sleep_file(path))
        elif WORKOUT_FILENAME_RE.match(name):
            wk = parse_workout_file(path)
            if wk:
                workouts.append(wk)
        # else: unknown format, silently skip

    # ---- Roll up to per-day records ------------------------------------
    daily_steps: dict[str, int] = defaultdict(int)
    for ts, count in all_steps.items():
        daily_steps[iso_date(ts)] += count
    daily_hr = _aggregate_hr_daily(all_hr)

    days: dict[str, dict] = defaultdict(lambda: {"activities": []})
    for date, steps in daily_steps.items():
        days[date]["steps"] = steps
    for date, hr in daily_hr.items():
        days[date].update(hr)
    for session in sleep_sessions:
        ds = _sleep_to_dashboard(session)
        date = ds.pop("wake_date")
        # Prefer the longest sleep session if multiple map to the same wake_date
        # (e.g. an afternoon nap and a full night). Nightly sleep dominates.
        prev = days[date].get("sleepHours", 0)
        if ds["sleepHours"] >= prev:
            days[date].update(ds)
    for wk in workouts:
        date = iso_date(wk["start"])
        days[date]["activities"].append(_workout_to_dashboard(wk))

    # ---- Emit sorted array ---------------------------------------------
    day_records = []
    for date in sorted(days):
        record = {"date": date, **days[date]}
        # Roll activities up into the aggregate fields loadActivityCharts()
        # expects (workoutsMins, workoutsKm). Kept as a derived field so the
        # dashboard doesn't need to know which source produced the data.
        acts = record["activities"]
        if acts:
            mins = sum((a.get("duration") or 0) for a in acts)
            miles = sum((a.get("distance") or 0) for a in acts)
            record["workoutsMins"] = round(mins, 1)
            record["workoutsKm"] = round(miles * 1.609344, 2)
        day_records.append(record)

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "generated_at": generated_at,
        "lastUpdated": generated_at,
        "source": "samsung_health",
        "days": day_records,
    }


# ---- CLI --------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Dir with CSVs")
    parser.add_argument("--output", type=Path, required=True, help="health.json path")
    args = parser.parse_args()

    if not args.input.is_dir():
        print(f"[error] input dir not found: {args.input}", file=sys.stderr)
        return 2

    payload = build_health_json(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    days = payload["days"]
    workout_days = sum(1 for d in days if d["activities"])
    sleep_days = sum(1 for d in days if "sleepHours" in d)
    print(
        f"[ok] wrote {args.output} \u2014 {len(days)} days "
        f"({sleep_days} with sleep, {workout_days} with workouts)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
