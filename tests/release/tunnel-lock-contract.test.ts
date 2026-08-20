import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PowerShell tunnel launcher ownership contract', () => {
  it('uses the same atomic lock file and owner metadata as the desktop launcher', async () => {
    const source = await readFile(path.resolve(import.meta.dirname, '..', '..', 'scripts', 'start-lnwjud-tunnel.ps1'), 'utf8');
    expect(source).toContain("'lnwjud.tunnel.lock'");
    expect(source).toContain('[System.IO.FileMode]::CreateNew');
    expect(source).toContain('processStartedAt');
    expect(source).toContain('Release-LnwjudTunnelLock');
  });
});
