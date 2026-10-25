const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate, join, offsetOf, locate } = require('../page-flow.js');

// A page holds `size` characters; an entry's heading takes up `head` of them.
const room = (size, head = 0) => (i, pieces) => pieces.reduce((n, p) => n + p.text.length + (p.head ? head : 0), 0) <= size;
const one = text => [{ text }];
const texts = pages => pages.map(page => page.map(p => p.text));

test('writing that fills a page carries whole words to the next', () => {
  const pages = paginate(one('one two three four'), room(10));
  assert.deepEqual(texts(pages), [['one two '], ['three four']]);
  assert.equal(join(pages), 'one two three four');
});
test('a line break at the end of a page is kept but not shown', () => {
  const pages = paginate(one('abcdefgh\nnext line'), room(9));
  assert.deepEqual(pages.map(([p]) => [p.text, p.tail]), [['abcdefgh', true], ['next line', false]]);
  assert.equal(join(pages), 'abcdefgh\nnext line');
});
test('a turned page starts fresh even when the last one had room', () => {
  const pages = paginate(one('short\fnew page'), room(20));
  assert.deepEqual(pages.map(([p]) => [p.seg, p.text]), [[0, 'short'], [1, 'new page']]);
  assert.equal(join(pages), 'short\fnew page');
  assert.deepEqual(texts(paginate(one('a\f'), room(20))), [['a'], ['']]);
});
test('pages are padded to the minimum and an empty book still has one page', () => {
  assert.equal(paginate(one(''), room(5)).length, 1);
  assert.deepEqual(texts(paginate(one('hi'), room(5), { min: 2 })), [['hi'], ['']]);
  assert.equal(join(paginate(one('hi'), room(5), { min: 2 })), 'hi');
});
test('a word longer than a page is broken rather than lost', () => {
  const pages = paginate(one('abcdefghijkl'), room(5));
  assert.equal(join(pages), 'abcdefghijkl');
  assert(pages.every(([p]) => p.text.length <= 5));
});
test('entries follow each other on the same page under their headings', () => {
  const items = [{ text: 'monday words', head: true }, { text: 'tuesday', head: true }, { text: '', head: true }];
  const pages = paginate(items, room(24, 2));
  assert.deepEqual(pages.map(page => page.map(p => [p.item, p.head, p.text])),
    [[[0, true, 'monday words'], [1, true, 'tuesday']], [[2, true, '']]]);
  items.forEach((item, i) => assert.equal(join(pages, i), item.text));
});
test('an entry that doesn’t fit starts on the next page instead of leaving a stub', () => {
  const pages = paginate([{ text: 'aaaa aaaa', head: true }, { text: 'bbbbbbbbbb', head: true }], room(12, 1));
  assert.deepEqual(pages.map(page => page.map(p => p.text)), [['aaaa aaaa'], ['bbbbbbbbbb']]);
});
test('kept pages are reused and the rest is laid out after them', () => {
  const items = [{ text: 'one two three four five', head: true }, { text: 'six seven', head: true }];
  const full = paginate(items, room(10));
  const calls = [];
  const again = paginate(items, (i, pieces) => { calls.push(i); return room(10)(i, pieces); }, { keep: full.slice(0, 1) });
  assert.deepEqual(again, full);
  assert(!calls.includes(0));
});
test('offsets map to pieces and back', () => {
  const pages = paginate([{ text: 'abcdefgh\nxy\fzz' }, { text: 'second entry', head: true }], room(9));
  for (const item of [0, 1]) {
    const text = join(pages, item);
    for (let g = 0; g <= text.length; g++) {
      if (text[g - 1] === '\f') continue;
      const { p, q, local } = locate(pages, item, g);
      assert.equal(offsetOf(pages, p, q, local), g, `item ${item} offset ${g}`);
    }
  }
  assert.deepEqual(locate(pages, 0, 8), { p: 0, q: 0, local: 8 });   // before the hidden break
  assert.deepEqual(locate(pages, 0, 9), { p: 1, q: 0, local: 0 });   // after it
});
