const test = require('node:test');
const assert = require('node:assert/strict');
const { fitBook, timeline, timeToY, yToTime } = require('../planner-layout.js');

test('page size is independent of the requested margin', () => {
  for (const width of [701, 768, 900, 1280, 1600]) {
    const args = { width, paperHeight: 600, single: true, phone: false };
    const plain = fitBook({ ...args, marginRequested: false });
    const margin = fitBook({ ...args, marginRequested: true });
    assert.equal(plain.width, margin.width);
    assert(margin.width >= 460);
    assert(margin.width <= width - 40);
  }
});
test('a spread keeps its width while the margin folds away first', () => {
  const args = { paperHeight: 600, single: false, phone: false, marginRequested: true };
  const narrow = fitBook({ ...args, width: 1000 });
  const wide = fitBook({ ...args, width: 1400 });
  assert.equal(narrow.width, wide.width);
  assert.equal(narrow.margin, false);
  assert.equal(wide.margin, true);
});
test('phones use their full paper width without a rail', () => {
  assert.deepEqual(fitBook({ width: 390, paperHeight: 700, single: true, phone: true, marginRequested: true }), { width: 374, margin: false, rail: 232 });
});
test('past hours fold only on today’s daily page and preserve the current hour', () => {
  const base = { today: true, now: 15.75, hidePast: true, paperHeight: 650 };
  const folded = timeline(base);
  assert.equal(folded.start, 15);
  assert.deepEqual(folded.items[0], { type: 'past', from: 8, to: 15, y: 0, h: 26 });
  assert.equal(timeline({ ...base, hidePast: false }).start, 8);
  assert.equal(timeline({ ...base, today: false }).start, 8);
  assert.equal(timeline({ ...base, weekly: true }).start, 8);
  assert.equal(timeline({ ...base, now: 5 }).start, 8);
});
test('folded hours combine with work filters without invalid geometry', () => {
  for (const view of ['all', 'work', 'off']) {
    for (const now of [0, 8, 9.75, 17.5, 22.5, 23.99]) {
      const L = timeline({ view, now, hidePast: true, today: true, paperHeight: 600 });
      assert(Number.isFinite(L.height) && L.height > 0);
      assert(L.pph <= 72);
      let end = 8;
      for (const part of L.items) {
        assert.equal(part.from, end);
        assert(part.to > part.from);
        end = part.to;
        if (part.type === 'seg') {
          for (let t = part.from + .25; t < part.to; t += .25) assert(Math.abs(yToTime(timeToY(t, L), L) - t) < 1e-9);
        }
      }
      assert.equal(end, 24);
    }
  }
});
test('each day has its own invertible map for cross-day dragging', () => {
  const today = timeline({ today: true, now: 20.5, hidePast: true });
  const tomorrow = timeline({ today: false, now: 20.5, hidePast: true });
  assert.notEqual(timeToY(22, today), timeToY(22, tomorrow));
  for (const L of [today, tomorrow]) assert.equal(yToTime(timeToY(22.25, L), L), 22.25);
});
