# Sign HorunDrama release artifacts (Windows PowerShell 5.1 compatible, ASCII only)
# Usage:
#   # A) cert already imported into CurrentUser\My (no password needed; preferred)
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/scripts/sign-release.ps1
#   # B) PFX on disk
#   $env:HORUN_CSC_PASSWORD = '...'
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps/desktop/scripts/sign-release.ps1
#   # C) explicit thumbprint
#   $env:HORUN_CSC_SHA1 = 'CEA8...'
param(
  [string]$Pfx = (Join-Path $PSScriptRoot '..\..\..\certs\horun-codesign.pfx'),
  [string]$Password = $env:HORUN_CSC_PASSWORD,
  [string]$Sha1 = $env:HORUN_CSC_SHA1,
  [string]$Version = '2.0.1'
)

$ErrorActionPreference = 'Stop'

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if ($null -eq $signtool) { throw 'x64 signtool.exe not found (Windows SDK required)' }

# Pick the signer: a matching cert in CurrentUser\My needs no password at all
# (the PFX password is not stored anywhere on this machine, so this is the default path).
$cert = $null
if (-not [string]::IsNullOrEmpty($Sha1)) {
  $cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Thumbprint -eq $Sha1 -and $_.HasPrivateKey } |
    Select-Object -First 1
} else {
  $cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like '*CN=Horun*' -and $_.HasPrivateKey } |
    Select-Object -First 1
}

if ($null -ne $cert) {
  Write-Host "Signer: cert store $($cert.Thumbprint) ($($cert.Subject))"
  $base = @('sign', '/sha1', $cert.Thumbprint, '/fd', 'SHA256')
} else {
  if (-not (Test-Path -LiteralPath $Pfx)) {
    throw "No CN=Horun cert with private key in CurrentUser\My, and PFX not found: $Pfx"
  }
  if ([string]::IsNullOrEmpty($Password)) {
    throw 'Set HORUN_CSC_SHA1 (cert store) or HORUN_CSC_PASSWORD (PFX) first'
  }
  Write-Host "Signer: PFX $Pfx"
  $base = @('sign', '/fd', 'SHA256', '/f', $Pfx, '/p', $Password)
}

$release = Resolve-Path (Join-Path $PSScriptRoot '..\release')
$targets = @(
  (Join-Path $release "win-unpacked\HorunDrama.exe"),
  (Join-Path $release "win-unpacked\HorunDramaCore.exe"),
  (Join-Path $release "HorunDrama Setup $Version.exe")
) | Where-Object { Test-Path -LiteralPath $_ }

if ($targets.Count -eq 0) { throw 'No artifacts found. Run the pack build first.' }

foreach ($file in $targets) {
  Write-Host "Signing $file ..."
  & $signtool.FullName @base /tr http://timestamp.digicert.com /td SHA256 $file
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Timestamp service unavailable; signing without timestamp'
    & $signtool.FullName @base $file
  }
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $file" }
}

Get-AuthenticodeSignature $targets | Select-Object Path, Status, @{n='Signer';e={$_.SignerCertificate.Subject}} | Format-Table -AutoSize
