const POWERSHELL_INSTALL = String.raw`$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($env:HORUN_PKG)
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or $name -match '^[A-Za-z]:' -or ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000)) {
        throw 'ZIP contains an unsafe path or link'
      }
    }
  } finally {
    $archive.Dispose()
  }
  Expand-Archive -LiteralPath $env:HORUN_PKG -DestinationPath $env:HORUN_TMP -Force
  if (!(Test-Path -LiteralPath (Join-Path $env:HORUN_TMP 'HorunDrama.exe')) -or !(Test-Path -LiteralPath (Join-Path $env:HORUN_TMP 'HorunDramaCore.exe'))) {
    throw 'ZIP is missing required application executables'
  }
} catch {
  Write-Error $_
  exit 1
}`;
const POWERSHELL_INSTALL_ENCODED = Buffer.from(POWERSHELL_INSTALL, 'utf16le').toString('base64');

function createUpdateScript({ pid, appDir, file, updateDir, tmpDir, launcher, backupDir, keepPortableMarker }) {
  const lines = [
    '@echo off',
    'setlocal',
    `set "PID=${pid}"`,
    `set "APP_DIR=${appDir}"`,
    `set "PKG=${file}"`,
    `set "UPD_DIR=${updateDir}"`,
    `set "TMP=${tmpDir}"`,
    'set "HORUN_PKG=%PKG%"',
    'set "HORUN_TMP=%TMP%"',
    `set "LAUNCH=${launcher}"`,
    `set "BACKUP=${backupDir}"`,
    `set "KEEP_PORTABLE=${keepPortableMarker ? '1' : '0'}"`,
    ':wait',
    'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul',
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    'timeout /t 2 /nobreak >nul',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'mkdir "%TMP%"',
    'if errorlevel 1 goto failed',
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${POWERSHELL_INSTALL_ENCODED}`,
    'if errorlevel 1 goto failed',
    'if not exist "%TMP%\\HorunDrama.exe" goto failed',
    'if not exist "%TMP%\\HorunDramaCore.exe" goto failed',
    'if exist "%BACKUP%" rmdir /s /q "%BACKUP%"',
    'mkdir "%BACKUP%"',
    'if errorlevel 1 goto failed',
    'robocopy "%APP_DIR%" "%BACKUP%" /E /XD data updates .update-tmp .update-backup /XF portable.txt /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    'if errorlevel 8 goto failed',
    'if not exist "%BACKUP%\\HorunDrama.exe" goto failed',
    'if not exist "%BACKUP%\\HorunDramaCore.exe" goto failed',
    'robocopy "%TMP%" "%APP_DIR%" /E /NFL /NDL /NJH /NJS /NP >nul',
    'if errorlevel 8 goto rollback',
    'if "%KEEP_PORTABLE%"=="0" del /q "%APP_DIR%\\portable.txt" 2>nul',
    'goto success',
    ':rollback',
    'robocopy "%BACKUP%" "%APP_DIR%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    'if "%KEEP_PORTABLE%"=="1" copy /y "%TMP%\\portable.txt" "%APP_DIR%\\portable.txt" >nul 2>nul',
    'if "%KEEP_PORTABLE%"=="0" del /q "%APP_DIR%\\portable.txt" 2>nul',
    ':failed',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'start "" "%LAUNCH%"',
    'exit /b 1',
    ':success',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'del /q "%PKG%" 2>nul',
    'del /q "%PKG%.json" 2>nul',
    'start "" "%LAUNCH%"',
    'del "%~f0"',
    '',
  ];
  return lines.join('\r\n');
}

module.exports = { createUpdateScript };
