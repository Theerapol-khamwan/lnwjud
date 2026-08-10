import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '@lnwjud/audit';
import { SqliteAuditRepository } from './audit-repository.js';
import { SqliteDatabase } from './database.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteAuditRepository', () => {
  it('persists sanitized audit metadata through the audit migration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-audit-db-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const repository = new SqliteAuditRepository(database);
    const event: AuditEvent = {
      id: 'event-1',
      timestamp: new Date(0).toISOString(),
      actorId: 'client-1',
      actorName: 'test',
      workspaceId: 'workspace-1',
      action: 'read_file',
      resultCode: 'SUCCESS',
      durationMs: 4,
      metadata: { path: 'src/index.ts' },
    };

    await repository.insert(event);

    await expect(repository.list(10)).resolves.toEqual([event]);
    database.close();
  });
});
