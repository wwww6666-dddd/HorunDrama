const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDataRootCandidates, recoverInstalledDataRoot, hasKnownDatabase } = require('./data-root.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'horundrama-data-root-'));
  t.after(() => removeTree(root));
  const exeDir = path.join(root, 'install');
  const appDataDir = path.join(root, 'appdata', 'HorunDrama');
  fs.mkdirSync(exeDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.writeFileSync(path.join(exeDir, 'portable.txt'), 'portable');
  fs.writeFileSync(path.join(appDataDir, 'horun.db'), 'old database');
  return { exeDir, appDataDir };
}

function removeTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(directory);
}

test('recovers AppData for an installed upgrade carrying portable.txt', (t) => {
  const { exeDir, appDataDir } = fixture(t);
  fs.writeFileSync(path.join(exeDir, 'Uninstall HorunDrama.exe'), 'uninstaller');

  assert.equal(recoverInstalledDataRoot({ exeDir, appDataDir }), appDataDir);
  assert.equal(fs.existsSync(path.join(exeDir, 'portable.txt')), false);
});

test('keeps portable mode when the directory has no installer uninstaller', (t) => {
  const { exeDir, appDataDir } = fixture(t);

  assert.equal(recoverInstalledDataRoot({ exeDir, appDataDir }), null);
  assert.equal(fs.existsSync(path.join(exeDir, 'portable.txt')), true);
});

test('does not migrate without the prior AppData database', (t) => {
  const { exeDir, appDataDir } = fixture(t);
  fs.writeFileSync(path.join(exeDir, 'Uninstall HorunDrama.exe'), 'uninstaller');
  fs.unlinkSync(path.join(appDataDir, 'horun.db'));

  assert.equal(recoverInstalledDataRoot({ exeDir, appDataDir }), null);
  assert.equal(fs.existsSync(path.join(exeDir, 'portable.txt')), true);
});

test('recognizes both the current and legacy database filenames', (t) => {
  const { appDataDir } = fixture(t);
  assert.equal(hasKnownDatabase(appDataDir), true);
  fs.renameSync(path.join(appDataDir, 'horun.db'), path.join(appDataDir, 'yimu.db'));
  assert.equal(hasKnownDatabase(appDataDir), true);
  fs.unlinkSync(path.join(appDataDir, 'yimu.db'));
  assert.equal(hasKnownDatabase(appDataDir), false);
});

test('packaged builds never use install or resources folders as data roots', () => {
  const candidates = getDataRootCandidates({
    isPackaged: true,
    appDataDir: 'C:\\Users\\user\\AppData\\Roaming\\HorunDrama',
    localAppDataDir: 'C:\\Users\\user\\AppData\\Local\\HorunDrama',
    appPath: 'C:\\Apps\\HorunDrama\\resources\\app.asar',
    resourcesPath: 'C:\\Apps\\HorunDrama\\resources',
  });

  assert.deepEqual(candidates, [
    'C:\\Users\\user\\AppData\\Roaming\\HorunDrama',
    'C:\\Users\\user\\AppData\\Local\\HorunDrama',
  ]);
});

test('development builds retain repository-local fallback data roots', () => {
  const candidates = getDataRootCandidates({
    isPackaged: false,
    appDataDir: 'C:\\Users\\user\\AppData\\Roaming\\HorunDrama',
    localAppDataDir: '',
    appPath: 'D:\\Repo\\apps\\desktop',
    resourcesPath: 'D:\\Repo\\apps\\desktop\\resources',
  });

  assert.deepEqual(candidates.slice(1), ['D:\\Repo\\data', 'D:\\Repo\\apps\\desktop\\data']);
});
