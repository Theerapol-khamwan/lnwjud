import { describe, expect, it } from 'vitest';
import type { LogLine } from '@lnwjud/ipc-contracts';
import { applyLogSnapshot } from '../src/renderer/features/live/log-buffer.js';

function line(id: number, text: string): LogLine {
  return { id, source: 'mcp', timestamp: '2026-01-01T00:00:00.000Z', level: 'info', text };
}

describe('applyLogSnapshot', () => {
  it('keeps live lines that arrived before a stale snapshot resolves', () => {
    const live = line(2, 'live mcp');
    const snapshot = [line(1, 'older')];
    const merged = applyLogSnapshot([live], new Set([2]), snapshot);
    expect(merged.lines.map((entry) => entry.text)).toEqual(['older', 'live mcp']);
    expect(merged.ids.has(2)).toBe(true);
    expect(merged.ids.has(1)).toBe(true);
  });
});
