import { z } from 'zod';
import {
  DEFAULT_CONTINUATION_DELAY_MINUTES,
  MAX_CONTINUATION_DELAY_MINUTES,
  MIN_CONTINUATION_DELAY_MINUTES,
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

const prepareSchema = z.object({
  goalId,
  leaseToken,
  expectedRevision: z.number().int().min(0),
  currentPhase: z.string().min(1).max(256),
  summary: z.string().min(1).max(2048),
  stepUpdates: z.array(stepUpdate).max(100),
  nextAction: z.string().min(1).max(1024),
  blockers: z.array(z.string().min(1).max(512)).max(20),
  evidence: z.array(evidence).max(20),
  activeTaskIds: z.array(z.string().min(1).max(256)).max(50),
  delayMinutes: z.number().int().min(MIN_CONTINUATION_DELAY_MINUTES).max(MAX_CONTINUATION_DELAY_MINUTES).default(DEFAULT_CONTINUATION_DELAY_MINUTES),
  executionPreference: z.enum(['auto', 'cloud', 'local']).default('auto'),
}).strict();

const receiptSchema = z.discriminatedUnion('outcome', [
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('created'),
    nativeTaskId: z.string().min(1).max(512),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('create_failed'),
    nativeTaskId: z.string().min(1).max(512).optional(),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('create_uncertain'),
    nativeTaskId: z.string().min(1).max(512).optional(),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('cancelled'),
    nativeTaskId: z.string().min(1).max(512),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('cancel_failed'),
    nativeTaskId: z.string().min(1).max(512).optional(),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
  z.object({
    continuationId,
    expectedVersion: z.number().int().min(0),
    outcome: z.literal('cancel_uncertain'),
    nativeTaskId: z.string().min(1).max(512).optional(),
    runsOn: z.enum(['cloud', 'local', 'unverified']).optional(),
    detail: z.string().max(1024).optional(),
  }).strict(),
]);

const claimSchema = z.object({
  continuationId,
  leaseSeconds: z.number().int().min(30).max(3600).default(600),
}).strict();

const getSchema = z.union([
  z.object({ continuationId }).strict(),
  z.object({ goalId, latest: z.literal(true) }).strict(),
]);

export const SCHEDULED_CONTINUATION_TOOL_NAMES = [
  'prepare_scheduled_continuation',
  'record_scheduled_continuation_receipt',
  'claim_scheduled_continuation',
  'get_scheduled_continuation',
] as const;

export function scheduledContinuationTools(context: McpToolContext): McpToolDefinition[] {
  return [
    defineTool({
      name: 'prepare_scheduled_continuation',
      description: 'Checkpoint and reserve exactly one future current-chat successor. The default two minutes is successor lead time, not a work-slice limit; the current run keeps working. This tool never creates or deletes a native task.',
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
        delayMinutes: input.delayMinutes as 2 | 3 | 4 | 5,
        executionPreference: input.executionPreference,
      }) ?? missingService(),
    }),
    defineTool({
      name: 'record_scheduled_continuation_receipt',
      description: 'Record the host-owned ChatGPT Scheduled Task create/cancel receipt. This tool records state only and never creates or deletes a native task itself.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: receiptSchema,
      handler: async (input) => context.services.scheduledContinuations?.recordScheduledContinuationReceipt(context.actor, {
        continuationId: input.continuationId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome,
        ...(input.nativeTaskId === undefined ? {} : { nativeTaskId: input.nativeTaskId }),
        ...(input.runsOn === undefined ? {} : { runsOn: input.runsOn }),
        ...(input.detail === undefined ? {} : { detail: input.detail }),
      }) ?? missingService(),
    }),
    defineTool({
      name: 'claim_scheduled_continuation',
      description: 'Scheduled-wake entrypoint. Atomically claim the continuation lease before doing workspace mutations; a terminal goal becomes a no-op and must not schedule another successor.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: claimSchema,
      handler: async (input) => context.services.scheduledContinuations?.claimScheduledContinuation(context.actor, input) ?? missingService(),
    }),
    defineTool({
      name: 'get_scheduled_continuation',
      description: 'Read one scheduled-continuation snapshot by continuation ID or the latest record for a goal. Terminal goal state prevents further continuation scheduling.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: getSchema,
      handler: async (input) => context.services.scheduledContinuations?.getScheduledContinuation(context.actor, input) ?? missingService(),
    }),
  ];
}
