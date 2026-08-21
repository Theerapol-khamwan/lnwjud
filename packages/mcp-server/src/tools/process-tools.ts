import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';
import { processHandleSchema, processLogsSchema, processStartSchema } from './schemas.js';

type ProjectCommandKind = 'dev' | 'test' | 'lint' | 'typecheck' | 'build';

export function processTools(context: McpToolContext): McpToolDefinition[] {
  return [
    defineTool({
      name: 'process_start',
      description: 'Start one policy-checked executable with separate arguments.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: processStartSchema,
      handler: async (input, signal) => context.services.process === undefined
        ? missingService()
        : context.services.process.start(context.actor, input.workspaceId, {
          executable: input.executable,
          args: input.args,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        }, signal),
    }),
    defineTool({
      name: 'process_list',
      description: 'List managed process handles owned by this client in a workspace, including launches whose response was cancelled.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: processHandleSchema.pick({ workspaceId: true }),
      handler: async (input) => context.services.process === undefined
        ? missingService()
        : context.services.process.list(context.actor, input.workspaceId),
    }),
    defineTool({
      name: 'process_status',
      description: 'Read status for an owned process handle.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: processHandleSchema,
      handler: async (input) => context.services.process === undefined
        ? missingService()
        : context.services.process.status(context.actor, input.workspaceId, input.processId),
    }),
    defineTool({
      name: 'process_logs',
      description: 'Read bounded logs for an owned process handle.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: processLogsSchema,
      handler: async (input) => context.services.process === undefined
        ? missingService()
        : context.services.process.logs(context.actor, input.workspaceId, input.processId, {
          ...(input.tailLines === undefined ? {} : { tailLines: input.tailLines }),
          ...(input.sinceSequence === undefined ? {} : { sinceSequence: input.sinceSequence }),
        }),
    }),
    defineTool({
      name: 'process_stop',
      description: 'Stop an owned managed process tree.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: processHandleSchema,
      handler: async (input) => context.services.process === undefined
        ? missingService()
        : context.services.process.stop(context.actor, input.workspaceId, input.processId),
    }),
    ...projectCommandTools(context),
  ];
}

function projectCommandTools(context: McpToolContext): McpToolDefinition[] {
  const definitions: { readonly name: string; readonly kind: ProjectCommandKind }[] = [
    { name: 'project_dev', kind: 'dev' },
    { name: 'project_test', kind: 'test' },
    { name: 'project_lint', kind: 'lint' },
    { name: 'project_typecheck', kind: 'typecheck' },
    { name: 'project_build', kind: 'build' },
  ];
  return definitions.map(({ name, kind }) => defineTool({
    name,
    description: `Run the detected project ${kind} command.`,
    permission: 'EXECUTE',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: processHandleSchema.pick({ workspaceId: true }),
    handler: async (input, signal) => context.services.process === undefined
      ? missingService()
      : context.services.process.startProjectCommand(context.actor, input.workspaceId, kind, signal),
  }));
}
