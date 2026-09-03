import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, '..');
const source = path.resolve(desktopDirectory, '..', '..', 'native', 'macos', 'lnwjud-macos-helper.swift');
const output = path.join(desktopDirectory, 'build', 'lnwjud-macos-helper');

if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`macOS helper source is missing: ${source}`);
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync('/usr/bin/swiftc', [
  '-O', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'Security', '-framework', 'Vision', '-framework', 'PDFKit',
  source, '-o', output,
], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(`Could not compile macOS helper:\n${result.stderr || result.stdout || 'swiftc failed'}`);
chmodSync(output, 0o755);
