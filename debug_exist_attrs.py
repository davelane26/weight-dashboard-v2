#!/usr/bin/env python3
# /// script
# dependencies = ["requests"]
# ///
"""
Quick debug: list ALL Exist.io attributes + today's values.
Run: uv run debug_exist_attrs.py
Set EXIST_TOKEN env var first.
"""
import os, sys
import requests
from datetime import date

TOKEN = os.environ.get("EXIST_TOKEN", "")
if not TOKEN:
    TOKEN = input("Paste your Exist.io token: ").strip()

TODAY = date.today().isoformat()

# ── Fetch every attribute ──────────────────────────────────────────────────
print(f"\nFetching ALL attributes from Exist.io for {TODAY}...\n")

resp = requests.get(
    "https://exist.io/api/2/attributes/with-values/",
    headers={"Authorization": f"Token {TOKEN}"},
    params={"date_max": TODAY, "days": 1},
    timeout=30,
)

if resp.status_code != 200:
    print(f"ERROR {resp.status_code}: {resp.text}")
    sys.exit(1)

results = resp.json().get("results", [])
print(f"{'Attribute':<35} {'Group':<20} {'Value'}")
print("-" * 70)
for attr in sorted(results, key=lambda a: (a.get("group", {}).get("name",""), a["name"])):
    val = attr.get("values", [{}])[0].get("value", "—")
    group = attr.get("group", {}).get("name", "")
    print(f"{attr['name']:<35} {group:<20} {val}")
