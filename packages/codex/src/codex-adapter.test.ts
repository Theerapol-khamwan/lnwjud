import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import type { ManagedProcess, ManagedProcessStart, ProcessLogResult } from '@lnwjud/process';
import { CodexAdapter, type CodexDiscoveryPort, type CodexProcessManagerPort } from './codex-adapter.js';
import type { CodexDiscoveryResult } from './codex-capabilities.js';

describe('CodexAdapter', () => {
  it('builds direct executable arguments and delegates the task to ProcessManager', async () => {
    const calls: ManagedProcessStart[] = [];
    const manager: CodexProcessManagerPort = {
      async start(spec): Promise<Result<ManagedProcess>> { calls.push(spec); return ok(processHandle()); },
      status(): Result<ManagedProcess> { return ok(processHandle()); },
      logs(): Result<ProcessLogResult> { return ok({ entries: [], truncated: false, nextSequence: 0 }); },
      async stop(): Promise<Result<void>> { return ok(undefined); },
    };
    const discovery: CodexDiscoveryPort = { async discover(): Promise<Result<CodexDiscoveryResult>> { return ok(discovered()); } };

    const result = await new CodexAdapter(discovery, manager).start('C:\\workspace', 'review "quoted" input');

    expect(result).toMatchObject({ ok: true, value: { processId: 'process-1' } });
    expect(calls).toEqual([{ executable: 'C:\\tools\\codex.exe', args: ['exec', 'review "quoted" input'], cwd: 'C:\\workspace' }]);
  });
});

function discovered(): CodexDiscoveryResult {
  return {
    status: { installed: true, executablePath: 'C:\\tools\\codex.exe', version: '0.42.1', capabilities: ['exec'] },
    capabilities: { instructionMode: 'exec-argument', names: ['exec'] },
  };
}

function processHandle(): ManagedProcess {
  return { processId: 'process-1', executable: 'C:\\tools\\codex.exe', args: ['exec', 'review'], cwd: 'C:\\workspace', state: 'running', startedAt: new Date(0).toISOString() };
}
