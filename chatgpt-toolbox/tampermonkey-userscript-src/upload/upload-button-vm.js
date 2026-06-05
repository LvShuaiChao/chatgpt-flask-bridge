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

  function getToolboxAuthorityFromSnapshot(snapshot = {}) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const unified = snap.toolboxUnifiedAuthority;
    if (unified && typeof unified === 'object' && unified.reply) {
      const flags = unified.flags && typeof unified.flags === 'object' ? unified.flags : {};
      const usage = unified.usage && typeof unified.usage === 'object' ? unified.usage : {};
      const replyBusy = flags.replyBusy === true;
      const uploadQuotaExceeded = !!(
        flags.uploadQuotaExceeded === true
        || usage.uploadQuotaExceeded === true
      );
      const uploadQuotaRemaining = Number.isFinite(Number(flags.uploadQuotaRemaining))
        ? Number(flags.uploadQuotaRemaining)
        : Number.isFinite(Number(usage.uploadQuotaRemaining))
          ? Number(usage.uploadQuotaRemaining)
          : -1;
      return {
        isToolboxStatusAuthoritySnapshot: true,
        replyText: unified.reply.text || '',
        replyAnswering: replyBusy || flags.answering === true,
        replyWaiting: replyBusy,
        replyBusy,
        replyReady: flags.ready === true,
        // 仅旧日志/文案兼容，不参与按钮决策
        shouldWaitReplyByTopStatus: replyBusy,
        canSendByTopStatus: flags.canSend === true,
        canStartUploadByTopStatus: flags.canUpload === true,
        uploadQuotaExceeded,
        uploadQuotaRemaining,
        canUploadByHeader: flags.canUpload === true,
        responseState: unified.raw && unified.raw.responseState ? unified.raw.responseState : '',
        responseReason: unified.raw && unified.raw.responseReason ? unified.raw.responseReason : '',
        topReplyStatus: snap.topReplyStatus || {},
      };
    }
    if (
      snap.uploadQuotaExceeded !== undefined
      || snap.canUploadByHeader !== undefined
      || snap.uploadQuotaRemaining !== undefined
    ) {
      return {
        isToolboxStatusAuthoritySnapshot: true,
        uploadQuotaExceeded: snap.uploadQuotaExceeded === true,
        uploadQuotaRemaining: Number.isFinite(Number(snap.uploadQuotaRemaining))
          ? Number(snap.uploadQuotaRemaining)
          : -1,
        canUploadByHeader: snap.canUploadByHeader === true,
        replyBusy: snap.replyBusy === true,
        canStartUploadByTopStatus: snap.canUploadByHeader === true,
        topReplyStatus: snap.topReplyStatus || {},
      };
    }
    const candidates = [
      snap.toolboxStatusAuthority,
      snap.statusAuthority,
      snap.topStatusAuthority,
    ];
    for (const item of candidates) {
      if (
        item
        && typeof item === 'object'
        && item.isToolboxStatusAuthoritySnapshot === true
      ) {
        return item;
      }
    }
    return null;
  }

  function getTopReplyStatusFromSnapshot(snapshot = {}) {
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return {
        ...(authority.topReplyStatus || {}),
        text: authority.replyText || '',
        answering: authority.replyAnswering === true,
        waitingReply: authority.replyWaiting === true,
        sending: authority.replySending === true,
        ready: authority.replyReady === true,
        blocked: authority.replyBlocked === true,
        offline: authority.replyOffline === true,
        busy: authority.replyBusy === true,
        responseState: authority.responseState || '',
        responseReason: authority.responseReason || '',
      };
    }
    const status = snapshot.topReplyStatus && typeof snapshot.topReplyStatus === 'object'
      ? snapshot.topReplyStatus
      : {};
    const text = String(status.text || '').trim();
    const responseState = String(status.responseState || '').trim().toLowerCase();
    const responseReason = String(status.responseReason || '').trim().toLowerCase();
    const answering = !!(
      status.answering
      || text === '回答中'
      || responseState === 'generating'
      || responseState === 'responding'
      || responseState === 'streaming'
      || responseState === 'answering'
      || responseReason === 'assistant_busy'
      || responseReason === 'response_in_progress'
    );
    const waitingReply = !!(
      status.waitingReply
      || text === '等回复'
      || text === '等待回复'
      || text.includes('等回复')
      || text.includes('等待回复')
      || responseState === 'waiting_reply'
      || responseState === 'waiting_response'
      || responseState === 'sent_waiting_response'
      || responseState === 'native_send_confirmed'
      || responseReason === 'waiting_reply'
      || responseReason === 'waiting_response'
      || responseReason === 'sent_waiting_response'
      || responseReason === 'native_send_confirmed'
    );
    const sending = !!(
      status.sending
      || text === '发送中'
    );
    const ready = !!(
      status.ready
      || text === '待发送'
      || text === '可发送'
      || text === '可输入'
      || text === '就绪'
    );
    return {
      ...status,
      text,
      answering,
      waitingReply,
      sending,
      ready,
      busy: answering || waitingReply || sending || !!status.busy,
    };
  }

  function isTopReplyBusyForButtons(reasonOrSnapshot) {
    if (reasonOrSnapshot && typeof reasonOrSnapshot === 'object') {
      const snapshot = reasonOrSnapshot;
      const authority = getToolboxAuthorityFromSnapshot(snapshot);
      if (authority && typeof authority === 'object') {
        return authority.replyBusy === true;
      }
      return snapshot.replyBusy === true
        || snapshot.replyAnswering === true
        || snapshot.replyWaiting === true
        || snapshot.answering === true
        || snapshot.waitingReply === true;
    }
    const reason = typeof reasonOrSnapshot === 'string'
      ? reasonOrSnapshot
      : 'upload-button-vm:isTopReplyBusyForButtons';
    const snapshot = getButtonAuthoritySnapshot(reason);
    return snapshot.replyBusy === true;
  }

  function isTopReplyAnsweringForButtons(snapshot = {}) {
    return isAuthorityReplyAnsweringForButtons(snapshot);
  }

  function isTopReplyWaitingForButtons(snapshot = {}) {
    return isAuthorityReplyWaitingForButtons(snapshot);
  }

  function getButtonAuthoritySnapshot(reason) {
    const startedAt = Date.now();
    try {
      if (
        window.ToolboxButtonState
        && typeof window.ToolboxButtonState.resolveButtonAuthoritySnapshot === 'function'
      ) {
        const snapshot = window.ToolboxButtonState.resolveButtonAuthoritySnapshot(
          reason || 'upload-button-vm:getButtonAuthoritySnapshot',
        );
        console.log('[UPLOAD_BUTTON_VM][AUTHORITY_USED]', {
          reason: reason || '',
          source: snapshot && snapshot.source,
          replyBusy: snapshot && snapshot.replyBusy,
          taskBusy: snapshot && snapshot.taskBusy,
          attachmentBusy: snapshot && snapshot.attachmentBusy,
          closedLoopRunning: snapshot && snapshot.closedLoopRunning,
          pendingSend: snapshot && snapshot.pendingSend,
          realSendReady: snapshot && snapshot.realSendReady,
          sendable: snapshot && snapshot.sendable,
          inputable: snapshot && snapshot.inputable,
          sendPhase: snapshot && snapshot.sendPhase,
          disabledReason: snapshot && snapshot.disabledReason,
          buttonColorRole: snapshot && snapshot.buttonColorRole,
          costMs: Date.now() - startedAt,
        });
        return snapshot;
      }
      if (
        typeof ButtonState !== 'undefined'
        && ButtonState
        && typeof ButtonState.resolveButtonAuthoritySnapshot === 'function'
      ) {
        return ButtonState.resolveButtonAuthoritySnapshot(
          reason || 'upload-button-vm:getButtonAuthoritySnapshot',
        );
      }
      console.error('[UPLOAD_BUTTON_VM][AUTHORITY_MISSING]', {
        reason: reason || '',
        costMs: Date.now() - startedAt,
      });
      return {
        replyBusy: true,
        taskBusy: false,
        attachmentBusy: false,
        closedLoopRunning: false,
        pendingSend: false,
        realSendReady: false,
        canSend: false,
        canInput: false,
        canUpload: false,
        sendable: false,
        inputable: false,
        sendPhase: 'authority_missing',
        disabledReason: 'button_authority_missing',
        buttonColorRole: 'blocked',
        source: 'upload-button-vm:fallback-authority-missing',
        ts: Date.now(),
      };
    } catch (e) {
      console.error('[UPLOAD_BUTTON_VM][AUTHORITY_FAILED]', {
        reason: reason || '',
        error: e && e.stack ? e.stack : String(e),
        costMs: Date.now() - startedAt,
      });
      return {
        replyBusy: true,
        taskBusy: false,
        attachmentBusy: false,
        closedLoopRunning: false,
        pendingSend: false,
        realSendReady: false,
        canSend: false,
        canInput: false,
        canUpload: false,
        sendable: false,
        inputable: false,
        sendPhase: 'authority_error',
        disabledReason: 'button_authority_error',
        buttonColorRole: 'blocked',
        source: 'upload-button-vm:fallback-authority-error',
        ts: Date.now(),
      };
    }
  }

  function isAuthorityReplyBusyForButtons(reasonOrSnapshot) {
    const reason = typeof reasonOrSnapshot === 'string'
      ? reasonOrSnapshot
      : 'upload-button-vm:isAuthorityReplyBusyForButtons';
    const snapshot = typeof reasonOrSnapshot === 'object' && reasonOrSnapshot
      ? reasonOrSnapshot
      : getButtonAuthoritySnapshot(reason);
    return snapshot.replyBusy === true;
  }

  function isAuthorityGlobalBusyForButtons(reasonOrSnapshot) {
    const reason = typeof reasonOrSnapshot === 'string'
      ? reasonOrSnapshot
      : 'upload-button-vm:isAuthorityGlobalBusyForButtons';
    const snapshot = typeof reasonOrSnapshot === 'object' && reasonOrSnapshot
      ? reasonOrSnapshot
      : getButtonAuthoritySnapshot(reason);
    return snapshot.replyBusy === true
      || snapshot.taskBusy === true
      || snapshot.attachmentBusy === true;
  }

  function isAuthorityReplyAnsweringForButtons(reasonOrSnapshot = {}) {
    const hasSnapshot = reasonOrSnapshot && typeof reasonOrSnapshot === 'object';
    const snapshot = hasSnapshot
      ? reasonOrSnapshot
      : getButtonAuthoritySnapshot(
        typeof reasonOrSnapshot === 'string'
          ? reasonOrSnapshot
          : 'upload-button-vm:isAuthorityReplyAnsweringForButtons',
      );
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return authority.replyBusy === true || authority.replyAnswering === true;
    }
    return snapshot.replyBusy === true
      || snapshot.replyAnswering === true
      || snapshot.answering === true;
  }

  function isAuthorityReplyWaitingForButtons(reasonOrSnapshot = {}) {
    const hasSnapshot = reasonOrSnapshot && typeof reasonOrSnapshot === 'object';
    const snapshot = hasSnapshot
      ? reasonOrSnapshot
      : getButtonAuthoritySnapshot(
        typeof reasonOrSnapshot === 'string'
          ? reasonOrSnapshot
          : 'upload-button-vm:isAuthorityReplyWaitingForButtons',
      );
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return authority.replyBusy === true || authority.replyWaiting === true;
    }
    return snapshot.replyBusy === true
      || snapshot.replyWaiting === true
      || snapshot.waitingReply === true;
  }

  function decorateIdleViewWithTopReplyStatus(view, snapshot = {}, options = {}) {
    const phase = normalizeTaskPhase(view && view.phase);
    if (phase !== TaskPhase.IDLE) {
      return view;
    }
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isAuthorityReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isAuthorityReplyWaitingForButtons(snapshot);
    if (!topReplyAnswering && !topReplyWaiting) {
      return view;
    }
    const statusText = String(topReplyStatus.text || '').trim() || (topReplyAnswering ? '回答中' : '等待回复');
    return {
      ...view,
      title: options.titleWhenBusy
        || `当前状态：${statusText}；回复完成后再操作`,
      phase: TaskPhase.IDLE,
      buttonPhase: 'idle',
      forceDanger: false,
      allowCancel: false,
      pageBusyButNotOwner: true,
      preserveBaseColorWhenDisabled: true,
    };
  }

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
    const buttonPhase = String(view.buttonPhase || '').trim().toLowerCase();
    return phase === TaskPhase.WAITING_REPLY
      || buttonPhase === 'waiting_reply_idle'
      || view.phase === 'waiting_reply_idle'
      || text === '等待回复'
      || text === '等待回复完成'
      || text === '等待回复中'
      || text === '等待回复后闭环';
  }

  function isClosedLoopStartPendingForAction(action, snapshot = {}) {
    if (
      typeof ClosedLoopButtonVm !== 'undefined'
      && typeof ClosedLoopButtonVm.isClosedLoopStartPendingForAction === 'function'
    ) {
      return ClosedLoopButtonVm.isClosedLoopStartPendingForAction(action, snapshot);
    }
    const pending = snapshot.closedLoopStartPending;
    if (!pending || typeof pending !== 'object') {
      return false;
    }
    const normalizedAction = String(action || '').trim();
    const pendingAction = String(pending.action || '').trim();
    return !!normalizedAction && normalizedAction === pendingAction;
  }

  function shouldShowClosedLoopBusyStyle(view = {}, snapshot = {}, action = '') {
    const normalizedAction = String(action || '').trim();
    const isPending = view.isThisClosedLoopPending === true
      || view.buttonPhase === 'waiting_reply_idle'
      || isClosedLoopStartPendingForAction(normalizedAction, snapshot);
    const isRunningOwner = snapshot.closedLoopContinueRunning === true
      && isClosedLoopOwnerAction(normalizedAction, snapshot);
    return isRunningOwner || isPending;
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

  function isStaleSendMessageOwnerByPageSnapshot(snapshot = {}, reason = '') {
    const authority = (
      snapshot.toolboxStatusAuthority
      || snapshot.statusAuthority
      || snapshot.topStatusAuthority
      || snapshot.toolboxUnifiedAuthority
      || {}
    );
    const replyState = String(
      authority.replyState
      || (authority.reply && authority.reply.state)
      || snapshot.replyState
      || '',
    ).trim().toLowerCase();
    const composerTextLen = Number(
      authority.composerTextLen
      || (authority.composer && authority.composer.textLen)
      || snapshot.composerTextLen
      || 0,
    ) || 0;
    const realSendButtonFound = !!(
      authority.realSendButtonFound
      || (authority.composer && authority.composer.hasRealSendButton)
      || snapshot.realSendButtonFound
    );
    const responseState = String(
      authority.responseState
      || authority.responseStateRaw
      || (authority.raw && authority.raw.responseState)
      || snapshot.responseState
      || '',
    ).trim().toLowerCase();

    return (
      replyState === 'ready'
      && composerTextLen === 0
      && !realSendButtonFound
      && responseState === 'idle'
    );
  }

  function isRealSendMessageTaskRunning(sendMessageTask, snapshot = {}, reason = '') {
    const sendPhase = sendMessageTask && sendMessageTask.phase
      ? String(sendMessageTask.phase).trim().toLowerCase()
      : '';

    const isRealSendTaskRunning =
      sendMessageTask
      && sendMessageTask.running === true
      && !['idle', 'done', 'failed', 'cancelled'].includes(sendPhase);

    if (!isRealSendTaskRunning) {
      return false;
    }

    if (isStaleSendMessageOwnerByPageSnapshot(snapshot, reason)) {
      console.warn('[BUTTON_OWNER][IGNORE_STALE_SEND_MESSAGE]', {
        reason,
        sendPhase,
        replyState: 'ready',
        composerTextLen: 0,
        realSendButtonFound: 0,
        responseState: 'idle',
      });
      return false;
    }

    return true;
  }

  function logBatchOwnerPriorityUsed(owner, phase, source) {
    const line = `[BUTTON_OWNER][BATCH_PRIORITY_USED] owner=batch-task-group phase=${phase || '-'} source=${source || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
    void owner;
  }

  function logButtonOwnerMismatch(expectedOwner, actualOwner, buttonId, reason) {
    const actual = actualOwner && typeof actualOwner === 'object'
      ? String(actualOwner.action || actualOwner.owner || '-')
      : String(actualOwner || '-');
    const line = `[BUTTON_OWNER][MISMATCH] expected=${expectedOwner || 'batch-task-group'} actual=${actual} button=${buttonId || '-'} reason=${reason || '-'}`;
    console.error(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logBatchOwnerMismatch(actualOwner, source, buttonId) {
    logButtonOwnerMismatch('batch-task-group', actualOwner, buttonId, source);
  }

  function logButtonOwnerNonOwnerSuppressed(runningOwnerAction, currentAction, buttonId) {
    const line = `[BUTTON_OWNER][NON_OWNER_SUPPRESSED] owner=${runningOwnerAction || '-'} buttonAction=${currentAction || '-'} buttonId=${buttonId || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function getBatchTaskGroupOwnerFromSnapshot(snapshot = {}) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const batchRunning = !!(
      snap.batchTaskRunning === true
      || snap.batchTaskGroupRunning === true
      || (snap.batchTask && snap.batchTask.running === true)
      || (snap.autoQueueState && snap.autoQueueState.batchTaskRunning === true)
      || (
        snap.autoQueueState
        && snap.autoQueueState.running === true
        && snap.autoQueueState.promptMode === 'task'
      )
    );
    if (!batchRunning) {
      if (
        typeof AutoQueueModule !== 'undefined'
        && AutoQueueModule
        && typeof AutoQueueModule.getState === 'function'
      ) {
        const autoState = AutoQueueModule.getState() || {};
        if (autoState.batchTaskRunning === true) {
          return {
            action: 'batch-task-group',
            owner: 'batch-task-group',
            buttonId: 'cgpt-autoq-start',
            ownerButtonId: 'cgpt-autoq-start',
            phase: String(autoState.phase || 'running').trim().toLowerCase() || 'running',
            source: 'batch-task-group',
          };
        }
      }
      return null;
    }
    let phase = String(snap.batchTaskPhase || snap.phase || '').trim().toLowerCase();
    if (!phase && snap.batchTask && snap.batchTask.phase) {
      phase = String(snap.batchTask.phase).trim().toLowerCase();
    }
    return {
      action: 'batch-task-group',
      owner: 'batch-task-group',
      buttonId: 'cgpt-autoq-start',
      ownerButtonId: 'cgpt-autoq-start',
      phase: phase || 'running',
      source: 'batch-task-group',
    };
  }

  function isRuntimeBatchTaskGroupRunning(runtimeState = {}) {
    return !!getBatchTaskGroupOwnerFromSnapshot(runtimeState);
  }

  function buildBatchTaskGroupRunningOwner(runtimeState = {}) {
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(runtimeState);
    if (batchOwner) {
      return batchOwner;
    }
    return {
      action: 'batch-task-group',
      owner: 'batch-task-group',
      phase: 'running',
      source: 'batch-task-group',
      buttonId: 'cgpt-autoq-start',
      ownerButtonId: 'cgpt-autoq-start',
    };
  }

  function getRunningOwnerFromSnapshot(snapshot = {}) {
    return getToolboxRunningOwnerFromRuntime(snapshot);
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
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(runtimeState);
    if (batchOwner) {
      let resolvedOwner = null;
      if (runtimeState.runningOwner && typeof runtimeState.runningOwner === 'object') {
        resolvedOwner = runtimeState.runningOwner;
      } else if (typeof window !== 'undefined' && window.__cgptToolboxRunningOwner) {
        resolvedOwner = window.__cgptToolboxRunningOwner;
      }
      if (
        resolvedOwner
        && String(resolvedOwner.action || resolvedOwner.owner || '').trim() !== 'batch-task-group'
      ) {
        logBatchOwnerMismatch(
          resolvedOwner,
          String(resolvedOwner.source || 'runtime-owner'),
          String(resolvedOwner.buttonId || resolvedOwner.ownerButtonId || '-'),
        );
      }
      logBatchOwnerPriorityUsed(batchOwner, batchOwner.phase, batchOwner.source);
      return batchOwner;
    }

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
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(snapshot);
    if (batchOwner) {
      return false;
    }
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
      || t === '环-快捷键模式+每1轮上传'
      || t === '闭环-快捷键模式+每轮上传'
      || t === '闭环-快捷键模式+每一轮上传'
      || t === '闭环-快捷键模式+每1轮上传'
      || t === '环-快捷键+每轮上传'
      || t === '环-快捷键+每一轮上传'
      || t === '环-快捷键+每1轮上传'
      || t === '闭环-快捷键+每轮上传'
      || t === '闭环-快捷键+每一轮上传'
      || t === '闭环-快捷键+每1轮上传'
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
    'cgpt-btn-closed-loop-waiting-reply',
    'cgpt-btn-danger',
    'cgpt-btn-stop',
    'cgpt-action-running',
  ];

  const CLOSED_LOOP_IDLE_CLASS_NAME = 'cgpt-btn cyan cgpt-btn-closed-loop cgpt-btn-closed-loop-idle';
  const CLOSED_LOOP_RUNNING_CLASS_NAME = 'cgpt-btn cgpt-btn-closed-loop cgpt-btn-danger cgpt-btn-stop cgpt-action-running';

  function getDefaultButtonColorByAction(action) {
    const a = String(action || '').trim();
    if (a === 'start-upload' || a === 'send-message') {
      return 'green';
    }
    if (a === 'send-copy-hotkey') {
      return 'purple';
    }
    if (
      a === 'copy-hotkey-once'
      || a === 'copy-hotkey-continue'
      || a === 'copy-only'
      || a === 'copy-log'
      || a === 'copy-error-log'
      || a === 'copy-and-hotkey'
      || a === 'copy-and-continue'
      || a === 'copy-continue'
    ) {
      return 'blue';
    }
    if (
      a === 'auto-continue'
      || a === 'auto-continue-until-done'
      || a === 'loop-copy-hotkey-continue'
    ) {
      return 'cyan';
    }
    if (a === 'click-new-chat' || a === 'home') {
      return 'orange';
    }
    if (a.includes('closed-loop')) {
      return 'cyan';
    }
    return 'blue';
  }

  function normalizeToolboxButtonColor(color, action) {
    const raw = String(color || '').trim().toLowerCase();
    if (
      raw === 'gray'
      || raw === 'grey'
      || raw === 'dark'
      || raw === 'black'
      || raw === 'disabled'
      || raw === 'muted'
    ) {
      return getDefaultButtonColorByAction(action);
    }
    return raw || getDefaultButtonColorByAction(action);
  }

  const TOOLBOX_BUTTON_SEMANTIC_COLOR_CLASSES = Object.freeze([
    'primary',
    'green',
    'blue',
    'purple',
    'cyan',
    'teal',
    'orange',
    'red',
    'success',
    'warning',
    'waiting',
    'danger',
    'gray',
    'grey',
    'dark',
    'black',
    'cgpt-btn-gray',
    'cgpt-btn-grey',
    'cgpt-btn-dark',
    'cgpt-btn-black',
  ]);

  function applyButtonSemanticColorClass(button, color, action) {
    if (!button) {
      return;
    }
    TOOLBOX_BUTTON_SEMANTIC_COLOR_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
    const normalized = normalizeToolboxButtonColor(color, action);
    if (normalized) {
      button.classList.add(normalized);
    }
  }

  function applyButtonDisabledVisualOnlyState(button, view = {}, action = '') {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const isPlainSendMessageButton = button.id === SEND_MESSAGE_OWNER_BUTTON_ID
      || String(action || '').trim() === 'send-message';
    if (
      isPlainSendMessageButton
      && (
        view.visualDim === false
        || button.dataset.visualDim === '0'
      )
    ) {
      button.classList.remove('cgpt-btn-disabled-visual');
      if (
        typeof ButtonState !== 'undefined'
        && typeof ButtonState.applyDisabledVisualOnlyState === 'function'
      ) {
        ButtonState.applyDisabledVisualOnlyState(button, false, 'plain-send-no-visual-dim');
      }
      return;
    }
    const disabledVisualOnly = view.disabledVisualOnly === true
      || view.disabled === true
      || button.disabled === true
      || button.getAttribute('aria-disabled') === 'true';
    const phase = String(view.buttonPhase || view.phase || '').trim().toLowerCase();
    const isRunning = phase === 'running'
      || phase === 'danger'
      || phase === 'sending'
      || phase === 'waiting'
      || phase === 'waiting_reply'
      || phase === 'waiting_response'
      || phase === 'uploading'
      || phase === 'uploading_before_send'
      || phase === 'preparing'
      || view.forceDanger === true
      || view.allowCancel === true;
    if (disabledVisualOnly && !isRunning) {
      button.classList.remove('cgpt-btn-disabled', 'gray', 'grey', 'dark', 'black');
      button.classList.add('cgpt-btn-disabled-visual');
      if (view.title || view.disabledReason) {
        button.dataset.disabledReason = String(view.disabledReason || view.title || '').trim();
      }
      if (
        typeof ButtonState !== 'undefined'
        && typeof ButtonState.applyDisabledVisualOnlyState === 'function'
      ) {
        ButtonState.applyDisabledVisualOnlyState(
          button,
          true,
          view.disabledReason || view.title || view.reason || '',
        );
      }
    } else if (!button.disabled) {
      button.classList.remove('cgpt-btn-disabled-visual');
    }
  }

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
    const idlePhase = view.buttonPhase === 'closed-loop-idle' || view.buttonPhase === 'cyan';
    const pageBusyIdle = view.pageBusyButNotClosedLoop === true
      || view.buttonPhase === 'idle_page_busy';
    const waitingReplyIdle = !pageBusyIdle && (
      view.buttonPhase === 'waiting_reply_idle'
      || view.phase === 'waiting_reply_idle'
      || view.isThisClosedLoopPending === true
    );
    if (
      options.phase === ButtonState.Phase.DANGER
      || view.forceDanger === true
      || view.buttonPhase === 'danger'
      || (view.allowCancel === true && !idlePhase && !waitingReplyIdle)
    ) {
      return 'red';
    }
    if (view.disabled === true || options.disabled === true) {
      return 'cyan';
    }
    if (waitingReplyIdle || options.phase === ButtonState.Phase.WAITING) {
      return 'waiting';
    }
    return 'cyan';
  }

  function logClosedLoopInvalidOrangeClass(button) {
    if (!button) {
      return;
    }
    const classText = String(button.className || '').trim();
    if (!/\borange\b|\bwarning\b|\bcgpt-btn-warning\b|\bcgpt-btn-closed-loop-orange\b/.test(classText)) {
      return;
    }
    const id = String(button.id || '-').trim() || '-';
    const line = `[CLOSED_LOOP_BUTTON][INVALID_ORANGE_CLASS] id=${id} class=${classText || '-'}`;
    console.error(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
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
    const busy = extra.busy === true ? 1 : 0;
    const classText = String(button.className || '').trim() || '-';
    const color = resolveClosedLoopStyleColorLabel(options, view);
    const line = `[CLOSED_LOOP_BUTTON][STYLE_DECIDE] id=${id} action=${action} running=${running} isOwner=${isOwner} busy=${busy} color=${color} class=${classText}`;
    logClosedLoopInvalidOrangeClass(button);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  const SEND_FAMILY_SWITCHABLE_PHASES = new Set([
    'waiting_input',
    'waiting_composer',
    'writing_text',
    'waiting_attachment',
    'waiting_send',
    'ready_to_click',
    'waiting',
    'checking_composer',
  ]);

  function getSendFamilyTaskFromSnapshot(snapshot = {}) {
    return snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : null;
  }

  const SEND_MESSAGE_OWNER_BUTTON_ID = 'cgpt-send-message-once';
  const COPY_HOTKEY_ONCE_OWNER_BUTTON_ID = 'cgpt-copy-hotkey-once';

  function isPlainSendMessageTask(task = {}) {
    const ownerButtonId = String(task && task.ownerButtonId || '').trim().toLowerCase();
    const ownerAction = String(
      task && (
        task.ownerAction
        || task.action
        || (task.plan && task.plan.mode)
        || task.buttonAction
        || task.runtimeAction
        || ''
      ),
    ).trim().toLowerCase();
    if (ownerAction === 'send-copy-hotkey') return false;
    if (ownerAction === 'send-copy-hotkey-continue') return false;
    if (ownerAction === 'copy-hotkey') return false;
    if (ownerAction === 'closed-loop') return false;
    if (ownerAction === 'batch-task') return false;
    if (ownerButtonId.includes('send-copy-hotkey')) return false;
    if (ownerButtonId.includes('copy-hotkey')) return false;
    if (ownerButtonId.includes('closed-loop')) return false;
    if (ownerButtonId.includes('batch')) return false;
    return (
      ownerAction === 'send-message'
      || ownerAction === 'send'
      || ownerButtonId.includes('send-message')
      || ownerButtonId.includes('send-button')
      || ownerButtonId === 'send'
    );
  }

  function isPlainSendButtonDangerPhase(phase) {
    const normalized = String(phase || '').trim().toLowerCase();
    return (
      normalized === 'waiting_composer'
      || normalized === 'waiting_send'
      || normalized === 'clicking_send'
      || normalized === 'submitting'
      || normalized === 'sending'
      || normalized === 'waiting_input'
      || normalized === 'waiting_attachment'
      || normalized === 'writing_text'
      || normalized === 'checking_composer'
      || normalized === 'waiting'
      || normalized === 'ready_to_click'
      || normalized === 'preparing'
      || normalized === 'auto_upload_before_send'
    );
  }

  function shouldPlainSendButtonShowRunningDanger(task = {}) {
    if (!isPlainSendMessageTask(task)) {
      return false;
    }
    if (!task || task.running !== true) {
      return false;
    }
    return isPlainSendButtonDangerPhase(task.phase);
  }

  function resolvePlainSendMessageVisualGate(snapshot = {}, capability = {}) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const topReplyStatus = getTopReplyStatusFromSnapshot(snap);
    const responseState = String(
      snap.responseState
      || topReplyStatus.responseState
      || topReplyStatus.key
      || topReplyStatus.text
      || '-',
    ).trim().toLowerCase();
    const responseReason = String(
      snap.responseReason
      || topReplyStatus.responseReason
      || snap.disabledReason
      || '',
    ).trim().toLowerCase();
    const replyBusy = snap.replyBusy === true
      || isTopReplyAnsweringForButtons(snap)
      || isTopReplyWaitingForButtons(snap);
    const taskBusy = snap.taskBusy === true;
    const attachmentBusy = snap.attachmentBusy === true;
    const pendingSend = snap.pendingSend === true;
    const hasCanonicalCanSend = Object.prototype.hasOwnProperty.call(snap, 'canSend');
    const hasCanonicalCanInput = Object.prototype.hasOwnProperty.call(snap, 'canInput');
    const sendable = hasCanonicalCanSend
      ? snap.canSend === true
      : snap.sendable === true;
    const inputable = hasCanonicalCanInput
      ? snap.canInput === true
      : snap.inputable === true;
    const realSendReady = snap.realSendReady === true;
    let disabledReason = String(snap.disabledReason || '').trim();
    if (!disabledReason) {
      if (replyBusy) {
        disabledReason = 'reply_busy';
      } else if (taskBusy) {
        disabledReason = 'task_busy';
      } else if (attachmentBusy) {
        disabledReason = 'attachment_busy';
      } else if (!sendable) {
        disabledReason = 'not_sendable';
      } else if (!inputable) {
        disabledReason = 'not_inputable';
      } else if (!realSendReady) {
        disabledReason = 'real_send_not_ready';
      }
    }
    const canSendNow = !!(
      sendable
      && inputable
      && realSendReady
      && !replyBusy
      && !taskBusy
      && !attachmentBusy
      && !disabledReason
    );
    const clickBlocked = !canSendNow;
    const gate = {
      responseState,
      responseReason,
      replyBusy,
      taskBusy,
      attachmentBusy,
      pendingSend,
      sendable,
      inputable,
      realSendReady,
      disabledReason,
      canSendNow,
      blockedBecauseAnswering: replyBusy,
      clickBlocked,
      visualDim: false,
      debugRawCapability: capability && typeof capability === 'object' ? capability : {},
    };
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[UPLOAD_BUTTON_VM][PLAIN_SEND_AUTHORITY_GATE] `
        + `responseState=${gate.responseState || '-'} `
        + `responseReason=${gate.responseReason || '-'} `
        + `sendable=${gate.sendable ? 1 : 0} `
        + `inputable=${gate.inputable ? 1 : 0} `
        + `replyBusy=${gate.replyBusy ? 1 : 0} `
        + `taskBusy=${gate.taskBusy ? 1 : 0} `
        + `attachmentBusy=${gate.attachmentBusy ? 1 : 0} `
        + `pendingSend=${gate.pendingSend ? 1 : 0} `
        + `realSendReady=${gate.realSendReady ? 1 : 0} `
        + `disabledReason=${gate.disabledReason || '-'} `
        + `canSendNow=${gate.canSendNow ? 1 : 0} `
        + `clickBlocked=${gate.clickBlocked ? 1 : 0}`,
      );
    } else {
      console.log('[UPLOAD_BUTTON_VM][PLAIN_SEND_AUTHORITY_GATE]', gate);
    }
    return gate;
  }

  function applyPlainSendMessageClickGate(button, snapshot = {}, capability = {}, reason = '') {
    if (!button || button.id !== SEND_MESSAGE_OWNER_BUTTON_ID) {
      return resolvePlainSendMessageVisualGate(snapshot, capability);
    }
    const gate = resolvePlainSendMessageVisualGate(snapshot, capability);
    button.dataset.visualDim = gate.visualDim ? '1' : '0';
    button.dataset.clickBlocked = gate.clickBlocked ? '1' : '0';
    button.dataset.disabledReason = gate.disabledReason || '';
    button.disabled = false;
    button.removeAttribute('disabled');
    button.setAttribute('aria-disabled', 'false');
    if (
      typeof ButtonState !== 'undefined'
      && typeof ButtonState.applyDisabledVisualOnlyState === 'function'
    ) {
      ButtonState.applyDisabledVisualOnlyState(button, false, reason || 'plain-send-click-gate');
    }
    button.classList.remove('cgpt-btn-disabled-visual');
    button.style.opacity = '';
    button.style.filter = '';
    if (gate.clickBlocked) {
      button.title = gate.disabledReason
        ? `当前不能直接发送：${gate.disabledReason}`
        : '当前不能直接发送，请等待页面状态就绪';
    }
    return gate;
  }

  function logSendMessageButtonVisualDecide(task, snapshot, capability, extra = {}) {
    const sendButtonPhase = String(task && task.phase || '').trim().toLowerCase();
    const isPlainSend = isPlainSendMessageTask(task);
    const sendButtonRunning = !!(task && task.running);
    const sendMessageDanger = shouldPlainSendButtonShowRunningDanger(task);
    const gate = resolvePlainSendMessageVisualGate(snapshot, capability);
    const line = (
      `[SEND_MESSAGE_BUTTON][VISUAL_DECIDE] `
      + `runId=${(task && task.runId) || '-'} `
      + `owner=${(task && task.ownerButtonId) || '-'} `
      + `phase=${sendButtonPhase || '-'} `
      + `plainSend=${isPlainSend ? 1 : 0} `
      + `running=${sendButtonRunning ? 1 : 0} `
      + `response_state=${gate.responseState || '-'} `
      + `replyBusy=${gate.replyBusy ? 1 : 0} `
      + `can_send_now=${gate.canSendNow ? 1 : 0} `
      + `blockedBecauseAnswering=${gate.blockedBecauseAnswering ? 1 : 0} `
      + `clickBlocked=${gate.clickBlocked ? 1 : 0} `
      + `danger=${sendMessageDanger ? 1 : 0} `
      + `visualDim=${gate.visualDim ? 1 : 0} `
      + `reason=${extra.reason || (sendMessageDanger ? 'sending-not-submitted' : 'not-owned-by-send-button-or-submitted')}`
    );
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    return sendMessageDanger;
  }

  function isSendMessageButtonOwner(snapshot = {}) {
    const task = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : {};
    if (task.running !== true) {
      return false;
    }
    const phase = normalizeButtonVmSendPhase(task.phase || task.subPhase || '');
    if (phase === 'idle' || phase === 'success' || phase === 'failed' || phase === 'cancelled') {
      return false;
    }
    const ownerButtonId = String(task.ownerButtonId || '').trim();
    const action = String(task.action || (task.plan && task.plan.mode) || 'send-message').trim();
    return ownerButtonId === SEND_MESSAGE_OWNER_BUTTON_ID || action === 'send-message';
  }

  function isCopyHotkeyOnceTaskRunning(snapshot = {}) {
    if (snapshot.copyHotkeyOnceActive === true) {
      return true;
    }
    const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
      ? snapshot.copyHotkeyOnceTask
      : {};
    if (task.running === true) {
      return true;
    }
    return resolveSnapshotTaskActive(snapshot, 'copyHotkeyOnceTask', 'copyHotkeyOnceActive');
  }

  function isCopyHotkeyOnceTaskOwner(snapshot = {}) {
    if (!isCopyHotkeyOnceTaskRunning(snapshot)) {
      return false;
    }
    const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
      ? snapshot.copyHotkeyOnceTask
      : {};
    const action = String(task.action || 'copy-hotkey-once').trim();
    const ownerButtonId = String(task.ownerButtonId || COPY_HOTKEY_ONCE_OWNER_BUTTON_ID).trim();
    return action === 'copy-hotkey-once'
      && ownerButtonId === COPY_HOTKEY_ONCE_OWNER_BUTTON_ID;
  }

  function isSendFamilyTaskSwitchable(task) {
    if (!task || task.running !== true) {
      return false;
    }
    if (task.nativeSendClicked || task.hasClickedNativeSend || Number(task.sentAt || 0) > 0) {
      return false;
    }
    const phase = String(task.phase || '').trim().toLowerCase();
    return SEND_FAMILY_SWITCHABLE_PHASES.has(phase);
  }

  function canSwitchSendFamilyAction(snapshot, targetAction) {
    const task = getSendFamilyTaskFromSnapshot(snapshot);
    if (!task || !task.running) {
      return false;
    }
    if (!isSendFamilyTaskSwitchable(task)) {
      return false;
    }
    const current = String(task.action || (task.plan && task.plan.mode) || 'send-message').trim();
    return current !== String(targetAction || '').trim();
  }

  function getSendMessageRunningTextByPhase(phase) {
    const p = String(phase || '').trim().toLowerCase();
    if (p === 'auto_upload_before_send') {
      return '上传中';
    }
    if (p === 'waiting_attachment') {
      return '等待附件';
    }
    if (
      p === 'waiting_input'
      || p === 'waiting_composer'
      || p === 'writing_text'
      || p === 'checking_composer'
      || p === 'waiting'
    ) {
      return '准备发送';
    }
    if (p === 'waiting_send' || p === 'ready_to_click') {
      return '等待发送按钮';
    }
    if (p === 'clicking_send' || p === 'sending') {
      return '发送中';
    }
    if (
      p === 'native_send_clicked'
      || p === 'waiting_reply'
      || p === 'sent_waiting_response'
      || p === 'answering'
      || p === 'stopping_response'
    ) {
      return '等待回复';
    }
    if (p === 'waiting_page_reply_to_send') {
      return '等待页面回复后发送';
    }
    if (p === 'failed') {
      return '发送失败';
    }
    if (p === 'canceled' || p === 'cancelled') {
      return '已取消';
    }
    if (p === 'cancelling') {
      return '取消中';
    }
    return '发送中';
  }

  const SEND_COPY_HOTKEY_BUTTON_LABEL = '发送+复制+快捷键';

  function getSendCopyHotkeyRunningTextByPhase(phase) {
    const p = String(phase || '').trim().toLowerCase();
    if (p === 'preparing') {
      return '准备中';
    }
    if (p === 'preparing_upload') {
      return '准备上传';
    }
    if (p === 'uploading_before_send' || p === 'auto_upload_before_send') {
      return '等待上传';
    }
    if (p === 'waiting_send_ready') {
      return '等待发送就绪';
    }
    if (p === 'sending' || p === 'waiting_send') {
      return '发送中';
    }
    if (p === 'waiting_reply' || p === 'waiting_response') {
      return '等待回复';
    }
    if (p === 'copying' || p === 'copy_hotkey' || p === 'copy_hotkey_core') {
      return '复制中';
    }
    if (p === 'hotkey_sending' || p === 'sending_hotkey') {
      return '发送快捷键';
    }
    if (p === 'paused_background_throttled') {
      return '等待前台';
    }
    if (p === 'failed') {
      return '执行失败';
    }
    if (p === 'cancelled' || p === 'canceled') {
      return '已取消';
    }
    return SEND_COPY_HOTKEY_BUTTON_LABEL;
  }

  function getSendLikePendingRunningText(action, phase) {
    const act = String(action || '').trim();
    const p = String(phase || '').trim().toLowerCase();
    if (act === 'send-copy-hotkey') {
      return getSendCopyHotkeyRunningTextByPhase(p);
    }
    if (p === 'waiting_reply') {
      return '等待页面回复后发送';
    }
    return getSendMessageRunningTextByPhase(p);
  }

  const SEND_MESSAGE_RUNNING_CANCEL_TITLE =
    '发送任务正在进行中；再次点击将取消本次发送流程';

  function logSendButtonTextDecide(buttonId, phase, view = {}, tag = 'SEND_BUTTON') {
    const text = String(view.text || '').trim();
    const runtimeAction = String(view.runtimeAction || view.action || '').trim() || '-';
    const phaseLabel = String(phase || '-').trim() || '-';
    const line = `[${tag}][TEXT_DECIDE] id=${buttonId || '-'} phase=${phaseLabel} text=${text || '-'} runtimeAction=${runtimeAction}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    if (
      view.forceDanger
      && text
      && (text.includes('取消发送') || text.includes('停止发送'))
    ) {
      const invalidLine = `[BUTTON_TEXT][INVALID_CANCEL_TEXT] id=${buttonId || '-'} phase=${phaseLabel} text=${text}`;
      console.error(invalidLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(invalidLine);
      }
    }
  }

  function logSendButtonViewDecide(buttonId, action, snapshot = {}, view = {}, extra = {}) {
    const task = getSendFamilyTaskFromSnapshot(snapshot);
    const currentAction = task
      ? String(task.action || (task.plan && task.plan.mode) || 'send-message').trim()
      : '-';
    const running = task && task.running ? 1 : 0;
    const switchable = canSwitchSendFamilyAction(snapshot, action) ? 1 : 0;
    const owner = task && task.ownerButtonId ? String(task.ownerButtonId) : '-';
    const ownerButtonId = String(view.ownerButtonId || owner || '-').trim() || '-';
    const phase = task ? String(task.phase || '-').trim() : '-';
    const color = view.forceDanger || view.buttonPhase === 'danger' || view.buttonPhase === 'waiting'
      || view.buttonPhase === 'running' || view.buttonPhase === 'waiting_reply'
      ? 'red'
      : (view.disabled ? 'disabled-visual' : 'normal');
    const reasonSuffix = extra.reason ? ` reason=${extra.reason}` : '';
    const line = `[SEND_BUTTON][VIEW_DECIDE] id=${buttonId || '-'} action=${action || '-'} currentAction=${currentAction} running=${running} switchable=${switchable} owner=${owner} ownerButtonId=${ownerButtonId} phase=${phase} color=${color}${reasonSuffix}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    if (view.forceDanger || view.runtimeAction === 'cancel' || String(view.runtimeAction || '').includes('cancel')) {
      const textTag = action === 'send-copy-hotkey' ? 'SEND_COPY_HOTKEY_BUTTON' : 'SEND_BUTTON';
      logSendButtonTextDecide(buttonId, phase, view, textTag);
    }
    if (action === 'send-copy-hotkey') {
      const viewPhase = String(view.buttonPhase || view.phase || '').trim().toLowerCase();
      const sendCopyTask = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
        ? snapshot.sendCopyHotkeyTask
        : {};
      const taskPhase = String(sendCopyTask.phase || phase || '-').trim();
      const liveSignals = typeof UploadModule !== 'undefined'
        && UploadModule
        && typeof UploadModule.readLiveHotkeyGateSignals === 'function'
        ? UploadModule.readLiveHotkeyGateSignals()
        : { responseState: '-', waitingReply: false };
      if (
        (viewPhase === 'waiting_reply' && running === 0)
        || (taskPhase === 'waiting_reply' && running === 0)
        || (ownerButtonId !== '-' && owner === '-')
      ) {
        const inconsistentLine = `[SEND_COPY_HOTKEY][STATE_INCONSISTENT] runId=${sendCopyTask.rootRunId || sendCopyTask.runId || '-'} phase=${taskPhase || viewPhase || '-'} running=${running} owner=${owner} ownerButtonId=${ownerButtonId} currentAction=${currentAction} responseState=${liveSignals.responseState || '-'} waitingReply=${liveSignals.waitingReply ? 1 : 0} reason=view-decide`;
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(inconsistentLine);
        } else {
          console.warn(inconsistentLine);
        }
      }
    }
  }

  function logCopyHotkeyButtonViewDecide(buttonId, snapshot = {}, view = {}) {
    const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
      ? snapshot.copyHotkeyOnceTask
      : {};
    const running = isCopyHotkeyOnceTaskRunning(snapshot) ? 1 : 0;
    const owner = String(task.ownerButtonId || '-').trim() || '-';
    const ownerButtonId = String(view.ownerButtonId || owner || '-').trim() || '-';
    const phase = String(task.phase || '-').trim() || '-';
    const color = view.forceDanger || view.buttonPhase === 'danger'
      ? 'red'
      : (view.disabled ? 'disabled-visual' : 'normal');
    const line = `[COPY_HOTKEY_BUTTON][VIEW_DECIDE] id=${buttonId || '-'} action=copy-hotkey-once running=${running} owner=${owner} ownerButtonId=${ownerButtonId} phase=${phase} color=${color}`;
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
    const buttonId = String(
      buttonConfig.id
      || buttonConfig.buttonId
      || '',
    ).trim();
    const action = String(
      buttonConfig.action
      || buttonConfig.owner
      || '',
    ).trim();
    const ownerId = String(
      owner.buttonId
      || owner.ownerButtonId
      || owner.id
      || '',
    ).trim();
    const ownerAction = String(
      owner.action
      || owner.owner
      || owner.visualOwnerAction
      || '',
    ).trim();
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

  function isRuntimeCancelLikeAction(action) {
    const normalized = String(action || '').trim().toLowerCase();
    return normalized === 'cancel'
      || normalized === 'stop'
      || normalized === 'stop-closed-loop'
      || normalized.startsWith('cancel-')
      || normalized.startsWith('stop-');
  }

  function isClosedLoopWaitingCountdownText(text) {
    const s = String(text || '').trim();
    return /（等待\s*\d+\s*s?）|（等待\s*\d+\s*秒）|\(等待\s*\d+\s*s?\)/.test(s);
  }

  function isClosedLoopRetryCountdownText(text) {
    const s = String(text || '').trim();
    return /（重试\s*\d+\s*s?）|（重试\s*\d+\s*秒）|\(重试\s*\d+\s*s?\)/.test(s);
  }

  function shouldClosedLoopOwnerUseDangerStopView(action, text, runtimeState = {}) {
    const normalizedAction = String(action || '').trim();
    if (!isClosedLoopButtonAction(normalizedAction)) {
      return true;
    }
    const label = String(text || '').trim();
    const ownerPhase = String(
      runtimeState.phase
      || runtimeState.buttonPhase
      || runtimeState.taskPhase
      || '',
    ).trim().toLowerCase();
    const isWaitingCountdown = isClosedLoopWaitingCountdownText(label);
    const isRetryCountdown = isClosedLoopRetryCountdownText(label);
    if (isWaitingCountdown) {
      return false;
    }
    if (
      ownerPhase === 'waiting'
      || ownerPhase === 'delay'
      || ownerPhase === 'post_reply_delay'
      || ownerPhase === 'post-reply-delay'
      || ownerPhase === 'scheduled'
    ) {
      return false;
    }
    if (isRetryCountdown) {
      return true;
    }
    return true;
  }

  function resolveUnifiedButtonVisualState(buttonConfig = {}, runtimeState = {}) {
    const startedAt = Date.now();
    const kind = String(
      buttonConfig.action || buttonConfig.id || buttonConfig.buttonId || 'unknown',
    ).trim() || 'unknown';
    const action = String(buttonConfig.action || '').trim();
    const id = String(buttonConfig.id || buttonConfig.buttonId || '').trim();
    const text = String(buttonConfig.text || '').trim();
    const phase = String(runtimeState.phase || '').trim().toLowerCase();
    const buttonPhase = String(runtimeState.buttonPhase || '').trim().toLowerCase();
    const snapshot = getButtonAuthoritySnapshot(
      'upload-button-vm:resolveUnifiedButtonVisualState:' + kind,
    );
    const canonicalPermissionViewFields = {
      canSend: snapshot.canSend === true,
      canInput: snapshot.canInput === true,
      canUpload: snapshot.canUpload === true,
      sendable: snapshot.canSend === true,
      inputable: snapshot.canInput === true,
    };
    const blocked = Boolean(snapshot.disabledReason);
    const runningOwner = getToolboxRunningOwnerFromRuntime(runtimeState);
    const batchTaskGroupRunning = isRuntimeBatchTaskGroupRunning(runtimeState);
    const batchTaskGroupIsOwner = !!(
      runningOwner
      && String(runningOwner.action || runningOwner.owner || '').trim() === 'batch-task-group'
    );
    const closedLoopRunning = !!(
      runtimeState.closedLoopRunning
      && !batchTaskGroupIsOwner
    );
    const isCurrentOwner = isRunningOwnerButton({ id, action }, runningOwner);
    const ownerPhase = runningOwner
      ? String(runningOwner.phase || '').trim().toLowerCase()
      : '';
    const running = !!(
      isCurrentOwner
      && (
        ownerPhase === 'running'
        || ownerPhase === 'waiting'
        || ownerPhase === 'waiting_reply'
        || ownerPhase === 'waiting_page_reply_to_send'
        || ownerPhase === 'sending'
        || phase === 'running'
        || phase === 'waiting'
        || buttonPhase === 'running'
        || buttonPhase === 'waiting'
      )
    );
    const isStopAction = isStopLikeButtonView(
      { action, text, runtimeAction: runtimeState.runtimeAction },
      runtimeState,
    );
    const ownerId = runningOwner ? String(runningOwner.buttonId || '-').trim() : '-';
    const isClosedLoopButton = isClosedLoopActionName(action);
    const isClosedLoopOwner = isClosedLoopOwnerAction(action, runtimeState);
    const viewOwnerId = String(runtimeState.ownerButtonId || '').trim();
    const isViewOwner = !!(viewOwnerId && id && viewOwnerId === id);

    if (
      batchTaskGroupRunning
      && batchTaskGroupIsOwner
      && !isCurrentOwner
    ) {
      const idleLabel = resolveIdleBusinessTextForAction(action, runtimeState);
      logButtonOwnerSuppress(action, 'batch-task-group', 'batch-owner-non-owner-keep-base-color');
      logButtonOwnerNonOwnerSuppressed('batch-task-group', action, id);
      const keepBaseColorLine = `[BUTTON_OWNER][NON_OWNER_KEEP_BASE_COLOR] owner=batch-task-group buttonAction=${action || '-'} buttonId=${id || '-'}`;
      console.log(keepBaseColorLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(keepBaseColorLine);
      }
      return {
        kind,
        enabled: true,
        disabled: false,
        running: false,
        blocked: false,
        colorRole: 'normal',
        visual: 'normal',
        disabledReason: '',
        reason: 'batch-owner-non-owner-keep-base-color',
        sendPhase: snapshot.sendPhase || 'unknown',
        replyBusy: snapshot.replyBusy === true,
        taskBusy: snapshot.taskBusy === true,
        attachmentBusy: snapshot.attachmentBusy === true,
        closedLoopRunning: snapshot.closedLoopRunning === true,
        pendingSend: snapshot.pendingSend === true,
        realSendReady: snapshot.realSendReady === true,
        ...canonicalPermissionViewFields,
        label: idleLabel || text,
        source: 'upload-button-vm:resolveUnifiedButtonVisualState',
        authoritySource: snapshot.source || '',
        ownerId: 'cgpt-autoq-start',
        preserveBaseColorWhenDisabled: true,
        allowCancel: false,
        forceDanger: false,
        ts: Date.now(),
      };
    }

    const shouldBeRedStop = isStopAction
      && shouldClosedLoopOwnerUseDangerStopView(action, text, runtimeState)
      && (!isClosedLoopStopLikeText(text) || shouldShowClosedLoopStopView(action, { id, action }, runtimeState))
      && (!isClosedLoopButton || isClosedLoopOwner)
      && (
        isViewOwner
        || (
          !viewOwnerId
          && (
            phase === 'running'
            || phase === 'stopping'
            || buttonPhase === 'running'
            || buttonPhase === 'waiting'
            || (isClosedLoopButton ? isClosedLoopOwner : isCurrentOwner)
          )
        )
      );

    const shouldBeWaitingOwner = !!(
      isStopAction
      && isClosedLoopButton
      && isClosedLoopOwner
      && !shouldClosedLoopOwnerUseDangerStopView(action, text, runtimeState)
    );

    if (shouldBeWaitingOwner) {
      const waitingOwnerView = {
        kind,
        enabled: true,
        disabled: false,
        running: true,
        blocked: false,
        colorRole: 'running',
        visual: 'waiting',
        disabledReason: '',
        reason: 'closed-loop-owner-waiting-countdown',
        sendPhase: snapshot.sendPhase || 'unknown',
        replyBusy: snapshot.replyBusy === true,
        taskBusy: snapshot.taskBusy === true,
        attachmentBusy: snapshot.attachmentBusy === true,
        closedLoopRunning: snapshot.closedLoopRunning === true,
        pendingSend: snapshot.pendingSend === true,
        realSendReady: snapshot.realSendReady === true,
        ...canonicalPermissionViewFields,
        label: text,
        source: 'upload-button-vm:resolveUnifiedButtonVisualState',
        authoritySource: snapshot.source || '',
        ownerId,
        ts: Date.now(),
      };
      console.log('[UPLOAD_BUTTON_VM][VISUAL_STATE_RESOLVED]', {
        kind,
        enabled: waitingOwnerView.enabled,
        running: waitingOwnerView.running,
        blocked: waitingOwnerView.blocked,
        colorRole: waitingOwnerView.colorRole,
        visual: waitingOwnerView.visual,
        reason: waitingOwnerView.reason,
        sendPhase: waitingOwnerView.sendPhase,
        costMs: Date.now() - startedAt,
      });
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_COLOR][WAITING_OWNER_NOT_DANGER] id=${id || '-'} action=${action || '-'} text=${text || '-'} reason=closed-loop-waiting-countdown`,
        );
      }
      return waitingOwnerView;
    }

    if (shouldBeRedStop) {
      const stopView = {
        kind,
        enabled: true,
        disabled: false,
        running: true,
        blocked: false,
        colorRole: 'running',
        visual: 'danger',
        disabledReason: '',
        reason: 'current-task-stop-button',
        sendPhase: snapshot.sendPhase || 'unknown',
        replyBusy: snapshot.replyBusy === true,
        taskBusy: snapshot.taskBusy === true,
        attachmentBusy: snapshot.attachmentBusy === true,
        closedLoopRunning: snapshot.closedLoopRunning === true,
        pendingSend: snapshot.pendingSend === true,
        realSendReady: snapshot.realSendReady === true,
        ...canonicalPermissionViewFields,
        label: text,
        source: 'upload-button-vm:resolveUnifiedButtonVisualState',
        authoritySource: snapshot.source || '',
        ownerId,
        ts: Date.now(),
      };
      console.log('[UPLOAD_BUTTON_VM][VISUAL_STATE_RESOLVED]', {
        kind,
        enabled: stopView.enabled,
        running: stopView.running,
        blocked: stopView.blocked,
        colorRole: stopView.colorRole,
        visual: stopView.visual,
        disabledReason: stopView.disabledReason,
        sendPhase: stopView.sendPhase,
        costMs: Date.now() - startedAt,
      });
      return stopView;
    }

    if (closedLoopRunning && isClosedLoopButton && !isClosedLoopOwner) {
      const lockedView = {
        kind,
        enabled: false,
        disabled: true,
        running,
        blocked: true,
        colorRole: 'blocked',
        visual: 'disabled',
        disabledReason: snapshot.disabledReason || 'locked-by-closed-loop-running',
        reason: 'locked-by-closed-loop-running',
        sendPhase: snapshot.sendPhase || 'unknown',
        replyBusy: snapshot.replyBusy === true,
        taskBusy: snapshot.taskBusy === true,
        attachmentBusy: snapshot.attachmentBusy === true,
        closedLoopRunning: true,
        pendingSend: snapshot.pendingSend === true,
        realSendReady: snapshot.realSendReady === true,
        ...canonicalPermissionViewFields,
        label: text,
        source: 'upload-button-vm:resolveUnifiedButtonVisualState',
        authoritySource: snapshot.source || '',
        ownerId: runningOwner && runningOwner.buttonId
          ? String(runningOwner.buttonId).trim()
          : ownerId,
        ts: Date.now(),
      };
      console.log('[UPLOAD_BUTTON_VM][VISUAL_STATE_RESOLVED]', {
        kind,
        enabled: lockedView.enabled,
        running: lockedView.running,
        blocked: lockedView.blocked,
        colorRole: lockedView.colorRole,
        visual: lockedView.visual,
        reason: lockedView.reason,
        costMs: Date.now() - startedAt,
      });
      return lockedView;
    }

    if (closedLoopRunning && !isCurrentOwner) {
      const lockedView = {
        kind,
        enabled: false,
        disabled: true,
        running,
        blocked: true,
        colorRole: 'blocked',
        visual: 'disabled',
        disabledReason: snapshot.disabledReason || 'locked-by-closed-loop-running',
        reason: 'locked-by-closed-loop-running',
        sendPhase: snapshot.sendPhase || 'unknown',
        replyBusy: snapshot.replyBusy === true,
        taskBusy: snapshot.taskBusy === true,
        attachmentBusy: snapshot.attachmentBusy === true,
        closedLoopRunning: true,
        pendingSend: snapshot.pendingSend === true,
        realSendReady: snapshot.realSendReady === true,
        ...canonicalPermissionViewFields,
        label: text,
        source: 'upload-button-vm:resolveUnifiedButtonVisualState',
        authoritySource: snapshot.source || '',
        ownerId,
        ts: Date.now(),
      };
      console.log('[UPLOAD_BUTTON_VM][VISUAL_STATE_RESOLVED]', {
        kind,
        enabled: lockedView.enabled,
        running: lockedView.running,
        blocked: lockedView.blocked,
        reason: lockedView.reason,
        costMs: Date.now() - startedAt,
      });
      return lockedView;
    }

    let colorRole = 'normal';
    if (running && isCurrentOwner) {
      colorRole = 'running';
    }
    if (blocked) {
      colorRole = 'blocked';
    }

    const phaseDisabled = phase === 'disabled' || buttonPhase === 'disabled' || runtimeState.viewDisabled === true;
    if (!isCurrentOwner && colorRole === 'running') {
      colorRole = 'normal';
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_OWNER][NON_OWNER_COLOR_ROLE_RESET] `
          + `buttonAction=${action || '-'} `
          + `buttonId=${id || '-'} `
          + `owner=${runningOwner && (runningOwner.action || runningOwner.owner) ? String(runningOwner.action || runningOwner.owner) : '-'} `
          + `snapshotColorRole=${snapshot.buttonColorRole || '-'}`
        );
      }
    }
    const canClick = !blocked && !phaseDisabled;
    const view = {
      kind,
      enabled: canClick,
      disabled: !canClick,
      running,
      blocked: blocked || phaseDisabled,
      colorRole,
      visual: (blocked || phaseDisabled) ? 'disabled' : (running && isCurrentOwner ? 'running' : 'normal'),
      disabledReason: phaseDisabled
        ? (runtimeState.viewDisabled ? 'view-disabled' : 'phase-disabled')
        : (snapshot.disabledReason || ''),
      reason: phaseDisabled
        ? (runtimeState.viewDisabled ? 'view-disabled' : 'phase-disabled')
        : (snapshot.disabledReason || 'normal'),
      sendPhase: snapshot.sendPhase || 'unknown',
      replyBusy: snapshot.replyBusy === true,
      taskBusy: snapshot.taskBusy === true,
      attachmentBusy: snapshot.attachmentBusy === true,
      closedLoopRunning: snapshot.closedLoopRunning === true,
      pendingSend: snapshot.pendingSend === true,
      realSendReady: snapshot.realSendReady === true,
      ...canonicalPermissionViewFields,
      label: text,
      source: 'upload-button-vm:resolveUnifiedButtonVisualState',
      authoritySource: snapshot.source || '',
      ownerId,
      ts: Date.now(),
    };
    console.log('[UPLOAD_BUTTON_VM][VISUAL_STATE_RESOLVED]', {
      kind,
      enabled: view.enabled,
      running: view.running,
      blocked: view.blocked,
      colorRole: view.colorRole,
      visual: view.visual,
      disabledReason: view.disabledReason,
      sendPhase: view.sendPhase,
      replyBusy: view.replyBusy,
      taskBusy: view.taskBusy,
      attachmentBusy: view.attachmentBusy,
      closedLoopRunning: view.closedLoopRunning,
      pendingSend: view.pendingSend,
      realSendReady: view.realSendReady,
      snapshotColorRole: snapshot.buttonColorRole || '-',
      isCurrentOwner,
      ownerAction: runningOwner && (runningOwner.action || runningOwner.owner)
        ? String(runningOwner.action || runningOwner.owner)
        : '-',
      costMs: Date.now() - startedAt,
    });
    return view;
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
      // 不要设置原生 title。
      // 原生 title 会在鼠标悬停时弹出白色 tooltip，覆盖闭环红色按钮文本。
      title: '',
      disabledReason: CLOSED_LOOP_LOCKED_TITLE,
      ariaLabel: `${idleText}，${CLOSED_LOOP_LOCKED_TITLE}`,
      suppressNativeTooltip: true,
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'idle',
      preserveBaseColorWhenDisabled: true,
      lockedByClosedLoop: true,
    };
  }

  const MUTUALLY_EXCLUSIVE_BUTTON_STATE_CLASSES = [
    'cgpt-btn-stop',
    'cgpt-btn-running',
    'cgpt-btn-waiting',
    'cgpt-btn-danger',
    'cgpt-btn-success',
    'cgpt-btn-failed',
    'cgpt-btn-idle',
  ];

  const CLOSED_LOOP_STOP_VISUAL_CLASSES = [
    'danger',
    'cgpt-btn-danger',
    'cgpt-btn-stop',
    'cgpt-btn-running',
    'cgpt-btn-busy',
    'cgpt-btn-failed',
    'cgpt-btn-waiting-danger',
  ];

  function cleanupMutuallyExclusiveButtonStateClasses(button, context = {}) {
    if (!button) {
      return;
    }
    const oldClass = String(button.className || '').trim() || '-';
    MUTUALLY_EXCLUSIVE_BUTTON_STATE_CLASSES.forEach((cls) => {
      button.classList.remove(cls);
    });
    const phase = String(
      context.phase
      || context.viewState?.phase
      || button.dataset.cgptTaskPhase
      || '',
    ).trim().toLowerCase();
    if (phase === 'idle' || phase === TaskPhase.IDLE) {
      button.classList.remove('cgpt-btn-stop');
    }
    const newClass = String(button.className || '').trim() || '-';
    const id = String(button.id || '-').trim() || '-';
    const line = `[BUTTON_CLASS_CLEANUP][APPLY] id=${id} oldClass=${oldClass} newClass=${newClass} phase=${phase || '-'} reason=${String(context.reason || '-').trim() || '-'}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    if (phase === 'idle' && button.classList.contains('cgpt-btn-stop')) {
      const errLine = `[BUTTON_CLASS_CLEANUP][ERROR] idle button still has stop class id=${id} class=${newClass}`;
      console.error(errLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(errLine);
      }
      button.classList.remove('cgpt-btn-stop');
    }
  }

  function cleanupNonIdleButtonClasses(button, phase, reason = '-') {
    if (!button) {
      return;
    }
    const normalizedPhase = String(phase || '').trim().toLowerCase();
    if (normalizedPhase !== 'idle' && normalizedPhase !== TaskPhase.IDLE) {
      return;
    }
    const staleClasses = [
      'cgpt-btn-danger',
      'cgpt-btn-stop',
      'cgpt-btn-waiting-danger',
      'cgpt-action-running',
      'cgpt-action-button-active',
      'cgpt-btn-busy',
      'cgpt-btn-failed',
      'cgpt-btn-running',
      'cgpt-btn-waiting',
      'cgpt-btn-uploading',
      'cgpt-btn-sending',
      'cgpt-btn-copying',
      'cgpt-btn-cancelling',
      'cgpt-btn-cancel',
      'danger',
      'waiting',
      'busy',
      'success',
      'warning',
    ];
    for (const cls of staleClasses) {
      button.classList.remove(cls);
    }
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[BUTTON_CLASS_CLEANUP][IDLE_STRICT] id=${button.id || '-'} removed=${staleClasses.join(',')} reason=${reason}`,
      );
    }
  }

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

    const normalizedViewPhaseForSendCopy = String(view.phase || '').trim().toLowerCase();
    const normalizedButtonPhaseForSendCopy = String(view.buttonPhase || '').trim().toLowerCase();
    const normalizedRuntimeActionForSendCopy = String(view.runtimeAction || view.action || '').trim().toLowerCase();
    const sendCopyTerminalPhasesForVisual = new Set([
      '',
      'idle',
      'success',
      'failed',
      'cancelled',
      'canceled',
    ]);
    const sendCopyActivePhasesForVisual = new Set([
      'preparing',
      'running',
      'waiting',
      'waiting_input',
      'waiting_ready',
      'waiting_send',
      'waiting_send_ready',
      'waiting_reply',
      'waiting_response',
      'sent_waiting_response',
      'answering',
      'reply_done_waiting_copy',
      'copying',
      'copy_hotkey',
      'copy_hotkey_core',
      'sending',
      'sending_hotkey',
      'hotkey_sending',
      'uploading_before_send',
      'auto_upload_before_send',
      'cancelling',
      'paused_background_throttled',
      'danger',
    ]);
    const sendCopyRuntimeCancelLikeForVisual =
      normalizedRuntimeActionForSendCopy === 'cancel'
      || normalizedRuntimeActionForSendCopy === 'stop'
      || normalizedRuntimeActionForSendCopy === 'cancel-send-copy-hotkey'
      || normalizedRuntimeActionForSendCopy.startsWith('cancel-')
      || normalizedRuntimeActionForSendCopy.startsWith('stop-');
    const sendCopyPhaseActiveForVisual =
      sendCopyActivePhasesForVisual.has(normalizedViewPhaseForSendCopy)
      || sendCopyActivePhasesForVisual.has(normalizedButtonPhaseForSendCopy);
    const sendCopyPhaseTerminalForVisual =
      sendCopyTerminalPhasesForVisual.has(normalizedViewPhaseForSendCopy)
      && !sendCopyPhaseActiveForVisual
      && !sendCopyRuntimeCancelLikeForVisual;
    const sendCopyRunningStateForVisual = canonicalAction === 'send-copy-hotkey'
      ? resolveSendCopyHotkeyTaskRunningState(snapshot)
      : { isRunning: false };
    const shouldForceSendCopyHotkeyRed =
      canonicalAction === 'send-copy-hotkey'
      && view
      && sendCopyRunningStateForVisual.isRunning === true
      && !sendCopyPhaseTerminalForVisual
      && (
        view.forceDanger === true
        || sendCopyRuntimeCancelLikeForVisual
        || sendCopyPhaseActiveForVisual
      );
    if (shouldForceSendCopyHotkeyRed) {
      button.classList.add('cgpt-btn-danger');
      button.classList.add('cgpt-action-running');
      button.classList.remove('cgpt-btn-idle');
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_VISUAL][FORCE_SEND_COPY_HOTKEY_RED] id=${button.id || '-'} `
          + `phase=${view.phase || '-'} buttonPhase=${view.buttonPhase || '-'} `
          + `runtimeAction=${view.runtimeAction || '-'} reason=active-send-copy-hotkey`,
        );
      } else {
        console.warn(
          `[BUTTON_VISUAL][FORCE_SEND_COPY_HOTKEY_RED] id=${button.id || '-'} `
          + `phase=${view.phase || '-'} buttonPhase=${view.buttonPhase || '-'} `
          + `runtimeAction=${view.runtimeAction || '-'} reason=active-send-copy-hotkey`,
        );
      }
      return view;
    }
    if (
      canonicalAction === 'send-copy-hotkey'
      && view
      && String(view.ownerButtonId || '').trim() === 'cgpt-send-copy-hotkey-once'
      && sendCopyPhaseTerminalForVisual
    ) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_VISUAL][OWNER_ID_NOT_RUNNING] id=${button.id || '-'} `
          + `phase=${view.phase || '-'} buttonPhase=${view.buttonPhase || '-'} `
          + `ownerButtonId=${view.ownerButtonId || '-'} reason=idle-owner-id-not-red`,
        );
      } else {
        console.warn(
          `[BUTTON_VISUAL][OWNER_ID_NOT_RUNNING] id=${button.id || '-'} `
          + `phase=${view.phase || '-'} buttonPhase=${view.buttonPhase || '-'} `
          + `ownerButtonId=${view.ownerButtonId || '-'} reason=idle-owner-id-not-red`,
        );
      }
    }

    cleanupMutuallyExclusiveButtonStateClasses(button, {
      phase: normalizeTaskPhase(view.phase),
      viewState: view,
      reason: 'pre-apply-unified-visual',
    });

    const normalizedAction = String(canonicalAction || '').trim();
    if (
      normalizedAction === 'copy-log'
      || normalizedAction === 'copy-error-log'
    ) {
      return view;
    }

    const runningOwnerForSuppress = getRunningOwnerFromSnapshot(snapshot);
    const runningOwnerAction = runningOwnerForSuppress
      ? String(runningOwnerForSuppress.action || runningOwnerForSuppress.owner || '').trim()
      : '';
    const currentActionForSuppress = String(normalizedAction || view.action || '').trim();
    if (
      runningOwnerAction
      && runningOwnerAction !== currentActionForSuppress
      && !actionsMatchWaitingReplyOwner(currentActionForSuppress, runningOwnerAction)
      && !isRunningOwnerButton({ id: button.id, action: currentActionForSuppress }, runningOwnerForSuppress)
      && isRedLikeButtonView(view)
    ) {
      logButtonOwnerNonOwnerSuppressed(
        runningOwnerAction,
        currentActionForSuppress,
        button.id || '',
      );
      return {
        ...view,
        forceDanger: false,
        allowCancel: false,
        buttonPhase: 'idle',
        phase: TaskPhase.IDLE,
        action: currentActionForSuppress || view.action,
        runtimeAction: currentActionForSuppress || view.runtimeAction || view.action,
        preserveBaseColorWhenDisabled: true,
        title: view.title || '当前任务运行中',
      };
    }

    const runtimeState = {
      ...snapshot,
      phase: normalizeTaskPhase(view.phase),
      buttonPhase: String(view.buttonPhase || '').trim().toLowerCase(),
      closedLoopRunning: !!snapshot.closedLoopContinueRunning,
      runningOwner: getToolboxRunningOwnerFromRuntime(snapshot),
      viewDisabled: !!view.disabled,
      runtimeAction: String(view.runtimeAction || view.action || '').trim(),
      ownerButtonId: String(view.ownerButtonId || '').trim(),
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

    if (
      unified.visual === 'waiting'
      && unified.reason === 'closed-loop-owner-waiting-countdown'
    ) {
      if (view.disabled) {
        logButtonColorFixStopDisabled(button, buttonConfig, true);
      }
      nextView = {
        ...view,
        disabled: false,
        allowCancel: true,
        buttonPhase: 'waiting',
        forceDanger: false,
        action: view.action === 'none' ? 'stop' : (view.action || 'stop'),
        preserveBaseColorWhenDisabled: false,
      };
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
        // 不要使用原生 title，避免白色 tooltip 覆盖按钮文字。
        title: '',
        disabledReason: CLOSED_LOOP_LOCKED_TITLE,
        ariaLabel: `${lockedText}，${CLOSED_LOOP_LOCKED_TITLE}`,
        suppressNativeTooltip: true,
        disabled: true,
        allowCancel: false,
        action: 'none',
        preserveBaseColorWhenDisabled: true,
        disabledVisualOnly: true,
        lockedByClosedLoop: true,
      };
      clearClosedLoopStopVisualClasses(button);
      applyButtonSemanticColorClass(
        button,
        normalizeToolboxButtonColor('cyan', normalizedAction),
        normalizedAction,
      );
      applyButtonDisabledVisualOnlyState(button, nextView, normalizedAction);
      logButtonColorLockedKeepColor(button, buttonConfig, unified);
      return nextView;
    }

    applyButtonDisabledVisualOnlyState(button, nextView, normalizedAction);
    return nextView;
  }

  function isAutoQueueActiveForUploadButton(autoState = {}) {
    const rawPhase = String(autoState.phase || '').trim().toLowerCase();
    const phase = normalizeTaskPhase(rawPhase);
    return !!(
      autoState.running
      || autoState.batchTaskRunning
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
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(autoState);
    if (batchOwner) {
      logBatchOwnerPriorityUsed(batchOwner, batchOwner.phase, batchOwner.source);
      return batchOwner.action;
    }
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
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(autoState);
    if (batchOwner) {
      logBatchOwnerPriorityUsed(batchOwner, batchOwner.phase, 'getCurrentAutoQueueOwnerAction');
      return batchOwner.action;
    }
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

  function normalizeButtonVmSendPhase(phase) {
    if (
      typeof ButtonTasks !== 'undefined'
      && ButtonTasks
      && typeof ButtonTasks.canonicalizeTaskPhaseInput === 'function'
    ) {
      return ButtonTasks.canonicalizeTaskPhaseInput(phase).phase;
    }
    console.error('[BUTTON_TASKS][MISSING] fn=canonicalizeTaskPhaseInput phase-only');
    const value = String(phase || '').trim().toLowerCase();
    if (
      value === 'idle'
      || value === 'waiting_send'
      || value === 'sending'
      || value === 'waiting_reply'
      || value === 'success'
      || value === 'failed'
      || value === 'cancelled'
    ) {
      return value;
    }
    return 'idle';
  }

  function normalizeButtonVmSendSubPhase(phase, subPhase) {
    if (
      typeof ButtonTasks !== 'undefined'
      && ButtonTasks
      && typeof ButtonTasks.canonicalizeTaskPhaseInput === 'function'
    ) {
      return ButtonTasks.canonicalizeTaskPhaseInput(phase, subPhase).subPhase || '';
    }
    console.error('[BUTTON_TASKS][MISSING] fn=canonicalizeTaskPhaseInput phase+subPhase');
    const rawSubPhase = String(subPhase || '').trim();
    if (rawSubPhase) {
      return rawSubPhase;
    }
    const rawPhase = String(phase || '').trim().toLowerCase();
    const normalizedPhase = normalizeButtonVmSendPhase(rawPhase);
    if (rawPhase && rawPhase !== normalizedPhase) {
      return rawPhase;
    }
    return '';
  }

  function isButtonVmTaskActive(task) {
    if (!task || typeof task !== 'object') {
      return false;
    }
    const phase = normalizeButtonVmSendPhase(task.phase);
    return (
      task.running === true
      && phase !== 'idle'
      && phase !== 'success'
      && phase !== 'failed'
      && phase !== 'cancelled'
    );
  }

  function normalizeButtonVmSendTask(task, fallback = {}) {
    const raw = task && typeof task === 'object' ? task : {};
    const phase = normalizeButtonVmSendPhase(raw.phase || fallback.phase);
    const subPhase = normalizeButtonVmSendSubPhase(raw.phase || fallback.phase, raw.subPhase || fallback.subPhase);
    return {
      running: raw.running === true || fallback.running === true,
      phase,
      subPhase,
      action: String(raw.action || fallback.action || ''),
      ownerButtonId: String(raw.ownerButtonId || fallback.ownerButtonId || ''),
      runId: String(raw.runId || fallback.runId || ''),
      reason: String(raw.reason || fallback.reason || ''),
      error: String(raw.error || fallback.error || ''),
      cancelRequested: raw.cancelRequested === true || fallback.cancelRequested === true,
      startedAt: Number(raw.startedAt || fallback.startedAt || 0),
      updatedAt: Number(raw.updatedAt || fallback.updatedAt || 0),
      finishedAt: Number(raw.finishedAt || fallback.finishedAt || 0),
    };
  }

  function selectAuthoritativeSendTaskSnapshot(snapshot = {}) {
    const canonicalSendTask = normalizeButtonVmSendTask(snapshot.sendTask);
    if (canonicalSendTask.running === true) {
      return canonicalSendTask;
    }
    const sendMessageTask = normalizeButtonVmSendTask(snapshot.sendMessageTask, {
      action: 'send-message',
    });
    if (isButtonVmTaskActive(sendMessageTask)) {
      console.warn('[UPLOAD_BUTTON_VM][SEND_TASK_FALLBACK_SEND_MESSAGE_USED]', {
        canonicalPhase: canonicalSendTask.phase,
        canonicalRunning: canonicalSendTask.running,
        fallbackPhase: sendMessageTask.phase,
        fallbackSubPhase: sendMessageTask.subPhase,
        fallbackAction: sendMessageTask.action,
        fallbackOwnerButtonId: sendMessageTask.ownerButtonId,
        fallbackRunId: sendMessageTask.runId,
      });
      return sendMessageTask;
    }
    const sendCopyHotkeyTask = normalizeButtonVmSendTask(snapshot.sendCopyHotkeyTask, {
      action: 'send-copy-hotkey',
    });
    if (isButtonVmTaskActive(sendCopyHotkeyTask)) {
      console.warn('[UPLOAD_BUTTON_VM][SEND_TASK_FALLBACK_SEND_COPY_HOTKEY_USED]', {
        canonicalPhase: canonicalSendTask.phase,
        canonicalRunning: canonicalSendTask.running,
        fallbackPhase: sendCopyHotkeyTask.phase,
        fallbackSubPhase: sendCopyHotkeyTask.subPhase,
        fallbackAction: sendCopyHotkeyTask.action,
        fallbackOwnerButtonId: sendCopyHotkeyTask.ownerButtonId,
        fallbackRunId: sendCopyHotkeyTask.runId,
      });
      return sendCopyHotkeyTask;
    }
    return canonicalSendTask;
  }

  function getNormalizedSendTaskPhase(snapshot = {}) {
    const sendTask = selectAuthoritativeSendTaskSnapshot(snapshot);
    const normalizedPhase = normalizeButtonVmSendPhase(sendTask.phase);
    if (normalizedPhase === 'waiting_send') {
      const rawSubPhase = normalizeButtonVmSendSubPhase(sendTask.phase, sendTask.subPhase);
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
    return normalizeTaskPhase(normalizedPhase === 'waiting_send' ? 'waiting_send' : normalizedPhase);
  }

  function isLegacySendPending(snapshot = {}) {
    return !!snapshot.pendingSendAfterReply;
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
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(snapshot);
    if (batchOwner) {
      logBatchOwnerPriorityUsed(batchOwner, batchOwner.phase, batchOwner.source);
      return batchOwner.action;
    }

    const closedLoopRunning = snapshot.closedLoopContinueRunning === true
      || (
        typeof window !== 'undefined'
        && window.__cgptClosedLoopState
        && window.__cgptClosedLoopState.running === true
      );
    const closedLoopOwner = closedLoopRunning ? resolveClosedLoopOwnerAction(snapshot) : '';
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

    if (snapshot.sendCopyHotkeyActive === true) {
      const sendCopyHotkeyTask = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
        ? snapshot.sendCopyHotkeyTask
        : {};
      const sendCopyHotkeyPhase = String(sendCopyHotkeyTask.phase || 'running').trim().toLowerCase();
      const simpleCombo = String(sendCopyHotkeyTask.mode || '').trim() === 'simple-combo';
      if (!simpleCombo || sendCopyHotkeyPhase === 'running') {
        logButtonOwnerResolve(
          'send-copy-hotkey',
          sendCopyHotkeyPhase,
          simpleCombo ? 'send-copy-hotkey-simple-combo' : 'send-copy-hotkey-task',
        );
        return 'send-copy-hotkey';
      }
    }

    if (isCopyHotkeyOnceTaskRunning(snapshot)) {
      const copyHotkeyOnceTask = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
        ? snapshot.copyHotkeyOnceTask
        : {};
      const copyHotkeyOncePhase = String(copyHotkeyOnceTask.phase || 'running').trim().toLowerCase();
      logButtonOwnerResolve('copy-hotkey-once', copyHotkeyOncePhase, 'copy-hotkey-once-task');
      return 'copy-hotkey-once';
    }

    const sendMessageTask = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : {};
    const sendMessageAction = String(
      sendMessageTask.action
      || (sendMessageTask.plan && sendMessageTask.plan.mode)
      || '',
    ).trim();
    const sendPhase = getNormalizedSendTaskPhase(snapshot);
    const sendMessageTaskForOwnerCheck = Object.assign({}, sendMessageTask, {
      phase: sendPhase || sendMessageTask.phase || TaskPhase.IDLE,
    });
    if (
      isRealSendMessageTaskRunning(
        sendMessageTaskForOwnerCheck,
        snapshot,
        'resolveWaitingReplyOwner:send-copy-hotkey',
      )
      && (
        sendMessageAction === 'send-copy-hotkey'
        || sendMessageAction === 'send-copy-hotkey-continue'
      )
    ) {
      logButtonOwnerResolve(
        sendMessageAction,
        sendPhase || sendMessageTask.phase || 'running',
        'send-message-task',
      );
      return sendMessageAction;
    }
    const realSendRunning = isRealSendMessageTaskRunning(
      sendMessageTaskForOwnerCheck,
      snapshot,
      'resolveWaitingReplyOwner:send-message',
    );
    // waiting_reply: 已发送，等待 ChatGPT 回复
    // waiting_page_reply_to_send: 页面正在回复，消息尚未真正发送，等待页面空闲后再发
    if (
      realSendRunning
      && (
        sendPhase === TaskPhase.WAITING_REPLY
        || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
        || isLegacySendPending(snapshot)
      )
    ) {
      logButtonOwnerResolve('send-message', sendPhase, 'manual-send');
      return 'send-message';
    }

    if (
      !realSendRunning
      && !closedLoopRunning
      && (
        sendPhase === TaskPhase.IDLE
        || !sendPhase
        || sendPhase === 'idle'
      )
    ) {
      const staleOwner = String(
        snapshot.owner
        || snapshot.taskOwner
        || '',
      ).trim();
      if (staleOwner === 'send-message') {
        console.warn('[BUTTON_OWNER][CLEAR_STALE_SEND_OWNER]', {
          reason: 'resolveWaitingReplyOwner',
          oldOwner: staleOwner,
          sendPhase,
          sendRunning: sendMessageTask.running ? 1 : 0,
          closedLoopRunning: closedLoopRunning ? 1 : 0,
        });
      }
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
    if (isClosedLoopButtonAction(normalizedAction)) {
      const showingClosedLoopWait = view.buttonPhase === 'waiting_reply_idle'
        || view.phase === 'waiting_reply_idle'
        || viewText === '等待回复后闭环';
      if (showingClosedLoopWait && !isClosedLoopStartPendingForAction(normalizedAction, snapshot)) {
        const idleView = buildOriginalIdleViewForAction(normalizedAction, view);
        return {
          ...idleView,
          title: '当前正在执行普通发送任务，等待回复期间暂不启动闭环',
          buttonPhase: 'idle_page_busy',
          pageBusyButNotClosedLoop: true,
          className: CLOSED_LOOP_IDLE_CLASS_NAME,
          taskKey: '',
          ownerButtonId: '',
        };
      }
    }
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
    if (
      normalizedAction === 'send-copy-hotkey'
      && snapshot.sendCopyHotkeyActive === true
    ) {
      return view;
    }
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

  function isRedLikeButtonView(view = {}) {
    const phase = normalizeTaskPhase(view.phase);
    const buttonPhase = String(view.buttonPhase || '').trim().toLowerCase();
    const runtimeAction = String(view.runtimeAction || view.action || '').trim().toLowerCase();
    return !!(
      view.forceDanger === true
      || view.allowCancel === true
      || runtimeAction.includes('cancel')
      || runtimeAction.includes('stop')
      || phase === TaskPhase.RUNNING
      || phase === TaskPhase.SENDING
      || phase === TaskPhase.WAITING_SEND
      || phase === TaskPhase.WAITING_REPLY
      || phase === TaskPhase.CANCELLING
      || phase === TaskPhase.UPLOADING
      || buttonPhase === 'danger'
      || buttonPhase === 'running'
      || buttonPhase === 'waiting'
      || buttonPhase === 'waiting_reply'
      || buttonPhase === 'sending'
    );
  }

  function isButtonVisualOwner(action, button, view = {}, snapshot = {}) {
    const normalizedAction = String(action || '').trim();
    const buttonId = String(button && button.id ? button.id : '').trim();
    const runningOwner = getToolboxRunningOwnerFromRuntime(snapshot);
    if (isRunningOwnerButton({ id: buttonId, action: normalizedAction }, runningOwner)) {
      return true;
    }
    const viewOwnerButtonId = String(view.ownerButtonId || '').trim();
    if (buttonId && viewOwnerButtonId && buttonId === viewOwnerButtonId) {
      return true;
    }
    const snapshotOwnerButtonId = String(
      snapshot.visualOwnerButtonId
      || snapshot.sendMessageTask?.visualOwnerButtonId
      || snapshot.sendCopyHotkeyOwnerButtonId
      || '',
    ).trim();
    if (buttonId && snapshotOwnerButtonId && buttonId === snapshotOwnerButtonId) {
      return true;
    }
    const snapshotOwnerAction = String(
      snapshot.visualOwnerAction
      || snapshot.sendMessageTask?.visualOwnerAction
      || snapshot.waitingReplyOwner
      || '',
    ).trim();
    if (normalizedAction && snapshotOwnerAction && normalizedAction === snapshotOwnerAction) {
      return true;
    }
    return false;
  }

  function suppressNonOwnerRedView(action, view, snapshot = {}, button = null, reason = '') {
    if (!view || typeof view !== 'object') {
      return view;
    }
    if (!isRedLikeButtonView(view)) {
      return view;
    }
    if (isButtonVisualOwner(action, button, view, snapshot)) {
      return view;
    }
    const pageBusy = isAuthorityReplyBusyForButtons(snapshot);
    const looksLikePublicReplyLeak = !!(
      pageBusy
      || view.pageBusyButNotOwner === true
      || view.forceDanger === true
      || normalizeTaskPhase(view.phase) === TaskPhase.WAITING_REPLY
    );
    if (!looksLikePublicReplyLeak) {
      return view;
    }
    const idleText = resolveIdleBusinessTextForAction(action, snapshot);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        `[BUTTON_OWNER][SUPPRESS_NON_OWNER_RED] action=${action || '-'} `
        + `buttonId=${button && button.id ? button.id : '-'} `
        + `reason=${reason || '-'} `
        + `pageBusy=${pageBusy ? 1 : 0} `
        + `oldPhase=${view.phase || '-'} oldButtonPhase=${view.buttonPhase || '-'}`,
      );
    }
    return {
      ...view,
      phase: TaskPhase.IDLE,
      buttonPhase: 'idle',
      text: idleText,
      title: view.title || '当前有其他任务正在运行，本按钮不是当前任务按钮',
      disabled: view.disabled === true,
      allowCancel: false,
      action: view.disabled === true ? 'none' : action,
      runtimeAction: '',
      forceDanger: false,
      preserveBaseColorWhenDisabled: true,
      suppressedNonOwnerRed: true,
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
    const task = snapshot[taskKey] && typeof snapshot[taskKey] === 'object'
      ? snapshot[taskKey]
      : {};
    if (task.running === true) {
      return true;
    }
    if (snapshot[activeFlagKey] != null) {
      return !!snapshot[activeFlagKey];
    }
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

  function withUploadButtonTaskKey(view = {}) {
    return Object.assign({ taskKey: 'upload' }, view);
  }

  function withSendButtonTaskKey(view = {}) {
    return Object.assign({ taskKey: 'send' }, view);
  }

  function getUploadButtonViewState(snapshot = {}) {
    // 仅依据 uploadTask / uploadRunning / activeFilesCount，禁止读取 waitingSend / waitingReply / messageSending。
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyBusy;
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

    const authorityForUploadButton = getToolboxAuthorityFromSnapshot(snapshot);
    const uploadQuotaExceeded = !!(
      authorityForUploadButton && authorityForUploadButton.uploadQuotaExceeded === true
    );
    if (uploadQuotaExceeded) {
      console.warn('[UPLOAD_BUTTON][QUOTA_BLOCK]', {
        reason: 'upload-quota-exceeded',
        uploadQuotaExceeded: true,
        uploadQuotaRemaining: authorityForUploadButton && authorityForUploadButton.uploadQuotaRemaining,
        canUploadByHeader: authorityForUploadButton && authorityForUploadButton.canUploadByHeader,
      });
      return withUploadButtonTaskKey({
        phase: 'quota_waiting',
        text: '额度满',
        title: '上传额度已达上限，等待额度释放或清空统计后再上传',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'idle',
        disabledReason: 'upload-quota-exceeded',
        preserveBaseColorWhenDisabled: true,
      });
    }

    const authorityReplyBusy = isAuthorityReplyBusyForButtons(snapshot);
    const authorityReplyAnswering = isAuthorityReplyAnsweringForButtons(snapshot);
    const authorityReplyWaiting = isAuthorityReplyWaitingForButtons(snapshot);

    if (authorityReplyBusy) {
      const uploadPhase = String(
        snapshot.uploadTask && snapshot.uploadTask.phase || '',
      ).trim().toLowerCase();
      const uploadRunningForReplyGate = uploadPhase === 'uploading'
        || uploadPhase === 'preparing'
        || uploadPhase === 'verifying'
        || uploadPhase === 'cancelling'
        || snapshot.uploadRunning === true;
      const uploadTaskRunningForReplyGate = uploadRunningForReplyGate
        || (uploadPhase && uploadPhase !== 'idle' && uploadPhase !== 'success');
      const uploadTaskIdle = !uploadPhase || uploadPhase === 'idle' || uploadPhase === 'success';
      const statusText = String(topReplyStatus.text || '').trim()
        || (authorityReplyAnswering ? '回答中' : '等待回复');
      const authority = getToolboxAuthorityFromSnapshot(snapshot);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          'UPLOAD_BUTTON_AUTHORITY_GATE',
          [
            `replyText=${authority && authority.replyText ? authority.replyText : '-'}`,
            `replyBusy=${authority && authority.replyBusy ? 1 : 0}`,
            `replyDoneStable=${authority && authority.replyDoneStable ? 1 : 0}`,
            `canStartUploadByTopStatus=${authority && authority.canStartUploadByTopStatus ? 1 : 0}`,
            `uploadPhase=${uploadPhase || '-'}`,
          ].join('|'),
          `[UPLOAD_BUTTON][AUTHORITY_GATE] replyText=${authority && authority.replyText ? authority.replyText : '-'} `
          + `replyBusy=${authority && authority.replyBusy ? 1 : 0} `
          + `replyDoneStable=${authority && authority.replyDoneStable ? 1 : 0} `
          + `canStartUploadByTopStatus=${authority && authority.canStartUploadByTopStatus ? 1 : 0} `
          + `uploadPhase=${uploadPhase || '-'}`,
          1500,
        );
      }
      if (uploadTaskIdle && !uploadRunningForReplyGate && !uploadTaskRunningForReplyGate) {
        console.warn('[UPLOAD_BUTTON][REPLY_BUSY_BLOCK]', {
          reason: 'reply-busy',
          replyText: authority && authority.replyText,
          uploadPhase: uploadPhase || '-',
        });
        return withUploadButtonTaskKey({
          phase: 'waiting_reply',
          text: '等回复后上传',
          title: '当前 ChatGPT 正在回复，等待回复完成后再上传文件',
          disabled: true,
          allowCancel: false,
          action: 'none',
          buttonPhase: 'idle',
          disabledReason: 'reply-busy',
          preserveBaseColorWhenDisabled: true,
        });
      }
      return withUploadButtonTaskKey({
        phase: TaskPhase.DISABLED,
        text: '开始上传',
        title: '当前正在上传或上传任务未结束，请稍候',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
        preserveBaseColorWhenDisabled: true,
        disabledReason: 'upload-task-not-idle',
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
        disabled: false,
        allowCancel: false,
        action: 'none',
        runtimeAction: '',
        buttonPhase: 'danger',
        forceDanger: true,
        preserveBaseColorWhenDisabled: false,
        ownerButtonId: 'cgpt-upload-start',
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
        title: '连续复制循环触发的自动上传，当前上传任务正在执行',
        disabled: false,
        allowCancel: true,
        action: 'cancel-upload',
        runtimeAction: 'cancel-upload',
        buttonPhase: 'danger',
        forceDanger: true,
        preserveBaseColorWhenDisabled: false,
        ownerButtonId: 'cgpt-upload-start',
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
        runtimeAction: 'cancel-upload',
        buttonPhase: 'danger',
        forceDanger: true,
        preserveBaseColorWhenDisabled: false,
        ownerButtonId: 'cgpt-upload-start',
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
        runtimeAction: 'cancel-upload',
        buttonPhase: 'danger',
        forceDanger: true,
        preserveBaseColorWhenDisabled: false,
        ownerButtonId: 'cgpt-upload-start',
      });
    }
    return withUploadButtonTaskKey(decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: '开始上传',
      title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
      disabled: false,
      allowCancel: false,
      action: 'start-upload',
      buttonPhase: 'idle',
    }, snapshot));
  }

  function getSendMessageButtonViewState(snapshot = {}, capability = {}, hints = {}) {
    void capability;
    void hints;
    const sendMessageTask = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : {};
    const taskPhase = normalizeButtonVmSendPhase(sendMessageTask.phase || sendMessageTask.subPhase || '');
    const taskSubPhase = normalizeButtonVmSendSubPhase(sendMessageTask.phase, sendMessageTask.subPhase) || taskPhase;
    const isRunning = sendMessageTask.running === true
      && taskPhase !== 'idle'
      && taskPhase !== 'success'
      && taskPhase !== 'failed'
      && taskPhase !== 'cancelled';
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    const finish = (view, decideExtra = {}) => {
      const withKey = withSendButtonTaskKey(Object.assign({
        ownerButtonId: isRunning ? SEND_MESSAGE_OWNER_BUTTON_ID : '',
      }, view));
      const guarded = typeof logButtonViewStateGuard === 'function'
        ? logButtonViewStateGuard('send-message', taskPhase, withKey, snapshot, capability)
        : withKey;
      logSendButtonViewDecide(
        SEND_MESSAGE_OWNER_BUTTON_ID,
        'send-message',
        snapshot,
        guarded,
        decideExtra,
      );
      return guarded;
    };

    if (isRunning) {
      if (taskPhase === 'waiting_reply') {
        return finish({
          phase: TaskPhase.WAITING_REPLY,
          text: getSendMessageRunningTextByPhase(taskSubPhase),
          title: '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消本次发送流程',
          disabled: false,
          allowCancel: true,
          action: 'cancel-send',
          runtimeAction: 'cancel',
          buttonPhase: 'danger',
          forceDanger: true,
        }, { reason: 'simple-task-phase' });
      }
      if (taskPhase === 'sending') {
        return finish({
          phase: TaskPhase.SENDING,
          text: getSendMessageRunningTextByPhase(taskSubPhase),
          title: SEND_MESSAGE_RUNNING_CANCEL_TITLE,
          disabled: false,
          allowCancel: true,
          action: 'cancel-send',
          runtimeAction: 'cancel',
          buttonPhase: 'danger',
          forceDanger: true,
        }, { reason: 'simple-task-phase' });
      }
      return finish({
        phase: TaskPhase.WAITING_SEND,
        text: getSendMessageRunningTextByPhase(taskSubPhase),
        title: SEND_MESSAGE_RUNNING_CANCEL_TITLE,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
      }, { reason: 'simple-task-phase' });
    }

    if (taskPhase === 'failed') {
      const failedTitle = String(sendMessageTask.lastError || sendMessageTask.reason || '').trim() || '发送失败';
      return finish({
        phase: TaskPhase.FAILED,
        text: '发送失败',
        title: failedTitle,
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        runtimeAction: '',
        buttonPhase: 'failed',
        forceDanger: false,
      }, { reason: 'simple-task-phase' });
    }

    const idleTitle = (topReplyAnswering || topReplyWaiting || topReplyBusy)
      ? `当前左上角状态：${String(topReplyStatus.text || '').trim() || '回答中'}`
      : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）';
    return finish({
      phase: TaskPhase.IDLE,
      text: '发送消息',
      title: idleTitle,
      disabled: false,
      allowCancel: false,
      action: 'send-message',
      runtimeAction: '',
      buttonPhase: 'idle',
      forceDanger: false,
    }, { reason: 'simple-top-reply' });
  }

  function getCopyLastReplyButtonViewState(snapshot = {}) {
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyAnswering;
    void topReplyWaiting;
    void topReplyBusy;
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

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: '复制最后回复',
      title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
  }

  function isCopyHotkeyTaskOwnedBySendCopyHotkey(snapshot = {}) {
    const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
      ? snapshot.copyHotkeyOnceTask
      : {};
    const ownerButtonId = String(task.ownerButtonId || '').trim();
    const ownerAction = String(task.ownerAction || task.action || task.taskKey || '').trim();
    return Boolean(
      ownerButtonId === 'cgpt-send-copy-hotkey-once'
      || ownerAction === 'send-copy-hotkey'
      || String(task.source || '').includes('send-then-copy-hotkey')
      || String(task.source || '').includes('send-copy-hotkey')
    );
  }

  function getCopyHotkeyOnceButtonViewState(snapshot = {}) {
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
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
        disabled: false,
        allowCancel: false,
        action: 'none',
        runtimeAction: '',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'copyHotkeyOnce',
        ownerButtonId: COPY_HOTKEY_ONCE_OWNER_BUTTON_ID,
      };
    }

    if (onceRunning && isCopyHotkeyOnceTaskOwner(snapshot)) {
      let runningText = '取消等待';
      let runningTitle = '复制+快捷键任务正在运行；点击取消';
      if (rawPhase === TaskPhase.WAITING_REPLY) {
        runningText = '等待回复后复制';
        runningTitle = '当前 ChatGPT 正在回答，回答完成后将自动复制最后回复并发送快捷键；点击取消等待';
      } else if (rawPhase === 'copying' || rawPhase === 'confirming_clipboard') {
        runningText = '正在复制';
        runningTitle = '正在复制最后回复';
      } else if (rawPhase === 'sending_hotkey') {
        runningText = '发送快捷键中';
        runningTitle = '正在发送配置的快捷键';
      }
      const ownerView = {
        phase: rawPhase === TaskPhase.WAITING_REPLY
          ? TaskPhase.WAITING_REPLY
          : (rawPhase || phase || TaskPhase.RUNNING),
        text: runningText,
        title: runningTitle,
        disabled: false,
        allowCancel: true,
        action: 'cancel-copy-hotkey-once',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'copyHotkeyOnce',
        ownerButtonId: COPY_HOTKEY_ONCE_OWNER_BUTTON_ID,
      };
      logCopyHotkeyButtonViewDecide(COPY_HOTKEY_ONCE_OWNER_BUTTON_ID, snapshot, ownerView);
      return ownerView;
    }

    if (onceRunning && isCopyHotkeyTaskOwnedBySendCopyHotkey(snapshot)) {
      const comboOwnerIdleView = decorateIdleViewWithTopReplyStatus({
        phase: TaskPhase.IDLE,
        text: snapshot.onceLabel || '复制+快捷键',
        title: '当前复制核心由「发送+复制+快捷键」组合按钮调用；这里只保持普通状态，不跟随变红',
        disabled: false,
        allowCancel: false,
        action: 'copy-hotkey-once',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
        ownerButtonId: '',
        taskKey: 'copy-hotkey-once',
      }, snapshot);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        const comboTask = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
          ? snapshot.copyHotkeyOnceTask
          : {};
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_BUTTON][KEEP_IDLE_FOR_SEND_COPY_OWNER] `
          + `ownerButtonId=${comboTask.ownerButtonId || '-'} `
          + `ownerAction=${comboTask.ownerAction || comboTask.action || '-'} `
          + `phase=${comboTask.phase || '-'}`,
        );
      }
      logCopyHotkeyButtonViewDecide(COPY_HOTKEY_ONCE_OWNER_BUTTON_ID, snapshot, comboOwnerIdleView);
      return comboOwnerIdleView;
    }

    if (onceRunning) {
      let fallbackRunningText = '取消等待';
      let fallbackRunningTitle = '复制+快捷键任务正在运行；点击取消';
      if (rawPhase === TaskPhase.WAITING_REPLY) {
        fallbackRunningText = '等待回复后复制';
        fallbackRunningTitle = '当前 ChatGPT 正在回答，回答完成后将自动复制最后回复并发送快捷键；点击取消等待';
      } else if (rawPhase === 'copying' || rawPhase === 'confirming_clipboard') {
        fallbackRunningText = '正在复制';
        fallbackRunningTitle = '正在复制最后回复';
      } else if (rawPhase === 'sending_hotkey') {
        fallbackRunningText = '发送快捷键中';
        fallbackRunningTitle = '正在发送配置的快捷键';
      }
      const fallbackPhase = rawPhase && rawPhase !== TaskPhase.IDLE
        ? rawPhase
        : TaskPhase.RUNNING;
      const fallbackOwnerView = {
        phase: rawPhase === TaskPhase.WAITING_REPLY
          ? TaskPhase.WAITING_REPLY
          : fallbackPhase,
        text: fallbackRunningText,
        title: fallbackRunningTitle,
        disabled: false,
        allowCancel: true,
        action: 'cancel-copy-hotkey-once',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'copyHotkeyOnce',
        ownerButtonId: COPY_HOTKEY_ONCE_OWNER_BUTTON_ID,
      };
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_BUTTON][OWNER_FALLBACK_RED] id=${COPY_HOTKEY_ONCE_OWNER_BUTTON_ID} phase=${rawPhase || '-'} reason=once-running-but-owner-mismatch`,
        );
      } else {
        console.warn(
          `[COPY_HOTKEY_BUTTON][OWNER_FALLBACK_RED] id=${COPY_HOTKEY_ONCE_OWNER_BUTTON_ID} phase=${rawPhase || '-'} reason=once-running-but-owner-mismatch`,
        );
      }
      logCopyHotkeyButtonViewDecide(COPY_HOTKEY_ONCE_OWNER_BUTTON_ID, snapshot, fallbackOwnerView);
      return fallbackOwnerView;
    }

    const capability = snapshot.capability && typeof snapshot.capability === 'object'
      ? snapshot.capability
      : {};
    const responseState = String(
      snapshot.responseState
      || capability.response_state
      || capability.responseState
      || '',
    ).trim().toLowerCase();
    const pageGenerating = isAuthorityReplyBusyForButtons(snapshot);

    const idleView = decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: snapshot.onceLabel || '复制+快捷键',
      title: pageGenerating
        ? '当前正在回答，点击后将在回复完成后复制最后回复并发送快捷键'
        : (snapshot.onceTitle || '复制 ChatGPT 最后一条回复，然后触发内部目标快捷键。'),
      disabled: false,
      allowCancel: false,
      action: 'copy-hotkey-once',
      runtimeAction: '',
      buttonPhase: 'idle',
      forceDanger: false,
      ownerButtonId: '',
      taskKey: 'copy-hotkey-once',
    }, snapshot, {
      titleWhenBusy: `当前状态：${topReplyStatus.text || '回答中'}；回复完成后将自动复制最后回复并发送快捷键`,
    });
    if (pageGenerating) {
      const allowLine = `[COPY_HOTKEY_BUTTON][ALLOW_DURING_GENERATING] id=${COPY_HOTKEY_ONCE_OWNER_BUTTON_ID} responseState=${responseState || 'generating'} disabled=0`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(allowLine);
      } else {
        console.log(allowLine);
      }
    }
    logCopyHotkeyButtonViewDecide(COPY_HOTKEY_ONCE_OWNER_BUTTON_ID, snapshot, idleView);
    return idleView;
  }

  function normalizeVmSendCopyHotkeyPhase(phase) {
    const value = String(phase || '').trim().toLowerCase();
    if (!value) {
      return 'idle';
    }
    if (
      value === 'idle'
      || value === 'ready'
      || value === 'success'
      || value === 'done'
      || value === 'finished'
      || value === 'complete'
      || value === 'completed'
    ) {
      return 'idle';
    }
    if (
      value === 'fail'
      || value === 'failed'
      || value === 'error'
      || value === 'exception'
    ) {
      return 'failed';
    }
    if (
      value === 'cancel'
      || value === 'cancelled'
      || value === 'canceled'
    ) {
      return 'cancelled';
    }
    if (
      value === 'waiting'
      || value === 'waiting_input'
      || value === 'waiting_composer'
      || value === 'waiting_ready'
      || value === 'ready_to_click'
    ) {
      return 'waiting_send';
    }
    if (
      value === 'waiting_send_ready'
      || value === 'real_send_ready'
    ) {
      return 'waiting_send_ready';
    }
    if (
      value === 'waiting_response'
      || value === 'waiting_reply'
      || value === 'sent_waiting_response'
      || value === 'answering'
      || value === 'generating'
      || value === 'responding'
    ) {
      return 'waiting_reply';
    }
    if (
      value === 'reply_done'
      || value === 'reply_finished'
      || value === 'reply_done_waiting_copy'
    ) {
      return 'reply_done_waiting_copy';
    }
    if (
      value === 'copy'
      || value === 'copying'
      || value === 'copy_last_reply'
      || value === 'confirming_clipboard'
    ) {
      return 'copying';
    }
    if (
      value === 'hotkey'
      || value === 'sending_hotkey'
      || value === 'hotkey_sent'
      || value === 'hotkey_sending'
    ) {
      return 'hotkey';
    }
    if (
      value === 'uploading'
      || value === 'uploading_before_send'
      || value === 'auto_upload_before_send'
    ) {
      return 'auto_upload_before_send';
    }
    if (
      value === 'pause'
      || value === 'paused'
      || value === 'paused_background_throttled'
    ) {
      return 'paused_background_throttled';
    }
    if (
      value === 'copy_hotkey'
      || value === 'copy_hotkey_core'
    ) {
      return 'copy_hotkey_core';
    }
    if (
      value === 'prepare'
      || value === 'preparing'
      || value === 'start'
      || value === 'running'
      || value === 'busy'
      || value === 'sending'
      || value === 'cancelling'
    ) {
      return value === 'prepare' ? 'preparing' : value;
    }
    return value;
  }

  const SEND_COPY_HOTKEY_TASK_RUNNING_PHASES = new Set([
    'preparing',
    'running',
    'busy',
    'sending',
    'waiting_send',
    'waiting_send_ready',
    'waiting_reply',
    'waiting_response',
    'sent_waiting_response',
    'answering',
    'reply_done_waiting_copy',
    'copying',
    'copy_hotkey_core',
    'hotkey',
    'auto_upload_before_send',
    'uploading_before_send',
    'paused_background_throttled',
    'cancelling',
  ]);

  function isVmSendCopyHotkeyRunningPhase(phase) {
    const normalized = normalizeVmSendCopyHotkeyPhase(phase);
    if (
      !normalized
      || normalized === 'idle'
      || normalized === 'success'
      || normalized === 'failed'
      || normalized === 'cancelled'
    ) {
      return false;
    }
    return SEND_COPY_HOTKEY_TASK_RUNNING_PHASES.has(normalized);
  }

  function getVmSendCopyHotkeyTitleByPhase(phase) {
    const normalized = normalizeVmSendCopyHotkeyPhase(phase);
    if (normalized === 'preparing') {
      return '正在准备发送+复制+快捷键流程';
    }
    if (normalized === 'waiting_send' || normalized === 'waiting_send_ready') {
      return '正在等待页面可发送';
    }
    if (normalized === 'sending') {
      return '正在发送消息';
    }
    if (
      normalized === 'waiting_reply'
      || normalized === 'waiting_response'
      || normalized === 'sent_waiting_response'
      || normalized === 'answering'
    ) {
      return '正在等待回答完成';
    }
    if (normalized === 'reply_done_waiting_copy') {
      return '回答已完成，准备复制最后回复';
    }
    if (normalized === 'copying' || normalized === 'copy_hotkey_core') {
      return '正在复制最后回复';
    }
    if (normalized === 'hotkey') {
      return '正在发送快捷键';
    }
    if (normalized === 'auto_upload_before_send' || normalized === 'uploading_before_send') {
      return '正在按轮次上传文件';
    }
    if (normalized === 'paused_background_throttled') {
      return '页面可能处于后台限速，流程暂停等待';
    }
    if (normalized === 'cancelling') {
      return '正在取消发送+复制+快捷键流程';
    }
    if (normalized === 'failed') {
      return '发送+复制+快捷键流程失败';
    }
    if (normalized === 'cancelled') {
      return '发送+复制+快捷键流程已取消';
    }
    return '发送+复制+快捷键流程运行中';
  }

  function applySendCopyHotkeyButtonColorDecide(button, snapshot = {}, resolvedView = {}, extra = {}) {
    if (!button || button.id !== 'cgpt-send-copy-hotkey-once') {
      return;
    }
    const runningState = resolveSendCopyHotkeyTaskRunningState(snapshot);
    const runningOwner = getRunningOwnerFromSnapshot(snapshot);
    const runningOwnerAction = runningOwner
      ? String(runningOwner.action || runningOwner.owner || '').trim()
      : '';
    const taskOwner = runningOwnerAction
      || String(snapshot.sendCopyHotkeyTask?.action || '').trim()
      || String(resolvedView.taskKey || '').trim();
    const unified = snapshot.toolboxUnifiedAuthority && typeof snapshot.toolboxUnifiedAuthority === 'object'
      ? snapshot.toolboxUnifiedAuthority
      : {};
    const authorityTask = unified.task && typeof unified.task === 'object' ? unified.task : {};
    const capability = snapshot.capability && typeof snapshot.capability === 'object'
      ? snapshot.capability
      : {};
    const viewPhase = String(resolvedView.phase || '').trim().toLowerCase();
    const viewButtonPhase = String(resolvedView.buttonPhase || '').trim().toLowerCase();
    const isRunning = runningState.isRunning === true
      || button.dataset.running === '1';
    const hasError = viewPhase === 'failed'
      || viewButtonPhase === 'failed'
      || button.dataset.error === '1'
      || button.classList.contains('cgpt-btn-failed');
    const reason = String(extra.reason || extra.renderReason || 'color-decide').trim() || 'color-decide';
    let colorRole = 'send-copy-hotkey-idle';
    let decideReason = reason;

    button.dataset.baseRole = 'send-copy-hotkey';
    button.classList.remove('danger', 'btn-danger', 'cgpt-btn-error');

    if (isRunning) {
      colorRole = 'running';
      decideReason = `${reason}:running-red`;
      button.dataset.running = '1';
      button.dataset.error = '0';
      button.classList.add('cgpt-btn-danger', 'cgpt-action-running');
      button.classList.remove('cgpt-btn-idle');
    } else if (hasError) {
      colorRole = 'error';
      decideReason = `${reason}:failed-red`;
      button.dataset.running = '0';
      button.dataset.error = '1';
      button.classList.remove('cgpt-btn-danger', 'cgpt-action-running', 'cgpt-btn-busy', 'cgpt-action-button-active');
    } else {
      decideReason = `${reason}:idle-purple`;
      button.dataset.running = '0';
      button.dataset.error = '0';
      button.classList.remove(
        'cgpt-btn-danger',
        'cgpt-btn-error',
        'cgpt-action-running',
        'cgpt-btn-busy',
        'cgpt-btn-running',
        'cgpt-btn-waiting',
        'cgpt-action-button-active',
      );
      button.style.opacity = '';
      button.style.filter = '';
      applyButtonSemanticColorClass(button, 'purple', 'send-copy-hotkey');
      if (!button.classList.contains('purple')) {
        button.classList.add('purple');
      }
    }

    button.dataset.colorRole = colorRole;

    const line =
      `[UPLOAD_BUTTON_VM][SEND_COPY_HOTKEY_COLOR_DECIDE] `
      + `reason=${decideReason} `
      + `buttonId=${button.id || '-'} `
      + `colorRole=${button.dataset.colorRole || '-'} `
      + `baseRole=${button.dataset.baseRole || '-'} `
      + `runningOwner=${runningOwnerAction || '-'} `
      + `taskOwner=${taskOwner || '-'} `
      + `isRunning=${isRunning ? 1 : 0} `
      + `hasError=${hasError ? 1 : 0} `
      + `replyState=${String(snapshot.responseState || unified.raw?.responseState || '-')} `
      + `taskState=${String(authorityTask.state || snapshot.taskState || '-')} `
      + `canSend=${snapshot.canSend === true || capability.canSend === true || capability.can_send === true ? 1 : 0} `
      + `canInput=${snapshot.canInput === true || capability.canInput === true || capability.can_input === true ? 1 : 0} `
      + `legacy_sendable=${capability.sendable === true || snapshot.sendable === true ? 1 : 0} `
      + `legacy_inputable=${capability.inputable === true || snapshot.inputable === true ? 1 : 0} `
      + `disabledReason=${String(snapshot.disabledReason || capability.disabled_reason || '-')}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function resolveSendCopyHotkeyTaskRunningState(snapshot = {}) {
    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const unified = snapshot.toolboxUnifiedAuthority && typeof snapshot.toolboxUnifiedAuthority === 'object'
      ? snapshot.toolboxUnifiedAuthority
      : null;
    const flags = unified && unified.flags && typeof unified.flags === 'object'
      ? unified.flags
      : {};
    const authorityTask = unified && unified.task && typeof unified.task === 'object'
      ? unified.task
      : {};
    const taskPhase = normalizeVmSendCopyHotkeyPhase(task.phase || task.subPhase || '');
    const ownerButtonId = String(task.ownerButtonId || '').trim();
    const taskAction = String(task.action || task.mode || '').trim();
    const authorityTaskBusy = flags.taskBusy === true;
    const authorityReplyBusy = flags.replyBusy === true;
    const authorityPendingSend = flags.pendingSend === true;
    const authorityTaskState = String(authorityTask.state || '').trim().toLowerCase();
    const authoritySaysIdle = !!(
      unified
      && authorityTaskBusy !== true
      && authorityReplyBusy !== true
      && authorityPendingSend !== true
      && (
        !authorityTaskState
        || authorityTaskState === 'idle'
        || authorityTaskState === 'ready'
        || authorityTaskState === '空闲'
      )
    );
    const hasCurrentOwner = ownerButtonId === 'cgpt-send-copy-hotkey-once';
    const explicitRunning = task.running === true && hasCurrentOwner;
    const phaseLooksRunning = hasCurrentOwner && isVmSendCopyHotkeyRunningPhase(taskPhase);
    const taskUpdatedAt = Number(task.updatedAt || task.startedAt || task.ts || 0);
    const taskAgeMs = taskUpdatedAt > 0 ? Date.now() - taskUpdatedAt : 0;
    const staleRunningByAge = taskAgeMs <= 0 || taskAgeMs > 8000;
    const authorityIdleShouldSuppress = !!(
      authoritySaysIdle
      && hasCurrentOwner
      && (
        explicitRunning === true
        || phaseLooksRunning === true
      )
      && staleRunningByAge
    );
    if (authoritySaysIdle && (explicitRunning !== true || authorityIdleShouldSuppress)) {
      const line = [
        authorityIdleShouldSuppress
          ? '[SEND_COPY_HOTKEY_BUTTON][STALE_RUNNING_SUPPRESSED_BY_AUTHORITY]'
          : '[SEND_COPY_HOTKEY_BUTTON][STALE_RUNNING_SUPPRESSED]',
        `taskPhase=${taskPhase || '-'}`,
        `ownerButtonId=${ownerButtonId || '-'}`,
        `taskAction=${taskAction || '-'}`,
        `authorityTaskState=${authorityTaskState || '-'}`,
        `authorityTaskBusy=${authorityTaskBusy ? 1 : 0}`,
        `authorityReplyBusy=${authorityReplyBusy ? 1 : 0}`,
        `authorityPendingSend=${authorityPendingSend ? 1 : 0}`,
        `taskRunning=${task.running === true ? 1 : 0}`,
        `taskAgeMs=${taskAgeMs}`,
      ].join(' ');
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.warn(line);
      }
      return {
        isRunning: false,
        phase: 'idle',
        ownerButtonId: '',
        staleSuppressed: true,
      };
    }
    const isRunning = explicitRunning || phaseLooksRunning;
    return {
      isRunning,
      phase: taskPhase || (isRunning ? 'running' : 'idle'),
      ownerButtonId: isRunning ? ownerButtonId : '',
      staleSuppressed: false,
    };
  }

  function isSendCopyHotkeyVisualOwner(snapshot = {}) {
    const runningState = resolveSendCopyHotkeyTaskRunningState(snapshot);
    if (runningState.isRunning !== true) {
      return {
        owned: false,
        source: runningState.staleSuppressed ? 'stale-suppressed-by-authority' : '-',
        phase: 'idle',
      };
    }
    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const taskPhase = runningState.phase || normalizeVmSendCopyHotkeyPhase(task.phase || task.subPhase || '');
    const taskOwnerButtonId = String(task.ownerButtonId || '').trim();
    const taskAction = String(task.action || task.mode || '').trim();
    if (taskOwnerButtonId === 'cgpt-send-copy-hotkey-once') {
      return {
        owned: true,
        source: 'send-copy-hotkey-task',
        phase: taskPhase,
      };
    }
    if (
      (taskAction === 'send-copy-hotkey' || taskAction === 'send-copy-hotkey-continue')
      && taskOwnerButtonId === 'cgpt-send-copy-hotkey-once'
    ) {
      return {
        owned: true,
        source: 'send-copy-hotkey-task-action',
        phase: taskPhase,
      };
    }
    return {
      owned: false,
      source: '-',
      phase: 'idle',
    };
  }

  function logSendCopyHotkeyVisualDecide(snapshot = {}, visualOwner = {}, finalView = {}, capability = {}, extra = {}) {
    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const pending = snapshot.sendLikePendingTask && typeof snapshot.sendLikePendingTask === 'object'
      ? snapshot.sendLikePendingTask
      : null;
    const sendFamilyTask = getSendFamilyTaskFromSnapshot(snapshot) || {};
    const composerTextLen = Number(
      snapshot.composerTextLen
      || capability.textLength
      || capability.composerTextLen
      || 0,
    ) || 0;
    const composerCount = Number(
      snapshot.composerCount
      || capability.composerCount
      || 0,
    ) || 0;
    const composerUploading = !!(
      snapshot.composerUploading
      || capability.composerUploading
    );
    const localFileCount = Number(
      snapshot.localFileCount
      || snapshot.activeFilesCount
      || 0,
    ) || 0;
    const hasRealComposerPayload = snapshot.hasRealComposerPayload === true;
    const hasLocalQueueFiles = snapshot.hasLocalQueueFiles === true
      || Number(localFileCount || 0) > 0;
    const sendCopyHotkeyMode = snapshot.sendCopyHotkeyMode
      || (hasRealComposerPayload ? 'send_then_copy_hotkey' : 'copy_hotkey_only');
    const canSendNow = !!(
      snapshot.canSend === true
      || capability.canSend === true
      || capability.can_send === true
      || capability.can_send_now === true
      || capability.canSendNow === true
      || capability.send_decision === 'allowed'
      || capability.sendDecision === 'allowed'
    );
    const canAcceptInput = !!(
      snapshot.canInput === true
      || capability.canInput === true
      || capability.can_input === true
      || capability.can_accept_input === true
      || capability.canAcceptInput === true
    );
    const finalPhase = String(finalView.phase || 'idle').trim().toLowerCase();
    const finalColor = (
      finalView.forceDanger === true
      || finalView.runtimeAction === 'cancel'
      || finalView.buttonPhase === 'danger'
      || finalView.buttonPhase === 'running'
      || finalView.buttonPhase === 'waiting_reply'
    ) ? 'red' : 'normal';
    const extraFields = extra && typeof extra === 'object' ? extra : {};
    const lineParts = [
      '[SEND_COPY_HOTKEY_BUTTON][VISUAL_DECIDE]',
      `taskPhase=${String(task.phase || '-').trim()}`,
      `taskOwnerButtonId=${String(task.ownerButtonId || '-').trim()}`,
      `pendingAction=${pending ? String(pending.action || '-').trim() : '-'}`,
      `pendingPhase=${pending ? String(pending.phase || '-').trim() : '-'}`,
      `sendFamilyAction=${String(sendFamilyTask.action || sendFamilyTask.plan?.mode || '-').trim()}`,
      `sendFamilyOwner=${String(sendFamilyTask.ownerButtonId || '-').trim()}`,
      `sendFamilyRunning=${sendFamilyTask.running ? 1 : 0}`,
      `visualOwned=${visualOwner.owned ? 1 : 0}`,
      `visualSource=${String(visualOwner.source || '-').trim()}`,
      `composerTextLen=${composerTextLen}`,
      `sendCopyHotkeyMode=${sendCopyHotkeyMode}`,
      `hasRealComposerPayload=${hasRealComposerPayload ? 1 : 0}`,
      `hasLocalQueueFiles=${hasLocalQueueFiles ? 1 : 0}`,
      `localFileIgnoredAsPayload=1`,
      `can_send_now=${canSendNow ? 1 : 0}`,
      `can_accept_input=${canAcceptInput ? 1 : 0}`,
      `legacy_sendable=${(capability.sendable === true || snapshot.sendable === true) ? 1 : 0}`,
      `legacy_inputable=${(capability.inputable === true || snapshot.inputable === true) ? 1 : 0}`,
      `finalPhase=${finalPhase}`,
      `finalColor=${finalColor}`,
    ];
    if (extraFields.renderReason) {
      lineParts.push(`renderReason=${String(extraFields.renderReason).trim()}`);
    }
    if (extraFields.moduleTaskPhase) {
      lineParts.push(`moduleTaskPhase=${String(extraFields.moduleTaskPhase).trim()}`);
    }
    if (extraFields.moduleSendRunning !== undefined) {
      lineParts.push(`moduleSendRunning=${extraFields.moduleSendRunning ? 1 : 0}`);
    }
    if (extraFields.moduleSendAction) {
      lineParts.push(`moduleSendAction=${String(extraFields.moduleSendAction).trim()}`);
    }
    if (extraFields.moduleSendPhase) {
      lineParts.push(`moduleSendPhase=${String(extraFields.moduleSendPhase).trim()}`);
    }
    if (extraFields.flowStillRunning !== undefined) {
      lineParts.push(`flowStillRunning=${extraFields.flowStillRunning ? 1 : 0}`);
    }
    const line = lineParts.join(' ');
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
    if (visualOwner.owned) {
      const ownerLine = `[SEND_COPY_HOTKEY_BUTTON][VISUAL_OWNER] owned=1 source=${String(visualOwner.source || '-').trim()} phase=${String(visualOwner.phase || '-').trim()}`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(ownerLine);
      } else {
        console.log(ownerLine);
      }
    }
  }

  function normalizeSendCopyHotkeyIdleView(view = {}, reason = '-') {
    const base = view && typeof view === 'object' ? view : {};
    const phase = String(base.phase || '').trim().toLowerCase();
    const buttonPhase = String(base.buttonPhase || '').trim().toLowerCase();
    const runtimeAction = String(base.runtimeAction || '').trim().toLowerCase();
    const activePhases = new Set([
      'preparing',
      'running',
      'waiting',
      'waiting_input',
      'waiting_ready',
      'waiting_send',
      'waiting_send_ready',
      'waiting_reply',
      'waiting_response',
      'sent_waiting_response',
      'answering',
      'reply_done_waiting_copy',
      'copying',
      'copy_hotkey',
      'copy_hotkey_core',
      'sending',
      'sending_hotkey',
      'hotkey_sending',
      'uploading_before_send',
      'auto_upload_before_send',
      'cancelling',
      'paused_background_throttled',
      'danger',
    ]);
    const cancelLike =
      runtimeAction === 'cancel'
      || runtimeAction === 'stop'
      || runtimeAction.startsWith('cancel-')
      || runtimeAction.startsWith('stop-');
    const active =
      activePhases.has(phase)
      || activePhases.has(buttonPhase)
      || cancelLike
      || base.forceDanger === true;
    if (active) {
      return base;
    }
    const normalized = {
      ...base,
      phase: TaskPhase.IDLE,
      buttonPhase: 'idle',
      runtimeAction: '',
      forceDanger: false,
      ownerButtonId: '',
      disabled: false,
      allowCancel: false,
    };
    if (
      String(base.ownerButtonId || '').trim()
      || base.forceDanger === true
      || String(base.buttonPhase || '').trim().toLowerCase() !== 'idle'
    ) {
      const line =
        `[SEND_COPY_HOTKEY_BUTTON][IDLE_VIEW_NORMALIZED] `
        + `reason=${reason || '-'} oldPhase=${base.phase || '-'} `
        + `oldButtonPhase=${base.buttonPhase || '-'} oldOwner=${base.ownerButtonId || '-'} `
        + `newPhase=${normalized.phase} newOwner=-`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.warn(line);
      }
    }
    return normalized;
  }

  function finalizeSendCopyHotkeyButtonViewState(snapshot = {}, view = {}, capability = {}, extra = {}) {
    const visualOwner = isSendCopyHotkeyVisualOwner(snapshot);
    const runningState = resolveSendCopyHotkeyTaskRunningState(snapshot);
    let resolvedView = view && typeof view === 'object' ? view : {};
    if (runningState.staleSuppressed === true) {
      const idleView = {
        ...resolvedView,
        phase: TaskPhase.IDLE,
        text: getNormalButtonIdleLabel('send-copy-hotkey', SEND_COPY_HOTKEY_BUTTON_LABEL),
        title: '发送当前输入框消息，等待回复完成后复制最后回复并触发目标快捷键',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: '',
      };
      logSendCopyHotkeyVisualDecide(snapshot, visualOwner, idleView, capability, {
        ...(extra && typeof extra === 'object' ? extra : {}),
        reason: 'stale-running-suppressed',
      });
      return idleView;
    }
    if (runningState.isRunning) {
      const runningPhase = runningState.phase || 'running';
      const isWaitingReplyView =
        runningPhase === 'waiting_reply'
        || runningPhase === 'waiting_response'
        || runningPhase === 'sent_waiting_response'
        || runningPhase === 'answering';
      resolvedView = {
        ...resolvedView,
        phase: isWaitingReplyView ? TaskPhase.WAITING_REPLY : TaskPhase.RUNNING,
        text: getNormalButtonIdleLabel('send-copy-hotkey', SEND_COPY_HOTKEY_BUTTON_LABEL),
        title: '正在执行发送+复制+快捷键；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: isWaitingReplyView ? 'waiting_reply' : 'running',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: 'cgpt-send-copy-hotkey-once',
      };
      const forceLine =
        `[SEND_COPY_HOTKEY_BUTTON][VISUAL_FORCE_RUNNING] `
        + `taskPhase=${runningPhase} ownerButtonId=${runningState.ownerButtonId || '-'} `
        + `finalPhase=${String(resolvedView.phase || '-')} finalColor=running`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(forceLine);
      } else {
        console.info(forceLine);
      }
    }
    const normalizedView = (visualOwner && visualOwner.owned) || runningState.isRunning
      ? resolvedView
      : normalizeSendCopyHotkeyIdleView(resolvedView, extra && extra.renderReason ? extra.renderReason : 'finalize');
    logSendCopyHotkeyVisualDecide(snapshot, visualOwner, normalizedView, capability, extra);
    return normalizedView;
  }

  function computeSendCopyHotkeyButtonViewState(snapshot = {}, options = {}) {
    void options;
    const sendCopyHotkeyLabel = getNormalButtonIdleLabel('send-copy-hotkey', SEND_COPY_HOTKEY_BUTTON_LABEL);
    const sendCopyTask = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const taskPhase = normalizeVmSendCopyHotkeyPhase(sendCopyTask.phase || sendCopyTask.subPhase || '');
    if (isVmSendCopyHotkeyRunningPhase(taskPhase)) {
      const runningView = {
        phase: TaskPhase.RUNNING,
        text: sendCopyHotkeyLabel,
        title: getVmSendCopyHotkeyTitleByPhase(taskPhase),
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: taskPhase,
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: 'cgpt-send-copy-hotkey-once',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, runningView, {
        flow: 'simple-task-phase',
        taskPhase,
      });
      return runningView;
    }
    if (taskPhase === 'failed') {
      const failedTitle = String(sendCopyTask.lastError || '').trim() || '执行失败';
      const failedView = {
        phase: TaskPhase.FAILED,
        text: sendCopyHotkeyLabel,
        title: failedTitle,
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'failed',
        forceDanger: false,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: '',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, failedView, {
        flow: 'simple-task-phase',
        taskPhase,
      });
      return failedView;
    }

    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    let idleTitle = '先发送当前输入框消息，等待回答完成后复制最后回复并触发目标快捷键';
    if (topReplyAnswering || topReplyWaiting || topReplyBusy) {
      idleTitle = `当前左上角状态：${String(topReplyStatus.text || '').trim() || '回答中'}`;
    }
    const idleView = {
      phase: TaskPhase.IDLE,
      text: sendCopyHotkeyLabel,
      title: idleTitle,
      disabled: false,
      allowCancel: false,
      action: 'send-copy-hotkey',
      runtimeAction: '',
      buttonPhase: 'idle',
      forceDanger: false,
      taskKey: 'send-copy-hotkey',
      ownerButtonId: '',
    };
    logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, idleView, {
      flow: 'simple-top-reply',
      taskPhase,
      topReplyStatus: String(topReplyStatus.key || topReplyStatus.text || '').trim().toLowerCase(),
    });
    return idleView;
  }

  function getSendCopyHotkeyButtonViewState(snapshot = {}, options = {}) {
    const capability =
      snapshot.capability
      || snapshot.composerCapability
      || snapshot.chatInputCapability
      || snapshot.bridgeCapability
      || snapshot.inputCapability
      || {};
    const extra = options && typeof options === 'object' ? options : {};
    const view = computeSendCopyHotkeyButtonViewState(snapshot, extra);
    return finalizeSendCopyHotkeyButtonViewState(snapshot, view, capability, extra);
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
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyAnswering;
    void topReplyWaiting;
    void topReplyBusy;
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

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: snapshot.continueLabel || '复制+快捷键+继续',
      title: snapshot.continueTitle || '等待回答完成 -> 检查终止信号 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
  }

  function getAutoContinueButtonViewState(autoState, snapshot = {}) {
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyBusy;
    if (!autoState || typeof autoState !== 'object') {
      return decorateIdleViewWithTopReplyStatus({
        phase: TaskPhase.IDLE,
        text: '无限继续',
        title: '复用自动指令队列：循环发送“继续”；再点一次停止',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      }, snapshot);
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

    if (
      phase === TaskPhase.WAITING_REPLY
      || phase === 'waiting_reply'
      || autoState.waitingReply
    ) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '无限继续',
        title: '正在等待 ChatGPT 回复完成，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'waiting',
        forceDanger: true,
      };
    }

    if (activePhases.has(phase) || autoState.running) {
      return {
        phase: TaskPhase.RUNNING,
        text: '无限继续',
        title: '自动继续正在运行，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
        forceDanger: true,
      };
    }

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: '无限继续',
      title: '复用自动指令队列：循环发送“继续”；再点一次停止',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
  }

  function getAutoContinueUntilDoneButtonViewState(autoState, snapshot = {}) {
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyBusy;
    if (!autoState || typeof autoState !== 'object') {
      return decorateIdleViewWithTopReplyStatus({
        phase: TaskPhase.IDLE,
        text: '无限继续直到完成',
        title: '持续自动继续，直到检测到任务完成',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      }, snapshot);
    }

    const autoOwner = resolveAutoQueueOwnerAction(autoState);
    if (!autoOwner) {
      return decorateIdleViewWithTopReplyStatus({
        phase: TaskPhase.IDLE,
        text: '无限继续直到完成',
        title: '持续自动继续，直到检测到任务完成',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      }, snapshot);
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
        text: '无限继续直到完成',
        title: '智能继续正在等待 ChatGPT 回复完成，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'waiting',
        forceDanger: true,
      };
    }

    if (activePhases.has(phase) || autoState.running) {
      return {
        phase: TaskPhase.RUNNING,
        text: '无限继续直到完成',
        title: '智能继续正在运行，点击可停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'running',
        forceDanger: true,
      };
    }

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: '无限继续直到完成',
      title: '持续自动继续，直到检测到任务完成',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
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
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      if (authority.replyWaiting === true) {
        return 'waiting_reply';
      }
      if (authority.replySending === true || authority.sendBusy === true) {
        return 'sending';
      }
      if (authority.replyAnswering === true || authority.replyBusy === true) {
        return 'answering';
      }
      return 'idle';
    }
    const top = getTopReplyStatusFromSnapshot(snapshot);
    if (top.waitingReply) {
      return 'waiting_reply';
    }
    if (top.sending) {
      return 'sending';
    }
    if (top.answering || top.busy) {
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
    void capability;
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return authority.replyBusy === true;
    }
    const pageReplyStatus = getPageReplyStatus(snapshot);
    return !!(
      isTopReplyBusyForButtons(snapshot)
      || pageReplyStatus === 'answering'
      || pageReplyStatus === 'waiting_reply'
      || pageReplyStatus === 'sending'
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
      const authorityForUploadAction = getToolboxAuthorityFromSnapshot(snapshot);
      if (authorityForUploadAction && authorityForUploadAction.uploadQuotaExceeded === true) {
        console.warn('[UPLOAD_ACTION][BLOCKED_BY_QUOTA]', {
          action: normalized,
          reason: 'upload-quota-exceeded',
          uploadQuotaRemaining: authorityForUploadAction.uploadQuotaRemaining,
          canUploadByHeader: authorityForUploadAction.canUploadByHeader,
        });
        return {
          disabled: true,
          reason: 'upload-quota-exceeded',
          sendPhase,
          sendHotkeyPhase,
          copyPhase,
          copyHotkeyPhase,
          waitContinuePhase,
          pageReplyStatus,
        };
      }
      if (replyBusy) {
        console.warn('[UPLOAD_ACTION][BLOCKED_BY_REPLY_BUSY]', {
          action: normalized,
          reason: 'reply-busy',
        });
        return {
          disabled: true,
          reason: 'reply-busy',
          sendPhase,
          sendHotkeyPhase,
          copyPhase,
          copyHotkeyPhase,
          waitContinuePhase,
          pageReplyStatus,
        };
      }
      disabled = false;
      reason = 'ok';
    } else if (normalized === 'send-message') {
      disabled = sendPhase === TaskPhase.SENDING
        || sendPhase === TaskPhase.WAITING_SEND
        || sendPhase === TaskPhase.WAITING_PAGE_REPLY_TO_SEND
        || sendPhase === 'waiting_ready'
        || sendPhase === TaskPhase.CANCELLING;
      reason = disabled
        ? `send-message-blocked-${sendPhase || pageReplyStatus}`
        : (
          pageReplyStatus === 'answering' || pageReplyStatus === 'waiting_reply' || replyBusy
            ? 'send-message-click-blocked-assistant-answering'
            : 'ok'
        );
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
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyAnswering;
    void topReplyWaiting;
    void topReplyBusy;
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

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: '复制并继续',
      title: '先复制最后回复，再发送“继续”',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
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
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    void topReplyStatus;
    void topReplyAnswering;
    void topReplyWaiting;
    void topReplyBusy;
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

    return decorateIdleViewWithTopReplyStatus({
      phase: TaskPhase.IDLE,
      text: snapshot.loopLabel || '无限连续复制+快捷键+继续',
      title: snapshot.loopTitle || '循环：等待回答 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    }, snapshot);
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
      if (base.text === '等待输入框' || base.text === '准备发送') {
        return { ...base, phase: ButtonState.Phase.WAITING_INPUT };
      }
      if (base.text === '等待附件' || base.text === '上传中') {
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
      if (buttonPhase === 'waiting_reply_idle' || view.phase === 'waiting_reply_idle') {
        if (view.pageBusyButNotClosedLoop === true || buttonPhase === 'idle_page_busy') {
          return {
            ...base,
            phase: ButtonState.Phase.IDLE,
            disabled: !!view.disabled,
            allowCancel: false,
            preserveBaseColorWhenDisabled: view.preserveBaseColorWhenDisabled === true,
            className: view.className || CLOSED_LOOP_IDLE_CLASS_NAME,
          };
        }
        return {
          ...base,
          phase: ButtonState.Phase.WAITING,
          disabled: !!view.disabled,
          allowCancel: view.allowCancel === true,
          className: view.className
            || 'cgpt-btn cyan cgpt-btn-closed-loop cgpt-btn-closed-loop-waiting-reply',
        };
      }
      if (view.pageBusyButNotClosedLoop === true || buttonPhase === 'idle_page_busy') {
        return {
          ...base,
          phase: ButtonState.Phase.IDLE,
          disabled: !!view.disabled,
          allowCancel: false,
          preserveBaseColorWhenDisabled: view.preserveBaseColorWhenDisabled === true,
          className: view.className || CLOSED_LOOP_IDLE_CLASS_NAME,
        };
      }
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

    if (view.forceDanger === true || buttonPhase === 'danger') {
      return {
        ...base,
        phase: ButtonState.Phase.DANGER,
        disabled: !!view.disabled,
        allowCancel: !!view.allowCancel,
        runtimeAction: view.runtimeAction || view.action || '',
        ownerButtonId: view.ownerButtonId || '',
        permanentDanger: view.allowCancel !== true,
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
      return {
        ...base,
        phase: ButtonState.Phase.IDLE,
        disabled: !!view.disabled,
        preserveBaseColorWhenDisabled: true,
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

    const resolvedView = view && typeof view === 'object' ? view : {};
    if (
      button.id === 'cgpt-send-copy-hotkey-once'
      && (
        String(resolvedView.phase || '').trim().toLowerCase() === 'idle'
        || String(resolvedView.buttonPhase || '').trim().toLowerCase() === 'idle'
      )
    ) {
      button.classList.remove('cgpt-btn-danger');
      button.classList.remove('cgpt-action-running');
      button.classList.remove('cgpt-btn-busy');
      button.classList.remove('cgpt-btn-running');
      button.classList.remove('cgpt-btn-waiting');
      button.classList.remove('cgpt-action-button-active');
      button.setAttribute('data-cgpt-button-phase', 'idle');
      button.dataset.cgptButtonPhase = 'idle';
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-busy', 'false');
    }

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

    if (button.dataset.cgptShortActionBusy === '1') {
      return false;
    }

    cleanupMutuallyExclusiveButtonStateClasses(button, {
      phase: view.phase,
      viewState: view,
      reason: reason || 'apply-upload-button-view-state',
    });

    const beforeRender = captureButtonRenderSnapshot(button);
    let snapshot = applyOptions.snapshot && typeof applyOptions.snapshot === 'object'
      ? applyOptions.snapshot
      : {};
    if (isRuntimeBatchTaskGroupRunning(snapshot)) {
      snapshot = {
        ...snapshot,
        batchTaskRunning: true,
        batchTaskOwner: 'batch-task-group',
        waitingReplyOwner: 'batch-task-group',
        runningOwner: buildBatchTaskGroupRunningOwner(snapshot),
      };
    } else if (!String(snapshot.waitingReplyOwner || '').trim()) {
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
    resolvedView = suppressNonOwnerRedView(
      action,
      resolvedView,
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

    if (
      button.id === SEND_MESSAGE_OWNER_BUTTON_ID
      && (resolvedView.forceDanger === true || resolvedView.buttonPhase === 'danger')
      && isCopyHotkeyOnceTaskRunning(snapshot)
      && !isSendMessageButtonOwner(snapshot)
    ) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_STATE][POLLUTION_BLOCKED] target=${SEND_MESSAGE_OWNER_BUTTON_ID} pollutedBy=copy-hotkey-once reason=${reason || '-'}`,
        );
      }
      resolvedView = {
        ...resolvedView,
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
        ownerButtonId: '',
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
        && isRuntimeCancelLikeAction(runtimeAction)
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
      } else if (
        ownPhase === TaskPhase.IDLE
        && pageReplyBlocked
        && decideForRuntime.disabled
        && action !== 'copy-and-hotkey'
        && action !== 'copy-hotkey-once'
      ) {
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
        const sendMessageAnsweringClickBlock = action === 'send-message'
          && ownPhase === TaskPhase.IDLE
          && !decideForRuntime.disabled
          && decideForRuntime.reason === 'send-message-click-blocked-assistant-answering';
        if (sendMessageAnsweringClickBlock) {
          resolvedView = {
            ...resolvedView,
            phase: TaskPhase.IDLE,
            disabled: false,
            action: 'send-message',
            runtimeAction: 'send-message',
            buttonPhase: 'idle',
            forceDanger: false,
            preserveBaseColorWhenDisabled: true,
            visualDim: false,
            clickBlocked: true,
            disabledVisualOnly: false,
          };
          logButtonViewDiagnostic('PLAIN_SEND_CLICK_BLOCKED_KEEP_GREEN', {
            action: decideAction || action || '-',
            reason: decideForRuntime.reason,
          });
        } else if (decideForRuntime.disabled !== viewDisabled) {
          const keepIdleColor = ownPhase === TaskPhase.IDLE
            && (
              isBlockedByPageReplyBusyReason(decideForRuntime.reason)
              || decideForRuntime.reason === 'send-message-click-blocked-assistant-answering'
            );
          resolvedView = {
            ...resolvedView,
            disabled: decideForRuntime.disabled,
            action: decideForRuntime.disabled && resolvedView.action === 'start'
              ? 'none'
              : resolvedView.action,
            buttonPhase: keepIdleColor
              ? 'idle'
              : (decideForRuntime.disabled
                ? (resolvedView.buttonPhase === 'waiting' ? resolvedView.buttonPhase : 'idle')
                : (resolvedView.buttonPhase === 'disabled' ? 'idle' : resolvedView.buttonPhase)),
            preserveBaseColorWhenDisabled: keepIdleColor || decideForRuntime.disabled
              ? true
              : resolvedView.preserveBaseColorWhenDisabled,
            disabledVisualOnly: decideForRuntime.disabled === true,
            visualDim: action === 'send-message' ? false : resolvedView.visualDim,
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

    if (
      button.id === 'cgpt-send-copy-hotkey-once'
      || canonicalAction === 'send-copy-hotkey'
    ) {
      const sendCopyLabel = getNormalButtonIdleLabel('send-copy-hotkey', SEND_COPY_HOTKEY_BUTTON_LABEL);
      const statusTitle = String(resolvedView.title || '').trim();
      resolvedView = {
        ...resolvedView,
        text: sendCopyLabel,
        title: statusTitle || sendCopyLabel,
      };
    }

    resolvedView = applyUnifiedButtonVisualState(
      button,
      resolvedView,
      snapshot,
      canonicalAction,
    );
    resolvedView = suppressNonOwnerRedView(
      canonicalAction || action,
      resolvedView,
      snapshot,
      button,
      `${reason || '-'}:after-unified-visual`,
    );
    if (
      snapshot.closedLoopContinueRunning === true
      && isClosedLoopActionName(canonicalAction)
      && !isClosedLoopOwnerAction(canonicalAction, snapshot)
    ) {
      clearClosedLoopStopVisualClasses(button);
    }
    if (
      (action === 'copy-and-hotkey' || action === 'copy-hotkey-once')
      && button.id === COPY_HOTKEY_ONCE_OWNER_BUTTON_ID
      && (
        resolvedView.phase === TaskPhase.IDLE
        || String(resolvedView.buttonPhase || '').trim().toLowerCase() === 'idle'
      )
    ) {
      clearClosedLoopStopVisualClasses(button);
      button.classList.remove('cgpt-action-running', 'cgpt-btn-waiting-danger', 'cgpt-btn-busy');
    }

    const options = isSendBtn
      ? mapSendMessageViewStateToToolboxOptions(resolvedView, reason)
      : mapViewStateToToolboxOptions(resolvedView, reason);

    if (
      (action === 'copy-and-hotkey' || action === 'copy-hotkey-once')
      && button.id === COPY_HOTKEY_ONCE_OWNER_BUTTON_ID
      && options.disabled === true
      && (typeof isEffectiveReplyBusy === 'function' ? isEffectiveReplyBusy(snapshot) : false)
    ) {
      const invalidLine = `[COPY_HOTKEY_BUTTON][INVALID_DISABLED_DURING_GENERATING] reason=should-be-clickable id=${button.id || '-'}`;
      console.error(invalidLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(invalidLine);
      }
      options.disabled = false;
      resolvedView = {
        ...resolvedView,
        disabled: false,
        action: 'copy-hotkey-once',
        runtimeAction: '',
      };
      if (typeof ButtonState !== 'undefined' && typeof ButtonState.setButtonRuntimeAction === 'function') {
        ButtonState.setButtonRuntimeAction(button, '');
      } else {
        delete button.dataset.cgptRuntimeAction;
        delete button.dataset.cgptButtonAction;
      }
    }

    const resolvedIdlePhase = normalizeTaskPhase(resolvedView.phase) === TaskPhase.IDLE;
    const resolvedIdleButtonPhase = String(resolvedView.buttonPhase || '').trim().toLowerCase() === 'idle';
    const isSendCopyHotkeyRenderButton = button.id === 'cgpt-send-copy-hotkey-once'
      || canonicalAction === 'send-copy-hotkey';
    const sendCopyHotkeyRunningForCleanup = isSendCopyHotkeyRenderButton
      ? resolveSendCopyHotkeyTaskRunningState(snapshot)
      : { isRunning: false };
    if (
      (resolvedIdlePhase || resolvedIdleButtonPhase)
      && !(isSendCopyHotkeyRenderButton && sendCopyHotkeyRunningForCleanup.isRunning)
    ) {
      cleanupNonIdleButtonClasses(
        button,
        TaskPhase.IDLE,
        `${reason || '-'}:force-idle-cleanup-before-apply`,
      );
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-busy', 'false');
      if (button.dataset.autoDangerEnterBlock === '1') {
        button.removeAttribute('data-danger-enter-block');
        delete button.dataset.autoDangerEnterBlock;
      }
    } else if (isSendCopyHotkeyRenderButton && sendCopyHotkeyRunningForCleanup.isRunning) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_CLASS_CLEANUP][SKIP_RUNNING_SEND_COPY_HOTKEY] id=${button.id || '-'} reason=${reason || '-'}`,
        );
      }
      button.classList.add('cgpt-btn-danger');
      button.classList.add('cgpt-action-running');
      button.classList.remove('cgpt-btn-idle');
    }

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

    const ownerButtonId = String(resolvedView.ownerButtonId || '').trim();
    if (ownerButtonId) {
      button.dataset.cgptOwnerButtonId = ownerButtonId;
    } else {
      delete button.dataset.cgptOwnerButtonId;
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
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLogIfChanged === 'function') {
      ToolboxShell.appendLogIfChanged(
        `BUTTON_AUTHORITY_APPLY:${button.id || '-'}`,
        [
          button.id || '-',
          canonicalAction || action || '-',
          snapshot.canSend ? 1 : 0,
          snapshot.canInput ? 1 : 0,
          snapshot.sendable ? 1 : 0,
          snapshot.inputable ? 1 : 0,
          snapshot.realSendReady ? 1 : 0,
          snapshot.replyBusy ? 1 : 0,
          snapshot.taskBusy ? 1 : 0,
          snapshot.pendingSend ? 1 : 0,
          snapshot.sendPhase || '-',
          resolvedView.phase || '-',
          resolvedView.buttonPhase || '-',
          options.disabled ? 1 : 0,
          reason || '-',
        ].join('|'),
        [
          '[BUTTON_STATE][AUTHORITY_APPLY]',
          `id=${button.id || '-'}`,
          `action=${canonicalAction || action || '-'}`,
          `canSend=${snapshot.canSend ? 1 : 0}`,
          `canInput=${snapshot.canInput ? 1 : 0}`,
          `sendable=${snapshot.sendable ? 1 : 0}`,
          `inputable=${snapshot.inputable ? 1 : 0}`,
          `realSendReady=${snapshot.realSendReady ? 1 : 0}`,
          `replyBusy=${snapshot.replyBusy ? 1 : 0}`,
          `taskBusy=${snapshot.taskBusy ? 1 : 0}`,
          `pendingSend=${snapshot.pendingSend ? 1 : 0}`,
          `sendPhase=${snapshot.sendPhase || '-'}`,
          `viewPhase=${resolvedView.phase || '-'}`,
          `buttonPhase=${resolvedView.buttonPhase || '-'}`,
          `disabled=${options.disabled ? 1 : 0}`,
          `reason=${reason || '-'}`,
        ].join(' '),
        1000,
      );
    }
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLogIfChanged === 'function') {
      ToolboxShell.appendLogIfChanged(
        `BUTTON_VIEW_RENDER_SOURCE:${button.id || '-'}`,
        [
          button.id || '-',
          canonicalAction || action || '-',
          resolvedView.phase || '-',
          resolvedView.buttonPhase || '-',
          reason || '-',
        ].join('|'),
        [
          '[BUTTON_VIEW][SOURCE]',
          `id=${button.id || '-'}`,
          `action=${canonicalAction || action || '-'}`,
          `phase=${resolvedView.phase || '-'}`,
          `buttonPhase=${resolvedView.buttonPhase || '-'}`,
          `taskKey=${resolvedView.taskKey || '-'}`,
          `reason=${reason || '-'}`,
          'source=snapshot-vm-buttonstate',
        ].join(' '),
        1200,
      );
    }

    applyButtonDisabledVisualOnlyState(button, resolvedView, canonicalAction || action);

    if (button.id === SEND_MESSAGE_OWNER_BUTTON_ID || canonicalAction === 'send-message') {
      const gateCapability = snapshot.capability && typeof snapshot.capability === 'object'
        ? snapshot.capability
        : {};
      const gate = applyPlainSendMessageClickGate(
        button,
        snapshot,
        gateCapability,
        reason || 'apply-upload-button-view-state',
      );
      logSendMessageButtonVisualDecide(
        snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
          ? snapshot.sendMessageTask
          : {},
        snapshot,
        gateCapability,
        { reason: `click-gate:${reason || '-'}` },
      );
    }

    const appliedPhase = normalizeTaskPhase(resolvedView.phase);
    const isSendCopyHotkeyButton = button.id === 'cgpt-send-copy-hotkey-once'
      || canonicalAction === 'send-copy-hotkey';
    if (
      appliedPhase === TaskPhase.IDLE
      || appliedPhase === TaskPhase.FAILED
      || String(resolvedView.buttonPhase || '').trim().toLowerCase() === 'idle'
    ) {
      const sendCopyHotkeyVisualOwner = isSendCopyHotkeyButton
        ? isSendCopyHotkeyVisualOwner(snapshot)
        : { owned: false, source: '-', phase: 'idle' };
      const sendCopyHotkeyOwnerPhase = String(sendCopyHotkeyVisualOwner.phase || '').trim().toLowerCase();
      const sendCopyHotkeyOwnerTerminalPhases = new Set([
        '',
        'idle',
        'success',
        'failed',
        'cancelled',
        'canceled',
      ]);
      const sendCopyHotkeyOwnerPhaseActive =
        sendCopyHotkeyVisualOwner.owned === true
        && !sendCopyHotkeyOwnerTerminalPhases.has(sendCopyHotkeyOwnerPhase);
      const sendCopyHotkeyRunningFromSnapshot = isSendCopyHotkeyButton
        ? resolveSendCopyHotkeyTaskRunningState(snapshot)
        : { isRunning: false, staleSuppressed: false };
      const skipSendCopyHotkeyIdleCleanup = isSendCopyHotkeyButton
        && sendCopyHotkeyRunningFromSnapshot.staleSuppressed !== true
        && (sendCopyHotkeyOwnerPhaseActive || sendCopyHotkeyRunningFromSnapshot.isRunning);
      if (skipSendCopyHotkeyIdleCleanup) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_CLASS_CLEANUP][SKIP_IDLE_CLEANUP_ACTIVE_SEND_COPY_HOTKEY] id=${button.id || '-'} source=${sendCopyHotkeyVisualOwner.source} phase=${sendCopyHotkeyVisualOwner.phase} snapshotRunning=${sendCopyHotkeyRunningFromSnapshot.isRunning ? 1 : 0}`,
          );
        }
        button.classList.add('cgpt-btn-danger');
        button.classList.add('cgpt-action-running');
        button.classList.remove('cgpt-btn-idle');
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_VISUAL][FORCE_SEND_COPY_HOTKEY_RED] id=${button.id || '-'} `
            + `phase=${sendCopyHotkeyVisualOwner.phase || resolvedView.phase || '-'} `
            + `buttonPhase=${resolvedView.buttonPhase || '-'} reason=active-send-copy-hotkey`,
          );
        }
      } else {
        cleanupMutuallyExclusiveButtonStateClasses(button, {
          phase: 'idle',
          viewState: resolvedView,
          reason: `post-apply-idle:${reason || '-'}`,
        });
        if (isSendCopyHotkeyButton) {
          cleanupNonIdleButtonClasses(button, 'idle', reason || 'post-apply-idle');
          button.classList.remove('cgpt-btn-danger');
          button.classList.remove('cgpt-action-running');
          button.classList.remove('cgpt-btn-busy');
          button.classList.remove('cgpt-btn-running');
          button.classList.remove('cgpt-btn-waiting');
          button.classList.remove('cgpt-action-button-active');
          button.dataset.cgptButtonPhase = 'idle';
          button.dataset.cgptTaskPhase = TaskPhase.IDLE;
          button.removeAttribute('aria-busy');
          button.setAttribute('aria-busy', 'false');
          delete button.dataset.cgptOwnerButtonId;
          delete button.dataset.cgptRuntimeAction;
        }
      }
    }

    if (
      button
      && button.id === 'cgpt-send-copy-hotkey-once'
      && String(resolvedView.phase || '').trim().toLowerCase() === 'idle'
      && (
        button.classList.contains('cgpt-btn-danger')
        || button.classList.contains('cgpt-action-running')
        || button.classList.contains('cgpt-btn-busy')
      )
    ) {
      const line =
        `[BUTTON_COLOR][IDLE_SEND_COPY_HOTKEY_RED_LEAK] `
        + `id=${button.id || '-'} phase=${resolvedView.phase || '-'} `
        + `buttonPhase=${resolvedView.buttonPhase || '-'} `
        + `ownerButtonId=${resolvedView.ownerButtonId || '-'} `
        + `class=${String(button.className || '').trim()}`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.error(line);
      }
      button.classList.remove('cgpt-btn-danger');
      button.classList.remove('cgpt-action-running');
      button.classList.remove('cgpt-btn-busy');
      button.classList.remove('cgpt-btn-running');
      button.classList.remove('cgpt-btn-waiting');
    }

    if (isClosedLoopActionName(canonicalAction)) {
      const shouldShowClosedLoopBusy = shouldShowClosedLoopBusyStyle(resolvedView, snapshot, canonicalAction);
      if (options.className) {
        applyClosedLoopButtonClassName(button, options.className);
      }
      if (!shouldShowClosedLoopBusy) {
        clearClosedLoopStopVisualClasses(button);
        button.classList.remove('cgpt-btn-closed-loop-waiting-reply');
      }
      logClosedLoopButtonStyleDecide(button, resolvedView, options, {
        running: snapshot.closedLoopContinueRunning === true,
        isOwner: isClosedLoopOwnerAction(canonicalAction, snapshot),
        busy: shouldShowClosedLoopBusy,
      });
    }
    const suppressNativeTooltip = resolvedView.suppressNativeTooltip === true
      || resolvedView.lockedByClosedLoop === true;
    if (suppressNativeTooltip) {
      button.removeAttribute('title');
      delete button.dataset.cgptStatusText;
      const ariaLabel = String(
        resolvedView.ariaLabel
        || resolvedView.disabledReason
        || resolvedView.text
        || button.textContent
        || '',
      ).trim();
      if (ariaLabel) {
        button.setAttribute('aria-label', ariaLabel);
      }
      if (resolvedView.disabledReason) {
        button.dataset.disabledReason = String(resolvedView.disabledReason || '').trim();
      }
    } else {
      const statusTitle = String(resolvedView.title || '').trim();
      const dynamicStatusText = (
        typeof ButtonState !== 'undefined'
        && typeof ButtonState.isDynamicButtonStatusText === 'function'
        && ButtonState.isDynamicButtonStatusText(resolvedView.text)
      )
        ? String(resolvedView.text || '').trim()
        : '';
      const titleToApply = statusTitle || dynamicStatusText;
      if (titleToApply) {
        button.title = titleToApply;
        if (
          typeof ButtonState !== 'undefined'
          && typeof ButtonState.isStableActionButton === 'function'
          && ButtonState.isStableActionButton(button)
        ) {
          button.dataset.cgptStatusText = titleToApply;
        }
      } else if (typeof ButtonState !== 'undefined' && typeof ButtonState.getStableButtonText === 'function') {
        const stableTitle = ButtonState.getStableButtonText(button, resolvedView);
        if (stableTitle) {
          button.title = stableTitle;
          delete button.dataset.cgptStatusText;
        }
      }
    }
    const debugEnabled = (
      (typeof isUploadDebugEnabled === 'function' && isUploadDebugEnabled())
      || (typeof getCompactUiConfig === 'function' && (getCompactUiConfig() || {}).debugMode === true)
    );
    if (debugEnabled && typeof ButtonState.assertCancellableButtonConsistency === 'function') {
      ButtonState.assertCancellableButtonConsistency(button, resolvedView, reason);
    }
    if (button.id === 'cgpt-send-copy-hotkey-once' || canonicalAction === 'send-copy-hotkey') {
      applySendCopyHotkeyButtonColorDecide(button, snapshot, resolvedView, {
        reason: reason || 'apply-upload-button-view-state',
        renderReason: applyOptions.renderReason || '',
      });
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
    getSendMessageRunningTextByPhase,
    getSendCopyHotkeyRunningTextByPhase,
    getSendLikePendingRunningText,
    getSendMessageButtonViewState,
    isPlainSendMessageTask,
    isPlainSendButtonDangerPhase,
    shouldPlainSendButtonShowRunningDanger,
    resolvePlainSendMessageVisualGate,
    applyPlainSendMessageClickGate,
    getCopyLastReplyButtonViewState,
    getCopyHotkeyOnceButtonViewState,
    getSendCopyHotkeyButtonViewState,
    computeSendCopyHotkeyButtonViewState,
    isSendCopyHotkeyVisualOwner,
    logSendCopyHotkeyVisualDecide,
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
    getDefaultButtonColorByAction,
    normalizeToolboxButtonColor,
    applyButtonDisabledVisualOnlyState,
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


