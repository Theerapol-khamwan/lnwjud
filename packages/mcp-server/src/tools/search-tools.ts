import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';
import { searchFilesSchema, searchTextSchema } from './schemas.js';

export function searchTools(context: McpToolContext): McpToolDefinition[] {
  return [
    defineTool({
      name: 'search_files',
      description: 'Search workspace filenames with bounded results.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: searchFilesSchema,
      handler: async (input) => context.services.search === undefined
        ? missingService()
        : context.services.search.searchFiles(context.actor, input.workspaceId, {
          ...(input.glob === undefined ? {} : { glob: input.glob }),
          ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        }),
    }),
    defineTool({
      name: 'search_text',
      description: 'Search workspace text using direct ripgrep arguments.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: searchTextSchema,
      handler: async (input) => context.services.search === undefined
        ? missingService()
        : context.services.search.searchText(context.actor, input.workspaceId, {
          query: input.query,
          ...(input.glob === undefined ? {} : { glob: input.glob }),
          ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        }),
    }),
  ];
}
