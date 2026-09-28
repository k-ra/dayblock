/* Revision-checked sync that never asks: when two devices edit at once, the
   edits are merged against the last synced copy (cache.base) and saved again.
   The guest notebook is never replaced by account data. */
(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./cloud-data.js') : root.DayblockCloudData;
  function create({ remote, storage, getState, apply, blank, chooseImport, status, canApply = () => true, delay = 350 }) {
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
      if (cache.dirty) {
        report('pending', 'Saved on this device · waiting to sync');
        clearTimeout(timer); timer = setTimeout(() => flush(), delay);
      }
    }
    async function flush() {
      if (flight) return flight;
      if (!user || !cache?.dirty) return;
      const generation = epoch, account = user.uid, snapshot = D.clone(cache.state), revision = cache.revision;
      report('saving', 'Saving to your account…');
      const operation = (async () => {
        try {
          const next = await remote.write(account, snapshot, revision);
          if (generation !== epoch) return;
          cache.revision = next;
          cache.base = D.portable(snapshot);
          cache.dirty = D.canonical(D.portable(cache.state)) !== D.canonical(D.portable(snapshot));
          persist();
          report(cache.dirty ? 'pending' : 'synced', cache.dirty ? 'Saving your latest changes…' : 'Saved to your account');
        } catch (error) {
          if (generation !== epoch) return;
          if (error.code === 'dayblock/conflict') await combine(generation);
          else report('error', error.message || 'Cloud save failed. Your device copy is safe.');
        }
      })();
      flight = operation;
      await operation;
      if (flight === operation) flight = null;
      if (generation === epoch && cache?.dirty && phase === 'pending') { clearTimeout(timer); timer = setTimeout(() => flush(), delay); }
    }
    // Another device saved first: fold its changes into ours, then save again.
    async function combine(generation) {
      try {
        const cloud = await remote.read(user.uid);
        if (generation !== epoch) return;
        // Wait for a quiet moment rather than swapping the page under the cursor.
        if (!canApply()) { report('pending', 'Catching up with your other device…'); return; }
        storage.setItem(`dayblock.recovery.v1:${user.uid}`, JSON.stringify(cache.state));
        // Older device caches have no baseline. Keep both copies in that case
        // rather than guessing which old fields changed on which device.
        const merged = cloud.data ? cache.base
          ? D.merge3(cache.base, D.portable(cache.state), cloud.data)
          : D.merge(cloud.data, D.portable(cache.state)) : cache.state;
        cache = { state: localize(merged, cache.state), revision: cloud.revision, base: cloud.data ? D.portable(cloud.data) : null, dirty: true };
        persist(); apply(cache.state);
        report('pending', 'Combined with your other device…');
      } catch (error) { if (generation === epoch) report('error', 'Could not reach cloud storage. Your device copy is safe.'); }
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
          await flush();
          return;
        }
        const guest = D.validate(read(guestKey) || blank());
        const receiptKey = `dayblock.imported.v1:${next.uid}`;
        let value = cloud.data || blank(), imported = false;
        // Ask once per account on this device, and only about pages the account
        // doesn't already have (a browser that was imported before holds copies).
        const fresh = D.newContent(cloud.data ? D.portable(cloud.data) : null, D.portable(guest));
        if (!storage.getItem(receiptKey) && D.hasContent(guest) && fresh.any) imported = await chooseImport(next, guest, fresh);
        if (generation !== epoch) return;
        // Read again: typing before the import prompt must not be lost.
        const currentGuest = D.validate(read(guestKey) || guest);
        if (imported) value = cloud.data ? D.merge(value, currentGuest) : D.portable(currentGuest);
        const opening = { state: localize(value, saved?.state), revision: cloud.revision, base: cloud.data ? D.portable(cloud.data) : null, dirty: imported || !cloud.data };
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
      if (!user || !cache || flight) return;
      if (cache.dirty) { await flush(); return; }
      const generation = epoch;
      try {
        const cloud = await remote.read(user.uid);
        if (generation !== epoch || cache.dirty || !canApply()) return;
        if (cloud.revision !== cache.revision && cloud.data) {
          const fresh = { state: localize(cloud.data, cache.state), revision: cloud.revision, base: D.portable(cloud.data), dirty: false };
          storage.setItem(key(user.uid), JSON.stringify(fresh));
          cache = fresh; apply(cache.state);
        }
        report(cache.dirty ? 'pending' : 'synced', cache.dirty ? 'Saving your latest changes…' : 'Saved to your account');
      } catch (error) { if (generation === epoch) report('error', 'Could not reach cloud storage. Your device copy is safe.'); }
    }
    async function signOut() {
      await flush();
      if (cache?.dirty) throw new Error('Some changes haven’t reached your account yet. Reconnect, then sign out.');
      await remote.signOut();
      // Firebase's auth listener restores the untouched guest notebook.
    }
    return { save, flush, refresh, switchUser, signOut,
      currentUser: () => user, pending: () => !!cache?.dirty,
      recovery: () => user ? read(`dayblock.recovery.v1:${user.uid}`) : null };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockCloudSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
