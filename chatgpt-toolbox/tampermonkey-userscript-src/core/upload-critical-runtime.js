const UploadCriticalRuntime = (() => {
  const FLAG_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL__';
  const START_AT_KEY = '__CGPT_TOOLBOX_UPLOAD_RUN_STARTED_AT__';
  const TIMER_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL_TIMEOUT_TIMER__';
  const DEFAULT_TIMEOUT_MS = 120 * 1000;

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
                if (typeof renderAllButtonStates === 'function') {
                  renderAllButtonStates({ heavy: false, reason: 'upload-critical-timeout-auto-clear' });
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

  return {
    isUploadCriticalMode,
    setUploadCriticalModeOn,
    clearUploadCriticalMode,
    getUploadCriticalStartedAt,
  };
})();

