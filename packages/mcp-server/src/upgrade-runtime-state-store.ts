import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATE_VERSION = 2;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

export interface UpgradeRuntimeSessionState {
  readonly tasks: readonly unknown[];
  readonly checkpoints: readonly unknown[];
  readonly session: readonly [string, unknown][];
}

export interface UpgradeRuntimeSharedState {
  readonly plugins: readonly unknown[];
  readonly worktrees: readonly unknown[];
}

export interface UpgradeRuntimeStateSnapshot {
  readonly session: UpgradeRuntimeSessionState;
  readonly shared: UpgradeRuntimeSharedState;
}

interface MigrationMarker {
  readonly version: 2;
  readonly migratedAt: string;
  readonly claimedSessionKey: string;
  readonly legacyFound: boolean;
}

interface LockRecord {
  readonly token: string;
  readonly createdAt: string;
}

const EMPTY_SESSION_STATE: UpgradeRuntimeSessionState = Object.freeze({ tasks: [], checkpoints: [], session: [] });
const EMPTY_SHARED_STATE: UpgradeRuntimeSharedState = Object.freeze({ plugins: [], worktrees: [] });

export class UpgradeRuntimeStateStore {
  private readonly stateDirectory: string;
  private readonly sessionsDirectory: string;
  private readonly sessionFile: string;
  private readonly sharedFile: string;
  private readonly migrationMarkerFile: string;
  private readonly migrationLockFile: string;
  private readonly sessionKey: string;

  public constructor(private readonly legacyStatePath: string, ownerKey: string) {
    const normalizedOwner = ownerKey.trim() || 'legacy-owner';
    const basename = path.basename(legacyStatePath, path.extname(legacyStatePath));
    this.stateDirectory = path.join(path.dirname(legacyStatePath), `${basename}.state-v2`);
    this.sessionsDirectory = path.join(this.stateDirectory, 'sessions');
    this.sessionKey = createHash('sha256').update(normalizedOwner).digest('hex').slice(0, 40);
    this.sessionFile = path.join(this.sessionsDirectory, `${this.sessionKey}.json`);
    this.sharedFile = path.join(this.stateDirectory, 'shared.json');
    this.migrationMarkerFile = path.join(this.stateDirectory, 'migration.json');
    this.migrationLockFile = path.join(this.stateDirectory, 'migration.lock');
  }

  public async load(): Promise<UpgradeRuntimeStateSnapshot> {
    await this.ensureMigrated();
    const [session, shared] = await Promise.all([this.readSession(), this.readShared()]);
    return { session, shared };
  }

  public async readShared(): Promise<UpgradeRuntimeSharedState> {
    await this.ensureMigrated();
    return normalizeSharedState(await readJsonRecord(this.sharedFile));
  }

  public async updateSession(
    mutate: (current: UpgradeRuntimeSessionState) => UpgradeRuntimeSessionState,
  ): Promise<UpgradeRuntimeSessionState> {
    await this.ensureMigrated();
    return withFileLock(`${this.sessionFile}.lock`, async () => {
      const current = await this.readSession();
      const next = normalizeSessionState(mutate(current));
      await atomicWriteJson(this.sessionFile, { version: STATE_VERSION, ...next });
      return next;
    });
  }

  public async updateShared(
    mutate: (current: UpgradeRuntimeSharedState) => UpgradeRuntimeSharedState,
  ): Promise<UpgradeRuntimeSharedState> {
    await this.ensureMigrated();
    return withFileLock(`${this.sharedFile}.lock`, async () => {
      const current = normalizeSharedState(await readJsonRecord(this.sharedFile));
      const next = normalizeSharedState(mutate(current));
      await atomicWriteJson(this.sharedFile, { version: STATE_VERSION, ...next });
      return next;
    });
  }

  public sessionStatePath(): string {
    return this.sessionFile;
  }

  public sharedStatePath(): string {
    return this.sharedFile;
  }

  private async readSession(): Promise<UpgradeRuntimeSessionState> {
    return normalizeSessionState(await readJsonRecord(this.sessionFile));
  }

  private async ensureMigrated(): Promise<void> {
    await mkdir(this.sessionsDirectory, { recursive: true });
    if (await pathExists(this.migrationMarkerFile)) return;
    await withFileLock(this.migrationLockFile, async () => {
      if (await pathExists(this.migrationMarkerFile)) return;
      const legacy = await readJsonRecord(this.legacyStatePath);
      const legacyFound = legacy !== undefined;
      if (!(await pathExists(this.sharedFile))) {
        const shared = normalizeSharedState(legacy);
        await atomicWriteJson(this.sharedFile, { version: STATE_VERSION, ...shared });
      }
      if (!(await pathExists(this.sessionFile))) {
        const session = normalizeSessionState(legacy);
        await atomicWriteJson(this.sessionFile, { version: STATE_VERSION, ...session });
      }
      const marker: MigrationMarker = {
        version: STATE_VERSION,
        migratedAt: new Date().toISOString(),
        claimedSessionKey: this.sessionKey,
        legacyFound,
      };
      await atomicWriteJson(this.migrationMarkerFile, marker);
    });
  }
}

function normalizeSessionState(value: unknown): UpgradeRuntimeSessionState {
  const record = asRecord(value);
  return {
    tasks: Array.isArray(record?.tasks) ? record.tasks : EMPTY_SESSION_STATE.tasks,
    checkpoints: Array.isArray(record?.checkpoints) ? record.checkpoints : EMPTY_SESSION_STATE.checkpoints,
    session: Array.isArray(record?.session)
      ? record.session.filter((entry): entry is [string, unknown] => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string')
      : EMPTY_SESSION_STATE.session,
  };
}

function normalizeSharedState(value: unknown): UpgradeRuntimeSharedState {
  const record = asRecord(value);
  return {
    plugins: Array.isArray(record?.plugins) ? record.plugins : EMPTY_SHARED_STATE.plugins,
    worktrees: Array.isArray(record?.worktrees) ? record.worktrees : EMPTY_SHARED_STATE.worktrees,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > MAX_STATE_BYTES) return undefined;
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return asRecord(value);
  } catch {
    return undefined;
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function withFileLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const lock: LockRecord = { token, createdAt: new Date().toISOString() };
      await writeFile(lockPath, JSON.stringify(lock), { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (error: unknown) {
      if (!hasCode(error, 'EEXIST')) throw error;
      await recoverStaleLock(lockPath);
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for runtime state lock: ${path.basename(lockPath)}`);
      await delay(20);
    }
  }

  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, token);
  }
}

async function recoverStaleLock(lockPath: string): Promise<void> {
  try {
    const details = await stat(lockPath);
    if (Date.now() - details.mtimeMs <= LOCK_STALE_MS) return;
    const quarantine = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
    try {
      await rename(lockPath, quarantine);
      await rm(quarantine, { force: true });
    } catch {
      await rm(quarantine, { force: true }).catch(() => undefined);
    }
  } catch {
    // A racing owner may have released the lock already.
  }
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  const quarantine = `${lockPath}.release.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch {
    return;
  }
  try {
    const record = await readJsonRecord(quarantine);
    if (record?.token === token) {
      await rm(quarantine, { force: true });
      return;
    }
    try {
      await rename(quarantine, lockPath);
    } catch {
      // Never delete a lock that no longer proves our ownership.
    }
  } catch {
    // Preserve uncertain lock evidence rather than deleting another owner's lock.
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
