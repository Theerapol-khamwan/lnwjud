import { err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityService } from '@lnwjud/capabilities';
import type { ExtensionsService } from '@lnwjud/extensions';
import type {
  ApplyPatchRequest,
  CodexService,
  DeleteFileRequest,
  FileActor,
  FileService,
  GitService,
  MoveFileRequest,
  ProcessService,
  ProjectService,
  ReadFileRequest,
  ReadFilesRequest,
  SearchService,
  WorkspaceIndexService,
  WorkspaceQueryService,
  WriteFileRequest,
} from '@lnwjud/application';
import type { z } from 'zod';

export interface WorkspaceInfoPort {
  info(actor: FileActor, workspaceId: string): Promise<Result<unknown>>;
  list?(actor: FileActor): Promise<Result<unknown>>;
  register?(actor: FileActor, request: {
    readonly parentWorkspaceId: string;
    readonly path: string;
    readonly displayName?: string;
  }): Promise<Result<unknown>>;
}

export interface ProjectSnapshotPort {
  snapshot(actor: FileActor, workspaceId: string): Promise<Result<unknown>>;
}

export interface McpApplicationServices {
  readonly runtimeStatePath?: string;
  readonly capabilities?: CapabilityService;
  readonly extensions?: ExtensionsService;
  readonly workspaceInfo?: WorkspaceInfoPort;
  readonly workspaceQuery?: Pick<WorkspaceQueryService, 'tree'>;
  readonly projectSnapshot?: ProjectSnapshotPort;
  readonly project?: Pick<ProjectService, 'detect'>;
  readonly file?: Pick<FileService, 'readFile' | 'readFiles' | 'writeFile' | 'applyPatch' | 'moveFile' | 'copyFile' | 'deleteFile'>;
  readonly search?: Pick<SearchService, 'searchFiles' | 'searchText'>;
  readonly workspaceIndex?: Pick<WorkspaceIndexService, 'indexWorkspace' | 'status' | 'startWatch' | 'stopWatch'>;
  readonly git?: Pick<GitService, 'status' | 'diff' | 'log' | 'run'>;
  readonly process?: Pick<ProcessService, 'start' | 'status' | 'logs' | 'stop' | 'startProjectCommand'>;
  readonly codex?: Pick<CodexService, 'status' | 'run' | 'taskStatus' | 'taskLogs' | 'stop'>;
}

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
}

export type McpPermissionLevel = 'READ' | 'WRITE' | 'EXECUTE' | 'DANGEROUS';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly permission: McpPermissionLevel;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: z.ZodType;
  parse(input: unknown): Result<unknown>;
  execute(input: unknown): Promise<Result<unknown>>;
}

export interface McpToolContext {
  readonly actor: FileActor;
  readonly services: McpApplicationServices;
}

export interface ToolConfig<T extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly permission: McpPermissionLevel;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: T;
  handler(input: z.infer<T>): Promise<Result<unknown>>;
}

export function defineTool<T extends z.ZodType>(config: ToolConfig<T>): McpToolDefinition {
  return {
    name: config.name,
    description: config.description,
    permission: config.permission,
    annotations: config.annotations,
    inputSchema: config.inputSchema,
    parse(input: unknown): Result<unknown> {
      const parsed = config.inputSchema.safeParse(input);
      return parsed.success ? ok(parsed.data) : err({ code: 'INVALID_INPUT', message: 'Tool input is invalid', recoverable: false });
    },
    execute(input: unknown): Promise<Result<unknown>> {
      return config.handler(input as z.infer<T>);
    },
  };
}

export function missingService<T>(): Result<T> {
  return err({ code: 'INTERNAL_ERROR', message: 'MCP application service is unavailable', recoverable: true });
}

export type { ApplyPatchRequest, DeleteFileRequest, MoveFileRequest, ReadFileRequest, ReadFilesRequest, WriteFileRequest };
