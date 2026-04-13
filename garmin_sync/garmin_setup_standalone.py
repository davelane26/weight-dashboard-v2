"""
Garmin login via web SSO form - avoids the rate-limited mobile API.
Run on home wifi (no corporate proxy).

    pip install garth pynacl requests
    python garmin_setup.py
"""
import base64, getpass, json, requests
from nacl import encoding, public

REPO = "davelane26/weight-dashboard-v2"


def encrypt_secret(pub_b64, value):
    key = public.PublicKey(base64.b64decode(pub_b64), encoding.RawEncoder)
    return base64.b64encode(public.SealedBox(key).encrypt(value.encode())).decode()


def push(token, session_b64):
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json", "User-Agent": "garmin-setup"}
    base = f"https://api.github.com/repos/{REPO}"
    pk = requests.get(f"{base}/actions/secrets/public-key", headers=h, timeout=15).json()
    r = requests.put(f"{base}/actions/secrets/GARMIN_SESSION", headers=h,
                     json={"encrypted_value": encrypt_secret(pk["key"], session_b64), "key_id": pk["key_id"]}, timeout=15)
    return r.status_code in (201, 204)


print("=" * 50)
print("  Garmin Session Setup (Web SSO Method)")
print("=" * 50)
print()

email    = input("Garmin email: ").strip()
password = getpass.getpass("Garmin password: ")
github_token = getpass.getpass("GitHub token: ")

print("\nLogging in via web SSO (bypasses rate limit)...")

import garth

def mfa():
    return input("MFA code from Garmin app: ").strip()

try:
    garth.login(email, password, prompt_mfa=mfa)
    print("[OK] Logged in!")
except Exception as e:
    print(f"[FAIL] {e}")
    exit(1)

session_json = json.dumps(garth.client.dumps())
session_b64  = base64.b64encode(session_json.encode()).decode()

print("Pushing session to GitHub...")
try:
    if push(github_token, session_b64):
        print("\n[OK] Done! Sync will start working within 15 minutes.")
    else:
        print("\n[FAIL] Could not push. Set GARMIN_SESSION manually.")
        print(f"\nValue:\n{session_b64}")
except Exception as e:
    print(f"[FAIL] Push error: {e}")
    print(f"\nSet GARMIN_SESSION manually:\n{session_b64}")
