import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedStdioLauncherCandidates, preferredTunnelMcpCommand, resolveStdioLauncherPath, rewriteTunnelYamlMcpCommand } from '../src/main/tunnel-profile.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('tunnel profile MCP command', () => {
  it('rewrites the tunnel MCP command to the supplied launcher', () => {
    const yaml = [
      'mcp:',
      '  commands:',
      '    - channel: main',
      '      command: "C:/Users/me/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"',
    ].join('\n');
    const next = rewriteTunnelYamlMcpCommand(
      yaml,
      'C:\\Users\\me\\AppData\\Local\\Programs\\lnwjud\\lnwjud-mcp-stdio.cmd',
    );
    expect(next).toContain('command: "C:/Users/me/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"');
  });

  it('keeps lnwjud.exe --mcp-stdio as the tunnel MCP command', () => {
    const yaml = '      command: "C:/old/lnwjud-mcp-stdio.cmd --workspace E:/lnwjud"';
    expect(rewriteTunnelYamlMcpCommand(yaml, 'D:/lnwjud/lnwjud.exe --mcp-stdio')).toContain(
      'command: "D:/lnwjud/lnwjud.exe --mcp-stdio"',
    );
  });

  it('falls back to the cmd launcher when the host is not lnwjud.exe', () => {
    expect(preferredTunnelMcpCommand('C:\\Program Files\\nodejs\\node.exe', 'D:\\lnwjud\\lnwjud-mcp-stdio.cmd')).toBe(
      'D:\\lnwjud\\lnwjud-mcp-stdio.cmd',
    );
  });

  it('prefers the packaged cmd launcher when the host is a GUI lnwjud.exe', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-stdio-exe-'));
    temporaryRoots.push(root);
    const exePath = path.join(root, 'lnwjud.exe');
    await writeFile(exePath, 'stub', 'utf8');
    const cmdPath = path.join(root, 'lnwjud-mcp-stdio.cmd');
    expect(preferredTunnelMcpCommand(exePath, cmdPath)).toBe(cmdPath);
  });

  it('resolves the first existing packaged cmd candidate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-stdio-'));
    temporaryRoots.push(root);
    const resources = path.join(root, 'resources');
    await mkdir(resources);
    const cmdPath = path.join(root, 'lnwjud-mcp-stdio.cmd');
    await writeFile(cmdPath, '@echo off\n', 'utf8');
    expect(resolveStdioLauncherPath(packagedStdioLauncherCandidates(path.join(root, 'lnwjud.exe'), resources))).toBe(
      path.resolve(cmdPath),
    );
  });
});
