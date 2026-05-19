// ==UserScript==
// @name         ChatGPT 客户端 - Flask 轮询联动
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  与本地 Flask 服务端双向交互：轮询消息、发送到 ChatGPT、回执确认、回传回复
// @author       You
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://*.chat.openai.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const BRIDGE_URL = 'http://127.0.0.1:5000/api/bridge';
    const SOURCE = 'tampermonkey';
    const CLIENT_ID = 'tm-' + Math.random().toString(36).slice(2, 10);
    const POLL_INTERVAL_MS = 1000;
    const SEND_BUTTON_WAIT_MS = 8000;
    const ASSISTANT_REPLY_WAIT_MS = 90000;
    const MAX_REPLY_LENGTH = 6000;

    let handlingMessageId = null;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                    client_id: CLIENT_ID,
                    page_url: location.href,
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
            console.error('[联动] report 失败:', event, error);
        });
    }

    function ack(messageId, success, detail) {
        return apiRequest({
            action: 'ack',
            message_id: messageId,
            success: success,
            detail: detail || ''
        });
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
            'div#prompt-textarea[contenteditable="true"]',
            'textarea#prompt-textarea',
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

    function getLatestAssistantText() {
        const selectors = [
            '[data-message-author-role="assistant"]',
            '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
        ];

        let nodes = [];

        for (const selector of selectors) {
            nodes = nodes.concat(Array.from(document.querySelectorAll(selector)));
        }

        nodes = nodes.filter(node => isVisible(node));

        if (!nodes.length) {
            return '';
        }

        const latest = nodes[nodes.length - 1];
        return (latest.innerText || '').trim();
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

    async function waitForAssistantReply(beforeText, timeoutMs) {
        const start = Date.now();
        let latestText = '';
        let lastChangedAt = Date.now();

        while (Date.now() - start < timeoutMs) {
            const currentText = getLatestAssistantText();

            if (currentText && currentText !== beforeText && currentText !== latestText) {
                latestText = currentText;
                lastChangedAt = Date.now();
            }

            if (latestText && !isGenerating() && Date.now() - lastChangedAt >= 1500) {
                return latestText;
            }

            await sleep(800);
        }

        return latestText;
    }

    async function sendToChatGPT(text) {
        const composer = findComposer();

        if (!composer) {
            return {
                ok: false,
                detail: '未找到 ChatGPT 输入框。可能页面未加载完成、未登录、弹窗遮挡，或者 ChatGPT DOM 已变化。'
            };
        }

        try {
            setComposerText(composer, text);
        } catch (error) {
            console.error('[联动] 写入输入框失败:', error);
            return {
                ok: false,
                detail: `写入输入框失败: ${error.message}`
            };
        }

        const sendButton = await waitForSendButton(SEND_BUTTON_WAIT_MS);

        if (sendButton) {
            sendButton.scrollIntoView({ block: 'center', inline: 'center' });
            sendButton.click();

            return {
                ok: true,
                detail: '已写入输入框并点击发送按钮'
            };
        }

        const form = composer.closest('form') || document.querySelector('main form') || document.querySelector('form');

        if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();

            return {
                ok: true,
                detail: '未找到显式发送按钮，已使用 form.requestSubmit() 提交'
            };
        }

        return {
            ok: false,
            detail: '已写入输入框，但未找到可用发送按钮。可能按钮选择器变化，或者输入框状态没有被 ChatGPT 前端接受。'
        };
    }

    async function handleOutboundMessage(result) {
        if (!result.has_message || !result.content) {
            return;
        }

        const messageId = result.message_id;

        if (handlingMessageId === messageId) {
            return;
        }

        handlingMessageId = messageId;

        if (result.retry) {
            console.log('[联动] 重试下发消息:', messageId);
        } else {
            console.log('[联动] 收到新消息:', messageId);
        }

        const beforeReply = getLatestAssistantText();
        const sendResult = await sendToChatGPT(result.content);

        try {
            await ack(messageId, sendResult.ok, sendResult.detail);
        } catch (error) {
            console.error('[联动] ack 回传失败:', error);
        } finally {
            if (handlingMessageId === messageId) {
                handlingMessageId = null;
            }
        }

        if (!sendResult.ok) {
            await report('send_failed', { detail: sendResult.detail }, messageId);
            return;
        }

        waitForAssistantReply(beforeReply, ASSISTANT_REPLY_WAIT_MS)
            .then(replyText => {
                if (!replyText) {
                    return report('assistant_reply_empty', {
                        detail: '已发送，但未读取到 ChatGPT 回复内容'
                    }, messageId);
                }

                let text = replyText;

                if (text.length > MAX_REPLY_LENGTH) {
                    text = text.slice(0, MAX_REPLY_LENGTH) + '\n\n[回复内容过长，已截断]';
                }

                return report('assistant_reply', {
                    text: text
                }, messageId);
            })
            .catch(error => {
                console.error('[联动] 读取 ChatGPT 回复失败:', error);
                return report('assistant_reply_failed', {
                    detail: error.message
                }, messageId);
            });
    }

    async function pollBridge() {
        try {
            const result = await apiRequest({ action: 'poll' });
            await handleOutboundMessage(result);
        } catch (error) {
            console.error('[联动] 连接服务端失败:', error);
        }
    }

    console.log('[联动] ChatGPT 油猴脚本已启动:', CLIENT_ID);

    pollBridge();
    setInterval(pollBridge, POLL_INTERVAL_MS);
})();