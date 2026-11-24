const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getOrCreateSessionKey } = require('./session-key.cjs');

function fixture(t) {
  const tempRoot = process.env.HORUN_TEST_TMP ?? path.resolve(__dirname, '..', '..', '.tmp', 'desktop-tests');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'session-key-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'session-key.dpapi');
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`dpapi:${value}`),
    decryptString: (value) => value.toString('utf8').slice('dpapi:'.length),
  };
}

test('stores the session key encrypted and reuses it across launches', (t) => {
  const filePath = fixture(t);
  const safeStorage = fakeSafeStorage();
  const firstKey = getOrCreateSessionKey({ safeStorage, filePath, randomBytes: () => Buffer.alloc(32, 3) });
  const stored = fs.readFileSync(filePath);

  assert.equal(stored.toString('utf8').startsWith('dpapi:'), true);
  assert.equal(stored.toString('utf8').includes(firstKey), true);
  assert.equal(getOrCreateSessionKey({ safeStorage, filePath, randomBytes: () => Buffer.alloc(32, 4) }), firstKey);
});

test('returns an empty key if platform encryption is unavailable', (t) => {
  const filePath = fixture(t);
  const key = getOrCreateSessionKey({
    safeStorage: { isEncryptionAvailable: () => false },
    filePath,
    randomBytes: () => Buffer.alloc(32, 9),
  });

  assert.equal(key, '');
  assert.equal(fs.existsSync(filePath), false);
});

test('regenerates the session key when the stored ciphertext cannot be decrypted', (t) => {
  const filePath = fixture(t);
  const strictSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`dpapi:${value}`),
    decryptString: (value) => {
      const text = value.toString('utf8');
      if (!text.startsWith('dpapi:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return text.slice('dpapi:'.length);
    },
  };
  fs.writeFileSync(filePath, Buffer.from('corrupted-ciphertext'));

  const warnings = [];
  const firstKey = getOrCreateSessionKey({
    safeStorage: strictSafeStorage,
    filePath,
    randomBytes: () => Buffer.alloc(32, 7),
    warn: (message) => warnings.push(message),
  });

  assert.equal(firstKey.length, 64);
  assert.equal(warnings.length > 0, true);
  assert.equal(
    getOrCreateSessionKey({ safeStorage: strictSafeStorage, filePath, randomBytes: () => Buffer.alloc(32, 8) }),
    firstKey,
  );
});
