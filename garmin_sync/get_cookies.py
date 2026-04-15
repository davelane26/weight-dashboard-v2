"""Grab Garmin cookies from a cURL command — no Playwright needed.

INSTRUCTIONS:
  1. Open Chrome and go to https://connect.garmin.com (log in if needed)
  2. Press F12 → Network tab → type 'connectapi' in the filter box → press F5
  3. Right-click ANY request in the list → Copy → Copy as cURL (bash)
  4. Run this script and paste when prompted

That's it. Saves .garmin_cookies.json for the local sync to use.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).parent / ".garmin_cookies.json"


def parse_curl(raw: str) -> dict:
    cookies = {}
    # Match -H 'Cookie: ...' or --cookie '...'
    for pattern in [
        r"-H ['\"]Cookie:\s*([^'\"]+)['\"]",
        r"--cookie ['\"]([^'\"]+)['\"]",
        r"-b ['\"]([^'\"]+)['\"]",
    ]:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m:
            for pair in m.group(1).split(";"):
                pair = pair.strip()
                if "=" in pair:
                    k, _, v = pair.partition("=")
                    cookies[k.strip()] = v.strip()
            break
    return cookies


def main():
    print("=" * 55)
    print("  Garmin Cookie Extractor")
    print("=" * 55)
    print()
    print("Steps:")
    print("  1. Chrome → connect.garmin.com (logged in)")
    print("  2. F12 → Network tab → filter: connectapi → F5")
    print("  3. Right-click any request → Copy → Copy as cURL (bash)")
    print()
    print("Paste the cURL command below, then press Enter twice:")
    print("-" * 55)

    lines = []
    while True:
        line = input()
        if line == "" and lines and lines[-1] == "":
            break
        lines.append(line)

    raw = "\n".join(lines).strip()
    if not raw:
        print("Nothing pasted — exiting.")
        sys.exit(1)

    cookies = parse_curl(raw)
    if not cookies:
        print("ERROR: Could not find cookies in that cURL command.")
        print("Make sure you used 'Copy as cURL (bash)', not Windows format.")
        sys.exit(1)

    OUT.write_text(json.dumps(cookies, indent=2))
    print(f"\nSaved {len(cookies)} cookies → {OUT.name}")
    print("You can now run:  python garmin_local_sync.py")


if __name__ == "__main__":
    main()
