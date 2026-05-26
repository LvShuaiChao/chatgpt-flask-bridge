// ==UserScript==
// @name         ChatGPT 工具箱：多文件上传 + 自动指令队列 + Prompt 管理
// @namespace    https://github.com/xiaozhang/chatgpt-toolbox
// @version      3.6.7
// @description  一个统一工具箱面板：多文件队列上传、自动指令队列、Prompt 管理、标题前缀、对话导出与 issues 统计。每个功能独立模块，放到不同选项卡。?
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

    function collapseInstrumentsCalculatorReply(text) {
      const value = String(text || '').trim();
      if (!value) return '';

      const lines = value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length !== 2) return value;

      const [exprLine, answerLine] = lines;
      const answerMatch = String(answerLine).match(/^(.+?)=(.+)$/);
      if (!answerMatch) return value;

      const lhs = String(answerMatch[1] || '').replace(/\s+/g, '');
      const exprNorm = String(exprLine).replace(/\s+/g, '');

      if (lhs && exprNorm && lhs === exprNorm) {
        return String(answerLine).trim();
      }

      return value;
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

    let stableCheckLogAt = 0;

    function parseTurnIdForStableCompare(turnId) {
      const raw = String(turnId || '').trim();
      if (!raw) {
        return 0;
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
      return raw.length;
    }

    async function waitLatestAssistantStable(options = {}) {
      const timeoutMs = Number(options.timeoutMs ?? 12000);
      const intervalMs = Number(options.intervalMs ?? 300);
      const stableRounds = Math.max(3, Number(options.stableRounds ?? 3));
      const minQuietAfterChangeMs = Math.max(800, Number(options.minQuietAfterChangeMs ?? 900));
      const isGenerating = typeof options.isGenerating === 'function' ? options.isGenerating : () => false;
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
      const pendingReplyContext = options.pendingReplyContext && typeof options.pendingReplyContext === 'object'
        ? options.pendingReplyContext
        : null;
      const baselineTurnId = pendingReplyContext
        ? parseTurnIdForStableCompare(
          pendingReplyContext.baseline_assistant_turn_id
            || pendingReplyContext.baselineAssistantTurnId
            || pendingReplyContext.sent_turn_id
            || pendingReplyContext.sentTurnId
            || '',
        )
        : 0;

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
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-check] state=generating');
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
          const nowNoPick = Date.now();
          if (nowNoPick - stableCheckLogAt >= 3000) {
            stableCheckLogAt = nowNoPick;
            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:stable-check] state=${picked.reason || 'no-assistant'} mode=fast`,
            );
          }
          await sleep(intervalMs);
          continue;
        }

        const record = picked.record;
        const assistantTurnId = parseTurnIdForStableCompare(record.turn_id || record.turnId || '');

        if (baselineTurnId > 0 && assistantTurnId > 0 && assistantTurnId <= baselineTurnId) {
          stableCount = 0;
          lastSignature = '';
          lastTextChangedAt = 0;
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:stable-check] state=assistant-before-baseline baseline=${baselineTurnId} current=${assistantTurnId}`,
          );
          await sleep(intervalMs);
          continue;
        }

        const text = cleanMessageText(record.text || '');
        const signature = buildStableSignature(record, text);
        const nowStable = Date.now();

        if (signature && signature !== lastSignature) {
          lastTextChangedAt = nowStable;
        }

        if (nowStable - stableCheckLogAt >= 3000) {
          stableCheckLogAt = nowStable;
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:stable-check] stable=${stableCount}/${stableRounds} chars=${record.char_count || record.charCount || 0} mode=fast turn=${record.turn_id || record.turnId || '-'} quietMs=${lastTextChangedAt ? nowStable - lastTextChangedAt : 0}`,
          );
        }

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

      if (typeof stopUploadSendTask === 'function') {
        stopUploadSendTask('page-navigation');
      }

      if (typeof stopUploadTask === 'function') {
        stopUploadTask('page-navigation');
      }

      if (typeof disconnectToolboxObservers === 'function') {
        disconnectToolboxObservers('page-navigation');
      }

      if (typeof clearToolboxTimers === 'function') {
        clearToolboxTimers('page-navigation');
      }

      if (typeof clearUploadTransientFileRefs === 'function') {
        clearUploadTransientFileRefs('page-navigation');
      }

      ToolboxShell.appendLog(
        `[TOOLBOX_NAV_CLEANUP][DONE] source=${source || '-'}`,
      );
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
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(perfLine);
      }
      if (costMs > 500) {
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

  const ComposerApi = (() => {
    function getComposer() {
      for (const sel of SELECTORS.composerTextarea) {
        const el = qs(sel);
        if (el instanceof HTMLElement && !isInToolbox(el) && isElementVisible(el)) {
          return el;
        }
      }

      return null;
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
      const c = qs(SELECTORS.composer);
      if (c instanceof HTMLElement && !isInToolbox(c)) return c;

      const editor = getComposer();
      if (editor) {
        const form = editor.closest('form');
        if (form instanceof HTMLElement) return form;
        return editor;
      }

      return null;
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

    function appendComposerLogThrottled(key, text, intervalMs = 5000) {
      const now = Date.now();
      const last = Number(composerLogThrottle.get(key) || 0);

      if (now - last < intervalMs) {
        return;
      }

      composerLogThrottle.set(key, now);
      ToolboxShell.appendLog(text);
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
        mark.includes('启动语音功能')
        || mark.includes('开始听写')
        || mark.includes('停止听写')
        || mark.includes('听写')
        || mark.includes('语音')
        || mark.includes('麦克风')
        || mark.includes('录音')
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

    function isRealSendButton(el) {
      const button = resolveButtonElement(el);

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      if (button.disabled) {
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
        || mark.includes('发送')
      );
    }

    function hasRealComposerText() {
      const text = String(getComposerText() || '').trim();
      return text.length > 0;
    }

    function hasRealSubmitButton() {
      const byId = document.querySelector('#composer-submit-button');
      if (byId instanceof HTMLButtonElement && isRealSendButton(byId) && isSendButtonReady(byId)) {
        return true;
      }

      const composer = getComposer();
      const composerRoot = getComposerRoot();
      const composerForm = composer instanceof HTMLElement ? composer.closest('form') : null;

      const buttons = Array.from(document.querySelectorAll('button'));
      for (let i = 0; i < buttons.length; i += 1) {
        const btn = buttons[i];
        if (isInToolbox(btn) || !isElementVisible(btn)) {
          continue;
        }

        if (isVoiceButton(btn)) {
          continue;
        }

        if (!isRealSendButton(btn) || !isSendButtonReady(btn)) {
          continue;
        }

        if (
          composer instanceof HTMLElement
          && (
            isButtonBelongsToComposer(btn, composer, composerRoot, composerForm)
            || isButtonNearComposer(btn, composer)
          )
        ) {
          return true;
        }
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
        ['发送', '发送消息', '发送提示', 'send', 'send message', 'send prompt'].includes(aria),
        ['发送', '发送消息', 'send', 'send message'].includes(title),
        ['发送', 'send'].includes(text),
        cls.includes('composer-submit-button'),
        cls.includes('text-submit-btn-text'),
      ];

      if (positive.some(Boolean)) {
        return true;
      }

      if (type === 'submit') {
        return true;
      }

      return isRealSendButton(btn);
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

      if (!silent) {
        appendComposerLogThrottled(`send-button-reject-voice:${selector || 'scan'}`, line, 1200);
      } else {
        ToolboxShell.appendLog(line);
      }
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

      if (!silent) {
        appendComposerLogThrottled(`send-button-ready:${hit.source || 'found'}`, line, 1000);
        appendComposerLogThrottled(`send-button-found:${hit.source || 'found'}`, foundLine, 1000);
      } else {
        ToolboxShell.appendLog(line);
        ToolboxShell.appendLog(foundLine);
      }
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

    function logSendButtonNotFound(composer, buttonCount, preview, silent) {
      const composerTag = composer instanceof HTMLElement
        ? String(composer.tagName || '').toLowerCase()
        : 'missing';

      if (!silent) {
        appendComposerLogThrottled(
          'send-button-not-found',
          `[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button composer=${composerTag} buttonCount=${buttonCount} preview=${preview || '-'}`,
          5000,
        );
        appendComposerLogThrottled(
          'send-button-missing',
          '[COMPOSER][SEND_BUTTON_MISSING] reason=no-real-submit-button',
          5000,
        );
      } else {
        ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button');
      }
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

      const mainEl = qs('main');
      if (mainEl instanceof HTMLElement && !scopes.includes(mainEl)) {
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

    function findSendButton(options = {}) {
      const silent = options.silent === true;
      const composer = getComposer();
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

      const composerRoot = getComposerRoot();
      const composerForm = composer.closest('form');
      const scopes = buildComposerSendButtonScopes(composer, composerRoot, composerForm);
      const allButtons = Array.from(document.querySelectorAll('button'));
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
        'button[aria-label*="发送"]',
        ...(SELECTORS.sendButton || []),
      ];

      for (const sel of prioritySelectors) {
        const candidate = document.querySelector(sel);
        if (!(candidate instanceof HTMLButtonElement)) {
          continue;
        }

        const scope = candidate.closest('form, main, [data-testid="composer"]') || document.body;

        if (!isComposerSendButtonCandidate(candidate, composer, composerRoot, composerForm, scope)) {
          continue;
        }

        if (isVoiceButton(candidate)) {
          logSendButtonReject(candidate, sel, silent);
          continue;
        }

        if (!isLikelyComposerSendButton(candidate)) {
          continue;
        }

        const hit = { btn: candidate, source: 'selector', selector: sel };
        logSendButtonScan(totalScanned, 1, `selector:${sel}`, silent);
        logSendButtonFound(hit, silent);
        return candidate;
      }

      for (const scope of scopes) {
        for (const sel of prioritySelectors) {
          const candidates = Array.from(scope.querySelectorAll(sel));
          for (const candidate of candidates) {
            if (!isComposerSendButtonCandidate(candidate, composer, composerRoot, composerForm, scope)) {
              continue;
            }

            if (isVoiceButton(candidate)) {
              logSendButtonReject(candidate, sel, silent);
              continue;
            }

            if (!isLikelyComposerSendButton(candidate)) {
              continue;
            }

            const hit = { btn: candidate, source: 'selector', selector: sel };
            logSendButtonScan(totalScanned, 1, `selector:${sel}`, silent);
            logSendButtonFound(hit, silent);
            return candidate;
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

      const preview = buildSendButtonPreview(previewButtons);
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

    function getComposerText() {
      const el = getComposer();
      if (!el) return '';

      const target = resolveComposerTextElement(el) || el;

      if (target.matches && target.matches('textarea,input')) {
        return String(target.value || '');
      }

      return String(target.innerText || target.textContent || '');
    }

    let sendButtonScanCache = {
      at: 0,
      btn: null,
      ready: false,
    };

    function canSendNow(options = {}) {
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

      if (!hasRealComposerText()) {
        return false;
      }

      const maxAgeMs = Number(options.maxAgeMs) || 0;
      if (!options.force && maxAgeMs > 0 && Date.now() - sendButtonScanCache.at < maxAgeMs) {
        return sendButtonScanCache.ready && hasRealComposerText();
      }

      const ready = hasRealSubmitButton();
      sendButtonScanCache = {
        at: Date.now(),
        btn: findSendButton({ silent: true }),
        ready,
      };
      return ready;
    }

    function canSendNowLight() {
      if (isAssistantLikelyBusy()) {
        return false;
      }
      return canSendNow({ maxAgeMs: 450 });
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
        ToolboxShell.appendLog('[COMPOSER][BUSY_OVERRIDE] reason=home_new_chat_ready_to_send');
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


    function isLikelyAttachmentChipText(raw) {
      return /remove|删除|移除|附件|file|文件|attachment|uploaded|upload|\.zip|\.js|\.py|\.txt|\.json|\.md|\.csv|\.xlsx|\.docx|\.pdf/i.test(raw);
    }

    function forEachLikelyAttachmentElement(callback) {
      const roots = [
        getComposerRoot(),
        qs('[data-testid="composer"]'),
        qs('form'),
        qs('main'),
        document.body,
      ].filter(Boolean);

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
      ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

      const attachmentHint = /attach|attachment|file-chip|composer-file|file-preview|upload|附件|文件|\.zip|\.js|\.py|\.txt|\.json|\.md|\.csv|\.xlsx|\.docx|\.pdf/.test(raw);
      if (!attachmentHint) {
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
        (composerRoot instanceof HTMLElement && composerRoot.contains(el))
        || (composerEl instanceof HTMLElement && composerEl.contains(el))
        || (composerForm instanceof HTMLElement && composerForm.contains(el))
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

      const composer = getComposer();
      if (composer instanceof HTMLElement) {
        const composerForm = composer.closest('form');
        addRoot(composerForm);
      }

      return roots;
    }

    function countAttachmentChips() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
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
      let scanned = 0;
      let count = 0;

      roots.forEach((root) => {
        chipSelectors.forEach((sel) => {
          qsa(sel, root).forEach((el) => {
            scanned += 1;
            if (!isComposerAttachmentChipElement(el)) return;
            if (seen.has(el)) return;
            seen.add(el);
            count += 1;
          });
        });
      });

      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );

      if (typeof logPerfThrottled === 'function') {
        logPerfThrottled(
          'countAttachmentChips',
          `[PERF][countAttachmentChips] cost=${costMs}ms count=${count} roots=${roots.length} scanned=${scanned}`,
        );
      }

      return count;
    }

    function hasComposerDraftPayload() {
      if (String(getComposerText() || '').trim()) {
        return true;
      }

      if (countAttachmentChips() > 0) {
        return true;
      }

      const roots = [
        getComposerRoot(),
        qs('[data-testid="composer"]'),
      ].filter(Boolean);

      for (let i = 0; i < roots.length; i += 1) {
        const root = roots[i];
        const rootText = String(root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();

        if (/已粘贴|pasted|attached file|uploaded file|file attached|个文件/i.test(rootText)) {
          return true;
        }
      }

      return false;
    }

    function collectVisibleComposerPayloadText() {
      const roots = collectComposerAttachmentRoots();
      const seen = new Set();
      const pieces = [];
      let falsePositiveLogged = false;

      roots.forEach((root) => {
        if (!(root instanceof HTMLElement)) return;
        if (seen.has(root)) return;
        seen.add(root);

        ToolboxShell.appendLog(
          `[COMPOSER][ATTACHMENT_SCOPE] root=${root.tagName.toLowerCase()} from=collectVisibleComposerPayloadText`,
        );

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

      const hasFileName = /\.(zip|txt|py|js|json|md|pdf|doc|docx|xlsx|csv)\b/i.test(probe);
      const hasFileSize = /\b\d+(?:\.\d+)?\s*(KB|MB|GB)\b/i.test(probe);
      const hasRemoveSignal = /remove file|移除文件|删除文件|移除附件|删除附件/i.test(probe);
      const hasChipSignal = /file-chip|file-preview|composer-file|attachment-chip|attachment-item|attachment-preview/i.test(probe);

      const looksLikeUploadEntry = (
        /添加|上传|选择|附加|attach|upload|add file|browse/i.test(probe)
        && !hasFileName
        && !hasFileSize
        && !hasRemoveSignal
        && !hasChipSignal
      );

      if (looksLikeUploadEntry) {
        return false;
      }

      return hasFileName || hasFileSize || hasRemoveSignal || hasChipSignal;
    }

    function hasComposerAttachmentUnified() {
      if (countAttachmentChips() > 0) {
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
        return false;
      }

      ToolboxShell.appendLog(
        `[COMPOSER][ATTACHMENT_SCOPE] root=${composerScope.tagName.toLowerCase()} from=hasComposerAttachmentUnified`,
      );

      const selectors = [
        '[data-testid*="file-chip"]',
        '[data-testid*="file-preview"]',
        '[data-testid*="composer-file"]',
        '[aria-label*="Remove file"]',
        '[aria-label*="移除文件"]',
        '[aria-label*="删除文件"]',
        'button[aria-label*="移除文件"]',
        'button[aria-label*="删除文件"]',
        '[class*="file-chip"]',
        '[class*="file-preview"]',
        '[class*="attachment-chip"]',
        '[class*="attachment-item"]',
        '[class*="attachment-preview"]',
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

          ToolboxShell.appendLog(
            `[COMPOSER][ATTACHMENT_FOUND] selector=${selector} count=${visibleNodes.length} sample=${sample || '-'}`,
          );
          return true;
        }
      }

      const text = collectVisibleComposerPayloadText();
      return /(\.(zip|txt|py|js|json|md|csv|xlsx|docx|pdf)\b|\b\d+(?:\.\d+)?\s*(KB|MB|GB)\b|remove file|移除文件|删除文件|uploaded|attached|已上传|上传完成)/i.test(text);
    }

    function hasVisibleComposerAttachmentPayload() {
      return hasComposerAttachmentUnified();
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
        hasPayload: !!text || attachmentCount > 0 || hasVisibleAttachment || attachmentUploading || nativeSendReady,
        textPreview: collectVisibleComposerPayloadText().slice(0, 500),
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

    function fileNameEvidence(fileName, haystack) {
      const raw = String(fileName || '').replace(/^.*[/\\]/, '').trim();
      if (!raw) return false;

      const low = String(haystack || '').toLowerCase();
      const name = raw.toLowerCase();

      if (low.includes(name)) return true;

      const stem = stripExt(name)
        .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
        .trim();

      if (stem.length >= 8 && low.includes(stem)) return true;
      if (stem.length >= 16 && low.includes(stem.slice(0, 16))) return true;

      return false;
    }

    function buildUploadEvidenceNames(fileOrName, extraNames = []) {
      const names = [];

      const add = (value) => {
        const text = String(value || '').replace(/^.*[/\\]/, '').trim();
        if (!text) return;
        if (!names.includes(text)) names.push(text);

        const stem = stripExt(text).trim();
        if (stem && !names.includes(stem)) names.push(stem);

        const normalizedStem = stem
          .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
          .trim();

        if (normalizedStem && !names.includes(normalizedStem)) {
          names.push(normalizedStem);
        }
      };

      if (fileOrName && typeof fileOrName === 'object') {
        add(fileOrName.name);
        add(fileOrName.originalName);
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

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][attachment-evidence] roots=${roots.length} ok=${ok ? 1 : 0} textPreview=${text.slice(0, 200)}`
      );

      return {
        ok,
        reason: ok
          ? `附件区域识别到文件名：${names.join('|')}`
          : `未识别到附件文件名：${names.join('|')}`,
        textPreview: text.slice(0, 500),
        rootsCount: roots.length,
      };
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

      while (Date.now() < deadline) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            level: 'cancelled',
            reason: '用户已停止上传',
          };
        }

        const text = collectAttachmentChipText();
        lastTextPreview = text.slice(0, 500);

        const allNamed = cleanFiles.length > 0 && cleanFiles.every((f) => {
          const names = buildUploadEvidenceNames(f, extraNames);
          return fileNameEvidenceAny(names, text);
        });

        if (allNamed) {
          return {
            ok: true,
            level: 'name',
            reason: `附件区域识别到文件名：${cleanFiles.map((f) => f.name).join('|')}`,
          };
        }

        const nowCount = countAttachmentChips();
        if (chipCountBefore >= 0 && nowCount > chipCountBefore) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:chip-count-ok] batch count=${chipCountBefore}->${nowCount}`
          );

          return {
            ok: true,
            level: 'count',
            reason: `附件数量增加：${chipCountBefore} -> ${nowCount}`,
          };
        }

        await sleep(250);
      }

      const chipAfter = countAttachmentChips();

      console.debug('[ChatGPT toolbox] attachment evidence timeout', {
        expectedFiles: cleanFiles.map((f) => f.name),
        chipCountBefore,
        chipCountAfter: chipAfter,
        chipText: collectAttachmentChipText(),
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][file-input:settled-timeout] batch uploadNames=${cleanFiles.map((f) => f.name).join('|')} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
      );

      return {
        ok: false,
        level: 'none',
        reason: '超时未检测到附件 chip',
        textPreview: lastTextPreview || collectAttachmentChipText().slice(0, 500),
      };
    }

    function collectComposerAttachmentStatusText() {
      const roots = collectComposerAttachmentRoots();
      const parts = [];

      roots.forEach((root) => {
        ToolboxShell.appendLog(
          `[COMPOSER][ATTACHMENT_SCOPE] root=${root.tagName.toLowerCase()} from=collectComposerAttachmentStatusText`,
        );

        qsa('[data-testid], [aria-label], [title], [role], button, div, span', root).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (isInToolbox(el)) return;
          if (isInsideConversationHistory(el)) return;

          const text = [
            el.innerText || '',
            el.textContent || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
            el.getAttribute('role') || '',
          ].join(' ').trim();

          if (!text) return;

          if (/upload|上传|processing|处理中|loading|加载|progress|spinner|附件|file|文件|remove|删除|移除/i.test(text)) {
            parts.push(text.slice(0, 300));
          }
        });
      });

      return [...new Set(parts)].join('\n');
    }

    function isAttachmentStillUploading() {
      if (typeof hasRealSubmitButton === 'function' && hasRealSubmitButton()) {
        return false;
      }

      const roots = collectComposerAttachmentRoots();
      if (!roots.length) {
        return false;
      }

      let busyNode = null;

      for (let i = 0; i < roots.length; i += 1) {
        const root = roots[i];
        ToolboxShell.appendLog(
          `[COMPOSER][ATTACHMENT_SCOPE] root=${root.tagName.toLowerCase()} from=isAttachmentStillUploading`,
        );

        busyNode = qsa(
          [
            '[role="progressbar"]',
            '[aria-busy="true"]',
            '[data-testid*="progress"]',
            '[data-testid*="spinner"]',
            'svg[class*="animate"]',
            '.animate-spin',
          ].join(', '),
          root,
        ).find((el) => {
          if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
            return false;
          }
          if (isInToolbox(el)) {
            return false;
          }
          if (isInsideConversationHistory(el)) {
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
        });

        if (busyNode) {
          break;
        }
      }

      if (busyNode) {
        return true;
      }

      const text = collectComposerAttachmentStatusText();

      // 注意：
      // 这里不能匹配「压缩」「归档」「压缩归档」「archive」。
      // 这些在 ChatGPT 附件 chip 里通常只是 zip 文件类型说明，不代表正在上传。
      const strongUploadingTextPattern = new RegExp(
        [
          'uploading',
          'upload\\s+in\\s+progress',
          'processing\\s+file',
          'processing\\s+attachment',
          'analyzing\\s+file',
          'analyzing\\s+attachment',
          'loading',
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

      return strongUploadingTextPattern.test(text);
    }


    function findFileInputsLegacy() {
      const root = getComposerRoot();
      const list = [];

      if (root) {
        list.push(...qsa('input[type="file"]', root));
      }

      list.push(...qsa('main input[type="file"]'));
      list.push(...qsa('input[type="file"]'));

      return [...new Set(list)].filter((x) => {
        if (!(x instanceof HTMLInputElement)) return false;
        if (isInToolbox(x)) return false;
        if (x.disabled) return false;
        return true;
      });
    }

    function dispatchFilesToInputLegacy(input, files) {
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

    async function attachFilesByFileInput(files, timeoutMs = 8000, options = {}) {
      ToolboxShell.appendLog('[UPLOAD_PATH] using attachFilesByFileInput');
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const cleanFiles = files
        .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
        .filter(Boolean);

      ToolboxShell.appendLog(`[UPLOAD_DIAG][file-input:start] inputFiles=${files.length} cleanFiles=${cleanFiles.length} names=${cleanFiles.map((f) => f.name).join('|')}`);

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

      const inputs = findFileInputsLegacy();

      ToolboxShell.appendLog(`旧版 input 上传：发现 ${inputs.length} 个文input`);

      if (!inputs.length) {
        console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');
        return {
          ok: false,
          reason: '旧版 input 上传失败：找不到 ChatGPT 文件 input',
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

          const chipCountBefore = countAttachmentChips();

          dispatchFilesToInputLegacy(input, cleanFiles);

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
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:batch-evidence-ok] reason=${evidence.reason || '-'} level=${evidence.level || '-'}`
            );

            return {
              ok: true,
              method: 'file-input',
              level: evidence.level || 'evidence',
              reason: evidence.reason || '旧版 input 上传成功',
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

          return {
            ok: true,
            method: 'file-input',
            level: 'name',
            reason: `旧版 input 上传成功：${settledReasons.join('；')}`,
          };
        } catch (e) {
          console.warn('[ChatGPT toolbox] legacy input dispatch failed', {
            input,
            files: cleanFiles.map((f) => f.name),
          }, e);
        }
      }

      return {
        ok: false,
        method: 'file-input',
        reason: '旧版 input 上传已触发，但未检测到 ChatGPT 附件出现',
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
      clearAttachments,
      collectAttachmentChipText,
      countAttachmentChips,
      hasComposerDraftPayload,
      hasComposerAttachmentUnified,
      hasVisibleComposerAttachmentPayload,
      getExistingComposerPayloadSnapshot,
      waitExistingComposerPayloadReadyForSend,
      findAttachmentEvidence,
      fileNameEvidence,
      isAttachmentStillUploading,
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

  function detectComposerResponseStateLight() {
    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      const composerText = ComposerApi.getComposerText();
      return {
        is_responding: false,
        response_state: 'ready',
        response_state_reason: 'home_new_chat_composer_ready_override',
        can_accept_input: true,
        can_send_now: true,
        has_composer_payload: !!composerText,
        response_state_at: Date.now(),
      };
    }

    const isResponding = ComposerApi.isAssistantLikelyBusy();
    const composerAvailable = typeof ComposerApi.canAcceptInput === 'function'
      ? ComposerApi.canAcceptInput()
      : (typeof ComposerApi.hasComposer === 'function'
        ? ComposerApi.hasComposer()
        : !!ComposerApi.getComposerText());
    const composerText = ComposerApi.getComposerText();
    const canAcceptInput = composerAvailable && !isResponding;
    const canSendNow = composerAvailable
      && !isResponding
      && (typeof ComposerApi.canSendNowLight === 'function'
        ? ComposerApi.canSendNowLight()
        : ComposerApi.canSendNow({ maxAgeMs: 450 }));

    if (isResponding) {
      return {
        is_responding: true,
        response_state: 'generating',
        response_state_reason: 'assistant_busy',
        can_accept_input: false,
        can_send_now: false,
        has_composer_payload: !!composerText,
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
        has_composer_payload: !!composerText,
        response_state_at: Date.now(),
      };
    }

    if (composerText) {
      return {
        is_responding: false,
        response_state: 'composing',
        response_state_reason: 'composer_has_text',
        can_accept_input: canAcceptInput,
        can_send_now: canSendNow,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

    if (canSendNow) {
      return {
        is_responding: false,
        response_state: 'ready',
        response_state_reason: 'native_send_ready',
        can_accept_input: canAcceptInput,
        can_send_now: true,
        has_composer_payload: false,
        response_state_at: Date.now(),
      };
    }

    return {
      is_responding: false,
      response_state: 'not_ready',
      response_state_reason: 'send_button_not_ready',
      can_accept_input: canAcceptInput,
      can_send_now: false,
      has_composer_payload: false,
      response_state_at: Date.now(),
    };
  }

  function detectComposerResponseState(options = {}) {
    if (options && options.light === true) {
      return detectComposerResponseStateLight();
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

      return {
        is_responding: false,
        response_state: 'ready',
        response_state_reason: 'home_new_chat_composer_ready_override',
        can_accept_input: true,
        can_send_now: true,
        attachment_count: attachmentCount,
        has_composer_payload: hasAttachmentPayload || !!composerText,
        response_state_at: Date.now(),
      };
    }

    const isResponding = ComposerApi.isAssistantLikelyBusy();
    const composerAvailable = typeof ComposerApi.canAcceptInput === 'function'
      ? ComposerApi.canAcceptInput()
      : (typeof ComposerApi.hasComposer === 'function'
        ? ComposerApi.hasComposer()
        : !!ComposerApi.getComposerText());
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
    const composerTextTrimmed = String(composerText || '').trim();
    const hasText = composerTextTrimmed.length > 0;
    const hasRealText = typeof ComposerApi.hasRealComposerText === 'function'
      ? ComposerApi.hasRealComposerText()
      : hasText;
    const hasRealBtn = typeof ComposerApi.hasRealSubmitButton === 'function'
      ? ComposerApi.hasRealSubmitButton()
      : false;
    const sendButton = ComposerApi.findSendButton({ silent: true });
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
        response_state_reason: sendButton ? 'empty_composer' : 'send_button_not_found',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
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
      return {
        is_responding: false,
        response_state: hasAttachmentPayload ? 'attachment_processing' : 'composing',
        response_state_reason: 'payload_ready_but_send_button_missing',
        can_accept_input: canAcceptInput,
        can_send_now: false,
        attachment_count: attachmentCount,
        has_composer_payload: true,
        response_state_at: Date.now(),
      };
    }

    return {
      is_responding: false,
      response_state: 'ready',
      response_state_reason: 'payload_ready',
      can_accept_input: canAcceptInput,
      can_send_now: canSendNow,
      attachment_count: attachmentCount,
      has_composer_payload: true,
      response_state_at: Date.now(),
    };
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

  function evaluateComposerSendability(sendButtonInput) {
    const composerText = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '')
      : '';
    const textLen = composerText.trim().length;
    const hasAttachment = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
      ? ComposerApi.hasComposerAttachmentUnified()
      : hasComposerAttachment();

    const sendButton = sendButtonInput instanceof HTMLButtonElement
      ? sendButtonInput
      : findChatGPTSendButton();
    const realSendButtonEnabled = isRealSendButtonEnabled(sendButton);
    const sendable = textLen > 0 || hasAttachment || realSendButtonEnabled;
    const responseState = detectComposerResponseState();

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
      realSendButtonEnabled,
      sendable,
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
        if (!wasBusy && typeof TitlePrefixModule.stopReplyDoneFlash === 'function') {
          TitlePrefixModule.stopReplyDoneFlash('assistant-started');
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
        const titleFlashReason = `assistant-finished:${reason || '-'}`;
        const titleFlashOptions = { intervalMs: 600, autoStopMs: 0 };
        TitlePrefixModule.startReplyDoneFlash(titleFlashReason, titleFlashOptions);

        if (typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.flashHeaderTitleOnce === 'function') {
          ToolboxShell.flashHeaderTitleOnce('回复完成', titleFlashOptions);
        }

        refreshToolboxPageStatusDisplay(`assistant-finished:${reason || '-'}`);
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
      TitlePrefixModule.stopReplyDoneFlash('watcher-stop');
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
    ToolboxShell.appendLog(
      `[CHAT_QUEUE][PENDING_CHECK]`
      + ` session_id=${sessionId || '-'}`
      + ` queue_size=${CHAT_QUEUE.length}`
      + ` active_pending_count=${activeCount}`
      + ` ignored_queued_count=${ignoredQueued}`
      + ` pending_message_ids=${pendingIds.join(',') || '-'}`
      + ` decision=${decision}`
    );

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
    if (!result || typeof result !== 'object') {
      return;
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
    return raw || '-';
  }

  let toolboxTurnStatusRefreshTimer = 0;
  let toolboxTurnStatusRefreshPendingMode = 'light';
  let lastLoggedConversationTurnCount = null;

  function getConversationDomScanRoot() {
    const main = document.querySelector('main');
    if (main instanceof HTMLElement) {
      return main;
    }

    return document.body instanceof HTMLElement ? document.body : null;
  }

  function getLightConversationStatsForHeader() {
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

  function countConversationTurnsFromSnapshot() {
    const snapshot = buildConversationSnapshotForBridge(null, {
      source: 'countConversationTurnsFromSnapshot',
    });
    if (!snapshot || !Array.isArray(snapshot.messages)) {
      return 0;
    }
    const userCount = snapshot.messages.filter((message) => message && message.role === 'user').length;
    if (userCount > 0) {
      return userCount;
    }
    const assistantCount = snapshot.messages.filter(
      (message) => message && message.role === 'assistant',
    ).length;
    if (assistantCount > 0) {
      return assistantCount;
    }
    if (snapshot.messages.length > 0) {
      return Math.ceil(snapshot.messages.length / 2);
    }
    return 0;
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

  function scheduleToolboxTurnStatusRefresh(reason = 'dom-change', mode = 'auto') {
    const startedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const isResponding = typeof ComposerApi !== 'undefined'
      && typeof ComposerApi.isAssistantLikelyBusy === 'function'
      && ComposerApi.isAssistantLikelyBusy();
    void isResponding;

    let resolvedMode = mode;
    if (mode === 'auto') {
      resolvedMode = 'light';
    }

    if (resolvedMode === 'heavy') {
      toolboxTurnStatusRefreshPendingMode = 'heavy';
    } else if (toolboxTurnStatusRefreshPendingMode !== 'heavy') {
      toolboxTurnStatusRefreshPendingMode = 'light';
    }

    if (toolboxTurnStatusRefreshTimer) {
      window.clearTimeout(toolboxTurnStatusRefreshTimer);
    }

    toolboxTurnStatusRefreshTimer = window.setTimeout(() => {
      toolboxTurnStatusRefreshTimer = 0;
      const modeToRun = toolboxTurnStatusRefreshPendingMode;
      toolboxTurnStatusRefreshPendingMode = 'light';

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.refreshToolboxTurnStatus === 'function'
      ) {
        UploadModule.refreshToolboxTurnStatus(reason, modeToRun);
      } else if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.refreshToolboxTopStatus === 'function'
      ) {
        UploadModule.refreshToolboxTopStatus(reason);
        if (
          modeToRun === 'heavy'
          && typeof UploadModule.renderAllButtonStates === 'function'
        ) {
          UploadModule.renderAllButtonStates({ heavy: true });
        } else if (typeof UploadModule.renderAllButtonStates === 'function') {
          UploadModule.renderAllButtonStates({ heavy: false });
        } else if (typeof UploadModule.renderUploadButtonsOnly === 'function') {
          UploadModule.renderUploadButtonsOnly({ heavy: modeToRun === 'heavy' });
        }
      }

      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );
      if (typeof logPerfThrottled === 'function') {
        logPerfThrottled(
          'toolboxTurnStatusRefresh',
          `[PERF][toolboxTurnStatusRefresh] cost=${costMs}ms mode=${modeToRun} reason=${reason}`,
        );
      }
    }, 300);
  }

  function observeConversationTarget(target, reason) {
    if (!(target instanceof HTMLElement)) {
      console.warn('[TOOLBOX][turn_count_observer][failed] reason=target_missing detail=' + (reason || '-'));
      return;
    }

    let observer = ChatMessageRuntime.conversationObserver;
    const oldTarget = ChatMessageRuntime.conversationObserverTarget;

    if (observer && oldTarget && oldTarget !== target) {
      observer.disconnect();
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[TURN_OBSERVER][DISCONNECT_OLD] reason=${reason || '-'}`);
      }
    }

    if (!observer) {
      observer = new MutationObserver((mutations) => {
        markLatestAssistantMessageCacheDirty();

        const mainNow = document.querySelector('main');
        if (mainNow && mainNow !== ChatMessageRuntime.lastMainNode) {
          ChatMessageRuntime.lastMainNode = mainNow;
          cleanupChatMessageCaches('main-dom-replaced');
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog('[TURN_OBSERVER][REBOUND_MAIN]');
          }
          observeConversationTarget(mainNow, 'main-dom-replaced');
          return;
        }

        const onlyCharacterData = mutations.length > 0
          && mutations.every((mutation) => mutation.type === 'characterData');
        scheduleToolboxTurnStatusRefresh(
          onlyCharacterData ? 'conversation-character-data' : 'conversation-dom-mutated',
          'light',
        );
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

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
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
        const stats = getLightConversationStatsForHeader();
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

  function getPageCapability(reason = '') {
    const conversationId = parseConversationIdFromPath(location.pathname || '');
    const url = location.href || '';
    const pathname = location.pathname || '';
    const isHomePage = pathname === '/' || pathname === '';
    const responseState = detectComposerResponseState();
    const clientId = (() => {
      try {
        return sessionStorage.getItem('tm_bridge_client_id') || '';
      } catch (err) {
        console.error('[ChatGPT toolbox] getPageCapability client_id read failed', err);
        return '';
      }
    })();

    const responding = Boolean(responseState.is_responding);

    const capability = {
      client_id: clientId,
      page_instance_id: getToolboxPageInstanceId(),
      conversation_id: conversationId,
      url,
      page_type: conversationId ? 'conversation' : (isHomePage ? 'home' : 'unknown'),
      online: true,
      is_responding: responding,
      response_state: responseState.response_state || 'unknown',
      response_state_reason: resolvePageCapabilityReason(responseState, conversationId, url),
      bridge_connected: Boolean(BridgePollRuntime.bridge_connected),
      can_send_now: Boolean(responseState.can_send_now),
      can_accept_input: Boolean(responseState.can_accept_input),
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
      'button[aria-label*="发送"]',
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
      && typeof UploadModule.isWaitingSendActive === 'function'
      && UploadModule.isWaitingSendActive()
    ) {
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
    const isGenerating = domGenerating
      || !!(
        capability
        && capability.response_state === 'generating'
      );
    const isResponding = !!(
      capability
      && (
        capability.is_responding
        || capability.response_state === 'responding'
        || capability.response_state === 'generating'
      )
    ) || domGenerating;
    const isAnswering = isResponding || isGenerating;
    const responseInProgress = isAnswering;

    return {
      isGenerating,
      isResponding,
      isAnswering,
      responseInProgress,
    };
  }

  function getTopMainStatus() {
    if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[TOOLBOX_TOP_STATUS][STATE_OVERRIDE] reason=home_new_chat_ready_to_send');
      }
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

    if (!bridgeOnline || !pageOnline) {
      return {
        text: '离线',
        cls: 'cgpt-state-offline',
        type: 'offline',
        title: 'Bridge / 油猴页面不可用或未连接',
        reason: !bridgeOnline ? 'bridge_offline' : 'page_offline',
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
      text: '不可发送',
      cls: 'cgpt-state-blocked',
      type: 'blocked',
      title: domState && domState.title
        ? domState.title
        : '当前页面无法发送',
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
    const badge = document.querySelector('#cgpt-page-input-state');
    if (!badge) {
      return;
    }

    const info = getTopMainStatus();
    logTopMainStatusChange(info);

    badge.textContent = info.text;
    badge.title = info.title || info.text;

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
  const MAX_ATTACHMENT_SEND_WAIT_MS = 120000;
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
      probe.includes('启动语音功能')
      || probe.includes('开始听写')
      || probe.includes('停止听写')
      || probe.includes('语音')
      || probe.includes('听写')
      || probe.includes('麦克风')
      || probe.includes('录音')
      || probe.includes('voice')
      || probe.includes('microphone')
      || probe.includes('dictate')
      || probe.includes('speech')
      || probe.includes('audio')
      || probe.includes('mic')
      || probe.includes('#f8aa74')
    );
  }

  function hasVoiceComposerButtonOnly() {
    const byId = document.querySelector('#composer-submit-button');
    if (byId instanceof HTMLButtonElement && isVoiceComposerButton(byId)) {
      return true;
    }

    const buttons = Array.from(document.querySelectorAll('button'));
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

  function hasRealSubmitButton() {
    if (typeof ComposerApi.hasRealSubmitButton === 'function') {
      return ComposerApi.hasRealSubmitButton();
    }

    const btn = document.querySelector('#composer-submit-button');
    if (!(btn instanceof HTMLButtonElement) || isVoiceComposerButton(btn)) {
      return false;
    }

    if (btn.disabled) {
      return false;
    }

    const rect = btn.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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
    const prioritySelectors = [
      '#composer-submit-button',
      'button[data-testid="send-button"]',
      'main button[data-testid="send-button"]',
      'form button#composer-submit-button',
    ];

    for (let i = 0; i < prioritySelectors.length; i += 1) {
      const sel = prioritySelectors[i];
      const candidate = document.querySelector(sel);

      if (!(candidate instanceof HTMLElement)) {
        continue;
      }

      if (isVoiceComposerButton(candidate)) {
        const button = resolveComposerButtonElement(candidate);
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_REJECT] reason=voice_or_dictation selector=${sel} `
          + `id=${button ? String(button.id || '-') : '-'} class=${button ? String(button.className || '-') : '-'} `
          + `aria=${button ? String(button.getAttribute('aria-label') || '-') : '-'} `
          + `disabled=${button && button.disabled ? 1 : 0}`,
        );
        continue;
      }

      if (
        typeof ComposerApi.isRealSendButton === 'function'
        && ComposerApi.isRealSendButton(candidate)
      ) {
        const button = resolveComposerButtonElement(candidate);
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_FOUND] selector=${sel} `
          + `id=${button ? String(button.id || '-') : '-'} class=${button ? String(button.className || '-') : '-'} `
          + `aria=${button ? String(button.getAttribute('aria-label') || '-') : '-'} `
          + `testid=${button ? String(button.getAttribute('data-testid') || '-') : '-'} `
          + `disabled=${button && button.disabled ? 1 : 0}`,
        );
        return button;
      }
    }

    const buttons = Array.from(document.querySelectorAll('button'));

    for (const button of buttons) {
      if (!(button instanceof HTMLButtonElement) || isInsideToolbox(button)) {
        continue;
      }

      if (isVoiceComposerButton(button)) {
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_REJECT] reason=voice_or_dictation selector=button-scan `
          + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
          + `aria=${String(button.getAttribute('aria-label') || '-')} disabled=${button.disabled ? 1 : 0}`,
        );
        continue;
      }

      if (
        typeof ComposerApi.isRealSendButton === 'function'
        && ComposerApi.isRealSendButton(button)
      ) {
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_READY] selector=button-scan `
          + `id=${String(button.id || '-')} class=${String(button.className || '-')} `
          + `aria=${String(button.getAttribute('aria-label') || '-')} disabled=${button.disabled ? 1 : 0}`,
        );
        return button;
      }
    }

    ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_NOT_FOUND] reason=no-real-submit-button');
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

  function clickSendButton(button, source = 'stable-send') {
    const sendButton = resolveComposerButtonElement(button);

    if (!(sendButton instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'invalid_send_button' };
    }

    if (isVoiceComposerButton(sendButton)) {
      appendSendLogFields('[SEND][CLICK_REJECT]', {
        reason: 'voice_button',
        source,
        selector: describeComposerSendButtonForLog(sendButton).selector || '-',
      });
      return { ok: false, reason: 'voice_button_only', retryable: true };
    }

    if (isSendButtonDisabled(sendButton)) {
      return { ok: false, reason: 'send_button_disabled' };
    }

    try {
      const diag = getComposerSendDiagnostics();
      appendSendLogFields('[SEND][CLICK_SUBMIT_BUTTON]', {
        selector: sendButton.id === 'composer-submit-button' ? '#composer-submit-button' : describeComposerSendButtonForLog(sendButton).selector,
        ...diag,
        source,
      });
      sendButton.focus();
      sendButton.click();
      return { ok: true, reason: 'clicked' };
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.error('[ChatGPT toolbox] clickSendButton failed', {
        error_type: err && err.name ? err.name : 'Error',
        error: errText,
        stack: err && err.stack ? err.stack : '',
      });
      appendSendLogFields('[SEND][ERROR]', {
        tag: 'clickSendButton',
        error_type: err && err.name ? err.name : 'Error',
        error: errText,
        stack: err && err.stack ? String(err.stack).slice(0, 200) : '-',
      });
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
    const allowEnterFallbackWhenNoButton = options.allowEnterFallbackWhenNoButton === true;
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
          () => evaluateComposerSendability(findChatGPTSendButton()).realSendButtonEnabled,
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

  const SEND_FOREVER_COMPOSER_MISSING_MS = 120000;

  async function waitSendButtonForeverUntilReady(options = {}) {
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const pollMs = Number(options.pollMs || 250);
    const logIntervalMs = Number(options.logIntervalMs || 2000);
    let lastLogAt = 0;
    let loopCount = 0;
    let composerMissingSince = 0;

    while (true) {
      loopCount += 1;

      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return { ok: false, reason: 'page_navigating' };
      }

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      const composer = typeof ComposerApi.getComposer === 'function'
        ? ComposerApi.getComposer()
        : null;

      if (!(composer instanceof HTMLElement)) {
        if (!composerMissingSince) {
          composerMissingSince = Date.now();
        } else if (Date.now() - composerMissingSince >= SEND_FOREVER_COMPOSER_MISSING_MS) {
          return { ok: false, reason: 'composer_not_found' };
        }
      } else {
        composerMissingSince = 0;
      }

      let responseState = {};
      try {
        responseState = detectComposerResponseState();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] waitSendButtonForeverUntilReady response_state failed', err);
        appendSendLog(`[SEND][WAIT_FOREVER][error] response_state error=${errText}`);
      }

      if (responseState && responseState.is_responding) {
        return { ok: false, reason: 'assistant_busy', response_state: responseState };
      }

      const sendBtn = typeof ComposerApi.findSendButton === 'function'
        ? ComposerApi.findSendButton({ silent: true })
        : null;

      const buttonReady = !!(
        sendBtn
        && sendBtn instanceof HTMLButtonElement
        && typeof ComposerApi.isSendButtonReady === 'function'
        && ComposerApi.isSendButtonReady(sendBtn)
      );

      if (buttonReady) {
        appendSendLog(
          `[SEND][WAIT_FOREVER][READY] loop=${loopCount} `
          + `id=${sendBtn.id || '-'} `
          + `testid=${sendBtn.getAttribute('data-testid') || '-'} `
          + `aria=${sendBtn.getAttribute('aria-label') || '-'}`,
        );
        return {
          ok: true,
          reason: 'send_button_ready',
          button: sendBtn,
        };
      }

      if (
        typeof ComposerApi.isAttachmentStillUploading === 'function'
        && ComposerApi.isAttachmentStillUploading()
      ) {
        const now = Date.now();
        if (now - lastLogAt >= logIntervalMs) {
          appendSendLog(
            `[SEND][WAIT_FOREVER] phase=attachment_processing loop=${loopCount} `
            + `button_found=${sendBtn ? 1 : 0} disabled=${sendBtn && isSendButtonDisabled(sendBtn) ? 1 : 0} `
            + `response_state=${responseState.response_state || '-'} `
            + `reason=${responseState.response_state_reason || '-'}`,
          );
          lastLogAt = now;
        }
        await sleep(pollMs);
        continue;
      }

      const now = Date.now();
      if (now - lastLogAt >= logIntervalMs) {
        appendSendLog(
          `[SEND][WAIT_FOREVER] phase=wait_button loop=${loopCount} `
          + `found=${sendBtn ? 1 : 0} `
          + `disabled=${sendBtn && sendBtn.disabled ? 1 : 0} `
          + `ariaDisabled=${sendBtn && sendBtn.getAttribute('aria-disabled') === 'true' ? 1 : 0} `
          + `response_state=${responseState.response_state || '-'} `
          + `reason=${responseState.response_state_reason || '-'}`,
        );
        lastLogAt = now;
      }

      await sleep(pollMs);
    }
  }

  async function sendUntilConfirmedForever(options = {}) {
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const source = String(options.source || 'manual-send-forever');
    const confirmTimeoutMs = Number(options.confirmTimeoutMs || 5000);
    let attempt = 0;

    ChatInputStateRuntime.sendInProgress = true;
    updateChatInputStateBadge();

    try {
      while (true) {
        attempt += 1;

        if (shouldStop()) {
          return { ok: false, reason: 'cancelled', source };
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return { ok: false, reason: 'page_offline', source };
        }

        const ready = await waitSendButtonForeverUntilReady({
          shouldStop,
          pollMs: 250,
          logIntervalMs: 2000,
        });

        if (!ready.ok) {
          if (ready.reason === 'assistant_busy') {
            return { ok: false, reason: 'assistant_busy', source, response_state: ready.response_state };
          }
          if (ready.reason === 'cancelled') {
            return { ok: false, reason: 'cancelled', source };
          }
          if (ready.reason === 'composer_not_found') {
            return { ok: false, reason: 'composer_not_found', source };
          }

          appendSendLog(`[SEND][FOREVER][WAIT_NOT_READY] attempt=${attempt} reason=${ready.reason || '-'}`);
          await sleep(500);
          continue;
        }

        const beforeLatestRecordRaw = getLatestConversationMessageRecordFast({ preferAssistant: false });
        const beforeLatestRecord = stripMessageRecordForCache(beforeLatestRecordRaw);
        const beforeLatestKey = beforeLatestRecord ? beforeLatestRecord.key : '';
        const conversationIdBefore = parseConversationIdFromPath(location.pathname || '') || '';
        const urlBefore = location.href || '';
        const composerTextBeforeSend = ComposerApi.getComposerText();
        const attachmentCountBeforeSend = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;

        const confirmCtx = {
          contentText: String(composerTextBeforeSend || '').trim(),
          contentProbe: String(composerTextBeforeSend || '').trim().slice(0, 80),
          attachmentCountBeforeSend,
          beforeLatestKey,
          conversationIdBefore,
          urlBefore,
          sendButtonEnabledBefore: true,
          hadTextPayload: !!String(composerTextBeforeSend || '').trim() || attachmentCountBeforeSend > 0,
        };

        appendSendLog(
          `[SEND][FOREVER][ATTEMPT] attempt=${attempt} `
          + `textLen=${String(composerTextBeforeSend || '').length} `
          + `attachmentCount=${attachmentCountBeforeSend} `
          + `url=${urlBefore}`,
        );

        const sendAction = await performSendActionsWithFallback(confirmCtx, shouldStop);
        if (!sendAction.ok) {
          appendSendLog(
            `[SEND][FOREVER][ACTION_FAILED] attempt=${attempt} `
            + `reason=${sendAction.reason || '-'}`,
          );
          await sleep(500);
          continue;
        }

        const confirmed = await waitComposerSendConfirmed(
          composerTextBeforeSend,
          confirmTimeoutMs,
          {
            shouldStop,
            beforeLatestKey,
            attachmentCountBeforeSend,
            conversationIdBefore,
            urlBefore,
            sendButtonEnabledBefore: true,
          },
        );

        if (confirmed.ok) {
          appendSendLog(
            `[SEND][FOREVER][SUCCESS] attempt=${attempt} `
            + `reason=${confirmed.reason || '-'}`,
          );
          ChatInputStateRuntime.waitingForReply = true;
          return {
            ok: true,
            reason: confirmed.reason || 'sent',
            source,
            attempts: attempt,
          };
        }

        appendSendLog(
          `[SEND][FOREVER][NOT_CONFIRMED] attempt=${attempt} `
          + `reason=${confirmed.reason || '-'}`,
        );
        await sleep(800);
      }
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      const stack = err && err.stack ? String(err.stack).slice(0, 400) : '';
      console.error('[ChatGPT toolbox] sendUntilConfirmedForever failed', err);
      ToolboxShell.appendLog(`[SEND][FOREVER][ERROR] ${errText}${stack ? ` stack=${stack}` : ''}`);
      return { ok: false, reason: 'send_exception', source, error: errText };
    } finally {
      ChatInputStateRuntime.sendInProgress = false;
      updateChatInputStateBadge();
    }
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
