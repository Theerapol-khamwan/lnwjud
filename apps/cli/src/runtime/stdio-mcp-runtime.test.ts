import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase, SqliteSettingsRepository } from '@lnwjud/storage';
import { createStdioMcpRuntime } from './stdio-mcp-runtime.js';
import { sharedActivitySnapshotPath } from '@lnwjud/mcp-server';

const temporaryRoots: string[] = [];

const workspace = {
  id: 'workspace-1',
  displayName: 'fixture',
  rootPath: 'E:\fixture',
  realRootPath: 'E:\fixture',
  createdAt: '2026-08-10T00:00:00.000Z',
};

afterEach(async () => {
  delete process.env.TUNNEL_CLIENT_PROFILE_DIR;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('stdio MCP runtime', () => {
  it('does not overwrite the Desktop permission profile when using full tunnel access', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-stdio-profile-'));
    temporaryRoots.push(dataPath);
    const database = new SqliteDatabase(path.join(dataPath, 'lnwjud.sqlite'));
    new SqliteSettingsRepository(database).set('permission_profile', 'balanced');
    database.close();

    const runtime = createStdioMcpRuntime(dataPath, workspace);
    await runtime.close();

    const verificationDatabase = new SqliteDatabase(path.join(dataPath, 'lnwjud.sqlite'));
    const profile = new SqliteSettingsRepository(verificationDatabase).get('permission_profile');
    verificationDatabase.close();
    expect(profile).toBe('balanced');
  });

  it('owns and cleans the tunnel-profile activity snapshot for the direct STDIO runtime', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-stdio-activity-'));
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-stdio-profile-'));
    temporaryRoots.push(dataPath, profileDirectory);
    process.env.TUNNEL_CLIENT_PROFILE_DIR = profileDirectory;

    const runtime = createStdioMcpRuntime(dataPath, workspace);
    await runtime.activityReady;
    const initialized = JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8')) as Record<string, unknown>;
    expect(initialized).toMatchObject({ version: 1, activeCount: 0, revision: 0, owner: { pid: process.pid } });

    const callId = await runtime.activityTracker.begin('read_file', { path: 'E:\\fixture.txt' });
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toMatchObject({ activeCount: 1, revision: 1 });
    await runtime.activityTracker.end(callId, 'SUCCESS', 1);
    expect(JSON.parse(await readFile(sharedActivitySnapshotPath(profileDirectory), 'utf8'))).toMatchObject({ activeCount: 0, revision: 2 });

    await runtime.close();
    await expect(access(sharedActivitySnapshotPath(profileDirectory))).rejects.toThrow();
  });
});
