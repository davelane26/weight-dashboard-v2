"""
Garmin session via Chrome Remote Debugging.
Connects to YOUR actual Chrome browser — Garmin cannot detect this as automation.

Install:
    pip install playwright pynacl requests

Run:
    python garmin_chrome_cdp.py
"""
import base64, json, requests, subprocess, sys, time, traceback
from pathlib import Path
from nacl import encoding, public
from playwright.sync_api import sync_playwright

REPO = "davelane26/weight-dashboard-v2"
CDP_PORT = 9222

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    Path.home() / "AppData/Local/Google/Chrome/Application/chrome.exe",
]


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


def find_chrome():
    for p in CHROME_PATHS:
        if Path(p).exists():
            return str(p)
    return None


github_token = input("GitHub token: ").strip()
oauth_tokens = {}


def handle_response(response):
    url = response.url
    if any(x in url for x in ["oauth", "token", "auth", "sso", "exchange", "jwt"]):
        print(f"[NET] {response.status} {url[:120]}")
    if "oauth-service/oauth/exchange" in url or "oauth2/token" in url or "exchange/user" in url:
        try:
            data = response.json()
            if "access_token" in str(data) or "oauth_token" in str(data):
                oauth_tokens.update(data)
                print(f"\n[OK] Got OAuth tokens from Garmin!")
        except Exception:
            pass


chrome = find_chrome()
if not chrome:
    print("[FAIL] Chrome not found. Please install Chrome.")
    sys.exit(1)

print(f"\nFound Chrome: {chrome}")
print("Closing any existing Chrome instances...")
subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
time.sleep(2)
print("Launching Chrome with remote debugging...")

proc = subprocess.Popen([
    chrome,
    f"--remote-debugging-port={CDP_PORT}",
    f"--user-data-dir={Path.home() / 'AppData/Local/Temp/cdp-profile'}",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank"  # start blank so we navigate AFTER monitoring is active
])

print("Waiting for Chrome to start...")
time.sleep(5)

# Verify Chrome debug port is actually ready
import socket
for attempt in range(15):
    try:
        s = socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1)
        s.close()
        print(f"[OK] Chrome debug port ready (attempt {attempt+1})")
        break
    except (ConnectionRefusedError, OSError):
        print(f"Waiting for debug port... ({attempt+1}/15)")
        time.sleep(1)
else:
    print("[FAIL] Chrome debug port never opened. Is Chrome blocked by antivirus?")
    proc.terminate()
    sys.exit(1)

try:
    with sync_playwright() as p:
        print(f"Connecting to Chrome on port {CDP_PORT}...")
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        pages = ctx.pages
        page = pages[0] if pages else ctx.new_page()

        page.on("response", handle_response)

        print("\nMonitoring active — navigating to Garmin login...")
        page.goto(GARMIN_SSO, timeout=30000)

        print("\n" + "="*50)
        print("Log in to Garmin in the browser window.")
        print("The script will grab your tokens automatically.")
        print("Waiting up to 3 minutes...")
        print("="*50 + "\n")

        # Wait for OAuth exchange to happen
        deadline = time.time() + 180
        while not oauth_tokens and time.time() < deadline:
            time.sleep(1)

        if not oauth_tokens:
            print("[WARN] No OAuth tokens intercepted — grabbing cookies as fallback...")
            cookies = ctx.cookies()
            garmin_cookies = {c["name"]: c["value"] for c in cookies if "garmin" in c["domain"].lower()}
            print(f"Cookies found: {list(garmin_cookies.keys())}")
            jwt = garmin_cookies.get("JWT_WEB", "")
            if not jwt:
                print("[FAIL] No tokens or cookies found. Try logging out and back in.")
                proc.terminate()
                sys.exit(1)
            oauth_tokens["access_token"] = jwt
            oauth_tokens["token_type"] = "Bearer"

        browser.close()

except Exception as e:
    print(f"\n[FAIL] Error: {e}")
    traceback.print_exc()
    proc.terminate()
    sys.exit(1)

proc.terminate()

session = {"oauth2_token": oauth_tokens, "domain": "garmin.com"}
session_b64 = base64.b64encode(json.dumps(session).encode()).decode()

print("\nPushing session to GitHub...")
if push(github_token, session_b64):
    print("[OK] Done! Sync will start working within 15 minutes.")
else:
    print("[FAIL] Could not push. Set GARMIN_SESSION manually.")
    print(f"\nValue:\n{session_b64}")
