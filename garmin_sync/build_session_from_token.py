"""Build a Garmin session from a token you manually copy from Chrome DevTools.

INSTRUCTIONS:
1. Open Chrome and log into https://connect.garmin.com (do MFA if needed)
2. Press F12 to open DevTools
3. Click the "Network" tab
4. In the filter box type: oauth2
5. Refresh the page (F5)
6. Look for a request to: connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0
7. Click it → click the "Response" tab
8. Copy the entire JSON response (it has access_token, refresh_token, etc.)
9. Paste it when this script asks for it

Run:
    .venv\\Scripts\\python.exe build_session_from_token.py
"""

import base64
import json
import sys
import time
from pathlib import Path

import requests
from nacl import encoding, public

SESSION_FILE = Path(__file__).parent / ".garmin_session"
TOKEN_FILE = Path(__file__).parent.parent / ".github_token"
REPO = "davelane26/weight-dashboard-v2"
PROXY = {"http": "http://sysproxy.wal-mart.com:8080", "https": "http://sysproxy.wal-mart.com:8080"}


def load_github_token() -> str:
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


def push_github_secret(name: str, value: str) -> bool:
    token = load_github_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "code-puppy",
    }
    base = f"https://api.github.com/repos/{REPO}"
    pk_r = requests.get(f"{base}/actions/secrets/public-key", headers=headers, proxies=PROXY, timeout=15)
    pk_r.raise_for_status()
    key_id = pk_r.json()["key_id"]
    pub_key_b64 = pk_r.json()["key"]
    encrypted = encrypt_secret(pub_key_b64, value)
    resp = requests.put(
        f"{base}/actions/secrets/{name}",
        headers=headers,
        json={"encrypted_value": encrypted, "key_id": key_id},
        proxies=PROXY,
        timeout=15,
    )
    return resp.status_code in (201, 204)


def build_garth_session(oauth2: dict) -> dict:
    """Build a minimal garth-compatible session dict from an OAuth2 token response."""
    now = time.time()
    expires_in = oauth2.get("expires_in", 3600)
    return {
        "oauth2_token": {
            "scope": oauth2.get("scope", ""),
            "jti": oauth2.get("jti", ""),
            "token_type": oauth2.get("token_type", "Bearer"),
            "access_token": oauth2["access_token"],
            "refresh_token": oauth2["refresh_token"],
            "expires_in": expires_in,
            "expires_at": now + expires_in,
            "refresh_token_expires_in": oauth2.get("refresh_token_expires_in", 7776000),
            "refresh_token_expires_at": now + oauth2.get("refresh_token_expires_in", 7776000),
        }
    }


def main() -> int:
    print("=" * 60)
    print("  Garmin Session Builder - Token from Chrome DevTools")
    print("=" * 60)
    print()
    print("OPTION A - Full JSON (best, lasts 90 days):")
    print("  1. Open Chrome -> https://connect.garmin.com")
    print("  2. F12 -> Network tab -> filter: oauth2")
    print("  3. Sign out, log back in")
    print("  4. Click the '2.0' request -> Response tab -> copy JSON")
    print()
    print("OPTION B - Bearer token (lasts ~1 hour, easier to find):")
    print("  1. Open Chrome -> https://connect.garmin.com (stay logged in)")
    print("  2. F12 -> Network tab -> filter: connectapi")
    print("  3. Click any request -> Headers -> Request Headers")
    print("  4. Copy everything after 'Authorization: Bearer '")
    print()
    print("Paste the token here and press Enter twice when done.")
    print("  Option A: Full JSON from Network Response tab")
    print("  Option B: Just the Bearer token from Request Headers")
    print("-" * 60)

    lines = []
    while True:
        line = input()
        if line == "" and lines and lines[-1] == "":
            break
        lines.append(line)

    raw = "\n".join(lines).strip()

    # Detect if it's just a raw Bearer token (no JSON braces)
    if not raw.startswith("{"):
        print("\nDetected raw Bearer token — building session with access_token only.")
        print("(Note: session expires in ~1 hour, re-run this script monthly)")
        oauth2 = {
            "access_token": raw.strip(),
            "refresh_token": "",
            "expires_in": 3600,
            "token_type": "Bearer",
        }
    else:
        try:
            oauth2 = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"\nERROR: Could not parse JSON: {e}")
            return 1

        if "access_token" not in oauth2:
            print("\nERROR: JSON is missing access_token.")
            return 1

    print("\nParsed successfully!")
    print(f"  access_token:  {oauth2['access_token'][:20]}...")
    print(f"  refresh_token: {oauth2['refresh_token'][:20]}...")

    session = build_garth_session(oauth2)
    session_json = json.dumps(session)
    SESSION_FILE.write_text(session_json)
    print(f"\nSession saved to {SESSION_FILE.name}")

    session_b64 = base64.b64encode(session_json.encode("utf-8")).decode("utf-8")

    print("Pushing GARMIN_SESSION to GitHub...")
    try:
        ok = push_github_secret("GARMIN_SESSION", session_b64)
        if ok:
            print("\nDone! GARMIN_SESSION is set on GitHub.")
            print("The sync will now work from GitHub Actions.")
        else:
            print("\nFailed to push to GitHub. Try again or set manually.")
    except Exception as e:
        print(f"\nCould not push to GitHub: {e}")
        print("Manually set GARMIN_SESSION in repo secrets to this value:")
        print(session_b64)

    return 0


if __name__ == "__main__":
    sys.exit(main())
