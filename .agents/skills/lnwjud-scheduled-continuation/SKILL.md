---
name: lnwjud-scheduled-continuation
description: Use when a user wants one durable lnwjud goal to continue autonomously across ChatGPT turns until verified terminal completion, especially during long builds, tests, or managed background tasks.
---

# lnwjud Scheduled Continuation

One user request starts one durable chain: acquire the goal, arm one cloud successor, keep doing useful work, hand off when necessary, and stop only after the goal is verifiably terminal.

## Non-negotiable outcome

- Never require the user to type “continue”, “ทำต่อ”, or ask for status to restart an unfinished goal.
- Never send a completion report while `get_goal` reports `active`.
- A request to stop scheduling cancels only the successor. It does not cancel, block, pause, or complete the durable goal. Continue in the current run and still call `finish_goal` when the work is actually done.
- `cancel_goal` and `cancel_scheduled_continuation` are independent controls: the former records the goal as cancelled, aborts in-flight fenced MCP requests, and stops every tracked process, Codex task, and shell task; the latter cancels only the waiting successor. Call both when the user wants both effects.
- Use one native one-time cloud ChatGPT Scheduled Task in the current chat. Never use recurrence, Windows Task Scheduler, `schtasks.exe`, cron, shell timers, browser automation, or undocumented scheduling APIs.
- Native task creation, update, and deletion are host-owned. lnwjud stores the reservation, receipts, claim, and cancellation truth.

## Start or resume

1. Call `run_goal` with a stable workspace and goal key. Keep the returned lease token and generation private.
2. Read the durable checkpoint and do the next useful work. Record real milestones with `checkpoint_goal`; do not checkpoint merely because time elapsed.
3. After the first checkpoint, call `prepare_scheduled_continuation` and create exactly one native one-time task from its `scheduleRequest`. Record `created` with the real native task ID and `runsOn: cloud` before relying on it.
4. Choose `successorDelayMinutes` adaptively within **2–25 minutes**:

   | Remaining work at this checkpoint | Delay |
   | --- | --- |
   | Long or open-ended work while this run is healthy | 25 minutes |
   | One bounded phase expected within about 15 minutes | 10 minutes |
   | Final build, smoke, or verification expected soon | 5 minutes |
   | This turn must end while work remains | update the same task to now +2 minutes |

   25 minutes is the maximum watchdog, not a fixed cadence. A schedule is a recovery handoff, never permission to stop working early.
5. Attach the current proof as `goalLease` to every fenced mutation. Never put the raw token in prompts, logs, receipts, docs, or user-visible text.
6. Keep working continuously. For a managed build/test/shell task, use condition-based task wait/status calls, inspect its terminal output, and do not end the turn with only “still running” when the user asked to babysit it to completion.

## Before any turn boundary

If `get_goal` is still `active` and scheduling remains authorized:

1. Checkpoint the exact next action and every active task ID.
2. Require one confirmed cloud successor. Do not create a second task when one already exists.
3. If the turn is about to yield, call `expedite_scheduled_continuation` with `turn_yield_signal`, update the **same native task** to **+2 minutes**, and record the reschedule receipt.
4. Only then may the current turn yield. A status update is not completion.

If the user disabled scheduling, call `cancel_scheduled_continuation` for the exact pending successor, delete the exact pending native task, and record its native host deletion receipt. Do not create another successor; remain in the current run, wait for bounded active work, finish verification, and close the goal.

If the user asks to cancel the goal, call `cancel_goal` with the latest expected revision. It aborts active fenced MCP requests and stops every tracked task across process, Codex, and shell backends, including durable shell workers from another MCP session. Treat `allRequestsStopped: false`, `allTasksStopped: false`, `requestCancellation.timedOut: true`, or a `termination_unverified` result as unresolved evidence and report it; do not claim that all background work stopped. If the user also asks to cancel its scheduled successor, call `cancel_scheduled_continuation` separately and complete its exact native-host deletion receipt flow.

## Scheduled wake

1. Call `claim_scheduled_continuation` first; do no workspace mutation beforehand. The runtime accepts a confirmed cloud wake up to 60 seconds early so minute-level host jitter cannot consume the only wake without a handoff.
2. Handle the returned outcome exactly:

   - `terminal_noop`: stop; create no successor.
   - `already_claimed`: another run consumed it; do not mutate.
   - `not_due`: do not mutate or create a replacement. Update the same host task to the returned/known due time when the host permits it.
   - `receipt_required`: reconcile the exact native task first; record `created`, `create_failed`, or `create_uncertain` truthfully.
   - `reschedule_required`: update `taskUpdateRequest.nativeTaskId`, the **same native task**, to its +2-minute due time, record the receipt, and end this wake. Repeat collisions **without a retry limit**.
   - `acquired`, including `orphan_recovered`: use the new lease token/generation as `goalLease`, arm the next adaptive successor before long work, then continue from the durable checkpoint without waiting for user input.

## Collision and orphan safety

- Collision never calls `finish_goal`, marks the goal blocked, creates a replacement task, or changes `nativeTaskId`.
- Live fenced calls and managed task/process states are worker-liveness evidence. MCP session equality and elapsed time are not.
- Active or unknown liveness fails closed into the same-task +2-minute update.
- Orphan takeover requires two unchanged trustworthy no-worker probes at least 120 seconds apart, the same revision/generation/activity sequence, no live fenced calls, and all tracked tasks terminal or absent. Recovery uses CAS and increments lease generation.
- Full Bypass may skip application-level `goalLease` enforcement, but this workflow still requires claim and current proof as its cooperative ownership protocol.

## Verified completion

1. Before deciding the work is done, wait for every active task ID to reach a terminal state and inspect its result. Clear stale task IDs in the final checkpoint.
2. Re-run the acceptance evidence required by the goal. A generated artifact or passing subtest alone is not terminal proof unless it satisfies the goal.
3. Call `finish_goal` with the current lease and revision even when no schedule exists or scheduling was disabled.
4. Call `get_goal` and require `completed`, `failed`, or `blocked`. If it is still `active`, continue working; do not report completion.
5. If `scheduledTaskCancellation.action` is `delete_native_task`, delete that exact task through the native ChatGPT host, record the native host deletion receipt, then require `get_scheduled_continuation.status: cancelled`.
6. Never report cancellation as successful while deletion is failed, uncertain, unverified, or still required. Never create another successor after terminal state.

## Invocation on another machine

Use `$lnwjud-scheduled-continuation` when the client exposes the bundled skill by name. Otherwise call `skills_list`, select the source-qualified `lnwjud-scheduled-continuation`, call `skills_read`, and follow it. A typical request is:

```text
Use $lnwjud-scheduled-continuation in workspace <path>. Create or resume goalKey <stable-key>, do the requested work autonomously until get_goal is terminal, then cancel the exact remaining successor and report once.
```

Do not expose raw lease tokens, credentials, private source text, or internal session IDs in native task prompts or status reports.
