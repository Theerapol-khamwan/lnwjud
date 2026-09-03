import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessTreeTerminator {
  stop(child: ChildProcess, pid: number): Promise<void>;
}

export interface WindowsProcessTreeOptions {
  readonly platform?: NodeJS.Platform;
  readonly taskkill?: (pid: number) => Promise<number | null>;
  readonly waitForExit?: (child: ChildProcess) => Promise<void>;
}

export class WindowsProcessTree implements ProcessTreeTerminator {
  private readonly platform: NodeJS.Platform;
  private readonly taskkill: (pid: number) => Promise<number | null>;
  private readonly waitForExit: (child: ChildProcess) => Promise<void>;
  private readonly acceptedTreeStops = new WeakSet<ChildProcess>();

  public constructor(options: WindowsProcessTreeOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.taskkill = options.taskkill ?? runTaskkill;
    this.waitForExit = options.waitForExit ?? waitForChildExit;
  }

  public async stop(child: ChildProcess, pid: number): Promise<void> {
    if (this.platform !== 'win32') {
      await stopPosixDescendants(pid);
      if (child.exitCode === null) child.kill('SIGTERM');
      await this.waitForExit(child);
      return;
    }
    if (this.acceptedTreeStops.has(child)) {
      await this.waitForExit(child);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Process root exited before tree termination could be verified');
    }
    let taskkillExitCode: number | null;
    try {
      taskkillExitCode = await this.taskkill(pid);
    } catch (error: unknown) {
      throw new Error('Process tree termination could not be started', { cause: error });
    }
    if (taskkillExitCode !== 0) throw new Error(`Process tree termination exited with code ${taskkillExitCode ?? 'unknown'}`);
    this.acceptedTreeStops.add(child);
    await this.waitForExit(child);
  }
}

/**
 * Node children are not consistently process-group leaders on macOS. Stopping
 * only their root leaks subprocesses (for example browser launchers and
 * package-manager workers), so enumerate descendants before terminating the
 * root. The lookup is best-effort: process exits and permission failures are
 * expected races and never turn a successful root stop into a false failure.
 */
async function stopPosixDescendants(rootPid: number): Promise<void> {
  const descendants = await collectPosixDescendants(rootPid);
  for (const pid of descendants.reverse()) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* exited or not owned */ }
  }
}

async function collectPosixDescendants(parentPid: number): Promise<number[]> {
  const children = await listPosixChildren(parentPid);
  const descendants: number[] = [];
  for (const childPid of children) {
    descendants.push(...await collectPosixDescendants(childPid));
    descendants.push(childPid);
  }
  return descendants;
}

function listPosixChildren(parentPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const finder = spawn('/usr/bin/pgrep', ['-P', String(parentPid)], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    finder.stdout?.setEncoding('utf8');
    finder.stdout?.on('data', (chunk: string) => { output += chunk; });
    finder.once('error', () => resolve([]));
    finder.once('close', () => resolve(output.split(/\s+/).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)));
  });
}

function runTaskkill(pid: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
    killer.once('error', reject);
    killer.once('close', resolve);
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs = 2_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const complete = (): void => {
      clearTimeout(timer);
      child.removeListener('exit', complete);
      child.removeListener('close', complete);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', complete);
      child.removeListener('close', complete);
      reject(new Error('Process tree exit could not be verified'));
    }, timeoutMs);
    child.once('exit', complete);
    child.once('close', complete);
  });
}
