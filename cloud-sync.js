/* Revision-checked, local-first sync. Each account remembers the last browser-
   only copy it incorporated, so later signed-out edits can sync automatically
   without re-importing stale pages on every visit. */
(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./cloud-data.js') : root.DayblockCloudData;
  function create({ remote, storage, getState, apply, blank, status, canApply = () => true, delay = 350 }) {
    const guestKey = 'spread-planner.v1';
    let user = null, cache = null, epoch = 0, timer = null, flight = null, phase = 'local';
    const key = id => `dayblock.account.v1:${id}`;
    const guestBaseKey = id => `dayblock.guest-base.v1:${id}`;
    const guestOwnerKey = 'dayblock.guest-owner.v1';
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
      const previousUser = user;
      user = null; cache = null;
      // Clear another account's pages immediately when identities change.
      if (previousUser && next && previousUser.uid !== next.uid) {
        try { apply(localize(read(guestKey) || blank())); }
        catch (error) { report('error', 'Could not open the browser copy. Export your notebooks before continuing.'); return; }
      }
      if (!next) {
        try { apply(localize(read(guestKey) || blank())); }
        catch (error) { report('error', 'Could not open the browser copy. Export your current notebooks before continuing.'); return; }
        report('local', 'Saved in this browser only'); return;
      }
      report('loading', 'Opening your account…');
      try {
        const saved = read(key(next.uid));
        if (saved) {
          D.validate(saved.state);
          if (!Number.isInteger(saved.revision)) throw new Error('Invalid device cache. Export your browser copy before continuing.');
          if (saved.base) D.validate(saved.base);
        }
        const guest = D.portable(read(guestKey) || blank());
        // The former one-time import stored the browser snapshot it considered.
        // Treat it as the first baseline instead of re-importing old, possibly
        // already completed or deleted, browser pages on upgrade.
        const guestBase = read(guestBaseKey(next.uid)) || read(`dayblock.imported.v1:${next.uid}`);
        const guestOwner = read(guestOwnerKey);
        if (guestBase) D.validate(guestBase);
        let cloud;
        try { cloud = await remote.read(next.uid); }
        catch (error) {
          if (generation !== epoch) return;
          if (!saved) throw error;
          cloud = null;
        }
        if (generation !== epoch) return;
        const cloudNeedsRepair = !!cloud?.data && D.canonical(cloud.data) !== D.canonical(D.portable(cloud.data));
        if (cloudNeedsRepair) storage.setItem(`dayblock.recovery.v1:${next.uid}`, JSON.stringify(cloud.data));
        // Use the latest signed-in device edit, comparing it with the revision
        // it last saw. A clean cache only matters if the cloud is unavailable.
        let value = cloud?.data ? D.portable(cloud.data) : saved ? D.portable(saved.state) : D.portable(blank());
        if (cloud?.data && saved?.dirty) {
          storage.setItem(`dayblock.recovery.v1:${next.uid}`, JSON.stringify(saved.state));
          value = saved.base ? D.merge3(saved.base, D.portable(saved.state), value) : D.merge(value, saved.state);
        }
        // Read again after network I/O: browser-only writing during sign-in is
        // an edit too. The previous guest snapshot is its merge baseline.
        const currentGuest = D.portable(read(guestKey) || guest);
        if ((!guestOwner || guestOwner === next.uid) && (D.hasContent(currentGuest) || guestBase)) {
          value = guestBase ? D.merge3(guestBase, currentGuest, value)
            : cloud?.data || saved ? D.merge(value, currentGuest) : currentGuest;
        }
        const baseline = cloud?.data ? D.portable(cloud.data) : saved?.base || null;
        const dirty = !cloud || cloudNeedsRepair || D.canonical(D.portable(value)) !== D.canonical(baseline);
        const opening = { state: localize(value, saved?.state), revision: cloud?.revision ?? saved.revision, base: baseline, dirty: dirty || !!saved?.dirty };
        // Persist the merged account cache before advancing the guest baseline.
        // If storage is full, keep the browser copy untouched and signed out.
        storage.setItem(key(next.uid), JSON.stringify(opening));
        if (!guestOwner || guestOwner === next.uid) {
          storage.setItem(guestBaseKey(next.uid), JSON.stringify(currentGuest));
          if (!guestOwner && D.hasContent(currentGuest)) storage.setItem(guestOwnerKey, JSON.stringify(next.uid));
        }
        user = next; cache = opening;
        apply(cache.state);
        if (cache.dirty && cloud) await flush();
        else if (!cloud) report('error', 'Offline or cloud unavailable. Showing this account’s device copy; reconnect to sync.');
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
