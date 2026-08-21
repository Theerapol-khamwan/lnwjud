import type { ReactElement } from 'react';
import type { DashboardSnapshot, UiLocale, WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

interface GitPageProps {
  readonly locale: UiLocale;
  readonly gitSummary: DashboardSnapshot['gitSummary'];
  readonly selectedWorkspace?: WorkspaceSummary | null;
  readonly workspaces?: readonly WorkspaceSummary[];
  readonly onSelectWorkspace?: (workspaceId: string) => Promise<void>;
  readonly onRefresh?: () => Promise<void>;
}

export function GitPage({
  locale,
  gitSummary,
  selectedWorkspace,
  workspaces = [],
  onSelectWorkspace,
  onRefresh,
}: GitPageProps): ReactElement {
  const t = createTranslator(locale);
  const isClean = gitSummary.changedFiles === 0 && gitSummary.stagedFiles === 0;
  const isRepo = gitSummary.isRepo ?? (gitSummary.message !== 'Not a Git repository' && gitSummary.message !== 'No workspace selected');
  const currentPath = gitSummary.repositoryPath ?? selectedWorkspace?.realRootPath ?? '—';

  return (
    <div className="page-content viewport-list-page git-page">
      <div className="page-heading">
        <div>
          <h1>{t('git.title')}</h1>
          <p className="page-subtitle">
            {locale === 'th'
              ? `Workspace: ${selectedWorkspace?.displayName ?? '—'} (${currentPath})`
              : `Workspace: ${selectedWorkspace?.displayName ?? '—'} (${currentPath})`}
          </p>
        </div>
        <div className="heading-actions">
          {workspaces.length > 1 && onSelectWorkspace !== undefined ? (
            <div className="form-row">
              <select
                aria-label="Select workspace for Git"
                className="settings-select"
                value={selectedWorkspace?.id ?? ''}
                onChange={(event) => { void onSelectWorkspace(event.target.value); }}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    📁 {ws.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {onRefresh === undefined ? null : (
            <button type="button" onClick={() => { void onRefresh(); }}>
              🔄 {t('action.refresh')}
            </button>
          )}
        </div>
      </div>

      <section className="panel git-panel">
        <div className="section-heading">
          <h2>{locale === 'th' ? 'ภาพรวม Repository' : 'Repository Overview'}</h2>
          <span className={`pill-badge ${gitSummary.branch ? 'gold' : ''}`}>
            {gitSummary.branch ? `🌿 ${gitSummary.branch}` : (isRepo ? (locale === 'th' ? 'ไม่มี Branch' : 'No Branch') : (locale === 'th' ? 'ไม่ใช่ Git Repo' : 'Not a Git Repo'))}
          </span>
        </div>

        <div className="git-status-message">
          <strong data-testid="git-summary">{gitSummary.message}</strong>
        </div>

        <div className="git-metrics-grid">
          <div className="git-metric-card">
            <span className="git-metric-label">{locale === 'th' ? 'สาขาปัจจุบัน (Branch)' : 'Current Branch'}</span>
            <strong className="git-metric-value">{gitSummary.branch ?? '—'}</strong>
          </div>
          <div className="git-metric-card">
            <span className="git-metric-label">{t('git.changed')}</span>
            <strong className="git-metric-value">{gitSummary.changedFiles}</strong>
          </div>
          <div className="git-metric-card">
            <span className="git-metric-label">{t('git.staged')}</span>
            <strong className="git-metric-value">{gitSummary.stagedFiles}</strong>
          </div>
          <div className="git-metric-card">
            <span className="git-metric-label">{locale === 'th' ? 'สถานะ Working Tree' : 'Working Tree'}</span>
            <strong className={`git-metric-value ${!isRepo ? '' : isClean ? 'status-clean' : 'status-dirty'}`}>
              {!isRepo ? '—' : isClean ? (locale === 'th' ? 'สะอาด (Clean)' : 'Clean') : (locale === 'th' ? 'มีการแก้ไข (Modified)' : 'Modified')}
            </strong>
          </div>
        </div>

        {!isRepo ? (
          <div className="git-not-repo-notice">
            <div className="git-notice-header">
              <span className="git-notice-icon">💡</span>
              <div>
                <strong>{locale === 'th' ? 'โฟลเดอร์นี้ยังไม่ได้เชื่อมต่อเป็น Git Repository' : 'Current directory is not a Git repository'}</strong>
                <p className="hint">
                  {locale === 'th'
                    ? `โฟลเดอร์ "${currentPath}" ไม่มี .git หากต้องการดูสถานะ Git ให้เลือกหรือสลับไปยัง Workspace ที่เป็นโปรเจกต์ Git ของคุณ:`
                    : `Path "${currentPath}" has no .git folder. Switch to a Git workspace project below:`}
                </p>
              </div>
            </div>
            {workspaces.filter((ws) => ws.id !== selectedWorkspace?.id).length > 0 && onSelectWorkspace !== undefined ? (
              <div className="git-switch-list">
                {workspaces.filter((ws) => ws.id !== selectedWorkspace?.id).map((ws) => (
                  <div key={ws.id} className="git-switch-item">
                    <div>
                      <strong>📁 {ws.displayName}</strong>
                      <p className="hint">{ws.realRootPath}</p>
                    </div>
                    <button type="button" onClick={() => { void onSelectWorkspace(ws.id); }}>
                      {locale === 'th' ? 'สลับมายังโปรเจกต์นี้' : 'Switch to this project'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : gitSummary.entries !== undefined && gitSummary.entries.length > 0 ? (
          <div className="git-files-section">
            <h3>{locale === 'th' ? 'รายการไฟล์ที่มีการเปลี่ยนแปลง (Changed Files)' : 'Changed Files'}</h3>
            <div className="git-file-list">
              {gitSummary.entries.map((entry) => (
                <div key={entry.path} className="git-file-item">
                  <span className={`git-file-tag ${entry.kind}`}>
                    [{entry.kind.toUpperCase()}]
                  </span>
                  <span className="git-file-path">{entry.path}</span>
                  <span className="git-file-status">
                    {entry.indexStatus !== ' ' ? (locale === 'th' ? 'Staged' : 'Staged') : (locale === 'th' ? 'Unstaged' : 'Unstaged')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : isClean ? (
          <div className="git-clean-notice">
            <span>✨</span>
            <div>
              <strong>{locale === 'th' ? 'Working tree สะอาด' : 'Working Tree Clean'}</strong>
              <p className="hint">
                {locale === 'th'
                  ? 'ไม่มีไฟล์ที่ถูกแก้ไขหรือรอการ commit ใน repository นี้'
                  : 'No modified, untracked, or staged files found.'}
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
