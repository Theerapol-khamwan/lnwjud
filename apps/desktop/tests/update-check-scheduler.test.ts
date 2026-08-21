import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_UPDATE_CHECK_INTERVAL_MS, AUTO_UPDATE_STARTUP_DELAY_MS, UpdateCheckScheduler } from '../src/main/update-check-scheduler.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('automatic update check scheduler', () => {
  it('checks once shortly after startup and then every 30 minutes', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const scheduler = new UpdateCheckScheduler({ check });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_STARTUP_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS - AUTO_UPDATE_STARTUP_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('does not create duplicate timers and stops all future checks', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const scheduler = new UpdateCheckScheduler({ check, startupDelayMs: 10, intervalMs: 100 });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(110);
    expect(check).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(check).toHaveBeenCalledTimes(2);
  });
});