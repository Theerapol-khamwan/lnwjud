import { spawn } from 'node:child_process';

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunOptions {
  readonly timeoutMs?: number;
}

export interface GitRunner {
  run(args: readonly string[], cwd: string, options?: GitRunOptions): Promise<GitRunResult>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export class DirectGitRunner implements GitRunner {
  public run(args: readonly string[], cwd: string, options: GitRunOptions = {}): Promise<GitRunResult> {
    const timeoutMs = clampTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return new Promise((resolve) => {
      const child = spawn('git', [...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-MAX_CAPTURE_BYTES);
      const finish = (exitCode: number, extraStderr = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr: extraStderr.length === 0 ? stderr : `${stderr}${extraStderr}` });
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(-1, 'Git command timed out');
      }, timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on('error', (error: Error) => finish(-1, error.message));
      child.on('close', (exitCode) => finish(exitCode ?? -1));
    });
  }
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(value)));
}
