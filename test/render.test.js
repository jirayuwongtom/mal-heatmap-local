import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COLORS, levelFor, makeCalendarData, makeYearCalendarData, renderHeatmapPng, writeSite } from '../src/render.js';

test('activity levels use the blue MAL-inspired ramp', () => {
  assert.deepEqual(COLORS, ['#161b22', '#172f50', '#214b78', '#2f70ad', '#58a6e7']);
  assert.deepEqual([0, 1, 3, 6, 11].map(levelFor), [0, 1, 2, 3, 4]);
});

test('calendar is a full calendar year with a Sunday-first grid', () => {
  const { year, start, cells } = makeYearCalendarData({}, 2026);
  assert.equal(year, 2026);
  assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(cells.length, 365);
  assert.equal(cells[0].date, '2026-01-01');
  assert.equal(cells.at(-1).date, '2026-12-31');
});

test('leap years contain 366 daily cells', () => {
  const { cells } = makeYearCalendarData({}, 2028);
  assert.equal(cells.length, 366);
  assert.equal(cells[58].date, '2028-02-28');
  assert.equal(cells[59].date, '2028-02-29');
  assert.equal(cells[60].date, '2028-03-01');
});

test('compatibility calendar helper now returns the full year', () => {
  const { start, cells } = makeCalendarData({}, '2026-11-16');
  assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(cells.length, 365);
  assert.equal(cells.at(-1).date, '2026-12-31');
});

test('writes current-year PNG, permanent yearly archives, activity JSON, and year selector', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-heatmap-'));
  try {
    const state = {
      daily: {
        '2026-01-03': { anime: 2, manga: 1, total: 3 },
        '2026-11-16': { anime: 2, manga: 1, total: 3 },
      },
      first_import_at: null,
      last_sync_at: null,
    };
    const output = path.join(temp, 'site');
    await writeSite(state, 'TiMEZ4I3eth', output, {
      now: new Date('2026-11-16T03:00:00Z'),
      repository: 'jirayuwongtom/mal-heatmap-local',
    });

    for (const name of ['heatmap.png', 'heatmap-2026.png']) {
      const png = await fs.readFile(path.join(output, name));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }

    const activity = JSON.parse(await fs.readFile(path.join(output, 'activity.json'), 'utf8'));
    const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.equal(activity.username, 'TiMEZ4I3eth');
    assert.equal(activity.current_year, 2026);
    assert.deepEqual(activity.years, [2026]);
    assert.equal(activity.range_start, '2026-01-01');
    assert.equal(activity.range_end, '2026-11-16');
    assert.equal(activity.daily.length, 365);
    assert.ok(html.includes('<img id="heatmap-image" src="heatmap.png"'));
    assert.ok(html.includes('id="year-select"'));
    assert.ok(html.includes("'heatmap-' + year + '.png'"));
    assert.ok(html.includes('background:#000'));
    assert.ok(html.includes('width:min(880px,100%)'));
    assert.ok(html.includes('[img]https://jirayuwongtom.github.io/mal-heatmap-local/heatmap.png[/img]'));
    assert.ok(html.includes('id="copy-bbcode"'));
    assert.ok(html.includes('Copy BBCode'));
    assert.ok(html.includes('navigator.clipboard?.writeText'));
    assert.ok(html.includes("document.execCommand('copy')"));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('new year uses new current image but keeps previous year archive', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-heatmap-new-year-'));
  try {
    const state = {
      daily: {
        '2026-12-31': { anime: 3, manga: 0, total: 3 },
        '2027-01-01': { anime: 0, manga: 2, total: 2 },
      },
    };
    const output = path.join(temp, 'site');
    await writeSite(state, 'TiMEZ4I3eth', output, {
      now: new Date('2027-01-01T03:00:00Z'),
      repository: 'jirayuwongtom/mal-heatmap-local',
    });

    for (const name of ['heatmap.png', 'heatmap-2026.png', 'heatmap-2027.png']) {
      const png = await fs.readFile(path.join(output, name));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
    const activity = JSON.parse(await fs.readFile(path.join(output, 'activity.json'), 'utf8'));
    const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.equal(activity.current_year, 2027);
    assert.deepEqual(activity.years, [2026, 2027]);
    assert.equal(activity.range_start, '2027-01-01');
    assert.equal(activity.daily.length, 365);
    assert.ok(html.includes('<option value="2027" selected>2027</option>'));
    assert.ok(html.includes('<option value="2026">2026</option>'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
