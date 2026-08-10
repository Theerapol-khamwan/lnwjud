import { appError, err, ok, type Result } from '@lnwjud/domain';
import { RipgrepAdapter, type SearchFilesRequest as AdapterFilesRequest, type SearchFilesResult, type SearchTextRequest as AdapterTextRequest, type SearchTextResult } from '@lnwjud/search';
import type { WorkspaceRepository } from '@lnwjud/workspace';
import type { FileActor } from './file-service.js';

export interface SearchTextRequest {
  readonly query: string;
  readonly glob?: string;
  readonly maxResults?: number;
}

export interface SearchFilesRequest {
  readonly glob?: string;
  readonly maxResults?: number;
}

export interface SearchAdapter {
  searchText(request: AdapterTextRequest): Promise<Result<SearchTextResult>>;
  searchFiles(request: AdapterFilesRequest): Promise<Result<SearchFilesResult>>;
}

export class SearchService {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly adapter: SearchAdapter = new RipgrepAdapter(),
  ) {}

  public async searchText(actor: FileActor, workspaceId: string, request: SearchTextRequest): Promise<Result<SearchTextResult>> {
    void actor;
    const validation = this.validateLimit(request.maxResults);
    if (!validation.ok) return validation;
    if (request.query.length === 0) return err(appError('INVALID_INPUT', 'Search query is required'));
    const workspace = await this.workspaces.get(workspaceId);
    if (workspace === null) return err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found'));
    return this.adapter.searchText({
      rootPath: workspace.realRootPath,
      query: request.query,
      ...(request.glob === undefined ? {} : { glob: request.glob }),
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
    });
  }

  public async searchFiles(actor: FileActor, workspaceId: string, request: SearchFilesRequest): Promise<Result<SearchFilesResult>> {
    void actor;
    const validation = this.validateLimit(request.maxResults);
    if (!validation.ok) return validation;
    const workspace = await this.workspaces.get(workspaceId);
    if (workspace === null) return err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found'));
    return this.adapter.searchFiles({
      rootPath: workspace.realRootPath,
      ...(request.glob === undefined ? {} : { glob: request.glob }),
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
    });
  }

  private validateLimit(limit: number | undefined): Result<void> {
    return limit === undefined || Number.isInteger(limit) && limit >= 1 && limit <= 500
      ? ok(undefined)
      : err(appError('INVALID_INPUT', 'Search result limit is invalid'));
  }
}
