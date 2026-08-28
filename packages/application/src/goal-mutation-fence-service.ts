import { createHash } from 'node:crypto';
import {
  GoalStateError,
  appError,
  err,
  ok,
  type GoalLeaseProof,
  type Result,
  type ScheduledContinuationRepository,
  type ScheduledContinuationWorkerLiveness,
  type ScheduledContinuationWorkerLivenessPort,
} from '@lnwjud/domain';
import type { FileActor } from './file-service.js';

export type ManagedGoalTaskState = 'running' | 'terminal' | 'absent' | 'unknown';

export interface GoalManagedTaskStateReader {
  read(workspaceId: string, taskId: string): Promise<ManagedGoalTaskState>;
}

export interface GoalMutationFenceServiceOptions {
  readonly now?: () => Date;
  readonly callLeaseSeconds?: number;
  readonly taskStateReader?: GoalManagedTaskStateReader;
}

export interface GoalMutationFenceAdmission {
  readonly goalId: string;
  readonly leaseGeneration: number;
}

export interface WorkspaceGoalFenceSnapshot {
  readonly goalId: string;
  readonly leaseGeneration: number;
}

export class GoalMutationFenceService implements ScheduledContinuationWorkerLivenessPort {
  private readonly now: () => Date;
  private readonly callLeaseSeconds: number;
  private readonly taskStateReader: GoalManagedTaskStateReader | undefined;

  public constructor(
    private readonly repository: ScheduledContinuationRepository,
    options: GoalMutationFenceServiceOptions = {},
  ) {
    this.now = options.now ?? ((): Date => new Date());
    this.callLeaseSeconds = normalizeCallLeaseSeconds(options.callLeaseSeconds);
    this.taskStateReader = options.taskStateReader;
  }

  public async inspectWorkspaceFence(
    actor: FileActor,
    workspaceId: string,
  ): Promise<Result<WorkspaceGoalFenceSnapshot | null>> {
    try {
      const fence = await this.repository.getWorkspaceMutationFence(workspaceId);
      if (fence === null) return ok(null);
      if (fence.goal.ownerClientId !== actor.clientId) {
        return err(appError('CONFLICT', 'Workspace is reserved by another rolling scheduled goal owner', true));
      }
      return ok({ goalId: fence.goal.id, leaseGeneration: fence.goal.leaseGeneration });
    } catch (error: unknown) {
      return mapFenceError(error);
    }
  }

  public async begin(
    actor: FileActor,
    workspaceId: string,
    callId: string,
    proof: GoalLeaseProof,
  ): Promise<Result<GoalMutationFenceAdmission>> {
    try {
      const now = this.now();
      const startedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + this.callLeaseSeconds * 1000).toISOString();
      const admitted = await this.repository.beginGoalFencedMutation({
        callId,
        goalId: proof.goalId,
        workspaceId,
        ownerClientId: actor.clientId,
        leaseTokenHash: hashLeaseToken(proof.leaseToken),
        leaseGeneration: proof.leaseGeneration,
        startedAt,
        expiresAt,
      });
      return ok(admitted);
    } catch (error: unknown) {
      return mapFenceError(error);
    }
  }

  public async heartbeat(callId: string, leaseGeneration: number): Promise<void> {
    const now = this.now();
    const heartbeatAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.callLeaseSeconds * 1000).toISOString();
    await this.repository.heartbeatGoalFencedMutation(callId, leaseGeneration, heartbeatAt, expiresAt);
  }

  public async end(callId: string): Promise<void> {
    await this.repository.endGoalFencedMutation(callId, this.now().toISOString());
  }

  public async observe(goalId: string, activeTaskIds: readonly string[]): Promise<ScheduledContinuationWorkerLiveness> {
    const observedAt = this.now().toISOString();
    const durable = await this.repository.observeGoalFencedMutations(goalId, observedAt);
    const activeTaskStates = await Promise.all(activeTaskIds.map(async (taskId) => ({
      taskId,
      state: await this.readTaskState(durable.workspaceId, taskId),
    })));
    return {
      trustworthy: activeTaskStates.every((entry) => entry.state !== 'unknown'),
      observedAt,
      leaseGeneration: durable.leaseGeneration,
      leaseActivitySeq: durable.leaseActivitySeq,
      liveFencedCallCount: durable.liveFencedCallCount,
      activeTaskStates,
    };
  }

  private async readTaskState(workspaceId: string, taskId: string): Promise<ManagedGoalTaskState> {
    if (this.taskStateReader === undefined) return 'unknown';
    try {
      return await this.taskStateReader.read(workspaceId, taskId);
    } catch {
      return 'unknown';
    }
  }
}

function normalizeCallLeaseSeconds(value: number | undefined): number {
  const seconds = value ?? 30;
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) throw new Error('callLeaseSeconds must be between 5 and 300');
  return seconds;
}

function hashLeaseToken(token: string): string {
  if (typeof token !== 'string' || token.trim().length === 0 || token.length > 256) throw new Error('Goal lease token is invalid');
  return createHash('sha256').update(token).digest('hex');
}

function mapFenceError(error: unknown): Result<never> {
  if (error instanceof GoalStateError) {
    switch (error.reason) {
      case 'owner_mismatch': return err(appError('PERMISSION_DENIED', 'Goal belongs to another client'));
      case 'lease_invalid': return err(appError('CONFLICT', 'Goal lease token/generation is stale, expired, or past its handoff deadline', true));
      case 'conflict': return err(appError('CONFLICT', error.message, true));
      case 'terminal': return err(appError('CONFLICT', 'Goal is already terminal'));
      case 'not_found': return err(appError('INVALID_INPUT', 'Goal was not found'));
      case 'corrupt': return err(appError('INTERNAL_ERROR', 'Durable goal fence state is corrupt'));
    }
  }
  if (error instanceof Error) return err(appError('INVALID_INPUT', error.message));
  return err(appError('INTERNAL_ERROR', 'Goal mutation fence failed'));
}
