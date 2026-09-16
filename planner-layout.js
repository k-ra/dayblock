/* Pure planner geometry: the book gets space before the stationery does. */
(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function fitBook({ width, paperHeight, single, phone, marginRequested }) {
    const available = Math.max(0, width - (phone ? 16 : 40));
    const leaf = clamp(paperHeight * .78, 460, 600);
    const preferred = leaf * (single ? 1 : 2);
    const bookWidth = phone ? available : Math.min(available, preferred);
    const rail = 232;
    // Never reduce the paper to accommodate the margin. It uses spare space.
    const margin = !phone && marginRequested && available >= bookWidth + rail + 24;
    return { width: bookWidth, margin, rail };
  }

  function timeline({ view = 'all', workStart = 9, workEnd = 18, hidePast = false,
    today = false, now = 0, weekly = false, paperHeight = 600 }) {
    const dayStart = 8, dayEnd = 24, gapHeight = 26;
    // Keep the current hour intact. Weekly columns retain their common axis.
    const start = hidePast && today && !weekly ? clamp(Math.floor(now), dayStart, 23) : dayStart;
    let parts = view === 'work'
      ? [['gap', dayStart, workStart], ['seg', workStart, workEnd], ['gap', workEnd, dayEnd]]
      : view === 'off'
        ? [['seg', dayStart, workStart], ['gap', workStart, workEnd], ['seg', workEnd, dayEnd]]
        : [['seg', dayStart, dayEnd]];
    parts = parts.map(([type, from, to]) => [type, Math.max(start, from), to]).filter(([, from, to]) => to > from);
    if (start > dayStart) parts.unshift(['past', dayStart, start]);
    const visible = parts.filter(([type]) => type === 'seg').reduce((sum, [, from, to]) => sum + to - from, 0);
    const gaps = parts.filter(([type]) => type !== 'seg').length;
    const target = weekly ? Math.max(80, Math.min(560, paperHeight * .56, paperHeight - 250)) : Math.max(160, paperHeight - 150);
    // Folding a late evening should not turn two hours into enormous boxes.
    const pph = Math.min(72, Math.max(6, (target - gaps * gapHeight) / (visible || 1)));
    let y = 0;
    const items = parts.map(([type, from, to]) => {
      const h = type === 'seg' ? (to - from) * pph : gapHeight;
      const item = { type, from, to, y, h };
      y += h;
      return item;
    });
    return { items, pph, height: y, start };
  }

  function timeToY(time, layout) {
    for (const item of layout.items) {
      if (time >= item.from && time <= item.to) return item.y + (time - item.from) / (item.to - item.from) * item.h;
    }
    return time < layout.items[0].from ? 0 : layout.height;
  }
  function yToTime(y, layout) {
    for (const item of layout.items) {
      if (y >= item.y && y <= item.y + item.h) {
        if (item.type !== 'seg') return y - item.y < item.h / 2 ? item.from : item.to;
        return item.from + (y - item.y) / layout.pph;
      }
    }
    return y < 0 ? layout.start : 24;
  }
  const api = { fitBook, timeline, timeToY, yToTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
