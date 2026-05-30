  /********************************************************************
   * UploadSendFlow：Composer 发送流程（委托 upload-module 既有实现）
   ********************************************************************/

  const UploadSendFlow = (() => {
    function create(deps) {
      const {
        log,
        setStatus,
        getComposerText,
        setComposerText,
        findSendButton,
        clickSendButton,
        getPageCapability,
        renderUploadButtonsOnly,
        markSendTaskPhase,
        legacySendCurrentComposerMessage,
        legacySendTextOnlyMessage,
      } = deps;

      function appendSendLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function sendCurrentComposerMessage(sourceOrOptions) {
        const options = sourceOrOptions && typeof sourceOrOptions === 'object'
          ? sourceOrOptions
          : { source: sourceOrOptions };
        const source = String(options.source || '-').trim() || '-';

        appendSendLog(`[UPLOAD_SEND_FLOW][START] source=${source}`);

        const capability = typeof getPageCapability === 'function'
          ? getPageCapability('send-flow')
          : null;
        if (capability && capability.sendable === false) {
          appendSendLog(
            `[UPLOAD_SEND_FLOW][BLOCKED_NOT_SENDABLE] source=${source} responseState=${capability.response_state || '-'} reason=${capability.response_state_reason || '-'}`,
          );
          if (typeof setStatus === 'function') {
            setStatus('当前页面不可发送，等待回复结束或输入框恢复', 'warn');
          }
          if (typeof renderUploadButtonsOnly === 'function') {
            renderUploadButtonsOnly('send-flow:not-sendable');
          }
          return {
            ok: false,
            reason: 'not_sendable',
          };
        }

        const text = typeof getComposerText === 'function'
          ? String(getComposerText() || '')
          : '';
        appendSendLog(`[UPLOAD_SEND_FLOW][COMPOSER_TEXT] source=${source} len=${text.length}`);

        if (typeof legacySendCurrentComposerMessage === 'function') {
          if (typeof markSendTaskPhase === 'function') {
            markSendTaskPhase('running', source);
          }
          if (typeof renderUploadButtonsOnly === 'function') {
            renderUploadButtonsOnly('send-flow:start');
          }

          const result = await legacySendCurrentComposerMessage(options);

          if (result && result.ok) {
            appendSendLog(`[UPLOAD_SEND_FLOW][CLICK_OK] source=${source}`);
            if (typeof markSendTaskPhase === 'function') {
              markSendTaskPhase('ok', source);
            }
            if (typeof renderUploadButtonsOnly === 'function') {
              renderUploadButtonsOnly('send-flow:finish');
            }
            return result;
          }

          appendSendLog(
            `[UPLOAD_SEND_FLOW][CLICK_FAIL] source=${source} reason=${result && result.reason ? result.reason : 'send_failed'}`,
          );
          if (typeof markSendTaskPhase === 'function') {
            markSendTaskPhase('failed', source);
          }
          if (typeof renderUploadButtonsOnly === 'function') {
            renderUploadButtonsOnly('send-flow:click-fail');
          }
          return result || { ok: false, reason: 'send_failed' };
        }

        const sendButton = typeof findSendButton === 'function' ? findSendButton() : null;
        if (!sendButton) {
          appendSendLog(`[UPLOAD_SEND_FLOW][NO_SEND_BUTTON] source=${source}`);
          if (typeof setStatus === 'function') {
            setStatus('未找到发送按钮', 'danger');
          }
          return { ok: false, reason: 'no_send_button' };
        }

        if (typeof markSendTaskPhase === 'function') {
          markSendTaskPhase('running', source);
        }

        const clicked = typeof clickSendButton === 'function'
          ? await clickSendButton(sendButton, source)
          : false;
        if (!clicked) {
          appendSendLog(`[UPLOAD_SEND_FLOW][CLICK_FAIL] source=${source}`);
          if (typeof markSendTaskPhase === 'function') {
            markSendTaskPhase('failed', source);
          }
          return { ok: false, reason: 'click_failed' };
        }

        appendSendLog(`[UPLOAD_SEND_FLOW][CLICK_OK] source=${source}`);
        if (typeof markSendTaskPhase === 'function') {
          markSendTaskPhase('ok', source);
        }
        return { ok: true };
      }

      async function sendTextOnlyMessage(text, source) {
        const finalText = String(text || '');
        appendSendLog(`[UPLOAD_SEND_FLOW][SEND_TEXT_ONLY] source=${source || '-'} len=${finalText.length}`);

        if (!finalText.trim()) {
          appendSendLog(`[UPLOAD_SEND_FLOW][EMPTY_TEXT_BLOCKED] source=${source || '-'}`);
          return { ok: false, reason: 'empty_text' };
        }

        if (typeof legacySendTextOnlyMessage === 'function') {
          return legacySendTextOnlyMessage(finalText, source);
        }

        if (typeof setComposerText === 'function') {
          await setComposerText(finalText, source);
        }
        return sendCurrentComposerMessage(source);
      }

      return {
        sendCurrentComposerMessage,
        sendTextOnlyMessage,
      };
    }

    return { create };
  })();
