# ChatGPT Chat + lnwjud: Outcome-Driven Continuity

> สถานะ: ใช้กับ lnwjud v4.11.0+ ผ่าน ChatGPT Chat + Plugins / MCP
> เป้าหมาย: ให้ ChatGPT ใช้ lnwjud ทำงานต่อเนื่องจนผลลัพธ์ที่ผู้ใช้สั่งเสร็จ โดยไม่มี timer 22/25/60 นาทีจาก lnwjud
> นโยบาย: กลุ่ม `codex_*` ปิดเป็นค่าเริ่มต้นและไม่ advertise เว้นแต่ผู้ใช้เปิดเอง

## 1. กติกาหลัก: จบตามผลลัพธ์ ไม่ใช่เวลา

lnwjud ไม่มี elapsed-time cutoff และไม่เติมข้อความให้ ChatGPT หยุด, handoff หรือรอคำว่า “ทำต่อ” ตามเวลาที่ผ่านไป

เมื่อเชื่อม MCP สำเร็จ server จะประกาศกติกาให้ client ว่า:

- ใช้ tools ต่อจน requested outcome เสร็จ
- ห้ามหยุดหรือขอให้ผู้ใช้พิมพ์ `continue` เพียงเพราะเวลาผ่านไป
- หยุดเมื่อเสร็จจริง, ต้องการคำตัดสิน/สิทธิ์ใหม่จากผู้ใช้ หรือมี external blocker ที่ทำต่ออย่างปลอดภัยไม่ได้
- background task ใช้ตามธรรมชาติของ command ไม่ใช่ใช้เพื่อหนี timer

ไม่มีค่าคงที่ 22, 25 หรือ 60 นาทีสำหรับความต่อเนื่องของ run

## 2. งานโต้ตอบกับงาน background

ChatGPT ควรเรียก tools ปกติและทำ reasoning ต่อเมื่อขั้นตอนถัดไปยังต้องอาศัยผลลัพธ์ก่อนหน้า เช่น อ่านโค้ด แก้ไฟล์ รัน targeted test และแก้ failure

ใช้ durable background task เมื่อ command มีลักษณะเหมาะสม เช่น:

- full monorepo build/test ที่รันแยกได้
- installer/package
- dependency operation หรือ benchmark ที่ไม่ต้องตัดสินใจระหว่างทาง
- service/process ที่ตั้งใจให้ทำงานต่อเบื้องหลัง

เมื่อเริ่ม background task แล้ว ให้เก็บ `task_id`, ทำงานส่วนอื่นที่ไม่ชนกัน และกลับมาเช็ก `status` / `logs` / `result` จน terminal ภายใน run เดิมตราบใดที่ยังทำต่อได้ ห้ามจบ run เพียงเพราะ task ยังรันอยู่

## 3. Persistent tunnel กับ durable execution

สองส่วนนี้แก้คนละเรื่อง:

- Persistent tunnel รักษา Tunnel ID เดิมและ reconnect local runtime โดยไม่ให้ผู้ใช้สร้าง connector ใหม่
- Durable execution ทำให้ command ที่เครื่องไม่ตายเมื่อ transport หลุดชั่วคราว

ทั้งสองส่วนสนับสนุน outcome-driven run แต่ไม่ควรเพิ่มคำสั่งหยุดตามเวลาเข้าไปใน tool result

## 4. Tracker ใช้เก็บสถานะ ไม่ใช่นาฬิกานับถอยหลัง

ถ้า repository มี `docs/PHASE_PROGRESS.md` ให้ใช้เป็น source of truth สำหรับงานหลาย phase:

1. อ่าน pending item ที่เกี่ยวข้องก่อน ไม่สำรวจใหม่ทั้ง repoโดยไม่จำเป็น
2. อัปเดตหลัง milestone สำคัญหรือเมื่อสถานะจริงเปลี่ยน
3. บันทึก durable `task_id` พร้อม acceptance ที่ต้องตรวจ
4. ทำ phase ถัดไปต่อทันทีเมื่อยังมีงานที่ปลอดภัยและอยู่ใน scope
5. ใช้ `session_handoff` เฉพาะเมื่อผู้ใช้ขอส่งต่องาน หรือเกิด client/platform interruption ที่หลีกเลี่ยงไม่ได้

## 5. Context economy ระหว่างงานยาว

- ไม่แน่ใจตำแหน่งโค้ด → `search_text` ก่อน
- ไฟล์ใหญ่ → `read_file_page` / `read_file_page_continue`
- ตรวจซ้ำหลัง diff เล็ก → `verify_incremental`
- project command ปกติ → `project_*`
- command ที่รันแยกได้ → durable `shell` background
- `process_status` เป็น snapshot; อย่า tight-poll

การประหยัด context มีไว้เพิ่มพื้นที่ reasoning ไม่ใช่เป็นเหตุให้หยุดงานก่อนเสร็จ

## 6. การกู้คืนเมื่อ client/platform ขัดจังหวะจริง

ถ้า run ถูก client หรือ platform ขัดจังหวะจากภายนอก:

1. ใช้แชทเดิมก่อน
2. อ่าน tracker และดึง durable task เดิมด้วย `task_id`
3. ตรวจ git status/diff เท่าที่จำเป็น
4. ทำต่อจาก pending acceptance แรก
5. Refresh connector เฉพาะเมื่อ tool schema เปลี่ยนหรือ cache ค้างจริง

`session_handoff` เป็น recovery tool ไม่ใช่ scheduled stop และไม่ควรถูกเรียกเพียงเพราะ elapsed time

## 7. Codex delegation

`codex_status`, `codex_run`, `codex_task_*`, `codex_stop` ไม่ register/advertise โดย default เพื่อไม่ใช้ Codex quota โดยไม่ได้ตั้งใจ

ChatGPT Chat สามารถอ่าน เขียน รันคำสั่ง และตรวจผลผ่าน lnwjud tools โดยตรง การเปิด `codex_*` ทำเฉพาะเมื่อผู้ใช้ตั้งใจมอบงานให้ Codex CLI แยกต่างหาก

## 8. Prompt แนะนำสำหรับงานแบบสั่งครั้งเดียว

```text
ทำงานนี้ต่อเนื่องจน acceptance ครบทั้งหมด
อย่าหยุดหรือรอคำว่า “ทำต่อ” เพียงเพราะเวลาผ่านไป
ถ้ามี command ที่เหมาะกับ background ให้เก็บ task_id แล้วทำงานอื่นต่อ
กลับมาตรวจ task จน terminal และแก้ failure ต่อใน run เดิม
หยุดเฉพาะเมื่อเสร็จจริง หรือต้องการข้อมูล/สิทธิ์ใหม่จากฉันอย่างหลีกเลี่ยงไม่ได้
```

## 9. Checklist

- [ ] MCP/Tunnel ออนไลน์และ workspace ถูกต้อง
- [ ] ไม่มี budget-warning/handoff instruction แบบกำหนดนาทีใน tool result
- [ ] MCP initialize มี outcome-driven instructions
- [ ] tracker ตรงกับสถานะจริง (ถ้ามี)
- [ ] background task ทุกตัวมี `task_id`
- [ ] ไม่มี writer สองตัวชน workspace เดียวกัน
- [ ] Codex delegation ปิด เว้นแต่ผู้ใช้ตั้งใจเปิด

## 10. Troubleshooting

| อาการ | ตรวจ/แก้ |
| --- | --- |
| ChatGPT หยุดแถว 22–25 นาที | ตรวจว่าใช้ build v4.11.0 ที่มี outcome-driven fix และ tool result ไม่มีข้อความ `ใกล้หมด budget` |
| Tunnel หลุด | ตรวจ persistent runtime doctor/reconnect ของ Tunnel ID เดิม |
| Background task ยังรัน | ใช้ `status` / `logs` / `result`; ทำงานอื่นต่อและกลับมาตรวจจน terminal |
| Tool schema เก่า | Restart runtime ถ้าจำเป็น แล้ว Refresh connector; chat ใหม่เป็นทางเลือกสุดท้าย |
| Typecheck ซ้ำทั้งที่ diff ไม่เปลี่ยน | ใช้ `verify_incremental` และตรวจ `cache: hit` |
| Run ถูกขัดจังหวะจาก platform จริง | ใช้แชทเดิม + tracker/task ID; `session_handoff` เป็น recovery fallback |
