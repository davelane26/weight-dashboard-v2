"""
Intercepts Garmin Connect's own API responses as the page loads.
No auth needed — the browser handles it, we just capture the data.
"""
import json, subprocess, sys, time, socket
from datetime import date, timedelta
from pathlib import Path

CDP_PORT = 9222
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest
from playwright.sync_api import sync_playwright

captured = {}  # date -> data

def find_chrome():
    for p in CHROME_PATHS:
        if Path(p).exists():
            return p
    return None

def handle_response(response):
    url = response.url
    if "gc-api" not in url:
        return
    try:
        data = response.json()
        if not isinstance(data, dict) or not data:
            return

        # Daily summary
        if "usersummary/daily" in url:
            cal = response.request.url.split("calendarDate=")[-1].split("&")[0] if "calendarDate=" in url else ""
            if cal:
                captured.setdefault(cal, {})
                captured[cal]["summary"] = data
                print(f"[OK] Captured summary for {cal}")

        # Sleep
        elif "sleep-service/sleep" in url:
            d = response.request.url.split("date=")[-1].split("&")[0] if "date=" in url else ""
            if d:
                captured.setdefault(d, {})
                captured[d]["sleep"] = data
                print(f"[OK] Captured sleep for {d}")

        # Activities
        elif "activitylist-service/activities" in url:
            if isinstance(data, list) or "activityList" in data:
                today = date.today().isoformat()
                captured.setdefault(today, {})
                captured[today]["activities"] = data if isinstance(data, list) else data.get("activityList", [])
                print(f"[OK] Captured activities")

    except Exception:
        pass


def parse_day(day_str, raw):
    s = raw.get("summary", {})
    sl = raw.get("sleep", {}).get("dailySleepDTO", {}) or {}
    sleep_secs = sl.get("sleepTimeSeconds") or 0
    acts_raw = raw.get("activities", [])
    acts = [{"name": a.get("activityName"), "type": a.get("activityType", {}).get("typeKey"),
              "duration": round((a.get("duration") or 0) / 60, 1),
              "distance": round((a.get("distance") or 0) / 1609.34, 2),
              "calories": a.get("calories", 0)} for a in acts_raw[:5]]
    return {
        "date": day_str,
        "steps": s.get("totalSteps", 0),
        "distance": round((s.get("totalDistanceMeters") or 0) / 1609.34, 2),
        "activeCalories": s.get("activeKilocalories", 0),
        "totalCalories": s.get("totalKilocalories", 0),
        "restingHR": s.get("restingHeartRate"),
        "bodyBattery": s.get("bodyBatteryHighestValue") or s.get("bodyBatteryChargedValue"),
        "stressLevel": s.get("averageStressLevel"),
        "intensityMinutes": (s.get("moderateIntensityMinutes") or 0) + (s.get("vigorousIntensityMinutes") or 0),
        "sleepHours": round(sleep_secs / 3600, 1),
        "sleepScore": sl.get("sleepScores", {}).get("overall", {}).get("value"),
        "activities": acts,
    }


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] Chrome not found."); sys.exit(1)

    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    time.sleep(2)
    proc = subprocess.Popen([chrome,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={Path.home() / 'AppData/Local/Temp/cdp-profile'}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "about:blank"])

    time.sleep(5)
    for attempt in range(15):
        try:
            s = socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1)
            s.close(); print(f"[OK] Chrome ready"); break
        except (ConnectionRefusedError, OSError):
            print(f"Waiting... ({attempt + 1}/15)"); time.sleep(1)
    else:
        print("[FAIL] Debug port never opened."); proc.terminate(); sys.exit(1)

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            # Set up interceptor BEFORE navigating
            page.on("response", handle_response)

            print("Loading Garmin Connect...")
            page.goto("https://connect.garmin.com/modern", timeout=30000)

            for _ in range(120):
                if "connect.garmin.com" in page.url and "sso" not in page.url:
                    break
                time.sleep(1)
            print(f"[OK] On: {page.url}")

            # Wait for API responses to come in
            print("Waiting for data to load (15s)...")
            time.sleep(15)

            print(f"\nCaptured data for: {list(captured.keys())}")

            synced = 0
            for day_str, raw in captured.items():
                data = parse_day(day_str, raw)
                print(f"{day_str}: steps={data['steps']} sleep={data['sleepHours']}h battery={data['bodyBattery']}")
                if data.get("steps") or data.get("sleepHours"):
                    if push_day(FIREBASE_URL, day_str, data):
                        print(f"  [OK] Pushed to Firebase")
                        synced += 1

            if synced > 0:
                latest = parse_day(max(captured.keys()), captured[max(captured.keys())])
                push_latest(FIREBASE_URL, latest)

            print(f"\nDone — synced {synced} days")
            browser.close()

    except Exception as e:
        import traceback
        print(f"[FAIL] {e}"); traceback.print_exc()
        proc.terminate(); sys.exit(1)

    proc.terminate()


if __name__ == "__main__":
    main()
