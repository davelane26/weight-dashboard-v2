import json, requests
c = json.load(open(".garmin_cookies.json"))
h = {"NK": "NT", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json", "User-Agent": "Mozilla/5.0"}

urls = [
    "https://connect.garmin.com/proxy/userprofile-service/userprofile/user-settings",
    "https://connect.garmin.com/modern/proxy/userprofile-service/userprofile/user-settings",
    "https://connect.garmin.com/userprofile-service/userprofile/user-settings",
    "https://connect.garmin.com/api/userprofile-service/userprofile/user-settings",
]

for url in urls:
    r = requests.get(url, cookies=c, headers=h, timeout=15)
    snippet = r.text[:80].replace("\n", " ")
    print(f"{r.status_code} | {url.split('garmin.com')[1]}")
    print(f"  -> {snippet}")
    print()

