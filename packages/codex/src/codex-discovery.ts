import { spawn } from 'node:child_process';
import path from 'node:path';
import { access, constants, stat } from 'node:fs/promises';
import { err, ok, type Result } from '@lnwjud/domain';
import { capabilitiesFromHelp, type CodexDiscoveryResult } from './codex-capabilities.js';

export interface CodexCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodexCommandRunner {
  run(executable: string, args: readonly string[]): Promise<CodexCommandResult>;
}

export interface CodexExecutableResolver {
  resolve(): Promise<Result<string>>;
}

export class PathCodexExecutableResolver implements CodexExecutableResolver {
  public constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  public async resolve(): Promise<Result<string>> {
    const pathValue = this.environment.Path ?? this.environment.PATH ?? '';
    const entries = pathValue.split(path.delimiter).filter(Boolean);
    const candidates = entries.flatMap((entry) => this.withWindowsExtensions(path.join(entry, 'codex')));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.F_OK);
        if ((await stat(candidate)).isFile()) return ok(candidate);
      } catch {
        continue;
      }
    }
    return err({ code: 'EXECUTABLE_NOT_FOUND', message: 'Codex executable was not found', recoverable: true });
  }

  private withWindowsExtensions(candidate: string): string[] {
    if (process.platform !== 'win32') return [candidate];
    const extensions = (this.environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';');
    return [candidate, ...extensions.map((extension) => `${candidate}${extension.toLowerCase()}`)];
  }
}

export class DirectCodexCommandRunner implements CodexCommandRunner {
  public run(executable: string, args: readonly string[]): Promise<CodexCommandResult> {
    return new Promise((resolve) => {
      const child = spawn(executable, [...args], { shell: false, windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-1024 * 1024); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1024 * 1024); });
      child.once('error', (error: Error & { code?: string }) => resolve({ exitCode: error.code === 'ENOENT' ? -1 : -2, stdout, stderr }));
      child.once('close', (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout, stderr }));
    });
  }
}

export class CodexDiscovery {
  public constructor(
    private readonly resolver: CodexExecutableResolver = new PathCodexExecutableResolver(),
    private readonly runner: CodexCommandRunner = new DirectCodexCommandRunner(),
  ) {}

  public async discover(): Promise<Result<CodexDiscoveryResult>> {
    const resolved = await this.resolver.resolve();
    if (!resolved.ok) {
      if (resolved.error.code === 'EXECUTABLE_NOT_FOUND') {
        return ok({ status: { installed: false, capabilities: [] }, capabilities: { instructionMode: null, names: [] } });
      }
      return resolved;
    }
    const versionResult = await this.runner.run(resolved.value, ['--version']);
    if (versionResult.exitCode !== 0) return err({ code: 'CODEX_NOT_AVAILABLE', message: 'Codex version check failed', recoverable: true });
    const helpResult = await this.runner.run(resolved.value, ['--help']);
    if (helpResult.exitCode !== 0) return err({ code: 'CODEX_NOT_AVAILABLE', message: 'Codex help check failed', recoverable: true });
    const helpText = `${helpResult.stdout}\n${helpResult.stderr}`;
    const capabilities = capabilitiesFromHelp(helpText);
    const statusCapabilities = ['version', 'help', ...capabilities.names];
    const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    return ok({
      status: {
        installed: true,
        executablePath: resolved.value,
        ...(version === undefined ? {} : { version }),
        capabilities: statusCapabilities,
      },
      capabilities,
    });
  }
}

function parseVersion(value: string): string | undefined {
  return value.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
}
