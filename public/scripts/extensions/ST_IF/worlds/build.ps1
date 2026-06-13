# Recompile every world: worlds/*.inf -> worlds/*.z5
$ErrorActionPreference = 'Stop'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$inform = Join-Path $here '..\tools\inform6.exe'
$lib    = Join-Path $here '..\tools\inform6lib-master'
if (-not (Test-Path $inform)) { throw "inform6.exe not found in ../tools — see worlds/README.md" }
Get-ChildItem -Path $here -Filter *.inf | ForEach-Object {
    $out = Join-Path $here ($_.BaseName + '.z5')
    & $inform "+$lib" -v5 $_.FullName $out
    if ($LASTEXITCODE -ne 0) { throw "compile failed: $($_.Name)" }
    Write-Host "built $($_.BaseName).z5"
}
