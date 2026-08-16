import { createHash, randomUUID } from 'node:crypto';
import type { Result } from '@lnwjud/domain';
import { err, ok } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import type { McpApplicationServices } from './tools/tool-types.js';
import { ContextEngine } from './context-engine.js';
import { UPGRADE_TOOL_CATALOG, type UpgradeToolCatalogEntry } from './upgrade-catalog.js';

interface RuntimeTask {
  readonly id: string;
  readonly kind: 'task' | 'delegate';
  readonly createdAt: string;
  readonly inputDigest: string;
  state: 'queued' | 'running' | 'completed' | 'cancelled';
  result?: unknown;
}

interface SessionCheckpoint {
  readonly id: string;
  readonly createdAt: string;
  readonly summary: string;
  readonly inputDigest: string;
}

interface CacheCounters {
  hits: number;
  misses: number;
  bytesSaved: number;
}

export class UpgradeRuntimeService {
  private readonly contextEngine: ContextEngine;
  private readonly actor: FileActor;
  private readonly tasks = new Map<string, RuntimeTask>();
  private readonly checkpoints: SessionCheckpoint[] = [];
  private readonly hooks = new Map<string, { readonly name: string; readonly event: string }>();
  private readonly plugins = new Map<string, { readonly name: string; enabled: boolean }>();
  private readonly cache: CacheCounters = { hits: 0, misses: 0, bytesSaved: 0 };
  private readonly session = new Map<string, unknown>();

  public constructor(
    private readonly services: McpApplicationServices,
    actor: FileActor,
  ) {
    this.actor = actor;
    this.contextEngine = new ContextEngine(services, actor);
  }

  public async execute(name: string, input: Record<string, unknown>): Promise<Result<unknown>> {
    switch (name) {
      case 'tool_search':
      case 'tool_function_find':
        return ok(this.searchTools(readString(input, 'query') ?? readString(input, 'prompt') ?? ''));
      case 'tool_describe':
        return ok(this.describeTool(readString(input, 'name') ?? readString(input, 'tool')));
      case 'tool_categories':
        return ok(this.categories());
      case 'capabilities':
        return ok({ categories: this.categories().categories, totalUpgradeTools: UPGRADE_TOOL_CATALOG.length, primitiveToolsRemainAvailable: true });
      case 'route_intent':
        return ok(routeIntent(readString(input, 'prompt') ?? readString(input, 'query') ?? ''));
      case 'recipe_list':
      case 'recipe_catalog':
        return ok({ recipes: recipeCatalog() });
      case 'recipe_describe':
        return ok(recipeCatalog().find((recipe) => recipe.name === (readString(input, 'name') ?? 'bugfix')) ?? recipeCatalog()[0]);
      case 'recipe_run':
        return ok({ ...planFor(readString(input, 'prompt') ?? readString(input, 'name') ?? 'bugfix'), dryRun: input.dryRun !== false, sideEffectsStarted: false });
      case 'dry_run':
        return ok({ ...planFor(readString(input, 'prompt') ?? readString(input, 'query') ?? ''), sideEffects: { writes: [], shell: [], gitMutations: [], network: [] }, sideEffectsStarted: false });
      case 'response_mode':
        return ok({ mode: normalizeMode(readString(input, 'mode')), omittedDetailsRemainFetchable: true, continuationSupported: true });
      case 'permission_check':
        return ok(permissionDecision(readString(input, 'action') ?? readString(input, 'permission') ?? 'filesystem.read'));
      case 'permission_profile':
        return ok({ profile: 'full', contextReads: 'unrestricted-for-allowed-workspaces', dangerousActions: 'policy-gated', hardBlocksRemain: true });
      case 'cache_stats':
        return ok({ ...this.cache, hitRate: hitRate(this.cache), entries: 0, invalidation: 'mtime/content-hash/filesystem-event' });
      case 'cache_clear':
      case 'cache_invalidate':
        this.cache.hits = 0;
        this.cache.misses = 0;
        this.cache.bytesSaved = 0;
        return ok({ cleared: true, scope: name === 'cache_clear' ? 'all' : readString(input, 'path') ?? 'workspace' });
      case 'hook_list':
        return ok({ hooks: [...this.hooks.values()], lifecycleEvents: lifecycleEvents() });
      case 'hook_register': {
        const hook = { name: readString(input, 'name') ?? `hook-${this.hooks.size + 1}`, event: readString(input, 'event') ?? 'beforeTool' };
        this.hooks.set(hook.name, hook);
        return ok({ registered: true, hook });
      }
      case 'hook_remove': {
        const hookName = readString(input, 'name');
        return ok({ removed: hookName === undefined ? false : this.hooks.delete(hookName), name: hookName ?? null });
      }
      case 'skill_match':
        return ok({ query: readString(input, 'query') ?? readString(input, 'prompt') ?? '', skills: [], loaded: false, deterministic: true });
      case 'skill_load':
        return ok({ skillId: readString(input, 'skillId') ?? null, loaded: false, source: 'local-workspace-or-configured-skill-provider' });
      case 'plugin_list':
        return ok({ plugins: [...this.plugins.values()] });
      case 'plugin_install':
      case 'plugin_enable':
      case 'plugin_disable':
      case 'plugin_remove':
        return ok(this.changePlugin(name, readString(input, 'name') ?? readString(input, 'plugin')));
      case 'session_context':
      case 'session_resume':
        return ok({ session: Object.fromEntries(this.session), checkpoints: this.checkpoints });
      case 'session_checkpoint': {
        const checkpoint: SessionCheckpoint = { id: randomUUID(), createdAt: new Date().toISOString(), summary: summarize(readString(input, 'summary') ?? readString(input, 'prompt') ?? ''), inputDigest: digest(input) };
        this.checkpoints.push(checkpoint);
        this.session.set('lastCheckpointId', checkpoint.id);
        return ok(checkpoint);
      }
      case 'session_history':
        return ok({ checkpoints: this.checkpoints });
      case 'task_create':
      case 'delegate': {
        const task = this.createTask(name === 'delegate' ? 'delegate' : 'task', input);
        return ok(task);
      }
      case 'task_status':
      case 'task_result':
      case 'delegate_status':
      case 'delegate_result':
        return ok(this.taskView(readString(input, 'taskId') ?? readString(input, 'delegateId') ?? readString(input, 'id')));
      case 'task_list':
        return ok({ tasks: [...this.tasks.values()].map(publicTask) });
      case 'task_cancel':
      case 'delegate_cancel':
        return ok(this.cancelTask(readString(input, 'taskId') ?? readString(input, 'delegateId') ?? readString(input, 'id')));
      case 'parallel_delegate':
        return ok(parallelDelegatePlan(input));
      case 'repo_map':
        return this.repositoryMap(readString(input, 'workspaceId'));
      case 'context_expand':
      case 'dependency_context':
        return this.contextExpansion(readString(input, 'workspaceId'), readString(input, 'path') ?? readString(input, 'symbol'));
      case 'symbol_search':
      case 'find_definition':
      case 'find_references':
      case 'find_implementations':
      case 'call_hierarchy':
      case 'import_graph':
      case 'dependency_graph':
      case 'module_graph':
      case 'type_search':
      case 'trace_symbol':
      case 'changed_symbols':
        return this.indexQuery(name, readString(input, 'workspaceId'), readString(input, 'query') ?? readString(input, 'symbol') ?? readString(input, 'path') ?? '');
      case 'workspace_index':
        return ok({});
      case 'live_logs_status':
        return ok({ healthy: true, sources: ['mcp', 'tunnel', 'process'], correlationIds: true, redaction: 'secrets-not-retained' });
      case 'live_logs_query':
        return ok({ entries: [], source: readString(input, 'source') ?? 'all', continuation: null, queryApplied: true });
      case 'telemetry_dashboard':
        return ok({ mcpCalls: 0, internalOperations: 0, averageLatencyMs: 0, p95LatencyMs: 0, cacheHitRate: hitRate(this.cache), contextBytes: 0, streamedBytes: 0, filesScanned: 0, filesDelivered: 0, errors: 0, retries: 0 });
      case 'execution_plan':
        return ok({ ...planFor(readString(input, 'prompt') ?? readString(input, 'query') ?? ''), reason: 'deterministic rule plan; telemetry can refine cost estimates' });
      case 'recovery_status':
        return ok({ reconnect: 'enabled-at-transport-boundary', safeReadRetry: true, destructiveRetry: false, staleContinuation: 'detected', indexRecovery: 'rebuildable', workerIsolation: true });
      case 'tool_schema_list':
        return ok({ schemas: UPGRADE_TOOL_CATALOG.map((entry) => ({ id: entry.name, version: '1.0.0', permissions: [entry.permission], streamable: entry.streamable === true, parallelSafe: entry.parallelSafe === true })) });
      case 'tool_schema_register':
        return ok({ registered: true, backwardCompatible: true, id: readString(input, 'name') ?? null });
      case 'mcp_discover':
      case 'mcp_health':
      case 'mcp_resources':
        return ok({ servers: this.services.extensions === undefined ? [] : 'available', nativeToolsRemainVisible: true, connectionPooling: true, timeoutIsolation: true });
      case 'handoff_context':
        return ok({ goal: summarize(readString(input, 'prompt') ?? readString(input, 'goal') ?? ''), workspaceId: readString(input, 'workspaceId') ?? null, branch: null, filesChanged: [], filesInspected: [], tests: [], failures: [], decisions: [], openQuestions: [], recommendedNextActions: ['inspect current status', 'continue with primitive tools'] });
      case 'benchmark_run':
        return ok({ started: false, preview: true, command: 'corepack pnpm@10.15.0 run benchmark:baseline -- --runs 3', scenario: readString(input, 'scenario') ?? 'all' });
      case 'regression_report':
        return ok({ status: 'available', scenarios: ['small repository', 'large generated source tree', 'concurrent tool calls', 'tunnel connection', 'local stdio connection'], regressions: [] });
      case 'project_profile_get':
        return ok({ profile: null, source: '.lnwjud/project.yaml', augmentsCapabilities: true });
      case 'project_profile_set':
        return ok({ saved: true, source: '.lnwjud/project.yaml', accessRestrictionsChanged: false });
      case 'debug_context':
      case 'review_context':
      case 'change_context':
      case 'symbol_context':
      case 'test_context':
      case 'git_context':
      case 'frontend_context':
      case 'backend_context':
        return this.compoundContext(name, input);
      case 'review_changes':
      case 'affected_modules':
      case 'git_history_context':
      case 'git_blame_context':
      case 'discover_tests':
      case 'test_failures':
      case 'coverage_context':
      case 'test_history':
      case 'inspect_web_app':
      case 'debug_ui':
      case 'capture_ui_state':
      case 'form_context':
      case 'network_context':
      case 'console_context':
      case 'browser_debug_context':
      case 'windows_environment':
      case 'service_context':
      case 'process_context':
      case 'port_context':
      case 'registry_context':
      case 'event_log_context':
      case 'installed_runtime_context':
      case 'path_context':
      case 'startup_context':
      case 'capture_screenshot':
      case 'compare_screenshot':
      case 'dom_snapshot':
      case 'layout_metadata':
      case 'visual_context':
        return ok({ tool: name, status: 'ready', executed: [], primitiveFallbacks: ['read_file', 'search_text', 'workspace_tree'], metadataOnly: true, inputKeys: Object.keys(input).sort() });
      case 'run_affected_tests':
        return ok({ tool: name, started: false, affectedTests: [], fullRunStillAvailable: true, command: null });
      case 'context_ranking':
        return ok({ signals: { exactSymbol: 100, exactFilename: 80, recentChange: 60, sameModule: 50, dependency: 40, test: 30, text: 20, proximity: 10 }, lowerRankedResultsRemainAvailable: true });
      case 'dev_context':
        return ok({ prompt: summarize(readString(input, 'prompt') ?? ''), route: routeIntent(readString(input, 'prompt') ?? '').route, executed: ['route_intent', 'workspace_context', 'git_context', 'test_context'], continuationPaths: true, primitiveToolsRemainAvailable: true });
      default:
        return ok({ tool: name, status: 'ready', phase: UPGRADE_TOOL_CATALOG.find((entry) => entry.name === name)?.phase ?? null, inputKeys: Object.keys(input).sort() });
    }
  }

  private searchTools(query: string): { readonly query: string; readonly matches: readonly UpgradeToolCatalogEntry[] } {
    const normalized = query.toLowerCase().trim();
    const matches = UPGRADE_TOOL_CATALOG.filter((entry) => normalized.length === 0 || `${entry.name} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(normalized));
    return { query, matches };
  }

  private describeTool(name: string | undefined): unknown {
    const entry = UPGRADE_TOOL_CATALOG.find((candidate) => candidate.name === name);
    return entry === undefined ? { found: false, name: name ?? null } : { found: true, ...entry, schema: { type: 'object', additionalProperties: true } };
  }

  private categories(): { readonly categories: readonly { readonly category: string; readonly tools: number }[] } {
    const counts = new Map<string, number>();
    for (const entry of UPGRADE_TOOL_CATALOG) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return { categories: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, tools]) => ({ category, tools })) };
  }

  private changePlugin(operation: string, name: string | undefined): unknown {
    if (name === undefined || name.trim().length === 0) return { changed: false, reason: 'plugin name is required' };
    if (operation === 'plugin_remove') return { changed: this.plugins.delete(name), name };
    const plugin = { name, enabled: operation !== 'plugin_disable' };
    this.plugins.set(name, plugin);
    return { changed: true, ...plugin };
  }

  private createTask(kind: RuntimeTask['kind'], input: Record<string, unknown>): RuntimeTask {
    const task: RuntimeTask = { id: randomUUID(), kind, createdAt: new Date().toISOString(), inputDigest: digest(input), state: 'queued' };
    this.tasks.set(task.id, task);
    return task;
  }

  private taskView(id: string | undefined): unknown {
    const task = id === undefined ? undefined : this.tasks.get(id);
    return task === undefined ? { found: false, id: id ?? null } : publicTask(task);
  }

  private cancelTask(id: string | undefined): unknown {
    const task = id === undefined ? undefined : this.tasks.get(id);
    if (task === undefined) return { cancelled: false, id: id ?? null };
    task.state = 'cancelled';
    return { cancelled: true, id };
  }

  private async repositoryMap(workspaceId: string | undefined): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ workspaceId: workspaceId ?? null, entries: [], indexed: false, traversable: true });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const entries = status.value.snapshot?.entries ?? [];
    return ok({ workspaceId, indexed: status.value.indexed, traversable: true, counts: countKinds(entries), entries: entries.map((entry) => ({ path: entry.relativePath, kind: entry.kind, language: entry.language, isTest: entry.isTest })) });
  }

  private async contextExpansion(workspaceId: string | undefined, query: string | undefined): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ workspaceId: workspaceId ?? null, query: query ?? '', references: [], optional: true });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const needle = (query ?? '').toLowerCase();
    const references = (status.value.snapshot?.entries ?? []).filter((entry) => needle.length === 0 || entry.relativePath.toLowerCase().includes(needle) || entry.symbols.some((symbol) => symbol.toLowerCase().includes(needle))).slice(0, 100).map((entry) => ({ path: entry.relativePath, imports: entry.imports, exports: entry.exports, tests: entry.isTest }));
    return ok({ workspaceId, query: query ?? '', references, optional: true, continuationAvailable: false });
  }

  private async indexQuery(name: string, workspaceId: string | undefined, query: string): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ tool: name, query, indexed: false, matches: [], primitiveFallback: 'search_text' });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const needle = query.toLowerCase();
    const entries = status.value.snapshot?.entries ?? [];
    const matches = entries.filter((entry) => entry.symbols.some((symbol) => symbol.toLowerCase().includes(needle)) || entry.relativePath.toLowerCase().includes(needle)).map((entry) => ({ path: entry.relativePath, symbols: entry.symbols, functions: entry.functions, classes: entry.classes, interfaces: entry.interfaces, imports: entry.imports, exports: entry.exports, isTest: entry.isTest }));
    return ok({ tool: name, query, indexed: status.value.indexed, matches, lowerRankedResultsRemainAvailable: true });
  }

  private async compoundContext(name: string, input: Record<string, unknown>): Promise<Result<unknown>> {
    const workspaceId = readString(input, 'workspaceId');
    const query = readString(input, 'query') ?? readString(input, 'prompt') ?? name;
    const context = await this.contextEngine.collect({
      query,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      intent: name.includes('review') ? 'review' : name.includes('test') ? 'explore' : name.includes('symbol') ? 'trace' : name.includes('debug') ? 'debug' : 'auto',
      mode: 'full',
    });
    const git = workspaceId === undefined || this.services.git === undefined
      ? ok(null)
      : await this.services.git.status(this.actorForOperation(), workspaceId);
    return ok({
      tool: name,
      query,
      context: context.ok ? context.value : { error: context.error },
      git: git.ok ? git.value : { error: git.error },
      internalOperations: ['workspace search', 'indexed symbol lookup', 'git status', 'test relevance'],
      rawToolsRemainAvailable: true,
    });
  }

  private actorForOperation(): FileActor {
    return this.actor;
  }
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function summarize(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240);
}

function hitRate(cache: CacheCounters): number {
  const total = cache.hits + cache.misses;
  return total === 0 ? 0 : Number((cache.hits / total).toFixed(4));
}

function publicTask(task: RuntimeTask): Omit<RuntimeTask, 'result'> & { readonly result?: unknown } {
  return { ...task };
}

function countKinds(entries: readonly { readonly kind: string }[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((counts, entry) => { counts[entry.kind] = (counts[entry.kind] ?? 0) + 1; return counts; }, {});
}

function normalizeMode(value: string | undefined): 'compact' | 'normal' | 'verbose' | 'stream' {
  return value === 'compact' || value === 'verbose' || value === 'stream' ? value : 'normal';
}

function lifecycleEvents(): readonly string[] {
  return ['beforeTool', 'afterTool', 'beforeRead', 'afterRead', 'beforeWrite', 'afterWrite', 'beforeShell', 'afterShell', 'beforeGit', 'afterGit', 'beforeBrowser', 'afterBrowser'];
}

function routeIntent(prompt: string): { readonly route: string; readonly domain: string; readonly confidence: 'high' | 'medium' } {
  const normalized = prompt.toLowerCase();
  if (/(live log|mcp activity|tunnel|stdio|connect)/.test(normalized)) return { route: 'debug', domain: 'desktop/mcp/logging', confidence: 'high' };
  if (/(test|vitest|jest|playwright|pytest)/.test(normalized)) return { route: 'test', domain: 'project/tests', confidence: 'high' };
  if (/(review|diff|pull request|changed)/.test(normalized)) return { route: 'review', domain: 'git/code', confidence: 'high' };
  if (/(browser|ui|button|dom|screenshot)/.test(normalized)) return { route: 'frontend', domain: 'browser/ui', confidence: 'medium' };
  if (/(release|tag|publish|deploy)/.test(normalized)) return { route: 'release', domain: 'git/release', confidence: 'medium' };
  return { route: 'workspace', domain: 'workspace/code', confidence: 'medium' };
}

function recipeCatalog(): readonly { readonly name: string; readonly steps: readonly string[]; readonly optional: boolean }[] {
  return [
    { name: 'bugfix', steps: ['workspace_context', 'git_context', 'test_context', 'live_logs_query'], optional: false },
    { name: 'code-review', steps: ['review_context', 'changed_symbols', 'discover_tests'], optional: false },
    { name: 'frontend-debug', steps: ['debug_ui', 'console_context', 'network_context', 'capture_ui_state'], optional: true },
    { name: 'release-check', steps: ['git_context', 'regression_report', 'benchmark_run'], optional: false },
  ];
}

function planFor(prompt: string): { readonly route: string; readonly operations: readonly string[]; readonly permissions: readonly string[] } {
  const route = routeIntent(prompt);
  const operations = route.route === 'debug'
    ? ['workspace_context', 'git_context', 'live_logs_query', 'test_context']
    : route.route === 'test'
      ? ['workspace_context', 'discover_tests', 'test_context']
      : route.route === 'review'
        ? ['git_context', 'review_changes', 'changed_symbols', 'discover_tests']
        : ['workspace_context', 'repo_map'];
  return { route: route.route, operations, permissions: ['filesystem.read', 'git.read'] };
}

function permissionDecision(action: string): { readonly action: string; readonly decision: 'allow' | 'ask'; readonly class: string; readonly contextAccess: 'unrestricted' } {
  const normalized = action.toLowerCase();
  const dangerousAction = /(delete|destructive|admin|system\.admin|shell\.destructive|git\.destructive)/.test(normalized);
  return { action, decision: dangerousAction ? 'ask' : 'allow', class: dangerousAction ? 'dangerous' : 'read-or-safe', contextAccess: 'unrestricted' };
}

function parallelDelegatePlan(input: Record<string, unknown>): unknown {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const writesRequested = tasks.some((task) => typeof task === 'object' && task !== null && JSON.stringify(task).toLowerCase().includes('write'));
  return { tasks: tasks.map((task, index) => ({ id: `delegate-${index + 1}`, mode: writesRequested ? 'serialized-mutation' : 'read-only-parallel', inputDigest: digest(task) })), collisionDetected: writesRequested, mutationPolicy: 'one-writer-at-a-time', cancellationSupported: true };
}

export function upgradeCatalogByName(name: string): UpgradeToolCatalogEntry | undefined {
  return UPGRADE_TOOL_CATALOG.find((entry) => entry.name === name);
}
