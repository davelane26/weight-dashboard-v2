"""
Connects to YOUR real Chrome profile (not a temp one).
Makes fetch() calls from inside the browser — auth handled automatically.
"""
import subprocess, sys, time, socket, json
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

CDP_PORT = 9223   # different port to avoid conflicts
DAYS_BACK = 2
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# Real Chrome profile — adjust username if needed
PROFILE = Path(r"C:\Users\djtwo\AppData\Local\Google\Chrome\User Data")


def main():
    if not Path(CHROME).exists():
        print("[FAIL] Chrome not found"); sys.exit(1)

    print("Killing Chrome...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    time.sleep(3)

    print(f"Launching with real profile: {PROFILE}")
    proc = subprocess.Popen([
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE}",
        "--no-first-run", "--no-default-browser-check",
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
        print("[FAIL] Chrome never opened debug port"); proc.terminate(); sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        print("Going to Garmin Connect...")
        page.goto("https://connect.garmin.com/modern", timeout=30000)
        for _ in range(120):
            if "connect.garmin.com" in page.url and "sso" not in page.url:
                break
            time.sleep(1)
        print(f"[OK] On: {page.url}")
        time.sleep(8)  # let the app fully initialize

        today = date.today()
        synced = 0

        for i in range(DAYS_BACK - 1, -1, -1):
            day = today - timedelta(days=i)
            iso = day.isoformat()
            base = "https://connect.garmin.com/gc-api"

            print(f"\nFetching {iso}...")
            result = page.evaluate(f"""async () => {{
                const h = {{'NK':'NT','X-Requested-With':'XMLHttpRequest','Accept':'application/json'}};
                const [sr, slr, ar] = await Promise.all([
                    fetch('{base}/usersummary-service/usersummary/daily/{UUID}?calendarDate={iso}', {{headers:h}}),
                    fetch('{base}/sleep-service/sleep/{UUID}?date={iso}', {{headers:h}}),
                    fetch('{base}/activitylist-service/activities/search/activities?startDate={iso}&endDate={iso}&limit=10', {{headers:h}}),
                ]);
                return {{
                    sumStatus: sr.status, sumBody: (await sr.text()).slice(0,500),
                    slpStatus: slr.status, slpBody: (await slr.text()).slice(0,500),
                    actStatus: ar.status, actBody: (await ar.text()).slice(0,200),
                }};
            }}""")

            print(f"  Summary {result['sumStatus']}: {result['sumBody'][:150]}")
            print(f"  Sleep   {result['slpStatus']}: {result['slpBody'][:150]}")
            print(f"  Acts    {result['actStatus']}: {result['actBody'][:100]}")

        browser.close()
    proc.terminate()


if __name__ == "__main__":
    main()
