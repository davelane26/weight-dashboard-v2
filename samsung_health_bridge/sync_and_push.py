"""Samsung Health sync-and-push orchestrator.

Runs on djtwo (or wherever), on a scheduled task. One pass does:

  1. rclone sync CSVs from Google Drive down to a local cache
  2. Parse them into a dashboard-shaped health.json
  3. Copy that JSON into the local weight-dashboard-v2 repo clone
  4. git add / commit / push if the content changed

Configuration lives in bridge_config.json next to this file. See
bridge_config.example.json for the template.

Requires: rclone on PATH, git on PATH, a rclone remote already configured
via `rclone config` (interactive, one-time), and a weight-dashboard-v2
repo clone with a working push credential (PAT baked into the remote URL
is the simplest option).
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from samsung_health_parser import build_health_json

HERE = Path(__file__).parent
CONFIG_PATH = HERE / "bridge_config.json"
LOG_PATH = HERE / "sync.log"


def log(msg: str) -> None:
    """Append a timestamped line to sync.log AND print to stdout."""
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit(
            f"[error] {CONFIG_PATH} missing. Copy bridge_config.example.json to "
            f"bridge_config.json and fill in the values."
        )
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run a subprocess, log stderr on failure, and re-raise."""
    log(f"$ {' '.join(cmd)}" + (f"  (cwd={cwd})" if cwd else ""))
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, check=False
    )
    if result.stdout.strip():
        log(result.stdout.strip())
    if result.returncode != 0:
        log(f"[error] exit {result.returncode}: {result.stderr.strip()}")
        raise subprocess.CalledProcessError(
            result.returncode, cmd, result.stdout, result.stderr
        )
    return result


def rclone_sync(cfg: dict, cache_dir: Path) -> None:
    """Pull all Samsung Health CSVs from Drive to the local cache."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    remote_path = f"{cfg['rclone_remote']}:{cfg['drive_folder']}"
    run([
        "rclone", "sync", remote_path, str(cache_dir),
        "--include", "* Samsung Health.csv",
        "--transfers", "8",
        "--checkers", "16",
    ])


def build_and_stage(cache_dir: Path, out_path: Path) -> bool:
    """Build health.json into out_path. Return True if the content changed."""
    payload = build_health_json(cache_dir)
    new_text = json.dumps(payload, indent=2)

    # Skip the git push if the meaningful content (everything except the
    # generated_at timestamp) is byte-identical to what's already there.
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
            for key in ("generated_at", "lastUpdated"):
                old.pop(key, None)
            candidate = json.loads(new_text)
            for key in ("generated_at", "lastUpdated"):
                candidate.pop(key, None)
            if old == candidate:
                log("[skip] health.json content unchanged, no push needed")
                return False
        except (json.JSONDecodeError, OSError):
            pass  # fall through and overwrite

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(new_text, encoding="utf-8")
    days = payload["days"]
    log(
        f"[ok] wrote {out_path.name}: {len(days)} days, "
        f"{sum(1 for d in days if 'sleepHours' in d)} with sleep, "
        f"{sum(1 for d in days if d['activities'])} with workouts"
    )
    return True


def git_push(repo_dir: Path, filename: str) -> None:
    """Stage, commit, and push the health.json update."""
    run(["git", "add", filename], cwd=repo_dir)
    # `git commit` exits nonzero if there's nothing to commit; guard that.
    status = subprocess.run(
        ["git", "status", "--porcelain", filename],
        cwd=repo_dir, capture_output=True, text=True, check=True,
    )
    if not status.stdout.strip():
        log("[skip] git status clean, nothing to commit")
        return
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    run(["git", "commit", "-m", f"health.json auto-update {ts}"], cwd=repo_dir)
    run(["git", "push"], cwd=repo_dir)


def main() -> int:
    cfg = load_config()
    cache_dir = Path(cfg["cache_dir"])
    repo_dir = Path(cfg["dashboard_repo"])
    out_path = repo_dir / cfg.get("health_json_filename", "health.json")

    if not repo_dir.is_dir():
        log(f"[error] dashboard_repo not found: {repo_dir}")
        return 2

    log("=" * 60)
    log("starting samsung_health sync run")

    try:
        rclone_sync(cfg, cache_dir)
        changed = build_and_stage(cache_dir, out_path)
        if changed:
            git_push(repo_dir, cfg.get("health_json_filename", "health.json"))
        log("done")
        return 0
    except subprocess.CalledProcessError as exc:
        log(f"[fatal] subprocess failed: {exc}")
        return 1
    except Exception as exc:  # broad on purpose — scheduled task shouldn't crash silently
        log(f"[fatal] {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
