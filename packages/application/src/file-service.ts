import { constants as fsConstants } from 'node:fs';
import { copyFile, cp, lstat, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, MAX_MULTI_FILE_BYTES, ok, type Result } from '@lnwjud/domain';
import {
  AtomicFileWriter,
  MAX_FILE_WRITE_BYTES,
  PatchApplier,
  TextFileReader,
  UnboundedFileReader,
  ensureParentDirectory,
  mapNodeFsError,
  nodeErrorCode,
  type FilePatch,
  type LineRange,
} from '@lnwjud/filesystem';
import { DefaultPermissionEngine, permissionProfiles, type PermissionEngine, type PermissionProfile } from '@lnwjud/permissions';
import { isWithin, WorkspacePathGuard, type Workspace, type WorkspaceRepository } from '@lnwjud/workspace';
import type { CheckpointServicePort } from './checkpoint-service.js';
import { resolveSharedWorkspace, resolveWorkspaceForPath } from './workspace-locator.js';

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
  readonly encoding?: 'utf8' | 'base64';
  readonly mimeType?: string;
  readonly byteLength?: number;
}

export interface ReadFilesRequest {
  readonly files: readonly ReadFileRequest[];
}

export interface ReadFilesResult {
  readonly files: readonly ReadFileResult[];
}

export interface FileServiceDependencies {
  readonly writer?: AtomicFileWriter;
  readonly patchApplier?: PatchApplier;
  readonly checkpointService?: CheckpointServicePort;
  readonly permissionEngine?: PermissionEngine;
  readonly profile?: PermissionProfile;
  readonly profileProvider?: () => PermissionProfile;
  readonly unboundedReader?: UnboundedFileReader;
  /** When true, every workspace uses the trusted read path (binary/base64, no size cap). */
  readonly unrestricted?: boolean;
  /** Registered/selected workspaces are trusted even when global unrestricted mode is off. */
  readonly trustedWorkspaceAccess?: boolean;
}

export interface WriteFileRequest {
  readonly path: string;
  readonly content: string;
}

export interface WriteFileResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly checkpointId?: string;
}

export interface ApplyPatchRequest {
  readonly files: readonly FilePatch[];
}

export interface ApplyPatchResult {
  readonly paths: readonly string[];
  readonly checkpointId?: string;
}

export interface MoveFileRequest {
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export interface CopyFileRequest {
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export interface CopyFileResult {
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export interface DeleteFileRequest {
  readonly path: string;
  /** After the human confirms in chat, callers must set this true. */
  readonly userConfirmed?: boolean;
}

export class FileService {
  private readonly writer: AtomicFileWriter;
  private readonly patchApplier: PatchApplier;
  private readonly checkpointService: CheckpointServicePort | undefined;
  private readonly permissionEngine: PermissionEngine;
  private readonly profileProvider: () => PermissionProfile;
  private readonly unboundedReader: UnboundedFileReader;
  private readonly unrestricted: boolean;
  private readonly trustedWorkspaceAccess: boolean;

  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly guard: WorkspacePathGuard = new WorkspacePathGuard(),
    private readonly reader: TextFileReader = new TextFileReader(),
    dependencies: FileServiceDependencies = {},
  ) {
    this.writer = dependencies.writer ?? new AtomicFileWriter();
    this.patchApplier = dependencies.patchApplier ?? new PatchApplier();
    this.checkpointService = dependencies.checkpointService;
    this.permissionEngine = dependencies.permissionEngine ?? new DefaultPermissionEngine();
    this.profileProvider = dependencies.profileProvider ?? ((): PermissionProfile => dependencies.profile ?? permissionProfiles.balanced);
    this.unboundedReader = dependencies.unboundedReader ?? new UnboundedFileReader();
    this.unrestricted = dependencies.unrestricted === true;
    this.trustedWorkspaceAccess = dependencies.trustedWorkspaceAccess === true;
  }

  private isTrustedWorkspace(workspace: Workspace): boolean {
    void workspace;
    return this.unrestricted || this.trustedWorkspaceAccess;
  }

  public async readFile(actor: FileActor, workspaceId: string | undefined, request: ReadFileRequest): Promise<Result<ReadFileResult>> {
    void actor;
    const workspaceResult = await resolveWorkspaceForPath(this.workspaces, workspaceId, request.path);
    if (!workspaceResult.ok) return workspaceResult;
    const workspace = workspaceResult.value;
    const resolved = await this.guard.resolveForRead(workspace, request.path);
    if (!resolved.ok) return resolved;

    const absolute = resolved.value.realPath ?? resolved.value.absolutePath;
    if (this.isTrustedWorkspace(workspace)) {
      if (request.startLine !== undefined || request.endLine !== undefined) {
        const textResult = await this.reader.read(absolute, request);
        if (textResult.ok) {
          return ok({ path: resolved.value.relativePath, ...textResult.value, encoding: 'utf8', mimeType: 'text/plain' });
        }
      }
      const unbounded = await this.unboundedReader.read(absolute);
      if (!unbounded.ok) return unbounded;
      return ok({
        path: resolved.value.relativePath,
        content: unbounded.value.content,
        startLine: unbounded.value.startLine,
        endLine: unbounded.value.endLine,
        encoding: unbounded.value.encoding,
        mimeType: unbounded.value.mimeType,
        byteLength: unbounded.value.byteLength,
      });
    }

    const readResult = await this.reader.read(absolute, request);
    if (!readResult.ok) return readResult;
    return ok({ path: resolved.value.relativePath, ...readResult.value, encoding: 'utf8' });
  }

  public async readFiles(actor: FileActor, workspaceId: string | undefined, request: ReadFilesRequest): Promise<Result<ReadFilesResult>> {
    void actor;
    if (!Array.isArray(request.files) || request.files.length > 20) {
      return err(appError('INVALID_INPUT', 'At most 20 files may be read'));
    }
    const firstPath = request.files[0]?.path;
    if (typeof firstPath !== 'string') return err(appError('INVALID_INPUT', 'At least one file is required'));
    const workspaceResult = await resolveWorkspaceForPath(this.workspaces, workspaceId, firstPath);
    if (!workspaceResult.ok) return workspaceResult;
    const trustedWorkspace = this.isTrustedWorkspace(workspaceResult.value);

    const files: ReadFileResult[] = [];
    let totalBytes = 0;
    for (const fileRequest of request.files) {
      const fileWorkspace = await resolveWorkspaceForPath(this.workspaces, workspaceId, fileRequest.path);
      if (!fileWorkspace.ok) return fileWorkspace;
      if (fileWorkspace.value.id !== workspaceResult.value.id) {
        return err(appError('PATH_OUTSIDE_WORKSPACE', 'All files must be in the same workspace'));
      }
      const result = await this.readFile(actor, fileWorkspace.value.id, fileRequest);
      if (!result.ok) return result;
      totalBytes += result.value.byteLength
        ?? Buffer.byteLength(result.value.content, result.value.encoding === 'base64' ? 'base64' : 'utf8');
      if (!trustedWorkspace && totalBytes > MAX_MULTI_FILE_BYTES) {
        return err(appError('FILE_TOO_LARGE', 'Total file content exceeds the maximum read size'));
      }
      files.push(result.value);
    }
    return ok({ files });
  }

  public async writeFile(actor: FileActor, workspaceId: string | undefined, request: WriteFileRequest): Promise<Result<WriteFileResult>> {
    if (typeof request?.path !== 'string' || typeof request.content !== 'string') {
      return err(appError('INVALID_INPUT', 'Write request is invalid'));
    }
    if (Buffer.byteLength(request.content, 'utf8') > MAX_FILE_WRITE_BYTES) {
      return err(appError('FILE_TOO_LARGE', 'File exceeds the maximum write size'));
    }
    const workspaceResult = await resolveWorkspaceForPath(this.workspaces, workspaceId, request.path);
    if (!workspaceResult.ok) return workspaceResult;
    const workspace = workspaceResult.value;
    const resolved = await this.guard.resolveForWrite(workspace, request.path);
    if (!resolved.ok) return resolved;
    const existing = await this.inspectExistingFile(resolved.value.absolutePath);
    if (!existing.ok) return existing;
    if (existing.value === 'directory') return err(appError('INVALID_INPUT', 'Directories cannot be written as files'));
    const permission = this.decide(workspace.id, 'write_file', 'WRITE', resolved.value.relativePath, false);
    if (!permission.ok) return permission;

    let checkpointId: string | undefined;
    if (existing.value) {
      const checkpoint = await this.createCheckpoint(actor, workspace.id, [resolved.value.relativePath]);
      if (!checkpoint.ok) return checkpoint;
      checkpointId = checkpoint.value.id;
    }
    const writeResult = await this.writer.write(resolved.value.realPath ?? resolved.value.absolutePath, request.content);
    if (!writeResult.ok) return writeResult;
    return ok({
      path: resolved.value.relativePath,
      bytesWritten: Buffer.byteLength(request.content, 'utf8'),
      ...(checkpointId === undefined ? {} : { checkpointId }),
    });
  }

  public async applyPatch(actor: FileActor, workspaceId: string | undefined, request: ApplyPatchRequest): Promise<Result<ApplyPatchResult>> {
    const validation = this.patchApplier.validate(request?.files ?? []);
    if (!validation.ok) return validation;
    const firstPath = request.files[0]?.path;
    if (typeof firstPath !== 'string') return err(appError('INVALID_INPUT', 'At least one file is required'));
    const workspaceResult = await resolveWorkspaceForPath(this.workspaces, workspaceId, firstPath);
    if (!workspaceResult.ok) return workspaceResult;
    const workspace = workspaceResult.value;

    const resolvedFiles: { readonly patch: FilePatch; readonly absolutePath: string; readonly relativePath: string }[] = [];
    const existingPaths: string[] = [];
    for (const patch of request.files) {
      const fileWorkspace = await resolveWorkspaceForPath(this.workspaces, workspaceId, patch.path);
      if (!fileWorkspace.ok) return fileWorkspace;
      if (fileWorkspace.value.id !== workspace.id) {
        return err(appError('PATH_OUTSIDE_WORKSPACE', 'All files must be in the same workspace'));
      }
      const resolved = await this.guard.resolveForWrite(workspace, patch.path);
      if (!resolved.ok) return resolved;
      const existing = await this.inspectExistingFile(resolved.value.absolutePath);
      if (!existing.ok) return existing;
      if (existing.value === 'directory') return err(appError('INVALID_INPUT', 'Directories cannot be patched as files'));
      if (existing.value) existingPaths.push(resolved.value.relativePath);
      resolvedFiles.push({
        patch,
        absolutePath: resolved.value.realPath ?? resolved.value.absolutePath,
        relativePath: resolved.value.relativePath,
      });
    }

    const permission = this.decide(workspace.id, 'apply_patch', 'WRITE', undefined, false);
    if (!permission.ok) return permission;
    let checkpointId: string | undefined;
    if (existingPaths.length > 0) {
      const checkpoint = await this.createCheckpoint(actor, workspace.id, existingPaths);
      if (!checkpoint.ok) return checkpoint;
      checkpointId = checkpoint.value.id;
    }
    for (const resolved of resolvedFiles) {
      const writeResult = await this.writer.write(resolved.absolutePath, resolved.patch.content);
      if (!writeResult.ok) return writeResult;
    }
    return ok({
      paths: resolvedFiles.map((resolved) => resolved.relativePath),
      ...(checkpointId === undefined ? {} : { checkpointId }),
    });
  }

  public async moveFile(actor: FileActor, workspaceId: string | undefined, request: MoveFileRequest): Promise<Result<void>> {
    const prepared = await this.prepareTransfer(actor, workspaceId, request, 'move_file');
    if (!prepared.ok) return prepared;
    const { sourceAbs, destinationAbs, isDirectory } = prepared.value;
    const parent = await ensureParentDirectory(destinationAbs);
    if (!parent.ok) return parent;
    try {
      await rename(sourceAbs, destinationAbs);
    } catch (error: unknown) {
      if (nodeErrorCode(error) !== 'EXDEV') return err(mapNodeFsError(error, 'File move failed'));
      try {
        if (isDirectory) await cp(sourceAbs, destinationAbs, { recursive: true, errorOnExist: true, force: false });
        else await copyFile(sourceAbs, destinationAbs, fsConstants.COPYFILE_EXCL);
        await rm(sourceAbs, { recursive: isDirectory, force: false });
      } catch (copyError: unknown) {
        return err(mapNodeFsError(copyError, 'File move failed'));
      }
    }
    return ok(undefined);
  }

  public async copyFile(actor: FileActor, workspaceId: string | undefined, request: CopyFileRequest): Promise<Result<CopyFileResult>> {
    const prepared = await this.prepareTransfer(actor, workspaceId, request, 'copy_file');
    if (!prepared.ok) return prepared;
    const { sourceAbs, destinationAbs, isDirectory, sourceRelative, destinationRelative } = prepared.value;
    const parent = await ensureParentDirectory(destinationAbs);
    if (!parent.ok) return parent;
    try {
      if (isDirectory) await cp(sourceAbs, destinationAbs, { recursive: true, errorOnExist: true, force: false });
      else await copyFile(sourceAbs, destinationAbs, fsConstants.COPYFILE_EXCL);
    } catch (error: unknown) {
      return err(mapNodeFsError(error, 'File copy failed'));
    }
    return ok({ sourcePath: sourceRelative, destinationPath: destinationRelative });
  }

  public async deleteFile(actor: FileActor, workspaceId: string | undefined, request: DeleteFileRequest): Promise<Result<void>> {
    void actor;
    if (typeof request?.path !== 'string') return err(appError('INVALID_INPUT', 'Delete request is invalid'));
    if (request.userConfirmed !== true) {
      return err(appError(
        'PERMISSION_REQUIRED',
        'Deletion requires the user to confirm in chat first, then retry delete_file with userConfirmed: true',
      ));
    }
    const workspaceResult = await resolveWorkspaceForPath(this.workspaces, workspaceId, request.path);
    if (!workspaceResult.ok) return workspaceResult;
    const resolved = await this.guard.resolveForRead(workspaceResult.value, request.path);
    if (!resolved.ok) return resolved;
    if (resolved.value.relativePath.length === 0) return err(appError('PERMISSION_DENIED', 'Workspace root cannot be deleted'));
    const permission = this.decide(workspaceResult.value.id, 'delete_file', 'DANGEROUS', resolved.value.relativePath, true);
    if (!permission.ok) return permission;
    const targetPath = resolved.value.realPath ?? resolved.value.absolutePath;
    try {
      const target = await lstat(targetPath);
      if (target.isDirectory()) {
        const entries = await readdir(targetPath);
        if (entries.length > 0) return err(appError('INVALID_INPUT', 'Non-empty directories cannot be deleted'));
        await rmdir(targetPath);
      } else {
        await unlink(targetPath);
      }
    } catch (error: unknown) {
      return err(mapNodeFsError(error, 'File deletion failed'));
    }
    return ok(undefined);
  }

  private async prepareTransfer(
    actor: FileActor,
    workspaceId: string | undefined,
    request: MoveFileRequest,
    action: 'move_file' | 'copy_file',
  ): Promise<Result<{
    readonly sourceAbs: string;
    readonly destinationAbs: string;
    readonly isDirectory: boolean;
    readonly sourceRelative: string;
    readonly destinationRelative: string;
  }>> {
    void actor;
    if (typeof request?.sourcePath !== 'string' || typeof request.destinationPath !== 'string') {
      return err(appError('INVALID_INPUT', 'Transfer request is invalid'));
    }
    const workspaceResult = await resolveSharedWorkspace(this.workspaces, workspaceId, request.sourcePath, request.destinationPath);
    if (!workspaceResult.ok) return workspaceResult;
    const workspace = workspaceResult.value;
    const source = await this.guard.resolveForRead(workspace, request.sourcePath);
    if (!source.ok) return source;
    const destination = await this.guard.resolveForWrite(workspace, request.destinationPath);
    if (!destination.ok) return destination;
    const sourceAbs = source.value.realPath ?? source.value.absolutePath;
    const destinationAbs = destination.value.absolutePath;
    const sourceType = await this.inspectExistingFile(sourceAbs);
    if (!sourceType.ok) return sourceType;
    if (!sourceType.value) return err(appError('FILE_NOT_FOUND', 'Source file was not found'));
    const destinationType = await this.inspectExistingFile(destinationAbs);
    if (!destinationType.ok) return destinationType;
    if (destinationType.value) return err(appError('INVALID_INPUT', 'Destination already exists'));
    if (sourceType.value === 'directory' && isWithin(sourceAbs, destinationAbs) && path.resolve(sourceAbs) !== path.resolve(destinationAbs)) {
      return err(appError('INVALID_INPUT', 'Destination cannot be inside the source directory'));
    }
    const permission = this.decide(workspace.id, action, 'WRITE', source.value.relativePath, false);
    if (!permission.ok) return permission;
    return ok({
      sourceAbs,
      destinationAbs,
      isDirectory: sourceType.value === 'directory',
      sourceRelative: source.value.relativePath,
      destinationRelative: destination.value.relativePath,
    });
  }

  private decide(
    workspaceId: string,
    action: string,
    level: 'WRITE' | 'DANGEROUS',
    target: string | undefined,
    destructive: boolean,
  ): Result<void> {
    const operation = { action, level, workspaceId, destructive, ...(target === undefined ? {} : { target }) };
    const decision = this.permissionEngine.decide(this.profileProvider(), operation);
    if (decision === 'DENY') return err(appError('PERMISSION_DENIED', `${action} is denied`));
    if (decision === 'ASK') return err(appError('PERMISSION_REQUIRED', `${action} requires permission`));
    return ok(undefined);
  }

  private async createCheckpoint(actor: FileActor, workspaceId: string, paths: readonly string[]): Promise<Result<{ readonly id: string }>> {
    if (this.checkpointService === undefined) return err(appError('INTERNAL_ERROR', 'Checkpoint service is unavailable', true));
    const checkpoint = await this.checkpointService.createForFiles(actor, workspaceId, paths);
    if (!checkpoint.ok) return checkpoint;
    return ok({ id: checkpoint.value.id });
  }

  private async inspectExistingFile(filePath: string): Promise<Result<boolean | 'directory'>> {
    try {
      const target = await lstat(filePath);
      return ok(target.isDirectory() ? 'directory' : true);
    } catch (error: unknown) {
      if (nodeErrorCode(error) !== 'ENOENT') return err(mapNodeFsError(error, 'Unable to inspect file target'));
      return ok(false);
    }
  }
}
