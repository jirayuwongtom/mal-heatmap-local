import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/run.js';

const NOW = new Date('2026-11-18T03:00:00Z');
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/toki-history.json', import.meta.url), 'utf8'));
const noSleep = { sleepImpl: async () => {} };
const quiet = { log: () => {}, warn: () => {} };

/** Fake Toki: `script` is a list of responses {status, body, headers} used in order (last one repeats). */
async function withFakeToki(script, fn) {
  const requests = [];
  let index = 0;
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    res.writeHead(step.status ?? 200, { 'content-type': 'application/json', ...(step.headers ?? {}) });
    res.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function tempProject(stateOverrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-run-'));
  const statePath = path.join(dir, 'state.json');
  const state = { schema_version: 2, username: 'TiMEZ4I3eth', seen_events: {}, daily: {}, ...stateOverrides };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { dir, statePath, siteDir: path.join(dir, 'site') };
}

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

test('run: full pipeline writes state, heatmap.png, yearly PNG, activity.json and page', async () => {
  const p = await tempProject();
  await withFakeToki([{ body: fixture }], async (url, requests) => {
    const result = await main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet });
    assert.equal(result.stateChanged, true);
    assert.equal(result.summary.anime_added, 6);
    assert.match(requests[0], /^\/users\/TiMEZ4I3eth\/history\?type=anime$/);
  });
  const state = await readJson(p.statePath);
  assert.equal(state.daily['2026-11-18'].anime, 2);
  assert.equal(Object.keys(state.seen_events).length, 4);
  for (const file of ['heatmap.png', 'heatmap-2026.png', 'activity.json', 'index.html']) {
    await fs.access(path.join(p.siteDir, file));
  }
  const png = await fs.readFile(path.join(p.siteDir, 'heatmap.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('run: a second run with the same Toki data leaves state.json byte-for-byte unchanged', async () => {
  const p = await tempProject();
  await withFakeToki([{ body: fixture }], async (url) => {
    await main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet });
    const before = await fs.readFile(p.statePath, 'utf8');
    const second = await main({ ...p, tokiBaseUrl: url, now: new Date('2026-11-18T09:00:00Z'), collectOptions: noSleep, ...quiet });
    assert.equal(second.stateChanged, false);
    assert.equal(second.summary.events_added, 0);
    assert.equal(await fs.readFile(p.statePath, 'utf8'), before);
  });
});

test('run: transient 500 / 429 are retried and then succeed', async () => {
  const p = await tempProject();
  await withFakeToki([{ status: 500, body: { error: 'boom' } }, { status: 429, headers: { 'retry-after': '0' } }, { body: fixture }], async (url, requests) => {
    const result = await main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet });
    assert.equal(requests.length, 3);
    assert.equal(result.summary.events_added, 4);
  });
});

test('run: HTTP 403 fails the run and does not touch state or site', async () => {
  const p = await tempProject();
  const before = await fs.readFile(p.statePath, 'utf8');
  await withFakeToki([{ status: 403, body: {} }], async (url) => {
    await assert.rejects(main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet }), /403/);
  });
  assert.equal(await fs.readFile(p.statePath, 'utf8'), before);
  await assert.rejects(fs.access(p.siteDir));
});

test('run: persistent 500 gives up after 4 attempts and fails', async () => {
  const p = await tempProject();
  await withFakeToki([{ status: 500, body: {} }], async (url, requests) => {
    await assert.rejects(main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet }), /500/);
    assert.equal(requests.length, 4);
  });
});

test('run: invalid JSON from Toki fails', async () => {
  const p = await tempProject();
  await withFakeToki([{ body: 'not json' }], async (url) => {
    await assert.rejects(main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet }), /invalid JSON/);
  });
});

test('run: empty history while recent days exist fails and keeps state (silent-failure guard)', async () => {
  const p = await tempProject({ daily: { '2026-11-16': { anime: 3, manga: 0, total: 3 } } });
  const before = await fs.readFile(p.statePath, 'utf8');
  await withFakeToki([{ body: { data: [] } }], async (url) => {
    await assert.rejects(main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet }), /0 history rows/);
  });
  assert.equal(await fs.readFile(p.statePath, 'utf8'), before);
});

test('run: empty history for an idle account succeeds with a warning', async () => {
  const p = await tempProject({ daily: { '2026-08-01': { anime: 3, manga: 0, total: 3 } } });
  const warnings = [];
  await withFakeToki([{ body: { data: [] } }], async (url) => {
    await main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, log: () => {}, warn: (m) => warnings.push(m) });
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning::/);
});

test('run: username mismatch is refused before any request is made', async () => {
  const p = await tempProject({ username: 'someone-else' });
  await withFakeToki([{ body: fixture }], async (url, requests) => {
    await assert.rejects(main({ ...p, tokiBaseUrl: url, now: NOW, collectOptions: noSleep, ...quiet }), /does not match/);
    assert.equal(requests.length, 0);
  });
});
