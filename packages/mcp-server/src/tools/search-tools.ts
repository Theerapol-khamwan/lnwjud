import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';
import { searchFilesSchema, searchTextSchema } from './schemas.js';

export function searchTools(context: McpToolContext): McpToolDefinition[] {
  return [
    defineTool({
      name: 'search_files',
      description: 'Search workspace filenames with automatic context-economy filters; set includeIgnored for an explicit full path search. Absolute path does not require workspaceId.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: searchFilesSchema,
      handler: async (input, signal) => context.services.search === undefined
        ? missingService()
        : context.services.search.searchFiles(context.actor, input.workspaceId, {
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.glob === undefined ? {} : { glob: input.glob }),
          ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
          discovery: input.includeIgnored ? 'explicit' : 'automatic',
        }, signal),
    }),
    defineTool({
      name: 'search_text',
      description: 'Search workspace text using direct ripgrep arguments with automatic binary/generated filters; set includeIgnored for an explicit full path search. Absolute path does not require workspaceId.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: searchTextSchema,
      handler: async (input, signal) => context.services.search === undefined
        ? missingService()
        : context.services.search.searchText(context.actor, input.workspaceId, {
          query: input.query,
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.glob === undefined ? {} : { glob: input.glob }),
          ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
          discovery: input.includeIgnored ? 'explicit' : 'automatic',
        }, signal),
    }),
  ];
}
