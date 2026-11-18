import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistory, normalizeHistory, parseMalDateTime } from '../src/tracker.js';

const BANGKOK_NOW = new Date('2026-11-15T13:00:00Z');

test('first run backfills visible recent history and ignores manga', () => {
  const state = { schema_version: 2, username: 'TiMEZ4I3eth', seen_events: {}, daily: {} };
  const history = {
    anime: [{ mal_url: { mal_id: 1535, url: 'https://myanimelist.net/anime/1535' }, increment: 2, date: '2026-11-14T10:00:00+00:00' }],
    manga: [{ mal_url: { mal_id: 123, url: 'https://myanimelist.net/manga/123' }, increment: 5, date: '2026-11-14T10:30:00+00:00' }],
  };
  const { state: updated, summary } = applyHistory(state, history, BANGKOK_NOW);
  assert.equal(summary.first_import, true);
  assert.equal(summary.events_added, 1);
  assert.deepEqual(updated.daily['2026-11-14'], { anime: 2, manga: 0, total: 2 });
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

// ---- New Year boundary: MAL prints "Dec 28, 5:03 PM" without a year and Toki assumes this year ----

test('a December row parsed with next year is moved back one year', () => {
  const january = new Date('2027-01-03T05:00:00Z');
  const events = normalizeHistory({
    anime: [{ mal_url: { mal_id: 7 }, increment: 1, date: '2027-12-28T17:03:00+00:00' }],
  }, january);
  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2026-12-29'); // 17:03 UTC is already the 29th in Bangkok
});

test('rows that are not in the future are never shifted', () => {
  const now = new Date('2027-01-03T05:00:00Z');
  const parsed = parseMalDateTime('2027-01-02T10:00:00+00:00', now);
  assert.equal(parsed.year_corrected, false);
  assert.equal(parsed.utcTimestamp, '2027-01-02T10:00:00+00:00');
  // up to 24h ahead is tolerated (clock skew / time zone rounding)
  assert.equal(parseMalDateTime('2027-01-04T04:00:00+00:00', now).year_corrected, false);
  assert.equal(parseMalDateTime('2027-01-05T04:00:00+00:00', now).year_corrected, true);
});

test('fingerprint of a December event is identical in December and in January (no double count)', () => {
  const state = { schema_version: 2, username: 'x', seen_events: {}, daily: {} };
  // 28 Dec 2026 run: Toki resolves the row with the current year (2026).
  const december = { anime: [{ mal_url: { mal_id: 7 }, increment: 2, date: '2026-12-28T17:03:00+00:00' }] };
  applyHistory(state, december, new Date('2026-12-30T05:00:00Z'));
  assert.equal(state.daily['2026-12-29'].anime, 2);

  // 3 Jan 2027 run: the same row now comes back as 2027-12-28.
  const january = { anime: [{ mal_url: { mal_id: 7 }, increment: 2, date: '2027-12-28T17:03:00+00:00' }] };
  const { summary } = applyHistory(state, january, new Date('2027-01-03T05:00:00Z'));
  assert.equal(summary.events_added, 0);
  assert.equal(state.daily['2026-12-29'].anime, 2);
  assert.equal(Object.keys(state.daily).length, 1);
  assert.equal(Object.keys(state.seen_events).length, 1);
});

// ---- State must not change when nothing changed (otherwise every run makes a commit) ----

test('a repeated run with no new events leaves the state byte-for-byte identical', () => {
  const state = { schema_version: 2, username: 'x', seen_events: {}, daily: {} };
  const history = { anime: [{ mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-14T10:00:00+00:00' }] };
  applyHistory(state, history, new Date('2026-11-15T13:00:00Z'));
  const before = JSON.stringify(state);
  applyHistory(state, history, new Date('2026-11-15T19:00:00Z'));
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.last_sync_at, undefined);
  assert.ok(state.last_change_at);
});

test('legacy last_sync_at is removed and last_change_at moves only when events are added', () => {
  const state = {
    schema_version: 2, username: 'x', first_import_at: '2026-11-16T06:26:56+07:00',
    last_sync_at: '2026-11-18T17:05:24+07:00', seen_events: {}, daily: {},
  };
  applyHistory(state, { anime: [] }, new Date('2026-11-18T12:00:00Z'));
  assert.equal('last_sync_at' in state, false);
  assert.equal(state.last_change_at, undefined);
  applyHistory(state, { anime: [{ mal_url: { mal_id: 1 }, increment: 1, date: '2026-11-18T10:00:00+00:00' }] }, new Date('2026-11-18T12:00:00Z'));
  assert.equal(state.last_change_at, '2026-11-18T19:00:00+07:00');
});
