import json, re, requests
from datetime import date

c = json.load(open(".garmin_cookies.json"))
BASE = "https://connect.garmin.com/gc-api"
today = date.today().isoformat()
UUID = "3d8b29e7-c9fc-40db-b7a5-a5609741229f"  # found from DevTools

h = {
    "NK": "NT",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
}

# Test data endpoints with UUID
endpoints = [
    (f"usersummary-service/usersummary/daily/{UUID}", {"calendarDate": today}),
    (f"sleep-service/sleep/{UUID}", {"date": today}),
    (f"activitylist-service/activities/search/activities", {"startDate": today, "endDate": today, "limit": 5}),
    # Try to find the profile endpoint that returns the UUID
    (f"userprofile-service/userprofile/user-settings", {}),
    (f"userprofile-service/socialProfile/displayName/davelane26", {}),
]

for path, params in endpoints:
    r = requests.get(f"{BASE}/{path}", cookies=c, headers=h, params=params or None, timeout=15)
    print(f"\n{r.status_code} | {path}")
    print(r.text[:300])

