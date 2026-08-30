import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InFlightWorkItem, WorkLogEntry } from '@lnwjud/ipc-contracts';
import { formatWorkLogCopyText, newestFirstWorkLogRows, WorkLogPanel } from '../src/renderer/features/worklog/WorkLogPanel.js';

const mockInFlight: InFlightWorkItem[] = [
  {
    callId: 'call-1',
    toolName: 'shell',
    startedAt: '2026-08-19T14:00:00.000Z',
    targetSummary: 'npm test',
    targetDetail: { detailRef: null, itemCount: 1, preview: ['npm test'], legacyIncomplete: false },
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
    targetDetail: { detailRef: null, itemCount: 1, preview: ['python -c "print(1)"'], legacyIncomplete: false },
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
    targetDetail: { detailRef: null, itemCount: 1, preview: ['powershell -NoProfile -Command Remove-Item test'], legacyIncomplete: false },
    durationMs: 12,
    workspaceId: 'workspace-1',
    sessionId: 'session-a',
  },
];

describe('WorkLogPanel', () => {
  it('keeps a 500-row dashboard snapshot compact when every call has 500 maximum-length targets', () => {
    const maximumLengthPath = `E:\\${'x'.repeat(4_093)}`;
    const boundedPreview = maximumLengthPath.slice(0, 256);
    const rows: WorkLogEntry[] = Array.from({ length: 500 }, (_, index) => ({
      id: `entry-${index}`,
      timestamp: `2026-08-30T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      kind: 'result',
      toolName: 'read_files',
      resultCode: 'SUCCESS',
      errorMessage: null,
      targetSummary: maximumLengthPath,
      targetDetail: { detailRef: `call-${index}`, itemCount: 500, preview: [boundedPreview, boundedPreview, boundedPreview], legacyIncomplete: false },
      durationMs: 1,
      workspaceId: 'workspace-1',
      sessionId: 'session-a',
    }));
    const snapshot = JSON.stringify(rows);
    expect(rows).toHaveLength(500);
    expect(snapshot.match(/"itemCount":500/g)).toHaveLength(500);
    expect(snapshot).not.toContain('"items"');
    expect(snapshot.length).toBeLessThan(3_000_000);
  });

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
  it('disambiguates duplicate workspace names and suppresses duplicate registrations for the same root', () => {
    const workspaces = [
      { id: 'drive-e', displayName: 'Local Disk E:', rootPath: 'E:\\', realRootPath: 'E:\\', createdAt: '2026-08-01T00:00:00.000Z', kind: 'machine_root' as const },
      { id: 'workspace-a', displayName: 'lnwjud', rootPath: 'E:\\lnwjud', realRootPath: 'E:\\lnwjud', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'workspace-alias', displayName: 'lnwjud', rootPath: 'E:/lnwjud/', realRootPath: 'E:/lnwjud/', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'workspace-b', displayName: 'lnwjud', rootPath: 'D:\\projects\\lnwjud', realRootPath: 'D:\\projects\\lnwjud', createdAt: '2026-08-01T00:00:00.000Z' },
    ];
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'Work log', emptyLabel: 'Empty', filterAllLabel: 'All', filterErrorLabel: 'Errors',
      clearSessionLabel: 'Clear session', clearWorkspaceLabel: 'Clear workspace', clearAllLabel: 'Clear all',
      filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: [], inFlight: [], workspaces,
    }));
    expect(markup).toContain('lnwjud — E:\\lnwjud');
    expect(markup).toContain('lnwjud — D:\\projects\\lnwjud');
    expect(markup.match(/value="workspace-alias"/g)).toBeNull();
    expect(markup).not.toContain('Local Disk E:');
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

  it('treats slash and case variants of a legacy workspace path as the same project', () => {
    const workspaces = [
      { id: 'lnwjud-project', displayName: 'lnwjud', rootPath: 'E:\\lnwjud', realRootPath: 'E:\\lnwjud', createdAt: '2026-08-01T00:00:00.000Z' },
    ];
    const entries: WorkLogEntry[] = [
      { ...mockEntries[0]!, id: 'slash', workspaceId: 'e:/LNWJUD/' },
      { ...mockEntries[1]!, id: 'backslash', workspaceId: 'E:\\lnwjud' },
      { ...mockEntries[0]!, id: 'other', workspaceId: 'E:\\other' },
    ];

    const rows = newestFirstWorkLogRows(entries, [], 'all', '', { workspaceId: 'lnwjud-project', sessionId: null }, workspaces);
    expect(rows.map((row) => row.id)).toEqual(['slash', 'backslash']);
  });

  it('formats copied/exported timestamps in the same local timezone used by the UI', () => {
    const rows = newestFirstWorkLogRows(mockEntries, mockInFlight);
    const row = rows[0]!;
    const text = formatWorkLogCopyText(row);
    const localDate = new Date(row.timestamp);
    const expected = `${String(localDate.getDate()).padStart(2, '0')}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${localDate.getFullYear()} ${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}:${String(localDate.getSeconds()).padStart(2, '0')}`;
    expect(text.startsWith(expected)).toBe(true);
    expect(text).not.toContain(row.timestamp);
  });

  it('renders export when supplied so the Work Log page can export its visible rows', () => {
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'Work log', emptyLabel: 'Empty', filterAllLabel: 'All', filterErrorLabel: 'Errors',
      clearSessionLabel: 'Clear session', clearWorkspaceLabel: 'Clear workspace', clearAllLabel: 'Clear all',
      exportLabel: 'Export visible', onExport: async () => {},
      filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: mockEntries, inFlight: mockInFlight,
    }));
    expect(markup).toContain('Export visible');
  });

  it('starts long persisted and in-flight rows collapsed with accessible localized detail controls', () => {
    const longEntry: WorkLogEntry = {
      ...mockEntries[0]!,
      id: 'event-long',
      callId: 'call-long',
      targetSummary: 'a.ts, b.ts, c.ts (+4)',
      targetDetail: { detailRef: 'call-long', itemCount: 7, preview: ['a.ts', 'b.ts', 'c.ts'], legacyIncomplete: false },
    };
    const longInFlight: InFlightWorkItem = {
      ...mockInFlight[0]!,
      callId: 'call-live',
      targetSummary: 'one.ts, two.ts, three.ts (+6)',
      targetDetail: { detailRef: 'call-live', itemCount: 9, preview: ['one.ts', 'two.ts', 'three.ts'], legacyIncomplete: false },
    };
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'บันทึกการทำงาน', emptyLabel: 'ยังไม่มีกิจกรรม', filterAllLabel: 'ทั้งหมด', filterErrorLabel: 'เฉพาะ error',
      clearSessionLabel: 'ล้าง Session นี้', clearWorkspaceLabel: 'ล้าง Workspace นี้', clearAllLabel: 'ล้างทั้งหมด',
      filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: [longEntry], inFlight: [longInFlight],
      showMoreLabel: 'ดูเพิ่ม', showLessLabel: 'แสดงน้อยลง', detailHeadingLabel: 'รายการเป้าหมาย',
    }));

    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(markup.match(/aria-controls="log-detail-/g)).toHaveLength(2);
    expect(markup.match(/>ดูเพิ่ม</g)).toHaveLength(2);
    expect(markup).not.toContain('แสดงน้อยลง');
    expect(markup).not.toContain('<li>d.ts</li>');
  });

  it('warns truthfully when a legacy (+N) row cannot be expanded losslessly', () => {
    const legacy: WorkLogEntry = {
      ...mockEntries[0]!,
      id: 'legacy-event',
      targetSummary: 'old-a.ts, old-b.ts (+5)',
      targetDetail: { detailRef: null, itemCount: 7, preview: ['old-a.ts', 'old-b.ts'], legacyIncomplete: true },
    };
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'Work log', emptyLabel: 'Empty', filterAllLabel: 'All', filterErrorLabel: 'Errors',
      clearSessionLabel: 'Clear session', clearWorkspaceLabel: 'Clear workspace', clearAllLabel: 'Clear all',
      filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: [legacy], inFlight: [],
      legacyIncompleteLabel: 'Older log: the omitted items were not retained.',
    }));

    expect(markup).toContain('Older log: the omitted items were not retained.');
    expect(markup).not.toContain('aria-expanded');
  });

  it('does not claim ordinary legacy summaries lost omitted items', () => {
    const legacy: WorkLogEntry = {
      ...mockEntries[0]!,
      id: 'legacy-complete-event',
      targetSummary: 'single retained target',
      targetDetail: { detailRef: null, itemCount: 1, preview: ['single retained target'], legacyIncomplete: true },
    };
    const markup = renderToStaticMarkup(createElement(WorkLogPanel, {
      title: 'Work log', emptyLabel: 'Empty', filterAllLabel: 'All', filterErrorLabel: 'Errors',
      clearSessionLabel: 'Clear session', clearWorkspaceLabel: 'Clear workspace', clearAllLabel: 'Clear all',
      filter: 'all', onFilterChange: () => {}, onClear: async () => {}, entries: [legacy], inFlight: [],
      legacyIncompleteLabel: 'Older log: the omitted items were not retained.',
    }));

    expect(markup).not.toContain('Older log: the omitted items were not retained.');
  });

  it('formats all resolved target items for copy even while the row remains collapsed', () => {
    const row = newestFirstWorkLogRows([{
      ...mockEntries[0]!, id: 'event-copy', callId: 'call-copy', targetSummary: 'a.ts, b.ts, c.ts (+4)',
      targetDetail: { detailRef: 'call-copy', itemCount: 7, preview: ['a.ts', 'b.ts', 'c.ts'], legacyIncomplete: false },
    }], [])[0]!;
    const formatWithDetail = formatWorkLogCopyText as unknown as (
      value: typeof row,
      resolvedTargets: ReadonlyMap<string, string>,
      detail: { readonly kind: 'files'; readonly items: readonly string[] },
    ) => string;
    const copied = formatWithDetail(row, new Map(), {
      kind: 'files', items: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
    });

    for (const item of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']) expect(copied).toContain(item);
  });

});
