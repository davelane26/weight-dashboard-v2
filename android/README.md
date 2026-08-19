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

- [x] Phase 1: Scaffolding + steps-only
- [ ] Phase 2: HR, sleep, workouts, calories
- [ ] Phase 3: Polish (retry logic, error notifications, dashboard live tile)
