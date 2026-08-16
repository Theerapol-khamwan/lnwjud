@echo off
setlocal
set "SCRIPT=%~dp0lnwjud-mcp-stdio.cjs"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0resources\lnwjud-mcp-stdio.cjs"
if not exist "%SCRIPT%" (
  echo lnwjud-mcp-stdio: launcher script missing: %SCRIPT% 1>&2
  exit /b 1
)
set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE set "NODE_EXE=node"
rem Direct node exec so tunnel-client does not treat a nested `where` cmd as MCP exit.
"%NODE_EXE%" "%SCRIPT%" %*
