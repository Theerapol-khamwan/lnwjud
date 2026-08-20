import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LogLine, TunnelLifecycleCategory, TunnelStatus } from '@lnwjud/ipc-contracts';

const execFileAsync = promisify(execFile);
const MAX_ENTRIES = 200;
const MAX_TEXT = 512;
const MAX_IDS = 50;
const SENSITIVE_KEY = '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|x[_-]?api[_-]?key|api[_-]?key|client[_-]?secret|authorization|password|token|secret)';
const AUTHORIZATION_VALUE = new RegExp(`\\bauthorization\\s*[:=]\\s*(?:basic|bearer)\\s+[^\\r\\n,;]+`, 'gi');
const JSON_SECRET_VALUE = new RegExp(`("${SENSITIVE_KEY}"\\s*:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|[^,}\\]\\r\\n]*)`, 'gi');
const ASSIGNED_SECRET_VALUE = new RegExp(`(^|[?&\\s;,{])(${SENSITIVE_KEY})(\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'[^']*'|[^\\r\\n,;&}\\]]+)`, 'gi');
const KNOWN_SECRET_PREFIX = /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]+)\b/g;

export type IncidentClassification = 'local_tool_failed' | 'tunnel_disconnected' | 'remote_turn_stopped' | 'healthy_or_inconclusive';
export type TunnelHealthState = 'live' | 'unhealthy' | 'unavailable' | 'unknown';
export interface IncidentHealth { readonly state: TunnelHealthState; readonly message: string | null; }
type IncidentLine = Pick<LogLine, 'source' | 'text' | 'timestamp' | 'correlation'> & { readonly id?: number };
export interface IncidentEvidence { readonly triggeredByUser: boolean; readonly appVersion: string; readonly tunnelClientVersion: string | null; readonly tunnelClientVersionReason?: string | null; readonly tunnel: Pick<TunnelStatus, 'state' | 'source' | 'message'> & { readonly health: IncidentHealth }; readonly updaterEvents: readonly string[]; readonly logLines: readonly IncidentLine[]; readonly collectProcessTree?: (pids: readonly number[]) => Promise<readonly IncidentProcess[]>; readonly collectListeners?: (pids: readonly number[]) => Promise<readonly IncidentListener[]>; }
export interface IncidentProcess { readonly pid: number; readonly parentPid: number | null; readonly executable: string; }
export interface IncidentListener { readonly pid: number; readonly address: string; readonly port: number; readonly owner?: string; }
export type IncidentCompletionState = 'success' | 'failure' | 'unknown' | 'conflict';
export interface IncidentCall { readonly callId: string; readonly toolName: string | null; readonly resultCode: 'SUCCESS' | 'FAILED' | 'FATAL' | 'UNKNOWN' | null; readonly completionState: IncidentCompletionState; readonly incomplete: boolean; readonly startedWithoutCompletion: boolean; readonly completionWithoutStart: boolean; readonly sourceSequence: number; readonly lastEvidenceSequence: number; readonly startedAt: string | null; readonly completedAt: string | null; }
export interface IncidentReport { readonly schemaVersion: 1; readonly capturedAt: string; readonly appVersion: string; readonly tunnelClientVersion: string | null; readonly tunnelClientVersionReason: string | null; readonly classification: IncidentClassification; readonly classificationReasons: readonly string[]; readonly updaterEventTail: readonly string[]; readonly tunnel: { readonly state: TunnelStatus['state']; readonly source: TunnelStatus['source']; readonly message: string | null; readonly instanceIds: readonly string[]; readonly requestIds: readonly string[]; readonly health: IncidentHealth; }; readonly mcpCalls: readonly IncidentCall[]; readonly tunnelLogTail: readonly { readonly timestamp: string; readonly text: string; readonly lifecycle: TunnelLifecycleCategory }[]; readonly processTree: { readonly available: boolean; readonly entries: readonly { readonly pid: number; readonly parentPid: number | null; readonly executable: string }[]; readonly error?: string; }; readonly tcpListeners: { readonly available: boolean; readonly entries: readonly { readonly pid: number; readonly address: string; readonly port: number; readonly owner: string | null }[]; readonly error?: string; }; }

export function classifyIncident(evidence: Pick<IncidentEvidence, 'triggeredByUser' | 'tunnel' | 'logLines'>): { readonly classification: IncidentClassification; readonly reasons: readonly string[] } {
  const latestCall = pairMcpCalls(evidence.logLines).reduce<IncidentCall | undefined>((latest, call) => latest === undefined || call.lastEvidenceSequence >= latest.lastEvidenceSequence ? call : latest, undefined);
  if (latestCall?.completionState === 'failure' && !latestCall.incomplete) return { classification: 'local_tool_failed', reasons: ['latest_structured_mcp_terminal_failed'] };
  const hasTunnelLifecycleFailure = evidence.logLines.some((line) => line.source === 'tunnel'
    && line.correlation?.kind === 'tunnel'
    && line.correlation.lifecycle !== undefined
    && line.correlation.lifecycle !== 'other');
  if (evidence.tunnel.state === 'stopped' || evidence.tunnel.state === 'error' || evidence.tunnel.health.state === 'unhealthy' || hasTunnelLifecycleFailure) return { classification: 'tunnel_disconnected', reasons: ['explicit_tunnel_disconnect_evidence'] };
  if (evidence.triggeredByUser && latestCall?.completionState === 'success' && !latestCall.incomplete && evidence.tunnel.state === 'running' && evidence.tunnel.health.state === 'live') return { classification: 'remote_turn_stopped', reasons: ['manual_capture_after_structured_success_with_live_tunnel'] };
  return { classification: 'healthy_or_inconclusive', reasons: [evidence.tunnel.state === 'starting' ? 'tunnel_starting' : evidence.tunnel.health.state === 'unavailable' ? 'tunnel_health_unavailable' : 'insufficient_non_conflicting_evidence'] };
}

export function pairMcpCalls(lines: readonly IncidentLine[]): readonly IncidentCall[] {
  const calls: MutableIncidentCall[] = [];
  const pending = new Map<string, number[]>();
  const lastClosed = new Map<string, number>();
  const seenEvents = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const correlation = line.correlation;
    if (correlation?.kind !== 'mcp') continue;
    const identity = mcpEvidenceIdentity(line, correlation);
    if (seenEvents.has(identity)) continue;
    seenEvents.add(identity);
    const rawCallId = correlation.callId;
    const callId = safe(rawCallId);
    const sequence = sourceSequence(line, index);
    const eventTimestamp = safe(line.timestamp);
    if (correlation.phase === 'started') {
      const callIndex = calls.push({
        callId,
        toolName: safe(correlation.toolName),
        resultCode: null,
        completionState: 'unknown',
        incomplete: true,
        startedWithoutCompletion: true,
        completionWithoutStart: false,
        sourceSequence: sequence,
        lastEvidenceSequence: sequence,
        startedAt: eventTimestamp,
        completedAt: null,
      }) - 1;
      const queue = pending.get(rawCallId) ?? [];
      queue.push(callIndex);
      pending.set(rawCallId, queue);
      continue;
    }

    const queue = pending.get(rawCallId);
    const callIndex = queue?.shift();
    if (queue !== undefined && queue.length === 0) pending.delete(rawCallId);
    if (callIndex !== undefined) {
      const call = calls[callIndex]!;
      const result = completionResult(correlation.resultCode);
      call.resultCode = result.resultCode;
      call.completionState = result.completionState;
      call.incomplete = result.completionState === 'unknown';
      call.startedWithoutCompletion = false;
      call.lastEvidenceSequence = sequence;
      call.completedAt = eventTimestamp;
      lastClosed.set(rawCallId, callIndex);
      continue;
    }

    const closedIndex = lastClosed.get(rawCallId);
    if (closedIndex !== undefined) {
      const closed = calls[closedIndex]!;
      closed.resultCode = 'UNKNOWN';
      closed.completionState = 'conflict';
      closed.incomplete = true;
      closed.lastEvidenceSequence = sequence;
      continue;
    }

    const result = completionResult(correlation.resultCode);
    calls.push({
      callId,
      toolName: safe(correlation.toolName),
      resultCode: result.resultCode,
      completionState: result.completionState,
      incomplete: true,
      startedWithoutCompletion: false,
      completionWithoutStart: true,
      sourceSequence: sequence,
      lastEvidenceSequence: sequence,
      startedAt: null,
      completedAt: eventTimestamp,
    });
  }
  return calls.slice(-MAX_ENTRIES);
}

interface MutableIncidentCall {
  callId: string;
  toolName: string | null;
  resultCode: IncidentCall['resultCode'];
  completionState: IncidentCompletionState;
  incomplete: boolean;
  startedWithoutCompletion: boolean;
  completionWithoutStart: boolean;
  sourceSequence: number;
  lastEvidenceSequence: number;
  startedAt: string | null;
  completedAt: string | null;
}

export function parseTunnelCorrelations(lines: readonly IncidentLine[]): { readonly instanceIds: readonly string[]; readonly requestIds: readonly string[] } {
  const instanceIds = new Set<string>(); const requestIds = new Set<string>();
  for (const line of lines.slice(-MAX_ENTRIES)) { if (line.source !== 'tunnel') continue; if (line.correlation?.kind === 'tunnel') { if (line.correlation.instanceId !== undefined) instanceIds.add(safe(line.correlation.instanceId)); if (line.correlation.requestId !== undefined) requestIds.add(safe(line.correlation.requestId)); } for (const match of line.text.matchAll(/\b(?:instance[_-]?id|instance)[=:]([A-Za-z0-9._:-]{1,128})/ig)) instanceIds.add(safe(match[1]!)); for (const match of line.text.matchAll(/\b(?:request[_-]?id|request)[=:]([A-Za-z0-9._:-]{1,128})/ig)) requestIds.add(safe(match[1]!)); }
  return { instanceIds: [...instanceIds].slice(-MAX_IDS), requestIds: [...requestIds].slice(-MAX_IDS) };
}

export async function buildIncidentReport(evidence: IncidentEvidence): Promise<IncidentReport> { const classification = classifyIncident(evidence); const pids = relevantPids(evidence.logLines); const [processTree, tcpListeners] = await Promise.all([collectProcesses(evidence.collectProcessTree, pids), collectListeners(evidence.collectListeners, pids)]); const correlations = parseTunnelCorrelations(evidence.logLines); const report: IncidentReport = { schemaVersion: 1, capturedAt: new Date().toISOString(), appVersion: evidence.appVersion, tunnelClientVersion: evidence.tunnelClientVersion, tunnelClientVersionReason: evidence.tunnelClientVersionReason ?? null, classification: classification.classification, classificationReasons: classification.reasons, updaterEventTail: evidence.updaterEvents.slice(-MAX_ENTRIES), tunnel: { state: evidence.tunnel.state, source: evidence.tunnel.source, message: evidence.tunnel.message, ...correlations, health: { state: evidence.tunnel.health.state, message: evidence.tunnel.health.message } }, mcpCalls: pairMcpCalls(evidence.logLines), tunnelLogTail: evidence.logLines.filter((line) => line.source === 'tunnel').slice(-MAX_ENTRIES).map((line) => ({ timestamp: line.timestamp, text: line.text, lifecycle: line.correlation?.kind === 'tunnel' ? line.correlation.lifecycle ?? 'other' : 'other' })), processTree, tcpListeners }; return sanitizeStrings(report); }
export interface IncidentExportOptions { readonly choosePath: () => Promise<string | null>; readonly writeAtomically: (filePath: string, content: string) => Promise<void>; }
export async function exportIncidentReport(evidence: IncidentEvidence, options: IncidentExportOptions): Promise<{ readonly exported: boolean; readonly cancelled: boolean; readonly classification: IncidentClassification; readonly capturedAt: string | null }> { const report = await buildIncidentReport(evidence); const filePath = await options.choosePath(); if (filePath === null) return { exported: false, cancelled: true, classification: report.classification, capturedAt: null }; await options.writeAtomically(filePath, JSON.stringify(report, null, 2) + '\n'); return { exported: true, cancelled: false, classification: report.classification, capturedAt: report.capturedAt }; }
export async function atomicWrite(filePath: string, content: string): Promise<void> { const temp = `${filePath}.${randomUUID()}.tmp`; try { await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' }); await rename(temp, filePath); } catch (error) { await unlink(temp).catch(() => undefined); throw error; } }
export async function collectRelevantProcessTree(pids: readonly number[]): Promise<readonly IncidentProcess[]> { if (pids.length === 0) return []; const clause = pids.map((pid) => `$_.ProcessId -eq ${pid}`).join(' -or '); const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ${clause} } | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 3_000, encoding: 'utf8' }); return parseRows(stdout).map((row) => ({ pid: number(row.ProcessId), parentPid: number(row.ParentProcessId), executable: safe(typeof row.Name === 'string' ? row.Name : 'unknown') })); }
export async function collectRelevantListeners(pids: readonly number[]): Promise<readonly IncidentListener[]> { if (pids.length === 0) return []; const clause = pids.map((pid) => `$_.OwningProcess -eq ${pid}`).join(' -or '); const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { ${clause} } | Select-Object OwningProcess,LocalAddress,LocalPort | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 3_000, encoding: 'utf8' }); return parseRows(stdout).map((row) => ({ pid: number(row.OwningProcess), address: safe(typeof row.LocalAddress === 'string' ? row.LocalAddress : 'unknown'), port: number(row.LocalPort) })); }
function relevantPids(lines: readonly IncidentLine[]): number[] { const pids = new Set<number>(); for (const line of lines.slice(-MAX_ENTRIES)) if (line.correlation?.kind === 'tunnel' && typeof line.correlation.pid === 'number' && Number.isInteger(line.correlation.pid)) pids.add(line.correlation.pid); return [...pids].slice(-MAX_IDS); }
async function collectProcesses(collector: IncidentEvidence['collectProcessTree'], pids: readonly number[]): Promise<IncidentReport['processTree']> { if (collector === undefined) return { available: false, entries: [], error: 'unavailable' }; try { return { available: true, entries: (await collector(pids)).slice(0, MAX_ENTRIES).map((entry) => ({ pid: entry.pid, parentPid: entry.parentPid, executable: safe(entry.executable) })) }; } catch (error) { return { available: false, entries: [], error: safe(error instanceof Error ? error.message : String(error)) }; } }
async function collectListeners(collector: IncidentEvidence['collectListeners'], pids: readonly number[]): Promise<IncidentReport['tcpListeners']> { if (collector === undefined) return { available: false, entries: [], error: 'unavailable' }; try { return { available: true, entries: (await collector(pids)).slice(0, MAX_ENTRIES).map((entry) => ({ pid: entry.pid, address: safe(entry.address), port: entry.port, owner: entry.owner === undefined ? null : safe(entry.owner).split(/\s+/)[0] ?? null })) }; } catch (error) { return { available: false, entries: [], error: safe(error instanceof Error ? error.message : String(error)) }; } }
function safe(value: string): string {
  return value
    .replace(AUTHORIZATION_VALUE, 'authorization=[REDACTED]')
    .replace(JSON_SECRET_VALUE, '$1"[REDACTED]"')
    .replace(ASSIGNED_SECRET_VALUE, (_match, prefix: string, key: string, separator: string) => `${prefix}${key}${separator}[REDACTED]`)
    .replace(KNOWN_SECRET_PREFIX, '[REDACTED]')
    .slice(0, MAX_TEXT);
}

function sanitizeStrings<T>(value: T): T {
  if (typeof value === 'string') return safe(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeStrings(entry)) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeStrings(entry)])) as T;
}

function completionResult(resultCode: IncidentCall['resultCode']): { readonly resultCode: Exclude<IncidentCall['resultCode'], null>; readonly completionState: Exclude<IncidentCompletionState, 'conflict'> } {
  if (resultCode === 'SUCCESS') return { resultCode, completionState: 'success' };
  if (resultCode === 'FAILED' || resultCode === 'FATAL') return { resultCode, completionState: 'failure' };
  return { resultCode: 'UNKNOWN', completionState: 'unknown' };
}

function sourceSequence(line: IncidentLine, index: number): number {
  return typeof line.id === 'number' && Number.isSafeInteger(line.id) && line.id >= 0 ? line.id : index + 1;
}

function mcpEvidenceIdentity(line: IncidentLine, correlation: Extract<NonNullable<IncidentLine['correlation']>, { readonly kind: 'mcp' }>): string {
  const sourceId = typeof line.id === 'number' && Number.isSafeInteger(line.id) ? `id:${line.id}` : `event:${line.timestamp}:${line.text}`;
  return `${sourceId}:${correlation.phase}:${correlation.callId}:${correlation.toolName}:${String(correlation.resultCode)}`;
}
function parseRows(raw: string): Record<string, unknown>[] { try { const parsed: unknown = JSON.parse(raw || '[]'); return (Array.isArray(parsed) ? parsed : [parsed]).filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null).slice(0, MAX_ENTRIES); } catch { return []; } }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
