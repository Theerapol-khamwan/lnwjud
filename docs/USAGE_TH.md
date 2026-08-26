# คู่มือใช้งาน lnwjud v4.11.0 (ภาษาไทย)

lnwjud คือ Windows-first local AI-agent runtime / MCP gateway สำหรับให้ ChatGPT, Codex และ MCP client อื่นทำงานกับเครื่อง Windows ของคุณ เช่น อ่าน/ค้น/แก้ไฟล์, Git, รันโปรเซส, Windows UI automation, WSL, Office และเครื่องมือพัฒนาอื่น ๆ โดยงานจริงยังทำบนเครื่องของคุณ

> สำหรับผู้ใช้ Windows x64 ที่ใช้ `lnwjud-Setup-4.11.0.exe` หรือ `lnwjud-Portable-4.11.0.exe` **ไม่ต้องติดตั้ง Node.js และไม่ต้องดาวน์โหลด `tunnel-client.exe` เอง** ตัว release รวม private Node.js runtime และ official OpenAI `tunnel-client v0.0.12` มาให้แล้ว

---

## 1. สิ่งที่ต้องมี

สำหรับผู้ใช้ทั่วไปที่ใช้ Windows release:

- Windows 10/11 x64
- `lnwjud-Setup-4.11.0.exe` หรือ `lnwjud-Portable-4.11.0.exe`
- OpenAI Platform tunnel ที่ผูกกับ ChatGPT workspace ที่จะใช้
- Runtime API key ที่มีสิทธิ์ **Tunnels Read + Use**
- อินเทอร์เน็ตขาออก HTTPS สำหรับ Secure MCP Tunnel

ไม่ต้องมี:

- Node.js แยกบนเครื่อง
- pnpm / Corepack สำหรับการใช้งานปกติ
- การโหลด ZIP `tunnel-client` เอง
- การพิมพ์ `tunnel-client init` ใน PowerShell เอง

Release ปัจจุบันเป็น **x64 เท่านั้น** ไม่รองรับ Windows 32-bit และไม่ได้ทำ target สำหรับ Windows 7/8/8.1

Node.js, pnpm และ Git จำเป็นเฉพาะกรณีพัฒนา/build จาก source ตามหัวข้อท้ายเอกสาร

## 2. เลือกแบบติดตั้งหรือ Portable

### แบบแนะนำ: Installer

1. ดาวน์โหลด `lnwjud-Setup-4.11.0.exe` จาก GitHub Releases
2. ติดตั้งตามปกติ
3. เปิด **lnwjud Agent Control Center**
4. เพิ่ม Project/Workspace ที่ต้องการใช้งาน
5. ถ้าทำงานพร้อมกันหลายแชท/หลายโปรเจกต์ ให้ตั้ง Active Projects ได้มากกว่า 1 โปรเจกต์ และเลือก Primary Project สำหรับงานที่ต้องมีค่า default

### แบบไม่ต้องติดตั้ง: Portable EXE

1. ดาวน์โหลด `lnwjud-Portable-4.11.0.exe`
2. วางไว้ในโฟลเดอร์ที่ต้องการแล้วเปิดไฟล์ได้ทันที ไม่ต้องรัน installer
3. เพิ่ม Project/Workspace และตั้ง Tunnel เหมือนเวอร์ชันติดตั้ง

Portable ของ lnwjud หมายถึง **ตัวโปรแกรมเปิดได้โดยไม่ต้องติดตั้ง** แต่ตั้งใจใช้ข้อมูล/Settings ต่อผู้ใช้ Windows ชุดเดียวกับตัวติดตั้ง จึงไม่ใช่โหมดที่เก็บ database/settings ทุกอย่างไว้ข้างไฟล์ EXE ถ้าเคยใช้ตัวติดตั้งใน Windows account เดียวกัน Portable จะเห็นการตั้งค่าชุดเดียวกัน

ทั้ง Installer และ Portable รวม `tunnel-client.exe` และ private Node runtime ไว้ใน package โดย lnwjud จะเลือก path ภายใน package เองเมื่อช่อง Tunnel Client Override ว่าง

## 3. สร้าง OpenAI Tunnel และ Runtime API key

1. เปิด OpenAI Platform → Tunnels
2. สร้างหรือเลือก Tunnel ที่ต้องการใช้กับ lnwjud
3. ผูก Tunnel กับ organization / ChatGPT workspace ที่ต้องการ
4. จด `tunnel_id`
5. สร้าง Runtime API key ที่มีสิทธิ์ **Tunnels Read + Use**
6. เก็บ key ไว้เป็นความลับ ห้ามใส่ Git, issue, README หรือไฟล์ที่แชร์

สิทธิ์ **Tunnels Read + Manage** ต้องใช้เฉพาะบัญชีที่สร้าง/แก้ Tunnel บน Platform ไม่ใช่สิทธิ์ขั้นต่ำของ runtime key

## 4. ตั้งค่า Secure MCP Tunnel ใน lnwjud

เปิด **Settings → OpenAI Secure MCP Tunnel**

ทำตามนี้:

1. ใส่ Runtime API key แล้วกด **Save key**
2. ช่อง **tunnel-client (รวมมากับโปรแกรมแล้ว)** ให้ปล่อยว่างไว้
   - lnwjud จะใช้ official OpenAI `tunnel-client v0.0.12` ที่ bundle มากับ Windows x64 package อัตโนมัติ
   - ปุ่ม Browse / Save override ใช้เฉพาะกรณี troubleshoot หรือต้องการทดสอบ client อื่น
   - ถ้าเคยตั้ง override แล้วอยากกลับไปใช้ตัวที่มากับโปรแกรม ให้ล้างช่องแล้วกด **ใช้ตัวที่มากับโปรแกรม / Use bundled**
3. ใส่ **OpenAI Tunnel ID**
4. กด **Configure Tunnel**
5. lnwjud จะสร้าง/ซ่อม profile ของตัวเองและชี้ Tunnel ไปยัง Desktop loopback MCP เช่น `http://127.0.0.1:<port>/mcp`
6. ถ้ายังไม่เชื่อม ให้กด **Reconnect Tunnel เดิม** ใน Settings หรือ **Start Tunnel** จากหน้า Home

ไม่ต้องรันคำสั่ง `init`, `doctor` หรือ `run` เองในการใช้งานปกติ

Runtime key ถูกเก็บด้วย Windows DPAPI และ profile จะอ้าง key ผ่าน `env:CONTROL_PLANE_API_KEY` แทนการเขียน key จริงลง YAML

## 5. เชื่อม lnwjud เข้ากับ ChatGPT

1. เปิด Developer mode ของ ChatGPT ถ้า plan/workspace รองรับ
2. เปิดหน้า Plugins/Connections
3. เพิ่ม connection ใหม่
4. เลือก Connection แบบ **Tunnel**
5. เลือก Tunnel ที่สร้างไว้ หรือใส่ `tunnel_id`
6. สร้าง connection แล้วตรวจว่าเห็น tools ของ lnwjud

ถ้าเพิ่งอัปเดต lnwjud หรือ tool schema เปลี่ยน:

1. กด **Refresh connector** ใน ChatGPT ก่อน
2. ถ้ายังเห็น schema/tool เก่า ค่อยเปิดแชทใหม่

การ refresh connector สำคัญเมื่ออัปเดต build เพราะ ChatGPT อาจ cache tool schema จาก connection เดิมไว้

## 6. ทดสอบหลังเชื่อมต่อ

เริ่มจาก read-only ก่อน เช่น:

```text
Use lnwjud to list registered workspaces, report Git status for the active project, and summarize the top-level project tree. Do not modify anything.
```

ถ้าผ่าน แปลว่าเส้นทางนี้ทำงานครบ:

```text
ChatGPT → OpenAI Secure MCP Tunnel → bundled tunnel-client → lnwjud Desktop HTTP MCP → local tools
```

จากนั้นจึงลองงานเขียนไฟล์หรือ execute

## 7. Work Log / บันทึกการทำงาน

หน้า **บันทึกการทำงาน / Work Log** แสดง TASK / RESULT / ERROR พร้อม Workspace และ Session เพื่อแยกงานหลายแชท/หลายโปรเจกต์

ใน v4.11.0:

- tool call ใหม่ควรแสดง target/operation จริง แทนการเห็นแค่ `SUCCESS`
- `shell`, `git`, `process_start`, `project_*` และ process follow-up จะแสดง executable/arguments ที่รู้จริง
- file tools จะแสดง path หรือ source → destination
- capability tools จะแสดง action/operation และ target ที่ปลอดภัยต่อการ log
- secret/token/password/API key จะถูก redact จาก activity summary
- TASK ของ `project_*` จะอัปเดตเป็น resolved command จริงเมื่อ gateway resolve command แล้ว
- follow-up เช่น `process_status` จะจำ command ต้นทางของ process handle

ประวัติเก่าที่บันทึกมาตั้งแต่ build ก่อนมี target detail ไม่สามารถย้อนสร้าง command ที่ไม่เคยถูกเก็บได้ จึงจะแสดง `details unavailable (legacy log)` แทนการทำให้เข้าใจผิดว่า `SUCCESS` คือรายละเอียดคำสั่ง

## 8. Active Projects และหลายแชทพร้อมกัน

v4.11.0 รองรับ Active Projects หลายรายการพร้อมกัน

- แต่ละ MCP session มี session identity แยกกัน
- process/task handle ถูกแยกตาม owner/session
- mutation ต้องอยู่ในชุด Active Projects ของ host
- Primary Project เป็นค่า default เมื่อ client ไม่ได้ระบุ project ชัดเจน
- Work Log และ Live Logs สามารถกรอง Workspace / Session ได้

อย่าเลือกทั้งไดรฟ์เป็น Active Project เพียงเพื่อความสะดวก ถ้างานจริงอยู่ใน project folder ที่เจาะจง

## 9. Permission และการลบไฟล์

Profile หลัก:

- `safe` — อ่านได้ แต่ write/execute หลายอย่างต้องอนุมัติ
- `balanced` — ใช้งานพัฒนาปกติได้สะดวกขึ้น
- `full` — สำหรับเครื่อง/โปรเจกต์ที่เชื่อถือได้
- `custom` — host-defined policy

แม้ Full Access จะลด prompt สำหรับงานทั่วไป แต่ operation ที่เป็น deletion/data loss, destructive rewrite, protected path หรือ escape ออกจาก Active Project ยังมี policy/approval ของตัวเอง

`delete_file` เป็น deletion primitive ที่ออกแบบให้ทำงานร่วมกับ Recovery Trash เมื่อ target รองรับการกู้คืน ส่วนคำสั่ง arbitrary shell/script ถือเป็น opaque execution และไม่ควรสมมติว่าสามารถกู้ผ่าน Recovery Trash ได้ทุกกรณี

## 10. Recovery Center

เปิด **Settings → Recovery Center**

มีข้อมูลหลัก:

- Recovery Trash จากไฟล์ที่ลบผ่าน supported flow
- backup ก่อน binary replacement ที่รองรับ
- encrypted checkpoints

ตารางหน้า Recovery แสดงรายการล่าสุดในพื้นที่คงที่พร้อม scrollbar ส่วน retention ผู้ใช้เลือกเอง:

- `0` วัน = ไม่ลบอัตโนมัติ เก็บจนกว่าจะจัดการเอง
- มากกว่า `0` = ลบข้อมูล recovery ที่เก่ากว่าจำนวนวันที่ตั้งไว้

เมื่อเปลี่ยนจากไม่ลบอัตโนมัติไปเป็น retention ที่สั้นลง โปรแกรมจะเตือนก่อน เพราะข้อมูลเก่าอาจถูก cleanup ทันที

## 11. Live Logs

Live Logs ใช้ดูสถานะ realtime ของ:

- Tunnel/runtime lifecycle
- MCP activity
- managed processes/tasks

ถ้างาน fail ให้ดู Live Logs และหน้า Doctor ก่อน ไม่จำเป็นต้องเปิด PowerShell เพื่อรัน tunnel-client เอง

## 12. Doctor / Troubleshooting

อาการที่พบบ่อย:

| อาการ | ตรวจสอบ |
|---|---|
| ChatGPT ยังเห็น tool/schema เก่า | Refresh connector ก่อน ถ้ายังเก่าค่อยเปิดแชทใหม่ |
| Tunnel ไม่เชื่อม | ตรวจ Runtime API key, Tunnel ID, association และกด Reconnect Tunnel เดิม |
| tunnel-client override เสีย | ล้างช่อง override แล้วกด Use bundled |
| Work Log ของรายการเก่ามี `details unavailable (legacy log)` | เป็นข้อมูลเก่าที่ไม่เคยเก็บ target จริง ไม่ใช่ error ของ tool call ใหม่ |
| งาน execute ไม่ผ่าน | ตรวจ Active Projects และ Permission profile |
| process ยังทำงาน | ใช้ process/task status/logs แทนการ tight-poll หรือเปิดคำสั่งซ้ำ |
| มีหน้าต่าง CMD/PowerShell เด้งตอนโปรแกรมทำงาน | ไม่ควรเกิดใน internal launch ปกติ; เก็บเวลา/operation ที่ทำแล้วดู Live Logs เพื่อหา regression |
| เห็น `Console Window Host (conhost.exe)` ใน Task Manager | Windows อาจสร้าง conhost แบบซ่อนสำหรับ console-subsystem child เช่น PowerShell ได้ เป็นเรื่องปกติถ้าอายุสั้น/CPU ต่ำ; ถ้า CPU สูงต่อเนื่องให้เก็บ PID/เวลาแล้วตรวจ process parent |
| Office tool ใช้ไม่ได้ | ตรวจว่า Microsoft Office ติดตั้งและไฟล์ไม่ถูก lock |
| `screen_record` ใช้ไม่ได้ | ตรวจ ffmpeg บน PATH |

หน้า Doctor ของ v4.11.0 ตรวจ Persistent Tunnel identity/runtime, readiness, health, polling, local MCP binding และ tunnel-ID mismatch ได้ด้วย

## 13. Local STDIO สำหรับ Codex/IDE

Secure Tunnel สำหรับ ChatGPT web ใช้ **Desktop HTTP MCP** และ bundled tunnel-client

ส่วน Codex CLI หรือ MCP host ที่อยู่บนเครื่องเดียวกันใช้ packaged STDIO launcher ได้โดยตรง:

```text
lnwjud-mcp-stdio.cmd --workspace E:\projects\my-app
```

ตัว release bundle private Node.js 24 มาให้ launcher นี้แล้ว จึงไม่ต้องลง Node.js system-wide

## 14. Build จาก source

เฉพาะนักพัฒนา:

- Windows 10/11 x64
- Node.js 24.x
- Git
- Corepack
- pnpm 10.15.0 ตาม repo

```powershell
git clone https://github.com/engasnm111/lnwjud.git
Set-Location .\lnwjud
corepack enable
corepack pnpm@10.15.0 install --frozen-lockfile
corepack pnpm@10.15.0 typecheck
corepack pnpm@10.15.0 test
corepack pnpm@10.15.0 build
corepack pnpm@10.15.0 package:windows
```

`package:windows` จะดาวน์โหลด official OpenAI tunnel-client v0.0.12 สำหรับ **ขั้นตอน build Windows artifacts** เท่านั้น ตรวจ SHA-256 ที่ pin ไว้ แล้ว bundle binary เข้า Installer/Portable อัตโนมัติ End user ที่ใช้ release ไม่ต้องทำขั้นตอนนี้

ไฟล์ที่ได้จะอยู่ที่:

```text
apps/desktop/dist/installers/lnwjud-Setup-4.11.0.exe
apps/desktop/dist/installers/lnwjud-Portable-4.11.0.exe
```

ดูรายละเอียด architecture/tool catalog เพิ่มเติมที่ `README.md`, `docs/mcp/MCP_TOOL_CATALOG.md` และ `docs/architecture/`
