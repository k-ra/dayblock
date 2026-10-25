/* Writing laid across fixed pages. One or more entries (a day's morning pages,
   an idea's notes) run from page to page: when a page is full, the words carry
   onto the next one, and the next entry starts right below the last, under its
   own heading. A form feed (\f) inside an entry is a page turned on purpose.
   Measuring is the caller's: fits(i, pieces) says whether pieces fit on page i. */
(function (root) {
  'use strict';

  // How much of rest fits, ending after a space or line break when it can.
  // On a page that already holds something, 0 means "start on the next page".
  function take(rest, fitsWith, force) {
    if (fitsWith(rest)) return rest.length;
    let lo = 0, hi = rest.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fitsWith(rest.slice(0, mid))) lo = mid; else hi = mid - 1;
    }
    if (lo && /\s/.test(rest[lo])) return lo + 1;   // the space or break right after it hangs here
    const space = lo ? Math.max(rest.lastIndexOf(' ', lo - 1), rest.lastIndexOf('\n', lo - 1)) : -1;
    if (space >= 0) return space + 1;
    if (!force) return 0;
    if (lo) return lo;                               // one long word: break it
    const word = rest.search(/\s/);                  // nothing fits: the first word goes anyway
    return word < 0 ? rest.length : word + 1;
  }

  // items: [{ text, head }]. Each page is a list of pieces:
  // { item, seg, head, text, tail }. head marks an entry's first piece; tail is
  // a line break that ended the page, kept for the text but not shown.
  function paginate(items, fits, { min = 1, keep = [] } = {}) {
    const pages = keep.map(page => page.slice());
    let it = 0, pos = 0, seg = 0, started = false;
    if (pages.length) {
      const last = pages[pages.length - 1].at(-1);
      it = last.item; seg = last.seg; started = true;
      pos = join(pages, it).length;
    }
    let cur = [];
    const close = () => { pages.push(cur); cur = []; };
    for (let guard = 0; it < items.length && guard < 20000; guard++) {
      const text = items[it].text || '';
      if (started && pos >= text.length) { it++; pos = 0; seg = 0; started = false; continue; }
      if (started && text[pos] === '\f') {
        pos++; seg++;
        if (cur.length) close();
        // A turned page holds its first piece even when it is empty.
        cur.push({ item: it, seg, head: false, text: '', tail: false });
        if (pos >= text.length || text[pos] === '\f') continue;
        cur.pop();
      }
      const stop = text.indexOf('\f', pos);
      const end = stop < 0 ? text.length : stop;
      const rest = text.slice(pos, end);
      const base = { item: it, seg, head: !started && !!items[it].head };
      const fitsWith = s => fits(pages.length, [...cur, { ...base, text: s, tail: false }]);
      const n = take(rest, fitsWith, !cur.length);
      if (cur.length && (rest ? n === 0 : !fitsWith(''))) { close(); continue; }
      const slice = rest.slice(0, n);
      const tail = n < rest.length && slice.endsWith('\n');
      cur.push({ ...base, text: tail ? slice.slice(0, -1) : slice, tail });
      pos += n; started = true;
      if (pos < end) close();
    }
    if (cur.length) close();
    const last = pages.length ? pages[pages.length - 1].at(-1) : { item: 0, seg: 0 };
    while (pages.length < min) pages.push([{ item: last.item, seg: last.seg, head: false, text: '', tail: false }]);
    return pages;
  }

  // An entry's pieces in order, with where each starts in its text.
  function pieces(pages, item) {
    const out = [];
    let at = 0, prev = null;
    pages.forEach((page, p) => page.forEach((piece, q) => {
      if (piece.item !== item) return;
      if (prev && piece.seg !== prev.seg) at++;
      out.push({ p, q, piece, start: at });
      at += piece.text.length + (piece.tail ? 1 : 0);
      prev = piece;
    }));
    return out;
  }
  function join(pages, item = 0) {
    let out = '', prev = null;
    for (const { piece } of pieces(pages, item)) {
      if (prev && piece.seg !== prev.seg) out += '\f';
      out += piece.text + (piece.tail ? '\n' : '');
      prev = piece;
    }
    return out;
  }
  // Where page p, piece q, spot local sits in its entry's text.
  function offsetOf(pages, p, q, local) {
    const piece = pages[p][q];
    return pieces(pages, piece.item).find(x => x.p === p && x.q === q).start + local;
  }
  // The piece and spot for an offset in an entry. A spot on the line between two
  // pages stays at the end of the first, unless a line break ended it.
  function locate(pages, item, offset) {
    const list = pieces(pages, item);
    for (const { p, q, piece, start } of list) {
      if (offset <= start + piece.text.length) return { p, q, local: Math.max(0, offset - start) };
    }
    const end = list[list.length - 1];
    return end ? { p: end.p, q: end.q, local: end.piece.text.length } : { p: 0, q: 0, local: 0 };
  }

  const api = { paginate, join, offsetOf, locate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockPageFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
