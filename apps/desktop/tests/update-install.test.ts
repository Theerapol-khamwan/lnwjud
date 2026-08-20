import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateInstallCoordinator, updateReadyDialogOptions } from '../src/main/update-install.js';

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
});
