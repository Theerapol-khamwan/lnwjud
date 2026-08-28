import type { ToolRuntimeEvidence } from './tool-delivery-contract.js';

export type ToolRuntimePreparation =
  | 'workspace_context'
  | 'workspace_full_scan'
  | 'read_file_page'
  | 'vision_annotated_capture'
  | 'cache_seed'
  | 'hook_register'
  | 'session_checkpoint';

export interface ToolRuntimeFixture {
  readonly input: Readonly<Record<string, unknown>>;
  readonly evidence: ToolRuntimeEvidence;
  readonly prepare?: ToolRuntimePreparation;
}

const workspaceId = 'workspace-1';
const zeroUuid = '00000000-0000-0000-0000-000000000000';

const service = (
  input: Readonly<Record<string, unknown>>,
  serviceCall: string,
  prepare?: ToolRuntimePreparation,
): ToolRuntimeFixture => ({ input, evidence: { kind: 'service_dispatch', serviceCall }, ...(prepare === undefined ? {} : { prepare }) });

const deterministic = (
  input: Readonly<Record<string, unknown>>,
  prepare?: ToolRuntimePreparation,
): ToolRuntimeFixture => ({ input, evidence: { kind: 'deterministic_operation' }, ...(prepare === undefined ? {} : { prepare }) });

const unavailable = (
  input: Readonly<Record<string, unknown>>,
  unavailableStatus: 'needs_setup' | 'disabled' | 'unsupported' = 'needs_setup',
): ToolRuntimeFixture => ({ input, evidence: { kind: 'truthful_unavailable', unavailableStatus } });

/**
 * Safe parse-valid inputs and expected delivery evidence for the 91 core tools.
 * These are non-production fixtures: they use controlled workspace IDs, dry-run
 * inputs where available, and never point at a real user path.
 */
export const CORE_TOOL_RUNTIME_FIXTURES = {
  workspace_list: service({}, 'workspaceInfo.list'),
  workspace_register: service({ path: 'E:\\project' }, 'workspaceInfo.register'),
  workspace_info: service({ workspaceId }, 'workspaceInfo.info'),
  workspace_tree: service({}, 'workspaceQuery.tree'),
  project_snapshot: service({ workspaceId }, 'projectSnapshot.snapshot'),
  read_file: service({ workspaceId, path: 'README.md' }, 'file.readFile'),
  read_files: service({ workspaceId, files: [{ path: 'README.md' }] }, 'file.readFiles'),
  search_files: service({ workspaceId }, 'search.searchFiles'),
  search_text: service({ workspaceId, query: 'needle' }, 'search.searchText'),
  git_status: service({ workspaceId }, 'git.status'),
  git_diff: service({ workspaceId }, 'git.diff'),
  git_log: service({ workspaceId }, 'git.log'),
  git: service({ workspaceId, args: ['status', '--short'] }, 'git.run'),
  write_file: service({ workspaceId, path: 'tmp-smoke.txt', content: 'smoke' }, 'file.writeFile'),
  apply_patch: service({ workspaceId, files: [{ path: 'tmp-smoke.txt', content: 'smoke' }] }, 'file.applyPatch'),
  edit_file: service({ workspaceId, path: 'tmp-smoke.txt', oldText: 'before', newText: 'after' }, 'file.editFile'),
  move_file: service({ workspaceId, sourcePath: 'from.txt', destinationPath: 'to.txt' }, 'file.moveFile'),
  copy_file: service({ workspaceId, sourcePath: 'from.txt', destinationPath: 'to.txt' }, 'file.copyFile'),
  delete_file: service({ workspaceId, path: 'tmp-smoke.txt', userConfirmed: true }, 'file.deleteFile'),
  list_recovery_items: service({ workspaceId }, 'file.listRecoveryItems'),
  restore_deleted_file: service({ workspaceId, recoveryId: zeroUuid, userConfirmed: true }, 'file.restoreDeletedFile'),
  list_checkpoints: service({ workspaceId }, 'checkpoint.list'),
  restore_checkpoint: service({ workspaceId, checkpointId: zeroUuid, userConfirmed: true }, 'checkpoint.restore'),
  process_start: service({ workspaceId, executable: 'node.exe', args: ['--version'] }, 'process.start'),
  process_list: service({ workspaceId }, 'process.list'),
  process_status: service({ workspaceId, processId: 'process-1' }, 'process.status'),
  process_logs: service({ workspaceId, processId: 'process-1' }, 'process.logs'),
  process_stop: service({ workspaceId, processId: 'process-1', userConfirmed: true }, 'process.stop'),
  project_dev: service({ workspaceId, userConfirmed: true }, 'process.startProjectCommand'),
  project_test: service({ workspaceId, userConfirmed: true }, 'process.startProjectCommand'),
  project_lint: service({ workspaceId, userConfirmed: true }, 'process.startProjectCommand'),
  project_typecheck: service({ workspaceId, userConfirmed: true }, 'process.startProjectCommand'),
  project_build: service({ workspaceId, userConfirmed: true }, 'process.startProjectCommand'),
  codex_status: service({}, 'codex.status'),
  codex_run: service({ workspaceId, instruction: 'read-only smoke', userConfirmed: true }, 'codex.run'),
  codex_task_list: service({ workspaceId }, 'codex.list'),
  codex_task_status: service({ workspaceId, codexTaskId: 'codex-1' }, 'codex.taskStatus'),
  codex_task_logs: service({ workspaceId, codexTaskId: 'codex-1' }, 'codex.taskLogs'),
  codex_stop: service({ workspaceId, codexTaskId: 'codex-1', userConfirmed: true }, 'codex.stop'),
  shell: service({ workspaceId, operation: 'list' }, 'capabilities.shell'),
  dom_cdp: service({ action: 'status' }, 'capabilities.dom_cdp'),
  computer_use: service({ workspaceId, action: 'inspect' }, 'capabilities.accessibility'),
  accessibility: service({ action: 'status' }, 'capabilities.accessibility'),
  input_event: service({ operation: 'release_all', userConfirmed: true }, 'capabilities.input_event'),
  vision: service({ action: 'capture_display', dry_run: true }, 'capabilities.vision'),
  vision_annotated_capture: service({ workspaceId, capture: 'display' }, 'capabilities.vision'),
  ui_target_action: service({ workspaceId, observationId: 'observation-1', markId: 'm1', dry_run: true }, 'capabilities.accessibility', 'vision_annotated_capture'),
  window: service({ operation: 'list' }, 'capabilities.window'),
  health: service({}, 'capabilities.health'),
  system_info: service({}, 'capabilities.system_info'),
  notification: service({ title: 'Smoke', message: 'Readiness check', dry_run: true }, 'capabilities.notification'),
  file_dialog: service({ action: 'open', dry_run: true }, 'capabilities.file_dialog'),
  clipboard: service({ action: 'get_text' }, 'capabilities.clipboard'),
  web_fetch: service({ url: 'https://example.com', method: 'GET', dry_run: true }, 'capabilities.web_fetch'),
  audio: service({ action: 'stop', dry_run: true }, 'capabilities.audio'),
  screen_record: service({ action: 'status' }, 'capabilities.screen_record'),
  office: service({ app: 'outlook', action: 'list_folders' }, 'capabilities.office'),
  scheduler: service({ action: 'list' }, 'capabilities.scheduler'),
  wsl_exec: service({ workspaceId, operation: 'run', executable: 'printf', arguments: ['smoke'], dry_run: true }, 'capabilities.wsl_exec'),
  wsl_fs: service({ operation: 'status' }, 'capabilities.wsl_fs'),
  skills_list: service({}, 'extensions.listSkills'),
  skills_read: service({ skillId: 'skill-1' }, 'extensions.readSkill'),
  mcp_list: service({}, 'extensions.listMcpServers'),
  mcp_describe: service({ server: 'server-1' }, 'extensions.describeMcpServer'),
  mcp_call: service({ server: 'server-1', tool: 'noop', arguments: {}, userConfirmed: true }, 'extensions.callMcpTool'),
  workspace_context: service({ workspaceId, query: 'smoke' }, 'search.searchText'),
  workspace_context_continue: service({ continuationToken: 'context-token' }, 'file.readFile', 'workspace_context'),
  workspace_full_scan: service({ workspaceId }, 'search.searchFiles'),
  workspace_full_scan_continue: deterministic({ continuationToken: 'scan-token' }, 'workspace_full_scan'),
  workspace_snapshot: service({ workspaceId }, 'projectSnapshot.snapshot'),
  search_all: service({ workspaceId, query: 'smoke' }, 'search.searchText'),
  read_many_files: service({ workspaceId, files: [{ path: 'README.md' }] }, 'file.readFile'),
  read_file_page: service({ workspaceId, path: 'README.md' }, 'file.readFile'),
  read_file_page_continue: service({ continuationToken: 'page-token' }, 'file.readFile', 'read_file_page'),
  workspace_index: service({ workspaceId }, 'workspaceIndex.indexWorkspace'),
  workspace_index_status: service({ workspaceId }, 'workspaceIndex.status'),
  workspace_index_watch: service({ workspaceId }, 'workspaceIndex.startWatch'),
  workspace_index_stop: service({ workspaceId }, 'workspaceIndex.stopWatch'),
  session_handoff: service({ workspaceId }, 'file.readFile'),
  verify_incremental: service({ workspaceId, userConfirmed: true }, 'git.status'),
  run_goal: service({ workspaceId, goalKey: 'smoke-goal', objective: 'Smoke durable goal contract' }, 'goals.runGoal'),
  get_goal: service({ goalId: 'goal-1' }, 'goals.getGoal'),
  checkpoint_goal: service({
    goalId: 'goal-1', leaseToken: 'lease-token', expectedRevision: 0, currentPhase: 'smoke', summary: 'smoke',
    stepUpdates: [], nextAction: '', blockers: [], evidence: [], activeTaskIds: [],
  }, 'goals.checkpointGoal'),
  finish_goal: service({ goalId: 'goal-1', leaseToken: 'lease-token', expectedRevision: 0, status: 'completed', summary: 'smoke', evidence: [] }, 'goals.finishGoal'),
  list_goals: service({}, 'goals.listGoals'),
  prepare_scheduled_continuation: service({
    goalId: 'goal-1', leaseToken: 'lease-token', expectedRevision: 0, currentPhase: 'smoke', summary: 'smoke',
    stepUpdates: [], nextAction: 'continue smoke', blockers: [], evidence: [], activeTaskIds: [], successorDelayMinutes: 25, executionPreference: 'cloud',
  }, 'scheduledContinuations.prepareScheduledContinuation'),
  record_scheduled_continuation_receipt: service({ continuationId: 'continuation-1', expectedVersion: 0, outcome: 'create_failed' }, 'scheduledContinuations.recordScheduledContinuationReceipt'),
  claim_scheduled_continuation: service({ continuationId: 'continuation-1' }, 'scheduledContinuations.claimScheduledContinuation'),
  get_scheduled_continuation: service({ continuationId: 'continuation-1' }, 'scheduledContinuations.getScheduledContinuation'),
  expedite_scheduled_continuation: service({
    goalId: 'goal-1', continuationId: 'continuation-1', leaseToken: 'lease-token',
    expectedLeaseGeneration: 1, expectedGoalRevision: 1, expectedContinuationVersion: 1,
    reason: 'host_budget_warning',
  }, 'scheduledContinuations.expediteScheduledContinuation'),
  tool_batch: service({ calls: [{ id: 'readiness-child', tool: 'workspace_list', arguments: {} }] }, 'workspaceInfo.list'),
} as const satisfies Readonly<Record<string, ToolRuntimeFixture>>;

/** Runtime fixtures for the exact 53 upgrade definitions delivered in phases 5-18. */
export const PHASE_5_TO_18_TOOL_RUNTIME_FIXTURES = {
  symbol_search: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  find_definition: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  find_references: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  find_implementations: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  call_hierarchy: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  import_graph: service({ workspaceId, path: 'src/smoke.ts' }, 'workspaceIndex.status'),
  dependency_graph: service({ workspaceId, path: 'src/smoke.ts' }, 'workspaceIndex.status'),
  module_graph: service({ workspaceId, path: 'src/smoke.ts' }, 'workspaceIndex.status'),
  type_search: service({ workspaceId, query: 'Smoke' }, 'workspaceIndex.status'),
  trace_symbol: service({ workspaceId, symbol: 'smoke' }, 'workspaceIndex.status'),
  context_ranking: deterministic({ query: 'smoke' }),
  debug_context: service({ workspaceId, query: 'smoke failure' }, 'git.status'),
  review_context: service({ workspaceId, query: 'review smoke' }, 'git.status'),
  change_context: service({ workspaceId, query: 'changed smoke' }, 'git.status'),
  symbol_context: service({ workspaceId, query: 'smoke' }, 'git.status'),
  test_context: service({ workspaceId, query: 'smoke test' }, 'git.status'),
  dependency_context: service({ workspaceId, path: 'src/smoke.ts' }, 'workspaceIndex.status'),
  git_context: service({ workspaceId, query: 'smoke' }, 'git.status'),
  frontend_context: service({ workspaceId, query: 'component smoke' }, 'git.status'),
  backend_context: service({ workspaceId, query: 'service smoke' }, 'git.status'),
  route_intent: deterministic({ prompt: 'debug the smoke failure' }),
  recipe_list: deterministic({}),
  recipe_describe: deterministic({ name: 'bugfix' }),
  recipe_run: deterministic({ prompt: 'debug a smoke failure', dryRun: true }),
  dry_run: deterministic({ prompt: 'build the smoke project' }),
  review_changes: service({ workspaceId }, 'git.status'),
  changed_symbols: service({ workspaceId, query: 'smoke' }, 'workspaceIndex.status'),
  affected_modules: service({ workspaceId }, 'git.status'),
  git_history_context: service({ workspaceId }, 'git.log'),
  git_blame_context: service({ workspaceId, path: 'src/smoke.ts' }, 'git.run'),
  discover_tests: service({ workspaceId }, 'workspaceIndex.status'),
  run_affected_tests: service({ workspaceId, dryRun: true }, 'process.previewProjectCommand'),
  test_failures: service({ workspaceId }, 'process.list'),
  coverage_context: service({ workspaceId }, 'search.searchFiles'),
  test_history: service({ workspaceId }, 'process.list'),
  cache_stats: deterministic({}),
  cache_clear: deterministic({}, 'cache_seed'),
  cache_invalidate: deterministic({ path: 'src/smoke.ts' }, 'cache_seed'),
  hook_list: deterministic({}, 'hook_register'),
  hook_register: deterministic({ name: 'runtime-contract', event: 'beforeTool' }),
  hook_remove: deterministic({ name: 'runtime-contract', userConfirmed: true }, 'hook_register'),
  skill_match: service({ query: 'smoke', source: 'workspace' }, 'extensions.listSkills'),
  skill_load: service({ skillId: 'skill-1' }, 'extensions.readSkill'),
  plugin_install: unavailable({ name: 'safe-plugin' }),
  plugin_list: unavailable({}),
  plugin_enable: unavailable({ name: 'safe-plugin' }),
  plugin_disable: unavailable({ name: 'safe-plugin' }),
  plugin_remove: unavailable({ name: 'safe-plugin', userConfirmed: true }),
  session_context: deterministic({}, 'session_checkpoint'),
  session_checkpoint: deterministic({ summary: 'runtime contract checkpoint' }),
  session_resume: deterministic({}, 'session_checkpoint'),
  session_history: deterministic({}, 'session_checkpoint'),
  response_mode: deterministic({ mode: 'compact' }),
} as const satisfies Readonly<Record<string, ToolRuntimeFixture>>;

export const TOOL_RUNTIME_FIXTURES: Readonly<Record<string, ToolRuntimeFixture>> = Object.freeze({
  ...CORE_TOOL_RUNTIME_FIXTURES,
  ...PHASE_5_TO_18_TOOL_RUNTIME_FIXTURES,
});

export const CORE_TOOL_SMOKE_INPUTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze(
  Object.fromEntries(Object.entries(CORE_TOOL_RUNTIME_FIXTURES).map(([name, fixture]) => [name, fixture.input])),
);
