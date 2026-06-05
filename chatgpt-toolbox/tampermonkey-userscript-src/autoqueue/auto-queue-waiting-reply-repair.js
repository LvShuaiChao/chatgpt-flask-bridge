  /********************************************************************
   * AutoQueueWaitingReplyRepair：waiting_reply 修复与 watchdog 恢复
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 stale waiting_reply、false waiting_reply、assistant busy 等修复逻辑。
   * 3. 不负责发送执行、不负责上传执行、不负责 replyState 收口、不负责任务推进校验。
   ********************************************************************/
  const AutoQueueWaitingReplyRepair = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const shouldBlockWatchdogRecoverBecauseAssistantBusy = deps.shouldBlockWatchdogRecoverBecauseAssistantBusy;
      const shouldPauseWaitingReplyForInvalidPageContext = deps.shouldPauseWaitingReplyForInvalidPageContext;
      const canAutoQueueWatchdogRecoverWaitingReply = deps.canAutoQueueWatchdogRecoverWaitingReply;
      const isAutoQueueWaitingReplyStepStale = deps.isAutoQueueWaitingReplyStepStale;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const trySettleWaitingReplyByReplyState = deps.trySettleWaitingReplyByReplyState;
      const getLatestAssistantReplyTextForBatchSafe = deps.getLatestAssistantReplyTextForBatchSafe;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const isAutoQueueFalseWaitingReplyState = deps.isAutoQueueFalseWaitingReplyState;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const appendLog = deps.appendLog;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const isNextTaskTransitionPhase = deps.isNextTaskTransitionPhase;
      const repairWaitingReplyState = deps.repairWaitingReplyState;
      const isBatchAssistantActuallyIdleForSettle = deps.isBatchAssistantActuallyIdleForSettle;
      const REPLY_COMPLETE_STABLE_MS = deps.REPLY_COMPLETE_STABLE_MS;
      const REPLY_COMPLETE_STABLE_MIN_COUNT = deps.REPLY_COMPLETE_STABLE_MIN_COUNT;
      const getAutoQueueBatchStepKey = deps.getAutoQueueBatchStepKey;
      const setTaskBatchStep = deps.setTaskBatchStep;
      const ensureBatchRunState = deps.ensureBatchRunState;
      const isExactBatchDoneSignalText = deps.isExactBatchDoneSignalText;
      const getTaskDoneSignalForAdvanceGuard = deps.getTaskDoneSignalForAdvanceGuard;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isAssistantSnapshotBelongsToCurrentTask = deps.isAssistantSnapshotBelongsToCurrentTask;
      const handleTaskDoneSignal = deps.handleTaskDoneSignal;
      const handleTaskReplyReady = deps.handleTaskReplyReady;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;
      const getAutoQueueConversationEvidence = deps.getAutoQueueConversationEvidence;
      const markTaskBatchStepRunning = deps.markTaskBatchStepRunning;
      const setAutoQueuePhase = deps.setAutoQueuePhase;
      const setBatchTaskGroupDisplayState = deps.setBatchTaskGroupDisplayState;
      const WAIT_REPLY_REPAIR_STEPS = deps.WAIT_REPLY_REPAIR_STEPS;
      const syncWaitingReplyFlagFromPhase = deps.syncWaitingReplyFlagFromPhase;
      const getAutoQueueBridgeConversationSnapshot = deps.getAutoQueueBridgeConversationSnapshot;
      const repairWaitingReplyStateOnce = deps.repairWaitingReplyStateOnce;
      const isCurrentRunFirstMessage = deps.isCurrentRunFirstMessage;
      function appendLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendLog === 'function') {
          appendLog(text);
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
      function shouldBlockWatchdogRecoverBecauseAssistantBusySafe(reason) {
        if (typeof shouldBlockWatchdogRecoverBecauseAssistantBusy === 'function') {
          return !!shouldBlockWatchdogRecoverBecauseAssistantBusy(reason);
        }
        return false;
      }
      function shouldPauseWaitingReplyForInvalidPageContextSafe(reason) {
        if (typeof shouldPauseWaitingReplyForInvalidPageContext === 'function') {
          return !!shouldPauseWaitingReplyForInvalidPageContext(reason);
        }
        return false;
      }
      function canAutoQueueWatchdogRecoverWaitingReplySafe() {
        if (typeof canAutoQueueWatchdogRecoverWaitingReply === 'function') {
          return !!canAutoQueueWatchdogRecoverWaitingReply();
        }
        return false;
      }
      function isAutoQueueWaitingReplyStepStaleSafe() {
        if (typeof isAutoQueueWaitingReplyStepStale === 'function') {
          return !!isAutoQueueWaitingReplyStepStale();
        }
        return false;
      }
      function getBatchReplyStableSnapshotSafe(source) {
        if (typeof getBatchReplyStableSnapshot === 'function') {
          return getBatchReplyStableSnapshot(source);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'getBatchReplyStableSnapshot',
          source,
        });
        return {
          text: '',
          stableMs: 0,
          count: 0,
        };
      }
      function trySettleWaitingReplyByReplyStateSafe(source) {
        if (typeof trySettleWaitingReplyByReplyState === 'function') {
          return !!trySettleWaitingReplyByReplyState(source);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'trySettleWaitingReplyByReplyState',
          source,
        });
        return false;
      }
      function getLatestAssistantReplyTextForBatchSafeSafe(source) {
        if (typeof getLatestAssistantReplyTextForBatchSafe === 'function') {
          return getLatestAssistantReplyTextForBatchSafe(source);
        }
        return '';
      }
      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'onAssistantReplySettled',
          textLength: String(text || '').length,
          reason: options && options.reason ? options.reason : '-',
        });
        return null;
      }
      function updateStatusSafe(reason) {
        if (typeof updateStatus === 'function') {
          updateStatus(reason);
          return;
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'updateStatus',
          reason,
        });
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
      function isAutoQueueFalseWaitingReplyStateSafe(reason) {
        if (typeof isAutoQueueFalseWaitingReplyState === 'function') {
          return !!isAutoQueueFalseWaitingReplyState(reason);
        }
        return false;
      }
      function isChatGPTActuallyBusyForTaskQueueSafe() {
        if (typeof isChatGPTActuallyBusyForTaskQueue === 'function') {
          return !!isChatGPTActuallyBusyForTaskQueue();
        }
        return false;
      }
      function tryScheduleTerminalBusyOverrideSafe(reason) {
        if (typeof tryScheduleTerminalBusyOverride === 'function') {
          return !!tryScheduleTerminalBusyOverride(reason);
        }
        return false;
      }
    async function maybeRepairStaleBatchWaitingReply(source) {
      if (state.batchWaitingReplyRepairRunning) {
        return false;
      }
      const authorityBusy = shouldBlockWatchdogRecoverBecauseAssistantBusySafe(`batch-wait-reply-repair:${source || '-'}`);
      if (authorityBusy) {
        appendLogSafe(
          `[BATCH_TASK_GROUP][WAIT_REPLY_REPAIR_SKIP_AUTHORITY_BUSY] source=${source || '-'} action=continue-wait`,
        );
        return false;
      }
      if (shouldPauseWaitingReplyForInvalidPageContextSafe(`stale-waiting-reply:${source || '-'}`)) {
        return true;
      }
      state.batchWaitingReplyRepairRunning = true;
      try {
        const runForUploadRepair = ensureTaskRunVerificationFields(state.taskRun || {});
        // 仅在下一任务切换阶段才允许上传修复；等待当前任务回复时禁止误触发上传等待。
        if (
          isNextTaskTransitionPhase(String(state.phase || ''))
          && repairWaitingReplyState(runForUploadRepair, source || 'next-task-upload-repair')
        ) {
          return true;
        }
        if (!isAutoQueueWaitingReplyStepStaleSafe()) {
          return false;
        }
        const reply = getBatchReplyStableSnapshotSafe(source);
        const idle = isBatchAssistantActuallyIdleForSettle(source, reply);
        if (!idle.idle) {
          if (idle.assistantBusy || idle.stopButton) {
            appendLogSafe(
              `[BATCH_FLOW][WAITING_REPLY_FORCE_SETTLE_BLOCKED_BUSY] source=${source || '-'} `
              + `assistantBusy=${idle.assistantBusy ? 1 : 0} `
              + `stopButton=${idle.stopButton ? 1 : 0} `
              + `stableMs=${reply && reply.stableMs ? reply.stableMs : 0} `
              + `count=${reply && reply.count ? reply.count : 0} `
              + `chars=${reply && reply.text ? reply.text.length : 0}`,
            );
          }
          if (tryScheduleTerminalBusyOverrideSafe(`stale-waiting-reply:${source || '-'}`)) {
            return true;
          }
          appendLogSafe(
            `[BATCH_FLOW][WAITING_REPLY_REPAIR_SKIP_BUSY] source=${source || '-'} `
            + `assistantBusy=${idle.assistantBusy ? 1 : 0} `
            + `stopButton=${idle.stopButton ? 1 : 0} `
            + `uploading=${idle.uploading ? 1 : 0} `
            + `stableMs=${reply && reply.stableMs ? reply.stableMs : 0} `
            + `count=${reply && reply.count ? reply.count : 0} `
            + `chars=${reply && reply.text ? reply.text.length : 0}`,
          );
          return false;
        }
        if (!reply.text) {
          if (shouldPauseWaitingReplyForInvalidPageContextSafe(`empty-reply:${source || '-'}`)) {
            return true;
          }
          appendLogSafe(
            `[BATCH_FLOW][WAITING_REPLY_REPAIR_SKIP_EMPTY] source=${source || '-'}`,
          );
          return false;
        }
        if (reply.stableMs < REPLY_COMPLETE_STABLE_MS || reply.count < REPLY_COMPLETE_STABLE_MIN_COUNT) {
          appendLogSafe(
            `[BATCH_FLOW][WAITING_REPLY_REPAIR_WAIT_STABLE] source=${source || '-'} `
            + `stableMs=${reply.stableMs} count=${reply.count} chars=${reply.text.length} `
            + `requiredMs=${REPLY_COMPLETE_STABLE_MS}`,
          );
          return false;
        }
        if (idle.assistantBusy || idle.stopButton) {
          appendLogSafe(
            `[BATCH_FLOW][WAITING_REPLY_FORCE_SETTLE_BLOCKED_BUSY] source=${source || '-'} `
            + `assistantBusy=${idle.assistantBusy ? 1 : 0} `
            + `stopButton=${idle.stopButton ? 1 : 0} `
            + `stableMs=${reply.stableMs} count=${reply.count} chars=${reply.text.length}`,
          );
          return false;
        }
        appendLogSafe(
          `[BATCH_FLOW][WAITING_REPLY_FORCE_SETTLE] source=${source || '-'} `
          + `reason=response-state-unknown-but-assistant-stable chars=${reply.text.length} stableMs=${reply.stableMs} count=${reply.count} `
          + `oldPhase=${state.phase || '-'} oldStep=${getAutoQueueBatchStepKey() || '-'}`,
        );
        appendLogSafe(
          `[BATCH_FLOW][WAITING_REPLY_REPAIR_FORCE_SETTLE] source=${source || '-'} `
          + `chars=${reply.text.length} stableMs=${reply.stableMs} count=${reply.count} `
          + `oldPhase=${state.phase || '-'} oldStep=${getAutoQueueBatchStepKey() || '-'}`,
        );
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.waitingStartedAt = 0;
        state.phase = 'running';
        const repairTask = getCurrentRunningTaskSafe();
        if (repairTask) {
          setTaskBatchStep('reply-ready', repairTask, { log: false });
        } else {
          state.step = 'reply-ready';
        }
        const brs = ensureBatchRunState();
        brs.waitingReply = false;
        state.batchRunState = brs;
        if (isExactBatchDoneSignalText(reply.text, getTaskDoneSignalForAdvanceGuard(getCurrentRunningTaskSafe()))) {
          const repairTask = getCurrentRunningTaskSafe();
          const repairProfile = getActiveTaskProfile();
          const repairResolved = repairTask
            ? resolveTaskContinueSettings(repairTask, repairProfile, { log: false })
            : null;
          const repairSnapshotObj = getLatestAssistantSnapshotForAutoQueueBoundary(
            `stale-waiting-reply:${source || '-'}`,
          );

          if (!isAssistantSnapshotBelongsToCurrentTask(repairSnapshotObj, `stale-waiting-reply:${source || '-'}`)) {
            appendLogSafe(
              `[BATCH_FLOW][STALE_REPLY_DONE_SIGNAL_REJECTED] source=${source || '-'} `
              + `task=${repairTask && repairTask.title ? repairTask.title : '-'}`,
            );
            return false;
          }

          appendLogSafe(
            `[BATCH_FLOW][STALE_REPLY_DONE_SIGNAL_REQUIRE_VERIFY] source=${source || '-'} task=${repairTask && repairTask.title ? repairTask.title : '-'}`,
          );

          if (repairTask) {
            await handleTaskDoneSignal(
              repairTask,
              repairProfile,
              repairResolved || {},
              reply.text,
              `stale-waiting-reply:${source || '-'}`,
            );
            return true;
          }
        }
        if (typeof handleTaskReplyReady === 'function') {
          await handleTaskReplyReady({
            source: `stale-waiting-reply:${source || '-'}`,
            replyText: reply.text,
            repaired: true,
          });
          return true;
        }
        appendLogSafe(
          `[BATCH_FLOW][WAITING_REPLY_REPAIR_NO_HANDLER] source=${source || '-'}`,
        );
        return false;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        appendLogSafe(`[BATCH_FLOW][WAITING_REPLY_REPAIR_ERROR] source=${source || '-'} error=${msg}`);
        console.error('[BATCH_FLOW][WAITING_REPLY_REPAIR_ERROR]', err);
        return false;
      } finally {
        state.batchWaitingReplyRepairRunning = false;
      }
    }

    function repairAutoQueueFalseWaitingReply(reason = 'autoq-false-waiting-reply') {
      if (config.promptMode === 'list') {
        return false;
      }
      if (!state.running) {
        return false;
      }
      const phase = String(state.phase || '');
      const looksWaiting = state.waitingReply === true || phase === AUTO_QUEUE_PHASES.WAITING_REPLY;
      if (!looksWaiting) {
        return false;
      }
      if (!isAutoQueueFalseWaitingReplyStateSafe()) {
        return false;
      }

      const run = state.taskRun || {};
      const task = getCurrentRunningTaskSafe();
      const payload = getAutoQueueComposerPayloadState(`false-waiting-reply:${reason}`);
      const conversation = getAutoQueueConversationEvidence();
      const composerAttachment = payload.readyCount > 0 || payload.hasAttachment ? 1 : 0;
      const pendingKind = String(run.pendingSendKind || '').trim() || 'initial';

      appendLogSafe(
        `[BATCH_TASK_GROUP][WAIT_REPLY_FALSE_POSITIVE] reason=composer-still-ready-to-send source=${reason}`,
      );
      if (String(reason || '').includes('watchdog')) {
        appendLogSafe(
          '[BATCH_TASK_GROUP][WATCHDOG_FALSE_WAIT_REPLY_REPAIR] action=send-existing-composer',
        );
      }

      state.waitingReply = false;
      state.sendingNow = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      markTaskBatchStepRunning(false);

      run.pendingSendKind = pendingKind;
      run.pendingSendStartedAt = Date.now();
      run.lastPendingSendKindBeforeProcessing = null;
      state.taskRun = run;

      setAutoQueuePhase(AUTO_QUEUE_PHASES.UPLOAD_ATTACHED, `false-waiting-reply:${reason}`, { force: true });
      setTaskBatchStep('send-wait-button', task, { log: false });
      setBatchTaskGroupDisplayState('running', 'wait-reply-false-positive-send-wait');
      state.nextSendAt = 0;

      appendLogSafe(
        `[AUTOQ][FALSE_WAITING_REPLY_REPAIR] reason=${reason} conversationId=${conversation.conversationId || '-'} `
        + `turnCount=${conversation.turnCount == null ? '-' : conversation.turnCount} latestRecords=${conversation.messageRecordCount} `
        + `composerAttachment=${composerAttachment} action=back-to-send-wait`,
      );

      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadgeSafe();
      }
      return true;
    }

    function repairFalseWaitingReplyWithComposerPayload(reason = 'autoq-false-waiting-reply') {
      return repairAutoQueueFalseWaitingReply(reason);
    }

    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.isChatGPTActuallyBusyForTaskQueue = isChatGPTActuallyBusyForTaskQueue;
      }
    } catch (exposeErr) {
      console.error('[AUTOQ][EXPOSE_BUSY_CHECK_FAILED]', exposeErr);
    }

    function repairWaitingReplyForAssistantBusy(reason) {
      if (config.promptMode !== 'task' || !state.running) {
        return false;
      }

      if (shouldPauseWaitingReplyForInvalidPageContextSafe(`repair-assistant-busy:${reason || '-'}`)) {
        return true;
      }

      if (!isChatGPTActuallyBusyForTaskQueueSafe()) {
        return false;
      }

      if (tryScheduleTerminalBusyOverrideSafe(`waiting-reply-repair:${reason || '-'}`)) {
        return true;
      }

      const task = getCurrentRunningTaskSafe();
      const run = state.taskRun;

      if (!task || !run) {
        return false;
      }

      if (isCurrentRunFirstMessage()) {
        appendLogSafe(
          `[AUTOQ][WAITING_REPLY_REPAIR_SKIP] reason=current-run-first-message task=${task.title || '-'}`,
        );
        return false;
      }

      const forceBackToWaiting = state.phase === AUTO_QUEUE_PHASES.REPLY_READY
        || String(state.phase || '') === 'running';
      const runStep = String(run.currentStep || '');

      if (!forceBackToWaiting && !WAIT_REPLY_REPAIR_STEPS.has(runStep)) {
        return false;
      }

      syncWaitingReplyFlagFromPhase('repair-assistant-busy-precheck');
      if (
        state.waitingReply
        && state.phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        && !forceBackToWaiting
      ) {
        return false;
      }

      const bridge = getAutoQueueBridgeConversationSnapshot();
      if (!(bridge.turnCount > 0 || bridge.messageRecordCount > 0)) {
        if (shouldPauseWaitingReplyForInvalidPageContextSafe(`no-conversation-evidence:${reason || '-'}`)) {
          return true;
        }
        appendLogSafe(
          `[AUTOQ][WAITING_REPLY_REPAIR_SKIP] reason=no-conversation-evidence-yet task=${task.title || '-'}`,
        );
        return false;
      }

      const repaired = repairWaitingReplyStateOnce(reason, 'repairWaitingReplyForAssistantBusy');
      if (repaired) {
        if (forceBackToWaiting) {
          appendLogSafe(
            `[AUTOQ][PHASE_REPAIR][REPLY_READY_TO_WAITING] task=${task.title} reason=assistant-still-busy force=1`,
          );
        }
        updateStatusSafe('waiting-reply-repair');
        updateChatInputStateBadgeSafe();
      }
      return repaired;
    }

      return Object.freeze({
        maybeRepairStaleBatchWaitingReply,
        repairAutoQueueFalseWaitingReply,
        repairFalseWaitingReplyWithComposerPayload,
        repairWaitingReplyForAssistantBusy,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueWaitingReplyRepair = AutoQueueWaitingReplyRepair;


