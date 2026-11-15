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
  const escapedUsername = escapeHtml(username);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapedUsername} · MAL Contributions</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--blue0:#161b22;--blue1:#172f50;--blue2:#214b78;--blue3:#2f70ad;--blue4:#58a6e7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:36px 18px}
main{max-width:1000px;margin:auto}.top{display:flex;align-items:center;gap:14px;margin-bottom:22px}.avatar{width:44px;height:44px;border-radius:50%;background:#21262d;display:grid;place-items:center;font-size:22px}.muted{color:var(--muted)}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 14px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:20px;margin:16px 0}.stats{display:flex;gap:24px;flex-wrap:wrap;margin-top:14px}.stat b{font-size:21px;display:block}.stat span{font-size:12px;color:var(--muted)}.calendar-wrap{overflow-x:auto;padding-bottom:8px}.calendar{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,12px);grid-auto-columns:12px;gap:4px;min-width:max-content}.cell{width:12px;height:12px;border-radius:2px;background:var(--blue0);outline:1px solid #ffffff0a}.cell[data-level="1"]{background:var(--blue1)}.cell[data-level="2"]{background:var(--blue2)}.cell[data-level="3"]{background:var(--blue3)}.cell[data-level="4"]{background:var(--blue4)}.months{display:flex;gap:0;margin:0 0 7px 28px;height:15px;position:relative;color:var(--muted);font-size:11px}.month{position:absolute;white-space:nowrap}.weekdays{position:absolute;left:0;top:0;color:var(--muted);font-size:10px;line-height:12px}.weekdays span{position:absolute;left:0;white-space:nowrap}.weekdays span:nth-child(1){top:16px}.weekdays span:nth-child(2){top:48px}.weekdays span:nth-child(3){top:80px}.graph{position:relative;padding-left:28px}.legend{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:12px;color:var(--muted);font-size:11px}.swatch{height:11px;width:11px;border-radius:2px}.download{display:inline-block;color:#58a6e7;text-decoration:none}.download:hover{text-decoration:underline}.foot{font-size:12px;color:var(--muted);margin-top:20px}.error{color:#f85149}
@media(max-width:600px){body{padding:22px 12px}.panel{padding:14px}.stats{gap:15px}}
</style></head>
<body><main>
<header class="top"><div class="avatar">M</div><div><h1>${escapedUsername}</h1><div class="muted">MyAnimeList contributions · Anime + Manga</div></div></header>
<section class="panel"><h2>Contribution activity <span class="muted" id="range"></span></h2><div class="stats"><div class="stat"><b id="total">—</b><span>contributions in last 365 days</span></div><div class="stat"><b id="active">—</b><span>active days</span></div><div class="stat"><b id="anime">—</b><span>anime episodes</span></div><div class="stat"><b id="manga">—</b><span>manga chapters</span></div></div><div class="graph" style="margin-top:22px"><div class="weekdays"><span>Mon</span><span>Wed</span><span>Fri</span></div><div class="months" id="months"></div><div class="calendar-wrap"><div class="calendar" id="calendar"></div></div></div><div class="legend"><span>Less</span><i class="swatch" style="background:var(--blue0)"></i><i class="swatch" style="background:var(--blue1)"></i><i class="swatch" style="background:var(--blue2)"></i><i class="swatch" style="background:var(--blue3)"></i><i class="swatch" style="background:var(--blue4)"></i><span>More</span></div></section>
<section class="panel"><h2>Use on MyAnimeList profile</h2><p class="muted">Embed this PNG in your MAL profile using the BBCode below.</p><p><a class="download" href="heatmap.png">Open heatmap.png</a></p><pre id="bbcode" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1117;padding:12px;border-radius:6px">[img]${imageUrl}[/img]</pre><button id="copy" style="background:#2f70ad;color:white;border:0;border-radius:6px;padding:8px 12px;cursor:pointer">Copy BBCode</button></section>
<p class="foot">Activity is imported from MAL public recent history using the self-hosted Toki adapter. MAL exposes only a limited recent-history window (about 21 days); this project backfills the visible window on first run and stores daily totals for the future. Not an official MAL product. Last generated: <span id="generated">—</span>.</p>
</main>
<script>
(async()=>{try{const r=await fetch('activity.json',{cache:'no-store'});if(!r.ok)throw new Error('Could not load activity.json');const d=await r.json();const days=d.daily||[];const total=days.reduce((s,x)=>s+x.total,0),anime=days.reduce((s,x)=>s+x.anime,0),manga=days.reduce((s,x)=>s+x.manga,0),active=days.filter(x=>x.total>0).length;document.getElementById('total').textContent=total.toLocaleString();document.getElementById('anime').textContent=anime.toLocaleString();document.getElementById('manga').textContent=manga.toLocaleString();document.getElementById('active').textContent=active.toLocaleString();document.getElementById('range').textContent='('+d.range_start+' — '+d.range_end+')';document.getElementById('generated').textContent=d.generated_at||'—';const cal=document.getElementById('calendar'),months=document.getElementById('months');const first=new Date(d.range_start+'T12:00:00Z');const lookup=new Map(days.map(x=>[x.date,x]));const count=Math.ceil(days.length/7);months.style.width=(count*16)+'px';let prior='';for(let w=0;w<count;w++){const dt=new Date(first);dt.setUTCDate(dt.getUTCDate()+w*7);const key=dt.getUTCFullYear()+'-'+dt.getUTCMonth();if(key!==prior){const m=document.createElement('span');m.className='month';m.style.left=(w*16)+'px';m.textContent=dt.toLocaleString('en',{month:'short',timeZone:'UTC'});months.appendChild(m);prior=key}}for(let w=0;w<count;w++){for(let dow=0;dow<7;dow++){const dt=new Date(first);dt.setUTCDate(dt.getUTCDate()+w*7+dow);if(dt>dEnd())continue;const iso=[dt.getUTCFullYear(),String(dt.getUTCMonth()+1).padStart(2,'0'),String(dt.getUTCDate()).padStart(2,'0')].join('-');const v=lookup.get(iso)||{anime:0,manga:0,total:0};const level=v.total===0?0:v.total<=2?1:v.total<=5?2:v.total<=10?3:4;const el=document.createElement('div');el.className='cell';el.dataset.level=level;el.title=iso+': '+v.total+' contributions ('+v.anime+' anime, '+v.manga+' manga)';cal.appendChild(el)}}function dEnd(){return new Date(d.range_end+'T23:59:59Z')}const imageUrl=${JSON.stringify(imageUrl)};const bb='[img]'+imageUrl+'[/img]';document.getElementById('bbcode').textContent=bb;document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(bb);document.getElementById('copy').textContent='Copied!'}catch(_){document.getElementById('copy').textContent='Copy unavailable'}};}catch(e){const p=document.createElement('p');p.className='error';p.textContent=e.message;document.body.appendChild(p)}})();
</script></body></html>`;

  await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8');
  await fs.writeFile(path.join(outputDir, '.nojekyll'), '', 'utf8');
  return data;
}

export { makeImageUrl, parseIsoDate };
