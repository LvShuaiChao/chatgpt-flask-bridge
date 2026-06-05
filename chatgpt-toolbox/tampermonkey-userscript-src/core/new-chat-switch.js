/********************************************************************
 * Unified new-chat / “回到首页” navigation
 *
 * Shared by AutoQueue (task advance + page-turn rotate) and UploadModule.
 ********************************************************************/

function getCurrentConversationKeyUnified() {
  try {
    const url = new URL(window.location.href);
    const match = url.pathname.match(/\/c\/([^/]+)/);
    if (match) {
      return `conversation:${match[1]}`;
    }
    return `path:${url.pathname}${url.search}`;
  } catch (err) {
    console.error('[NEW_CHAT] getCurrentConversationKeyUnified failed', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    try {
      return `path:${window.location.pathname}${window.location.search}`;
    } catch (_) {
      return 'path:';
    }
  }
}

function findNewChatButtonUnified() {
  const candidates = [];

  const selectors = [
    'a[href="/"]',
    'a[href="/?"]',
    'a[href^="/?"]',
    'a[aria-label*="新聊天"]',
    'button[aria-label*="新聊天"]',
    'a[aria-label*="New chat"]',
    'button[aria-label*="New chat"]',
    '[data-testid*="new-chat"]',
    '[data-testid*="new-chat-button"]',
    'a[data-testid="create-new-chat-button"]',
    '[data-testid="create-new-chat-button"]',
    '[data-sidebar-action="new-chat"]',
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => candidates.push(el));
  });

  document.querySelectorAll('a, button, [role="button"]').forEach((el) => {
    const text = String(el.textContent || '').trim();
    const aria = String(el.getAttribute('aria-label') || '').trim();
    const title = String(el.getAttribute('title') || '').trim();
    const merged = `${text} ${aria} ${title}`;

    if (merged.includes('新聊天') || merged.includes('New chat')) {
      candidates.push(el);
    }
  });

  const unique = Array.from(new Set(candidates));

  for (const el of unique) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (el.closest('#cgpt-toolbox-root')) {
      continue;
    }
    if (el.closest('[id*="cgpt"]')) {
      continue;
    }
    if (el.closest('[class*="toolbox"]')) {
      continue;
    }
    if (el.id === 'cgpt-open-chatgpt-home') {
      continue;
    }

    const elId = String(el.id || '');
    if (elId.includes('cgpt')) {
      continue;
    }

    const text = String(el.textContent || '').trim();
    const aria = String(el.getAttribute('aria-label') || '').trim();
    const title = String(el.getAttribute('title') || '').trim();
    const merged = `${text} ${aria} ${title}`;
    if (text === '回到首页' || merged.includes('回到首页')) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    if (style.display === 'none' || style.visibility === 'hidden') {
      continue;
    }
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    return el;
  }

  return null;
}

function clickElementLikeUserUnified(el, reason) {
  const reasonText = reason || '-';

  if (!(el instanceof HTMLElement)) {
    throw new Error('new_chat_click_target_not_html_element');
  }

  const anchor = el instanceof HTMLAnchorElement
    ? el
    : (
      typeof el.closest === 'function'
        ? el.closest('a')
        : null
    );

  if (anchor instanceof HTMLAnchorElement) {
    try {
      anchor.setAttribute('target', '_self');
      anchor.removeAttribute('rel');
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[NEW_CHAT][FORCE_SAME_TAB] reason=${reasonText} href=${anchor.getAttribute('href') || '-'} target=_self`,
        );
      }
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[NEW_CHAT][FORCE_SAME_TAB_FAILED]', {
        reason: reasonText,
        error_type: error && error.name,
        error: errText,
        stack: error && error.stack,
      });
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[NEW_CHAT][FORCE_SAME_TAB_FAILED] reason=${reasonText} error=${errText}`,
        );
      }
    }
  }

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('new_chat_click_target_not_visible');
  }

  if (typeof clickElementWithFallback === 'function') {
    const clickResult = clickElementWithFallback(el, {
      source: `new-chat:${reasonText}`,
      scrollIntoView: true,
      focus: true,
    });
    return {
      ok: !!(clickResult && clickResult.ok),
      method: clickResult && clickResult.method ? clickResult.method : '',
      reason: clickResult && clickResult.reason ? clickResult.reason : '',
    };
  }

  console.error('[NEW_CHAT] clickElementWithFallback missing');
  return { ok: false, method: '', reason: 'clickElementWithFallback_missing' };
}

/**
 * @param {string} reason
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {string|false|null} [options.statusOnReady] — undefined: default toolbox message; null/false: skip
 * @param {string|false|null} [options.statusOnTimeout] — undefined: default timeout message; null/false: skip
 */
async function switchToNewChatUnified(reason, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const reasonText = reason || 'new-chat';

  if (
    typeof AutoQueueModule !== 'undefined'
    && AutoQueueModule
    && typeof AutoQueueModule.blockNavigationDuringTerminalConfirm === 'function'
    && AutoQueueModule.blockNavigationDuringTerminalConfirm('switchToNewChatUnified:' + reasonText)
  ) {
    return {
      ok: false,
      reason: 'terminal-confirming',
    };
  }

  if (
    typeof AutoQueueModule !== 'undefined'
    && AutoQueueModule
    && typeof AutoQueueModule.blockNavigationDuringWaitingReply === 'function'
    && AutoQueueModule.blockNavigationDuringWaitingReply('switchToNewChatUnified:' + reasonText, opts)
  ) {
    if (
      typeof AutoQueueModule.appendAutoQueueLog === 'function'
    ) {
      AutoQueueModule.appendAutoQueueLog(
        `[AUTOQ][NEW_CHAT_BLOCKED_WAITING_REPLY] source=${reasonText}`,
      );
    }
    return {
      ok: false,
      reason: 'blocked-waiting-reply',
    };
  }

  if (
    !opts.afterTaskCompleted
    && !opts.forceByUserStop
    && !opts.afterFailureSkip
    && !opts.userConfirmed
    && typeof AutoQueueModule !== 'undefined'
    && AutoQueueModule
    && typeof AutoQueueModule.isAutoQueueWaitingReply === 'function'
    && AutoQueueModule.isAutoQueueWaitingReply()
  ) {
    if (typeof AutoQueueModule.appendAutoQueueLog === 'function') {
      AutoQueueModule.appendAutoQueueLog(
        `[AUTOQ][OPEN_HOME_BLOCKED_WAITING_REPLY] source=${reasonText}`,
      );
    }
    return {
      ok: false,
      reason: 'blocked-waiting-reply',
    };
  }

  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;

  const defaultReadyMsg = '新聊天已就绪，准备发送下一个任务';
  const defaultTimeoutMsg = '切换新聊天超时，已停止批量任务组';

  function resolveStatusText(value, defaultStr) {
    if (value === null || value === false) {
      return null;
    }
    if (value === undefined) {
      return defaultStr;
    }
    return value;
  }

  const readyStatusText = resolveStatusText(opts.statusOnReady, defaultReadyMsg);
  const timeoutStatusText = resolveStatusText(opts.statusOnTimeout, defaultTimeoutMsg);

  const append = typeof ToolboxShell !== 'undefined'
    && ToolboxShell
    && typeof ToolboxShell.appendLog === 'function'
    ? ToolboxShell.appendLog.bind(ToolboxShell)
    : null;

  const setStatusFn = typeof ToolboxShell !== 'undefined'
    && ToolboxShell
    && typeof ToolboxShell.setStatus === 'function'
    ? ToolboxShell.setStatus.bind(ToolboxShell)
    : null;

  const beforeKey = getCurrentConversationKeyUnified();
  if (append) {
    append(`[NEW_CHAT][START] reason=${reasonText} before=${beforeKey}`);
  }

  const startedAt = Date.now();
  let lastKey = beforeKey;
  let lastClickAt = 0;
  let clickAttempt = 0;
  let lastClickError = '';
  let sawButtonDuringAttempts = false;
  let lastSuccessfulClickMethod = '';

  while (Date.now() - startedAt < timeoutMs) {
    const currentKey = getCurrentConversationKeyUnified();
    lastKey = currentKey;

    let capability = null;
    if (typeof getPageCapability === 'function') {
      try {
        capability = getPageCapability(`new-chat-wait:${reasonText}`);
      } catch (err) {
        console.error('[NEW_CHAT] getPageCapability failed', err);
        if (err && err.stack) {
          console.error(err.stack);
        }
      }
    }

    const responseState = capability && capability.response_state
      ? capability.response_state
      : '';

    const inputable = capability && capability.can_accept_input ? true : false;
    const sendable = capability && capability.can_send_now ? true : false;
    const responseReason = capability && capability.response_state_reason
      ? String(capability.response_state_reason)
      : '';
    const leftOldConversation = currentKey !== beforeKey;
    const alreadyHomeReady = (
      currentKey === beforeKey
      && currentKey === 'path:/'
      && inputable
      && sendable
      && responseState !== 'generating'
      && responseReason === 'home_new_chat_composer_ready_override'
    );

    if (alreadyHomeReady) {
      if (append) {
        append(`[NEW_CHAT][READY_ALREADY_HOME] url=${location.href} conversation_id=-`);
        append(
          `[NEW_CHAT][READY] reason=${reasonText} before=${beforeKey} after=${currentKey} `
          + `inputable=${inputable} sendable=${sendable} response_state=${responseState} `
          + `method=${lastSuccessfulClickMethod || '-'} ready=already-home`,
        );
      }

      if (readyStatusText && setStatusFn) {
        setStatusFn(readyStatusText);
      }

      return {
        ok: true,
        beforeKey,
        afterKey: currentKey,
        reason: reasonText,
        method: lastSuccessfulClickMethod || '',
        sawButtonDuringAttempts,
        alreadyHomeReady: true,
      };
    }

    if (leftOldConversation && inputable && responseState !== 'generating') {
      if (append) {
        append(
          `[NEW_CHAT][READY] reason=${reasonText} before=${beforeKey} after=${currentKey} `
          + `inputable=${inputable} sendable=${sendable} response_state=${responseState} method=${lastSuccessfulClickMethod || '-'}`,
        );
      }

      if (readyStatusText && setStatusFn) {
        setStatusFn(readyStatusText);
      }

      return {
        ok: true,
        beforeKey,
        afterKey: currentKey,
        reason: reasonText,
        method: lastSuccessfulClickMethod || '',
        sawButtonDuringAttempts,
      };
    }

    if (!leftOldConversation && Date.now() - lastClickAt >= 1200) {
      lastClickAt = Date.now();
      clickAttempt += 1;

      const btn = findNewChatButtonUnified();

      if (!btn) {
        if (append) {
          append(
            `[NEW_CHAT][BUTTON_NOT_FOUND_RETRY] reason=${reasonText} attempt=${clickAttempt}`,
          );
        }
      } else {
        sawButtonDuringAttempts = true;
        try {
          const clickResult = clickElementLikeUserUnified(btn, reasonText);
          lastSuccessfulClickMethod = clickResult && clickResult.method ? clickResult.method : '';
          if (append) {
            append(
              `[NEW_CHAT][CLICKED] reason=${reasonText} attempt=${clickAttempt} method=${lastSuccessfulClickMethod || '-'}`,
            );
          }
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          lastClickError = errText;
          console.error('[NEW_CHAT][CLICK_FAILED]', err);
          if (err && err.stack) {
            console.error(err.stack);
          }
          if (append) {
            append(
              `[NEW_CHAT][CLICK_FAILED_RETRY] reason=${reasonText} attempt=${clickAttempt} error=${errText}`,
            );
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (append) {
    append(
      `[NEW_CHAT][TIMEOUT] reason=${reasonText} before=${beforeKey} last=${lastKey} attempts=${clickAttempt} `
      + `last_error=${lastClickError || '-'}`,
    );
  }

  if (timeoutStatusText && setStatusFn) {
    setStatusFn(timeoutStatusText);
  }

  return {
    ok: false,
    reason: lastClickError ? 'new-chat-click-timeout-after-error' : 'new-chat-timeout',
    beforeKey,
    afterKey: lastKey,
    error: lastClickError,
    sawButtonDuringAttempts,
  };
}
