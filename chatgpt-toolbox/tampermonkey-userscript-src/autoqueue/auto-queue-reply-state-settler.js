  /********************************************************************
   * AutoQueueReplyStateSettler：回复状态评估与等待回复收口
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 replyState -> nextAction 评估，以及 waitingReply 的稳定收口。
   * 3. 不负责发送、不负责上传、不负责按钮渲染、不负责闭环等待倒计时。
   ********************************************************************/
  const AutoQueueReplyStateSettler = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const isAutoQueueWaitingReply = deps.isAutoQueueWaitingReply;
      const isChatGptHomePageNow = deps.isChatGptHomePageNow;
      const getCurrentConversationIdSafe = deps.getCurrentConversationIdSafe;
      const recordReplyClassifyDecision = deps.recordReplyClassifyDecision;
      const readPageTurnCount = deps.readPageTurnCount;
      const appendLog = deps.appendLog;
      const getLatestAssistantReplyTextForBatchSafe = deps.getLatestAssistantReplyTextForBatchSafe;
      const isRawAssistantGeneratingSignals = deps.isRawAssistantGeneratingSignals;
      const classifyReplyState = deps.classifyReplyState;
      const shouldPauseWaitingReplyForInvalidPageContext = deps.shouldPauseWaitingReplyForInvalidPageContext;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const validateAssistantReplyForRun = deps.validateAssistantReplyForRun;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
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
      function isAutoQueueWaitingReplySafe() {
        if (typeof isAutoQueueWaitingReply === 'function') {
          return isAutoQueueWaitingReply();
        }
        return !!(state && state.waitingReply);
      }
      function isChatGptHomePageNowSafe() {
        if (typeof isChatGptHomePageNow === 'function') {
          return isChatGptHomePageNow();
        }
        return false;
      }
      function getCurrentConversationIdSafeSafe() {
        if (typeof getCurrentConversationIdSafe === 'function') {
          return getCurrentConversationIdSafe();
        }
        return '';
      }
      function recordReplyClassifyDecisionSafe(payload) {
        if (typeof recordReplyClassifyDecision === 'function') {
          recordReplyClassifyDecision(payload);
          return;
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'recordReplyClassifyDecision',
          payload,
        });
      }
      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount === 'function') {
          return readPageTurnCount();
        }
        return null;
      }
      function getLatestAssistantReplyTextForBatchSafeSafe(source) {
        if (typeof getLatestAssistantReplyTextForBatchSafe === 'function') {
          return getLatestAssistantReplyTextForBatchSafe(source);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'getLatestAssistantReplyTextForBatchSafe',
          source,
        });
        return '';
      }
      function isRawAssistantGeneratingSignalsSafe() {
        if (typeof isRawAssistantGeneratingSignals === 'function') {
          return isRawAssistantGeneratingSignals();
        }
        return false;
      }
      function classifyReplyStateSafe(replyText, isGenerating) {
        if (typeof classifyReplyState === 'function') {
          return classifyReplyState(replyText, isGenerating);
        }
        return null;
      }
      function shouldPauseWaitingReplyForInvalidPageContextSafe(reason) {
        if (typeof shouldPauseWaitingReplyForInvalidPageContext === 'function') {
          return shouldPauseWaitingReplyForInvalidPageContext(reason);
        }
        appendLogSafe(
          '[AUTOQ_REPLY_STATE_SETTLER][PAUSE_CONTEXT_FALLBACK] reason=' + String(reason || '-'),
        );
        return false;
      }
      function getBatchReplyStableSnapshotSafe(source) {
        if (typeof getBatchReplyStableSnapshot === 'function') {
          return getBatchReplyStableSnapshot(source);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'getBatchReplyStableSnapshot',
          source,
        });
        return {
          text: '',
          stableMs: 0,
          count: 0,
        };
      }
      function validateAssistantReplyForRunSafe(runMeta, replyMeta) {
        if (typeof validateAssistantReplyForRun === 'function') {
          return validateAssistantReplyForRun(runMeta, replyMeta);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'validateAssistantReplyForRun',
        });
        return {
          ok: true,
          reason: 'validation-missing-fallback-ok',
        };
      }
      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
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
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'updateStatus',
          reason,
        });
      }
      function updateChatInputStateBadgeSafe() {
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
      }
    const NORMAL_REPLY_SETTLE_STABLE_MS = 800;
    const NORMAL_REPLY_SETTLE_MIN_COUNT = 2;

    function getReplyStateNextAction(replyState, options = {}) {
      const type = replyState && replyState.type ? String(replyState.type) : '';
      if (type === 'generating') {
        return 'continue-wait';
      }
      if (type === 'normal_reply_done') {
        return options.waitingReply ? 'send-next' : 'continue-current-task';
      }
      if (type === 'stop' || type === 'done' || type === 'blocked' || type === 'no_more_content') {
        return 'task-done-signal';
      }
      if (type === 'empty') {
        if (isAutoQueueWaitingReplySafe() && (isChatGptHomePageNowSafe() || !getCurrentConversationIdSafeSafe() || getCurrentConversationIdSafeSafe() === '-')) {
          return 'pause-lost-context';
        }
        return 'continue-wait';
      }
      return 'continue-wait';
    }

    function recordReplyClassifyFromReplyState(replyState) {
      if (!state.taskRun || !replyState) {
        return;
      }
      const type = String(replyState.type || '-');
      const shouldStop = type === 'stop' || type === 'done' || type === 'blocked' || type === 'no_more_content';
      recordReplyClassifyDecisionSafe({
        shouldStop,
        status: shouldStop ? 'stop' : type,
        reason: String(replyState.reason || '-'),
      });
    }

    function logReplyStateDecision(source, payload = {}) {
      const run = state.taskRun || {};
      const pageRound = typeof readPageTurnCount === 'function' ? readPageTurnCountSafe() : null;
      const taskIndex = Number(run.currentIndex || 0);
      const logPayload = {
        pageRound: pageRound == null ? '-' : pageRound,
        taskIndex: taskIndex + 1,
        replyLength: Number(payload.replyLength || 0),
        isGenerating: !!payload.isGenerating,
        detectedTerminal: payload.detectedTerminal || '-',
        stateType: payload.stateType || '-',
        reason: payload.reason || '-',
        nextAction: payload.nextAction || '-',
        source: source || '-',
      };
      console.log('[AUTOQ][REPLY_STATE]', logPayload);
      appendLogSafe(
        `[AUTOQ][REPLY_STATE] pageRound=${logPayload.pageRound} taskIndex=${logPayload.taskIndex} `
        + `replyLength=${logPayload.replyLength} isGenerating=${logPayload.isGenerating ? 1 : 0} `
        + `detectedTerminal=${logPayload.detectedTerminal} stateType=${logPayload.stateType} `
        + `reason=${logPayload.reason} nextAction=${logPayload.nextAction} source=${logPayload.source}`,
      );
    }

    function evaluateWaitingReplyState(source) {
      const replyText = getLatestAssistantReplyTextForBatchSafeSafe(source || 'waiting-reply-state');
      const isGenerating = isRawAssistantGeneratingSignalsSafe();
      if (typeof classifyReplyState !== 'function') {
        return {
          replyText,
          isGenerating,
          replyState: null,
          nextAction: isGenerating ? 'continue-wait' : 'send-next',
        };
      }
      const replyState = classifyReplyStateSafe(replyText, isGenerating);
      const detectedTerminal = replyState.type === 'stop'
        || replyState.type === 'done'
        || replyState.type === 'blocked'
        || replyState.type === 'no_more_content'
        ? (replyState.type === 'stop' ? 'stop' : replyState.type)
        : 'none';
      const nextAction = getReplyStateNextAction(replyState, { waitingReply: !!state.waitingReply });
      return {
        replyText,
        isGenerating,
        replyState,
        detectedTerminal,
        nextAction,
      };
    }

    function trySettleWaitingReplyByReplyState(source) {
      if (!state.waitingReply || config.promptMode !== 'task') {
        return false;
      }

      const evaluated = evaluateWaitingReplyState(source);
      const {
        replyText,
        isGenerating,
        replyState,
        detectedTerminal,
        nextAction,
      } = evaluated;

      if (!replyState) {
        return false;
      }

      if (nextAction === 'pause-lost-context') {
        shouldPauseWaitingReplyForInvalidPageContextSafe(`reply-state:${source || '-'}`);
        return true;
      }

      recordReplyClassifyFromReplyState(replyState);
      logReplyStateDecision(source, {
        replyLength: String(replyText || '').length,
        isGenerating,
        detectedTerminal,
        stateType: replyState.type,
        reason: replyState.reason,
        nextAction,
      });

      if (replyState.type === 'generating') {
        return false;
      }
      if (replyState.type === 'empty') {
        if (shouldPauseWaitingReplyForInvalidPageContextSafe(`empty-reply-settle:${source || '-'}`)) {
          return true;
        }
        return false;
      }

      const stableSnap = getBatchReplyStableSnapshotSafe(source || 'reply-state-settle');
      const mergedText = String(stableSnap.text || replyText || '').trim();
      if (!mergedText) {
        return false;
      }

      if (replyState.type === 'normal_reply_done') {
        if (isGenerating) {
          return false;
        }
        if (
          stableSnap.stableMs < NORMAL_REPLY_SETTLE_STABLE_MS
          || stableSnap.count < NORMAL_REPLY_SETTLE_MIN_COUNT
        ) {
          return false;
        }
      }

      const validation = validateAssistantReplyForRunSafe(
        { runId: state.currentRunId },
        {
          text: mergedText,
          isStreaming: false,
          parentMessageId: '',
        },
      );

      if (!validation.ok) {
        appendLogSafe(
          `[AUTOQ][REPLY_STATE][SETTLE_BLOCKED] source=${source || '-'} reason=${validation.reason || 'validation-failed'} `
          + `stateType=${replyState.type}`,
        );
        return false;
      }

      appendLogSafe(
        `[AUTOQ][REPLY_STATE][SETTLE] source=${source || '-'} stateType=${replyState.type} `
        + `reason=${replyState.reason} nextAction=${nextAction}`,
      );
      void onAssistantReplySettledSafe(mergedText, {
        reason: `reply-state-${replyState.reason}`,
        replyState,
      });
      updateStatusSafe('reply-state-settled');
      updateChatInputStateBadgeSafe();
      return true;
    }

      return Object.freeze({
        getReplyStateNextAction,
        recordReplyClassifyFromReplyState,
        logReplyStateDecision,
        evaluateWaitingReplyState,
        trySettleWaitingReplyByReplyState,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueReplyStateSettler = AutoQueueReplyStateSettler;


