import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ActivitySink, ActivitySinkEvent } from './activity-tracker.js';

const execFileAsync = promisify(execFile);
const SNAPSHOT_FILE = 'lnwjud.mcp.activity.json';
const SNAPSHOT_VERSION = 1;
const DEFAULT_STALE_AFTER_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_PROCESS_PROBE_TIMEOUT_MS = 1_750;
const DEFAULT_PROCESS_PROBE_ATTEMPTS = 2;
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface SharedActivityOwner {
  readonly pid: number;
  readonly processStartedAt: string;
}

interface SharedActivitySnapshot {
  readonly version: 1;
  readonly owner: SharedActivityOwner;
  readonly activeCount: number;
  readonly revision: number;
  readonly updatedAt: string;
}

export type ProcessProbeResult =
  | { readonly state: 'live'; readonly processStartedAt: string }
  | { readonly state: 'gone' }
  | { readonly state: 'unverifiable'; readonly reason: string };

export interface ProcessProbeOptions {
  readonly runProbe?: (pid: number, timeoutMs: number) => Promise<string>;
  readonly timeoutMs?: number;
  readonly attempts?: number;
}

export type SharedActivityObservation =
  | { readonly state: 'available'; readonly owner: SharedActivityOwner; readonly activeCount: number; readonly revision: number; readonly updatedAt: string }
  | { readonly state: 'missing'; readonly reason: 'snapshot_missing' }
  | { readonly state: 'stale'; readonly reason: 'snapshot_expired' | 'owner_gone' | 'owner_reused' }
  | { readonly state: 'unverifiable'; readonly reason: string };

export interface SharedActivitySnapshotLeaseOptions {
  readonly profileDirectory: string;
  readonly owner: SharedActivityOwner;
  readonly now?: () => Date;
  readonly heartbeatMs?: number;
  readonly hooks?: { readonly afterCloseQuarantine?: () => Promise<void> };
}

export class SharedActivitySnapshotLease implements ActivitySink {
  private readonly snapshotPath: string;
  private readonly now: () => Date;
  private readonly heartbeatMs: number;
  private activeCount = 0;
  private revision = 0;
  private initialized = false;
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private operations: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: SharedActivitySnapshotLeaseOptions) {
    if (!validOwner(options.owner)) throw new Error('Shared activity owner metadata is invalid');
    this.snapshotPath = sharedActivitySnapshotPath(options.profileDirectory);
    this.now = options.now ?? ((): Date => new Date());
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }

  public initialize(): Promise<void> {
    return this.enqueue(async () => {
      if (this.initialized) return;
      if (this.closed) throw new Error('Shared activity lease is closed');
      await mkdir(this.options.profileDirectory, { recursive: true });
      await this.publish();
      this.initialized = true;
      if (this.heartbeatMs > 0) {
        this.heartbeat = setInterval(() => { void this.refresh(); }, this.heartbeatMs);
        this.heartbeat.unref?.();
      }
    });
  }

  public record(event: ActivitySinkEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.initializeInsideOperation();
      if (event.phase === 'started') this.activeCount += 1;
      else this.activeCount = Math.max(0, this.activeCount - 1);
      this.revision += 1;
      await this.publish();
    });
  }

  public close(): Promise<boolean> {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    return this.enqueue(async () => {
      this.closed = true;
      const quarantinePath = `${this.snapshotPath}.closed.${process.pid}.${randomUUID()}`;
      try {
        await rename(this.snapshotPath, quarantinePath);
      } catch {
        return false;
      }
      try {
        const moved = parseSnapshot(await readBoundedSnapshot(quarantinePath));
        if (moved === null || !sameOwner(moved.owner, this.options.owner)) {
          await restoreSnapshot(quarantinePath, this.snapshotPath);
          return false;
        }
        await this.options.hooks?.afterCloseQuarantine?.();
        await rm(quarantinePath, { force: false });
        return true;
      } catch {
        await restoreSnapshot(quarantinePath, this.snapshotPath).catch(() => undefined);
        return false;
      }
    });
  }

  private refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.initialized || this.closed) return;
      await this.publish();
    }).catch(() => undefined);
  }

  private async initializeInsideOperation(): Promise<void> {
    if (this.initialized) return;
    if (this.closed) throw new Error('Shared activity lease is closed');
    await mkdir(this.options.profileDirectory, { recursive: true });
    await this.publish();
    this.initialized = true;
    if (this.heartbeatMs > 0) {
      this.heartbeat = setInterval(() => { void this.refresh(); }, this.heartbeatMs);
      this.heartbeat.unref?.();
    }
  }

  private async publish(): Promise<void> {
    const snapshot: SharedActivitySnapshot = {
      version: SNAPSHOT_VERSION,
      owner: this.options.owner,
      activeCount: this.activeCount,
      revision: this.revision,
      updatedAt: this.now().toISOString(),
    };
    const temporaryPath = `${this.snapshotPath}.publish.${process.pid}.${randomUUID()}`;
    try {
      await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, this.snapshotPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation, operation);
    this.operations = next.catch(() => undefined);
    return next;
  }
}

export interface ReadSharedActivitySnapshotOptions {
  readonly profileDirectory: string;
  readonly inspectProcess?: (pid: number) => Promise<ProcessProbeResult>;
  readonly now?: () => Date;
  readonly staleAfterMs?: number;
}

export async function readSharedActivitySnapshot(options: ReadSharedActivitySnapshotOptions): Promise<SharedActivityObservation> {
  let raw: string;
  try {
    raw = await readBoundedSnapshot(sharedActivitySnapshotPath(options.profileDirectory));
  } catch (error: unknown) {
    return isNotFound(error)
      ? { state: 'missing', reason: 'snapshot_missing' }
      : { state: 'unverifiable', reason: 'snapshot_read_failed' };
  }
  const snapshot = parseSnapshot(raw);
  if (snapshot === null) return { state: 'unverifiable', reason: 'invalid_snapshot' };
  const ageMs = (options.now?.() ?? new Date()).getTime() - new Date(snapshot.updatedAt).getTime();
  if (ageMs > (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)) return { state: 'stale', reason: 'snapshot_expired' };
  const probe = await (options.inspectProcess?.(snapshot.owner.pid) ?? probeProcessStart(snapshot.owner.pid));
  if (probe.state === 'unverifiable') return probe;
  if (probe.state === 'gone') return { state: 'stale', reason: 'owner_gone' };
  if (probe.processStartedAt !== snapshot.owner.processStartedAt) return { state: 'stale', reason: 'owner_reused' };
  return { state: 'available', owner: snapshot.owner, activeCount: snapshot.activeCount, revision: snapshot.revision, updatedAt: snapshot.updatedAt };
}

export async function currentSharedActivityOwner(): Promise<SharedActivityOwner> {
  const probe = await probeProcessStart(process.pid);
  if (probe.state !== 'live') throw new Error(`Could not verify STDIO activity owner process: ${probe.state === 'unverifiable' ? probe.reason : 'gone'}`);
  return { pid: process.pid, processStartedAt: probe.processStartedAt };
}

export async function probeProcessStart(pid: number, options: ProcessProbeOptions = {}): Promise<ProcessProbeResult> {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) return { state: 'unverifiable', reason: 'invalid_pid' };
  const runProbe = options.runProbe ?? runWindowsProcessProbe;
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PROCESS_PROBE_TIMEOUT_MS);
  const attempts = Math.min(3, positiveInteger(options.attempts, DEFAULT_PROCESS_PROBE_ATTEMPTS));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return parseProcessProbeOutput(await runProbe(pid, timeoutMs));
    } catch (error: unknown) {
      if (!isProcessProbeTimeout(error)) return { state: 'unverifiable', reason: 'probe_failed' };
      if (attempt === attempts) return { state: 'unverifiable', reason: 'probe_timeout' };
    }
  }
  return { state: 'unverifiable', reason: 'probe_timeout' };
}

export function parseProcessProbeOutput(stdout: string): ProcessProbeResult {
  const value = stdout.trim();
  if (value === 'GONE') return { state: 'gone' };
  if (value.startsWith('LIVE|') && validTimestamp(value.slice(5))) return { state: 'live', processStartedAt: value.slice(5) };
  return { state: 'unverifiable', reason: 'invalid_probe_response' };
}

export function sharedActivitySnapshotPath(profileDirectory: string): string {
  return path.join(profileDirectory, SNAPSHOT_FILE);
}

function parseSnapshot(raw: string): SharedActivitySnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== SNAPSHOT_VERSION || typeof record.owner !== 'object' || record.owner === null || Array.isArray(record.owner)) return null;
    const ownerRecord = record.owner as Record<string, unknown>;
    const parsedOwner = { pid: ownerRecord.pid, processStartedAt: ownerRecord.processStartedAt };
    if (!validOwner(parsedOwner)) return null;
    if (!Number.isSafeInteger(record.activeCount) || (record.activeCount as number) < 0 || !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 || typeof record.updatedAt !== 'string' || !validTimestamp(record.updatedAt)) return null;
    return { version: 1, owner: parsedOwner, activeCount: record.activeCount as number, revision: record.revision as number, updatedAt: record.updatedAt };
  } catch {
    return null;
  }
}

function validOwner(value: unknown): value is SharedActivityOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.pid) && (record.pid as number) > 0 && (record.pid as number) <= 2_147_483_647
    && typeof record.processStartedAt === 'string' && validTimestamp(record.processStartedAt);
}

function validTimestamp(value: string): boolean {
  if (!ISO_UTC_MILLISECONDS.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function sameOwner(left: SharedActivityOwner, right: SharedActivityOwner): boolean {
  return left.pid === right.pid && left.processStartedAt === right.processStartedAt;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readBoundedSnapshot(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (stats.size > MAX_SNAPSHOT_BYTES) throw new Error('activity_snapshot_too_large');
    const buffer = Buffer.alloc(stats.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function restoreSnapshot(quarantinePath: string, snapshotPath: string): Promise<void> {
  try {
    await rename(quarantinePath, snapshotPath);
  } catch (error: unknown) {
    // A fresh publisher may already own the fixed path. Never overwrite it.
    if (!isAlreadyExists(error) && !isNotFound(error)) throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && ['EEXIST', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code ?? ''));
}

async function runWindowsProcessProbe(pid: number, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference='Stop'; try{$p=Get-Process -Id ${pid} -ErrorAction Stop}catch{if($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*'){'GONE';exit 0};throw}; 'LIVE|' + $p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)`,
  ], { windowsHide: true, encoding: 'utf8', timeout: timeoutMs });
  return stdout;
}

function isProcessProbeTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { readonly code?: unknown; readonly killed?: unknown; readonly signal?: unknown };
  return value.code === 'ETIMEDOUT'
    || value.killed === true
    || (value.code == null && value.signal === 'SIGTERM');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}
