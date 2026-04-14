"""
Launches Chrome with YOUR real profile (proper lock cleanup + timing).
Reads data from IndexedDB + network interception.
"""
import subprocess, sys, time, socket, json
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

CDP_PORT = 9224   # fresh port
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
DAYS_BACK = 2

# Real Chrome profile path
PROFILE = Path(r"C:\Users\djtwo\AppData\Local\Google\Chrome\User Data")

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest


def kill_chrome():
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/FI", "IMAGENAME eq chrome.exe"], capture_output=True)
    time.sleep(8)  # wait for ALL chrome sub-processes to die

    # Delete every lock file Chrome might leave behind
    for lock in ["SingletonLock", "SingletonSocket", "SingletonCookie",
                 "Default/LOCK", "Default/lock"]:
        p = PROFILE / lock
        if p.exists():
            try: p.unlink(); print(f"  deleted {lock}")
            except Exception as e: print(f"  could not delete {lock}: {e}")


def main():
    print("Killing all Chrome processes...")
    kill_chrome()

    print(f"Launching with real profile...")
    proc = subprocess.Popen([
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE}",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank"
    ])

    print("Waiting for debug port (30s max)...")
    for i in range(30):
        time.sleep(1)
        try:
            socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1).close()
            print(f"[OK] Chrome ready after {i+1}s")
            break
        except (ConnectionRefusedError, OSError):
            if i % 5 == 4:
                print(f"  still waiting... {i+1}s")
    else:
        print("[FAIL] Chrome never opened debug port")
        proc.terminate(); sys.exit(1)

    captured = {}

    def on_response(response):
        url = response.url
        if "gc-api" not in url:
            return
        print(f"  [gc-api] {response.status} {url[:80]}")
        if response.status != 200:
            return
        try:
            body = response.json()
            if not body:
                return
            if "usersummary/daily" in url and "calendarDate=" in url:
                d = url.split("calendarDate=")[-1].split("&")[0]
                captured.setdefault(d, {})["summary"] = body
                print(f"  [OK] summary {d}")
            elif "sleep-service/sleep" in url and "date=" in url:
                d = url.split("date=")[-1].split("&")[0]
                captured.setdefault(d, {})["sleep"] = body
                print(f"  [OK] sleep {d}")
            elif "activitylist-service" in url:
                captured.setdefault(date.today().isoformat(), {})["activities"] = (
                    body if isinstance(body, list) else [])
                print(f"  [OK] activities")
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # Intercept at context level
        ctx.on("response", on_response)

        print("Loading Garmin Connect...")
        page.goto("https://connect.garmin.com/modern", timeout=60000)
        for _ in range(120):
            if "connect.garmin.com" in page.url and "sso" not in page.url:
                break
            time.sleep(1)
        print(f"[OK] On: {page.url}")
        print("Waiting 20s for gc-api calls...")
        time.sleep(20)

        if not captured:
            # Try also reading from IndexedDB
            print("\nNo network responses captured. Checking IndexedDB...")
            idb = page.evaluate("""
            async () => {
                const dbs = await indexedDB.databases ? indexedDB.databases() : [];
                return dbs.map(d => d.name);
            }
            """)
            print(f"IndexedDB databases: {idb}")

            # Also dump request headers for a gc-api call to find auth token
            print("\nTrying to extract auth token from app state...")
            token_info = page.evaluate(f"""
            async () => {{
                const resp = await fetch('https://connect.garmin.com/gc-api/usersummary-service/usersummary/daily/{UUID}?calendarDate={date.today().isoformat()}', {{
                    headers: {{'NK':'NT','X-Requested-With':'XMLHttpRequest','Accept':'application/json'}}
                }});
                // Intercept via XHR to get actual headers sent
                return {{ status: resp.status, url: resp.url }};
            }}
            """)
            print(f"Direct fetch result: {token_info}")
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
                    print(f"  [OK] Firebase")
                    synced += 1
            if synced:
                push_latest(FIREBASE_URL, data)
            print(f"\nDone — synced {synced} days")

        browser.close()
    proc.terminate()


if __name__ == "__main__":
    main()
