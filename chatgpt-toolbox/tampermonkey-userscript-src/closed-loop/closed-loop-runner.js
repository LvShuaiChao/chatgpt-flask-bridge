const ClosedLoopRunner = (() => {
  async function start(options = {}) {
    const runId = options.runId || `closed-loop-${Date.now()}`;
    ClosedLoopState.patch({
      running: true,
      phase: 'starting',
      runId,
      mode: options.mode || '',
      action: options.action || '',
      round: 1,
      startedAt: Date.now()
    }, options.source || 'start');
    return {
      ok: true,
      runId
    };
  }

  function stop(reason = 'manual-stop') {
    ClosedLoopScheduler.clear(reason);
    ClosedLoopState.reset(reason);
    return {
      ok: true,
      reason
    };
  }

  function getState() {
    return ClosedLoopState.getState();
  }

  return {
    start,
    stop,
    getState
  };
})();

if (typeof window !== 'undefined') {
  window.ClosedLoopRunner = ClosedLoopRunner;
}
