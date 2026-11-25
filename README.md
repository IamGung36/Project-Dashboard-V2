# Project Dashboard V2

แดชบอร์ดบริหารโครงการพลังงานหมุนเวียน (Renewable Energy Project Dashboard) รองรับการใช้งานพร้อมกันหลายคน (Multi-user Safe) ผ่าน GitHub Pages และ Google Apps Script + Google Sheets

---

## 🚀 สถาปัตยกรรมระบบใหม่ (Single Source of Truth)

โครงสร้างโฟลเดอร์ถูกรวมเป็นชุดเดียวเพื่อป้องกันปัญหาโค้ดไม่ตรงกัน:

```
├── index.html              # หน้าหลักของระบบ (GitHub Pages ใช้ไฟล์นี้โดยตรง)
├── css/
│   └── style.css           # สไตล์หลักทั้งหมด
├── js/
│   ├── app.js              # ตัวควบคุม UI หลัก (SPA router, events, forms, maps, charts)
│   ├── db.js               # Data Layer: Row-level mutations, Drive image upload, local cache
│   ├── kanban.js           # Kanban board controller
│   ├── calendar.js         # Calendar controller
│   └── manhours.js         # Manhours tracker controller
├── gas/
│   ├── Code.gs             # Backend controller บน Google Apps Script
│   └── appsscript.json     # Manifest พร้อม Drive & Spreadsheet scopes
├── scripts/
│   └── build-gas.mjs       # Script สำหรับ compile ไฟล์เข้า gas_deploy/ อัตโนมัติ
├── gas_deploy/             # ไฟล์พร้อม deploy ขึ้น Google Apps Script (สร้างจาก build script)
├── logo.png                # โลโก้องค์กร
├── package.json            # NPM scripts สำหรับ build และ deploy
└── README.md
```

---

## 🛠️ การพัฒนาและการแก้ไขโค้ด (Workflow)

1. **แก้ไขโค้ด:** แก้ไขไฟล์ใน `index.html`, `css/style.css`, `js/*.js` หรือ `gas/Code.gs` เท่านั้น (ไม่ต้องแก้ใน `gas_deploy/` ด้วยมือ)
2. **ทดสอบ Local:** สามารถเปิดไฟล์ `index.html` บนเบราว์เซอร์หรือรัน local web server เพื่อทดสอบ
3. **Build สำหรับ Google Apps Script:**
   ```bash
   npm run build:gas
   ```
   สคริปต์จะอ่านไฟล์จาก `js/`, `css/`, `index.html`, `gas/` แล้วสร้างไฟล์ HTML/GS ใน `gas_deploy/` ให้โดยอัตโนมัติ

---

## ☁️ ขั้นตอนการ Deploy ขึ้น Google Apps Script (ทำครั้งแรกหลังอัปเดตนี้)

เนื่องจากระบบใหม่มีการเชื่อมต่อกับ **Google Drive** เพื่อเก็บรูปภาพแทน base64 ในเซลล์ Google Sheets ต้องทำการ Deploy เวอร์ชันใหม่และ Authorize สิทธิ์ดังนี้:

### ขั้นตอนที่ 1: Push โค้ดขึ้น Apps Script
สามารถใช้ clasp หรือเปิด Apps Script Editor:
```bash
npm run deploy:gas
# หรือรัน clasp push โดยตรง
npx clasp push
```
*(หากยังไม่ได้ล็อกอิน clasp ให้รัน `npx clasp login`)*

หรือนำโค้ดใน `gas_deploy/` ไปวางทับใน Apps Script Editor:
- `Code.gs` <- `gas_deploy/Code.gs`
- `index.html` <- `gas_deploy/index.html`
- `style.html` <- `gas_deploy/style.html`
- `db_js.html`, `app_js.html`, `calendar_js.html`, `kanban_js.html`, `manhours_js.html`

### ขั้นตอนที่ 2: รันฟังก์ชัน `migrateV5` (รันครั้งเดียว)
1. ในหน้า Google Apps Script Editor เลือกฟังก์ชัน **`migrateV5`** จากแถบดรอปดาวน์ด้านบน
2. กดปุ่ม **Run**
3. ระบบจะขออนุญาตสิทธิ์ (Authorization Required) -> กด **Review permissions** -> เลือกบัญชี Google -> กด **Advanced** -> กด **Go to Project Dashboard (unsafe)** -> กด **Allow**
4. ฟังก์ชัน `migrateV5()` จะทำงาน:
   - เพิ่มคอลัมน์ `updatedAt` ในทุกแท็บ
   - สร้างโฟลเดอร์ `Project Dashboard Images` บน Google Drive ของคุณโดยอัตโนมัติ (ตั้งแชร์เป็น Anyone with the link – Viewer)
   - ดึงรูปภาพ base64 เดิมในชีต (ถ้ามี) ไปแปลงเป็นไฟล์รูปภาพบน Google Drive และใส่ URL แทนที่
   - แก้ไขคำสะกด `Cancle` เป็น `Cancel` และ `Treading` เป็น `Trading`

### ขั้นตอนที่ 3: Deploy New Version
1. กดปุ่มสีน้ำเงิน **Deploy** มุมขวาบน -> เลือก **Manage deployments**
2. เลือก Deployment เดิมที่เป็น Web App -> กดไอคอนดินสอ (**Edit**)
3. ในช่อง **Version** เลือก **New version**
4. ตรวจสอบ:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. กดปุ่ม **Deploy**
*(URL ของ Web App จะเป็น URL เดิม ไม่จำเป็นต้องเปลี่ยนในหน้า Settings)*

---

## 🌐 การ Deploy ขึ้น GitHub Pages

เมื่อพร้อมนำขึ้นระบบจริง:
```bash
git add .
git commit -m "Upgrade: Row-level mutations, Drive image storage, and single-source codebase"
git push origin main
```
GitHub Pages จะอัปเดตเว็บที่ https://iamgung36.github.io/Project-Dashboard-V2/ โดยอัตโนมัติ

---

## 🔒 ฟีเจอร์ความปลอดภัยสำหรับหลายคนพร้อมกัน (Multi-user Protection)

- **Optimistic Locking (Row-level):** แต่ละแถวมี timestamp `updatedAt` กำกับ เมื่อผู้ใช้กดบันทึก จะส่งเฉพาะแถวที่แก้ไขไปตรวจสอบกับเซิร์ฟเวอร์ หากมีผู้อื่นแก้ไขข้อมูลเดียวกันไปก่อนหน้า ระบบจะแจ้งเตือนและดึงข้อมูลล่าสุดมาให้แก้ไขใหม่ ป้องกันข้อมูลทับกันโดยสิ้นเชิง
- **Server-side Code Generation:** รหัสโครงการ `G26-XXX` และ ID สร้างภายใต้ `LockService` บนเซิร์ฟเวอร์ รับประกันว่าจะไม่มีทางซ้ำกันแม้จะกดเพิ่มพร้อมกัน
- **Drive Image Storage:** รูปภาพถูกย่อขนาดด้วย HTML Canvas ฝั่งเบราว์เซอร์ก่อนอัปโหลดขึ้น Google Drive โดยตรง หมดปัญหาเซลล์ชีตเต็มและช่วยให้ sync รวดเร็ว
- **Safe Initialization:** ระบบโหลดข้อมูลในหน่วยความจำเท่านั้น ไม่มีการสั่งเขียนทับทั้งฐานข้อมูลเมื่อเปิดหน้าเว็บอีกต่อไป
- **Smart Background Sync:** ซิงก์ข้อมูลอัตโนมัติทุก 30 วินาทีเมื่อผู้ใช้เปิดแท็บค้างไว้ ช่วยให้เห็นงานของเพื่อนร่วมทีมทันที
