import test from 'node:test';
import assert from 'node:assert/strict';
import { HistorySourceError, collectRecentHistory, fetchUserHistory } from '../src/collect.js';

function mockResponse(status, payload, text = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
    async text() { return text; },
  };
}

test('fetches documented Toki history array', async () => {
  let requested;
  const fetchImpl = async (url, options) => {
    requested = { url: String(url), options };
    return mockResponse(200, [{
      mal_url: { mal_id: 1535, url: 'https://myanimelist.net/anime/1535' },
      increment: 2,
      date: '2026-11-14T10:00:00+00:00',
    }]);
  };
  const rows = await fetchUserHistory('TiMEZ4I3eth', 'anime', 'http://127.0.0.1:3000', fetchImpl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].increment, 2);
  assert.match(requested.url, /users\/TiMEZ4I3eth\/history\?type=anime$/);
  assert.equal(requested.options.headers.Accept, 'application/json');
});

test('accepts wrapped data array', async () => {
  const rows = await fetchUserHistory('TiMEZ4I3eth', 'manga', 'http://127.0.0.1:3000', async () => mockResponse(200, { data: [] }));
  assert.deepEqual(rows, []);
});

test('rejects unexpected response shape', async () => {
  await assert.rejects(
    () => fetchUserHistory('TiMEZ4I3eth', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(200, { unexpected: true })),
    HistorySourceError,
  );
});

test('rejects malformed rows instead of silently filtering them out', async () => {
  await assert.rejects(
    () => fetchUserHistory('u', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(200, [
      { mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-14T10:00:00Z' },
      null,
    ])),
    /invalid anime history row at position 2/,
  );
});

test('rejects a history row without a usable anime identity', async () => {
  await assert.rejects(
    () => fetchUserHistory('u', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(200, [
      { mal_url: {}, increment: 1, date: '2026-11-14T10:00:00Z' },
    ])),
    /no usable ID or URL/,
  );
});

test('rejects an invalid increment instead of importing a partial total', async () => {
  for (const increment of [undefined, '2', 1.5]) {
    const row = { mal_url: { mal_id: 1 }, increment, date: '2026-11-14T10:00:00Z' };
    if (increment === undefined) delete row.increment;
    await assert.rejects(
      () => fetchUserHistory('u', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(200, [row])),
      /increment must be an integer/,
    );
  }
});

test('accepts a negative integer increment so the tracker can ignore non-contribution changes', async () => {
  const rows = await fetchUserHistory('u', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(200, [
    { mal_url: { mal_id: 1 }, increment: -1, date: '2026-11-14T10:00:00Z' },
  ]));
  assert.equal(rows[0].increment, -1);
});

test('reports forbidden response clearly', async () => {
  await assert.rejects(
    () => fetchUserHistory('TiMEZ4I3eth', 'anime', 'http://127.0.0.1:3000', async () => mockResponse(403, {}, 'Forbidden')),
    /HTTP 403/,
  );
});

test('encodes usernames safely in endpoint URL', async () => {
  let requestUrl = '';
  await fetchUserHistory('user name', 'anime', 'http://127.0.0.1:3000', async (url) => {
    requestUrl = String(url);
    return mockResponse(200, []);
  });
  assert.match(requestUrl, /user%20name/);
});

test('collectRecentHistory requests anime only and never manga', async () => {
  const requested = [];
  const history = await collectRecentHistory('TiMEZ4I3eth', 'http://127.0.0.1:3000', async (url) => {
    requested.push(String(url));
    return mockResponse(200, [{ mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-14T10:00:00+00:00' }]);
  });
  assert.equal(requested.length, 1);
  assert.match(requested[0], /type=anime$/);
  assert.equal(history.anime.length, 1);
  assert.deepEqual(history.manga, []);
});

// ---- Retry behaviour (no real waiting: sleep is injected) ----

function withHeaders(response, headers) {
  return { ...response, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

const GOOD_ROWS = [{ mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-14T10:00:00+00:00' }];

test('HTTP 429 waits 30s, 60s, 90s and then succeeds on the 4th attempt', async () => {
  const waits = [];
  let calls = 0;
  const fetchImpl = async () => (++calls < 4 ? mockResponse(429, null) : mockResponse(200, GOOD_ROWS));
  const rows = await fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async (ms) => { waits.push(ms); } });
  assert.equal(rows.length, 1);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [30_000, 60_000, 90_000]);
});

test('HTTP 429 honours Retry-After (capped at 120s)', async () => {
  const waits = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return withHeaders(mockResponse(429, null), { 'retry-after': '45' });
    if (calls === 2) return withHeaders(mockResponse(429, null), { 'retry-after': '9999' });
    return mockResponse(200, GOOD_ROWS);
  };
  await fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [45_000, 120_000]);
});

test('gives up after 4 attempts and reports the status', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return mockResponse(429, null); };
  await assert.rejects(
    fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async () => {} }),
    (error) => error instanceof HistorySourceError && error.status === 429,
  );
  assert.equal(calls, 4);
});

test('HTTP 500 and 503 use short delays', async () => {
  const waits = [];
  const statuses = [500, 503];
  const fetchImpl = async () => (statuses.length ? mockResponse(statuses.shift(), null, 'boom') : mockResponse(200, GOOD_ROWS));
  await fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [2_000, 4_000]);
});

test('HTTP 403 and 404 are not retried', async () => {
  for (const status of [403, 404]) {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return mockResponse(status, null); };
    await assert.rejects(
      fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async () => { throw new Error('must not sleep'); } }),
      HistorySourceError,
    );
    assert.equal(calls, 1);
  }
});

test('network errors are retried', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return mockResponse(200, GOOD_ROWS);
  };
  const rows = await fetchUserHistory('u', 'anime', 'http://x', fetchImpl, { sleepImpl: async () => {} });
  assert.equal(rows.length, 1);
  assert.equal(calls, 3);
});
