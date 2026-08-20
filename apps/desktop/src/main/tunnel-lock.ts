import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOCK_FILE = 'lnwjud.tunnel.lock';
const LOCK_VERSION = 1;
const DEFAULT_INCOMPLETE_LOCK_MAX_AGE_MS = 2_000;
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
  readonly incompleteLockMaxAgeMs?: number;
}

export async function acquireTunnelLock(options: TunnelLockOptions): Promise<TunnelLockAcquisition | TunnelLockAlreadyOwned> {
  const lockPath = tunnelLockPath(options.profileDirectory);
  const owner = options.owner ?? await currentProcessOwner();
  const inspectProcess = options.inspectProcess ?? processStartedAt;
  await mkdir(options.profileDirectory, { recursive: true });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const lock = await open(lockPath, 'wx');
      try {
        await lock.writeFile(serializeOwner(owner), 'utf8');
      } finally {
        await lock.close();
      }
      return {
        acquired: true,
        owner,
        release: async (): Promise<boolean> => releaseTunnelLock(lockPath, owner),
      };
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error;
    }

    const existing = await readTunnelLock(options.profileDirectory);
    if (existing === null) {
      // A concurrent CreateNew owner can be between opening and writing its
      // immutable payload. Wait rather than treating that owner as stale.
      if (await incompleteLockIsOld(lockPath, options.incompleteLockMaxAgeMs ?? DEFAULT_INCOMPLETE_LOCK_MAX_AGE_MS)) {
        await reclaimIncompleteLock(lockPath);
        continue;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      continue;
    }
    const actualStartedAt = await inspectProcess(existing.pid);
    if (actualStartedAt === existing.processStartedAt) return { acquired: false, owner: existing };
    await reclaimVerifiedStaleLock(lockPath, existing);
  }
  throw new Error(`Unable to acquire tunnel lock: ${lockPath}`);
}

async function incompleteLockIsOld(lockPath: string, maxAgeMs: number): Promise<boolean> {
  try { return Date.now() - (await stat(lockPath)).mtimeMs > maxAgeMs; } catch { return false; }
}

async function reclaimIncompleteLock(lockPath: string): Promise<void> {
  const quarantinePath = `${lockPath}.incomplete.${process.pid}.${Date.now()}`;
  try { await rename(lockPath, quarantinePath); } catch (error: unknown) { if (isNotFound(error)) return; throw error; }
  // The mtime age was bounded before the move; retain unexpected valid content.
  if (parseOwner(await readFile(quarantinePath, 'utf8')) === null) await rm(quarantinePath, { force: true });
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

async function reclaimVerifiedStaleLock(lockPath: string, staleOwner: TunnelLockOwner): Promise<void> {
  // Renaming, rather than deleting the live path, keeps the stale record available
  // for validation and makes a competing fresh create visible to the next loop.
  const quarantinePath = `${lockPath}.stale.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw error;
  }
  let verifiedStale = false;
  try {
    const movedOwner = parseOwner(await readFile(quarantinePath, 'utf8'));
    if (!sameOwner(movedOwner, staleOwner)) {
      throw new Error(`Tunnel lock changed while stale recovery was in progress: ${lockPath}`);
    }
    verifiedStale = true;
  } finally {
    // Only a verified stale quarantine path is removed; never delete an
    // unverified replacement or the active lock path.
    if (verifiedStale) await rm(quarantinePath, { force: true });
  }
}

async function releaseTunnelLock(lockPath: string, owner: TunnelLockOwner): Promise<boolean> {
  let current: TunnelLockOwner | null;
  try {
    current = parseOwner(await readFile(lockPath, 'utf8'));
  } catch {
    return false;
  }
  if (!sameOwner(current, owner)) return false;
  // The lock payload is immutable for its lifetime. Re-read, then move the
  // exact record aside before deletion so a replaced active pathname is never
  // removed by a previous owner.
  try {
    const confirmed = parseOwner(await readFile(lockPath, 'utf8'));
    if (!sameOwner(confirmed, owner)) return false;
    const releasePath = `${lockPath}.released.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    await rename(lockPath, releasePath);
    const moved = parseOwner(await readFile(releasePath, 'utf8'));
    if (!sameOwner(moved, owner)) return false;
    await rm(releasePath, { force: false });
    return true;
  } catch {
    return false;
  }
}

function parseOwner(raw: string): TunnelLockOwner | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== LOCK_VERSION || !Number.isInteger(record.pid) || typeof record.processStartedAt !== 'string' || typeof record.acquiredAt !== 'string') return null;
    if ((record.pid as number) <= 0 || !ISO_UTC_MILLISECONDS.test(record.processStartedAt) || !ISO_UTC_MILLISECONDS.test(record.acquiredAt)) return null;
    return { pid: record.pid as number, processStartedAt: record.processStartedAt, acquiredAt: record.acquiredAt };
  } catch {
    return null;
  }
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
