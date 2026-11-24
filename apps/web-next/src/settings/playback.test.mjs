import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizePlaybackRate, readPlaybackRate, writePlaybackRate } from './playback.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

test('normalizes playback rates and rejects non-finite values', () => {
  assert.equal(normalizePlaybackRate(2), 2);
  assert.equal(normalizePlaybackRate('1.5'), 1.5);
  assert.equal(normalizePlaybackRate(Number.NaN), 1);
  assert.equal(normalizePlaybackRate(0.1), 0.5);
  assert.equal(normalizePlaybackRate(99), 4);
});

test('round-trips the last rate through local storage', () => {
  memory.clear();
  assert.equal(readPlaybackRate(), null);
  assert.equal(writePlaybackRate(2), 2);
  assert.equal(readPlaybackRate(), 2);
  assert.equal(writePlaybackRate(1.25), 1.25);
  assert.equal(readPlaybackRate(), 1.25);
});

test('ignores malformed local storage instead of poisoning playback', () => {
  memory.clear();
  memory.set('horun-playback-rate', 'not-a-rate');
  assert.equal(readPlaybackRate(), null);
  memory.set('horun-playback-rate', 'Infinity');
  assert.equal(readPlaybackRate(), null);
});

test('player source has the cross-episode rate restoration hooks', () => {
  const player = readFileSync(join(repo, 'apps', 'web-next', 'src', 'ui', 'XgPlayer.tsx'), 'utf8');
  assert.match(player, /player\.on\('ratechange'/);
  assert.match(player, /media\.defaultPlaybackRate/);
  assert.match(player, /media\.playbackRate/);
  assert.match(player, /onRate\?\.\(next\)/);
  assert.match(player, /media\.src = url/);
});
