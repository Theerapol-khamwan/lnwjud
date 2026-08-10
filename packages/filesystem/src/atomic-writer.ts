import { randomUUID } from 'node:crypto';
import { unlink, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, ok, type Result } from '@lnwjud/domain';

export const MAX_FILE_WRITE_BYTES = 4 * 1024 * 1024;

export class AtomicFileWriter {
  public async write(filePath: string, content: string): Promise<Result<void>> {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_WRITE_BYTES) {
      return err(appError('FILE_TOO_LARGE', 'File exceeds the maximum write size'));
    }
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, filePath);
      return ok(undefined);
    } catch {
      return err(appError('INTERNAL_ERROR', 'Atomic file write failed', true));
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
