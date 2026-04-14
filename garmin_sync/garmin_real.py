"""
Disables service worker, loads Garmin app, grabs fresh cookies + auth token,
then makes API calls with those fresh credentials.
"""
import subprocess, sys, time, socket, json
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

CDP_PORT = 9222
DAYS_BACK = 2
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = str(Path.home() / "AppData/Local/Temp/cdp-profile")

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest


def main():
    print("Killing Chrome...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    time.sleep(3)

    # Delete profile lock so Chrome can reopen cleanly
    lock = Path(PROFILE) / "SingletonLock"
    if lock.exists():
        lock.unlink()
        print("Cleared profile lock")

    print("Launching Chrome (service worker disabled)...")
    proc = subprocess.Popen([
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-features=ServiceWorker",   # force real network requests
        "about:blank"
    ])

    time.sleep(6)
    for i in range(20):
        try:
            s = socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1)
            s.close(); print("[OK] Chrome ready"); break
        except (ConnectionRefusedError, OSError):
            print(f"  waiting... {i+1}/20"); time.sleep(1)
    else:
        print("[FAIL] Chrome debug port never opened"); proc.terminate(); sys.exit(1)

    captured = {}

    def on_response(response):
        url = response.url
        if "gc-api" not in url:
            return
        try:
            body = response.json()
            if not body:
                return
            print(f"  [CAPTURE] {url[:90]}")
            if "usersummary/daily" in url and "calendarDate=" in url:
                d = url.split("calendarDate=")[-1].split("&")[0]
                captured.setdefault(d, {})["summary"] = body
            elif "sleep-service/sleep" in url and "date=" in url:
                d = url.split("date=")[-1].split("&")[0]
                captured.setdefault(d, {})["sleep"] = body
            elif "activitylist-service" in url:
                d = date.today().isoformat()
                captured.setdefault(d, {})["activities"] = body if isinstance(body, list) else []
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # Listen at CONTEXT level — catches more than page-level
        ctx.on("response", on_response)

        print("Loading Garmin Connect...")
        page.goto("https://connect.garmin.com/modern", timeout=60000)

        # Wait for login if needed (up to 2 mins)
        for _ in range(120):
            if "connect.garmin.com" in page.url and "sso" not in page.url:
                break
            time.sleep(1)
        else:
            print("[WARN] Might need login — waiting 60s more...")
            time.sleep(60)

        print(f"[OK] On: {page.url}")
        print("Waiting 20s for API calls to fire...")
        time.sleep(20)

        # Grab fresh cookies right now and try manual API call
        cookies = {c["name"]: c["value"] for c in ctx.cookies() if "garmin" in c.get("domain", "").lower()}
        print(f"Fresh cookies: {list(cookies.keys())}")

        if not captured:
            print("\nNo gc-api responses captured — trying manual fetch with fresh cookies...")
            import requests as req
            today = date.today().isoformat()
            base = "https://connect.garmin.com/gc-api"
            h = {"NK": "NT", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json",
                 "User-Agent": "Mozilla/5.0", "Origin": "https://connect.garmin.com",
                 "Referer": "https://connect.garmin.com/"}

            # Try with JWT as bearer token
            if "JWT_WEB" in cookies:
                h["Authorization"] = f"Bearer {cookies['JWT_WEB']}"

            r = req.get(f"{base}/usersummary-service/usersummary/daily/{UUID}",
                        params={"calendarDate": today}, cookies=cookies, headers=h, timeout=15)
            print(f"Manual fetch: {r.status_code} — {r.text[:300]}")
        else:
            print(f"\nCaptured: {list(captured.keys())}")
            synced = 0
            for day_str, raw in captured.items():
                s = raw.get("summary", {})
                sl = (raw.get("sleep", {}).get("dailySleepDTO") or {})
                data = {
                    "date": day_str,
                    "steps": s.get("totalSteps", 0),
                    "activeCalories": s.get("activeKilocalories", 0),
                    "restingHR": s.get("restingHeartRate"),
                    "bodyBattery": s.get("bodyBatteryHighestValue"),
                    "sleepHours": round((sl.get("sleepTimeSeconds") or 0) / 3600, 1),
                }
                print(f"{day_str}: steps={data['steps']} sleep={data['sleepHours']}h battery={data['bodyBattery']}")
                if push_day(FIREBASE_URL, day_str, data):
                    print(f"  [OK] Firebase")
                    synced += 1
            print(f"Synced {synced} days")

        browser.close()
    proc.terminate()


if __name__ == "__main__":
    main()
