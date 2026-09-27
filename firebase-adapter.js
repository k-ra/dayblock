/* Loaded only when cloud sign-in is configured and served over HTTP(S). */
window.DayblockFirebase = {
  async create(config) {
    const [appSDK, authSDK, dbSDK, fnSDK] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js'),
    ]);
    const app = appSDK.initializeApp(config, 'dayblock');
    const auth = authSDK.getAuth(app);
    // Stay signed in on this browser until you sign out, so reopening Dayblock
    // lands straight in your notebooks. Each account keeps its own device copy.
    await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
    const db = dbSDK.getFirestore(app);
    const ref = uid => dbSDK.doc(db, 'users', uid, 'notebooks', 'main');
    // Sign-in asks only for name and email. Calendar access is optional and asked
    // for separately, only when someone taps "connect calendar" (it's a sensitive
    // Google permission). Google's calendar tokens last about an hour.
    const CALENDAR = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
    const provider = (hint, calendar = false) => {
      const p = new authSDK.GoogleAuthProvider();
      if (calendar) p.addScope(CALENDAR);
      p.setCustomParameters(hint ? { login_hint: hint } : { prompt: 'select_account' });
      return p;
    };
    let onToken = () => {};
    let authChanged = () => {};

    const tokenFrom = result => {
      const accessToken = authSDK.GoogleAuthProvider.credentialFromResult(result)?.accessToken;
      return accessToken ? { accessToken, expiresIn: 3600 } : null;
    };
    function unpack(snapshot) {
      if (!snapshot.exists()) return { revision: 0, data: null };
      const doc = snapshot.data();
      if (doc.schema !== 1 || !Number.isInteger(doc.revision) || typeof doc.payload !== 'string') throw new Error('Unsupported cloud notebook format.');
      return { revision: doc.revision, data: window.DayblockCloudData.validate(JSON.parse(doc.payload)) };
    }
    return {
      onAuth: callback => { authChanged = callback; return authSDK.onAuthStateChanged(auth, callback); },
      async signIn() {
        // Plain sign-in: its Google token has no calendar permission, so it isn't used.
        const guest = auth.currentUser?.isAnonymous ? auth.currentUser : null;
        if (!guest) return authSDK.signInWithPopup(auth, provider());
        // Upgrade the browser's anonymous ID in place, so its free-sort count
        // carries over. If this Google account already exists, just sign in to it.
        try {
          const result = await authSDK.linkWithPopup(guest, provider());
          authChanged(auth.currentUser);   // linking doesn't fire an auth change
          return result;
        } catch (error) {
          const credential = authSDK.GoogleAuthProvider.credentialFromError(error);
          if (credential && ['auth/credential-already-in-use', 'auth/email-already-in-use'].includes(error.code)) return authSDK.signInWithCredential(auth, credential);
          throw error;
        }
      },
      onCalendarToken: callback => { onToken = callback; },
      // A fresh calendar token for the signed-in person (opens Google's popup).
      async calendarToken() {
        if (!auth.currentUser) throw new Error('Not signed in.');
        const token = tokenFrom(await authSDK.reauthenticateWithPopup(auth.currentUser, provider(auth.currentUser.email, true)));
        if (!token) throw new Error('No calendar access.');
        return token;
      },
      signedIn: () => !!auth.currentUser,
      // The browser may save or remove its own key, but cannot read it back.
      // Only provider metadata comes back from the server.
      async readSecret(uid) {
        if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
        const call = fnSDK.httpsCallable(fnSDK.getFunctions(app, 'us-central1'), 'aiKeyStatus');
        const status = (await call()).data;
        return ['anthropic', 'openai'].includes(status?.provider) ? { provider: status.provider } : null;
      },
      writeSecret: (uid, { provider, key }) => dbSDK.setDoc(dbSDK.doc(db, 'users', uid, 'secrets', 'ai'), { provider, key, updatedAt: dbSDK.serverTimestamp() }),
      deleteSecret: uid => dbSDK.deleteDoc(dbSDK.doc(db, 'users', uid, 'secrets', 'ai')),
      // The server uses the account's key when present, otherwise a free sort.
      async freeSort(text, today) {
        // Free sorts are for signed-in Google accounts: one allowance per person.
        if (!auth.currentUser || auth.currentUser.isAnonymous) throw Object.assign(new Error('Sign in for free sorts.'), { code: 'functions/unauthenticated' });
        const call = fnSDK.httpsCallable(fnSDK.getFunctions(app, 'us-central1'), 'sortNote', { timeout: 30000 });
        return (await call({ text, today })).data;
      },
      async freeSortsUsed() {
        const uid = auth.currentUser?.uid;
        if (!uid) return { used: 0, free: 50 };
        const snapshot = await dbSDK.getDoc(dbSDK.doc(db, 'users', uid, 'usage', 'ai'));
        return snapshot.exists() ? { used: Number(snapshot.data().used) || 0, free: Number(snapshot.data().free) || 50 } : { used: 0, free: 50 };
      },
      signOut: () => authSDK.signOut(auth),
      read: async uid => unpack(await dbSDK.getDocFromServer(ref(uid))),
      async write(uid, data, expectedRevision) {
        const payload = window.DayblockCloudData.serialize(data);
        return dbSDK.runTransaction(db, async transaction => {
          const current = unpack(await transaction.get(ref(uid)));
          if (current.revision !== expectedRevision) {
            const error = new Error('Another device has changed these notebooks. Both copies are safe; choose how to continue.');
            error.code = 'dayblock/conflict';
            throw error;
          }
          const revision = current.revision + 1;
          transaction.set(ref(uid), { schema: 1, revision, payload, updatedAt: dbSDK.serverTimestamp() });
          return revision;
        });
      },
    };
  },
};
