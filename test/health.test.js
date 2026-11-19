import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHistoryHealth } from '../src/health.js';

const NOW = new Date('2026-11-18T03:00:00Z');
const recentState = { daily: { '2026-11-15': { anime: 2, manga: 0, total: 2 } } };
const oldState = { daily: { '2026-09-01': { anime: 2, manga: 0, total: 2 } } };

test('0 rows while recent days have activity is a hard error', () => {
  const r = checkHistoryHealth(recentState, { anime: [] }, NOW);
  assert.match(r.error, /0 history rows/);
  assert.match(r.error, /2026-11-15/);
});

test('0 rows while activity is still inside MAL history visibility window is a hard error', () => {
  const state = { daily: { '2026-11-03': { anime: 4, manga: 0, total: 4 } } };
  const r = checkHistoryHealth(state, { anime: [] }, NOW);
  assert.match(r.error, /last 20 days/);
  assert.match(r.error, /2026-11-03/);
});

test('0 rows with no recent activity is only a warning (genuinely idle)', () => {
  const r = checkHistoryHealth(oldState, { anime: [] }, NOW);
  assert.equal(r.error, null);
  assert.equal(r.warnings.length, 1);
});

test('rows where no date is readable is a hard error', () => {
  const r = checkHistoryHealth(oldState, { anime: [{ increment: 1, date: null }, { increment: 1, date: 'garbage' }] }, NOW);
  assert.match(r.error, /readable date/);
});

test('some unreadable dates only warn', () => {
  const r = checkHistoryHealth(oldState, { anime: [{ increment: 1, date: '2026-11-17T10:00:00Z' }, { increment: 1, date: null }] }, NOW);
  assert.equal(r.error, null);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /date=null/);
});

test('an invalid non-null timestamp fails even when other rows are readable', () => {
  const r = checkHistoryHealth(oldState, { anime: [
    { increment: 1, date: '2026-11-17T10:00:00Z' },
    { increment: 1, date: 'not-a-timestamp' },
  ] }, NOW);
  assert.match(r.error, /invalid non-null date/);
});

test('healthy history passes silently', () => {
  const r = checkHistoryHealth(recentState, { anime: [{ increment: 1, date: '2026-11-17T10:00:00Z' }] }, NOW);
  assert.deepEqual(r, { error: null, warnings: [] });
});
