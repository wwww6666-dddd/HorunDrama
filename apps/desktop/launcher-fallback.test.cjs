const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('packaged launcher tries sandboxed Electron before compatibility fallback', () => {
  const launcher = fs.readFileSync(path.join(__dirname, 'launcher', 'HorunDramaLauncher.cs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');

  assert.match(launcher, /StartCore\(core, args, false\)/);
  assert.match(launcher, /WaitForExit\(6000\)/);
  assert.match(launcher, /StartCore\(core, args, true\)/);
  assert.doesNotMatch(main, /if\s*\(!process\.argv\.includes\('--no-sandbox'\)\)\s*\{/);
});
