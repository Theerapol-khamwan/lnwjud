import { describe, expect, it } from 'vitest';
import type { GitRunResult, GitRunner } from './git-runner.js';
import { GitAdapter } from './git-adapter.js';

class FakeGitRunner implements GitRunner {
  public readonly calls: { args: readonly string[]; cwd: string }[] = [];
  public constructor(private readonly result: GitRunResult) {}

  public async run(args: readonly string[], cwd: string): Promise<GitRunResult> {
    this.calls.push({ args, cwd });
    return this.result;
  }
}

describe('GitAdapter', () => {
  it('uses direct read-only status arguments and parses porcelain output', async () => {
    const runner = new FakeGitRunner({ exitCode: 0, stdout: ' M file.txt\0', stderr: '' });
    const result = await new GitAdapter(runner).status('C:\\workspace');

    expect(result).toMatchObject({ ok: true, value: { entries: [{ path: 'file.txt', kind: 'modified' }] } });
    expect(runner.calls).toEqual([{ args: ['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd: 'C:\\workspace' }]);
  });

  it('bounds diff output and keeps the path as a separate argument', async () => {
    const runner = new FakeGitRunner({ exitCode: 0, stdout: '0123456789', stderr: '' });
    const result = await new GitAdapter(runner).diff('C:\\workspace', { path: 'src\\space file.txt', maxBytes: 5 });

    expect(result).toEqual({ ok: true, value: { patch: '01234', truncated: true } });
    expect(runner.calls[0]).toEqual({
      args: ['diff', '--no-ext-diff', '--no-color', '--', 'src\\space file.txt'],
      cwd: 'C:\\workspace',
    });
  });

  it('parses bounded structured log records', async () => {
    const runner = new FakeGitRunner({
      exitCode: 0,
      stdout: 'abc\u001fname\u001f2026-08-10T10:00:00Z\u001fsubject\u001e',
      stderr: '',
    });
    const result = await new GitAdapter(runner).log('C:\\workspace', { maxCommits: 3 });

    expect(result).toEqual({
      ok: true,
      value: { entries: [{ hash: 'abc', author: 'name', date: '2026-08-10T10:00:00Z', subject: 'subject' }], truncated: false },
    });
    expect(runner.calls[0]?.args).toEqual(['log', '--no-color', '--format=%H%x1f%an%x1f%aI%x1f%s%x1e', '-n', '3', '--']);
  });

  it('maps a non-repository exit to a structured error', async () => {
    const runner = new FakeGitRunner({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' });

    await expect(new GitAdapter(runner).status('C:\\workspace')).resolves.toMatchObject({
      ok: false,
      error: { code: 'GIT_NOT_REPOSITORY' },
    });
  });
});
