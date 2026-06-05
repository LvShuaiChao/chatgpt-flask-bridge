const ClosedLoopVerifier = (() => {
  function hasStopSignal(text) {
    if (
      typeof DoneSignal !== 'undefined'
      && DoneSignal
      && typeof DoneSignal.hasDoneSignal === 'function'
    ) {
      return DoneSignal.hasDoneSignal(text);
    }
    return String(text || '').includes('<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>');
  }

  return {
    hasStopSignal
  };
})();

if (typeof window !== 'undefined') {
  window.ClosedLoopVerifier = ClosedLoopVerifier;
}
