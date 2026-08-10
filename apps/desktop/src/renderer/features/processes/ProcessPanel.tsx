import type { ReactElement } from 'react';
import type { ProcessSummary } from '@lnwjud/ipc-contracts';

interface ProcessPanelProps {
  readonly workspaceId: string | null;
  readonly processes: readonly ProcessSummary[];
  readonly selectedProcess: ProcessSummary | null;
  readonly onStartFixtureProcess: () => Promise<void>;
  readonly onStopProcess: (processId: string) => Promise<void>;
}

export function ProcessPanel({ workspaceId, processes, selectedProcess, onStartFixtureProcess, onStopProcess }: ProcessPanelProps): ReactElement {
  const canStart = workspaceId !== null && selectedProcess === null;
  return (
    <section className="card process-card">
      <div className="section-heading"><h2>Managed processes</h2><span>{processes.length}</span></div>
      <p>Processes run with a direct executable and argument list inside the selected workspace.</p>
      <button type="button" disabled={!canStart} onClick={() => { void onStartFixtureProcess(); }}>Start fixture process</button>
      {selectedProcess === null ? <p>No managed process.</p> : (
        <div className="process-details">
          <p><strong>Status</strong></p>
          <p data-testid="process-status">{selectedProcess.state}</p>
          <p><strong>Log summary</strong></p>
          <pre data-testid="process-log">{selectedProcess.logSummary}</pre>
          {selectedProcess.state === 'running' || selectedProcess.state === 'starting'
            ? <button type="button" onClick={() => { void onStopProcess(selectedProcess.id); }}>Stop process</button>
            : null}
        </div>
      )}
    </section>
  );
}
