  const SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES = 5;
  const SEND_PIPELINE_COMPOSER_SYNC_DELAYS_MS = [300, 600, 1000, 1500, 2000];
  const SEND_PIPELINE_BUTTON_WAIT_MAX_ATTEMPTS = 40;
  const SEND_PIPELINE_BUTTON_WAIT_INTERVAL_MS = 200;
  const SEND_PIPELINE_BUTTON_DISABLED_WAIT_MS = 8000;
  const SEND_PIPELINE_MANUAL_BUTTON_WAIT_MAX_ATTEMPTS = 20;
  const SEND_PIPELINE_MANUAL_BUTTON_WAIT_INTERVAL_MS = 150;
  const SEND_PIPELINE_MANUAL_BUTTON_DISABLED_WAIT_MS = 2500;
  const SEND_PIPELINE_MANUAL_ATTACHMENT_WAIT_MS = 10000;
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
      `wait_send=${extra.wait_send ? 1 : 0}`,
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
      wait_send: false,
      wait_reply: false,
      source: String(base.source || ''),
      mode: String(base.mode || ''),
    };
    const merged = Object.assign(out, base || {}, patch || {});
    merged.ok = merged.ok === true;
    merged.retryable = merged.retryable === true;
    merged.wait_send = merged.wait_send === true;
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
    if (stableResult.wait_send === true) {
      result.wait_send = true;
      result.retryable = true;
    }
    if (stableResult.wait_reply === true) {
      result.wait_reply = true;
      result.retryable = true;
    }
    if (stableResult.wait === true) {
      const softWaitSendReasons = new Set([
        'send_button_not_ready_with_attachment',
        'send_button_not_found',
        'send_button_disabled',
        'button_disabled',
        'payload_ready_but_send_button_missing',
        'attachment_ready_but_send_button_missing',
        'send_button_not_ready_after_text',
        'waiting_real_send_button',
        'composer_empty_wait_payload',
        'waiting_payload',
        'attachment_uploading',
        'waiting_attachment_upload',
        'waiting_attachment_upload_done',
        'enter_fallback_blocked_with_attachment',
      ]);
      const stableReason = String(stableResult.reason || '');
      if (softWaitSendReasons.has(stableReason)) {
        result.wait_send = true;
        result.wait_reply = false;
      } else {
        result.wait_reply = true;
      }
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
      'send_button_not_ready_with_attachment',
      'waiting_attachment_upload_done',
      'enter_fallback_blocked_with_attachment',
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

    const beforeSendable = typeof ComposerApi.canSendNow === 'function'
      ? (ComposerApi.canSendNow() ? 1 : 0)
      : 0;

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
      const afterSendable = typeof ComposerApi.canSendNow === 'function'
        ? (ComposerApi.canSendNow() ? 1 : 0)
        : 0;
      try {
        const taskIndex = (typeof state !== 'undefined' && state && state.taskRun)
          ? Number(state.taskRun.currentIndex || 0) + 1
          : '?';
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[AUTOQ][SENDABLE_RECHECK_AFTER_INPUT] before=${beforeSendable} after=${afterSendable} taskIndex=${taskIndex}`,
          );
        }
      } catch (e) {
        // ignore log failures
      }
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

  function sendPipelineNativeSendReadyNow() {
    const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
      ? getComposerSendButtonSnapshot({ silent: true })
      : { ready: false };
    if (sendSnap.ready === true) {
      return true;
    }
    return false;
  }

  function sendPipelineIsNativeSendButtonReady(sendSnap, capability) {
    if (!sendSnap || sendSnap.found !== true || sendSnap.ready !== true) {
      return false;
    }
    const nativeButton = sendSnap.button;
    const nativeButtonVisible = !!(
      nativeButton
      && nativeButton instanceof HTMLElement
      && nativeButton.offsetParent !== null
    );
    if (!nativeButtonVisible) {
      return false;
    }
    if (capability && capability.is_responding) {
      return false;
    }
    return true;
  }

  function sendPipelineLogAttachmentWait(tag, fields) {
    const payload = typeof composerHasPayloadInInput === 'function'
      ? composerHasPayloadInInput()
      : { hasAttachment: false, attachmentUploading: false, textLen: 0 };
    const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
      ? getComposerSendButtonSnapshot({ silent: true })
      : { ready: false };
    const line = [
      String(tag || '[SEND]'),
      `hasAttachment=${payload.hasAttachment ? 1 : 0}`,
      `attachmentUploading=${payload.attachmentUploading ? 1 : 0}`,
      `sendButtonReady=${sendSnap.ready ? 1 : 0}`,
      `nativeDisabled=${sendSnap.ready ? 0 : 1}`,
      `reason=${String((fields && fields.reason) || '-')}`,
    ].join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
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
    let lastBackgroundWaitLogAt = 0;

    if (typeof invalidateComposerResponseStateCache === 'function') {
      invalidateComposerResponseStateCache();
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const throttled = !!(
        (typeof BrowserRuntimeHealth !== 'undefined'
          && BrowserRuntimeHealth
          && typeof BrowserRuntimeHealth.isProbablyThrottled === 'function'
          && BrowserRuntimeHealth.isProbablyThrottled())
        || (typeof document !== 'undefined' && document.hidden)
      );
      if (throttled) {
        attempt -= 1;
        const now = Date.now();
        if (now - lastBackgroundWaitLogAt >= 2000) {
          lastBackgroundWaitLogAt = now;
          sendPipelineLog('[SEND_PIPELINE][WAIT_BACKGROUND]', Object.assign({}, ctx, {
            reason: 'browser-throttled',
            retryable: true,
            wait_send: true,
          }));
        }
        await sendPipelineSleep(intervalMs);
        continue;
      }

      if (typeof ctx.shouldStop === 'function' && ctx.shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const capability = typeof getPageCapability === 'function'
        ? getPageCapability('send-pipeline-wait-button')
        : {};
      let sendSnap = null;
      if (typeof getComposerSendButtonSnapshot === 'function') {
        sendSnap = getComposerSendButtonSnapshot({ silent: true });
      }
      if (!sendSnap || sendSnap.found !== true) {
        const fallbackButton = (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.findSendButton === 'function'
        )
          ? ComposerApi.findSendButton({ silent: true })
          : null;
        const fallbackReady = !!(
          fallbackButton instanceof HTMLButtonElement
          && (
            typeof ComposerApi === 'undefined'
            || typeof ComposerApi.isSendButtonReady !== 'function'
            || ComposerApi.isSendButtonReady(fallbackButton)
          )
        );
        sendSnap = {
          found: fallbackButton instanceof HTMLButtonElement,
          ready: fallbackReady,
          button: fallbackButton instanceof HTMLButtonElement ? fallbackButton : null,
          reason: fallbackButton instanceof HTMLButtonElement
            ? (fallbackReady ? 'send_button_ready' : 'send_button_disabled')
            : 'button-not-found',
        };
      }

      try {
        const composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';
        const nativeButton = sendSnap && sendSnap.button ? sendSnap.button : null;
        const nativeButtonFound = !!(nativeButton || sendSnap.found);
        const nativeButtonDisabled = !sendSnap.ready;
        const nativeButtonVisible = !!(
          nativeButton
          && typeof nativeButton === 'object'
          && nativeButton instanceof HTMLElement
          && nativeButton.offsetParent !== null
        );
        const stopButtonFound = !!(capability.stop_button_found || capability.stopButtonFound);
        const uploadPendingCount = Number(
          capability.attachment_uploading_count
          || capability.attachmentUploadingCount
          || 0,
        );
        const attachmentBoundCount = Number(
          capability.attachment_count
          || capability.attachmentCount
          || 0,
        );

        const checkReason = sendSnap.reason
          || capability.response_state_reason
          || capability.responseStateReason
          || '-';

        const locationPathname = String(location && location.pathname ? location.pathname : '');
        const pageId = typeof getBridgePageDisplayIdText === 'function'
          ? getBridgePageDisplayIdText()
          : '-';

        let conversationId = '';
        if (typeof parseConversationIdFromPath === 'function') {
          conversationId = String(parseConversationIdFromPath(locationPathname) || '');
        }
        if (!conversationId) {
          const match = locationPathname.match(/\/c\/([^/?#]+)/);
          conversationId = match && match[1] ? String(match[1]) : '';
        }

        const line = [
          '[SEND_READY][CHECK]',
          `source=${String(ctx.source || '-')}`,
          `mode=${String(ctx.mode || '-')}`,
          `page_id=${String(pageId || '-')}`,
          `conversation_id=${String(conversationId || '-')}`,
          `input_found=${capability.has_composer || capability.hasComposer ? 1 : 0}`,
          `input_text_len=${composerText.trim().length}`,
          `location_pathname=${locationPathname}`,
          `native_send_button_found=${nativeButtonFound ? 1 : 0}`,
          `native_send_button_disabled=${nativeButtonDisabled ? 1 : 0}`,
          `native_send_button_visible=${nativeButtonVisible ? 1 : 0}`,
          `stop_button_found=${stopButtonFound ? 1 : 0}`,
          `upload_pending_count=${uploadPendingCount}`,
          `attachment_bound_count=${attachmentBoundCount}`,
          `requireUploadDone=${options && options.requireUploadDone ? 1 : 0}`,
          `requireAttachmentBound=${options && options.requireAttachmentBound ? 1 : 0}`,
          `reason=${String(checkReason || '-')}`,
        ].join(' ');

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(line);
          ToolboxShell.appendLog(
            `[SEND_MESSAGE][WAIT_NATIVE_SEND] attempt=${attempt} nativeReady=${sendSnap && sendSnap.ready ? 1 : 0} reason=${String(checkReason || '-')}`,
          );
        } else {
          console.log(line);
          console.log(`[SEND_MESSAGE][WAIT_NATIVE_SEND] attempt=${attempt} nativeReady=${sendSnap && sendSnap.ready ? 1 : 0} reason=${String(checkReason || '-')}`);
        }
      } catch (logErr) {
        // 日志失败不应影响发送流程本身
        console.error('[ChatGPT toolbox] sendPipelineWaitSendButtonReady check log failed', logErr);
      }

      if (ctx.waitForReplyIdle && capability.is_responding) {
        return { ok: false, reason: 'assistant_busy', wait_reply: true, retryable: true };
      }

      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const hasComposerText = typeof ComposerApi.hasRealComposerText === 'function'
        ? ComposerApi.hasRealComposerText()
        : composerText.length > 0;
      const uniqueAttachmentSnapshot = typeof ComposerApi.getUniqueComposerAttachmentSnapshot === 'function'
        ? ComposerApi.getUniqueComposerAttachmentSnapshot({ reason: 'wait-native-send' })
        : null;
      const hasAttachment = (uniqueAttachmentSnapshot ? Number(uniqueAttachmentSnapshot.uniqueCount || 0) : 0) > 0
        || Number(capability.attachment_count || 0) > 0
        || Boolean(capability.has_composer_payload && !hasComposerText);
      const hasUploadingAttachment = Number(
        capability.attachment_uploading_count || capability.attachmentUploadingCount || 0,
      ) > 0
        || (uniqueAttachmentSnapshot && Number(uniqueAttachmentSnapshot.uploadingCount || 0) > 0)
        || (typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading());
      // hasPayload: 有文本、有附件、或附件上传中，三者任一均视为有内容可发送
      const hasPayload = hasComposerText || hasAttachment || hasUploadingAttachment;

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
          const nativeButtonReady = sendPipelineIsNativeSendButtonReady(sendSnap, capability);
          if (nativeButtonReady && hasComposerText) {
            sendPipelineLog('[SEND_PIPELINE][TEXT_SYNC_MISMATCH_ALLOWED]', Object.assign({}, ctx, {
              reason: String(syncCheck.reason || 'composer_text_not_synced'),
              composer_len: composerText.length,
              expected_len: String(expectedText || '').length,
            }));
            return {
              ok: true,
              reason: 'send-button-ready-text-sync-mismatch-allowed',
              useEnterFallback: false,
              textSynced: false,
            };
          }
          return {
            ok: false,
            reason: String(syncCheck.reason || 'composer_text_not_synced'),
            retryable: true,
            needRewriteText: true,
          };
        }
      }

      const nativeReadyWithoutText = (
        ctx.sendExistingComposer
        && !hasComposerText
        && !hasAttachment
        && !hasUploadingAttachment
        && sendPipelineIsNativeSendButtonReady(sendSnap, capability)
      );
      const nativeButtonReady = sendPipelineIsNativeSendButtonReady(sendSnap, capability);

      if (hasUploadingAttachment && !nativeButtonReady) {
        sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
          reason: 'waiting_attachment_upload_done',
        });
        await sendPipelineSleep(intervalMs);
        continue;
      }

      // 以 ChatGPT 原生发送按钮为准：存在、可见、未 disabled，且页面未在回答中
      if ((hasPayload || nativeReadyWithoutText) && nativeButtonReady) {
        if (hasAttachment && !hasUploadingAttachment) {
          sendPipelineLogAttachmentWait('[SEND][ATTACHMENT_READY_NATIVE_BUTTON_READY]', {
            reason: 'send_button_ready',
          });
        }
        sendPipelineLog('[SEND_PIPELINE][BUTTON_READY]', {
          source: ctx.source,
          mode: ctx.mode,
          text_len: composerText.length,
          has_attachment: hasAttachment ? 1 : 0,
          has_uploading: hasUploadingAttachment ? 1 : 0,
          sendExistingComposer: ctx.sendExistingComposer ? 1 : 0,
          reason: nativeReadyWithoutText
            ? 'native_send_button_ready_without_text_detector'
            : (hasComposerText ? 'send_button_ready' : 'send_button_ready_attachment_only'),
        });
        return {
          ok: true,
          reason: nativeReadyWithoutText
            ? 'native_send_button_ready_without_text_detector'
            : (hasComposerText ? 'send_button_ready' : 'send_button_ready_attachment_only'),
          useEnterFallback: false,
        };
      }

      const blockEnterFallback = typeof shouldBlockEnterFallbackForComposer === 'function'
        && shouldBlockEnterFallbackForComposer();

      if (
        !blockEnterFallback
        && allowDisabledWithText
        && hasPayload
        && sendSnap.button
        && Date.now() - startedAt >= maxDisabledWaitMs
      ) {
        useEnterFallback = true;
        sendPipelineLog('[SEND_PIPELINE][BUTTON_READY]', {
          source: ctx.source,
          mode: ctx.mode,
          text_len: composerText.length,
          has_attachment: hasAttachment ? 1 : 0,
          sendExistingComposer: ctx.sendExistingComposer ? 1 : 0,
          reason: 'send_button_disabled_use_enter_fallback',
        });
        return {
          ok: true,
          reason: 'send_button_disabled_use_enter_fallback',
          useEnterFallback: true,
        };
      }

      if (!blockEnterFallback && hasPayload && !sendSnap.button && Date.now() - startedAt >= maxDisabledWaitMs) {
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

    const finalHasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
    const finalAttachmentUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
      && ComposerApi.isAttachmentStillUploading();
    const finalHasPayload = finalHasText || finalHasAttachment || finalAttachmentUploading;
    const finalSendSnap = typeof getComposerSendButtonSnapshot === 'function'
      ? getComposerSendButtonSnapshot({ silent: true })
      : { found: false, ready: false };
    const finalCapability = typeof getPageCapability === 'function'
      ? getPageCapability('send-pipeline-wait-button-final')
      : {};
    const finalNativeReady = sendPipelineIsNativeSendButtonReady(finalSendSnap, finalCapability);
    const blockEnterFallback = typeof shouldBlockEnterFallbackForComposer === 'function'
      && shouldBlockEnterFallbackForComposer();

    if (finalNativeReady && (finalHasPayload || ctx.sendExistingComposer)) {
      if (finalHasAttachment && !finalAttachmentUploading) {
        sendPipelineLogAttachmentWait('[SEND][ATTACHMENT_READY_NATIVE_BUTTON_READY]', {
          reason: 'send_button_ready',
        });
      }
      return {
        ok: true,
        reason: finalHasText ? 'send_button_ready' : 'send_button_ready_attachment_only',
        useEnterFallback: false,
      };
    }

    if (finalHasAttachment && (finalAttachmentUploading || !finalNativeReady)) {
      sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
        reason: 'waiting_attachment_upload_done',
      });
      return {
        ok: false,
        reason: 'waiting_attachment_upload_done',
        retryable: true,
        wait_send: true,
        wait_reply: false,
      };
    }

    if (!blockEnterFallback && allowDisabledWithText && finalHasPayload) {
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
    const requireUploadDone = opts.requireUploadDone !== false;
    const requireAttachmentBound = opts.requireAttachmentBound !== false;
    const waitForAttachmentReady = opts.waitForAttachmentReady != null
      ? opts.waitForAttachmentReady !== false
      : requireUploadDone;
    const allowEnterFallback = opts.allowEnterFallback !== false;
    const allowWaitPayload = opts.allowWaitPayload !== false;
    const manualSend = opts.manualSend === true;
    const maxAttempts = Math.max(1, Number(opts.maxAttempts || 8));
    const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
    const writeTextBeforeAttachmentWait = opts.writeTextBeforeAttachmentWait === true;
    const attachmentWaitTimeoutMs = Number(opts.attachmentWaitTimeoutMs || 0);
    let buttonMaxDisabledWaitMs = Number(opts.buttonMaxDisabledWaitMs || 0);
    let buttonMaxAttempts = Number(opts.buttonMaxAttempts || 0);
    let buttonIntervalMs = Number(opts.buttonIntervalMs || 0);

    if (manualSend) {
      if (buttonMaxAttempts <= 0) {
        buttonMaxAttempts = SEND_PIPELINE_MANUAL_BUTTON_WAIT_MAX_ATTEMPTS;
      }
      if (buttonIntervalMs <= 0) {
        buttonIntervalMs = SEND_PIPELINE_MANUAL_BUTTON_WAIT_INTERVAL_MS;
      }
      if (buttonMaxDisabledWaitMs <= 0) {
        buttonMaxDisabledWaitMs = SEND_PIPELINE_MANUAL_BUTTON_DISABLED_WAIT_MS;
      }
    }

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

    // 防误发校验：autoqueue-batch-send 只有在已验证 composer 文本存在时，才允许 sendExistingComposer=true。
    if (mode === 'autoqueue-batch-send' && sendExistingComposer === true) {
      const expected = String(text || '').trim();
      const actual = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';

      const expectedNorm = expected.replace(/\s+/g, ' ');
      const actualNorm = actual.replace(/\s+/g, ' ');
      const expectedProbe = expectedNorm.slice(0, Math.min(80, expectedNorm.length));
      const verified = Boolean(actualNorm && expectedNorm && (actualNorm === expectedNorm || actualNorm.includes(expectedProbe)));

      if (!verified) {
        result.reason = 'verified_prompt_missing_for_sendExistingComposer';
        result.retryable = true;
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
        return result;
      }
    }

    sendPipelineLog('[SEND_PIPELINE][START]', {
      source,
      mode,
      text_len: sendExistingComposer
        ? (typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim().length
          : 0)
        : text.length,
      sendExistingComposer,
      reason: manualSend ? 'manual_send=1' : '-',
    });

    if (manualSend) {
      const composerTextLen = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim().length
        : 0;
      const attachmentSnapshot = typeof ComposerApi.getUniqueComposerAttachmentSnapshot === 'function'
        ? ComposerApi.getUniqueComposerAttachmentSnapshot({ reason: 'send-click' })
        : null;
      const attachmentCount = attachmentSnapshot
        ? Number(attachmentSnapshot.uniqueCount || 0)
        : (
          typeof ComposerApi.countAttachmentChips === 'function'
            ? ComposerApi.countAttachmentChips()
            : 0
        );
      const uploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
        && ComposerApi.isAttachmentStillUploading();
      let nativeReady = 0;
      try {
        if (typeof getComposerSendButtonSnapshot === 'function') {
          const snap = getComposerSendButtonSnapshot({ silent: true });
          nativeReady = snap && snap.ready ? 1 : 0;
        }
      } catch (snapErr) {
        console.error('[ChatGPT toolbox] sendUnifiedMessage manual FAST_PATH nativeReady failed', snapErr);
      }
      const fastLine = [
        '[SEND_MESSAGE][FAST_PATH_CHECK]',
        `source=${source}`,
        `mode=${mode}`,
        `textLen=${composerTextLen}`,
        `attachmentCount=${attachmentCount}`,
        `uploading=${uploading ? 1 : 0}`,
        `nativeReady=${nativeReady}`,
      ].join(' ');
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(fastLine);
        ToolboxShell.appendLog(
          `[SEND_MESSAGE][CLICK] source=${source} textLen=${composerTextLen} attachmentUniqueCount=${attachmentCount} nativeReady=${nativeReady} url=${location.href || '-'}`,
        );
      } else {
        console.log(fastLine);
        console.log(`[SEND_MESSAGE][CLICK] source=${source} textLen=${composerTextLen} attachmentUniqueCount=${attachmentCount} nativeReady=${nativeReady} url=${location.href || '-'}`);
      }
    }

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
          const composerTextLen = typeof ComposerApi.getComposerText === 'function'
            ? String(ComposerApi.getComposerText() || '').trim().length
            : 0;
          const attachmentSnapshot = typeof ComposerApi.getUniqueComposerAttachmentSnapshot === 'function'
            ? ComposerApi.getUniqueComposerAttachmentSnapshot({ reason: 'blocked-assistant-busy' })
            : null;
          const attachmentCount = attachmentSnapshot ? Number(attachmentSnapshot.uniqueCount || 0) : 0;
          result.reason = 'assistant_busy';
          result.wait_reply = true;
          result.retryable = true;
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(
              `[SEND_MESSAGE][BLOCKED_BY_ASSISTANT_BUSY] hasPayload=${composerTextLen > 0 || attachmentCount > 0 ? 1 : 0} textLen=${composerTextLen} attachmentCount=${attachmentCount}`,
            );
            if (typeof ToolboxShell.setStatus === 'function') {
              ToolboxShell.setStatus('助手正在回复，当前不能发送新消息', 'warning', {
                owner: 'send',
              });
            }
            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('助手正在回复，当前不能发送新消息', 'warn', 1800);
            }
          }
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            wait_reply: true,
            retryable: true,
          }));
          return result;
        }
      }

      let textAlreadySynced = false;

      // Optional optimization: try to write prompt text as soon as possible,
      // without waiting attachments to become stable (still wait before sending).
      if (
        writeTextBeforeAttachmentWait
        && text
        && !sendExistingComposer
      ) {
        for (let retryIndex = 0; retryIndex < SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES; retryIndex += 1) {
          if (shouldStop()) {
            result.reason = 'cancelled';
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          }

          const syncCheck = await sendPipelineWriteAndVerifyText(text, source, retryIndex, ctx);
          if (syncCheck.ok) {
            textAlreadySynced = true;
            sendPipelineLog('[SEND_PIPELINE][EARLY_TEXT_SYNC_OK]', Object.assign({}, ctx, {
              reason: 'write-before-attachment-wait',
            }));
            break;
          }

          sendPipelineLog('[SEND_PIPELINE][EARLY_TEXT_SYNC_RETRY]', Object.assign({}, ctx, {
            reason: String(syncCheck.reason || 'composer_text_not_synced'),
            retryable: true,
          }));
        }

        if (!textAlreadySynced) {
          result.reason = 'composer_text_not_ready_before_attachment_wait';
          result.retryable = true;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
            reason: result.reason,
            retryable: true,
          }));
          return result;
        }
      }

      if (waitForAttachmentReady && typeof waitAttachmentsStableForSend === 'function') {
        const stillUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading();
        const composerHasRealAttachment = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
          ? ComposerApi.hasComposerAttachmentUnified()
          : (
            typeof ComposerApi.countAttachmentChips === 'function'
              && ComposerApi.countAttachmentChips() > 0
          );
        if (stillUploading && !composerHasRealAttachment && !allowWaitPayload) {
          result.reason = 'empty_text_and_no_attachment';
          result.retryable = false;
          result.wait_send = false;
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
          return result;
        }
        if (stillUploading && composerHasRealAttachment) {
          sendPipelineLog('[SEND_PIPELINE][ATTACHMENT_WAIT_AFTER_TEXT]', Object.assign({}, ctx, {
            reason: textAlreadySynced ? 'text-written-wait-attachment' : 'wait-attachment-before-text',
          }));
          const defaultAttachWaitMs = typeof MAX_ATTACHMENT_SEND_WAIT_MS === 'number'
            ? MAX_ATTACHMENT_SEND_WAIT_MS
            : 120000;
          const attachWaitMs = attachmentWaitTimeoutMs > 0
            ? attachmentWaitTimeoutMs
            : (manualSend ? SEND_PIPELINE_MANUAL_ATTACHMENT_WAIT_MS : defaultAttachWaitMs);
          const attachWait = await waitAttachmentsStableForSend(
            attachWaitMs,
            shouldStop,
            { source },
          );
          if (!attachWait || attachWait.ok !== true) {
            if (manualSend) {
              result.reason = 'waiting_attachment_upload_done';
              result.retryable = true;
              result.wait_send = true;
              result.wait_reply = false;
              sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
                reason: result.reason,
              });
              return result;
            }
            result.reason = (attachWait && attachWait.reason) || 'attachment_not_ready';
            result.retryable = sendPipelineIsRetryableReason(result.reason);
            result.wait_send = result.retryable;
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
              reason: result.reason,
              retryable: result.retryable,
            }));
            return result;
          }
        }
      }

      if (
        textAlreadySynced
        && text
        && !sendExistingComposer
      ) {
        if (shouldStop()) {
          result.reason = 'cancelled';
          sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
          return result;
        }

        const syncCheckAfterAttachment = typeof ComposerApi.checkComposerTextSyncDetailed === 'function'
          ? ComposerApi.checkComposerTextSyncDetailed(text)
          : {
            ok: typeof ComposerApi.isComposerTextSynced === 'function'
              && ComposerApi.isComposerTextSynced(text),
            reason: 'composer_text_not_synced_after_attachment_wait',
          };

        if (!syncCheckAfterAttachment.ok) {
          sendPipelineLog('[SEND_PIPELINE][EARLY_TEXT_LOST_REWRITE]', Object.assign({}, ctx, {
            reason: String(syncCheckAfterAttachment.reason || 'composer_text_lost_after_attachment_wait'),
            retryable: true,
          }));

          if (shouldStop()) {
            result.reason = 'cancelled';
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          }

          const rewriteCheck = await sendPipelineWriteAndVerifyText(
            text,
            source,
            SEND_PIPELINE_COMPOSER_SYNC_MAX_RETRIES,
            ctx,
          );

          if (!rewriteCheck.ok) {
            result.reason = String(rewriteCheck.reason || 'composer_text_lost_after_attachment_wait');
            result.retryable = true;
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
              reason: result.reason,
              retryable: true,
            }));
            return result;
          }
        }
      }

      let useEnterFallback = false;

      if (text && !sendExistingComposer && !textAlreadySynced) {
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
        const attachmentUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading();

        let nativeReady = false;
        try {
          let sendSnap = null;
          if (typeof getComposerSendButtonSnapshot === 'function') {
            sendSnap = getComposerSendButtonSnapshot({ silent: true });
          }
          if (!sendSnap || sendSnap.found !== true) {
            const fallbackButton = (
              typeof ComposerApi !== 'undefined'
              && typeof ComposerApi.findSendButton === 'function'
            )
              ? ComposerApi.findSendButton({ silent: true })
              : null;
            const fallbackReady = !!(
              fallbackButton instanceof HTMLButtonElement
              && (
                typeof ComposerApi === 'undefined'
                || typeof ComposerApi.isSendButtonReady !== 'function'
                || ComposerApi.isSendButtonReady(fallbackButton)
              )
            );
            sendSnap = {
              found: fallbackButton instanceof HTMLButtonElement,
              ready: fallbackReady,
            };
          }
          nativeReady = !!(sendSnap && sendSnap.ready);
        } catch (snapErr) {
          console.error('[ChatGPT toolbox] sendUnifiedMessage nativeReady probe failed', snapErr);
        }

        const hasPayload = !!existingText
          || (typeof hasComposerAttachment === 'function' && hasComposerAttachment())
          || attachmentUploading
          || nativeReady;

        try {
          const textLen = existingText.length;
          const line = [
            '[SEND_MESSAGE][TEXT_DETECT]',
            `source=${source}`,
            `mode=${mode}`,
            `textLen=${textLen}`,
            `nativeReady=${nativeReady ? 1 : 0}`,
            `hasAttachment=${typeof hasComposerAttachment === 'function' && hasComposerAttachment() ? 1 : 0}`,
            `uploading=${attachmentUploading ? 1 : 0}`,
          ].join(' ');
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(line);
          } else {
            console.log(line);
          }
        } catch (logErr) {
          console.error('[ChatGPT toolbox] sendUnifiedMessage TEXT_DETECT log failed', logErr);
        }

        const composerStateLine = [
          '[SEND_MESSAGE][COMPOSER_STATE]',
          `source=${source}`,
          `mode=${mode}`,
          `textLen=${existingText.length}`,
          `attachmentCount=${typeof ComposerApi.countAttachmentChips === 'function' ? ComposerApi.countAttachmentChips() : 0}`,
          `uploading=${attachmentUploading ? 1 : 0}`,
          `nativeReady=${nativeReady ? 1 : 0}`,
        ].join(' ');
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(composerStateLine);
        } else {
          console.log(composerStateLine);
        }

        if (!hasPayload) {
          if (!allowWaitPayload) {
            result.reason = 'empty_text_and_no_attachment';
            result.retryable = false;
            result.wait_send = false;
            result.wait_reply = false;
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          }
          result.reason = 'waiting_payload';
          result.retryable = true;
          result.wait_send = true;
          result.wait_reply = false;
          sendPipelineLog('[SEND][WAIT_PAYLOAD]', Object.assign({}, ctx, {
            reason: result.reason,
            wait_send: true,
            wait_reply: false,
          }));
          return result;
        }

        if (attachmentUploading && !nativeReady) {
          if (manualSend) {
            result.reason = 'waiting_attachment_upload_done';
            result.retryable = true;
            result.wait_send = true;
            result.wait_reply = false;
            sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
              reason: result.reason,
            });
            return result;
          } else if (!allowWaitPayload) {
            result.reason = 'attachment_still_uploading';
            result.retryable = false;
            result.wait_send = false;
            result.wait_reply = false;
            sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, { reason: result.reason }));
            return result;
          } else {
            result.reason = 'waiting_attachment_upload_done';
            result.retryable = true;
            result.wait_send = true;
            result.wait_reply = false;
            sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
              reason: result.reason,
            });
            return result;
          }
        }

        if (manualSend && nativeReady && hasPayload) {
          sendPipelineLog('[SEND_MESSAGE][FAST_PATH_READY]', Object.assign({}, ctx, {
            reason: 'native_ready_with_payload',
            text_len: existingText.length,
          }));
        }
      }

      const buttonWaitOptions = {
        requireText: !sendExistingComposer || !!text,
        expectedText: text && !sendExistingComposer ? text : '',
        allowDisabledWithText: allowEnterFallback,
      };

      if (buttonMaxAttempts > 0) {
        buttonWaitOptions.maxAttempts = buttonMaxAttempts;
      }
      if (buttonIntervalMs > 0) {
        buttonWaitOptions.intervalMs = buttonIntervalMs;
      }
      if (buttonMaxDisabledWaitMs > 0) {
        buttonWaitOptions.maxDisabledWaitMs = buttonMaxDisabledWaitMs;
      }

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

      if (!buttonWait.ok && sendPipelineNativeSendReadyNow()) {
        sendPipelineLog('[SEND_PIPELINE][NATIVE_READY_OVERRIDE]', {
          source: ctx.source,
          mode: ctx.mode,
          reason: 'native_send_button_ready_skip_button_wait_failure',
          prior_reason: String(buttonWait.reason || '-'),
        });
        buttonWait = {
          ok: true,
          reason: 'send_button_ready',
          useEnterFallback: false,
        };
      }

      if (!buttonWait.ok) {
        result.reason = String(buttonWait.reason || 'send_button_not_found');
        if (buttonWait.wait_reply) {
          result.wait_reply = true;
        }
        if (buttonWait.wait_send) {
          result.wait_send = true;
        }
        result.retryable = buttonWait.retryable === true
          || sendPipelineIsRetryableReason(result.reason);
        const hasAttachmentOnFail = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
        const attachmentStillUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading();
        const nativeReadyOnFail = sendPipelineNativeSendReadyNow();
        if (
          hasAttachmentOnFail
          && !nativeReadyOnFail
          && (
            attachmentStillUploading
            || result.reason === 'waiting_attachment_upload_done'
            || result.reason === 'waiting_attachment_upload'
          )
        ) {
          result.reason = 'waiting_attachment_upload_done';
          result.wait_reply = false;
          result.wait_send = true;
          result.retryable = true;
          sendPipelineLogAttachmentWait('[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]', {
            reason: result.reason,
          });
        } else if (
          hasAttachmentOnFail
          && !nativeReadyOnFail
          && (result.reason === 'send_button_not_found' || result.reason === 'send_button_not_ready_after_text')
        ) {
          result.reason = 'waiting_attachment_upload_done';
          result.wait_reply = false;
          result.wait_send = true;
          result.retryable = true;
        }
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
          reason: result.reason,
          retryable: result.retryable,
          wait_send: result.wait_send ? 1 : 0,
          wait_reply: result.wait_reply,
        }));
        return result;
      }

      useEnterFallback = allowEnterFallback && buttonWait.useEnterFallback === true;

      const blockEnterForSend = useEnterFallback
        && typeof shouldBlockEnterFallbackForComposer === 'function'
        && shouldBlockEnterFallbackForComposer();

      if (blockEnterForSend && !sendPipelineNativeSendReadyNow()) {
        if (typeof logSendPreSendGate === 'function') {
          logSendPreSendGate({ source, mode });
        }
        result.reason = 'enter_fallback_blocked_with_attachment';
        result.retryable = true;
        result.wait_send = true;
        result.wait_reply = false;
        sendPipelineLog('[SEND_PIPELINE][FAILED]', Object.assign({}, ctx, {
          reason: result.reason,
          retryable: result.retryable,
          wait_send: result.wait_send ? 1 : 0,
          wait_reply: result.wait_reply,
        }));
        return result;
      }

      if (blockEnterForSend && sendPipelineNativeSendReadyNow()) {
        sendPipelineLog('[SEND_PIPELINE][NATIVE_READY_OVERRIDE]', Object.assign({}, ctx, {
          reason: 'native_send_button_ready_skip_enter_fallback_block',
        }));
        useEnterFallback = false;
      }

      if (typeof logSendPreSendGate === 'function') {
        logSendPreSendGate({ source, mode });
      }

      const responseStateNow = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState()
        : {};
      const sendBtnNow = typeof ComposerApi.findSendButton === 'function'
        ? ComposerApi.findSendButton({ silent: true })
        : null;
      const sendButtonDisabledNow = !(sendBtnNow instanceof HTMLButtonElement)
        ? true
        : !!sendBtnNow.disabled;
      const hasAttachmentNow = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
        ? !!ComposerApi.hasComposerAttachmentUnified()
        : (
          typeof ComposerApi.countAttachmentChips === 'function'
            ? ComposerApi.countAttachmentChips() > 0
            : false
        );
      const textLenNow = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim().length
        : ctx.text_len;

      // 发送前断言/观测：用于定位“附件已在输入框但文案未注入”的异常链路。
      sendPipelineLog('[SEND_PIPELINE][PRE_SEND_PAYLOAD]', {
        source,
        mode,
        textLen: textLenNow,
        hasAttachment: hasAttachmentNow ? 1 : 0,
        sendButtonDisabled: sendButtonDisabledNow ? 1 : 0,
        responseState: String(responseStateNow.response_state || '-'),
        reason: String(responseStateNow.response_state_reason || buttonWait.reason || '-'),
        sendExistingComposer: sendExistingComposer ? 1 : 0,
      });

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
