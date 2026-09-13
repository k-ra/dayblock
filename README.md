# Dayblock — early local prototype

A quiet, local-first planner for stationery lovers. I'm mainly making Dayblock for myself: timeblocking and quick notes without carrying a physical planner. You can separate work hours from after-work hours, plan across two facing days, and keep everything on your own device.

Fun stickers, more journaling features, weekly summaries, flexible weekly and monthly views, Google Calendar integration, and usability polishes incoming.

## What it does

- Draw, move, resize, label, and recolor time blocks across two facing pages.
- Type natural shorthand such as `lunch 12–1`, `standup 9:30`, or
  `gym 10pm–12`; text without a time becomes a todo.
- Roll unfinished todos forward automatically while preserving their origin.
- Record daily deliverables and free-form notes.
- Track weekly habits and current streaks.
- Switch among all hours, work hours, and off hours without deleting hidden
  events.
- Arrange highlighters, an index card, and sticky notes around the book.
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

- `/` focuses today's quick-entry line.
- `←` and `→` move between two-day spreads when you are not editing text.
- `Enter` submits a quick entry.

## Privacy and storage

Dayblock has no account, server, analytics, or database. Planner content is saved
to this browser's `localStorage`; it never leaves the device through the app.
Clearing browser storage will erase it, so this early release should not be the
only copy of anything important.

## Project structure

```text
index.html   page structure and controls
styles.css   book, paper, stationery, and responsive layout
app.js       planner state, interactions, parsing, and local persistence
```

The only network request is for IBM Plex Sans and IBM Plex Mono from Google
Fonts. System-font fallbacks are used when offline.

## Status

The core planner is usable today. Export/import, accessibility review, automated
interaction tests, and stronger mobile behavior would make sensible next
milestones.
