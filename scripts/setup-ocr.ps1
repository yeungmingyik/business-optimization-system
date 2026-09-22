& (Join-Path $PSScriptRoot 'initialize.ps1')
. (Join-Path $PSScriptRoot 'enter-env.ps1')

$ocrDockerSettingsPath = Join-Path $env:APPDATA 'Docker/settings-store.json'
if (-not (Test-Path -LiteralPath $ocrDockerSettingsPath)) { throw 'DOCKER_STORAGE_CONFIGURATION_REQUIRED' }
$ocrDockerSettings = Get-Content -LiteralPath $ocrDockerSettingsPath -Raw | ConvertFrom-Json
if (-not $ocrDockerSettings.CustomWslDistroDir) { throw 'D_DRIVE_DOCKER_STORAGE_REQUIRED' }
Assert-ProjectDrive $ocrDockerSettings.CustomWslDistroDir
Push-Location $env:BOS_ROOT
try {
    docker compose build ocr
    if ($LASTEXITCODE -ne 0) { throw 'OCR_BUILD_FAILED' }
    docker compose up -d --wait --wait-timeout 240 ocr
    if ($LASTEXITCODE -ne 0) { throw 'OCR_START_FAILED' }
} finally { Pop-Location }
