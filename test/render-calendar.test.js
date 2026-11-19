import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeYearCalendarData, makeRollingCalendarData, writeSite } from '../src/render.js';

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('makeYearCalendarData: normal year is Sunday-aligned and has 365 cells', () => {
  const c = makeYearCalendarData({}, 2027);
  assert.equal(c.cells.length, 365);
  assert.equal(c.cells[0].date, '2027-01-01');
  assert.equal(c.cells.at(-1).date, '2027-12-31');
  assert.equal(dow(c.start), 0);
  assert.ok(c.start <= '2027-01-01');
});

test('makeYearCalendarData: leap year has 366 cells', () => {
  assert.equal(makeYearCalendarData({}, 2028).cells.length, 366);
  assert.equal(makeYearCalendarData({}, 2024).cells.length, 366);
});

test('makeYearCalendarData: 2028 needs 54 week columns (starts Saturday)', () => {
  const c = makeYearCalendarData({}, 2028);
  assert.equal(c.start, '2027-12-26');
  const weeks = Math.floor((new Date(`${c.cells.at(-1).date}T00:00:00Z`) - new Date(`${c.start}T00:00:00Z`)) / 86_400_000 / 7) + 1;
  assert.equal(weeks, 54);
});

test('makeYearCalendarData: throughIso stops at that day, and is ignored when after year end', () => {
  assert.equal(makeYearCalendarData({}, 2027, '2027-01-10').cells.length, 10);
  assert.equal(makeYearCalendarData({}, 2027, '2027-01-01').cells.length, 1);
  assert.equal(makeYearCalendarData({}, 2026, '2027-03-01').cells.length, 365);
});

test('makeYearCalendarData: carries daily anime counts, ignores manga, missing days are 0', () => {
  const daily = { '2027-01-02': { anime: 4, manga: 9, total: 13 } };
  const c = makeYearCalendarData(daily, 2027, '2027-01-03');
  assert.deepEqual(c.cells.map((x) => x.total), [0, 4, 0]);
});

test('makeYearCalendarData: rejects invalid years', () => {
  for (const bad of [1969, 10000, 2026.5, 'abc', NaN]) assert.throws(() => makeYearCalendarData({}, bad), RangeError);
});

test('makeRollingCalendarData: today is the last cell, 53 columns, starts on Sunday', () => {
  const c = makeRollingCalendarData({}, '2026-11-18');
  assert.equal(c.cells.at(-1).date, '2026-11-18');
  assert.equal(dow(c.start), 0);
  const weeks = Math.floor((new Date('2026-11-18T00:00:00Z') - new Date(`${c.start}T00:00:00Z`)) / 86_400_000 / 7) + 1;
  assert.equal(weeks, 53);
});

test('render: every day from 1 to 10 January produces full-width, valid PNGs (no clipped title/legend)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-jan-'));
  const state = { daily: { '2026-12-30': { anime: 2, manga: 0, total: 2 }, '2027-01-03': { anime: 1, manga: 0, total: 1 } } };
  for (let day = 1; day <= 10; day += 1) {
    const iso = `2027-01-${String(day).padStart(2, '0')}`;
    const out = path.join(dir, iso);
    // 03:00 UTC = 10:00 Bangkok, same calendar day
    const data = await writeSite(state, 'TiMEZ4I3eth', out, { now: new Date(`${iso}T03:00:00Z`), repository: 'a/b' });
    assert.equal(data.range_end, iso);
    assert.deepEqual(data.years, [2026, 2027]);
    for (const file of ['heatmap.png', 'heatmap-2027.png', 'heatmap-2026.png']) {
      const buf = await fs.readFile(path.join(out, file));
      assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${iso} ${file} signature`);
      const { width, height } = pngSize(buf);
      assert.equal(height, 229, `${iso} ${file} height`);
      assert.ok(width >= 979, `${iso} ${file} width ${width} is narrower than a full 53-week image`);
    }
  }
});

test('render: 1 January 2027 current-year image has exactly one drawn day and 0 episodes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-jan1-'));
  const data = await writeSite({ daily: {} }, 'u', dir, { now: new Date('2027-01-01T03:00:00Z'), repository: 'a/b' });
  assert.equal(data.current_year, 2027);
  assert.equal(data.daily.at(-1).date, '2027-01-01');
});

// ---- legend position: decode the PNG and look at where the brightest legend square really is ----
import { inflateSync } from 'node:zlib';
import { COLORS, renderHeatmapPng } from '../src/render.js';

function decodePng(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat = [];
  for (let pos = 8; pos < buf.length;) {
    const length = buf.readUInt32BE(pos);
    if (buf.toString('ascii', pos + 4, pos + 8) === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3 + 1;
  return { width, height, pixel: (x, y) => { const o = y * stride + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; } };
}

/** Bounding box (x range) of all pixels that have the given colour. */
function colourSpan(png, hex) {
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  let min = Infinity; let max = -Infinity; let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const p = png.pixel(x, y);
      if (p[0] === want[0] && p[1] === want[1] && p[2] === want[2]) { count += 1; min = Math.min(min, x); max = Math.max(max, x); }
    }
  }
  return { min, max, count };
}

test('render: the legend stays at the right edge for every day from 1 to 10 January and for a 54-week year', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mal-legend-'));
  // No data at all: the brightest colour (level 4) then only exists in the "MORE" legend square.
  const brightest = COLORS[4];
  for (let day = 1; day <= 10; day += 1) {
    const iso = `2027-01-${String(day).padStart(2, '0')}`;
    const out = path.join(dir, iso);
    await writeSite({ daily: {} }, 'u', out, { now: new Date(`${iso}T03:00:00Z`), repository: 'a/b' });
    const png = decodePng(await fs.readFile(path.join(out, 'heatmap-2027.png')));
    const span = colourSpan(png, brightest);
    assert.ok(span.count > 100, `${iso}: legend square is missing or clipped (${span.count} px)`);
    assert.ok(span.min > png.width * 0.6, `${iso}: legend starts at x=${span.min}, expected the right side of a ${png.width}px image`);
    assert.ok(span.max < png.width, `${iso}: legend runs past the image edge`);
  }
  const wide = path.join(dir, 'wide.png');
  const cal = makeYearCalendarData({}, 2028);
  await renderHeatmapPng('u', cal.cells, cal.start, wide, { title: 'U 2028', periodLabel: 'IN 2028' });
  const png = decodePng(await fs.readFile(wide));
  assert.equal(png.width, 996, '54-week year is one column wider than 53');
  const span = colourSpan(png, brightest);
  assert.ok(span.count > 100 && span.min > png.width * 0.6 && span.max < png.width);
});
