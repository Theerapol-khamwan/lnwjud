import { appError } from '@lnwjud/domain';
import { sanitizeException, type DiagnosticLogger, type FileActor } from '@lnwjud/application';
import { DefaultPermissionEngine, permissionProfiles, type PermissionProfile } from '@lnwjud/permissions';
import { ActivityTracker, type ActivitySink } from './activity-tracker.js';
import { ContextEngine } from './context-engine.js';
import { ContextEconomyRuntime } from './context-economy.js';
import { FilePageEngine } from './file-page-engine.js';
import { mapError, mapResult, type McpToolResponse } from './result-mapper.js';
import { batchTools } from './tools/batch-tools.js';
import { contextTools } from './tools/context-tools.js';
import { filePageTools } from './tools/file-page-tools.js';
import { workspaceIndexTools } from './tools/workspace-index-tools.js';
import { upgradeTools } from './tools/upgrade-tools.js';
import { ToolSchemaRegistry } from './tool-schema-registry.js';
import { codexTools } from './tools/codex-tools.js';
import { capabilityTools } from './tools/capability-tools.js';
import { fileTools } from './tools/file-tools.js';
import { gitTools } from './tools/git-tools.js';
import { mcpBridgeTools } from './tools/mcp-bridge-tools.js';
import { processTools } from './tools/process-tools.js';
import { searchTools } from './tools/search-tools.js';
import { skillTools } from './tools/skill-tools.js';
import { workspaceTools } from './tools/workspace-tools.js';
import type { McpApplicationServices, McpToolContext, McpToolDefinition } from './tools/tool-types.js';

export type { McpApplicationServices } from './tools/tool-types.js';

export interface ToolRegistryOptions {
  readonly diagnostic?: DiagnosticLogger;
  readonly activity?: ActivitySink;
  readonly activityTracker?: ActivityTracker;
  readonly profileProvider?: () => PermissionProfile;
}

export class ToolRegistry {
  private readonly tools: readonly McpToolDefinition[];
  private readonly diagnostic: DiagnosticLogger | undefined;
  private readonly activity: ActivityTracker;
  private readonly schemaRegistry: ToolSchemaRegistry;
  private readonly permissionEngine = new DefaultPermissionEngine();
  private readonly profileProvider: () => PermissionProfile;

  public constructor(services: McpApplicationServices, actor: FileActor, options: ToolRegistryOptions = {}) {
    this.diagnostic = options.diagnostic;
    this.activity = options.activityTracker ?? new ActivityTracker(options.activity);
    this.profileProvider = options.profileProvider ?? ((): PermissionProfile => permissionProfiles.full);
    const contextEconomy = new ContextEconomyRuntime();
    const context: McpToolContext = { services, actor, contextEconomy };
    const contextEngine = new ContextEngine(services, actor, contextEconomy);
    const filePageEngine = new FilePageEngine(services, actor);
    const workspace = workspaceTools(context);
    const files = fileTools(context);
    const baseTools: readonly McpToolDefinition[] = [
      ...workspace,
      ...files.slice(0, 2),
      ...searchTools(context),
      ...gitTools(context),
      ...files.slice(2),
      ...processTools(context),
      ...codexTools(context),
      ...capabilityTools(context),
      ...skillTools(context),
      ...mcpBridgeTools(context),
      ...contextTools(context, contextEngine),
      ...filePageTools(filePageEngine),
      ...workspaceIndexTools(context),
      ...upgradeTools(context),
    ];
    this.tools = [
      ...baseTools,
      ...batchTools({
        invoke: (name, input) => this.invoke(name, input),
        describe: (name) => baseTools.find((tool) => tool.name === name),
      }),
    ];
    this.schemaRegistry = new ToolSchemaRegistry();
    for (const tool of this.tools) this.schemaRegistry.register(tool);
  }

  public list(): readonly McpToolDefinition[] {
    return this.tools;
  }

  public listInFlight(): ReturnType<ActivityTracker['listInFlight']> {
    return this.activity.listInFlight();
  }

  public listSchemas(): ReturnType<ToolSchemaRegistry['list']> {
    return this.schemaRegistry.list();
  }

  public describeSchema(name: string): ReturnType<ToolSchemaRegistry['describe']> {
    return this.schemaRegistry.describe(name);
  }

  public async invoke(name: string, input: unknown): Promise<McpToolResponse> {
    const callId = await this.activity.begin(name, input);
    const started = Date.now();
    try {
      const tool = this.tools.find((candidate) => candidate.name === name);
      if (tool === undefined) {
        const response = mapError(appError('INVALID_INPUT', 'Unknown MCP tool'));
        await this.activity.end(callId, 'INVALID_INPUT', Date.now() - started, 'Unknown MCP tool');
        return response;
      }
      const parsed = tool.parse(input);
      if (!parsed.ok) {
        const response = mapError(parsed.error);
        await this.activity.end(callId, parsed.error.code, Date.now() - started, parsed.error.message);
        return response;
      }
      const permissionDecision = this.permissionEngine.decide(this.profileProvider(), {
        action: 'mcp:' + tool.name,
        level: tool.permission,
        workspaceId: readWorkspaceId(parsed.value),
        target: tool.name,
        destructive: tool.annotations.destructiveHint,
      });
      if (permissionDecision !== 'ALLOW') {
        const code = permissionDecision === 'DENY' ? 'PERMISSION_DENIED' : 'PERMISSION_REQUIRED';
        const message = permissionDecision === 'DENY'
          ? 'MCP tool ' + tool.name + ' is denied by the active permission profile'
          : 'MCP tool ' + tool.name + ' requires permission approval';
        const response = mapError(appError(code, message, permissionDecision === 'ASK'));
        await this.activity.end(callId, code, Date.now() - started, message);
        return response;
      }
      const response = mapResult(await tool.execute(parsed.value));
      const resultCode = response.isError === true
        ? readErrorCode(response) ?? 'ERROR'
        : 'SUCCESS';
      await this.activity.end(callId, resultCode, Date.now() - started, readErrorMessage(response));
      return response;
    } catch (error: unknown) {
      const response = mapError(sanitizeException(error, this.diagnostic));
      await this.activity.end(callId, 'INTERNAL_ERROR', Date.now() - started, 'Operation failed');
      return response;
    }
  }
}

function readWorkspaceId(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'workspaceId' in input) {
    const value = (input as { workspaceId?: unknown }).workspaceId;
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return 'system';
}

function readErrorCode(response: McpToolResponse): string | undefined {
  return readErrorField(response, 'code');
}

function readErrorMessage(response: McpToolResponse): string | undefined {
  return readErrorField(response, 'message');
}

function readErrorField(response: McpToolResponse, field: 'code' | 'message'): string | undefined {
  const content = response.structuredContent;
  if (typeof content !== 'object' || content === null || !('error' in content)) return undefined;
  const error = (content as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null || !(field in error)) return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
