  /********************************************************************
   * ButtonTasks：全局按鈕任務 phase 單一來源（window.CGPT_BUTTON_TASKS）
   ********************************************************************/

  const BUTTON_TASK_PHASES = Object.freeze([
    'idle',
    'uploading',
    'waiting_send',
    'waiting_ready',
    'sending',
    'waiting_reply',
    'copying',
    'running',
    'cancelling',
    'cancelled',
    'success',
    'failed',
    'completed',
  ]);

  const BUTTON_TASK_CANCELLABLE_PHASES = new Set([
    'uploading',
    'waiting_send',
    'waiting_ready',
    'sending',
    'waiting_reply',
    'copying',
    'running',
  ]);

  function createDefaultButtonTask(extra = {}) {
    return {
      phase: 'idle',
      runId: '',
      cancelRequested: false,
      stopRequested: false,
      abortController: null,
      lastError: null,
      ...extra,
    };
  }

  function ensureGlobalButtonTasks() {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!window.CGPT_BUTTON_TASKS || typeof window.CGPT_BUTTON_TASKS !== 'object') {
      window.CGPT_BUTTON_TASKS = {
        upload: createDefaultButtonTask(),
        send: createDefaultButtonTask(),
        copy: createDefaultButtonTask(),
        continue: createDefaultButtonTask(),
        batch: createDefaultButtonTask({
          currentIndex: -1,
          total: 0,
        }),
        prompt: createDefaultButtonTask({
          stopRequested: false,
        }),
      };
    }

    return window.CGPT_BUTTON_TASKS;
  }

  ensureGlobalButtonTasks();

  function getButtonTask(taskName) {
    const tasks = ensureGlobalButtonTasks();
    if (!tasks) {
      return null;
    }
    const key = String(taskName || '').trim();
    if (!key || !tasks[key]) {
      return null;
    }
    return tasks[key];
  }

  function createTaskRunId(prefix = 'task') {
    const p = String(prefix || 'task').trim() || 'task';
    return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function isCurrentTaskRun(taskName, runId) {
    const task = getButtonTask(taskName);
    if (!task) {
      return false;
    }
    const expected = String(runId || '').trim();
    if (!expected) {
      return false;
    }
    return String(task.runId || '') === expected;
  }

  function logButtonTaskChange(taskName, oldPhase, newPhase, reason, runId) {
    const line = `[BUTTON_STATE][CHANGE] task=${taskName} oldPhase=${oldPhase || '-'} newPhase=${newPhase || '-'} reason=${reason || '-'} runId=${runId || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function setTaskPhase(taskName, phase, reason = '', extra = {}) {
    const task = getButtonTask(taskName);
    if (!task) {
      return '';
    }

    const nextPhase = String(phase || 'idle').trim() || 'idle';
    const oldPhase = String(task.phase || 'idle');
    task.phase = nextPhase;

    if (extra.runId != null) {
      task.runId = String(extra.runId || '');
    }
    if (extra.cancelRequested != null) {
      task.cancelRequested = !!extra.cancelRequested;
    }
    if (extra.stopRequested != null) {
      task.stopRequested = !!extra.stopRequested;
    }
    if (extra.abortController !== undefined) {
      task.abortController = extra.abortController || null;
    }
    if (extra.lastError !== undefined) {
      task.lastError = extra.lastError;
    }
    if (extra.currentIndex != null) {
      task.currentIndex = Number(extra.currentIndex);
    }
    if (extra.total != null) {
      task.total = Number(extra.total);
    }

    if (oldPhase !== nextPhase) {
      logButtonTaskChange(taskName, oldPhase, nextPhase, reason, task.runId);
    }

    return nextPhase;
  }

  function resetTaskState(taskName, reason = '') {
    const task = getButtonTask(taskName);
    if (!task) {
      return;
    }

    const defaults = createDefaultButtonTask(
      taskName === 'batch'
        ? { currentIndex: -1, total: 0 }
        : {},
    );

    const oldPhase = String(task.phase || 'idle');
    Object.assign(task, defaults);
    logButtonTaskChange(taskName, oldPhase, 'idle', reason || 'reset', '');
  }

  function mirrorTaskSnapshot(taskName, snapshot = {}) {
    const task = getButtonTask(taskName);
    if (!task || !snapshot || typeof snapshot !== 'object') {
      return;
    }

    const keys = [
      'phase',
      'runId',
      'cancelRequested',
      'stopRequested',
      'abortController',
      'lastError',
      'currentIndex',
      'total',
    ];

    keys.forEach((key) => {
      if (snapshot[key] !== undefined) {
        task[key] = snapshot[key];
      }
    });
  }

  function logButtonTaskClick(action, taskName, phase, runId) {
    const line = `[BUTTON_STATE][CLICK] action=${action || '-'} task=${taskName || '-'} phase=${phase || '-'} runId=${runId || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function logButtonTaskCancel(taskName, reason, runId) {
    const line = `[BUTTON_STATE][CANCEL] task=${taskName || '-'} reason=${reason || '-'} runId=${runId || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function assertButtonStateConsistency(button, task, action = '') {
    if (!button || !task) {
      return;
    }

    const text = String(button.textContent || '');
    const phase = String(task.phase || 'idle');
    const disabled = !!button.disabled;

    if (BUTTON_TASK_CANCELLABLE_PHASES.has(phase) && disabled) {
      console.warn('[BUTTON_STATE][MISMATCH]', {
        action,
        reason: 'cancellable-button-disabled',
        phase,
        text,
        disabled,
      });
      return;
    }

    if ((text.includes('停止') || text.includes('取消')) && phase === 'idle') {
      console.warn('[BUTTON_STATE][MISMATCH]', {
        action,
        reason: 'text-says-cancel-but-task-idle',
        phase,
        text,
        disabled,
      });
      return;
    }

    if (
      (text.includes('开始') || text.includes('上传'))
      && BUTTON_TASK_CANCELLABLE_PHASES.has(phase)
      && !text.includes('取消')
      && !text.includes('停止')
    ) {
      console.warn('[BUTTON_STATE][MISMATCH]', {
        action,
        reason: 'task-running-but-text-not-cancellable',
        phase,
        text,
        disabled,
      });
      return;
    }

    const terminalPhases = new Set(['success', 'failed', 'cancelled', 'completed']);
    if (terminalPhases.has(phase) && !button.dataset.cgptRestoreScheduled) {
      console.warn('[BUTTON_STATE][MISMATCH]', {
        action,
        reason: 'terminal-phase-without-restore-marker',
        phase,
        text,
        disabled,
      });
    }
  }

  function renderAllButtonStates(reason = '') {
    const why = String(reason || 'renderAllButtonStates');

    if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderAllButtonStates === 'function') {
      UploadModule.renderAllButtonStates({ heavy: false, buttonTasksReason: why });
      return;
    }

    if (typeof UploadModule !== 'undefined') {
      if (typeof UploadModule.syncButtonTasksFromModuleState === 'function') {
        UploadModule.syncButtonTasksFromModuleState(why);
      }
      if (typeof UploadModule.renderUploadButtonsOnly === 'function') {
        UploadModule.renderUploadButtonsOnly({ heavy: false, buttonTasksReason: why });
      }
    }

    if (typeof AutoQueueModule !== 'undefined') {
      if (typeof AutoQueueModule.syncBatchButtonTask === 'function') {
        AutoQueueModule.syncBatchButtonTask(why);
      }
      if (typeof AutoQueueModule.renderBatchControlButtons === 'function') {
        AutoQueueModule.renderBatchControlButtons(why);
      } else if (typeof AutoQueueModule.renderQueueActionButtons === 'function') {
        AutoQueueModule.renderQueueActionButtons({ refreshReason: why });
      }
    }
  }

  const ButtonTasks = Object.freeze({
    Phases: BUTTON_TASK_PHASES,
    CancellablePhases: BUTTON_TASK_CANCELLABLE_PHASES,
    ensureGlobalButtonTasks,
    getButtonTask,
    createTaskRunId,
    isCurrentTaskRun,
    setTaskPhase,
    resetTaskState,
    mirrorTaskSnapshot,
    logButtonTaskClick,
    logButtonTaskCancel,
    assertButtonStateConsistency,
    renderAllButtonStates,
  });
