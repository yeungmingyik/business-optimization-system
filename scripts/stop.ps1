param([switch]$Test)

. (Join-Path $PSScriptRoot 'enter-env.ps1')
$instanceName = if ($Test) { 'test' } else { 'development' }
$processFile = Join-Path $env:BOS_ROOT ".local/$instanceName-processes.json"
if (-not (Test-Path -LiteralPath $processFile)) { return }
$managedProcessIds = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json -AsHashtable
$processSnapshot = @(Get-CimInstance Win32_Process)
function Stop-ProjectProcess {
    param([int]$ProcessId)
    foreach ($child in $processSnapshot | Where-Object ParentProcessId -EQ $ProcessId) {
        Stop-ProjectProcess -ProcessId $child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}
foreach ($managedId in $managedProcessIds.Values) {
    $managed = $processSnapshot | Where-Object ProcessId -EQ $managedId
    if ($managed -and $managed.CommandLine.Contains((Join-Path $PSScriptRoot 'serve.ps1'))) {
        Stop-ProjectProcess -ProcessId $managedId
    }
}
Remove-Item -LiteralPath $processFile
