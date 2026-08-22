import { afterEach, describe, expect, it, vi } from 'vitest';
import { appError, err, ok } from '@lnwjud/domain';
import { permissionProfiles } from '@lnwjud/permissions';
import type { ActivitySinkEvent } from './activity-tracker.js';
import { ToolRegistry, type McpApplicationServices } from './tool-registry.js';
import { CODEX_TOOL_NAMES } from './tools/codex-tools.js';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';

const actor = { clientId: 'client-1', clientName: 'test' };

afterEach(() => {
  vi.useRealTimers();
});

describe('MCP tool registry', () => {
  it('returns the exact deterministic tool order', () => {
    const registry = new ToolRegistry({}, actor);

    expect(registry.list().map((tool) => tool.name)).toEqual([
      'workspace_list', 'workspace_register', 'workspace_info', 'workspace_tree', 'project_snapshot', 'read_file', 'read_files',
      'search_files', 'search_text', 'git_status', 'git_diff', 'git_log', 'git', 'write_file',
      'apply_patch', 'move_file', 'copy_file', 'delete_file', 'process_start', 'process_list', 'process_status',
      'process_logs', 'process_stop', 'project_dev', 'project_test', 'project_lint',
      'project_typecheck', 'project_build', 'shell', 'dom_cdp', 'accessibility', 'input_event', 'vision', 'vision_annotated_capture', 'ui_target_action', 'window', 'health',
      'system_info', 'notification', 'file_dialog', 'clipboard', 'web_fetch',
      'audio', 'screen_record', 'office', 'scheduler',
      'wsl_exec', 'wsl_fs',
      'skills_list', 'skills_read', 'mcp_list', 'mcp_describe', 'mcp_call',
      'workspace_context', 'workspace_context_continue', 'workspace_full_scan', 'workspace_full_scan_continue',
      'workspace_snapshot', 'search_all', 'read_many_files',
      'read_file_page', 'read_file_page_continue',
      'workspace_index', 'workspace_index_status', 'workspace_index_watch', 'workspace_index_stop',
      'session_handoff', 'verify_incremental',
      ...UPGRADE_TOOL_CATALOG.map((entry) => entry.name),
      'tool_batch',
    ]);
  });

  it('hides Codex delegation tools by default and exposes them only when explicitly enabled', () => {
    const hidden = new ToolRegistry({}, actor);
    const enabled = new ToolRegistry({}, actor, { codexToolsEnabled: true });

    expect(hidden.list().filter((tool) => tool.name.startsWith('codex_'))).toHaveLength(0);
    expect(enabled.list().filter((tool) => tool.name.startsWith('codex_')).map((tool) => tool.name)).toEqual([...CODEX_TOOL_NAMES]);
    expect(enabled.list()).toHaveLength(hidden.list().length + CODEX_TOOL_NAMES.length);
  });

  it('does not advertise a fixed drive letter in workspace registration metadata', () => {
    const registry = new ToolRegistry({}, actor);
    const registration = registry.list().find((tool) => tool.name === 'workspace_register');
    expect(registration?.description).not.toContain('E:\\');
  });

  it('exposes the local desktop capability contract', () => {
    const registry = new ToolRegistry({}, actor);
    const byName = new Map(registry.list().map((tool) => [tool.name, tool]));

    expect(byName.get('shell')?.parse({ operation: 'run', executable: 'node', arguments: [] })).toMatchObject({ ok: true });
    expect(byName.get('dom_cdp')?.parse({ action: 'query', parameters: { selector: '#app' } })).toMatchObject({ ok: true });
    expect(byName.get('accessibility')?.parse({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(byName.get('input_event')?.parse({ operation: 'click', parameters: { x: 1, y: 2 } })).toMatchObject({ ok: true });
    expect(byName.get('vision')?.parse({ action: 'capture_display' })).toMatchObject({ ok: true });
    expect(byName.get('window')?.parse({ operation: 'list' })).toMatchObject({ ok: true });
    expect(byName.get('window')?.parse({ operation: 'set_window_frame', parameters: { x: 0, y: 0, width: 800, height: 600 } })).toMatchObject({ ok: true });
    expect(byName.get('health')?.parse({ operation: 'check_all' })).toMatchObject({ ok: true });
    expect(byName.get('wsl_exec')?.parse({ workspaceId: 'workspace-1', executable: 'node', arguments: ['--version'] })).toMatchObject({ ok: true });
    expect(byName.get('wsl_fs')?.parse({ operation: 'translate', workspaceId: 'workspace-1', direction: 'windows_to_wsl', path: 'C:\\workspace' })).toMatchObject({ ok: true });
  });

  it('forces MCP command execution to return immediately and caps follow-up waits', async () => {
    const calls: Array<{ tool: string; input: unknown }> = [];
    const registry = new ToolRegistry({
      capabilities: {
        async execute(tool, input): Promise<ReturnType<typeof ok>> {
          calls.push({ tool, input });
          return ok({ accepted: true });
        },
      },
    }, actor);
    const byName = new Map(registry.list().map((tool) => [tool.name, tool]));

    expect(byName.get('shell')?.description).toContain('ALWAYS forced to execution=background');
    expect(byName.get('shell')?.parse({ operation: 'run', executable: 'node', arguments: [] })).toMatchObject({ ok: true, value: { execution: 'background' } });
    expect(byName.get('wsl_exec')?.parse({ operation: 'run', workspaceId: 'workspace-1', executable: 'true', arguments: [] })).toMatchObject({ ok: true, value: { execution: 'background' } });

    await registry.invoke('shell', { operation: 'run', executable: 'node', arguments: ['--version'], execution: 'foreground' });
    await registry.invoke('shell', { operation: 'wait', task_id: 'task-1', timeout_seconds: 60 });
    await registry.invoke('wsl_exec', { operation: 'run', workspaceId: 'workspace-1', executable: 'true', arguments: [], execution: 'foreground' });
    await registry.invoke('wsl_exec', { operation: 'wait', workspaceId: 'workspace-1', task_id: 'task-2', timeout_seconds: 60 });

    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ tool: 'shell', input: { operation: 'run', execution: 'background' } });
    expect(calls[1]).toMatchObject({ tool: 'shell', input: { operation: 'wait', timeout_seconds: 5 } });
    expect(calls[2]).toMatchObject({ tool: 'wsl_exec', input: { operation: 'run', execution: 'background' } });
    expect(calls[3]).toMatchObject({ tool: 'wsl_exec', input: { operation: 'wait', timeout_seconds: 5 } });
  });

  it('blocks dangerous capability execution under the safe profile before reaching the backend', async () => {
    let executed = false;
    const registry = new ToolRegistry({
      capabilities: {
        async execute(): Promise<ReturnType<typeof ok>> {
          executed = true;
          return ok({ executed: true });
        },
      },
    }, actor, {
      profileProvider: (): typeof permissionProfiles.safe => permissionProfiles.safe,
    });

    const response = await registry.invoke('dom_cdp', { action: 'query', parameters: { selector: 'body' } });

    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'PERMISSION_DENIED' } },
    });
    expect(executed).toBe(false);
  });

  it('rejects invalid workspace IDs, line ranges, oversized results, and process log queries at the schema boundary', async () => {
    const registry = new ToolRegistry({}, actor);

    await expect(registry.invoke('read_file', { workspaceId: '', path: 'src\\file.ts' })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_INPUT' } } });
    await expect(registry.invoke('read_file', { workspaceId: 'workspace-1', path: 'src\\file.ts', startLine: 10, endLine: 2 })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_INPUT' } } });
    await expect(registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'x', maxResults: 501 })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_INPUT' } } });
    await expect(registry.invoke('process_logs', { workspaceId: 'workspace-1', processId: 'process-1', tailLines: 10001 })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_INPUT' } } });
  });

  it('marks read-only and destructive annotations accurately and excludes forbidden tools', () => {
    const registry = new ToolRegistry({}, actor);
    const byName = new Map(registry.list().map((tool) => [tool.name, tool]));

    expect(byName.get('read_file')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get('delete_file')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('git')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('write_file')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('skills_list')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('mcp_call')?.permission).toBe('DANGEROUS');
    expect(byName.get('tool_batch')?.permission).toBe('DANGEROUS');
    expect(byName.get('tool_batch')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('workspace_context')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.get('read_file_page')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(registry.list().some((tool) => ['run_shell', 'powershell', 'cmd', 'git_reset', 'git_clean', 'kill_pid'].includes(tool.name))).toBe(false);
  });

  it('maps application errors without exposing internal details', async () => {
    const services: McpApplicationServices = {
      file: { async readFile(): Promise<ReturnType<typeof err>> { return err(appError('INTERNAL_ERROR', 'internal stack must not escape', true)); } },
    };

    const response = await new ToolRegistry(services, actor).invoke('read_file', { workspaceId: 'workspace-1', path: 'src\\file.ts' });

    expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: 'INTERNAL_ERROR', recoverable: true } } });
    expect(response.content[0]?.text).not.toContain('stack');
  });

  it('does not impose a default 90-second response cutoff on long-running tools', async () => {
    vi.useFakeTimers();
    const services: McpApplicationServices = {
      search: {
        async searchText() {
          await new Promise((resolve) => setTimeout(resolve, 95_000));
          return ok({ matches: [], truncated: false });
        },
        async searchFiles() {
          return ok({ paths: [], truncated: false });
        },
      },
    };
    const registry = new ToolRegistry(services, actor);
    let settled = false;
    const pending = registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'slow-but-valid' });
    void pending.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(90_001);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4_999);
    await expect(pending).resolves.toMatchObject({ structuredContent: { matches: [], truncated: false } });
  });

  it('returns a recoverable timeout before a slow tool can outlive the MCP response budget', async () => {
    const services: McpApplicationServices = {
      search: {
        async searchText() {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return ok({ matches: [], truncated: false });
        },
        async searchFiles() {
          return ok({ paths: [], truncated: false });
        },
      },
    };
    const registry = new ToolRegistry(services, actor, { maxToolDurationMs: 10 });

    const started = Date.now();
    const response = await registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'slow' });

    expect(Date.now() - started).toBeLessThan(70);
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'PROCESS_TIMEOUT', recoverable: true } },
    });
  });

  it('aborts a timed-out invocation before allowing the next MCP call to succeed', async () => {
    let firstInvocationAborted = false;
    const services: McpApplicationServices = {
      search: {
        async searchText(_actor, _workspaceId, request, signal) {
          if (request.query === 'fast') return ok({ matches: [], truncated: false });
          return new Promise<ReturnType<typeof ok>>((resolve) => {
            signal?.addEventListener('abort', () => {
              firstInvocationAborted = true;
              resolve(ok({ matches: [], truncated: true }));
            }, { once: true });
          });
        },
        async searchFiles() {
          return ok({ paths: [], truncated: false });
        },
      },
    };
    const registry = new ToolRegistry(services, actor, { maxToolDurationMs: 15 });

    await expect(registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'slow' })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'PROCESS_TIMEOUT', recoverable: true } },
    });
    expect(firstInvocationAborted).toBe(true);

    const followUp = await registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'fast' });
    expect(followUp.isError).not.toBe(true);
    expect(followUp.structuredContent).toMatchObject({ matches: [], truncated: false });
  });

  it('maps thrown application exceptions to INTERNAL_ERROR and sends redacted diagnostics', async () => {
    const diagnostics: unknown[] = [];
    const services: McpApplicationServices = {
      search: {
        async searchText(): Promise<never> {
          throw new Error('Authorization: Bearer secret-token');
        },
        async searchFiles() {
          return ok({ paths: [], truncated: false });
        },
      },
    };

    const response = await new ToolRegistry(services, actor, { diagnostic: (event: unknown): void => { diagnostics.push(event); } })
      .invoke('search_text', { workspaceId: 'workspace-1', query: 'needle' });

    expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: 'INTERNAL_ERROR', message: 'Operation failed' } } });
    expect(response.content[0]?.text).not.toContain('secret-token');
    expect(JSON.stringify(diagnostics)).not.toContain('secret-token');
    expect(diagnostics).toHaveLength(1);
  });

  it('records activity sink events for successful tool calls', async () => {
    const events: Array<{ phase: string; toolName: string; resultCode: string }> = [];
    const services: McpApplicationServices = {
      file: {
        async readFile() {
          return ok({ path: 'src\\file.ts', content: 'hello', truncated: false });
        },
        async readFiles() {
          return ok({ files: [] });
        },
        async writeFile() {
          return ok({ path: 'x' });
        },
        async applyPatch() {
          return ok({ paths: [] });
        },
        async moveFile() {
          return ok({ from: 'a', to: 'b' });
        },
        async copyFile() {
          return ok({ sourcePath: 'a', destinationPath: 'b' });
        },
        async deleteFile() {
          return ok({ path: 'x' });
        },
      },
    };

    const response = await new ToolRegistry(services, actor, {
      activity: {
        async record(event: ActivitySinkEvent): Promise<void> {
          events.push({ phase: event.phase, toolName: event.toolName, resultCode: event.resultCode });
        },
      },
    }).invoke('read_file', { workspaceId: 'workspace-1', path: 'src\\file.ts' });

    expect(response.isError).not.toBe(true);
    expect(events).toEqual([
      { phase: 'started', toolName: 'read_file', resultCode: 'STARTED' },
      { phase: 'completed', toolName: 'read_file', resultCode: 'SUCCESS' },
    ]);
  });

  it('executes tool_batch children through the registry and records each child activity', async () => {
    const events: Array<{ phase: string; toolName: string; resultCode: string }> = [];
    const registry = new ToolRegistry({
      file: {
        async readFile(input): Promise<ReturnType<typeof ok>> {
          return ok({ path: input.path, content: `content:${input.path}`, truncated: false });
        },
      },
    }, actor, {
      activity: {
        async record(event: ActivitySinkEvent): Promise<void> {
          events.push({ phase: event.phase, toolName: event.toolName, resultCode: event.resultCode });
        },
      },
    });

    const response = await registry.invoke('tool_batch', {
      parallel: true,
      calls: [
        { id: 'read-a', tool: 'read_file', arguments: { workspaceId: 'workspace-1', path: 'a.txt' } },
        { id: 'read-b', tool: 'read_file', arguments: { workspaceId: 'workspace-1', path: 'b.txt' } },
      ],
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ summary: { total: 2, succeeded: 2, failed: 0 } });
    expect(events.filter((event) => event.phase === 'started').map((event) => event.toolName)).toEqual([
      'tool_batch', 'read_file', 'read_file',
    ]);
    expect(events.filter((event) => event.phase === 'completed').map((event) => event.toolName).sort()).toEqual([
      'read_file', 'read_file', 'tool_batch',
    ]);
  });

  it('keeps successful batch siblings when one child returns an MCP error', async () => {
    const registry = new ToolRegistry({
      file: {
        async readFile(input): Promise<ReturnType<typeof ok>> {
          return ok({ path: input.path, content: 'ok', truncated: false });
        },
      },
    }, actor);

    const response = await registry.invoke('tool_batch', {
      parallel: true,
      calls: [
        { id: 'good-a', tool: 'read_file', arguments: { workspaceId: 'workspace-1', path: 'a.txt' } },
        { id: 'bad', tool: 'does_not_exist', arguments: {} },
        { id: 'good-b', tool: 'read_file', arguments: { workspaceId: 'workspace-1', path: 'b.txt' } },
      ],
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      summary: { total: 3, succeeded: 2, failed: 1 },
      results: [
        { id: 'good-a', status: 'succeeded' },
        { id: 'bad', status: 'failed', error: { code: 'INVALID_INPUT' } },
        { id: 'good-b', status: 'succeeded' },
      ],
    });
  });
  it('requires explicit confirmation before destructive git commands reach the backend', async () => {
    let executed = 0;
    const registry = new ToolRegistry({
      git: {
        async run(): Promise<ReturnType<typeof ok>> {
          executed += 1;
          return ok({ exitCode: 0, stdout: '', stderr: '' });
        },
      },
    }, actor);

    const blocked = await registry.invoke('git', { workspaceId: 'workspace-1', args: ['reset', '--hard'] });
    expect(blocked).toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    expect(executed).toBe(0);

    const allowed = await registry.invoke('git', { workspaceId: 'workspace-1', args: ['reset', '--hard'], userConfirmed: true });
    expect(allowed.isError).not.toBe(true);
    expect(executed).toBe(1);
  });

  it('allows only scoped delete_file to bypass chat confirmation when the AI delete policy is enabled', async () => {
    let deletes = 0;
    const registry = new ToolRegistry({
      file: {
        async deleteFile(): Promise<ReturnType<typeof ok>> { deletes += 1; return ok(undefined); },
      } as McpApplicationServices['file'],
      capabilities: {
        async execute(): Promise<ReturnType<typeof ok>> { return ok({ ok: true }); },
      },
    }, actor, { allowAiDeleteProvider: (): boolean => true });

    const deleted = await registry.invoke('delete_file', { workspaceId: 'workspace-1', path: 'tmp.txt' });
    expect(deleted.isError).not.toBe(true);
    expect(deletes).toBe(1);
    await expect(registry.invoke('shell', { operation: 'run', executable: 'rm', arguments: ['tmp.txt'] }))
      .resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
  });

  it('allows non-destructive git commands without confirmation', async () => {
    let executed = 0;
    const registry = new ToolRegistry({
      git: {
        async run(): Promise<ReturnType<typeof ok>> {
          executed += 1;
          return ok({ exitCode: 0, stdout: '', stderr: '' });
        },
      },
    }, actor);

    const response = await registry.invoke('git', { workspaceId: 'workspace-1', args: ['status', '--short'] });
    expect(response.isError).not.toBe(true);
    expect(executed).toBe(1);
  });

  it('requires explicit confirmation for remote DELETE, child MCP calls, and destructive shell commands', async () => {
    const calls: string[] = [];
    const registry = new ToolRegistry({
      capabilities: {
        async execute(tool): Promise<ReturnType<typeof ok>> {
          calls.push(tool);
          return ok({ ok: true });
        },
      },
      extensions: {
        async callMcpTool(): Promise<ReturnType<typeof ok>> { calls.push('mcp_call'); return ok({ ok: true }); },
      } as McpApplicationServices['extensions'],
    }, actor);

    await expect(registry.invoke('web_fetch', { url: 'https://example.com/item/1', method: 'DELETE' })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    await expect(registry.invoke('shell', { operation: 'run', executable: 'git', arguments: ['clean', '-fd'] })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    await expect(registry.invoke('mcp_call', { server: 'child', tool: 'delete_file', arguments: { path: 'x' } })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    expect(calls).toEqual([]);

    expect((await registry.invoke('web_fetch', { url: 'https://example.com/item/1', method: 'DELETE', userConfirmed: true })).isError).not.toBe(true);
    expect((await registry.invoke('shell', { operation: 'run', executable: 'git', arguments: ['clean', '-fd'], userConfirmed: true })).isError).not.toBe(true);
    expect((await registry.invoke('mcp_call', { server: 'child', tool: 'delete_file', arguments: { path: 'x' }, userConfirmed: true })).isError).not.toBe(true);
    expect(calls).toEqual(['web_fetch', 'shell', 'mcp_call']);
  });

  it('guards opaque execution and UI side-effect boundaries', async () => {
    const calls: string[] = [];
    const registry = new ToolRegistry({
      capabilities: {
        async execute(tool): Promise<ReturnType<typeof ok>> { calls.push(tool); return ok({ ok: true }); },
      },
      process: {
        async start(): Promise<ReturnType<typeof ok>> { calls.push('process_start'); return ok({ processId: 'p1' }); },
      } as McpApplicationServices['process'],
      codex: {
        async run(): Promise<ReturnType<typeof ok>> { calls.push('codex_run'); return ok({ codexTaskId: 'c1' }); },
      } as McpApplicationServices['codex'],
    }, actor, { codexToolsEnabled: true });

    await expect(registry.invoke('process_start', { workspaceId: 'workspace-1', executable: 'powershell', args: ['-Command', 'Remove-Item x.txt'] })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    for (const command of ['rm', 'del']) {
      await expect(registry.invoke('process_start', { workspaceId: 'workspace-1', executable: 'powershell', args: ['-Command', `${command} x.txt`] })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    }
    await expect(registry.invoke('codex_run', { workspaceId: 'workspace-1', instruction: 'edit the project' })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    await expect(registry.invoke('dom_cdp', { action: 'evaluate', parameters: { expression: 'fetch("/api/item/1", {method:"DELETE"})' } })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    await expect(registry.invoke('accessibility', { action: 'click', parameters: { name: 'button' } })).resolves.toMatchObject({ isError: true, structuredContent: { error: { code: 'PERMISSION_REQUIRED' } } });
    expect(calls).toEqual([]);
  });

});
