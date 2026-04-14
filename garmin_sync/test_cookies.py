import json, requests
c = json.load(open(".garmin_cookies.json"))
h = {"NK": "NT", "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0"}
r = requests.get("https://connect.garmin.com/modern/proxy/userprofile-service/userprofile/user-settings", cookies=c, headers=h, timeout=15)
print(r.status_code, r.text[:300])
