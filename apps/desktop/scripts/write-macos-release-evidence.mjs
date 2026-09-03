import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '..', '..');
const installerDirectory = path.join(desktopRoot, 'dist', 'installers');
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
if (typeof version !== 'string' || version.length === 0) throw new Error('Desktop package version is unavailable');

const commit = git(['rev-parse', 'HEAD']).trim();
const githubSha = process.env.GITHUB_SHA?.trim();
if (githubSha && githubSha.toLowerCase() !== commit.toLowerCase()) {
  throw new Error(`GITHUB_SHA does not match checked-out commit: github=${githubSha} git=${commit}`);
}

const artifactNames = [
  `lnwjud-${version}-mac-arm64.dmg`,
  `lnwjud-${version}-mac-arm64.dmg.blockmap`,
  `lnwjud-${version}-mac-arm64.zip`,
  `lnwjud-${version}-mac-arm64.zip.blockmap`,
];
const artifacts = [];
for (const name of artifactNames) {
  const filePath = path.join(installerDirectory, name);
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error(`Required macOS release artifact is missing: ${name}`);
  artifacts.push({ name, sizeBytes: metadata.size, sha256: await sha256File(filePath) });
}

const workingTreeDirtyAtEvidence = git(['status', '--porcelain=v1', '--untracked-files=normal']).trim().length > 0;
const provenance = {
  schemaVersion: 1,
  product: 'lnwjud',
  version,
  platform: 'darwin',
  architecture: 'arm64',
  minimumMacOS: '15.0',
  source: {
    repository: 'https://github.com/engasnm111/lnwjud',
    commit,
    dirty: workingTreeDirtyAtEvidence,
  },
  build: {
    environment: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    workflow: optionalEnv('GITHUB_WORKFLOW'),
    runId: optionalEnv('GITHUB_RUN_ID'),
    runAttempt: optionalEnv('GITHUB_RUN_ATTEMPT'),
    ref: optionalEnv('GITHUB_REF'),
    signing: 'unsigned',
  },
  artifacts,
};

const provenanceName = 'MACOS-PROVENANCE.json';
const provenancePath = path.join(installerDirectory, provenanceName);
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
const provenanceHash = await sha256File(provenancePath);
const sumLines = [
  ...artifacts.map((entry) => `${entry.sha256}  ${entry.name}`),
  `${provenanceHash}  ${provenanceName}`,
];
await writeFile(path.join(installerDirectory, 'MACOS-SHA256SUMS.txt'), `${sumLines.join('\n')}\n`, 'utf8');

process.stdout.write(`macOS release evidence written for lnwjud ${version} commit ${commit}${workingTreeDirtyAtEvidence ? ' (dirty)' : ''}\n`);

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}
