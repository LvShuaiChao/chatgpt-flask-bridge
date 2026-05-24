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

function hasRealChatGPTStopGeneratingButton() {
  const selectors = [
    'button[data-testid="stop-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Stop generating"]',
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
      ) {
        return true;
      }
    }
  }

  return false;
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
