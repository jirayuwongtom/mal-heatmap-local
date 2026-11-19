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
});

test('healthy history passes silently', () => {
  const r = checkHistoryHealth(recentState, { anime: [{ increment: 1, date: '2026-11-17T10:00:00Z' }] }, NOW);
  assert.deepEqual(r, { error: null, warnings: [] });
});
