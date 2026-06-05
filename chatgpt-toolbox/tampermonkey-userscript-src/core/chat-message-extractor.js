  /********************************************************************
   * ChatMessageExtractor：ChatGPT 页面消息提取、清洗、thinking 剥离
   ********************************************************************/

  function isChatSidebarElement(el) {
    if (!el || !el.closest) return false;

    return !!el.closest(
      [
        'aside',
        'nav',
        '[data-testid*="sidebar"]',
        '[data-testid*="history"]',
        '[aria-label*="历史"]',
        '[aria-label*="聊天"]',
        '[aria-label*="Chat history"]',
        '[aria-label*="conversation"]',
      ].join(','),
    );
  }

  const COMPOSER_AREA_SELECTORS_FOR_MESSAGE = [
    '[data-testid="composer"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[data-testid="composer-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ].join(',');

  function isInComposerArea(el) {
    if (!el) return false;
    return !!el.closest(COMPOSER_AREA_SELECTORS_FOR_MESSAGE);
  }

  function getMessageContentElement(el) {
    if (!el) return null;

    const nodes = getMessageContentElements(el);
    if (nodes.length > 0) {
      return nodes[0];
    }

    return el;
  }

  function getMessageContentElements(el) {
    if (!el) return [];

    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"] [data-message-content]',
      '[data-message-author-role="assistant"] .whitespace-pre-wrap',
      '[data-message-author-role="assistant"] [class*="markdown"]',

      '[data-message-author-role="user"] [data-message-content]',
      '[data-message-author-role="user"] .whitespace-pre-wrap',

      '.markdown',
      '[data-message-content]',
      '[class*="markdown"]',
      '.whitespace-pre-wrap',
      'pre',
      'code',
    ];

    const nodes = [];

    selectors.forEach((selector) => {
      qsa(selector, el).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (isInToolbox(node)) return;
        if (isInComposerArea(node)) return;
        if (isChatSidebarElement(node)) return;

        const text = String(node.innerText || node.textContent || '').trim();
        if (!text) return;

        nodes.push(node);
      });
    });

    const unique = [];
    nodes.forEach((node) => {
      const isInsideExisting = unique.some((old) => old !== node && old.contains(node));
      if (isInsideExisting) return;

      for (let i = unique.length - 1; i >= 0; i -= 1) {
        if (node.contains(unique[i])) {
          unique.splice(i, 1);
        }
      }

      if (!unique.includes(node)) {
        unique.push(node);
      }
    });

    unique.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return unique;
  }

  function extractCleanTextFromNode(node) {
    if (!node) return '';

    const clone = node.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((child) => {
      child.remove();
    });

    const rawText = String(clone.innerText || clone.textContent || '');
    return cleanCopiedMessageText(rawText);
  }

  function getFullMessageTextFromElement(el) {
    if (!el) {
      return {
        text: '',
        contentNodeCount: 0,
        contentTextChars: 0,
        fullTurnTextChars: 0,
        source: 'empty',
      };
    }

    const fullTurnEl =
      el.closest &&
      el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')
        ? el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')
        : el;

    const contentNodes = getMessageContentElements(fullTurnEl);

    const contentText = contentNodes
      .map((node) => extractCleanTextFromNode(node))
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const fullTurnText = extractCleanTextFromNode(fullTurnEl)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedContentText = cleanFn(contentText);
    const cleanedFullTurnText = cleanFn(fullTurnText);

    const afterThinkingText = extractFinalAnswerAfterThinkingText(fullTurnText);
    const cleanedAfterThinking = cleanFn(afterThinkingText);

    if (shouldUseAfterThinkingCopyText(cleanedAfterThinking)) {
      return {
        text: cleanedAfterThinking,
        contentNodeCount: contentNodes.length,
        contentTextChars: cleanedContentText.length,
        fullTurnTextChars: cleanedFullTurnText.length,
        source: 'after-thinking',
      };
    }

    let finalText = cleanedContentText;
    let source = 'content-nodes';

    if (
      cleanedFullTurnText &&
      (
        !finalText ||
        cleanedFullTurnText.length > finalText.length + 80 ||
        cleanedFullTurnText.length > finalText.length * 1.3
      )
    ) {
      finalText = cleanedFullTurnText;
      source = 'full-turn-fallback';
    }

    return {
      text: finalText,
      contentNodeCount: contentNodes.length,
      contentTextChars: cleanedContentText.length,
      fullTurnTextChars: cleanedFullTurnText.length,
      source,
    };
  }

  function cleanCopiedMessageText(text) {
    let value = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const lines = value.split('\n');

    while (lines.length > 0) {
      const first = String(lines[0] || '').trim();

      if (
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)$/i.test(first) ||
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]$/i.test(first)
      ) {
        lines.shift();
        continue;
      }

      break;
    }

    value = lines.join('\n').trim();

    value = value
      .replace(/^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]\s*/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return value;
  }

  function getVisibleTextFromElement(el) {
    if (!el) return '';

    const contentEl = getMessageContentElement(el) || el;
    const clone = contentEl.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((node) => {
      node.remove();
    });

    const rawText = String(clone.textContent || clone.innerText || '');
    const fullTurnRawText = el !== contentEl
      ? String(el.textContent || el.innerText || '')
      : rawText;

    const afterThinking = extractFinalAnswerAfterThinkingText(fullTurnRawText);

    if (afterThinking && afterThinking.length >= 20) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][message-extract-after-thinking] chars=${afterThinking.length}`,
        );
      }

      return (
        typeof ChatMessageExtractor !== 'undefined' &&
        ChatMessageExtractor &&
        typeof ChatMessageExtractor.cleanMessageText === 'function'
          ? ChatMessageExtractor.cleanMessageText(afterThinking)
          : cleanCopiedMessageText(afterThinking)
      );
    }

    return cleanCopiedMessageText(rawText);
  }

  function findConversationMessageElements(options = {}) {
    const includeHidden = options.includeHidden === true;
    const selectors = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      '[data-message-author-role]',
    ];

    const seen = new Set();
    const result = [];

    selectors.forEach((selector) => {
      qsa(selector).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isInToolbox(el)) return;

        const container = el.closest(
          'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
        ) || el;

        if (!(container instanceof HTMLElement)) return;
        if (seen.has(container)) return;
        if (isInToolbox(container)) return;

        if (!includeHidden) {
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
        }

        seen.add(container);
        result.push(container);
      });
    });

    result.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return result;
  }

  function getMessageRole(el) {
    if (!el) return '';

    const direct = el.getAttribute('data-message-author-role');
    if (direct) return String(direct || '').toLowerCase();

    const roleNode = el.querySelector('[data-message-author-role]');
    if (roleNode) {
      return String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
    }

    const text = String(el.getAttribute('data-testid') || '').toLowerCase();
    if (text.includes('conversation-turn')) {
      return '';
    }

    return '';
  }

  function getConversationTurnId(el) {
    if (!el) return '';

    const direct = el.getAttribute && el.getAttribute('data-testid');
    if (direct && /^conversation-turn-/i.test(String(direct))) {
      return String(direct);
    }

    const turn = el.closest && el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
    if (turn) {
      return String(turn.getAttribute('data-testid') || '');
    }

    return '';
  }

  function isThinkingBoundaryLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      /^已思考\s*(?:若干秒|几\s*秒|\d+)/.test(text) ||
      /^已思考.*(?:秒|分钟|m|s|›|>)/i.test(text) ||
      /^Thought for\s+\d+/i.test(text) ||
      /^Thinking/i.test(text) ||
      /^正在思考/.test(text)
    );
  }

  function isThinkingUiNoiseLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      isThinkingBoundaryLine(text) ||
      text === '展开' ||
      text === '收起' ||
      text === 'Show more' ||
      text === 'Show less'
    );
  }

  function extractFinalAnswerAfterThinkingText(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');

    const normalized = raw
      .replace(
        /(已思考\s*(?:若干秒|几\s*秒|\d+\s*(?:秒|分钟|m|min|s)?(?:\s*\d+\s*s)?)(?:\s*[›>])?)/gi,
        '\n$1\n',
      )
      .replace(
        /(Thought for\s+\d+[^\n]*)/gi,
        '\n$1\n',
      )
      .replace(
        /(正在思考[^\n]*)/g,
        '\n$1\n',
      );

    const lines = normalized.split('\n');

    let boundaryIndex = -1;

    for (let i = 0; i < lines.length; i += 1) {
      if (isThinkingBoundaryLine(lines[i])) {
        boundaryIndex = i;
      }
    }

    if (boundaryIndex < 0) {
      return '';
    }

    const afterLines = lines
      .slice(boundaryIndex + 1)
      .filter((line) => !isThinkingUiNoiseLine(line));

    return afterLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function shouldUseAfterThinkingCopyText(text) {
    const t = String(text || '').trim();
    if (!t) {
      return false;
    }
    if (typeof isThinkingUiNoiseLine === 'function' && isThinkingUiNoiseLine(t)) {
      return false;
    }
    if (t.includes('<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>')) {
      return true;
    }
    if (t.includes('<<<CHATGPT_TOOLBOX_DONE>>>') || t.includes('__CHATGPT_TOOLBOX_DONE__')) {
      return true;
    }
    return t.length >= 2;
  }

  function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {
    if (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
      && UploadCriticalRuntime.isUploadCriticalMode()
    ) {
      // 上传关键期只做轻量 fallback，避免触发 after-thinking 提取/重型清洗。
      const cleanFn =
        typeof ChatMessageExtractor !== 'undefined' &&
        ChatMessageExtractor &&
        typeof ChatMessageExtractor.cleanMessageText === 'function'
          ? ChatMessageExtractor.cleanMessageText
          : cleanCopiedMessageText;

      const cleanedFallback = cleanFn(fallbackText || rawText || '');

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog('[UPLOAD_CRITICAL][SKIP_HEAVY_CHAT_SCAN] reason=uploading');
      }

      return {
        text: String(cleanedFallback || '').trim(),
        source: 'fallback-content',
        isStreaming: false,
      };
    }

    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedRaw = cleanFn(rawText || '');
    const cleanedFallback = cleanFn(fallbackText || '');

    const afterThinking = extractFinalAnswerAfterThinkingText(rawText);
    const cleanedAfterThinking = cleanFn(afterThinking || '');

    if (shouldUseAfterThinkingCopyText(cleanedAfterThinking)) {
      const streaming = (
        (typeof isChatGPTActuallyBusyForTaskQueue === 'function' && isChatGPTActuallyBusyForTaskQueue())
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy()
        )
        || (
          typeof hasRealChatGPTStopGeneratingButton === 'function'
          && hasRealChatGPTStopGeneratingButton()
        )
      );

      const closedLoopWaitPoll = (
        (typeof window !== 'undefined' && window.__cgptClosedLoopWaitPollActive === true)
        || meta.closedLoopWaitPoll === true
      );
      const pickSource = String(meta.pickSource || meta.source || '');
      const isClosedLoopWaitPick = /wait-cycle|closed-loop-wait/i.test(pickSource);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        if (streaming && (closedLoopWaitPoll || isClosedLoopWaitPick)) {
          // 闭环等待轮询期间不输出 streaming 重型 pick 日志。
        } else {
          const logTag = streaming
            ? '[CHAT_PAGE][assistant-streaming-answer-picked]'
            : '[CHAT_PAGE][assistant-final-answer-picked]';
          ToolboxShell.appendLog(
            `${logTag} source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,
          );
        }
      }

      return {
        text: cleanedAfterThinking,
        source: 'after-thinking',
        isStreaming: streaming,
      };
    }

    let finalText = cleanedFallback;
    let source = 'fallback-content';

    if (
      cleanedRaw &&
      (
        !finalText ||
        cleanedRaw.length > finalText.length + 80 ||
        cleanedRaw.length > finalText.length * 1.3
      )
    ) {
      finalText = cleanedRaw;
      source = 'raw-full-turn';
    }

    return {
      text: String(finalText || '').trim(),
      source,
    };
  }

  const ChatMessageExtractor = (() => {
    const UI_NOISE_EXACT_LINES = new Set([
      '复制',
      '编辑',
      '分享',
      '重新生成',
      '赞',
      '踩',
      'ChatGPT 也可能会犯错',
      'ChatGPT can make mistakes',
      'Check out the response',
      'Regenerate',
      'Copy',
      'Edit',
      'Share',
      'ChatGPT Instruments',
      '提供反馈',
      'Provide feedback',
    ]);

    function isToolboxRoot(el) {
      if (!el) return false;
      return !!el.closest(`#${APP.rootId}`);
    }

    function blurActiveElementIfInsideToolbox() {
      const active = document.activeElement;

      if (!(active instanceof HTMLElement)) {
        return;
      }

      const root = document.querySelector(`#${APP.rootId}`);

      if (root && root.contains(active)) {
        active.blur();
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][BLUR_TOOLBOX_ACTIVE]');
        }
      }
    }

    function resolveMessageRole(el) {
      let role = getMessageRole(el);
      if (role) return role;

      const roleNode = el.querySelector && el.querySelector('[data-message-author-role]');
      if (roleNode) {
        role = String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
        if (role) return role;
      }

      if (el.querySelector && el.querySelector('[data-message-author-role="user"]')) {
        return 'user';
      }

      if (
        el.querySelector &&
        el.querySelector('[data-message-author-role="assistant"], .markdown, [data-message-content]')
      ) {
        return 'assistant';
      }

      return 'unknown';
    }

    function isUiNoiseLine(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed) return false;
      if (UI_NOISE_EXACT_LINES.has(trimmed)) return true;
      if (/^已思考\s*(?:若干秒|几\s*秒|\d+\s*(?:秒|分钟|m(?:in)?)(?:\s+\d+\s*s)?)\s*›?\s*$/i.test(trimmed)) {
        return true;
      }
      if (/^Thought for\s+\d+/i.test(trimmed)) return true;
      if (/^Read for \d+/i.test(trimmed)) return true;
      return false;
    }

    let copyPipelineFallbackWarnedOnce = false;

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

    function cleanMessageText(text) {
      let value = cleanCopiedMessageText(text);
      if (!value) return '';

      const parts = value.split(/(```[\s\S]*?```)/g);
      const rebuilt = [];

      parts.forEach((part) => {
        if (!part) return;

        if (part.startsWith('```')) {
          rebuilt.push(part);
          return;
        }

        const lines = part.split('\n');
        const filtered = lines.filter((line) => !isUiNoiseLine(line));
        rebuilt.push(filtered.join('\n'));
      });

      return collapseInstrumentsCalculatorReply(
        rebuilt
          .join('')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
      );
    }

    function collectMessageElements(options = {}) {
      const includeHidden = options.includeHidden === true;
      const seen = new Set();
      const result = [];

      const addElement = (el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isToolboxRoot(el)) return;
        if (isInToolbox(el)) return;
        if (isInComposerArea(el)) return;
        if (isChatSidebarElement(el)) return;

        const container = el.closest(
          'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
        ) || el;

        if (!(container instanceof HTMLElement)) return;
        if (seen.has(container)) return;

        if (!includeHidden) {
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
        }

        seen.add(container);
        result.push(container);
      };

      findConversationMessageElements({ includeHidden }).forEach(addElement);

      qsa('[data-message-author-role]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;

        let parent = el.parentElement;
        let nested = false;

        while (parent) {
          if (parent.matches && parent.matches('[data-message-author-role]')) {
            nested = true;
            break;
          }
          parent = parent.parentElement;
        }

        if (!nested) {
          addElement(el);
        }
      });

      result.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      return result;
    }

    function buildRecords(options = {}) {
      const includeEmpty = options.includeEmpty === true;
      const includeHidden = options.includeHidden === true;

      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog('[UPLOAD_CRITICAL][SKIP_HEAVY_CHAT_SCAN] reason=uploading');
        }
        return [];
      }

      try {
        const messages = collectMessageElements({ includeHidden });
        const records = [];
        const seenTurnIds = new Set();
        const seenNodes = new WeakSet();

        messages.forEach((el) => {
          const container = el.closest(
            'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
          ) || el;
          const node = container instanceof HTMLElement ? container : el;

          if (seenNodes.has(node)) return;
          seenNodes.add(node);

          const role = resolveMessageRole(el);
          if (role && !['assistant', 'user', 'system', 'tool', 'unknown'].includes(role)) {
            return;
          }

          const containerForText = node instanceof HTMLElement ? node : el;
          const fullTurnRawText = String(
            containerForText.innerText || containerForText.textContent || '',
          );
          const extractResult = getFullMessageTextFromElement(el);
          const finalPick = chooseAssistantFinalAnswerText(
            fullTurnRawText,
            extractResult.text,
            { turnId: getConversationTurnId(el) },
          );
          const text = cleanMessageText(finalPick.text);
          if (!includeEmpty && !text) return;

          const turnId = getConversationTurnId(el);
          const stats = getCopiedTextStats(text);
          const rect = el.getBoundingClientRect();
          const hasThinkingBoundary = /已思考|Thought for|Thinking|正在思考/i.test(fullTurnRawText)
            ? 1
            : 0;

          if (turnId) {
            if (seenTurnIds.has(turnId)) return;
            seenTurnIds.add(turnId);
          }

          if (hasThinkingBoundary) {
            ToolboxShell.appendLog(
              `[CHAT_PAGE][conversation-record] turn=${turnId || '-'} role=${role} extract_source=${finalPick.source || extractResult.source || 'unknown'} hasThinking=${hasThinkingBoundary} chars=${stats.charCount}`,
            );
          }

          records.push({
            index: records.length,
            role,
            text,
            element: el,
            turn_id: turnId,
            char_count: stats.charCount,
            no_space_char_count: stats.noSpaceCharCount,
            han_count: stats.hanCount,
            line_count: stats.lineCount,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            extract_source: finalPick.source || extractResult.source || 'unknown',
            has_thinking_boundary: hasThinkingBoundary,
            content_node_count: extractResult.contentNodeCount,
            content_text_chars: extractResult.contentTextChars,
            full_turn_text_chars: extractResult.fullTurnTextChars,
          });
        });

        records.sort((a, b) => {
          const ta = Number.isFinite(Number(a.top)) ? Number(a.top) : 0;
          const tb = Number.isFinite(Number(b.top)) ? Number(b.top) : 0;

          if (Math.abs(ta - tb) > 2) {
            return ta - tb;
          }

          if (a.element && b.element && a.element !== b.element) {
            const pos = a.element.compareDocumentPosition(b.element);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          }

          return 0;
        });

        records.forEach((record, index) => {
          record.index = index;
        });

        return records;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] ChatMessageExtractor.buildRecords failed', error);
        ToolboxShell.appendLog(`[CHAT_PAGE][conversation-records:failed] error=${errText}`);
        throw error;
      }
    }

    function getLatestUserRecord(records) {
      const list = Array.isArray(records) ? records : [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].role === 'user') {
          return list[i];
        }
      }
      return null;
    }

    function getLatestAssistantAfterLatestUser(records, options = {}) {
      const allowNoUserFallback = options.allowNoUserFallback === true;
      const list = Array.isArray(records) ? records : [];
      const latestUser = getLatestUserRecord(list);

      if (!latestUser) {
        if (allowNoUserFallback) {
          for (let i = list.length - 1; i >= 0; i -= 1) {
            if (list[i].role === 'assistant') {
              return {
                ok: true,
                record: list[i],
                latestUser: null,
                reason: 'no-latest-user-fallback-last-assistant',
              };
            }
          }
        }

        return {
          ok: false,
          reason: 'no-latest-user',
          latestUser: null,
        };
      }

      const userIdx = list.findIndex((item) => item === latestUser || item.index === latestUser.index);

      for (let i = list.length - 1; i > userIdx; i -= 1) {
        if (list[i].role === 'assistant') {
          return {
            ok: true,
            record: list[i],
            latestUser,
            reason: 'latest-assistant-after-latest-user',
          };
        }
      }

      return {
        ok: false,
        reason: 'no-assistant-after-latest-user',
        latestUser,
      };
    }

    function buildStableSignature(record, text) {
      return [
        record.turn_id || record.turnId || '',
        text,
        String(record.char_count || record.charCount || 0),
        String(record.no_space_char_count || 0),
      ].join('||');
    }

    const FAST_TAIL_TURN_COUNT = 8;

    function isTurnElementVisible(turnEl) {
      if (!(turnEl instanceof HTMLElement)) {
        return false;
      }

      if (typeof isElementVisible === 'function') {
        return isElementVisible(turnEl);
      }

      const rect = turnEl.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function collectConversationTurnElements(options = {}) {
      const includeHidden = options.includeHidden === true;
      const main = document.querySelector('main') || document.body;

      if (!(main instanceof HTMLElement)) {
        return [];
      }

      return Array.from(main.querySelectorAll(
        'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
      )).filter((el) => {
        if (!(el instanceof HTMLElement)) {
          return false;
        }

        if (!includeHidden && !isTurnElementVisible(el)) {
          return false;
        }

        if (isToolboxRoot(el) || isInToolbox(el)) {
          return false;
        }

        if (isInComposerArea(el)) {
          return false;
        }

        return true;
      });
    }

    function buildMessageRecordFromTurnElement(turnEl) {
      if (!(turnEl instanceof HTMLElement)) {
        return null;
      }

      const roleNode = turnEl.querySelector('[data-message-author-role]');
      const messageEl = roleNode instanceof HTMLElement ? roleNode : turnEl;
      const role = resolveMessageRole(messageEl);

      if (role && !['assistant', 'user', 'system', 'tool', 'unknown'].includes(role)) {
        return null;
      }

      const fullTurnRawText = String(
        turnEl.innerText || turnEl.textContent || '',
      );
      const extractResult = typeof getFullMessageTextFromElement === 'function'
        ? getFullMessageTextFromElement(messageEl)
        : { text: fullTurnRawText, source: 'turn-text' };
      const finalPick = typeof chooseAssistantFinalAnswerText === 'function'
        ? chooseAssistantFinalAnswerText(
          fullTurnRawText,
          extractResult.text,
          { turnId: typeof getConversationTurnId === 'function' ? getConversationTurnId(messageEl) : '' },
        )
        : { text: extractResult.text || fullTurnRawText, source: extractResult.source || 'unknown' };
      const text = cleanMessageText(finalPick.text);

      if (!text) {
        return null;
      }

      const turnId = typeof getConversationTurnId === 'function'
        ? getConversationTurnId(messageEl)
        : '';
      const stats = typeof getCopiedTextStats === 'function'
        ? getCopiedTextStats(text)
        : { charCount: text.length };

      return {
        role,
        text,
        turn_id: turnId,
        char_count: stats.charCount,
        extract_source: finalPick.source || extractResult.source || 'unknown',
      };
    }

    function getFastTailMessageRecords(options = {}) {
      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog('[UPLOAD_CRITICAL][SKIP_HEAVY_CHAT_SCAN] reason=uploading');
        }
        return [];
      }

      const includeHidden = options.includeHidden === true;
      const turns = collectConversationTurnElements({ includeHidden });
      const tailTurns = turns.slice(-FAST_TAIL_TURN_COUNT);
      const records = [];

      tailTurns.forEach((turnEl, offset) => {
        const record = buildMessageRecordFromTurnElement(turnEl);

        if (record && record.text) {
          record.index = offset;
          records.push(record);
        }
      });

      records.forEach((record, index) => {
        record.index = index;
      });

      return records;
    }

    function getLatestConversationMessageRecordFromTail(options = {}) {
      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        return null;
      }

      const preferAssistant = options.preferAssistant !== false;
      const preferredRole = String(options.role || '').toLowerCase();
      const records = getFastTailMessageRecords({
        includeHidden: options.includeHidden === true,
      });

      if (!records.length) {
        return null;
      }

      if (preferredRole) {
        for (let i = records.length - 1; i >= 0; i -= 1) {
          if (records[i].role === preferredRole) {
            return records[i];
          }
        }

        return null;
      }

      if (preferAssistant) {
        const picked = getLatestAssistantAfterLatestUser(records, {
          allowNoUserFallback: options.allowNoUserFallback === true,
        });

        if (picked.ok && picked.record) {
          return picked.record;
        }

        if (options.allowPreviousAssistantFallback === true || options.allowNoUserFallback === true) {
          for (let i = records.length - 1; i >= 0; i -= 1) {
            if (records[i].role === 'assistant') {
              return records[i];
            }
          }
        }

        return null;
      }

      return records[records.length - 1] || null;
    }

    const stableCheckLogMap = new Map();

    function logStableCheckThrottled(key, message) {
      const now = Date.now();
      const finalKey = String(key || '-');
      const last = stableCheckLogMap.get(finalKey) || 0;
      if (now - last < 2000) {
        return;
      }
      stableCheckLogMap.set(finalKey, now);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(message);
      }
    }

    function normalizeTurnIdForStableCompare(turnId) {
      const raw = String(turnId || '').trim();
      if (!raw) {
        return {
          raw: '',
          numeric: null,
          isNumeric: false,
        };
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        return {
          raw,
          numeric,
          isNumeric: true,
        };
      }
      return {
        raw,
        numeric: null,
        isNumeric: false,
      };
    }

    function getPendingReplyBaselineTurnIdForStableCompare(pendingReplyContext) {
      if (!pendingReplyContext || typeof pendingReplyContext !== 'object') {
        return '';
      }
      return String(
        pendingReplyContext.baseline_assistant_turn_id
          || pendingReplyContext.baselineAssistantTurnId
          || pendingReplyContext.sent_turn_id
          || pendingReplyContext.sentTurnId
          || '',
      ).trim();
    }

    function getPendingReplyStartAssistantCountForStableCompare(pendingReplyContext) {
      if (!pendingReplyContext || typeof pendingReplyContext !== 'object') {
        return -1;
      }
      const raw = pendingReplyContext.start_assistant_count
        ?? pendingReplyContext.startAssistantCount
        ?? -1;
      const count = Number(raw);
      return Number.isFinite(count) ? count : -1;
    }

    function countVisibleAssistantTurnsForStableCompare() {
      if (typeof document === 'undefined') {
        return -1;
      }
      try {
        return Array.from(
          document.querySelectorAll('[data-message-author-role="assistant"]'),
        ).filter((node) => node instanceof HTMLElement).length;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[CHAT_PAGE][assistant-count-stable-compare-failed]', error);
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][assistant-count-stable-compare-failed] error=${errText}`,
          );
        }
        return -1;
      }
    }

    function shouldSkipAssistantBeforePendingBaseline(record, pendingReplyContext) {
      if (!pendingReplyContext || typeof pendingReplyContext !== 'object') {
        return {
          skip: false,
          reason: 'no-pending-context',
          baselineRaw: '',
          currentRaw: '',
          startAssistantCount: -1,
          currentAssistantCount: -1,
        };
      }

      const startAssistantCount = getPendingReplyStartAssistantCountForStableCompare(pendingReplyContext);
      const currentAssistantCount = countVisibleAssistantTurnsForStableCompare();
      const baselineRaw = getPendingReplyBaselineTurnIdForStableCompare(pendingReplyContext);
      const currentRaw = String(record && (record.turn_id || record.turnId) || '').trim();
      const baselineTurn = normalizeTurnIdForStableCompare(baselineRaw);
      const currentTurn = normalizeTurnIdForStableCompare(currentRaw);

      // 优先用 assistant 数量判断。
      // 这是最简单、最符合当前按钮需求的判断：
      // 发送前有 N 个 assistant，发送后必须出现第 N+1 个 assistant，才算新回复。
      if (startAssistantCount >= 0 && currentAssistantCount >= 0) {
        if (currentAssistantCount <= startAssistantCount) {
          return {
            skip: true,
            reason: 'assistant-count-not-increased',
            baselineRaw,
            currentRaw,
            startAssistantCount,
            currentAssistantCount,
          };
        }
        return {
          skip: false,
          reason: 'assistant-count-increased',
          baselineRaw,
          currentRaw,
          startAssistantCount,
          currentAssistantCount,
        };
      }

      // 数字 turn_id 才允许大小比较。
      if (baselineTurn.isNumeric && currentTurn.isNumeric) {
        if (currentTurn.numeric <= baselineTurn.numeric) {
          return {
            skip: true,
            reason: 'numeric-turn-before-or-equal-baseline',
            baselineRaw,
            currentRaw,
            startAssistantCount,
            currentAssistantCount,
          };
        }
        return {
          skip: false,
          reason: 'numeric-turn-after-baseline',
          baselineRaw,
          currentRaw,
          startAssistantCount,
          currentAssistantCount,
        };
      }

      // 非数字 turn_id 只允许判断“相等/不相等”，不能再用 raw.length 做大小比较。
      if (baselineRaw && currentRaw && baselineRaw === currentRaw) {
        return {
          skip: true,
          reason: 'same-string-turn-id-as-baseline',
          baselineRaw,
          currentRaw,
          startAssistantCount,
          currentAssistantCount,
        };
      }

      return {
        skip: false,
        reason: 'no-baseline-block',
        baselineRaw,
        currentRaw,
        startAssistantCount,
        currentAssistantCount,
      };
    }

    async function waitLatestAssistantStable(options = {}) {
      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        return {
          ok: false,
          reason: 'uploading-critical-skip',
          lastRecord: null,
          latestUser: null,
        };
      }

      const timeoutMs = Number(options.timeoutMs ?? 12000);
      const intervalMs = Number(options.intervalMs ?? 300);
      const stableRounds = Math.max(3, Number(options.stableRounds ?? 3));
      const minQuietAfterChangeMs = Math.max(800, Number(options.minQuietAfterChangeMs ?? 900));
      const isGenerating = typeof options.isGenerating === 'function' ? options.isGenerating : () => false;
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
      const pendingReplyContext = options.pendingReplyContext && typeof options.pendingReplyContext === 'object'
        ? options.pendingReplyContext
        : null;
      if (pendingReplyContext) {
        const baselineRawForLog = getPendingReplyBaselineTurnIdForStableCompare(pendingReplyContext);
        const startAssistantCountForLog = getPendingReplyStartAssistantCountForStableCompare(pendingReplyContext);
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:baseline] `
          + `baselineTurnId=${baselineRawForLog || '-'} `
          + `startAssistantCount=${startAssistantCountForLog}`,
        );
      }

      const startedAt = Date.now();
      let stableCount = 0;
      let lastSignature = '';
      let lastPicked = null;
      let lastTextChangedAt = 0;

      while (Date.now() - startedAt < timeoutMs) {
        if (shouldStop()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-cancelled]');
          return {
            ok: false,
            reason: 'cancelled',
            lastRecord: lastPicked?.record && typeof stripMessageRecordForCache === 'function'
              ? stripMessageRecordForCache(lastPicked.record)
              : lastPicked?.record || null,
            latestUser: lastPicked?.latestUser && typeof stripMessageRecordForCache === 'function'
              ? stripMessageRecordForCache(lastPicked.latestUser)
              : lastPicked?.latestUser || null,
          };
        }

        if (isGenerating()) {
          stableCount = 0;
          lastSignature = '';
          lastTextChangedAt = 0;
          logStableCheckThrottled(
            'copy-last-message:stable-check:generating',
            '[CHAT_PAGE][copy-last-message:stable-check] state=generating',
          );
          await sleep(intervalMs);
          continue;
        }

        const records = getFastTailMessageRecords({ includeHidden: false });
        const picked = getLatestAssistantAfterLatestUser(records, {
          allowNoUserFallback: options.allowNoUserFallback === true,
        });
        lastPicked = picked;

        if (!picked.ok) {
          stableCount = 0;
          lastSignature = '';
          lastTextChangedAt = 0;
          logStableCheckThrottled(
            `copy-last-message:stable-check:no-assistant:${picked.reason || 'no-assistant'}`,
            `[CHAT_PAGE][copy-last-message:stable-check] state=${picked.reason || 'no-assistant'} mode=fast`,
          );
          await sleep(intervalMs);
          continue;
        }

        const record = picked.record;
        const baselineDecision = shouldSkipAssistantBeforePendingBaseline(record, pendingReplyContext);
        if (baselineDecision.skip) {
          stableCount = 0;
          lastSignature = '';
          lastTextChangedAt = 0;
          logStableCheckThrottled(
            `copy-last-message:stable-check:assistant-before-baseline:${baselineDecision.reason}:${baselineDecision.baselineRaw}:${baselineDecision.currentRaw}`,
            `[CHAT_PAGE][copy-last-message:stable-check] `
              + `state=assistant-before-baseline `
              + `reason=${baselineDecision.reason || '-'} `
              + `baselineTurnId=${baselineDecision.baselineRaw || '-'} `
              + `currentTurnId=${baselineDecision.currentRaw || '-'} `
              + `startAssistantCount=${baselineDecision.startAssistantCount} `
              + `currentAssistantCount=${baselineDecision.currentAssistantCount}`,
          );
          await sleep(intervalMs);
          continue;
        }

        if (pendingReplyContext) {
          logStableCheckThrottled(
            `copy-last-message:stable-check:baseline-accepted:${baselineDecision.reason}:${baselineDecision.baselineRaw}:${baselineDecision.currentRaw}`,
            `[CHAT_PAGE][copy-last-message:stable-check] `
              + `state=baseline-accepted `
              + `reason=${baselineDecision.reason || '-'} `
              + `baselineTurnId=${baselineDecision.baselineRaw || '-'} `
              + `currentTurnId=${baselineDecision.currentRaw || '-'} `
              + `startAssistantCount=${baselineDecision.startAssistantCount} `
              + `currentAssistantCount=${baselineDecision.currentAssistantCount}`,
          );
        }

        const text = cleanMessageText(record.text || '');
        const signature = buildStableSignature(record, text);
        const nowStable = Date.now();

        if (signature && signature !== lastSignature) {
          lastTextChangedAt = nowStable;
        }

        logStableCheckThrottled(
          `copy-last-message:stable-check:progress:${stableCount}:${stableRounds}`,
          `[CHAT_PAGE][copy-last-message:stable-check] stable=${stableCount}/${stableRounds} chars=${record.char_count || record.charCount || 0} mode=fast turn=${record.turn_id || record.turnId || '-'} quietMs=${lastTextChangedAt ? nowStable - lastTextChangedAt : 0}`,
        );

        if (signature && signature === lastSignature) {
          stableCount += 1;
        } else {
          stableCount = 1;
          lastSignature = signature;
        }

        const quietElapsed = lastTextChangedAt > 0 ? nowStable - lastTextChangedAt : 0;
        const quietEnough = !lastTextChangedAt || quietElapsed >= minQuietAfterChangeMs;

        if (stableCount >= stableRounds && text && quietEnough) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-ok] mode=fast');
          const safeRecord = typeof stripMessageRecordForCache === 'function'
            ? stripMessageRecordForCache(record)
            : record;
          return {
            ok: true,
            record: safeRecord,
            text,
            reason: 'stable',
            latestUser: picked.latestUser && typeof stripMessageRecordForCache === 'function'
              ? stripMessageRecordForCache(picked.latestUser)
              : picked.latestUser || null,
          };
        }

        await sleep(intervalMs);
      }

      ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-timeout]');

      const finalRecords = buildRecords({ includeEmpty: false });
      const finalPicked = getLatestAssistantAfterLatestUser(finalRecords);

      return {
        ok: false,
        reason: finalPicked.reason === 'no-assistant-after-latest-user'
          ? 'no-assistant-after-latest-user'
          : 'timeout',
        lastRecord: finalPicked.record && typeof stripMessageRecordForCache === 'function'
          ? stripMessageRecordForCache(finalPicked.record)
          : finalPicked.record || (lastPicked?.record && typeof stripMessageRecordForCache === 'function'
            ? stripMessageRecordForCache(lastPicked.record)
            : lastPicked?.record || null),
        latestUser: finalPicked.latestUser && typeof stripMessageRecordForCache === 'function'
          ? stripMessageRecordForCache(finalPicked.latestUser)
          : finalPicked.latestUser || (lastPicked?.latestUser && typeof stripMessageRecordForCache === 'function'
            ? stripMessageRecordForCache(lastPicked.latestUser)
            : lastPicked?.latestUser || null),
      };
    }

    return {
      buildRecords,
      getLatestAssistantAfterLatestUser,
      cleanMessageText,
      waitLatestAssistantStable,
      buildMessageRecordFromTurnElement,
      getFastTailMessageRecords,
      getLatestConversationMessageRecordFromTail,
      collectConversationTurnElements,
    };
  })();


