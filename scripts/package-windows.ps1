$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $repositoryRoot 'apps\desktop'
$installerDirectory = Join-Path $desktopDirectory 'dist\installers'
$rootPackage = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$expectedArtifacts = @(
    "lnwjud-Setup-$($rootPackage.version).exe",
    "lnwjud-Portable-$($rootPackage.version).exe"
)

Push-Location $repositoryRoot
try {
    & corepack pnpm@10.15.0 --filter @lnwjud/desktop package:windows
    if ($LASTEXITCODE -ne 0) {
        throw "Windows packaging failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
        throw "Installer directory was not created: $installerDirectory"
    }

    $produced = foreach ($artifactName in $expectedArtifacts) {
        $artifactPath = Join-Path $installerDirectory $artifactName
        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            throw "Required Windows artifact was not produced: $artifactPath"
        }
        Get-Item -LiteralPath $artifactPath
    }

    $produced | Select-Object -ExpandProperty FullName
}
finally {
    Pop-Location
}
