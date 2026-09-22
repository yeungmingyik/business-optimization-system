. (Join-Path $PSScriptRoot 'enter-env.ps1')
$projectEnvPath = Join-Path $env:BOS_ROOT '.env'
function New-LocalSecret {
    [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
if (Test-Path -LiteralPath $projectEnvPath) {
    $existingSettings = Get-Content -LiteralPath $projectEnvPath -Raw
    if ($existingSettings -notmatch '(?m)^BOS_OCR_TOKEN=[^\r\n]+') {
        $ocrTokenLine = 'BOS_OCR_TOKEN=' + (New-LocalSecret)
        if ($existingSettings -match '(?m)^BOS_OCR_TOKEN=') {
            $existingSettings = $existingSettings -replace '(?m)^BOS_OCR_TOKEN=[^\r\n]*', $ocrTokenLine
        } else {
            $existingSettings = $existingSettings.TrimEnd() + "`n" + $ocrTokenLine + "`n"
        }
        [System.IO.File]::WriteAllText($projectEnvPath, $existingSettings)
    }
    return
}
$databasePassword = New-LocalSecret
$testDatabasePassword = New-LocalSecret
$administratorPassword = 'Yj' + (New-LocalSecret) + '8!'
$settings = Get-Content -LiteralPath (Join-Path $env:BOS_ROOT '.env.example') -Raw
$settings = $settings.Replace('BOS_DB_PASSWORD=', "BOS_DB_PASSWORD=$databasePassword").Replace('BOS_TEST_DB_PASSWORD=', "BOS_TEST_DB_PASSWORD=$testDatabasePassword").Replace('BOS_ADMIN_PASSWORD=', "BOS_ADMIN_PASSWORD=$administratorPassword")
$settings = $settings.Replace('BOS_OCR_TOKEN=', ('BOS_OCR_TOKEN=' + (New-LocalSecret)))
$settings = $settings.Replace('D:/business-optimization-system', $env:BOS_ROOT.Replace('\', '/'))
[System.IO.File]::WriteAllText($projectEnvPath, $settings)
[ordered]@{ url = 'http://127.0.0.1:5173'; loginName = 'owner'; password = $administratorPassword } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:BOS_ROOT '.local/access.json') -Encoding utf8
