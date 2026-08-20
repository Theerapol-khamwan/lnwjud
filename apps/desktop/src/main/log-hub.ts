import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { type LogCorrelation, type LogLevel, type LogLine, type LogSnapshot, type LogSource, type TunnelLifecycleCategory } from '@lnwjud/ipc-contracts';

const MAX_LINES_PER_SOURCE = 2_000;
const MAX_SEEN_KEYS_PER_SOURCE = 4_000;
const MAX_LINE_BYTES = 8_192;

export interface LogHubOptions {
  readonly tunnelLogPath: string;
  readonly mcpActivityLogPath?: string;
  readonly onLine?: (line: LogLine) => void;
}

interface TailedFile {
  fd: number | null;
  offset: number;
  pending: string;
  decoder: StringDecoder;
}

export class LogHub {
  private readonly lines = new Map<LogSource, LogLine[]>();
  private readonly seenKeys = new Map<LogSource, Set<string>>();
  private readonly seenMcpDeliveries = new Set<string>();
  private readonly mcpOccurrences = new Map<string, Set<string>>();
  private nextId = 1;
  private readonly tunnelLogPath: string;
  private readonly mcpActivityLogPath: string | undefined;
  private onLine: ((line: LogLine) => void) | undefined;
  private readonly tunnelFile: TailedFile = { fd: null, offset: 0, pending: '', decoder: new StringDecoder('utf8') };
  private readonly mcpFile: TailedFile = { fd: null, offset: 0, pending: '', decoder: new StringDecoder('utf8') };
  private tailTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(options: LogHubOptions) {
    this.tunnelLogPath = options.tunnelLogPath;
    this.mcpActivityLogPath = options.mcpActivityLogPath;
    this.onLine = options.onLine;
    for (const source of SOURCES) {
      this.lines.set(source, []);
      this.seenKeys.set(source, new Set());
    }
  }

  public setOnLine(callback: ((line: LogLine) => void) | undefined): void {
    this.onLine = callback;
  }

  public start(): void {
    this.syncTunnelFile();
    this.syncMcpActivityFile();
    this.tailTimer = setInterval(() => {
      this.syncTunnelFile();
      this.syncMcpActivityFile();
    }, 500);
  }

  public stop(): void {
    if (this.tailTimer !== null) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
    }
    this.closeFd(this.tunnelFile);
    this.closeFd(this.mcpFile);
  }

  public feed(source: LogSource, level: LogLevel, text: string, correlation?: LogCorrelation, timestamp?: string): void {
    const trimmed = text.replace(/\r?\n$/, '');
    if (trimmed.length === 0) return;
    const normalizedCorrelation = source === 'tunnel'
      ? tunnelCorrelation(trimmed, correlation)
      : correlation;
    this.append(source, { level, text: trimmed, ...(normalizedCorrelation === undefined ? {} : { correlation: normalizedCorrelation }), ...(timestamp === undefined ? {} : { timestamp }) });
  }

  public feedIfNew(source: LogSource, key: string, level: LogLevel, text: string, correlation?: LogCorrelation, timestamp?: string): void {
    if (key.length === 0) {
      this.feed(source, level, text, correlation, timestamp);
      return;
    }
    const seen = this.seenKeys.get(source) ?? new Set<string>();
    if (seen.has(key)) return;
    seen.add(key);
    while (seen.size > MAX_SEEN_KEYS_PER_SOURCE) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
    this.seenKeys.set(source, seen);
    this.feed(source, level, text, correlation, timestamp);
  }

  public syncWorkLog(entries: readonly WorkLogFeedEntry[], inFlight: readonly InFlightFeedEntry[]): void {
    const events: WorkLogSyncEvent[] = [
      ...entries.map((entry, order): WorkLogSyncEvent => ({ kind: 'work-log', timestamp: entry.timestamp ?? '', phase: entry.kind === 'task' ? 'started' : 'completed', order, entry })),
      ...inFlight.map((entry, order): WorkLogSyncEvent => ({ kind: 'in-flight', timestamp: entry.startedAt, phase: 'started', order: entries.length + order, entry })),
    ].sort(compareWorkLogEvents);
    for (const event of events) {
      if (event.kind === 'in-flight') {
        const entry = event.entry;
        this.feedMcpLifecycle(
          'in-flight',
          entry.startedAt,
          'info',
          formatInFlightLine(entry),
          { kind: 'mcp', phase: 'started', callId: entry.callId, toolName: entry.toolName, resultCode: null },
          entry.startedAt,
        );
        continue;
      }
      const entry = event.entry;
      this.feedMcpLifecycle(
        'work-log',
        entry.id,
        entry.kind === 'error' ? 'error' : 'info',
        formatWorkLogLine(entry),
        { kind: 'mcp', phase: event.phase, callId: entry.callId ?? entry.id, toolName: entry.toolName, resultCode: event.phase === 'started' ? null : normalizeMcpResultCode(entry.resultCode) },
        entry.timestamp,
      );
    }
  }

  public syncProcesses(summaries: readonly ProcessFeedEntry[]): void {
    for (const summary of summaries) {
      const key = `process:${summary.id}:${summary.state}:${summary.logSummary}`;
      this.feedIfNew(
        'process',
        key,
        'info',
        `[${summary.state}] ${summary.executable} ${summary.args.join(' ')}${summary.logSummary.length === 0 ? '' : `\n${summary.logSummary}`}`,
      );
    }
  }

  public snapshot(): LogSnapshot {
    return {
      lines: SOURCES.flatMap((source) => [...(this.lines.get(source) ?? [])]).sort((a, b) => a.id - b.id),
      tunnelLogPath: this.tunnelLogPath,
      tunnelLogExists: existsSync(this.tunnelLogPath),
    };
  }

  public clear(source: LogSource): void {
    this.lines.set(source, []);
    this.seenKeys.set(source, new Set());
    if (source === 'mcp') {
      this.seenMcpDeliveries.clear();
      this.mcpOccurrences.clear();
    }
  }

  private feedMcpLifecycle(
    deliverySource: McpDeliverySource,
    deliveryIdentity: string,
    level: LogLevel,
    text: string,
    correlation: McpLogCorrelation,
    timestamp?: string,
  ): void {
    const scopedDeliveryIdentity = deliverySource === 'work-log' ? deliveryIdentity : `${correlation.callId}\0${deliveryIdentity}`;
    const deliveryKey = `mcp-delivery:${deliverySource}:${correlation.phase}:${stableEventIdentity(scopedDeliveryIdentity)}`;
    if (this.seenMcpDeliveries.has(deliveryKey)) return;

    const occurrenceKey = mcpActivityKey(correlation.callId, correlation.phase, timestamp ?? deliveryIdentity);
    const deliveries = this.mcpOccurrences.get(occurrenceKey) ?? new Set<string>();
    if (deliveries.has(deliveryKey)) return;
    rememberBounded(this.seenMcpDeliveries, deliveryKey);
    const hasWorkLogDelivery = [...deliveries].some((key) => key.startsWith('mcp-delivery:work-log:'));
    const shouldAppend = deliveries.size === 0 || (deliverySource === 'work-log' && hasWorkLogDelivery);
    rememberBounded(deliveries, deliveryKey);
    this.mcpOccurrences.set(occurrenceKey, deliveries);
    while (this.mcpOccurrences.size > MAX_SEEN_KEYS_PER_SOURCE) {
      const oldest = this.mcpOccurrences.keys().next().value;
      if (oldest === undefined) break;
      this.mcpOccurrences.delete(oldest);
    }
    if (shouldAppend) this.feed('mcp', level, text, correlation, timestamp);
  }

  private append(source: LogSource, entry: { readonly level: LogLevel; readonly text: string; readonly correlation?: LogCorrelation; readonly timestamp?: string }): void {
    const line: LogLine = {
      id: this.nextId,
      source,
      timestamp: boundedTimestamp(entry.timestamp) ?? new Date().toISOString(),
      level: entry.level,
      text: entry.text,
      ...(entry.correlation === undefined ? {} : { correlation: entry.correlation }),
    };
    this.nextId += 1;
    const buffer = this.lines.get(source) ?? [];
    buffer.push(line);
    while (buffer.length > MAX_LINES_PER_SOURCE) buffer.shift();
    this.lines.set(source, buffer);
    this.onLine?.(line);
  }

  private syncTunnelFile(): void {
    this.tailPath(this.tunnelLogPath, this.tunnelFile, 'tunnel', (raw) => {
      const parsed = parseTunnelLine(raw);
      this.append('tunnel', parsed);
    });
  }

  private syncMcpActivityFile(): void {
    const activityPath = this.mcpActivityLogPath;
    if (activityPath === undefined) return;
    this.tailPath(activityPath, this.mcpFile, 'mcp', (raw) => {
      const parsed = parseMcpActivityLine(raw);
      if (parsed === null) return;
      this.feedMcpLifecycle('activity-file', parsed.key, parsed.level, parsed.text, parsed.correlation, parsed.timestamp);
    });
  }

  private tailPath(filePath: string, state: TailedFile, source: LogSource, onRaw: (raw: string) => void): void {
    try {
      const stat = statSync(filePath);
      const size = stat.size;
      if (state.fd === null) {
        state.fd = openSync(filePath, 'r');
        state.offset = Math.max(0, size - 256 * 1024);
        state.pending = '';
        state.decoder = new StringDecoder('utf8');
      }
      if (size < state.offset) {
        state.offset = 0;
        state.pending = '';
        state.decoder = new StringDecoder('utf8');
      }
      if (size === state.offset) return;
      const chunk = Buffer.alloc(Math.min(size - state.offset, 64 * 1024));
      const read = readSync(state.fd, chunk, 0, chunk.length, state.offset);
      state.offset += read;
      if (read <= 0) return;
      const text = state.pending + state.decoder.write(chunk.subarray(0, read));
      const records = text.split(/\r?\n/);
      state.pending = records.pop() ?? '';
      for (const raw of records) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        onRaw(trimmed);
      }
    } catch (error: unknown) {
      this.closeFd(state);
      if (!isMissingFileError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        this.feedIfNew(
          source,
          `tail-error:${filePath}:${message}`,
          'error',
          `Unable to tail log file ${filePath}: ${message}`,
        );
      }
    }
  }

  private closeFd(state: TailedFile): void {
    if (state.fd !== null) {
      try {
        closeSync(state.fd);
      } catch {
        // Best effort.
      }
      state.fd = null;
    }
    state.offset = 0;
    state.pending = '';
    state.decoder = new StringDecoder('utf8');
  }
}

const SOURCES: readonly LogSource[] = ['tunnel', 'mcp', 'process'];

export interface WorkLogFeedEntry {
  readonly id: string;
  readonly timestamp?: string;
  readonly kind: 'task' | 'result' | 'error';
  readonly toolName: string;
  readonly resultCode: string;
  readonly errorMessage?: string | null;
  readonly targetSummary: string | null;
  readonly callId?: string;
}

export interface InFlightFeedEntry {
  readonly callId: string;
  readonly toolName: string;
  readonly targetSummary: string | null;
  readonly startedAt: string;
}

export interface ProcessFeedEntry {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly state: string;
  readonly logSummary: string;
}

type WorkLogSyncEvent =
  | { readonly kind: 'work-log'; readonly timestamp: string; readonly phase: 'started' | 'completed'; readonly order: number; readonly entry: WorkLogFeedEntry }
  | { readonly kind: 'in-flight'; readonly timestamp: string; readonly phase: 'started'; readonly order: number; readonly entry: InFlightFeedEntry };
type McpDeliverySource = 'work-log' | 'in-flight' | 'activity-file';
type McpLogCorrelation = Extract<LogCorrelation, { readonly kind: 'mcp' }>;

function compareWorkLogEvents(left: WorkLogSyncEvent, right: WorkLogSyncEvent): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  if (timestampOrder !== 0) return timestampOrder;
  if (left.phase !== right.phase) return left.phase === 'started' ? -1 : 1;
  if (left.kind !== right.kind) return left.kind === 'work-log' ? -1 : 1;
  return left.order - right.order;
}

export function mcpActivityKey(callId: string, phase: 'started' | 'completed', eventIdentity = ''): string {
  return `mcp:${phase}:${stableEventIdentity(`${callId}\0${eventIdentity}`)}`;
}

function formatInFlightLine(entry: InFlightFeedEntry): string {
  return `[TASK] ${entry.toolName} callId=${entry.callId}${entry.targetSummary === null || entry.targetSummary === undefined ? '' : ` ${entry.targetSummary}`} — in flight`;
}

function formatWorkLogLine(entry: WorkLogFeedEntry): string {
  return `${entry.kind === 'task' ? '[TASK]' : entry.kind === 'error' ? '[ERROR]' : '[RESULT]'} ${entry.toolName} ${entry.resultCode}${entry.callId === undefined || entry.callId.length === 0 ? '' : ` callId=${entry.callId}`}${entry.errorMessage === null || entry.errorMessage === undefined || entry.errorMessage.length === 0 ? '' : ` — ${entry.errorMessage}`}${entry.targetSummary === null ? '' : ` — ${entry.targetSummary}`}`;
}

function parseTunnelLine(raw: string): { readonly level: LogLevel; readonly text: string; readonly timestamp?: string; readonly correlation: LogCorrelation } {
  const json = tryParseJson(raw);
  if (json !== null && typeof json === 'object') {
    const record = json as Record<string, unknown>;
    const level = typeof record.level === 'string' ? record.level.toLowerCase() : '';
    const message = typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : raw;
    const instanceId = stringRecordField(record, ['instance_id', 'instanceId']);
    const requestId = stringRecordField(record, ['request_id', 'requestId']);
    const pid = typeof record.pid === 'number' && Number.isInteger(record.pid) ? record.pid : undefined;
    const lifecycleFields = structuredLifecycleFields(record);
    const lifecycle = lifecycleFields.length === 0
      ? normalizeTunnelLifecycle(message)
      : normalizeStructuredTunnelLifecycle(lifecycleFields);
    const timestamp = boundedTimestamp(record.timestamp);
    return { level: level.includes('error') ? 'error' : level.includes('warn') ? 'warn' : 'info', text: message.slice(0, MAX_LINE_BYTES), ...(timestamp === undefined ? {} : { timestamp }), correlation: { kind: 'tunnel', lifecycle, ...(instanceId === undefined ? {} : { instanceId }), ...(requestId === undefined ? {} : { requestId }), ...(pid === undefined ? {} : { pid }) } };
  }
  const lowered = raw.toLowerCase();
  return {
    level: /\berror\b/.test(lowered) ? 'error' : /\bwarn(ing)?\b/.test(lowered) ? 'warn' : 'info',
    text: raw.slice(0, MAX_LINE_BYTES),
    correlation: { kind: 'tunnel', lifecycle: normalizeTunnelLifecycle(raw) },
  };
}

function parseMcpActivityLine(raw: string): { readonly key: string; readonly level: LogLevel; readonly text: string; readonly timestamp?: string; readonly correlation: McpLogCorrelation } | null {
  const json = tryParseJson(raw);
  if (json === null || typeof json !== 'object') return null;
  const record = json as Record<string, unknown>;
  const callId = typeof record.callId === 'string' ? record.callId : '';
  const toolName = typeof record.toolName === 'string' ? record.toolName : 'unknown';
  const phase = record.phase === 'completed' ? 'completed' : 'started';
  const resultCode = typeof record.resultCode === 'string' ? record.resultCode : phase === 'started' ? 'STARTED' : 'UNKNOWN';
  const targetSummary = typeof record.targetSummary === 'string' ? record.targetSummary : null;
  const resultMessage = typeof record.resultMessage === 'string' ? record.resultMessage : null;
  const timestamp = boundedTimestamp(record.timestamp);
  const kind = phase === 'started' ? 'task' : resultCode === 'SUCCESS' || resultCode === 'STARTED' ? 'result' : 'error';
  return {
    key: mcpActivityKey(callId.length > 0 ? callId : 'unknown', phase, timestamp ?? raw.slice(0, 160)),
    level: kind === 'error' ? 'error' : 'info',
    text: formatWorkLogLine({
      id: callId,
      kind,
      toolName,
      resultCode,
      errorMessage: resultMessage,
      targetSummary,
      callId,
    }),
    correlation: { kind: 'mcp', phase, callId, toolName, resultCode: phase === 'started' ? null : normalizeMcpResultCode(resultCode) },
    ...(timestamp === undefined ? {} : { timestamp }),
  };
}

export function normalizeTunnelLifecycle(value: string): TunnelLifecycleCategory {
  const normalized = value.toLowerCase().replace(/[_./:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\bttl\b(?:\s+\w+){0,3}\s+(?:reached|expired|exceeded)\b/.test(normalized)) return 'ttl_expired';
  if (/\bstdio\s+(?:mcp(?:\s+(?:command|process))?|command|process)\s+(?:(?:is|was|has been)\s+)?(?:exited|closed|terminated|stopped)\b/.test(normalized)) return 'stdio_stopped';
  if (/\b(?:requesting\s+)?(?:tunnel(?:\s+client)?|control\s+plane|websocket\s+connection)(?:\s+connection)?\s+(?:(?:is|was|has been)\s+)?(?:shutdown|shutting\s+down|stopping|stopped|disconnected|disconnecting)\b/.test(normalized)) return 'transport_stopped';
  return 'other';
}

function normalizeStructuredTunnelLifecycle(values: readonly string[]): TunnelLifecycleCategory {
  for (const value of values) {
    const category = normalizeTunnelLifecycle(value);
    if (category !== 'other') return category;
    const normalized = value.toLowerCase().replace(/[_./:-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(?:shutdown|shutting down|stopping|stopped|disconnected|disconnecting)$/.test(normalized)) return 'transport_stopped';
  }
  return 'other';
}

function tunnelCorrelation(text: string, correlation: LogCorrelation | undefined): LogCorrelation {
  if (correlation?.kind === 'tunnel') {
    return { ...correlation, lifecycle: correlation.lifecycle ?? normalizeTunnelLifecycle(text) };
  }
  return { kind: 'tunnel', lifecycle: normalizeTunnelLifecycle(text) };
}

function structuredLifecycleFields(record: Readonly<Record<string, unknown>>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!['event', 'status', 'reason'].includes(key.toLowerCase()) || typeof value !== 'string') continue;
    values.push(value.slice(0, MAX_LINE_BYTES));
  }
  return values;
}

function boundedTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

function stableEventIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rememberBounded(values: Set<string>, value: string): void {
  values.add(value);
  while (values.size > MAX_SEEN_KEYS_PER_SOURCE) {
    const oldest = values.values().next().value;
    if (oldest === undefined) break;
    values.delete(oldest);
  }
}

function normalizeMcpResultCode(value: string): 'SUCCESS' | 'FAILED' | 'FATAL' | 'UNKNOWN' {
  const normalized = value.toUpperCase();
  if (normalized === 'SUCCESS') return 'SUCCESS';
  if (normalized === 'FATAL') return 'FATAL';
  if (['FAILED', 'FILE_NOT_FOUND', 'CHILD_FAILED', 'DEPENDENCY_FAILED', 'PERMISSION_DENIED'].includes(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

function stringRecordField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === 'string' && (record[key] as string).length <= 128) return record[key] as string;
  return undefined;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
