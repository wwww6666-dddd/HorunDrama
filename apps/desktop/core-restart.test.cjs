const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreRestartState, getCoreRestartDelay } = require('./core-restart.cjs');

test('core restart state starts with defined shutdown and timer fields', () => {
  assert.deepEqual(createCoreRestartState(), {
    isShuttingDown: false,
    attempts: 0,
    timer: null,
    inProgress: false,
  });
});

test('core restart policy allows three bounded retries', () => {
  assert.equal(getCoreRestartDelay(0, false), 500);
  assert.equal(getCoreRestartDelay(1, false), 1500);
  assert.equal(getCoreRestartDelay(2, false), 4000);
  assert.equal(getCoreRestartDelay(3, false), null);
});

test('core restart policy stops when app shutdown has started', () => {
  assert.equal(getCoreRestartDelay(0, true), null);
});
