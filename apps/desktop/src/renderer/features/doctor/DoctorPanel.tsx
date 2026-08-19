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
    <section className="panel doctor-panel">
      <div className="section-heading">
        <p className="page-subtitle" style={{ margin: 0 }}>
          {locale === 'th' ? 'ตรวจสอบความพร้อมของระบบและการเชื่อมต่อทั้งหมด' : 'Verify system health and all required dependencies'}
        </p>
        <button type="button" onClick={() => { void onRunDoctor(); }}>{t('doctor.run')}</button>
      </div>
      {report === null ? (
        <div className="doctor-empty-state">
          <p>{t('doctor.noReport')}</p>
        </div>
      ) : (
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
