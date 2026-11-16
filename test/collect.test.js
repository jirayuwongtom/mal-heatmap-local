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
