# Auth handbook

You've already made the Firebase project, so this starts from there. There's
one project for everything and one sign-in: **Google sign-in also brings your
calendar**, read-only. There's no separate calendar client to set up.
The existing Firebase project is still named `xuan-journal` internally; keep
using it. A new project or web app would not contain your current cloud notebooks.

| What you get | Where it's set up | What you paste |
|---|---|---|
| **Sign in + notebooks synced** between laptop and phone | Firebase console | four values into `firebase-config.js` |
| **Google Calendar** on the planner (comes with sign-in) | Google Cloud console, same project | nothing |
| **Claude** sorting your quick notes | Anthropic console, then settings on each device | the key, in the app only |

The Firebase values are public by design; security comes from sign-in and the
database rules. Never paste a client secret, service-account file, or private
key into the repo. The Claude key is the only secret, and it never enters the repo.

---

## 0. Protect what you have

- [ ] On the **live site as it is now**, open the bookshelf → **settings** →
      **backups** → **export .json**. Keep the file somewhere private.
- [ ] Do the same anywhere else you've written entries (e.g. the `file:///…` preview).

## 1. Firebase: sign-in and cloud save

In the [Firebase console](https://console.firebase.google.com/), open your project.

- [ ] **Project settings (gear) → General → Your apps → `</>` Web.** The
      existing web app is already configured; its nickname can stay as it is.
      Do not register a second one for the Dayblock rename.
- [ ] For a fresh installation only, copy the four values it shows into `firebase-config.js`:
  ```js
  window.DAYBLOCK_FIREBASE_CONFIG = {
    apiKey: '…',
    authDomain: '….firebaseapp.com',
    projectId: '…',
    appId: '…',
  };
  ```
  (Or paste the whole snippet to me and I'll fill it in.)
- [ ] **Build → Authentication → Get started → Sign-in method → Google →
      Enable.** Choose your email as the support email. Save.
- [ ] **Authentication → Settings → Authorized domains → Add domain:**
      `k-ra.github.io`. `localhost` is usually already there.
- [ ] **Build → Firestore Database → Create database.** Standard edition,
      `(default)` ID, a region near you, **production mode**.
- [ ] **Firestore → Rules:** delete what's there, paste all of
      [`firestore.rules`](firestore.rules), then **Publish**.
- [ ] Optional sanity check in **Rules Playground**: a read of
      `users/abc/notebooks/main` should be **denied** when unauthenticated and
      **allowed** when authenticated as UID `abc`.

## 2. Calendar: two switches and your name on the sign-in screen

Firebase made a Google Cloud project behind the scenes, with the same name.
Open the [Google Cloud console](https://console.cloud.google.com/) and **pick
that project in the picker at the top**.

- [ ] **APIs & Services → Library →** search "Google Calendar API" → **Enable.**
- [ ] **Google Auth Platform → Branding:** app name **Dayblock**, your
      email for support and developer contact. Save. (Firebase may have
      filled in a project ID here; this is the name Google shows when you sign in.)
- [ ] **Google Auth Platform → Audience:** leave it on **Testing**, then under
      **Test users** add your Google account (and anyone else who'll sign in).
- [ ] **Google Auth Platform → Data access → Add or remove scopes:** add
      `https://www.googleapis.com/auth/calendar.events.owned.readonly` → Update → Save.

That's all the calendar needs. No client ID, and no web addresses to list.

## 3. Publish and sign in

- [ ] Tell me when `firebase-config.js` is filled in, and I'll commit and push
      everything. Give GitHub Pages a minute to update.
- [ ] Open the live site. Onboarding's **sign in with Google** (or shelf →
      **settings → you → sign in with google**) opens Google's window.
- [ ] Google may say **"Google hasn't verified this app."** That's expected while
      the app is in Testing: **Continue**. Make sure the **calendar** box is ticked.
- [ ] Choose **import browser notebooks.** It combines your browser's notebooks
      with your account and keeps everything from both.
- [ ] If step 0's backup came from another address: **settings → backups →
      import**.
- [ ] Your calendar appears on the planner in periwinkle straight away.

**About the hour:** Google's calendar permission lasts about an hour. After
that your events stay on the page, and **settings → google calendar → refresh**
pops Google up briefly to pull new ones. Also, sign-in ends when you close the
tab. If you'd rather stay signed in, tell me and I'll change it; it's one line.

## 4. Claude (sorting quick notes)

- [ ] [Anthropic console](https://console.anthropic.com/) → **API keys** → create
      one named "Dayblock".
- [ ] **Billing → Limits:** set a small monthly limit. A sorted note costs a
      fraction of a cent.
- [ ] On each device: shelf → **settings → quick notes** → turn on **include
      quick notes with ai** → paste the key → **connect claude →**.
- [ ] Test it: put away `call mom at 5`. It should land on today at 5:00 PM, and
      the sticky should say **FILED UNDER PLANNER · TIME BLOCK**.

The key stays in that browser only. It's never synced and never in a backup.
Only a note's own words are sent, one note at a time. If a device is lost,
revoke the key in the console.

## 5. Final checks

- [ ] Write something on your laptop. Sign in on your phone with the same
      account and confirm it's there.
- [ ] Sign in with a second test account: it should see **empty** notebooks.
- [ ] Export a fresh backup now that everything is connected.

---

## If something goes wrong

| You see | Fix |
|---|---|
| Settings say "google sign-in isn't set up yet" | `firebase-config.js` is empty, or you opened a `file://` preview. Use the live site or `http://localhost:8000`. |
| Popup closes with "unauthorized domain" | Add the exact hostname in Firebase → Authentication → Settings → Authorized domains. |
| Popup blocked | Allow popups for the site. On a phone, use Safari or Chrome, not an in-app browser. |
| "Access blocked" or "app not verified" with no Continue button | Your account isn't a **Test user** (step 2), or the calendar scope isn't added. |
| "Missing or insufficient permissions" | The rules weren't published, or the config points at a different project. |
| Calendar says "calendar access wasn't allowed" | The calendar box wasn't ticked in Google's window. Tap **refresh** and tick it. |
| Calendar says "refresh to update your calendar" | The hour ran out. Tap **refresh**. |
| Calendar 403 even with the box ticked | The Google Calendar API isn't enabled in *this* project (step 2). |
| "Sync conflict" | Two devices edited at once. Export a backup, then choose **combine both copies**. |
| Quick notes say "sorted by keywords" | Claude couldn't be reached (key, credit, or offline). The note was still filed; check the key and limit. |

More background: [CLOUD-SETUP.md](CLOUD-SETUP.md) (how sync behaves, privacy,
limits) and [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md).
