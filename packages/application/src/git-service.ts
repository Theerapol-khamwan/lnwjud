import { appError, err, ok, type Result } from '@lnwjud/domain';
import { GitAdapter, type GitDiffRequest, type GitDiffResult, type GitLogRequest, type GitLogResult, type GitStatusResult } from '@lnwjud/git';
import { WorkspacePathGuard, type Workspace, type WorkspaceRepository } from '@lnwjud/workspace';
import type { FileActor } from './file-service.js';

export class GitService {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly guard: WorkspacePathGuard = new WorkspacePathGuard(),
    private readonly adapter: GitAdapter = new GitAdapter(),
  ) {}

  public async status(actor: FileActor, workspaceId: string): Promise<Result<GitStatusResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    return this.adapter.status(workspace.value.realRootPath);
  }

  public async diff(actor: FileActor, workspaceId: string, request: GitDiffRequest = {}): Promise<Result<GitDiffResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    let pathValue: string | undefined;
    if (request.path !== undefined) {
      const resolved = await this.guard.resolveForWrite(workspace.value, request.path);
      if (!resolved.ok) return resolved;
      pathValue = resolved.value.relativePath;
    }
    return this.adapter.diff(workspace.value.realRootPath, {
      ...(pathValue === undefined ? {} : { path: pathValue }),
      ...(request.staged === undefined ? {} : { staged: request.staged }),
      ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
    });
  }

  public async log(actor: FileActor, workspaceId: string, request: GitLogRequest = {}): Promise<Result<GitLogResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    return this.adapter.log(workspace.value.realRootPath, request);
  }

  private async getWorkspace(workspaceId: string): Promise<Result<Workspace>> {
    const workspace = await this.workspaces.get(workspaceId);
    return workspace === null ? err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found')) : ok(workspace);
  }
}
