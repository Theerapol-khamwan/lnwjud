import { describe, expect, it, vi } from 'vitest';
import { DesktopShutdownCoordinator } from '../src/main/desktop-shutdown.js';

describe('Desktop main shutdown coordinator', () => {
  it('allows app quit only after runtime shutdown is confirmed', async () => {
    const closed = deferred<void>();
    const quit = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ closeRuntime: (): Promise<void> => closed.promise, onDeferred: vi.fn() });

    const shuttingDown = coordinator.requestQuit(quit);
    expect(coordinator.canQuit()).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    closed.resolve();

    await expect(shuttingDown).resolves.toBe('quit');
    expect(coordinator.canQuit()).toBe(true);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent quit attempts through one owned-runtime shutdown', async () => {
    const closeRuntime = vi.fn(async () => undefined);
    const quit = vi.fn();
    const coordinator = new DesktopShutdownCoordinator({ closeRuntime, onDeferred: vi.fn() });
    await expect(Promise.all([coordinator.requestQuit(quit), coordinator.requestQuit(quit)])).resolves.toEqual(['quit', 'quit']);
    expect(closeRuntime).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('defers quit on a stubborn or unverifiable owned child and permits a later retry', async () => {
    const onDeferred = vi.fn();
    const quit = vi.fn();
    const closeRuntime = vi.fn()
      .mockRejectedValueOnce(new Error('Tunnel child liveness is unverifiable; ownership retained'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new DesktopShutdownCoordinator({ closeRuntime, onDeferred });

    await expect(coordinator.requestQuit(quit)).resolves.toBe('deferred');
    expect(coordinator.canQuit()).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(onDeferred).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ownership retained') }));

    await expect(coordinator.requestQuit(quit)).resolves.toBe('quit');
    expect(coordinator.canQuit()).toBe(true);
    expect(quit).toHaveBeenCalledOnce();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}
