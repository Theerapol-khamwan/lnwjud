import type { WorkspaceId } from '@lnwjud/domain';

export interface Workspace {
  readonly id: WorkspaceId;
  readonly displayName: string;
  readonly rootPath: string;
  readonly realRootPath: string;
  readonly createdAt: string;
}

export interface ResolvedWorkspacePath {
  readonly workspaceId: WorkspaceId;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly realPath?: string;
  readonly exists: boolean;
}
