const ClosedLoopScheduler = (() => {
  let nextStepTimer = null;
  let retryTimer = null;

  function clear(reason = '') {
    if (nextStepTimer) {
      clearTimeout(nextStepTimer);
      nextStepTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (typeof appendLog === 'function') {
      appendLog(`[CLOSED_LOOP_SCHEDULER][CLEAR] reason=${reason || '-'}`);
    }
  }

  function scheduleNextStep(callback, delayMs, reason = '') {
    clear('schedule_next_step');
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    nextStepTimer = setTimeout(() => {
      nextStepTimer = null;
      callback();
    }, safeDelay);
    return {
      ok: true,
      delayMs: safeDelay,
      reason
    };
  }

  return {
    clear,
    scheduleNextStep
  };
})();

if (typeof window !== 'undefined') {
  window.ClosedLoopScheduler = ClosedLoopScheduler;
}


