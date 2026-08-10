import { describe, expect, it } from 'vitest';
import { SearchService, type SearchAdapter } from './search-service.js';
import type { WorkspaceRepository, Workspace } from '@lnwjud/workspace';

describe('SearchService', () => {
  it('resolves the workspace before delegating a bounded text search', async () => {
    const workspace: Workspace = { id: 'workspace-1', displayName: 'Fixture', rootPath: 'C:\\workspace', realRootPath: 'C:\\workspace', createdAt: new Date(0).toISOString() };
    let receivedRoot = '';
    const adapter: SearchAdapter = {
      async searchText(request) { receivedRoot = request.rootPath; return { ok: true, value: { matches: [], truncated: false } }; },
      async searchFiles() { return { ok: true, value: { paths: [], truncated: false } }; },
    };
    const repository: WorkspaceRepository = {
      async list(): Promise<Workspace[]> { return [workspace]; },
      async get(id: string): Promise<Workspace | null> { return id === workspace.id ? workspace : null; },
      async insert(): Promise<void> {},
      async delete(): Promise<void> {},
    };

    const result = await new SearchService(repository, adapter).searchText(
      { clientId: 'test', clientName: 'test' },
      workspace.id,
      { query: 'needle', maxResults: 200 },
    );

    expect(result).toEqual({ ok: true, value: { matches: [], truncated: false } });
    expect(receivedRoot).toBe(workspace.realRootPath);
  });

  it('rejects an oversized result limit at the application boundary', async () => {
    const repository: WorkspaceRepository = {
      async list(): Promise<Workspace[]> { return []; },
      async get(): Promise<Workspace | null> { return null; },
      async insert(): Promise<void> {},
      async delete(): Promise<void> {},
    };
    const adapter: SearchAdapter = {
      async searchText() { return { ok: true, value: { matches: [], truncated: false } }; },
      async searchFiles() { return { ok: true, value: { paths: [], truncated: false } }; },
    };

    const result = await new SearchService(repository, adapter).searchText(
      { clientId: 'test', clientName: 'test' },
      'workspace-1',
      { query: 'needle', maxResults: 501 },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
