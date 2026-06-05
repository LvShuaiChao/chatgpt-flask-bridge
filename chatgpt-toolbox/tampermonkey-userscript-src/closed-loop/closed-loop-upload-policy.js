const ClosedLoopUploadPolicy = (() => {
  function shouldUploadBeforeRound(round, options = {}) {
    const interval = Math.max(1, Number(options.interval || 5) || 5);
    const n = Math.max(1, Number(round) || 1);
    if (n === 1) {
      return true;
    }
    return n % interval === 0;
  }

  return {
    shouldUploadBeforeRound
  };
})();

if (typeof window !== 'undefined') {
  window.ClosedLoopUploadPolicy = ClosedLoopUploadPolicy;
}
