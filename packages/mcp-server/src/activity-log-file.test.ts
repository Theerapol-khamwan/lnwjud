import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityTracker } from './activity-tracker.js';
import { createFileActivitySink, formatActivityLogLine, mcpActivityLogPath } from './activity-log-file.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('mcp activity log file', () => {
  it('resolves the activity log under the shared data path', () => {
    expect(mcpActivityLogPath('C:\\Users\\me\\AppData\\Roaming\\lnwjud')).toMatch(/mcp-activity\.log$/);
  });

  it('writes started and completed NDJSON lines that Live Logs can tail', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-activity-'));
    temporaryRoots.push(root);
    const filePath = mcpActivityLogPath(root);
    const tracker = new ActivityTracker(createFileActivitySink(filePath));

    const callId = await tracker.begin('read_file', { path: 'src\\app.ts' });
    await tracker.end(callId, 'SUCCESS', 4);

    const raw = await readFile(filePath, 'utf8');
    const lines = raw.trim().split('\n').map((line) => JSON.parse(line) as { callId: string; phase: string; toolName: string });
    expect(lines).toEqual([
      expect.objectContaining({ callId, phase: 'started', toolName: 'read_file' }),
      expect.objectContaining({ callId, phase: 'completed', toolName: 'read_file' }),
    ]);
    expect(formatActivityLogLine({
      callId: 'c1',
      toolName: 'write_file',
      phase: 'completed',
      resultCode: 'FILE_NOT_FOUND',
      durationMs: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      resultMessage: 'missing',
    })).toContain('"toolName":"write_file"');
  });
});
