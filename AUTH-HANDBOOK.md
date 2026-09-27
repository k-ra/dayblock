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
| **AI** sorting your quick notes | 50 free sorts after sign-in; optional personal Claude or OpenAI key | a key entered once in settings |

The Firebase values are public by design; security comes from sign-in and the
database rules. Never paste a client secret, service-account file, or private
key into the repo. A personal AI key never enters the repo or notebook backups.

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

## 2. Google's sign-in screen, and opening it to everyone

Firebase made a Google Cloud project behind the scenes, with the same name.
Open the [Google Cloud console](https://console.cloud.google.com/) and **pick
that project in the picker at the top**.

- [ ] **Google Auth Platform → Branding:** app name **Dayblock**, your email for
      support and developer contact. Save. Skip the logo: an uploaded logo makes
      Google review your branding before anyone else can sign in.
- [ ] **APIs & Services → Library →** search "Google Calendar API" → **Enable.**
      (Only used by people who tap **connect calendar**.)
- [ ] **Google Auth Platform → Data access:** if the calendar scope
      (`…/auth/calendar.events.owned.readonly`) is listed, **remove it** and save.
      Dayblock asks for it only when someone connects their calendar; keeping it
      off this list lets you publish without Google's verification.
- [ ] **Google Auth Platform → Audience → Publish app** (Testing → In
      production). Now anyone can sign in, without being added as a test user.

**Signing in** asks Google only for a name and email, so friends see no
warning. **Connecting a calendar** is optional (settings → you → google
calendar → connect). It's a sensitive permission, so until Dayblock is verified
by Google, people who connect see "Google hasn't verified this app" → **Advanced
→ continue**, and Google limits unverified calendar access to 100 people.

## 3. Publish and sign in

- [ ] Tell me when to commit and push, and give GitHub Pages a minute to update.
- [ ] Open the live site. Onboarding's **sign in with Google** (or shelf →
      **settings → you → sign in with google**) opens Google's window.
- [ ] If this browser has pages your account doesn't, a small card asks whether
      to bring them in. Answer once; it won't ask again on this browser.
- [ ] If step 0's backup came from another address: **settings → backups →
      import**.
- [ ] For your calendar: **settings → you → google calendar → connect**, and
      tick the calendar box in Google's window.

**About the hour:** Google's calendar permission lasts about an hour. After
that your events stay on the page, and **settings → google calendar → refresh**
pops Google up briefly to pull new ones. Sign-in itself stays on in that browser
until you sign out, so each morning Dayblock just says welcome back and opens today.

**The import question comes once.** The first time you sign in on a device that
already has pages, a small card asks whether to bring them into your account.
Whatever you answer, it won't ask again for that account on that device. A brand-new
browser with nothing in it is never asked.

## 4. AI sorting (quick notes)

- [ ] Sign in with Google, then turn on **include quick notes with ai** under
      shelf → **settings → quick notes**. The first 50 sorts are free.
- [ ] Optional: create a personal key in the Anthropic or OpenAI console, set a
      small provider spending limit, and paste it into **settings → quick notes**.
      You only need to connect it once for your account.
- [ ] Test it: put away `call mom at 5`. It should land on today at 5:00 PM, and
      the sticky should say **FILED UNDER PLANNER · TIME BLOCK**.

The key is stored in a separate Firestore document, not in browser storage or
the notebook. Firestore rules deny browser reads of that document; the Firebase
Function reads it to sort a note. Only that note's words are sent to the AI
provider, one at a time. If needed, revoke the key in the provider console.
Deploy `functions` and `firestore.rules` from this repo for this flow to work;
publishing GitHub Pages alone does not deploy them.

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
| Calendar says "calendar access wasn't allowed" | The calendar box wasn't ticked in Google's window. Tap **connect** again and tick it. |
| Calendar says "refresh to update your calendar" | The hour ran out. Tap **refresh**. |
| Calendar 403 even with the box ticked | The Google Calendar API isn't enabled in *this* project (step 2). |
| "Sync conflict" | Two devices edited at once. Export a backup, then choose **combine both copies**. |
| Quick notes say "sorted by keywords" | The server or provider could not sort the note, or free sorts are exhausted. The note was still filed; check the key, provider limit, and Firebase Function deployment. |

More background: [CLOUD-SETUP.md](CLOUD-SETUP.md) (how sync behaves, privacy,
limits) and [GOOGLE-CALENDAR.md](GOOGLE-CALENDAR.md).
