import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, ok, type AppErrorCode, type Result } from '@lnwjud/domain';
import { WindowsProcessTree, type ProcessTreeTerminator } from '@lnwjud/process';
import type { NativeCapabilityBridge, NativeCapabilityName } from './windows-native-backend.js';

const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_SECONDS = 14_400;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const APP_ERROR_CODES: readonly AppErrorCode[] = [
  'INVALID_INPUT', 'WORKSPACE_NOT_FOUND', 'PATH_OUTSIDE_WORKSPACE', 'SECRET_ACCESS_DENIED', 'PERMISSION_DENIED',
  'PERMISSION_REQUIRED', 'FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'BINARY_FILE', 'PROCESS_NOT_FOUND', 'PROCESS_TIMEOUT',
  'EXECUTABLE_NOT_FOUND', 'GIT_NOT_REPOSITORY', 'CODEX_NOT_AVAILABLE', 'INTERNAL_ERROR',
];

export interface MacosCapabilityBridgeOptions {
  /** Absolute path to the signed/bundled Swift helper. */
  readonly helperPath: string;
  readonly platform?: NodeJS.Platform;
  readonly terminator?: ProcessTreeTerminator;
  readonly maxOutputBytes?: number;
}

/**
 * JSON-over-stdin adapter for the bundled macOS helper. The helper is a fresh
 * process per request, which keeps TCC/Automation failures isolated from the
 * Node host and prevents arbitrary shell evaluation of MCP input.
 */
export class MacosCapabilityBridge implements NativeCapabilityBridge {
  private readonly helperPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly terminator: ProcessTreeTerminator;
  private readonly maxOutputBytes: number;

  public constructor(options: MacosCapabilityBridgeOptions) {
    this.helperPath = path.resolve(options.helperPath);
    this.platform = options.platform ?? process.platform;
    this.terminator = options.terminator ?? new WindowsProcessTree();
    this.maxOutputBytes = Math.max(1_024, Math.min(options.maxOutputBytes ?? MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES));
  }

  public async execute(request: { readonly capability: NativeCapabilityName; readonly input: unknown }, signal?: AbortSignal): Promise<Result<unknown>> {
    if (this.platform !== 'darwin') return err(appError('INTERNAL_ERROR', 'macOS bridge is unavailable on this platform', true));
    if (signal?.aborted === true) return cancelled();
    const trusted = await this.verifyHelper();
    if (!trusted.ok) return trusted;
    let serialized: string;
    try {
      serialized = JSON.stringify(request);
    } catch {
      return err(appError('INVALID_INPUT', 'macOS bridge input could not be serialized'));
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stopped: 'cancelled' | 'timed_out' | undefined;
      let settled = false;
      const child = spawn(this.helperPath, [], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const stop = (reason: 'cancelled' | 'timed_out'): void => {
        if (stopped !== undefined) return;
        stopped = reason;
        const pid = child.pid;
        if (pid !== undefined) void this.terminator.stop(child, pid).catch(() => undefined);
        else if (child.exitCode === null) child.kill('SIGTERM');
      };
      const timeout = setTimeout(() => stop('timed_out'), timeoutSeconds(request.input) * 1_000);
      const onAbort = (): void => stop('cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        const remaining = this.maxOutputBytes - Buffer.byteLength(stdout, 'utf8');
        if (remaining > 0) stdout += value.slice(0, remaining);
      });
      child.stderr?.resume();
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (stopped !== undefined) {
          resolve(err(appError('PROCESS_TIMEOUT', stopped === 'cancelled' ? 'macOS capability operation was cancelled' : 'macOS capability operation timed out', true)));
          return;
        }
        const result = parseResult(stdout);
        resolve(result ?? err(appError('INTERNAL_ERROR', 'macOS helper returned an invalid response', true)));
      };
      child.once('error', () => finish());
      child.once('close', finish);
      child.stdin?.end(serialized, 'utf8');
    });
  }

  private async verifyHelper(): Promise<Result<void>> {
    try {
      const info = await lstat(this.helperPath);
      if (!info.isFile() || info.isSymbolicLink()) return err(appError('INTERNAL_ERROR', 'macOS helper is not a trusted regular file'));
      const canonical = await realpath(this.helperPath);
      if (canonical !== this.helperPath) return err(appError('INTERNAL_ERROR', 'macOS helper path resolves through a symbolic link'));
      return ok(undefined);
    } catch (error) {
      return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'macOS helper is unavailable', true));
    }
  }
}

function timeoutSeconds(input: unknown): number {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return DEFAULT_TIMEOUT_SECONDS;
  const value = (input as Record<string, unknown>).timeout_seconds;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0.1, Math.min(MAX_TIMEOUT_SECONDS, value))
    : DEFAULT_TIMEOUT_SECONDS;
}

function parseResult(value: string): Result<unknown> | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(value.trim()) as unknown; } catch { return undefined; }
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') return undefined;
  if (parsed.ok) return ok(parsed.value);
  const failure = parsed.error;
  if (!isRecord(failure) || typeof failure.code !== 'string' || typeof failure.message !== 'string' || typeof failure.recoverable !== 'boolean') return undefined;
  return err(appError(APP_ERROR_CODES.includes(failure.code as AppErrorCode) ? failure.code as AppErrorCode : 'INTERNAL_ERROR', failure.message, failure.recoverable));
}

function cancelled(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'macOS capability operation was cancelled', true));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
