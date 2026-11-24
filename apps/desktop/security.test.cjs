const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedRendererUrl, isAllowedUpdateAsset, isAllowedUpdateRedirect } = require('./security.cjs');

test('accepts only the exact local renderer origin', () => {
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5880/', 'http://127.0.0.1:5880'), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5880.evil.example/', 'http://127.0.0.1:5880'), false);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5880@evil.example/', 'http://127.0.0.1:5880'), false);
  assert.equal(isTrustedRendererUrl('https://127.0.0.1:5880/', 'http://127.0.0.1:5880'), false);
  assert.equal(isTrustedRendererUrl('http://user@127.0.0.1:5880/', 'http://127.0.0.1:5880'), false);
});

test('only permits GitHub release asset redirect hosts', () => {
  assert.equal(isAllowedUpdateRedirect('https://release-assets.githubusercontent.com/file'), true);
  assert.equal(isAllowedUpdateRedirect('https://github.com/file'), true);
  assert.equal(isAllowedUpdateRedirect('https://evil.example/file'), false);
  assert.equal(isAllowedUpdateRedirect('http://release-assets.githubusercontent.com/file'), false);
});


test('allows the local Vite origin only in development', () => {
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5274/', 'http://127.0.0.1:5880', true), true);
  assert.equal(isTrustedRendererUrl('http://localhost:5274/', 'http://127.0.0.1:5880', true), true);
  assert.equal(isTrustedRendererUrl('http://evil.example:5274/', 'http://127.0.0.1:5880', true), false);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5274/', 'http://127.0.0.1:5880', false), false);
});

test('accepts only the project release portable zip asset', () => {
  assert.equal(
    isAllowedUpdateAsset('https://github.com/wwww6666-dddd/HorunDrama/releases/download/v2.0.11/HorunDrama-2.0.11-win64-portable.zip', 'HorunDrama-2.0.11-win64-portable.zip'),
    true,
  );
  assert.equal(
    isAllowedUpdateAsset('https://github.com/evil/repo/releases/download/v2.0.11/payload.zip', 'payload.zip'),
    false,
  );
  assert.equal(
    isAllowedUpdateAsset('https://evil@github.com/wwww6666-dddd/HorunDrama/releases/download/v2.0.11/HorunDrama-2.0.11-win64-portable.zip', 'HorunDrama-2.0.11-win64-portable.zip'),
    false,
  );
  assert.equal(
    isAllowedUpdateAsset('https://github.com/wwww6666-dddd/HorunDrama/releases/download/v2.0.11/payload.exe', 'payload.exe'),
    false,
  );
});
