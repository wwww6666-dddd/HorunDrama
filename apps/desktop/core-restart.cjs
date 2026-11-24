const CORE_RESTART_DELAYS_MS = [500, 1500, 4000];

function createCoreRestartState() {
  return { isShuttingDown: false, attempts: 0, timer: null, inProgress: false };
}

function getCoreRestartDelay(attempts, isShuttingDown) {
  if (isShuttingDown || !Number.isInteger(attempts) || attempts < 0) return null;
  return CORE_RESTART_DELAYS_MS[attempts] ?? null;
}

module.exports = { createCoreRestartState, getCoreRestartDelay };
