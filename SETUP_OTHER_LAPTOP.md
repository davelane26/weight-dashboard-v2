# Garmin Session Setup — Other Laptop Instructions

Run this on any laptop on **home wifi** (no Walmart VPN).

## Step 1 — Install Python
https://python.org (skip if already installed)

## Step 2 — Install dependencies
Open terminal and run:
```
pip install garth pynacl requests
```

## Step 3 — Create the setup script
Create a new file called `garmin_setup.py` and paste this in:

```python
import base64, getpass, json, requests
from nacl import encoding, public

REPO = "davelane26/weight-dashboard-v2"

def encrypt_secret(pub_b64, value):
    key = public.PublicKey(base64.b64decode(pub_b64), encoding.RawEncoder)
    return base64.b64encode(public.SealedBox(key).encrypt(value.encode())).decode()

def push(token, session_b64):
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json", "User-Agent": "garmin-setup"}
    base = f"https://api.github.com/repos/{REPO}"
    pk = requests.get(f"{base}/actions/secrets/public-key", headers=h, timeout=15).json()
    r = requests.put(f"{base}/actions/secrets/GARMIN_SESSION", headers=h,
                     json={"encrypted_value": encrypt_secret(pk["key"], session_b64), "key_id": pk["key_id"]}, timeout=15)
    return r.status_code in (201, 204)

email = input("Garmin email: ").strip()
password = getpass.getpass("Garmin password: ")
github_token = getpass.getpass("GitHub token: ")

print("\nLogging in...")
import garth

def mfa():
    return input("MFA code from Garmin app: ").strip()

try:
    garth.login(email, password, prompt_mfa=mfa)
    print("[OK] Logged in!")
except Exception as e:
    print(f"[FAIL] {e}")
    exit(1)

session_b64 = base64.b64encode(json.dumps(garth.client.dumps()).encode()).decode()
print("Pushing to GitHub...")
print("[OK] Done!" if push(github_token, session_b64) else "[FAIL] Push failed")
```

## Step 4 — Run it
```
python garmin_setup.py
```

## Step 5 — Enter when prompted
| Prompt | What to enter |
|---|---|
| Garmin email | Your Garmin login email |
| Garmin password | Your Garmin password |
| GitHub token | See below |
| MFA code | From Garmin app on your phone |

## GitHub Token
Open this file on your **work laptop**:
```
C:\Users\d3lane\Documents\puppy_workspace\weight-dashboard-v2\.github_token
```
Copy the value after `GITHUB_TOKEN=` and paste it when prompted.

## Done!
GitHub Actions will sync your Garmin data every 15 minutes automatically.
Session lasts ~90 days — re-run this script when sync stops working.

Run this on any laptop on **home wifi** (no Walmart VPN).

## Step 1 — Install Python
https://python.org (skip if already installed)

## Step 2 — Install dependencies
Open terminal and run:
```
pip install garminconnect pynacl requests
```

## Step 3 — Create the setup script
Create a new file called `garmin_setup.py` and paste this in:

```python
import base64, getpass, json, requests
from nacl import encoding, public

REPO = "davelane26/weight-dashboard-v2"

def encrypt_secret(pub_b64, value):
    key = public.PublicKey(base64.b64decode(pub_b64), encoding.RawEncoder)
    return base64.b64encode(public.SealedBox(key).encrypt(value.encode())).decode()

def push(token, session_b64):
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json", "User-Agent": "garmin-setup"}
    base = f"https://api.github.com/repos/{REPO}"
    pk = requests.get(f"{base}/actions/secrets/public-key", headers=h, timeout=15).json()
    r = requests.put(f"{base}/actions/secrets/GARMIN_SESSION", headers=h,
                     json={"encrypted_value": encrypt_secret(pk["key"], session_b64), "key_id": pk["key_id"]}, timeout=15)
    return r.status_code in (201, 204)

email = input("Garmin email: ")
password = getpass.getpass("Garmin password: ")
github_token = getpass.getpass("GitHub token: ")

from garminconnect import Garmin
client = Garmin(email, password, prompt_mfa=lambda: input("MFA code: "))
client.login()

session_b64 = base64.b64encode(json.dumps(client.garth.dumps()).encode()).decode()
print("[OK] Logged in!")
print("[OK] Pushed!" if push(github_token, session_b64) else "[FAIL] Push failed — set GARMIN_SESSION manually")
```

## Step 4 — Run it
```
python garmin_setup.py
```

## Step 5 — Enter when prompted
| Prompt | What to enter |
|---|---|
| Garmin email | Your Garmin login email |
| Garmin password | Your Garmin password |
| GitHub token | See below |
| MFA code | From Garmin app on your phone |

## GitHub Token
Open this file on your **work laptop**:
```
C:\Users\d3lane\Documents\puppy_workspace\.github_token
```
Copy the value after `GITHUB_TOKEN=` and paste it when prompted.

## Done!
GitHub Actions will now sync your Garmin data every 15 minutes automatically.
Session lasts ~90 days — re-run this script when sync stops working.
