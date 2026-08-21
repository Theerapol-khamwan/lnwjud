import { useState, type ReactElement } from 'react';
import type { DashboardSnapshot, IncidentClassification, UiLocale, WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

interface ControlCenterPageProps {
  readonly dashboard: DashboardSnapshot;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly locale: UiLocale;
  readonly mcpBusy: boolean;
  readonly tunnelBusy: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onStopMcp: () => Promise<void>;
  readonly onRestartMcp: () => Promise<void>;
  readonly onSelectWorkspace: (workspaceId: string) => Promise<void>;
  readonly onAddWorkspace: (rootPath: string) => Promise<void>;
  readonly onStartTunnel: () => Promise<void>;
  readonly onStopTunnel: () => Promise<void>;
  readonly onCaptureIncident: () => Promise<void>;
  readonly incidentBusy: boolean;
  readonly incidentClassification: IncidentClassification | null;
  readonly incidentCapturedAt: string | null;
  readonly incidentNotice: string | null;
}

export function ControlCenterPage(props: ControlCenterPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const { dashboard } = props;
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [selectedId, setSelectedId] = useState(dashboard.selectedWorkspace?.id ?? '');

  const agentLabel = dashboard.agentState === 'busy'
    ? t('agent.busy')
    : dashboard.agentState === 'idle'
      ? t('agent.ready')
      : t('agent.stopped');

  const tunnelLabel = dashboard.tunnel.state === 'running'
    ? dashboard.tunnel.source === 'external'
      ? t('tunnel.runningExternal')
      : t('tunnel.running')
    : dashboard.tunnel.state === 'starting'
      ? t('tunnel.starting')
      : dashboard.tunnel.state === 'error'
        ? t('tunnel.error')
        : t('tunnel.stopped');

  const stdioBroad = dashboard.stdioPermissionProfile === 'full' && !dashboard.stdioStrictRoots;
  const broadAccess = dashboard.unrestricted || dashboard.allowAiDelete || stdioBroad;
  const onOff = (enabled: boolean): string => enabled ? t('security.enabled') : t('security.disabled');
  const workspaceScope = dashboard.stdioStrictRoots
    ? `${dashboard.stdioAllowedRoots.length} ${t('security.allowedRoots')}`
    : t('security.machineRoots');

  async function copyText(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopyStatus(t('mcp.copied'));
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>{t('home.title')}</h1>
          <p className="page-subtitle">{t('home.subtitle')}</p>
        </div>
        <div className="heading-actions">
          <button type="button" onClick={() => { void props.onRefresh(); }}>{t('action.refresh')}</button>
          <button type="button" disabled={props.incidentBusy} onClick={() => { void props.onCaptureIncident(); }}>{t('live.captureIncident')}</button>
          <button type="button" disabled={props.mcpBusy || !dashboard.mcp.running} onClick={() => { void props.onStopMcp(); }}>
            {t('action.stop')}
          </button>
          <button type="button" disabled={props.mcpBusy || dashboard.selectedWorkspace === null} onClick={() => { void props.onRestartMcp(); }}>
            {t('action.restart')}
          </button>
        </div>
      </div>
      {!props.incidentBusy && props.incidentNotice === null && props.incidentClassification === null ? null : <p role="status" className="hint">{props.incidentBusy ? t('live.incident.capturing') : props.incidentNotice ?? `${incidentLabel(t, props.incidentClassification!)} · ${props.incidentCapturedAt ?? ''}`}</p>}

      <section className="panel agent-status-panel" aria-label={agentLabel}>
        <div className={`agent-orb ${dashboard.agentState}`} data-testid="agent-state" />
        <div>
          <strong data-testid="mcp-status">{agentLabel}</strong>
          <p>
            {t('agent.mode')}
            {dashboard.unrestricted ? ` • ${t('badge.unrestricted')}` : ''}
          </p>
        </div>
      </section>

      <section className={`panel security-overview ${broadAccess ? 'security-risk-broad' : 'security-risk-restricted'}`} aria-label={t('security.title')}>
        <div className="security-overview-header">
          <div>
            <h2>{t('security.title')}</h2>
            <p className="hint">{t('security.strictHint')}</p>
          </div>
          <span className={`security-summary-chip ${broadAccess ? 'broad' : 'restricted'}`} data-testid="security-summary">
            {broadAccess ? t('security.summaryBroad') : t('security.summaryRestricted')}
          </span>
        </div>
        <div className="security-overview-grid">
          <SecurityMetric label={t('security.desktopProfile')} value={dashboard.permissionProfile.toUpperCase()} />
          <SecurityMetric label={t('security.stdioProfile')} value={dashboard.stdioPermissionProfile.toUpperCase()} />
          <SecurityMetric label={t('security.strictRoots')} value={onOff(dashboard.stdioStrictRoots)} state={dashboard.stdioStrictRoots ? 'safe' : 'warn'} />
          <SecurityMetric label={t('security.aiDelete')} value={onOff(dashboard.allowAiDelete)} state={dashboard.allowAiDelete ? 'warn' : 'safe'} />
          <SecurityMetric label={t('security.unrestricted')} value={onOff(dashboard.unrestricted)} state={dashboard.unrestricted ? 'warn' : 'safe'} />
          <SecurityMetric label={t('security.workspaceScope')} value={workspaceScope} state={dashboard.stdioStrictRoots ? 'safe' : 'warn'} />
          <SecurityMetric label={t('security.tunnelAccess')} value={tunnelLabel} state={dashboard.tunnel.state === 'running' ? 'active' : 'neutral'} />
          <SecurityMetric label={t('security.registeredWorkspaces')} value={String(props.workspaces.length)} />
        </div>
        {stdioBroad ? <div className="security-warning" role="status">⚠ {t('security.warningBroad')}</div> : null}
      </section>

      <div className="home-grid">
        <section className="panel">
          <h2>{t('mcp.localUrl')}</h2>
          <code data-testid="mcp-endpoint" className="endpoint">
            {dashboard.connectionModes.httpUrl ?? '—'}
          </code>
          <div className="inline-actions">
            <button
              type="button"
              disabled={dashboard.connectionModes.httpUrl === null}
              onClick={() => {
                if (dashboard.connectionModes.httpUrl !== null) void copyText(dashboard.connectionModes.httpUrl);
              }}
            >
              {t('mcp.copy')}
            </button>
            {copyStatus === null ? null : <span data-testid="mcp-copy-status" role="status">{copyStatus}</span>}
          </div>
          <p className="hint">{t('mcp.stdioCommand')}</p>
          <code className="endpoint">{dashboard.connectionModes.stdioCommand}</code>
        </section>

        <section className="panel">
          <h2>{t('tunnel.title')}</h2>
          <p data-testid="tunnel-status">{tunnelLabel}</p>
          {dashboard.tunnel.message ? <p className="hint error-text">{dashboard.tunnel.message}</p> : null}
          {!dashboard.tunnel.hasApiKey ? <p className="hint">{t('tunnel.needKey')}</p> : null}
          {!dashboard.tunnel.profileExists ? <p className="hint">{t('tunnel.needProfile')}</p> : null}
          <div className="inline-actions">
            <button
              type="button"
              disabled={props.tunnelBusy || !dashboard.tunnel.hasApiKey || dashboard.tunnel.state === 'running'}
              onClick={() => { void props.onStartTunnel(); }}
            >
              {t('tunnel.start')}
            </button>
            <button
              type="button"
              disabled={props.tunnelBusy || dashboard.tunnel.state === 'stopped'}
              onClick={() => { void props.onStopTunnel(); }}
            >
              {t('tunnel.stop')}
            </button>
          </div>
        </section>
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2>{t('project.active')}</h2>
          <div className="form-row">
            <select
              aria-label={t('project.active')}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {props.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={selectedId.length === 0}
              onClick={() => { void props.onSelectWorkspace(selectedId); }}
            >
              {t('project.setMain')}
            </button>
          </div>
          <label className="field-label" htmlFor="add-project-path">{t('project.add')}</label>
          <p className="hint">{t('project.addHint')}</p>
          <div className="form-row">
            <input
              id="add-project-path"
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder="D:\\projects\\app"
            />
            <button
              type="button"
              onClick={() => {
                void props.onAddWorkspace(projectPath).then(() => setProjectPath(''));
              }}
            >
              {t('project.add')}
            </button>
          </div>
        </section>

        <section className="info-cards" aria-label="Status cards">
          <article className="info-card">
            <p>{t('info.workspace')}</p>
            <strong data-testid="workspace-real-root">{dashboard.selectedWorkspace?.realRootPath ?? '—'}</strong>
          </article>
          <article className="info-card">
            <p>{t('info.activeProject')}</p>
            <strong>{dashboard.selectedWorkspace?.displayName ?? '—'}</strong>
            <span data-testid="workspace-id" hidden>{dashboard.selectedWorkspace?.id ?? ''}</span>
          </article>
          <article className="info-card">
            <p>{t('info.mode')}</p>
            <strong>{dashboard.mode}</strong>
          </article>
        </section>
      </div>

    </div>
  );
}

function SecurityMetric(props: { readonly label: string; readonly value: string; readonly state?: 'safe' | 'warn' | 'active' | 'neutral' }): ReactElement {
  return (
    <article className={`security-metric ${props.state ?? 'neutral'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function incidentLabel(t: ReturnType<typeof createTranslator>, classification: IncidentClassification): string {
  if (classification === 'local_tool_failed') return t('live.incident.localToolFailed');
  if (classification === 'tunnel_disconnected') return t('live.incident.tunnelDisconnected');
  if (classification === 'remote_turn_stopped') return t('live.incident.remoteTurnStopped');
  return t('live.incident.healthyOrInconclusive');
}
