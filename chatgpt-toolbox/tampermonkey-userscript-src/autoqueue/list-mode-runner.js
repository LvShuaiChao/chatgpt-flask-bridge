(function initListModeRunnerModule() {
  const AutoqTaskRuntimeStatus = {
    PENDING: 'pending',
    SENDING: 'sending',
    WAITING_REPLY: 'waiting-reply',
    DONE: 'done',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    DELETED: 'deleted',
  };

  const LIST_SEND_RETRY_DELAYS_MS = [1500, 3000, 5000];
  const DEFAULT_MAX_SEND_RETRY = 3;

  const LIST_RUN_ACTIVE_STATUSES = [
    'preparing',
    'sending',
    'waiting_reply',
    'reply_ready',
    'delay_next',
  ];

  const autoqListRunStateFallback = {
    status: 'idle',
    running: false,
    mode: 'list',
    runId: '',
    activeListId: '',
    currentTaskIndex: -1,
    currentTaskId: '',
    runQueue: [],
    sendingNow: false,
    waitingReply: false,
    stopRequested: false,
    startedAt: 0,
    updatedAt: 0,
    completedAt: 0,
    lastFailureReason: '',
    lastFailureDetail: '',
    liveSyncEnabled: true,
    lockQueueOnStart: false,
  };

  function getDeps() {
    return globalThis.__CGPT_LIST_MODE_DEPS__ || null;
  }

  function createAutoqTaskId(prefix = 'task') {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${time}_${random}`;
  }

  function normalizeAutoqTaskText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  function createStableListTaskIdFromText(line, index) {
    const text = String(line || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    const safeHash = Math.abs(hash).toString(36);
    return `list_task_${index + 1}_${safeHash}`;
  }

  function parseListModeTextareaToTasks(rawText) {
    const normalized = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.map((line, index) => ({
      id: createStableListTaskIdFromText(line, index),
      title: `任务 ${index + 1}`,
      content: line,
      enabled: true,
      order: index,
      sourceUpdatedAt: Date.now(),
    }));
  }

  function buildListRunQueueFromTasks(tasks) {
    const sourceTasks = Array.isArray(tasks) ? tasks : [];
    return sourceTasks
      .filter((task) => task && task.enabled !== false)
      .map((task, index) => {
        const content = normalizeAutoqTaskText(
          task.content
          || task.prompt
          || task.text
          || task.message
          || task.title
          || '',
        );
        return {
          id: task.id || createAutoqTaskId('list_task'),
          title: task.title || `任务 ${index + 1}`,
          content,
          enabled: task.enabled !== false,
          order: typeof task.order === 'number' ? task.order : index,
          sourceUpdatedAt: task.sourceUpdatedAt || task.updatedAt || Date.now(),
          runtimeStatus: AutoqTaskRuntimeStatus.PENDING,
          initialSent: false,
          batchSent: 0,
          sendRetryCount: 0,
          maxSendRetry: Math.max(1, Number(task.maxSendRetry) || DEFAULT_MAX_SEND_RETRY),
          sentAt: 0,
          completedAt: 0,
          failedAt: 0,
          failureReason: '',
          failureDetail: '',
          lastSendAttemptAt: 0,
          lastReplyTextLen: 0,
        };
      })
      .filter((task) => task.content.length > 0);
  }

  function getAutoqListRunState() {
    const deps = getDeps();
    if (deps && deps.state) {
      if (!deps.state.listRunState || typeof deps.state.listRunState !== 'object') {
        deps.state.listRunState = Object.assign({}, autoqListRunStateFallback, {
          runQueue: [],
        });
      }
      return deps.state.listRunState;
    }
    return autoqListRunStateFallback;
  }

  function syncLegacyIdxFromListRunState() {
    const deps = getDeps();
    const listState = getAutoqListRunState();
    if (!deps || !deps.state) {
      return;
    }
    const idx = Number(listState.currentTaskIndex);
    if (Number.isFinite(idx) && idx >= 0) {
      deps.state.idx = idx;
    }
  }

  function getVisibleListRunTotal(runQueue) {
    return (Array.isArray(runQueue) ? runQueue : []).filter((task) => (
      task && task.runtimeStatus !== AutoqTaskRuntimeStatus.DELETED
    )).length;
  }

  function getListRunStats(runQueue) {
    const queue = Array.isArray(runQueue) ? runQueue : [];
    return {
      total: getVisibleListRunTotal(queue),
      pending: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.PENDING).length,
      sending: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.SENDING).length,
      waiting: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.WAITING_REPLY).length,
      done: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.DONE).length,
      failed: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.FAILED).length,
      skipped: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.SKIPPED).length,
      deleted: queue.filter((task) => task && task.runtimeStatus === AutoqTaskRuntimeStatus.DELETED).length,
    };
  }

  function findNextPendingListTaskIndex(runQueue, fromIndex) {
    const queue = Array.isArray(runQueue) ? runQueue : [];
    const start = Math.max(-1, Number(fromIndex) || -1);
    for (let index = start + 1; index < queue.length; index += 1) {
      const task = queue[index];
      if (!task) {
        continue;
      }
      if (task.enabled === false) {
        continue;
      }
      if (task.runtimeStatus === AutoqTaskRuntimeStatus.PENDING) {
        return index;
      }
    }
    return -1;
  }

  function isListRunActiveStatus(status) {
    return LIST_RUN_ACTIVE_STATUSES.includes(String(status || ''));
  }

  function hasNextListRunTask(listState) {
    const state = listState || getAutoqListRunState();
    return findNextPendingListTaskIndex(state.runQueue, state.currentTaskIndex) >= 0;
  }

  function getCurrentListRunTask(listState) {
    const state = listState || getAutoqListRunState();
    const index = Number(state.currentTaskIndex);
    if (!Array.isArray(state.runQueue)) {
      return null;
    }
    if (index < 0 || index >= state.runQueue.length) {
      return null;
    }
    return state.runQueue[index] || null;
  }

  function mapRuntimeStatusToLegacy(runtimeStatus) {
    const status = String(runtimeStatus || '');
    if (status === AutoqTaskRuntimeStatus.WAITING_REPLY) {
      return 'waiting-reply';
    }
    if (status === AutoqTaskRuntimeStatus.SENDING) {
      return 'running';
    }
    if (status === AutoqTaskRuntimeStatus.DONE) {
      return 'done';
    }
    if (status === AutoqTaskRuntimeStatus.FAILED) {
      return 'failed';
    }
    return 'pending';
  }

  function getCurrentListTask() {
    const task = getCurrentListRunTask();
    const listState = getAutoqListRunState();
    if (!task) {
      return null;
    }
    return {
      index: listState.currentTaskIndex,
      id: task.id,
      text: task.content,
      title: task.title,
      status: mapRuntimeStatusToLegacy(task.runtimeStatus),
      step: task.runtimeStatus,
      initialSent: !!task.initialSent,
      batchSent: Number(task.batchSent) || 0,
      failureReason: task.failureReason || '',
      failureDetail: task.failureDetail || '',
      failedAt: task.failedAt || 0,
      sentAt: task.sentAt || 0,
      doneAt: task.completedAt || 0,
      runtime: {
        sendRetryCount: Number(task.sendRetryCount) || 0,
        maxSendRetry: Number(task.maxSendRetry) || DEFAULT_MAX_SEND_RETRY,
        lastFailureReason: task.failureReason || '',
        lastFailureDetail: task.failureDetail || '',
        lastSendAttemptAt: task.lastSendAttemptAt || 0,
      },
    };
  }

  function getListSettings() {
    const deps = getDeps();
    const raw = deps && deps.config && deps.config.taskQueueSettings
      ? deps.config.taskQueueSettings
      : {};
    const getTimeout = deps && typeof deps.getListModeTimeoutSettings === 'function'
      ? deps.getListModeTimeoutSettings()
      : null;
    return {
      continueOnTaskFailure: raw.listContinueOnTaskFailure !== false,
      enableKeyboardSendFallback: raw.listEnableKeyboardSendFallback !== false,
      maxSendRetry: Math.max(1, Number(raw.listMaxSendRetry) || DEFAULT_MAX_SEND_RETRY),
      replyWaitTimeoutMs: getTimeout
        ? getTimeout.replyWaitTimeoutMs
        : Math.max(0, Number(raw.listReplyWaitTimeoutMs) || 0),
      sendButtonWaitTimeoutMs: getTimeout
        ? getTimeout.sendButtonWaitTimeoutMs
        : Math.max(1000, Number(raw.listSendButtonWaitTimeoutMs) || 60000),
      noProgressTimeoutMs: getTimeout
        ? getTimeout.noProgressTimeoutMs
        : Math.max(0, Number(raw.listNoProgressTimeoutMs) || 300000),
    };
  }

  function appendListLog(tag, fields) {
    const deps = getDeps();
    const extra = fields && typeof fields === 'object' ? fields : {};
    const parts = [String(tag || '[AUTOQ][LIST_MODE]')];
    Object.keys(extra).forEach((key) => {
      parts.push(`${key}=${String(extra[key])}`);
    });
    const line = parts.join(' ');
    if (deps && deps.ToolboxShell && typeof deps.ToolboxShell.appendLog === 'function') {
      deps.ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function syncListRunPhaseToCore(status, reason) {
    const deps = getDeps();
    if (!deps || typeof deps.setAutoQueuePhase !== 'function' || !deps.AUTO_QUEUE_PHASES) {
      return;
    }
    const phaseKey = deps.AUTO_QUEUE_PHASES;
    const statusText = String(status || '');
    if (statusText === 'waiting_reply') {
      deps.setAutoQueuePhase(phaseKey.WAITING_REPLY, reason || 'list-waiting-reply', { force: true });
    } else if (statusText === 'sending') {
      deps.setAutoQueuePhase(phaseKey.SENDING, reason || 'list-sending');
    } else if (statusText === 'reply_ready') {
      deps.setAutoQueuePhase(phaseKey.REPLY_READY, reason || 'list-reply-ready');
    } else if (statusText === 'delay_next' || statusText === 'preparing') {
      deps.setAutoQueuePhase(phaseKey.PREPARING, reason || 'list-preparing');
    } else if (statusText === 'done') {
      deps.setAutoQueuePhase(phaseKey.DONE, reason || 'list-all-tasks-done');
    } else if (statusText === 'failed' || statusText === 'stopped') {
      deps.setAutoQueuePhase(phaseKey.FAILED, reason || 'list-stopped');
    }
  }

  function setListRunStatus(nextStatus, reason, extra = {}) {
    const state = getAutoqListRunState();
    const prevStatus = String(state.status || 'idle');
    const status = String(nextStatus || 'idle');
    const now = Date.now();

    state.status = status;
    state.updatedAt = now;
    state.running = isListRunActiveStatus(status);
    state.waitingReply = status === 'waiting_reply';
    state.sendingNow = status === 'sending';

    const deps = getDeps();
    if (deps && deps.state) {
      deps.state.listModeRunning = state.running;
      deps.state.waitingReply = state.waitingReply;
      deps.state.sendingNow = state.sendingNow;

      if (!deps.state.taskRun || typeof deps.state.taskRun !== 'object') {
        deps.state.taskRun = {};
      }

      if (status === 'waiting_reply') {
        deps.state.taskRun.currentStep = 'wait-reply';
        deps.state.taskRun.pendingReplyKind = 'list';
        deps.state.taskRun.pendingSendKind = '';
      } else if (status === 'delay_next') {
        deps.state.taskRun.currentStep = 'delay-next';
        deps.state.taskRun.pendingReplyKind = '';
        deps.state.taskRun.pendingSendKind = 'list';
      } else if (status === 'sending') {
        deps.state.taskRun.currentStep = 'sending';
        deps.state.taskRun.pendingReplyKind = '';
        deps.state.taskRun.pendingSendKind = 'list';
      } else if (status === 'done') {
        deps.state.taskRun.currentStep = 'done';
        deps.state.taskRun.pendingReplyKind = '';
        deps.state.taskRun.pendingSendKind = '';
        deps.state.waitingReply = false;
        deps.state.sendingNow = false;
      } else if (status === 'idle' || status === 'failed' || status === 'stopped') {
        deps.state.taskRun.currentStep = status;
        deps.state.taskRun.pendingReplyKind = '';
        deps.state.taskRun.pendingSendKind = '';
        deps.state.waitingReply = false;
        deps.state.sendingNow = false;
      } else if (status === 'preparing' || status === 'reply_ready') {
        deps.state.taskRun.currentStep = status === 'reply_ready' ? 'reply-ready' : 'preparing';
        deps.state.taskRun.pendingReplyKind = '';
        deps.state.taskRun.pendingSendKind = 'list';
      }

      const currentTask = getCurrentListRunTask(state);
      if (currentTask) {
        deps.state.taskRun.currentTaskId = currentTask.id || '';
        deps.state.taskRun.currentQuestionText = currentTask.content || '';
        deps.state.taskRun.currentTaskQuestionText = currentTask.content || '';
      }
    }

    syncListRunPhaseToCore(status, reason);

    if (deps && typeof deps.syncWaitingReplyFlagFromPhase === 'function') {
      deps.syncWaitingReplyFlagFromPhase(`list-status:${reason || status}`);
    }

    const logPayload = Object.assign({
      from: prevStatus,
      to: status,
      reason: reason || '',
      index: state.currentTaskIndex,
      taskId: state.currentTaskId || '',
      taskCount: Array.isArray(state.runQueue) ? state.runQueue.length : 0,
      waitingReply: state.waitingReply ? 1 : 0,
      sendingNow: state.sendingNow ? 1 : 0,
    }, extra || {});

    console.log('[AUTOQ][LIST_MODE][STATUS]', logPayload);
    appendListLog('[AUTOQ][LIST_MODE][STATUS]', logPayload);

    setListModeStatus({
      phase: state.running ? 'running' : status,
      step: status,
      displayMessage: '',
      reason: reason || status,
    });

    return state;
  }

  function handleListReplyComplete(reason = 'reply-complete', context = {}) {
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if (task && task.runtimeStatus !== AutoqTaskRuntimeStatus.DONE) {
      markCurrentListRunTaskDone({ reason });
    }

    const nextIndex = findNextPendingListTaskIndex(state.runQueue, state.currentTaskIndex);
    if (nextIndex >= 0) {
      const fromIndex = state.currentTaskIndex;
      state.currentTaskIndex = nextIndex;
      state.currentTaskId = state.runQueue[nextIndex] ? state.runQueue[nextIndex].id : '';
      syncLegacyIdxFromListRunState();

      setListRunStatus('delay_next', reason, {
        fromIndex,
        nextIndex,
      });

      const delayMs = Number.isFinite(Number(context.delayMs))
        ? Number(context.delayMs)
        : getAutoqNextTaskDelayMs();

      appendListLog('[AUTOQ][LIST_MODE][NEXT_DELAY]', {
        fromIndex,
        nextIndex,
        delayMs,
      });

      clearListModeTimer('nextTaskTimerId');
      const run = ensureListModeRun();
      if (run) {
        run.nextTaskTimerId = window.setTimeout(() => {
          run.nextTaskTimerId = null;
          const latestState = getAutoqListRunState();
          if (latestState.status !== 'delay_next') {
            console.warn('[AUTOQ][LIST_MODE][NEXT_DELAY_SKIP]', {
              reason: 'status-changed',
              status: latestState.status,
              expected: 'delay_next',
            });
            return;
          }
          runCurrentListRunTask({
            reason: 'list-next-delay',
            source: 'list-next-delay',
            expectedTaskIndex: nextIndex,
          });
        }, Math.max(0, delayMs));
      }
      renderAutoqListModeStatus('list-reply-complete-next');
      return;
    }

    finishAutoqListModeRun({ reason: 'list-all-tasks-done' });
  }

  function ensureListModeRun() {
    const deps = getDeps();
    if (!deps || !deps.state) {
      return null;
    }
    if (!deps.state.listModeRun || typeof deps.state.listModeRun !== 'object') {
      deps.state.listModeRun = {
        phase: 'idle',
        step: 'idle',
        displayMessage: '',
        retryTimerId: null,
        nextTaskTimerId: null,
      };
    }
    return deps.state.listModeRun;
  }

  function clearListModeTimer(key) {
    const run = ensureListModeRun();
    if (!run) {
      return;
    }
    const timerId = run[key];
    if (timerId) {
      window.clearTimeout(timerId);
      run[key] = null;
    }
  }

  function clearListModeTimers() {
    clearListModeTimer('retryTimerId');
    clearListModeTimer('nextTaskTimerId');
  }

  function setListModeStatus(patch) {
    const run = ensureListModeRun();
    if (!run) {
      return;
    }
    Object.assign(run, patch || {});
    renderAutoqListModeStatus((patch && patch.reason) ? patch.reason : 'list-mode-status');
  }

  function setAutoqListModeDisplayState(displayState) {
    const deps = getDeps();
    if (deps && typeof deps.updateAutoqStatusPanel === 'function') {
      deps.updateAutoqStatusPanel(displayState);
      return;
    }
    if (deps && typeof deps.updateStatus === 'function') {
      deps.updateStatus('list-mode-display');
    }
    console.log('[AUTOQ][LIST_MODE][DISPLAY_STATE]', displayState);
  }

  function renderAutoqListModeStatus(reason = '') {
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    const stats = getListRunStats(state.runQueue);
    let phaseText = '列表模式 · 未开始';
    let stepText = '-';
    let suggestion = '请选择任务后，点击开始批量任务组。';

    const listStatus = String(state.status || '');
    if (state.running || isListRunActiveStatus(listStatus)) {
      phaseText = '列表模式 · 运行中';
      if (listStatus === 'sending' || state.sendingNow) {
        stepText = '正在发送当前任务';
        suggestion = '正在发送当前任务，请等待发送完成。';
      } else if (
        listStatus === 'waiting_reply'
        || state.waitingReply
        || (task && task.runtimeStatus === AutoqTaskRuntimeStatus.WAITING_REPLY)
      ) {
        stepText = '等待 ChatGPT 回复';
        suggestion = '任务已发送，正在等待 ChatGPT 回复完成。';
      } else if (listStatus === 'delay_next') {
        stepText = '等待发送下一条';
        suggestion = '上一条已回复，正在等待间隔后发送下一条。';
      } else {
        stepText = '准备发送下一个任务';
        suggestion = '正在按列表顺序继续执行。';
      }
    } else if (state.completedAt > 0 && stats.pending === 0) {
      phaseText = '列表模式 · 已完成';
      stepText = '所有任务已处理完成';
      suggestion = '可以重新开始批量任务组。';
    } else if (state.lastFailureReason) {
      phaseText = '列表模式 · 已停止';
      stepText = state.lastFailureReason;
      suggestion = '任务已停止。如果不是主动停止，请查看失败原因和错误日志。';
    }

    const currentIndexForDisplay = task ? state.currentTaskIndex + 1 : 0;
    const totalForDisplay = stats.total;
    const displayState = {
      phase: state.running ? 'running' : 'idle',
      mode: 'list',
      title: phaseText,
      currentTaskText: task
        ? `第 ${currentIndexForDisplay} / ${totalForDisplay} 个 | ${task.title || task.content}`
        : `第 0 / ${totalForDisplay} 个`,
      stepText,
      suggestion,
      stats,
      reason,
      raw: {
        runId: state.runId,
        currentTaskIndex: state.currentTaskIndex,
        currentTaskId: state.currentTaskId,
        sendingNow: state.sendingNow,
        waitingReply: state.waitingReply,
        running: state.running,
      },
    };

    console.log('[AUTOQ][LIST_MODE][RENDER_STATUS]', displayState);
    setAutoqListModeDisplayState(displayState);
  }

  function getAutoqNextTaskDelayMs() {
    const minInput = document.querySelector('#cgpt-autoq-min-interval, input[name="autoqMinInterval"]');
    const maxInput = document.querySelector('#cgpt-autoq-max-interval, input[name="autoqMaxInterval"]');
    const minSeconds = minInput ? Number(minInput.value || 0) : 3;
    const maxSeconds = maxInput ? Number(maxInput.value || 0) : 20;
    const minMs = Math.max(0, minSeconds * 1000);
    const maxMs = Math.max(minMs, maxSeconds * 1000);
    const delayMs = minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs + 1));
    console.log('[AUTOQ][LIST_MODE][NEXT_DELAY]', {
      minSeconds,
      maxSeconds,
      delayMs,
    });
    return delayMs;
  }

  function getListRunRetryDelayMs(retryCount) {
    if (retryCount <= 1) {
      return LIST_SEND_RETRY_DELAYS_MS[0];
    }
    if (retryCount === 2) {
      return LIST_SEND_RETRY_DELAYS_MS[1];
    }
    return LIST_SEND_RETRY_DELAYS_MS[2];
  }

  function resolveSourceTasksForListRun() {
    const deps = getDeps();
    if (deps && typeof deps.getActiveAutoqTaskList === 'function') {
      const activeList = deps.getActiveAutoqTaskList();
      if (activeList && Array.isArray(activeList.tasks) && activeList.tasks.length > 0) {
        return { activeList, sourceTasks: activeList.tasks };
      }
      if (activeList && typeof activeList.text === 'string' && activeList.text.trim()) {
        return {
          activeList,
          sourceTasks: parseListModeTextareaToTasks(activeList.text),
        };
      }
    }

    if (deps && deps.state && Array.isArray(deps.state.queue) && deps.state.queue.length > 0) {
      return {
        activeList: null,
        sourceTasks: deps.state.queue.map((line, index) => ({
          id: createAutoqTaskId('list_task'),
          title: `任务 ${index + 1}`,
          content: String(line || ''),
          enabled: true,
          order: index,
          sourceUpdatedAt: Date.now(),
        })),
      };
    }

    const textarea = document.querySelector(
      '#cgpt-autoq-prompt-textarea, #cgpt-autoq-list-textarea, textarea[data-autoq-prompt="1"], #cgpt-autoq-prompts',
    );
    return {
      activeList: null,
      sourceTasks: parseListModeTextareaToTasks(textarea ? textarea.value : ''),
    };
  }

  function syncActiveListToListRunQueue(reason = '') {
    const state = getAutoqListRunState();
    if (!state.running || !state.liveSyncEnabled || state.lockQueueOnStart) {
      return;
    }

    const { sourceTasks } = resolveSourceTasksForListRun();
    const latestQueue = buildListRunQueueFromTasks(sourceTasks);
    const existingById = new Map(state.runQueue.map((task) => [task.id, task]));
    let addCount = 0;
    let updateCount = 0;

    latestQueue.forEach((nextTask) => {
      const existing = existingById.get(nextTask.id);
      if (!existing) {
        state.runQueue.push(nextTask);
        addCount += 1;
        console.log('[AUTOQ][LIST_RUN][LIVE_ADD_TASK]', {
          taskId: nextTask.id,
          title: nextTask.title,
          content: nextTask.content,
          reason,
        });
        return;
      }
      if (existing.runtimeStatus === AutoqTaskRuntimeStatus.PENDING) {
        existing.title = nextTask.title;
        existing.content = nextTask.content;
        existing.enabled = nextTask.enabled;
        existing.order = nextTask.order;
        existing.sourceUpdatedAt = nextTask.sourceUpdatedAt;
        updateCount += 1;
        console.log('[AUTOQ][LIST_RUN][LIVE_UPDATE_PENDING]', {
          taskId: existing.id,
          title: existing.title,
          reason,
        });
        return;
      }
      console.log('[AUTOQ][LIST_RUN][SKIP_UPDATE_RUNNING]', {
        taskId: existing.id,
        title: existing.title,
        runtimeStatus: existing.runtimeStatus,
        reason,
      });
    });

    state.updatedAt = Date.now();
    console.log('[AUTOQ][LIST_RUN][LIVE_SYNC]', {
      reason,
      addCount,
      updateCount,
      stats: getListRunStats(state.runQueue),
    });
    renderAutoqListModeStatus('live-sync');
  }

  function prepareListRunQueueFromEditor(options = {}) {
    const { sourceTasks, activeList } = resolveSourceTasksForListRun();
    const runQueue = buildListRunQueueFromTasks(sourceTasks);
    const queueTexts = runQueue.map((task) => task.content);
    if (!runQueue.length) {
      return {
        ok: false,
        reason: 'empty-run-queue',
        queueTexts: [],
        runQueue: [],
        taskCount: 0,
      };
    }
    const shouldApplyToState = options.applyToState !== false;
    if (shouldApplyToState) {
      const state = getAutoqListRunState();
      const deps = getDeps();
      state.runQueue = runQueue;
      state.activeListId = activeList && activeList.id ? activeList.id : '';
      state.currentTaskIndex = -1;
      state.currentTaskId = '';
      state.runId = '';
      state.status = 'idle';
      state.sendingNow = false;
      state.waitingReply = false;
      state.stopRequested = false;
      state.completedAt = 0;
      state.lastFailureReason = '';
      state.lastFailureDetail = '';
      state.updatedAt = Date.now();
      if (deps && deps.state) {
        deps.state.queue = queueTexts;
        deps.state.idx = -1;
        deps.state.waitingReply = false;
        deps.state.sendingNow = false;
      }
      console.log('[AUTOQ][LIST_MODE][QUEUE_PREPARED]', {
        activeListId: state.activeListId || '',
        taskCount: runQueue.length,
        firstTask: runQueue[0] ? runQueue[0].content : '',
      });
      appendListLog('[AUTOQ][LIST_MODE][QUEUE_PREPARED]', {
        taskCount: runQueue.length,
        activeListId: state.activeListId || '-',
      });
    }
    return {
      ok: true,
      queueTexts,
      runQueue,
      taskCount: runQueue.length,
      activeListId: activeList && activeList.id ? activeList.id : '',
    };
  }

  function settleListReplyAndAdvance(context = {}) {
    handleListReplyComplete(context.reason || 'reply-done-next-task', context);
  }

  function startAutoqListModeRun(options = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();
    let prepared = prepareListRunQueueFromEditor({ applyToState: false });
    if (
      !prepared.ok
      && Array.isArray(state.runQueue)
      && state.runQueue.length > 0
    ) {
      prepared = {
        ok: true,
        queueTexts: state.runQueue.map((task) => task.content),
        runQueue: state.runQueue,
        taskCount: state.runQueue.length,
        activeListId: state.activeListId || '',
        reason: 'reuse-existing-run-queue',
      };
      console.log('[AUTOQ][LIST_MODE][START_REUSE_RUN_QUEUE]', {
        taskCount: prepared.taskCount,
        reason: prepared.reason,
      });
    }
    if (!prepared.ok) {
      prepared = prepareListRunQueueFromEditor();
    }
    if (!prepared.ok) {
      console.warn('[AUTOQ][LIST_MODE][START_BLOCKED]', {
        reason: prepared.reason || 'empty-run-queue',
        activeListId: state.activeListId || '',
        existingRunQueueLen: Array.isArray(state.runQueue) ? state.runQueue.length : 0,
      });
      setAutoqListModeDisplayState({
        phase: 'failed',
        status: 'failed',
        step: 'empty-task-list',
        message: '当前列表没有可执行任务',
      });
      return false;
    }

    state.runQueue = Array.isArray(prepared.runQueue) ? prepared.runQueue : state.runQueue;
    if (deps && deps.state) {
      deps.state.queue = Array.isArray(prepared.queueTexts)
        ? prepared.queueTexts
        : state.runQueue.map((task) => task.content);
    }

    clearListModeTimers();
    state.mode = 'list';
    state.runId = `list_run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    state.currentTaskIndex = -1;
    state.currentTaskId = '';
    state.stopRequested = false;
    state.startedAt = Date.now();
    state.completedAt = 0;
    state.lastFailureReason = '';
    state.lastFailureDetail = '';
    state.liveSyncEnabled = options.liveSyncEnabled !== false;
    state.lockQueueOnStart = options.lockQueueOnStart === true;

    if (deps && deps.state) {
      deps.state.queue = prepared.queueTexts;
      deps.state.idx = -1;
      deps.state.listModeRunning = true;
    }

    setListRunStatus('preparing', 'list-mode-start');

    console.log('[AUTOQ][LIST_MODE][START]', {
      runId: state.runId,
      activeListId: state.activeListId,
      taskCount: state.runQueue.length,
      liveSyncEnabled: state.liveSyncEnabled,
      lockQueueOnStart: state.lockQueueOnStart,
      firstTask: state.runQueue[0] ? state.runQueue[0].content : '',
    });
    appendListLog('[AUTOQ][LIST_MODE][START]', {
      runId: state.runId,
      taskCount: state.runQueue.length,
    });

    scheduleNextListRunTask({
      reason: 'start-list-mode',
      delayMs: 0,
    });
    return true;
  }

  function scheduleNextListRunTask(context = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();

    if (
      !context.afterReply
      && (
        state.status === 'waiting_reply'
        || state.waitingReply
        || (deps && deps.state && deps.state.waitingReply)
      )
    ) {
      console.warn('[AUTOQ][LIST_MODE][SCHEDULE_NEXT_SKIP]', {
        reason: 'waiting-reply',
        contextReason: context.reason || '',
        currentTaskIndex: state.currentTaskIndex,
        currentTaskId: state.currentTaskId,
        status: state.status || '',
      });
      return;
    }

    if (!state.running && !isListRunActiveStatus(state.status)) {
      console.warn('[AUTOQ][LIST_MODE][SCHEDULE_NEXT_SKIP]', {
        reason: 'not-running',
        contextReason: context.reason || '',
      });
      return;
    }

    if (state.stopRequested) {
      console.warn('[AUTOQ][LIST_MODE][SCHEDULE_NEXT_SKIP]', {
        reason: 'stop-requested',
        contextReason: context.reason || '',
      });
      stopAutoqListModeRun({
        reason: 'stop-requested-before-next',
      });
      return;
    }

    if (state.liveSyncEnabled && !state.lockQueueOnStart) {
      syncActiveListToListRunQueue('before-schedule-next');
    }

    const nextIndex = findNextPendingListTaskIndex(state.runQueue, state.currentTaskIndex);
    const stats = getListRunStats(state.runQueue);

    console.log('[AUTOQ][LIST_MODE][NEXT_PENDING]', {
      runId: state.runId,
      fromIndex: state.currentTaskIndex,
      nextIndex,
      total: stats.total,
      pending: stats.pending,
      done: stats.done,
      failed: stats.failed,
      reason: context.reason || '',
    });

    if (nextIndex < 0) {
      finishAutoqListModeRun({
        reason: 'no-pending-task',
      });
      return;
    }

    state.currentTaskIndex = nextIndex;
    state.currentTaskId = state.runQueue[nextIndex].id;
    state.updatedAt = Date.now();
    syncLegacyIdxFromListRunState();

    clearListModeTimer('nextTaskTimerId');
    const delayMs = Number.isFinite(Number(context.delayMs))
      ? Number(context.delayMs)
      : (context.afterReply ? getAutoqNextTaskDelayMs() : 800);
    const run = ensureListModeRun();
    if (run) {
      run.nextTaskTimerId = window.setTimeout(() => {
        run.nextTaskTimerId = null;
        runCurrentListRunTask({
          source: context.reason || 'schedule-next',
        });
      }, Math.max(0, delayMs));
    }

    renderAutoqListModeStatus('schedule-next');
  }

  function classifyListRunFailure(reason, detail) {
    const r = String(reason || '').trim().toLowerCase().replace(/_/g, '-');
    const d = String(detail || '').trim().toLowerCase().replace(/_/g, '-');
    const manualStopReasons = new Set(['manual-stop', 'user-stop', 'stop-requested', 'cancelled', 'user-cancelled']);
    const fatalReasons = new Set([
      'quota-exhausted',
      'message-quota-exhausted',
      'empty-task-list',
      'page-unavailable-after-recovery',
    ]);
    const retryableReasons = new Set([
      'send-button-not-found',
      'send-wait-button',
      'send-button-disabled',
      'composer-empty',
      'composer-empty-after-write',
      'composer-write-failed',
      'assistant-busy',
      'page-throttled',
      'conversation-syncable-false',
      'inputable-but-not-sendable',
      'click-failed',
      'send-exception',
      'send-not-confirmed',
      'keyboard-send-not-confirmed',
      'browser-throttled',
      'background-throttled',
    ]);

    if (manualStopReasons.has(r) || manualStopReasons.has(d)) {
      return { action: 'stop-batch', retryable: false, fatal: true, reason: r || d };
    }
    if (fatalReasons.has(r) || fatalReasons.has(d)) {
      return { action: 'stop-batch', retryable: false, fatal: true, reason: r || d };
    }
    if (retryableReasons.has(r) || retryableReasons.has(d)) {
      return { action: 'retry-current', retryable: true, fatal: false, reason: r || d };
    }
    return { action: 'skip-current', retryable: false, fatal: false, reason: r || d || 'unknown-failure' };
  }

  async function fallbackSendCurrentListTaskText(text, task) {
    console.warn('[AUTOQ][LIST_MODE][FALLBACK_SEND_USED]', {
      taskId: task ? task.id : '',
      taskTitle: task ? task.title : '',
      textLen: String(text || '').length,
    });

    if (typeof ComposerApi === 'undefined' || !ComposerApi) {
      return {
        ok: false,
        reason: 'composer-api-not-found',
        detail: 'ComposerApi is not available',
      };
    }

    const composer = typeof ComposerApi.getComposer === 'function'
      ? ComposerApi.getComposer()
      : null;
    const composerRoot = typeof ComposerApi.getComposerRoot === 'function'
      ? ComposerApi.getComposerRoot()
      : composer;

    if (!composer && !composerRoot) {
      return {
        ok: false,
        reason: 'composer-not-found',
        detail: 'ChatGPT composer not found',
      };
    }

    try {
      if (typeof writeTextToComposer === 'function') {
        await writeTextToComposer(text, {
          source: 'autoq-list-mode-fallback',
          taskId: task ? task.id : '',
        });
      } else if (typeof ComposerApi.setComposerValue === 'function') {
        ComposerApi.setComposerValue(text);
      } else if (composer && 'value' in composer) {
        composer.value = text;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (composerRoot) {
        const editable = composerRoot.querySelector('[contenteditable="true"], textarea');
        if (editable && 'value' in editable) {
          editable.value = text;
          editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          editable.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (editable) {
          editable.textContent = text;
          editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
      }
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][FALLBACK_WRITE_ERROR]', {
        taskId: task ? task.id : '',
        error,
      });
      return {
        ok: false,
        reason: 'composer-write-failed',
        detail: error && error.message ? error.message : String(error),
      };
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 300);
    });

    try {
      let sendButton = null;
      if (typeof detectRealSendButton === 'function') {
        const detectResult = detectRealSendButton(composerRoot || document);
        sendButton = detectResult && detectResult.button ? detectResult.button : null;
      }
      if (!sendButton) {
        sendButton = document.querySelector(
          'button[data-testid="send-button"], button[aria-label*="发送"], button[aria-label*="Send"]',
        );
      }
      if (!sendButton || sendButton.disabled) {
        return {
          ok: false,
          reason: sendButton ? 'send-button-disabled' : 'send-button-not-found',
          detail: sendButton ? 'send button is disabled' : 'send button not found',
        };
      }
      sendButton.click();
      return {
        ok: true,
        reason: 'sent',
        detail: 'fallback click sent',
        clicked: true,
      };
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][FALLBACK_CLICK_ERROR]', {
        taskId: task ? task.id : '',
        error,
      });
      return {
        ok: false,
        reason: 'click-failed',
        detail: error && error.message ? error.message : String(error),
      };
    }
  }

  async function tryKeyboardSendFallback(task, promptText) {
    const settings = getListSettings();
    if (!settings.enableKeyboardSendFallback) {
      return { ok: false, reason: 'keyboard-fallback-disabled' };
    }

    appendListLog('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FALLBACK]', {
      taskIndex: task ? task.index + 1 : '-',
    });

    const composer = (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.getComposer === 'function'
    )
      ? ComposerApi.getComposer()
      : null;

    if (!(composer instanceof HTMLElement)) {
      return { ok: false, reason: 'composer-not-found' };
    }

    const textLen = typeof ComposerApi.getComposerText === 'function'
      ? String(ComposerApi.getComposerText() || '').trim().length
      : 0;
    if (textLen <= 0 && promptText) {
      if (typeof ComposerApi.setComposerValue === 'function') {
        ComposerApi.setComposerValue(String(promptText));
        await new Promise((resolve) => {
          window.setTimeout(resolve, 300);
        });
      }
    }

    try {
      if (typeof focusComposer === 'function') {
        focusComposer(composer);
      } else {
        composer.focus();
      }
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => {
        window.setTimeout(resolve, 300);
      });

      let sent = false;
      if (typeof ComposerApi.dispatchComposerSendKeyboard === 'function') {
        sent = ComposerApi.dispatchComposerSendKeyboard('ctrl-enter') === true
          || ComposerApi.dispatchComposerSendKeyboard('meta-enter') === true;
      } else if (typeof dispatchEnterSend === 'function') {
        sent = dispatchEnterSend(composer, 'ctrl-enter') === true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 600);
      });

      const afterTextLen = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim().length
        : 0;
      const responseState = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState({ light: true })
        : {};
      const generating = !!(responseState.is_responding || responseState.response_state === 'generating');

      if (sent || afterTextLen < textLen || generating) {
        return { ok: true, reason: 'sent', source: 'keyboard-fallback' };
      }
      return { ok: false, reason: 'keyboard-send-not-confirmed' };
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FAILED]', error, {
        taskIndex: task && task.index,
      });
      return { ok: false, reason: 'keyboard-send-failed' };
    }
  }

  function markCurrentListRunTaskSent(context = {}) {
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if (!task) {
      console.warn('[AUTOQ][LIST_MODE][TASK_SENT_MARK_SKIP]', {
        reason: 'current-task-not-found',
      });
      return;
    }

    task.initialSent = true;
    task.batchSent = 1;
    task.sentAt = Date.now();
    task.failureReason = '';
    task.failureDetail = '';
    state.currentTaskId = task.id;
    state.updatedAt = Date.now();

    console.log('[AUTOQ][LIST_MODE][TASK_SENT_OK]', {
      runId: state.runId,
      taskIndex: state.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(state.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      initialSent: task.initialSent ? 1 : 0,
      batchSent: task.batchSent,
      resultReason: context.result ? context.result.reason : '',
    });
    renderAutoqListModeStatus('task-sent-ok');
  }

  function commitListRunWaitingReplyState(context = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if ((!state.running && !isListRunActiveStatus(state.status)) || !task) {
      console.warn('[AUTOQ][LIST_MODE][WAIT_REPLY_COMMIT_SKIP]', {
        reason: 'not-running-or-no-task',
        source: context.reason || '',
        status: state.status || '',
      });
      return false;
    }

    const text = normalizeAutoqTaskText(task.content);
    task.runtimeStatus = AutoqTaskRuntimeStatus.WAITING_REPLY;
    task.initialSent = true;
    state.currentTaskId = task.id;

    if (deps && deps.state) {
      deps.state.replyBecameBusy = false;
      deps.state.idleSince = 0;
      deps.state.waitingStartedAt = Date.now();
      if (deps.state.taskRun && typeof deps.state.taskRun === 'object') {
        deps.state.taskRun.currentTaskReplyText = '';
        deps.state.taskRun.currentQuestionText = text;
        deps.state.taskRun.currentTaskQuestionText = text;
      }
    }

    setListRunStatus('waiting_reply', context.reason || 'list-wait-reply');

    if (deps) {
      if (typeof deps.setAutoQueuePhase === 'function' && deps.AUTO_QUEUE_PHASES) {
        deps.setAutoQueuePhase(
          deps.AUTO_QUEUE_PHASES.WAITING_REPLY,
          context.phaseReason || 'list-await-assistant',
          {
            force: true,
            submittedConfirmed: true,
            submittedEvidence: context.submittedEvidence || { ok: true, reason: 'list-send-confirmed' },
          },
        );
      }
      if (typeof deps.startListModeWaitReplyTracking === 'function') {
        deps.startListModeWaitReplyTracking(context.trackingSource || 'list-send-accepted');
      }
      if (typeof deps.saveWaitingReplyContext === 'function') {
        deps.saveWaitingReplyContext(context.saveContextReason || 'list-send-accepted-enter-waiting-reply');
      }
    }

    console.log('[AUTOQ][LIST_MODE][WAIT_REPLY_START]', {
      runId: state.runId,
      taskIndex: state.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(state.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      source: context.reason || '',
      status: state.status || '',
      waitingReply: state.waitingReply ? 1 : 0,
    });
    renderAutoqListModeStatus('wait-reply-start');
    return true;
  }

  function startWaitingCurrentListRunReply(context = {}) {
    commitListRunWaitingReplyState({
      reason: context.reason || 'send-ok',
      phaseReason: 'await-assistant',
      syncReason: 'list-wait-reply-start',
      trackingSource: 'list-send-accepted',
      saveContextReason: 'list-send-accepted-enter-waiting-reply',
      submittedEvidence: context.submittedEvidence || null,
    });
  }

  function markCurrentListRunTaskDone(context = {}) {
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if (!task) {
      return;
    }

    task.runtimeStatus = AutoqTaskRuntimeStatus.DONE;
    task.completedAt = Date.now();
    state.updatedAt = Date.now();

    console.log('[AUTOQ][LIST_MODE][TASK_DONE]', {
      runId: state.runId,
      taskIndex: state.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(state.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      reason: context.reason || '',
    });
    renderAutoqListModeStatus('task-done');
  }

  function markCurrentListRunTaskFailed(context = {}) {
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if (!task) {
      return;
    }

    task.runtimeStatus = AutoqTaskRuntimeStatus.FAILED;
    task.failedAt = Date.now();
    task.failureReason = context.reason || 'failed';
    task.failureDetail = context.detail || '';
    task.initialSent = !!task.initialSent;
    task.batchSent = task.batchSent || 0;
    state.waitingReply = false;
    state.updatedAt = Date.now();
    state.lastFailureReason = task.failureReason;
    state.lastFailureDetail = task.failureDetail;

    const deps = getDeps();
    if (deps && deps.state) {
      deps.state.waitingReply = false;
    }

    console.warn('[AUTOQ][LIST_MODE][TASK_FAILED_CONTINUE_NEXT]', {
      runId: state.runId,
      taskIndex: state.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(state.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      reason: task.failureReason,
      detail: task.failureDetail,
    });
    renderAutoqListModeStatus('task-failed-continue-next');
  }

  function handleCurrentListRunSendFailure(context = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();
    const task = getCurrentListRunTask();
    if (!state.running || !task) {
      return;
    }

    const reason = context.reason || 'send-failed';
    const detail = context.detail || '';
    const classified = classifyListRunFailure(reason, detail);
    const settings = getListSettings();

    console.warn('[AUTOQ][LIST_MODE][SEND_FAILED_CLASSIFIED]', {
      runId: state.runId,
      taskIndex: state.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(state.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      reason,
      detail,
      action: classified.action,
      retryable: classified.retryable,
      fatal: classified.fatal,
      retryCount: task.sendRetryCount,
      maxSendRetry: task.maxSendRetry,
    });

    if (deps && deps.state && deps.state.batchTask && deps.state.batchTask.stopRequested) {
      stopAutoqListModeRun({ reason: 'manual-stop', detail: '用户已手动停止' });
      return;
    }

    if (classified.action === 'stop-batch') {
      task.runtimeStatus = AutoqTaskRuntimeStatus.FAILED;
      task.failureReason = reason;
      task.failureDetail = detail;
      stopAutoqListModeRun({ reason, detail });
      return;
    }

    if (classified.action === 'retry-current') {
      task.sendRetryCount += 1;
      task.failureReason = reason;
      task.failureDetail = detail;
      task.runtimeStatus = AutoqTaskRuntimeStatus.PENDING;
      if (task.sendRetryCount <= task.maxSendRetry) {
        const delayMs = getListRunRetryDelayMs(task.sendRetryCount);
        console.warn('[AUTOQ][LIST_MODE][RETRY_CURRENT]', {
          runId: state.runId,
          taskId: task.id,
          taskTitle: task.title,
          retryCount: task.sendRetryCount,
          maxSendRetry: task.maxSendRetry,
          delayMs,
          reason,
          detail,
        });
        renderAutoqListModeStatus('retry-current');
        clearListModeTimer('retryTimerId');
        const run = ensureListModeRun();
        if (run) {
          run.retryTimerId = window.setTimeout(() => {
            run.retryTimerId = null;
            runCurrentListRunTask({ source: 'retry-current' });
          }, delayMs);
        }
        return;
      }
      console.warn('[AUTOQ][LIST_MODE][RETRY_EXHAUSTED]', {
        runId: state.runId,
        taskId: task.id,
        taskTitle: task.title,
        retryCount: task.sendRetryCount,
        reason,
        detail,
      });
    }

    markCurrentListRunTaskFailed({ reason, detail });
    if (settings.continueOnTaskFailure) {
      scheduleNextListRunTask({
        reason: 'task-failed-continue-next',
        delayMs: 800,
      });
    } else {
      stopAutoqListModeRun({ reason, detail: detail || '单任务失败停止' });
    }
  }

  async function runCurrentListRunTask(context = {}) {
    const deps = getDeps();
    const listState = getAutoqListRunState();
    const queueIndex = Number.isFinite(Number(listState.currentTaskIndex))
      ? Number(listState.currentTaskIndex)
      : 0;
    const queueTask = Array.isArray(listState.runQueue)
      ? listState.runQueue[queueIndex]
      : null;
    if (!queueTask || !normalizeAutoqTaskText(queueTask.content)) {
      const abortPayload = {
        reason: 'missing-list-run-task',
        index: queueIndex,
        runQueueLength: Array.isArray(listState.runQueue) ? listState.runQueue.length : 0,
        source: context.source || '',
      };
      appendListLog('[AUTOQ][LIST_MODE][SEND_ABORT]', abortPayload);
      console.warn('[AUTOQ][LIST_MODE][SEND_ABORT]', abortPayload);
      scheduleNextListRunTask({
        reason: 'missing-list-run-task',
        delayMs: 500,
      });
      return;
    }

    if (!listState.running) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'not-running',
        source: context.source || '',
      });
      return;
    }

    if (listState.stopRequested) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'stop-requested',
        source: context.source || '',
      });
      stopAutoqListModeRun({
        reason: 'user-stop-before-run-current',
      });
      return;
    }

    if (listState.sendingNow || (deps && deps.state && deps.state.sendingNow)) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'sending-now',
        currentTaskIndex: listState.currentTaskIndex,
        currentTaskId: listState.currentTaskId,
        source: context.source || '',
      });
      return;
    }

    if (listState.status === 'waiting_reply') {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'waiting-reply',
        currentTaskIndex: listState.currentTaskIndex,
        currentTaskId: listState.currentTaskId,
        source: context.source || '',
      });
      return;
    }

    const task = queueTask;
    if (!task) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'current-task-not-found',
        currentTaskIndex: listState.currentTaskIndex,
        source: context.source || '',
      });
      scheduleNextListRunTask({
        reason: 'current-task-not-found',
        delayMs: 500,
      });
      return;
    }

    if (task.initialSent && (
      task.runtimeStatus === AutoqTaskRuntimeStatus.WAITING_REPLY
      || task.runtimeStatus === AutoqTaskRuntimeStatus.DONE
    )) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'already-sent',
        taskId: task.id,
        runtimeStatus: task.runtimeStatus,
        initialSent: task.initialSent ? 1 : 0,
        currentTaskIndex: listState.currentTaskIndex,
      });
      scheduleNextListRunTask({
        reason: 'already-sent-skip',
        delayMs: 500,
      });
      return;
    }

    if (task.runtimeStatus !== AutoqTaskRuntimeStatus.PENDING) {
      console.warn('[AUTOQ][LIST_MODE][RUN_CURRENT_SKIP]', {
        reason: 'task-not-pending',
        taskId: task.id,
        taskTitle: task.title,
        runtimeStatus: task.runtimeStatus,
        currentTaskIndex: listState.currentTaskIndex,
      });
      scheduleNextListRunTask({
        reason: 'task-not-pending',
        delayMs: 500,
      });
      return;
    }

    const text = normalizeAutoqTaskText(task.content);
    if (!text) {
      markCurrentListRunTaskFailed({
        reason: 'empty-task-text',
        detail: 'current task content is empty',
      });
      scheduleNextListRunTask({
        reason: 'empty-task-text',
        delayMs: 500,
      });
      return;
    }

    task.runtimeStatus = AutoqTaskRuntimeStatus.SENDING;
    task.lastSendAttemptAt = Date.now();

    const source = String(context.source || 'run-current');
    setListRunStatus('sending', source === 'retry-current' ? 'list-send-retry' : 'list-send-start');

    console.log('[AUTOQ][LIST_MODE][SEND_ATTEMPT]', {
      runId: listState.runId,
      taskIndex: listState.currentTaskIndex + 1,
      taskTotal: getVisibleListRunTotal(listState.runQueue),
      taskId: task.id,
      taskTitle: task.title,
      textPreview: text.slice(0, 80),
      textLen: text.length,
      retryCount: task.sendRetryCount,
      source,
    });

    let result = null;
    const runId = deps && typeof deps.captureAutoQueueRunId === 'function'
      ? deps.captureAutoQueueRunId()
      : '';

    try {
      if (deps && typeof deps.sendTextThroughComposer === 'function') {
        result = await deps.sendTextThroughComposer({
          text,
          source: 'autoq-list-mode',
          taskId: task.id,
          taskTitle: task.title,
          mode: 'list',
          requireTextWritten: true,
          waitButtonTimeoutMs: getListSettings().sendButtonWaitTimeoutMs,
          shouldStop: () => !listState.running || !(deps.state && deps.state.sendingNow),
          waitForReplyIdle: true,
        });
      } else if (deps && typeof deps.sendContentViaComposer === 'function') {
        result = await deps.sendContentViaComposer({
          source: 'autoq-list-mode',
          content: text,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: getListSettings().sendButtonWaitTimeoutMs,
          blockWhenResponding: true,
        });
      } else {
        result = await fallbackSendCurrentListTaskText(text, task);
      }

      if ((!result || result.ok !== true) && getListSettings().enableKeyboardSendFallback) {
        const failReason = String((result && result.reason) || '');
        if (failReason === 'send-button-not-found' || failReason === 'send_button_not_found') {
          const kbResult = await tryKeyboardSendFallback(getCurrentListTask(), text);
          if (kbResult && kbResult.ok === true) {
            result = kbResult;
          }
        }
      }

      if (deps && typeof deps.isStaleAutoQueueRun === 'function' && deps.isStaleAutoQueueRun(runId, 'list-send')) {
        return;
      }

      if (!result || result.ok !== true) {
        handleCurrentListRunSendFailure({
          reason: result && result.reason ? result.reason : 'send-failed',
          detail: result && result.detail ? result.detail : '',
          result,
        });
        return;
      }

      markCurrentListRunTaskSent({ result });
      startWaitingCurrentListRunReply({
        reason: 'send-ok',
        submittedEvidence: result || { ok: true, reason: 'list-send-confirmed' },
      });

      if (deps) {
        if (deps.state) {
          deps.state.sentCount = Math.max(0, Number(deps.state.sentCount) || 0) + 1;
        }
        if (typeof deps.log === 'function') {
          deps.log(`已发送：${text.slice(0, 80)} reason=${result.reason || '-'}`);
        }
        if (typeof deps.updateStatus === 'function') {
          deps.updateStatus('list-task-sent');
        }
        if (typeof deps.updateChatInputStateBadge === 'function') {
          deps.updateChatInputStateBadge();
        }
      }
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][SEND_ERROR]', {
        taskId: task.id,
        taskTitle: task.title,
        error,
      });
      handleCurrentListRunSendFailure({
        reason: 'send-exception',
        detail: error && error.message ? error.message : String(error),
      });
    } finally {
      const latestState = getAutoqListRunState();
      if (latestState.status === 'sending') {
        setListRunStatus('preparing', 'list-send-finally-cleanup');
      }
    }
  }

  function stopAutoqListModeRun(context = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();
    clearListModeTimers();

    state.stopRequested = true;
    state.completedAt = Date.now();
    state.lastFailureReason = context.reason || state.lastFailureReason || '';
    state.lastFailureDetail = context.detail || state.lastFailureDetail || '';

    const isUserStop = context && (
      context.reason === 'manual-stop'
      || context.reason === 'user-stop'
      || String(context.detail || '').includes('手动停止')
    );

    console.warn(isUserStop ? '[AUTOQ][LIST_MODE][STOP_BY_USER]' : '[AUTOQ][LIST_MODE][STOP_BATCH]', {
      runId: state.runId,
      reason: context.reason || '',
      detail: context.detail || '',
      currentTaskIndex: state.currentTaskIndex,
      currentTaskId: state.currentTaskId,
      stats: getListRunStats(state.runQueue),
    });

    setListRunStatus('stopped', context.reason || 'list-stop-batch', {
      detail: context.detail || '',
    });

    if (deps && deps.state) {
      deps.state.listModeRunning = false;
    }

    renderAutoqListModeStatus('stop-batch');

    if (deps && typeof deps.stop === 'function') {
      deps.stop({
        reason: context.reason || 'list-stop-batch',
        logStop: true,
        displayReason: context.detail || '',
        manualStop: isUserStop,
        userStop: isUserStop,
        fromUser: isUserStop,
      });
    }
  }

  function finishAutoqListModeRun(context = {}) {
    const deps = getDeps();
    const state = getAutoqListRunState();
    const stats = getListRunStats(state.runQueue);

    clearListModeTimers();
    state.stopRequested = false;
    state.completedAt = Date.now();

    if (deps && deps.state) {
      deps.state.listModeRunning = false;
    }

    setListRunStatus('done', context.reason || 'list-all-tasks-done', {
      taskCount: Array.isArray(state.runQueue) ? state.runQueue.length : 0,
    });

    console.log('[AUTOQ][LIST_MODE][ALL_DONE]', {
      runId: state.runId,
      reason: context.reason || '',
      stats,
    });

    if (deps && typeof deps.stop === 'function') {
      deps.stop({
        reason: 'all-done',
        finalStep: 'all-done',
        logStop: true,
        displayReason: '列表任务已全部处理',
      });
    }
  }

  function onListTaskReplyDone(reason) {
    markCurrentListRunTaskDone({ reason: reason || 'reply-complete' });
  }

  function getListModeProgressSnapshot() {
    const listState = getAutoqListRunState();
    const stats = getListRunStats(listState.runQueue);
    const task = getCurrentListRunTask();
    const doneCount = stats.done + stats.failed;
    const currentIndex = listState.currentTaskIndex >= 0 ? listState.currentTaskIndex + 1 : 0;
    const total = stats.total;

    return {
      total,
      currentIndex,
      doneCount,
      taskProgress: total > 0 ? `${currentIndex}/${total}（已完成 ${doneCount}）` : '-',
      step: task ? task.runtimeStatus : 'idle',
      displayMessage: ensureListModeRun() ? ensureListModeRun().displayMessage || '' : '',
      currentTaskTitle: task ? (task.title || task.content) : '-',
      currentTaskStatus: task ? mapRuntimeStatusToLegacy(task.runtimeStatus) : '-',
      initialSent: task ? (task.initialSent ? 1 : 0) : 0,
      batchSent: task ? Number(task.batchSent) || 0 : 0,
      stats,
    };
  }

  function initListModeStart() {
    return startAutoqListModeRun({
      liveSyncEnabled: true,
      lockQueueOnStart: false,
    });
  }

  function scheduleNextListTask(context) {
    scheduleNextListRunTask(Object.assign({}, context || {}, {
      reason: (context && context.reason) || 'legacy-schedule-next',
      delayMs: (context && context.delayMs) != null ? context.delayMs : getAutoqNextTaskDelayMs(),
    }));
  }

  function stopListMode(context) {
    stopAutoqListModeRun(context || {});
  }

  function finishListMode(context) {
    finishAutoqListModeRun(context || {});
  }

  function markCurrentListTaskFailed(context) {
    const listState = getAutoqListRunState();
    const prevIndex = listState.currentTaskIndex;
    if (context && context.task && context.task.id) {
      const found = listState.runQueue.find((item) => item.id === context.task.id);
      if (found) {
        const savedIndex = listState.currentTaskIndex;
        listState.currentTaskIndex = listState.runQueue.indexOf(found);
        markCurrentListRunTaskFailed({
          reason: context.reason,
          detail: context.detail,
        });
        listState.currentTaskIndex = savedIndex;
        return;
      }
    }
    if (context && typeof context.task === 'object' && Number.isFinite(context.task.index)) {
      listState.currentTaskIndex = context.task.index;
    }
    markCurrentListRunTaskFailed({
      reason: context && context.reason,
      detail: context && context.detail,
    });
    listState.currentTaskIndex = prevIndex;
  }

  function handleListModeSendFailure(sendResult) {
    handleCurrentListRunSendFailure({
      reason: sendResult && sendResult.reason,
      detail: sendResult && sendResult.detail,
      result: sendResult,
    });
  }

  function scheduleRetryCurrentListTask(context) {
    const deps = getDeps();
    const listTask = getCurrentListRunTask();
    if (!deps || !listTask) {
      return;
    }
    clearListModeTimer('retryTimerId');
    listTask.sendRetryCount += 1;
    listTask.failureReason = String(context && context.reason ? context.reason : '');
    listTask.failureDetail = String(context && context.detail ? context.detail : '');
    listTask.lastSendAttemptAt = Date.now();

    if (listTask.sendRetryCount > listTask.maxSendRetry) {
      markCurrentListRunTaskFailed({
        reason: listTask.failureReason,
        detail: listTask.failureDetail,
      });
      const settings = getListSettings();
      if (settings.continueOnTaskFailure) {
        scheduleNextListRunTask({ reason: 'send-retry-exhausted-continue-next', delayMs: 800 });
      } else {
        stopAutoqListModeRun({ reason: listTask.failureReason, detail: '重试次数已用尽' });
      }
      return;
    }

    console.warn('[AUTOQ][LIST_MODE][RETRY_CURRENT]', {
      taskId: listTask.id,
      taskTitle: listTask.title,
      retryCount: listTask.sendRetryCount,
      maxSendRetry: listTask.maxSendRetry,
      reason: context && context.reason,
      detail: context && context.detail,
    });

    listTask.runtimeStatus = AutoqTaskRuntimeStatus.PENDING;
    const delayMs = Number(context && context.delayMs) || getListRunRetryDelayMs(listTask.sendRetryCount);
    setListModeStatus({
      phase: 'running',
      step: 'retry-current-send',
      displayMessage: `发送失败，正在第 ${listTask.sendRetryCount}/${listTask.maxSendRetry} 次重试`,
      reason: 'retry-current-send',
    });

    const run = ensureListModeRun();
    if (run) {
      run.retryTimerId = window.setTimeout(() => {
        run.retryTimerId = null;
        if (!deps.state.running) {
          return;
        }
        void runCurrentListRunTask({ source: 'retry-current-send' });
      }, delayMs);
    }
  }

  function syncListModeTasksFromQueue() {
    // 兼容旧调用：运行中不再从 queue 重建任务，避免重置 currentTaskIndex。
    const listState = getAutoqListRunState();
    if (listState.running && Array.isArray(listState.runQueue) && listState.runQueue.length > 0) {
      return;
    }
  }

  function classifyListModeFailure(reason, detail) {
    return classifyListRunFailure(reason, detail);
  }

  globalThis.ListModeRunner = {
    AutoqTaskRuntimeStatus,
    init(deps) {
      globalThis.__CGPT_LIST_MODE_DEPS__ = deps;
    },
    isListRunActiveStatus,
    hasNextListRunTask,
    setListRunStatus,
    handleListReplyComplete,
    getAutoqListRunState,
    getCurrentListRunTask,
    getCurrentListTask,
    prepareListRunQueueFromEditor,
    startAutoqListModeRun,
    settleListReplyAndAdvance,
    scheduleNextListRunTask,
    runCurrentListRunTask,
    markCurrentListRunTaskSent,
    commitListRunWaitingReplyState,
    markCurrentListRunTaskDone,
    markCurrentListRunTaskFailed,
    startWaitingCurrentListRunReply,
    stopAutoqListModeRun,
    finishAutoqListModeRun,
    handleCurrentListRunSendFailure,
    syncActiveListToListRunQueue,
    renderAutoqListModeStatus,
    getAutoqNextTaskDelayMs,
    getListRunStats,
    parseListModeTextareaToTasks,
    buildListRunQueueFromTasks,
    classifyListModeFailure,
    ensureListModeRun,
    syncListModeTasksFromQueue,
    runCurrentListTask: runCurrentListRunTask,
    handleListModeSendFailure,
    markCurrentListTaskFailed,
    scheduleRetryCurrentListTask,
    scheduleNextListTask,
    stopListMode,
    finishListMode,
    onListTaskReplyDone,
    getListModeProgressSnapshot,
    clearListModeTimers,
    initListModeStart,
  };
})();


