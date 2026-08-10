import type { Workspace } from '@lnwjud/workspace';
import type { SqliteDatabase } from './database.js';

interface WorkspaceRow {
  readonly id: string;
  readonly display_name: string;
  readonly root_path: string;
  readonly real_root_path: string;
  readonly created_at: string;
}

export class SqliteWorkspaceRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async list(): Promise<Workspace[]> {
    const rows = this.database.connection.prepare(
      'SELECT id, display_name, root_path, real_root_path, created_at FROM workspaces ORDER BY created_at, id',
    ).all();
    return rows.flatMap((row) => {
      const workspace = this.toWorkspace(row);
      return workspace === null ? [] : [workspace];
    });
  }

  public async get(id: string): Promise<Workspace | null> {
    const row = this.database.connection.prepare(
      'SELECT id, display_name, root_path, real_root_path, created_at FROM workspaces WHERE id = ?',
    ).get(id);
    return this.toWorkspace(row);
  }

  public async insert(workspace: Workspace): Promise<void> {
    this.database.connection.prepare(
      'INSERT INTO workspaces (id, display_name, root_path, real_root_path, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(workspace.id, workspace.displayName, workspace.rootPath, workspace.realRootPath, workspace.createdAt);
  }

  public async delete(id: string): Promise<void> {
    this.database.connection.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  private toWorkspace(value: unknown): Workspace | null {
    if (!this.isWorkspaceRow(value)) return null;
    return {
      id: value.id,
      displayName: value.display_name,
      rootPath: value.root_path,
      realRootPath: value.real_root_path,
      createdAt: value.created_at,
    };
  }

  private isWorkspaceRow(value: unknown): value is WorkspaceRow {
    if (typeof value !== 'object' || value === null) return false;
    if (!('id' in value) || !('display_name' in value) || !('root_path' in value)
      || !('real_root_path' in value) || !('created_at' in value)) return false;
    return typeof value.id === 'string'
      && typeof value.display_name === 'string'
      && typeof value.root_path === 'string'
      && typeof value.real_root_path === 'string'
      && typeof value.created_at === 'string';
  }
}
