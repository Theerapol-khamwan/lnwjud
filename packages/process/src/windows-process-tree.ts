import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessTreeTerminator {
  stop(child: ChildProcess, pid: number): Promise<void>;
}

export class WindowsProcessTree implements ProcessTreeTerminator {
  public stop(child: ChildProcess, pid: number): Promise<void> {
    if (process.platform !== 'win32') {
      if (child.exitCode === null) child.kill('SIGTERM');
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
      killer.once('error', () => {
        if (child.exitCode === null) child.kill();
        resolve();
      });
      killer.once('close', () => resolve());
    });
  }
}
