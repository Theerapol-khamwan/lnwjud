export const USER_SETTING_KEYS = Object.freeze({
  customPermissionProfile: 'custom_permission_profile',
  mcpCallTimeoutMs: 'mcp_call_timeout_ms',
  mcpIdleTimeoutMs: 'mcp_idle_timeout_ms',
  processTimeoutMs: 'process_timeout_ms',
  capabilityRoots: 'capability_roots',
  mcpHttpPort: 'mcp_http_port',
  updateAutoCheck: 'update_auto_check',
  updateCheckOnStartup: 'update_check_on_startup',
  updateIntervalMinutes: 'update_interval_minutes',
  updateAutoDownload: 'update_auto_download',
  closeBehavior: 'close_behavior',
  launchAtStartup: 'launch_at_startup',
  startMinimized: 'start_minimized',
  tunnelAutoReconnect: 'tunnel_auto_reconnect',
  tunnelMaxAutoRestarts: 'tunnel_max_auto_restarts',
});

export const DEFAULT_MCP_CALL_TIMEOUT_MS = 60_000;
export const DEFAULT_MCP_IDLE_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_PROCESS_TIMEOUT_MS = 60 * 60_000;
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 30;
export const DEFAULT_TUNNEL_MAX_AUTO_RESTARTS = 5;

export type CloseBehavior = 'tray' | 'quit';
export type PermissionDecisionSetting = 'ALLOW' | 'ASK' | 'DENY';

export interface CustomPermissionSettings {
  readonly read: PermissionDecisionSetting;
  readonly write: PermissionDecisionSetting;
  readonly execute: PermissionDecisionSetting;
  readonly dangerous: PermissionDecisionSetting;
  readonly allowedExecutables: readonly string[];
}

export const DEFAULT_CUSTOM_PERMISSION_SETTINGS: CustomPermissionSettings = Object.freeze({
  read: 'ALLOW',
  write: 'ASK',
  execute: 'ASK',
  dangerous: 'DENY',
  allowedExecutables: Object.freeze([]),
});

export function parseIntegerSetting(value: string | null | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export function parseCloseBehavior(value: string | null | undefined): CloseBehavior {
  return value === 'quit' ? 'quit' : 'tray';
}

export function parsePathList(value: string | null | undefined): readonly string[] {
  if (value === null || value === undefined || value.trim().length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value.split(/[;\r\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function serializePathList(values: readonly string[]): string {
  return parsePathList(values.join(';')).join(';');
}

export function parseCustomPermissionSettings(value: string | null | undefined): CustomPermissionSettings {
  if (value === null || value === undefined || value.trim().length === 0) return DEFAULT_CUSTOM_PERMISSION_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return DEFAULT_CUSTOM_PERMISSION_SETTINGS;
    return {
      read: parseDecision(parsed.read, DEFAULT_CUSTOM_PERMISSION_SETTINGS.read),
      write: parseDecision(parsed.write, DEFAULT_CUSTOM_PERMISSION_SETTINGS.write),
      execute: parseDecision(parsed.execute, DEFAULT_CUSTOM_PERMISSION_SETTINGS.execute),
      dangerous: parseDecision(parsed.dangerous, DEFAULT_CUSTOM_PERMISSION_SETTINGS.dangerous),
      allowedExecutables: Array.isArray(parsed.allowedExecutables)
        ? [...new Set(parsed.allowedExecutables.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim()))]
        : DEFAULT_CUSTOM_PERMISSION_SETTINGS.allowedExecutables,
    };
  } catch {
    return DEFAULT_CUSTOM_PERMISSION_SETTINGS;
  }
}

export function serializeCustomPermissionSettings(value: CustomPermissionSettings): string {
  return JSON.stringify({
    read: parseDecision(value.read, 'ALLOW'),
    write: parseDecision(value.write, 'ASK'),
    execute: parseDecision(value.execute, 'ASK'),
    dangerous: parseDecision(value.dangerous, 'DENY'),
    allowedExecutables: [...new Set(value.allowedExecutables.map((entry) => entry.trim()).filter((entry) => entry.length > 0))],
  });
}

function parseDecision(value: unknown, fallback: PermissionDecisionSetting): PermissionDecisionSetting {
  return value === 'ALLOW' || value === 'ASK' || value === 'DENY' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
