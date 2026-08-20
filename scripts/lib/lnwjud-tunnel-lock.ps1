Set-StrictMode -Version Latest

function Test-LnwjudTunnelLockRecord {
  param([Parameter(Mandatory=$true)]$Record)
  return $null -ne $Record -and $Record.version -is [long] -and $Record.version -eq 1 -and $Record.pid -is [long] -and $Record.pid -gt 0 -and $Record.pid -le 2147483647 -and ([string]$Record.processStartedAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') -and ([string]$Record.acquiredAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
}

function Read-LnwjudTunnelLockRecord {
  param([Parameter(Mandatory=$true)][string]$LockPath)
  try { $r = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json -ErrorAction Stop; if (Test-LnwjudTunnelLockRecord $r) { return $r } } catch { }
  return $null
}

function Enter-LnwjudTunnelLock {
  param([Parameter(Mandatory=$true)][string]$ProfileDir,[Parameter(Mandatory=$true)][int]$OwnerPid,[Parameter(Mandatory=$true)][string]$OwnerStartedAt,[scriptblock]$ProcessStartProvider)
  New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
  $lockPath = Join-Path $ProfileDir 'lnwjud.tunnel.lock'
  $owner = [pscustomobject][ordered]@{ version = 1; pid = $OwnerPid; processStartedAt = $OwnerStartedAt; acquiredAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture) }
  for($i=0;$i -lt 4;$i++) {
    $temp = "$lockPath.publish.$OwnerPid.$([Guid]::NewGuid().ToString('N'))"
    try { [IO.File]::WriteAllText($temp,($owner|ConvertTo-Json -Compress),[Text.Encoding]::UTF8); [IO.File]::Move($temp,$lockPath); return [pscustomobject]@{ acquired=$true; owner=$owner } }
    catch [IO.IOException] { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue; $existing=Read-LnwjudTunnelLockRecord $lockPath; if($null -eq $existing){ throw "Tunnel lock has invalid owner metadata: $lockPath" }; $actual=& $ProcessStartProvider ([int]$existing.pid); if($actual -eq [string]$existing.processStartedAt){return [pscustomobject]@{ acquired=$false; owner=$existing }}; $stale="$lockPath.stale.$([Guid]::NewGuid().ToString('N'))"; try{[IO.File]::Move($lockPath,$stale);$moved=Read-LnwjudTunnelLockRecord $stale;if($null -eq $moved){throw 'invalid stale lock'};Remove-Item -LiteralPath $stale -Force}catch{throw} }
  }
  throw 'Unable to acquire tunnel lock'
}

function Release-LnwjudTunnelLock {
  param([Parameter(Mandatory=$true)][string]$ProfileDir,[Parameter(Mandatory=$true)]$Owner)
  $path=Join-Path $ProfileDir 'lnwjud.tunnel.lock'; $current=Read-LnwjudTunnelLockRecord $path
  if($null -eq $current -or $current.pid -ne $Owner.pid -or $current.processStartedAt -ne $Owner.processStartedAt -or $current.acquiredAt -ne $Owner.acquiredAt){return $false}
  Remove-Item -LiteralPath $path -Force -ErrorAction Stop; return $true
}
