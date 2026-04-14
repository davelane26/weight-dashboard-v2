import json, requests
from datetime import date

c = json.load(open(".garmin_cookies.json"))
h = {"NK": "NT", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json", "User-Agent": "Mozilla/5.0"}
BASE = "https://connect.garmin.com/proxy"
today = date.today().isoformat()

endpoints = [
    (f"usersummary-service/usersummary/daily/davelane26", {"calendarDate": today}),
    (f"sleep-service/sleep/davelane26", {"date": today}),
    (f"activitylist-service/activities/search/activities", {"startDate": today, "endDate": today, "limit": 5}),
]

for path, params in endpoints:
    r = requests.get(f"{BASE}/{path}", cookies=c, headers=h, params=params, timeout=15)
    print(f"\n{r.status_code} | {path}")
    print(r.text[:400])

