const test = require('node:test');
const assert = require('node:assert/strict');
const { createSortNote, createPersonalSort, localNow } = require('../functions/sort.js');

// A tiny in-memory Firestore: enough for one document and transactions.
function fakeDb() {
  const docs = new Map();
  let chain = Promise.resolve();
  return {
    docs,
    doc: path => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) }),
    runTransaction(fn) {
      // Serialise transactions, as Firestore would for one document.
      const run = chain.then(() => fn({
        get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
        set: (ref, value) => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...value }),
      }));
      chain = run.catch(() => {});
      return run;
    },
  };
}
const setup = (classify, free = 3) => {
  const db = fakeDb();
  return { db, sort: createSortNote({ db, serverTimestamp: () => 'now', classify, free }) };
};

test('free sorts count down per person and stop at the allowance', async () => {
  const { db, sort } = setup(async text => ({ book: 'ideas', text }));
  assert.equal((await sort({ uid: 'a', text: 'one', today: '2026-09-24' })).left, 2);
  await sort({ uid: 'a', text: 'two' });
  assert.equal((await sort({ uid: 'a', text: 'three' })).left, 0);
  await assert.rejects(sort({ uid: 'a', text: 'four' }), { code: 'resource-exhausted' });
  assert.equal((await sort({ uid: 'b', text: 'someone else' })).left, 2, 'each person has their own allowance');
  assert.equal(db.docs.get('users/a/usage/ai').used, 3);
});

test('signed-out or empty requests never reach Claude', async () => {
  const { sort } = setup(async () => assert.fail('Claude should not be called'));
  await assert.rejects(sort({ uid: null, text: 'hi' }), { code: 'unauthenticated' });
  await assert.rejects(sort({ uid: 'a', text: '   ' }), { code: 'invalid-argument' });
});

test('a failed sort is not counted, and simultaneous notes cannot overspend', async () => {
  let fail = true;
  const { db, sort } = setup(async text => { if (fail) throw new Error('down'); return { text }; }, 2);
  await assert.rejects(sort({ uid: 'a', text: 'x' }), { code: 'unavailable' });
  assert.equal(db.docs.get('users/a/usage/ai').used, 0);
  fail = false;
  const results = await Promise.allSettled([1, 2, 3, 4].map(n => sort({ uid: 'a', text: `note ${n}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(db.docs.get('users/a/usage/ai').used, 2);
});

test('relative dates use the person’s own day, not the server’s', () => {
  const now = localNow('2026-09-24');
  assert.equal(now.getDate(), 24);
  assert.equal(now.getDay(), 4);
});

test('everyone shares one monthly budget; it resets next month', async () => {
  let when = new Date('2026-09-24T12:00:00Z');
  const db = fakeDb();
  const sort = createSortNote({ db, serverTimestamp: () => 'now', classify: async t => ({ text: t }), free: 50, budget: 3, clock: () => when });
  await sort({ uid: 'a', text: '1' }); await sort({ uid: 'b', text: '2' }); await sort({ uid: 'c', text: '3' });
  await assert.rejects(sort({ uid: 'd', text: '4' }), /resting until next month/);
  assert.equal(db.docs.get('usage/2026-09').sorts, 3);
  when = new Date('2026-10-01T00:10:00Z');
  assert.equal((await sort({ uid: 'd', text: '5' })).left, 49);
});

test('personal sorting uses the account key server-side without consuming free sorts', async () => {
  const db = fakeDb();
  db.docs.set('users/alice/secrets/ai', { provider: 'openai', key: 'sk-private' });
  let seen;
  const personal = createPersonalSort({ db, classify: async (...args) => { seen = args; return { book: 'ideas' }; } });
  const reply = await personal({ uid: 'alice', text: 'an idea', today: '2026-09-24' });
  assert.equal(reply.personal, true);
  assert.equal(reply.provider, 'openai');
  assert.equal(JSON.stringify(reply).includes('sk-private'), false);
  assert.equal(seen[2], 'openai');
  assert.equal(seen[3], 'sk-private');
  assert.equal(db.docs.has('users/alice/usage/ai'), false);
  assert.equal(await personal({ uid: 'bob', text: 'another idea' }), null);
});

test('personal sorting rejects anonymous or empty requests before reading secrets', async () => {
  const db = fakeDb();
  const personal = createPersonalSort({ db, classify: async () => assert.fail('no provider call') });
  await assert.rejects(personal({ uid: null, text: 'hello' }), { code: 'unauthenticated' });
  await assert.rejects(personal({ uid: 'alice', text: '  ' }), { code: 'invalid-argument' });
});

test('personal provider errors never expose its key to the browser', async () => {
  const db = fakeDb();
  db.docs.set('users/alice/secrets/ai', { provider: 'anthropic', key: 'sk-ant-secret' });
  const personal = createPersonalSort({ db, classify: async () => { throw new Error('bad sk-ant-secret'); } });
  await assert.rejects(personal({ uid: 'alice', text: 'hello' }), error =>
    error.code === 'unavailable' && !error.message.includes('sk-ant-secret'));
});
