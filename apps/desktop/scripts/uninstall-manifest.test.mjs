import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUninstallManifest } from './uninstall-manifest.mjs';

test('manifest removes only shipped files and leaves unknown user files untouched', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'horundrama-uninstall-manifest-'));
  t.after(() => removeTree(root));
  mkdirSync(join(root, 'resources'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'HorunDrama.exe'), 'app');
  writeFileSync(join(root, 'resources', 'app.asar'), 'app');
  writeFileSync(join(root, 'data', 'horun.db'), 'user');

  const manifest = createUninstallManifest(root);
  assert.match(manifest, /Delete "\$INSTDIR\\HorunDrama\.exe"/);
  assert.match(manifest, /Delete "\$INSTDIR\\resources\\app\.asar"/);
  assert.doesNotMatch(manifest, /horun\.db/);
  assert.doesNotMatch(manifest, /RMDir \/r/);
  assert.ok(manifest.indexOf('RMDir "$INSTDIR\\resources"') > manifest.indexOf('Delete "$INSTDIR\\resources\\app.asar"'));
});

function removeTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(directory);
}
