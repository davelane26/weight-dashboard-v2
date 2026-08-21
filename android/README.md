# Kage Health Bridge (Android)

Tiny Android app that reads today's Health Connect data (steps, later HR/sleep/workouts/calories) and POSTs it to your dashboard's Cloudflare Worker every 15 minutes.

## Why this exists

Samsung Health / Health Connect is on-device batched-data only — no cloud REST API. To get today's live-ish step count into the web dashboard, we have to run something on the phone that reads Health Connect and pushes to a server. This app is that thing.

Latency: ~15-20 min behind reality (Health Connect batches at ~1 min, WorkManager fires every 15 min).

## Architecture

```
Galaxy Watch → Samsung Health → Health Connect (on phone)
                                        ↓
             This app (WorkManager every 15 min)
                                        ↓
             HTTPS POST /health/patch → Cloudflare Worker (existing)
                                        ↓
             KV storage → dashboard's /health.json → live tile
```

## Building the APK

You don't build it locally — GitHub Actions does. Every push to `android/**` triggers a build. Download the artifact from the Actions run, install on phone.

To install:
1. Enable "Install unknown apps" for your browser or file manager
2. Download the `.apk` from GitHub Actions artifacts
3. Tap to install
4. Open Kage Health Bridge → grant Health Connect permissions when prompted
5. Enter Worker URL + auth token → tap "Sync now" to verify
6. Add to Android's "Never sleeping apps" list (Settings → Device care → Battery → Background usage limits → Never sleeping apps → +) so background sync isn't killed

## Local dev (optional)

If you have Android Studio installed:
```
cd android
./gradlew installDebug
```

## Phase status

- [x] Phase 1: Scaffolding + steps-only (v0.1.0)
- [x] Phase 2: HR (min/max/avg/resting), sleep (hours + stages + awakenings), workouts, active/total calories, floors climbed (v0.2.0)
- [x] Phase 2.5 (v0.3.4): distance, SpO2 (avg/min), HRV (RMSSD), VO2 Max, bedtime/waketime
- [x] **Phase 3 (v0.4.0): multi-origin support — read from Samsung Health AND/OR Garmin Connect**
- [ ] Phase 4: Polish (retry logic, error notifications, dashboard live tile)

## Multi-source setup (v0.4.0+)

Kage can now read from **both Samsung Health and Garmin Connect** via Health Connect. It uses a **primary→fallback** strategy for sum-type metrics (steps, distance, calories, floors, workout minutes) so wearing both watches on the same day doesn't double-count.

### Choose which source is authoritative

In Kage's UI: **Primary data source** card → tap either **Samsung Health** or **Garmin Connect**. That source's data wins when both have readings today; the other only fills in if the primary is empty.

Point-in-time metrics (HR aggregates, sleep, resting HR, SpO2, HRV, VO2 Max) are read unfiltered — they either don't sum-inflate (min/max are meaningful) or are already dominated by most-recent-wins (sleep, resting HR, VO2 Max).

### Enable Garmin → Health Connect sync (on your phone)

1. Open **Garmin Connect** app
2. **More** (bottom-right) → **Settings** → **Health Connect** (may be under "Connected Apps" on some versions)
3. Tap **Data Permissions** and enable the metrics you want Garmin to write: Steps, Distance, Heart Rate, Sleep, Active Energy, Total Energy, Floors, Exercise, SpO2, HRV, VO2 Max, Resting HR
4. Tap **Allow** on the Health Connect prompt

### Recommended per-metric ownership

Health Connect priority + Garmin's per-metric toggles let you split ownership. Suggested setup if you wear both watches:

| Metric | Preferred owner | Why |
|---|---|---|
| Steps, distance | Whichever watch you wear more | Sum-type, needs one authoritative source |
| Sleep | Whichever watch you sleep with | Sleep tracking varies by device |
| HRV, VO2 Max | Garmin | Garmin's algorithms are the industry benchmark here |
| Resting HR | Either | Both are accurate |
| SpO2 | Either | Both use similar sensors |

Toggle unwanted writes OFF in the *other* app's Health Connect settings. Any records already in HC stay (Kage's origin filter handles them regardless).

### Same watch, two apps: don't panic

If you're using something like **Health Sync** to mirror Samsung → Garmin or vice versa, that mirrored data lands in HC under Health Sync's origin (not Samsung's or Garmin's). Kage ignores it entirely because it's neither of the two configured origins — no double-counting risk.
