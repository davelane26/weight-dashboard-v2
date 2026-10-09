"""One-time interactive setup for Garmin Connect synchronization.

Uses python-garminconnect (v0.3.x) with native curl_cffi TLS impersonation
to authenticate with Garmin Connect, complete MFA if required, and cache
reusable session tokens in .garmin_tokens/garmin_tokens.json.

Usage:
    python setup_garmin.py
"""

import base64
import getpass
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from datetime import date
from pathlib import Path

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
load_dotenv(_script_dir / ".env")

from garmin_client import get_client, fetch_daily_summary, TOKEN_FILE, TOKEN_DIR  # noqa: E402

# GitHub secrets helper (optional)
TOKEN_FILE_GITHUB = _script_dir.parent / ".github_token"
REPO = "davelane26/weight-dashboard-v2"


def prompt_mfa() -> str:
    print("\n" + "*" * 50)
    print("  Garmin requires Multi-Factor Authentication (2FA)!")
    print("  Check your SMS or email for the verification code.")
    print("*" * 50)
    return input("Enter Garmin MFA code: ").strip()


def main() -> int:
    print("=" * 60)
    print("  Garmin Connect — One-Time Authentication Setup")
    print("  (Powered by cyberjunky/python-garminconnect v0.3.x)")
    print("=" * 60)
    print("This script logs into Garmin Connect using native mobile SSO,")
    print("handles MFA, and saves a reusable session token to disk so future")
    print("syncs run automatically without asking for your password again.\n")

    default_email = os.getenv("GARMIN_EMAIL", "")
    email = input(f"Garmin Connect email [{default_email}]: ").strip() or default_email
    if not email:
        print("Error: Email cannot be empty.")
        return 1

    password = os.getenv("GARMIN_PASSWORD", "")
    if not password:
        password = getpass.getpass("Garmin Connect password: ").strip()
    else:
        print("Using GARMIN_PASSWORD from .env")

    if not password:
        print("Error: Password cannot be empty.")
        return 1

    print("\nConnecting to Garmin Connect via TLS mobile impersonation...")

    try:
        client = get_client(
            email=email,
            password=password,
            prompt_mfa=prompt_mfa,
            tokenstore_dir=TOKEN_DIR,
        )
    except Exception as e:
        print(f"\n[FAIL] Authentication error: {e}")
        print("Please check your email and password, or wait a few minutes if rate-limited.")
        return 1

    display_name = getattr(client, "display_name", email)
    print(f"\n[OK] Successfully logged in as: {display_name}!")
    print(f"[OK] Session token cached in: {TOKEN_FILE}")

    # Test fetching today's stats
    print("\nTesting data retrieval...")
    try:
        today = date.today()
        stats = fetch_daily_summary(client, today)
        steps = stats.get("steps", 0)
        print(f"[OK] Verified API access! Today's steps: {steps:,}")
    except Exception as e:
        print(f"[WARN] Test fetch warning: {e}")

    # Generate base64 token string for GitHub Actions
    token_json = ""
    if TOKEN_FILE.exists():
        token_json = TOKEN_FILE.read_text(encoding="utf-8").strip()
    elif hasattr(client.client, "dumps"):
        token_json = client.client.dumps()

    if token_json:
        token_b64 = base64.b64encode(token_json.encode("utf-8")).decode("utf-8")
        print("\n" + "=" * 60)
        print("  OPTIONAL: GitHub Actions Secret")
        print("=" * 60)
        print("If you want GitHub Actions to sync Garmin automatically, copy the")
        print("base64 string below and set it as secret 'GARMIN_TOKENS' in:")
        print(f"👉 https://github.com/{REPO}/settings/secrets/actions\n")
        print(token_b64)
        print("=" * 60)

        # Auto-push if .github_token exists
        if TOKEN_FILE_GITHUB.exists():
            _try_push_github_secret(token_b64)

    # Save configuration to .env if not already there
    env_file = _script_dir / ".env"
    if not env_file.exists():
        api_sec = os.getenv("API_SECRET") or os.getenv("API_SECRET_V2", "")
        if not api_sec:
            api_sec = input("Cloudflare Worker API_SECRET (press Enter to skip): ").strip()
        env_file.write_text(
            f"GARMIN_EMAIL={email}\n"
            f"WORKER_URL=https://glucose-relay.djtwo6.workers.dev\n"
            f"API_SECRET={api_sec}\n"
            f"FIREBASE_URL=https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com\n",
            encoding="utf-8",
        )
        print(f"\nCreated {env_file} with default configuration.")

    print("\nSetup complete! You can now run 'python sync_garmin.py --today' anytime.")
    return 0


def _try_push_github_secret(token_b64: str) -> None:
    """Optionally push the token directly to GitHub Actions secrets if .github_token exists."""
    try:
        from nacl import encoding, public
        import requests

        token = ""
        for line in TOKEN_FILE_GITHUB.read_text().splitlines():
            if line.startswith("GITHUB_TOKEN="):
                token = line.split("=", 1)[1].strip()

        if not token:
            return

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "weight-dashboard-garmin",
        }
        base = f"https://api.github.com/repos/{REPO}"
        pk_r = requests.get(f"{base}/actions/secrets/public-key", headers=headers, timeout=15)
        pk_r.raise_for_status()
        key_id = pk_r.json()["key_id"]
        pub_key_b64 = pk_r.json()["key"]

        key_bytes = base64.b64decode(pub_key_b64)
        pub_key = public.PublicKey(key_bytes, encoding.RawEncoder)
        box = public.SealedBox(pub_key)
        encrypted = base64.b64encode(box.encrypt(token_b64.encode("utf-8"))).decode("utf-8")

        for secret_name in ("GARMIN_TOKENS", "GARMIN_SESSION"):
            requests.put(
                f"{base}/actions/secrets/{secret_name}",
                headers=headers,
                json={"encrypted_value": encrypted, "key_id": key_id},
                timeout=15,
            )
        print("[OK] Automatically updated GARMIN_TOKENS secret in your GitHub repository!")
    except Exception as e:
        print(f"[NOTE] Automatic GitHub secret push skipped ({e}). You can set it manually if needed.")


if __name__ == "__main__":
    sys.exit(main())
