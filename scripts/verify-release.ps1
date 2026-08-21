[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Invoke-ReleaseStage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Write-Host "==> $Name"
    & corepack pnpm@10.15.0 @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Release stage '$Name' failed with exit code $LASTEXITCODE"
    }
}

function Assert-RepositoryChecks {
    Write-Host '==> git diff --check'
    & git diff --check
    if ($LASTEXITCODE -ne 0) {
        throw "git diff --check failed with exit code $LASTEXITCODE"
    }

    $trackedFiles = @(git ls-files)
    $forbiddenTrackedFiles = @($trackedFiles | Where-Object {
        $normalized = $_.Replace('\', '/')
        (($normalized -match '(^|/)(\.env|\.env\..+)$') -and ($normalized -notmatch '(^|/)\.env\.example$')) -or
        ($normalized -match '(^|/)(.+\.(pem|key)|id_rsa.*|id_ed25519.*|\.ssh/.*|\.aws/.*|credentials\.json)$')
    })
    if ($forbiddenTrackedFiles.Count -gt 0) {
        throw "Forbidden secret-like tracked paths found: $($forbiddenTrackedFiles -join ', ')"
    }
}

Push-Location $repositoryRoot
try {
    Invoke-ReleaseStage 'install --frozen-lockfile' @('install', '--frozen-lockfile')
    Invoke-ReleaseStage 'lint' @('lint')
    Invoke-ReleaseStage 'typecheck' @('typecheck')
    Invoke-ReleaseStage 'test' @('test')
    Invoke-ReleaseStage 'test:acceptance' @('test:acceptance')
    Invoke-ReleaseStage 'test:integration' @('test:integration')
    Invoke-ReleaseStage 'test:e2e' @('test:e2e')
    Invoke-ReleaseStage 'build' @('build')
    Invoke-ReleaseStage 'docs:tools:check' @('docs:tools:check')
    Invoke-ReleaseStage 'test:packaging' @('test:packaging')
    Invoke-ReleaseStage 'test:release-gate' @('test:release-gate')
    Invoke-ReleaseStage 'package:windows' @('package:windows')

    $installerDirectory = Join-Path $repositoryRoot 'apps\desktop\dist\installers'
    if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
        throw "Packaged-app smoke could not find installer directory: $installerDirectory"
    }
    $rootPackage = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
    $expectedInstallerName = "lnwjud-Setup-$($rootPackage.version).exe"
    $expectedInstaller = Join-Path $installerDirectory $expectedInstallerName
    if (-not (Test-Path -LiteralPath $expectedInstaller -PathType Leaf)) {
        throw "Packaged-app smoke could not find the versioned installer '$expectedInstallerName' in: $installerDirectory"
    }
    Write-Host "Packaged-app smoke artifact: $expectedInstaller"
    Assert-RepositoryChecks
    Write-Host 'Release verification gate completed.'
}
finally {
    Pop-Location
}
