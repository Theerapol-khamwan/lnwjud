export const APP_NAME = 'lnwjud';
export const APP_VERSION = '4.8.1';
export { isUnrestricted, unrestrictedFromEnv, unrestrictedFromSetting, UNRESTRICTED_SETTING_KEY, type ProcessEnvLike } from './unrestricted.js';

export { resolveLnwjudDataPath, type DataPathEnvironment } from './data-path.js';

export { ALLOW_AI_DELETE_SETTING_KEY, STDIO_PERMISSION_PROFILE_SETTING_KEY, STDIO_STRICT_ROOTS_SETTING_KEY, STDIO_ALLOWED_ROOTS_SETTING_KEY, parseAllowedRoots, parseBooleanSetting, parseStdioPermissionProfile, serializeAllowedRoots, type StdioPermissionProfileName } from './agent-policy.js';

export { protectWithWindowsDpapi, unprotectWithWindowsDpapi, loadOrCreateWindowsProtectedKey, loadCheckpointEncryptionKey } from './windows-dpapi.js';

export { USER_SETTING_KEYS, DEFAULT_MCP_CALL_TIMEOUT_MS, DEFAULT_MCP_IDLE_TIMEOUT_MS, DEFAULT_PROCESS_TIMEOUT_MS, DEFAULT_CODEX_TOOLS_ENABLED, DEFAULT_UPDATE_INTERVAL_MINUTES, DEFAULT_TUNNEL_MAX_AUTO_RESTARTS, DEFAULT_CUSTOM_PERMISSION_SETTINGS, parseIntegerSetting, parseCloseBehavior, parsePathList, serializePathList, parseStringRecordSetting, serializeStringRecordSetting, parseCustomPermissionSettings, serializeCustomPermissionSettings, type CloseBehavior, type PermissionDecisionSetting, type CustomPermissionSettings } from './user-settings.js';
