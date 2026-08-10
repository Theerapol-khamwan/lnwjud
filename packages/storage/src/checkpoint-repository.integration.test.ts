import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Checkpoint } from '@lnwjud/workspace';
import { SqliteCheckpointRepository } from './checkpoint-repository.js';
import { SqliteDatabase } from './database.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteCheckpointRepository', () => {
  it('round-trips bounded checkpoint metadata and content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-checkpoint-db-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const repository = new SqliteCheckpointRepository(database);
    const checkpoint: Checkpoint = { id: 'checkpoint-1', workspaceId: 'workspace-1', createdAt: new Date(0).toISOString(), files: [{ path: 'src/file.txt', content: 'before', contentSha256: 'hash', size: 6 }] };

    await repository.insert(checkpoint);

    await expect(repository.get(checkpoint.id)).resolves.toEqual(checkpoint);
    database.close();
  });
});
