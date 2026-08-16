import type { ReactElement } from 'react';
import type { DashboardSnapshot, UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

interface GitPageProps {
  readonly locale: UiLocale;
  readonly gitSummary: DashboardSnapshot['gitSummary'];
}

export function GitPage({ locale, gitSummary }: GitPageProps): ReactElement {
  const t = createTranslator(locale);
  return (
    <div className="page-content">
      <h1>{t('git.title')}</h1>
      <section className="panel">
        <strong data-testid="git-summary">{gitSummary.message}</strong>
        <p>{gitSummary.branch ?? '—'}</p>
        <p>
          {gitSummary.changedFiles} {t('git.changed')} · {gitSummary.stagedFiles} {t('git.staged')}
        </p>
      </section>
    </div>
  );
}
