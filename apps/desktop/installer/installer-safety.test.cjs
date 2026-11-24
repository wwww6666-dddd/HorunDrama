const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('installer does not copy the compile-only uninstall manifest', () => {
  const script = fs.readFileSync(path.join(__dirname, 'setup.nsi'), 'utf8');
  assert.match(script, /File \/nonfatal \/r \/x "\.horundrama-uninstall\.nsh"/i);
});

test('installer does not recursively delete a legacy install directory', () => {
  const script = fs.readFileSync(path.join(__dirname, 'setup.nsi'), 'utf8');
  assert.doesNotMatch(script, /RMDir\s+\/r/i);
});

test('installer has a single conditional UAC relaunch, not global admin', () => {
  const script = fs.readFileSync(path.join(__dirname, 'setup.nsi'), 'utf8');
  assert.match(script, /RequestExecutionLevel\s+user/i);
  assert.doesNotMatch(script, /RequestExecutionLevel\s+admin/i);
  assert.match(script, /AllowSkipFiles\s+off/i);
  assert.match(script, /Function\s+EnsureInstallDirWritable/i);
  assert.match(script, /FileOpen\s+\$0\s+"\$INSTDIR\\\.horundrama-write-probe"/i);
  assert.match(script, /ExecShell\s+"runas"\s+"\$EXEPATH"\s+"\$CMDLINE\s+\/RELAUNCH\s+\/D=\$INSTDIR"/i);
  assert.match(script, /IfErrors\s+\+2\s+0/i);
});

test('installer shows the GPL license page', () => {
  const script = fs.readFileSync(path.join(__dirname, 'setup.nsi'), 'utf8');
  assert.match(script, /MUI_PAGE_LICENSE\s+"\$\{PAYLOAD\}\\LICENSE"/i);
});
