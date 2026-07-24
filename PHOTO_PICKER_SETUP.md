# Photo Picker Setup (Google Drive + Google Photos)

Both pickers need three values set in `index.html`:

```js
window.GOOGLE_OAUTH_CLIENT_ID = '...';
window.GOOGLE_API_KEY         = '...';
window.GOOGLE_APP_ID          = '...';   // = your Cloud project NUMBER
```

You already have a Firebase project (`weight-dashboard-6b5f3`) which sits on top
of a Google Cloud project. All of these values come from that same project.

---

## 1. Open the Google Cloud Console

<https://console.cloud.google.com/>

Top bar - make sure the project selector shows the Firebase project
`weight-dashboard-6b5f3` (or its display name).

## 2. Enable the APIs

Menu -> **APIs & Services** -> **Library**. Search and enable each:

- **Google Picker API**       (needed for Drive picker)
- **Google Drive API**        (needed to download the picked file)
- **Photos Picker API**       (needed for Google Photos picker)

## 3. Grab / create the OAuth 2.0 Client ID

Menu -> **APIs & Services** -> **Credentials**.

Under **OAuth 2.0 Client IDs** you should already see a "Web client (auto
created by Google Service)" that Firebase made. Click it.

- **Authorized JavaScript origins** - add:
  - `https://davelane26.github.io`
  - `http://localhost:8000`  (only if you preview locally)
- Copy the **Client ID** value (looks like `811571888069-xxx.apps.googleusercontent.com`).
  Paste into `GOOGLE_OAUTH_CLIENT_ID`.

## 4. Create the browser API Key

Same Credentials page -> **+ CREATE CREDENTIALS** -> **API key**.

- Once created, click the key to edit it.
- **Application restrictions**: HTTP referrers.
  - `https://davelane26.github.io/*`
  - `http://localhost:8000/*` (dev, optional)
- **API restrictions**: restrict to
  - Google Picker API
  - Google Drive API
  - Photos Picker API
- Copy the key value. Paste into `GOOGLE_API_KEY`.

## 5. Find the project number (App ID)

Menu -> **IAM & Admin** -> **Settings**. The **Project number** field is
`GOOGLE_APP_ID`. It's a plain integer like `811571888069`. (For your project
it's the same number you already see in `messagingSenderId` inside `auth.js`.)

## 6. Publish OAuth consent screen (only needed once)

Menu -> **APIs & Services** -> **OAuth consent screen**.

If it's still in "Testing" mode you can only sign in with test users. For a
personal dashboard that's fine - just add `djtwo6@gmail.com` under **Test
users** and you're done. No verification needed since you're the only user.

## 7. Commit + push

Once the three values are in `index.html`, commit and push. Try the
"From Drive" and "From Photos" buttons on each tile.

---

## Troubleshooting

- **`Picker not configured (missing ...)`** in the status line - you didn't
  fill in one of the three values.
- **"popup blocked - allow popups for this site"** - browser blocked the
  Photos picker popup. Allow popups for `davelane26.github.io`.
- **403 on Drive download** - you probably didn't enable the Drive API (step 2).
- **`invalid_client`** - the Client ID doesn't have `https://davelane26.github.io`
  in Authorized JavaScript origins (step 3).
- **Photos Picker returns nothing** - the Photos Picker API is newer; if it
  errors with 403 make sure it's enabled and your account is on the OAuth
  consent screen test-user list.
