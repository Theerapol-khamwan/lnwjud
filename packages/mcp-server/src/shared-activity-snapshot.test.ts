import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityTracker } from './activity-tracker.js';
import {
  SharedActivitySnapshotLease,
  readSharedActivitySnapshot,
  sharedActivitySnapshotPath,
  type ProcessProbeResult,
  type SharedActivityOwner,
} from './shared-activity-snapshot.js';

const roots: string[] = [];
const owner: SharedActivityOwner = { pid: 7001, processStartedAt: '2026-08-20T00:00:00.000Z' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shared cross-process MCP activity snapshot', () => {
  it('initializes an idle owner snapshot and publishes begin/end revisions atomically', async () => {
    const profileDirectory = await temporaryDirectory();
    let now = new Date('2026-08-20T00:00:01.000Z');
    const lease = new SharedActivitySnapshotLease({ profileDirectory, owner, now: (): Date => now, heartbeatMs: 0 });
    await lease.initialize();

    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toEqual({
      version: 1,
      owner,
      activeCount: 0,
      revision: 0,
      updatedAt: '2026-08-20T00:00:01.000Z',
    });

    const tracker = new ActivityTracker(lease);
    now = new Date('2026-08-20T00:00:02.000Z');
    const callId = await tracker.begin('read_file', { path: 'E:\\fixture.txt' });
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toMatchObject({ activeCount: 1, revision: 1 });
    now = new Date('2026-08-20T00:00:03.000Z');
    await tracker.end(callId, 'SUCCESS', 1);
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toMatchObject({ activeCount: 0, revision: 2 });
    expect((await readdir(profileDirectory)).filter((name) => name.includes('.publish.'))).toEqual([]);
  });

  it('distinguishes trustworthy, stale, and unverifiable owner evidence', async () => {
    const profileDirectory = await temporaryDirectory();
    const lease = new SharedActivitySnapshotLease({ profileDirectory, owner, now: (): Date => new Date('2026-08-20T00:00:01.000Z'), heartbeatMs: 0 });
    await lease.initialize();
    const base = { profileDirectory, now: (): Date => new Date('2026-08-20T00:00:02.000Z'), staleAfterMs: 5_000 };

    await expect(readSharedActivitySnapshot({ ...base, inspectProcess: async () => ({ state: 'live', processStartedAt: owner.processStartedAt }) }))
      .resolves.toMatchObject({ state: 'available', activeCount: 0, revision: 0, owner });
    await expect(readSharedActivitySnapshot({ ...base, inspectProcess: async () => ({ state: 'gone' }) }))
      .resolves.toMatchObject({ state: 'stale', reason: 'owner_gone' });
    await expect(readSharedActivitySnapshot({ ...base, inspectProcess: async () => ({ state: 'live', processStartedAt: '2026-08-20T00:00:09.000Z' }) }))
      .resolves.toMatchObject({ state: 'stale', reason: 'owner_reused' });
    await expect(readSharedActivitySnapshot({ ...base, inspectProcess: async () => ({ state: 'unverifiable', reason: 'access_denied' }) }))
      .resolves.toMatchObject({ state: 'unverifiable', reason: 'access_denied' });
  });

  it('treats missing, malformed, and expired snapshots as unavailable evidence', async () => {
    const profileDirectory = await temporaryDirectory();
    const options = { profileDirectory, inspectProcess: async (): Promise<ProcessProbeResult> => ({ state: 'gone' }), now: (): Date => new Date('2026-08-20T00:00:10.000Z'), staleAfterMs: 2_000 };
    await expect(readSharedActivitySnapshot(options)).resolves.toMatchObject({ state: 'missing' });
    await writeFile(sharedActivitySnapshotPath(profileDirectory), '{broken', 'utf8');
    await expect(readSharedActivitySnapshot(options)).resolves.toMatchObject({ state: 'unverifiable', reason: 'invalid_snapshot' });
    const lease = new SharedActivitySnapshotLease({ profileDirectory, owner, now: (): Date => new Date('2026-08-20T00:00:01.000Z'), heartbeatMs: 0 });
    await rm(sharedActivitySnapshotPath(profileDirectory), { force: true });
    await lease.initialize();
    await expect(readSharedActivitySnapshot(options)).resolves.toMatchObject({ state: 'stale', reason: 'snapshot_expired' });
  });

  it('cleans up only its own snapshot and preserves a replacement owner', async () => {
    const profileDirectory = await temporaryDirectory();
    const lease = new SharedActivitySnapshotLease({ profileDirectory, owner, heartbeatMs: 0 });
    await lease.initialize();
    const replacement = { version: 1, owner: { pid: 8001, processStartedAt: '2026-08-20T00:01:00.000Z' }, activeCount: 0, revision: 5, updatedAt: '2026-08-20T00:01:01.000Z' };
    await writeFile(sharedActivitySnapshotPath(profileDirectory), JSON.stringify(replacement), 'utf8');
    await expect(lease.close()).resolves.toBe(false);
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toEqual(replacement);
    await writeFile(sharedActivitySnapshotPath(profileDirectory), JSON.stringify({ version: 1, owner, activeCount: 0, revision: 6, updatedAt: '2026-08-20T00:01:02.000Z' }), 'utf8');
    await expect(lease.close()).resolves.toBe(true);
    await expect(access(sharedActivitySnapshotPath(profileDirectory))).rejects.toThrow();
  });

  it('cannot remove a fresh replacement published while its own snapshot is quarantined for close', async () => {
    const profileDirectory = await temporaryDirectory();
    const replacement = { version: 1, owner: { pid: 8002, processStartedAt: '2026-08-20T00:02:00.000Z' }, activeCount: 1, revision: 9, updatedAt: '2026-08-20T00:02:01.000Z' };
    const lease = new SharedActivitySnapshotLease({
      profileDirectory,
      owner,
      heartbeatMs: 0,
      hooks: { afterCloseQuarantine: async (): Promise<void> => writeFile(sharedActivitySnapshotPath(profileDirectory), JSON.stringify(replacement), 'utf8') },
    });
    await lease.initialize();
    await expect(lease.close()).resolves.toBe(true);
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toEqual(replacement);
  });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-shared-activity-'));
  roots.push(root);
  return root;
}
