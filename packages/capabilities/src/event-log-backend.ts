import { spawn } from 'node:child_process';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';

/**
 * Read-only Windows Event Log queries behind the `event_watch` and
 * `crash_trace` upgrade tools (Wave 5). Providers and log names are
 * allowlisted, results are bounded, and the query itself runs through
 * `powershell.exe Get-WinEvent` with parameters passed via environment
 * variables so request data never becomes command-line content.
 */

export interface EventLogBackendOptions {
  readonly platform?: NodeJS.Platform;
  readonly timeoutSeconds?: number;
  /** Injectable for tests: runs the PowerShell query and returns raw stdout. */
  readonly runner?: EventLogRunner;
}

export type EventLogRunner = (
  script: string,
  environment: Readonly<Record<string, string>>,
  signal?: AbortSignal,
) => Promise<Result<string>>;

const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_EVENTS_HARD_LIMIT = 500;
const ALLOWED_LOG_NAMES: ReadonlySet<string> = new Set(['application', 'system']);
const ALLOWED_PROVIDERS: ReadonlySet<string> = new Set([
  'application error',
  'windows error reporting',
  '.net runtime',
  'microsoft-windows-windowsupdateclient',
  'microsoft-windows-kernel-power',
  'microsoft-windows-taskscheduler',
]);
const QUERY_SCRIPT = [
  '$ErrorActionPreference = \'Stop\'',
  '$events = @()',
  'try {',
  '  if ($env:LNWJUD_EVENT_MODE -eq \'crashes\') {',
  '    $since = (Get-Date).AddHours(-[double]$env:LNWJUD_EVENT_HOURS)',
  '    $events = @(Get-WinEvent -FilterHashtable @{ LogName = \'Application\'; Id = @(1000, 1001); StartTime = $since } -MaxEvents ([int]$env:LNWJUD_EVENT_MAX) -ErrorAction Stop)',
  '  } else {',
  '    $filter = @{}',
  '    if ($env:LNWJUD_EVENT_LOG) { $filter.LogName = $env:LNWJUD_EVENT_LOG }',
  '    if ($env:LNWJUD_EVENT_PROVIDER) { $filter.ProviderName = $env:LNWJUD_EVENT_PROVIDER }',
  '    if ($env:LNWJUD_EVENT_SINCE) { $filter.StartTime = [datetime]::Parse($env:LNWJUD_EVENT_SINCE) }',
  '    $events = @(Get-WinEvent -FilterHashtable $filter -MaxEvents ([int]$env:LNWJUD_EVENT_MAX) -ErrorAction Stop)',
  '  }',
  '} catch {',
  '  if ($_.FullyQualifiedErrorId -ne \'NoMatchingEventsFound,Microsoft.PowerShell.Commands.GetWinEventCommand\') { throw }',
  '}',
  '$mapped = foreach ($event in $events) { [ordered]@{',
  '  time = $event.TimeCreated.ToString(\'o\')',
  '  provider = [string]$event.ProviderName',
  '  id = $event.Id',
  '  level = [string]$event.LevelDisplayName',
  '  message = [string]$event.Message',
  '} }',
  '$json = @($mapped) | ConvertTo-Json -Compress -Depth 4',
  'if (-not $json -or $json.Trim().Length -eq 0) { \'[]\' } elseif (-not $json.TrimStart().StartsWith(\'[\')) { \'[\' + $json.Trim() + \']\' } else { $json.Trim() }',
].join('\n');

export class EventLogCapabilityBackend implements CapabilityBackend {
  private readonly platform: NodeJS.Platform;
  private readonly timeoutSeconds: number;
  private readonly runner: EventLogRunner;

  public constructor(options: EventLogBackendOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.timeoutSeconds = Math.min(600, Math.max(1, options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS));
    this.runner = options.runner ?? defaultRunner(this.timeoutSeconds);
  }

  public async execute(input: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    if (this.platform !== 'win32') {
      return ok({ available: false, ready: false, local: true, reason: 'platform_unavailable', backend: 'windows-event-log' });
    }
    if (signal?.aborted === true) return err(appError('PROCESS_TIMEOUT', 'Event log query was cancelled', true));
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return err(appError('INVALID_INPUT', 'Event log input must be an object'));
    }
    const request = input as Record<string, unknown>;
    const mode = request.operation === 'crashes' ? 'crashes' : 'query';

    const environment: Record<string, string> = {
      LNWJUD_EVENT_MODE: mode,
      LNWJUD_EVENT_MAX: String(clampInteger(request.max_events ?? request.maxEvents, 100, 1, MAX_EVENTS_HARD_LIMIT)),
    };
    if (mode === 'crashes') {
      environment.LNWJUD_EVENT_HOURS = String(clampNumber(request.hours, 24, 1, 720));
    } else {
      const logName = readTrimmedString(request.log_name ?? request.logName);
      const provider = readTrimmedString(request.provider);
      if (logName === undefined && provider === undefined) {
        return err(appError('INVALID_INPUT', 'event_watch requires log_name or provider'));
      }
      if (logName !== undefined && !ALLOWED_LOG_NAMES.has(logName.toLowerCase())) {
        return err(appError('PERMISSION_DENIED', `Log name is not allowlisted: ${logName}. Allowed: ${[...ALLOWED_LOG_NAMES].join(', ')}`));
      }
      if (provider !== undefined && !ALLOWED_PROVIDERS.has(provider.toLowerCase())) {
        return err(appError('PERMISSION_DENIED', `Event provider is not allowlisted: ${provider}. Allowed: ${[...ALLOWED_PROVIDERS].join(', ')}`));
      }
      if (logName !== undefined) environment.LNWJUD_EVENT_LOG = logName;
      if (provider !== undefined) environment.LNWJUD_EVENT_PROVIDER = provider;
      const since = readTrimmedString(request.since);
      if (since !== undefined) {
        const parsed = Date.parse(since);
        if (!Number.isFinite(parsed)) return err(appError('INVALID_INPUT', 'since must be an ISO-8601 timestamp'));
        environment.LNWJUD_EVENT_SINCE = new Date(parsed).toISOString();
      }
    }

    const result = await this.runner(QUERY_SCRIPT, environment, signal);
    if (!result.ok) return result;
    let events: unknown;
    try {
      events = JSON.parse(result.value.trim());
    } catch {
      return err(appError('INTERNAL_ERROR', 'Event log query returned an unparsable response', true));
    }
    if (!Array.isArray(events)) return err(appError('INTERNAL_ERROR', 'Event log query returned a non-array response', true));
    return ok({ available: true, ready: true, local: true, backend: 'windows-event-log', mode, count: events.length, events });
  }
}

function defaultRunner(timeoutSeconds: number): EventLogRunner {
  return (script, environment, signal): Promise<Result<string>> => new Promise((resolve) => {
    // The script is a repo constant (request data travels via env vars), so
    // passing it as the -Command argument is injection-safe.
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      env: { ...process.env, ...environment },
    });
    let stdout = '';
    let settled = false;
    const finish = (result: Result<string>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(err(appError('PROCESS_TIMEOUT', `Event log query timed out after ${timeoutSeconds}s`, true)));
    }, timeoutSeconds * 1_000);
    const onAbort = (): void => {
      child.kill();
      finish(err(appError('PROCESS_TIMEOUT', 'Event log query was cancelled', true)));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.resume();
    child.once('error', () => finish(err(appError('INTERNAL_ERROR', 'powershell.exe could not start for the event log query', true))));
    child.once('close', () => finish(ok(stdout)));
    child.stdin?.end();
  });
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
