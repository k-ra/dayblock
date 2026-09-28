const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../cloud-data.js');
const { create } = require('../cloud-sync.js');
const blank = () => ({ settings: { mode: 'day', paperPreferences: { desktop: 'page' } }, days: {}, habits: [], habitLog: {}, desk: { items: [] }, months: {}, trackers: { ideas: [], reading: [] }, catchall: { draft: '', items: [] }, googleCalendar: { events: [{ private: true }] } });
const withNote = text => ({ ...blank(), days: { '2026-09-21': { blocks: [], todos: [], notes: text, title: '', done: '' } } });
function harness({ guest = blank(), cloud = null, rawCloud = false } = {}) {
  let current = D.clone(guest), record = { revision: cloud ? 1 : 0, data: cloud ? rawCloud ? D.clone(cloud) : D.portable(cloud) : null }, offline = false;
  const map = new Map([['spread-planner.v1', JSON.stringify(guest)]]), messages = [], writes = [];
  const storage = { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
  const remote = {
    async read() { if (offline) throw new Error('offline'); return D.clone(record); },
    async write(uid, data, revision) {
      if (offline) throw new Error('offline');
      if (revision !== record.revision) throw Object.assign(new Error('conflict'), { code: 'dayblock/conflict' });
      D.serialize(data); record = { revision: revision + 1, data: D.portable(data) }; writes.push({ uid, data: record.data }); return record.revision;
    },
    async signOut() { await controller.switchUser(null); },
  };
  const controller = create({ remote, storage, getState: () => current, apply: data => { current = D.clone(data); }, blank, status: data => messages.push(data), delay: 1 });
  return { controller, storage, remote, messages, writes, current: () => current, record: () => record,
    edit: data => { current = D.clone(data); controller.save(current); }, offline: value => { offline = value; }, advance: data => { record = { revision: record.revision + 1, data: D.portable(data) }; } };
}
test('portable backups exclude calendar data and per-device layout', () => {
  const data = D.portable(blank());
  assert.equal(data.googleCalendar, undefined);
  assert.equal(data.settings.paperPreferences, undefined);
  assert.equal(D.parseBackup(JSON.stringify({ format: 'dayblock-backup', data })).settings.mode, 'day');
});
test('reject malformed, unsafe and oversized imports/cloud documents', () => {
  assert.throws(() => D.parseBackup('{"settings":{},"days":{},"__proto__":{}}'), /Unsafe/);
  assert.throws(() => D.validate({ settings: {}, days: { bad: {} } }), /Invalid day/);
  assert.throws(() => D.serialize(withNote('a'.repeat(800001))), /limit/);
  assert.throws(() => D.validate({ ...blank(), trackers: { ideas: 'bad', reading: [] } }), /Invalid/);
});
test('time-block checklists survive backups and reject malformed items', () => {
  const data = withNote('');
  const block = { id: 'block', start: 9, end: 10, title: 'morning work', tasks: [{ id: 'step', text: 'outline', done: true }] };
  data.days['2026-09-21'].blocks.push(block);
  const restored = D.parseBackup(JSON.stringify({ format: 'dayblock-backup', data: D.portable(data) }));
  assert.deepEqual(restored.days['2026-09-21'].blocks[0].tasks, block.tasks);
  block.tasks[0].done = 'yes';
  assert.throws(() => D.validate(data), /checklist/);
});
test('import preserves conflicting day notes and books; repeated import is idempotent', () => {
  const a = withNote('cloud'), b = withNote('browser');
  a.trackers.reading.push({ id: 'book', title: 'Birds', notes: 'cloud thoughts' });
  b.trackers.reading.push({ id: 'book', title: 'Birds', notes: 'local thoughts' });
  const merged = D.merge(a, b);
  assert.match(merged.days['2026-09-21'].notes, /cloud[\s\S]*browser/);
  assert.equal(merged.trackers.reading.length, 2);
  assert.deepEqual(D.merge(merged, b), merged);
});
test('import does not revive a completed todo from a stale carried browser copy', () => {
  const cloud = withNote(''), browser = withNote('');
  cloud.days['2026-09-21'].todos.push({ id: 'task-1', text: 'book dentist', done: true, color: 'none' });
  browser.days['2026-09-22'] = { title: '', blocks: [], todos: [{ id: 'task-1', text: 'book dentist', done: false, from: '2026-09-21', color: 'none' }], notes: '', done: '' };
  const merged = D.merge(cloud, browser);
  assert.deepEqual(Object.values(merged.days).flatMap(day => day.todos).map(todo => [todo.id, todo.done]), [['task-1', true]]);
  assert.equal(merged.days['2026-09-22'].todos.length, 0);
});
test('import keeps a newly completed todo and later active todos by stable id', () => {
  const cloud = withNote(''), browser = withNote('');
  cloud.days['2026-09-21'].todos.push({ id: 'done-later', text: 'write outline', done: false });
  cloud.days['2026-09-21'].todos.push({ id: 'carried', text: 'buy tea', done: false });
  browser.days['2026-09-22'] = { title: '', blocks: [], todos: [
    { id: 'done-later', text: 'write outline', done: true, from: '2026-09-21' },
    { id: 'carried', text: 'buy tea', done: false, from: '2026-09-21' },
    { id: 'different', text: 'buy tea', done: false },
  ], notes: '', done: '' };
  const merged = D.merge(cloud, browser);
  assert.equal(merged.days['2026-09-21'].todos.length, 0);
  assert.deepEqual(merged.days['2026-09-22'].todos.map(todo => [todo.id, todo.done]), [
    ['done-later', true], ['carried', false], ['different', false],
  ]);
});
test('changed habit imports preserve their matching history', () => {
  const a = blank(), b = blank();
  a.habits = [{ id: 'h', name: 'Walk' }]; b.habits = [{ id: 'h', name: 'Read' }];
  b.habitLog = { '2026-09-21': { h: true } };
  const merged = D.merge(a, b), imported = merged.habits.find(h => h.name === 'Read');
  assert.notEqual(imported.id, 'h'); assert.equal(merged.habitLog['2026-09-21'][imported.id], true);
});
test('first sign-in imports guest content without replacing the guest notebook', async () => {
  const h = harness({ guest: withNote('local') }); const original = h.storage.getItem('spread-planner.v1');
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.record().data.days['2026-09-21'].notes, 'local');
  assert.equal(h.record().data.googleCalendar, undefined);
  h.edit(withNote('account edit')); await h.controller.flush();
  assert.equal(h.storage.getItem('spread-planner.v1'), original);
  await h.controller.signOut(); assert.equal(h.current().days['2026-09-21'].notes, 'local');
});
test('sign-in automatically combines browser-only and cloud pages', async () => {
  const h = harness({ guest: withNote('local'), cloud: withNote('cloud') });
  await h.controller.switchUser({ uid: 'alice' });
  assert.match(h.current().days['2026-09-21'].notes, /cloud[\s\S]*local/);
  assert.equal(h.writes.length, 1);
});
test('two devices editing different things merge silently, with nothing duplicated', async () => {
  const start = withNote('start'); start.days['2026-09-22'] = { blocks: [], todos: [], notes: 'tuesday', title: '', done: '' };
  const h = harness({ cloud: start });
  await h.controller.switchUser({ uid: 'alice' });
  const mine = D.clone(h.current()); mine.days['2026-09-21'].notes = 'device edit';
  const theirs = D.portable(start); theirs.days['2026-09-22'].notes = 'other device';
  h.edit(mine); h.advance(theirs); await h.controller.flush(); await h.controller.flush();
  assert.ok(h.messages.every(m => m.phase !== 'conflict'));
  assert.equal(h.record().data.days['2026-09-21'].notes, 'device edit');
  assert.equal(h.record().data.days['2026-09-22'].notes, 'other device');
  assert.equal(h.current().days['2026-09-22'].notes, 'other device');
  assert.equal(h.controller.pending(), false);
});
test('the same note edited on two devices keeps both versions and a recovery copy', async () => {
  const h = harness({ cloud: withNote('start') });
  await h.controller.switchUser({ uid: 'alice' });
  h.edit(withNote('device edit')); h.advance(withNote('other device')); await h.controller.flush(); await h.controller.flush();
  assert.match(h.record().data.days['2026-09-21'].notes, /other device[\s\S]*device edit/);
  assert.equal(h.controller.recovery().days['2026-09-21'].notes, 'device edit');
});
test('an older dirty cache without a merge baseline keeps both versions', async () => {
  const h = harness({ cloud: withNote('cloud edit') });
  h.storage.setItem('dayblock.account.v1:alice', JSON.stringify({
    state: withNote('device edit'), revision: 0, dirty: true,
  }));
  await h.controller.switchUser({ uid: 'alice' });
  await h.controller.flush();
  assert.match(h.record().data.days['2026-09-21'].notes, /cloud edit[\s\S]*device edit/);
  assert.equal(h.controller.recovery().days['2026-09-21'].notes, 'device edit');
});
test('a list item deleted on one device and untouched on the other stays deleted', async () => {
  const start = blank(); start.trackers.ideas = [{ id: 'a', text: 'keep' }, { id: 'b', text: 'drop' }];
  const h = harness({ cloud: D.portable(start) });
  await h.controller.switchUser({ uid: 'alice' });
  const mine = D.clone(h.current()); mine.trackers.ideas = mine.trackers.ideas.filter(i => i.id !== 'b');
  const theirs = D.portable(start); theirs.trackers.ideas.push({ id: 'c', text: 'new' });
  h.edit(mine); h.advance(theirs); await h.controller.flush(); await h.controller.flush();
  assert.deepEqual(h.record().data.trackers.ideas.map(i => i.id).sort(), ['a', 'c']);
});
test('a carried todo and a completed todo on different devices do not become two tasks', () => {
  const base = withNote('');
  base.days['2026-09-21'].todos.push({ id: 'task-1', text: 'call dentist', done: false });
  const local = D.portable(base), cloud = D.portable(base);
  local.days['2026-09-21'].todos = [];
  local.days['2026-09-22'] = { title: '', blocks: [], todos: [{ id: 'task-1', text: 'call dentist', done: false, from: '2026-09-21' }], notes: '', done: '' };
  cloud.days['2026-09-21'].todos[0].done = true;
  const merged = D.merge3(D.portable(base), local, cloud);
  assert.deepEqual(Object.values(merged.days).flatMap(day => day.todos).map(todo => [todo.id, todo.done]), [['task-1', true]]);
  assert.equal(merged.days['2026-09-22'].todos.length, 0);
});
test('offline changes persist per account and retry when online', async () => {
  const h = harness({ cloud: withNote('start') });
  await h.controller.switchUser({ uid: 'alice' }); h.offline(true); h.edit(withNote('offline edit')); await h.controller.flush();
  assert.equal(JSON.parse(h.storage.getItem('dayblock.account.v1:alice')).dirty, true);
  await assert.rejects(h.controller.signOut(), /haven’t reached your account/);
  h.offline(false); await h.controller.refresh();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'offline edit'); assert.equal(h.controller.pending(), false);
});
test('read failure for a new account never uploads guest data', async () => {
  const h = harness({ guest: withNote('local') }); h.offline(true); await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.writes.length, 0); assert.equal(h.controller.currentUser(), null);
  assert.equal(h.current().days['2026-09-21'].notes, 'local');
});
test('signing into another account never imports the previous account cache', async () => {
  const h = harness();
  await h.controller.switchUser({ uid: 'alice' }); h.edit(withNote('alice secret')); await h.controller.flush();
  await h.controller.signOut(); h.advance(withNote('bob cloud'));
  await h.controller.switchUser({ uid: 'bob' });
  assert.equal(h.current().days['2026-09-21'].notes, 'bob cloud');
  assert.doesNotMatch(JSON.stringify(h.current()), /alice secret/);
});
test('edits made during a cloud write stay pending until the next revision', async () => {
  const h = harness({ cloud: withNote('start') }); await h.controller.switchUser({ uid: 'alice' });
  let release; const write = h.remote.write;
  h.remote.write = async (...args) => { await new Promise(resolve => { release = resolve; }); return write(...args); };
  h.edit(withNote('first')); const pending = h.controller.flush(); h.edit(withNote('second')); release(); await pending;
  assert.equal(h.controller.pending(), true);
  h.remote.write = write; await h.controller.flush();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'second');
});
test('stale account reads cannot replace a later account session', async () => {
  const h = harness({ cloud: withNote('alice cloud') });
  const read = h.remote.read; let release;
  h.remote.read = async () => { await new Promise(resolve => { release = resolve; }); return { revision: 1, data: withNote('alice cloud') }; };
  const oldSession = h.controller.switchUser({ uid: 'alice' });
  h.remote.read = read; h.advance(withNote('bob cloud'));
  await h.controller.switchUser({ uid: 'bob' }); release(); await oldSession;
  assert.equal(h.controller.currentUser().uid, 'bob');
  assert.equal(h.current().days['2026-09-21'].notes, 'bob cloud');
});
test('dirty account cache survives reload and synchronizes without importing guest again', async () => {
  const h = harness({ cloud: withNote('cloud') });
  await h.controller.switchUser({ uid: 'alice' }); h.offline(true); h.edit(withNote('pending edit')); await h.controller.flush();
  await h.controller.switchUser(null); h.offline(false); await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.record().data.days['2026-09-21'].notes, 'pending edit');
  assert.equal(h.controller.pending(), false);
});
test('storage failure during sign-in cannot attach guest edits to the cloud account', async () => {
  const h = harness({ guest: withNote('local'), cloud: withNote('private cloud') });
  const set = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key.startsWith('dayblock.account.')) throw new Error('storage full'); set(key, value); };
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.controller.currentUser(), null);
  h.edit(withNote('still guest')); await h.controller.flush();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'private cloud');
  assert.equal(h.writes.length, 0);
});

test('later signed-out edits sync automatically without reimporting unchanged browser pages', async () => {
  const h = harness({ guest: withNote('first browser page') });
  await h.controller.switchUser({ uid: 'u1' });
  assert.equal(h.writes.length, 1);
  await h.controller.switchUser(null);
  await h.controller.switchUser({ uid: 'u1' });
  assert.equal(h.writes.length, 1);
  const next = withNote('first browser page');
  next.days['2026-09-22'] = { blocks: [], todos: [], notes: 'written while signed out', title: '', done: '' };
  h.storage.setItem('spread-planner.v1', JSON.stringify(next));
  await h.controller.switchUser({ uid: 'u1' });
  assert.equal(h.record().data.days['2026-09-22'].notes, 'written while signed out');
  assert.equal(h.writes.length, 2);
});

test('an old import receipt prevents stale browser todos returning on upgrade', async () => {
  const oldGuest = withNote('');
  oldGuest.days['2026-09-21'].todos.push({ id: 'removed', text: 'old task', done: false });
  const cloud = withNote('');
  const h = harness({ guest: oldGuest, cloud });
  h.storage.setItem('dayblock.imported.v1:alice', D.canonical(D.portable(oldGuest)));
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.current().days['2026-09-21'].todos.length, 0);
  assert.equal(h.writes.length, 0);
  await h.controller.switchUser(null);
  const changed = D.clone(oldGuest);
  changed.days['2026-09-22'] = { blocks: [], todos: [{ id: 'new', text: 'new task', done: false }], notes: '', title: '', done: '' };
  h.storage.setItem('spread-planner.v1', JSON.stringify(changed));
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.record().data.days['2026-09-22'].todos[0].text, 'new task');
  assert.equal(h.record().data.days['2026-09-21'].todos.length, 0);
});

test('an empty browser adds nothing to an existing account', async () => {
  const h = harness({ guest: blank() });
  h.advance(withNote('cloud'));
  await h.controller.switchUser({ uid: 'u2' });
  assert.equal(h.writes.length, 0);
  assert.equal(h.current().days['2026-09-21'].notes, 'cloud');
  assert.equal(D.hasContent(blank()), false);
  assert.equal(D.hasContent(withNote('hi')), true);
});

test('a browser whose pages are already in the account does not upload them again', async () => {
  const guest = withNote('already imported');
  const h = harness({ guest, cloud: D.portable(guest) });
  await h.controller.switchUser({ uid: 'u3' });
  assert.equal(h.writes.length, 0);
  await h.controller.switchUser(null);
  await h.controller.switchUser({ uid: 'u3' });
  assert.equal(h.writes.length, 0);
});

test('a removed todo is not restored by an older browser copy', async () => {
  const original = withNote('');
  original.days['2026-09-21'].todos.push({ id: 't1', text: 'buy milk', done: false });
  const deleted = withNote('');
  deleted.todoTombstones = { t1: true };
  const h = harness({ guest: original, cloud: deleted });
  await h.controller.switchUser({ uid: 'u4' });
  assert.equal(h.current().days['2026-09-21'].todos.length, 0);
  assert.equal(h.record().data.days['2026-09-21'].todos.length, 0);
  assert.equal(h.current().todoTombstones.t1, true);
});

test('offline completion and signed-out additions both reach the cloud on the next online opening', async () => {
  const start = withNote('');
  start.days['2026-09-21'].todos.push({ id: 't1', text: 'call dentist', done: false });
  const h = harness({ guest: blank(), cloud: start });
  await h.controller.switchUser({ uid: 'u5' });
  h.offline(true);
  const done = h.current();
  done.days['2026-09-21'].todos[0].done = true;
  h.edit(done);
  await h.controller.flush();
  await h.controller.switchUser(null);
  const browser = withNote('');
  browser.days['2026-09-22'] = { blocks: [], todos: [{ id: 't2', text: 'buy tea', done: false }], notes: '', title: '', done: '' };
  h.storage.setItem('spread-planner.v1', JSON.stringify(browser));
  h.offline(false);
  await h.controller.switchUser({ uid: 'u5' });
  assert.equal(h.record().data.days['2026-09-21'].todos[0].done, true);
  assert.equal(h.record().data.days['2026-09-22'].todos[0].text, 'buy tea');
});

test('deletion tombstones beat concurrent edits and survive backup round-trips', () => {
  const base = withNote('');
  base.days['2026-09-21'].todos.push({ id: 't1', text: 'buy milk', done: false });
  const local = D.clone(base);
  local.days['2026-09-21'].todos = [];
  local.todoTombstones = { t1: true };
  const cloud = D.clone(base);
  cloud.days['2026-09-21'].todos[0].text = 'buy oat milk';
  const merged = D.merge3(base, local, cloud);
  assert.equal(merged.days['2026-09-21'].todos.length, 0);
  assert.equal(D.parseBackup(JSON.stringify({ format: 'dayblock-backup', data: merged })).todoTombstones.t1, true);
});

test('removed time-block checklist steps do not come back from stale copies', () => {
  const old = withNote('');
  old.days['2026-09-21'].blocks.push({ id: 'block', start: 9, end: 10, tasks: [{ id: 'step', text: 'outline', done: false }] });
  const removed = D.clone(old);
  removed.days['2026-09-21'].blocks[0].tasks = [];
  removed.todoTombstones = { step: true };
  const imported = D.merge(old, removed);
  assert.equal(imported.days['2026-09-21'].blocks.length, 1);
  assert.equal(imported.days['2026-09-21'].blocks[0].tasks.length, 0);
  assert.equal(D.merge3(old, old, removed).days['2026-09-21'].blocks[0].tasks.length, 0);
});

test('checking a time-block step does not duplicate its parent block on first sync', () => {
  const cloud = withNote('');
  cloud.days['2026-09-21'].blocks.push({ id: 'block', title: 'work', start: 9, end: 10, tasks: [{ id: 'step', text: 'outline', done: true }] });
  const browser = D.clone(cloud);
  browser.days['2026-09-21'].blocks[0].tasks[0].done = false;
  const merged = D.merge(cloud, browser);
  assert.equal(merged.days['2026-09-21'].blocks.length, 1);
  assert.equal(merged.days['2026-09-21'].blocks[0].tasks[0].done, true);
});

test('old import-generated copies collapse to the completed original and are repaired in cloud', async () => {
  const old = withNote('');
  old.days['2026-09-21'].todos.push({ id: 't1', text: 'book dentist', done: true });
  old.days['2026-09-22'] = { blocks: [], todos: [{ id: 't1-import-abc', text: 'book dentist', done: false }], notes: '', title: '', done: '' };
  const h = harness({ cloud: old, rawCloud: true });
  await h.controller.switchUser({ uid: 'u6' });
  assert.deepEqual(Object.values(h.record().data.days).flatMap(day => day.todos).map(todo => [todo.id, todo.done]), [['t1', true]]);
  assert.equal(h.controller.recovery().days['2026-09-22'].todos.length, 1);
});

test('independent same-worded todos are not collapsed', () => {
  const data = withNote('');
  data.days['2026-09-21'].todos.push({ id: 'one', text: 'read', done: true }, { id: 'two', text: 'read', done: false });
  assert.equal(D.portable(data).days['2026-09-21'].todos.length, 2);
});

test('browser-only pages stay with the account that first incorporated them', async () => {
  const h = harness({ guest: withNote('personal page') });
  await h.controller.switchUser({ uid: 'alice' });
  await h.controller.switchUser(null);
  h.advance(withNote('work page'));
  await h.controller.switchUser({ uid: 'bob' });
  assert.equal(h.current().days['2026-09-21'].notes, 'work page');
  assert.doesNotMatch(JSON.stringify(h.record().data), /personal page/);
});

test('switching accounts clears the prior account before the next cloud read finishes', async () => {
  const h = harness({ cloud: withNote('alice private') });
  await h.controller.switchUser({ uid: 'alice' });
  let release;
  h.remote.read = async () => new Promise(resolve => { release = () => resolve({ revision: 1, data: D.portable(withNote('bob private')) }); });
  const opening = h.controller.switchUser({ uid: 'bob' });
  const shownWhileLoading = JSON.stringify(h.current());
  release(); await opening;
  assert.doesNotMatch(shownWhileLoading, /alice private/);
  assert.equal(h.current().days['2026-09-21'].notes, 'bob private');
});
