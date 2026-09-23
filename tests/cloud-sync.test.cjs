const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../cloud-data.js');
const { create } = require('../cloud-sync.js');
const blank = () => ({ settings: { mode: 'day', paperPreferences: { desktop: 'page' } }, days: {}, habits: [], habitLog: {}, desk: { items: [] }, months: {}, trackers: { ideas: [], reading: [] }, catchall: { draft: '', items: [] }, googleCalendar: { events: [{ private: true }] } });
const withNote = text => ({ ...blank(), days: { '2026-09-21': { blocks: [], todos: [], notes: text, title: '', done: '' } } });
function harness({ guest = withNote('local'), cloud = null, choose = true } = {}) {
  let current = D.clone(guest), record = { revision: cloud ? 1 : 0, data: cloud }, offline = false;
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
  const controller = create({ remote, storage, getState: () => current, apply: data => { current = D.clone(data); }, blank, chooseImport: async () => choose, status: data => messages.push(data), delay: 1 });
  return { controller, storage, remote, messages, writes, current: () => current, record: () => record,
    edit: data => { current = D.clone(data); controller.save(current); }, offline: value => { offline = value; }, advance: data => { record = { revision: record.revision + 1, data }; } };
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
test('import preserves conflicting day notes and books; repeated import is idempotent', () => {
  const a = withNote('cloud'), b = withNote('browser');
  a.trackers.reading.push({ id: 'book', title: 'Birds', notes: 'cloud thoughts' });
  b.trackers.reading.push({ id: 'book', title: 'Birds', notes: 'local thoughts' });
  const merged = D.merge(a, b);
  assert.match(merged.days['2026-09-21'].notes, /cloud[\s\S]*browser/);
  assert.equal(merged.trackers.reading.length, 2);
  assert.deepEqual(D.merge(merged, b), merged);
});
test('changed habit imports preserve their matching history', () => {
  const a = blank(), b = blank();
  a.habits = [{ id: 'h', name: 'Walk' }]; b.habits = [{ id: 'h', name: 'Read' }];
  b.habitLog = { '2026-09-21': { h: true } };
  const merged = D.merge(a, b), imported = merged.habits.find(h => h.name === 'Read');
  assert.notEqual(imported.id, 'h'); assert.equal(merged.habitLog['2026-09-21'][imported.id], true);
});
test('first sign-in imports guest content without replacing the guest notebook', async () => {
  const h = harness(); const original = h.storage.getItem('spread-planner.v1');
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.record().data.days['2026-09-21'].notes, 'local');
  assert.equal(h.record().data.googleCalendar, undefined);
  h.edit(withNote('account edit')); await h.controller.flush();
  assert.equal(h.storage.getItem('spread-planner.v1'), original);
  await h.controller.signOut(); assert.equal(h.current().days['2026-09-21'].notes, 'local');
});
test('declining import loads cloud without uploading guest data', async () => {
  const h = harness({ cloud: withNote('cloud'), choose: false });
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.current().days['2026-09-21'].notes, 'cloud'); assert.equal(h.writes.length, 0);
});
test('concurrent device changes stop rather than overwrite; combine preserves both', async () => {
  const h = harness({ cloud: withNote('start'), choose: false });
  await h.controller.switchUser({ uid: 'alice' });
  h.edit(withNote('device edit')); h.advance(withNote('other device')); await h.controller.flush();
  assert.equal(h.messages.at(-1).phase, 'conflict');
  assert.equal(h.record().data.days['2026-09-21'].notes, 'other device');
  await h.controller.resolve(true);
  assert.match(h.record().data.days['2026-09-21'].notes, /other device[\s\S]*device edit/);
  assert.equal(h.controller.recovery().days['2026-09-21'].notes, 'device edit');
});
test('load-cloud conflict resolution retains a downloadable recovery copy', async () => {
  const h = harness({ cloud: withNote('start'), choose: false });
  await h.controller.switchUser({ uid: 'alice' }); h.edit(withNote('device edit')); h.advance(withNote('cloud edit'));
  await h.controller.flush(); await h.controller.resolve(false);
  assert.equal(h.current().days['2026-09-21'].notes, 'cloud edit');
  assert.equal(h.controller.recovery().days['2026-09-21'].notes, 'device edit');
});
test('offline changes persist per account and retry when online', async () => {
  const h = harness({ cloud: withNote('start'), choose: false });
  await h.controller.switchUser({ uid: 'alice' }); h.offline(true); h.edit(withNote('offline edit')); await h.controller.flush();
  assert.equal(JSON.parse(h.storage.getItem('dayblock.account.v1:alice')).dirty, true);
  await assert.rejects(h.controller.signOut(), /unsynced/);
  h.offline(false); await h.controller.refresh();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'offline edit'); assert.equal(h.controller.pending(), false);
});
test('read failure for a new account never uploads guest data', async () => {
  const h = harness(); h.offline(true); await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.writes.length, 0); assert.equal(h.controller.currentUser(), null);
  assert.equal(h.current().days['2026-09-21'].notes, 'local');
});
test('signing into another account never imports the previous account cache', async () => {
  const h = harness({ choose: false });
  await h.controller.switchUser({ uid: 'alice' }); h.edit(withNote('alice secret')); await h.controller.flush();
  await h.controller.signOut(); h.advance(withNote('bob cloud'));
  await h.controller.switchUser({ uid: 'bob' });
  assert.equal(h.current().days['2026-09-21'].notes, 'bob cloud');
  assert.doesNotMatch(JSON.stringify(h.current()), /alice secret/);
});
test('edits made during a cloud write stay pending until the next revision', async () => {
  const h = harness({ cloud: withNote('start'), choose: false }); await h.controller.switchUser({ uid: 'alice' });
  let release; const write = h.remote.write;
  h.remote.write = async (...args) => { await new Promise(resolve => { release = resolve; }); return write(...args); };
  h.edit(withNote('first')); const pending = h.controller.flush(); h.edit(withNote('second')); release(); await pending;
  assert.equal(h.controller.pending(), true);
  h.remote.write = write; await h.controller.flush();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'second');
});
test('stale account reads cannot replace a later account session', async () => {
  const h = harness({ cloud: withNote('alice cloud'), choose: false });
  const read = h.remote.read; let release;
  h.remote.read = async () => { await new Promise(resolve => { release = resolve; }); return { revision: 1, data: withNote('alice cloud') }; };
  const oldSession = h.controller.switchUser({ uid: 'alice' });
  h.remote.read = read; h.advance(withNote('bob cloud'));
  await h.controller.switchUser({ uid: 'bob' }); release(); await oldSession;
  assert.equal(h.controller.currentUser().uid, 'bob');
  assert.equal(h.current().days['2026-09-21'].notes, 'bob cloud');
});
test('dirty account cache survives reload and synchronizes without importing guest again', async () => {
  const h = harness({ cloud: withNote('cloud'), choose: false });
  await h.controller.switchUser({ uid: 'alice' }); h.offline(true); h.edit(withNote('pending edit')); await h.controller.flush();
  await h.controller.switchUser(null); h.offline(false); await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.record().data.days['2026-09-21'].notes, 'pending edit');
  assert.equal(h.controller.pending(), false);
});
test('storage failure during sign-in cannot attach guest edits to the cloud account', async () => {
  const h = harness({ cloud: withNote('private cloud'), choose: false });
  const set = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key.startsWith('dayblock.account.')) throw new Error('storage full'); set(key, value); };
  await h.controller.switchUser({ uid: 'alice' });
  assert.equal(h.controller.currentUser(), null);
  h.edit(withNote('still guest')); await h.controller.flush();
  assert.equal(h.record().data.days['2026-09-21'].notes, 'private cloud');
  assert.equal(h.writes.length, 0);
});
