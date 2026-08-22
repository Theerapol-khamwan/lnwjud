# ChatGPT Codex App + lnwjud Plugins: คู่มือทำงานยาว (Long Session Guide)

> สถานะ: ใช้กับ lnwjud v4.7.1+ ผ่าน ChatGPT โหมดแชท + Plugins / MCP
> เป้าหมาย: ยอมรับว่า AI run มี budget จำกัด แต่ทำให้งานที่เครื่อง **ไม่ถูกตัดตาม AI run** และให้ run ถัดไปต่อใน **แชทเดิม** ได้ทันที
> นโยบายปัจจุบัน: กลุ่ม `codex_*` ปิดเป็นค่าเริ่มต้นและไม่ advertise ให้ agent เห็น เว้นแต่ผู้ใช้เปิดเอง

---

## 1. แยก "AI run" ออกจาก "งานที่เครื่อง"

ChatGPT/Codex โหมดแชทมี budget ต่อ run และ Plugins ใช้โควต้าของแชท การที่ run จบหรือถูกตัดไม่ได้แปลว่าโปรเซสที่เครื่องต้องจบตามไปด้วย

lnwjud แยกงานออกเป็น 2 แบบ:

- **งานสั้น/โต้ตอบ**: tool call ปกติ, `project_*`, `search_text`, `read_file_page`
- **งานยาวที่ต้องรอดข้าม run**: `shell` + `execution: "background"` → ได้ durable `task_id` → งานรันต่อที่เครื่อง → run ถัดไปใช้ `status` / `logs` / `result` ด้วย `task_id` เดิม

กฎใช้งาน: ถ้าคาดว่างานจะเกินประมาณ **5 นาที** เช่น full build, full test, installer/package, dependency install ใหญ่ หรือ benchmark ยาว ให้ส่งเป็น durable background ตั้งแต่แรก ไม่ต้องให้ AI ถือ connection รอ

งานที่กิน 30–60 นาทีจึงทำได้จริงที่เครื่อง แม้ AI run จะจบไปก่อนแล้ว

## 2. Budget Guard — เตือนก่อน run ถูกตัดกลางงาน

lnwjud เริ่มนับ budget ตั้งแต่ **tool call แรกของ run** ที่ dispatch กลางเดียวกับ progress heartbeat

เมื่อ elapsed ประมาณ **22 นาทีขึ้นไป** ทุก tool result จะมีข้อความท้ายผลลัพธ์:

```text
ใกล้หมด budget — อัปเดต tracker + สั่งงานยาวเป็น background เดี๋ยวนี้
```

เมื่อเห็นข้อความนี้ให้ทำตามลำดับ:

1. อัปเดต `docs/PHASE_PROGRESS.md` ทันที
2. งานที่ยังต้องใช้เวลานานให้ย้ายไป `shell execution=background`
3. เขียน `task_id` ลง tracker
4. ถ้ายังมีเวลาให้ทำ targeted verification เท่านั้น
5. ก่อนจบใช้ `session_handoff`

Budget Guard ไม่ได้พยายามยืด hard cap ของ ChatGPT แต่ทำหน้าที่ checkpoint ก่อนชน cap

## 3. Tracker-First + Durable-Task-First

Tracker หลักคือ `docs/PHASE_PROGRESS.md`

กฎทุก run:

1. เริ่มจาก tracker + pending item แรก ไม่สำรวจใหม่ทั้ง repo ถ้า tracker บอกตำแหน่งไว้แล้ว
2. หลัง sub-step สำคัญให้ update tracker ทันที ไม่รอท้าย run
3. ถ้าสั่ง background task ต้องบันทึก `task_id`, คำสั่ง/เป้าหมาย และสิ่งที่ run ถัดไปต้องเช็ค
4. Run ถัดไปดึงงานเดิมด้วย `shell status/logs/result` จาก task ID เดิม
5. ห้าม tight-poll `process_status` หรือ task status ทุกไม่กี่วินาที; เช็คเมื่อมีเหตุผลหรือเมื่อคาดว่างานควรคืบหน้าแล้ว
6. ก่อนจบ run ให้ tracker มี Resume note ที่บอกไฟล์/ฟังก์ชัน/คำสั่งถัดไปชัดเจน

### งานแบบไหนควรเป็น background

| งาน | แนวทาง |
| --- | --- |
| targeted typecheck สั้น | `verify_incremental` |
| targeted test/lint/build | `project_test` / `project_lint` / `project_build` |
| full monorepo test/build | `shell` background |
| Windows installer/package | `shell` background |
| install/dependency operation ที่นาน | `shell` background |
| benchmark / e2e ยาว | `shell` background |

## 4. Context Economy — คืนเวลางานแก้จริง

อย่าเสีย run กับการอ่าน/poll ซ้ำ:

- ตำแหน่งโค้ดไม่แน่ชัด → ใช้ `search_text` ก่อน
- ไฟล์ใหญ่ → `read_file_page` / `read_file_page_continue`; อย่าอ่านทั้งไฟล์ซ้ำ
- ตรวจ typecheck ระหว่างแก้ → `verify_incremental`
- งาน project command ปกติ → `project_*`
- งานเกิน ~5 นาที → durable `shell background`
- `process_status` เป็น snapshot ไม่ใช่ polling loop

### `verify_incremental`

`verify_incremental` สร้าง cache key จาก Git status + staged diff + unstaged diff ของ workspace

- diff เดิม → `cache: "hit"` ไม่เสียเวลารัน typecheck ซ้ำ
- diff เปลี่ยน → `cache: "miss"` แล้วรัน detected project typecheck ใหม่
- ผลล้มเหลวก็ cache ตาม diff เดิม เพื่อไม่รันซ้ำจนกว่าจะมีการแก้ไฟล์

ใช้ตัวนี้หลัง edit unit เล็ก ๆ แทน full lint+test+build ทุกครั้ง แล้วค่อยรัน gate เต็มเมื่อจบ phase

## 5. การต่อ run

**ค่าเริ่มต้นคือทำ run ถัดไปในแชทเดิม** ไม่ต้องเปิดแชทใหม่ทุก 30 นาที

เหตุผล:

- context การคุยและ intent ยังต่อเนื่อง
- `session_handoff` สร้าง continuation prompt ให้พร้อมกดส่ง
- durable task ID ทำให้งานที่เครื่องต่อข้าม run ได้
- เปิดแชทใหม่โดยไม่จำเป็นทำให้เสียเวลาสร้าง context ใหม่

### ถ้า tool schema ดูเก่า

1. Restart MCP/tunnel เฉพาะเมื่อ setting/tool registry เปลี่ยนจริง
2. กด **Refresh connector**
3. ทดสอบ tools/list ใหม่
4. **เปิด chat ใหม่เฉพาะเมื่อ Refresh connector ยังแก้ schema ค้างไม่ได้**

### 5A. `session_handoff` — ปุ่มต่อ run

ก่อน run จบให้เรียก `session_handoff` โดยระบุ workspace

Tool จะอ่านอัตโนมัติ:

- `docs/PHASE_PROGRESS.md`
- `git_status`
- staged + unstaged `git_diff`
- durable background task IDs จาก shell task store

แล้วคืน `prompt` กระชับพร้อมส่งในแชทเดิม รูปแบบหลัก:

```text
Continue this run in the same chat from docs/PHASE_PROGRESS.md.

Tracker excerpt:
<ข้อมูลจริงจาก tracker>

Current Git changes: <ไฟล์ที่เปลี่ยน>
Durable background tasks:
- <task_id> (<state>)

Start by:
1. Run the "Next chat startup probe" from the tracker.
2. Recover durable jobs by task_id with shell status/logs/result; do not tight-poll.
3. Inspect git status/diff only as needed for the current phase.
4. Work one phase only and use search_text/read_file_page instead of re-reading large files.
5. Use verify_incremental for repeated typecheck; use targeted project_* verification as needed.
6. Before ending, update the tracker. Jobs expected to exceed ~5 minutes should run as durable shell background tasks and their task_id must be written to the tracker.

Do not redo completed phases unless verification proves a regression.
If tool schema looks stale, Refresh connector first; open a new chat only if Refresh connector does not fix it.
```

ผู้ใช้จึงแค่กดส่ง prompt ที่ tool สร้าง ไม่ต้องจำ/พิมพ์ resume note เอง

## 6. ชั้นการทำงาน

### ชั้น C — ChatGPT/Codex App Chat + Plugins (ทางหลัก)

ใช้ lnwjud tools โดยตรง, tracker-first, Budget Guard, `verify_incremental`, durable background และ `session_handoff`

### ชั้น A — Codex Work delegation (`codex_*`) — ปิดตามนโยบาย

`codex_status`, `codex_run`, `codex_task_*`, `codex_stop` **ไม่ register/ไม่ advertise โดย default** เพื่อกัน agent ใช้ Work/Codex quota โดยไม่ได้ตั้งใจ

เปิดได้เฉพาะเมื่อผู้ใช้ตั้งใจเปิด setting `Enable Codex delegation tools` และ restart MCP/Tunnel เพื่อสร้าง registry ใหม่ หลังเปิดแล้วจึงเห็น tool กลุ่มนี้

### ชั้น B — client ที่ต่อ MCP โดยตรง

CLI/IDE/client อื่นที่ต่อ stdio สามารถใช้ durable background contract เดียวกันได้ หลัก tracker/task ID ยังเหมือนเดิม

## 7. Template prompts

### A. Resume ในแชทเดิม

แนะนำให้ใช้ `session_handoff` แทนการเขียนเอง ถ้าต้องเขียนเองใช้:

```text
Continue this run in the same chat from docs/PHASE_PROGRESS.md.

Start by:
1. Run the "Next chat startup probe" from the tracker.
2. Recover any durable background task IDs with shell status/logs/result.
3. Inspect git status/diff only as needed for the current phase.
4. Work one phase only.
5. Use verify_incremental for repeated typecheck and targeted project_* checks only as needed.
6. Update docs/PHASE_PROGRESS.md before ending.

If the run is near budget, update the tracker first and move long work to shell background.
Do not redo completed phases unless verification proves a regression.
If tool schema is stale, Refresh connector first; open a new chat only if refresh fails.
```

### B. Long machine job

```text
งานนี้น่าจะเกิน 5 นาที ให้สั่งด้วย shell execution=background ทันที
เขียน task_id ลง docs/PHASE_PROGRESS.md พร้อมคำสั่งและ acceptance ที่ต้องเช็ค
อย่า tight-poll ระหว่างรอ ให้ทำงานอื่นที่ไม่ชนไฟล์ หรือจบ run ได้
run ถัดไปใช้ task_id เดิมดึง status/logs/result แล้วเดินต่อ
```

### C. Planning run

```text
อ่าน docs/PHASE_PROGRESS.md แล้วเลือก pending phase แรก
อย่าแก้โค้ด หน้าที่เดียวคือเขียน docs/PLAN_<phase>.md:
- ไฟล์ที่จะแก้/สร้าง
- จุดเปลี่ยนที่ชัดเจน
- acceptance และคำสั่ง verify
- รายการห้ามแตะ
- ลำดับ sub-step
แล้วอัปเดต tracker + Resume note ให้ execution run เริ่มทำได้ทันที
```

## 8. Checklist ก่อน run ยาว

- [ ] MCP/Tunnel ออนไลน์และ workspace ถูกต้อง
- [ ] `docs/PHASE_PROGRESS.md` เป็นปัจจุบัน
- [ ] dependency หลักติดตั้งแล้ว
- [ ] งานที่คาด >5 นาทีวางแผนเป็น durable background
- [ ] มีพื้นที่ disk/power plan พอให้งานเครื่องรันต่อแม้ AI run จบ
- [ ] ไม่รันสอง writer พร้อมกันบน workspace เดียว
- [ ] Codex delegation tools ปิด เว้นแต่ผู้ใช้ตั้งใจเปิด

## 9. Troubleshooting

| อาการ | ทางแก้ |
| --- | --- |
| ใกล้หมด run budget | อัปเดต tracker → ย้ายงานยาวเป็น background → เก็บ task ID → `session_handoff` |
| AI run จบแต่งาน package/test ยังต้องรัน | ไม่ต้องเริ่มใหม่; run ถัดไปดึง `shell status/logs/result` ด้วย task ID เดิม |
| tool schema เก่า | Restart runtime ถ้าจำเป็น → Refresh connector; chat ใหม่เป็นทางเลือกสุดท้าย |
| typecheck ซ้ำโดยไฟล์ไม่เปลี่ยน | ใช้ `verify_incremental`; ต้องเห็น `cache: hit` |
| แต่ละรอบหมดกับการอ่านไฟล์ | `search_text` → `read_file_page`; อย่าอ่านทั้งไฟล์ซ้ำ |
| หมดเวลากับ status polling | หยุด tight-poll; งานยาวใช้ durable background |
| `codex_*` ไม่เห็น | ถูกต้องตาม default policy; เปิด setting เฉพาะเมื่อผู้ใช้ต้องการใช้ Codex quota |
