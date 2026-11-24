param(
  [string]$Version = (Get-Content -Raw (Join-Path $PSScriptRoot '..\package.json') | ConvertFrom-Json).version
)

$ErrorActionPreference = 'Stop'
$desktop = Resolve-Path (Join-Path $PSScriptRoot '..')
$release = Join-Path $desktop 'release'
$source = Join-Path $release 'build\win-unpacked'
if (-not (Test-Path -LiteralPath $source)) {
  throw "Payload not found: $source. Run pnpm --filter @horun/desktop run pack first."
}

$id = [guid]::NewGuid().ToString('N')
$stage = Join-Path ([IO.Path]::GetTempPath()) "HorunDrama-portable-$id"
$zipTemp = Join-Path ([IO.Path]::GetTempPath()) "HorunDrama-portable-$id.zip"
$zip = Join-Path $release "HorunDrama-$Version-win64-portable.zip"

try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  robocopy $source $stage /E /XD data docs .git /XF portable.txt 使用说明.txt | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  [IO.File]::WriteAllText((Join-Path $stage 'portable.txt'), 'portable', [Text.Encoding]::ASCII)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $stage,
    $zipTemp,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  Move-Item -LiteralPath $zipTemp -Destination $zip -Force
  Get-Item -LiteralPath $zip | Select-Object FullName, Length
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Test-Path -LiteralPath $zipTemp) { Remove-Item -LiteralPath $zipTemp -Force }
}
