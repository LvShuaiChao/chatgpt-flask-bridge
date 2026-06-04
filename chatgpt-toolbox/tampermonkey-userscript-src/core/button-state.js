  /********************************************************************
   * ButtonState：工具箱按鈕 UI 狀態單一來源（文字 / 顏色 / disabled / phase）
   ********************************************************************/

  const ButtonPhase = Object.freeze({
    IDLE: 'idle',
    INITIALIZING: 'initializing',
    WAITING: 'waiting',
    RUNNING: 'running',
    SENDING: 'sending',
    UPLOADING: 'uploading',
    WAITING_SEND: 'waiting_send',
    WAITING_REPLY: 'waiting_reply',
    COPYING: 'copying',
    CONTINUING: 'continuing',
    NAVIGATING: 'navigating',
    QUOTA_WAITING: 'quota_waiting',
    STARTUP_UPLOADING: 'startup_uploading',
    CANCELLING: 'cancelling',
    CHECKING: 'checking',
    WAITING_INPUT: 'waiting_input',
    WAITING_ATTACHMENT: 'waiting_attachment',
    COMPLETED: 'completed',
    SUCCESS: 'success',
    FAILED: 'failed',
    DANGER: 'danger',
    CANCELLED: 'cancelled',
    DISABLED: 'disabled',
    PAUSED: 'paused',
  });

  const BUTTON_PHASE_ALLOW_CANCEL = new Set([
    ButtonPhase.WAITING,
    ButtonPhase.RUNNING,
    ButtonPhase.SENDING,
    ButtonPhase.UPLOADING,
    ButtonPhase.WAITING_SEND,
    ButtonPhase.WAITING_REPLY,
    ButtonPhase.COPYING,
    ButtonPhase.CANCELLING,
    ButtonPhase.DANGER,
  ]);

  const BUTTON_PHASE_CANCEL_DANGER = new Set([
    ButtonPhase.WAITING,
    ButtonPhase.RUNNING,
    ButtonPhase.SENDING,
    ButtonPhase.UPLOADING,
    ButtonPhase.WAITING_SEND,
    ButtonPhase.WAITING_REPLY,
    ButtonPhase.COPYING,
    ButtonPhase.CANCELLING,
  ]);

  const BUTTON_TEXT_LEAK_MARKERS = Object.freeze([
    '点击取消',
    '点击停止',
    '再次点击停止',
    '再次点击可取消',
  ]);

  const STABLE_LABEL_DYNAMIC_STATUS_EXACT = new Set([
    '停止',
    '发送中',
    '等待回复',
    '等待回复...',
    '等待回复后复制',
    '上传中',
    '处理中',
    '复制中',
    '继续中',
    '继续中...',
    '等待完成',
    '停止回答',
    '停止中',
    '正在停止',
    '取消中',
    '复制失败',
    '等待发送',
    '检查中',
    '执行中',
    '流程失败',
    '准备复制',
    '发送快捷键',
    '停止智能继续',
    '停止环继续',
    '停止闭环继续',
    '等待回复后复制',
    '确认剪贴板',
    '确认剪贴板...',
    '发送快捷键...',
    '复制中...',
    '停止批量任务组',
    '正在启动/自动上传…',
    '上传初始附件',
    '额度等待中',
    '等待下次发送',
    '批量上传中',
  ]);

  const STABLE_LABEL_DYNAMIC_STATUS_INCLUDES = Object.freeze([
    '点击停止',
    '点击取消',
    '再次点击停止',
    '再次点击可取消',
    '等待回复',
    '发送中',
    '上传中',
    '处理中',
    '复制中',
    '继续中',
    '停止环继续',
    '停止闭环继续',
    '（回复中',
    '（等待',
    '（下一轮',
    '（确认完成）',
    '（发送中）',
    '（上传中）',
  ]);

  const CANCELLABLE_BUTTON_ACTIONS = new Set([
    'cancel-send',
    'cancel-wait-reply',
    'stop-upload',
    'cancel-current-task',
    'cancel',
    'stop',
  ]);

  const BUTTON_BUSY_PHASES = new Set([
    ButtonPhase.INITIALIZING,
    ButtonPhase.WAITING,
    ButtonPhase.RUNNING,
    ButtonPhase.SENDING,
    ButtonPhase.UPLOADING,
    ButtonPhase.WAITING_SEND,
    ButtonPhase.WAITING_REPLY,
    ButtonPhase.COPYING,
    ButtonPhase.CONTINUING,
    ButtonPhase.NAVIGATING,
    ButtonPhase.CANCELLING,
    ButtonPhase.QUOTA_WAITING,
    ButtonPhase.STARTUP_UPLOADING,
    ButtonPhase.CHECKING,
    ButtonPhase.WAITING_INPUT,
    ButtonPhase.WAITING_ATTACHMENT,
  ]);

  const BUTTON_STATE_COLOR_CLASSES = Object.freeze([
    'cgpt-btn-idle',
    'cgpt-btn-initializing',
    'cgpt-btn-waiting',
    'cgpt-btn-running',
    'cgpt-btn-sending',
    'cgpt-btn-uploading',
    'cgpt-btn-copying',
    'cgpt-btn-success',
    'cgpt-btn-failed',
    'cgpt-btn-danger',
    'cgpt-btn-cancelled',
    'cgpt-btn-disabled',
    'cgpt-btn-busy',
    'cgpt-btn-warning',
    'cgpt-btn-waiting-danger',
    'success',
    'warning',
    'waiting',
    'busy',
    'cgpt-wait-send-cancel',
    'cgpt-send-danger',
    'cgpt-action-running',
    'cgpt-waiting-answer',
  ]);

  const BUTTON_STATE_LEGACY_LEAK_CLASSES = Object.freeze([
    'cgpt-btn-waiting',
    'cgpt-btn-running',
    'cgpt-btn-sending',
    'cgpt-btn-uploading',
    'cgpt-btn-copying',
    'cgpt-btn-success',
    'cgpt-btn-warning',
    'cgpt-btn-waiting-danger',
  ]);

  const SEND_MESSAGE_BUTTON_IDS = new Set([
    'cgpt-send-message-once',
    'cgpt-send-message-btn',
  ]);

  const SEND_BTN_ALLOWED_COLOR_CLASSES = Object.freeze([
    'cgpt-send-btn-idle',
    'cgpt-send-btn-busy',
  ]);

  const SEND_BTN_LEGACY_COLOR_CLASSES = Object.freeze([
    'cgpt-btn-waiting',
    'cgpt-btn-sending',
    'cgpt-btn-running',
    'cgpt-btn-uploading',
    'cgpt-btn-copying',
    'cgpt-btn-success',
    'cgpt-btn-warning',
    'cgpt-btn-danger',
    'cgpt-btn-busy',
    'cgpt-btn-waiting-danger',
    'danger',
    'cgpt-send-danger',
    'cgpt-wait-send-cancel',
  ]);

  const SEND_BTN_COLOR_CLASSES = Object.freeze([
    ...SEND_BTN_ALLOWED_COLOR_CLASSES,
    ...SEND_BTN_LEGACY_COLOR_CLASSES,
  ]);

  // WAITING_REPLY 不在此集合中：页面回答中不代表发送按钮自己在运行
  const SEND_BTN_BUSY_PHASES = new Set([
    ButtonPhase.WAITING,
    ButtonPhase.SENDING,
    ButtonPhase.RUNNING,
    ButtonPhase.CHECKING,
    ButtonPhase.WAITING_SEND,
    ButtonPhase.WAITING_INPUT,
    ButtonPhase.WAITING_ATTACHMENT,
    ButtonPhase.UPLOADING,
    ButtonPhase.CANCELLING,
  ]);

  const SEND_BTN_ALLOWED_TEXTS = new Set([
    '发送消息',
    '等待发送',
    '等待点击发送',
    '等待页面回复后发送',
    '等待输入框',
    '等待附件',
    '准备发送',
    '等待发送按钮',
    '上传中',
    '检查中',
    '发送中',
    '等待回复',
    '取消中',
    '发送失败',
    '已取消',
    '停止回答',
    '停止中',
    '正在复制',
    '发送快捷键',
    '执行中',
    '流程失败',
    '继续中',
    '准备复制',
    '正在停止',
  ]);

  const TASK_PHASE_TO_BUTTON_PHASE = Object.freeze({
    idle: ButtonPhase.IDLE,
    initializing: ButtonPhase.INITIALIZING,
    waiting: ButtonPhase.WAITING,
    uploading: ButtonPhase.UPLOADING,
    waiting_send: ButtonPhase.WAITING_SEND,
    // 页面正在回复，消息尚未发出：视觉属于“等待发送”分支（文案由上层区分）。
    waiting_page_reply_to_send: ButtonPhase.WAITING_SEND,
    waiting_ready: ButtonPhase.WAITING_SEND,
    sending: ButtonPhase.SENDING,
    waiting_reply: ButtonPhase.WAITING_REPLY,
    copying: ButtonPhase.COPYING,
    running: ButtonPhase.RUNNING,
    continuing: ButtonPhase.CONTINUING,
    navigating: ButtonPhase.NAVIGATING,
    quota_waiting: ButtonPhase.QUOTA_WAITING,
    startup_uploading: ButtonPhase.STARTUP_UPLOADING,
    cancelling: ButtonPhase.CANCELLING,
    checking: ButtonPhase.CHECKING,
    waiting_input: ButtonPhase.WAITING_INPUT,
    waiting_attachment: ButtonPhase.WAITING_ATTACHMENT,
    cancelled: ButtonPhase.CANCELLED,
    success: ButtonPhase.IDLE,
    failed: ButtonPhase.FAILED,
    completed: ButtonPhase.COMPLETED,
    danger: ButtonPhase.DANGER,
    disabled: ButtonPhase.DISABLED,
    paused: ButtonPhase.PAUSED,
  });

  const HOME_PAGE_BUTTON_COLOR_AUDIT_SELECTOR = [
    '#cgpt-upload-start',
    '#cgpt-send-message-once',
    '#cgpt-copy-hotkey-once',
    '#cgpt-copy-hotkey-continue-once',
    '#cgpt-copy-hotkey-continue-loop',
    '#cgpt-copy-last-message-scroll-bottom',
    '#cgpt-upload-continue-once',
    '#cgpt-open-chatgpt-home',
    '#cgpt-autoq-start',
    '#cgpt-autoq-start-upload',
    '#cgpt-autoq-send-once',
  ].join(',');

  function getUnifiedButtonAuthoritySnapshot(source = '-') {
    const bridgeState = (
      typeof window !== 'undefined'
      && window.__cgptBridgeState
      && typeof window.__cgptBridgeState === 'object'
    )
      ? window.__cgptBridgeState
      : {};

    const responseState = String(
      bridgeState.response_state
      || bridgeState.responseState
      || '',
    ).trim().toLowerCase();

    const responseReason = String(
      bridgeState.response_state_reason
      || bridgeState.responseStateReason
      || bridgeState.reason
      || '',
    ).trim().toLowerCase();

    const inputable = bridgeState.inputable === true || bridgeState.inputable === 1;
    const sendable = bridgeState.sendable === true || bridgeState.sendable === 1;

    const assistantBusy = (
      responseState === 'generating'
      || responseState === 'responding'
      || responseState === 'answering'
      || responseState === 'streaming'
      || responseReason === 'assistant_busy'
    );

    return {
      source,
      responseState,
      responseReason,
      inputable,
      sendable,
      assistantBusy,
      canSendByHeader: inputable && sendable && !assistantBusy,
    };
  }

  function isButtonStateDebugEnabled() {
    if (typeof MemoryManager === 'undefined' || typeof MemoryManager.get !== 'function') {
      return false;
    }
    return !!MemoryManager.get('bridgeDebugEnabled', false);
  }

  function resolveButtonAction(button) {
    if (!button) {
      return {
        baseAction: '',
        runtimeAction: '',
        domAction: '',
        effectiveAction: '',
      };
    }

    const domAction = String(button.dataset.action || '').trim();
    const baseAction = String(
      button.dataset.cgptBaseAction
      || domAction
      || '',
    ).trim();
    const runtimeAction = String(
      button.dataset.cgptRuntimeAction
      || '',
    ).trim();
    const legacyRuntimeAction = String(button.dataset.cgptButtonAction || '').trim();
    const effectiveAction = runtimeAction || baseAction || domAction;

    return {
      baseAction,
      runtimeAction,
      legacyRuntimeAction,
      domAction,
      effectiveAction,
    };
  }

  function setButtonRuntimeAction(button, runtimeAction) {
    if (!button) {
      return;
    }
    const value = String(runtimeAction || '').trim();
    if (value) {
      button.dataset.cgptRuntimeAction = value;
      delete button.dataset.cgptButtonAction;
    } else {
      delete button.dataset.cgptRuntimeAction;
      delete button.dataset.cgptButtonAction;
    }
  }

  function setButtonBaseAction(button, baseAction) {
    if (!button) {
      return;
    }
    const value = String(baseAction || '').trim();
    if (value) {
      button.dataset.cgptBaseAction = value;
    } else {
      delete button.dataset.cgptBaseAction;
    }
  }

  function getButtonActionId(button) {
    if (!button) {
      return '-';
    }
    const resolved = resolveButtonAction(button);
    return String(
      resolved.effectiveAction
      || button.id
      || '-',
    ).trim() || '-';
  }

  function logButtonStateChange(button, oldPhase, newPhase, text, reason) {
    const action = getButtonActionId(button);
    const line = `[BUTTON_STATE][CHANGE] action=${action} oldPhase=${oldPhase || '-'} newPhase=${newPhase} text=${text || '-'} reason=${reason || '-'}`;
    if (isButtonStateDebugEnabled()) {
      console.log(line);
    }
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonStateMismatch(button, view, reason = '') {
    const action = getButtonActionId(button);
    const text = button ? String(button.textContent || '').trim() : '';
    const disabled = button ? !!button.disabled : false;
    const phase = view && view.phase ? view.phase : (button && button.dataset.cgptTaskPhase) || '-';
    const line = `[BUTTON_STATE][MISMATCH] action=${action} text=${text} phase=${phase} disabled=${disabled ? 1 : 0} reason=${reason || '-'}`;
    console.warn(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonStateClick(action, phase, runId) {
    const line = `[BUTTON_STATE][CLICK] action=${action || '-'} phase=${phase || '-'} runId=${runId || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonStateCancel(button, source, phase, extra = {}) {
    const action = getButtonActionId(button);
    const runId = extra && extra.runId ? String(extra.runId) : '-';
    const line = `[BUTTON_STATE][CANCEL] action=${action} reason=${source || '-'} phase=${phase || '-'} runId=${runId}`;
    console.warn(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonStateRestore(button, runId, phase) {
    if (!isButtonStateDebugEnabled()) {
      return;
    }
    const id = button && (button.id || button.dataset.action || '-');
    const line = `[BUTTON_STATE][RESTORE] id=${id} runId=${runId || '-'} phase=${phase || ButtonPhase.IDLE}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function clearButtonStateColorClasses(button) {
    if (!button) {
      return;
    }
    BUTTON_STATE_COLOR_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
  }

  function applyDisabledVisualOnlyState(button, disabled, reason = '') {
    if (!button) {
      return;
    }
    const isDisabled = disabled === true;
    button.classList.remove('cgpt-btn-disabled');
    if (isDisabled) {
      button.classList.add('cgpt-btn-disabled-visual');
      button.style.opacity = '0.72';
      button.style.filter = 'none';
      button.style.cursor = 'not-allowed';
      if (reason) {
        button.dataset.disabledReason = String(reason);
      }
    } else {
      button.classList.remove('cgpt-btn-disabled-visual');
      button.style.opacity = '';
      button.style.filter = '';
      button.style.cursor = '';
      delete button.dataset.disabledReason;
    }
  }

  function clearButtonStateClasses(button) {
    clearButtonStateColorClasses(button);
  }

  function isSendMessageToolboxButton(button) {
    if (!button) {
      return false;
    }
    return SEND_MESSAGE_BUTTON_IDS.has(String(button.id || '').trim());
  }

  function isBatchTaskMainButton(button) {
    if (!button) {
      return false;
    }
    return (
      button.getAttribute('data-fixed-label-owner') === 'batch-task'
      || button.getAttribute('data-role') === 'batch-task-main-button'
    );
  }

  function isSendMessageButtonBusy(phase, extra = {}) {
    return SEND_BTN_BUSY_PHASES.has(phase)
      || extra.allowCancel === true
      || extra.busy === true;
  }

  function clearSendMessageButtonColorClasses(button) {
    if (!button) {
      return;
    }
    SEND_BTN_COLOR_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
  }

  function mapTaskPhaseToButtonPhase(taskPhase) {
    const normalized = String(taskPhase || ButtonPhase.IDLE).trim().toLowerCase();
    if (TASK_PHASE_TO_BUTTON_PHASE[normalized]) {
      return TASK_PHASE_TO_BUTTON_PHASE[normalized];
    }
    if (normalized === 'sending_hotkey' || normalized === 'sending_continue') {
      return ButtonPhase.RUNNING;
    }
    if (normalized === 'stopping') {
      return ButtonPhase.CANCELLING;
    }
    return ButtonPhase.RUNNING;
  }

  function mirrorSendButtonLegacyDataset(button) {
    if (!button) {
      return;
    }
    // data-send-state is deprecated; do not write or use it as a logic source.
    delete button.dataset.sendState;
    delete button.dataset.uploadSendState;
  }

  function applySendMessageButtonColorClasses(button, phase, extra = {}) {
    if (!button) {
      return false;
    }
    const isBusy = isSendMessageButtonBusy(phase, extra);
    clearSendMessageButtonColorClasses(button);
    button.classList.add('cgpt-send-btn');
    button.classList.toggle('cgpt-send-btn-idle', !isBusy);
    button.classList.toggle('cgpt-send-btn-busy', isBusy);
    button.classList.remove('cgpt-btn-busy');
    return isBusy;
  }

  function auditSendMessageButtonColorLeak(button, phase = '') {
    if (!button || !isSendMessageToolboxButton(button)) {
      return;
    }
    const isBusy = isSendMessageButtonBusy(
      String(phase || button.dataset.cgptButtonPhase || '').trim(),
      { allowCancel: button.dataset.cgptButtonPhase && BUTTON_PHASE_ALLOW_CANCEL.has(button.dataset.cgptButtonPhase) },
    );
    const legacyColorHits = SEND_BTN_LEGACY_COLOR_CLASSES.filter((cls) => button.classList.contains(cls));
    const genericLeaks = BUTTON_STATE_LEGACY_LEAK_CLASSES.filter((cls) => button.classList.contains(cls));
    const leaked = [
      ...legacyColorHits,
      ...genericLeaks,
      ...(isBusy && !button.classList.contains('cgpt-send-btn-busy') ? ['missing-cgpt-send-btn-busy'] : []),
      ...(!isBusy && !button.classList.contains('cgpt-send-btn-idle') ? ['missing-cgpt-send-btn-idle'] : []),
    ];
    if (leaked.length === 0) {
      return;
    }
    const id = button.id || '-';
    const line = `[BUTTON_COLOR][SEND_BTN_COLOR_LEAK] id=${id} classes=${leaked.join(',')} phase=${phase || button.dataset.cgptButtonPhase || '-'}`;
    console.warn(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logSendMessageButtonColor(button, phase, extra = {}) {
    if (!button || !isSendMessageToolboxButton(button)) {
      return;
    }
    const isBusy = isSendMessageButtonBusy(phase, extra);
    logButtonColorState(button, phase, isBusy, extra.reason || 'send-message');
    auditSendMessageButtonColorLeak(button, phase);
  }

  function sanitizeSendMessageButtonText(text) {
    const normalized = String(text || '').trim();
    if (!normalized || isDynamicButtonStatusText(normalized)) {
      return '';
    }
    return normalized === '发送消息' ? normalized : '';
  }

  function isStableActionButton(button) {
    if (!button) {
      return false;
    }
    if (button.hasAttribute('data-dynamic-label-allowed')) {
      return false;
    }
    if (button.hasAttribute('data-stable-label')) {
      return true;
    }
    if (isSendMessageToolboxButton(button) || isBatchTaskMainButton(button)) {
      return true;
    }
    const className = String(button.className || '');
    const action = String(
      button.dataset.cgptBaseAction
      || button.dataset.action
      || button.getAttribute('data-action')
      || '',
    ).trim();
    return (
      className.includes('cgpt-btn')
      || className.includes('cgpt-toolbox-small-btn')
      || action.length > 0
    );
  }

  function getOrInitStableButtonLabel(button, fallbackText = '') {
    if (!button) {
      return String(fallbackText || '').trim();
    }
    const saved = String(button.dataset.stableLabel || button.dataset.idleLabel || '').trim();
    if (saved && !isDynamicButtonStatusText(saved)) {
      if (!button.dataset.stableLabel) {
        button.dataset.stableLabel = saved;
      }
      if (!button.dataset.idleLabel) {
        button.dataset.idleLabel = saved;
      }
      button.dataset.keepStableLabel = '1';
      return saved;
    }
    const current = String(button.textContent || '').trim();
    const fallback = String(fallbackText || '').trim();
    const candidate = (!isDynamicButtonStatusText(current) && current)
      || (!isDynamicButtonStatusText(fallback) && fallback)
      || '';
    if (candidate) {
      button.dataset.stableLabel = candidate;
      button.dataset.idleLabel = candidate;
      button.dataset.keepStableLabel = '1';
      return candidate;
    }
    return saved || current || fallback;
  }

  function resolveButtonStatusText(rawTitle, rawText, phase, extra = {}) {
    const title = String(rawTitle || '').trim();
    if (title) {
      return title;
    }
    const text = String(rawText || '').trim();
    if (!text) {
      return '';
    }
    if (isDynamicButtonStatusText(text)) {
      return text;
    }
    if (isToolboxButtonActivePhase(phase, extra)) {
      return text;
    }
    return '';
  }

  function applyStableActionButtonLabel(button, displayText, statusText) {
    if (!button) {
      return;
    }
    const display = String(displayText || '').trim();
    if (display && isDynamicButtonStatusText(display)) {
      button.textContent = display;
      const normalizedStatus = String(statusText || '').trim();
      if (normalizedStatus) {
        button.dataset.cgptStatusText = normalizedStatus;
        button.title = normalizedStatus;
      } else {
        delete button.dataset.cgptStatusText;
      }
      return;
    }
    const stableText = getOrInitStableButtonLabel(button, displayText);
    if (stableText) {
      button.textContent = stableText;
    } else if (displayText) {
      button.textContent = String(displayText);
    }
    const normalizedStatus = String(statusText || '').trim();
    if (normalizedStatus) {
      button.dataset.cgptStatusText = normalizedStatus;
      button.title = normalizedStatus;
    } else {
      delete button.dataset.cgptStatusText;
      if (stableText) {
        button.title = stableText;
      }
    }
  }

  function isButtonBusyPhase(phase, extra = {}) {
    return BUTTON_BUSY_PHASES.has(phase) || extra.busy === true;
  }

  function logButtonColorState(button, phase, isBusyState, reason = '') {
    if (!button) {
      return;
    }
    const id = button.id || button.dataset.action || '-';
    const text = String(button.textContent || '').trim() || '-';
    const classNames = String(button.className || '').trim() || '-';
    const line = `[BUTTON_COLOR][STATE] id=${id} text=${text} phase=${phase || '-'} busy=${isBusyState ? 1 : 0} class=${classNames} reason=${reason || '-'}`;
    if (isButtonStateDebugEnabled()) {
      console.log(line);
    }
    if (typeof ToolboxShell !== 'undefined') {
      const key = `BUTTON_COLOR:STATE:${id}`;
      const value = `${text}|${phase || '-'}|${isBusyState ? 1 : 0}|${classNames}`;
      if (typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(key, value, line, 10000);
      } else if (typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }
  }

  function auditButtonColorLeak(button) {
    if (!button) {
      return;
    }
    if (isSendMessageToolboxButton(button)) {
      auditSendMessageButtonColorLeak(button);
      return;
    }
    const phase = String(button.dataset.cgptButtonPhase || '').trim();
    const isBusy = isButtonBusyPhase(phase);
    const id = button.id || button.dataset.action || '-';
    const text = String(button.textContent || '').trim() || '-';

    if (isBusy && !button.classList.contains('cgpt-btn-busy')) {
      const line = `[BUTTON_COLOR][BUSY_CLASS_MISSING] id=${id} text=${text} phase=${phase || '-'}`;
      console.warn(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }

    const leaked = BUTTON_STATE_LEGACY_LEAK_CLASSES.filter((cls) => button.classList.contains(cls));
    if (isBusy && leaked.length > 0) {
      const line = `[BUTTON_COLOR][MULTI_STATE_COLOR_LEAK] id=${id} text=${text} phase=${phase || '-'} classes=${leaked.join(',')}`;
      console.warn(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }
  }

  function auditHomePageButtonColors(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const buttons = scope.querySelectorAll(HOME_PAGE_BUTTON_COLOR_AUDIT_SELECTOR);
    const resolveColorFamily = (value) => {
      const text = String(value || '').trim().toLowerCase();
      if (!text || text === 'none' || text === 'transparent') {
        return 'unknown';
      }
      if (
        text.includes('#2563eb')
        || text.includes('#3b82f6')
        || text.includes('#4f46e5')
        || text.includes('#6366f1')
        || text.includes('147, 197, 253')
        || text.includes('191, 219, 254')
      ) {
        return 'blue';
      }
      if (text.includes('#7c3aed') || text.includes('#8b5cf6') || text.includes('#6d28d9')) {
        return 'purple';
      }
      if (text.includes('#166534') || text.includes('#15803d') || text.includes('#22c55e')) {
        return 'green';
      }
      if (text.includes('#dc2626') || text.includes('#b91c1c') || text.includes('#ef4444')) {
        return 'red';
      }
      if (
        text.includes('#b45309')
        || text.includes('#d97706')
        || text.includes('#ea580c')
        || text.includes('#f97316')
        || text.includes('#f59e0b')
      ) {
        return 'orange';
      }
      if (text.includes('#0891b2') || text.includes('#22d3ee') || text.includes('#0e7490')) {
        return 'cyan';
      }
      return 'unknown';
    };
    const isCompatibleFamily = (normalFamily, hoverFamily) => {
      if (!normalFamily || !hoverFamily || normalFamily === 'unknown' || hoverFamily === 'unknown') {
        return false;
      }
      if (normalFamily === hoverFamily) {
        return true;
      }
      // 蓝/紫渐变视为同色系（复制相关按钮允许蓝紫互转）
      return (
        (normalFamily === 'blue' && hoverFamily === 'purple')
        || (normalFamily === 'purple' && hoverFamily === 'blue')
      );
    };
    const resolveCategory = (button) => {
      const action = String(
        button.dataset.cgptBaseAction
        || button.dataset.action
        || button.id
        || '',
      ).trim().toLowerCase();
      if (action.includes('copy')) {
        return 'copy';
      }
      if (action.includes('send')) {
        return 'send';
      }
      if (action.includes('upload')) {
        return 'upload';
      }
      if (action.includes('danger') || button.classList.contains('danger')) {
        return 'danger';
      }
      return 'general';
    };
    buttons.forEach((button) => {
      if (isSendMessageToolboxButton(button)) {
        auditSendMessageButtonColorLeak(button);
      } else {
        auditButtonColorLeak(button);
      }
      const alreadyAudited = String(button.dataset.cgptStyleAuditLogged || '').trim() === '1';
      if (alreadyAudited) {
        return;
      }
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(button) : null;
      const action = getButtonActionId(button);
      const text = String(button.textContent || '').trim() || '-';
      const className = String(button.className || '').trim() || '-';
      const category = resolveCategory(button);
      const normalBackground = style
        ? (
          style.getPropertyValue('--cgpt-btn-bg').trim()
          || style.backgroundImage
          || style.backgroundColor
          || '-'
        )
        : '-';
      const hoverBackground = style
        ? (
          style.getPropertyValue('--cgpt-btn-hover-bg').trim()
          || style.getPropertyValue('--cgpt-btn-bg').trim()
          || style.backgroundImage
          || style.backgroundColor
          || '-'
        )
        : '-';
      const normalFamily = resolveColorFamily(normalBackground);
      const hoverFamily = resolveColorFamily(hoverBackground);
      const isSameColorFamily = isCompatibleFamily(normalFamily, hoverFamily) ? '1' : '0';
      const line = `[BUTTON_STYLE_AUDIT] action=${action} text=${text} className=${className} category=${category} normalBackground=${normalBackground} hoverBackground=${hoverBackground} isSameColorFamily=${isSameColorFamily}`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.log(line);
      }
      button.dataset.cgptStyleAuditLogged = '1';
    });
  }

  function warnStoppingButtonTextLeak(button) {
    if (!button) {
      return;
    }
    const text = String(button.textContent || '');
    const hasLegacyCancelHint = BUTTON_TEXT_LEAK_MARKERS.some((marker) => text.includes(marker));
    if (!hasLegacyCancelHint) {
      return;
    }
    const line = `[BUTTON_TEXT][STOPPING_TEXT_LEAK] id=${button.id || '-'} text=${text} phase=${button.dataset.cgptButtonPhase || '-'} reason=${button.dataset.cgptButtonReason || '-'}`;
    console.warn(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function isDynamicButtonStatusText(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return false;
    }
    if (STABLE_LABEL_DYNAMIC_STATUS_EXACT.has(normalized)) {
      return true;
    }
    return STABLE_LABEL_DYNAMIC_STATUS_INCLUDES.some((marker) => normalized.includes(marker));
  }

  function shouldAutoKeepStableButtonLabel(button) {
    return isStableActionButton(button);
  }

  function markButtonStableLabel(button, label) {
    if (!button) {
      return;
    }
    const normalized = String(label || button.textContent || '').trim();
    if (!normalized || isDynamicButtonStatusText(normalized)) {
      return;
    }
    button.dataset.stableLabel = normalized;
    button.dataset.idleLabel = normalized;
    button.dataset.keepStableLabel = '1';
  }

  function getStableButtonText(button, viewState = {}) {
    if (!button) {
      return '';
    }
    if (!isStableActionButton(button)) {
      return String(viewState && viewState.text || button.textContent || '').trim();
    }
    const fallback = String(viewState && viewState.text || '').trim();
    if (fallback && isDynamicButtonStatusText(fallback)) {
      return fallback;
    }
    if (fallback && !isDynamicButtonStatusText(fallback)) {
      return getOrInitStableButtonLabel(button, fallback);
    }
    return getOrInitStableButtonLabel(button, button.textContent || '');
  }

  function isToolboxButtonActivePhase(phase, extra = {}) {
    const normalized = String(phase || '').toLowerCase();
    if (
      normalized === ButtonPhase.RUNNING
      || normalized === ButtonPhase.SENDING
      || normalized === ButtonPhase.UPLOADING
      || normalized === ButtonPhase.WAITING
      || normalized === ButtonPhase.WAITING_SEND
      || normalized === ButtonPhase.WAITING_REPLY
      || normalized === ButtonPhase.COPYING
      || normalized === ButtonPhase.CANCELLING
      || normalized === ButtonPhase.DANGER
      || normalized === ButtonPhase.CONTINUING
      || normalized === ButtonPhase.CHECKING
      || normalized === ButtonPhase.INITIALIZING
      || normalized === ButtonPhase.WAITING_INPUT
      || normalized === ButtonPhase.WAITING_ATTACHMENT
      || normalized === ButtonPhase.QUOTA_WAITING
      || normalized === ButtonPhase.STARTUP_UPLOADING
      || normalized === ButtonPhase.NAVIGATING
    ) {
      return true;
    }
    return isButtonBusyPhase(phase, extra) || extra.busy === true;
  }

  function setToolboxButtonState(button, options = {}) {
    if (!button) {
      return false;
    }

    const {
      phase = ButtonPhase.IDLE,
      text = '',
      title = '',
      disabled = false,
      allowCancel = false,
      reason = '',
      ariaBusy = null,
      busy = false,
      permanentDanger = false,
      preserveBaseColorWhenDisabled = false,
    } = options;

    const isSendBtn = isSendMessageToolboxButton(button);

    const finish = (result) => {
      warnStoppingButtonTextLeak(button);
      return result;
    };

    const oldPhase = button.dataset.cgptButtonPhase || '-';
    const rawViewText = text != null ? String(text) : '';
    const rawViewTitle = title != null ? String(title) : '';
    let nextText = rawViewText;
    const nextTitle = rawViewTitle;

    if (isSendBtn && nextText) {
      nextText = sanitizeSendMessageButtonText(nextText);
    }

    if (
      isStableActionButton(button)
      && nextText
      && !isDynamicButtonStatusText(nextText)
      && (
        phase === ButtonPhase.IDLE
        || phase === ButtonPhase.SUCCESS
        || phase === ButtonPhase.COMPLETED
        || !button.dataset.stableLabel
      )
    ) {
      markButtonStableLabel(button, nextText);
    }

    if (isBatchTaskMainButton(button) && nextText && isDynamicButtonStatusText(nextText)) {
      const attemptedText = nextText;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BATCH_BUTTON][STATUS_TEXT_REDIRECTED] id=${button.id || '-'} attempted=${attemptedText} reason=${reason || '-'}`,
        );
      }
    }

    const isBusyState = isSendBtn
      ? isSendMessageButtonBusy(phase, { allowCancel, busy })
      : isButtonBusyPhase(phase, { busy });
    const usePermanentDanger = phase === ButtonPhase.DANGER && permanentDanger === true;
    const preserveDisabledIdleColor = preserveBaseColorWhenDisabled === true
      && (
        phase === ButtonPhase.IDLE
        || phase === ButtonPhase.INITIALIZING
        || phase === ButtonPhase.CHECKING
        || phase === ButtonPhase.WAITING_INPUT
        || phase === ButtonPhase.WAITING_ATTACHMENT
      )
      && disabled === true;
    const allowBusyClass = isBusyState && !preserveDisabledIdleColor;

    if (preserveDisabledIdleColor) {
      button.classList.remove('cgpt-btn-busy');
      BUTTON_STATE_LEGACY_LEAK_CLASSES.forEach((cls) => {
        button.classList.remove(cls);
      });
      ['cgpt-btn-waiting', 'cgpt-btn-running', 'cgpt-btn-sending', 'cgpt-btn-danger'].forEach((cls) => {
        button.classList.remove(cls);
      });
    } else {
      clearButtonStateColorClasses(button);
      if (!isSendBtn) {
        const useCancellableDanger = phase === ButtonPhase.DANGER && allowCancel === true;
        button.classList.toggle(
          'cgpt-btn-busy',
          allowBusyClass && !usePermanentDanger && !useCancellableDanger,
        );
        if (usePermanentDanger || useCancellableDanger) {
          button.classList.add('cgpt-btn-danger');
        }
        if (useCancellableDanger) {
          button.classList.add('cgpt-btn-stop', 'cgpt-btn-waiting-danger', 'cgpt-action-running');
        }
      }
    }

    const statusText = resolveButtonStatusText(nextTitle, rawViewText, phase, { allowCancel, busy });
    if (isStableActionButton(button)) {
      applyStableActionButtonLabel(button, nextText, statusText);
    } else if (nextText) {
      button.textContent = nextText;
      delete button.dataset.cgptStatusText;
      if (nextTitle || nextText) {
        button.title = nextTitle || nextText;
      }
    }

    const isActivePhase = isToolboxButtonActivePhase(phase, { allowCancel, busy });
    button.classList.toggle('cgpt-action-button-active', isActivePhase && !preserveDisabledIdleColor);

    button.dataset.cgptButtonPhase = phase;
    if (isSendBtn) {
      mirrorSendButtonLegacyDataset(button);
    }
    if (reason) {
      button.dataset.cgptButtonReason = String(reason);
    } else {
      delete button.dataset.cgptButtonReason;
    }

    const explicitKeepNative = button.hasAttribute('data-enter-keep-native');
    const explicitBlock = button.hasAttribute('data-enter-block')
      || (button.hasAttribute('data-danger-enter-block') && button.dataset.autoDangerEnterBlock !== '1');
    const actionName = String(
      button.dataset.cgptBaseAction || button.dataset.action || button.getAttribute('data-action') || '',
    ).trim().toLowerCase();
    const isCancelAction =
      actionName.includes('cancel')
      || actionName.includes('stop');
    const dangerTextProbe = rawViewText || nextText;
    const looksDangerAction =
      dangerTextProbe.includes('删除')
      || dangerTextProbe.includes('清空')
      || allowCancel === true
      || isCancelAction
      || BUTTON_PHASE_ALLOW_CANCEL.has(phase)
      || CANCELLABLE_BUTTON_ACTIONS.has(actionName);
    const shouldAutoBlockEnter =
      !explicitKeepNative
      && !explicitBlock
      && looksDangerAction
      && (
        phase === ButtonPhase.WAITING
        || phase === ButtonPhase.RUNNING
        || phase === ButtonPhase.SENDING
        || phase === ButtonPhase.UPLOADING
        || phase === ButtonPhase.WAITING_SEND
        || phase === ButtonPhase.WAITING_REPLY
        || phase === ButtonPhase.DANGER
        || phase === ButtonPhase.CANCELLING
      );

    if (shouldAutoBlockEnter) {
      button.setAttribute('data-danger-enter-block', '1');
      button.dataset.autoDangerEnterBlock = '1';
    } else if (button.dataset.autoDangerEnterBlock === '1') {
      button.removeAttribute('data-danger-enter-block');
      delete button.dataset.autoDangerEnterBlock;
    }

    if (ariaBusy === true) {
      button.setAttribute('aria-busy', 'true');
    } else if (ariaBusy === false) {
      button.setAttribute('aria-busy', 'false');
    } else if (
      phase === ButtonPhase.IDLE
      || phase === ButtonPhase.INITIALIZING
      || phase === ButtonPhase.SUCCESS
      || phase === ButtonPhase.FAILED
      || phase === ButtonPhase.CANCELLED
      || phase === ButtonPhase.DISABLED
    ) {
      // Ensure busy styling never leaks into idle/terminal/disabled phases.
      button.setAttribute('aria-busy', 'false');
    }

    const sig = JSON.stringify({
      phase,
      text: nextText,
      title: nextTitle,
      disabled: !!disabled,
      allowCancel: !!allowCancel,
    });

    if (button.dataset.lastToolboxButtonSig !== sig) {
      button.dataset.lastToolboxButtonSig = sig;
      if (oldPhase !== phase) {
        logButtonStateChange(button, oldPhase, phase, nextText, reason);
      }
    }

    const canCancel = allowCancel === true || BUTTON_PHASE_ALLOW_CANCEL.has(phase);
    const isTerminalPhase = phase === ButtonPhase.FAILED
      || phase === ButtonPhase.CANCELLED
      || phase === ButtonPhase.DISABLED;

    if (!isSendBtn && !preserveDisabledIdleColor) {
      if (phase === ButtonPhase.INITIALIZING) {
        button.classList.add('cgpt-btn-initializing');
      } else if (phase === ButtonPhase.FAILED) {
        button.classList.add('cgpt-btn-failed');
      } else if (phase === ButtonPhase.CANCELLED) {
        button.classList.add('cgpt-btn-cancelled');
      }
    }

    if (isTerminalPhase) {
      button.disabled = phase === ButtonPhase.DISABLED ? true : Boolean(disabled);
    } else {
      button.disabled = !canCancel && Boolean(disabled);
    }
    if (!button.disabled) {
      button.removeAttribute('disabled');
    }

    const isRunningVisual = isBusyState
      || phase === ButtonPhase.DANGER
      || phase === ButtonPhase.CANCELLING
      || button.classList.contains('cgpt-btn-busy')
      || button.classList.contains('cgpt-btn-danger')
      || button.classList.contains('cgpt-action-running');
    if (button.disabled && !isRunningVisual) {
      applyDisabledVisualOnlyState(button, true, reason);
    } else if (!button.disabled) {
      applyDisabledVisualOnlyState(button, false);
    }

    if (isSendBtn) {
      applySendMessageButtonColorClasses(button, phase, { allowCancel, busy });
      logSendMessageButtonColor(button, phase, { allowCancel, busy, reason });
    } else {
      logButtonColorState(button, phase, isBusyState, reason);
      auditButtonColorLeak(button);
    }

    return finish(true);
  }

  function setButtonIdle(button, text = '开始', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.IDLE,
      text,
      disabled: false,
      reason: extra.reason || 'idle',
      title: extra.title || '',
      ...extra,
    });
  }

  function setButtonInitializing(button, text = '初始化中', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.INITIALIZING,
      text,
      disabled: true,
      allowCancel: false,
      reason: extra.reason || 'initializing',
      title: extra.title || text,
      ariaBusy: extra.ariaBusy != null ? extra.ariaBusy : false,
      busy: false,
      preserveBaseColorWhenDisabled: extra.preserveBaseColorWhenDisabled !== false,
      ...extra,
    });
  }

  function setButtonWaiting(button, text = '等待中', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.WAITING,
      text,
      allowCancel: true,
      disabled: false,
      reason: extra.reason || 'waiting',
      title: extra.title || text,
      ariaBusy: extra.ariaBusy != null ? extra.ariaBusy : true,
      ...extra,
    });
  }

  function setButtonRunning(button, text = '运行中', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.RUNNING,
      text,
      allowCancel: extra.allowCancel !== false,
      disabled: false,
      reason: extra.reason || 'running',
      title: extra.title || text,
      ariaBusy: extra.ariaBusy != null ? extra.ariaBusy : true,
      ...extra,
    });
  }

  function setButtonSending(button, text = '发送中', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.SENDING,
      text,
      allowCancel: true,
      disabled: false,
      reason: extra.reason || 'sending',
      title: extra.title || text,
      ariaBusy: extra.ariaBusy != null ? extra.ariaBusy : true,
      ...extra,
    });
  }

  function setButtonDanger(button, text = '停止', extra = {}) {
    const usePermanentDanger = extra.permanentDanger === true;
    return setToolboxButtonState(button, {
      ...extra,
      phase: usePermanentDanger ? ButtonPhase.DANGER : ButtonPhase.RUNNING,
      text,
      disabled: false,
      allowCancel: extra.allowCancel !== false,
      reason: extra.reason || 'danger',
      title: extra.title || text,
      permanentDanger: usePermanentDanger,
      busy: !usePermanentDanger,
    });
  }

  function setButtonSuccess(button, text = '成功', extra = {}) {
    return setButtonIdle(button, text, {
      reason: extra.reason || 'success-as-idle',
      title: extra.title || text,
      disabled: extra.disabled === true,
      ...extra,
    });
  }

  function setButtonCancelled(button, text = '已取消', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.CANCELLED,
      text,
      disabled: false,
      reason: extra.reason || 'cancelled',
      title: extra.title || text,
      ...extra,
    });
  }

  function setButtonFailed(button, text = '失败', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.FAILED,
      text,
      disabled: false,
      reason: extra.reason || 'failed',
      title: extra.title || text,
      ...extra,
    });
  }

  const FLASH_RESTORE_TERMINAL_PHASES = new Set([
    ButtonPhase.SUCCESS,
    ButtonPhase.FAILED,
    ButtonPhase.CANCELLED,
    ButtonPhase.COMPLETED,
    'success',
    'failed',
    'cancelled',
    'completed',
  ]);

  function logFlashRestoreSkip(button, reason, extra = {}) {
    const action = getButtonActionId(button);
    const parts = Object.entries(extra)
      .map(([key, value]) => `${key}=${value == null ? '-' : value}`)
      .join(' ');
    const line = `[BUTTON_STATE][FLASH_RESTORE_SKIP] reason=${reason || 'guard-failed'} action=${action}${parts ? ` ${parts}` : ''}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function flashButtonThenIdle(button, flashFn, flashText, idleText, delayMs = 1200, options = {}) {
    if (!button || typeof flashFn !== 'function') {
      return;
    }

    const guard = options && typeof options === 'object' ? options : {};
    const expectedRunId = guard.expectedRunId != null ? String(guard.expectedRunId) : '';
    const getCurrentRunId = typeof guard.getCurrentRunId === 'function' ? guard.getCurrentRunId : null;
    const getCurrentPhase = typeof guard.getCurrentPhase === 'function' ? guard.getCurrentPhase : null;
    const flashAt = Date.now();

    setButtonIdle(button, idleText, { reason: 'flash-skip-success-color' });
    logButtonStateRestore(button, expectedRunId, ButtonPhase.IDLE);
    window.setTimeout(() => {
      if (!button || !button.isConnected) {
        logFlashRestoreSkip(button, 'guard-failed', { detail: 'not-connected' });
        return;
      }

      if (expectedRunId && getCurrentRunId) {
        const currentRunId = String(getCurrentRunId() || '').trim();
        if (currentRunId && currentRunId !== expectedRunId) {
          logFlashRestoreSkip(button, 'guard-failed', {
            expectedRunId,
            currentRunId,
          });
          return;
        }
      }

      if (getCurrentPhase) {
        const currentPhase = String(getCurrentPhase() || '').trim().toLowerCase();
        if (currentPhase && !FLASH_RESTORE_TERMINAL_PHASES.has(currentPhase)) {
          logFlashRestoreSkip(button, 'guard-failed', {
            currentPhase,
            flashAgeMs: Date.now() - flashAt,
          });
          return;
        }
      }

      setButtonIdle(button, idleText, { reason: 'flash-restore' });
      logButtonStateRestore(button, expectedRunId || '', ButtonPhase.IDLE);
    }, delayMs);
  }

  const CANCELLABLE_UI_TEXT_MARKERS = ['取消', '停止'];

  function textImpliesCancellable(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return false;
    }
    return CANCELLABLE_UI_TEXT_MARKERS.some((marker) => normalized.includes(marker));
  }

  const shortActionButtonRestoreTimers = new WeakMap();

  function resolveShortActionButton(button, fallbackSelector = '') {
    if (button instanceof HTMLElement) {
      return button;
    }
    if (typeof document !== 'undefined' && fallbackSelector) {
      const found = document.querySelector(fallbackSelector);
      return found instanceof HTMLElement ? found : null;
    }
    return null;
  }

  function setShortActionButtonBusy(button, text, options = {}) {
    const btn = resolveShortActionButton(button, options.selector || '');
    if (!btn) {
      return null;
    }

    const action = String(options.action || '').trim();
    const idleText = String(
      options.idleText
      || btn.dataset.cgptShortActionIdleText
      || btn.textContent
      || '',
    ).trim() || '操作';
    if (!btn.dataset.cgptShortActionIdleText) {
      btn.dataset.cgptShortActionIdleText = idleText;
    }
    markButtonStableLabel(btn, idleText);

    const prevTimer = shortActionButtonRestoreTimers.get(btn);
    if (prevTimer) {
      window.clearTimeout(prevTimer);
      shortActionButtonRestoreTimers.delete(btn);
    }

    btn.dataset.cgptShortActionBusy = '1';
    btn.classList.add('cgpt-btn-busy', 'cgpt-btn-danger', 'cgpt-short-action-busy', 'cgpt-action-button-active');
    const busyText = String(text || '处理中');
    if (isStableActionButton(btn)) {
      applyStableActionButtonLabel(btn, idleText, busyText);
    } else {
      btn.textContent = busyText;
      delete btn.dataset.cgptStatusText;
    }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');

    const line = `[SHORT_ACTION_BUTTON][BUSY] action=${action || '-'} id=${btn.id || '-'} text=${btn.textContent}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    return btn;
  }

  function restoreShortActionButton(button, options = {}) {
    const btn = resolveShortActionButton(button, options.selector || '');
    if (!btn) {
      return;
    }

    const idleText = String(
      options.idleText
      || btn.dataset.cgptShortActionIdleText
      || '操作',
    ).trim() || '操作';

    const prevTimer = shortActionButtonRestoreTimers.get(btn);
    if (prevTimer) {
      window.clearTimeout(prevTimer);
      shortActionButtonRestoreTimers.delete(btn);
    }

    btn.classList.remove(
      'cgpt-btn-busy',
      'cgpt-btn-danger',
      'cgpt-short-action-busy',
      'cgpt-btn-failed',
      'cgpt-action-button-active',
    );
    delete btn.dataset.cgptShortActionBusy;
    delete btn.dataset.cgptStatusText;
    btn.textContent = getStableButtonText(btn, { text: idleText }) || idleText;
    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-busy');

    const line = `[SHORT_ACTION_BUTTON][RESTORE] id=${btn.id || '-'} text=${idleText}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function scheduleRestoreShortActionButton(button, delayMs, options = {}) {
    const btn = resolveShortActionButton(button, options.selector || '');
    if (!btn) {
      return;
    }

    const prevTimer = shortActionButtonRestoreTimers.get(btn);
    if (prevTimer) {
      window.clearTimeout(prevTimer);
    }

    const timer = window.setTimeout(() => {
      shortActionButtonRestoreTimers.delete(btn);
      restoreShortActionButton(btn, options);
    }, Math.max(0, Number(delayMs) || 0));
    shortActionButtonRestoreTimers.set(btn, timer);
  }

  function assertCancellableButtonConsistency(button, view, reason = '') {
    if (!button || !view) {
      return;
    }

    const cancellablePhases = typeof UploadButtonVm !== 'undefined'
      && UploadButtonVm.CANCELLABLE_TASK_PHASES
      ? UploadButtonVm.CANCELLABLE_TASK_PHASES
      : null;

    const phase = String(view.phase || '').trim();
    const shouldStayEnabled = view.allowCancel === true
      || (cancellablePhases && cancellablePhases.has(phase));

    if (shouldStayEnabled && button.disabled) {
      logButtonStateMismatch(button, view, reason || 'cancellable-disabled');
    }

    if (textImpliesCancellable(button.textContent) && !shouldStayEnabled && !view.disabled) {
      logButtonStateMismatch(button, view, reason || 'cancel-text-without-phase');
    }

    const terminalPhases = new Set(['success', 'failed', 'cancelled']);
    if (terminalPhases.has(phase) && textImpliesCancellable(button.textContent)) {
      logButtonStateMismatch(button, view, reason || 'terminal-with-cancel-text');
    }
  }

  const ButtonState = Object.freeze({
    Phase: ButtonPhase,
    getUnifiedButtonAuthoritySnapshot,
    BusyPhases: BUTTON_BUSY_PHASES,
    SendMessageButtonIds: SEND_MESSAGE_BUTTON_IDS,
    SendBtnAllowedColorClasses: SEND_BTN_ALLOWED_COLOR_CLASSES,
    SendBtnLegacyColorClasses: SEND_BTN_LEGACY_COLOR_CLASSES,
    isSendMessageToolboxButton,
    isBatchTaskMainButton,
    mapTaskPhaseToButtonPhase,
    mirrorSendButtonLegacyDataset,
    clearButtonStateClasses,
    clearButtonStateColorClasses,
    applyDisabledVisualOnlyState,
    applySendMessageButtonColorClasses,
    logSendMessageButtonColor,
    auditButtonColorLeak,
    auditSendMessageButtonColorLeak,
    auditHomePageButtonColors,
    isDynamicButtonStatusText,
    isStableActionButton,
    getOrInitStableButtonLabel,
    markButtonStableLabel,
    getStableButtonText,
    setToolboxButtonState,
    setButtonIdle,
    setButtonInitializing,
    setButtonWaiting,
    setButtonRunning,
    setButtonSending,
    setButtonDanger,
    setButtonSuccess,
    setButtonCancelled,
    setButtonFailed,
    setShortActionButtonBusy,
    restoreShortActionButton,
    scheduleRestoreShortActionButton,
    flashButtonThenIdle,
    logButtonStateClick,
    logButtonStateCancel,
    logButtonStateRestore,
    logButtonStateMismatch,
    assertCancellableButtonConsistency,
    resolveButtonAction,
    setButtonRuntimeAction,
    setButtonBaseAction,
    getButtonActionId,
  });
