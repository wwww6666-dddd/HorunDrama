const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUpdateScript } = require('./update-script.cjs');

test('update script validates zip paths and backs up the previous app before overwrite', () => {
  const script = createUpdateScript({
    pid: 123,
    appDir: 'D:\\Apps\\HorunDrama',
    file: 'D:\\Data\\updates\\HorunDrama-2.0.11-win64-portable.zip',
    updateDir: 'D:\\Data\\updates',
    tmpDir: 'D:\\Apps\\HorunDrama\\.update-tmp',
    launcher: 'D:\\Apps\\HorunDrama\\HorunDrama.exe',
    backupDir: 'D:\\Apps\\HorunDrama\\.update-backup',
    keepPortableMarker: false,
  });
  const encodedCommand = script.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encodedCommand);
  const powershell = Buffer.from(encodedCommand, 'base64').toString('utf16le');
  assert.match(powershell, /ZipFile\]::OpenRead/);
  assert.ok(powershell.includes("-match '(^|/)\\.\\.(/|$)'"));
  assert.match(script, /"%ROBOCOPY%" "%APP_DIR%" "%BACKUP%"/);
  assert.match(script, /:rollback/);
  assert.match(script, /"%ROBOCOPY%" "%BACKUP%" "%APP_DIR%"/);
  assert.match(script, /copy \/y "%TMP%\\portable\.txt" "%APP_DIR%\\portable\.txt"/);
  assert.match(script, /if errorlevel 8 goto rollback/);
  assert.match(script, /set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/);
  assert.match(script, /"%PS%" -NoProfile -ExecutionPolicy Bypass -EncodedCommand/);
  assert.match(script, /set "PING=%SystemRoot%\\System32\\ping\.exe"/);
  assert.match(script, /"%PING%" 127\.0\.0\.1 -n 2 >nul/);
  assert.match(script, /WAIT_TIMEOUT/);
  assert.match(script, /"%ROBOCOPY%"/);
  assert.doesNotMatch(script, /^powershell -NoProfile/m);
  assert.doesNotMatch(script, /^robocopy /m);
  assert.doesNotMatch(script, /timeout \/t/);
});

test('passes update paths as environment values instead of PowerShell literals', () => {
  const script = createUpdateScript({
    pid: 123,
    appDir: "D:\\Users\\O'Brien\\Apps\\HorunDrama",
    file: "D:\\Users\\O'Brien\\AppData\\updates\\HorunDrama-2.0.11-win64-portable.zip",
    updateDir: "D:\\Users\\O'Brien\\AppData\\updates",
    tmpDir: "D:\\Users\\O'Brien\\Apps\\HorunDrama\\.update-tmp",
    launcher: "D:\\Users\\O'Brien\\Apps\\HorunDrama\\HorunDrama.exe",
    backupDir: "D:\\Users\\O'Brien\\Apps\\HorunDrama\\.update-backup",
    keepPortableMarker: false,
  });

  assert.match(script, /set "HORUN_PKG=%PKG%"/);
  assert.match(script, /set "HORUN_TMP=%TMP%"/);
  assert.match(script, /-EncodedCommand [A-Za-z0-9+/=]+/);
  assert.doesNotMatch(script, /OpenRead\('(?:%PKG%|D:)/);
  assert.doesNotMatch(script, /Expand-Archive -LiteralPath '\%PKG%'/);
});

test('PowerShell extracts an update from a path containing an apostrophe', (t) => {
  const tempRoot = process.env.HORUN_TEST_TMP ?? path.resolve(__dirname, '..', '..', '.tmp', 'desktop-tests');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, "update-O'Brien-"));
  const sourceDir = path.join(root, 'source');
  const archive = path.join(root, "package-O'Brien.zip");
  const outputDir = path.join(root, "extract-O'Brien");
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'HorunDrama.exe'), 'app');
  fs.writeFileSync(path.join(sourceDir, 'HorunDramaCore.exe'), 'core');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const zipped = spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    'Compress-Archive -Path (Join-Path $env:HORUN_SOURCE "*") -DestinationPath $env:HORUN_PKG -Force',
  ], {
    env: { ...process.env, HORUN_SOURCE: sourceDir, HORUN_PKG: archive },
    encoding: 'utf8',
  });
  assert.equal(zipped.status, 0, zipped.stderr || zipped.stdout);

  const script = createUpdateScript({
    pid: 123,
    appDir: root,
    file: archive,
    updateDir: root,
    tmpDir: outputDir,
    launcher: path.join(root, 'HorunDrama.exe'),
    backupDir: path.join(root, '.backup'),
    keepPortableMarker: false,
  });
  const encodedCommand = script.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encodedCommand);
  const extracted = spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand,
  ], {
    env: { ...process.env, HORUN_PKG: archive, HORUN_TMP: outputDir },
    encoding: 'utf8',
  });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  assert.equal(fs.readFileSync(path.join(outputDir, 'HorunDrama.exe'), 'utf8'), 'app');
  assert.equal(fs.readFileSync(path.join(outputDir, 'HorunDramaCore.exe'), 'utf8'), 'core');
});
