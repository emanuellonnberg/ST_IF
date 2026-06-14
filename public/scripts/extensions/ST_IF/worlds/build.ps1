# Recompile every world: worlds/*.inf -> worlds/*.z5
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$inform = Join-Path $here '..\tools\inform6.exe'
$lib    = Join-Path $here '..\tools\inform6lib-master'
if (-not (Test-Path $inform)) { throw "inform6.exe not found in ../tools — see worlds/README.md" }
# Regenerate the runtime-growth pool include before building (sizes live in the generator).
if (Test-Path (Join-Path $here 'gen_expanse.mjs')) { & node (Join-Path $here 'gen_expanse.mjs') }
Get-ChildItem -Path $here -Filter *.inf | ForEach-Object {
    $out = Join-Path $here ($_.BaseName + '.z5')
    # include_path carries both the library and this worlds dir (for expanse.h).
    & $inform "+include_path=$lib,$here" -v5 $_.FullName $out
    if ($LASTEXITCODE -ne 0) { throw "compile failed: $($_.Name)" }
    Write-Host "built $($_.BaseName).z5"
}
