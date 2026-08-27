---
name: lnwjud-scheduled-continuation
description: Continue a long lnwjud goal through rolling one-time ChatGPT Scheduled Tasks. Use when each AI run should work continuously, pre-schedule one successor near its own yield, and stop/cancel the chain only when the durable goal finishes.
---

# lnwjud Scheduled Continuation

Use this workflow only for long-running work that may need another ChatGPT/Codex turn. The two-minute value is successor preparation lead time, never a two-minute work slice.

## Hard boundaries

- Work continuously in the current run until the requested outcome is complete or the host turn is genuinely near its boundary.
- Never stop merely because two minutes elapsed.
- Create at most one future one-time successor for a durable goal.
- Use native ChatGPT Scheduled Tasks only for the future wake. Never use Windows Task Scheduler, `schtasks.exe`, cron, shell timers, recurring two-minute schedules, or undocumented OpenAI Scheduled Tasks APIs.
- Native task creation/deletion is host-owned. lnwjud only stores durable reservation, receipt, claim, and cancellation state.
- Before any scheduled successor mutates local files, Git, processes, or other fenced workspace state, it must successfully call `claim_scheduled_continuation`.
- A predecessor may continue useful work after preparing/creating its successor only while its session-scoped lease remains valid. At the handoff deadline it must stop workspace mutation.
- `busy_blocked` means do not mutate and do not poll every two minutes. Report the collision/blocker or use the single bounded recovery path provided by the current host workflow.
- If a scheduled wake reuses the predecessor MCP session and ownership cannot be distinguished safely, fail closed rather than overlap mutations.

## Initial or manually resumed run

1. Call `run_goal` with a stable `workspaceId` + `goalKey`. Create the goal only if it does not exist; otherwise resume its durable state.
2. Do normal useful work continuously. Checkpoint real milestones with `checkpoint_goal`; do not turn checkpoints into an elapsed-time cadence.
3. Do not schedule a successor at run start.
4. When the current host turn is genuinely near its own handoff window and meaningful work remains, call `prepare_scheduled_continuation` exactly once. Default `delayMinutes` is 2; 2–5 minutes is allowed only as preparation lead.
5. Use the returned `scheduleRequest` to create exactly one native one-time ChatGPT Scheduled Task in the current chat. Requested `executionPreference` is not proof of actual execution mode.
6. Immediately record the native creation result using `record_scheduled_continuation_receipt`. Store the confirmed native task ID when available and record `runsOn` as `cloud`, `local`, or `unverified` only from actual host evidence.
7. Keep working in the current run after the successor is armed. The predecessor lease is capped at the successor `dueAt`, so do not attempt workspace mutation after that deadline.
8. If the goal finishes before the successor fires, call `finish_goal`, follow its exact `scheduledTaskCancellation` instruction, delete the confirmed native task through the ChatGPT host if requested, and record the cancellation receipt. Do not schedule another task.

## Scheduled wake

1. Read the continuation ID from the native Scheduled Task prompt and call `claim_scheduled_continuation` first. Do not call `run_goal` separately.
2. `terminal_noop`: the goal already finished. Report terminal state and stop. Do not create another schedule.
3. `already_claimed`: another run already consumed this continuation. Stop without mutation or scheduling.
4. `busy_blocked`: ownership is not safely transferable yet or the wake collided with the predecessor. Do not mutate files/Git/processes and do not create a periodic retry loop.
5. `acquired`: this run owns the session-scoped goal lease. Resume from the durable checkpoint and work continuously as a normal full run.
6. Do not prepare the next successor at wake time. Prepare exactly one successor only when this run later approaches its own host handoff window and work still remains.
7. Repeat the same prepare -> native create -> receipt -> keep working process until the durable goal is terminal.

## Completion and cancellation

After `finish_goal`:

- If `scheduledTaskCancellation.action` is `delete_native_task`, delete only the exact confirmed native task ID through the ChatGPT host, then record `cancelled`, `cancel_failed`, or `cancel_uncertain` using `record_scheduled_continuation_receipt`.
- If deletion fails or is uncertain, the durable goal remains terminal. A later wake must become `terminal_noop` and must not restart the chain.
- If there is no live confirmed native task, do not invent one and do not claim cancellation succeeded.
- Never create a successor after `completed`, `failed`, or `blocked` terminal state.

## Execution-mode truth

- `executionPreference: cloud|local|auto` is a request, not confirmation.
- Use `confirmedRunsOn` / receipt `runsOn` only when the native host actually reports the mode.
- If the host cannot verify the mode, record `unverified`.
- Cloud/web execution can use connected plugin/MCP tools but does not itself hold a local folder; local file access depends on the connected lnwjud runtime/tunnel.
- Local execution requires the machine/app/project prerequisites to be available.
- If native one-time scheduling is unavailable, report the workflow blocked. Do not fall back to a Windows scheduler.

## Overlap safety invariant

For a workspace that has entered rolling scheduled-continuation mode:

```text
Run A owns lease/session A -> prepare B(+2m) -> A may keep working before dueAt
at dueAt: session A lease expires -> A mutation is blocked
Run B wakes -> claim from distinct session B -> B becomes mutation owner
session A remains blocked -> no overlapping workspace mutation
```

Unrelated workspaces remain independently concurrent. The fence is not a global application lock.

## Report contract

Use a compact final/status report with these fields when the workflow is user-visible:

```text
สถานะ: continuing | scheduled | completed | blocked
Goal: <goalKey>
รอบปัจจุบัน: <what was completed>
คงเหลือ: <nextAction or none>
Successor: none | one-time <dueAt> <nativeTaskId or unverified>
Runs on: cloud | local | unverified
Cancellation: none | cancelled | failed | uncertain
หลักฐาน: <bounded paths/task IDs>
```

Do not expose raw lease tokens, credentials, arbitrary private work text, or internal session IDs in the native task prompt or status report.
