$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'POWERSHELL_7_REQUIRED'
}

function Assert-ProjectDrive {
    param([Parameter(Mandatory)][string]$Path)

    $projectAbsolutePath = [System.IO.Path]::GetFullPath($Path)
    if ([System.IO.Path]::GetPathRoot($projectAbsolutePath) -ine 'D:\') {
        throw "D_DRIVE_REQUIRED: $projectAbsolutePath"
    }
    $projectPathCursor = $projectAbsolutePath
    while ($projectPathCursor) {
        if (Test-Path -LiteralPath $projectPathCursor) {
            $projectPathItem = Get-Item -LiteralPath $projectPathCursor -Force
            if ($projectPathItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                $projectLinkTarget = $projectPathItem.ResolveLinkTarget($true)
                if (-not $projectLinkTarget -or [System.IO.Path]::GetPathRoot($projectLinkTarget.FullName) -ine 'D:\') {
                    throw "D_DRIVE_LINK_REQUIRED: $projectPathCursor"
                }
            }
        }
        $projectPathCursor = [System.IO.Path]::GetDirectoryName($projectPathCursor)
    }
}

$env:BOS_ROOT = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Assert-ProjectDrive $env:BOS_ROOT
$projectDirectoryNames = @(
    '.cache/temp', '.cache/npm', '.cache/node-gyp', '.cache/node-compile', '.cache/python', '.cache/pip',
    '.cache/pnpm/store', '.cache/pnpm/cache', '.cache/pnpm/state', '.cache/corepack',
    '.cache/xdg', '.cache/xdg/config', '.cache/xdg/data', '.cache/playwright',
    '.tools/pnpm', '.tools/pnpm/bin', '.tools/pnpm/global', '.data/postgres',
    '.data/uploads', '.data/backups', '.artifacts/logs', '.artifacts/tests', '.local'
)
foreach ($projectDirectoryName in $projectDirectoryNames) {
    $projectDirectoryPath = Join-Path $env:BOS_ROOT $projectDirectoryName
    Assert-ProjectDrive $projectDirectoryPath
    New-Item -ItemType Directory -Path $projectDirectoryPath -Force | Out-Null
}

$env:TEMP = Join-Path $env:BOS_ROOT '.cache/temp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $env:BOS_ROOT '.cache/npm'
$env:npm_package_config_node_gyp_devdir = Join-Path $env:BOS_ROOT '.cache/node-gyp'
$env:npm_config_prefix = Join-Path $env:BOS_ROOT '.tools/pnpm'
$env:NODE_COMPILE_CACHE = Join-Path $env:BOS_ROOT '.cache/node-compile'
$env:PYTHONPYCACHEPREFIX = Join-Path $env:BOS_ROOT '.cache/python'
$env:PYTHONNOUSERSITE = '1'
$env:PIP_CACHE_DIR = Join-Path $env:BOS_ROOT '.cache/pip'
$env:PNPM_HOME = Join-Path $env:BOS_ROOT '.tools/pnpm'
$env:COREPACK_HOME = Join-Path $env:BOS_ROOT '.cache/corepack'
$env:XDG_CACHE_HOME = Join-Path $env:BOS_ROOT '.cache/xdg'
$env:XDG_CONFIG_HOME = Join-Path $env:BOS_ROOT '.cache/xdg/config'
$env:XDG_DATA_HOME = Join-Path $env:BOS_ROOT '.cache/xdg/data'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:BOS_ROOT '.cache/playwright'
$env:PLAYWRIGHT_HTML_OUTPUT_DIR = Join-Path $env:BOS_ROOT '.artifacts/tests/playwright-report'
$env:PLAYWRIGHT_TEST_OUTPUT_DIR = Join-Path $env:BOS_ROOT '.artifacts/tests/results'
$env:BOS_NODE = if ($env:BOS_NODE) { $env:BOS_NODE } else { 'D:\nodejs\node.exe' }
Assert-ProjectDrive $env:BOS_NODE
if (-not (Test-Path -LiteralPath $env:BOS_NODE -PathType Leaf)) {
    throw "NODE_NOT_FOUND: $env:BOS_NODE"
}
$projectNodeVersion = (& $env:BOS_NODE --version).TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]$projectNodeVersion -lt [version]'24.19.0' -or [version]$projectNodeVersion -ge [version]'25.0.0') {
    throw "NODE_VERSION_UNSUPPORTED: $projectNodeVersion"
}
$projectPathEntries = @((Join-Path $env:PNPM_HOME 'bin'), (Split-Path $env:BOS_NODE -Parent)) + @($env:PATH -split [System.IO.Path]::PathSeparator)
$env:PATH = ($projectPathEntries | Select-Object -Unique) -join [System.IO.Path]::PathSeparator
