import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { DiagnosticLogger, FileActor } from '@lnwjud/application';
import type { PermissionProfile } from '@lnwjud/permissions';
import { APP_NAME, APP_VERSION } from '@lnwjud/shared';
import { readTraceContext, type ActivitySink, type ActivityTracker } from './activity-tracker.js';
import { withProgressHeartbeat, type ProgressNotifyContext } from './progress-heartbeat.js';
import { ToolRegistry, type McpApplicationServices } from './tool-registry.js';

export interface McpServerOptions {
  readonly services: McpApplicationServices;
  readonly actor: FileActor;
  readonly diagnostic?: DiagnosticLogger;
  readonly activity?: ActivitySink;
  readonly activityTracker?: ActivityTracker;
  readonly profileProvider?: () => PermissionProfile;
  readonly allowAiDeleteProvider?: () => boolean;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const registry = new ToolRegistry(options.services, options.actor, {
    ...(options.diagnostic === undefined ? {} : { diagnostic: options.diagnostic }),
    ...(options.activity === undefined ? {} : { activity: options.activity }),
    ...(options.activityTracker === undefined ? {} : { activityTracker: options.activityTracker }),
    ...(options.profileProvider === undefined ? {} : { profileProvider: options.profileProvider }),
    ...(options.allowAiDeleteProvider === undefined ? {} : { allowAiDeleteProvider: options.allowAiDeleteProvider }),
  });
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION }, { capabilities: { tools: {} } });
  for (const tool of registry.list()) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }, async (input: unknown, context): Promise<CallToolResult> => {
      return withProgressHeartbeat(context as ProgressNotifyContext, tool.name, async () => (
        registry.invoke(tool.name, input, readTraceContext(context)) as unknown as Promise<CallToolResult>
      ));
    });
  }
  return server;
}
