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
    // GUI 进程从 Explorer 或测试壳启动时，PATH 可能不含 System32/WindowsPowerShell。
    // 所有外部命令必须走绝对路径，否则 cmd 会把 powershell 当成未知命令（9009）。
    'if not defined SystemRoot set "SystemRoot=C:\\Windows"',
    'set "PATH=%SystemRoot%\\System32;%SystemRoot%\\System32\\WindowsPowerShell\\v1.0;%PATH%"',
    'set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    'set "TASKLIST=%SystemRoot%\\System32\\tasklist.exe"',
    'set "FIND=%SystemRoot%\\System32\\find.exe"',
    'set "PING=%SystemRoot%\\System32\\ping.exe"',
    'set "ROBOCOPY=%SystemRoot%\\System32\\robocopy.exe"',
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
    'set "LOG=%UPD_DIR%\\apply-update.log"',
    'set /a WAIT_COUNT=0',
    'call :log START',
    ':wait',
    '"%TASKLIST%" /FI "PID eq %PID%" 2>nul | "%FIND%" "%PID%" >nul',
    'if errorlevel 1 goto wait_done',
    'set /a WAIT_COUNT+=1',
    'if %WAIT_COUNT% GEQ 60 goto wait_timeout',
    '"%PING%" 127.0.0.1 -n 2 >nul',
    'goto wait',
    ':wait_timeout',
    'call :log WAIT_TIMEOUT pid=%PID%',
    'goto failed',
    ':wait_done',
    'call :log WAIT_DONE',
    '"%PING%" 127.0.0.1 -n 3 >nul',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'mkdir "%TMP%"',
    'call :log MKDIR_TMP errorlevel=%errorlevel%',
    'if errorlevel 1 goto failed',
    `"%PS%" -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${POWERSHELL_INSTALL_ENCODED}`,
    'call :log POWERSHELL errorlevel=%errorlevel%',
    'if errorlevel 1 goto failed',
    'if not exist "%TMP%\\HorunDrama.exe" goto failed',
    'if not exist "%TMP%\\HorunDramaCore.exe" goto failed',
    'if exist "%BACKUP%" rmdir /s /q "%BACKUP%"',
    'mkdir "%BACKUP%"',
    'call :log MKDIR_BACKUP errorlevel=%errorlevel%',
    'if errorlevel 1 goto failed',
    '"%ROBOCOPY%" "%APP_DIR%" "%BACKUP%" /E /XD data updates .update-tmp .update-backup /XF portable.txt /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    'call :log BACKUP_ROBOCOPY errorlevel=%errorlevel%',
    'if errorlevel 8 goto failed',
    'if not exist "%BACKUP%\\HorunDrama.exe" goto failed',
    'if not exist "%BACKUP%\\HorunDramaCore.exe" goto failed',
    '"%ROBOCOPY%" "%TMP%" "%APP_DIR%" /E /NFL /NDL /NJH /NJS /NP >nul',
    'call :log COPY_ROBOCOPY errorlevel=%errorlevel%',
    'if errorlevel 8 goto rollback',
    'if "%KEEP_PORTABLE%"=="0" del /q "%APP_DIR%\\portable.txt" 2>nul',
    'goto success',
    ':rollback',
    'call :log ROLLBACK',
    '"%ROBOCOPY%" "%BACKUP%" "%APP_DIR%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    'call :log ROLLBACK_DONE errorlevel=%errorlevel%',
    'if "%KEEP_PORTABLE%"=="1" copy /y "%TMP%\\portable.txt" "%APP_DIR%\\portable.txt" >nul 2>nul',
    'if "%KEEP_PORTABLE%"=="0" del /q "%APP_DIR%\\portable.txt" 2>nul',
    ':failed',
    'call :log FAILED',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'start "" "%LAUNCH%"',
    'exit /b 1',
    ':success',
    'call :log SUCCESS',
    'if exist "%TMP%" rmdir /s /q "%TMP%"',
    'del /q "%PKG%" 2>nul',
    'del /q "%PKG%.json" 2>nul',
    'start "" "%LAUNCH%"',
    ':log',
    '>>"%LOG%" echo [%date% %time%] %*',
    'exit /b 0',
    '',
  ];
  return lines.join('\r\n');
}

module.exports = { createUpdateScript };
