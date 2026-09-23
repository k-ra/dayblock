const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../quick-notes.js');

const now = new Date(2026, 8, 22, 9, 30); // Tue Sep 22 2026
const blank = () => ({ days: {}, trackers: { ideas: [], reading: [], recipes: [] }, shopping: [], gratitude: {}, morningPages: {} });
let n = 0;
const uid = () => `id${++n}`;

test('keyword fallback reads times and days', () => {
  const call = Q.heuristic('call mom at 5', now);
  assert.equal(call.book, 'planner');
  assert.equal(call.section, 'time block');
  assert.equal(call.date, '2026-09-22');
  assert.equal(call.time, 17);
  assert.equal(call.text, 'call mom');
  const lunch = Q.heuristic('lunch with mom at 1pm on october 8', now);
  assert.equal(lunch.date, '2026-10-08');
  assert.equal(lunch.time, 13);
  assert.equal(lunch.text, 'lunch with mom');
  const essay = Q.heuristic('finish the essay by friday', now);
  assert.deepEqual([essay.book, essay.section, essay.date], ['planner', 'todo', '2026-09-25']);
  assert.equal(Q.heuristic('tmrw pick up keys', now).date, '2026-09-23');
});

test('keyword fallback routes the other books and keeps unknowns unsorted', () => {
  assert.equal(Q.heuristic('2 lemons and parmesan', now).book, 'recipes');
  assert.equal(Q.heuristic('piranesi, reread?', now).book, 'reading');
  assert.equal(Q.heuristic('what if the week card printed on real index cards', now).book, 'ideas');
  assert.equal(Q.heuristic('grateful for the first cold morning', now).book, 'gratitude');
  assert.equal(Q.heuristic('the light on the wall', now).book, 'catchall');
});

test('filing writes through and unfiling removes only untouched entries', () => {
  const state = blank();
  const note = { dest: 'planner', section: 'time block', date: '2026-09-22', time: 17, duration: 30, stored: 'call mom' };
  note.ref = Q.file(state, note, { uid, today: '2026-09-22' });
  assert.equal(state.days['2026-09-22'].blocks[0].title, 'call mom');
  assert.equal(state.days['2026-09-22'].blocks[0].end, 17.5);
  Q.unfile(state, note);
  assert.equal(state.days['2026-09-22'].blocks.length, 0);

  const todo = { dest: 'planner', section: 'todo', date: '', stored: 'send the handoff' };
  todo.ref = Q.file(state, todo, { uid, today: '2026-09-22' });
  state.days['2026-09-22'].todos[0].text = 'send the handoff today';
  Q.unfile(state, todo);
  assert.equal(state.days['2026-09-22'].todos.length, 1, 'edited entries stay');

  const g = { dest: 'gratitude', section: 'grateful for', date: '2026-09-22', stored: 'coffee' };
  g.ref = Q.file(state, g, { uid, today: '2026-09-22' });
  assert.deepEqual(state.gratitude['2026-09-22'].grateful, ['coffee']);
  Q.unfile(state, g);
  assert.deepEqual(state.gratitude['2026-09-22'].grateful, ['']);

  const shop = { dest: 'recipes', section: 'shopping', stored: '2 lemons' };
  shop.ref = Q.file(state, shop, { uid, today: '2026-09-22' });
  assert.equal(state.shopping[0].text, '2 lemons');
  assert.equal(Q.file(state, { dest: 'catchall', stored: 'x' }, { uid, today: '2026-09-22' }), null);
});

test('claude sorting sends only the note and validates the reply', async () => {
  let sent = null;
  const load = async () => ({ default: class { constructor(opts) { assert.equal(opts.dangerouslyAllowBrowser, true); }
    get messages() { return { create: async body => { sent = body; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ book: 'planner', section: 'time block', date: '2026-10-08', time: '13:00', duration_minutes: 60, text: 'lunch with mom' }) }] }; } }; } } });
  const out = await Q.classifyWithClaude('lunch with mom at 1pm on october 8', { apiKey: 'k', now, load });
  assert.deepEqual(out, { book: 'planner', section: 'time block', date: '2026-10-08', time: 13, duration: 60, text: 'lunch with mom' });
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'lunch with mom at 1pm on october 8' }]);
  assert.equal(sent.output_config.format.type, 'json_schema');
});
