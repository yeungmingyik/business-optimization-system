. (Join-Path $PSScriptRoot 'enter-env.ps1')
$projectPnpmEntry = Join-Path $env:BOS_ROOT '.tools/pnpm/node_modules/pnpm/bin/pnpm.mjs'
Assert-ProjectDrive $projectPnpmEntry
if (-not (Test-Path -LiteralPath $projectPnpmEntry -PathType Leaf)) {
    throw 'PNPM_SETUP_REQUIRED'
}
Push-Location $env:BOS_ROOT
try {
    & $env:BOS_NODE $projectPnpmEntry --state-dir (Join-Path $env:BOS_ROOT '.cache/pnpm/state') --global-dir (Join-Path $env:BOS_ROOT '.tools/pnpm/global') @args
    if ($LASTEXITCODE -ne 0) {
        throw "PNPM_EXIT_CODE: $LASTEXITCODE"
    }
} finally {
    Pop-Location
}
