import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpgradeRuntimeStateStore } from './upgrade-runtime-state-store.js';

describe('UpgradeRuntimeStateStore', () => {
  it('merges simultaneous writes for the same session without losing checkpoints', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-state-'));
    const legacyPath = path.join(directory, 'upgrade-runtime.json');
    const first = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-a');
    const second = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-a');

    await Promise.all([
      first.updateSession((current) => ({ ...current, checkpoints: [...current.checkpoints, { id: 'checkpoint-a' }] })),
      second.updateSession((current) => ({ ...current, checkpoints: [...current.checkpoints, { id: 'checkpoint-b' }] })),
    ]);

    const loaded = await first.load();
    expect(loaded.session.checkpoints).toEqual(expect.arrayContaining([{ id: 'checkpoint-a' }, { id: 'checkpoint-b' }]));
    expect(loaded.session.checkpoints).toHaveLength(2);
  });

  it('isolates session state while merging shared state across owners', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-state-'));
    const legacyPath = path.join(directory, 'upgrade-runtime.json');
    const sessionA = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-a');
    const sessionB = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-b');

    await sessionA.updateSession((current) => ({ ...current, session: [['owner', 'a']] }));
    await sessionB.updateSession((current) => ({ ...current, session: [['owner', 'b']] }));
    await Promise.all([
      sessionA.updateShared((current) => ({ ...current, plugins: [...current.plugins, { name: 'plugin-a', enabled: true }] })),
      sessionB.updateShared((current) => ({ ...current, plugins: [...current.plugins, { name: 'plugin-b', enabled: true }] })),
    ]);

    expect((await sessionA.load()).session.session).toEqual([['owner', 'a']]);
    expect((await sessionB.load()).session.session).toEqual([['owner', 'b']]);
    const shared = (await sessionA.load()).shared.plugins;
    expect(shared).toEqual(expect.arrayContaining([{ name: 'plugin-a', enabled: true }, { name: 'plugin-b', enabled: true }]));
    expect(shared).toHaveLength(2);
  });

  it('migrates legacy state once, claims legacy session data for one session, and preserves shared ledgers', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-state-'));
    const legacyPath = path.join(directory, 'upgrade-runtime.json');
    const legacy = {
      tasks: [{ id: 'legacy-task' }],
      checkpoints: [{ id: 'legacy-checkpoint' }],
      session: [['lastCheckpointId', 'legacy-checkpoint']],
      plugins: [{ name: 'legacy-plugin', enabled: true }],
      worktrees: [{ workspaceId: 'ws-1', worktreePath: '.worktrees/legacy', ref: 'main', owner: 'client', createdAt: '2026-08-20T00:00:00.000Z' }],
    };
    await writeFile(legacyPath, JSON.stringify(legacy), 'utf8');

    const first = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-a');
    const migrated = await first.load();
    expect(migrated.session.checkpoints).toEqual([{ id: 'legacy-checkpoint' }]);
    expect(migrated.shared.plugins).toEqual([{ name: 'legacy-plugin', enabled: true }]);
    expect(migrated.shared.worktrees).toEqual(legacy.worktrees);

    const second = new UpgradeRuntimeStateStore(legacyPath, 'client\0session-b');
    const isolated = await second.load();
    expect(isolated.session).toEqual({ tasks: [], checkpoints: [], session: [] });
    expect(isolated.shared.plugins).toEqual([{ name: 'legacy-plugin', enabled: true }]);
    expect(isolated.shared.worktrees).toEqual(legacy.worktrees);
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(legacy);
  });
});
