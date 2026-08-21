import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PowerShellWindowsCapabilityBridge } from './windows-bridge.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PowerShellWindowsCapabilityBridge integrity', () => {
  it('executes a script only when its SHA-256 matches the embedded expectation', async () => {
    const root = await temporaryRoot();
    const scriptPath = path.join(root, 'bridge.ps1');
    const script = '$input | Out-Null; Write-Output \'{"ok":true,"value":{"trusted":true}}\'';
    await writeFile(scriptPath, script, 'utf8');
    const expectedScriptSha256 = sha256(script);
    const bridge = new PowerShellWindowsCapabilityBridge({ scriptPath, expectedScriptSha256, platform: 'win32' });

    await expect(bridge.execute({ capability: 'system_info', input: { action: 'summary' } })).resolves.toEqual({ ok: true, value: { trusted: true } });
  });

  it('fails closed after the script changes, even if it was valid on a previous call', async () => {
    const root = await temporaryRoot();
    const scriptPath = path.join(root, 'bridge.ps1');
    const trusted = '$input | Out-Null; Write-Output \'{"ok":true,"value":{"trusted":true}}\'';
    await writeFile(scriptPath, trusted, 'utf8');
    const bridge = new PowerShellWindowsCapabilityBridge({ scriptPath, expectedScriptSha256: sha256(trusted), platform: 'win32' });
    await expect(bridge.execute({ capability: 'system_info', input: {} })).resolves.toMatchObject({ ok: true });

    await writeFile(scriptPath, '$input | Out-Null; Write-Output \'{"ok":true,"value":{"tampered":true}}\'', 'utf8');

    await expect(bridge.execute({ capability: 'system_info', input: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Windows bridge script integrity check failed' },
    });
  });

  it('rejects a missing or malformed expected hash before starting PowerShell', async () => {
    const root = await temporaryRoot();
    const scriptPath = path.join(root, 'bridge.ps1');
    await writeFile(scriptPath, 'Write-Output \'{}\'', 'utf8');
    const bridge = new PowerShellWindowsCapabilityBridge({ scriptPath, expectedScriptSha256: 'missing', platform: 'win32' });

    await expect(bridge.execute({ capability: 'system_info', input: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Windows bridge integrity manifest is missing or invalid' },
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-bridge-integrity-'));
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
