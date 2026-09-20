. (Join-Path $PSScriptRoot 'enter-env.ps1')
foreach ($command in @('typecheck', 'build', 'test:unit', 'test:files')) {
    & (Join-Path $PSScriptRoot 'pnpm.ps1') $command
}
