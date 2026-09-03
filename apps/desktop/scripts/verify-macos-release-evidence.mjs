import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installerDirectory = path.join(desktopRoot, 'dist', 'installers');
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const provenanceName = 'MACOS-PROVENANCE.json';
const provenance = JSON.parse(await readFile(path.join(installerDirectory, provenanceName), 'utf8'));
const sums = parseSums(await readFile(path.join(installerDirectory, 'MACOS-SHA256SUMS.txt'), 'utf8'));

if (provenance?.schemaVersion !== 1 || provenance.product !== 'lnwjud') throw new Error('MACOS-PROVENANCE.json schema/product is invalid');
if (provenance.version !== version) throw new Error(`macOS provenance version mismatch: ${String(provenance.version)} != ${String(version)}`);
if (provenance.platform !== 'darwin' || provenance.architecture !== 'arm64' || provenance.minimumMacOS !== '15.0') throw new Error('macOS provenance platform contract is invalid');
if (typeof provenance.source?.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(provenance.source.commit)) throw new Error('macOS provenance commit SHA is invalid');

const expectedCommit = process.env.LNWJUD_EXPECTED_COMMIT_SHA?.trim();
if (expectedCommit && provenance.source.commit.toLowerCase() !== expectedCommit.toLowerCase()) {
  throw new Error(`macOS provenance commit mismatch: ${provenance.source.commit} != ${expectedCommit}`);
}
if (process.env.LNWJUD_REQUIRE_CLEAN_PROVENANCE === '1' && provenance.source.dirty !== false) {
  throw new Error('Public macOS release provenance must be built from a clean tracked source tree');
}

const requiredNames = new Set([
  `lnwjud-${version}-mac-arm64.dmg`,
  `lnwjud-${version}-mac-arm64.dmg.blockmap`,
  `lnwjud-${version}-mac-arm64.zip`,
  `lnwjud-${version}-mac-arm64.zip.blockmap`,
]);
if (!Array.isArray(provenance.artifacts) || provenance.artifacts.length !== requiredNames.size) throw new Error('macOS provenance artifact list is incomplete');
for (const artifact of provenance.artifacts) {
  validateEntry(artifact);
  if (!requiredNames.delete(artifact.name)) throw new Error(`Unexpected or duplicate macOS release artifact: ${artifact.name}`);
  const filePath = path.join(installerDirectory, artifact.name);
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size !== artifact.sizeBytes) throw new Error(`macOS release artifact size mismatch: ${artifact.name}`);
  const actual = await sha256File(filePath);
  if (actual !== artifact.sha256 || sums.get(artifact.name) !== artifact.sha256) throw new Error(`macOS release artifact SHA-256 mismatch: ${artifact.name}`);
}
if (requiredNames.size > 0) throw new Error(`macOS provenance is missing required artifacts: ${[...requiredNames].join(', ')}`);

const provenanceHash = await sha256File(path.join(installerDirectory, provenanceName));
if (sums.get(provenanceName) !== provenanceHash) throw new Error('MACOS-PROVENANCE.json SHA-256 mismatch');
process.stdout.write(`macOS release evidence verified for lnwjud ${version} commit ${provenance.source.commit}\n`);

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid macOS artifact entry');
  if (typeof entry.name !== 'string' || entry.name.length === 0) throw new Error('Invalid macOS artifact name');
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256)) throw new Error(`Invalid macOS artifact SHA-256 for ${entry.name}`);
  if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0) throw new Error(`Invalid macOS artifact size for ${entry.name}`);
}

function parseSums(text) {
  const result = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/i.exec(line);
    if (!match) throw new Error(`Invalid MACOS-SHA256SUMS line: ${line}`);
    result.set(match[2], match[1].toLowerCase());
  }
  return result;
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
