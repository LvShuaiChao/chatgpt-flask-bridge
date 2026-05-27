  /********************************************************************
   * ButtonState：工具箱按鈕 UI 狀態單一來源（文字 / 顏色 / disabled / phase）
   ********************************************************************/

  const ButtonPhase = Object.freeze({
    IDLE: 'idle',
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

  const CANCELLABLE_BUTTON_ACTIONS = new Set([
    'cancel-send',
    'cancel-wait-reply',
    'stop-upload',
    'cancel-current-task',
    'cancel',
    'stop',
  ]);

  const BUTTON_BUSY_PHASES = new Set([
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
    '等待输入框',
    '等待附件',
    '检查中',
    '发送中',
    '等待回复',
    '取消中',
  ]);

  const TASK_PHASE_TO_BUTTON_PHASE = Object.freeze({
    idle: ButtonPhase.IDLE,
    waiting: ButtonPhase.WAITING,
    uploading: ButtonPhase.UPLOADING,
    waiting_send: ButtonPhase.WAITING_SEND,
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
      || button.dataset.cgptButtonAction
      || '',
    ).trim();
    const effectiveAction = runtimeAction || baseAction || domAction;

    return {
      baseAction,
      runtimeAction,
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
      button.dataset.cgptButtonAction = value;
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

  function clearButtonStateClasses(button) {
    clearButtonStateColorClasses(button);
  }

  function isSendMessageToolboxButton(button) {
    if (!button) {
      return false;
    }
    return SEND_MESSAGE_BUTTON_IDS.has(String(button.id || '').trim());
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
    if (!normalized || SEND_BTN_ALLOWED_TEXTS.has(normalized)) {
      return normalized;
    }
    return '发送消息';
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
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
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
    buttons.forEach((button) => {
      if (isSendMessageToolboxButton(button)) {
        auditSendMessageButtonColorLeak(button);
      } else {
        auditButtonColorLeak(button);
      }
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
    let nextText = text != null ? String(text) : '';
    const nextTitle = title != null ? String(title) : '';

    if (isSendBtn && nextText) {
      nextText = sanitizeSendMessageButtonText(nextText);
    }

    const isBusyState = isSendBtn
      ? isSendMessageButtonBusy(phase, { allowCancel, busy })
      : isButtonBusyPhase(phase, { busy });
    const usePermanentDanger = phase === ButtonPhase.DANGER && permanentDanger === true;
    const preserveDisabledIdleColor = preserveBaseColorWhenDisabled === true
      && phase === ButtonPhase.IDLE
      && disabled === true;

    if (!preserveDisabledIdleColor) {
      clearButtonStateColorClasses(button);
      if (!isSendBtn) {
        button.classList.toggle('cgpt-btn-busy', isBusyState && !usePermanentDanger);
        if (usePermanentDanger) {
          button.classList.add('cgpt-btn-danger');
        }
      }
    }

    if (nextText) {
      button.textContent = nextText;
    }

    if (nextTitle) {
      button.title = nextTitle;
    }

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
    const looksDangerAction =
      nextText.includes('删除')
      || nextText.includes('清空')
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
      if (phase === ButtonPhase.FAILED) {
        button.classList.add('cgpt-btn-failed');
      } else if (phase === ButtonPhase.CANCELLED) {
        button.classList.add('cgpt-btn-cancelled');
      } else if (phase === ButtonPhase.DISABLED) {
        button.classList.add('cgpt-btn-disabled');
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
    BusyPhases: BUTTON_BUSY_PHASES,
    SendMessageButtonIds: SEND_MESSAGE_BUTTON_IDS,
    SendBtnAllowedColorClasses: SEND_BTN_ALLOWED_COLOR_CLASSES,
    SendBtnLegacyColorClasses: SEND_BTN_LEGACY_COLOR_CLASSES,
    isSendMessageToolboxButton,
    mapTaskPhaseToButtonPhase,
    mirrorSendButtonLegacyDataset,
    clearButtonStateClasses,
    clearButtonStateColorClasses,
    applySendMessageButtonColorClasses,
    logSendMessageButtonColor,
    auditButtonColorLeak,
    auditSendMessageButtonColorLeak,
    auditHomePageButtonColors,
    setToolboxButtonState,
    setButtonIdle,
    setButtonWaiting,
    setButtonRunning,
    setButtonSending,
    setButtonDanger,
    setButtonSuccess,
    setButtonCancelled,
    setButtonFailed,
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
