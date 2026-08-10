import { spawn } from 'node:child_process';

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunner {
  run(args: readonly string[], cwd: string): Promise<GitRunResult>;
}

export class DirectGitRunner implements GitRunner {
  public run(args: readonly string[], cwd: string): Promise<GitRunResult> {
    return new Promise((resolve) => {
      const child = spawn('git', [...args], { cwd, shell: false, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-8 * 1024 * 1024);
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on('error', (error: Error) => resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}` }));
      child.on('close', (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout, stderr }));
    });
  }
}
