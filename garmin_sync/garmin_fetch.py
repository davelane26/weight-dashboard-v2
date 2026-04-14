"""
Fetches Garmin data by running fetch() calls inside the actual Chrome browser.
No auth headers needed — the browser handles it all automatically.

Run:
    python garmin_fetch.py
"""
import json, subprocess, sys, time, socket
from datetime import date, timedelta
from pathlib import Path

CDP_PORT = 9222
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"
GARMIN_HOME = "https://connect.garmin.com/modern"
DAYS_BACK = 2

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest
from playwright.sync_api import sync_playwright


def find_chrome():
    for p in CHROME_PATHS:
        if Path(p).exists():
            return p
    return None


def fetch_day_via_browser(page, day: date) -> dict:
    """Run fetch() calls inside the browser to get Garmin data."""
    iso = day.isoformat()
    base = "https://connect.garmin.com/gc-api"

    js = f"""
    async () => {{
        const h = {{ 'NK': 'NT', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }};
        const [summary, sleep, acts] = await Promise.allSettled([
            fetch('{base}/usersummary-service/usersummary/daily/{UUID}?calendarDate={iso}', {{headers: h}}).then(r => r.json()),
            fetch('{base}/sleep-service/sleep/{UUID}?date={iso}', {{headers: h}}).then(r => r.json()),
            fetch('{base}/activitylist-service/activities/search/activities?startDate={iso}&endDate={iso}&limit=10', {{headers: h}}).then(r => r.json()),
        ]);
        return {{
            summary: summary.status === 'fulfilled' ? summary.value : null,
            sleep: sleep.status === 'fulfilled' ? sleep.value : null,
            activities: acts.status === 'fulfilled' ? acts.value : null,
        }};
    }}
    """

    raw = page.evaluate(js)
    return raw


def parse_summary(raw: dict, iso: str) -> dict:
    s = raw.get("summary") or {}
    sl = raw.get("sleep") or {}
    acts_raw = raw.get("activities") or []
    daily = sl.get("dailySleepDTO") or {}
    sleep_secs = daily.get("sleepTimeSeconds") or 0
    sleep_hrs = round(sleep_secs / 3600, 1)

    acts = []
    for a in (acts_raw if isinstance(acts_raw, list) else [])[:5]:
        acts.append({
            "name": a.get("activityName", "Unknown"),
            "type": a.get("activityType", {}).get("typeKey", "other"),
            "duration": round((a.get("duration") or 0) / 60, 1),
            "distance": round((a.get("distance") or 0) / 1609.34, 2),
            "calories": a.get("calories", 0),
        })

    return {
        "date": iso,
        "steps": s.get("totalSteps", 0),
        "distance": round((s.get("totalDistanceMeters") or 0) / 1609.34, 2),
        "activeCalories": s.get("activeKilocalories", 0),
        "totalCalories": s.get("totalKilocalories", 0),
        "restingHR": s.get("restingHeartRate"),
        "bodyBattery": s.get("bodyBatteryHighestValue") or s.get("bodyBatteryChargedValue"),
        "stressLevel": s.get("averageStressLevel"),
        "intensityMinutes": (s.get("moderateIntensityMinutes") or 0) + (s.get("vigorousIntensityMinutes") or 0),
        "sleepHours": sleep_hrs,
        "sleepScore": daily.get("sleepScores", {}).get("overall", {}).get("value"),
        "activities": acts,
    }


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] Chrome not found.")
        sys.exit(1)

    print("Closing any existing Chrome...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    time.sleep(2)

    print("Launching Chrome with remote debugging...")
    proc = subprocess.Popen([chrome,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={Path.home() / 'AppData/Local/Temp/cdp-profile'}",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "about:blank"])

    time.sleep(5)
    for attempt in range(15):
        try:
            s = socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1)
            s.close()
            print(f"[OK] Chrome ready")
            break
        except (ConnectionRefusedError, OSError):
            print(f"Waiting... ({attempt+1}/15)")
            time.sleep(1)
    else:
        print("[FAIL] Chrome debug port never opened.")
        proc.terminate(); sys.exit(1)

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            print("Navigating to Garmin Connect...")
            page.goto(GARMIN_HOME, timeout=30000)

            # Wait for login if needed
            for _ in range(120):
                if "connect.garmin.com" in page.url and "sso" not in page.url:
                    break
                time.sleep(1)
            else:
                print("[WARN] Login may be needed — waiting 60s more...")
                time.sleep(60)

            print(f"[OK] On page: {page.url[:60]}")
            time.sleep(3)  # let the app fully load

            today = date.today()
            synced = 0

            for i in range(DAYS_BACK - 1, -1, -1):
                day = today - timedelta(days=i)
                print(f"Fetching {day.isoformat()}...")
                raw = fetch_day_via_browser(page, day)
                data = parse_summary(raw, day.isoformat())
                print(f"  steps={data['steps']} sleep={data['sleepHours']}h battery={data['bodyBattery']}")

                if data.get("steps") or data.get("sleepHours"):
                    if push_day(FIREBASE_URL, day.isoformat(), data):
                        print(f"  [OK] Pushed to Firebase")
                        synced += 1
                    if i == 0:
                        push_latest(FIREBASE_URL, data)
                else:
                    print(f"  [WARN] No data for {day.isoformat()}")

            print(f"\nDone — synced {synced} days")
            browser.close()

    except Exception as e:
        import traceback
        print(f"[FAIL] {e}")
        traceback.print_exc()
        proc.terminate(); sys.exit(1)

    proc.terminate()


if __name__ == "__main__":
    main()
