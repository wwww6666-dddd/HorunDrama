const fs = require('node:fs');
const path = require('node:path');

function getDataRootCandidates({ isPackaged, envDataDir, appDataDir, localAppDataDir, appPath, resourcesPath }) {
  const candidates = [];
  if (typeof envDataDir === 'string' && envDataDir !== '') candidates.push(path.resolve(envDataDir));
  if (appDataDir) candidates.push(path.resolve(appDataDir));
  if (localAppDataDir) candidates.push(path.resolve(localAppDataDir));
  if (!isPackaged) {
    if (appPath) candidates.push(path.resolve(appPath, '..', '..', 'data'));
    if (resourcesPath) candidates.push(path.resolve(resourcesPath, '..', 'data'));
  }
  return [...new Set(candidates)];
}

function recoverInstalledDataRoot({ exeDir, appDataDir }) {
  const portableMarker = path.join(exeDir, 'portable.txt');
  const uninstaller = path.join(exeDir, 'Uninstall HorunDrama.exe');
  if (
    !fs.existsSync(portableMarker) ||
    !fs.existsSync(uninstaller) ||
    !hasKnownDatabase(appDataDir)
  ) {
    return null;
  }

  fs.unlinkSync(portableMarker);
  return appDataDir;
}

function hasKnownDatabase(directory) {
  return fs.existsSync(path.join(directory, 'horun.db')) || fs.existsSync(path.join(directory, 'yimu.db'));
}

module.exports = { getDataRootCandidates, recoverInstalledDataRoot, hasKnownDatabase };
