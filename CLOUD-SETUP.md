# Activate Google sign-in and cloud notebooks

xuan journals stays on GitHub Pages. Firebase supplies Google sign-in and a private
Cloud Firestore document for each account. No custom server or client secret is
needed. The code is built, but the empty `firebase-config.js` deliberately keeps
cloud sign-in disabled until you complete this setup.

## 1. Protect the notebooks you already have

In the browser where you have been writing, open **settings** → data →
**export .json**. Keep that JSON file somewhere private.

Your current `file:///Users/kmo/Desktop/Hub/dayblock/index.html` preview has its
own browser storage. Google sign-in cannot run on that address. Export there
first; you will import the file on the live site in step 6. The app cannot read
another origin's storage automatically. Repeat for any other browser/address
with entries you want to keep.

## 2. Create a Firebase project and web app

1. Open the [Firebase console](https://console.firebase.google.com/) and create
   a project for xuan journals. You can reuse the Google Cloud project from your
   Calendar setup by adding Firebase to it.
2. Google Analytics is optional; xuan journals does not use it.
3. In Project settings → General → Your apps, add a **Web app** (`</>`).
   You do not need Firebase Hosting; GitHub Pages remains the website host.
4. Copy the web app's configuration values into `firebase-config.js`:

   ```js
   window.DAYBLOCK_FIREBASE_CONFIG = {
     apiKey: 'YOUR_WEB_API_KEY',
     authDomain: 'YOUR_PROJECT.firebaseapp.com',
     projectId: 'YOUR_PROJECT_ID',
     appId: 'YOUR_WEB_APP_ID',
   };
   ```

These web configuration values are intended to be public. Do **not** paste an
OAuth client secret, service-account JSON, or private key into the repository.
Security comes from Authentication and the Firestore rules, not hiding this
configuration. [Firebase web configuration](https://firebase.google.com/docs/web/setup),
[API-key guidance](https://firebase.google.com/docs/projects/api-keys).

## 3. Enable Google sign-in

1. Firebase console → Authentication → Get started → Sign-in method.
2. Enable **Google**, choose a support email, and save.
3. Authentication → Settings → Authorized domains: add `k-ra.github.io`.
   Enter only the hostname, not `https://` or `/dayblock/`.
4. For local testing, also add `localhost` and `127.0.0.1` if you use those
   addresses. Keep the existing Firebase auth-domain entries.

The app uses a Google popup. Allow popups when prompted. On a phone, use the
live site in Safari or Chrome rather than an embedded preview. Sign-in persists
through reloads in this tab; closing the tab ends the session. Signing in again
restores that account's notebooks. [Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin),
[session persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

## 4. Create and secure Firestore — do not skip the rules

1. Build → Firestore Database → Create database.
2. Choose **Standard edition**, database ID **(default)**, and a suitable region.
3. Start in **production mode**, not open test mode.
4. Open the Rules tab. Replace its contents with the complete contents of
   [`firestore.rules`](firestore.rules), then click **Publish**.
5. Do not add an `allow read, write: if true` rule. A broad allow elsewhere
   overrides the protection provided by the narrow account rules.

xuan journals stores each account at `users/GOOGLE_FIREBASE_UID/notebooks/main`.
The supplied rules permit only that signed-in UID to read or update its
document, validate the document fields, and require sequential revisions.
Other paths and document deletion are denied. No indexes need creating for
xuan journals's direct-document reads. [Create Firestore](https://firebase.google.com/docs/firestore/quickstart),
[user-owned data rules](https://firebase.google.com/docs/firestore/security/rules-conditions).

In the Rules Playground, check that an unauthenticated read is denied, a user
can read their own document, and a different UID cannot read it. Do this before
importing personal notebooks. These are database rules, not GitHub permissions.

## 5. Publish the configured code

Save `firebase-config.js`, then have me push this feature and that configuration
to the existing xuan journals repository. The Google sign-in button on GitHub Pages
will become available once that version deploys. Publishing website files does
**not** publish Firestore rules; step 4 must be done in Firebase separately.

For local testing, from the xuan journals folder run:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`, not the `file://` preview. Use the same address
consistently, since each origin has separate browser storage.

## 6. Import your browser notebooks and verify your phone

1. Open [xuan journals](https://k-ra.github.io/dayblock/).
2. If the entries were in your file preview, open **settings** → data →
   **import**, and select the JSON file from step 1. This combines it
   with any entries already on that website; it does not replace them.
3. In **settings**, click **sign in with google**, choose your account, then choose
   **Import browser notebooks** in xuan journals's prompt.
4. If the account already has cloud entries, both sets are kept. Conflicting
   entries can appear as separate copies; differing free-form day/month text
   is appended under an “Imported copy” marker. Review duplicates afterward.
   Importing the same unchanged backup again does not duplicate its entries.
5. Wait for **Saved to your account**. Open the live site on your phone, sign in
   with the same Google account, and choose **Keep browser copy separate** if
   you only want to open the cloud notebooks there.
6. Make a small test note on one device. On the other, use **settings → account → sync now**
   or return to the tab. Confirm it appears before relying on cloud storage.

## What sync does (and does not do)

- Saves every notebook (planner, ideas, book log, recipes, morning pages,
  gratitude), habits, quick notes, and stationery. Not the Claude API key.
- Autosaves after a short typing pause. Refreshes when returning to the tab,
  on reconnect, and about once a minute while visible. This is not live
  collaborative editing; finish syncing before switching devices.
- Keeps guest/browser notebooks separate from account notebooks. Signing out
  returns to the unchanged guest copy. Account edits do not overwrite it.
- Keeps account-specific device caches for offline edits and retry. If you
  close before syncing, sign in with the same account on that same browser to
  recover them. Do not clear browser storage while changes are pending.
- Rejects stale writes from another device instead of silently overwriting.
  The account window (settings → account) offers **Combine both copies** or **Load cloud copy**.
  Either option keeps one prior-device recovery snapshot; export it from the
  panel if needed. A later conflict replaces that recovery snapshot.
- Remembers page/spread choices per device; they are not synced.
- Does not upload Google Calendar events, access tokens, or credentials as
  notebook content. Calendar authorization remains a separate, optional
  read-only connection; see [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md).
- Has an 800 KB cloud-notebook limit, below Firestore's document limit. If
  reached, new edits remain on the device and the account panel asks you to
  export a backup; they are not silently discarded.

Firebase project administrators can access the database. This is private
account storage, **not end-to-end encryption**. Device caches and exported JSON
are not encrypted either. Use a trusted browser profile, not a shared/public
computer; signing out does not securely erase those local recovery copies.
Keep independent backups. There is no in-app account deletion yet: to delete
an account's cloud data, remove its notebook document and Authentication user
in the Firebase console, and clear the relevant browser caches separately.

## Usage, troubleshooting, and launch checks

Watch Firestore's Usage tab and your project's quotas. A typing pause can cause
one transaction/write, and periodic refreshes read the notebook document. Do
not enable paid billing just for this prototype unless you intend to; if you
choose a paid plan, configure budget alerts. Review the current
[Firestore limits](https://firebase.google.com/docs/firestore/quotas).

- **Button disabled:** config is empty, or you are opening `file://`.
- **Unauthorized domain:** add the exact hostname in Authentication settings.
- **Popup blocked:** allow popups and retry in a normal browser tab.
- **Missing/insufficient permissions:** publish the supplied rules in the same
  Firebase project named in `firebase-config.js`; check the default database.
- **Pending/offline:** keep the tab open, reconnect, then use Sync now.
- **Sync conflict:** export a backup before choosing one of the two resolutions.
- **Cloud copy not visible on another device:** confirm the same Google
  account, wait for the saved status, then use Sync now on the receiving device.

Before sharing widely, test two different Google accounts to confirm isolation,
two devices signed into one account, offline edits, a conflicting edit, and
backup export/import. The automated tests cover merge/sync behavior with mocked
storage, but real Google consent and deployed Firestore permissions still need
this configured-project verification. Consider Firebase App Check and abuse
monitoring before a broader public launch.

Developer checks: `TZ=America/Los_Angeles node --test tests/*.test.cjs`.
