# Removed Features

This doc tracks features that were intentionally removed, with recovery instructions.

---

## Glucose Tab (Dexcom G7 CGM Integration)

**Removed:** 2026-06-29  
**Recovery tag:** `glucose-backup`  
**Commit:** `6de3fa4`

### What it was
- Live glucose readings from Dexcom G7 via Share API
- 24-hour glucose chart
- Time-in-range (TIR) calculations
- Estimated A1C
- Glucose snapshot in header strip
- Glucose TIR as component of daily health score

### Quick restore (nuclear option)
```bash
git revert 6de3fa4
```

### Surgical restore

**Step 1: Restore deleted files**
```bash
git show glucose-backup:glucose.js > glucose.js
git show glucose-backup:glucose.json > glucose.json
git show glucose-backup:fetch_glucose.py > fetch_glucose.py
```

**Step 2: Files needing manual edits**

| File | What to restore |
|------|-----------------|
| `app-config.js` | Add `'glucose'` to TABS array |
| `index.html` | Tab button, tab panel, script tag, snapshot cell, `GLUCOSE_WORKER_URL` |
| `app-tabs.js` | Glucose resize handler in `switchTab()` |
| `app-insights.js` | Glucose snapshot update + stress-vs-glucose insight |
| `healthscore.js` | Glucose TIR as 3rd component (was 30/35/35 weights) |
| `healthcard.js` | Swap Resting HR stat back to Glucose |
| `enhancements.js` | Add `loadGlucose` to refresh functions |

**Step 3: View exact diffs**
```bash
# See all changes made during removal
git show 6de3fa4

# Compare any specific file
git diff main glucose-backup -- index.html
```

### Dependencies
- Cloudflare Worker (`glucose-relay`) - still deployed, serves health.json too
- Dexcom Share API credentials (were in GitHub Secrets)
