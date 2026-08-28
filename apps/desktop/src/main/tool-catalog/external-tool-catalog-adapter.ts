import type { ExtensionsService } from '@lnwjud/extensions';
import type { ToolCatalogItem, UiLocale } from '@lnwjud/ipc-contracts';

export async function projectExternalMcpTools(extensions: ExtensionsService, locale: UiLocale): Promise<readonly ToolCatalogItem[]> {
  const listed = await extensions.listMcpServers();
  if (!listed.ok) return [];
  const items: ToolCatalogItem[] = [];
  for (const server of listed.value.servers) {
    if (!server.enabled || server.excluded) continue;
    const described = await extensions.describeMcpServer({ server: server.name });
    if (!described.ok) {
      items.push(serverPlaceholder(server.name, locale, server.connected));
      continue;
    }
    for (const tool of described.value.tools) {
      items.push({
        name: tool.name,
        origin: 'external_mcp',
        serverName: server.name,
        category: 'extensions',
        title: tool.name,
        shortDescription: tool.description || (locale === 'th' ? 'เครื่องมือจาก external MCP' : 'External MCP tool'),
        longDescription: tool.description || (locale === 'th' ? `เครื่องมือจากเซิร์ฟเวอร์ ${server.name}` : `Tool exposed by ${server.name}`),
        declaredPermission: 'UNKNOWN',
        profileDecision: 'UNKNOWN',
        riskMode: 'external_unknown',
        readiness: described.value.connected ? 'unknown' : 'needs_setup',
        stale: false,
        checkedAt: new Date().toISOString(),
        supportsCancel: null,
        supportsDryRun: null,
        requirements: [],
        remediationIds: described.value.connected ? [] : ['connect_external_mcp'],
        inputSchema: normalizeSchema(tool.inputSchema),
        searchText: [tool.name, server.name, tool.description],
      });
    }
  }
  return items;
}

function serverPlaceholder(serverName: string, locale: UiLocale, connected: boolean): ToolCatalogItem {
  return {
    name: `@${serverName}`,
    origin: 'external_mcp',
    serverName,
    category: 'extensions',
    title: serverName,
    shortDescription: locale === 'th' ? 'ไม่สามารถอ่านรายการเครื่องมือจาก external MCP ได้' : 'External MCP tool discovery is unavailable',
    longDescription: locale === 'th' ? 'ตรวจการเชื่อมต่อเซิร์ฟเวอร์แล้วลองใหม่' : 'Check the server connection and re-run discovery.',
    declaredPermission: 'UNKNOWN',
    profileDecision: 'UNKNOWN',
    riskMode: 'external_unknown',
    readiness: connected ? 'unknown' : 'needs_setup',
    stale: false,
    checkedAt: new Date().toISOString(),
    supportsCancel: null,
    supportsDryRun: null,
    requirements: [],
    remediationIds: ['connect_external_mcp'],
    inputSchema: null,
    searchText: [serverName],
  };
}

function normalizeSchema(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
