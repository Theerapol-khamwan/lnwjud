import path from 'node:path';
import type { PermissionDecision, PermissionProfile } from './types.js';

export type CommandSource = 'client' | 'project';

const SHELL_HOSTS = new Set(['bash', 'bash.exe', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'sh', 'sh.exe']);

export class CommandPolicy {
  public decide(profile: PermissionProfile, executable: string, source: CommandSource): PermissionDecision {
    const basename = path.win32.basename(executable).toLowerCase();
    if (SHELL_HOSTS.has(basename)) return 'DENY';

    if (source === 'project') {
      if (!profile.allowedProjectExecutables.includes(basename)) return 'DENY';
      return profile.defaults.EXECUTE;
    }
    if (!profile.allowedProjectExecutables.includes(basename) && profile.name !== 'full') return 'ASK';
    return profile.defaults.EXECUTE;
  }
}
