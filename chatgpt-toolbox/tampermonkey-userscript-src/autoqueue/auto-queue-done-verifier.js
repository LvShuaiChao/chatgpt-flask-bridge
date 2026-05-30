  /********************************************************************
   * AutoQueueDoneVerifier：任务完成与停止符判断（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueDoneVerifier = (() => {
    const BATCH_TASK_STOP_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>';

    function create(deps) {
      const {
        log,
        legacyIsTaskActuallyCompleted,
        legacyIsTaskFinishedForBatch,
        legacyBuildVerifyAfterDoneSignalPrompt,
        legacyStartStopSignalVerificationGate,
        legacyAnalyzeDoneSignal,
        legacyExtractTerminalSignal,
      } = deps;

      function appendVerifierLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function verify(task, replyResult, source) {
        const taskId = task && task.id ? task.id : '-';
        appendVerifierLog(`[AUTO_QUEUE_DONE_VERIFIER][CHECK] source=${source || '-'} taskId=${taskId}`);

        if (typeof legacyExtractTerminalSignal === 'function') {
          const signal = legacyExtractTerminalSignal(replyResult, task);
          if (signal === BATCH_TASK_STOP_SIGNAL) {
            appendVerifierLog(`[AUTO_QUEUE_DONE_VERIFIER][STOP_SIGNAL] source=${source || '-'} taskId=${taskId}`);
            return { done: true, reason: 'stop_signal' };
          }
        }

        if (typeof legacyIsTaskActuallyCompleted === 'function') {
          const done = legacyIsTaskActuallyCompleted(task, replyResult, source);
          appendVerifierLog(
            `[AUTO_QUEUE_DONE_VERIFIER][RESULT] source=${source || '-'} taskId=${taskId} done=${done ? 1 : 0}`,
          );
          if (done) {
            return { done: true, reason: 'task_completed' };
          }
        }

        if (typeof legacyIsTaskFinishedForBatch === 'function') {
          const batchDone = legacyIsTaskFinishedForBatch(task, replyResult, source);
          if (batchDone) {
            appendVerifierLog(`[AUTO_QUEUE_DONE_VERIFIER][RESULT] source=${source || '-'} taskId=${taskId} done=1 reason=batch`);
            return { done: true, reason: 'batch_finished' };
          }
        }

        appendVerifierLog(`[AUTO_QUEUE_DONE_VERIFIER][CONTINUE] source=${source || '-'} taskId=${taskId}`);
        return { done: false, reason: 'not_done' };
      }

      return {
        verify,
        BATCH_TASK_STOP_SIGNAL,
        buildVerifyAfterDoneSignalPrompt: legacyBuildVerifyAfterDoneSignalPrompt,
        startStopSignalVerificationGate: legacyStartStopSignalVerificationGate,
        analyzeDoneSignal: legacyAnalyzeDoneSignal,
        extractTerminalSignal: legacyExtractTerminalSignal,
      };
    }

    return { create };
  })();
