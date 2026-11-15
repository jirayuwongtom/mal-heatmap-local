"""Render a static GitHub-style contributions page and a PNG for MAL profile."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

BANGKOK = ZoneInfo("Asia/Bangkok")
# MAL-inspired blue ramp: empty -> light activity -> heavy activity.
COLORS = ["#161b22", "#172f50", "#214b78", "#2f70ad", "#58a6e7"]


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    choices = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for path in choices:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def level_for(total: int) -> int:
    if total <= 0:
        return 0
    if total <= 2:
        return 1
    if total <= 5:
        return 2
    if total <= 10:
        return 3
    return 4


def make_calendar_data(daily: dict, today: date) -> tuple[date, list[dict]]:
    end = today
    start = end - timedelta(days=364)
    start -= timedelta(days=(start.weekday() + 1) % 7)  # Align to Sunday.
    cells = []
    day = start
    while day <= end:
        rec = daily.get(day.isoformat(), {})
        cells.append({
            "date": day.isoformat(),
            "anime": int(rec.get("anime", 0)),
            "manga": int(rec.get("manga", 0)),
            "total": int(rec.get("total", 0)),
        })
        day += timedelta(days=1)
    return start, cells


def draw_png(username: str, cells: list[dict], start: date, output: Path, year: int) -> None:
    cell = 13
    gap = 4
    left = 54
    top = 76
    weeks = (len(cells) + 6) // 7
    width = left + weeks * (cell + gap) + 24
    height = 62 + 7 * (cell + gap) + 48
    image = Image.new("RGB", (width, height), "#0d1117")
    draw = ImageDraw.Draw(image)
    draw.text((left, 14), f"{username}  ·  MAL Contributions", font=load_font(19, True), fill="#e6edf3")
    draw.text((left, 39), "Anime episodes + Manga chapters updated · Last 365 days", font=load_font(10), fill="#8b949e")

    weekday_font = load_font(9)
    for row, label in [(1, "Mon"), (3, "Wed"), (5, "Fri")]:
        draw.text((12, top + row * (cell + gap) + 2), label, font=weekday_font, fill="#8b949e")

    month_font = load_font(9)
    previous_month = None
    for idx, rec in enumerate(cells):
        d = date.fromisoformat(rec["date"])
        col = (d - start).days // 7
        row = (d.weekday() + 1) % 7  # Sunday first
        x = left + col * (cell + gap)
        y = top + row * (cell + gap)
        if d.month != previous_month and d.day <= 7:
            draw.text((x, top - 17), d.strftime("%b"), font=month_font, fill="#8b949e")
            previous_month = d.month
        color = COLORS[level_for(rec["total"])]
        draw.rounded_rectangle((x, y, x + cell, y + cell), radius=2, fill=color)

    legend_y = top + 7 * (cell + gap) + 9
    draw.text((left, legend_y), "Less", font=load_font(9), fill="#8b949e")
    x = left + 32
    for color in COLORS:
        draw.rounded_rectangle((x, legend_y, x + cell, legend_y + cell), radius=2, fill=color)
        x += cell + gap
    draw.text((x + 4, legend_y), "More", font=load_font(9), fill="#8b949e")
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG", optimize=True)


def write_site(state: dict, username: str, output_dir: Path, image_url: str | None = None) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now(BANGKOK).date()
    start, cells = make_calendar_data(state.get("daily", {}), today)
    now_iso = datetime.now(BANGKOK).isoformat(timespec="seconds")
    data = {
        "username": username,
        "generated_at": now_iso,
        "range_start": start.isoformat(),
        "range_end": today.isoformat(),
        "daily": cells,
        "first_import_at": state.get("first_import_at"),
        "last_sync_at": state.get("last_sync_at"),
    }
    (output_dir / "activity.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    draw_png(username, cells, start, output_dir / "heatmap.png", today.year)

    if not image_url:
        image_url = "https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png"

    html = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__USERNAME__ · MAL Contributions</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--blue0:#161b22;--blue1:#172f50;--blue2:#214b78;--blue3:#2f70ad;--blue4:#58a6e7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:36px 18px}
main{max-width:1000px;margin:auto}.top{display:flex;align-items:center;gap:14px;margin-bottom:22px}.avatar{width:44px;height:44px;border-radius:50%;background:#21262d;display:grid;place-items:center;font-size:22px}.muted{color:var(--muted)}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 14px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:20px;margin:16px 0}.stats{display:flex;gap:24px;flex-wrap:wrap;margin-top:14px}.stat b{font-size:21px;display:block}.stat span{font-size:12px;color:var(--muted)}.calendar-wrap{overflow-x:auto;padding-bottom:8px}.calendar{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,12px);grid-auto-columns:12px;gap:4px;min-width:max-content}.cell{width:12px;height:12px;border-radius:2px;background:var(--blue0);outline:1px solid #ffffff0a}.cell[data-level="1"]{background:var(--blue1)}.cell[data-level="2"]{background:var(--blue2)}.cell[data-level="3"]{background:var(--blue3)}.cell[data-level="4"]{background:var(--blue4)}.months{display:flex;gap:0;margin:0 0 7px 28px;height:15px;position:relative;color:var(--muted);font-size:11px}.month{position:absolute;white-space:nowrap}.weekdays{position:absolute;left:0;top:0;color:var(--muted);font-size:10px;line-height:12px}.weekdays span{position:absolute;left:0;white-space:nowrap}.weekdays span:nth-child(1){top:16px}.weekdays span:nth-child(2){top:48px}.weekdays span:nth-child(3){top:80px}.graph{position:relative;padding-left:28px}.legend{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:12px;color:var(--muted);font-size:11px}.swatch{height:11px;width:11px;border-radius:2px}.download{display:inline-block;color:#58a6ff;text-decoration:none}.download:hover{text-decoration:underline}.foot{font-size:12px;color:var(--muted);margin-top:20px}.error{color:#f85149}
@media(max-width:600px){body{padding:22px 12px}.panel{padding:14px}.stats{gap:15px}}
</style></head>
<body><main>
<header class="top"><div class="avatar">M</div><div><h1>__USERNAME__</h1><div class="muted">MyAnimeList contributions · Anime + Manga</div></div></header>
<section class="panel"><h2>Contribution activity <span class="muted" id="range"></span></h2><div class="stats"><div class="stat"><b id="total">—</b><span>contributions in last 365 days</span></div><div class="stat"><b id="active">—</b><span>active days</span></div><div class="stat"><b id="anime">—</b><span>anime episodes</span></div><div class="stat"><b id="manga">—</b><span>manga chapters</span></div></div><div class="graph" style="margin-top:22px"><div class="weekdays"><span>Mon</span><span>Wed</span><span>Fri</span></div><div class="months" id="months"></div><div class="calendar-wrap"><div class="calendar" id="calendar"></div></div></div><div class="legend"><span>Less</span><i class="swatch" style="background:var(--blue0)"></i><i class="swatch" style="background:var(--blue1)"></i><i class="swatch" style="background:var(--blue2)"></i><i class="swatch" style="background:var(--blue3)"></i><i class="swatch" style="background:var(--blue4)"></i><span>More</span></div></section>
<section class="panel"><h2>Use on MyAnimeList profile</h2><p class="muted">Embed this PNG in your MAL profile using the BBCode below.</p><p><a class="download" href="heatmap.png">Open heatmap.png</a></p><pre id="bbcode" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1117;padding:12px;border-radius:6px">[img]https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png[/img]</pre><button id="copy" style="background:#2f70ad;color:white;border:0;border-radius:6px;padding:8px 12px;cursor:pointer">Copy BBCode</button></section>
<p class="foot">Activity is imported from MAL public recent history using the self-hosted Toki adapter. MAL exposes only a limited recent-history window (about 21 days); this project backfills the visible window on first run and stores daily totals for the future. Not an official MAL product. Last generated: <span id="generated">—</span>.</p>
</main>
<script>
(async()=>{try{const r=await fetch('activity.json',{cache:'no-store'});if(!r.ok)throw new Error('Could not load activity.json');const d=await r.json();const days=d.daily||[];const total=days.reduce((s,x)=>s+x.total,0),anime=days.reduce((s,x)=>s+x.anime,0),manga=days.reduce((s,x)=>s+x.manga,0),active=days.filter(x=>x.total>0).length;document.getElementById('total').textContent=total.toLocaleString();document.getElementById('anime').textContent=anime.toLocaleString();document.getElementById('manga').textContent=manga.toLocaleString();document.getElementById('active').textContent=active.toLocaleString();document.getElementById('range').textContent='('+d.range_start+' — '+d.range_end+')';document.getElementById('generated').textContent=d.generated_at||'—';const cal=document.getElementById('calendar'),months=document.getElementById('months');const first=new Date(d.range_start+'T12:00:00');const lookup=new Map(days.map(x=>[x.date,x]));const count=Math.ceil(days.length/7);months.style.width=(count*16)+'px';let prior='';for(let w=0;w<count;w++){const dt=new Date(first);dt.setDate(dt.getDate()+w*7);const key=dt.getFullYear()+'-'+dt.getMonth();if(key!==prior){const m=document.createElement('span');m.className='month';m.style.left=(w*16)+'px';m.textContent=dt.toLocaleString('en',{month:'short'});months.appendChild(m);prior=key}}for(let w=0;w<count;w++){for(let dow=0;dow<7;dow++){const dt=new Date(first);dt.setDate(dt.getDate()+w*7+dow);const iso=[dt.getFullYear(),String(dt.getMonth()+1).padStart(2,'0'),String(dt.getDate()).padStart(2,'0')].join('-');const v=lookup.get(iso)||{anime:0,manga:0,total:0};const level=v.total===0?0:v.total<=2?1:v.total<=5?2:v.total<=10?3:4;const el=document.createElement('div');el.className='cell';el.dataset.level=level;el.title=iso+': '+v.total+' contributions ('+v.anime+' anime, '+v.manga+' manga)';cal.appendChild(el)}}const imageUrl='__IMAGE_URL__';const bb='[img]'+imageUrl+'[/img]';document.getElementById('bbcode').textContent=bb;document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(bb);document.getElementById('copy').textContent='Copied!'}catch(_){document.getElementById('copy').textContent='Copy unavailable'}};}catch(e){document.body.insertAdjacentHTML('beforeend','<p class="error">'+e.message+'</p>')}})();
</script></body></html>'''.replace("__USERNAME__", username)
    html = html.replace("https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png", image_url)
    html = html.replace("__IMAGE_URL__", image_url)
    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / ".nojekyll").write_text("", encoding="utf-8")
