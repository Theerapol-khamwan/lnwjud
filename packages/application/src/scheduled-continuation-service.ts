import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  GoalStateError,
  appError,
  err,
  ok,
  type GoalEvidence,
  type GoalPlan,
  type GoalRecord,
  type GoalStepUpdate,
  type Result,
  type ScheduledContinuationExecutionPreference,
  type ScheduledContinuationReceiptOutcome,
  type ScheduledContinuationRepository,
  type ScheduledContinuationRunsOn,
  type ScheduledContinuationSnapshot,
} from '@lnwjud/domain';
import type { FileActor } from './file-service.js';
import type { GoalSnapshot, RunGoalResult } from './goal-continuation-service.js';

export const DEFAULT_CONTINUATION_DELAY_MINUTES = 2;
export const MIN_CONTINUATION_DELAY_MINUTES = 2;
export const MAX_CONTINUATION_DELAY_MINUTES = 5;

const MAX_ID = 128;
const MAX_TEXT = 2_048;
const MAX_NATIVE_TASK_ID = 512;
const MAX_RECEIPT_DETAIL = 1_024;

export interface PrepareScheduledContinuationRequest {
  readonly goalId: string;
  readonly leaseToken: string;
  readonly expectedRevision: number;
  readonly currentPhase: string;
  readonly summary: string;
  readonly stepUpdates: readonly GoalStepUpdate[];
  readonly nextAction: string;
  readonly blockers: readonly string[];
  readonly evidence: readonly GoalEvidence[];
  readonly activeTaskIds: readonly string[];
  readonly delayMinutes?: 2 | 3 | 4 | 5;
  readonly executionPreference?: ScheduledContinuationExecutionPreference;
}

export interface ScheduledContinuationRequest {
  readonly provider: 'chatgpt_scheduled_task';
  readonly occurrence: 'once';
  readonly dueAt: string;
  readonly destination: 'current_chat';
  readonly executionPreference: ScheduledContinuationExecutionPreference;
  readonly continuationId: string;
  readonly name: string;
  readonly prompt: string;
}

export interface PrepareScheduledContinuationResult {
  readonly outcome: 'prepared' | 'already_prepared';
  readonly goal: GoalSnapshot;
  readonly continuation: ScheduledContinuationSnapshot;
  readonly scheduleRequest: ScheduledContinuationRequest;
  readonly currentRunMayContinue: true;
  readonly handoffDeadlineAt: string;
}

export interface RecordScheduledContinuationReceiptRequest {
  readonly continuationId: string;
  readonly expectedVersion: number;
  readonly outcome: ScheduledContinuationReceiptOutcome;
  readonly nativeTaskId?: string;
  readonly runsOn?: ScheduledContinuationRunsOn;
  readonly detail?: string;
}

export interface ClaimScheduledContinuationRequest {
  readonly continuationId: string;
  readonly leaseSeconds?: number;
}

export type ClaimScheduledContinuationResult =
  | {
      readonly outcome: 'acquired';
      readonly continuation: ScheduledContinuationSnapshot;
      readonly goal: Omit<RunGoalResult, 'leaseToken'>;
      readonly leaseToken: string;
    }
  | {
      readonly outcome: 'already_claimed' | 'terminal_noop';
      readonly continuation: ScheduledContinuationSnapshot;
      readonly goal: GoalSnapshot;
    }
  | {
      readonly outcome: 'retry_prepared';
      readonly continuation: ScheduledContinuationSnapshot;
      readonly previousContinuationId: string;
      readonly retryAfterSeconds: number;
      readonly scheduleRequest: ScheduledContinuationRequest;
    }
  | {
      readonly outcome: 'busy_blocked';
      readonly continuation: ScheduledContinuationSnapshot;
      readonly retryAfterSeconds: number;
    };

export type GetScheduledContinuationRequest =
  | { readonly continuationId: string }
  | { readonly goalId: string; readonly latest: true };

export interface ScheduledContinuationServiceOptions {
  readonly now?: () => Date;
}

export class ScheduledContinuationService {
  private readonly now: () => Date;

  public constructor(
    private readonly goals: ScheduledContinuationRepository & {
      getById(goalId: string): Promise<GoalRecord | null>;
    },
    options: ScheduledContinuationServiceOptions = {},
  ) {
    this.now = options.now ?? ((): Date => new Date());
  }

  public async prepareScheduledContinuation(
    actor: FileActor,
    request: PrepareScheduledContinuationRequest,
  ): Promise<Result<PrepareScheduledContinuationResult>> {
    try {
      if ('releaseLease' in (request as object)) throw new Error('releaseLease is internal and cannot be supplied by callers');
      const goalId = required(request.goalId, 'goalId', MAX_ID);
      const current = await this.requireOwnedGoal(actor, goalId);
      if (current.status !== 'active') return err(appError('CONFLICT', 'Goal is already terminal'));
      if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('expectedRevision is invalid');
      const delayMinutes = normalizeDelay(request.delayMinutes);
      const nextAction = safeText(request.nextAction, 1_024, 'nextAction');
      const currentPhase = safeText(request.currentPhase, 256, 'currentPhase');
      const summary = safeText(request.summary, MAX_TEXT, 'summary');
      const stepUpdates = normalizeStepUpdates(request.stepUpdates, current.plan);
      const plan = applyStepUpdates(current.plan, stepUpdates);
      const blockers = normalizeStrings(request.blockers, 20, 512, 'blockers');
      const evidence = normalizeEvidence(request.evidence);
      const activeTaskIds = normalizeStrings(request.activeTaskIds, 50, 256, 'activeTaskIds');
      const executionPreference = request.executionPreference ?? 'auto';
      if (executionPreference !== 'auto' && executionPreference !== 'cloud' && executionPreference !== 'local') throw new Error('executionPreference is invalid');
      const now = this.now();
      const nowIso = now.toISOString();
      const dueAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
      const requestFingerprint = createHash('sha256').update(JSON.stringify({
        goalId,
        expectedRevision: request.expectedRevision,
        currentPhase,
        summary,
        stepUpdates,
        nextAction,
        blockers,
        evidence,
        activeTaskIds,
        delayMinutes,
        executionPreference,
      })).digest('hex');
      const prepared = await this.goals.prepareScheduledContinuation({
        continuationId: randomUUID(),
        checkpointId: randomUUID(),
        goalId,
        ownerClientId: owner(actor),
        ownerSessionId: ownerSession(actor),
        leaseTokenHash: hashLeaseToken(required(request.leaseToken, 'leaseToken', 256)),
        expectedRevision: request.expectedRevision,
        plan,
        currentPhase,
        summary,
        stepUpdates,
        nextAction,
        blockers,
        evidence,
        activeTaskIds,
        dueAt,
        executionPreference,
        requestFingerprint,
        now: nowIso,
      });
      const continuation = toPublicContinuation(prepared.continuation);
      const scheduleRequest = buildScheduleRequest(continuation, prepared.goal.workspaceId);
      return ok({
        outcome: prepared.alreadyPrepared ? 'already_prepared' : 'prepared',
        goal: toGoalSnapshot(prepared.goal),
        continuation,
        scheduleRequest,
        currentRunMayContinue: true,
        handoffDeadlineAt: continuation.dueAt,
      });
    } catch (error: unknown) {
      return mapError(error);
    }
  }

  public async recordScheduledContinuationReceipt(
    actor: FileActor,
    request: RecordScheduledContinuationReceiptRequest,
  ): Promise<Result<ScheduledContinuationSnapshot>> {
    try {
      const continuationId = required(request.continuationId, 'continuationId', MAX_ID);
      if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0) throw new Error('expectedVersion is invalid');
      const nativeTaskId = request.nativeTaskId === undefined ? undefined : required(request.nativeTaskId, 'nativeTaskId', MAX_NATIVE_TASK_ID);
      const detail = request.detail === undefined ? undefined : safeText(request.detail, MAX_RECEIPT_DETAIL, 'detail', true);
      const record = await this.goals.recordScheduledContinuationReceipt({
        continuationId,
        ownerClientId: owner(actor),
        expectedVersion: request.expectedVersion,
        outcome: request.outcome,
        ...(nativeTaskId === undefined ? {} : { nativeTaskId }),
        ...(request.runsOn === undefined ? {} : { runsOn: request.runsOn }),
        ...(detail === undefined ? {} : { detail }),
        now: this.now().toISOString(),
      });
      return ok(toPublicContinuation(record));
    } catch (error: unknown) {
      return mapError(error);
    }
  }

  public async claimScheduledContinuation(
    actor: FileActor,
    request: ClaimScheduledContinuationRequest,
  ): Promise<Result<ClaimScheduledContinuationResult>> {
    try {
      const continuationId = required(request.continuationId, 'continuationId', MAX_ID);
      const leaseSeconds = request.leaseSeconds ?? 600;
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) throw new Error('leaseSeconds is out of range');
      const leaseToken = randomBytes(32).toString('base64url');
      const claimed = await this.goals.claimScheduledContinuation({
        continuationId,
        recoveryContinuationId: randomUUID(),
        ownerClientId: owner(actor),
        ownerSessionId: ownerSession(actor),
        leaseTokenHash: hashLeaseToken(leaseToken),
        leaseSeconds,
        now: this.now().toISOString(),
      });
      const continuation = toPublicContinuation(claimed.continuation);
      if (claimed.outcome === 'acquired') {
        const goal = toGoalSnapshot(claimed.goal);
        return ok({
          outcome: 'acquired',
          continuation,
          goal: { ...toRunSnapshot(goal), acquired: true },
          leaseToken,
        });
      }
      if (claimed.outcome === 'already_claimed' || claimed.outcome === 'terminal_noop') {
        return ok({ outcome: claimed.outcome, continuation, goal: toGoalSnapshot(claimed.goal) });
      }
      if (claimed.outcome === 'retry_prepared') {
        return ok({
          outcome: 'retry_prepared',
          continuation,
          previousContinuationId: claimed.previousContinuationId,
          retryAfterSeconds: claimed.retryAfterSeconds,
          scheduleRequest: buildScheduleRequest(continuation, claimed.goal.workspaceId),
        });
      }
      return ok({
        outcome: 'busy_blocked',
        continuation,
        retryAfterSeconds: claimed.retryAfterSeconds ?? 1,
      });
    } catch (error: unknown) {
      return mapError(error);
    }
  }

  public async getScheduledContinuation(
    actor: FileActor,
    request: GetScheduledContinuationRequest,
  ): Promise<Result<ScheduledContinuationSnapshot>> {
    try {
      const record = await this.goals.getScheduledContinuation(
        'continuationId' in request
          ? { continuationId: required(request.continuationId, 'continuationId', MAX_ID) }
          : { goalId: required(request.goalId, 'goalId', MAX_ID), latest: true },
      );
      if (record === null) return err(appError('INVALID_INPUT', 'Scheduled continuation was not found'));
      const goal = await this.requireOwnedGoal(actor, record.goalId);
      if (goal.id !== record.goalId) return err(appError('PERMISSION_DENIED', 'Goal belongs to another client'));
      return ok(toPublicContinuation(record));
    } catch (error: unknown) {
      return mapError(error);
    }
  }

  /**
   * Runtime safety gate for workspace mutations while a rolling scheduled goal is active.
   * Once a goal has entered scheduled-continuation mode, only the unexpired lease-owning
   * MCP session may mutate that workspace. Reads remain outside this gate.
   */
  public async authorizeWorkspaceMutation(
    actor: FileActor,
    workspaceId: string,
  ): Promise<Result<{ readonly allowed: true; readonly goalId?: string }>> {
    try {
      const boundedWorkspaceId = required(workspaceId, 'workspaceId', MAX_ID);
      const fence = await this.goals.getWorkspaceMutationFence(boundedWorkspaceId);
      if (fence === null) return ok({ allowed: true });
      const goal = fence.goal;
      if (goal.ownerClientId !== owner(actor)) {
        return err(appError('CONFLICT', 'Workspace is reserved by another rolling scheduled goal owner', true));
      }
      const nowMs = this.now().getTime();
      const expiresMs = goal.leaseExpiresAt === undefined ? Number.NaN : Date.parse(goal.leaseExpiresAt);
      if (
        goal.leaseOwnerClientId !== owner(actor)
        || goal.leaseOwnerSessionId !== ownerSession(actor)
        || !Number.isFinite(expiresMs)
        || expiresMs <= nowMs
      ) {
        return err(appError(
          'CONFLICT',
          'Workspace mutation is blocked by the scheduled-continuation fence. The current run must own an unexpired claimed goal lease before mutating files, Git, or processes.',
          true,
        ));
      }
      return ok({ allowed: true, goalId: goal.id });
    } catch (error: unknown) {
      return mapError(error);
    }
  }

  private async requireOwnedGoal(actor: FileActor, goalId: string): Promise<GoalRecord> {
    const goal = await this.goals.getById(goalId);
    if (goal === null) throw new GoalStateError('not_found', 'Goal was not found');
    if (goal.ownerClientId !== owner(actor)) throw new GoalStateError('owner_mismatch', 'Goal belongs to another client');
    return goal;
  }
}

function buildScheduleRequest(continuation: ScheduledContinuationSnapshot, workspaceId: string): ScheduledContinuationRequest {
  const prompt = `Call claim_scheduled_continuation for continuation ${continuation.continuationId}, goal ${continuation.goalId}, workspace ${workspaceId}. If acquired, continue the durable goal until complete. Work continuously; two minutes was only the predecessor lead time. Near your own yield, prepare exactly one successor. If terminal, stop and do not schedule again. Never use Windows Task Scheduler.`;
  return {
    provider: 'chatgpt_scheduled_task',
    occurrence: 'once',
    dueAt: continuation.dueAt,
    destination: 'current_chat',
    executionPreference: continuation.executionPreference,
    continuationId: continuation.continuationId,
    name: `Continue lnwjud goal ${continuation.goalId}`.slice(0, 120),
    prompt,
  };
}

function toPublicContinuation(record: ScheduledContinuationSnapshot): ScheduledContinuationSnapshot {
  return {
    continuationId: record.continuationId,
    goalId: record.goalId,
    generation: record.generation,
    sourceGoalRevision: record.sourceGoalRevision,
    status: record.status,
    occurrence: 'once',
    destination: 'current_chat',
    executionPreference: record.executionPreference,
    ...(record.confirmedRunsOn === undefined ? {} : { confirmedRunsOn: record.confirmedRunsOn }),
    dueAt: record.dueAt,
    ...(record.nativeTaskId === undefined ? {} : { nativeTaskId: record.nativeTaskId }),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toGoalSnapshot(goal: GoalRecord): GoalSnapshot {
  return {
    goalId: goal.id,
    goalKey: goal.goalKey,
    workspaceId: goal.workspaceId,
    objective: goal.objective,
    status: goal.status,
    revision: goal.revision,
    currentPhase: goal.currentPhase,
    plan: goal.plan,
    completedSteps: goal.plan.steps.filter((step) => step.status === 'completed'),
    pendingSteps: goal.plan.steps.filter((step) => step.status !== 'completed'),
    nextAction: goal.nextAction,
    blockers: goal.blockers,
    activeTaskIds: goal.activeTaskIds,
    lastCheckpoint: goal.checkpoints.at(-1) ?? null,
    ...(goal.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: goal.leaseExpiresAt }),
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    ...(goal.terminalSummary === undefined ? {} : { terminalSummary: goal.terminalSummary }),
    ...(goal.terminalEvidence === undefined ? {} : { terminalEvidence: goal.terminalEvidence }),
    ...(goal.terminalAt === undefined ? {} : { terminalAt: goal.terminalAt }),
  };
}

function toRunSnapshot(goal: GoalSnapshot): Omit<RunGoalResult, 'leaseToken' | 'acquired'> {
  return {
    goalId: goal.goalId,
    goalKey: goal.goalKey,
    status: goal.status,
    revision: goal.revision,
    currentPhase: goal.currentPhase,
    plan: goal.plan,
    completedSteps: goal.completedSteps,
    pendingSteps: goal.pendingSteps,
    nextAction: goal.nextAction,
    blockers: goal.blockers,
    activeTaskIds: goal.activeTaskIds,
    lastCheckpoint: goal.lastCheckpoint,
    ...(goal.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: goal.leaseExpiresAt }),
  };
}

function normalizeDelay(value: number | undefined): 2 | 3 | 4 | 5 {
  const delay = value ?? DEFAULT_CONTINUATION_DELAY_MINUTES;
  if (!Number.isInteger(delay) || delay < MIN_CONTINUATION_DELAY_MINUTES || delay > MAX_CONTINUATION_DELAY_MINUTES) throw new Error('delayMinutes must be between 2 and 5');
  return delay as 2 | 3 | 4 | 5;
}

function normalizeStepUpdates(updates: readonly GoalStepUpdate[], plan: GoalPlan): readonly GoalStepUpdate[] {
  if (!Array.isArray(updates) || updates.length > 100) throw new Error('stepUpdates are invalid');
  const known = new Set(plan.steps.map((step) => step.id));
  const seen = new Set<string>();
  return updates.map((update) => {
    const stepId = required(update.stepId, 'stepId', 128);
    if (!known.has(stepId) || seen.has(stepId)) throw new Error('stepUpdates are invalid');
    seen.add(stepId);
    if (!['pending', 'in_progress', 'completed', 'blocked'].includes(update.status)) throw new Error('stepUpdates are invalid');
    return { stepId, status: update.status, ...(update.summary === undefined ? {} : { summary: safeText(update.summary, 1_024, 'step summary', true) }) };
  });
}

function applyStepUpdates(plan: GoalPlan, updates: readonly GoalStepUpdate[]): GoalPlan {
  const byId = new Map(updates.map((update) => [update.stepId, update]));
  return {
    steps: plan.steps.map((step) => {
      const update = byId.get(step.id);
      return update === undefined ? step : { ...step, status: update.status, ...(update.summary === undefined ? {} : { summary: update.summary }) };
    }),
  };
}

function normalizeEvidence(values: readonly GoalEvidence[]): readonly GoalEvidence[] {
  if (!Array.isArray(values) || values.length > 20) throw new Error('evidence is invalid');
  return values.map((value) => {
    if (!['path', 'hash', 'task', 'note'].includes(value.kind)) throw new Error('evidence is invalid');
    return { kind: value.kind, value: safeText(value.value, 1_024, 'evidence') };
  });
}

function normalizeStrings(values: readonly string[], maxItems: number, maxLength: number, label: string): readonly string[] {
  if (!Array.isArray(values) || values.length > maxItems) throw new Error(`${label} are invalid`);
  return [...new Set(values.map((value) => safeText(value, maxLength, label)))];
}

function owner(actor: FileActor): string { return required(actor.clientId, 'client identity', 128); }
function ownerSession(actor: FileActor): string { return required(actor.sessionId?.trim() || actor.clientId, 'session identity', 128); }
function required(value: string, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) throw new Error(`${label} is invalid`);
  return trimmed;
}
function safeText(value: string, maxLength: number, label: string, allowEmpty = false): string {
  const trimmed = requiredText(value, label).trim();
  if (!allowEmpty && trimmed.length === 0) throw new Error(`${label} is required`);
  if (trimmed.length > maxLength) throw new Error(`${label} exceeds the allowed length`);
  return redact(trimmed);
}
function requiredText(value: string, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  return value;
}
function redact(value: string): string {
  return value
    .replace(/(\bauthorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(token|secret|password|api[_-]?key|private[_-]?key|credential)\s*[:=]\s*[^\s]+/gi, '$1=[REDACTED]');
}
function hashLeaseToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

function mapError(error: unknown): Result<never> {
  if (error instanceof GoalStateError) {
    switch (error.reason) {
      case 'owner_mismatch': return err(appError('PERMISSION_DENIED', 'Goal belongs to another client'));
      case 'lease_invalid': return err(appError('PERMISSION_DENIED', 'Goal lease is invalid or expired', true));
      case 'conflict': return err(appError('CONFLICT', error.message, true));
      case 'terminal': return err(appError('CONFLICT', 'Goal is already terminal'));
      case 'not_found': return err(appError('INVALID_INPUT', 'Goal or continuation was not found'));
      case 'corrupt': return err(appError('INTERNAL_ERROR', 'Durable scheduled continuation state is corrupt and was rejected'));
    }
  }
  if (error instanceof Error) return err(appError('INVALID_INPUT', error.message));
  return err(appError('INTERNAL_ERROR', 'Scheduled continuation operation failed'));
}
