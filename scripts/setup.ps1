& (Join-Path $PSScriptRoot 'install-node.ps1')
. (Join-Path $PSScriptRoot 'enter-env.ps1')

$projectPackage = Get-Content -LiteralPath (Join-Path $env:BOS_ROOT 'package.json') -Raw | ConvertFrom-Json
$projectPnpmVersion = $projectPackage.packageManager.Split('@')[1]
$projectPnpmRoot = Join-Path $env:BOS_ROOT '.tools/pnpm'
$projectPnpmPackagePath = Join-Path $projectPnpmRoot 'node_modules/pnpm/package.json'
$projectPnpmNeedsInstall = $true
if (Test-Path -LiteralPath $projectPnpmPackagePath) {
    $projectInstalledPnpm = Get-Content -LiteralPath $projectPnpmPackagePath -Raw | ConvertFrom-Json
    $projectPnpmNeedsInstall = $projectInstalledPnpm.version -ne $projectPnpmVersion
}
if ($projectPnpmNeedsInstall) {
    $projectNpmCli = Join-Path (Split-Path $env:BOS_NODE -Parent) 'node_modules/npm/bin/npm-cli.js'
    Assert-ProjectDrive $projectPnpmRoot
    Assert-ProjectDrive $projectNpmCli
    & $env:BOS_NODE $projectNpmCli install --prefix $projectPnpmRoot "pnpm@$projectPnpmVersion" --ignore-scripts --no-audit --no-fund --package-lock=false
    if ($LASTEXITCODE -ne 0) {
        throw 'PNPM_INSTALL_FAILED'
    }
}
& (Join-Path $PSScriptRoot 'pnpm.ps1') --version
& (Join-Path $PSScriptRoot 'initialize.ps1')
& (Join-Path $PSScriptRoot 'pnpm.ps1') install --frozen-lockfile
