import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InFlightWorkItem, WorkLogEntry } from '@lnwjud/ipc-contracts';
import { WorkLogPanel } from '../src/renderer/features/worklog/WorkLogPanel.js';

const mockInFlight: InFlightWorkItem[] = [
  {
    callId: 'call-1',
    toolName: 'shell',
    startedAt: '2026-08-19T14:00:00.000Z',
    targetSummary: 'npm test',
    workspaceId: null,
  },
];

const mockEntries: WorkLogEntry[] = [
  {
    id: 'entry-1',
    timestamp: '2026-08-19T14:01:18.000Z',
    kind: 'result',
    toolName: 'shell',
    resultCode: 'SUCCESS',
    errorMessage: null,
    targetSummary: 'python -c "print(1)"',
    durationMs: 71,
    workspaceId: null,
  },
  {
    id: 'entry-2',
    timestamp: '2026-08-19T14:00:36.000Z',
    kind: 'error',
    toolName: 'shell',
    resultCode: 'PERMISSION_REQUIRED',
    errorMessage: 'Destructive operation requires explicit user confirmation',
    targetSummary: 'powershell -NoProfile -Command Remove-Item test',
    durationMs: 12,
    workspaceId: null,
  },
];

describe('WorkLogPanel', () => {
  it('renders entries and inFlight items with structured details and duration', () => {
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'บันทึกการทำงาน',
      emptyLabel: 'ยังไม่มีกิจกรรม',
      filterAllLabel: 'ทั้งหมด',
      filterErrorLabel: 'เฉพาะ error',
      clearLabel: 'ล้างประวัติ',
      filter: 'all',
      onFilterChange: () => {},
      onClear: async () => {},
      entries: mockEntries,
      inFlight: mockInFlight,
    }));

    expect(markup).toContain('บันทึกการทำงาน');
    expect(markup).toContain('[TASK]');
    expect(markup).toContain('[RESULT]');
    expect(markup).toContain('[ERROR]');
    expect(markup).toContain('npm test');
    expect(markup).toContain('python -c &quot;print(1)&quot;');
    expect(markup).toContain('powershell -NoProfile -Command Remove-Item test');
    expect(markup).toContain('Destructive operation requires explicit user confirmation');
    expect(markup).toContain('71ms');
    expect(markup).toContain('12ms');
  });

  it('filters by error properly when filter is error', () => {
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'บันทึกการทำงาน',
      emptyLabel: 'ยังไม่มีกิจกรรม',
      filterAllLabel: 'ทั้งหมด',
      filterErrorLabel: 'เฉพาะ error',
      clearLabel: 'ล้างประวัติ',
      filter: 'error',
      onFilterChange: () => {},
      onClear: async () => {},
      entries: mockEntries,
      inFlight: [],
    }));

    expect(markup).toContain('[ERROR]');
    expect(markup).toContain('Destructive operation requires explicit user confirmation');
    expect(markup).not.toContain('python -c &quot;print(1)&quot;');
  });
});
