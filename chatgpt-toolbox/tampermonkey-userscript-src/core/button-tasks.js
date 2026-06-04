  /********************************************************************
   * ButtonTasks：按钮任务镜像状态（window.CGPT_BUTTON_TASKS）
   *
   * 重要约束：
   * 1. ButtonTasks 不是业务流程的权威状态源。
   * 2. 上传/发送任务的权威状态来自 upload-module.js 内部 state.uploadTask / state.sendTask。
   * 3. ButtonTasks 只接收 mirrorTaskSnapshot 写入，用于 UI 展示、日志与调试。
   * 4. 不允许业务流程从 ButtonTasks 反向恢复、覆盖或推导 state.sendTask。
   * 5. 主 phase 只允许：
   *    idle / waiting_send / sending / waiting_reply / success / failed / cancelled
   * 6. UI 细分阶段必须写入 subPhase，不允许直接污染主 phase。
   ********************************************************************/

  const BUTTON_TASK_PHASES = Object.freeze([
    'idle',
    'waiting',
    'uploading',
    'waiting_send',
    'sending',
    'waiting_reply',
    'cancelling',
    'cancelled',
    'success',
    'failed',
  ]);

  const BUTTON_TASK_UI_PHASES = Object.freeze([
    ...BUTTON_TASK_PHASES,
    'initializing',
    'waiting_page_reply_to_send',
    'copying',
    'running',
    'continuing',
    'navigating',
    'quota_waiting',
    'startup_uploading',
    'checking',
    'waiting_input',
    'waiting_attachment',
    'completed',
    'danger',
    'disabled',
    'sending_hotkey',
    'sending_continue',
    'confirming_clipboard',
    'waiting_next_reply',
    'auto_uploading',
    'home_navigation',
    'stopped',
    'stopping',
    'pending_confirm',
  ]);

  const BUTTON_TASK_CANCELLABLE_PHASES = new Set([
    'waiting',
    'uploading',
    'waiting_send',
    'sending',
    'waiting_reply',
    'cancelling',
  ]);

  const BUTTON_TASK_PHASE_NORMALIZERS = Object.freeze({
    waiting_ready: { phase: 'waiting_send' },
    initializing: { phase: 'waiting', subPhase: 'initializing' },
    waiting_page_reply_to_send: { phase: 'waiting_send', subPhase: 'waiting_page_reply_to_send' },
    waiting_input: { phase: 'waiting_send', subPhase: 'waiting_input' },
    waiting_send_ready: { phase: 'waiting_send', subPhase: 'waiting_send_ready' },
    waiting_attachment: { phase: 'waiting_send', subPhase: 'waiting_attachment' },
    copying: { phase: 'waiting', subPhase: 'copying' },
    running: { phase: 'waiting', subPhase: 'running' },
    continuing: { phase: 'waiting', subPhase: 'continuing' },
    navigating: { phase: 'waiting', subPhase: 'navigating' },
    quota_waiting: { phase: 'waiting', subPhase: 'quota_waiting' },
    checking: { phase: 'waiting', subPhase: 'checking' },
    sending_hotkey: { phase: 'sending', subPhase: 'sending_hotkey' },
    sending_continue: { phase: 'sending', subPhase: 'sending_continue' },
    confirming_clipboard: { phase: 'waiting', subPhase: 'confirming_clipboard' },
    waiting_next_reply: { phase: 'waiting_reply', subPhase: 'waiting_next_reply' },
    auto_uploading: { phase: 'uploading', subPhase: 'auto_uploading' },
    startup_uploading: { phase: 'uploading', subPhase: 'startup_uploading' },
    home_navigation: { phase: 'waiting', subPhase: 'home_navigation' },
    stopped: { phase: 'cancelled', subPhase: 'stopped' },
    stopping: { phase: 'cancelling', subPhase: 'stopping' },
    pending_confirm: { phase: 'waiting', subPhase: 'pending_confirm' },
    completed: { phase: 'success', subPhase: 'completed' },
    danger: { phase: 'waiting', subPhase: 'danger' },
    disabled: { phase: 'idle', subPhase: 'disabled' },
  });

  function normalizeButtonTaskMainPhase(phase) {
    const value = String(phase || '').trim().toLowerCase();
    if (
      value === 'idle'
      || value === 'waiting_send'
      || value === 'sending'
      || value === 'waiting_reply'
      || value === 'success'
      || value === 'failed'
      || value === 'cancelled'
    ) {
      return value;
    }
    if (
      value === 'waiting'
      || value === 'waiting_input'
      || value === 'waiting_attachment'
      || value === 'waiting_page_reply_to_send'
      || value === 'ready_to_click'
    ) {
      return 'waiting_send';
    }
    if (
      value === 'copying'
      || value === 'running'
      || value === 'clicking_send'
      || value === 'writing_text'
      || value === 'sending_hotkey'
      || value === 'sending_continue'
      || value === 'confirming_clipboard'
    ) {
      return 'sending';
    }
    if (
      value === 'sent_waiting_response'
      || value === 'waiting_reply'
      || value === 'stopping_response'
    ) {
      return 'waiting_reply';
    }
    if (value === 'done' || value === 'completed') {
      return 'success';
    }
    if (value === 'error' || value === 'fail') {
      return 'failed';
    }
    if (value === 'cancel' || value === 'canceled') {
      return 'cancelled';
    }
    return 'idle';
  }

  function normalizeButtonTaskSubPhase(phase, subPhase) {
    const explicitSubPhase = String(subPhase || '').trim();
    if (explicitSubPhase) {
      return explicitSubPhase;
    }
    const rawPhase = String(phase || '').trim().toLowerCase();
    const normalizedMainPhase = normalizeButtonTaskMainPhase(rawPhase);
    if (rawPhase && rawPhase !== normalizedMainPhase) {
      return rawPhase;
    }
    return '';
  }

  function canonicalizeTaskPhaseInput(phase, subPhase = '') {
    const rawPhase = String(phase || 'idle').trim().toLowerCase() || 'idle';
    const rawSubPhase = String(subPhase || '').trim();
    if (BUTTON_TASK_PHASES.includes(rawPhase)) {
      return {
        phase: rawPhase,
        subPhase: rawSubPhase,
      };
    }
    const mapped = BUTTON_TASK_PHASE_NORMALIZERS[rawPhase];
    if (mapped) {
      return {
        phase: mapped.phase,
        subPhase: String(mapped.subPhase || '').trim() || rawSubPhase,
      };
    }
    return {
      phase: 'idle',
      subPhase: rawSubPhase || rawPhase,
    };
  }

  function createDefaultButtonTask(extra = {}) {
    return {
      phase: 'idle',
      subPhase: '',
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
        copyHotkeyOnce: createDefaultButtonTask(),
        copyHotkeyContinue: createDefaultButtonTask(),
        copyHotkeyContinueLoop: createDefaultButtonTask(),
        copyHotkeyUploadVerifyLoop: createDefaultButtonTask(),
        sendCopyHotkey: createDefaultButtonTask(),
        copyContinue: createDefaultButtonTask(),
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

    const canonical = canonicalizeTaskPhaseInput(
      phase,
      extra.subPhase != null ? extra.subPhase : extra.subphase,
    );
    const nextPhase = canonical.phase;
    const oldPhase = String(task.phase || 'idle');
    const oldSubPhase = String(task.subPhase || task.subphase || '').trim();
    task.phase = nextPhase;
    task.subPhase = canonical.subPhase;
    task.subphase = canonical.subPhase;

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
    if (extra.subphase != null || extra.subPhase != null) {
      task.subPhase = canonical.subPhase;
      task.subphase = canonical.subPhase;
    }

    if (oldPhase !== nextPhase || oldSubPhase !== canonical.subPhase) {
      const subphase = task.subPhase ? String(task.subPhase) : '';
      const subLog = subphase ? ` subphase=${subphase}` : '';
      logButtonTaskChange(taskName, oldPhase, `${nextPhase}${subLog}`, reason, task.runId);
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

  function mirrorTaskSnapshot(taskName, snapshot = {}, reason = '') {
    const task = getButtonTask(taskName);
    if (!task || !snapshot || typeof snapshot !== 'object') {
      return;
    }

    const keys = [
      'running',
      'action',
      'ownerButtonId',
      'reason',
      'error',
      'startedAt',
      'updatedAt',
      'finishedAt',
      'phase',
      'subPhase',
      'subphase',
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

    const rawPhase = String(snapshot.phase || task.phase || 'idle').trim().toLowerCase();
    const mainPhase = normalizeButtonTaskMainPhase(rawPhase);
    const subPhase = normalizeButtonTaskSubPhase(rawPhase, snapshot.subPhase || snapshot.subphase || task.subPhase);
    if (mainPhase === 'idle' && rawPhase && rawPhase !== 'idle') {
      console.warn('[BUTTON_TASKS][UNKNOWN_PHASE_NORMALIZED_TO_IDLE]', {
        rawPhase,
        subPhase,
        taskName,
        snapshot,
        reason,
      });
    }
    task.running = snapshot.running === true;
    task.phase = mainPhase;
    task.subPhase = subPhase;
    task.subphase = subPhase;
    task.updatedAt = snapshot.updatedAt || Date.now();
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
    UiPhases: BUTTON_TASK_UI_PHASES,
    AllPhases: BUTTON_TASK_UI_PHASES,
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
    canonicalizeTaskPhaseInput,
  });
