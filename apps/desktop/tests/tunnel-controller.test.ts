import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TunnelController } from '../src/main/tunnel-controller.js';
import { waitForTunnelChildExit } from '../src/main/tunnel-controller.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { acquireTunnelLock, readTunnelLock, type TunnelLockAcquisition, type TunnelLockOwner } from '../src/main/tunnel-lock.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TunnelController lifecycle', () => {
  it('holds shutdown completion until a delayed tunnel child exits', async () => {
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null };
    child.exitCode = null;
    let settled = false;
    const waiting = waitForTunnelChildExit(child as never).then((): void => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    child.exitCode = 0;
    child.emit('exit', 0);
    await waiting;
    expect(settled).toBe(true);
  });

  it('keeps ownership until a normally stopping child emits exit', async () => {
    const fixture = await ownedController(() => true);
    const stopping = fixture.controller.stop();
    await Promise.resolve();

    expect(await readTunnelLock(fixture.profileDir)).toEqual(fixture.owner);
    await expectSecondControllerBlocked(fixture.dataPath, fixture.owner);

    fixture.child.exitCode = 0;
    fixture.child.emit('exit', 0);
    await stopping;
    expect(await readTunnelLock(fixture.profileDir)).toBeNull();
  });

  it('returns promptly and retains ownership when the child rejects the stop signal', async () => {
    const fixture = await ownedController(() => false);

    await expect(fixture.controller.stop()).rejects.toThrow('did not accept stop signal');

    expect(controllerInternals(fixture.controller).child).toBe(fixture.child);
    expect(await readTunnelLock(fixture.profileDir)).toEqual(fixture.owner);
    await expectSecondControllerBlocked(fixture.dataPath, fixture.owner);
  });

  it('returns promptly and retains ownership when signaling the child throws', async () => {
    const fixture = await ownedController(() => { throw new Error('signal failed'); });

    await expect(fixture.controller.stop()).rejects.toThrow('signal failed');

    expect(controllerInternals(fixture.controller).child).toBe(fixture.child);
    expect(await readTunnelLock(fixture.profileDir)).toEqual(fixture.owner);
    await expectSecondControllerBlocked(fixture.dataPath, fixture.owner);
  });

  it('uses the injected bound and retains ownership when no child exit is observed', async () => {
    vi.useFakeTimers();
    const fixture = await ownedController(() => true, 20);
    let stoppedWith: unknown;
    const stopping = fixture.controller.stop().catch((error: unknown) => { stoppedWith = error; });

    await vi.advanceTimersByTimeAsync(21);
    const rejectionAtBound = stoppedWith;
    expect(await readTunnelLock(fixture.profileDir)).toEqual(fixture.owner);
    await expectSecondControllerBlocked(fixture.dataPath, fixture.owner);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;

    expect(rejectionAtBound).toBeInstanceOf(Error);
    expect((rejectionAtBound as Error).message).toContain('exit was not observed');
    expect(controllerInternals(fixture.controller).child).toBe(fixture.child);
  });

  it('does not start a second tunnel when the shared lock belongs to another owner', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-controller-'));
    temporaryRoots.push(dataPath);
    vi.stubEnv('APPDATA', path.join(dataPath, 'appdata'));
    const profileDir = path.join(dataPath, 'appdata', 'tunnel-client');
    await (await import('node:fs/promises')).mkdir(profileDir, { recursive: true });
    await (await import('node:fs/promises')).writeFile(path.join(profileDir, 'lnwjud.tunnel.lock'), JSON.stringify({
      version: 1,
      pid: 7123,
      processStartedAt: '2026-08-20T00:00:00.000Z',
      acquiredAt: '2026-08-20T00:00:00.000Z',
    }), 'utf8');
    const controller = new TunnelController({
      getClientPath: (): string | null => null,
      setClientPath: (): void => {},
      getDataPath: (): string => dataPath,
      inspectLockProcess: async (): Promise<string | null> => '2026-08-20T00:00:00.000Z',
      currentLockOwner: async (): Promise<{ pid: number; processStartedAt: string; acquiredAt: string }> => ({ pid: 9999, processStartedAt: '2026-08-20T00:01:00.000Z', acquiredAt: '2026-08-20T00:01:00.000Z' }),
    });

    const status = await controller.start();

    expect(status).toMatchObject({ state: 'error', message: 'Tunnel is already owned by PID 7123' });
  });

  it('reports an externally running tunnel as health/status evidence', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-controller-'));
    temporaryRoots.push(dataPath);
    vi.stubEnv('APPDATA', path.join(dataPath, 'appdata'));
    let running = false;
    let probeCalls = 0;
    const controller = new TunnelController({
      getClientPath: (): string | null => null,
      setClientPath: (): void => {},
      getDataPath: (): string => dataPath,
      isExternalTunnelRunning: async (): Promise<boolean> => {
        probeCalls += 1;
        return running;
      },
    });

    running = true;
    const status = await controller.status();

    expect(status).toMatchObject({ state: 'running', source: 'external' });
    expect(probeCalls).toBe(1);
  });

  it('probes only the health endpoint configured in the tunnel profile', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-controller-'));
    temporaryRoots.push(dataPath);
    vi.stubEnv('APPDATA', path.join(dataPath, 'appdata'));
    const profileDir = path.join(dataPath, 'appdata', 'tunnel-client');
    await (await import('node:fs/promises')).mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, 'lnwjud.yaml'), 'health:\n  listen_addr: "127.0.0.1:18444"\n', 'utf8');
    let endpoint = '';
    const controller = new TunnelController({ getClientPath: (): string | null => null, setClientPath: (): void => {}, getDataPath: (): string => dataPath, probeHealthEndpoint: async (host, port): Promise<boolean> => { endpoint = `${host}:${port}`; return true; } });
    await expect(controller.incidentHealth()).resolves.toEqual({ state: 'live', message: 'configured tunnel health endpoint is live' });
    expect(endpoint).toBe('127.0.0.1:18444');
  });

  it('reads tunnel-client version from injected file metadata without executing it', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-controller-'));
    temporaryRoots.push(dataPath);
    const executable = path.join(dataPath, 'tunnel-client.exe');
    await writeFile(executable, 'not executed', 'utf8');
    const controller = new TunnelController({ getClientPath: (): string => executable, setClientPath: (): void => {}, getDataPath: (): string => dataPath, inspectFileVersion: async (): Promise<string> => '1.2.3' });
    await expect(controller.clientVersion()).resolves.toEqual({ value: '1.2.3', reason: null });
  });
});

interface FakeChild extends EventEmitter {
  exitCode: number | null;
  kill(): boolean;
}

async function ownedController(kill: () => boolean, stopTimeoutMs = 50): Promise<{
  controller: TunnelController;
  child: FakeChild;
  dataPath: string;
  profileDir: string;
  owner: TunnelLockOwner;
}> {
  const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-controller-'));
  temporaryRoots.push(dataPath);
  vi.stubEnv('APPDATA', path.join(dataPath, 'appdata'));
  const profileDir = path.join(dataPath, 'appdata', 'tunnel-client');
  const lockOwner: TunnelLockOwner = {
    pid: 7001,
    processStartedAt: '2026-08-20T00:00:00.000Z',
    acquiredAt: '2026-08-20T00:00:00.000Z',
  };
  const claim = await acquireTunnelLock({ profileDirectory: profileDir, owner: lockOwner, inspectProcess: async () => lockOwner.processStartedAt });
  if (!claim.acquired) throw new Error('test controller could not acquire its lock');
  const controller = new TunnelController({
    getClientPath: (): string | null => null,
    setClientPath: (): void => {},
    getDataPath: (): string => dataPath,
    isExternalTunnelRunning: async (): Promise<boolean> => false,
    stopTimeoutMs,
  });
  const child = new EventEmitter() as FakeChild;
  child.exitCode = null;
  child.kill = kill;
  const internals = controllerInternals(controller);
  internals.child = child as unknown as ChildProcess;
  internals.tunnelLock = claim;
  internals.state = 'running';
  return { controller, child, dataPath, profileDir, owner: lockOwner };
}

async function expectSecondControllerBlocked(dataPath: string, firstOwner: TunnelLockOwner): Promise<void> {
  const second = new TunnelController({
    getClientPath: (): string | null => null,
    setClientPath: (): void => {},
    getDataPath: (): string => dataPath,
    isExternalTunnelRunning: async (): Promise<boolean> => false,
    inspectLockProcess: async (pid): Promise<string | null> => pid === firstOwner.pid ? firstOwner.processStartedAt : null,
    currentLockOwner: async (): Promise<TunnelLockOwner> => ({
      pid: 7002,
      processStartedAt: '2026-08-20T00:01:00.000Z',
      acquiredAt: '2026-08-20T00:01:00.000Z',
    }),
  });
  await expect(second.start()).resolves.toMatchObject({ state: 'error', message: `Tunnel is already owned by PID ${firstOwner.pid}` });
}

function controllerInternals(controller: TunnelController): {
  child: ChildProcess | null;
  tunnelLock: TunnelLockAcquisition | null;
  state: 'stopped' | 'starting' | 'running' | 'error';
} {
  return controller as unknown as {
    child: ChildProcess | null;
    tunnelLock: TunnelLockAcquisition | null;
    state: 'stopped' | 'starting' | 'running' | 'error';
  };
}
