# MAL Contributions — TiMEZ4I3eth

โปรเจกต์ Contribution Calendar สไตล์ GitHub สำหรับ MyAnimeList `TiMEZ4I3eth` โดยเน้นให้ใช้งานได้ฟรีผ่าน GitHub Actions และ GitHub Pages

- **Toki** เปิด Recent History สาธารณะของ MAL เป็น JSON (ไม่ใช่ API ทางการ)
- **GitHub Actions** เรียก Toki ชั่วคราวใน Runner แล้วดึงประวัติทุกชั่วโมง
- **Git repository** เก็บยอดรายวันและ Fingerprint ของรายการที่นำเข้าแล้ว เพื่อไม่ให้นับซ้ำ
- **GitHub Pages** เผยแพร่หน้า Calendar และ `heatmap.png`
- ไม่จำเป็นต้องใช้ VPS, Turso, MAL Client ID หรือรหัสผ่าน MAL

## ทำไมต้องใช้ Toki แทน MAL API v2?

MAL API v2 ทางการให้ข้อมูลรายการ Anime/Manga และ Progress ปัจจุบัน แต่ไม่ได้เปิด Activity History ที่บอกวันที่ดู Episode หรืออ่าน Chapter ทีละกิจกรรมโดยตรง จึงไม่เพียงพอสำหรับทำ Contribution Calendar รายวันแบบย้อนหลัง

โปรเจกต์นี้จึงใช้ Toki เป็นตัวอ่าน **Public Recent History** ของ MAL แล้วเก็บข้อมูลไว้เอง Toki เป็นโปรเจกต์ Unofficial ที่อ่านหน้า MAL สาธารณะ ไม่ได้เกี่ยวข้องหรือได้รับการรับรองจาก MyAnimeList และอาจต้องแก้ไขหาก MAL เปลี่ยนหน้าเว็บ

Toki จะถูกดาวน์โหลดและรันชั่วคราวภายใน GitHub Actions Runner แต่ละครั้ง ไม่ได้เปิด Server ค้างไว้บนอินเทอร์เน็ต

## ประวัติย้อนหลังเดิม

MAL ระบุว่าประวัติสาธารณะที่ผู้ใช้อื่นมองเห็นได้มีเพียง **3 สัปดาห์ (ประมาณ 21 วัน)** หลังจากนั้นกิจกรรมเก่าจะถูกซ่อน

- **การรันครั้งแรก:** นำเข้าประวัติ Anime และ Manga ทั้งหมดที่ MAL ยังเปิดเผยในขณะนั้น แล้วบันทึกเป็น Contribution ตามวันที่จริง
- **การรันครั้งต่อไป:** ดึง Recent History ชุดเดิมที่ยังมองเห็นได้ทุกชั่วโมง และเพิ่มเฉพาะรายการที่ไม่เคยบันทึก เพื่อไม่ให้นับซ้ำ
- **ประวัติที่เก่ากว่า 21 วัน:** ดึงจากหน้า Recent History ปัจจุบันไม่ได้ โปรเจกต์นี้ไม่สร้างวันย้อนหลังขึ้นมาเอง
- เมื่อข้อมูลถูกบันทึกลง `data/state.json` แล้ว จะเก็บยอดสะสมต่อไป แม้รายการนั้นจะหายจากหน้าประวัติ MAL ในภายหลัง

> หมายเหตุ: การนำเข้าครั้งแรกจะสำเร็จเท่าที่ Toki อ่านจากหน้า History สาธารณะได้จริง หาก MAL ปิดบังข้อมูลหรือป้องกันคำขอ Workflow จะหยุดโดยไม่บันทึกสถานะใหม่ เพื่อไม่ให้เกิดข้อมูลหายเงียบ ๆ

## วิธีนับ Contribution

- 1 Contribution คือ 1 Episode ที่เพิ่ม หรือ 1 Chapter ที่เพิ่ม ตามค่า `increment` ใน Recent History ของ MAL
- รวม Anime และ Manga ใน Calendar เดียวกัน แต่แสดงยอดแยกกันในหน้าเว็บ
- วันที่ใช้มาจากประวัติ MAL และแปลงเป็นเขตเวลา `Asia/Bangkok`
- ใช้ Fingerprint แบบ Hash เพื่อจำว่าประวัติแต่ละรายการถูกนำเข้าแล้ว โดยไม่เผยชื่อ Anime/Manga ใน `data/state.json`
- กิจกรรมซ้ำที่มีรายละเอียดเหมือนกันในคำตอบเดียวกันจะยังถูกนับแยกกันด้วย Duplicate Index

## ติดตั้ง

### 1. สร้าง Repository บน GitHub

1. สร้าง Repository ใหม่ชื่อ `mal-heatmap`
2. ตั้งเป็น **Public** เพื่อใช้ GitHub Pages บน GitHub Free
3. แตกไฟล์ ZIP แล้วอัปโหลดไฟล์และโฟลเดอร์ทั้งหมดไปไว้ที่ Root ของ Repository โดยต้องเก็บ `.github/workflows/` ไว้ด้วย
4. ใช้ Branch ชื่อ `main`

### 2. เปิด GitHub Pages

ใน Repository เปิด:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

### 3. สั่งนำเข้าประวัติย้อนหลังครั้งแรก

1. เปิดแท็บ **Actions**
2. เลือก Workflow ชื่อ **Build MAL Contributions**
3. กด **Run workflow**
4. รอให้ Job ทำงานจบและ Deploy สำเร็จ

ครั้งแรก Workflow จะ Build Toki ใน Runner, เรียก Recent History ของ Anime และ Manga, นำเข้ารายการที่ MAL ยังเปิดเผย, สร้าง Heatmap และ Commit `data/state.json` กลับเข้า Repository

หลังจากนั้น Scheduled Workflow จะทำงานทุกชั่วโมงโดยอัตโนมัติ คุณสามารถกด Run workflow เองหลังอัปเดต MAL ได้เช่นกัน

### 4. ไม่มี API Secret ให้ตั้งค่า

Toki อ่านข้อมูลสาธารณะ จึงไม่จำเป็นต้องใส่ MAL Client ID, MAL Client Secret, MAL Password, Cookie หรือ Token ลงใน GitHub Secrets

## URL หลัง Deploy

สมมติ GitHub username ของคุณคือ `YOUR-GITHUB-USERNAME` และ Repository ชื่อ `mal-heatmap`:

เว็บไซต์:

`https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/`

รูปภาพ:

`https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png`

BBCode สำหรับใส่ใน MyAnimeList Profile:

```text
[img]https://YOUR-GITHUB-USERNAME.github.io/mal-heatmap/heatmap.png[/img]
```

หน้าเว็บไซต์จะแสดง BBCode ที่ใช้ URL ของ Repository จริงให้อัตโนมัติหลัง Deploy

## ข้อมูลและความเป็นส่วนตัว

- GitHub Pages แบบฟรีต้องใช้ Public Repository ดังนั้นไฟล์ใน Repository จะมองเห็นได้สาธารณะ
- `data/state.json` เก็บยอดกิจกรรมรายวันและ Hash Fingerprints สำหรับกันการนับซ้ำ ไม่เก็บชื่อเรื่อง URL ของรายการ คะแนน ความเห็น หรือ Tags
- หากเคยติดตั้ง Starter รุ่นก่อนหน้า ให้สำรอง `data/state.json` ก่อนอัปโหลดไฟล์รุ่นนี้ทับ เพราะรูปแบบ State เปลี่ยนจาก Snapshot Tracking เป็น History Event Tracking
- `site/activity.json` ที่เผยแพร่บนเว็บไซต์มีเฉพาะวันที่และยอด Anime/Manga รายวัน
- ห้ามเพิ่มรหัสผ่าน MAL, Cookie หรือ Token ลับใด ๆ ลง Repository

## การทำงานและข้อจำกัด

- Scheduled Workflow ตั้งไว้ทุกชั่วโมงที่นาที 17 ตามเวลา UTC (เช่น 00:17 UTC = 07:17 เวลาไทย) GitHub อาจเริ่มงานช้ากว่าเวลาที่กำหนดได้
- Toki เป็น Unofficial Scraper และพึ่งพา HTML ของ MAL ถ้า MAL เปลี่ยนหน้าเว็บ, ปิดกั้น Runner หรือ Toki เปลี่ยนรูปแบบ response การดึงข้อมูลอาจล้มเหลว
- Toki จะถูก Build ใหม่ทุกครั้งที่ Workflow ทำงาน โดยใช้ Go `1.26.3` ตามข้อกำหนดของ Toki ในปัจจุบัน
- Workflow ใช้ 2 History Requests ต่อรอบ (Anime และ Manga) และเว้นช่วงระหว่างคำขอ
- Scheduled Workflow ใน Public Repository อาจถูกปิดอัตโนมัติเมื่อไม่มี Repository Activity เป็นเวลา 60 วัน หากหยุดทำงาน ให้เข้า Actions แล้วเปิดใช้งาน Workflow อีกครั้ง

## แก้ปัญหาเบื้องต้น

- **Workflow ล้มเหลวตอน Build Toki:** ตรวจสอบบันทึกขั้นตอน `Build Toki`; อาจเป็นการเปลี่ยนแปลง Go/Toki upstream
- **Toki ตอบ HTTP 403:** MAL อาจปฏิเสธคำขอจาก GitHub Runner หรือโปรไฟล์/ประวัติไม่เปิดเป็นสาธารณะ
- **Toki ตอบ HTTP 404:** ตรวจสอบ Username และการเข้าถึงหน้า Profile
- **Toki ตอบ HTTP 429:** MAL จำกัดคำขอชั่วคราว ให้รอสักระยะแล้ว Run workflow ใหม่
- **จำนวน history rows เป็น 0:** อาจไม่มี Recent History ที่ยังมองเห็นได้ หรือ MAL เปลี่ยนหน้า History; ตรวจสอบหน้า <https://myanimelist.net/profile/TiMEZ4I3eth>
- **Deploy Pages ไม่ผ่าน:** ตรวจสอบ Settings → Pages → Source ว่าเลือก GitHub Actions
- **ไม่เห็นข้อมูลเก่ากว่า 21 วัน:** เป็นข้อจำกัดของ MAL ไม่ใช่ปัญหาของ Heatmap

## เปลี่ยนบัญชี MAL

แก้ Username ให้ตรงกันทั้ง 2 จุด:

1. `MAL_USERNAME` ใน `.github/workflows/heatmap.yml`
2. `username` ใน `data/state.json`

ถ้าเปลี่ยนบัญชี แนะนำให้ล้าง `seen_events` และ `daily` ใน `data/state.json` ก่อนรันใหม่

## แหล่งอ้างอิงและเอกสาร

- Toki repository และวิธีรัน: <https://github.com/nyawave/toki>
- Toki OpenAPI schema: <https://raw.githubusercontent.com/nyawave/toki/master/openapi.json>
- คำอธิบายช่วงเวลาประวัติย้อนหลัง 3 สัปดาห์: <https://malheatmap.com/about>
