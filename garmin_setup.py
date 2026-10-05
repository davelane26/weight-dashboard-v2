"""garmin_setup.py — One-time setup script to authenticate with Garmin Connect.

Saves tokens to garmin_sync/.garmin_tokens/garmin_tokens.json and prints base64
for GitHub Actions secret GARMIN_TOKENS.

Usage:
    python garmin_setup.py
"""

import sys
from pathlib import Path

# Add garmin_sync to path
garmin_sync_dir = Path(__file__).parent / "garmin_sync"
if str(garmin_sync_dir) not in sys.path:
    sys.path.insert(0, str(garmin_sync_dir))

import setup_garmin

if __name__ == "__main__":
    sys.exit(setup_garmin.main())
