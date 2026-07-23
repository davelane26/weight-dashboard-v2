#!/usr/bin/env python3
"""
migrate_weight.py -- one-time seed of the worker's private weight store.

Fetches the (currently public) weight data.json and pushes it into the
Cloudflare Worker's KV under the 'weight' key via POST /weight, so the
token-gated GET /weight.json has something to serve.

Usage (PowerShell):
    $env:API_SECRET="your-worker-api-secret"
    uv run --with requests python migrate_weight.py

After this succeeds AND you've confirmed the dashboard loads from the
worker, you can delete the public data.json to close the leak.
"""
import os
import sys
import json
import urllib.request

PUBLIC_URL = "https://davelane26.github.io/Weight-tracker/data.json"
WORKER_URL = os.environ.get("WORKER_URL", "https://glucose-relay.djtwo6.workers.dev")
API_SECRET = os.environ.get("API_SECRET")


def main():
    if not API_SECRET:
        sys.exit("ERROR: set the API_SECRET env var (your Worker's API_SECRET secret).")

    print(f"Fetching public data from {PUBLIC_URL} ...")
    with urllib.request.urlopen(PUBLIC_URL) as r:
        rows = json.loads(r.read().decode())
    if not isinstance(rows, list) or not rows:
        sys.exit("ERROR: public data.json was empty or not a JSON array.")
    print(f"  got {len(rows)} readings.")

    print(f"Pushing to {WORKER_URL}/weight ...")
    req = urllib.request.Request(
        f"{WORKER_URL}/weight",
        data=json.dumps(rows).encode(),
        headers={"Content-Type": "application/json", "API-SECRET": API_SECRET},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        resp = json.loads(r.read().decode())
    print("  worker responded:", resp)
    if resp.get("ok"):
        print("\nSUCCESS. The worker now serves your weight data behind auth at")
        print(f"  GET {WORKER_URL}/weight.json  (requires Firebase token + allow-listed email)")
        print("\nNext: confirm the dashboard loads, then delete the public data.json.")
    else:
        sys.exit(f"Worker did not confirm: {resp}")


if __name__ == "__main__":
    main()
