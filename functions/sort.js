/* Free quick-note sorting, paid for by Dayblock, with a per-person allowance.
   Plain module: Firebase and Claude are passed in, so tests can run it directly. */
'use strict';

const FREE_SORTS = 50;              // per person, once (signed in or not)
// Everyone's free sorts share one monthly budget: about $3 at ~$0.0008 a sort.
const MONTHLY_BUDGET = 3750;

class SortError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A date key from the person's own calendar, so "tomorrow" means their tomorrow.
function localNow(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return new Date();
  const [y, m, d] = today.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

const monthOf = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

function createSortNote({ db, serverTimestamp, classify, free = FREE_SORTS, budget = MONTHLY_BUDGET, clock = () => new Date() }) {
  return async function sortNote({ uid, text, today }) {
    if (!uid) throw new SortError('unauthenticated', 'Sign in to use free sorting.');
    const note = String(text || '').trim().slice(0, 1000);
    if (!note) throw new SortError('invalid-argument', 'Nothing to sort.');
    const ref = db.doc(`users/${uid}/usage/ai`);
    const month = db.doc(`usage/${monthOf(clock())}`);
    // Reserve one sort before calling Claude, so two notes at once can't both
    // slip past the allowance or the budget. Only this server writes the counts.
    const used = await db.runTransaction(async tx => {
      const [snapshot, spent] = [await tx.get(ref), await tx.get(month)];
      const count = snapshot.exists ? Number(snapshot.data().used) || 0 : 0;
      const total = spent.exists ? Number(spent.data().sorts) || 0 : 0;
      if (count >= free) throw new SortError('resource-exhausted', 'The free sorts are used up. Add your own key in settings.');
      if (total >= budget) throw new SortError('resource-exhausted', 'Free sorting is resting until next month. Add your own key to keep sorting.');
      tx.set(ref, { used: count + 1, free, updatedAt: serverTimestamp() }, { merge: true });
      tx.set(month, { sorts: total + 1, budget, updatedAt: serverTimestamp() }, { merge: true });
      return count + 1;
    });
    try {
      const result = await classify(note, localNow(today));
      return { result, used, left: Math.max(0, free - used) };
    } catch (error) {
      // A failed sort doesn't count against the allowance.
      await db.runTransaction(async tx => {
        const [snapshot, spent] = [await tx.get(ref), await tx.get(month)];
        const count = snapshot.exists ? Number(snapshot.data().used) || 0 : 0;
        const total = spent.exists ? Number(spent.data().sorts) || 0 : 0;
        tx.set(ref, { used: Math.max(0, count - 1), free, updatedAt: serverTimestamp() }, { merge: true });
        tx.set(month, { sorts: Math.max(0, total - 1), budget, updatedAt: serverTimestamp() }, { merge: true });
      }).catch(() => {});
      throw new SortError('unavailable', 'Claude could not sort this note right now.');
    }
  };
}

// Return null when the account has no personal key, leaving the free path alone.
// Never return the key (or an upstream provider error) to the browser.
function createPersonalSort({ db, classify }) {
  return async function personalSort({ uid, text, today }) {
    if (!uid) throw new SortError('unauthenticated', 'Sign in to sort notes.');
    const note = String(text || '').trim().slice(0, 1000);
    if (!note) throw new SortError('invalid-argument', 'Nothing to sort.');
    const snapshot = await db.doc(`users/${uid}/secrets/ai`).get();
    if (!snapshot.exists) return null;
    const { provider, key } = snapshot.data();
    if (!['anthropic', 'openai'].includes(provider) || typeof key !== 'string' || !key) {
      throw new SortError('failed-precondition', 'Reconnect your AI key in settings.');
    }
    try {
      const result = await classify(note, localNow(today), provider, key);
      return { result, personal: true, provider };
    } catch (_) {
      throw new SortError('unavailable', 'Your AI key could not sort this note. Check it in settings.');
    }
  };
}

module.exports = { FREE_SORTS, MONTHLY_BUDGET, SortError, createSortNote, createPersonalSort, localNow };
