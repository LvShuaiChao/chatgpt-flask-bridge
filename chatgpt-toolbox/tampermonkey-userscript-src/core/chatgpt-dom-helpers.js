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

const SEND_BUTTON_SELECTORS = [
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

const COMPOSER_SCOPE_SELECTORS = [
  '[data-testid="composer-root"]',
  '[data-testid="composer"]',
  'form[class*="composer"]',
  '#prompt-textarea',
  'textarea[name="prompt-textarea"]',
  '[contenteditable="true"][data-lexical-editor="true"]',
];

let sendButtonGlobalFallbackLoggedAt = 0;
const SEND_BUTTON_GLOBAL_FALLBACK_LOG_MS = 5000;
let sendButtonCandidatesLoggedAt = 0;
const SEND_BUTTON_CANDIDATES_LOG_MS = 2000;
let sendButtonSelectLoggedAt = 0;
const SEND_BUTTON_SELECT_LOG_MS = 2000;

function isDomHelperComposerDebugEnabled(options = {}) {
  if (typeof isToolboxDebugEnabled === 'function') {
    return isToolboxDebugEnabled(options);
  }
  return options && options.debug === true;
}

function resolveComposerScopeForSendButton(options = {}) {
  if (options.scope instanceof HTMLElement) {
    return options.scope;
  }

  for (const sel of COMPOSER_SCOPE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && !isInsideToolbox(el)) {
      return el.closest('form') || el.parentElement || el;
    }
  }

  return null;
}

function collectVisibleSendButtonCandidates(buttons, candidates) {
  for (const btn of buttons) {
    if (!btn || isInsideToolbox(btn)) {
      continue;
    }

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

function collectSendButtonCandidatesFromScope(scope, candidates) {
  if (!(scope instanceof HTMLElement)) {
    return;
  }

  for (const selector of SEND_BUTTON_SELECTORS) {
    collectVisibleSendButtonCandidates(
      Array.from(scope.querySelectorAll(selector)),
      candidates,
    );
  }
}

function logSendButtonGlobalFallbackThrottled() {
  const now = Date.now();
  if (now - sendButtonGlobalFallbackLoggedAt < SEND_BUTTON_GLOBAL_FALLBACK_LOG_MS) {
    return;
  }

  sendButtonGlobalFallbackLoggedAt = now;
  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
    ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_GLOBAL_FALLBACK]');
  }
}

function pickBestSendButtonCandidate(candidates) {
  const enabled = candidates.find((btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
  if (enabled) {
    return enabled;
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return null;
}

const SEND_BUTTON_REJECT_LABEL_RE = /麦克风|microphone|voice|语音|听写|dictat|upload|attach|附件|添加|浏览|browse|tools|工具|advanced|进阶|更多|more|model|模型|browse files|选择文件|停止听写|开始听写|启动语音|停止回答|停止|stop|generating/i;
const SEND_BUTTON_REJECT_TESTID_RE = /microphone|voice|attach|upload|file-input|file-attach|tools|model|advanced|stop|composer-plus|composer-voice|composer-mic|stop-button/i;
const SEND_BUTTON_REJECT_ID_CLASS_RE = /composer-plus|composer-speech|composer-voice|composer-mic|stop-button/i;
const SEND_BUTTON_POSITIVE_LABEL_RE = /(?:^|\b)(?:send(?:\s+(?:message|prompt))?|发送(?:消息|提示)?)(?:\b|$)/i;

function buildSendButtonCandidateMeta(btn) {
  const ariaLabel = String(btn.getAttribute('aria-label') || '').trim();
  const title = String(btn.getAttribute('title') || '').trim();
  const dataTestId = String(btn.getAttribute('data-testid') || '').trim();
  const btnType = String(btn.getAttribute('type') || '').trim();
  const className = String(btn.className || '').trim();
  const rect = btn.getBoundingClientRect();
  const style = window.getComputedStyle(btn);
  const visible = rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden';
  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';

  return {
    text: String(btn.innerText || btn.textContent || '').trim().slice(0, 40),
    ariaLabel,
    title,
    dataTestId,
    disabled,
    visible,
    rect: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    className: className.slice(0, 80),
    accept: btnType,
    rejectReason: '',
    button: btn,
    score: 0,
  };
}

function classifySendButtonCandidate(meta, composerRoot) {
  const combined = [
    meta.text,
    meta.ariaLabel,
    meta.title,
    meta.dataTestId,
    meta.className,
  ].join(' ');

  if (!meta.visible) {
    meta.rejectReason = 'not-visible';
    return meta;
  }

  if (/添加文件|选择文件|上传文件|附加文件|add file|attach file|upload file|composer-plus/i.test(combined)) {
    meta.rejectReason = 'upload-entry-button';
    return meta;
  }

  if (/开始听写|停止听写|启动语音功能|^语音$|听写|dictation|dictate/i.test(combined)) {
    meta.rejectReason = 'excluded-voice-dictation';
    return meta;
  }

  if (/停止回答|stop generating|stop-button/i.test(combined)) {
    meta.rejectReason = 'excluded-stop-button';
    return meta;
  }

  if (SEND_BUTTON_REJECT_LABEL_RE.test(meta.ariaLabel) || SEND_BUTTON_REJECT_LABEL_RE.test(meta.title) || SEND_BUTTON_REJECT_LABEL_RE.test(meta.text)) {
    meta.rejectReason = 'excluded-control-label';
    return meta;
  }

  if (SEND_BUTTON_REJECT_TESTID_RE.test(meta.dataTestId)) {
    meta.rejectReason = 'excluded-control-testid';
    return meta;
  }

  if (SEND_BUTTON_REJECT_ID_CLASS_RE.test(meta.className) || SEND_BUTTON_REJECT_ID_CLASS_RE.test(String(meta.button.id || ''))) {
    meta.rejectReason = 'excluded-control-id-class';
    return meta;
  }

  if (meta.accept === 'reset') {
    meta.rejectReason = 'reset-button';
    return meta;
  }

  if (meta.disabled) {
    meta.rejectReason = 'disabled';
    return meta;
  }

  let score = 0;
  if (SEND_BUTTON_POSITIVE_LABEL_RE.test(meta.ariaLabel) || SEND_BUTTON_POSITIVE_LABEL_RE.test(meta.title)) {
    score += 6;
  }
  if (meta.dataTestId === 'send-button' || meta.dataTestId === 'composer-submit-button') {
    score += 8;
  }
  if (meta.accept === 'submit') {
    score += 3;
  }

  const svgs = meta.button.querySelectorAll('svg');
  if (svgs.length > 0 && svgs.length < 4) {
    score += 2;
  }

  if (composerRoot instanceof HTMLElement) {
    const scopeRect = composerRoot.getBoundingClientRect();
    const isRightSide = meta.rect.left > (scopeRect.left + scopeRect.width * 0.45);
    if (isRightSide) {
      score += 2;
    }
  }

  for (const selector of SEND_BUTTON_SELECTORS) {
    try {
      if (meta.button.matches(selector)) {
        score += 5;
        break;
      }
    } catch (selectorErr) {
      console.error('[COMPOSER][SEND_BUTTON_SELECTOR_MATCH_ERROR]', selectorErr, { selector });
    }
  }

  if (score < 2) {
    meta.rejectReason = 'low-confidence-not-send';
    return meta;
  }

  meta.score = score;
  meta.rejectReason = '';
  return meta;
}

/**
 * Log send button selection result with composer text context.
 */
function logSendButtonSelect(result, composerText) {
  if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
    return;
  }
  const now = Date.now();
  if (now - sendButtonSelectLoggedAt < SEND_BUTTON_SELECT_LOG_MS) {
    return;
  }
  sendButtonSelectLoggedAt = now;

  const text = String(composerText || '');
  const textLen = text.trim().length;
  const hasComposerText = textLen > 0 ? 1 : 0;
  const button = result && result.button instanceof HTMLButtonElement ? result.button : null;
  const selectedButtonId = button ? String(button.id || '-') : '-';
  const selectedButtonAria = button ? String(button.getAttribute('aria-label') || '-') : '-';
  let reason = String(result && result.reason ? result.reason : 'send-button-not-found');

  if (!hasComposerText) {
    reason = 'empty_composer';
  } else if (!button && reason === 'send-button-not-found') {
    reason = 'send_button_not_found';
  } else if (button) {
    reason = 'ok';
  }

  ToolboxShell.appendLog(
    `[COMPOSER][SEND_BUTTON_SELECT] hasComposerText=${hasComposerText} composerTextLen=${textLen} `
    + `selected=${selectedButtonId} selectedButtonAria=${selectedButtonAria} reason=${reason}`,
  );
}

/**
 * Unified send-button detection with explicit candidate rejection reasons.
 * @param {HTMLElement|null} composerRoot
 * @param {object} [options]
 * @returns {{ found: boolean, button: HTMLButtonElement|null, reason: string, candidates: Array<object> }}
 */
function detectRealSendButton(composerRoot, options = {}) {
  const emptyResult = {
    found: false,
    button: null,
    reason: 'send-button-not-found',
    candidates: [],
  };

  const scope = composerRoot instanceof HTMLElement
    ? composerRoot
    : resolveComposerScopeForSendButton(options || {});

  const composerText = typeof getChatGPTComposerText === 'function'
    ? getChatGPTComposerText()
    : '';

  if (!(scope instanceof HTMLElement)) {
    emptyResult.reason = 'composer-root-not-found';
    logSendButtonSelect(emptyResult, composerText);
    return emptyResult;
  }

  // Priority: explicit send button selectors first.
  for (const selector of SEND_BUTTON_SELECTORS) {
    const priorityBtn = scope.querySelector(selector);
    if (!(priorityBtn instanceof HTMLButtonElement) || isInsideToolbox(priorityBtn)) {
      continue;
    }
    const priorityMeta = classifySendButtonCandidate(buildSendButtonCandidateMeta(priorityBtn), scope);
    if (!priorityMeta.rejectReason && priorityMeta.button instanceof HTMLButtonElement) {
      const btnReady = !priorityMeta.disabled && priorityBtn.getAttribute('aria-disabled') !== 'true';
      const result = btnReady
        ? { found: true, button: priorityBtn, reason: 'send_button_ready', candidates: [] }
        : { found: false, button: null, reason: 'send-button-disabled', candidates: [] };
      logSendButtonSelect(result, composerText);
      return result;
    }
  }

  const rawButtons = Array.from(scope.querySelectorAll('button'));
  const selectorCandidates = [];
  collectSendButtonCandidatesFromScope(scope, selectorCandidates);

  const seen = new Set();
  const allButtons = [];

  for (const btn of selectorCandidates) {
    if (btn instanceof HTMLButtonElement && !seen.has(btn)) {
      seen.add(btn);
      allButtons.push(btn);
    }
  }

  for (const btn of rawButtons) {
    if (btn instanceof HTMLButtonElement && !isInsideToolbox(btn) && !seen.has(btn)) {
      seen.add(btn);
      allButtons.push(btn);
    }
  }

  const candidates = [];
  let best = null;

  for (const btn of allButtons) {
    if (!btn || isInsideToolbox(btn)) {
      continue;
    }

    const meta = classifySendButtonCandidate(buildSendButtonCandidateMeta(btn), scope);
    candidates.push({
      text: meta.text,
      ariaLabel: meta.ariaLabel,
      title: meta.title,
      dataTestId: meta.dataTestId,
      disabled: meta.disabled,
      visible: meta.visible,
      rect: meta.rect,
      className: meta.className,
      accept: meta.accept,
      rejectReason: meta.rejectReason || (meta.score >= 2 ? '' : 'low-confidence-not-send'),
      score: meta.score,
    });

    if (!meta.rejectReason && (!best || meta.score > best.score)) {
      best = meta;
    }
  }

  candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
    const now = Date.now();
    if (now - sendButtonCandidatesLoggedAt >= SEND_BUTTON_CANDIDATES_LOG_MS) {
      sendButtonCandidatesLoggedAt = now;
      const items = candidates.slice(0, 6).map((c) => (
        `aria=${c.ariaLabel || '-'} testid=${c.dataTestId || '-'} reject=${c.rejectReason || '-'} score=${c.score || 0}`
      ));
      ToolboxShell.appendLog(
        `[COMPOSER][SEND_BUTTON_CANDIDATES] count=${candidates.length} item=${items.join(' | ')}`,
      );
    }
  }

  if (best && best.button instanceof HTMLButtonElement) {
    const btnReady = !best.disabled && best.button.getAttribute('aria-disabled') !== 'true';
    if (!btnReady) {
      const disabledResult = {
        found: false,
        button: null,
        reason: 'send-button-disabled',
        candidates,
      };
      logSendButtonSelect(disabledResult, composerText);
      return disabledResult;
    }
    const readyResult = {
      found: true,
      button: best.button,
      reason: 'send_button_ready',
      candidates,
    };
    logSendButtonSelect(readyResult, composerText);
    return readyResult;
  }

  const disabledCandidate = candidates.find((c) => c.visible && !c.rejectReason && c.disabled);
  if (disabledCandidate) {
    const disabledResult = {
      found: true,
      button: null,
      reason: 'send-button-disabled',
      candidates,
    };
    logSendButtonSelect(disabledResult, composerText);
    return disabledResult;
  }

  logSendButtonSelect(emptyResult, composerText);
  return {
    found: false,
    button: null,
    reason: 'send-button-not-found',
    candidates,
  };
}

function findRealChatGPTSendButton(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const explicitScope = opts.scope instanceof HTMLElement ? opts.scope : null;
  const composerScope = explicitScope || resolveComposerScopeForSendButton(opts);

  const detected = detectRealSendButton(composerScope);
  if (detected.found && detected.button instanceof HTMLButtonElement) {
    return detected.button;
  }

  if (composerScope && isDomHelperComposerDebugEnabled(opts)) {
    logSendButtonGlobalFallbackThrottled();
    const globalDetected = detectRealSendButton(document.body);
    if (globalDetected.found && globalDetected.button instanceof HTMLButtonElement) {
      return globalDetected.button;
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

const CHATGPT_UPLOAD_ENTRY_SELECTORS = [
  'button[aria-label*="上传"]',
  'button[aria-label*="Upload"]',
  'button[aria-label*="Attach"]',
  'button[aria-label*="添加文件"]',
  'button[aria-label*="上传文件"]',
  'button[aria-label*="附件"]',
  'button[aria-label*="添加照片"]',
  'button[data-testid*="upload"]',
  'button[data-testid*="attachment"]',
  'button[data-testid*="attach"]',
  'button[title*="Attach"]',
  'button[title*="Upload"]',
  '[role="button"][aria-label*="Attach"]',
  '[role="button"][aria-label*="Upload"]',
  '[role="button"][aria-label*="添加文件"]',
  '[role="button"][aria-label*="上传文件"]',
  'input[type="file"]',
];

const CHATGPT_UPLOAD_ATTACH_LABEL_RE = /添加文件|上传文件|附件|添加照片|Attach|Upload|Add files|upload|attach/i;

function isChatGPTUploadAttachControl(node) {
  if (!(node instanceof HTMLElement) || isInsideToolbox(node)) {
    return false;
  }

  const text = [
    node.innerText || '',
    node.textContent || '',
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.getAttribute('data-testid') || '',
  ].join(' ');

  return CHATGPT_UPLOAD_ATTACH_LABEL_RE.test(text);
}

function resolveChatGPTUploadEntryReadyState(options = {}) {
  const source = String(options.source || '').trim() || '-';
  const explicitScope = options.scope instanceof HTMLElement ? options.scope : null;
  const searchRoots = [];

  if (explicitScope) {
    searchRoots.push(explicitScope);
  } else {
    searchRoots.push(...getHomeComposerScanRoots());
    if (!searchRoots.length) {
      const mainEl = document.querySelector('main');
      if (mainEl instanceof HTMLElement && !isInsideToolbox(mainEl)) {
        searchRoots.push(mainEl);
      }
    }
  }

  const candidates = [];
  const addCandidate = (node) => {
    if (!(node instanceof HTMLElement) || isInsideToolbox(node)) {
      return;
    }
    if (candidates.includes(node)) {
      return;
    }
    candidates.push(node);
  };

  const rootsToScan = searchRoots.length ? searchRoots : [document];
  for (const scanRoot of rootsToScan) {
    for (const selector of CHATGPT_UPLOAD_ENTRY_SELECTORS) {
      const nodes = scanRoot === document
        ? Array.from(document.querySelectorAll(selector))
        : Array.from(scanRoot.querySelectorAll(selector));
      for (const node of nodes) {
        addCandidate(node);
      }
    }
  }

  const skipped = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const node = candidates[candidateIndex];
    const tag = String(node.tagName || '').toLowerCase();
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const isFileInput = tag === 'input' && type === 'file';

    if (node.disabled || node.getAttribute('aria-disabled') === 'true') {
      skipped.push({ reason: 'disabled', tag, candidateIndex });
      continue;
    }

    if (isFileInput) {
      return {
        ok: true,
        node,
        reason: 'file-input-ready',
        source,
        candidateCount: candidates.length,
        skippedCount: skipped.length,
        skipped,
      };
    }

    if (!isChatGPTUploadAttachControl(node)) {
      skipped.push({ reason: 'not-upload-entry', tag, candidateIndex });
      continue;
    }

    const style = window.getComputedStyle(node);
    const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    if (hidden) {
      skipped.push({ reason: 'hidden-style', tag, candidateIndex });
      continue;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      skipped.push({ reason: 'zero-rect', tag, candidateIndex });
      continue;
    }

    return {
      ok: true,
      node,
      reason: 'visible-upload-button-ready',
      source,
      candidateCount: candidates.length,
      skippedCount: skipped.length,
      skipped,
    };
  }

  return {
    ok: false,
    node: null,
    reason: candidates.length ? 'no-visible-upload-button' : 'upload-button-not-found',
    source,
    candidateCount: candidates.length,
    skippedCount: skipped.length,
    skipped,
  };
}

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
