export const APP_NAME = 'lnwjud';
export const APP_VERSION = '4.6.0';
export { isUnrestricted, unrestrictedFromEnv, unrestrictedFromSetting, UNRESTRICTED_SETTING_KEY, type ProcessEnvLike } from './unrestricted.js';

export { resolveLnwjudDataPath, type DataPathEnvironment } from './data-path.js';

export { ALLOW_AI_DELETE_SETTING_KEY, STDIO_PERMISSION_PROFILE_SETTING_KEY, STDIO_STRICT_ROOTS_SETTING_KEY, STDIO_ALLOWED_ROOTS_SETTING_KEY, parseAllowedRoots, parseBooleanSetting, parseStdioPermissionProfile, serializeAllowedRoots, type StdioPermissionProfileName } from './agent-policy.js';

export { protectWithWindowsDpapi, unprotectWithWindowsDpapi, loadOrCreateWindowsProtectedKey, loadCheckpointEncryptionKey } from './windows-dpapi.js';
