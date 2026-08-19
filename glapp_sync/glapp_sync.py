"""
glapp_sync.py — headless Playwright cron that scrapes Glapp and pushes
the shot log to Firebase /glapp_inbox/shots.json.

Loads the browser storage state produced by glapp_login.py so no
credentials or 2FA prompts happen. Injects `bookmarklets/glapp-sync.js`
into the page so scraping logic lives in exactly ONE place (DRY with
the human-click bookmarklet).

Wired to Windows Task Scheduler by SETUP_SCHEDULER.bat -> RUN_SYNC.bat.

Exit codes:
    0  success
    1  no saved state (run glapp_login.py first)
    2  Playwright / navigation failure
    3  scraper returned an error
"""
from __future__ import annotations

import json
import pathlib
import sys
import time
from datetime import datetime

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE          = pathlib.Path(__file__).resolve().parent
STATE_FILE    = HERE / "glapp_state.json"
CONFIG_FILE   = HERE / "glapp_config.json"
SCRAPER_JS    = HERE.parent / "bookmarklets" / "glapp-sync.js"

DEFAULT_LOGS_URL = "https://glapp.io/logs"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log(f"[warn] {CONFIG_FILE.name} invalid JSON: {e}")
    return {}


def log(msg: str) -> None:
    """Timestamped print so the .log file is greppable."""
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def main() -> int:
    if not STATE_FILE.exists():
        log(f"ERROR: no saved session at {STATE_FILE.name}. Run glapp_login.py first.")
        return 1
    if not SCRAPER_JS.exists():
        log(f"ERROR: cannot find scraper at {SCRAPER_JS}. Repo layout changed?")
        return 2

    cfg      = load_config()
    logs_url = cfg.get("logs_url", DEFAULT_LOGS_URL)
    scraper  = SCRAPER_JS.read_text(encoding="utf-8")

    log(f"Starting headless sync -> {logs_url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx     = browser.new_context(
            storage_state=str(STATE_FILE),
            viewport={"width": 1280, "height": 900},
        )
        page    = ctx.new_page()

        try:
            page.goto(logs_url, wait_until="networkidle", timeout=45_000)
        except PWTimeout:
            # networkidle can hang on SPA pollers; DOMContentLoaded is enough
            # for the shot table since it's server-rendered / hydrated fast.
            log("[warn] networkidle timeout, falling back to DOMContentLoaded")
            page.goto(logs_url, wait_until="domcontentloaded", timeout=45_000)
        except Exception as e:
            log(f"ERROR: navigation failed: {e}")
            browser.close()
            return 2

        # Wait a beat for hydration. Cheap and boring beats a fragile
        # wait_for_selector that has to guess the framework's classes.
        page.wait_for_timeout(2500)

        # Flag headless BEFORE injecting so the scraper skips its alert()
        # branch and just returns via window.__glappSync().
        page.evaluate("window.__glappHeadless = true;")
        page.evaluate(scraper)

        try:
            result = page.evaluate(
                "async () => { return await window.__glappSync(); }",
                # 30s should be plenty; Firebase PUT is milliseconds normally
            )
        except Exception as e:
            log(f"ERROR: __glappSync eval failed: {e}")
            browser.close()
            return 3

        browser.close()

    if not result or not result.get("ok"):
        log(f"ERROR: scraper reported failure: {result}")
        return 3

    first = result.get("first", {}) or {}
    last  = result.get("last",  {}) or {}
    log(
        f"OK: pushed {result['count']} shots. "
        f"First={first.get('date')} {first.get('med')}, "
        f"Last={last.get('date')} {last.get('med')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
