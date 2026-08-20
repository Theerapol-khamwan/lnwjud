export interface DesktopShutdownCoordinatorOptions {
  readonly closeRuntime: () => Promise<void>;
  readonly onDeferred: (error: Error) => void;
}

export type DesktopShutdownResult = 'quit' | 'deferred';

/**
 * Serializes every app/update quit through the owned-runtime shutdown. A
 * failed shutdown is deliberately retryable: the application keeps running
 * with its ownership state intact instead of falling through to app.quit().
 */
export class DesktopShutdownCoordinator {
  private shutdown: Promise<DesktopShutdownResult> | null = null;
  private quitAllowed = false;
  private quitIssued = false;

  public constructor(private readonly options: DesktopShutdownCoordinatorOptions) {}

  public canQuit(): boolean {
    return this.quitAllowed;
  }

  public requestQuit(quit: () => void): Promise<DesktopShutdownResult> {
    if (this.quitAllowed) {
      this.issueQuit(quit);
      return Promise.resolve('quit');
    }
    if (this.shutdown !== null) return this.shutdown;
    this.shutdown = this.closeThenQuit(quit);
    return this.shutdown;
  }

  private async closeThenQuit(quit: () => void): Promise<DesktopShutdownResult> {
    try {
      await this.options.closeRuntime();
      this.quitAllowed = true;
      this.issueQuit(quit);
      return 'quit';
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error('Desktop shutdown could not be verified');
      this.options.onDeferred(normalized);
      return 'deferred';
    } finally {
      this.shutdown = null;
    }
  }

  private issueQuit(quit: () => void): void {
    if (this.quitIssued) return;
    this.quitIssued = true;
    quit();
  }
}
