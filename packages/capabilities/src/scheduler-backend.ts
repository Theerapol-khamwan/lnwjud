import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { appError, err, isApplicationAuthorized, ok, type InvocationAuthorization, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';

const execFileAsync = promisify(execFile);
const TASK_NAME_PATTERN = /^[\w .-]{1,200}$/;
const MACOS_SCHEDULES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'ONLOGON', 'ONSTART']);

export interface SchedulerRunResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface SchedulerBackendOptions {
  readonly platform?: NodeJS.Platform;
  readonly executable?: string;
  readonly runImpl?: (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<SchedulerRunResult>;
  /** Injectable per-user LaunchAgent location for macOS tests and sandboxes. */
  readonly launchAgentsDirectory?: string;
  readonly uid?: number;
}

export class SchedulerCapabilityBackend implements CapabilityBackend {
  private readonly platform: NodeJS.Platform;
  private readonly executable: string;
  private readonly runImpl: (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<SchedulerRunResult>;
  private readonly launchAgentsDirectory: string;
  private readonly uid: number;

  public constructor(options: SchedulerBackendOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.executable = options.executable ?? (this.platform === 'darwin' ? '/bin/launchctl' : 'schtasks.exe');
    this.launchAgentsDirectory = options.launchAgentsDirectory ?? path.join(os.homedir(), 'Library', 'LaunchAgents');
    this.uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
    this.runImpl = options.runImpl ?? (async (executable, args, signal): Promise<SchedulerRunResult> => {
      const result = await execFileAsync(executable, [...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
      return { stdout: typeof result.stdout === 'string' ? result.stdout : '', stderr: typeof result.stderr === 'string' ? result.stderr : '' };
    });
  }

  public async execute(input: unknown, signal?: AbortSignal, authorization?: InvocationAuthorization): Promise<Result<unknown>> {
    if (this.platform !== 'win32' && this.platform !== 'darwin') return err(appError('INTERNAL_ERROR', 'Scheduled tasks are unavailable on this platform', true));
    const parsed = parseRequest(input);
    if (!parsed.ok) return parsed;
    if (isSignalAborted(signal)) return cancelledOperation();
    const request = parsed.value;
    if (this.platform === 'darwin' && request.action === 'create' && !MACOS_SCHEDULES.has(request.schedule)) {
      return err(appError('INVALID_INPUT', 'macOS launchd supports DAILY, WEEKLY, MONTHLY, ONLOGON, and ONSTART schedules'));
    }

    try {
      if (request.dryRun) {
        return ok({
          dry_run: true,
          action: request.action,
          ...(request.taskName.length === 0 ? {} : { task_name: request.taskName }),
          ...(request.action === 'create' ? {
            command: request.command,
            arguments: request.arguments,
            schedule: request.schedule,
            start_time: request.startTime,
          } : {}),
        });
      }
      if (request.action !== 'list' && !isApplicationAuthorized(authorization, request.userConfirmed)) {
        return err(appError(
          'PERMISSION_REQUIRED',
          'Creating, running, or deleting a scheduled task requires explicit user confirmation',
        ));
      }
      switch (request.action) {
        case 'list': return ok({ tasks: this.platform === 'darwin' ? await this.listMacos(signal) : await this.list(signal) });
        case 'create': return ok(this.platform === 'darwin'
          ? await this.createMacos(request.taskName, request.command, request.arguments ?? [], request.schedule ?? 'DAILY', request.startTime ?? '09:00', signal)
          : await this.create(request.taskName, request.command, request.arguments ?? [], request.schedule ?? 'DAILY', request.startTime ?? '09:00', signal));
        case 'delete': return ok(this.platform === 'darwin' ? await this.deleteMacos(request.taskName, signal) : await this.delete(request.taskName, signal));
        case 'run': return ok(this.platform === 'darwin' ? await this.runMacos(request.taskName, signal) : await this.run(request.taskName, signal));
      }
    } catch (error: unknown) {
      const detail = extractDetail(error);
      if (request.action !== 'list') {
        const reason = isSignalAborted(signal) || (error instanceof Error && error.name === 'AbortError')
          ? 'Scheduled task operation was cancelled or timed out after dispatch'
          : (detail.length > 0 ? detail : 'Scheduled task operation failed after dispatch');
        return uncertainMutationFailure(reason);
      }
      if (isSignalAborted(signal) || (error instanceof Error && error.name === 'AbortError')) return cancelledOperation();
      return err(appError('INTERNAL_ERROR', detail.length > 0 ? detail : 'Scheduled task operation failed', true));
    }
  }

  private async list(signal?: AbortSignal): Promise<readonly Record<string, unknown>[]> {
    const result = await this.runCommand(['/Query', '/FO', 'LIST'], signal);
    const lines = result.stdout.split(/\r?\n/);
    const tasks: Record<string, unknown>[] = [];
    let current: Record<string, unknown> | null = null;
    for (const raw of lines) {
      const separator = raw.indexOf(':');
      if (separator < 0) {
        if (current !== null) {
          tasks.push(current);
          current = null;
        }
        continue;
      }
      const key = raw.slice(0, separator).trim();
      const value = raw.slice(separator + 1).trim();
      if (key.length === 0 || value.length === 0) continue;
      if (key === 'TaskName') {
        if (current !== null) tasks.push(current);
        current = { name: value };
      } else if (current !== null) {
        current[key.toLowerCase().replace(/[^a-z0-9]/g, '_')] = value;
      }
    }
    if (current !== null) tasks.push(current);
    return tasks;
  }

  private async create(taskName: string, command: string, args: readonly string[], schedule: string, startTime: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const taskRun = buildTaskRun(command, args);
    await this.runCommand([
      '/Create', '/TN', taskName, '/TR', taskRun,
      '/SC', schedule.toUpperCase(), '/ST', startTime,
    ], signal);
    return { created: true, task_name: taskName, schedule, start_time: startTime };
  }

  private async delete(taskName: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await this.runCommand(['/Delete', '/TN', taskName, '/F'], signal);
    return { deleted: true, task_name: taskName };
  }

  private async run(taskName: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await this.runCommand(['/Run', '/TN', taskName], signal);
    return { started: true, task_name: taskName };
  }

  private runCommand(args: readonly string[], signal?: AbortSignal): Promise<SchedulerRunResult> {
    return signal === undefined
      ? this.runImpl(this.executable, args)
      : this.runImpl(this.executable, args, signal);
  }

  private launchdDomain(): string { return `gui/${this.uid}`; }

  private launchdLabel(taskName: string): string { return `com.lnwjud.scheduler.${taskName.replace(/[^A-Za-z0-9_-]/g, '_')}`; }

  private launchdPath(taskName: string): string { return path.join(this.launchAgentsDirectory, `${this.launchdLabel(taskName)}.plist`); }

  private async listMacos(signal?: AbortSignal): Promise<readonly Record<string, unknown>[]> {
    let files: readonly string[];
    try { files = await readdir(this.launchAgentsDirectory); } catch (error: unknown) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const tasks: Record<string, unknown>[] = [];
    for (const file of files.filter((entry) => /^com\.lnwjud\.scheduler\..+\.plist$/.test(entry)).sort()) {
      const filePath = path.join(this.launchAgentsDirectory, file);
      const label = file.slice(0, -'.plist'.length);
      let loaded = false;
      try {
        await this.runCommand(['print', `${this.launchdDomain()}/${label}`], signal);
        loaded = true;
      } catch { /* an installed plist may be unloaded */ }
      tasks.push({ name: label.slice('com.lnwjud.scheduler.'.length).replaceAll('_', ' '), label, path: filePath, loaded, scheduler: 'launchd' });
    }
    return tasks;
  }

  private async createMacos(taskName: string, command: string, args: readonly string[], schedule: string, startTime: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const label = this.launchdLabel(taskName);
    const filePath = this.launchdPath(taskName);
    await mkdir(this.launchAgentsDirectory, { recursive: true });
    await writeFile(filePath, launchAgentPlist(label, command, args, schedule, startTime), { encoding: 'utf8', mode: 0o600 });
    await this.runCommand(['bootout', `${this.launchdDomain()}/${label}`], signal).catch(() => undefined);
    await this.runCommand(['bootstrap', this.launchdDomain(), filePath], signal);
    return { created: true, task_name: taskName, label, schedule, start_time: startTime, scheduler: 'launchd' };
  }

  private async deleteMacos(taskName: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const label = this.launchdLabel(taskName);
    await this.runCommand(['bootout', `${this.launchdDomain()}/${label}`], signal).catch(() => undefined);
    await rm(this.launchdPath(taskName), { force: true });
    return { deleted: true, task_name: taskName, label, scheduler: 'launchd' };
  }

  private async runMacos(taskName: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const label = this.launchdLabel(taskName);
    await this.runCommand(['kickstart', '-k', `${this.launchdDomain()}/${label}`], signal);
    return { started: true, task_name: taskName, label, scheduler: 'launchd' };
  }
}

function cancelledOperation(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'Scheduled task operation was cancelled', true));
}

function uncertainMutationFailure(reason: string): Result<never> {
  return err(appError(
    'PROCESS_TIMEOUT',
    `${reason}. Scheduler mutation outcome may be unknown after dispatch; inspect the current task state before any manual retry. Do not retry automatically.`,
    true,
  ));
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

interface SchedulerRequest {
  readonly action: 'list' | 'create' | 'delete' | 'run';
  readonly taskName: string;
  readonly command: string;
  readonly arguments: readonly string[];
  readonly schedule: string;
  readonly startTime: string;
  readonly userConfirmed: boolean;
  readonly dryRun: boolean;
}

function parseRequest(value: unknown): Result<SchedulerRequest> {
  if (!isRecord(value)) return err(appError('INVALID_INPUT', 'scheduler input must be an object'));
  const action: unknown = value.action === undefined ? 'list' : value.action;
  if (action !== 'list' && action !== 'create' && action !== 'delete' && action !== 'run') {
    return err(appError('INVALID_INPUT', 'scheduler action is invalid'));
  }
  const taskName: unknown = value.task_name === undefined ? '' : value.task_name;
  if (action !== 'list' && (typeof taskName !== 'string' || !TASK_NAME_PATTERN.test(taskName.trim()))) {
    return err(appError('INVALID_INPUT', 'task_name must be 1-200 letters, digits, spaces, dots, dashes, or underscores'));
  }
  const command: unknown = value.command === undefined ? '' : value.command;
  if (action === 'create' && (typeof command !== 'string' || command.trim().length === 0 || command.length > 2_048)) {
    return err(appError('INVALID_INPUT', 'command is required (at most 2048 characters)'));
  }
  const argumentsValue: unknown = value.arguments === undefined ? [] : value.arguments;
  if (action === 'create' && (!Array.isArray(argumentsValue) || argumentsValue.length > 64 || !argumentsValue.every((entry) => typeof entry === 'string' && entry.length <= 2_048))) {
    return err(appError('INVALID_INPUT', 'arguments must be at most 64 strings'));
  }
  const schedule: unknown = value.schedule === undefined ? 'DAILY' : value.schedule;
  if (action === 'create' && (typeof schedule !== 'string' || !/^[A-Z]{1,16}$/.test(schedule.toUpperCase()))) {
    return err(appError('INVALID_INPUT', 'schedule must be a short uppercase schedule name (e.g. DAILY)'));
  }
  const startTime: unknown = value.start_time === undefined ? '09:00' : value.start_time;
  if (action === 'create' && (typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))) {
    return err(appError('INVALID_INPUT', 'start_time must be HH:MM'));
  }
  const userConfirmed = value.userConfirmed === true;
  const dryRun = value.dry_run === true;
  return ok({
    action,
    taskName: typeof taskName === 'string' ? taskName.trim() : '',
    command: typeof command === 'string' ? command.trim() : '',
    arguments: action === 'create' && Array.isArray(argumentsValue) ? argumentsValue.filter((entry): entry is string => typeof entry === 'string') : [],
    schedule: typeof schedule === 'string' ? schedule.toUpperCase() : 'DAILY',
    startTime: typeof startTime === 'string' ? startTime : '09:00',
    userConfirmed,
    dryRun,
  });
}

function buildTaskRun(command: string, args: readonly string[]): string {
  const quoted = [command, ...args].map((entry) => /[\s"]/.test(entry) ? `"${entry.replaceAll('"', '\\"')}"` : entry).join(' ');
  return quoted.length > 250 ? quoted.slice(0, 250) : quoted;
}

function launchAgentPlist(label: string, command: string, args: readonly string[], schedule: string, startTime: string): string {
  const [hour, minute] = startTime.split(':').map(Number);
  const calendar: string[] = [`<key>Hour</key><integer>${hour}</integer>`, `<key>Minute</key><integer>${minute}</integer>`];
  if (schedule === 'WEEKLY') calendar.push('<key>Weekday</key><integer>1</integer>');
  if (schedule === 'MONTHLY') calendar.push('<key>Day</key><integer>1</integer>');
  const runAtLoad = schedule === 'ONLOGON' || schedule === 'ONSTART';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>', `<key>Label</key><string>${xml(label)}</string>`,
    '<key>ProgramArguments</key><array>', ...[command, ...args].map((entry) => `<string>${xml(entry)}</string>`), '</array>',
    ...(runAtLoad ? ['<key>RunAtLoad</key><true/>'] : ['<key>StartCalendarInterval</key><dict>', ...calendar, '</dict>']),
    '<key>ProcessType</key><string>Background</string>', '</dict></plist>', '',
  ].join('\n');
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function extractDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const record = error as { stderr?: unknown; message?: unknown };
  const stderr = typeof record.stderr === 'string' ? record.stderr.trim() : '';
  if (stderr.length > 0) return stderr.slice(0, 500);
  return typeof record.message === 'string' ? record.message.slice(0, 500) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
