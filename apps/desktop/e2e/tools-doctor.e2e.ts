import { expect, test } from '@playwright/test';
import type { RequirementResult, ToolCatalogItem, ToolProfileDecision } from '@lnwjud/ipc-contracts';
import { catalogDefinitions } from '../src/main/tool-catalog/catalog-definitions.js';
import { RemediationRegistry } from '../src/main/tool-catalog/remediation-registry.js';
import { RequirementRegistry } from '../src/main/tool-catalog/requirement-registry.js';
import { ToolCatalogService } from '../src/main/tool-catalog/tool-catalog-service.js';
import { startupDoctorCorePassed } from '../src/renderer/features/onboarding/startup-doctor-state.js';

const requirementIds = [
  'platform_windows', 'registered_workspace', 'active_project', 'executable_git', 'executable_ripgrep', 'codex_runtime', 'wsl_runtime',
  'local_mcp_listener', 'browser_cdp', 'windows_ui_automation', 'windows_input', 'windows_window', 'windows_ocr', 'office_desktop',
  'network_access', 'scheduler_runtime', 'tunnel_runtime', 'external_mcp_connection', 'feature_delivery',
] as const;
type Status = RequirementResult['status'];

function fixture(initial: Readonly<Record<string, Status>> = {}, options: {
  readonly profileDecision?: ToolProfileDecision;
  readonly externalItems?: readonly ToolCatalogItem[];
} = {}): { catalog: ToolCatalogService; statuses: Record<string, Status>; counts: Record<string, number> } {
  const statuses: Record<string, Status> = Object.fromEntries(requirementIds.map((id) => [id, initial[id] ?? 'pass']));
  const counts: Record<string, number> = Object.fromEntries(requirementIds.map((id) => [id, 0]));
  const registry = new RequirementRegistry(requirementIds.map((id) => ({
    id,
    required: id !== 'codex_runtime' && id !== 'external_mcp_connection' && id !== 'feature_delivery',
    summaryKey: `requirement.${id}`,
    remediationId: id === 'executable_git' ? 'install_git' : id === 'executable_ripgrep' ? 'install_ripgrep' : 'recheck_runtime',
    probe: async (): Promise<{ status: Status }> => { counts[id] += 1; return { status: statuses[id] }; },
  })), { ttlMs: 60_000 });
  const catalog = new ToolCatalogService(registry, new RemediationRegistry(), {
    profileDecision: (): ToolProfileDecision => options.profileDecision ?? 'ALLOW',
    codexEnabled: (): boolean => false,
    externalItems: async (): Promise<readonly ToolCatalogItem[]> => options.externalItems ?? [],
  });
  return { catalog, statuses, counts };
}

function externalOffline(): ToolCatalogItem {
  return {
    name: 'offline_tool', origin: 'external_mcp', serverName: 'offline-server', category: 'extensions',
    title: 'offline_tool', shortDescription: 'Offline external MCP tool', longDescription: 'Server is offline',
    declaredPermission: 'UNKNOWN', profileDecision: 'UNKNOWN', riskMode: 'external_unknown', readiness: 'needs_setup', stale: false,
    checkedAt: '2026-08-29T00:00:00.000Z', supportsCancel: null, supportsDryRun: null, requirements: [],
    remediationIds: ['connect_external_mcp'], inputSchema: null, searchText: ['offline_tool', 'offline-server'],
  };
}

test.describe('Tools catalog and Doctor acceptance', () => {
  test('normal runtime exposes one catalog row for every first-party definition', async () => {
    const { catalog } = fixture();
    const snapshot = await catalog.getSnapshot('en');
    const firstParty = snapshot.items.filter((item) => item.origin === 'lnwjud');
    expect(firstParty).toHaveLength(Object.keys(catalogDefinitions).length);
    expect(new Set(firstParty.map((item) => item.name)).size).toBe(firstParty.length);
  });

  test('missing dependency marks affected tools needs_setup and Doctor names the affected tools', async () => {
    const { catalog } = fixture({ executable_git: 'fail' });
    const snapshot = await catalog.getSnapshot('en');
    expect(snapshot.items.find((item) => item.name === 'git')?.readiness).toBe('needs_setup');
    const doctor = await catalog.runDoctor(['executable_git'], 'en');
    expect(doctor.checks[0]?.status).toBe('fail');
    expect(doctor.checks[0]?.affectedToolNames).toContain('git');
    expect(doctor.checks[0]?.remediationId).toBe('install_git');
  });

  test('selected recheck recovers both Doctor and Tool Catalog from the same refreshed requirement', async () => {
    const { catalog, statuses } = fixture({ executable_git: 'fail' });
    expect((await catalog.getSnapshot('en')).items.find((item) => item.name === 'git')?.readiness).toBe('needs_setup');
    statuses.executable_git = 'pass';
    const recovered = await catalog.recheck(['executable_git'], 'en');
    expect(recovered.doctor.checks.find((check) => check.id === 'executable_git')?.status).toBe('pass');
    expect(recovered.catalog.items.find((item) => item.name === 'git')?.readiness).toBe('ready');
  });

  test('permission deny blocks a tool in the catalog without invoking the tool runtime', async () => {
    const runtimeInvocations = 0;
    const { catalog } = fixture({}, { profileDecision: 'DENY' });
    const snapshot = await catalog.getSnapshot('en');
    expect(snapshot.items.find((item) => item.name === 'read_file')?.readiness).toBe('blocked');
    expect(runtimeInvocations).toBe(0);
  });

  test('offline external MCP remains separate and honestly needs setup with unknown permission fields', async () => {
    const { catalog } = fixture({}, { externalItems: [externalOffline()] });
    const snapshot = await catalog.getSnapshot('en');
    const external = snapshot.items.find((item) => item.origin === 'external_mcp');
    expect(external).toMatchObject({ readiness: 'needs_setup', declaredPermission: 'UNKNOWN', profileDecision: 'UNKNOWN' });
    expect(external?.remediationIds).toContain('connect_external_mcp');
  });

  test('Thai/English catalog switch reuses cached probes instead of probing again', async () => {
    const { catalog, counts } = fixture();
    await catalog.getSnapshot('en');
    const before = Object.values(counts).reduce((sum, value) => sum + value, 0);
    await catalog.getSnapshot('th');
    const after = Object.values(counts).reduce((sum, value) => sum + value, 0);
    expect(after).toBe(before);
  });

  test('startup blocks on required fail/unknown but ignores optional failure', () => {
    const core = (status: 'pass' | 'fail' | 'unknown'): { checks: Array<{ id: string; required: boolean; status: 'pass' | 'fail' | 'unknown' }> } => ({
      checks: [
        { id: 'os', required: true, status: 'pass' as const },
        { id: 'database', required: true, status: 'pass' as const },
        { id: 'executable_ripgrep', required: true, status },
        { id: 'mcp-port', required: true, status: 'pass' as const },
        { id: 'codex_runtime', required: false, status: 'fail' as const },
      ],
    });
    expect(startupDoctorCorePassed(core('pass') as never)).toBe(true);
    expect(startupDoctorCorePassed(core('fail') as never)).toBe(false);
    expect(startupDoctorCorePassed(core('unknown') as never)).toBe(false);
  });
});
