import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(desktopRoot, 'build');
const cmdPath = path.join(buildDir, 'lnwjud-mcp-stdio.cmd');

const contents = `@echo off
setlocal
set "SCRIPT=%~dp0lnwjud-mcp-stdio.cjs"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0resources\\lnwjud-mcp-stdio.cjs"
if not exist "%SCRIPT%" (
  echo lnwjud-mcp-stdio: launcher script missing: %SCRIPT% 1>&2
  exit /b 1
)
set "NODE_EXE="
if exist "%ProgramFiles%\\nodejs\\node.exe" set "NODE_EXE=%ProgramFiles%\\nodejs\\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\\Programs\\nodejs\\node.exe" set "NODE_EXE=%LOCALAPPDATA%\\Programs\\nodejs\\node.exe"
if not defined NODE_EXE set "NODE_EXE=node"
rem Direct node exec so tunnel-client does not treat a nested cmd as MCP exit.
"%NODE_EXE%" "%SCRIPT%" %*
`;

mkdirSync(buildDir, { recursive: true });
writeFileSync(cmdPath, contents.replace(/\n/g, '\r\n'), 'utf8');
