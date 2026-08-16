import { defineTool, type McpToolDefinition } from './tool-types.js';
import { readFilePageContinueSchema, readFilePageSchema } from './schemas.js';
import type { FilePageEngine } from '../file-page-engine.js';

export function filePageTools(engine: FilePageEngine): McpToolDefinition[] {
  return [
    defineTool({
      name: 'read_file_page',
      description: 'Read a deterministic line chunk with explicit continuation instead of silently truncating a large file.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: readFilePageSchema,
      handler: async (input) => engine.readPage({
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        path: input.path,
        ...(input.startLine === undefined ? {} : { startLine: input.startLine }),
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
        ...(input.responseTargetBytes === undefined ? {} : { responseTargetBytes: input.responseTargetBytes }),
      }),
    }),
    defineTool({
      name: 'read_file_page_continue',
      description: 'Continue read_file_page from the next deterministic line chunk.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: readFilePageContinueSchema,
      handler: async (input) => engine.continue(input.continuationToken, input.pageSize),
    }),
  ];
}
