"""
Standalone Garmin session generator.
Run this on ANY machine with home wifi (no corporate proxy).

Requirements:
    pip install garminconnect pynacl requests

Usage:
    python garmin_setup.py
"""
import base64
import getpass
import json
import sys

import requests
from nacl import encoding, public


REPO = "davelane26/weight-dashboard-v2"


def encrypt_secret(public_key_b64: str, value: str) -> str:
    key_bytes = base64.b64decode(public_key_b64)
    pub_key = public.PublicKey(key_bytes, encoding.RawEncoder)
    box = public.SealedBox(pub_key)
    return base64.b64encode(box.encrypt(value.encode())).decode()


def push_to_github(github_token: str, session_b64: str) -> bool:
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "garmin-setup",
    }
    base = f"https://api.github.com/repos/{REPO}"
    pk_r = requests.get(f"{base}/actions/secrets/public-key", headers=headers, timeout=15)
    pk_r.raise_for_status()
    key_id = pk_r.json()["key_id"]
    pub_key = pk_r.json()["key"]
    encrypted = encrypt_secret(pub_key, session_b64)
    resp = requests.put(
        f"{base}/actions/secrets/GARMIN_SESSION",
        headers=headers,
        json={"encrypted_value": encrypted, "key_id": key_id},
        timeout=15,
    )
    return resp.status_code in (201, 204)


def main() -> int:
    print("=" * 50)
    print("  Garmin Session Setup")
    print("=" * 50)
    print()

    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")
    github_token = getpass.getpass("GitHub token (from .github_token file): ")

    print("\nConnecting to Garmin... (enter MFA code if prompted)\n")

    from garminconnect import Garmin

    def prompt_mfa():
        return input("MFA code: ").strip()

    try:
        client = Garmin(email, password, prompt_mfa=prompt_mfa)
        client.login()
    except Exception as e:
        print(f"\nLogin failed: {e}")
        return 1

    print("\n[OK] Logged in!")

    session_json = json.dumps(client.garth.dumps())
    session_b64 = base64.b64encode(session_json.encode()).decode()

    print("Pushing GARMIN_SESSION to GitHub...")
    try:
        ok = push_to_github(github_token, session_b64)
        if ok:
            print("[OK] Done! GitHub Actions will now sync your Garmin data.")
        else:
            print("[FAIL] Could not push to GitHub.")
            print(f"\nManually set GARMIN_SESSION secret to:\n{session_b64}")
    except Exception as e:
        print(f"[WARN] Could not push: {e}")
        print(f"\nManually set GARMIN_SESSION secret to:\n{session_b64}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
