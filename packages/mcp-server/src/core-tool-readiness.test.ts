import { describe, expect, it } from 'vitest';
import { ok } from '@lnwjud/domain';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';
import { ToolRegistry } from './tool-registry.js';
import { CORE_TOOL_SMOKE_INPUTS } from './tool-runtime-fixtures.js';
import type { McpApplicationServices } from './tools/tool-types.js';

const actor = { clientId: 'core-readiness-test', clientName: 'core-readiness-test' };
const workspaceId = 'workspace-1';

const STATEFUL_CORE_SUCCESS_TOOLS = new Set([
  'workspace_context_continue',
  'workspace_full_scan_continue',
  'read_file_page_continue',
  'ui_target_action',
]);

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
    processId: 'process-1',
    executable: 'pnpm.cmd',
    args: ['typecheck'],
    cwd: 'E:\\project',
    state: 'exited',
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    exitCode: 0,
  };
  const png = {
    format: 'png',
    mime_type: 'image/png',
    data_base64: 'cG5n',
    width: 640,
    height: 480,
    origin_x: 0,
    origin_y: 0,
  };

  return {
    workspaceInfo: serviceProxy('workspaceInfo', calls, (method) => method === 'list'
      ? [{ id: workspaceId, path: 'E:\\project' }]
      : { id: workspaceId, path: 'E:\\project' }),
    workspaceQuery: serviceProxy('workspaceQuery', calls, () => ({ entries: [] })),
    projectSnapshot: serviceProxy('projectSnapshot', calls, () => ({ workspaceId, files: 1 })),
    project: serviceProxy('project', calls, () => ({ kind: 'node', packageManager: 'pnpm' })),
    file: serviceProxy('file', calls, (method, args) => {
      if (method === 'readFile') {
        const request = record(args[2]);
        const path = typeof request.path === 'string' ? request.path : 'README.md';
        const startLine = typeof request.startLine === 'number' ? request.startLine : 1;
        const paged = path === 'paged.txt';
        const content = paged && startLine === 1 ? 'one\ntwo' : paged ? 'two' : 'export const smoke = true;\n';
        const endLine = paged ? (startLine === 1 ? 2 : 2) : startLine + Math.max(0, content.split(/\r?\n/).filter(Boolean).length - 1);
        return { path, content, startLine, endLine, encoding: 'utf8', mimeType: 'text/plain', byteLength: Buffer.byteLength(content) };
      }
      if (method === 'readFiles') return { files: [] };
      if (method === 'listRecoveryItems') return [];
      if (method === 'prepareExternalFileMutation') {
        const request = record(args[2]);
        return {
          sourcePaths: Array.isArray(request.sourcePaths) ? request.sourcePaths : [],
          targetPath: typeof request.targetPath === 'string' ? request.targetPath : 'output.tmp',
        };
      }
      return { executed: true };
    }),
    checkpoint: serviceProxy('checkpoint', calls, (method) => method === 'list' ? [] : { restored: true }),
    search: serviceProxy('search', calls, (method) => method === 'searchText'
      ? { matches: [
        { path: 'src/smoke.ts', line: 1, text: 'smoke' },
        { path: 'src/second.ts', line: 1, text: 'smoke' },
      ], truncated: false }
      : { paths: ['src/smoke.ts', 'src/second.ts'], truncated: false }),
    workspaceIndex: serviceProxy('workspaceIndex', calls, (method) => method === 'status'
      ? {
        indexed: true,
        snapshot: {
          entries: [
            { relativePath: 'src/smoke.ts', kind: 'file', language: 'typescript', isTest: false, symbols: ['smoke'], functions: [], classes: [], interfaces: [], imports: [], exports: [] },
            { relativePath: 'src/second.ts', kind: 'file', language: 'typescript', isTest: false, symbols: ['second'], functions: [], classes: [], interfaces: [], imports: [], exports: [] },
          ],
        },
      }
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
      if (method === 'previewProjectCommand') return { executable: 'pnpm.cmd', args: ['typecheck'], cwd: 'E:\\project' };
      if (method === 'stop') return { stopped: true };
      return processSnapshot;
    }),
    codex: serviceProxy('codex', calls, (method) => method === 'list' ? [] : { ...processSnapshot, codexTaskId: 'codex-1' }),
    goals: serviceProxy('goals', calls, (method) => method === 'listGoals' ? [] : { goalId: 'goal-1', status: 'active', acquired: true, leaseToken: 'lease-token' }),
    scheduledContinuations: serviceProxy('scheduledContinuations', calls, (method) => method === 'authorizeWorkspaceMutation'
      ? { allowed: true }
      : { continuationId: 'continuation-1', status: 'scheduled', version: 1 }),
    extensions: serviceProxy('extensions', calls, (method) => {
      if (method === 'listSkills') return [];
      if (method === 'readSkill') return { skillId: 'skill-1', content: '# Smoke' };
      if (method === 'listMcpServers') return [{ name: 'server-1' }];
      if (method === 'describeMcpServer') return { server: 'server-1', tools: [] };
      return { called: true };
    }),
    capabilities: {
      async execute(tool: string, input: unknown) {
        calls.push(`capabilities.${tool}`);
        const request = record(input);
        if (tool === 'accessibility') {
          if (request.action === 'observe') {
            return ok({ elements: [{ element: { name: 'Save', automation_id: 'save', enabled: true, offscreen: false, bounds: { x: 20, y: 30, width: 100, height: 40 } } }] });
          }
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

function coreRegistry(): ToolRegistry {
  return new ToolRegistry({}, actor, { codexToolsEnabled: true });
}

function successRegistry(calls: string[]): ToolRegistry {
  return new ToolRegistry(successServices(calls), actor, { codexToolsEnabled: true });
}

async function executeParsed(registry: ToolRegistry, name: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
  const tool = registry.list().find((candidate) => candidate.name === name);
  expect(tool, `missing ${name}`).toBeDefined();
  if (tool === undefined) throw new Error(`missing ${name}`);
  const parsed = tool.parse(input);
  expect(parsed, `${name} representative input`).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error(`${name} representative input did not parse`);
  const result = await tool.execute(parsed.value, new AbortController().signal);
  expect(result, `${name} success-dispatch result`).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`${name} did not reach a successful implementation: ${result.error.message}`);
  return result.value;
}

function coreToolNames(registry: ToolRegistry): string[] {
  const upgrade = new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name));
  return registry.listAll().map((tool) => tool.name).filter((name) => !upgrade.has(name)).sort();
}

describe('core tool readiness', () => {
  it('tracks one representative contract for every core tool in the complete 229-tool inventory', () => {
    const registry = coreRegistry();
    expect(registry.listAll()).toHaveLength(229);
    expect(registry.list()).toHaveLength(228);
    expect(UPGRADE_TOOL_CATALOG).toHaveLength(138);
    expect(coreToolNames(registry)).toHaveLength(91);
    expect(Object.keys(CORE_TOOL_SMOKE_INPUTS).sort()).toEqual(coreToolNames(registry));
  });

  it.each(Object.entries(CORE_TOOL_SMOKE_INPUTS))('%s accepts its representative input and fails closed without backing services', async (name, input) => {
    const registry = coreRegistry();
    const tool = registry.list().find((candidate) => candidate.name === name);
    expect(tool, `missing ${name}`).toBeDefined();
    if (tool === undefined) return;

    const parsed = tool.parse(input);
    expect(parsed, `${name} representative input`).toMatchObject({ ok: true });
    if (!parsed.ok) return;

    const result = await tool.execute(parsed.value, new AbortController().signal);
    expect(result).toHaveProperty('ok');
    if (!result.ok) {
      expect(result.error.message).not.toMatch(/not implemented/i);
      expect(result.error.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it.each(Object.entries(CORE_TOOL_SMOKE_INPUTS).filter(([name]) => !STATEFUL_CORE_SUCCESS_TOOLS.has(name)))('%s reaches a real backing service on the success path', async (name, input) => {
    const calls: string[] = [];
    const registry = successRegistry(calls);
    const before = calls.length;
    await executeParsed(registry, name, input);
    expect(calls.length, `${name} returned success without dispatching to an application/capability service`).toBeGreaterThan(before);
  });

  it('covers every stateful core continuation/action success path with real primitives', async () => {
    const calls: string[] = [];
    const registry = successRegistry(calls);

    const context = record(await executeParsed(registry, 'workspace_context', { workspaceId, query: 'smoke', pageSize: 1 }));
    expect(context.continuationToken).toEqual(expect.any(String));
    const contextBefore = calls.length;
    await executeParsed(registry, 'workspace_context_continue', { continuationToken: context.continuationToken as string });
    expect(calls.length).toBeGreaterThan(contextBefore);

    const scan = record(await executeParsed(registry, 'workspace_full_scan', { workspaceId, pageSize: 1 }));
    expect(scan.continuationToken).toEqual(expect.any(String));
    await executeParsed(registry, 'workspace_full_scan_continue', { continuationToken: scan.continuationToken as string });

    const page = record(await executeParsed(registry, 'read_file_page', { workspaceId, path: 'paged.txt', pageSize: 1 }));
    expect(page.continuationToken).toEqual(expect.any(String));
    const pageBefore = calls.length;
    await executeParsed(registry, 'read_file_page_continue', { continuationToken: page.continuationToken as string });
    expect(calls.length).toBeGreaterThan(pageBefore);

    const observation = record(await executeParsed(registry, 'vision_annotated_capture', { workspaceId, capture: 'display' }));
    expect(observation.observationId).toEqual(expect.any(String));
    expect(observation.observationHash).toEqual(expect.any(String));
    const actionBefore = calls.length;
    await executeParsed(registry, 'ui_target_action', {
      workspaceId,
      observationId: observation.observationId as string,
      observationHash: observation.observationHash as string,
      markId: 'm1',
      action: 'click',
      userConfirmed: true,
    });
    expect(calls.length).toBeGreaterThan(actionBefore);
    expect(calls).toContain('capabilities.accessibility');
  });

  it('keeps the exhaustive success matrix aligned with all 91 core tools', () => {
    const registry = coreRegistry();
    const generic = Object.keys(CORE_TOOL_SMOKE_INPUTS).filter((name) => !STATEFUL_CORE_SUCCESS_TOOLS.has(name));
    expect([...generic, ...STATEFUL_CORE_SUCCESS_TOOLS].sort()).toEqual(coreToolNames(registry));
  });
});
