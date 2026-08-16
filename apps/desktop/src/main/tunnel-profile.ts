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
 * GUI-subsystem lnwjud.exe does not allocate a console. A .cmd / node.exe
 * MCP child does, so Start Tunnel must prefer `lnwjud.exe --mcp-stdio`.
 */
export function preferredTunnelMcpCommand(execPath: string, cmdFallback: string | null): string | null {
  const exe = path.resolve(execPath);
  if (path.basename(exe).toLowerCase() === 'lnwjud.exe' && existsSync(exe)) {
    return `${posixPath(exe)} --mcp-stdio`;
  }
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
