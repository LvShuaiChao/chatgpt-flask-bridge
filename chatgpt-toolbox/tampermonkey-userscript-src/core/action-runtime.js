const ActionRuntime = (() => {
  const debounceMap = new Map();
  const locks = Object.create(null);

  function shouldSkipAction(key, windowMs = 300) {
    const actionKey = String(key || '').trim();
    if (!actionKey) {
      return false;
    }

    const now = Date.now();
    const last = debounceMap.get(actionKey) || 0;
    if (now - last < Number(windowMs || 300)) {
      return true;
    }

    debounceMap.set(actionKey, now);
    return false;
  }

  function claimActionLock(key, options = {}) {
    const lockKey = String(key || '').trim();
    if (!lockKey) {
      return {
        ok: false,
        reason: 'empty-lock-key',
      };
    }

    const timeoutMs = Number(options.timeoutMs || 90000);
    const now = Date.now();
    const current = locks[lockKey];

    if (current && current.running) {
      const runningMs = now - Number(current.startedAt || 0);
      const forceRelease = options.forceRelease === true;

      if (runningMs <= timeoutMs && !forceRelease) {
        return {
          ok: false,
          reason: 'task-running',
          runningMs,
        };
      }

      const releaseTag = forceRelease ? 'FORCE_RELEASE' : 'STALE_RELEASE';
      const line = `[UPLOAD_ACTION_LOCK][${releaseTag}] key=${lockKey} runningMs=${runningMs}`;
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.warn(line);
      }
    }

    locks[lockKey] = {
      running: true,
      startedAt: now,
    };

    return {
      ok: true,
      reason: 'claimed',
      startedAt: now,
    };
  }

  function releaseActionLock(key) {
    const lockKey = String(key || '').trim();
    if (!lockKey) {
      return;
    }

    locks[lockKey] = {
      running: false,
      startedAt: 0,
    };
  }

  function isActionLocked(key) {
    const lockKey = String(key || '').trim();
    return !!(lockKey && locks[lockKey] && locks[lockKey].running);
  }

  return {
    shouldSkipAction,
    claimActionLock,
    releaseActionLock,
    isActionLocked,
  };
})();

