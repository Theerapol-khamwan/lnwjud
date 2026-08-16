import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';
import { ToolRegistry } from './tool-registry.js';

const actor: FileActor = { clientId: 'test', clientName: 'test' };

describe('upgrade runtime', () => {
  it('has deterministic coverage for the roadmap tool catalog', () => {
    expect(UPGRADE_TOOL_CATALOG.length).toBeGreaterThan(100);
    expect(new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name)).size).toBe(UPGRADE_TOOL_CATALOG.length);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'dev_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'handoff_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'context_economy_stats')).toBe(true);
  });

  it('smoke-invokes every phase tool through the normal registry boundary', async () => {
    const registry = new ToolRegistry({}, actor);
    for (const entry of UPGRADE_TOOL_CATALOG) {
      const response = await registry.invoke(entry.name, {});
      expect(response).toBeDefined();
      expect(response.structuredContent).toBeDefined();
    }
  });

  it('routes prompts and searches capabilities without an LLM', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'Live Logs MCP activity ไม่ขึ้น' });
    expect(route).toMatchObject({ ok: true, value: { route: 'debug', domain: 'desktop/mcp/logging' } });
    const search = await runtime.execute('tool_search', { query: 'postgres schema inspection' });
    expect(search.ok).toBe(true);
    if (search.ok) expect(search.value).toHaveProperty('matches');
  });

  it('keeps context reads unrestricted while asking for dangerous actions', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const read = await runtime.execute('permission_check', { action: 'filesystem.read' });
    const remove = await runtime.execute('permission_check', { action: 'filesystem.delete' });
    expect(read).toMatchObject({ ok: true, value: { decision: 'allow', contextAccess: 'unrestricted' } });
    expect(remove).toMatchObject({ ok: true, value: { decision: 'ask', contextAccess: 'unrestricted' } });
  });

  it('shares context economy telemetry between workspace context and the stats tool', async () => {
    const registry = new ToolRegistry({
      workspaceInfo: { async list(): Promise<ReturnType<typeof ok>> { return ok([{ id: 'workspace-1' }]); } },
      search: {
        async searchText(): Promise<ReturnType<typeof ok>> { return ok({ matches: [{ path: 'src/app.ts', line: 1, text: 'login' }], truncated: false }); },
        async searchFiles(): Promise<ReturnType<typeof ok>> { return ok({ paths: ['src/app.ts'], truncated: false }); },
      },
      file: { async readFile(): Promise<ReturnType<typeof ok>> { return ok({ path: 'src/app.ts', content: 'export function login() {}\n', startLine: 1, endLine: 1, encoding: 'utf8' as const, byteLength: 28 }); } },
      git: { async status(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); } },
    }, actor);

    const context = await registry.invoke('workspace_context', { query: 'login', workspaceId: 'workspace-1' });
    expect(context.isError).not.toBe(true);
    const stats = await registry.invoke('context_economy_stats', {});
    expect(stats.isError).not.toBe(true);
    expect(stats).toMatchObject({ structuredContent: { filesDiscovered: 1, filesDelivered: 1 } });
  });

  it('persists redacted session/task state outside the repository', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-'));
    const statePath = path.join(directory, 'runtime.json');
    const first = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await first.execute('session_checkpoint', { summary: 'inspect logs', token: 'must-not-be-retained' });
    const second = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    const resumed = await second.execute('session_context', {});
    expect(resumed).toMatchObject({ ok: true, value: { checkpoints: [{ summary: 'inspect logs' }] } });
    const task = await second.execute('task_create', { instruction: 'run tests' });
    expect(task).toMatchObject({ ok: true, value: { inputDigest: expect.any(String) } });
  });
});
