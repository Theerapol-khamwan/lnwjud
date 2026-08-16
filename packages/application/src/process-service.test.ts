import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type CommandSpec, type Result } from '@lnwjud/domain';
import type { ManagedProcess, ManagedProcessStart, ProcessLogResult } from '@lnwjud/process';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import { ProcessService, type ProcessServiceDependencies, type ProjectCommandSource } from './process-service.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<Workspace> {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-process-service-'));
  temporaryRoots.push(rawRoot);
  const root = await realpath(rawRoot);
  await mkdir(path.join(root, 'src'));
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

function processHandle(id = 'process-1'): ManagedProcess {
  return {
    processId: id,
    executable: 'pnpm',
    args: ['test'],
    cwd: 'C:\\workspace',
    state: 'running',
    startedAt: new Date(0).toISOString(),
  };
}

describe('ProcessService', () => {
  it('allows a detected pnpm project command under Balanced and starts it in the guarded root', async () => {
    const workspace = await createWorkspace();
    const calls: ManagedProcessStart[] = [];
    const manager = fakeManager(calls);
    const projectCommands: ProjectCommandSource = {
      async getCommand(): Promise<Result<CommandSpec>> { return ok({ executable: 'pnpm', args: ['test'] }); },
    };
    const service = new ProcessService(repository(workspace), { processManager: manager, projectService: projectCommands });

    const result = await service.startProjectCommand({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'test');

    expect(result).toMatchObject({ ok: true, value: { processId: 'process-1' } });
    expect(calls).toEqual([{ executable: 'pnpm', args: ['test'], cwd: workspace.realRootPath }]);
  });

  it('returns PERMISSION_REQUIRED for an unknown client executable', async () => {
    const workspace = await createWorkspace();
    const calls: ManagedProcessStart[] = [];
    const service = new ProcessService(repository(workspace), { processManager: fakeManager(calls) });

    const result = await service.start({ clientId: 'client-1', clientName: 'test' }, workspace.id, {
      executable: 'custom-tool.exe',
      args: [],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    expect(calls).toHaveLength(0);
  });

  it('runs cwd path guarding before permission decisions', async () => {
    const workspace = await createWorkspace();
    let permissionCalls = 0;
    const service = new ProcessService(repository(workspace), {
      processManager: fakeManager([]),
      permissionEngine: { decide(): 'ALLOW' { permissionCalls += 1; return 'ALLOW'; } },
    });

    const result = await service.start({ clientId: 'client-1', clientName: 'test' }, workspace.id, {
      executable: 'custom-tool.exe',
      args: [],
      cwd: '..\\outside',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
    expect(permissionCalls).toBe(0);
  });

  it('enforces process ownership for status, logs, and stop handles', async () => {
    const workspace = await createWorkspace();
    const service = new ProcessService(repository(workspace), { processManager: fakeManager([]) });
    const started = await service.start({ clientId: 'client-1', clientName: 'test' }, workspace.id, {
      executable: 'pnpm',
      args: ['test'],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await expect(service.status({ clientId: 'client-2', clientName: 'other' }, workspace.id, started.value.processId))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    await expect(service.logs({ clientId: 'client-1', clientName: 'test' }, workspace.id, started.value.processId, {}))
      .resolves.toMatchObject({ ok: true });
    await expect(service.stop({ clientId: 'client-1', clientName: 'test' }, workspace.id, started.value.processId))
      .resolves.toMatchObject({ ok: true });
  });
});

function fakeManager(calls: ManagedProcessStart[]): ProcessServiceDependencies['processManager'] {
  return {
    async start(spec: ManagedProcessStart): Promise<Result<ManagedProcess>> {
      calls.push(spec);
      return ok(processHandle());
    },
    status(): Result<ManagedProcess> { return ok(processHandle()); },
    logs(): Result<ProcessLogResult> { return ok({ entries: [], truncated: false, nextSequence: 0 }); },
    async stop(): Promise<Result<void>> { return ok(undefined); },
  };
}
