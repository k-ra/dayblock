# Google Calendar: one-time app setup

Dayblock imports each visitor's own **primary Google calendar**, read-only.
Visitors click Connect and authorize their own account. They do not provide
client IDs, API keys, passwords, or client secrets.

The connection is implemented but cannot sign in until the app owner configures
a Google OAuth web client:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select
   a project and enable the Google Calendar API.
2. Configure Google Auth Platform branding and audience for Dayblock. Use an
   external audience if people outside your Workspace organization will use it.
3. Add the read-only scope
   `https://www.googleapis.com/auth/calendar.events.owned.readonly`.
   No write scopes are requested.
4. Create an OAuth client of type **Web application**. Add
   `https://k-ra.github.io` as an authorized JavaScript origin (no `/dayblock/`
   path). For local development, also add `http://localhost:8766` and use that
   exact address. A `file://` preview cannot run Google OAuth.
5. Put the public client ID in `calendar-config.js` and deploy. Do not add a
   client secret: this browser-only flow doesn't use one.
6. While the OAuth app is in Testing, add permitted test users in Google Cloud.
   For broader use, publish the OAuth app and complete any verification Google
   requires for the requested scope. Publishing to GitHub alone does not make
   Google authorization available to everyone.

See Google's [client setup guide](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
and [token model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Behavior and privacy

- Only GET requests fetch events. Google events cannot be dragged, edited,
  recolored, or deleted inside Dayblock; clicking one opens a read-only detail.
- Imports include the displayed month plus the adjacent months, recurring
  instances, all-day events, and multi-day events. Times use the browser's local
  timezone. Events before the planner's 8 am start appear as day labels.
- Each successful refresh replaces the complete imported window, so deleted
  events disappear and repeated refreshes do not create duplicates. A failed
  refresh leaves the last successful import in place.
- Imported records are separate from hand-written planner entries. They are
  cached in that browser, never checked into GitHub or sent to a Dayblock server.
- Access tokens stay in memory, not localStorage or files. A reload or expired
  token requires a Connect/Reconnect click. Returning to an open tab and
  navigating to a new month refresh automatically while authorization is valid.
- Disconnect clears only the imported Google cache in this browser. To revoke
  Google's grant too, use your [Google account connections](https://myaccount.google.com/connections).
- This is calendar authorization, not a Dayblock account or cross-device sync.

## Verification

Run `TZ=America/Los_Angeles node --test tests/google-calendar.test.cjs`.
These tests use synthetic events and mocked Google responses, not a real account.
Live consent and import must still be tested after configuring the OAuth client.
