import type { ReactElement } from 'react';
import type { InFlightWorkItem, WorkLogEntry } from '@lnwjud/ipc-contracts';
import type { MessageKey } from '../../i18n/messages.js';

export type WorkLogFilter = 'all' | 'error';

type WorkLogRow =
  | { readonly kind: 'inflight'; readonly timestamp: string; readonly id: string; readonly item: InFlightWorkItem }
  | { readonly kind: 'entry'; readonly timestamp: string; readonly id: string; readonly item: WorkLogEntry };

interface WorkLogPanelProps {
  readonly title: string;
  readonly emptyLabel: string;
  readonly filterAllLabel: string;
  readonly filterErrorLabel: string;
  readonly clearLabel: string;
  readonly filter: WorkLogFilter;
  readonly onFilterChange: (filter: WorkLogFilter) => void;
  readonly onClear: () => Promise<void>;
  readonly entries: readonly WorkLogEntry[];
  readonly inFlight: readonly InFlightWorkItem[];
  readonly compact?: boolean;
}

export function WorkLogPanel(props: WorkLogPanelProps): ReactElement {
  const rows = newestFirstWorkLogRows(props.entries, props.inFlight, props.filter);
  const visible = props.compact ? rows.slice(0, 40) : rows;

  return (
    <section className={`panel worklog-panel${props.compact ? ' compact' : ''}`} aria-label={props.title}>
      <div className="section-heading">
        <h2>{props.title}</h2>
        <div className="worklog-actions">
          <button
            type="button"
            className={props.filter === 'all' ? 'active' : undefined}
            onClick={() => props.onFilterChange('all')}
          >
            {props.filterAllLabel}
          </button>
          <button
            type="button"
            className={props.filter === 'error' ? 'active' : undefined}
            onClick={() => props.onFilterChange('error')}
          >
            {props.filterErrorLabel}
          </button>
          <button type="button" onClick={() => { void props.onClear(); }}>{props.clearLabel}</button>
        </div>
      </div>
      <div className="worklog-stream" data-testid="work-log">
        {visible.length === 0 ? <p>{props.emptyLabel}</p> : null}
        {visible.map((row) => row.kind === 'inflight' ? (
          <div key={`inflight:${row.item.callId}`} className="worklog-line inflight">
            <time>{formatTime(row.item.startedAt)}</time>
            <span className="tag">[TASK]</span>
            <strong>{row.item.toolName}</strong>
            <span className="worklog-summary">{row.item.targetSummary ?? ''}</span>
            <span className="worklog-duration" />
          </div>
        ) : (
          <div key={`entry:${row.item.id}`} className={`worklog-line ${row.item.kind}`}>
            <time>{formatTime(row.item.timestamp)}</time>
            <span className="tag">{tagFor(row.item.kind)}</span>
            <strong>{row.item.toolName}</strong>
            <span className="worklog-summary">{renderEntryDetail(row.item)}</span>
            {row.item.kind !== 'task' ? <em>{row.item.durationMs}ms</em> : <span className="worklog-duration" />}
          </div>
        ))}
      </div>
    </section>
  );
}

export function newestFirstWorkLogRows(
  entries: readonly WorkLogEntry[],
  inFlight: readonly InFlightWorkItem[],
  filter: WorkLogFilter = 'all',
): readonly WorkLogRow[] {
  const entryRows = (filter === 'error' ? entries.filter((entry) => entry.kind === 'error') : entries)
    .map((item): WorkLogRow => ({ kind: 'entry', timestamp: item.timestamp, id: item.id, item }));
  const inFlightRows = filter === 'error'
    ? []
    : inFlight.map((item): WorkLogRow => ({ kind: 'inflight', timestamp: item.startedAt, id: item.callId, item }));
  return [...entryRows, ...inFlightRows].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    const timestampOrder = right.timestamp.localeCompare(left.timestamp);
    return timestampOrder !== 0 ? timestampOrder : right.id.localeCompare(left.id);
  });
}

function renderEntryDetail(entry: WorkLogEntry): ReactElement | string {
  if (entry.kind === 'error') {
    if (entry.targetSummary && entry.errorMessage) {
      return (
        <>
          <span>{entry.targetSummary}</span>
          <span className="worklog-error-detail"> — {entry.errorMessage}</span>
        </>
      );
    }
    if (entry.errorMessage) return <span className="worklog-error-detail">{entry.errorMessage}</span>;
    return entry.targetSummary ?? entry.resultCode;
  }
  return entry.targetSummary ?? entry.resultCode;
}

function tagFor(kind: WorkLogEntry['kind']): string {
  if (kind === 'task') return '[TASK]';
  if (kind === 'error') return '[ERROR]';
  return '[RESULT]';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export type { MessageKey };
