import json, requests
from datetime import date

all_cookies = json.load(open(".garmin_cookies.json"))

# Only send connect.garmin.com cookies — not SSO domain ones
CONNECT_COOKIES = ["JWT_WEB", "SESSIONID", "SESSION", "__VCAP_ID__", "__cflb", "cf_clearance", "__cf_bm"]
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

for path, params in endpoints:
    r = requests.get(f"{BASE}/{path}", cookies=c, headers=h, params=params or None, timeout=15)
    print(f"\n{r.status_code} | {path}")
    print(r.text[:300])

