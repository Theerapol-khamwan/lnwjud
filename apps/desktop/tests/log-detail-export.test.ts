import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditService, redactActivityTargetDetail } from '@lnwjud/audit';
import { SqliteAuditRepository, SqliteDatabase } from '@lnwjud/storage';
import * as desktopServices from '../src/main/desktop-services.js';

const temporaryRoots: string[] = [];
const openDatabases: SqliteDatabase[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    try { database.close(); } catch { /* already closed by the test */ }
  }
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type SearchTargetDetails = (
  repository: SqliteAuditRepository,
  candidates: readonly { readonly id: string; readonly detailRef: string | null }[],
  query: string,
) => Promise<readonly string[]>;

type ResolveWorkLogExportRows = (
  repository: SqliteAuditRepository,
  identities: readonly string[],
) => Promise<readonly string[]>;

type WriteSerializedLogRows = (filePath: string, rows: readonly string[]) => Promise<void>;

describe('complete log detail resolution and export', () => {
  it('searches hidden SQLite detail and returns matching row identities only', async () => {
    const fixture = await createAuditFixture('search-call', ['visible-a.ts', 'visible-b.ts', 'visible-c.ts', 'hidden-needle.ts', 'e.ts', 'f.ts', 'g.ts']);
    const search = (desktopServices as unknown as { searchActivityTargetDetails?: SearchTargetDetails }).searchActivityTargetDetails;
    expect(typeof search).toBe('function');
    const matches = await search!(fixture.repository, [
      { id: 'audit:matching-event', detailRef: 'search-call' },
      { id: 'audit:unrelated-event', detailRef: null },
    ], 'hidden-needle');
    expect(matches).toEqual(['audit:matching-event']);
    fixture.database.close();
  });

  it('exports all seven items from a persisted audit row in captured order', async () => {
    const items = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'];
    const fixture = await createAuditFixture('persisted-call', items);
    const events = await fixture.repository.listActivityScoped({ actionPrefix: 'mcp_tool:' }, 10);
    const started = events.find((event) => event.phase === 'started')!;
    const resolveRows = (desktopServices as unknown as { resolveWorkLogExportRows?: ResolveWorkLogExportRows }).resolveWorkLogExportRows;
    expect(typeof resolveRows).toBe('function');
    const rows = await resolveRows!(fixture.repository, [`audit:${started.id}`]);
    expect(rows).toHaveLength(1);
    for (const item of items) expect(rows[0]).toContain(item);
    fixture.database.close();
  });

  it('resolves an in-flight identity through its started audit event after completion races export', async () => {
    const items = ['one.ts', 'two.ts', 'three.ts', 'four.ts', 'five.ts', 'six.ts', 'seven.ts', 'eight.ts', 'nine.ts'];
    const fixture = await createAuditFixture('race-call', items, false);
    await fixture.audit.recordMcpTool({
      actorId: 'test', actorName: 'test', toolName: 'read_files', callId: 'race-call', phase: 'completed',
      targetDetail: { detailRef: 'race-call', itemCount: 9, preview: items.slice(0, 3), legacyIncomplete: false },
      resultCode: 'SUCCESS', durationMs: 8, timestamp: '2026-08-30T00:00:01.000Z',
    });
    const resolveRows = (desktopServices as unknown as { resolveWorkLogExportRows?: ResolveWorkLogExportRows }).resolveWorkLogExportRows;
    expect(typeof resolveRows).toBe('function');
    const rows = await resolveRows!(fixture.repository, ['inflight:race-call']);
    expect(rows).toHaveLength(1);
    for (const item of items) expect(rows[0]).toContain(item);
    fixture.database.close();
  });

  it('reports unavailable detail when the referenced audit event has been evicted', async () => {
    const fixture = await createAuditFixture('evicted-call', ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    fixture.database.connection.prepare('DELETE FROM audit_events').run();
    const resolveRows = (desktopServices as unknown as { resolveWorkLogExportRows?: ResolveWorkLogExportRows }).resolveWorkLogExportRows;
    expect(typeof resolveRows).toBe('function');
    const rows = await resolveRows!(fixture.repository, ['inflight:evicted-call']);
    expect(rows).toEqual(['Detail unavailable: the retained audit event no longer exists.']);
    fixture.database.close();
  });

  it('marks retained rows incomplete when their referenced full detail is unavailable', async () => {
    const fixture = await createAuditFixture('missing-detail-call', ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    fixture.database.connection.prepare(
      "UPDATE audit_events SET metadata_json = json_remove(metadata_json, '$.activityTargetDetail') WHERE json_extract(metadata_json, '$.phase') = 'started'",
    ).run();
    const events = await fixture.repository.listActivityScoped({ actionPrefix: 'mcp_tool:' }, 10);
    const started = events.find((event) => event.phase === 'started')!;
    const resolveRows = (desktopServices as unknown as { resolveWorkLogExportRows?: ResolveWorkLogExportRows }).resolveWorkLogExportRows;
    const rows = await resolveRows!(fixture.repository, [`audit:${started.id}`]);
    expect(rows[0]).toContain('Complete target detail unavailable');
    fixture.database.close();
  });

  it('serializes all nine Live Log items through the shared main formatter', () => {
    const formatter = (desktopServices as unknown as {
      formatCompleteTargetDetail?: (base: string, detail: { readonly kind: 'files'; readonly items: readonly string[] } | null, expected: boolean) => string;
    }).formatCompleteTargetDetail;
    expect(typeof formatter).toBe('function');
    const items = ['one.ts', 'two.ts', 'three.ts', 'four.ts', 'five.ts', 'six.ts', 'seven.ts', 'eight.ts', 'nine.ts'];
    const row = formatter!('live row', { kind: 'files', items }, true);
    for (const item of items) expect(row).toContain(item);
  });

  it('streams complete rows to the exported txt file without renderer-formatted content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-log-export-file-'));
    temporaryRoots.push(root);
    const writeRows = (desktopServices as unknown as { writeSerializedLogRows?: WriteSerializedLogRows }).writeSerializedLogRows;
    expect(typeof writeRows).toBe('function');
    const filePath = path.join(root, 'complete-log.txt');
    await writeRows!(filePath, ['row\r\nFiles:\r\n- a.ts\r\n- hidden-nine.ts']);
    expect(await readFile(filePath, 'utf8')).toBe('row\r\nFiles:\r\n- a.ts\r\n- hidden-nine.ts\r\n');
  });
});

async function createAuditFixture(callId: string, items: readonly string[], complete = true): Promise<{
  readonly database: SqliteDatabase;
  readonly repository: SqliteAuditRepository;
  readonly audit: AuditService;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-log-detail-'));
  temporaryRoots.push(root);
  const database = new SqliteDatabase(path.join(root, 'state.db'));
  openDatabases.push(database);
  const repository = new SqliteAuditRepository(database);
  const audit = new AuditService(repository);
  const detail = redactActivityTargetDetail({ kind: 'files', items });
  await audit.recordMcpTool({
    actorId: 'test', actorName: 'test', toolName: 'read_files', callId, phase: 'started',
    targetSummary: `${items.slice(0, 3).join(', ')} (+${Math.max(0, items.length - 3)})`,
    targetDetail: { detailRef: callId, itemCount: items.length, preview: items.slice(0, 3), legacyIncomplete: false },
    activityTargetDetail: detail, resultCode: 'STARTED', durationMs: 0, timestamp: '2026-08-30T00:00:00.000Z',
  });
  if (complete) {
    await audit.recordMcpTool({
      actorId: 'test', actorName: 'test', toolName: 'read_files', callId, phase: 'completed',
      targetDetail: { detailRef: callId, itemCount: items.length, preview: items.slice(0, 3), legacyIncomplete: false },
      resultCode: 'SUCCESS', durationMs: 4, timestamp: '2026-08-30T00:00:01.000Z',
    });
  }
  return { database, repository, audit };
}
