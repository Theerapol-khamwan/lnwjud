import type { GoalManagedTaskStateReader, ManagedGoalTaskState } from '@lnwjud/application';
import type { Result } from '@lnwjud/domain';

interface GoalTaskStatusProvider {
  statusForGoalLiveness(workspaceId: string, taskId: string): Result<unknown> | Promise<Result<unknown>>;
}

export interface RuntimeGoalManagedTaskStateReaderOptions {
  readonly process?: GoalTaskStatusProvider;
  readonly codex?: GoalTaskStatusProvider;
  readonly shell?: GoalTaskStatusProvider;
}

/** Combines every host-owned task registry without treating an unavailable source as absence. */
export class RuntimeGoalManagedTaskStateReader implements GoalManagedTaskStateReader {
  private readonly providers: readonly GoalTaskStatusProvider[];

  public constructor(options: RuntimeGoalManagedTaskStateReaderOptions) {
    this.providers = [options.process, options.codex, options.shell]
      .filter((provider): provider is GoalTaskStatusProvider => provider !== undefined);
  }

  public async read(workspaceId: string, taskId: string): Promise<ManagedGoalTaskState> {
    if (this.providers.length === 0) return 'unknown';
    const states = await Promise.all(this.providers.map(async (provider) => {
      try {
        return mapTaskStatus(await provider.statusForGoalLiveness(workspaceId, taskId));
      } catch {
        return 'unknown' as const;
      }
    }));
    if (states.includes('running')) return 'running';
    if (states.includes('unknown')) return 'unknown';
    if (states.includes('terminal')) return 'terminal';
    return 'absent';
  }
}

function mapTaskStatus(result: Result<unknown>): ManagedGoalTaskState {
  if (!result.ok) return result.error.code === 'PROCESS_NOT_FOUND' ? 'absent' : 'unknown';
  if (!isRecord(result.value) || typeof result.value.state !== 'string') return 'unknown';
  switch (result.value.state) {
    case 'starting':
    case 'running':
      return 'running';
    case 'exited':
    case 'failed':
    case 'stopped':
    case 'timed_out':
    case 'completed':
    case 'cancelled':
      return 'terminal';
    case 'termination_unverified':
    default:
      return 'unknown';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
