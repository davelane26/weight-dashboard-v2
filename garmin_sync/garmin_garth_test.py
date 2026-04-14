"""
Tests garth authentication against Garmin Connect.
Run: python garmin_garth_test.py
"""
import subprocess, sys

# Install garth if needed
try:
    import garth
except ImportError:
    print("Installing garth...")
    subprocess.run([sys.executable, "-m", "pip", "install", "garth"], check=True)
    import garth

import garth
from garth.exc import GarthException

EMAIL = input("Garmin email: ").strip()
PASSWORD = input("Garmin password: ").strip()

print("\nAuthenticating with Garmin...")
try:
    garth.login(EMAIL, PASSWORD)
    profile = garth.connectapi("/userprofile-service/userprofile/user-settings")
    print(f"\n[OK] Logged in!")
    print(f"Profile: {profile}")

    from datetime import date
    today = date.today().isoformat()
    summary = garth.connectapi(f"/usersummary-service/usersummary/daily", params={"calendarDate": today})
    print(f"\nToday's summary: {summary}")

except GarthException as e:
    print(f"\n[FAIL] Auth error: {e}")
    print("Rate limit may still be active — try again tomorrow.")
except Exception as e:
    import traceback
    print(f"\n[FAIL] {e}")
    traceback.print_exc()
