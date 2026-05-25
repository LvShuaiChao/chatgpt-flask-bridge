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
    CANCELLING: 'cancelling',
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
    ButtonPhase.DANGER,
  ]);

  const BUTTON_STATE_LEGACY_CLASSES = Object.freeze([
    'cgpt-btn-idle',
    'cgpt-btn-waiting',
    'cgpt-btn-running',
    'cgpt-btn-sending',
    'cgpt-btn-success',
    'cgpt-btn-failed',
    'cgpt-btn-danger',
    'cgpt-btn-cancelled',
    'cgpt-btn-disabled',
    'success',
    'danger',
    'warning',
    'busy',
    'cgpt-btn-busy',
    'primary',
    'cgpt-wait-send-cancel',
    'waiting',
    'cgpt-btn-waiting-danger',
    'cgpt-action-running',
    'cgpt-waiting-answer',
  ]);

  function isButtonStateDebugEnabled() {
    if (typeof MemoryManager === 'undefined' || typeof MemoryManager.get !== 'function') {
      return false;
    }
    return !!MemoryManager.get('bridgeDebugEnabled', false);
  }

  function getButtonActionId(button) {
    if (!button) {
      return '-';
    }
    return String(
      button.dataset.cgptAction
      || button.dataset.action
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

  function clearButtonStateClasses(button) {
    if (!button) {
      return;
    }
    BUTTON_STATE_LEGACY_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
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
    } = options;

    const oldPhase = button.dataset.cgptButtonPhase || '-';
    const nextText = text != null ? String(text) : '';
    const nextTitle = title != null ? String(title) : '';

    clearButtonStateClasses(button);

    if (nextText) {
      button.textContent = nextText;
    }

    if (nextTitle) {
      button.title = nextTitle;
    }

    button.dataset.cgptButtonPhase = phase;

    if (ariaBusy != null) {
      button.setAttribute('aria-busy', ariaBusy ? 'true' : 'false');
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

    if (phase === ButtonPhase.IDLE) {
      button.classList.add('cgpt-btn-idle');
      button.disabled = Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (phase === ButtonPhase.WAITING) {
      button.classList.add('cgpt-btn-waiting');
      button.disabled = !allowCancel && Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (phase === ButtonPhase.RUNNING) {
      button.classList.add('cgpt-btn-running');
      button.disabled = !allowCancel && Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (
      phase === ButtonPhase.UPLOADING
      || phase === ButtonPhase.WAITING_SEND
      || phase === ButtonPhase.WAITING_REPLY
      || phase === ButtonPhase.COPYING
      || phase === ButtonPhase.CANCELLING
    ) {
      button.classList.add(`cgpt-btn-${phase}`);
      const canCancel = allowCancel || BUTTON_PHASE_ALLOW_CANCEL.has(phase);
      button.disabled = !canCancel && Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (phase === ButtonPhase.COMPLETED) {
      button.classList.add('cgpt-btn-success');
      button.disabled = Boolean(disabled);
      return true;
    }

    if (phase === ButtonPhase.SENDING) {
      button.classList.add('cgpt-btn-sending');
      button.disabled = !allowCancel && Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (phase === ButtonPhase.SUCCESS) {
      button.classList.add('cgpt-btn-success');
      button.disabled = Boolean(disabled);
      return true;
    }

    if (phase === ButtonPhase.FAILED) {
      button.classList.add('cgpt-btn-failed');
      button.disabled = Boolean(disabled);
      return true;
    }

    if (phase === ButtonPhase.DANGER) {
      button.classList.add('cgpt-btn-danger');
      button.disabled = Boolean(disabled);
      if (!button.disabled) {
        button.removeAttribute('disabled');
      }
      return true;
    }

    if (phase === ButtonPhase.CANCELLED) {
      button.classList.add('cgpt-btn-cancelled');
      button.disabled = Boolean(disabled);
      return true;
    }

    if (phase === ButtonPhase.DISABLED) {
      button.classList.add('cgpt-btn-disabled');
      button.disabled = true;
      return true;
    }

    return true;
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

  function setButtonWaiting(button, text = '等待中，点击取消', extra = {}) {
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

  function setButtonRunning(button, text = '运行中，点击停止', extra = {}) {
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

  function setButtonSending(button, text = '发送中，点击取消', extra = {}) {
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
    return setToolboxButtonState(button, {
      phase: ButtonPhase.DANGER,
      text,
      disabled: false,
      reason: extra.reason || 'danger',
      title: extra.title || text,
      ...extra,
    });
  }

  function setButtonSuccess(button, text = '成功', extra = {}) {
    return setToolboxButtonState(button, {
      phase: ButtonPhase.SUCCESS,
      text,
      disabled: extra.disabled === true,
      reason: extra.reason || 'success',
      title: extra.title || text,
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

  function flashButtonThenIdle(button, flashFn, flashText, idleText, delayMs = 1200) {
    if (!button || typeof flashFn !== 'function') {
      return;
    }
    flashFn(button, flashText, { reason: 'flash' });
    window.setTimeout(() => {
      if (button && button.isConnected) {
        setButtonIdle(button, idleText, { reason: 'flash-restore' });
        logButtonStateRestore(button, '', ButtonPhase.IDLE);
      }
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
    clearButtonStateClasses,
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
    getButtonActionId,
  });
