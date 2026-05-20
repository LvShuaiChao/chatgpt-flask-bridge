// ==UserScript==
// @name         ChatGPT 客户端 - Flask 轮询联动
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  与本地 Flask 服务端双向交互：轮询消息、发送到 ChatGPT、回执确认、回传回复
// @author       You
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://*.chat.openai.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        window.close
// @run-at       document-idle
// @noframes
// @exclude      https://chatgpt.com/backend-api/*
// @exclude      https://*.chatgpt.com/backend-api/*
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) {
        console.log('[联动] 跳过 iframe 内运行:', location.href);
        return;
    }
    const BRIDGE_URL = 'http://127.0.0.1:5000/api/bridge';
    const SOURCE = 'tampermonkey';
    const SCRIPT_VERSION = '2.0';
    const CLIENT_ID_KEY = 'tm_bridge_client_id';
    const PAGE_INSTANCE_ID = 'page-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const CLIENT_ID = (function () {
        try {
            const saved = sessionStorage.getItem(CLIENT_ID_KEY);
            if (saved) {
                return saved;
            }
            const created = 'tm-' + Math.random().toString(36).slice(2, 10);
            sessionStorage.setItem(CLIENT_ID_KEY, created);
            return created;
        } catch (error) {
            const tempId = 'tm-' + Math.random().toString(36).slice(2, 10);
            console.error('[联动] 无法使用 sessionStorage，使用临时 CLIENT_ID:', error);
            return tempId;
        }
    })();
    const POLL_INTERVAL_MS = 1000;
    const SEND_BUTTON_WAIT_MS = 8000;
    const ASSISTANT_REPLY_WAIT_MS = 90000;
    const MAX_REPLY_LENGTH = 6000;

    let handlingMessageId = null;
    let polling = false;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getBindRequestToken() {
        try {
            const url = new URL(location.href);
            const fromQuery = url.searchParams.get('xz_bind_token');
            if (fromQuery) {
                sessionStorage.setItem('xz_bind_token', fromQuery);
                return fromQuery;
            }
            const hash = String(location.hash || '');
            const match = hash.match(/xz_bind_token=([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                sessionStorage.setItem('xz_bind_token', match[1]);
                return match[1];
            }
            return sessionStorage.getItem('xz_bind_token') || '';
        } catch (error) {
            console.error('[联动] getBindRequestToken 失败:', error);
            return '';
        }
    }

    function getPageIdentity() {
        const url = new URL(location.href);
        const path = url.pathname || '';
        let pageType = 'unknown';
        let conversationId = '';
        const conversationMatch = path.match(/^\/c\/([^/?#]+)/);
        if (conversationMatch) {
            pageType = 'conversation';
            conversationId = conversationMatch[1];
        } else if (path === '/' || path === '') {
            pageType = 'home';
        } else if (path.startsWith('/backend-api/') || path.includes('/sentinel/')) {
            pageType = 'ignored';
        } else {
            pageType = 'other';
        }
        const bindToken = getBindRequestToken();
        return {
            client_id: CLIENT_ID,
            page_instance_id: PAGE_INSTANCE_ID,
            script_version: SCRIPT_VERSION,
            page_url: location.href,
            page_title: document.title || '',
            page_type: pageType,
            conversation_id: conversationId,
            bind_request_id: bindToken,
            launch_token: bindToken,
            is_top_frame: window.top === window.self,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            pathname: location.pathname,
            last_seen: Date.now() / 1000
        };
    }

    function apiRequest(body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: BRIDGE_URL,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Source': SOURCE
                },
                data: JSON.stringify({
                    ...getPageIdentity(),
                    ...body
                }),
                onload: function (response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}: ${response.responseText || ''}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(new Error(`响应解析失败: ${response.responseText || ''}`));
                    }
                },
                onerror: function (error) {
                    reject(error);
                }
            });
        });
    }

    function report(event, payload, messageId) {
        return apiRequest({
            action: 'report',
            event: event,
            payload: payload || {},
            message_id: messageId || null
        }).catch(error => {
            tmError('[TM][REPORT][ERROR]', error, {
                event: event,
                message_id: messageId || ''
            });
        });
    }

    function clientLog(level, message, extra) {
        const payload = {
            level: level || 'info',
            message: String(message || ''),
            extra: extra || {},
            page_url: location.href,
            client_id: CLIENT_ID,
            page_instance_id: PAGE_INSTANCE_ID,
            script_version: SCRIPT_VERSION
        };

        if (level === 'error') {
            console.error('[联动]', message, extra || {});
        } else if (level === 'warn') {
            console.warn('[联动]', message, extra || {});
        } else {
            console.log('[联动]', message, extra || {});
        }

        return report('client_log', payload, null);
    }

    function tmLog(tag, fields) {
        return clientLog('info', tag, fields || {});
    }

    function tmError(tag, error, fields) {
        const extra = Object.assign({}, fields || {});
        if (error) {
            extra.error_type = error.name || 'Error';
            extra.error_message = error.message || String(error);
            extra.stack = error.stack || '';
        }
        return clientLog('error', tag, extra);
    }

    function textHash(text) {
        const value = String(text || '');
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = ((hash << 5) - hash) + value.charCodeAt(i);
            hash |= 0;
        }
        return (hash >>> 0).toString(16);
    }

    function textPreview(text, maxLen) {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value.length <= maxLen) {
            return value;
        }
        return value.slice(0, maxLen) + '…';
    }

    function getBusyReason() {
        if (isGenerating()) {
            return 'stop_button_visible';
        }
        if (isThinking()) {
            return 'thinking_indicator';
        }
        return '';
    }

    function getComposerTextLen(composer) {
        if (!composer) {
            return 0;
        }
        const tagName = composer.tagName.toLowerCase();
        if (tagName === 'textarea' || tagName === 'input') {
            return String(composer.value || '').length;
        }
        if (composer.isContentEditable) {
            return String(composer.textContent || '').length;
        }
        return 0;
    }

    function ack(messageId, success, detail) {
        return apiRequest({
            action: 'ack',
            message_id: messageId,
            success: success,
            detail: detail || ''
        });
    }

    function openUrlInNewTab(url, active = true) {
        try {
            const parsed = new URL(url);

            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return {
                    ok: false,
                    detail: `不允许打开非 http/https 地址: ${url}`
                };
            }

            if (typeof GM_openInTab === 'function') {
                GM_openInTab(parsed.href, {
                    active: active,
                    insert: true,
                    setParent: true
                });

                return {
                    ok: true,
                    detail: `已通过 GM_openInTab 打开: ${parsed.href}`
                };
            }

            const win = window.open(parsed.href, '_blank', 'noopener,noreferrer');

            if (!win) {
                return {
                    ok: false,
                    detail: 'window.open 被浏览器拦截'
                };
            }

            return {
                ok: true,
                detail: `已通过 window.open 打开: ${parsed.href}`
            };
        } catch (error) {
            console.error('[联动] 打开网页失败:', error);
            clientLog('error', '打开网页失败', { error: error.message, url });
            return {
                ok: false,
                detail: `打开网页失败: ${error.message}`
            };
        }
    }

    async function closeCurrentPageCommand(messageId) {
        clientLog('info', '执行命令 close_self', {
            message_id: messageId,
            page_url: location.href
        });
        try {
            await ack(messageId, true, '已收到关闭当前页面命令');
        } catch (error) {
            console.error('[联动] close_self ack 失败:', messageId, error);
        }

        await report('close_page_requested', {
            detail: '已收到关闭命令，准备关闭当前页面',
            page_url: location.href
        }, messageId);

        setTimeout(() => {
            try {
                window.open('', '_self');
                window.close();
            } catch (error) {
                console.error('[联动] window.close 执行异常:', error);
                clientLog('error', 'window.close 执行异常', {
                    error: error.message,
                    message_id: messageId
                });
                report('close_page_failed', {
                    detail: `window.close 执行异常: ${error.message}`,
                    page_url: location.href
                }, messageId);
                return;
            }

            setTimeout(() => {
                report('close_page_still_open', {
                    detail: 'window.close 已执行，但页面仍在运行，浏览器可能拦截了关闭操作',
                    page_url: location.href
                }, messageId);
            }, 1500);
        }, 200);
    }

    async function reloadCurrentPageCommand(messageId) {
        clientLog('info', '执行命令 reload_self', {
            message_id: messageId,
            page_url: location.href
        });
        try {
            await ack(messageId, true, '已收到刷新当前页面命令');
        } catch (error) {
            console.error('[联动] reload_self ack 失败:', messageId, error);
        }

        await report('reload_page_requested', {
            detail: '已收到刷新命令，准备刷新当前页面',
            page_url: location.href
        }, messageId);

        setTimeout(() => {
            location.reload();
        }, 200);
    }

    function flashBoundPage(payload) {
        const durationMs = Number(payload.duration_ms || 3500);
        const blinkCount = Number(payload.blink_count || 6);
        const title = String(payload.title || 'GUI 已定位此页面');
        let message = String(payload.message || '当前页面已绑定到当前 GUI 对话。');
        const payloadClientId = String(payload.client_id || CLIENT_ID || '').trim();
        const payloadConversationId = String(payload.conversation_id || '').trim();
        const identity = getPageIdentity();
        const conversationId = payloadConversationId
            || identity.conversation_id
            || '';
        if (!payload.message && payloadClientId) {
            let convShort = conversationId;
            if (convShort.length > 16) {
                convShort = `${convShort.slice(0, 16)}…`;
            }
            message = [
                '当前页面已绑定到 GUI 对话',
                `client=${payloadClientId}`,
                `conversation=${convShort || '-'}`
            ].join('\n');
        }

        const oldTitle = document.title;

        const overlay = document.createElement('div');
        overlay.id = '__gui_bound_page_flash_overlay__';
        overlay.textContent = message;
        overlay.style.position = 'fixed';
        overlay.style.zIndex = '2147483647';
        overlay.style.left = '50%';
        overlay.style.top = '24px';
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.padding = '14px 22px';
        overlay.style.borderRadius = '12px';
        overlay.style.background = 'rgba(220, 38, 38, 0.95)';
        overlay.style.color = '#fff';
        overlay.style.fontSize = '16px';
        overlay.style.fontWeight = '700';
        overlay.style.boxShadow = '0 8px 28px rgba(0,0,0,0.28)';
        overlay.style.pointerEvents = 'none';
        overlay.style.whiteSpace = 'pre-line';
        overlay.style.textAlign = 'center';
        overlay.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

        const border = document.createElement('div');
        border.id = '__gui_bound_page_flash_border__';
        border.style.position = 'fixed';
        border.style.zIndex = '2147483646';
        border.style.left = '0';
        border.style.top = '0';
        border.style.right = '0';
        border.style.bottom = '0';
        border.style.border = '8px solid rgba(220, 38, 38, 0.95)';
        border.style.boxSizing = 'border-box';
        border.style.pointerEvents = 'none';

        const oldOverlay = document.getElementById('__gui_bound_page_flash_overlay__');
        if (oldOverlay) {
            oldOverlay.remove();
        }

        const oldBorder = document.getElementById('__gui_bound_page_flash_border__');
        if (oldBorder) {
            oldBorder.remove();
        }

        document.documentElement.appendChild(border);
        document.documentElement.appendChild(overlay);

        if (
            typeof Notification !== 'undefined'
            && Notification.permission === 'granted'
        ) {
            try {
                new Notification(title, { body: message.replace(/\n/g, ' ') });
            } catch (error) {
                clientLog('warn', '[TM][CONTROL][FLASH_PAGE] 浏览器通知失败', {
                    error_message: error.message || String(error)
                });
            }
        }

        let count = 0;
        const intervalMs = Math.max(
            180,
            Math.floor(durationMs / Math.max(1, blinkCount * 2))
        );
        const timer = window.setInterval(() => {
            count += 1;
            const visible = count % 2 === 0;
            border.style.display = visible ? 'block' : 'none';
            overlay.style.display = visible ? 'block' : 'none';
            document.title = visible ? `>>> ${title} <<<` : oldTitle;

            if (count >= blinkCount * 2) {
                window.clearInterval(timer);
                border.remove();
                overlay.remove();
                document.title = oldTitle;
            }
        }, intervalMs);
    }

    async function handleCommandMessage(result) {
        const messageId = result.message_id || result.id;

        if (result.command === 'flash_page') {
            const payload = result.payload || {};
            await tmLog('[TM][CONTROL][FLASH_PAGE]', {
                message_id: messageId,
                client_id: CLIENT_ID,
                page_instance_id: PAGE_INSTANCE_ID,
                conversation_id: getPageIdentity().conversation_id || ''
            });
            try {
                await ack(messageId, true, '收到 flash_page 命令');
            } catch (error) {
                await tmError('[TM][CONTROL][FLASH_PAGE][ACK_ERROR]', error, {
                    message_id: messageId
                });
            }
            flashBoundPage(payload);
            await tmLog('[TM][CONTROL][FLASH_PAGE][DONE]', {
                message_id: messageId,
                page_url: location.href
            });
            await report('control_done', {
                command: 'flash_page',
                detail: '页面已闪烁定位'
            }, messageId);
            return true;
        }

        if (result.command === 'reload_self') {
            await reloadCurrentPageCommand(messageId);
            return true;
        }

        if (result.command === 'close_self') {
            await closeCurrentPageCommand(messageId);
            return true;
        }

        if (result.command === 'open_url') {
            clientLog('info', '执行命令 open_url', {
                url: result.url,
                message_id: result.message_id || result.id
            });
            const openResult = openUrlInNewTab(result.url, result.active !== false);

            try {
                await ack(result.message_id, openResult.ok, openResult.detail);
            } catch (error) {
                console.error('[联动] open_url ack 失败:', result.message_id, error);
            }

            await report(
                openResult.ok ? 'open_url_success' : 'open_url_failed',
                {
                    url: result.url,
                    detail: openResult.detail
                },
                result.message_id
            );

            return true;
        }

        return false;
    }

    function isVisible(element) {
        if (!element) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
        );
    }

    function findComposer() {
        const selectors = [
            '#prompt-textarea',
            'motion.div#prompt-textarea',
            'motion.div#prompt-textarea[contenteditable="true"]',
            'div#prompt-textarea[contenteditable="true"]',
            'textarea#prompt-textarea',
            'motion.div.ProseMirror[contenteditable="true"]',
            'motion.div.ProseMirror',
            'div.ProseMirror[contenteditable="true"]',
            '[contenteditable="true"][data-lexical-editor="true"]',
            'main form [contenteditable="true"]',
            'form textarea'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && isVisible(element)) {
                return element;
            }
        }
        return null;
    }

    function setNativeValue(element, value) {
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'textarea') {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            if (setter) {
                setter.call(element, value);
            } else {
                element.value = value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        if (tagName === 'input') {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            if (setter) {
                setter.call(element, value);
            } else {
                element.value = value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        throw new Error(`不支持的输入控件类型: ${tagName}`);
    }

    function setContentEditableText(element, text) {
        element.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        const inserted = document.execCommand('insertText', false, text);
        if (!inserted) {
            element.textContent = text;
        }
        element.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text
        }));
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text
        }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setComposerText(element, text) {
        if (!element) {
            throw new Error('输入框不存在');
        }
        element.focus();
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'textarea' || tagName === 'input') {
            setNativeValue(element, text);
            return;
        }
        if (element.isContentEditable) {
            setContentEditableText(element, text);
            return;
        }
        throw new Error(`输入框不是 textarea/input/contenteditable: ${tagName}`);
    }

    function findSendButton() {
        const selectors = [
            'button[data-testid="send-button"]',
            'button[data-testid="composer-submit-button"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label="Send message"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="发送"]',
            'main form button[type="submit"]',
            'form button[type="submit"]'
        ];
        for (const selector of selectors) {
            const buttons = Array.from(document.querySelectorAll(selector));
            for (const button of buttons) {
                const disabled =
                    button.disabled ||
                    button.getAttribute('aria-disabled') === 'true';
                if (isVisible(button) && !disabled) {
                    return button;
                }
            }
        }
        return null;
    }

    async function waitForSendButton(timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const button = findSendButton();
            if (button) {
                return button;
            }
            await sleep(200);
        }
        return null;
    }

    function getAssistantMessageNodes() {
        const selectors = [
            '[data-message-author-role="assistant"]',
            '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]',
            'article[data-turn="assistant"]',
            'motion.div[data-turn="assistant"]',
            'div[data-turn="assistant"]'
        ];
        const seen = new Set();
        const nodes = [];
        for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) {
                if (!seen.has(node) && isVisible(node)) {
                    seen.add(node);
                    nodes.push(node);
                }
            }
        }
        return nodes;
    }

    function countAssistantMessages() {
        return getAssistantMessageNodes().length;
    }

    function getAssistantTextAtIndex(index) {
        const nodes = getAssistantMessageNodes();
        if (index < 0 || index >= nodes.length) {
            return '';
        }
        return (nodes[index].innerText || '').trim();
    }

    function getNewAssistantText(beforeCount, beforeText) {
        const nodes = getAssistantMessageNodes();
        if (nodes.length > beforeCount) {
            return getAssistantTextAtIndex(nodes.length - 1);
        }
        const latest = nodes.length ? getAssistantTextAtIndex(nodes.length - 1) : '';
        if (latest && latest !== beforeText) {
            return latest;
        }
        return '';
    }

    function isGenerating() {
        const selectors = [
            'button[data-testid="stop-button"]',
            'button[aria-label*="Stop"]',
            'button[aria-label*="停止"]'
        ];
        return selectors.some(selector => {
            const button = document.querySelector(selector);
            return button && isVisible(button);
        });
    }

    function isThinking() {
        const count = countAssistantMessages();
        if (count <= 0) {
            return false;
        }
        const latest = getAssistantTextAtIndex(count - 1);
        if (isStableReply(latest)) {
            return false;
        }
        const nodes = getAssistantMessageNodes();
        const lastNode = nodes[nodes.length - 1];
        if (lastNode) {
            const indicator = lastNode.querySelector('[data-testid="thinking-indicator"]');
            if (indicator && isVisible(indicator)) {
                return true;
            }
        }
        return isReplyPlaceholder(latest);
    }

    function isReplyPlaceholder(text) {
        const value = (text || '').trim();
        if (!value) {
            return true;
        }
        const patterns = [
            /^thinking\.?\.?\.?$/i,
            /^analyzing\.?\.?\.?$/i,
            /^正在思考/,
            /^思考中/,
            /^生成中/,
            /^waiting\.?\.?\.?$/i
        ];
        return patterns.some(pattern => pattern.test(value));
    }

    function isBusyGenerating() {
        return isGenerating() || isThinking();
    }

    function isStableReply(text) {
        const value = (text || '').trim();
        return value.length > 0 && !isReplyPlaceholder(value);
    }

    async function waitForAssistantReply(beforeText, beforeCount, messageId, timeoutMs) {
        const start = Date.now();
        const identity = getPageIdentity();
        let latestText = '';
        let lastChangedAt = 0;
        let lastLoggedHash = '';
        let stableWhileBusyAt = 0;
        let lastLoopLogAt = 0;
        let lastLoopState = '';
        const stableMs = 1500;
        const busyStableGraceMs = 3000;
        const beforeTextLen = (beforeText || '').length;

        await tmLog('[TM][WAIT_REPLY][START]', {
            message_id: messageId,
            before_assistant_count: beforeCount,
            before_text_len: beforeTextLen,
            timeout_ms: timeoutMs,
            url: identity.page_url,
            conversation_id: identity.conversation_id || ''
        });

        while (Date.now() - start < timeoutMs) {
            const elapsedMs = Date.now() - start;
            const assistantCount = countAssistantMessages();
            const candidate = getNewAssistantText(beforeCount, beforeText);
            const busy = isBusyGenerating();
            const busyReason = getBusyReason();

            if (isStableReply(candidate)) {
                if (candidate !== latestText) {
                    const oldLen = latestText.length;
                    const oldHash = latestText ? textHash(latestText) : '';
                    latestText = candidate;
                    lastChangedAt = Date.now();
                    stableWhileBusyAt = 0;
                    const newHash = textHash(latestText);
                    if (newHash !== lastLoggedHash) {
                        lastLoggedHash = newHash;
                        await tmLog('[TM][WAIT_REPLY][CANDIDATE]', {
                            message_id: messageId,
                            text_len: latestText.length,
                            text_hash: newHash,
                            preview: textPreview(latestText, 80)
                        });
                    }
                    if (oldHash && oldHash !== newHash) {
                        await tmLog('[TM][WAIT_REPLY][TEXT_CHANGED]', {
                            message_id: messageId,
                            old_len: oldLen,
                            new_len: latestText.length,
                            old_hash: oldHash,
                            new_hash: newHash
                        });
                    }
                }
            }

            const stableDuration =
                latestText && lastChangedAt ? Date.now() - lastChangedAt : 0;
            const loopState = [
                assistantCount,
                latestText.length,
                textHash(latestText),
                stableDuration,
                busy,
                busyReason
            ].join('|');
            if (elapsedMs - lastLoopLogAt >= 1000 || loopState !== lastLoopState) {
                lastLoopLogAt = elapsedMs;
                lastLoopState = loopState;
                await tmLog('[TM][WAIT_REPLY][LOOP]', {
                    message_id: messageId,
                    elapsed_ms: elapsedMs,
                    assistant_count: assistantCount,
                    latest_text_len: latestText.length,
                    latest_text_hash: latestText ? textHash(latestText) : '',
                    stable_ms: stableDuration,
                    busy: busy,
                    busy_reason: busyReason || ''
                });
            }

            if (isStableReply(latestText) && stableDuration >= stableMs) {
                if (!busy) {
                    await tmLog('[TM][WAIT_REPLY][STABLE_RETURN]', {
                        message_id: messageId,
                        reply_len: latestText.length,
                        stable_ms: stableDuration,
                        busy: false,
                        busy_reason: ''
                    });
                    return latestText;
                }
                if (!stableWhileBusyAt) {
                    stableWhileBusyAt = Date.now();
                }
                if (Date.now() - stableWhileBusyAt >= busyStableGraceMs) {
                    await tmLog('[TM][WAIT_REPLY][STABLE_RETURN]', {
                        message_id: messageId,
                        reply_len: latestText.length,
                        stable_ms: stableDuration,
                        busy: true,
                        busy_reason: busyReason || 'busy'
                    });
                    return latestText;
                }
            } else {
                stableWhileBusyAt = 0;
            }

            await sleep(400);
        }

        const elapsedMs = Date.now() - start;
        const busy = isBusyGenerating();
        const busyReason = getBusyReason();
        const assistantCount = countAssistantMessages();
        await tmLog('[TM][WAIT_REPLY][TIMEOUT]', {
            message_id: messageId,
            elapsed_ms: elapsedMs,
            busy: busy,
            busy_reason: busyReason || '',
            latest_text_len: latestText.length,
            latest_text_hash: latestText ? textHash(latestText) : '',
            assistant_count: assistantCount
        });
        if (isStableReply(latestText)) {
            await tmLog('[TM][WAIT_REPLY][STABLE_RETURN]', {
                message_id: messageId,
                reply_len: latestText.length,
                stable_ms: 0,
                busy: busy,
                busy_reason: busyReason || 'timeout_with_text'
            });
            return latestText;
        }
        return '';
    }

    async function reportAssistantReplyFailed(messageId, reason, extra) {
        const fields = Object.assign(
            {
                reason: reason || 'unknown',
                busy: isBusyGenerating(),
                busy_reason: getBusyReason() || '',
                latest_text_len: 0,
                elapsed_ms: 0
            },
            extra || {}
        );
        await report('assistant_reply_failed', fields, messageId);
    }

    async function waitForConversationCreated(messageId, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const identity = getPageIdentity();
            if (
                identity.page_type === 'conversation'
                && identity.conversation_id
            ) {
                await tmLog('[TM][BOOTSTRAP][CONVERSATION_CREATED]', {
                    message_id: messageId,
                    conversation_id: identity.conversation_id,
                    url: identity.page_url,
                    elapsed_ms: Date.now() - start
                });
                return identity;
            }
            await sleep(400);
        }
        return null;
    }

    async function sendToChatGPT(text, context) {
        const messageId = (context && context.message_id) || '';
        const identity = getPageIdentity();
        const assistantCountBefore = countAssistantMessages();
        const latestBefore = assistantCountBefore > 0
            ? getAssistantTextAtIndex(assistantCountBefore - 1)
            : '';
        const composer = findComposer();
        const probeButton = findSendButton();

        await tmLog('[TM][SEND][BEFORE]', {
            message_id: messageId,
            input_found: Boolean(composer),
            send_button_found: Boolean(probeButton),
            send_button_disabled: probeButton
                ? Boolean(probeButton.disabled || probeButton.getAttribute('aria-disabled') === 'true')
                : false,
            assistant_count_before: assistantCountBefore,
            latest_assistant_text_len_before: latestBefore.length
        });

        if (!composer) {
            return {
                ok: false,
                detail: '未找到 ChatGPT 输入框。可能页面未加载完成、未登录、弹窗遮挡，或者 ChatGPT DOM 已变化。',
                input_found: false,
                send_button_found: Boolean(probeButton)
            };
        }

        let inputWriteSuccess = false;
        try {
            setComposerText(composer, text);
            inputWriteSuccess = getComposerTextLen(composer) > 0;
        } catch (error) {
            await tmError('[TM][SEND][ERROR]', error, {
                message_id: messageId,
                stage: 'set_composer_text'
            });
            return {
                ok: false,
                detail: `写入输入框失败: ${error.message}`,
                input_found: true,
                input_write_success: false
            };
        }

        await tmLog('[TM][SEND][AFTER_INPUT]', {
            message_id: messageId,
            input_text_len: getComposerTextLen(composer),
            input_write_success: inputWriteSuccess
        });

        const sendButton = await waitForSendButton(SEND_BUTTON_WAIT_MS);
        let clickSuccess = false;
        let detail = '';

        if (sendButton) {
            try {
                sendButton.scrollIntoView({ block: 'center', inline: 'center' });
                sendButton.click();
                clickSuccess = true;
                detail = '已写入输入框并点击发送按钮';
            } catch (error) {
                await tmError('[TM][SEND][ERROR]', error, {
                    message_id: messageId,
                    stage: 'click_send_button'
                });
                detail = `点击发送按钮失败: ${error.message}`;
            }
        } else {
            const form = composer.closest('form')
                || document.querySelector('main form')
                || document.querySelector('form');
            if (form && typeof form.requestSubmit === 'function') {
                try {
                    form.requestSubmit();
                    clickSuccess = true;
                    detail = '未找到显式发送按钮，已使用 form.requestSubmit() 提交';
                } catch (error) {
                    await tmError('[TM][SEND][ERROR]', error, {
                        message_id: messageId,
                        stage: 'form_request_submit'
                    });
                    detail = `form.requestSubmit 失败: ${error.message}`;
                }
            } else {
                detail = '已写入输入框，但未找到可用发送按钮。可能按钮选择器变化，或者输入框状态没有被 ChatGPT 前端接受。';
            }
        }

        await tmLog('[TM][SEND][CLICK]', {
            message_id: messageId,
            click_success: clickSuccess,
            detail: detail,
            url: identity.page_url,
            conversation_id: identity.conversation_id || ''
        });

        return {
            ok: clickSuccess,
            detail: detail,
            input_found: true,
            input_write_success: inputWriteSuccess,
            click_success: clickSuccess
        };
    }

    async function handleOutboundMessage(result) {
        if (!result.has_message) {
            return;
        }
        const messageId = result.message_id;
        if (result.type === 'command') {
            if (!messageId) {
                console.error('[联动] 命令消息缺少 message_id');
                return;
            }
            if (handlingMessageId && handlingMessageId !== messageId) {
                console.log(
                    '[联动] 跳过命令，当前正在处理:',
                    handlingMessageId,
                    '新命令:',
                    messageId
                );
                return;
            }
            if (handlingMessageId === messageId && !result.retry) {
                return;
            }
            handlingMessageId = messageId;
            console.log('[联动] claim command message_id=', messageId, 'command=', result.command);
            try {
                const handled = await handleCommandMessage(result);
                if (!handled) {
                    console.error('[联动] 未知命令:', result.command);
                    try {
                        await ack(messageId, false, `未知命令: ${result.command || '-'}`);
                    } catch (error) {
                        console.error('[联动] 未知命令 ack 失败:', messageId, error);
                    }
                    await report('command_failed', {
                        detail: `未知命令: ${result.command || '-'}`
                    }, messageId);
                }
            } finally {
                if (handlingMessageId === messageId) {
                    handlingMessageId = null;
                }
            }
            return;
        }
        if (!result.content) {
            return;
        }
        if (!messageId) {
            console.error('[联动] 服务端未返回 message_id');
            return;
        }
        if (handlingMessageId && handlingMessageId !== messageId) {
            console.log(
                '[联动] 跳过消息，当前正在处理:',
                handlingMessageId,
                '新消息:',
                messageId
            );
            return;
        }
        if (handlingMessageId === messageId && !result.retry) {
            return;
        }
        const identity = getPageIdentity();
        if (result.target_client_id && result.target_client_id !== CLIENT_ID) {
            await ack(messageId, false, 'target_client_id 不匹配');
            await report('send_failed', {
                reason: 'target_client_id_mismatch',
                target_client_id: result.target_client_id,
                current_client_id: CLIENT_ID
            }, messageId);
            return;
        }
        const isBootstrap = Boolean(result.bootstrap_conversation);
        if (isBootstrap) {
            if (identity.page_type !== 'home') {
                await ack(messageId, false, 'bootstrap 消息要求当前为 ChatGPT 首页');
                await report('send_failed', {
                    reason: 'not_home_page',
                    page_type: identity.page_type,
                    page_url: location.href
                }, messageId);
                return;
            }
            if (identity.conversation_id) {
                await ack(messageId, false, '首页不应已有 conversation_id');
                await report('send_failed', {
                    reason: 'home_already_has_conversation',
                    conversation_id: identity.conversation_id,
                    page_url: location.href
                }, messageId);
                return;
            }
            if (
                result.target_page_instance_id
                && result.target_page_instance_id !== PAGE_INSTANCE_ID
            ) {
                await ack(messageId, false, 'target_page_instance_id 不匹配');
                await report('send_failed', {
                    reason: 'target_page_instance_id_mismatch',
                    target_page_instance_id: result.target_page_instance_id,
                    current_page_instance_id: PAGE_INSTANCE_ID
                }, messageId);
                return;
            }
            const msgBindToken = String(
                result.bind_request_id || result.launch_token || ''
            ).trim();
            if (msgBindToken) {
                const pageToken = getBindRequestToken();
                if (!pageToken || pageToken !== msgBindToken) {
                    await ack(messageId, false, 'bind_request_id 不匹配');
                    await report('send_failed', {
                        reason: 'bind_request_id_mismatch',
                        bind_request_id: msgBindToken,
                        current_bind_request_id: pageToken || '',
                        page_instance_id: PAGE_INSTANCE_ID
                    }, messageId);
                    return;
                }
            }
        } else {
            if (result.target_page_url) {
                const target = String(result.target_page_url).trim().split('#')[0];
                const current = location.href.split('#')[0];
                if (target && current !== target) {
                    await ack(messageId, false, 'target_page_url 与当前页面不一致');
                    await report('send_failed', {
                        reason: 'target_page_url_mismatch',
                        target_page_url: result.target_page_url,
                        current_page_url: location.href
                    }, messageId);
                    return;
                }
            }
            if (identity.page_type !== 'conversation') {
                await ack(messageId, false, '当前页面不是 ChatGPT 对话页');
                await report('send_failed', {
                    reason: 'not_conversation_page',
                    page_type: identity.page_type,
                    page_url: location.href
                }, messageId);
                return;
            }
            if (
                result.conversation_id
                && result.conversation_id !== identity.conversation_id
            ) {
                await ack(messageId, false, 'conversation_id 不匹配');
                await report('send_failed', {
                    reason: 'conversation_id_mismatch',
                    target_conversation_id: result.conversation_id,
                    current_conversation_id: identity.conversation_id,
                    page_url: location.href
                }, messageId);
                return;
            }
        }
        handlingMessageId = messageId;
        const waitStartAt = Date.now();
        let finalReported = false;

        if (result.retry) {
            console.log('[联动] claim retry message_id=', messageId);
        } else {
            console.log('[联动] claim message_id=', messageId);
        }

        await tmLog('[TM][SEND][START]', {
            message_id: messageId,
            client_id: CLIENT_ID,
            conversation_id: identity.conversation_id || '',
            url: identity.page_url,
            text_len: String(result.content || '').length
        });

        const beforeCount = countAssistantMessages();
        const beforeReply = beforeCount > 0
            ? getAssistantTextAtIndex(beforeCount - 1)
            : '';

        let sendResult;
        try {
            sendResult = await sendToChatGPT(result.content, { message_id: messageId });
        } catch (error) {
            await tmError('[TM][SEND][ERROR]', error, {
                message_id: messageId,
                stage: 'send_to_chatgpt'
            });
            sendResult = {
                ok: false,
                detail: error.message || String(error)
            };
        }

        console.log('[联动] send result message_id=', messageId, 'ok=', sendResult.ok);
        let ackSuccess = false;
        let ackDetail = sendResult.detail || '';
        try {
            await ack(messageId, sendResult.ok, ackDetail);
            ackSuccess = sendResult.ok;
        } catch (error) {
            await tmError('[TM][SEND][ERROR]', error, {
                message_id: messageId,
                stage: 'ack'
            });
            ackDetail = error.message || String(error);
            ackSuccess = false;
        }

        await tmLog('[TM][SEND][ACK]', {
            message_id: messageId,
            success: ackSuccess,
            detail: ackDetail || '-'
        });

        try {
            if (!sendResult.ok) {
                await tmError('[TM][SEND][ERROR]', new Error(sendResult.detail || 'send failed'), {
                    message_id: messageId,
                    stage: 'send_failed'
                });
                await report('send_failed', { detail: sendResult.detail }, messageId);
                finalReported = true;
                return;
            }

            if (isBootstrap) {
                const createdIdentity = await waitForConversationCreated(
                    messageId,
                    ASSISTANT_REPLY_WAIT_MS
                );
                if (createdIdentity) {
                    const bindToken = getBindRequestToken();
                    await report('conversation_created', {
                        message_id: messageId,
                        old_page_type: 'home',
                        new_page_type: 'conversation',
                        conversation_id: createdIdentity.conversation_id,
                        url: createdIdentity.page_url,
                        client_id: CLIENT_ID,
                        page_instance_id: PAGE_INSTANCE_ID,
                        bind_request_id: bindToken,
                        launch_token: bindToken
                    }, messageId);
                } else {
                    await report('send_failed', {
                        reason: 'conversation_created_timeout',
                        detail: '首条消息已发送，但未检测到跳转到对话页 /c/xxx'
                    }, messageId);
                    finalReported = true;
                    return;
                }
            }

            let replyText = '';
            try {
                replyText = await waitForAssistantReply(
                    beforeReply,
                    beforeCount,
                    messageId,
                    ASSISTANT_REPLY_WAIT_MS
                );
            } catch (error) {
                await tmError('[TM][WAIT_REPLY][ERROR]', error, {
                    message_id: messageId,
                    elapsed_ms: Date.now() - waitStartAt
                });
                await reportAssistantReplyFailed(
                    messageId,
                    error.message || String(error),
                    {
                        error_type: error.name || 'Error',
                        error_message: error.message || String(error),
                        stack: error.stack || '',
                        elapsed_ms: Date.now() - waitStartAt
                    }
                );
                finalReported = true;
                return;
            }

            const elapsedMs = Date.now() - waitStartAt;
            if (!replyText) {
                const busy = isBusyGenerating();
                const reason = busy
                    ? '等待超时：页面仍被判断为生成中，未能稳定读取 ChatGPT 回复。'
                    : '已发送，但未读取到 ChatGPT 回复内容。';
                await reportAssistantReplyFailed(messageId, reason, {
                    elapsed_ms: elapsedMs,
                    latest_text_len: 0
                });
                finalReported = true;
                return;
            }

            let text = replyText;
            if (text.length > MAX_REPLY_LENGTH) {
                text = text.slice(0, MAX_REPLY_LENGTH) + '\n\n[回复内容过长，已截断]';
            }
            await report('assistant_reply', { text: text }, messageId);
            finalReported = true;
        } catch (error) {
            await tmError('[TM][SEND][ERROR]', error, {
                message_id: messageId,
                stage: 'handle_outbound_message'
            });
            if (!finalReported) {
                await reportAssistantReplyFailed(
                    messageId,
                    error.message || String(error),
                    {
                        error_type: error.name || 'Error',
                        error_message: error.message || String(error),
                        stack: error.stack || '',
                        elapsed_ms: Date.now() - waitStartAt
                    }
                );
                finalReported = true;
            }
        } finally {
            if (!finalReported && sendResult && sendResult.ok) {
                reportAssistantReplyFailed(
                    messageId,
                    '未收到 assistant_reply 最终状态（兜底）',
                    { elapsed_ms: Date.now() - waitStartAt }
                ).catch(error => {
                    tmError('[TM][SEND][ERROR]', error, {
                        message_id: messageId,
                        stage: 'final_report_fallback'
                    });
                });
            }
            if (handlingMessageId === messageId) {
                handlingMessageId = null;
            }
        }
    }

    async function pollBridge() {
        if (polling) {
            return;
        }
        if (handlingMessageId) {
            return;
        }
        polling = true;
        console.log('[联动] poll start CLIENT_ID=', CLIENT_ID);
        try {
            const result = await apiRequest({ action: 'poll' });
            await handleOutboundMessage(result);
        } catch (error) {
            console.error('[联动] 连接服务端失败:', error);
            clientLog('error', '连接服务端失败', { error: error.message });
        } finally {
            polling = false;
            console.log('[联动] poll end CLIENT_ID=', CLIENT_ID);
        }
    }

    let lastIdentityKey = '';

    function identityKey(identity) {
        return [
            identity.page_type || '',
            identity.conversation_id || '',
            identity.page_url || ''
        ].join('|');
    }

    function checkPageIdentityChange() {
        const identity = getPageIdentity();
        const key = identityKey(identity);
        if (key === lastIdentityKey) {
            return;
        }
        if (lastIdentityKey) {
            clientLog('info', '页面身份变化', identity);
        }
        lastIdentityKey = key;
    }

    const identity = getPageIdentity();
    lastIdentityKey = identityKey(identity);
    clientLog('info', '油猴脚本已启动', identity);
    pollBridge();
    setInterval(() => {
        checkPageIdentityChange();
        pollBridge();
    }, POLL_INTERVAL_MS);
})();
