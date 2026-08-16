import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogHub } from '../src/main/log-hub.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LogHub', () => {
  it('includes filesystem error messages in work-log lines', () => {
    const hub = new LogHub({ tunnelLogPath: 'Z:\\missing\\lnwjud-tunnel.log' });
    hub.syncWorkLog([{
      id: '1',
      kind: 'error',
      toolName: 'write_file',
      resultCode: 'FILE_NOT_FOUND',
      errorMessage: 'File or directory was not found',
      targetSummary: 'docs\\plan.md',
    }], []);

    expect(hub.snapshot().lines[0]?.text).toContain('[ERROR] write_file FILE_NOT_FOUND — File or directory was not found');
  });

  it('feeds and snapshots lines per source with dedupe', () => {
    const hub = new LogHub({ tunnelLogPath: 'Z:\\missing\\lnwjud-tunnel.log' });
    hub.feedIfNew('mcp', 'a', 'info', 'first');
    hub.feedIfNew('mcp', 'a', 'info', 'duplicate');
    hub.feedIfNew('mcp', 'b', 'error', 'second');
    hub.feed('process', 'info', 'proc line');

    const snapshot = hub.snapshot();
    expect(snapshot.lines).toHaveLength(3);
    expect(snapshot.lines.map((line) => line.text)).toEqual(['first', 'second', 'proc line']);
    expect(snapshot.tunnelLogExists).toBe(false);
  });

  it('clears a single source', () => {
    const hub = new LogHub({ tunnelLogPath: 'Z:\\missing\\lnwjud-tunnel.log' });
    hub.feed('tunnel', 'info', 't1');
    hub.feed('mcp', 'info', 'm1');

    hub.clear('tunnel');

    const snapshot = hub.snapshot();
    expect(snapshot.lines.map((line) => line.source)).toEqual(['mcp']);
  });

  it('tails an appended tunnel log file', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-loghub-'));
    temporaryRoots.push(root);
    const logPath = path.join(root, 'lnwjud-tunnel.log');
    await writeFile(logPath, '{"level":"info","msg":"boot"}\n', 'utf8');
    const hub = new LogHub({ tunnelLogPath: logPath });
    hub.start();
    await vi.advanceTimersByTimeAsync(700);
    expect(hub.snapshot().lines.map((line) => line.text)).toContain('boot');

    await appendFile(logPath, 'plain text line\n{"level":"error","msg":"boom"}\n', 'utf8');
    await vi.advanceTimersByTimeAsync(700);
    hub.stop();
    const texts = hub.snapshot().lines.map((line) => line.text);
    expect(texts).toContain('plain text line');
    expect(texts).toContain('boom');
    expect(hub.snapshot().lines.find((line) => line.text === 'boom')?.level).toBe('error');
  });

  it('keeps a tunnel log line intact when it crosses a read chunk boundary', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-loghub-boundary-'));
    temporaryRoots.push(root);
    const logPath = path.join(root, 'lnwjud-tunnel.log');
    const message = 'x'.repeat(70_000);
    await writeFile(logPath, `${JSON.stringify({ level: 'info', msg: message })}\n`, 'utf8');

    const hub = new LogHub({ tunnelLogPath: logPath });
    hub.start();
    await vi.advanceTimersByTimeAsync(700);
    hub.stop();

    const lines = hub.snapshot().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe(message.slice(0, 8_192));
  });

  it('tails MCP activity NDJSON into the mcp source without waiting for getDashboard', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-loghub-mcp-'));
    temporaryRoots.push(root);
    const activityPath = path.join(root, 'mcp-activity.log');
    await writeFile(activityPath, `${JSON.stringify({
      callId: 'c1',
      toolName: 'read_file',
      phase: 'started',
      resultCode: 'STARTED',
      targetSummary: 'src\\\\app.ts',
    })}\n`, 'utf8');
    const hub = new LogHub({
      tunnelLogPath: path.join(root, 'missing-tunnel.log'),
      mcpActivityLogPath: activityPath,
    });
    hub.start();
    await vi.advanceTimersByTimeAsync(700);
    expect(hub.snapshot().lines.some((line) => line.source === 'mcp' && line.text.includes('read_file'))).toBe(true);

    await appendFile(activityPath, `${JSON.stringify({
      callId: 'c1',
      toolName: 'read_file',
      phase: 'completed',
      resultCode: 'SUCCESS',
      targetSummary: 'src\\\\app.ts',
    })}\n`, 'utf8');
    await vi.advanceTimersByTimeAsync(700);
    hub.stop();
    const mcpTexts = hub.snapshot().lines.filter((line) => line.source === 'mcp').map((line) => line.text);
    expect(mcpTexts.some((text) => text.includes('[RESULT] read_file SUCCESS'))).toBe(true);
  });

  it('dedupes file-tail MCP lines against syncWorkLog using callId keys', () => {
    const hub = new LogHub({ tunnelLogPath: 'Z:\\missing\\lnwjud-tunnel.log' });
    hub.syncWorkLog([{
      id: 'audit-1',
      callId: 'c1',
      kind: 'result',
      toolName: 'read_file',
      resultCode: 'SUCCESS',
      errorMessage: null,
      targetSummary: 'src\\app.ts',
    }], []);
    hub.syncWorkLog([{
      id: 'audit-1',
      callId: 'c1',
      kind: 'result',
      toolName: 'read_file',
      resultCode: 'SUCCESS',
      errorMessage: null,
      targetSummary: 'src\\app.ts',
    }], []);
    expect(hub.snapshot().lines).toHaveLength(1);
  });

  it('notifies subscribers of new lines', () => {
    const onLine = vi.fn();
    const hub = new LogHub({ tunnelLogPath: 'Z:\\missing\\lnwjud-tunnel.log', onLine });
    hub.feed('tunnel', 'warn', 'watch out');
    expect(onLine).toHaveBeenCalledWith(expect.objectContaining({ source: 'tunnel', level: 'warn', text: 'watch out' }));
  });
});
