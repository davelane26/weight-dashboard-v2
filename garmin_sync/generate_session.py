"""Generate a Garmin session token and push it to GitHub as a secret.

Run this ONCE from home (no corporate proxy) to create a session token.
The token is then pushed to GitHub so Actions can authenticate without
triggering Garmin's Cloudflare/IP-rate-limit protection.

Usage:
    python generate_session.py

You may be prompted for an MFA code if Garmin requires 2FA.
"""

import base64
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
import os
import requests
from nacl import encoding, public

load_dotenv(Path(__file__).parent / ".env")

SESSION_FILE = Path(__file__).parent / ".garmin_session"
TOKEN_FILE = Path(__file__).parent.parent / ".github_token"
REPO = "davelane26/weight-dashboard-v2"
PROXY = None  # No proxy — run this from home!


def load_token() -> str:
    for line in TOKEN_FILE.read_text().splitlines():
        if line.startswith("GITHUB_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise ValueError("GITHUB_TOKEN= not found in .github_token")


def encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    key_bytes = base64.b64decode(public_key_b64)
    pub_key = public.PublicKey(key_bytes, encoding.RawEncoder)
    box = public.SealedBox(pub_key)
    encrypted = box.encrypt(secret_value.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def push_secret(token: str, name: str, value: str) -> bool:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "code-puppy",
    }
    base = f"https://api.github.com/repos/{REPO}"

    # Get repo public key
    pk_r = requests.get(f"{base}/actions/secrets/public-key", headers=headers, timeout=15)
    pk_r.raise_for_status()
    key_id = pk_r.json()["key_id"]
    pub_key_b64 = pk_r.json()["key"]

    encrypted = encrypt_secret(pub_key_b64, value)
    resp = requests.put(
        f"{base}/actions/secrets/{name}",
        headers=headers,
        json={"encrypted_value": encrypted, "key_id": key_id},
        timeout=15,
    )
    return resp.status_code in (201, 204)


def main() -> int:
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        print("ERROR: GARMIN_EMAIL and GARMIN_PASSWORD must be in .env")
        return 1

    print(f"Connecting to Garmin Connect as {email}...")
    print("(You may be prompted for an MFA code)\n")

    from garminconnect import Garmin
    client = Garmin(email, password)

    # Handle MFA prompt interactively
    def prompt_mfa():
        return input("Enter Garmin MFA code: ").strip()

    client.prompt_mfa = prompt_mfa
    client.login()

    session_json = json.dumps(client.garth.dumps())
    SESSION_FILE.write_text(session_json)
    print(f"[OK] Session saved to {SESSION_FILE}")

    # Base64-encode for the GitHub secret
    session_b64 = base64.b64encode(session_json.encode("utf-8")).decode("utf-8")

    print("\nPushing GARMIN_SESSION to GitHub secrets...")
    try:
        token = load_token()
        ok = push_secret(token, "GARMIN_SESSION", session_b64)
        if ok:
            print("[OK] GARMIN_SESSION secret set on GitHub!")
            print("\nAll done! The GitHub Action will now use this session.")
            print("Session is valid for ~30 days. Re-run this script if sync starts failing.")
        else:
            print("[FAIL] Could not push secret to GitHub. Set GARMIN_SESSION manually.")
            print(f"\nYour session (base64): {session_b64[:60]}...")
    except Exception as e:
        print(f"[WARN] Could not push secret automatically: {e}")
        print(f"\nManually set GARMIN_SESSION in GitHub repo secrets to:")
        print(session_b64)

    return 0


if __name__ == "__main__":
    sys.exit(main())
