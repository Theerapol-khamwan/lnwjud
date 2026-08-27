import type {
  GoalEvidence,
  GoalPlan,
  GoalRecord,
  GoalStepUpdate,
} from './goal-continuation.js';

export type ScheduledContinuationStatus =
  | 'prepared'
  | 'scheduled'
  | 'create_failed'
  | 'create_uncertain'
  | 'claimed'
  | 'terminal_noop'
  | 'superseded'
  | 'cancel_required'
  | 'cancelled'
  | 'cancel_failed'
  | 'cancel_uncertain';

export type LiveScheduledContinuationStatus =
  | 'prepared'
  | 'scheduled'
  | 'create_uncertain'
  | 'cancel_required'
  | 'cancel_failed'
  | 'cancel_uncertain';

export type ScheduledContinuationExecutionPreference = 'auto' | 'cloud' | 'local';
export type ScheduledContinuationRunsOn = 'cloud' | 'local' | 'unverified';
export type ScheduledContinuationReceiptOutcome =
  | 'created'
  | 'create_failed'
  | 'create_uncertain'
  | 'cancelled'
  | 'cancel_failed'
  | 'cancel_uncertain';

export interface ScheduledContinuationSnapshot {
  readonly continuationId: string;
  readonly goalId: string;
  readonly generation: number;
  readonly sourceGoalRevision: number;
  readonly status: ScheduledContinuationStatus;
  readonly occurrence: 'once';
  readonly destination: 'current_chat';
  readonly executionPreference: ScheduledContinuationExecutionPreference;
  readonly confirmedRunsOn?: ScheduledContinuationRunsOn;
  readonly dueAt: string;
  readonly nativeTaskId?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledContinuationRecord extends ScheduledContinuationSnapshot {
  /** Internal trusted session identity of the predecessor run; never exposed in public snapshots/prompts. */
  readonly sourceSessionId: string;
  readonly requestFingerprint: string;
  readonly lastDetail?: string;
  readonly claimedAt?: string;
  readonly terminalAt?: string;
}

export interface PrepareScheduledContinuationRecordRequest {
  readonly continuationId: string;
  readonly checkpointId: string;
  readonly goalId: string;
  readonly ownerClientId: string;
  readonly ownerSessionId: string;
  readonly leaseTokenHash: string;
  readonly expectedRevision: number;
  readonly plan: GoalPlan;
  readonly currentPhase: string;
  readonly summary: string;
  readonly stepUpdates: readonly GoalStepUpdate[];
  readonly nextAction: string;
  readonly blockers: readonly string[];
  readonly evidence: readonly GoalEvidence[];
  readonly activeTaskIds: readonly string[];
  readonly dueAt: string;
  readonly executionPreference: ScheduledContinuationExecutionPreference;
  readonly requestFingerprint: string;
  readonly now: string;
}

export interface PrepareScheduledContinuationRecordResult {
  readonly goal: GoalRecord;
  readonly continuation: ScheduledContinuationRecord;
  readonly alreadyPrepared: boolean;
}

export interface RecordScheduledContinuationReceiptRecordRequest {
  readonly continuationId: string;
  readonly ownerClientId: string;
  readonly expectedVersion: number;
  readonly outcome: ScheduledContinuationReceiptOutcome;
  readonly nativeTaskId?: string;
  readonly runsOn?: ScheduledContinuationRunsOn;
  readonly detail?: string;
  readonly now: string;
}

export interface ClaimScheduledContinuationRecordRequest {
  readonly continuationId: string;
  readonly recoveryContinuationId: string;
  readonly ownerClientId: string;
  readonly ownerSessionId: string;
  readonly leaseTokenHash: string;
  readonly leaseSeconds: number;
  readonly now: string;
}

export type ClaimScheduledContinuationRecordResult =
  | {
      readonly outcome: 'acquired';
      readonly goal: GoalRecord;
      readonly continuation: ScheduledContinuationRecord;
    }
  | {
      readonly outcome: 'already_claimed' | 'terminal_noop' | 'busy';
      readonly goal: GoalRecord;
      readonly continuation: ScheduledContinuationRecord;
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly outcome: 'retry_prepared';
      readonly goal: GoalRecord;
      readonly continuation: ScheduledContinuationRecord;
      readonly previousContinuationId: string;
      readonly retryAfterSeconds: number;
    };

export type GetScheduledContinuationRecordRequest =
  | { readonly continuationId: string }
  | { readonly goalId: string; readonly latest: true };

export interface GoalScheduledContinuationFinishResult {
  readonly continuation: ScheduledContinuationRecord | null;
}

export interface ScheduledContinuationMutationFence {
  readonly goal: GoalRecord;
  readonly continuation: ScheduledContinuationRecord;
}

export interface ScheduledContinuationRepository {
  prepareScheduledContinuation(request: PrepareScheduledContinuationRecordRequest): Promise<PrepareScheduledContinuationRecordResult>;
  recordScheduledContinuationReceipt(request: RecordScheduledContinuationReceiptRecordRequest): Promise<ScheduledContinuationRecord>;
  claimScheduledContinuation(request: ClaimScheduledContinuationRecordRequest): Promise<ClaimScheduledContinuationRecordResult>;
  getScheduledContinuation(request: GetScheduledContinuationRecordRequest): Promise<ScheduledContinuationRecord | null>;
  getLiveScheduledContinuation(goalId: string): Promise<ScheduledContinuationRecord | null>;
  getWorkspaceMutationFence(workspaceId: string): Promise<ScheduledContinuationMutationFence | null>;
  markGoalFinishedForScheduledContinuation(goalId: string, now: string): Promise<GoalScheduledContinuationFinishResult>;
}
