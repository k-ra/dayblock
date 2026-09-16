/* Read-only Google Calendar. Tokens stay in memory; imported records stay separate. */
(function (root) {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
  const endpoint = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  function safeLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && (url.hostname === 'calendar.google.com' || (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/')))) return url.href;
    } catch (_) { /* optional link */ }
    return '';
  }
  function normalizeEvents(items) {
    const unique = new Map();
    for (const item of items) {
      if (!item.id || item.status === 'cancelled' || !item.start || !item.end) continue;
      const allDay = !!item.start.date;
      const start = allDay ? item.start.date : item.start.dateTime;
      const end = allDay ? item.end.date : item.end.dateTime;
      if (!start || !end || (allDay ? end <= start : !(Date.parse(end) > Date.parse(start)))) continue;
      unique.set(item.id, { id: `google:${item.id}`, title: item.summary || 'Busy', start, end, allDay, url: safeLink(item.htmlLink) });
    }
    return [...unique.values()];
  }
  function eventsOnDate(events, key) {
    const [year, month, day] = key.split('-').map(Number);
    const from = new Date(year, month - 1, day), until = new Date(year, month - 1, day + 1);
    return events.flatMap(event => {
      if (event.allDay) return event.start <= key && event.end > key ? [{ ...event, source: event, readonly: true }] : [];
      const start = new Date(event.start), end = new Date(event.end);
      if (!(start < until && end > from)) return [];
      const hour = d => d.getHours() + d.getMinutes() / 60;
      return [{ ...event, source: event, readonly: true, color: 'blue', start: start <= from ? 0 : hour(start), end: end >= until ? 24 : hour(end) }];
    });
  }
  function windowFor(key) {
    const [year, month] = key.split('-').map(Number);
    return { start: new Date(year, month - 2, 1).toISOString(), end: new Date(year, month + 1, 1).toISOString() };
  }
  function createClient({ clientId, onStatus, onEvents, fetcher = (...args) => root.fetch(...args) }) {
    let client, token = '', expiresAt = 0, pendingWindow, currentWindow, lastSync = 0, aborter, generation = 0, expiryTimer;
    let preparing, busy = false;
    const status = (phase, message) => onStatus({ phase, message });
    const validToken = () => token && Date.now() < expiresAt;
    async function prepare() {
      if (!clientId) { status('unconfigured', 'Google Calendar needs a one-time app setup.'); return false; }
      if (root.location?.protocol === 'file:') { status('unavailable', 'Use the live site or localhost to connect Google Calendar.'); return false; }
      if (client) return true;
      if (preparing) return preparing;
      status('loading', 'Loading Google sign-in…');
      preparing = (async () => {
        try {
          if (!root.google?.accounts?.oauth2) await new Promise((resolve, reject) => {
            const script = root.document.createElement('script');
            const timeout = root.setTimeout(() => { script.remove(); reject(new Error('load')); }, 15000);
            script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
            script.onload = () => { root.clearTimeout(timeout); resolve(); };
            script.onerror = () => { root.clearTimeout(timeout); script.remove(); reject(new Error('load')); };
            root.document.head.append(script);
          });
          client = root.google.accounts.oauth2.initTokenClient({
            client_id: clientId, scope: SCOPE, include_granted_scopes: false,
            callback: response => {
              if (response.error || !response.access_token || !root.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
                status('reconnect', 'Read-only Calendar access was not granted. You can try again.'); return;
              }
              aborter?.abort(); generation++;
              token = response.access_token;
              expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 30) * 1000;
              root.clearTimeout(expiryTimer);
              expiryTimer = root.setTimeout(() => { token = ''; status('reconnect', 'Reconnect to update your calendar. Saved events are still visible.'); }, Math.max(0, expiresAt - Date.now()));
              refresh(pendingWindow, true);
            },
            error_callback: () => status('reconnect', 'Google sign-in was closed or blocked. Try Connect again.'),
          });
          status('ready', 'Your primary calendar · read-only');
          return true;
        } catch (_) { status('error', 'Could not load Google sign-in. Check your connection and try again.'); return false; }
        finally { preparing = null; }
      })();
      return preparing;
    }
    function connect(window) {
      pendingWindow = window;
      if (!client) { prepare(); return; }
      // Must run directly from a click, not a timer or a silent popup on page load.
      try { client.requestAccessToken({ prompt: '' }); }
      catch (_) { status('reconnect', 'Google sign-in could not open. Please try again.'); }
    }
    async function refresh(window, force = false) {
      if (!window || !validToken()) return;
      const sameWindow = currentWindow?.start === window.start && currentWindow?.end === window.end;
      if (!force && sameWindow && (busy || Date.now() - lastSync < 60000)) return;
      aborter?.abort(); aborter = new AbortController();
      const request = ++generation, signal = aborter.signal, auth = token;
      currentWindow = window; busy = true;
      status('syncing', 'Updating Google Calendar…');
      try {
        const events = []; let pageToken = '', calendarName = '';
        do {
          const query = new URLSearchParams({ timeMin: window.start, timeMax: window.end, singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', maxResults: '2500', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, fields: 'summary,nextPageToken,items(id,summary,start,end,status,htmlLink)' });
          if (pageToken) query.set('pageToken', pageToken);
          const response = await fetcher(`${endpoint}?${query}`, { method: 'GET', headers: { Authorization: `Bearer ${auth}` }, signal, cache: 'no-store' });
          if (!response.ok) { const error = new Error('calendar'); error.status = response.status; throw error; }
          const data = await response.json();
          events.push(...(data.items || [])); calendarName = data.summary || calendarName;
          pageToken = data.nextPageToken || '';
        } while (pageToken);
        if (request !== generation) return;
        lastSync = Date.now();
        // Replace a complete imported window, so edits/deletions don't duplicate or linger.
        onEvents({ events: normalizeEvents(events), window, calendarName, updatedAt: new Date(lastSync).toISOString() });
        status('connected', 'Google Calendar is up to date · read-only');
      } catch (error) {
        if (error.name === 'AbortError' || request !== generation) return;
        if (error.status === 401) { token = ''; status('reconnect', 'Reconnect to update your calendar.'); }
        else status('error', error.status === 403 ? 'Calendar access is unavailable. Check the app setup and your Google permissions.' : 'Could not update. Previously imported events are unchanged.');
      } finally { if (request === generation) busy = false; }
    }
    function disconnect() {
      aborter?.abort(); generation++; root.clearTimeout(expiryTimer);
      // Disconnect locally; people can also revoke the grant in their Google account.
      token = ''; expiresAt = 0; currentWindow = null; lastSync = 0; busy = false;
      status('ready', 'Disconnected. Your own planner entries are unchanged.');
    }
    return { prepare, connect, refresh, disconnect, validToken };
  }
  const api = { SCOPE, normalizeEvents, eventsOnDate, windowFor, createClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
