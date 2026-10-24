/* Writing laid across fixed pages. A body of text runs from page to page: when a
   page is full, the words carry onto the next one. A form feed (\f) is a page
   the writer turned on purpose, so what follows starts on a fresh page.
   Measuring is the caller's: fits(i, text) says whether text fits on page i. */
(function (root) {
  'use strict';

  // How much of rest fits on page i, ending after a space or line break when it can.
  function take(i, rest, fits) {
    if (fits(i, rest)) return rest.length;
    let lo = 0, hi = rest.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(i, rest.slice(0, mid))) lo = mid; else hi = mid - 1;
    }
    if (/\s/.test(rest[lo])) return lo + 1;   // the space or break right after it hangs here
    const space = lo ? Math.max(rest.lastIndexOf(' ', lo - 1), rest.lastIndexOf('\n', lo - 1)) : -1;
    if (space >= 0) return space + 1;
    if (lo) return lo;                         // one long word: break it
    const word = rest.search(/\s/);            // nothing fits: the first word goes anyway
    return word < 0 ? rest.length : word + 1;
  }

  // Each page: { seg, text, tail }. seg counts the turned pages; tail is a line
  // break that ended the page, kept for the text but not shown.
  function paginate(text, fits, { min = 1, keep = [] } = {}) {
    text = text || '';
    const pages = keep.slice();
    let pos = join(keep).length;
    let seg = keep.length ? keep[keep.length - 1].seg : 0;
    let fresh = !keep.length;
    for (let guard = 0; guard < 5000; guard++) {
      if (text[pos] === '\f') { seg++; pos++; fresh = true; continue; }
      if (pos >= text.length && !fresh) break;
      const stop = text.indexOf('\f', pos);
      const rest = text.slice(pos, stop < 0 ? text.length : stop);
      const n = take(pages.length, rest, fits);
      const slice = rest.slice(0, n);
      const tail = n < rest.length && slice.endsWith('\n');
      pages.push({ seg, text: tail ? slice.slice(0, -1) : slice, tail });
      pos += n; fresh = false;
    }
    const last = pages[pages.length - 1].seg;
    while (pages.length < min) pages.push({ seg: last, text: '', tail: false });
    return pages;
  }

  // Where each page starts in the whole text.
  function starts(pages) {
    const out = [];
    let at = 0;
    pages.forEach((p, i) => {
      if (i && p.seg !== pages[i - 1].seg) at++;
      out.push(at);
      at += p.text.length + (p.tail ? 1 : 0);
    });
    return out;
  }
  function join(pages) {
    return pages.map((p, i) => (i && p.seg !== pages[i - 1].seg ? '\f' : '') + p.text + (p.tail ? '\n' : '')).join('');
  }
  const offsetOf = (pages, i, local) => starts(pages)[i] + local;
  // The page and spot for an offset in the whole text. A spot on the line between
  // two pages stays at the end of the first, unless a line break ended it.
  function locate(pages, offset) {
    const s = starts(pages);
    for (let i = 0; i < pages.length; i++) {
      if (offset <= s[i] + pages[i].text.length) return { i, local: Math.max(0, offset - s[i]) };
    }
    const i = pages.length - 1;
    return { i, local: pages[i].text.length };
  }

  const api = { paginate, join, offsetOf, locate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockPageFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
