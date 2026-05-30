  /********************************************************************
   * AutoQueueRunner：自动任务运行流程（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueRunner = (() => {
    function create(deps) {
      const {
        stateStore,
        profileStore,
        replyWaiter,
        doneVerifier,
        sendFlow,
        renderStatus,
        log,
        legacyStart,
        legacyStop,
        legacyRunNextTask,
      } = deps;

      function appendRunnerLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function start(reason) {
        appendRunnerLog(`[AUTO_QUEUE_RUNNER][START] reason=${reason || '-'}`);
        if (typeof legacyStart === 'function') {
          return legacyStart(reason);
        }

        const runId = `autoq_${Date.now()}`;
        if (stateStore && typeof stateStore.startRun === 'function') {
          stateStore.startRun(runId, reason || 'manual-start');
        }
        if (typeof renderStatus === 'function') {
          renderStatus('autoq-runner:start');
        }
        return runNextTask('start');
      }

      async function runNextTask(reason) {
        if (typeof legacyRunNextTask === 'function') {
          return legacyRunNextTask(reason);
        }

        const state = stateStore && stateStore.state ? stateStore.state : {};
        if (state.stopping) {
          appendRunnerLog(`[AUTO_QUEUE_RUNNER][STOPPED_BEFORE_NEXT] runId=${state.runId || '-'} reason=${reason || '-'}`);
          if (stateStore && typeof stateStore.finishRun === 'function') {
            stateStore.finishRun('stopped-before-next');
          }
          if (typeof renderStatus === 'function') {
            renderStatus('autoq-runner:stopped');
          }
          return { ok: false, reason: 'stopped' };
        }

        const task = profileStore && typeof profileStore.getNextRunnableTask === 'function'
          ? profileStore.getNextRunnableTask()
          : null;
        if (!task) {
          appendRunnerLog(`[AUTO_QUEUE_RUNNER][NO_NEXT_TASK] runId=${state.runId || '-'}`);
          if (stateStore && typeof stateStore.finishRun === 'function') {
            stateStore.finishRun('no-next-task');
          }
          if (typeof renderStatus === 'function') {
            renderStatus('autoq-runner:no-next-task');
          }
          return { ok: true, done: true };
        }

        appendRunnerLog(
          `[AUTO_QUEUE_RUNNER][TASK_START] runId=${state.runId || '-'} taskId=${task.id || '-'} title=${task.title || '-'}`,
        );

        const sendResult = sendFlow && typeof sendFlow.sendTask === 'function'
          ? await sendFlow.sendTask(task, 'auto-queue')
          : null;
        if (!sendResult || sendResult.ok === false) {
          appendRunnerLog(
            `[AUTO_QUEUE_RUNNER][TASK_SEND_FAIL] taskId=${task.id || '-'} reason=${sendResult && sendResult.reason ? sendResult.reason : 'send_failed'}`,
          );
          if (typeof renderStatus === 'function') {
            renderStatus('autoq-runner:send-fail');
          }
          return { ok: false, reason: 'send_failed' };
        }

        const replyResult = replyWaiter && typeof replyWaiter.waitReply === 'function'
          ? await replyWaiter.waitReply(task, 'auto-queue')
          : null;
        if (!replyResult || replyResult.ok === false) {
          appendRunnerLog(
            `[AUTO_QUEUE_RUNNER][TASK_REPLY_FAIL] taskId=${task.id || '-'} reason=${replyResult && replyResult.reason ? replyResult.reason : 'reply_failed'}`,
          );
          if (typeof renderStatus === 'function') {
            renderStatus('autoq-runner:reply-fail');
          }
          return { ok: false, reason: 'reply_failed' };
        }

        const doneResult = doneVerifier && typeof doneVerifier.verify === 'function'
          ? await doneVerifier.verify(task, replyResult, 'auto-queue')
          : { done: false };
        appendRunnerLog(
          `[AUTO_QUEUE_DONE_VERIFIER][TASK_DONE_CHECK] taskId=${task.id || '-'} done=${doneResult && doneResult.done ? 1 : 0} reason=${doneResult && doneResult.reason ? doneResult.reason : '-'}`,
        );

        if (doneResult && doneResult.done) {
          if (profileStore && typeof profileStore.markTaskDone === 'function') {
            profileStore.markTaskDone(task.id);
          }
          if (typeof renderStatus === 'function') {
            renderStatus('autoq-runner:task-done');
          }
          return runNextTask('task-done');
        }

        if (typeof renderStatus === 'function') {
          renderStatus('autoq-runner:task-not-done');
        }
        return { ok: true, done: false };
      }

      function stop(reason) {
        appendRunnerLog(`[AUTO_QUEUE_RUNNER][STOP] reason=${reason || '-'}`);
        if (typeof legacyStop === 'function') {
          return legacyStop(reason);
        }
        if (stateStore && typeof stateStore.stopRun === 'function') {
          stateStore.stopRun(reason || 'manual-stop');
        }
        if (typeof renderStatus === 'function') {
          renderStatus('autoq-runner:stop-request');
        }
      }

      return {
        start,
        stop,
        runNextTask,
      };
    }

    return { create };
  })();
