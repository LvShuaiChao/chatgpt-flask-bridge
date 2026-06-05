const UploadTaskStore = (() => {
  let state = {
    phase: 'idle',
    runId: '',
    source: '',
    startedAt: 0,
    updatedAt: 0,
    reason: ''
  };

  function getState() {
    return { ...state };
  }

  function setPhase(phase, reason = '', patch = {}) {
    state = {
      ...state,
      ...patch,
      phase: String(phase || 'idle'),
      reason,
      updatedAt: Date.now()
    };
    return getState();
  }

  function reset(reason = '') {
    state = {
      phase: 'idle',
      runId: '',
      source: '',
      startedAt: 0,
      updatedAt: Date.now(),
      reason
    };
    return getState();
  }

  function isRunning() {
    return !['idle', 'success', 'failed', 'cancelled'].includes(state.phase);
  }

  return {
    getState,
    setPhase,
    reset,
    isRunning
  };
})();

if (typeof window !== 'undefined') {
  window.UploadTaskStore = UploadTaskStore;
}
