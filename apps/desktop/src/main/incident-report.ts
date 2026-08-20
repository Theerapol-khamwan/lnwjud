import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LogLine, TunnelStatus } from '@lnwjud/ipc-contracts';
import { Redactor } from '@lnwjud/audit';

const execFileAsync = promisify(execFile);
const MAX_ENTRIES = 200;
const MAX_TEXT = 512;
const MAX_IDS = 50;
const redactor = new Redactor();

export type IncidentClassification = 'local_tool_failed' | 'tunnel_disconnected' | 'remote_turn_stopped' | 'healthy_or_inconclusive';
export interface IncidentHealth { readonly healthy: boolean; readonly message: string | null; }
export interface IncidentEvidence {
  readonly triggeredByUser: boolean;
  readonly appVersion: string;
  readonly tunnelClientVersion: string | null;
  readonly tunnel: Pick<TunnelStatus, 'state' | 'source' | 'message'> & { readonly health: IncidentHealth };
  readonly updaterEvents: readonly string[];
  readonly logLines: readonly Pick<LogLine, 'source' | 'text' | 'timestamp'>[];
  readonly collectProcessTree?: (pids: readonly number[]) => Promise<readonly IncidentProcess[]>;
  readonly collectListeners?: (pids: readonly number[]) => Promise<readonly IncidentListener[]>;
}
export interface IncidentProcess { readonly pid: number; readonly parentPid: number | null; readonly executable: string; readonly commandLine?: string; }
export interface IncidentListener { readonly pid: number; readonly address: string; readonly port: number; readonly owner?: string; }
export interface IncidentCall { readonly callId: string; readonly toolName: string | null; readonly resultCode: string | null; readonly incomplete: boolean; readonly startedWithoutCompletion: boolean; readonly completionWithoutStart: boolean; }
export interface IncidentReport {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly appVersion: string;
  readonly tunnelClientVersion: string | null;
  readonly classification: IncidentClassification;
  readonly classificationReasons: readonly string[];
  readonly updaterEventTail: readonly string[];
  readonly tunnel: { readonly state: TunnelStatus['state']; readonly source: TunnelStatus['source']; readonly message: string | null; readonly instanceIds: readonly string[]; readonly requestIds: readonly string[]; readonly loopbackHealth: IncidentHealth; };
  readonly mcpCalls: readonly IncidentCall[];
  readonly tunnelLogTail: readonly { readonly timestamp: string; readonly text: string }[];
  readonly processTree: { readonly available: boolean; readonly entries: readonly { readonly pid: number; readonly parentPid: number | null; readonly executable: string }[]; readonly error?: string; };
  readonly tcpListeners: { readonly available: boolean; readonly entries: readonly { readonly pid: number; readonly address: string; readonly port: number; readonly owner: string | null }[]; readonly error?: string; };
}

export function classifyIncident(evidence: Pick<IncidentEvidence, 'triggeredByUser' | 'tunnel' | 'logLines'>): { readonly classification: IncidentClassification; readonly reasons: readonly string[] } {
  const mcp = evidence.logLines.filter((line) => line.source === 'mcp');
  const tunnel = evidence.logLines.filter((line) => line.source === 'tunnel');
  const lastMcp = mcp.at(-1)?.text ?? '';
  if (/\b(fatal|failed|error)\b/i.test(lastMcp)) return { classification: 'local_tool_failed', reasons: ['last_local_mcp_call_failed'] };
  const tunnelText = [evidence.tunnel.message ?? '', ...tunnel.map((line) => line.text)].join('\n');
  if (!evidence.tunnel.health.healthy || evidence.tunnel.state === 'error' || /\b(ttl|stdio.{0,40}(exit|closed)|shutdown|disconnect)/i.test(tunnelText)) {
    return { classification: 'tunnel_disconnected', reasons: [!evidence.tunnel.health.healthy ? 'loopback_tunnel_unhealthy' : 'tunnel_disconnect_evidence'] };
  }
  if (evidence.triggeredByUser && /\b(success|completed|ok)\b/i.test(lastMcp)) return { classification: 'remote_turn_stopped', reasons: ['manual_capture_after_successful_local_call_with_healthy_tunnel'] };
  return { classification: 'healthy_or_inconclusive', reasons: ['insufficient_non_conflicting_evidence'] };
}

export function pairMcpCalls(lines: readonly Pick<LogLine, 'source' | 'text' | 'timestamp'>[]): readonly IncidentCall[] {
  const calls = new Map<string, { started: boolean; completed: boolean; toolName: string | null; resultCode: string | null }>();
  for (const line of lines) {
    if (line.source !== 'mcp') continue;
    const id = /\bcallId[=:]([A-Za-z0-9._:-]{1,128})/i.exec(line.text)?.[1];
    if (id === undefined) continue;
    const current = calls.get(id) ?? { started: false, completed: false, toolName: null, resultCode: null };
    const task = /^\s*\[TASK\]/i.test(line.text) || /\bin[ -]?flight\b/i.test(line.text);
    const result = /^\s*\[(?:RESULT|ERROR)\]/i.test(line.text) || /\b(SUCCESS|FAILED|ERROR)\b/i.test(line.text);
    if (task) current.started = true;
    if (result) current.completed = true;
    current.toolName ??= /\]\s*([^\s]+)/.exec(line.text)?.[1] ?? null;
    current.resultCode ??= /\b(SUCCESS|FAILED|ERROR)\b/i.exec(line.text)?.[1]?.toUpperCase() ?? null;
    calls.set(id, current);
  }
  return [...calls.entries()].slice(-MAX_ENTRIES).map(([callId, value]) => ({ callId, toolName: value.toolName, resultCode: value.resultCode, incomplete: value.started !== value.completed, startedWithoutCompletion: value.started && !value.completed, completionWithoutStart: !value.started && value.completed }));
}

export function parseTunnelCorrelations(lines: readonly Pick<LogLine, 'source' | 'text' | 'timestamp'>[]): { readonly instanceIds: readonly string[]; readonly requestIds: readonly string[] } {
  const instanceIds = new Set<string>(); const requestIds = new Set<string>();
  for (const line of lines.slice(-MAX_ENTRIES)) {
    if (line.source !== 'tunnel') continue;
    for (const match of line.text.matchAll(/\b(?:instance[_-]?id|instance)[=:]([A-Za-z0-9._:-]{1,128})/ig)) instanceIds.add(match[1]!);
    for (const match of line.text.matchAll(/\b(?:request[_-]?id|request)[=:]([A-Za-z0-9._:-]{1,128})/ig)) requestIds.add(match[1]!);
  }
  return { instanceIds: [...instanceIds].slice(-MAX_IDS), requestIds: [...requestIds].slice(-MAX_IDS) };
}

export async function buildIncidentReport(evidence: IncidentEvidence): Promise<IncidentReport> {
  const classification = classifyIncident(evidence);
  const pids = relevantPids(evidence.logLines);
  const [processTree, tcpListeners] = await Promise.all([collectProcesses(evidence.collectProcessTree, pids), collectListeners(evidence.collectListeners, pids)]);
  const correlations = parseTunnelCorrelations(evidence.logLines);
  return {
    schemaVersion: 1, capturedAt: new Date().toISOString(), appVersion: safe(evidence.appVersion), tunnelClientVersion: evidence.tunnelClientVersion === null ? null : safe(evidence.tunnelClientVersion),
    classification: classification.classification, classificationReasons: classification.reasons, updaterEventTail: evidence.updaterEvents.slice(-MAX_ENTRIES).map(safe),
    tunnel: { state: evidence.tunnel.state, source: evidence.tunnel.source, message: evidence.tunnel.message === null ? null : safe(evidence.tunnel.message), ...correlations, loopbackHealth: { healthy: evidence.tunnel.health.healthy, message: evidence.tunnel.health.message === null ? null : safe(evidence.tunnel.health.message) } },
    mcpCalls: pairMcpCalls(evidence.logLines), tunnelLogTail: evidence.logLines.filter((line) => line.source === 'tunnel').slice(-MAX_ENTRIES).map((line) => ({ timestamp: safe(line.timestamp), text: safe(line.text) })),
    processTree, tcpListeners,
  };
}

export interface IncidentExportOptions { readonly choosePath: () => Promise<string | null>; readonly writeAtomically: (filePath: string, content: string) => Promise<void>; }
export async function exportIncidentReport(evidence: IncidentEvidence, options: IncidentExportOptions): Promise<{ readonly exported: boolean; readonly cancelled: boolean; readonly classification: IncidentClassification }> {
  const report = await buildIncidentReport(evidence);
  const filePath = await options.choosePath();
  if (filePath === null) return { exported: false, cancelled: true, classification: report.classification };
  await options.writeAtomically(filePath, JSON.stringify(report, null, 2) + '\n');
  return { exported: true, cancelled: false, classification: report.classification };
}

export async function atomicWrite(filePath: string, content: string): Promise<void> { const temp = `${filePath}.${randomUUID()}.tmp`; try { await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' }); await rename(temp, filePath); } catch (error) { await unlink(temp).catch(() => undefined); throw error; } }
export async function collectRelevantProcessTree(pids: readonly number[]): Promise<readonly IncidentProcess[]> { if (pids.length === 0) return []; const query = pids.join(','); const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { ${query.split(',').map((pid) => `$_.ProcessId -eq ${pid}`).join(' -or ')} } | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 3_000, encoding: 'utf8' }); const parsed: unknown = JSON.parse(stdout || '[]'); const rows = Array.isArray(parsed) ? parsed : [parsed]; return rows.filter(isRecord).slice(0, MAX_ENTRIES).map((row) => ({ pid: number(row.ProcessId), parentPid: number(row.ParentProcessId), executable: typeof row.Name === 'string' ? row.Name : 'unknown' })); }
export async function collectRelevantListeners(pids: readonly number[]): Promise<readonly IncidentListener[]> { if (pids.length === 0) return []; const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object OwningProcess,LocalAddress,LocalPort | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 3_000, encoding: 'utf8' }); const parsed: unknown = JSON.parse(stdout || '[]'); const allowed = new Set(pids); const rows = Array.isArray(parsed) ? parsed : [parsed]; return rows.filter(isRecord).filter((row) => allowed.has(number(row.OwningProcess))).slice(0, MAX_ENTRIES).map((row) => ({ pid: number(row.OwningProcess), address: typeof row.LocalAddress === 'string' ? row.LocalAddress : 'unknown', port: number(row.LocalPort) })); }

function relevantPids(lines: readonly Pick<LogLine, 'source' | 'text' | 'timestamp'>[]): number[] { const result = new Set<number>(); for (const line of lines.slice(-MAX_ENTRIES)) for (const match of line.text.matchAll(/\bpid[=: ](\d{1,10})\b/ig)) result.add(Number(match[1])); return [...result].slice(-MAX_IDS); }
async function collectProcesses(collector: IncidentEvidence['collectProcessTree'], pids: readonly number[]): Promise<IncidentReport['processTree']> { if (collector === undefined) return { available: false, entries: [], error: 'unavailable' }; try { return { available: true, entries: (await collector(pids)).slice(0, MAX_ENTRIES).map((entry) => ({ pid: entry.pid, parentPid: entry.parentPid, executable: safe(entry.executable) })) }; } catch (error) { return { available: false, entries: [], error: safe(error instanceof Error ? error.message : String(error)) }; } }
async function collectListeners(collector: IncidentEvidence['collectListeners'], pids: readonly number[]): Promise<IncidentReport['tcpListeners']> { if (collector === undefined) return { available: false, entries: [], error: 'unavailable' }; try { return { available: true, entries: (await collector(pids)).slice(0, MAX_ENTRIES).map((entry) => ({ pid: entry.pid, address: safe(entry.address), port: entry.port, owner: entry.owner === undefined ? null : safe(entry.owner).split(/\s+/)[0] ?? null })) }; } catch (error) { return { available: false, entries: [], error: safe(error instanceof Error ? error.message : String(error)) }; } }
function safe(value: string): string { const baseline = redactor.redact(value); const text = typeof baseline === 'string' ? baseline : ''; return text.replace(/authorization\s*[=:]\s*bearer\s+[A-Za-z0-9._-]+/ig, 'Authorization=[REDACTED]').replace(/(api[_-]?key|token|authorization|password|secret)\s*[=:]\s*[^\s,;]+/ig, '$1=[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._-]+/ig, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/ig, '[REDACTED]').replace(/--(?:api-key|token|password|secret)\s+\S+/ig, '--[REDACTED]').slice(0, MAX_TEXT); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
