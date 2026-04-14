"""
Connects via CDP to cdp-profile Chrome, disables service worker via JS,
reloads, and captures gc-api responses at the context level.
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

    lock = Path(PROFILE) / "SingletonLock"
    if lock.exists():
        lock.unlink(); print("Cleared lock")

    print("Launching Chrome...")
    proc = subprocess.Popen([
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-extensions",
        "about:blank"
    ])

    time.sleep(6)
    for i in range(20):
        try:
            socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1).close()
            print("[OK] Chrome ready"); break
        except (ConnectionRefusedError, OSError):
            print(f"  waiting {i+1}/20"); time.sleep(1)
    else:
        print("[FAIL] debug port never opened"); proc.terminate(); sys.exit(1)

    captured = {}

    def on_response(response):
        url = response.url
        if "gc-api" not in url:
            return
        print(f"  [gc-api] {response.status} {url[:90]}")
        if response.status != 200:
            return
        try:
            body = response.json()
            if not body:
                return
            if "usersummary/daily" in url and "calendarDate=" in url:
                d = url.split("calendarDate=")[-1].split("&")[0]
                captured.setdefault(d, {})["summary"] = body
                print(f"  [OK] summary for {d}")
            elif "sleep-service/sleep" in url and "date=" in url:
                d = url.split("date=")[-1].split("&")[0]
                captured.setdefault(d, {})["sleep"] = body
                print(f"  [OK] sleep for {d}")
            elif "activitylist-service" in url:
                d = date.today().isoformat()
                captured.setdefault(d, {})["activities"] = body if isinstance(body, list) else []
                print(f"  [OK] activities")
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # Listen at context level before ANY navigation
        ctx.on("response", on_response)

        print("Loading Garmin Connect...")
        page.goto("https://connect.garmin.com/modern", timeout=60000)

        for _ in range(120):
            if "connect.garmin.com" in page.url and "sso" not in page.url:
                break
            time.sleep(1)
        print(f"[OK] On: {page.url}")

        # Clear service worker via JS, then reload to force fresh network calls
        print("Clearing service worker and reloading...")
        page.evaluate("""async () => {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) { await r.unregister(); }
        }""")
        page.reload(timeout=60000)
        print(f"After reload: {page.url}")
        print("Waiting 25s for API calls...")
        time.sleep(25)

        print(f"\nCaptured keys: {list(captured.keys())}")

        if not captured:
            print("\nNo data captured. Fresh cookie dump for debugging:")
            cookies = {c["name"]: c["value"][:30] for c in ctx.cookies() if "garmin" in c.get("domain","").lower()}
            print(json.dumps(cookies, indent=2))
        else:
            synced = 0
            for day_str, raw in sorted(captured.items()):
                s = raw.get("summary", {})
                sl = (raw.get("sleep", {}).get("dailySleepDTO") or {})
                data = {
                    "date": day_str,
                    "steps": s.get("totalSteps", 0),
                    "distance": round((s.get("totalDistanceMeters") or 0) / 1609.34, 2),
                    "activeCalories": s.get("activeKilocalories", 0),
                    "totalCalories": s.get("totalKilocalories", 0),
                    "restingHR": s.get("restingHeartRate"),
                    "bodyBattery": s.get("bodyBatteryHighestValue"),
                    "stressLevel": s.get("averageStressLevel"),
                    "intensityMinutes": (s.get("moderateIntensityMinutes") or 0) + (s.get("vigorousIntensityMinutes") or 0),
                    "sleepHours": round((sl.get("sleepTimeSeconds") or 0) / 3600, 1),
                    "sleepScore": sl.get("sleepScores", {}).get("overall", {}).get("value"),
                    "activities": [],
                }
                print(f"{day_str}: steps={data['steps']} sleep={data['sleepHours']}h battery={data['bodyBattery']}")
                if push_day(FIREBASE_URL, day_str, data):
                    print(f"  [OK] Firebase"); synced += 1
            if synced:
                latest_key = max(captured.keys())
                push_latest(FIREBASE_URL, {"date": latest_key, **captured[latest_key].get("summary", {})})
            print(f"\nDone — synced {synced} days")

        browser.close()
    proc.terminate()


if __name__ == "__main__":
    main()
