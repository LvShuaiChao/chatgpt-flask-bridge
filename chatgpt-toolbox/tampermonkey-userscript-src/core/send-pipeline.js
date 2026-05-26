  const SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES = 5;
  const SEND_PIPELINE_COMPOSER_SYNC_DELAYS_MS = [300, 600, 1000, 1500, 2000];
  const SEND_PIPELINE_BUTTON_WAIT_MAX_ATTEMPTS = 40;
  const SEND_PIPELINE_BUTTON_WAIT_INTERVAL_MS = 200;
  const SEND_PIPELINE_BUTTON_DISABLED_WAIT_MS = 8000;
  const SEND_PIPELINE_TEXT_REWRITE_MAX = 3;
  const SEND_PIPELINE_COMPOSER_READY_TIMEOUT_MS = 10000;
  const SEND_PIPELINE_STABLE_INTERVAL_MS = 300;

  function sendPipelineSleep(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (typeof sleep === 'function') {
      return sleep(delay);
    }
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  function sendPipelineLog(tag, fields) {
    const extra = fields && typeof fields === 'object' ? fields : {};
    const parts = [
      String(tag || '[SEND_PIPELINE]'),
      `source=${String(extra.source || '-')}`,
      `mode=${String(extra.mode || '-')}`,
      `text_len=${Number(extra.text_len != null ? extra.text_len : (extra.textLen != null ? extra.textLen : 0))}`,
      `sendExistingComposer=${extra.sendExistingComposer ? 1 : 0}`,
      `reason=${String(extra.reason || '-')}`,
      `retryable=${extra.retryable ? 1 : 0}`,
      `wait_reply=${extra.wait_reply ? 1 : 0}`,
    ];

    const line = parts.join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function sendPipelinePreviewText(text, maxLen) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen || 80);
  }

  function sendPipelineBuildResult(base, patch) {
    const out = {
      ok: false,
      reason: '',
      retryable: false,
      wait_reply: false,
      source: String(base.source || ''),
      mode: String(base.mode || ''),
    };
    const merged = Object.assign(out, base || {}, patch || {});
    merged.ok = merged.ok === true;
    merged.retryable = merged.retryable === true;
    merged.wait_reply = merged.wait_reply === true;
    return merged;
  }

  function sendPipelineApplyStableFlags(result, stableResult) {
    if (!stableResult || typeof stableResult !== 'object') {
      return result;
    }

    result.ok = stableResult.ok === true;
    result.reason = String(stableResult.reason || result.reason || '');
    if (stableResult.retryable === true) {
      result.retryable = true;
    }
    if (stableResult.wait_reply === true || stableResult.wait === true) {
      result.wait_reply = true;
      result.retryable = true;
    }
    return result;
  }

  function sendPipelineNormalizeFailureReason(reason) {
    const raw = String(reason || '').trim();
    if (!raw) {
      return { raw: '', normalized: '' };
    }
    if (raw.startsWith('send_not_confirmed:')) {
      const sub = raw.slice('send_not_confirmed:'.length).trim();
      return { raw, normalized: sub || 'send_not_confirmed' };
    }
    if (raw === 'voice_button') {
      return { raw, normalized: 'voice_button_only' };
    }
    return { raw, normalized: raw };
  }

  /** Single source of truth for retryable send failure reasons (upload / auto-queue / main). */
  function sendPipelineIsRetryableReason(reason) {
    const { raw, normalized } = sendPipelineNormalizeFailureReason(reason);
    if (!normalized && !raw) {
      return false;
    }
    if (normalized === 'cancelled' || normalized === 'page_navigating') {
      return false;
    }
    const retryable = [
      'assistant_busy',
      'background-throttled',
      'composer_not_ready',
      'composer_not_found',
      'composer_empty',
      'composer_text_not_ready',
      'composer_text_not_synced',
      'composer_set_failed',
      'composer_text_lost',
      'composer_text_lost_after_attachment',
      'composer_text_lost_after_rewrite',
      'send_button_not_found',
      'send_button_not_ready_after_text',
      'send_button_disabled',
      'button_disabled',
      'send_button_wait_timeout',
      'voice_button_only',
      'attachment_not_ready',
      'attachment_processing',
      'attachment_ready_but_send_button_missing',
      'attachment_ready_waiting_text',
      'payload_ready_but_send_button_missing',
      'send_click_not_confirmed',
      'send_not_confirmed',
      'input_not_cleared',
      'no_user_bubble_after_click',
      'no_send_progress_after_actions',
      'no_progress',
      'stable_send_timeout',
      'enter_fallback_failed',
      'send_button_not_found_enter_fallback_failed',
    ].includes(normalized)
      || raw.startsWith('send_not_confirmed:');
    return retryable;
  }

  async function sendPipelineWriteAndVerifyText(prompt, source, retryIndex, ctx) {
    const text = String(prompt || '');

    if (typeof ComposerApi.clearComposerValue === 'function') {
      ComposerApi.clearComposerValue();
    } else if (typeof ComposerApi.setComposerValue === 'function') {
      ComposerApi.setComposerValue('');
    } else {
      return { ok: false, reason: 'composer_api_unavailable' };
    }

    await sendPipelineSleep(120);

    sendPipelineLog('[SEND_PIPELINE][TEXT_WRITE]', {
      source: ctx.source,
      mode: ctx.mode,
      text_len: text.length,
      sendExistingComposer: 0,
      reason: `retryIndex=${retryIndex}`,
    });

    const okSet = typeof ComposerApi.setComposerValue === 'function'
      && ComposerApi.setComposerValue(text);
    if (!okSet) {
      return { ok: false, reason: 'composer_set_failed' };
    }

    const settleMs = retryIndex === 0
      ? 400
      : (SEND_PIPELINE_COMPOSER_SYNC_DELAYS_MS[retryIndex - 1] || 2000);
    await sendPipelineSleep(settleMs);

    const check = typeof ComposerApi.checkComposerTextSyncDetailed === 'function'
      ? ComposerApi.checkComposerTextSyncDetailed(text)
      : {
        ok: typeof ComposerApi.isComposerTextSynced === 'function'
          && ComposerApi.isComposerTextSynced(text),
        reason: 'composer_text_not_synced',
      };

    if (check.ok) {
      sendPipelineLog('[SEND_PIPELINE][TEXT_VERIFY_OK]', {
        source: ctx.source,
        mode: ctx.mode,
        text_len: text.length,
        sendExistingComposer: 0,
        reason: '-',
      });
      return check;
    }

    sendPipelineLog('[SEND_PIPELINE][TEXT_VERIFY_FAILED]', {
      source: ctx.source,
      mode: ctx.mode,
      text_len: text.length,
      sendExistingComposer: 0,
      reason: String(check.reason || 'composer_text_not_synced'),
      retryable: 1,
    });

    return check;
  }

  async function sendPipelineWaitSendButtonReady(ctx, options) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts || SEND_PIPELINE_BUTTON_WAIT_MAX_ATTEMPTS));
    const intervalMs = Math.max(50, Number(options.intervalMs || SEND_PIPELINE_BUTTON_WAIT_INTERVAL_MS));
    const requireText = options.requireText === true;
    const expectedText = String(options.expectedText || '').trim();
    const allowDisabledWithText = options.allowDisabledWithText !== false;
    const maxDisabledWaitMs = Math.max(
      intervalMs,
      Number(options.maxDisabledWaitMs || SEND_PIPELINE_BUTTON_DISABLED_WAIT_MS),
    );
    const startedAt = Date.now();
    let useEnterFallback = false;

    if (typeof invalidateComposerResponseStateCache === 'function') {
      invalidateComposerResponseStateCache();
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof ctx.shouldStop === 'function' && ctx.shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const capability = typeof getPageCapability === 'function'
        ? getPageCapability('send-pipeline-wait-button')
        : {};
      const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { found: false, ready: false, button: null, reason: 'button-not-found', aria: '' };

      if (ctx.waitForReplyIdle && capability.is_responding) {
        return { ok: false, reason: 'assistant_busy', wait_reply: true, retryable: true };
      }

      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const hasComposerText = typeof ComposerApi.hasRealComposerText === 'function'
        ? ComposerApi.hasRealComposerText()
        : composerText.length > 0;
      const hasAttachment = Number(capability.attachment_count || 0) > 0
        || Boolean(capability.has_composer_payload && !hasComposerText);

      if (requireText && !hasComposerText) {
        const lostReason = hasAttachment
          ? 'composer_text_lost_after_attachment'
          : 'composer_text_lost';
        return {
          ok: false,
          reason: lostReason,
          retryable: true,
          needRewriteText: true,
        };
      }

      if (expectedText && hasComposerText) {
        const syncCheck = typeof ComposerApi.checkComposerTextSyncDetailed === 'function'
          ? ComposerApi.checkComposerTextSyncDetailed(expectedText)
          : {
            ok: typeof ComposerApi.isComposerTextSynced === 'function'
              && ComposerApi.isComposerTextSynced(expectedText),
          };
        if (!syncCheck.ok) {
          return {
            ok: false,
            reason: String(syncCheck.reason || 'composer_text_not_synced'),
            retryable: true,
            needRewriteText: true,
          };
        }
      }

      if (hasComposerText && capability.can_send_now && sendSnap.ready) {
        sendPipelineLog('[SEND_PIPELINE][BUTTON_READY]', {
          source: ctx.source,
          mode: ctx.mode,
          text_len: composerText.length,
          sendExistingComposer: ctx.sendExistingComposer ? 1 : 0,
          reason: 'send_button_ready',
        });
        return { ok: true, reason: 'send_button_ready', useEnterFallback: false };
      }

      if (
        allowDisabledWithText
        && hasComposerText
        && sendSnap.button
        && Date.now() - startedAt >= maxDisabledWaitMs
      ) {
        useEnterFallback = true;
        sendPipelineLog('[SEND_PIPELINE][BUTTON_READY]', {
          source: ctx.source,
          mode: ctx.mode,
          text_len: composerText.length,
          sendExistingComposer: ctx.sendExistingComposer ? 1 : 0,
          reason: 'send_button_disabled_use_enter_fallback',
        });
        return {
          ok: true,
          reason: 'send_button_disabled_use_enter_fallback',
          useEnterFallback: true,
        };
      }

      if (hasComposerText && !sendSnap.button && Date.now() - startedAt >= maxDisabledWaitMs) {
        useEnterFallback = true;
        break;
      }

      await sendPipelineSleep(intervalMs);
    }

    const finalText = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '').trim()
      : '';
    const finalHasText = typeof ComposerApi.hasRealComposerText === 'function'
      ? ComposerApi.hasRealComposerText()
      : finalText.length > 0;

    if (requireText && !finalHasText) {
      const hasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
      return {
        ok: false,
        reason: hasAttachment ? 'composer_text_lost_after_attachment' : 'composer_text_lost',
        retryable: true,
        needRewriteText: true,
      };
    }

    if (allowDisabledWithText && finalHasText) {
      return {
        ok: true,
        reason: 'send_button_missing_use_enter_fallback',
        useEnterFallback: true,
      };
    }

    if (typeof hasVoiceComposerButtonOnly === 'function' && hasVoiceComposerButtonOnly()) {
      return { ok: false, reason: 'voice_button_only', retryable: true };
    }

    return { ok: false, reason: 'send_button_not_found', retryable: true };
  }

  async function sendUnifiedMessage(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const source = String(opts.source || 'unified-send').trim() || 'unified-send';
    const mode = String(opts.mode || 'unknown').trim() || 'unknown';
    const text = String(opts.text || '').trim();
    const sendExistingComposer = opts.sendExistingComposer === true;
    const waitForReplyIdle = opts.waitForReplyIdle !== false;
    const waitForAttachmentReady = opts.waitForAttachmentReady !== false;
    const allowEnterFallback = opts.allowEnterFallback !== false;
    const maxAttempts = Math.max(1, Number(opts.maxAttempts || 8));
    const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;

    const ctx = {
      source,
      mode,
      text_len: text.length,
      sendExistingComposer,
      waitForReplyIdle,
      shouldStop,
    };

    const result = sendPipelineBuildResult({
      source,
      mode,
      ok: false,
      reason: '',
      retryable: false,
      wait_reply: false,
    });

    sendPipelineLog('[SEND_PIPELINE][START]', {
      source,
      mode,
      text_len: sendExistingComposer
        ? (typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim().length
          : 0)
        : text.length,
      sendExistingComposer,
      reason: '-',
    });

    try {
      if (shouldStop()) {
        result.reason = 'cancelled';
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
        return result;
      }

      if (typeof stableSendMessage !== 'function') {
        result.reason = 'stable_send_unavailable';
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
        return result;
      }

      if (typeof waitUntilComposerReady === 'function') {
        const composerReady = await waitUntilComposerReady({
          timeoutMs: SEND_PIPELINE_COMPOSER_READY_TIMEOUT_MS,
          intervalMs: 200,
          source,
        });
        if (!composerReady) {
          result.reason = 'composer_not_ready';
          result.retryable = true;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            retryable: true,
          }));
          return result;
        }
        sendPipelineLog('[SEND_PIPELINE][COMPOSER_READY]', Object.assign({}, ctx, { reason: '-' }));
      }

      if (waitForReplyIdle && typeof detectComposerResponseState === 'function') {
        const homeReady = typeof isHomeNewChatReadyToSendNow === 'function'
          && isHomeNewChatReadyToSendNow();
        const responseState = detectComposerResponseState();
        if (responseState.is_responding && !homeReady) {
          result.reason = 'assistant_busy';
          result.wait_reply = true;
          result.retryable = true;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            wait_reply: true,
            retryable: true,
          }));
          return result;
        }
      }

      if (waitForAttachmentReady && typeof waitAttachmentsStableForSend === 'function') {
        const stillUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading();
        if (stillUploading) {
          const attachWait = await waitAttachmentsStableForSend(
            typeof MAX_ATTACHMENT_SEND_WAIT_MS === 'number' ? MAX_ATTACHMENT_SEND_WAIT_MS : 120000,
            shouldStop,
            { source },
          );
          if (!attachWait || attachWait.ok !== true) {
            result.reason = (attachWait && attachWait.reason) || 'attachment_not_ready';
            result.retryable = sendPipelineIsRetryableReason(result.reason);
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
              reason: result.reason,
              retryable: result.retryable,
            }));
            return result;
          }
        }
      }

      let useEnterFallback = false;

      if (text && !sendExistingComposer) {
        let syncOk = false;
        let lastSyncReason = 'composer_text_not_synced';

        for (let retryIndex = 0; retryIndex < SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES; retryIndex += 1) {
          if (shouldStop()) {
            result.reason = 'cancelled';
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          }

          const syncCheck = await sendPipelineWriteAndVerifyText(text, source, retryIndex, ctx);
          if (syncCheck.ok) {
            syncOk = true;
            break;
          }
          lastSyncReason = String(syncCheck.reason || 'composer_text_not_synced');
        }

        if (!syncOk) {
          result.reason = lastSyncReason === 'composer_text_not_synced'
            ? 'composer_text_not_ready'
            : lastSyncReason;
          result.retryable = true;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            retryable: true,
          }));
          return result;
        }
      } else if (sendExistingComposer) {
        const existingText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasPayload = !!existingText
          || (typeof hasComposerAttachment === 'function' && hasComposerAttachment())
          || (typeof ComposerApi.isAttachmentStillUploading === 'function'
            && ComposerApi.isAttachmentStillUploading());

        if (!hasPayload) {
          result.reason = 'composer_empty';
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
          return result;
        }
      }

      const buttonWaitOptions = {
        requireText: !sendExistingComposer || !!text,
        expectedText: text && !sendExistingComposer ? text : '',
        allowDisabledWithText: allowEnterFallback,
      };

      let buttonWait = await sendPipelineWaitSendButtonReady(ctx, buttonWaitOptions);

      if (buttonWait.needRewriteText && text && !sendExistingComposer) {
        let rewriteOk = false;
        for (let rewriteIndex = 0; rewriteIndex < SEND_PIPELINE_TEXT_REWRITE_MAX; rewriteIndex += 1) {
          if (shouldStop()) {
            result.reason = 'cancelled';
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          }
          const syncCheck = await sendPipelineWriteAndVerifyText(
            text,
            source,
            SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES + rewriteIndex,
            ctx,
          );
          if (syncCheck.ok) {
            rewriteOk = true;
            break;
          }
          await sendPipelineSleep(SEND_PIPELINE_COMPOSER_SYNC_DELAYS_MS[rewriteIndex] || 500);
        }

        if (!rewriteOk) {
          result.reason = 'composer_text_lost_after_rewrite';
          result.retryable = true;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            retryable: true,
          }));
          return result;
        }

        buttonWait = await sendPipelineWaitSendButtonReady(ctx, buttonWaitOptions);
      }

      if (!buttonWait.ok) {
        result.reason = String(buttonWait.reason || 'send_button_not_found');
        if (buttonWait.wait_reply) {
          result.wait_reply = true;
        }
        result.retryable = buttonWait.retryable === true
          || sendPipelineIsRetryableReason(result.reason);
        if (result.reason === 'send_button_not_found') {
          result.reason = 'send_button_not_ready_after_text';
        }
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
          reason: result.reason,
          retryable: result.retryable,
          wait_reply: result.wait_reply,
        }));
        return result;
      }

      useEnterFallback = allowEnterFallback && buttonWait.useEnterFallback === true;

      sendPipelineLog('[SEND_PIPELINE][CALL_STABLE_SEND]', Object.assign({}, ctx, {
        reason: buttonWait.reason || '-',
        text_len: typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim().length
          : ctx.text_len,
      }));

      const stableResult = await stableSendMessage({
        source,
        sendExistingComposer: true,
        maxAttempts,
        intervalMs: SEND_PIPELINE_STABLE_INTERVAL_MS,
        blockWhenResponding: waitForReplyIdle,
        allowEnterFallbackWhenNoButton: useEnterFallback,
        shouldStop,
        onPreSendStatus: opts.onPreSendStatus,
      });

      sendPipelineApplyStableFlags(result, stableResult);

      if (!result.retryable) {
        result.retryable = sendPipelineIsRetryableReason(result.reason);
      }

      if (result.ok) {
        sendPipelineLog('[SEND_PIPELINE][DONE]', Object.assign({}, ctx, {
          reason: result.reason || 'sent',
          retryable: result.retryable,
          wait_reply: result.wait_reply,
        }));
      } else {
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
          reason: result.reason || 'unknown',
          retryable: result.retryable,
          wait_reply: result.wait_reply,
        }));
      }

      return result;
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      const errStack = err && err.stack ? String(err.stack) : '';
      console.error('[ChatGPT toolbox] sendUnifiedMessage failed', err, { source, mode });
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SEND_PIPELINE][FAILED] source=${source} mode=${mode} reason=send_exception `
          + `error=${errText} stack=${sendPipelinePreviewText(errStack, 300)}`,
        );
      }
      result.reason = 'send_exception';
      result.retryable = false;
      return result;
    }
  }
