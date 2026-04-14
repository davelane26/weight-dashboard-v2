import json, re, requests
from datetime import date

c = json.load(open(".garmin_cookies.json"))
BASE = "https://connect.garmin.com/proxy"
today = date.today().isoformat()

# Grab CSRF token from the Connect page
page = requests.get("https://connect.garmin.com/modern", cookies=c,
    headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
csrf = re.search(r'csrf-token" content="([^"]+)"', page.text)
csrf_token = csrf.group(1) if csrf else ""
print(f"CSRF token: {csrf_token[:30]}..." if csrf_token else "No CSRF token found")

h = {
    "NK": "NT",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
    "X-CSRF-Token": csrf_token,
}

endpoints = [
    (f"usersummary-service/usersummary/daily/davelane26", {"calendarDate": today}),
    (f"sleep-service/sleep/davelane26", {"date": today}),
    (f"activitylist-service/activities/search/activities", {"startDate": today, "endDate": today, "limit": 5}),
]

for path, params in endpoints:
    r = requests.get(f"{BASE}/{path}", cookies=c, headers=h, params=params, timeout=15)
    print(f"\n{r.status_code} | {path}")
    print(r.text[:400])

