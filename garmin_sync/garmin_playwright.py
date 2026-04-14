"""
Garmin session via Playwright - opens a REAL browser, you log in normally.
No rate limits because it's a real browser login.

Install:
    pip install playwright pynacl requests
    playwright install chromium

Run:
    python garmin_playwright.py
"""
import base64, json, requests, traceback
from nacl import encoding, public
from playwright.sync_api import sync_playwright

REPO = "davelane26/weight-dashboard-v2"
GARMIN_SSO = "https://sso.garmin.com/portal/sso/en-US/sign-in?clientId=GarminConnect&redirectAfterAccountLoginUrl=https://connect.garmin.com/modern/"


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


github_token = input("GitHub token: ").strip()
oauth_tokens = {}


def handle_response(response):
    if "oauth-service/oauth/exchange" in response.url or "oauth2/token" in response.url:
        try:
            data = response.json()
            oauth_tokens.update(data)
            print("[OK] Got OAuth tokens!")
        except Exception:
            pass


print("\nOpening browser — log in to Garmin normally, then wait...")

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on("response", handle_response)

        print("Navigating to Garmin login...")
        page.goto(GARMIN_SSO, timeout=30000)
        print("Log in to Garmin in the browser. Waiting up to 2 minutes...")

        try:
            page.wait_for_url("*connect.garmin.com/modern/**", timeout=120000)
            print("[OK] Login detected!")
        except Exception:
            print("[WARN] Timed out — grabbing whatever cookies exist...")

        cookies = ctx.cookies()
        garmin_cookies = {c["name"]: c["value"] for c in cookies if "garmin" in c["domain"].lower()}
        jwt = garmin_cookies.get("JWT_WEB", "")
        browser.close()

except Exception as e:
    print(f"\n[FAIL] Error: {e}")
    traceback.print_exc()
    exit(1)

if not oauth_tokens and not jwt:
    print("[FAIL] No tokens found. Try again.")
    exit(1)

session = {
    "oauth2_token": oauth_tokens if oauth_tokens else {"access_token": jwt, "token_type": "Bearer"},
    "domain": "garmin.com"
}

session_b64 = base64.b64encode(json.dumps(session).encode()).decode()
print("Pushing to GitHub...")
if push(github_token, session_b64):
    print("[OK] Done! Sync will start working within 15 minutes.")
else:
    print("[FAIL] Could not push. Set GARMIN_SESSION manually in GitHub secrets.")
    print(f"\nValue:\n{session_b64}")
