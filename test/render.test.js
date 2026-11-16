import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  COLORS, levelFor, makeCalendarData, makeRollingCalendarData, makeYearCalendarData,
  monthLabelColumns, renderHeatmapPng, writeSite,
} from '../src/render.js';

test('activity levels use the blue MAL-inspired ramp', () => {
  assert.deepEqual(COLORS, ['#161b22', '#172f50', '#214b78', '#2f70ad', '#58a6e7']);
});

test('levels are quartiles of the busiest day, like GitHub', () => {
  assert.deepEqual([0, 5, 6, 10, 11, 15, 16, 20].map((n) => levelFor(n, 20)), [0, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(levelFor(3, 0), 0);
  assert.equal(levelFor(1, 1), 4);
});

test('rolling calendar covers 53 Sunday-first weeks ending today with no future days', () => {
  const { start, cells } = makeRollingCalendarData({}, '2026-11-16');
  assert.equal(start, '2025-11-16');
  assert.equal(new Date(`${start}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(cells[0].date, '2025-11-16');
  assert.equal(cells.at(-1).date, '2026-11-16');
  assert.equal(cells.length, 366);
  assert.equal(Math.floor((cells.length - 1) / 7), 52); // today sits in the 53rd (last) column
});

test('only anime episodes are counted, manga values are ignored', () => {
  const { cells } = makeRollingCalendarData({ '2026-11-02': { anime: 12, manga: 202, total: 214 } }, '2026-11-16');
  const cell = cells.find((c) => c.date === '2026-11-02');
  assert.equal(cell.total, 12);
  assert.equal(cell.manga, undefined);
});

test('year calendar can stop at a given day', () => {
  const { cells } = makeYearCalendarData({}, 2026, '2026-11-16');
  assert.equal(cells.length, 320);
  assert.equal(cells.at(-1).date, '2026-11-16');
});

test('month labels sit on the first Sunday in the month and skip partial months', () => {
  const rolling = monthLabelColumns('2025-11-16', 53);
  assert.deepEqual(rolling.slice(0, 2), [{ col: 0, month: 10 }, { col: 3, month: 11 }]);
  assert.deepEqual(rolling.at(-1), { col: 50, month: 10 });
  // 2026 starts on a Thursday: the first column is mostly December, so January's label is column 1.
  assert.deepEqual(monthLabelColumns('2025-12-28', 53)[0], { col: 1, month: 0 });
});

test('a very short year grid still renders a valid PNG', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-heatmap-short-'));
  try {
    const { cells, start } = makeYearCalendarData({}, 2027, '2027-01-02');
    const file = path.join(temp, 'short.png');
    await renderHeatmapPng('TiMEZ4I3eth', cells, start, file, { periodLabel: 'IN 2027' });
    const png = await fs.readFile(file);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
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

test('writes rolling PNG, permanent yearly archives, activity JSON, and period selector', async () => {
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
    assert.equal(activity.range_start, '2025-11-16');
    assert.equal(activity.range_end, '2026-11-16');
    assert.equal(activity.daily.length, 366);
    assert.ok(html.includes('<img id="heatmap-image" src="heatmap.png"'));
    assert.ok(html.includes('id="year-select"'));
    assert.ok(html.includes('<option value="last" selected>Last 12 months</option>'));
    assert.ok(html.includes("'heatmap-' + value + '.png'"));
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

test('new year keeps rolling image and previous year archive', async () => {
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
    assert.equal(activity.range_start, '2025-12-28');
    assert.equal(activity.range_end, '2027-01-01');
    assert.equal(activity.daily.at(-1).date, '2027-01-01');
    assert.ok(html.includes('<option value="last" selected>Last 12 months</option>'));
    assert.ok(html.includes('<option value="2027">2027</option>'));
    assert.ok(html.includes('<option value="2026">2026</option>'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
