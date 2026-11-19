import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeHistoryPayload } from '../src/collect.js';
import { applyHistory, normalizeHistory } from '../src/tracker.js';

const NOW = new Date('2026-11-18T03:00:00Z'); // 10:00 in Bangkok
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/toki-history.json', import.meta.url), 'utf8'));

function rows() {
  return decodeHistoryPayload(structuredClone(fixture), 'anime');
}

test('fixture: Toki payload decodes to rows and ignores the wrapper', () => {
  assert.equal(rows().length, 6);
});

test('fixture: counts per Bangkok day, skipping zero-increment and undated rows', () => {
  const events = normalizeHistory({ anime: rows() }, NOW);
  assert.equal(events.length, 4);
  const perDay = {};
  for (const e of events) perDay[e.date] = (perDay[e.date] ?? 0) + e.increment;
  // 17 Nov 22:15 / 21:40 Pacific are 18 Nov 13:15 / 12:40 in Bangkok; 16 Nov 08:05 Pacific is
  // 16 Nov 23:05 in Bangkok; 12 Nov 19:30 Pacific is 13 Nov 10:30 in Bangkok.
  assert.deepEqual(perDay, { '2026-11-18': 2, '2026-11-16': 3, '2026-11-13': 1 });
});

test('fixture: fingerprints are unique, hex, and do not contain titles or URLs', () => {
  const events = normalizeHistory({ anime: rows() }, NOW);
  const prints = events.map((e) => e.fingerprint);
  assert.equal(new Set(prints).size, prints.length);
  for (const p of prints) assert.match(p, /^[0-9a-f]{64}$/);
});

test('fixture: fingerprints do not depend on row order', () => {
  const a = normalizeHistory({ anime: rows() }, NOW).map((e) => e.fingerprint).sort();
  const b = normalizeHistory({ anime: rows().reverse() }, NOW).map((e) => e.fingerprint).sort();
  assert.deepEqual(a, b);
});

test('fixture: only the DAY matters, a different time of day on the same day is the same event', () => {
  const state = { schema_version: 2, username: 'u', seen_events: {}, daily: {} };
  applyHistory(state, { anime: rows() }, NOW);
  const shifted = rows().map((row) => ({
    ...row,
    // same Bangkok day, only the minutes differ (e.g. MAL re-rounded the displayed time)
    date: row.date ? row.date.replace(/:\d\d:00-08:00$/, ':59:00-08:00') : row.date,
  }));
  const { summary } = applyHistory(state, { anime: shifted }, new Date('2026-11-18T09:00:00Z'));
  assert.equal(summary.events_added, 0);
  assert.equal(state.daily['2026-11-18'].anime, 2);
});

test('fixture: two real episodes of the same anime on one day are both kept across runs', () => {
  const state = { schema_version: 2, username: 'u', seen_events: {}, daily: {} };
  const first = rows().slice(0, 1); // only the first episode is visible in run 1
  applyHistory(state, { anime: first }, NOW);
  assert.equal(state.daily['2026-11-18'].anime, 1);
  applyHistory(state, { anime: rows() }, NOW); // run 2 also shows the earlier episode
  assert.equal(state.daily['2026-11-18'].anime, 2);
  applyHistory(state, { anime: rows() }, NOW); // run 3 changes nothing
  assert.equal(state.daily['2026-11-18'].anime, 2);
});

test('legacy (time-based) fingerprints already in state.json are not re-counted after upgrade', () => {
  const events = normalizeHistory({ anime: rows() }, NOW);
  const state = {
    schema_version: 2,
    username: 'u',
    seen_events: Object.fromEntries(events.map((e) => [e.legacyFingerprint, e.date])),
    daily: { '2026-11-18': { anime: 2, manga: 0, total: 2 }, '2026-11-17': { anime: 3, manga: 0, total: 3 }, '2026-11-13': { anime: 1, manga: 0, total: 1 } },
    first_import_at: '2026-11-16T06:26:56+07:00',
  };
  const { summary } = applyHistory(state, { anime: rows() }, NOW);
  assert.equal(summary.events_added, 0);
  assert.equal(state.daily['2026-11-18'].anime, 2);
  // ... and they are re-keyed to the date-based fingerprint for the future
  for (const e of events) assert.ok(Object.hasOwn(state.seen_events, e.fingerprint));
});
