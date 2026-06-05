const SendTaskStore = (() => {
  const DEFAULT_STATE = Object.freeze({
    phase: 'idle',
    subPhase: '',
    action: '',
    runId: '',
    startedAt: 0,
    updatedAt: 0,
    reason: ''
  });

  let state = { ...DEFAULT_STATE };

  function normalizePhase(phase) {
    if (
      typeof ButtonTasks !== 'undefined'
      && ButtonTasks
      && typeof ButtonTasks.canonicalizeTaskPhaseInput === 'function'
    ) {
      return ButtonTasks.canonicalizeTaskPhaseInput(phase).phase;
    }
    const value = String(phase || '').trim().toLowerCase();
    if (
      value === 'idle'
      || value === 'waiting_send'
      || value === 'sending'
      || value === 'waiting_reply'
      || value === 'success'
      || value === 'failed'
      || value === 'cancelled'
    ) {
      return value;
    }
    console.error('[SEND_TASK_STORE][UNKNOWN_PHASE]', phase);
    return 'idle';
  }

  function getState() {
    return { ...state };
  }

  function setPhase(phase, reason = '', patch = {}) {
    const nextPhase = normalizePhase(phase);
    state = {
      ...state,
      ...patch,
      phase: nextPhase,
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
  window.SendTaskStore = SendTaskStore;
}
