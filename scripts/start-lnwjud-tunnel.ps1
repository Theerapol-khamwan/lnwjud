<#Requires -Version 5.1
.SYNOPSIS
Starts the lnwjud Secure MCP Tunnel with long TTL, file logging, full-access
(unrestricted) mode, and automatic restart when the tunnel drops.

.DESCRIPTION
- Reads the encrypted Runtime API key from %APPDATA%\tunnel-client\lnwjud.runtime.secret (DPAPI)
- Runs `tunnel-client doctor` then `tunnel-client run`
- Passes --mcp.connection-max-ttl 168h0m0s so ChatGPT connections do not drop every 10 minutes
- Writes tunnel logs to %APPDATA%\tunnel-client\lnwjud-tunnel.log (tailed by the lnwjud dashboard)
- Aligns LNWJUD_DATA_PATH with the desktop app so MCP activity shows in the Work Log / Live Logs
- Sets LNWJUD_UNRESTRICTED=1 (full-access mode: all drives, cmd/powershell/npm.cmd allowed)
- Restarts the tunnel automatically when tunnel-client exits for any reason including TTL (exit 0)
- Opens the lnwjud log viewer window after start (use -NoViewer to skip)

.PARAMETER TunnelClientPath
Path to tunnel-client.exe. Defaults to %USERPROFILE%\Downloads\tunnel\tunnel-client.exe

.PARAMETER LnwjudPath
Path to lnwjud.exe (desktop app / viewer). Defaults to the per-user install location
%LOCALAPPDATA%\Programs\lnwjud\lnwjud.exe

.PARAMETER NoViewer
Do not open the lnwjud log viewer window.

.PARAMETER OpenDashboard
Open the full desktop dashboard instead of the small log viewer window.

.PARAMETER ForceRestart
Stop any already-running lnwjud tunnel process before starting a new one.

.PARAMETER Once
Run tunnel-client once and exit with its code. Default is to keep restarting.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-lnwjud-tunnel.ps1"
#>

# Auto-load .env if available
$repoRoot = Split-Path -Parent $PSScriptRoot
$candidateEnvFiles = @(
  (Join-Path $repoRoot '.env'),
  (Join-Path (Get-Location) '.env')
)
foreach ($envFile in $candidateEnvFiles) {
  if (Test-Path -LiteralPath $envFile) {
    Get-Content $envFile | ForEach-Object {
      $line = $_.Trim()
      if ($line -and -not $line.StartsWith('#') -and $line -match '^([^=]+)=(.*)$') {
        $envKey = $matches[1].Trim()
        $envVal = $matches[2].Trim().Trim('"').Trim("'")
        if (-not [System.Environment]::GetEnvironmentVariable($envKey)) {
          [System.Environment]::SetEnvironmentVariable($envKey, $envVal, [System.EnvironmentVariableTarget]::Process)
        }
      }
    }
    break
  }
}

param(
  [string]$TunnelClientPath = $(if ($env:LNWJUD_TUNNEL_CLIENT_PATH) { $env:LNWJUD_TUNNEL_CLIENT_PATH } else { (Join-Path $env:USERPROFILE 'Downloads\tunnel\tunnel-client.exe') }),
  [string]$LnwjudPath = $(if ($env:LNWJUD_PATH) { $env:LNWJUD_PATH } else { (Join-Path $env:LOCALAPPDATA 'Programs\lnwjud\lnwjud.exe') }),
  [switch]$NoViewer,
  [switch]$OpenDashboard,
  [switch]$ForceRestart,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$profileName = 'lnwjud'
$profileDir = Join-Path $env:APPDATA 'tunnel-client'
$secretPath = Join-Path $profileDir 'lnwjud.runtime.secret'
$logPath = Join-Path $profileDir 'lnwjud-tunnel.log'
$stopFile = Join-Path $profileDir 'lnwjud.tunnel.stop'
$mcpTtl = '168h0m0s'
$maxRapidRestarts = 5
$rapidRestartCount = 0
$rapidRestartWindowStarted = Get-Date

if (-not (Test-Path $TunnelClientPath)) { throw "Missing tunnel-client: $TunnelClientPath" }
if (-not (Test-Path $secretPath)) { throw "Missing encrypted runtime key: $secretPath. Save the key once with: Read-Host 'Tunnel runtime API key' -AsSecureString | ConvertFrom-SecureString | Set-Content '$secretPath'" }

function Test-LnwjudTunnelRunning {
  $probe = Get-CimInstance Win32_Process -Filter "Name = 'tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '(?i)(--profile\s+lnwjud|lnwjud\.yaml)' }
  return [bool]$probe
}

function Test-LnwjudTunnelStopRequested {
  if ($env:LNWJUD_TUNNEL_STOP -eq '1' -or $env:LNWJUD_TUNNEL_STOP -eq 'true') { return $true }
  return Test-Path -LiteralPath $stopFile
}

function Get-LnwjudTunnelExitHint {
  if (-not (Test-Path -LiteralPath $logPath)) { return '' }
  $tail = @(Get-Content -LiteralPath $logPath -Tail 120 -ErrorAction SilentlyContinue)
  $pattern = 'TTL reached|stdio MCP command exited|requesting tunnel-client shutdown'
  $hit = $tail | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if ([string]::IsNullOrWhiteSpace($hit)) { return '' }
  $compact = ([regex]::Replace([string]$hit, '\s+', ' ')).Trim()
  if ($compact.Length -gt 180) { $compact = $compact.Substring(0, 177) + "..." }
  return (' -- ' + $compact)
}

if (Test-LnwjudTunnelRunning) {
  if ($ForceRestart) {
    Get-CimInstance Win32_Process -Filter "Name = 'tunnel-client.exe'" |
      Where-Object { $_.CommandLine -match '(?i)(--profile\s+lnwjud|lnwjud\.yaml)' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  } else {
    Write-Host 'lnwjud tunnel is already running. Use -ForceRestart to restart it.'
    exit 0
  }
}

# A leftover stop file from a previous session must not block the next start.
if (Test-Path -LiteralPath $stopFile) {
  Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
}

# Decrypt the DPAPI secret into this session only.
$encrypted = Get-Content $secretPath -Raw
$secureKey = ConvertTo-SecureString -String $encrypted
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

# Full-access mode: all fixed drives, cmd/powershell/npm.cmd allowed (delete commands stay blocked).
$env:LNWJUD_UNRESTRICTED = '1'
# Align with the desktop app data path so tool activity appears in the Work Log / Live Logs.
if (-not $env:LNWJUD_DATA_PATH) { $env:LNWJUD_DATA_PATH = Join-Path $env:APPDATA 'lnwjud' }
# Long connection ceiling so ChatGPT does not drop every 10 minutes (tunnel-client default).
$env:MCP_CONNECTION_MAX_TTL = $mcpTtl

try {
  $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)

  Write-Host "lnwjud tunnel: running doctor ..."
  & $TunnelClientPath doctor --profile $profileName --profile-dir $profileDir --explain
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed with exit code $LASTEXITCODE" }

  Write-Host "lnwjud tunnel: starting (TTL $mcpTtl, log: $logPath)"
  Write-Host "lnwjud tunnel: unrestricted mode = ON, data path = $env:LNWJUD_DATA_PATH"
  Write-Host 'lnwjud tunnel: auto-restart is ON (TTL/exit 0 still restarts). Ctrl+C or LNWJUD_TUNNEL_STOP=1 to stop.'

  if (-not $NoViewer -and (Test-Path $LnwjudPath)) {
    if ($OpenDashboard) {
      Start-Process -FilePath $LnwjudPath
    } else {
      Start-Process -FilePath $LnwjudPath -ArgumentList @('--log-viewer')
    }
  }

  while ($true) {
    if (Test-LnwjudTunnelStopRequested) {
      Write-Host 'lnwjud tunnel: stop requested.'
      exit 0
    }

    & $TunnelClientPath run --profile $profileName --profile-dir $profileDir --log.file $logPath --mcp.connection-max-ttl $mcpTtl
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = -1 }
    $hint = Get-LnwjudTunnelExitHint

    if ($Once) {
      Write-Host ("lnwjud tunnel: tunnel-client exited ({0}){1}" -f $exitCode, $hint)
      exit $exitCode
    }
    if (Test-LnwjudTunnelStopRequested) {
      Write-Host ("lnwjud tunnel: stop requested after exit ({0}){1}" -f $exitCode, $hint)
      exit 0
    }

    $elapsed = ((Get-Date) - $rapidRestartWindowStarted).TotalSeconds
    if ($elapsed -gt 30) {
      $rapidRestartCount = 0
      $rapidRestartWindowStarted = Get-Date
    }
    $rapidRestartCount += 1
    if ($rapidRestartCount -gt $maxRapidRestarts) {
      throw ("tunnel-client exited {0} times in a short window; automatic restart paused. Fix the MCP profile/stdio child and start again.{1}" -f $maxRapidRestarts, $hint)
    }
    $delaySeconds = [int][Math]::Min(30, 3 * [Math]::Pow(2, $rapidRestartCount - 1))
    Write-Host ("lnwjud tunnel: tunnel-client exited ({0}){1} - restarting in {2} seconds (attempt {3}/{4}) ..." -f $exitCode, $hint, $delaySeconds, $rapidRestartCount, $maxRapidRestarts)
    Start-Sleep -Seconds $delaySeconds
  }
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
