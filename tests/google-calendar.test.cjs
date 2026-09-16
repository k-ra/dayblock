const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeEvents, eventsOnDate, windowFor, SCOPE } = require('../google-calendar.js');
const timed = (id, start, end, extra = {}) => ({ id, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra });

test('normalization deduplicates, omits cancellations, and strips unsafe links', () => {
  const events = normalizeEvents([
    timed('a', '2026-09-15T10:00:00-07:00', '2026-09-15T11:00:00-07:00'),
    timed('a', '2026-09-15T12:00:00-07:00', '2026-09-15T13:00:00-07:00', { summary: 'Updated', htmlLink: 'javascript:alert(1)' }),
    timed('b', '2026-09-15T12:00:00-07:00', '2026-09-15T13:00:00-07:00', { status: 'cancelled' }),
    timed('invalid', 'bad', 'bad'),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Updated');
  assert.equal(events[0].url, '');
});

test('all-day dates have an exclusive end and overnight events span days', () => {
  const events = normalizeEvents([
    { id: 'trip', start: { date: '2026-09-15' }, end: { date: '2026-09-17' } },
    timed('late', '2026-09-15T23:00:00-07:00', '2026-09-16T01:00:00-07:00'),
  ]);
  assert.equal(eventsOnDate(events, '2026-09-17').length, 0);
  const first = eventsOnDate(events, '2026-09-15');
  const second = eventsOnDate(events, '2026-09-16');
  assert.equal(first[1].start, 23); assert.equal(first[1].end, 24);
  assert.equal(second[1].start, 0); assert.equal(second[1].end, 1);
  assert.equal(second[1].readonly, true);
  assert.equal(second[1].source.start, '2026-09-15T23:00:00-07:00');
});

test('import window covers the prior, displayed, and following month', () => {
  const window = windowFor('2026-01-15');
  assert.equal(new Date(window.start).getMonth(), 11);
  assert.equal(new Date(window.start).getFullYear(), 2025);
  assert.equal(new Date(window.end).getMonth(), 2);
});

function harness(fetcher) {
  let config, saved, status, requestOptions;
  const fakeWindow = { location: { protocol: 'https:' }, setTimeout, clearTimeout,
    google: { accounts: { oauth2: {
      initTokenClient(options) { config = options; return { requestAccessToken(options) { requestOptions = options; } }; },
      hasGrantedAllScopes: (_, scope) => scope === SCOPE,
    } } },
  };
  const context = { window: fakeWindow, URL, URLSearchParams, AbortController, Intl, Date, Map };
  vm.runInNewContext(fs.readFileSync(require.resolve('../google-calendar.js'), 'utf8'), context);
  const client = fakeWindow.DayblockCalendar.createClient({ clientId: 'test.apps.googleusercontent.com', fetcher,
    onEvents: data => { saved = data; }, onStatus: value => { status = value; } });
  return { client, getConfig: () => config, getSaved: () => saved, getStatus: () => status, getRequest: () => requestOptions };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('requests only read-only scope and GET; paginated import replaces the snapshot', async () => {
  const calls = [];
  const first = timed('one', '2026-09-15T10:00:00-07:00', '2026-09-15T11:00:00-07:00');
  let secondRefresh = false;
  const h = harness(async (url, options) => {
    calls.push({ url, options });
    const page2 = new URL(url).searchParams.has('pageToken');
    return { ok: true, json: async () => secondRefresh ? { items: [] } : page2 ? { items: [first] } : { items: [first], nextPageToken: 'next' } };
  });
  await h.client.prepare();
  h.client.connect(windowFor('2026-09-15'));
  assert.equal(h.getConfig().scope, SCOPE);
  assert.equal(h.getConfig().include_granted_scopes, false);
  assert.equal(h.getRequest().prompt, '');
  h.getConfig().callback({ access_token: 'synthetic-test-token', expires_in: 3600 });
  await flush();
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.options.method === 'GET'));
  assert.equal(new URL(calls[1].url).searchParams.get('pageToken'), 'next');
  assert.equal(h.getSaved().events.length, 1);
  secondRefresh = true;
  await h.client.refresh(windowFor('2026-09-15'), true);
  assert.equal(h.getSaved().events.length, 0);
  h.client.disconnect(); assert.equal(h.client.validToken(), '');
});

test('failed pagination never commits partial results; expired tokens require reconnect', async () => {
  let count = 0;
  const h = harness(async () => ++count === 1
    ? { ok: true, json: async () => ({ items: [], nextPageToken: 'next' }) }
    : { ok: false, status: 401 });
  await h.client.prepare(); h.client.connect(windowFor('2026-09-15'));
  h.getConfig().callback({ access_token: 'synthetic-test-token', expires_in: 3600 });
  await flush();
  assert.equal(h.getSaved(), undefined);
  assert.equal(h.getStatus().phase, 'reconnect');
  h.client.disconnect();
});

test('missing app client ID cannot start authentication or fetch events', async () => {
  let status;
  const { createClient } = require('../google-calendar.js');
  const client = createClient({ clientId: '', onStatus: value => { status = value; }, onEvents: () => assert.fail('Unexpected import'), fetcher: () => assert.fail('Unexpected request') });
  assert.equal(await client.prepare(), false);
  assert.equal(status.phase, 'unconfigured');
});
