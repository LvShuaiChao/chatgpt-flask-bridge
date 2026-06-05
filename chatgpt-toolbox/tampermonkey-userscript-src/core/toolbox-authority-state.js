const ToolboxAuthorityState = (() => {
  let cachedSnapshot = null;
  let cachedAt = 0;
  const CACHE_TTL_MS = 120;

  function nowMs() {
    return Date.now();
  }

  function invalidate(reason = '') {
    cachedSnapshot = null;
    cachedAt = 0;
    if (typeof appendLog === 'function') {
      appendLog(`[AUTHORITY_STATE][INVALIDATE] reason=${reason || '-'}`);
    }
  }

  function buildFallbackSnapshot(reason = '') {
    return {
      reason,
      replyState: 'unknown',
      taskState: 'unknown',
      ready: false,
      stopVisible: false,
      composer: {
        hasText: false,
        textSynced: false,
        sendReady: false,
        attachmentCount: 0,
        attachmentReady: false
      },
      upload: {
        running: false,
        pendingCount: 0
      },
      buttons: {
        canSend: false,
        canUpload: false,
        canCopyHotkey: false
      },
      createdAt: nowMs()
    };
  }

  function buildSnapshot(reason = '') {
    const snapshot = buildFallbackSnapshot(reason);
    if (
      typeof ToolboxHeaderStatus !== 'undefined'
      && ToolboxHeaderStatus
      && typeof ToolboxHeaderStatus.getStatusSnapshot === 'function'
    ) {
      const top = ToolboxHeaderStatus.getStatusSnapshot(reason);
      snapshot.topStatus = top;
    }
    return snapshot;
  }

  function getSnapshot(reason = '', options = {}) {
    const force = !!options.force;
    const now = nowMs();
    if (!force && cachedSnapshot && now - cachedAt <= CACHE_TTL_MS) {
      return cachedSnapshot;
    }
    cachedSnapshot = buildSnapshot(reason);
    cachedAt = now;
    return cachedSnapshot;
  }

  return {
    getSnapshot,
    invalidate
  };
})();

if (typeof window !== 'undefined') {
  window.ToolboxAuthorityState = ToolboxAuthorityState;
}
