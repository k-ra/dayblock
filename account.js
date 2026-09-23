/* Quiet bookshelf account controls; local-only mode works without Firebase. */
window.DayblockAccount = {
  create({ getState, apply, blank, onReport = () => {} }) {
    const D = window.DayblockCloudData;
    const $ = selector => document.querySelector(selector);
    const dialog = $('#accountDialog'), status = $('#accountStatus');
    let remote = null, sync = null, authUser = null, importChoice = null, calendarToken = () => {};
    const quiet = text => String(text || '').replace(/(^|[.!?…]\s+)([A-Z])(?=[a-z])/g, (m, lead, c) => lead + c.toLowerCase());
    function message(text) { status.textContent = quiet(text); }
    function download(data, suffix = 'backup') {
      const blob = new Blob([JSON.stringify({ format: 'dayblock-backup', version: 1, exportedAt: new Date().toISOString(), data: D.portable(data) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `xuan-journals-${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function report({ phase, message: text, user }) {
      message(text);
      $('#accountIdentity').textContent = user?.email || user?.displayName || 'browser notebooks';
      $('#cloudConflict').hidden = phase !== 'conflict';
      $('#cloudSync').hidden = !user;
      $('#cloudSignOut').hidden = !authUser;
      $('#cloudSignIn').hidden = !!user;
      $('#cloudSignIn').disabled = !remote || phase === 'loading';
      $('#cloudSignOut').disabled = phase === 'loading';
      $('#cloudRecovery').hidden = !sync?.recovery();
      const issue = ['error', 'conflict'].includes(phase);
      $('#accountNotice').hidden = !issue;
      $('#accountNotice').textContent = phase === 'conflict' ? 'account · sync conflict' : 'account · needs attention';
      $('#accountLauncher').textContent = user ? 'account' : 'sign in / backup';
      onReport({ phase, message: text, user, available: !!remote });
    }
    $('#accountLauncher').onclick = $('#accountNotice').onclick = () => dialog.showModal();
    $('#accountClose').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { if (importChoice) { importChoice(false); importChoice = null; $('#cloudImportChoice').hidden = true; } });
    $('#cloudImportYes').onclick = () => { importChoice?.(true); importChoice = null; $('#cloudImportChoice').hidden = true; };
    $('#cloudImportNo').onclick = () => { importChoice?.(false); importChoice = null; $('#cloudImportChoice').hidden = true; };
    $('#exportBackup').onclick = () => download(getState());
    $('#cloudRecovery').onclick = () => { const data = sync?.recovery(); if (data) download(data, 'recovery'); };
    $('#importBackup').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 5000000) throw new Error('Backup is too large (5 MB maximum).');
        const incoming = D.parseBackup(await file.text());
        const current = getState();
        const merged = D.merge(current, incoming);
        merged.settings.paperPreferences = D.clone(current.settings.paperPreferences || {});
        merged.googleCalendar = D.clone(current.googleCalendar || { events: [], updatedAt: null });
        localStorage.setItem('dayblock.before-file-import.v1', JSON.stringify(current));
        if (sync) sync.save(merged); else localStorage.setItem('spread-planner.v1', JSON.stringify(merged));
        apply(merged);
        message('Backup imported. Existing entries were kept; differing copies may appear twice.');
      } catch (error) { message(error.message); }
      event.target.value = '';
    };
    $('#cloudSync').onclick = () => sync?.refresh();
    $('#cloudCombine').onclick = () => sync?.resolve(true);
    $('#cloudUseRemote').onclick = () => sync?.resolve(false);
    $('#cloudSignOut').onclick = async () => {
      try { if (sync?.currentUser()) await sync.signOut(); else await remote?.signOut(); }
      catch (error) { message(error.message); }
    };
    $('#cloudSignIn').onclick = async () => {
      if (!remote) return;
      try { if (authUser) await sync.switchUser(authUser); else await remote.signIn(); }
      catch (error) {
        const help = {
          'auth/popup-blocked': 'Allow popups for xuan journals, then try again. On your phone, open it in Safari or Chrome.',
          'auth/popup-closed-by-user': 'Sign-in cancelled. Your notebooks are unchanged.',
          'auth/unauthorized-domain': 'This address is not enabled for sign-in. Add its domain in Firebase Authentication settings.',
          'auth/operation-not-allowed': 'Enable Google under Firebase Authentication → Sign-in method.',
        };
        message(help[error.code] || 'Google sign-in failed. Check your connection and Firebase setup, then try again.');
      }
    };
    async function start() {
      const config = window.DAYBLOCK_FIREBASE_CONFIG;
      if (location.protocol === 'file:') {
        message('This file preview saves only in this browser. Export a backup here, then import it on the live website and sign in there.');
        onReport({ phase: 'unconfigured', user: null, available: false });
        return;
      }
      if (!config || !['apiKey', 'authDomain', 'projectId', 'appId'].every(key => config[key])) {
        message('Cloud sign-in needs the one-time Firebase setup. Your notebooks still save in this browser.');
        onReport({ phase: 'unconfigured', user: null, available: false });
        return;
      }
      try {
        message('Preparing Google sign-in…');
        remote = await window.DayblockFirebase.create(config);
        remote.onCalendarToken(token => calendarToken(token));
        sync = window.DayblockCloudSync.create({ remote, storage: localStorage, getState, apply, blank, status: report,
          canApply: () => !document.activeElement?.isContentEditable && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && !document.body.classList.contains('dragging') && !document.querySelector('dialog[open]'),
          chooseImport: user => new Promise(resolve => {
            importChoice?.(false); importChoice = resolve;
            $('#cloudImportText').textContent = `import this browser’s notebooks into ${user.email || 'your account'}? Existing cloud entries will be kept. Different versions of an entry are kept as separate copies.`;
            $('#cloudImportChoice').hidden = false;
            if (!dialog.open) dialog.showModal();
          }),
        });
        remote.onAuth(user => {
          authUser = user;
          importChoice?.(false); importChoice = null; $('#cloudImportChoice').hidden = true;
          sync.switchUser(user);
        });
      } catch (error) { message('Cloud sign-in could not load. Check your connection and Firebase configuration. Local notebooks still work.'); }
    }
    window.addEventListener('online', () => sync?.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) sync?.flush(); else sync?.refresh();
    });
    window.addEventListener('beforeunload', event => { if (sync?.pending()) { event.preventDefault(); event.returnValue = ''; } });
    setInterval(() => { if (!document.hidden) sync?.refresh(); }, 60000);
    start();
    const calendar = {
      available: () => !!remote && !!authUser,
      request: () => remote.calendarToken(),
      onToken: callback => { calendarToken = callback; },
    };
    return { calendar, open: () => dialog.showModal(), signIn: () => $('#cloudSignIn').click(), available: () => !!remote, save(data) {
      try { if (sync) sync.save(data); else localStorage.setItem('spread-planner.v1', JSON.stringify(data)); }
      catch (error) { message('Could not save on this device. Export a backup now before closing the page.'); $('#accountNotice').hidden = false; $('#accountNotice').textContent = 'account · storage full'; }
    } };
  },
};
