import { appError, err, ok, type Result } from '@lnwjud/domain';
import { DirectGitRunner, type GitRunResult, type GitRunner } from './git-runner.js';
import { parsePorcelainStatus, type GitStatusEntry } from './parsers/status-parser.js';

export interface GitStatusResult {
  readonly entries: readonly GitStatusEntry[];
}

export interface GitDiffRequest {
  readonly path?: string;
  readonly staged?: boolean;
  readonly maxBytes?: number;
}

export interface GitDiffResult {
  readonly patch: string;
  readonly truncated: boolean;
}

export interface GitLogRequest {
  readonly maxCommits?: number;
  readonly maxBytes?: number;
}

export interface GitLogEntry {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
}

export interface GitLogResult {
  readonly entries: readonly GitLogEntry[];
  readonly truncated: boolean;
}

export class GitAdapter {
  public constructor(private readonly runner: GitRunner = new DirectGitRunner()) {}

  public async status(cwd: string): Promise<Result<GitStatusResult>> {
    const result = await this.runner.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd);
    const error = this.mapError(result);
    if (error !== null) return error;
    return ok({ entries: parsePorcelainStatus(result.stdout) });
  }

  public async diff(cwd: string, request: GitDiffRequest = {}): Promise<Result<GitDiffResult>> {
    const maxBytes = request.maxBytes ?? 1024 * 1024;
    if (!this.isLimit(maxBytes, 4 * 1024 * 1024)) return err(appError('INVALID_INPUT', 'Git diff byte limit is invalid'));
    const args = ['diff', '--no-ext-diff', '--no-color'];
    if (request.staged === true) args.push('--cached');
    args.push('--');
    if (request.path !== undefined) args.push(request.path);
    const result = await this.runner.run(args, cwd);
    const error = this.mapError(result);
    if (error !== null) return error;
    const bounded = this.bound(result.stdout, maxBytes);
    return ok({ patch: bounded.text, truncated: bounded.truncated });
  }

  public async log(cwd: string, request: GitLogRequest = {}): Promise<Result<GitLogResult>> {
    const maxCommits = request.maxCommits ?? 20;
    const maxBytes = request.maxBytes ?? 1024 * 1024;
    if (!this.isLimit(maxCommits, 100) || !this.isLimit(maxBytes, 4 * 1024 * 1024)) {
      return err(appError('INVALID_INPUT', 'Git log limit is invalid'));
    }
    const args = ['log', '--no-color', '--format=%H%x1f%an%x1f%aI%x1f%s%x1e', '-n', String(maxCommits), '--'];
    const result = await this.runner.run(args, cwd);
    const error = this.mapError(result);
    if (error !== null) return error;
    const bounded = this.bound(result.stdout, maxBytes);
    const entries = bounded.text.split('\u001e').flatMap((record) => {
      const fields = record.split('\u001f');
      return fields.length === 4 && fields.every((field) => field.length > 0)
        ? [{ hash: fields[0] ?? '', author: fields[1] ?? '', date: fields[2] ?? '', subject: fields[3] ?? '' }]
        : [];
    });
    return ok({ entries, truncated: bounded.truncated });
  }

  private mapError(result: GitRunResult): Result<never> | null {
    if (result.exitCode === 0) return null;
    if (result.exitCode === 128 && /not a git repository/i.test(result.stderr)) {
      return err(appError('GIT_NOT_REPOSITORY', 'Workspace is not a Git repository'));
    }
    if (result.exitCode === -1 && /ENOENT/i.test(result.stderr)) {
      return err(appError('EXECUTABLE_NOT_FOUND', 'Git executable was not found'));
    }
    return err(appError('INTERNAL_ERROR', 'Git command failed', true));
  }

  private isLimit(value: number, maximum: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= maximum;
  }

  private bound(value: string, maxBytes: number): { text: string; truncated: boolean } {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
    return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true };
  }
}
