  /********************************************************************
   * AutoQueueBatchMainButtonVm：批量任务主按钮视图状态
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 cgpt-autoq-start 的 label、viewState、data-role、owner 同步。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责回复等待。
   ********************************************************************/
  const AutoQueueBatchMainButtonVm = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const hasCurrentRunStarted = deps.hasCurrentRunStarted;
      const shouldShowIdleState = deps.shouldShowIdleState;
      const shouldShowStoppedState = deps.shouldShowStoppedState;
      const isAutoQueueActuallyRunning = deps.isAutoQueueActuallyRunning;
      const getAutoQueueDisplayStateForPanel = deps.getAutoQueueDisplayStateForPanel;
      const appendLog = deps.appendLog;
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
      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }
      function hasCurrentRunStartedSafe() {
        if (typeof hasCurrentRunStarted === 'function') {
          return hasCurrentRunStarted();
        }
        return false;
      }
      function shouldShowIdleStateSafe() {
        if (typeof shouldShowIdleState === 'function') {
          return shouldShowIdleState();
        }
        return false;
      }
      function shouldShowStoppedStateSafe() {
        if (typeof shouldShowStoppedState === 'function') {
          return shouldShowStoppedState();
        }
        return false;
      }
      function isAutoQueueActuallyRunningSafe() {
        if (typeof isAutoQueueActuallyRunning === 'function') {
          return isAutoQueueActuallyRunning();
        }
        return false;
      }
      function getAutoQueueDisplayStateForPanelSafe(modeName = '-', runStateTextOverride = '') {
        if (typeof getAutoQueueDisplayStateForPanel === 'function') {
          return getAutoQueueDisplayStateForPanel(modeName, runStateTextOverride);
        }
        return {
          status: 'idle',
          statusText: '未开始',
          tone: 'muted',
        };
      }
      const ListModeRunnerRef = typeof globalThis !== 'undefined'
        ? globalThis.ListModeRunner
        : undefined;
    function isBatchTaskGroupOwnerMode() {
      return config.promptMode === 'list' || config.promptMode === 'task';
    }

    function buildBatchTaskGroupButtonStateInput() {
      const listRun = state.listModeRun && typeof state.listModeRun === 'object'
        ? state.listModeRun
        : {};
      const taskRun = state.taskRun && typeof state.taskRun === 'object'
        ? state.taskRun
        : {};
      const currentTask = config.promptMode === 'task' && typeof getCurrentRunningTask === 'function'
        ? getCurrentRunningTask()
        : null;
      const currentListTask = config.promptMode === 'list'
        && typeof ListModeRunnerRef !== 'undefined'
        && typeof ListModeRunnerRef.getCurrentListTask === 'function'
        ? ListModeRunnerRef.getCurrentListTask()
        : null;
      const listTask = currentListTask && typeof currentListTask === 'object' ? currentListTask : null;
      return {
        phase: state.phase,
        mode: config.promptMode,
        runMode: config.promptMode,
        step: listRun.step || taskRun.currentStep || taskRun.step || '',
        batchTaskRunning: state.batchTaskRunning === true,
        listModeRunning: state.listModeRunning === true,
        running: state.running === true,
        batchModeActive: state.batchModeActive === true,
        stopRequested: !!(state.batchTask && state.batchTask.stopRequested),
        cancelling: !!(state.batchTask && state.batchTask.forceStopRequested),
        hasRunBefore: hasCurrentRunStartedSafe() || shouldShowStoppedStateSafe(),
        initialSent: listTask
          ? (listTask.initialSent ? 1 : 0)
          : (currentTask && currentTask.initialSent ? 1 : 0),
      };
    }

    function isBatchTaskGroupRunning(stateInput = null) {
      if (!isBatchTaskGroupOwnerMode()) {
        return false;
      }

      const input = stateInput && typeof stateInput === 'object'
        ? stateInput
        : buildBatchTaskGroupButtonStateInput();
      const phase = String(input.phase || '').trim().toLowerCase();
      const mode = String(input.mode || input.runMode || config.promptMode || '').trim().toLowerCase();
      const step = String(input.step || '').trim().toLowerCase();
      const runningPhases = new Set([
        'starting',
        'running',
        'sending',
        'waiting-reply',
        'waiting_reply',
        'copying',
        'next-task',
        'retry-current-send',
        'uploading',
        'preparing',
        'sent',
        'reply_ready',
        'next_task_prepare',
        'next_task_navigate_home',
        'next_task_wait_home_ready',
        'next_task_uploading',
        'next_task_wait_upload_ready',
        'next_task_upload_attached',
        'next_task_sending',
      ]);
      const runningSteps = new Set([
        'list-running',
        'send-current-task',
        'waiting-reply',
        'retry-current-send',
        'next-task',
        'send-initial',
        'send-continue',
        'wait-reply',
        'check-done-signal',
        'verify-after-done-signal',
        'terminal-confirm-second-read',
        'new-chat-rotate',
        'task-running',
        'send-wait-button',
        'auto-upload-before-send',
      ]);

      const ownerActive = !!(
        input.batchTaskRunning
        || input.listModeRunning
        || input.batchModeActive
        || (
          input.running === true
          && (mode === 'list' || mode === 'batch' || mode === 'batch-task' || mode === 'task')
        )
      );

      return !!(
        input.batchTaskRunning
        || input.listModeRunning
        || (
          input.running === true
          && (mode === 'list' || mode === 'batch' || mode === 'batch-task' || mode === 'task')
        )
        || (ownerActive && runningPhases.has(phase))
        || (ownerActive && runningSteps.has(step))
        || (
          ownerActive
          && step === 'send-wait-button'
          && Number(input.initialSent || 0) === 0
          && input.batchModeActive === true
        )
      );
    }

    function isBatchTaskGroupStopping(stateInput = null) {
      const input = stateInput && typeof stateInput === 'object'
        ? stateInput
        : buildBatchTaskGroupButtonStateInput();
      const phase = String(input.phase || '').trim().toLowerCase();
      return !!(
        input.stopRequested
        || input.cancelling
        || phase === 'stopping'
        || phase === 'cancelling'
      );
    }

    const BATCH_TASK_MAIN_BUTTON_LABEL = '开始批量任务组';

    function getBatchTaskGroupButtonViewState(stateInput = null) {
      const input = stateInput && typeof stateInput === 'object'
        ? stateInput
        : buildBatchTaskGroupButtonStateInput();

      if (config.promptMode === 'list' && typeof ListModeRunnerRef !== 'undefined') {
        const listRunState = typeof ListModeRunnerRef.getAutoqListRunState === 'function'
          ? ListModeRunnerRef.getAutoqListRunState()
          : state.listRunState;
        if (listRunState && listRunState.stopRequested) {
          return {
            phase: 'cancelling',
            buttonPhase: 'cancelling',
            text: BATCH_TASK_MAIN_BUTTON_LABEL,
            title: '正在停止列表任务',
            disabled: true,
            action: 'none',
            allowCancel: false,
          };
        }
        if (listRunState && listRunState.running) {
          return {
            phase: 'running',
            buttonPhase: 'running',
            text: BATCH_TASK_MAIN_BUTTON_LABEL,
            title: '列表模式正在运行，点击停止',
            disabled: false,
            action: 'stop',
            allowCancel: true,
          };
        }
        const hasRunBefore = !!(listRunState && listRunState.completedAt > 0);
        return {
          phase: 'idle',
          buttonPhase: 'idle',
          text: hasRunBefore ? '重新开始批量任务组' : BATCH_TASK_MAIN_BUTTON_LABEL,
          title: '开始按列表顺序执行任务',
          disabled: false,
          action: 'start',
          allowCancel: false,
        };
      }

      if (isBatchTaskGroupStopping(input)) {
        return {
          phase: 'cancelling',
          buttonPhase: 'cancelling',
          text: BATCH_TASK_MAIN_BUTTON_LABEL,
          title: '正在停止批量任务组',
          disabled: true,
          action: 'none',
          allowCancel: false,
        };
      }

      if (isBatchTaskGroupRunning(input)) {
        return {
          phase: 'running',
          buttonPhase: 'running',
          text: BATCH_TASK_MAIN_BUTTON_LABEL,
          title: '批量任务组正在运行，点击停止',
          disabled: false,
          action: 'stop',
          allowCancel: true,
        };
      }

      return {
        phase: 'idle',
        buttonPhase: 'idle',
        text: input.hasRunBefore ? '重新开始批量任务组' : BATCH_TASK_MAIN_BUTTON_LABEL,
        title: '开始执行当前列表任务',
        disabled: false,
        action: 'start',
        allowCancel: false,
      };
    }

    function logBatchTaskGroupButtonState(btn, viewState, reason = '-') {
      const input = buildBatchTaskGroupButtonStateInput();
      appendLogSafe(
        '[BATCH_BUTTON][STATE] '
        + `id=${btn && btn.id ? btn.id : 'cgpt-autoq-start'} `
        + `text=${viewState && viewState.text ? viewState.text : '-'} `
        + `phase=${viewState && viewState.phase ? viewState.phase : '-'} `
        + `buttonPhase=${viewState && viewState.buttonPhase ? viewState.buttonPhase : '-'} `
        + `action=${viewState && viewState.action ? viewState.action : '-'} `
        + `batchTaskRunning=${input.batchTaskRunning ? 1 : 0} `
        + `listModeRunning=${input.listModeRunning ? 1 : 0} `
        + `owner=batch-task-group `
        + `reason=${String(reason || '-')}`,
      );
    }

    function applyBatchTaskGroupButtonViewState(btn, viewState, reason = '-') {
      if (!btn || !viewState || typeof setToolboxButtonState !== 'function') {
        return;
      }

      const buttonPhase = String(viewState.buttonPhase || viewState.phase || 'idle');
      const text = String(viewState.text || '');
      const title = String(viewState.title || text);
      const disabled = viewState.disabled === true;
      const allowCancel = viewState.allowCancel === true;
      const action = String(viewState.action || 'none');

      btn.dataset.cgptBatchAction = action;
      btn.dataset.cgptButtonPhase = buttonPhase;

      if (buttonPhase === 'idle') {
        setButtonIdle(btn, text, {
          title,
          disabled,
          reason,
        });
        btn.classList.remove('cgpt-btn-busy');
        btn.removeAttribute('aria-busy');
      } else if (buttonPhase === 'cancelling') {
        setButtonDanger(btn, text, {
          title,
          disabled: true,
          allowCancel: false,
          reason,
          ariaBusy: true,
        });
        btn.classList.add('cgpt-btn-busy');
      } else {
        setButtonDanger(btn, text, {
          title,
          disabled,
          allowCancel,
          reason,
          ariaBusy: true,
        });
        btn.classList.add('cgpt-btn-busy');
      }

      logBatchTaskGroupButtonState(btn, viewState, reason);
    }

    function getStartButtonTextByDisplayState(modeName = '-') {
      void modeName;
      if (isBatchTaskGroupOwnerMode()) {
        return getBatchTaskGroupButtonViewState().text;
      }
      const useBatchGroupLabel = false;
      if (shouldShowIdleStateSafe()) {
        return useBatchGroupLabel ? '开始批量任务组' : '开始';
      }
      if (isAutoQueueActuallyRunningSafe()) {
        return useBatchGroupLabel ? '停止批量任务组' : '停止继续';
      }
      if (shouldShowStoppedStateSafe()) {
        return useBatchGroupLabel ? '重新开始批量任务组' : '重新开始';
      }
      return useBatchGroupLabel ? '开始批量任务组' : '开始';
    }

    function isBatchTaskMainButton(btn) {
      if (!btn || config.promptMode !== 'task') {
        return false;
      }
      return !!(
        btn.id === 'cgpt-autoq-start'
        || btn.getAttribute('data-role') === 'batch-task-main-button'
        || btn.getAttribute('data-fixed-label-owner') === 'batch-task'
      );
    }

    function syncBatchTaskMainButtonOwnership() {
      const btn = root ? qs('#cgpt-autoq-start', root) : document.getElementById('cgpt-autoq-start');
      if (!btn) {
        return;
      }
      if (config.promptMode === 'task') {
        btn.setAttribute('data-role', 'batch-task-main-button');
        btn.setAttribute('data-fixed-label-owner', 'batch-task');
        if (
          typeof ButtonState !== 'undefined'
          && typeof ButtonState.markButtonStableLabel === 'function'
        ) {
          ButtonState.markButtonStableLabel(btn, BATCH_TASK_MAIN_BUTTON_LABEL);
        }
      } else {
        btn.removeAttribute('data-role');
        btn.removeAttribute('data-fixed-label-owner');
      }
    }

    function getBatchTaskMainButtonLabel() {
      if (isBatchTaskGroupOwnerMode()) {
        return getBatchTaskGroupButtonViewState().text;
      }
      return '开始批量任务组';
    }

    function updateBatchTaskMainButton(reason) {
      if (!isBatchTaskGroupOwnerMode()) {
        return;
      }

      syncBatchTaskMainButtonOwnership();

      const btn = document.getElementById('cgpt-autoq-start');

      if (!btn) {
        appendLogSafe(
          `[BATCH_BUTTON][MISS] id=cgpt-autoq-start reason=${String(reason || '-')}`,
        );
        return;
      }

      applyBatchTaskGroupButtonViewState(
        btn,
        getBatchTaskGroupButtonViewState(),
        reason || 'update-batch-task-main-button',
      );
      const batchInput = buildBatchTaskGroupButtonStateInput();
      if (isBatchTaskGroupRunning(batchInput)) {
        if (typeof window !== 'undefined') {
          const batchPhase = String(batchInput.phase || 'running').trim().toLowerCase() || 'running';
          window.__cgptToolboxRunningOwner = {
            owner: 'batch-task-group',
            action: 'batch-task-group',
            buttonId: 'cgpt-autoq-start',
            ownerButtonId: 'cgpt-autoq-start',
            phase: batchPhase,
            source: `autoqueue:${reason || 'update-batch-task-main-button'}`,
            startedAt: Date.now(),
          };
          appendLogSafe(
            `[BUTTON_OWNER][BATCH_PRIORITY_USED] owner=batch-task-group phase=${batchPhase} source=${window.__cgptToolboxRunningOwner.source}`,
          );
        }
      } else if (
        typeof window !== 'undefined'
        && window.__cgptToolboxRunningOwner
        && window.__cgptToolboxRunningOwner.owner === 'batch-task-group'
      ) {
        window.__cgptToolboxRunningOwner = null;
      }
      if (config.promptMode === 'task') {
        btn.setAttribute('data-role', 'batch-task-main-button');
        btn.setAttribute('data-fixed-label-owner', 'batch-task');
      }
    }

      return Object.freeze({
        isBatchTaskGroupOwnerMode,
        buildBatchTaskGroupButtonStateInput,
        isBatchTaskGroupRunning,
        isBatchTaskGroupStopping,
        getBatchTaskGroupButtonViewState,
        logBatchTaskGroupButtonState,
        applyBatchTaskGroupButtonViewState,
        getStartButtonTextByDisplayState,
        isBatchTaskMainButton,
        syncBatchTaskMainButtonOwnership,
        getBatchTaskMainButtonLabel,
        updateBatchTaskMainButton,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueBatchMainButtonVm = AutoQueueBatchMainButtonVm;


