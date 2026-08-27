import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileActor } from './file-service.js';
import { GoalContinuationService, type RunGoalResult } from './goal-continuation-service.js';
import { ScheduledContinuationService, type PrepareScheduledContinuationRequest } from './scheduled-continuation-service.js';
import { SqliteDatabase } from '../../storage/src/database.js';
import { SqliteGoalRepository } from '../../storage/src/goal-repository.js';
import { SqliteWorkspaceRepository } from '../../storage/src/workspace-repository.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const actor: FileActor = {
  clientId: 'chatgpt-web-client',
  clientName: 'ChatGPT Web',
  sessionId: 'scheduled-continuation-test',
};

interface ScheduledContinuationFixture {
  readonly database: SqliteDatabase;
  readonly repository: SqliteGoalRepository;
  readonly goals: GoalContinuationService;
  readonly scheduled: ScheduledContinuationService;
  readonly clock: { readonly now: () => Date; readonly set: (value: string) => void };
}

async function fixture(isoNow = '2026-08-27T10:00:00.000Z'): Promise<ScheduledContinuationFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-scheduled-application-'));
  temporaryRoots.push(root);
  const database = new SqliteDatabase(path.join(root, 'state.sqlite'));
  const workspaces = new SqliteWorkspaceRepository(database);
  await workspaces.insert({
    id: 'workspace-1',
    displayName: 'Fixture',
    rootPath: root,
    realRootPath: root,
    createdAt: isoNow,
  });
  const repository = new SqliteGoalRepository(database);
  let now = new Date(isoNow);
  const clock = {
    now: (): Date => now,
    set: (value: string): void => { now = new Date(value); },
  };
  const goals = new GoalContinuationService(workspaces, repository, {
    now: clock.now,
    scheduledContinuations: repository,
  });
  const scheduled = new ScheduledContinuationService(repository, { now: clock.now });
  return { database, repository, goals, scheduled, clock };
}

async function startGoal(goals: GoalContinuationService, objective = 'Finish the durable goal safely.'): Promise<RunGoalResult> {
  const result = await goals.runGoal(actor, {
    workspaceId: 'workspace-1',
    goalKey: 'scheduled-application-test',
    objective,
    plan: { steps: [{ id: 'implement', title: 'Implement the continuation path' }] },
    leaseSeconds: 3_600,
  });
  expect(result.ok).toBe(true);
  if (!result.ok || result.value.leaseToken === undefined) throw new Error('failed to start goal');
  return result.value;
}

function validPrepare(started: Awaited<ReturnType<typeof startGoal>>, overrides: Record<string, unknown> = {}): PrepareScheduledContinuationRequest {
  return {
    goalId: started.goalId,
    leaseToken: started.leaseToken!,
    expectedRevision: started.revision,
    currentPhase: 'implementation',
    summary: 'Implementation is ready for a successor.',
    stepUpdates: [],
    nextAction: 'Continue implementation from the current checkpoint.',
    blockers: [],
    evidence: [],
    activeTaskIds: [],
    delayMinutes: 2,
    executionPreference: 'cloud',
    ...overrides,
  };
}

describe('ScheduledContinuationService', () => {
  it('builds one current-chat occurrence due two minutes later and keeps the current run alive', async () => {
    const { database, goals, scheduled } = await fixture();
    try {
      const started = await startGoal(goals);
      const result = await scheduled.prepareScheduledContinuation(actor, validPrepare(started));
      expect(result).toMatchObject({
        ok: true,
        value: {
          outcome: 'prepared',
          currentRunMayContinue: true,
          handoffDeadlineAt: '2026-08-27T10:02:00.000Z',
          scheduleRequest: {
            provider: 'chatgpt_scheduled_task',
            occurrence: 'once',
            destination: 'current_chat',
            dueAt: '2026-08-27T10:02:00.000Z',
            executionPreference: 'cloud',
          },
          goal: { revision: 1, leaseExpiresAt: '2026-08-27T10:02:00.000Z' },
        },
      });
    } finally {
      database.close();
    }
  });

  it('rejects delay values outside 2..5, empty nextAction, stale revision, and caller-controlled releaseLease', async () => {
    const { database, goals, scheduled } = await fixture();
    try {
      const started = await startGoal(goals);
      for (const delayMinutes of [1, 6]) {
        const result = await scheduled.prepareScheduledContinuation(actor, validPrepare(started, { delayMinutes }));
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      }
      await expect(scheduled.prepareScheduledContinuation(actor, validPrepare(started, { nextAction: '   ' })))
        .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      await expect(scheduled.prepareScheduledContinuation(actor, validPrepare(started, { expectedRevision: 1 })))
        .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      await expect(scheduled.prepareScheduledContinuation(actor, {
        ...validPrepare(started),
        releaseLease: true,
      } as never)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    } finally {
      database.close();
    }
  });

  it('rejects prepare after the goal is terminal', async () => {
    const { database, goals, scheduled } = await fixture();
    try {
      const started = await startGoal(goals);
      const finished = await goals.finishGoal(actor, {
        goalId: started.goalId,
        leaseToken: started.leaseToken!,
        expectedRevision: started.revision,
        status: 'completed',
        summary: 'Done before scheduling.',
        evidence: [],
      });
      expect(finished.ok).toBe(true);
      await expect(scheduled.prepareScheduledContinuation(actor, validPrepare(started)))
        .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    } finally {
      database.close();
    }
  });

  it('never puts objective, nextAction, summary, evidence, lease token, or arbitrary work text in the native prompt', async () => {
    const { database, goals, scheduled } = await fixture();
    try {
      const markers = {
        objective: 'OBJECTIVE_MARKER_73491',
        summary: 'SUMMARY_MARKER_73492',
        next: 'NEXT_MARKER_73493',
        evidence: 'EVIDENCE_MARKER_73494',
      };
      const started = await startGoal(goals, markers.objective);
      const result = await scheduled.prepareScheduledContinuation(actor, validPrepare(started, {
        summary: markers.summary,
        nextAction: markers.next,
        evidence: [{ kind: 'note', value: markers.evidence }],
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('prepare failed');
      const serialized = JSON.stringify(result.value.scheduleRequest);
      for (const marker of Object.values(markers)) expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain(started.leaseToken!);
      expect(result.value.scheduleRequest.prompt).toContain('claim_scheduled_continuation');
      expect(result.value.scheduleRequest.prompt).toContain('two minutes was only the predecessor lead time');
      expect(result.value.scheduleRequest.prompt).toContain('Never use Windows Task Scheduler');
      expect(result.value.scheduleRequest.prompt).toContain(started.goalId);
      expect(result.value.scheduleRequest.prompt).toContain('workspace-1');
    } finally {
      database.close();
    }
  });

  it('prevents predecessor/successor overlap with a session-scoped workspace mutation fence', async () => {
    const { database, goals, scheduled, clock } = await fixture();
    const successorActor: FileActor = { ...actor, sessionId: 'scheduled-continuation-successor' };
    try {
      const started = await startGoal(goals);
      const prepared = await scheduled.prepareScheduledContinuation(actor, validPrepare(started));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('prepare failed');

      await expect(scheduled.authorizeWorkspaceMutation(actor, 'workspace-1'))
        .resolves.toMatchObject({ ok: true, value: { allowed: true, goalId: started.goalId } });
      await expect(scheduled.authorizeWorkspaceMutation(successorActor, 'workspace-1'))
        .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

      clock.set('2026-08-27T10:02:00.000Z');
      await expect(scheduled.authorizeWorkspaceMutation(actor, 'workspace-1'))
        .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

      const claimed = await scheduled.claimScheduledContinuation(successorActor, {
        continuationId: prepared.value.continuation.continuationId,
      });
      expect(claimed).toMatchObject({ ok: true, value: { outcome: 'acquired' } });
      await expect(scheduled.authorizeWorkspaceMutation(successorActor, 'workspace-1'))
        .resolves.toMatchObject({ ok: true, value: { allowed: true, goalId: started.goalId } });
      await expect(scheduled.authorizeWorkspaceMutation(actor, 'workspace-1'))
        .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    } finally {
      database.close();
    }
  });

  it('prepares at most one bounded one-time recovery when a wake reuses the predecessor session', async () => {
    const { database, goals, scheduled, clock } = await fixture();
    const successorActor: FileActor = { ...actor, sessionId: 'scheduled-continuation-recovery-successor' };
    try {
      const started = await startGoal(goals);
      const prepared = await scheduled.prepareScheduledContinuation(actor, validPrepare(started));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('prepare failed');

      clock.set('2026-08-27T10:02:00.000Z');
      const retry = await scheduled.claimScheduledContinuation(actor, {
        continuationId: prepared.value.continuation.continuationId,
      });
      expect(retry).toMatchObject({
        ok: true,
        value: {
          outcome: 'retry_prepared',
          previousContinuationId: prepared.value.continuation.continuationId,
          retryAfterSeconds: 300,
          scheduleRequest: {
            provider: 'chatgpt_scheduled_task',
            occurrence: 'once',
            destination: 'current_chat',
            dueAt: '2026-08-27T10:07:00.000Z',
          },
        },
      });
      if (!retry.ok || retry.value.outcome !== 'retry_prepared') throw new Error('retry was not prepared');

      clock.set('2026-08-27T10:07:00.000Z');
      await expect(scheduled.claimScheduledContinuation(actor, {
        continuationId: retry.value.continuation.continuationId,
      })).resolves.toMatchObject({ ok: true, value: { outcome: 'busy_blocked' } });

      const claimed = await scheduled.claimScheduledContinuation(successorActor, {
        continuationId: retry.value.continuation.continuationId,
      });
      expect(claimed).toMatchObject({ ok: true, value: { outcome: 'acquired' } });
    } finally {
      database.close();
    }
  });

  it('finishes first, returns exact native cancellation guidance, records cancellation, and terminal-noops a late wake', async () => {
    const { database, goals, scheduled, clock } = await fixture();
    const lateWakeActor: FileActor = { ...actor, sessionId: 'scheduled-continuation-late-wake' };
    try {
      const started = await startGoal(goals);
      const prepared = await scheduled.prepareScheduledContinuation(actor, validPrepare(started));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('prepare failed');

      clock.set('2026-08-27T10:00:05.000Z');
      const scheduledReceipt = await scheduled.recordScheduledContinuationReceipt(actor, {
        continuationId: prepared.value.continuation.continuationId,
        expectedVersion: prepared.value.continuation.version,
        outcome: 'created',
        nativeTaskId: 'native-task-c',
        runsOn: 'unverified',
      });
      expect(scheduledReceipt).toMatchObject({ ok: true, value: { status: 'scheduled', nativeTaskId: 'native-task-c' } });

      clock.set('2026-08-27T10:00:10.000Z');
      const finished = await goals.finishGoal(actor, {
        goalId: started.goalId,
        leaseToken: started.leaseToken!,
        expectedRevision: prepared.value.goal.revision,
        status: 'completed',
        summary: 'Completed while successor C was still pending.',
        evidence: [],
      });
      expect(finished).toMatchObject({
        ok: true,
        value: {
          status: 'completed',
          scheduledTaskCancellation: {
            action: 'delete_native_task',
            continuationId: prepared.value.continuation.continuationId,
            nativeTaskId: 'native-task-c',
            reason: 'live_task_confirmed',
          },
        },
      });

      const cancelRequired = await scheduled.getScheduledContinuation(actor, { goalId: started.goalId, latest: true });
      expect(cancelRequired).toMatchObject({ ok: true, value: { status: 'cancel_required', nativeTaskId: 'native-task-c' } });
      if (!cancelRequired.ok) throw new Error('cancel-required continuation missing');

      clock.set('2026-08-27T10:00:15.000Z');
      const cancelled = await scheduled.recordScheduledContinuationReceipt(actor, {
        continuationId: cancelRequired.value.continuationId,
        expectedVersion: cancelRequired.value.version,
        outcome: 'cancelled',
        nativeTaskId: 'native-task-c',
        runsOn: 'unverified',
      });
      expect(cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } });

      clock.set('2026-08-27T10:02:00.000Z');
      await expect(scheduled.claimScheduledContinuation(lateWakeActor, {
        continuationId: prepared.value.continuation.continuationId,
      })).resolves.toMatchObject({ ok: true, value: { outcome: 'terminal_noop', goal: { status: 'completed' } } });
    } finally {
      database.close();
    }
  });
});
