import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@lnwjud/domain';
import { CodexDiscovery, type CodexCommandResult, type CodexCommandRunner, type CodexExecutableResolver } from './codex-discovery.js';

describe('CodexDiscovery', () => {
  it('discovers version and supported instruction capabilities without reading credentials', async () => {
    const calls: { executable: string; args: readonly string[] }[] = [];
    const resolver: CodexExecutableResolver = { async resolve(): Promise<Result<string>> { return ok('C:\\tools\\codex.exe'); } };
    const runner: CodexCommandRunner = {
      async run(executable, args): Promise<CodexCommandResult> {
        calls.push({ executable, args });
        return args[0] === '--version'
          ? { exitCode: 0, stdout: 'codex 0.42.1\\n', stderr: '' }
          : { exitCode: 0, stdout: 'Usage: codex [OPTIONS]\\nCommands:\\n  exec  run a task\\nOptions:\\n  --prompt <TEXT>\\n', stderr: '' };
      },
    };

    const result = await new CodexDiscovery(resolver, runner).discover();

    expect(result).toMatchObject({ ok: true, value: { status: {
      installed: true,
      executablePath: 'C:\\tools\\codex.exe',
      version: '0.42.1',
    } } });
    if (result.ok) expect(result.value.capabilities.instructionMode).toBe('exec-argument');
    expect(calls).toEqual([
      { executable: 'C:\\tools\\codex.exe', args: ['--version'] },
      { executable: 'C:\\tools\\codex.exe', args: ['--help'] },
    ]);
  });

  it('reports not installed without attempting any command or credential lookup', async () => {
    let runs = 0;
    const resolver: CodexExecutableResolver = {
      async resolve(): Promise<Result<string>> {
        return err({ code: 'EXECUTABLE_NOT_FOUND', message: 'not found', recoverable: true });
      },
    };
    const runner: CodexCommandRunner = { async run(): Promise<CodexCommandResult> { runs += 1; return { exitCode: 0, stdout: '', stderr: '' }; } };

    const result = await new CodexDiscovery(resolver, runner).discover();

    expect(result).toEqual({ ok: true, value: { status: { installed: false, capabilities: [] }, capabilities: { instructionMode: null, names: [] } } });
    expect(runs).toBe(0);
  });
});
