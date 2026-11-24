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
  # Exclude every root-level txt (stale portable marker or usage note) and copy the
  # current usage note back from resources, so the zip always ships one.
  robocopy $source $stage /E /XD data docs .git /XF '*.txt' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  Get-ChildItem (Join-Path $desktop 'resources') -Filter '*.txt' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $stage -Force
  }
  [IO.File]::WriteAllText((Join-Path $stage 'portable.txt'), 'portable', [Text.Encoding]::ASCII)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $stage,
    $zipTemp,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  Move-Item -LiteralPath $zipTemp -Destination $zip -Force

  # Refresh the acceptance folder next to the zip, so acceptance always runs the
  # freshly built packet: release\HorunDrama-<version>-win64-portable
  $accept = Join-Path $release ("HorunDrama-$Version-win64-portable")
  if (Test-Path -LiteralPath $accept) { Remove-Item -LiteralPath $accept -Recurse -Force }
  robocopy $stage $accept /E /NFL /NDL /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "acceptance copy failed: $LASTEXITCODE" }
  # Workspace copies inherit a Low integrity label in sandboxed sessions, which stops
  # the app from writing its own data\ folder.Reset to Medium (the normal default).
  & icacls $accept /setintegritylevel '(OI)(CI)M' /T /C | Out-Null
  Write-Output ("[portable] acceptance dir: " + $accept)

  Get-Item -LiteralPath $zip | Select-Object FullName, Length
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Test-Path -LiteralPath $zipTemp) { Remove-Item -LiteralPath $zipTemp -Force }
}
