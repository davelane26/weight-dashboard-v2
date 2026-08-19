"""
glapp_login.py — one-time login helper for the Glapp scraper cron.

Opens a REAL Chrome (or Chromium) window, navigates to Glapp, and lets
you log in with your normal Google / email flow. When you're logged in
and you can see the "All logs" shot table, click OK in the terminal
and this script saves the browser storage state (cookies + localStorage)
to `glapp_state.json` in this folder.

`glapp_sync.py` then reuses that state to run fully headless on a
schedule — no password prompts, no manual clicks, no 2FA re-entry
(as long as the session cookie stays alive; Glapp appears to keep
sessions for weeks/months).

Install (one-time, in an isolated venv per repo convention):
    uv venv .glapp_venv
    .glapp_venv\\Scripts\\activate
    uv pip install --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple ^
                   --allow-insecure-host pypi.ci.artifacts.walmart.com ^
                   playwright
    playwright install chromium

Run (one-time, and again if the session ever expires):
    python glapp_login.py
"""
from __future__ import annotations

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

HERE           = pathlib.Path(__file__).resolve().parent
STATE_FILE     = HERE / "glapp_state.json"
CONFIG_FILE    = HERE / "glapp_config.json"

# Default Glapp URLs. Overridable via glapp_config.json (see README).
DEFAULT_LOGIN_URL = "https://glapp.io/"
DEFAULT_LOGS_URL  = "https://glapp.io/logs"  # adjust if All-logs lives elsewhere


def load_config() -> dict:
    """Read overrides for login/logs URLs if the user tweaked them."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"[warn] {CONFIG_FILE.name} is invalid JSON — ignoring: {e}")
    return {}


def main() -> int:
    cfg       = load_config()
    login_url = cfg.get("login_url", DEFAULT_LOGIN_URL)
    logs_url  = cfg.get("logs_url",  DEFAULT_LOGS_URL)

    print(f"Opening Chromium at {login_url} ...")
    print("Log in with your normal credentials. When you can see the")
    print("shot log table (Date / Medication / Dosage columns), come")
    print("back to this terminal and press Enter.\n")

    with sync_playwright() as p:
        # Prefer real Chrome (better fingerprint), fall back to bundled Chromium.
        try:
            browser = p.chromium.launch(channel="chrome", headless=False)
            print("Using real Chrome")
        except Exception:
            browser = p.chromium.launch(headless=False)
            print("Using bundled Chromium")

        ctx  = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto(login_url, timeout=60_000)

        input("\n>>> Log in in the browser, navigate to the logs page, then press Enter here: ")

        # Nudge to the logs page so we know the session survives a hard nav.
        try:
            page.goto(logs_url, timeout=30_000)
        except Exception as e:
            print(f"[warn] Could not reach {logs_url}: {e}")

        # Verify a shot table is on the page before saving state — no point
        # saving a login that lands somewhere the cron can't scrape.
        found = page.evaluate(
            """() => {
                const has = txt => Array.from(document.querySelectorAll('*'))
                    .some(el => el.children.length === 0 && el.textContent.trim() === txt);
                return has('Date') && has('Dosage');
            }"""
        )
        if not found:
            print("[warn] Could not find Date/Dosage headers on the logs page.")
            print("       If the sync fails later, edit glapp_config.json to")
            print("       point `logs_url` at the correct page URL.")

        ctx.storage_state(path=str(STATE_FILE))
        print(f"\n[ok] Saved session to {STATE_FILE.name}")
        print("     glapp_sync.py can now run headless on a schedule.")

        input("Press Enter to close the browser: ")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
