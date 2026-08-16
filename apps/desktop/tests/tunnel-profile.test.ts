import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedStdioLauncherCandidates, resolveStdioLauncherPath, rewriteTunnelYamlMcpCommand } from '../src/main/tunnel-profile.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('tunnel profile MCP command', () => {
  it('rewrites lnwjud.exe --mcp-stdio to the packaged cmd launcher', () => {
    const yaml = [
      'mcp:',
      '  commands:',
      '    - channel: main',
      '      command: "C:/Users/me/AppData/Local/Programs/lnwjud/lnwjud.exe --mcp-stdio"',
    ].join('\n');
    const next = rewriteTunnelYamlMcpCommand(yaml, 'C:\\Users\\me\\AppData\\Local\\Programs\\lnwjud\\lnwjud-mcp-stdio.cmd');
    expect(next).toContain('command: "C:/Users/me/AppData/Local/Programs/lnwjud/lnwjud-mcp-stdio.cmd"');
    expect(next).not.toContain('--mcp-stdio');
    expect(next).not.toContain('lnwjud.exe');
  });

  it('points an old cmd path at the launcher next to lnwjud.exe', () => {
    const yaml = '      command: "C:/old/lnwjud-mcp-stdio.cmd --workspace E:/lnwjud"';
    expect(rewriteTunnelYamlMcpCommand(yaml, 'D:/lnwjud/lnwjud-mcp-stdio.cmd')).toContain(
      'command: "D:/lnwjud/lnwjud-mcp-stdio.cmd"',
    );
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
