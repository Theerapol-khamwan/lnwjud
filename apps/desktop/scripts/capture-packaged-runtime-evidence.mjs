import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyCapabilityBridgeArtifacts } from './verify-capability-bridge-artifacts.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(desktopRoot, 'build', 'packaged-runtime-evidence.json');

const packagedRuntimeFiles = Object.freeze([
  { name: 'lnwjud.exe', relativePath: 'lnwjud.exe' },
  { name: 'lnwjud-mcp-stdio.cjs', relativePath: 'lnwjud-mcp-stdio.cjs' },
  { name: 'lnwjud-mcp-stdio.cmd', relativePath: 'lnwjud-mcp-stdio.cmd' },
  { name: 'lnwjud-node.exe', relativePath: 'lnwjud-node.exe' },
  { name: 'windows-capability-bridge.ps1', relativePath: 'resources/windows-capability-bridge.ps1' },
  { name: 'windows-capability-bridge.sha256', relativePath: 'resources/windows-capability-bridge.sha256' },
  { name: 'windows-capability-bridge.integrity.json', relativePath: 'resources/windows-capability-bridge.integrity.json' },
  { name: 'rg.exe', relativePath: 'resources/runtime-tools/ripgrep/rg.exe' },
  { name: 'tunnel-client.exe', relativePath: 'resources/tunnel-client/tunnel-client.exe' },
  { name: 'cloudflared.exe', relativePath: 'resources/tunnel-client/cloudflared.exe' },
  { name: 'cloudflared-manifest.json', relativePath: 'resources/tunnel-client/cloudflared-manifest.json' },
  { name: 'tunnel-client LICENSE', relativePath: 'resources/tunnel-client/LICENSE' },
  { name: 'tunnel-client NOTICE', relativePath: 'resources/tunnel-client/NOTICE' },
  { name: 'tunnel-client license inventory', relativePath: 'resources/tunnel-client/tunnel-client-v0.0.13-windows-amd64-licenses.txt' },
  { name: 'tunnel-client SPDX SBOM', relativePath: 'resources/tunnel-client/tunnel-client-v0.0.13-windows-amd64.spdx.json' },
  { name: 'BUNDLED_TUNNEL_CLIENT.txt', relativePath: 'resources/tunnel-client/BUNDLED_TUNNEL_CLIENT.txt' },
]);

export default async function capturePackagedRuntimeEvidence(context) {
  if (context?.electronPlatformName !== 'win32') return;
  const appOutDir = context.appOutDir;
  if (typeof appOutDir !== 'string' || appOutDir.length === 0) throw new Error('Windows packaged app directory is unavailable');

  const capabilityBridge = await verifyCapabilityBridgeArtifacts({
    packagedBridgePath: path.join(appOutDir, 'resources', 'windows-capability-bridge.ps1'),
    compiledBundlePath: path.join(desktopRoot, 'dist', 'main', 'main.js'),
  });

  const files = [];
  for (const entry of packagedRuntimeFiles) {
    const absolutePath = path.join(appOutDir, ...entry.relativePath.split('/'));
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) throw new Error(`Required packaged runtime file is not a file: ${entry.relativePath}`);
    files.push({
      name: entry.name,
      relativePath: entry.relativePath,
      sizeBytes: metadata.size,
      sha256: await sha256File(absolutePath),
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, platform: 'win32', arch: process.arch, capabilityBridge, files }, null, 2)}\n`, 'utf8');
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
