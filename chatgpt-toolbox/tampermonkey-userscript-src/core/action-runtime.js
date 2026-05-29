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

  function normalizeLockOwner(owner) {
    if (!owner || typeof owner !== 'object') {
      return {
        taskId: '',
        runId: '',
        source: '',
      };
    }
    return {
      taskId: String(owner.taskId || '').trim(),
      runId: String(owner.runId || '').trim(),
      source: String(owner.source || '').trim(),
    };
  }

  function isAutoQueueLockSource(source) {
    const text = String(source || '');
    return (
      text.startsWith('autoq:')
      || text.startsWith('autoq-task-')
      || text.includes('autoq:send-existing')
    );
  }

  function isSameActionLockOwner(lockOwner, incomingOwner) {
    const lock = normalizeLockOwner(lockOwner);
    const incoming = normalizeLockOwner(incomingOwner);
    if (!lock.taskId && !lock.runId && !lock.source) {
      return false;
    }
    if (lock.taskId && incoming.taskId && lock.taskId === incoming.taskId) {
      if (isAutoQueueLockSource(lock.source) || isAutoQueueLockSource(incoming.source)) {
        return true;
      }
    }
    if (
      lock.runId
      && incoming.runId
      && lock.runId === incoming.runId
      && lock.source
      && incoming.source
      && lock.source === incoming.source
    ) {
      return true;
    }
    if (lock.source && incoming.source && lock.source === incoming.source) {
      return true;
    }
    return false;
  }

  function getActionLockOwner(key) {
    const lockKey = String(key || '').trim();
    if (!lockKey || !locks[lockKey]) {
      return normalizeLockOwner(null);
    }
    return normalizeLockOwner(locks[lockKey].owner);
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
    const incomingOwner = normalizeLockOwner({
      taskId: options.taskId,
      runId: options.runId,
      source: options.source,
    });

    if (current && current.running) {
      const runningMs = now - Number(current.startedAt || 0);
      const forceRelease = options.forceRelease === true;
      const lockOwner = normalizeLockOwner(current.owner);

      if (isSameActionLockOwner(lockOwner, incomingOwner)) {
        return {
          ok: true,
          reason: 'same-owner-reuse',
          runningMs,
          reentrant: true,
          lockOwner,
        };
      }

      if (runningMs <= timeoutMs && !forceRelease) {
        return {
          ok: false,
          reason: 'task-running',
          runningMs,
          lockOwner,
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
      owner: incomingOwner,
    };

    return {
      ok: true,
      reason: 'claimed',
      startedAt: now,
      lockOwner: incomingOwner,
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
    getActionLockOwner,
    isSameActionLockOwner,
  };
})();

