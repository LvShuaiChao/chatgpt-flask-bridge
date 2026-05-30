  /********************************************************************
   * AutoQueueReplyWaiter：等待 ChatGPT 回复（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueReplyWaiter = (() => {
    function create(deps) {
      const {
        log,
        legacyWaitAssistantReplyDone,
        legacyWaitReplyStable,
        legacyStartListModeWaitReplyTracking,
        legacySaveWaitingReplyContext,
        legacyRestoreWaitingReplyConversation,
        legacyDetectReplyGeneratingState,
      } = deps;

      function appendWaiterLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function waitReply(task, source) {
        const taskId = task && task.id ? task.id : '-';
        appendWaiterLog(`[AUTO_QUEUE_REPLY_WAITER][START] source=${source || '-'} taskId=${taskId}`);

        if (typeof legacyDetectReplyGeneratingState === 'function') {
          const generating = legacyDetectReplyGeneratingState(source);
          if (generating) {
            appendWaiterLog(`[AUTO_QUEUE_REPLY_WAITER][GENERATING] source=${source || '-'} taskId=${taskId}`);
          }
        }

        let result = null;
        if (typeof legacyWaitAssistantReplyDone === 'function') {
          result = await legacyWaitAssistantReplyDone(task, source);
        } else if (typeof legacyWaitReplyStable === 'function') {
          result = await legacyWaitReplyStable(task, source);
        }

        if (result && result.ok === false && result.reason === 'timeout') {
          appendWaiterLog(`[AUTO_QUEUE_REPLY_WAITER][TIMEOUT] source=${source || '-'} taskId=${taskId}`);
        } else if (result && result.ok !== false) {
          appendWaiterLog(`[AUTO_QUEUE_REPLY_WAITER][STABLE] source=${source || '-'} taskId=${taskId}`);
        }

        appendWaiterLog(`[AUTO_QUEUE_REPLY_WAITER][FINISH] source=${source || '-'} taskId=${taskId} ok=${result && result.ok !== false ? 1 : 0}`);
        return result || { ok: false, reason: 'waiter_missing' };
      }

      return {
        waitReply,
        startListModeWaitReplyTracking: legacyStartListModeWaitReplyTracking,
        saveWaitingReplyContext: legacySaveWaitingReplyContext,
        restoreWaitingReplyConversation: legacyRestoreWaitingReplyConversation,
      };
    }

    return { create };
  })();
