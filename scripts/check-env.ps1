. (Join-Path $PSScriptRoot 'enter-env.ps1')

$projectEnvironmentNames = @(
    'BOS_ROOT', 'BOS_NODE', 'TEMP', 'TMP', 'TMPDIR', 'npm_config_cache',
    'npm_package_config_node_gyp_devdir', 'npm_config_prefix', 'NODE_COMPILE_CACHE', 'PNPM_HOME',
    'COREPACK_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_HTML_OUTPUT_DIR', 'PLAYWRIGHT_TEST_OUTPUT_DIR',
    'PYTHONPYCACHEPREFIX', 'PIP_CACHE_DIR'
)
$projectEnvironmentPaths = [ordered]@{}
foreach ($projectEnvironmentName in $projectEnvironmentNames) {
    $projectEnvironmentValue = [Environment]::GetEnvironmentVariable($projectEnvironmentName, 'Process')
    Assert-ProjectDrive $projectEnvironmentValue
    $projectEnvironmentPaths[$projectEnvironmentName] = $projectEnvironmentValue
}
$projectPnpmVersion = (& (Join-Path $PSScriptRoot 'pnpm.ps1') --version | Select-Object -Last 1).Trim()
$projectPnpmStore = (& (Join-Path $PSScriptRoot 'pnpm.ps1') store path | Select-Object -Last 1).Trim()
Assert-ProjectDrive $projectPnpmStore
$projectPnpmPaths = [ordered]@{}
foreach ($projectPnpmSetting in @('cache-dir', 'state-dir', 'global-dir')) {
    $projectPnpmSettingValue = (& (Join-Path $PSScriptRoot 'pnpm.ps1') config get $projectPnpmSetting | Select-Object -Last 1).Trim()
    Assert-ProjectDrive $projectPnpmSettingValue
    $projectPnpmPaths[$projectPnpmSetting] = $projectPnpmSettingValue
}
$projectPnpmBin = (& (Join-Path $PSScriptRoot 'pnpm.ps1') bin --global | Select-Object -Last 1).Trim()
Assert-ProjectDrive $projectPnpmBin
$projectPnpmPaths['global-bin'] = $projectPnpmBin
$projectEnvironmentReport = [ordered]@{
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    nodeVersion = (& $env:BOS_NODE --version).Trim()
    pnpmVersion = $projectPnpmVersion
    pnpmStore = $projectPnpmStore
    pnpmPaths = $projectPnpmPaths
    paths = $projectEnvironmentPaths
    pathCheck = 'passed'
}
$projectEnvironmentJson = $projectEnvironmentReport | ConvertTo-Json -Depth 4
$projectEnvironmentJson | Set-Content -LiteralPath (Join-Path $env:BOS_ROOT '.local/environment-check.json') -Encoding utf8
$projectEnvironmentJson
