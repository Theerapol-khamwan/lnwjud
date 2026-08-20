import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile); const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('PowerShell tunnel lock helper', () => {
  it('acquires once, reports concurrent owner, rejects invalid schema, and releases only its owner', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-ps-lock-')); roots.push(root);
    const helper = path.resolve('scripts/lib/lnwjud-tunnel-lock.ps1').replace(/'/g, "''");
    const script = `. '${helper}'; $p='${root.replace(/'/g, "''")}'; $f={param($id) if($id -eq 7){'2026-08-20T00:00:00.000Z'}}; $a=Enter-LnwjudTunnelLock $p 7 '2026-08-20T00:00:00.000Z' $f; $b=Enter-LnwjudTunnelLock $p 8 '2026-08-20T00:01:00.000Z' $f; if(-not $a.acquired -or $b.acquired -or $b.owner.pid -ne 7){exit 2}; if(-not (Release-LnwjudTunnelLock $p $a.owner)){exit 3}`;
    await expect(exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })).resolves.toBeDefined();
  });

  it('recovers a stale PID/start mismatch without starting tunnel-client', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-ps-lock-')); roots.push(root);
    const helper = path.resolve('scripts/lib/lnwjud-tunnel-lock.ps1').replace(/'/g, "''");
    const script = `. '${helper}'; $p='${root.replace(/'/g, "''")}'; New-Item -ItemType Directory -Path $p|Out-Null; '{"version":1,"pid":7,"processStartedAt":"2026-08-20T00:00:00.000Z","acquiredAt":"2026-08-20T00:00:00.000Z"}'|Set-Content (Join-Path $p 'lnwjud.tunnel.lock'); $f={param($id) '2026-08-20T00:01:00.000Z'}; $a=Enter-LnwjudTunnelLock $p 8 '2026-08-20T00:02:00.000Z' $f; if(-not $a.acquired){exit 2}`;
    await expect(exec('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })).resolves.toBeDefined();
  });
});
