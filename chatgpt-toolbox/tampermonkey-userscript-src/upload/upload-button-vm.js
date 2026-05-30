  /********************************************************************
   * UploadButtonVm：上传区按钮状态判定矩阵（文字 / phase / disabled / action）
   ********************************************************************/

  function buildTaskPhaseEnum() {
    const phases = typeof ButtonTasks !== 'undefined' && Array.isArray(ButtonTasks.AllPhases)
      ? ButtonTasks.AllPhases
      : (typeof ButtonTasks !== 'undefined' && Array.isArray(ButtonTasks.UiPhases)
        ? ButtonTasks.UiPhases
        : []);
    const out = {};
    for (const phase of phases) {
      const key = String(phase || '').trim().toUpperCase().replace(/-/g, '_');
      if (key) {
        out[key] = phase;
      }
    }
    return Object.freeze(out);
  }

  const TaskPhase = buildTaskPhaseEnum();

  function logButtonViewStateGuard(buttonName, ownPhase, view, snapshot = {}, capability = {}) {
    if (!view || typeof view !== 'object') {
      const errMsg = `[BUTTON_VIEW_STATE][GUARD_ERROR] button=${buttonName} ownPhase=${ownPhase || '-'} reason=invalid-view`;
      console.error(errMsg);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(errMsg);
      }
      return view;
    }

    const result = view;
    const renderPhase = String(result.phase || '').trim();
    const text = String(result.text || '').trim();
    const pageReplyBusy = typeof isEffectiveReplyBusy === 'function'
      ? isEffectiveReplyBusy(snapshot, capability)
      : false;

    if (
      pageReplyBusy
      && String(ownPhase || '').trim() === TaskPhase.IDLE
      && renderPhase === TaskPhase.WAITING_REPLY
    ) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_VIEW][WRONG_GLOBAL_BUSY_LEAK] button=${buttonName || '-'} ownPhase=${ownPhase || '-'} pageReplyBusy=1 renderPhase=${renderPhase} text=${text || '-'}`,
        );
      }
    }

    return result;
  }

  const WAITING_REPLY_OWNER_ALIASES = Object.freeze({
    'copy-and-continue': ['copy-continue'],
    'copy-continue': ['copy-and-continue'],
    'copy-only': ['copy-last-reply'],
    'copy-last-reply': ['copy-only'],
  });

  const OWNER_SENSITIVE_BUSY_ACTIONS = new Set([
    'send-message',
    'auto-continue',
    'auto-continue-until-done',
  ]);

  function actionsMatchWaitingReplyOwner(action, owner) {
    const normalizedAction = String(action || '').trim();
    const normalizedOwner = String(owner || '').trim();
    if (!normalizedAction || !normalizedOwner) {
      return false;
    }
    if (normalizedAction === normalizedOwner) {
      return true;
    }
    const aliases = WAITING_REPLY_OWNER_ALIASES[normalizedOwner] || [];
    return aliases.includes(normalizedAction);
  }

  function isViewShowingWaitingReply(view = {}) {
    const phase = normalizeTaskPhase(view.phase);
    const text = String(view.text || '').trim();
    return phase === TaskPhase.WAITING_REPLY || text === '等待回复';
  }

  function isViewShowingOwnerExclusiveBusy(view = {}) {
    if (isViewShowingWaitingReply(view)) {
      return true;
    }
    const phase = normalizeTaskPhase(view.phase);
    const buttonPhase = String(view.buttonPhase || 'idle').trim().toLowerCase();
    const busyTaskPhases = new Set([
      TaskPhase.CANCELLING,
      TaskPhase.RUNNING,
      TaskPhase.SENDING,
      TaskPhase.WAITING_SEND,
      TaskPhase.WAITING_REPLY,
      TaskPhase.WAITING_PAGE_REPLY_TO_SEND,
    ]);
    if (busyTaskPhases.has(phase)) {
      return true;
    }
    const busyButtonPhases = new Set([
      'waiting',
      'running',
      'sending',
      'waiting_reply',
      'cancelling',
    ]);
    if (busyButtonPhases.has(buttonPhase)) {
      return true;
    }
    if (
      view.allowCancel === true
      && (
        view.action === 'stop'
        || view.action === 'cancel-wait-reply'
        || view.action === 'cancel-send'
        || view.action === 'cancel-send-copy-hotkey'
      )
    ) {
      return true;
    }
    return false;
  }

  function logButtonOwnerResolve(owner, phase, source) {
    const line = `[BUTTON_OWNER][RESOLVE] owner=${owner || '-'} phase=${phase || '-'} source=${source || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonOwnerSuppress(action, owner, reason) {
    const line = `[BUTTON_OWNER][SUPPRESS] action=${action || '-'} owner=${owner || '-'} reason=${reason || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  const CLOSED_LOOP_LOCKED_TITLE = '当前闭环运行中，暂不可用';

  function getToolboxRunningOwnerFromRuntime(runtimeState = {}) {
    if (runtimeState.runningOwner && typeof runtimeState.runningOwner === 'object') {
      return runtimeState.runningOwner;
    }
    if (typeof window !== 'undefined' && window.__cgptToolboxRunningOwner) {
      return window.__cgptToolboxRunningOwner;
    }
    return null;
  }

  function getClosedLoopOwnerFromSnapshot(snapshot = {}) {
    return ClosedLoopButtonVm.getClosedLoopOwnerFromSnapshot(snapshot);
  }

  function getClosedLoopOwnerActionFromSnapshot(snapshot = {}) {
    return ClosedLoopButtonVm.getClosedLoopOwnerActionFromSnapshot(snapshot);
  }

  function resolveClosedLoopOwnerAction(snapshot = {}) {
    return ClosedLoopButtonVm.resolveClosedLoopOwnerAction(snapshot);
  }

  function isClosedLoopOwnerAction(action, snapshot = {}) {
    return ClosedLoopButtonVm.isClosedLoopOwnerAction(action, snapshot);
  }

  function resolveActionForClosedLoopMode(mode) {
    return ClosedLoopButtonVm.resolveActionForClosedLoopMode(mode);
  }

  function isClosedLoopStopLikeText(text) {
    return ClosedLoopButtonVm.isClosedLoopStopLikeText(text);
  }

  function isClosedLoopLikeText(text) {
    return ClosedLoopButtonVm.isClosedLoopLikeText(text);
  }

  function isKnownPollutedButtonText(text) {
    const t = String(text || '').trim();
    return t === '停止环继续'
      || t === '无限继统'
      || t === '环-快捷键模式+每轮上传'
      || t === '环-快捷键模式+每一轮上传'
      || t === '环-仅对话+每5轮上传';
  }

  const CLOSED_LOOP_BUTTON_ACTIONS = ClosedLoopButtonVm.CLOSED_LOOP_BUTTON_ACTIONS;
  const CLOSED_LOOP_BUTTON_IDS = ClosedLoopButtonVm.CLOSED_LOOP_BUTTON_IDS;
  const CLOSED_LOOP_BUTTON_GROUP = ClosedLoopButtonVm.CLOSED_LOOP_BUTTON_GROUP || 'closed-loop';

  const CLOSED_LOOP_LEGACY_INHERITED_COLOR_CLASSES = [
    'purple',
    'cyan',
    'teal',
    'green',
    'primary',
    'warning',
    'orange',
    'cgpt-btn-copy-hotkey',
    'cgpt-btn-upload',
    'cgpt-auto-continue',
  ];

  const CLOSED_LOOP_TOGGLE_STATE_CLASSES = [
    'cgpt-btn-closed-loop',
    'cgpt-btn-closed-loop-idle',
    'cgpt-btn-danger',
    'cgpt-btn-stop',
    'cgpt-action-running',
  ];

  const CLOSED_LOOP_IDLE_CLASS_NAME = 'cgpt-btn cgpt-btn-closed-loop cgpt-btn-closed-loop-idle';
  const CLOSED_LOOP_RUNNING_CLASS_NAME = 'cgpt-btn cgpt-btn-closed-loop cgpt-btn-danger cgpt-btn-stop cgpt-action-running';

  function stripClosedLoopLegacyColorClasses(button) {
    if (!button) {
      return;
    }
    CLOSED_LOOP_LEGACY_INHERITED_COLOR_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
  }

  function applyClosedLoopButtonClassName(button, className) {
    if (!button) {
      return;
    }
    stripClosedLoopLegacyColorClasses(button);
    CLOSED_LOOP_TOGGLE_STATE_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
    String(className || '')
      .split(/\s+/)
      .map((cls) => cls.trim())
      .filter(Boolean)
      .forEach((cls) => button.classList.add(cls));
    if (!button.classList.contains('cgpt-btn')) {
      button.classList.add('cgpt-btn');
    }
    if (!button.classList.contains('cgpt-btn-closed-loop')) {
      button.classList.add('cgpt-btn-closed-loop');
    }
    button.dataset.cgptButtonGroup = CLOSED_LOOP_BUTTON_GROUP;
  }

  function resolveClosedLoopStyleColorLabel(options = {}, view = {}) {
    if (
      options.phase === ButtonState.Phase.DANGER
      || view.forceDanger === true
      || view.buttonPhase === 'danger'
      || (view.allowCancel === true && view.buttonPhase !== 'closed-loop-idle')
    ) {
      return 'red';
    }
    if (view.disabled === true || options.disabled === true) {
      return 'gray';
    }
    return 'orange';
  }

  function logClosedLoopButtonStyleDecide(button, view = {}, options = {}, extra = {}) {
    if (!button) {
      return;
    }
    const id = String(button.id || '-').trim() || '-';
    const action = String(
      button.dataset.action
      || button.dataset.cgptBaseAction
      || view.action
      || '-',
    ).trim() || '-';
    const running = extra.running === true ? 1 : 0;
    const isOwner = extra.isOwner === true ? 1 : 0;
    const classText = String(button.className || '').trim() || '-';
    const color = resolveClosedLoopStyleColorLabel(options, view);
    const line = `[CLOSED_LOOP_BUTTON][STYLE_DECIDE] id=${id} action=${action} group=closed-loop running=${running} isOwner=${isOwner} class=${classText} color=${color}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  const NORMAL_BUTTON_IDLE_LABELS = Object.freeze({
    'start-upload': '开始上传',
    'send-message': '发送消息',
    'send-copy-hotkey': '发送+复制+快捷键',
    'copy-hotkey-once': '复制+快捷键',
    'copy-and-hotkey': '复制+快捷键',
    'diagnose-upload-entry': '诊断上传入口',
    'copy-and-continue': '复制并继续',
    'copy-continue': '复制并继续',
    'auto-continue': '无限继续',
    'auto-continue-until-done': '无限继续直到完成',
    'copy-only': '复制最后回复',
    'copy-last-reply': '复制最后回复',
    'copy-log': '复制日志',
    'click-new-chat': '回到首页',
    'copy-hotkey-continue': '复制+快捷键+继续',
    'loop-copy-hotkey-continue': '无限连续复制+快捷键+继续',
  });

  function isClosedLoopButtonAction(action) {
    return ClosedLoopButtonVm.isClosedLoopButtonAction(action);
  }

  function isClosedLoopButtonElement(button) {
    return ClosedLoopButtonVm.isClosedLoopButtonElement(button);
  }

  function isClosedLoopModeButton(buttonOrAction) {
    return ClosedLoopButtonVm.isClosedLoopModeButton(buttonOrAction);
  }

  function getClosedLoopIdleTextByAction(action, snapshot = {}) {
    return ClosedLoopButtonVm.getClosedLoopIdleTextByAction(action, snapshot);
  }

  function getNormalButtonIdleLabel(action, fallback = '') {
    const normalized = String(action || '').trim();
    return NORMAL_BUTTON_IDLE_LABELS[normalized] || fallback || normalized || '按钮';
  }

  function isCurrentClosedLoopOwnerButton(action, button, snapshot = {}) {
    return ClosedLoopButtonVm.isCurrentClosedLoopOwnerButton(action, button, snapshot);
  }

  function resolveClosedLoopIdleBusinessText(action, snapshot = {}) {
    return getClosedLoopIdleTextByAction(action, snapshot);
  }

  function isRunningOwnerButton(buttonConfig = {}, runningOwner = null) {
    const owner = runningOwner && typeof runningOwner === 'object' ? runningOwner : {};
    const buttonId = String(buttonConfig.id || buttonConfig.buttonId || '').trim();
    const action = String(buttonConfig.action || '').trim();
    const ownerId = String(owner.buttonId || '').trim();
    const ownerAction = String(owner.action || '').trim();
    return !!(
      (buttonId && ownerId && buttonId === ownerId)
      || (action && ownerAction && action === ownerAction)
    );
  }

  function isStopLikeButtonView(buttonConfig = {}, runtimeState = {}) {
    const action = String(
      buttonConfig.runtimeAction
      || buttonConfig.action
      || '',
    ).trim().toLowerCase();
    const text = String(buttonConfig.text || '').trim();
    return action.includes('stop')
      || action.includes('cancel')
      || text.includes('停止');
  }

  function resolveUnifiedButtonVisualState(buttonConfig = {}, runtimeState = {}) {
    const action = String(buttonConfig.action || '').trim();
    const id = String(buttonConfig.id || buttonConfig.buttonId || '').trim();
    const text = String(buttonConfig.text || '').trim();
    const phase = String(runtimeState.phase || '').trim().toLowerCase();
    const buttonPhase = String(runtimeState.buttonPhase || '').trim().toLowerCase();
    const runningOwner = getToolboxRunningOwnerFromRuntime(runtimeState);
    const closedLoopRunning = !!(runtimeState.closedLoopRunning);
    const isCurrentOwner = isRunningOwnerButton({ id, action }, runningOwner);
    const isStopAction = isStopLikeButtonView(
      { action, text, runtimeAction: runtimeState.runtimeAction },
      runtimeState,
    );
    const ownerId = runningOwner ? String(runningOwner.buttonId || '-').trim() : '-';
    const isClosedLoopButton = isClosedLoopActionName(action);
    const isClosedLoopOwner = isClosedLoopOwnerAction(action, runtimeState);

    if (closedLoopRunning && isClosedLoopButton && !isClosedLoopOwner) {
      return {
        visual: 'disabled',
        disabled: true,
        reason: 'locked-by-closed-loop-running',
        ownerId: runningOwner && runningOwner.buttonId
          ? String(runningOwner.buttonId).trim()
          : ownerId,
      };
    }

    const shouldBeRedStop = isStopAction
      && (!isClosedLoopStopLikeText(text) || shouldShowClosedLoopStopView(action, { id, action }, runtimeState))
      && (!isClosedLoopButton || isClosedLoopOwner)
      && (
        phase === 'running'
        || phase === 'stopping'
        || buttonPhase === 'running'
        || buttonPhase === 'waiting'
        || (isClosedLoopButton ? isClosedLoopOwner : isCurrentOwner)
      );

    if (shouldBeRedStop) {
      return {
        visual: 'danger',
        disabled: false,
        reason: 'current-task-stop-button',
        ownerId,
      };
    }

    if (closedLoopRunning && !isCurrentOwner) {
      return {
        visual: 'disabled',
        disabled: true,
        reason: 'locked-by-closed-loop-running',
        ownerId,
      };
    }

    if (phase === 'disabled' || buttonPhase === 'disabled') {
      return {
        visual: 'disabled',
        disabled: true,
        reason: 'phase-disabled',
        ownerId,
      };
    }

    if (runtimeState.viewDisabled === true) {
      return {
        visual: 'disabled',
        disabled: true,
        reason: 'view-disabled',
        ownerId,
      };
    }

    return {
      visual: 'normal',
      disabled: false,
      reason: 'normal',
      ownerId,
    };
  }

  function logButtonColorStopOwner(button, buttonConfig = {}, runtimeState = {}, unified = {}) {
    const id = String(button && button.id ? button.id : buttonConfig.id || '-').trim() || '-';
    const action = String(buttonConfig.action || '-').trim() || '-';
    const phase = String(runtimeState.phase || buttonPhaseFromView(runtimeState) || '-').trim() || '-';
    const line = `[BUTTON_COLOR][STOP_OWNER] id=${id} action=${action} phase=${phase} reason=${unified.reason || 'current-task-stop-button'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function buttonPhaseFromView(view = {}) {
    return String(view.buttonPhase || view.phase || '-').trim() || '-';
  }

  function logButtonColorLockedKeepColor(button, buttonConfig = {}, unified = {}) {
    const id = String(button && button.id ? button.id : buttonConfig.id || '-').trim() || '-';
    const action = String(buttonConfig.action || '-').trim() || '-';
    const line = `[BUTTON_COLOR][LOCKED_KEEP_COLOR] id=${id} action=${action} reason=${unified.reason || 'locked-by-closed-loop-running'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonColorFixStopDisabled(button, buttonConfig = {}, oldDisabled = false) {
    const id = String(button && button.id ? button.id : buttonConfig.id || '-').trim() || '-';
    const action = String(buttonConfig.action || '-').trim() || '-';
    const line = `[BUTTON_COLOR][FIX_STOP_DISABLED] id=${id} action=${action} oldDisabled=${oldDisabled ? 1 : 0} newDisabled=0 reason=stop-button-must-be-clickable`;
    console.warn(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function buildClosedLoopLockedView(action, snapshot = {}) {
    const normalized = String(action || '').trim();
    const idleText = isClosedLoopButtonAction(normalized)
      ? getClosedLoopIdleTextByAction(normalized, snapshot)
      : getNormalButtonIdleLabel(normalized, '按钮');
    return {
      phase: TaskPhase.IDLE,
      text: idleText,
      title: CLOSED_LOOP_LOCKED_TITLE,
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'idle',
      preserveBaseColorWhenDisabled: true,
      lockedByClosedLoop: true,
    };
  }

  const CLOSED_LOOP_STOP_VISUAL_CLASSES = [
    'danger',
    'cgpt-btn-danger',
    'cgpt-btn-stop',
    'cgpt-btn-running',
    'cgpt-btn-busy',
    'cgpt-btn-failed',
    'cgpt-btn-waiting-danger',
  ];

  function clearClosedLoopStopVisualClasses(button) {
    if (!button) {
      return;
    }
    CLOSED_LOOP_STOP_VISUAL_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
  }

  function applyUnifiedButtonVisualState(button, view, snapshot = {}, canonicalAction = '') {
    if (!button || !view || typeof view !== 'object') {
      return view;
    }

    const normalizedAction = String(canonicalAction || '').trim();
    if (
      normalizedAction === 'copy-log'
      || normalizedAction === 'copy-error-log'
    ) {
      return view;
    }

    const runtimeState = {
      ...snapshot,
      phase: normalizeTaskPhase(view.phase),
      buttonPhase: String(view.buttonPhase || '').trim().toLowerCase(),
      closedLoopRunning: !!snapshot.closedLoopContinueRunning,
      runningOwner: getToolboxRunningOwnerFromRuntime(snapshot),
      viewDisabled: !!view.disabled,
      runtimeAction: String(view.runtimeAction || view.action || '').trim(),
    };
    const buttonConfig = {
      id: button.id || '',
      action: normalizedAction,
      text: String(view.text || '').trim(),
      runtimeAction: runtimeState.runtimeAction,
    };
    const unified = resolveUnifiedButtonVisualState(buttonConfig, runtimeState);
    let nextView = view;

    if (unified.visual === 'danger') {
      if (view.disabled) {
        logButtonColorFixStopDisabled(button, buttonConfig, true);
      }
      nextView = {
        ...view,
        disabled: false,
        allowCancel: true,
        buttonPhase: view.buttonPhase === 'waiting' ? 'waiting' : 'running',
        action: view.action === 'none' ? 'stop' : (view.action || 'stop'),
        preserveBaseColorWhenDisabled: false,
      };
      logButtonColorStopOwner(button, buttonConfig, runtimeState, unified);
      return nextView;
    }

    if (unified.reason === 'locked-by-closed-loop-running') {
      const lockedText = isClosedLoopModeButton(normalizedAction)
        ? getClosedLoopIdleTextByAction(normalizedAction, snapshot)
        : getNormalButtonIdleLabel(normalizedAction, '按钮');
      nextView = {
        ...view,
        phase: TaskPhase.IDLE,
        buttonPhase: 'idle',
        text: lockedText,
        title: CLOSED_LOOP_LOCKED_TITLE,
        disabled: true,
        allowCancel: false,
        action: 'none',
        preserveBaseColorWhenDisabled: true,
        lockedByClosedLoop: true,
      };
      clearClosedLoopStopVisualClasses(button);
      logButtonColorLockedKeepColor(button, buttonConfig, unified);
      return nextView;
    }

    return nextView;
  }

  function isAutoQueueActiveForUploadButton(autoState = {}) {
    const rawPhase = String(autoState.phase || '').trim().toLowerCase();
    const phase = normalizeTaskPhase(rawPhase);
    return !!(
      autoState.running
      || autoState.waitingReply
      || autoState.cancelling
      || autoState.stopRequested
      || phase === TaskPhase.WAITING_REPLY
      || phase === TaskPhase.RUNNING
      || phase === TaskPhase.SENDING
      || phase === TaskPhase.WAITING_SEND
      || [
        'preparing',
        'uploading',
        'upload_attached',
        'sent',
        'reply_ready',
      ].includes(rawPhase)
    );
  }

  function resolveAutoQueueOwnerAction(autoState = {}) {
    if (!isAutoQueueActiveForUploadButton(autoState)) {
      return '';
    }
    return autoState.continueUntilDoneStrict === true
      ? 'auto-continue-until-done'
      : 'auto-continue';
  }

  function getCurrentAutoQueueOwnerAction() {
    if (
      typeof AutoQueueModule === 'undefined'
      || !AutoQueueModule
      || typeof AutoQueueModule.getState !== 'function'
    ) {
      return '';
    }
    const autoState = AutoQueueModule.getState() || {};
    return resolveAutoQueueOwnerAction(autoState);
  }

  function createIdleBlockedAutoContinueView(text, title) {
    return {
      phase: TaskPhase.IDLE,
      text,
      title,
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'idle',
      preserveBaseColorWhenDisabled: true,
    };
  }

  function resolveIdleBusinessTextForAction(action, snapshot = {}) {
    const normalized = String(action || '').trim();
    if (isClosedLoopButtonAction(normalized)) {
      return getClosedLoopIdleTextByAction(normalized, snapshot);
    }
    if (normalized === 'copy-hotkey-continue') {
      const label = String(snapshot.continueLabel || '').trim();
      if (label && !isClosedLoopLikeText(label) && !isKnownPollutedButtonText(label)) {
        return label;
      }
      return getNormalButtonIdleLabel(normalized);
    }
    if (normalized === 'loop-copy-hotkey-continue') {
      const label = String(snapshot.loopLabel || '').trim();
      if (label && !isClosedLoopLikeText(label) && !isKnownPollutedButtonText(label)) {
        return label;
      }
      return getNormalButtonIdleLabel(normalized);
    }
    if (normalized === 'copy-and-hotkey' || normalized === 'copy-hotkey-once') {
      const label = String(snapshot.onceLabel || '').trim();
      if (label && !isClosedLoopLikeText(label) && !isKnownPollutedButtonText(label)) {
        return label;
      }
      return getNormalButtonIdleLabel(normalized);
    }
    return getNormalButtonIdleLabel(normalized, '按钮');
  }

  function getNormalizedSendTaskPhase(snapshot = {}) {
    const sendTask = snapshot.sendTask && typeof snapshot.sendTask === 'object'
      ? snapshot.sendTask
      : {};
    const rawPhase = String(sendTask.phase || TaskPhase.IDLE).trim().toLowerCase();
    const rawSubPhase = String(
      (sendTask.subPhase != null ? sendTask.subPhase : sendTask.subphase) || '',
    ).trim().toLowerCase();
    const normalizedPhase = normalizeTaskPhase(rawPhase === 'waiting_ready' ? 'waiting_send' : rawPhase);
    if (normalizedPhase === TaskPhase.WAITING_SEND) {
      if (rawSubPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND) {
        return TaskPhase.WAITING_PAGE_REPLY_TO_SEND;
      }
      if (rawSubPhase === TaskPhase.WAITING_INPUT) {
        return TaskPhase.WAITING_INPUT;
      }
      if (rawSubPhase === TaskPhase.WAITING_ATTACHMENT) {
        return TaskPhase.WAITING_ATTACHMENT;
      }
    }
    return normalizedPhase;
  }

  function isLegacySendPending(snapshot = {}) {
    return !!snapshot.pendingSendAfterReply;
  }

  function isLegacySendWaitingReply(snapshot = {}) {
    return !!snapshot.waitingReply;
  }

  function isLegacyMessageSending(snapshot = {}) {
    return !!snapshot.messageSending;
  }

  function getNormalizedAutoQueuePhase() {
    if (typeof AutoQueueModule === 'undefined' || typeof AutoQueueModule.getState !== 'function') {
      return TaskPhase.IDLE;
    }
    const autoState = AutoQueueModule.getState() || {};
    return normalizeTaskPhase(String(autoState.phase || TaskPhase.IDLE).trim().toLowerCase());
  }

  function isAutoQueueWaitingReplyPhase() {
    return getNormalizedAutoQueuePhase() === TaskPhase.WAITING_REPLY;
  }

  function getNormalizedCopyTaskPhase(snapshot = {}) {
    const copyTask = snapshot.copyTask && typeof snapshot.copyTask === 'object'
      ? snapshot.copyTask
      : {};
    const taskPhase = normalizeTaskPhase(copyTask.phase || TaskPhase.IDLE);
    if (taskPhase && taskPhase !== TaskPhase.IDLE) {
      return taskPhase;
    }

    const legacyStatus = normalizeTaskPhase(snapshot.copyStatus || TaskPhase.IDLE);
    if (legacyStatus && legacyStatus !== TaskPhase.IDLE) {
      return legacyStatus;
    }

    if (snapshot.copyWaiting) {
      return TaskPhase.WAITING_REPLY;
    }

    return taskPhase || TaskPhase.IDLE;
  }

  function resolveWaitingReplyOwner(snapshot = {}, capability = {}) {
    void capability;
    const closedLoopOwner = resolveClosedLoopOwnerAction(snapshot);
    if (closedLoopOwner) {
      logButtonOwnerResolve(closedLoopOwner, 'running', 'closed-loop');
      return closedLoopOwner;
    }

    const autoQueueOwner = getCurrentAutoQueueOwnerAction();
    if (autoQueueOwner) {
      const autoState = (
        typeof AutoQueueModule !== 'undefined'
        && AutoQueueModule
        && typeof AutoQueueModule.getState === 'function'
      )
        ? (AutoQueueModule.getState() || {})
        : {};
      const autoPhase = String(autoState.phase || 'running').trim().toLowerCase();
      logButtonOwnerResolve(autoQueueOwner, autoPhase, 'autoqueue');
      return autoQueueOwner;
    }

    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    // waiting_reply: 已发送，等待 ChatGPT 回复
    // waiting_page_reply_to_send: 页面正在回复，消息尚未真正发送，等待页面空闲后再发
    if (
      sendPhase === TaskPhase.WAITING_REPLY
      || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
      || isLegacySendPending(snapshot)
    ) {
      logButtonOwnerResolve('send-message', sendPhase, 'manual-send');
      return 'send-message';
    }

    const loopTask = snapshot.copyHotkeyContinueLoopTask && typeof snapshot.copyHotkeyContinueLoopTask === 'object'
      ? snapshot.copyHotkeyContinueLoopTask
      : {};
    const loopPhase = String(loopTask.phase || '').trim().toLowerCase();
    if (loopPhase === TaskPhase.WAITING_REPLY) {
      return 'loop-copy-hotkey-continue';
    }

    const copyHotkeyContinueTask = snapshot.copyHotkeyContinueTask && typeof snapshot.copyHotkeyContinueTask === 'object'
      ? snapshot.copyHotkeyContinueTask
      : {};
    if (normalizeTaskPhase(copyHotkeyContinueTask.phase) === TaskPhase.WAITING_REPLY) {
      return 'copy-hotkey-continue';
    }

    const copyContinueTask = snapshot.copyContinueTask && typeof snapshot.copyContinueTask === 'object'
      ? snapshot.copyContinueTask
      : {};
    if (normalizeTaskPhase(copyContinueTask.phase) === TaskPhase.WAITING_REPLY) {
      return 'copy-and-continue';
    }

    if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.getState === 'function') {
      if (isAutoQueueWaitingReplyPhase()) {
        const autoState = AutoQueueModule.getState() || {};
        const resolved = resolveAutoQueueOwnerAction(autoState) || 'auto-continue';
        logButtonOwnerResolve(resolved, TaskPhase.WAITING_REPLY, 'autoqueue');
        return resolved;
      }
    }

    const copyPhase = getNormalizedCopyTaskPhase(snapshot);
    if (copyPhase === TaskPhase.WAITING_REPLY) {
      return 'copy-only';
    }

    return '';
  }

  function suppressNonOwnerWaitingReplyView(action, view, snapshot = {}, button = null, reason = '') {
    const normalizedAction = String(action || '').trim();
    const closedLoopOwner = getClosedLoopOwnerFromSnapshot(snapshot);
    const viewText = String(view && view.text || '').trim();
    if (closedLoopOwner && !isClosedLoopButtonAction(normalizedAction) && !isClosedLoopButtonElement(button)) {
      if (isClosedLoopStopLikeText(viewText) || isClosedLoopLikeText(viewText)) {
        const fixedText = getNormalButtonIdleLabel(normalizedAction, '');
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_STATE][BLOCK_CLOSED_LOOP_LEAK] action=${normalizedAction || '-'} buttonId=${button && button.id ? button.id : '-'} owner=${closedLoopOwner} leakedText=${viewText} fixedText=${fixedText || '-'} reason=${reason || '-'}`,
          );
        }
        return {
          ...(view || {}),
          phase: TaskPhase.IDLE,
          text: fixedText || '按钮',
          title: fixedText || '',
          disabled: snapshot.closedLoopContinueRunning === true,
          allowCancel: false,
          action: snapshot.closedLoopContinueRunning === true ? 'none' : normalizedAction,
          buttonPhase: 'idle',
          preserveBaseColorWhenDisabled: snapshot.closedLoopContinueRunning === true,
        };
      }
    }

    const runningOwner = getToolboxRunningOwnerFromRuntime(snapshot);
    const runtimeAction = String(view && view.action ? view.action : '').trim().toLowerCase();
    if (
      (runtimeAction === 'stop' || runtimeAction === 'cancel' || runtimeAction === 'stop-closed-loop')
      && isRunningOwnerButton({ id: button && button.id, action: normalizedAction }, runningOwner)
    ) {
      if (
        (runtimeAction === 'stop-closed-loop' || isClosedLoopStopLikeText(view && view.text))
        && !shouldShowClosedLoopStopView(normalizedAction, button, snapshot)
      ) {
        return buildOriginalIdleViewForAction(normalizedAction, view);
      }
      return view;
    }

    const needsOwnerCheck = OWNER_SENSITIVE_BUSY_ACTIONS.has(normalizedAction)
      ? isViewShowingOwnerExclusiveBusy(view)
      : isViewShowingWaitingReply(view);
    if (!needsOwnerCheck) {
      return view;
    }

    const owner = String(snapshot.waitingReplyOwner || '').trim()
      || resolveWaitingReplyOwner(snapshot, snapshot.capability);
    const isStrictOwnerMatch = owner && normalizedAction === owner;
    const isAliasOwnerMatch = !OWNER_SENSITIVE_BUSY_ACTIONS.has(normalizedAction)
      && owner
      && actionsMatchWaitingReplyOwner(normalizedAction, owner);
    if (!owner || isStrictOwnerMatch || isAliasOwnerMatch) {
      return view;
    }

    const idleText = resolveIdleBusinessTextForAction(action, snapshot);
    logButtonOwnerSuppress(
      normalizedAction,
      owner,
      reason || 'non-owner-waiting-reply',
    );

    return {
      ...view,
      phase: TaskPhase.IDLE,
      buttonPhase: 'idle',
      disabled: true,
      allowCancel: false,
      action: 'none',
      preserveBaseColorWhenDisabled: true,
      text: idleText,
      title: view.title || '当前有其他任务正在运行，暂不可用',
      suppressedWaitingReply: true,
    };
  }

  const GENERIC_BUTTON_RUNTIME_ACTIONS = new Set(['start', 'cancel', 'stop', 'none']);

  const UPLOAD_BUTTON_BUSINESS_ACTIONS = new Set([
    'send-message',
    'cancel-send',
    'cancel-wait-reply',
    'start-upload',
    'cancel-upload',
    'copy-and-hotkey',
    'copy-and-continue',
    'copy-hotkey-continue',
    'loop-copy-hotkey-continue',
    'auto-continue',
    'auto-continue-until-done',
    'click-new-chat',
    'closed-loop-upload-continue-hotkey',
    'closed-loop-upload-continue',
    'closed-loop-with-hotkey',
    'closed-loop-with-hotkey-upload-every-round',
    'closed-loop-without-hotkey',
    'copy-only',
    'copy-last-reply',
    'send-hotkey',
    'send-copy-hotkey',
    'cancel-send-copy-hotkey',
    'copy-hotkey-once',
    'copy-continue',
    'copy-log',
    'copy-error-log',
  ]);

  function isUploadButtonBusinessAction(action) {
    const normalized = String(action || '').trim();
    return normalized !== '' && UPLOAD_BUTTON_BUSINESS_ACTIONS.has(normalized);
  }

  function isGenericButtonRuntimeAction(action) {
    const normalized = String(action || '').trim();
    return GENERIC_BUTTON_RUNTIME_ACTIONS.has(normalized);
  }

  const UPLOAD_BUTTON_ID_TO_BASE_ACTION = Object.freeze({
    'cgpt-upload-start': 'start-upload',
    'cgpt-autoq-start-upload': 'start-upload',
    'cgpt-copy-hotkey-once': 'copy-and-hotkey',
    'cgpt-upload-continue-once': 'copy-and-continue',
    'cgpt-send-message-once': 'send-message',
    'cgpt-send-message-btn': 'send-message',
    'cgpt-open-chatgpt-home': 'click-new-chat',
    'cgpt-auto-continue-once': 'auto-continue',
    'cgpt-auto-continue-until-done': 'auto-continue-until-done',
    'cgpt-copy-last-message-scroll-bottom': 'copy-only',
    'cgpt-copy-hotkey-continue-once': 'copy-hotkey-continue',
    'cgpt-copy-hotkey-continue-loop': 'loop-copy-hotkey-continue',
    'cgpt-closed-loop-upload-every5-hotkey-btn': 'closed-loop-with-hotkey',
    'cgpt-closed-loop-upload-every-round-hotkey-btn': 'closed-loop-with-hotkey-upload-every-round',
    'cgpt-closed-loop-upload-every5-btn': 'closed-loop-without-hotkey',
  });

  function resolveButtonIdBaseAction(button) {
    const id = String(button && button.id ? button.id : '').trim();
    return id ? (UPLOAD_BUTTON_ID_TO_BASE_ACTION[id] || '') : '';
  }

  function resolveButtonCanonicalAction(button, applyOptions = {}) {
    if (!button) {
      return '';
    }

    const configAction = String(applyOptions.configAction || applyOptions.baseAction || '').trim();
    const idAction = resolveButtonIdBaseAction(button);
    const domAction = String(button.dataset.action || '').trim();
    const existingBase = String(button.dataset.cgptBaseAction || '').trim();

    if (!existingBase) {
      const seed = (isUploadButtonBusinessAction(domAction) ? domAction : '')
        || (isUploadButtonBusinessAction(configAction) ? configAction : '')
        || (isUploadButtonBusinessAction(idAction) ? idAction : '')
        || (domAction && !isGenericButtonRuntimeAction(domAction) ? domAction : '')
        || configAction
        || idAction;
      if (seed) {
        button.dataset.cgptBaseAction = seed;
      }
    }

    const baseAction = String(button.dataset.cgptBaseAction || configAction || idAction || '').trim();
    if (isUploadButtonBusinessAction(baseAction)) {
      return baseAction;
    }
    if (isUploadButtonBusinessAction(domAction)) {
      return domAction;
    }
    return baseAction || idAction || domAction;
  }

  const CANCELLABLE_TASK_PHASES = typeof ButtonTasks !== 'undefined' && ButtonTasks.CancellablePhases
    ? ButtonTasks.CancellablePhases
    : new Set([
      TaskPhase.UPLOADING,
      TaskPhase.WAITING_SEND,
      TaskPhase.SENDING,
      TaskPhase.WAITING_REPLY,
      TaskPhase.RUNNING,
      TaskPhase.COPYING,
    ]);

  function createRunId(prefix = 'task') {
    if (typeof ButtonTasks !== 'undefined' && typeof ButtonTasks.createTaskRunId === 'function') {
      return ButtonTasks.createTaskRunId(prefix);
    }
    return `${String(prefix || 'task')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeTaskPhase(phase) {
    let value = String(phase || TaskPhase.IDLE).trim().toLowerCase();
    if (value === 'waiting_ready') {
      value = TaskPhase.WAITING_SEND;
    }
    if (value === 'paused') {
      return 'paused';
    }
    return Object.values(TaskPhase).includes(value) ? value : TaskPhase.IDLE;
  }

  function isOwnTaskRunning(task) {
    const phase = normalizeTaskPhase(task && task.phase);
    return phase !== TaskPhase.IDLE
      && phase !== TaskPhase.SUCCESS
      && phase !== TaskPhase.FAILED
      && phase !== TaskPhase.CANCELLED
      && phase !== TaskPhase.DISABLED;
  }

  function isCopyHotkeyLoopPhaseActive(phase) {
    const normalized = String(phase || TaskPhase.IDLE).trim().toLowerCase();
    if (normalized === 'paused') {
      return false;
    }
    return normalized !== TaskPhase.IDLE
      && normalized !== 'stopped'
      && normalized !== TaskPhase.SUCCESS
      && normalized !== TaskPhase.FAILED
      && normalized !== TaskPhase.CANCELLED;
  }

  function resolveSnapshotLoopActive(snapshot, taskKey, activeFlagKey) {
    if (snapshot[activeFlagKey] != null) {
      return !!snapshot[activeFlagKey];
    }
    const task = snapshot[taskKey] && typeof snapshot[taskKey] === 'object'
      ? snapshot[taskKey]
      : {};
    return isCopyHotkeyLoopPhaseActive(task.phase);
  }

  function resolveSnapshotTaskActive(snapshot, taskKey, activeFlagKey) {
    if (snapshot[activeFlagKey] != null) {
      return !!snapshot[activeFlagKey];
    }
    const task = snapshot[taskKey] && typeof snapshot[taskKey] === 'object'
      ? snapshot[taskKey]
      : {};
    const phase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    return phase !== TaskPhase.IDLE
      && phase !== TaskPhase.SUCCESS
      && phase !== TaskPhase.FAILED
      && phase !== TaskPhase.CANCELLED;
  }

  function getCopyHotkeyMutualBlockView(blockedBy) {
    if (blockedBy === 'loop') {
      return {
        phase: TaskPhase.RUNNING,
        text: '连续复制运行中',
        title: '无限连续复制+快捷键+继续正在运行；请先停止该任务后再使用此按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      };
    }

    return {
      phase: TaskPhase.RUNNING,
      text: '复制流程运行中',
      title: '另一复制快捷键任务正在运行；请先停止后再使用此按钮',
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'disabled',
    };
  }

  function formatUploadFailureUserMessage(reason, fallbackMessage = '') {
    const normalized = String(reason || '').trim();
    if (normalized === 'timeout-wait-ready') {
      return '页面上传入口未就绪，已清理上传状态，请重试';
    }
    if (normalized === 'upload_input_not_ready') {
      return '未找到当前输入框的文件上传入口，请刷新页面或重新打开会话';
    }
    if (normalized === 'composer_not_ready' || normalized === 'final-upload-blocked-composer-not-ready') {
      return '页面上传入口未就绪，已清理上传状态，请重试';
    }
    if (normalized === 'no-files') {
      return '本地队列没有可上传文件';
    }
    const fallback = String(fallbackMessage || '').trim();
    return fallback;
  }

  function isUploadTaskPhaseActive(snapshot = {}) {
    const uploadTask = snapshot.uploadTask && typeof snapshot.uploadTask === 'object'
      ? snapshot.uploadTask
      : {};
    const phase = normalizeTaskPhase(uploadTask.phase);
    return phase === TaskPhase.UPLOADING
      || phase === TaskPhase.CANCELLING
      || phase === 'preparing'
      || phase === 'verifying'
      || snapshot.uploadRunning === true;
  }

  function withUploadButtonTaskKey(view = {}) {
    return Object.assign({ taskKey: 'upload' }, view);
  }

  function withSendButtonTaskKey(view = {}) {
    return Object.assign({ taskKey: 'send' }, view);
  }

  function getUploadButtonViewState(snapshot = {}) {
    // 仅依据 uploadTask / uploadRunning / activeFilesCount，禁止读取 waitingSend / waitingReply / messageSending。
    const batchUploadForbiddenReason = String(snapshot.batchUploadForbiddenReason || '').trim();
    if (batchUploadForbiddenReason) {
      const afterInitialManualForbidden = batchUploadForbiddenReason === 'batch-after-initial-manual-upload-forbidden';
      return {
        phase: TaskPhase.DISABLED,
        text: afterInitialManualForbidden ? '继续轮次中' : '批量任务中',
        title: afterInitialManualForbidden
          ? '首轮已发送，批量继续轮次由 AutoQueue 自动调度上传，请勿手动点上传'
          : `当前批量任务状态禁止上传：${batchUploadForbiddenReason}`,
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
        preserveBaseColorWhenDisabled: true,
        taskKey: 'upload',
      };
    }

    if (
      snapshot.batchTaskRunning === true
      && snapshot.batchAfterInitialStrict === true
      && !snapshot.batchAutoUploading
      && Number(snapshot.currentRunSentCount || 0) > 0
    ) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.DISABLED,
        text: '继续轮次中',
        title: '首轮已发送，批量继续轮次由 AutoQueue 自动调度上传，请勿手动点上传',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
      });
    }

    const legacyWaitingReply = !!(
      snapshot.legacyFlags
      && snapshot.legacyFlags.waitingReply
    );

    const sendPhaseWaitingReply = String(
      snapshot.sendTask && snapshot.sendTask.phase || '',
    ).trim() === 'waiting_reply';

    if (legacyWaitingReply || sendPhaseWaitingReply) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.DISABLED,
        text: '等待回复',
        title: '当前正在等待回复，禁止上传，避免打断批量任务',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
      });
    }

    const task = snapshot.uploadTask && typeof snapshot.uploadTask === 'object'
      ? snapshot.uploadTask
      : {};
    const rawUploadPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = normalizeTaskPhase(task.phase);
    const uploadRunning = rawUploadPhase === 'uploading'
      || rawUploadPhase === 'preparing'
      || rawUploadPhase === 'verifying'
      || phase === TaskPhase.CANCELLING;
    const moduleInitState = String(snapshot.moduleInitState || '').trim().toLowerCase();
    const moduleInitError = String(snapshot.moduleInitError || '').trim();

    const batchBlockedReason = String(snapshot.batchBlockedReason || '').trim();
    const batchTaskRunning = snapshot.batchTaskRunning === true;
    const batchBlocksUpload = batchTaskRunning && (
      batchBlockedReason === 'conversation_id_lost'
      || batchBlockedReason === 'batch_conversation_id_not_initialized'
    );

    if (batchBlocksUpload) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.IDLE,
        text: '开始上传',
        title: batchBlockedReason === 'conversation_id_lost'
          ? '批量任务会话已丢失，已禁止上传，避免在首页误发'
          : '批量任务尚未初始化会话，已禁止上传',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'idle',
        preserveBaseColorWhenDisabled: true,
      });
    }

    if (moduleInitState === 'initializing') {
      return withUploadButtonTaskKey({
        phase: TaskPhase.INITIALIZING,
        text: '初始化中',
        title: '上传模块初始化中，请稍候',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'initializing',
      });
    }

    if (moduleInitState === 'failed' && moduleInitError) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.FAILED,
        text: '上传失败，点击重试',
        title: moduleInitError,
        disabled: false,
        allowCancel: false,
        action: 'start-upload',
        buttonPhase: 'failed',
      });
    }

    if (task.cancelRequested || phase === TaskPhase.CANCELLING) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.CANCELLING,
        text: '正在停止',
        title: '正在停止上传，请稍候',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      });
    }

    if (phase === TaskPhase.FAILED || rawUploadPhase === 'failed') {
      const lastError = String(task.error || snapshot.lastRealUploadError || '').trim();
      const failTitle = lastError || '上传失败，点击重新上传';
      return withUploadButtonTaskKey({
        phase: TaskPhase.FAILED,
        text: '上传失败，点击重试',
        title: failTitle,
        disabled: false,
        allowCancel: false,
        action: 'start-upload',
        buttonPhase: 'failed',
      });
    }

    if (phase === TaskPhase.SUCCESS) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.IDLE,
        text: '开始上传',
        title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
        disabled: false,
        allowCancel: false,
        action: 'start-upload',
        buttonPhase: 'idle',
      });
    }

    if (phase === TaskPhase.CANCELLED) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.CANCELLED,
        text: '已取消',
        title: '上传已取消',
        disabled: false,
        allowCancel: false,
        action: 'start-upload',
        buttonPhase: 'cancelled',
      });
    }

    if (task.parentTask === 'copyHotkeyContinueLoop' && uploadRunning) {
      const cycleIndex = Number(task.cycleIndex) || 0;
      const cycleLabel = cycleIndex > 0 ? `第 ${cycleIndex} 轮` : '循环';
      return withUploadButtonTaskKey({
        phase: TaskPhase.UPLOADING,
        text: `${cycleLabel}自动上传中`,
        title: '连续复制循环触发的自动上传，停止请点对应循环按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'waiting',
      });
    }

    if (rawUploadPhase === 'preparing') {
      return withUploadButtonTaskKey({
        phase: 'preparing',
        text: '检查中',
        title: '正在检查本地文件、上传模块和 ChatGPT 上传入口',
        disabled: false,
        allowCancel: true,
        action: 'cancel-upload',
        buttonPhase: 'running',
      });
    }

    if (uploadRunning) {
      return withUploadButtonTaskKey({
        phase: TaskPhase.UPLOADING,
        text: '上传中',
        title: '正在上传当前本地队列中的文件，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'cancel-upload',
        buttonPhase: 'running',
      });
    }
    return withUploadButtonTaskKey({
      phase: TaskPhase.IDLE,
      text: '开始上传',
      title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
      disabled: false,
      allowCancel: false,
      action: 'start-upload',
      buttonPhase: 'idle',
    });
  }

  function getSendMessageButtonViewState(snapshot = {}, capability = {}, hints = {}) {
    const phase = getNormalizedSendTaskPhase(snapshot);

    const failureHintRaw = typeof hints.failureHint === 'string' ? hints.failureHint : '';
    const successHint = typeof hints.successHint === 'string' ? hints.successHint : '';
    const pendingSendAfterReply = !!hints.pendingSendAfterReply;
    const pendingAttachmentWaitSend = !!hints.pendingAttachmentWaitSend;
    const uploadTaskActive = isUploadTaskPhaseActive(snapshot);
    const failureHint = uploadTaskActive && phase === TaskPhase.IDLE ? '' : failureHintRaw;

    capability = capability && typeof capability === 'object' ? capability : {};
    const hasComposer = !!capability.hasComposer;
    const isResponding = !!capability.isResponding;
    const finish = (view) => {
      const withKey = withSendButtonTaskKey(view);
      return typeof logButtonViewStateGuard === 'function'
        ? logButtonViewStateGuard('send-message', phase, withKey, snapshot, capability)
        : withKey;
    };

    const sendMessageTask = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : null;
    if (sendMessageTask && sendMessageTask.running) {
      const taskText = String(sendMessageTask.buttonText || '取消发送').trim() || '取消发送';
      const taskPhase = String(sendMessageTask.phase || '').trim().toLowerCase();
      const isStopView = taskPhase === 'sent_waiting_response'
        || taskPhase === 'stopping_response'
        || (
          !!sendMessageTask.hasClickedNativeSend
          && (phase === TaskPhase.WAITING_REPLY || capability.isResponding)
        );
      return finish({
        phase: isStopView ? TaskPhase.WAITING_REPLY : TaskPhase.WAITING_SEND,
        text: taskText,
        title: isStopView
          ? '消息已发出；再次点击将尝试停止 ChatGPT 当前回答'
          : '发送准备中；再次点击可取消本次发送',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: isStopView ? 'waiting_reply' : 'waiting',
      });
    }

    if (uploadTaskActive && phase === TaskPhase.IDLE && !pendingSendAfterReply) {
      return finish({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        buttonPhase: 'idle',
      });
    }

    if (phase === TaskPhase.CANCELLING) {
      return finish({
        phase: TaskPhase.CANCELLING,
        text: '取消中',
        title: '正在取消发送/等待',
        disabled: false,
        allowCancel: false,
        action: 'cancel-send',
        buttonPhase: 'cancelling',
      });
    }

    if (phase === TaskPhase.WAITING_SEND) {
      const textLen = Number(
        hints.composerTextLen
        || capability.composerTextLen
        || 0,
      );
      const hasAttachment = Boolean(
        (hints.hasAttachment != null ? hints.hasAttachment : null)
        ?? capability.hasAttachment
        ?? capability.hasComposerAttachment
        ?? false,
      );
      const nativeReady = !!(
        capability.canSendNow
        || capability.nativeReadyForClick
        || hints.nativeReadyForClick
      );

      let waitText = '等待发送';
      let waitTitle = '正在等待 ChatGPT 发送按钮可用';

      if (!textLen && !hasAttachment) {
        waitText = '取消发送（等待输入框）';
        waitTitle = '输入框尚未就绪；再次点击可取消发送';
      } else if (hasAttachment && nativeReady) {
        waitText = capability.isResponding ? '取消发送（点击中）' : '取消发送（准备发送）';
        waitTitle = capability.isResponding
          ? '正在进入发送流程；再次点击可取消或停止'
          : '原生发送按钮已可点击；再次点击可取消发送';
      } else if (hasAttachment && (!nativeReady || capability.isResponding)) {
        waitText = '取消发送（等待附件）';
        waitTitle = '附件仍在上传或处理中；再次点击可取消发送';
      } else if (capability.isResponding) {
        waitText = '等待回复';
        waitTitle = '助手正在回复';
      }

      return finish({
        phase: TaskPhase.WAITING_SEND,
        text: waitText,
        title: waitTitle,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: 'waiting',
      });
    }

    if (phase === TaskPhase.SENDING) {
      return finish({
        phase: TaskPhase.SENDING,
        text: '取消发送（点击中）',
        title: '正在发送；再次点击可取消或停止',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: 'sending',
      });
    }

    if (phase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND) {
      return finish({
        phase: TaskPhase.WAITING_PAGE_REPLY_TO_SEND,
        text: '等待页面回复后发送',
        title: '页面正在回答，当前消息尚未发送；等待页面空闲后将自动发送',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: 'waiting',
      });
    }

    if (phase === TaskPhase.WAITING_REPLY) {
      const stopVisible = typeof document !== 'undefined'
        && !!document.querySelector('[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]');
      return finish({
        phase: TaskPhase.WAITING_REPLY,
        text: stopVisible ? '停止回答' : '等待回复',
        title: stopVisible
          ? 'ChatGPT 正在回答；再次点击尝试停止生成'
          : '正在等待 ChatGPT 回复完成',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: 'waiting_reply',
      });
    }

    // idle
    if (pendingAttachmentWaitSend && !capability.nativeReadyForClick) {
      return finish({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: '已检测到输入框中有附件；点击后才开始等待 ChatGPT 发送按钮就绪',
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        buttonPhase: 'idle',
      });
    }

    if (pendingSendAfterReply) {
      return finish({
        phase: TaskPhase.WAITING_PAGE_REPLY_TO_SEND,
        text: '等待页面回复后发送',
        title: '页面正在回答，当前消息尚未发送；等待页面空闲后将自动发送',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        buttonPhase: 'waiting',
      });
    }

    if (failureHint) {
      return finish({
        phase: TaskPhase.FAILED,
        text: '发送失败',
        title: failureHint,
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        buttonPhase: 'failed',
      });
    }

    const canSend = hasComposer || pendingAttachmentWaitSend || !!failureHint || !!successHint;
    if (!canSend || !hasComposer) {
      const hint = failureHint
        || (isResponding ? '助手正在回复，暂不可发送' : '当前页面未检测到可用输入框或发送按钮')
        || (successHint ? '消息已发送' : '');

      if (failureHint) {
        return finish({
          phase: TaskPhase.FAILED,
          text: '发送失败',
          title: hint || '发送失败',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          buttonPhase: 'failed',
        });
      }

      if (successHint) {
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: hint || '发送消息',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          buttonPhase: 'idle',
        });
      }

      return finish({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: hint || '发送消息',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'idle',
      });
    }

    return finish({
      phase: TaskPhase.IDLE,
      text: '发送消息',
      title: isResponding
        ? '助手正在回复，请等待完成后再发送'
        : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
      disabled: false,
      allowCancel: false,
      action: 'send-message',
      buttonPhase: 'idle',
    });
  }

  function getCopyLastReplyButtonViewState(snapshot = {}) {
    const phase = getNormalizedCopyTaskPhase(snapshot);
    const running = phase !== TaskPhase.IDLE
      && phase !== TaskPhase.SUCCESS
      && phase !== TaskPhase.FAILED
      && phase !== TaskPhase.CANCELLED;

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: '复制最后回复',
        title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '复制失败',
        title: '复制最后回复失败',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (running && phase === TaskPhase.WAITING_REPLY) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复后复制',
        title: '正在等待 ChatGPT 回复完成并稳定',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (running && phase === TaskPhase.COPYING) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中',
        title: '正在复制最后回复到剪贴板',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (running) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中',
        title: '正在复制最后回复到剪贴板',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '复制最后回复',
      title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getCopyHotkeyOnceButtonViewState(snapshot = {}) {
    const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
      ? snapshot.copyHotkeyOnceTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = normalizeTaskPhase(rawPhase);
    const onceRunning = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyOnceTask',
      'copyHotkeyOnceActive',
    );
    const continueRunning = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyContinueTask',
      'copyHotkeyContinueActive',
    );
    const loopRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyContinueLoopTask',
      'copyHotkeyLoopActive',
    );
    if (loopRunning) {
      return getCopyHotkeyMutualBlockView('loop');
    }

    if (continueRunning) {
      return getCopyHotkeyMutualBlockView('continue');
    }

    if (snapshot.closedLoopContinueRunning) {
      return buildClosedLoopLockedView('copy-hotkey-once', snapshot);
    }

    if (rawPhase === TaskPhase.CANCELLING || task.cancelRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在取消',
        title: '正在取消复制+快捷键等待任务',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (onceRunning) {
      if (rawPhase === TaskPhase.WAITING_REPLY) {
        return {
          phase: TaskPhase.WAITING_REPLY,
          text: '取消等待',
          title: '正在等待回复完成；再次点击将取消本次复制+快捷键任务',
          disabled: false,
          allowCancel: true,
          action: 'cancel',
          runtimeAction: 'cancel',
          buttonPhase: 'danger',
          forceDanger: true,
          taskKey: 'copyHotkeyOnce',
        };
      }
      return {
        phase: rawPhase || phase || TaskPhase.RUNNING,
        text: '取消执行',
        title: '复制+快捷键流程进行中；再次点击将请求取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'copyHotkeyOnce',
      };
    }

    const pageBusyOnceView = buildPageReplyBusyIdleDisabledView(
      'copy-hotkey-once',
      TaskPhase.IDLE,
      {
        text: snapshot.onceLabel || '复制+快捷键',
        titleWhenBlocked: '当前页面正在回答，暂不可用',
      },
      snapshot,
    );
    if (pageBusyOnceView) {
      return logButtonViewStateGuard('copy-hotkey-once', TaskPhase.IDLE, pageBusyOnceView, snapshot);
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.onceLabel || '复制+快捷键',
      title: snapshot.onceTitle || '复制 ChatGPT 最后一条回复，然后触发内部目标快捷键。',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getSendCopyHotkeyButtonViewState(snapshot = {}) {
    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'waiting_send'
      || rawPhase === 'waiting_ready'
      || rawPhase === 'sending'
      || rawPhase === 'waiting_reply'
      || rawPhase === 'copying'
      || rawPhase === 'sending_hotkey'
      || rawPhase === 'cancelling'
      ? rawPhase
      : normalizeTaskPhase(rawPhase);
    const active = !!snapshot.sendCopyHotkeyActive
      || phase === TaskPhase.RUNNING
      || phase === TaskPhase.WAITING_SEND
      || phase === TaskPhase.WAITING_REPLY
      || phase === TaskPhase.COPYING
      || phase === 'waiting_ready'
      || phase === 'waiting_send'
      || phase === 'sending'
      || phase === 'copying'
      || phase === 'sending_hotkey'
      || phase === 'cancelling';

    if (phase === 'waiting_ready') {
      return {
        phase: TaskPhase.RUNNING,
        text: '等待回答完成',
        title: '正在等待 ChatGPT 完成当前回复，完成后将自动发送并执行复制+快捷键',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        buttonPhase: 'running',
        taskKey: 'send-copy-hotkey',
      };
    }

    if (phase === 'cancelling' || task.cancelRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在停止',
        title: '正在停止发送+复制+快捷键',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
        taskKey: 'send-copy-hotkey',
      };
    }

    if (active) {
      return {
        phase: TaskPhase.RUNNING,
        text: '停止发送+复制+快捷键',
        title: '发送+复制+快捷键正在运行；再次点击将停止当前流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        buttonPhase: 'running',
        taskKey: 'send-copy-hotkey',
      };
    }

    if (phase === TaskPhase.FAILED) {
      const lastError = String(task.lastError || '').trim();
      const failReason = String(task.reason || task.phaseReason || '').trim();
      const softBlocked = lastError.includes('正在回答')
        || lastError.includes('请先点击“开始上传”')
        || lastError.includes('输入框没有可发送内容')
        || failReason.includes('assistant-busy')
        || failReason.includes('need-upload-first')
        || failReason.includes('empty-composer')
        || failReason.includes('send-not-ready');
      if (softBlocked) {
        return {
          phase: TaskPhase.IDLE,
          text: '发送+复制+快捷键',
          title: lastError || '当前条件不满足，修正后可重新点击',
          disabled: false,
          allowCancel: false,
          action: 'send-copy-hotkey',
          buttonPhase: 'idle',
          taskKey: 'send-copy-hotkey',
        };
      }
      return {
        phase: TaskPhase.FAILED,
        text: '发送+复制失败',
        title: task.lastError ? `发送+复制+快捷键失败：${task.lastError}` : '发送+复制+快捷键失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        buttonPhase: 'failed',
        taskKey: 'send-copy-hotkey',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '发送+复制+快捷键',
      title: '先发送当前输入框消息，等待回答完成后复制最后回复并触发目标快捷键',
      disabled: false,
      allowCancel: false,
      action: 'send-copy-hotkey',
      buttonPhase: 'idle',
      taskKey: 'send-copy-hotkey',
    };
  }

  function getSendHotkeyButtonViewState(snapshot = {}) {
    const task = snapshot.sendHotkeyTask && typeof snapshot.sendHotkeyTask === 'object'
      ? snapshot.sendHotkeyTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_hotkey' ? rawPhase : normalizeTaskPhase(rawPhase);

    if (phase === 'sending_hotkey') {
      return {
        phase: 'sending_hotkey',
        text: '发送中...',
        title: '正在请求 GUI 发送目标快捷键',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: snapshot.sendHotkeyLabel || '发送快捷键',
        title: snapshot.sendHotkeyTitle || '发送配置的快捷键',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '发送失败',
        title: task.lastError
          ? `发送失败：${task.lastError}`
          : '发送目标快捷键失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.sendHotkeyLabel || '发送快捷键',
      title: snapshot.sendHotkeyTitle || '发送配置的快捷键',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getCopyHotkeyContinueOnceButtonViewState(snapshot = {}) {
    const task = snapshot.copyHotkeyContinueTask && typeof snapshot.copyHotkeyContinueTask === 'object'
      ? snapshot.copyHotkeyContinueTask
      : {};
    const loopRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyContinueLoopTask',
      'copyHotkeyLoopActive',
    );
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_hotkey' || rawPhase === 'sending_continue'
      ? rawPhase
      : normalizeTaskPhase(rawPhase);

    if (loopRunning) {
      return getCopyHotkeyMutualBlockView('loop');
    }

    if (snapshot.closedLoopContinueRunning) {
      return buildClosedLoopLockedView('copy-hotkey-continue', snapshot);
    }

    if (phase === TaskPhase.CANCELLING || task.cancelRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在取消',
        title: '正在取消复制+快捷键+继续',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已取消',
        title: '任务已取消',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '执行失败',
        title: task.lastError
          ? `执行失败：${task.lastError}`
          : '复制+快捷键+继续失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: snapshot.continueLabel || '复制+快捷键+继续',
        title: snapshot.continueTitle || '等待回答完成 -> 检查终止信号 -> 复制 -> 快捷键 -> 继续',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (phase === TaskPhase.WAITING_REPLY) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '正在等待 ChatGPT 回复完成',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (phase === TaskPhase.COPYING) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中...',
        title: '正在复制最后回复',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_hotkey') {
      return {
        phase: 'sending_hotkey',
        text: '发送快捷键',
        title: '正在发送目标快捷键',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_continue') {
      return {
        phase: 'sending_continue',
        text: '发送继续',
        title: '正在发送继续指令',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.continueLabel || '复制+快捷键+继续',
      title: snapshot.continueTitle || '等待回答完成 -> 检查终止信号 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getAutoContinueButtonViewState(autoState) {
    if (!autoState || typeof autoState !== 'object') {
      return {
        phase: TaskPhase.IDLE,
        text: '无限继续',
        title: '复用自动指令队列：循环发送“继续”；再点一次停止',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    const autoOwner = resolveAutoQueueOwnerAction(autoState);
    if (autoOwner && autoOwner !== 'auto-continue') {
      return createIdleBlockedAutoContinueView(
        '无限继续',
        '智能继续正在运行；当前按钮暂不可用',
      );
    }

    const phase = String(autoState.phase || TaskPhase.IDLE).trim().toLowerCase();
    const stopRequested = !!autoState.stopRequested;
    const activePhases = new Set([
      'preparing',
      'uploading',
      'upload_attached',
      'sending',
      'sent',
      'waiting_reply',
      'reply_ready',
      'running',
    ]);
    const cancelling = !!(autoState.cancelling || (stopRequested && activePhases.has(phase)));
    const failed = phase === TaskPhase.FAILED || !!autoState.failed;

    if (cancelling) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '无限继续',
        title: '停止请求已提交，正在等待自动继续任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (failed && phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '继续失败',
        title: autoState.phaseReason
          ? `自动继续失败：${autoState.phaseReason}`
          : '自动继续失败，可再次点击重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.WAITING_REPLY || phase === 'waiting_reply' || autoState.waitingReply) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '正在等待 ChatGPT 回复完成，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'waiting',
      };
    }

    if (activePhases.has(phase) || autoState.running) {
      return {
        phase: TaskPhase.RUNNING,
        text: '停止继续',
        title: '自动继续正在运行',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '无限继续',
      title: '复用自动指令队列：循环发送“继续”；再点一次停止',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getAutoContinueUntilDoneButtonViewState(autoState) {
    if (!autoState || typeof autoState !== 'object') {
      return {
        phase: TaskPhase.IDLE,
        text: '无限继续直到完成',
        title: '持续自动继续，直到检测到任务完成',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    const autoOwner = resolveAutoQueueOwnerAction(autoState);
    if (!autoOwner) {
      return {
        phase: TaskPhase.IDLE,
        text: '无限继续直到完成',
        title: '持续自动继续，直到检测到任务完成',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (autoOwner !== 'auto-continue-until-done') {
      return createIdleBlockedAutoContinueView(
        '无限继续直到完成',
        '无限继续正在运行；当前按钮暂不可用',
      );
    }

    const rawPhase = String(autoState.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = normalizeTaskPhase(rawPhase);
    const stopRequested = !!autoState.stopRequested;
    const activePhases = new Set([
      TaskPhase.PREPARING,
      TaskPhase.UPLOADING,
      TaskPhase.UPLOAD_ATTACHED,
      TaskPhase.SENDING,
      TaskPhase.SENT,
      TaskPhase.WAITING_SEND,
      TaskPhase.WAITING_REPLY,
      TaskPhase.REPLY_READY,
      TaskPhase.RUNNING,
      'preparing',
      'uploading',
      'upload_attached',
      'sending',
      'sent',
      'waiting_send',
      'waiting_reply',
      'reply_ready',
      'running',
    ]);
    const cancelling = !!(
      autoState.cancelling
      || (stopRequested && activePhases.has(phase))
    );

    if (cancelling) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '停止中',
        title: '停止请求已提交，正在等待当前步骤退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.FAILED || autoState.failed) {
      return {
        phase: TaskPhase.FAILED,
        text: '智能继续失败',
        title: '智能继续失败，请查看日志',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (
      phase === TaskPhase.WAITING_REPLY
      || rawPhase === 'waiting_reply'
      || autoState.waitingReply
    ) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '智能继续正在等待 ChatGPT 回复完成，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'waiting',
      };
    }

    if (activePhases.has(phase) || autoState.running) {
      return {
        phase: TaskPhase.RUNNING,
        text: '停止智能继续',
        title: '智能继续正在运行，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '无限继续直到完成',
      title: '持续自动继续，直到检测到任务完成',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getActionPhaseFromSnapshot(action, snapshot = {}) {
    const normalized = String(action || '').trim();

    if (normalized === 'send-message') {
      return getNormalizedSendTaskPhase(snapshot);
    }

    if (normalized === 'send-hotkey') {
      const task = snapshot.sendHotkeyTask && typeof snapshot.sendHotkeyTask === 'object'
        ? snapshot.sendHotkeyTask
        : {};
      return String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    }

    if (normalized === 'copy-only' || normalized === 'copy-last-reply') {
      return getNormalizedCopyTaskPhase(snapshot);
    }

    if (normalized === 'copy-and-continue' || normalized === 'copy-continue') {
      const task = snapshot.copyContinueTask && typeof snapshot.copyContinueTask === 'object'
        ? snapshot.copyContinueTask
        : {};
      const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
      return rawPhase === 'sending_continue'
        ? rawPhase
        : normalizeTaskPhase(rawPhase);
    }

    if (normalized === 'copy-hotkey-once' || normalized === 'copy-and-hotkey') {
      const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
        ? snapshot.copyHotkeyOnceTask
        : {};
      if (resolveSnapshotTaskActive(snapshot, 'copyHotkeyOnceTask', 'copyHotkeyOnceActive')) {
        return String(task.phase || TaskPhase.RUNNING).trim().toLowerCase();
      }
      return String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    }

    if (normalized === 'copy-hotkey-continue') {
      const task = snapshot.copyHotkeyContinueTask && typeof snapshot.copyHotkeyContinueTask === 'object'
        ? snapshot.copyHotkeyContinueTask
        : {};
      const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
      return rawPhase === 'sending_hotkey' || rawPhase === 'sending_continue'
        ? rawPhase
        : normalizeTaskPhase(rawPhase);
    }

    return TaskPhase.IDLE;
  }

  function isCapabilityResponding(capability = {}) {
    const cap = capability && typeof capability === 'object' ? capability : {};
    const state = String(cap.response_state || cap.responseState || '').trim().toLowerCase();
    const reason = String(cap.response_state_reason || cap.responseStateReason || '').trim().toLowerCase();
    return !!(
      cap.isResponding
      || cap.is_responding
      || cap.responding
      || state === 'generating'
      || state === 'responding'
      || state === 'waiting_reply'
      || state === 'answering'
      || reason === 'assistant_busy'
      || reason === 'response_in_progress'
    );
  }

  function getPageReplyStatus(snapshot = {}) {
    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    if (sendPhase === TaskPhase.WAITING_REPLY) {
      return 'waiting_reply';
    }
    if (sendPhase === TaskPhase.SENDING || sendPhase === TaskPhase.WAITING_SEND) {
      return 'sending';
    }
    if (sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND) {
      return 'answering';
    }
    if (isLegacySendWaitingReply(snapshot)) {
      return 'waiting_reply';
    }
    if (isLegacyMessageSending(snapshot)) {
      return 'sending';
    }
    if (snapshot.assistantBusy || isCapabilityResponding(snapshot.capability)) {
      return 'answering';
    }
    return 'idle';
  }

  function isClosedLoopActionName(action) {
    const normalized = String(action || '').trim();
    return normalized === 'closed-loop-with-hotkey'
      || normalized === 'closed-loop-with-hotkey-upload-every-round'
      || normalized === 'closed-loop-without-hotkey'
      || normalized === 'closed-loop-upload-continue-hotkey'
      || normalized === 'closed-loop-upload-continue';
  }

  function shouldShowClosedLoopStopView(action, button, snapshot = {}) {
    if (!snapshot.closedLoopContinueRunning) {
      return false;
    }
    return isCurrentClosedLoopOwnerButton(action, button, snapshot);
  }

  function buildOriginalIdleViewForAction(action, fallbackView = {}) {
    const normalizedAction = String(action || '').trim();
    const idleText = isClosedLoopButtonAction(normalizedAction)
      ? getClosedLoopIdleTextByAction(normalizedAction)
      : getNormalButtonIdleLabel(normalizedAction, '');
    const fallbackText = String(fallbackView.text || '').trim();
    const safeText = idleText
      || (
        fallbackText
        && !isClosedLoopLikeText(fallbackText)
        && !isClosedLoopStopLikeText(fallbackText)
        && !isKnownPollutedButtonText(fallbackText)
        ? fallbackText
        : ''
      )
      || '按钮';
    return {
      ...(fallbackView || {}),
      phase: TaskPhase.IDLE,
      text: safeText,
      title: fallbackView.title || safeText,
      disabled: false,
      allowCancel: false,
      action: normalizedAction,
      buttonPhase: 'idle',
    };
  }

  function isEffectiveReplyBusy(snapshot = {}, capability = {}) {
    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    const pageReplyStatus = getPageReplyStatus(snapshot);
    return !!(
      sendPhase === TaskPhase.WAITING_REPLY
      || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
      || sendPhase === TaskPhase.SENDING
      || isLegacySendWaitingReply(snapshot)
      || isLegacyMessageSending(snapshot)
      || snapshot.assistantBusy
      || isCapabilityResponding(capability)
      || isCapabilityResponding(snapshot.capability)
      || pageReplyStatus === 'answering'
      || pageReplyStatus === 'waiting_reply'
    );
  }

  function logButtonViewDiagnostic(tag, payload = {}) {
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (!debugEnabled) {
      return;
    }
    const parts = Object.entries(payload).map(([key, value]) => `${key}=${value}`);
    const line = `[BUTTON_VIEW][${String(tag || 'DIAG')}] ${parts.join(' ')}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function isBlockedByPageReplyBusyReason(reason) {
    const normalized = String(reason || '').trim();
    return normalized === 'blocked-page-reply-busy'
      || normalized.endsWith('-blocked-reply-busy')
      || normalized === 'copy-hotkey-once-blocked-reply-busy'
      || normalized === 'copy-hotkey-continue-blocked-busy'
      || normalized === 'loop-copy-hotkey-continue-blocked'
      || normalized === 'closed-loop-blocked-reply-busy';
  }

  function isButtonOwnTaskActive(view = {}) {
    const phase = normalizeTaskPhase(view.phase);
    const inactivePhases = new Set([
      TaskPhase.IDLE,
      TaskPhase.SUCCESS,
      TaskPhase.FAILED,
      TaskPhase.CANCELLED,
      TaskPhase.DISABLED,
    ]);
    if (!inactivePhases.has(phase)) {
      logButtonViewDiagnostic('OWN_TASK_ACTIVE', { phase });
      return true;
    }
    const action = String(view.action || '').trim();
    if (view.allowCancel === true && (action === 'stop' || action === 'cancel')) {
      logButtonViewDiagnostic('OWN_TASK_ACTIVE', { phase, action });
      return true;
    }
    return false;
  }

  function buildPageReplyBusyIdleDisabledView(buttonName, ownPhase, idleView = {}, snapshot = {}, capability = {}) {
    const normalizedOwn = normalizeTaskPhase(ownPhase);
    if (normalizedOwn !== TaskPhase.IDLE) {
      return null;
    }
    if (!isEffectiveReplyBusy(snapshot, capability)) {
      return null;
    }

    logButtonViewDiagnostic('GLOBAL_REPLY_BUSY_AS_DISABLED', {
      button: buttonName || '-',
      ownPhase: normalizedOwn,
      pageReplyBusy: 1,
      keepPhase: TaskPhase.IDLE,
    });
    logButtonViewDiagnostic('PAGE_BUSY_ONLY', {
      button: buttonName || '-',
      ownPhase: normalizedOwn,
    });

    const text = String(idleView.text || idleView.label || '').trim() || '按钮';
    return {
      phase: TaskPhase.IDLE,
      text,
      title: idleView.titleWhenBlocked || '当前页面正在回答，暂不可用',
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'idle',
      preserveBaseColorWhenDisabled: true,
      blockedByPageReplyBusy: true,
    };
  }

  function computeUploadActionDisabled(action, snapshot = {}) {
    const normalized = String(action || '').trim();

    const batchUploadForbiddenReason = String(snapshot.batchUploadForbiddenReason || '').trim();
    if (normalized === 'start-upload' && batchUploadForbiddenReason) {
      const sendPhase = getActionPhaseFromSnapshot('send-message', snapshot);
      const sendHotkeyPhase = getActionPhaseFromSnapshot('send-hotkey', snapshot);
      const copyPhase = getActionPhaseFromSnapshot('copy-only', snapshot);
      const copyHotkeyPhase = getActionPhaseFromSnapshot('copy-hotkey-continue', snapshot);
      const waitContinuePhase = getActionPhaseFromSnapshot('copy-and-continue', snapshot);
      const pageReplyStatus = getPageReplyStatus(snapshot);
      return {
        disabled: true,
        reason: `batch-upload-forbidden:${batchUploadForbiddenReason}`,
        sendPhase,
        sendHotkeyPhase,
        copyPhase,
        copyHotkeyPhase,
        waitContinuePhase,
        pageReplyStatus,
      };
    }

    const globalDisabledActions = new Set([
      'send-message',
      'start-upload',
      'cancel-send',
      'cancel-wait-reply',
      'cancel-send-copy-hotkey',
      'cancel-upload',
      'copy-log',
      'copy-error-log',
    ]);

    const sendPhase = getActionPhaseFromSnapshot('send-message', snapshot);
    const sendHotkeyPhase = getActionPhaseFromSnapshot('send-hotkey', snapshot);
    const copyPhase = getActionPhaseFromSnapshot('copy-only', snapshot);
    const copyHotkeyPhase = getActionPhaseFromSnapshot('copy-hotkey-continue', snapshot);
    const waitContinuePhase = getActionPhaseFromSnapshot('copy-and-continue', snapshot);
    const pageReplyStatus = getPageReplyStatus(snapshot);
    const copyHotkeyOnceActive = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyOnceTask',
      'copyHotkeyOnceActive',
    );
    const copyHotkeyContinueActive = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyContinueTask',
      'copyHotkeyContinueActive',
    );
    const copyHotkeyLoopActive = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyContinueLoopTask',
      'copyHotkeyLoopActive',
    );
    const closedLoopRunning = !!snapshot.closedLoopContinueRunning;
    const autoContinueRunning = !!snapshot.autoContinueRunning;
    const replyBusy = isEffectiveReplyBusy(snapshot);

    let disabled = false;
    let reason = 'ok';

    const batchBlockedReason = String(snapshot.batchBlockedReason || '').trim();
    const batchTaskRunning = snapshot.batchTaskRunning === true;
    const batchBlocksUpload = batchTaskRunning && (
      batchBlockedReason === 'conversation_id_lost'
      || batchBlockedReason === 'batch_conversation_id_not_initialized'
    );

    if (normalized === 'start-upload' && batchBlocksUpload) {
      return {
        disabled: true,
        reason: `start-upload-blocked-${batchBlockedReason}`,
        sendPhase,
        sendHotkeyPhase,
        copyPhase,
        copyHotkeyPhase,
        waitContinuePhase,
        pageReplyStatus,
      };
    }

    // Most composite/loop tasks manage their own enable/disable state in getXXXButtonViewState().
    // computeUploadActionDisabled should not act as a global gate for them.
    if (!globalDisabledActions.has(normalized)) {
      return {
        disabled: false,
        reason: 'view_state_owned',
        sendPhase,
        sendHotkeyPhase,
        copyPhase,
        copyHotkeyPhase,
        waitContinuePhase,
        pageReplyStatus,
      };
    }

    if (
      normalized === 'cancel-send'
      || normalized === 'cancel-wait-reply'
      || normalized === 'cancel-upload'
      || normalized === 'cancel-send-copy-hotkey'
    ) {
      disabled = false;
      reason = 'cancel-action-allowed';
    } else if (normalized === 'start-upload') {
      disabled = false;
      reason = 'ok';
    } else if (normalized === 'send-message') {
      disabled = sendPhase === TaskPhase.SENDING
        || sendPhase === TaskPhase.WAITING_SEND
        || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
        || sendPhase === 'waiting_ready'
        || sendPhase === TaskPhase.CANCELLING
        || pageReplyStatus === 'answering'
        || pageReplyStatus === 'waiting_reply';
      reason = disabled
        ? (pageReplyStatus === 'answering'
          ? 'send-message-blocked-assistant-answering'
          : `send-message-blocked-${sendPhase || pageReplyStatus}`)
        : 'ok';
    } else if (normalized === 'copy-log' || normalized === 'copy-error-log') {
      disabled = false;
      reason = 'ok';
    }

    return {
      disabled,
      reason,
      sendPhase,
      sendHotkeyPhase,
      copyPhase,
      copyHotkeyPhase,
      waitContinuePhase,
      pageReplyStatus,
    };
  }

  function logButtonDisabledDecide(action, decide = {}, extra = {}) {
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (!debugEnabled) {
      return;
    }
    const normalized = String(action || '-').trim() || '-';
    const payload = {
      action: normalized,
      disabled: decide.disabled ? 1 : 0,
      reason: decide.reason || '-',
      sendPhase: decide.sendPhase || '-',
      sendHotkeyPhase: decide.sendHotkeyPhase || '-',
      copyPhase: decide.copyPhase || '-',
      copyHotkeyPhase: decide.copyHotkeyPhase || '-',
      waitContinuePhase: decide.waitContinuePhase || '-',
      pageReplyStatus: decide.pageReplyStatus || '-',
      viewDisabled: extra.viewDisabled != null ? (extra.viewDisabled ? 1 : 0) : '-',
    };
    const line = `[BUTTON_DISABLED][DECIDE] action=${payload.action} disabled=${payload.disabled}`
      + ` reason=${payload.reason} sendPhase=${payload.sendPhase} sendHotkeyPhase=${payload.sendHotkeyPhase}`
      + ` copyPhase=${payload.copyPhase} copyHotkeyPhase=${payload.copyHotkeyPhase}`
      + ` waitContinuePhase=${payload.waitContinuePhase} pageReplyStatus=${payload.pageReplyStatus}`
      + ` viewDisabled=${payload.viewDisabled}`;
    const key = `BUTTON_DISABLED:DECIDE:${payload.action}`;
    const value = `${payload.disabled}|${payload.reason}|${payload.sendPhase}|${payload.sendHotkeyPhase}|${payload.copyPhase}|${payload.copyHotkeyPhase}|${payload.waitContinuePhase}|${payload.pageReplyStatus}|${payload.viewDisabled}`;
    const hasDedupe = typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function';
    const emitted = hasDedupe
      ? ToolboxShell.appendLogIfChanged(key, value, line, 10000)
      : (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function'
        ? (ToolboxShell.appendLog(line), true)
        : false);
    if (emitted) {
      console.log(line);
    }
  }

  function getCopyContinueButtonViewState(snapshot = {}) {
    const task = snapshot.copyContinueTask && typeof snapshot.copyContinueTask === 'object'
      ? snapshot.copyContinueTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_continue'
      ? rawPhase
      : normalizeTaskPhase(rawPhase);

    if (phase === TaskPhase.CANCELLING || task.cancelRequested || task.stopRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '复制并继续',
        title: '停止请求已提交，正在等待复制并继续任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '复制失败',
        title: '复制并继续失败，可再次点击重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已完成',
        title: '已复制最后回复并发送继续',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.WAITING_REPLY) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '正在等待 ChatGPT 回复完成',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (phase === TaskPhase.COPYING) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中...',
        title: '正在复制最后回复',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_continue') {
      return {
        phase: 'sending_continue',
        text: '发送继续...',
        title: '正在发送“继续”指令',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.RUNNING) {
      return {
        phase: TaskPhase.RUNNING,
        text: '继续中',
        title: '复制并继续任务进行中',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '复制并继续',
      title: '先复制最后回复，再发送“继续”',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getHomeButtonViewState(snapshot = {}) {
    const task = snapshot.homeTask && typeof snapshot.homeTask === 'object'
      ? snapshot.homeTask
      : {};
    const phase = normalizeTaskPhase(task.phase);

    if (phase === TaskPhase.RUNNING) {
      return {
        phase: TaskPhase.RUNNING,
        text: '跳转中',
        title: '正在跳转到 ChatGPT 首页',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: snapshot.homeLabel || '回到首页',
        title: snapshot.homeTitle || '点击左侧新聊天',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '跳转失败',
        title: task.lastError
          ? `跳转失败：${task.lastError}`
          : '跳转失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.homeLabel || '回到首页',
      title: snapshot.homeTitle || '点击左侧新聊天',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function formatClosedLoopRunningButtonWaitSuffix(snapshot = {}) {
    return ClosedLoopButtonVm.formatClosedLoopRunningButtonWaitSuffix(snapshot);
  }

  function resolveClosedLoopStopButtonText(snapshot = {}, stopping = false) {
    return ClosedLoopButtonVm.resolveClosedLoopStopButtonText(snapshot, stopping);
  }

  function getClosedLoopContinueButtonViewState(snapshot = {}, mode = 'with_hotkey') {
    return ClosedLoopButtonVm.getClosedLoopContinueButtonViewState(snapshot, mode);
  }

  function getCopyHotkeyLoopButtonViewState(snapshot = {}) {
    const task = snapshot.copyHotkeyContinueLoopTask && typeof snapshot.copyHotkeyContinueLoopTask === 'object'
      ? snapshot.copyHotkeyContinueLoopTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const loopActive = rawPhase !== TaskPhase.IDLE
      && rawPhase !== 'stopped'
      && rawPhase !== TaskPhase.SUCCESS
      && rawPhase !== TaskPhase.FAILED
      && rawPhase !== TaskPhase.CANCELLED;

    if (!loopActive && snapshot.closedLoopContinueRunning) {
      return buildClosedLoopLockedView('loop-copy-hotkey-continue', snapshot);
    }

    if (rawPhase === 'stopping') {
      return {
        phase: 'stopping',
        text: '停止中',
        title: '停止请求已提交，正在等待连续复制任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (rawPhase === 'stopped' || rawPhase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已停止',
        title: '连续复制已停止',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (rawPhase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '循环失败',
        title: task.lastError ? `循环失败：${task.lastError}` : '连续复制失败',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (rawPhase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: snapshot.loopLabel || '无限连续复制+快捷键+继续',
        title: snapshot.loopTitle || '循环：等待回答 -> 复制 -> 快捷键 -> 继续',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (loopActive || CANCELLABLE_TASK_PHASES.has(rawPhase) || rawPhase === 'waiting_next_reply' || rawPhase === 'auto_uploading' || rawPhase === 'home_navigation') {
      const phaseLabels = {
        waiting_reply: '等待回复',
        copying: '复制中',
        sending_hotkey: '发送快捷键',
        sending_continue: '发送继续',
        waiting_next_reply: '等待下一轮',
        auto_uploading: '自动上传中',
        home_navigation: '跳转首页',
        running: '停止连续',
      };
      const text = phaseLabels[rawPhase] || '停止连续';
      return {
        phase: TaskPhase.RUNNING,
        text,
        title: '无限连续复制+快捷键+继续运行中',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.loopLabel || '无限连续复制+快捷键+继续',
      title: snapshot.loopTitle || '循环：等待回答 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function mapSendMessageViewStateToToolboxOptions(view = {}, reason = '') {
    const taskPhase = normalizeTaskPhase(view.phase);
    const buttonPhase = String(view.buttonPhase || '').trim().toLowerCase();
    const base = {
      text: view.text || '',
      title: view.title || '',
      disabled: !!view.disabled,
      allowCancel: !!view.allowCancel,
      reason,
      ariaBusy: CANCELLABLE_TASK_PHASES.has(taskPhase) || view.allowCancel === true,
    };

    if (taskPhase === TaskPhase.CANCELLING || buttonPhase === 'cancelling') {
      return { ...base, phase: ButtonState.Phase.CANCELLING, disabled: false };
    }
    if (buttonPhase === 'checking' || taskPhase === TaskPhase.CHECKING) {
      return { ...base, phase: ButtonState.Phase.CHECKING, allowCancel: false };
    }
    if (taskPhase === TaskPhase.WAITING_INPUT) {
      return { ...base, phase: ButtonState.Phase.WAITING_INPUT };
    }
    if (taskPhase === TaskPhase.WAITING_ATTACHMENT) {
      return { ...base, phase: ButtonState.Phase.WAITING_ATTACHMENT };
    }
    if (taskPhase === TaskPhase.WAITING_SEND) {
      if (base.text === '等待输入框' || base.text === '取消发送（等待输入框）') {
        return { ...base, phase: ButtonState.Phase.WAITING_INPUT };
      }
      if (base.text === '等待附件' || base.text === '取消发送（等待附件）') {
        return { ...base, phase: ButtonState.Phase.WAITING_ATTACHMENT };
      }
      return { ...base, phase: ButtonState.Phase.WAITING_SEND };
    }
    if (taskPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND) {
      // 页面正在回复，消息尚未发出；视觉上属于“等待发送”的一种，但文案需区分。
      return { ...base, phase: ButtonState.Phase.WAITING_SEND };
    }
    if (taskPhase === TaskPhase.SENDING) {
      return { ...base, phase: ButtonState.Phase.SENDING };
    }
    if (taskPhase === TaskPhase.WAITING_REPLY) {
      return { ...base, phase: ButtonState.Phase.WAITING_REPLY };
    }

    return {
      ...base,
      phase: ButtonState.Phase.IDLE,
      allowCancel: false,
      disabled: !!view.disabled,
    };
  }

  function mapTaskPhaseToButtonStatePhase(taskPhase) {
    if (typeof ButtonState !== 'undefined' && typeof ButtonState.mapTaskPhaseToButtonPhase === 'function') {
      return ButtonState.mapTaskPhaseToButtonPhase(normalizeTaskPhase(taskPhase));
    }
    return ButtonState.Phase.IDLE;
  }

  function mapViewStateToToolboxOptions(view = {}, reason = '') {
    const buttonPhase = String(view.buttonPhase || 'idle');
    const taskPhase = normalizeTaskPhase(view.phase);
    const base = {
      text: view.text || '',
      title: view.title || '',
      disabled: !!view.disabled,
      allowCancel: !!view.allowCancel,
      reason,
      ariaBusy: CANCELLABLE_TASK_PHASES.has(view.phase) || view.allowCancel === true,
    };

    if (view.buttonGroup === CLOSED_LOOP_BUTTON_GROUP || view.forceClosedLoopStyle === true) {
      if (
        view.forceDanger === true
        || view.allowCancel === true
        || buttonPhase === 'danger'
      ) {
        return {
          ...base,
          phase: ButtonState.Phase.DANGER,
          disabled: !!view.disabled,
          allowCancel: !!view.allowCancel,
          className: CLOSED_LOOP_RUNNING_CLASS_NAME,
        };
      }
      return {
        ...base,
        phase: ButtonState.Phase.IDLE,
        disabled: !!view.disabled,
        allowCancel: false,
        preserveBaseColorWhenDisabled: view.preserveBaseColorWhenDisabled === true,
        className: CLOSED_LOOP_IDLE_CLASS_NAME,
      };
    }

    if (buttonPhase === 'success' || taskPhase === TaskPhase.SUCCESS) {
      return { ...base, phase: ButtonState.Phase.IDLE };
    }
    if (buttonPhase === 'initializing' || taskPhase === TaskPhase.INITIALIZING) {
      return { ...base, phase: ButtonState.Phase.INITIALIZING };
    }
    if (buttonPhase === 'failed' || taskPhase === TaskPhase.FAILED) {
      return { ...base, phase: ButtonState.Phase.FAILED };
    }
    if (buttonPhase === 'cancelled' || taskPhase === TaskPhase.CANCELLED) {
      return { ...base, phase: ButtonState.Phase.CANCELLED };
    }
    if (buttonPhase === 'disabled') {
      return { ...base, phase: ButtonState.Phase.DISABLED };
    }
    if (view.forceDanger === true || buttonPhase === 'danger') {
      return {
        ...base,
        phase: ButtonState.Phase.DANGER,
        disabled: !!view.disabled,
        allowCancel: !!view.allowCancel,
        permanentDanger: view.allowCancel !== true,
      };
    }
    if (buttonPhase === 'warning') {
      return { ...base, phase: ButtonState.Phase.IDLE };
    }
    if (buttonPhase === 'idle' && taskPhase === TaskPhase.IDLE) {
      return {
        ...base,
        phase: ButtonState.Phase.IDLE,
        disabled: !!view.disabled,
        preserveBaseColorWhenDisabled: view.preserveBaseColorWhenDisabled === true,
      };
    }

    const mappedPhase = mapTaskPhaseToButtonStatePhase(taskPhase);
    if (buttonPhase === 'sending' && mappedPhase === ButtonState.Phase.RUNNING) {
      return { ...base, phase: ButtonState.Phase.SENDING };
    }
    if (buttonPhase === 'waiting' && mappedPhase === ButtonState.Phase.RUNNING) {
      return { ...base, phase: ButtonState.Phase.WAITING };
    }

    return {
      ...base,
      phase: mappedPhase,
      disabled: !!view.disabled,
      allowCancel: !!view.allowCancel,
    };
  }

  function captureButtonRenderSnapshot(button) {
    if (!button) {
      return { phase: '-', text: '-' };
    }
    return {
      phase: String(button.dataset.cgptButtonPhase || button.dataset.cgptTaskPhase || '-').trim() || '-',
      text: String(button.textContent || '').trim() || '-',
    };
  }

  function logButtonRenderChange(button, before, reason, buttonName = '') {
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (!debugEnabled) {
      return;
    }
    if (!button) {
      return;
    }
    const after = captureButtonRenderSnapshot(button);
    const name = String(buttonName || button.id || button.dataset.cgptBaseAction || button.dataset.action || '-').trim() || '-';
    if (before.phase === after.phase && before.text === after.text) {
      return;
    }
    const line = `[BUTTON_RENDER][CHANGE] button=${name} oldPhase=${before.phase} newPhase=${after.phase}`
      + ` oldText=${before.text} newText=${after.text} reason=${reason || '-'}`;
    const key = `BUTTON_RENDER:CHANGE:${name}`;
    const value = `${before.phase}|${before.text}|${after.phase}|${after.text}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
      ToolboxShell.appendLogIfChanged(key, value, line, 10000);
    } else {
      console.log(line);
    }
  }

  function logButtonActionState(button, resolvedView, reason = '') {
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (!debugEnabled) {
      return;
    }
    if (!button) {
      return;
    }
    const id = String(button.id || '-').trim() || '-';
    const baseAction = String(button.dataset.cgptBaseAction || '-').trim() || '-';
    const domAction = String(button.dataset.action || '-').trim() || '-';
    const runtimeAction = String(button.dataset.cgptRuntimeAction || '-').trim() || '-';
    const resolvedAction = String(resolvedView && resolvedView.action ? resolvedView.action : runtimeAction).trim() || '-';
    const text = String(button.textContent || '').trim() || '-';
    const disabled = button.disabled ? 1 : 0;
    const phase = String(resolvedView && resolvedView.phase ? resolvedView.phase : button.dataset.cgptTaskPhase || '-').trim() || '-';
    const subPhase = String(
      (resolvedView && (resolvedView.subPhase || resolvedView.subphase))
      || button.dataset.cgptTaskSubPhase
      || '-',
    ).trim() || '-';
    const line = `[STATE_SCHEMA][BUTTON_ACTION_RESOLVED] id=${id} data-action=${domAction} runtimeAction=${runtimeAction} resolvedAction=${resolvedAction} phase=${phase} subPhase=${subPhase} disabled=${disabled} text=${text} baseAction=${baseAction} reason=${reason || '-'}`;
    const key = `BUTTON_ACTION:STATE:${id || baseAction || domAction || '-'}`;
    const value = `${domAction}|${runtimeAction}|${resolvedAction}|${phase}|${subPhase}|${disabled}`;
    const hasDedupe = typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function';
    const emitted = hasDedupe
      ? ToolboxShell.appendLogIfChanged(key, value, line, 10000)
      : (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function'
        ? (ToolboxShell.appendLog(line), true)
        : false);
    if (emitted) {
      console.log(line);
    }
  }

  const UPLOAD_BUTTON_INDICATOR_CLASSES = [
    'cgpt-upload-idle',
    'cgpt-upload-initializing',
    'cgpt-upload-running',
    'cgpt-upload-stopping',
    'cgpt-upload-failed',
  ];

  const UPLOAD_ONLY_INDICATOR_BUTTON_IDS = new Set([
    'cgpt-upload-start',
    'cgpt-autoq-start-upload',
  ]);

  function syncUploadButtonIndicatorClasses(button, view) {
    if (!button) {
      return;
    }
    button.classList.remove('cgpt-task-running-indicator');
    UPLOAD_BUTTON_INDICATOR_CLASSES.forEach((cls) => button.classList.remove(cls));

    const buttonId = String(button.id || '').trim();
    if (!UPLOAD_ONLY_INDICATOR_BUTTON_IDS.has(buttonId)) {
      return;
    }

    const phase = normalizeTaskPhase(view && view.phase);
    if (phase === TaskPhase.INITIALIZING) {
      button.classList.add('cgpt-upload-initializing');
    } else if (phase === TaskPhase.FAILED) {
      button.classList.add('cgpt-upload-failed');
    } else if (phase === TaskPhase.CANCELLING) {
      button.classList.add('cgpt-upload-stopping');
    } else if (phase === TaskPhase.UPLOADING) {
      button.classList.add('cgpt-upload-running');
    } else {
      button.classList.add('cgpt-upload-idle');
    }
  }

  function applyUploadButtonViewState(button, view, reason = '', applyOptions = {}) {
    if (!button || !view || typeof ButtonState === 'undefined') {
      return false;
    }

    const beforeRender = captureButtonRenderSnapshot(button);
    let snapshot = applyOptions.snapshot && typeof applyOptions.snapshot === 'object'
      ? applyOptions.snapshot
      : {};
    if (!String(snapshot.waitingReplyOwner || '').trim()) {
      snapshot = {
        ...snapshot,
        waitingReplyOwner: resolveWaitingReplyOwner(snapshot, snapshot.capability),
      };
    }
    const canonicalAction = resolveButtonCanonicalAction(button, applyOptions);
    const action = canonicalAction || String(button.id || '').trim();
    let resolvedView = suppressNonOwnerWaitingReplyView(
      action,
      view,
      snapshot,
      button,
      reason,
    );

    if (action === 'copy-log' || action === 'copy-error-log') {
      resolvedView = {
        ...resolvedView,
        phase: TaskPhase.IDLE,
        buttonPhase: 'idle',
        disabled: false,
        allowCancel: false,
        action,
        preserveBaseColorWhenDisabled: false,
      };
    }

    if (action) {
      const decide = computeUploadActionDisabled(action, snapshot);
      const viewDisabled = !!view.disabled;
      const runtimeAction = String(
        resolvedView.runtimeAction
        || resolvedView.action
        || button.dataset.cgptRuntimeAction
        || button.dataset.cgptButtonAction
        || '',
      ).trim();
      const decideAction = isUploadButtonBusinessAction(runtimeAction) ? runtimeAction : action;
      const decideForRuntime = computeUploadActionDisabled(decideAction, snapshot);
      const ownPhase = normalizeTaskPhase(resolvedView.phase);
      const rawOwnPhase = String(resolvedView.phase || '').trim().toLowerCase();
      const isOwnActiveRawPhase = rawOwnPhase
        && ![
          TaskPhase.IDLE,
          TaskPhase.SUCCESS,
          TaskPhase.FAILED,
          TaskPhase.CANCELLED,
          TaskPhase.DISABLED,
        ].includes(rawOwnPhase);
      const isOwnCancelView = resolvedView.allowCancel === true
        && (runtimeAction === 'cancel' || runtimeAction === 'stop' || runtimeAction === 'stop-closed-loop')
        && isOwnActiveRawPhase;
      const pageReplyBlocked = isBlockedByPageReplyBusyReason(decideForRuntime.reason)
        || isBlockedByPageReplyBusyReason(decide.reason)
        || resolvedView.blockedByPageReplyBusy === true;

      if (isOwnCancelView) {
        resolvedView = {
          ...resolvedView,
          disabled: false,
          action: runtimeAction,
          preserveBaseColorWhenDisabled: false,
        };
      } else if (ownPhase === TaskPhase.IDLE && pageReplyBlocked && decideForRuntime.disabled) {
        resolvedView = {
          ...resolvedView,
          phase: TaskPhase.IDLE,
          disabled: true,
          action: 'none',
          buttonPhase: 'idle',
          preserveBaseColorWhenDisabled: true,
        };
        logButtonViewDiagnostic('DISABLED_KEEP_IDLE_COLOR', {
          action: decideAction || action || '-',
          reason: 'blocked-page-reply-busy',
        });
      } else if (
        action === 'send-message'
        || action === 'start-upload'
        || action === 'cancel-send'
        || action === 'cancel-wait-reply'
        || action === 'cancel-send-copy-hotkey'
        || action === 'cancel-upload'
        || action === 'copy-log'
        || action === 'copy-error-log'
      ) {
        if (decideForRuntime.disabled !== viewDisabled) {
          const keepIdleColor = ownPhase === TaskPhase.IDLE
            && isBlockedByPageReplyBusyReason(decideForRuntime.reason);
          resolvedView = {
            ...resolvedView,
            disabled: decideForRuntime.disabled,
            action: decideForRuntime.disabled && resolvedView.action === 'start'
              ? 'none'
              : resolvedView.action,
            buttonPhase: keepIdleColor
              ? 'idle'
              : (decideForRuntime.disabled
                ? (resolvedView.buttonPhase === 'waiting' ? resolvedView.buttonPhase : 'disabled')
                : (resolvedView.buttonPhase === 'disabled' ? 'idle' : resolvedView.buttonPhase)),
            preserveBaseColorWhenDisabled: keepIdleColor
              ? true
              : resolvedView.preserveBaseColorWhenDisabled,
          };
          if (keepIdleColor) {
            logButtonViewDiagnostic('DISABLED_KEEP_IDLE_COLOR', {
              action: decideAction || action || '-',
              reason: 'blocked-page-reply-busy',
            });
          }
        }
      }

      if (
        action === 'send-message'
        || action === 'start-upload'
        || action === 'cancel-send'
        || action === 'cancel-wait-reply'
        || action === 'cancel-send-copy-hotkey'
        || action === 'cancel-upload'
        || action === 'copy-log'
        || action === 'copy-error-log'
        || decide.disabled
        || decideForRuntime.disabled
      ) {
        logButtonDisabledDecide(action, decideForRuntime, { viewDisabled: !!resolvedView.disabled });
      }
    }

    const isSendBtn = typeof ButtonState !== 'undefined'
      && typeof ButtonState.isSendMessageToolboxButton === 'function'
      && ButtonState.isSendMessageToolboxButton(button);

    // Auto-heal: avoid "clickable green send button but runtimeAction=none".
    const resolvedPhase = normalizeTaskPhase(resolvedView.phase);
    const resolvedRuntimeAction = String(resolvedView.action || '').trim();
    if (
      isSendBtn
      && resolvedPhase === TaskPhase.IDLE
      && resolvedRuntimeAction === 'none'
      && resolvedView.disabled !== true
    ) {
      resolvedView = {
        ...resolvedView,
        action: 'send-message',
        buttonPhase: 'idle',
        preserveBaseColorWhenDisabled: false,
      };

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SEND_MESSAGE][NONE_ACTION_AUTO_RECOVER] id=${button.id || '-'} reason=${reason || '-'}`
        );
      } else {
        console.warn('[SEND_MESSAGE][NONE_ACTION_AUTO_RECOVER]', {
          id: button.id || '-',
          reason: reason || '-',
        });
      }
    }
    if (
      isClosedLoopStopLikeText(resolvedView.text)
      && !shouldShowClosedLoopStopView(action, button, snapshot)
    ) {
      resolvedView = {
        ...buildOriginalIdleViewForAction(action, resolvedView),
        disabled: snapshot.closedLoopContinueRunning === true ? true : resolvedView.disabled,
        allowCancel: false,
        action: snapshot.closedLoopContinueRunning === true ? 'none' : resolvedView.action,
        preserveBaseColorWhenDisabled: snapshot.closedLoopContinueRunning === true
          ? true
          : resolvedView.preserveBaseColorWhenDisabled,
      };
    }

    resolvedView = applyUnifiedButtonVisualState(
      button,
      resolvedView,
      snapshot,
      canonicalAction,
    );
    if (
      snapshot.closedLoopContinueRunning === true
      && isClosedLoopActionName(canonicalAction)
      && !isClosedLoopOwnerAction(canonicalAction, snapshot)
    ) {
      clearClosedLoopStopVisualClasses(button);
    }
    const options = isSendBtn
      ? mapSendMessageViewStateToToolboxOptions(resolvedView, reason)
      : mapViewStateToToolboxOptions(resolvedView, reason);
    button.dataset.cgptTaskPhase = resolvedView.phase || TaskPhase.IDLE;

    const domRuntimeAction = String(
      resolvedView.runtimeAction
      || (
        isGenericButtonRuntimeAction(resolvedView.action)
          ? resolvedView.action
          : ''
      )
      || '',
    ).trim();
    if (canonicalAction) {
      button.dataset.cgptBaseAction = canonicalAction;
      button.dataset.action = canonicalAction;
    }

    if (typeof ButtonState !== 'undefined' && typeof ButtonState.setButtonRuntimeAction === 'function') {
      ButtonState.setButtonRuntimeAction(button, domRuntimeAction);
    } else if (domRuntimeAction) {
      button.dataset.cgptRuntimeAction = domRuntimeAction;
    } else {
      delete button.dataset.cgptRuntimeAction;
    }
    delete button.dataset.cgptButtonAction;
    button.dataset.cgptTaskSubPhase = String(resolvedView.subPhase || resolvedView.subphase || '').trim();

    syncUploadButtonIndicatorClasses(button, resolvedView);

    const changed = ButtonState.setToolboxButtonState(button, options);
    if (isClosedLoopActionName(canonicalAction) && options.className) {
      applyClosedLoopButtonClassName(button, options.className);
      logClosedLoopButtonStyleDecide(button, resolvedView, options, {
        running: snapshot.closedLoopContinueRunning === true,
        isOwner: isClosedLoopOwnerAction(canonicalAction, snapshot),
      });
    }
    button.title = String(
      resolvedView.title || resolvedView.text || button.title || '',
    ).trim();
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (debugEnabled && typeof ButtonState.assertCancellableButtonConsistency === 'function') {
      ButtonState.assertCancellableButtonConsistency(button, resolvedView, reason);
    }
    logButtonRenderChange(
      button,
      beforeRender,
      reason,
      applyOptions.buttonName || action,
    );
    logButtonActionState(button, resolvedView, reason);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      const applyPhaseLabel = options.phase === ButtonState.Phase.DANGER
        ? 'danger'
        : (resolvedView.buttonPhase || resolvedView.phase || '-');
      ToolboxShell.appendLog(
        `[BUTTON_VIEW][APPLY] id=${button.id || '-'} action=${button.dataset.action || '-'} `
        + `taskKey=${resolvedView.taskKey || '-'} phase=${applyPhaseLabel} `
        + `text=${resolvedView.text || String(button.textContent || '').trim() || '-'}`,
      );
    }
    return changed;
  }

  const UploadButtonVm = Object.freeze({
    TaskPhase,
    CANCELLABLE_TASK_PHASES,
    createRunId,
    normalizeTaskPhase,
    getUploadButtonViewState,
    getSendMessageButtonViewState,
    getCopyLastReplyButtonViewState,
    getCopyHotkeyOnceButtonViewState,
    getSendCopyHotkeyButtonViewState,
    getSendHotkeyButtonViewState,
    getCopyHotkeyContinueOnceButtonViewState,
    getCopyHotkeyLoopButtonViewState,
    getClosedLoopContinueButtonViewState,
    getAutoContinueButtonViewState,
    getAutoContinueUntilDoneButtonViewState,
    getHomeButtonViewState,
    getCopyContinueButtonViewState,
    getActionPhaseFromSnapshot,
    getPageReplyStatus,
    isEffectiveReplyBusy,
    isBlockedByPageReplyBusyReason,
    isButtonOwnTaskActive,
    resolveWaitingReplyOwner,
    getCurrentAutoQueueOwnerAction,
    resolveAutoQueueOwnerAction,
    actionsMatchWaitingReplyOwner,
    isViewShowingWaitingReply,
    suppressNonOwnerWaitingReplyView,
    buildPageReplyBusyIdleDisabledView,
    isClosedLoopActionName,
    isClosedLoopModeButton,
    shouldShowClosedLoopStopView,
    buildOriginalIdleViewForAction,
    computeUploadActionDisabled,
    logButtonDisabledDecide,
    resolveUnifiedButtonVisualState,
    applyUnifiedButtonVisualState,
    resolveClosedLoopOwnerAction,
    getClosedLoopOwnerActionFromSnapshot,
    isClosedLoopOwnerAction,
    resolveActionForClosedLoopMode,
    resolveClosedLoopIdleBusinessText,
    getClosedLoopIdleTextByAction,
    getClosedLoopOwnerFromSnapshot,
    getNormalButtonIdleLabel,
    isClosedLoopButtonAction,
    isClosedLoopButtonElement,
    isClosedLoopLikeText,
    isKnownPollutedButtonText,
    isCurrentClosedLoopOwnerButton,
    CLOSED_LOOP_BUTTON_ACTIONS,
    CLOSED_LOOP_BUTTON_IDS,
    CLOSED_LOOP_IDLE_CLASS_NAME,
    CLOSED_LOOP_RUNNING_CLASS_NAME,
    applyClosedLoopButtonClassName,
    clearClosedLoopStopVisualClasses,
    mapViewStateToToolboxOptions,
    mapSendMessageViewStateToToolboxOptions,
    mapTaskPhaseToButtonPhase: mapTaskPhaseToButtonStatePhase,
    applyUploadButtonViewState,
  });
