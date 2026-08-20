import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateDownloadedDialogController, UpdateInstallCoordinator, updateReadyDialogOptions } from '../src/main/update-install.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('downloaded update installation', () => {
  it('makes Later the default response in the update-ready dialog', () => {
    expect(updateReadyDialogOptions('4.0.2')).toMatchObject({
      buttons: ['Restart Now', 'Later'],
      defaultId: 1,
      cancelId: 1,
    });
  });

  it('defers Restart Now while MCP calls are active', async () => {
    vi.useFakeTimers();
    let active = 1;
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => active,
      install,
      pollIntervalMs: 10,
      quietPeriodMs: 20,
    });

    coordinator.requestInstall();
    await vi.advanceTimersByTimeAsync(200);

    expect(install).not.toHaveBeenCalled();
    active = 0;
  });

  it('installs after MCP becomes idle for the quiet period', async () => {
    vi.useFakeTimers();
    let active = 1;
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => active,
      install,
      pollIntervalMs: 10,
      quietPeriodMs: 20,
    });

    coordinator.requestInstall();
    active = 0;
    await vi.advanceTimersByTimeAsync(29);
    expect(install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(install).toHaveBeenCalledOnce();
  });

  it('restarts the quiet period when MCP activity resumes', async () => {
    vi.useFakeTimers();
    let active = 0;
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => active,
      install,
      pollIntervalMs: 10,
      quietPeriodMs: 30,
    });

    coordinator.requestInstall();
    await vi.advanceTimersByTimeAsync(10);
    active = 1;
    await vi.advanceTimersByTimeAsync(10);
    active = 0;
    await vi.advanceTimersByTimeAsync(39);
    expect(install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(install).toHaveBeenCalledOnce();
  });

  it('resets quiet time for a short call completed between polling samples', async () => {
    vi.useFakeTimers();
    let revision = 0;
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => 0,
      activityRevision: (): number => revision,
      install,
      pollIntervalMs: 10,
      quietPeriodMs: 30,
    });
    coordinator.requestInstall();
    revision += 2;
    await vi.advanceTimersByTimeAsync(39);
    expect(install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(install).toHaveBeenCalledOnce();
  });

  it('cancels a pending idle wait during shutdown', async () => {
    vi.useFakeTimers();
    const install = vi.fn();
    const coordinator = new UpdateInstallCoordinator({
      activeCallCount: (): number => 0,
      install,
      pollIntervalMs: 10,
      quietPeriodMs: 20,
    });

    coordinator.requestInstall();
    coordinator.cancel();
    await vi.advanceTimersByTimeAsync(100);

    expect(install).not.toHaveBeenCalled();
  });

  it('suppresses duplicate downloaded events while the dialog is open', async () => {
    const dialogResult = deferred<{ response: number }>();
    const showDialog = vi.fn(() => dialogResult.promise);
    const requestInstall = vi.fn();
    const lifecycle = new UpdateDownloadedDialogController({
      showDialog,
      requestInstall,
      hasPendingInstall: (): boolean => false,
    });

    const first = lifecycle.handle('4.0.2');
    await expect(lifecycle.handle('4.0.2')).resolves.toBe(false);
    expect(showDialog).toHaveBeenCalledOnce();
    dialogResult.resolve({ response: 1 });
    await first;
    expect(requestInstall).not.toHaveBeenCalled();
  });

  it('suppresses downloaded events while an idle install request is pending', async () => {
    const showDialog = vi.fn(async () => ({ response: 1 }));
    const lifecycle = new UpdateDownloadedDialogController({
      showDialog,
      requestInstall: vi.fn(),
      hasPendingInstall: (): boolean => true,
    });

    await expect(lifecycle.handle('4.0.2')).resolves.toBe(false);
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('clears the dialog guard in finally after rejection so a later event can show', async () => {
    const onError = vi.fn();
    const showDialog = vi.fn()
      .mockRejectedValueOnce(new Error('dialog unavailable'))
      .mockResolvedValueOnce({ response: 0 });
    const requestInstall = vi.fn();
    const lifecycle = new UpdateDownloadedDialogController({
      showDialog,
      requestInstall,
      hasPendingInstall: (): boolean => false,
      onError,
    });

    await expect(lifecycle.handle('4.0.2')).resolves.toBe(true);
    await expect(lifecycle.handle('4.0.2')).resolves.toBe(true);

    expect(showDialog).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'dialog unavailable' }));
    expect(requestInstall).toHaveBeenCalledOnce();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}
