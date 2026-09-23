# Features changed or removed in the Dayblock desk redesign

The September 2026 redesign (Claude Design handoff: desk system, notebooks, quick
notes) replaced some controls. Nothing here deleted stored data: every entry these
features created is still in `spread-planner.v1` and still shown somewhere. A copy
of the notebooks from before the redesign is kept once per browser at
`dayblock.before-redesign.v1`.

| Before | Now | Data |
|---|---|---|
| **Catchall** bar under every notebook (input + drawer, done/reopen) | **Quick note** pill in the bottom bar → clear sticky → *put away* into the **sticky file** under the book pile. Unsorted notes can still be marked done/reopened, or moved into a book. | Old catchall items were moved into `quickNotes` as unsorted notes, with their text, date and done flag. The catchall draft becomes the quick note draft. |
| **⋯ settings** strip in the bottom bar (show hours, work hours, hide past hours, + sticky note, Google Calendar) | **settings** spread at the back of the planner. Same options: hours shown, work hours, fold past hours, Google Calendar, plus new ones. | Same `settings` fields. |
| **Highlighter tray** in the margin (pick the pen colour for new blocks) | The palette pops up beside each new block (8 chalk highlighters). New blocks use the last colour chosen, starting with your favourite colour. The highlighter *set* (chalk / watercolor / pantone) is chosen in settings. | `settings.color` kept. The old tray item stays in `desk.items`, just not drawn. |
| **+ sticky note** (new sticky in the margin) | Use **quick note**. Existing margin stickies are still shown in the margin and can still be edited, recoloured, moved and removed. | Kept in `desk.items`. |
| Ten pastel highlighters (yellow, peach, pink, lilac, blue, sky, mint, green, grey) | Eight chalk highlighters (butter, dust rose, seafoam, periwinkle, bone, clay, slate, moss). | Old keys are drawn with the nearest chalk colour: yellow→butter, peach→clay, pink→rose, lilac/blue→periwinkle, sky→slate, mint→seafoam, green→moss, grey→bone. Keys are not rewritten. |
| Collapsible **habit** grid at the top of the right page (week of checkboxes, streaks) | **HABITS** line at the foot of each day page: tap a habit to mark that day; streak shown when you point at it. **edit** opens the weekly grid for adding, renaming and deleting. | `habits`, `habitLog` unchanged. |
| Bookshelf **sign in / backup** button (top right) | **settings → account / data**. The same account window opens from there. | Unchanged. |
| Phone day page **schedule / notes** tabs | One scrolling page: timeline, then todo, done and notes. | Unchanged. |
| Phone **month** grid with entries in cells | Dot calendar; tap a day to add a block, todo or all-day note. **open day** jumps to the page. On desktop, click the empty part of a month cell for the same sheet; the date opens the day. | Unchanged. |
| Stack of three large cloth volumes on the shelf | Pile of six labelled books (planner, ideas, book log, morning pages, gratitude, recipes) + day book binder + sticky file. Hide books in settings. | Unchanged. |
| Reading index "Open journal →" editor | Book log contents opens the journal spread directly. | Unchanged. |
| Idea status and reading status dropdowns | Plain-text choice rows (captured / exploring / making / done …). | Unchanged. |

## Trimmed from settings (kept working, just not listed)

Settings open as the full book only from the shelf; inside a notebook they are a
small card (hours shown, week start, writing lines) with a link to the rest.

- **Highlighter set** (chalk / watercolor / pantone) and **desk colour**: stay on
  chalk and paper grey. Saved choices still apply.
- **New blocks start in**: new blocks use the last colour you picked from the
  palette beside a block.
- **Fold past hours on today**: no longer switchable here. If it was on, the
  "earlier hours · show" band on today's page turns it off.
- **Margin** (now called **desk**): use the desk button above the paper.
- **Work hours** only appear when hours shown is *work* or *after work*.

## Not built yet (open in the handoff)

- **Stickers.** The onboarding prototype has a sticker sheet, but the sticker art and
  where the sheet lives are still open questions.
- **Picking and ordering day book pages** beyond the three on/off switches; left out on purpose to keep settings small.
