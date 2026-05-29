(function initComposerSendService() {
  const COMPOSER_SEND_BUTTON_POLL_MS = 200;
  const COMPOSER_SEND_TEXT_SYNC_DELAYS_MS = [300, 600, 1000, 1500, 2000];
  const COMPOSER_SEND_TEXT_SYNC_MAX = 5;

  const composerSendCoreState = {
    running: false,
    owner: '',
    startedAt: 0,
    reason: '',
  };

  const COMPOSER_SEND_REASON_ZH = {
    'empty-text': '发送文本为空',
    'composer-not-found': '未找到 ChatGPT 输入框',
    'composer-root-not-found': '未找到 ChatGPT 输入框根节点',
    'composer-write-failed': '写入输入框失败',
    'composer-empty-after-write': '写入后输入框仍为空',
    'send-button-not-found': '未找到 ChatGPT 发送按钮',
    'send-button-disabled': '发送按钮不可点击',
    'assistant-busy': 'ChatGPT 正在回复',
    'page-throttled': '页面后台限速中',
    'click-failed': '点击发送按钮失败',
    sent: '已发送',
    cancelled: '已取消',
    'composer-not-ready': '输入框未就绪',
  };

  function composerSendSleep(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (typeof sleep === 'function') {
      return sleep(delay);
    }
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  function composerSendLog(tag, fields) {
    const extra = fields && typeof fields === 'object' ? fields : {};
    const parts = [
      String(tag || '[COMPOSER_SEND]'),
      `source=${String(extra.source || '-')}`,
      `mode=${String(extra.mode || '-')}`,
      `reason=${String(extra.reason || '-')}`,
    ];
    if (extra.taskId) {
      parts.push(`taskId=${String(extra.taskId)}`);
    }
    if (extra.taskTitle) {
      parts.push(`taskTitle=${String(extra.taskTitle)}`);
    }
    if (extra.composerTextLen != null) {
      parts.push(`composerTextLen=${Number(extra.composerTextLen)}`);
    }
    if (extra.targetTextLen != null) {
      parts.push(`targetTextLen=${Number(extra.targetTextLen)}`);
    }
    if (extra.buttonFound != null) {
      parts.push(`buttonFound=${extra.buttonFound ? 1 : 0}`);
    }
    if (extra.clicked != null) {
      parts.push(`clicked=${extra.clicked ? 1 : 0}`);
    }
    if (extra.elapsedMs != null) {
      parts.push(`elapsedMs=${Number(extra.elapsedMs)}`);
    }
    const line = parts.join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function mapComposerSendReasonToChinese(reason) {
    const key = String(reason || '').trim();
    if (!key) {
      return '';
    }
    if (COMPOSER_SEND_REASON_ZH[key]) {
      return COMPOSER_SEND_REASON_ZH[key];
    }
    const normalized = key.replace(/_/g, '-');
    if (COMPOSER_SEND_REASON_ZH[normalized]) {
      return COMPOSER_SEND_REASON_ZH[normalized];
    }
    return key;
  }

  function buildComposerSendResult(base, patch) {
    return Object.assign({
      ok: false,
      reason: '',
      detail: '',
      source: '',
      taskId: '',
      taskTitle: '',
      mode: '',
      composerFound: false,
      composerRootFound: false,
      composerTextLen: 0,
      targetTextLen: 0,
      inputable: false,
      sendable: false,
      buttonFound: false,
      clicked: false,
      elapsedMs: 0,
      candidates: [],
    }, base || {}, patch || {});
  }

  function isComposerSendPageThrottled() {
    if (typeof document !== 'undefined' && document.hidden) {
      return true;
    }
    if (
      typeof BrowserRuntimeHealth !== 'undefined'
      && BrowserRuntimeHealth
      && typeof BrowserRuntimeHealth.isProbablyThrottled === 'function'
      && BrowserRuntimeHealth.isProbablyThrottled()
    ) {
      return true;
    }
    return false;
  }

  async function composerSendWriteAndVerifyText(text, ctx) {
    const target = String(text || '');

    if (typeof ComposerApi.clearComposerValue === 'function') {
      ComposerApi.clearComposerValue();
    } else if (typeof ComposerApi.setComposerValue === 'function') {
      ComposerApi.setComposerValue('');
    } else {
      return { ok: false, reason: 'composer-write-failed', detail: 'ComposerApi unavailable' };
    }

    await composerSendSleep(120);

    composerSendLog('[COMPOSER_SEND][TEXT_WRITE]', ctx);

    const okSet = typeof ComposerApi.setComposerValue === 'function'
      && ComposerApi.setComposerValue(target);
    if (!okSet) {
      return { ok: false, reason: 'composer-write-failed', detail: 'setComposerValue returned false' };
    }

    for (let retryIndex = 0; retryIndex < COMPOSER_SEND_TEXT_SYNC_MAX; retryIndex += 1) {
      const settleMs = retryIndex === 0
        ? 400
        : (COMPOSER_SEND_TEXT_SYNC_DELAYS_MS[retryIndex - 1] || 2000);
      await composerSendSleep(settleMs);

      const check = typeof ComposerApi.checkComposerTextSyncDetailed === 'function'
        ? ComposerApi.checkComposerTextSyncDetailed(target)
        : {
          ok: typeof ComposerApi.isComposerTextSynced === 'function'
            && ComposerApi.isComposerTextSynced(target),
          reason: 'composer-empty-after-write',
        };

      if (check.ok) {
        composerSendLog('[COMPOSER_SEND][TEXT_READY]', Object.assign({}, ctx, {
          composerTextLen: String(ComposerApi.getComposerText() || '').trim().length,
          targetTextLen: target.length,
        }));
        return { ok: true, reason: 'text-ready' };
      }
    }

    const afterLen = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '').trim().length
      : 0;

    return {
      ok: false,
      reason: afterLen <= 0 ? 'composer-empty-after-write' : 'composer-write-failed',
      detail: `targetLen=${target.length} actualLen=${afterLen}`,
    };
  }

  async function composerSendWaitForButton(composerRoot, ctx, options) {
    const timeoutMs = Math.max(1000, Number(options.waitButtonTimeoutMs || 15000));
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const startedAt = Date.now();
    let lastCandidateLogAt = 0;

    composerSendLog('[COMPOSER_SEND][WAIT_BUTTON]', ctx);

    while (Date.now() - startedAt < timeoutMs) {
      if (shouldStop()) {
        return { ok: false, reason: 'cancelled', candidates: [] };
      }

      if (isComposerSendPageThrottled()) {
        composerSendLog('[COMPOSER_SEND][WAIT_BUTTON]', Object.assign({}, ctx, {
          reason: 'page-throttled',
        }));
        await composerSendSleep(COMPOSER_SEND_BUTTON_POLL_MS);
        continue;
      }

      const detected = typeof detectRealSendButton === 'function'
        ? detectRealSendButton(composerRoot)
        : { found: false, button: null, reason: 'send-button-not-found', candidates: [] };

      if (detected.found && detected.button instanceof HTMLButtonElement) {
        composerSendLog('[COMPOSER_SEND][BUTTON_FOUND]', Object.assign({}, ctx, {
          reason: detected.reason || 'send_button_ready',
          buttonFound: true,
        }));
        return {
          ok: true,
          button: detected.button,
          reason: detected.reason || 'send_button_ready',
          candidates: detected.candidates || [],
        };
      }

      if (detected.reason === 'send-button-disabled') {
        return {
          ok: false,
          reason: 'send-button-disabled',
          candidates: detected.candidates || [],
        };
      }

      const now = Date.now();
      if (now - lastCandidateLogAt >= 2000) {
        lastCandidateLogAt = now;
        const candidates = Array.isArray(detected.candidates) ? detected.candidates : [];
        for (const candidate of candidates.slice(0, 8)) {
          if (candidate.rejectReason) {
            composerSendLog('[COMPOSER_SEND][BUTTON_CANDIDATE_REJECT]', Object.assign({}, ctx, {
              reason: candidate.rejectReason,
              detail: `aria=${candidate.ariaLabel || '-'} testid=${candidate.dataTestId || '-'} text=${candidate.text || '-'}`,
            }));
          }
        }
      }

      await composerSendSleep(COMPOSER_SEND_BUTTON_POLL_MS);
    }

    const finalDetected = typeof detectRealSendButton === 'function'
      ? detectRealSendButton(composerRoot)
      : { found: false, button: null, reason: 'send-button-not-found', candidates: [] };

    const candidates = Array.isArray(finalDetected.candidates) ? finalDetected.candidates : [];
    for (const candidate of candidates.slice(0, 8)) {
      if (candidate.rejectReason) {
        composerSendLog('[COMPOSER_SEND][BUTTON_CANDIDATE_REJECT]', Object.assign({}, ctx, {
          reason: candidate.rejectReason,
          detail: `aria=${candidate.ariaLabel || '-'} testid=${candidate.dataTestId || '-'} text=${candidate.text || '-'}`,
        }));
      }
    }

    return {
      ok: false,
      reason: finalDetected.reason === 'send-button-disabled'
        ? 'send-button-disabled'
        : 'send-button-not-found',
      candidates,
    };
  }

  async function sendTextThroughComposer(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const startedAt = Date.now();
    const source = String(opts.source || 'composer-send').trim() || 'composer-send';
    const mode = String(opts.mode || 'unknown').trim() || 'unknown';
    const taskId = String(opts.taskId || '').trim();
    const taskTitle = String(opts.taskTitle || '').trim();
    const sendExistingComposer = opts.sendExistingComposer === true;
    const requireTextWritten = opts.requireTextWritten !== false;
    const waitButtonTimeoutMs = Number(opts.waitButtonTimeoutMs || 15000);
    const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
    const waitForReplyIdle = opts.waitForReplyIdle !== false;
    const allowEnterFallback = opts.allowEnterFallback !== false;
    const text = sendExistingComposer ? '' : String(opts.text || '');

    const ctx = {
      source,
      mode,
      taskId,
      taskTitle,
    };

    composerSendLog('[COMPOSER_SEND][START]', Object.assign({}, ctx, {
      targetTextLen: sendExistingComposer ? 0 : text.trim().length,
      sendExistingComposer: sendExistingComposer ? 1 : 0,
    }));

    let sendStarted = false;
    try {
      sendStarted = true;
      composerSendCoreState.running = true;
      composerSendCoreState.owner = source;
      composerSendCoreState.startedAt = Date.now();
      composerSendCoreState.reason = 'send-text-through-composer';

    if (!sendExistingComposer && !text.trim()) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'empty-text',
        detail: mapComposerSendReasonToChinese('empty-text'),
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    if (shouldStop()) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'cancelled',
        detail: 'cancelled before start',
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    if (isComposerSendPageThrottled()) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'page-throttled',
        detail: mapComposerSendReasonToChinese('page-throttled'),
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    if (
      waitForReplyIdle
      && typeof detectComposerResponseState === 'function'
    ) {
      const homeReady = typeof isHomeNewChatReadyToSendNow === 'function'
        && isHomeNewChatReadyToSendNow();
      const responseState = detectComposerResponseState({ light: true }) || {};
      if (responseState.is_responding && !homeReady) {
        const fail = buildComposerSendResult(ctx, {
          ok: false,
          reason: 'assistant-busy',
          detail: mapComposerSendReasonToChinese('assistant-busy'),
          inputable: !!responseState.can_accept_input,
          sendable: !!responseState.can_send_now,
          elapsedMs: Date.now() - startedAt,
        });
        composerSendLog('[COMPOSER_SEND][FAILED]', fail);
        return fail;
      }
    }

    const composer = (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.getComposer === 'function'
    )
      ? ComposerApi.getComposer()
      : null;

    if (!(composer instanceof HTMLElement)) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'composer-not-found',
        detail: mapComposerSendReasonToChinese('composer-not-found'),
        composerFound: false,
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    const composerRoot = (
      typeof ComposerApi.getComposerRoot === 'function'
    )
      ? ComposerApi.getComposerRoot()
      : null;

    composerSendLog('[COMPOSER_SEND][COMPOSER_FOUND]', Object.assign({}, ctx, {
      composerFound: true,
      composerRootFound: composerRoot instanceof HTMLElement,
    }));

    const inputable = typeof ComposerApi.canAcceptInput === 'function'
      ? ComposerApi.canAcceptInput()
      : true;

    if (!sendExistingComposer && text.trim()) {
      const writeResult = await composerSendWriteAndVerifyText(text, ctx);
      if (!writeResult.ok) {
        const composerTextLen = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim().length
          : 0;
        const fail = buildComposerSendResult(ctx, {
          ok: false,
          reason: writeResult.reason || 'composer-write-failed',
          detail: writeResult.detail || mapComposerSendReasonToChinese(writeResult.reason),
          composerFound: true,
          composerRootFound: composerRoot instanceof HTMLElement,
          composerTextLen,
          targetTextLen: text.trim().length,
          inputable,
          elapsedMs: Date.now() - startedAt,
        });
        composerSendLog('[COMPOSER_SEND][FAILED]', fail);
        return fail;
      }
    }

    const composerTextLen = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '').trim().length
      : 0;
    const hasAttachment = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
      ? ComposerApi.hasComposerAttachmentUnified()
      : (
        typeof ComposerApi.countAttachmentChips === 'function'
          && ComposerApi.countAttachmentChips() > 0
      );

    if (requireTextWritten && !sendExistingComposer && composerTextLen <= 0 && !hasAttachment) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'composer-empty-after-write',
        detail: mapComposerSendReasonToChinese('composer-empty-after-write'),
        composerFound: true,
        composerRootFound: composerRoot instanceof HTMLElement,
        composerTextLen,
        targetTextLen: text.trim().length,
        inputable,
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    if (sendExistingComposer && composerTextLen <= 0 && !hasAttachment) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'empty-text',
        detail: mapComposerSendReasonToChinese('empty-text'),
        composerFound: true,
        composerRootFound: composerRoot instanceof HTMLElement,
        composerTextLen,
        inputable,
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    const buttonWait = await composerSendWaitForButton(composerRoot, ctx, {
      waitButtonTimeoutMs,
      shouldStop,
    });

    if (!buttonWait.ok) {
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: buttonWait.reason || 'send-button-not-found',
        detail: mapComposerSendReasonToChinese(buttonWait.reason || 'send-button-not-found'),
        composerFound: true,
        composerRootFound: composerRoot instanceof HTMLElement,
        composerTextLen,
        targetTextLen: sendExistingComposer ? composerTextLen : text.trim().length,
        inputable,
        sendable: false,
        buttonFound: false,
        candidates: buttonWait.candidates || [],
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    let clicked = false;
    composerSendLog('[COMPOSER_SEND][CLICK]', Object.assign({}, ctx, {
      buttonFound: true,
    }));

    if (typeof stableSendMessage === 'function') {
      const stableResult = await stableSendMessage({
        source,
        sendExistingComposer: true,
        maxAttempts: Math.max(1, Number(opts.maxStableAttempts || 8)),
        intervalMs: 300,
        blockWhenResponding: waitForReplyIdle,
        allowEnterFallbackWhenNoButton: allowEnterFallback,
        shouldStop,
      });

      clicked = stableResult && stableResult.ok === true;
      if (clicked) {
        const success = buildComposerSendResult(ctx, {
          ok: true,
          reason: 'sent',
          detail: mapComposerSendReasonToChinese('sent'),
          composerFound: true,
          composerRootFound: composerRoot instanceof HTMLElement,
          composerTextLen,
          targetTextLen: sendExistingComposer ? composerTextLen : text.trim().length,
          inputable,
          sendable: true,
          buttonFound: true,
          clicked: true,
          candidates: buttonWait.candidates || [],
          elapsedMs: Date.now() - startedAt,
        });
        composerSendLog('[COMPOSER_SEND][SUCCESS]', success);
        return success;
      }

      const stableReason = String((stableResult && stableResult.reason) || 'click-failed');
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: stableReason === 'assistant_busy' ? 'assistant-busy' : 'click-failed',
        detail: mapComposerSendReasonToChinese(stableReason === 'assistant_busy' ? 'assistant-busy' : 'click-failed'),
        composerFound: true,
        composerRootFound: composerRoot instanceof HTMLElement,
        composerTextLen,
        targetTextLen: sendExistingComposer ? composerTextLen : text.trim().length,
        inputable,
        sendable: true,
        buttonFound: true,
        clicked: false,
        candidates: buttonWait.candidates || [],
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    }

    if (buttonWait.button instanceof HTMLButtonElement) {
      try {
        buttonWait.button.click();
        clicked = true;
      } catch (clickErr) {
        console.error('[COMPOSER_SEND][ERROR]', clickErr, ctx);
        const fail = buildComposerSendResult(ctx, {
          ok: false,
          reason: 'click-failed',
          detail: clickErr && clickErr.message ? clickErr.message : String(clickErr),
          composerFound: true,
          composerRootFound: composerRoot instanceof HTMLElement,
          composerTextLen,
          buttonFound: true,
          clicked: false,
          candidates: buttonWait.candidates || [],
          elapsedMs: Date.now() - startedAt,
        });
        composerSendLog('[COMPOSER_SEND][FAILED]', fail);
        return fail;
      }
    }

    const success = buildComposerSendResult(ctx, {
      ok: clicked,
      reason: clicked ? 'sent' : 'click-failed',
      detail: mapComposerSendReasonToChinese(clicked ? 'sent' : 'click-failed'),
      composerFound: true,
      composerRootFound: composerRoot instanceof HTMLElement,
      composerTextLen,
      targetTextLen: sendExistingComposer ? composerTextLen : text.trim().length,
      inputable,
      sendable: true,
      buttonFound: true,
      clicked,
      candidates: buttonWait.candidates || [],
      elapsedMs: Date.now() - startedAt,
    });

    if (clicked) {
      composerSendLog('[COMPOSER_SEND][SUCCESS]', success);
    } else {
      composerSendLog('[COMPOSER_SEND][FAILED]', success);
    }
    return success;
    } catch (error) {
      console.error('[COMPOSER_SEND][ERROR]', error, ctx);
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'send-exception',
        detail: error && error.message ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
      composerSendLog('[COMPOSER_SEND][FAILED]', fail);
      return fail;
    } finally {
      if (sendStarted) {
        composerSendCoreState.running = false;
        composerSendCoreState.owner = '';
        composerSendCoreState.startedAt = 0;
        composerSendCoreState.reason = '';
        composerSendLog('[COMPOSER_SEND][CLEANUP]', {
          reason: 'finally',
          source,
        });
      }
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.sendTextThroughComposer = sendTextThroughComposer;
    globalThis.mapComposerSendReasonToChinese = mapComposerSendReasonToChinese;
  }
})();
