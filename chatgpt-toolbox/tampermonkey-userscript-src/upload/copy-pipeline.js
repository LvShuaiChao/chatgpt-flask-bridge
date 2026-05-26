  /********************************************************************
   * CopyPipeline：复制链路三层拆分（取文 / 写剪贴板 / 组合）
   * SINGLE SOURCE OF TRUTH for assistant-reply copy + clipboard verify.
   ********************************************************************/

  const CopyPipeline = (() => {
    function normalizeClipboardTextForCompare(text) {
      return String(text || '')
        .replace(/\r\n/g, '\n')
        .trim();
    }

    function getLatestAssistantReplyText(options = {}) {
      const label = String(options.label || 'get-latest-assistant-reply').trim() || 'get-latest-assistant-reply';

      try {
        if (typeof getLatestAssistantMessageForCopy === 'function') {
          const picked = getLatestAssistantMessageForCopy({
            forceRefresh: options.forceRefresh !== false,
          });
          if (picked && picked.ok && picked.text) {
            const text = String(picked.text).trim();
            if (text && !(typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(text))) {
              return { ok: true, text, reason: 'ok' };
            }
            if (text) {
              return { ok: false, text: '', reason: 'latest_assistant_reply_invalid' };
            }
          }
        }

        if (
          typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.buildRecords === 'function'
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
        ) {
          const records = ChatMessageExtractor.buildRecords({ includeEmpty: false });
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

          if (picked && picked.ok && picked.record) {
            const recordText = String(picked.record.text || '').trim();
            if (recordText && !(typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(recordText))) {
              return { ok: true, text: recordText, reason: 'ok' };
            }
            if (recordText) {
              return { ok: false, text: '', reason: 'latest_assistant_reply_invalid' };
            }
          }
        }

        if (typeof findLastAssistantTurn === 'function' && typeof extractAssistantText === 'function') {
          const turn = findLastAssistantTurn();
          const turnText = String(extractAssistantText(turn) || '').trim();
          if (turnText) {
            return { ok: true, text: turnText, reason: 'ok' };
          }
        }

        const assistantNodes = Array.from(
          document.querySelectorAll('[data-message-author-role="assistant"]'),
        );

        for (let i = assistantNodes.length - 1; i >= 0; i -= 1) {
          const lastNode = assistantNodes[i];

          if (!(lastNode instanceof HTMLElement)) {
            continue;
          }

          if (typeof isInToolbox === 'function' && isInToolbox(lastNode)) {
            continue;
          }

          const text = String(lastNode.innerText || lastNode.textContent || '').trim();

          if (text && !(typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(text))) {
            return { ok: true, text, reason: 'ok' };
          }
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[COPY_PIPELINE][LATEST_READ_FAIL]', err);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[COPY_PIPELINE][LATEST_READ_FAIL] label=${label} error=${errText}`);
        }
        return { ok: false, text: '', reason: 'latest_assistant_read_exception', error: err };
      }

      return { ok: false, text: '', reason: 'latest_assistant_reply_not_found' };
    }

    async function writeClipboardAndVerify(text, options = {}) {
      const rawText = String(text ?? '');
      const label = String(options.label || 'clipboard').trim() || 'clipboard';

      if (!rawText.trim()) {
        return { ok: false, reason: 'empty_clipboard_text' };
      }

      if (typeof copyTextUnified !== 'function') {
        const missingErr = new Error('copyTextUnified-missing');
        console.error(`[CLIPBOARD][WRITE_FAIL] label=${label}`, missingErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[CLIPBOARD][WRITE_FAIL] label=${label} error=${missingErr.message}`);
        }
        return { ok: false, reason: 'clipboard_write_failed', error: missingErr };
      }

      const copied = await copyTextUnified(rawText, `clipboard:${label}`);
      if (!copied) {
        const writeErr = new Error('copyTextUnified-returned-false');
        console.error(`[CLIPBOARD][WRITE_FAIL] label=${label}`, writeErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[CLIPBOARD][WRITE_FAIL] label=${label} error=${writeErr.message}`);
        }
        return { ok: false, reason: 'clipboard_write_failed', error: writeErr };
      }

      const canReadClipboard = !!(
        navigator.clipboard
        && typeof navigator.clipboard.readText === 'function'
      );

      if (!canReadClipboard) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[CLIPBOARD][VERIFY_SKIP] label=${label} reason=readText-unavailable chars=${rawText.length}`);
        }
        return { ok: true, reason: 'ok', verified: false };
      }

      let current = '';
      try {
        current = String(await navigator.clipboard.readText() || '');
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error(`[CLIPBOARD][READ_VERIFY_FAIL] label=${label}`, err);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[CLIPBOARD][READ_VERIFY_FAIL] label=${label} error=${errText}`);
        }
        return { ok: false, reason: 'clipboard_read_verify_failed', error: err };
      }

      if (normalizeClipboardTextForCompare(current) !== normalizeClipboardTextForCompare(rawText)) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[CLIPBOARD][VERIFY_MISMATCH] label=${label} expectedLen=${rawText.length} actualLen=${String(current || '').length}`,
          );
        }
        return { ok: false, reason: 'clipboard_verify_mismatch' };
      }

      return { ok: true, reason: 'ok', verified: true };
    }

    return {
      getLatestAssistantReplyText,
      writeClipboardAndVerify,
      normalizeClipboardTextForCompare,
    };
  })();

  function getLastAssistantReplyTextUnified() {
    if (typeof CopyPipeline !== 'undefined' && typeof CopyPipeline.getLatestAssistantReplyText === 'function') {
      const picked = CopyPipeline.getLatestAssistantReplyText({
        label: 'getLastAssistantReplyTextUnified',
        forceRefresh: true,
      });
      if (picked && picked.ok && picked.text) {
        const pipelineText = String(picked.text).trim();
        if (pipelineText) {
          console.log('[GET_LAST_REPLY][OK]', {
            textLength: pipelineText.length,
            source: 'CopyPipeline',
          });
          return pipelineText;
        }
      }
    }

    const candidates = [
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"]',
      '.markdown',
    ];

    let assistantNodes = [];

    for (const selector of candidates) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length > 0) {
        assistantNodes = nodes;
        break;
      }
    }

    if (!assistantNodes.length) {
      console.warn('[GET_LAST_REPLY][NOT_FOUND]', {
        url: location.href,
      });
      return '';
    }

    for (let i = assistantNodes.length - 1; i >= 0; i -= 1) {
      const node = assistantNodes[i];
      const text = String(node.innerText || node.textContent || '').trim();

      if (text) {
        console.log('[GET_LAST_REPLY][OK]', {
          textLength: text.length,
          selectorIndex: i,
        });
        return text;
      }
    }

    console.warn('[GET_LAST_REPLY][EMPTY]', {
      nodeCount: assistantNodes.length,
      url: location.href,
    });

    return '';
  }

  async function copyLastAssistantReplyUnified(reason = 'copy-last-assistant-reply', options = {}) {
    const prefilled = options && options.text != null ? String(options.text).trim() : '';
    const text = prefilled || getLastAssistantReplyTextUnified();

    if (!text || !String(text).trim()) {
      console.warn('[COPY_LAST_REPLY][SKIP_EMPTY]', {
        reason,
        url: location.href,
      });
      return false;
    }

    return copyTextUnified(text, reason);
  }
