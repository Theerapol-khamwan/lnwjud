import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TunnelRunState, TunnelStatus } from '@lnwjud/ipc-contracts';
import { formatTunnelExitMessage, tunnelExitHintFromLog } from './tunnel-exit.js';
import { acquireTunnelLock, type TunnelLockAcquisition, type TunnelLockOwner } from './tunnel-lock.js';
import { rewriteTunnelYamlMcpCommand } from './tunnel-profile.js';

const execFileAsync = promisify(execFile);

const PROFILE_NAME = 'lnwjud';
const SECRET_FILE = 'lnwjud.runtime.secret';
const CLIENT_PATH_SETTING = 'tunnel_client_path';
const MCP_CONNECTION_MAX_TTL = '168h0m0s';
const EXTERNAL_PROBE_TTL_MS = 4_000;
const RESTART_DELAY_MS = 3_000;
const MAX_AUTO_RESTARTS = 5;
const RESTART_WINDOW_MS = 30_000;

export interface TunnelControllerOptions {
  readonly getClientPath: () => string | null;
  readonly setClientPath: (value: string) => void;
  readonly getDataPath: () => string;
  readonly getStdioLauncherPath?: () => string | null;
  readonly isExternalTunnelRunning?: () => Promise<boolean>;
  readonly currentLockOwner?: () => Promise<TunnelLockOwner>;
  readonly inspectLockProcess?: (pid: number) => Promise<string | null>;
}

export class TunnelController {
  private child: ChildProcess | null = null;
  private state: TunnelRunState = 'stopped';
  private message: string | null = null;
  private externalProbeAt = 0;
  private lastExternalProbe = false;
  private intentionalStop = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private restartWindowStartedAt = 0;
  private lastApiKey: string | null = null;
  private tunnelLock: TunnelLockAcquisition | null = null;

  public constructor(private readonly options: TunnelControllerOptions) {}

  public profileDirectory(): string {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'tunnel-client');
  }

  public secretPath(): string {
    return path.join(this.profileDirectory(), SECRET_FILE);
  }

  public profilePath(): string {
    return path.join(this.profileDirectory(), `${PROFILE_NAME}.yaml`);
  }

  public logPath(): string {
    return path.join(this.profileDirectory(), 'lnwjud-tunnel.log');
  }

  public defaultClientPath(): string {
    return path.join(os.homedir(), 'Downloads', 'tunnel', 'tunnel-client.exe');
  }

  public resolveClientPath(): string | null {
    const configured = this.options.getClientPath();
    if (configured !== null && configured.trim().length > 0 && existsSync(configured)) return configured;
    const fallback = this.defaultClientPath();
    return existsSync(fallback) ? fallback : configured;
  }

  public async hasApiKey(): Promise<boolean> {
    try {
      const raw = await readFile(this.secretPath(), 'utf8');
      return raw.trim().length > 0;
    } catch {
      return false;
    }
  }

  public async saveApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) throw new Error('Runtime API key is required');
    await mkdir(this.profileDirectory(), { recursive: true });
    const encrypted = await encryptWithDpapi(trimmed);
    await writeFile(this.secretPath(), encrypted, 'utf8');
  }

  public setClientPath(clientPath: string): string {
    const resolved = path.resolve(clientPath.trim());
    if (!existsSync(resolved)) throw new Error('tunnel-client.exe was not found');
    this.options.setClientPath(resolved);
    return resolved;
  }

  public async status(): Promise<TunnelStatus> {
    const clientPath = this.resolveClientPath();
    let source: TunnelStatus['source'] = 'desktop';
    if (this.child !== null && this.child.exitCode === null) {
      this.state = 'running';
      this.message = null;
    } else if (this.child !== null && this.child.exitCode !== null) {
      this.child = null;
      if (this.state === 'running') this.state = 'stopped';
    } else if (this.state !== 'starting' && this.tunnelLock === null) {
      // No desktop-owned child: reflect a tunnel started externally (e.g. start-lnwjud-tunnel.ps1).
      if (await this.probeExternalRunning()) {
        this.state = 'running';
        this.message = null;
        source = 'external';
      } else if (this.state === 'running') {
        this.state = 'stopped';
      }
    }
    return {
      state: this.state,
      source,
      hasApiKey: await this.hasApiKey(),
      clientPath,
      profileExists: existsSync(this.profilePath()),
      message: this.message,
      logPath: this.logPath(),
    };
  }

  private async probeExternalRunning(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.externalProbeAt < EXTERNAL_PROBE_TTL_MS) return this.lastExternalProbe;
    this.externalProbeAt = now;
    this.lastExternalProbe = await (this.options.isExternalTunnelRunning?.() ?? isLnwjudTunnelProcessRunning());
    return this.lastExternalProbe;
  }

  public async start(): Promise<TunnelStatus> {
    this.intentionalStop = false;
    this.clearRestartTimer();
    this.clearStableTimer();
    this.restartAttempts = 0;
    this.restartWindowStartedAt = 0;
    if (this.state === 'running' || this.state === 'starting') return this.status();
    if (this.child !== null && this.child.exitCode === null) return this.status();
    if (!(await this.ensureTunnelLock())) return this.status();

    const clientPath = this.resolveClientPath();
    if (clientPath === null || !existsSync(clientPath)) {
      this.state = 'error';
      this.message = 'tunnel-client.exe was not found';
      await this.releaseTunnelLock();
      return this.status();
    }
    if (!(await this.hasApiKey())) {
      this.state = 'error';
      this.message = 'Save a Runtime API key first';
      await this.releaseTunnelLock();
      return this.status();
    }
    if (!existsSync(this.profilePath())) {
      this.state = 'error';
      this.message = 'Missing tunnel profile lnwjud.yaml';
      await this.releaseTunnelLock();
      return this.status();
    }

    const apiKey = (await decryptWithDpapi(await readFile(this.secretPath(), 'utf8'))).trim();
    if (apiKey.length === 0) {
      this.state = 'error';
      this.message = 'Saved Runtime API key is empty; save it again in Settings';
      await this.releaseTunnelLock();
      return this.status();
    }
    this.lastApiKey = apiKey;
    this.state = 'starting';
    this.message = null;
    await mkdir(this.profileDirectory(), { recursive: true });
    await this.preferPackagedStdioCommand();

    try {
      await runTunnelDoctor(clientPath, apiKey, this.profileDirectory(), this.options.getDataPath());
    } catch (error: unknown) {
      this.state = 'error';
      this.message = error instanceof Error ? error.message : 'tunnel-client doctor failed';
      await this.releaseTunnelLock();
      return this.status();
    }

    this.spawnRun(clientPath, apiKey);
    this.state = 'running';
    this.scheduleStableReset();
    return this.status();
  }

  public async stop(): Promise<TunnelStatus> {
    await this.killOwnedChild();
    await this.releaseTunnelLock();
    this.state = 'stopped';
    this.message = null;
    this.lastApiKey = null;
    this.restartAttempts = 0;
    this.clearStableTimer();
    return this.status();
  }

  public async stopOwned(): Promise<TunnelStatus> {
    await this.killOwnedChild();
    await this.releaseTunnelLock();
    this.state = 'stopped';
    this.message = null;
    this.lastApiKey = null;
    this.restartAttempts = 0;
    this.clearStableTimer();
    return this.status();
  }

  private async killOwnedChild(): Promise<void> {
    this.intentionalStop = true;
    this.clearRestartTimer();
    if (this.child !== null) {
      const child = this.child;
      this.child = null;
      child.kill();
    }
  }

  private async ensureTunnelLock(): Promise<boolean> {
    if (this.tunnelLock !== null) return true;
    try {
      const claim = await acquireTunnelLock({
        profileDirectory: this.profileDirectory(),
        ...(this.options.currentLockOwner === undefined ? {} : { owner: await this.options.currentLockOwner() }),
        ...(this.options.inspectLockProcess === undefined ? {} : { inspectProcess: this.options.inspectLockProcess }),
      });
      if (!claim.acquired) {
        this.state = 'error';
        this.message = `Tunnel is already owned by PID ${claim.owner.pid}`;
        return false;
      }
      this.tunnelLock = claim;
      return true;
    } catch (error: unknown) {
      this.state = 'error';
      this.message = error instanceof Error ? error.message : 'Could not acquire tunnel ownership lock';
      return false;
    }
  }

  private async releaseTunnelLock(): Promise<void> {
    const claim = this.tunnelLock;
    this.tunnelLock = null;
    if (claim !== null) await claim.release();
  }

  private spawnRun(clientPath: string, apiKey: string): void {
    const child = spawn(
      clientPath,
      [
        'run',
        '--profile', PROFILE_NAME,
        '--profile-dir', this.profileDirectory(),
        '--log.file', this.logPath(),
        '--mcp.connection-max-ttl', MCP_CONNECTION_MAX_TTL,
      ],
      {
        env: tunnelClientEnv(apiKey, this.profileDirectory(), this.options.getDataPath()),
        windowsHide: true,
        // detached:true on Windows gives the child its own console window.
        detached: false,
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
    this.child = child;
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      this.state = 'error';
      this.message = error.message;
      this.scheduleRestart(clientPath);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.intentionalStop) {
        this.state = 'stopped';
        this.message = null;
        return;
      }
      void this.applyUnexpectedExit(code, clientPath);
    });
  }

  private async applyUnexpectedExit(code: number | null, clientPath: string): Promise<void> {
    const hint = await this.readExitHint();
    this.state = 'error';
    this.message = formatTunnelExitMessage(code, hint);
    const now = Date.now();
    if (this.restartWindowStartedAt === 0 || now - this.restartWindowStartedAt > RESTART_WINDOW_MS) {
      this.restartWindowStartedAt = now;
      this.restartAttempts = 0;
    }
    this.restartAttempts += 1;
    if (this.restartAttempts > MAX_AUTO_RESTARTS) {
      this.message = `${this.message} — automatic reconnect paused after ${MAX_AUTO_RESTARTS} rapid exits; press Start Tunnel to retry`;
      return;
    }
    this.scheduleRestart(clientPath);
  }

  private async readExitHint(): Promise<string> {
    try {
      const raw = await readFile(this.logPath(), 'utf8');
      const tail = raw.split(/\r?\n/).slice(-120).join('\n');
      return tunnelExitHintFromLog(tail);
    } catch {
      return '';
    }
  }

  private scheduleRestart(clientPath: string): void {
    if (this.intentionalStop) return;
    this.clearRestartTimer();
    const delay = Math.min(RESTART_DELAY_MS * (2 ** Math.max(0, this.restartAttempts - 1)), 30_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.intentionalStop || this.lastApiKey === null) return;
      void this.preferPackagedStdioCommand()
        .then(() => {
          if (this.intentionalStop || this.lastApiKey === null) return;
          this.spawnRun(clientPath, this.lastApiKey);
          this.state = 'running';
          this.message = `Tunnel reconnecting (attempt ${this.restartAttempts}/${MAX_AUTO_RESTARTS})…`;
          this.scheduleStableReset();
        })
        .catch(() => undefined);
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private scheduleStableReset(): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.restartAttempts = 0;
      this.restartWindowStartedAt = 0;
    }, RESTART_WINDOW_MS);
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private async preferPackagedStdioCommand(): Promise<void> {
    const launcher = this.options.getStdioLauncherPath?.() ?? null;
    if (launcher === null) return;
    try {
      const yaml = await readFile(this.profilePath(), 'utf8');
      const next = rewriteTunnelYamlMcpCommand(yaml, launcher);
      if (next !== yaml) await writeFile(this.profilePath(), next, 'utf8');
    } catch {
      // Profile rewrite is best-effort; tunnel-client still starts with the existing YAML.
    }
  }
}

export { CLIENT_PATH_SETTING };

async function encryptWithDpapi(plain: string): Promise<string> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join('; ');
  return runPowerShellWithStdin(script, plain);
}

async function decryptWithDpapi(encrypted: string): Promise<string> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$encrypted = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $encrypted',
    '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
  ].join('; ');
  return runPowerShellWithStdin(script, encrypted);
}

function runPowerShellWithStdin(command: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? 'unknown'}`));
        return;
      }
      const value = stdout.replace(/\r?\n$/, '');
      if (value.length === 0) {
        reject(new Error('PowerShell returned an empty result'));
        return;
      }
      resolve(value);
    });
    child.stdin.end(input, 'utf8');
  });
}

export function tunnelClientEnv(apiKey: string, profileDirectory: string, dataPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const userProfile = process.env.USERPROFILE ?? os.homedir();
  const appData = process.env.APPDATA ?? path.join(userProfile, 'AppData', 'Roaming');
  env.CONTROL_PLANE_API_KEY = apiKey.trim();
  env.MCP_CONNECTION_MAX_TTL = MCP_CONNECTION_MAX_TTL;
  env.LNWJUD_DATA_PATH = dataPath;
  env.LNWJUD_UNRESTRICTED = '1';
  env.TUNNEL_CLIENT_PROFILE = PROFILE_NAME;
  env.TUNNEL_CLIENT_PROFILE_DIR = profileDirectory;
  env.USERPROFILE = userProfile;
  env.APPDATA = appData;
  env.HOME = userProfile;
  delete env.XDG_CONFIG_HOME;
  return env;
}

async function runTunnelDoctor(clientPath: string, apiKey: string, profileDirectory: string, dataPath: string): Promise<void> {
  try {
    await execFileAsync(clientPath, ['doctor', '--profile', PROFILE_NAME, '--profile-dir', profileDirectory, '--explain'], {
      env: tunnelClientEnv(apiKey, profileDirectory, dataPath),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 60_000,
    });
  } catch (error: unknown) {
    const detail = extractExecDetail(error);
    throw new Error(detail.length > 0 ? detail : 'tunnel-client doctor failed');
  }
}

function extractExecDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const stderr = typeof record.stderr === 'string' ? record.stderr.trim() : '';
  if (stderr.length > 0) return stderr.slice(0, 500);
  const stdout = typeof record.stdout === 'string' ? record.stdout.trim() : '';
  if (stdout.length > 0) return stdout.slice(0, 500);
  return typeof record.message === 'string' ? record.message : '';
}

async function isLnwjudTunnelProcessRunning(): Promise<boolean> {
  try {
    const result = await Promise.race([
      execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'tunnel-client.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '(?i)(--profile\\s+lnwjud|lnwjud\\.yaml)' }).Count",
      ], { windowsHide: true, encoding: 'utf8', timeout: 3_000 }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('tunnel process probe timed out')), 3_500);
      }),
    ]);
    return Number(result.stdout.trim()) > 0;
  } catch {
    return false;
  }
}
