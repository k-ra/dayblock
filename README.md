# dayblock

A quiet, local-first planner shown as a desk of notebooks.
I'm mainly making it for myself: timeblocking and quick notes without carrying a
physical planner. Everything saves in your browser, and optionally to a Google
account once cloud sign-in is set up ([Activate Google sign-in](CLOUD-SETUP.md)).

The September 2026 redesign follows the Claude Design handoff (desk system,
notebooks, quick notes). What changed or moved is listed in
[REMOVED-FEATURES.md](REMOVED-FEATURES.md); no stored entries were dropped.

## The desk

- **Shelf.** A pile of cloth books: planner, ideas, book log, morning pages,
  gratitude, recipes, and the day book binder. Hide any of them in settings.
  The **sticky file** sits under the pile.
- **Planner.** Day spread (or one page), week, and month on the same dated
  entries. Drag on the hours to draw a block; the highlighter palette pops up
  beside it. Move, resize, retitle, recolour, delete. Todos roll forward to
  today and keep their origin. Done, notes, a focus line, the habits line at
  the foot of each day, and a mini month. Week and month have their own focus
  and notes. On a phone, tap a day in the month to add a block, todo, or
  all-day note.
- **Ideas** (index + entry), **book log** (contents + a journal spread per
  book), **recipes** (contents, shopping list, ingredients that can go to
  today's todos, numbered method), **morning pages** (two pages a day, start
  time, words and minutes), **gratitude** (a five-part mood bar you paint, a
  year in pixels, morning and evening lists).
- **Day book.** A binder that gathers today's morning pages, schedule, and
  mood + gratitude, laid out to fit: two pages to a spread, a lone page on its
  own, or one at a time in page mode. The divider tabs flip between them.
  Everything you write there goes straight into those books.
- **Quick note.** In the bottom bar on every page: a clear sticky you write on
  and *put away*. Notes wait in the sticky file, just as you wrote them. Open
  the file to file a note into a book, move it, restore it, mark it done, or
  delete the sticky. Deleting a filed sticky leaves its notebook entry intact.
- **AI sorting (optional).** Settings → quick notes → *include quick notes with
  ai*, then connect Claude with an Anthropic API key. Each note's text alone is
  sent when you put it away and is filed into a book (a keyword fallback runs
  only if Claude fails). The key stays on that device; it is never synced or
  exported. The original words are always kept.
- **Settings** rise from the bottom; click outside to go back. From the shelf
  they are the full book: books on the shelf (tap the little spines), day book
  pages, quick notes, hours shown, week start, writing lines, your account,
  Google Calendar, backups. Inside a notebook they are a small card with the
  everyday few.
- **Desk** (the button above the paper). On wide screens, your loose stickies and
  a week index card sit on the desk beside the book. Phones hide them without losing them.
- Google Calendar (read-only) comes with Google sign-in: see
  [AUTH-HANDBOOK.md](AUTH-HANDBOOK.md) for the one-time setup.
- Export/import JSON backups. Imports keep existing entries.

## Try it

[Open it](https://k-ra.github.io/dayblock/) in your browser, or run it locally.
There is no build step and no package installation.

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Keyboard

- `←` and `→` move by day, spread, week, or month in the planner, and by day in
  gratitude, morning pages, and the day book, when you are not typing.
- `Esc` closes the quick note, the sticky stack, and popovers.

## Privacy and storage

Without sign-in, everything stays in this browser's `localStorage` under the
same key as before (`spread-planner.v1`), so existing notebooks open
unchanged. The first load after the redesign keeps one untouched copy of the
old notebooks at `dayblock.before-redesign.v1`. With cloud saving activated,
Firebase stores your notebooks under your own UID; see
[CLOUD-SETUP.md](CLOUD-SETUP.md). With AI sorting on, the text of each quick
note (and nothing else) goes to the Anthropic API using your own key. Calendar
events, access tokens, and the Claude key are never part of backups or cloud
sync. Keep exported backups; this early release should not be the only copy of
anything important.

## Project structure

```text
index.html          page structure
styles.css          desk, cloth, paper, loose paper; phone layout
app.js              state, migration, every notebook, shelf, settings, onboarding
quick-notes.js      quick-note sorting (Claude + keyword fallback) and filing
planner-layout.js   book-first sizing and reversible timeline geometry
google-calendar.js  read-only Calendar import and authorization
calendar-config.js  optional separate calendar client ID (empty; sign-in covers it)
firebase-config.js  public Firebase web configuration (no private keys)
firebase-adapter.js Google sign-in and revision-checked Firestore transactions
cloud-data.js       backup validation and content-preserving imports
cloud-sync.js       account isolation, device caches, sync conflicts
account.js          account window, sign-in and backup controls
firestore.rules     private-per-user rules to deploy in Firebase
```

IBM Plex Sans and Mono load from Google Fonts. The Anthropic SDK loads from
esm.sh only when AI sorting runs. Firebase and Google's authorization library
load only when configured.

## Tests

```bash
TZ=America/Los_Angeles node --test tests/*.test.cjs
```

These cover planner geometry, backup and merge, mocked cloud sync, synthetic
Calendar data, and quick-note sorting and filing. Real Google sign-in, Firestore
rules, and live Claude sorting still need checking once they are configured.
