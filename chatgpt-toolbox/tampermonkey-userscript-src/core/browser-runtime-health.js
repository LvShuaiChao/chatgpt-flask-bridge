/********************************************************************
 * 浏览器后台限速检测 + 前台恢复补偿
 ********************************************************************/

function buildBrowserRuntimeFields(reason = '-') {
  if (typeof BrowserRuntimeHealth !== 'undefined' && BrowserRuntimeHealth.getRuntimeState) {
    const rt = BrowserRuntimeHealth.getRuntimeState(reason);
    return {
      browser_hidden: rt.hidden ? 1 : 0,
      browser_visibility_state: rt.visibilityState || '-',
      browser_has_focus: rt.hasFocus ? 1 : 0,
      browser_timer_drift_ms: Math.round(rt.lastDriftMs || 0),
      browser_probably_throttled: BrowserRuntimeHealth.isProbablyThrottled() ? 1 : 0,
    };
  }

  const hasFocusFn = typeof document.hasFocus === 'function';
  return {
    browser_hidden: document.hidden ? 1 : 0,
    browser_visibility_state: document.visibilityState || '-',
    browser_has_focus: hasFocusFn ? (document.hasFocus() ? 1 : 0) : -1,
    browser_timer_drift_ms: 0,
    browser_probably_throttled: document.hidden ? 1 : 0,
  };
}

const BrowserRuntimeHealth = (() => {
  const state = {
    lastTickAt: Date.now(),
    lastDriftMs: 0,
    maxDriftMs: 0,
    throttled: false,
    timer: 0,
    started: false,
  };

  function getRuntimeState(reason = '-') {
    return {
      reason,
      hidden: !!document.hidden,
      visibilityState: document.visibilityState || '-',
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : false,
      lastDriftMs: Math.round(state.lastDriftMs || 0),
      maxDriftMs: Math.round(state.maxDriftMs || 0),
      throttled: !!state.throttled,
      now: Date.now(),
    };
  }

  function appendRuntimeLog(reason = '-') {
    const info = getRuntimeState(reason);
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(
        `[BROWSER_RUNTIME][STATE] reason=${info.reason} hidden=${info.hidden ? 1 : 0} visibility=${info.visibilityState} focus=${info.hasFocus ? 1 : 0} drift_ms=${info.lastDriftMs} max_drift_ms=${info.maxDriftMs} throttled=${info.throttled ? 1 : 0}`,
      );
    }
  }

  function onVisibilityChange() {
    appendRuntimeLog('visibilitychange');
    if (document.visibilityState === 'visible') {
      void forceForegroundCatchUp('visibility-visible');
    } else if (state.throttled || document.hidden) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.setStatus) {
        ToolboxShell.setStatus('页面后台限速中，等待恢复可见后继续', 'warning');
      }
    }
  }

  function onWindowFocus() {
    appendRuntimeLog('window-focus');
    void forceForegroundCatchUp('window-focus');
  }

  function onPageShow() {
    appendRuntimeLog('pageshow');
    void forceForegroundCatchUp('pageshow');
  }

  function start() {
    if (state.started) {
      return;
    }
    state.started = true;
    state.lastTickAt = Date.now();

    state.timer = window.setInterval(() => {
      const now = Date.now();
      const drift = now - state.lastTickAt - 1000;
      state.lastTickAt = now;

      state.lastDriftMs = drift;
      state.maxDriftMs = Math.max(state.maxDriftMs || 0, drift);

      const nextThrottled = document.hidden || drift > 3000;

      if (nextThrottled !== state.throttled) {
        state.throttled = nextThrottled;
        appendRuntimeLog(nextThrottled ? 'throttled-on' : 'throttled-off');

        if (nextThrottled) {
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.setStatus) {
            ToolboxShell.setStatus('页面后台限速中，恢复可见后继续', 'warning');
          }
        }
      }
    }, 1000);

    document.addEventListener('visibilitychange', onVisibilityChange, true);
    window.addEventListener('focus', onWindowFocus, true);
    window.addEventListener('pageshow', onPageShow, true);

    appendRuntimeLog('start');
  }

  function isProbablyThrottled() {
    return !!state.throttled || !!document.hidden || state.lastDriftMs > 3000;
  }

  return {
    start,
    getRuntimeState,
    appendRuntimeLog,
    isProbablyThrottled,
  };
})();

async function forceForegroundCatchUp(reason = '-') {
  const catchReason = String(reason || '-').trim() || '-';

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[FOREGROUND_CATCH_UP][START] reason=${catchReason}`);
  }

  try {
    if (typeof refreshToolboxPageStatusDisplay === 'function') {
      refreshToolboxPageStatusDisplay(`foreground-catch-up:${catchReason}`);
    }

    if (typeof updateChatInputStateBadge === 'function') {
      updateChatInputStateBadge();
    }

    if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getPageCapability === 'function') {
      const cap = ComposerApi.getPageCapability(`foreground-catch-up:${catchReason}`);
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[FOREGROUND_CATCH_UP][CAPABILITY] reason=${catchReason} inputable=${cap && cap.inputable ? 1 : 0} sendable=${cap && cap.sendable ? 1 : 0} response_state=${cap && cap.response_state ? cap.response_state : '-'}`,
        );
      }
    }

    if (typeof BridgeModule !== 'undefined' && typeof BridgeModule.forceCatchUp === 'function') {
      BridgeModule.forceCatchUp(`foreground-catch-up:${catchReason}`);
    }

    if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.resumeAfterForeground === 'function') {
      await AutoQueueModule.resumeAfterForeground(`foreground-catch-up:${catchReason}`);
    }

    if (typeof UploadModule !== 'undefined' && typeof UploadModule.resumeAfterForeground === 'function') {
      await UploadModule.resumeAfterForeground(`foreground-catch-up:${catchReason}`);
    }

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[FOREGROUND_CATCH_UP][DONE] reason=${catchReason}`);
    }
  } catch (error) {
    console.error('[FOREGROUND_CATCH_UP][FAILED]', error);
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(
        `[FOREGROUND_CATCH_UP][FAILED] reason=${catchReason} type=${error && error.name ? error.name : 'Error'} error=${error && error.message ? error.message : String(error)}`,
      );
    }
  }
}
