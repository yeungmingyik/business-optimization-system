$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'enter-env.ps1')
    return
} catch {
    if ($_.Exception.Message -notlike 'NODE_NOT_FOUND:*') { throw }
}

if (-not $IsWindows) { throw 'WINDOWS_REQUIRED' }
if ([System.IO.Path]::GetFileName($env:BOS_NODE) -ine 'node.exe') { throw 'NODE_EXECUTABLE_PATH_REQUIRED' }
$nodeDirectory = Split-Path $env:BOS_NODE -Parent
Assert-ProjectDrive $nodeDirectory
if (Test-Path -LiteralPath $nodeDirectory) { throw "NODE_INSTALL_DIRECTORY_EXISTS: $nodeDirectory" }
$nodeArchitecture = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw 'NODE_ARCHITECTURE_UNSUPPORTED' }
}
$nodeVersion = '24.19.0'
$nodeArchiveName = "node-v$nodeVersion-win-$nodeArchitecture.zip"
$nodeReleaseUrl = "https://nodejs.org/download/release/v$nodeVersion"
$nodeDownloadDirectory = Join-Path $env:BOS_ROOT '.cache/node-downloads'
Assert-ProjectDrive $nodeDownloadDirectory
New-Item -ItemType Directory -Path $nodeDownloadDirectory -Force | Out-Null
$nodeArchivePath = Join-Path $nodeDownloadDirectory $nodeArchiveName
$nodeChecksumsPath = Join-Path $nodeDownloadDirectory "v$nodeVersion-SHASUMS256.txt"
Invoke-WebRequest -Uri "$nodeReleaseUrl/SHASUMS256.txt" -OutFile $nodeChecksumsPath
$nodeChecksumPattern = '^([a-fA-F0-9]{64})\s+' + [regex]::Escape($nodeArchiveName) + '$'
$nodeExpectedChecksum = @(
    foreach ($nodeChecksumLine in Get-Content -LiteralPath $nodeChecksumsPath) {
        if ($nodeChecksumLine -match $nodeChecksumPattern) { $Matches[1] }
    }
)
if ($nodeExpectedChecksum.Count -ne 1) { throw 'NODE_CHECKSUM_UNAVAILABLE' }
if (-not (Test-Path -LiteralPath $nodeArchivePath)) {
    $nodeDownloadPath = Join-Path $nodeDownloadDirectory ($nodeArchiveName + '.' + [guid]::NewGuid().ToString('N') + '.part')
    Invoke-WebRequest -Uri "$nodeReleaseUrl/$nodeArchiveName" -OutFile $nodeDownloadPath
    if ((Get-FileHash -LiteralPath $nodeDownloadPath -Algorithm SHA256).Hash -ine $nodeExpectedChecksum[0]) {
        throw "NODE_CHECKSUM_MISMATCH: $nodeDownloadPath"
    }
    Assert-ProjectDrive $nodeDownloadPath
    Assert-ProjectDrive $nodeArchivePath
    [System.IO.File]::Move($nodeDownloadPath, $nodeArchivePath)
}
if ((Get-FileHash -LiteralPath $nodeArchivePath -Algorithm SHA256).Hash -ine $nodeExpectedChecksum[0]) {
    throw "NODE_CHECKSUM_MISMATCH: $nodeArchivePath"
}
$nodeExtractDirectory = Join-Path $env:TEMP ('node-install-' + [guid]::NewGuid().ToString('N'))
Assert-ProjectDrive $nodeExtractDirectory
[System.IO.Compression.ZipFile]::ExtractToDirectory($nodeArchivePath, $nodeExtractDirectory)
$nodeExtractedDirectory = Join-Path $nodeExtractDirectory "node-v$nodeVersion-win-$nodeArchitecture"
Assert-ProjectDrive $nodeExtractedDirectory
Assert-ProjectDrive $nodeDirectory
New-Item -ItemType Directory -Path (Split-Path $nodeDirectory -Parent) -Force | Out-Null
[System.IO.Directory]::Move($nodeExtractedDirectory, $nodeDirectory)
. (Join-Path $PSScriptRoot 'enter-env.ps1')
