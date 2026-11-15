import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COLORS, levelFor, makeCalendarData, renderHeatmapPng, writeSite } from '../src/render.js';

test('activity levels use the blue MAL-inspired ramp', () => {
  assert.deepEqual(COLORS, ['#161b22', '#172f50', '#214b78', '#2f70ad', '#58a6e7']);
  assert.deepEqual([0, 1, 3, 6, 11].map(levelFor), [0, 1, 2, 3, 4]);
});

test('calendar contains about 365 days and begins on Sunday', () => {
  const { start, cells } = makeCalendarData({}, '2026-11-16');
  assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 0);
  assert.ok(cells.length >= 365 && cells.length <= 371);
  assert.equal(cells.at(-1).date, '2026-11-16');
});

test('writes valid PNG, activity JSON, and public HTML', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-heatmap-'));
  try {
    const cells = [{ date: '2026-11-16', anime: 2, manga: 1, total: 3 }];
    const pngPath = path.join(temp, 'test.png');
    await renderHeatmapPng('TiMEZ4I3eth', cells, '2026-11-15', pngPath);
    const png = await fs.readFile(pngPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const output = path.join(temp, 'site');
    await writeSite({ daily: { '2026-11-16': { anime: 2, manga: 1, total: 3 } }, first_import_at: null, last_sync_at: null }, 'TiMEZ4I3eth', output, {
      now: new Date('2026-11-16T03:00:00Z'),
      repository: 'jirayuwongtom/mal-heatmap-local',
    });
    const activity = JSON.parse(await fs.readFile(path.join(output, 'activity.json'), 'utf8'));
    const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.equal(activity.username, 'TiMEZ4I3eth');
    assert.ok(html.includes('https://jirayuwongtom.github.io/mal-heatmap-local/heatmap.png'));
    assert.ok(html.includes('--blue4:#58a6e7'));
    assert.ok(html.includes('Copy BBCode'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
