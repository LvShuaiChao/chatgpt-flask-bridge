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
    'click-failed': '发送按钮点击失败，请检查页面是否被遮挡或按钮是否可点击',
    'native-send-button-not-ready': '发送按钮尚未就绪，可能附件仍在处理，请等待后重试',
    'native-send-button-timeout': '发送按钮尚未就绪，等待超时，请稍后再试',
    'attachment-state-inconsistent': '附件状态正在同步，请等待文件卡片稳定后重试',
    'waiting_attachment_upload_done': '发送按钮尚未就绪，可能附件仍在处理，请等待后重试',
    'send-button-disabled': '发送按钮尚未就绪，可能附件仍在处理，请等待后重试',
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

  function composerSendReadCapability() {
    if (typeof getPageCapability !== 'function') {
      return {};
    }
    try {
      return getPageCapability('composer-send-audit') || {};
    } catch (capErr) {
      console.error('[SEND_PIPELINE][ERROR]', capErr);
      return {};
    }
  }

  function composerSendLog(tag, fields) {
    const extra = fields && typeof fields === 'object' ? fields : {};
    const capability = composerSendReadCapability();
    const parts = [
      String(tag || '[COMPOSER_SEND]'),
      `source=${String(extra.source || '-')}`,
      `action=${String(extra.action || extra.mode || '-')}`,
      `runId=${String(extra.runId != null ? extra.runId : (extra.taskId || '-'))}`,
      `expectedLen=${Number(extra.expectedLen != null ? extra.expectedLen : (extra.targetTextLen != null ? extra.targetTextLen : -1))}`,
      `actualLen=${Number(extra.actualLen != null ? extra.actualLen : (extra.composerTextLen != null ? extra.composerTextLen : -1))}`,
      `textSynced=${extra.textSynced != null ? (extra.textSynced ? 1 : 0) : -1}`,
      `sendReady=${extra.sendReady != null ? (extra.sendReady ? 1 : 0) : (capability.sendable != null ? (capability.sendable ? 1 : 0) : -1)}`,
      `realSendReady=${extra.realSendReady != null ? (extra.realSendReady ? 1 : 0) : (extra.buttonFound != null ? (extra.buttonFound ? 1 : 0) : -1)}`,
      `responseState=${String(extra.responseState || capability.response_state || '-')}`,
      `reason=${String(extra.reason || '-')}`,
    ];
    if (extra.taskId) {
      parts.push(`taskId=${String(extra.taskId)}`);
    }
    if (extra.taskTitle) {
      parts.push(`taskTitle=${String(extra.taskTitle)}`);
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

  function composerSendPipelineLog(tag, fields) {
    composerSendLog(tag, fields);
  }

  function composerSendLogError(error, fields) {
    console.error('[SEND_PIPELINE][ERROR]', error);
    const extra = fields && typeof fields === 'object' ? fields : {};
    const errText = error && error.message ? error.message : String(error || '');
    const errStack = error && error.stack ? String(error.stack).slice(0, 300) : '';
    const line = [
      '[SEND_PIPELINE][ERROR]',
      `source=${String(extra.source || '-')}`,
      `action=${String(extra.action || extra.mode || '-')}`,
      `runId=${String(extra.runId != null ? extra.runId : (extra.taskId || '-'))}`,
      `error=${errText}`,
      `stack=${errStack}`,
    ].join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
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
        const waitElapsed = Date.now() - startedAt;
        if (waitElapsed % 600 < COMPOSER_SEND_BUTTON_POLL_MS) {
          composerSendLog('[COMPOSER_SEND][WAIT_NATIVE_BUTTON_READY]', Object.assign({}, ctx, {
            elapsedMs: waitElapsed,
            sendButtonFound: 1,
            realSendButtonEnabled: 0,
            reason: 'send-button-disabled',
          }));
        }
        await composerSendSleep(COMPOSER_SEND_BUTTON_POLL_MS);
        continue;
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
        ? 'native-send-button-timeout'
        : 'send-button-not-found',
      candidates,
    };
  }

  function mapStableSendFailureToComposerReason(stableReason) {
    const raw = String(stableReason || '').trim();
    if (!raw) {
      return 'click-failed';
    }
    const waitReasons = new Set([
      'waiting_attachment_upload_done',
      'native-send-button-not-ready',
      'native-send-button-timeout',
      'send_button_disabled',
      'send-button-disabled',
      'enter_fallback_blocked_with_attachment',
      'home_new_chat_payload_but_send_button_missing',
      'payload_ready_but_send_button_missing',
      'attachment_ready_but_send_button_missing',
    ]);
    if (waitReasons.has(raw)) {
      return 'native-send-button-not-ready';
    }
    if (raw === 'assistant_busy') {
      return 'assistant-busy';
    }
    if (raw === 'attachment-state-inconsistent') {
      return 'attachment-state-inconsistent';
    }
    if (raw === 'click-failed' || raw === 'click_send_failed') {
      return 'click-failed';
    }
    return raw;
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

    const runId = String(opts.runId || opts.cancelTokenId || taskId || '-').trim() || '-';

    const ctx = {
      source,
      mode,
      action: mode,
      runId,
      taskId,
      taskTitle,
    };

    if (composerSendCoreState.running) {
      const blocked = buildComposerSendResult(ctx, {
        ok: false,
        reason: 'another-send-running',
        detail: 'duplicate send blocked',
        elapsedMs: 0,
      });
      composerSendPipelineLog('[SEND_PIPELINE][BLOCK_DUPLICATE]', Object.assign({}, ctx, {
        reason: 'another-send-running',
      }));
      composerSendLog('[COMPOSER_SEND][FAILED]', blocked);
      return blocked;
    }

    composerSendPipelineLog('[SEND_PIPELINE][ENTRY]', Object.assign({}, ctx, {
      expectedLen: sendExistingComposer ? 0 : text.trim().length,
      actualLen: sendExistingComposer ? 0 : text.trim().length,
      reason: '-',
    }));

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
      composerSendPipelineLog('[SEND_PIPELINE][FINISH]', Object.assign({}, ctx, {
        reason: 'empty_text',
        textSynced: 0,
      }));
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
      composerSendPipelineLog('[SEND_PIPELINE][TEXT_SYNC_RESULT]', Object.assign({}, ctx, {
        textSynced: writeResult.ok ? 1 : 0,
        expectedLen: text.trim().length,
        actualLen: typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim().length
          : 0,
        reason: writeResult.reason || (writeResult.ok ? 'composer_text_synced' : 'composer-write-failed'),
      }));
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

    composerSendPipelineLog('[SEND_PIPELINE][SEND_BUTTON_RESULT]', Object.assign({}, ctx, {
      realSendReady: buttonWait.ok ? 1 : 0,
      sendReady: buttonWait.ok ? 1 : 0,
      reason: buttonWait.reason || (buttonWait.ok ? 'send_button_ready' : 'send-button-not-found'),
    }));

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
    composerSendPipelineLog('[SEND_PIPELINE][CLICK_RESULT]', Object.assign({}, ctx, {
      realSendReady: 1,
      reason: 'pre_click',
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
      composerSendPipelineLog('[SEND_PIPELINE][CLICK_RESULT]', Object.assign({}, ctx, {
        clicked: clicked ? 1 : 0,
        reason: String((stableResult && stableResult.reason) || (clicked ? 'clicked' : 'click-failed')),
        realSendReady: clicked ? 1 : 0,
      }));
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
        composerSendPipelineLog('[SEND_PIPELINE][FINISH]', Object.assign({}, ctx, {
          reason: 'sent',
          textSynced: 1,
        }));
        composerSendLog('[COMPOSER_SEND][SUCCESS]', success);
        return success;
      }

      const stableReason = String((stableResult && stableResult.reason) || 'click-failed');
      const mappedReason = mapStableSendFailureToComposerReason(stableReason);
      const fail = buildComposerSendResult(ctx, {
        ok: false,
        reason: mappedReason,
        detail: mapComposerSendReasonToChinese(mappedReason),
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

    composerSendPipelineLog('[SEND_PIPELINE][CLICK_RESULT]', Object.assign({}, ctx, {
      clicked: clicked ? 1 : 0,
      reason: clicked ? 'clicked' : 'click-failed',
      realSendReady: clicked ? 1 : 0,
    }));

    if (clicked) {
      composerSendPipelineLog('[SEND_PIPELINE][FINISH]', Object.assign({}, ctx, {
        reason: 'sent',
        textSynced: 1,
      }));
      composerSendLog('[COMPOSER_SEND][SUCCESS]', success);
    } else {
      composerSendPipelineLog('[SEND_PIPELINE][FINISH]', Object.assign({}, ctx, {
        reason: success.reason || 'click-failed',
        textSynced: 0,
      }));
      composerSendLog('[COMPOSER_SEND][FAILED]', success);
    }
    return success;
    } catch (error) {
      composerSendLogError(error, ctx);
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

  async function sendTextByUnifiedPipeline(payload, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const text = payload && typeof payload === 'object'
      ? String(payload.text || payload.content || '')
      : String(payload || '');
    const source = String(
      opts.source
      || (payload && payload.source)
      || 'unified-pipeline',
    ).trim() || 'unified-pipeline';

    let authority = null;
    if (
      typeof ButtonState !== 'undefined'
      && ButtonState
      && typeof ButtonState.getUnifiedButtonAuthoritySnapshot === 'function'
    ) {
      authority = ButtonState.getUnifiedButtonAuthoritySnapshot(source);
    } else if (
      typeof window !== 'undefined'
      && window.ToolboxButtonState
      && typeof window.ToolboxButtonState.getUnifiedButtonAuthoritySnapshot === 'function'
    ) {
      authority = window.ToolboxButtonState.getUnifiedButtonAuthoritySnapshot(source);
    } else if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.getToolboxAuthorityState === 'function'
    ) {
      const rawAuthority = UploadModule.getToolboxAuthorityState(`composer-send-service:${source}`, {
        force: true,
        cacheTtlMs: 0,
      });
      const flags = rawAuthority && rawAuthority.flags ? rawAuthority.flags : {};
      const reply = rawAuthority && rawAuthority.reply ? rawAuthority.reply : {};
      authority = {
        source,
        responseState: String(reply.state || '').trim().toLowerCase(),
        inputable: flags.canInput === true,
        sendable: flags.canSend === true,
        assistantBusy: flags.replyBusy === true,
        canSendByHeader: flags.canSend === true && flags.replyBusy !== true,
      };
    } else {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SEND_PIPELINE][BRIDGE_STATE_FALLBACK_USED] source=${source || '-'}`,
        );
      }
      const bridgeState = (
        typeof window !== 'undefined'
        && window.__cgptBridgeState
        && typeof window.__cgptBridgeState === 'object'
      )
        ? window.__cgptBridgeState
        : {};
      const responseState = String(
        bridgeState.response_state || bridgeState.responseState || '',
      ).trim().toLowerCase();
      const inputable = bridgeState.inputable === true || bridgeState.inputable === 1;
      const sendable = bridgeState.sendable === true || bridgeState.sendable === 1;
      const assistantBusy = (
        responseState === 'generating'
        || responseState === 'responding'
        || responseState === 'answering'
        || responseState === 'streaming'
      );
      authority = {
        source,
        responseState,
        inputable,
        sendable,
        assistantBusy,
        canSendByHeader: inputable && sendable && !assistantBusy,
      };
    }

    const composerResult = await sendTextThroughComposer(Object.assign({}, opts, {
      text,
      source,
      sendExistingComposer: opts.sendExistingComposer === true,
    }));

    const composerTextLen = (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.getComposerText === 'function'
    )
      ? String(ComposerApi.getComposerText() || '').trim().length
      : Number(composerResult.composerTextLen || 0);

    const targetTextLen = text.trim().length;
    const textSynced = (
      opts.sendExistingComposer === true
      || targetTextLen <= 0
      || composerTextLen >= targetTextLen
    ) ? 1 : 0;

    const sendReady = authority && authority.canSendByHeader ? 1 : 0;
    const realSendReady = (
      composerResult.buttonFound === true
      && (composerResult.sendable === true || sendReady === 1)
    ) ? 1 : 0;

    const unified = {
      ok: composerResult.ok === true,
      reason: String(composerResult.reason || ''),
      textSynced,
      sendReady,
      realSendReady,
      responseState: authority ? authority.responseState : '',
      source,
      detail: composerResult.detail || '',
      clicked: composerResult.clicked === true,
    };

    const logLine = [
      '[COMPOSER_SEND][UNIFIED_PIPELINE]',
      `source=${source}`,
      `ok=${unified.ok ? 1 : 0}`,
      `reason=${unified.reason || '-'}`,
      `textSynced=${textSynced}`,
      `sendReady=${sendReady}`,
      `realSendReady=${realSendReady}`,
      `responseState=${unified.responseState || '-'}`,
    ].join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(logLine);
    } else {
      console.log(logLine);
    }

    return unified;
  }

  const ComposerSendService = Object.freeze({
    sendTextThroughComposer,
    sendTextByUnifiedPipeline,
    mapComposerSendReasonToChinese,
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.sendTextThroughComposer = sendTextThroughComposer;
    globalThis.sendTextByUnifiedPipeline = sendTextByUnifiedPipeline;
    globalThis.ComposerSendService = ComposerSendService;
    globalThis.mapComposerSendReasonToChinese = mapComposerSendReasonToChinese;
  }
})();
