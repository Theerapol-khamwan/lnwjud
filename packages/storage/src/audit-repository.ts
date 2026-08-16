import type { AuditEvent, AuditEventRepository } from '@lnwjud/audit';
import type { SqliteDatabase } from './database.js';

interface AuditEventRow {
  readonly id: string;
  readonly timestamp: string;
  readonly actor_id: string;
  readonly actor_name: string;
  readonly workspace_id: string | null;
  readonly action: string;
  readonly target_summary: string | null;
  readonly permission_decision: string | null;
  readonly result_code: string;
  readonly duration_ms: number;
  readonly metadata_json: string;
}

export class SqliteAuditRepository implements AuditEventRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async insert(event: AuditEvent): Promise<void> {
    this.database.connection.prepare(
      `INSERT INTO audit_events
        (id, timestamp, actor_id, actor_name, workspace_id, action, target_summary, permission_decision, result_code, duration_ms, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.timestamp,
      event.actorId,
      event.actorName,
      event.workspaceId ?? null,
      event.action,
      event.targetSummary ?? null,
      event.permissionDecision ?? null,
      event.resultCode,
      event.durationMs ?? null,
      JSON.stringify(event.metadata),
    );
  }

  public async list(limit = 100): Promise<AuditEvent[]> {
    const boundedLimit = Number.isInteger(limit) && limit >= 1 && limit <= 500 ? limit : 100;
    const rows = this.database.connection.prepare(
      'SELECT id, timestamp, actor_id, actor_name, workspace_id, action, target_summary, permission_decision, result_code, duration_ms, metadata_json FROM audit_events ORDER BY timestamp DESC, id DESC LIMIT ?',
    ).all(boundedLimit);
    return rows.flatMap((row) => {
      const event = this.toEvent(row);
      return event === null ? [] : [event];
    });
  }

  private toEvent(value: unknown): AuditEvent | null {
    if (!this.isAuditEventRow(value)) return null;
    let metadata: unknown;
    try {
      metadata = JSON.parse(value.metadata_json) as unknown;
    } catch {
      return null;
    }
    if (!isRecord(metadata)) return null;
    return {
      id: value.id,
      timestamp: value.timestamp,
      actorId: value.actor_id,
      actorName: value.actor_name,
      ...(value.workspace_id === null ? {} : { workspaceId: value.workspace_id }),
      action: value.action,
      ...(value.target_summary === null ? {} : { targetSummary: value.target_summary }),
      ...(value.permission_decision === null ? {} : { permissionDecision: value.permission_decision }),
      resultCode: value.result_code,
      ...(typeof value.duration_ms === 'number' ? { durationMs: value.duration_ms } : {}),
      metadata,
    };
  }

  private isAuditEventRow(value: unknown): value is AuditEventRow {
    if (typeof value !== 'object' || value === null) return false;
    if (!('id' in value) || !('timestamp' in value) || !('actor_id' in value) || !('actor_name' in value)
      || !('workspace_id' in value) || !('action' in value) || !('target_summary' in value)
      || !('permission_decision' in value) || !('result_code' in value) || !('duration_ms' in value) || !('metadata_json' in value)) return false;
    return typeof value.id === 'string'
      && typeof value.timestamp === 'string'
      && typeof value.actor_id === 'string'
      && typeof value.actor_name === 'string'
      && (typeof value.workspace_id === 'string' || value.workspace_id === null)
      && typeof value.action === 'string'
      && (typeof value.target_summary === 'string' || value.target_summary === null)
      && (typeof value.permission_decision === 'string' || value.permission_decision === null)
      && typeof value.result_code === 'string'
      && (typeof value.duration_ms === 'number' || value.duration_ms === null)
      && typeof value.metadata_json === 'string';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
