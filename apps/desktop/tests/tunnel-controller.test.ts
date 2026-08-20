import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TunnelController } from '../src/main/tunnel-controller.js';
import { waitForTunnelChildExit } from '../src/main/tunnel-controller.js';
import { EventEmitter } from 'node:events';

const temporaryRoots: string[] = [];

afterEach(async () => {
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
});
