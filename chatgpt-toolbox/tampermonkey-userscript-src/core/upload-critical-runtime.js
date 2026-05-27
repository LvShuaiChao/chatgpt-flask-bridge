const UploadCriticalRuntime = (() => {
  const FLAG_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL__';
  const START_AT_KEY = '__CGPT_TOOLBOX_UPLOAD_RUN_STARTED_AT__';
  const TIMER_KEY = '__CGPT_TOOLBOX_UPLOAD_CRITICAL_TIMEOUT_TIMER__';
  const DEFAULT_TIMEOUT_MS = 120 * 1000;
  const TOAST_SCAN_STATE_KEY = '__CGPT_TOOLBOX_UPLOAD_TOAST_SCAN_STATE__';

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
    setUploadCriticalModeOn,
    clearUploadCriticalMode,
    getUploadCriticalStartedAt,
    detectChatGptUploadErrorToast,
  };
})();

