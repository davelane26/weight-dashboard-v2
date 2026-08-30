# Login & Data Security Setup

Two-layer auth for David's Health Board. Read this before deploying.

## The threat model
GitHub Pages is **public**. A client-side login gates the *UI* but cannot
protect *data* that lives at a public URL. So we do two things:

- **Fix #1 (UI gate):** Firebase Google sign-in + email allow-list. Stops
  casual/anonymous access and locks the UI to your account(s).
- **Fix #2 (data lock):** serve weight data from the Cloudflare Worker,
  gated by a verified Firebase ID token. This is the real lock.

Fix #1 alone does NOT protect the data. You need Fix #2 (and to delete the
public `data.json`) for that.

---

## Fix #1 -- Email allow-list (client)
File: `auth.js`

```js
const ALLOWED_EMAILS = [
  'your-real-email@gmail.com',   // <-- put YOUR google email here
];
```

- While the placeholder `REPLACE_WITH_...` is present, it **fails open**
  (anyone can sign in) and logs a red console warning -- so you can't lock
  yourself out before configuring it.
- Once you set your real email, everyone else is auto-signed-out with
  "That account isn't authorized for this dashboard."

---

## Fix #2 -- Token-gated data (worker)
Files: `cloudflare-worker/worker.js`, `app.js`, `index.html`,
`cloudflare-worker/migrate_weight.py`

### Steps
1. **Deploy the worker.** Automatic as of Aug 2026 — pushing any change to
   `cloudflare-worker/**` on `main` triggers `.github/workflows/deploy-worker.yml`,
   which runs `wrangler deploy` for you (see `cloudflare-worker/wrangler.toml`
   for the bindings config, and the repo's `CLOUDFLARE_API_TOKEN` /
   `CLOUDFLARE_ACCOUNT_ID` secrets for auth). No more manual paste-into-the-
   dashboard step — if a push doesn't show up live, check the Action's run
   log instead of assuming you forgot to deploy by hand.

2. **Set the allow-list on the worker.** In the worker's Settings ->
   Variables, add:
   ```
   ALLOWED_EMAILS = your-real-email@gmail.com
   ```
   (comma-separate for multiple.) If unset, the worker **fails closed** --
   `/weight.json` returns 401 for everyone. That's intentional.

   `FIREBASE_PROJECT_ID` is hard-coded to `weight-dashboard-6b5f3` in the
   worker; change it there if the project ever changes.

3. **Seed the data.** Run the migration once:
   ```powershell
   $env:API_SECRET="<your worker API_SECRET secret>"
   uv run --with requests python cloudflare-worker/migrate_weight.py
   ```

4. **Verify.** Load the dashboard signed in as an allowed user -- the
   console should show data loading from the worker. Signed out (or as a
   non-allowed user) it should show nothing.

5. **Close the leak.** Once confirmed, **delete the public
   `data.json`** in the `Weight-tracker` repo. After this, the public
   fallback in `app.js` stops returning data and the worker is the sole,
   authenticated source.

### Keeping the worker data fresh
Your existing openScale/sync pipeline writes the public `data.json`. To keep
the worker copy current, that same pipeline must also `POST /weight` (bare
array or `{data:[...]}`) with the `API-SECRET` header -- same pattern as the
Garmin/Exist pushes. Until that's wired, re-run `migrate_weight.py` to
refresh, or keep the public JSON as the source and let the fallback serve it
(NOT recommended long-term -- that's the leak).

---

## How token verification works (worker)
- Client sends `Authorization: Bearer <firebase-id-token>`.
- Worker fetches Google's public JWK set (cached per `cache-control`),
  verifies the RS256 signature with WebCrypto, and checks `aud`/`iss`/`exp`.
- Then it enforces `ALLOWED_EMAILS`. No match -> 401.
- No external dependencies; pure WebCrypto.

---

## Adding a second person (their own, isolated data)

As of the multi-user work, `weight.json`, `/weight/add`, `/profile`,
`/photo`, and `/workout-schedule` are namespaced per signed-in user (see
`nsKey()` in `cloudflare-worker/worker.js`) — David keeps the original,
unnamespaced KV keys (zero migration needed), and anyone else gets their
own `<key>:<their-email>` entries, completely separate from his.

To let someone else in:

1. **Add their email in two places** (both required — separate systems):
   - `auth.js` → `ALLOWED_EMAILS` array (gates the page UI).
   - The Worker's `ALLOWED_EMAILS` **Secret**, comma-separated (gates the
     data endpoints — Settings → Variables and Secrets, type must stay
     `Secret`, see the warning at the top of `worker.js`).
2. They sign in with Google. Since they have no saved profile yet, the
   dashboard shows a **"Set Up Your Profile"** prompt (height, starting
   weight/date, optional goal) — this replaces the hardcoded
   `START_WEIGHT`/`START_DATE`/`HEIGHT_IN` constants in `app-config.js`,
   which stay exactly as-is and apply only to David.
3. They log weigh-ins from `add-weighin.html` → **"💾 Save to Your
   Dashboard"** card (Firebase-token gated, hits the Worker directly —
   no GitHub PAT, since they don't have write access to David's private
   `Weight-tracker` repo). David's own GitHub-token path is unchanged,
   tucked under a collapsed "legacy path" section on that page.

### Known limitation: Activity tab stays shared
`health.json` (steps/sleep/HR/etc.) is **not** namespaced. It's fed by
API_SECRET-authenticated device pipelines tied to David's own hardware —
the Samsung Health bridge on his home PC and the Kage Android app on his
phone (see `CLAUDE.md`'s "Activity data" section) — neither of which
carries a per-user identity today. Giving a second person their own
Activity data would mean either they run their own instance of one of
those pipelines pointed at a new per-user endpoint, or the ingestion
clients start sending a user id — both out of scope here. Their Weight,
Charts, Goal/Projector, Photos, and Workout Schedule tabs are fully
isolated and correct; Activity currently still shows David's data
regardless of who's signed in.
