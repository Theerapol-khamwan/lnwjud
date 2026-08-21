import { describe, expect, it, vi } from 'vitest';
import { SchedulerCapabilityBackend } from './scheduler-backend.js';

describe('SchedulerCapabilityBackend', () => {
  it('lists tasks parsed from schtasks LIST output', async () => {
    const runImpl = vi.fn(async (): Promise<{ stdout: string; stderr: string }> => ({
      stdout: 'TaskName: \\MyTask\nStatus: Ready\n\nTaskName: \\Other Task\nStatus: Running\n',
      stderr: '',
    }));
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl });

    const result = await backend.execute({ action: 'list' });

    expect(result).toMatchObject({
      ok: true,
      value: { tasks: [{ name: '\\MyTask', status: 'Ready' }, { name: '\\Other Task', status: 'Running' }] },
    });
  });

  it('creates a task with a quoted command line', async () => {
    const runImpl = vi.fn(async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: 'SUCCESS', stderr: '' }));
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl });

    const result = await backend.execute({
      action: 'create',
      task_name: 'LnwjudTest',
      command: 'C:\\Program Files\\app\\tool.exe',
      arguments: ['--flag', 'value with space'],
      schedule: 'DAILY',
      start_time: '09:30',
    });

    expect(result).toMatchObject({ ok: true, value: { created: true, task_name: 'LnwjudTest' } });
    expect(runImpl).toHaveBeenCalledWith('schtasks.exe', expect.arrayContaining([
      '/Create', '/TN', 'LnwjudTest',
      '/TR', '"C:\\Program Files\\app\\tool.exe" --flag "value with space"',
      '/SC', 'DAILY', '/ST', '09:30', '/F',
    ]));
  });

  it('requires confirmation before deleting a scheduled task', async () => {
    const runImpl = vi.fn(async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: 'SUCCESS', stderr: '' }));
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl });

    await expect(backend.execute({ action: 'delete', task_name: 'LnwjudTest' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    expect(runImpl).not.toHaveBeenCalled();

    await expect(backend.execute({ action: 'delete', task_name: 'LnwjudTest', userConfirmed: true }))
      .resolves.toMatchObject({ ok: true, value: { deleted: true, task_name: 'LnwjudTest' } });
    expect(runImpl).toHaveBeenCalledWith('schtasks.exe', ['/Delete', '/TN', 'LnwjudTest', '/F']);
  });

  it('rejects invalid task names', async () => {
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }) });

    const result = await backend.execute({ action: 'delete', task_name: 'bad/name' });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('rejects non-win32 platforms', async () => {
    const backend = new SchedulerCapabilityBackend({ platform: 'linux', runImpl: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }) });

    const result = await backend.execute({ action: 'list' });

    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('returns recoverable errors with stderr detail', async () => {
    const runImpl = vi.fn(async (): Promise<{ stdout: string; stderr: string }> => {
      throw new Error('schtasks failed: access denied');
    });
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl });

    const result = await backend.execute({ action: 'run', task_name: 'MissingTask' });

    expect(result).toMatchObject({ ok: false, error: { recoverable: true } });
  });

  it('does not invoke schtasks when the caller is already cancelled', async () => {
    const runImpl = vi.fn(async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }));
    const backend = new SchedulerCapabilityBackend({ platform: 'win32', runImpl });
    const controller = new AbortController();
    controller.abort();

    await expect(backend.execute({ action: 'run', task_name: 'LnwjudTest' }, controller.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(runImpl).not.toHaveBeenCalled();
  });
});
