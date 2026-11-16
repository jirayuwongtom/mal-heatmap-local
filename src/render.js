/** Generate the public calendar site and a MAL-profile-friendly PNG. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { isoDateInTimeZone } from './tracker.js';

export const COLORS = ['#161b22', '#172f50', '#214b78', '#2f70ad', '#58a6e7'];
const BACKGROUND = '#0d1117';
const MUTED = '#8b949e';
const TEXT = '#e6edf3';

export function levelFor(total) {
  if (total <= 0) return 0;
  if (total <= 2) return 1;
  if (total <= 5) return 2;
  if (total <= 10) return 3;
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

export function makeCalendarData(daily = {}, todayIso = isoDateInTimeZone(new Date())) {
  const end = parseIsoDate(todayIso);
  let start = addUtcDays(end, -364);
  // Align first column to Sunday, matching GitHub's Sunday-first contributions layout.
  start = addUtcDays(start, -start.getUTCDay());
  const cells = [];
  for (let day = new Date(start); day <= end; day = addUtcDays(day, 1)) {
    const key = isoUtcDate(day);
    const record = daily[key] ?? {};
    const anime = Number(record.anime ?? 0);
    const manga = Number(record.manga ?? 0);
    cells.push({ date: key, anime, manga, total: Number(record.total ?? anime + manga) });
  }
  return { start: isoUtcDate(start), cells };
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

export function renderHeatmapPng(username, cells, startIso, outputPath) {
  const cell = 13; const gap = 4; const left = 54; const top = 76;
  const weeks = Math.ceil(cells.length / 7);
  const width = left + weeks * (cell + gap) + 24;
  const height = 62 + 7 * (cell + gap) + 48;
  const pixels = Buffer.alloc(width * height * 3);
  const bg = hexRgb(BACKGROUND);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = bg[0]; pixels[offset + 1] = bg[1]; pixels[offset + 2] = bg[2];
  }

  drawText(pixels, width, height, `${username} - MAL CONTRIBUTIONS`, left, 14, TEXT, 2);
  drawText(pixels, width, height, 'ANIME EPISODES + MANGA CHAPTERS - LAST 365 DAYS', left, 39, MUTED, 1);

  for (const [row, label] of [[1, 'MON'], [3, 'WED'], [5, 'FRI']]) {
    drawText(pixels, width, height, label, 9, top + row * (cell + gap) + 3, MUTED, 1);
  }

  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  let previousMonth = null;
  const start = parseIsoDate(startIso);
  for (const rec of cells) {
    const day = parseIsoDate(rec.date);
    const col = Math.floor((day - start) / 86_400_000 / 7);
    const row = day.getUTCDay();
    const x = left + col * (cell + gap);
    const y = top + row * (cell + gap);
    if (day.getUTCMonth() !== previousMonth && day.getUTCDate() <= 7) {
      drawText(pixels, width, height, monthNames[day.getUTCMonth()], x, top - 17, MUTED, 1);
      previousMonth = day.getUTCMonth();
    }
    drawRoundedRect(pixels, width, height, x, y, cell, cell, 2, COLORS[levelFor(rec.total)]);
  }

  const legendY = top + 7 * (cell + gap) + 9;
  drawText(pixels, width, height, 'LESS', left, legendY + 2, MUTED, 1);
  let x = left + 32;
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
  const { start, cells } = makeCalendarData(state.daily ?? {}, today);
  const data = {
    username,
    generated_at: options.generatedAt ?? now.toISOString(),
    range_start: start,
    range_end: today,
    daily: cells,
    first_import_at: state.first_import_at ?? null,
    last_sync_at: state.last_sync_at ?? null,
  };
  await fs.writeFile(path.join(outputDir, 'activity.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await renderHeatmapPng(username, cells, start, path.join(outputDir, 'heatmap.png'));

  const imageUrl = options.imageUrl ?? makeImageUrl(options.repository ?? process.env.GITHUB_REPOSITORY);
  const bbcode = `[img]${imageUrl}[/img]`;
  const escapedBbcode = escapeHtml(bbcode);
  const bbcodeJson = JSON.stringify(bbcode).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
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
.share{margin-top:14px;padding:13px 14px;background:#0b0f15;border:1px solid #1d2733;border-radius:5px;color:#d6e2ef;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.share-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:9px}
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
  <a href="heatmap.png" aria-label="Open full-size MAL contributions heatmap">
    <img src="heatmap.png" alt="${escapedUsername} MyAnimeList contributions for the last 365 days" width="979" height="229">
  </a>
  <section class="share" aria-labelledby="share-title">
    <div class="share-head">
      <div>
        <h2 class="share-title" id="share-title">USE ON MYANIMELIST PROFILE</h2>
        <p class="share-help">Copy this BBCode to display your heatmap on your MAL profile.</p>
      </div>
      <a class="png-link" href="heatmap.png">Open PNG</a>
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
  const button = document.getElementById('copy-bbcode');
  const status = document.getElementById('copy-status');
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
