import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { type LogLevel, type LogLine, type LogSnapshot, type LogSource } from '@lnwjud/ipc-contracts';

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
}

export class LogHub {
  private readonly lines = new Map<LogSource, LogLine[]>();
  private readonly seenKeys = new Map<LogSource, Set<string>>();
  private nextId = 1;
  private readonly tunnelLogPath: string;
  private readonly mcpActivityLogPath: string | undefined;
  private onLine: ((line: LogLine) => void) | undefined;
  private readonly tunnelFile: TailedFile = { fd: null, offset: 0 };
  private readonly mcpFile: TailedFile = { fd: null, offset: 0 };
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

  public feed(source: LogSource, level: LogLevel, text: string): void {
    const trimmed = text.replace(/\r?\n$/, '');
    if (trimmed.length === 0) return;
    this.append(source, { level, text: trimmed });
  }

  public feedIfNew(source: LogSource, key: string, level: LogLevel, text: string): void {
    if (key.length === 0) {
      this.feed(source, level, text);
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
    this.feed(source, level, text);
  }

  public syncWorkLog(entries: readonly WorkLogFeedEntry[], inFlight: readonly InFlightFeedEntry[]): void {
    for (const entry of inFlight) {
      this.feedIfNew(
        'mcp',
        mcpActivityKey(entry.callId, 'started'),
        'info',
        formatInFlightLine(entry),
      );
    }
    for (const entry of entries) {
      this.feedIfNew(
        'mcp',
        mcpActivityKey(entry.callId ?? entry.id, entry.kind === 'task' ? 'started' : 'completed'),
        entry.kind === 'error' ? 'error' : 'info',
        formatWorkLogLine(entry),
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
  }

  private append(source: LogSource, entry: { readonly level: LogLevel; readonly text: string }): void {
    const line: LogLine = {
      id: this.nextId,
      source,
      timestamp: new Date().toISOString(),
      level: entry.level,
      text: entry.text,
    };
    this.nextId += 1;
    const buffer = this.lines.get(source) ?? [];
    buffer.push(line);
    while (buffer.length > MAX_LINES_PER_SOURCE) buffer.shift();
    this.lines.set(source, buffer);
    this.onLine?.(line);
  }

  private syncTunnelFile(): void {
    this.tailPath(this.tunnelLogPath, this.tunnelFile, (raw) => {
      const parsed = parseTunnelLine(raw);
      this.append('tunnel', parsed);
    });
  }

  private syncMcpActivityFile(): void {
    const activityPath = this.mcpActivityLogPath;
    if (activityPath === undefined) return;
    this.tailPath(activityPath, this.mcpFile, (raw) => {
      const parsed = parseMcpActivityLine(raw);
      if (parsed === null) return;
      this.feedIfNew('mcp', parsed.key, parsed.level, parsed.text);
    });
  }

  private tailPath(filePath: string, state: TailedFile, onRaw: (raw: string) => void): void {
    try {
      const stat = statSync(filePath);
      const size = stat.size;
      if (state.fd === null) {
        state.fd = openSync(filePath, 'r');
        state.offset = Math.max(0, size - 256 * 1024);
      }
      if (size < state.offset) {
        state.offset = 0;
      }
      if (size === state.offset) return;
      const chunk = Buffer.alloc(Math.min(size - state.offset, 64 * 1024));
      const read = readSync(state.fd, chunk, 0, chunk.length, state.offset);
      state.offset += read;
      if (read <= 0) return;
      const text = chunk.subarray(0, read).toString('utf8');
      for (const raw of text.split(/\r?\n/)) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        onRaw(trimmed);
      }
    } catch {
      this.closeFd(state);
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
  }
}

const SOURCES: readonly LogSource[] = ['tunnel', 'mcp', 'process'];

export interface WorkLogFeedEntry {
  readonly id: string;
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
}

export interface ProcessFeedEntry {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly state: string;
  readonly logSummary: string;
}

export function mcpActivityKey(callId: string, phase: 'started' | 'completed'): string {
  return `mcp:${callId}:${phase}`;
}

function formatInFlightLine(entry: InFlightFeedEntry): string {
  return `[TASK] ${entry.toolName}${entry.targetSummary === null || entry.targetSummary === undefined ? '' : ` ${entry.targetSummary}`} — in flight`;
}

function formatWorkLogLine(entry: WorkLogFeedEntry): string {
  return `${entry.kind === 'task' ? '[TASK]' : entry.kind === 'error' ? '[ERROR]' : '[RESULT]'} ${entry.toolName} ${entry.resultCode}${entry.errorMessage === null || entry.errorMessage === undefined || entry.errorMessage.length === 0 ? '' : ` — ${entry.errorMessage}`}${entry.targetSummary === null ? '' : ` — ${entry.targetSummary}`}`;
}

function parseTunnelLine(raw: string): { readonly level: LogLevel; readonly text: string } {
  const json = tryParseJson(raw);
  if (json !== null && typeof json === 'object') {
    const record = json as Record<string, unknown>;
    const level = typeof record.level === 'string' ? record.level.toLowerCase() : '';
    const message = typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : raw;
    return { level: level.includes('error') ? 'error' : level.includes('warn') ? 'warn' : 'info', text: message.slice(0, MAX_LINE_BYTES) };
  }
  const lowered = raw.toLowerCase();
  return {
    level: /\berror\b/.test(lowered) ? 'error' : /\bwarn(ing)?\b/.test(lowered) ? 'warn' : 'info',
    text: raw.slice(0, MAX_LINE_BYTES),
  };
}

function parseMcpActivityLine(raw: string): { readonly key: string; readonly level: LogLevel; readonly text: string } | null {
  const json = tryParseJson(raw);
  if (json === null || typeof json !== 'object') return null;
  const record = json as Record<string, unknown>;
  const callId = typeof record.callId === 'string' ? record.callId : '';
  const toolName = typeof record.toolName === 'string' ? record.toolName : 'unknown';
  const phase = record.phase === 'completed' ? 'completed' : 'started';
  const resultCode = typeof record.resultCode === 'string' ? record.resultCode : phase === 'started' ? 'STARTED' : 'SUCCESS';
  const targetSummary = typeof record.targetSummary === 'string' ? record.targetSummary : null;
  const resultMessage = typeof record.resultMessage === 'string' ? record.resultMessage : null;
  const kind = phase === 'started' ? 'task' : resultCode === 'SUCCESS' || resultCode === 'STARTED' ? 'result' : 'error';
  return {
    key: mcpActivityKey(callId.length > 0 ? callId : raw.slice(0, 40), phase),
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
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
