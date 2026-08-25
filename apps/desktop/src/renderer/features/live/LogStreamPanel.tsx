import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LogLevel, LogLine, LogSource, WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { copyTextToClipboard } from '../../clipboard.js';
import type { MessageKey } from '../../i18n/messages.js';

export type LogTab = LogSource;
export type LogEventKind = 'task' | 'result' | 'error';

export interface LogScopeSelection {
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
}

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
  readonly clearSessionLabel: string;
  readonly clearWorkspaceLabel: string;
  readonly exportLabel: string;
  readonly waitingLabel: string;
  readonly copyLabel?: string;
  readonly copiedLabel?: string;
  readonly onClear: (scope: LogScopeSelection) => Promise<void>;
  readonly onExport: (scope: LogScopeSelection, query: string) => Promise<void>;
  readonly workspaces?: readonly WorkspaceSummary[];
  readonly workspaceLabel?: string;
  readonly sessionLabel?: string;
  readonly scopeAllLabel?: string;
}


const MAX_VISIBLE_LINES = 1_000;

export function LogStreamPanel(props: LogStreamPanelProps): ReactElement {
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const workspaceOptions = useMemo(() => collectWorkspaceOptions(props.lines, props.workspaces), [props.lines, props.workspaces]);
  const sessionOptions = useMemo(() => collectSessionOptions(props.lines, workspaceId), [props.lines, workspaceId]);
  useEffect(() => {
    if (sessionId !== null && !sessionOptions.includes(sessionId)) setSessionId(null);
  }, [sessionId, sessionOptions]);
  const scope = useMemo<LogScopeSelection>(() => ({ workspaceId, sessionId }), [workspaceId, sessionId]);
  const filtered = useMemo(() => filterLogLinesByScope(props.lines, scope, filter), [props.lines, scope, filter]);
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
          <button type="button" disabled={sessionId === null} onClick={() => { if (sessionId !== null) void props.onClear({ workspaceId: null, sessionId }); }}>{props.clearSessionLabel}</button>
          <button type="button" disabled={workspaceId === null} onClick={() => { if (workspaceId !== null) void props.onClear({ workspaceId, sessionId: null }); }}>{props.clearWorkspaceLabel}</button>
          <button type="button" onClick={() => { void props.onClear({ workspaceId: null, sessionId: null }); }}>{props.clearLabel}</button>
          <button type="button" onClick={() => { void props.onExport(scope, filter); }}>{props.exportLabel}</button>
        </div>
      </div>
      <div className="scope-filter-bar">
        <label>
          <span>{props.workspaceLabel ?? 'Workspace'}</span>
          <select value={workspaceId ?? ''} onChange={(event) => setWorkspaceId(event.target.value.length === 0 ? null : event.target.value)}>
            <option value="">{props.scopeAllLabel ?? 'All'}</option>
            {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>{props.sessionLabel ?? 'Session'}</span>
          <select value={sessionId ?? ''} onChange={(event) => setSessionId(event.target.value.length === 0 ? null : event.target.value)}>
            <option value="">{props.scopeAllLabel ?? 'All'}</option>
            {sessionOptions.map((value) => <option key={value} value={value}>{shortScopeId(value)}</option>)}
          </select>
        </label>
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
              <span className="log-message"><ScopeBadges line={line} showWorkspace={workspaceId === null} showSession={sessionId === null} workspaces={props.workspaces} />{display.detail}</span>
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

export function filterLogLinesByScope(lines: readonly LogLine[], scope: LogScopeSelection, search = ''): readonly LogLine[] {
  const needle = search.trim().toLowerCase();
  return lines.filter((line) => {
    if (scope.workspaceId !== null && line.workspaceId !== scope.workspaceId) return false;
    if (scope.sessionId !== null && line.sessionId !== scope.sessionId) return false;
    return needle.length === 0 || line.text.toLowerCase().includes(needle);
  });
}

function collectWorkspaceOptions(lines: readonly LogLine[], workspaces: readonly WorkspaceSummary[] | undefined): readonly { readonly id: string; readonly label: string }[] {
  const workspaceList = workspaces ?? [];
  const knownWorkspaceIds = new Set(workspaceList.map((workspace) => workspace.id));
  const canonicalWorkspaces: WorkspaceSummary[] = [];
  const seenRoots = new Set<string>();
  for (const workspace of workspaceList) {
    if (workspace.kind === 'machine_root') continue;
    const rootKey = workspace.realRootPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);
    canonicalWorkspaces.push(workspace);
  }

  const nameCounts = new Map<string, number>();
  for (const workspace of canonicalWorkspaces) {
    const key = workspace.displayName.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const workspace of canonicalWorkspaces) {
    const key = workspace.displayName.trim().toLocaleLowerCase();
    const duplicateName = (nameCounts.get(key) ?? 0) > 1;
    labels.set(workspace.id, duplicateName ? workspace.displayName + ' — ' + workspace.realRootPath : workspace.displayName);
  }
  for (const line of lines) {
    if (line.workspaceId === null || labels.has(line.workspaceId) || knownWorkspaceIds.has(line.workspaceId)) continue;
    labels.set(line.workspaceId, shortScopeId(line.workspaceId));
  }
  return [...labels.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function collectSessionOptions(lines: readonly LogLine[], workspaceId: string | null): readonly string[] {
  const values = new Set<string>();
  for (const line of lines) {
    if (workspaceId !== null && line.workspaceId !== workspaceId) continue;
    if (line.sessionId !== null) values.add(line.sessionId);
  }
  return [...values].sort();
}

function ScopeBadges(props: { readonly line: LogLine; readonly showWorkspace: boolean; readonly showSession: boolean; readonly workspaces: readonly WorkspaceSummary[] | undefined }): ReactElement | null {
  const workspaceLabel = props.line.workspaceId === null ? null : props.workspaces?.find((workspace) => workspace.id === props.line.workspaceId)?.displayName ?? shortScopeId(props.line.workspaceId);
  const sessionLabel = props.line.sessionId === null ? null : shortScopeId(props.line.sessionId);
  if ((!props.showWorkspace || workspaceLabel === null) && (!props.showSession || sessionLabel === null)) return null;
  return <span className="scope-badges">
    {props.showWorkspace && workspaceLabel !== null ? <span className="scope-badge workspace">{workspaceLabel}</span> : null}
    {props.showSession && sessionLabel !== null ? <span className="scope-badge session">{sessionLabel}</span> : null}
  </span>;
}

function shortScopeId(value: string): string {
  return value.length <= 14 ? value : value.slice(0, 8) + '…' + value.slice(-4);
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