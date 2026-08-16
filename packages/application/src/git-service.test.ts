import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitAdapter } from '@lnwjud/git';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import { GitService } from './git-service.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-git-service-'));
  temporaryRoots.push(root);
  return {
    id: 'workspace-1',
    displayName: 'Fixture',
    rootPath: root,
    realRootPath: root,
    createdAt: new Date(0).toISOString(),
  };
}

function repository(workspace: Workspace): WorkspaceRepository {
  return {
    async list(): Promise<Workspace[]> { return [workspace]; },
    async get(id: string): Promise<Workspace | null> { return id === workspace.id ? workspace : null; },
    async insert(): Promise<void> {},
    async delete(): Promise<void> {},
  };
}

describe('GitService', () => {
  it('guards a diff path before delegating to the Git adapter', async () => {
    const workspace = await createWorkspace();
    const adapter = {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(rootPath: string, request: { path?: string; staged?: boolean; maxBytes?: number }): Promise<{ ok: true; value: { patch: string; truncated: boolean } }> {
        expect(rootPath).toBe(workspace.realRootPath);
        expect(request.path).toBe(path.join('src', 'new.txt'));
        return { ok: true, value: { patch: '', truncated: false } };
      },
      async log(): Promise<never> { throw new Error('not used'); },
    } as unknown as GitAdapter;
    const service = new GitService(repository(workspace), undefined, adapter);

    const result = await service.diff({ clientId: 'test', clientName: 'test' }, workspace.id, { path: 'src\\new.txt' });

    expect(result).toEqual({ ok: true, value: { patch: '', truncated: false } });
  });

  it('rejects a diff path outside the workspace', async () => {
    const workspace = await createWorkspace();
    const service = new GitService(repository(workspace), undefined, {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(): Promise<never> { throw new Error('must not run'); },
      async log(): Promise<never> { throw new Error('not used'); },
    } as unknown as GitAdapter);

    const result = await service.diff({ clientId: 'test', clientName: 'test' }, workspace.id, { path: '..\\outside.txt' });

    expect(result).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
  });

  it('runs git against an absolute cwd in a registered workspace', async () => {
    const workspace = await createWorkspace();
    const adapter = {
      async status(): Promise<never> { throw new Error('not used'); },
      async diff(): Promise<never> { throw new Error('not used'); },
      async log(): Promise<never> { throw new Error('not used'); },
      async run(cwd: string, args: readonly string[]): Promise<{ ok: true; value: { exitCode: number; stdout: string; stderr: string } }> {
        expect(path.resolve(cwd).toLowerCase()).toBe(path.resolve(workspace.realRootPath).toLowerCase());
        expect(args).toEqual(['init']);
        return { ok: true, value: { exitCode: 0, stdout: 'Initialized empty Git repository', stderr: '' } };
      },
    } as unknown as GitAdapter;
    const service = new GitService(repository(workspace), undefined, adapter);

    const result = await service.run({ clientId: 'test', clientName: 'test' }, {
      args: ['init'],
      cwd: workspace.realRootPath,
    });

    expect(result).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: 'Initialized empty Git repository', stderr: '' },
    });
  });

  it('requires workspaceId unless cwd is an absolute path', async () => {
    const workspace = await createWorkspace();
    const service = new GitService(repository(workspace));

    const result = await service.run({ clientId: 'test', clientName: 'test' }, { args: ['status'] });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
