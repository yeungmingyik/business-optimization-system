. (Join-Path $PSScriptRoot 'enter-env.ps1')
Push-Location $env:BOS_ROOT
try {
    docker compose run --rm --no-deps --volume "${env:BOS_ROOT}/services/ocr/tests:/tests:ro" ocr python -m unittest discover -s /tests -v
    if ($LASTEXITCODE -ne 0) { throw 'OCR_TESTS_FAILED' }
} finally { Pop-Location }
