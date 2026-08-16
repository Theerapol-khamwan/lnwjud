import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FileActor } from '@lnwjud/application';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';

const actor: FileActor = { clientId: 'test', clientName: 'test' };

describe('upgrade runtime', () => {
  it('has deterministic coverage for the roadmap tool catalog', () => {
    expect(UPGRADE_TOOL_CATALOG.length).toBeGreaterThan(100);
    expect(new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name)).size).toBe(UPGRADE_TOOL_CATALOG.length);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'dev_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'handoff_context')).toBe(true);
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
