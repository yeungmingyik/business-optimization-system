. (Join-Path $PSScriptRoot 'enter-env.ps1')
$projectEnvPath = Join-Path $env:BOS_ROOT '.env'
if (Test-Path -LiteralPath $projectEnvPath) { return }
function New-LocalSecret {
    [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
$databasePassword = New-LocalSecret
$testDatabasePassword = New-LocalSecret
$administratorPassword = 'Yj' + (New-LocalSecret) + '8!'
$settings = Get-Content -LiteralPath (Join-Path $env:BOS_ROOT '.env.example') -Raw
$settings = $settings.Replace('BOS_DB_PASSWORD=', "BOS_DB_PASSWORD=$databasePassword").Replace('BOS_TEST_DB_PASSWORD=', "BOS_TEST_DB_PASSWORD=$testDatabasePassword").Replace('BOS_ADMIN_PASSWORD=', "BOS_ADMIN_PASSWORD=$administratorPassword")
$settings = $settings.Replace('D:/business-optimization-system', $env:BOS_ROOT.Replace('\', '/'))
[System.IO.File]::WriteAllText($projectEnvPath, $settings)
[ordered]@{ url = 'http://127.0.0.1:5173'; loginName = 'owner'; password = $administratorPassword } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:BOS_ROOT '.local/access.json') -Encoding utf8
