---
name: lnwjud-scheduled-continuation
description: Continue one durable lnwjud goal through rolling one-time cloud ChatGPT Scheduled Tasks while preventing overlap with per-run goal lease token/generation fencing.
---

# lnwjud Scheduled Continuation

Use this workflow only when a user wants a long durable goal to survive ChatGPT turn boundaries. It uses one native one-time cloud successor at a time. It never uses recurrence, Windows Task Scheduler, `schtasks.exe`, cron, shell timers, browser automation, or undocumented scheduling APIs.

## Initial or manually resumed run

1. Call `run_goal` with a stable workspace and goal key. Keep the returned lease token and lease generation private.
2. After `run_goal` and the first durable checkpoint for non-trivial work, create exactly one native one-time cloud successor due **25 minutes** later and record a `created` receipt with `runsOn: cloud` before long work.
3. Attach the current proof as `goalLease` to every later fenced mutation. Never put the raw token in activity text, errors, receipts, prompts, docs, or logs.
4. Work continuously. T+15 by itself is not a handoff signal. If the worker is healthy and unfinished at T+15, the existing T+25 successor stays unchanged.
5. If an enumerated handoff-risk signal appears while the current lease is valid, call `expedite_scheduled_continuation` once. Update the **same native task** to `now+2 minutes`, preserve one-time/cloud/current-chat settings, and record the reschedule receipt.
6. If the goal finishes before any due time, call `finish_goal` first, delete the exact pending native task requested by `scheduledTaskCancellation`, record cancellation with the native host deletion receipt, read the continuation back, and create no successor.

## Scheduled wake

1. Call `claim_scheduled_continuation` first. Do no workspace mutation before claim.
2. `terminal_noop`: stop because the durable goal is terminal. Create no successor.
3. `already_claimed`: another run already consumed this continuation. Do not mutate.
4. `not_due`: do not create a replacement task and do not mutate merely because the wake was early.
5. `receipt_required`: do no workspace work. Native task creation was never durably confirmed, so reconcile the exact host outcome first: record `created` with the real cloud native task ID if it exists, otherwise record `create_failed` / `create_uncertain` truthfully. Never invent a replacement task merely to escape this state.
6. `reschedule_required`: do no workspace work. Update `taskUpdateRequest.nativeTaskId`, the **same native task**, to `taskUpdateRequest.dueAt` (**+2 minutes** from the collision), preserve one-time/cloud/current-chat settings, record the reschedule receipt, then end this wake. If the same task wakes into another collision, repeat **without a retry limit**.
7. `acquired`, including `acquisition=orphan_recovered`: use the new lease token/generation as `goalLease`, create the next cloud successor due T+25 before long work, record its cloud receipt, then continue the durable goal.

## Collision and orphan rules

- Collision never calls `finish_goal`, never marks the goal or plan blocked, never creates a replacement continuation/task, and never changes `nativeTaskId`.
- Do not treat elapsed time, unfinished work, MCP session equality, or stale historical `busy_blocked` text as proof that a worker exists.
- Worker liveness comes from trusted runtime evidence: durable fenced-call rows plus managed task/process state.
- If liveness is active, move the same task +2 and let the predecessor continue under its valid fence.
- If liveness is unknown, **do not force-unlock**. Move the same task +2.
- If a lease is unexpired but trusted evidence shows no worker, the first observation only starts an orphan probe and moves the same task +2. A takeover is allowed only after a second unchanged trustworthy probe at least 120 seconds later, with the same goal revision, lease generation, lease activity sequence, no live fenced call, and all active task IDs terminal/absent. Recovery uses CAS and increments lease generation.
- A new lease generation invalidates every older token even when ChatGPT reuses the same MCP session.
- There is no maximum collision count or arbitrary elapsed-time cutoff.

## Receipt truth

- `created` requires the native task ID and `runsOn: cloud`.
- `rescheduled` must match the stored native task ID and exact pending due time.
- `reschedule_failed` / `reschedule_uncertain` preserve the same task identity and active goal for reconciliation.
- `cancelled` requires a native ChatGPT host deletion receipt with the exact stored native task ID and a `deleted` or `not_found` state. A model statement, local goal terminal state, app shutdown, or deletion request is not proof.
- After recording cancellation, call `get_scheduled_continuation` and require `status: cancelled`. Never report cancellation as successful while native deletion is failed, uncertain, unverified, or still `cancel_required`.
- Local/auto/unverified execution does not satisfy this workflow. Keep the goal active and report an infrastructure blocker rather than claiming cloud success.

## Mutation fence

Every rolling-mode file/Git/process/capability mutation uses:

```text
goalLease.goalId
goalLease.leaseToken
goalLease.leaseGeneration
```

The registry validates the proof before handler dispatch, increments durable lease activity, records the live fenced call, refreshes the short internal call lease while the handler runs, and completes it in `finally`. The envelope is stripped before the existing handler executes. The internal heartbeat is lock safety only; it is not a Scheduled Task.

### Full Bypass runtime exception

When the active Full profile has Desktop or STDIO Full Bypass enabled, the registry intentionally skips application-level `goalLease` enforcement together with other lnwjud approval/scope gates. Do not claim that a missing lease will be blocked in that mode. This skill still requires scheduled wakes to claim ownership and attach the current proof as a cooperative collision-avoidance rule; Full Bypass does not make an unclaimed scheduled wake the durable goal owner. Direct unscheduled Full Bypass calls are outside this rolling workflow and do not require `goalLease`.

## Timeline

```text
claim acquired at T+00 -> successor due T+25
goal terminal at T+12 -> cancel exact successor -> stop
T+15 healthy unfinished worker -> keep T+25 unchanged
T+15 handoff risk -> same task pulled forward to T+17
T+25 collision -> same task due T+27
T+27 unchanged trustworthy no-worker second probe -> orphan_recovered + higher lease generation
claim acquired -> old task consumed -> new successor due T+25
terminal goal -> cancel pending successor -> zero future tasks
```

Do not expose raw lease tokens, credentials, private source text, or internal session IDs in user-visible status or native task prompts.
