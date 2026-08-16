import { existsSync } from 'node:fs';
import path from 'node:path';

const COMMAND_LINE = /command:\s*"[^"]*lnwjud[^"]*"/i;

export function posixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function rewriteTunnelYamlMcpCommand(yaml: string, stdioCmdPath: string): string {
  const quoted = `"${posixPath(stdioCmdPath)}"`;
  if (!COMMAND_LINE.test(yaml)) return yaml;
  return yaml.replace(COMMAND_LINE, `command: ${quoted}`);
}

export function resolveStdioLauncherPath(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (candidate.trim().length > 0 && existsSync(candidate)) return path.resolve(candidate);
  }
  return null;
}

/**
 * The packaged Electron executable uses the GUI subsystem. When tunnel-client
 * starts it as a child, its stdio handles can close immediately even though
 * Electron reports that the app is ready. The packaged direct-node launcher
 * keeps the MCP pipe owned by a normal console process.
 */
export function preferredTunnelMcpCommand(execPath: string, cmdFallback: string | null): string | null {
  void execPath;
  return cmdFallback;
}

export function packagedStdioLauncherCandidates(execPath: string, resourcesPath?: string): string[] {
  const execDir = path.dirname(execPath);
  const candidates = [
    path.join(execDir, 'lnwjud-mcp-stdio.cmd'),
    path.join(execDir, 'resources', 'lnwjud-mcp-stdio.cmd'),
  ];
  if (typeof resourcesPath === 'string' && resourcesPath.trim().length > 0) {
    candidates.push(path.join(resourcesPath, 'lnwjud-mcp-stdio.cmd'));
  }
  return candidates;
}
