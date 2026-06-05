const UploadCriticalRuntime = (() => {
  const FLAG_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL__';
  const LIGHT_MODE_KEY = '__cgptUploadLightMode';
  const START_AT_KEY = '__CGPT_TOOLBOX_UPLOAD_RUN_STARTED_AT__';
  const TIMER_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL_TIMEOUT_TIMER__';
  const PERF_STATS_KEY = '__CGPT_UPLOAD_PERF_STATS__';
  const LOG_THROTTLE_KEY = '__CGPT_UPLOAD_LOG_THROTTLE__';
  const DEFAULT_TIMEOUT_MS = 120 * 1000;
  const TOAST_SCAN_STATE_KEY = '__CGPT_TOOLBOX_UPLOAD_TOAST_SCAN_STATE__';
  const UPLOAD_ACTIVE_PHASES = new Set(['uploading', 'preparing', 'verifying', 'cancelling']);

  function getWindowRef() {
    try {
      return typeof window !== 'undefined' ? window : null;
    } catch (err) {
      console.error('[ChatGPT toolbox] UploadCriticalRuntime getWindowRef failed', err);
      return null;
    }
  }

  function createEmptyPerfStats() {
    return {
      startedAt: 0,
      attachmentScanCount: 0,
      renderCount: 0,
      statusUpdateCount: 0,
      logCount: 0,
      autoqDeferredCount: 0,
      skippedLogs: 0,
      maxScanCostMs: 0,
      maxRenderCostMs: 0,
    };
  }

  function getUploadPerfStats() {
    const win = getWindowRef();
    if (!win) {
      return createEmptyPerfStats();
    }
    if (!win[PERF_STATS_KEY] || typeof win[PERF_STATS_KEY] !== 'object') {
      win[PERF_STATS_KEY] = createEmptyPerfStats();
    }
    return win[PERF_STATS_KEY];
  }

  function resetUploadPerfStats() {
    const win = getWindowRef();
    if (!win) {
      return;
    }
    win[PERF_STATS_KEY] = createEmptyPerfStats();
    win[PERF_STATS_KEY].startedAt = Date.now();
  }

  function bumpUploadPerfCounter(name, delta = 1) {
    const stats = getUploadPerfStats();
    const key = String(name || '').trim();
    if (!key) {
      return;
    }
    const inc = Math.max(0, Number(delta) || 0) || 1;
    if (Object.prototype.hasOwnProperty.call(stats, key)) {
      stats[key] = Math.max(0, Number(stats[key]) || 0) + inc;
    }
  }

  function recordUploadPerfBlock(action, costMs) {
    const stats = getUploadPerfStats();
    const cost = Math.max(0, Number(costMs) || 0);
    const actionText = String(action || '').trim() || 'unknown';
    if (actionText.includes('scan') || actionText.includes('attachment')) {
      stats.attachmentScanCount = Math.max(0, Number(stats.attachmentScanCount) || 0) + 1;
      stats.maxScanCostMs = Math.max(Number(stats.maxScanCostMs) || 0, cost);
    }
    if (actionText.includes('render')) {
      stats.renderCount = Math.max(0, Number(stats.renderCount) || 0) + 1;
      stats.maxRenderCostMs = Math.max(Number(stats.maxRenderCostMs) || 0, cost);
    }
    if (actionText.includes('status')) {
      stats.statusUpdateCount = Math.max(0, Number(stats.statusUpdateCount) || 0) + 1;
    }
    if (cost > 50 && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[PERF][UPLOAD_MAIN_THREAD_BLOCK] action=${actionText} costMs=${cost.toFixed(1)}`,
      );
    }
  }

  function emitUploadPerfSummary(reason = '') {
    const stats = getUploadPerfStats();
    const startedAt = Number(stats.startedAt) || 0;
    const costMs = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[UPLOAD_PERF][SUMMARY] reason=${String(reason || '-')} costMs=${costMs} `
        + `verifyCount=${Number(stats.verifyCount) || 0} renderCount=${Number(stats.renderCount) || 0} `
        + `attachmentScanCount=${Number(stats.attachmentScanCount) || 0} statusUpdateCount=${Number(stats.statusUpdateCount) || 0} `
        + `autoqDeferredCount=${Number(stats.autoqDeferredCount) || 0} skippedLogs=${Number(stats.skippedLogs) || 0} `
        + `maxScanCostMs=${Number(stats.maxScanCostMs) || 0} maxRenderCostMs=${Number(stats.maxRenderCostMs) || 0}`,
      );
    }
    const win = getWindowRef();
    if (win) {
      win[PERF_STATS_KEY] = createEmptyPerfStats();
    }
  }

  function logUploadTagThrottled(tag, message, intervalMs = 1000) {
    const win = getWindowRef();
    const safeTag = String(tag || '').trim() || '-';
    const safeMessage = String(message || '').trim();
    const minInterval = Math.max(200, Number(intervalMs) || 1000);
    const now = Date.now();
    if (win) {
      if (!win[LOG_THROTTLE_KEY] || typeof win[LOG_THROTTLE_KEY] !== 'object') {
        win[LOG_THROTTLE_KEY] = {};
      }
      const lastAt = Number(win[LOG_THROTTLE_KEY][safeTag]) || 0;
      if (lastAt && now - lastAt < minInterval) {
        bumpUploadPerfCounter('skippedLogs');
        return false;
      }
      win[LOG_THROTTLE_KEY][safeTag] = now;
    }
    bumpUploadPerfCounter('logCount');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(safeMessage);
      return true;
    }
    console.log(safeMessage);
    return true;
  }

  function isUploadLightMode() {
    try {
      const win = getWindowRef();
      return !!(win && win[LIGHT_MODE_KEY] === true);
    } catch (err) {
      console.error('[ChatGPT toolbox] isUploadLightMode failed', err);
      return false;
    }
  }

  function setUploadLightModeOn(reason = 'upload-start') {
    const wasOn = isUploadLightMode();
    const win = getWindowRef();
    if (win) {
      win[LIGHT_MODE_KEY] = true;
    }
    if (!wasOn) {
      resetUploadPerfStats();
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[UPLOAD_LIGHT][ON] reason=${reason || '-'}`);
      }
    }
  }

  function clearUploadLightMode(reason = '') {
    const wasOn = isUploadLightMode();
    const win = getWindowRef();
    if (win) {
      win[LIGHT_MODE_KEY] = false;
    }
    if (wasOn) {
      emitUploadPerfSummary(reason || 'upload-light-off');
    }
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[UPLOAD_LIGHT][OFF] reason=${reason || '-'}`);
    }
  }

  function resolveUploadTaskPhaseFromModule() {
    try {
      if (
        typeof UploadModule !== 'undefined'
        && UploadModule
        && typeof UploadModule.getUploadTaskState === 'function'
      ) {
        const task = UploadModule.getUploadTaskState() || {};
        return String(task.phase || '').trim().toLowerCase();
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] resolveUploadTaskPhaseFromModule failed', err);
    }
    return '';
  }

  function isUploadInProgress() {
    if (isUploadCriticalMode() || isUploadLightMode()) {
      return true;
    }
    const uploadPhase = resolveUploadTaskPhaseFromModule();
    if (uploadPhase && UPLOAD_ACTIVE_PHASES.has(uploadPhase)) {
      return true;
    }
    try {
      if (
        typeof AutoQueueModule !== 'undefined'
        && AutoQueueModule
        && typeof AutoQueueModule.getState === 'function'
      ) {
        const autoState = AutoQueueModule.getState() || {};
        if (autoState.manualUploadRunning === true || autoState.batchAutoUploading === true) {
          return true;
        }
        const autoPhase = String(autoState.phase || '').trim().toLowerCase();
        if (autoPhase === 'uploading') {
          return true;
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] isUploadInProgress autoq check failed', err);
    }
    return false;
  }

  function isUploadCriticalMode() {
    try {
      return typeof window !== 'undefined' && window[FLAG_KEY] === true;
    } catch (err) {
      console.error('[ChatGPT toolbox] isUploadCriticalMode failed', err);
      return false;
    }
  }

  function setUploadCriticalModeOn(reason = 'upload-start') {
    try {
      setUploadLightModeOn(reason);
      if (typeof window !== 'undefined') {
        window[FLAG_KEY] = true;
        window[START_AT_KEY] = Date.now();
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[UPLOAD_CRITICAL][ON] reason=${reason || '-'}`);
      }

      // 兜底：critical mode 超时自动退出，避免其他按钮长期冻结。
      try {
        if (typeof window !== 'undefined') {
          const startedAt = Number(window[START_AT_KEY]) || Date.now();
          if (window[TIMER_KEY]) {
            clearTimeout(window[TIMER_KEY]);
          }
          window[TIMER_KEY] = setTimeout(() => {
            try {
              const stillOn = window[FLAG_KEY] === true;
              const nowStartedAt = Number(window[START_AT_KEY]) || 0;
              if (stillOn && nowStartedAt === startedAt) {
                console.error('[ChatGPT toolbox] UploadCriticalRuntime timeout auto-clear', { reason, startedAt });
                if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
                  ToolboxShell.appendLog(`[UPLOAD_CRITICAL][TIMEOUT_AUTO_CLEAR] reason=${reason || '-'} startedAt=${startedAt}`);
                }
                window[FLAG_KEY] = false;
                window[START_AT_KEY] = 0;
                if (
                  typeof UploadModule !== 'undefined'
                  && UploadModule
                  && typeof UploadModule.renderUploadButtonsOnly === 'function'
                ) {
                  UploadModule.renderUploadButtonsOnly({
                    heavy: false,
                    skipCapabilityScan: true,
                    scope: 'upload-only',
                    buttonTasksReason: 'upload-critical-timeout-auto-clear',
                  });
                }
              }
            } catch (innerErr) {
              console.error('[ChatGPT toolbox] UploadCriticalRuntime timeout handler failed', innerErr);
              if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
                ToolboxShell.appendLog(`[UPLOAD_CRITICAL][TIMEOUT_HANDLER_ERROR] reason=${reason || '-'} err=${innerErr && innerErr.message ? innerErr.message : innerErr}`);
              }
            }
          }, DEFAULT_TIMEOUT_MS);
        }
      } catch (timerErr) {
        console.error('[ChatGPT toolbox] setUploadCriticalModeOn schedule timeout failed', timerErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[UPLOAD_CRITICAL][ERROR] schedule_timeout reason=${reason || '-'} err=${timerErr && timerErr.message ? timerErr.message : timerErr}`);
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] setUploadCriticalModeOn failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[UPLOAD_CRITICAL][ERROR] on reason=${reason || '-'} err=${err && err.message ? err.message : err}`);
      }
    }
  }

  function clearUploadCriticalMode(reason = '') {
    try {
      clearUploadLightMode(reason);
      if (typeof window !== 'undefined') {
        window[FLAG_KEY] = false;
        window[START_AT_KEY] = 0;
        if (window[TIMER_KEY]) {
          clearTimeout(window[TIMER_KEY]);
          window[TIMER_KEY] = 0;
        }
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[UPLOAD_CRITICAL][OFF] reason=${reason || '-'}`);
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] clearUploadCriticalMode failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[UPLOAD_CRITICAL][ERROR] off reason=${reason || '-'} err=${err && err.message ? err.message : err}`);
      }
    }
  }

  function getUploadCriticalStartedAt() {
    try {
      if (typeof window === 'undefined') {
        return 0;
      }
      return Number(window[START_AT_KEY] || 0) || 0;
    } catch (err) {
      console.error('[ChatGPT toolbox] getUploadCriticalStartedAt failed', err);
      return 0;
    }
  }

  function detectChatGptUploadErrorToast(options = {}) {
    const minIntervalMs = Math.max(800, Number(options.minIntervalMs) || 800);
    const now = Date.now();

    try {
      if (typeof window !== 'undefined') {
        if (!window[TOAST_SCAN_STATE_KEY]) {
          window[TOAST_SCAN_STATE_KEY] = {
            lastAt: 0,
            lastOk: false,
            lastReason: '',
            lastMessage: '',
          };
        }

        const state = window[TOAST_SCAN_STATE_KEY];
        if (state.lastAt && now - state.lastAt < minIntervalMs) {
          return {
            ok: !!state.lastOk,
            reason: String(state.lastReason || ''),
            message: String(state.lastMessage || ''),
          };
        }

        state.lastAt = now;
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] detectChatGptUploadErrorToast init throttle failed', err);
    }

    const patterns = [
      '上传到 files.oaiusercontent.com 失败',
      'files.oaiusercontent.com',
      'Failed to upload to files.oaiusercontent.com',
      'Upload failed',
    ];

    const selectors = [
      '[role="alert"]',
      '[data-testid*="toast"]',
      '[data-testid*="upload-error"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
    ].join(', ');

    const matches = (text) => {
      const hay = String(text || '');
      if (!hay) return '';
      for (const p of patterns) {
        if (hay.includes(p)) return p;
      }
      return '';
    };

    let hit = '';
    let message = '';

    try {
      const nodes = typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll(selectors))
        : [];

      for (const el of nodes) {
        if (!(el instanceof HTMLElement)) continue;
        const text = String(el.innerText || el.textContent || '');
        hit = matches(text);
        if (hit) {
          message = hit;
          break;
        }
        const aria = String(el.getAttribute('aria-label') || '');
        hit = matches(aria);
        if (hit) {
          message = hit;
          break;
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] detectChatGptUploadErrorToast scan toast nodes failed', err);
    }

    // document.body.innerText is expensive on ChatGPT; only scan it when explicitly requested.
    if (!hit) {
      try {
        const allowBodyScan = options.allowBodyScan === true;
        if (allowBodyScan && typeof document !== 'undefined' && document.body) {
          const text = String(document.body.innerText || '').slice(0, 200000);
          hit = matches(text);
          if (hit) {
            message = hit;
          }
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] detectChatGptUploadErrorToast body scan failed', err);
      }
    }

    const result = hit
      ? {
          ok: true,
          reason: 'files-oaiusercontent-upload-failed',
          message: message || 'files.oaiusercontent.com',
        }
      : {
          ok: false,
          reason: '',
          message: '',
        };

    try {
      if (typeof window !== 'undefined' && window[TOAST_SCAN_STATE_KEY]) {
        window[TOAST_SCAN_STATE_KEY].lastOk = result.ok;
        window[TOAST_SCAN_STATE_KEY].lastReason = result.reason;
        window[TOAST_SCAN_STATE_KEY].lastMessage = result.message;
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] detectChatGptUploadErrorToast cache failed', err);
    }

    return result;
  }

  return {
    isUploadCriticalMode,
    isUploadLightMode,
    isUploadInProgress,
    setUploadLightModeOn,
    clearUploadLightMode,
    setUploadCriticalModeOn,
    clearUploadCriticalMode,
    getUploadCriticalStartedAt,
    detectChatGptUploadErrorToast,
    bumpUploadPerfCounter,
    recordUploadPerfBlock,
    emitUploadPerfSummary,
    logUploadTagThrottled,
    getUploadPerfStats,
  };
})();



