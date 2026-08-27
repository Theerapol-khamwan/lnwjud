import { describe, expect, it, vi } from 'vitest';
import { appError, err, ok } from '@lnwjud/domain';
import { ToolRegistry, type McpApplicationServices } from './tool-registry.js';

const actor = { clientId: 'client-1', clientName: 'test', sessionId: 'session-a' };

function blockedAuthorization(): ReturnType<typeof err> {
  return err(appError('CONFLICT', 'scheduled continuation fence blocked mutation', true));
}

describe('scheduled continuation mutation fence', () => {
  it('blocks file mutation before the file handler executes', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const writeFile = vi.fn(async () => ok({ path: 'src/file.ts', bytesWritten: 1 }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      file: { writeFile },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('write_file', {
      workspaceId: 'workspace-1',
      path: 'src/file.ts',
      content: 'x',
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({ error: { code: 'CONFLICT' } });
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('blocks Git mutation before the Git handler executes', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const run = vi.fn(async () => ok({ exitCode: 0, stdout: '', stderr: '' }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      git: { run },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('git', {
      workspaceId: 'workspace-1',
      args: ['add', 'src/file.ts'],
    });

    expect(response.isError).toBe(true);
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
    expect(run).not.toHaveBeenCalled();
  });

  it('blocks process execution before the process handler executes', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const start = vi.fn(async () => ok({ processId: 'process-1' }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      process: { start },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('process_start', {
      workspaceId: 'workspace-1',
      executable: 'node',
      args: ['--version'],
    });

    expect(response.isError).toBe(true);
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
    expect(start).not.toHaveBeenCalled();
  });

  it('blocks detected project commands before preview or process start', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const previewProjectCommand = vi.fn(async () => ok({ executable: 'pnpm', args: ['build'] }));
    const startProjectCommand = vi.fn(async () => ok({ processId: 'process-project' }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      process: { previewProjectCommand, startProjectCommand },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('project_build', {
      workspaceId: 'workspace-1',
      userConfirmed: true,
    });

    expect(response.isError).toBe(true);
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
    expect(previewProjectCommand).not.toHaveBeenCalled();
    expect(startProjectCommand).not.toHaveBeenCalled();
  });

  it('blocks incremental verification before it can launch a typecheck', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('verify_incremental', {
      workspaceId: 'workspace-1',
      userConfirmed: true,
    });

    expect(response.isError).toBe(true);
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
  });

  it('blocks delegated Codex mutation before the Codex backend executes', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const run = vi.fn(async () => ok({ codexTaskId: 'codex-1' }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      codex: { run },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor, { codexToolsEnabled: true }).invoke('codex_run', {
      workspaceId: 'workspace-1',
      instruction: 'edit the project',
      userConfirmed: true,
    });

    expect(response.isError).toBe(true);
    expect(authorizeWorkspaceMutation).toHaveBeenCalledWith(actor, 'workspace-1');
    expect(run).not.toHaveBeenCalled();
  });

  it('does not fence read-only file access', async () => {
    const authorizeWorkspaceMutation = vi.fn(async () => blockedAuthorization());
    const readFile = vi.fn(async () => ok({ path: 'src/file.ts', content: 'ok', startLine: 1, endLine: 1 }));
    const services = {
      scheduledContinuations: { authorizeWorkspaceMutation },
      file: { readFile },
    } as unknown as McpApplicationServices;

    const response = await new ToolRegistry(services, actor).invoke('read_file', {
      workspaceId: 'workspace-1',
      path: 'src/file.ts',
    });

    expect(response.isError).not.toBe(true);
    expect(readFile).toHaveBeenCalled();
    expect(authorizeWorkspaceMutation).not.toHaveBeenCalled();
  });
});
