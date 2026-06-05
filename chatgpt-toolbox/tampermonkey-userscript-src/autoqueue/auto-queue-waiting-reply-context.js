  /********************************************************************
   * AutoQueueWaitingReplyContext：等待回复上下文与进入等待确认
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 负责 waiting_reply 上下文、发送提交确认、回复稳定快照、等待状态展示。
   * 3. 不负责发送执行、不负责上传执行、不负责终止符验证、不负责 watchdog repair。
   ********************************************************************/
  const AutoQueueWaitingReplyContext = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const appendAutoQueueLog = deps.appendAutoQueueLog;
      const saveConfig = deps.saveConfig;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const getAutoQueueConversationIdSafe = deps.getAutoQueueConversationIdSafe;
      const isChatGptHomeOrNewChatPage = deps.isChatGptHomeOrNewChatPage;
      const restoreConversationById = deps.restoreConversationById;
      const getAutoQueueBridgeConversationSnapshot = deps.getAutoQueueBridgeConversationSnapshot;
      const readPageTurnCount = deps.readPageTurnCount;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isBatchWaitReplyPageStillAnswering = deps.isBatchWaitReplyPageStillAnswering;
      const logBatchWaitReplyContinueThrottled = deps.logBatchWaitReplyContinueThrottled;
      const isAssistantBusy = deps.isAssistantBusy;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const getAutoQueueComposerAttachmentEvidence = deps.getAutoQueueComposerAttachmentEvidence;
      const isUploadInProgressForAutoQueue = deps.isUploadInProgressForAutoQueue;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;
      const formatBatchTaskGroupSourceTag = deps.formatBatchTaskGroupSourceTag;
      const clearRelentlessSendRetryState = deps.clearRelentlessSendRetryState;
      function appendAutoQueueLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendAutoQueueLog === 'function') {
          appendAutoQueueLog(text);
          return;
        }
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(text);
          return;
        }
        console.log(text);
      }
      function saveConfigSafe() {
        if (typeof saveConfig === 'function') {
          saveConfig();
        }
      }
      function updateStatusSafe(reason) {
        if (typeof updateStatus === 'function') {
          updateStatus(reason);
          return;
        }
        appendAutoQueueLogSafe('[AUTOQ_WAITING_REPLY_CONTEXT][DEPENDENCY_MISSING] name=updateStatus reason=' + String(reason || '-'));
      }
      function updateChatInputStateBadgeSafe() {
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
      }
      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }
      function getAutoQueueConversationIdSafeSafe() {
        if (typeof getAutoQueueConversationIdSafe === 'function') {
          return getAutoQueueConversationIdSafe();
        }
        return '';
      }
      function isChatGptHomeOrNewChatPageSafe(url, conversationId) {
        if (typeof isChatGptHomeOrNewChatPage === 'function') {
          return isChatGptHomeOrNewChatPage(url, conversationId);
        }
        return false;
      }
      function restoreConversationByIdSafe(conversationId, reason) {
        if (typeof restoreConversationById === 'function') {
          return restoreConversationById(conversationId, reason);
        }
        return false;
      }
      function getAutoQueueBridgeConversationSnapshotSafe() {
        if (typeof getAutoQueueBridgeConversationSnapshot === 'function') {
          return getAutoQueueBridgeConversationSnapshot();
        }
        return {
          conversationId: '',
          turnCount: 0,
          messageRecordCount: 0,
        };
      }
      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount === 'function') {
          return readPageTurnCount();
        }
        return null;
      }
      function getLatestAssistantSnapshotForAutoQueueBoundarySafe(source) {
        if (typeof getLatestAssistantSnapshotForAutoQueueBoundary === 'function') {
          return getLatestAssistantSnapshotForAutoQueueBoundary(source);
        }
        appendAutoQueueLogSafe(
          '[AUTOQ_WAITING_REPLY_CONTEXT][DEPENDENCY_MISSING] name=getLatestAssistantSnapshotForAutoQueueBoundary source='
          + String(source || '-'),
        );
        return {
          text: '',
          source: 'missing-dependency',
          messageId: '',
          conversationId: '',
        };
      }
      function isBatchWaitReplyPageStillAnsweringSafe(source) {
        if (typeof isBatchWaitReplyPageStillAnswering === 'function') {
          return isBatchWaitReplyPageStillAnswering(source);
        }
        return false;
      }
      function logBatchWaitReplyContinueThrottledSafe(source) {
        if (typeof logBatchWaitReplyContinueThrottled === 'function') {
          logBatchWaitReplyContinueThrottled(source);
        }
      }
      function isAssistantBusySafe() {
        if (typeof isAssistantBusy === 'function') {
          return !!isAssistantBusy();
        }
        if (typeof isChatGPTActuallyBusyForTaskQueue === 'function') {
          return !!isChatGPTActuallyBusyForTaskQueue();
        }
        return false;
      }
      function getAutoQueueComposerAttachmentEvidenceSafe(source) {
        if (typeof getAutoQueueComposerAttachmentEvidence === 'function') {
          return getAutoQueueComposerAttachmentEvidence(source);
        }
        return null;
      }
      function isUploadInProgressForAutoQueueSafe() {
        if (typeof isUploadInProgressForAutoQueue === 'function') {
          return !!isUploadInProgressForAutoQueue();
        }
        return false;
      }
      function getAutoQueueComposerPayloadStateSafe(source) {
        if (typeof getAutoQueueComposerPayloadState === 'function') {
          return getAutoQueueComposerPayloadState(source);
        }
        return null;
      }
      function formatBatchTaskGroupSourceTagSafe(source) {
        if (typeof formatBatchTaskGroupSourceTag === 'function') {
          return formatBatchTaskGroupSourceTag(source);
        }
        return String(source || '-');
      }
      function clearRelentlessSendRetryStateSafe(reason) {
        if (typeof clearRelentlessSendRetryState === 'function') {
          clearRelentlessSendRetryState(reason);
        }
      }
    function getCurrentAutoQueueRunSafe() {
      return state && state.taskRun ? state.taskRun : null;
    }

    function getAutoQueuePhaseSafe() {
      if (state && state.phase) {
        return String(state.phase || '');
      }
      const run = getCurrentAutoQueueRunSafe();
      if (run && run.phase) {
        return String(run.phase || '');
      }
      return '';
    }

    function isAutoQueueWaitingReply() {
      const run = getCurrentAutoQueueRunSafe();
      const phase = getAutoQueuePhaseSafe();
      const step = String((run && run.currentStep) || '');
      return (
        phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        || phase === 'waiting_reply'
        || state.waitingReply === true
        || step === 'wait-initial-reply'
        || step === 'wait-current-reply'
        || step === 'wait-continue-reply'
        || step === 'wait-next-reply'
        || step === 'wait-verification-reply'
      );
    }

    function isAutoQueueRunningNow() {
      const run = getCurrentAutoQueueRunSafe();
      const phase = getAutoQueuePhaseSafe();
      if (run && (run.running === true || run.status === 'running')) {
        return true;
      }
      return (
        phase === 'running'
        || phase === 'sending'
        || phase === 'upload_attached'
        || phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        || phase === 'waiting_reply'
        || phase === 'reply_ready'
        || phase === 'terminal_confirming'
        || state.running === true
        || state.batchTaskRunning === true
      );
    }

    function getCurrentConversationIdSafe() {
      const value = getAutoQueueConversationIdSafeSafe();
      const normalized = String(value || '').trim();
      return normalized || '-';
    }

    function isChatGptHomePageNow() {
      const conversationId = getCurrentConversationIdSafe();
      const url = typeof window !== 'undefined' ? String(window.location.href || '') : '';
      if (!conversationId || conversationId === '-') {
        return true;
      }
      if (
        url === 'https://chatgpt.com/'
        || url === 'https://chatgpt.com'
        || url.endsWith('chatgpt.com/')
      ) {
        return true;
      }
      if (typeof isChatGptHomeOrNewChatPage === 'function') {
        return isChatGptHomeOrNewChatPageSafe(url, conversationId);
      }
      return false;
    }

    function saveWaitingReplyContext(reason = '-') {
      const run = getCurrentAutoQueueRunSafe();
      if (!run) {
        appendAutoQueueLogSafe(`[AUTOQ][WAITING_REPLY_CONTEXT_SAVE_SKIP] reason=${reason} noRun=1`);
        return;
      }
      const task = getCurrentRunningTaskSafe();
      const conversationId = getCurrentConversationIdSafe();
      const pageUrl = typeof window !== 'undefined' ? String(window.location.href || '') : '';
      run.waitingReplyConversationId = conversationId || '-';
      run.waitingReplyConversationUrl = pageUrl;
      run.waitingReplyTaskId = task && task.id ? String(task.id) : String(run.currentTaskId || '-');
      run.waitingReplyTaskTitle = task && task.title ? String(task.title) : String(run.currentTaskTitle || '-');
      run.waitingReplyStartedAt = Date.now();
      state.taskRun = run;
      saveConfigSafe();
      appendAutoQueueLogSafe(
        `[AUTOQ][WAITING_REPLY_CONTEXT_SAVED] reason=${reason} `
        + `taskId=${run.waitingReplyTaskId || '-'} task=${run.waitingReplyTaskTitle || '-'} `
        + `conversationId=${run.waitingReplyConversationId || '-'} url=${run.waitingReplyConversationUrl || '-'}`,
      );
    }

    function detectWaitingReplyOnHomeMismatch(reason = '-') {
      const run = getCurrentAutoQueueRunSafe();
      if (!run) {
        return false;
      }
      const phase = getAutoQueuePhaseSafe();
      const step = String(run.currentStep || '');
      const conversationId = getCurrentConversationIdSafe();
      const url = typeof window !== 'undefined' ? String(window.location.href || '') : '';
      const waitingReply = isAutoQueueWaitingReply();
      const isHome = isChatGptHomePageNow();
      if (!waitingReply || !isHome) {
        return false;
      }
      appendAutoQueueLogSafe(
        `[AUTOQ][STATE_MISMATCH_WAITING_REPLY_ON_HOME] reason=${reason} phase=${phase || '-'} `
        + `step=${step || '-'} conversationId=${conversationId || '-'} url=${url || '-'} `
        + `savedConversationId=${run.waitingReplyConversationId || '-'} `
        + `savedUrl=${run.waitingReplyConversationUrl || '-'} `
        + `taskId=${run.waitingReplyTaskId || run.currentTaskId || '-'}`,
      );
      return true;
    }

    function pauseAutoQueueBecauseWaitingReplyContextLost(reason = '-') {
      const run = getCurrentAutoQueueRunSafe();
      if (!run) {
        return;
      }
      const oldPhase = getAutoQueuePhaseSafe();
      const oldStep = String(run.currentStep || '');
      run.currentStep = 'lost-conversation-during-wait-reply';
      run.lostConversationReason = reason;
      run.lostConversationAt = Date.now();
      state.taskRun = run;
      state.phase = 'paused';
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      if (state.batchTask) {
        state.batchTask.displayState = 'paused';
        state.batchTask.displayReason = 'lost-conversation-during-wait-reply';
      }
      appendAutoQueueLogSafe(
        `[AUTOQ][PAUSE_LOST_CONVERSATION] reason=${reason} oldPhase=${oldPhase || '-'} `
        + `oldStep=${oldStep || '-'} savedConversationId=${run.waitingReplyConversationId || '-'} `
        + `savedUrl=${run.waitingReplyConversationUrl || '-'}`,
      );
      saveConfigSafe();
      renderTaskList();
      renderTaskEditor();
      updateStatusSafe('lost-conversation-during-wait-reply');
    }

    function restoreWaitingReplyConversation(reason = '-') {
      const run = getCurrentAutoQueueRunSafe();
      if (!run || !run.waitingReplyConversationUrl) {
        appendAutoQueueLogSafe(
          `[AUTOQ][RESTORE_WAITING_REPLY_CONVERSATION_FAILED] reason=${reason} noSavedUrl=1`,
        );
        return false;
      }
      appendAutoQueueLogSafe(
        `[AUTOQ][RESTORE_WAITING_REPLY_CONVERSATION] reason=${reason} url=${run.waitingReplyConversationUrl}`,
      );
      window.location.href = run.waitingReplyConversationUrl;
      return true;
    }

    function shouldPauseWaitingReplyForInvalidPageContext(reason = '-') {
      if (!isAutoQueueWaitingReply()) {
        return false;
      }
      if (detectWaitingReplyOnHomeMismatch(reason)) {
        pauseAutoQueueBecauseWaitingReplyContextLost(`waiting-reply-on-home:${reason}`);
        return true;
      }
      const conversationId = getCurrentConversationIdSafe();
      const isHome = isChatGptHomePageNow();
      const bridge = getAutoQueueBridgeConversationSnapshotSafe();
      if (isHome) {
        appendAutoQueueLogSafe(
          `[AUTOQ][WAITING_REPLY_EMPTY_ON_HOME_BLOCKED] conversationId=${conversationId || '-'} `
          + `reason=${reason || '-'} turnCount=${bridge.turnCount} messageRecords=${bridge.messageRecordCount}`,
        );
        pauseAutoQueueBecauseWaitingReplyContextLost('waiting-reply-empty-on-home');
        return true;
      }
      if (
        (!conversationId || conversationId === '-')
        && Number(bridge.turnCount || 0) <= 0
        && Number(bridge.messageRecordCount || 0) <= 0
      ) {
        appendAutoQueueLogSafe(
          `[AUTOQ][WAITING_REPLY_INVALID_CONTEXT_BLOCKED] reason=${reason || '-'} `
          + `conversationId=${conversationId || '-'} turnCount=${bridge.turnCount} `
          + `messageRecords=${bridge.messageRecordCount}`,
        );
        pauseAutoQueueBecauseWaitingReplyContextLost('waiting-reply-invalid-context');
        return true;
      }
      return false;
    }

    function blockNavigationDuringWaitingReply(actionName, navOptions = {}) {
      const opts = navOptions && typeof navOptions === 'object' ? navOptions : {};
      if (opts.forceByUserStop || opts.afterTaskCompleted || opts.afterFailureSkip || opts.userConfirmed) {
        return false;
      }
      if (!isAutoQueueWaitingReply()) {
        return false;
      }
      appendAutoQueueLogSafe(
        `[AUTOQ][GO_HOME_BLOCKED_WAITING_REPLY] source=${actionName || '-'} `
        + `forceByUserStop=${opts.forceByUserStop ? 1 : 0} `
        + `afterTaskCompleted=${opts.afterTaskCompleted ? 1 : 0} `
        + `userConfirmed=${opts.userConfirmed ? 1 : 0}`,
      );
      updateStatusSafe('go-home-blocked-waiting-reply');
      return true;
    }

    function evaluateAutoQueueSendSuccessEvidence(options = {}) {
      const run = state.taskRun || {};
      const submitted = options.submitted && typeof options.submitted === 'object'
        ? options.submitted
        : null;
      const allowSyncFallback = options.allowSyncFallback === true;

      if (submitted && submitted.ok === true) {
        return {
          ok: true,
          reason: String(submitted.detailReason || submitted.reason || 'confirm-shared-message-submitted'),
        };
      }

      if (!allowSyncFallback) {
        return { ok: false, reason: 'confirm-shared-not-ok' };
      }

      const bridge = getAutoQueueBridgeConversationSnapshotSafe();
      const conversationId = String(bridge.conversationId || '').trim();
      const turnCount = Number(bridge.turnCount || 0);
      const messageRecordCount = Number(bridge.messageRecordCount || 0);
      const beforeConversationId = String(run.sendVerifyConversationIdBefore || '').trim();
      const beforeTurnCount = Number.isFinite(Number(run.sendVerifyTurnCountBefore))
        ? Number(run.sendVerifyTurnCountBefore)
        : null;

      if (conversationId && turnCount > 0) {
        return { ok: true, reason: 'conversation-id-and-turn-count' };
      }
      if (messageRecordCount > 0 && turnCount > 0) {
        return { ok: true, reason: 'conversation-messages-and-turn-count' };
      }
      if (
        beforeTurnCount != null
        && turnCount > Number(beforeTurnCount)
      ) {
        return { ok: true, reason: 'turn-count-increased' };
      }
      if (!beforeConversationId && conversationId && turnCount > 0) {
        return { ok: true, reason: 'conversation-established' };
      }

      const payload = getAutoQueueComposerPayloadStateSafe('send-success-evidence');
      const composerCleared = payload.textLen === 0 && payload.readyCount <= 0 && !payload.hasAttachment;
      if (composerCleared && messageRecordCount > 0) {
        return { ok: true, reason: 'composer-cleared-with-conversation-messages' };
      }

      const generating = bridge.responseState === 'generating'
        || bridge.responseState === 'streaming'
        || bridge.responseReason === 'assistant_busy';
      if (generating && turnCount >= 1) {
        return { ok: true, reason: 'assistant-generating-with-turn-count' };
      }

      if (payload.hasAttachment && payload.readyCount > 0 && payload.textLen > 0) {
        return { ok: false, reason: 'composer-attached-only-not-sent' };
      }

      return { ok: false, reason: 'no-send-conversation-evidence' };
    }

    function canEnterAutoQueueWaitingReply(options = {}) {
      return evaluateAutoQueueSendSuccessEvidence(options).ok === true;
    }

    async function confirmAutoQueueCanEnterWaitingReply(source, expectedText, task, sendKind, options = {}) {
      const submitted = await confirmAutoQueueMessageSubmittedForWaitingReply(
        source,
        expectedText,
        Object.assign({}, options, {
          sendKind: sendKind || options.sendKind || 'initial',
          timeoutMs: Math.max(1500, Number(options.timeoutMs) || 3000),
          taskTitle: task && task.title ? task.title : '',
        }),
      );
      if (submitted && submitted.ok === true) {
        return {
          ok: true,
          reason: submitted.reason || 'submitted-confirmed',
          submitted,
        };
      }
      return {
        ok: false,
        reason: submitted && submitted.reason ? submitted.reason : 'not-submitted',
        submitted,
      };
    }

    async function confirmAutoQueueMessageSubmittedForWaitingReply(source, prompt, options = {}) {
      const run = state.taskRun || {};
      if (
        typeof UploadModule === 'undefined'
        || !UploadModule
        || typeof UploadModule.confirmSharedMessageSubmitted !== 'function'
      ) {
        return {
          ok: false,
          reason: 'confirm-shared-unavailable',
        };
      }
      try {
        return await UploadModule.confirmSharedMessageSubmitted(source, prompt, {
          sendKind: options.sendKind || 'initial',
          timeoutMs: Math.max(1500, Number(options.timeoutMs) || 2000),
          turnCountBefore: run.sendVerifyTurnCountBefore,
          beforeTurnCount: run.sendVerifyTurnCountBefore,
          beforeConversationId: run.sendVerifyConversationIdBefore,
          conversationIdBefore: run.sendVerifyConversationIdBefore,
        });
      } catch (err) {
        console.error('[ChatGPT toolbox] confirmAutoQueueMessageSubmittedForWaitingReply failed', err);
        const errText = err && err.message ? err.message : String(err);
        ToolboxShell.appendLog(
          `[AUTOQ][CONFIRM_SHARED_SUBMITTED_FAILED] source=${source || '-'} error=${errText}`,
        );
        return {
          ok: false,
          reason: errText || 'confirm-shared-failed',
        };
      }
    }

    function blockAutoQueueWaitingReplyNotSubmitted(safeSendKind, task, taskTitle, confirmResult, extraReason = '') {
      const run = state.taskRun || {};
      const payload = getAutoQueueComposerPayloadStateSafe('enter-waiting-reply-blocked');
      const bridge = getAutoQueueBridgeConversationSnapshotSafe();
      const composerAttached = payload.readyCount > 0 || payload.hasAttachment ? 1 : 0;

      state.waitingReply = false;
      state.sendingNow = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;

      run.pendingSendKind = safeSendKind || run.pendingSendKind || 'initial';
      run.pendingSendStartedAt = Date.now();
      run.lastPendingSendKindBeforeProcessing = null;
      state.taskRun = run;

      setAutoQueuePhase(AUTO_QUEUE_PHASES.UPLOAD_ATTACHED, `send-not-submitted:${extraReason || '-'}`, { force: true });
      setTaskBatchStep('send-wait-button', task, { log: false });
      state.nextSendAt = 0;

      ToolboxShell.appendLog(
        `[AUTOQ][ENTER_WAITING_REPLY_BLOCKED_NOT_SUBMITTED] task=${taskTitle || '-'} kind=${safeSendKind || '-'} `
        + `reason=${(confirmResult && confirmResult.reason) || extraReason || 'confirm-not-ok'} `
        + `composerAttached=${composerAttached} conversationId=${bridge.conversationId || '-'} `
        + `turnCount=${bridge.turnCount} latestRecords=${bridge.messageRecordCount}`,
      );

      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadgeSafe();
      }

      return {
        ok: false,
        reason: (confirmResult && confirmResult.reason) || extraReason || 'send_not_verified_in_conversation',
        wait: true,
        retryable: true,
        wait_send: true,
      };
    }

    async function enterAutoQueueWaitingReplyAfterConfirm(options = {}) {
      const safeSendKind = String(options.sendKind || 'initial');
      const task = options.task || getCurrentRunningTaskSafe();
      const taskTitle = options.taskTitle || (task && task.title ? task.title : '-');
      const prompt = String(options.prompt || '').trim();
      const source = formatBatchTaskGroupSourceTagSafe(
        String(options.source || `autoq-task-${safeSendKind}`),
      );
      const logTag = String(options.logTag || '[AUTOQ][ENTER_WAITING_REPLY]');
      const run = state.taskRun || {};

      const sendConfirmed = options.submittedEvidence && typeof options.submittedEvidence === 'object'
        ? options.submittedEvidence
        : await confirmAutoQueueMessageSubmittedForWaitingReply(source, prompt, {
          sendKind: safeSendKind,
          timeoutMs: options.timeoutMs,
        });

      const sendEvidence = evaluateAutoQueueSendSuccessEvidence({ submitted: sendConfirmed });
      if (!sendEvidence.ok) {
        return blockAutoQueueWaitingReplyNotSubmitted(
          safeSendKind,
          task,
          taskTitle,
          sendConfirmed,
          sendEvidence.reason || 'confirm-not-ok',
        );
      }

      run.pendingSendKind = '';
      run.pendingSendStartedAt = 0;
      run.lastPendingSendKindBeforeProcessing = null;
      clearInitialSendSchedulingLock('enter-waiting-reply');
      state.taskRun = run;
      state.sendingNow = false;
      state.waitingReply = true;
      clearRelentlessSendRetryStateSafe();

      setAutoQueuePhase(
        AUTO_QUEUE_PHASES.WAITING_REPLY,
        `submitted-confirmed:${sendEvidence.reason || '-'}`,
        {
          force: true,
          submittedConfirmed: true,
          submittedEvidence: sendConfirmed,
        },
      );

      const waitStep = safeSendKind === 'verification'
        ? 'wait-verification-reply'
        : (safeSendKind === 'continue' ? 'wait-continue-reply' : 'wait-initial-reply');
      setTaskBatchStep(waitStep, task, { log: false });
      if (safeSendKind === 'initial') {
        markCurrentRunInitialSent('enter-waiting-reply');
      } else {
        syncBatchRunStateFromTask(task, 'enter-waiting-reply');
      }
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = Date.now();
      saveWaitingReplyContext('send-accepted-enter-waiting-reply');

      ToolboxShell.appendLog(
        `[AUTOQ][ENTER_WAITING_REPLY_AFTER_SHARED_SEND] task=${taskTitle} kind=${safeSendKind} `
        + `confirmedBy=${sendEvidence.reason || '-'} detail=${sendConfirmed && sendConfirmed.detailReason ? sendConfirmed.detailReason : '-'}`,
      );
      const confirmedRun = getCurrentAutoQueueRunSafe();
      ToolboxShell.appendLog(
        `[AUTOQ][ENTER_WAITING_REPLY_CONFIRMED] task=${taskTitle} kind=${safeSendKind} `
        + `taskId=${task && task.id ? task.id : '-'} phase=${getAutoQueuePhaseSafe() || '-'} `
        + `step=${confirmedRun && confirmedRun.currentStep ? confirmedRun.currentStep : '-'} `
        + `reason=${sendEvidence.reason || '-'} confirm=${sendConfirmed && sendConfirmed.detailReason ? sendConfirmed.detailReason : '-'}`,
      );
      ToolboxShell.appendLog(`${logTag} task=${taskTitle}`);
      ToolboxShell.appendLog('[AUTOQ][TASK][WAIT_REPLY]');

      notifyRuntimeTaskSendSuccess(task, safeSendKind || source);

      if (safeSendKind === 'initial' || safeSendKind === 'continue') {
        recordTaskBatchMessageSent(safeSendKind, {
          confirmed: true,
          submittedEvidence: sendConfirmed,
        });
      }

      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadgeSafe();
      }

      return {
        ok: true,
        waitReply: true,
        reason: sendEvidence.reason || 'waiting-reply-entered',
        submitted: sendConfirmed,
      };
    }

    function isAutoQueueFalseWaitingReplyState() {
      const phase = String(state.phase || '');
      const looksWaiting = state.waitingReply === true || phase === AUTO_QUEUE_PHASES.WAITING_REPLY;
      if (!looksWaiting) {
        return false;
      }
      if (canEnterAutoQueueWaitingReply()) {
        return false;
      }

      const conversation = getAutoQueueConversationEvidence();
      const payload = getAutoQueueComposerPayloadStateSafe('false-waiting-reply-check');
      const hasComposerPayload = payload.textLen > 0
        || payload.readyCount > 0
        || payload.hasAttachment;
      if (!hasComposerPayload) {
        return false;
      }

      const noConversationId = !conversation.conversationId;
      const noTurns = conversation.turnCount == null || Number(conversation.turnCount) <= 0;
      const noMessages = Number(conversation.messageRecordCount || 0) <= 0;
      return noConversationId && noTurns && noMessages;
    }

    function getAutoQueueWaitingReplyDisplayText(taskStepKey = '') {
      if (config.promptMode !== 'task') {
        return null;
      }
      const stepKey = String(taskStepKey || '').trim();
      if (
        stepKey === 'lost-conversation-during-wait-reply'
        || String(state.phase || '') === 'paused'
      ) {
        return '会话丢失，已暂停';
      }
      if (stepKey === 'prompt-ready') {
        return '指令已写入，等待发送';
      }
      if (isAutoQueueFalseWaitingReplyState()) {
        return '消息未发出，重新等待发送';
      }
      if (canEnterAutoQueueWaitingReply({ allowSyncFallback: true })) {
        return '等待回复';
      }
      const payload = getAutoQueueComposerPayloadStateSafe('ui-waiting-reply-display');
      if (payload.textLen > 0 && payload.attachmentCount > 0) {
        return '指令已写入，等待发送';
      }
      if (payload.readyCount > 0 || payload.hasAttachment || payload.textLen > 0) {
        return getBatchAttachmentReadyStatusText() || '附件已就绪，等待发送';
      }
      return '消息未发出，重新等待发送';
    }

    function canAutoQueueWatchdogRecoverWaitingReply() {
      if (!state.waitingReply) {
        return false;
      }
      if (isAutoQueueFalseWaitingReplyState()) {
        return false;
      }
      return canEnterAutoQueueWaitingReply({ allowSyncFallback: true });
    }

    function getAutoQueueBatchStepKey() {
      const run = state.taskRun || {};
      return String(run.currentStep || state.step || '').trim();
    }

    function isAutoQueueWaitingReplyStepStale() {
      const phase = String(state.phase || '').trim();
      const step = getAutoQueueBatchStepKey();
      return !!(
        state.running
        && phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        && (
          step === 'wait-current-reply'
          || step === 'wait-initial-reply'
          || step === 'wait-reply'
          || step === 'await-assistant'
        )
      );
    }

    function getLatestAssistantReplyTextForBatchSafe(source) {
      let text = '';
      const boundarySnapshot = getLatestAssistantSnapshotForAutoQueueBoundarySafe(source || 'batch-safe-reply');
      if (boundarySnapshot && boundarySnapshot.ok && boundarySnapshot.text) {
        text = String(boundarySnapshot.text || '').trim();
      }
      if (!text && typeof pickLatestAssistantFinalAnswer === 'function') {
        const picked = pickLatestAssistantFinalAnswer(source || 'batch-stale-waiting-reply');
        if (picked && picked.text) {
          text = String(picked.text || '').trim();
        } else if (typeof picked === 'string') {
          text = String(picked || '').trim();
        }
      }
      return text;
    }

    function getBatchReplyStableSnapshot(source) {
      const text = getLatestAssistantReplyTextForBatchSafe(source);
      const now = Date.now();
      if (!state.batchReplyStableSnapshot) {
        state.batchReplyStableSnapshot = {
          text: '',
          firstSeenAt: 0,
          lastSeenAt: 0,
          count: 0,
        };
      }
      const snap = state.batchReplyStableSnapshot;
      const pageStillAnswering = !text && isBatchWaitReplyPageStillAnsweringSafe(source);
      if (pageStillAnswering) {
        logBatchWaitReplyContinueThrottledSafe(source);
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][EMPTY_ASSISTANT_BUT_ANSWERING] action=continue-wait source=${source || '-'}`,
        );
        state.batchReplyStableSnapshot = snap;
        return {
          text: '',
          stableMs: 0,
          count: 0,
          waitingBecauseAnswering: true,
        };
      }
      if (text && text === snap.text) {
        snap.lastSeenAt = now;
        snap.count += 1;
      } else if (text) {
        snap.text = text;
        snap.firstSeenAt = now;
        snap.lastSeenAt = now;
        snap.count = 1;
      } else {
        snap.text = '';
        snap.firstSeenAt = 0;
        snap.lastSeenAt = 0;
        snap.count = 0;
      }
      state.batchReplyStableSnapshot = snap;
      return {
        text,
        stableMs: text ? now - Number(snap.firstSeenAt || now) : 0,
        count: snap.count,
        waitingBecauseAnswering: false,
      };
    }

    function isBatchAssistantActuallyIdleForSettle(source, replySnapshot) {
      if (replySnapshot && replySnapshot.waitingBecauseAnswering === true) {
        return {
          idle: false,
          assistantBusy: true,
          stopButton: true,
          uploading: false,
          stableMs: 0,
          stableCount: 0,
          replyChars: 0,
        };
      }
      const assistantBusy = typeof isAssistantBusy === 'function'
        ? !!isAssistantBusy()
        : isAssistantBusySafe();
      const stopButton = !!document.querySelector(
        '[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]',
      );
      const uploadEvidence = getAutoQueueComposerAttachmentEvidenceSafe(`stale-waiting-reply-check:${source || '-'}`);
      const uploading = !!(
        (typeof isUploadInProgressForAutoQueue === 'function' && isUploadInProgressForAutoQueueSafe())
        || (
          uploadEvidence
          && (
            uploadEvidence.uploading
            || uploadEvidence.nativeUploading
            || (Number(uploadEvidence.uploadingCount) || 0) > 0
          )
        )
      );

      const replyText = replySnapshot && replySnapshot.text
        ? String(replySnapshot.text || '').trim()
        : '';
      const stableMs = Number(replySnapshot && replySnapshot.stableMs || 0);
      const stableCount = Number(replySnapshot && replySnapshot.count || 0);

      return {
        idle: !assistantBusy && !stopButton && !uploading,
        assistantBusy,
        stopButton,
        uploading,
        stableMs,
        stableCount,
        replyChars: replyText.length,
      };
    }

      return Object.freeze({
        getCurrentAutoQueueRunSafe,
        getAutoQueuePhaseSafe,
        isAutoQueueWaitingReply,
        isAutoQueueRunningNow,
        getCurrentConversationIdSafe,
        isChatGptHomePageNow,
        saveWaitingReplyContext,
        detectWaitingReplyOnHomeMismatch,
        pauseAutoQueueBecauseWaitingReplyContextLost,
        restoreWaitingReplyConversation,
        shouldPauseWaitingReplyForInvalidPageContext,
        blockNavigationDuringWaitingReply,
        evaluateAutoQueueSendSuccessEvidence,
        canEnterAutoQueueWaitingReply,
        confirmAutoQueueCanEnterWaitingReply,
        confirmAutoQueueMessageSubmittedForWaitingReply,
        blockAutoQueueWaitingReplyNotSubmitted,
        enterAutoQueueWaitingReplyAfterConfirm,
        isAutoQueueFalseWaitingReplyState,
        getAutoQueueWaitingReplyDisplayText,
        canAutoQueueWatchdogRecoverWaitingReply,
        getAutoQueueBatchStepKey,
        isAutoQueueWaitingReplyStepStale,
        getLatestAssistantReplyTextForBatchSafe,
        getBatchReplyStableSnapshot,
        isBatchAssistantActuallyIdleForSettle,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueWaitingReplyContext = AutoQueueWaitingReplyContext;


