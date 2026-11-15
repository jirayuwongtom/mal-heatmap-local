import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistory, normalizeHistory, parseMalDateTime } from '../src/tracker.js';

const BANGKOK_NOW = new Date('2026-11-15T13:00:00Z');

test('first run backfills visible recent history', () => {
  const state = { schema_version: 2, username: 'TiMEZ4I3eth', seen_events: {}, daily: {} };
  const history = {
    anime: [{ mal_url: { mal_id: 1535, url: 'https://myanimelist.net/anime/1535' }, increment: 2, date: '2026-11-14T10:00:00+00:00' }],
    manga: [{ mal_url: { mal_id: 123, url: 'https://myanimelist.net/manga/123' }, increment: 5, date: '2026-11-14T10:30:00+00:00' }],
  };
  const { state: updated, summary } = applyHistory(state, history, BANGKOK_NOW);
  assert.equal(summary.first_import, true);
  assert.equal(summary.events_added, 2);
  assert.deepEqual(updated.daily['2026-11-14'], { anime: 2, manga: 5, total: 7 });
  assert.ok(updated.first_import_at);
});

test('repeated poll does not double-count same history', () => {
  const state = { schema_version: 2, username: 'TiMEZ4I3eth', seen_events: {}, daily: {} };
  const history = { anime: [{ mal_url: { url: 'https://myanimelist.net/anime/1535' }, increment: 3, date: '2026-11-14T10:00:00+00:00' }], manga: [] };
  applyHistory(state, history, BANGKOK_NOW);
  const { summary } = applyHistory(state, history, new Date('2026-11-15T14:00:00Z'));
  assert.equal(summary.events_added, 0);
  assert.equal(state.daily['2026-11-14'].total, 3);
});

test('two identical rows in one response are counted twice', () => {
  const row = { mal_url: { url: 'https://myanimelist.net/anime/1535' }, increment: 1, date: '2026-11-14T10:00:00+00:00' };
  const events = normalizeHistory({ anime: [row, row], manga: [] });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].fingerprint, events[1].fingerprint);
});

test('missing dates and zero increments are ignored', () => {
  const history = { anime: [
    { mal_url: { mal_id: 1 }, increment: 1, date: null },
    { mal_url: { mal_id: 2 }, increment: 0, date: '2026-11-14T10:00:00+00:00' },
  ], manga: [] };
  assert.deepEqual(normalizeHistory(history), []);
});

test('timestamp is converted to Bangkok date', () => {
  const events = normalizeHistory({ anime: [{ mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-14T18:00:00+00:00' }], manga: [] });
  assert.equal(events[0].date, '2026-11-15');
});

test('timestamps without timezone are treated as UTC', () => {
  const parsed = parseMalDateTime('2026-11-14T18:00:00');
  assert.equal(parsed.date, '2026-11-15');
  assert.equal(parsed.utcTimestamp, '2026-11-14T18:00:00+00:00');
});

test('keeps already imported fingerprints and daily data intact', () => {
  const state = {
    schema_version: 2,
    username: 'TiMEZ4I3eth',
    seen_events: { 'already-seen': '2026-11-14' },
    daily: { '2026-11-14': { anime: 12, manga: 5, total: 17 } },
  };
  const { state: updated } = applyHistory(state, { anime: [], manga: [] }, BANGKOK_NOW);
  assert.deepEqual(updated.daily['2026-11-14'], { anime: 12, manga: 5, total: 17 });
  assert.equal(updated.seen_events['already-seen'], '2026-11-14');
});
