# Dayblock — early local prototype

A quiet, local-first planner for stationery lovers. I'm mainly making Dayblock for myself: timeblocking and quick notes without carrying a physical planner. You can separate work hours from after-work hours, plan across two facing days, and keep everything on your own device.

Open a book from the bookshelf: the daily planner, ideas notebook, or reading log.
The planner has day, week, and month views sharing the same dated entries.

Each reading entry opens a two-page journal. Book details stay synced with the
index. Like a book with the heart, and optionally mark Recommend? and Reread?
yes or no (tap the selected answer again to clear it). The left page holds first
impressions, summary, and takeaways; the right holds final thoughts and unstructured
notes that expand for long writing. Existing index notes appear in that notes area.
Entries save automatically in this browser. Desktop starts with a spread and
stationery margin; phones start with a single page and no margin. Page/spread
choices are remembered separately for desktop and phone, independently of day,
week, and month. The complete seven-day week fits one
page, including on phones: hour rows resize to the available height, with a
shared time gutter and notes for every day. Tap a small block to edit its details.
Month also fits the screen; its notes and longer writing sections have their own
tabs in page mode. Controls sit below the paper; additional planner settings are
under the ellipsis button.

## What it does

- Draw, move, resize, label, and recolor time blocks across two facing pages.
- Roll unfinished todos forward automatically while preserving their origin.
- Record daily deliverables and free-form notes.
- Track weekly habits and current streaks.
- Keep one shared catchall at the bottom of every notebook. Drafts and saved
  notes persist; mark an item done or reopen it without deleting it.
- Import a primary Google calendar read-only after the app's one-time OAuth
  configuration. See [Google Calendar setup](GOOGLE-CALENDAR.md).
- Switch among all hours, work hours, and off hours without deleting hidden
  events.
- Toggle a desktop stationery margin for highlighters, an index card, and
  sticky notes. New notes dock beside the book until dragged onto the paper.
  Phones hide the margin and its controls without losing the desktop preference
  or any notes.
- Jump between days with the mini calendar or arrow keys.

## Try it locally

[Open Dayblock](https://k-ra.github.io/dayblock/) in your browser, or run it locally:

There is no build step and no package installation.

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

You can also open `index.html` directly. Serving the folder is recommended so
the browser treats it like an ordinary website.

## Keyboard

- `←` and `→` move by the current day, spread, week, or month when not editing text.

## Privacy and storage

Dayblock has no planner account, server, analytics, or database. Planner content
is saved to this browser's `localStorage`; it is not uploaded by the app.
The optional Google connection reads the visitor's own calendar and caches its
events separately in that browser. Authorization tokens stay in memory only.
Clearing browser storage will erase it, so this early release should not be the
only copy of anything important.

## Project structure

```text
index.html   page structure and controls
styles.css   book, paper, stationery, and responsive layout
app.js       planner state, interactions, and local persistence
favicon.svg  the little notebook site icon
calendar-config.js  public app OAuth client ID (no secret)
google-calendar.js  read-only import and authorization
```

The site loads IBM Plex Sans and IBM Plex Mono from Google Fonts, with system
fallbacks offline. When a Google client ID is configured, it also loads Google's
authorization library. Calendar API requests run only after authorization.

## Status

The per-day magic entry line is removed. The bottom catchall is deliberately
unsorted and shared; it does not guess times or route text into other notebooks.

Run `TZ=America/Los_Angeles node --test tests/google-calendar.test.cjs` for the
synthetic Calendar import tests. Live Google sign-in still needs OAuth setup.

The core planner is usable today. Export/import, accessibility review, automated
interaction tests, and stronger mobile behavior would make sensible next
milestones.
