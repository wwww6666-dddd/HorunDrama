const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('installer does not recursively delete a legacy install directory', () => {
  const script = fs.readFileSync(path.join(__dirname, 'setup.nsi'), 'utf8');
  assert.doesNotMatch(script, /RMDir\s+\/r/i);
});
