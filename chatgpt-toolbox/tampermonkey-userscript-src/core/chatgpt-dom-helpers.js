function isInsideToolbox(el) {
  if (!el) return false;
  return !!(
    el.closest('#cgpt-toolbox-root')
    || el.closest('[id^="cgpt-"]')
    || el.closest('[class*="cgpt-toolbox"]')
    || (typeof isInToolbox === 'function' && isInToolbox(el))
  );
}

function isChatGPTHomeNewChatPage() {
  const pathname = String(location.pathname || '').trim();
  return pathname === '/' || pathname === '';
}

const CHATGPT_STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[data-testid="composer-stop-button"]',
  'button[aria-label="停止生成"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Stop generating"]',
];

function isVisibleChatGPTStopButton(btn) {
  if (!btn || isInsideToolbox(btn)) {
    return false;
  }

  const rect = btn.getBoundingClientRect();
  const style = window.getComputedStyle(btn);

  return !!(
    rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && !btn.disabled
  );
}

function findRealChatGPTStopGeneratingButton() {
  for (const selector of CHATGPT_STOP_BUTTON_SELECTORS) {
    const buttons = Array.from(document.querySelectorAll(selector));

    for (const btn of buttons) {
      if (isVisibleChatGPTStopButton(btn)) {
        return btn;
      }
    }
  }

  return null;
}

function hasRealChatGPTStopGeneratingButton() {
  return !!findRealChatGPTStopGeneratingButton();
}

function clickRealChatGPTStopGeneratingButton(source) {
  const sourceText = String(source || 'unknown').trim() || 'unknown';
  const btn = findRealChatGPTStopGeneratingButton();

  if (!btn) {
    return { clicked: false, selector: '', source: sourceText };
  }

  let selector = '';
  for (const candidate of CHATGPT_STOP_BUTTON_SELECTORS) {
    if (btn.matches && btn.matches(candidate)) {
      selector = candidate;
      break;
    }
  }

  try {
    if (typeof clickElementWithFallback === 'function') {
      const clickResult = clickElementWithFallback(btn, { source: `stop-generating:${sourceText}` });
      return {
        clicked: !!(clickResult && clickResult.ok),
        selector: selector || '-',
        source: sourceText,
        method: clickResult && clickResult.method ? clickResult.method : '',
      };
    }

    btn.click();
    return { clicked: true, selector: selector || '-', source: sourceText, method: 'native_click' };
  } catch (err) {
    console.error('[ChatGPT toolbox] clickRealChatGPTStopGeneratingButton failed', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    return { clicked: false, selector: selector || '-', source: sourceText, reason: 'click_failed' };
  }
}

function shouldLetNativeChatGptHandleDrop(e, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const includeFileInput = opts.includeFileInput !== false;
  const includeForm = opts.includeForm !== false;

  if (!e || !e.target) {
    return false;
  }

  if (typeof opts.isInToolbox === 'function' && opts.isInToolbox(e)) {
    return false;
  }

  const target = e.target instanceof Element ? e.target : null;
  if (!target) {
    return false;
  }

  if (typeof isInsideToolbox === 'function' && isInsideToolbox(target)) {
    return false;
  }

  if (typeof isInToolbox === 'function' && isInToolbox(target)) {
    return false;
  }

  const selectors = [
    '[data-testid="composer-root"]',
    '[data-testid="composer"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[data-testid="composer-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
    '[contenteditable="true"]',
  ];

  if (includeForm) {
    selectors.push('form');
  }

  if (includeFileInput) {
    selectors.push('input[type="file"]');
  }

  return !!target.closest(selectors.join(','));
}

function findRealChatGPTSendButton() {
  const selectors = [
    'button#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[aria-label="发送提示"]',
    'button[aria-label="Send prompt"]',
  ];

  for (const selector of selectors) {
    const buttons = Array.from(document.querySelectorAll(selector));

    for (const btn of buttons) {
      if (!btn || isInsideToolbox(btn)) continue;

      const rect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);

      if (
        rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && !btn.disabled
        && btn.getAttribute('aria-disabled') !== 'true'
      ) {
        return btn;
      }
    }
  }

  return null;
}

function getChatGPTComposerText() {
  const candidates = [
    document.querySelector('#prompt-textarea'),
    document.querySelector('[data-testid="prompt-textarea"]'),
    document.querySelector('div.ProseMirror[contenteditable="true"]'),
    document.querySelector('[contenteditable="true"]'),
    document.querySelector('textarea'),
  ].filter(Boolean);

  for (const el of candidates) {
    if (!el || isInsideToolbox(el)) continue;

    const value = String(el.value || el.innerText || el.textContent || '').trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function hasChatGPTComposerAttachmentOnHome() {
  const attachmentSelectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[class*="attachment"]',
  ];

  for (const selector of attachmentSelectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      if (!node || isInsideToolbox(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
  }

  return false;
}

function isHomeNewChatReadyToSendNow() {
  if (!isChatGPTHomeNewChatPage()) {
    return false;
  }

  if (hasRealChatGPTStopGeneratingButton()) {
    return false;
  }

  const sendBtn = findRealChatGPTSendButton();
  if (!sendBtn) {
    return false;
  }

  const composerText = getChatGPTComposerText();
  const hasText = composerText.length > 0;
  const hasAttachment = hasChatGPTComposerAttachmentOnHome();

  return !!(hasText || hasAttachment);
}

function applyHomeNewChatCapabilityOverride(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot;
  }

  if (!isHomeNewChatReadyToSendNow()) {
    return snapshot;
  }

  snapshot.is_responding = false;
  snapshot.can_send_now = true;
  snapshot.can_accept_input = true;
  snapshot.response_state = 'ready';
  snapshot.response_state_reason = 'home_new_chat_composer_ready_override';

  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
    ToolboxShell.appendLog(
      '[BRIDGE][STATE_OVERRIDE] reason=home_new_chat_composer_ready_override '
      + `url=${location.href} conversation_id=-`,
    );
  }

  return snapshot;
}
