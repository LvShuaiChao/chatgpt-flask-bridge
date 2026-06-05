const ClosedLoopState = (() => {
  const DEFAULT_STATE = Object.freeze({
    running: false,
    phase: 'idle',
    mode: '',
    action: '',
    runId: '',
    round: 0,
    startedAt: 0,
    updatedAt: 0,
    reason: ''
  });

  let state = { ...DEFAULT_STATE };

  function getState() {
    return { ...state };
  }

  function patch(patchValue = {}, reason = '') {
    state = {
      ...state,
      ...patchValue,
      reason,
      updatedAt: Date.now()
    };
    return getState();
  }

  function reset(reason = '') {
    state = {
      ...DEFAULT_STATE,
      reason,
      updatedAt: Date.now()
    };
    return getState();
  }

  function isRunning() {
    return !!state.running;
  }

  return {
    getState,
    patch,
    reset,
    isRunning
  };
})();

if (typeof window !== 'undefined') {
  window.ClosedLoopState = ClosedLoopState;
}
