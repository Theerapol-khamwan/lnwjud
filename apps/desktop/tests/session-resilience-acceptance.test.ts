import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { ActivityTracker, ToolRegistry, type McpApplicationServices } from '@lnwjud/mcp-server';
import { UpdateInstallCoordinator } from '../src/main/update-install.js';
import { buildIncidentReport, exportIncidentReport } from '../src/main/incident-report.js';
import { LogHub } from '../src/main/log-hub.js';
import { acquireTunnelLock, type TunnelLockOwner } from '../src/main/tunnel-lock.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const lockHelper = path.join(repositoryRoot, 'scripts', 'lib', 'lnwjud-tunnel-lock.ps1');
const tunnelStarter = path.join(repositoryRoot, 'scripts', 'start-lnwjud-tunnel.ps1');
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('session resilience acceptance', () => {
  it('keeps the desktop lock and production launcher to one owner in either winner order without running tunnel-client', async () => {
    const root = await temporaryDirectory();
    const profileDirectory = path.join(root, 'tunnel-client');
    const sentinel = path.join(root, 'tunnel-client-invoked');
    const fakeClient = path.join(root, 'fake-tunnel-client.cmd');
    await mkdir(profileDirectory, { recursive: true });
    await writeFile(path.join(profileDirectory, 'lnwjud.runtime.secret'), 'not-read-by-lock-loser', 'utf8');
    await writeFile(fakeClient, `@echo invoked>"${sentinel}"\r\n@exit /b 99\r\n`, 'utf8');

    const desktopOwner = await currentOwner();
    const desktop = await acquireTunnelLock({ profileDirectory, owner: desktopOwner });
    expect(desktop.acquired).toBe(true);
    if (!desktop.acquired) return;

    const scriptLoser = await runPowerShellFile(tunnelStarter, ['-TunnelClientPath', fakeClient, '-NoViewer', '-Once'], {
      APPDATA: root, USERPROFILE: root, LOCALAPPDATA: root,
    });
    expect(scriptLoser.stdout).toContain(`already owned by PID ${desktopOwner.pid}`);
    await expect(access(sentinel)).rejects.toThrow();
    expect(await desktop.release()).toBe(true);

    const holder = await startPowerShellHolder(profileDirectory, path.join(root, 'release-holder'));
    try {
      expect(holder.acquired).toBe(true);
      const desktopLoser = await acquireTunnelLock({ profileDirectory, owner: await currentOwner() });
      expect(desktopLoser).toEqual({ acquired: false, owner: expect.objectContaining({ pid: holder.pid }) });
      await expect(access(sentinel)).rejects.toThrow();
    } finally {
      await writeFile(path.join(root, 'release-holder'), '', 'utf8');
      await waitForExit(holder.child);
    }

    const afterRelease = await acquireTunnelLock({ profileDirectory, owner: await currentOwner() });
    expect(afterRelease.acquired).toBe(true);
    if (afterRelease.acquired) expect(await afterRelease.release()).toBe(true);
  });

  it('returns PROCESS_TIMEOUT before the simulated remote deadline, terminates abort-aware work, and immediately accepts the next call', async () => {
    vi.useFakeTimers();
    const localBudgetMs = 20;
    const remoteDeadlineMs = 60;
    const simulatedWorkMs = 100;
    let terminated = false;
    let remoteDeadlineFired = false;
    let calls = 0;
    const registry = new ToolRegistry({
      search: {
        async searchFiles(): Promise<Result<{ files: string[]; truncated: boolean }>> { return ok({ files: [], truncated: false }); },
        async searchText(_actor, _workspaceId, _request, signal): Promise<Result<{ matches: { path: string; lineNumber: number; text: string }[]; truncated: boolean }>> {
          calls += 1;
          if (calls === 2) return ok({ matches: [], truncated: false });
          return new Promise((resolve) => {
            const child = setTimeout(() => resolve(ok({ matches: [], truncated: false })), simulatedWorkMs);
            signal?.addEventListener('abort', () => {
              clearTimeout(child);
              terminated = true;
              resolve(err(appError('PROCESS_TIMEOUT', 'simulated child terminated', true)));
            }, { once: true });
          });
        },
      },
    } satisfies McpApplicationServices, { clientId: 'acceptance', clientName: 'acceptance' }, { maxToolDurationMs: localBudgetMs });

    setTimeout(() => { remoteDeadlineFired = true; }, remoteDeadlineMs);
    const pending = registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'needle' });
    await vi.advanceTimersByTimeAsync(localBudgetMs);
    const timedOut = await pending;
    expect(timedOut).toMatchObject({ isError: true, structuredContent: { error: { code: 'PROCESS_TIMEOUT', recoverable: true } } });
    expect(terminated).toBe(true);
    expect(remoteDeadlineFired).toBe(false);
    await expect(registry.invoke('search_text', { workspaceId: 'workspace-1', query: 'needle' }))
      .resolves.toMatchObject({ structuredContent: { matches: [] } });
    await vi.advanceTimersByTimeAsync(remoteDeadlineMs - localBudgetMs);
    expect(remoteDeadlineFired).toBe(true);
  });

  it('defers exactly one update through real activity transitions and cancels it on shutdown', async () => {
    vi.useFakeTimers();
    const activity = new ActivityTracker();
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => activity.listInFlight().length,
      activityRevision: (): number => activity.revision(),
      install,
      quietPeriodMs: 30,
      pollIntervalMs: 5,
    });
    const firstCall = await activity.begin('search_text', { workspaceId: 'workspace-1' });
    coordinator.requestInstall();
    await vi.advanceTimersByTimeAsync(100);
    expect(install).not.toHaveBeenCalled();
    await activity.end(firstCall, 'SUCCESS', 1);
    await vi.advanceTimersByTimeAsync(10);
    const transient = await activity.begin('read_file', { workspaceId: 'workspace-1' });
    await activity.end(transient, 'SUCCESS', 1);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(29);
    expect(install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(install).toHaveBeenCalledOnce();
    coordinator.requestInstall();
    coordinator.cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(install).toHaveBeenCalledOnce();
  });

  it('captures lifecycle-precedence classifications and a bounded, redacted incident export through the production correlator', async () => {
    const failed = await incidentReport({ resultCode: 'FAILED', triggeredByUser: true, health: 'live' });
    expect(failed.classification).toBe('local_tool_failed');
    const failedWithTunnelDisconnect = await incidentReport({ resultCode: 'FAILED', triggeredByUser: true, health: 'live', tunnelLine: 'stdio MCP command exited.' });
    expect(failedWithTunnelDisconnect.classification).toBe('local_tool_failed');
    const disconnected = await incidentReport({ resultCode: 'SUCCESS', triggeredByUser: true, health: 'live', tunnelLine: 'stdio MCP command exited.' });
    expect(disconnected.classification).toBe('tunnel_disconnected');
    const remote = await incidentReport({ resultCode: 'SUCCESS', triggeredByUser: true, health: 'live' });
    expect(remote.classification).toBe('remote_turn_stopped');
    const inconclusive = await incidentReport({ resultCode: 'SUCCESS', triggeredByUser: false, health: 'unavailable' });
    expect(inconclusive.classification).toBe('healthy_or_inconclusive');

    let exported = '';
    const outcome = await exportIncidentReport({
      triggeredByUser: true,
      appVersion: 'password=acceptance-secret',
      tunnelClientVersion: null,
      tunnel: { state: 'running', source: 'acceptance', message: 'Authorization: Bearer acceptance-token', health: { state: 'live', message: null } },
      updaterEvents: Array.from({ length: 250 }, () => `token=acceptance-token ${'x'.repeat(600)}`),
      logLines: remote.__lines,
    }, {
      choosePath: async () => path.join(await temporaryDirectory(), 'incident.json'),
      writeAtomically: async (_file, content) => { exported = content; },
    });
    expect(outcome).toMatchObject({ exported: true, cancelled: false, classification: 'remote_turn_stopped' });
    expect(exported).not.toContain('acceptance-secret');
    expect(exported).not.toContain('acceptance-token');
    const parsed = JSON.parse(exported) as { updaterEventTail: string[] };
    expect(parsed.updaterEventTail).toHaveLength(200);
    expect(parsed.updaterEventTail.every((line) => line.length <= 512)).toBe(true);
  });

  it('keeps the acceptance, operator, and composed resilience surfaces free of fixed nonzero listener ports', async () => {
    const [testSource, packageJson, readme, tunnelController, powerShellHelper, tunnelLauncher] = await Promise.all([
      readFile(import.meta.filename, 'utf8'),
      readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
      readFile(path.join(repositoryRoot, 'README.md'), 'utf8'),
      readFile(path.join(repositoryRoot, 'apps', 'desktop', 'src', 'main', 'tunnel-controller.ts'), 'utf8'),
      readFile(lockHelper, 'utf8'),
      readFile(tunnelStarter, 'utf8'),
    ]);
    const operatorGuidance = section(readme, '### Session resilience /', '## Security and operational model');
    expect(findFixedListenerBindings([testSource, packageJson, operatorGuidance, tunnelController, powerShellHelper, tunnelLauncher])).toEqual([]);
    expect(findFixedListenerBindings([
      ['server.', 'listen(', 6789, ')'].join(''),
      ['http://', '127.0.0.1', ':', 7654, '/healthz'].join(''),
      ['listen_addr: "', 'localhost', ':', 4321, '"'].join(''),
    ])).toHaveLength(3);
    expect(findFixedListenerBindings(['server.listen(0)', 'http://$address/healthz', 'listen_addr: "127.0.0.1:0"'])).toEqual([]);
    expect(operatorGuidance).toContain("$tc = if ($env:LNWJUD_TUNNEL_CLIENT_PATH)");
  });
});

async function incidentReport(options: { resultCode: 'SUCCESS' | 'FAILED'; triggeredByUser: boolean; health: 'live' | 'unavailable'; tunnelLine?: string }): Promise<Awaited<ReturnType<typeof buildIncidentReport>> & { __lines: ReturnType<LogHub['snapshot']>['lines'] }> {
  const hub = new LogHub({ tunnelLogPath: path.join(os.tmpdir(), 'lnwjud-acceptance-missing.log') });
  hub.syncWorkLog([
    { id: 'started', timestamp: '2026-08-20T00:00:00.000Z', callId: 'call-1', kind: 'task', toolName: 'search_text', resultCode: 'STARTED', targetSummary: null },
    { id: 'finished', timestamp: '2026-08-20T00:00:01.000Z', callId: 'call-1', kind: options.resultCode === 'SUCCESS' ? 'result' : 'error', toolName: 'search_text', resultCode: options.resultCode, targetSummary: null },
  ], []);
  if (options.tunnelLine !== undefined) hub.feed('tunnel', 'error', options.tunnelLine);
  const lines = hub.snapshot().lines;
  const report = await buildIncidentReport({
    triggeredByUser: options.triggeredByUser,
    appVersion: 'acceptance',
    tunnelClientVersion: null,
    tunnel: { state: 'running', source: 'acceptance', message: null, health: { state: options.health, message: null } },
    updaterEvents: [],
    logLines: lines,
  });
  return { ...report, __lines: lines };
}

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-session-resilience-'));
  temporaryRoots.push(root);
  return root;
}

async function currentOwner(): Promise<TunnelLockOwner> {
  const result = await runPowerShell("$p = Get-CimInstance Win32_Process -Filter \"ProcessId = $env:LNWJUD_ACCEPTANCE_PID\"; $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)", { LNWJUD_ACCEPTANCE_PID: String(process.pid) });
  const startedAt = result.stdout;
  return { pid: process.pid, processStartedAt: startedAt, acquiredAt: new Date().toISOString() };
}

async function runPowerShellFile(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return runPowerShellProcess(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], env);
}

async function runPowerShell(script: string, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return runPowerShellProcess(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], env);
}

async function runPowerShellProcess(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(`PowerShell exited ${code ?? 'unknown'}: ${stderr || stdout}`)));
  });
}

async function startPowerShellHolder(profileDirectory: string, releaseSignal: string): Promise<{ child: ChildProcess; pid: number; acquired: boolean }> {
  const script = `
    . '${quote(lockHelper)}'
    $started = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
    $claim = Enter-LnwjudTunnelLock -ProfileDir '${quote(profileDirectory)}' -OwnerPid $PID -OwnerStartedAt $started -ProcessStartProvider { param($id) $p=Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue; if($null -ne $p){$p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)} }
    Write-Output "READY:\${PID}:$($claim.acquired)"
    [Console]::Out.Flush()
    while(-not (Test-Path -LiteralPath '${quote(releaseSignal)}')) { Start-Sleep -Milliseconds 10 }
    [void](Release-LnwjudTunnelLock -ProfileDir '${quote(profileDirectory)}' -Owner $claim.owner)
  `;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  const ready = await new Promise<{ pid: number; acquired: boolean }>((resolve, reject) => {
    let output = ''; let errors = '';
    child.stdout?.on('data', (chunk: string) => { output += chunk; const ready = /READY:(\d+):(True|False)/.exec(output); if (ready?.[1] !== undefined && ready[2] !== undefined) resolve({ pid: Number(ready[1]), acquired: ready[2] === 'True' }); });
    child.stderr?.on('data', (chunk: string) => { errors += chunk; });
    child.once('error', reject); child.once('exit', (code) => reject(new Error(`holder exited early (${code ?? 'unknown'}): ${errors}`)));
  });
  return { child, ...ready };
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('PowerShell lock holder did not exit')); }, 3_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function quote(value: string): string { return value.replace(/'/g, "''"); }

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing documentation section: ${start}`);
  return source.slice(from, to);
}

function findFixedListenerBindings(sources: readonly string[]): string[] {
  const findings: string[] = [];
  for (const source of sources) {
    if (/\.listen\s*\(\s*[1-9]\d*/.test(source)) findings.push('listen');
    if (/https?:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d*/i.test(source)) findings.push('loopback-url');
    if (/listen_addr\s*:\s*["']?(?:127\.0\.0\.1|localhost):[1-9]\d*/i.test(source)) findings.push('health-listen-addr');
  }
  return findings;
}
