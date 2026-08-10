import type { ReactElement } from 'react';
import type { DoctorReport } from '@lnwjud/ipc-contracts';

interface DoctorPanelProps {
  readonly report: DoctorReport | null;
  readonly onRunDoctor: () => Promise<void>;
}

export function DoctorPanel({ report, onRunDoctor }: DoctorPanelProps): ReactElement {
  return (
    <div className="page-content">
      <div className="page-heading"><div><p className="eyebrow">DIAGNOSTICS</p><h1>Doctor</h1></div></div>
      <section className="card">
        <p>Checks are deterministic and only show sanitized status summaries.</p>
        <button type="button" onClick={() => { void onRunDoctor(); }}>Run doctor</button>
        {report === null ? <p>No report yet.</p> : (
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
    </div>
  );
}
