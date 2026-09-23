/* Revision-checked sync. The guest notebook is never replaced by account data. */
(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./cloud-data.js') : root.DayblockCloudData;
  function create({ remote, storage, getState, apply, blank, chooseImport, status, canApply = () => true, delay = 1200 }) {
    const guestKey = 'spread-planner.v1';
    let user = null, cache = null, epoch = 0, timer = null, flight = null, phase = 'local';
    const key = id => `dayblock.account.v1:${id}`;
    const report = (next, message) => { phase = next; status({ phase, message, user, dirty: !!cache?.dirty }); };
    function read(keyName) { const raw = storage.getItem(keyName); return raw ? JSON.parse(raw) : null; }
    function persist() { if (user && cache) storage.setItem(key(user.uid), JSON.stringify(cache)); }
    function localize(data, previous = {}) {
      const value = D.validate(data);
      value.settings.paperPreferences = D.clone(getState().settings.paperPreferences || {});
      value.googleCalendar = D.clone(previous.googleCalendar || { events: [], updatedAt: null });
      return value;
    }
    function save(data) {
      if (!user || !cache) { storage.setItem(guestKey, JSON.stringify(data)); return; }
      const changed = D.canonical(D.portable(data)) !== D.canonical(D.portable(cache.state));
      cache.state = D.clone(data);
      cache.dirty ||= changed;
      persist();
      if (cache.dirty && phase !== 'conflict') {
        report('pending', 'Saved on this device · waiting to sync');
        clearTimeout(timer); timer = setTimeout(() => flush(), delay);
      }
    }
    async function flush() {
      if (flight) return flight;
      if (!user || !cache?.dirty || phase === 'conflict') return;
      const generation = epoch, account = user.uid, snapshot = D.clone(cache.state), revision = cache.revision;
      report('saving', 'Saving to your account…');
      const operation = (async () => {
        try {
          const next = await remote.write(account, snapshot, revision);
          if (generation !== epoch) return;
          cache.revision = next;
          cache.dirty = D.canonical(D.portable(cache.state)) !== D.canonical(D.portable(snapshot));
          persist();
          report(cache.dirty ? 'pending' : 'synced', cache.dirty ? 'Saving your latest changes…' : 'Saved to your account');
        } catch (error) {
          if (generation === epoch) report(error.code === 'dayblock/conflict' ? 'conflict' : 'error', error.message || 'Cloud save failed. Your device copy is safe.');
        }
      })();
      flight = operation;
      await operation;
      if (flight === operation) flight = null;
      if (generation === epoch && cache?.dirty && phase === 'pending') { clearTimeout(timer); timer = setTimeout(() => flush(), delay); }
    }
    async function switchUser(next) {
      const generation = ++epoch;
      clearTimeout(timer);
      flight = null;
      // Do not let a previous account's in-flight operation update the next one.
      user = null; cache = null;
      try { apply(localize(read(guestKey) || blank())); }
      catch (error) { report('error', 'Could not open the browser copy. Export your current notebooks before continuing.'); return; }
      if (!next) { report('local', 'Saved in this browser only'); return; }
      report('loading', 'Opening your account…');
      try {
        const saved = read(key(next.uid));
        if (saved) { D.validate(saved.state); if (!Number.isInteger(saved.revision)) throw new Error('Invalid device cache. Export your browser copy before continuing.'); }
        let cloud;
        try { cloud = await remote.read(next.uid); }
        catch (error) {
          if (!saved) throw error;
          if (generation !== epoch) return;
          user = next; cache = saved; apply(localize(cache.state, cache.state));
          report('error', 'Offline or cloud unavailable. Showing this account’s device copy; reconnect to sync.');
          return;
        }
        if (generation !== epoch) return;
        if (saved?.dirty) {
          user = next; cache = saved; apply(localize(cache.state, cache.state));
          if (cloud.revision !== cache.revision) report('conflict', 'This device and the cloud both have changes. Choose how to continue.');
          else await flush();
          return;
        }
        const guest = D.validate(read(guestKey) || blank());
        const fingerprint = D.canonical(D.portable(guest));
        const receiptKey = `dayblock.imported.v1:${next.uid}`;
        let value = cloud.data || blank(), imported = false;
        if (storage.getItem(receiptKey) !== fingerprint) imported = await chooseImport(next);
        if (generation !== epoch) return;
        // Read again: typing before the import prompt must not be lost.
        const currentGuest = D.validate(read(guestKey) || guest);
        if (imported) value = cloud.data ? D.merge(value, currentGuest) : D.portable(currentGuest);
        const opening = { state: localize(value, saved?.state), revision: cloud.revision, dirty: imported || !cloud.data };
        // Storage failure must not bind the still-visible guest editor to an
        // account. Finish persisting before switching the editor's ownership.
        storage.setItem(key(next.uid), JSON.stringify(opening));
        user = next; cache = opening;
        apply(cache.state);
        try { storage.setItem(receiptKey, D.canonical(D.portable(currentGuest))); }
        catch (_) { /* Optional import receipt; notebook data is already saved. */ }
        if (cache.dirty) await flush();
        else report('synced', 'Saved to your account');
      } catch (error) {
        if (generation === epoch) report('error', error.message || 'Could not open the account. Your browser notebooks are unchanged.');
      }
    }
    async function refresh() {
      if (!user || !cache || flight || phase === 'conflict') return;
      if (cache.dirty) { await flush(); return; }
      const generation = epoch;
      try {
        const cloud = await remote.read(user.uid);
        if (generation !== epoch || cache.dirty || !canApply()) return;
        if (cloud.revision !== cache.revision && cloud.data) {
          const fresh = { state: localize(cloud.data, cache.state), revision: cloud.revision, dirty: false };
          storage.setItem(key(user.uid), JSON.stringify(fresh));
          cache = fresh; apply(cache.state);
        }
        report(cache.dirty ? 'pending' : 'synced', cache.dirty ? 'Saving your latest changes…' : 'Saved to your account');
      } catch (error) { if (generation === epoch) report('error', 'Could not reach cloud storage. Your device copy is safe.'); }
    }
    async function resolve(combine) {
      if (!user || !cache) return;
      const generation = epoch;
      try {
        const cloud = await remote.read(user.uid);
        if (generation !== epoch) return;
        // A recovery copy is kept even when the user explicitly chooses cloud.
        storage.setItem(`dayblock.recovery.v1:${user.uid}`, JSON.stringify(cache.state));
        const value = combine && cloud.data ? D.merge(cloud.data, cache.state) : cloud.data || cache.state;
        const resolved = { state: localize(value, cache.state), revision: cloud.revision, dirty: combine || !cloud.data };
        storage.setItem(key(user.uid), JSON.stringify(resolved));
        cache = resolved; apply(cache.state);
        report('pending', 'Resolving changes…');
        if (cache.dirty) await flush(); else report('synced', 'Loaded cloud copy · previous device copy kept as a recovery backup');
      } catch (error) { report('conflict', error.message); }
    }
    async function signOut() {
      await flush();
      if (cache?.dirty) throw new Error('There are unsynced changes. Sync or resolve them before signing out.');
      await remote.signOut();
      // Firebase's auth listener restores the untouched guest notebook.
    }
    return { save, flush, refresh, switchUser, resolve, signOut,
      currentUser: () => user, pending: () => !!cache?.dirty,
      recovery: () => user ? read(`dayblock.recovery.v1:${user.uid}`) : null };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockCloudSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
