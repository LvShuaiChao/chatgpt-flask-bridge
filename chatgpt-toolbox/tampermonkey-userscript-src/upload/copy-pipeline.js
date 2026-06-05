  /********************************************************************
   * CopyPipeline：复制链路三层拆分（取文 / 写剪贴板 / 组合）
   * SINGLE SOURCE OF TRUTH for assistant-reply copy + clipboard verify.
   ********************************************************************/

  const CopyPipeline = (() => {
    function normalizeClipboardTextForCompare(text) {
      const normalizer = (
        typeof window !== 'undefined'
        && (window.ToolboxTextNormalizer || window.TextNormalizer)
      ) || (typeof TextNormalizer !== 'undefined' ? TextNormalizer : null);
      if (normalizer && typeof normalizer.normalizeClipboardTextForCompare === 'function') {
        return normalizer.normalizeClipboardTextForCompare(text);
      }
      console.error('[TEXT_NORMALIZER][MISSING] fn=normalizeClipboardTextForCompare');
      return String(text || '').replace(/\r\n/g, '\n').trim();
    }

    function stripChatGptInstrumentsLabel(text) {
      const normalizer = (
        typeof window !== 'undefined'
        && (window.ToolboxTextNormalizer || window.TextNormalizer)
      ) || (typeof TextNormalizer !== 'undefined' ? TextNormalizer : null);
      if (normalizer && typeof normalizer.stripLabel === 'function') {
        return normalizer.stripLabel(text);
      }
      console.error('[TEXT_NORMALIZER][MISSING] fn=stripLabel');
      return String(text == null ? '' : text);
    }

    function collapseInstrumentsCalculatorReply(text) {
      const normalizer = (
        typeof window !== 'undefined'
        && (window.ToolboxTextNormalizer || window.TextNormalizer)
      ) || (typeof TextNormalizer !== 'undefined' ? TextNormalizer : null);
      if (normalizer && typeof normalizer.collapseInstrumentsCalculatorReply === 'function') {
        return normalizer.collapseInstrumentsCalculatorReply(text);
      }
      console.error('[TEXT_NORMALIZER][MISSING] fn=collapseInstrumentsCalculatorReply');
      return String(text == null ? '' : text);
    }

    function sanitizeCopiedAssistantText(rawText) {
      const original = String(rawText || '');
      if (!original.trim()) {
        return '';
      }

      let text = original;

      const exactNoiseLines = [
        'Is this conversation helpful so far?',
        'Is this response helpful?',
        'Was this response helpful?',
        '这次对话目前有帮助吗？',
        '这次对话目前有帮助吗?',
        '这个回答有帮助吗？',
        '这个回答有帮助吗?',
        'ChatGPT Instruments',
        '提供反馈',
        'Provide feedback',
      ];

      const before = text;

      const lines = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          if (!t) {
            return true;
          }
          return !exactNoiseLines.includes(t);
        });

      text = lines.join('\n');

      text = text
        .replace(/\bIs this conversation helpful so far\?\b/gi, '')
        .replace(/\bIs this response helpful\?\b/gi, '')
        .replace(/\bWas this response helpful\?\b/gi, '')
        .replace(/这次对话目前有帮助吗[？?]/g, '')
        .replace(/这个回答有帮助吗[？?]/g, '')
        .replace(/ChatGPT\s*Instruments\s*/gi, '\n')
        .replace(/\n{2,}/g, '\n')
        .replace(/\b提供反馈\b/g, '')
        .replace(/\bProvide feedback\b/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      text = collapseInstrumentsCalculatorReply(text);

      if (before !== text) {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog('[COPY][SANITIZE_NOISE] removed=helpful-feedback-widget');
        } else {
          console.log('[COPY][SANITIZE_NOISE] removed=helpful-feedback-widget');
        }
      }

      return text;
    }

    function finalizeAssistantCopyText(rawText) {
      return sanitizeCopiedAssistantText(rawText);
    }

    function getLatestAssistantReplyText(options = {}) {
      const label = String(options.label || 'get-latest-assistant-reply').trim() || 'get-latest-assistant-reply';

      try {
        if (typeof getLatestAssistantMessageForCopy === 'function') {
          const picked = getLatestAssistantMessageForCopy({
            forceRefresh: options.forceRefresh !== false,
          });
          if (picked && picked.ok && picked.text) {
            const text = finalizeAssistantCopyText(picked.text);
            if (text && !(typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(text))) {
              return { ok: true, text, reason: 'ok' };
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
            const recordText = finalizeAssistantCopyText(picked.record.text || '');
            if (recordText && !(typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(recordText))) {
              return { ok: true, text: recordText, reason: 'ok' };
            }
          }
        }

        if (typeof findLastAssistantTurn === 'function' && typeof extractAssistantText === 'function') {
          const turn = findLastAssistantTurn();
          const turnText = finalizeAssistantCopyText(extractAssistantText(turn) || '');
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

          let text = '';
          if (typeof extractAssistantReplyTextFromElement === 'function') {
            text = finalizeAssistantCopyText(extractAssistantReplyTextFromElement(lastNode));
          } else {
            const markdown = lastNode.querySelector('.markdown, [data-message-content], [class*="markdown"]');
            const source = markdown instanceof HTMLElement ? markdown : lastNode;
            text = finalizeAssistantCopyText(source.innerText || source.textContent || '');
          }

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
      const strictReadVerify = options.strictReadVerify === true;
      const cleanedText = sanitizeCopiedAssistantText(rawText);

      if (!cleanedText) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[COPY][SKIP] reason=empty-after-sanitize label=${label}`);
        } else {
          console.warn('[COPY][SKIP] reason=empty-after-sanitize', { label });
        }
        return { ok: false, reason: 'empty_after_sanitize' };
      }

      if (typeof copyTextUnified !== 'function') {
        const missingErr = new Error('copyTextUnified-missing');
        console.error(`[CLIPBOARD][WRITE_FAIL] label=${label}`, missingErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[CLIPBOARD][WRITE_FAIL] label=${label} error=${missingErr.message}`);
        }
        return { ok: false, reason: 'clipboard_write_failed', error: missingErr };
      }

      const copied = await copyTextUnified(cleanedText, `clipboard:${label}`);
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
          ToolboxShell.appendLog(`[CLIPBOARD][VERIFY_SKIP] label=${label} reason=readText-unavailable chars=${cleanedText.length}`);
        }
        return { ok: true, reason: 'clipboard_read_verify_unavailable', verified: false };
      }

      let current = '';
      try {
        current = String(await navigator.clipboard.readText() || '');
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error(`[CLIPBOARD][READ_VERIFY_FAIL] label=${label}`, err);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[CLIPBOARD][READ_VERIFY_FAIL] label=${label} error=${errText} strict=${strictReadVerify ? 1 : 0}`,
          );
        }

        if (strictReadVerify) {
          return { ok: false, reason: 'clipboard_read_verify_failed', error: err };
        }

        return {
          ok: true,
          reason: 'clipboard_read_verify_skipped',
          verified: false,
          warning: errText,
        };
      }

      if (normalizeClipboardTextForCompare(current) !== normalizeClipboardTextForCompare(cleanedText)) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[CLIPBOARD][VERIFY_MISMATCH] label=${label} expectedLen=${cleanedText.length} actualLen=${String(current || '').length}`,
          );
        }
        return { ok: false, reason: 'clipboard_verify_mismatch' };
      }

      return { ok: true, reason: 'ok', verified: true };
    }

    return {
      getLatestAssistantReplyText,
      writeClipboardAndVerify,
      sanitizeCopiedAssistantText,
      normalizeClipboardTextForCompare,
      // Provide SINGLE SOURCE OF TRUTH for caller-side text normalization.
      strip: stripChatGptInstrumentsLabel,
      collapseInstrumentsCalculatorReply,
    };
  })();


