import {
  decodeActivityTargetReference,
  redactActivityTargetDetail,
  type ActivityAuditEvent,
  type ActivityTargetDetail,
  type AuditEvent,
  type AuditEventQuery,
  type AuditEventRepository,
} from '@lnwjud/audit';
import type { SqliteDatabase } from './database.js';

interface AuditEventRow {
  readonly id: string;
  readonly timestamp: string;
  readonly actor_id: string;
  readonly actor_name: string;
  readonly workspace_id: string | null;
  readonly session_id: string | null;
  readonly action: string;
  readonly target_summary: string | null;
  readonly permission_decision: string | null;
  readonly result_code: string;
  readonly duration_ms: number;
  readonly metadata_json: string;
}

interface ActivityEventRow {
  readonly id: string;
  readonly timestamp: string;
  readonly workspace_id: string | null;
  readonly session_id: string | null;
  readonly action: string;
  readonly target_summary: string | null;
  readonly result_code: string;
  readonly duration_ms: number | null;
  readonly tool_name: string | null;
  readonly call_id: string | null;
  readonly phase: string | null;
  readonly error_message: string | null;
  readonly target_detail_json: string | null;
}

const AUDIT_SELECT = 'SELECT id, timestamp, actor_id, actor_name, workspace_id, session_id, action, target_summary, permission_decision, result_code, duration_ms, metadata_json FROM audit_events';

export class SqliteAuditRepository implements AuditEventRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async insert(event: AuditEvent): Promise<void> {
    this.database.connection.prepare(
      `INSERT INTO audit_events
        (id, timestamp, actor_id, actor_name, workspace_id, session_id, action, target_summary, permission_decision, result_code, duration_ms, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.timestamp,
      event.actorId,
      event.actorName,
      event.workspaceId ?? null,
      event.sessionId ?? null,
      event.action,
      event.targetSummary ?? null,
      event.permissionDecision ?? null,
      event.resultCode,
      event.durationMs ?? null,
      JSON.stringify(event.metadata),
    );
  }

  public list(limit = 100): Promise<AuditEvent[]> {
    return this.listScoped({}, limit);
  }

  public listByActionPrefix(prefix: string, limit = 100): Promise<AuditEvent[]> {
    return this.listScoped({ actionPrefix: prefix }, limit);
  }

  public async listScoped(query: AuditEventQuery, limit = 100): Promise<AuditEvent[]> {
    const boundedLimit = Number.isInteger(limit) && limit >= 1 && limit <= 500 ? limit : 100;
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.actionPrefix !== undefined) {
      clauses.push('action LIKE ?');
      parameters.push(`${query.actionPrefix}%`);
    }
    appendNullableScopeClause(clauses, parameters, 'workspace_id', query.workspaceId);
    appendNullableScopeClause(clauses, parameters, 'session_id', query.sessionId);
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const rows = this.database.connection.prepare(
      `${AUDIT_SELECT}${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
    ).all(...parameters, boundedLimit);
    return this.toEvents(rows);
  }

  public async listActivityScoped(query: AuditEventQuery, limit = 100): Promise<ActivityAuditEvent[]> {
    const boundedLimit = boundedQueryLimit(limit);
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.actionPrefix !== undefined) {
      clauses.push('action LIKE ?');
      parameters.push(`${query.actionPrefix}%`);
    }
    appendNullableScopeClause(clauses, parameters, 'workspace_id', query.workspaceId);
    appendNullableScopeClause(clauses, parameters, 'session_id', query.sessionId);
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const rows = this.database.connection.prepare(
      `SELECT id, timestamp, workspace_id, session_id, action, target_summary, result_code, duration_ms,
        json_extract(metadata_json, '$.toolName') AS tool_name,
        json_extract(metadata_json, '$.callId') AS call_id,
        json_extract(metadata_json, '$.phase') AS phase,
        json_extract(metadata_json, '$.errorMessage') AS error_message,
        json_extract(metadata_json, '$.targetDetail') AS target_detail_json
       FROM audit_events${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
    ).all(...parameters, boundedLimit);
    return rows.flatMap((row) => {
      const event = toActivityEvent(row);
      return event === null ? [] : [event];
    });
  }

  public async resolveActivityTargetDetail(idOrCallId: string): Promise<ActivityTargetDetail | null> {
    if (idOrCallId.length === 0 || idOrCallId.length > 512) return null;
    const row = this.database.connection.prepare(
      `SELECT metadata_json FROM audit_events
       WHERE (id = ? OR json_extract(metadata_json, '$.callId') = ?)
         AND json_extract(metadata_json, '$.phase') = 'started'
         AND json_type(metadata_json, '$.activityTargetDetail') = 'object'
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, timestamp DESC, id DESC LIMIT 1`,
    ).get(idOrCallId, idOrCallId, idOrCallId);
    if (!isMetadataRow(row)) return null;
    try {
      const metadata = JSON.parse(row.metadata_json) as unknown;
      if (!isRecord(metadata)) return null;
      const detail = metadata.activityTargetDetail;
      if (!isActivityTargetDetail(detail)) return null;
      return redactActivityTargetDetail(detail);
    } catch {
      return null;
    }
  }

  private toEvents(rows: unknown[]): AuditEvent[] {
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
      ...(value.session_id === null ? {} : { sessionId: value.session_id }),
      action: value.action,
      ...(value.target_summary === null ? {} : { targetSummary: value.target_summary }),
      ...(value.permission_decision === null ? {} : { permissionDecision: value.permission_decision }),
      resultCode: value.result_code,
      durationMs: typeof value.duration_ms === 'number' ? value.duration_ms : 0,
      metadata,
    };
  }

  private isAuditEventRow(value: unknown): value is AuditEventRow {
    if (typeof value !== 'object' || value === null) return false;
    if (!('id' in value) || !('timestamp' in value) || !('actor_id' in value) || !('actor_name' in value)
      || !('workspace_id' in value) || !('session_id' in value) || !('action' in value) || !('target_summary' in value)
      || !('permission_decision' in value) || !('result_code' in value) || !('duration_ms' in value) || !('metadata_json' in value)) return false;
    return typeof value.id === 'string'
      && typeof value.timestamp === 'string'
      && typeof value.actor_id === 'string'
      && typeof value.actor_name === 'string'
      && (typeof value.workspace_id === 'string' || value.workspace_id === null)
      && (typeof value.session_id === 'string' || value.session_id === null)
      && typeof value.action === 'string'
      && (typeof value.target_summary === 'string' || value.target_summary === null)
      && (typeof value.permission_decision === 'string' || value.permission_decision === null)
      && typeof value.result_code === 'string'
      && (typeof value.duration_ms === 'number' || value.duration_ms === null)
      && typeof value.metadata_json === 'string';
  }
}

function boundedQueryLimit(limit: number): number {
  return Number.isInteger(limit) && limit >= 1 && limit <= 500 ? limit : 100;
}

function toActivityEvent(value: unknown): ActivityAuditEvent | null {
  if (!isActivityEventRow(value)) return null;
  const toolName = value.tool_name ?? value.action.replace(/^mcp_tool:/, '');
  const phase = value.phase === 'started' ? 'started' : 'completed';
  let targetDetailValue: unknown;
  if (value.target_detail_json !== null) {
    try { targetDetailValue = JSON.parse(value.target_detail_json) as unknown; } catch { targetDetailValue = undefined; }
  }
  return {
    id: value.id,
    timestamp: value.timestamp,
    ...(value.workspace_id === null ? {} : { workspaceId: value.workspace_id }),
    ...(value.session_id === null ? {} : { sessionId: value.session_id }),
    action: value.action,
    ...(value.target_summary === null ? {} : { targetSummary: value.target_summary }),
    resultCode: value.result_code,
    durationMs: value.duration_ms ?? 0,
    toolName,
    ...(value.call_id === null ? {} : { callId: value.call_id }),
    phase,
    ...(value.error_message === null ? {} : { errorMessage: value.error_message }),
    targetDetail: decodeActivityTargetReference(targetDetailValue, value.target_summary ?? undefined),
  };
}

function isActivityEventRow(value: unknown): value is ActivityEventRow {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.timestamp === 'string'
    && (typeof value.workspace_id === 'string' || value.workspace_id === null)
    && (typeof value.session_id === 'string' || value.session_id === null)
    && typeof value.action === 'string'
    && (typeof value.target_summary === 'string' || value.target_summary === null)
    && typeof value.result_code === 'string'
    && (typeof value.duration_ms === 'number' || value.duration_ms === null)
    && (typeof value.tool_name === 'string' || value.tool_name === null)
    && (typeof value.call_id === 'string' || value.call_id === null)
    && (typeof value.phase === 'string' || value.phase === null)
    && (typeof value.error_message === 'string' || value.error_message === null)
    && (typeof value.target_detail_json === 'string' || value.target_detail_json === null);
}

function isMetadataRow(value: unknown): value is { readonly metadata_json: string } {
  return isRecord(value) && typeof value.metadata_json === 'string';
}

function isActivityTargetDetail(value: unknown): value is ActivityTargetDetail {
  return isRecord(value)
    && (value.kind === 'files' || value.kind === 'tools')
    && Array.isArray(value.items)
    && value.items.every((item) => typeof item === 'string');
}

function appendNullableScopeClause(
  clauses: string[],
  parameters: Array<string | number>,
  column: 'workspace_id' | 'session_id',
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    clauses.push(`${column} IS NULL`);
    return;
  }
  clauses.push(`${column} = ?`);
  parameters.push(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
