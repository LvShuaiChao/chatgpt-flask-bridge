// ==UserScript==
// @name         ChatGPT 工具箱：多文件上传 + 自动指令队列 + Prompt 管理
// @namespace    https://github.com/xiaozhang/chatgpt-toolbox
// @version      3.6.6
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
      if (/^已思考.*秒$/.test(trimmed)) return true;
      if (/^Thought for \d+/i.test(trimmed)) return true;
      if (/^Read for \d+/i.test(trimmed)) return true;
      return false;
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

      return rebuilt
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
            containerForText.textContent || containerForText.innerText || '',
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
        record.turn_id || '',
        text,
        String(record.char_count || 0),
        String(record.no_space_char_count || 0),
      ].join('||');
    }

    async function waitLatestAssistantStable(options = {}) {
      const timeoutMs = Number(options.timeoutMs ?? 12000);
      const intervalMs = Number(options.intervalMs ?? 300);
      const stableRounds = Number(options.stableRounds ?? 2);
      const isGenerating = typeof options.isGenerating === 'function' ? options.isGenerating : () => false;

      const startedAt = Date.now();
      let stableCount = 0;
      let lastSignature = '';
      let lastPicked = null;

      while (Date.now() - startedAt < timeoutMs) {
        if (isGenerating()) {
          stableCount = 0;
          lastSignature = '';
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-check] state=generating');
          await sleep(intervalMs);
          continue;
        }

        const records = buildRecords({ includeEmpty: false });
        const picked = getLatestAssistantAfterLatestUser(records);
        lastPicked = picked;

        if (!picked.ok) {
          stableCount = 0;
          lastSignature = '';
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:stable-check] state=${picked.reason || 'no-assistant'}`
          );
          await sleep(intervalMs);
          continue;
        }

        const record = picked.record;
        const text = cleanMessageText(record.text || '');
        const signature = buildStableSignature(record, text);

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:stable-check] stable=${stableCount}/${stableRounds} chars=${record.char_count} source=${record.extract_source || '-'} hasThinking=${record.has_thinking_boundary ?? 0} contentNodes=${record.content_node_count ?? '-'} contentChars=${record.content_text_chars ?? '-'} fullTurnChars=${record.full_turn_text_chars ?? '-'} turn=${record.turn_id || '-'}`
        );

        if (signature && signature === lastSignature) {
          stableCount += 1;
        } else {
          stableCount = 1;
          lastSignature = signature;
        }

        if (stableCount >= stableRounds && text) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-ok]');
          return {
            ok: true,
            record,
            text,
            reason: 'stable',
            latestUser: picked.latestUser || null,
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
        lastRecord: finalPicked.record || lastPicked?.record || null,
        latestUser: finalPicked.latestUser || lastPicked?.latestUser || null,
      };
    }

    return {
      buildRecords,
      getLatestAssistantAfterLatestUser,
      cleanMessageText,
      waitLatestAssistantStable,
    };
  })();

  function buildConversationMessageRecords(options = {}) {
    return ChatMessageExtractor.buildRecords(options);
  }

  function getLatestConversationMessageRecord(options = {}) {
    const preferredRole = String(options.role || '').toLowerCase();
    const preferAssistant = options.preferAssistant !== false;
    const allowPreviousAssistantFallback = options.allowPreviousAssistantFallback === true;
    const records = buildConversationMessageRecords({
      includeEmpty: false,
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

  function getLatestAssistantAfterLatestUserRecord(options = {}) {
    const records = buildConversationMessageRecords({
      includeEmpty: false,
      includeHidden: options.includeHidden === true,
    });
    const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records, {
      allowNoUserFallback: options.allowNoUserFallback === true,
    });

    if (!picked.ok || !picked.record) {
      return null;
    }

    const text = ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();

    return {
      ...picked.record,
      text,
      ok: true,
      latestUser: picked.latestUser || null,
      reason: picked.reason || '',
    };
  }

  function getValidAssistantTextsFromDom() {
    const main = document.querySelector('main') || document.body;
    if (!(main instanceof HTMLElement)) {
      return [];
    }

    return Array.from(main.querySelectorAll('[data-message-author-role="assistant"]'))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !isInToolbox(node) && !isInComposerArea(node) && !isChatSidebarElement(node))
      .map((node) => String(node.innerText || node.textContent || '').trim())
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

  function getLatestAssistantTextFromDomDirect() {
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

      const text = String(node.innerText || node.textContent || '').trim();

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

  function getLatestAssistantMessageForCopy() {
    const record = getLatestAssistantAfterLatestUserRecord({
      includeHidden: true,
    });

    if (!record || !record.text) {
      return {
        ok: false,
        text: '',
        reason: 'no-assistant-after-latest-user',
        record: null,
      };
    }

    return {
      ok: true,
      text: record.text,
      record,
    };
  }

  function pickLatestAssistantTextFromBridgeSnapshot() {
    try {
      const snapshot = buildConversationSnapshotForBridge(null);
      const latest = snapshot && (snapshot.latest_assistant_reply || snapshot.latest_message);
      if (!latest || latest.role !== 'assistant') {
        return { ok: false, text: '', reason: 'no_assistant_message', record: null };
      }
      const text = ChatMessageExtractor.cleanMessageText(latest.text || '').trim();
      if (!text) {
        return { ok: false, text: '', reason: 'empty_content', record: latest };
      }
      return {
        ok: true,
        text,
        reason: 'bridge_snapshot',
        record: latest,
        role: 'assistant',
      };
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      ToolboxShell.appendLog(`[COPY_LAST][SNAPSHOT_FAIL] error=${errText}`);
      return { ok: false, text: '', reason: 'snapshot_failed', record: null };
    }
  }

  function tryCopyLastAssistantSnapshotFallback(records, triggerReason = '') {
    const snapshotPick = pickLatestAssistantTextFromBridgeSnapshot();
    if (!snapshotPick.ok || !snapshotPick.text) {
      ToolboxShell.appendLog(
        `[COPY_LAST][SNAPSHOT_FALLBACK_REJECTED] trigger=${triggerReason || '-'} reason=${snapshotPick.reason || 'no_text'}`,
      );
      return null;
    }

    let latestUser = null;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (records[i].role === 'user') {
        latestUser = records[i];
        break;
      }
    }

    const snapIdx =
      snapshotPick.record && Number.isFinite(snapshotPick.record.index)
        ? snapshotPick.record.index
        : -1;

    if (latestUser && snapIdx >= 0 && snapIdx <= latestUser.index) {
      ToolboxShell.appendLog(
        `[COPY_LAST][SNAPSHOT_FALLBACK_REJECTED] trigger=${triggerReason || '-'} reason=before_latest_user latestUserIndex=${latestUser.index} snapshotIndex=${snapIdx}`,
      );
      return null;
    }

    ToolboxShell.appendLog(
      `[COPY_LAST][SNAPSHOT_FALLBACK_OK] trigger=${triggerReason || '-'} chars=${snapshotPick.text.length}`,
    );

    return {
      ok: true,
      text: snapshotPick.text,
      role: 'assistant',
      reason: 'snapshot_fallback',
      record: snapshotPick.record || null,
    };
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

  function buildConversationSnapshotForBridge(resolvePageIdentity) {
    try {
      const rawMessages = buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden: true,
      });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][conversation-snapshot] messages=${rawMessages.length} includeHidden=1`,
        );
      }

      const messages = rawMessages
        .map((record) => bridgeSafeConversationRecord(record))
        .filter(Boolean);

      const latestAny = messages.length ? messages[messages.length - 1] : null;
      const pickedAssistant = ChatMessageExtractor.getLatestAssistantAfterLatestUser(rawMessages);
      const latestAssistant = pickedAssistant.ok && pickedAssistant.record
        ? bridgeSafeConversationRecord(pickedAssistant.record)
        : null;

      const page = typeof resolvePageIdentity === 'function' ? resolvePageIdentity() : {};

      return {
        page,
        message_count: messages.length,
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
      };
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] buildConversationSnapshotForBridge failed', error);
      ToolboxShell.appendLog(`[CHAT_PAGE][conversation-snapshot:failed] error=${errText}`);
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

    function isLikelyComposerSendButton(btn) {
      if (!(btn instanceof HTMLButtonElement)) {
        return false;
      }

      const testId = String(btn.getAttribute('data-testid') || '').toLowerCase();
      const id = String(btn.id || '').toLowerCase();
      const aria = String(btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = String(btn.getAttribute('title') || '').trim().toLowerCase();
      const text = String(btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const type = String(btn.getAttribute('type') || '').toLowerCase();

      const positive = [
        testId === 'send-button',
        testId === 'composer-submit-button',
        id === 'composer-submit-button',
        ['发送', '发送消息', '发送提示', 'send', 'send message', 'send prompt'].includes(aria),
        ['发送', '发送消息', 'send', 'send message'].includes(title),
        ['发送', 'send'].includes(text),
      ];

      if (positive.some(Boolean)) {
        return true;
      }

      const negativeText = `${testId} ${id} ${aria} ${title} ${text}`;
      if (/attach|upload|file|附件|上传|voice|mic|microphone|audio|tool|工具|model|模型|search|搜索/i.test(negativeText)) {
        return false;
      }

      if (type === 'submit') {
        return false;
      }

      return false;
    }

    function findSendButton(options = {}) {
      const silent = options.silent === true;
      const composer = getComposer();
      if (!(composer instanceof HTMLElement)) {
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
      const scopes = [];

      if (composerRoot instanceof HTMLElement) {
        scopes.push(composerRoot);
      }

      if (composerForm instanceof HTMLElement && !scopes.includes(composerForm)) {
        scopes.push(composerForm);
      }

      const main = qs('main');
      if (main instanceof HTMLElement && !scopes.includes(main)) {
        scopes.push(main);
      }

      if (document.body instanceof HTMLElement && !scopes.includes(document.body)) {
        scopes.push(document.body);
      }

      const selectors = SELECTORS.sendButton || [];

      for (const scope of scopes) {
        for (const sel of selectors) {
          const candidates = Array.from(scope.querySelectorAll(sel));

          for (const candidate of candidates) {
            if (!(candidate instanceof HTMLButtonElement)) {
              continue;
            }

            if (isInToolbox(candidate)) {
              continue;
            }

            if (!isElementVisible(candidate)) {
              continue;
            }

            if (
              scope !== document.body &&
              !isButtonBelongsToComposer(candidate, composer, composerRoot, composerForm)
            ) {
              continue;
            }

            if (!isLikelyComposerSendButton(candidate)) {
              continue;
            }

            if (
              scope === document.body &&
              !isButtonBelongsToComposer(candidate, composer, composerRoot, composerForm) &&
              !isButtonNearComposer(candidate, composer)
            ) {
              continue;
            }

            const source = scope === composerRoot
              ? 'composerRoot'
              : (scope === composerForm ? 'composerForm' : (scope === main ? 'main' : 'document.body'));
            if (!silent) {
              appendComposerLogThrottled(
                `find-send-button:found:${source}`,
                `[COMPOSER][find-send-button:found] source=${source} `
                + `testid=${String(candidate.getAttribute('data-testid') || '-')}`
                + ` id=${String(candidate.id || '-')}`
                + ` aria=${String(candidate.getAttribute('aria-label') || '-')}`
                + ` title=${String(candidate.getAttribute('title') || '-')}`,
                1000,
              );
            }
            return candidate;
          }
        }
      }

      if (!silent) {
        appendComposerLogThrottled(
          'find-send-button:no-scoped-send-button',
          '[COMPOSER][find-send-button:not-found] reason=no-scoped-send-button',
        );
      }
      return null;
    }


    function isSendButtonReady(btn) {
      if (!btn || !isElementVisible(btn)) return false;
      if (btn.disabled) return false;

      const ariaDisabled = btn.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') return false;

      if (btn.getAttribute('data-disabled') === 'true') return false;

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

    function setComposerValue(value) {
      const el = getComposer();
      if (!el) return false;

      el.focus();

      if (el.matches && el.matches('textarea,input')) {
        setNativeTextareaValue(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      if (el.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();

        range.selectNodeContents(el);
        range.collapse(false);

        selection.removeAllRanges();
        selection.addRange(range);

        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, value);
        } catch (e) {
          console.warn('[ChatGPT toolbox] execCommand insertText failed; fallback to textContent', e);
          el.textContent = value;
        }

        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value,
        }));

        el.dispatchEvent(new Event('change', {
          bubbles: true,
        }));

        return true;
      }

      return false;
    }

    function getComposerText() {
      const el = getComposer();
      if (!el) return '';

      if (el.matches && el.matches('textarea,input')) {
        return String(el.value || '').trim();
      }

      return String(el.innerText || el.textContent || '')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function canSendNow() {
      const composer = getComposer();
      if (!(composer instanceof HTMLElement)) {
        return false;
      }

      if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
        return false;
      }

      const sendBtn = findSendButton();
      if (!sendBtn) {
        return false;
      }

      return isSendButtonReady(sendBtn);
    }

    function clickSend() {
      const sendBtn = findSendButton();

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

      sendBtn.click();
      return true;
    }

    function isAssistantLikelyBusy() {
      const stopBtn = qs(SELECTORS.stopButton);
      if (stopBtn && isElementVisible(stopBtn) && !stopBtn.disabled) {
        return true;
      }

      const hints = [
        '.result-streaming',
        '[data-testid="stop-button"]',
        '[aria-label*="Stop"]',
        '[aria-label*="停止"]',
      ];

      return hints.some((sel) => {
        const el = qs(sel);
        return el && !isInToolbox(el) && isElementVisible(el);
      });
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

    function countAttachmentChips() {
      let count = 0;
      forEachLikelyAttachmentElement(() => {
        count += 1;
      });
      return count;
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
      const root = getComposerRoot() || qs('main') || document.body;
      const parts = [];

      qsa('[data-testid], [aria-label], [title], [role], button, div, span', root).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isInToolbox(el)) return;

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

      return [...new Set(parts)].join('\n');
    }

    function isAttachmentStillUploading() {
      const root = getComposerRoot() || qs('main') || document.body;

      const busyNode = qsa('[role="progressbar"], [aria-busy="true"], [data-testid*="progress"], [data-testid*="spinner"], svg[class*="animate"], .animate-spin', root)
        .find((el) => el instanceof HTMLElement || el instanceof SVGElement);

      if (busyNode && !isInToolbox(busyNode)) {
        return true;
      }

      const text = collectComposerAttachmentStatusText();

      return /uploading|上传中|processing|处理中|loading|加载中|扫描中|正在上传|正在处理/i.test(text);
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

    return {
      getComposerText,
      setComposerValue,
      findSendButton,
      isSendButtonReady,
      clickSend,
      hasComposer,
      canAcceptInput,
      canAcceptTextInput,
      canSendNow,
      isAssistantLikelyBusy,
      attachFilesByFileInput,
      clearAttachments,
      collectAttachmentChipText,
      countAttachmentChips,
      findAttachmentEvidence,
      fileNameEvidence,
      isAttachmentStillUploading,
      getChatMessageElementsInOrder,
    };
  })();

  function detectComposerResponseState() {
    const isResponding = ComposerApi.isAssistantLikelyBusy();
    const composerAvailable = typeof ComposerApi.canAcceptInput === 'function'
      ? ComposerApi.canAcceptInput()
      : (typeof ComposerApi.hasComposer === 'function'
        ? ComposerApi.hasComposer()
        : !!ComposerApi.getComposerText());
    const composerText = ComposerApi.getComposerText();
    const sendButton = ComposerApi.findSendButton({ silent: true });
    const canAcceptInput = composerAvailable && !isResponding;
    const canSendNow = composerAvailable
      && !isResponding
      && !!sendButton
      && ComposerApi.isSendButtonReady(sendButton);

    if (isResponding) {
      return {
        is_responding: true,
        response_state: 'generating',
        response_state_reason: 'assistant_busy',
        can_accept_input: false,
        can_send_now: false,
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
        response_state_at: Date.now(),
      };
    }

    return {
      is_responding: false,
      response_state: 'idle',
      response_state_reason: sendButton ? 'empty_composer' : 'send_button_not_found',
      can_accept_input: canAcceptInput,
      can_send_now: canSendNow,
      response_state_at: Date.now(),
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
          TitlePrefixModule.stopReplyDoneFlash(`assistant-start:${reason || '-'}`);
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
        TitlePrefixModule.startReplyDoneFlash(`assistant-finished:${reason || '-'}`);
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
  };

  let lastPageDisplayIdMissingWarnAt = 0;
  const PAGE_DISPLAY_ID_MISSING_WARN_MS = 15000;

  const BridgePollRuntime = {
    bridge_connected: false,
    last_poll_ok: null,
    last_poll_error: '',
    last_poll_at: 0,
  };

  const ChatInputStateRuntime = {
    waitingForReply: false,
  };

  function hasValidPageDisplayId(value) {
    const text = String(value ?? '').trim();
    return text !== '' && text !== '-';
  }

  function extractPageDisplayIdFromPollResult(result) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const candidates = [
      result.page_display_id,
      result.pageDisplayId,
      result.page && result.page.page_display_id,
      result.runtime && result.runtime.page_display_id,
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      const text = String(candidates[i] ?? '').trim();
      if (hasValidPageDisplayId(text)) {
        return text;
      }
    }

    return null;
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
      ?? (result.page && result.page.page_display_id)
      ?? (result.runtime && result.runtime.page_display_id)
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

    refreshToolboxPageStatusDisplay(reason || 'bridge-poll');
  }

  function refreshToolboxPageStatusDisplay(reason = '') {
    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.refreshToolboxTopStatus === 'function'
    ) {
      UploadModule.refreshToolboxTopStatus(reason);
    }

    updateChatInputStateBadge();
  }

  function getBridgePageDisplayIdText() {
    const raw = String(BRIDGE_STATE.page_display_id || '').trim();
    return raw || '-';
  }

  let toolboxTurnStatusRefreshTimer = 0;
  let lastLoggedConversationTurnCount = null;

  function countUserTurnsFromDomDirect() {
    const roots = [];

    const main = document.querySelector('main');
    if (main instanceof HTMLElement) {
      roots.push(main);
    }

    roots.push(document.body);

    const seen = new Set();
    let count = 0;

    roots.forEach((root) => {
      if (!(root instanceof HTMLElement)) {
        return;
      }

      const nodes = Array.from(root.querySelectorAll('[data-message-author-role="user"]'));

      nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        if (isInToolbox(node)) {
          return;
        }

        if (isInComposerArea(node)) {
          return;
        }

        if (isChatSidebarElement(node)) {
          return;
        }

        const text = String(node.innerText || node.textContent || '').trim();
        if (!text) {
          return;
        }

        const turn = node.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]') || node;
        if (!(turn instanceof HTMLElement)) {
          return;
        }

        if (seen.has(turn)) {
          return;
        }

        seen.add(turn);
        count += 1;
      });
    });

    return count;
  }

  function countAssistantTurnsFromDomDirect() {
    const roots = [];

    const main = document.querySelector('main');
    if (main instanceof HTMLElement) {
      roots.push(main);
    }

    roots.push(document.body);

    const seen = new Set();
    let count = 0;

    roots.forEach((root) => {
      if (!(root instanceof HTMLElement)) {
        return;
      }

      const nodes = Array.from(root.querySelectorAll('[data-message-author-role="assistant"]'));

      nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        if (isInToolbox(node)) {
          return;
        }

        if (isInComposerArea(node)) {
          return;
        }

        if (isChatSidebarElement(node)) {
          return;
        }

        const text = String(node.innerText || node.textContent || '').trim();
        if (!text) {
          return;
        }

        const turn = node.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]') || node;
        if (!(turn instanceof HTMLElement)) {
          return;
        }

        if (seen.has(turn)) {
          return;
        }

        seen.add(turn);
        count += 1;
      });
    });

    return count;
  }

  function countUserMessagesFromConversationRecords() {
    const records = buildConversationMessageRecords({
      includeEmpty: false,
      includeHidden: true,
    });
    return records.filter((record) => record && record.role === 'user').length;
  }

  function countConversationTurnsFromSnapshot() {
    const snapshot = buildConversationSnapshotForBridge(null);
    if (!snapshot || !Array.isArray(snapshot.messages)) {
      return 0;
    }
    const userCount = snapshot.messages.filter((message) => message && message.role === 'user').length;
    if (userCount > 0) {
      return userCount;
    }
    return snapshot.messages.length;
  }

  function countConversationTurnsFromDom() {
    const turnElements = findConversationMessageElements({ includeHidden: true });
    return turnElements.length;
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

  function scheduleToolboxTurnStatusRefresh(reason = 'dom-change') {
    if (toolboxTurnStatusRefreshTimer) {
      window.clearTimeout(toolboxTurnStatusRefreshTimer);
    }

    toolboxTurnStatusRefreshTimer = window.setTimeout(() => {
      toolboxTurnStatusRefreshTimer = 0;

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.refreshToolboxTopStatus === 'function'
      ) {
        UploadModule.refreshToolboxTopStatus(reason);
      }
    }, 300);
  }

  function bindConversationTurnCountObserver() {
    if (window.__cgptTurnCountObserverBound) {
      return;
    }

    window.__cgptTurnCountObserverBound = true;

    const target = document.querySelector('main') || document.body;
    if (!(target instanceof HTMLElement)) {
      console.warn('[TOOLBOX][turn_count_observer][failed] reason=target_missing');
      return;
    }

    const observer = new MutationObserver(() => {
      scheduleToolboxTurnStatusRefresh('conversation-dom-mutated');
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.__cgptTurnCountObserver = observer;

    scheduleToolboxTurnStatusRefresh('observer-bound');
  }

  function getConversationTurnCount() {
    const strategies = [
      { name: 'user-role-dom-direct', run: countUserTurnsFromDomDirect },
      { name: 'conversation-records-user', run: countUserMessagesFromConversationRecords },
      { name: 'conversation-snapshot-user', run: countConversationTurnsFromSnapshot },
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

    return {
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
  }

  function isDomElementVisible(el) {
    if (!(el instanceof Element)) {
      return false;
    }

    if (el.disabled) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function detectChatInputStateFromDom() {
    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="停止"]',
      'button[data-testid*="stop"]',
    ];

    for (const selector of stopSelectors) {
      const stopBtn = document.querySelector(selector);
      if (isDomElementVisible(stopBtn)) {
        return {
          text: '生成中',
          cls: 'cgpt-state-generating',
          title: 'ChatGPT 正在回答，暂时不建议发送新消息',
        };
      }
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

    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.isWaitingForReply === 'function'
      && UploadModule.isWaitingForReply()
    ) {
      return true;
    }

    return false;
  }

  function getChatInputState() {
    const capability = typeof getPageCapability === 'function'
      ? getPageCapability('input-state')
      : null;
    const domState = detectChatInputStateFromDom();

    const bridgeConnected = !!(capability && capability.bridge_connected);
    let isResponding = !!(
      capability
      && (
        capability.is_responding
        || capability.is_responding
        || capability.response_state === 'responding'
        || capability.response_state === 'generating'
      )
    );
    let canSendNow = !!(
      capability
      && (
        capability.can_send_now
        || capability.can_send_now
        || capability.can_accept_input
        || capability.can_accept_input
      )
    );

    if (!bridgeConnected) {
      return {
        text: '未连接',
        cls: 'cgpt-state-offline',
        title: '油猴桥接未连接或页面未注册到 Flask',
      };
    }

    if (domState && domState.cls === 'cgpt-state-generating') {
      isResponding = true;
    }

    if (isResponding) {
      return {
        text: '生成中',
        cls: 'cgpt-state-generating',
        title: 'ChatGPT 正在回答，暂时不建议发送新消息',
      };
    }

    if (resolveWaitingForReply()) {
      return {
        text: '等待中',
        cls: 'cgpt-state-waiting',
        title: '消息已发送，正在等待回复',
      };
    }

    if (canSendNow || (domState && domState.cls === 'cgpt-state-ready')) {
      return {
        text: '可输入',
        cls: 'cgpt-state-ready',
        title: '当前页面可以输入并发送消息',
      };
    }

    if (domState && domState.cls === 'cgpt-state-blocked') {
      return domState;
    }

    if (capability) {
      return {
        text: '不可发',
        cls: 'cgpt-state-blocked',
        title: '当前输入框或发送按钮不可用',
      };
    }

    return domState || {
      text: '未知',
      cls: 'cgpt-state-unknown',
      title: '无法判断当前页面输入状态',
    };
  }

  function updateChatInputStateBadge() {
    const badge = document.querySelector('#cgpt-page-input-state');
    if (!badge) {
      return;
    }

    const info = getChatInputState();

    badge.textContent = info.text;
    badge.title = info.title || info.text;

    badge.classList.remove(
      'cgpt-state-ready',
      'cgpt-state-waiting',
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

  async function waitComposerSendConfirmed(content, timeoutMs = 5000) {
    const startedAt = Date.now();
    const contentText = String(content || '').trim();
    const contentProbe = contentText.slice(0, 80);

    while (Date.now() - startedAt < timeoutMs) {
      if (ComposerApi.isAssistantLikelyBusy()) {
        const latestBusy = getLatestConversationMessageRecord({ preferAssistant: false });
        if (latestBusy && latestBusy.role === 'user') {
          const latestBusyText = String(latestBusy.text || '').trim();
          if (!contentText || (contentProbe && latestBusyText.includes(contentProbe))) {
            return { ok: true, reason: 'assistant_busy_user_visible' };
          }
        }
        return { ok: false, reason: 'assistant_busy' };
      }

      const latest = getLatestConversationMessageRecord({ preferAssistant: false });
      if (latest && latest.role === 'user') {
        const latestText = String(latest.text || '').trim();
        if (!contentText || (contentProbe && latestText.includes(contentProbe))) {
          return { ok: true, reason: 'latest_user_matches' };
        }
      }

      const composerText = ComposerApi.getComposerText();
      if (!composerText && !ComposerApi.canSendNow()) {
        return { ok: true, reason: 'composer_cleared' };
      }

      await sleep(250);
    }

    return { ok: false, reason: 'timeout' };
  }

  async function sendContentViaComposer(options = {}) {
    const source = String(options.source || 'unknown');
    const content = String(options.content || '').trim();
    const sendExistingComposer = options.sendExistingComposer === true;
    const allowReplaceDraft = options.allowReplaceDraft === true;
    const waitUntilSendable = options.waitUntilSendable !== false;
    const blockWhenResponding = options.blockWhenResponding !== false;
    const timeoutMs = Number(options.timeoutMs || 60000);

    logPageCapability(getPageCapability(`send:${source}`), '[SEND][CAPABILITY]');
    updateChatInputStateBadge();

    if (!sendExistingComposer && !content) {
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

      const okSet = ComposerApi.setComposerValue(content);
      if (!okSet) {
        return { ok: false, reason: 'composer_not_found', source };
      }

      await sleep(300);
    } else if (!ComposerApi.getComposerText()) {
      return { ok: false, reason: 'composer_empty', source };
    }

    const startedAt = Date.now();
    while (waitUntilSendable && !ComposerApi.canSendNow()) {
      if (Date.now() - startedAt >= timeoutMs) {
        return { ok: false, reason: 'send_button_wait_timeout', source };
      }
      await sleep(250);
    }

    if (!ComposerApi.canSendNow()) {
      return { ok: false, reason: 'send_button_unavailable', source };
    }

    const okClick = ComposerApi.clickSend();
    if (!okClick) {
      return { ok: false, reason: 'click_send_failed', source };
    }

    const confirmed = await waitComposerSendConfirmed(
      sendExistingComposer ? ComposerApi.getComposerText() : content,
      Number(options.confirmTimeoutMs || 5000),
    );

    if (!confirmed.ok) {
      updateChatInputStateBadge();
      return {
        ok: false,
        reason: `send_not_confirmed:${confirmed.reason}`,
        source,
      };
    }

    ChatInputStateRuntime.waitingForReply = true;
    updateChatInputStateBadge();
    return { ok: true, reason: confirmed.reason, source };
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
