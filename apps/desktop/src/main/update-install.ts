export interface UpdateReadyDialogOptions {
  readonly type: 'info';
  readonly title: string;
  readonly message: string;
  readonly buttons: ['Restart Now', 'Later'];
  readonly defaultId: 1;
  readonly cancelId: 1;
}

export interface UpdateInstallCoordinatorOptions {
  readonly activeCallCount: () => number;
  readonly activityRevision?: () => number;
  readonly install: () => void;
  readonly quietPeriodMs?: number;
  readonly pollIntervalMs?: number;
}

const DEFAULT_QUIET_PERIOD_MS = 1_500;
const DEFAULT_POLL_INTERVAL_MS = 250;

export function updateReadyDialogOptions(version: string): UpdateReadyDialogOptions {
  return {
    type: 'info',
    title: 'Update Ready - lnwjud',
    message: `Version v${version} has been downloaded. Restart lnwjud now to install?`,
    buttons: ['Restart Now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  };
}

export class UpdateInstallCoordinator {
  private readonly quietPeriodMs: number;
  private readonly pollIntervalMs: number;
  private pending = false;
  private shutdown = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private quietUntil = 0;
  private quietRevision = 0;

  public constructor(private readonly options: UpdateInstallCoordinatorOptions) {
    this.quietPeriodMs = options.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  public requestInstall(): void {
    if (this.shutdown || this.pending) return;
    this.pending = true;
    this.evaluate();
  }

  public cancel(): void {
    this.shutdown = true;
    this.pending = false;
    this.clearTimer();
  }

  public hasPendingInstall(): boolean {
    return this.pending;
  }

  private evaluate(): void {
    if (!this.pending || this.shutdown) return;
    if (this.options.activeCallCount() > 0) {
      this.quietUntil = 0;
      this.schedule(this.pollIntervalMs, () => this.evaluate());
      return;
    }
    this.quietUntil = Date.now() + this.quietPeriodMs;
    this.quietRevision = this.options.activityRevision?.() ?? 0;
    this.waitForQuietPeriod();
  }

  private waitForQuietPeriod(): void {
    if (!this.pending || this.shutdown) return;
    // Poll the existing tracker throughout the quiet period so a short call
    // that starts and ends inside the interval restarts the quiet clock.
    if (this.options.activeCallCount() > 0 || (this.options.activityRevision?.() ?? this.quietRevision) !== this.quietRevision) {
      this.evaluate();
      return;
    }
    const remaining = this.quietUntil - Date.now();
    if (remaining <= 0) {
      this.pending = false;
      this.options.install();
      return;
    }
    this.schedule(Math.min(this.pollIntervalMs, remaining), () => this.waitForQuietPeriod());
  }

  private schedule(delayMs: number, action: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      action();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
