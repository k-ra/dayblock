/* Loaded only when cloud sign-in is configured and served over HTTP(S). */
window.DayblockFirebase = {
  async create(config) {
    const [appSDK, authSDK, dbSDK] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
    ]);
    const app = appSDK.initializeApp(config, 'dayblock');
    const auth = authSDK.getAuth(app);
    // Session-only authentication: closing this tab ends sign-in. Notebook
    // drafts are separate per UID and restored after that user signs in again.
    await authSDK.setPersistence(auth, authSDK.browserSessionPersistence);
    const db = dbSDK.getFirestore(app);
    const ref = uid => dbSDK.doc(db, 'users', uid, 'notebooks', 'main');
    // One Google sign-in also grants read-only calendar access, so the calendar
    // needs no separate OAuth client. Google tokens last about an hour.
    const CALENDAR = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
    const provider = hint => {
      const p = new authSDK.GoogleAuthProvider();
      p.addScope(CALENDAR);
      p.setCustomParameters(hint ? { login_hint: hint } : { prompt: 'select_account' });
      return p;
    };
    let onToken = () => {};
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
      onAuth: callback => authSDK.onAuthStateChanged(auth, callback),
      async signIn() {
        const result = await authSDK.signInWithPopup(auth, provider());
        const token = tokenFrom(result);
        if (token) onToken(token);
        return result;
      },
      onCalendarToken: callback => { onToken = callback; },
      // A fresh calendar token for the signed-in person (opens Google's popup).
      async calendarToken() {
        if (!auth.currentUser) throw new Error('Not signed in.');
        const token = tokenFrom(await authSDK.reauthenticateWithPopup(auth.currentUser, provider(auth.currentUser.email)));
        if (!token) throw new Error('No calendar access.');
        return token;
      },
      signedIn: () => !!auth.currentUser,
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
