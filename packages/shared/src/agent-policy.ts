export const ALLOW_AI_DELETE_SETTING_KEY = 'allow_ai_delete';
export const STDIO_PERMISSION_PROFILE_SETTING_KEY = 'stdio_permission_profile';
export const STDIO_STRICT_ROOTS_SETTING_KEY = 'stdio_strict_roots';
export const STDIO_ALLOWED_ROOTS_SETTING_KEY = 'stdio_allowed_roots';

export type StdioPermissionProfileName = 'safe' | 'balanced' | 'full' | 'custom';

export function parseBooleanSetting(value: string | null | undefined, fallback = false): boolean {
  if (value === null || value === undefined || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function parseStdioPermissionProfile(value: string | null | undefined, fallback: StdioPermissionProfileName = 'full'): StdioPermissionProfileName {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'safe' || normalized === 'balanced' || normalized === 'full' || normalized === 'custom'
    ? normalized
    : fallback;
}

export function parseAllowedRoots(value: string | null | undefined): readonly string[] {
  if (value === null || value === undefined || value.trim().length === 0) return [];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const entry of value.split(/[;\r\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(trimmed);
  }
  return roots;
}

export function serializeAllowedRoots(roots: readonly string[]): string {
  return parseAllowedRoots(roots.join(';')).join(';');
}
