import { appError, err, ok, type Result } from '@lnwjud/domain';
import { TextFileReader, type LineRange } from '@lnwjud/filesystem';
import { WorkspacePathGuard, type Workspace, type WorkspaceRepository } from '@lnwjud/workspace';

export interface FileActor {
  readonly clientId: string;
  readonly clientName: string;
}

export interface ReadFileRequest extends LineRange {
  readonly path: string;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ReadFilesRequest {
  readonly files: readonly ReadFileRequest[];
}

export interface ReadFilesResult {
  readonly files: readonly ReadFileResult[];
}

export class FileService {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly guard: WorkspacePathGuard = new WorkspacePathGuard(),
    private readonly reader: TextFileReader = new TextFileReader(),
  ) {}

  public async readFile(actor: FileActor, workspaceId: string, request: ReadFileRequest): Promise<Result<ReadFileResult>> {
    void actor;
    const workspaceResult = await this.getWorkspace(workspaceId);
    if (!workspaceResult.ok) return workspaceResult;
    const resolved = await this.guard.resolveForRead(workspaceResult.value, request.path);
    if (!resolved.ok) return resolved;
    const readResult = await this.reader.read(resolved.value.realPath ?? resolved.value.absolutePath, request);
    if (!readResult.ok) return readResult;
    return ok({ path: resolved.value.relativePath, ...readResult.value });
  }

  public async readFiles(actor: FileActor, workspaceId: string, request: ReadFilesRequest): Promise<Result<ReadFilesResult>> {
    void actor;
    if (!Array.isArray(request.files) || request.files.length > 20) {
      return err(appError('INVALID_INPUT', 'At most 20 files may be read'));
    }
    const files: ReadFileResult[] = [];
    let totalBytes = 0;
    for (const fileRequest of request.files) {
      const result = await this.readFile(actor, workspaceId, fileRequest);
      if (!result.ok) return result;
      totalBytes += Buffer.byteLength(result.value.content, 'utf8');
      if (totalBytes > 4 * 1024 * 1024) return err(appError('FILE_TOO_LARGE', 'Combined file response exceeds the maximum size'));
      files.push(result.value);
    }
    return ok({ files });
  }

  private async getWorkspace(workspaceId: string): Promise<Result<Workspace>> {
    const workspace = await this.workspaces.get(workspaceId);
    return workspace === null ? err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found')) : ok(workspace);
  }
}
