  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

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

      function readSendFlowAuthoritySnapshot(source) {
        const reason = `upload-send-flow:${source || '-'}`;
        try {
          if (
            typeof window !== 'undefined'
            && window.ToolboxButtonState
            && typeof window.ToolboxButtonState.resolveButtonAuthoritySnapshot === 'function'
          ) {
            return window.ToolboxButtonState.resolveButtonAuthoritySnapshot(reason);
          }
          if (
            typeof ButtonState !== 'undefined'
            && ButtonState
            && typeof ButtonState.resolveButtonAuthoritySnapshot === 'function'
          ) {
            return ButtonState.resolveButtonAuthoritySnapshot(reason);
          }
        } catch (error) {
          console.error('[UPLOAD_SEND_FLOW][AUTHORITY_READ_FAILED]', error);
          appendSendLog(
            `[UPLOAD_SEND_FLOW][AUTHORITY_READ_FAILED] source=${source || '-'} `
            + `error=${error && error.message ? error.message : String(error)}`,
          );
        }
        return null;
      }

      async function candidateSendCurrentComposerMessage(sourceOrOptions) {
        const options = sourceOrOptions && typeof sourceOrOptions === 'object'
          ? sourceOrOptions
          : { source: sourceOrOptions };
        const source = String(options.source || '-').trim() || '-';

        appendSendLog(`[UPLOAD_SEND_FLOW][START] candidate=1 source=${source}`);

        const authoritySnapshot = readSendFlowAuthoritySnapshot(source);
        if (authoritySnapshot) {
          appendSendLog(
            `[UPLOAD_SEND_FLOW][AUTHORITY_USED] source=${source} `
            + `sendable=${authoritySnapshot.sendable ? 1 : 0} `
            + `inputable=${authoritySnapshot.inputable ? 1 : 0} `
            + `replyBusy=${authoritySnapshot.replyBusy ? 1 : 0} `
            + `taskBusy=${authoritySnapshot.taskBusy ? 1 : 0} `
            + `pendingSend=${authoritySnapshot.pendingSend ? 1 : 0} `
            + `sendPhase=${authoritySnapshot.sendPhase || '-'} `
            + `disabledReason=${authoritySnapshot.disabledReason || '-'}`,
          );
          if (authoritySnapshot.sendable === false) {
            appendSendLog(
              `[UPLOAD_SEND_FLOW][BLOCKED_BY_AUTHORITY] source=${source} `
              + `responseState=${authoritySnapshot.responseState || '-'} `
              + `sendPhase=${authoritySnapshot.sendPhase || '-'} `
              + `reason=${authoritySnapshot.disabledReason || '-'}`,
            );
            if (typeof setStatus === 'function') {
              setStatus('当前页面不可发送，等待回复结束或输入框恢复', 'warn');
            }
            if (typeof renderUploadButtonsOnly === 'function') {
              renderUploadButtonsOnly('send-flow:authority-not-sendable');
            }
            return {
              ok: false,
              reason: authoritySnapshot.disabledReason || 'not_sendable',
            };
          }
        } else {
          appendSendLog(
            `[UPLOAD_SEND_FLOW][AUTHORITY_MISSING_FALLBACK_CAPABILITY] source=${source}`,
          );
          const capability = typeof getPageCapability === 'function'
            ? getPageCapability('send-flow:fallback')
            : null;
          if (capability && capability.sendable === false) {
            appendSendLog(
              `[UPLOAD_SEND_FLOW][BLOCKED_NOT_SENDABLE_FALLBACK] source=${source} `
              + `responseState=${capability.response_state || '-'} `
              + `reason=${capability.response_state_reason || '-'}`,
            );
            if (typeof setStatus === 'function') {
              setStatus('当前页面不可发送，等待回复结束或输入框恢复', 'warn');
            }
            if (typeof renderUploadButtonsOnly === 'function') {
              renderUploadButtonsOnly('send-flow:fallback-not-sendable');
            }
            return {
              ok: false,
              reason: 'not_sendable',
            };
          }
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

      async function candidateSendTextOnlyMessage(text, source) {
        const finalText = String(text || '');
        appendSendLog(`[UPLOAD_SEND_FLOW][SEND_TEXT_ONLY] candidate=1 source=${source || '-'} len=${finalText.length}`);

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
        return candidateSendCurrentComposerMessage(source);
      }

      return {
        candidateSendCurrentComposerMessage,
        candidateSendTextOnlyMessage,
      };
    }

    return { create };
  })();
