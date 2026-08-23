import { describe, expect, it } from 'vitest';
import type { McpHttpServerHandle, McpHttpServerOptions } from '@lnwjud/mcp-server';
import { DesktopMcpLifecycle, type McpHttpServerStarter } from '../src/main/mcp-lifecycle.js';

function createHandle(url: string, onClose: () => void): McpHttpServerHandle {
  const endpoint = new URL(url);
  return {
    address: { host: '127.0.0.1', port: Number(endpoint.port) },
    endpoint,
    close: async (): Promise<void> => { onClose(); },
  };
}

function createOptions(): McpHttpServerOptions {
  return {
    port: 0,
    services: {},
    actor: { clientId: 'desktop-global', clientName: 'lnwjud desktop' },
  };
}

describe('DesktopMcpLifecycle', () => {
  it('starts one application-global loopback server and exposes its live endpoint', async () => {
    let starts = 0;
    const starter: McpHttpServerStarter = {
      start: async (options) => {
        starts += 1;
        expect(options.port).toBe(0);
        return createHandle('http://127.0.0.1:43123/mcp', () => {});
      },
    };
    const lifecycle = new DesktopMcpLifecycle({ starter, createServerOptions: createOptions });

    await expect(lifecycle.start()).resolves.toEqual({
      running: true,
      url: 'http://127.0.0.1:43123/mcp',
      workspaceId: null,
    });
    expect(starts).toBe(1);
    expect(lifecycle.status()).toEqual({
      running: true,
      url: 'http://127.0.0.1:43123/mcp',
      workspaceId: null,
    });
  });

  it('coalesces duplicate starts while keeping one server handle', async () => {
    let starts = 0;
    let resolveStart: ((handle: McpHttpServerHandle) => void) | undefined;
    const pendingStart = new Promise<McpHttpServerHandle>((resolve) => { resolveStart = resolve; });
    const starter: McpHttpServerStarter = {
      start: async (): Promise<McpHttpServerHandle> => {
        starts += 1;
        return pendingStart;
      },
    };
    const lifecycle = new DesktopMcpLifecycle({ starter, createServerOptions: createOptions });

    const first = lifecycle.start();
    const second = lifecycle.start();
    resolveStart?.(createHandle('http://127.0.0.1:43124/mcp', () => {}));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { running: true, url: 'http://127.0.0.1:43124/mcp', workspaceId: null },
      { running: true, url: 'http://127.0.0.1:43124/mcp', workspaceId: null },
    ]);
    expect(starts).toBe(1);
  });

  it('closes the owned server and returns stopped status', async () => {
    let closes = 0;
    const starter: McpHttpServerStarter = {
      start: async (): Promise<McpHttpServerHandle> => createHandle('http://127.0.0.1:43125/mcp', () => { closes += 1; }),
    };
    const lifecycle = new DesktopMcpLifecycle({ starter, createServerOptions: createOptions });

    await lifecycle.start();
    await expect(lifecycle.stop()).resolves.toEqual({ running: false, url: null, workspaceId: null });
    expect(closes).toBe(1);
    expect(lifecycle.status()).toEqual({ running: false, url: null, workspaceId: null });
  });

  it('leaves state stopped when server startup fails and can retry', async () => {
    let starts = 0;
    const lifecycle = new DesktopMcpLifecycle({
      starter: {
        start: async (): Promise<McpHttpServerHandle> => {
          starts += 1;
          if (starts === 1) throw new Error('EADDRINUSE');
          return createHandle('http://127.0.0.1:43126/mcp', () => {});
        },
      },
      createServerOptions: createOptions,
    });

    await expect(lifecycle.start()).rejects.toThrow('EADDRINUSE');
    expect(lifecycle.status()).toEqual({ running: false, url: null, workspaceId: null });
    await expect(lifecycle.start()).resolves.toMatchObject({ running: true, workspaceId: null });
    expect(starts).toBe(2);
  });
});
