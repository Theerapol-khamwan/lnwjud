import { z } from 'zod';
import {
  DEFAULT_SUCCESSOR_DELAY_MINUTES,
  MAX_SUCCESSOR_DELAY_MINUTES,
  MIN_SUCCESSOR_DELAY_MINUTES,
} from '@lnwjud/application';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const continuationId = z.string().min(1).max(128);
const goalId = z.string().min(1).max(128);
const leaseToken = z.string().min(1).max(256);
const evidence = z.object({
  kind: z.enum(['path', 'hash', 'task', 'note']),
  value: z.string().min(1).max(1024),
}).strict();
const stepUpdate = z.object({
  stepId: z.string().min(1).max(128),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
  summary: z.string().max(1024).optional(),
}).strict();
const version = z.number().int().min(0);
const nativeTaskId = z.string().min(1).max(512);
const dueAt = z.string().datetime({ offset: true });
const detail = z.string().max(1024).optional();
const nativeCancellationReceipt = z.object({
  provider: z.literal('chatgpt_scheduled_task'),
  operation: z.literal('delete'),
  nativeTaskId,
  state: z.enum(['deleted', 'not_found']),
  observedAt: z.string().datetime({ offset: true }),
}).strict();

const prepareSchema = z.object({
  goalId,
  leaseToken,
  expectedRevision: version,
  currentPhase: z.string().min(1).max(256),
  summary: z.string().min(1).max(2048),
  stepUpdates: z.array(stepUpdate).max(100),
  nextAction: z.string().min(1).max(1024),
  blockers: z.array(z.string().min(1).max(512)).max(20),
  evidence: z.array(evidence).max(20),
  activeTaskIds: z.array(z.string().min(1).max(256)).max(50),
  successorDelayMinutes: z.number().int()
    .min(MIN_SUCCESSOR_DELAY_MINUTES)
    .max(MAX_SUCCESSOR_DELAY_MINUTES)
    .default(DEFAULT_SUCCESSOR_DELAY_MINUTES),
  executionPreference: z.literal('cloud').default('cloud'),
}).strict();

const receiptSchema = z.discriminatedUnion('outcome', [
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('created'), nativeTaskId, runsOn: z.literal('cloud'), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('create_failed'), nativeTaskId: nativeTaskId.optional(), runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('create_uncertain'), nativeTaskId: nativeTaskId.optional(), runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('rescheduled'), nativeTaskId, dueAt, runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('reschedule_failed'), nativeTaskId, dueAt, runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('reschedule_uncertain'), nativeTaskId, dueAt, runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('cancelled'), nativeCancellationReceipt, detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('cancel_failed'), nativeTaskId: nativeTaskId.optional(), runsOn: z.literal('cloud').optional(), detail }).strict(),
  z.object({ continuationId, expectedVersion: version, outcome: z.literal('cancel_uncertain'), nativeTaskId: nativeTaskId.optional(), runsOn: z.literal('cloud').optional(), detail }).strict(),
]);

const claimSchema = z.object({
  continuationId,
  leaseSeconds: z.number().int().min(30).max(3600).default(600),
}).strict();

const getSchema = z.union([
  z.object({ continuationId }).strict(),
  z.object({ goalId, latest: z.literal(true) }).strict(),
]);

const expediteSchema = z.object({
  goalId,
  continuationId,
  leaseToken,
  expectedLeaseGeneration: version,
  expectedGoalRevision: version,
  expectedContinuationVersion: version,
  reason: z.enum([
    'host_deadline_warning',
    'host_budget_warning',
    'tool_access_degradation',
    'turn_yield_signal',
  ]),
}).strict();

export const SCHEDULED_CONTINUATION_TOOL_NAMES = [
  'prepare_scheduled_continuation',
  'record_scheduled_continuation_receipt',
  'claim_scheduled_continuation',
  'get_scheduled_continuation',
  'expedite_scheduled_continuation',
] as const;

export function scheduledContinuationTools(context: McpToolContext): McpToolDefinition[] {
  return [
    defineTool({
      name: 'prepare_scheduled_continuation',
      description: 'Checkpoint and reserve exactly one current-chat cloud successor with an adaptive delay between 2 and 25 minutes. The 25-minute default is a maximum watchdog, while bounded final work may use a shorter delay. This workflow never creates or deletes the native task itself.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: prepareSchema,
      handler: async (input) => context.services.scheduledContinuations?.prepareScheduledContinuation(context.actor, {
        goalId: input.goalId,
        leaseToken: input.leaseToken,
        expectedRevision: input.expectedRevision,
        currentPhase: input.currentPhase,
        summary: input.summary,
        stepUpdates: input.stepUpdates.map((update) => ({
          stepId: update.stepId,
          status: update.status,
          ...(update.summary === undefined ? {} : { summary: update.summary }),
        })),
        nextAction: input.nextAction,
        blockers: input.blockers,
        evidence: input.evidence,
        activeTaskIds: input.activeTaskIds,
        successorDelayMinutes: input.successorDelayMinutes,
        executionPreference: input.executionPreference,
      }) ?? missingService(),
    }),
    defineTool({
      name: 'record_scheduled_continuation_receipt',
      description: 'Record host-owned cloud one-time task create, same-task reschedule, or cancellation receipts. Cancelled is accepted only with a matching native ChatGPT host deletion receipt; a model assertion is not cancellation proof. The stored native task ID is immutable across reschedules.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: receiptSchema,
      handler: async (input) => context.services.scheduledContinuations?.recordScheduledContinuationReceipt(context.actor, {
        continuationId: input.continuationId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome,
        ...('nativeTaskId' in input && input.nativeTaskId !== undefined ? { nativeTaskId: input.nativeTaskId } : {}),
        ...('dueAt' in input && input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...('runsOn' in input && input.runsOn !== undefined ? { runsOn: input.runsOn } : {}),
        ...('nativeCancellationReceipt' in input ? { nativeCancellationReceipt: input.nativeCancellationReceipt } : {}),
        ...(input.detail === undefined ? {} : { detail: input.detail }),
      }) ?? missingService(),
    }),
    defineTool({
      name: 'claim_scheduled_continuation',
      description: 'Scheduled-wake entrypoint. Claim before workspace mutation; a confirmed cloud wake up to 60 seconds early is accepted so a one-time task is not consumed without handoff. If native task creation was never confirmed, returns receipt_required for reconciliation. On an active-worker collision, update the exact existing native one-time cloud task to now+2 minutes. Do not mutate the workspace, create a replacement task, mark the goal terminal, or stop the durable chain.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: claimSchema,
      handler: async (input) => context.services.scheduledContinuations?.claimScheduledContinuation(context.actor, input) ?? missingService(),
    }),
    defineTool({
      name: 'get_scheduled_continuation',
      description: 'Read one scheduled-continuation snapshot by continuation ID or the latest record for a goal. A healthy current run keeps its adaptive watchdog unless a real turn-yield signal requires same-task +2 handoff.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: getSchema,
      handler: async (input) => context.services.scheduledContinuations?.getScheduledContinuation(context.actor, input) ?? missingService(),
    }),
    defineTool({
      name: 'expedite_scheduled_continuation',
      description: 'For an enumerated handoff-risk signal, including a turn that is about to end while the goal is unfinished, move the exact existing cloud one-time native task to now+2 minutes. No replacement task is created.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: expediteSchema,
      handler: async (input) => context.services.scheduledContinuations?.expediteScheduledContinuation(context.actor, input) ?? missingService(),
    }),
  ];
}
