# Google Calendar: one-time app setup

Dayblock imports each visitor's own **primary Google calendar**, read-only.
Visitors click Connect and authorize their own account. They do not provide
client IDs, API keys, passwords, or client secrets.

**Calendar access now comes with Google sign-in.** The sign-in popup asks for
read-only calendar access alongside your account, and the planner imports your
events right away. The only setup is in the same Google Cloud project as Firebase:
enable the Google Calendar API, and add the scope
`https://www.googleapis.com/auth/calendar.events.owned.readonly` under Google Auth
Platform → Data access. See [AUTH-HANDBOOK.md](AUTH-HANDBOOK.md), step 2.

Google's access tokens last about an hour. After that, imported events stay, and
**settings → google calendar → refresh** opens Google's window briefly for a new
token. No write scopes are requested and no client secret is used.

*Optional, older route:* a separate calendar-only OAuth web client. Put its public
client ID in `calendar-config.js`, and add `https://k-ra.github.io` (and
`http://localhost:8000` for local use) as authorized JavaScript origins. With that
ID set, the calendar uses its own Connect button instead of sign-in.

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
- Calendar events are never stored in your account or backups; each device imports them itself.

## Verification

Run `TZ=America/Los_Angeles node --test tests/google-calendar.test.cjs`.
These tests use synthetic events and mocked Google responses, not a real account.
Live consent and import must still be tested after configuring the OAuth client.
