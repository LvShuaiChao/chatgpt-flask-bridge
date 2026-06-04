// ==UserScript==
// @name         ChatGPT 工具箱：多文件上传 + 自动指令队列 + Prompt 管理
// @namespace    https://github.com/xiaozhang/chatgpt-toolbox
// @version      3.6.7
// @description  一个统一工具箱面板：多文件队列上传、自动指令队列、Prompt 管理、标题前缀、对话导出与设置备份。每个功能独立模块，放到不同选项卡。
// @author       小张
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://*.chat.openai.com/*
// @connect      *
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        window.close
// @noframes
// @exclude      https://chatgpt.com/backend-api/*
// @exclude      https://*.chatgpt.com/backend-api/*
// @run-at       document-idle
// @license      MIT
// ==/UserScript==
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

    const COMPOSER_AREA_SELECTORS = [
      '[data-testid="composer"]',
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[data-testid="composer-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ].join(',');

    function isInComposerArea(el) {
      if (!el) return false;
      return !!el.closest(COMPOSER_AREA_SELECTORS);
    }

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
      try {
        const normalizer = (
          typeof window !== 'undefined' && window.TextNormalizer
        ) ? window.TextNormalizer : (
          typeof TextNormalizer !== 'undefined' ? TextNormalizer : null
        );
        if (normalizer && typeof normalizer.stripLabel === 'function') {
          return normalizer.stripLabel(text);
        }
        console.error('[CORE_MAIN][TEXT_NORMALIZER_MISSING]', {
          fn: 'stripLabel',
        });
        return String(text == null ? '' : text);
      } catch (e) {
        console.error('[CORE_MAIN][STRIP_INSTRUMENTS_LABEL_FAILED]', {
          error: e && e.stack ? e.stack : String(e),
        });
        return String(text == null ? '' : text);
      }
    }

    function collapseInstrumentsCalculatorReply(text) {
      try {
        const normalizer = (
          typeof window !== 'undefined' && window.TextNormalizer
        ) ? window.TextNormalizer : (
          typeof TextNormalizer !== 'undefined' ? TextNormalizer : null
        );
        if (normalizer && typeof normalizer.collapseInstrumentsCalculatorReply === 'function') {
          return normalizer.collapseInstrumentsCalculatorReply(text);
        }
        console.error('[CORE_MAIN][TEXT_NORMALIZER_MISSING]', {
          fn: 'collapseInstrumentsCalculatorReply',
        });
        return String(text == null ? '' : text);
      } catch (e) {
        console.error('[CORE_MAIN][COLLAPSE_CALCULATOR_REPLY_FAILED]', {
          error: e && e.stack ? e.stack : String(e),
        });
        return String(text == null ? '' : text);
      }
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

  const ChatMessageRuntime = {
    conversationObserver: null,
    conversationObserverTarget: null,
    activeTimers: [],
    lastMainNode: null,
  };

  const latestAssistantMessageCache = {
    dirty: true,
    at: 0,
    mutationVersion: 0,
    conversationId: '',
    value: null,
  };

  const CHAT_MSG_PERF_LOG_INTERVAL_MS = 3000;
  const LATEST_ASSISTANT_CACHE_TTL_MS = 1000;
  const chatMsgPerfLogAt = new Map();

  function appendChatMsgPerfLog(key, line) {
    const now = Date.now();
    const last = Number(chatMsgPerfLogAt.get(key) || 0);

    if (now - last < CHAT_MSG_PERF_LOG_INTERVAL_MS) {
      return;
    }

    chatMsgPerfLogAt.set(key, now);

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function markLatestAssistantMessageCacheDirty() {
    latestAssistantMessageCache.dirty = true;
    latestAssistantMessageCache.mutationVersion += 1;
  }

  function getCurrentConversationIdForMessageCache() {
    return parseConversationIdFromPath(location.pathname || '') || '';
  }

  function stripMessageRecordForCache(record) {
    if (!record) {
      return null;
    }

    const text = String(record.text || '');
    const stripped = {
      role: String(record.role || ''),
      text,
      key: String(record.key || buildMessageRecordKey(record) || ''),
      turnId: String(record.turn_id || record.turnId || ''),
      index: Number(record.index || 0),
      textLen: text.length,
      charCount: Number(record.char_count || record.charCount || text.length || 0),
      at: Date.now(),
    };

    stripped.key = stripped.key || buildMessageRecordKey({
      role: stripped.role,
      text: stripped.text,
      turn_id: stripped.turnId,
      index: stripped.index,
      char_count: stripped.charCount,
    });

    return stripped;
  }

  function cleanupChatMessageCaches(reason) {
    latestAssistantMessageCache.dirty = true;
    latestAssistantMessageCache.value = null;
    latestAssistantMessageCache.at = 0;
    latestAssistantMessageCache.conversationId = '';

    if (window.__cgptLastConversationRecords) {
      window.__cgptLastConversationRecords = null;
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[CHAT_MSG][CACHE_CLEAR] reason=${reason || '-'}`);
    }
  }

  function cleanupRuntimeHandles(reason) {
    cleanupChatMessageCaches(reason);

    if (ChatMessageRuntime.conversationObserver) {
      ChatMessageRuntime.conversationObserver.disconnect();
      ChatMessageRuntime.conversationObserver = null;
    }

    ChatMessageRuntime.conversationObserverTarget = null;
    ChatMessageRuntime.lastMainNode = null;

    for (const timer of ChatMessageRuntime.activeTimers || []) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }

    ChatMessageRuntime.activeTimers = [];

    if (window.__cgptTurnCountObserver) {
      window.__cgptTurnCountObserver.disconnect();
      window.__cgptTurnCountObserver = null;
      window.__cgptTurnCountObserverBound = false;
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[RUNTIME][CLEANUP_HANDLES] reason=${reason || '-'}`);
    }
  }

  function disconnectToolboxObservers(source) {
    cleanupRuntimeHandles(source || 'disconnect-toolbox-observers');
  }

  function clearToolboxTimers(source) {
    if (toolboxTurnStatusRefreshTimer) {
      window.clearTimeout(toolboxTurnStatusRefreshTimer);
      toolboxTurnStatusRefreshTimer = 0;
    }

    toolboxTurnStatusRefreshPendingMode = 'light';

    if (typeof ReplyDoneTitleFlashWatcher !== 'undefined'
      && typeof ReplyDoneTitleFlashWatcher.stop === 'function') {
      ReplyDoneTitleFlashWatcher.stop(source || 'clear-toolbox-timers');
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.clearViewportTimers === 'function') {
      ToolboxShell.clearViewportTimers(source || 'clear-toolbox-timers');
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[RUNTIME][CLEAR_TIMERS] source=${source || '-'}`);
    }
  }

  function cleanupBeforePageNavigation(source) {
    setToolboxPageNavigating(true);

    try {
      ToolboxShell.appendLog(
        `[TOOLBOX_NAV_CLEANUP][START] source=${source || '-'} url=${window.location.href}`,
      );

      if (typeof stopAutoContinue === 'function') {
        stopAutoContinue('page-navigation');
      }

      if (typeof BridgeModule !== 'undefined' && typeof BridgeModule.stop === 'function') {
        BridgeModule.stop();
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadSendTask === 'function') {
        UploadModule.stopUploadSendTask('page-navigation');
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadTask === 'function') {
        UploadModule.stopUploadTask('page-navigation');
      }

      if (typeof disconnectToolboxObservers === 'function') {
        disconnectToolboxObservers('page-navigation');
      }

      if (typeof clearToolboxTimers === 'function') {
        clearToolboxTimers('page-navigation');
      }

      const finishNavFileCleanup = () => {
        if (typeof UploadModule !== 'undefined' && typeof UploadModule.clearUploadTransientFileRefs === 'function') {
          UploadModule.clearUploadTransientFileRefs('page-navigation');
        }

        ToolboxShell.appendLog(
          `[TOOLBOX_NAV_CLEANUP][DONE] source=${source || '-'}`,
        );
      };

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.persistQueueSnapshotBeforeNavCleanup === 'function'
      ) {
        void UploadModule.persistQueueSnapshotBeforeNavCleanup()
          .then(finishNavFileCleanup)
          .catch((persistErr) => {
            console.error('[ChatGPT toolbox] persistQueueSnapshotBeforeNavCleanup failed', persistErr);
            const errText = persistErr && persistErr.message ? persistErr.message : String(persistErr);
            ToolboxShell.appendLog(
              `[TOOLBOX_NAV_CLEANUP][PERSIST_BEFORE_CLEAR_FAILED] source=${source || '-'} error=${errText}`,
            );
            finishNavFileCleanup();
          });
      } else {
        finishNavFileCleanup();
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] cleanupBeforePageNavigation failed', err);

      const errName = err && err.name ? err.name : 'Error';
      const errText = err && err.message ? err.message : String(err);

      ToolboxShell.appendLog(
        `[TOOLBOX_NAV_CLEANUP][ERROR] source=${source || '-'} type=${errName} error=${errText}`,
      );
    }
  }

  function getLatestConversationMessageRecordFast(options = {}) {
    const startedAt = Date.now();

    try {
      const record = ChatMessageExtractor.getLatestConversationMessageRecordFromTail(options);
      const cost = Date.now() - startedAt;
      const records = ChatMessageExtractor.getFastTailMessageRecords({
        includeHidden: options.includeHidden === true,
      });

      appendChatMsgPerfLog(
        'latest-fast',
        `[PERF][latestMessage] mode=fast cost=${cost}ms records=${records.length} textLen=${record ? String(record.text || '').length : 0}`,
      );

      if (record) {
        appendChatMsgPerfLog(
          'latest-fast-ok',
          `[CHAT_MSG][LATEST_FAST] ok=1 role=${record.role || '-'} textLen=${String(record.text || '').length} cost=${cost}ms`,
        );
      }

      return record;
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? String(error.stack).slice(0, 400) : '';
      console.error('[ChatGPT toolbox] getLatestConversationMessageRecordFast failed', error);
      ToolboxShell.appendLog(`[CHAT_MSG][LATEST_FAST][failed] error=${errText} stack=${stack}`);
      return null;
    }
  }

  function getLatestConversationMessageRecordFull(options = {}) {
    const preferredRole = String(options.role || '').toLowerCase();
    const preferAssistant = options.preferAssistant !== false;
    const allowPreviousAssistantFallback = options.allowPreviousAssistantFallback === true;
    const startedAt = Date.now();
    const records = buildConversationMessageRecords({
      includeEmpty: false,
      includeHidden: options.includeHidden === true,
    });
    const cost = Date.now() - startedAt;

    appendChatMsgPerfLog(
      'latest-full',
      `[PERF][latestMessage] mode=full cost=${cost}ms records=${records.length} textLen=${records.length ? String(records[records.length - 1].text || '').length : 0}`,
    );

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
      const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
      if (picked.ok && picked.record) {
        return picked.record;
      }

      if (allowPreviousAssistantFallback) {
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

  function buildConversationMessageRecords(options = {}) {
    return ChatMessageExtractor.buildRecords(options);
  }

  function getLatestConversationMessageRecord(options = {}) {
    if (options.forceFullScan === true) {
      return getLatestConversationMessageRecordFull(options);
    }

    const fastRecord = getLatestConversationMessageRecordFast(options);

    if (fastRecord) {
      return fastRecord;
    }

    return getLatestConversationMessageRecordFull(options);
  }

  function buildMessageRecordKey(record) {
    if (!record) {
      return '';
    }

    return [
      String(record.role || ''),
      String(record.turn_id || record.turnId || ''),
      String(record.index ?? ''),
      String(record.char_count ?? record.charCount ?? ''),
      String(record.text || '').slice(0, 120),
    ].join('|');
  }

  function getLatestAssistantAfterLatestUserRecord(options = {}) {
    const includeHidden = options.includeHidden === true;
    const records = options.forceFullScan === true
      ? buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden,
      })
      : ChatMessageExtractor.getFastTailMessageRecords({
        includeHidden,
      });
    const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records, {
      allowNoUserFallback: options.allowNoUserFallback === true,
    });

    if (!picked.ok || !picked.record) {
      if (options.forceFullScan === true) {
        return null;
      }

      const fullRecords = buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden,
      });
      const fullPicked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(fullRecords, {
        allowNoUserFallback: options.allowNoUserFallback === true,
      });

      if (!fullPicked.ok || !fullPicked.record) {
        return null;
      }

      const fullText = ChatMessageExtractor.cleanMessageText(fullPicked.record.text || '').trim();

      return {
        ...stripMessageRecordForCache(fullPicked.record),
        text: fullText,
        ok: true,
        latestUser: fullPicked.latestUser
          ? stripMessageRecordForCache(fullPicked.latestUser)
          : null,
        reason: fullPicked.reason || '',
      };
    }

    const text = ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();

    return {
      ...stripMessageRecordForCache(picked.record),
      text,
      ok: true,
      latestUser: picked.latestUser
        ? stripMessageRecordForCache(picked.latestUser)
        : null,
      reason: picked.reason || '',
    };
  }

  const ASSISTANT_COPY_NOISE_SELECTORS = [
    'button',
    'textarea',
    'input',
    'select',
    'svg',
    'style',
    'script',
    '#cgpt-toolbox-root',
    '[aria-hidden="true"]',
    '[data-testid="copy-turn-action-button"]',
    '[data-testid="feedback-actions"]',
    '[data-testid*="feedback"]',
    '[data-testid*="copy"]',
    '[data-testid*="share"]',
    '[data-testid*="regenerate"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[class*="text-token-text-tertiary"]',
  ].join(',');

  function extractAssistantReplyTextFromElement(assistantEl) {
    if (!(assistantEl instanceof HTMLElement)) {
      return '';
    }

    const markdown = assistantEl.querySelector(
      '.markdown, [data-message-content], [class*="markdown"], .whitespace-pre-wrap',
    );
    const source = markdown instanceof HTMLElement ? markdown : assistantEl;
    const clone = source.cloneNode(true);

    clone.querySelectorAll(ASSISTANT_COPY_NOISE_SELECTORS).forEach((el) => {
      el.remove();
    });

    return String(clone.innerText || clone.textContent || '').trim();
  }

  function getValidAssistantTextsFromDom() {
    const main = document.querySelector('main') || document.body;
    if (!(main instanceof HTMLElement)) {
      return [];
    }

    return Array.from(main.querySelectorAll('[data-message-author-role="assistant"]'))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !isInToolbox(node) && !isInComposerArea(node) && !isChatSidebarElement(node))
      .map((node) => extractAssistantReplyTextFromElement(node))
      .filter(Boolean);
  }

  function getBridgeReplyBaseline() {
    const validAssistantTexts = getValidAssistantTextsFromDom();

    return {
      assistant_count: validAssistantTexts.length,
      last_assistant_text: validAssistantTexts[validAssistantTexts.length - 1] || '',
      started_at: Date.now(),
    };
  }

  function findLastAssistantTurn() {
    const toolboxRoot = document.querySelector(`#${APP.rootId}`);
    const turnSelectors = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      '[id^="conversation-turn-"]',
    ];

    let turns = [];

    turnSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node instanceof HTMLElement && !turns.includes(node)) {
          turns.push(node);
        }
      });
    });

    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];

      if (!(turn instanceof HTMLElement)) {
        continue;
      }

      if (toolboxRoot && toolboxRoot.contains(turn)) {
        continue;
      }

      if (isInToolbox(turn) || isInComposerArea(turn) || isChatSidebarElement(turn)) {
        continue;
      }

      const text = String(turn.innerText || '').trim();

      if (!text) {
        continue;
      }

      const isAssistant =
        turn.querySelector('[data-message-author-role="assistant"]')
        || turn.getAttribute('data-message-author-role') === 'assistant';

      if (isAssistant) {
        return turn;
      }
    }

    return null;
  }

  function extractAssistantText(turn) {
    if (!(turn instanceof HTMLElement)) {
      return '';
    }

    const assistantEl =
      turn.querySelector('[data-message-author-role="assistant"]')
      || (turn.getAttribute('data-message-author-role') === 'assistant' ? turn : null);

    if (assistantEl) {
      return extractAssistantReplyTextFromElement(assistantEl);
    }

    const clone = turn.cloneNode(true);

    clone.querySelectorAll(ASSISTANT_COPY_NOISE_SELECTORS).forEach((el) => {
      el.remove();
    });

    return String(clone.innerText || clone.textContent || '').trim();
  }

  function getLatestAssistantTextFromDomDirect() {
    const turn = findLastAssistantTurn();

    if (turn) {
      const turnText = extractAssistantText(turn);

      if (turnText) {
        return turnText;
      }
    }

    const main = document.querySelector('main') || document.body;
    if (!(main instanceof HTMLElement)) {
      return '';
    }

    const nodes = Array.from(
      main.querySelectorAll('[data-message-author-role="assistant"]'),
    );

    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];

      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (isInToolbox(node) || isInComposerArea(node) || isChatSidebarElement(node)) {
        continue;
      }

      const text = extractAssistantReplyTextFromElement(node);

      if (text) {
        return text;
      }
    }

    return '';
  }

  function extractBridgeAssistantReplyText(replyBaseline) {
    const domTexts = getValidAssistantTextsFromDom();

    if (replyBaseline && typeof replyBaseline.assistant_count === 'number') {
      const baselineCount = replyBaseline.assistant_count;
      if (domTexts.length > baselineCount) {
        const newTexts = domTexts.slice(baselineCount);
        const candidate = newTexts[newTexts.length - 1] || '';
        if (candidate) {
          return candidate;
        }
      }

      const latestDom = domTexts[domTexts.length - 1] || '';
      const baselineText = String(replyBaseline.last_assistant_text || '').trim();
      if (latestDom && latestDom !== baselineText) {
        return latestDom;
      }
    }

    const latestAssistant = getLatestAssistantAfterLatestUserRecord({
      includeHidden: true,
    });

    let text = latestAssistant && latestAssistant.text
      ? String(latestAssistant.text).trim()
      : '';

    if (!text) {
      text = getLatestAssistantTextFromDomDirect();
    }

    if (replyBaseline) {
      const baselineText = String(replyBaseline.last_assistant_text || '').trim();
      if (text && text === baselineText) {
        return '';
      }
    }

    return text;
  }

  function getLatestAssistantMessageForCopy(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const conversationId = getCurrentConversationIdForMessageCache();
    const now = Date.now();
    const cache = latestAssistantMessageCache;

    if (
      !forceRefresh
      && cache.dirty === false
      && now - cache.at < LATEST_ASSISTANT_CACHE_TTL_MS
      && cache.conversationId === conversationId
      && cache.value
    ) {
      appendChatMsgPerfLog(
        'cache-hit',
        `[CHAT_MSG][CACHE_HIT] age=${now - cache.at}ms textLen=${cache.value.textLen || 0}`,
      );
      return cache.value;
    }

    let missReason = 'dirty';

    if (cache.conversationId !== conversationId) {
      missReason = 'conversation_changed';
    } else if (now - cache.at >= LATEST_ASSISTANT_CACHE_TTL_MS) {
      missReason = 'expired';
    }

    if (forceRefresh || cache.dirty || cache.conversationId !== conversationId) {
      appendChatMsgPerfLog(
        'cache-miss',
        `[CHAT_MSG][CACHE_MISS] reason=${missReason}${forceRefresh ? '/force_refresh' : ''}`,
      );
    }

    const startedAt = Date.now();
    let rawRecord = getLatestConversationMessageRecordFast({
      preferAssistant: true,
      includeHidden: false,
      allowNoUserFallback: options.allowNoUserFallback === true,
      allowPreviousAssistantFallback: options.allowPreviousAssistantFallback === true,
    });
    let mode = 'fast';

    if (!rawRecord || !rawRecord.text) {
      const fallbackStartedAt = Date.now();
      const reason = rawRecord ? 'empty_text' : 'no_record';
      const fullRecords = buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden: true,
      });
      const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(fullRecords, {
        allowNoUserFallback: options.allowNoUserFallback === true,
      });
      rawRecord = picked.ok ? picked.record : null;
      mode = 'full';
      ToolboxShell.appendLog(
        `[CHAT_MSG][LATEST_FALLBACK_FULL_SCAN] reason=${reason} cost=${Date.now() - fallbackStartedAt}ms records=${fullRecords.length}`,
      );
    }

    const cost = Date.now() - startedAt;

    if (!rawRecord || !rawRecord.text) {
      const domText = getLatestAssistantTextFromDomDirect();
      if (domText) {
        const domResult = {
          ok: true,
          text: domText,
          record: null,
          reason: 'assistant-turn-dom',
        };
        cache.dirty = false;
        cache.at = now;
        cache.conversationId = conversationId;
        cache.value = domResult;
        return domResult;
      }

      const failed = {
        ok: false,
        text: '',
        reason: 'last-assistant-message-missing',
        record: null,
      };
      cache.dirty = true;
      cache.value = null;
      cache.at = now;
      cache.conversationId = conversationId;
      return failed;
    }

    const text = ChatMessageExtractor.cleanMessageText(rawRecord.text || '').trim();
    const strippedRecord = stripMessageRecordForCache(rawRecord);
    const result = {
      ok: true,
      text,
      record: strippedRecord,
      reason: mode === 'fast' ? 'fast-tail' : 'full-scan-fallback',
    };

    appendChatMsgPerfLog(
      `latest-copy-${mode}`,
      `[PERF][latestMessage] mode=${mode} cost=${cost}ms textLen=${text.length}`,
    );

    cache.dirty = false;
    cache.at = now;
    cache.conversationId = conversationId;
    cache.value = result;

    return result;
  }

  function bridgeSafeConversationRecord(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const safe = {};
    Object.keys(record).forEach((key) => {
      if (key === 'element') {
        return;
      }
      const value = record[key];
      if (value instanceof Node) {
        return;
      }
      if (typeof value === 'function') {
        return;
      }
      safe[key] = value;
    });
    return safe;
  }

  function buildConversationSnapshotStats(messages, domEstimatedRoundCount) {
    const list = Array.isArray(messages) ? messages : [];

    let userCount = 0;
    let assistantCount = 0;
    let systemCount = 0;
    let unknownCount = 0;
    let userChars = 0;
    let assistantChars = 0;
    let totalChars = 0;

    list.forEach((msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }

      const role = String(msg.role || '').trim().toLowerCase();
      const text = String(msg.text || msg.content || '').trim();
      const charCount = text.replace(/\s+/g, '').length;

      totalChars += charCount;

      if (role === 'user') {
        userCount += 1;
        userChars += charCount;
      } else if (role === 'assistant') {
        assistantCount += 1;
        assistantChars += charCount;
      } else if (role === 'system' || role === 'tool') {
        systemCount += 1;
      } else {
        unknownCount += 1;
      }
    });

    const totalCount = list.length;
    const pairedRoundCount = Math.min(userCount, assistantCount);
    const roundCount = pairedRoundCount > 0
      ? pairedRoundCount
      : Math.ceil(totalCount / 2);

    return {
      total_count: totalCount,
      user_count: userCount,
      assistant_count: assistantCount,
      system_count: systemCount,
      unknown_count: unknownCount,
      user_chars: userChars,
      assistant_chars: assistantChars,
      total_chars: totalChars,
      round_count: roundCount,
      dom_estimated_round_count: Number.isFinite(Number(domEstimatedRoundCount))
        ? Number(domEstimatedRoundCount)
        : 0,
    };
  }

  function getConversationSnapshotScopeKey() {
    const convId = parseConversationIdFromPath(location.pathname || '');
    if (convId) {
      return `conversation:${convId}`;
    }
    return `route:${location.pathname || '/'}${location.search || ''}`;
  }

  function isStableConversationSnapshotScope(scopeKey) {
    return String(scopeKey || '').startsWith('conversation:');
  }

  function getConversationSnapshotScopeFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return '';
    }
    return String(
      snapshot.conversation_scope_key
      || (snapshot.page && snapshot.page.conversation_scope_key)
      || '',
    ).trim();
  }

  function stampConversationSnapshotScope(snapshot) {
    const next = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const convId = parseConversationIdFromPath(location.pathname || '') || '';
    const scopeKey = getConversationSnapshotScopeKey();

    next.conversation_scope_key = scopeKey;
    next.conversation_id = convId;
    next.pathname = location.pathname || '';
    next.search = location.search || '';
    next.saved_at = Date.now();

    if (!next.page || typeof next.page !== 'object') {
      next.page = {};
    }

    next.page.conversation_scope_key = scopeKey;
    next.page.conversation_id = convId;
    next.page.pathname = location.pathname || '';
    next.page.search = location.search || '';

    return next;
  }

  function getSavedConversationSnapshot() {
    if (typeof MemoryManager === 'undefined' || !MemoryManager.get) {
      return null;
    }

    return MemoryManager.get(MemoryManager.KEYS.conversationSnapshotCache, null);
  }

  function getSavedConversationSnapshotForCurrentScope() {
    const scopeKey = getConversationSnapshotScopeKey();

    if (!isStableConversationSnapshotScope(scopeKey)) {
      return null;
    }

    const saved = getSavedConversationSnapshot();
    const savedScopeKey = getConversationSnapshotScopeFromSnapshot(saved);

    if (!savedScopeKey || savedScopeKey !== scopeKey) {
      return null;
    }

    return saved;
  }

  function saveConversationSnapshotSafe(snapshot, reason = '') {
    const scopedSnapshot = stampConversationSnapshotScope(snapshot);
    const oldSnapshot = getSavedConversationSnapshot();
    const newMessages = Array.isArray(scopedSnapshot && scopedSnapshot.messages)
      ? scopedSnapshot.messages
      : [];
    const oldMessages = Array.isArray(oldSnapshot && oldSnapshot.messages)
      ? oldSnapshot.messages
      : [];

    const currentScopeKey = getConversationSnapshotScopeKey();
    const oldScopeKey = getConversationSnapshotScopeFromSnapshot(oldSnapshot);
    const sameStableScope = isStableConversationSnapshotScope(currentScopeKey)
      && oldScopeKey === currentScopeKey;

    if (newMessages.length === 0 && oldMessages.length > 0 && sameStableScope) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CONVERSATION][SAVE_SKIP] reason=avoid-overwrite-with-empty detail=${reason || '-'} old=${oldMessages.length} scope=${currentScopeKey}`,
        );
      }

      return false;
    }

    if (typeof MemoryManager !== 'undefined' && MemoryManager.set) {
      MemoryManager.set(MemoryManager.KEYS.conversationSnapshotCache, scopedSnapshot);
    }

    return true;
  }

  async function waitChatPageReady(options = {}) {
    // TODO_DEDUP: core/page-lifecycle.js 中已有 waitChatPageReady 候选实现，
    // 但当前未确认已进入 .build-order.json。本轮不要直接切换依赖，避免运行时未定义。
    // 后续应在确认 build order 后，将 main.js 中该函数改成委托 ToolboxPageLifecycle.waitChatPageReady。
    const timeoutMs = Number(options.timeoutMs || 30000);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const main = document.querySelector('main');
      const composer = document.querySelector(
        '#prompt-textarea, [data-testid="prompt-textarea"], textarea, [contenteditable="true"]',
      );
      const turns = document.querySelectorAll(
        'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"], [id^="conversation-turn-"]',
      );

      if (main && composer) {
        return {
          ok: true,
          reason: 'ready',
          turnCount: turns.length,
        };
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 300);
      });
    }

    return {
      ok: false,
      reason: 'chat-page-ready-timeout',
    };
  }

  function buildConversationSnapshotForBridge(resolvePageIdentity, options = {}) {
    const snapshotSource = String(
      options && (options.source || options.caller)
        ? (options.source || options.caller)
        : 'unspecified',
    );
    const perfStartedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    try {
      const rawMessages = buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden: true,
      });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][conversation-snapshot] source=${snapshotSource} messages=${rawMessages.length} includeHidden=1`,
        );
      }

      const messages = rawMessages
        .map((record) => bridgeSafeConversationRecord(record))
        .filter(Boolean);

      let domEstimatedRoundCount = 0;
      try {
        domEstimatedRoundCount = countConversationTurnsFromTurnIndex();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] count dom estimated round failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][snapshot-stats-dom-round-failed] error=${errText}`);
      }

      const stats = buildConversationSnapshotStats(messages, domEstimatedRoundCount);

      const latestAny = messages.length ? messages[messages.length - 1] : null;
      const pickedAssistant = ChatMessageExtractor.getLatestAssistantAfterLatestUser(rawMessages);
      const latestAssistant = pickedAssistant.ok && pickedAssistant.record
        ? bridgeSafeConversationRecord(pickedAssistant.record)
        : null;

      const page = typeof resolvePageIdentity === 'function' ? resolvePageIdentity() : {};

      const snapshot = stampConversationSnapshotScope({
        page,
        stats,
        message_count: stats.total_count,
        user_count: stats.user_count,
        assistant_count: stats.assistant_count,
        round_count: stats.round_count,
        dom_estimated_round_count: stats.dom_estimated_round_count,
        latest_message: latestAny,
        latest_assistant_reply: latestAssistant,
        latest_assistant_message: latestAssistant,
        latest_any_message: latestAny,
        has_new_assistant_after_latest_user: Boolean(latestAssistant),
        messages,
        text: messages.map((m) => {
          const label = m.role === 'assistant' ? '助手' : (m.role === 'user' ? '用户' : m.role || '消息');
          return `--- ${label} ${m.index + 1} ---\n${m.text || ''}`;
        }).join('\n\n'),
      });

      if (messages.length === 0) {
        const saved = getSavedConversationSnapshotForCurrentScope();
        const savedMessages = Array.isArray(saved && saved.messages) ? saved.messages : [];

        if (savedMessages.length > 0) {
          saveConversationSnapshotSafe(snapshot, 'build-empty-skip');

          return stampConversationSnapshotScope({
            ...saved,
            page,
            stats: saved.stats || stats,
          });
        }
      }

      saveConversationSnapshotSafe(snapshot, 'build-snapshot');

      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - perfStartedAt,
      );
      const messageCount = Array.isArray(messages) ? messages.length : 0;
      const totalChars = messages.reduce(
        (sum, item) => sum + String(item && item.text ? item.text : '').length,
        0,
      );

      const perfLine = `[PERF][conversation_snapshot] source=${snapshotSource} messages=${messageCount} total_chars=${totalChars} cost_ms=${costMs}`;
      if (costMs > 300 && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(perfLine);
      }
      if (costMs > 300) {
        const slowLine = `[PERF][conversation_snapshot_slow] source=${snapshotSource} messages=${messageCount} total_chars=${totalChars} cost_ms=${costMs}`;
        console.warn(slowLine);
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(slowLine);
        }
      }

      return snapshot;
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      const errStack = error && error.stack ? String(error.stack) : errText;
      console.error('[ChatGPT toolbox] buildConversationSnapshotForBridge failed', error);
      ToolboxShell.appendLog(
        `[CHAT_PAGE][conversation-snapshot:failed] source=${snapshotSource} error=${errText} stack=${errStack}`,
      );
      throw error;
    }
  }

  /********************************************************************
   * 2. ComposerApi：ChatGPT 页面操作隔离
   ********************************************************************/

  let composerDetectDepth = 0;
  const MAX_COMPOSER_DETECT_DEPTH = 3;
  const composerGuardLogMap = new Map();
  let lastKnownComposer = null;
  let lastKnownComposerRoot = null;

  function logComposerRecursionGuardThrottled(scope, depth, max) {
    const now = Date.now();
    const key = String(scope || '-');
    const last = composerGuardLogMap.get(key) || 0;
    if (now - last < 3000) {
      return;
    }
    composerGuardLogMap.set(key, now);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[COMPOSER][RECURSION_GUARD] scope=${key} depth=${depth} max=${max}`,
      );
    }
  }

  function withComposerDetectGuard(scope, fallbackValue, fn, cacheKind = '') {
    if (composerDetectDepth >= MAX_COMPOSER_DETECT_DEPTH) {
      const cached = cacheKind === 'composer'
        ? lastKnownComposer
        : cacheKind === 'composerRoot'
          ? lastKnownComposerRoot
          : null;
      const fallback = cached instanceof HTMLElement
        ? cached
        : (fallbackValue === undefined ? null : fallbackValue);
      console.error('[ChatGPT toolbox] composer recursion guard triggered', {
        scope: String(scope || '-'),
        depth: composerDetectDepth,
        maxDepth: MAX_COMPOSER_DETECT_DEPTH,
        cacheKind: cacheKind || '-',
        cached: cached instanceof HTMLElement ? 1 : 0,
      });
      logComposerRecursionGuardThrottled(
        String(scope || '-'),
        composerDetectDepth,
        MAX_COMPOSER_DETECT_DEPTH,
      );
      if (cached instanceof HTMLElement && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COMPOSER][RECURSION_GUARD_RETURN_CACHE] scope=${String(scope || '-')} cached=1`,
        );
      }
      return fallback;
    }

    composerDetectDepth += 1;
    try {
      return fn();
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] composer detect failed', error);
      ToolboxShell.appendLog(
        `[COMPOSER][DETECT_ERROR] scope=${String(scope || '-')} error=${errText}`,
      );
      const cached = cacheKind === 'composer'
        ? lastKnownComposer
        : cacheKind === 'composerRoot'
          ? lastKnownComposerRoot
          : null;
      if (cached instanceof HTMLElement) {
        return cached;
      }
      return fallbackValue;
    } finally {
      composerDetectDepth = Math.max(0, composerDetectDepth - 1);
    }
  }

  const ComposerApi = (() => {
    function getComposer() {
      return withComposerDetectGuard('ComposerApi.getComposer', null, () => {
        for (const sel of SELECTORS.composerTextarea) {
          const el = qs(sel);
          if (el instanceof HTMLElement && !isInToolbox(el) && isElementVisible(el)) {
            lastKnownComposer = el;
            return el;
          }
        }

        return lastKnownComposer instanceof HTMLElement ? lastKnownComposer : null;
      }, 'composer');
    }

    function hasComposer() {
      return getComposer() instanceof HTMLElement;
    }

    function canAcceptInput() {
      const composer = getComposer();

      if (!(composer instanceof HTMLElement)) {
        return false;
      }

      if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
        return false;
      }

      if (!isElementVisible(composer)) {
        return false;
      }

      return true;
    }

    function canAcceptTextInput() {
      return canAcceptInput();
    }

    function getComposerRoot() {
      return withComposerDetectGuard('ComposerApi.getComposerRoot', null, () => {
        const c = qs(SELECTORS.composer);
        if (c instanceof HTMLElement && !isInToolbox(c)) {
          lastKnownComposerRoot = c;
          return c;
        }

        const unifiedForm = document.querySelector('form[data-type="unified-composer"]');
        if (unifiedForm instanceof HTMLElement && !isInToolbox(unifiedForm)) {
          lastKnownComposerRoot = unifiedForm;
          return unifiedForm;
        }

        const genericForm = document.querySelector('form');
        if (genericForm instanceof HTMLElement && !isInToolbox(genericForm)) {
          lastKnownComposerRoot = genericForm;
          return genericForm;
        }

        return lastKnownComposerRoot instanceof HTMLElement ? lastKnownComposerRoot : null;
      }, 'composerRoot');
    }

    function isButtonBelongsToComposer(btn, composer, composerRoot, composerForm) {
      if (!(btn instanceof HTMLElement)) {
        return false;
      }

      if (composerRoot instanceof HTMLElement && composerRoot.contains(btn)) {
        return true;
      }

      if (composerForm instanceof HTMLElement && composerForm.contains(btn)) {
        return true;
      }

      const btnForm = btn.closest('form');
      if (btnForm instanceof HTMLElement && composerForm instanceof HTMLElement && btnForm === composerForm) {
        return true;
      }

      if (composer instanceof HTMLElement && composer.contains(btn)) {
        return true;
      }

      return false;
    }

    function isButtonNearComposer(btn, composer) {
      if (!(btn instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
        return false;
      }

      if (!isElementVisible(btn)) {
        return false;
      }

      const btnRect = btn.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();

      if (btnRect.width <= 0 || btnRect.height <= 0) {
        return false;
      }

      const verticalDistance = Math.abs(
        ((btnRect.top + btnRect.bottom) / 2) - ((composerRect.top + composerRect.bottom) / 2),
      );

      const horizontalDistance = Math.abs(
        ((btnRect.left + btnRect.right) / 2) - ((composerRect.left + composerRect.right) / 2),
      );

      return verticalDistance <= 160 && horizontalDistance <= 900;
    }

    const composerLogThrottle = new Map();

    function getComposerPollLogThrottleMs() {
      return isComposerDebugEnabled() ? 1000 : 3000;
    }

    function appendComposerLogThrottled(key, text, intervalMs) {
      const throttleMs = Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0
        ? Number(intervalMs)
        : getComposerPollLogThrottleMs();
      const now = Date.now();
      const last = Number(composerLogThrottle.get(key) || 0);

      if (now - last < throttleMs) {
        return;
      }

      composerLogThrottle.set(key, now);
      ToolboxShell.appendLog(text);
    }

    function appendComposerPollLogThrottled(key, text) {
      if (
        !isComposerDebugEnabled()
        && typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        return;
      }
      appendComposerLogThrottled(key, text, getComposerPollLogThrottleMs());
    }

    const SEND_ARIA_POSITIVE = /(?:^|\b)(?:send(?:\s+(?:message|prompt))?|发送(?:消息|提示)?)(?:\b|$)/i;

    let lastSendButtonScanMeta = {
      total: 0,
      matched: 0,
      reason: '',
      selector: '',
      at: 0,
    };

    function describeSendButton(btn) {
      if (!(btn instanceof HTMLButtonElement)) {
        return {
          selector: '',
          aria: '',
          testid: '',
          disabled: true,
        };
      }

      const testid = String(btn.getAttribute('data-testid') || '-');
      const id = String(btn.id || '').trim();
      const aria = String(btn.getAttribute('aria-label') || '-');
      const type = String(btn.getAttribute('type') || '').trim();
      const selector = testid !== '-'
        ? `button[data-testid="${testid}"]`
        : (id ? `button#${id}` : (type ? `button[type="${type}"]` : 'button'));

      return {
        selector,
        aria,
        testid,
        disabled: !isSendButtonReady(btn),
      };
    }

    function resolveButtonElement(el) {
      if (el instanceof HTMLButtonElement) {
        return el;
      }

      if (el && typeof el.closest === 'function') {
        const button = el.closest('button');
        if (button instanceof HTMLButtonElement) {
          return button;
        }
      }

      return null;
    }

    function isVoiceButton(el) {
      const button = resolveButtonElement(el);

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      if (button.classList.contains('composer-speech-button')) {
        return true;
      }

      const useHrefList = Array.from(button.querySelectorAll('use'))
        .map((use) => String(use.getAttribute('href') || use.getAttribute('xlink:href') || ''))
        .join(' ')
        .toLowerCase();

      const mark = [
        button.id || '',
        button.className || '',
        button.getAttribute('aria-label') || '',
        button.getAttribute('title') || '',
        button.getAttribute('data-testid') || '',
        button.textContent || '',
        useHrefList,
      ].join(' ').toLowerCase();

      return (
        mark.includes('\u542f\u52a8\u8bed\u97f3\u529f\u80fd')
        || mark.includes('\u5f00\u59cb\u542c\u5199')
        || mark.includes('\u505c\u6b62\u542c\u5199')
        || mark.includes('\u542c\u5199')
        || mark.includes('\u8bed\u97f3')
        || mark.includes('\u9ea6\u514b\u98ce')
        || mark.includes('\u5f55\u97f3')
        || mark.includes('voice')
        || mark.includes('microphone')
        || mark.includes('dictate')
        || mark.includes('dictation')
        || mark.includes('audio')
        || mark.includes('speech')
        || mark.includes('mic')
        || mark.includes('#f8aa74')
      );
    }

    function isStopGeneratingButton(el) {
      const button = resolveButtonElement(el);

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      const testId = String(button.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('stop')) {
        return true;
      }

      const aria = String(button.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = String(button.getAttribute('title') || '').trim().toLowerCase();
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const probe = `${aria} ${title} ${text}`;

      return /(?:^|\b)(?:stop(?:\s+generating)?|停止(?:生成)?|halt|pause)(?:\b|$)/i.test(probe);
    }

    function isRealSendButtonShape(el) {
      const button = resolveButtonElement(el);

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      if (isVoiceButton(button)) {
        return false;
      }

      if (isStopGeneratingButton(button)) {
        return false;
      }

      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      if (button.id === 'composer-submit-button') {
        return true;
      }

      const testid = String(button.getAttribute('data-testid') || '').trim();
      if (testid === 'send-button' || testid === 'composer-submit-button') {
        return true;
      }

      const mark = [
        button.id || '',
        button.className || '',
        button.getAttribute('aria-label') || '',
        button.getAttribute('title') || '',
        button.getAttribute('data-testid') || '',
        button.textContent || '',
      ].join(' ').toLowerCase();

      return (
        mark.includes('send')
        || mark.includes('submit')
        || mark.includes('\u53d1\u9001')
      );
    }

    function isRealSendButton(el) {
      const button = resolveButtonElement(el);

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      if (button.disabled) {
        return false;
      }

      return isRealSendButtonShape(button);
    }

    function isComposerDebugEnabled() {
      if (typeof isToolboxDebugEnabled === 'function') {
        return isToolboxDebugEnabled();
      }
      return false;
    }

    function hasComposerPayloadForSend() {
      if (hasRealComposerText()) {
        return true;
      }

      if (hasComposerAttachmentUnified()) {
        return true;
      }

      if (hasComposerDraftPayload()) {
        return true;
      }

      return false;
    }

    function hasRealComposerText() {
      return withComposerDetectGuard('hasRealComposerText', false, () => {
        const text = String(getComposerText() || '').trim();
        return text.length > 0;
      });
    }

    function hasRealSubmitButton() {
      const byId = document.querySelector('#composer-submit-button');
      if (byId instanceof HTMLButtonElement && isRealSendButtonShape(byId)) {
        return true;
      }

      const btn = findSendButton({ silent: true });
      if (btn instanceof HTMLButtonElement && isRealSendButtonShape(btn)) {
        return true;
      }

      return false;
    }

    function isExcludedComposerButton(btn) {
      if (!(btn instanceof HTMLButtonElement)) {
        return true;
      }

      const testId = String(btn.getAttribute('data-testid') || '').toLowerCase();
      const id = String(btn.id || '').toLowerCase();
      const aria = String(btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = String(btn.getAttribute('title') || '').trim().toLowerCase();
      const text = String(btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const negativeText = `${testId} ${id} ${aria} ${title} ${text}`;

      if (/attach|upload|file|附件|上传|voice|mic|microphone|audio|dictat|录音|语音|听写|启动语音|开始听写|tool|工具|plugin|plug-in|model|模型|gpt-|search|搜索|browse|浏览|think|reason|plus|pro-mode|settings|设置|menu|菜单|share|分享|copy|复制|edit|编辑|regenerate|重新生成|thumb|赞|踩|file-picker|composer-plus|composer-attach|composer-voice|composer-mic|stop|停止|halt|pause/i.test(negativeText)) {
        return true;
      }

      if (
        testId.includes('attach')
        || testId.includes('upload')
        || testId.includes('voice')
        || testId.includes('mic')
        || testId.includes('model')
        || testId.includes('tool')
        || testId.includes('search')
        || testId.includes('stop')
      ) {
        return true;
      }

      return false;
    }

    function isLikelyComposerSendButton(btn) {
      if (!(btn instanceof HTMLButtonElement)) {
        return false;
      }

      if (isVoiceButton(btn)) {
        return false;
      }

      if (typeof isVoiceComposerButton === 'function' && isVoiceComposerButton(btn)) {
        return false;
      }

      const testId = String(btn.getAttribute('data-testid') || '').toLowerCase();
      const id = String(btn.id || '').toLowerCase();
      const aria = String(btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = String(btn.getAttribute('title') || '').trim().toLowerCase();
      const text = String(btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const type = String(btn.getAttribute('type') || '').toLowerCase();
      const cls = String(btn.className || '').toLowerCase();

      const allText = `${testId} ${id} ${aria} ${title} ${text} ${cls}`;

      if (
        /attach|upload|file|附件|上传|voice|mic|microphone|audio|语音|听写|启动语音|开始听写|tool|工具|model|模型|search|搜索/i
          .test(allText)
      ) {
        return false;
      }

      const positive = [
        testId === 'send-button',
        testId === 'composer-submit-button',
        id === 'composer-submit-button',
        [
          '\u53d1\u9001',
          '\u53d1\u9001\u6d88\u606f',
          '\u53d1\u9001\u63d0\u793a',
          'send',
          'send message',
          'send prompt',
        ].includes(aria),
        [
          '\u53d1\u9001',
          '\u53d1\u9001\u6d88\u606f',
          'send',
          'send message',
        ].includes(title),
        [
          '\u53d1\u9001',
          'send',
        ].includes(text),
        cls.includes('composer-submit-button'),
        cls.includes('text-submit-btn-text'),
      ];

      if (positive.some(Boolean)) {
        return true;
      }

      if (type === 'submit') {
        return true;
      }

      return isRealSendButtonShape(btn);
    }

    function isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, scope) {
      if (!(btn instanceof HTMLButtonElement)) {
        return false;
      }

      if (isInToolbox(btn)) {
        return false;
      }

      if (!isElementVisible(btn)) {
        return false;
      }

      if (
        scope !== document.body &&
        !isButtonBelongsToComposer(btn, composer, composerRoot, composerForm)
      ) {
        return false;
      }

      if (
        scope === document.body &&
        !isButtonBelongsToComposer(btn, composer, composerRoot, composerForm) &&
        !isButtonNearComposer(btn, composer)
      ) {
        return false;
      }

      if (isExcludedComposerButton(btn)) {
        return false;
      }

      return true;
    }

    function buildSendButtonPreview(buttons, limit = 6) {
      return buttons.slice(0, limit).map((btn) => {
        const info = describeSendButton(btn);
        return [
          info.testid,
          info.aria,
          String(btn.id || '-'),
          btn.disabled ? 'disabled' : 'enabled',
        ].join('|');
      }).join('; ');
    }

    function findSendButtonByAriaScan(scope, composer, composerRoot, composerForm) {
      const buttons = Array.from(scope.querySelectorAll('button'));
      for (let i = 0; i < buttons.length; i += 1) {
        const btn = buttons[i];
        if (!isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, scope)) {
          continue;
        }

        const aria = String(btn.getAttribute('aria-label') || '').trim();
        if (!aria || !SEND_ARIA_POSITIVE.test(aria)) {
          continue;
        }

        if (!isLikelyComposerSendButton(btn)) {
          continue;
        }

        return { btn, source: 'aria-scan', selector: 'aria-label~=Send|发送' };
      }

      return null;
    }

    function findSendButtonBySvgFallback(scope, composer, composerRoot, composerForm) {
      const svgList = Array.from(scope.querySelectorAll(
        '#composer-submit-button > svg, button#composer-submit-button svg',
      ));

      for (const svg of svgList) {
        const btn = svg.closest('button');
        if (!(btn instanceof HTMLButtonElement)) {
          continue;
        }

        if (!isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, scope)) {
          continue;
        }

        if (!isLikelyComposerSendButton(btn)) {
          continue;
        }

        return {
          btn,
          source: 'svg-fallback',
          selector: '#composer-submit-button > svg -> closest(button)',
        };
      }

      return null;
    }

    function logSendButtonReject(button, selector, silent) {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      const line = `[COMPOSER][SEND_BUTTON_REJECT] reason=voice_or_dictation selector=${selector || '-'} `
        + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
        + `aria=${String(button.getAttribute('aria-label') || '-')} disabled=${button.disabled ? 1 : 0}`;

      if (silent) {
        return;
      }

      appendComposerLogThrottled(
        `send-button-reject-voice:${selector || 'scan'}`,
        line,
        getComposerPollLogThrottleMs(),
      );
    }

    function logSendButtonFound(hit, silent) {
      if (!hit || !hit.btn) {
        return;
      }

      const button = resolveButtonElement(hit.btn) || hit.btn;
      const info = describeSendButton(button);
      const line = `[COMPOSER][SEND_BUTTON_READY] selector=${hit.selector || info.selector} `
        + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
        + `aria=${info.aria} disabled=${info.disabled ? '1' : '0'}`;

      lastSendButtonScanMeta = {
        total: lastSendButtonScanMeta.total,
        matched: 1,
        reason: hit.source || 'found',
        selector: hit.selector || info.selector,
        at: Date.now(),
      };

      const foundLine = `[COMPOSER][SEND_BUTTON_FOUND] selector=${hit.selector || info.selector} `
        + `aria=${info.aria} testid=${info.testid} disabled=${info.disabled ? '1' : '0'}`;

      if (silent) {
        return;
      }

      appendComposerLogThrottled(
        `send-button-ready:${hit.source || 'found'}`,
        line,
        getComposerPollLogThrottleMs(),
      );
      appendComposerLogThrottled(
        `send-button-found:${hit.source || 'found'}`,
        foundLine,
        getComposerPollLogThrottleMs(),
      );
    }

    function logSendButtonScan(total, matched, reason, silent) {
      lastSendButtonScanMeta = {
        total,
        matched,
        reason: reason || '',
        selector: matched > 0 ? lastSendButtonScanMeta.selector : '',
        at: Date.now(),
      };

      if (silent) {
        return;
      }

      appendComposerLogThrottled(
        `send-button-scan:${reason || 'scan'}`,
        `[COMPOSER][SEND_BUTTON_SCAN] total=${total} matched=${matched} reason=${reason || '-'}`,
        5000,
      );
    }

    function summarizeComposerFormButtons(composerForm, limit = 16) {
      if (!(composerForm instanceof HTMLElement)) {
        return 'form=missing';
      }

      const buttons = Array.from(composerForm.querySelectorAll('button')).slice(0, limit);

      if (!buttons.length) {
        return 'form=empty';
      }

      return buttons.map((btn) => {
        const rect = btn.getBoundingClientRect();
        return [
          `tag=${String(btn.tagName || '').toLowerCase()}`,
          `type=${String(btn.getAttribute('type') || '-')}`,
          `aria=${String(btn.getAttribute('aria-label') || '-')}`,
          `title=${String(btn.getAttribute('title') || '-')}`,
          `testid=${String(btn.getAttribute('data-testid') || '-')}`,
          `disabled=${btn.disabled ? 1 : 0}`,
          `rect=${Math.round(rect.width)}x${Math.round(rect.height)}`,
          `class=${String(btn.className || '').replace(/\s+/g, ' ').trim().slice(0, 72) || '-'}`,
        ].join(' ');
      }).join(' | ');
    }

    function logSendButtonNotFound(composer, buttonCount, preview, silent) {
      const composerTag = composer instanceof HTMLElement
        ? String(composer.tagName || '').toLowerCase()
        : 'missing';
      const composerForm = composer instanceof HTMLElement ? composer.closest('form') : null;
      const formButtons = summarizeComposerFormButtons(composerForm);

      const detailLine = `[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button composer=${composerTag} buttonCount=${buttonCount} preview=${preview || '-'} formButtons=${formButtons}`;

      if (silent) {
        return;
      }

      appendComposerLogThrottled('send-button-not-found', detailLine, getComposerPollLogThrottleMs());
      appendComposerLogThrottled(
        'send-button-missing',
        '[COMPOSER][SEND_BUTTON_MISSING] reason=no-real-submit-button',
        getComposerPollLogThrottleMs(),
      );
    }

    function buildComposerSendButtonScopes(composer, composerRoot, composerForm) {
      const scopes = [];

      if (composerForm instanceof HTMLElement) {
        scopes.push(composerForm);
      }
      if (composerRoot instanceof HTMLElement && !scopes.includes(composerRoot)) {
        scopes.push(composerRoot);
      }
      if (composer instanceof HTMLElement && !scopes.includes(composer)) {
        scopes.push(composer);
      }

      // 避免 normal 路径下 scan 整个 main 的高成本按钮集合。
      // 仅在 composer debug 模式下，才允许把 main 当作最后兜底 scope。
      const allowMainElFallback = isComposerDebugEnabled();
      const mainEl = qs('main');
      if (
        allowMainElFallback
        && mainEl instanceof HTMLElement
        && !scopes.includes(mainEl)
      ) {
        scopes.push(mainEl);
      }

      return scopes;
    }

    function findSendButtonByScopedScan(scopes, composer, composerRoot, composerForm, silent, totalScanned) {
      for (const scope of scopes) {
        const buttons = Array.from(scope.querySelectorAll('button'));

        for (const btn of buttons) {
          if (!isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, scope)) {
            continue;
          }

          if (isVoiceButton(btn)) {
            logSendButtonReject(btn, 'composer:scan', silent);
            continue;
          }

          if (!isLikelyComposerSendButton(btn)) {
            continue;
          }

          const hit = {
            btn,
            source: 'scan',
            selector: 'composer:scan',
          };
          logSendButtonScan(totalScanned, 1, hit.source, silent);
          logSendButtonFound(hit, silent);
          return btn;
        }
      }

      return null;
    }

    function findSendButtonByLastVisibleFallback(scopes, composer, composerRoot, composerForm, silent, totalScanned) {
      for (const scope of scopes) {
        const buttons = Array.from(scope.querySelectorAll('button'))
          .filter((btn) => isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, scope));

        for (let i = buttons.length - 1; i >= 0; i -= 1) {
          const btn = buttons[i];

          if (isVoiceButton(btn)) {
            logSendButtonReject(btn, 'composer:last-visible-button', silent);
            continue;
          }

          if (!isLikelyComposerSendButton(btn)) {
            continue;
          }

          const hit = {
            btn,
            source: 'last-visible',
            selector: 'composer:last-visible-button',
          };
          logSendButtonScan(totalScanned, 1, hit.source, silent);
          logSendButtonFound(hit, silent);
          return btn;
        }
      }

      return null;
    }

    function findSendButtonByFormSubmit(composer, composerRoot, composerForm, silent, totalScanned) {
      if (!(composerForm instanceof HTMLElement)) {
        return null;
      }

      const submits = Array.from(composerForm.querySelectorAll('button[type="submit"], button[type="Submit"]'));

      for (let i = 0; i < submits.length; i += 1) {
        const btn = submits[i];
        if (!isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, composerForm)) {
          continue;
        }

        if (isVoiceButton(btn) || isExcludedComposerButton(btn)) {
          continue;
        }

        if (!isRealSendButtonShape(btn) && !isLikelyComposerSendButton(btn)) {
          continue;
        }

        const hit = { btn, source: 'form-submit', selector: 'form button[type="submit"]' };
        logSendButtonScan(totalScanned, 1, hit.source, silent);
        logSendButtonFound(hit, silent);
        return btn;
      }

      return null;
    }

    function findSendButtonByBottomRightInForm(composer, composerRoot, composerForm, silent, totalScanned) {
      if (!(composerForm instanceof HTMLElement)) {
        return null;
      }

      const buttons = Array.from(composerForm.querySelectorAll('button'))
        .filter((btn) => isComposerSendButtonCandidate(btn, composer, composerRoot, composerForm, composerForm));

      let bestBtn = null;
      let bestScore = -Infinity;

      for (let i = 0; i < buttons.length; i += 1) {
        const btn = buttons[i];
        if (isVoiceButton(btn) || isExcludedComposerButton(btn)) {
          continue;
        }

        const rect = btn.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        let score = rect.bottom * 2 + rect.right;
        const type = String(btn.getAttribute('type') || '').toLowerCase();
        if (type === 'submit') {
          score += 10000;
        }
        if (isRealSendButtonShape(btn)) {
          score += 5000;
        }
        if (isLikelyComposerSendButton(btn)) {
          score += 3000;
        }

        if (score > bestScore) {
          bestScore = score;
          bestBtn = btn;
        }
      }

      if (!(bestBtn instanceof HTMLButtonElement)) {
        return null;
      }

      const hit = {
        btn: bestBtn,
        source: 'bottom-right',
        selector: 'composer-form:bottom-right-button',
      };
      logSendButtonScan(totalScanned, 1, hit.source, silent);
      logSendButtonFound(hit, silent);
      return bestBtn;
    }

    function findSendButton(options = {}) {
      const silent = options.silent === true;
      const skipNestedComposerResolve = options.skipNestedComposerResolve === true;

      if (composerDetectDepth >= MAX_COMPOSER_DETECT_DEPTH) {
        if (!silent) {
          appendComposerLogThrottled(
            'find-send-button:reenter-skip',
            `[COMPOSER][find-send-button:skip] reason=reenter depth=${composerDetectDepth}`,
          );
        }
        return null;
      }

      const composer = skipNestedComposerResolve
        ? (
          document.querySelector('#prompt-textarea')
          || document.querySelector('[data-testid="composer-textarea"]')
          || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
          || document.querySelector('div[contenteditable="true"][role="textbox"]')
        )
        : getComposer();
      if (!(composer instanceof HTMLElement)) {
        logSendButtonScan(0, 0, 'composer-not-found', silent);
        if (!silent) {
          appendComposerLogThrottled(
            'find-send-button:composer-not-found',
            '[COMPOSER][find-send-button:skip] reason=composer-not-found',
          );
        }
        return null;
      }

      const composerRoot = skipNestedComposerResolve
        ? (
          document.querySelector('[data-testid="composer"]')
          || composer.closest('form')
          || composer
        )
        : getComposerRoot();
      const composerForm = composer.closest('form');
      const scopes = buildComposerSendButtonScopes(composer, composerRoot, composerForm);

      const helperScope = (composerForm instanceof HTMLElement ? composerForm : null)
        || (composerRoot instanceof HTMLElement ? composerRoot : null)
        || composer;

      if (typeof getRealComposerSendButton === 'function') {
        const strictBtn = getRealComposerSendButton(`findSendButton:${silent ? 'silent' : 'active'}`);
        if (strictBtn instanceof HTMLButtonElement && !isInToolbox(strictBtn)) {
          const hit = { btn: strictBtn, source: 'dom-helper', selector: 'getRealComposerSendButton' };
          logSendButtonFound(hit, silent);
          return strictBtn;
        }
        if (!options.debug && !isComposerDebugEnabled()) {
          return null;
        }
      }

      if (
        typeof findRealChatGPTSendButton === 'function'
        && helperScope instanceof HTMLElement
      ) {
        const helperBtn = findRealChatGPTSendButton({ scope: helperScope });
        if (
          helperBtn instanceof HTMLButtonElement
          && !isInToolbox(helperBtn)
          && isRealSendButtonShape(helperBtn)
        ) {
          const helperHitScope = helperBtn.closest('form, main, [data-testid="composer"]') || helperScope;
          if (isComposerSendButtonCandidate(helperBtn, composer, composerRoot, composerForm, helperHitScope)) {
            const hit = { btn: helperBtn, source: 'dom-helper', selector: 'findRealChatGPTSendButton' };
            logSendButtonFound(hit, silent);
            return helperBtn;
          }
        }
      }

      const allowLegacy = options.debug === true || isComposerDebugEnabled();
      if (!allowLegacy) {
        return null;
      }

      // 兼容：如果 DOM helper 没命中，才使用 legacy 扫描逻辑（debug/诊断模式）。
      if (!silent) {
        appendComposerLogThrottled(
          'send-button-legacy-fallback-used',
          '[SEND_BUTTON][LEGACY_FALLBACK_USED] reason=dom-helper-miss',
        );
      }

      const allButtons = (!silent && allowLegacy)
        ? Array.from(document.querySelectorAll('button'))
        : [];
      const totalScanned = allButtons.length;
      const previewButtons = allButtons.filter((btn) => !isInToolbox(btn)).slice(0, 12);

      const prioritySelectors = [
        'button#composer-submit-button',
        'button[data-testid="send-button"]',
        'form button#composer-submit-button',
        'main form button#composer-submit-button',
        'main button[data-testid="send-button"]',
        'button[data-testid="composer-submit-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="\u53d1\u9001"]',
        ...(SELECTORS.sendButton || []),
      ];

      const tryPrioritySelectorHit = (candidate, scope, sel, sourceLabel) => {
        if (!(candidate instanceof HTMLButtonElement)) {
          return null;
        }

        if (!isComposerSendButtonCandidate(candidate, composer, composerRoot, composerForm, scope)) {
          return null;
        }

        if (isVoiceButton(candidate)) {
          logSendButtonReject(candidate, sel, silent);
          return null;
        }

        if (!isLikelyComposerSendButton(candidate)) {
          return null;
        }

        const hit = { btn: candidate, source: 'selector', selector: `${sourceLabel}:${sel}` };
        logSendButtonScan(totalScanned, 1, hit.selector, silent);
        logSendButtonFound(hit, silent);
        return candidate;
      };

      for (const scope of scopes) {
        for (const sel of prioritySelectors) {
          const directCandidate = scope.querySelector(sel);
          const directHit = tryPrioritySelectorHit(directCandidate, scope, sel, 'scoped-selector');
          if (directHit) {
            return directHit;
          }

          const candidates = Array.from(scope.querySelectorAll(sel));
          for (let ci = 0; ci < candidates.length; ci += 1) {
            const candidate = candidates[ci];
            const scopedHit = tryPrioritySelectorHit(candidate, scope, sel, 'scoped-selector-all');
            if (scopedHit) {
              return scopedHit;
            }
          }
        }

        const ariaHit = findSendButtonByAriaScan(scope, composer, composerRoot, composerForm);
        if (ariaHit && ariaHit.btn) {
          logSendButtonScan(totalScanned, 1, ariaHit.source, silent);
          logSendButtonFound(ariaHit, silent);
          return ariaHit.btn;
        }

        const svgHit = findSendButtonBySvgFallback(scope, composer, composerRoot, composerForm);
        if (svgHit && svgHit.btn) {
          logSendButtonScan(totalScanned, 1, svgHit.source, silent);
          logSendButtonFound(svgHit, silent);
          return svgHit.btn;
        }
      }

      const formSubmitHit = findSendButtonByFormSubmit(
        composer,
        composerRoot,
        composerForm,
        silent,
        totalScanned,
      );
      if (formSubmitHit) {
        return formSubmitHit;
      }

      const bottomRightHit = findSendButtonByBottomRightInForm(
        composer,
        composerRoot,
        composerForm,
        silent,
        totalScanned,
      );
      if (bottomRightHit) {
        return bottomRightHit;
      }

      const scopedHit = findSendButtonByScopedScan(
        scopes,
        composer,
        composerRoot,
        composerForm,
        silent,
        totalScanned,
      );
      if (scopedHit) {
        return scopedHit;
      }

      const lastVisibleHit = findSendButtonByLastVisibleFallback(
        scopes,
        composer,
        composerRoot,
        composerForm,
        silent,
        totalScanned,
      );
      if (lastVisibleHit) {
        return lastVisibleHit;
      }

      const allowDocumentSelectorFallback = options.debug === true || isComposerDebugEnabled();
      if (allowDocumentSelectorFallback) {
        for (const sel of prioritySelectors) {
          const candidate = document.querySelector(sel);
          const docHit = tryPrioritySelectorHit(
            candidate,
            candidate instanceof HTMLElement
              ? (candidate.closest('form, main, [data-testid="composer"]') || document.body)
              : document.body,
            sel,
            'document-selector-fallback',
          );
          if (docHit) {
            return docHit;
          }
        }
      }

      const preview = previewButtons.length > 0 ? buildSendButtonPreview(previewButtons) : [];
      logSendButtonScan(totalScanned, 0, 'no-match', silent);
      logSendButtonNotFound(composer, totalScanned, preview, silent);
      if (!silent) {
        ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button');
        appendComposerLogThrottled(
          'find-send-button:no-scoped-send-button',
          '[COMPOSER][find-send-button:not-found] reason=no-real-submit-button',
        );
      }

      return null;
    }


    function isSendButtonReady(btn) {
      if (!btn || !isRealSendButton(btn) || !isElementVisible(btn)) return false;
      if (btn.disabled) return false;

      const ariaDisabled = btn.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') return false;

      if (btn.getAttribute('data-disabled') === 'true') return false;

      const rect = btn.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      const style = window.getComputedStyle(btn);
      if (style.pointerEvents === 'none') return false;

      return true;
    }

    function setNativeTextareaValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');

      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
    }

    function normalizeComposerText(value) {
      return String(value || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trimEnd();
    }

    function normalizeComposerTextForCompare(value) {
      return normalizeComposerText(value).trim();
    }

    function compactComposerTextForCompare(value) {
      return normalizeComposerTextForCompare(value)
        .replace(/\s+/g, ' ')
        .trim();
    }

    function resolveComposerTextElement(el) {
      if (!(el instanceof HTMLElement)) {
        return null;
      }

      if (el.matches && el.matches('textarea,input')) {
        return el;
      }

      const proseMirror = el.querySelector('.ProseMirror[contenteditable="true"]');
      if (proseMirror instanceof HTMLElement) {
        return proseMirror;
      }

      if (el.isContentEditable) {
        return el;
      }

      const nestedEditable = el.querySelector('[contenteditable="true"]');
      if (nestedEditable instanceof HTMLElement) {
        return nestedEditable;
      }

      return el;
    }

    function dispatchComposerInputEvents(el, value, options = {}) {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      const inputType = String(options.inputType || 'insertText');
      const data = String(value || '');

      try {
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType,
          data,
        }));
      } catch (beforeInputErr) {
        console.error('[ChatGPT toolbox] dispatchComposerInputEvents beforeinput failed', beforeInputErr);
      }

      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType,
          data,
        }));
      } catch (inputErr) {
        console.error('[ChatGPT toolbox] dispatchComposerInputEvents input failed', inputErr);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));

      try {
        el.dispatchEvent(new KeyboardEvent('keyup', {
          bubbles: true,
          cancelable: true,
          key: 'a',
          code: 'KeyA',
          keyCode: 65,
          which: 65,
        }));
      } catch (keyupErr) {
        console.error('[ChatGPT toolbox] dispatchComposerInputEvents keyup failed', keyupErr);
      }
    }

    function isComposerTextSynced(expectedText) {
      const expectedRaw = String(expectedText || '').trim();
      if (!expectedRaw) {
        return true;
      }

      const actualRaw = String(getComposerText() || '').trim();
      if (!actualRaw) {
        return false;
      }

      const expected = normalizeComposerText(expectedRaw);
      const actual = normalizeComposerText(actualRaw);

      if (actual === expected) {
        return true;
      }

      const expectedCompact = compactComposerTextForCompare(expectedRaw);
      const actualCompact = compactComposerTextForCompare(actualRaw);

      if (actualCompact === expectedCompact) {
        return true;
      }

      if (expectedCompact.length < 8 || actualCompact.length < 8) {
        return actualCompact === expectedCompact;
      }

      const expectedProbe = expectedCompact.slice(0, 120);
      const actualProbe = actualCompact.slice(0, 120);

      return actualCompact.includes(expectedProbe) || expectedCompact.includes(actualProbe);
    }

    function checkComposerTextSyncDetailed(expectedText) {
      const expectedRaw = String(expectedText || '');
      const actualRaw = String(getComposerText() || '');
      const expectedNorm = normalizeComposerText(expectedRaw);
      const actualNorm = normalizeComposerText(actualRaw);
      const synced = isComposerTextSynced(expectedText);

      return {
        ok: synced,
        reason: synced ? 'composer_text_synced' : 'composer_text_not_synced',
        expectedLen: expectedNorm.length,
        actualLen: actualNorm.length,
        expectedPreview: expectedNorm.slice(0, 80),
        actualPreview: actualNorm.slice(0, 80),
      };
    }

    async function waitForComposerTextSynced(expectedText, timeoutMs = 8000, options = {}) {
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        if (shouldStop()) {
          return { ok: false, reason: 'cancelled' };
        }

        if (isComposerTextSynced(expectedText)) {
          return { ok: true, reason: 'composer_text_synced' };
        }

        await sleep(100);
      }

      return { ok: false, reason: 'composer_text_not_synced' };
    }

    function dispatchComposerSendKeyboard(method) {
      const el = getComposer();
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      el.focus();

      const base = {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
      };

      const normalized = String(method || '').toLowerCase();

      if (normalized === 'ctrl_enter' || normalized === 'ctrl+enter') {
        el.dispatchEvent(new KeyboardEvent('keydown', { ...base, ctrlKey: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { ...base, ctrlKey: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { ...base, ctrlKey: true }));
        return true;
      }

      el.dispatchEvent(new KeyboardEvent('keydown', base));
      el.dispatchEvent(new KeyboardEvent('keypress', base));
      el.dispatchEvent(new KeyboardEvent('keyup', base));
      return true;
    }

    function clearComposerValue() {
      const el = getComposer();
      if (!el) {
        return false;
      }

      el.focus();
      const target = resolveComposerTextElement(el) || el;

      if (target.matches && target.matches('textarea,input')) {
        setNativeTextareaValue(target, '');
        dispatchComposerInputEvents(target, '', { inputType: 'deleteContentBackward' });
        return true;
      }

      if (target.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);

        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (deleteErr) {
          console.error('[ChatGPT toolbox] clearComposerValue execCommand delete failed', deleteErr);
          target.textContent = '';
        }

        dispatchComposerInputEvents(target, '', { inputType: 'deleteContentBackward' });
        return true;
      }

      return false;
    }

    function setComposerValue(value) {
      const el = getComposer();
      if (!el) return false;

      el.focus();
      const target = resolveComposerTextElement(el) || el;
      const textValue = String(value || '');

      if (target.matches && target.matches('textarea,input')) {
        setNativeTextareaValue(target, textValue);
        dispatchComposerInputEvents(target, textValue);
        return true;
      }

      if (target.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();

        target.focus();

        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);

        let insertedByExecCommand = false;

        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          insertedByExecCommand = document.execCommand('insertText', false, textValue) === true;
        } catch (insertErr) {
          console.error('[ChatGPT toolbox] setComposerValue execCommand insertText failed', insertErr);
          insertedByExecCommand = false;
        }

        if (!insertedByExecCommand) {
          try {
            range.selectNodeContents(target);
            range.deleteContents();

            const textNode = document.createTextNode(textValue);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);

            selection.removeAllRanges();
            selection.addRange(range);
          } catch (rangeErr) {
            console.error('[ChatGPT toolbox] setComposerValue range fallback failed', rangeErr);
            target.textContent = textValue;
          }
        }

        dispatchComposerInputEvents(target, textValue, { inputType: 'insertText' });

        const expectedLen = textValue.length;
        const actualText = String(getComposerText() || '');
        const actualLen = actualText.length;
        const duplicated = actualLen > expectedLen * 1.5 ? 1 : 0;
        ToolboxShell.appendLog(
          `[COMPOSER][TEXT_AFTER_SET] expectedLen=${expectedLen} actualLen=${actualLen} duplicated=${duplicated}`,
        );

        return true;
      }

      return false;
    }

    function collectComposerTextCandidates() {
      return withComposerDetectGuard('collectComposerTextCandidates', [], () => {
        const seen = new Set();
        const candidates = [];

        const addCandidate = (el) => {
          if (!(el instanceof HTMLElement)) {
            return;
          }
          if (isInToolbox(el)) {
            return;
          }
          if (!isElementVisible(el)) {
            return;
          }
          if (seen.has(el)) {
            return;
          }
          seen.add(el);
          candidates.push(el);
        };

        const textRoots = [];
        const addRoot = (root) => {
          if (!(root instanceof HTMLElement)) return;
          if (isInToolbox(root)) return;
          if (textRoots.includes(root)) return;
          textRoots.push(root);
        };

        addRoot(getComposerRoot());
        addRoot(qs('[data-testid="composer"]'));
        addRoot(qs('[data-testid="composer-root"]'));

        const primary = getComposer();
        if (primary instanceof HTMLElement) {
          addCandidate(primary);
          const primaryForm = primary.closest('form');
          addRoot(primaryForm);
          addRoot(primary.parentElement);
          const resolved = resolveComposerTextElement(primary);
          if (resolved instanceof HTMLElement) {
            addCandidate(resolved);
          }
        }

        textRoots.forEach((root) => {
          SELECTORS.composerTextarea.forEach((sel) => {
            qsa(sel, root).forEach(addCandidate);
          });
        });

        SELECTORS.composerTextarea.forEach((sel) => {
          qsa(sel, document).forEach((el) => {
            if (textRoots.some((root) => root.contains(el))) {
              addCandidate(el);
            }
          });
        });

        return candidates;
      });
    }

    function readComposerTextFromElement(el) {
      if (!(el instanceof HTMLElement)) {
        return '';
      }

      const target = resolveComposerTextElement(el) || el;

      if (target.matches && target.matches('textarea,input')) {
        return normalizeComposerText(String(target.value || ''));
      }

      return normalizeComposerText(String(target.innerText || target.textContent || ''));
    }

    function logComposerTextDetect(source, text, candidates) {
      const preview = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      ToolboxShell.appendLog(
        `[COMPOSER][TEXT_DETECT] source=${source || '-'} len=${String(text || '').length} preview=${preview || '-'}`,
      );

      if (String(text || '').length > 0 || !isComposerDebugEnabled()) {
        return;
      }

      const summary = (candidates || []).slice(0, 8).map((el) => {
        const tag = String(el.tagName || '').toLowerCase();
        const testId = String(el.getAttribute('data-testid') || '-');
        const role = String(el.getAttribute('role') || '-');
        const len = readComposerTextFromElement(el).length;
        return `${tag}#${el.id || '-'} testid=${testId} role=${role} len=${len}`;
      }).join(' | ');

      ToolboxShell.appendLog(
        `[COMPOSER][TEXT_DETECT][CANDIDATES] count=${(candidates || []).length} items=${summary || '-'}`,
      );
    }

    function getComposerText(options = {}) {
      return withComposerDetectGuard('getComposerText', '', () => {
        const candidates = collectComposerTextCandidates();
        let bestText = '';
        let bestSource = 'none';

        for (let i = 0; i < candidates.length; i += 1) {
          const el = candidates[i];
          const text = readComposerTextFromElement(el);
          if (text.length > bestText.length) {
            bestText = text;
            bestSource = [
              String(el.tagName || '').toLowerCase(),
              el.id ? `#${el.id}` : '',
              el.getAttribute('data-testid') || '',
            ].filter(Boolean).join('');
          }
        }

        if (options.debug === true || isComposerDebugEnabled()) {
          logComposerTextDetect(bestSource, bestText, candidates);
        }

        return bestText;
      });
    }

    let sendButtonScanCache = {
      at: 0,
      btn: null,
      ready: false,
    };

    let composerRuntimeSnapshotCache = {
      at: 0,
      value: null,
    };

    function buildComposerRuntimeSnapshotLight() {
      const now = Date.now();
      const composerRoot = getComposerRoot();
      const composer = getComposer();
      const composerText = composer instanceof HTMLElement
        ? getComposerText()
        : '';
      const composerTextTrimmed = String(composerText || '').trim();
      const attachmentCount = countAttachmentChipsFast();
      const hasAttachmentPayload = attachmentCount > 0
        || (typeof hasComposerAttachmentUnified === 'function' && hasComposerAttachmentUnified());
      const hasComposerPayload = composerTextTrimmed.length > 0 || hasAttachmentPayload;
      const sendButton = findSendButton({ silent: true, skipNestedComposerResolve: true });
      const realSendButtonEnabled = !!(
        sendButton instanceof HTMLButtonElement
        && isRealSendButtonShape(sendButton)
        && isSendButtonReady(sendButton)
      );
      const hasComposer = composer instanceof HTMLElement;
      const composerAvailable = hasComposer
        && !(composer.getAttribute && composer.getAttribute('aria-disabled') === 'true');
      const isAssistantBusy = isAssistantLikelyBusy();

      return {
        at: now,
        root: composerRoot,
        composerRoot,
        composer,
        composerText,
        composerTextTrimmed,
        composer_text_len: composerTextTrimmed.length,
        textLen: composerTextTrimmed.length,
        hasText: composerTextTrimmed.length > 0,
        attachmentCount,
        attachment_count: attachmentCount,
        hasAttachmentPayload,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
        sendButton,
        sendButtonState: {
          found: sendButton instanceof HTMLButtonElement,
          ready: realSendButtonEnabled,
          button: sendButton instanceof HTMLButtonElement ? sendButton : null,
        },
        realSendButtonEnabled,
        hasComposer,
        composerAvailable,
        isAssistantBusy,
        is_responding: isAssistantBusy,
        can_send_now: composerAvailable
          && !isAssistantBusy
          && hasComposerPayload
          && realSendButtonEnabled,
      };
    }

    function getComposerRuntimeSnapshotLight(maxAgeMs = 500) {
      const now = Date.now();
      if (
        composerRuntimeSnapshotCache.value
        && now - composerRuntimeSnapshotCache.at < maxAgeMs
      ) {
        return composerRuntimeSnapshotCache.value;
      }

      const snapshot = buildComposerRuntimeSnapshotLight();
      composerRuntimeSnapshotCache = {
        at: now,
        value: snapshot,
      };
      return snapshot;
    }

    function canSendNow(options = {}) {
      const maxAgeMs = Number(options.maxAgeMs) || 0;
      if (!options.force && maxAgeMs > 0) {
        const snapshot = getComposerRuntimeSnapshotLight(maxAgeMs);
        return snapshot.can_send_now === true;
      }

      const composer = getComposer();
      if (!(composer instanceof HTMLElement)) {
        return false;
      }

      if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
        return false;
      }

      if (isAssistantLikelyBusy()) {
        return false;
      }

      if (!hasComposerPayloadForSend()) {
        return false;
      }

      const sendBtn = findSendButton({ silent: true });
      const ready = sendBtn instanceof HTMLButtonElement
        && isRealSendButtonShape(sendBtn)
        && isSendButtonReady(sendBtn);
      sendButtonScanCache = {
        at: Date.now(),
        btn: sendBtn,
        ready,
      };
      return ready;
    }

    function canSendNowLight() {
      const snapshot = getComposerRuntimeSnapshotLight(450);
      if (snapshot.isAssistantBusy) {
        return false;
      }
      if (!snapshot.hasComposerPayload) {
        return false;
      }
      return snapshot.realSendButtonEnabled === true;
    }

    function focusComposerForNativeSend() {
      const el = getComposer();
      if (!(el instanceof HTMLElement)) {
        ToolboxShell.appendLog('[COMPOSER][native-focus:failed] reason=composer-not-found');
        return false;
      }

      try {
        el.focus({ preventScroll: false });
      } catch (err) {
        console.error('[ChatGPT toolbox] focusComposerForNativeSend focus failed', err);
        el.focus();
      }

      if (el.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (typeof el.setSelectionRange === 'function') {
        const len = String(el.value || '').length;
        el.setSelectionRange(len, len);
      }

      ToolboxShell.appendLog('[COMPOSER][native-focus:ok]');
      return true;
    }

    function clickSend() {
      const sendBtn = findSendButton();

      if (!(sendBtn instanceof HTMLButtonElement)) {
        ToolboxShell.appendLog('[COMPOSER][click-send:blocked] reason=send-button-not-found-or-not-button');
        return false;
      }

      if (!isSendButtonReady(sendBtn)) {
        ToolboxShell.appendLog('[COMPOSER][click-send:blocked] reason=send-button-not-ready');
        return false;
      }

      const debugText = [
        `testid=${sendBtn.getAttribute('data-testid') || '-'}`,
        `id=${sendBtn.id || '-'}`,
        `aria=${sendBtn.getAttribute('aria-label') || '-'}`,
        `title=${sendBtn.getAttribute('title') || '-'}`,
        `text=${String(sendBtn.textContent || '').replace(/\s+/g, ' ').trim() || '-'}`,
      ].join(' ');

      ToolboxShell.appendLog(`[COMPOSER][click-send] ${debugText}`);

      const clickResult = invokeComposerSubmitClick(sendBtn);
      return !!clickResult;
    }

    function isAssistantLikelyBusy() {
      if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
        appendComposerPollLogThrottled(
          'busy-override-home-new-chat',
          '[COMPOSER][BUSY_OVERRIDE] reason=home_new_chat_ready_to_send',
        );
        return false;
      }

      if (typeof hasRealChatGPTStopGeneratingButton === 'function') {
        return hasRealChatGPTStopGeneratingButton();
      }

      const stopBtn = qs(SELECTORS.stopButton);
      if (stopBtn && !isInsideToolbox(stopBtn) && isElementVisible(stopBtn) && !stopBtn.disabled) {
        return true;
      }

      return false;
    }


    const COMPOSER_ATTACHMENT_FILE_EXT_RE = /\.(zip|txt|py|js|json|md|pdf|doc|docx|xlsx|csv|png|jpg|jpeg|webp|gif)\b/i;
    const COMPOSER_ATTACHMENT_FILE_SIZE_RE = /\b\d+(?:\.\d+)?\s*(KB|MB|GB)\b/i;
    const COMPOSER_ATTACHMENT_REMOVE_RE = /remove file|remove attachment|移除文件|删除文件|移除附件|删除附件/i;
    const COMPOSER_ATTACHMENT_CHIP_RE = /file-chip|file-preview|composer-file|attachment-chip|attachment-preview/i;
    const COMPOSER_UPLOAD_ENTRY_RE = /添加文件|选择文件|上传文件|附加文件|add file|browse files|attach file|upload file|composer-plus-btn|file-input|plus button/i;

    function probeComposerAttachmentEvidence(raw) {
      const text = String(raw || '').replace(/\s+/g, ' ').trim();
      const hasFileName = COMPOSER_ATTACHMENT_FILE_EXT_RE.test(text);
      const hasFileSize = COMPOSER_ATTACHMENT_FILE_SIZE_RE.test(text);
      const hasRemoveSignal = COMPOSER_ATTACHMENT_REMOVE_RE.test(text);
      const hasChipSignal = COMPOSER_ATTACHMENT_CHIP_RE.test(text);
      const hasStrongEvidence = hasFileName || hasFileSize || hasRemoveSignal || hasChipSignal;
      const isUploadEntry = COMPOSER_UPLOAD_ENTRY_RE.test(text) && !hasStrongEvidence;
      return {
        text,
        hasFileName,
        hasFileSize,
        hasRemoveSignal,
        hasChipSignal,
        hasStrongEvidence,
        isUploadEntry,
      };
    }

    function isLikelyAttachmentChipText(raw) {
      const evidence = probeComposerAttachmentEvidence(raw);
      if (evidence.isUploadEntry) {
        return false;
      }
      return evidence.hasStrongEvidence;
    }

    function findComposerRoot() {
      return getComposerRoot();
    }

    function getAttachmentEvidenceRoots() {
      return collectComposerAttachmentRoots();
    }

    function canonicalFileName(fileName) {
      const base = String(fileName || '').replace(/^.*[/\\]/, '').trim();
      if (!base) {
        return '';
      }

      const copySuffixMatch = base.match(/^(.+?)\((\d+)\)(\.[^.]+)$/i);
      if (copySuffixMatch) {
        return `${copySuffixMatch[1]}${copySuffixMatch[3]}`;
      }

      return base;
    }

    function findAttachmentCardsInComposer(options = {}) {
      const critical = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );
      const allowFallbackScan = options.allowFallbackScan === true && !critical;
      const roots = collectComposerAttachmentRoots();
      const chipSelectors = [
        '[data-testid*="attachment"]',
        '[data-testid*="file-chip"]',
        '[data-testid*="composer-file"]',
        '[data-testid*="file-preview"]',
        '[class*="attachment-chip"]',
        '[class*="file-chip"]',
      ];

      const seen = new Set();
      const cards = [];

      roots.forEach((root) => {
        chipSelectors.forEach((sel) => {
          qsa(sel, root).forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (!isComposerAttachmentChipElement(el)) return;
            if (seen.has(el)) return;
            seen.add(el);
            cards.push(el);
          });
        });
      });

      if (!cards.length && allowFallbackScan) {
        forEachLikelyAttachmentElement((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (!isComposerAttachmentChipElement(el)) return;
          if (seen.has(el)) return;
          seen.add(el);
          cards.push(el);
        });
      }

      return cards;
    }

    function collectAttachmentCardStatusText(card) {
      if (!(card instanceof HTMLElement)) {
        return '';
      }

      const nodes = [
        card,
        card.parentElement,
        card.closest('[data-testid]'),
        card.closest('[role="listitem"]'),
        card.closest('li'),
      ].filter((node) => node instanceof HTMLElement);

      const parts = [];

      const critical = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );

      nodes.forEach((node) => {
        if (isInToolbox(node)) return;
        parts.push(
          [
            critical ? '' : (node.innerText || ''),
            node.textContent || '',
            node.getAttribute('aria-label') || '',
            node.getAttribute('title') || '',
            node.getAttribute('data-testid') || '',
            node.getAttribute('aria-busy') || '',
          ].join(' ').trim(),
        );
      });

      return [...new Set(parts.filter(Boolean))].join('\n');
    }

    const ATTACHMENT_CARD_BUSY_SELECTOR = [
      '[role="progressbar"]',
      '[aria-busy="true"]',
      '[data-testid*="progress"]',
      '[data-testid*="spinner"]',
      'svg[class*="animate"]',
      '.animate-spin',
    ].join(', ');

    const ATTACHMENT_UPLOADING_TEXT_PATTERN = new RegExp(
      [
        'uploading',
        'upload\\s+in\\s+progress',
        'processing\\s+file',
        'processing\\s+attachment',
        'analyzing\\s+file',
        'analyzing\\s+attachment',
        '正在上传',
        '上传中',
        '正在处理',
        '处理中',
        '正在分析',
        '分析中',
        '扫描中',
        '加载中',
      ].join('|'),
      'i',
    );

    function isDomNodeVisiblyBusy(el) {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
        return false;
      }
      if (isInToolbox(el) || isInsideConversationHistory(el)) {
        return false;
      }

      if (el instanceof HTMLElement) {
        const style = window.getComputedStyle(el);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.opacity === '0'
        ) {
          return false;
        }
      }

      return true;
    }

    function isAttachmentCardUploading(card) {
      if (!(card instanceof HTMLElement)) {
        return false;
      }

      const busyInCard = qsa(ATTACHMENT_CARD_BUSY_SELECTOR, card).some(isDomNodeVisiblyBusy);
      if (busyInCard) {
        return true;
      }

      const cardText = collectAttachmentCardStatusText(card);
      return ATTACHMENT_UPLOADING_TEXT_PATTERN.test(cardText);
    }

    function isAttachmentReadyInComposer(options = {}) {
      const composerRoot = findComposerRoot();
      const toolboxExcluded = true;
      const cards = findAttachmentCardsInComposer();

      appendComposerPollLogThrottled(
        'upload-dom-scope:isAttachmentReadyInComposer',
        `[UPLOAD][DOM_SCOPE] composer_found=${composerRoot ? 'true' : 'false'} toolbox_excluded=${toolboxExcluded ? 'true' : 'false'} cards=${cards.length}`,
      );

      if (!cards.length) {
        return false;
      }

      const expectedNames = (options.expectedNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean);

      if (expectedNames.length > 0) {
        const haystack = cards.map((card) => collectAttachmentCardStatusText(card)).join('\n');
        const matched = expectedNames.some((name) => fileNameEvidence(name, haystack));
        if (!matched) {
          return false;
        }
      }

      if (cards.some((card) => isAttachmentCardUploading(card))) {
        return false;
      }

      if (options.requireSendReady === true) {
        return !!(
          (typeof hasRealSubmitButton === 'function' && hasRealSubmitButton())
          || (typeof canSendNowLight === 'function' && canSendNowLight())
        );
      }

      return true;
    }

    function forEachLikelyAttachmentElement(callback) {
      const roots = collectComposerAttachmentRoots();

      const seen = new Set();

      roots.forEach((root) => {
        qsa(
          [
            'button',
            '[role="button"]',
            '[data-testid]',
            '[aria-label]',
            '[title]',
            'a',
            'span',
            'div',
          ].join(','),
          root,
        ).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (isInToolbox(el)) return;
          if (seen.has(el)) return;

          const raw = [
            el.innerText || '',
            el.textContent || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
          ].join(' ').trim();

          if (!raw || !isLikelyAttachmentChipText(raw)) return;

          seen.add(el);
          callback(el, raw, seen);
        });
      });
    }

    function isInsideConversationHistory(el) {
      if (!(el instanceof HTMLElement)) return false;
      return !!el.closest(
        'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
      );
    }

    function isExcludedNonAttachmentChip(el) {
      if (!(el instanceof HTMLElement)) return true;

      const testId = String(el.getAttribute('data-testid') || '').toLowerCase();
      const role = String(el.getAttribute('role') || '').toLowerCase();

      if (role === 'tab') return true;
      if (/prompt|starter|suggestion|memory|plugin|tool-|mode-|model-selector|voice|dictation/.test(testId)) {
        return true;
      }

      const raw = [
        el.innerText || '',
        el.textContent || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        testId,
        String(el.className || ''),
      ].join(' ').replace(/\s+/g, ' ').trim();

      const evidence = probeComposerAttachmentEvidence(raw);
      if (evidence.isUploadEntry) {
        return true;
      }

      if (!evidence.hasStrongEvidence) {
        return true;
      }

      return false;
    }

    function isComposerAttachmentChipElement(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (isInToolbox(el)) return false;
      if (!isElementVisible(el)) return false;
      if (isInsideConversationHistory(el)) return false;
      if (isExcludedNonAttachmentChip(el)) return false;

      const composerRoot = getComposerRoot();
      const composerEl = qs('[data-testid="composer"]');
      const composer = getComposer();
      const composerForm = composer instanceof HTMLElement ? composer.closest('form') : null;
      const inComposerScope = (
        (composerForm instanceof HTMLElement && composerForm.contains(el))
        || (composerRoot instanceof HTMLElement && composerRoot.contains(el))
        || (composerEl instanceof HTMLElement && composerEl.contains(el))
        || (
          composer instanceof HTMLElement
          && (
            composer.contains(el)
            || isButtonNearComposer(el, composer)
          )
        )
      );

      return inComposerScope;
    }

    function collectComposerAttachmentRoots() {
      const roots = [];
      const addRoot = (root) => {
        if (!(root instanceof HTMLElement)) return;
        if (isInToolbox(root)) return;
        if (roots.includes(root)) return;
        roots.push(root);
      };

      addRoot(getComposerRoot());
      addRoot(qs('[data-testid="composer"]'));
      addRoot(qs('[data-testid="composer-root"]'));

      const composer = getComposer();
      if (composer instanceof HTMLElement) {
        const composerForm = composer.closest('form');
        addRoot(composerForm);
        addRoot(composer.parentElement);
      }

      return roots;
    }

    const ATTACHMENT_CHIP_FAST_SELECTORS = [
      '[data-testid*="attachment"]',
      '[data-testid*="file-chip"]',
      '[data-testid*="composer-file"]',
      '[data-testid*="file-preview"]',
      '[class*="attachment-chip"]',
      '[class*="file-chip"]',
    ];

    function countAttachmentChipsFast() {
      const roots = collectComposerAttachmentRoots();
      const seen = new Set();
      let count = 0;

      roots.forEach((root) => {
        ATTACHMENT_CHIP_FAST_SELECTORS.forEach((sel) => {
          qsa(sel, root).forEach((el) => {
            if (!isComposerAttachmentChipElement(el)) return;
            if (seen.has(el)) return;
            seen.add(el);
            count += 1;
          });
        });
      });

      return count;
    }

    function countAttachmentChips() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const roots = collectComposerAttachmentRoots();

      const seen = new Set();
      let scanned = 0;
      let count = 0;

      roots.forEach((root) => {
        ATTACHMENT_CHIP_FAST_SELECTORS.forEach((sel) => {
          qsa(sel, root).forEach((el) => {
            scanned += 1;
            if (!isComposerAttachmentChipElement(el)) return;
            if (seen.has(el)) return;
            seen.add(el);
            count += 1;
          });
        });

        qsa('button, [role="button"], div, li, article, section', root).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          scanned += 1;
          if (!looksLikeVisibleComposerAttachmentNode(el)) return;
          if (!isComposerAttachmentChipElement(el) && !root.contains(el)) return;
          if (seen.has(el)) return;
          seen.add(el);
          count += 1;
        });
      });

      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );

      if (typeof logPerfIfSlow === 'function') {
        logPerfIfSlow(
          'countAttachmentChips',
          `[PERF][countAttachmentChips] cost=${costMs}ms count=${count} roots=${roots.length} scanned=${scanned}`,
          costMs,
          50,
        );
      } else if (typeof logPerfThrottled === 'function') {
        logPerfThrottled(
          'countAttachmentChips',
          `[PERF][countAttachmentChips] cost=${costMs}ms count=${count} roots=${roots.length} scanned=${scanned}`,
        );
      }

      return count;
    }

    function hasComposerDraftPayload() {
      return withComposerDetectGuard('hasComposerDraftPayload', false, () => {
        if (countAttachmentChipsFast() > 0) {
          return true;
        }

        const roots = [
          getComposerRoot(),
          qs('[data-testid="composer"]'),
          qs('[data-testid="composer-root"]'),
        ].filter(Boolean);

        for (let i = 0; i < roots.length; i += 1) {
          const root = roots[i];
          const rootText = String(root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();

          if (/已粘贴|pasted|attached file|uploaded file|file attached|个文件/i.test(rootText)) {
            return true;
          }
        }

        return false;
      });
    }

    function logComposerAttachmentDetect(fileCount, uploading, ready, filenames) {
      const line = `[COMPOSER][ATTACHMENT_DETECT] fileCount=${fileCount} uploading=${uploading ? 1 : 0} ready=${ready ? 1 : 0} filenames=${filenames || '-'}`;
      appendComposerPollLogThrottled('attachment-detect', line);
    }

    function collectComposerAttachmentFilenames() {
      const cards = findAttachmentCardsInComposer();
      const names = [];

      cards.forEach((card) => {
        const text = collectAttachmentCardStatusText(card).replace(/\s+/g, ' ').trim();
        const match = text.match(/[\w.-]+\.(zip|txt|py|js|json|md|pdf|doc|docx|xlsx|csv|png|jpg|jpeg|webp|gif)\b/i);
        if (match && match[0]) {
          names.push(match[0]);
        }
      });

      return [...new Set(names)].slice(0, 8);
    }

    function shouldAllowHeavyComposerPayloadTextScan() {
      if (isComposerDebugEnabled()) {
        return true;
      }

      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        return false;
      }

      return false;
    }

    function collectVisibleComposerPayloadText(options = {}) {
      const allowHeavy = options.force === true || shouldAllowHeavyComposerPayloadTextScan();
      if (!allowHeavy) {
        return '';
      }

      const roots = collectComposerAttachmentRoots();
      const seen = new Set();
      const pieces = [];
      let falsePositiveLogged = false;

      const primaryText = String(getComposerText() || '').trim();
      if (primaryText) {
        pieces.push(primaryText.slice(0, 3000));
      }

      roots.forEach((root) => {
        if (!(root instanceof HTMLElement)) return;
        if (seen.has(root)) return;
        seen.add(root);

        if (isComposerDebugEnabled()) {
          appendComposerPollLogThrottled(
            `attachment-scope:collectVisible:${root.tagName.toLowerCase()}`,
            `[COMPOSER][ATTACHMENT_SCOPE] root=${root.tagName.toLowerCase()} from=collectVisibleComposerPayloadText`,
          );
        }

        const rootText = [
          root.innerText || '',
          root.textContent || '',
          root.getAttribute('aria-label') || '',
          root.getAttribute('title') || '',
          root.getAttribute('data-testid') || '',
          root.getAttribute('class') || '',
        ].join(' ').replace(/\s+/g, ' ').trim();

        if (rootText) {
          pieces.push(rootText.slice(0, 3000));
        }

        qsa('[data-testid], [aria-label], [title], [role], button, span, div, svg', root).forEach((el) => {
          if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return;
          if (isInToolbox(el)) return;
          if (isInsideConversationHistory(el)) {
            if (!falsePositiveLogged) {
              falsePositiveLogged = true;
              ToolboxShell.appendLog(
                '[COMPOSER][ATTACHMENT_FALSE_POSITIVE_SKIP] reason=inside-conversation-history',
              );
            }
            return;
          }
          if (seen.has(el)) return;
          seen.add(el);

          const text = [
            el instanceof HTMLElement ? (el.innerText || '') : '',
            el.textContent || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
            el.getAttribute('role') || '',
            el.getAttribute('class') || '',
          ].join(' ').replace(/\s+/g, ' ').trim();

          if (text) {
            pieces.push(text.slice(0, 1000));
          }
        });
      });

      return [...new Set(pieces)].join('\n').slice(0, 20000);
    }

    function looksLikeVisibleComposerAttachmentNode(node) {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      if (isInToolbox(node)) {
        return false;
      }
      if (!isElementVisible(node)) {
        return false;
      }

      if (isComposerAttachmentChipElement(node)) {
        return true;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(node.getAttribute('aria-label') || '').trim();
      const testId = String(node.getAttribute('data-testid') || '').trim();
      const className = String(node.getAttribute('class') || '').trim();
      const probe = `${text} ${aria} ${testId} ${className}`;
      const evidence = probeComposerAttachmentEvidence(probe);

      if (evidence.isUploadEntry) {
        const sample = text || aria || testId || className || '-';
        appendComposerPollLogThrottled(
          `attachment-fp-upload-entry:${sample.slice(0, 48)}`,
          `[COMPOSER][ATTACHMENT_FALSE_POSITIVE_SKIP] reason=upload-entry-button text=${sample.slice(0, 120)}`,
        );
        return false;
      }

      return evidence.hasStrongEvidence;
    }

    function hasComposerAttachmentUnified(options = {}) {
      const useHeavy = options.heavy === true;
      const chipCount = useHeavy ? countAttachmentChips() : countAttachmentChipsFast();
      const filenames = useHeavy ? collectComposerAttachmentFilenames() : [];
      const uploading = typeof isAttachmentStillUploading === 'function'
        ? isAttachmentStillUploading()
        : false;
      const cards = useHeavy ? findAttachmentCardsInComposer({ allowFallbackScan: true }) : [];
      // 有附件卡片且不在上传中 → ready；非 heavy 模式时 cards 为空，ready 从 chipCount 推断
      const readyFromCards = cards.length > 0 && !uploading;
      const readyFallback = !uploading && (chipCount > 0);
      const ready = readyFromCards || readyFallback;

      if (chipCount > 0) {
        logComposerAttachmentDetect(chipCount, uploading, ready, filenames.join(',') || '-');
        return true;
      }

      const composer = getComposer();
      const composerRoot = getComposerRoot();
      const composerEl = qs('[data-testid="composer"]');
      const composerForm = composer instanceof HTMLElement ? composer.closest('form') : null;

      const composerScope = (
        (composerForm instanceof HTMLElement && composerForm)
        || (composerEl instanceof HTMLElement && composerEl)
        || (composerRoot instanceof HTMLElement && composerRoot)
        || null
      );

      if (!(composerScope instanceof HTMLElement)) {
        logComposerAttachmentDetect(0, uploading, false, '-');
        return false;
      }

      if (isComposerDebugEnabled()) {
        appendComposerPollLogThrottled(
          'attachment-scope:hasComposerAttachmentUnified',
          `[COMPOSER][ATTACHMENT_SCOPE] root=${composerScope.tagName.toLowerCase()} from=hasComposerAttachmentUnified`,
        );
      }

      const selectors = [
        '[data-testid*="file-chip"]',
        '[data-testid*="file-preview"]',
        '[data-testid*="composer-file"]',
        '[data-testid*="attachment"]',
        '[aria-label*="Remove file"]',
        '[aria-label*="移除文件"]',
        '[aria-label*="删除文件"]',
        '[aria-label*="Remove attachment"]',
        'button[aria-label*="移除文件"]',
        'button[aria-label*="删除文件"]',
        '[class*="file-chip"]',
        '[class*="file-preview"]',
        '[class*="attachment-chip"]',
        '[class*="attachment-item"]',
        '[class*="attachment-preview"]',
        'img[alt*="."]',
      ];

      for (let i = 0; i < selectors.length; i += 1) {
        const selector = selectors[i];
        const nodes = Array.from(composerScope.querySelectorAll(selector));
        const visibleNodes = nodes.filter((node) => {
          if (!looksLikeVisibleComposerAttachmentNode(node)) {
            return false;
          }
          if (isComposerAttachmentChipElement(node)) {
            return true;
          }
          return composerScope.contains(node);
        });

        if (visibleNodes.length > 0) {
          const sample = String(
            visibleNodes[0].innerText || visibleNodes[0].textContent || '',
          ).replace(/\s+/g, ' ').trim().slice(0, 120);

          appendComposerPollLogThrottled(
            `attachment-found:${selector}`,
            `[COMPOSER][ATTACHMENT_FOUND] selector=${selector} count=${visibleNodes.length} sample=${sample || '-'}`,
          );
          // 已找到附件节点，非上传中即视为 ready
          const nodeReady = !uploading;
          logComposerAttachmentDetect(
            Math.max(visibleNodes.length, filenames.length),
            uploading,
            nodeReady,
            filenames.join(',') || sample || '-',
          );
          return true;
        }
      }

      const removeButtons = collectComposerAttachmentRemoveButtons()
        .filter((btn) => composerScope.contains(btn));
      if (removeButtons.length > 0) {
        // 存在"移除文件"按钮，非上传中即视为 ready
        const removeReady = !uploading;
        logComposerAttachmentDetect(removeButtons.length, uploading, removeReady, filenames.join(',') || '-');
        return true;
      }

      if (!useHeavy && !isComposerDebugEnabled()) {
        logComposerAttachmentDetect(0, uploading, false, filenames.join(',') || '-');
        return false;
      }

      const text = collectVisibleComposerPayloadText();
      const textHit = /(\.(zip|txt|py|js|json|md|csv|xlsx|docx|pdf|png|jpg|jpeg|webp|gif)\b|\b\d+(?:\.\d+)?\s*(KB|MB|GB)\b|remove file|移除文件|删除文件|uploaded|attached|已上传|上传完成)/i.test(text);
      if (textHit) {
        logComposerAttachmentDetect(
          Math.max(filenames.length, 1),
          uploading,
          ready,
          filenames.join(',') || text.slice(0, 120),
        );
      } else {
        logComposerAttachmentDetect(0, uploading, false, filenames.join(',') || '-');
      }
      return textHit;
    }

    function hasVisibleComposerAttachmentPayload() {
      return hasComposerAttachmentUnified();
    }

    function buildComposerAttachmentItemKey(index, name, text) {
      const safeName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const safeText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      return `att:${index}:${safeName || '-'}:${safeText || '-'}`;
    }

    function normalizeComposerAttachmentItemText(el) {
      if (!(el instanceof HTMLElement)) return '';
      const raw = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return raw.slice(0, 600);
    }

    function findAttachmentRemoveButtonInCard(card) {
      if (!(card instanceof HTMLElement)) return null;
      const buttons = Array.from(card.querySelectorAll('button, [role="button"]'));
      for (let i = 0; i < buttons.length; i += 1) {
        const el = buttons[i];
        if (!(el instanceof HTMLElement)) continue;
        if (isLikelyAttachmentRemoveButton(el)) return el;
      }
      return null;
    }

    function collectComposerAttachmentItemsDetailed() {
      const cards = findAttachmentCardsInComposer();
      const filenames = collectComposerAttachmentFilenames();
      const items = [];

      if (cards && cards.length) {
        cards.forEach((card, idx) => {
          const text = normalizeComposerAttachmentItemText(card);
          const name = filenames && filenames[idx] ? String(filenames[idx]) : '';
          const key = buildComposerAttachmentItemKey(idx, name, text);
          const removeButton = findAttachmentRemoveButtonInCard(card);
          items.push({
            key,
            name: name || '',
            text,
            index: idx,
            _removeButton: removeButton,
          });
        });
        return items;
      }

      // fallback: 没有 cards 时，尽量用“移除”按钮做弱快照（不保证有文件名）
      const removeButtons = collectComposerAttachmentRemoveButtons();
      removeButtons.forEach((btn, idx) => {
        const text = normalizeComposerAttachmentItemText(btn);
        const name = filenames && filenames[idx] ? String(filenames[idx]) : '';
        const key = buildComposerAttachmentItemKey(idx, name, text);
        items.push({
          key,
          name: name || '',
          text,
          index: idx,
          _removeButton: btn,
        });
      });
      return items;
    }

    function getComposerAttachmentSnapshot(reason = '') {
      const reasonText = String(reason || '').slice(0, 240);
      const cards = findAttachmentCardsInComposer();
      const uploadingFlags = cards.map((c) => isAttachmentCardUploading(c));
      const fileCount = Math.max(countAttachmentChips(), cards.length);
      const uploadingCount = uploadingFlags.filter(Boolean).length;
      const readyCount = Math.max(0, fileCount - uploadingCount);
      const filenames = collectComposerAttachmentFilenames();
      const hasAnyAttachment = fileCount > 0;
      const hasUploadingAttachment = uploadingCount > 0;
      const hasReadyAttachment = readyCount > 0;
      const itemsDetailed = collectComposerAttachmentItemsDetailed();

      // 保持旧字段兼容，同时提供 count/items 供“按 key 清理”使用
      const snapshot = {
        fileCount,
        uploadingCount,
        readyCount,
        filenames,
        hasAnyAttachment,
        hasUploadingAttachment,
        hasReadyAttachment,
        count: fileCount,
        items: itemsDetailed.map((it) => ({
          key: it.key,
          name: it.name,
          text: it.text,
          index: it.index,
          uploading: typeof it.index === 'number' && uploadingFlags[it.index] === true ? true : false,
        })),
      };

      if (reasonText) {
        let debugMode = false;
        try {
          if (
            typeof AutoQueueModule !== 'undefined'
            && AutoQueueModule
            && typeof AutoQueueModule.getConfig === 'function'
          ) {
            const cfg = AutoQueueModule.getConfig() || {};
            debugMode = !!(cfg.taskQueueSettings && cfg.taskQueueSettings.debugMode);
          }
        } catch (err) {
          console.error('[ChatGPT toolbox] getComposerAttachmentSnapshot debugMode check failed', err);
        }
        if (debugMode) {
          ToolboxShell.appendLog(
            `[COMPOSER][ATTACHMENT_SNAPSHOT] reason=${reasonText} count=${snapshot.count} names=${(snapshot.items || []).map((x) => x.name).filter(Boolean).join(',') || '-'}`,
          );
        }
      }

      return snapshot;
    }

    function getComposerAttachmentSnapshotFast(reason = '') {
      // fast：仅统计 attachment 数量与 uploading/ready 状态，避免 filenames/items detailed 扫描
      void reason;

      const fileCount = countAttachmentChipsFast();
      const stillUploading = typeof isAttachmentStillUploading === 'function'
        ? isAttachmentStillUploading()
        : false;

      let uploadingCount = 0;
      if (stillUploading) {
        if (fileCount > 0) {
          const roots = collectComposerAttachmentRoots();
          const busyNodes = roots
            .flatMap((root) => qsa(ATTACHMENT_CARD_BUSY_SELECTOR, root))
            .filter(isDomNodeVisiblyBusy);
          uploadingCount = busyNodes.length > 0
            ? Math.min(fileCount, busyNodes.length)
            : fileCount;
        } else {
          uploadingCount = 1;
        }
      }

      const readyCount = Math.max(0, fileCount - uploadingCount);

      return {
        fileCount,
        uploadingCount,
        readyCount,
        hasAnyAttachment: fileCount > 0,
        hasUploadingAttachment: uploadingCount > 0,
        hasReadyAttachment: readyCount > 0,
        count: fileCount,
      };
    }

    const composerAttachmentSnapshotCache = {
      at: 0,
      key: '',
      value: null,
    };

    function getComposerRootIdentity(root) {
      if (!(root instanceof HTMLElement)) {
        return 'none';
      }
      if (!root.dataset.cgptComposerRootIdentity) {
        root.dataset.cgptComposerRootIdentity = `composer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
      return root.dataset.cgptComposerRootIdentity;
    }

    function getUniqueComposerAttachmentSnapshot(options = {}) {
      const useHeavy = options && options.heavy === true;
      const reason = String(options && options.reason ? options.reason : '').slice(0, 160);
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const uploadCritical = !!(
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );
      const cacheKey = [
        reason || '-',
        useHeavy ? 1 : 0,
        getComposerRootIdentity(getComposerRoot()),
        uploadCritical ? 1 : 0,
      ].join('|');
      const cacheTtlMs = useHeavy ? 800 : (uploadCritical ? 500 : 300);
      const now = Date.now();
      if (
        composerAttachmentSnapshotCache.value
        && composerAttachmentSnapshotCache.key === cacheKey
        && now - composerAttachmentSnapshotCache.at < cacheTtlMs
      ) {
        return composerAttachmentSnapshotCache.value;
      }

      const base = useHeavy
        ? getComposerAttachmentSnapshot(reason || 'unique-heavy')
        : getComposerAttachmentSnapshotFast(reason || 'unique-fast');
      const count = Number(base.count != null ? base.count : base.fileCount) || 0;
      const items = Array.isArray(base.items) ? base.items : [];
      const names = Array.isArray(base.filenames)
        ? base.filenames
        : items.map((item) => item && item.name).filter(Boolean);
      const snapshot = {
        ...base,
        rawCount: count,
        uniqueCount: count,
        fileCount: count,
        count,
        names,
        filenames: names,
        items,
        cards: useHeavy ? findAttachmentCardsInComposer() : [],
      };

      composerAttachmentSnapshotCache.at = Date.now();
      composerAttachmentSnapshotCache.key = cacheKey;
      composerAttachmentSnapshotCache.value = snapshot;

      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );
      if (costMs > 80) {
        const line = `[PERF][composerAttachmentSnapshot] cost=${costMs}ms heavy=${useHeavy ? 1 : 0} raw=${snapshot.rawCount} unique=${snapshot.uniqueCount} reason=${reason || '-'}`;
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(line);
        } else {
          console.warn(line);
        }
      }

      return snapshot;
    }

    function getExistingComposerPayloadSnapshot() {
      const text = String(getComposerText() || '').trim();
      const attachmentCount = countAttachmentChips();
      const hasVisibleAttachment = hasVisibleComposerAttachmentPayload();
      const attachmentUploading = isAttachmentStillUploading();
      const nativeSendReady = canSendNow();

      return {
        text,
        textLen: text.length,
        attachmentCount,
        hasVisibleAttachment,
        attachmentUploading,
        nativeSendReady,
        hasPayload: !!text || attachmentCount > 0 || hasVisibleAttachment || attachmentUploading,
        textPreview: isComposerDebugEnabled()
          ? collectVisibleComposerPayloadText().slice(0, 500)
          : text.slice(0, 500),
      };
    }

    async function waitExistingComposerPayloadReadyForSend(timeoutMs, shouldStop, source) {
      const startedAt = Date.now();
      const timeout = Number(timeoutMs || 30000);
      let lastLogAt = 0;
      const pollMs = 250;

      while (Date.now() - startedAt < timeout) {
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          return { ok: false, reason: 'page_navigating' };
        }

        if (typeof shouldStop === 'function' && shouldStop()) {
          return { ok: false, reason: 'cancelled' };
        }

        const snapshot = getExistingComposerPayloadSnapshot();

        if (snapshot.hasPayload) {
          ToolboxShell.appendLog(
            `[SEND][PAYLOAD_WAIT_OK] source=${source || '-'} textLen=${snapshot.textLen} attachmentCount=${snapshot.attachmentCount} visibleAttachment=${snapshot.hasVisibleAttachment ? 1 : 0} uploading=${snapshot.attachmentUploading ? 1 : 0} nativeSendReady=${snapshot.nativeSendReady ? 1 : 0}`,
          );
          return { ok: true, reason: 'payload_detected', snapshot };
        }

        const elapsed = Date.now() - startedAt;
        if (elapsed - lastLogAt >= 1000) {
          ToolboxShell.appendLog(
            `[SEND][PAYLOAD_WAIT] source=${source || '-'} elapsed=${elapsed} reason=waiting_existing_composer_payload`,
          );
          lastLogAt = elapsed;
        }

        await sleep(pollMs);
      }

      const finalSnapshot = getExistingComposerPayloadSnapshot();
      ToolboxShell.appendLog(
        `[SEND][PAYLOAD_WAIT_TIMEOUT] source=${source || '-'} textLen=${finalSnapshot.textLen} attachmentCount=${finalSnapshot.attachmentCount} visibleAttachment=${finalSnapshot.hasVisibleAttachment ? 1 : 0} uploading=${finalSnapshot.attachmentUploading ? 1 : 0} preview=${finalSnapshot.textPreview || '-'}`,
      );

      return {
        ok: false,
        reason: 'composer_empty',
        snapshot: finalSnapshot,
      };
    }

    function isLikelyAttachmentRemoveButton(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (isInToolbox(el)) return false;
      if (!isElementVisible(el)) return false;

      const raw = [
        el.innerText || '',
        el.textContent || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('class') || '',
      ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

      if (!raw) return false;

      const hasRemoveIntent = /remove|delete|dismiss|clear|删除|移除|清除|关闭/.test(raw);
      const attachmentHint = /attach|附件|file|文件|upload|上传|chip|pill|token/.test(raw);
      const hasRemoveTestId = /data-testid[^a-z0-9]*(remove|delete|close|dismiss)/.test(raw);

      if (!hasRemoveIntent && !hasRemoveTestId) {
        return false;
      }

      return attachmentHint || hasRemoveTestId;
    }

    function collectComposerAttachmentRemoveButtons() {
      const roots = [
        getComposerRoot(),
        qs('[data-testid="composer"]'),
        qs('main'),
      ].filter(Boolean);

      const seen = new Set();
      const removeButtons = [];

      roots.forEach((root) => {
        qsa('button, [role="button"]', root).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (seen.has(el)) return;
          seen.add(el);
          if (!isLikelyAttachmentRemoveButton(el)) return;
          removeButtons.push(el);
        });
      });

      return removeButtons;
    }

    async function clearAttachments(reason = '') {
      const maxRounds = 6;
      let removed = 0;
      let rounds = 0;

      for (let round = 0; round < maxRounds; round += 1) {
        const removeButtons = collectComposerAttachmentRemoveButtons();
        if (!removeButtons.length) {
          break;
        }

        let clicked = 0;
        removeButtons.forEach((btn) => {
          try {
            btn.click();
            clicked += 1;
          } catch (error) {
            const errText = error && error.message ? error.message : String(error);
            console.warn('[ChatGPT toolbox] clearAttachments click failed', error);
            ToolboxShell.appendLog(
              `[COMPOSER][clear-attachments:click-failed] reason=${reason || '-'} error=${errText}`
            );
          }
        });

        removed += clicked;
        rounds += 1;

        ToolboxShell.appendLog(
          `[COMPOSER][clear-attachments:round] reason=${reason || '-'} round=${round + 1} clicked=${clicked}`
        );

        if (!clicked) {
          break;
        }

        await sleep(180);
      }

      const remaining = countAttachmentChips();

      return {
        ok: true,
        reason: reason || '',
        removed,
        rounds,
        remaining,
      };
    }

    async function clearAttachmentsByKeys(keys, reason = '') {
      const list = Array.isArray(keys) ? keys.map((k) => String(k || '').trim()).filter(Boolean) : [];
      const reasonText = String(reason || '').slice(0, 240);

      if (!list.length) {
        ToolboxShell.appendLog(
          `[COMPOSER][clear-attachments-by-keys-skip] reason=${reasonText || '-'} detail=no-keys`,
        );
        return { ok: true, reason: reasonText, clicked: 0, removed: 0 };
      }

      const detailed = collectComposerAttachmentItemsDetailed();
      const map = new Map();
      detailed.forEach((it) => {
        if (it && it.key) {
          map.set(it.key, it._removeButton || null);
        }
      });

      let clicked = 0;
      list.forEach((key) => {
        const btn = map.get(key);
        if (!(btn instanceof HTMLElement)) {
          return;
        }
        try {
          btn.click();
          clicked += 1;
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] clearAttachmentsByKeys click failed', error);
          ToolboxShell.appendLog(
            `[COMPOSER][clear-attachments-by-keys-click-failed] reason=${reasonText || '-'} key=${key} error=${errText}`,
          );
        }
      });

      ToolboxShell.appendLog(
        `[COMPOSER][clear-attachments-by-keys] reason=${reasonText || '-'} keys=${list.join(',') || '-'} clicked=${clicked}`,
      );

      return {
        ok: true,
        reason: reasonText,
        clicked,
        removed: clicked,
      };
    }

    function collectAttachmentChipText() {
      const pieces = [];

      forEachLikelyAttachmentElement((el, _raw, seen) => {
        const nodes = [
          el,
          el.parentElement,
          el.closest('li'),
          el.closest('[role="listitem"]'),
          el.closest('[data-testid]'),
          el.closest('div'),
        ];

        nodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (isInToolbox(node)) return;
          if (seen.has(node)) return;

          seen.add(node);

          pieces.push(
            [
              node.innerText || '',
              node.textContent || '',
              node.getAttribute('aria-label') || '',
              node.getAttribute('title') || '',
              node.getAttribute('data-testid') || '',
            ].join(' '),
          );
        });
      });

      return pieces.join('\n').slice(0, 20000);
    }

    function stripExt(s) {
      return String(s || '').replace(/\.[^.]+$/, '');
    }

    function normalizeUploadComparableFileName(value) {
      let text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.includes('|')) {
        text = text.split('|')[0].trim();
      }
      text = text.replace(/\\/g, '/');
      const parts = text.split('/').filter(Boolean);
      if (parts.length > 0) {
        text = parts[parts.length - 1].trim();
      }
      text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
      text = text
        .replace(/\s+压缩归档$/i, '')
        .replace(/\s+compressed archive$/i, '')
        .trim();
      return text;
    }

    function normalizeUploadComparableFileStem(value) {
      const fileName = normalizeUploadComparableFileName(value);
      if (!fileName) {
        return '';
      }
      return fileName.replace(/\.[^.]+$/u, '').trim();
    }

    function fileNameEvidence(fileName, haystack) {
      const raw = normalizeUploadComparableFileName(fileName);
      if (!raw) return false;

      const low = String(haystack || '').toLowerCase();
      const candidates = [
        raw,
        canonicalFileName(raw),
      ].filter(Boolean);

      for (let i = 0; i < candidates.length; i += 1) {
        const name = candidates[i].toLowerCase();
        if (low.includes(name)) {
          return true;
        }

        const stem = stripExt(name)
          .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
          .trim();

        if (stem.length >= 8 && low.includes(stem)) return true;
        if (stem.length >= 16 && low.includes(stem.slice(0, 16))) return true;
      }

      return false;
    }

    function buildUploadEvidenceNames(fileOrName, extraNames = []) {
      const names = [];

      const add = (value) => {
        const text = normalizeUploadComparableFileName(value);
        if (!text) return;
        if (!names.includes(text)) names.push(text);

        const canonical = canonicalFileName(text);
        if (canonical && canonical !== text && !names.includes(canonical)) {
          names.push(canonical);
        }

        const stem = stripExt(text).trim();
        if (stem && !names.includes(stem)) names.push(stem);

        const canonicalStem = stripExt(canonical || text).trim();
        if (canonicalStem && canonicalStem !== stem && !names.includes(canonicalStem)) {
          names.push(canonicalStem);
        }

        const normalizedStem = stem
          .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
          .trim();

        if (normalizedStem && !names.includes(normalizedStem)) {
          names.push(normalizedStem);
        }
      };

      if (fileOrName && typeof fileOrName === 'object') {
        add(fileOrName.originalName);
        add(fileOrName.displayName);
        add(fileOrName.canonicalName);
        add(fileOrName.name);
        add(fileOrName.uploadName);
      } else {
        add(fileOrName);
      }

      extraNames.forEach(add);

      return names;
    }

    function fileNameEvidenceAny(names, haystack) {
      const list = Array.isArray(names) ? names : [names];
      return list.some((name) => fileNameEvidence(name, haystack));
    }

    function findAttachmentEvidence(uploadName, options = {}) {
      const roots = getAttachmentEvidenceRoots();
      const text = collectAttachmentChipText();

      const names = buildUploadEvidenceNames(
        uploadName,
        options.extraNames || [],
      );

      const ok = fileNameEvidenceAny(names, text);
      const probe = probeComposerAttachmentEvidence(text);
      const originalName = typeof uploadName === 'object'
        ? String(uploadName.originalName || uploadName.name || '')
        : String(uploadName || '');
      const displayName = typeof uploadName === 'object'
        ? String(uploadName.displayName || uploadName.name || '')
        : String(uploadName || '');
      const expectedRawName = originalName || displayName || (names[0] || '');
      const expectedName = normalizeUploadComparableFileName(expectedRawName);
      const expectedStem = normalizeUploadComparableFileStem(expectedRawName);
      const actualNames = names
        .map((name) => normalizeUploadComparableFileName(name))
        .filter(Boolean);
      const actualStems = actualNames
        .map((name) => normalizeUploadComparableFileStem(name))
        .filter(Boolean);
      const canonical = canonicalFileName(expectedName || originalName || displayName);

      ToolboxShell.appendLog(
        `[UPLOAD][MATCH] original=${originalName || '-'} display=${displayName || '-'} canonical=${canonical || '-'} matched=${ok ? 1 : 0}`,
      );
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][attachment-evidence] roots=${roots.length} ok=${ok ? 1 : 0} textPreview=${text.slice(0, 200)}`
      );

      if (!ok) {
        ToolboxShell.appendLog(
          `[UPLOAD_VERIFY][FILENAME_MISMATCH] expectedRaw=${String(expectedRawName || '-')} expected=${expectedName || '-'} expectedStem=${expectedStem || '-'} actual=${actualNames.join(',') || '-'} actualStem=${actualStems.join(',') || '-'}`,
        );
      }

      let reason = ok
        ? `附件区域识别到文件名：${expectedName || expectedRawName || '-'}`
        : `未识别到附件文件名：${expectedName || expectedRawName || '-'}`;

      if (!ok && probe && probe.hasRemoveSignal && !probe.hasFileName) {
        ToolboxShell.appendLog('[UPLOAD_ATTACH][REMOVE_BUTTON_WITHOUT_NAME]');
        reason = '附件存在移除按钮但未识别到文件名';
      }

      return {
        ok,
        reason,
        textPreview: text.slice(0, 500),
        rootsCount: roots.length,
      };
    }

    function detectUploadPlatformErrorToastLight(source = '') {
      try {
        if (
          typeof UploadCriticalRuntime !== 'undefined'
          && UploadCriticalRuntime
          && typeof UploadCriticalRuntime.detectChatGptUploadErrorToast === 'function'
        ) {
          const pick = UploadCriticalRuntime.detectChatGptUploadErrorToast({ minIntervalMs: 800 });
          if (pick && pick.ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_PLATFORM_ERROR][DETECTED] domain=files.oaiusercontent.com source=${source || '-'} message=${pick.message || '-'}`,
            );
            return pick;
          }
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] detectUploadPlatformErrorToastLight failed', err);
      }
      return null;
    }

    async function waitLegacyInputSettled(uploadFile, options = {}) {
      const uploadName = uploadFile && uploadFile.name ? uploadFile.name : '';
      const timeoutMs = Number(options.timeoutMs) || 8000;
      const stableNeed = Number(options.stableNeed) || 2;
      const pollMs = Number(options.pollMs) || 250;
      const chipCountBefore = Number.isFinite(Number(options.chipCountBefore))
        ? Number(options.chipCountBefore)
        : -1;

      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const startAt = Date.now();
      let firstEvidenceAt = 0;
      let stableCount = 0;
      let lastReason = '';
      let lastTextPreview = '';

      while (Date.now() - startAt < timeoutMs) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }

        const platformErr = detectUploadPlatformErrorToastLight('waitLegacyInputSettled');
        if (platformErr && platformErr.ok) {
          return {
            ok: false,
            reason: 'files-oaiusercontent-upload-failed',
            detail: platformErr.message || '',
            level: 'platform',
          };
        }

        const evidence = findAttachmentEvidence(uploadFile, {
          extraNames: options.extraNames || [],
        });

        if (evidence && evidence.textPreview) {
          lastTextPreview = evidence.textPreview;
        }

        const nowCount = countAttachmentChips();

        if (evidence && evidence.ok) {
          if (!firstEvidenceAt) {
            firstEvidenceAt = Date.now();
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:evidence-ok] ${uploadName} reason=${evidence.reason || '-'}`
            );
          }

          stableCount += 1;
          lastReason = evidence.reason || '附件区域识别到文件名';

          if (stableCount >= stableNeed || Date.now() - firstEvidenceAt >= 800) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:settled-ok] ${uploadName} reason=${lastReason}`
            );

            return {
              ok: true,
              reason: lastReason,
              level: 'name',
            };
          }
        } else if (chipCountBefore >= 0 && nowCount > chipCountBefore) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:chip-count-increased-but-need-name] ${uploadName} count=${chipCountBefore}->${nowCount}`
          );
          stableCount = 0;
          lastReason = evidence && evidence.reason
            ? evidence.reason
            : `附件数量增加但未匹配文件名：${chipCountBefore} -> ${nowCount}`;
        } else {
          stableCount = 0;
          lastReason = evidence && evidence.reason
            ? evidence.reason
            : '未识别到附件文件名';
        }

        await sleep(pollMs);
      }

      const chipAfter = countAttachmentChips();

      if (!chipAfter) {
        ToolboxShell.appendLog('[UPLOAD_ATTACH][NO_CHIP]');
      }
      ToolboxShell.appendLog('[UPLOAD_ATTACH][NAME_MATCH_TIMEOUT]');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][file-input:settled-timeout] ${uploadName} reason=${lastReason || '-'} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
      );

      return {
        ok: false,
        reason: lastReason || '等待附件稳定超时',
        textPreview: lastTextPreview || collectAttachmentChipText().slice(0, 500),
      };
    }

    async function waitForAttachmentEvidence(files, chipCountBefore, timeoutMs, options = {}) {
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const cleanFiles = (files || []).filter(Boolean);
      const extraNames = cleanFiles.map((item) => item && item.name).filter(Boolean);
      const deadline = Date.now() + timeoutMs;
      let lastTextPreview = '';
      let lastHeavyScanAt = 0;
      let lastHeavyText = '';
      let lastHeavyCount = Number.isFinite(Number(chipCountBefore)) ? Number(chipCountBefore) : 0;

      while (Date.now() < deadline) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            level: 'cancelled',
            reason: '用户已停止上传',
          };
        }

        const platformErr = detectUploadPlatformErrorToastLight('waitForAttachmentEvidence');
        if (platformErr && platformErr.ok) {
          return {
            ok: false,
            level: 'platform',
            reason: 'files-oaiusercontent-upload-failed',
            detail: platformErr.message || '',
          };
        }

        const now = Date.now();
        let fastCount = 0;
        if (typeof countAttachmentChipsFast === 'function') {
          fastCount = Number(countAttachmentChipsFast()) || 0;
        }
        if (chipCountBefore >= 0 && fastCount > chipCountBefore) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:chip-fast-count-ok] batch count=${chipCountBefore}->${fastCount}`
          );
          return {
            ok: true,
            level: 'count-fast',
            reason: `附件数量增加：${chipCountBefore} -> ${fastCount}`,
          };
        }

        const needHeavyScan = now - lastHeavyScanAt >= 1200;
        if (needHeavyScan) {
          lastHeavyScanAt = now;
          if (typeof collectAttachmentChipText === 'function') {
            lastHeavyText = collectAttachmentChipText();
            lastTextPreview = String(lastHeavyText || '').slice(0, 500);
          }
          const allNamed = cleanFiles.length > 0 && cleanFiles.every((f) => {
            const names = buildUploadEvidenceNames(f, extraNames);
            return fileNameEvidenceAny(names, lastHeavyText);
          });
          if (allNamed) {
            return {
              ok: true,
              level: 'name',
              reason: `附件区域识别到文件名：${cleanFiles.map((f) => f.name).join('|')}`,
            };
          }
          if (typeof countAttachmentChips === 'function') {
            lastHeavyCount = Number(countAttachmentChips()) || 0;
            if (chipCountBefore >= 0 && lastHeavyCount > chipCountBefore) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][file-input:chip-heavy-count-ok] batch count=${chipCountBefore}->${lastHeavyCount}`
              );
              return {
                ok: true,
                level: 'count-heavy',
                reason: `附件数量增加：${chipCountBefore} -> ${lastHeavyCount}`,
              };
            }
          }
        }

        await sleep(350);
      }

      const chipAfter = typeof countAttachmentChipsFast === 'function'
        ? Number(countAttachmentChipsFast()) || 0
        : lastHeavyCount;

      console.debug('[ChatGPT toolbox] attachment evidence timeout', {
        expectedFiles: cleanFiles.map((f) => f.name),
        chipCountBefore,
        chipCountAfter: chipAfter,
        chipTextPreview: lastTextPreview,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][file-input:settled-timeout] batch uploadNames=${cleanFiles.map((f) => f.name).join('|')} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || '-'}`
      );

      return {
        ok: false,
        level: 'none',
        reason: '超时未检测到附件 chip',
        textPreview: lastTextPreview || '',
      };
    }

    function collectComposerAttachmentStatusText() {
      const cards = findAttachmentCardsInComposer();
      if (!cards.length) {
        return '';
      }

      return cards
        .map((card) => collectAttachmentCardStatusText(card))
        .filter(Boolean)
        .join('\n');
    }

    let attachmentUploadingCache = null;

    function isAttachmentStillUploading(options = {}) {
      const composerRoot = findComposerRoot();
      const expectedNames = (options.expectedNames || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean);
      const cacheKey = [
        composerRoot instanceof HTMLElement ? composerRoot : 'no-root',
        String(options.activeUploadRunId || ''),
        expectedNames.join('|'),
      ].join('::');
      const now = Date.now();
      if (
        attachmentUploadingCache
        && attachmentUploadingCache.key === cacheKey
        && now - Number(attachmentUploadingCache.at || 0) < 300
      ) {
        return !!attachmentUploadingCache.value;
      }

      const cards = findAttachmentCardsInComposer();

      if (isComposerDebugEnabled()) {
        appendComposerPollLogThrottled(
          'upload-dom-scope:isAttachmentStillUploading',
          `[UPLOAD][DOM_SCOPE] composer_found=${composerRoot ? 'true' : 'false'} toolbox_excluded=true cards=${cards.length} from=isAttachmentStillUploading`,
        );
      }

      if (!composerRoot && !cards.length) {
        attachmentUploadingCache = { key: cacheKey, at: now, value: false };
        return false;
      }

      if (typeof hasRealSubmitButton === 'function' && hasRealSubmitButton()) {
        attachmentUploadingCache = { key: cacheKey, at: now, value: false };
        return false;
      }

      if (cards.length > 0) {
        const scopedCards = expectedNames.length > 0
          ? cards.filter((card) => {
            const haystack = collectAttachmentCardStatusText(card);
            return expectedNames.some((name) => fileNameEvidence(name, haystack));
          })
          : cards;

        const cardsToCheck = scopedCards.length > 0 ? scopedCards : cards;
        const anyUploading = cardsToCheck.some((card) => isAttachmentCardUploading(card));
        const result = !!anyUploading;
        attachmentUploadingCache = { key: cacheKey, at: now, value: result };
        if (!anyUploading) {
          return false;
        }
        return true;
      }

      const roots = collectComposerAttachmentRoots();
      const busyNode = roots
        .flatMap((root) => qsa(ATTACHMENT_CARD_BUSY_SELECTOR, root))
        .find(isDomNodeVisiblyBusy);

      const result = !!busyNode;
      attachmentUploadingCache = { key: cacheKey, at: now, value: result };
      return result;
    }

    function isAttachmentUploadingInComposer(options = {}) {
      return isAttachmentStillUploading(options);
    }

    const NATIVE_UPLOAD_ERROR_SELECTORS = [
      // 仅扫描可能的 toast/alert/upload-error 区域
      '[role="alert"]',
      '[data-testid*="toast"]',
      '[data-testid*="upload-error"]',
      '[aria-label*="上传失败"]',
      '[aria-label*="Upload failed"]',
    ].join(', ');

    // 记录 native upload 错误 toast 的出现时间，用于避免扫描到“旧节点”误判。
    // 仅在 upload critical 时启动记录，尽量降低全局 MutationObserver 的开销。
    const nativeUploadErrorSeenAt = new WeakMap();
    let nativeUploadErrorObserver = null;

    function requestTurnStatusRefreshAfterUploadCritical(reason = '') {
      const safeReason = String(reason || '').trim() || '-';
      const runRefresh = () => {
        try {
          if (
            typeof window !== 'undefined'
            && typeof window.__cgptScheduleTurnRefresh === 'function'
          ) {
            window.__cgptScheduleTurnRefresh(`upload-critical-off:${safeReason}`, 'light');
          }
        } catch (err) {
          console.error('[ChatGPT toolbox] requestTurnStatusRefreshAfterUploadCritical failed', err);
        }
      };

      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(runRefresh, 0);
        return;
      }

      runRefresh();
    }

    function clearUploadCriticalMode(reason = '') {
      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.clearUploadCriticalMode === 'function'
      ) {
        UploadCriticalRuntime.clearUploadCriticalMode(reason);
      }
      if (nativeUploadErrorObserver) {
        nativeUploadErrorObserver.disconnect();
        nativeUploadErrorObserver = null;
      }
      requestTurnStatusRefreshAfterUploadCritical(reason);
    }

    function ensureNativeUploadErrorObserver(selectors) {
      if (!selectors) return;
      if (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      ) {
        return;
      }
      if (nativeUploadErrorObserver) return;
      if (typeof MutationObserver === 'undefined') return;

      nativeUploadErrorObserver = new MutationObserver((mutations) => {
        try {
          // 上传已结束则不再记录；保持 observer 但避免写入 WeakMap（降低负担）
          if (
            typeof UploadCriticalRuntime === 'undefined'
            || !UploadCriticalRuntime
            || typeof UploadCriticalRuntime.isUploadCriticalMode !== 'function'
            || UploadCriticalRuntime.isUploadCriticalMode() !== true
          ) {
            return;
          }

          mutations.forEach((m) => {
            const added = m && m.addedNodes ? m.addedNodes : [];
            added.forEach((node) => {
              if (!(node instanceof HTMLElement)) return;

              const now = Date.now();
              if (typeof node.matches === 'function' && node.matches(selectors)) {
                nativeUploadErrorSeenAt.set(node, now);
              }

              if (typeof node.querySelectorAll === 'function') {
                const els = node.querySelectorAll(selectors);
                els.forEach((el) => {
                  if (!(el instanceof HTMLElement)) return;
                  nativeUploadErrorSeenAt.set(el, now);
                });
              }
            });
          });
        } catch (_e) {
          console.error('[ChatGPT toolbox] nativeUploadErrorObserver callback failed', _e);
        }
      });

      nativeUploadErrorObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
      });
    }

    const NATIVE_UPLOAD_ERROR_PATTERNS = [
      // 强匹配：只认文件服务器域名或明确的英文/失败描述
      /files\.oaiusercontent\.com/i,
      /上传到\s*files\.oaiusercontent\.com\s*失败/i,
      /upload\s+failed/i,
      /couldn'?t\s+upload/i,
      /failed\s+to\s+upload/i,
    ];

    function isNativeSendReadyForUpload() {
      if (typeof ComposerCapability !== 'undefined'
        && ComposerCapability
        && typeof ComposerCapability.isNativeSendReadyForUpload === 'function') {
        return !!ComposerCapability.isNativeSendReadyForUpload({ source: 'main-wrapper/native-send-ready' });
      }
      return false;
    }

    function detectChatGPTNativeUploadError() {
      if (
        typeof ComposerAttachments !== 'undefined'
        && ComposerAttachments
        && typeof ComposerAttachments.detectNativeUploadError === 'function'
      ) {
        const pick = ComposerAttachments.detectNativeUploadError();
        if (pick && pick.hasError) {
          return {
            ok: false,
            reason: 'native-upload-failed',
            message: String(pick.errorText || '').slice(0, 500),
          };
        }
      }

      try {
        if (typeof UploadCriticalRuntime !== 'undefined'
          && UploadCriticalRuntime
          && typeof UploadCriticalRuntime.detectChatGptUploadErrorToast === 'function') {
          const toastPick = UploadCriticalRuntime.detectChatGptUploadErrorToast({ minIntervalMs: 800 });
          if (toastPick && toastPick.ok) {
            return {
              ok: false,
              reason: 'native-upload-failed',
              message: String(toastPick.message || '').slice(0, 500),
            };
          }
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] detectChatGPTNativeUploadError failed', error);
        ToolboxShell.appendLog(`[UPLOAD_NATIVE][DETECT_ERROR] error=${errText}`);
      }
      return null;
    }

    function getComposerUploadSnapshot(snapshotOptions = {}) {
      const startedAt = typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
      const snapExpectedNames = Array.isArray(snapshotOptions.expectedNames)
        ? snapshotOptions.expectedNames.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
      const snapRequireSendReady = snapshotOptions.requireSendReady === true;
      let composerRoot = null;
      let cards = [];
      let hasCards = false;
      let hasChip = false;
      let stillUploading = false;
      let attachmentReady = false;
      let sendReady = false;
      let filenames = [];
      const critical = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );
      try {
        composerRoot = typeof findComposerRoot === 'function'
          ? findComposerRoot()
          : null;
        cards = typeof findAttachmentCardsInComposer === 'function'
          ? findAttachmentCardsInComposer({ allowFallbackScan: !critical })
          : [];
        hasCards = Array.isArray(cards) && cards.length > 0;
        if (hasCards) {
          const cardStatusText = (card) => {
            if (critical) {
              return [
                card.textContent || '',
                card.getAttribute('aria-label') || '',
                card.getAttribute('title') || '',
                card.getAttribute('data-testid') || '',
              ].join(' ').replace(/\s+/g, ' ').trim();
            }
            return collectAttachmentCardStatusText(card);
          };
          const matchedCards = snapExpectedNames.length > 0
            ? cards.filter((card) => {
              const text = cardStatusText(card);
              return snapExpectedNames.some((name) => fileNameEvidence(name, text));
            })
            : cards;
          const cardsToCheck = matchedCards.length > 0 ? matchedCards : cards;
          stillUploading = cardsToCheck.some((card) => isAttachmentCardUploading(card));
          attachmentReady = !stillUploading;
          filenames = cardsToCheck
            .map((card) => {
              const text = cardStatusText(card).replace(/\s+/g, ' ').trim();
              const match = text.match(/[\w.-]+\.(zip|txt|py|js|json|md|pdf|doc|docx|xlsx|csv|png|jpg|jpeg|webp|gif)\b/i);
              return match && match[0] ? match[0] : '';
            })
            .filter(Boolean);
        } else if (typeof countAttachmentChipsFast === 'function') {
          hasChip = countAttachmentChipsFast() > 0;
          attachmentReady = hasChip;
          stillUploading = false;
        }
        if (!hasChip) {
          hasChip = hasCards || attachmentReady;
        }
        if (snapRequireSendReady) {
          sendReady = typeof isNativeSendReadyForUpload === 'function'
            ? isNativeSendReadyForUpload()
            : false;
        } else {
          sendReady = true;
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] getComposerUploadSnapshot failed', error);
        ToolboxShell.appendLog(`[UPLOAD_NATIVE][SNAPSHOT_FAILED] error=${errText}`);
      }
      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );
      if (typeof logPerfThrottled === 'function') {
        logPerfThrottled(
          'getComposerUploadSnapshot',
          `[PERF][getComposerUploadSnapshot] cost=${costMs}ms cards=${cards.length} hasChip=${hasChip ? 1 : 0} uploading=${stillUploading ? 1 : 0} ready=${attachmentReady ? 1 : 0}`,
        );
      }
      return {
        composerRoot,
        cards,
        hasCards,
        hasChip,
        hasAttachmentChip: hasChip,
        stillUploading,
        attachmentReady,
        sendReady,
        filenames,
      };
    }

    async function waitChatGPTNativeUploadSettled(files, options = {}) {
      const startedAt = Date.now();
      try {
        const runtime = (
          typeof window !== 'undefined'
          && window.UploadNativeRuntime
        ) ? window.UploadNativeRuntime : (
          typeof UploadNativeRuntime !== 'undefined' ? UploadNativeRuntime : null
        );
        if (runtime && typeof runtime.waitChatGPTNativeUploadSettled === 'function') {
          const result = await runtime.waitChatGPTNativeUploadSettled(files, {
            ...(options || {}),
            reason: (options && options.reason) || 'core-main:waitChatGPTNativeUploadSettled',
            detectNativeUploadError: detectChatGPTNativeUploadError,
          });
          console.log('[CORE_MAIN][DELEGATE_UPLOAD_SETTLED]', {
            result,
            delegate: 'UploadNativeRuntime.waitChatGPTNativeUploadSettled',
            costMs: Date.now() - startedAt,
          });
          return result;
        }
        console.error('[CORE_MAIN][UPLOAD_NATIVE_RUNTIME_MISSING]', {
          options: options || {},
          costMs: Date.now() - startedAt,
        });
        return {
          ok: false,
          reason: 'upload_native_runtime_missing',
          costMs: Date.now() - startedAt,
        };
      } catch (e) {
        console.error('[CORE_MAIN][WAIT_UPLOAD_SETTLED_FAILED]', {
          options: options || {},
          error: e && e.stack ? e.stack : String(e),
          costMs: Date.now() - startedAt,
        });
        return {
          ok: false,
          reason: 'wait_upload_settled_exception',
          error: String(e && e.message ? e.message : e),
          costMs: Date.now() - startedAt,
        };
      }
    }

    async function __REMOVE_waitChatGPTNativeUploadSettled_fallback(files, options = {}) {
      const timeoutMs = Math.max(60000, Number(options.timeoutMs) || 120000);
      const pollMs = Number(options.pollMs) || 500;
      const stableMs = Math.max(1200, Math.min(1500, Number(options.stableMs) || 1300));
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const requireSendReady = options.requireSendReady === undefined
        ? true
        : options.requireSendReady === true;

      const runId = options.runId ? String(options.runId) : '';

      const cleanFiles = (files || []).filter(Boolean);
      const fileNames = cleanFiles.map((f) => f && f.name).filter(Boolean).join('|');
      const expectedNames = buildUploadEvidenceNames(
        null,
        cleanFiles.map((f) => f && f.name).filter(Boolean),
      );

      const deadline = Date.now() + timeoutMs;
      const waitStartedAt = Date.now();

      const stageOrder = [
        'waitFileInputAccepted',
        'waitAttachmentCardCreated',
        'waitUploadingStarted',
        'waitUploadingSettled',
        'waitReadyAttachment',
      ];
      const stageTimeoutMs = {
        waitFileInputAccepted: Math.max(2000, Math.floor(timeoutMs * 0.15)),
        waitAttachmentCardCreated: Math.max(3000, Math.floor(timeoutMs * 0.2)),
        waitUploadingStarted: Math.max(5000, Math.floor(timeoutMs * 0.25)),
        waitUploadingSettled: Math.max(8000, Math.floor(timeoutMs * 0.2)),
        waitReadyAttachment: Math.max(5000, Math.floor(timeoutMs * 0.2)),
      };

      let stageIndex = 0;
      let stage = stageOrder[stageIndex];
      let stageStartedAt = Date.now();
      let lastStageLogAt = 0;

      function stageTimeoutReached() {
        const timeoutForStage = stageTimeoutMs[stage] || timeoutMs;
        return (Date.now() - stageStartedAt) >= timeoutForStage;
      }

      function advanceStage(nextStage) {
        stage = nextStage;
        stageIndex += 1;
        stageStartedAt = Date.now();
        lastStageLogAt = 0;
        ToolboxShell.appendLog(
          `[UPLOAD_NATIVE][STAGE] runId=${runId || '-'} stage=${stage} elapsed=0 timeout=${stageTimeoutMs[stage] || timeoutMs}`,
        );
      }

      ToolboxShell.appendLog(
        `[UPLOAD_NATIVE][STAGE] runId=${runId || '-'} stage=${stage} elapsed=0 timeout=${stageTimeoutMs[stage] || timeoutMs}`,
      );

      let lastNativeErrorScanAt = 0;
      const nativeErrorScanIntervalMs = 1200;

      function getAdaptiveUploadPollMs() {
        const elapsed = Date.now() - waitStartedAt;
        if (elapsed < 2500) {
          return Math.max(180, Math.min(300, Number(options.pollMs) || 220));
        }
        if (stage === 'waitUploadingStarted' || stage === 'waitReadyAttachment') {
          return 500;
        }
        return 800;
      }

      while (Date.now() < deadline) {
        if (isCancelled()) {
          return { ok: false, cancelled: true, reason: 'cancelled' };
        }

        let nativeErr = null;
        const nowForNativeError = Date.now();
        if (nowForNativeError - lastNativeErrorScanAt >= nativeErrorScanIntervalMs) {
          lastNativeErrorScanAt = nowForNativeError;
          nativeErr = detectChatGPTNativeUploadError();
        }
        if (nativeErr) {
          ToolboxShell.appendLog(
            `[UPLOAD_NATIVE][FAILED] names=${fileNames || '-'} message=${nativeErr.message || '-'}`,
          );
          return nativeErr;
        }

        const snap = getComposerUploadSnapshot({
          expectedNames,
          requireSendReady,
        });
        const stillUploading = snap.stillUploading;
        const sendReady = snap.sendReady;
        const attachmentReady = snap.attachmentReady;
        const hasAttachmentChip = requireSendReady ? true : snap.hasAttachmentChip;
        const hasCards = snap.hasCards;

        const elapsed = Date.now() - waitStartedAt;
        if (elapsed - lastStageLogAt >= 2500) {
          lastStageLogAt = elapsed;
          ToolboxShell.appendLog(
            `[UPLOAD_NATIVE][STAGE] runId=${runId || '-'} stage=${stage} elapsed=${elapsed} timeout=${stageTimeoutMs[stage] || timeoutMs}`,
          );
        }

        if (stageTimeoutReached()) {
          ToolboxShell.appendLog(
            `[UPLOAD_NATIVE][STAGE_TIMEOUT] runId=${runId || '-'} stage=${stage} elapsed=${Date.now() - waitStartedAt}`,
          );
          return {
            ok: false,
            reason: 'native-upload-settle-timeout',
            stage,
          };
        }

        if (stage === 'waitFileInputAccepted') {
          if (hasCards || hasAttachmentChip) {
            advanceStage(stageOrder[stageIndex + 1] || stage);
          }
        } else if (stage === 'waitAttachmentCardCreated') {
          if (hasCards) {
            advanceStage(stageOrder[stageIndex + 1] || stage);
          } else if (attachmentReady || hasAttachmentChip) {
            ToolboxShell.appendLog(
              `[UPLOAD_NATIVE][STAGE_SKIP_CARD_CREATED] runId=${runId || '-'} reason=chip-ready-without-card file=${fileNames || '-'} attachmentReady=${attachmentReady ? 1 : 0} hasChip=${hasAttachmentChip ? 1 : 0}`,
            );
            advanceStage('waitReadyAttachment');
          }
        } else if (stage === 'waitUploadingStarted') {
          if (stillUploading) {
            advanceStage(stageOrder[stageIndex + 1] || stage);
          } else if (attachmentReady || hasAttachmentChip) {
            ToolboxShell.appendLog(
              `[UPLOAD_NATIVE][STAGE_SKIP_UPLOAD_START] runId=${runId || '-'} reason=already-ready file=${fileNames || '-'} attachmentReady=${attachmentReady ? 1 : 0} hasChip=${hasAttachmentChip ? 1 : 0}`,
            );
            advanceStage('waitReadyAttachment');
          }
        } else if (stage === 'waitUploadingSettled') {
          if (!stillUploading && hasAttachmentChip && (requireSendReady ? sendReady : true)) {
            await sleep(stableMs);

            if (isCancelled()) {
              return { ok: false, cancelled: true, reason: 'cancelled' };
            }

            lastNativeErrorScanAt = 0;
            const nativeErrAfterStable = detectChatGPTNativeUploadError();
            if (nativeErrAfterStable) {
              ToolboxShell.appendLog(
                `[UPLOAD_NATIVE][FAILED] names=${fileNames || '-'} message=${nativeErrAfterStable.message || '-'} phase=post-stable`,
              );
              return nativeErrAfterStable;
            }

            const snapAfterStable = getComposerUploadSnapshot({
              expectedNames,
              requireSendReady,
            });
            const stillUploadingAfterStable = snapAfterStable.stillUploading;
            const sendReadyAfterStable = snapAfterStable.sendReady;
            const hasAttachmentChipAfterStable = requireSendReady
              ? true
              : snapAfterStable.hasAttachmentChip;

            // stage4 通过后，进入 stage5 做最终“ready”确认
            if (!stillUploadingAfterStable && hasAttachmentChipAfterStable && (requireSendReady ? sendReadyAfterStable : true)) {
              advanceStage('waitReadyAttachment');
            }
          }
        } else if (stage === 'waitReadyAttachment') {
          // 注意：requireSendReady=false 时，只要求 composer attachment 已 ready（或 chip 已出现）
          const readyOk = requireSendReady
            ? (attachmentReady && sendReady)
            : (attachmentReady || hasAttachmentChip);
          if (readyOk) {
            ToolboxShell.appendLog(
              requireSendReady
                ? `[UPLOAD_NATIVE][SETTLED] names=${fileNames || '-'} elapsed=${Date.now() - waitStartedAt}`
                : `[UPLOAD][ATTACHED_ONLY][NATIVE_STABLE_OFF] names=${fileNames || '-'} requireSendReady=0 elapsed=${Date.now() - waitStartedAt}`,
            );
            return {
              ok: true,
              reason: requireSendReady
                ? 'native-upload-settled'
                : 'native-upload-settled-without-send-ready',
            };
          }
        }

        await sleep(getAdaptiveUploadPollMs());
      }

      const elapsedFinal = Date.now() - waitStartedAt;
      const timeoutSnap = getComposerUploadSnapshot({
        expectedNames,
        requireSendReady: false,
      });
      const attachmentReadyAtTimeout = timeoutSnap.attachmentReady;

      if (attachmentReadyAtTimeout) {
        ToolboxShell.appendLog(
          `[UPLOAD_NATIVE][SETTLED] names=${fileNames || '-'} elapsed=${elapsedFinal} reason=attachment-ready-at-timeout`,
        );
        return {
          ok: true,
          reason: requireSendReady
            ? 'native-upload-settled-late'
            : 'native-upload-settled-without-send-ready',
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD][TIMEOUT] file=${fileNames || '-'} elapsed=${elapsedFinal} timeoutMs=${timeoutMs}`,
      );
      return {
        ok: false,
        reason: 'native-upload-settle-timeout',
      };
    }

    async function finalizeAttachAfterComposerEvidence(cleanFiles, options = {}) {
      const uploadOnly = options.uploadOnly === true;
      const requireSendReady = options.requireSendReady === undefined
        ? !uploadOnly
        : options.requireSendReady === true;

      const nativeSettle = await waitChatGPTNativeUploadSettled(cleanFiles, {
        timeoutMs: options.nativeSettleTimeoutMs || options.timeoutMs || 90000,
        signal: options.signal,
        isCancelled: options.isCancelled,
        stableMs: options.stableMs,
        pollMs: options.pollMs,
        requireSendReady,
        runId: options.runId,
      });

      if (nativeSettle && nativeSettle.cancelled) {
        return {
          ok: false,
          cancelled: true,
          reason: '用户已停止上传',
        };
      }

      if (nativeSettle && nativeSettle.ok) {
        if (requireSendReady) {
          return {
            ok: true,
            method: 'file-input',
            level: 'native-settled',
            reason: nativeSettle.reason || 'native-upload-settled',
          };
        }

        ToolboxShell.appendLog(
          `[UPLOAD][ATTACHED_ONLY] reason=${options.evidenceReason || 'chip-evidence-ok'} requireSendReady=0`,
        );
        return {
          ok: true,
          method: 'file-input',
          level: 'composer-attached',
          reason: 'attached-to-composer-without-send-ready',
        };
      }

      if (nativeSettle && nativeSettle.reason === 'native-upload-failed') {
        ToolboxShell.appendLog(
          `[UPLOAD_NATIVE][FAILED_CONFIRMED] names=${cleanFiles.map((f) => f.name).join('|') || '-'} message=${nativeSettle.message || ''}`,
        );
        return {
          ok: false,
          method: 'file-input',
          reason: 'native-upload-failed',
          detail: nativeSettle.message || '',
        };
      }

      const lateNativeErr = detectChatGPTNativeUploadError();
      if (lateNativeErr) {
        ToolboxShell.appendLog(
          `[UPLOAD_NATIVE][FAILED_CONFIRMED] names=${cleanFiles.map((f) => f.name).join('|') || '-'} message=${lateNativeErr.message || '-'} phase=finalize`,
        );
        return {
          ok: false,
          method: 'file-input',
          reason: 'native-upload-failed',
          detail: lateNativeErr.message || '',
        };
      }

      // nativeSettle 超时：在“只绑定到输入框/等待附件但不强依赖 sendReady”场景中，把它降级为“已绑定”。
      const chipText = typeof collectAttachmentChipText === 'function'
        ? collectAttachmentChipText()
        : '';
      const hasAttachmentChipEvidence = (
        typeof countAttachmentChips === 'function'
        && countAttachmentChips() > 0
      ) || (
        Array.isArray(cleanFiles)
        && cleanFiles.length > 0
        && cleanFiles.every((f) => fileNameEvidenceAny(
          buildUploadEvidenceNames(f, []),
          chipText,
        ))
      );

      if (
        nativeSettle
        && nativeSettle.reason === 'native-upload-settle-timeout'
        && hasAttachmentChipEvidence
      ) {
        if (requireSendReady) {
          ToolboxShell.appendLog(
            `[UPLOAD][SEND_READY_TIMEOUT_BUT_ATTACHED] reason=${options.evidenceReason || 'chip-evidence-ok'} requireSendReady=1`,
          );
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD][ATTACHED_ONLY] reason=${options.evidenceReason || 'chip-evidence-ok'} requireSendReady=0`,
          );
        }

        return {
          ok: true,
          method: 'file-input',
          level: 'composer-attached',
          reason: 'attached-to-composer-without-send-ready',
        };
      }

      return {
        ok: false,
        method: 'file-input',
        reason: nativeSettle && nativeSettle.reason
          ? nativeSettle.reason
          : 'native-upload-settle-timeout',
        detail: nativeSettle && nativeSettle.message ? nativeSettle.message : '',
      };
    }

    function describeFileInputCandidate(input) {
      const composerRoot = getComposerRoot();
      const inComposer = composerRoot instanceof HTMLElement && composerRoot.contains(input);
      const accept = input.getAttribute('accept') || '';
      const multiple = !!input.multiple;
      const visible = isElementVisible(input);
      let display = '-';

      if (input instanceof HTMLElement) {
        display = window.getComputedStyle(input).display || '-';
      }

      const outerHtml = input.outerHTML ? input.outerHTML.slice(0, 200) : '';

      return {
        accept,
        multiple,
        inComposer,
        visible,
        display,
        outerHtml,
      };
    }

    function scoreFileInputCandidate(input, source, options = {}) {
      const requireMultiple = options.requireMultiple === true;
      const composerRoot = getComposerRoot();
      const inComposer = composerRoot instanceof HTMLElement && composerRoot.contains(input);
      const visible = isElementVisible(input);
      let score = 0;

      if (inComposer) {
        score += 100;
      }
      if (visible) {
        score += 50;
      }
      if (source === 'composer-root') {
        score += 40;
      } else if (source === 'main') {
        score += 20;
      }

      const composerForm = composerRoot instanceof HTMLElement
        ? composerRoot.closest('form')
        : null;
      const inputForm = input.closest('form');
      if (
        composerForm instanceof HTMLElement
        && inputForm instanceof HTMLElement
        && composerForm === inputForm
      ) {
        score += 30;
      }

      if (requireMultiple) {
        if (input.multiple === true) {
          score += 250;
        } else {
          score -= 1000;
        }
      } else if (input.multiple === true) {
        score += 15;
      }

      return score;
    }

    function findFileInputsLegacy(options = {}) {
      const requireMultiple = options.requireMultiple === true;
      const composerRoot = getComposerRoot();
      const ranked = [];

      const addCandidate = (input, source) => {
        if (!(input instanceof HTMLInputElement)) {
          return;
        }
        if (input.type !== 'file') {
          return;
        }
        if (isInToolbox(input)) {
          return;
        }
        if (input.disabled) {
          return;
        }
        if (isInsideConversationHistory(input)) {
          return;
        }

        const inComposer = composerRoot instanceof HTMLElement && composerRoot.contains(input);
        const visible = isElementVisible(input);

        if (!inComposer && !visible) {
          const style = window.getComputedStyle(input);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return;
          }
        }

        if (ranked.some((row) => row.input === input)) {
          return;
        }

        const desc = describeFileInputCandidate(input);
        const score = scoreFileInputCandidate(input, source, { requireMultiple });

        ToolboxShell.appendLog(
          `[UPLOAD_INPUT][CANDIDATE] source=${source} score=${score} accept=${desc.accept} multiple=${desc.multiple ? 1 : 0} inComposer=${desc.inComposer ? 1 : 0} visible=${desc.visible ? 1 : 0} display=${desc.display} html=${desc.outerHtml}`,
        );

        ranked.push({
          input,
          score,
          desc,
          source,
        });
      };

      if (composerRoot) {
        qsa('input[type="file"]', composerRoot).forEach((input) => {
          addCandidate(input, 'composer-root');
        });
      }

      const mainEl = document.querySelector('main');
      if (mainEl instanceof HTMLElement) {
        qsa('input[type="file"]', mainEl).forEach((input) => {
          addCandidate(input, 'main');
        });
      }

      qsa('input[type="file"]').forEach((input) => {
        addCandidate(input, 'global');
      });

      ranked.sort((a, b) => b.score - a.score);

      let selectedRanked = ranked;
      if (requireMultiple) {
        const multipleOnly = ranked.filter((row) => row.desc && row.desc.multiple);
        if (multipleOnly.length) {
          selectedRanked = multipleOnly;
        }
      }

      if (selectedRanked[0]) {
        const selected = selectedRanked[0];
        ToolboxShell.appendLog(
          `[UPLOAD_INPUT][SELECTED] source=${selected.source} score=${selected.score} accept=${selected.desc.accept} multiple=${selected.desc.multiple ? 1 : 0} inComposer=${selected.desc.inComposer ? 1 : 0} visible=${selected.desc.visible ? 1 : 0} display=${selected.desc.display} html=${selected.desc.outerHtml}`,
        );
      }

      return selectedRanked.map((row) => row.input);
    }

    function dispatchFilesToInputLegacy(input, files, options = {}) {
      const allowMultiOnSingle = options.allowMultiOnSingle === true;
      const cleanBatch = (files || []).filter(Boolean);
      if (cleanBatch.length > 1 && input.multiple !== true && !allowMultiOnSingle) {
        const err = new Error('input-not-multiple-for-multi-files');
        err.code = 'input-not-multiple-for-multi-files';
        ToolboxShell.appendLog(
          `[UPLOAD_INPUT][DISPATCH_BLOCKED] reason=input-not-multiple-for-multi-files files=${cleanBatch.length} multiple=${input.multiple ? 1 : 0}`,
        );
        throw err;
      }

      const dt = new DataTransfer();

      files.forEach((file, index) => {
        const normalized = normalizeToNativeFile(
          file,
          file && file.name ? file.name : `upload_${index + 1}.bin`
        );

        if (!normalized) {
          console.warn('[ChatGPT toolbox] dispatchFilesToInputLegacy skipped invalid file', {
            index,
            file,
            tag: file ? Object.prototype.toString.call(file) : '',
            name: file && file.name,
            size: file && file.size,
          });
          return;
        }

        dt.items.add(normalized);
      });

      input.value = '';

      const filesDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');

      if (filesDesc && typeof filesDesc.set === 'function') {
        filesDesc.set.call(input, dt.files);
      } else {
        input.files = dt.files;
      }

      input.dispatchEvent(new Event('input', {
        bubbles: true,
        composed: true,
      }));

      input.dispatchEvent(new Event('change', {
        bubbles: true,
        composed: true,
      }));

      window.setTimeout(() => {
        input.value = '';
      }, 0);
    }

    async function attachFilesSequentiallyToInput(input, files, timeoutMs, options = {}) {
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);
      const cleanFiles = (files || []).filter(Boolean);
      const uploadedNames = [];
      const failedNames = [];
      let success = 0;
      let failed = 0;

      ToolboxShell.appendLog(
        `[UPLOAD_MULTI][SEQUENTIAL_FALLBACK_START] fileCount=${cleanFiles.length} reason=input-multiple-false`,
      );

      for (let index = 0; index < cleanFiles.length; index += 1) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
            attachedCount: success,
            uploadedNames,
            failedNames,
          };
        }

        const file = cleanFiles[index];
        const chipCountBefore = typeof countAttachmentChipsFast === 'function'
          ? countAttachmentChipsFast()
          : countAttachmentChips();
        const fileName = file && file.name ? file.name : `file_${index + 1}`;

        ToolboxShell.appendLog(
          `[UPLOAD_MULTI][SEQUENTIAL_ATTACH_ONE] index=${index} total=${cleanFiles.length} name=${fileName} beforeCount=${chipCountBefore}`,
        );

        try {
          dispatchFilesToInputLegacy(input, [file], { allowMultiOnSingle: true });
        } catch (dispatchErr) {
          const errText = dispatchErr && dispatchErr.message ? dispatchErr.message : String(dispatchErr);
          console.error('[ChatGPT toolbox] sequential attach dispatch failed', dispatchErr);
          ToolboxShell.appendLog(
            `[UPLOAD_MULTI][SEQUENTIAL_ATTACH_ONE_DONE] index=${index} name=${fileName} afterCount=${chipCountBefore} ok=0 error=${errText}`,
          );
          failed += 1;
          failedNames.push(fileName);
          continue;
        }

        const perFileTimeout = Math.max(
          8000,
          Math.floor(Number(timeoutMs) / Math.max(1, cleanFiles.length)),
        );
        const evidence = await waitForAttachmentEvidence([file], chipCountBefore, perFileTimeout, {
          signal,
          isCancelled,
        });
        const chipCountAfter = typeof countAttachmentChipsFast === 'function'
          ? countAttachmentChipsFast()
          : countAttachmentChips();
        const ok = !!(evidence && evidence.ok);

        ToolboxShell.appendLog(
          `[UPLOAD_MULTI][SEQUENTIAL_ATTACH_ONE_DONE] index=${index} name=${fileName} afterCount=${chipCountAfter} ok=${ok ? 1 : 0}`,
        );

        if (ok) {
          success += 1;
          uploadedNames.push(fileName);
        } else {
          failed += 1;
          failedNames.push(fileName);
        }
      }

      const finalComposerCount = typeof countAttachmentChipsFast === 'function'
        ? countAttachmentChipsFast()
        : countAttachmentChips();

      ToolboxShell.appendLog(
        `[UPLOAD_MULTI][SEQUENTIAL_FALLBACK_DONE] success=${success} failed=${failed} finalComposerCount=${finalComposerCount}`,
      );

      if (success <= 0) {
        return {
          ok: false,
          method: 'file-input-sequential',
          reason: 'sequential-fallback-failed',
          detail: failedNames.join('|') || 'all-files-failed',
          attachedCount: 0,
          requestedCount: cleanFiles.length,
          uploadedNames,
          failedNames,
          partial: false,
        };
      }

      if (failed > 0) {
        return {
          ok: false,
          method: 'file-input-sequential',
          reason: 'sequential-fallback-partial',
          detail: `failed=${failedNames.join('|')}`,
          attachedCount: success,
          requestedCount: cleanFiles.length,
          uploadedNames,
          failedNames,
          partial: true,
        };
      }

      return {
        ok: true,
        method: 'file-input-sequential',
        reason: 'sequential-fallback-ok',
        attachedCount: success,
        requestedCount: cleanFiles.length,
        uploadedNames,
        failedNames,
        partial: false,
      };
    }

    async function attachFilesByFileInput(files, timeoutMs = 120000, options = {}) {
      function isHiddenFileInput(input) {
        if (!(input instanceof HTMLInputElement)) return true;
        const style = window.getComputedStyle(input);
        const classText = String(input.className || '').toLowerCase();
        const inlineStyle = String(input.getAttribute('style') || '').toLowerCase();
        const clipText = `${style.clip || ''} ${style.clipPath || ''} ${inlineStyle}`;
        const width = Number(style.width.replace('px', '')) || 0;
        const height = Number(style.height.replace('px', '')) || 0;
        const rect = input.getBoundingClientRect();
        const rectW = rect && Number(rect.width) > 0 ? Number(rect.width) : 0;
        const rectH = rect && Number(rect.height) > 0 ? Number(rect.height) : 0;
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
        if (/clip|clip-path/.test(clipText)) return true;
        if (/sr-only|screen-reader|visually-hidden/.test(classText)) return true;
        if ((width > 0 && width <= 1) || (height > 0 && height <= 1)) return true;
        if ((rectW > 0 && rectW <= 1) || (rectH > 0 && rectH <= 1)) return true;
        return false;
      }
      function isUsableAttachButton(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (isInToolbox(el)) return false;
        if (isInsideConversationHistory(el)) return false;
        if (el.disabled) return false;
        if (String(el.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        const text = [
          el.innerText || '',
          el.textContent || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-testid') || '',
        ].join(' ');
        return /添加文件|上传文件|附件|添加照片|Attach|Upload|Add files|upload|attach/i.test(text);
      }
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const uploadOnly = options.uploadOnly === true;
      const requireSendReady = options.requireSendReady === true
        ? true
        : (options.requireSendReady === false ? false : !uploadOnly);
      const uploadAttachStrategyRaw = String(options.uploadAttachStrategy || '').trim();
      const uploadAttachStrategy = (
        uploadAttachStrategyRaw === 'legacy-input-injection'
          ? 'legacy-input-injection'
          : 'official-ui-first'
      );

      ToolboxShell.appendLog(`[UPLOAD_PATH] strategy=${uploadAttachStrategy}`);
      if (uploadAttachStrategy === 'legacy-input-injection') {
        ToolboxShell.appendLog(
          '[UPLOAD_STRATEGY][WARN] legacy-input-injection uses synthetic input/change events and may be ignored by ChatGPT frontend',
        );
      }

      const cleanFiles = files
        .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
        .filter(Boolean);
      const requireMultipleInput = cleanFiles.length > 1;

      ToolboxShell.appendLog(`[UPLOAD_DIAG][file-input:start] inputFiles=${files.length} cleanFiles=${cleanFiles.length} requireMultiple=${requireMultipleInput ? 1 : 0} names=${cleanFiles.map((f) => f.name).join('|')}`);

      if (!cleanFiles.length) {
        ToolboxShell.appendLog(`[UPLOAD_DIAG][file-input:no-clean-file] raw=${files.map((f, i) => `${i}:${f && f.name || '-'} tag=${f ? Object.prototype.toString.call(f) : '-'} size=${f && f.size}`).join('|')}`);

        return {
          ok: false,
          reason: '没有可上传的 File 对象',
        };
      }

      if (isCancelled()) {
        return {
          ok: false,
          cancelled: true,
          reason: '用户已停止上传',
        };
      }

      let inputs = [];

      if (uploadAttachStrategy === 'official-ui-first') {
        try {
          const composerRoot = getComposerRoot();
          const roots = [
            composerRoot,
            qs('[data-testid="composer"]'),
            qs('main'),
          ].filter((el) => el instanceof HTMLElement);

          const attachSelectors = [
            'button[aria-label*="添加文件"]',
            'button[aria-label*="上传文件"]',
            'button[aria-label*="附件"]',
            'button[aria-label*="添加照片"]',
            'button[aria-label*="Attach"]',
            'button[aria-label*="Upload"]',
            'button[aria-label*="Add files"]',
            'button[data-testid*="attach"]',
            'button[data-testid*="upload"]',
            '[role="button"][aria-label*="添加文件"]',
            '[role="button"][aria-label*="上传文件"]',
            '[role="button"][aria-label*="附件"]',
            '[role="button"][aria-label*="Attach"]',
            '[role="button"][aria-label*="Upload"]',
          ].join(', ');

          const beforeInputs = new Set(qsa('input[type="file"]').filter((el) => el instanceof HTMLInputElement));
          const existingComposerInput = composerRoot instanceof HTMLElement
            ? qsa('input[type="file"]', composerRoot).find((el) => (
              el instanceof HTMLInputElement
              && !el.disabled
              && String(el.getAttribute('aria-disabled') || '').trim().toLowerCase() !== 'true'
              && !isInToolbox(el)
              && !isInsideConversationHistory(el)
            ))
            : null;
          if (existingComposerInput instanceof HTMLInputElement) {
            const hiddenInput = isHiddenFileInput(existingComposerInput);
            ToolboxShell.appendLog(
              `[UPLOAD_OFFICIAL_UI][EXISTING_INPUT_FAST_PATH] usable=1 hidden=${hiddenInput ? 1 : 0}`,
            );
            inputs = [existingComposerInput].concat(
              findFileInputsLegacy({ requireMultiple: requireMultipleInput }).filter((x) => x !== existingComposerInput),
            );
          }

          let candidates = inputs.length
            ? []
            : roots
              .flatMap((scanRoot) => qsa(attachSelectors, scanRoot))
              .filter((el) => isUsableAttachButton(el));

          if (
            !inputs.length
            && !candidates.length
            && typeof resolveChatGPTUploadEntryReadyState === 'function'
          ) {
            const entryState = resolveChatGPTUploadEntryReadyState({
              source: 'attachFilesByFileInput',
              scope: composerRoot instanceof HTMLElement ? composerRoot : null,
            });
            if (
              entryState
              && entryState.ok === true
              && entryState.node instanceof HTMLElement
              && entryState.reason === 'visible-upload-button-ready'
            ) {
              candidates = [entryState.node];
            }
          }

          candidates.forEach((el, index) => {
            const rect = el.getBoundingClientRect();
            const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const aria = String(el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
            const testid = String(el.getAttribute('data-testid') || '').replace(/\s+/g, ' ').trim();
            ToolboxShell.appendLog(
              `[UPLOAD_OFFICIAL_UI][ATTACH_BUTTON_CANDIDATE] index=${index} text=${text || '-'} aria=${aria || '-'} testid=${testid || '-'} rect=${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.left)},${Math.round(rect.top)}` : '-'}`,
            );
          });

          ToolboxShell.appendLog(
            `[UPLOAD_OFFICIAL_UI][CLICK_ATTACH_BUTTON] candidates=${candidates.length}`,
          );

          const deadline = Date.now() + Math.min(2500, Math.max(300, Number(timeoutMs) || 0));
          let picked = null;
          if (!inputs.length && candidates.length) {
            for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
              const attachBtn = candidates[candidateIndex];
              try {
                attachBtn.click();
              } catch (clickErr) {
                const errText = clickErr && clickErr.message ? clickErr.message : String(clickErr);
                console.error('[ChatGPT toolbox] click official attach button failed', clickErr);
                ToolboxShell.appendLog(
                  `[UPLOAD_OFFICIAL_UI][CLICK_ATTACH_BUTTON_FAILED] index=${candidateIndex} error=${errText}`,
                );
                continue;
              }

              const clickDeadline = Date.now() + 900;
              while (Date.now() < clickDeadline) {
                if (isCancelled()) break;
                const nowInputs = qsa('input[type="file"]').filter((el) => el instanceof HTMLInputElement);
                const newOnes = nowInputs.filter((el) => !beforeInputs.has(el));
                const inComposerNew = composerRoot instanceof HTMLElement
                  ? newOnes.find((el) => composerRoot.contains(el))
                  : null;
                picked = inComposerNew || (newOnes[0] || null);
                if (picked) {
                  ToolboxShell.appendLog(
                    `[UPLOAD_OFFICIAL_UI][CLICK_ATTACH_BUTTON_OK] index=${candidateIndex}`,
                  );
                  break;
                }
                await sleep(120);
              }

              if (picked) {
                break;
              }
            }
          }

          if (!picked && !inputs.length) {
            while (Date.now() < deadline) {
              if (isCancelled()) break;
              const nowInputs = qsa('input[type="file"]').filter((el) => el instanceof HTMLInputElement);
              const newOnes = nowInputs.filter((el) => !beforeInputs.has(el));
              const inComposerNew = composerRoot instanceof HTMLElement
                ? newOnes.find((el) => composerRoot.contains(el))
                : null;
              picked = inComposerNew || (newOnes[0] || null);
              if (picked) {
                break;
              }
              await sleep(120);
            }
          }

          if (picked) {
            ToolboxShell.appendLog('[UPLOAD_OFFICIAL_UI][INPUT_FOUND]');
            inputs = [picked].concat(
              findFileInputsLegacy({ requireMultiple: requireMultipleInput }).filter((x) => x !== picked),
            );
          } else {
            ToolboxShell.appendLog('[UPLOAD_OFFICIAL_UI][INPUT_NOT_FOUND_FALLBACK_LEGACY]');
          }
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] official-ui-first failed', err);
          ToolboxShell.appendLog(`[UPLOAD_OFFICIAL_UI][ERROR] error=${errText}`);
        }
      }

      if (!inputs.length) {
        inputs = findFileInputsLegacy({ requireMultiple: requireMultipleInput });
      }

      if (requireMultipleInput) {
        const multipleInputs = inputs.filter((input) => input instanceof HTMLInputElement && input.multiple === true);
        if (multipleInputs.length) {
          inputs = multipleInputs.concat(inputs.filter((input) => !multipleInputs.includes(input)));
        }
      }

      ToolboxShell.appendLog(`旧版 input 上传：发现 ${inputs.length} 个文input requireMultiple=${requireMultipleInput ? 1 : 0}`);

      if (!inputs.length) {
        console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');
        return {
          ok: false,
          reason: 'no-file-input',
          detail: '找不到 ChatGPT composer 附近可用的 input[type=file]',
        };
      }

      for (const input of inputs) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }

        try {
          const inputDesc = describeFileInputCandidate(input);
          console.debug('[ChatGPT toolbox] legacy input upload try', {
            input,
            accept: input.getAttribute('accept'),
            multiple: input.multiple,
            disabled: input.disabled,
            visible: isElementVisible(input),
            files: cleanFiles.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type,
            })),
          });
          ToolboxShell.appendLog(
            `[UPLOAD_INPUT][TRY] multiple=${inputDesc.multiple ? 1 : 0} files=${cleanFiles.length} names=${cleanFiles.map((f) => f.name).join('|')}`,
          );

          const chipCountBefore = typeof countAttachmentChipsFast === 'function'
            ? countAttachmentChipsFast()
            : countAttachmentChips();

          if (requireMultipleInput && input.multiple !== true) {
            const sequentialResult = await attachFilesSequentiallyToInput(
              input,
              cleanFiles,
              timeoutMs,
              {
                signal,
                isCancelled,
              },
            );
            if (sequentialResult && sequentialResult.ok) {
              const nativeResult = await finalizeAttachAfterComposerEvidence(cleanFiles, {
                timeoutMs: Math.max(timeoutMs, 60000),
                nativeSettleTimeoutMs: Math.max(timeoutMs, 60000),
                signal,
                isCancelled,
                uploadOnly,
                requireSendReady,
                runId: options.runId,
                evidenceReason: 'sequential-fallback-ok',
              });
              if (nativeResult.cancelled) {
                return {
                  ok: false,
                  cancelled: true,
                  reason: nativeResult.reason || '用户已停止上传',
                };
              }
              if (nativeResult.ok) {
                return {
                  ...nativeResult,
                  attachedCount: sequentialResult.attachedCount,
                  requestedCount: sequentialResult.requestedCount,
                  uploadedNames: sequentialResult.uploadedNames,
                  failedNames: sequentialResult.failedNames,
                  partial: false,
                  reason: nativeResult.reason || sequentialResult.reason || 'sequential-fallback-ok',
                };
              }
              return {
                ok: false,
                method: 'file-input-sequential',
                reason: nativeResult.reason || 'native-upload-failed',
                detail: nativeResult.detail || '',
                attachedCount: sequentialResult.attachedCount,
                requestedCount: sequentialResult.requestedCount,
                uploadedNames: sequentialResult.uploadedNames,
                failedNames: sequentialResult.failedNames,
                partial: sequentialResult.partial === true,
              };
            }
            if (sequentialResult && sequentialResult.partial) {
              return sequentialResult;
            }
            continue;
          }

          try {
            dispatchFilesToInputLegacy(input, cleanFiles);
          } catch (dispatchErr) {
            if (
              dispatchErr
              && (
                dispatchErr.code === 'input-not-multiple-for-multi-files'
                || String(dispatchErr.message || '').includes('input-not-multiple-for-multi-files')
              )
              && requireMultipleInput
            ) {
              const sequentialResult = await attachFilesSequentiallyToInput(
                input,
                cleanFiles,
                timeoutMs,
                {
                  signal,
                  isCancelled,
                },
              );
              if (sequentialResult && (sequentialResult.ok || sequentialResult.partial)) {
                return sequentialResult;
              }
            }
            throw dispatchErr;
          }

          ToolboxShell.appendLog(`已触发旧版 input change：${cleanFiles.map((f) => f.name).join(', ')} chipBefore=${chipCountBefore}`);

          const evidence = await waitForAttachmentEvidence(
            cleanFiles,
            chipCountBefore,
            timeoutMs,
            {
              signal,
              isCancelled,
            },
          );

          if (evidence && evidence.ok) {
            const chipCountAfter = typeof countAttachmentChipsFast === 'function'
              ? countAttachmentChipsFast()
              : countAttachmentChips();
            const chipIncrease = Math.max(0, chipCountAfter - chipCountBefore);
            if (requireMultipleInput && chipIncrease > 0 && chipIncrease < cleanFiles.length) {
              ToolboxShell.appendLog(
                `[UPLOAD_MULTI][PARTIAL_ATTACH] expected=${cleanFiles.length} actualIncrease=${chipIncrease} names=${cleanFiles.map((f) => f.name).join('|')}`,
              );
              return {
                ok: false,
                method: 'file-input',
                reason: 'partial-attach',
                detail: `chip increase ${chipCountBefore}->${chipCountAfter}`,
                attachedCount: chipIncrease,
                requestedCount: cleanFiles.length,
                uploadedNames: cleanFiles.slice(0, chipIncrease).map((file) => file.name),
                failedNames: cleanFiles.slice(chipIncrease).map((file) => file.name),
                partial: true,
              };
            }
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:batch-evidence-ok] reason=${evidence.reason || '-'} level=${evidence.level || '-'} phase=attached_to_composer`
            );

            const nativeResult = await finalizeAttachAfterComposerEvidence(cleanFiles, {
              timeoutMs: Math.max(timeoutMs, 60000),
              nativeSettleTimeoutMs: Math.max(timeoutMs, 60000),
              signal,
              isCancelled,
              uploadOnly,
              requireSendReady,
              runId: options.runId,
              evidenceReason: 'chip-evidence-ok',
            });

            if (nativeResult.cancelled) {
              return {
                ok: false,
                cancelled: true,
                reason: nativeResult.reason || '用户已停止上传',
              };
            }

            if (nativeResult.ok) {
              return {
                ...nativeResult,
                attachedCount: cleanFiles.length,
                requestedCount: cleanFiles.length,
                uploadedNames: cleanFiles.map((file) => file.name).filter(Boolean),
                failedNames: [],
                partial: false,
              };
            }

            return {
              ok: false,
              method: 'file-input',
              reason: nativeResult.reason || 'native-upload-failed',
              detail: nativeResult.detail || '',
              attachedToComposer: true,
              composerEvidence: evidence.reason || '',
              attachedCount: 0,
              requestedCount: cleanFiles.length,
              partial: false,
            };
          }

          const settledReasons = [];

          for (const f of cleanFiles) {
            if (isCancelled()) {
              return {
                ok: false,
                cancelled: true,
                reason: '用户已停止上传',
              };
            }

            const settled = await waitLegacyInputSettled(f, {
              timeoutMs,
              pollMs: 250,
              stableNeed: 2,
              chipCountBefore,
              extraNames: cleanFiles.map((item) => item && item.name).filter(Boolean),
              signal,
              isCancelled,
            });

            if (settled.cancelled) {
              return {
                ok: false,
                cancelled: true,
                reason: settled.reason || '用户已停止上传',
              };
            }

            if (!settled.ok) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][file-input:settled-failed] ${f.name} reason=${settled.reason || '-'} textPreview=${settled.textPreview || '-'}`
              );

              return {
                ok: false,
                method: 'file-input',
                settledFailed: true,
                reason: settled.reason || '附件已出现但未能确认稳定',
                chipCountBefore,
                chipCountAfter: countAttachmentChips(),
                textPreview: settled.textPreview || '',
              };
            }

            settledReasons.push(settled.reason || '附件区域识别到文件名');
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:settled-batch-ok] phase=attached_to_composer reasons=${settledReasons.join('；')}`
          );

          const nativeResult = await finalizeAttachAfterComposerEvidence(cleanFiles, {
            timeoutMs: Math.max(timeoutMs, 60000),
            nativeSettleTimeoutMs: Math.max(timeoutMs, 60000),
            signal,
            isCancelled,
            uploadOnly,
            requireSendReady,
            runId: options.runId,
            evidenceReason: 'chip-evidence-ok',
          });

          if (nativeResult.cancelled) {
            return {
              ok: false,
              cancelled: true,
              reason: nativeResult.reason || '用户已停止上传',
            };
          }

          if (nativeResult.ok) {
            return {
              ...nativeResult,
              reason: `旧版 input 上传成功：${settledReasons.join('；')}；${nativeResult.reason || 'native-upload-settled'}`,
            };
          }

          return {
            ok: false,
            method: 'file-input',
            reason: nativeResult.reason || 'native-upload-failed',
            detail: nativeResult.detail || '',
            attachedToComposer: true,
          };
        } catch (e) {
          const errText = e && e.message ? e.message : String(e);
          console.error('[ChatGPT toolbox] legacy input dispatch failed', {
            input,
            files: cleanFiles.map((f) => f.name),
          }, e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:dispatch-error] error=${errText}`,
          );
        }
      }

      return {
        ok: false,
        method: 'file-input',
        reason: 'synthetic-change-ignored',
        detail: 'ChatGPT 未接受脚本模拟的 input/change 文件注入，请使用官方 + 手动选择文件，或改用浏览器扩展/CDP 上传通道',
      };
    }


    function getChatMessageElementsInOrder() {
      const nodes = qsa('[data-message-author-role]').filter((el) => !isInToolbox(el));

      const topLevel = nodes.filter((el) => {
        let p = el.parentElement;

        while (p) {
          if (p.matches && p.matches('[data-message-author-role]') && nodes.includes(p)) {
            return false;
          }

          p = p.parentElement;
        }

        return true;
      });

      topLevel.sort((a, b) => {
        const pos = a.compareDocumentPosition(b);

        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;

        return 0;
      });

      return topLevel;
    }

    function getLatestAssistantTextForDebug() {
      const nodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]'),
      );
      const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      if (!lastNode) {
        return '';
      }
      return String(lastNode.innerText || lastNode.textContent || '').trim();
    }

    function isAssistantDoneSignalTextForDebug(text) {
      const configuredStopSignal = (
        typeof getCopyHotkeyContinueStopSignal === 'function'
          ? getCopyHotkeyContinueStopSignal()
          : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>'
      );
      const allowedSignals = new Set([
        '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>',
        'CHATGPT_TOOLBOX_DONE',
        '__CHATGPT_TOOLBOX_DONE__',
        '<<<CHATGPT_TOOLBOX_DONE>>>',
        '<<<TASK_DONE>>>',
        'TASK_DONE',
        configuredStopSignal,
      ]);
      const raw = String(text || '').replace(/\r\n/g, '\n').trim();
      if (!raw) {
        return false;
      }
      const lines = raw
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      return lines.length === 1 && allowedSignals.has(lines[0]);
    }

    function buildComposerDebugSnapshot() {
      const composer = getComposer();
      const composerRoot = getComposerRoot();
      const inputFound = composer instanceof HTMLElement;
      const sendBtn = findSendButton({ silent: true });
      const sendInfo = describeSendButton(sendBtn);
      const responseState = detectComposerResponseState();
      const latestAssistantText = getLatestAssistantTextForDebug();
      const latestAssistantPreview = latestAssistantText.length > 160
        ? `${latestAssistantText.slice(0, 160)}...`
        : latestAssistantText;

      return {
        composerFound: composerRoot instanceof HTMLElement || inputFound,
        inputFound,
        sendButtonFound: sendBtn instanceof HTMLButtonElement,
        sendButtonSelector: sendInfo.selector || lastSendButtonScanMeta.selector || '',
        sendButtonDisabled: sendInfo.disabled,
        sendButtonScan: { ...lastSendButtonScanMeta },
        responseState: responseState.response_state || 'unknown',
        responseStateReason: responseState.response_state_reason || '',
        canAcceptInput: Boolean(responseState.can_accept_input),
        canSendNow: Boolean(responseState.can_send_now),
        latestAssistantPreview,
        latestAssistantDoneSignalMatched: isAssistantDoneSignalTextForDebug(latestAssistantText),
      };
    }

    function registerComposerDebugApi() {
      const target = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      target.__cgptToolboxDebugComposer = function __cgptToolboxDebugComposer() {
        const snapshot = buildComposerDebugSnapshot();
        console.warn('[COMPOSER][DEBUG]', snapshot);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[COMPOSER][DEBUG] send=${snapshot.sendButtonFound ? '1' : '0'} `
            + `reason=${snapshot.responseStateReason || '-'} `
            + `doneSignal=${snapshot.latestAssistantDoneSignalMatched ? '1' : '0'}`,
          );
        }
        return snapshot;
      };
    }

    registerComposerDebugApi();

    return {
      getComposer,
      getComposerRoot,
      getComposerText,
      setComposerValue,
      clearComposerValue,
      normalizeComposerText,
      isComposerTextSynced,
      checkComposerTextSyncDetailed,
      waitForComposerTextSynced,
      dispatchComposerSendKeyboard,
      findSendButton,
      findRealComposerSendButton: findSendButton,
      hasRealComposerText,
      hasRealSubmitButton,
      resolveButtonElement,
      isVoiceButton,
      isRealSendButton,
      isRealSendButtonShape,
      hasComposerPayloadForSend,
      describeSendButton,
      isSendButtonReady,
      focusComposerForNativeSend,
      clickSend,
      hasComposer,
      canAcceptInput,
      canAcceptTextInput,
      canSendNow,
      canSendNowLight,
      isAssistantLikelyBusy,
      attachFilesByFileInput,
      detectChatGPTNativeUploadError,
      clearUploadCriticalMode,
      getComposerUploadSnapshot,
      waitChatGPTNativeUploadSettled,
      clearAttachments,
      clearAttachmentsByKeys,
      collectAttachmentChipText,
      countAttachmentChips,
      countAttachmentChipsFast,
      getUniqueComposerAttachmentSnapshot,
      getComposerRuntimeSnapshotLight,
      buildComposerRuntimeSnapshotLight,
      buildComposerSnapshot: buildComposerRuntimeSnapshotLight,
      hasComposerDraftPayload,
      hasComposerAttachmentUnified,
      getComposerAttachmentSnapshot,
      getComposerAttachmentSnapshotFast,
      hasVisibleComposerAttachmentPayload,
      getExistingComposerPayloadSnapshot,
      waitExistingComposerPayloadReadyForSend,
      findComposerRoot,
      findAttachmentCardsInComposer,
      findAttachmentEvidence,
      fileNameEvidence,
      canonicalFileName,
      normalizeUploadComparableFileName,
      normalizeUploadComparableFileStem,
      isAttachmentStillUploading,
      isAttachmentUploadingInComposer,
      isAttachmentReadyInComposer,
      getChatMessageElementsInOrder,
      buildComposerDebugSnapshot,
      async precheckSendable() {
        const responseState = detectComposerResponseState();
        if (responseState.is_responding) {
          return { ok: false, reason: 'assistant_busy' };
        }
        const composer = getComposer();
        if (!(composer instanceof HTMLElement)) {
          return { ok: false, reason: 'composer_not_found' };
        }
        return { ok: true, reason: 'sendable' };
      },
      async waitMessageAccepted(messageTextHash, options = {}) {
        const composer = findChatGPTComposer();
        const beforeText = getComposerTextFromElement(composer);
        const beforeStopButton = findChatGPTStopButton();
        const confirmCtx = buildStableSendConfirmCtx(beforeText, beforeStopButton);
        if (messageTextHash) {
          confirmCtx.contentProbe = String(messageTextHash).slice(0, 80);
        }
        const verified = await verifySendStarted(confirmCtx, options);
        return {
          ok: !!verified.ok,
          reason: verified.reason || '',
          messageId: confirmCtx.beforeLatestKey || '',
        };
      },
    };
  })();

  const SEND_BUTTON_WAIT_RESPONSE_REASONS = new Set([
    'send_button_not_ready',
    'attachment_processing',
    'payload_ready_but_send_button_missing',
    'attachment_ready_but_send_button_missing',
    'home_new_chat_payload_but_send_button_missing',
    'send_button_disabled_with_payload',
    'send_button_not_ready_after_text',
    'send_button_not_ready_with_attachment',
  ]);

  function composerHasPayloadInInput() {
    const textLen = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '').trim().length
      : 0;
    const hasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
    const attachmentUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
      && ComposerApi.isAttachmentStillUploading();
    return {
      textLen,
      hasText: textLen > 0,
      hasAttachment,
      attachmentUploading,
      hasPayload: textLen > 0 || hasAttachment,
    };
  }

  function isSendButtonWaitResponseState(responseState) {
    if (!responseState || typeof responseState !== 'object') {
      return false;
    }

    const reason = String(responseState.response_state_reason || '').trim();
    const state = String(responseState.response_state || '').trim();

    if (SEND_BUTTON_WAIT_RESPONSE_REASONS.has(reason)) {
      return true;
    }

    if (state === 'attachment_processing') {
      return true;
    }

    if (state === 'not_ready' && /send_button|attachment_ready|payload_ready/.test(reason)) {
      return true;
    }

    if (
      state === 'composing'
      && responseState.can_send_now === false
      && responseState.has_composer_payload === true
    ) {
      return true;
    }

    return false;
  }

  function shouldBlockEnterFallbackForComposer(responseStateInput) {
    const payload = composerHasPayloadInInput();
    const responseState = responseStateInput && typeof responseStateInput === 'object'
      ? responseStateInput
      : (typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState()
        : {});

    if (payload.attachmentUploading) {
      return true;
    }

    if (payload.hasAttachment) {
      return true;
    }

    if (payload.hasText && isSendButtonWaitResponseState(responseState)) {
      return true;
    }

    if (payload.hasPayload && isSendButtonWaitResponseState(responseState)) {
      return true;
    }

    const sendability = typeof evaluateComposerSendability === 'function'
      ? evaluateComposerSendability()
      : {};
    if (payload.hasPayload && !sendability.realSendButtonEnabled) {
      return true;
    }

    return false;
  }

  function getComposerSendButtonSnapshot(options = {}) {
    const silent = options && options.silent === true;
    const source = String(options.source || '-');
    const skipNestedComposerResolve = options && options.skipNestedComposerResolve === true;
    const fallbackSnapshot = {
      found: false,
      ready: false,
      button: null,
      visible: false,
      disabled: true,
      aria: '',
      testid: '',
      id: '',
      source: 'fallback',
      reason: 'snapshot-guarded',
    };

    if (composerDetectDepth >= MAX_COMPOSER_DETECT_DEPTH) {
      if (!silent && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_SNAPSHOT_REENTER_SKIP] depth=${composerDetectDepth} source=${source}`,
        );
      }
      return fallbackSnapshot;
    }

    return withComposerDetectGuard('getComposerSendButtonSnapshot', fallbackSnapshot, () => {
      let button = null;
      let foundSource = '';

      if (typeof getRealComposerSendButton === 'function') {
        button = getRealComposerSendButton(`snapshot:${source}`);
        if (button instanceof HTMLButtonElement) {
          foundSource = 'getRealComposerSendButton';
        }
      }

      if (
        !(button instanceof HTMLButtonElement)
        && typeof findRealChatGPTSendButton === 'function'
      ) {
        button = findRealChatGPTSendButton({ reason: `snapshot:${source}` });
        if (button instanceof HTMLButtonElement) {
          foundSource = 'findRealChatGPTSendButton';
        }
      }

      if (
        !(button instanceof HTMLButtonElement)
        && !skipNestedComposerResolve
        && typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.findSendButton === 'function'
      ) {
        button = ComposerApi.findSendButton({
          silent: true,
          skipNestedComposerResolve: true,
        });
        if (button instanceof HTMLButtonElement && button.getAttribute('data-testid') === 'send-button') {
          foundSource = 'ComposerApi.findSendButton';
        } else {
          button = null;
        }
      }

      const found = button instanceof HTMLButtonElement;
      const ready = !!(
        found
        && !button.disabled
        && button.getAttribute('aria-disabled') !== 'true'
        && (
          typeof ComposerApi === 'undefined'
          || typeof ComposerApi.isSendButtonReady !== 'function'
          || ComposerApi.isSendButtonReady(button)
        )
      );
      const rect = found ? button.getBoundingClientRect() : null;
      const snapshot = {
        found,
        ready,
        button: found ? button : null,
        visible: !!(rect && rect.width > 0 && rect.height > 0),
        disabled: found ? !!button.disabled : true,
        aria: found ? String(button.getAttribute('aria-label') || '') : '',
        testid: found ? String(button.getAttribute('data-testid') || '') : '',
        id: found ? String(button.id || '') : '',
        source: foundSource,
        reason: found
          ? (ready ? 'send_button_ready' : 'send_button_disabled')
          : 'button-not-found',
      };

      if (!silent && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_SNAPSHOT] found=${snapshot.found ? 1 : 0} `
          + `ready=${snapshot.ready ? 1 : 0} visible=${snapshot.visible ? 1 : 0} `
          + `source=${snapshot.source || '-'} aria=${snapshot.aria || '-'} `
          + `testid=${snapshot.testid || '-'} reason=${snapshot.reason}`,
        );
      }

      return snapshot;
    });
  }

  function logSendPreSendGate(extra) {
    const payload = composerHasPayloadInInput();
    const responseState = typeof detectComposerResponseState === 'function'
      ? detectComposerResponseState()
      : {};
    const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
      ? getComposerSendButtonSnapshot({ silent: true })
      : { found: false, ready: false };
    const sendability = typeof evaluateComposerSendability === 'function'
      ? evaluateComposerSendability()
      : {};
    const blockEnter = shouldBlockEnterFallbackForComposer(responseState);
    const waitSend = !!(
      blockEnter
      || (
        payload.hasPayload
        && (
          sendSnap.found !== true
          || sendSnap.ready !== true
        )
      )
    );
    const waitReply = !!(
      responseState.is_responding
      || responseState.response_state === 'generating'
      || responseState.response_state === 'waiting_reply'
      || responseState.response_state_reason === 'assistant_busy'
    );
    const fields = Object.assign({
      textLen: payload.textLen,
      hasAttachment: payload.hasAttachment ? 1 : 0,
      attachmentUploading: payload.attachmentUploading ? 1 : 0,
      sendButtonFound: sendSnap.found ? 1 : 0,
      sendButtonReady: sendSnap.ready ? 1 : 0,
      sendButtonVisible: sendSnap.visible ? 1 : 0,
      responseState: String(responseState.response_state || '-'),
      responseReason: String(responseState.response_state_reason || '-'),
      wait_send: waitSend ? 1 : 0,
      wait_reply: waitReply ? 1 : 0,
      allowEnterFallback: blockEnter ? 0 : 1,
    }, extra || {});

    appendSendLogFields('[SEND][PRE_SEND_GATE]', fields);
  }

  function canReallyClickNativeSend(extra = {}) {
    const payload = extra.payload && typeof extra.payload === 'object'
      ? extra.payload
      : composerHasPayloadInInput();
    const responseState = extra.responseState && typeof extra.responseState === 'object'
      ? extra.responseState
      : (typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState({ reason: 'can-really-click-send' })
        : {});
    const sendSnap = extra.sendSnap && typeof extra.sendSnap === 'object'
      ? extra.sendSnap
      : (typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { found: false, ready: false });
    const sendability = extra.sendability && typeof extra.sendability === 'object'
      ? extra.sendability
      : (typeof evaluateComposerSendability === 'function'
        ? evaluateComposerSendability()
        : { realSendButtonEnabled: false });
    const sendButtonDisabled = !!(
      sendSnap.button instanceof HTMLButtonElement
      && isSendButtonDisabled(sendSnap.button)
    );
    const responseReason = String(responseState.response_state_reason || '').trim();
    const blockedReasons = new Set([
      'home_new_chat_payload_but_send_button_missing',
      'payload_ready_but_send_button_missing',
      'attachment_ready_but_send_button_missing',
      'send_button_disabled_with_payload',
    ]);

    if (responseState.response_state === 'not_ready' && blockedReasons.has(responseReason)) {
      return false;
    }

    return !!(
      sendSnap.found === true
      && sendability.realSendButtonEnabled
      && !sendButtonDisabled
      && !payload.attachmentUploading
      && responseState.response_state === 'ready'
    );
  }

  async function waitForNativeSendButtonReady(options = {}) {
    const waitMs = Math.max(1000, Number(options.waitMs || SEND_TEXT_BUTTON_WAIT_MS));
    const pollMs = Math.max(50, Number(options.pollMs || 300));
    const source = String(options.source || '-');
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const startAt = Date.now();

    if (typeof invalidateComposerResponseStateCache === 'function') {
      invalidateComposerResponseStateCache();
    }
    if (
      typeof ComposerAttachments !== 'undefined'
      && ComposerAttachments
      && typeof ComposerAttachments.markAttachmentDirty === 'function'
    ) {
      ComposerAttachments.markAttachmentDirty(`before-send:${source}`);
    }

    while (Date.now() - startAt < waitMs) {
      if (shouldStop()) {
        return { ok: false, reason: 'cancelled', retryable: false };
      }

      if (typeof invalidateComposerResponseStateCache === 'function') {
        invalidateComposerResponseStateCache();
      }

      const payload = composerHasPayloadInInput();
      const responseState = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState({ reason: 'send-wait-button' })
        : {};
      const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { found: false, ready: false };
      const sendability = typeof evaluateComposerSendability === 'function'
        ? evaluateComposerSendability()
        : { realSendButtonEnabled: false };
      const sendButtonDisabled = !!(
        sendSnap.button instanceof HTMLButtonElement
        && isSendButtonDisabled(sendSnap.button)
      );

      if (canReallyClickNativeSend({ payload, responseState, sendSnap, sendability })) {
        return { ok: true, reason: 'native-send-button-ready', retryable: false };
      }

      appendSendLogFields('[SEND][WAIT_NATIVE_BUTTON_READY]', {
        elapsedMs: Date.now() - startAt,
        source,
        hasAttachment: payload.hasAttachment ? 1 : 0,
        attachmentUploading: payload.attachmentUploading ? 1 : 0,
        sendButtonFound: sendSnap.found ? 1 : 0,
        realSendButtonEnabled: sendability.realSendButtonEnabled ? 1 : 0,
        sendButtonDisabled: sendButtonDisabled ? 1 : 0,
        responseState: String(responseState.response_state || '-'),
        responseReason: String(responseState.response_state_reason || '-'),
      });

      await sleep(pollMs);
    }

    return {
      ok: false,
      reason: 'native-send-button-timeout',
      retryable: true,
      wait_send: true,
      wait_reply: false,
    };
  }

  function buildSendButtonWaitBlockedResult(source) {
    const payload = composerHasPayloadInInput();
    const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
      ? getComposerSendButtonSnapshot({ silent: true })
      : { ready: false };
    const reason = sendSnap.ready && !payload.attachmentUploading
      ? 'native-send-button-not-ready'
      : 'waiting_attachment_upload_done';
    const logTag = '[SEND][WAIT_ATTACHMENT_UPLOAD_DONE]';
    appendSendLogFields(logTag, {
      hasAttachment: payload.hasAttachment ? 1 : 0,
      attachmentUploading: payload.attachmentUploading ? 1 : 0,
      sendButtonReady: sendSnap.ready ? 1 : 0,
      nativeDisabled: sendSnap.ready ? 0 : 1,
      textLen: payload.textLen,
      reason,
      source: String(source || '-'),
    });
    return {
      ok: false,
      reason,
      retryable: true,
      wait_send: true,
      wait_reply: false,
    };
  }

  function applyEnterFallbackBlockIfNeeded(result, extra) {
    if (!shouldBlockEnterFallbackForComposer()) {
      return false;
    }

    result.reason = 'enter_fallback_blocked_with_attachment';
    result.retryable = true;
    result.wait_send = true;
    result.wait_reply = false;
    appendSendLogFields('[SEND][BLOCKED_WAIT_BUTTON]', Object.assign({
      reason: result.reason,
      source: String((extra && extra.source) || '-'),
      ...getComposerSendDiagnostics(),
    }, extra || {}));
    return true;
  }

  const LIGHT_COMPOSER_NOT_FOUND_GRACE_MS = 3000;
  const LIGHT_COMPOSER_NOT_FOUND_STREAK_THRESHOLD = 3;
  let lightComposerDetectStartedAt = 0;
  let lightComposerNotFoundStreak = 0;
  let lightComposerEverFound = false;

  function detectComposerResponseStateLight(options = {}) {
    const skipSendButtonSnapshot = options.skipSendButtonSnapshot !== false;
    const now = Date.now();
    if (!(lightComposerDetectStartedAt > 0)) {
      lightComposerDetectStartedAt = now;
    }

    let isResponding = false;
    let hasComposer = false;
    let composerText = '';
    let sendButton = null;
    let sendButtonReady = false;
    let attachmentCount = 0;
    let hasAttachmentPayload = false;

    const hasComposerApi = typeof ComposerApi !== 'undefined';
    const runtimeSnapshot = (
      hasComposerApi
      && typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
    )
      ? ComposerApi.getComposerRuntimeSnapshotLight(450)
      : null;

    if (runtimeSnapshot && typeof runtimeSnapshot === 'object') {
      isResponding = !!runtimeSnapshot.isAssistantBusy;
      hasComposer = !!runtimeSnapshot.hasComposer;
      composerText = String(runtimeSnapshot.composerText || '');
      attachmentCount = Number(runtimeSnapshot.attachmentCount || runtimeSnapshot.attachment_count || 0);
      hasAttachmentPayload = !!runtimeSnapshot.hasAttachmentPayload;
      if (!skipSendButtonSnapshot) {
        sendButton = runtimeSnapshot.sendButton instanceof HTMLButtonElement
          ? runtimeSnapshot.sendButton
          : null;
        sendButtonReady = !!runtimeSnapshot.realSendButtonEnabled;
      }
    } else if (hasComposerApi) {
      try {
        const composer = typeof ComposerApi.getComposer === 'function'
          ? ComposerApi.getComposer()
          : null;
        const composerRoot = typeof ComposerApi.getComposerRoot === 'function'
          ? ComposerApi.getComposerRoot()
          : null;
        sendButton = null;
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          ? !!ComposerApi.isAssistantLikelyBusy()
          : false;
        composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';
        attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
          ? Number(ComposerApi.countAttachmentChips() || 0)
          : 0;
        hasAttachmentPayload = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
          ? !!ComposerApi.hasComposerAttachmentUnified()
          : false;

        hasComposer = !!(composer || composerRoot || composerText);

        if (!(sendButton instanceof HTMLButtonElement)) {
          if (typeof ComposerApi.findSendButton === 'function') {
            const candidate = ComposerApi.findSendButton({ silent: true });
            if (candidate instanceof HTMLButtonElement && !isInsideToolbox(candidate)) {
              sendButton = candidate;
            }
          }
        }
        if (!(sendButton instanceof HTMLButtonElement)) {
          const fallbackSelectors = [
            '#composer-submit-button',
            'button[data-testid="send-button"]',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
          ];
          for (const selector of fallbackSelectors) {
            const candidate = document.querySelector(selector);
            if (!(candidate instanceof HTMLButtonElement)) {
              continue;
            }
            if (isInsideToolbox(candidate)) {
              continue;
            }
            const labelText = String(
              candidate.getAttribute('aria-label')
              || candidate.getAttribute('data-testid')
              || candidate.textContent
              || '',
            ).trim();
            if (/添加文件|上传|附件|移除文件|开始听写|语音|Attach|attachment|remove|dictation/i.test(labelText)) {
              continue;
            }
            sendButton = candidate;
            break;
          }
        }
        if (sendButton instanceof HTMLButtonElement) {
          sendButtonReady = typeof ComposerApi.isSendButtonReady === 'function'
            ? !!ComposerApi.isSendButtonReady(sendButton)
            : !sendButton.disabled;
          if (typeof ComposerApi.isRealSendButton === 'function' && !ComposerApi.isRealSendButton(sendButton)) {
            sendButtonReady = false;
          }
        }
      } catch (error) {
        console.error('[COMPOSER][LIGHT_DETECT][COMPOSER_API_FAILED]', error);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[COMPOSER][LIGHT_DETECT][COMPOSER_API_FAILED] type=${error && error.name ? error.name : 'Error'} error=${error && error.message ? error.message : String(error)}`,
          );
        }
      }
    }

    function fallbackQueryComposer() {
      const sels = [
        '#prompt-textarea',
        'textarea[name="prompt-textarea"]',
        '[data-testid="composer-textarea"]',
        '[data-testid="composer"]',
        '[data-testid="composer"] textarea',
        '[data-testid="composer"] [contenteditable="true"]',
        '[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'form div[contenteditable="true"]',
        'main form textarea',
        'main form [contenteditable="true"]',
      ];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && !isInsideToolbox(el)) {
          return el;
        }
      }
      return null;
    }

    if (!hasComposer) {
      const fallback = fallbackQueryComposer();
      if (fallback) {
        hasComposer = true;
        if (typeof fallback.value === 'string') {
          composerText = String(fallback.value || '');
        } else if (fallback && typeof fallback.textContent === 'string') {
          composerText = String(fallback.textContent || '');
        }
      }

      if (!(sendButton instanceof HTMLButtonElement)) {
        sendButton = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
        if (sendButton instanceof HTMLButtonElement) {
          sendButtonReady = !sendButton.disabled;
        }
      }

      if (!isResponding) {
        const stopButton = document.querySelector('button[data-testid="stop-button"]');
        isResponding = stopButton instanceof HTMLButtonElement
          && isElementVisible(stopButton)
          && !stopButton.disabled;
      }
    }

    if (hasComposer) {
      lightComposerEverFound = true;
      lightComposerNotFoundStreak = 0;
    } else {
      lightComposerNotFoundStreak += 1;
    }

    const composerTextTrimmed = String(composerText || '').trim();
    const composerTextHasPayload = composerTextTrimmed.length > 0;
    const hasComposerPayload = composerTextHasPayload || !!hasAttachmentPayload;

    const realSendButtonEnabled = !!(sendButtonReady && (sendButton instanceof HTMLButtonElement));

    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      return {
        is_responding: false,
        response_state: realSendButtonEnabled ? 'ready' : 'not_ready',
        response_state_reason: realSendButtonEnabled
          ? 'home_new_chat_composer_ready_override'
          : 'home_new_chat_payload_but_send_button_missing',
        can_accept_input: true,
        can_send_now: realSendButtonEnabled,
        has_composer: true,
        has_composer_payload: hasComposerPayload,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    const composerAvailable = hasComposer;
    const canAcceptInput = composerAvailable && !isResponding;
    const canSendNowValue = composerAvailable
      && !isResponding
      && realSendButtonEnabled
      && hasComposerPayload;

    if (isResponding) {
      return {
        is_responding: true,
        response_state: 'generating',
        response_state_reason: 'assistant_busy',
        can_accept_input: false,
        can_send_now: false,
        has_composer: composerAvailable,
        has_composer_payload: hasComposerPayload,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    if (!composerAvailable) {
      const withinGrace = now - lightComposerDetectStartedAt < LIGHT_COMPOSER_NOT_FOUND_GRACE_MS;
      const withinStreak = lightComposerNotFoundStreak < LIGHT_COMPOSER_NOT_FOUND_STREAK_THRESHOLD;
      const waiting = withinGrace || withinStreak;
      const reason = waiting ? 'composer_waiting' : 'composer_not_found';
      return {
        is_responding: false,
        response_state: 'no_composer',
        response_state_reason: reason,
        can_accept_input: false,
        can_send_now: false,
        has_composer: false,
        has_composer_payload: hasComposerPayload,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    if (!hasComposerPayload) {
      return {
        is_responding: false,
        response_state: 'idle',
        response_state_reason: 'empty_composer',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        has_composer: true,
        has_composer_payload: false,
        composer_text_len: composerTextTrimmed.length,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    if (realSendButtonEnabled) {
      return {
        is_responding: false,
        response_state: 'ready',
        response_state_reason: composerTextHasPayload ? 'payload_ready' : 'attachment_only_send',
        can_accept_input: canAcceptInput,
        can_send_now: true,
        has_composer: true,
        has_composer_payload: true,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    const sendButtonDisabled = !!(sendButton instanceof HTMLButtonElement && sendButton.disabled);
    if (!sendButton) {
      return {
        is_responding: false,
        response_state: hasAttachmentPayload ? 'attachment_processing' : 'not_ready',
        response_state_reason: composerTextHasPayload
          ? 'send_button_not_found'
          : (hasAttachmentPayload
            ? 'attachment_ready_but_send_button_missing'
            : 'send_button_not_found'),
        can_accept_input: canAcceptInput,
        can_send_now: false,
        has_composer: true,
        has_composer_payload: true,
        composer_text_len: composerTextTrimmed.length,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    if (sendButtonDisabled) {
      return {
        is_responding: false,
        response_state: 'not_ready',
        response_state_reason: 'send_button_disabled_with_payload',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        has_composer: true,
        has_composer_payload: true,
        attachment_count: attachmentCount,
        response_state_at: now,
      };
    }

    return {
      is_responding: false,
      response_state: composerTextHasPayload ? 'composing' : 'not_ready',
      response_state_reason: composerTextHasPayload
        ? 'composer_has_text'
        : 'send_button_not_ready',
      can_accept_input: canAcceptInput,
      can_send_now: canSendNowValue,
      has_composer: true,
      has_composer_payload: true,
      attachment_count: attachmentCount,
      response_state_at: now,
    };
  }

  let detectComposerResponseStateDepth = 0;
  let composerDetecting = false;
  const MAX_DETECT_COMPOSER_RESPONSE_STATE_DEPTH = 6;

  function buildDetectReenterSkipState(reasonText) {
    return {
      is_responding: false,
      response_state: 'detecting',
      response_state_reason: 'detect-reenter-skip',
      reason: 'detect-reenter-skip',
      can_accept_input: false,
      can_send_now: false,
      has_composer: false,
      has_composer_payload: false,
      attachment_count: 0,
      response_state_at: Date.now(),
      _detect_reenter_skip: true,
      _detect_reason: reasonText,
    };
  }

  function detectComposerResponseState(options = {}) {
    const perfStartedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const lightMode = options && options.light === true;
    const reasonText = String(options && options.reason ? options.reason : '').slice(0, 120) || '-';
    const now = Date.now();
    const responseCacheKey = [
      location.href || '',
      document.visibilityState || '',
      document.hasFocus() ? 1 : 0,
      lightMode ? 1 : 0,
    ].join('|');
    if (
      responseStateCache.value
      && responseStateCache.key === responseCacheKey
      && now - Number(responseStateCache.at || 0) <= PAGE_CAPABILITY_CACHE_TTL_MS
    ) {
      return responseStateCache.value;
    }
    if (composerDetecting) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[COMPOSER][DETECT_REENTER_SKIP] reason=${reasonText}`);
      }
      return getCachedResponseStateForReenter(reasonText);
    }
    if (detectComposerResponseStateDepth >= MAX_DETECT_COMPOSER_RESPONSE_STATE_DEPTH) {
      console.error('[ChatGPT toolbox] detectComposerResponseState recursion guard triggered', {
        depth: detectComposerResponseStateDepth,
        maxDepth: MAX_DETECT_COMPOSER_RESPONSE_STATE_DEPTH,
        options,
      });
      logComposerRecursionGuardThrottled(
        'detectComposerResponseState',
        detectComposerResponseStateDepth,
        MAX_DETECT_COMPOSER_RESPONSE_STATE_DEPTH,
      );
      // 递归保护场景下仍然允许走轻量检测，但不要再强制跳过发送按钮快照。
      // 当前死锁问题就是 light 检测返回 attachment_processing/send_button_not_found，
      // 而真实 DOM 已经 realSendReady=1。
      return rememberResponseState(responseCacheKey, detectComposerResponseStateLight({
        skipSendButtonSnapshot: false,
      }));
    }

    detectComposerResponseStateDepth += 1;
    composerDetecting = true;
    try {
    if (options && options.light === true) {
      const lightResult = detectComposerResponseStateLight(Object.assign({
        // light 模式不能跳过发送按钮快照。
        // 否则会在附件已 ready、原生发送按钮已存在时继续返回 send_button_not_found。
        skipSendButtonSnapshot: false,
      }, options || {}));
      if (
        lightResult
        && lightResult.response_state === 'attachment_processing'
        && lightResult.response_state_reason === 'send_button_not_found'
      ) {
        console.warn('[COMPOSER][LIGHT_DETECT_STALE_SEND_BUTTON_NOT_FOUND]', lightResult);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            '[COMPOSER][LIGHT_DETECT_STALE_SEND_BUTTON_NOT_FOUND] '
            + `canSendNow=${lightResult.can_send_now ? 1 : 0} `
            + `hasPayload=${lightResult.has_composer_payload ? 1 : 0} `
            + `attachmentCount=${lightResult.attachment_count || 0}`,
          );
        }
      }
      return rememberResponseState(responseCacheKey, lightResult);
    }

    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      const composerText = ComposerApi.getComposerText();
      const attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
        ? ComposerApi.countAttachmentChips()
        : 0;
      const hasAttachmentPayload = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
        ? ComposerApi.hasComposerAttachmentUnified()
        : (
          attachmentCount > 0
          || (typeof ComposerApi.hasComposerDraftPayload === 'function' && ComposerApi.hasComposerDraftPayload())
          || (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload())
        );
      const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { found: false, ready: false };

      return {
        is_responding: false,
        response_state: sendSnap.ready ? 'ready' : 'not_ready',
        response_state_reason: sendSnap.ready
          ? 'home_new_chat_composer_ready_override'
          : 'home_new_chat_payload_but_send_button_missing',
        can_accept_input: true,
        can_send_now: !!sendSnap.ready,
        attachment_count: attachmentCount,
        has_composer_payload: hasAttachmentPayload || !!composerText,
        response_state_at: Date.now(),
      };
    }

    const isResponding = ComposerApi.isAssistantLikelyBusy();
    const runtimeSnapshot = typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
      ? ComposerApi.getComposerRuntimeSnapshotLight(450)
      : null;
    const composerAvailable = runtimeSnapshot
      ? !!runtimeSnapshot.composerAvailable
      : (typeof ComposerApi.canAcceptInput === 'function'
        ? ComposerApi.canAcceptInput()
        : (typeof ComposerApi.hasComposer === 'function'
          ? ComposerApi.hasComposer()
          : !!ComposerApi.getComposerText()));
    const composerText = runtimeSnapshot
      ? String(runtimeSnapshot.composerText || '')
      : ComposerApi.getComposerText();
    const attachmentCount = runtimeSnapshot
      ? Number(runtimeSnapshot.attachmentCount || runtimeSnapshot.attachment_count || 0)
      : (typeof ComposerApi.countAttachmentChips === 'function'
        ? ComposerApi.countAttachmentChips()
        : 0);
    const hasAttachmentPayload = runtimeSnapshot
      ? !!runtimeSnapshot.hasAttachmentPayload
      : (typeof ComposerApi.hasComposerAttachmentUnified === 'function'
        ? ComposerApi.hasComposerAttachmentUnified()
        : (
          attachmentCount > 0
          || (typeof ComposerApi.hasComposerDraftPayload === 'function' && ComposerApi.hasComposerDraftPayload())
          || (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload())
        ));
    const composerTextTrimmed = String(composerText || '').trim();
    const hasText = composerTextTrimmed.length > 0;
    const hasRealText = runtimeSnapshot
      ? !!runtimeSnapshot.hasText
      : (typeof ComposerApi.hasRealComposerText === 'function'
        ? ComposerApi.hasRealComposerText()
        : hasText);
    const sendButton = runtimeSnapshot && runtimeSnapshot.sendButton instanceof HTMLButtonElement
      ? runtimeSnapshot.sendButton
      : ComposerApi.findSendButton({ silent: true, skipNestedComposerResolve: true });
    const hasRealBtn = runtimeSnapshot
      ? !!runtimeSnapshot.realSendButtonEnabled
      : (typeof ComposerApi.hasRealSubmitButton === 'function'
        ? ComposerApi.hasRealSubmitButton()
        : false);
    const canAcceptInput = composerAvailable && !isResponding;
    const realSendButtonEnabled = !!(
      sendButton
      && hasRealBtn
      && (
        typeof ComposerApi.isSendButtonReady === 'function'
          ? ComposerApi.isSendButtonReady(sendButton)
          : true
      )
    );
    const sendable = hasRealText || hasAttachmentPayload || realSendButtonEnabled;
    const hasPayload = sendable;
    const canSendNow = composerAvailable
      && !isResponding
      && sendable
      && (
        hasRealText
          ? hasRealBtn
          : ((hasAttachmentPayload || realSendButtonEnabled) && hasRealBtn)
      );

    if (isResponding) {
      return {
        is_responding: true,
        response_state: 'generating',
        response_state_reason: 'assistant_busy',
        can_accept_input: false,
        can_send_now: false,
        has_composer_payload: hasAttachmentPayload || !!composerText,
        response_state_at: Date.now(),
      };
    }

    if (!composerAvailable) {
      return {
        is_responding: false,
        response_state: 'no_composer',
        response_state_reason: 'composer_not_found',
        can_accept_input: false,
        can_send_now: false,
        has_composer_payload: hasAttachmentPayload || !!composerText,
        response_state_at: Date.now(),
      };
    }

    if (!hasPayload) {
      return {
        is_responding: false,
        response_state: 'idle',
        response_state_reason: 'empty_composer',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        composer_text_len: composerTextTrimmed.length,
        has_composer_payload: false,
        response_state_at: Date.now(),
      };
    }

    if (!hasRealText && hasAttachmentPayload) {
      const stillUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
        && ComposerApi.isAttachmentStillUploading();

      if (stillUploading && !realSendButtonEnabled) {
        return {
          is_responding: false,
          response_state: 'attachment_processing',
          response_state_reason: 'attachment_processing',
          can_accept_input: canAcceptInput,
          can_send_now: false,
          attachment_count: attachmentCount,
          has_composer_payload: true,
          response_state_at: Date.now(),
        };
      }

      if (realSendButtonEnabled) {
        return {
          is_responding: false,
          response_state: 'ready',
          response_state_reason: 'attachment_only_send',
          can_accept_input: canAcceptInput,
          can_send_now: true,
          attachment_count: attachmentCount,
          has_composer_payload: true,
          response_state_at: Date.now(),
        };
      }

      return {
        is_responding: false,
        response_state: 'attachment_processing',
        response_state_reason: 'attachment_ready_but_send_button_missing',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

    if (!hasRealBtn) {
      const stillUploadingText = typeof ComposerApi.isAttachmentStillUploading === 'function'
        && ComposerApi.isAttachmentStillUploading();
      return {
        is_responding: false,
        response_state: hasAttachmentPayload ? 'attachment_processing' : 'not_ready',
        response_state_reason: hasRealText
          ? 'send_button_not_found'
          : (hasAttachmentPayload
            ? (stillUploadingText ? 'attachment_processing' : 'attachment_ready_but_send_button_missing')
            : 'send_button_not_found'),
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        composer_text_len: composerTextTrimmed.length,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

    const sendButtonDisabled = sendButton instanceof HTMLButtonElement && sendButton.disabled;
    if (sendButtonDisabled) {
      return {
        is_responding: false,
        response_state: 'not_ready',
        response_state_reason: 'send_button_disabled_with_payload',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

    if (!canSendNow) {
      return {
        is_responding: false,
        response_state: 'not_ready',
        response_state_reason: 'send_button_not_ready',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

      const result = {
        is_responding: false,
        response_state: 'ready',
        response_state_reason: 'payload_ready',
        can_accept_input: canAcceptInput,
        can_send_now: true,
        attachment_count: attachmentCount,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
      responseStateCache.at = Date.now();
      responseStateCache.key = responseCacheKey;
      responseStateCache.value = result;
      return result;
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] detectComposerResponseState failed', error);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[COMPOSER][DETECT_ERROR] scope=detectComposerResponseState error=${errText}`);
      }
      return rememberResponseState(responseCacheKey, detectComposerResponseStateLight());
    } finally {
      composerDetecting = false;
      detectComposerResponseStateDepth = Math.max(0, detectComposerResponseStateDepth - 1);
      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - perfStartedAt,
      );
      if (costMs > 80) {
        const line = `[PERF][detectComposerResponseState] cost=${costMs}ms light=${lightMode ? 1 : 0} reason=${reasonText}`;
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(line);
        } else {
          console.warn(line);
        }
      }
    }
  }

  function safeDetectComposerResponseState(options = {}) {
    try {
      return detectComposerResponseState(options);
    } catch (error) {
      console.error('[COMPOSER][DETECT_ERROR]', error);
      const errText = error && error.message ? error.message : String(error);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COMPOSER][DETECT_ERROR] reason=${String(options && options.reason ? options.reason : '-')} `
          + `type=${error && error.name ? error.name : 'Error'} error=${errText}`,
        );
      }
      return {
        is_responding: false,
        response_state: 'unknown',
        response_state_reason: 'detect-error',
        reason: 'detect-error',
        can_accept_input: false,
        can_send_now: false,
        has_composer: false,
        has_composer_payload: false,
        attachment_count: 0,
        error: errText,
        response_state_at: Date.now(),
      };
    }
  }

  function isRealSendButtonEnabled(sendButton) {
    if (!(sendButton instanceof HTMLButtonElement)) {
      return false;
    }

    if (typeof ComposerApi.isSendButtonReady === 'function') {
      return ComposerApi.isSendButtonReady(sendButton);
    }

    return !isSendButtonDisabled(sendButton);
  }

  function evaluateComposerSendability(sendButtonInput, precomputed = {}) {
    const opts = precomputed && typeof precomputed === 'object' ? precomputed : {};
    const runtimeSnapshot = (
      !opts.composerText
      && typeof ComposerApi !== 'undefined'
      && typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
    )
      ? ComposerApi.getComposerRuntimeSnapshotLight(450)
      : null;
    const composerText = opts.composerText != null
      ? String(opts.composerText || '')
      : (runtimeSnapshot
        ? String(runtimeSnapshot.composerText || '')
        : (typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : ''));
    const textLen = composerText.trim().length;
    const hasAttachment = opts.attachmentState && typeof opts.attachmentState === 'object'
      ? !!(opts.attachmentState.hasAny || opts.attachmentState.hasAttachment || opts.attachmentState.hasComposerPayload)
      : (runtimeSnapshot
        ? !!runtimeSnapshot.hasAttachmentPayload
        : (typeof ComposerApi.hasComposerAttachmentUnified === 'function'
          ? ComposerApi.hasComposerAttachmentUnified()
          : hasComposerAttachment()));

    const sendButton = opts.sendButton instanceof HTMLButtonElement
      ? opts.sendButton
      : (sendButtonInput instanceof HTMLButtonElement
        ? sendButtonInput
        : (runtimeSnapshot && runtimeSnapshot.sendButton instanceof HTMLButtonElement
          ? runtimeSnapshot.sendButton
          : findChatGPTSendButton()));
    const realSendButtonEnabled = runtimeSnapshot && !opts.sendButton && !sendButtonInput
      ? !!runtimeSnapshot.realSendButtonEnabled
      : isRealSendButtonEnabled(sendButton);
    const hasContent = textLen > 0 || hasAttachment;
    const sendable = hasContent && realSendButtonEnabled;
    const responseState = opts.responseState && typeof opts.responseState === 'object'
      ? opts.responseState
      : detectComposerResponseState({ reason: 'evaluateComposerSendability' });

    let sendModeReason = '';
    if (textLen > 0) {
      sendModeReason = 'text_send';
    } else if (hasAttachment) {
      sendModeReason = 'attachment_only_send';
    } else if (realSendButtonEnabled) {
      sendModeReason = 'native_send_button_enabled_without_text';
    }

    return {
      textLen,
      hasAttachment,
      hasContent,
      realSendButtonEnabled,
      sendable,
      canSendNow: sendable,
      sendModeReason,
      response_state: String(responseState.response_state || 'unknown'),
      response_state_reason: String(responseState.response_state_reason || '-'),
      sendButton,
    };
  }

  const ReplyDoneTitleFlashWatcher = (() => {
    let started = false;
    let timer = 0;
    let wasBusy = false;
    let lastFlashAt = 0;

    function check(reason = '') {
      let busy = false;

      try {
        busy = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] reply done title flash check failed', err);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[TITLE_FLASH][check-failed] reason=${reason || '-'} error=${errText}`);
        }
        return;
      }

      if (busy) {
        if (!wasBusy
          && typeof ResponseDoneNotifyModule !== 'undefined'
          && typeof ResponseDoneNotifyModule.acknowledgeResponseDoneNotification === 'function') {
          ResponseDoneNotifyModule.acknowledgeResponseDoneNotification('assistant-started');
        }
        if (!wasBusy
          && typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
          TitlePrefixModule.setToolboxTabTitleState('responding', 'response-started');
        }
        if (!wasBusy
          && typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.stopHeaderTitleFlash === 'function') {
          ToolboxShell.stopHeaderTitleFlash('assistant-started');
        }
        if (!wasBusy) {
          ChatInputStateRuntime.waitingForReply = false;
        }
        wasBusy = true;
        updateChatInputStateBadge();
        return;
      }

      if (wasBusy) {
        wasBusy = false;
        ChatInputStateRuntime.waitingForReply = false;

        const now = Date.now();
        if (now - lastFlashAt < 1500) {
          updateChatInputStateBadge();
          return;
        }

        lastFlashAt = now;
        const titleFlashReason = `response-finished:${reason || '-'}`;
        if (typeof ResponseDoneNotifyModule !== 'undefined'
          && typeof ResponseDoneNotifyModule.startResponseDoneNotify === 'function') {
          ResponseDoneNotifyModule.startResponseDoneNotify(titleFlashReason);
        } else if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
          TitlePrefixModule.setToolboxTabTitleState('reply_done', titleFlashReason);
        } else if (typeof TitlePrefixModule.startReplyDoneFlash === 'function') {
          TitlePrefixModule.startReplyDoneFlash(titleFlashReason);
        }

        refreshToolboxPageStatusDisplay(`assistant-finished:${reason || '-'}`);

        if (typeof renderToolboxHeaderStatus === 'function') {
          renderToolboxHeaderStatus(`assistant-finished:${reason || '-'}`);
        }
      }

      updateChatInputStateBadge();
    }

    function start() {
      if (started) {
        return;
      }

      started = true;
      wasBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      timer = window.setInterval(() => {
        check('interval');
      }, 1000);

      document.addEventListener('visibilitychange', () => {
        check('visibilitychange');
      }, true);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TITLE_FLASH][watcher-start] busy=${wasBusy ? '1' : '0'}`);
      }
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }

      started = false;
      wasBusy = false;
      if (typeof ResponseDoneNotifyModule !== 'undefined'
        && typeof ResponseDoneNotifyModule.acknowledgeResponseDoneNotification === 'function') {
        ResponseDoneNotifyModule.acknowledgeResponseDoneNotification('watcher-stop');
      } else if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
        TitlePrefixModule.setToolboxTabTitleState('idle', 'watcher-stop');
      } else if (typeof TitlePrefixModule.stopReplyDoneFlash === 'function') {
        TitlePrefixModule.stopReplyDoneFlash('watcher-stop');
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.stopHeaderTitleFlash === 'function') {
        ToolboxShell.stopHeaderTitleFlash('watcher-stop');
      }
    }

    return {
      start,
      stop,
      check,
    };
  })();

  /** Flask 为当前页分配的展示编号（仅来自 poll 响应 page_display_id）。 */
  const BRIDGE_STATE = {
    page_display_id: '',
    /** 当前页面对话轮次（DOM 观测或 poll 响应同步，供自动指令等模块只读使用）。 */
    page_turn_count: null,
  };

  let lastPageDisplayIdMissingWarnAt = 0;
  const PAGE_DISPLAY_ID_MISSING_WARN_MS = 15000;

  const BridgePollRuntime = {
    bridge_connected: false,
    last_poll_ok: null,
    last_poll_error: '',
    last_poll_at: 0,
  };

  const MESSAGE_STATUS = Object.freeze({
    QUEUED: 'queued',
    DISPATCHING: 'dispatching',
    BROWSER_SENT: 'browser_sent',
    WAITING_REPLY: 'waiting_reply',
    DONE: 'done',
    FAILED: 'failed',
  });

  const ASSISTANT_STATUS = Object.freeze({
    QUEUED_PLACEHOLDER: 'queued_placeholder',
    WAITING_REPLY: 'waiting_reply',
    DONE: 'done',
  });

  function createQueuedMessageEntry(normalized) {
    const messageId = normalized.message_id || normalized.id || '';
    return {
      message_id: messageId,
      session_id: String(normalized.session_id || '').trim(),
      turn_id: String(normalized.turn_id || '').trim(),
      content: String(normalized.content || '').trim(),
      status: MESSAGE_STATUS.QUEUED,
      request_id: normalized.request_id || '',
      created_at: Date.now(),
      retry_count: 0,
    };
  }

  const CHAT_QUEUE = [];
  const CHAT_QUEUE_MAX_SIZE = 50;
  const CHAT_QUEUE_MAX_AGE_MS = 10 * 60 * 1000;

  function pruneChatQueue(reason = '') {
    const now = Date.now();
    for (let i = CHAT_QUEUE.length - 1; i >= 0; i -= 1) {
      const entry = CHAT_QUEUE[i];
      const age = now - Number((entry && entry.created_at) || 0);
      if (!entry || !entry.message_id || age > CHAT_QUEUE_MAX_AGE_MS) {
        CHAT_QUEUE.splice(i, 1);
      }
    }
    while (CHAT_QUEUE.length > CHAT_QUEUE_MAX_SIZE) {
      const dropped = CHAT_QUEUE.shift();
      ToolboxShell.appendLog(
        `[CHAT_QUEUE][DROP_OLDEST] reason=${reason || '-'} message_id=${String((dropped && dropped.message_id) || '').slice(0, 8)}`,
      );
    }
  }

  function enqueueChatQueueEntry(normalized, reason = '') {
    pruneChatQueue(reason);
    const messageId = normalized.message_id || normalized.id || '';
    if (messageId && CHAT_QUEUE.some((entry) => entry && entry.message_id === messageId)) {
      ToolboxShell.appendLog(
        `[CHAT_QUEUE][DUP_SKIP] reason=${reason || '-'} message_id=${String(messageId).slice(0, 8)}`,
      );
      return {
        ok: true,
        queued: false,
        duplicate: true,
        entry: null,
      };
    }
    if (CHAT_QUEUE.length >= CHAT_QUEUE_MAX_SIZE) {
      const dropped = CHAT_QUEUE.shift();
      ToolboxShell.appendLog(
        `[CHAT_QUEUE][DROP_OLDEST] reason=max-size message_id=${String((dropped && dropped.message_id) || '').slice(0, 8)}`,
      );
    }
    const entry = createQueuedMessageEntry(normalized);
    CHAT_QUEUE.push(entry);
    return {
      ok: true,
      queued: true,
      duplicate: false,
      entry,
    };
  }

  const ChatInputStateRuntime = {
    waitingForReply: false,
    sendInProgress: false,
    lastTopStatusText: '',
    lastTopStatusType: '',
    pendingTurnId: '',
    pendingRequestId: '',
  };

  function hasPendingReply(sessionId) {
    if (ChatInputStateRuntime.waitingForReply) {
      return true;
    }

    const activeCount = CHAT_QUEUE.filter((entry) => {
      if (entry.status === MESSAGE_STATUS.QUEUED) return false;
      if (entry.status === ASSISTANT_STATUS.QUEUED_PLACEHOLDER) return false;
      if (!entry.status || entry.status === MESSAGE_STATUS.DONE || entry.status === MESSAGE_STATUS.FAILED) return false;
      return true;
    }).length;

    const ignoredQueued = CHAT_QUEUE.filter((e) => e.status === MESSAGE_STATUS.QUEUED).length;
    const pendingIds = CHAT_QUEUE
      .filter((e) => e.status !== MESSAGE_STATUS.QUEUED && e.status !== MESSAGE_STATUS.DONE && e.status !== MESSAGE_STATUS.FAILED)
      .map((e) => e.message_id);

    const decision = activeCount > 0 ? 'wait' : 'process';
    try {
      const perfInc = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__CGPT_TOOLBOX_PERF_INC__;
      if (typeof perfInc === 'function') {
        perfInc('chatQueue.pendingCheck', 1);
      }
    } catch (e) {
      // ignore
    }

    const logLine =
      `[CHAT_QUEUE][PENDING_CHECK]`
      + ` session_id=${sessionId || '-'}`
      + ` queue_size=${CHAT_QUEUE.length}`
      + ` active_pending_count=${activeCount}`
      + ` ignored_queued_count=${ignoredQueued}`
      + ` pending_message_ids=${pendingIds.join(',') || '-'}`
      + ` decision=${decision}`;

    // 空队列 + 无 pending：不应持续刷屏；仅状态变化时输出，或每 5s 至多一次（便于诊断）
    const isIdle = CHAT_QUEUE.length === 0 && activeCount === 0;
    const stateKey = `${sessionId || '-'}|q=${CHAT_QUEUE.length}|p=${activeCount}|iq=${ignoredQueued}|ids=${pendingIds.join(',') || '-'}`;
    if (isIdle && typeof ToolboxShell.appendLogIfChanged === 'function') {
      ToolboxShell.appendLogIfChanged(
        'CHAT_QUEUE:PENDING_CHECK:idle-state',
        stateKey,
        logLine,
        5000,
      );
    } else if (typeof ToolboxShell.appendLogThrottled === 'function') {
      // 非空闲：仍可能较频繁，默认 2s 节流
      ToolboxShell.appendLogThrottled(
        'CHAT_QUEUE:PENDING_CHECK:active',
        logLine,
        2000,
      );
    } else {
      ToolboxShell.appendLog(logLine);
    }

    return activeCount > 0;
  }

  function findQueuedEntryByMessageId(messageId) {
    return CHAT_QUEUE.find((entry) => entry.message_id === messageId) || null;
  }

  function updateQueuedEntryStatus(messageId, status, extra) {
    const entry = findQueuedEntryByMessageId(messageId);
    if (!entry) return;
    entry.status = status;
    if (extra && typeof extra === 'object') {
      Object.assign(entry, extra);
    }
  }

  function releasePendingReplyState(reason, messageId, extra) {
    const requestId = String(extra && extra.request_id ? extra.request_id : '').trim() || ChatInputStateRuntime.pendingRequestId;
    const turnId = String(extra && extra.turn_id ? extra.turn_id : '').trim() || ChatInputStateRuntime.pendingTurnId;

    ChatInputStateRuntime.waitingForReply = false;
    ChatInputStateRuntime.sendInProgress = false;
    ChatInputStateRuntime.pendingTurnId = '';
    ChatInputStateRuntime.pendingRequestId = '';

    if (messageId) {
      updateQueuedEntryStatus(messageId, MESSAGE_STATUS.DONE);
    }

    ToolboxShell.appendLog(
      `[CHAT][PENDING_RELEASE]`
      + ` reason=${reason || '-'}`
      + ` request_id=${requestId || '-'}`
      + ` turn_id=${turnId || '-'}`
      + ` released=true`
    );

    updateChatInputStateBadge();
  }

  function warnPageDisplayIdMissingInResponse(result) {
    const now = Date.now();
    if (now - lastPageDisplayIdMissingWarnAt < PAGE_DISPLAY_ID_MISSING_WARN_MS) {
      return;
    }
    lastPageDisplayIdMissingWarnAt = now;
    console.warn('[TOOLBOX][PAGE_DISPLAY_ID_MISSING_IN_RESPONSE]', {
      response_keys: Object.keys(result || {}),
    });
  }

  function applyBridgeStateFromPollResult(result, reason = '') {
    if (
      typeof AutoQueueModule !== 'undefined'
      && typeof AutoQueueModule.shouldPauseWaitingReplyForInvalidPageContext === 'function'
      && AutoQueueModule.shouldPauseWaitingReplyForInvalidPageContext('bridge-poll')
    ) {
      return;
    }

    if (!result || typeof result !== 'object') {
      return;
    }

    if (typeof BRIDGE_STATE !== 'undefined' && BRIDGE_STATE) {
      if (result.orch_button_views && typeof result.orch_button_views === 'object') {
        BRIDGE_STATE.orch_button_views = result.orch_button_views;
      }
      if (result.orch_active_runs && Array.isArray(result.orch_active_runs)) {
        BRIDGE_STATE.orch_active_runs = result.orch_active_runs;
      }
      BRIDGE_STATE.orch_enabled = result.orch_enabled === true || result.orchEnabled === true;
    }

    const nextPageDisplayId =
      result.page_display_id
      ?? result.pageDisplayId
      ?? result.page_no
      ?? result.pageNo
      ?? (result.page && (result.page.page_display_id ?? result.page.page_no))
      ?? (result.runtime && (result.runtime.page_display_id ?? result.runtime.page_no))
      ?? null;

    if (
      nextPageDisplayId !== null
      && nextPageDisplayId !== undefined
      && String(nextPageDisplayId).trim() !== ''
    ) {
      const prev = String(BRIDGE_STATE.page_display_id || '').trim();
      const nextText = String(nextPageDisplayId).trim();
      if (nextText !== prev) {
        console.log('[TOOLBOX][PAGE_DISPLAY_ID]', {
          old_page_display_id: prev || '-',
          new_page_display_id: nextText,
          response_page_display_id: result.page_display_id,
          response_page_no: result.page_no,
        });
      }
      BRIDGE_STATE.page_display_id = nextText;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BRIDGE_STATE][page_display_id] reason=${reason || '-'} value=${nextText}`,
        );
      }
    } else {
      warnPageDisplayIdMissingInResponse(result);
    }

    const pollTurnCount = extractTurnCountFromPollResult(result);
    if (pollTurnCount !== null) {
      syncBridgePageTurnCount(pollTurnCount, reason || 'bridge-poll');
    }

    refreshToolboxPageStatusDisplay(reason || 'bridge-poll');

    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.reconcilePendingSendTaskAfterExternalNativeSend === 'function'
    ) {
      try {
        UploadModule.reconcilePendingSendTaskAfterExternalNativeSend('bridge-poll');
      } catch (reconcileErr) {
        console.error('[ChatGPT toolbox] bridge-poll reconcile failed', reconcileErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[SEND_TASK][RECONCILE_ERROR] reason=bridge-poll error=${reconcileErr && reconcileErr.message ? reconcileErr.message : String(reconcileErr)}`,
          );
        }
      }
    }

    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.maybeReconcileSendCopyHotkeyWaitingReply === 'function'
    ) {
      try {
        UploadModule.maybeReconcileSendCopyHotkeyWaitingReply('bridge-poll');
      } catch (sendCopyHotkeyReconcileErr) {
        console.error('[ChatGPT toolbox] bridge-poll send-copy-hotkey reconcile failed', sendCopyHotkeyReconcileErr);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[SEND_COPY_HOTKEY][RECONCILE_ERROR] reason=bridge-poll error=${sendCopyHotkeyReconcileErr && sendCopyHotkeyReconcileErr.message ? sendCopyHotkeyReconcileErr.message : String(sendCopyHotkeyReconcileErr)}`,
          );
        }
      }
    }
  }

  function extractTurnCountFromPollResult(result) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const raw = result.turn_count
      ?? result.turnCount
      ?? (result.page && (result.page.turn_count ?? result.page.turnCount))
      ?? (result.runtime && (result.runtime.turn_count ?? result.runtime.turnCount))
      ?? null;

    if (raw === null || raw === undefined || raw === '') {
      return null;
    }

    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }

    return Math.floor(n);
  }

  function notifyAutoQueueProgressStatusRefresh(reason = '') {
    if (
      typeof AutoQueueModule !== 'undefined'
      && typeof AutoQueueModule.refreshProgressStatus === 'function'
    ) {
      AutoQueueModule.refreshProgressStatus(reason);
    }
  }

  function syncBridgePageTurnCount(nextCount, reason = '') {
    const prev = BRIDGE_STATE.page_turn_count ?? BRIDGE_STATE.turn_count ?? BRIDGE_STATE.turnCount ?? null;
    const normalized = nextCount === null || nextCount === undefined
      ? null
      : (Number.isFinite(Number(nextCount)) && Number(nextCount) > 0
        ? Math.floor(Number(nextCount))
        : null);

    BRIDGE_STATE.page_turn_count = normalized;

    if (prev !== normalized) {
      notifyAutoQueueProgressStatusRefresh(reason || 'page-turn-changed');
    }
  }

  function refreshToolboxPageStatusDisplay(reason = '') {
    invalidateConversationStatsCache(reason || 'toolbox-page-status');

    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.refreshToolboxTopStatus === 'function'
    ) {
      UploadModule.refreshToolboxTopStatus(reason);
    }

    if (typeof getConversationTurnCount === 'function') {
      const liveCount = Number(getConversationTurnCount());
      syncBridgePageTurnCount(
        Number.isFinite(liveCount) && liveCount > 0 ? liveCount : null,
        reason || 'toolbox-page-status',
      );
    }

    updateChatInputStateBadge();
  }

  function getBridgePageDisplayIdText() {
    const raw = String(BRIDGE_STATE.page_display_id || '').trim();
    if (raw) {
      return raw;
    }

    const pathname = String(location && location.pathname ? location.pathname : '');
    let conversationId = '';

    if (typeof parseConversationIdFromPath === 'function') {
      try {
        conversationId = String(parseConversationIdFromPath(pathname) || '');
      } catch (err) {
        console.error('[ChatGPT toolbox] parseConversationIdFromPath failed', err);
      }
    }

    if (!conversationId) {
      const match = pathname.match(/\/c\/([^/?#]+)/);
      conversationId = match && match[1] ? String(match[1]) : '';
    }

    if (conversationId) {
      const display = String(conversationId).slice(0, 8);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BRIDGE_STATE][page_display_id_fallback] conversation_id=${conversationId} display=${display}`,
        );
      } else {
        console.log(
          `[BRIDGE_STATE][page_display_id_fallback] conversation_id=${conversationId} display=${display}`,
        );
      }

      return display;
    }

    return '-';
  }

  let toolboxTurnStatusRefreshTimer = 0;
  let toolboxTurnStatusRefreshPendingMode = 'light';
  let lastLoggedConversationTurnCount = null;
  let lastToolboxLightRefreshAt = 0;
  let conversationStatsCache = null;
  let conversationStatsDirty = false;
  let conversationStatsMutationVersion = 0;

  const TOOLBOX_HEAVY_REFRESH_REASONS = new Set([
    'route-change',
    'message-sent',
    'assistant-finished',
    'manual-refresh',
    'bridge-sync-conversation',
    'observer-bound',
  ]);
  const TOOLBOX_LIGHT_REFRESH_MIN_MS = 1500;

  function invalidateConversationStatsCache(reason = '') {
    conversationStatsCache = null;
    conversationStatsDirty = true;
    void reason;
  }

  function markConversationStatsDirty() {
    conversationStatsDirty = true;
    conversationStatsMutationVersion += 1;
  }

  function isToolboxHeavyRefreshReason(reason = '') {
    const safeReason = String(reason || '').trim().toLowerCase();
    if (!safeReason) {
      return false;
    }

    if (TOOLBOX_HEAVY_REFRESH_REASONS.has(safeReason)) {
      return true;
    }

    for (const allowed of TOOLBOX_HEAVY_REFRESH_REASONS) {
      if (safeReason.startsWith(`${allowed}:`) || safeReason.includes(`${allowed}:`)) {
        return true;
      }
    }

    return false;
  }

  function getConversationStatsCacheTtlMs() {
    const isResponding = typeof ComposerApi !== 'undefined'
      && typeof ComposerApi.isAssistantLikelyBusy === 'function'
      && ComposerApi.isAssistantLikelyBusy();
    return isResponding ? 5000 : 3000;
  }

  function getConversationDomScanRoot() {
    const main = document.querySelector('main');
    if (main instanceof HTMLElement) {
      return main;
    }

    return document.body instanceof HTMLElement ? document.body : null;
  }

  function computeLightConversationStatsFromDom() {
    const root = getConversationDomScanRoot();
    if (!(root instanceof HTMLElement)) {
      return {
        total_count: 0,
        round_count: 0,
        dom_estimated_round_count: 0,
        user_count: 0,
        assistant_count: 0,
      };
    }

    const turns = Array.from(
      root.querySelectorAll(
        'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
      ),
    ).filter((el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }

      if (typeof isValidConversationTurnCounterElement === 'function') {
        return isValidConversationTurnCounterElement(el);
      }

      if (typeof isInToolbox === 'function' && isInToolbox(el)) {
        return false;
      }

      const testId = String(el.getAttribute('data-testid') || '').trim();
      return /^conversation-turn-\d+$/i.test(testId);
    });

    let maxTurnNo = 0;
    let userCount = 0;
    let assistantCount = 0;
    const seenTurnNo = new Set();

    turns.forEach((el) => {
      const turnNo = getConversationTurnNumberFromElement(el);
      if (!(turnNo > 0)) {
        return;
      }

      if (turnNo > maxTurnNo) {
        maxTurnNo = turnNo;
      }

      if (seenTurnNo.has(turnNo)) {
        return;
      }

      seenTurnNo.add(turnNo);
      const role = getConversationTurnRoleFromElement(el);
      if (role === 'user') {
        userCount += 1;
      } else if (role === 'assistant') {
        assistantCount += 1;
      }
    });

    const highestRole = maxTurnNo > 0
      ? (maxTurnNo % 2 === 1 ? 'user' : 'assistant')
      : '';
    const estimatedRoundCount = maxTurnNo > 0
      ? estimateRoundCountByTurnNumber(maxTurnNo, highestRole)
      : 0;

    return {
      total_count: turns.length,
      round_count: estimatedRoundCount,
      dom_estimated_round_count: estimatedRoundCount,
      user_count: userCount,
      assistant_count: assistantCount,
    };
  }

  function getCachedConversationStatsForHeader() {
    if (!conversationStatsCache) {
      return null;
    }

    return {
      total_count: conversationStatsCache.totalCount,
      round_count: conversationStatsCache.roundCount,
      dom_estimated_round_count: conversationStatsCache.roundCount,
      user_count: conversationStatsCache.userCount,
      assistant_count: conversationStatsCache.assistantCount,
    };
  }

  function getEmptyLightConversationStats() {
    return {
      total_count: 0,
      round_count: 0,
      dom_estimated_round_count: 0,
      user_count: 0,
      assistant_count: 0,
    };
  }

  function isConversationStatsPerfLogEnabled() {
    if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
      if (MemoryManager.get('bridgeDebugEnabled', false)) {
        return true;
      }
    }

    if (typeof getCompactUiConfig === 'function') {
      const cfg = getCompactUiConfig();
      if (cfg && cfg.taskQueueSettings && cfg.taskQueueSettings.debugMode) {
        return true;
      }
    }

    return false;
  }

  function getLightConversationStatsForHeader(options = {}) {
    const force = options.force === true;
    const cacheOnly = options.cacheOnly === true;
    const preferCache = options.preferCache !== false;
    const now = Date.now();
    const url = String(typeof location !== 'undefined' && location.href ? location.href : '');

    if (cacheOnly) {
      return getCachedConversationStatsForHeader() || getEmptyLightConversationStats();
    }

    if (!force && conversationStatsCache) {
      const urlMatch = conversationStatsCache.url === url;
      if (urlMatch) {
        if (preferCache) {
          return getCachedConversationStatsForHeader();
        }

        const age = now - Number(conversationStatsCache.at || 0);
        const ttl = getConversationStatsCacheTtlMs();
        if (!conversationStatsDirty && age < ttl) {
          return getCachedConversationStatsForHeader();
        }
      }
    }

    const startedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const stats = computeLightConversationStatsFromDom();
    const costMs = Math.round(
      ((typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()) - startedAt,
    );

    conversationStatsCache = {
      at: now,
      url,
      mutationVersion: conversationStatsMutationVersion,
      roundCount: Number(stats.dom_estimated_round_count) || 0,
      userCount: Number(stats.user_count) || 0,
      assistantCount: Number(stats.assistant_count) || 0,
      totalCount: Number(stats.total_count) || 0,
    };
    conversationStatsDirty = false;

    if (typeof logPerfIfSlow === 'function' && isConversationStatsPerfLogEnabled()) {
      logPerfIfSlow(
        'getLightConversationStatsForHeader',
        `[PERF][getLightConversationStatsForHeader] cost=${costMs}ms turns=${stats.total_count}`,
        costMs,
        80,
      );
    }

    return stats;
  }

  if (typeof window !== 'undefined') {
    window.getCachedConversationStatsForHeader = getCachedConversationStatsForHeader;
    window.getLightConversationStatsForHeader = getLightConversationStatsForHeader;
  }

  function countTurnsFromDomDirect(role) {
    const safeRole = String(role || '').trim();
    if (!safeRole) {
      return 0;
    }

    const root = getConversationDomScanRoot();
    if (!(root instanceof HTMLElement)) {
      return 0;
    }

    const seen = new Set();
    let count = 0;

    root.querySelectorAll(
      'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
    ).forEach((turn) => {
      if (!(turn instanceof HTMLElement)) {
        return;
      }

      if (isInToolbox(turn)) {
        return;
      }

      if (isInComposerArea(turn)) {
        return;
      }

      if (isChatSidebarElement(turn)) {
        return;
      }

      const turnRole = getConversationTurnRoleFromElement(turn);
      if (turnRole !== safeRole) {
        return;
      }

      if (seen.has(turn)) {
        return;
      }

      seen.add(turn);
      count += 1;
    });

    return count;
  }

  function countUserTurnsFromDomDirect() {
    return countTurnsFromDomDirect('user');
  }

  function countAssistantTurnsFromDomDirect() {
    return countTurnsFromDomDirect('assistant');
  }

  function extractConversationTurnNumberFromId(value) {
    const text = String(value || '').trim();
    const match = text.match(/conversation-turn-(\d+)/i);
    if (!match) {
      return 0;
    }
    const turnNo = Number(match[1]);
    return Number.isFinite(turnNo) && turnNo > 0 ? Math.floor(turnNo) : 0;
  }

  function getConversationTurnNumberFromElement(el) {
    if (!(el instanceof HTMLElement)) {
      return 0;
    }

    const directId = el.getAttribute('data-testid');
    if (directId) {
      const directNo = extractConversationTurnNumberFromId(directId);
      if (directNo > 0) {
        return directNo;
      }
    }

    const turnEl = el.closest(
      'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
    );
    if (turnEl instanceof HTMLElement) {
      return extractConversationTurnNumberFromId(turnEl.getAttribute('data-testid'));
    }

    return 0;
  }

  function getConversationTurnRoleFromElement(turnEl) {
    if (!(turnEl instanceof HTMLElement)) {
      return '';
    }

    if (typeof getMessageRole === 'function') {
      const fromHelper = String(getMessageRole(turnEl) || '').toLowerCase();
      if (fromHelper === 'user' || fromHelper === 'assistant') {
        return fromHelper;
      }
    }

    const roleNode = turnEl.querySelector('[data-message-author-role]');
    if (roleNode) {
      const role = String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
      if (role === 'user' || role === 'assistant') {
        return role;
      }
    }

    if (turnEl.querySelector('[data-message-author-role="user"]')) {
      return 'user';
    }

    if (
      turnEl.querySelector(
        '[data-message-author-role="assistant"], .markdown, [data-message-content]',
      )
    ) {
      return 'assistant';
    }

    const turnNo = getConversationTurnNumberFromElement(turnEl);
    if (turnNo > 0) {
      return turnNo % 2 === 1 ? 'user' : 'assistant';
    }

    return '';
  }

  function isValidConversationTurnCounterElement(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    if (typeof isInToolbox === 'function' && isInToolbox(el)) {
      return false;
    }

    if (typeof isInComposerArea === 'function' && isInComposerArea(el)) {
      return false;
    }

    if (typeof isChatSidebarElement === 'function' && isChatSidebarElement(el)) {
      return false;
    }

    const testId = String(el.getAttribute('data-testid') || '').trim();
    if (!/^conversation-turn-\d+$/i.test(testId)) {
      return false;
    }

    return extractConversationTurnNumberFromId(testId) > 0;
  }

  function collectConversationTurnIndexInfos() {
    const byTurnNo = new Map();
    const root = getConversationDomScanRoot();

    if (!(root instanceof HTMLElement)) {
      return [];
    }

    root.querySelectorAll(
      'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]',
    ).forEach((el) => {
      if (!isValidConversationTurnCounterElement(el)) {
        return;
      }

      const turnNo = getConversationTurnNumberFromElement(el);
      if (!(turnNo > 0)) {
        return;
      }

      const role = getConversationTurnRoleFromElement(el);
      const existing = byTurnNo.get(turnNo);

      if (!existing) {
        byTurnNo.set(turnNo, { turnNo, role, element: el });
        return;
      }

      if (!existing.role && role) {
        byTurnNo.set(turnNo, { turnNo, role, element: el });
      }
    });

    return Array.from(byTurnNo.values()).sort((a, b) => a.turnNo - b.turnNo);
  }

  function estimateRoundCountByTurnNumber(turnNo, role) {
    const n = Number(turnNo);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }

    const safeRole = String(role || '').toLowerCase();
    if (safeRole === 'user') {
      return Math.ceil(n / 2);
    }
    if (safeRole === 'assistant') {
      return Math.floor(n / 2);
    }

    return n % 2 === 1 ? Math.ceil(n / 2) : Math.floor(n / 2);
  }

  function inferRoleForHighestTurnInfo(highest, infos) {
    if (!highest) {
      return '';
    }

    if (highest.role === 'user' || highest.role === 'assistant') {
      return highest.role;
    }

    if (Array.isArray(infos) && infos.length) {
      const anchor = infos.find((info) => info && (info.role === 'user' || info.role === 'assistant'));
      if (anchor && anchor.turnNo > 0) {
        const oddIsUser = (anchor.turnNo % 2 === 1) === (anchor.role === 'user');
        return oddIsUser
          ? (highest.turnNo % 2 === 1 ? 'user' : 'assistant')
          : (highest.turnNo % 2 === 1 ? 'assistant' : 'user');
      }
    }

    return highest.turnNo % 2 === 1 ? 'user' : 'assistant';
  }

  function countConversationTurnsFromTurnIndex() {
    const infos = collectConversationTurnIndexInfos();
    if (!infos.length) {
      return 0;
    }

    let highest = infos[0];
    infos.forEach((info) => {
      if (info.turnNo > highest.turnNo) {
        highest = info;
      }
    });

    const role = inferRoleForHighestTurnInfo(highest, infos);
    return estimateRoundCountByTurnNumber(highest.turnNo, role);
  }

  function countConversationTurnsFromDom() {
    const fromTurnIndex = countConversationTurnsFromTurnIndex();
    if (fromTurnIndex > 0) {
      return fromTurnIndex;
    }

    const userCount = countUserTurnsFromDomDirect();
    if (userCount > 0) {
      return userCount;
    }

    const assistantCount = countAssistantTurnsFromDomDirect();
    if (assistantCount > 0) {
      return assistantCount;
    }

    return 0;
  }

  function logConversationTurnCountIfChanged(count, reason = '') {
    if (lastLoggedConversationTurnCount === count) {
      return;
    }

    console.log('[TOOLBOX][TURN_COUNT]', {
      old_turn_count: lastLoggedConversationTurnCount,
      new_turn_count: count,
      reason,
    });

    lastLoggedConversationTurnCount = count;
  }

  function executeToolboxTurnStatusRefresh(reason = 'dom-change', modeToRun = 'light') {
    const startedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const isResponding = typeof ComposerApi !== 'undefined'
      && typeof ComposerApi.isAssistantLikelyBusy === 'function'
      && ComposerApi.isAssistantLikelyBusy();

    if (modeToRun === 'heavy') {
      invalidateConversationStatsCache(reason);
    } else {
      lastToolboxLightRefreshAt = Date.now();
    }

    const refreshOptions = {
      skipTurnCount: isResponding && modeToRun !== 'heavy',
    };

    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.refreshToolboxTurnStatus === 'function'
    ) {
      UploadModule.refreshToolboxTurnStatus(reason, modeToRun, refreshOptions);
    } else if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.refreshToolboxTopStatus === 'function'
    ) {
      if (modeToRun === 'heavy') {
        UploadModule.refreshToolboxTopStatus(reason);
      } else if (!refreshOptions.skipTurnCount) {
        UploadModule.refreshToolboxTopStatus(reason, 'light');
      } else if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }

      if (
        modeToRun === 'heavy'
        && typeof UploadModule.renderAllButtonStates === 'function'
      ) {
        UploadModule.renderAllButtonStates({ heavy: true });
      } else if (modeToRun === 'heavy' && typeof UploadModule.renderUploadButtonsOnly === 'function') {
        UploadModule.renderUploadButtonsOnly({ heavy: true });
      }
    } else if (typeof updateChatInputStateBadge === 'function') {
      updateChatInputStateBadge();
    }

    const costMs = Math.round(
      ((typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()) - startedAt,
    );
    if (typeof logPerfIfSlow === 'function') {
      logPerfIfSlow(
        'toolboxTurnStatusRefresh',
        `[PERF][toolboxTurnStatusRefresh] cost=${costMs}ms mode=${modeToRun} reason=${reason}`,
        costMs,
        80,
      );
    }
  }

  function scheduleToolboxTurnStatusRefresh(reason = 'dom-change', mode = 'auto') {
    const safeReason = String(reason || 'dom-change').trim() || 'dom-change';

    if (safeReason === 'conversation-character-data') {
      return;
    }

    let resolvedMode = mode;
    if (mode === 'auto') {
      resolvedMode = isToolboxHeavyRefreshReason(safeReason) ? 'heavy' : 'light';
    }

    if (resolvedMode === 'heavy' && !isToolboxHeavyRefreshReason(safeReason)) {
      resolvedMode = 'light';
    }

    if (resolvedMode === 'heavy') {
      toolboxTurnStatusRefreshPendingMode = 'heavy';
    } else if (toolboxTurnStatusRefreshPendingMode !== 'heavy') {
      toolboxTurnStatusRefreshPendingMode = 'light';
    }

    const now = Date.now();
    const pendingHeavy = toolboxTurnStatusRefreshPendingMode === 'heavy';
    if (!pendingHeavy) {
      const elapsed = now - lastToolboxLightRefreshAt;
      if (elapsed < TOOLBOX_LIGHT_REFRESH_MIN_MS) {
        if (toolboxTurnStatusRefreshTimer) {
          return;
        }

        const delayMs = TOOLBOX_LIGHT_REFRESH_MIN_MS - elapsed;
        toolboxTurnStatusRefreshTimer = window.setTimeout(() => {
          toolboxTurnStatusRefreshTimer = 0;
          const modeToRun = toolboxTurnStatusRefreshPendingMode;
          toolboxTurnStatusRefreshPendingMode = 'light';
          executeToolboxTurnStatusRefresh(safeReason, modeToRun);
        }, delayMs);
        return;
      }
    }

    if (toolboxTurnStatusRefreshTimer) {
      window.clearTimeout(toolboxTurnStatusRefreshTimer);
    }

    const delayMs = pendingHeavy ? 100 : 300;
    toolboxTurnStatusRefreshTimer = window.setTimeout(() => {
      toolboxTurnStatusRefreshTimer = 0;
      const modeToRun = toolboxTurnStatusRefreshPendingMode;
      toolboxTurnStatusRefreshPendingMode = 'light';
      executeToolboxTurnStatusRefresh(safeReason, modeToRun);
    }, delayMs);
  }

  if (typeof window !== 'undefined') {
    window.__cgptScheduleTurnRefresh = scheduleToolboxTurnStatusRefresh;
  }

  function observeConversationTarget(target, reason) {
    if (!(target instanceof HTMLElement)) {
      console.warn('[TOOLBOX][turn_count_observer][failed] reason=target_missing detail=' + (reason || '-'));
      return;
    }

    const uploadCriticalNow = (
      typeof window !== 'undefined'
      && window.__CGPT_TOOLBOX_ENABLE_UPLOAD_CRITICAL_LIGHT_MODE__ !== false
      && typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
      && UploadCriticalRuntime.isUploadCriticalMode()
    );

    let observer = ChatMessageRuntime.conversationObserver;
    const oldTarget = ChatMessageRuntime.conversationObserverTarget;

    if (observer && oldTarget && oldTarget !== target) {
      observer.disconnect();
      if (!uploadCriticalNow && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[TURN_OBSERVER][DISCONNECT_OLD] reason=${reason || '-'}`);
      }
    }

    if (!observer) {
      observer = new MutationObserver((mutations) => {
        markLatestAssistantMessageCacheDirty();
        markConversationStatsDirty();

        const uploadCriticalNow = (
          typeof window !== 'undefined'
          && window.__CGPT_TOOLBOX_ENABLE_UPLOAD_CRITICAL_LIGHT_MODE__ !== false
          && typeof UploadCriticalRuntime !== 'undefined'
          && UploadCriticalRuntime
          && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
          && UploadCriticalRuntime.isUploadCriticalMode()
        );

        const mainNow = document.querySelector('main');
        if (mainNow && mainNow !== ChatMessageRuntime.lastMainNode) {
          ChatMessageRuntime.lastMainNode = mainNow;
          cleanupChatMessageCaches('main-dom-replaced');
          invalidateConversationStatsCache('main-dom-replaced');
          if (!uploadCriticalNow) {
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog('[TURN_OBSERVER][REBOUND_MAIN]');
            }
          }
          observeConversationTarget(mainNow, 'main-dom-replaced');
          if (!uploadCriticalNow) {
            scheduleToolboxTurnStatusRefresh('route-change', 'heavy');
          }
          return;
        }

        const onlyCharacterData = mutations.length > 0
          && mutations.every((mutation) => mutation.type === 'characterData');
        if (onlyCharacterData) {
          return;
        }

        if (uploadCriticalNow) {
          // 上传 critical 期间：仅标记 dirty，暂停触发“轮数统计/顶部重算/按钮重刷新”
          return;
        }

        scheduleToolboxTurnStatusRefresh('conversation-dom-mutated', 'light');
      });

      ChatMessageRuntime.conversationObserver = observer;
      window.__cgptTurnCountObserver = observer;
      window.__cgptTurnCountObserverBound = true;
    }

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: false,
    });

    ChatMessageRuntime.conversationObserverTarget = target;
    if (target.tagName === 'MAIN') {
      ChatMessageRuntime.lastMainNode = target;
    }

    if (!uploadCriticalNow && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[TURN_OBSERVER][BIND] reason=${reason || '-'}`);
    }
  }

  function bindConversationTurnCountObserver() {
    if (ChatMessageRuntime.conversationObserver) {
      return;
    }

    const target = document.querySelector('main') || document.body;
    observeConversationTarget(target, 'initial-bind');
    scheduleToolboxTurnStatusRefresh('observer-bound', 'heavy');
  }

  function getConversationTurnCount() {
    const strategies = [
      { name: 'conversation-turn-index', run: countConversationTurnsFromTurnIndex },
      { name: 'light-header-stats', run: () => {
        const stats = getLightConversationStatsForHeader({ preferCache: true });
        return Number(stats && stats.dom_estimated_round_count) || 0;
      } },
      { name: 'user-role-dom-direct', run: countUserTurnsFromDomDirect },
      { name: 'assistant-role-dom-direct', run: countAssistantTurnsFromDomDirect },
      { name: 'conversation-turn-dom', run: countConversationTurnsFromDom },
    ];

    for (let i = 0; i < strategies.length; i += 1) {
      const strategy = strategies[i];

      try {
        const count = Number(strategy.run());

        if (Number.isFinite(count) && count > 0) {
          return count;
        }
      } catch (error) {
        const errorType = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        console.warn(
          `[TOOLBOX][turn_count][failed] strategy=${strategy.name} error_type=${errorType} error=${errText} stack=${errStack}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX][turn_count][failed] strategy=${strategy.name} error_type=${errorType} error=${errText} stack=${errStack}`,
          );
        }
      }
    }

    return 0;
  }

  function getCurrentPageTurnCount() {
    const live = Number(getConversationTurnCount());
    if (Number.isFinite(live) && live > 0) {
      return Math.floor(live);
    }

    const fromState = BRIDGE_STATE.page_turn_count ?? BRIDGE_STATE.turn_count ?? BRIDGE_STATE.turnCount ?? null;
    if (fromState !== null && fromState !== undefined) {
      const cached = Number(fromState);
      if (Number.isFinite(cached) && cached > 0) {
        return Math.floor(cached);
      }
    }

    return null;
  }

  function updateBridgePollRuntime(patch) {
    if (!patch || typeof patch !== 'object') {
      return;
    }
    Object.assign(BridgePollRuntime, patch);
  }

  function resetBridgePollRuntime(reason = '') {
    updateBridgePollRuntime({
      bridge_connected: false,
      last_poll_ok: false,
      last_poll_error: String(reason || '').trim(),
      last_poll_at: Date.now(),
    });
  }

  function markBridgePollSuccess() {
    updateBridgePollRuntime({
      bridge_connected: true,
      last_poll_ok: true,
      last_poll_error: '',
      last_poll_at: Date.now(),
    });
    updateChatInputStateBadge();
  }

  function markBridgePollFailure(errorText) {
    updateBridgePollRuntime({
      bridge_connected: false,
      last_poll_ok: false,
      last_poll_error: String(errorText || '').trim() || 'bridge_poll_failed',
      last_poll_at: Date.now(),
    });
    updateChatInputStateBadge();
  }

  function resolvePageCapabilityReason(responseState, conversationId, url) {
    const pathname = location.pathname || '';
    const isHomePage = pathname === '/' || pathname === '';
    const composerReason = String(responseState.response_state_reason || '').trim();

    if (composerReason) {
      return composerReason;
    }

    if (!conversationId && isHomePage) {
      return 'page_home';
    }

    if (url && !conversationId) {
      return 'conversation_not_syncable';
    }

    return '';
  }

  const PAGE_CAPABILITY_CACHE_TTL_MS = 800;
  const pageCapabilityCache = {
    at: 0,
    key: '',
    value: null,
  };
  const responseStateCache = {
    at: 0,
    key: '',
    value: null,
  };

  const RESPONSE_STATE_REENTER_CACHE_MAX_AGE_MS = 3000;

  function isDetectReenterResponseState(value) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    return value._detect_reenter_skip === true
      || String(value.response_state_reason || '') === 'detect-reenter-skip'
      || String(value.reason || '') === 'detect-reenter-skip';
  }

  function isUsableCachedResponseState(value) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (isDetectReenterResponseState(value)) {
      return false;
    }

    const stateText = String(value.response_state || '').trim();
    if (!stateText || stateText === 'unknown' || stateText === 'detecting') {
      return false;
    }

    return true;
  }

  function enrichComposerResponseState(base = {}) {
    const isResponding = base.is_responding === true || base.isResponding === true;
    const responseState = String(base.response_state || base.responseState || '').trim().toLowerCase();
    const responseReason = String(
      base.response_state_reason || base.responseStateReason || '',
    ).trim().toLowerCase();
    const canAcceptInput = base.can_accept_input === true || base.canAcceptInput === true;
    const canSendNow = base.can_send_now === true || base.canSendNow === true;
    const hasComposer = base.has_composer === true || base.hasComposer === true;
    const hasComposerPayload = base.has_composer_payload === true || base.hasComposerPayload === true;
    const attachmentCount = Number(base.attachment_count || base.attachmentCount || 0);
    return Object.assign({}, base, {
      isResponding,
      is_responding: isResponding,
      responseState: responseState || base.responseState || '',
      response_state: responseState || base.response_state || '',
      responseStateReason: responseReason || base.responseStateReason || '',
      response_state_reason: responseReason || base.response_state_reason || '',
      canAcceptInput,
      can_accept_input: canAcceptInput,
      canSendNow,
      can_send_now: canSendNow,
      hasComposer,
      has_composer: hasComposer,
      hasComposerPayload,
      has_composer_payload: hasComposerPayload,
      attachmentCount,
      attachment_count: attachmentCount,
      reply: {
        state: responseState || (isResponding ? 'generating' : 'idle'),
        busy: isResponding,
        reason: responseReason,
      },
      composer: {
        exists: hasComposer,
        inputReady: canAcceptInput,
        hasPayload: hasComposerPayload,
        nativeSendReady: canSendNow,
        attachmentCount,
      },
      permission: {
        canInput: canAcceptInput,
        canSend: canSendNow,
        canUpload: canAcceptInput && !isResponding && !hasComposerPayload,
      },
    });
  }

  function rememberResponseState(cacheKey, result) {
    const enriched = enrichComposerResponseState(result);
    if (isUsableCachedResponseState(enriched)) {
      responseStateCache.at = Date.now();
      responseStateCache.key = cacheKey;
      responseStateCache.value = enriched;
    }

    if (enriched && typeof enriched === 'object') {
      const responseState = String(enriched.reply?.state || enriched.response_state || enriched.responseState || '').trim().toLowerCase();
      const responseReason = String(enriched.reply?.reason || enriched.response_state_reason || enriched.responseStateReason || '').trim().toLowerCase();
      const generating = enriched.reply?.busy === true
        || responseState === 'generating'
        || responseState === 'responding'
        || responseState === 'answering'
        || responseReason === 'assistant_busy'
        || responseReason === 'response_in_progress'
        || enriched.is_responding === true
        || enriched.isResponding === true;
      if (
        generating
        && typeof UploadModule !== 'undefined'
        && UploadModule
        && typeof UploadModule.reconcilePendingSendTaskAfterExternalNativeSend === 'function'
      ) {
        try {
          UploadModule.reconcilePendingSendTaskAfterExternalNativeSend('response-state-generating', {
            alreadyGenerating: true,
            skipDetectComposerState: true,
          });
        } catch (reconcileErr) {
          console.error('[ChatGPT toolbox] reconcilePendingSendTaskAfterExternalNativeSend failed', reconcileErr);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(
              `[SEND_TASK][RECONCILE_ERROR] reason=response-state-generating error=${reconcileErr && reconcileErr.message ? reconcileErr.message : String(reconcileErr)}`,
            );
          }
        }
      }
    }

    return enriched;
  }

  function getCachedResponseStateForReenter(reasonText) {
    const now = Date.now();
    const cached = responseStateCache.value;

    if (
      isUsableCachedResponseState(cached)
      && now - Number(responseStateCache.at || 0) <= RESPONSE_STATE_REENTER_CACHE_MAX_AGE_MS
    ) {
      return {
        ...cached,
        response_state_at: now,
        _detect_reenter_cached: true,
        _detect_reason: reasonText,
      };
    }

    return buildDetectReenterSkipState(reasonText);
  }

  function buildPageCapabilityCacheKey(reason = '') {
    return [
      location.href || '',
      document.visibilityState || '',
      document.hasFocus() ? 1 : 0,
      String(reason || '').trim(),
    ].join('|');
  }

  function getPageCapability(reason = '') {
    const now = Date.now();
    const cacheKey = buildPageCapabilityCacheKey(reason);
    if (
      pageCapabilityCache.value
      && pageCapabilityCache.key === cacheKey
      && now - Number(pageCapabilityCache.at || 0) <= PAGE_CAPABILITY_CACHE_TTL_MS
    ) {
      return pageCapabilityCache.value;
    }
    const conversationId = parseConversationIdFromPath(location.pathname || '');
    const url = location.href || '';
    const pathname = location.pathname || '';
    const isHomePage = pathname === '/' || pathname === '';
    const responseState = detectComposerResponseState({
      light: true,
      reason: `getPageCapability:${String(reason || '-').trim() || '-'}`,
    });
    const clientId = (() => {
      try {
        return sessionStorage.getItem('tm_bridge_client_id') || '';
      } catch (err) {
        console.error('[ChatGPT toolbox] getPageCapability client_id read failed', err);
        return '';
      }
    })();

    const responding = Boolean(responseState.is_responding);
    const hasComposer = typeof ComposerApi.hasComposer === 'function'
      ? ComposerApi.hasComposer()
      : !!document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
    const attachmentCount = Number(responseState.attachment_count || 0);
    const hasComposerPayload = Boolean(responseState.has_composer_payload);
    const composerTextLen = Number(responseState.composer_text_len || 0);

    const responseStateReason = resolvePageCapabilityReason(responseState, conversationId, url);
    const canAcceptInput = Boolean(responseState.can_accept_input || responseState.canAcceptInput);
    const canSendNow = Boolean(responseState.can_send_now || responseState.canSendNow);
    const capability = {
      client_id: clientId,
      page_instance_id: getToolboxPageInstanceId(),
      conversation_id: conversationId,
      url,
      page_type: conversationId ? 'conversation' : (isHomePage ? 'home' : 'unknown'),
      online: true,
      is_responding: responding,
      isResponding: responding,
      response_state: responseState.response_state || 'unknown',
      responseState: responseState.response_state || responseState.responseState || 'unknown',
      response_state_reason: responseStateReason,
      responseStateReason,
      bridge_connected: Boolean(BridgePollRuntime.bridge_connected),
      can_send_now: canSendNow,
      canSendNow,
      can_accept_input: canAcceptInput,
      canAcceptInput,
      has_composer: hasComposer,
      hasComposer,
      composer_text_len: composerTextLen,
      attachment_count: attachmentCount,
      attachmentCount,
      has_composer_payload: hasComposerPayload,
      hasComposerPayload,
      reply: {
        state: responding ? 'generating' : (responseState.reply?.state || responseState.response_state || 'idle'),
        busy: responding === true,
        reason: responseStateReason || '',
      },
      composer: {
        exists: hasComposer === true,
        inputReady: canAcceptInput === true,
        hasPayload: hasComposerPayload === true,
        nativeSendReady: canSendNow === true,
        attachmentCount,
      },
      permission: {
        canInput: canAcceptInput === true,
        canSend: canSendNow === true,
        canUpload: (
          canAcceptInput === true
          && responding !== true
          && hasComposerPayload !== true
        ),
      },
      last_poll_ok: BridgePollRuntime.last_poll_ok,
      last_poll_error: String(BridgePollRuntime.last_poll_error || '').trim(),
      last_poll_at: Number(BridgePollRuntime.last_poll_at || 0),
      visibility_state: document.visibilityState || 'unknown',
      has_focus: document.hasFocus(),
      reason: String(reason || '').trim(),
    };

    if (typeof applyHomeNewChatCapabilityOverride === 'function') {
      applyHomeNewChatCapabilityOverride(capability);
    }

    pageCapabilityCache.at = now;
    pageCapabilityCache.key = cacheKey;
    pageCapabilityCache.value = capability;
    return capability;
  }

  function detectChatInputStateFromDom() {
    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      return {
        text: '可输入',
        cls: 'cgpt-state-ready',
        title: '新聊天首页已就绪，可以发送',
      };
    }

    if (typeof hasRealChatGPTStopGeneratingButton === 'function' && hasRealChatGPTStopGeneratingButton()) {
      return {
        text: '生成中',
        cls: 'cgpt-state-generating',
        title: 'ChatGPT 正在回答，暂时不建议发送新消息',
      };
    }

    const composer = document.querySelector('#prompt-textarea')
      || document.querySelector('textarea')
      || document.querySelector('[contenteditable="true"]');
    const sendSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="\u53d1\u9001"]',
    ];

    let sendBtn = null;
    for (const selector of sendSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate) {
        sendBtn = candidate;
        break;
      }
    }

    if (composer && sendBtn) {
      const sendReady = !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true';
      if (sendReady) {
        return {
          text: '可输入',
          cls: 'cgpt-state-ready',
          title: '当前页面可以输入并发送消息',
        };
      }

      return {
        text: '不可发',
        cls: 'cgpt-state-blocked',
        title: '当前输入框或发送按钮不可用',
      };
    }

    if (composer) {
      return {
        text: '不可发',
        cls: 'cgpt-state-blocked',
        title: '当前输入框或发送按钮不可用',
      };
    }

    return {
      text: '未知',
      cls: 'cgpt-state-unknown',
      title: '无法判断当前页面输入状态',
    };
  }

  function resolveWaitingForReply() {
    if (ChatInputStateRuntime.waitingForReply) {
      return true;
    }

    if (typeof hasPendingReply === 'function' && hasPendingReply('')) {
      return true;
    }

    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.isWaitingReplyOnly === 'function'
      && UploadModule.isWaitingReplyOnly()
    ) {
      return true;
    }

    return false;
  }

  function resolveIsSending() {
    if (ChatInputStateRuntime.sendInProgress) {
      return true;
    }

    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.isSendPipelineBusy === 'function'
      && UploadModule.isSendPipelineBusy()
    ) {
      // 豁免：如果页面已经 ready 且 sendTask 本身处于 idle 阶段，
      // 说明只是 waitingSend/autoSendWaiting 卡住（旧 payload 未释放），
      // 此时不应显示"发送中"。
      const phase = (
        typeof UploadModule.getSendTaskPhase === 'function'
          ? UploadModule.getSendTaskPhase()
          : 'unknown'
      );
      if (phase === 'idle') {
        const cap = typeof getPageCapability === 'function'
          ? getPageCapability('send-wait')
          : null;
        const pageReady = cap
          && cap.response_state === 'ready'
          && !cap.is_responding;
        if (pageReady) {
          ToolboxShell.appendLog(
            `[TOP_STATUS][SENDING_SUPPRESSED] reason=payload-ready-not-sending phase=${phase} response_state=${cap.response_state}`,
          );
          return false;
        }
      }
      return true;
    }

    if (resolveWaitingForReply()) {
      const internal = detectTopMainResponseSignals(
        typeof getPageCapability === 'function' ? getPageCapability('send-wait') : null,
        detectChatInputStateFromDom(),
      );
      if (!internal.responseInProgress) {
        return true;
      }
    }

    return false;
  }

  function detectTopMainResponseSignals(capability, domState) {
    const domGenerating = !!(domState && domState.cls === 'cgpt-state-generating');
    const domReady = !!(domState && domState.cls === 'cgpt-state-ready');
    const hasStop = typeof hasRealChatGPTStopGeneratingButton === 'function'
      && hasRealChatGPTStopGeneratingButton();
    const domContradictsStaleGenerating = domReady && !hasStop && !domGenerating;
    const isGenerating = domGenerating
      || !!(
        !domContradictsStaleGenerating
        && capability
        && capability.response_state === 'generating'
      );
    const isResponding = domGenerating
      || !!(
        !domContradictsStaleGenerating
        && capability
        && (
          capability.is_responding
          || capability.response_state === 'responding'
          || capability.response_state === 'generating'
        )
      );
    const isAnswering = isResponding || isGenerating;
    const responseInProgress = isAnswering;

    return {
      isGenerating,
      isResponding,
      isAnswering,
      responseInProgress,
    };
  }

  const topMainStatusOverrideLogThrottle = {
    lastReason: '',
    lastAt: 0,
  };

  const TOP_MAIN_STATUS_OVERRIDE_LOG_MIN_MS = 5000;

  function appendTopMainStatusOverrideLogThrottled(reason, line) {
    if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
      return;
    }
    const now = Date.now();
    if (
      reason === topMainStatusOverrideLogThrottle.lastReason
      && now - topMainStatusOverrideLogThrottle.lastAt < TOP_MAIN_STATUS_OVERRIDE_LOG_MIN_MS
    ) {
      return;
    }
    topMainStatusOverrideLogThrottle.lastReason = reason;
    topMainStatusOverrideLogThrottle.lastAt = now;
    ToolboxShell.appendLog(line);
  }

  function getTopMainStatus() {
    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { ready: false };
      if (!sendSnap.ready) {
        return {
          text: '附件处理中',
          cls: 'cgpt-state-waiting',
          type: 'online',
          title: '输入框有内容，等待 ChatGPT 发送按钮可用',
          reason: 'home_new_chat_payload_but_send_button_missing',
          isGenerating: false,
          isResponding: false,
          isAnswering: false,
          responseInProgress: false,
        };
      }
      appendTopMainStatusOverrideLogThrottled(
        'home_new_chat_ready_to_send',
        '[TOOLBOX_TOP_STATUS][STATE_OVERRIDE] reason=home_new_chat_ready_to_send',
      );
      return {
        text: '可输入',
        cls: 'cgpt-state-ready',
        type: 'online',
        title: '新聊天首页已就绪，可以发送',
        reason: 'home_new_chat_composer_ready_override',
        isGenerating: false,
        isResponding: false,
        isAnswering: false,
        responseInProgress: false,
      };
    }

    const capability = typeof getPageCapability === 'function'
      ? getPageCapability('top-main-status')
      : null;
    const domState = detectChatInputStateFromDom();
    const internal = detectTopMainResponseSignals(capability, domState);

    const bridgeOnline = !!(capability && capability.bridge_connected);
    const pageOnline = capability ? capability.online !== false : true;

    const domContradictsOfflineLock = !!(
      domState
      && domState.cls === 'cgpt-state-ready'
      && !internal.isGenerating
      && !internal.isAnswering
      && !internal.responseInProgress
    );
    const hasStopForTopStatus = typeof hasRealChatGPTStopGeneratingButton === 'function'
      && hasRealChatGPTStopGeneratingButton();

    if ((!bridgeOnline || !pageOnline) && !domContradictsOfflineLock) {
      return {
        text: '离线',
        cls: 'cgpt-state-offline',
        type: 'offline',
        title: 'Bridge / 油猴页面不可用或未连接（仅连接参考）',
        reason: !bridgeOnline ? 'bridge_offline' : 'page_offline',
        ...internal,
      };
    }

    const capabilityStateText = String(capability && capability.response_state ? capability.response_state : '').trim();
    const capabilityReasonText = String(capability && capability.response_state_reason ? capability.response_state_reason : '').trim();

    if (
      capability
      && (
        capability._detect_reenter_skip === true
        || capabilityStateText === 'detecting'
        || capabilityReasonText === 'detect-reenter-skip'
        || capabilityReasonText === 'detect_in_progress'
      )
    ) {
      return {
        text: '检测中',
        cls: 'cgpt-state-waiting',
        type: 'running',
        title: '页面状态检测正在进行，稍后自动刷新',
        reason: 'detect_in_progress',
        ...internal,
      };
    }

    if (internal.responseInProgress) {
      return {
        text: '回答中',
        cls: 'cgpt-state-answering',
        type: 'answering',
        title: 'ChatGPT 正在生成回复',
        reason: 'generating',
        ...internal,
      };
    }

    if (resolveWaitingForReply()) {
      const domSaysReady = !!(
        !hasStopForTopStatus
        && domState
        && domState.cls === 'cgpt-state-ready'
      );
      if (domSaysReady) {
        ToolboxShell.appendLog(
          `[TOOLBOX_AUTHORITY][HEAL_STALE_REPLY_STATE] reason=getTopMainStatus:waiting_reply `
          + `dom=${domState.text || '-'} bridgeOnline=${bridgeOnline ? 1 : 0}`,
        );
        return {
          text: '可输入',
          cls: 'cgpt-state-ready',
          type: 'ready',
          title: '真实 DOM 显示可输入/可发送，已忽略陈旧 waiting_reply',
          reason: 'dom-heal-waiting-reply',
          ...internal,
        };
      }
      return {
        text: '等待回复',
        cls: 'cgpt-state-waiting',
        type: 'waiting',
        title: '已发送，等待 ChatGPT 回复',
        reason: 'waiting_reply',
        ...internal,
      };
    }

    if (resolveIsSending()) {
      return {
        text: '发送中',
        cls: 'cgpt-state-sending',
        type: 'sending',
        title: '消息正在送入页面或等待发送完成',
        reason: 'sending',
        ...internal,
      };
    }

    const canSendNow = !!(
      capability
      && (
        capability.can_send_now
        || capability.can_accept_input
      )
    );
    const canInput = canSendNow || (domState && domState.cls === 'cgpt-state-ready');

    if (canInput) {
      return {
        text: '可输入',
        cls: 'cgpt-state-ready',
        type: 'ready',
        title: '当前页面可以输入并发送消息',
        reason: 'ready',
        ...internal,
      };
    }

    return {
      text: '\u4e0d\u53ef\u53d1\u9001',
      cls: 'cgpt-state-blocked',
      type: 'blocked',
      title: domState && domState.title
        ? domState.title
        : '\u5f53\u524d\u9875\u9762\u65e0\u6cd5\u53d1\u9001',
      reason: 'blocked',
      ...internal,
    };
  }

  function getTopMainStatusLogContext() {
    const pageId = typeof getBridgePageDisplayIdText === 'function'
      ? getBridgePageDisplayIdText()
      : '-';
    const turnCount = typeof getConversationTurnCount === 'function'
      ? getConversationTurnCount()
      : '-';
    return { pageId, turnCount };
  }

  function logTopMainStatusChange(info) {
    const nextText = String(info && info.text ? info.text : '').trim();
    const prevText = String(ChatInputStateRuntime.lastTopStatusText || '').trim();

    if (nextText === prevText) {
      return;
    }

    const { pageId, turnCount } = getTopMainStatusLogContext();
    const reason = String(info && info.reason ? info.reason : '-');

    if (info && info.isGenerating && info.isAnswering) {
      console.log('[TOOLBOX][TOP_STATUS][MERGED] generating=true answering=true display=回答中');
    }

    console.log(
      `[TOOLBOX][TOP_STATUS] old=${prevText || '-'} new=${nextText || '-'} page_id=${pageId} turn_count=${turnCount} reason=${reason}`,
    );

    ChatInputStateRuntime.lastTopStatusText = nextText;
    ChatInputStateRuntime.lastTopStatusType = String(info && info.type ? info.type : '');
  }

  function updateChatInputStateBadge() {
    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.maybeHealStaleWaitingReplyState === 'function'
    ) {
      try {
        UploadModule.maybeHealStaleWaitingReplyState('updateChatInputStateBadge');
      } catch (healErr) {
        console.error('[ChatGPT toolbox] updateChatInputStateBadge heal stale waiting reply failed', healErr);
      }
    }

    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.maybeReconcileSendCopyHotkeyWaitingReply === 'function'
    ) {
      try {
        UploadModule.maybeReconcileSendCopyHotkeyWaitingReply('updateChatInputStateBadge');
      } catch (reconcileErr) {
        console.error('[ChatGPT toolbox] updateChatInputStateBadge send-copy-hotkey reconcile failed', reconcileErr);
      }
    }

    const info = getTopMainStatus();
    logTopMainStatusChange(info);

    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.renderToolboxTopStatus === 'function'
    ) {
      UploadModule.renderToolboxTopStatus({
        heavy: false,
        force: true,
        reason: `updateChatInputStateBadge:${info.text || '-'}`,
      });
      return;
    }

    const badge = document.querySelector('#cgpt-page-input-state');
    if (!badge) {
      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus('updateChatInputStateBadge:no-page-badge');
      }
      return;
    }

    const prevText = String(ChatInputStateRuntime.lastTopStatusText || '').trim();
    const nextText = String(info.text || '').trim();

    badge.textContent = info.text;
    badge.title = info.title || info.text;
    badge.classList.add('cgpt-toolbox-status-primary-badge');
    badge.style.display = '';

    badge.classList.remove(
      'cgpt-state-ready',
      'cgpt-state-waiting',
      'cgpt-state-sending',
      'cgpt-state-answering',
      'cgpt-state-generating',
      'cgpt-state-blocked',
      'cgpt-state-offline',
      'cgpt-state-unknown',
    );

    badge.classList.add(info.cls || 'cgpt-state-unknown');

    if (nextText !== prevText) {
      if (
        typeof UploadModule !== 'undefined'
        && UploadModule
        && typeof UploadModule.renderUploadButtonsOnly === 'function'
      ) {
        try {
          UploadModule.renderUploadButtonsOnly({
            immediate: true,
            force: true,
            heavy: false,
            scope: 'all',
            buttonTasksReason: `top-main-status-change:${nextText || '-'}`,
          });
        } catch (err) {
          console.warn('[TOP_STATUS][UPLOAD_BUTTON_REFRESH_FAILED]', err);
        }
      }
    }

    if (typeof renderToolboxHeaderStatus === 'function') {
      renderToolboxHeaderStatus(`updateChatInputStateBadge:${nextText || '-'}`);
    }
  }

  function logPageCapability(capability, tag = '[CAPABILITY]') {
    const cap = capability && typeof capability === 'object' ? capability : getPageCapability('');
    const prefix = String(tag || '[CAPABILITY]').trim();
    const line = `${prefix} client_id=${cap.client_id || '-'} `
      + `page_instance_id=${cap.page_instance_id || '-'} `
      + `conversation_id=${cap.conversation_id || '-'} `
      + `url=${cap.url || '-'} `
      + `online=${cap.online ? 1 : 0} syncable=${cap.conversation_id ? 1 : 0} `
      + `conversation_syncable=${cap.conversation_syncable ? 1 : 0} `
      + `sendable=${cap.can_send_now ? 1 : 0} inputable=${cap.can_accept_input ? 1 : 0} `
      + `bridge_connected=${cap.bridge_connected ? 1 : 0} `
      + `response_state=${cap.response_state || '-'} `
      + `response_state_reason=${cap.response_state_reason || '-'} `
      + `reason=${cap.reason || '-'}`;

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  const SEND_CONFIRM_POLL_MS = 250;
  const SEND_CONFIRM_DEFAULT_TIMEOUT_MS = 12000;
  const SEND_ATTACH_WAIT_DEFAULT_MS = 30000;
  const SEND_WAIT_TIMEOUT_MS = 60000;
  const SEND_FALLBACK_WAIT_MS = 2500;
  const SEND_TEXT_SYNC_TIMEOUT_MS = 8000;
  const SEND_CONVERSATION_SWITCH_EXTRA_MS = 8000;

  function appendSendLog(line) {
    const text = String(line || '').trim();
    if (!text) {
      return;
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(text);
    } else {
      console.log(text);
    }
  }

  function getSendFlowDiagnostics() {
    let responseState = {};

    try {
      responseState = detectComposerResponseState();
    } catch (err) {
      console.error('[ChatGPT toolbox] getSendFlowDiagnostics response_state failed', err);
    }

    return {
      url: location.href || '',
      conversation_id: parseConversationIdFromPath(location.pathname || '') || '',
      page_instance_id: getToolboxPageInstanceId(),
      response_state: responseState.response_state || 'unknown',
      sendable: typeof ComposerApi.canSendNow === 'function' ? ComposerApi.canSendNow() : false,
    };
  }

  function logSendFlowError(tag, err, extra = {}) {
    const errText = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? String(err.stack) : '';
    const diag = getSendFlowDiagnostics();
    console.error(`[ChatGPT toolbox] ${tag}`, err, { ...diag, ...extra });
    appendSendLog(
      `[SEND][ERROR] tag=${tag} error=${errText} url=${diag.url} `
      + `conversation_id=${diag.conversation_id || '-'} page_instance_id=${diag.page_instance_id || '-'} `
      + `response_state=${diag.response_state || '-'} sendable=${diag.sendable ? 1 : 0} `
      + `extra=${JSON.stringify(extra || {})}${stack ? ` stack=${stack.slice(0, 400)}` : ''}`,
    );
  }

  const SEND_STABLE_RETRY_LIMIT_DEFAULT = 30;
  const SEND_STABLE_RETRY_INTERVAL_MS_DEFAULT = 300;
  const MAX_ATTACHMENT_SEND_WAIT_MS = 30000;
  const SEND_BUTTON_RETRY_INTERVAL_MS = 300;
  const SEND_STABLE_VERIFY_WAIT_MS = 500;
  const SEND_STABLE_VERIFY_TIMEOUT_MS = 8000;
  const SEND_TEXT_BUTTON_WAIT_MS = 8000;
  const SEND_TEXT_BUTTON_POLL_MS = 100;

  function formatSendLogFields(fields) {
    return Object.entries(fields || {})
      .map(([key, value]) => `${key}=${value == null ? '-' : value}`)
      .join(' ');
  }

  function appendSendLogFields(tag, fields) {
    appendSendLog(`${tag} ${formatSendLogFields(fields)}`);
  }

  function resolveComposerButtonElement(el) {
    if (typeof ComposerApi.resolveButtonElement === 'function') {
      return ComposerApi.resolveButtonElement(el);
    }

    if (el instanceof HTMLButtonElement) {
      return el;
    }

    if (el && typeof el.closest === 'function') {
      const button = el.closest('button');
      if (button instanceof HTMLButtonElement) {
        return button;
      }
    }

    return null;
  }

  function isVoiceComposerButton(el) {
    if (typeof ComposerApi.isVoiceButton === 'function') {
      return ComposerApi.isVoiceButton(el);
    }

    const button = resolveComposerButtonElement(el);
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }

    if (button.classList && button.classList.contains('composer-speech-button')) {
      return true;
    }

    const useHrefList = Array.from(button.querySelectorAll('use'))
      .map((use) => String(use.getAttribute('href') || use.getAttribute('xlink:href') || ''))
      .join(' ')
      .toLowerCase();

    const probe = [
      button.id || '',
      button.className || '',
      button.getAttribute('aria-label') || '',
      button.getAttribute('title') || '',
      button.textContent || '',
      button.getAttribute('data-testid') || '',
      useHrefList,
    ].join(' ').toLowerCase();

    return (
      probe.includes('\u542f\u52a8\u8bed\u97f3\u529f\u80fd')
      || probe.includes('\u5f00\u59cb\u542c\u5199')
      || probe.includes('\u505c\u6b62\u542c\u5199')
      || probe.includes('\u8bed\u97f3')
      || probe.includes('\u542c\u5199')
      || probe.includes('\u9ea6\u514b\u98ce')
      || probe.includes('\u5f55\u97f3')
      || probe.includes('voice')
      || probe.includes('microphone')
      || probe.includes('dictate')
      || probe.includes('speech')
      || probe.includes('audio')
      || probe.includes('mic')
      || probe.includes('#f8aa74')
    );
  }

  function collectComposerScopedButtonScanScopes() {
    const scopes = [];
    const addScope = (scope) => {
      if (!(scope instanceof HTMLElement)) {
        return;
      }
      if (scopes.includes(scope)) {
        return;
      }
      scopes.push(scope);
    };

    const composer = typeof ComposerApi.getComposer === 'function'
      ? ComposerApi.getComposer()
      : findChatGPTComposer();
    const composerRoot = typeof ComposerApi.getComposerRoot === 'function'
      ? ComposerApi.getComposerRoot()
      : null;
    const composerForm = composer instanceof HTMLElement ? composer.closest('form') : null;
    const composerEl = document.querySelector('[data-testid="composer"]');

    addScope(composerForm);
    addScope(composerEl);
    addScope(composerRoot);
    addScope(composer);

    return scopes;
  }

  function hasVoiceComposerButtonOnly() {
    const byId = document.querySelector('#composer-submit-button');
    if (byId instanceof HTMLButtonElement && isVoiceComposerButton(byId)) {
      return true;
    }

    const scopes = collectComposerScopedButtonScanScopes();
    const allowDocumentFallback = scopes.length === 0 || (
      typeof isComposerDebugEnabled === 'function'
      && isComposerDebugEnabled()
    );
    const buttons = allowDocumentFallback
      ? Array.from(document.querySelectorAll('button'))
      : scopes.flatMap((scope) => Array.from(scope.querySelectorAll('button')));
    let sawVoice = false;

    for (const button of buttons) {
      if (!(button instanceof HTMLButtonElement) || isInsideToolbox(button)) {
        continue;
      }

      if (isVoiceComposerButton(button)) {
        sawVoice = true;
        continue;
      }

      if (
        typeof ComposerApi.isRealSendButton === 'function'
        && ComposerApi.isRealSendButton(button)
        && typeof ComposerApi.isSendButtonReady === 'function'
        && ComposerApi.isSendButtonReady(button)
      ) {
        return false;
      }
    }

    return sawVoice;
  }

  // Compatibility wrapper for legacy callers. New code should prefer ComposerApi.hasRealComposerText().
  function hasRealComposerText() {
    if (typeof ComposerApi.hasRealComposerText === 'function') {
      return ComposerApi.hasRealComposerText();
    }

    const composer = findChatGPTComposer();
    const text = composer
      ? String(composer.innerText || composer.textContent || '').trim()
      : '';
    return text.length > 0;
  }

  // Compatibility wrapper for legacy callers. New code should prefer ComposerApi.hasRealSubmitButton().
  function hasRealSubmitButton() {
    if (typeof ComposerApi.hasRealSubmitButton === 'function') {
      return ComposerApi.hasRealSubmitButton();
    }

    const byId = document.querySelector('#composer-submit-button');
    if (byId instanceof HTMLButtonElement && !isVoiceComposerButton(byId)) {
      return typeof ComposerApi.isRealSendButton === 'function'
        ? ComposerApi.isRealSendButton(byId)
        : true;
    }

    const btn = document.querySelector('button[data-testid="send-button"]');
    if (!(btn instanceof HTMLButtonElement) || isVoiceComposerButton(btn)) {
      return false;
    }

    return typeof ComposerApi.isRealSendButton === 'function'
      ? ComposerApi.isRealSendButton(btn)
      : true;
  }

  function getComposerSendDiagnostics() {
    const sendability = evaluateComposerSendability();
    const sendButton = sendability.sendButton;

    return {
      hasText: sendability.textLen > 0 ? 1 : 0,
      textLength: sendability.textLen,
      hasAttachment: sendability.hasAttachment ? 1 : 0,
      real_send_button_enabled: sendability.realSendButtonEnabled ? 1 : 0,
      sendable: sendability.sendable ? 1 : 0,
      response_state: sendability.response_state,
      response_state_reason: sendability.response_state_reason,
      buttonId: sendButton ? String(sendButton.id || '-') : '-',
      buttonAria: sendButton ? String(sendButton.getAttribute('aria-label') || '-') : '-',
      buttonDisabled: sendability.realSendButtonEnabled ? 0 : 1,
    };
  }

  async function waitUntilPredicate(predicate, timeoutMs, intervalMs, shouldStop) {
    const startedAt = Date.now();
    const maxMs = Math.max(0, Number(timeoutMs) || 0);
    const pollMs = Math.max(50, Number(intervalMs) || 100);
    const stopFn = typeof shouldStop === 'function' ? shouldStop : () => false;

    while (Date.now() - startedAt < maxMs) {
      if (stopFn()) {
        return false;
      }

      let matched = false;
      try {
        matched = !!predicate();
      } catch (err) {
        console.error('[ChatGPT toolbox] waitUntilPredicate failed', err);
      }

      if (matched) {
        return true;
      }

      await sleep(pollMs);
    }

    return false;
  }

  function getSendLogContext(extra = {}) {
    const cap = typeof getPageCapability === 'function' ? getPageCapability('send-log') : {};
    const sendability = evaluateComposerSendability();

    return {
      page_display_id: String(BRIDGE_STATE.page_display_id || '').trim() || '-',
      client_id: String(cap.client_id || '').trim() || '-',
      conversation_id: String(cap.conversation_id || '').trim() || '-',
      inputable: cap.can_accept_input ? 1 : 0,
      sendable: sendability.sendable ? 1 : 0,
      response_state: sendability.response_state || String(cap.response_state || 'unknown'),
      response_state_reason: sendability.response_state_reason || String(cap.response_state_reason || '-'),
      has_attachment: sendability.hasAttachment ? 1 : 0,
      text_len: sendability.textLen,
      real_send_button_enabled: sendability.realSendButtonEnabled ? 1 : 0,
      ...extra,
    };
  }

  function findChatGPTComposer() {
    return typeof ComposerApi.getComposer === 'function' ? ComposerApi.getComposer() : null;
  }

  function focusComposer(composer) {
    const el = composer instanceof HTMLElement
      ? composer
      : findChatGPTComposer();

    if (!(el instanceof HTMLElement)) {
      return false;
    }

    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (scrollErr) {
      console.error('[ChatGPT toolbox] focusComposer scrollIntoView failed', scrollErr);
    }

    if (typeof ComposerApi.focusComposerForNativeSend === 'function') {
      return ComposerApi.focusComposerForNativeSend();
    }

    try {
      el.focus({ preventScroll: false });
    } catch (focusErr) {
      console.error('[ChatGPT toolbox] focusComposer focus failed', focusErr);
      el.focus();
    }

    return true;
  }

  function setComposerText(composer, text) {
    if (typeof ComposerApi.setComposerValue !== 'function') {
      return false;
    }

    appendSendLogFields('[COMPOSER][TEXT_FILL_START]', getComposerSendDiagnostics());
    focusComposer(composer);
    const ok = ComposerApi.setComposerValue(String(text || ''));
    appendSendLogFields('[COMPOSER][TEXT_FILL_DONE]', {
      ...getComposerSendDiagnostics(),
      ok: ok ? 1 : 0,
    });
    return ok;
  }

  function getComposerTextFromElement(composer) {
    if (typeof ComposerApi.getComposerText === 'function') {
      return String(ComposerApi.getComposerText() || '');
    }

    if (!(composer instanceof HTMLElement)) {
      return '';
    }

    if (composer.matches && composer.matches('textarea,input')) {
      return String(composer.value || '').trim();
    }

    return String(composer.innerText || composer.textContent || '').trim();
  }

  function hasComposerAttachment() {
    if (typeof ComposerApi.hasComposerAttachmentUnified === 'function') {
      return ComposerApi.hasComposerAttachmentUnified();
    }

    const attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
      ? ComposerApi.countAttachmentChips()
      : 0;

    if (attachmentCount > 0) {
      return true;
    }

    if (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function') {
      return ComposerApi.hasVisibleComposerAttachmentPayload();
    }

    return false;
  }

  function findChatGPTSendButton() {
    if (typeof getRealComposerSendButton === 'function') {
      const strictBtn = getRealComposerSendButton('findChatGPTSendButton');
      if (strictBtn instanceof HTMLButtonElement) {
        return strictBtn;
      }
    }

    const prioritySelectors = [
      'button#composer-submit-button',
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'main button[data-testid="send-button"]',
      'form button#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="发送提示"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
    ];

    const scopes = collectComposerScopedButtonScanScopes();
    const debugPriorityLog = (
      typeof isComposerDebugEnabled === 'function'
      && isComposerDebugEnabled()
    );
    const tryScopedPrioritySelectors = () => {
      for (let si = 0; si < scopes.length; si += 1) {
        const scope = scopes[si];
        for (let i = 0; i < prioritySelectors.length; i += 1) {
          const sel = prioritySelectors[i];
          const candidate = scope.querySelector(sel);

          if (!(candidate instanceof HTMLElement)) {
            continue;
          }

          if (isVoiceComposerButton(candidate)) {
            if (debugPriorityLog) {
              const button = resolveComposerButtonElement(candidate);
              ToolboxShell.appendLog(
                `[COMPOSER][SEND_BUTTON_REJECT] reason=voice_or_dictation selector=${sel} `
                + `id=${button ? String(button.id || '-') : '-'} class=${button ? String(button.className || '-') : '-'} `
                + `aria=${button ? String(button.getAttribute('aria-label') || '-') : '-'} `
                + `disabled=${button && button.disabled ? 1 : 0}`,
              );
            }
            continue;
          }

          if (
            typeof ComposerApi.isRealSendButton === 'function'
            && ComposerApi.isRealSendButton(candidate)
          ) {
            const button = resolveComposerButtonElement(candidate);
            if (debugPriorityLog) {
              ToolboxShell.appendLog(
                `[COMPOSER][SEND_BUTTON_FOUND] selector=${sel} `
                + `id=${button ? String(button.id || '-') : '-'} class=${button ? String(button.className || '-') : '-'} `
                + `aria=${button ? String(button.getAttribute('aria-label') || '-') : '-'} `
                + `testid=${button ? String(button.getAttribute('data-testid') || '-') : '-'} `
                + `disabled=${button && button.disabled ? 1 : 0}`,
              );
            }
            return button;
          }
        }
      }
      return null;
    };

    const scopedHit = tryScopedPrioritySelectors();
    if (scopedHit) {
      return scopedHit;
    }

    const allowDocumentFallback = scopes.length === 0 || (
      typeof isComposerDebugEnabled === 'function'
      && isComposerDebugEnabled()
    );
    if (allowDocumentFallback) {
      for (let i = 0; i < prioritySelectors.length; i += 1) {
        const sel = prioritySelectors[i];
        const candidate = document.querySelector(sel);

        if (!(candidate instanceof HTMLElement)) {
          continue;
        }

        if (isVoiceComposerButton(candidate)) {
          continue;
        }

        if (
          typeof ComposerApi.isRealSendButton === 'function'
          && ComposerApi.isRealSendButton(candidate)
        ) {
          return resolveComposerButtonElement(candidate);
        }
      }
    }

    let buttons = [];
    if (scopes.length > 0) {
      const seen = new Set();
      for (let scopeIdx = 0; scopeIdx < scopes.length; scopeIdx += 1) {
        const scopeButtons = scopes[scopeIdx].querySelectorAll('button');
        for (let btnIdx = 0; btnIdx < scopeButtons.length; btnIdx += 1) {
          const btn = scopeButtons[btnIdx];
          if (!seen.has(btn)) {
            seen.add(btn);
            buttons.push(btn);
          }
        }
      }
    }

    if (buttons.length === 0 && allowDocumentFallback) {
      if (typeof logPerfThrottled === 'function') {
        logPerfThrottled(
          'findChatGPTSendButton:document-fallback',
          '[COMPOSER][SEND_BUTTON_SCAN] fallback=document-wide reason=scoped-empty-or-debug',
        );
      } else if (
        typeof isComposerDebugEnabled === 'function'
        && isComposerDebugEnabled()
      ) {
        ToolboxShell.appendLog(
          '[COMPOSER][SEND_BUTTON_SCAN] fallback=document-wide reason=scoped-empty-or-debug',
        );
      }
      buttons = Array.from(document.querySelectorAll('button'));
    }

    const debugScanLog = (
      typeof isComposerDebugEnabled === 'function'
      && isComposerDebugEnabled()
    );

    for (const button of buttons) {
      if (!(button instanceof HTMLButtonElement) || isInsideToolbox(button)) {
        continue;
      }

      if (isVoiceComposerButton(button)) {
        if (debugScanLog) {
          ToolboxShell.appendLog(
            `[COMPOSER][SEND_BUTTON_REJECT] reason=voice_or_dictation selector=scoped-button-scan `
            + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
            + `aria=${String(button.getAttribute('aria-label') || '-')} disabled=${button.disabled ? 1 : 0}`,
          );
        }
        continue;
      }

      if (
        typeof ComposerApi.isRealSendButton === 'function'
        && ComposerApi.isRealSendButton(button)
      ) {
        if (debugScanLog) {
          ToolboxShell.appendLog(
            `[COMPOSER][SEND_BUTTON_READY] selector=scoped-button-scan `
            + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
            + `aria=${String(button.getAttribute('aria-label') || '-')} disabled=${button.disabled ? 1 : 0}`,
          );
        }
        return button;
      }
    }

    if (debugScanLog) {
      ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button');
    }
    return null;
  }

  function findChatGPTStopButton() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid="composer-stop-button"]',
      'button[aria-label="停止生成"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label*="Stop generating"]',
    ];

    for (let i = 0; i < selectors.length; i += 1) {
      const buttons = Array.from(document.querySelectorAll(selectors[i]));
      for (const el of buttons) {
        if (!(el instanceof HTMLElement) || isInsideToolbox(el)) {
          continue;
        }
        if (isElementVisible(el) && !el.disabled) {
          return el;
        }
      }
    }

    return null;
  }

  function isStopComposerButton(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }

    const testId = String(button.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('stop')) {
      return true;
    }

    const aria = String(button.getAttribute('aria-label') || '').trim().toLowerCase();
    const title = String(button.getAttribute('title') || '').trim().toLowerCase();
    const text = String(button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const probe = `${aria} ${title} ${text}`;

    return /(?:^|\b)(?:stop(?:\s+generating)?|停止(?:生成)?|halt|pause)(?:\b|$)/i.test(probe);
  }

  function isSendButtonDisabled(button) {
    if (!(button instanceof HTMLButtonElement)) {
      return true;
    }

    if (isStopComposerButton(button)) {
      return true;
    }

    if (typeof ComposerApi.isSendButtonReady === 'function') {
      return !ComposerApi.isSendButtonReady(button);
    }

    if (button.disabled) {
      return true;
    }

    if (button.getAttribute('aria-disabled') === 'true') {
      return true;
    }

    if (button.getAttribute('data-disabled') === 'true') {
      return true;
    }

    const style = window.getComputedStyle(button);
    return style.pointerEvents === 'none' || !isElementVisible(button);
  }

  function describeComposerSendButtonForLog(button) {
    if (typeof ComposerApi.describeSendButton === 'function') {
      try {
        const info = ComposerApi.describeSendButton(button);
        if (info && typeof info === 'object') {
          return {
            selector: String(info.selector || '-'),
            aria: String(info.aria || '-'),
            testid: String(info.testid || '-'),
            disabled: Boolean(info.disabled),
          };
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] describeSendButton failed', {
          error_type: error && error.name ? error.name : 'Error',
          error: errText,
          stack: error && error.stack ? error.stack : '',
        });
        appendSendLogFields('[SEND][DESCRIBE_BUTTON_ERROR]', {
          error_type: error && error.name ? error.name : 'Error',
          error: errText,
        });
      }
    }

    if (!(button instanceof HTMLButtonElement)) {
      return {
        selector: '-',
        aria: '-',
        testid: '-',
        disabled: true,
      };
    }

    const testid = String(button.getAttribute('data-testid') || '-');
    const id = String(button.id || '').trim();
    const aria = String(button.getAttribute('aria-label') || '-');
    const type = String(button.getAttribute('type') || '').trim();
    const selector = testid !== '-'
      ? `button[data-testid="${testid}"]`
      : (id ? `button#${id}` : (type ? `button[type="${type}"]` : 'button'));

    return {
      selector,
      aria,
      testid,
      disabled: isSendButtonDisabled(button),
    };
  }

  function findComposerSendButtonDetailed() {
    const button = typeof ComposerApi.findSendButton === 'function'
      ? ComposerApi.findSendButton({ silent: true })
      : null;
    const composerText = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '')
      : '';
    const attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
      ? Number(ComposerApi.countAttachmentChips() || 0)
      : 0;
    const responseState = typeof detectComposerResponseState === 'function'
      ? detectComposerResponseState()
      : {};
    const info = describeComposerSendButtonForLog(button);

    return {
      button,
      disabled: isSendButtonDisabled(button),
      buttonSelector: info.selector || '-',
      composerTextLen: composerText.length,
      hasAttachment: attachmentCount > 0,
      attachmentCount,
      responseState: responseState.response_state || '-',
      responseStateReason: responseState.response_state_reason || '-',
    };
  }

  function invokeComposerSubmitClick(sendButton) {
    if (typeof clickSendButton === 'function') {
      return clickSendButton(sendButton, 'composer-api');
    }

    if (!(sendButton instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'invalid_send_button' };
    }

    try {
      sendButton.focus();
      HTMLButtonElement.prototype.click.call(sendButton);
      return { ok: true, reason: 'clicked' };
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.error('[ChatGPT toolbox] invokeComposerSubmitClick failed', {
        error_type: err && err.name ? err.name : 'Error',
        error: errText,
        stack: err && err.stack ? err.stack : '',
      });
      return { ok: false, reason: 'send_click_exception', error: errText };
    }
  }

  function appendSendTaskStageLog(line) {
    const text = String(line || '').trim();
    if (!text) {
      return;
    }
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(text);
      return;
    }
    console.log(text);
  }

  function clickSendButton(button, source = 'stable-send') {
    const sendButton = resolveComposerButtonElement(button);

    if (!(sendButton instanceof HTMLButtonElement)) {
      appendSendTaskStageLog(
        `[SEND_TASK][FAILED] stage=before-native-click error=invalid_send_button source=${String(source || '-')}`,
      );
      return { ok: false, reason: 'invalid_send_button' };
    }

    const sendBtnInfo = describeComposerSendButtonForLog(sendButton);
    const sendBtnDisabled = isSendButtonDisabled(sendButton);

    if (isVoiceComposerButton(sendButton)) {
      appendSendLogFields('[SEND][CLICK_REJECT]', {
        reason: 'voice_button',
        source,
        selector: sendBtnInfo.selector || '-',
      });
      appendSendTaskStageLog(
        `[SEND_TASK][FAILED] stage=before-native-click error=voice_button_only source=${String(source || '-')}`,
      );
      return { ok: false, reason: 'voice_button_only', retryable: true };
    }

    if (sendBtnDisabled) {
      appendSendTaskStageLog(
        `[SEND_TASK][FAILED] stage=before-native-click error=send_button_disabled source=${String(source || '-')} `
        + `buttonFound=1 disabled=1 aria=${sendBtnInfo.aria || '-'} testid=${sendButton.getAttribute('data-testid') || '-'}`,
      );
      return { ok: false, reason: 'send_button_disabled' };
    }

    try {
      const diag = getComposerSendDiagnostics();
      appendSendTaskStageLog(
        `[SEND_TASK][BEFORE_NATIVE_CLICK] buttonFound=1 disabled=0 aria=${sendBtnInfo.aria || '-'} `
        + `testid=${sendButton.getAttribute('data-testid') || '-'} source=${String(source || '-')} `
        + `textLen=${diag.composer_text_len != null ? diag.composer_text_len : (diag.textLen != null ? diag.textLen : 0)} `
        + `attachmentCount=${diag.has_attachment != null ? (diag.has_attachment ? 1 : 0) : (diag.hasAttachment ? 1 : 0)}`,
      );
      appendSendLogFields('[SEND][CLICK_SUBMIT_BUTTON]', {
        selector: sendButton.id === 'composer-submit-button' ? '#composer-submit-button' : sendBtnInfo.selector,
        ...diag,
        source,
      });
      appendSendLogFields('[MESSAGE_SEND][CLICK_NATIVE_BUTTON]', {
        source: String(source || '-'),
        hasAttachment: diag.has_attachment != null ? diag.has_attachment : (diag.hasAttachment ? 1 : 0),
        textLen: diag.composer_text_len != null ? diag.composer_text_len : diag.textLen,
      });
      sendButton.focus();
      const sendTestId = String(sendButton.getAttribute('data-testid') || '').trim();
      if (sendTestId === 'send-button' && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SEND][CLICK_REAL_SEND_BUTTON] source=${String(source || '-')} aria=${sendBtnInfo.aria || '-'}`,
        );
      }
      sendButton.click();
      appendSendTaskStageLog(
        `[SEND_TASK][NATIVE_SEND_CLICKED] method=click source=${String(source || '-')}`,
      );
      return { ok: true, reason: 'clicked' };
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      const errStack = err && err.stack ? err.stack : errText;
      console.error('[ChatGPT toolbox] clickSendButton failed', {
        error_type: err && err.name ? err.name : 'Error',
        error: errText,
        stack: errStack,
      });
      appendSendLogFields('[SEND][ERROR]', {
        tag: 'clickSendButton',
        error_type: err && err.name ? err.name : 'Error',
        error: errText,
        stack: err && err.stack ? String(err.stack).slice(0, 200) : '-',
      });
      appendSendTaskStageLog(
        `[SEND_TASK][FAILED] stage=native-click error=${errStack} source=${String(source || '-')}`,
      );
      return { ok: false, reason: 'send_click_exception', error: errText };
    }
  }

  async function waitAndClickSendFromAttachWait(shouldStop, options = {}) {
    const startedAt = Date.now();
    const source = String(options.source || 'stable-send');

    while (Date.now() - startedAt < MAX_ATTACHMENT_SEND_WAIT_MS) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }
      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const scan = findComposerSendButtonDetailed();
      const elapsed = Date.now() - startedAt;

      appendSendLogFields('[SEND][ATTACH_READY]', {
        elapsed,
        button_selector: scan.buttonSelector || '-',
        disabled: scan.disabled ? 1 : 0,
        composer_text_len: scan.composerTextLen,
        has_attachment: scan.hasAttachment ? 1 : 0,
        response_state: scan.responseState || '-',
        response_state_reason: scan.responseStateReason || '-',
      });

      if (scan.button && !scan.disabled && hasRealComposerText()) {
        appendSendLogFields('[SEND][ATTACH_READY_CLICK]', {
          elapsed,
          button_selector: scan.buttonSelector || '-',
          source,
          ...getComposerSendDiagnostics(),
        });
        const clicked = clickSendButton(scan.button, `${source}:attach_wait`);
        if (clicked.ok) {
          return { ok: true, reason: 'sent_by_attach_wait_click' };
        }
      }

      appendSendLog(
        `[SEND][ATTACH_WAIT] elapsed=${elapsed} status=processing button_found=${scan.button ? 1 : 0} disabled=${scan.disabled ? 1 : 0}`,
      );
      await sleep(SEND_BUTTON_RETRY_INTERVAL_MS);
    }

    return { ok: false, reason: 'send_button_wait_timeout' };
  }

  function dispatchEnterSend(composer, method) {
    // ChatGPT composer is React/contenteditable based.
    // Synthetic KeyboardEvent('Enter') may be ignored because event.isTrusted=false,
    // focus may not be inside the real editor, IME composition may consume Enter,
    // and Enter can be interpreted as newline depending on frontend state.
    // Therefore Enter is only a fallback. The primary path is clicking #composer-submit-button.
    focusComposer(composer);

    if (typeof ComposerApi.dispatchComposerSendKeyboard === 'function') {
      return ComposerApi.dispatchComposerSendKeyboard(method || 'enter');
    }

    return false;
  }

  function buildStableSendConfirmCtx(beforeText, beforeStopButton, sendButtonEnabledBefore) {
    const beforeLatestRecordRaw = getLatestConversationMessageRecordFast({ preferAssistant: false });
    const beforeLatestRecord = stripMessageRecordForCache(beforeLatestRecordRaw);
    const attachmentCountBeforeSend = typeof ComposerApi.countAttachmentChips === 'function'
      ? ComposerApi.countAttachmentChips()
      : 0;
    const contentText = String(beforeText || '').trim();
    const currentSendButton = findChatGPTSendButton();
    const actualSendButtonEnabled = !!(
      currentSendButton
      && currentSendButton instanceof HTMLButtonElement
      && !isSendButtonDisabled(currentSendButton)
    );

    return {
      contentText,
      contentProbe: contentText.slice(0, 80),
      attachmentCountBeforeSend,
      beforeLatestKey: beforeLatestRecord ? beforeLatestRecord.key : '',
      conversationIdBefore: parseConversationIdFromPath(location.pathname || '') || '',
      urlBefore: location.href || '',
      sendButtonEnabledBefore: typeof sendButtonEnabledBefore === 'boolean'
        ? sendButtonEnabledBefore
        : actualSendButtonEnabled,
      hadTextPayload: !!contentText || attachmentCountBeforeSend > 0,
      beforeStopButtonVisible: !!beforeStopButton,
    };
  }

  async function verifySendStarted(beforeCtx, options = {}) {
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const attempt = Number(options.attempt || 0);
    const verifyTimeoutMs = Math.max(
      SEND_STABLE_VERIFY_WAIT_MS,
      Number(options.timeoutMs || SEND_STABLE_VERIFY_TIMEOUT_MS),
    );
    const turnCountBefore = typeof getCurrentPageTurnCount === 'function'
      ? getCurrentPageTurnCount()
      : null;

    const confirmed = await waitComposerSendConfirmed(beforeCtx.contentText, verifyTimeoutMs, {
      shouldStop,
      beforeLatestKey: beforeCtx.beforeLatestKey,
      attachmentCountBeforeSend: beforeCtx.attachmentCountBeforeSend,
      conversationIdBefore: beforeCtx.conversationIdBefore,
      urlBefore: beforeCtx.urlBefore,
      sendButtonEnabledBefore: beforeCtx.sendButtonEnabledBefore,
    });

    if (shouldStop()) {
      return { ok: false, reason: 'cancelled' };
    }

    const stopButtonVisible = !!findChatGPTStopButton();
    const stopAppearedAfterSend = stopButtonVisible && !beforeCtx.beforeStopButtonVisible;
    const snapshot = buildSendConfirmSnapshot(beforeCtx);
    const turnCountAfter = typeof getCurrentPageTurnCount === 'function'
      ? getCurrentPageTurnCount()
      : null;
    const turnIncreased = (
      turnCountBefore != null
      && turnCountAfter != null
      && Number(turnCountAfter) > Number(turnCountBefore)
    );
    const ok = confirmed.ok || turnIncreased || stopAppearedAfterSend;
    const reason = ok
      ? (
        turnIncreased
          ? 'turn_count_increased'
          : (stopAppearedAfterSend ? 'stop_button_appeared' : (confirmed.reason || 'confirmed'))
      )
      : 'send_click_not_confirmed';

    appendSendLogFields(ok ? '[SEND][CLICK_CONFIRMED]' : '[SEND][CLICK_NOT_CONFIRMED]', {
      attempt,
      ok: ok ? 1 : 0,
      reason,
      ...getComposerSendDiagnostics(),
      composer_cleared: snapshot.inputEmpty ? 1 : 0,
      stop_button_visible: stopButtonVisible ? 1 : 0,
      response_state: snapshot.responseState.response_state || '-',
      turn_count_before: turnCountBefore == null ? '-' : turnCountBefore,
      turn_count_after: turnCountAfter == null ? '-' : turnCountAfter,
    });

    appendSendLogFields('[SEND][VERIFY]', {
      attempt,
      ok: ok ? 1 : 0,
      reason,
      composer_cleared: snapshot.inputEmpty ? 1 : 0,
      stop_button_visible: stopButtonVisible ? 1 : 0,
      response_state: snapshot.responseState.response_state || '-',
      turn_count_before: turnCountBefore == null ? '-' : turnCountBefore,
      turn_count_after: turnCountAfter == null ? '-' : turnCountAfter,
    });

    return { ok, reason, snapshot };
  }

  function applyStableSendRetryableFlags(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }

    let reason = String(result.reason || '').trim();
    if (reason === 'voice_button') {
      reason = 'voice_button_only';
      result.reason = reason;
    }

    if (
      typeof sendPipelineIsRetryableReason === 'function'
      && sendPipelineIsRetryableReason(reason)
    ) {
      result.retryable = true;
      if (result.wait !== false) {
        result.wait = true;
      }
    }

    return result;
  }

  async function stableSendMessage(options = {}) {
    const text = String(options.text || '').trim();
    const sendExistingComposer = options.sendExistingComposer === true;
    const maxAttempts = Math.max(
      1,
      Number(options.maxAttempts || SEND_STABLE_RETRY_LIMIT_DEFAULT),
    );
    const intervalMs = Math.max(
      50,
      Number(options.intervalMs || SEND_STABLE_RETRY_INTERVAL_MS_DEFAULT),
    );
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const blockWhenResponding = options.blockWhenResponding !== false;
    let allowEnterFallbackWhenNoButton = options.allowEnterFallbackWhenNoButton === true;
    const source = String(options.source || 'stable-send');

    const result = {
      ok: false,
      reason: '',
      attempts: 0,
      usedFallbackEnter: false,
      source,
    };

    if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
      result.reason = 'page_navigating';
      appendSendLogFields('[SEND][FAILED]', { reason: result.reason, attempts: 0, last_error: '-' });
      return result;
    }

    if (shouldStop()) {
      result.reason = 'cancelled';
      appendSendLogFields('[SEND][FAILED]', { reason: result.reason, attempts: 0, last_error: '-' });
      return result;
    }

    const homeReadyToSend = typeof isHomeNewChatReadyToSendNow === 'function'
      && isHomeNewChatReadyToSendNow();
    const responseState = detectComposerResponseState();

    if (shouldBlockEnterFallbackForComposer(responseState)) {
      allowEnterFallbackWhenNoButton = false;
    }

    logSendPreSendGate({ source });

    if (blockWhenResponding && responseState.is_responding && !homeReadyToSend) {
      result.reason = 'assistant_busy';
      result.wait_reply = true;
      appendSendLogFields('[SEND][FAILED]', {
        reason: result.reason,
        attempts: 0,
        last_error: responseState.response_state_reason || 'assistant_busy',
      });
      return applyStableSendRetryableFlags(result);
    }

    const precheckSendability = evaluateComposerSendability(findChatGPTSendButton());
    appendSendLogFields('[SEND][CHECK]', {
      ...getSendLogContext({ source }),
      attempt: 0,
      send_mode_reason: precheckSendability.sendModeReason || '-',
    });

    if (
      (precheckSendability.hasAttachment || precheckSendability.textLen > 0)
      && !canReallyClickNativeSend({
        payload: composerHasPayloadInInput(),
        responseState,
        sendability: precheckSendability,
      })
    ) {
      const waitResult = await waitForNativeSendButtonReady({
        source,
        shouldStop,
        waitMs: Number(options.nativeButtonWaitMs || SEND_TEXT_BUTTON_WAIT_MS),
      });

      if (!waitResult.ok) {
        result.reason = waitResult.reason || 'native-send-button-timeout';
        result.retryable = waitResult.retryable !== false;
        result.wait_send = waitResult.wait_send === true;
        result.wait_reply = waitResult.wait_reply === true;
        appendSendLogFields('[SEND][BLOCKED_WAIT_BUTTON]', {
          reason: result.reason,
          source,
          ...getComposerSendDiagnostics(),
        });
        appendSendLogFields('[SEND][FAILED]', {
          reason: result.reason,
          attempts: 0,
          last_error: responseState.response_state_reason || result.reason,
        });
        return applyStableSendRetryableFlags(result);
      }
    }

    if (
      precheckSendability.textLen <= 0
      && !precheckSendability.hasAttachment
      && !precheckSendability.realSendButtonEnabled
    ) {
      result.reason = 'empty_text_and_no_attachment';
      appendSendLogFields('[SEND][SKIP_EMPTY_NO_ATTACHMENT]', {
        reason: result.reason,
        attempts: 0,
        ...getComposerSendDiagnostics(),
      });
      return result;
    }

    const precheckReason = String(responseState.response_state_reason || '').trim();
    if (
      precheckReason === 'payload_ready_but_send_button_missing'
      || precheckReason === 'attachment_ready_but_send_button_missing'
      || (
        precheckReason === 'attachment_processing'
        && !precheckSendability.hasAttachment
        && !precheckSendability.realSendButtonEnabled
      )
    ) {
      result.reason = precheckReason === 'attachment_processing'
        ? 'payload_ready_but_send_button_missing'
        : precheckReason;
      appendSendLogFields('[SEND][FAILED]', {
        reason: result.reason,
        attempts: 0,
        last_error: precheckReason,
      });
      return applyStableSendRetryableFlags(result);
    }

    if (homeReadyToSend) {
      appendSendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_ready_to_send');
    }

    ChatInputStateRuntime.sendInProgress = true;
    updateChatInputStateBadge();

    let precheckLogged = false;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        result.attempts = attempt;

        if (shouldStop()) {
          result.reason = 'cancelled';
          break;
        }

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          result.reason = 'page_navigating';
          break;
        }

        const composer = findChatGPTComposer();
        const composerTextNow = composer ? getComposerTextFromElement(composer) : '';
        const isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        let sendButton = findChatGPTSendButton();
        let sendButtonDisabled = isSendButtonDisabled(sendButton);

        if (!precheckLogged) {
          appendSendLogFields('[SEND][PRECHECK]', {
            composer_found: composer ? 1 : 0,
            composer_text_len: String(composerTextNow || '').length,
            has_attachment: hasComposerAttachment() ? 1 : 0,
            send_button_found: sendButton ? 1 : 0,
            send_button_disabled: sendButtonDisabled ? 1 : 0,
            is_responding: isResponding ? 1 : 0,
          });
          precheckLogged = true;
        }

        if (isResponding && blockWhenResponding && !homeReadyToSend) {
          result.reason = 'assistant_busy';
          result.wait_reply = true;
          break;
        }

        if (!(composer instanceof HTMLElement)) {
          result.reason = 'composer_not_found';
          appendSendLogFields('[SEND][ATTEMPT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            button_selector: '-',
            composer_type: 'missing',
          });
          await sleep(intervalMs);
          continue;
        }

        const composerType = composer.matches && composer.matches('textarea,input')
          ? 'textarea'
          : (composer.isContentEditable ? 'contenteditable' : String(composer.tagName || '').toLowerCase());

        if (
          typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading()
        ) {
          const attachWait = await waitAttachmentsStableForSend(
            SEND_ATTACH_WAIT_DEFAULT_MS,
            shouldStop,
            { source, onPreSendStatus: options.onPreSendStatus },
          );

          if (!attachWait.ok) {
            result.reason = attachWait.reason || 'attachment_not_ready';
            appendSendLogFields('[SEND][ATTEMPT]', {
              attempt,
              max_attempts: maxAttempts,
              reason: result.reason,
              button_selector: '-',
              composer_type: composerType,
            });
            await sleep(intervalMs);
            continue;
          }

          if (attachWait.reason === 'sent_by_attach_wait_click') {
            const beforeText = getComposerTextFromElement(composer);
            const beforeStopButton = findChatGPTStopButton();
            const confirmCtx = buildStableSendConfirmCtx(beforeText, beforeStopButton);
            const verifiedAttachWait = await verifySendStarted(confirmCtx, { shouldStop, attempt });
            if (verifiedAttachWait.ok) {
              result.ok = true;
              result.reason = 'sent_by_attach_wait_click';
              ChatInputStateRuntime.waitingForReply = true;
              return result;
            }
            result.reason = verifiedAttachWait.reason || 'send_not_confirmed';
            await sleep(intervalMs);
            continue;
          }
        }

        focusComposer(composer);
        await sleep(80);

        if (text && !sendExistingComposer) {
          setComposerText(composer, text);
          await sleep(80);
        }

        let sendability = evaluateComposerSendability(sendButton);
        appendSendLogFields('[SEND][CHECK]', {
          ...getSendLogContext({ source }),
          attempt,
          send_mode_reason: sendability.sendModeReason || '-',
        });

        if (
          sendability.textLen <= 0
          && !sendability.hasAttachment
          && !sendability.realSendButtonEnabled
        ) {
          result.reason = 'empty_text_and_no_attachment';
          appendSendLogFields('[SEND][SKIP_EMPTY_NO_ATTACHMENT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            ...getComposerSendDiagnostics(),
            composer_type: composerType,
          });
          break;
        }

        const requireInjectedText = !!text && !sendExistingComposer;
        const attachmentOnlyPath = sendability.textLen <= 0 && sendability.hasAttachment;
        const nativeButtonOnlyPath = sendability.textLen <= 0
          && !sendability.hasAttachment
          && sendability.realSendButtonEnabled;

        if (requireInjectedText && !attachmentOnlyPath && !nativeButtonOnlyPath) {
          const textReady = await waitUntilPredicate(
            () => hasRealComposerText(),
            SEND_TEXT_BUTTON_WAIT_MS,
            SEND_TEXT_BUTTON_POLL_MS,
            shouldStop,
          );

          if (!textReady) {
            result.reason = 'composer_text_not_ready';
            appendSendLogFields('[SEND][ATTEMPT]', {
              attempt,
              max_attempts: maxAttempts,
              reason: result.reason,
              ...getComposerSendDiagnostics(),
              composer_type: composerType,
            });
            await sleep(intervalMs);
            continue;
          }

          appendSendLogFields('[COMPOSER][TEXT_READY]', getComposerSendDiagnostics());
        }

        sendability = evaluateComposerSendability(sendButton);
        if (
          sendability.textLen <= 0
          && !sendability.hasAttachment
          && !sendability.realSendButtonEnabled
        ) {
          result.reason = 'empty_text_and_no_attachment';
          appendSendLogFields('[SEND][SKIP_EMPTY_NO_ATTACHMENT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            ...getComposerSendDiagnostics(),
            composer_type: composerType,
          });
          break;
        }

        if (attachmentOnlyPath) {
          result.sendModeReason = 'attachment_only_send';
        } else if (nativeButtonOnlyPath) {
          result.sendModeReason = 'native_send_button_enabled_without_text';
        }

        const currentText = getComposerTextFromElement(composer);
        const currentTextTrimmed = String(currentText || '').trim();
        const hasPayloadToSend = !!(
          currentTextTrimmed
          || sendability.hasAttachment
          || sendability.realSendButtonEnabled
        );

        if (!hasPayloadToSend) {
          result.reason = 'empty_text_and_no_attachment';
          appendSendLogFields('[SEND][SKIP_EMPTY_NO_ATTACHMENT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            ...getComposerSendDiagnostics(),
            composer_type: composerType,
          });
          break;
        }

        appendSendLogFields('[COMPOSER][SEND_BUTTON_WAIT]', getComposerSendDiagnostics());
        const buttonReady = await waitUntilPredicate(
          () => {
            const attachmentUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
              && ComposerApi.isAttachmentStillUploading();
            if (attachmentUploading) {
              return false;
            }
            const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
              ? getComposerSendButtonSnapshot({ silent: true })
              : { ready: false };
            if (sendSnap.ready === true) {
              return true;
            }
            return evaluateComposerSendability(findChatGPTSendButton()).realSendButtonEnabled;
          },
          SEND_TEXT_BUTTON_WAIT_MS,
          SEND_TEXT_BUTTON_POLL_MS,
          shouldStop,
        );

        if (!buttonReady) {
          result.reason = hasVoiceComposerButtonOnly()
            ? 'voice_button_only'
            : 'send_button_not_ready_after_text';
          result.retryable = result.reason === 'voice_button_only';
          appendSendLogFields('[SEND][ATTEMPT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            ...getComposerSendDiagnostics(),
            composer_type: composerType,
          });
          await sleep(intervalMs);
          continue;
        }

        appendSendLogFields('[COMPOSER][SEND_BUTTON_READY]', getComposerSendDiagnostics());

        sendButton = findChatGPTSendButton();
        sendButtonDisabled = isSendButtonDisabled(sendButton);

        if (!(sendButton instanceof HTMLButtonElement)) {
          const hasPayload = !!(
            currentTextTrimmed
            || sendability.hasAttachment
            || sendability.realSendButtonEnabled
          );
          const voiceOnly = hasVoiceComposerButtonOnly();

          appendSendLogFields('[SEND][ATTEMPT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: voiceOnly ? 'voice_button_only' : 'send_button_not_found',
            button_selector: '-',
            composer_type: composerType,
            has_payload: hasPayload ? 1 : 0,
            allow_enter_fallback: allowEnterFallbackWhenNoButton ? 1 : 0,
          });

          if (voiceOnly) {
            result.reason = 'voice_button_only';
            result.retryable = true;
            await sleep(intervalMs);
            continue;
          }

          if (allowEnterFallbackWhenNoButton && hasPayload) {
            if (applyEnterFallbackBlockIfNeeded(result, {
              source,
              attempt,
              composer_type: composerType,
              trigger: 'send_button_not_found',
            })) {
              await sleep(intervalMs);
              continue;
            }

            const beforeTextNoButton = getComposerTextFromElement(composer);
            const beforeStopNoButton = findChatGPTStopButton();
            const confirmCtxNoButton = buildStableSendConfirmCtx(
              beforeTextNoButton,
              beforeStopNoButton,
            );

            focusComposer(composer);

            appendSendLogFields('[SEND][ENTER_FALLBACK]', {
              attempt,
              composer_type: composerType,
              reason: 'send_button_not_found',
              mode: 'ctrl_enter',
            });

            dispatchEnterSend(composer, 'ctrl_enter');
            result.usedFallbackEnter = true;

            let verifiedNoButtonEnter = await verifySendStarted(confirmCtxNoButton, {
              shouldStop,
              attempt,
            });

            if (!verifiedNoButtonEnter.ok) {
              appendSendLogFields('[SEND][ENTER_FALLBACK]', {
                attempt,
                composer_type: composerType,
                reason: 'send_button_not_found',
                mode: 'enter',
              });

              dispatchEnterSend(composer, 'enter');

              verifiedNoButtonEnter = await verifySendStarted(confirmCtxNoButton, {
                shouldStop,
                attempt,
              });
            }

            if (verifiedNoButtonEnter.ok) {
              result.ok = true;
              result.reason = 'sent_by_enter_fallback_no_button';
              ChatInputStateRuntime.waitingForReply = true;
              return result;
            }

            result.reason = verifiedNoButtonEnter.reason || 'send_button_not_found_enter_fallback_failed';
            if (result.reason === 'send_not_confirmed' || result.reason === 'send_click_not_confirmed') {
              result.reason = 'enter_fallback_failed';
            }

            appendSendLogFields('[SEND][ENTER_FALLBACK_FAILED]', {
              attempt,
              reason: result.reason,
            });
          } else {
            result.reason = 'send_button_not_found';
          }

          await sleep(intervalMs);
          continue;
        }

        const sendTestId = String(sendButton.getAttribute('data-testid') || '-');
        const sendInfo = {
          selector: sendTestId !== '-'
            ? `button[data-testid="${sendTestId}"]`
            : (sendButton.id ? `button#${sendButton.id}` : 'button'),
          aria: String(sendButton.getAttribute('aria-label') || '-'),
          disabled: sendButtonDisabled,
        };

        if (sendButtonDisabled) {
          const disabledWaitMs = Math.max(
            intervalMs,
            Number(options.disabledButtonEnterFallbackMs || 3000),
          );
          const disabledStartedAt = options._disabledButtonWaitStartedAt || Date.now();
          if (!options._disabledButtonWaitStartedAt) {
            options._disabledButtonWaitStartedAt = disabledStartedAt;
          }

          if (Date.now() - disabledStartedAt >= disabledWaitMs) {
            if (applyEnterFallbackBlockIfNeeded(result, {
              source,
              attempt,
              composer_type: composerType,
              trigger: 'send_button_disabled_timeout',
            })) {
              await sleep(intervalMs);
              continue;
            }

            appendSendLogFields('[SEND][ENTER_FALLBACK]', {
              attempt,
              composer_type: composerType,
              reason: 'send_button_disabled_timeout',
            });

            const beforeTextDisabled = getComposerTextFromElement(composer);
            const beforeStopDisabled = findChatGPTStopButton();
            const confirmCtxDisabled = buildStableSendConfirmCtx(
              beforeTextDisabled,
              beforeStopDisabled,
            );

            focusComposer(composer);
            dispatchEnterSend(composer, 'ctrl_enter');
            result.usedFallbackEnter = true;

            let verifiedDisabledEnter = await verifySendStarted(confirmCtxDisabled, {
              shouldStop,
              attempt,
            });
            if (!verifiedDisabledEnter.ok) {
              dispatchEnterSend(composer, 'enter');
              verifiedDisabledEnter = await verifySendStarted(confirmCtxDisabled, {
                shouldStop,
                attempt,
              });
            }

            if (verifiedDisabledEnter.ok) {
              result.ok = true;
              result.reason = 'sent_by_enter_fallback_disabled_button';
              ChatInputStateRuntime.waitingForReply = true;
              return result;
            }

            result.reason = verifiedDisabledEnter.reason || 'send_not_confirmed';
            await sleep(intervalMs);
            continue;
          }

          result.reason = 'send_button_disabled';
          appendSendLogFields('[SEND][ATTEMPT]', {
            attempt,
            max_attempts: maxAttempts,
            reason: result.reason,
            button_selector: sendInfo.selector || '-',
            composer_type: composerType,
          });
          await sleep(intervalMs);
          continue;
        }

        options._disabledButtonWaitStartedAt = 0;

        const beforeText = getComposerTextFromElement(composer);
        const beforeStopButton = findChatGPTStopButton();
        const confirmCtx = buildStableSendConfirmCtx(
          beforeText,
          beforeStopButton,
        );

        appendSendLogFields('[SEND][ATTEMPT]', {
          attempt,
          max_attempts: maxAttempts,
          reason: 'click_send',
          button_selector: sendInfo.selector || '-',
          composer_type: composerType,
        });

        appendSendLogFields('[SEND][CLICK_NATIVE]', {
          attempt,
          button_text: String(sendButton.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '-',
          aria_label: sendInfo.aria || '-',
          disabled: 0,
        });

        const clickResult = clickSendButton(sendButton, source);
        if (!clickResult.ok) {
          result.reason = (
            clickResult.reason === 'voice_button'
            || clickResult.reason === 'voice_button_only'
          )
            ? 'voice_button_only'
            : (clickResult.reason || 'send_click_exception');
          if (result.reason === 'voice_button_only') {
            result.retryable = true;
          }
          appendSendTaskStageLog(
            `[SEND_TASK][FAILED] stage=native-click error=${result.reason} source=${String(source || '-')} attempt=${attempt}`,
          );
          await sleep(intervalMs);
          continue;
        }
        appendSendLogFields('[SEND][CLICK]', {
          ...getSendLogContext({ source }),
          attempt,
          click_result: clickResult.reason || 'clicked',
        });

        const verifiedClick = await verifySendStarted(confirmCtx, {
          shouldStop,
          attempt,
          timeoutMs: SEND_STABLE_VERIFY_TIMEOUT_MS,
        });
        if (verifiedClick.ok) {
          appendSendTaskStageLog(
            `[SEND_TASK][WAITING_REPLY] reason=native-clicked source=${String(source || '-')} attempt=${attempt}`,
          );
          result.ok = true;
          result.reason = result.sendModeReason === 'attachment_only_send'
            ? 'attachment_only_send'
            : (
              result.sendModeReason === 'native_send_button_enabled_without_text'
                ? 'native_send_button_enabled_without_text'
                : 'sent_by_click'
            );
          ChatInputStateRuntime.waitingForReply = true;
          return result;
        }

        if (currentTextTrimmed.length > 0) {
          result.reason = verifiedClick.reason || 'send_click_not_confirmed';
          await sleep(intervalMs);
          continue;
        }

        if (!applyEnterFallbackBlockIfNeeded(result, {
          source,
          attempt,
          composer_type: composerType,
          trigger: 'post_click_enter_fallback',
        })) {
        focusComposer(composer);
        appendSendLogFields('[SEND][ENTER_FALLBACK]', {
          attempt,
          composer_type: composerType,
        });

        dispatchEnterSend(composer, 'ctrl_enter');
        result.usedFallbackEnter = true;

        let verifiedEnter = await verifySendStarted(confirmCtx, {
          shouldStop,
          attempt,
          timeoutMs: SEND_STABLE_VERIFY_TIMEOUT_MS,
        });
        if (!verifiedEnter.ok) {
          dispatchEnterSend(composer, 'enter');
          verifiedEnter = await verifySendStarted(confirmCtx, {
            shouldStop,
            attempt,
            timeoutMs: SEND_STABLE_VERIFY_TIMEOUT_MS,
          });
        }

        if (verifiedEnter.ok) {
          result.ok = true;
          result.reason = result.usedFallbackEnter ? 'sent_by_enter_fallback' : 'sent';
          ChatInputStateRuntime.waitingForReply = true;
          return result;
        }

        result.reason = verifiedEnter.reason || 'send_click_not_confirmed';
        }
        await sleep(intervalMs);
      }

      if (!result.reason) {
        result.reason = 'send_not_confirmed';
      }

      if (
        !result.ok
        && result.attempts >= maxAttempts
        && (
          !result.reason
          || result.reason === 'send_not_confirmed'
          || result.reason === 'send_click_not_confirmed'
        )
      ) {
        result.reason = 'stable_send_timeout';
      }

      if (result.reason === 'send_button_disabled') {
        const payloadStillExists = !!(
          hasComposerAttachment()
          || String(typeof ComposerApi.getComposerText === 'function' ? ComposerApi.getComposerText() || '' : '').trim()
        );
        const responseStateNow = detectComposerResponseState();

        if (payloadStillExists && !(responseStateNow && responseStateNow.is_responding)) {
          const attachWaitResult = await waitAndClickSendFromAttachWait(shouldStop, { source });
          if (attachWaitResult.ok) {
            const composer = findChatGPTComposer();
            const beforeText = getComposerTextFromElement(composer);
            const beforeStopButton = findChatGPTStopButton();
            const confirmCtx = buildStableSendConfirmCtx(beforeText, beforeStopButton);
            const verifiedAttachWait = await verifySendStarted(confirmCtx, {
              shouldStop,
              attempt: result.attempts,
            });

            if (verifiedAttachWait.ok) {
              result.ok = true;
              result.reason = 'sent_by_attach_wait_click';
              ChatInputStateRuntime.waitingForReply = true;
              return result;
            }

            result.reason = verifiedAttachWait.reason || 'send_not_confirmed';
          } else {
            result.reason = attachWaitResult.reason || 'send_button_wait_timeout';
          }
        }
      }

      appendSendLogFields('[SEND][FAILED]', {
        reason: result.reason,
        attempts: result.attempts,
        last_error: result.reason,
      });

      return applyStableSendRetryableFlags(result);
    } catch (err) {
      logSendFlowError('stableSendMessage', err, { source });
      result.reason = 'send_exception';
      result.error = err && err.message ? err.message : String(err);
      appendSendLogFields('[SEND][FAILED]', {
        reason: result.reason,
        attempts: result.attempts,
        last_error: result.error,
      });
      return applyStableSendRetryableFlags(result);
    } finally {
      ChatInputStateRuntime.sendInProgress = false;
      updateChatInputStateBadge();
    }
  }

  function isWeakComposerResponseState(responseState) {
    if (!responseState || typeof responseState !== 'object') {
      return true;
    }

    const state = String(responseState.response_state || '').toLowerCase();
    return ['composing', 'idle', 'ready', 'inputable', 'not_ready'].includes(state);
  }

  function isResponseStateIndicatingSendTriggered(responseState) {
    if (!responseState || typeof responseState !== 'object') {
      return false;
    }

    if (isWeakComposerResponseState(responseState)) {
      return false;
    }

    if (responseState.is_responding) {
      return true;
    }

    const state = String(responseState.response_state || '').toLowerCase();
    const reason = String(responseState.response_state_reason || '').toLowerCase();

    return ['generating', 'streaming', 'submitted', 'responding'].includes(state)
      || /streaming|submitted|responding|assistant_busy/.test(reason);
  }

  function doesLatestUserMatchContent(latest, contentProbe) {
    if (!latest || latest.role !== 'user' || !contentProbe) {
      return false;
    }

    return String(latest.text || '').trim().includes(contentProbe);
  }

  function buildSendConfirmSnapshot(ctx) {
    const attachmentCountNow = typeof ComposerApi.countAttachmentChips === 'function'
      ? ComposerApi.countAttachmentChips()
      : 0;
    const latestRaw = getLatestConversationMessageRecordFast({ preferAssistant: false, includeHidden: false })
      || getLatestConversationMessageRecord({ preferAssistant: false, forceFullScan: true });
    const latest = stripMessageRecordForCache(latestRaw);
    const latestKey = buildMessageRecordKey(latest);
    const beforeLatestKey = String(ctx.beforeLatestKey || '');
    const latestUserChanged = !!beforeLatestKey && !!latestKey && latestKey !== beforeLatestKey;
    const composerText = ComposerApi.getComposerText();
    const sendBtn = typeof ComposerApi.findSendButton === 'function'
      ? ComposerApi.findSendButton({ silent: true })
      : null;
    const sendButtonEnabled = !!(sendBtn && ComposerApi.isSendButtonReady(sendBtn));
    const responseState = detectComposerResponseState();
    const assistantBusy = ComposerApi.isAssistantLikelyBusy();
    const conversationId = parseConversationIdFromPath(location.pathname || '') || '';
    const contentProbe = String(ctx.contentProbe || '');

    return {
      composerText,
      inputEmpty: !String(composerText || '').trim(),
      attachmentCountNow,
      latest,
      latestKey,
      latestUserChanged,
      latestUserMatchesContent: doesLatestUserMatchContent(latest, contentProbe),
      userBubbleFound: latestUserChanged || doesLatestUserMatchContent(latest, contentProbe),
      sendButtonEnabled,
      sendButtonDisabled: !sendButtonEnabled,
      responseState,
      responseStateTriggered: isResponseStateIndicatingSendTriggered(responseState),
      assistantBusy,
      conversationId,
      url: location.href || '',
      pageInstanceId: getToolboxPageInstanceId(),
    };
  }

  function hasSendProgressSinceBaseline(snapshot, baseline) {
    if (!baseline || !snapshot) {
      return false;
    }

    if (snapshot.inputEmpty && !baseline.inputEmpty) {
      return true;
    }

    if (snapshot.latestUserChanged && !baseline.latestUserChanged) {
      return true;
    }

    if (snapshot.latestUserMatchesContent && !baseline.latestUserMatchesContent) {
      return true;
    }

    if (snapshot.responseStateTriggered && !baseline.responseStateTriggered) {
      return true;
    }

    if (snapshot.assistantBusy && !baseline.assistantBusy) {
      return true;
    }

    if (snapshot.conversationId && !baseline.conversationId) {
      return true;
    }

    return false;
  }

  function evaluateSendConfirmed(snapshot, ctx) {
    const contentText = String(ctx.contentText || '').trim();
    const contentProbe = String(ctx.contentProbe || '');
    const attachmentCountBefore = Number(ctx.attachmentCountBeforeSend || 0);
    const hadTextPayload = !!contentText;
    const hadAttachmentPayload = attachmentCountBefore > 0;

    if (snapshot.inputEmpty && (hadTextPayload || hadAttachmentPayload)) {
      return { ok: true, reason: 'input_cleared' };
    }

    if (snapshot.latestUserChanged) {
      return { ok: true, reason: 'user_bubble_new' };
    }

    if (snapshot.latestUserMatchesContent && contentProbe) {
      return { ok: true, reason: 'user_bubble_text_matches' };
    }

    if (snapshot.responseStateTriggered && !isWeakComposerResponseState(snapshot.responseState)) {
      return { ok: true, reason: `response_state_${snapshot.responseState.response_state || 'triggered'}` };
    }

    if (
      snapshot.assistantBusy
      && (
        snapshot.inputEmpty
        || snapshot.latestUserChanged
        || snapshot.latestUserMatchesContent
      )
    ) {
      return { ok: true, reason: 'assistant_busy_after_send' };
    }

    if (ctx.conversationSwitchSeen && snapshot.conversationId) {
      if (snapshot.inputEmpty || snapshot.userBubbleFound || snapshot.responseStateTriggered || snapshot.assistantBusy) {
        return { ok: true, reason: 'conversation_switched_confirmed' };
      }
    }

    if (attachmentCountBefore > 0 && snapshot.attachmentCountNow === 0) {
      if (snapshot.inputEmpty || snapshot.assistantBusy || snapshot.latestUserChanged) {
        return { ok: true, reason: 'attachments_sent' };
      }
    }

    return { ok: false, reason: '' };
  }

  function pickSendNotConfirmedReason(snapshot, ctx) {
    const signals = {
      input_cleared: snapshot.inputEmpty,
      user_bubble: snapshot.userBubbleFound,
      responding: snapshot.responseStateTriggered || snapshot.assistantBusy,
      conversation_updated: !!snapshot.conversationId && (
        snapshot.conversationId !== String(ctx.conversationIdBefore || '')
        || ctx.conversationSwitchSeen
      ),
      send_button_changed: snapshot.sendButtonDisabled && ctx.sendButtonEnabledBefore,
      generating: snapshot.assistantBusy,
    };

    const anySuccessSignal = signals.input_cleared
      || signals.user_bubble
      || signals.responding
      || signals.conversation_updated
      || signals.generating;

    if (anySuccessSignal) {
      return 'timeout';
    }

    if (ctx.conversationSwitchPending && !ctx.conversationSwitchSeen) {
      return 'conversation_switch_timeout';
    }

    if (!snapshot.inputEmpty && ctx.hadTextPayload) {
      return 'input_not_cleared';
    }

    if (!signals.user_bubble) {
      return 'no_user_bubble_after_click';
    }

    return 'timeout';
  }

  function appendSendConfirmWaitLog(elapsedMs, snapshot) {
    appendSendLog(
      `[SEND][CONFIRM_WAIT] elapsed=${elapsedMs} input_empty=${snapshot.inputEmpty ? 1 : 0} `
      + `user_bubble_found=${snapshot.userBubbleFound ? 1 : 0} response_state=${snapshot.responseState.response_state || '-'} `
      + `conversation_id=${snapshot.conversationId || '-'} send_button_enabled=${snapshot.sendButtonEnabled ? 1 : 0}`,
    );
  }

  function notifyPreSendStatus(options, text) {
    if (typeof options.onPreSendStatus === 'function') {
      options.onPreSendStatus(String(text || ''));
    }
  }

  async function waitAttachmentsStableForSend(timeoutMs, shouldStop, options = {}) {
    const startedAt = Date.now();

    notifyPreSendStatus(options, '附件仍在处理中，等待发送...');

    while (Date.now() - startedAt < timeoutMs) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const elapsed = Date.now() - startedAt;
      const scan = findComposerSendButtonDetailed();
      appendSendLogFields('[SEND][ATTACH_READY]', {
        elapsed,
        button_selector: scan.buttonSelector || '-',
        disabled: scan.disabled ? 1 : 0,
        composer_text_len: scan.composerTextLen,
        has_attachment: scan.hasAttachment ? 1 : 0,
        response_state: scan.responseState || '-',
        response_state_reason: scan.responseStateReason || '-',
      });

      if (scan.button && !scan.disabled && hasRealComposerText()) {
        appendSendLogFields('[SEND][ATTACH_READY_CLICK]', {
          elapsed,
          button_selector: scan.buttonSelector || '-',
          source: String(options.source || 'stable-send'),
          ...getComposerSendDiagnostics(),
        });
        const clicked = clickSendButton(scan.button, `${String(options.source || 'stable-send')}:attach_wait`);
        if (clicked.ok) {
          return { ok: true, reason: 'sent_by_attach_wait_click' };
        }
      }

      const attachmentProcessing = typeof ComposerApi.isAttachmentStillUploading === 'function'
        && ComposerApi.isAttachmentStillUploading();
      appendSendLog(
        `[SEND][ATTACH_WAIT] elapsed=${elapsed} status=${attachmentProcessing ? 'processing' : 'ready'} button_found=${scan.button ? 1 : 0} disabled=${scan.disabled ? 1 : 0}`,
      );

      if (!attachmentProcessing && !scan.hasAttachment) {
        return { ok: true, reason: 'attachment_stable' };
      }

      await sleep(SEND_BUTTON_RETRY_INTERVAL_MS);
    }

    return { ok: false, reason: 'attachment_not_ready' };
  }

  async function waitSendButtonReadyForSend(timeoutMs, shouldStop, options = {}) {
    const startedAt = Date.now();
    let lastLogAt = 0;

    notifyPreSendStatus(options, '正在等待 ChatGPT 发送按钮可用...');

    while (Date.now() - startedAt < timeoutMs) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      let responseState = {};
      try {
        responseState = detectComposerResponseState();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] waitSendButtonReadyForSend response_state failed', err);
        appendSendLog(`[SEND][WAIT_BUTTON][error] response_state error=${errText}`);
      }

      const canSendNow = typeof ComposerApi.canSendNow === 'function'
        && ComposerApi.canSendNow();

      const sendBtn = typeof ComposerApi.findSendButton === 'function'
        ? ComposerApi.findSendButton({ silent: true })
        : null;

      const sendButtonReady = !!(
        sendBtn
        && typeof ComposerApi.isSendButtonReady === 'function'
        && ComposerApi.isSendButtonReady(sendBtn)
      );

      if (canSendNow || sendButtonReady) {
        return { ok: true, reason: 'send_button_ready' };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed - lastLogAt >= 2000) {
        appendSendLog(
          `[SEND][WAIT_BUTTON] elapsed=${elapsed} canSendNow=${canSendNow ? 1 : 0} `
          + `buttonReady=${sendButtonReady ? 1 : 0} `
          + `response_state=${responseState.response_state || '-'} `
          + `reason=${responseState.response_state_reason || '-'}`,
        );
        lastLogAt = elapsed;
      }

      await sleep(SEND_CONFIRM_POLL_MS);
    }

    return { ok: false, reason: 'send_button_wait_timeout' };
  }

  function isSendButtonReadyForPreSend() {
    const sendBtn = typeof ComposerApi.findSendButton === 'function'
      ? ComposerApi.findSendButton({ silent: true })
      : null;

    if (!sendBtn) {
      return false;
    }

    if (typeof ComposerApi.canSendNow === 'function' && ComposerApi.canSendNow()) {
      return true;
    }

    return typeof ComposerApi.isSendButtonReady === 'function'
      && ComposerApi.isSendButtonReady(sendBtn);
  }

  async function runPreSendChecks(options = {}) {
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const expectedText = String(options.expectedText || '').trim();
    const requireTextSynced = options.requireTextSynced === true;
    const attachmentWaitTimeoutMs = Number(options.attachmentWaitTimeoutMs || SEND_ATTACH_WAIT_DEFAULT_MS);
    const allowSendButtonWait = options.allowSendButtonWait === true;

    if (shouldStop()) {
      return { ok: false, reason: 'cancelled' };
    }

    const composer = typeof ComposerApi.getComposer === 'function' ? ComposerApi.getComposer() : null;
    if (!(composer instanceof HTMLElement)) {
      return { ok: false, reason: 'composer_not_found' };
    }

    if (typeof ComposerApi.canAcceptInput === 'function' && !ComposerApi.canAcceptInput()) {
      return { ok: false, reason: 'composer_not_inputable' };
    }

    if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: 'composer_disabled' };
    }

    if (requireTextSynced && expectedText) {
      const synced = typeof ComposerApi.waitForComposerTextSynced === 'function'
        ? await ComposerApi.waitForComposerTextSynced(expectedText, SEND_TEXT_SYNC_TIMEOUT_MS, { shouldStop })
        : { ok: ComposerApi.isComposerTextSynced(expectedText) };

      if (!synced.ok) {
        return { ok: false, reason: synced.reason || 'composer_text_not_synced' };
      }
    }

    if (typeof ComposerApi.isAttachmentStillUploading === 'function' && ComposerApi.isAttachmentStillUploading()) {
      const attachWait = await waitAttachmentsStableForSend(attachmentWaitTimeoutMs, shouldStop, options);
      if (!attachWait.ok) {
        return { ok: false, reason: attachWait.reason || 'attachment_not_ready' };
      }
    }

    const sendBtn = typeof ComposerApi.findSendButton === 'function'
      ? ComposerApi.findSendButton()
      : null;

    if (!sendBtn) {
      if (allowSendButtonWait) {
        return { ok: true, reason: 'pre_send_ready_wait_send_button' };
      }
      return { ok: false, reason: 'send_button_not_found' };
    }

    if (!ComposerApi.isSendButtonReady(sendBtn) && !allowSendButtonWait) {
      return { ok: false, reason: 'button_disabled' };
    }

    return { ok: true, reason: 'pre_send_ready' };
  }

  async function waitForSendProgressSinceBaseline(baseline, ctx, timeoutMs, shouldStop) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const snapshot = buildSendConfirmSnapshot(ctx);
      if (hasSendProgressSinceBaseline(snapshot, baseline, ctx)) {
        return { ok: true, snapshot };
      }

      const confirmed = evaluateSendConfirmed(snapshot, ctx);
      if (confirmed.ok) {
        return { ok: true, snapshot, reason: confirmed.reason };
      }

      await sleep(SEND_CONFIRM_POLL_MS);
    }

    return { ok: false, reason: 'no_progress' };
  }

  async function performSendActionsWithFallback(ctx, shouldStop) {
    const baseline = buildSendConfirmSnapshot(ctx);
    ctx.baselineSnapshot = baseline;

    const methods = [];

    async function runActionAndConfirm(method, actionFn, waitMs = SEND_FALLBACK_WAIT_MS) {
      if (shouldStop()) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }

      appendSendLog(`[SEND][ACTION] method=${method}`);
      methods.push(method);

      let actionOk = false;

      try {
        actionOk = await actionFn();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send action failed', {
          method,
          error_type: err && err.name ? err.name : 'Error',
          error: errText,
          stack: err && err.stack ? err.stack : '',
        });
        appendSendLog(`[SEND][ACTION_FAILED] method=${method} error=${errText}`);
        actionOk = false;
      }

      if (!actionOk) {
        appendSendLog(`[SEND][ACTION_FAILED] method=${method} reason=action_return_false`);
        return { ok: false, reason: `${method}_failed` };
      }

      const progress = await waitForSendProgressSinceBaseline(
        baseline,
        ctx,
        waitMs,
        shouldStop,
      );

      if (progress.ok) {
        return {
          ok: true,
          methods,
          snapshot: progress.snapshot,
          reason: progress.reason || method,
        };
      }

      appendSendLog(
        `[SEND][ACTION_NO_PROGRESS] method=${method} reason=${progress.reason || 'no_progress'}`,
      );

      return {
        ok: false,
        reason: progress.reason || 'no_progress',
      };
    }

    const buttonClick = await runActionAndConfirm('button_click', () => {
      return ComposerApi.clickSend();
    });

    if (buttonClick.ok) {
      return buttonClick;
    }

    if (shouldStop()) {
      return { ok: false, reason: 'cancelled', methods };
    }

    const ctrlEnter = await runActionAndConfirm('ctrl_enter_fallback', () => {
      if (typeof ComposerApi.dispatchComposerSendKeyboard !== 'function') {
        return false;
      }
      return ComposerApi.dispatchComposerSendKeyboard('ctrl_enter');
    });

    if (ctrlEnter.ok) {
      return ctrlEnter;
    }

    if (shouldStop()) {
      return { ok: false, reason: 'cancelled', methods };
    }

    const enter = await runActionAndConfirm('enter_fallback', () => {
      if (typeof ComposerApi.dispatchComposerSendKeyboard !== 'function') {
        return false;
      }
      return ComposerApi.dispatchComposerSendKeyboard('enter');
    });

    if (enter.ok) {
      return enter;
    }

    if (shouldStop()) {
      return { ok: false, reason: 'cancelled', methods };
    }

    const nativeEnter = await runActionAndConfirm(
      'native_enter_fallback',
      async () => {
        if (
          typeof ComposerApi.focusComposerForNativeSend !== 'function'
          || !ComposerApi.focusComposerForNativeSend()
        ) {
          appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=composer-focus-failed');
          return false;
        }

        if (
          typeof BridgeModule === 'undefined'
          || !BridgeModule
          || typeof BridgeModule.sendSystemHotkey !== 'function'
        ) {
          appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=bridge-unavailable');
          return false;
        }

        await sleep(150);
        await BridgeModule.sendSystemHotkey('enter');
        return true;
      },
      Math.max(SEND_FALLBACK_WAIT_MS, 4000),
    );

    if (nativeEnter.ok) {
      return nativeEnter;
    }

    return {
      ok: false,
      reason: 'no_send_progress_after_actions',
      methods,
    };
  }

  function resolveSendButtonEnabledBefore(explicitValue) {
    if (typeof explicitValue === 'boolean') {
      return explicitValue;
    }

    const currentSendButton = findChatGPTSendButton();
    return !!(
      currentSendButton
      && currentSendButton instanceof HTMLButtonElement
      && !isSendButtonDisabled(currentSendButton)
    );
  }

  function logSendConfirmFailed(snapshot, ctx, reason) {
    const turnCountAfter = typeof getCurrentPageTurnCount === 'function'
      ? getCurrentPageTurnCount()
      : null;

    appendSendLogFields('[SEND][CONFIRM_FAILED]', {
      reason: reason || '-',
      input_empty: snapshot && snapshot.inputEmpty ? 1 : 0,
      user_bubble_found: snapshot && snapshot.userBubbleFound ? 1 : 0,
      latest_user_changed: snapshot && snapshot.latestUserChanged ? 1 : 0,
      latest_user_matches: snapshot && snapshot.latestUserMatchesContent ? 1 : 0,
      response_state: snapshot && snapshot.responseState
        ? (snapshot.responseState.response_state || '-')
        : '-',
      stop_button_visible: findChatGPTStopButton() ? 1 : 0,
      turn_count_before: ctx && ctx.turnCountBefore != null ? ctx.turnCountBefore : '-',
      turn_count_after: turnCountAfter == null ? '-' : turnCountAfter,
      composer_text_len: snapshot && snapshot.composerText
        ? String(snapshot.composerText).length
        : 0,
    });

    if (snapshot && snapshot.sendButtonDisabled) {
      appendSendLogFields('[SEND][DISABLED_NOT_SUCCESS]', {
        reason: 'disabled_without_strong_evidence',
        composer_cleared: snapshot.inputEmpty ? 1 : 0,
        stop_button_visible: findChatGPTStopButton() ? 1 : 0,
        response_state: snapshot.responseState
          ? (snapshot.responseState.response_state || '-')
          : '-',
        turn_count_before: ctx && ctx.turnCountBefore != null ? ctx.turnCountBefore : '-',
        turn_count_after: turnCountAfter == null ? '-' : turnCountAfter,
      });
    }
  }

  async function waitComposerSendConfirmed(content, timeoutMs = SEND_CONFIRM_DEFAULT_TIMEOUT_MS, options = {}) {
    const startedAt = Date.now();
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const signal = options.signal || null;
    const expectedRunId = options.runId != null ? Number(options.runId) : null;
    const getCurrentRunId = typeof options.getCurrentRunId === 'function'
      ? options.getCurrentRunId
      : null;
    const confirmSource = String(options.source || '-');
    const contentText = options.trimContent === true
      ? String(content || '').trim()
      : String(content ?? '');
    const contentProbe = contentText.slice(0, 80);
    const attachmentCountBefore = Number(options.attachmentCountBeforeSend || 0);
    const conversationIdBefore = String(options.conversationIdBefore || parseConversationIdFromPath(location.pathname || '') || '');
    const urlBefore = String(options.urlBefore || location.href || '');
    const sendButtonEnabledBefore = resolveSendButtonEnabledBefore(options.sendButtonEnabledBefore);

    const ctx = {
      contentText,
      contentProbe,
      attachmentCountBeforeSend: attachmentCountBefore,
      beforeLatestKey: String(options.beforeLatestKey || ''),
      conversationIdBefore,
      urlBefore,
      sendButtonEnabledBefore,
      hadTextPayload: !!contentText || attachmentCountBefore > 0,
      conversationSwitchSeen: false,
      conversationSwitchPending: !conversationIdBefore,
      conversationSwitchDeadline: 0,
    };

    let lastConfirmLogAt = 0;
    let effectiveTimeoutMs = Math.max(Number(timeoutMs) || 0, SEND_CONFIRM_DEFAULT_TIMEOUT_MS);

    while (Date.now() - startedAt < effectiveTimeoutMs) {
      if (signal && signal.aborted) {
        appendSendLog(`[COMPOSER][SEND_CONFIRM_ABORTED] source=${confirmSource}`);
        return { ok: false, reason: 'aborted' };
      }

      if (expectedRunId != null && getCurrentRunId) {
        const currentRunId = Number(getCurrentRunId());
        if (Number.isFinite(currentRunId) && currentRunId !== expectedRunId) {
          appendSendLog(
            `[COMPOSER][SEND_CONFIRM_STALE] source=${confirmSource} expected=${expectedRunId} current=${currentRunId}`,
          );
          return { ok: false, reason: 'stale-run' };
        }
      }

      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const conversationIdNow = parseConversationIdFromPath(location.pathname || '') || '';
      const urlNow = location.href || '';

      if (!conversationIdBefore && conversationIdNow && !ctx.conversationSwitchSeen) {
        ctx.conversationSwitchSeen = true;
        ctx.conversationSwitchPending = false;
        ctx.conversationSwitchDeadline = Date.now() + SEND_CONVERSATION_SWITCH_EXTRA_MS;
        effectiveTimeoutMs = Math.max(
          effectiveTimeoutMs,
          (Date.now() - startedAt) + SEND_CONVERSATION_SWITCH_EXTRA_MS,
        );

        const latestOnNewPageRaw = getLatestConversationMessageRecordFast({ preferAssistant: false });
        const latestOnNewPage = stripMessageRecordForCache(latestOnNewPageRaw);
        ctx.beforeLatestKey = latestOnNewPage ? latestOnNewPage.key : '';

        appendSendLog(
          `[SEND][CONVERSATION_SWITCH] old_id=${conversationIdBefore || '-'} new_id=${conversationIdNow} `
          + `old_url=${urlBefore} new_url=${urlNow}`,
        );
      }

      if (ctx.conversationSwitchPending && !conversationIdNow) {
        const switchWaitElapsed = Date.now() - startedAt;
        if (switchWaitElapsed > effectiveTimeoutMs - 500) {
          return { ok: false, reason: 'conversation_switch_timeout' };
        }
      }

      if (ctx.conversationSwitchSeen && ctx.conversationSwitchDeadline > 0 && Date.now() > ctx.conversationSwitchDeadline) {
        const snapshotAtDeadline = buildSendConfirmSnapshot(ctx);
        const confirmedAtDeadline = evaluateSendConfirmed(snapshotAtDeadline, ctx);
        if (!confirmedAtDeadline.ok) {
          return { ok: false, reason: 'conversation_switch_timeout' };
        }
      }

      const snapshot = buildSendConfirmSnapshot(ctx);
      const elapsed = Date.now() - startedAt;

      if (elapsed - lastConfirmLogAt >= 1000) {
        appendSendConfirmWaitLog(elapsed, snapshot);
        lastConfirmLogAt = elapsed;
      }

      const confirmed = evaluateSendConfirmed(snapshot, ctx);
      if (confirmed.ok) {
        appendSendLog(
          `[COMPOSER][SEND_CONFIRM_OK] reason=${confirmed.reason || 'confirmed'} elapsedMs=${Date.now() - startedAt}`,
        );
        return { ok: true, reason: confirmed.reason };
      }

      await sleep(SEND_CONFIRM_POLL_MS);
    }

    const finalSnapshot = buildSendConfirmSnapshot(ctx);
    appendSendConfirmWaitLog(Date.now() - startedAt, finalSnapshot);

    const finalConfirmed = evaluateSendConfirmed(finalSnapshot, ctx);
    if (finalConfirmed.ok) {
      appendSendLog(
        `[COMPOSER][SEND_CONFIRM_OK] reason=${finalConfirmed.reason || 'confirmed'} elapsedMs=${Date.now() - startedAt}`,
      );
      return { ok: true, reason: finalConfirmed.reason };
    }

    const failReason = pickSendNotConfirmedReason(finalSnapshot, ctx);
    logSendConfirmFailed(finalSnapshot, ctx, failReason);
    appendSendLog(
      `[COMPOSER][SEND_CONFIRM_TIMEOUT] reason=${failReason || 'send-confirm-timeout'} elapsedMs=${Date.now() - startedAt}`,
    );

    return {
      ok: false,
      reason: failReason || 'send-confirm-timeout',
      snapshot: finalSnapshot,
    };
  }

  async function sendContentViaComposer(options = {}) {
    const source = String(options.source || 'unknown');
    const rawContent = String(options.content ?? '');
    const content = options.trimContent === true ? rawContent.trim() : rawContent;
    const sendExistingComposer = options.sendExistingComposer === true;
    const allowReplaceDraft = options.allowReplaceDraft === true;
    const waitUntilSendable = options.waitUntilSendable !== false;
    const blockWhenResponding = options.blockWhenResponding !== false;
    const timeoutMs = Number(options.timeoutMs || 60000);
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    // Unify: prefer composer send service for all text-through-composer sends.
    if (typeof sendTextThroughComposer === 'function') {
      const startedAt = Date.now();
      const unifiedShouldStop = () => (
        shouldStop()
        || (Number.isFinite(timeoutMs) && timeoutMs > 0 && (Date.now() - startedAt) >= timeoutMs)
      );

      if (!sendExistingComposer && !content.trim()) {
        return { ok: false, reason: 'empty_content', source };
      }

      if (!sendExistingComposer) {
        const existingText = typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';

        if (existingText && existingText !== String(content || '').trim() && !allowReplaceDraft) {
          return {
            ok: false,
            reason: 'composer_has_existing_text',
            source,
          };
        }
      }

      const composerResult = await sendTextThroughComposer({
        text: sendExistingComposer ? '' : content,
        sendExistingComposer,
        source,
        mode: String(options.mode || 'send-content-via-composer'),
        requireTextWritten: !sendExistingComposer,
        waitButtonTimeoutMs: timeoutMs,
        shouldStop: unifiedShouldStop,
        waitForReplyIdle: blockWhenResponding,
      });

      return {
        ok: composerResult && composerResult.ok === true,
        reason: String((composerResult && composerResult.reason) || 'send_failed'),
        source,
        detail: composerResult && composerResult.detail ? composerResult.detail : '',
      };
    }

    // Fallback: unified send pipeline when composer send service is unavailable.
    if (typeof sendUnifiedMessage === 'function') {
      const startedAt = Date.now();
      const unifiedShouldStop = () => (
        shouldStop()
        || (Number.isFinite(timeoutMs) && timeoutMs > 0 && (Date.now() - startedAt) >= timeoutMs)
      );

      if (!sendExistingComposer && !content.trim()) {
        return { ok: false, reason: 'empty_content', source };
      }

      if (!sendExistingComposer) {
        const existingText = typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';

        if (existingText && existingText !== String(content || '').trim() && !allowReplaceDraft) {
          return {
            ok: false,
            reason: 'composer_has_existing_text',
            source,
          };
        }
      }

      const unifiedResult = await sendUnifiedMessage({
        source,
        mode: 'send-content-via-composer',
        text: sendExistingComposer ? '' : content,
        sendExistingComposer,
        waitForReplyIdle: blockWhenResponding,
        waitForAttachmentReady: true,
        allowEnterFallback: true,
        // sendUnifiedMessage already has its own retry/timeout strategy; timeoutMs is enforced via shouldStop.
        maxAttempts: 8,
        shouldStop: unifiedShouldStop,
      });

      return {
        ok: unifiedResult && unifiedResult.ok === true,
        reason: String((unifiedResult && unifiedResult.reason) || 'send_failed'),
        source,
      };
    }

    logPageCapability(getPageCapability(`send:${source}`), '[SEND][CAPABILITY]');

    if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
      updateChatInputStateBadge();
      return { ok: false, reason: 'page_navigating', source };
    }

    if (shouldStop()) {
      updateChatInputStateBadge();
      return { ok: false, reason: 'cancelled', source };
    }

    if (!sendExistingComposer && !content.trim()) {
      updateChatInputStateBadge();
      return { ok: false, reason: 'empty_content', source };
    }

    const responseState = detectComposerResponseState();

    if (blockWhenResponding && responseState.is_responding) {
      updateChatInputStateBadge();
      return {
        ok: false,
        reason: 'assistant_busy',
        response_state: responseState,
        source,
      };
    }

    if (!sendExistingComposer && !responseState.can_accept_input) {
      updateChatInputStateBadge();
      return {
        ok: false,
        reason: responseState.response_state_reason || 'cannot_accept_input',
        response_state: responseState,
        source,
      };
    }

    if (!sendExistingComposer) {
      const existingText = ComposerApi.getComposerText();
      if (existingText && existingText !== content && !allowReplaceDraft) {
        return {
          ok: false,
          reason: 'composer_has_existing_text',
          existing_len: existingText.length,
          source,
        };
      }

      if (shouldStop()) {
        updateChatInputStateBadge();
        return { ok: false, reason: 'cancelled', source };
      }

      const okSet = ComposerApi.setComposerValue(content);
      if (!okSet) {
        return { ok: false, reason: 'composer_not_found', source };
      }

      const textSynced = typeof ComposerApi.waitForComposerTextSynced === 'function'
        ? await ComposerApi.waitForComposerTextSynced(content, SEND_TEXT_SYNC_TIMEOUT_MS, { shouldStop })
        : { ok: false, reason: 'composer_text_sync_unavailable' };

      if (!textSynced.ok) {
        return {
          ok: false,
          reason: `send_not_confirmed:${textSynced.reason || 'composer_text_not_synced'}`,
          source,
        };
      }

      await sleep(200);
    } else {
      const composerTextBeforeSend = ComposerApi.getComposerText();
      const attachmentCountBeforeSend = typeof ComposerApi.countAttachmentChips === 'function'
        ? ComposerApi.countAttachmentChips()
        : 0;
      const hasDraftPayload = typeof ComposerApi.hasComposerDraftPayload === 'function'
        && ComposerApi.hasComposerDraftPayload();
      const hasAttachmentPayload = attachmentCountBeforeSend > 0 || hasDraftPayload;
      const hasComposerPayload = !!composerTextBeforeSend || hasAttachmentPayload;
      const nativeSendReady = typeof ComposerApi.canSendNow === 'function' && ComposerApi.canSendNow();

      const payloadLog = `[SEND][PAYLOAD] source=${source} textLen=${String(composerTextBeforeSend || '').length} `
        + `attachmentCount=${attachmentCountBeforeSend} draftPayload=${hasDraftPayload ? 1 : 0} `
        + `nativeSendReady=${nativeSendReady ? 1 : 0} sendExistingComposer=${sendExistingComposer ? 1 : 0}`;

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(payloadLog);
      } else {
        console.log(payloadLog);
      }

      if (!hasComposerPayload && !nativeSendReady) {
        const payloadWait = typeof ComposerApi.waitExistingComposerPayloadReadyForSend === 'function'
          ? await ComposerApi.waitExistingComposerPayloadReadyForSend(
            Number(options.emptyComposerWaitMs || 30000),
            shouldStop,
            source,
          )
          : { ok: false, reason: 'composer_empty' };

        if (!payloadWait.ok) {
          updateChatInputStateBadge();
          return {
            ok: false,
            reason: payloadWait.reason || 'composer_empty',
            source,
            attachment_count: attachmentCountBeforeSend,
            diagnostics: payloadWait.snapshot || {},
          };
        }

        ToolboxShell.appendLog(
          `[SEND][PAYLOAD_RECOVERED] source=${source} reason=${payloadWait.reason || '-'}`,
        );
      }

      if (!hasComposerPayload && nativeSendReady) {
        const nativeOverrideLog = `[SEND][PAYLOAD] source=${source} reason=native_send_ready_without_detected_payload`;
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(nativeOverrideLog);
        } else {
          console.log(nativeOverrideLog);
        }
      }
    }

    const composerTextBeforeSend = sendExistingComposer
      ? ComposerApi.getComposerText()
      : content;
    const attachmentCountBeforeSend = typeof ComposerApi.countAttachmentChips === 'function'
      ? ComposerApi.countAttachmentChips()
      : 0;
    const beforeLatestRecordRaw = getLatestConversationMessageRecordFast({ preferAssistant: false });
    const beforeLatestRecord = stripMessageRecordForCache(beforeLatestRecordRaw);
    const beforeLatestKey = beforeLatestRecord ? beforeLatestRecord.key : '';
    const conversationIdBefore = parseConversationIdFromPath(location.pathname || '') || '';
    const urlBefore = location.href || '';
    const sendBtnBefore = typeof ComposerApi.findSendButton === 'function'
      ? ComposerApi.findSendButton({ silent: true })
      : null;
    const sendButtonEnabledBefore = !!(sendBtnBefore && ComposerApi.isSendButtonReady(sendBtnBefore));

    const preSend = await runPreSendChecks({
      shouldStop,
      expectedText: sendExistingComposer ? '' : content,
      requireTextSynced: !sendExistingComposer && !!content,
      attachmentWaitTimeoutMs: Number(options.attachmentWaitTimeoutMs || SEND_ATTACH_WAIT_DEFAULT_MS),
      allowSendButtonWait: waitUntilSendable,
      onPreSendStatus: typeof options.onPreSendStatus === 'function' ? options.onPreSendStatus : null,
    });

    if (!preSend.ok) {
      const preReason = preSend.reason || 'pre_send_failed';
      const mappedReason = [
        'attachment_not_ready',
        'button_disabled',
        'send_button_wait_timeout',
        'composer_text_not_synced',
        'composer_not_found',
        'composer_not_inputable',
      ].includes(preReason)
        ? `send_not_confirmed:${preReason}`
        : preReason;

      updateChatInputStateBadge();
      return { ok: false, reason: mappedReason, source };
    }

    if (waitUntilSendable && !sendExistingComposer && !isSendButtonReadyForPreSend()) {
      const buttonWait = await waitSendButtonReadyForSend(timeoutMs, shouldStop, options);
      if (!buttonWait.ok) {
        const waitReason = buttonWait.reason || 'send_button_wait_timeout';
        const mappedWaitReason = waitReason === 'send_button_wait_timeout'
          ? waitReason
          : `send_not_confirmed:${waitReason}`;
        updateChatInputStateBadge();
        return { ok: false, reason: mappedWaitReason, source };
      }
    }

    if (waitUntilSendable && sendExistingComposer && !isSendButtonReadyForPreSend()) {
      appendSendLog('[SEND][WAIT_BUTTON_SKIP] reason=existing-composer-use-action-fallback');
    }

    ChatInputStateRuntime.sendInProgress = true;
    updateChatInputStateBadge();

    const confirmContentText = options.trimContent === true
      ? String(composerTextBeforeSend || '').trim()
      : String(composerTextBeforeSend ?? '');
    const confirmCtx = {
      contentText: confirmContentText,
      contentProbe: confirmContentText.slice(0, 80),
      attachmentCountBeforeSend,
      beforeLatestKey,
      conversationIdBefore,
      urlBefore,
      sendButtonEnabledBefore,
      hadTextPayload: !!confirmContentText || attachmentCountBeforeSend > 0,
    };

    const startedAt = Date.now();

    try {
      if (shouldStop()) {
        return { ok: false, reason: 'cancelled', source };
      }

      const sendAction = await performSendActionsWithFallback(confirmCtx, shouldStop);
      if (!sendAction.ok) {
        return { ok: false, reason: sendAction.reason || 'click_send_failed', source };
      }

      const confirmStartedAt = Date.now();
      const confirmBudgetMs = Math.max(
        Number(options.confirmTimeoutMs || SEND_CONFIRM_DEFAULT_TIMEOUT_MS),
        SEND_CONFIRM_DEFAULT_TIMEOUT_MS,
      );
      const confirmRemainingMs = Math.max(
        confirmBudgetMs - (confirmStartedAt - startedAt),
        SEND_CONFIRM_DEFAULT_TIMEOUT_MS,
      );

      const confirmed = await waitComposerSendConfirmed(
        composerTextBeforeSend,
        confirmRemainingMs,
        {
          shouldStop,
          signal: options.signal || null,
          runId: options.runId,
          getCurrentRunId: options.getCurrentRunId,
          source,
          beforeLatestKey,
          attachmentCountBeforeSend,
          conversationIdBefore,
          urlBefore,
          sendButtonEnabledBefore,
          trimContent: options.trimContent === true,
        },
      );

      if (!confirmed.ok) {
        const diag = getSendFlowDiagnostics();
        appendSendLog(
          `[SEND][FAILED] reason=${confirmed.reason || 'timeout'} url=${diag.url} `
          + `conversation_id=${diag.conversation_id || '-'} page_instance_id=${diag.page_instance_id || '-'} `
          + `response_state=${diag.response_state || '-'} sendable=${diag.sendable ? 1 : 0}`,
        );

        return {
          ok: false,
          reason: `send_not_confirmed:${confirmed.reason || 'timeout'}`,
          source,
          diagnostics: diag,
        };
      }

      ChatInputStateRuntime.waitingForReply = true;
      return { ok: true, reason: confirmed.reason, source };
    } catch (sendErr) {
      logSendFlowError('sendContentViaComposer', sendErr, { source });
      return { ok: false, reason: 'send_exception', source };
    } finally {
      ChatInputStateRuntime.sendInProgress = false;
      updateChatInputStateBadge();
    }
  }

  function appendAutoQueueLog(message) {
    const line = String(message || '');
    if (!line) return;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  async function waitUntilComposerReady(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 10000);
    const intervalMs = Number(options.intervalMs || 200);
    const source = String(options.source || 'unknown');
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const composer = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.getComposer === 'function'
        ? ComposerApi.getComposer()
        : null;

      if (composer) {
        appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY] source=${source}`);
        return true;
      }

      await sleep(intervalMs);
    }

    appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY_TIMEOUT] source=${source}`);
    return false;
  }

  function getCopiedTextStats(text) {
    const value = String(text || '');

    const charCount = Array.from(value).length;
    const noSpaceCharCount = Array.from(value.replace(/\s+/g, '')).length;
    const hanCount = (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    const lineCount = value ? value.split(/\r\n|\r|\n/).length : 0;

    return {
      charCount,
      noSpaceCharCount,
      hanCount,
      lineCount,
    };
  }

/*__UPLOAD_MODULES__*/
