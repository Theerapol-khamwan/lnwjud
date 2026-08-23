import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InFlightWorkItem, WorkLogEntry } from '@lnwjud/ipc-contracts';
import { newestFirstWorkLogRows, WorkLogPanel } from '../src/renderer/features/worklog/WorkLogPanel.js';

const mockInFlight: InFlightWorkItem[] = [
  {
    callId: 'call-1',
    toolName: 'shell',
    startedAt: '2026-08-19T14:00:00.000Z',
    targetSummary: 'npm test',
    workspaceId: 'workspace-1',
    sessionId: 'session-a',
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
    workspaceId: 'workspace-1',
    sessionId: 'session-a',
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
    workspaceId: 'workspace-1',
    sessionId: 'session-a',
  },
];

describe('WorkLogPanel', () => {
  it('renders entries and inFlight items with structured details and duration', () => {
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'บันทึกการทำงาน',
      emptyLabel: 'ยังไม่มีกิจกรรม',
      filterAllLabel: 'ทั้งหมด',
      filterErrorLabel: 'เฉพาะ error',
      clearSessionLabel: 'ล้าง Session นี้', clearWorkspaceLabel: 'ล้าง Workspace นี้', clearAllLabel: 'ล้างทั้งหมด',
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
      clearSessionLabel: 'ล้าง Session นี้', clearWorkspaceLabel: 'ล้าง Workspace นี้', clearAllLabel: 'ล้างทั้งหมด',
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

  it('renders search and copy controls and filters rows by full log details', () => {
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'บันทึกการทำงาน', emptyLabel: 'ยังไม่มีกิจกรรม', filterAllLabel: 'ทั้งหมด', filterErrorLabel: 'เฉพาะ error',
      clearSessionLabel: 'ล้าง Session นี้', clearWorkspaceLabel: 'ล้าง Workspace นี้', clearAllLabel: 'ล้างทั้งหมด', filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: mockEntries, inFlight: mockInFlight,
      searchPlaceholder: 'ค้นหาบันทึกการทำงาน...', copyLabel: 'คัดลอก', copiedLabel: 'คัดลอกแล้ว',
    }));
    expect(markup).toContain('type="search"');
    expect(markup).toContain('ค้นหาบันทึกการทำงาน...');
    expect(markup.match(/row-copy-button/g)?.length).toBe(3);

    const resultMatches = newestFirstWorkLogRows(mockEntries, mockInFlight, 'all', 'print(1)');
    expect(resultMatches).toHaveLength(1);
    expect(resultMatches[0]?.id).toBe('entry-1');
    const errorMatches = newestFirstWorkLogRows(mockEntries, mockInFlight, 'all', 'explicit user confirmation');
    expect(errorMatches).toHaveLength(1);
    expect(errorMatches[0]?.id).toBe('entry-2');
  });
  it('filters by workspace and session without collapsing identical in-flight call IDs', () => {
    const inFlight: InFlightWorkItem[] = [
      { ...mockInFlight[0]!, callId: 'same-call', workspaceId: 'workspace-1', sessionId: 'session-a' },
      { ...mockInFlight[0]!, callId: 'same-call', workspaceId: 'workspace-1', sessionId: 'session-b' },
      { ...mockInFlight[0]!, callId: 'other-call', workspaceId: 'workspace-2', sessionId: 'session-c' },
    ];
    const allWorkspaceOne = newestFirstWorkLogRows([], inFlight, 'all', '', { workspaceId: 'workspace-1', sessionId: null });
    expect(allWorkspaceOne).toHaveLength(2);
    expect(new Set(allWorkspaceOne.map((row) => row.id)).size).toBe(2);
    const oneSession = newestFirstWorkLogRows([], inFlight, 'all', '', { workspaceId: 'workspace-1', sessionId: 'session-b' });
    expect(oneSession).toHaveLength(1);
    expect(oneSession[0]?.item.sessionId).toBe('session-b');
  });

});
