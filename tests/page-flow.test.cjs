const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate, join, offsetOf, locate } = require('../page-flow.js');

// A page holds `size` characters, counting a shown line break as one.
const room = size => (i, text) => text.length <= size;

test('writing that fills a page carries whole words to the next', () => {
  const pages = paginate('one two three four', room(10));
  assert.deepEqual(pages.map(p => p.text), ['one two ', 'three four']);
  assert.equal(join(pages), 'one two three four');
});
test('a line break at the end of a page is kept but not shown', () => {
  const pages = paginate('abcdefgh\nnext line', room(9));
  assert.deepEqual(pages.map(p => [p.text, p.tail]), [['abcdefgh', true], ['next line', false]]);
  assert.equal(join(pages), 'abcdefgh\nnext line');
});
test('a turned page starts fresh even when the last one had room', () => {
  const pages = paginate('short\fnew page', room(20));
  assert.deepEqual(pages.map(p => [p.seg, p.text]), [[0, 'short'], [1, 'new page']]);
  assert.equal(join(pages), 'short\fnew page');
  assert.deepEqual(paginate('a\f', room(20)).map(p => p.text), ['a', '']);
});
test('pages are padded to the minimum and an empty book still has one page', () => {
  assert.equal(paginate('', room(5)).length, 1);
  assert.deepEqual(paginate('hi', room(5), { min: 2 }).map(p => p.text), ['hi', '']);
  assert.equal(join(paginate('hi', room(5), { min: 2 })), 'hi');
});
test('a word longer than a page is broken rather than lost', () => {
  const pages = paginate('abcdefghijkl', room(5));
  assert.equal(join(pages), 'abcdefghijkl');
  assert(pages.every(p => p.text.length <= 5));
});
test('kept pages are reused and the rest is laid out after them', () => {
  const text = 'one two three four five';
  const full = paginate(text, room(10));
  const calls = [];
  const again = paginate(text, (i, s) => { calls.push(i); return s.length <= 10; }, { keep: full.slice(0, 1) });
  assert.deepEqual(again, full);
  assert(!calls.includes(0));
});
test('offsets map to pages and back', () => {
  const pages = paginate('abcdefgh\nxy\fzz', room(9));
  const text = join(pages);
  for (let g = 0; g <= text.length; g++) {
    if (text[g - 1] === '\f') continue;
    const { i, local } = locate(pages, g);
    assert.equal(offsetOf(pages, i, local), g, `offset ${g}`);
  }
  assert.deepEqual(locate(pages, 8), { i: 0, local: 8 });   // before the hidden break
  assert.deepEqual(locate(pages, 9), { i: 1, local: 0 });   // after it
});
