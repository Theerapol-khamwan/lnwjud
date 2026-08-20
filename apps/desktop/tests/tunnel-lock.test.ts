import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireTunnelLock, readTunnelLock, type TunnelLockOwner } from '../src/main/tunnel-lock.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function owner(pid: number, processStartedAt: string): TunnelLockOwner {
  return { pid, processStartedAt, acquiredAt: '2026-08-20T00:00:00.000Z' };
}

describe('lnwjud tunnel ownership lock', () => {
  it('reports the current owner to a simultaneous second starter', async () => {
    const directory = await temporaryDirectory();
    const firstOwner = owner(101, '2026-08-20T00:00:00.000Z');
    const [first, second] = await Promise.all([
      acquireTunnelLock({ profileDirectory: directory, owner: firstOwner, inspectProcess: async () => firstOwner.processStartedAt }),
      acquireTunnelLock({ profileDirectory: directory, owner: owner(202, '2026-08-20T00:01:00.000Z'), inspectProcess: async (pid) => pid === 101 ? firstOwner.processStartedAt : '2026-08-20T00:01:00.000Z' }),
    ]);

    const acquired = first.acquired ? first : second;
    const rejected = first.acquired ? second : first;
    expect(acquired.acquired).toBe(true);
    expect(rejected).toEqual({ acquired: false, owner: acquired.owner });
    if (acquired.acquired) await acquired.release();
  });

  it('reclaims a lock only after the recorded owner is gone or has a mismatched start time', async () => {
    const directory = await temporaryDirectory();
    const staleOwner = owner(303, '2026-08-20T00:00:00.000Z');
    await writeFile(path.join(directory, 'lnwjud.tunnel.lock'), JSON.stringify(staleOwner), 'utf8');

    const claim = await acquireTunnelLock({
      profileDirectory: directory,
      owner: owner(404, '2026-08-20T00:02:00.000Z'),
      inspectProcess: async (pid) => pid === 303 ? '2026-08-20T00:03:00.000Z' : '2026-08-20T00:02:00.000Z',
    });

    expect(claim.acquired).toBe(true);
    expect(await readTunnelLock(directory)).toEqual(owner(404, '2026-08-20T00:02:00.000Z'));
    await claim.release();
  });

  it('reclaims a lock when the recorded owner process is gone', async () => {
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, 'lnwjud.tunnel.lock'), JSON.stringify(owner(707, '2026-08-20T00:00:00.000Z')), 'utf8');

    const claim = await acquireTunnelLock({
      profileDirectory: directory,
      owner: owner(808, '2026-08-20T00:05:00.000Z'),
      inspectProcess: async (pid) => pid === 707 ? null : '2026-08-20T00:05:00.000Z',
    });

    expect(claim.acquired).toBe(true);
    if (claim.acquired) await claim.release();
  });

  it('only releases a lock that still belongs to its owner', async () => {
    const directory = await temporaryDirectory();
    const firstOwner = owner(505, '2026-08-20T00:00:00.000Z');
    const claim = await acquireTunnelLock({ profileDirectory: directory, owner: firstOwner, inspectProcess: async () => firstOwner.processStartedAt });
    const replacement = owner(606, '2026-08-20T00:04:00.000Z');
    await writeFile(path.join(directory, 'lnwjud.tunnel.lock'), JSON.stringify(replacement), 'utf8');

    await expect(claim.release()).resolves.toBe(false);
    expect(await readTunnelLock(directory)).toEqual(replacement);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-tunnel-lock-'));
  temporaryRoots.push(directory);
  return directory;
}
