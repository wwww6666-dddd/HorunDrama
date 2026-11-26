param(
  [string]$Version = (Get-Content -Raw (Join-Path $PSScriptRoot '..\package.json') | ConvertFrom-Json).version,
  [string]$AcceptDir = '',
  [string]$SourceDir = ''
)

$ErrorActionPreference = 'Stop'
$desktop = Resolve-Path (Join-Path $PSScriptRoot '..')
$repo = Resolve-Path (Join-Path $desktop '..\..')
$release = Join-Path $desktop 'release'
$source = if ([string]::IsNullOrWhiteSpace($SourceDir)) {
  Join-Path $release 'build\win-unpacked'
} else {
  (Resolve-Path -LiteralPath $SourceDir).Path
}
if (-not (Test-Path -LiteralPath $source)) {
  throw "Payload not found: $source. Run pnpm --filter @horun/desktop run pack first."
}
if ([string]::IsNullOrWhiteSpace($AcceptDir)) {
  # Fixed acceptance folder; refresh in place after every build.
  $AcceptDir = Join-Path $release 'HorunDrama'
}

# Put compliance files into the payload first; the staging robocopy below
# then carries them into the portable zip and acceptance folder.
[IO.File]::Copy((Join-Path $repo 'LICENSE'), (Join-Path $source 'LICENSE'), $true)
[IO.File]::Copy((Join-Path $repo 'NOTICE.md'), (Join-Path $source 'NOTICE.md'), $true)
[IO.File]::Copy((Join-Path $repo 'FFMPEG-SOURCE.md'), (Join-Path $source 'FFMPEG-SOURCE.md'), $true)

$tempRoot = Join-Path $repo '.tmp\temp'
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$id = [guid]::NewGuid().ToString('N')
$stage = Join-Path $tempRoot "HorunDrama-portable-$id"
$zipTemp = Join-Path $tempRoot "HorunDrama-portable-$id.zip"
$zip = Join-Path $release "HorunDrama-$Version-win64-portable.zip"

try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  # Exclude every root-level txt (stale portable marker or usage note), runtime
  # debug logs and crash dumps; the zip should only contain shipped files.
  robocopy $source $stage /E /XD data docs .git /XF '*.txt' 'debug.log' '*.dmp' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

  Get-ChildItem (Join-Path $desktop 'resources') -Filter '*.txt' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $stage -Force
  }

  if (-not (Test-Path -LiteralPath (Join-Path $stage 'LICENSE'))) {
    throw 'LICENSE is missing from portable staging'
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

  $accept = $AcceptDir
  # Never delete the acceptance folder's data directory: it holds the user's
  # media cache, settings, session and Chromium profile. Move it aside before
  # refreshing the payload and restore it afterwards, even if the copy fails.
  $dataBackup = Join-Path $tempRoot "HorunDrama-data-$id"
  $hadData = Test-Path -LiteralPath (Join-Path $accept 'data')
  if ($hadData) {
    Move-Item -LiteralPath (Join-Path $accept 'data') -Destination $dataBackup -Force
  }
  try {
    if (Test-Path -LiteralPath $accept) { Remove-Item -LiteralPath $accept -Recurse -Force }
    robocopy $stage $accept /E /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "acceptance copy failed: $LASTEXITCODE" }
  } finally {
    if ($hadData -and (Test-Path -LiteralPath $dataBackup)) {
      New-Item -ItemType Directory -Path $accept -Force | Out-Null
      Move-Item -LiteralPath $dataBackup -Destination (Join-Path $accept 'data') -Force
    }
  }
  # Workspace copies inherit a Low integrity label in sandboxed sessions, which
  # stops the app from writing its own data folder. Reset to Medium.
  & icacls $accept /setintegritylevel '(OI)(CI)M' /T /C | Out-Null
  Write-Output ("[portable] acceptance dir: " + $accept)

  Get-Item -LiteralPath $zip | Select-Object FullName, Length
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if (Test-Path -LiteralPath $zipTemp) { Remove-Item -LiteralPath $zipTemp -Force }
}
