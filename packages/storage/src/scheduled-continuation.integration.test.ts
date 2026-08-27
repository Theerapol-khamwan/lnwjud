import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from './database.js';
import { SqliteGoalRepository } from './goal-repository.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function openDatabase(): Promise<SqliteDatabase> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-scheduled-continuation-'));
  temporaryRoots.push(root);
  const database = new SqliteDatabase(path.join(root, 'state.sqlite'));
  database.connection.prepare(`
    INSERT INTO workspaces (id, display_name, root_path, real_root_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('workspace-1', 'Fixture', root, root, '2026-08-27T00:00:00.000Z');
  database.connection.prepare(`
    INSERT INTO goals (
      id, workspace_id, goal_key, owner_client_id, objective, plan_json, status, revision,
      current_phase, next_action, blockers_json, active_task_ids_json,
      lease_owner_client_id, lease_token_hash, lease_duration_seconds, lease_heartbeat_at, lease_expires_at,
      created_at, updated_at, terminal_summary, terminal_evidence_json, terminal_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 'created', ?, '[]', '[]', NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)
  `).run(
    'goal-1',
    'workspace-1',
    'scheduled-continuation-fixture',
    'chatgpt-web-client',
    'Exercise the scheduled continuation migration.',
    JSON.stringify({ steps: [] }),
    'Continue safely.',
    '2026-08-27T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z',
  );
  return database;
}

function insertContinuation(
  database: SqliteDatabase,
  input: { id: string; generation: number; sourceRevision: number; status: string; fingerprint: string },
): void {
  database.connection.prepare(`
    INSERT INTO goal_scheduled_continuations (
      id, goal_id, source_session_id, generation, source_goal_revision, status, occurrence, destination,
      execution_preference, confirmed_runs_on, due_at, native_task_id, request_fingerprint,
      version, last_detail, created_at, updated_at, claimed_at, terminal_at
    ) VALUES (?, 'goal-1', 'session-a', ?, ?, ?, 'once', 'current_chat', 'cloud', NULL, ?, NULL, ?, 0, NULL, ?, ?, NULL, NULL)
  `).run(
    input.id,
    input.generation,
    input.sourceRevision,
    input.status,
    `2026-08-27T00:0${input.generation}:00.000Z`,
    input.fingerprint,
    '2026-08-27T00:00:00.000Z',
    '2026-08-27T00:00:00.000Z',
  );
}

async function acquireGoalLease(repository: SqliteGoalRepository, now: string, leaseTokenHash = 'lease-hash-a'): Promise<void> {
  const result = await repository.acquire({
    goalId: 'unused-new-goal-id',
    workspaceId: 'workspace-1',
    goalKey: 'scheduled-continuation-fixture',
    ownerClientId: 'chatgpt-web-client',
    ownerSessionId: 'session-a',
    leaseTokenHash,
    leaseSeconds: 3_600,
    now,
  });
  expect(result.acquired).toBe(true);
}

function prepareRequest(
  now: string,
  dueAt: string,
  expectedRevision: number,
  requestFingerprint: string,
  continuationId: string,
  leaseTokenHash = 'lease-hash-a',
  ownerSessionId = 'session-a',
): Parameters<SqliteGoalRepository['prepareScheduledContinuation']>[0] {
  return {
    continuationId,
    checkpointId: `checkpoint-${continuationId}`,
    goalId: 'goal-1',
    ownerClientId: 'chatgpt-web-client',
    ownerSessionId,
    leaseTokenHash,
    expectedRevision,
    plan: { steps: [] },
    currentPhase: 'continuation-ready',
    summary: 'Prepared one successor near the end of the current full work turn.',
    stepUpdates: [],
    nextAction: 'Continue the durable goal in the successor when it wakes.',
    blockers: [],
    evidence: [],
    activeTaskIds: [],
    dueAt,
    executionPreference: 'cloud' as const,
    requestFingerprint,
    now,
  };
}

describe('scheduled continuation migration', () => {
  it('applies migration 007 and creates the continuation table', async () => {
    const database = await openDatabase();
    try {
      const migrationIds = database.connection.prepare('SELECT id FROM schema_migrations ORDER BY id').all()
        .map((row) => (row as { id: string }).id);
      const tableNames = database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
        .map((row) => (row as { name: string }).name);

      expect(migrationIds).toContain('007_scheduled_continuations');
      expect(tableNames).toContain('goal_scheduled_continuations');
    } finally {
      database.close();
    }
  });

  it('upgrades a database that already recorded the pre-fence 007 migration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-scheduled-continuation-upgrade-'));
    temporaryRoots.push(root);
    const filename = path.join(root, 'state.sqlite');
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE goals (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE goal_scheduled_continuations (id TEXT PRIMARY KEY NOT NULL, goal_id TEXT NOT NULL);
    `);
    for (const id of ['001_initial','002_audit','003_checkpoints','004_audit_scope','005_workspace_archive','006_goal_continuation','007_scheduled_continuations']) {
      legacy.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(id);
    }
    legacy.close();

    const upgraded = new SqliteDatabase(filename);
    try {
      const migrationIds = upgraded.connection.prepare('SELECT id FROM schema_migrations ORDER BY id').all()
        .map((row) => (row as { id: string }).id);
      const goalColumns = upgraded.connection.prepare('PRAGMA table_info(goals)').all()
        .map((row) => (row as { name: string }).name);
      const continuationColumns = upgraded.connection.prepare('PRAGMA table_info(goal_scheduled_continuations)').all()
        .map((row) => (row as { name: string }).name);
      expect(migrationIds).toContain('008_scheduled_continuation_session_fence');
      expect(goalColumns).toContain('lease_owner_session_id');
      expect(continuationColumns).toContain('source_session_id');
    } finally {
      upgraded.close();
    }
  });

  it('enforces at most one live continuation per goal but allows history followed by a new generation', async () => {
    const database = await openDatabase();
    try {
      insertContinuation(database, { id: 'continuation-1', generation: 1, sourceRevision: 0, status: 'prepared', fingerprint: 'fp-1' });
      expect(() => insertContinuation(database, {
        id: 'continuation-2', generation: 2, sourceRevision: 1, status: 'scheduled', fingerprint: 'fp-2',
      })).toThrow();

      database.connection.prepare(`
        UPDATE goal_scheduled_continuations
        SET status = 'claimed', claimed_at = ?, terminal_at = ?, updated_at = ?, version = version + 1
        WHERE id = ?
      `).run(
        '2026-08-27T00:02:00.000Z',
        '2026-08-27T00:02:00.000Z',
        '2026-08-27T00:02:00.000Z',
        'continuation-1',
      );

      expect(() => insertContinuation(database, {
        id: 'continuation-2', generation: 2, sourceRevision: 1, status: 'prepared', fingerprint: 'fp-2',
      })).not.toThrow();
    } finally {
      database.close();
    }
  });
});

describe('scheduled continuation repository state machine', () => {
  it('uses a two-minute lead without turning work into two-minute slices', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      expect(await repository.getLiveScheduledContinuation('goal-1')).toBeNull();

      const preparedB = await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'fp-b',
        'continuation-b',
      ));
      expect(preparedB.alreadyPrepared).toBe(false);
      expect(preparedB.continuation.dueAt).toBe('2026-08-27T00:22:00.000Z');
      expect(preparedB.goal.leaseExpiresAt).toBe('2026-08-27T00:22:00.000Z');
      expect(preparedB.goal.revision).toBe(1);

      const continuedA = await repository.checkpoint({
        checkpointId: 'checkpoint-a-continued',
        goalId: 'goal-1',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-a',
        leaseTokenHash: 'lease-hash-a',
        expectedRevision: 1,
        plan: { steps: [] },
        currentPhase: 'still-working',
        summary: 'The current run keeps doing useful work after arming its successor.',
        stepUpdates: [],
        nextAction: 'Finish this work slice before the successor due time.',
        blockers: [],
        evidence: [],
        activeTaskIds: [],
        releaseLease: false,
        now: '2026-08-27T00:21:00.000Z',
      });
      expect(continuedA.leaseExpiresAt).toBe('2026-08-27T00:22:00.000Z');
      expect(continuedA.revision).toBe(2);

      const runB = await repository.claimScheduledContinuation({
        continuationId: 'continuation-b',
        recoveryContinuationId: 'continuation-b-recovery-unused',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        leaseSeconds: 3_600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(runB.outcome).toBe('acquired');
      expect(runB.goal.leaseTokenHash).toBe('lease-hash-b');

      const preparedC = await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:42:00.000Z',
        '2026-08-27T00:44:00.000Z',
        2,
        'fp-c',
        'continuation-c',
        'lease-hash-b',
        'session-b',
      ));
      expect(preparedC.continuation.generation).toBe(2);
      expect(preparedC.continuation.dueAt).toBe('2026-08-27T00:44:00.000Z');
      expect(preparedC.goal.leaseExpiresAt).toBe('2026-08-27T00:44:00.000Z');

      const scheduledC = await repository.recordScheduledContinuationReceipt({
        continuationId: preparedC.continuation.continuationId,
        ownerClientId: 'chatgpt-web-client',
        expectedVersion: preparedC.continuation.version,
        outcome: 'created',
        nativeTaskId: 'native-task-c',
        runsOn: 'unverified',
        now: '2026-08-27T00:42:05.000Z',
      });
      expect(scheduledC.status).toBe('scheduled');

      await repository.finish({
        checkpointId: 'finish-run-b',
        goalId: 'goal-1',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        expectedRevision: preparedC.goal.revision,
        status: 'completed',
        summary: 'Run B completed before successor C fired.',
        evidence: [],
        now: '2026-08-27T00:43:00.000Z',
      });
      const cancellation = await repository.markGoalFinishedForScheduledContinuation('goal-1', '2026-08-27T00:43:00.000Z');
      expect(cancellation.continuation).toMatchObject({ status: 'cancel_required', nativeTaskId: 'native-task-c' });
      if (cancellation.continuation === null) throw new Error('missing cancellation continuation');

      const cancelledC = await repository.recordScheduledContinuationReceipt({
        continuationId: cancellation.continuation.continuationId,
        ownerClientId: 'chatgpt-web-client',
        expectedVersion: cancellation.continuation.version,
        outcome: 'cancelled',
        nativeTaskId: 'native-task-c',
        runsOn: 'unverified',
        now: '2026-08-27T00:43:05.000Z',
      });
      expect(cancelledC.status).toBe('cancelled');
      expect(await repository.getLiveScheduledContinuation('goal-1')).toBeNull();

      const lateWake = await repository.claimScheduledContinuation({
        continuationId: preparedC.continuation.continuationId,
        recoveryContinuationId: 'continuation-c-late-recovery-unused',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-c',
        leaseTokenHash: 'lease-hash-c',
        leaseSeconds: 600,
        now: '2026-08-27T00:44:00.000Z',
      });
      expect(lateWake.outcome).toBe('terminal_noop');
    } finally {
      database.close();
    }
  });

  it('is idempotent for the same prepare fingerprint and rejects a distinct live prepare', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      const request = prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'same-fingerprint',
        'continuation-1',
      );
      const first = await repository.prepareScheduledContinuation(request);
      const retry = await repository.prepareScheduledContinuation(request);
      expect(first.alreadyPrepared).toBe(false);
      expect(retry.alreadyPrepared).toBe(true);
      expect(retry.continuation.continuationId).toBe(first.continuation.continuationId);
      expect(retry.goal.revision).toBe(1);

      await expect(repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:30.000Z',
        '2026-08-27T00:22:30.000Z',
        1,
        'different-fingerprint',
        'continuation-2',
      ))).rejects.toMatchObject({ reason: 'conflict' });
    } finally {
      database.close();
    }
  });

  it('rejects stale revisions and wrong lease tokens', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      await expect(repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        1,
        'stale',
        'continuation-stale',
      ))).rejects.toMatchObject({ reason: 'conflict' });
      await expect(repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'wrong-token',
        'continuation-wrong-token',
        'wrong-hash',
      ))).rejects.toMatchObject({ reason: 'lease_invalid' });
    } finally {
      database.close();
    }
  });

  it('lets a released predecessor or natural due-time expiry hand the lease to exactly one claimer', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'claim-fp',
        'continuation-claim',
      ));
      await repository.checkpoint({
        checkpointId: 'release-before-due',
        goalId: 'goal-1',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-a',
        leaseTokenHash: 'lease-hash-a',
        expectedRevision: 1,
        plan: { steps: [] },
        currentPhase: 'handoff',
        summary: 'Release the lease before the successor wakes.',
        stepUpdates: [],
        nextAction: 'Successor claims at due time.',
        blockers: [],
        evidence: [],
        activeTaskIds: [],
        releaseLease: true,
        now: '2026-08-27T00:21:50.000Z',
      });

      const winner = await repository.claimScheduledContinuation({
        continuationId: 'continuation-claim',
        recoveryContinuationId: 'continuation-claim-recovery-winner',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        leaseSeconds: 600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(winner.outcome).toBe('acquired');

      const loser = await repository.claimScheduledContinuation({
        continuationId: 'continuation-claim',
        recoveryContinuationId: 'continuation-claim-recovery-loser',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-c',
        leaseTokenHash: 'lease-hash-c',
        leaseSeconds: 600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(loser.outcome).toBe('already_claimed');
      expect(loser.goal.leaseTokenHash).toBe('lease-hash-b');
    } finally {
      database.close();
    }
  });

  it('creates at most one bounded replacement when the predecessor lease is unexpectedly busy', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'busy-recovery-fp',
        'continuation-busy-original',
      ));
      database.connection.prepare('UPDATE goals SET lease_expires_at = ? WHERE id = ?')
        .run('2026-08-27T00:25:00.000Z', 'goal-1');

      const recovered = await repository.claimScheduledContinuation({
        continuationId: 'continuation-busy-original',
        recoveryContinuationId: 'continuation-busy-retry',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        leaseSeconds: 600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(recovered).toMatchObject({
        outcome: 'retry_prepared',
        previousContinuationId: 'continuation-busy-original',
        retryAfterSeconds: 180,
        continuation: {
          continuationId: 'continuation-busy-retry',
          dueAt: '2026-08-27T00:25:00.000Z',
          status: 'prepared',
        },
      });
      expect((await repository.getScheduledContinuation({ continuationId: 'continuation-busy-original' }))?.status).toBe('superseded');

      const repeatedSameSession = await repository.claimScheduledContinuation({
        continuationId: 'continuation-busy-retry',
        recoveryContinuationId: 'continuation-busy-retry-2',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b-2',
        leaseSeconds: 600,
        now: '2026-08-27T00:25:00.000Z',
      });
      expect(repeatedSameSession.outcome).toBe('busy');
      expect((await repository.getScheduledContinuation({ goalId: 'goal-1', latest: true }))?.continuationId)
        .toBe('continuation-busy-retry');
    } finally {
      database.close();
    }
  });

  it('blocks lease-busy recovery when the retry would exceed five minutes', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'busy-blocked-fp',
        'continuation-busy-blocked',
      ));
      database.connection.prepare('UPDATE goals SET lease_expires_at = ? WHERE id = ?')
        .run('2026-08-27T00:28:01.000Z', 'goal-1');

      const blocked = await repository.claimScheduledContinuation({
        continuationId: 'continuation-busy-blocked',
        recoveryContinuationId: 'continuation-busy-blocked-retry',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        leaseSeconds: 600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(blocked).toMatchObject({ outcome: 'busy', retryAfterSeconds: 361 });
      expect((await repository.getLiveScheduledContinuation('goal-1'))?.continuationId).toBe('continuation-busy-blocked');
    } finally {
      database.close();
    }
  });

  it('turns a scheduled wake into terminal_noop after the goal finishes', async () => {
    const database = await openDatabase();
    const repository = new SqliteGoalRepository(database);
    try {
      await acquireGoalLease(repository, '2026-08-27T00:00:00.000Z');
      await repository.prepareScheduledContinuation(prepareRequest(
        '2026-08-27T00:20:00.000Z',
        '2026-08-27T00:22:00.000Z',
        0,
        'terminal-fp',
        'continuation-terminal',
      ));
      await repository.finish({
        checkpointId: 'finish-before-due',
        goalId: 'goal-1',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-a',
        leaseTokenHash: 'lease-hash-a',
        expectedRevision: 1,
        status: 'completed',
        summary: 'Completed before the pending successor fired.',
        evidence: [],
        now: '2026-08-27T00:21:00.000Z',
      });

      const claim = await repository.claimScheduledContinuation({
        continuationId: 'continuation-terminal',
        recoveryContinuationId: 'continuation-terminal-recovery-unused',
        ownerClientId: 'chatgpt-web-client',
        ownerSessionId: 'session-b',
        leaseTokenHash: 'lease-hash-b',
        leaseSeconds: 600,
        now: '2026-08-27T00:22:00.000Z',
      });
      expect(claim.outcome).toBe('terminal_noop');
      expect(claim.goal.status).toBe('completed');
      expect(claim.continuation.status).toBe('terminal_noop');
    } finally {
      database.close();
    }
  });
});
