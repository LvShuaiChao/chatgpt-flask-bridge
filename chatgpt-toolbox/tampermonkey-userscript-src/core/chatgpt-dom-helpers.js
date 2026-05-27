function isInsideToolbox(el) {
  if (!el) return false;
  return !!(
    el.closest('#cgpt-toolbox-root')
    || el.closest('#xz-toolbox-root')
    || el.closest('.xz-toolbox-root')
    || el.closest('[data-xz-toolbox="1"]')
    || el.closest('[data-cgpt-toolbox-root="1"]')
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
    'button[data-testid="composer-submit-button"]',
    'form button[type="submit"]',
    'button[aria-label="发送"]',
    'button[aria-label="发送消息"]',
    'button[aria-label="发送提示"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[title="Send"]',
    'button[title="发送"]',
  ];

  const candidates = [];

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
      ) {
        candidates.push(btn);
      }
    }
  }

  const enabled = candidates.find((btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
  if (enabled) {
    return enabled;
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  // Fallback：在 composer form 内搜索右侧发送按钮（黑色圆形箭头）
  try {
    const composerSelectors = [
      '[data-testid="composer-root"]',
      '[data-testid="composer"]',
      'form[class*="composer"]',
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
    ];

    let composerScope = null;
    for (const sel of composerSelectors) {
      const el = document.querySelector(sel);
      if (el && !isInsideToolbox(el)) {
        composerScope = el.closest('form') || el.parentElement || el;
        break;
      }
    }

    if (!composerScope) {
      return null;
    }

    // 排除标识符
    const EXCLUDED_LABELS = /麦克风|microphone|voice|语音|upload|attach|附件|添加|浏览|browse|tools|工具|advanced|进阶|更多|more|model|模型|browse files|选择文件/i;
    const EXCLUDED_TEST_IDS = /microphone|voice|attach|upload|file-input|file-attach|tools|model|advanced/i;

    const allButtons = Array.from(composerScope.querySelectorAll('button'));
    const fallbackCandidates = [];

    for (const btn of allButtons) {
      if (!btn || isInsideToolbox(btn)) continue;

      const rect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);

      if (
        rect.width <= 0
        || rect.height <= 0
        || style.display === 'none'
        || style.visibility === 'hidden'
      ) {
        continue;
      }

      const ariaLabel = String(btn.getAttribute('aria-label') || '').trim();
      const testId = String(btn.getAttribute('data-testid') || '').trim();
      const btnType = String(btn.getAttribute('type') || '').trim();
      const title = String(btn.getAttribute('title') || '').trim();

      // 排除非发送按钮
      if (EXCLUDED_LABELS.test(ariaLabel) || EXCLUDED_LABELS.test(title)) continue;
      if (EXCLUDED_TEST_IDS.test(testId)) continue;
      if (btnType === 'reset') continue;

      // 优先指标：有向上箭头 svg、位于右侧、不是 disabled
      const svgs = btn.querySelectorAll('svg');
      const svgCount = svgs.length;
      let hasSendArrow = false;
      for (const svg of svgs) {
        const pathData = svg.innerHTML || '';
        // 向上箭头路径特征
        if (/M\s*\d.*[Zz]/.test(pathData)) {
          hasSendArrow = true;
          break;
        }
      }

      const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
      const isRightSide = rect.left > (composerScope.getBoundingClientRect().left + composerScope.getBoundingClientRect().width * 0.5);

      const score = (hasSendArrow ? 4 : 0)
        + (isRightSide ? 2 : 0)
        + (!isDisabled ? 1 : 0)
        + (btnType === 'submit' ? 2 : 0)
        + (svgCount > 0 && svgCount < 3 ? 1 : 0);

      fallbackCandidates.push({ btn, score, isDisabled, ariaLabel, testId, rect, svgCount, btnType });
    }

    if (fallbackCandidates.length > 0) {
      fallbackCandidates.sort((a, b) => b.score - a.score);

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        const items = fallbackCandidates.slice(0, 5).map((c) => (
          `tag=button type=${c.btnType || '-'} aria-label=${c.ariaLabel || '-'} testid=${c.testId || '-'}`
          + ` disabled=${c.isDisabled ? 1 : 0} rect=${Math.round(c.rect.left)},${Math.round(c.rect.top)},${Math.round(c.rect.width)}x${Math.round(c.rect.height)}`
          + ` svgCount=${c.svgCount} score=${c.score}`
        ));
        ToolboxShell.appendLog(
          `[COMPOSER][SEND_BUTTON_CANDIDATES] count=${fallbackCandidates.length} item=${items.join(' | ')}`,
        );
      }

      const best = fallbackCandidates[0];
      if (best.score >= 2) {
        return best.btn;
      }
    }
  } catch (err) {
    console.error('[ChatGPT toolbox] findRealChatGPTSendButton fallback failed', err);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[COMPOSER][SEND_BUTTON_FALLBACK_ERROR] error=${err && err.message ? err.message : String(err)}`,
      );
    }
  }

  return null;
}

function getChatGPTComposerText() {
  const candidates = [
    document.querySelector('#prompt-textarea'),
    document.querySelector('textarea[name="prompt-textarea"]'),
    document.querySelector('[data-testid="prompt-textarea"]'),
    document.querySelector('[data-testid="composer-textarea"]'),
    document.querySelector('div.ProseMirror[contenteditable="true"]'),
    document.querySelector('div[contenteditable="true"][role="textbox"]'),
    document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'),
    document.querySelector('form div[contenteditable="true"]'),
    document.querySelector('[contenteditable="true"]'),
    document.querySelector('textarea'),
  ].filter(Boolean);

  let best = '';

  for (const el of candidates) {
    if (!el || isInsideToolbox(el)) continue;

    const value = String(el.value || el.innerText || el.textContent || '').trim();

    if (value.length > best.length) {
      best = value;
    }
  }

  return best;
}

const COMPOSER_REAL_FILE_EXT_PATTERN = /\.(zip|txt|py|js|json|md|pdf|doc|docx|xlsx|csv|png|jpg|jpeg|webp|gif)\b/i;
const COMPOSER_FILE_SIZE_PATTERN = /\b\d+(?:\.\d+)?\s*(KB|MB|GB)\b/i;
const COMPOSER_REMOVE_FILE_PATTERN = /remove file|remove attachment|移除文件|删除文件|移除附件|删除附件/i;
const COMPOSER_FILE_CHIP_PATTERN = /file-chip|file-preview|composer-file|attachment-chip|attachment-preview/i;
const COMPOSER_UPLOAD_ENTRY_PATTERN = /添加文件|选择文件|上传文件|附加文件|add file|browse files|attach file|upload file|composer-plus-btn|file-input|plus button/i;

const HOME_COMPOSER_ATTACHMENT_CHIP_SELECTORS = [
  '[data-testid*="file-chip"]',
  '[data-testid*="file-preview"]',
  '[data-testid*="composer-file"]',
  '[data-testid*="attachment-chip"]',
  '[data-testid*="attachment-preview"]',
  '[class*="file-chip"]',
  '[class*="file-preview"]',
  '[class*="attachment-chip"]',
  '[class*="attachment-preview"]',
];

const bridgeStateOverrideLogThrottle = {
  lastReason: '',
  lastAt: 0,
};

const BRIDGE_STATE_OVERRIDE_LOG_MIN_MS = 5000;

function getHomeComposerScanRoots() {
  const roots = [];
  const addRoot = (root) => {
    if (!(root instanceof HTMLElement)) return;
    if (isInsideToolbox(root)) return;
    if (roots.includes(root)) return;
    roots.push(root);
  };

  addRoot(document.querySelector('[data-testid="composer-root"]'));
  addRoot(document.querySelector('[data-testid="composer"]'));

  const prompt = document.querySelector(
    '#prompt-textarea, textarea[name="prompt-textarea"], [data-testid="prompt-textarea"], [data-testid="composer-textarea"]',
  );
  if (prompt instanceof HTMLElement) {
    addRoot(prompt.closest('form'));
    addRoot(prompt.closest('[data-testid="composer"]'));
    addRoot(prompt.parentElement);
  }

  const editable = document.querySelector(
    'div.ProseMirror[contenteditable="true"], div[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"]',
  );
  if (editable instanceof HTMLElement) {
    addRoot(editable.closest('form'));
    addRoot(editable.closest('[data-testid="composer"]'));
  }

  return roots;
}

function probeHomeComposerAttachmentNode(node) {
  const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  const aria = String(node.getAttribute('aria-label') || '').trim();
  const testId = String(node.getAttribute('data-testid') || '').trim();
  const className = String(node.className || '').trim();
  const probe = `${text} ${aria} ${testId} ${className}`;

  const hasFileName = COMPOSER_REAL_FILE_EXT_PATTERN.test(probe);
  const hasFileSize = COMPOSER_FILE_SIZE_PATTERN.test(probe);
  const hasRemoveSignal = COMPOSER_REMOVE_FILE_PATTERN.test(probe);
  const hasChipSignal = COMPOSER_FILE_CHIP_PATTERN.test(probe);
  const isUploadEntry = COMPOSER_UPLOAD_ENTRY_PATTERN.test(probe)
    && !hasFileName
    && !hasFileSize
    && !hasRemoveSignal
    && !hasChipSignal;

  return {
    probe,
    hasFileName,
    hasFileSize,
    hasRemoveSignal,
    hasChipSignal,
    isUploadEntry,
    hasStrongEvidence: !isUploadEntry && (hasFileName || hasFileSize || hasRemoveSignal || hasChipSignal),
  };
}

function isVisibleHomeComposerNode(node) {
  if (!(node instanceof HTMLElement) || isInsideToolbox(node)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const style = window.getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function hasChatGPTComposerAttachmentOnHome(options = {}) {
  const strict = options.strict !== false;
  const roots = getHomeComposerScanRoots();
  if (!roots.length) {
    return false;
  }

  const seen = new Set();

  for (let r = 0; r < roots.length; r += 1) {
    const root = roots[r];

    for (let s = 0; s < HOME_COMPOSER_ATTACHMENT_CHIP_SELECTORS.length; s += 1) {
      const selector = HOME_COMPOSER_ATTACHMENT_CHIP_SELECTORS[s];
      const nodes = Array.from(root.querySelectorAll(selector));
      for (let n = 0; n < nodes.length; n += 1) {
        const node = nodes[n];
        if (!(node instanceof HTMLElement) || seen.has(node)) continue;
        if (!isVisibleHomeComposerNode(node)) continue;
        seen.add(node);
        const evidence = probeHomeComposerAttachmentNode(node);
        if (!strict || evidence.hasStrongEvidence) {
          return true;
        }
      }
    }

    const broadNodes = Array.from(root.querySelectorAll(
      'button, [role="button"], [data-testid], [aria-label], li, article, section, div, span',
    ));
    for (let n = 0; n < broadNodes.length; n += 1) {
      const node = broadNodes[n];
      if (!(node instanceof HTMLElement) || seen.has(node)) continue;
      if (!isVisibleHomeComposerNode(node)) continue;
      const evidence = probeHomeComposerAttachmentNode(node);
      if (!evidence.hasStrongEvidence) continue;
      seen.add(node);
      return true;
    }
  }

  return false;
}

function appendBridgeStateOverrideLogThrottled(reason, extraLine) {
  if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
    return;
  }

  const now = Date.now();
  if (
    reason === bridgeStateOverrideLogThrottle.lastReason
    && now - bridgeStateOverrideLogThrottle.lastAt < BRIDGE_STATE_OVERRIDE_LOG_MIN_MS
  ) {
    return;
  }

  bridgeStateOverrideLogThrottle.lastReason = reason;
  bridgeStateOverrideLogThrottle.lastAt = now;
  ToolboxShell.appendLog(extraLine);
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
  const sendReady = !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true';
  if (!sendReady) {
    return false;
  }

  const composerText = getChatGPTComposerText();
  const hasText = composerText.length > 0;
  const hasAttachment = hasChatGPTComposerAttachmentOnHome({ strict: true });

  return !!(hasText || hasAttachment);
}

function applyHomeNewChatCapabilityOverride(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return snapshot;
  }

  if (!isChatGPTHomeNewChatPage()) {
    return snapshot;
  }

  if (hasRealChatGPTStopGeneratingButton()) {
    return snapshot;
  }

  const hasText = getChatGPTComposerText().trim().length > 0;
  const hasRealAttachment = hasChatGPTComposerAttachmentOnHome({ strict: true });
  const hasPayload = hasText || hasRealAttachment;
  if (!hasPayload) {
    return snapshot;
  }

  const sendBtn = findRealChatGPTSendButton();
  const sendReady = !!(
    sendBtn
    && !sendBtn.disabled
    && sendBtn.getAttribute('aria-disabled') !== 'true'
  );

  snapshot.is_responding = false;
  snapshot.can_accept_input = true;
  snapshot.can_send_now = sendReady;
  snapshot.response_state = sendReady ? 'ready' : 'not_ready';
  snapshot.response_state_reason = sendReady
    ? 'home_new_chat_composer_ready_override'
    : 'home_new_chat_payload_but_send_button_missing';

  appendBridgeStateOverrideLogThrottled(
    snapshot.response_state_reason,
    `[BRIDGE][STATE_OVERRIDE] reason=${snapshot.response_state_reason} `
    + `url=${location.href} conversation_id=-`,
  );

  return snapshot;
}
