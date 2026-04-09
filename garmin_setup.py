"""
garmin_setup.py — Run this ONCE on your home PC to generate OAuth tokens.
It saves the tokens to garmin_tokens.json which you paste into GitHub secrets.

Usage:
  python garmin_setup.py
"""

import base64
import getpass
import json
import os
import sys

try:
    import garth
except ImportError:
    print('Installing garth...')
    os.system(f'{sys.executable} -m pip install garth')
    import garth

email    = input('Garmin Connect email: ')
password = getpass.getpass('Garmin Connect password: ')

print('Logging in...')
garth.login(email, password)

# Save tokens to temp dir then base64 encode them
import tempfile, shutil, pathlib

tmp = pathlib.Path(tempfile.mkdtemp())
garth.save(str(tmp))

# Zip all token files into a single base64 string
import io, zipfile
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as z:
    for f in tmp.iterdir():
        z.write(f, f.name)
shutil.rmtree(tmp)

encoded = base64.b64encode(buf.getvalue()).decode()

print('\n' + '='*60)
print('SUCCESS! Copy the value below and add it as a GitHub secret')
print('Secret name: GARMIN_TOKENS')
print('='*60)
print(encoded)
print('='*60 + '\n')
print('Then go to: https://github.com/davelane26/weight-dashboard-v2/settings/secrets/actions')
