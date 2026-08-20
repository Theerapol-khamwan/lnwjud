import { execFile } from 'node:child_process';
import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOCK_FILE = 'lnwjud.tunnel.lock';
const LOCK_VERSION = 1;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface TunnelLockOwner {
  readonly pid: number;
  readonly processStartedAt: string;
  readonly acquiredAt: string;
}

export interface TunnelLockHandle {
  readonly owner: TunnelLockOwner;
  release(): Promise<boolean>;
}

export interface TunnelLockAcquisition extends TunnelLockHandle {
  readonly acquired: true;
}

export interface TunnelLockAlreadyOwned {
  readonly acquired: false;
  readonly owner: TunnelLockOwner;
}

export interface TunnelLockOptions {
  readonly profileDirectory: string;
  readonly owner?: TunnelLockOwner;
  readonly inspectProcess?: (pid: number) => Promise<string | null>;
  readonly hooks?: {
    readonly beforePublish?: (temporaryPath: string) => Promise<void>;
    readonly beforeStaleQuarantine?: () => Promise<void>;
    readonly beforeReleaseQuarantine?: () => Promise<void>;
  };
}

export async function acquireTunnelLock(options: TunnelLockOptions): Promise<TunnelLockAcquisition | TunnelLockAlreadyOwned> {
  const lockPath = tunnelLockPath(options.profileDirectory);
  const owner = options.owner ?? await currentProcessOwner();
  const inspectProcess = options.inspectProcess ?? processStartedAt;
  if (!isValidOwner(owner)) throw new Error('Tunnel lock owner metadata is invalid');
  await mkdir(options.profileDirectory, { recursive: true });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const temporaryPath = `${lockPath}.publish.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    try {
      const lock = await open(temporaryPath, 'wx');
      try {
        await lock.writeFile(serializeOwner(owner), 'utf8');
        await lock.sync();
      } finally {
        await lock.close();
      }
      await options.hooks?.beforePublish?.(temporaryPath);
      // link fails with EEXIST and never replaces the current owner record.
      await link(temporaryPath, lockPath);
      await rm(temporaryPath, { force: false });
      return {
        acquired: true,
        owner,
        release: async (): Promise<boolean> => releaseTunnelLock(lockPath, owner, options.hooks),
      };
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true });
      if (!isAlreadyExists(error)) throw error;
    }

    const existing = await readTunnelLock(options.profileDirectory);
    if (existing === null) {
      throw new Error(`Tunnel lock has invalid owner metadata: ${lockPath}`);
    }
    const actualStartedAt = await inspectProcess(existing.pid);
    if (actualStartedAt === existing.processStartedAt) return { acquired: false, owner: existing };
    await reclaimVerifiedStaleLock(lockPath, existing, options.hooks);
  }
  throw new Error(`Unable to acquire tunnel lock: ${lockPath}`);
}


export async function readTunnelLock(profileDirectory: string): Promise<TunnelLockOwner | null> {
  try {
    return parseOwner(await readFile(tunnelLockPath(profileDirectory), 'utf8'));
  } catch {
    return null;
  }
}

export function tunnelLockPath(profileDirectory: string): string {
  return path.join(profileDirectory, LOCK_FILE);
}

async function reclaimVerifiedStaleLock(lockPath: string, staleOwner: TunnelLockOwner, hooks: TunnelLockOptions['hooks']): Promise<void> {
  // Renaming, rather than deleting the live path, keeps the stale record available
  // for validation and makes a competing fresh create visible to the next loop.
  const quarantinePath = `${lockPath}.stale.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await hooks?.beforeStaleQuarantine?.();
  try {
    await rename(lockPath, quarantinePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw error;
  }
  const movedOwner = parseOwner(await readFile(quarantinePath, 'utf8'));
  if (!sameOwner(movedOwner, staleOwner)) {
    await restoreQuarantinedRecord(lockPath, quarantinePath);
    throw new Error(`Tunnel lock changed while stale recovery was in progress: ${lockPath}`);
  }
  await rm(quarantinePath, { force: false });
}

async function releaseTunnelLock(lockPath: string, owner: TunnelLockOwner, hooks: TunnelLockOptions['hooks']): Promise<boolean> {
  let current: TunnelLockOwner | null;
  try {
    current = parseOwner(await readFile(lockPath, 'utf8'));
  } catch {
    return false;
  }
  if (!sameOwner(current, owner)) return false;
  const releasePath = `${lockPath}.released.${owner.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  try {
    await hooks?.beforeReleaseQuarantine?.();
    await rename(lockPath, releasePath);
    const moved = parseOwner(await readFile(releasePath, 'utf8'));
    if (!sameOwner(moved, owner)) {
      await restoreQuarantinedRecord(lockPath, releasePath);
      return false;
    }
    await rm(releasePath, { force: false });
    return true;
  } catch {
    return false;
  }
}

async function restoreQuarantinedRecord(lockPath: string, quarantinePath: string): Promise<void> {
  try {
    // Linking restores only into an empty fixed path and never overwrites a
    // concurrently published owner. The quarantine remains if restoration is
    // blocked, preserving the valid record for recovery instead of losing it.
    await link(quarantinePath, lockPath);
    await rm(quarantinePath, { force: false });
  } catch (error: unknown) {
    if (!isAlreadyExists(error) && !isNotFound(error)) throw error;
  }
}

function parseOwner(raw: string): TunnelLockOwner | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== LOCK_VERSION || !Number.isInteger(record.pid) || typeof record.processStartedAt !== 'string' || typeof record.acquiredAt !== 'string') return null;
    if ((record.pid as number) <= 0 || (record.pid as number) > 2_147_483_647 || !isUtcMillisecondTimestamp(record.processStartedAt) || !isUtcMillisecondTimestamp(record.acquiredAt)) return null;
    return { pid: record.pid as number, processStartedAt: record.processStartedAt, acquiredAt: record.acquiredAt };
  } catch {
    return null;
  }
}

function isValidOwner(owner: TunnelLockOwner): boolean {
  return Number.isInteger(owner.pid)
    && owner.pid > 0
    && owner.pid <= 2_147_483_647
    && isUtcMillisecondTimestamp(owner.processStartedAt)
    && isUtcMillisecondTimestamp(owner.acquiredAt);
}

function isUtcMillisecondTimestamp(value: string): boolean {
  if (!ISO_UTC_MILLISECONDS.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function serializeOwner(owner: TunnelLockOwner): string {
  return JSON.stringify({ version: LOCK_VERSION, pid: owner.pid, processStartedAt: owner.processStartedAt, acquiredAt: owner.acquiredAt });
}

function sameOwner(left: TunnelLockOwner | null, right: TunnelLockOwner): boolean {
  return left !== null
    && left.pid === right.pid
    && left.processStartedAt === right.processStartedAt
    && left.acquiredAt === right.acquiredAt;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function currentProcessOwner(): Promise<TunnelLockOwner> {
  const startedAt = await processStartedAt(process.pid);
  if (startedAt === null) throw new Error('Could not determine this process start time for the tunnel lock');
  return { pid: process.pid, processStartedAt: startedAt, acquiredAt: new Date().toISOString() };
}

async function processStartedAt(pid: number): Promise<string | null> {
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($null -ne $process) { $process.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture) }`,
    ], { windowsHide: true, encoding: 'utf8', timeout: 3_000 });
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
