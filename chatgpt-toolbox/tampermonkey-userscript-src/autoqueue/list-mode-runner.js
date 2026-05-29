(function initListModeRunnerModule() {
  const LIST_SEND_RETRY_DELAYS_MS = [1500, 3000, 5000];
  const DEFAULT_MAX_SEND_RETRY = 3;

  function getDeps() {
    return globalThis.__CGPT_LIST_MODE_DEPS__ || null;
  }

  function classifyListModeFailure(reason, detail) {
    const r = String(reason || '').trim().toLowerCase().replace(/_/g, '-');
    const d = String(detail || '').trim().toLowerCase().replace(/_/g, '-');

    const manualStopReasons = new Set([
      'manual-stop',
      'user-stop',
      'stop-requested',
      'cancelled',
      'user-cancelled',
    ]);
    const globalStopReasons = new Set([
      'quota-exhausted',
      'message-quota-exhausted',
      'upload-quota-exhausted',
      'empty-task-list',
      'no-enabled-task',
      'page-unavailable-after-recovery',
      'message-quota-exceeded',
      'upload-quota-exceeded',
    ]);
    const recoverableReasons = new Set([
      'send-button-not-found',
      'send-wait-button',
      'composer-empty',
      'composer-empty-after-write',
      'composer-write-failed',
      'send-button-disabled',
      'conversation-syncable-false',
      'conversation-syncable-0',
      'page-throttled',
      'assistant-busy',
      'response-not-ready',
      'inputable-but-not-sendable',
      'send-button-not-ready-after-text',
      'browser-throttled',
      'background-throttled',
      'click-failed',
      'send-not-confirmed',
    ]);

    if (manualStopReasons.has(r) || manualStopReasons.has(d)) {
      return {
        action: 'stop-batch',
        retryable: false,
        fatal: true,
        reason: r || d,
        display: '用户已手动停止',
      };
    }
    if (globalStopReasons.has(r) || globalStopReasons.has(d)) {
      return {
        action: 'stop-batch',
        retryable: false,
        fatal: true,
        reason: r || d,
        display: '全局条件不满足，停止列表任务',
      };
    }
    if (recoverableReasons.has(r) || recoverableReasons.has(d)) {
      return {
        action: 'retry-current',
        retryable: true,
        fatal: false,
        reason: r || d,
        display: '发送未成功，正在自动重试',
      };
    }
    return {
      action: 'skip-current',
      retryable: false,
      fatal: false,
      reason: r || d || 'unknown-failure',
      display: '当前任务失败，继续下一个',
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

  function createListTaskItem(index, text) {
    const settings = getListSettings();
    return {
      index,
      text: String(text || ''),
      title: `任务 ${index + 1}`,
      status: 'pending',
      step: 'pending',
      initialSent: false,
      batchSent: 0,
      failureReason: '',
      failureDetail: '',
      failedAt: 0,
      sentAt: 0,
      doneAt: 0,
      runtime: {
        sendRetryCount: 0,
        maxSendRetry: settings.maxSendRetry,
        lastFailureReason: '',
        lastFailureDetail: '',
        lastSendAttemptAt: 0,
      },
    };
  }

  function ensureListModeRun() {
    const deps = getDeps();
    if (!deps || !deps.state) {
      return null;
    }
    if (!deps.state.listModeRun || typeof deps.state.listModeRun !== 'object') {
      deps.state.listModeRun = {
        tasks: [],
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

  function syncListModeTasksFromQueue() {
    const deps = getDeps();
    const run = ensureListModeRun();
    if (!deps || !run) {
      return;
    }
    const queue = Array.isArray(deps.state.queue) ? deps.state.queue : [];
    const prevTasks = Array.isArray(run.tasks) ? run.tasks : [];
    run.tasks = queue.map((text, index) => {
      const prev = prevTasks[index];
      if (prev && String(prev.text) === String(text)) {
        return prev;
      }
      return createListTaskItem(index, text);
    });
  }

  function getCurrentListTask() {
    const deps = getDeps();
    const run = ensureListModeRun();
    if (!deps || !run) {
      return null;
    }
    syncListModeTasksFromQueue();
    const idx = Math.max(0, Number(deps.state.idx) || 0);
    return run.tasks[idx] || null;
  }

  function ensureTaskRuntime(task) {
    if (!task) {
      return null;
    }
    if (!task.runtime || typeof task.runtime !== 'object') {
      task.runtime = {
        sendRetryCount: 0,
        maxSendRetry: getListSettings().maxSendRetry,
        lastFailureReason: '',
        lastFailureDetail: '',
        lastSendAttemptAt: 0,
      };
    }
    return task.runtime;
  }

  function getListRetryDelayMs(retryCount) {
    const index = Math.max(0, Math.min(LIST_SEND_RETRY_DELAYS_MS.length - 1, retryCount - 1));
    return LIST_SEND_RETRY_DELAYS_MS[index];
  }

  function setListModeStatus(patch) {
    const run = ensureListModeRun();
    if (!run) {
      return;
    }
    Object.assign(run, patch || {});
    const deps = getDeps();
    if (deps && typeof deps.updateStatus === 'function') {
      deps.updateStatus((patch && patch.reason) ? patch.reason : 'list-mode-status');
    }
  }

  function mapReasonZh(reason) {
    if (typeof mapComposerSendReasonToChinese === 'function') {
      return mapComposerSendReasonToChinese(reason);
    }
    return String(reason || '');
  }

  async function recoverBeforeRetrySendTask(task, reason) {
    appendListLog('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY]', {
      taskId: task ? task.index : '-',
      taskTitle: task ? task.title : '-',
      reason: reason || '-',
    });

    const deps = getDeps();
    if (!deps) {
      return { ok: false, reason: 'deps-unavailable' };
    }

    try {
      if (typeof document !== 'undefined' && document.hidden) {
        appendListLog('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY]', {
          reason: 'page-hidden-wait-foreground',
        });
        await new Promise((resolve) => {
          window.setTimeout(resolve, 800);
        });
      }

      const composer = (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getComposer === 'function'
      )
        ? ComposerApi.getComposer()
        : null;

      if (composer instanceof HTMLElement) {
        if (typeof focusComposer === 'function') {
          focusComposer(composer);
        } else {
          composer.focus();
        }
      }

      const beforeText = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      if (beforeText) {
        appendListLog('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY]', {
          action: 'composer-has-text',
          textLen: beforeText.length,
        });
      }

      const promptText = String(task && task.text ? task.text : '').trim();
      if (promptText && typeof ComposerApi !== 'undefined' && typeof ComposerApi.setComposerValue === 'function') {
        const okSet = ComposerApi.setComposerValue(promptText);
        appendListLog('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY]', {
          action: 'rewrite-prompt',
          ok: okSet ? 1 : 0,
          textLen: promptText.length,
        });
        await new Promise((resolve) => {
          window.setTimeout(resolve, 400);
        });
      }

      const composerRoot = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.getComposerRoot === 'function'
        ? ComposerApi.getComposerRoot()
        : null;
      if (typeof detectRealSendButton === 'function') {
        const detected = detectRealSendButton(composerRoot);
        appendListLog('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY]', {
          action: 'recheck-send-button',
          found: detected.found ? 1 : 0,
          reason: detected.reason || '-',
        });
      }

      return { ok: true, reason: 'recovered' };
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][RECOVER_BEFORE_RETRY][ERROR]', error, {
        taskId: task && task.index,
        reason,
      });
      return { ok: false, reason: 'recover-failed', detail: error && error.message ? error.message : String(error) };
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
      appendListLog('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FAILED]', { reason: 'composer-not-found' });
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
        appendListLog('[AUTOQ][LIST_MODE][KEYBOARD_SEND_OK]', {
          taskIndex: task ? task.index + 1 : '-',
          generating: generating ? 1 : 0,
        });
        return { ok: true, reason: 'sent', source: 'keyboard-fallback' };
      }

      appendListLog('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FAILED]', {
        taskIndex: task ? task.index + 1 : '-',
        reason: 'not-confirmed',
      });
      return { ok: false, reason: 'keyboard-send-not-confirmed' };
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FAILED]', error, { taskIndex: task && task.index });
      appendListLog('[AUTOQ][LIST_MODE][KEYBOARD_SEND_FAILED]', {
        reason: error && error.message ? error.message : String(error),
      });
      return { ok: false, reason: 'keyboard-send-failed' };
    }
  }

  function markCurrentListTaskFailed(context) {
    const task = context && context.task ? context.task : getCurrentListTask();
    if (!task) {
      return;
    }
    task.status = 'failed';
    task.step = String(context && context.reason ? context.reason : 'failed');
    task.failureReason = String(context && context.reason ? context.reason : '');
    task.failureDetail = String(context && context.detail ? context.detail : '');
    task.failedAt = Date.now();
    task.initialSent = false;
    task.batchSent = 0;
    appendListLog('[AUTOQ][LIST_MODE][TASK_FAILED_CONTINUE_NEXT]', {
      taskId: task.index,
      taskTitle: task.title,
      reason: task.failureReason,
      detail: task.failureDetail,
    });
  }

  function scheduleNextListTask(context) {
    const deps = getDeps();
    if (!deps || !deps.state) {
      return;
    }
    clearListModeTimer('nextTaskTimerId');
    const currentIndex = Math.max(0, Number(deps.state.idx) || 0);
    const total = Array.isArray(deps.state.queue) ? deps.state.queue.length : 0;
    appendListLog('[AUTOQ][LIST_MODE][SCHEDULE_NEXT]', {
      reason: context && context.reason ? context.reason : '-',
      currentIndex,
      nextIndex: currentIndex + 1,
      total,
    });

    const run = ensureListModeRun();
    if (run) {
      run.nextTaskTimerId = window.setTimeout(() => {
        run.nextTaskTimerId = null;
        if (!deps.state.running) {
          return;
        }
        deps.advanceAfterSend({ markReplyDone: false });
        deps.state.nextSendAt = 0;
        setListModeStatus({
          phase: 'running',
          step: 'next-task',
          displayMessage: '准备发送下一个任务',
          reason: 'schedule-next-task',
        });
        if (typeof deps.tick === 'function') {
          deps.tick();
        }
      }, 800);
    }
  }

  function scheduleRetryCurrentListTask(context) {
    const deps = getDeps();
    const task = context && context.task ? context.task : getCurrentListTask();
    if (!deps || !task) {
      return;
    }
    clearListModeTimer('retryTimerId');
    const runtime = ensureTaskRuntime(task);
    runtime.sendRetryCount += 1;
    runtime.lastFailureReason = String(context && context.reason ? context.reason : '');
    runtime.lastFailureDetail = String(context && context.detail ? context.detail : '');
    runtime.lastSendAttemptAt = Date.now();

    if (runtime.sendRetryCount > runtime.maxSendRetry) {
      console.warn('[AUTOQ][LIST_MODE][RETRY_EXHAUSTED]', {
        taskId: task.index,
        taskTitle: task.title,
        retryCount: runtime.sendRetryCount,
        reason: runtime.lastFailureReason,
        detail: runtime.lastFailureDetail,
      });
      appendListLog('[AUTOQ][LIST_MODE][RETRY_EXHAUSTED]', {
        taskId: task.index,
        retryCount: runtime.sendRetryCount,
        reason: runtime.lastFailureReason,
      });
      markCurrentListTaskFailed({
        task,
        reason: runtime.lastFailureReason,
        detail: runtime.lastFailureDetail,
      });
      const settings = getListSettings();
      if (settings.continueOnTaskFailure) {
        scheduleNextListTask({ reason: 'send-retry-exhausted-continue-next' });
      } else {
        stopListMode({ reason: runtime.lastFailureReason, detail: '重试次数已用尽' });
      }
      return;
    }

    console.warn('[AUTOQ][LIST_MODE][RETRY_CURRENT]', {
      taskId: task.index,
      taskTitle: task.title,
      retryCount: runtime.sendRetryCount,
      maxRetry: runtime.maxSendRetry,
      reason: context && context.reason,
      detail: context && context.detail,
    });
    appendListLog('[AUTOQ][LIST_MODE][RETRY_CURRENT]', {
      taskId: task.index,
      retryCount: runtime.sendRetryCount,
      maxRetry: runtime.maxSendRetry,
      reason: runtime.lastFailureReason,
    });

    const delayMs = Number(context && context.delayMs) || getListRetryDelayMs(runtime.sendRetryCount);
    setListModeStatus({
      phase: 'running',
      step: 'retry-current-send',
      displayMessage: `发送失败，正在第 ${runtime.sendRetryCount}/${runtime.maxSendRetry} 次重试`,
      reason: 'retry-current-send',
    });

    const run = ensureListModeRun();
    run.retryTimerId = window.setTimeout(() => {
      run.retryTimerId = null;
      if (!deps.state.running) {
        return;
      }
      void runCurrentListTask({ source: 'retry-current-send' });
    }, delayMs);
  }

  function stopListMode(context) {
    const deps = getDeps();
    clearListModeTimers();
    const isUserStop = context && (
      context.reason === 'manual-stop'
      || context.reason === 'user-stop'
      || String(context.detail || '').includes('手动停止')
    );
    appendListLog(isUserStop ? '[AUTOQ][LIST_MODE][STOP_BY_USER]' : '[AUTOQ][LIST_MODE][STOP_BATCH]', {
      reason: context && context.reason ? context.reason : '-',
      detail: context && context.detail ? context.detail : '-',
    });
    setListModeStatus({
      phase: 'stopped',
      step: 'stopped',
      displayMessage: context && context.detail ? context.detail : '列表模式已停止',
      reason: 'stop-batch',
    });
    if (deps && typeof deps.stop === 'function') {
      deps.stop({
        reason: context && context.reason ? context.reason : 'list-stop-batch',
        logStop: true,
        displayReason: context && context.detail ? context.detail : '',
      });
    }
  }

  function finishListMode(context) {
    appendListLog('[AUTOQ][LIST_MODE][ALL_DONE]', {
      reason: context && context.reason ? context.reason : 'all-tasks-processed',
    });
    setListModeStatus({
      phase: 'done',
      step: 'all-done',
      displayMessage: '列表任务已全部处理',
      reason: 'all-done',
    });
    const deps = getDeps();
    if (deps && typeof deps.stop === 'function') {
      deps.stop({
        reason: 'all-done',
        finalStep: 'all-done',
        logStop: true,
        displayReason: '列表任务已全部处理',
      });
    }
  }

  function handleListModeSendFailure(sendResult) {
    const deps = getDeps();
    if (!deps || !deps.state.running) {
      return;
    }
    const reason = String((sendResult && sendResult.reason) || 'unknown');
    const detail = String((sendResult && sendResult.detail) || mapReasonZh(reason));
    const classified = classifyListModeFailure(reason, detail);
    const task = getCurrentListTask();

    appendListLog('[AUTOQ][LIST_MODE][SEND_FAILED_CLASSIFIED]', {
      action: classified.action,
      reason: classified.reason,
      retryable: classified.retryable ? 1 : 0,
      taskIndex: task ? task.index + 1 : '-',
    });

    if (deps.state.batchTask && deps.state.batchTask.stopRequested) {
      stopListMode({ reason: 'manual-stop', detail: '用户已手动停止' });
      return;
    }

    if (classified.action === 'stop-batch') {
      stopListMode({ reason: classified.reason, detail: classified.display });
      return;
    }

    if (classified.action === 'retry-current') {
      scheduleRetryCurrentListTask({
        task,
        reason,
        detail,
        delayMs: getListRetryDelayMs((task && task.runtime ? task.runtime.sendRetryCount : 0) + 1),
      });
      return;
    }

    const settings = getListSettings();
    if (settings.continueOnTaskFailure) {
      markCurrentListTaskFailed({ task, reason, detail });
      scheduleNextListTask({ reason: 'current-task-failed-continue-next' });
    } else {
      stopListMode({ reason, detail: detail || '单任务失败停止' });
    }
  }

  async function runCurrentListTask(options) {
    const deps = getDeps();
    if (!deps || !deps.state || !deps.state.running) {
      return;
    }
    if (deps.state.waitingReply || deps.state.sendingNow) {
      return;
    }
    if (deps.guardAutoQueueBackgroundThrottle && deps.guardAutoQueueBackgroundThrottle('list-send')) {
      return;
    }

    const source = String(options && options.source ? options.source : 'run-current');
    const task = getCurrentListTask();
    if (!task) {
      finishListMode({ reason: 'no-current-task-all-done' });
      return;
    }

    appendListLog('[AUTOQ][LIST_MODE][RUN_CURRENT]', {
      taskIndex: task.index + 1,
      taskTitle: task.title,
      source,
    });
    appendListLog('[AUTOQ][LIST_MODE][SEND_ATTEMPT]', {
      taskIndex: task.index + 1,
      retryCount: task.runtime ? task.runtime.sendRetryCount : 0,
    });

    task.status = 'running';
    task.step = source === 'retry-current-send' ? 'retry-current-send' : 'send-current-task';
    setListModeStatus({
      phase: 'running',
      step: task.step,
      displayMessage: source === 'retry-current-send' ? '发送失败，正在重试' : '正在发送当前任务',
    });

    deps.state.sendingNow = true;
    const runId = deps.captureAutoQueueRunId();
    deps.setAutoQueuePhase('sending', 'list-send');

    const promptText = String(task.text || '').trim();
    if (!promptText) {
      deps.state.sendingNow = false;
      markCurrentListTaskFailed({ task, reason: 'empty-text', detail: '任务文本为空' });
      scheduleNextListTask({ reason: 'empty-task-continue-next' });
      return;
    }

    try {
      if (source === 'retry-current-send') {
        await recoverBeforeRetrySendTask(task, task.runtime.lastFailureReason);
      }

      let sendResult = null;
      if (typeof deps.sendTextThroughComposer === 'function') {
        sendResult = await deps.sendTextThroughComposer({
          text: promptText,
          source: 'autoq-list-mode',
          mode: 'list',
          taskId: String(task.index),
          taskTitle: task.title,
          requireTextWritten: true,
          waitButtonTimeoutMs: getListSettings().sendButtonWaitTimeoutMs,
          shouldStop: () => !deps.state.running || !deps.state.sendingNow,
          waitForReplyIdle: true,
        });
      } else if (typeof deps.sendContentViaComposer === 'function') {
        sendResult = await deps.sendContentViaComposer({
          source: 'autoq-list-mode',
          content: promptText,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: getListSettings().sendButtonWaitTimeoutMs,
          blockWhenResponding: true,
        });
      } else {
        sendResult = { ok: false, reason: 'send-unavailable', detail: '发送服务不可用' };
      }

      if ((!sendResult || sendResult.ok !== true) && getListSettings().enableKeyboardSendFallback) {
        const failReason = String((sendResult && sendResult.reason) || '');
        if (failReason === 'send-button-not-found' || failReason === 'send_button_not_found') {
          const kbResult = await tryKeyboardSendFallback(task, promptText);
          if (kbResult && kbResult.ok === true) {
            sendResult = kbResult;
          }
        }
      }

      if (deps.isStaleAutoQueueRun(runId, 'list-send')) {
        return;
      }

      if (!sendResult || sendResult.ok !== true) {
        handleListModeSendFailure(sendResult || { ok: false, reason: 'unknown' });
        return;
      }

      task.initialSent = true;
      task.batchSent = 1;
      task.status = 'waiting-reply';
      task.step = 'waiting-reply';
      task.sentAt = Date.now();
      task.runtime.sendRetryCount = 0;
      appendListLog('[AUTOQ][LIST_MODE][TASK_SENT_OK]', {
        taskIndex: task.index + 1,
        taskTitle: task.title,
        initialSent: 1,
        batchSent: 1,
      });

      deps.state.sentCount = Math.max(0, Number(deps.state.sentCount) || 0) + 1;
      deps.state.waitingReply = true;
      deps.setAutoQueuePhase(deps.AUTO_QUEUE_PHASES.WAITING_REPLY, 'await-assistant');
      deps.state.replyBecameBusy = false;
      deps.state.idleSince = 0;
      deps.state.waitingStartedAt = Date.now();
      if (typeof deps.startListModeWaitReplyTracking === 'function') {
        deps.startListModeWaitReplyTracking('list-send-accepted');
      }
      if (typeof deps.saveWaitingReplyContext === 'function') {
        deps.saveWaitingReplyContext('list-send-accepted-enter-waiting-reply');
      }
      setListModeStatus({
        phase: 'running',
        step: 'waiting-reply',
        displayMessage: '等待 ChatGPT 回复',
      });
      deps.log(`已发送：${promptText.slice(0, 80)} reason=${sendResult.reason || '-'}`);
      deps.updateStatus('list-task-sent');
      if (typeof deps.updateChatInputStateBadge === 'function') {
        deps.updateChatInputStateBadge();
      }
    } catch (error) {
      console.error('[AUTOQ][LIST_MODE][SEND_ERROR]', error, {
        taskIndex: task.index,
        source,
      });
      handleListModeSendFailure({
        ok: false,
        reason: 'send_exception',
        detail: error && error.message ? error.message : String(error),
      });
    } finally {
      deps.state.sendingNow = false;
    }
  }

  function onListTaskReplyDone(reason) {
    const task = getCurrentListTask();
    if (task) {
      task.status = 'done';
      task.step = 'done';
      task.doneAt = Date.now();
      appendListLog('[AUTOQ][LIST_MODE][TASK_REPLY_DONE]', {
        taskIndex: task.index + 1,
        reason: reason || '-',
      });
      appendListLog('[AUTOQ][LIST_MODE][TASK_DONE]', {
        taskIndex: task.index + 1,
        taskTitle: task.title,
      });
    }
    appendListLog('[AUTOQ][LIST_MODE][NEXT_TASK]', {
      currentIndex: task ? task.index : '-',
      nextIndex: task ? task.index + 1 : '-',
    });
  }

  function getListModeProgressSnapshot() {
    const deps = getDeps();
    const run = ensureListModeRun();
    if (!deps || !run) {
      return null;
    }
    syncListModeTasksFromQueue();
    const total = run.tasks.length;
    const currentIndex = Math.max(0, Number(deps.state.idx) || 0);
    const doneCount = run.tasks.filter((t) => t.status === 'done' || t.status === 'failed').length;
    const currentTask = run.tasks[currentIndex] || null;
    return {
      total,
      currentIndex: currentIndex + 1,
      doneCount,
      taskProgress: total > 0 ? `${currentIndex + 1}/${total}（已完成 ${doneCount}）` : '-',
      step: run.step || (currentTask ? currentTask.step : 'idle'),
      displayMessage: run.displayMessage || '',
      currentTaskTitle: currentTask ? currentTask.title : '-',
      currentTaskStatus: currentTask ? currentTask.status : '-',
      initialSent: currentTask ? (currentTask.initialSent ? 1 : 0) : 0,
      batchSent: currentTask ? Number(currentTask.batchSent) || 0 : 0,
    };
  }

  function initListModeStart() {
    clearListModeTimers();
    syncListModeTasksFromQueue();
    setListModeStatus({
      phase: 'running',
      step: 'list-running',
      displayMessage: '列表模式运行中',
      reason: 'list-start',
    });
    appendListLog('[AUTOQ][LIST_MODE][START]', {
      total: Array.isArray(getDeps().state.queue) ? getDeps().state.queue.length : 0,
    });
  }

  globalThis.ListModeRunner = {
    init(deps) {
      globalThis.__CGPT_LIST_MODE_DEPS__ = deps;
    },
    classifyListModeFailure,
    ensureListModeRun,
    syncListModeTasksFromQueue,
    getCurrentListTask,
    runCurrentListTask,
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
