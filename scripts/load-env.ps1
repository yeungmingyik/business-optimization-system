. (Join-Path $PSScriptRoot 'enter-env.ps1')
$projectEnvPath = Join-Path $env:BOS_ROOT '.env'
if (-not (Test-Path -LiteralPath $projectEnvPath)) {
    throw 'LOCAL_ENV_REQUIRED'
}
foreach ($projectEnvLine in Get-Content -LiteralPath $projectEnvPath) {
    if ($projectEnvLine -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '54321'
$env:PGDATABASE = 'business_dev'
$env:PGUSER = 'business_dev'
$env:PGPASSWORD = $env:BOS_DB_PASSWORD
$env:BOS_UPLOAD_ROOT = Join-Path $env:BOS_ROOT '.data/uploads'
$env:BOS_LOG_ROOT = Join-Path $env:BOS_ROOT '.artifacts/logs'
$env:BOS_API_PORT = '3000'
$env:BOS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3000'
if (-not $env:BOS_OCR_URL) { $env:BOS_OCR_URL = 'http://127.0.0.1:8000' }
