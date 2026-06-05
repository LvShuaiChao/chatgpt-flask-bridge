  /********************************************************************
   * AutoQueueDebugSnapshotSections：高级调试快照辅助分区采集
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 reply / terminal / quota / timer 调试分区。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责完整快照组装。
   ********************************************************************/
  const AutoQueueDebugSnapshotSections = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const DEFAULT_BATCH_DONE_SIGNAL = deps.DEFAULT_BATCH_DONE_SIGNAL;
      const DEFAULT_BATCH_BLOCKED_SIGNAL = deps.DEFAULT_BATCH_BLOCKED_SIGNAL;
      const DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL = deps.DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const getLastAssistantReplyTextSafe = deps.getLastAssistantReplyTextSafe;
      const isRawAssistantGeneratingSignals = deps.isRawAssistantGeneratingSignals;
      const classifyReplyState = deps.classifyReplyState;
      const classifyBatchReply = deps.classifyBatchReply;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const getReplyStateNextAction = deps.getReplyStateNextAction;
      const isExactSingleLineBatchSignalText = deps.isExactSingleLineBatchSignalText;
      const getPanelMessageQuotaState = deps.getPanelMessageQuotaState;
      const getPanelUploadQuotaState = deps.getPanelUploadQuotaState;
      const readPageTurnCount = deps.readPageTurnCount;
      const getBridgePageDisplayIdText = deps.getBridgePageDisplayIdText;
      const RuntimeStatsModuleRef = deps.RuntimeStatsModuleRef;

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DEBUG_SECTIONS][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        return requireFn(
          'ensureTaskRunVerificationFields',
          ensureTaskRunVerificationFields,
        )(run);
      }

      function getLastAssistantReplyTextSafeSafe() {
        return requireFn('getLastAssistantReplyTextSafe', getLastAssistantReplyTextSafe)();
      }

      function isRawAssistantGeneratingSignalsSafe() {
        return requireFn('isRawAssistantGeneratingSignals', isRawAssistantGeneratingSignals)();
      }

      function classifyReplyStateSafe(replyText, isGenerating) {
        if (typeof classifyReplyState !== 'function') {
          return null;
        }
        return classifyReplyState(replyText, isGenerating);
      }

      function classifyBatchReplySafe(replyText, options) {
        if (typeof classifyBatchReply !== 'function') {
          return null;
        }
        return classifyBatchReply(replyText, options);
      }

      function getBatchReplyStableSnapshotSafe(source) {
        return requireFn('getBatchReplyStableSnapshot', getBatchReplyStableSnapshot)(source);
      }

      function getReplyStateNextActionSafe(replyState, options) {
        return requireFn('getReplyStateNextAction', getReplyStateNextAction)(replyState, options);
      }

      function isExactSingleLineBatchSignalTextSafe(text, signal) {
        if (typeof isExactSingleLineBatchSignalText !== 'function') {
          return false;
        }
        return isExactSingleLineBatchSignalText(text, signal);
      }

      function getPanelMessageQuotaStateSafe(options) {
        return requireFn('getPanelMessageQuotaState', getPanelMessageQuotaState)(options);
      }

      function getPanelUploadQuotaStateSafe(options) {
        return requireFn('getPanelUploadQuotaState', getPanelUploadQuotaState)(options);
      }

      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount !== 'function') {
          return null;
        }
        return readPageTurnCount();
      }

      function getBridgePageDisplayIdTextSafe() {
        if (typeof getBridgePageDisplayIdText !== 'function') {
          return '';
        }
        return getBridgePageDisplayIdText();
      }

    function collectReplyDebugState(options = {}) {
      const full = options && options.full === true;
      const replyText = getLastAssistantReplyTextSafeSafe();
      const isGenerating = isRawAssistantGeneratingSignalsSafe();
      const replyState = typeof classifyReplyState === 'function'
        ? classifyReplyStateSafe(replyText, isGenerating)
        : null;
      const classify = full && typeof classifyBatchReply === 'function'
        ? classifyBatchReplySafe(replyText, { isGenerating })
        : null;
      const stableSnap = getBatchReplyStableSnapshotSafe('adv-debug-reply');
      const nextAction = replyState ? getReplyStateNextActionSafe(replyState, {
        waitingReply: !!state.waitingReply,
      }) : '';
      return {
        lastReplyLength: replyText.length,
        lastReplyPreview: replyText.slice(0, 160),
        isGenerating,
        stableMs: stableSnap.stableMs,
        stableCount: stableSnap.count,
        replyStateType: replyState ? replyState.type : '',
        replyStateReason: replyState ? replyState.reason : '',
        replyStateDone: replyState ? !!replyState.done : false,
        nextAction,
        classifyStatus: classify ? classify.status : (replyState ? replyState.type : ''),
        classifyReason: classify ? classify.reason : (replyState ? replyState.reason : ''),
        exactDoneSignal: full && typeof isExactSingleLineBatchSignalText === 'function'
          ? isExactSingleLineBatchSignalTextSafe(replyText, DEFAULT_BATCH_DONE_SIGNAL)
          : false,
        exactBlockedSignal: full && typeof isExactSingleLineBatchSignalText === 'function'
          ? isExactSingleLineBatchSignalTextSafe(replyText, DEFAULT_BATCH_BLOCKED_SIGNAL)
          : false,
        exactNoMoreContentSignal: full && typeof isExactSingleLineBatchSignalText === 'function'
          ? isExactSingleLineBatchSignalTextSafe(replyText, DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL)
          : false,
        normalReplyDoneWithoutTerminal: replyState
          ? replyState.type === 'normal_reply_done'
          : false,
      };
    }

    function collectTerminalDebugState() {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      return {
        terminalConfirmPending: !!state.terminalConfirming,
        terminalConfirmStartedAt: Number(state.terminalConfirmStartedAt || 0) || 0,
        terminalConfirmSource: state.terminalConfirmSource || '',
        terminalConfirmTaskIndex: state.terminalConfirmTaskIndex,
        terminalConfirmSignalType: state.terminalConfirmSignal || '',
        terminalConfirmPassed: !!state.terminalConfirmPassed,
        doneSignalVerificationRunning: !!run.doneSignalVerificationRunning,
        doneSignalVerificationStartedAt: Number(run.terminalVerificationStartedAt || run.verificationPromptSentAt || 0) || 0,
        doneSignalVerificationRound: Number(run.doneSignalVerificationSendCount || 0) || 0,
        lastTerminalSignalText: String(run.visibleDoneSignalText || state.terminalConfirmFirstText || '').slice(0, 120),
        afterTerminalConfirmWaitingVerify: !!run.afterTerminalConfirmWaitingVerify,
      };
    }

    function collectQuotaDebugState() {
      const messageQuota = getPanelMessageQuotaStateSafe({ logSnapshot: false });
      const uploadQuota = getPanelUploadQuotaStateSafe({ logSnapshot: false });
      const pageTurn = typeof readPageTurnCount === 'function' ? readPageTurnCountSafe() : null;
      return {
        pageId: typeof getBridgePageDisplayIdText === 'function'
          ? String(getBridgePageDisplayIdTextSafe() || '')
          : '',
        pageRoundCount: pageTurn == null ? 0 : Number(pageTurn) || 0,
        pageRoundLimit: 0,
        localUploadUsed: Number(uploadQuota.used || 0) || 0,
        localUploadLimit: Number(uploadQuota.limit || uploadQuota.maxFiles || 0) || 0,
        localEnhanceUsed: Number(messageQuota.used || 0) || 0,
        localEnhanceLimit: Number(messageQuota.limit || messageQuota.maxMessages || 0) || 0,
        pageError: String(state.phase || '') === AUTO_QUEUE_PHASES.FAILED,
        canSend: messageQuota.canSend !== false,
        canUpload: uploadQuota.canUpload !== false,
        quotaStatusText: [
          `消息 ${messageQuota.used}/${messageQuota.limit}`,
          `上传 ${uploadQuota.used}/${uploadQuota.limit}`,
        ].join(' | '),
      };
    }

    function collectTimerDebugState() {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const now = Date.now();
      const runtimeStats = typeof RuntimeStatsModuleRef !== 'undefined' && RuntimeStatsModuleRef.getStats
        ? RuntimeStatsModuleRef.getStats()
        : null;
      const batchStartedAt = runtimeStats && runtimeStats.batchStartedAt
        ? Number(runtimeStats.batchStartedAt) || 0
        : Number(state.startedAt || 0) || 0;
      const currentTaskStartedAt = runtimeStats && runtimeStats.currentTaskStartedAt
        ? Number(runtimeStats.currentTaskStartedAt) || 0
        : Number(run.taskPromptSentAt || 0) || 0;
      const lastSendAt = Number(run.taskPromptSentAt || run.pendingSendStartedAt || 0) || 0;
      const lastReplyAt = Number(run.terminalSignalConsumedAt || run.lastConsumedVerificationAt || 0) || 0;
      const nextActionAt = Number(state.nextSendAt || run.nextSendRetryAt || 0) || 0;

      return {
        now,
        batchStartedAt,
        currentTaskStartedAt,
        lastSendAt,
        lastReplyAt,
        nextActionAt,
        waitingStartedAt: Number(state.waitingStartedAt || 0) || 0,
        batchElapsedMs: batchStartedAt ? now - batchStartedAt : 0,
        currentTaskElapsedMs: currentTaskStartedAt ? now - currentTaskStartedAt : 0,
        waitReplyElapsedMs: lastSendAt && !lastReplyAt && state.waitingReply ? now - lastSendAt : 0,
      };
    }


      return Object.freeze({
        collectReplyDebugState,
        collectTerminalDebugState,
        collectQuotaDebugState,
        collectTimerDebugState,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDebugSnapshotSections = AutoQueueDebugSnapshotSections;


