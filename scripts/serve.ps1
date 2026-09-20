param([Parameter(Mandatory)][ValidateSet('api', 'web', 'preview')][string]$Service, [switch]$Test)

. (Join-Path $PSScriptRoot 'load-env.ps1')
if ($Test) {
    $env:PGPORT = '54322'
    $env:PGDATABASE = 'business_test'
    $env:PGUSER = 'business_test'
    $env:PGPASSWORD = $env:BOS_TEST_DB_PASSWORD
    $env:BOS_API_PORT = '3001'
    $env:BOS_ALLOWED_ORIGINS = 'http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:3001'
    $env:BOS_UPLOAD_ROOT = Join-Path $env:BOS_ROOT '.data/test-uploads'
    $env:BOS_API_TARGET = 'http://127.0.0.1:3001'
}
if ($Service -eq 'api') {
    Set-Location (Join-Path $env:BOS_ROOT 'apps/api')
    & $env:BOS_NODE 'dist/main.js'
} elseif ($Service -eq 'preview') {
    Set-Location (Join-Path $env:BOS_ROOT 'apps/web')
    & $env:BOS_NODE 'node_modules/vite/bin/vite.js' 'preview' '--host' '127.0.0.1' '--port' '5175' '--strictPort'
} else {
    Set-Location (Join-Path $env:BOS_ROOT 'apps/web')
    $webPort = if ($Test) { '5174' } else { '5173' }
    & $env:BOS_NODE 'node_modules/vite/bin/vite.js' '--host' '127.0.0.1' '--port' $webPort '--strictPort'
}
if ($LASTEXITCODE -ne 0) { throw "SERVICE_EXIT_CODE: $LASTEXITCODE" }
