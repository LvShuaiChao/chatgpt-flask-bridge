  /********************************************************************
   * AutoQueueState：自动任务运行状态读写
   ********************************************************************/

  const AutoQueueState = (() => {
    function createInitialState() {
      return {
        running: false,
        stopping: false,
        phase: 'idle',
        runId: '',
        currentTaskId: '',
        currentProfileId: '',
        currentIndex: -1,
        waitingReply: false,
        waitingReplyStartedAt: 0,
        lastError: '',
      };
    }

    function create(deps) {
      const { log } = deps;
      const state = createInitialState();

      function appendStateLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function setPhase(phase, reason) {
        const prev = state.phase;
        state.phase = String(phase || 'idle');
        appendStateLog(`[AUTO_QUEUE_STATE][PHASE] from=${prev || '-'} to=${state.phase} reason=${reason || '-'}`);
      }

      function startRun(runId, reason) {
        state.running = true;
        state.stopping = false;
        state.runId = String(runId || `autoq_${Date.now()}`);
        setPhase('running', reason || 'start-run');
        appendStateLog(`[AUTO_QUEUE_STATE][START] runId=${state.runId} reason=${reason || '-'}`);
      }

      function stopRun(reason) {
        state.stopping = true;
        appendStateLog(`[AUTO_QUEUE_STATE][STOP_REQUEST] runId=${state.runId || '-'} reason=${reason || '-'}`);
      }

      function finishRun(reason) {
        appendStateLog(`[AUTO_QUEUE_STATE][FINISH] runId=${state.runId || '-'} reason=${reason || '-'}`);
        state.running = false;
        state.stopping = false;
        state.waitingReply = false;
        setPhase('idle', reason || 'finish-run');
      }

      return {
        state,
        setPhase,
        startRun,
        stopRun,
        finishRun,
      };
    }

    return {
      create,
      createInitialState,
    };
  })();
