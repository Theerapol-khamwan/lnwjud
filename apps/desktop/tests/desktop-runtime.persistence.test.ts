import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRuntime, type DesktopRuntime } from '../src/main/desktop-services.js';

const temporaryRoots: string[] = [];

beforeEach(() => {
  vi.stubEnv('LNWJUD_UNRESTRICTED', '1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Ignore transient cleanup locks on Windows
    }
  }));
});

describe('DesktopRuntime persistence', () => {
  it('applies and restores permission settings without restoring an MCP listener', async () => {
    const rawDataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-data-'));
    const rawWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-workspace-'));
    temporaryRoots.push(rawDataRoot, rawWorkspaceRoot);
    const dataRoot = await realpath(rawDataRoot);
    const workspaceRoot = await realpath(rawWorkspaceRoot);

    const firstRuntime = createDesktopRuntime(dataRoot);
    let firstClosed = false;
    try {
      const workspace = await firstRuntime.services.addWorkspace({ rootPath: workspaceRoot });

      await expect(firstRuntime.services.setPermissionProfile({ profile: 'safe' })).resolves.toEqual({ profile: 'safe' });
      const deniedWrite = await firstRuntime.mcpServices.file.writeFile(firstRuntime.mcpActor, workspace.id, {
        path: 'permission-check.txt',
        content: 'safe must require approval',
      });
      expect(deniedWrite).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });

      await expect(firstRuntime.services.setPermissionProfile({ profile: 'balanced' })).resolves.toEqual({ profile: 'balanced' });
      const allowedWrite = await firstRuntime.mcpServices.file.writeFile(firstRuntime.mcpActor, workspace.id, {
        path: 'permission-check.txt',
        content: 'balanced allows writes',
      });
      expect(allowedWrite).toMatchObject({ ok: true });
      await expect(firstRuntime.services.getDashboard()).resolves.toMatchObject({ permissionProfile: 'balanced' });
      await expect(firstRuntime.services.startMcp({ workspaceId: workspace.id })).resolves.toMatchObject({ running: true });
      await firstRuntime.close();
      firstClosed = true;

      const restartedRuntime = createDesktopRuntime(dataRoot);
      try {
        const listed = await restartedRuntime.services.listWorkspaces();
        expect(listed).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: workspace.id, rootPath: workspace.rootPath }),
        ]));
        await expect(restartedRuntime.services.getDashboard()).resolves.toMatchObject({
          permissionProfile: 'balanced',
          mcp: { running: false, url: null, workspaceId: null },
        });
      } finally {
        await restartedRuntime.close();
      }
    } finally {
      if (!firstClosed) await closeRuntime(firstRuntime);
    }
  }, 30_000);

  it('persists AI delete and STDIO security policy settings and applies scoped delete dynamically', async () => {
    const rawDataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-policy-data-'));
    const rawWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-policy-workspace-'));
    temporaryRoots.push(rawDataRoot, rawWorkspaceRoot);
    const dataRoot = await realpath(rawDataRoot);
    const workspaceRoot = await realpath(rawWorkspaceRoot);
    const runtime = createDesktopRuntime(dataRoot);
    try {
      const workspace = await runtime.services.addWorkspace({ rootPath: workspaceRoot });
      await writeFile(path.join(workspaceRoot, 'delete-policy.txt'), 'payload', 'utf8');
      await expect(runtime.mcpServices.file.deleteFile(runtime.mcpActor, workspace.id, { path: 'delete-policy.txt' }))
        .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
      await expect(runtime.services.setAiDeletePolicy({ enabled: true })).resolves.toEqual({ enabled: true });
      await expect(runtime.mcpServices.file.deleteFile(runtime.mcpActor, workspace.id, { path: 'delete-policy.txt' }))
        .resolves.toMatchObject({ ok: true });
      await expect(readFile(path.join(workspaceRoot, 'delete-policy.txt'), 'utf8')).rejects.toThrow();

      await expect(runtime.services.setStdioPolicy({ profile: 'safe', strictRoots: true, allowedRoots: [workspaceRoot] }))
        .resolves.toMatchObject({ profile: 'safe', strictRoots: true, allowedRoots: [workspaceRoot] });
      await expect(runtime.services.getDashboard()).resolves.toMatchObject({
        allowAiDelete: true, stdioPermissionProfile: 'safe', stdioStrictRoots: true, stdioAllowedRoots: [workspaceRoot],
      });
    } finally {
      await runtime.close();
    }

    const restarted = createDesktopRuntime(dataRoot);
    try {
      await expect(restarted.services.getDashboard()).resolves.toMatchObject({
        allowAiDelete: true, stdioPermissionProfile: 'safe', stdioStrictRoots: true, stdioAllowedRoots: [workspaceRoot],
      });
    } finally {
      await restarted.close();
    }
  }, 30_000);

  it('restores the persisted UI locale for native tray startup', async () => {
    const rawDataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-locale-data-'));
    temporaryRoots.push(rawDataRoot);
    const dataRoot = await realpath(rawDataRoot);

    const firstRuntime = createDesktopRuntime(dataRoot);
    try {
      expect(firstRuntime.getLocale()).toBe('th');
      await expect(firstRuntime.services.setLocale({ locale: 'en' })).resolves.toEqual({ locale: 'en' });
      expect(firstRuntime.getLocale()).toBe('en');
    } finally {
      await firstRuntime.close();
    }

    const restartedRuntime = createDesktopRuntime(dataRoot);
    try {
      expect(restartedRuntime.getLocale()).toBe('en');
      await expect(restartedRuntime.services.getDashboard()).resolves.toMatchObject({ locale: 'en' });
    } finally {
      await restartedRuntime.close();
    }
  }, 30_000);

  it('persists user-configurable runtime settings and custom MCP server definitions', async () => {
    const rawDataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-user-settings-'));
    temporaryRoots.push(rawDataRoot);
    const dataRoot = await realpath(rawDataRoot);

    const firstRuntime = createDesktopRuntime(dataRoot);
    try {
      const initial = firstRuntime.getUserSettings();
      const next = {
        ...initial,
        mcpCallTimeoutMs: 120_000,
        mcpIdleTimeoutMs: 10 * 60_000,
        processTimeoutMs: 90 * 60_000,
        capabilityRoots: ['D:\\Projects', 'E:\\Work'],
        pdfProviderPath: 'C:\\Tools\\pdftotext.exe',
        lspCommands: { typescript: '["typescript-language-server","--stdio"]', python: '["pyright-langserver","--stdio"]' },
        codexToolsEnabled: true,
        updateAutoCheck: false,
        updateCheckOnStartup: false,
        updateIntervalMinutes: 120,
        updateAutoDownload: false,
        closeBehavior: 'quit' as const,
        launchAtStartup: true,
        startMinimized: true,
        tunnelAutoReconnect: false,
        tunnelMaxAutoRestarts: 2,
        customPermission: {
          read: 'ALLOW' as const,
          write: 'ALLOW' as const,
          execute: 'ASK' as const,
          dangerous: 'DENY' as const,
          allowedExecutables: ['python.exe', 'docker.exe'],
        },
        extensions: {
          ...initial.extensions,
          mode: 'allowlist' as const,
          enabledServers: ['demo'],
          extraSkillRoots: ['D:\\Skills'],
          extraMcpServers: [{
            name: 'demo',
            command: 'node.exe',
            args: ['server.js'],
            cwd: 'D:\\Mcp',
            type: 'stdio',
            env: { DEMO_MODE: '1' },
          }],
        },
      };

      await expect(firstRuntime.services.setUserSettings({ settings: next })).resolves.toMatchObject({
        restartRequired: true,
        settings: next,
      });
      await expect(firstRuntime.services.getDashboard()).resolves.toMatchObject({ settings: next });
    } finally {
      await firstRuntime.close();
    }

    const restarted = createDesktopRuntime(dataRoot);
    try {
      await expect(restarted.services.getDashboard()).resolves.toMatchObject({
        settings: {
          mcpCallTimeoutMs: 120_000,
          mcpIdleTimeoutMs: 10 * 60_000,
          processTimeoutMs: 90 * 60_000,
          capabilityRoots: ['D:\\Projects', 'E:\\Work'],
          pdfProviderPath: 'C:\\Tools\\pdftotext.exe',
          lspCommands: { typescript: '["typescript-language-server","--stdio"]', python: '["pyright-langserver","--stdio"]' },
          codexToolsEnabled: true,
          updateAutoCheck: false,
          updateCheckOnStartup: false,
          updateIntervalMinutes: 120,
          updateAutoDownload: false,
          closeBehavior: 'quit',
          launchAtStartup: true,
          startMinimized: true,
          tunnelAutoReconnect: false,
          tunnelMaxAutoRestarts: 2,
          customPermission: { allowedExecutables: ['python.exe', 'docker.exe'] },
          extensions: {
            mode: 'allowlist',
            enabledServers: ['demo'],
            extraSkillRoots: ['D:\\Skills'],
            extraMcpServers: [{ name: 'demo', command: 'node.exe', args: ['server.js'], cwd: 'D:\\Mcp', type: 'stdio', env: { DEMO_MODE: '1' } }],
          },
        },
      });
    } finally {
      await restarted.close();
    }
  }, 30_000);
  it('serves the local capability health tool through the desktop MCP listener', async () => {
    const rawDataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-data-'));
    const rawWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-workspace-'));
    temporaryRoots.push(rawDataRoot, rawWorkspaceRoot);
    const dataRoot = await realpath(rawDataRoot);
    const workspaceRoot = await realpath(rawWorkspaceRoot);
    const runtime = createDesktopRuntime(dataRoot);
    try {
      const workspace = await runtime.services.addWorkspace({ rootPath: workspaceRoot });
      const connection = await runtime.services.startMcp({ workspaceId: workspace.id });
      expect(connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      if (connection.url === null) return;
      const client = new Client({ name: 'desktop-capability-test', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(connection.url));
      try {
        await client.connect(transport);
        const response = await client.callTool({ name: 'health', arguments: { operation: 'check_tool', tool: 'shell' } });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toMatchObject({ tool: 'shell', available: true });
        const shellStartedAt = Date.now();
        const shellResponse = await client.callTool({
          name: 'shell',
          arguments: {
            executable: process.execPath,
            arguments: ['-e', "setTimeout(() => process.stdout.write('local-shell'), 5500)"],
            cwd: workspaceRoot,
            execution: 'foreground',
          },
        });
        expect(Date.now() - shellStartedAt).toBeLessThan(4_000);
        expect(shellResponse.isError).not.toBe(true);
        expect(shellResponse.structuredContent).toMatchObject({ state: 'running', task_id: expect.any(String) });
        const shellTaskId = (shellResponse.structuredContent as { task_id: string }).task_id;
        let shellResult = shellResponse;
        for (let attempt = 0; attempt < 140 && shellResult.structuredContent?.state === 'running'; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          shellResult = await client.callTool({ name: 'shell', arguments: { operation: 'result', task_id: shellTaskId } });
        }
        expect(shellResult.isError).not.toBe(true);
        expect(shellResult.structuredContent).toMatchObject({ state: 'completed', exit_code: 0, stdout: 'local-shell' });
        if (process.platform === 'win32') {
          const windowHealth = await client.callTool({ name: 'health', arguments: { operation: 'check_tool', tool: 'window' } });
          expect(windowHealth.isError).not.toBe(true);
          expect(windowHealth.structuredContent).toMatchObject({ tool: 'window', availability: 'windows', available: true });

          const input = await client.callTool({ name: 'input_event', arguments: { operation: 'click', parameters: { x: 0, y: 0 }, dry_run: true } });
          expect(input.isError).not.toBe(true);
          expect(input.structuredContent).toMatchObject({ dry_run: true, capability: 'input_event' });

          const windows = await client.callTool({ name: 'window', arguments: { operation: 'list' } });
          if (windows.isError) {
            // Hosted Windows runners can be headless even though the capability is valid for win32.
            expect(windows.structuredContent).toMatchObject({ error: { code: 'INTERNAL_ERROR', message: 'Operation failed' } });
          } else {
            expect(windows.structuredContent).toMatchObject({ windows: expect.any(Array) });
            const accessibility = await client.callTool({ name: 'accessibility', arguments: { action: 'status' } });
            expect(accessibility.isError).not.toBe(true);
            expect(accessibility.structuredContent).toMatchObject({ available: true });
            const vision = await client.callTool({ name: 'vision', arguments: { action: 'capture_region', region: { x: 0, y: 0, width: 64, height: 64 } } });
            if (!vision.isError) {
              expect(vision.structuredContent).toMatchObject({ format: 'png', width: 64, height: 64 });
            }
          }
        }
      } finally {
        await client.close();
      }
    } finally {
      await runtime.close();
    }
  }, 30_000);
});

async function closeRuntime(runtime: DesktopRuntime): Promise<void> {
  await runtime.close();
}
