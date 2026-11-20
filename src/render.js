/** Generate the public calendar site and a MAL-profile-friendly PNG. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { isoDateInTimeZone } from './tracker.js';

export const COLORS = ['#161b22', '#172f50', '#214b78', '#2f70ad', '#58a6e7'];
const BACKGROUND = '#0d1117';
const MUTED = '#8b949e';
const TEXT = '#e6edf3';
export const MIN_DRAWN_WEEKS = 53;

/**
 * Level 0-4 relative to the busiest day in the period shown, split into quartiles.
 * GitHub scales its colours the same way (against the user's own maximum); its exact cut-offs
 * are not published, so these are the plain 25/50/75% boundaries.
 */
export function levelFor(total, max) {
  if (!(total > 0) || !(max > 0)) return 0;
  const ratio = total / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addUtcDays(date, count) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

function isoUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function makeCell(daily, key) {
  const anime = Number((daily[key] ?? {}).anime ?? 0);
  // Only anime episodes count; manga values that may exist in older state files are ignored.
  return { date: key, anime, total: anime };
}

/** Calendar year, Sunday-aligned. `throughIso` drops days after it (GitHub does not draw future days). */
export function makeYearCalendarData(daily = {}, year = new Date().getUTCFullYear(), throughIso = null) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 1970 || numericYear > 9999) {
    throw new RangeError(`Invalid calendar year: ${year}`);
  }
  const firstDay = parseIsoDate(`${numericYear}-01-01`);
  const lastDay = parseIsoDate(`${numericYear}-12-31`);
  // Align the first column to Sunday, as in GitHub's contribution calendar.
  const start = addUtcDays(firstDay, -firstDay.getUTCDay());
  const cells = [];
  const lastShown = throughIso && parseIsoDate(throughIso) < lastDay ? parseIsoDate(throughIso) : lastDay;
  for (let day = new Date(firstDay); day <= lastShown; day = addUtcDays(day, 1)) {
    cells.push(makeCell(daily, isoUtcDate(day)));
  }
  return { year: numericYear, start: isoUtcDate(start), cells };
}

/**
 * GitHub's default profile view: the last 12 months ending today (today is in the last column).
 * The grid always spans 53 Sunday-first weeks; days after today are not drawn.
 */
export function makeRollingCalendarData(daily = {}, todayIso = isoDateInTimeZone(new Date())) {
  const today = parseIsoDate(todayIso);
  const oneYearAgo = addUtcDays(today, -364);
  const start = addUtcDays(oneYearAgo, -oneYearAgo.getUTCDay());
  const cells = [];
  for (let day = new Date(start); day <= today; day = addUtcDays(day, 1)) {
    cells.push(makeCell(daily, isoUtcDate(day)));
  }
  return { start: isoUtcDate(start), cells };
}

// Kept as a compatibility alias for callers from the rolling-calendar version.
export function makeCalendarData(daily = {}, todayIso = isoDateInTimeZone(new Date())) {
  const date = parseIsoDate(todayIso);
  return makeYearCalendarData(daily, date.getUTCFullYear());
}

// Small built-in 5x7 bitmap font. This keeps PNG generation dependency-free.
const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'], F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'], H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'], J:['00111','00010','00010','00010','10010','10010','01100'],
  K:['10001','10010','10100','11000','10100','10010','10001'], L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'], N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'], P:['11110','10001','10001','11110','10000','10000','10000'],
  Q:['01110','10001','10001','10001','10101','10010','01101'], R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'], V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','10101','01010'], X:['10001','10001','01010','00100','01010','10001','10001'],
  Y:['10001','10001','01010','00100','00100','00100','00100'], Z:['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'], '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'], '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'], '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'], '9':['01110','10001','10001','01111','00001','00001','01110'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'], '-':['00000','00000','00000','11111','00000','00000','00000'],
  '+':['00000','00100','00100','11111','00100','00100','00000'], '.':['00000','00000','00000','00000','00000','01100','01100'],
  ':':['00000','01100','01100','00000','01100','01100','00000'], '/':['00001','00010','00010','00100','01000','01000','10000'],
};

/**
 * Month labels as GitHub places them: on the first week column whose Sunday falls in a new month.
 * A month that would span fewer than two columns (a partial month at either end) gets no label.
 */
export function monthLabelColumns(startIso, weeks) {
  const start = parseIsoDate(startIso);
  const starts = [];
  let previous = null;
  for (let col = 0; col < weeks; col += 1) {
    const month = addUtcDays(start, col * 7).getUTCMonth();
    if (month !== previous) starts.push({ col, month });
    previous = month;
  }
  return starts
    .map((entry, index) => ({ ...entry, span: (starts[index + 1]?.col ?? weeks) - entry.col }))
    .filter((entry) => entry.span >= 2)
    .map(({ col, month }) => ({ col, month }));
}

function hexRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  header[10] = 0; header[11] = 0; header[12] = 0;
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 3 + 1);
    scanlines[dest] = 0; // PNG filter: None
    pixels.copy(scanlines, dest + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawRect(pixels, width, height, x, y, w, h, color) {
  const [r, g, b] = hexRgb(color);
  const x0 = Math.max(0, Math.floor(x)); const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w)); const y1 = Math.min(height, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const offset = (py * width + px) * 3;
      pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b;
    }
  }
}

function drawRoundedRect(pixels, width, height, x, y, w, h, radius, color) {
  const [r, g, b] = hexRgb(color);
  for (let py = Math.max(0, y); py < Math.min(height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(width, x + w); px += 1) {
      const cx = px < x + radius ? x + radius : px >= x + w - radius ? x + w - radius - 1 : px;
      const cy = py < y + radius ? y + radius : py >= y + h - radius ? y + h - radius - 1 : py;
      const dx = px - cx; const dy = py - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (py * width + px) * 3;
      pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b;
    }
  }
}

function drawText(pixels, width, height, text, x, y, color, scale = 1) {
  const [r, g, b] = hexRgb(color);
  let cursor = x;
  for (const character of String(text).toUpperCase()) {
    const glyph = FONT[character] ?? FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== '1') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = cursor + col * scale + sx;
            const py = y + row * scale + sy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const offset = (py * width + px) * 3;
            pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b;
          }
        }
      }
    }
    cursor += 6 * scale;
  }
  return cursor;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 'S'}`;
}

export function renderHeatmapPng(username, cells, startIso, outputPath, options = {}) {
  const cell = 13; const gap = 4; const left = 54; const top = 76;
  const gridStart = parseIsoDate(startIso);
  const finalDay = cells.length ? parseIsoDate(cells.at(-1).date) : gridStart;
  const gridEnd = addUtcDays(finalDay, 6 - finalDay.getUTCDay());
  const weeks = Math.floor((gridEnd - gridStart) / 86_400_000 / 7) + 1;
  // Always at least 53 columns (a full GitHub-style year) so early-January images keep the same
  // width and the title and legend are never clipped.
  const drawnWeeks = Math.max(weeks, MIN_DRAWN_WEEKS);
  const periodLabel = options.periodLabel ?? 'IN THE LAST YEAR';
  const title = options.title ?? `${username} - MAL CONTRIBUTIONS`;
  const count = cells.reduce((sum, rec) => sum + rec.total, 0);
  const maxTotal = Math.max(0, ...cells.map((rec) => rec.total));
  const width = left + drawnWeeks * (cell + gap) + 24;
  const height = 62 + 7 * (cell + gap) + 48;
  const pixels = Buffer.alloc(width * height * 3);
  const bg = hexRgb(BACKGROUND);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = bg[0]; pixels[offset + 1] = bg[1]; pixels[offset + 2] = bg[2];
  }

  drawText(pixels, width, height, title, left, 14, TEXT, 2);
  drawText(pixels, width, height, `${plural(count, 'ANIME EPISODE')} ${periodLabel}`, left, 39, MUTED, 1);

  for (const [row, label] of [[1, 'MON'], [3, 'WED'], [5, 'FRI']]) {
    drawText(pixels, width, height, label, 9, top + row * (cell + gap) + 3, MUTED, 1);
  }

  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const start = parseIsoDate(startIso);
  for (const { col, month } of monthLabelColumns(startIso, weeks)) {
    drawText(pixels, width, height, monthNames[month], left + col * (cell + gap), top - 17, MUTED, 1);
  }
  for (const rec of cells) {
    const day = parseIsoDate(rec.date);
    const col = Math.floor((day - start) / 86_400_000 / 7);
    const row = day.getUTCDay();
    const x = left + col * (cell + gap);
    const y = top + row * (cell + gap);
    drawRoundedRect(pixels, width, height, x, y, cell, cell, 2, COLORS[levelFor(rec.total, maxTotal)]);
  }

  const legendY = top + 7 * (cell + gap) + 9;
  const legendLeft = left + drawnWeeks * (cell + gap) - gap - 144;
  drawText(pixels, width, height, 'LESS', legendLeft, legendY + 2, MUTED, 1);
  let x = legendLeft + 32;
  for (const color of COLORS) {
    drawRoundedRect(pixels, width, height, x, legendY, cell, cell, 2, color);
    x += cell + gap;
  }
  drawText(pixels, width, height, 'MORE', x + 4, legendY + 2, MUTED, 1);
  return fs.writeFile(outputPath, encodePng(width, height, pixels));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function makeImageUrl(repository) {
  const value = String(repository ?? '').trim();
  if (!value.includes('/')) return 'https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png';
  const [owner, repoName] = value.split('/', 2);
  if (repoName.toLowerCase() === `${owner}.github.io`.toLowerCase()) {
    return `https://${owner}.github.io/heatmap.png`;
  }
  return `https://${owner}.github.io/${repoName}/heatmap.png`;
}

export async function writeSite(state, username, outputDir, options = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  const now = options.now instanceof Date ? options.now : new Date();
  const today = isoDateInTimeZone(now);
  const currentYear = Number(today.slice(0, 4));
  const daily = state.daily ?? {};
  const storedYears = Object.keys(daily)
    .map((date) => /^(\d{4})-\d{2}-\d{2}$/.exec(date))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const earliestYear = storedYears.length ? Math.min(...storedYears) : currentYear;
  const years = Array.from({ length: currentYear - earliestYear + 1 }, (_, index) => earliestYear + index);
  const rolling = makeRollingCalendarData(daily, today);

  // heatmap.png is the stable URL used by the MyAnimeList BBCode: the last 12 months, like GitHub's
  // profile. Each calendar year also gets a permanent PNG (heatmap-YYYY.png); the current year
  // stops at today.
  await renderHeatmapPng(username, rolling.cells, rolling.start, path.join(outputDir, 'heatmap.png'));
  const yearlyViews = {};
  for (const year of years) {
    const calendar = makeYearCalendarData(daily, year, year === currentYear ? today : null);
    yearlyViews[year] = { start: calendar.start, cells: calendar.cells };
    await renderHeatmapPng(username, calendar.cells, calendar.start, path.join(outputDir, `heatmap-${year}.png`), {
      title: `${username} - MAL CONTRIBUTIONS ${year}`,
      periodLabel: `IN ${year}`,
    });
  }

  const data = {
    username,
    generated_at: options.generatedAt ?? now.toISOString(),
    current_year: currentYear,
    years,
    range_start: rolling.cells[0].date,
    range_end: today,
    daily: rolling.cells,
    // Preserve the existing daily array and publish only date/count data for interactive tooltips.
    calendar_views: {
      last: { start: rolling.start, cells: rolling.cells },
      years: yearlyViews,
    },
    first_import_at: state.first_import_at ?? null,
    last_sync_at: options.generatedAt ?? now.toISOString(),
    last_change_at: state.last_change_at ?? null,
  };
  await fs.writeFile(path.join(outputDir, 'activity.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const imageUrl = options.imageUrl ?? makeImageUrl(options.repository ?? process.env.GITHUB_REPOSITORY);
  const bbcode = `[img]${imageUrl}[/img]`;
  const escapedBbcode = escapeHtml(bbcode);
  const bbcodeJson = JSON.stringify(bbcode).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const calendarViewsJson = JSON.stringify(data.calendar_views)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const escapedUsername = escapeHtml(username);
  // Keep the public page visually identical to the compact MAL-style PNG.
  // The page intentionally contains no GitHub-like profile header or summary cards.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>${escapedUsername} - MAL Contributions</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#000}
body{min-height:100vh;padding:64px 16px 32px;display:flex;justify-content:center;align-items:flex-start}
main{width:min(880px,100%)}
a{display:block;line-height:0}
img{display:block;width:100%;height:auto;border:0}
.heatmap-wrap{position:relative;width:100%;line-height:0}
.heatmap-overlay{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.heatmap-overlay rect[data-date]{fill:transparent;pointer-events:all;cursor:default;outline:none}
.heatmap-overlay rect[data-date]:focus{stroke:#e6edf3;stroke-width:1.5;fill:rgba(230,237,243,.12)}
.heatmap-tooltip{position:absolute;z-index:5;display:none;max-width:min(280px,calc(100% - 12px));padding:7px 10px;background:#30363d;border:1px solid #484f58;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.35);color:#f0f6fc;font:12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;pointer-events:none}
.share{margin-top:14px;padding:13px 14px;background:#0b0f15;border:1px solid #1d2733;border-radius:5px;color:#d6e2ef;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.share-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:9px}
.share-tools{display:flex;align-items:center;gap:8px}
.year-label{color:#8293a6;font:11px system-ui,sans-serif}
.year-select{padding:6px 8px;background:#080b10;border:1px solid #1b2632;border-radius:4px;color:#c7dcf2;font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
.share-title{margin:0;color:#9eb6cf;font-size:11px;letter-spacing:.08em}
.share-help{margin:3px 0 0;color:#8293a6;font:11px/1.5 system-ui,sans-serif}
.png-link{color:#58a6e7;text-decoration:none;white-space:nowrap}
.png-link:hover{text-decoration:underline}
.share-row{display:flex;align-items:stretch;gap:8px}
.bbcode{display:block;flex:1;min-width:0;padding:9px 10px;background:#080b10;border:1px solid #1b2632;border-radius:4px;color:#9dc8f2;overflow-wrap:anywhere;line-height:1.6}
.copy-button{flex:none;padding:8px 12px;background:#214b78;border:1px solid #2f70ad;border-radius:4px;color:#f1f7ff;font:600 11px system-ui,sans-serif;cursor:pointer}
.copy-button:hover{background:#2f70ad}
.copy-button:focus-visible{outline:2px solid #58a6e7;outline-offset:2px}
.copy-status{min-height:16px;margin:6px 0 0;color:#8fc6f7;font:11px system-ui,sans-serif}
@media(max-width:600px){body{padding:24px 12px}main{width:100%}.share-row{flex-direction:column}.copy-button{width:100%}}
</style>
</head>
<body>
<main>
  <div class="heatmap-wrap" id="heatmap-wrap">
    <a id="heatmap-image-link" href="heatmap.png" aria-label="Open full-size MAL contributions heatmap">
      <img id="heatmap-image" src="heatmap.png" alt="${escapedUsername} MyAnimeList anime episodes in the last year" width="979" height="229">
    </a>
    <svg id="heatmap-overlay" class="heatmap-overlay" role="group" aria-label="Daily anime episode counts"></svg>
    <div id="heatmap-tooltip" class="heatmap-tooltip" role="status" aria-live="polite"></div>
  </div>
  <section class="share" aria-labelledby="share-title">
    <div class="share-head">
      <div>
        <h2 class="share-title" id="share-title">USE ON MYANIMELIST PROFILE</h2>
        <p class="share-help">Copy this BBCode to display your last-12-months heatmap on your MAL profile.</p>
      </div>
      <div class="share-tools">
        <label class="year-label" for="year-select">VIEW</label>
        <select class="year-select" id="year-select" aria-label="Choose contribution period">
          <option value="last" selected>Last 12 months</option>
          ${years.slice().reverse().map((year) => `<option value="${year}">${year}</option>`).join('')}
        </select>
        <a class="png-link" id="png-link" href="heatmap.png">Open PNG</a>
      </div>
    </div>
    <div class="share-row">
      <code class="bbcode" id="bbcode">${escapedBbcode}</code>
      <button class="copy-button" id="copy-bbcode" type="button">Copy BBCode</button>
    </div>
    <p class="copy-status" id="copy-status" aria-live="polite"></p>
  </section>
</main>
<script>
(() => {
  const bbcode = ${bbcodeJson};
  const calendars = ${calendarViewsJson};
  const button = document.getElementById('copy-bbcode');
  const status = document.getElementById('copy-status');
  const yearSelect = document.getElementById('year-select');
  const image = document.getElementById('heatmap-image');
  const imageLink = document.getElementById('heatmap-image-link');
  const pngLink = document.getElementById('png-link');
  const wrapper = document.getElementById('heatmap-wrap');
  const overlay = document.getElementById('heatmap-overlay');
  const tooltip = document.getElementById('heatmap-tooltip');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CELL = 13;
  const STEP = 17;
  const LEFT = 54;
  const TOP = 76;
  let activeCell = null;

  function dateFromIso(value) {
    return new Date(value + 'T00:00:00Z');
  }

  function tooltipText(cell) {
    const count = Number(cell.anime ?? cell.total ?? 0);
    const parts = new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', timeZone: 'UTC'
    }).formatToParts(dateFromIso(cell.date));
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? 0);
    const lastTwo = day % 100;
    const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th'
      : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
    const date = month + ' ' + day + suffix;
    if (count === 0) return 'No Episodes on ' + date;
    return count + (count === 1 ? ' Episode on ' : ' Episodes on ') + date;
  }

  function positionTooltip(target) {
    const wrapRect = wrapper.getBoundingClientRect();
    const cellRect = target.getBoundingClientRect();
    tooltip.style.display = 'block';
    const tipRect = tooltip.getBoundingClientRect();
    let left = cellRect.left - wrapRect.left + cellRect.width / 2 - tipRect.width / 2;
    left = Math.max(6, Math.min(left, wrapRect.width - tipRect.width - 6));
    let top = cellRect.top - wrapRect.top - tipRect.height - 9;
    if (top < 4) top = cellRect.bottom - wrapRect.top + 9;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function showTooltip(target) {
    if (!target?.dataset?.date) return;
    activeCell = target;
    tooltip.textContent = target.getAttribute('aria-label');
    positionTooltip(target);
  }

  function hideTooltip() {
    activeCell = null;
    tooltip.style.display = 'none';
  }

  function renderOverlay(view) {
    overlay.replaceChildren();
    hideTooltip();
    if (!view?.cells?.length) return;

    const start = dateFromIso(view.start);
    const last = dateFromIso(view.cells[view.cells.length - 1].date);
    const weekEnd = new Date(last);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6 - weekEnd.getUTCDay());
    const weeks = Math.floor((weekEnd - start) / 86400000 / 7) + 1;
    const drawnWeeks = Math.max(53, weeks);
    const width = LEFT + drawnWeeks * STEP + 24;
    const height = 62 + 7 * STEP + 48;
    overlay.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    const fragment = document.createDocumentFragment();
    for (const cell of view.cells) {
      const date = dateFromIso(cell.date);
      const offset = Math.floor((date - start) / 86400000);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(LEFT + Math.floor(offset / 7) * STEP));
      rect.setAttribute('y', String(TOP + date.getUTCDay() * STEP));
      rect.setAttribute('width', String(CELL));
      rect.setAttribute('height', String(CELL));
      rect.setAttribute('rx', '2');
      rect.setAttribute('data-date', cell.date);
      rect.setAttribute('data-count', String(Number(cell.anime ?? cell.total ?? 0)));
      rect.setAttribute('aria-label', tooltipText(cell));
      rect.setAttribute('tabindex', '0');
      rect.setAttribute('role', 'img');
      fragment.appendChild(rect);
    }
    overlay.appendChild(fragment);
  }

  overlay.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('rect[data-date]');
    if (target) showTooltip(target);
  });
  overlay.addEventListener('pointermove', (event) => {
    const target = event.target.closest?.('rect[data-date]');
    if (target && target === activeCell) positionTooltip(target);
  });
  overlay.addEventListener('pointerleave', hideTooltip);
  overlay.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('rect[data-date]');
    if (target) showTooltip(target);
  });
  overlay.addEventListener('focusout', (event) => {
    if (!overlay.contains(event.relatedTarget)) hideTooltip();
  });
  overlay.addEventListener('click', (event) => {
    const target = event.target.closest?.('rect[data-date]');
    if (target) showTooltip(target);
  });

  function selectView(value) {
    const file = value === 'last' ? 'heatmap.png' : 'heatmap-' + value + '.png';
    image.src = file;
    image.alt = ${JSON.stringify(username)} + ' MyAnimeList anime episodes ' + (value === 'last' ? 'in the last year' : 'in ' + value);
    imageLink.href = file;
    pngLink.href = file;
    const view = value === 'last' ? calendars.last : calendars.years[value];
    renderOverlay(view);
  }

  renderOverlay(calendars.last);
  yearSelect.addEventListener('change', () => selectView(yearSelect.value));
  button.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(bbcode);
      status.textContent = 'Copied!';
    } catch (_) {
      const field = document.createElement('textarea');
      field.value = bbcode;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      status.textContent = copied ? 'Copied!' : 'Copy failed — select the BBCode and copy it manually.';
    }
  });
})();
</script>
</body>
</html>`;

  await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');
  return data;
}

export { makeImageUrl, parseIsoDate };
