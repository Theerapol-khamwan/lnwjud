import type { ReactElement } from 'react';
import type { DoctorReport, UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';

interface DoctorPanelProps {
  readonly locale?: UiLocale;
  readonly report: DoctorReport | null;
  readonly onRunDoctor: () => Promise<void>;
}

export function DoctorPanel({ locale = 'th', report, onRunDoctor }: DoctorPanelProps): ReactElement {
  const t = createTranslator(locale);
  return (
    <section className="panel">
      <button type="button" onClick={() => { void onRunDoctor(); }}>{t('doctor.run')}</button>
      {report === null ? <p>{t('doctor.noReport')}</p> : (
        <div className="doctor-list">
          {report.checks.map((check) => (
            <article key={check.id} data-testid={`doctor-check-${check.id}`} className={`doctor-check doctor-${check.status}`}>
              <div><strong>{check.id}</strong><span>{check.status}</span></div>
              <p>{check.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
