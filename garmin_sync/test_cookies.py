import json, requests
from datetime import date

all_cookies = json.load(open(".garmin_cookies.json"))

# Only send connect.garmin.com cookies — not SSO domain ones
CONNECT_COOKIES = ["JWT_WEB", "SESSIONID", "SESSION", "session", "SERVERID", "__VCAP_ID__", "__cflb", "cf_clearance", "__cf_bm", "_cfuvid"]
c = {k: v for k, v in all_cookies.items() if k in CONNECT_COOKIES}
print(f"Sending cookies: {list(c.keys())}")

BASE = "https://connect.garmin.com/gc-api"
today = date.today().isoformat()
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"

h = {
    "NK": "NT",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://connect.garmin.com",
    "Referer": "https://connect.garmin.com/",
}

endpoints = [
    (f"usersummary-service/usersummary/daily/{UUID}", {"calendarDate": today}),
    (f"sleep-service/sleep/{UUID}", {"date": today}),
    (f"userprofile-service/userprofile/user-settings", {}),
]

# Try 1: filtered cookies
c = {k: v for k, v in all_cookies.items() if k in CONNECT_COOKIES}
print(f"Sending filtered cookies: {list(c.keys())}")
r = requests.get(f"{BASE}/usersummary-service/usersummary/daily/{UUID}", cookies=c, headers=h, params={"calendarDate": today}, timeout=15)
print(f"Filtered: {r.status_code} | {r.text[:200]}")

# Try 2: ALL cookies
print(f"\nSending ALL cookies: {list(all_cookies.keys())}")
r2 = requests.get(f"{BASE}/usersummary-service/usersummary/daily/{UUID}", cookies=all_cookies, headers=h, params={"calendarDate": today}, timeout=15)
print(f"All cookies: {r2.status_code} | {r2.text[:200]}")

