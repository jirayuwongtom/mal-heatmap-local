# MAL Contributions — TiMEZ4I3eth (JavaScript Edition)

โปรเจกต์ Contribution Calendar สไตล์ GitHub สำหรับ MyAnimeList `TiMEZ4I3eth` เขียนระบบของโปรเจกต์ด้วย **JavaScript (Node.js)** ทั้งหมด และใช้งานฟรีผ่าน GitHub Actions + GitHub Pages

- **Toki** เปิด Recent History สาธารณะของ MAL เป็น JSON (ไม่ใช่ API ทางการ)
- **GitHub Actions** เรียก Toki ชั่วคราวใน Runner แล้วดึงประวัติวันละครั้ง (ทุก 24 ชั่วโมง)
- **Node.js** ดึงข้อมูล, ตรวจรายการซ้ำ, บันทึกยอดรายวัน, สร้าง PNG และเว็บไซต์
- **Git repository** เก็บยอดรายวันและ Fingerprint ของรายการที่นำเข้าแล้ว เพื่อไม่ให้นับซ้ำ
- **GitHub Pages** เผยแพร่หน้า Calendar และ `heatmap.png`
- ไม่ต้องใช้ Python, VPS, Turso, MAL Client ID หรือรหัสผ่าน MAL

> Toki เป็นโปรแกรม Go ของบุคคลที่สามซึ่ง Workflow Build และเปิดเป็นบริการชั่วคราวใน GitHub Runner เท่านั้น ส่วนโค้ดที่ดูแลโปรเจกต์นี้ทั้งหมดอยู่ใน JavaScript ไม่มี Python และไม่มีไลบรารี npm ภายนอก

## ทำไมต้องใช้ Toki แทน MAL API v2?

MAL API v2 ทางการให้ข้อมูลรายการ Anime/Manga และ Progress ปัจจุบัน แต่ไม่ได้เปิด Activity History ที่บอกวันที่ดู Episode หรืออ่าน Chapter ทีละกิจกรรมโดยตรง จึงไม่เพียงพอสำหรับทำ Contribution Calendar รายวันแบบย้อนหลัง

โปรเจกต์นี้จึงใช้ Toki เป็นตัวอ่าน **Public Recent History** ของ MAL แล้วเก็บข้อมูลไว้เอง Toki เป็นโปรเจกต์ Unofficial ที่อ่านหน้า MAL สาธารณะ ไม่ได้เกี่ยวข้องหรือได้รับการรับรองจาก MyAnimeList และอาจต้องแก้ไขหาก MAL เปลี่ยนหน้าเว็บ

Toki จะถูกดาวน์โหลดและรันชั่วคราวภายใน GitHub Actions Runner แต่ละครั้ง ไม่ได้เปิด Server ค้างไว้บนอินเทอร์เน็ต

## ประวัติย้อนหลังเดิม

MAL ระบุว่าประวัติสาธารณะที่ผู้ใช้อื่นมองเห็นได้มีเพียง **3 สัปดาห์ (ประมาณ 21 วัน)** หลังจากนั้นกิจกรรมเก่าจะถูกซ่อน

- **การรันครั้งแรก:** นำเข้าประวัติ Anime ทั้งหมดที่ MAL ยังเปิดเผยในขณะนั้น แล้วบันทึกเป็น Contribution ตามวันที่จริง
- **การรันครั้งต่อไป:** ดึง Recent History ชุดเดิมที่ยังมองเห็นได้วันละครั้ง (ทุก 24 ชั่วโมง) และเพิ่มเฉพาะรายการที่ไม่เคยบันทึก เพื่อไม่ให้นับซ้ำ
- **ประวัติที่เก่ากว่า 21 วัน:** ดึงจากหน้า Recent History ปัจจุบันไม่ได้ โปรเจกต์นี้ไม่สร้างวันย้อนหลังขึ้นมาเอง
- เมื่อข้อมูลถูกบันทึกลง `data/state.json` แล้ว จะเก็บยอดสะสมต่อไป แม้รายการนั้นจะหายจากหน้าประวัติ MAL ในภายหลัง

> หมายเหตุ: การนำเข้าครั้งแรกจะสำเร็จเท่าที่ Toki อ่านจากหน้า History สาธารณะได้จริง หาก MAL ปิดบังข้อมูลหรือป้องกันคำขอ Workflow จะหยุดโดยไม่บันทึกสถานะใหม่ เพื่อไม่ให้เกิดข้อมูลหายเงียบ ๆ

## ธีมสี

Heatmap ใช้โทนน้ำเงินเข้มไล่ไปฟ้า ทั้งในไฟล์ PNG และหน้าเว็บไซต์:

- ไม่มี Activity: `#161b22`
- ระดับ 1: `#172f50`
- ระดับ 2: `#214b78`
- ระดับ 3: `#2f70ad`
- ระดับ 4: `#58a6e7`

## ช่วงเวลาที่แสดงและคลังย้อนหลัง

- รูป `heatmap.png` (ที่ฝังในโปรไฟล์ MAL) แสดง **12 เดือนย้อนหลังจนถึงวันนี้** แบบเดียวกับหน้าโปรไฟล์ GitHub: 53 สัปดาห์ เริ่มวันอาทิตย์ วันนี้อยู่คอลัมน์ขวาสุดเสมอ และไม่วาดช่องของวันที่ยังมาไม่ถึง
- ระบบสร้างไฟล์ปีปฏิทินถาวรแยกปี เช่น `heatmap-2026.png` และ `heatmap-2027.png` (ปีปัจจุบันแสดงถึงวันนี้) ข้อมูลของปีก่อนจะไม่หาย
- หน้าเว็บไซต์มีตัวเลือก VIEW ให้สลับระหว่าง Last 12 months กับแต่ละปี ส่วนปุ่ม Copy BBCode ใช้ URL `heatmap.png` เสมอ
- ป้ายเดือนวางที่สัปดาห์แรกที่วันอาทิตย์ตกในเดือนนั้น และเดือนที่แสดงไม่ถึง 2 คอลัมน์ (เดือนที่ไม่เต็มที่ต้นหรือท้ายกราฟ) จะไม่มีป้าย
- สีของแต่ละช่องคิดเป็นสัดส่วนของวันที่ดู Episode มากที่สุดในช่วงที่แสดง (แบ่ง 4 ระดับที่ 25 / 50 / 75%) ไม่ใช่เกณฑ์ตายตัว จึงเปลี่ยนไปตามวันที่ดูมากสุดของช่วงนั้น
- MyAnimeList อาจ Cache รูปภาพที่ฝังไว้ จึงอาจไม่ได้เปลี่ยนภาพทันทีเมื่อไฟล์ `heatmap.png` ถูกอัปเดต

## วิธีนับ Contribution

- 1 Contribution คือ 1 Episode ของ Anime ที่เพิ่ม ตามค่า `increment` ใน Recent History ของ MAL
- **นับเฉพาะ Anime** ไม่นับ Manga ระบบไม่ดึงประวัติ Manga อีกต่อไป (ค่า `manga` ที่มีอยู่เดิมใน `data/state.json` ยังอยู่ แต่ไม่ถูกนำมาแสดง)
- วันที่ใช้มาจากประวัติ MAL และแปลงเป็นเขตเวลา `Asia/Bangkok`
- ใช้ Fingerprint แบบ SHA-256 เพื่อจำว่าประวัติแต่ละรายการถูกนำเข้าแล้ว โดยไม่เผยชื่อ Anime ใน `data/state.json`
- กิจกรรมซ้ำที่มีรายละเอียดเหมือนกันในคำตอบเดียวกันจะยังถูกนับแยกกันด้วย Duplicate Index

## โครงสร้างไฟล์

```text
.
├── .github/workflows/heatmap.yml
├── data/state.json
├── src/
│   ├── collect.js
│   ├── tracker.js
│   ├── render.js
│   └── run.js
├── test/
│   ├── collect.test.js
│   ├── tracker.test.js
│   └── render.test.js
├── package.json
└── README.md
```

## ติดตั้ง

### 1. อัปเดต Repository เดิม

1. Repository คือ [`jirayuwongtom/mal-heatmap-local`](https://github.com/jirayuwongtom/mal-heatmap-local)
2. ดาวน์โหลด ZIP ฉบับ JavaScript นี้ แล้วแตกไฟล์
3. อัปโหลดไฟล์และโฟลเดอร์ทั้งหมดเข้า Repository โดยใช้ Branch `main`
4. **อย่าลบหรือแทนที่ `data/state.json` ด้วยไฟล์ว่าง** ไฟล์ State ใน ZIP นี้ถูกคัดลอกจากไฟล์แนบล่าสุดของคุณและคงประวัติที่มีอยู่ไว้แล้ว
5. ลบไฟล์ Python เดิม (`scripts/*.py`, `tests/*.py`, `requirements.txt`) ออกจาก Repository หาก GitHub ไม่ลบไฟล์เดิมให้อัตโนมัติเมื่ออัปโหลดทับ

> ก่อนอัปโหลด แนะนำดาวน์โหลด `data/state.json` จาก Repository เก็บสำรองไว้อีกชุดหนึ่ง

### 2. เปิด GitHub Pages

ใน Repository เปิด:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

### 3. สั่งทำงาน

1. เปิดแท็บ **Actions**
2. เลือก Workflow ชื่อ **Build MAL Contributions**
3. กด **Run workflow**
4. รอให้ Job ทดสอบ JavaScript, Build Toki, ดึงประวัติ, สร้างภาพ และ Deploy จบ

หลังจากนั้น Scheduled Workflow จะทำงานวันละครั้งเวลา 00:17 น. ตามเวลาไทย คุณสามารถกด Run workflow เองหลังอัปเดต MAL ได้เช่นกัน

### 4. ไม่มี API Secret ให้ตั้งค่า

Toki อ่านข้อมูลสาธารณะ จึงไม่จำเป็นต้องใส่ MAL Client ID, MAL Client Secret, MAL Password, Cookie หรือ Token ลงใน GitHub Secrets

## ทดสอบในเครื่อง

ต้องมี Node.js 22 ขึ้นไป:

```bash
npm test
```

คำสั่งนี้รัน Unit Tests โดยไม่เรียก MAL จริง หากต้องการรันตัวเก็บข้อมูลจริง ต้องเปิด Toki ในเครื่องและตั้งค่า:

```bash
MAL_USERNAME=TiMEZ4I3eth TOKI_BASE_URL=http://127.0.0.1:3000 npm run build
```

## URL หลัง Deploy

สำหรับ Repository `jirayuwongtom/mal-heatmap-local`:

เว็บไซต์:

`https://jirayuwongtom.github.io/mal-heatmap-local/`

รูปภาพ:

`https://jirayuwongtom.github.io/mal-heatmap-local/heatmap.png`

BBCode สำหรับใส่ใน MyAnimeList Profile:

```text
[img]https://jirayuwongtom.github.io/mal-heatmap-local/heatmap.png[/img]
```

หน้าเว็บไซต์จะแสดงเฉพาะภาพ Heatmap แบบการ์ดเดี่ยว พื้นหลังสีดำ ไม่มีการ์ดสถิติหรือส่วนหัวโปรไฟล์ โดยภาพจะแสดงที่ความกว้างสูงสุด 880 px และย่ออัตโนมัติบนมือถือ มีตัวเลือก YEAR สำหรับดูภาพรายปีย้อนหลัง

ใต้ภาพมีส่วน **Use on MyAnimeList Profile** พร้อมปุ่ม **Copy BBCode** ซึ่งคัดลอก `[img]...[/img]` ที่ใช้ URL ของ GitHub Pages ใน Repository นี้ให้โดยอัตโนมัติ พร้อมทางเลือกสำรองสำหรับเบราว์เซอร์ที่ไม่รองรับ Clipboard API

## ข้อมูลและความเป็นส่วนตัว

- GitHub Pages แบบฟรีต้องใช้ Public Repository ดังนั้นไฟล์ใน Repository จะมองเห็นได้สาธารณะ
- `data/state.json` เก็บยอดกิจกรรมรายวันและ Hash Fingerprints สำหรับกันการนับซ้ำ ไม่เก็บชื่อเรื่อง URL ของรายการ คะแนน ความเห็น หรือ Tags
- รุ่นนี้คง `schema_version`, `seen_events`, `daily`, `first_import_at` และข้อมูลเดิมใน `data/state.json` โดยไม่รีเซ็ตประวัติ
- `site/activity.json` ที่เผยแพร่บนเว็บไซต์มีเฉพาะวันที่และยอด Anime รายวัน
- ห้ามเพิ่มรหัสผ่าน MAL, Cookie หรือ Token ลับใด ๆ ลง Repository

## การทำงานและข้อจำกัด

- `data/state.json` จะถูกแก้และ Commit ก็ต่อเมื่อมียอดเปลี่ยนจริงเท่านั้น (ไม่มี Commit ว่างทุกรอบ) เวลารันล่าสุดดูได้ที่ `last_sync_at` ใน `site/activity.json` ส่วน `last_change_at` ใน State คือเวลาที่ยอดเปลี่ยนล่าสุด
- MAL แสดงประวัติเก่าโดยไม่มีปี (เช่น `Dec 28`) ระบบแก้ให้อัตโนมัติ: ถ้าวันที่ที่ได้อยู่ในอนาคตเกิน 24 ชั่วโมง จะถอยกลับ 1 ปี เพื่อให้ข้ามปีแล้วไม่นับซ้ำ
- Scheduled Workflow ตั้งให้ทำงานวันละครั้ง (ทุก 24 ชั่วโมง) ที่ 00:17 น. ตามเวลา Asia/Bangkok โดยกำหนด timezone ใน GitHub Actions โดยตรง การ Push โค้ดเข้า main หรือกด Run workflow ด้วยตนเองยังสามารถสั่งให้ทำงานนอกตารางได้ และ GitHub อาจเริ่มงานตามกำหนดช้ากว่าเวลาเล็กน้อย
- Toki เป็น Unofficial Scraper และพึ่งพา HTML ของ MAL ถ้า MAL เปลี่ยนหน้าเว็บ, ปิดกั้น Runner หรือ Toki เปลี่ยนรูปแบบ response การดึงข้อมูลอาจล้มเหลว
- Toki จะถูก Build ใหม่ทุกครั้งที่ Workflow ทำงาน โดยใช้ Go `1.27.4` (Toki ต้องการ Go 1.26 ขึ้นไป)
- Workflow ใช้ 1 History Request ต่อรอบ (Anime)
- Scheduled Workflow ใน Public Repository อาจถูกปิดอัตโนมัติเมื่อไม่มี Repository Activity เป็นเวลา 60 วัน หากหยุดทำงาน ให้เข้า Actions แล้วเปิดใช้งาน Workflow อีกครั้ง

## แก้ปัญหาเบื้องต้น

- **Workflow ล้มเหลวตอน Build Toki:** ตรวจสอบบันทึกขั้นตอน `Build Toki`; อาจเป็นการเปลี่ยนแปลง Go/Toki upstream
- **JavaScript Test ไม่ผ่าน:** ดูชื่อ Test และข้อความ error ในขั้นตอน `Run JavaScript tests`
- **Toki ตอบ HTTP 403:** MAL อาจปฏิเสธคำขอจาก GitHub Runner หรือโปรไฟล์/ประวัติไม่เปิดเป็นสาธารณะ
- **Toki ตอบ HTTP 404:** ตรวจสอบ Username และการเข้าถึงหน้า Profile
- **Toki ตอบ HTTP 429:** MAL จำกัดคำขอชั่วคราว ระบบจะรอ (ตาม `Retry-After` หรือ 30/60/90 วินาที) แล้วลองใหม่สูงสุด 4 ครั้งเอง หากยังไม่ผ่านให้รอสักระยะแล้ว Run workflow ใหม่
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
