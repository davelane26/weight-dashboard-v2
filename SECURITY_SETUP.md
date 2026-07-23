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
1. **Deploy the worker.** Paste the new `worker.js` into the Cloudflare
   dashboard editor (Workers & Pages -> `glucose-relay` -> Edit Code) and
   Save/Deploy.

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
