param([switch]$Test, [switch]$SkipBuild)

& (Join-Path $PSScriptRoot 'initialize.ps1')
. (Join-Path $PSScriptRoot 'load-env.ps1')
$dockerSettingsPath = Join-Path $env:APPDATA 'Docker/settings-store.json'
if (-not (Test-Path -LiteralPath $dockerSettingsPath)) { throw 'DOCKER_STORAGE_CONFIGURATION_REQUIRED' }
$dockerSettings = Get-Content -LiteralPath $dockerSettingsPath -Raw | ConvertFrom-Json
if (-not $dockerSettings.CustomWslDistroDir) { throw 'D_DRIVE_DOCKER_STORAGE_REQUIRED' }
Assert-ProjectDrive $dockerSettings.CustomWslDistroDir
if ($Test) {
    $env:PGPORT = '54322'
    $env:PGDATABASE = 'business_test'
    $env:PGUSER = 'business_test'
    $env:PGPASSWORD = $env:BOS_TEST_DB_PASSWORD
    $env:BOS_ADMIN_LOGIN = 'test-owner'
    $env:BOS_ADMIN_PASSWORD = 'TestOwner2026!Local'
}
$instanceName = if ($Test) { 'test' } else { 'development' }
$apiPort = if ($Test) { 3001 } else { 3000 }
$webPort = if ($Test) { 5174 } else { 5173 }
$databaseService = if ($Test) { 'postgres-test' } else { 'postgres' }
Push-Location $env:BOS_ROOT
try {
    foreach ($port in @($apiPort, $webPort)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw "PORT_IN_USE: $port"
        }
    }
    & (Join-Path $PSScriptRoot 'setup-ocr.ps1')
    docker compose --profile test up -d --wait $databaseService
    if ($LASTEXITCODE -ne 0) { throw 'DATABASE_START_FAILED' }
    if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'pnpm.ps1') build }
    & $env:BOS_NODE (Join-Path $env:BOS_ROOT 'apps/api/dist/cli.js') migrate
    if ($LASTEXITCODE -ne 0) { throw 'DATABASE_MIGRATION_FAILED' }
    & $env:BOS_NODE (Join-Path $env:BOS_ROOT 'apps/api/dist/cli.js') init
    if ($LASTEXITCODE -ne 0) { throw 'DATABASE_INITIALIZATION_FAILED' }
    $processIds = @{}
    foreach ($service in @('api', 'web')) {
        $arguments = @('-NoProfile', '-File', ('"' + (Join-Path $PSScriptRoot 'serve.ps1') + '"'), '-Service', $service)
        if ($Test) { $arguments += '-Test' }
        $process = Start-Process -FilePath (Get-Command pwsh).Source -ArgumentList $arguments -WorkingDirectory $env:BOS_ROOT -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:BOS_ROOT ".artifacts/logs/$instanceName-$service.log") -RedirectStandardError (Join-Path $env:BOS_ROOT ".artifacts/logs/$instanceName-$service-error.log") -PassThru
        $processIds[$service] = $process.Id
    }
    $processIds | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:BOS_ROOT ".local/$instanceName-processes.json") -Encoding utf8
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/v1/health" -TimeoutSec 2
            $null = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort" -TimeoutSec 2
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "APPLICATION_START_FAILED: .artifacts/logs/$instanceName-*-error.log" }
    [PSCustomObject]@{ Url = "http://127.0.0.1:$webPort"; Api = "http://127.0.0.1:$apiPort/api/v1"; Database = $env:PGDATABASE }
} finally { Pop-Location }
