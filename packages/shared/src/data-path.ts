import os from 'node:os';
import path from 'node:path';

export interface DataPathEnvironment {
  readonly LNWJUD_DATA_PATH?: string;
  readonly APPDATA?: string;
  readonly USERPROFILE?: string;
  readonly HOME?: string;
}

/** Resolve the per-user lnwjud data directory without embedding a developer profile path. */
export function resolveLnwjudDataPath(
  environment: DataPathEnvironment = process.env,
  platformDataFallback?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const configured = environment.LNWJUD_DATA_PATH?.trim();
  if (configured) return pathApi.resolve(configured);

  if (platform === 'darwin') {
    const applicationSupport = firstNonEmpty(
      platformDataFallback,
      environment.HOME ? pathApi.join(environment.HOME, 'Library', 'Application Support') : undefined,
      path.join(os.homedir(), 'Library', 'Application Support'),
    );
    return pathApi.resolve(applicationSupport, 'lnwjud');
  }

  const appData = firstNonEmpty(
    environment.APPDATA,
    platformDataFallback,
    environment.USERPROFILE ? pathApi.join(environment.USERPROFILE, 'AppData', 'Roaming') : undefined,
    environment.HOME ? pathApi.join(environment.HOME, 'AppData', 'Roaming') : undefined,
    pathApi.join(os.homedir(), 'AppData', 'Roaming'),
  );
  return pathApi.resolve(appData, 'lnwjud');
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return path.join(os.homedir(), 'AppData', 'Roaming');
}
