# First-run & Permission Flow Audit — Post-remediation Review

วันที่ตรวจครั้งแรก: 2026-08-28
วันที่รีวิวหลังแก้: 2026-08-28
วันที่รีวิว drive-registration regression: 2026-08-28
Repository: `E:\lnwjud`
Branch: `dev`
Baseline ก่อนแก้: `5e77fadaa9e68b0fe03fe858dfe26e5b2fee09b8`
Baseline ก่อนแก้ drive-registration: `266677e8dcb3be3ebebd8c53caf379ed40720c7d`
ขอบเขต: current working tree ก่อน local commit; ไม่มีการ push

## Verdict

**IMPLEMENTATION PASS — เหลือ release-environment residuals**

การแก้ใน working tree ตรงกับ product decision แล้ว:

- Profile = **Full** อย่างเดียวไม่เปิด bypass
- มี toggle แยกสำหรับ **Desktop HTTP/Secure Tunnel** และ **direct STDIO**
- toggle ทั้งสองอยู่ในการ์ด **Full Access (Unrestricted)** แยกจาก Custom
- เมื่อ transport นั้นใช้ Full profile และเปิด Full Bypass แล้ว lnwjud ข้าม application-level approval/scope policy ทั้งหมด โดยไม่ถามซ้ำ แม้ tool/action จะประกาศว่า “ต้องยืนยันเสมอ”
- ครอบคลุม execution, destructive/data-loss command, native host approval, Active Project, allowed/Strict Roots, protected path, explicit absolute path/cwd นอกโปรเจกต์ และ `goalLease`
- การอนุมัติถูกส่งเป็น trusted out-of-band `InvocationAuthorization`; runtime ไม่ปลอม input ของผู้เรียกเป็น `userConfirmed: true`
- first-run, Doctor, Add Project, STDIO policy และ recovery flow ที่พบใน audit เดิมได้รับการแก้และมี regression tests
- ไม่มีการสแกน `A:`–`Z:` หรือลงทะเบียน drive root อัตโนมัติอีก จึงไม่แตะ mapped/network drive เช่น `Z:` ที่ชี้ไป DGX Spark ตอน startup
- migration archive เฉพาะ legacy row ที่มีลายเซ็น `Local Disk X:` แบบกู้กลับได้ โดยไม่ลบ project/manual root หรือข้อมูลใน drive

Full Bypass เป็นการข้าม policy ของ **lnwjud** ไม่ใช่การรับประกันว่า OS หรือบริการภายนอกจะทำสำเร็จทุกครั้ง: schema/input ที่ผิด, relative traversal, path ที่ไม่มีอยู่, task/process/worktree ownership, Windows ACL/UAC, executable/provider ที่ไม่มี และ authorization ของ remote/child service ยังสามารถทำให้คำสั่งล้มเหลวได้ แต่ lnwjud จะไม่ถาม approval เพิ่มในโหมดนี้

## สรุปผล findings เดิม

| ID | เดิม | สถานะหลังรีวิว | หลักฐานสำคัญ |
| --- | --- | --- | --- |
| F-01 | Initial IPC failure ค้าง Loading | **Resolved** | initial dashboard/workspace bootstrap แยก error, แสดง partial UI และมี Retry |
| F-02 | คำสั่ง STDIO ไม่ใช้ saved policy | **Resolved** | launcher ใช้ `lnwjud-mcp-stdio.cmd` และส่ง profile, strict roots, Full Bypass ของ STDIO |
| F-03 | Full bypass เป็น partial/implicit | **Resolved** | toggle แยก 2 transport, default OFF, ใช้ได้เฉพาะ Full, มี trusted authorization และ audit marker |
| F-04 | `PERMISSION_REQUIRED` retry แล้ว schema ไม่รับ `userConfirmed` | **Resolved** | central gateway สร้าง authorization envelope out-of-band และส่งถึง inner runtime |
| F-05 | Doctor ตรวจ port ผิด/ซ่อน start failure | **Resolved** | probe configured endpoint ผ่าน `/_lnwjud/identity`; start/readiness error แสดงและ retry ได้ |
| F-06 | Custom `ALLOW` ยังถูกบังคับถาม | **Resolved** | decision ใช้ resolved Custom profile; invariant tests ครอบคลุม Custom allow |
| F-07 | invalid profile fail-open เป็น Full | **Resolved** | invalid/missing persisted profile fallback เป็น Balanced; Full Bypass default OFF |
| F-08 | Doctor exception เปิด navigation แบบไม่ชัดเจน | **Resolved** | Projects และ Doctor ใช้งานได้ระหว่าง recovery; สถานะแจ้งเตือนแทน dead end |
| F-09 | Safe เริ่ม process ได้แต่หยุดไม่ได้ | **Resolved** | process start/stop ใช้ authorization contract เดียวกันและยังตรวจ process ownership |
| F-10 | เอกสาร Secure Tunnel ปะปนกับ STDIO | **Resolved** | docs แยก Desktop HTTP/Secure Tunnel กับ direct STDIO และ flag ของแต่ละ transport |
| F-11 | Add Project ล้าง path เมื่อเพิ่มไม่สำเร็จ | **Resolved** | input ถูกเก็บไว้เมื่อ IPC/repository ล้มเหลว; rejection ถูก catch และแสดงผล |
| F-12 | “Later” ยังกลับมาเปิด wizard | **Resolved** | ปิด/ไว้ทีหลังบันทึก state = `dismissed` และไม่ relaunch อัตโนมัติ |
| F-13 | polling เปิด modal/แย่ง focus ซ้ำ | **Resolved** | prerequisite signature ทำให้เปิด onboarding ต่อ state transition เพียงครั้งเดียว |
| F-14 | startup ใช้ `existsSync(A:\…Z:\)` แล้วลง mapped/network drive เป็น Local Disk | **Resolved** | เลิก enumerate drive ทั้ง Desktop/STDIO/capability runtime, ใช้เฉพาะ project/path ที่ระบุ และ archive generated root เก่า |

ผลรวมหลังแก้: **14/14 findings ปิดใน implementation**

## First-run flow หลังแก้

```text
Launch Desktop
  ├─ start local MCP
  │    ├─ success → identity/readiness available
  │    └─ failure → visible recovery state + Retry/Doctor
  ├─ load dashboard and workspaces independently
  │    ├─ both success → normal shell
  │    └─ partial/failure → usable shell + precise error + Retry
  ├─ migrate legacy workspace registrations
  │    ├─ archive เฉพาะ generated `Local Disk X:` rows
  │    └─ ไม่ probe drive, ไม่แตะ project/manual root และไม่ลบไฟล์จริง
  ├─ Startup Doctor
  │    ├─ workspace is optional on a clean first run
  │    ├─ configured MCP port must answer /_lnwjud/identity
  │    └─ Projects and Doctor stay reachable during recovery
  ├─ Add Project
  │    └─ failure preserves typed path and reports error
  └─ Permission setup
       ├─ default profile = Balanced
       ├─ Full profile does not imply Full Bypass
       └─ Desktop and STDIO Full Bypass are independent, explicit, default OFF
```

Direct STDIO ครั้งแรกต้องระบุ `--workspace <absolute-project-path>` หรือมี project ที่ลงทะเบียนไว้แล้ว; runtime จะไม่เดา system/home/current drive และ `workspace_register` ลง project จาก absolute path ได้โดยไม่ต้องสร้าง machine-root parent ก่อน

## Permission behavior ที่ยืนยันจาก implementation

สัญลักษณ์: `AUTO` = profile อนุญาต, `ASK` = ต้องยืนยันตาม policy, `DENY` = profile/policy ปฏิเสธ, `BYPASS` = ข้าม authorization/scope ของ lnwjud

| Operation class | Safe | Balanced | Full + Bypass OFF | Full + Bypass ON | Custom |
| --- | --- | --- | --- | --- | --- |
| Pure read | AUTO | AUTO | AUTO | BYPASS | ตามค่า READ |
| Bounded create/write | ASK | AUTO | AUTO | BYPASS | ตามค่า WRITE |
| Replace/overwrite | ASK | ASK ตาม mutation policy | AUTO สำหรับงานปกติ | BYPASS | ตาม resolved action |
| Ordinary explicit execute | ASK | AUTO | AUTO | BYPASS | ตามค่า EXECUTE |
| Always-confirm tool/action | ASK/DENY ตาม class | ASK | ASK | **BYPASS** | ตาม resolved action |
| Delete / opaque external effect | DENY | ASK | ASK | **BYPASS** | ตามค่า DANGEROUS |
| Destructive/prohibited command | DENY | DENY/ASK | hard policy มีผล | **BYPASS** | ตาม policy |
| Outside Active Project / allowed roots / protected path | DENY | DENY | DENY/ASK | **BYPASS สำหรับ explicit absolute target** | DENY |
| Missing/invalid `goalLease` | DENY mutation | DENY mutation | DENY mutation | **BYPASS ที่ registry** | DENY mutation |

ข้อจำกัดที่ตั้งใจคงไว้แม้ Full Bypass ON:

- relative traversal เช่น `..\..\target` ยังเป็น input ไม่ถูกต้อง; ใช้ explicit absolute path
- root deletion/non-empty broad deletion และ invalid/ambiguous targets ยังถูก validation ปฏิเสธได้
- handle ownership ของ process/task/session/worktree ยังคงป้องกันการควบคุม object ผิดตัว
- Windows ACL/UAC, antivirus, file lock, provider availability และ remote service policy ยังทำงานตามจริง
- งานนอก registered workspace อาจไม่มี checkpoint/Recovery Trash; ห้ามแสดงว่ากู้คืนได้ถ้าไม่ได้สร้าง recovery artifact จริง

## Full Bypass contract

### Activation

Full Bypass มีผลเมื่อเงื่อนไขทั้งสองเป็นจริงพร้อมกัน:

1. profile ของ transport = `full`
2. flag ของ transport = ON

ค่าที่เก็บแยกกัน:

- `desktop_full_bypass_all`: Desktop HTTP และ Secure Tunnel
- `stdio_full_bypass_all`: direct local STDIO

การเลือก Full, migration, invalid setting หรือการเปิด Full Bypass ของอีก transport จะไม่เปิด flag นี้แทนกัน

### Trusted authorization path

```text
Desktop/STDIO saved policy
  → authorizationModeProvider()
  → ToolRegistry verifies profile=full + flag=ON
  → InvocationAuthorization {
       mode: full_bypass,
       applicationApproved: true,
       bypassApplicationAuthorization: true,
       source: full_bypass
     }
  → tool handler
  → inner service/backend/runtime
  → audit: FULL BYPASS ON / authorizationMode=full_bypass
```

ชั้นที่ได้รับ propagation และตรวจแล้ว ได้แก่ File/Git/Process/Codex, shell/WSL, native/browser/web/scheduler, document/Office, Sandbox, upgrade/self-heal, worktree, child MCP และ goal-managed mutation path

### สิ่งที่ถูกข้าม

- profile decision และ always-confirm registry
- chat confirmation / `userConfirmed` requirement
- native host exact-action approval
- command prohibited/destructive policy ของ lnwjud
- Active Project, registered/allowed/Strict Roots และ protected-path authorization
- explicit outside cwd/path authorization
- scheduled-continuation `goalLease` enforcement ที่ ToolRegistry

### สิ่งที่ไม่ได้ปลอม/ไม่ได้ปิด

- caller input ไม่ถูกแก้เป็น `userConfirmed: true`
- validation, parser และ relative-path safety ไม่ถูกเปลี่ยนเป็น success ปลอม
- OS/UAC/ACL, provider และ service authorization ไม่ถูก bypass
- ownership/identity ของ runtime object ไม่ถูกละเว้น
- audit ยังคงระบุว่า call มาจาก Full Bypass

## UI review

- การ์ด **Full Access (Unrestricted)** แยกจาก **Custom Permission Profile**
- ภายในการ์ด Full Access มี profile switch และ toggle แยก:
  - Desktop Full Bypass
  - STDIO Full Bypass
- toggle default OFF และ disabled/ไม่มีผลหาก transport ไม่ได้เลือก Full
- ก่อนเปิดมี explicit acknowledgement
- Header แสดง badge แยก `DESKTOP FULL BYPASS ON` และ `STDIO FULL BYPASS ON`
- copy ไทย/อังกฤษบอกตรงกันว่า “ไม่ถาม approval/scope ของ lnwjud” และบอกข้อจำกัด OS/service
- copy ระบุชัดว่า Unrestricted รองรับ absolute path ที่ระบุ แต่ไม่สแกนหรือลงทะเบียน drive letter อัตโนมัติ

## `AGENTS.md` และ scheduled continuation

ไม่จำเป็นต้องลบ `AGENTS.md`. ข้อกำหนด rolling scheduled continuation ยังมีประโยชน์เมื่อ Full Bypass ปิด และได้เพิ่มข้อยกเว้นชัดเจนแล้ว:

- Full Bypass ON: registry ไม่บังคับ missing/stale `goalLease`
- workflow ที่ตั้งเวลาเองยังควร claim/แนบ lease เพื่อ coordination และป้องกัน worker ชนกัน

จึงไม่เหลือความขัดแย้งกับ runtime contract และไม่ต้องทำลายกติกา repository ทั้งไฟล์

## Test evidence ณ รอบ review

Focused regression และ final verification ที่ผ่านแล้ว:

- inner process/document/Sandbox/upgrade authorization: **44/44**
- ToolRegistry/process/session/readiness/recovery: **60/60**
- document/worktree outside-path behavior: **24/24**
- first-run/Doctor/Projects/onboarding/Settings UI: **27/27**
- drive/UNC sync + direct registration: **5/5**
- storage migration suite: **43/43**
- Desktop startup/persistence + Security copy: **14/14**
- direct STDIO/CLI suite: **24/24**
- MCP workspace schema/registry focused suite: **223/223**
- lint และ TypeScript project typecheck: **ผ่าน**
- full monorepo: **1,523/1,523 tests**
- acceptance: **28/28**
- integration: **2/2**
- production build และ generated tool-catalog sync: **ผ่าน** (`229` configurable / `223` default)

หลักฐาน packaging/release/E2E เดิมบน baseline Full Bypass ก่อน drive fix (`266677e…`) คือ packaging **12/12**, release suite **54/54**, Electron E2E **5/5**, packaged real MCP client **1/1**, Windows NSIS + Portable 4.28.0 และ visual review **ผ่าน** แต่ยังไม่ได้นับเป็น fresh evidence ของ commit drive fix รอบนี้

สิ่งที่ test ยืนยันโดยตรง:

- Full Bypass ใช้ได้เฉพาะ Full profile
- Desktop/STDIO flag เป็นอิสระและ default OFF
- always-confirm และ inner runtime dispatch ได้โดยไม่ confirmation เมื่อ Full Bypass ON
- explicit absolute outside path/cwd ผ่าน; relative traversal ยัง fail
- caller input ไม่ถูก rewrite เป็น `userConfirmed: true`
- standard mode ยังคง behavior เดิม
- first-run error, Doctor identity/port, Add Project retry และ onboarding state ไม่กลับไปเป็น dead end
- configured MCP port ชนแต่ Desktop fallback ไป listener ที่ identity ถูกต้องจะรายงาน `warn` และไม่ deadlock first-run; fallback ที่ identity ไม่ตรงยัง `fail`
- Desktop unrestricted first run เริ่มด้วย workspace list ว่างและไม่สร้าง machine root
- UNC/mapped path ไม่ fallback ไป `C:\` และ unrestricted sync ไม่ enumerate drive
- migration archive generated `Local Disk C:`/`Local Disk Z:` แต่เก็บ project และ explicitly named root
- `workspace_register` รับ explicit absolute project path ได้โดยไม่มี machine-root parent

## Release residuals

ไม่ใช่ code finding ที่เปิดอยู่ แต่ยังต้องแยกจากคำว่า “พร้อมส่งลูกค้า”:

1. clean-machine NSIS install/launch บน Windows user profile ใหม่
2. Portable launch และ antivirus/signing reputation ใน environment แจกจริง
3. Secure Tunnel ต่อกับ ChatGPT workspace/account จริง
4. OS/UAC/ACL และ remote service behavior บนเครื่องเป้าหมาย
5. startup บน Windows account ที่มี mapped drive แบบ remote/disconnected (เช่น `Z:` ไป DGX Spark) ต้องไม่ probe/register drive และไม่ error

## Acceptance criteria

- [x] Full profile ไม่เปิด Full Bypass เอง
- [x] Desktop และ STDIO มี toggle แยก, default OFF
- [x] toggle อยู่ในการ์ด Full Access แยกจาก Custom
- [x] always-confirm, host approval, command/scope/path และ `goalLease` ถูก bypass เมื่อ ON
- [x] outside absolute file/document/worktree/cwd cases มี regression tests
- [x] trusted authorization ส่งถึง inner runtimes โดยไม่ปลอม caller confirmation
- [x] standard mode และ non-Full profile ไม่ได้รับ bypass
- [x] first-run bootstrap error recover ได้
- [x] Doctor ตรวจ configured MCP identity
- [x] Add Project รักษา input เมื่อ fail
- [x] STDIO launcher ใช้ saved profile/roots/bypass state
- [x] docs/Thai copy/architecture contract อธิบาย behavior เดียวกัน
- [x] startup ทุก transport ไม่ enumerate/register `A:`–`Z:`
- [x] mapped/UNC path ไม่ถูกตีความเป็น local drive root
- [x] legacy generated drive roots ถูก archive แบบ reversible โดยรักษา project/manual root
- [x] direct project registration ไม่ต้องพึ่ง auto machine root
- [x] final lint/typecheck/full test/acceptance/integration/build/tool-catalog gates ผ่านบน working tree ชุดสุดท้าย
- [ ] packaging/release/E2E gates รันใหม่บน commit drive fix ก่อนประกาศ customer-ready
- [ ] clean-machine และ real-account smoke ผ่านก่อนประกาศ customer-ready

## สรุป

การแก้ของ AI ใน working tree **ถูกทิศและครบตาม product decision ในระดับ implementation**; ไม่พบ flow bug เดิมที่ยังเปิดอยู่จาก F-01 ถึง F-14, ไม่พบ approval gate ภายใน lnwjud ที่ยังเรียก `userConfirmed` แบบ raw หลัง trusted Full Bypass ถูกสร้างแล้ว และ startup ไม่ใช้ drive-letter discovery เป็น source of truth อีก

repository gates ผ่านแล้ว แต่ยังไม่ควรสรุปว่า “release พร้อมส่งลูกค้า 100%” จนกว่าจะผ่าน clean-machine/Portable/real-account residuals ด้านบน ไม่ต้องย้อน design หรือเอา `AGENTS.md` ออกเพื่อให้ Full Bypass ทำงาน
