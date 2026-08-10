export type ManagedProcessState = 'starting' | 'running' | 'exited' | 'failed' | 'stopped' | 'timed_out';

export interface ManagedProcessStart {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
}

export interface ManagedProcess {
  readonly processId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly state: ManagedProcessState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly exitCode?: number;
}

export type ProcessLogStream = 'stdout' | 'stderr';

export interface ProcessLogEntry {
  readonly sequence: number;
  readonly stream: ProcessLogStream;
  readonly text: string;
}

export interface LogQuery {
  readonly tailLines?: number;
  readonly sinceSequence?: number;
}

export interface ProcessLogResult {
  readonly entries: readonly ProcessLogEntry[];
  readonly truncated: boolean;
  readonly nextSequence: number;
}
