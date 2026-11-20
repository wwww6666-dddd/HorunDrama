# Sign HorunDrama release artifacts (Windows PowerShell 5.1 compatible, ASCII only)
# Usage:
#   $env:HORUN_CSC_PASSWORD = '...'
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/scripts/sign-release.ps1
param(
  [string]$Pfx = (Join-Path $PSScriptRoot '..\..\..\certs\horun-codesign.pfx'),
  [string]$Password = $env:HORUN_CSC_PASSWORD,
  [string]$Version = '2.0.1'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Pfx)) { throw "PFX not found: $Pfx" }
if ([string]::IsNullOrEmpty($Password)) { throw 'Set HORUN_CSC_PASSWORD first' }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if ($null -eq $signtool) { throw 'x64 signtool.exe not found (Windows SDK required)' }

$release = Resolve-Path (Join-Path $PSScriptRoot '..\release')
$targets = @(
  (Join-Path $release "win-unpacked\HorunDrama.exe"),
  (Join-Path $release "win-unpacked\HorunDramaCore.exe"),
  (Join-Path $release "HorunDrama Setup $Version.exe")
) | Where-Object { Test-Path -LiteralPath $_ }

if ($targets.Count -eq 0) { throw 'No artifacts found. Run the dist build first.' }

foreach ($file in $targets) {
  Write-Host "Signing $file ..."
  & $signtool.FullName sign /fd SHA256 /f $Pfx /p $Password /tr http://timestamp.digicert.com /td SHA256 $file
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Timestamp service unavailable; signing without timestamp'
    & $signtool.FullName sign /fd SHA256 /f $Pfx /p $Password $file
  }
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $file" }
}

Get-AuthenticodeSignature $targets | Select-Object Path, Status, @{n='Signer';e={$_.SignerCertificate.Subject}} | Format-Table -AutoSize
