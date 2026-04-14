"""
Reads Garmin data directly from the browser's service worker Cache Storage.
No auth needed — the app already cached it when it loaded.
"""
import subprocess, sys, time, socket, json
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

CDP_PORT = 9222
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = str(Path.home() / "AppData/Local/Temp/cdp-profile")
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"
FIREBASE_URL = "https://weight-dashboard-6b5f3-default-rtdb.firebaseio.com"

sys.path.insert(0, str(Path(__file__).parent))
from firebase_push import push_day, push_latest


def main():
    print("Killing Chrome...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True)
    time.sleep(3)

    lock = Path(PROFILE) / "SingletonLock"
    if lock.exists():
        lock.unlink()

    proc = subprocess.Popen([CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "about:blank"])
    time.sleep(6)

    for i in range(20):
        try:
            socket.create_connection(("127.0.0.1", CDP_PORT), timeout=1).close()
            print("[OK] Chrome ready"); break
        except (ConnectionRefusedError, OSError):
            print(f"  waiting {i+1}/20"); time.sleep(1)
    else:
        print("[FAIL] debug port never opened"); proc.terminate(); sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        print("Loading Garmin Connect...")
        page.goto("https://connect.garmin.com/modern", timeout=60000)
        for _ in range(120):
            if "connect.garmin.com" in page.url and "sso" not in page.url:
                break
            time.sleep(1)
        print(f"[OK] On: {page.url}")
        print("Waiting 15s for app + service worker to load...")
        time.sleep(15)

        # Read ALL keys from ALL caches
        print("\nReading service worker cache...")
        cache_data = page.evaluate("""
        async () => {
            const results = {};
            try {
                const cacheNames = await caches.keys();
                results._cacheNames = cacheNames;
                for (const name of cacheNames) {
                    const cache = await caches.open(name);
                    const keys = await cache.keys();
                    results[name] = [];
                    for (const req of keys) {
                        if (req.url.includes('gc-api') || req.url.includes('garmin')) {
                            try {
                                const resp = await cache.match(req);
                                const text = resp ? await resp.text() : null;
                                results[name].push({
                                    url: req.url,
                                    body: text ? text.substring(0, 500) : null
                                });
                            } catch(e) {
                                results[name].push({ url: req.url, error: e.message });
                            }
                        }
                    }
                }
            } catch(e) {
                results._error = e.message;
            }
            return results;
        }
        """)

        caches = cache_data.get("_cacheNames", [])
        print(f"Found {len(caches)} caches: {caches}")

        if cache_data.get("_error"):
            print(f"Cache error: {cache_data['_error']}")

        found_data = False
        for cache_name, entries in cache_data.items():
            if cache_name.startswith("_"):
                continue
            if isinstance(entries, list) and entries:
                print(f"\nCache '{cache_name}' has {len(entries)} garmin entries:")
                for entry in entries[:10]:
                    print(f"  {entry['url'][:80]}")
                    if entry.get('body'):
                        print(f"    {entry['body'][:150]}")
                        found_data = True

        if not found_data:
            print("\nNo cached gc-api data found.")
            print("Dumping ALL cache keys to find what's stored...")
            all_keys = page.evaluate("""
            async () => {
                const all = [];
                const names = await caches.keys();
                for (const name of names) {
                    const c = await caches.open(name);
                    const keys = await c.keys();
                    for (const k of keys) all.push(name + ' | ' + k.url);
                }
                return all.slice(0, 50);
            }
            """)
            for k in all_keys:
                print(f"  {k[:100]}")

        browser.close()
    proc.terminate()


if __name__ == "__main__":
    main()
