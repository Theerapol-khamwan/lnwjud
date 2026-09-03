import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const version = '15.2.0';
const asset = `ripgrep-${version}-aarch64-apple-darwin.tar.gz`;
const source = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${asset}`;
const archiveSha256 = '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, '..');
const destination = path.join(desktopDirectory, 'build', 'runtime-tools', 'ripgrep');
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-ripgrep-'));

try {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`ripgrep download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.byteLength === 0 || archive.byteLength > 64 * 1024 * 1024) throw new Error('ripgrep archive size is invalid');
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== archiveSha256) throw new Error(`ripgrep SHA-256 mismatch: expected ${archiveSha256}, got ${actual}`);
  const archivePath = path.join(temporaryDirectory, asset);
  const extracted = path.join(temporaryDirectory, 'extracted');
  await writeFile(archivePath, archive);
  await mkdir(extracted, { recursive: true });
  const extract = spawnSync('/usr/bin/tar', ['-xzf', archivePath, '-C', extracted], { encoding: 'utf8' });
  if (extract.status !== 0) throw new Error(`ripgrep extraction failed: ${extract.stderr || extract.stdout}`);
  const root = path.join(extracted, `ripgrep-${version}-aarch64-apple-darwin`);
  const executable = path.join(root, 'rg');
  if (!(await stat(executable)).isFile()) throw new Error('ripgrep archive does not contain the expected rg executable');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyFile(executable, path.join(destination, 'rg'));
  await chmod(path.join(destination, 'rg'), 0o755);
  for (const name of ['COPYING', 'UNLICENSE', 'LICENSE-MIT']) {
    await copyFile(path.join(root, name), path.join(destination, name));
  }
  await writeFile(path.join(destination, 'BUNDLED_RIPGREP.txt'), [
    'ripgrep bundled by lnwjud', `version=${version}`, `asset=${asset}`, `source=${source}`, `asset_sha256=${archiveSha256}`,
  ].join('\n') + '\n', 'utf8');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
