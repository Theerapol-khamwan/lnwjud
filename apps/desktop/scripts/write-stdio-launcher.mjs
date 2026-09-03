import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chmodSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(desktopRoot, 'build');
const isWindows = process.platform === 'win32';
const launcherPath = path.join(buildDir, isWindows ? 'lnwjud-mcp-stdio.cmd' : 'lnwjud-mcp-stdio');
const bundledNodePath = path.join(buildDir, isWindows ? 'lnwjud-node.exe' : 'lnwjud-node');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);

if (nodeMajor !== 24) throw new Error(`lnwjud packaged stdio requires the build runtime to be Node.js 24.x; got ${process.versions.node}`);

const contents = isWindows ? `@echo off
setlocal
set "BASE=%~dp0"
set "SCRIPT=%BASE%lnwjud-mcp-stdio.cjs"
set "NODE_EXE=%BASE%lnwjud-node.exe"
set "RIPGREP_DIR=%BASE%runtime-tools\\ripgrep"
if not exist "%RIPGREP_DIR%\\rg.exe" set "RIPGREP_DIR=%BASE%resources\\runtime-tools\\ripgrep"
if exist "%RIPGREP_DIR%\\rg.exe" set "PATH=%RIPGREP_DIR%;%PATH%"
if not exist "%SCRIPT%" (
  echo lnwjud-mcp-stdio: launcher script missing: %SCRIPT% 1>&2
  exit /b 1
)
if not exist "%NODE_EXE%" (
  echo lnwjud-mcp-stdio: bundled Node runtime missing: %NODE_EXE% 1>&2
  exit /b 1
)
rem Use the private Node 24 runtime shipped with lnwjud; no system Node.js is required.
"%NODE_EXE%" "%SCRIPT%" %*
` : `#!/bin/sh
set -eu
BASE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SCRIPT="$BASE/lnwjud-mcp-stdio.cjs"
NODE_BIN="$BASE/lnwjud-node"
if [ ! -f "$SCRIPT" ]; then
  echo "lnwjud-mcp-stdio: launcher script missing: $SCRIPT" >&2
  exit 1
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "lnwjud-mcp-stdio: bundled Node runtime missing: $NODE_BIN" >&2
  exit 1
fi
exec "$NODE_BIN" "$SCRIPT" "$@"
`;

mkdirSync(buildDir, { recursive: true });
copyFileSync(process.execPath, bundledNodePath);
if (!isWindows) chmodSync(bundledNodePath, 0o755);
writeFileSync(launcherPath, isWindows ? contents.replace(/\n/g, '\r\n') : contents, 'utf8');
if (!isWindows) chmodSync(launcherPath, 0o755);
process.stdout.write(`Bundled private Node runtime ${process.versions.node} -> ${bundledNodePath}\n`);
