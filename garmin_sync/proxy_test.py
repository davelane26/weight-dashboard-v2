"""
Tests if Garmin's /proxy/download-service works with cookies.
If it does, we can automate daily data pulls without gc-api auth.
"""
import json, requests
from datetime import date, timedelta

c = json.load(open(".garmin_cookies.json"))
today = date.today()
yesterday = today - timedelta(days=1)

BASE = "https://connect.garmin.com/proxy"
h = {
    "NK": "NT",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://connect.garmin.com",
    "Referer": "https://connect.garmin.com/",
}

# Test multiple proxy endpoints that might still work
tests = [
    # Wellness download (returns zip with JSON files)
    ("GET", f"{BASE}/download-service/files/wellness/{yesterday.strftime('%Y-%m-%d')}", {}),
    # Direct usersummary - we know this returns {} but let's see status
    ("GET", f"{BASE}/usersummary-service/usersummary/daily/davelane26", {"calendarDate": today.isoformat()}),
    # Weight
    ("GET", f"{BASE}/weight-service/weight/dateRange", {"startDate": yesterday.isoformat(), "endDate": today.isoformat()}),
    # Heart rate  
    ("GET", f"{BASE}/wellness-service/wellness/dailyHeartRate/davelane26", {"date": today.isoformat()}),
    # Steps
    ("GET", f"{BASE}/wellness-service/wellness/dailySummaryChart/davelane26", {"date": today.isoformat()}),
    # Body battery
    ("GET", f"{BASE}/wellness-service/wellness/bodyBattery/bulletedList/davelane26", {"startDate": yesterday.isoformat(), "endDate": today.isoformat()}),
]

for method, url, params in tests:
    r = requests.request(method, url, cookies=c, headers=h, params=params, timeout=15)
    body = r.text[:200].strip()
    print(f"\n{r.status_code} | {url.split('/proxy/')[1].split('?')[0]}")
    print(f"  {body}")
