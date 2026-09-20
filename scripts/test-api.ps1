. (Join-Path $PSScriptRoot 'load-env.ps1')
$null = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/v1/health' -TimeoutSec 3
& (Join-Path $PSScriptRoot 'pnpm.ps1') exec vitest run tests/api.test.ts tests/auth-security.test.ts tests/dashboard-scope.test.ts tests/transfer.test.ts
