import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LogLevel, LogLine, LogSource } from '@lnwjud/ipc-contracts';
import { copyTextToClipboard } from '../../clipboard.js';
import type { MessageKey } from '../../i18n/messages.js';

export type LogTab = LogSource;
export type LogEventKind = 'task' | 'result' | 'error';

interface LogStreamPanelProps {
  readonly title: string;
  readonly source: LogSource;
  readonly lines: readonly LogLine[];
  readonly tunnelLogPath: string | null;
  readonly tunnelLogExists: boolean;
  readonly pauseLabel: string;
  readonly followLabel: string;
  readonly filterPlaceholder: string;
  readonly clearLabel: string;
  readonly exportLabel: string;
  readonly waitingLabel: string;
  readonly copyLabel?: string;
  readonly copiedLabel?: string;
  readonly onClear: () => Promise<void>;
  readonly onExport: () => Promise<void>;
}

const MAX_VISIBLE_LINES = 1_000;

export function LogStreamPanel(props: LogStreamPanelProps): ReactElement {
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => (
    filter.length === 0
      ? props.lines
      : props.lines.filter((line) => line.text.toLowerCase().includes(filter.toLowerCase()))
  ), [props.lines, filter]);
  const visible = [...filtered].sort(compareLogLinesNewestFirst).slice(0, MAX_VISIBLE_LINES);

  useEffect(() => {
    if (paused) return;
    const element = streamRef.current;
    if (element === null) return;
    element.scrollTop = 0;
  }, [visible.length, paused]);

  async function copyLine(line: LogLine): Promise<void> {
    if (!(await copyTextToClipboard(formatLogCopyText(line)))) return;
    setCopiedId(line.id);
    window.setTimeout(() => setCopiedId((current) => current === line.id ? null : current), 1_200);
  }

  return (
    <section className="panel log-panel" aria-label={props.title}>
      <div className="section-heading">
        <h2>{props.title}</h2>
        <div className="worklog-actions">
          <button type="button" className={paused ? 'active' : undefined} onClick={() => setPaused((value) => !value)}>
            {paused ? props.followLabel : props.pauseLabel}
          </button>
          <button type="button" onClick={() => { void props.onClear(); }}>{props.clearLabel}</button>
          <button type="button" onClick={() => { void props.onExport(); }}>{props.exportLabel}</button>
        </div>
      </div>
      <input
        type="text"
        className="log-filter"
        placeholder={props.filterPlaceholder}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        aria-label={props.filterPlaceholder}
      />
      {props.source === 'tunnel' && !props.tunnelLogExists ? (
        <p className="hint">
          {props.waitingLabel}
          {props.tunnelLogPath === null ? '' : ` (${props.tunnelLogPath})`}
        </p>
      ) : null}
      <div className="log-stream" ref={streamRef} data-testid="log-stream" role="log" aria-live="polite">
        {visible.length === 0 && !(props.source === 'tunnel' && !props.tunnelLogExists) ? (
          <p className="hint">{props.waitingLabel}</p>
        ) : null}
        {visible.map((line) => {
          const display = logDisplayParts(line);
          return (
            <div key={line.id} className={`log-line ${line.source} ${line.level}${display.kind === null ? '' : ' has-kind'}`}>
              <time>{formatTime(line.timestamp)}</time>
              <span className="tag level-tag">[{line.level.toUpperCase()}]</span>
              {display.kind === null ? null : <span className={`event-tag ${display.kind}`}>[{display.kind.toUpperCase()}]</span>}
              <span className="log-message">{display.detail}</span>
              <button
                type="button"
                className="row-copy-button"
                title={copiedId === line.id ? (props.copiedLabel ?? 'Copied') : (props.copyLabel ?? 'Copy full log')}
                aria-label={copiedId === line.id ? (props.copiedLabel ?? 'Copied') : (props.copyLabel ?? 'Copy full log')}
                onClick={() => { void copyLine(line); }}
              >
                {copiedId === line.id ? '✓' : '⧉'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function filterLines(lines: readonly LogLine[], source: LogSource): readonly LogLine[] {
  return lines.filter((line) => line.source === source);
}

export function logLevelFor(line: LogLine): LogLevel {
  return line.level;
}

export function compareLogLinesNewestFirst(left: LogLine, right: LogLine): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
  return right.id - left.id;
}

export function logDisplayParts(line: LogLine): { readonly kind: LogEventKind | null; readonly detail: string } {
  if (line.source === 'mcp') {
    const match = /^\[(TASK|RESULT|ERROR)\]\s*(.*)$/s.exec(line.text);
    if (match !== null) return { kind: match[1]!.toLowerCase() as LogEventKind, detail: match[2] ?? '' };
    if (line.correlation?.kind === 'mcp') {
      if (line.correlation.phase === 'started') return { kind: 'task', detail: line.text };
      const failed = line.correlation.resultCode !== null && line.correlation.resultCode !== 'SUCCESS';
      return { kind: failed ? 'error' : 'result', detail: line.text };
    }
  }
  return { kind: null, detail: line.text };
}

export function formatLogCopyText(line: LogLine): string {
  return `${line.timestamp} [${line.level.toUpperCase()}] ${line.text}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export type { MessageKey };