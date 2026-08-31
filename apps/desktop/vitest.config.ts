import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: desktopRoot,
  test: {
    environment: 'node',
    // Windows CI runs the SQLite-backed desktop fixtures beside other files.
    // Keep local feedback short, but allow the same bounded I/O contention
    // budget already used by the storage package on the hosted runner.
    testTimeout: process.env.CI ? 20_000 : 5_000,
    hookTimeout: process.env.CI ? 20_000 : 10_000,
    include: ['tests/**/*.test.ts'],
  },
});
