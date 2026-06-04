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
      const replyBusy = unified.flags && unified.flags.replyBusy === true;
      return {
        isToolboxStatusAuthoritySnapshot: true,
        replyText: unified.reply.text || '',
        replyAnswering: replyBusy || unified.flags.answering === true,
        replyWaiting: replyBusy,
        replyBusy,
        replyReady: unified.flags.ready === true,
        shouldWaitReplyByTopStatus: unified.flags.replyBusy === true,
        canSendByTopStatus: unified.flags.canSend === true || snap.canSend === true,
        canStartUploadByTopStatus: unified.flags.canUpload === true,
        responseState: unified.raw && unified.raw.responseState ? unified.raw.responseState : '',
        responseReason: unified.raw && unified.raw.responseReason ? unified.raw.responseReason : '',
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
    const reason = typeof reasonOrSnapshot === 'string'
      ? reasonOrSnapshot
      : 'upload-button-vm:isTopReplyBusyForButtons';
    const snapshot = getButtonAuthoritySnapshot(reason);
    return snapshot.replyBusy === true;
  }

  function isTopReplyAnsweringForButtons(snapshot = {}) {
    const status = getTopReplyStatusFromSnapshot(snapshot);
    return !!status.answering;
  }

  function isTopReplyWaitingForButtons(snapshot = {}) {
    const status = getTopReplyStatusFromSnapshot(snapshot);
    return !!status.waitingReply;
  }

  function resolvePageBusyForButtons(snapshot = {}) {
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return authority.replyBusy === true;
    }
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    return !!topReplyBusy;
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
    const snapshot = getButtonAuthoritySnapshot(reason);
    return snapshot.replyBusy === true
      || snapshot.taskBusy === true
      || snapshot.attachmentBusy === true;
  }

  function isAuthorityReplyAnsweringForButtons(snapshot = {}) {
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return !!(
        authority.replyAnswering === true
        || authority.replyBusy === true
      );
    }
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    return !!(
      topReplyStatus.answering
      || topReplyStatus.busy
    );
  }

  function isAuthorityReplyWaitingForButtons(snapshot = {}) {
    const authority = getToolboxAuthorityFromSnapshot(snapshot);
    if (authority) {
      return !!(
        authority.replyWaiting === true
        || authority.shouldWaitReplyByTopStatus === true
      );
    }
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    return !!topReplyStatus.waitingReply;
  }

  function decorateIdleViewWithTopReplyStatus(view, snapshot = {}, options = {}) {
    const phase = normalizeTaskPhase(view && view.phase);
    if (phase !== TaskPhase.IDLE) {
      return view;
    }
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
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

  function resolveStopVisibleFromAuthority(snapshot = {}) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const authority = snap.toolboxUnifiedAuthority;
    if (authority && authority.composer && typeof authority.composer === 'object') {
      const stopVisible = authority.composer.hasRealStopButton === true;
      const line = `[SEND_BUTTON][STOP_VISIBLE_FROM_AUTHORITY] stop=${stopVisible ? 1 : 0} source=toolboxUnifiedAuthority`;
      console.log(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
      return stopVisible;
    }
    const topReplyAnswering = isTopReplyAnsweringForButtons(snap);
    const line = `[SEND_BUTTON][STOP_VISIBLE_FROM_AUTHORITY] stop=${topReplyAnswering ? 1 : 0} source=topReplyAnswering-fallback`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
    return topReplyAnswering;
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

  function isSendFamilyOwner(snapshot, action) {
    const batchOwner = getBatchTaskGroupOwnerFromSnapshot(snapshot);
    if (batchOwner) {
      return false;
    }
    const task = getSendFamilyTaskFromSnapshot(snapshot);
    if (!task || !task.running) {
      return false;
    }
    const current = String(task.action || (task.plan && task.plan.mode) || 'send-message').trim();
    return current === String(action || '').trim();
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
    const cap = capability && typeof capability === 'object' ? capability : {};
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const responseState = String(
      cap.response_state
      || cap.responseState
      || snap.response_state
      || snap.responseState
      || snap.replyState
      || '',
    ).trim().toLowerCase();
    const replyBusy = !!(
      isAuthorityReplyBusyForButtons(snap)
      || isAuthorityReplyAnsweringForButtons(snap)
      || cap.replyBusy
      || cap.assistantBusy
      || cap.responseBusy
    );
    const canSendNow = !!(
      cap.can_send_now === true
      || cap.canSendNow === true
      || cap.send_decision === 'allowed'
      || cap.sendDecision === 'allowed'
      || snap.can_send_now === true
      || snap.canSendNow === true
      || snap.sendable === true
      || snap.canSend === true
      || (
        snap.toolboxUnifiedAuthority
        && snap.toolboxUnifiedAuthority.flags
        && snap.toolboxUnifiedAuthority.flags.canSend === true
      )
    );
    const blockedBecauseAnswering = (
      responseState === 'responding'
      || responseState === 'generating'
      || responseState === 'streaming'
      || replyBusy
    );
    const clickBlocked = !canSendNow && blockedBecauseAnswering;
    return {
      responseState: responseState || '-',
      replyBusy,
      canSendNow,
      blockedBecauseAnswering,
      clickBlocked,
      visualDim: false,
    };
  }

  function applyPlainSendMessageClickGate(button, snapshot = {}, capability = {}, reason = '') {
    if (!button || button.id !== SEND_MESSAGE_OWNER_BUTTON_ID) {
      return resolvePlainSendMessageVisualGate(snapshot, capability);
    }
    const gate = resolvePlainSendMessageVisualGate(snapshot, capability);
    button.dataset.visualDim = '0';
    button.dataset.clickBlocked = gate.clickBlocked ? '1' : '0';
    button.disabled = false;
    button.removeAttribute('disabled');
    button.setAttribute('aria-disabled', gate.clickBlocked ? 'true' : 'false');
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
      button.classList.add('cgpt-send-btn-idle');
      button.classList.remove('cgpt-send-btn-busy');
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
    const task = getSendFamilyTaskFromSnapshot(snapshot);
    if (!task || task.running !== true) {
      return false;
    }
    const action = String(task.action || (task.plan && task.plan.mode) || 'send-message').trim();
    const ownerButtonId = String(task.ownerButtonId || '').trim();
    return action === 'send-message'
      && ownerButtonId === SEND_MESSAGE_OWNER_BUTTON_ID;
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
  const SEND_COPY_HOTKEY_RUNNING_CANCEL_TITLE =
    '发送+复制+快捷键流程正在进行中；再次点击将取消后续流程';

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

  function forceActiveButtonRedView(view = {}, ownerButtonId = '') {
    const base = view && typeof view === 'object' ? view : {};
    return {
      ...base,
      disabled: false,
      allowCancel: base.allowCancel !== false,
      buttonPhase: 'danger',
      forceDanger: true,
      preserveBaseColorWhenDisabled: false,
      ownerButtonId: ownerButtonId || base.ownerButtonId || '',
    };
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
        sendable: snapshot.sendable === true,
        inputable: snapshot.inputable === true,
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
        sendable: snapshot.sendable === true,
        inputable: snapshot.inputable === true,
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
        sendable: snapshot.sendable === true,
        inputable: snapshot.inputable === true,
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
        sendable: snapshot.sendable === true,
        inputable: snapshot.inputable === true,
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
      sendable: snapshot.sendable === true,
      inputable: snapshot.inputable === true,
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

    if (
      canonicalAction === 'send-copy-hotkey'
      && view
      && (
        view.forceDanger === true
        || view.runtimeAction === 'cancel'
        || view.ownerButtonId === 'cgpt-send-copy-hotkey-once'
      )
    ) {
      button.classList.add('cgpt-btn-danger');
      button.classList.add('cgpt-action-running');
      button.classList.remove('cgpt-btn-idle');
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[BUTTON_VISUAL][FORCE_SEND_COPY_HOTKEY_RED] id=${button.id || '-'} phase=${view.phase || '-'} reason=forceDanger-owner`,
        );
      }
      return view;
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
    if (
      value === 'waiting'
      || value === 'waiting_input'
      || value === 'waiting_attachment'
      || value === 'waiting_page_reply_to_send'
      || value === 'ready_to_click'
      || value === 'waiting_composer'
      || value === 'preparing'
    ) {
      return 'waiting_send';
    }
    if (
      value === 'clicking_send'
      || value === 'writing_text'
      || value === 'sending_hotkey'
      || value === 'sending_continue'
      || value === 'confirming_clipboard'
      || value === 'copying'
      || value === 'running'
    ) {
      return 'sending';
    }
    if (
      value === 'sent_waiting_response'
      || value === 'waiting_reply'
      || value === 'stopping_response'
    ) {
      return 'waiting_reply';
    }
    if (value === 'done' || value === 'completed') {
      return 'success';
    }
    if (value === 'error' || value === 'fail') {
      return 'failed';
    }
    if (value === 'cancel' || value === 'canceled') {
      return 'cancelled';
    }
    return 'idle';
  }

  function normalizeButtonVmSendSubPhase(phase, subPhase) {
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

  function getNormalizedSendTaskSubPhase(snapshot = {}) {
    const sendTask = selectAuthoritativeSendTaskSnapshot(snapshot);
    return normalizeButtonVmSendSubPhase(sendTask.phase, sendTask.subPhase);
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

    const authorityReplyBusy = isAuthorityReplyBusyForButtons(snapshot);
    const authorityReplyAnswering = isAuthorityReplyAnsweringForButtons(snapshot);
    const authorityReplyWaiting = isAuthorityReplyWaitingForButtons(snapshot);

    if (authorityReplyBusy) {
      const uploadPhase = String(
        snapshot.uploadTask && snapshot.uploadTask.phase || '',
      ).trim().toLowerCase();
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
      if (uploadTaskIdle) {
        return withUploadButtonTaskKey({
          phase: TaskPhase.IDLE,
          text: '开始上传',
          title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
          disabled: false,
          allowCancel: false,
          action: 'start-upload',
          buttonPhase: 'idle',
          preserveBaseColorWhenDisabled: false,
          disabledReason: '',
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

  function tryHealStaleWaitingReplyBeforeSendButtonView(reason) {
    if (
      typeof UploadModule === 'undefined'
      || !UploadModule
      || typeof UploadModule.maybeHealStaleWaitingReplyState !== 'function'
    ) {
      return false;
    }
    try {
      return !!UploadModule.maybeHealStaleWaitingReplyState(reason);
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[SEND_BUTTON][HEAL_STALE_WAITING_REPLY_FAILED]', error);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SEND_BUTTON][HEAL_STALE_WAITING_REPLY_FAILED] reason=${reason || '-'} error=${errText}`,
        );
      }
      return false;
    }
  }

  function getSendMessageButtonViewState(snapshot = {}, capability = {}, hints = {}) {
    const sendMessageTask = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : null;
    const isSendMessageOwner = isSendMessageButtonOwner(snapshot);
    const copyHotkeyOnceRunning = isCopyHotkeyOnceTaskRunning(snapshot);
    const sendFamilyTaskForOwner = getSendFamilyTaskFromSnapshot(snapshot);
    const sendTaskForOwner = selectAuthoritativeSendTaskSnapshot(snapshot);
    const sendFamilyActionForOwner = String(
      (sendFamilyTaskForOwner && (
        sendFamilyTaskForOwner.action
        || sendFamilyTaskForOwner.ownerAction
        || sendFamilyTaskForOwner.visualOwnerAction
        || sendFamilyTaskForOwner.plan?.mode
      ))
      || (sendTaskForOwner && (
        sendTaskForOwner.ownerAction
        || sendTaskForOwner.action
        || sendTaskForOwner.visualOwnerAction
      ))
      || snapshot.visualOwnerAction
      || '',
    ).trim();
    const sendFamilyOwnerButtonIdForOwner = String(
      (sendFamilyTaskForOwner && (
        sendFamilyTaskForOwner.ownerButtonId
        || sendFamilyTaskForOwner.visualOwnerButtonId
      ))
      || (sendTaskForOwner && (
        sendTaskForOwner.ownerButtonId
        || sendTaskForOwner.visualOwnerButtonId
      ))
      || snapshot.visualOwnerButtonId
      || '',
    ).trim();
    const sendTaskPhaseForOwner = normalizeButtonVmSendPhase(sendTaskForOwner.phase);
    const sendTaskSubPhaseForOwner = normalizeButtonVmSendSubPhase(
      sendTaskForOwner.phase,
      sendTaskForOwner.subPhase,
    );
    const sendTaskActiveForOwner = !!(
      sendTaskForOwner
      && sendTaskForOwner.running === true
      && sendTaskPhaseForOwner !== 'idle'
      && sendTaskPhaseForOwner !== 'success'
      && sendTaskPhaseForOwner !== 'failed'
      && sendTaskPhaseForOwner !== 'cancelled'
    );
    const sendTaskOwnedByCurrentButton = !!(
      sendTaskActiveForOwner
      && (
        !sendTaskForOwner.ownerButtonId
        || sendTaskForOwner.ownerButtonId === SEND_MESSAGE_OWNER_BUTTON_ID
        || sendTaskForOwner.action === 'send-message'
      )
    );
    console.log('[UPLOAD_BUTTON_VM][SEND_TASK_OWNER_CHECK]', {
      buttonId: SEND_MESSAGE_OWNER_BUTTON_ID,
      action: 'send-message',
      running: sendTaskForOwner.running,
      phase: sendTaskPhaseForOwner,
      subPhase: sendTaskSubPhaseForOwner,
      taskAction: sendTaskForOwner.action,
      ownerButtonId: sendTaskForOwner.ownerButtonId,
      runId: sendTaskForOwner.runId,
      active: sendTaskActiveForOwner,
      ownedByCurrentButton: sendTaskOwnedByCurrentButton,
    });
    const isForeignSendFamilyOwner = !!(
      (
        sendFamilyTaskForOwner
        && sendFamilyTaskForOwner.running === true
        && (
          sendFamilyActionForOwner === 'send-copy-hotkey'
          || sendFamilyActionForOwner === 'send-copy-hotkey-continue'
          || sendFamilyOwnerButtonIdForOwner === 'cgpt-send-copy-hotkey-once'
          || sendFamilyOwnerButtonIdForOwner === 'cgpt-send-copy-hotkey-continue-once'
        )
      )
      || (
        sendTaskActiveForOwner
        && (
          sendFamilyActionForOwner === 'send-copy-hotkey'
          || sendFamilyActionForOwner === 'send-copy-hotkey-continue'
          || sendFamilyOwnerButtonIdForOwner === 'cgpt-send-copy-hotkey-once'
          || sendFamilyOwnerButtonIdForOwner === 'cgpt-send-copy-hotkey-continue-once'
        )
      )
      || (
        String(snapshot.visualOwnerAction || '').trim() === 'send-copy-hotkey'
        && sendTaskActiveForOwner
      )
    );
    if (isForeignSendFamilyOwner) {
      const foreignView = withSendButtonTaskKey({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: '当前正在执行其他发送组合任务，发送消息按钮暂不可用',
        disabled: true,
        allowCancel: false,
        action: 'send-message',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
        ownerButtonId: '',
      });
      logSendButtonViewDecide(
        SEND_MESSAGE_OWNER_BUTTON_ID,
        'send-message',
        snapshot,
        foreignView,
        {
          reason: `foreign-send-owner:${sendFamilyActionForOwner || '-'}`,
        },
      );
      return foreignView;
    }
    let phase = copyHotkeyOnceRunning && !isSendMessageOwner
      ? TaskPhase.IDLE
      : getNormalizedSendTaskPhase(snapshot);

    if (phase === TaskPhase.WAITING_REPLY && tryHealStaleWaitingReplyBeforeSendButtonView('send-button-text-decide')) {
      phase = TaskPhase.IDLE;
      snapshot = Object.assign({}, snapshot, {
        sendTask: Object.assign({}, snapshot.sendTask || {}, { phase: 'idle' }),
        sendMessageTask: Object.assign({}, sendMessageTask || {}, {
          running: false,
          phase: 'idle',
        }),
        legacyFlags: Object.assign({}, snapshot.legacyFlags || {}, { waitingReply: false }),
      });
    }

    const failureHintRaw = typeof hints.failureHint === 'string' ? hints.failureHint : '';
    const successHint = typeof hints.successHint === 'string' ? hints.successHint : '';
    const pendingSendAfterReply = !!hints.pendingSendAfterReply;
    const pendingAttachmentWaitSend = !!hints.pendingAttachmentWaitSend;
    const uploadTaskActive = isUploadTaskPhaseActive(snapshot);
    const failureHint = uploadTaskActive && phase === TaskPhase.IDLE ? '' : failureHintRaw;

    capability = capability && typeof capability === 'object' ? capability : {};
    const hasComposer = !!capability.hasComposer;
    const diagnosticCapabilityResponding = !!capability.isResponding;
    void diagnosticCapabilityResponding;
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    const authorityReplyBusy = isAuthorityReplyBusyForButtons(snapshot);
    const authorityReplyAnswering = isAuthorityReplyAnsweringForButtons(snapshot);
    const authorityReplyWaiting = isAuthorityReplyWaitingForButtons(snapshot);
    void topReplyStatus;
    void topReplyBusy;
    const finish = (view, decideExtra = {}) => {
      const withKey = withSendButtonTaskKey(Object.assign({
        ownerButtonId: isSendMessageOwner ? SEND_MESSAGE_OWNER_BUTTON_ID : '',
      }, view));
      const guarded = typeof logButtonViewStateGuard === 'function'
        ? logButtonViewStateGuard('send-message', phase, withKey, snapshot, capability)
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

    if (copyHotkeyOnceRunning && !isSendMessageOwner) {
      return finish({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
      }, { reason: 'copy-hotkey-once-active' });
    }

    if (isSendMessageOwner) {
      const taskPhase = String(sendMessageTask.phase || '').trim().toLowerCase();
      const sendButtonRunning = !!sendMessageTask.running;
      logSendMessageButtonVisualDecide(sendMessageTask, snapshot, capability, {
        reason: sendButtonRunning && isPlainSendButtonDangerPhase(taskPhase)
          ? 'sending-not-submitted'
          : 'not-owned-by-send-button-or-submitted',
      });

      if (sendButtonRunning && isPlainSendButtonDangerPhase(taskPhase)) {
        return finish({
          phase: TaskPhase.WAITING_SEND,
          text: getSendMessageRunningTextByPhase(taskPhase),
          title: SEND_MESSAGE_RUNNING_CANCEL_TITLE,
          disabled: false,
          allowCancel: true,
          action: 'cancel-send',
          runtimeAction: 'cancel',
          buttonPhase: 'danger',
          forceDanger: true,
          ownerButtonId: SEND_MESSAGE_OWNER_BUTTON_ID,
        }, { reason: 'plain-send-danger-phase' });
      }

      if (sendButtonRunning && !isPlainSendButtonDangerPhase(taskPhase)) {
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: authorityReplyBusy
            ? '助手正在回复，请等待完成后再发送'
            : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          runtimeAction: 'send-message',
          buttonPhase: 'idle',
          forceDanger: false,
          ownerButtonId: SEND_MESSAGE_OWNER_BUTTON_ID,
        }, { reason: 'plain-send-submitted-not-danger' });
      }
    }
    if (sendMessageTask && isRealSendMessageTaskRunning(sendMessageTask, snapshot, 'getSendMessageButtonViewState:foreign-owner') && !isSendFamilyOwner(snapshot, 'send-message')) {
      const switchable = canSwitchSendFamilyAction(snapshot, 'send-message');
      return finish({
        phase: TaskPhase.IDLE,
        text: '发送消息',
        title: switchable
          ? '当前正在等待发送；点击可切换为此模式'
          : '已经发送，不能切换发送模式',
        disabled: !switchable,
        allowCancel: false,
        action: 'send-message',
        buttonPhase: 'idle',
        forceDanger: false,
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
      const sendTaskForWaitingSend = sendMessageTask || selectAuthoritativeSendTaskSnapshot(snapshot);
      if (
        isPlainSendMessageTask(sendTaskForWaitingSend)
        && !(sendMessageTask && sendMessageTask.running === true)
      ) {
        logSendMessageButtonVisualDecide(sendTaskForWaitingSend, snapshot, capability, {
          reason: 'plain-send-stale-waiting-send-idle',
        });
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: authorityReplyBusy
            ? '助手正在回复，请等待完成后再发送'
            : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          runtimeAction: 'send-message',
          buttonPhase: 'idle',
          forceDanger: false,
        }, { reason: 'plain-send-stale-waiting-send-idle' });
      }

      const authorityCanSendFromSnapshot = !!(
        snapshot.canSend === true
        || snapshot.sendable === true
        || (
          snapshot.toolboxUnifiedAuthority
          && snapshot.toolboxUnifiedAuthority.flags
          && snapshot.toolboxUnifiedAuthority.flags.canSend === true
        )
      );
      if (authorityCanSendFromSnapshot && !isSendMessageOwner) {
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          runtimeAction: 'send-message',
          buttonPhase: 'idle',
        }, { reason: 'authority-can-send-while-stale-waiting-send-phase' });
      }

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

      let inferredPhase = 'waiting_send';
      if (!textLen && !hasAttachment) {
        if (authorityReplyBusy) {
          inferredPhase = 'waiting_reply';
        } else {
          inferredPhase = 'waiting_input';
        }
      } else if (hasAttachment && nativeReady) {
        inferredPhase = authorityReplyBusy ? 'clicking_send' : 'ready_to_click';
      } else if (hasAttachment && (!nativeReady || authorityReplyBusy)) {
        inferredPhase = 'waiting_attachment';
      } else if (authorityReplyBusy) {
        inferredPhase = 'waiting_reply';
      }

      return finish({
        phase: TaskPhase.WAITING_SEND,
        text: getSendMessageRunningTextByPhase(inferredPhase),
        title: SEND_MESSAGE_RUNNING_CANCEL_TITLE,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
      });
    }

    if (phase === TaskPhase.SENDING) {
      return finish({
        phase: TaskPhase.SENDING,
        text: getSendMessageRunningTextByPhase('sending'),
        title: SEND_MESSAGE_RUNNING_CANCEL_TITLE,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
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
      if (tryHealStaleWaitingReplyBeforeSendButtonView('send-button-text-decide-waiting-reply')) {
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          runtimeAction: 'send-message',
          buttonPhase: 'idle',
        });
      }
      const sendTaskForWaitingReply = sendMessageTask || selectAuthoritativeSendTaskSnapshot(snapshot);
      const plainSendStaleWaitingReply = isPlainSendMessageTask(sendTaskForWaitingReply)
        && !(sendMessageTask && sendMessageTask.running === true);
      if (plainSendStaleWaitingReply) {
        logSendMessageButtonVisualDecide(sendTaskForWaitingReply, snapshot, capability, {
          reason: 'plain-send-stale-waiting-reply-idle',
        });
        return finish({
          phase: TaskPhase.IDLE,
          text: '发送消息',
          title: authorityReplyBusy
            ? '助手正在回复，请等待完成后再发送'
            : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
          disabled: false,
          allowCancel: false,
          action: 'send-message',
          runtimeAction: 'send-message',
          buttonPhase: 'idle',
          forceDanger: false,
        }, { reason: 'plain-send-stale-waiting-reply-idle' });
      }
      const stopVisible = resolveStopVisibleFromAuthority(snapshot);
      return finish({
        phase: TaskPhase.WAITING_REPLY,
        text: getSendMessageRunningTextByPhase('waiting_reply'),
        title: stopVisible
          ? '消息已经发送，ChatGPT 正在回答；再次点击将取消本次发送流程或尝试停止回答'
          : '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消本次发送流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
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

    const sendLikePending = snapshot.sendLikePendingTask && typeof snapshot.sendLikePendingTask === 'object'
      ? snapshot.sendLikePendingTask
      : null;
    const sendMessagePendingAfterReply = pendingSendAfterReply
      && (!sendLikePending || sendLikePending.action === 'send-message');
    if (sendMessagePendingAfterReply) {
      const pendingPhase = sendLikePending && sendLikePending.phase
        ? String(sendLikePending.phase)
        : 'waiting_page_reply_to_send';
      const pendingText = sendLikePending && sendLikePending.text
        ? String(sendLikePending.text)
        : getSendMessageRunningTextByPhase(pendingPhase);
      return finish({
        phase: TaskPhase.WAITING_PAGE_REPLY_TO_SEND,
        text: pendingText,
        title: '页面正在回答，当前消息尚未发送；等待页面空闲后将自动发送；再次点击将取消本次发送流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
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

    const headerAuthority = getButtonAuthoritySnapshot('send-message-idle');
    const authorityCanSendNow = !!(
      (headerAuthority && headerAuthority.canSendByHeader)
      || snapshot.canSend === true
      || snapshot.sendable === true
      || (
        snapshot.toolboxUnifiedAuthority
        && snapshot.toolboxUnifiedAuthority.flags
        && snapshot.toolboxUnifiedAuthority.flags.canSend === true
      )
    );
    const canSend = authorityCanSendNow || hasComposer || pendingAttachmentWaitSend || !!failureHint || !!successHint;
    if ((!canSend || !hasComposer) && !authorityCanSendNow) {
      const hint = failureHint
        || (authorityReplyBusy ? '助手正在回复，暂不可发送' : '当前页面未检测到可用输入框或发送按钮')
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
        title: hint || '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        disabled: false,
        allowCancel: false,
        action: 'send-message',
        buttonPhase: 'idle',
      });
    }

    return finish({
      phase: TaskPhase.IDLE,
      text: '发送消息',
      title: authorityReplyBusy
        ? '助手正在回复，请等待完成后再发送'
        : '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
      disabled: false,
      allowCancel: false,
      action: 'send-message',
      buttonPhase: 'idle',
    });
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

  function isSendCopyHotkeyVisualOwner(snapshot = {}) {
    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const pending = snapshot.sendLikePendingTask && typeof snapshot.sendLikePendingTask === 'object'
      ? snapshot.sendLikePendingTask
      : null;
    const sendFamilyTask = getSendFamilyTaskFromSnapshot(snapshot);
    const taskPhase = String(task.phase || '').trim().toLowerCase();
    const taskOwnerButtonId = String(task.ownerButtonId || '').trim();
    const taskAction = String(task.action || task.mode || '').trim();
    const pendingAction = pending ? String(pending.action || '').trim() : '';
    const pendingPhase = pending ? String(pending.phase || '').trim().toLowerCase() : '';
    const sendFamilyAction = sendFamilyTask
      ? String(sendFamilyTask.action || sendFamilyTask.plan?.mode || sendFamilyTask.visualOwnerAction || '').trim()
      : '';
    const sendFamilyOwner = sendFamilyTask ? String(
      sendFamilyTask.ownerButtonId || sendFamilyTask.visualOwnerButtonId || '',
    ).trim() : '';
    const sendFamilyRunning = !!(sendFamilyTask && sendFamilyTask.running);
    const terminalPhases = new Set([
      'idle',
      'success',
      'failed',
      'cancelled',
      'canceled',
    ]);
    const sendFamilyPhase = String(sendFamilyTask.phase || '').trim().toLowerCase();
    const sendFamilyActuallyRunning = sendFamilyRunning && !terminalPhases.has(sendFamilyPhase);
    if (
      taskPhase === 'paused_background_throttled'
      && terminalPhases.has(sendFamilyPhase)
    ) {
      const line = `[SEND_COPY_HOTKEY_BUTTON][STALE_VISUAL_OWNER_SUPPRESS] taskPhase=${taskPhase || '-'} sendFamilyPhase=${sendFamilyPhase || '-'} reason=terminal-send-family`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.log(line);
      }
      return {
        owned: false,
        source: 'stale-paused-after-terminal-send',
        phase: 'idle',
      };
    }
    const visualOwnerAction = String(
      snapshot.visualOwnerAction
      || (sendFamilyTask && sendFamilyTask.visualOwnerAction)
      || '',
    ).trim();
    const visualOwnerButtonId = String(
      snapshot.visualOwnerButtonId
      || (sendFamilyTask && sendFamilyTask.visualOwnerButtonId)
      || '',
    ).trim();
    const activePhases = new Set([
      'preparing',
      'preparing_upload',
      'uploading_before_send',
      'waiting_input',
      'waiting_ready',
      'waiting_current_reply_done',
      'waiting_composer_ready',
      'auto_upload_before_send',
      'waiting_composer',
      'waiting_attachment',
      'waiting_send',
      'waiting_send_ready',
      'ready_to_click',
      'clicking_send',
      'native_send_clicked',
      'native_send_confirmed',
      'waiting_native_send',
      'waiting_reply',
      'sent_waiting_response',
      'waiting_response',
      'answering',
      'reply_done_waiting_copy',
      'copy_hotkey',
      'copy_hotkey_core',
      'copying',
      'hotkey_sending',
      'sending_hotkey',
      'running',
      'cancelling',
      'paused_background_throttled',
      'sending',
    ]);
    if (
      taskOwnerButtonId === 'cgpt-send-copy-hotkey-once'
      && activePhases.has(taskPhase)
    ) {
      return {
        owned: true,
        source: 'send-copy-hotkey-task',
        phase: taskPhase,
      };
    }
    if (
      taskAction === 'send-copy-hotkey'
      && activePhases.has(taskPhase)
    ) {
      return {
        owned: true,
        source: 'send-copy-hotkey-task-action',
        phase: taskPhase,
      };
    }
    if (
      pendingAction === 'send-copy-hotkey'
      && activePhases.has(pendingPhase)
    ) {
      return {
        owned: true,
        source: 'send-like-pending',
        phase: pendingPhase,
      };
    }
    if (
      sendFamilyActuallyRunning
      && (
        sendFamilyOwner === 'cgpt-send-copy-hotkey-once'
        || visualOwnerButtonId === 'cgpt-send-copy-hotkey-once'
      )
    ) {
      return {
        owned: true,
        source: 'send-family-owner-button',
        phase: String(
          taskPhase && activePhases.has(taskPhase)
            ? taskPhase
            : (sendFamilyTask.phase || 'running'),
        ).trim().toLowerCase() || 'running',
      };
    }
    if (
      sendFamilyActuallyRunning
      && (sendFamilyAction === 'send-copy-hotkey' || visualOwnerAction === 'send-copy-hotkey')
    ) {
      return {
        owned: true,
        source: visualOwnerAction === 'send-copy-hotkey' ? 'visual-owner-action' : 'send-family-action',
        phase: String(sendFamilyTask.phase || 'running').trim().toLowerCase() || 'running',
      };
    }
    if (
      visualOwnerButtonId === 'cgpt-send-copy-hotkey-once'
      && activePhases.has(taskPhase)
    ) {
      return {
        owned: true,
        source: 'snapshot-visual-owner-button',
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
    const hasRealComposerPayload = snapshot.hasRealComposerPayload === true
      || Number(composerTextLen || 0) > 0
      || Number(composerCount || 0) > 0
      || composerUploading === true;
    const hasLocalQueueFiles = snapshot.hasLocalQueueFiles === true
      || Number(localFileCount || 0) > 0;
    const sendCopyHotkeyMode = snapshot.sendCopyHotkeyMode
      || (hasRealComposerPayload ? 'send_then_copy_hotkey' : 'copy_hotkey_only');
    const canSendNow = !!(
      capability.can_send_now === true
      || capability.canSendNow === true
      || capability.send_decision === 'allowed'
      || capability.sendDecision === 'allowed'
      || snapshot.can_send_now === true
      || snapshot.canSendNow === true
      || snapshot.sendDecision === 'allowed'
      || capability.sendable === true
      || capability.sendable === 1
      || snapshot.sendable === true
      || snapshot.sendable === 1
    );
    const canAcceptInput = !!(
      capability.can_accept_input === true
      || capability.canAcceptInput === true
      || snapshot.can_accept_input === true
      || snapshot.canAcceptInput === true
      || capability.inputable === true
      || capability.inputable === 1
      || snapshot.inputable === true
      || snapshot.inputable === 1
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

  function finalizeSendCopyHotkeyButtonViewState(snapshot = {}, view = {}, capability = {}, extra = {}) {
    const visualOwner = isSendCopyHotkeyVisualOwner(snapshot);
    logSendCopyHotkeyVisualDecide(snapshot, visualOwner, view, capability, extra);
    return view;
  }

  function computeSendCopyHotkeyButtonViewState(snapshot = {}, options = {}) {
    void options;
    const topReplyStatus = getTopReplyStatusFromSnapshot(snapshot);
    const topReplyAnswering = isTopReplyAnsweringForButtons(snapshot);
    const topReplyWaiting = isTopReplyWaitingForButtons(snapshot);
    const topReplyBusy = isTopReplyBusyForButtons(snapshot);
    const sendCopyHotkeyLabel = getNormalButtonIdleLabel('send-copy-hotkey', SEND_COPY_HOTKEY_BUTTON_LABEL);
    const orchViews = snapshot.orchButtonViews && typeof snapshot.orchButtonViews === 'object'
      ? snapshot.orchButtonViews
      : {};
    const orchView = orchViews['cgpt-send-copy-hotkey-once'];
    if (orchView && orchView.source === 'gui-orch') {
      const orchPhase = String(orchView.phase || '').trim().toLowerCase();
      const orchActive = orchView.active === true;
      if (orchActive) {
        logSendButtonViewDecide(
          'cgpt-send-copy-hotkey-once',
          'send-copy-hotkey',
          snapshot,
          orchView,
          { flow: 'gui-orch' },
        );
        return {
          phase: orchPhase === 'failed' ? TaskPhase.FAILED : TaskPhase.RUNNING,
          text: sendCopyHotkeyLabel,
          title: String(orchView.title || orchView.text || sendCopyHotkeyLabel).trim(),
          disabled: !!orchView.disabled,
          allowCancel: orchView.allowCancel !== false,
          action: String(orchView.action || 'cancel-send-copy-hotkey').trim(),
          runtimeAction: String(orchView.runtimeAction || 'cancel-send-copy-hotkey').trim(),
          buttonPhase: String(orchView.buttonPhase || 'running').trim(),
          taskKey: 'send-copy-hotkey',
          ownerButtonId: 'cgpt-send-copy-hotkey-once',
        };
      }
      if (orchPhase === 'success' || orchPhase === 'failed' || orchPhase === 'cancelled') {
        const terminalView = {
          phase: orchPhase === 'failed' ? TaskPhase.FAILED : TaskPhase.IDLE,
          text: sendCopyHotkeyLabel,
          title: '',
          disabled: false,
          allowCancel: false,
          action: 'send-copy-hotkey',
          runtimeAction: '',
          buttonPhase: 'idle',
          taskKey: 'send-copy-hotkey',
          ownerButtonId: 'cgpt-send-copy-hotkey-once',
        };
        logSendButtonViewDecide(
          'cgpt-send-copy-hotkey-once',
          'send-copy-hotkey',
          snapshot,
          terminalView,
          { flow: 'gui-orch', terminal: true },
        );
        return terminalView;
      }
    }

    const capability =
      snapshot.capability
      || snapshot.composerCapability
      || snapshot.chatInputCapability
      || snapshot.bridgeCapability
      || snapshot.inputCapability
      || {};

    const responseState = String(
      capability.response_state
      || capability.responseState
      || snapshot.response_state
      || snapshot.responseState
      || snapshot.bridgeState?.response_state
      || snapshot.bridgeState?.responseState
      || '',
    ).trim();

    const responseReason = String(
      capability.response_state_reason
      || capability.responseReason
      || snapshot.response_state_reason
      || snapshot.responseReason
      || snapshot.bridgeState?.response_state_reason
      || snapshot.bridgeState?.responseReason
      || '',
    ).trim();

    const inputable =
      capability.inputable === true
      || capability.inputable === 1
      || snapshot.inputable === true
      || snapshot.inputable === 1;

    const sendable =
      capability.sendable === true
      || capability.sendable === 1
      || snapshot.sendable === true
      || snapshot.sendable === 1;

    const isGenerating =
      responseState === 'generating'
      || responseReason === 'assistant_busy';

    void inputable;
    void sendable;

    const visualOwner = isSendCopyHotkeyVisualOwner(snapshot);
    const sendFamilyTaskForMismatch = getSendFamilyTaskFromSnapshot(snapshot);
    if (
      sendFamilyTaskForMismatch
      && sendFamilyTaskForMismatch.running
      && String(sendFamilyTaskForMismatch.ownerButtonId || '').trim() === 'cgpt-send-copy-hotkey-once'
      && String(sendFamilyTaskForMismatch.action || sendFamilyTaskForMismatch.plan?.mode || '').trim() === 'send-message'
    ) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          '[SEND_COPY_HOTKEY_BUTTON][OWNER_ACTION_MISMATCH_RECOVER] currentAction=send-message ownerButtonId=cgpt-send-copy-hotkey-once action=recover-as-send-copy-hotkey',
        );
      }
    }
    if (visualOwner.owned) {
      const phase = visualOwner.phase || 'running';
      const isWaitingReplyView =
        phase === 'waiting_reply'
        || phase === 'sent_waiting_response'
        || phase === 'waiting_response'
        || phase === 'answering'
        || phase === 'native_send_confirmed';
      const ownerView = {
        phase: isWaitingReplyView ? TaskPhase.WAITING_REPLY : TaskPhase.RUNNING,
        text: sendCopyHotkeyLabel,
        title: '正在执行发送+复制+快捷键；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: 'cgpt-send-copy-hotkey-once',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, ownerView);
      return ownerView;
    }

    const sendLikePending = snapshot.sendLikePendingTask && typeof snapshot.sendLikePendingTask === 'object'
      ? snapshot.sendLikePendingTask
      : null;
    if (sendLikePending && sendLikePending.action === 'send-copy-hotkey') {
      const pendingPhase = String(sendLikePending.phase || 'waiting_reply').trim().toLowerCase();
      const pendingText = String(sendLikePending.text || '').trim()
        || getSendCopyHotkeyRunningTextByPhase(pendingPhase);
      let pendingTitle = '当前正在回答，完成后将自动发送并执行复制+快捷键；再次点击将取消后续流程';
      if (pendingPhase === 'waiting_input') {
        pendingTitle = '输入框有内容后将自动发送并执行复制+快捷键；再次点击将取消后续流程';
      } else if (pendingPhase === 'waiting_current_reply_done') {
        pendingTitle = '当前 ChatGPT 正在回答；回复结束后将自动发送输入框内容并执行复制+快捷键；再次点击将取消';
      } else if (pendingPhase === 'waiting_composer_ready') {
        pendingTitle = '等待输入框恢复可发送；就绪后将自动发送并执行复制+快捷键；再次点击将取消';
      }
      const ownerView = {
        phase: pendingPhase === 'waiting_input' ? TaskPhase.RUNNING : TaskPhase.WAITING_SEND,
        text: sendCopyHotkeyLabel,
        title: pendingTitle,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: 'cgpt-send-copy-hotkey-once',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, ownerView);
      return ownerView;
    }

    const sendFamilyTask = getSendFamilyTaskFromSnapshot(snapshot);
      if (sendFamilyTask && sendFamilyTask.running && isSendFamilyOwner(snapshot, 'send-copy-hotkey')) {
      const taskPhase = String(sendFamilyTask.phase || '').trim().toLowerCase();
      const isWaitingReplyView = taskPhase === 'sent_waiting_response'
        || taskPhase === 'waiting_reply'
        || taskPhase === 'answering'
        || taskPhase === 'stopping_response'
        || !!sendFamilyTask.hasClickedNativeSend;
      if (
        isWaitingReplyView
        && (taskPhase === 'waiting_reply' || taskPhase === 'sent_waiting_response' || taskPhase === 'answering')
        && (responseState === 'idle' || responseState === 'ready')
      ) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[SEND_COPY_HOTKEY][INVALID_STILL_WAITING_WHILE_IDLE] phase=${taskPhase} responseState=${responseState} owner=send-message-task`,
          );
        }
      }
      let taskText = getSendCopyHotkeyRunningTextByPhase(taskPhase);
      let taskTitle = SEND_COPY_HOTKEY_RUNNING_CANCEL_TITLE;
      if (taskPhase === 'copying') {
        taskTitle = '正在复制最后回复；再次点击将取消后续流程';
      } else if (taskPhase === 'hotkey_sending' || taskPhase === 'sending_hotkey') {
        taskTitle = '正在发送配置的快捷键；再次点击将取消后续流程';
      } else if (taskPhase === 'auto_upload_before_send' || taskPhase === 'uploading_before_send') {
        taskTitle = '检测到本地队列有文件，正在先上传附件；上传完成后将自动发送+复制+快捷键；再次点击将取消后续流程';
      } else if (taskPhase === 'preparing' || taskPhase === 'preparing_upload') {
        taskTitle = '正在准备发送+复制+快捷键；再次点击将取消后续流程';
      } else if (
        isWaitingReplyView
        && (taskPhase === 'waiting_reply' || taskPhase === 'sent_waiting_response' || taskPhase === 'answering')
      ) {
        taskTitle = '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消后续复制和快捷键';
      } else if (isWaitingReplyView) {
        taskTitle = '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消后续复制和快捷键';
      }
      const isAutoUploadPhase = taskPhase === 'auto_upload_before_send'
        || taskPhase === 'uploading_before_send'
        || taskPhase === 'preparing'
        || taskPhase === 'preparing_upload';
      const ownerView = {
        phase: isWaitingReplyView ? TaskPhase.WAITING_REPLY : TaskPhase.RUNNING,
        text: taskText,
        title: taskTitle,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: isWaitingReplyView ? 'waiting_reply' : (isAutoUploadPhase ? 'danger' : 'running'),
        forceDanger: isWaitingReplyView || isAutoUploadPhase,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: 'cgpt-send-copy-hotkey-once',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, ownerView);
      return ownerView;
    }
    if (
      sendFamilyTask
      && sendFamilyTask.running
      && !isSendFamilyOwner(snapshot, 'send-copy-hotkey')
      && !visualOwner.owned
    ) {
      const switchable = canSwitchSendFamilyAction(snapshot, 'send-copy-hotkey');
      const switchView = {
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: switchable
          ? '当前正在等待发送；点击可切换为此模式'
          : '已经发送，不能切换发送模式',
        disabled: !switchable,
        allowCancel: false,
        action: 'send-copy-hotkey',
        buttonPhase: 'idle',
        taskKey: 'send-copy-hotkey',
      };
      logSendButtonViewDecide('cgpt-send-copy-hotkey-once', 'send-copy-hotkey', snapshot, switchView);
      return switchView;
    }

    const task = snapshot.sendCopyHotkeyTask && typeof snapshot.sendCopyHotkeyTask === 'object'
      ? snapshot.sendCopyHotkeyTask
      : {};
    const sendMessageTask = snapshot.sendMessageTask && typeof snapshot.sendMessageTask === 'object'
      ? snapshot.sendMessageTask
      : {};
    const thisAction = 'send-copy-hotkey';
    const thisButtonId = 'cgpt-send-copy-hotkey-once';
    const currentAction = String(sendMessageTask.action || sendMessageTask.plan?.mode || '').trim();
    const currentOwner = String(sendMessageTask.ownerButtonId || '').trim();
    const sendRunning = isRealSendMessageTaskRunning(sendMessageTask, snapshot, 'getSendCopyHotkeyButtonViewState');
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const activePhases = new Set([
      'preparing',
      'preparing_upload',
      'uploading_before_send',
      'waiting_input',
      'waiting_ready',
      'waiting_current_reply_done',
      'waiting_composer_ready',
      'auto_upload_before_send',
      'waiting_composer',
      'waiting_attachment',
      'waiting_send',
      'waiting_send_ready',
      'waiting_ready',
      'ready_to_click',
      'clicking_send',
      'native_send_clicked',
      'waiting_reply',
      'sent_waiting_response',
      'answering',
      'reply_done_waiting_copy',
      'copying',
      'hotkey_sending',
      'sending_hotkey',
      'paused_background_throttled',
      'native_send_confirmed',
      'waiting_native_send',
      'sending',
      'waiting_response',
      'copy_hotkey',
      'running',
      'cancelling',
      TaskPhase.RUNNING,
      TaskPhase.WAITING_SEND,
      TaskPhase.WAITING_REPLY,
      TaskPhase.COPYING,
    ]);
    let phase = rawPhase;
    if (
      sendRunning
      && currentAction === thisAction
      && (currentOwner === thisButtonId || !currentOwner)
      && (phase === TaskPhase.IDLE || phase === 'idle')
    ) {
      const sendPhase = String(sendMessageTask.phase || '').trim().toLowerCase();
      if (sendPhase === 'waiting_composer') {
        phase = 'waiting_composer';
      } else if (sendPhase === 'waiting_attachment') {
        phase = 'waiting_attachment';
      } else if (sendPhase === 'ready_to_click') {
        phase = 'ready_to_click';
      } else if (sendPhase === 'clicking_send') {
        phase = 'clicking_send';
      } else if (sendPhase === 'sent_waiting_response') {
        phase = 'waiting_reply';
      } else if (sendPhase) {
        phase = sendPhase;
      }
    }
    const normalizedPhase = activePhases.has(phase)
      ? phase
      : normalizeTaskPhase(phase);
    const active = !!snapshot.sendCopyHotkeyActive
      || activePhases.has(normalizedPhase)
      || (
        sendRunning
        && currentAction === thisAction
        && (currentOwner === thisButtonId || !currentOwner)
        && activePhases.has(phase)
      );

    const pageGenerating = isAuthorityReplyBusyForButtons(snapshot);
    void responseState;
    void responseReason;
    const pendingSendPhases = new Set([
      'waiting_input',
      'auto_upload_before_send',
      'waiting_composer',
      'waiting_attachment',
      'waiting_send',
      'ready_to_click',
      'clicking_send',
      'writing_text',
    ]);
    if (
      sendRunning
      && currentAction === thisAction
      && (currentOwner === thisButtonId || !currentOwner)
      && pageGenerating
      && pendingSendPhases.has(phase)
    ) {
      const pageGenView = {
        phase: TaskPhase.WAITING_REPLY,
        text: getSendCopyHotkeyRunningTextByPhase('waiting_reply'),
        title: '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消后续复制和快捷键',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, pageGenView);
      return pageGenView;
    }

    if (phase === 'auto_upload_before_send' || phase === 'uploading_before_send') {
      const uploadView = {
        phase: TaskPhase.RUNNING,
        text: getSendCopyHotkeyRunningTextByPhase(phase),
        title: '检测到本地队列有文件，正在先上传附件；上传完成后会继续发送+复制+快捷键；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, uploadView);
      return uploadView;
    }

    if (phase === 'preparing' || phase === 'preparing_upload') {
      const prepareView = {
        phase: TaskPhase.RUNNING,
        text: getSendCopyHotkeyRunningTextByPhase(phase),
        title: '正在准备发送+复制+快捷键；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, prepareView);
      return prepareView;
    }

    if (phase === 'waiting_send_ready') {
      const pendingText = String(task.pendingText || '').trim()
        || getSendCopyHotkeyRunningTextByPhase(phase);
      const waitSendReadyView = {
        phase: TaskPhase.RUNNING,
        text: pendingText,
        title: '附件或发送按钮尚未就绪，就绪后将自动发送；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, waitSendReadyView);
      return waitSendReadyView;
    }

    if (phase === 'waiting_ready' || phase === 'waiting_input') {
      const pendingText = String(task.pendingText || '').trim()
        || getSendCopyHotkeyRunningTextByPhase(phase);
      const waitInputView = {
        phase: TaskPhase.RUNNING,
        text: pendingText || getSendCopyHotkeyRunningTextByPhase(phase),
        title: phase === 'waiting_input'
          ? '输入框有内容后将自动发送并执行复制+快捷键；再次点击将取消后续流程'
          : '正在等待 ChatGPT 完成当前回复，完成后将自动发送并执行复制+快捷键；再次点击将取消后续流程',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, waitInputView);
      return waitInputView;
    }

    if (phase === 'cancelling' || task.cancelRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: sendCopyHotkeyLabel,
        title: '正在取消发送+复制+快捷键',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
    }

    const isOwner = sendRunning
      && currentAction === thisAction
      && (currentOwner === thisButtonId || !currentOwner);
    if (
      isOwner
      && (
        phase === 'waiting_reply'
        || phase === 'sent_waiting_response'
        || phase === 'answering'
        || normalizedPhase === TaskPhase.WAITING_REPLY
      )
    ) {
      const waitReplyView = {
        phase: TaskPhase.WAITING_REPLY,
        text: getSendCopyHotkeyRunningTextByPhase(phase),
        title: '消息已经发送，正在等待 ChatGPT 回复完成；再次点击将取消后续复制和快捷键',
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, waitReplyView);
      return waitReplyView;
    }

    const terminalPhase = String(phase || '').trim().toLowerCase();
    if (terminalPhase === 'failed' || terminalPhase === TaskPhase.FAILED) {
      const lastError = String(task.lastError || '').trim();
      const failedView = {
        phase: TaskPhase.FAILED,
        text: sendCopyHotkeyLabel,
        title: lastError ? `发送+复制+快捷键失败：${lastError}` : '发送+复制+快捷键失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'failed',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, failedView, { terminal: 'failed' });
      return failedView;
    }
    if (terminalPhase === 'cancelled' || terminalPhase === 'canceled') {
      const cancelledView = {
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: '',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, cancelledView, { terminal: 'cancelled' });
      return cancelledView;
    }
    if (terminalPhase === 'success') {
      const successView = {
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: '',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, successView, { terminal: 'success' });
      return successView;
    }

    if (active) {
      let title = SEND_COPY_HOTKEY_RUNNING_CANCEL_TITLE;
      if (phase === 'copying' || normalizedPhase === TaskPhase.COPYING) {
        title = '正在复制最后回复；再次点击将取消后续流程';
      } else if (phase === 'hotkey_sending' || phase === 'sending_hotkey') {
        title = '正在发送配置的快捷键；再次点击将取消后续流程';
      } else if (phase === 'auto_upload_before_send') {
        title = '正在先上传本地队列文件；上传完成后将自动发送+复制+快捷键；再次点击将取消后续流程';
      } else if (String(task.lastError || task.pendingText || '').trim()) {
        title = String(task.lastError || task.pendingText || title).trim();
      }
      const activeView = {
        phase: normalizedPhase === TaskPhase.IDLE ? TaskPhase.RUNNING : normalizedPhase,
        text: getSendCopyHotkeyRunningTextByPhase(phase),
        title,
        disabled: false,
        allowCancel: true,
        action: 'cancel-send-copy-hotkey',
        runtimeAction: 'cancel',
        buttonPhase: 'danger',
        forceDanger: true,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, activeView);
      return activeView;
    }

    if (phase === TaskPhase.FAILED) {
      const lastError = String(task.lastError || '').trim();
      const failReason = String(task.reason || task.phaseReason || '').trim();
      const softBlocked = lastError.includes('正在回答')
        || lastError.includes('请先点击“开始上传”')
        || lastError.includes('输入框没有可发送内容')
        || failReason.includes('assistant-busy')
        || failReason.includes('input-not-ready')
        || failReason.includes('composer-not-ready')
        || failReason.includes('need-upload-first')
        || failReason.includes('empty-composer')
        || failReason.includes('send-not-ready');
      if (softBlocked) {
        if (
          failReason.includes('empty-composer')
          || failReason.includes('empty-composer-copy-hotkey-fallback')
          || lastError.includes('输入框没有可发送内容')
        ) {
          return {
            phase: TaskPhase.IDLE,
            text: sendCopyHotkeyLabel,
            title: '输入框为空；点击将直接执行复制+快捷键（不发送消息）',
            disabled: false,
            allowCancel: false,
            action: 'send-copy-hotkey',
            runtimeAction: '',
            buttonPhase: 'idle',
            taskKey: 'send-copy-hotkey',
          };
        }
        return {
          phase: TaskPhase.IDLE,
          text: sendCopyHotkeyLabel,
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
        text: sendCopyHotkeyLabel,
        title: task.lastError ? `发送+复制+快捷键失败：${task.lastError}` : '发送+复制+快捷键失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        buttonPhase: 'failed',
        taskKey: 'send-copy-hotkey',
      };
    }

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
    const hasRealComposerPayload =
      snapshot.hasRealComposerPayload === true
      || Number(composerTextLen || 0) > 0
      || Number(composerCount || 0) > 0
      || composerUploading === true;
    const hasLocalQueueFiles =
      snapshot.hasLocalQueueFiles === true
      || Number(localFileCount || 0) > 0;
    const sendCopyHotkeyMode =
      snapshot.sendCopyHotkeyMode
      || (hasRealComposerPayload ? 'send_then_copy_hotkey' : 'copy_hotkey_only');

    if ((topReplyAnswering || topReplyWaiting) && !active && !visualOwner.owned) {
      return finalizeSendCopyHotkeyButtonViewState(snapshot, decorateIdleViewWithTopReplyStatus({
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: `当前状态：${topReplyStatus.text || '等待回复'}；回复完成后再执行发送+复制+快捷键`,
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        forceDanger: false,
        taskKey: 'send-copy-hotkey',
        ownerButtonId: '',
      }, snapshot), capability, {
        reason: 'top-reply-status',
        topReplyText: topReplyStatus.text || '-',
      });
    }

    if (pageGenerating && !hasRealComposerPayload) {
      const waitGeneratingView = {
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: '当前正在回答且输入框为空；点击将走复制+快捷键（无输入内容不发送）',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, waitGeneratingView, {
        reason: 'page-generating-empty-composer',
      });
      return waitGeneratingView;
    }

    if (!hasRealComposerPayload && !pageGenerating) {
      const needInputView = {
        phase: TaskPhase.IDLE,
        text: sendCopyHotkeyLabel,
        title: '输入框为空；点击将直接执行复制+快捷键（不发送消息）',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        runtimeAction: '',
        buttonPhase: 'idle',
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, needInputView, {
        reason: 'empty-composer-idle',
        sendCopyHotkeyMode,
        hasRealComposerPayload,
        hasLocalQueueFiles,
      });
      return needInputView;
    }

    if (pageGenerating) {
      const pageGeneratingView = {
        phase: TaskPhase.WAITING_REPLY,
        text: sendCopyHotkeyLabel,
        title: '当前 ChatGPT 正在回答。输入框有内容时点击会排队等待当前回复完成后再发送；输入框为空时请使用“复制+快捷键”。',
        disabled: false,
        allowCancel: false,
        action: 'send-copy-hotkey',
        buttonPhase: 'waiting_reply',
        taskKey: 'send-copy-hotkey',
        ownerButtonId: thisButtonId,
      };
      logSendButtonViewDecide(thisButtonId, 'send-copy-hotkey', snapshot, pageGeneratingView, {
        reason: 'page-generating-idle-view',
      });
      return pageGeneratingView;
    }

    const idleView = {
      phase: TaskPhase.IDLE,
      text: sendCopyHotkeyLabel,
      title: '先发送当前输入框消息，等待回答完成后复制最后回复并触发目标快捷键',
      disabled: false,
      allowCancel: false,
      action: 'send-copy-hotkey',
      buttonPhase: 'idle',
      taskKey: 'send-copy-hotkey',
    };
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
      return !!(
        authority.replyBusy === true
        || authority.shouldWaitReplyByTopStatus === true
      );
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
    if (resolvedIdlePhase || resolvedIdleButtonPhase) {
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
      const skipSendCopyHotkeyIdleCleanup = isSendCopyHotkeyButton
        && sendCopyHotkeyVisualOwner.owned
        && String(resolvedView.phase || '').toLowerCase() === 'idle';
      if (skipSendCopyHotkeyIdleCleanup) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_CLASS_CLEANUP][SKIP_IDLE_CLEANUP_ACTIVE_SEND_COPY_HOTKEY] id=${button.id || '-'} source=${sendCopyHotkeyVisualOwner.source} phase=${sendCopyHotkeyVisualOwner.phase}`,
          );
        }
        button.classList.add('cgpt-btn-danger');
        button.classList.add('cgpt-action-running');
        button.classList.remove('cgpt-btn-idle');
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[BUTTON_VISUAL][FORCE_SEND_COPY_HOTKEY_RED] id=${button.id || '-'} phase=${sendCopyHotkeyVisualOwner.phase || resolvedView.phase || '-'} reason=forceDanger-owner`,
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
        }
      }
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
