import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const internalProcessSources = [
  'packages/capabilities/src/shell-backend.ts',
  'packages/capabilities/src/durable-shell-task-store.ts',
  'packages/capabilities/src/windows-bridge.ts',
  'packages/capabilities/src/browser-cdp-protocol.ts',
  'packages/process/src/process-manager.ts',
] as const;

describe('Windows internal process visibility', () => {
  it('keeps internal child console windows hidden', async () => {
    for (const relativePath of internalProcessSources) {
      const source = await readFile(path.resolve(import.meta.dirname, '..', '..', '..', relativePath), 'utf8');
      expect(source, relativePath).not.toContain('windowsHide: false');
      expect(source, relativePath).toContain('windowsHide: true');
    }
  });
});
