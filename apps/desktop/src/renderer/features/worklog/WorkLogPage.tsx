import { useState, type ReactElement } from 'react';
import type { DashboardSnapshot, UiLocale, WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import { WorkLogPanel, type LogScopeSelection, type WorkLogFilter } from '../worklog/WorkLogPanel.js';

interface WorkLogPageProps {
  readonly locale: UiLocale;
  readonly dashboard: DashboardSnapshot;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly onClearWorkLog: (scope: LogScopeSelection) => Promise<void>;
  readonly onExportWorkLog: (rowIds: readonly string[]) => Promise<void>;
}

export function WorkLogPage(props: WorkLogPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const [filter, setFilter] = useState<WorkLogFilter>('all');
  return (
    <div className="page-content viewport-list-page worklog-page">
      <WorkLogPanel
        title={t('workLog.title')}
        emptyLabel={t('workLog.empty')}
        filterAllLabel={t('workLog.filterAll')}
        filterErrorLabel={t('workLog.filterError')}
        clearSessionLabel={t('scope.clearSession')}
        clearWorkspaceLabel={t('scope.clearWorkspace')}
        clearAllLabel={t('scope.clearAll')}
        filter={filter}
        onFilterChange={setFilter}
        onClear={props.onClearWorkLog}
        exportLabel={t('live.export')}
        onExport={props.onExportWorkLog}
        onResolveTargetDetail={async (detailRef) => (await window.lnwjud.resolveActivityTargetDetail({ detailRef })).detail}
        onSearchTargetDetails={async (query, candidates) => (await window.lnwjud.searchActivityTargetDetails({ query, candidates })).matchingIds}
        entries={props.dashboard.workLog}
        inFlight={props.dashboard.inFlight}
        workspaces={props.workspaces}
        defaultWorkspaceId={props.dashboard.selectedWorkspace?.id ?? null}
        workspaceLabel={t('scope.workspace')}
        sessionLabel={t('scope.session')}
        scopeAllLabel={t('scope.all')}
        searchPlaceholder={props.locale === 'th' ? 'ค้นหาบันทึกการทำงาน...' : 'Search work log...'}
        copyLabel={t('mcp.copy')}
        copiedLabel={t('mcp.copied')}
        showMoreLabel={t('logDetail.showMore')}
        showLessLabel={t('logDetail.showLess')}
        detailHeadingLabel={t('logDetail.heading')}
        detailLoadingLabel={t('logDetail.loading')}
        detailErrorLabel={t('logDetail.error')}
        detailEmptyLabel={t('logDetail.empty')}
        legacyIncompleteLabel={t('logDetail.legacyIncomplete')}
      />
    </div>
  );
}
