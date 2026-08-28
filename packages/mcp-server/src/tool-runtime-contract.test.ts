import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';
import { ToolRegistry } from './tool-registry.js';
import {
  PHASE_5_TO_18_TOOL_RUNTIME_FIXTURES,
  TOOL_RUNTIME_FIXTURES,
  type ToolRuntimeFixture,
} from './tool-runtime-fixtures.js';
import type { McpApplicationServices } from './tools/tool-types.js';

const actor = { clientId: 'runtime-contract-test', clientName: 'runtime-contract-test' };

const PHASE_5_TO_18_TOOL_NAMES = [
  'symbol_search', 'find_definition', 'find_references', 'find_implementations', 'call_hierarchy',
  'import_graph', 'dependency_graph', 'module_graph', 'type_search', 'trace_symbol',
  'context_ranking', 'debug_context', 'review_context', 'change_context', 'symbol_context',
  'test_context', 'dependency_context', 'git_context', 'frontend_context', 'backend_context',
  'route_intent', 'recipe_list', 'recipe_describe', 'recipe_run', 'dry_run', 'review_changes',
  'changed_symbols', 'affected_modules', 'git_history_context', 'git_blame_context',
  'discover_tests', 'run_affected_tests', 'test_failures', 'coverage_context', 'test_history',
  'cache_stats', 'cache_clear', 'cache_invalidate', 'hook_list', 'hook_register', 'hook_remove',
  'skill_match', 'skill_load', 'plugin_install', 'plugin_list', 'plugin_enable', 'plugin_disable',
  'plugin_remove', 'session_context', 'session_checkpoint', 'session_resume', 'session_history',
  'response_mode',
] as const;

function auditedDefinitionNames(registry: ToolRegistry): string[] {
  const upgradeNames = new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name));
  const coreNames = registry.listAll()
    .map((definition) => definition.name)
    .filter((name) => !upgradeNames.has(name));
  return [...coreNames, ...PHASE_5_TO_18_TOOL_NAMES].sort();
}

type ServiceResolver = (method: string, args: readonly unknown[]) => unknown;

function serviceProxy(group: string, calls: string[], resolve: ServiceResolver): object {
  return new Proxy<Record<string, unknown>>({}, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const method = String(property);
        calls.push(`${group}.${method}`);
        return ok(resolve(method, args));
      };
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function successServices(calls: string[]): McpApplicationServices {
  const processSnapshot = {
    processId: 'process-1', executable: 'pnpm.cmd', args: ['typecheck'], cwd: 'E:\\project', state: 'exited',
    startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), exitCode: 0,
  };
  const png = { format: 'png', mime_type: 'image/png', data_base64: 'cG5n', width: 640, height: 480, origin_x: 0, origin_y: 0 };

  return {
    workspaceInfo: serviceProxy('workspaceInfo', calls, (method) => method === 'list'
      ? [{ id: 'workspace-1', path: 'E:\\project' }]
      : { id: 'workspace-1', path: 'E:\\project' }),
    workspaceQuery: serviceProxy('workspaceQuery', calls, () => ({ entries: [] })),
    projectSnapshot: serviceProxy('projectSnapshot', calls, () => ({ workspaceId: 'workspace-1', files: 1 })),
    project: serviceProxy('project', calls, () => ({ kind: 'node', packageManager: 'pnpm' })),
    file: serviceProxy('file', calls, (method, args) => {
      if (method === 'readFile') {
        const request = record(args[2]);
        const filePath = typeof request.path === 'string' ? request.path : 'README.md';
        const startLine = typeof request.startLine === 'number' ? request.startLine : 1;
        const paged = filePath === 'paged.txt';
        const content = paged && startLine === 1 ? 'one\ntwo' : paged ? 'two' : 'export const smoke = true;\n';
        const endLine = paged ? 2 : startLine + Math.max(0, content.split(/\r?\n/).filter(Boolean).length - 1);
        return { path: filePath, content, startLine, endLine, encoding: 'utf8', mimeType: 'text/plain', byteLength: Buffer.byteLength(content) };
      }
      if (method === 'readFiles') return { files: [] };
      if (method === 'listRecoveryItems') return [];
      if (method === 'prepareExternalFileMutation') {
        const request = record(args[2]);
        return { sourcePaths: Array.isArray(request.sourcePaths) ? request.sourcePaths : [], targetPath: typeof request.targetPath === 'string' ? request.targetPath : 'output.tmp' };
      }
      return { executed: true };
    }),
    checkpoint: serviceProxy('checkpoint', calls, (method) => method === 'list' ? [] : { restored: true }),
    search: serviceProxy('search', calls, (method) => method === 'searchText'
      ? { matches: [{ path: 'src/smoke.ts', line: 1, text: 'smoke' }, { path: 'src/second.ts', line: 1, text: 'smoke' }], truncated: false }
      : { paths: ['src/smoke.ts', 'src/second.test.ts'], truncated: false }),
    workspaceIndex: serviceProxy('workspaceIndex', calls, (method) => method === 'status'
      ? { indexed: true, snapshot: { entries: [
        { relativePath: 'src/smoke.ts', kind: 'file', language: 'typescript', isTest: false, symbols: ['smoke'], functions: [], classes: [], interfaces: [], imports: [], exports: [] },
        { relativePath: 'src/second.test.ts', kind: 'file', language: 'typescript', isTest: true, symbols: ['second'], functions: [], classes: [], interfaces: [], imports: [], exports: [] },
      ] } }
      : { executed: true }),
    git: serviceProxy('git', calls, (method) => {
      if (method === 'status') return { entries: [] };
      if (method === 'diff') return { patch: '', truncated: false };
      if (method === 'log') return { commits: [], truncated: false };
      return { exitCode: 0, stdout: '', stderr: '' };
    }),
    process: serviceProxy('process', calls, (method) => {
      if (method === 'list') return [];
      if (method === 'logs') return { entries: [], truncated: false };
      if (method === 'previewProjectCommand') return { executable: 'pnpm.cmd', args: ['test'], cwd: 'E:\\project' };
      if (method === 'stop') return { stopped: true };
      return processSnapshot;
    }),
    codex: serviceProxy('codex', calls, (method) => method === 'list' ? [] : { ...processSnapshot, codexTaskId: 'codex-1' }),
    goals: serviceProxy('goals', calls, (method) => method === 'listGoals' ? [] : { goalId: 'goal-1', status: 'active', acquired: true, leaseToken: 'lease-token' }),
    scheduledContinuations: serviceProxy('scheduledContinuations', calls, () => ({ continuationId: 'continuation-1', status: 'scheduled', version: 1 })),
    extensions: serviceProxy('extensions', calls, (method) => {
      if (method === 'listSkills') return { skills: [] };
      if (method === 'readSkill') return { id: 'skill-1', name: 'Smoke', description: 'Smoke', source: 'workspace', path: 'SKILL.md', content: '# Smoke' };
      if (method === 'listMcpServers') return { servers: [{ name: 'server-1' }] };
      if (method === 'describeMcpServer') return { server: 'server-1', enabled: true, connected: true, tools: [] };
      return { called: true };
    }),
    capabilities: {
      async execute(tool: string, input: unknown) {
        calls.push(`capabilities.${tool}`);
        const request = record(input);
        if (tool === 'accessibility') {
          if (request.action === 'observe') return ok({ elements: [{ element: { name: 'Save', automation_id: 'save', enabled: true, offscreen: false, bounds: { x: 20, y: 30, width: 100, height: 40 } } }] });
          if (request.action === 'find_element') return ok({ element: { name: 'Save', automation_id: 'save', bounds: { x: 20, y: 30, width: 100, height: 40 } } });
          return ok({ executed: true });
        }
        if (tool === 'vision') return ok(png);
        if (tool === 'shell' && request.operation === 'list') return ok({ tasks: [] });
        return ok({ executed: true });
      },
    } as NonNullable<McpApplicationServices['capabilities']>,
  } as unknown as McpApplicationServices;
}

async function executeDefinition(
  registry: ToolRegistry,
  name: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Result<unknown>> {
  const tool = registry.listAll().find((candidate) => candidate.name === name);
  expect(tool, `missing ${name}`).toBeDefined();
  if (tool === undefined) throw new Error(`missing ${name}`);
  const parsed = tool.parse(input);
  expect(parsed, `${name} representative input`).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error(`${name} representative input did not parse`);
  return tool.execute(parsed.value, new AbortController().signal);
}

async function preparedInput(
  registry: ToolRegistry,
  name: string,
  fixture: ToolRuntimeFixture,
): Promise<Readonly<Record<string, unknown>>> {
  switch (fixture.prepare) {
    case 'workspace_context': {
      const result = await executeDefinition(registry, 'workspace_context', { workspaceId: 'workspace-1', query: 'smoke', pageSize: 1 });
      if (!result.ok) throw new Error(result.error.message);
      return { continuationToken: record(result.value).continuationToken };
    }
    case 'workspace_full_scan': {
      const result = await executeDefinition(registry, 'workspace_full_scan', { workspaceId: 'workspace-1', pageSize: 1 });
      if (!result.ok) throw new Error(result.error.message);
      return { continuationToken: record(result.value).continuationToken };
    }
    case 'read_file_page': {
      const result = await executeDefinition(registry, 'read_file_page', { workspaceId: 'workspace-1', path: 'paged.txt', pageSize: 1 });
      if (!result.ok) throw new Error(result.error.message);
      return { continuationToken: record(result.value).continuationToken };
    }
    case 'vision_annotated_capture': {
      const result = await executeDefinition(registry, 'vision_annotated_capture', { workspaceId: 'workspace-1', capture: 'display' });
      if (!result.ok) throw new Error(result.error.message);
      const observation = record(result.value);
      return { workspaceId: 'workspace-1', observationId: observation.observationId, observationHash: observation.observationHash, markId: 'm1', action: 'click', userConfirmed: true };
    }
    case 'hook_register':
      await executeDefinition(registry, 'hook_register', { name: 'runtime-contract', event: 'beforeTool' });
      return fixture.input;
    case 'session_checkpoint':
      await executeDefinition(registry, 'session_checkpoint', { summary: 'prepared checkpoint' });
      return fixture.input;
    case 'cache_seed':
      return fixture.input;
    case undefined:
      return fixture.input;
  }
}

async function cacheGeneration(registry: ToolRegistry): Promise<number> {
  const result = await executeDefinition(registry, 'cache_stats', {});
  if (!result.ok) throw new Error(result.error.message);
  const generation = record(result.value).generation;
  return typeof generation === 'number' ? generation : 0;
}

describe('tool runtime delivery contract', () => {
  it('tracks an exact runtime fixture for every core and phase 5-18 definition', () => {
    const registry = new ToolRegistry({}, actor);
    expect(Object.keys(TOOL_RUNTIME_FIXTURES).sort()).toEqual(auditedDefinitionNames(registry));
    expect(Object.keys(TOOL_RUNTIME_FIXTURES)).toHaveLength(144);
  });

  it('keeps complete inventory separate from currently advertised tools', () => {
    const registry = new ToolRegistry({}, actor);
    const allNames = registry.listAll().map((tool) => tool.name);
    const advertisedNames = registry.list().map((tool) => tool.name);

    expect(allNames).toEqual(expect.arrayContaining([
      'codex_status', 'codex_run', 'codex_task_list', 'codex_task_status', 'codex_task_logs', 'codex_stop',
      'agent_swarm_run',
    ]));
    expect(advertisedNames).not.toContain('codex_status');
    expect(advertisedNames).not.toContain('agent_swarm_run');
  });

  it('assigns an explicit delivery state to every upgrade definition', () => {
    expect(UPGRADE_TOOL_CATALOG.every((entry) => (
      entry.deliveryState === 'operational'
      || entry.deliveryState === 'dependency_gated'
      || entry.deliveryState === 'feature_disabled'
      || entry.deliveryState === 'planned'
    ))).toBe(true);
  });

  it('marks plugin descriptor operations as dependency-gated by the persisted registry', () => {
    const pluginEntries = UPGRADE_TOOL_CATALOG.filter((entry) => entry.phase === 16);
    expect(pluginEntries).toHaveLength(5);
    expect(pluginEntries.every((entry) => entry.deliveryState === 'dependency_gated')).toBe(true);
    expect(pluginEntries.every((entry) => entry.requirements?.includes('configured persisted plugin descriptor registry') === true)).toBe(true);
  });

  it.each(Object.entries(TOOL_RUNTIME_FIXTURES))('%s produces its declared runtime evidence', async (name, fixture) => {
    const calls: string[] = [];
    const registry = new ToolRegistry(successServices(calls), actor, { codexToolsEnabled: true });
    const input = await preparedInput(registry, name, fixture);
    const generationBefore = fixture.prepare === 'cache_seed' ? await cacheGeneration(registry) : undefined;
    const callsBefore = calls.length;
    const result = await executeDefinition(registry, name, input);

    expect(result, `${name} runtime result`).toMatchObject({ ok: true });
    if (!result.ok) return;

    if (fixture.evidence.kind === 'service_dispatch') {
      expect(calls.slice(callsBefore), `${name} returned success without ${fixture.evidence.serviceCall}`).toContain(fixture.evidence.serviceCall);
      return;
    }

    const output = record(result.value);
    if (fixture.evidence.kind === 'truthful_unavailable') {
      expect(output).toMatchObject({
        status: fixture.evidence.unavailableStatus,
        available: false,
        ready: false,
        executed: false,
        requirements: expect.any(Array),
      });
      expect(output.requirements).not.toHaveLength(0);
      expect(calls).toHaveLength(callsBefore);
      return;
    }

    expect(Object.keys(output).length, `${name} returned an empty placeholder`).toBeGreaterThan(0);
    expect(output).not.toHaveProperty('contract');
    if (generationBefore !== undefined) {
      expect(await cacheGeneration(registry)).toBeGreaterThan(generationBefore);
    }
  });

  it.each(Object.entries(PHASE_5_TO_18_TOOL_RUNTIME_FIXTURES).filter(([, fixture]) => fixture.evidence.kind === 'service_dispatch'))(
    '%s reports needs_setup instead of successful placeholder data when its service is absent',
    async (name, fixture) => {
      const registry = new ToolRegistry({}, actor, { codexToolsEnabled: true });
      const result = await executeDefinition(registry, name, fixture.input);
      expect(result).toMatchObject({
        ok: true,
        value: {
          tool: name,
          status: 'needs_setup',
          available: false,
          ready: false,
          executed: false,
          requirements: expect.any(Array),
        },
      });
      if (result.ok) expect(record(result.value).requirements).not.toHaveLength(0);
    },
  );
});
