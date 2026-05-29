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
    'auto-continue': ['auto-continue-until-done'],
    'auto-continue-until-done': ['auto-continue'],
  });

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

  function resolveIdleBusinessTextForAction(action, snapshot = {}, button = null) {
    const normalized = String(action || '').trim();
    const fromSnapshot = (() => {
      switch (normalized) {
        case 'send-message':
          return '发送消息';
        case 'copy-hotkey-continue':
          return snapshot.continueLabel || '复制+快捷键+继续';
        case 'loop-copy-hotkey-continue':
          return snapshot.loopLabel || '无限连续复制+快捷键+继续';
        case 'copy-and-continue':
        case 'copy-continue':
          return '复制并继续';
        case 'auto-continue':
          return '无限继续';
        case 'auto-continue-until-done':
          return '无限继续直到完成';
        case 'copy-only':
        case 'copy-last-reply':
          return '复制最后回复';
        case 'copy-and-hotkey':
        case 'copy-hotkey-once':
          return snapshot.onceLabel || '复制+快捷键';
        case 'closed-loop-with-hotkey':
        case 'closed-loop-without-hotkey':
        case 'closed-loop-upload-continue-hotkey':
        case 'closed-loop-upload-continue':
          return snapshot.closedLoopLabel || '';
        default:
          return '';
      }
    })();

    if (fromSnapshot) {
      return fromSnapshot;
    }

    if (button) {
      const current = String(button.textContent || '').trim();
      if (current && current !== '等待回复') {
        return current;
      }
    }

    return '按钮';
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
    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    // waiting_reply: 已发送，等待 ChatGPT 回复
    // waiting_page_reply_to_send: 页面正在回复，消息尚未真正发送，等待页面空闲后再发
    if (
      sendPhase === TaskPhase.WAITING_REPLY
      || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
      || isLegacySendPending(snapshot)
    ) {
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
        return 'auto-continue';
      }
    }

    const copyPhase = getNormalizedCopyTaskPhase(snapshot);
    if (copyPhase === TaskPhase.WAITING_REPLY) {
      return 'copy-only';
    }

    return '';
  }

  function suppressNonOwnerWaitingReplyView(action, view, snapshot = {}, button = null, reason = '') {
    if (!isViewShowingWaitingReply(view)) {
      return view;
    }

    const owner = String(snapshot.waitingReplyOwner || '').trim()
      || resolveWaitingReplyOwner(snapshot, snapshot.capability);
    if (!owner || actionsMatchWaitingReplyOwner(action, owner)) {
      return view;
    }

    const autoState = (
      typeof AutoQueueModule !== 'undefined'
      && AutoQueueModule
      && typeof AutoQueueModule.getState === 'function'
    )
      ? (AutoQueueModule.getState() || {})
      : {};
    const autoQueueWaitingReply = (
      normalizeTaskPhase(String(autoState.phase || '').trim().toLowerCase()) === TaskPhase.WAITING_REPLY
      || autoState.waitingReply === true
    );
    const autoQueueRunning = !!(autoState.running || autoState.batchTaskRunning);
    const preserveAutoQueueWaitingReply = (
      autoQueueRunning
      && autoQueueWaitingReply
      && (
        action === 'auto-continue'
        || action === 'auto-continue-until-done'
      )
      && owner === 'send-message'
    );

    if (preserveAutoQueueWaitingReply) {
      const preservedLine = `[BUTTON_VIEW][WAITING_REPLY_NON_OWNER_PRESERVED] button=${action || '-'} owner=${owner}`
        + ` reason=${reason || '-'}`;
      console.log(preservedLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(preservedLine);
      }
      return {
        ...view,
        phase: TaskPhase.WAITING_REPLY,
        buttonPhase: 'waiting',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        suppressedWaitingReply: false,
      };
    }

    const idleText = resolveIdleBusinessTextForAction(action, snapshot, button);
    const line = `[BUTTON_VIEW][WAITING_REPLY_NON_OWNER_SUPPRESSED] button=${action || '-'} owner=${owner}`
      + ` oldPhase=${String(view.phase || '-')} oldText=${String(view.text || '-')} reason=${reason || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }

    return {
      ...view,
      phase: TaskPhase.IDLE,
      buttonPhase: 'idle',
      disabled: true,
      allowCancel: false,
      action: 'none',
      preserveBaseColorWhenDisabled: true,
      text: idleText,
      title: view.title || '当前有其他任务正在等待回复，暂不可用',
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
    'closed-loop-without-hotkey',
    'copy-only',
    'copy-last-reply',
    'send-hotkey',
    'copy-hotkey-once',
    'copy-continue',
    'copy-log',
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
    'cgpt-open-chatgpt-home': 'click-new-chat',
    'cgpt-auto-continue-once': 'auto-continue',
    'cgpt-auto-continue-until-done': 'auto-continue-until-done',
    'cgpt-copy-last-message-scroll-bottom': 'copy-only',
    'cgpt-copy-hotkey-continue-once': 'copy-hotkey-continue',
    'cgpt-copy-hotkey-continue-loop': 'loop-copy-hotkey-continue',
    'cgpt-closed-loop-upload-every5-hotkey-btn': 'closed-loop-with-hotkey',
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
      };
    }

    if (
      snapshot.batchTaskRunning === true
      && snapshot.batchAfterInitialStrict === true
      && !snapshot.batchAutoUploading
      && Number(snapshot.currentRunSentCount || 0) > 0
    ) {
      return {
        phase: TaskPhase.DISABLED,
        text: '继续轮次中',
        title: '首轮已发送，批量继续轮次由 AutoQueue 自动调度上传，请勿手动点上传',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
      };
    }

    const legacyWaitingReply = !!(
      snapshot.legacyFlags
      && snapshot.legacyFlags.waitingReply
    );

    const sendPhaseWaitingReply = String(
      snapshot.sendTask && snapshot.sendTask.phase || '',
    ).trim() === 'waiting_reply';

    if (legacyWaitingReply || sendPhaseWaitingReply) {
      return {
        phase: TaskPhase.DISABLED,
        text: '等待回复',
        title: '当前正在等待回复，禁止上传，避免打断批量任务',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
      };
    }

    const task = snapshot.uploadTask && typeof snapshot.uploadTask === 'object'
      ? snapshot.uploadTask
      : {};
    const phase = normalizeTaskPhase(task.phase);
    const uploadRunning = phase === TaskPhase.UPLOADING || phase === TaskPhase.CANCELLING;
    const moduleInitState = String(snapshot.moduleInitState || '').trim().toLowerCase();
    const moduleInitError = String(snapshot.moduleInitError || '').trim();

    const batchBlockedReason = String(snapshot.batchBlockedReason || '').trim();
    const batchTaskRunning = snapshot.batchTaskRunning === true;
    const batchBlocksUpload = batchTaskRunning && (
      batchBlockedReason === 'conversation_id_lost'
      || batchBlockedReason === 'batch_conversation_id_not_initialized'
    );

    if (batchBlocksUpload) {
      return {
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
      };
    }

    if (moduleInitState === 'initializing') {
      return {
        phase: TaskPhase.INITIALIZING,
        text: '初始化中',
        title: '上传模块初始化中，请稍候',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'initializing',
      };
    }

    if (moduleInitState === 'failed' && moduleInitError) {
      return {
        phase: TaskPhase.FAILED,
        text: '上传失败，点击重试',
        title: moduleInitError,
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (task.cancelRequested || phase === TaskPhase.CANCELLING) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在停止',
        title: '正在停止上传，请稍候',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      const lastError = String(snapshot.lastRealUploadError || '').trim();
      const failTitle = lastError || '上传失败，点击重新上传';
      return {
        phase: TaskPhase.FAILED,
        text: '上传失败，点击重试',
        title: failTitle,
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.IDLE,
        text: '开始上传',
        title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    if (phase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已取消',
        title: '上传已取消',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (task.parentTask === 'copyHotkeyContinueLoop' && uploadRunning) {
      const cycleIndex = Number(task.cycleIndex) || 0;
      const cycleLabel = cycleIndex > 0 ? `第 ${cycleIndex} 轮` : '循环';
      return {
        phase: TaskPhase.UPLOADING,
        text: `${cycleLabel}自动上传中`,
        title: '连续复制循环触发的自动上传，停止请点对应循环按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'waiting',
      };
    }

    if (uploadRunning) {
      return {
        phase: TaskPhase.UPLOADING,
        text: '上传中',
        title: '上传中',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }
    return {
      phase: TaskPhase.IDLE,
      text: '开始上传',
      title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getSendMessageButtonViewState(snapshot = {}, capability = {}, hints = {}) {
    const phase = getNormalizedSendTaskPhase(snapshot);

    const failureHint = typeof hints.failureHint === 'string' ? hints.failureHint : '';
    const successHint = typeof hints.successHint === 'string' ? hints.successHint : '';
    const pendingSendAfterReply = !!hints.pendingSendAfterReply;
    const pendingAttachmentWaitSend = !!hints.pendingAttachmentWaitSend;

    capability = capability && typeof capability === 'object' ? capability : {};
    const hasComposer = !!capability.hasComposer;
    const isResponding = !!capability.isResponding;
    const finish = (view) => {
      // 防御性：避免在某些打包/作用域差异下出现 ReferenceError
      // （用户日志里出现过 `logButtonViewStateGuard is not defined`）
      return typeof logButtonViewStateGuard === 'function'
        ? logButtonViewStateGuard('send-message', phase, view, snapshot, capability)
        : view;
    };

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
        waitText = '等待输入框';
        waitTitle = '输入框尚未就绪';
      } else if (hasAttachment && nativeReady) {
        waitText = capability.isResponding ? '发送中' : '等待点击发送';
        waitTitle = capability.isResponding
          ? '原生发送按钮已就绪，正在进入发送流程'
          : '原生发送按钮已可点击，正在准备触发发送';
      } else if (hasAttachment && (!nativeReady || capability.isResponding)) {
        waitText = '等待附件';
        waitTitle = '附件仍在上传或处理中';
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
        text: '发送中',
        title: '正在发送',
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
      return finish({
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '正在等待 ChatGPT 回复完成',
        disabled: false,
        allowCancel: true,
        action: 'cancel-wait-reply',
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
          buttonPhase: 'waiting',
        };
      }
      return {
        phase: rawPhase || phase || TaskPhase.RUNNING,
        text: '处理中...',
        title: '复制+快捷键流程进行中；再次点击将请求取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
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

    if (phase === TaskPhase.WAITING_REPLY || isAutoQueueWaitingReplyPhase()) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复',
        title: '正在等待 ChatGPT 回复完成',
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
    const shared = getAutoContinueButtonViewState(autoState);
    const autoQueueSharedHint = '（与「无限继续」共用 AutoQueue 运行态）';
    const running = shared.phase !== TaskPhase.IDLE
      && shared.phase !== TaskPhase.SUCCESS
      && shared.phase !== TaskPhase.FAILED
      && shared.phase !== TaskPhase.CANCELLED;

    if (running) {
      return {
        ...shared,
        text: shared.action === 'stop' ? '停止智能继续' : shared.text,
        title: shared.title
          ? `${shared.title}${autoQueueSharedHint}`
          : `当前自动继续任务正在运行${autoQueueSharedHint}`,
        buttonPhase: shared.buttonPhase === 'idle' ? 'running' : shared.buttonPhase,
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '无限继续直到完成',
      title: '循环发送强约束继续指令；只有检测到严格完成信号才停止',
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
    if (snapshot.assistantBusy) {
      return 'answering';
    }
    return 'idle';
  }

  function isClosedLoopActionName(action) {
    const normalized = String(action || '').trim();
    return normalized === 'closed-loop-with-hotkey'
      || normalized === 'closed-loop-without-hotkey'
      || normalized === 'closed-loop-upload-continue-hotkey'
      || normalized === 'closed-loop-upload-continue';
  }

  function isEffectiveReplyBusy(snapshot = {}, capability = {}) {
    const cap = capability && typeof capability === 'object' ? capability : {};
    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    const pageReplyStatus = getPageReplyStatus(snapshot);
    return !!(
      sendPhase === TaskPhase.WAITING_REPLY
      || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
      || sendPhase === TaskPhase.SENDING
      || isLegacySendWaitingReply(snapshot)
      || isLegacyMessageSending(snapshot)
      || snapshot.assistantBusy
      || cap.isResponding
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
      'cancel-upload',
      'copy-log',
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

    if (normalized === 'cancel-send' || normalized === 'cancel-wait-reply' || normalized === 'cancel-upload') {
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
    } else if (normalized === 'copy-log') {
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

  function getClosedLoopContinueButtonViewState(snapshot = {}, mode = 'with_hotkey') {
    const running = !!snapshot.closedLoopContinueRunning;
    const stopping = !!snapshot.closedLoopContinueStopping;
    const activeMode = String(snapshot.closedLoopContinueMode || 'with_hotkey');
    const isHotkeyMode = mode !== 'without_hotkey';
    const interval = Number(snapshot.closedLoopUploadInterval || 5) || 5;
    const fallbackLabel = isHotkeyMode
      ? `闭环继续+快捷键+每${interval}轮上传`
      : `闭环继续+每${interval}轮上传`;
    const label = snapshot.closedLoopLabel || fallbackLabel;
    const isActiveMode = running && activeMode === (isHotkeyMode ? 'with_hotkey' : 'without_hotkey');
    const buttonName = isHotkeyMode ? 'closed-loop-with-hotkey' : 'closed-loop-without-hotkey';

    if (isActiveMode) {
      const loopTask = snapshot.copyHotkeyUploadVerifyLoopTask && typeof snapshot.copyHotkeyUploadVerifyLoopTask === 'object'
        ? snapshot.copyHotkeyUploadVerifyLoopTask
        : {};
      const loopPhase = String(loopTask.phase || '').trim().toLowerCase();
      if (!stopping && loopPhase === 'paused') {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_STATE][PAUSED] button=${buttonName} mode=${mode} round=${loopTask.round != null ? loopTask.round : '-'}`,
          );
        }
        return {
          phase: 'paused',
          text: '已暂停',
          title: loopTask.lastError
            ? `闭环已暂停：${String(loopTask.lastError)}。请检查后手动停止或重新开始`
            : '闭环已暂停，请检查后手动停止或重新开始',
          disabled: false,
          allowCancel: false,
          action: 'stop',
          buttonPhase: 'paused',
        };
      }
      return {
        phase: stopping ? 'stopping' : TaskPhase.RUNNING,
        text: stopping ? '正在停止闭环继续' : '停止闭环继续',
        title: stopping
          ? '正在停止闭环继续任务'
          : `${label}运行中`,
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.closedLoopLabel || label,
      title: snapshot.closedLoopTitle
        || (isHotkeyMode
          ? `等待回复完成 -> 复制 -> 快捷键 -> 继续；第 1 轮与每 ${interval} 轮自动上传代码`
          : `等待回复完成 -> 复制 -> 继续；第 1 轮与每 ${interval} 轮自动上传代码`),
      disabled: running,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
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
      if (base.text === '等待输入框') {
        return { ...base, phase: ButtonState.Phase.WAITING_INPUT };
      }
      if (base.text === '等待附件') {
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
    if (buttonPhase === 'danger' && view.allowCancel !== true) {
      return { ...base, phase: ButtonState.Phase.DANGER, permanentDanger: true };
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

    if (action === 'copy-log') {
      resolvedView = {
        ...resolvedView,
        phase: TaskPhase.IDLE,
        buttonPhase: 'idle',
        disabled: false,
        allowCancel: false,
        action: 'copy-log',
        preserveBaseColorWhenDisabled: false,
      };
    }

    if (action) {
      const decide = computeUploadActionDisabled(action, snapshot);
      const viewDisabled = !!view.disabled;
      const runtimeAction = String(
        resolvedView.action
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
        && (runtimeAction === 'cancel' || runtimeAction === 'stop')
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
        || action === 'cancel-upload'
        || action === 'copy-log'
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
        || action === 'cancel-upload'
        || action === 'copy-log'
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
    const options = isSendBtn
      ? mapSendMessageViewStateToToolboxOptions(resolvedView, reason)
      : mapViewStateToToolboxOptions(resolvedView, reason);
    button.dataset.cgptTaskPhase = resolvedView.phase || TaskPhase.IDLE;

    const runtimeAction = String(resolvedView.action || '').trim();
    if (canonicalAction) {
      button.dataset.cgptBaseAction = canonicalAction;
      button.dataset.action = canonicalAction;
    }

    if (typeof ButtonState !== 'undefined' && typeof ButtonState.setButtonRuntimeAction === 'function') {
      ButtonState.setButtonRuntimeAction(button, runtimeAction);
    } else if (runtimeAction) {
      button.dataset.cgptRuntimeAction = runtimeAction;
    } else {
      delete button.dataset.cgptRuntimeAction;
    }
    delete button.dataset.cgptButtonAction;
    button.dataset.cgptTaskSubPhase = String(resolvedView.subPhase || resolvedView.subphase || '').trim();

    syncUploadButtonIndicatorClasses(button, resolvedView);

    const changed = ButtonState.setToolboxButtonState(button, options);
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
    actionsMatchWaitingReplyOwner,
    isViewShowingWaitingReply,
    suppressNonOwnerWaitingReplyView,
    buildPageReplyBusyIdleDisabledView,
    isClosedLoopActionName,
    computeUploadActionDisabled,
    logButtonDisabledDecide,
    mapViewStateToToolboxOptions,
    mapSendMessageViewStateToToolboxOptions,
    mapTaskPhaseToButtonPhase: mapTaskPhaseToButtonStatePhase,
    applyUploadButtonViewState,
  });
