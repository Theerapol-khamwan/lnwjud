import { appError, err, type Result } from '@lnwjud/domain';
import { TreeReader, type TreeOptions, type TreeResult } from '@lnwjud/filesystem';
import { WorkspacePathGuard, type WorkspaceRepository } from '@lnwjud/workspace';
import type { FileActor } from './file-service.js';

export interface TreeRequest extends TreeOptions {
  readonly path?: string;
}

export class WorkspaceQueryService {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly guard: WorkspacePathGuard = new WorkspacePathGuard(),
    private readonly treeReader: TreeReader = new TreeReader(),
  ) {}

  public async tree(actor: FileActor, workspaceId: string, request: TreeRequest = {}): Promise<Result<TreeResult>> {
    void actor;
    const workspace = await this.workspaces.get(workspaceId);
    if (workspace === null) return err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found'));
    const resolved = await this.guard.resolveForRead(workspace, request.path ?? '.');
    if (!resolved.ok) return resolved;
    return this.treeReader.read(resolved.value.realPath ?? resolved.value.absolutePath, request);
  }
}
