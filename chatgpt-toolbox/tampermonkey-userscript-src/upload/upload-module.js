  /********************************************************************
   * 3. UploadModule：多文件上传模块
   ********************************************************************/

  const UploadModule = (() => {
    const DEFAULT_UPLOAD_GROUP_NAME = '默认组';
    const UPLOAD_PROJECT_NAME_KEY_MAP = Object.freeze({
      '浏览器': 'browser',
      '闲鱼': 'xianyu',
      '油猴flask': 'youhou-flask',
      '油猴上传': 'youhou-upload',
      'cursor插件': 'cursor-plugin',
    });
    const UPLOAD_DB_MAX_GROUPS = 50;
    const UPLOAD_DB_MAX_QUEUE_ROWS = 1000;
    const UPLOAD_DB_EMPTY_GROUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const UPLOAD_DB_FAILED_ROW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const SEND_STABLE_RETRY_LIMIT = 30;
    const SEND_STABLE_RETRY_INTERVAL_MS = 300;
    const SEND_WAIT_TIMEOUT_MS = 60 * 1000;
    const PRE_SEND_OPPORTUNITY_POLL_MS = 1000;
    const COPY_CONTINUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
    const COPY_CONTINUE_STABLE_ROUNDS = 3;
    const COPY_CONTINUE_STABLE_INTERVAL_MS = 350;
    /** 点击常用 Prompt 后是否自动发送（false 时仅填入输入框）。 */
    const QUICK_PROMPT_CLICK_AUTO_SEND = true;

    const UPLOAD_DROP_HANDLED_PROP = '__cgptToolboxUploadDropHandledV1';
    let lastDropSignature = '';
    let lastDropSignatureAt = 0;

    const state = {
      groups: [],
      activeGroupId: '',
      selectedFileIdByGroup: {},
      queue: [],
      groupCounts: null,
      flaskFiles: [],
      running: false,
      cancelled: false,
      activeId: '',
      observer: null,
      uploadAbortController: null,
      uploadCancelRequested: false,
      runId: 0,
      waitingSend: false,
      autoSendWaiting: false,
      waitingRealSendButton: false,
      autoSendRunId: 0,
      autoSendStartedAt: 0,
      autoSendLastStatusAt: 0,
      autoSendLastLogAt: 0,
      cancelWaitingSend: false,
      waitingSendTimer: null,
      waitingSendInterval: null,
      waitingSendAbortController: null,
      waitingReply: false,
      waitingReplyRunId: null,
      waitingReplyCheckedAt: 0,
      waitingReplyTimer: null,
      pendingSendAfterReply: false,
      pendingSendAfterReplySource: '',
      pendingSendRetrying: false,
      replyWaitSawBusy: false,
      replyWaitAssistantCountBefore: 0,
      uploadSendFailureHint: '',
      uploadSendFailureHintAt: 0,
      uploadSendSuccessHint: '',
      uploadSendSuccessHintAt: 0,
      messageSending: false,
      messageSendCancelRequested: false,
      uploadTask: {
        phase: 'idle',
        runId: '',
        activeId: '',
        cancelRequested: false,
        abortController: null,
      },
      sendTask: {
        phase: 'idle',
        runId: '',
        cancelRequested: false,
        abortController: null,
      },
      copyTask: {
        phase: 'idle',
        source: '',
        runId: '',
      },
      copyContinueTask: {
        phase: 'idle',
        runId: '',
        cancelRequested: false,
        stopRequested: false,
        abortController: null,
      },
      sendHotkeyTask: {
        phase: 'idle',
        runId: '',
        lastError: null,
      },
      copyHotkeyContinueTask: {
        phase: 'idle',
        runId: '',
        cancelRequested: false,
        abortController: null,
        startedAt: 0,
        lastError: null,
      },
      copyHotkeyContinueLoopTask: {
        phase: 'idle',
        runId: '',
        stopRequested: false,
        cycleIndex: 0,
        startedAt: 0,
        lastError: null,
        currentSubtask: '',
      },
      copyHotkeyUploadVerifyLoopTask: {
        phase: 'idle',
        runId: '',
        stopRequested: false,
        cycleIndex: 0,
        startedAt: 0,
        lastError: null,
        currentSubtask: '',
      },
      homeTask: {
        phase: 'idle',
        runId: '',
        lastError: null,
      },
    };

    let host = null;
    let listEl = null;
    let groupListEl = null;
    let startBtn = null;
    let rootElRef = null;
    let panelDropEl = null;
    let dbPromise = null;
    let managePanelEl = null;
    let manageGroupListEl = null;
    let groupNameInputEl = null;
    let lastGroupNameInputValue = '';
    let clearConfirmUntil = 0;
    let deleteConfirmUntil = 0;
    let persistQueuePromise = Promise.resolve();
    let uploadModuleInitPromise = Promise.resolve();
    let uploadGroupsInitResolved = false;
    const uploadTimers = createTimerRegistry('UPLOAD');
    let quickPromptRenderSignature = '';
    let persistQueueThrottleTimer = 0;
    let persistQueuePendingStage = '';
    let uploadSendShortcutBound = false;
    let uploadSendShortcutLastAt = 0;
    let lastUploadSendShortcutEventKey = '';
    let lastUploadSendShortcutEventAt = 0;
    let enterSendDispatchInFlight = false;
    let enterSendDispatchLastAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let uploadSendShortcutRunning = false;
    let uploadSendTaskStartedAt = 0;
    let lastWaitRealSendButtonLogAt = 0;
    const WAIT_REAL_SEND_BUTTON_POLL_MS = 400;
    const WAIT_REAL_SEND_BUTTON_LOG_INTERVAL_MS = 2000;
    let waitingReplyIdleStreak = 0;
    let uploadShortcutDebugLastAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let copyLastMessageTaskRunning = false;
    let copyLastMessageTaskSource = '';
    let copyLastMessageTaskStartedAt = 0;
    let copyLastMessageTaskStatus = '';
    // deprecated: only used for compatibility, do not use as render source
    let copyLastReplyTaskRunning = false;
    let copyLastReplyTaskStartedAt = 0;
    let copyLastReplyTaskStatus = '';
    let copyLastMessageWaiting = false;
    let copyLastMessageWaitRunId = 0;
    let copyLastButtonResetTimer = 0;
    let copyContinueTaskRunning = false;
    let copyTaskStatus = 'idle';
    let copyContinueTaskStartedAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyOnceTaskRunning = false;
    let copyHotkeyOnceTaskStartedAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyContinueTaskRunning = false;
    let copyHotkeyContinueTaskStartedAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyContinueLoopRunning = false;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyContinueLoopStopRequested = false;
    let copyHotkeyContinueLoopCount = 0;
    let copyHotkeyContinueLoopStartedAt = 0;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyUploadVerifyLoopRunning = false;
    // deprecated: only used for compatibility, do not use as render source
    let copyHotkeyUploadVerifyLoopStopRequested = false;
    let copyHotkeyUploadVerifyLoopCount = 0;
    let copyHotkeyUploadVerifyLoopStartedAt = 0;
    const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
    let uploadUiActionLastKey = '';
    let uploadUiActionLastAt = 0;

    /**
     * 上传区域动作级防抖记录。
     *
     * 用途：
     * 1. 防止 delegated-click、mousedown、pointerdown 等事件重复触发同一个上传动作。
     * 2. 防止开始上传、发送、自动继续等按钮在极短时间内重复进入流程。
     * 3. 必须定义在 UploadModule 闭包内，否则 shouldSkipAction() 会抛 ReferenceError。
     */
    const uploadActionDebounceMap = new Map();

    let quickPromptActiveCategory = typeof PromptCategoryState !== 'undefined'
      && typeof PromptCategoryState.getActiveCategory === 'function'
      ? PromptCategoryState.getActiveCategory()
      : '全部';
    let lastManualUploadGroupAt = 0;
    const uploadActionLocks = Object.create(null);

    const COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES = new Set([
      'waiting_reply',
      'copying',
      'sending_hotkey',
      'sending_continue',
    ]);

    const COPY_HOTKEY_LOOP_STOP_PHASES = new Set([
      'running',
      'waiting_reply',
      'copying',
      'sending_hotkey',
      'sending_continue',
      'waiting_next_reply',
      'auto_uploading',
      'home_navigation',
    ]);

    const COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES = new Set([
      'running',
      'waiting_reply',
      'copying',
      'sending_hotkey',
      'sending_continue',
      'waiting_next_reply',
      'auto_uploading',
    ]);

    function createUploadTaskRunId(prefix = 'task') {
      if (typeof ButtonTasks !== 'undefined' && typeof ButtonTasks.createTaskRunId === 'function') {
        return ButtonTasks.createTaskRunId(prefix);
      }
      return `${String(prefix || 'task')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function ensureSendHotkeyTask() {
      if (!state.sendHotkeyTask || typeof state.sendHotkeyTask !== 'object') {
        state.sendHotkeyTask = { phase: 'idle', runId: '', lastError: null };
      }
      return state.sendHotkeyTask;
    }

    function setSendHotkeyPhase(phase, reason = '') {
      const task = ensureSendHotkeyTask();
      const normalized = String(phase || 'idle').trim().toLowerCase();
      task.phase = normalized;
      if (reason) {
        task.lastReason = String(reason);
      }
      scheduleRenderUpload(`sendHotkey:${normalized}:${reason || '-'}`);
    }

    async function runSendHotkeyOnce(source = 'unknown') {
      const src = String(source || 'unknown').trim() || 'unknown';
      const task = ensureSendHotkeyTask();

      if (task.phase === 'sending_hotkey') {
        ToolboxShell.appendLog(`[SEND_HOTKEY][skip] source=${src} reason=already-running runId=${task.runId || '-'}`);
        return { ok: false, reason: 'already-running' };
      }

      const runId = createUploadTaskRunId('send_hotkey');
      task.runId = runId;
      task.lastError = null;
      setSendHotkeyPhase('sending_hotkey', src);

      try {
        const ok = await triggerSendHotkeyOnce();
        if (task.runId !== runId) {
          return { ok: false, reason: 'stale-run' };
        }
        if (ok) {
          setSendHotkeyPhase('success', src);
          window.setTimeout(() => {
            if (state.sendHotkeyTask && state.sendHotkeyTask.runId === runId) {
              state.sendHotkeyTask.runId = '';
              setSendHotkeyPhase('idle', 'success-reset');
            }
          }, 1200);
          return { ok: true, reason: 'ok' };
        }

        task.lastError = 'hotkey-failed';
        setSendHotkeyPhase('failed', src);
        window.setTimeout(() => {
          if (state.sendHotkeyTask && state.sendHotkeyTask.runId === runId) {
            state.sendHotkeyTask.runId = '';
            setSendHotkeyPhase('idle', 'failed-reset');
          }
        }, 1500);
        return { ok: false, reason: 'hotkey-failed' };
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[SEND_HOTKEY][FAILED]', {
          source: src,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        if (task.runId === runId) {
          task.lastError = errText;
          setSendHotkeyPhase('failed', src);
          window.setTimeout(() => {
            if (state.sendHotkeyTask && state.sendHotkeyTask.runId === runId) {
              state.sendHotkeyTask.runId = '';
              setSendHotkeyPhase('idle', 'failed-reset');
            }
          }, 1500);
        }
        ToolboxShell.appendLog(`[SEND_HOTKEY][FAILED] source=${src} error=${errText}`);
        setStatus(`发送 Ctrl+Alt+I 失败：${errText}`, 'error');
        return { ok: false, reason: 'exception', detail: errText };
      }
    }

    function ensureHomeTask() {
      if (!state.homeTask || typeof state.homeTask !== 'object') {
        state.homeTask = { phase: 'idle', runId: '', lastError: null };
      }
      return state.homeTask;
    }

    function setHomePhase(phase, reason = '') {
      const task = ensureHomeTask();
      let normalized = String(phase || 'idle').trim().toLowerCase();
      if (normalized === 'jumping') {
        normalized = 'running';
      }
      task.phase = normalized;
      if (reason) {
        task.lastReason = String(reason);
      }
      scheduleRenderUpload(`home:${normalized}:${reason || '-'}`);
    }

    async function runGoHomeOnce(source = 'unknown') {
      const src = String(source || 'unknown').trim() || 'unknown';
      const task = ensureHomeTask();

      if (task.phase === 'running') {
        ToolboxShell.appendLog(`[HOME][skip] source=${src} reason=already-running runId=${task.runId || '-'}`);
        return { ok: false, reason: 'already-running' };
      }

      const runId = createUploadTaskRunId('home');
      task.runId = runId;
      task.lastError = null;
      setHomePhase('running', src);

      try {
        const result = await goHomeByClickNewChat(src);
        if (task.runId !== runId) {
          return result;
        }
        if (result && result.ok) {
          setHomePhase('success', src);
          window.setTimeout(() => {
            if (state.homeTask && state.homeTask.runId === runId) {
              state.homeTask.runId = '';
              setHomePhase('idle', 'success-reset');
            }
          }, 1200);
        } else {
          task.lastError = result && result.reason ? String(result.reason) : 'failed';
          setHomePhase('failed', src);
          window.setTimeout(() => {
            if (state.homeTask && state.homeTask.runId === runId) {
              state.homeTask.runId = '';
              setHomePhase('idle', 'failed-reset');
            }
          }, 1500);
        }
        return result;
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[HOME][FAILED]', { source: src, error: errText, stack: error && error.stack });
        if (task.runId === runId) {
          task.lastError = errText;
          setHomePhase('failed', src);
          window.setTimeout(() => {
            if (state.homeTask && state.homeTask.runId === runId) {
              state.homeTask.runId = '';
              setHomePhase('idle', 'failed-reset');
            }
          }, 1500);
        }
        ToolboxShell.appendLog(`[HOME][FAILED] source=${src} error=${errText}`);
        setStatus(`回到首页失败：${errText}`, 'error');
        return { ok: false, reason: 'exception', detail: errText };
      } finally {
        scheduleRenderUpload(`jump-home:${src}`);
      }
    }

    async function runJumpHome(source = 'unknown') {
      const src = String(source || 'unknown').trim() || 'unknown';
      ToolboxShell.appendLog(`[HOME][RUN] source=${src}`);
      try {
        return await runGoHomeOnce(src);
      } catch (error) {
        console.error('[UPLOAD_UI_ACTION][jump-home:failed]', error);
        throw error;
      }
    }

    async function runAutoContinueOnce(source = 'unknown') {
      const src = String(source || 'unknown').trim() || 'unknown';

      if (
        !AutoQueueModule
        || typeof AutoQueueModule.toggleContinueLoopFromUpload !== 'function'
      ) {
        console.error('[UPLOAD_AUTO_CONTINUE][toggle-failed]', { reason: 'module-unavailable' });
        refreshUploadAutoContinueButton('toggle-unavailable');
        setStatus('自动继续模块不可用', 'warn');
        return { ok: false, reason: 'auto-continue-unavailable' };
      }

      const actionLock = claimUploadActionLock('auto-continue', { timeoutMs: 120000 });
      if (!actionLock.ok) {
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE][skip] source=${src} reason=${actionLock.reason} runningMs=${actionLock.runningMs || 0}`,
        );
        return { ok: false, reason: actionLock.reason || 'task-running' };
      }

      try {
        const result = AutoQueueModule.toggleContinueLoopFromUpload(
          src === 'delegated-click' ? 'upload-button' : src,
        );
        refreshUploadAutoContinueButton('click-toggle');

        const autoState = typeof AutoQueueModule.getState === 'function'
          ? AutoQueueModule.getState()
          : null;
        const view = getAutoContinueButtonView(autoState);
        const active = view.phase === 'running' || view.phase === 'waiting_reply';

        ToolboxShell.setStatus(
          active ? '自动继续已开启' : '自动继续已停止',
          active ? 'success' : 'warn',
        );

        return result;
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[UPLOAD_AUTO_CONTINUE][toggle-failed]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[UPLOAD_AUTO_CONTINUE][toggle-failed] error=${errText}`);
        refreshUploadAutoContinueButton('toggle-exception');
        setStatus(`自动继续失败：${errText}`, 'error');
        return { ok: false, reason: 'exception', detail: errText };
      } finally {
        releaseUploadActionLock('auto-continue');
        scheduleRenderUpload(`auto-continue:done:${src}`);
      }
    }

    async function runAutoContinueUntilDone(source = 'unknown') {
      const src = String(source || 'unknown').trim() || 'unknown';

      if (
        typeof AutoQueueModule === 'undefined'
        || !AutoQueueModule
        || typeof AutoQueueModule.startContinueUntilDoneFromUpload !== 'function'
      ) {
        console.error('[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-failed]', { reason: 'module-unavailable' });
        setStatus('自动继续直到完成模块不可用', 'warn');
        ToolboxShell.appendLog('[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-failed] reason=module-unavailable');
        return { ok: false, reason: 'auto-continue-until-done-unavailable' };
      }

      const actionLock = claimUploadActionLock('auto-continue-until-done', { timeoutMs: 120000 });
      if (!actionLock.ok) {
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][skip] source=${src} reason=${actionLock.reason} runningMs=${actionLock.runningMs || 0}`,
        );
        return { ok: false, reason: actionLock.reason || 'task-running' };
      }

      try {
        const result = AutoQueueModule.startContinueUntilDoneFromUpload(
          src === 'delegated-click' ? 'upload-until-done-button' : src,
        );

        refreshUploadAutoContinueButton('until-done-toggle');

        const untilDoneBtn = resolveAutoContinueUntilDoneButton(rootElRef);
        if (untilDoneBtn) {
          applyAutoContinueUntilDoneButtonState(untilDoneBtn, {
            reason: 'until-done-toggle',
          });
        }

        return result;
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-failed]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-failed] error=${errText}`);
        setStatus(`自动继续直到完成失败：${errText}`, 'error');
        return { ok: false, reason: 'exception', detail: errText };
      } finally {
        releaseUploadActionLock('auto-continue-until-done');
        scheduleRenderUpload(`auto-continue-until-done:done:${src}`);
      }
    }

    function logTaskSourceConsistency(taskName, phase, runningFlag, active, reason = '') {
      ToolboxShell.appendLog(
        `[BUTTON_STATE][TASK_SOURCE] task=${taskName} phase=${phase || '-'} runningFlag=${runningFlag ? 1 : 0}`
        + ` active=${active ? 1 : 0} reason=${reason || '-'}`,
      );
    }

    function isCopyHotkeyTaskPhaseActive(phase) {
      const normalized = String(phase || 'idle').trim().toLowerCase();
      return normalized !== 'idle'
        && normalized !== 'success'
        && normalized !== 'failed'
        && normalized !== 'cancelled';
    }

    function isCopyHotkeyLoopTaskPhaseActive(phase) {
      const normalized = String(phase || 'idle').trim().toLowerCase();
      return normalized !== 'idle'
        && normalized !== 'stopped'
        && normalized !== 'success'
        && normalized !== 'failed'
        && normalized !== 'cancelled';
    }

    function ensureCopyHotkeyOnceTask() {
      if (!state.copyHotkeyOnceTask || typeof state.copyHotkeyOnceTask !== 'object') {
        state.copyHotkeyOnceTask = {
          phase: 'idle',
          runId: '',
          cancelRequested: false,
          startedAt: 0,
          lastError: null,
        };
      }
      return state.copyHotkeyOnceTask;
    }

    function setCopyHotkeyOncePhase(phase, reason = '') {
      const task = ensureCopyHotkeyOnceTask();
      const normalized = String(phase || 'idle').trim().toLowerCase();
      task.phase = normalized;

      const activePhases = new Set([
        'waiting_reply',
        'copying',
        'confirming_clipboard',
        'sending_hotkey',
      ]);
      copyHotkeyOnceTaskRunning = activePhases.has(normalized);
      if (copyHotkeyOnceTaskRunning && !task.startedAt) {
        task.startedAt = Date.now();
        copyHotkeyOnceTaskStartedAt = task.startedAt;
      }
      if (!copyHotkeyOnceTaskRunning) {
        task.startedAt = 0;
        copyHotkeyOnceTaskStartedAt = 0;
      }

      if (reason) {
        task.lastReason = String(reason);
      }

      logTaskSourceConsistency(
        'copyHotkeyOnce',
        normalized,
        copyHotkeyOnceTaskRunning,
        isCopyHotkeyOnceActive(),
        reason,
      );
      scheduleRenderUpload(`copyHotkeyOnce:${normalized}:${reason || '-'}`);
    }

    function isCopyHotkeyOnceActive() {
      const task = ensureCopyHotkeyOnceTask();
      const fromPhase = isCopyHotkeyTaskPhaseActive(task.phase);
      if (fromPhase !== !!copyHotkeyOnceTaskRunning) {
        copyHotkeyOnceTaskRunning = fromPhase;
      }
      return fromPhase;
    }

    function isCopyHotkeyContinueActive() {
      const task = ensureCopyHotkeyContinueTask();
      const fromPhase = isCopyHotkeyTaskPhaseActive(task.phase)
        || task.phase === 'cancelling';
      if (fromPhase !== !!copyHotkeyContinueTaskRunning) {
        copyHotkeyContinueTaskRunning = fromPhase;
      }
      return fromPhase;
    }

    function isCopyHotkeyLoopActive() {
      const task = ensureCopyHotkeyContinueLoopTask();
      const fromPhase = isCopyHotkeyLoopTaskPhaseActive(task.phase);
      if (fromPhase !== !!copyHotkeyContinueLoopRunning) {
        copyHotkeyContinueLoopRunning = fromPhase;
      }
      return fromPhase;
    }

    function isCopyHotkeyUploadVerifyLoopActive() {
      const task = ensureCopyHotkeyUploadVerifyLoopTask();
      const fromPhase = isCopyHotkeyLoopTaskPhaseActive(task.phase);
      if (fromPhase !== !!copyHotkeyUploadVerifyLoopRunning) {
        copyHotkeyUploadVerifyLoopRunning = fromPhase;
      }
      return fromPhase;
    }

    function ensureCopyHotkeyContinueTask() {
      if (!state.copyHotkeyContinueTask || typeof state.copyHotkeyContinueTask !== 'object') {
        state.copyHotkeyContinueTask = {
          phase: 'idle',
          runId: '',
          cancelRequested: false,
          abortController: null,
          startedAt: 0,
          lastError: null,
        };
      }
      return state.copyHotkeyContinueTask;
    }

    function isCopyHotkeyContinueCancelled(runId = '') {
      const task = ensureCopyHotkeyContinueTask();
      const expectedRunId = String(runId || '').trim();
      if (expectedRunId && task.runId && task.runId !== expectedRunId) {
        return true;
      }
      return !!(
        task.cancelRequested
        || task.phase === 'cancelling'
        || task.phase === 'cancelled'
      );
    }

    function setCopyHotkeyContinuePhase(phase, reason = '') {
      const task = ensureCopyHotkeyContinueTask();
      const normalized = String(phase || 'idle').trim().toLowerCase();
      task.phase = normalized;

      const activePhases = new Set([
        'waiting_reply',
        'copying',
        'sending_hotkey',
        'sending_continue',
        'cancelling',
      ]);
      copyHotkeyContinueTaskRunning = activePhases.has(normalized);
      if (copyHotkeyContinueTaskRunning && !task.startedAt) {
        task.startedAt = Date.now();
        copyHotkeyContinueTaskStartedAt = task.startedAt;
      }
      if (!copyHotkeyContinueTaskRunning) {
        task.startedAt = 0;
        copyHotkeyContinueTaskStartedAt = 0;
      }

      if (reason) {
        task.lastReason = String(reason);
      }

      logTaskSourceConsistency(
        'copyHotkeyContinue',
        normalized,
        copyHotkeyContinueTaskRunning,
        isCopyHotkeyContinueActive(),
        reason,
      );
      scheduleRenderUpload(`copyHotkeyContinue:${normalized}:${reason || '-'}`);
    }

    function cancelCopyHotkeyContinue(source = 'unknown') {
      const task = ensureCopyHotkeyContinueTask();
      const src = String(source || 'unknown').trim() || 'unknown';

      if (task.phase === 'idle' || task.phase === 'cancelling') {
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][cancel-ignore] source=${src} phase=${task.phase}`);
        return false;
      }

      if (!COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES.has(task.phase)) {
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][cancel-ignore] source=${src} phase=${task.phase}`);
        return false;
      }

      task.cancelRequested = true;
      if (task.abortController && typeof task.abortController.abort === 'function') {
        task.abortController.abort();
      }
      setCopyHotkeyContinuePhase('cancelling', src);
      ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][cancel] source=${src} runId=${task.runId || '-'}`);
      return true;
    }

    function finishCopyHotkeyContinueTask(outcome, runId, source = '') {
      const task = ensureCopyHotkeyContinueTask();
      if (runId && task.runId && task.runId !== runId) {
        return;
      }

      task.abortController = null;
      task.cancelRequested = false;

      const normalized = String(outcome || 'idle').trim().toLowerCase();
      setCopyHotkeyContinuePhase(normalized, source || outcome);

      releaseUploadActionLock('copy-hotkey-continue');

      const resetMs = normalized === 'cancelled'
        ? 400
        : (normalized === 'success' ? 1200 : 1500);
      window.setTimeout(() => {
        if (!runId || (state.copyHotkeyContinueTask && state.copyHotkeyContinueTask.runId === runId)) {
          if (state.copyHotkeyContinueTask) {
            state.copyHotkeyContinueTask.runId = '';
          }
          setCopyHotkeyContinuePhase('idle', 'auto-reset');
        }
      }, resetMs);
    }

    async function runCopyHotkeyContinueOnce(source = 'button') {
      const src = String(source || 'button').trim() || 'button';

      if (isCopyHotkeyLoopActive() || isCopyHotkeyUploadVerifyLoopActive()) {
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][skip] source=${src} reason=loop-running`);
        return {
          ok: false,
          reason: 'loop-running',
        };
      }

      const task = ensureCopyHotkeyContinueTask();
      if (COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES.has(task.phase) || task.phase === 'cancelling') {
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][skip] source=${src} reason=task-running phase=${task.phase}`);
        return {
          ok: false,
          reason: 'task-running',
        };
      }

      const runId = createUploadTaskRunId('copy_hotkey_continue');
      task.runId = runId;
      task.cancelRequested = false;
      task.lastError = null;
      task.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      task.startedAt = Date.now();
      copyHotkeyContinueTaskStartedAt = task.startedAt;

      const shouldStop = () => isCopyHotkeyContinueCancelled(runId);

      setCopyHotkeyContinuePhase('waiting_reply', src);

      try {
        const result = await copyHotkeyAndContinueOnce(src, {
          shouldStop,
          runId,
          managedPhase: true,
        });

        if (task.runId !== runId) {
          return result;
        }

        if (isCopyHotkeyContinueCancelled(runId) || (result && result.reason === 'cancelled')) {
          finishCopyHotkeyContinueTask('cancelled', runId, src);
          return result || { ok: false, reason: 'cancelled' };
        }

        if (result && result.ok) {
          finishCopyHotkeyContinueTask('success', runId, src);
        } else {
          task.lastError = result && (result.detail || result.reason)
            ? String(result.detail || result.reason)
            : 'failed';
          finishCopyHotkeyContinueTask('failed', runId, src);
        }

        return result;
      } catch (error) {
        const errText = formatToolboxError(error);
        if (task.runId === runId) {
          task.lastError = errText;
          finishCopyHotkeyContinueTask('failed', runId, src);
        }
        throw error;
      }
    }

    function ensureCopyHotkeyContinueLoopTask() {
      if (!state.copyHotkeyContinueLoopTask || typeof state.copyHotkeyContinueLoopTask !== 'object') {
        state.copyHotkeyContinueLoopTask = {
          phase: 'idle',
          runId: '',
          stopRequested: false,
          cycleIndex: 0,
          startedAt: 0,
          lastError: null,
          currentSubtask: '',
        };
      }
      return state.copyHotkeyContinueLoopTask;
    }

    function setCopyHotkeyContinueLoopPhase(phase, reason = '', options = {}) {
      const task = ensureCopyHotkeyContinueLoopTask();
      const normalized = String(phase || 'idle').trim().toLowerCase();
      task.phase = normalized;

      if (options.cycleIndex != null) {
        task.cycleIndex = Number(options.cycleIndex) || 0;
        copyHotkeyContinueLoopCount = task.cycleIndex;
      }

      if (options.currentSubtask != null) {
        task.currentSubtask = String(options.currentSubtask || '');
      }

      const loopActive = !['idle', 'success', 'failed', 'stopped'].includes(normalized);
      copyHotkeyContinueLoopRunning = loopActive;
      copyHotkeyContinueLoopStopRequested = !!(
        task.stopRequested
        || normalized === 'stopping'
      );

      if (reason) {
        task.lastReason = String(reason);
      }

      logTaskSourceConsistency(
        'copyHotkeyContinueLoop',
        normalized,
        copyHotkeyContinueLoopRunning,
        isCopyHotkeyLoopActive(),
        reason,
      );
      scheduleRenderUpload(`copyHotkeyLoop:${normalized}:${reason || '-'}`);
    }

    function requestCopyHotkeyContinueLoopStop(source = 'unknown') {
      const task = ensureCopyHotkeyContinueLoopTask();
      const src = String(source || 'unknown').trim() || 'unknown';

      if (!COPY_HOTKEY_LOOP_STOP_PHASES.has(task.phase) && !copyHotkeyContinueLoopRunning) {
        return false;
      }

      task.stopRequested = true;
      copyHotkeyContinueLoopStopRequested = true;
      if (task.abortController && typeof task.abortController.abort === 'function') {
        task.abortController.abort();
      }
      setCopyHotkeyContinueLoopPhase('stopping', src);
      setStatus('停止请求已提交，等待任务退出...', 'warn');
      ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE_LOOP][stop-requested] source=${src}`);
      return true;
    }

    async function runCopyHotkeyContinueLoop(source = 'button') {
      const src = String(source || 'button').trim() || 'button';
      const loopTask = ensureCopyHotkeyContinueLoopTask();

      if (COPY_HOTKEY_LOOP_STOP_PHASES.has(loopTask.phase) || copyHotkeyContinueLoopRunning) {
        return requestCopyHotkeyContinueLoopStop(src);
      }

      if (loopTask.phase === 'stopping') {
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE_LOOP][click-ignore] source=${src} phase=stopping`);
        return false;
      }

      const actionLock = claimUploadActionLock('copy-hotkey-continue-loop', { timeoutMs: 600000 });
      if (!actionLock.ok) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][skip] source=${src} reason=${actionLock.reason} runningMs=${actionLock.runningMs || 0}`,
        );
        return false;
      }

      try {
        return await toggleCopyHotkeyContinueLoop(src);
      } catch (err) {
        const errText = formatToolboxError(err);
        console.error('[ChatGPT toolbox] copy hotkey continue loop failed', err);
        setStatus(`连续复制+快捷键+继续失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE_LOOP][FAILED] source=${src} error=${errText}`);
        return false;
      } finally {
        releaseUploadActionLock('copy-hotkey-continue-loop');
      }
    }

    async function handleCopyHotkeyContinueLoopClick(source = 'unknown') {
      return runCopyHotkeyContinueLoop(source);
    }

    function ensureCopyHotkeyUploadVerifyLoopTask() {
      if (!state.copyHotkeyUploadVerifyLoopTask || typeof state.copyHotkeyUploadVerifyLoopTask !== 'object') {
        state.copyHotkeyUploadVerifyLoopTask = {
          phase: 'idle',
          runId: '',
          stopRequested: false,
          cycleIndex: 0,
          startedAt: 0,
          lastError: null,
          currentSubtask: '',
        };
      }
      return state.copyHotkeyUploadVerifyLoopTask;
    }

    function setCopyHotkeyUploadVerifyLoopPhase(phase, reason = '', options = {}) {
      const task = ensureCopyHotkeyUploadVerifyLoopTask();
      const normalized = String(phase || 'idle').trim().toLowerCase();
      task.phase = normalized;

      if (options.cycleIndex != null) {
        task.cycleIndex = Number(options.cycleIndex) || 0;
        copyHotkeyUploadVerifyLoopCount = task.cycleIndex;
      }

      if (options.currentSubtask != null) {
        task.currentSubtask = String(options.currentSubtask || '');
      }

      const loopActive = !['idle', 'success', 'failed', 'stopped'].includes(normalized);
      copyHotkeyUploadVerifyLoopRunning = loopActive;
      copyHotkeyUploadVerifyLoopStopRequested = !!(
        task.stopRequested
        || normalized === 'stopping'
      );

      if (reason) {
        task.lastReason = String(reason);
      }

      logTaskSourceConsistency(
        'copyHotkeyUploadVerifyLoop',
        normalized,
        copyHotkeyUploadVerifyLoopRunning,
        isCopyHotkeyUploadVerifyLoopActive(),
        reason,
      );
      scheduleRenderUpload(`copyHotkeyUploadVerifyLoop:${normalized}:${reason || '-'}`);
    }

    function requestCopyHotkeyUploadVerifyLoopStop(source = 'unknown') {
      const task = ensureCopyHotkeyUploadVerifyLoopTask();
      const src = String(source || 'unknown').trim() || 'unknown';

      if (
        !COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES.has(task.phase)
        && !copyHotkeyUploadVerifyLoopRunning
      ) {
        return false;
      }

      task.stopRequested = true;
      copyHotkeyUploadVerifyLoopStopRequested = true;

      if (task.abortController && typeof task.abortController.abort === 'function') {
        task.abortController.abort();
      }

      setCopyHotkeyUploadVerifyLoopPhase('stopping', src);
      setStatus('停止请求已提交，等待任务退出...', 'warn');
      ToolboxShell.appendLog(`[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][stop-requested] source=${src}`);

      return true;
    }

    function shouldUploadOnVerifyLoopCycle(cycleIndex) {
      const index = Number(cycleIndex) || 0;
      return index > 0 && index % 5 === 0;
    }

    async function runCopyHotkeyUploadVerifyPostCycleActions(cycleIndex) {
      if (!shouldUploadOnVerifyLoopCycle(cycleIndex)) {
        return {
          stop: false,
          reason: 'no-upload',
        };
      }

      const loopTask = ensureCopyHotkeyUploadVerifyLoopTask();

      ToolboxShell.appendLog(
        `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][post-cycle] action=auto-upload index=${cycleIndex} interval=5`,
      );

      setStatus(`闭环继续第 ${cycleIndex} 轮：正在上传代码...`, 'running');

      setCopyHotkeyUploadVerifyLoopPhase('auto_uploading', `cycle-${cycleIndex}-auto-upload`, {
        cycleIndex,
        currentSubtask: 'auto_upload',
      });

      try {
        const uploadResult = await startUploadFromCurrentQueue({
          source: `copy-hotkey-upload-verify-loop-auto-upload-${cycleIndex}`,
          parentTask: 'copyHotkeyUploadVerifyLoop',
          cycleIndex,
          shouldStop: () => !!(
            copyHotkeyUploadVerifyLoopStopRequested
            || loopTask.stopRequested
          ),
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][auto-upload-done] index=${cycleIndex} ok=${uploadResult && uploadResult.ok ? '1' : '0'} uploaded=${uploadResult && uploadResult.uploadedCount != null ? uploadResult.uploadedCount : '-'} failed=${uploadResult && uploadResult.failedCount != null ? uploadResult.failedCount : '-'} skipped=${uploadResult && uploadResult.skippedCount != null ? uploadResult.skippedCount : '-'} reason=${uploadResult && uploadResult.reason ? uploadResult.reason : '-'}`,
        );

        return {
          stop: false,
          reason: 'auto-upload-done',
          uploadResult,
        };
      } catch (error) {
        const errText = formatToolboxError(error);

        console.error('[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][auto-upload-failed]', {
          cycleIndex,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][auto-upload-failed] index=${cycleIndex} error=${errText}`,
        );

        setStatus(`闭环继续第 ${cycleIndex} 轮自动上传失败：${errText}`, 'error');

        return {
          stop: false,
          reason: 'auto-upload-failed',
          error: errText,
        };
      } finally {
        if (
          copyHotkeyUploadVerifyLoopRunning
          && !copyHotkeyUploadVerifyLoopStopRequested
          && loopTask.phase === 'auto_uploading'
        ) {
          setCopyHotkeyUploadVerifyLoopPhase('running', `cycle-${cycleIndex}-auto-upload-done`, {
            cycleIndex,
          });
        }
      }
    }

    async function handleCopyHotkeyUploadVerifyLoopClick(source = 'unknown') {
      return toggleCopyHotkeyUploadVerifyLoop(source);
    }

    function shouldSkipAction(actionName, windowMs = 300) {
      const key = String(actionName || '').trim();
      if (!key) {
        return false;
      }

      const now = Date.now();
      const last = uploadActionDebounceMap.get(key) || 0;
      if (now - last < Number(windowMs || 300)) {
        return true;
      }

      uploadActionDebounceMap.set(key, now);
      return false;
    }

    function resolveUploadActionDebounceKey(action, source) {
      const normalized = String(action || '').trim();
      const src = String(source || '').trim();

      if (normalized === 'send-message' && src === 'enter-hotkey') {
        return 'enter-send';
      }

      if (normalized === 'loop-copy-hotkey-continue') {
        return 'copy-hotkey-loop';
      }

      if (normalized === 'loop-copy-hotkey-continue-upload-verify') {
        return 'copy-hotkey-upload-verify-loop';
      }

      if (normalized === 'copy-hotkey-continue') {
        return 'copy-hotkey-continue-once';
      }

      if (
        normalized === 'start-upload'
        || normalized === 'send-message'
        || normalized === 'auto-continue'
        || normalized === 'auto-continue-until-done'
      ) {
        return normalized;
      }

      return '';
    }

    function claimUploadActionLock(key, options = {}) {
      const lockKey = String(key || '').trim();
      if (!lockKey) {
        return {
          ok: false,
          reason: 'empty-lock-key',
        };
      }

      const timeoutMs = Number(options.timeoutMs || 90000);
      const now = Date.now();
      const current = uploadActionLocks[lockKey];

      if (current && current.running) {
        const runningMs = now - Number(current.startedAt || 0);
        const forceRelease = options.forceRelease === true;

        if (runningMs <= timeoutMs && !forceRelease) {
          return {
            ok: false,
            reason: 'task-running',
            runningMs,
          };
        }

        const releaseTag = forceRelease ? 'FORCE_RELEASE' : 'STALE_RELEASE';
        ToolboxShell.appendLog(
          `[UPLOAD_ACTION_LOCK][${releaseTag}] key=${lockKey} runningMs=${runningMs}`,
        );
      }

      uploadActionLocks[lockKey] = {
        running: true,
        startedAt: now,
      };

      if (lockKey === 'copy-hotkey-once') {
        setCopyHotkeyOncePhase('waiting_reply', 'action-lock-claim');
      } else if (lockKey === 'copy-hotkey-continue') {
        copyHotkeyContinueTaskRunning = true;
        copyHotkeyContinueTaskStartedAt = now;
      }

      return {
        ok: true,
        reason: 'claimed',
        startedAt: now,
      };
    }

    function releaseUploadActionLock(key) {
      const lockKey = String(key || '').trim();
      if (!lockKey) {
        return;
      }

      uploadActionLocks[lockKey] = {
        running: false,
        startedAt: 0,
      };

      if (lockKey === 'copy-hotkey-once') {
        setCopyHotkeyOncePhase('idle', 'action-lock-release');
      } else if (lockKey === 'copy-hotkey-continue') {
        copyHotkeyContinueTaskRunning = false;
        copyHotkeyContinueTaskStartedAt = 0;
      }
    }

    function getDefaultCopyHotkeyContinuePromptText() {
      if (typeof getDefaultTaskContinuePromptText === 'function') {
        return getDefaultTaskContinuePromptText();
      }
      if (typeof getDefaultContinuePromptText === 'function') {
        return getDefaultContinuePromptText();
      }
      return '请继续完成上一个任务。';
    }

    function formatContinuePromptPreview(text, maxLen = 160) {
      const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
      if (normalized.length <= maxLen) {
        return normalized;
      }
      return `${normalized.slice(0, maxLen)}...`;
    }

    function getCopyHotkeyContinueStopSignal(options = {}) {
      const override = String(options.doneSignal || '').trim();
      if (override) {
        return override;
      }

      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      let signal = String(
        cfg.copyHotkeyContinueStopSignal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
      ).trim();

      if (LEGACY_ASSISTANT_DONE_SIGNAL_LITERALS.includes(signal)) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SIGNAL][MIGRATE] from=${signal} to=${DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL}`,
          );
        }
        signal = DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL;
      }

      return signal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL;
    }

    function getCopyHotkeyContinuePromptText(options = {}) {
      const overridePrompt = String(options.continuePrompt || '').trim();
      if (overridePrompt) {
        return overridePrompt;
      }

      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const signal = getCopyHotkeyContinueStopSignal(options);

      let text = String(cfg.copyHotkeyContinuePromptText || '').trim();

      if (!text) {
        text = getDefaultCopyHotkeyContinuePromptText();
      }

      if (typeof renderContinuePromptTemplate === 'function') {
        return renderContinuePromptTemplate(text, signal);
      }

      if (!text.includes(signal)) {
        text = [
          text,
          '',
          '如果任务已经完整完成，只能回复下面这一行，不能有任何其他文字：',
          '',
          signal,
        ].join('\n');
      }

      return text;
    }

    const LEGACY_ASSISTANT_DONE_SIGNAL_LITERALS = Object.freeze([
      'CHATGPT_TOOLBOX_DONE',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ]);

    function uploadAnalyzeAssistantDoneSignalText(text, options = {}) {
      const configuredStopSignal = getCopyHotkeyContinueStopSignal(options);
      if (typeof analyzeAssistantDoneSignalText === 'function') {
        return analyzeAssistantDoneSignalText(text, {
          ...options,
          doneSignal: configuredStopSignal,
        });
      }
      console.error(
        '[UPLOAD][done-signal] analyzeAssistantDoneSignalText missing; '
        + 'fallback=hasAssistantDoneSignalInText',
      );
      const matched = typeof hasAssistantDoneSignalInText === 'function'
        ? hasAssistantDoneSignalInText(text, { doneSignal: configuredStopSignal })
        : false;
      return {
        matched,
        corrupted: false,
        lineCount: 0,
        configuredStopSignal,
        allowedSignals: configuredStopSignal ? [configuredStopSignal] : [],
        reason: 'analyzeAssistantDoneSignalText-missing',
      };
    }

    function formatDoneSignalPreview(text) {
      const preview = String(text || '').replace(/\r\n/g, '\n').trim();
      if (preview.length <= 120) {
        return preview;
      }
      return `${preview.slice(0, 120)}...`;
    }

    function logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields, options = {}) {
      const analysis = uploadAnalyzeAssistantDoneSignalText(text, options);
      const rawPreview = formatDoneSignalPreview(
        String(text || '').replace(/\r\n/g, '\n').trim(),
      );
      const checkedPreview = formatDoneSignalPreview(
        cleanAssistantTextForDoneSignal(text).replace(/\r\n/g, '\n').trim(),
      );
      const extra = extraFields
        ? ` ${String(extraFields).trim()}`
        : '';
      const allowedSignalsText = (analysis.allowedSignals || []).join('|');
      const line = `[${logPrefix}][done-signal-check] phase=${phase || '-'} matched=${analysis.matched ? '1' : '0'} rawPreview=${rawPreview} checkedPreview=${checkedPreview} lineCount=${analysis.lineCount} configuredStopSignal=${analysis.configuredStopSignal} allowedSignals=${allowedSignalsText} reason=${analysis.reason}${extra}`;
      safeAppendLog(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
      console.warn(`[${logPrefix}][done-signal-check]`, {
        phase: phase || '-',
        matched: analysis.matched,
        rawPreview,
        checkedPreview,
        lineCount: analysis.lineCount,
        configuredStopSignal: analysis.configuredStopSignal,
        allowedSignals: analysis.allowedSignals,
        reason: analysis.reason,
      });
    }

    function checkUploadDoneSignalWithLog(text, logPrefix, phase, extraFields, options = {}) {
      const matched = uploadAnalyzeAssistantDoneSignalText(text, options).matched;
      logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields, options);
      return matched;
    }

    function getActiveGroupId() {
      return String(state.activeGroupId || '').trim();
    }

    function formatUploadGroupDiagFields(extra = {}) {
      const activeGroupId = getActiveGroupId();
      const groupCount = state.groups.length;
      const currentGroupFileCount = getActiveGroupFiles().length;
      const totalUploadItems = state.queue.length;
      const parts = [
        `activeGroupId=${activeGroupId || '-'}`,
        `groupCount=${groupCount}`,
        `currentGroupFileCount=${currentGroupFileCount}`,
        `totalUploadItems=${totalUploadItems}`,
      ];

      Object.keys(extra || {}).forEach((key) => {
        const value = extra[key];
        parts.push(`${key}=${value == null ? '-' : value}`);
      });

      return parts.join(' ');
    }

    function appendUploadGroupLog(tag, extra = {}) {
      if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
        return;
      }

      ToolboxShell.appendLog(`[UPLOAD_GROUP][${tag}] ${formatUploadGroupDiagFields(extra)}`);
    }

    function syncUploadGroupAppState() {
      if (typeof UploadGroupAppState === 'undefined') {
        return;
      }

      UploadGroupAppState.uploadGroups = state.groups.map((group) => ({ ...group }));
      UploadGroupAppState.activeUploadGroupId = getActiveGroupId();
      UploadGroupAppState.uploadItems = getActiveGroupFiles().map((item) => ({ ...item }));
    }

    function ensureActiveUploadGroupIdValid(reason = '') {
      if (!state.groups.length) {
        return false;
      }

      const activeGroupId = getActiveGroupId();

      if (activeGroupId && state.groups.some((group) => group.id === activeGroupId)) {
        return true;
      }

      const restored = resolveUploadGroupSelection({
        reason: reason || 'ensure-active-valid',
      });
      const fallbackGroupId = restored.resolvedGroupId || '';

      if (!fallbackGroupId) {
        console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {
          reason,
          previousActiveGroupId: activeGroupId || '',
        });
        return false;
      }

      console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to restored group', {
        reason,
        previousActiveGroupId: activeGroupId || '',
        fallbackGroupId,
        source: restored.reason || '-',
      });

      state.activeGroupId = fallbackGroupId;
      appendUploadGroupLog('ACTIVE_FALLBACK', {
        reason: reason || '-',
        previousActiveGroupId: activeGroupId || '-',
        fallbackGroupId,
        source: restored.reason || '-',
      });
      syncUploadGroupAppState();
      return true;
    }

    function getActiveGroupFiles() {
      const groupId = getActiveGroupId();
      if (!groupId) {
        return [];
      }
      return (state.queue || []).filter(
        (file) => file && String(file.groupId || '').trim() === groupId,
      );
    }

    function getSelectedFileIdForActiveGroup() {
      const groupId = getActiveGroupId();
      if (!groupId) {
        return '';
      }
      return String(
        state.selectedFileIdByGroup[groupId] || state.activeId || '',
      ).trim();
    }

    function setSelectedFileIdForActiveGroup(fileId, meta = {}) {
      const groupId = getActiveGroupId();
      const id = String(fileId || '').trim();
      if (!groupId) {
        return;
      }
      state.selectedFileIdByGroup[groupId] = id;
      state.activeId = id;
      const file = getActiveGroupFiles().find((item) => item.id === id) || null;
      console.log('[UPLOAD][FILE_SELECT]', {
        projectKey: groupId,
        fileId: id,
        fileName: file && file.name ? file.name : '',
        reason: meta.reason || '',
      });

      if (meta.skipLastSelectionSave) {
        return;
      }

      const activeGroup = getActiveGroup();
      const projectKey = getUploadGroupStableKey(activeGroup);
      if (!projectKey) {
        return;
      }

      const folderKey = file ? getUploadFileFolderKey(file) : '';
      saveMultiUploadLastSelection({
        projectKey,
        folderKey,
      });
    }

    function resolveSelectedFileIdForGroup(groupId, files) {
      const gid = String(groupId || '').trim();
      const group = state.groups.find((item) => item && item.id === gid) || null;
      const oldSelectedId = String(state.selectedFileIdByGroup[gid] || '').trim();
      if (oldSelectedId && files.some((file) => file && file.id === oldSelectedId)) {
        return oldSelectedId;
      }

      const saved = getMultiUploadLastSelection();
      const groupKey = getUploadGroupStableKey(group);
      if (saved.projectKey && groupKey && saved.projectKey === groupKey && saved.folderKey) {
        const savedFile = files.find(
          (file) => file && getUploadFileFolderKey(file) === saved.folderKey,
        );
        if (savedFile) {
          return savedFile.id;
        }

        logMultiUploadLastSelectionEvent('FOLDER_MISSING', {
          projectKey: groupKey,
          savedFolder: saved.folderKey,
          fallback: files.length ? getUploadFileFolderKey(files[0]) : '',
        });

        if (files.length > 0) {
          const fallbackFolderKey = getUploadFileFolderKey(files[0]);
          saveMultiUploadLastSelection({
            projectKey: groupKey,
            folderKey: fallbackFolderKey,
          });
          return files[0].id;
        }
      }

      if (files.length > 0) {
        return files[0].id;
      }
      return '';
    }

    function syncActiveGroupSelectionAfterQueueLoad(groupId) {
      const gid = String(groupId || getActiveGroupId() || '').trim();
      const files = getActiveGroupFiles();
      const selectedId = resolveSelectedFileIdForGroup(gid, files);
      state.selectedFileIdByGroup[gid] = selectedId;
      state.activeId = selectedId;
      console.log('[UPLOAD][PROJECT_SWITCH]', {
        activeProjectKey: gid,
        fileCount: files.length,
        selectedFileId: selectedId,
      });
    }

    function saveMultiUploadSelectionForActiveGroup(options = {}) {
      const activeGroup = getActiveGroup();
      const projectKey = getUploadGroupStableKey(activeGroup);
      if (!projectKey) {
        return;
      }

      const selectedFile = getActiveGroupFiles().find(
        (item) => item && item.id === getSelectedFileIdForActiveGroup(),
      ) || null;
      const folderKey = selectedFile ? getUploadFileFolderKey(selectedFile) : '';

      saveMultiUploadLastSelection({
        projectKey,
        folderKey: options.folderKey != null ? options.folderKey : folderKey,
      });
    }

    function shouldSkipUploadUiAction(actionKey, source, intervalMs) {
      const now = Date.now();
      const action = String(actionKey || '');
      const src = String(source || '');
      const gap = now - uploadUiActionLastAt;

      const previousWasPointerDown = uploadUiActionLastKey === `${action}:pointerdown`;
      const currentIsMouseFollowup =
        src === 'mousedown' ||
        src === 'click' ||
        src === 'delegated-click';

      if (previousWasPointerDown && currentIsMouseFollowup && gap < Number(intervalMs || 350)) {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][skip] action=${actionKey} source=${source || '-'} gap=${gap} reason=pointerdown-already-handled`,
        );
        return true;
      }

      uploadUiActionLastKey = `${action}:${src}`;
      uploadUiActionLastAt = now;
      return false;
    }

    function formatToolboxError(err) {
      return err && err.message ? err.message : String(err);
    }

    function safeAppendLog(text) {
      const line = String(text || '');
      if (!line) {
        return;
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }

    function clearStaleUploadButtonBusy(button, options = {}) {
      const maxBusyMs = Number(options.maxBusyMs) > 0 ? Number(options.maxBusyMs) : 90000;
      const action = String(options.action || 'button');
      const source = String(options.source || '-');
      const logTag = String(options.logTag || 'UPLOAD_UI_ACTION');

      if (!button || button.dataset.busy !== '1') {
        return { wasBusy: false, skipped: false, busyMs: 0 };
      }

      const busyAt = Number(button.dataset.busyAt || 0);
      const busyMs = busyAt > 0 ? Date.now() - busyAt : 0;

      if (busyAt > 0 && busyMs <= maxBusyMs) {
        return { wasBusy: true, skipped: true, busyMs };
      }

      ToolboxShell.appendLog(
        `[${logTag}][stale-button-release] action=${action} source=${source} busyMs=${busyMs || '-'}`,
      );
      button.dataset.busy = '0';
      button.dataset.busyAt = '0';
      button.dataset.waitingReply = '0';
      return { wasBusy: true, skipped: false, busyMs };
    }

    function setCopyContinueButtonBusy(btn, busy, options = {}) {
      if (!btn) {
        return;
      }

      if (!busy) {
        btn.dataset.busy = '0';
        btn.dataset.busyAt = '0';
        btn.dataset.waitingReply = '0';
        btn.classList.remove('cgpt-btn-busy');
        btn.textContent = String(options.idleText || '复制并继续');
        applyWaitingAnswerButtonStyle(btn, false, {
          extraIdleClasses: ['copy-continue'],
        });
        if (typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'copy-continue-idle');
        }
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('aria-disabled', 'false');
        return;
      }

      const startedAt = Number(options.startedAt) > 0 ? Number(options.startedAt) : Date.now();
      const assistantBusy = !!options.assistantBusy;
      btn.dataset.busy = '1';
      btn.dataset.busyAt = String(startedAt);
      btn.dataset.waitingReply = assistantBusy ? '1' : '0';
      btn.classList.add('cgpt-btn-busy');
      const busyText = String(
        options.text || (assistantBusy ? '等待回复...' : '继续中...'),
      );
      btn.textContent = busyText;
      applyWaitingAnswerButtonStyle(btn, isWaitingAnswerVisualState({
        text: busyText,
        isResponding: assistantBusy,
      }), {
        extraIdleClasses: ['copy-continue'],
      });
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      if (typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }
    }

    function playCopySuccessBeepSafe(source, logPrefix) {
      const tag = String(logPrefix || 'copy');
      return playCopySuccessBeep(String(source || '-'), {
        force: true,
        ignoreCooldown: true,
      }).catch((beepError) => {
        const beepErrText = formatToolboxError(beepError);
        console.warn('[ChatGPT toolbox] copy success beep failed', beepError);
        ToolboxShell.appendLog(
          `[BEEP][COPY_SUCCESS_FAILED] source=${tag}:${source || '-'} error=${beepErrText}`,
        );
      });
    }

    function createDefaultGroup() {
      const group = {
        id: createId('upload_group'),
        name: DEFAULT_UPLOAD_GROUP_NAME,
        key: 'default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return group;
    }

    function newId() {
      return createId('upload');
    }

    function isUploadUseUniqueFileNameEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.uploadUseUniqueFileName, true);
    }

    function isFileHandleLike(value) {
      return !!(
        value &&
        typeof value.getFile === 'function'
      );
    }

    function getPageWindowForFilePicker() {
      try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
          return unsafeWindow;
        }
      } catch (e) {
        console.warn('[ChatGPT toolbox] unsafeWindow unavailable for file picker', e);
      }

      return window;
    }

    function getShowOpenFilePickerFn() {
      const pageWin = getPageWindowForFilePicker();

      if (pageWin && typeof pageWin.showOpenFilePicker === 'function') {
        return pageWin.showOpenFilePicker.bind(pageWin);
      }

      if (typeof window.showOpenFilePicker === 'function') {
        return window.showOpenFilePicker.bind(window);
      }

      return null;
    }

    function hasActuallyReusableUploadSource(q) {
      return !!(
        q &&
        (
          isFileLike(q.file) ||
          isBlobLike(q.blob)
        )
      );
    }

    function canReadFromLocal(q) {
      return !!(
        q &&
        q.sourceKind === 'local-handle' &&
        hasLocalReadableHandle(q)
      );
    }

    function hasAttemptableUploadSource(q) {
      return !!(
        q &&
        (
          q.file ||
          q.blob ||
          (
            q.fileHandle &&
            typeof q.fileHandle.getFile === 'function'
          )
        )
      );
    }

    function isHandleReadFailureMessage(message) {
      const text = String(message || '');

      return text.includes('没有本地文件读取权限') ||
        text.includes('缺少文件，请重新拖入') ||
        text.includes('本地文件读取失败') ||
        text.includes('本地文件为空或读取失败');
    }

    function shouldPreserveMissingOrFailedState(q) {
      if (!q) return false;

      if (hasAttemptableUploadSource(q)) {
        return false;
      }

      const isMissingOrFailed = q.state === UploadState.MISSING_FILE || q.state === UploadState.FAILED;

      if (!isMissingOrFailed) {
        return false;
      }

      if (isHandleReadFailureMessage(q.message)) {
        return true;
      }

      if (
        q.state === UploadState.MISSING_FILE &&
        (q.sourceKind === 'cached-only' || q.sourceKind === 'missing-local')
      ) {
        return true;
      }

      if (
        q.state === UploadState.MISSING_FILE &&
        !hasActuallyReusableUploadSource(q) &&
        isFileHandleLike(q.fileHandle)
      ) {
        return true;
      }

      return false;
    }

    function resetQueueItemsForUpload(options = {}) {
      const opts = options || {};
      const forceAll = !!opts.forceAll;
      const forceResetAttached = opts.forceResetAttached === true;
      const forceResetUploaded = opts.forceResetUploaded === true;
      const forceResetDone = opts.forceResetDone === true;
      const preserveAttached = opts.preserveAttached !== false;
      const reason = String(opts.reason || '').trim();
      let changed = false;
      let resetCount = 0;

      state.queue.forEach((q) => {
        if (!q) return;

        // 不要重置已经无法读取的记录（例如文件被删除）
        // 注意：对「强制重传」来说，readable 是必要条件，否则会造成无意义的循环重试
        const reusable = typeof hasActuallyReusableUploadSource === 'function'
          ? hasActuallyReusableUploadSource(q)
          : hasAttemptableUploadSource(q);
        if (!forceAll && !reusable) {
          return;
        }

        const isAttached = q.state === UploadState.ATTACHED;

        if (isAttached && preserveAttached && !forceResetAttached && !forceResetUploaded && !forceResetDone) {
          return;
        }

        if (isAttached && q.attachedInSession && !forceResetAttached && !forceResetUploaded && !forceResetDone) {
          return;
        }

        // 统一重置为可再次上传的 idle 状态（后续 getPendingUploadItems 会重新判断并进入队列）
        if (forceAll || forceResetAttached || forceResetUploaded || forceResetDone || hasAttemptableUploadSource(q)) {
          q.state = UploadState.IDLE;
          q.message = '';
          q.uploadName = '';
          q.persistedAttached = false;
          q.attachedInSession = false;
          q.updatedAt = Date.now();
          changed = true;
          resetCount += 1;
        }
      });

      if (changed) {
        try {
          scheduleRenderUpload(`resetQueueItemsForUpload:${reason || 'manual'}`);
          persistQueueThrottled(`resetQueueItemsForUpload:${reason || 'manual'}`);
        } catch (e) {
          const errText = e && e.message ? e.message : String(e);
          console.error('[ChatGPT toolbox] resetQueueItemsForUpload persist/render failed', e);
          ToolboxShell.appendLog(`[UPLOAD][RESET_QUEUE_PERSIST_FAILED] error=${errText}`);
        }
      }

      return resetCount;
    }

    function forceResetActiveGroupFilesForUpload(reason = '') {
      const activeFiles = typeof getActiveGroupFiles === 'function'
        ? getActiveGroupFiles()
        : [];

      let resetCount = 0;

      activeFiles.forEach((q) => {
        if (!q) return;

        q.state = UploadState.IDLE;
        q.message = '';
        q.uploadName = '';
        q.persistedAttached = false;
        q.attachedInSession = false;
        if (q.status === 'uploaded') {
          q.status = 'pending';
        }
        q.updatedAt = Date.now();

        resetCount += 1;
      });

      if (resetCount > 0) {
        ToolboxShell.appendLog(
          `[UPLOAD][FORCE_RESET_ACTIVE_GROUP] reason=${String(reason || '-')} resetCount=${resetCount}`,
        );

        scheduleRenderUpload(`forceResetActiveGroupFilesForUpload:${reason || 'manual'}`);
        persistQueueThrottled(`forceResetActiveGroupFilesForUpload:${reason || 'manual'}`);
      } else {
        ToolboxShell.appendLog(
          `[UPLOAD][FORCE_RESET_ACTIVE_GROUP_EMPTY] reason=${String(reason || '-')}`,
        );
      }

      return resetCount;
    }

    function resetFlaskFilesForUpload(reason = '') {
      let changed = false;

      state.flaskFiles = (state.flaskFiles || []).map((row) => {
        if (!row) return row;

        if (row.status === 'uploaded') {
          changed = true;
          return {
            ...row,
            status: 'pending',
          };
        }

        return row;
      });

      if (changed) {
        ToolboxShell.appendLog(
          `[UPLOAD][FLASK_RESET_FOR_REUPLOAD] reason=${String(reason || '-')}`
        );
      }

      return changed;
    }

    function isUploadFailedState(q) {
      return !!q && (
        q.state === UploadState.FAILED ||
        q.state === UploadState.MISSING_FILE ||
        q.state === UploadState.CANCELLED
      );
    }

    function shouldShowRebindButton(q) {
      if (!q) return false;

      if (isCachedUploadSnapshot(q)) {
        return true;
      }

      return (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        (!q.file && !q.blob && !hasLocalReadableHandle(q))
      );
    }

    function describeUploadSource(q) {
      if (!q) {
        return {
          exists: false,
        };
      }

      return {
        exists: true,
        id: q.id || '',
        groupId: q.groupId || '',
        name: q.name || '',
        displayPath: q.displayPath || '',
        size: Number(q.size) || 0,
        lastModified: Number(q.lastModified) || 0,
        sourceKind: q.sourceKind || '',
        state: q.state || '',
        message: q.message || '',
        uploadName: q.uploadName || '',

        hasFile: !!q.file,
        isFile: isFileLike(q.file),
        fileTag: q.file ? getObjectTag(q.file) : '',
        fileName: q.file && q.file.name ? q.file.name : '',
        fileSize: q.file && typeof q.file.size === 'number' ? q.file.size : null,
        fileType: q.file && q.file.type ? q.file.type : '',

        hasBlob: !!q.blob,
        isBlob: isBlobLike(q.blob),
        blobTag: q.blob ? getObjectTag(q.blob) : '',
        blobSize: q.blob && typeof q.blob.size === 'number' ? q.blob.size : null,
        blobType: q.blob && q.blob.type ? q.blob.type : '',

        hasHandle: !!q.fileHandle,
        isHandle: isFileHandleLike(q.fileHandle),
        handleName: q.fileHandle && q.fileHandle.name ? q.fileHandle.name : '',
        handleKind: q.fileHandle && q.fileHandle.kind ? q.fileHandle.kind : '',

        readable: hasActuallyReusableUploadSource(q),
        attemptable: hasAttemptableUploadSource(q),
      };
    }

    function logUploadItemSource(stage, q, extra = {}) {
      const info = describeUploadSource(q);
      const text = [
        `[UPLOAD_DIAG][${stage}]`,
        `name=${info.name || '-'}`,
        `groupId=${info.groupId || '-'}`,
        `sourceKind=${info.sourceKind || '-'}`,
        `state=${info.state || '-'}`,
        `size=${info.size || 0}`,
        `lastModified=${info.lastModified || 0}`,
        `readable=${info.readable ? '1' : '0'}`,
        `file=${info.isFile ? '1' : '0'}(${info.fileTag || '-'}/${info.fileSize ?? '-'})`,
        `blob=${info.isBlob ? '1' : '0'}(${info.blobTag || '-'}/${info.blobSize ?? '-'})`,
        `handle=${info.isHandle ? '1' : '0'}(${info.handleName || '-'})`,
        extra.reason ? `reason=${extra.reason}` : '',
      ].filter(Boolean).join(' ');

      ToolboxShell.appendLog(text);
      console.debug('[ChatGPT toolbox] upload item source', stage, info, extra);
    }

    function logUploadQueueSnapshot(stage, extra = {}) {
      try {
        const list = state.queue.map((q) => describeUploadSource(q));
        const reusable = list.filter((x) => x.readable).length;
        const attemptable = list.filter((x) => x.attemptable).length;
        const missing = list.length - attemptable;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][${stage}] queue=${list.length} reusable=${reusable} attemptable=${attemptable} missing=${missing}`,
        );

        console.debug('[ChatGPT toolbox] upload queue snapshot', {
          stage,
          reusable,
          attemptable,
          missing,
          extra,
          list,
        });
      } catch (e) {
        console.warn('[ChatGPT toolbox] logUploadQueueSnapshot failed', stage, e);
      }
    }

    // 注意：displayPath 只是展示信息，不能作为本地读取依据
    // 浏览器通常不会暴露真实绝对路径
    // 是否能重新读取本地文件，只看 fileHandle 是否存在且可 getFile

    function hasLocalReadableHandle(q) {
      return !!(
        q &&
        q.fileHandle &&
        typeof q.fileHandle.getFile === 'function'
      );
    }

        function isCachedUploadSnapshot(q) {
      // Blob persistence disabled - no cached snapshots
      return false;
    }

    function getUploadInlineStatusText(q) {
      if (!q) return '未知来源';

      if (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        (!q.file && !q.fileHandle && !hasLocalReadableHandle(q))
      ) {
        return '需重新拖入';
      }

      if (q.state === UploadState.ATTACHED) {
        return '已绑定到输入框';
      }

      if (
        q.source === 'flask_local_direct'
        || q.sourceKind === 'flask_local_direct'
        || q.flask_local_direct === true
      ) {
        return '本地直读';
      }

      if (hasLocalReadableHandle(q) || q.fileHandle) {
        return '实时读取（本地可读，未必已上传）';
      }

      if (q.file) {
        return '本次选择';
      }

      return '需重新拖入';
    }

    function buildUploadItemTitle(q) {
      if (!q) return '';

      const lines = [];

      lines.push(`文件名：${q.name || '-'}`);
      lines.push(`大小：${formatBytes(q.size)}`);

      if (q.lastModified) {
        const d = new Date(Number(q.lastModified));
        if (!Number.isNaN(d.getTime())) {
          lines.push(`修改时间：${d.toLocaleString()}`);
        }
      }

      lines.push(`来源：${getUploadInlineStatusText(q)}`);

      if (hasLocalReadableHandle(q)) {
        lines.push('说明：已保存本地文件句柄，刷新后可实时读取最新文件；这不等于已上传到 ChatGPT 对话');
      } else if (isCachedUploadSnapshot(q)) {
              // lines.push('说明：这是浏览器 IndexedDB 中保存的文件快照，不是本地文件句柄；原文件变化后不会自动同步');
      } else if (q.sourceKind === 'session-file' && (q.file || q.blob)) {
              // lines.push('说明：仅当前页面内存可用，刷新后会变为需重新拖入');
      } else if (
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        q.state === UploadState.MISSING_FILE
      ) {
        lines.push('说明：缺少可读文件，请点击“重新绑定”或重新拖入');
      }

      return lines.join('\n');
    }

    function refreshQueueReadableState() {
      let changed = false;

      state.queue.forEach((q) => {
        if (!q) return;

        const attemptable = hasAttemptableUploadSource(q);

        if (!attemptable) {
          if (q.state !== UploadState.MISSING_FILE) {
            logUploadItemSource('refreshQueueReadableState:mark-missing', q, {
              reason: 'file/blob/handle all missing',
            });
            q.state = UploadState.MISSING_FILE;
            changed = true;
          }

          const msg = q.sourceKind === 'cached-only'
            ? '缺少文件，请重新拖入'
            : (q.sourceKind === 'missing-local'
              ? '缺少文件，请重新拖入'
              : (q.sourceKind === 'session-file'
                ? '缺少文件，请重新拖入'
                : '缺少文件，请重新拖入'));

          if (q.message !== msg) {
            q.message = msg;
            changed = true;
          }

          if (!q.sourceKind || q.sourceKind === '') {
            q.sourceKind = 'missing-local';
            changed = true;
          }

          q.uploadName = '';
          return;
        }

        if (q.state === UploadState.CANCELLED) {
          if (state.running || state.cancelled) {
            return;
          }

          return;
        }

        if (
          q.state === UploadState.MISSING_FILE ||
          q.state === UploadState.FAILED
        ) {
          if (shouldPreserveMissingOrFailedState(q)) {
            logUploadItemSource('refreshQueueReadableState:keep-missing', q, {
              reason: 'handle-read-failure-or-no-reliable-source',
            });
            return;
          }

          const recoverable = hasActuallyReusableUploadSource(q) || canReadFromLocal(q);

          if (recoverable) {
            logUploadItemSource('refreshQueueReadableState:mark-idle', q, {
              reason: 'file/blob/handle-available',
            });
            q.state = UploadState.IDLE;
            q.message = '';
            q.uploadName = '';
            changed = true;
          }

          return;
        }

        if (q.state === UploadState.ATTACHED && hasAttachmentEvidenceForItem(q)) {
          if (q.persistedAttached) {
            q.persistedAttached = false;
            changed = true;
          }
          return;
        }

        if (q.state === UploadState.ATTACHED && !hasAttachmentEvidenceForItem(q)) {
          if (state.running || q.attachedInSession) {
            return;
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][refreshQueue:attached-reset-after-reload] ${q.name} 页面附件区未检测到，已改为待上传`
          );
          q.state = UploadState.IDLE;
          q.uploadName = '';
          if (!q.message) {
            q.message = q.persistedAttached
              ? '上次已上传，刷新后请点击上传'
              : '页面附件区未检测到，请再次点击上传';
          }
          changed = true;
        }
      });

      return changed;
    }

    function normalizeUploadState(rawState, hasReadableFile) {
      if (!hasReadableFile) {
        return UploadState.MISSING_FILE;
      }

      if (rawState === UploadState.READY || rawState === 'READY') {
        return UploadState.IDLE;
      }

      if (rawState === UploadState.ATTACHED) {
        return UploadState.IDLE;
      }

      if (
        rawState === UploadState.READING ||
        rawState === UploadState.ATTACHING ||
        rawState === UploadState.CANCELLED ||
        rawState === UploadState.FAILED ||
        rawState === UploadState.MISSING_FILE ||
        isLegacyUploadState(rawState)
      ) {
        return UploadState.IDLE;
      }

      if (rawState === UploadState.IDLE) {
        return UploadState.IDLE;
      }

      return UploadState.IDLE;
    }

    function getPersistedUploadState(q) {
      if (!q) return UploadState.IDLE;

      if (q.sourceKind === 'cached-only' || q.sourceKind === 'missing-local') {
        return UploadState.MISSING_FILE;
      }

      if (!hasAttemptableUploadSource(q)) {
        return UploadState.MISSING_FILE;
      }

      if (shouldPreserveMissingOrFailedState(q)) {
        return UploadState.MISSING_FILE;
      }

      if (q.state === UploadState.ATTACHED) {
        if (hasAttachmentEvidenceForItem(q)) {
          return UploadState.ATTACHED;
        }
        return UploadState.IDLE;
      }

      if (
        isUploadUnfinishedState(q.state) ||
        q.state === UploadState.CANCELLED
      ) {
        return UploadState.IDLE;
      }

      if (q.state === UploadState.FAILED) {
        return UploadState.IDLE;
      }

      if (q.state === UploadState.READY || q.state === 'READY') {
        return UploadState.IDLE;
      }

      return q.state || UploadState.IDLE;
    }

    function buildPersistRow(q) {
      const hasHandle = isFileHandleLike(q.fileHandle);

      const row = {
        id: q.id,
        groupId: q.groupId || state.activeGroupId,
        name: q.name,
        displayPath: q.displayPath || q.name || '',
        size: q.size,
        lastModified: q.lastModified,
        type: q.type,
        state: getPersistedUploadState(q),
        message: q.message,
        sourceKind: q.sourceKind || '',
        readMode: q.readMode || '',
        handle: hasHandle ? q.fileHandle : null,
        uploadName: q.uploadName || '',
        manualPathNote: String(q.manualPathNote || '').trim(),
        blob: null,
        blobSaved: false,
        blobSavedAt: 0,
        debugSavedFrom: '',
      };

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][persist-row:no-blob] name=${q.name || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'}`
      );

      return row;
    }

    async function clearPersistedUploadBlobs(reason) {
      if (!APP || !APP.uploadStore) {
        console.warn('[ChatGPT toolbox] clearPersistedUploadBlobs: APP.uploadStore not available');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][clear-persisted-blob:skip] reason=${reason || '-'} error=uploadStore-not-available`,
        );
        return;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:start] reason=${reason || '-'}`,
      );

      let changed = 0;

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => {
            reject(req.error || new Error('IndexedDB uploadStore getAll failed'));
          };

          req.onsuccess = () => {
            const rows = Array.isArray(req.result) ? req.result : [];

            rows.forEach((record) => {
              if (!record) {
                return;
              }

              const hasBlob = record.blob !== null && record.blob !== undefined;

              if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][clear-persisted-blob:item] name=${record.name || '-'} id=${record.id || '-'} oldBlob=${hasBlob ? 1 : 0}`,
                );

                record.blob = null;
                record.blobSaved = false;
                record.blobSavedAt = 0;
                record.debugSavedFrom = '';

                store.put(record);
                changed += 1;
              }
            });
          };

          tx.oncomplete = () => {
            resolve();
          };

          tx.onerror = () => {
            reject(tx.error || new Error('IndexedDB clearPersistedUploadBlobs transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('IndexedDB clearPersistedUploadBlobs transaction aborted'));
          };
        });
      } catch (e) {
        console.error('[ChatGPT toolbox] clearPersistedUploadBlobs failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][clear-persisted-blob:error] reason=${reason || '-'} error=${e && e.message ? e.message : String(e)}`,
        );
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:done] changed=${changed}`,
      );
    }

    function isProtectedUploadGroup(group, activeGroupId) {
      const groupId = String(group && group.id ? group.id : '');
      if (!groupId || groupId === activeGroupId) {
        return true;
      }
      if (groupId === 'default' || String(group.key || '') === 'default') {
        return true;
      }
      return false;
    }

    function isStaleFailedUploadRow(row, now) {
      const stateText = String(row && row.state ? row.state : '');
      const isFailedOrMissing = (
        stateText === UploadState.FAILED
        || stateText === UploadState.MISSING_FILE
      );
      if (!isFailedOrMissing) {
        return false;
      }
      const updatedAt = Number(row.updatedAt || row.createdAt || 0);
      return updatedAt > 0 && now - updatedAt > UPLOAD_DB_FAILED_ROW_TTL_MS;
    }

    async function cleanupUploadDbGarbage(reason) {
      const now = Date.now();

      try {
        const db = await openDb();

        const { groups, rows } = await new Promise((resolve, reject) => {
          const tx = db.transaction([APP.uploadGroupStore, APP.uploadStore], 'readonly');
          const groupStore = tx.objectStore(APP.uploadGroupStore);
          const queueStore = tx.objectStore(APP.uploadStore);

          const groupReq = groupStore.getAll();
          const queueReq = queueStore.getAll();

          let groupsResult = [];
          let rowsResult = [];

          groupReq.onerror = () => {
            reject(groupReq.error || new Error('getAll groups failed'));
          };

          queueReq.onerror = () => {
            reject(queueReq.error || new Error('getAll queue failed'));
          };

          groupReq.onsuccess = () => {
            groupsResult = Array.isArray(groupReq.result) ? groupReq.result : [];
          };

          queueReq.onsuccess = () => {
            rowsResult = Array.isArray(queueReq.result) ? queueReq.result : [];
          };

          tx.oncomplete = () => {
            resolve({ groups: groupsResult, rows: rowsResult });
          };

          tx.onerror = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage read transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage read transaction aborted'));
          };
        });

        const activeGroupId = String(state.activeGroupId || '');
        const groupIds = new Set(
          groups.map((group) => String(group.id || '')).filter(Boolean),
        );

        const rowCountByGroup = new Map();
        rows.forEach((row) => {
          const groupId = String(row.groupId || '');
          rowCountByGroup.set(groupId, (rowCountByGroup.get(groupId) || 0) + 1);
        });

        const queueIdsToDelete = new Set();
        rows.forEach((row) => {
          const groupId = String(row.groupId || '');
          if (!groupId || !groupIds.has(groupId)) {
            queueIdsToDelete.add(row.id);
          }
        });

        rows.forEach((row) => {
          if (queueIdsToDelete.has(row.id)) {
            return;
          }
          if (isStaleFailedUploadRow(row, now)) {
            queueIdsToDelete.add(row.id);
          }
        });

        let survivingRowCount = rows.length - queueIdsToDelete.size;
        if (survivingRowCount > UPLOAD_DB_MAX_QUEUE_ROWS) {
          const overflowCandidates = rows
            .filter((row) => !queueIdsToDelete.has(row.id))
            .filter((row) => {
              const groupId = String(row.groupId || '');
              if (!groupId || !groupIds.has(groupId)) {
                return true;
              }
              return isStaleFailedUploadRow(row, now);
            })
            .sort(
              (a, b) => Number(a.updatedAt || a.createdAt || 0)
                - Number(b.updatedAt || b.createdAt || 0),
            );

          for (const row of overflowCandidates) {
            if (survivingRowCount <= UPLOAD_DB_MAX_QUEUE_ROWS) {
              break;
            }
            if (!queueIdsToDelete.has(row.id)) {
              queueIdsToDelete.add(row.id);
              survivingRowCount -= 1;
            }
          }
        }

        const groupsToDelete = new Set();
        const removableByTtl = groups
          .filter((group) => {
            const groupId = String(group.id || '');
            if (isProtectedUploadGroup(group, activeGroupId)) {
              return false;
            }
            const count = rowCountByGroup.get(groupId) || 0;
            if (count > 0) {
              return false;
            }
            const updatedAt = Number(group.updatedAt || group.createdAt || 0);
            return updatedAt > 0 && now - updatedAt > UPLOAD_DB_EMPTY_GROUP_TTL_MS;
          })
          .sort(
            (a, b) => Number(a.updatedAt || a.createdAt || 0)
              - Number(b.updatedAt || b.createdAt || 0),
          );

        removableByTtl.forEach((group) => {
          groupsToDelete.add(group.id);
        });

        let projectedGroupCount = groups.length - groupsToDelete.size;
        if (projectedGroupCount > UPLOAD_DB_MAX_GROUPS) {
          const moreEmptyGroups = groups
            .filter((group) => {
              const groupId = String(group.id || '');
              if (groupsToDelete.has(groupId) || isProtectedUploadGroup(group, activeGroupId)) {
                return false;
              }
              return (rowCountByGroup.get(groupId) || 0) === 0;
            })
            .sort(
              (a, b) => Number(a.updatedAt || a.createdAt || 0)
                - Number(b.updatedAt || b.createdAt || 0),
            );

          for (const group of moreEmptyGroups) {
            if (projectedGroupCount <= UPLOAD_DB_MAX_GROUPS) {
              break;
            }
            groupsToDelete.add(group.id);
            projectedGroupCount -= 1;
          }
        }

        if (!queueIdsToDelete.size && !groupsToDelete.size) {
          return;
        }

        await new Promise((resolve, reject) => {
          const tx = db.transaction([APP.uploadGroupStore, APP.uploadStore], 'readwrite');
          const groupStore = tx.objectStore(APP.uploadGroupStore);
          const queueStore = tx.objectStore(APP.uploadStore);

          rows.forEach((row) => {
            if (!queueIdsToDelete.has(row.id)) {
              return;
            }
            const groupId = String(row.groupId || '');
            queueStore.delete(row.id);
            const isOrphan = !groupId || !groupIds.has(groupId);
            ToolboxShell.appendLog(
              `[UPLOAD_DB_CLEANUP][${isOrphan ? 'queue_orphan_deleted' : 'queue_row_deleted'}] reason=${reason || '-'} id=${row.id || '-'} groupId=${groupId || '-'} state=${row.state || '-'}`,
            );
          });

          groups.forEach((group) => {
            if (!groupsToDelete.has(group.id)) {
              return;
            }
            groupStore.delete(group.id);
            ToolboxShell.appendLog(
              `[UPLOAD_DB_CLEANUP][empty_group_deleted] reason=${reason || '-'} groupId=${group.id || '-'} name=${group.name || '-'}`,
            );
          });

          tx.oncomplete = () => {
            resolve();
          };

          tx.onerror = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage delete transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage delete transaction aborted'));
          };
        });
      } catch (error) {
        console.error('[ChatGPT toolbox] cleanupUploadDbGarbage failed', error);
        ToolboxShell.appendLog(
          `[UPLOAD_DB_CLEANUP][error] reason=${reason || '-'} error=${error && error.message ? error.message : String(error)}`,
        );
      }
    }

    function openDb() {
      if (dbPromise) return dbPromise;

      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('当前浏览器不支持 IndexedDB'));
          return;
        }

        const req = indexedDB.open(APP.uploadDbName, APP.uploadDbVersion);

        req.onupgradeneeded = () => {
          const db = req.result;

          if (!db.objectStoreNames.contains(APP.uploadStore)) {
            const queueStore = db.createObjectStore(APP.uploadStore, {
              keyPath: 'id',
            });
            queueStore.createIndex('groupId', 'groupId', { unique: false });
          } else {
            const tx = req.transaction;
            const queueStore = tx.objectStore(APP.uploadStore);
            if (!queueStore.indexNames.contains('groupId')) {
              queueStore.createIndex('groupId', 'groupId', { unique: false });
            }
          }

          if (!db.objectStoreNames.contains(APP.uploadGroupStore)) {
            db.createObjectStore(APP.uploadGroupStore, {
              keyPath: 'id',
            });
          }
        };

        req.onsuccess = () => {
          const db = req.result;

          db.onversionchange = () => {
            db.close();
            dbPromise = null;
            ToolboxShell.appendLog('[UPLOAD_DB][versionchange] db closed');
          };

          db.onclose = () => {
            dbPromise = null;
            ToolboxShell.appendLog('[UPLOAD_DB][closed] IndexedDB connection closed');
          };

          db.onerror = (event) => {
            console.error('[ChatGPT toolbox] IndexedDB connection error', event);
            ToolboxShell.appendLog('[UPLOAD_DB][connection-error] IndexedDB connection error');
          };

          resolve(db);
        };

        req.onerror = () => {
          const err = req.error || new Error('IndexedDB open failed');
          dbPromise = null;

          console.error('[ChatGPT toolbox] IndexedDB open failed', err);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[UPLOAD_DB][open:failed] error=${err && err.message ? err.message : String(err)}`,
            );
          }

          reject(err);
        };

        req.onblocked = () => {
          const err = new Error('IndexedDB open blocked by another tab or old connection');
          dbPromise = null;

          console.warn('[ChatGPT toolbox] IndexedDB open blocked');

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog('[UPLOAD_DB][open:blocked] IndexedDB 被其他页面或旧连接阻塞');
          }

          reject(err);
        };
      }).catch((err) => {
        dbPromise = null;
        throw err;
      });

      return dbPromise;
    }

    async function debugReadBackPersistedQueue(stage) {
      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB debug getAll failed'));
        });

        const currentRows = rows.filter((r) => r.groupId === state.activeGroupId);

        const summary = currentRows.map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state,
          blobSaved: !!r.blobSaved,
          hasBlob: isBlobLike(r.blob),
          blobTag: r.blob ? getObjectTag(r.blob) : '',
          blobSize: r.blob && typeof r.blob.size === 'number' ? r.blob.size : null,
          hasHandle: !!r.handle,
          handleName: r.handle && r.handle.name ? r.handle.name : '',
          debugSavedFrom: r.debugSavedFrom || '',
          message: r.message || '',
        }));

        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB回读 ${summary.length} 条：${summary.map((x) => `${x.name}:blob=${x.hasBlob ? 1 : 0},handle=${x.hasHandle ? 1 : 0},state=${x.state}`).join('|')}`);

        console.debug('[ChatGPT toolbox] persisted queue readback', {
          stage,
          activeGroupId: state.activeGroupId,
          summary,
        });
      } catch (e) {
        console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB回读失败${e && e.message ? e.message : String(e)}`);
      }
    }

    async function persistQueue() {
      const groupIdSnapshot = String(state.activeGroupId || '').trim();
      if (!groupIdSnapshot) {
        console.warn('[ChatGPT toolbox] persistQueue: activeGroupId 为空');
        return;
      }

      const queueSnapshot = getActiveGroupFiles().map((item) => ({
        ...item,
        groupId: groupIdSnapshot,
      }));

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll before persist failed'));

          req.onsuccess = () => {
            const rows = req.result || [];

            rows.forEach((r) => {
              const gid = String(r.groupId || '').trim() || groupIdSnapshot;
              if (gid === groupIdSnapshot) {
                store.delete(r.id);
              }
            });

            queueSnapshot.forEach((q) => {
              const row = buildPersistRow({
                ...q,
                groupId: groupIdSnapshot,
              });

              const putReq = store.put(row);

              putReq.onerror = (ev) => {
                if (!row.handle) {
                  return;
                }

                const err = putReq.error || new Error('IndexedDB put with handle failed');

                console.error('[ChatGPT toolbox] persist row with handle failed, retry without handle', err);
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][persist:handle-failed] name=${row.name || '-'} error=${err && err.message ? err.message : String(err)}`,
                );

                if (typeof ev.preventDefault === 'function') {
                  ev.preventDefault();
                }

                if (typeof ev.stopPropagation === 'function') {
                  ev.stopPropagation();
                }

                store.put({
                  ...row,
                  handle: null,
                });
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue persist transaction failed'));
        });

        await debugReadBackPersistedQueue('persistQueue:after-write');
        await refreshUploadGroupCounts();
        void cleanupUploadDbGarbage('persist-queue');
      } catch (e) {
        const errText = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
        console.error('[ChatGPT toolbox] persist upload queue failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persistQueue:failed] groupId=${groupIdSnapshot} queueLen=${queueSnapshot.length} error=${errText}`,
        );
        throw e;
      }
    }

    const UPLOAD_PERSIST_TIMEOUT_MS = 8000;

    function withTimeout(promise, timeoutMs, label) {
      let timer = 0;

      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => {
            reject(new Error(`${label || 'operation'} timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timer) {
          window.clearTimeout(timer);
        }
      });
    }

    function schedulePersistQueue() {
      persistQueuePromise = persistQueuePromise
        .catch((e) => {
          const errText = e && e.message ? e.message : String(e);
          console.warn('[ChatGPT toolbox] previous persistQueue failed before next run', e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][persistQueue:previous-failed] error=${errText}`
          );
        })
        .then(async () => {
          const startedAt = Date.now();

          const timeoutTimer = window.setTimeout(() => {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:slow] running>${UPLOAD_PERSIST_TIMEOUT_MS}ms`
            );
          }, UPLOAD_PERSIST_TIMEOUT_MS);

          try {
            await withTimeout(
              persistQueue(),
              UPLOAD_PERSIST_TIMEOUT_MS,
              'persistQueue',
            );
          } finally {
            window.clearTimeout(timeoutTimer);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:done] cost=${Date.now() - startedAt}ms`
            );
          }
        })
        .then(() => {
          renderProjectCategoryChips();
          renderManageGroupList();
        })
        .catch((e) => {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);

          console.warn('[ChatGPT toolbox] schedulePersistQueue failed or timeout', e);

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][persistQueue:failed-or-timeout] type=${errName} timeoutMs=${UPLOAD_PERSIST_TIMEOUT_MS} note=timeout-does-not-cancel-indexeddb-write error=${errText}`,
          );

          setStatus(`上传队列保存失败或超时：${errText}`, 'error');

          throw e;
        });

      return persistQueuePromise;
    }

    function persistQueueInBackground(stage) {
      void schedulePersistQueue()
        .then(() => {
          ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}:persist-ok]`);
        })
        .catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] background persist failed', stage, err);
          ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}:persist-failed] ${errText}`);
        });
    }

    function persistQueueThrottled(stage, delayMs = 600) {
      persistQueuePendingStage = stage || persistQueuePendingStage || '-';

      if (persistQueueThrottleTimer) {
        return;
      }

      persistQueueThrottleTimer = window.setTimeout(() => {
        const stageText = persistQueuePendingStage;
        persistQueuePendingStage = '';
        persistQueueThrottleTimer = 0;

        persistQueueInBackground(stageText);
      }, delayMs);
    }

    function stripTrailingCountFromGroupName(name) {
      return String(name || '').replace(/\s+\d+$/, '').trim();
    }

    function syncActiveGroupCountInCache() {
      if (!state.groupCounts) {
        state.groupCounts = new Map();
      }

      state.groups.forEach((group) => {
        if (!state.groupCounts.has(group.id)) {
          state.groupCounts.set(group.id, 0);
        }
      });

      if (state.activeGroupId) {
        state.groupCounts.set(state.activeGroupId, getActiveGroupFiles().length);
      }
    }

    function getUploadGroupFileCount(groupId) {
      if (state.groupCounts && state.groupCounts.has(groupId)) {
        return state.groupCounts.get(groupId) || 0;
      }

      if (groupId === state.activeGroupId) {
        return getActiveGroupFiles().length;
      }

      return 0;
    }

    async function refreshUploadGroupCounts() {
      const counts = new Map();

      state.groups.forEach((group) => {
        counts.set(group.id, 0);
      });

      if (!state.groups.length) {
        state.groupCounts = counts;
        return true;
      }

      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
          req.onerror = () => reject(req.error || new Error('refreshUploadGroupCounts getAll failed'));
        });

        rows.forEach((row) => {
          const groupId = String(row.groupId || '').trim();
          if (!groupId) {
            return;
          }
          if (!counts.has(groupId)) {
            return;
          }
          counts.set(groupId, (counts.get(groupId) || 0) + 1);
        });

        state.groupCounts = counts;
        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] refreshUploadGroupCounts failed', e);
        syncActiveGroupCountInCache();
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][refresh-counts:failed] activeGroupId=${state.activeGroupId || '-'} groups=${state.groups.length} type=${errName} error=${errText}`,
        );
        setStatus(`上传分组数量刷新失败：${errText}`, 'error');
        return false;
      }
    }

    function renderUploadGroupChipHtml(group, activeGroupId) {
      const active = group.id === activeGroupId ? ' active' : '';
      const count = getUploadGroupFileCount(group.id);
      const cleanName = stripTrailingCountFromGroupName(group.name);
      const title = `${cleanName}：${count} 个文件`;

      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip${active}"
            data-group-id="${escapeHtml(group.id)}"
            title="${escapeHtml(title)}">
            <span class="cgpt-chip-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-chip-count">${count}</span>
          </button>
        `;
    }

    async function persistGroups() {
      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readwrite');
          const store = tx.objectStore(APP.uploadGroupStore);

          const clearReq = store.clear();

          clearReq.onerror = () => reject(clearReq.error || new Error('IndexedDB groups clear failed'));
          clearReq.onsuccess = () => {
            state.groups.forEach((g) => {
              const putReq = store.put(g);

              putReq.onerror = () => {
                reject(putReq.error || new Error(`IndexedDB groups put failed: ${g && g.id ? g.id : '-'}`));
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB groups transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB groups transaction aborted'));
        });
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] persist upload groups failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][persist-failed] groups=${state.groups.length} activeGroupId=${state.activeGroupId || '-'} type=${errName} error=${errText}`,
        );
        setStatus(`上传分组保存失败：${errText}`, 'error');
        throw e;
      }
    }

    async function loadGroups() {
      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readonly');
          const store = tx.objectStore(APP.uploadGroupStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB groups getAll failed'));
        });

        state.groups = rows;

        if (!state.groups.length) {
          const defaultGroup = createDefaultGroup();
          state.groups = [defaultGroup];
          state.activeGroupId = defaultGroup.id;
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][CREATE_DEFAULT_GROUP] store=${APP.uploadGroupStore} activeGroupId=${state.activeGroupId || '-'}`,
          );
          await persistGroups();
          saveCurrentToolboxBaseState('upload-default-group-created');
          ensureActiveUploadGroupIdValid('load-groups-default-created');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'loadGroups:created-default' });
          void cleanupUploadDbGarbage('load-groups');
          return;
        }

        await ensureUploadGroupStableKeys();
        migrateLegacyUploadSelectionIfNeeded();

        const pageState = getToolboxPageState();
        const resolved = resolveUploadGroupSelection({
          pageState,
          reason: 'load-groups',
        });
        state.activeGroupId = resolved.resolvedGroupId || '';

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][active-resolve] pageGroup=${resolved.pageGroupId || '-'} globalGroup=${resolved.uploadLastActiveGroupId || '-'} active=${state.activeGroupId || '-'} source=${resolved.reason || '-'}`,
        );

        ensureActiveUploadGroupIdValid('load-groups');
        syncUploadGroupAppState();
        appendUploadGroupLog('INIT', { stage: 'loadGroups:ok' });
        void cleanupUploadDbGarbage('load-groups');
      } catch (e) {
        const errStack = e && e.stack ? e.stack : String(e);
        const errName = e && e.name ? e.name : 'Error';
        console.error('[ChatGPT toolbox] load upload groups failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][load-failed] store=${APP.uploadGroupStore} type=${errName} error=${errStack}`,
        );
        setStatus(
          '读取文件组失败，当前为临时默认分组，请勿立即导入/删除分组；请刷新或检查 IndexedDB',
          'error',
        );

        if (!state.groups.length) {
          const tempGroup = createDefaultGroup();
          tempGroup.__temporary = true;
          state.groups = [tempGroup];
          state.activeGroupId = tempGroup.id;
        }

        ensureActiveUploadGroupIdValid('load-groups-failed');
        syncUploadGroupAppState();
        appendUploadGroupLog('INIT', { stage: 'loadGroups:failed-temp' });
      }
    }

    function resolveLegacyMissingGroupTargetId() {
      const resolved = resolveUploadGroupSelection({
        pageState: getToolboxPageState(),
        reason: 'legacy-missing-group',
      });
      return resolved.resolvedGroupId || '';
    }

    async function migrateMissingGroupIdRows() {
      const targetId = resolveLegacyMissingGroupTargetId();

      if (!targetId) {
        ToolboxShell.appendLog('[UPLOAD_GROUP][migrate-missing-group-skip] reason=no-target-group');
        return false;
      }

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));

          req.onsuccess = () => {
            const rows = req.result || [];
            let changed = 0;

            rows.forEach((r) => {
              if (!r.groupId) {
                r.groupId = targetId;
                store.put(r);
                changed += 1;
              }
            });

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][migrate-missing-group] target=${targetId} changed=${changed}`,
            );
            if (changed > 0) {
              ToolboxShell.appendLog(
                `[UPLOAD_GROUP][LEGACY_MIGRATE_HIT] count=${changed}`,
              );
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB queue migration transaction aborted'));
        });

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        console.error('[ChatGPT toolbox] migrate missing groupId rows failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][migrate-missing-group-error] target=${targetId || '-'} type=${errName} error=${errText}`,
        );

        setStatus(`上传队列兼容迁移失败：${errText}`, 'error');

        return false;
      }
    }

    function restoreHandleBackedUploadItem(item, restoredState, hasBlob) {
      item.sourceKind = 'local-handle';
      item.readMode = 'handle';
      item.state = UploadState.IDLE;
      item.message = '';

      if (restoredState === UploadState.ATTACHED) {
        if (hasAttachmentEvidenceForItem(item)) {
          item.state = UploadState.ATTACHED;
          item.attachedInSession = true;
          item.message = '';
        } else {
          item.persistedAttached = true;
          item.state = UploadState.IDLE;
          item.message = '上次已上传，刷新后请点击上传';
          item.uploadName = '';
        }
      } else {
        item.state = normalizeUploadState(restoredState, true);
      }

      return false;
    }

        // [DEPRECATED] Blob persistence is disabled
    function restoreBlobBackedUploadItem(item, row, restoredState) {
      console.warn('[ChatGPT toolbox] restoreBlobBackedUploadItem called but blob persistence is disabled');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][restore-blob:deprecated] name=${item.name || '-'} id=${item.id || '-'}`
      );
      return restoreMissingUploadItem(item, restoredState);
    }

    function restoreMissingUploadItem(item, restoredState) {
      item.sourceKind = 'missing-file';
      item.readMode = '';
      item.state = UploadState.MISSING_FILE;
      item.message = '缺少文件，请重新拖入';
      item.uploadName = '';

      if (restoredState === UploadState.ATTACHED) {
        item.persistedAttached = true;
      }

      return true;
    }

        function restoreUploadItemFromPersistRow(row, activeGroupId) {
      const restoredState = row.state || UploadState.IDLE;
      const hasBlob = false;
      const handle = row.handle || null;

      const item = {
        id: row.id || newId(),
        groupId: row.groupId || activeGroupId,
        name: row.name || 'unknown',
        displayPath: row.displayPath || row.name || 'unknown',
        size: Number(row.size) || 0,
        lastModified: Number(row.lastModified) || 0,
        type: row.type || 'application/octet-stream',
        file: null,
        blob: null,
        fileHandle: handle && isFileHandleLike(handle) ? handle : null,
        state: UploadState.IDLE,
        message: '',
        uploadName: row.uploadName || '',
        manualPathNote: String(row.manualPathNote || '').trim(),
        persistedAttached: false,
        attachedInSession: false,
        sourceKind: row.sourceKind || '',
        readMode: row.readMode || '',
      };

      let needsReDrag = false;

      if (item.fileHandle) {
        needsReDrag = restoreHandleBackedUploadItem(item, restoredState, false);
      } else {
        needsReDrag = restoreMissingUploadItem(item, restoredState);
      }

      console.debug('[ChatGPT toolbox] loadQueue row restore', {
        row: {
          id: row.id,
          name: row.name,
          state: row.state,
          hasHandle: !!row.handle,
        },
        item: describeUploadSource(item),
        needsReDrag,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][restore-row] name=${item.name || '-'} blob=0 handle=${item.fileHandle ? 1 : 0} sourceKind=${item.sourceKind || '-'} readMode=${item.readMode || '-'}`,
      );

      logUploadItemSource('loadQueue:item-restored', item, {
        reason: needsReDrag ? 'missing-readable-source' : 'restored-readable-source',
      });

      return item;
    }

    async function loadQueueForActiveGroup() {
      if (!state.activeGroupId) {
        console.warn('[ChatGPT toolbox] loadQueueForActiveGroup: activeGroupId 为空');
        state.queue = [];
        render();
        return;
      }

      try {
        const db = await openDb();

        const migrated = await migrateMissingGroupIdRows();

        if (migrated === false) {
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][load-queue:migrate-skipped] groupId=${state.activeGroupId || '-'} note=legacy-rows-without-groupId-may-be-invisible`,
          );
        }

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);

          if (store.indexNames.contains('groupId')) {
            const index = store.index('groupId');
            const req = index.getAll(state.activeGroupId);

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error || new Error('IndexedDB queue group index getAll failed'));
            return;
          }

          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll failed'));
        });

        state.queue = rows
          .filter((r) => String(r.groupId || '').trim() === state.activeGroupId)
          .map((r) => restoreUploadItemFromPersistRow(r, state.activeGroupId));

        refreshQueueReadableState();
        syncActiveGroupSelectionAfterQueueLoad(state.activeGroupId);
        await refreshUploadGroupCounts();
        dedupeActiveGroupQueue('load-queue');
        render();
        logUploadQueueSnapshot('loadQueue:after-load');
      } catch (e) {
        console.warn('[ChatGPT toolbox] load upload queue for group failed', e);
        state.queue = [];
        dedupeActiveGroupQueue('load-queue');
        syncActiveGroupCountInCache();
        render();
        setStatus(`上传队列恢复失败：${e && e.message ? e.message : String(e)}`);
      }
    }

    function isHardFileReadFailure(reason) {
      const text = String(reason || '');

      return text.includes('缺少文件，请重新拖入') ||
        text.includes('没有本地文件读取权限') ||
        text.includes('本地文件读取失败') ||
        text.includes('本地文件为空或读取失败') ||
        text.includes('缺少可读取的文件对象') ||
        text.includes('请重新拖入') ||
        text.includes('没有可上传的 File 对象');
    }

    function hasAttachmentEvidenceForItem(q) {
      if (!q) return false;

      const haystack = ComposerApi.collectAttachmentChipText();

      const names = [
        q.uploadName,
        q.name,
      ].filter(Boolean);

      return names.some((name) => ComposerApi.fileNameEvidence(name, haystack));
    }

    async function reconcileFailedItems() {
      const candidates = state.queue.filter((q) =>
        q.state === UploadState.FAILED ||
        isLegacyUploadState(q.state)
      );

      for (const q of candidates) {
        if (hasAttachmentEvidenceForItem(q)) {
          updateItem(q.id, {
            state: UploadState.ATTACHED,
            message: '',
          });

          ToolboxShell.appendLog(`失败条目已复核为成功：${q.name}`);
        }
      }
    }

    function getActiveGroup() {
      return state.groups.find((g) => g.id === state.activeGroupId) || null;
    }

    function getActiveGroupName() {
      const g = getActiveGroup();
      return g ? g.name : '未命名组';
    }

    function normalizeUploadFolderPath(value) {
      return String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .trim()
        .toLowerCase();
    }

    function deriveUploadGroupStableKey(group) {
      if (!group || typeof group !== 'object') {
        return '';
      }

      const existingKey = String(group.key || '').trim();
      if (existingKey) {
        return existingKey;
      }

      const cleanName = stripTrailingCountFromGroupName(group.name || '');
      if (UPLOAD_PROJECT_NAME_KEY_MAP[cleanName]) {
        return UPLOAD_PROJECT_NAME_KEY_MAP[cleanName];
      }

      const slug = cleanName
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (slug) {
        return slug;
      }

      return String(group.id || '').trim();
    }

    function getUploadGroupStableKey(group) {
      return deriveUploadGroupStableKey(group);
    }

    function getUploadFileFolderKey(file) {
      if (!file || typeof file !== 'object') {
        return '';
      }

      const fileId = String(file.id || '').trim();
      if (fileId) {
        return fileId;
      }

      const normalizedPath = normalizeUploadFolderPath(
        file.displayPath || file.webkitRelativePath || file.manualPathNote || file.name || '',
      );
      return normalizedPath;
    }

    function persistCompactUiConfigPatch(patch) {
      const cfg = getCompactUiConfig();
      const next = Object.assign({}, cfg, patch || {});

      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
        SettingsModule.saveConfig(next);
      } else {
        MemoryManager.set(
          MemoryManager.KEYS.compactUiConfig,
          normalizeCompactUiConfig(next),
        );
      }
    }

    function getMultiUploadLastSelection() {
      const cfg = getCompactUiConfig();
      const selection = cfg.multiUploadLastSelection || {};
      return {
        projectKey: typeof selection.projectKey === 'string' ? selection.projectKey : '',
        folderKey: typeof selection.folderKey === 'string' ? selection.folderKey : '',
        updatedAt: Number(selection.updatedAt) || 0,
      };
    }

    function saveMultiUploadLastSelection(next) {
      const current = getMultiUploadLastSelection();

      const projectKey = typeof next.projectKey === 'string'
        ? next.projectKey
        : current.projectKey;

      const folderKey = typeof next.folderKey === 'string'
        ? next.folderKey
        : current.folderKey;

      const savedSelection = {
        projectKey,
        folderKey,
        updatedAt: Date.now(),
      };

      persistCompactUiConfigPatch({
        multiUploadLastSelection: savedSelection,
      });

      if (projectKey && !folderKey) {
        console.info(
          '[MULTI_UPLOAD][LAST_SELECTION][SAVE_FOLDER_EMPTY]',
          { projectKey },
        );
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[MULTI_UPLOAD][LAST_SELECTION][SAVE_FOLDER_EMPTY] projectKey=${projectKey}`,
          );
        }
      }

      console.info('[MULTI_UPLOAD][LAST_SELECTION][SAVE]', savedSelection);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][LAST_SELECTION][SAVE] projectKey=${projectKey || '-'} folderKey=${folderKey || '-'}`,
        );
      }
    }

    function logMultiUploadLastSelectionEvent(tag, payload = {}) {
      const line = `[MULTI_UPLOAD][LAST_SELECTION][${tag}] ${JSON.stringify(payload)}`;
      console.info(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }

    async function ensureUploadGroupStableKeys() {
      let changed = false;

      state.groups.forEach((group) => {
        if (!group) {
          return;
        }

        const nextKey = deriveUploadGroupStableKey(group);
        if (group.key !== nextKey) {
          group.key = nextKey;
          group.updatedAt = Date.now();
          changed = true;
        }
      });

      if (changed) {
        await persistGroups();
      }
    }

    function migrateLegacyUploadSelectionIfNeeded() {
      const saved = getMultiUploadLastSelection();
      if (saved.projectKey) {
        return;
      }

      const legacyId = String(
        MemoryManager.get(MemoryManager.KEYS.lastManualUploadGroupId, '') || '',
      ).trim();
      if (!legacyId) {
        return;
      }

      const group = state.groups.find((item) => item && item.id === legacyId);
      if (!group) {
        return;
      }

      saveMultiUploadLastSelection({
        projectKey: getUploadGroupStableKey(group),
        folderKey: '',
      });
    }

    function isValidUploadGroupId(groupId) {
      const id = String(groupId || '').trim();
      return Boolean(id && state.groups.some((g) => g.id === id));
    }

    function resolveUploadGroupSelection(options = {}) {
      const pageState = options.pageState && typeof options.pageState === 'object'
        ? options.pageState
        : getToolboxPageState();
      const groups = Array.isArray(options.groups) ? options.groups : state.groups;
      const excludeGroupId = String(options.excludeGroupId || '').trim();

      const savedSelection = getMultiUploadLastSelection();
      const savedProjectKey = String(savedSelection.projectKey || '').trim();
      const savedFolderKey = String(savedSelection.folderKey || '').trim();

      const pageGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();
      const lastManualGroupId = getLastManualUploadGroupId();
      const uploadLastActiveGroupId = getUploadLastActiveGroupId();
      const stateActiveGroupId = String(state.activeGroupId || '').trim();
      const firstGroupId = groups[0] && groups[0].id
        ? String(groups[0].id).trim()
        : '';

      function isValidInGroups(id) {
        const trimmed = String(id || '').trim();
        return Boolean(trimmed && groups.some((g) => g && g.id === trimmed));
      }

      function findGroupIdForKey(projectKey) {
        const key = String(projectKey || '').trim();
        if (!key) return '';
        const found = groups.find((g) => g && getUploadGroupStableKey(g) === key);
        return (found && found.id) || '';
      }

      let resolvedGroupId = '';
      let reason = 'none';

      if (savedProjectKey) {
        const groupIdFromSaved = findGroupIdForKey(savedProjectKey);
        if (isValidInGroups(groupIdFromSaved) && groupIdFromSaved !== excludeGroupId) {
          resolvedGroupId = groupIdFromSaved;
          reason = 'multi-upload-last-selection';
        } else {
          if (groupIdFromSaved && groupIdFromSaved === excludeGroupId) {
            logMultiUploadLastSelectionEvent('EXCLUDE_DELETED_GROUP', {
              saved: savedProjectKey,
              excludedGroupId: excludeGroupId,
            });
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog('[MULTI_UPLOAD][SELECTION][EXCLUDE_DELETED_GROUP]');
            }
          } else {
            logMultiUploadLastSelectionEvent('PROJECT_MISSING', {
              saved: savedProjectKey,
            });
          }
        }
      }

      if (!resolvedGroupId) {
        const fallthroughCandidates = [
          { id: pageGroupId, reason: 'page-state' },
          { id: lastManualGroupId, reason: 'last-manual' },
          { id: uploadLastActiveGroupId, reason: 'upload-last-active' },
          { id: stateActiveGroupId, reason: 'state-active' },
          { id: firstGroupId, reason: 'first-group' },
        ];

        for (const candidate of fallthroughCandidates) {
          if (isValidInGroups(candidate.id) && candidate.id !== excludeGroupId) {
            resolvedGroupId = candidate.id;
            reason = candidate.reason;
            break;
          }
        }
      }

      let resolvedFolderKey = '';
      if (resolvedGroupId && savedFolderKey && reason === 'multi-upload-last-selection') {
        const group = groups.find((item) => item && item.id === resolvedGroupId) || null;
        const groupKey = getUploadGroupStableKey(group);
        if (groupKey === savedProjectKey) {
          const files = (state.queue || []).filter(
            (file) => file && String(file.groupId || '').trim() === resolvedGroupId,
          );
          const savedFile = files.find(
            (file) => file && getUploadFileFolderKey(file) === savedFolderKey,
          );
          if (savedFile) {
            resolvedFolderKey = savedFolderKey;
          } else if (files.length > 0) {
            resolvedFolderKey = getUploadFileFolderKey(files[0]) || '';
            logMultiUploadLastSelectionEvent('FOLDER_MISSING', {
              projectKey: groupKey,
              savedFolder: savedFolderKey,
              fallback: resolvedFolderKey,
            });
          }
        }
      }

      const result = {
        reason,
        savedProjectKey,
        pageGroupId,
        lastManualGroupId,
        uploadLastActiveGroupId,
        stateActiveGroupId,
        resolvedGroupId,
        resolvedFolderKey,
        groupId: resolvedGroupId,
        source: reason,
      };

      console.info('[MULTI_UPLOAD][SELECTION][RESOLVE]', result);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][SELECTION][RESOLVE] reason=${reason} savedProjectKey=${savedProjectKey || '-'} `
          + `pageGroupId=${pageGroupId || '-'} lastManualGroupId=${lastManualGroupId || '-'} `
          + `uploadLastActiveGroupId=${uploadLastActiveGroupId || '-'} stateActiveGroupId=${stateActiveGroupId || '-'} `
          + `resolvedGroupId=${resolvedGroupId || '-'} resolvedFolderKey=${resolvedFolderKey || '-'}`,
        );
      }

      return result;
    }

    function getLastManualUploadGroupId() {
      const id = String(
        MemoryManager.get(MemoryManager.KEYS.lastManualUploadGroupId, '') || '',
      ).trim();

      if (!id) {
        return '';
      }

      return state.groups.some((g) => g.id === id) ? id : '';
    }

    function saveLastManualUploadGroupId(groupId, reason = '') {
      const id = String(groupId || '').trim();

      if (!id) {
        return;
      }

      if (!state.groups.some((g) => g.id === id)) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][save-last-manual-skip] reason=${reason || '-'} groupId=${id} exists=0`,
        );
        return;
      }

      MemoryManager.set(MemoryManager.KEYS.lastManualUploadGroupId, id);

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][save-last-manual] reason=${reason || '-'} groupId=${id}`,
      );
    }

    function saveUploadLastActiveGroupId(groupId, reason = '') {
      const id = String(groupId || '').trim();
      if (!id) {
        return;
      }
      if (!state.groups.some((g) => g.id === id)) {
        return;
      }
      MemoryManager.set(MemoryManager.KEYS.uploadLastActiveGroupId, id);
      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][save-global-active] reason=${reason || '-'} groupId=${id}`,
      );
    }

    function getUploadLastActiveGroupId() {
      const id = String(MemoryManager.get(MemoryManager.KEYS.uploadLastActiveGroupId, '') || '').trim();
      return state.groups.some((g) => g.id === id) ? id : '';
    }

    async function switchGroup(groupId, options = {}) {
      if (!groupId) return;

      appendUploadGroupLog('SWITCH', {
        targetGroupId: groupId,
        fromGroupId: getActiveGroupId() || '-',
        reason: options.reason || '-',
      });

      healStaleUploadRunningLockIfNeeded('switchGroup');

      if (state.running) {
        setStatus('正在上传中，不能切换分组');
        return;
      }

      const exists = state.groups.some((g) => g.id === groupId);
      if (!exists) {
        console.warn('[ChatGPT toolbox] switchGroup: 分组不存在', groupId);
        ToolboxShell.appendLog(`[UPLOAD_GROUP][switch:missing] groupId=${groupId || '-'}`);
        setStatus('切换失败：分组不存在', 'error');
        return;
      }

      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      try {
        await schedulePersistQueue();

        state.activeGroupId = groupId;

        await loadQueueForActiveGroup();

        if (options.saveGlobalFallback === true) {
          saveUploadLastActiveGroupId(groupId, options.reason || 'switch-group');
        }

        if (options.saveLastManual !== false) {
          saveLastManualUploadGroupId(groupId, options.reason || 'switch-group');
          lastManualUploadGroupAt = Date.now();
          saveUploadLastActiveGroupId(groupId, options.reason || 'switch-group');
        }

        saveMultiUploadSelectionForActiveGroup();

        if (options.savePageState !== false) {
          saveCurrentToolboxBaseState(options.reason || 'active-upload-group-change');
        }

        render();
        setStatus(`已切换到 ${getActiveGroupName()}`, 'success');

        syncUploadGroupAppState();
        appendUploadGroupLog('SWITCH', {
          phase: 'ok',
          fromGroupId: prevActiveGroupId || '-',
          targetGroupId: groupId || '-',
        });
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:ok] from=${prevActiveGroupId || '-'} to=${groupId || '-'} count=${getActiveGroupFiles().length} selected=${getSelectedFileIdForActiveGroup() || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] switchGroup failed', e);

        setStatus(`切换分组失败，已恢复原分组：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:failed-rollback] from=${prevActiveGroupId || '-'} to=${groupId || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    function buildRandomGroupName() {
      const tag = buildUploadTimestamp().slice(0, 20);
      const baseName = `项目_${tag}`;

      const existingNames = new Set(
        state.groups.map((g) => String(g.name || '').trim())
      );

      return buildUniqueName(baseName, existingNames);
    }

    function buildNextGroupName() {
      return buildRandomGroupName();
    }

    async function createGroupInline() {
      healStaleUploadRunningLockIfNeeded('createGroupInline');

      if (state.running) {
        setStatus('正在上传中，不能新建分组');
        return;
      }

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      try {
        await schedulePersistQueue();

        const groupName = buildNextGroupName();

        const group = {
          id: createId('upload_group'),
          name: groupName,
          key: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        group.key = deriveUploadGroupStableKey(group);

        state.groups.push(group);
        state.activeGroupId = group.id;
        state.activeId = '';
        state.selectedFileIdByGroup[group.id] = '';
        state.queue = [];

        await persistGroups();
        await schedulePersistQueue();

        saveLastManualUploadGroupId(group.id, 'create-group-inline');
        saveUploadLastActiveGroupId(group.id, 'create-group-inline');

        saveCurrentToolboxBaseState('create-group-inline');
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][save-page-active-group] reason=create-group-inline groupId=${group.id}`,
        );

        if (managePanelEl && managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
          managePanelEl.classList.remove('cgpt-toolbox-hidden');
        }

        render();

        syncGroupManagePanel({
          force: true,
        });

        if (groupNameInputEl) {
          groupNameInputEl.focus();
          groupNameInputEl.select();
        }

        setStatus(`已新建分组：${group.name}`, 'success');
        ToolboxShell.appendLog(`[UPLOAD_GROUP][create-inline:ok] groupId=${group.id} name=${group.name}`);
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] createGroupInline failed', e);

        setStatus(`新建分组失败，已恢复原状态：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][create-inline:failed-rollback] type=${errName} error=${errText}`,
        );

        throw e;
      }
    }


    function refreshUploadGroupDomRefs(rootEl) {
      const root = rootEl || rootElRef || host || document;

      groupListEl = qs('#cgpt-upload-group-list', root);
      managePanelEl = qs('#cgpt-upload-manage-panel', root);
      manageGroupListEl = qs('#cgpt-upload-manage-group-list', root);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', root);

      return root;
    }

    function toggleGroupManagePanel(source = 'unknown') {
      const root = rootElRef || host || document;

      if (rootElRef) {
        ensureUploadGroupSection(rootElRef);
      }

      refreshUploadGroupDomRefs(root);

      if (!managePanelEl) {
        const errText = 'missing #cgpt-upload-manage-panel';
        console.error('[ChatGPT toolbox] toggleGroupManagePanel failed:', errText);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][MANAGE_TOGGLE_FAILED] source=${String(source || '-')} reason=${errText}`,
        );
        return false;
      }

      const wasHidden = managePanelEl.classList.contains('cgpt-toolbox-hidden');
      managePanelEl.classList.toggle('cgpt-toolbox-hidden', !wasHidden);

      ToolboxShell.appendLog(
        `[UPLOAD_GROUP_MANAGE][TOGGLE] visible=${wasHidden ? 'true' : 'false'}`,
      );

      ToolboxShell.appendLog(
        `[UPLOAD_GROUP][MANAGE_TOGGLE] source=${String(source || '-')} visible=${wasHidden ? '1' : '0'}`,
      );

      if (wasHidden) {
        syncGroupManagePanel({ force: true });
      }

      return true;
    }

    function renderManageGroupList() {
      if (!manageGroupListEl) return;

      if (!state.groups.length) {
        manageGroupListEl.innerHTML = renderEmptyState(
          '暂无分组',
          'cgpt-upload-manage-empty cgpt-empty-state',
        );
        return;
      }

      manageGroupListEl.innerHTML = state.groups.map((g) => {
        const active = g.id === state.activeGroupId ? ' active' : '';
        const count = getUploadGroupFileCount(g.id);
        const cleanName = stripTrailingCountFromGroupName(g.name);

        return `
          <button type="button"
            class="cgpt-upload-manage-group-item${active}"
            data-group-id="${escapeHtml(g.id)}"
            title="${escapeHtml(`${cleanName} · ${count} 个文件`)}">
            <span class="cgpt-upload-manage-group-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-upload-manage-group-count">${count} 个</span>
          </button>
        `;
      }).join('');
    }

    function syncGroupManagePanel(options = {}) {
      const group = getActiveGroup();

      renderManageGroupList();

      const force = options.force === true;
      const inputFocused = document.activeElement === groupNameInputEl;

      if (groupNameInputEl && (force || !inputFocused)) {
        const nextName = group ? group.name : '';
        groupNameInputEl.value = nextName;
        lastGroupNameInputValue = nextName;
      }

      // Blob persistence disabled - sync removed

      const uniqueNameEl = qs('#cgpt-upload-use-unique-name-inline', host || document);

      if (uniqueNameEl) {
        uniqueNameEl.checked = isUploadUseUniqueFileNameEnabled();
      }

      const clearBtn = qs('#cgpt-upload-group-clear-inline', host || document);
      if (clearBtn) {
        clearBtn.textContent = '清空当前组';
      }

      const deleteBtn = qs('#cgpt-upload-group-delete-inline', host || document);
      if (deleteBtn) {
        deleteBtn.textContent = '删除当前组';
      }

      clearConfirmUntil = 0;
      deleteConfirmUntil = 0;
    }

    async function renameActiveGroupInline() {
      const group = getActiveGroup();

      if (!group) {
        setStatus('缺少文件，请重新拖入');
        return false;
      }

      const text = String(groupNameInputEl ? groupNameInputEl.value : '').trim();

      if (!text) {
        setStatus('请输入分组名称');
        console.warn('[ChatGPT toolbox] renameActiveGroupInline: 分组名称为空');
        return false;
      }

      if (text === group.name) {
        setStatus(`分组名称未变化：${group.name}`);
        return true;
      }

      if (state.groups.some((g) => g.id !== group.id && g.name === text)) {
        setStatus('分组名称已存在');
        return false;
      }

      const prevName = group.name;
      const prevUpdatedAt = group.updatedAt;
      const nextName = normalizeEntityName(text);

      try {
        group.name = nextName;
        group.updatedAt = Date.now();

        await persistGroups();

        lastGroupNameInputValue = group.name;

        renderProjectCategoryChips();
        renderManageGroupList();
        render();
        syncGroupManagePanel();

        setStatus(`已保存分组名称：${group.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][rename-inline:ok] groupId=${group.id || '-'} oldName=${prevName || '-'} newName=${group.name || '-'}`,
        );

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        group.name = prevName;
        group.updatedAt = prevUpdatedAt;

        if (groupNameInputEl) {
          groupNameInputEl.value = prevName;
        }

        renderProjectCategoryChips();
        renderManageGroupList();
        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] renameActiveGroupInline failed', e);

        setStatus(`保存分组名称失败，已恢复原名称：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][rename-inline:failed-rollback] groupId=${group.id || '-'} oldName=${prevName || '-'} nextName=${nextName || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function deleteGroupQueue(groupId) {
      const targetGroupId = String(groupId || '').trim();

      if (!targetGroupId) {
        const msg = 'deleteGroupQueue skipped: empty groupId';
        console.warn(`[ChatGPT toolbox] ${msg}`);
        ToolboxShell.appendLog('[UPLOAD_GROUP][delete-queue:skip] groupId为空');
        return;
      }

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => {
            reject(req.error || new Error('IndexedDB getAll failed before delete group queue'));
          };

          req.onsuccess = () => {
            const rows = req.result || [];
            let deleted = 0;

            rows.forEach((row) => {
              const rowGroupId = String(row && row.groupId || '').trim();

              if (rowGroupId === targetGroupId) {
                store.delete(row.id);
                deleted += 1;
              }
            });

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][delete-queue] groupId=${targetGroupId} deleted=${deleted}`,
            );
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => {
            reject(tx.error || new Error('IndexedDB delete group queue transaction failed'));
          };
          tx.onabort = () => {
            reject(tx.error || new Error('IndexedDB delete group queue transaction aborted'));
          };
        });

        await refreshUploadGroupCounts();
      } catch (e) {
        console.error('[ChatGPT toolbox] deleteGroupQueue failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-queue:error] groupId=${targetGroupId} error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }
    }

    async function clearActiveGroupQueueInline(button) {
      const group = getActiveGroup();

      if (!group) {
        setStatus('当前没有可清空的分组');
        return;
      }

      const now = Date.now();

      if (now > clearConfirmUntil) {
        clearConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击清空';
        }

        setStatus('再次点击确认清空当前组文件');
        return;
      }

      clearConfirmUntil = 0;

      const prevQueue = state.queue.slice();

      try {
        state.queue = [];

        await schedulePersistQueue();

        render();
        syncGroupManagePanel();

        if (typeof cleanupChatMessageCaches === 'function') {
          cleanupChatMessageCaches('upload-group-cleared');
        }

        setStatus(`已清空分组：${group.name}`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'} removed=${prevQueue.length}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();
        syncGroupManagePanel();

        console.error('[ChatGPT toolbox] clearActiveGroupQueueInline failed', e);

        setStatus(`清空分组失败，已恢复原队列：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:failed-rollback] groupId=${group.id || '-'} name=${group.name || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function deleteActiveGroupInline(button) {
      const group = getActiveGroup();

      if (!group) {
        setStatus('当前没有可删除的分组');
        return;
      }

      if (state.groups.length <= 1) {
        setStatus('至少保留一个分组');
        return;
      }

      const now = Date.now();

      if (now > deleteConfirmUntil) {
        deleteConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击清空';
        }

        setStatus('再次点击确认删除当前组');
        return;
      }

      deleteConfirmUntil = 0;

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();
      const nextGroups = state.groups.filter((g) => g.id !== group.id);
      const preferred = resolveUploadGroupSelection({
        reason: 'delete-group-inline',
        groups: nextGroups,
        excludeGroupId: group.id,
      });
      const resolvedCandidate = preferred.resolvedGroupId || '';
      const nextActiveGroupId = resolvedCandidate || (nextGroups[0] && nextGroups[0].id) || '';

      if (!nextActiveGroupId) {
        setStatus('删除失败：没有可切换的目标分组', 'error');
        return;
      }

      try {
        await schedulePersistQueue();

        state.groups = nextGroups;
        state.activeGroupId = nextActiveGroupId;
        state.activeId = '';
        state.queue = [];

        await persistGroups();
        await loadQueueForActiveGroup();

        saveCurrentToolboxBaseState('delete-group-inline');

        try {
          await deleteGroupQueue(group.id);
        } catch (cleanupErr) {
          const cleanupText = cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr);

          console.error('[ChatGPT toolbox] deleteActiveGroupInline cleanup queue failed', cleanupErr);

          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][delete-inline:queue-cleanup-failed] groupId=${group.id || '-'} name=${group.name || '-'} error=${cleanupText}`,
          );

          setStatus(`分组已删除，但旧队列清理失败：${cleanupText}`, 'error');
        }

        await refreshUploadGroupCounts();

        render();

        const nextActiveGroup = state.groups.find((g) => g.id === state.activeGroupId) || null;
        if (nextActiveGroup) {
          saveMultiUploadLastSelection({
            projectKey: getUploadGroupStableKey(nextActiveGroup),
            folderKey: '',
          });
        }
        saveLastManualUploadGroupId(state.activeGroupId, 'delete-group-inline');
        saveUploadLastActiveGroupId(state.activeGroupId, 'delete-group-inline');
        saveCurrentToolboxBaseState('delete-group-inline');

        if (!state.groups.some((g) => g.id === state.activeGroupId)) {
          console.warn('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]', {
            activeGroupId: state.activeGroupId,
            nextGroupIds: nextGroups.map((g) => g.id),
          });
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]');
          }
          state.activeGroupId = nextGroups[0].id;
        }

        syncGroupManagePanel({
          force: true,
        });

        setStatus(`已删除分组：${group.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'}`,
        );
        void cleanupUploadDbGarbage('delete-active-group');
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] deleteActiveGroupInline failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-inline:failed-rollback] groupId=${group.id || '-'} name=${group.name || '-'} type=${errName} error=${errText}`,
        );

        setStatus(`删除分组失败，已恢复原状态：${errText}`, 'error');

        throw e;
      }
    }

    async function removeFileFromCurrentGroup(id) {
      const fileId = String(id || '').trim();

      if (!fileId) {
        setStatus('删除失败：文件 ID 为空', 'error');
        ToolboxShell.appendLog('[UPLOAD_DIAG][remove-file:skip] reason=empty-id');
        return false;
      }

      healStaleUploadRunningLockIfNeeded('remove-file-before-check');

      const uploadActuallyActive = state.running || isUploadRunActuallyActive();

      if (uploadActuallyActive) {
        setStatus('正在上传中，不能删除文件', 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:skip] reason=upload-running id=${fileId} running=${state.running ? 1 : 0}`,
        );
        return false;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === fileId);

      if (!q) {
        setStatus('未找到要删除的文件', 'warn');
        console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 文件不存在', fileId);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:missing] id=${fileId} activeGroupId=${getActiveGroupId() || '-'}`,
        );
        return false;
      }

      const prevQueue = state.queue.slice();
      const activeGroupId = getActiveGroupId();

      try {
        state.queue = state.queue.filter((item) => item && item.id !== fileId);
        syncActiveGroupSelectionAfterQueueLoad(activeGroupId);

        render();
        syncGroupManagePanel({ force: true });

        setStatus(`已从界面移除：${q.name}，正在保存队列…`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ui-removed] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'}`,
        );

        await schedulePersistQueue();

        render();
        syncGroupManagePanel({ force: true });

        setStatus(`已从工具箱移除：${q.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ok] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'}`,
        );

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();
        syncGroupManagePanel({ force: true });

        console.error('[ChatGPT toolbox] removeFileFromCurrentGroup failed', e);

        setStatus(`移除文件失败，已恢复原队列：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:failed-rollback] id=${fileId} name=${q.name || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function exportGroupsAndQueueMeta() {
      try {
        const db = await openDb();

        const groups = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readonly');
          const store = tx.objectStore(APP.uploadGroupStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB groups export getAll failed'));
        });

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB queue export getAll failed'));
        });

        const queue = (rows || []).map((r) => ({
          id: r.id,
          groupId: r.groupId,
          name: r.name,
          displayPath: r.displayPath || r.name || '',
          size: r.size,
          lastModified: r.lastModified,
          type: r.type,
          state: r.state,
          message: r.message,
          sourceKind: r.sourceKind || '',
          readMode: r.readMode || '',
          uploadName: r.uploadName || '',
          manualPathNote: String(r.manualPathNote || '').trim(),
          blobSaved: !!r.blobSaved,
          blobSavedAt: Number(r.blobSavedAt) || 0,
        }));

        return {
          activeGroupId: state.activeGroupId,
          groups,
          queue,
        };
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] exportGroupsAndQueueMeta failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][export-meta:failed] activeGroupId=${state.activeGroupId || '-'} type=${errName} error=${errText}`,
        );
        throw new Error(`上传分组与队列导出失败：${errText}`);
      }
    }

    async function importGroupsAndQueueMeta(payload) {
      if (!payload || typeof payload !== 'object') {
        console.warn('[ChatGPT toolbox] importGroupsAndQueueMeta: invalid payload', payload);
        return;
      }

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      const incomingGroups = Array.isArray(payload.groups) ? payload.groups : [];
      const incomingQueue = Array.isArray(payload.queue) ? payload.queue : [];

      let nextGroups = [];
      let nextActiveGroupId = '';

      if (!incomingGroups.length) {
        const defaultGroup = createDefaultGroup();
        nextGroups = [defaultGroup];
        nextActiveGroupId = defaultGroup.id;
      } else {
        nextGroups = incomingGroups.map((g) => {
          const group = {
            id: String(g.id || createId('upload_group')),
            name: String(g.name || DEFAULT_UPLOAD_GROUP_NAME).slice(0, 24),
            key: String(g.key || '').trim(),
            createdAt: Number(g.createdAt) || Date.now(),
            updatedAt: Number(g.updatedAt) || Date.now(),
          };

          if (!group.key) {
            group.key = deriveUploadGroupStableKey(group);
          }

          return group;
        });

        const wantedId = String(payload.activeGroupId || '');
        const exists = nextGroups.some((g) => g.id === wantedId);
        nextActiveGroupId = exists ? wantedId : nextGroups[0].id;
      }

      const validGroupIds = new Set(nextGroups.map((g) => String(g.id || '').trim()).filter(Boolean));

      try {
        state.groups = nextGroups;
        state.activeGroupId = nextActiveGroupId;
        state.activeId = '';

        await persistGroups();

        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const clearReq = store.clear();

          clearReq.onerror = () => reject(clearReq.error || new Error('IndexedDB queue clear on import failed'));

          clearReq.onsuccess = () => {
            incomingQueue.forEach((r) => {
              if (!r || !r.id) return;

              const rawGroupId = String(r.groupId || '').trim();
              const groupId = validGroupIds.has(rawGroupId)
                ? rawGroupId
                : state.activeGroupId;

              if (rawGroupId && rawGroupId !== groupId) {
                ToolboxShell.appendLog(
                  `[UPLOAD][IMPORT][QUEUE_GROUP_FALLBACK] old=${rawGroupId} fallback=${groupId}`,
                );
              }

              const row = {
                id: String(r.id),
                groupId,
                name: r.name || 'unknown',
                displayPath: r.displayPath || r.name || '',
                size: Number(r.size) || 0,
                lastModified: Number(r.lastModified) || 0,
                type: r.type || 'application/octet-stream',
                state: r.state || UploadState.IDLE,
                message: r.message || '',
                sourceKind: r.sourceKind || '',
                readMode: r.readMode || '',
                handle: null,
                uploadName: r.uploadName || '',
                manualPathNote: String(r.manualPathNote || '').trim(),
                blob: r.blob instanceof Blob ? r.blob : null,
                blobSaved: !!(r.blob instanceof Blob) || !!r.blobSaved,
                blobSavedAt: Number(r.blobSavedAt) || 0,
              };

              const putReq = store.put(row);

              putReq.onerror = () => {
                console.error('[ChatGPT toolbox] import queue row put failed', {
                  id: row.id,
                  name: row.name,
                  error: putReq.error,
                });
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue import transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB queue import transaction aborted'));
        });

        state.queue = [];

        await loadQueueForActiveGroup();
        await refreshUploadGroupCounts();

        saveCurrentToolboxBaseState('import-groups-and-queue');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][import:ok] groups=${state.groups.length} queue=${incomingQueue.length} activeGroupId=${state.activeGroupId || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] importGroupsAndQueueMeta failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][import:failed-rollback] type=${errName} error=${errText}`,
        );

        setStatus(`导入上传分组失败，已恢复原状态：${errText}`, 'error');

        throw e;
      }
    }

    function renderProjectCategoryChipHtml(group, activeGroupId) {
      return renderUploadGroupChipHtml(group, activeGroupId);
    }

    /** 项目分类统计（上传分组 chip），与页面连接状态无关。*/
    function renderUploadGroupFallbackChipHtml() {
      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip active"
            data-group-id=""
            title="默认：0 个文件">
            <span class="cgpt-chip-name">默认</span>
            <span class="cgpt-chip-count">0</span>
          </button>
        `;
    }

    function renderProjectCategoryChips() {
      if (!groupListEl) {
        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][render-skip] reason=groupListEl-missing');
        return;
      }

      ensureActiveUploadGroupIdValid('render-chips');

      if (!state.groups.length) {
        if (!uploadGroupsInitResolved) {
          groupListEl.innerHTML = `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-group-chip active"
              data-group-id=""
              disabled
              title="正在加载上传分组">
              <span class="cgpt-chip-name">加载中</span>
              <span class="cgpt-chip-count">…</span>
            </button>
          `;
          appendUploadGroupLog('RENDER', { phase: 'waiting-init' });
          Promise.resolve(uploadModuleInitPromise)
            .then(() => {
              ensureActiveUploadGroupIdValid('render-chips-after-init');
              renderProjectCategoryChips();
            })
            .catch((err) => {
              console.error('[ChatGPT toolbox] renderProjectCategoryChips after init failed', err);
              renderProjectCategoryChips();
            });
          return;
        }

        appendUploadGroupLog('RENDER', { phase: 'empty-recovering' });
        groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
        ensureDefaultGroupReady()
          .then(() => {
            appendUploadGroupLog('RENDER', { phase: 'after-ensure-default' });
            renderProjectCategoryChips();
          })
          .catch((err) => {
            console.error('[ChatGPT toolbox] ensureDefaultGroupReady failed during render', err);
            groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
            appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });
          });
        return;
      }

      groupListEl.innerHTML = state.groups
        .map((group) => renderProjectCategoryChipHtml(group, state.activeGroupId))
        .join('');

      syncUploadGroupAppState();
      appendUploadGroupLog('RENDER', { phase: 'ok' });
    }

    function getCurrentConversationSnapshotStatsForHeader() {
      try {
        if (typeof getLightConversationStatsForHeader === 'function') {
          return getLightConversationStatsForHeader();
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] read light stats for header failed', err);
        ToolboxShell.appendLog(`[TOOLBOX_TOP_STATUS][LIGHT_STATS_FAILED] error=${errText}`);
      }

      return null;
    }

    function renderToolboxPageStatusRow() {
      let pageStatusRowEl = document.getElementById('cgpt-toolbox-page-status-row');

      if (!pageStatusRowEl) {
        if (
          typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.ensureToolboxHeaderPageStatusRow === 'function'
        ) {
          pageStatusRowEl = ToolboxShell.ensureToolboxHeaderPageStatusRow();
        }
      }

      if (!pageStatusRowEl) {
        return;
      }

      const pageDisplayId = getBridgePageDisplayIdText();
      const stats = getCurrentConversationSnapshotStatsForHeader();

      const roundCount = stats ? Number(stats.round_count || 0) : 0;
      const domEstimatedRound = stats
        ? Number(stats.dom_estimated_round_count || 0)
        : 0;

      logConversationTurnCountIfChanged(domEstimatedRound, 'renderToolboxPageStatusRow');

      const pageIdText = `页面ID:${pageDisplayId}`;
      const roundText = `页面轮数:${roundCount}`;

      const uploadQuota = getUploadQuotaState();
      const messageQuota = getMessageQuotaState();
      const uploadQuotaText = `上传额度:${uploadQuota.used}/${uploadQuota.maxFiles}`;
      const messageQuotaText = `消息额度:${messageQuota.used}/${messageQuota.maxMessages}`;
      const uploadReleaseText = uploadQuota.remaining <= 0
        ? formatQuotaReleaseCountdown(uploadQuota.nextReleaseAt)
        : '可立即使用';
      const messageReleaseText = messageQuota.remaining <= 0
        ? formatQuotaReleaseCountdown(messageQuota.nextReleaseAt)
        : '可立即使用';
      const uploadQuotaTitle = `${uploadQuotaText}；剩余:${uploadQuota.remaining}；下一条释放:${uploadReleaseText}`;
      const messageQuotaTitle = `${messageQuotaText}；剩余:${messageQuota.remaining}；下一条释放:${messageReleaseText}`;

      pageStatusRowEl.innerHTML = `
        <span id="cgpt-page-input-state" class="cgpt-status-pill cgpt-toolbox-top-status-badge cgpt-state-unknown">未知</span>
        <span class="cgpt-toolbox-top-status-badge cgpt-toolbox-page-id-badge" title="${escapeHtml(pageIdText)}">${escapeHtml(pageIdText)}</span>
        <span class="cgpt-toolbox-top-status-badge cgpt-toolbox-turn-count-badge" title="${escapeHtml(roundText)}（当前对话已完成轮数）">${escapeHtml(roundText)}</span>
        <span class="cgpt-toolbox-top-status-badge" title="${escapeHtml(uploadQuotaTitle)}">${escapeHtml(uploadQuotaText)}</span>
        <span class="cgpt-toolbox-top-status-badge" title="${escapeHtml(messageQuotaTitle)}">${escapeHtml(messageQuotaText)}</span>
      `;
      updateChatInputStateBadge();
    }

    function renderToolboxTopStatus(options = {}) {
      const heavy = options && options.heavy === true;
      renderToolboxPageStatusRow();
      if (heavy) {
        renderProjectCategoryChips();
      }
      updateChatInputStateBadge();
    }

    function setStatus(text, type) {
      ToolboxShell.setStatus(text, type);
    }

    function updateItem(id, patch) {
      const q = state.queue.find((x) => x.id === id);
      if (!q) return;

      if (
        q.state === UploadState.CANCELLED &&
        state.cancelled &&
        patch.state &&
        patch.state !== UploadState.CANCELLED
      ) {
        return;
      }

      Object.assign(q, patch);

      if (patch.state === UploadState.ATTACHED) {
        q.attachedInSession = true;

        if (Object.prototype.hasOwnProperty.call(patch, 'persistedAttached')) {
          q.persistedAttached = !!patch.persistedAttached;
        } else {
          q.persistedAttached = true;
        }
      }

      if (
        patch.state &&
        UploadStateUtils &&
        typeof UploadStateUtils.isFinal === 'function' &&
        UploadStateUtils.isFinal(patch.state)
      ) {
        window.setTimeout(() => {
          const healed = healStaleUploadRunningLockIfNeeded(`updateItem-final-state:${patch.state}`);

          if (healed) {
            render();
            persistQueueInBackground(`updateItem-final-state:${patch.state}`);
          }
        }, 300);
      }

      if (state.running) {
        scheduleRenderUpload('updateItem');
        persistQueueThrottled('updateItem');
      } else {
        render();
        persistQueueInBackground('updateItem');
      }
    }

    function isUploadCancelled(runId, signal) {
      return state.cancelled ||
        runId !== state.runId ||
        (signal && signal.aborted);
    }

    async function waitComposerAttachmentReady(options = {}) {
      const timeoutMs = Number(options.timeoutMs || 120000);
      const startedAt = Date.now();
      let loggedStillUploading = false;

      while (Date.now() - startedAt < timeoutMs) {
        const nativeSendReady = !!(
          typeof ComposerApi !== 'undefined'
          && (
            (
              typeof ComposerApi.hasRealSubmitButton === 'function'
              && ComposerApi.hasRealSubmitButton()
            )
            || (
              typeof ComposerApi.canSendNowLight === 'function'
              && ComposerApi.canSendNowLight()
            )
            || (
              typeof ComposerApi.canSendNow === 'function'
              && ComposerApi.canSendNow({ force: true })
            )
          )
        );

        if (nativeSendReady) {
          ToolboxShell.appendLog('[UPLOAD][ATTACHMENT_READY] reason=native-send-ready');
          return {
            ok: true,
            reason: 'native-send-ready',
          };
        }

        if (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading()
        ) {
          if (!loggedStillUploading && Date.now() - startedAt > 3000) {
            loggedStillUploading = true;
            let textPreview = '';
            if (typeof ComposerApi.collectAttachmentChipText === 'function') {
              textPreview = ComposerApi.collectAttachmentChipText().slice(0, 500);
            }
            ToolboxShell.appendLog(
              `[UPLOAD][ATTACHMENT_WAITING] reason=still-uploading textPreview=${textPreview}`,
            );
          }
          await sleep(500);
          continue;
        }

        const failed = document.querySelector(
          '[data-testid*="upload-error"], [aria-label*="上传失败"], [aria-label*="Upload failed"]',
        );

        if (failed) {
          ToolboxShell.appendLog('[UPLOAD][ATTACHMENT_FAILED] reason=attachment-upload-failed');
          return {
            ok: false,
            reason: 'attachment-upload-failed',
          };
        }

        const hasAttachment = !!(
          (typeof ComposerApi !== 'undefined' && typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload())
          || (typeof ComposerApi !== 'undefined' && typeof ComposerApi.countAttachmentChips === 'function'
            && ComposerApi.countAttachmentChips() > 0)
        );

        if (hasAttachment) {
          ToolboxShell.appendLog('[UPLOAD][ATTACHMENT_READY] reason=attachment-ready');
          return {
            ok: true,
            reason: 'attachment-ready',
          };
        }

        await sleep(500);
      }

      ToolboxShell.appendLog('[UPLOAD][ATTACHMENT_NOT_READY] reason=attachment-ready-timeout');
      return {
        ok: false,
        reason: 'attachment-ready-timeout',
      };
    }

    async function waitUntilComposerUploadIdle(options = {}) {
      const timeoutMs = Number(options.timeoutMs) || 30000;
      const runId = options.runId;
      const signal = options.signal;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (isUploadCancelled(runId, signal)) {
          return false;
        }

        if (!ComposerApi.isAttachmentStillUploading()) {
          await sleep(800);

          if (!ComposerApi.isAttachmentStillUploading()) {
            return true;
          }
        }

        await sleep(500);
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][wait-upload-idle-timeout] 附件空闲检测超时，但文件状态已写入，继续结束上传流程');
      return false;
    }

    function areAllUploadTargetsSettled(targets) {
      const list = Array.isArray(targets) ? targets : [];
      if (!list.length) {
        return false;
      }
      return UploadStateUtils.allSettled(list);
    }

    function countUploadResult(targets) {
      const stats = UploadStateUtils.count(targets);
      return {
        success: stats.success,
        failed: stats.failed,
      };
    }

    function resolveUploadTargets(targets) {
      return (targets || [])
        .map((old) => state.queue.find((item) => item && old && item.id === old.id))
        .filter(Boolean);
    }

    function isCompactUploadView() {
      const panelEl = document.getElementById(APP.panelId);
      return !!(panelEl && panelEl.classList.contains('cgpt-toolbox-compact'));
    }

    function getCompactUiConfig() {
      if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.get === 'function') {
        return CompactUiConfigStore.get();
      }
      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function') {
        return SettingsModule.getConfig();
      }
      const saved = MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};
      return normalizeCompactUiConfig(saved);
    }

    function saveCompactUiConfigPatch(patch) {
      if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.patch === 'function') {
        return CompactUiConfigStore.patch(patch || {});
      }
      const next = Object.assign({}, getCompactUiConfig(), patch || {});
      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
        SettingsModule.saveConfig(next);
        return next;
      }
      const normalized = normalizeCompactUiConfig(next);
      MemoryManager.set(MemoryManager.KEYS.compactUiConfig, normalized);
      return normalized;
    }

    function normalizeQuotaRecords(records, windowMs) {
      const now = Date.now();
      const windowValue = Math.max(1000, Number(windowMs) || 0);
      const list = Array.isArray(records) ? records : [];

      return list
        .filter((item) => {
          const ts = Number(item && item.ts);
          return Number.isFinite(ts) && ts > 0 && now - ts < windowValue;
        })
        .sort((a, b) => Number(a.ts) - Number(b.ts));
    }

    function getUploadQuotaState(options = {}) {
      const cfg = getCompactUiConfig();
      const windowMs = Number(cfg.uploadQuotaWindowHours || 3) * 60 * 60 * 1000;
      const maxFiles = typeof getUploadQuotaLimit === 'function'
        ? getUploadQuotaLimit()
        : Number(cfg.uploadQuotaMaxFiles || 80);
      const records = normalizeQuotaRecords(cfg.uploadQuotaRecords, windowMs);
      const used = records.reduce((sum, item) => {
        const count = Number(item && item.count);
        return sum + (Number.isFinite(count) && count > 0 ? count : 0);
      }, 0);
      const remaining = Math.max(0, maxFiles - used);

      let nextReleaseAt = 0;
      if (used >= maxFiles && records.length) {
        const oldest = Number(records[0].ts) || 0;
        nextReleaseAt = oldest > 0 ? oldest + windowMs : 0;
      }

      const snapshot = {
        windowMs,
        maxFiles,
        limit: maxFiles,
        used,
        remaining,
        canUpload: remaining > 0,
        records,
        nextReleaseAt,
        source: 'upload-quota',
      };

      if (options.logSnapshot) {
        ToolboxShell.appendLog(
          `[RATE_LIMIT][UPLOAD][SNAPSHOT] used=${used} limit=${maxFiles} remaining=${remaining} `
          + `records=${records.length} source=${snapshot.source}`,
        );
      }

      return snapshot;
    }

    function getMessageQuotaState(options = {}) {
      const cfg = getCompactUiConfig();
      const windowMs = Number(cfg.messageQuotaWindowHours || 3) * 60 * 60 * 1000;
      const maxMessages = typeof getMessageQuotaLimit === 'function'
        ? getMessageQuotaLimit()
        : Number(cfg.messageQuotaMaxMessages || 150);
      const records = normalizeQuotaRecords(cfg.messageQuotaRecords, windowMs);
      const used = records.reduce((sum, item) => {
        const count = Number(item && item.count);
        return sum + (Number.isFinite(count) && count > 0 ? count : 1);
      }, 0);
      const remaining = Math.max(0, maxMessages - used);

      let nextReleaseAt = 0;
      if (used >= maxMessages && records.length) {
        const oldest = Number(records[0].ts) || 0;
        nextReleaseAt = oldest > 0 ? oldest + windowMs : 0;
      }

      const snapshot = {
        windowMs,
        maxMessages,
        limit: maxMessages,
        used,
        remaining,
        canSend: remaining > 0,
        records,
        nextReleaseAt,
        source: 'message-quota',
      };

      if (options.logSnapshot) {
        ToolboxShell.appendLog(
          `[RATE_LIMIT][MESSAGE][SNAPSHOT] used=${used} limit=${maxMessages} remaining=${remaining} `
          + `records=${records.length} source=${snapshot.source}`,
        );
      }

      return snapshot;
    }

    function clearUploadQuotaRecords(reason = 'manual') {
      const quota = getUploadQuotaState();
      saveCompactUiConfigPatch({
        uploadQuotaRecords: [],
      });
      ToolboxShell.appendLog(
        `[UPLOAD_QUOTA][CLEAR] reason=${String(reason || 'manual')} used_before=${quota.used}`,
      );
      renderToolboxTopStatus();
    }

    function clearMessageQuotaRecords(reason = 'manual') {
      const quota = getMessageQuotaState();
      saveCompactUiConfigPatch({
        messageQuotaRecords: [],
      });
      ToolboxShell.appendLog(
        `[MESSAGE_QUOTA][CLEAR] reason=${String(reason || 'manual')} used_before=${quota.used}`,
      );
      renderToolboxTopStatus();
    }

    function formatQuotaReleaseCountdown(nextReleaseAt) {
      const target = Number(nextReleaseAt || 0);
      if (!Number.isFinite(target) || target <= 0) {
        return '可立即使用';
      }

      const waitMs = Math.max(0, target - Date.now());
      if (waitMs <= 0) {
        return '即将释放';
      }

      const totalSeconds = Math.ceil(waitMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}小时${minutes}分`;
      }

      if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
      }

      return `${seconds}秒`;
    }

    function formatDurationMsForButton(ms) {
      const value = Number(ms || 0);

      if (!Number.isFinite(value) || value <= 0) {
        return '0秒';
      }

      const totalSeconds = Math.ceil(value / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}小时${minutes}分`;
      }

      if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
      }

      return `${seconds}秒`;
    }

    function recordUploadSuccess(fileCount) {
      const count = Number(fileCount || 0);
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }

      const quota = getUploadQuotaState();
      const nextRecords = quota.records.concat([{ ts: Date.now(), count }]);
      saveCompactUiConfigPatch({
        uploadQuotaRecords: normalizeQuotaRecords(nextRecords, quota.windowMs),
      });

      const after = getUploadQuotaState({ logSnapshot: true });
      ToolboxShell.appendLog(
        `[UPLOAD_QUOTA][RECORD] count=${count} used=${after.used} max=${after.maxFiles} remaining=${after.remaining}`,
      );
      renderToolboxTopStatus();
      scheduleRenderUpload('quota-record-upload-success');
    }

    function recordMessageSent() {
      const quota = getMessageQuotaState();
      const nextRecords = quota.records.concat([{ ts: Date.now(), count: 1 }]);
      saveCompactUiConfigPatch({
        messageQuotaRecords: normalizeQuotaRecords(nextRecords, quota.windowMs),
      });

      const after = getMessageQuotaState({ logSnapshot: true });
      ToolboxShell.appendLog(
        `[MESSAGE_QUOTA][RECORD] used=${after.used} max=${after.maxMessages} remaining=${after.remaining}`,
      );
      renderToolboxTopStatus();
      scheduleRenderUpload('quota-record-message-sent');
    }

    // SINGLE SOURCE OF TRUTH: 3 小时消息额度（发送前统一走 waitChatRateLimitBeforeSend）
    const ChatRateLimiter = {
      get windowMs() {
        return getMessageQuotaState().windowMs;
      },
      get maxMessages() {
        return getMessageQuotaState().maxMessages;
      },
      get sentAtList() {
        return getMessageQuotaState().records;
      },
      cleanup(now = Date.now()) {
        void now;
        return getMessageQuotaState();
      },
      getUsedCount() {
        return getMessageQuotaState().used;
      },
      canSend() {
        return getMessageQuotaState().canSend;
      },
      getNextAvailableDelayMs() {
        const quota = getMessageQuotaState();
        if (quota.remaining > 0) {
          return 0;
        }
        const oldest = quota.records.length ? Number(quota.records[0].ts) || 0 : 0;
        return oldest > 0 ? Math.max(0, oldest + quota.windowMs - Date.now()) : 0;
      },
      recordSend() {
        recordMessageSent();
      },
      toViewModel(now = Date.now()) {
        const quota = getMessageQuotaState();
        const used = quota.used;
        const remaining = quota.remaining;
        const delayMs = this.getNextAvailableDelayMs(now);
        return {
          used,
          remaining,
          maxMessages: quota.maxMessages,
          delayMs,
          delayText: formatDurationMsForButton(delayMs),
        };
      },
    };

    async function waitChatRateLimitBeforeSend() {
      const vm = ChatRateLimiter.toViewModel();

      if (vm.remaining > 0) {
        return { ok: true, reason: 'rate_limit_ok' };
      }

      ToolboxShell.appendLog(
        `[RATE_LIMIT][BLOCK] used=${vm.used}/${vm.maxMessages} remaining=${vm.remaining} wait=${vm.delayText}`,
      );

      return {
        ok: false,
        reason: 'rate_limit_reached',
        delayMs: vm.delayMs,
      };
    }

    function recordMessageSentAfterConfirmed() {
      ChatRateLimiter.recordSend();
      UploadCadencePolicy.recordMessageSent();
      const vm = ChatRateLimiter.toViewModel();
      ToolboxShell.appendLog(
        `[RATE_LIMIT][RECORD] used=${vm.used}/${vm.maxMessages} remaining=${vm.remaining}`,
      );
    }

    const UploadCadencePolicy = {
      get enabled() {
        const cfg = getCompactUiConfig();
        return cfg.copyHotkeyLoopAutoUploadEnabled !== false;
      },
      get uploadEveryMessages() {
        const cfg = getCompactUiConfig();
        const n = Number(cfg.copyHotkeyLoopAutoUploadInterval || 5);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
      },
      messageCountSinceLastUpload: 0,
      recordMessageSent() {
        this.messageCountSinceLastUpload += 1;
      },
      recordUploadDone() {
        this.messageCountSinceLastUpload = 0;
      },
      shouldUploadBeforeNextSend() {
        if (!this.enabled) {
          return false;
        }
        return this.messageCountSinceLastUpload >= this.uploadEveryMessages;
      },
      toViewModel() {
        return {
          enabled: this.enabled,
          uploadEveryMessages: this.uploadEveryMessages,
          messageCountSinceLastUpload: this.messageCountSinceLastUpload,
          remainingBeforeUpload: Math.max(
            0,
            this.uploadEveryMessages - this.messageCountSinceLastUpload,
          ),
        };
      },
    };

    async function prepareUploadByCadenceIfNeeded() {
      if (!UploadCadencePolicy.shouldUploadBeforeNextSend()) {
        return { ok: true, skipped: true, reason: 'cadence_not_reached' };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_CADENCE][TRIGGER] count=${UploadCadencePolicy.messageCountSinceLastUpload} every=${UploadCadencePolicy.uploadEveryMessages}`,
      );

      const result = await startUploadOnlyFlow({ source: 'upload-cadence-policy' });

      if (result) {
        UploadCadencePolicy.recordUploadDone();
      }

      return {
        ok: !!result,
        skipped: false,
        reason: result ? 'cadence-upload-ok' : 'cadence-upload-failed',
      };
    }

    function canStartNextTaskByQuota(task) {
      const uploadQuota = getUploadQuotaState();
      const messageQuota = getMessageQuotaState();
      const fileCount = getTaskUploadFileCountForQuota(task);
      const needMessageCount = 1;

      if (fileCount > uploadQuota.remaining) {
        return {
          ok: false,
          reason: 'upload-quota-exceeded',
          uploadRemaining: uploadQuota.remaining,
          messageRemaining: messageQuota.remaining,
          fileCount,
        };
      }

      if (needMessageCount > messageQuota.remaining) {
        return {
          ok: false,
          reason: 'message-quota-exceeded',
          uploadRemaining: uploadQuota.remaining,
          messageRemaining: messageQuota.remaining,
          fileCount,
        };
      }

      return {
        ok: true,
        uploadRemaining: uploadQuota.remaining,
        messageRemaining: messageQuota.remaining,
      };
    }

    function getTaskUploadFileCountForQuota(task) {
      void task;
      const pending = typeof getPendingUploadItems === 'function' ? getPendingUploadItems() : [];
      return Array.isArray(pending) ? pending.length : 0;
    }

    function normalizeQuickPromptCategoryName(value) {
      const text = String(value || '').trim();
      if (!text || text === '鍏ㄩ儴') {
        if (text === '鍏ㄩ儴') {
          console.info('[QUICK_PROMPT][CATEGORY][NORMALIZE_MOJIBAKE]', {
            from: text,
            to: '全部',
          });
        }
        return '全部';
      }
      return text;
    }

    function getQuickPromptActiveCategory() {
      if (typeof PromptCategoryState !== 'undefined'
        && typeof PromptCategoryState.getActiveCategory === 'function') {
        quickPromptActiveCategory = PromptCategoryState.getActiveCategory();
      }
      return normalizeQuickPromptCategoryName(quickPromptActiveCategory);
    }

    function saveQuickPromptActiveCategory(category, options = {}) {
      const nextCategory = normalizeQuickPromptCategoryName(category);
      quickPromptActiveCategory = nextCategory;

      if (typeof PromptCategoryState !== 'undefined'
        && typeof PromptCategoryState.setActiveCategory === 'function') {
        PromptCategoryState.setActiveCategory(nextCategory, {
          syncCompactUi: options.syncCompactUi !== false,
        });
      } else if (typeof MemoryManager !== 'undefined') {
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          nextCategory,
        );

        const cfg = getCompactUiConfig();
        const next = Object.assign({}, cfg, {
          quickPromptActiveCategory: nextCategory,
        });

        if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
          SettingsModule.saveConfig(next);
        } else {
          MemoryManager.set(
            MemoryManager.KEYS.compactUiConfig,
            normalizeCompactUiConfig(next),
          );
        }
      }

      if (options.savePageState !== false) {
        saveCurrentToolboxBaseState(options.reason || 'quick-category-change');
      }
    }

    function getPromptCategoryName(prompt) {
      if (typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPromptCategoryName === 'function') {
        return PromptManagerModule.getPromptCategoryName(prompt);
      }

      const text = String(prompt && prompt.category ? prompt.category : '').trim();
      return text || '默认';
    }

    function getQuickPromptGroups(promptList) {
      if (typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPromptCategoriesFromList === 'function') {
        return PromptManagerModule.getPromptCategoriesFromList(promptList);
      }

      const names = [];

      (promptList || []).forEach((p) => {
        const name = getPromptCategoryName(p);
        if (!names.includes(name)) {
          names.push(name);
        }
      });

      return ['全部', ...names];
    }

    function applyCompactUiVisibility() {
      if (!rootElRef) return;

      const cfg = getCompactUiConfig();
      const isCompact = isCompactUploadView();

      // Compact mode always keeps the group bar visible (product rule); full mode respects cfg.
      if (isCompact) {
        rootElRef.classList.remove('compact-hide-upload-groups');
      } else {
        rootElRef.classList.toggle('compact-hide-upload-groups', cfg.showUploadGroups === false);
      }

      rootElRef.classList.toggle('compact-hide-upload-start', isCompact && !cfg.showUploadStartButton);
      rootElRef.classList.toggle('compact-hide-file-list', isCompact && !cfg.showUploadFileList);
      const shouldShowQuick = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      rootElRef.classList.toggle('compact-hide-quick-prompts', !shouldShowQuick);
    }

    function shouldQuickPromptAutoSend(cfg) {
      if (QUICK_PROMPT_CLICK_AUTO_SEND !== true) {
        return false;
      }
      return cfg.quickPromptClickAction !== 'fill';
    }

    function normalizePromptPayload(prompt) {
      const rawText = String(prompt && prompt.content != null ? prompt.content : '');

      return {
        rawText,
        isEmpty: rawText.trim().length === 0,
      };
    }

    async function sendOrFillQuickPrompt(prompt, options = {}) {
      const cfg = getCompactUiConfig();
      const source = String(options.source || 'quick-prompt-click').trim() || 'quick-prompt-click';
      const payload = normalizePromptPayload(prompt);
      const rawText = payload.rawText;
      const title = String(prompt && prompt.title ? prompt.title : '未命名').trim() || '未命名';
      let shouldSend;

      if (options.send === true) {
        shouldSend = true;
      } else if (options.send === false) {
        shouldSend = false;
      } else {
        shouldSend = shouldQuickPromptAutoSend(cfg);
      }

      const action = shouldSend ? 'send' : 'fill';

      ToolboxShell.appendLog(
        `[PROMPT][CLICK] source=${source} title=${title} text_len=${rawText.length} action=${action} auto_send=${shouldSend ? 1 : 0} waiting=${isWaitingSendActive() ? 1 : 0}`,
      );

      if (payload.isEmpty) {
        setStatus(`Prompt 内容为空：${title}`, 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SKIP] source=${source} reason=empty_prompt`);
        return;
      }

      if (shouldSend && isWaitingSendActive()) {
        setStatus('当前已有发送任务进行中，请稍后再点击 Prompt', 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SKIP] source=${source} reason=waiting_send_active`);
        return;
      }

      const existingRawText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '')
        : '';

      if (existingRawText && existingRawText !== rawText && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingRawText.length} 个字符，是否覆盖为快捷 Prompt：${title}？`
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[PROMPT][CLICK][SKIP] source=${source} reason=draft_overwrite_cancelled existingChars=${existingRawText.length} newChars=${rawText.length}`,
          );
          return;
        }
      } else if (existingRawText && existingRawText !== rawText) {
        ToolboxShell.appendLog(
          `[PROMPT][CLICK][OVERWRITE_DRAFT] source=${source} existingChars=${existingRawText.length} newChars=${rawText.length}`,
        );
      }

      if (!shouldSend) {
        setStatus('正在写入 Prompt...', 'running');

        const ok = ComposerApi.setComposerValue(rawText);

        if (!ok) {
          console.warn('[ChatGPT toolbox] quick prompt: composer not found', prompt);
          setStatus('未找到 ChatGPT 输入框，无法填入 Prompt', 'error');
          ToolboxShell.appendLog(`[PROMPT][CLICK][WRITE_FAILED] source=${source} reason=composer_not_found`);
          return {
            ok: false,
            reason: 'composer_not_found',
            sent: false,
          };
        }

        ToolboxShell.appendLog(
          `[PROMPT][FILL] id=${prompt && prompt.id ? prompt.id : '-'} chars=${rawText.length} send=0`,
        );
        setStatus(`已填入 Prompt：${title}`, 'success');
        return {
          ok: true,
          reason: 'filled',
          sent: false,
        };
      }

      setStatus(`正在写入并发送 Prompt：${title}`, 'running');

      const ok = ComposerApi.setComposerValue(rawText);

      if (!ok) {
        console.warn('[ChatGPT toolbox] quick prompt: composer not found', prompt);
        setStatus('未找到 ChatGPT 输入框，无法填入 Prompt', 'error');
        ToolboxShell.appendLog(`[PROMPT][CLICK][WRITE_FAILED] source=${source} reason=composer_not_found`);
        return {
          ok: false,
          reason: 'composer_not_found',
          sent: false,
        };
      }

      ToolboxShell.appendLog(
        `[PROMPT][WRITE_OK] source=${source} id=${prompt && prompt.id ? prompt.id : '-'} chars=${rawText.length}`,
      );

      const textSynced = typeof ComposerApi.waitForComposerTextSynced === 'function'
        ? await ComposerApi.waitForComposerTextSynced(rawText, 8000, {
            shouldStop: () => isWaitingSendActive(),
          })
        : { ok: true, reason: 'sync-check-unavailable' };

      if (!textSynced.ok) {
        const syncReason = textSynced.reason || 'composer_text_not_synced';
        setStatus(`Prompt 写入后未同步：${syncReason}`, 'warn');
        ToolboxShell.appendLog(`[PROMPT][SEND_SKIP] source=${source} reason=${syncReason}`);
        return {
          ok: false,
          reason: syncReason,
          sent: false,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      ToolboxShell.appendLog(`[PROMPT][SEND_TRIGGER] source=${source} title=${title}`);

      const sentOk = typeof triggerSendFromToolbox === 'function'
        ? await triggerSendFromToolbox('quick-prompt-click')
        : false;

      ToolboxShell.appendLog(
        `[PROMPT][SEND_RESULT] ok=${sentOk ? '1' : '0'} reason=${sentOk ? 'trigger_send_ok' : 'trigger_send_failed'}`,
      );

      if (sentOk) {
        setStatus(`Prompt 已发送：${title}`, 'success');
        return {
          ok: true,
          reason: 'sent_by_trigger_send',
          sent: true,
        };
      }

      setStatus('Prompt 已写入，但发送失败：发送按钮不可用', 'warn');
      return {
        ok: false,
        reason: 'trigger_send_failed',
        sent: false,
      };
    }

    async function scrollChatToBottom(reason) {
      const reasonText = reason || 'unknown';

      const candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('[data-testid="conversation-turn-list"]')?.parentElement,
      ].filter(Boolean);

      const scrollables = Array.from(document.querySelectorAll('div, main, section'))
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY;
          const canScroll = el.scrollHeight > el.clientHeight + 80;
          return canScroll && ['auto', 'scroll', 'overlay'].includes(overflowY);
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight);

      const targets = [...new Set([...candidates, ...scrollables])];

      for (const el of targets) {
        try {
          if (!el) {
            continue;
          }
          el.scrollTop = el.scrollHeight;
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] scrollChatToBottom element failed', err);
          ToolboxShell.appendLog(`[SCROLL][BOTTOM_ELEMENT_FAILED] reason=${reasonText} error=${errText}`);
        }
      }

      try {
        window.scrollTo({
          top: Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
          ),
          behavior: 'auto',
        });
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] scrollChatToBottom window failed', err);
        ToolboxShell.appendLog(`[SCROLL][BOTTOM_WINDOW_FAILED] reason=${reasonText} error=${errText}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 80));

      ToolboxShell.appendLog(`[SCROLL][BOTTOM] reason=${reasonText}`);
    }

    async function forceScrollChatToBottomForCopy(reason, stage) {
      const reasonText = reason || 'copy';
      const stageText = stage || 'unknown';

      try {
        await scrollChatToBottom(`${reasonText}:${stageText}:immediate`);
        await new Promise((resolve) => setTimeout(resolve, 80));
        await scrollChatToBottom(`${reasonText}:${stageText}:after-80ms`);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await scrollChatToBottom(`${reasonText}:${stageText}:after-260ms`);

        ToolboxShell.appendLog(`[COPY][FORCE_SCROLL_BOTTOM] reason=${reasonText} stage=${stageText}`);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[COPY][FORCE_SCROLL_BOTTOM_FAILED]', err);
        ToolboxShell.appendLog(`[COPY][FORCE_SCROLL_BOTTOM_FAILED] reason=${reasonText} stage=${stageText} error=${errText}`);
      }
    }

    // LEGACY WRAPPER: 旧调用仍返回纯文本；新逻辑请用 getLatestAssistantReplyText()
    function getLastAssistantReplyText() {
      const picked = getLatestAssistantReplyText({ label: 'getLastAssistantReplyText', forceRefresh: true });
      return picked && picked.ok ? String(picked.text || '').trim() : '';
    }

    function getLatestAssistantReplyText(options = {}) {
      if (typeof CopyPipeline === 'undefined' || typeof CopyPipeline.getLatestAssistantReplyText !== 'function') {
        return { ok: false, text: '', reason: 'copy_pipeline_missing' };
      }
      return CopyPipeline.getLatestAssistantReplyText(options);
    }

    async function writeClipboardAndVerify(text, options = {}) {
      if (typeof CopyPipeline === 'undefined' || typeof CopyPipeline.writeClipboardAndVerify !== 'function') {
        return { ok: false, reason: 'copy_pipeline_missing' };
      }
      return CopyPipeline.writeClipboardAndVerify(text, options);
    }

    async function copyLatestAssistantReplyUnified(options) {
      const opts = Object.assign({
        reason: 'copy-latest',
        prefilledText: '',
      }, options || {});

      const reasonText = opts.reason || 'copy-latest';

      ToolboxShell.appendLog(`[COPY][UNIFIED_START] reason=${reasonText}`);

      if (
        options
        && (
          options.scrollBeforeCopy === false
          || options.scrollAfterCopy === false
        )
      ) {
        ToolboxShell.appendLog(
          `[COPY][SCROLL_OPTION_IGNORED] reason=${reasonText} scrollBeforeCopy=${options.scrollBeforeCopy} scrollAfterCopy=${options.scrollAfterCopy}`,
        );
      }

      try {
        await forceScrollChatToBottomForCopy(reasonText, 'before-copy');
        await new Promise((resolve) => setTimeout(resolve, 120));

        let text = String(opts.prefilledText || '').trim();
        let pickReason = 'prefilled';

        if (!text) {
          const picked = getLatestAssistantReplyText({ label: reasonText, forceRefresh: true });
          if (!picked || !picked.ok) {
            const failReason = picked && picked.reason ? picked.reason : 'read-failed';
            ToolboxShell.appendLog(`[COPY_LATEST][FAIL] label=${reasonText} reason=${failReason}`);
            setStatus('复制失败：无法读取最后回复', 'error');
            return {
              ok: false,
              reason: failReason,
              error: picked && picked.error ? picked.error : '',
            };
          }
          text = String(picked.text || '').trim();
          pickReason = picked.reason || 'ok';
        }

        if (!text) {
          ToolboxShell.appendLog(`[COPY][LATEST_EMPTY] reason=${reasonText}`);
          setStatus('复制失败：最后回复为空', 'error');
          return { ok: false, reason: 'latest_assistant_reply_empty' };
        }

        const copied = await writeClipboardAndVerify(text, { label: reasonText });
        if (!copied || !copied.ok) {
          const failReason = copied && copied.reason ? copied.reason : 'clipboard-failed';
          ToolboxShell.appendLog(`[COPY_LATEST][FAIL] label=${reasonText} reason=${failReason} pick=${pickReason}`);
          setStatus('复制失败：剪贴板写入失败', 'error');
          return {
            ok: false,
            reason: failReason,
            error: copied && copied.error ? copied.error : '',
          };
        }

        ToolboxShell.appendLog(`[COPY_LATEST][OK] label=${reasonText} len=${text.length}`);
        setStatus(`已复制最后回复：${text.length} 字`, 'success');

        return {
          ok: true,
          text,
          chars: text.length,
        };
      } finally {
        await forceScrollChatToBottomForCopy(reasonText, 'finally');
      }
    }

    function normalizeClipboardTextForCompare(text) {
      return String(text || '')
        .replace(/\r\n/g, '\n')
        .trim();
    }

    function waitClipboardHotkeyDelay(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });
    }

    async function ensureClipboardReadyBeforeSystemHotkey(expectedText, reason = 'copy-hotkey') {
      const reasonText = String(reason || 'copy-hotkey').trim() || 'copy-hotkey';
      const expected = String(expectedText || '');
      const expectedNormalized = normalizeClipboardTextForCompare(expected);

      if (!expectedNormalized) {
        ToolboxShell.appendLog(`[COPY_ACTION][CLIPBOARD_READY_FAILED] reason=${reasonText} error=empty-expected-text`);
        return {
          ok: false,
          verified: false,
          reason: 'empty-expected-text',
        };
      }

      await waitClipboardHotkeyDelay(220);

      const canReadClipboard = !!(
        navigator.clipboard
        && typeof navigator.clipboard.readText === 'function'
        && (!document.hasFocus || document.hasFocus())
      );

      if (!canReadClipboard) {
        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_READY_SKIP_VERIFY] reason=${reasonText} chars=${expected.length} readText=unavailable`,
        );
        return {
          ok: true,
          verified: false,
          reason: 'readText-unavailable',
        };
      }

      const deadline = Date.now() + 900;
      let lastText = '';
      let lastError = '';

      while (Date.now() < deadline) {
        try {
          lastText = String(await navigator.clipboard.readText() || '');
          if (normalizeClipboardTextForCompare(lastText) === expectedNormalized) {
            ToolboxShell.appendLog(
              `[COPY_ACTION][CLIPBOARD_READY_OK] reason=${reasonText} chars=${expected.length} verified=1`,
            );
            return {
              ok: true,
              verified: true,
              reason: 'ok',
            };
          }
        } catch (error) {
          lastError = error && error.message ? error.message : String(error);
          console.error('[COPY_ACTION][CLIPBOARD_READ_FAILED]', {
            error_type: error && error.name ? error.name : 'Error',
            error: lastError,
            stack: error && error.stack ? error.stack : '',
          });
          ToolboxShell.appendLog(
            `[COPY_ACTION][CLIPBOARD_READ_FAILED] reason=${reasonText} error=${lastError}`,
          );
          await waitClipboardHotkeyDelay(180);
          return {
            ok: true,
            verified: false,
            reason: 'readText-failed',
            error: lastError,
          };
        }

        await waitClipboardHotkeyDelay(90);
      }

      ToolboxShell.appendLog(
        `[COPY_ACTION][CLIPBOARD_READY_FAILED] reason=${reasonText} error=clipboard-mismatch expectedChars=${expected.length} actualChars=${lastText.length} lastError=${lastError || '-'}`,
      );

      try {
        await copyTextUnified(expected, `${reasonText}:recopy`);
        await waitClipboardHotkeyDelay(260);

        const verifyDeadline = Date.now() + 900;
        while (Date.now() < verifyDeadline) {
          try {
            lastText = String(await navigator.clipboard.readText() || '');
            if (normalizeClipboardTextForCompare(lastText) === expectedNormalized) {
              ToolboxShell.appendLog(
                `[COPY_ACTION][CLIPBOARD_RECOPY_OK] reason=${reasonText} chars=${expected.length} verified=1`,
              );
              return {
                ok: true,
                verified: true,
                reason: 'recopy-verified',
              };
            }
          } catch (recheckError) {
            lastError = recheckError && recheckError.message
              ? recheckError.message
              : String(recheckError);
            console.error('[ChatGPT toolbox] clipboard recopy verify read failed', recheckError);
            ToolboxShell.appendLog(
              `[COPY_ACTION][CLIPBOARD_RECOPY_VERIFY_FAILED] reason=${reasonText} error=${lastError}`,
            );
            break;
          }

          await waitClipboardHotkeyDelay(90);
        }

        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_RECOPY_OK] reason=${reasonText} chars=${expected.length} verified=0`,
        );
        return {
          ok: true,
          verified: false,
          reason: 'recopy-ok',
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] clipboard recopy before hotkey failed', error);
        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_RECOPY_FAILED] reason=${reasonText} error=${errText}`,
        );
        return {
          ok: false,
          verified: false,
          reason: 'recopy-failed',
          error: errText,
        };
      }
    }

    async function triggerCopyThenTargetHotkeyOnce(options = {}) {
      const source = String(options.source || 'copy-then-hotkey').trim() || 'copy-then-hotkey';
      const targetLabel = typeof getCopyThenShortcutTargetLabel === 'function'
        ? getCopyThenShortcutTargetLabel()
        : '';
      const combo = typeof getCopyThenShortcutTargetCombo === 'function'
        ? getCopyThenShortcutTargetCombo()
        : '';

      if (!combo) {
        ToolboxShell.appendLog(
          `[COPY_THEN_HOTKEY][TARGET_TRIGGER] key=- source=${source} reason=empty-target`,
        );
        setStatus('复制后目标快捷键未设置', 'error');
        return false;
      }

      ToolboxShell.appendLog(
        `[COPY_THEN_HOTKEY][TARGET_TRIGGER] key=${targetLabel || combo} source=${source}`,
      );
      setStatus(`正在请求 GUI 发送 ${targetLabel || combo}`, 'running');

      try {
        const result = await BridgeModule.sendSystemHotkey(combo);
        setStatus(`已请求 GUI 发送 ${targetLabel || combo}`, 'success');
        ToolboxShell.appendLog(
          `[COPY_THEN_HOTKEY][TARGET_DONE] key=${targetLabel || combo} combo=${combo} result=${JSON.stringify(result).slice(0, 200)}`,
        );
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[COPY_THEN_HOTKEY][TARGET_FAILED]', {
          source,
          combo,
          key: targetLabel,
          error_type: err && err.name,
          error: errText,
          stack: err && err.stack,
        });
        setStatus(`GUI 目标快捷键失败：${errText}`, 'error');
        ToolboxShell.appendLog(
          `[COPY_THEN_HOTKEY][TARGET_FAILED] key=${targetLabel || combo} error=${errText}`,
        );
        return false;
      }
    }

    async function sendConfiguredHotkey(reason) {
      const reasonText = String(reason || 'copy-hotkey').trim() || 'copy-hotkey';
      if (typeof blurActiveElementIfInsideToolbox === 'function') {
        blurActiveElementIfInsideToolbox();
      }
      if (typeof waitClipboardHotkeyDelay === 'function') {
        await waitClipboardHotkeyDelay(80);
      }
      const hotkeyOk = await triggerCopyThenTargetHotkeyOnce({ source: reasonText });
      ToolboxShell.appendLog(
        `[COPY_ACTION][HOTKEY] reason=${reasonText} ok=${hotkeyOk ? 1 : 0}`,
      );
      return {
        ok: !!hotkeyOk,
        reason: hotkeyOk ? 'ok' : 'hotkey-failed',
        hotkeySent: !!hotkeyOk,
      };
    }

    async function sendHotkeyAfterCopy(options = {}) {
      const {
        copiedText = '',
        reason = 'copy-hotkey',
        shouldStop = () => false,
      } = options;

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
          detail: '',
          hotkeySent: false,
        };
      }

      const clipboardReady = await ensureClipboardReadyBeforeSystemHotkey(
        copiedText,
        reason,
      );

      if (!clipboardReady || clipboardReady.ok !== true) {
        return {
          ok: false,
          reason: clipboardReady && clipboardReady.reason
            ? clipboardReady.reason
            : 'clipboard-not-ready',
          detail: clipboardReady && clipboardReady.error ? clipboardReady.error : '',
          hotkeySent: false,
        };
      }

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
          detail: '',
          hotkeySent: false,
        };
      }

      const hotkeyResult = await sendConfiguredHotkey(reason);

      if (!hotkeyResult || !hotkeyResult.ok) {
        return {
          ok: false,
          reason: 'hotkey-failed',
          detail: '',
          hotkeySent: false,
        };
      }

      return {
        ok: true,
        reason: 'ok',
        detail: '',
        hotkeySent: true,
      };
    }

    async function sendContinuePromptFromUnifiedPipeline(reason, options = {}) {
      const reasonText = String(reason || 'copy-continue').trim() || 'copy-continue';
      const continueResult = await sendContinueMessageOnly(reasonText, options);
      const ok = !!(continueResult && continueResult.ok);
      ToolboxShell.appendLog(
        `[COPY_ACTION][CONTINUE] reason=${reasonText} ok=${ok ? 1 : 0}`,
      );
      return Object.assign({}, continueResult || {}, {
        ok,
        continueSent: ok,
      });
    }

    const COPY_TOOLBAR_BUTTON_SELECTORS = Object.freeze({
      'copy-last-reply': '#cgpt-copy-last-message-scroll-bottom',
      'copy-hotkey': '#cgpt-copy-hotkey-once',
      'copy-continue': '#cgpt-upload-continue-once',
      'copy-hotkey-continue': '#cgpt-copy-hotkey-continue-once',
      'continuous-copy-hotkey-continue': '#cgpt-copy-hotkey-continue-loop',
      'closed-loop-upload-continue': '#cgpt-copy-hotkey-continue-loop-upload-verify',
    });

    const COPY_TOOLBAR_ACTION_ALIASES = Object.freeze({
      'copy-only': 'copy-last-reply',
      'copy-last-message': 'copy-last-reply',
      'copy-and-hotkey': 'copy-hotkey',
      'copy-and-continue': 'copy-continue',
      'loop-copy-hotkey-continue': 'continuous-copy-hotkey-continue',
      'loop-copy-hotkey-continue-upload-verify': 'closed-loop-upload-continue',
    });

    function normalizeToolbarCopyAction(action) {
      const key = String(action || '').trim();
      return COPY_TOOLBAR_ACTION_ALIASES[key] || key;
    }

    function mapToolbarPhaseToButtonPhase(phase) {
      const key = String(phase || '').trim().toLowerCase();
      if (typeof ButtonState === 'undefined' || !ButtonState.Phase) {
        return key;
      }
      const map = {
        running: ButtonState.Phase.RUNNING,
        success: ButtonState.Phase.SUCCESS,
        failed: ButtonState.Phase.FAILED,
        idle: ButtonState.Phase.IDLE,
      };
      return map[key] || key;
    }

    function setButtonPhase(action, phase, text) {
      const normalized = normalizeToolbarCopyAction(action);
      const selector = COPY_TOOLBAR_BUTTON_SELECTORS[normalized];
      if (!selector) {
        return false;
      }
      const scope = rootElRef || document;
      const btn = typeof qs === 'function' ? qs(selector, scope) : null;
      if (!btn) {
        return false;
      }

      const nextPhase = mapToolbarPhaseToButtonPhase(phase);
      const nextText = String(text || '').trim();

      if (typeof ButtonState !== 'undefined' && typeof ButtonState.setToolboxButtonState === 'function') {
        ButtonState.setToolboxButtonState(btn, {
          phase: nextPhase,
          text: nextText,
          reason: `setButtonPhase:${normalized}`,
        });
        return true;
      }

      if (nextText) {
        btn.textContent = nextText;
      }
      const failedPhase = typeof ButtonState !== 'undefined' && ButtonState.Phase
        ? ButtonState.Phase.FAILED
        : 'failed';
      const successPhase = typeof ButtonState !== 'undefined' && ButtonState.Phase
        ? ButtonState.Phase.SUCCESS
        : 'success';
      if (nextPhase === 'failed' || nextPhase === failedPhase) {
        btn.classList.add('cgpt-btn-failed');
      } else if (nextPhase === 'success' || nextPhase === successPhase) {
        btn.classList.add('cgpt-btn-success');
      }
      return true;
    }

    async function handleCopyLastReplyClick() {
      setButtonPhase('copy-last-reply', 'running', '复制中');
      const copied = await copyLastReplyWithState('copy-last-reply');
      if (!copied) {
        setButtonPhase('copy-last-reply', 'failed', '复制失败');
        return false;
      }
      setButtonPhase('copy-last-reply', 'success', '已复制');
      return true;
    }

    async function handleCopyHotkeyClick() {
      setButtonPhase('copy-hotkey', 'running', '复制中');
      const result = await runCopyAndHotkeyAction('copy-hotkey');
      if (!result || !result.ok) {
        if (!result || !result.copied) {
          setButtonPhase('copy-hotkey', 'failed', '复制失败');
          console.warn('[COPY_HOTKEY][SKIP_HOTKEY]', { reason: 'copy_failed' });
        } else {
          setButtonPhase('copy-hotkey', 'failed', '快捷键失败');
        }
        return false;
      }
      setButtonPhase('copy-hotkey', 'success', '已完成');
      return true;
    }

    async function handleCopyContinueClick() {
      setButtonPhase('copy-continue', 'running', '复制中');
      const result = await copyLastMessageAndContinue('copy-continue');
      if (!result) {
        setButtonPhase('copy-continue', 'failed', '复制失败');
        console.warn('[COPY_CONTINUE][SKIP_CONTINUE]', { reason: 'copy_failed' });
        return false;
      }
      setButtonPhase('copy-continue', 'success', '已继续');
      return true;
    }

    async function handleCopyHotkeyContinueClick() {
      setButtonPhase('copy-hotkey-continue', 'running', '复制中');
      const result = await copyHotkeyAndContinueOnce('copy-hotkey-continue');
      if (!result || !result.ok) {
        if (!result || !result.copied) {
          setButtonPhase('copy-hotkey-continue', 'failed', '复制失败');
          console.warn('[COPY_HOTKEY_CONTINUE][SKIP]', { reason: 'copy_failed' });
        } else if (!result.hotkeySent) {
          setButtonPhase('copy-hotkey-continue', 'failed', '快捷键失败');
          console.warn('[COPY_HOTKEY_CONTINUE][SKIP_CONTINUE]', { reason: 'hotkey_failed' });
        } else {
          setButtonPhase('copy-hotkey-continue', 'failed', '继续失败');
        }
        return false;
      }
      setButtonPhase('copy-hotkey-continue', 'success', '已完成');
      return true;
    }

    async function handleContinuousCopyHotkeyContinueClick() {
      setButtonPhase('continuous-copy-hotkey-continue', 'running', '连续执行中');
      const result = await runCopyHotkeyContinueLoop('continuous-copy-hotkey-continue');
      const ok = !!(result && (result.ok === true || result === true));
      if (!ok) {
        setButtonPhase('continuous-copy-hotkey-continue', 'failed', '执行失败');
        return false;
      }
      setButtonPhase('continuous-copy-hotkey-continue', 'success', '已完成');
      return true;
    }

    const copyToolbarButtonHandlers = Object.freeze({
      'copy-last-reply': handleCopyLastReplyClick,
      'copy-hotkey': handleCopyHotkeyClick,
      'copy-continue': handleCopyContinueClick,
      'copy-hotkey-continue': handleCopyHotkeyContinueClick,
      'continuous-copy-hotkey-continue': handleContinuousCopyHotkeyContinueClick,
    });

    async function runCopyAction(actionType, options = {}) {
      const type = String(actionType || 'copy-only').trim() || 'copy-only';
      const source = String(options.source || 'runCopyAction').trim() || 'runCopyAction';
      const flowOptions = options && typeof options === 'object' ? options : {};

      ToolboxShell.appendLog(`[COPY_ACTION][START] type=${type}`);

      if (type === 'copy-only') {
        const result = await copyLastReplyWithState(source);
        ToolboxShell.appendLog(`[COPY_ACTION][DONE] type=${type} ok=${result ? 1 : 0}`);
        return result;
      }

      if (type === 'copy-and-continue') {
        const result = await copyLastMessageAndContinue(source);
        ToolboxShell.appendLog(
          `[COPY_ACTION][CONTINUE_DONE] type=${type} ok=${result ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'copy-and-hotkey') {
        const result = await runCopyAndHotkeyAction(source, flowOptions);
        ToolboxShell.appendLog(
          `[COPY_ACTION][HOTKEY_DONE] type=${type} ok=${result && result.ok ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'copy-hotkey-continue') {
        const result = await copyHotkeyAndContinueOnce(source, flowOptions);
        ToolboxShell.appendLog(
          `[COPY_ACTION][DONE] type=${type} ok=${result && result.ok ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'loop-copy-hotkey-continue') {
        return runCopyHotkeyContinueLoop(source);
      }

      if (type === 'loop-copy-hotkey-continue-upload-verify') {
        return toggleCopyHotkeyUploadVerifyLoop(source);
      }

      ToolboxShell.appendLog(`[COPY_ACTION][UNKNOWN_TYPE] type=${type}`);
      return {
        ok: false,
        reason: 'unknown-action-type',
      };
    }

    async function waitAssistantStableForCopyContinue(source = 'copy-continue', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-start] source=${String(source || '-')}`,
      );

      setStatus('正在等待当前回复完成...', 'danger', {
        persist: true,
        shortText: '等回复',
      });

      if (
        typeof ChatMessageExtractor === 'undefined'
        || typeof ChatMessageExtractor.waitLatestAssistantStable !== 'function'
      ) {
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][wait-failed] reason=waitLatestAssistantStable-missing');
        return {
          ok: false,
          reason: 'waitLatestAssistantStable-missing',
        };
      }

      const pendingReplyContext = typeof BridgeModule !== 'undefined'
        && BridgeModule
        && typeof BridgeModule.getPendingReplyContext === 'function'
        ? BridgeModule.getPendingReplyContext()
        : null;

      const result = await ChatMessageExtractor.waitLatestAssistantStable({
        timeoutMs: COPY_CONTINUE_WAIT_TIMEOUT_MS,
        intervalMs: COPY_CONTINUE_STABLE_INTERVAL_MS,
        stableRounds: COPY_CONTINUE_STABLE_ROUNDS,
        pendingReplyContext,
        shouldStop,
        isGenerating: () => {
          return typeof ComposerApi !== 'undefined'
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy();
        },
      });

      const trimmedText = String(result && result.text ? result.text : '').trim();

      if (!result || !result.ok || !trimmedText) {
        const reason = result && result.reason ? result.reason : 'unknown';

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][wait-failed] reason=${reason}`,
        );

        setStatus(`等待回复完成失败：${reason}`, 'warn');

        return {
          ok: false,
          reason,
          result,
        };
      }

      if (typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(trimmedText)) {
        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][wait-failed] reason=invalid-assistant-text preview=${trimmedText.slice(0, 40)}`,
        );

        setStatus('等待回复完成失败：回复尚未就绪', 'warn');

        return {
          ok: false,
          reason: 'invalid-assistant-text',
          result,
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-ok] chars=${trimmedText.length} reason=${result.reason || '-'}`,
      );

      return {
        ok: true,
        text: trimmedText,
        record: result.record || null,
        result,
      };
    }

    async function waitAndCopyLatestAssistant(options = {}) {
      const {
        source = 'button',
        reason = 'copy',
        shouldStop = () => false,
      } = options;

      if (
        options
        && (
          options.scrollBeforeCopy === false
          || options.scrollAfterCopy === false
        )
      ) {
        ToolboxShell.appendLog(
          `[COPY_WAIT][SCROLL_OPTION_IGNORED] reason=${reason} scrollBeforeCopy=${options.scrollBeforeCopy} scrollAfterCopy=${options.scrollAfterCopy}`,
        );
      }

      try {
        const waitResult = await waitAssistantStableForCopyContinue(source, { shouldStop });

        if (!waitResult || !waitResult.ok) {
          return {
            ok: false,
            reason: waitResult && waitResult.reason ? waitResult.reason : 'wait-assistant-failed',
            detail: '',
            copied: false,
            text: '',
            chars: 0,
            waitResult,
            copyResult: null,
          };
        }

        if (!String(waitResult.text || '').trim()) {
          return {
            ok: false,
            reason: 'empty-assistant-text',
            detail: '',
            copied: false,
            text: '',
            chars: 0,
            waitResult,
            copyResult: null,
          };
        }

        if (shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
            detail: '',
            copied: false,
            text: '',
            chars: 0,
            waitResult,
            copyResult: null,
          };
        }

        const copyResult = await copyLatestAssistantReplyUnified({
          reason,
          prefilledText: waitResult.text,
        });

        if (!copyResult || copyResult.ok !== true) {
          return {
            ok: false,
            reason: copyResult && copyResult.reason ? copyResult.reason : 'copy-failed',
            detail: copyResult && copyResult.error ? copyResult.error : '',
            copied: false,
            text: '',
            chars: 0,
            waitResult,
            copyResult,
          };
        }

        return {
          ok: true,
          reason: 'ok',
          detail: '',
          copied: true,
          text: copyResult.text || waitResult.text,
          chars: copyResult.chars || 0,
          waitResult,
          copyResult,
        };
      } finally {
        await forceScrollChatToBottomForCopy(reason, 'wait-finally');
      }
    }

    const COPY_LAST_BUTTON_EXTRA_CLASSES = [
      'cgpt-btn-idle',
      'cgpt-btn-waiting',
      'cgpt-btn-running',
      'cgpt-btn-uploading',
      'cgpt-btn-waiting-send',
      'cgpt-btn-waiting-reply',
      'cgpt-btn-copying',
      'cgpt-btn-cancelling',
      'cgpt-btn-success',
      'cgpt-btn-failed',
      'cgpt-btn-danger',
      'cgpt-btn-cancelled',
      'cgpt-btn-disabled',
      'cgpt-btn-ok',
      'cgpt-btn-error',
      'cgpt-btn-waiting-danger',
      'cgpt-waiting-answer',
      'waiting',
      'success',
      'danger',
      'warning',
      'busy',
      'cgpt-btn-busy',
      'primary',
    ];

    function isCopyLastButtonManagedLocally(btn) {
      if (!btn) {
        return false;
      }
      const copyState = String(btn.dataset.copyState || 'idle').trim();
      return copyState !== 'idle';
    }

    function setCopyLastButtonState(stateName, reason = '') {
      const btn = rootElRef
        ? qs(UploadSelectors.copyLastMessageBtn, rootElRef)
        : document.querySelector(UploadSelectors.copyLastMessageBtn);

      if (!btn) {
        ToolboxShell.appendLog(
          `[COPY_LAST][BUTTON_STATE_SKIP] state=${stateName} reason=${reason || '-'} detail=missing-button`,
        );
        return;
      }

      if (copyLastButtonResetTimer) {
        window.clearTimeout(copyLastButtonResetTimer);
        copyLastButtonResetTimer = 0;
      }

      if (typeof ButtonState !== 'undefined' && typeof ButtonState.clearButtonStateClasses === 'function') {
        ButtonState.clearButtonStateClasses(btn);
      }

      COPY_LAST_BUTTON_EXTRA_CLASSES.forEach((cls) => {
        btn.classList.remove(cls);
      });

      btn.classList.remove(
        'cgpt-copy-last-idle',
        'cgpt-copy-last-running',
        'cgpt-copy-last-success',
        'cgpt-copy-last-failed',
      );

      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      btn.removeAttribute('disabled');
      delete btn.dataset.waitDanger;
      delete btn.dataset.waitDangerReason;

      if (stateName === 'running') {
        btn.textContent = '复制中';
        btn.title = '正在复制最后一条回复';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.classList.add('cgpt-copy-last-running');
        btn.dataset.copyState = 'running';
        return;
      }

      if (stateName === 'success') {
        btn.textContent = '复制成功';
        btn.title = '最后回复已复制';
        btn.classList.add('cgpt-copy-last-success');
        btn.dataset.copyState = 'success';
        return;
      }

      if (stateName === 'failed') {
        btn.textContent = '复制失败';
        btn.title = reason ? `复制失败：${reason}` : '复制失败';
        btn.classList.add('cgpt-copy-last-failed');
        btn.dataset.copyState = 'failed';
        return;
      }

      btn.textContent = '复制最后回复';
      btn.title = '复制最后一条回复';
      btn.classList.add('cgpt-copy-last-idle');
      btn.dataset.copyState = 'idle';
    }

    function resetCopyLastButtonSoon(delay = 900) {
      if (copyLastButtonResetTimer) {
        window.clearTimeout(copyLastButtonResetTimer);
        copyLastButtonResetTimer = 0;
      }
      copyLastButtonResetTimer = window.setTimeout(() => {
        copyLastButtonResetTimer = 0;
        setCopyLastButtonState('idle', 'reset-after-copy');
        renderUploadButtonsOnly();
      }, Math.max(300, Number(delay) || 900));
    }

    async function copyLastReplyWithState(source = 'button') {
      if (copyLastReplyTaskRunning) {
        const runningMs = Date.now() - Number(copyLastReplyTaskStartedAt || 0);
        if (runningMs <= 90000) {
          ToolboxShell.appendLog(
            `[COPY_LAST_REPLY][skip] reason=task-running runningMs=${runningMs}`,
          );
          return false;
        }
        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][stale-release] runningMs=${runningMs}`,
        );
        copyLastReplyTaskRunning = false;
        copyLastReplyTaskStartedAt = 0;
        copyLastReplyTaskStatus = '';
        copyLastMessageTaskRunning = false;
        copyLastMessageTaskStartedAt = 0;
        copyLastMessageTaskStatus = '';
        copyLastMessageWaiting = false;
      }

      copyLastReplyTaskRunning = true;
      copyLastReplyTaskStartedAt = Date.now();
      copyLastReplyTaskStatus = 'waiting';
      copyLastMessageTaskRunning = true;
      copyLastMessageTaskStartedAt = copyLastReplyTaskStartedAt;
      copyLastMessageTaskStatus = 'waiting';
      copyLastMessageTaskSource = String(source || 'button');
      copyLastMessageWaiting = true;
      setCopyLastButtonState('running', `copy-only:${String(source || '-')}`);
      renderUploadButtonsOnly();

      if (typeof markLatestAssistantMessageCacheDirty === 'function') {
        markLatestAssistantMessageCacheDirty();
      }

      try {
        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][start] source=${String(source || '-')}`,
        );
        setStatus('正在等待最后回复稳定...', 'running');

        copyLastReplyTaskStatus = 'copying';
        copyLastMessageTaskStatus = 'copying';
        copyLastMessageWaiting = false;
        setCopyLastButtonState('running', 'copying');
        renderUploadButtonsOnly();

        const waitCopyResult = await waitAndCopyLatestAssistant({
          source,
          reason: `copy-only:${String(source || '-')}`,
        });

        if (!waitCopyResult.ok) {
          const reason = waitCopyResult.reason || 'copy-failed';
          const detail = waitCopyResult.detail ? ` detail=${waitCopyResult.detail}` : '';
          ToolboxShell.appendLog(
            `[COPY_LAST_REPLY][abort] reason=${reason}${detail}`,
          );
          setStatus(`复制最后回复失败：${reason}`, 'warn');
          copyLastReplyTaskStatus = 'failed';
          copyLastMessageTaskStatus = 'failed';
          copyLastMessageWaiting = false;
          setCopyLastButtonState('failed', reason);
          resetCopyLastButtonSoon(1600);
          renderUploadButtonsOnly();
          return false;
        }

        copyLastReplyTaskStatus = 'success';
        copyLastMessageTaskStatus = 'success';
        setCopyLastButtonState('success', 'copy-only-ok');
        resetCopyLastButtonSoon(900);
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][done] chars=${waitCopyResult.chars || 0}`,
        );
        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(source || '-', 'copyLastReply');
        }
        return true;
      } catch (error) {
        const errText = typeof formatToolboxError === 'function'
          ? formatToolboxError(error)
          : String(error && error.message ? error.message : error);
        console.error('[ChatGPT toolbox] copy last message failed', error);
        ToolboxShell.appendLog(`[COPY_LAST][FAILED] error=${errText}`);
        setStatus(`复制最后回复失败：${errText}`, 'error');
        copyLastReplyTaskStatus = 'failed';
        copyLastMessageTaskStatus = 'failed';
        copyLastMessageWaiting = false;
        setCopyLastButtonState('failed', errText);
        resetCopyLastButtonSoon(1600);
        renderUploadButtonsOnly();
        return false;
      } finally {
        const resetDelay = copyLastReplyTaskStatus === 'success' ? 800 : 1200;
        window.setTimeout(() => {
          copyLastReplyTaskRunning = false;
          copyLastReplyTaskStartedAt = 0;
          copyLastReplyTaskStatus = '';
          copyLastMessageTaskRunning = false;
          copyLastMessageTaskStartedAt = 0;
          copyLastMessageTaskStatus = '';
          copyLastMessageTaskSource = '';
          copyLastMessageWaiting = false;
          renderUploadButtonsOnly();
        }, resetDelay);
      }
    }

    async function sendContinueMessageOnly(source = 'button', options = {}) {
      const sourceText = String(source || '');
      const isLoopMode = sourceText.startsWith('loop-');
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
          assistantDoneSignal: false,
        };
      }

      safeAppendLog(`[UPLOAD_CONTINUE][SEND_START] source=${sourceText}`);
      console.warn('[UPLOAD_CONTINUE][SEND_START]', { source: sourceText });

      const assistantRawBeforeSend = getLastAssistantMessageTextForStopSignal();
      const doneBeforeSend = checkUploadDoneSignalWithLog(
        assistantRawBeforeSend,
        'UPLOAD_CONTINUE',
        'before-send',
        `source=${sourceText}`,
        options,
      );
      if (doneBeforeSend) {
        const preview = formatDoneSignalPreview(assistantRawBeforeSend);
        const skipLine = `[UPLOAD_CONTINUE][skip] reason=assistant-done-signal-before-send source=${sourceText} preview=${preview}`;
        safeAppendLog(skipLine);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(skipLine);
        }
        console.warn('[UPLOAD_CONTINUE][skip]', {
          source: sourceText,
          reason: 'assistant-done-signal-before-send',
          preview,
        });
        return {
          ok: false,
          reason: 'assistant-done-signal-before-send',
          assistantDoneSignal: true,
        };
      }

      if (isWaitingSendActive()) {
        cancelWaitingSend('copy-continue');
      }

      const continuePromptText = getCopyHotkeyContinuePromptText(options);
      const promptPreview = formatContinuePromptPreview(continuePromptText, 160);
      const previewLine = `[UPLOAD_CONTINUE][PROMPT_PREVIEW] chars=${continuePromptText.length} preview=${promptPreview}`;
      safeAppendLog(previewLine);
      console.warn('[UPLOAD_CONTINUE][PROMPT_PREVIEW]', {
        chars: continuePromptText.length,
        preview: promptPreview,
      });

      let result = await sendContinueMessageOnceOnly(sourceText, options);
      let reason = result && result.reason ? result.reason : '';

      if (result && result.ok) {
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=${reason || '-'}`);
        return result;
      }

      if (isLoopMode && isAssistantBusyReason(reason)) {
        const composerText = (
          typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.getComposerText === 'function'
        )
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';

        let busyNow = false;
        try {
          busyNow = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (busyCheckErr) {
          console.error('[UPLOAD_CONTINUE][BUSY_CHECK_FAILED]', {
            source: sourceText,
            error_type: busyCheckErr && busyCheckErr.name,
            error: busyCheckErr && busyCheckErr.message,
            stack: busyCheckErr && busyCheckErr.stack,
          });
          busyNow = false;
        }

        if (busyNow || !composerText) {
          safeAppendLog(
            `[UPLOAD_CONTINUE][BUSY_AFTER_SEND_TREAT_AS_ACCEPTED] source=${sourceText} reason=${reason || '-'} busyNow=${busyNow ? '1' : '0'} composerChars=${composerText.length}`,
          );

          console.warn('[UPLOAD_CONTINUE][BUSY_AFTER_SEND_TREAT_AS_ACCEPTED]', {
            source: sourceText,
            reason,
            result,
            busyNow,
            composerChars: composerText.length,
          });

          return {
            ok: true,
            reason: 'send-accepted-assistant-busy',
            detail: reason || '',
            assistantBusyAfterSend: busyNow,
          };
        }

        safeAppendLog(
          `[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=continue-send-not-confirmed detail=${reason || '-'}`,
        );
        console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', {
          source: sourceText,
          reason: 'continue-send-not-confirmed',
          detail: reason,
          composerText,
          busyNow,
          result,
        });

        return {
          ok: false,
          reason: 'continue-send-not-confirmed',
          detail: reason || '',
        };
      }

      safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${reason || 'unknown'}`);
      console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', {
        source: sourceText,
        reason,
        result,
      });

      return {
        ok: false,
        reason: reason || 'send-failed',
        detail: reason || '',
      };
    }

    async function sendContinueMessageOnceOnly(source, options = {}) {
      const sourceText = String(source || '');
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
      const text = getCopyHotkeyContinuePromptText(options);
      const stopSignal = getCopyHotkeyContinueStopSignal(options);

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      if (typeof sendContentViaComposer === 'function') {
        try {
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          const result = await sendContentViaComposer({
            source,
            content: text,
            allowReplaceDraft: true,
            waitUntilSendable: true,
            blockWhenResponding: false,
            timeoutMs: typeof SEND_WAIT_TIMEOUT_MS === 'number' ? SEND_WAIT_TIMEOUT_MS : 60000,
            shouldStop,
          });
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          if (!result || !result.ok) {
            const reason = result && result.reason ? result.reason : 'unknown';
            setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${reason}`, 'warn');
            console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason, result });
            safeAppendLog(`[UPLOAD_CONTINUE][send-failed] reason=${reason}`);
            safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${reason}`);
            return { ok: false, reason };
          }

          setStatus('已发送继续指令', 'success');
          console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: result && result.reason });
          safeAppendLog(`[UPLOAD_CONTINUE][sent] chars=${text.length} stopSignal=${stopSignal}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=${result && result.reason ? result.reason : '-'}`);
          return { ok: true, reason: result.reason || 'composer-send' };
        } catch (err) {
          const errText = formatToolboxError(err);
          console.error('[ChatGPT toolbox] send continue message failed', err);
          setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${errText}`, 'error');
          safeAppendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${errText}`);
          return { ok: false, reason: errText };
        }
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};
      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(`ChatGPT \u8f93\u5165\u6846\u5df2\u6709${existingText.length} \u4e2a\u5b57\u7b26\uff0c\u662f\u5426\u8986\u76d6\u5e76\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff1f`);
        if (!okReplace) {
          setStatus('\u5df2\u53d6\u6d88\u53d1\u9001\u7ee7\u7eed\uff1a\u672a\u8986\u76d6\u8f93\u5165\u6846\u8349\u7a3f', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'user-refused-overwrite' });
          safeAppendLog(`[UPLOAD_CONTINUE][send-cancel] reason=user-refused-overwrite existingChars=${existingText.length}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=user-refused-overwrite`);
          return { ok: false, reason: 'user-refused-overwrite' };
        }
      } else if (existingText && existingText !== text) {
        safeAppendLog(`[UPLOAD_CONTINUE][auto-overwrite-draft] existingChars=${existingText.length} newChars=${text.length}`);
      }

      try {
        const okSet = typeof ComposerApi.setComposerValue === 'function'
          && ComposerApi.setComposerValue(text);
        if (!okSet) {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u672a\u627e\u5230\u8f93\u5165\u6846', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'composer-not-found' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=composer-not-found');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=composer-not-found`);
          return { ok: false, reason: 'composer-not-found' };
        }
        await sleep(300);
        const sendWaitStartedAt = Date.now();
        while (typeof ComposerApi.canSendNow === 'function' && !ComposerApi.canSendNow()) {
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          if (Date.now() - sendWaitStartedAt >= 60000) {
            setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u53d1\u9001\u6309\u94ae\u7b49\u5f85\u8d85\u65f6', 'warn');
            console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'send-button-wait-timeout' });
            safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=send-button-wait-timeout');
            safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=send-button-wait-timeout`);
            return { ok: false, reason: 'send-button-wait-timeout' };
          }
          await sleep(250);
        }
        if (typeof ComposerApi.clickSend !== 'function') {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u53d1\u9001 API \u4e0d\u53ef\u7528', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'send-api-missing' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=send-api-missing');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=send-api-missing`);
          return { ok: false, reason: 'send-api-missing' };
        }
        if (shouldStop()) {
          return { ok: false, reason: 'cancelled' };
        }
        const clicked = ComposerApi.clickSend();
        if (!clicked) {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u70b9\u51fb\u53d1\u9001\u5931\u8d25', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'click-send-failed' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=click-send-failed');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=click-send-failed`);
          return { ok: false, reason: 'click-send-failed' };
        }
        setStatus('已发送继续指令', 'success');
        console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: 'composer-click-send' });
        safeAppendLog(`[UPLOAD_CONTINUE][sent] chars=${text.length} stopSignal=${stopSignal}`);
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=composer-click-send`);
        return { ok: true, reason: 'composer-click-send' };
      } catch (err) {
        const errText = formatToolboxError(err);
        console.error('[ChatGPT toolbox] send continue message failed', err);
          setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${errText}`, 'error');
        safeAppendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${errText}`);
        return { ok: false, reason: errText };
      }
    }

    function getLastAssistantMessageTextForStopSignal() {
      const assistantNodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]'),
      );

      const lastNode = assistantNodes.length > 0
        ? assistantNodes[assistantNodes.length - 1]
        : null;

      if (!lastNode) {
        return '';
      }

      return String(lastNode.innerText || lastNode.textContent || '').trim();
    }

    function detectCopyHotkeyLoopStopSignal(cycleIndex) {
      const indexText = String(cycleIndex == null ? '-' : cycleIndex);
      const candidates = [];

      const domText = getLastAssistantMessageTextForStopSignal();
      if (domText) {
        candidates.push({ source: 'dom-latest-assistant', text: domText });
      }

      try {
        if (
          typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
          && (typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
            || typeof ChatMessageExtractor.buildRecords === 'function')
        ) {
          const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
            ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
            : ChatMessageExtractor.buildRecords({ includeEmpty: false });
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
          if (picked && picked.ok && picked.record) {
            const recordText = String(picked.record.text || '').trim();
            if (recordText) {
              candidates.push({ source: 'extractor-record', text: recordText });
            }
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error]', {
          index: cycleIndex,
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error] index=${indexText} error=${errText}`,
        );
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error] index=${indexText} error=${errText}`,
          );
        }
      }

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const matched = checkUploadDoneSignalWithLog(
          candidate.text,
          'COPY_HOTKEY_CONTINUE_LOOP',
          'loop-detect',
          `index=${indexText} source=${candidate.source}`,
        );
        if (matched) {
          const preview = formatDoneSignalPreview(candidate.text);
          const hitLine = `[COPY_HOTKEY_CONTINUE_LOOP][assistant-done-signal] index=${indexText} source=${candidate.source} preview=${preview}`;
          safeAppendLog(hitLine);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(hitLine);
          }
          return {
            matched: true,
            reason: 'assistant-done-signal',
            source: candidate.source,
          };
        }
      }

      return {
        matched: false,
        reason: 'not-matched',
      };
    }

    function isAssistantBusyReason(reason) {
      const text = String(reason || '').toLowerCase();
      return (
        text.includes('assistant_busy')
        || text.includes('busy')
        || text.includes('generating')
        || text.includes('send_not_confirmed')
      );
    }

    async function copyLastMessageAndContinue(source = 'button') {
      const btn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;

      if (copyContinueTaskRunning) {
        const runningMs = Date.now() - Number(copyContinueTaskStartedAt || 0);

        if (runningMs <= 90000) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][skip] reason=task-running runningMs=${runningMs}`,
          );
          return false;
        }

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][stale-release] runningMs=${runningMs}`,
        );
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
      }

      if (btn) {
        const busyState = clearStaleUploadButtonBusy(btn, {
          action: 'copy-continue',
          source: String(source || '-'),
          logTag: 'UPLOAD_COPY_CONTINUE',
        });
        if (busyState.skipped) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][skip] reason=button-busy busyMs=${busyState.busyMs}`,
          );
          return false;
        }
      }

      copyContinueTaskRunning = true;
      copyContinueTaskStartedAt = Date.now();
      copyTaskStatus = 'waiting_assistant';
      state.copyContinueTask.runId = createId('copy_continue');
      state.copyContinueTask.cancelRequested = false;
      state.copyContinueTask.stopRequested = false;
      state.copyContinueTask.phase = 'waiting_reply';

      void unlockToolboxAudio('copy-continue-start');

      if (btn && btn.dataset.busy === '1') {
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][skip] reason=button-busy-after-claim');
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
        copyTaskStatus = 'idle';
        return false;
      }

      const assistantBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      setCopyContinueButtonBusy(btn, true, {
        startedAt: copyContinueTaskStartedAt,
        assistantBusy,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][start] source=${String(source || '-')} assistantBusy=${assistantBusy ? '1' : '0'}`,
      );

      try {
        copyTaskStatus = 'copying';
        state.copyContinueTask.phase = 'copying';
        renderUploadButtonsOnly({ buttonTasksReason: 'copy-continue-copying' });

        const waitCopyResult = await waitAndCopyLatestAssistant({
          source,
          reason: `copy-and-continue:${String(source || '-')}`,
        });

        if (!waitCopyResult.ok) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][abort] reason=${waitCopyResult.reason || 'wait-assistant-failed'} detail=${waitCopyResult.detail || '-'}`,
          );
          return false;
        }

        copyTaskStatus = 'copied';

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][copied] chars=${waitCopyResult.chars || 0}`,
        );

        void playCopySuccessBeepSafe(source || '-', 'copyContinue');

        copyTaskStatus = 'sending_continue';
        state.copyContinueTask.phase = 'sending_continue';
        renderUploadButtonsOnly({ buttonTasksReason: 'copy-continue-sending' });

        const sentResult = await sendContinuePromptFromUnifiedPipeline('copy-continue-after-wait');

        if (!sentResult || !sentResult.ok) {
          ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][failed] reason=continue-send-failed');
          return false;
        }

        copyTaskStatus = 'done';
        state.copyContinueTask.phase = 'success';
        setStatus('已复制最后回复，并发送：继续', 'success');
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][done] copied=1 sent=1');
        setButtonTemporaryOk(btn);

        return true;
      } catch (error) {
        copyTaskStatus = 'failed';
        state.copyContinueTask.phase = 'failed';
        const errText = formatToolboxError(error);
        console.error('[ChatGPT toolbox] copyLastMessageAndContinue failed', error);
        ToolboxShell.appendLog(`[UPLOAD_COPY_CONTINUE][failed] error=${errText}`);
        setStatus(`复制并继续失败：${errText}`, 'error');
        setButtonTemporaryError(btn, '复制失败', 1200);
        return false;
      } finally {
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
        if (copyTaskStatus !== 'done' && copyTaskStatus !== 'failed') {
          copyTaskStatus = 'idle';
          state.copyContinueTask.phase = 'idle';
        }
        state.copyContinueTask.runId = '';
        state.copyContinueTask.cancelRequested = false;
        state.copyContinueTask.stopRequested = false;

        setCopyContinueButtonBusy(btn, false);

        if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'task_done');
        }

        renderUploadButtonsOnly();
      }
    }


    function buildAssistantMessageKeyFromRecord(record, textOverride = '') {
      const recordObj = record && typeof record === 'object' ? record : null;
      if (!recordObj) {
        return '';
      }
      const text = typeof ChatMessageExtractor !== 'undefined'
        && typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText(textOverride || recordObj.text || '').trim()
        : String(textOverride || recordObj.text || '').trim();
      const turnId = String(recordObj.turn_id || '').trim();
      if (turnId) {
        return turnId;
      }
      return [
        turnId,
        text,
        String(recordObj.char_count || 0),
        String(recordObj.no_space_char_count || 0),
      ].join('||');
    }

    function getLastAssistantMessageKeySafe() {
      try {
        if (
          typeof ChatMessageExtractor === 'undefined'
          || typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser !== 'function'
          || (typeof ChatMessageExtractor.getFastTailMessageRecords !== 'function'
            && typeof ChatMessageExtractor.buildRecords !== 'function')
        ) {
          return '';
        }
        const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
          ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
          : ChatMessageExtractor.buildRecords({ includeEmpty: false });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
        if (!picked || !picked.ok || !picked.record) {
          return '';
        }
        return buildAssistantMessageKeyFromRecord(picked.record);
      } catch (error) {
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][get-key-failed]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return '';
      }
    }

    function logCopyHotkeyContinueStep(sourceText, step) {
      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE][STEP] source=${sourceText || '-'} step=${step}`,
      );
      console.warn('[COPY_HOTKEY_CONTINUE][STEP]', {
        source: sourceText || '-',
        step,
      });
    }

    function isCopyAndHotkeyShortcut(event) {
      const item = getCopyAndHotkeyShortcutConfig();
      return isShortcutEventMatched(event, item);
    }

    async function runCopyHotkeyOnce(source = 'unknown', event = null) {
      const src = String(source || 'unknown').trim() || 'unknown';
      ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][run] source=${src}`);
      try {
        return await handleCopyHotkeyOnceTrigger(src, event);
      } finally {
        scheduleRenderUpload(`copy-hotkey-once:${src}`);
      }
    }

    async function handleCopyHotkeyOnceTrigger(source = 'button', event = null) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      const sourceText = String(source || 'button').trim() || 'button';
      const actionSource = sourceText === 'delegated-click' ? 'button' : sourceText;

      if (actionSource === 'shortcut') {
        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][shortcut-trigger]');
      } else {
        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][click] source=button');
      }

      try {
        return await runCopyAndHotkeyAction(actionSource);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const failTag = actionSource === 'shortcut'
          ? '[COPY_HOTKEY_ONCE][SHORTCUT_FAILED]'
          : '[COPY_HOTKEY_ONCE][CLICK_FAILED]';

        console.error(failTag, {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`${failTag} ${errText}`);
        setStatus(`复制+快捷键失败：${errText}`, 'error');

        return {
          ok: false,
          reason: 'exception',
          detail: errText,
          copied: false,
          hotkeySent: false,
        };
      }
    }

    function bindCopyAndHotkeyShortcut() {
      if (window.__xzCopyAndHotkeyShortcutBound) {
        ToolboxShell.appendLog('[SHORTCUT][bind-skip] copyAndHotkeyOnce=already-bound');
        return;
      }

      window.__xzCopyAndHotkeyShortcutBound = true;

      window.addEventListener(
        'keydown',
        (event) => {
          if (!isCopyAndHotkeyShortcut(event)) {
            return;
          }

          if (event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          if (shouldIgnoreToolboxShortcutTarget(event.target)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          void handleCopyHotkeyOnceTrigger('shortcut', event);
        },
        true,
      );

      const item = getCopyAndHotkeyShortcutConfig();
      ToolboxShell.appendLog('[SHORTCUT][bind] copyAndHotkeyOnce=configurable');
      console.log('[TOOLBOX][COPY_HOTKEY][SHORTCUT_BOUND]', {
        shortcut: item.label || '-',
      });
    }

    async function runCopyAndHotkeyAction(source = 'button', options = {}) {
      const sourceText = String(source || '');
      ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][start] source=${sourceText || '-'}`);
      setStatus('正在执行复制+快捷键...', 'running');
      console.log('[TOOLBOX][COPY_HOTKEY][START]', { source: sourceText });
      const flowOptions = options && typeof options === 'object' ? options : {};
      const shouldStop = typeof flowOptions.shouldStop === 'function'
        ? flowOptions.shouldStop
        : () => false;

      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyOnceBtn, rootElRef) : null;

      const actionLock = claimUploadActionLock('copy-hotkey-once');
      if (!actionLock.ok) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][skip] reason=${actionLock.reason} runningMs=${actionLock.runningMs || 0}`,
        );
        return {
          ok: false,
          reason: actionLock.reason || 'task-running',
          copied: false,
          hotkeySent: false,
        };
      }

      if (
        isCopyHotkeyContinueActive()
        || isCopyHotkeyLoopActive()
        || isCopyHotkeyUploadVerifyLoopActive()
      ) {
        releaseUploadActionLock('copy-hotkey-once');
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][skip] reason=copy-hotkey-continue-running continueTask=${isCopyHotkeyContinueActive() ? '1' : '0'} loop=${isCopyHotkeyLoopActive() ? '1' : '0'} uploadVerifyLoop=${isCopyHotkeyUploadVerifyLoopActive() ? '1' : '0'}`,
        );
        setStatus('复制+快捷键失败：当前已有复制+快捷键任务运行中', 'warn');
        return {
          ok: false,
          reason: 'copy-hotkey-continue-running',
          copied: false,
          hotkeySent: false,
        };
      }

      if (btn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_hotkey', BUTTON_LONG_WAIT_DANGER_MS);
      }

      try {
        if (btn) {
          btn.dataset.busy = '1';
        }
        setCopyHotkeyOncePhase('waiting_reply', sourceText || 'start');
        setStatus('正在等待回答完成，然后复制并发送快捷键', 'running');
        setCopyHotkeyOncePhase('copying', `${sourceText || 'start'}:copying`);

        const waitCopyResult = await waitAndCopyLatestAssistant({
          source,
          reason: `copy-and-hotkey:${sourceText || '-'}`,
          shouldStop,
        });

        if (!waitCopyResult.ok) {
          const reason = waitCopyResult.reason || 'copy-failed';
          const errText = waitCopyResult.detail || reason;
          ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][abort] reason=${reason} detail=${errText}`);
          setStatus(`复制+快捷键失败：${reason}`, 'warn');
          return {
            ok: false,
            reason,
            detail: errText,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantDoneSignal: false,
          };
        }

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][copied] chars=${waitCopyResult.chars || 0}`,
        );

        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyOnce');
        }

        setCopyHotkeyOncePhase('confirming_clipboard', `${sourceText || 'start'}:clipboard`);

        if (shouldStop()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][abort] reason=cancelled-after-copy');
          return {
            ok: false,
            reason: 'cancelled',
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantDoneSignal: false,
          };
        }

        setCopyHotkeyOncePhase('sending_hotkey', `${sourceText || 'start'}:send-hotkey`);

        const hotkeyFlow = await sendHotkeyAfterCopy({
          copiedText: waitCopyResult.text,
          reason: 'copy-and-hotkey',
          shouldStop,
        });

        if (!hotkeyFlow.ok) {
          const failReason = hotkeyFlow.reason || 'hotkey-failed';
          const errText = hotkeyFlow.detail || failReason;
          const targetLabel = typeof getCopyThenShortcutTargetLabel === 'function'
            ? getCopyThenShortcutTargetLabel()
            : 'Ctrl+Alt+I';
          ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][failed] reason=${failReason} detail=${errText}`);
          setStatus(
            hotkeyFlow.reason === 'clipboard-not-ready'
              ? `复制+快捷键失败：剪贴板未就绪：${errText}`
              : `复制成功，但 ${targetLabel || '目标快捷键'} 执行失败`,
            'error',
          );
          return {
            ok: false,
            reason: failReason,
            detail: errText,
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantDoneSignal: false,
          };
        }

        const targetLabelDone = typeof getCopyThenShortcutTargetLabel === 'function'
          ? getCopyThenShortcutTargetLabel()
          : 'Ctrl+Alt+I';
        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][done] copied=1 hotkey=1 continue=0');
        setStatus(`已复制最后回复，并发送 ${targetLabelDone || '目标快捷键'}`, 'success');

        setCopyHotkeyOncePhase('success', `${sourceText || 'start'}:done`);

        await forceScrollChatToBottomForCopy(`copy-and-hotkey:${sourceText || '-'}`, 'after-hotkey');

        if (btn) {
          setButtonTemporaryOk(btn);
        }

        return {
          ok: true,
          reason: 'ok',
          copied: true,
          hotkeySent: true,
          continueSent: false,
          assistantDoneSignal: false,
          copied_text: String(waitCopyResult.text || ''),
        };
      } catch (error) {
        const errText = formatToolboxError(error);

        console.error('[COPY_HOTKEY_ONCE][ERROR]', {
          source: sourceText,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][failed] source=${sourceText || '-'} error=${errText}`);
        setStatus(`复制+快捷键失败：${errText}`, 'error');

        if (btn) {
          setButtonTemporaryError(btn, '执行失败', 1200);
        }

        return {
          ok: false,
          reason: 'exception',
          detail: errText,
          copied: false,
          hotkeySent: false,
        };
      } finally {
        await forceScrollChatToBottomForCopy(`copy-and-hotkey:${sourceText || '-'}`, 'finally');

        releaseUploadActionLock('copy-hotkey-once');

        if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'finally');
        }

        if (btn) {
          btn.dataset.busy = '0';
        }

        renderUploadButtonsOnly();
      }
    }

    async function copyHotkeyAndContinueOnce(source = 'button', options = {}) {
      const sourceText = String(source || '');
      const flowOptions = options && typeof options === 'object' ? options : {};
      const managedPhase = flowOptions.managedPhase === true;
      const flowRunId = String(flowOptions.runId || '').trim();
      const shouldStop = typeof flowOptions.shouldStop === 'function'
        ? flowOptions.shouldStop
        : () => (managedPhase ? isCopyHotkeyContinueCancelled(flowRunId) : false);
      const isUploadVerifyLoopMode = sourceText.startsWith('upload-verify-loop-');
      const isLegacyLoopMode = sourceText.startsWith('loop-');
      const isLoopMode = isLegacyLoopMode || isUploadVerifyLoopMode;
      const loopCycleIndex = isLoopMode
        ? Number(
          String(
            isUploadVerifyLoopMode
              ? sourceText.match(/upload-verify-loop-(\d+)/)?.[1]
              : sourceText.match(/loop-(\d+)/)?.[1],
          ) || (isUploadVerifyLoopMode
            ? copyHotkeyUploadVerifyLoopCount
            : copyHotkeyContinueLoopCount),
        ) || 0
        : 0;
      const btn = managedPhase || isLoopMode
        ? null
        : (rootElRef ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef) : null);

      const syncLoopPhase = (phase, subtask = '') => {
        if (!isLoopMode) {
          return;
        }
        if (isUploadVerifyLoopMode) {
          setCopyHotkeyUploadVerifyLoopPhase(phase, `${sourceText}:${subtask || phase}`, {
            cycleIndex: loopCycleIndex,
            currentSubtask: subtask || phase,
          });
          return;
        }
        setCopyHotkeyContinueLoopPhase(phase, `${sourceText}:${subtask || phase}`, {
          cycleIndex: loopCycleIndex,
          currentSubtask: subtask || phase,
        });
      };
      const continueLock = claimUploadActionLock('copy-hotkey-continue', {
        forceRelease: isLoopMode,
      });
      if (!continueLock.ok) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][skip] reason=${continueLock.reason} runningMs=${continueLock.runningMs || 0}`,
        );
        return {
          ok: false,
          assistantDoneSignal: false,
          reason: continueLock.reason || 'task-running',
          source: sourceText,
          loopMode: isLoopMode,
          copied: false,
          hotkeySent: false,
          continueSent: false,
          assistantMessageKey: '',
        };
      }
      const loopOnceBtn = isLoopMode && rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      const waitDangerBtn = (!isLoopMode && !managedPhase && btn) ? btn : loopOnceBtn;
      if (waitDangerBtn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(waitDangerBtn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }
      try {
        if (managedPhase && !isLoopMode) {
          setCopyHotkeyContinuePhase('waiting_reply', `${sourceText}:wait-reply`);
        }
        if (isLoopMode) {
          syncLoopPhase('waiting_reply', 'wait-reply');
        }
        if (!isLoopMode && !managedPhase) {
          setStatus('正在等待回答完成，然后复制并发送快捷键', 'running');
        }
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][start] source=${sourceText || '-'}`,
        );

        logCopyHotkeyContinueStep(sourceText, 'wait-reply');

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey: '',
          };
        }

        if (managedPhase && !isLoopMode) {
          setCopyHotkeyContinuePhase('copying', `${sourceText}:copying`);
        }
        if (isLoopMode) {
          syncLoopPhase('copying', 'copying');
        }

        const waitCopyResult = await waitAndCopyLatestAssistant({
          source,
          reason: `copy-hotkey-continue:${sourceText || '-'}`,
          shouldStop,
        });

        if (!waitCopyResult.ok) {
          const reason = waitCopyResult.reason || 'wait-assistant-failed';
          const errText = waitCopyResult.detail || reason;
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][abort] reason=${reason} detail=${errText || '-'}`,
          );
          if (!isLoopMode) {
            const statusMsg = reason === 'empty-assistant-text'
              ? '复制+快捷键+继续失败：最后回复为空'
              : `复制+快捷键+继续失败：${reason}`;
            setStatus(statusMsg, 'warn');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: reason || 'wait-assistant-failed',
            detail: errText,
            source: sourceText,
            loopMode: isLoopMode,
            copied: !!waitCopyResult.copied,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey: '',
          };
        }

        const waitResult = waitCopyResult.waitResult || null;
        const assistantMessageKey = buildAssistantMessageKeyFromRecord(
          waitResult && waitResult.record,
          waitCopyResult.text || (waitResult && waitResult.text),
        ) || getLastAssistantMessageKeySafe();

        const assistantRawText = String(waitCopyResult.text || (waitResult && waitResult.text) || '').trim();

        if (
          flowOptions.disableBatchTextTerminalStop !== true
          && typeof classifyBatchReply === 'function'
        ) {
          const replyClassify = classifyBatchReply(assistantRawText);
          ToolboxShell.appendLog(
            `[BATCH][REPLY_CLASSIFY] shouldStop=${replyClassify.shouldStop ? 1 : 0} `
            + `status=${replyClassify.status} reason=${replyClassify.reason} source=${sourceText || '-'}`,
          );
          if (
            replyClassify.shouldStop
            && replyClassify.status !== 'done'
            && replyClassify.status !== 'empty'
          ) {
            const terminalLine = `[COPY_HOTKEY_CONTINUE][batch-terminal-stop] status=${replyClassify.status} reason=${replyClassify.reason} source=${sourceText || '-'}`;
            safeAppendLog(terminalLine);
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog(terminalLine);
            }
            setStatus(
              replyClassify.status === 'no_more_content'
                ? '检测到无更多内容终态，已停止自动继续'
                : '检测到阻塞终态，已停止自动继续',
              'warn',
            );
            return {
              ok: true,
              assistantDoneSignal: false,
              assistantBatchTerminalStop: true,
              batchReplyClassifyStatus: replyClassify.status,
              batchReplyClassifyReason: replyClassify.reason,
              reason: `batch-reply-${replyClassify.status}`,
              source: sourceText,
              loopMode: isLoopMode,
              copied: !!waitCopyResult.copied,
              hotkeySent: false,
              continueSent: false,
              assistantMessageKey,
            };
          }
        }

        const assistantDoneSignalMatched = checkUploadDoneSignalWithLog(
          assistantRawText,
          'COPY_HOTKEY_CONTINUE',
          'after-wait',
          `source=${sourceText || '-'}`,
          flowOptions,
        );

        if (assistantDoneSignalMatched) {
          const doneSignalLine = `[COPY_HOTKEY_CONTINUE][assistant-done-signal] source=${sourceText || '-'} key=${assistantMessageKey || '-'}`;
          safeAppendLog(doneSignalLine);
          console.warn('[COPY_HOTKEY_CONTINUE][assistant-done-signal]', {
            source: sourceText || '-',
            key: assistantMessageKey || '-',
            preview: formatDoneSignalPreview(assistantRawText),
          });
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(doneSignalLine);
          }

          setStatus('检测到终止信号，任务已完成，不再继续', 'success');

          return {
            ok: true,
            assistantDoneSignal: true,
            reason: 'assistant-done-signal',
            source: sourceText,
            loopMode: isLoopMode,
            copied: !!waitCopyResult.copied,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: !!waitCopyResult.copied,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'copy-last-reply');

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][copied] chars=${waitCopyResult.chars || 0}`,
        );

        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyContinue');
        }

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'send-hotkey');
        if (managedPhase && !isLoopMode) {
          setCopyHotkeyContinuePhase('sending_hotkey', `${sourceText}:send-hotkey`);
        }
        if (isLoopMode) {
          syncLoopPhase('sending_hotkey', 'send-hotkey');
        }

        const hotkeyFlow = await sendHotkeyAfterCopy({
          copiedText: waitCopyResult.text,
          reason: 'copy-hotkey-continue',
          shouldStop,
        });

        if (!hotkeyFlow.ok) {
          const failReason = hotkeyFlow.reason || 'hotkey-failed';
          const errText = hotkeyFlow.detail || failReason;
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] reason=${failReason} detail=${errText}`);
          if (!isLoopMode) {
            const targetLabelContinue = typeof getCopyThenShortcutTargetLabel === 'function'
              ? getCopyThenShortcutTargetLabel()
              : 'Ctrl+Alt+I';
            setStatus(
              hotkeyFlow.reason === 'clipboard-not-ready'
                ? `复制+快捷键+继续失败：剪贴板未就绪：${errText}`
                : `复制成功，但 ${targetLabelContinue || '目标快捷键'} 执行失败`,
              'error',
            );
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: failReason,
            detail: errText,
            clipboardReadyReason: failReason,
            continueReason: '',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        await sleep(300);

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: true,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'send-continue');
        if (managedPhase && !isLoopMode) {
          setCopyHotkeyContinuePhase('sending_continue', `${sourceText}:send-continue`);
        }
        if (isLoopMode) {
          syncLoopPhase('sending_continue', 'send-continue');
        }
        const continueSource = sourceText || 'copy-hotkey-continue-once';
        const loopContinuePromptTxt = getCopyHotkeyContinuePromptText(flowOptions);
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][continue-prompt] index=${copyHotkeyContinueLoopCount + 1} length=${loopContinuePromptTxt.length}`);
        const continueResult = await sendContinuePromptFromUnifiedPipeline(continueSource, flowOptions);
        if (!continueResult || !continueResult.ok) {
          const detail = continueResult && continueResult.reason ? continueResult.reason : '';
          if (
            detail === 'assistant-done-signal-before-send'
            || (continueResult && continueResult.assistantDoneSignal === true)
          ) {
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE][assistant-done-signal] source=${sourceText || '-'} reason=${detail || 'assistant-done-signal-before-send'}`,
            );
            setStatus('检测到终止信号，任务已完成，不再继续', 'success');
            return {
              ok: true,
              assistantDoneSignal: true,
              reason: detail || 'assistant-done-signal-before-send',
              source: sourceText,
              loopMode: isLoopMode,
              copied: true,
              hotkeySent: true,
              continueSent: false,
              assistantMessageKey,
            };
          }
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][failed] reason=continue-send-failed detail=${detail || '-'}`,
          );
          if (!isLoopMode) {
            setStatus('复制和快捷键已完成，但发送继续指令失败', 'error');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'continue-send-failed',
            detail,
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: true,
            continueSent: false,
            assistantMessageKey,
          };
        }
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][done] copied=1 hotkey=1 continue=1');
        if (!isLoopMode) {
          const targetLabelSuccess = typeof getCopyThenShortcutTargetLabel === 'function'
            ? getCopyThenShortcutTargetLabel()
            : 'Ctrl+Alt+I';
          setStatus(
            `已复制最后回复，已发送 ${targetLabelSuccess || '目标快捷键'}，并发送继续指令`,
            'success',
          );
        }
        return {
          ok: true,
          assistantDoneSignal: false,
          reason: 'ok',
          source: sourceText,
          loopMode: isLoopMode,
          copied_text: String(waitCopyResult.text || ''),
          assistantMessageKey,
          continueSent: true,
          continueReason: continueResult && continueResult.reason ? continueResult.reason : 'ok',
          clipboardReadyReason: hotkeyFlow && hotkeyFlow.reason ? hotkeyFlow.reason : 'ok',
          hotkeySent: true,
          copied: true,
        };
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[COPY_HOTKEY_CONTINUE][ERROR]', {
          source: sourceText,
          loopMode: isLoopMode,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] source=${sourceText} error=${errText}`);
        if (!isLoopMode) {
          setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
        }
        return {
          ok: false,
          assistantDoneSignal: false,
          reason: 'exception',
          detail: errText,
          source: sourceText,
          loopMode: isLoopMode,
          copied: false,
          hotkeySent: false,
          continueSent: false,
          assistantMessageKey: '',
        };
      } finally {
        if (!managedPhase) {
          releaseUploadActionLock('copy-hotkey-continue');
        }

        if (waitDangerBtn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(
            waitDangerBtn,
            isLoopMode ? 'loop-cycle-finally' : 'finally',
          );
        }

        if (!isLoopMode && !managedPhase) {
          renderUploadButtonsOnly();
        } else if (isLoopMode) {
          safeAppendLog(`[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE] source=${sourceText}`);
          console.warn('[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE]', {
            source: sourceText,
            running: copyHotkeyContinueLoopRunning,
          });
        }
      }
    }

    async function runCopyHotkeyContinueOnceForTaskQueue(options = {}) {
      const flowOptions = options && typeof options === 'object' ? options : {};
      const source = String(flowOptions.source || 'task-queue').trim() || 'task-queue';
      const result = await copyHotkeyAndContinueOnce(source, flowOptions);
      const clipboardReadyReason = result && result.clipboardReadyReason
        ? String(result.clipboardReadyReason)
        : (result && result.hotkeySent ? 'ok' : '');
      const continueReason = result && result.continueReason
        ? String(result.continueReason)
        : (result && result.continueSent ? 'ok' : '');
      return {
        ok: !!(result && result.ok),
        assistantDoneSignal: !!(result && result.assistantDoneSignal),
        reason: result && result.reason ? String(result.reason) : (result && result.ok ? 'ok' : 'unknown'),
        detail: result && result.detail ? String(result.detail) : '',
        clipboardReadyReason,
        continueReason,
        copied: !!(result && result.copied),
        hotkeySent: !!(result && result.hotkeySent),
        continueSent: !!(result && result.continueSent),
        copied_text: result && result.copied_text ? String(result.copied_text) : '',
        assistantMessageKey: result && result.assistantMessageKey ? String(result.assistantMessageKey) : '',
      };
    }

    async function waitAssistantCycleAfterContinue(source, previousKey) {
      const sourceText = String(source || '');
      const prevKey = String(previousKey || '');
      const startedAt = Date.now();
      const maxWaitMs = 180000;
      let sawBusy = false;

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-start] source=${sourceText} previousKey=${prevKey || '-'}`,
      );

      while (Date.now() - startedAt < maxWaitMs) {
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          safeAppendLog('[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-page-navigating]');
          return false;
        }

        if (copyHotkeyContinueLoopStopRequested) {
          safeAppendLog('[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-stop-requested]');
          return false;
        }

        let busy = false;

        try {
          busy = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][busy-check-failed]', {
            source: sourceText,
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          busy = false;
        }

        if (busy) {
          sawBusy = true;
        }

        const nextKey = getLastAssistantMessageKeySafe();

        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-poll] previousKey=${prevKey || '-'} nextKey=${nextKey || '-'} same=${nextKey && nextKey === prevKey ? '1' : '0'} busy=${busy ? '1' : '0'} sawBusy=${sawBusy ? '1' : '0'}`,
        );

        if (nextKey && prevKey && nextKey !== prevKey && !busy) {
          await sleep(600);
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done-by-poll] previousKey=${prevKey} nextKey=${nextKey}`,
          );
          return true;
        }

        if (sawBusy && !busy) {
          await sleep(800);
          const keyAfterIdle = getLastAssistantMessageKeySafe();
          if (!prevKey || keyAfterIdle !== prevKey) {
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done] previousKey=${prevKey || '-'} nextKey=${keyAfterIdle || '-'}`,
            );
            return true;
          }
        }

        await sleep(1500);
      }

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-timeout] source=${sourceText} previousKey=${prevKey || '-'} maxWaitMs=${maxWaitMs}`,
      );
      setStatus('连续复制+快捷键+继续：等待下一轮回复超时', 'warn');
      return false;
    }

    
    function getCopyHotkeyLoopAutomationConfig() {
      const cfg = getCompactUiConfig();

      const autoUploadInterval = Number(cfg.copyHotkeyLoopAutoUploadInterval || 5);
      const homeNavInterval = Number(cfg.copyHotkeyLoopHomeNavInterval || 20);

      return {
        autoUploadEnabled: cfg.copyHotkeyLoopAutoUploadEnabled !== false,
        autoUploadInterval: Number.isFinite(autoUploadInterval) && autoUploadInterval > 0
          ? Math.floor(autoUploadInterval)
          : 5,
        homeNavEnabled: cfg.copyHotkeyLoopHomeNavEnabled !== false,
        homeNavInterval: Number.isFinite(homeNavInterval) && homeNavInterval > 0
          ? Math.floor(homeNavInterval)
          : 20,
        homeNavUrl: String(cfg.copyHotkeyLoopHomeNavUrl || 'https://chatgpt.com/').trim() || 'https://chatgpt.com/',
      };
    }

    function isCopyHotkeyLoopIntervalHit(cycleIndex, enabled, interval) {
      const index = Number(cycleIndex) || 0;
      const step = Number(interval) || 0;

      return enabled === true && index > 0 && step > 0 && index % step === 0;
    }

    function requestCopyHotkeyLoopHomeNavigation(cycleIndex, cfg) {
      const targetUrl = String(
        cfg && cfg.homeNavUrl ? cfg.homeNavUrl : 'https://chatgpt.com/'
      ).trim() || 'https://chatgpt.com/';

      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][home-nav-request] index=${cycleIndex} url=${targetUrl}`
      );

      setStatus(
        `第 ${cycleIndex} 轮：正在返回 ChatGPT 首页...`,
        'running'
      );

      window.setTimeout(() => {
        try {
          window.location.assign(targetUrl);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][home-nav-failed]', {
            cycleIndex,
            targetUrl,
            error_type: error && error.name,
            error: errText,
            stack: error && error.stack,
          });
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][home-nav-failed] index=${cycleIndex} error=${errText}`
          );
          setStatus(`返回首页失败：${errText}`, 'error');
        }
      }, 600);
    }

    async function runCopyHotkeyLoopPostCycleActions(cycleIndex) {
      const cfg = getCopyHotkeyLoopAutomationConfig();

      const shouldHomeNav = isCopyHotkeyLoopIntervalHit(
        cycleIndex,
        cfg.homeNavEnabled,
        cfg.homeNavInterval,
      );

      if (shouldHomeNav) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][post-cycle] action=home-nav index=${cycleIndex} uploadSkipped=1`
        );

        setCopyHotkeyContinueLoopPhase('home_navigation', `cycle-${cycleIndex}-home-nav`, {
          cycleIndex,
          currentSubtask: 'home_navigation',
        });

        requestCopyHotkeyLoopHomeNavigation(cycleIndex, cfg);

        return {
          stop: true,
          reason: 'home-nav',
        };
      }

      const shouldAutoUpload = isCopyHotkeyLoopIntervalHit(
        cycleIndex,
        cfg.autoUploadEnabled,
        cfg.autoUploadInterval,
      );

      if (!shouldAutoUpload) {
        return {
          stop: false,
          reason: 'no-action',
        };
      }

      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][post-cycle] action=auto-upload index=${cycleIndex} interval=${cfg.autoUploadInterval}`
      );

      setStatus(
        `第 ${cycleIndex} 轮：正在自动上传...`,
        'running'
      );

      const loopTask = ensureCopyHotkeyContinueLoopTask();
      setCopyHotkeyContinueLoopPhase('auto_uploading', `cycle-${cycleIndex}-auto-upload`, {
        cycleIndex,
        currentSubtask: 'auto_upload',
      });

      try {
        const uploadResult = await startUploadFromCurrentQueue({
          source: `copy-hotkey-loop-auto-upload-${cycleIndex}`,
          parentTask: 'copyHotkeyContinueLoop',
          cycleIndex,
          shouldStop: () => !!(
            copyHotkeyContinueLoopStopRequested
            || loopTask.stopRequested
          ),
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-done] index=${cycleIndex} ok=${uploadResult && uploadResult.ok ? '1' : '0'} uploaded=${uploadResult && uploadResult.uploadedCount != null ? uploadResult.uploadedCount : '-'} failed=${uploadResult && uploadResult.failedCount != null ? uploadResult.failedCount : '-'} skipped=${uploadResult && uploadResult.skippedCount != null ? uploadResult.skippedCount : '-'} reason=${uploadResult && uploadResult.reason ? uploadResult.reason : '-'}`
        );

        return {
          stop: false,
          reason: 'auto-upload-done',
          uploadResult,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);

        console.error('[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-failed]', {
          cycleIndex,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-failed] index=${cycleIndex} error=${errText}`
        );

        setStatus(`第 ${cycleIndex} 轮自动上传失败：${errText}`, 'error');

        return {
          stop: false,
          reason: 'auto-upload-failed',
          error: errText,
        };
      } finally {
        if (
          copyHotkeyContinueLoopRunning
          && !copyHotkeyContinueLoopStopRequested
          && loopTask.phase === 'auto_uploading'
        ) {
          setCopyHotkeyContinueLoopPhase('running', `cycle-${cycleIndex}-auto-upload-done`, {
            cycleIndex,
          });
        }
      }
    }

    async function toggleCopyHotkeyContinueLoop(source = 'button') {
      const src = String(source || 'button').trim() || 'button';
      const loopTask = ensureCopyHotkeyContinueLoopTask();

      if (COPY_HOTKEY_LOOP_STOP_PHASES.has(loopTask.phase) || copyHotkeyContinueLoopRunning) {
        return requestCopyHotkeyContinueLoopStop(src);
      }

      const loopLock = claimUploadActionLock('copy-hotkey-loop', { timeoutMs: 600000 });
      if (!loopLock.ok) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][skip] source=${src} reason=${loopLock.reason} runningMs=${loopLock.runningMs || 0}`,
        );
        return false;
      }

      const runId = createUploadTaskRunId('copy_hotkey_loop');
      loopTask.runId = runId;
      loopTask.stopRequested = false;
      loopTask.lastError = null;
      loopTask.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      copyHotkeyContinueLoopStopRequested = false;
      copyHotkeyContinueLoopCount = 0;
      copyHotkeyContinueLoopStartedAt = Date.now();
      loopTask.startedAt = copyHotkeyContinueLoopStartedAt;

      setCopyHotkeyContinueLoopPhase('running', src, { cycleIndex: 0 });
      setStatus('连续复制+快捷键+继续已启动', 'running');
      safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][start] source=${src} runId=${runId}`);
      let loopStopReason = 'natural-end';
      try {
        while (!copyHotkeyContinueLoopStopRequested && loopTask.runId === runId) {
          copyHotkeyContinueLoopCount += 1;
          loopTask.cycleIndex = copyHotkeyContinueLoopCount;
          setCopyHotkeyContinueLoopPhase('waiting_reply', `cycle-${copyHotkeyContinueLoopCount}`, {
            cycleIndex: copyHotkeyContinueLoopCount,
            currentSubtask: 'cycle',
          });
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][cycle-start] index=${copyHotkeyContinueLoopCount}`,
          );

          const shouldStop = () => !!(
            copyHotkeyContinueLoopStopRequested
            || loopTask.stopRequested
            || loopTask.runId !== runId
          );

          setCopyHotkeyContinueLoopPhase('copying', `cycle-${copyHotkeyContinueLoopCount}`, {
            cycleIndex: copyHotkeyContinueLoopCount,
          });

          const result = await copyHotkeyAndContinueOnce(`loop-${copyHotkeyContinueLoopCount}`, {
            shouldStop,
          });

          if (
            result
            && (
              result.assistantDoneSignal === true
              || result.reason === 'assistant-done-signal'
              || result.reason === 'assistant-done-signal-before-send'
            )
          ) {
            loopStopReason = 'assistant-done-signal';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=assistant-done-signal index=${copyHotkeyContinueLoopCount}`,
            );
            console.warn('[COPY_HOTKEY_CONTINUE_LOOP][stop]', {
              reason: 'assistant-done-signal',
              index: copyHotkeyContinueLoopCount,
            });
            break;
          }

          if (!result || result.ok === false) {
            const reason = result && result.reason ? result.reason : 'once-failed';
            const detail = result && result.detail ? result.detail : '';

            loopStopReason = `cycle-stop:${reason}`;

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=${reason} detail=${detail || '-'} index=${copyHotkeyContinueLoopCount}`,
            );

            console.warn('[COPY_HOTKEY_CONTINUE_LOOP][CYCLE_STOP]', {
              reason,
              detail,
              index: copyHotkeyContinueLoopCount,
              result,
            });

            break;
          }

          if (copyHotkeyContinueLoopStopRequested) {
            loopStopReason = 'user-stop';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=user-stop index=${copyHotkeyContinueLoopCount}`,
            );
            break;
          }

          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][before-wait-next] index=${copyHotkeyContinueLoopCount} key=${result.assistantMessageKey || '-'} reason=${result.continueReason || '-'}`,
          );

          setCopyHotkeyContinueLoopPhase('waiting_next_reply', `cycle-${copyHotkeyContinueLoopCount}`, {
            cycleIndex: copyHotkeyContinueLoopCount,
            currentSubtask: 'wait-next-reply',
          });

          const waited = await waitAssistantCycleAfterContinue(
            `loop-${copyHotkeyContinueLoopCount}`,
            result.assistantMessageKey || '',
          );
          if (!waited) {
            loopStopReason = copyHotkeyContinueLoopStopRequested
              ? 'user-stop'
              : 'wait-next-reply-failed';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`,
            );
            if (loopStopReason === 'wait-next-reply-failed') {
              console.warn('[COPY_HOTKEY_CONTINUE_LOOP][WAIT_NEXT_FAILED]', {
                index: copyHotkeyContinueLoopCount,
                previousKey: result.assistantMessageKey || '',
              });
            }
            break;
          }

          const stopSignalResult = detectCopyHotkeyLoopStopSignal(copyHotkeyContinueLoopCount);

          if (stopSignalResult && stopSignalResult.matched) {
            loopStopReason = stopSignalResult.reason || 'assistant-done-signal';

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`,
            );

            break;
          }

          const postCycleAction = await runCopyHotkeyLoopPostCycleActions(copyHotkeyContinueLoopCount);

          if (postCycleAction && postCycleAction.stop) {
            loopStopReason = postCycleAction.reason || 'post-cycle-stop';

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`
            );

            break;
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        loopStopReason = `exception:${errText}`;
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][FAILED]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][failed] error=${errText}`);
        setStatus(`连续复制+快捷键+继续失败：${errText}`, 'error');
      } finally {
        const stoppedByUser = copyHotkeyContinueLoopStopRequested || loopTask.stopRequested;
        loopTask.stopRequested = false;
        loopTask.abortController = null;
        copyHotkeyContinueLoopStopRequested = false;

        if (loopTask.runId === runId) {
          if (stoppedByUser) {
            setCopyHotkeyContinueLoopPhase('stopped', 'finally', { cycleIndex: copyHotkeyContinueLoopCount });
          } else if (
            loopStopReason.startsWith('cycle-stop:')
            || loopStopReason.startsWith('exception:')
            || loopStopReason === 'wait-next-reply-failed'
          ) {
            setCopyHotkeyContinueLoopPhase('failed', loopStopReason, {
              cycleIndex: copyHotkeyContinueLoopCount,
            });
          } else {
            setCopyHotkeyContinueLoopPhase('success', 'finally', {
              cycleIndex: copyHotkeyContinueLoopCount,
            });
          }

          window.setTimeout(() => {
            if (state.copyHotkeyContinueLoopTask && state.copyHotkeyContinueLoopTask.runId === runId) {
              state.copyHotkeyContinueLoopTask.runId = '';
              setCopyHotkeyContinueLoopPhase('idle', 'auto-reset');
            }
          }, 1500);
        }

        if (stoppedByUser && loopStopReason === 'natural-end') {
          loopStopReason = 'user-stop';
        }
        if (loopStopReason === 'assistant-done-signal') {
          setStatus(
            `检测到终止信号，连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'success',
          );
        } else if (stoppedByUser || loopStopReason === 'user-stop') {
          setStatus(
            `连续复制+快捷键+继续已停止，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'warn',
          );
        } else if (
          loopStopReason.startsWith('cycle-stop:')
          || loopStopReason.startsWith('exception:')
          || loopStopReason === 'wait-next-reply-failed'
        ) {
          setStatus(
            `连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮（${loopStopReason}）`,
            'warn',
          );
        } else {
          setStatus(
            `连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'success',
          );
        }
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][finally] reason=${loopStopReason}`);
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][done] cycles=${copyHotkeyContinueLoopCount} stoppedByUser=${stoppedByUser ? '1' : '0'} reason=${loopStopReason}`,
        );
        const loopOnceBtn = rootElRef
          ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
          : null;
        if (loopOnceBtn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(loopOnceBtn, 'loop-finally');
        }
        renderUploadButtonsOnly();
        releaseUploadActionLock('copy-hotkey-loop');
      }
      return true;
    }

    async function toggleCopyHotkeyUploadVerifyLoop(source = 'button') {
      const src = String(source || 'button').trim() || 'button';
      const loopTask = ensureCopyHotkeyUploadVerifyLoopTask();

      if (
        COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES.has(loopTask.phase)
        || copyHotkeyUploadVerifyLoopRunning
      ) {
        return requestCopyHotkeyUploadVerifyLoopStop(src);
      }

      const loopLock = claimUploadActionLock('copy-hotkey-upload-verify-loop', {
        timeoutMs: 600000,
      });

      if (!loopLock.ok) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][skip] source=${src} reason=${loopLock.reason} runningMs=${loopLock.runningMs || 0}`,
        );
        return false;
      }

      const runId = createUploadTaskRunId('copy_hotkey_upload_verify_loop');

      loopTask.runId = runId;
      loopTask.stopRequested = false;
      loopTask.lastError = null;
      loopTask.abortController = typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;

      copyHotkeyUploadVerifyLoopStopRequested = false;
      copyHotkeyUploadVerifyLoopCount = 0;
      copyHotkeyUploadVerifyLoopStartedAt = Date.now();
      loopTask.startedAt = copyHotkeyUploadVerifyLoopStartedAt;

      setCopyHotkeyUploadVerifyLoopPhase('running', src, { cycleIndex: 0 });
      setStatus('闭环继续已启动：每 5 轮自动上传一次代码', 'running');
      safeAppendLog(`[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][start] source=${src} runId=${runId}`);

      let loopStopReason = 'natural-end';

      try {
        while (!copyHotkeyUploadVerifyLoopStopRequested && loopTask.runId === runId) {
          copyHotkeyUploadVerifyLoopCount += 1;
          loopTask.cycleIndex = copyHotkeyUploadVerifyLoopCount;

          setCopyHotkeyUploadVerifyLoopPhase('waiting_reply', `cycle-${copyHotkeyUploadVerifyLoopCount}`, {
            cycleIndex: copyHotkeyUploadVerifyLoopCount,
            currentSubtask: 'cycle',
          });

          safeAppendLog(
            `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][cycle-start] index=${copyHotkeyUploadVerifyLoopCount}`,
          );

          const shouldStop = () => !!(
            copyHotkeyUploadVerifyLoopStopRequested
            || loopTask.stopRequested
            || loopTask.runId !== runId
          );

          setCopyHotkeyUploadVerifyLoopPhase('copying', `cycle-${copyHotkeyUploadVerifyLoopCount}`, {
            cycleIndex: copyHotkeyUploadVerifyLoopCount,
          });

          const result = await copyHotkeyAndContinueOnce(
            `upload-verify-loop-${copyHotkeyUploadVerifyLoopCount}`,
            {
              shouldStop,
              doneSignal: DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
              strictDoneSignal: true,
              disableBatchTextTerminalStop: true,
            },
          );

          if (
            result
            && (
              result.assistantDoneSignal === true
              || result.reason === 'assistant-done-signal'
              || result.reason === 'assistant-done-signal-before-send'
            )
          ) {
            loopStopReason = 'assistant-done-signal';
            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][stop] reason=assistant-done-signal index=${copyHotkeyUploadVerifyLoopCount}`,
            );
            break;
          }

          if (!result || result.ok === false) {
            const reason = result && result.reason ? result.reason : 'once-failed';
            const detail = result && result.detail ? result.detail : '';

            loopStopReason = `cycle-stop:${reason}`;

            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][cycle-stop] reason=${reason} detail=${detail || '-'} index=${copyHotkeyUploadVerifyLoopCount}`,
            );

            console.warn('[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][CYCLE_STOP]', {
              reason,
              detail,
              index: copyHotkeyUploadVerifyLoopCount,
              result,
            });

            break;
          }

          if (copyHotkeyUploadVerifyLoopStopRequested) {
            loopStopReason = 'user-stop';
            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][cycle-stop] reason=user-stop index=${copyHotkeyUploadVerifyLoopCount}`,
            );
            break;
          }

          setCopyHotkeyUploadVerifyLoopPhase('waiting_next_reply', `cycle-${copyHotkeyUploadVerifyLoopCount}`, {
            cycleIndex: copyHotkeyUploadVerifyLoopCount,
            currentSubtask: 'wait-next-reply',
          });

          const waited = await waitAssistantCycleAfterContinue(
            `upload-verify-loop-${copyHotkeyUploadVerifyLoopCount}`,
            result.assistantMessageKey || '',
          );

          if (!waited) {
            loopStopReason = copyHotkeyUploadVerifyLoopStopRequested
              ? 'user-stop'
              : 'wait-next-reply-failed';

            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyUploadVerifyLoopCount}`,
            );

            break;
          }

          const stopSignalResult = detectCopyHotkeyLoopStopSignal(copyHotkeyUploadVerifyLoopCount);

          if (stopSignalResult && stopSignalResult.matched) {
            loopStopReason = stopSignalResult.reason || 'assistant-done-signal';

            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyUploadVerifyLoopCount}`,
            );

            break;
          }

          const postCycleAction = await runCopyHotkeyUploadVerifyPostCycleActions(
            copyHotkeyUploadVerifyLoopCount,
          );

          if (postCycleAction && postCycleAction.stop) {
            loopStopReason = postCycleAction.reason || 'post-cycle-stop';

            safeAppendLog(
              `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyUploadVerifyLoopCount}`,
            );

            break;
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        loopStopReason = `exception:${errText}`;

        console.error('[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][FAILED]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        safeAppendLog(`[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][failed] error=${errText}`);
        setStatus(`闭环继续失败：${errText}`, 'error');
      } finally {
        const stoppedByUser = copyHotkeyUploadVerifyLoopStopRequested || loopTask.stopRequested;

        loopTask.stopRequested = false;
        loopTask.abortController = null;
        copyHotkeyUploadVerifyLoopStopRequested = false;

        if (loopTask.runId === runId) {
          if (stoppedByUser) {
            setCopyHotkeyUploadVerifyLoopPhase('stopped', 'finally', {
              cycleIndex: copyHotkeyUploadVerifyLoopCount,
            });
          } else if (
            loopStopReason.startsWith('cycle-stop:')
            || loopStopReason.startsWith('exception:')
            || loopStopReason === 'wait-next-reply-failed'
          ) {
            setCopyHotkeyUploadVerifyLoopPhase('failed', loopStopReason, {
              cycleIndex: copyHotkeyUploadVerifyLoopCount,
            });
          } else {
            setCopyHotkeyUploadVerifyLoopPhase('success', 'finally', {
              cycleIndex: copyHotkeyUploadVerifyLoopCount,
            });
          }

          window.setTimeout(() => {
            if (
              state.copyHotkeyUploadVerifyLoopTask
              && state.copyHotkeyUploadVerifyLoopTask.runId === runId
            ) {
              state.copyHotkeyUploadVerifyLoopTask.runId = '';
              setCopyHotkeyUploadVerifyLoopPhase('idle', 'auto-reset');
            }
          }, 1500);
        }

        if (stoppedByUser && loopStopReason === 'natural-end') {
          loopStopReason = 'user-stop';
        }

        if (loopStopReason === 'assistant-done-signal') {
          setStatus(
            `检测到终止信号，闭环继续已结束，共执行 ${copyHotkeyUploadVerifyLoopCount} 轮`,
            'success',
          );
        } else if (stoppedByUser || loopStopReason === 'user-stop') {
          setStatus(
            `闭环继续已停止，共执行 ${copyHotkeyUploadVerifyLoopCount} 轮`,
            'warn',
          );
        } else {
          setStatus(
            `闭环继续已结束，共执行 ${copyHotkeyUploadVerifyLoopCount} 轮（${loopStopReason}）`,
            loopStopReason.startsWith('cycle-stop:')
              || loopStopReason.startsWith('exception:')
              || loopStopReason === 'wait-next-reply-failed'
              ? 'warn'
              : 'success',
          );
        }

        safeAppendLog(`[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][finally] reason=${loopStopReason}`);
        safeAppendLog(
          `[COPY_HOTKEY_UPLOAD_VERIFY_LOOP][done] cycles=${copyHotkeyUploadVerifyLoopCount} stoppedByUser=${stoppedByUser ? '1' : '0'} reason=${loopStopReason}`,
        );

        renderUploadButtonsOnly();
        releaseUploadActionLock('copy-hotkey-upload-verify-loop');
      }

      return true;
    }

    function buildFlaskUploadListHtml() {
      const flaskRows = (state.flaskFiles || []).filter(
        (row) => row && row.status !== 'uploaded',
      );

      return flaskRows.map((row) => {
        const itemTitle = escapeHtml([
          `文件名：${row.name || '-'}`,
          `大小：${formatBytes(row.size)}`,
          '来源：本地直读',
          row.download_url ? `下载：${row.download_url}` : '',
        ].filter(Boolean).join('\n'));

        return `
            <div class="cgpt-upload-item flask-local-direct" data-flask-file-id="${escapeHtml(row.file_id || '')}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(row.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(row.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label">本地直读</span>
                </div>
              </div>
            </div>
          `;
      }).join('');
    }

    function buildDropSignature(dataTransfer) {
      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);

      return files
        .map((file) => [
          String(file.name || '').trim().toLowerCase(),
          Number(file.size) || 0,
          Number(file.lastModified) || 0,
          String(file.type || '').trim().toLowerCase(),
        ].join('::'))
        .sort()
        .join('||');
    }

    function shouldSkipRecentDuplicateDrop(dataTransfer) {
      const signature = buildDropSignature(dataTransfer);

      if (!signature) return false;

      const now = Date.now();

      if (signature === lastDropSignature && now - lastDropSignatureAt < 1200) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-recent-duplicate] signature=${signature}`
        );
        return true;
      }

      lastDropSignature = signature;
      lastDropSignatureAt = now;
      return false;
    }

    const UPLOAD_DRAG_DEPTH_PROP = '__cgptUploadDragDepthV1';
    const UPLOAD_DRAG_BIND_CLEANUP_PROP = '__cgptUploadDragBindCleanupV1';
    const MULTI_UPLOAD_DRAG_OVER_LOG_INTERVAL_MS = 800;
    let lastMultiUploadDragOverLogAt = 0;

    function getDragEventTargetTag(e) {
      const target = e && e.target instanceof Element ? e.target : null;
      if (!target) return '-';
      const id = target.id ? `#${target.id}` : '';
      const cls = target.classList && target.classList.length
        ? `.${Array.from(target.classList).slice(0, 2).join('.')}`
        : '';
      return `${target.tagName.toLowerCase()}${id}${cls}`;
    }

    function getDragTransferMeta(e) {
      const transfer = e && e.dataTransfer ? e.dataTransfer : null;
      const items = transfer && transfer.items ? Array.from(transfer.items) : [];
      const files = transfer && transfer.files ? Array.from(transfer.files) : [];
      const hasFiles = hasDraggedFiles(e);
      return {
        has_files: hasFiles,
        items_len: items.length,
        files_len: files.length,
      };
    }

    function hasDraggedFiles(e) {
      const transfer = e && e.dataTransfer ? e.dataTransfer : null;
      if (!transfer) return false;

      if (transfer.files && transfer.files.length > 0) {
        return true;
      }

      const types = transfer.types ? Array.from(transfer.types) : [];
      if (types.includes('Files')) {
        return true;
      }

      const items = transfer.items ? Array.from(transfer.items) : [];
      return items.some((item) => item && item.kind === 'file');
    }

    function isEventInToolbox(e) {
      const target = e && e.target instanceof Element ? e.target : null;
      if (!target || typeof target.closest !== 'function') {
        return false;
      }

      if (typeof isInToolbox === 'function' && isInToolbox(target)) {
        return true;
      }

      return !!target.closest(`#${APP.rootId}, #${APP.panelId}`);
    }

    function shouldLetNativeChatGptHandleUploadDrop(e) {
      if (typeof shouldLetNativeChatGptHandleDrop !== 'function') {
        console.error('[MULTI_UPLOAD][DROP_ERROR] shouldLetNativeChatGptHandleDrop missing');
        return false;
      }

      try {
        return shouldLetNativeChatGptHandleDrop(e, {
          includeFileInput: true,
          includeForm: true,
          isInToolbox: isEventInToolbox,
        });
      } catch (error) {
        console.error('[MULTI_UPLOAD][DROP_ERROR]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return false;
      }
    }

    function claimUploadDropEvent(e, source) {
      if (!e) return false;

      if (e[UPLOAD_DROP_HANDLED_PROP]) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-already-handled] source=${source || '-'}`
        );
        return false;
      }

      e[UPLOAD_DROP_HANDLED_PROP] = {
        source: source || '',
        at: Date.now(),
      };

      return true;
    }

    function prepareUploadDragEvent(e, options = {}) {
      if (!hasDraggedFiles(e)) {
        return false;
      }

      if (shouldLetNativeChatGptHandleUploadDrop(e)) {
        return false;
      }

      e.preventDefault();
      e.stopPropagation();

      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = options.dropEffect || 'copy';
      }

      return true;
    }

    function setMultiUploadDragOverVisual(on) {
      const targets = [];

      if (rootElRef) {
        targets.push(rootElRef);
      }

      if (listEl) {
        targets.push(listEl);
      }

      if (rootElRef && typeof rootElRef.querySelectorAll === 'function') {
        rootElRef.querySelectorAll(
          '.toolbox-upload-drop-zone, .toolbox-upload-file-list, .toolbox-upload-empty-state',
        ).forEach((el) => {
          targets.push(el);
        });
      }

      if (panelDropEl) {
        targets.push(panelDropEl);
      }

      const seen = new Set();
      targets.forEach((el) => {
        if (!el || seen.has(el)) return;
        seen.add(el);
        el.classList.toggle('is-drag-over', on);
        el.classList.toggle('cgpt-upload-dragging', on);
      });

      if (panelDropEl) {
        panelDropEl.classList.toggle('cgpt-toolbox-file-dragover', on);
      }
    }

    function adjustMultiUploadDragDepth(hostEl, delta) {
      if (!hostEl) return 0;

      const next = Math.max(0, Number(hostEl[UPLOAD_DRAG_DEPTH_PROP] || 0) + delta);
      hostEl[UPLOAD_DRAG_DEPTH_PROP] = next;
      return next;
    }

    async function collectDroppedFilesWithHandles(transfer) {
      const result = [];
      const seen = new Set();

      function pushEntry(file, handle) {
        if (!file) return;

        const key = buildQueueFileKey(file) || buildQueueLooseFileKey(file);
        if (key && seen.has(key)) {
          return;
        }

        if (key) {
          seen.add(key);
        }

        result.push({
          file,
          handle: isFileHandleLike(handle) ? handle : null,
        });
      }

      const directFiles = Array.from(transfer && transfer.files ? transfer.files : []).filter(Boolean);
      directFiles.forEach((file) => {
        pushEntry(file, null);
      });

      if (result.length) {
        return result;
      }

      const items = Array.from(transfer && transfer.items ? transfer.items : []);
      for (const item of items) {
        if (!item || item.kind !== 'file') {
          continue;
        }

        let handle = null;
        if (typeof item.getAsFileSystemHandle === 'function') {
          try {
            handle = await item.getAsFileSystemHandle();
          } catch (handleError) {
            console.error('[MULTI_UPLOAD][DROP_ERROR]', {
              error_type: handleError && handleError.name,
              error: handleError && handleError.message,
              stack: handleError && handleError.stack,
            });
          }
        }

        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        pushEntry(file, handle);
      }

      return result;
    }

    async function ensureUploadProjectForDrop(source) {
      if (state.activeGroupId && state.groups.some((g) => g && g.id === state.activeGroupId)) {
        return state.activeGroupId;
      }

      if (state.groups.length) {
        ensureActiveUploadGroupIdValid(`drop-${source || 'drag'}`);
        if (state.activeGroupId) {
          return state.activeGroupId;
        }
      }

      await ensureDefaultGroupReady();

      if (state.activeGroupId) {
        return state.activeGroupId;
      }

      const dragGroup = {
        id: createId('upload_group'),
        name: '当前拖拽项目',
        key: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      dragGroup.key = deriveUploadGroupStableKey(dragGroup);

      state.groups.push(dragGroup);
      state.activeGroupId = dragGroup.id;
      state.selectedFileIdByGroup[dragGroup.id] = '';

      await persistGroups();
      await schedulePersistQueue();
      saveCurrentToolboxBaseState(`drop-${source || 'drag'}`);
      syncUploadGroupAppState();
      render();

      ToolboxShell.appendLog(
        `[MULTI_UPLOAD][DROP][CREATE_PROJECT] project_id=${dragGroup.id} name=${dragGroup.name}`,
      );

      return dragGroup.id;
    }

    async function addDroppedFiles(dropped) {
      const entries = Array.isArray(dropped) ? dropped : [];
      const files = entries.map((entry) => entry && entry.file).filter(Boolean);
      const handles = entries.map((entry) => (entry && entry.handle) || null);

      await addFiles(files, {
        handles,
        sourceKind: 'drop',
      });
    }

    async function addDroppedFilesToCurrentUploadProject(files, source) {
      const fileList = Array.from(files || []).filter(Boolean);
      const validFiles = [];

      fileList.forEach((file) => {
        if (!file || Number(file.size) <= 0) {
          console.info('[MULTI_UPLOAD][DROP_SKIP_EMPTY_FILE]', {
            name: file && file.name ? file.name : '-',
            size: file && file.size,
          });
          return;
        }

        validFiles.push(file);
      });

      if (!validFiles.length) {
        console.info('[MULTI_UPLOAD][DROP_EMPTY]');
        setStatus('没有检测到可添加的文件');
        return {
          project_id: state.activeGroupId || '',
          added_count: 0,
          total_count: getActiveGroupFiles().length,
        };
      }

      try {
        const projectId = await ensureUploadProjectForDrop(source || 'drag_drop_toolbox');
        const beforeCount = getActiveGroupFiles().length;
        const dropped = await collectDroppedFilesFromFileList(validFiles);

        await addDroppedFiles(dropped);
        dedupeActiveGroupQueue('drop');

        const afterCount = getActiveGroupFiles().length;
        const addedCount = Math.max(0, afterCount - beforeCount);

        setStatus(`已拖入：${validFiles.length} 个文件，新增：${addedCount} 个`);

        const acceptedPayload = {
          project_id: projectId || state.activeGroupId || '',
          added_count: addedCount,
          total_count: afterCount,
        };
        console.info('[MULTI_UPLOAD][DROP_ACCEPTED]', acceptedPayload);
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][DROP_ACCEPTED] project_id=${acceptedPayload.project_id} added_count=${addedCount} total_count=${afterCount}`,
        );

        return acceptedPayload;
      } catch (error) {
        console.error('[MULTI_UPLOAD][DROP_ERROR]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        setStatus(`拖拽添加失败：${error && error.message ? error.message : String(error)}`, 'error');
        throw error;
      }
    }

    function collectDroppedFilesFromFileList(files) {
      return Array.from(files || []).filter(Boolean).map((file) => ({
        file,
        handle: null,
      }));
    }

    async function handleUploadDropEvent(e, source) {
      e.preventDefault();
      e.stopPropagation();

      const transfer = e.dataTransfer;
      const sourceText = String(source || 'drag_drop_toolbox');

      if (!transfer) {
        setStatus('拖拽失败：没有文件数据');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer');
        return;
      }

      const rawFiles = Array.from(transfer.files || []).filter(Boolean);
      console.info('[MULTI_UPLOAD][DROP]', {
        files_len: rawFiles.length,
        names: rawFiles.map((file) => file.name || 'unknown'),
        source: sourceText,
      });

      if (shouldSkipRecentDuplicateDrop(transfer)) {
        setStatus('已忽略重复拖拽事件');
        return;
      }

      if (!rawFiles.length) {
        const dropped = await collectDroppedFilesWithHandles(transfer);
        if (!dropped.length) {
          console.info('[MULTI_UPLOAD][DROP_EMPTY]');
          setStatus('没有检测到可添加的文件');
          ToolboxShell.appendLog('[UPLOAD_DIAG][drop:empty]');
          return;
        }

        await addDroppedFilesToCurrentUploadProject(
          dropped.map((entry) => entry.file).filter(Boolean),
          sourceText,
        );
        return;
      }

      await addDroppedFilesToCurrentUploadProject(rawFiles, sourceText);
    }

    function bindMultiUploadDragDrop(uploadRootEl) {
      if (!(uploadRootEl instanceof HTMLElement)) {
        return;
      }

      if (uploadRootEl.dataset.dragDropBound === '1') {
        return;
      }

      uploadRootEl.dataset.dragDropBound = '1';

      const allowGlobalCapture = uploadRootEl === document;

      function shouldHandleDragEvent(e) {
        if (!hasDraggedFiles(e)) {
          return false;
        }

        if (allowGlobalCapture) {
          return prepareUploadDragEvent(e);
        }

        if (!isEventInToolbox(e)) {
          return false;
        }

      if (shouldLetNativeChatGptHandleUploadDrop(e)) {
        return false;
      }

      e.preventDefault();
        e.stopPropagation();

        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }

        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }

        return true;
      }

      function onDragEnter(e) {
        if (!shouldHandleDragEvent(e)) {
          return;
        }

        const depth = adjustMultiUploadDragDepth(uploadRootEl, 1);
        if (depth === 1) {
          setMultiUploadDragOverVisual(true);
        }

        const meta = getDragTransferMeta(e);
        console.info('[MULTI_UPLOAD][DRAG_ENTER]', {
          target: getDragEventTargetTag(e),
          has_files: meta.has_files,
          items_len: meta.items_len,
        });
      }

      function onDragOver(e) {
        if (!shouldHandleDragEvent(e)) {
          return;
        }

        const now = Date.now();
        if (now - lastMultiUploadDragOverLogAt >= MULTI_UPLOAD_DRAG_OVER_LOG_INTERVAL_MS) {
          lastMultiUploadDragOverLogAt = now;
          const meta = getDragTransferMeta(e);
          console.info('[MULTI_UPLOAD][DRAG_OVER]', {
            target: getDragEventTargetTag(e),
            has_files: meta.has_files,
            items_len: meta.items_len,
          });
        }
      }

      function onDragLeave(e) {
        if (!hasDraggedFiles(e)) {
          return;
        }

        const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
        if (related && uploadRootEl.contains(related)) {
          return;
        }

        const depth = adjustMultiUploadDragDepth(uploadRootEl, -1);
        if (depth <= 0) {
          uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
          setMultiUploadDragOverVisual(false);
        }
      }

      async function onDrop(e) {
        if (!hasDraggedFiles(e)) {
          return;
        }

        if (allowGlobalCapture) {
          if (!prepareUploadDragEvent(e)) {
            return;
          }
        } else if (!isEventInToolbox(e)) {
          return;
        } else if (shouldLetNativeChatGptHandleUploadDrop(e)) {
          return;
        } else {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
        }

        uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
        setMultiUploadDragOverVisual(false);

        if (!claimUploadDropEvent(e, allowGlobalCapture ? 'global' : 'toolbox')) {
          return;
        }

        try {
          await handleUploadDropEvent(e, 'drag_drop_toolbox');
        } catch (error) {
          console.error('[MULTI_UPLOAD][DROP_ERROR]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
        }
      }

      uploadRootEl.addEventListener('dragenter', onDragEnter, true);
      uploadRootEl.addEventListener('dragover', onDragOver, true);
      uploadRootEl.addEventListener('dragleave', onDragLeave, true);
      uploadRootEl.addEventListener('drop', onDrop, true);

      uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP] = () => {
        uploadRootEl.removeEventListener('dragenter', onDragEnter, true);
        uploadRootEl.removeEventListener('dragover', onDragOver, true);
        uploadRootEl.removeEventListener('dragleave', onDragLeave, true);
        uploadRootEl.removeEventListener('drop', onDrop, true);
        uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
        delete uploadRootEl.dataset.dragDropBound;
        delete uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP];
      };
    }

    function unbindMultiUploadDragDrop(uploadRootEl) {
      if (!(uploadRootEl instanceof HTMLElement)) {
        return;
      }

      const cleanup = uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP];
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }

    function bindGlobalDropTarget(target, name) {
      if (!target) {
        console.warn('[ChatGPT toolbox] bindGlobalDropTarget: target 为空', name);
        return;
      }

      bindMultiUploadDragDrop(target);
    }

    function unbindGlobalDropTarget(target) {
      unbindMultiUploadDragDrop(target);
    }

    function syncGlobalDocumentDropBinding() {
      const cfg = getCompactUiConfig();

      if (cfg.globalDropCaptureEnabled) {
        bindGlobalDropTarget(document, 'document');
        return;
      }

      unbindGlobalDropTarget(document);
    }

    function bindAllMultiUploadDragDropTargets() {
      panelDropEl = document.getElementById(APP.panelId) || panelDropEl;

      if (rootElRef) {
        bindMultiUploadDragDrop(rootElRef);

        const uploadSection = rootElRef.querySelector('.toolbox-upload-drop-zone');
        if (uploadSection) {
          bindMultiUploadDragDrop(uploadSection);
        }
      }

      if (listEl) {
        bindMultiUploadDragDrop(listEl);
      }

      if (panelDropEl) {
        bindMultiUploadDragDrop(panelDropEl);
      }

      const toolboxRoot = document.getElementById(APP.rootId);
      if (toolboxRoot && toolboxRoot !== panelDropEl) {
        bindMultiUploadDragDrop(toolboxRoot);
      }

      syncGlobalDocumentDropBinding();
    }

    function bindUploadDropTargets(rootEl) {
      if (rootEl) {
        bindMultiUploadDragDrop(rootEl);
      }
      bindAllMultiUploadDragDropTargets();
    }

    async function ensureDefaultGroupReady() {
      if (state.activeGroupId) return;

      if (!state.groups.length) {
        const defaultGroup = createDefaultGroup();

        state.groups = [defaultGroup];
        state.activeGroupId = defaultGroup.id;

        await persistGroups();
        await schedulePersistQueue();

        saveCurrentToolboxBaseState('ensure-default-upload-group');

        render();
        return;
      }

      const preferred = resolveUploadGroupSelection({
        reason: 'ensure-default-upload-group',
      });

      state.activeGroupId = preferred.resolvedGroupId || '';

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][ensure-default-group] groupId=${state.activeGroupId || '-'} source=${preferred.reason || '-'}`,
      );

      saveCurrentToolboxBaseState('ensure-default-upload-group');

      await loadQueueForActiveGroup();

      render();
    }
    function buildQueueFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;
      const lastModified = Number(fileOrItem.lastModified) || 0;
      const type = String(fileOrItem.type || '').trim().toLowerCase();
      const path = String(
        fileOrItem.webkitRelativePath
        || fileOrItem.displayPath
        || '',
      ).trim().toLowerCase();

      if (!name && !size && !lastModified && !path) {
        return '';
      }

      return `${name}::${size}::${lastModified}::${type}::${path}`;
    }


    function buildQueueLooseFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;

      if (!name && !size) {
        return '';
      }

      return `${name}::${size}`;
    }

    function dedupeActiveGroupQueue(reason) {
      const groupId = state.activeGroupId;
      if (!groupId || !Array.isArray(state.queue)) return;
      const seen = new Map();
      const keep = [];
      for (const item of state.queue) {
        if (!item || item.groupId !== groupId) {
          keep.push(item);
          continue;
        }
        let key = buildQueueLooseFileKey(item);
        if (!key) {
          key = buildQueueFileKey(item);
        }
        if (!key) {
          keep.push(item);
          continue;
        }
        if (seen.has(key)) {
          const id = item.id || item._uploadId || '?';
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][dedupe-active-group:remove] reason=${reason} name=${item.name || '-'} size=${item.size || 0} id=${id}`
          );
          continue;
        }
        seen.set(key, true);
        keep.push(item);
      }
      state.queue = keep;
    }

    async function addFiles(files, options = {}) {
      const cleanFiles = Array.from(files || []).filter(Boolean);
      const handles = Array.isArray(options.handles) ? options.handles : [];

      if (!ensureActiveUploadGroupIdValid('add-files')) {
        if (!state.groups.length) {
          await ensureDefaultGroupReady();
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件组');
        console.warn('[ChatGPT toolbox] addFiles blocked: activeGroupId empty');
        appendUploadGroupLog('ADD_FILE', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return;
      }

      const existingKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueFileKey(item))
          .filter(Boolean)
      );

      const existingLooseKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueLooseFileKey(item))
          .filter(Boolean)
      );

      let addedCount = 0;

      cleanFiles.forEach((file, index) => {
        const fileKey = buildQueueFileKey(file);
        const fileLooseKey = buildQueueLooseFileKey(file);
        const useLooseDedupe = options.sourceKind === 'drop';

        if (
          (fileKey && existingKeys.has(fileKey))
          || (useLooseDedupe && fileLooseKey && existingLooseKeys.has(fileLooseKey))
        ) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][add-file-skip-duplicate] index=${index} name=${file.name || '-'} size=${file.size || 0} fileKey=${fileKey || '-'} looseKey=${fileLooseKey || '-'}`
          );
          return;
        }

        const handle = handles[index] || null;
        const hasHandle = isFileHandleLike(handle);

        const item = {
          id: newId(),
          groupId: state.activeGroupId,
          name: file.name || 'unknown',
          size: file.size || 0,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified || Date.now(),
          file,
          blob: file,
          fileHandle: hasHandle ? handle : null,
          sourceKind: hasHandle ? 'local-handle' : 'session-file',
          readMode: hasHandle ? 'handle' : 'snapshot',
          state: UploadState.IDLE,
          message: '',
          uploadName: '',
          persistedAttached: false,
        };

        state.queue.push(item);

        if (fileKey) {
          existingKeys.add(fileKey);
        }

        if (fileLooseKey) {
          existingLooseKeys.add(fileLooseKey);
        }

        addedCount += 1;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][add-file] index=${index} name=${item.name || '-'} size=${item.size || 0} handle=${hasHandle ? 1 : 0} sourceKind=${item.sourceKind} readMode=${item.readMode}`,
        );
      });

      dedupeActiveGroupQueue('add-files');
      await schedulePersistQueue();
      await refreshUploadGroupCounts();

      if (addedCount > 0) {
        const lastAdded = getActiveGroupFiles()[getActiveGroupFiles().length - 1];
        if (lastAdded && lastAdded.id) {
          setSelectedFileIdForActiveGroup(lastAdded.id, { reason: 'add-files' });
        }
      }

      render();

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][addFiles:done] count=${addedCount} queue=${getActiveGroupFiles().length} group=${state.activeGroupId || '-'}`,
      );
      syncUploadGroupAppState();
      appendUploadGroupLog('ADD_FILE', {
        addedCount,
        groupId: state.activeGroupId || '-',
      });
    }

    function pickOneLocalFileByInput() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        let finished = false;
        let focusCancelTimer = 0;

        function cleanup() {
          window.removeEventListener('focus', onWindowFocus, true);

          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          if (input && input.parentNode) {
            input.parentNode.removeChild(input);
          }
        }

        function finishOk(file) {
          if (finished) return;
          finished = true;
          cleanup();

          resolve({
            file,
            handle: null,
            source: 'input-file',
          });
        }

        function finishFailed(err) {
          if (finished) return;
          finished = true;
          cleanup();
          reject(err);
        }

        function readSelectedFile() {
          const file = input.files && input.files[0] ? input.files[0] : null;

          if (!file) {
            finishFailed(new Error('用户取消选择文件'));
            return;
          }

          finishOk(file);
        }

        function onWindowFocus() {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
          }

          focusCancelTimer = window.setTimeout(() => {
            focusCancelTimer = 0;

            if (finished) return;

            const file = input.files && input.files[0] ? input.files[0] : null;

            if (file) {
              finishOk(file);
              return;
            }

            finishFailed(new Error('用户取消选择文件'));
          }, 1200);
        }

        input.type = 'file';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '-9999px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.zIndex = '-1';

        input.addEventListener('change', () => {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          readSelectedFile();
        }, {
          once: true,
        });

        input.addEventListener('cancel', () => {
          finishFailed(new Error('用户取消选择文件'));
        }, {
          once: true,
        });

        document.body.appendChild(input);

        window.setTimeout(() => {
          window.addEventListener('focus', onWindowFocus, true);
        }, 0);

        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');

        input.click();
      });
    }

    async function pickOneLocalFileWithHandle() {
      const showOpenFilePicker = getShowOpenFilePickerFn();

      if (!showOpenFilePicker) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');
        return pickOneLocalFileByInput();
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=file-system-access supported=1');

      let handles;

      try {
        handles = await showOpenFilePicker({
          multiple: false,
        });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) {
          throw new Error('用户取消选择文件');
        }

        console.error('[ChatGPT toolbox] showOpenFilePicker failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:file-system-access-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      const handle = handles && handles[0] ? handles[0] : null;

      if (!handle || typeof handle.getFile !== 'function') {
        const err = new Error('未获取到有效文件句柄');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: invalid handle', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:invalid-handle] error=${err.message}`);
        throw err;
      }

      let file;

      try {
        file = await handle.getFile();
      } catch (e) {
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: handle.getFile failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:getFile-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      if (!file) {
        const err = new Error('文件句柄读取文件失败');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: empty file', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:empty-file] error=${err.message}`);
        throw err;
      }

      return {
        file,
        handle,
        source: 'file-system-access',
      };
    }

    async function pickOneLocalFileForRebind() {
      return pickOneLocalFileWithHandle();
    }


    async function rebindUploadFile(id) {
      if (!id) {
        setStatus('重新绑定失败：缺少文件 ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][rebind-file:skip] reason=empty-id');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('重新绑定失败：未找到队列文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:missing] id=${id || '-'}`);
        return;
      }

      try {
        const oldName = q.name || '';
        const picked = await pickOneLocalFileForRebind();
        const file = picked.file;
        const handle = picked.handle;

        if (!file) {
          throw new Error('重新绑定文件为空');
        }

        if (oldName && file.name && oldName !== file.name) {
          const ok = window.confirm(
            `重新选择的文件名和原缓存文件不同。\n\n原文件：${oldName}\n新文件：${file.name}\n\n是否继续绑定？`,
          );

          if (!ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:cancel-name-mismatch] id=${id || '-'} old=${oldName} next=${file.name}`,
            );
            setStatus('已取消重新绑定');
            return;
          }
        }

        const hasHandle = isFileHandleLike(handle);

        q.name = file.name || q.name || 'unknown';
        q.size = file.size || 0;
        q.type = file.type || q.type || 'application/octet-stream';
        q.lastModified = file.lastModified || Date.now();
        q.file = file;
        q.blob = file;

        if (hasHandle) {
          q.fileHandle = handle;
          q.sourceKind = 'local-handle';
          q.readMode = 'handle';
          q.message = '';
        } else {
          q.fileHandle = null;
          q.sourceKind = 'session-file';
          q.readMode = 'snapshot';
        }

        q.state = UploadState.IDLE;
        q.message = '';
        q.uploadName = '';
        q.persistedAttached = false;

        await schedulePersistQueue();
        await refreshUploadGroupCounts();

        render();

        setStatus(`已重新绑定文件：${q.name}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][rebind-file:success] id=${id || '-'} source=${picked.source || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind} readMode=${q.readMode} name=${q.name || '-'} size=${q.size || 0}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        if (errText.includes('用户取消选择文件') || errText.includes('未选择文件')) {
          console.warn('[ChatGPT toolbox] rebind upload file cancelled', err);
          setStatus('已取消重新绑定');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:cancelled] id=${id || '-'} error=${errText}`);
          return;
        }

        console.warn('[ChatGPT toolbox] rebind upload file failed', err);
        console.error('[ChatGPT toolbox] rebind upload file failed', err);
        setStatus(`重新绑定失败：${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} error=${errText}`);
      }
    }

    // 上传前统一入口：有 fileHandle 则必须 getFile() 从磁盘读最新文件，失败就直接报错，绝不走缓存降级
    async function readFreshFile(q) {
      if (!q) {
        throw new Error('readFreshFile: empty queue item');
      }

      if (q.fileHandle && typeof q.fileHandle.getFile === 'function') {
        try {
          const fresh = await q.fileHandle.getFile();

          if (fresh && fresh.size >= 0) {
            q.file = fresh;
            q.blob = fresh;
            q.name = fresh.name || q.name;
            q.size = fresh.size;
            q.type = fresh.type || q.type || 'application/octet-stream';
            q.lastModified = fresh.lastModified || q.lastModified;
            q.sourceKind = 'local-handle';
            q.readMode = 'handle';
            q.message = '';

            ToolboxShell.appendLog(
              `[UPLOAD_FILE][USE_FILE_HANDLE] name=${q.name || '-'} size=${q.size || 0}`,
            );

            return fresh;
          }
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);

          console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);

          q.message = '文件句柄读取失败，无法从磁盘读取最新文件';
          q.state = UploadState.MISSING_FILE;
          q.sourceKind = 'missing-file';
          q.readMode = '';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,
          );

          throw new Error('文件句柄读取失败，无法保证从磁盘读取最新文件 ' + (q.name || '-'));
        }

        // handle 存在但 getFile 返回空/无效 → 也报错
        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.readMode = '';
        q.message = '文件句柄读取返回空文件';

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][readFreshFile:handle-returned-invalid] name=${q.name || '-'}`,
        );

        throw new Error('文件句柄读取返回空文件，无法保证从磁盘读取最新文件 ' + (q.name || '-'));
      }

      const sessionFile = q.file;
      if (sessionFile instanceof File || sessionFile instanceof Blob) {
        q.sourceKind = sessionFile instanceof File ? 'session-file' : 'session-blob';
        q.readMode = 'session';
        q.message = '';
        ToolboxShell.appendLog(
          `[UPLOAD_FILE][USE_SESSION_FILE] name=${q.name || '-'} size=${sessionFile.size || 0}`,
        );
        return sessionFile;
      }

      const sessionBlob = q.blob;
      if (sessionBlob instanceof Blob) {
        const fileName = q.name || 'upload.bin';
        const mime = q.type || sessionBlob.type || 'application/octet-stream';
        const asFile = new File([sessionBlob], fileName, {
          type: mime,
          lastModified: q.lastModified || Date.now(),
        });
        q.file = asFile;
        q.blob = asFile;
        q.sourceKind = 'session-blob';
        q.readMode = 'session';
        q.message = '';
        ToolboxShell.appendLog(
          `[UPLOAD_FILE][USE_SESSION_BLOB] name=${fileName} size=${asFile.size || 0}`,
        );
        return asFile;
      }

      q.state = UploadState.MISSING_FILE;
      q.sourceKind = 'missing-file';
      q.readMode = '';
      q.message = '缺少文件句柄，无法从磁盘读取最新文件';

      ToolboxShell.appendLog(
        `[UPLOAD_FILE][NEED_REBIND] name=${q.name || '-'}`,
      );

      throw new Error('缺少文件句柄，无法从磁盘读取最新文件，缺少可读取的文件对象 ' + (q.name || '-'));
    }

    function cloneFileWithUniqueName(file, seq, total) {
      return cloneFileForUploadAttach(file, seq, total);
    }

    async function makeUploadFile(file, seq, total) {
      const renamed = cloneFileWithUniqueName(file, seq, total);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][makeUploadFile:rename-only] original=${file.name} upload=${renamed.name} size=${renamed.size}`
      );

      return renamed;
    }

    function dismissDuplicateDialogs() {
      const dialogs = qsa(SELECTORS.duplicateDialog).filter((el) => {
        return !isInToolbox(el) && isElementVisible(el);
      });

      dialogs.forEach((dialog) => {
        const text = String(dialog.innerText || dialog.textContent || '');

        if (!/已上传过|重复|duplicate|already uploaded/i.test(text)) return;

        const buttons = qsa('button, [role="button"]', dialog);
        const ok = buttons.find((btn) => {
          const t = String(btn.textContent || btn.getAttribute('aria-label') || '');
          return /确定|知道了|OK|Ok|ok|close|关闭/i.test(t);
        });

        if (ok instanceof HTMLElement) {
          ok.click();
          ToolboxShell.appendLog('已自动关闭平台重复提示');
        }
      });
    }

    function startDuplicateWatcher() {
      if (state.observer) return;

      state.observer = new MutationObserver(() => {
        dismissDuplicateDialogs();
      });

      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    function stopDuplicateWatcher(graceMs = 0) {
      if (!state.observer) {
        return;
      }

      const delay = Math.max(0, Number(graceMs) || 0);

      const disconnectObserver = () => {
        if (!state.observer) {
          return;
        }

        state.observer.disconnect();
        state.observer = null;
      };

      if (delay > 0) {
        window.setTimeout(disconnectObserver, delay);
        return;
      }

      disconnectObserver();
    }

    const NON_UPLOADABLE_RUNNING_OR_FINAL_STATES = new Set([
      UploadState.ATTACHING,
      UploadState.READING,
      UploadState.ATTACHED,
      UploadState.CANCELLED,
      'VERIFYING',
      'PENDING_CONFIRM',
      'PLATFORM_DUPLICATE',
    ]);

    function logUploadFinal(q, stateValue, errText = '') {
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][uploadOne:final] name=${q && q.name ? q.name : '-'} state=${stateValue} groupId=${q && q.groupId ? q.groupId : '-'} sourceKind=${q && q.sourceKind ? q.sourceKind : '-'} size=${q && q.size ? q.size : 0} err=${errText || ''}`,
      );
    }

    function markUploadCancelled(q, reason = '用户已停止上传') {
      updateItem(q.id, {
        state: UploadState.CANCELLED,
        message: reason,
      });
      logUploadFinal(q, UploadState.CANCELLED, '');
      return false;
    }

    function isUploadItemBlockedByState(q) {
      if (!q) return true;
      return NON_UPLOADABLE_RUNNING_OR_FINAL_STATES.has(q.state)
        || isUploadUnfinishedState(q.state);
    }

    function isUploadItemUploadable(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return hasAttemptableUploadSource(q);
    }

    function isUploadItemMissingSource(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return !hasAttemptableUploadSource(q);
    }

    async function resolveLiveFileForUpload(item) {
      if (!item) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][live-read:null-item]');
        return null;
      }

      if (isFileLike(item.file)) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][live-read:session-file] name=${item.name || '-'} size=${item.size || 0}`
        );
        return item.file;
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        try {
          const file = await item.fileHandle.getFile();

          item.file = file;
          item.name = file.name || item.name;
          item.size = Number(file.size) || item.size;
          item.lastModified = Number(file.lastModified) || item.lastModified;
          item.type = file.type || item.type || 'application/octet-stream';
          item.blob = null;
          item.readMode = 'file-handle-live';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle] name=${item.name || '-'} size=${item.size}`
          );

          return file;
        } catch (e) {
          console.error('[ChatGPT toolbox] resolveLiveFileForUpload: handle.getFile failed', e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle-failed] name=${item.name || '-'} error=${e && e.message ? e.message : String(e)}`
          );
        }
      }

      item.file = null;
      item.blob = null;
      item.state = UploadState.MISSING_FILE;
      item.message = '未保存文件内容，请重新拖入后再上传';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][live-read:missing] name=${item.name || '-'} reason=no-file-no-handle`
      );

      return null;
    }

    async function uploadOne(q, seq, total, options = {}) {
      const runId = options.runId;
      const signal = options.signal;
      let errText = '';

      ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:start] seq=${seq}/${total} name=${q.name} state=${q.state}`);

      if (isUploadCancelled(runId, signal)) {
        return markUploadCancelled(q);
      }

      try {
        updateItem(q.id, {
          state: UploadState.READING,
          message: '正在上传',
        });

        let fresh;

        try {
          fresh = await readFreshFile(q);

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:fresh-ok] name=${q.name} fresh=${fresh && fresh.name} size=${fresh && fresh.size} tag=${fresh ? Object.prototype.toString.call(fresh) : '-'}`);
        } catch (e) {
          console.warn('[ChatGPT toolbox] read fresh file failed', { name: q.name, id: q.id }, e);
          console.warn('[ChatGPT toolbox] read fresh file failed with source detail', {
            error: e,
            source: describeUploadSource(q),
            queue: state.queue.map((item) => describeUploadSource(item)),
          });

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:read-failed] ${q.name} ${e && e.message ? e.message : String(e)}`);

          const errMsg = e && e.message ? e.message : String(e);
          const missingFile = isHardFileReadFailure(errMsg);

          updateItem(q.id, {
            state: missingFile ? UploadState.MISSING_FILE : UploadState.FAILED,
            message: missingFile ? errMsg : `读取失败：${errMsg}`,
          });

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${missingFile ? UploadState.MISSING_FILE : UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${errMsg}`
          );
          return false;
        }

        if (isUploadCancelled(runId, signal)) {
          return markUploadCancelled(q);
        }

        let uploadFile = normalizeToNativeFile(fresh, q.name) || fresh;

        if (isUploadUseUniqueFileNameEnabled()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:before-make-upload-file] name=${q.name} fresh=${fresh.name} size=${fresh.size} seq=${seq}/${total}`
          );

          try {
            uploadFile = await makeUploadFile(fresh, seq, total);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-ok] original=${fresh.name} upload=${uploadFile.name} size=${uploadFile.size}`
            );
          } catch (e) {
            console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {
              name: fresh.name,
              seq,
              total,
            }, e);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-failed] name=${fresh.name} error=${e && e.message ? e.message : String(e)}`
            );

            uploadFile = fresh;
          }
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:rename-disabled] name=${fresh.name} size=${fresh.size}`
          );
        }

        console.debug('[ChatGPT toolbox] upload file name resolved', {
          originalName: fresh.name,
          uploadName: uploadFile.name,
          seq,
          total,
          uniqueNameEnabled: isUploadUseUniqueFileNameEnabled(),
        });

        updateItem(q.id, {
          state: UploadState.ATTACHING,
          message: '正在上传',
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:before-attach] name=${q.name} uploadName=${uploadFile.name} size=${uploadFile.size}`);

        const result = await ComposerApi.attachFilesByFileInput([uploadFile], 8000, {
          signal,
          runId,
          isCancelled: () => isUploadCancelled(runId, signal),
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:attach-result] name=${q.name} ok=${result.ok ? 1 : 0} reason=${result.reason || ''}`);

        if (isUploadCancelled(runId, signal) || result.cancelled) {
          return markUploadCancelled(q);
        }

        if (result.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();
          releaseUploadPayload(q, 'attach-ok');

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        const postEvidence = ComposerApi.findAttachmentEvidence(uploadFile, {
          extraNames: [q.name, uploadFile.name].filter(Boolean),
        });
        const postChipCount = ComposerApi.countAttachmentChips();
        const chipCountBefore = Number.isFinite(Number(result.chipCountBefore))
          ? Number(result.chipCountBefore)
          : -1;
        const chipCountAfter = Number.isFinite(Number(result.chipCountAfter))
          ? Number(result.chipCountAfter)
          : postChipCount;
        const chipCountIncreased = chipCountBefore >= 0 && chipCountAfter > chipCountBefore;

        if (postEvidence && postEvidence.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();
          releaseUploadPayload(q, 'post-evidence-attached');

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:post-evidence-attached] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} reason=${postEvidence.reason || '-'} chipCount=${postChipCount}`
          );

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        if (chipCountIncreased) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:chip-count-increased-but-need-name] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} chipBefore=${chipCountBefore} chipAfter=${chipCountAfter}`
          );
        }

        console.warn('[ChatGPT toolbox] legacy input upload failed', {
          name: q.name,
          uploadName: uploadFile.name,
          reason: result.reason,
          result,
          postEvidence,
          postChipCount,
          textPreview: postEvidence && postEvidence.textPreview ? postEvidence.textPreview : '',
        });

        const failMessage = result.settledFailed || /未确认上传完成|附件已触发/.test(result.reason || '')
          ? (result.reason || '附件已出现但未能确认稳定')
          : (result.reason || '上传失败');

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: failMessage,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${failMessage}`
        );
        return false;
      } catch (err) {
        errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] uploadOne failed', err);

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: errText,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:error] name=${q && q.name ? q.name : '-'} error=${errText}`
        );
        return false;
      } finally {
        const isCurrentRun = runId == null || runId === state.runId;

        if (
          isCurrentRun &&
          q &&
          isUploadUnfinishedState(q.state)
        ) {
          q.state = UploadState.FAILED;
          q.message = errText || '上传流程未正常结束';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:force-finalize-failed] name=${q.name || '-'} state=${q.state} runId=${runId || '-'}`
          );
        } else if (!isCurrentRun) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:skip-finalize-stale-run] name=${q && q.name ? q.name : '-'} runId=${runId || '-'} current=${state.runId || '-'}`
          );
        }

        persistQueueThrottled('uploadOne:finally');
      }
    }

    function markMissingLocalFiles(items) {
      let changed = false;

      (items || []).forEach((q) => {
        if (!q) return;
        if (q.state === UploadState.ATTACHED) return;

        if (hasAttemptableUploadSource(q)) {
          if (q.state === UploadState.MISSING_FILE) {
            q.state = UploadState.IDLE;
            q.message = '';
            changed = true;
          }
          return;
        }

        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.message = '缺少文件，请重新拖入';
        changed = true;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:missing-file] name=${q.name || '-'} state=${q.state} size=${q.size || 0}`,
        );
      });

      return changed;
    }

    function hasActiveUploadInProgressOnQueue() {
      return state.queue.some((q) => q && isUploadUnfinishedState(q.state));
    }

    function isUploadRunActuallyActive() {
      if (!state.running) {
        return false;
      }

      if (state.uploadAbortController) {
        return true;
      }

      if (hasActiveUploadInProgressOnQueue()) {
        return true;
      }

      return false;
    }

    function syncUploadTaskFromLegacyState() {
      if (!state.uploadTask || typeof state.uploadTask !== 'object') {
        state.uploadTask = { phase: 'idle', runId: '', cancelRequested: false };
      }

      const task = state.uploadTask;

      if (task.parentTask && task.phase === 'uploading') {
        return task;
      }

      if (state.uploadCancelRequested) {
        if (state.running || isUploadRunActuallyActive()) {
          task.phase = 'cancelling';
          task.cancelRequested = true;
          return task;
        }
      }

      if (isUploadRunActuallyActive()) {
        task.phase = 'uploading';
        task.cancelRequested = !!state.uploadCancelRequested;
        if (!task.runId && state.runId) {
          task.runId = `upload_${state.runId}`;
        }
        return task;
      }

      task.phase = 'idle';
      task.cancelRequested = false;
      return task;
    }

    function syncSendTaskFromLegacyState() {
      if (!state.sendTask || typeof state.sendTask !== 'object') {
        state.sendTask = { phase: 'idle', runId: '', cancelRequested: false };
      }

      const task = state.sendTask;

      if (state.messageSendCancelRequested) {
        task.cancelRequested = true;
      }

      if (state.waitingReply) {
        task.phase = 'waiting_reply';
        return task;
      }

      if (isWaitingSendActive() || state.messageSending) {
        task.phase = state.messageSending ? 'sending' : 'waiting_send';
        return task;
      }

      task.phase = 'idle';
      return task;
    }

    function syncCopyContinueTaskFromLegacyState() {
      if (!state.copyContinueTask || typeof state.copyContinueTask !== 'object') {
        state.copyContinueTask = {
          phase: 'idle',
          runId: '',
          cancelRequested: false,
          stopRequested: false,
          abortController: null,
        };
      }

      const task = state.copyContinueTask;

      if (task.cancelRequested || task.stopRequested) {
        task.phase = 'cancelling';
        return task;
      }

      if (!copyContinueTaskRunning) {
        const legacyStatus = String(copyTaskStatus || '').trim().toLowerCase();
        if (legacyStatus === 'done') {
          task.phase = 'success';
        } else if (legacyStatus === 'failed') {
          task.phase = 'failed';
        } else if (task.phase !== 'success' && task.phase !== 'failed') {
          task.phase = 'idle';
        }
        return task;
      }

      const legacyStatus = String(copyTaskStatus || '').trim().toLowerCase();
      if (legacyStatus === 'waiting_assistant') {
        task.phase = 'waiting_reply';
      } else if (legacyStatus === 'copying') {
        task.phase = 'copying';
      } else if (legacyStatus === 'sending_continue') {
        task.phase = 'sending_continue';
      } else if (legacyStatus === 'failed') {
        task.phase = 'failed';
      } else {
        task.phase = 'running';
      }

      return task;
    }

    function syncCopyTaskFromLegacyState() {
      if (!state.copyTask || typeof state.copyTask !== 'object') {
        state.copyTask = { phase: 'idle', runId: '', cancelRequested: false };
      }

      const task = state.copyTask;
      const running = copyLastReplyTaskRunning || copyLastMessageTaskRunning;

      if (!running) {
        task.phase = 'idle';
        task.cancelRequested = false;
        return task;
      }

      const status = String(copyLastReplyTaskStatus || copyLastMessageTaskStatus || '').trim();
      if (status === 'success') {
        task.phase = 'success';
      } else if (status === 'failed') {
        task.phase = 'failed';
      } else if (status === 'waiting' || copyLastMessageWaiting) {
        task.phase = 'waiting_reply';
      } else if (status === 'copying') {
        task.phase = 'copying';
      } else {
        task.phase = copyLastMessageWaiting ? 'waiting_reply' : 'copying';
      }

      return task;
    }

    function findAutoContinueButton(scope) {
      const root = scope || rootElRef || document;
      return qs(UploadSelectors.autoContinueBtn, root);
    }

    const resolveAutoContinueButton = findAutoContinueButton;

    function findAutoContinueUntilDoneButton(scope) {
      const root = scope || rootElRef || document;
      return qs(UploadSelectors.autoContinueUntilDoneBtn, root);
    }

    const resolveAutoContinueUntilDoneButton = findAutoContinueUntilDoneButton;

    function getAutoContinueButtonView(autoState) {
      if (
        typeof UploadButtonVm !== 'undefined'
        && typeof UploadButtonVm.getAutoContinueButtonViewState === 'function'
      ) {
        return UploadButtonVm.getAutoContinueButtonViewState(autoState);
      }

      const running = !!(autoState && (autoState.running || autoState.waitingReply));
      return {
        phase: running ? 'running' : 'idle',
        text: running ? '停止继续' : '自动继续',
        title: running
          ? '自动继续正在运行，点击后停止'
          : '复用自动指令队列：循环发送“继续”；再点一次停止',
        disabled: false,
        allowCancel: running,
        buttonPhase: running ? 'danger' : 'idle',
        action: running ? 'stop' : 'start',
      };
    }

    function applyAutoContinueButtonState(button, options = {}) {
      if (!button) {
        return false;
      }

      const reason = String(options.reason || 'render');
      let autoState = null;

      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.getState === 'function'
      ) {
        autoState = AutoQueueModule.getState();
      }

      const view = getAutoContinueButtonView(autoState);

      if (
        typeof UploadButtonVm !== 'undefined'
        && typeof UploadButtonVm.applyUploadButtonViewState === 'function'
      ) {
        return UploadButtonVm.applyUploadButtonViewState(button, view, reason, {
          buttonName: 'auto-continue',
        });
      }

      if (typeof setToolboxButtonState === 'function') {
        const phase = view.buttonPhase === 'waiting'
          ? ButtonPhase.WAITING
          : (view.buttonPhase === 'danger'
            ? ButtonPhase.DANGER
            : (view.buttonPhase === 'cancelled'
              ? ButtonPhase.CANCELLED
              : (view.buttonPhase === 'failed'
                ? ButtonPhase.FAILED
                : ButtonPhase.IDLE)));
        return setToolboxButtonState(button, {
          phase,
          text: view.text,
          title: view.title,
          disabled: !!view.disabled,
          allowCancel: !!view.allowCancel,
          reason,
        });
      }

      return false;
    }

    function applyAutoContinueUntilDoneButtonState(button, options = {}) {
      if (!button) {
        return false;
      }

      const reason = String(options.reason || 'render');
      let autoState = null;

      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.getState === 'function'
      ) {
        autoState = AutoQueueModule.getState();
      }

      if (
        typeof UploadButtonVm !== 'undefined'
        && typeof UploadButtonVm.getAutoContinueUntilDoneButtonViewState === 'function'
        && typeof UploadButtonVm.applyUploadButtonViewState === 'function'
      ) {
        const view = UploadButtonVm.getAutoContinueUntilDoneButtonViewState(autoState);
        return UploadButtonVm.applyUploadButtonViewState(button, view, reason, {
          buttonName: 'auto-continue-until-done',
        });
      }

      if (typeof setToolboxButtonState === 'function') {
        const running = !!(
          autoState
          && (
            autoState.running
            || autoState.waitingReply
            || autoState.cancelling
          )
        );
        return setToolboxButtonState(button, {
          phase: running ? ButtonPhase.DANGER : ButtonPhase.IDLE,
          text: running ? '停止智能继续' : '自动继续直到完成',
          title: running
            ? '自动继续直到完成正在运行，点击后停止（与「自动继续」共用 AutoQueue 运行态）'
            : '循环发送强约束继续指令；只有检测到严格完成信号才停止',
          disabled: false,
          allowCancel: running,
          reason,
        });
      }

      return false;
    }

    function refreshUploadAutoContinueButton(reason = '') {
      const btn = resolveAutoContinueButton(rootElRef);
      if (!btn) {
        return false;
      }
      return applyAutoContinueButtonState(btn, { reason: reason || 'refresh' });
    }

    function refreshUploadAutoContinueUntilDoneButton(reason = '') {
      const btn = resolveAutoContinueUntilDoneButton(rootElRef);
      if (!btn) {
        return false;
      }
      return applyAutoContinueUntilDoneButtonState(btn, { reason: reason || 'refresh' });
    }

    function syncButtonTasksFromModuleState(reason = '') {
      syncUploadTaskFromLegacyState();
      syncSendTaskFromLegacyState();
      syncCopyTaskFromLegacyState();
      syncCopyContinueTaskFromLegacyState();

      if (typeof ButtonTasks === 'undefined' || typeof ButtonTasks.mirrorTaskSnapshot !== 'function') {
        return;
      }

      const upload = state.uploadTask || {};
      const send = state.sendTask || {};
      const copy = state.copyTask || {};

      ButtonTasks.mirrorTaskSnapshot('upload', {
        phase: upload.phase,
        runId: upload.runId,
        cancelRequested: !!upload.cancelRequested,
        stopRequested: !!upload.cancelRequested,
        abortController: state.uploadAbortController || upload.abortController || null,
        lastError: upload.lastError || null,
      });

      ButtonTasks.mirrorTaskSnapshot('send', {
        phase: send.phase === 'waiting_ready' ? 'waiting_send' : send.phase,
        runId: send.runId || String(state.autoSendRunId || ''),
        cancelRequested: !!send.cancelRequested,
        stopRequested: !!(
          state.messageSendCancelRequested
          || state.cancelWaitingSend
        ),
        abortController: state.waitingSendAbortController || send.abortController || null,
        lastError: send.lastError || null,
      });

      ButtonTasks.mirrorTaskSnapshot('copy', {
        phase: copy.phase,
        runId: copy.runId,
        cancelRequested: !!copy.cancelRequested,
        stopRequested: !!copyHotkeyContinueLoopStopRequested,
        abortController: null,
        lastError: copy.lastError || null,
      });

      if (typeof ButtonTasks.setTaskPhase === 'function' && reason) {
        void reason;
      }
    }

    function buildUploadOnlyButtonSnapshot() {
      syncUploadTaskFromLegacyState();

      return {
        uploadTask: state.uploadTask,
        uploadRunning: isUploadRunActuallyActive(),
        activeFilesCount: getActiveGroupFiles().length,
      };
    }

    function buildUploadButtonRenderSnapshot() {
      syncButtonTasksFromModuleState('buildUploadButtonRenderSnapshot');

      return {
        uploadTask: state.uploadTask,
        sendTask: state.sendTask,
        copyTask: state.copyTask,
        uploadRunning: isUploadRunActuallyActive(),
        waitingSend: isWaitingSendActive(),
        waitingReply: !!state.waitingReply,
        messageSending: !!state.messageSending,
        activeFilesCount: getActiveGroupFiles().length,
        copyRunning: copyLastReplyTaskRunning || copyLastMessageTaskRunning,
        copyWaiting: copyLastMessageWaiting,
        copyStatus: String(copyLastReplyTaskStatus || copyLastMessageTaskStatus || ''),
        copyHotkeyOnceTask: ensureCopyHotkeyOnceTask(),
        copyHotkeyOnceActive: isCopyHotkeyOnceActive(),
        copyHotkeyContinueActive: isCopyHotkeyContinueActive(),
        copyHotkeyLoopActive: isCopyHotkeyLoopActive(),
        copyHotkeyUploadVerifyLoopActive: isCopyHotkeyUploadVerifyLoopActive(),
        copyContinueTask: state.copyContinueTask,
        sendHotkeyTask: state.sendHotkeyTask,
        copyHotkeyContinueTask: state.copyHotkeyContinueTask,
        copyHotkeyContinueLoopTask: state.copyHotkeyContinueLoopTask,
        copyHotkeyUploadVerifyLoopTask: state.copyHotkeyUploadVerifyLoopTask,
        homeTask: state.homeTask,
        onceLabel: typeof getCopyAndHotkeyButtonLabel === 'function'
          ? getCopyAndHotkeyButtonLabel()
          : '复制+快捷键',
        onceTitle: typeof getCopyAndHotkeyButtonTitle === 'function'
          ? getCopyAndHotkeyButtonTitle()
          : '',
        assistantBusy: typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy(),
      };
    }

    function cancelUploadFlow(reason = 'unknown') {
      const uploadReason = String(reason || 'unknown').trim() || 'unknown';
      const isChildUpload = !!(
        state.uploadTask
        && String(state.uploadTask.parentTask || '').trim()
      );
      const mode = isChildUpload ? 'child' : 'main';

      ToolboxShell.appendLog(`[UPLOAD_CANCEL][REQUEST] mode=${mode}`);

      if (
        uploadReason.includes('button-click:start-upload')
        || uploadReason.includes('upload-button')
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-button:cancel-requested] reason=${uploadReason}`,
        );
      }

      syncUploadTaskFromLegacyState();

      const uploadPhase = state.uploadTask
        ? String(state.uploadTask.phase || 'idle')
        : 'idle';

      const uploadActive = state.running
        || isUploadRunActuallyActive()
        || uploadPhase === 'uploading'
        || uploadPhase === 'cancelling'
        || (isChildUpload && uploadPhase === 'cancelling');

      if (!uploadActive) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-cancel-skip] reason=${uploadReason} detail=no-active-upload`,
        );
        return false;
      }

      if (mode === 'child') {
        if (state.uploadTask) {
          state.uploadTask.cancelRequested = true;
          state.uploadTask.phase = 'cancelling';
          if (!state.uploadTask.abortController) {
            state.uploadTask.abortController = new AbortController();
          }
        }

        state.cancelled = true;
        if (state.uploadTask && state.uploadTask.abortController) {
          ToolboxShell.appendLog('[UPLOAD_CANCEL][ABORT] mode=child');
          state.uploadTask.abortController.abort();
        }
        scheduleRenderUpload(`cancel-upload-flow:child:${uploadReason}`);
        return true;
      }

      state.uploadCancelRequested = true;
      state.cancelled = true;

      if (state.uploadTask && !isChildUpload) {
        state.uploadTask.cancelRequested = true;
        state.uploadTask.phase = 'cancelling';
      }

      if (typeof ButtonState !== 'undefined' && typeof ButtonState.logButtonStateCancel === 'function') {
        const btn = rootElRef ? qs(UploadSelectors.startBtn, rootElRef) : startBtn;
        ButtonState.logButtonStateCancel(btn, uploadReason, state.uploadTask && state.uploadTask.phase, {
          runId: state.uploadTask && state.uploadTask.runId,
        });
      }

      ToolboxShell.appendLog('[UPLOAD_CANCEL][ABORT] mode=main');
      if (state.uploadAbortController) {
        state.uploadAbortController.abort();
      }
      cancelCurrentUploadRun(uploadReason);
      scheduleRenderUpload(`cancel-upload-flow:${uploadReason}`);
      return true;
    }

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();
      const flaskHtml = buildFlaskUploadListHtml();

      if (!files.length && !flaskHtml) {
        return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">当前项目没有文件</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">松开鼠标，添加到当前项目</div>
            </div>
          </div>
        `;
      }

      const queueHtml = files.map((q) => {
        const activeClass = selectedFileId === q.id ? 'active' : '';
        const cachedClass = isCachedUploadSnapshot(q) ? 'cached-snapshot' : '';
        const sourceText = getUploadInlineStatusText(q);
        const itemTitle = escapeHtml(buildUploadItemTitle(q));

        const rebindButtonHtml = shouldShowRebindButton(q)
          ? `
            <button type="button"
              class="cgpt-upload-file-rebind"
              data-upload-rebind-id="${escapeHtml(q.id)}"
              title="重新选择本地文件">
              重新绑定
            </button>
          `
          : '';

        return `
            <div class="cgpt-upload-item ${activeClass} ${cachedClass}" data-id="${q.id}" data-group-id="${escapeHtml(activeGroupId)}" data-file-id="${escapeHtml(q.id)}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(q.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(q.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label ${isCachedUploadSnapshot(q) ? 'cached-source' : ''}">
                    ${escapeHtml(sourceText)}
                  </span>
                  ${rebindButtonHtml}
                </div>
              </div>
              <div class="cgpt-upload-actions-cell">
                <button type="button"
                  class="cgpt-upload-file-remove"
                  data-upload-remove-id="${escapeHtml(q.id)}"
                  title="移除">
                  ×
                </button>
              </div>
            </div>
          `;
      }).join('');

      return `${flaskHtml}${queueHtml}`;
    }

    function scheduleRenderUpload(reason = '') {
      const reasonText = String(reason || '').trim();

      if (reasonText && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[UPLOAD_RENDER][schedule] reason=${reasonText}`);
      }

      if (uploadTimers.has('upload-render', 'raf')) {
        return;
      }

      uploadTimers.raf('upload-render', () => {
        renderUploadListOnly();
        renderAllButtonStates();
      });
    }

    function renderUploadListOnly() {
      const el = listEl || (rootElRef ? qs(UploadSelectors.list, rootElRef) : null);
      if (!el) return;

      listEl = el;
      el.classList.add('toolbox-upload-file-list');
      refreshQueueReadableState();
      el.innerHTML = buildUploadListHtml();
    }

    const uploadPageCapabilityCache = {
      at: 0,
      key: '',
      light: null,
      heavy: null,
    };

    function countActiveUploadItemsForCapability() {
      return getActiveGroupFiles().filter((item) => {
        const stateName = String(item && item.state ? item.state : '').trim();
        return stateName && stateName !== UploadState.CANCELLED && stateName !== UploadState.DONE;
      }).length;
    }

    function buildUploadPageCapabilityCacheKey() {
      const composerTextLen = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').length
        : 0;
      const responding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      return [
        location.href,
        composerTextLen,
        isWaitingSendActive() ? 1 : 0,
        state.waitingReply ? 1 : 0,
        countActiveUploadItemsForCapability(),
        responding ? 1 : 0,
      ].join('|');
    }

    function getComposerAttachmentState() {
      let attachmentCount = 0;
      let hasAttachment = false;
      let attachmentUploading = false;
      let hasComposerPayload = false;

      try {
        if (typeof ComposerApi.countAttachmentChips === 'function') {
          attachmentCount = Number(ComposerApi.countAttachmentChips()) || 0;
        }

        if (typeof ComposerApi.hasComposerAttachmentUnified === 'function') {
          hasAttachment = !!ComposerApi.hasComposerAttachmentUnified();
        } else if (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function') {
          hasAttachment = !!ComposerApi.hasVisibleComposerAttachmentPayload();
        }

        if (typeof ComposerApi.isAttachmentStillUploading === 'function') {
          attachmentUploading = !!ComposerApi.isAttachmentStillUploading();
        }

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState({ light: true });
          if (Number.isFinite(Number(responseState.attachment_count))) {
            attachmentCount = Math.max(
              attachmentCount,
              Number(responseState.attachment_count) || 0,
            );
          }
          if (responseState.has_composer_payload === true) {
            hasComposerPayload = true;
          }
        }

        if (hasAttachment && attachmentCount <= 0) {
          attachmentCount = 1;
        }

        hasComposerPayload = !!(
          hasComposerPayload
          || hasAttachment
          || attachmentUploading
          || attachmentCount > 0
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getComposerAttachmentState failed', err);
        ToolboxShell.appendLog(`[UPLOAD][attachment-state-failed] error=${errText}`);
      }

      return {
        attachmentCount,
        hasAttachment,
        attachmentUploading,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
      };
    }

    function getUploadPageCapabilityLight() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let hasComposer = false;
      let canSendNow = false;
      let isResponding = false;
      let response_state = 'not_ready';
      let response_state_reason = '';
      let hasComposerPayload = false;
      let attachmentCount = 0;

      try {
        const attachmentState = getComposerAttachmentState();
        attachmentCount = attachmentState.attachmentCount;
        hasComposerPayload = attachmentState.hasComposerPayload;

        hasComposer = typeof ComposerApi.hasComposer === 'function' && ComposerApi.hasComposer();
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        canSendNow = typeof ComposerApi.canSendNowLight === 'function'
          ? ComposerApi.canSendNowLight()
          : (
            typeof ComposerApi.canSendNow === 'function'
            && ComposerApi.canSendNow({ maxAgeMs: 450 })
          );

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState({ light: true });
          response_state = String(responseState.response_state || response_state);
          response_state_reason = String(responseState.response_state_reason || '');
          canSendNow = responseState.can_send_now === true;
          isResponding = responseState.is_responding === true;
          if (responseState.has_composer_payload === true) {
            hasComposerPayload = true;
          }
          if (Number.isFinite(Number(responseState.attachment_count))) {
            attachmentCount = Math.max(
              attachmentCount,
              Number(responseState.attachment_count) || 0,
            );
          }
        } else {
          response_state = isResponding ? 'generating' : (canSendNow ? 'ready' : 'not_ready');
        }

        const attachmentStateAfter = getComposerAttachmentState();
        attachmentCount = Math.max(attachmentCount, attachmentStateAfter.attachmentCount);
        hasComposerPayload = hasComposerPayload || attachmentStateAfter.hasComposerPayload;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapabilityLight failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-light-failed] error=${errText}`);
      }

      const light = {
        hasComposer,
        canSendNow,
        can_send_now: canSendNow,
        isResponding,
        is_responding: isResponding,
        response_state,
        response_state_reason,
        attachmentCount,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
        sendable: hasComposer && canSendNow && !isResponding,
      };

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'capability-light',
          `[PERF][capability] cost=${costMs}ms heavy=0 reason=getUploadPageCapabilityLight`,
        );
      }

      return light;
    }

    function getUploadPageCapabilityHeavy() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const attachmentState = getComposerAttachmentState();
      let attachmentCount = attachmentState.attachmentCount;
      let hasComposerPayload = attachmentState.hasComposerPayload;
      let response_state = 'not_ready';
      let response_state_reason = '';
      let canSendNow = false;
      let isResponding = false;

      try {
        if (typeof ComposerApi.getExistingComposerPayloadSnapshot === 'function') {
          const payloadSnapshot = ComposerApi.getExistingComposerPayloadSnapshot();
          if (payloadSnapshot && payloadSnapshot.hasPayload) {
            hasComposerPayload = true;
            attachmentCount = Math.max(attachmentCount, 1);
          }
        }

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState();
          response_state = String(responseState.response_state || response_state);
          response_state_reason = String(responseState.response_state_reason || '');
          canSendNow = responseState.can_send_now === true;
          isResponding = responseState.is_responding === true;
          if (Number.isFinite(Number(responseState.attachment_count))) {
            attachmentCount = Math.max(
              attachmentCount,
              Number(responseState.attachment_count) || 0,
            );
          }
          if (responseState.has_composer_payload === true) {
            hasComposerPayload = true;
            attachmentCount = Math.max(attachmentCount, 1);
          }
        }

        const attachmentStateAfter = getComposerAttachmentState();
        attachmentCount = Math.max(attachmentCount, attachmentStateAfter.attachmentCount);
        hasComposerPayload = hasComposerPayload || attachmentStateAfter.hasComposerPayload;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapabilityHeavy failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-heavy-failed] error=${errText}`);
      }

      const latestAssistant = getLatestAssistantMessageForCopy();

      const heavy = {
        attachmentCount,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
        response_state,
        response_state_reason,
        canSendNow,
        can_send_now: canSendNow,
        isResponding,
        is_responding: isResponding,
        copyable: !!(latestAssistant && latestAssistant.ok),
        latestAssistant,
      };

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'capability-heavy',
          `[PERF][capability] cost=${costMs}ms heavy=1 reason=getUploadPageCapabilityHeavy attachmentCount=${attachmentCount}`,
        );
      }

      return heavy;
    }

    function getUploadPageCapability(options = {}) {
      const forceHeavy = options && options.heavy === true;
      const cacheKey = buildUploadPageCapabilityCacheKey();
      const now = Date.now();

      if (
        !forceHeavy
        && uploadPageCapabilityCache.key === cacheKey
        && uploadPageCapabilityCache.light
        && uploadPageCapabilityCache.heavy
        && now - uploadPageCapabilityCache.at < 500
      ) {
        return {
          ...uploadPageCapabilityCache.light,
          ...uploadPageCapabilityCache.heavy,
        };
      }

      const light = getUploadPageCapabilityLight();
      let heavy = uploadPageCapabilityCache.heavy;
      if (forceHeavy || !heavy || now - uploadPageCapabilityCache.at >= 500 || uploadPageCapabilityCache.key !== cacheKey) {
        heavy = getUploadPageCapabilityHeavy();
      }

      uploadPageCapabilityCache.at = now;
      uploadPageCapabilityCache.key = cacheKey;
      uploadPageCapabilityCache.light = light;
      uploadPageCapabilityCache.heavy = heavy;

      return { ...light, ...heavy };
    }

    function syncUploadTaskPhase() {
      return syncUploadTaskFromLegacyState().phase;
    }

    function syncSendTaskPhase() {
      return syncSendTaskFromLegacyState().phase;
    }

    function getSendTaskPhase() {
      return syncSendTaskPhase();
    }

    function getSendTaskState() {
      syncSendTaskPhase();
      return Object.assign({}, state.sendTask || { phase: 'idle', runId: '', cancelRequested: false });
    }

    function canSendNowForEnterHotkey() {
      if (getSendHotkeyPreDispatchBlockReason()) {
        return false;
      }
      return true;
    }

    function syncCopyTaskPhase() {
      return syncCopyTaskFromLegacyState().phase;
    }

    function assertRenderedUploadButtonConsistency() {
      if (typeof ButtonTasks === 'undefined' || typeof ButtonTasks.assertButtonStateConsistency !== 'function') {
        return;
      }

      syncButtonTasksFromModuleState('assertRenderedUploadButtonConsistency');

      const pairs = [
        [rootElRef ? qs(UploadSelectors.startBtn, rootElRef) : startBtn, 'upload'],
        [rootElRef ? qs(UploadSelectors.sendMessageBtn, rootElRef) : null, 'send'],
        [rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null, 'copy'],
        [rootElRef ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef) : null, 'copy'],
      ];

      pairs.forEach(([button, taskName]) => {
        if (!button) {
          return;
        }
        const task = ButtonTasks.getButtonTask(taskName);
        if (task) {
          ButtonTasks.assertButtonStateConsistency(button, task, `render:${taskName}`);
        }
      });
    }

    function cleanupLegacyCoupledButtons(rootEl) {
      const root = rootEl instanceof HTMLElement ? rootEl : document;
      const legacySendBtn = root.querySelector(UploadSelectors.legacyStartSendBtn);

      if (legacySendBtn) {
        legacySendBtn.remove();
        ToolboxShell.appendLog('[UPLOAD_DOM][legacy-send-button-removed] id=cgpt-upload-start-send');
      }
    }

    function logUploadButtonSplitDom() {
      ToolboxShell.appendLog(
        `[UPLOAD_DOM][button-split] uploadBtn=${document.querySelector(UploadSelectors.startBtn) ? 1 : 0} sendBtn=${document.querySelector(UploadSelectors.sendMessageBtn) ? 1 : 0} legacySendBtn=${document.querySelector(UploadSelectors.legacyStartSendBtn) ? 1 : 0}`,
      );
    }

    function setUploadButtonState(stateName, reason = '') {
      const btn = document.querySelector(UploadSelectors.startBtn);
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }

      const stateText = String(stateName || 'idle');

      if (stateText === 'uploading') {
        btn.dataset.uploadState = 'uploading';
        btn.setAttribute('aria-busy', 'true');
        btn.textContent = '上传中，点击停止';
      } else {
        btn.dataset.uploadState = 'idle';
        btn.removeAttribute('aria-busy');
        btn.textContent = '开始上传';
      }

      btn.classList.toggle('cgpt-btn-busy', stateText === 'uploading');

      btn.classList.remove('danger', 'cgpt-wait-send-cancel', 'cgpt-send-danger', 'cgpt-btn-waiting-danger');
      delete btn.dataset.waitDanger;
      delete btn.dataset.waitDangerReason;

      if (typeof clearButtonLongWaitDangerTimer === 'function') {
        clearButtonLongWaitDangerTimer(btn, reason || 'upload-state');
      }

      ToolboxShell.appendLog(`[UPLOAD_BUTTON][STATE] state=${stateText} reason=${reason || '-'}`);
    }

    function setSendButtonState(stateName, reason = '') {
      const btn = document.querySelector(UploadSelectors.sendMessageBtn);
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }

      const stateText = String(stateName || 'idle');

      btn.dataset.sendState = stateText;
      delete btn.dataset.uploadSendState;
      btn.setAttribute('aria-busy', stateText === 'sending' || stateText === 'waiting-reply' ? 'true' : 'false');

      const danger = stateText === 'sending'
        || stateText === 'waiting-reply'
        || stateText === 'cancelable-waiting';

      btn.classList.toggle('danger', danger);
      btn.classList.toggle('cgpt-send-danger', danger);
      btn.classList.toggle('cgpt-wait-send-cancel', danger);
      btn.classList.toggle('cgpt-btn-waiting-danger', false);

      if (!danger) {
        delete btn.dataset.waitDanger;
        delete btn.dataset.waitDangerReason;
        if (typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, reason || 'send-state');
        }
      }

      if (stateText === 'sending') {
        btn.textContent = '发送中';
      } else if (stateText === 'waiting-reply') {
        btn.textContent = '已发送';
      } else if (stateText === 'cancelable-waiting') {
        btn.textContent = '发送中';
      } else {
        btn.textContent = '发送消息';
      }

      btn.disabled = false;

      ToolboxShell.appendLog(`[SEND_BUTTON][STATE] state=${stateText} danger=${danger ? 1 : 0} reason=${reason || '-'}`);
    }

    function applyStartUploadButtonState(button, options = {}) {
      if (!button) {
        return false;
      }

      const reason = String(options.reason || 'render');
      const ignoreAutoQueueRunning = !!options.ignoreAutoQueueRunning;

      if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
        const uploadSnapshot = buildUploadOnlyButtonSnapshot();
        const uploadPhase = uploadSnapshot.uploadTask
          ? String(uploadSnapshot.uploadTask.phase || 'idle')
          : 'idle';
        const sendBusy = isWaitingSendActive() || !!state.waitingReply || !!state.messageSending;
        const activeFiles = Number(uploadSnapshot.activeFilesCount || 0);
        ToolboxShell.appendLog(
          `[BUTTON_DECOUPLE][UPLOAD_START] uploadPhase=${uploadPhase} uploadRunning=${uploadSnapshot.uploadRunning ? 1 : 0} `
          + `activeFiles=${activeFiles} ignoredSendBusy=${sendBusy ? 1 : 0} `
          + `ignoreAutoQueueRunning=${ignoreAutoQueueRunning ? 1 : 0}`,
        );
        const view = UploadButtonVm.getUploadButtonViewState(uploadSnapshot);
        return UploadButtonVm.applyUploadButtonViewState(button, view, reason);
      }

      if (typeof setToolboxButtonState !== 'function') {
        return false;
      }

      syncUploadTaskPhase();
      const phase = state.uploadTask.phase;
      const activeFiles = getActiveGroupFiles();
      const hasFiles = activeFiles.length > 0;

      if (phase === 'uploading') {
        setUploadButtonState('uploading', reason);
        return setButtonDanger(button, '上传中，点击停止', {
          title: '正在上传/绑定文件，点击停止上传',
          allowCancel: true,
          reason,
        });
      }

      if (phase === 'cancelling') {
        setUploadButtonState('uploading', reason);
        return setButtonWaiting(button, '正在停止', {
          title: '正在停止上传，请稍候',
          allowCancel: false,
          reason,
        });
      }

      if (phase === 'failed') {
        setUploadButtonState('idle', reason);
        return setButtonFailed(button, '上传失败，点击重试', {
          title: '上传失败，点击重新上传',
          disabled: false,
          reason,
        });
      }

      if (!hasFiles) {
        ToolboxShell.appendLog(
          `[UPLOAD_BUTTON][ENABLE_EMPTY_GROUP] reason=${reason} activeFiles=0 uploadAllowed=1`,
        );
      }

      const idleUploadResult = setButtonIdle(button, '开始上传', {
        title: hasFiles
          ? '只上传/绑定文件到 ChatGPT 输入框，不自动发送'
          : '当前页面文件数为 0，仍允许尝试上传/重新绑定',
        reason,
      });
      setUploadButtonState('idle', reason);
      return idleUploadResult;
    }

    function setSendMessageButtonVisualState(button, active, state = '') {
      if (!button) {
        return;
      }

      button.classList.toggle('cgpt-send-action-active', !!active);

      if (state) {
        button.dataset.sendState = state;
      } else {
        delete button.dataset.sendState;
      }
      delete button.dataset.uploadSendState;
    }

    function finalizeSendButtonStateFromTask(reason = '') {
      syncSendTaskPhase();
      const sendPhase = state.sendTask.phase;

      if (sendPhase === 'sending') {
        setSendButtonState('sending', reason);
        return;
      }

      if (sendPhase === 'waiting_reply') {
        setSendButtonState('waiting-reply', reason);
        return;
      }

      if (sendPhase === 'cancelling' || sendPhase === 'waiting_send' || sendPhase === 'waiting_ready') {
        setSendButtonState('cancelable-waiting', reason);
        return;
      }

      setSendButtonState('idle', reason);
    }

    function logSendButtonStateSource(sendPhase, reason = '') {
      const activePhases = new Set(['waiting_send', 'waiting_ready', 'sending', 'waiting_reply', 'cancelling']);
      if (!activePhases.has(sendPhase)) {
        return;
      }
      ToolboxShell.appendLog(
        `[SEND_BUTTON][STATE_SOURCE] phase=${sendPhase} waitingSend=${isWaitingSendActive() ? 1 : 0} `
        + `messageSending=${state.messageSending ? 1 : 0} waitingReply=${state.waitingReply ? 1 : 0} reason=${reason || '-'}`,
      );
    }

    function applySendMessageButtonState(button, capability, options = {}) {
      if (!button) {
        return false;
      }

      capability = capability && typeof capability === 'object'
        ? capability
        : {
          hasComposer: false,
          hasComposerPayload: false,
          has_composer_payload: false,
          attachmentCount: 0,
          canSendNow: false,
          isResponding: false,
          response_state: 'unknown',
        };

      syncSendTaskPhase();
      const sendPhase = state.sendTask.phase;
      const reason = String(options.reason || 'render');

      logSendButtonStateSource(sendPhase, reason);

      const failureHint = state.uploadSendFailureHint
        && (Date.now() - Number(state.uploadSendFailureHintAt || 0) < 12000)
        ? String(state.uploadSendFailureHint)
        : '';
      const successHint = state.uploadSendSuccessHint
        && (Date.now() - Number(state.uploadSendSuccessHintAt || 0) < 4000)
        ? String(state.uploadSendSuccessHint)
        : '';

      const buttonAttachmentState = getComposerAttachmentState();
      const hasPendingComposerPayload = !!(
        capability.hasComposerPayload
        || capability.has_composer_payload
        || buttonAttachmentState.hasComposerPayload
        || buttonAttachmentState.has_composer_payload
        || buttonAttachmentState.hasAttachment
        || Number(capability.attachmentCount || buttonAttachmentState.attachmentCount || 0) > 0
        || buttonAttachmentState.attachmentUploading
      );

      const pendingAttachmentWaitSend = hasPendingComposerPayload
        && !capability.canSendNow
        && sendPhase === 'idle';

      if (sendPhase === 'cancelling') {
        button.dataset.action = 'cancel-send';
        setSendMessageButtonVisualState(button, true, 'cancelling');
        const cancellingResult = setButtonWaiting(button, '取消中...', {
          title: '正在取消发送/等待',
          allowCancel: false,
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return cancellingResult;
      }

      if (sendPhase === 'waiting_send' || sendPhase === 'waiting_ready') {
        button.dataset.action = 'cancel-send';
        setSendMessageButtonVisualState(button, true, 'waiting-send');
        const waitSendResult = setButtonWaiting(button, '等待可发送，点击取消', {
          title: '正在等待发送按钮可用，再次点击可取消',
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return waitSendResult;
      }

      if (sendPhase === 'sending') {
        button.dataset.action = 'cancel-send';
        setSendMessageButtonVisualState(button, true, 'sending');
        const sendingResult = setButtonSending(button, '发送中，点击取消', {
          title: '正在发送，再次点击可取消',
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return sendingResult;
      }

      if (sendPhase === 'waiting_reply') {
        button.dataset.action = 'cancel-wait-reply';
        setSendMessageButtonVisualState(button, true, 'waiting-reply');

        const pendingAuto = !!state.pendingSendAfterReply;
        const replyText = pendingAuto ? '等待可发送，点击取消' : '等待回复，点击取消';
        const replyTitle = pendingAuto
          ? '助手正在回复或发送按钮未就绪，页面可发送后将自动点击；再次点击可取消'
          : '再次点击可取消等待回复';

        const waitingReplyResult = setButtonWaiting(button, '已发送', {
          title: replyTitle,
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return waitingReplyResult;
      }

      if (pendingAttachmentWaitSend) {
        button.dataset.action = 'send-message';
        setSendMessageButtonVisualState(button, false, '');

        const pendingAttachResult = setButtonIdle(button, '发送消息', {
          title: '已检测到输入框中有附件；点击后才开始等待 ChatGPT 发送按钮就绪',
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return pendingAttachResult;
      }

      const canSend = capability.hasComposer || pendingAttachmentWaitSend || failureHint || successHint;
      if (!canSend || !capability.hasComposer) {
        const hint = successHint
          ? '消息已发送'
          : (failureHint || (capability.isResponding
            ? '助手正在回复，暂不可发送'
            : '当前页面未检测到可用输入框或发送按钮'));

        const shortText = successHint
          ? '已发送'
          : (
            failureHint && failureHint.length > 22
              ? `${failureHint.slice(0, 22)}…`
              : (failureHint || '发送不可用')
          );

        button.dataset.action = (failureHint || successHint) ? 'send-message' : 'none';
        setSendMessageButtonVisualState(button, false, '');

        if (successHint) {
          const successResult = setButtonWaiting(button, shortText, {
            title: hint,
            allowCancel: false,
            reason,
            ariaBusy: false,
          });
          finalizeSendButtonStateFromTask(reason);
          return successResult;
        }

        if (failureHint) {
          const failureWaitResult = setButtonWaiting(button, shortText, {
            title: hint,
            allowCancel: false,
            reason,
            ariaBusy: false,
          });
          finalizeSendButtonStateFromTask(reason);
          return failureWaitResult;
        }

        const disabledResult = setToolboxButtonState(button, {
          phase: ButtonPhase.DISABLED,
          text: shortText,
          title: hint,
          disabled: true,
          reason,
        });
        finalizeSendButtonStateFromTask(reason);
        return disabledResult;
      }

      button.dataset.action = 'send-message';
      setSendMessageButtonVisualState(button, false, '');

      const idleResult = setButtonIdle(button, '发送消息', {
        title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        reason,
      });
      finalizeSendButtonStateFromTask(reason);
      return idleResult;
    }

    function renderUploadButtonsOnly(options = {}) {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let changedButtons = 0;
      const useHeavy = options && options.heavy === true;
      const skipCapabilityScan = !!(options && options.skipCapabilityScan);

      healStaleUploadRunningLockIfNeeded('renderUploadButtonsOnly');
      healStaleSendUiStateIfNeeded('renderUploadButtonsOnly');
      healStaleWaitingReplyStateIfNeeded('renderUploadButtonsOnly');

      syncButtonTasksFromModuleState(options.buttonTasksReason || 'renderUploadButtonsOnly');

      const fallbackCapability = {
        hasComposer: false,
        hasComposerPayload: false,
        has_composer_payload: false,
        attachmentCount: 0,
        canSendNow: false,
        isResponding: false,
        response_state: 'unknown',
      };

      const capability = skipCapabilityScan
        ? fallbackCapability
        : (getUploadPageCapability({ heavy: useHeavy }) || fallbackCapability);

      const currentStartBtn = rootElRef
        ? qs(UploadSelectors.startBtn, rootElRef)
        : startBtn;

      if (currentStartBtn) {
        startBtn = currentStartBtn;
      }

      if (applyStartUploadButtonState(currentStartBtn, { reason: 'renderUploadButtonsOnly' })) {
        changedButtons += 1;
      }

      const autoqStartUploadBtn = document.querySelector('#cgpt-autoq-start-upload');
      if (
        autoqStartUploadBtn
        && autoqStartUploadBtn !== currentStartBtn
        && applyStartUploadButtonState(autoqStartUploadBtn, {
          reason: 'renderUploadButtonsOnly:autoq-mirror',
          ignoreAutoQueueRunning: true,
        })
      ) {
        changedButtons += 1;
      }

      const sendMessageBtn = rootElRef ? qs(UploadSelectors.sendMessageBtn, rootElRef) : null;
      if (sendMessageBtn && applySendMessageButtonState(sendMessageBtn, capability, { reason: 'renderUploadButtonsOnly' })) {
        changedButtons += 1;
      }

      const copyContinueBtn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;
      if (copyContinueBtn) {
        let applied = false;
        let copyContinueView = null;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          copyContinueView = UploadButtonVm.getCopyContinueButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            copyContinueBtn,
            copyContinueView,
            'renderUploadButtonsOnly:copy-continue',
          );
        } else if (setButtonIdle(copyContinueBtn, '复制并继续', {
          title: '先复制最后回复，再发送“继续”',
          reason: 'copy-continue-idle',
        })) {
          applied = true;
        }
        if (applied) {
          changedButtons += 1;
          const busyPhase = copyContinueView && copyContinueView.phase
            ? String(copyContinueView.phase)
            : 'idle';
          copyContinueBtn.dataset.busy = busyPhase !== 'idle' && busyPhase !== 'success' ? '1' : '0';
        }
        copyContinueBtn.dataset.waitingReply = '0';
      }

      const autoContinueBtn = resolveAutoContinueButton(rootElRef);
      if (autoContinueBtn && applyAutoContinueButtonState(autoContinueBtn, { reason: 'renderUploadButtonsOnly' })) {
        changedButtons += 1;
      }

      const autoContinueUntilDoneBtn = resolveAutoContinueUntilDoneButton(rootElRef);
      if (
        autoContinueUntilDoneBtn
        && applyAutoContinueUntilDoneButtonState(autoContinueUntilDoneBtn, {
          reason: 'renderUploadButtonsOnly',
        })
      ) {
        changedButtons += 1;
      }

      const copyLastMessageBtn = rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null;
      if (copyLastMessageBtn && !isCopyLastButtonManagedLocally(copyLastMessageBtn)) {
        let applied = false;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          const view = UploadButtonVm.getCopyLastReplyButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            copyLastMessageBtn,
            view,
            'renderUploadButtonsOnly:copy-last',
          );
        } else if (setButtonIdle(copyLastMessageBtn, '复制最后回复', {
          title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
          reason: 'copy-last-idle',
        })) {
          applied = true;
        }
        if (applied) {
          changedButtons += 1;
        }
      }

      const copyHotkeyOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyOnceBtn, rootElRef)
        : null;
      if (copyHotkeyOnceBtn) {
        let applied = false;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          const view = UploadButtonVm.getCopyHotkeyOnceButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            copyHotkeyOnceBtn,
            view,
            'renderUploadButtonsOnly:copy-hotkey-once',
          );
        } else if (setButtonIdle(copyHotkeyOnceBtn, typeof getCopyAndHotkeyButtonLabel === 'function'
          ? getCopyAndHotkeyButtonLabel()
          : '复制+快捷键', {
          title: typeof getCopyAndHotkeyButtonTitle === 'function'
            ? getCopyAndHotkeyButtonTitle()
            : '',
          reason: 'copy-hotkey-once-idle',
        })) {
          applied = true;
        }
        if (applied) {
          changedButtons += 1;
        }
      }

      const copyHotkeyContinueOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      if (copyHotkeyContinueOnceBtn) {
        let applied = false;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          const view = UploadButtonVm.getCopyHotkeyContinueOnceButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            copyHotkeyContinueOnceBtn,
            view,
            'renderUploadButtonsOnly:copy-hotkey-continue',
          );
        } else if (setButtonIdle(copyHotkeyContinueOnceBtn, '复制+快捷键+继续', { reason: 'copy-hotkey-continue-idle' })) {
          applied = true;
        }
        if (applied) {
          changedButtons += 1;
        }
      }

      const copyHotkeyContinueLoopBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef)
        : null;
      if (copyHotkeyContinueLoopBtn) {
        let applied = false;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          const view = UploadButtonVm.getCopyHotkeyLoopButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            copyHotkeyContinueLoopBtn,
            view,
            'renderUploadButtonsOnly:copy-hotkey-loop',
          );
        } else {
          const loopSnapshot = buildUploadButtonRenderSnapshot();
          const loopTask = loopSnapshot.copyHotkeyContinueLoopTask || {};
          const loopPhase = String(loopTask.phase || '').trim().toLowerCase();
          const loopActive = loopPhase !== 'idle'
            && loopPhase !== 'stopped'
            && loopPhase !== 'success'
            && loopPhase !== 'failed'
            && loopPhase !== 'cancelled';
          if (loopPhase === 'stopping') {
            applied = setButtonWaiting(copyHotkeyContinueLoopBtn, '连续复制+快捷键+继续', {
              title: '停止请求已提交，正在等待连续复制任务退出',
              allowCancel: false,
              disabled: true,
              reason: 'copy-hotkey-loop-stopping',
            });
          } else if (loopActive || COPY_HOTKEY_LOOP_STOP_PHASES.has(loopPhase)) {
            applied = setButtonDanger(copyHotkeyContinueLoopBtn, '停止连续复制', {
              reason: 'copy-hotkey-loop-running',
            });
          } else if (setButtonIdle(copyHotkeyContinueLoopBtn, '连续复制+快捷键+继续', {
            reason: 'copy-hotkey-loop-idle',
          })) {
            applied = true;
          }
        }
        if (applied) {
          changedButtons += 1;
          copyHotkeyContinueLoopBtn.setAttribute('aria-disabled', 'false');
        }
      }

      const copyHotkeyUploadVerifyLoopBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueLoopUploadVerifyBtn, rootElRef)
        : null;

      if (copyHotkeyUploadVerifyLoopBtn) {
        let applied = false;
        const task = ensureCopyHotkeyUploadVerifyLoopTask();
        const phase = String(task.phase || 'idle').trim().toLowerCase();
        const loopActive = phase !== 'idle'
          && phase !== 'stopped'
          && phase !== 'success'
          && phase !== 'failed'
          && phase !== 'cancelled';

        if (loopActive || COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES.has(phase)) {
          applied = setButtonDanger(copyHotkeyUploadVerifyLoopBtn, '停止闭环继续', {
            reason: 'copy-hotkey-upload-verify-loop-running',
          });
        } else if (setButtonIdle(copyHotkeyUploadVerifyLoopBtn, '闭环继续+每5轮上传', {
          reason: 'copy-hotkey-upload-verify-loop-idle',
          title: '每 5 轮自动上传一次代码，检测到终止信号后停止',
        })) {
          applied = true;
        }

        if (applied) {
          changedButtons += 1;
          copyHotkeyUploadVerifyLoopBtn.setAttribute('aria-disabled', 'false');
        }
      }

      const homeBtn = rootElRef ? qs(HomeActionSelectors.homeBtn, rootElRef) : null;
      if (homeBtn) {
        let applied = false;
        if (typeof UploadButtonVm !== 'undefined' && typeof UploadButtonVm.applyUploadButtonViewState === 'function') {
          const snapshot = buildUploadButtonRenderSnapshot();
          const view = UploadButtonVm.getHomeButtonViewState(snapshot);
          applied = UploadButtonVm.applyUploadButtonViewState(
            homeBtn,
            view,
            'renderUploadButtonsOnly:home',
          );
        } else {
          applyHomeButtonState(homeBtn, state.homeTask && state.homeTask.phase !== 'idle'
            ? state.homeTask.phase
            : 'idle', { reason: 'renderUploadButtonsOnly' });
          applied = true;
        }
        if (applied) {
          changedButtons += 1;
        }
      }

      applyUploadShortcutButtonTitles(rootElRef);

      const compactStartBtns = rootElRef
        ? qsa('#cgpt-upload-start', rootElRef)
        : (startBtn ? [startBtn] : []);
      compactStartBtns.forEach((btn) => {
        if (btn && btn !== currentStartBtn && applyStartUploadButtonState(btn, { reason: 'compact-mirror' })) {
          changedButtons += 1;
        }
      });

      assertRenderedUploadButtonConsistency();

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'renderUploadButtonsOnly',
          `[PERF][renderUploadButtonsOnly] cost=${costMs}ms changedButtons=${changedButtons} heavy=${useHeavy ? 1 : 0}`,
        );
      }
    }

    function renderAllButtonStates(options = {}) {
      syncButtonTasksFromModuleState(options.buttonTasksReason || 'renderAllButtonStates');
      renderUploadButtonsOnly(options);
      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.renderQueueActionButtons === 'function'
      ) {
        AutoQueueModule.renderQueueActionButtons(options);
      }
    }

    function buildQuickPromptRenderSignature() {
      const cfg = getCompactUiConfig();
      const promptsVersion = JSON.stringify(
        PromptManagerModule && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts().map((p) => p.id)
          : [],
      );

      return JSON.stringify({
        isCompact: isCompactUploadView(),
        showUploadQuickPrompts: cfg.showUploadQuickPrompts !== false,
        showCompactQuickPrompts: cfg.showCompactQuickPrompts !== false,
        quickPromptIds: cfg.quickPromptIds || [],
        quickPromptActiveCategory: getQuickPromptActiveCategory(),
        promptsVersion,
      });
    }

    function renderUploadQuickPrompts() {
      const signature = buildQuickPromptRenderSignature();

      if (signature === quickPromptRenderSignature) {
        return;
      }

      quickPromptRenderSignature = signature;

      const box = rootElRef ? qs('#cgpt-upload-quick-prompts', rootElRef) : null;
      if (!box) return;

      const cfg = getCompactUiConfig();
      const isCompact = isCompactUploadView();

      const shouldShow = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      const groupsEl = qs('#cgpt-upload-quick-prompt-groups', box);
      const promptsListEl = qs('#cgpt-upload-quick-prompts-list', box);

      if (!shouldShow) {
        box.classList.add('cgpt-toolbox-hidden');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:hidden-by-config] isCompact=${isCompact}`,
        );
        return;
      }

      box.classList.remove('cgpt-toolbox-hidden');

      const ids = new Set(cfg.quickPromptIds || []);
      const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
        ? PromptManagerModule.getPrompts()
        : [];

      if (!prompts.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">暂无 Prompt，请先到 Prompt 管理中添加。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-prompts]');
        return;
      }

      const selected = prompts.filter((p) => ids.has(p.id));

      if (!selected.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">未选择常用 Prompt，请到设置中勾选。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-selected]');
        return;
      }

      const groups = getQuickPromptGroups(selected);
      let activeCategory = getQuickPromptActiveCategory();

      if (!groups.includes(activeCategory)) {
        activeCategory = '全部';
        saveQuickPromptActiveCategory(activeCategory, {
          reason: 'quick-category-fallback',
        });
      }

      const visiblePrompts = activeCategory === '全部'
        ? selected
        : selected.filter((p) => getPromptCategoryName(p) === activeCategory);

      const groupsHtml = groups.map((name) => {
        const count = getQuickPromptCategoryCount(name, selected);

        return `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-group${name === activeCategory ? ' active' : ''}"
              data-upload-quick-prompt-category="${escapeHtml(name)}"
              title="${escapeHtml(`${name}：${count} Prompt`)}">
              <span class="cgpt-chip-name">${escapeHtml(name)}</span>
              <span class="cgpt-chip-count">${count}</span>
            </button>
          `;
      }).join('');

      const chipsHtml = visiblePrompts.map((p) => `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-chip"
              data-upload-quick-prompt-id="${escapeHtml(p.id)}"
              title="${escapeHtml(p.title || '')}">
              ${escapeHtml(p.title || 'Prompt')}
            </button>
          `).join('');

      if (groupsEl && promptsListEl) {
        groupsEl.innerHTML = groupsHtml;
        promptsListEl.innerHTML = chipsHtml;
      } else {
        box.innerHTML = `
        <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>

        <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups">
          ${groupsHtml}
        </div>

        <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list">
          ${chipsHtml}
        </div>
      `;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:render] isCompact=${isCompact} shouldShow=true selected=${selected.length} total=${prompts.length} category=${activeCategory} visible=${visiblePrompts.length}`,
      );
    }

    function getQuickPromptCategoryCount(category, selectedPrompts) {
      if (category === '全部') {
        return selectedPrompts.length;
      }

      return selectedPrompts.filter((p) => getPromptCategoryName(p) === category).length;
    }

    function render() {
      if (!listEl) return;

      if (rootElRef) {
        ensureUploadActionToolbar(rootElRef);
        ensureUploadGroupSection(rootElRef);
        logUploadActionRowLayout(rootElRef, 'render');
        groupListEl = qs('#cgpt-upload-group-list', rootElRef);
      }

      refreshQueueReadableState();
      syncActiveGroupCountInCache();
      renderToolboxTopStatus();

      listEl.innerHTML = buildUploadListHtml();

      renderUploadButtonsOnly();

      if (managePanelEl && !managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
        syncGroupManagePanel();
      }

      applyCompactUiVisibility();
      renderUploadQuickPrompts();
      bindAllMultiUploadDragDropTargets();
    }

    function healStaleUploadRunningLockIfNeeded(context) {
      if (!state.running) return false;
      if (hasActiveUploadInProgressOnQueue()) return false;
      if (state.uploadAbortController) return false;

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][heal-running-lock] ctx=${String(context || '-')} activeId=${state.activeId || '-'}`
      );

      state.running = false;
      state.cancelled = false;
      state.activeId = '';
      state.uploadAbortController = null;

      if (rootElRef) {
        renderUploadButtonsOnly();
      }

      return true;
    }


    function logUploadSendUiState(action, reason, runId) {
      let cap = {
        isResponding: false,
        canSendNow: false,
        response_state: '-',
      };

      let attachmentCount = 0;

      try {
        cap = getUploadPageCapability({ heavy: true });
        const attachmentState = getComposerAttachmentState();
        attachmentCount = Math.max(
          Number(cap.attachmentCount || 0),
          Number(attachmentState.attachmentCount || 0),
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] logUploadSendUiState capability failed', err);
        ToolboxShell.appendLog(`[SEND_UI][STATE][capability-error] error=${errText}`);
      }

      ToolboxShell.appendLog(
        `[SEND_UI][STATE] action=${String(action || '-')} reason=${String(reason || '-')} runId=${runId == null ? '-' : runId} autoSendRunId=${state.autoSendRunId || '-'} waitingSend=${state.waitingSend ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} waitingReply=${state.waitingReply ? '1' : '0'} shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'} isResponding=${cap.isResponding ? '1' : '0'} canSendNow=${cap.canSendNow ? '1' : '0'} responseState=${cap.response_state || '-'} attachmentCount=${attachmentCount}`
      );
    }

    function mapUploadSendFailureMessage(reason) {
      const normalized = String(reason || '').trim();
      const baseReason = normalized.startsWith('send_not_confirmed:')
        ? normalized.slice('send_not_confirmed:'.length)
        : normalized;

      if (baseReason === 'click_send_failed' || normalized === 'click_send_failed') {
        return '发送失败：未能点击 ChatGPT 发送按钮';
      }

      if (baseReason === 'send_button_wait_timeout') {
        return '发送失败：等待发送按钮超时';
      }

      if (baseReason === 'send_button_unavailable') {
        return '发送失败：ChatGPT 发送按钮不可用';
      }

      if (baseReason === 'composer_empty') {
        return '发送失败：输入框无文本且无附件';
      }

      if (baseReason === 'assistant_busy') {
        return '发送失败：助手正在回复';
      }

      if (baseReason === 'input_not_cleared') {
        return '发送失败：输入框内容未清空（send_not_confirmed: input_not_cleared）';
      }

      if (baseReason === 'attachment_not_ready') {
        return '发送失败：附件仍在处理中（send_not_confirmed: attachment_not_ready）';
      }

      if (baseReason === 'button_disabled') {
        return '发送失败：发送按钮不可用（send_not_confirmed: button_disabled）';
      }

      if (baseReason === 'send_button_not_found') {
        return '发送失败：未找到 ChatGPT 发送按钮';
      }

      if (baseReason === 'no_user_bubble_after_click') {
        return '发送失败：点击后未出现用户消息（send_not_confirmed: no_user_bubble_after_click）';
      }

      if (baseReason === 'conversation_switch_timeout') {
        return '发送失败：会话跳转后未能确认发送（send_not_confirmed: conversation_switch_timeout）';
      }

      if (baseReason === 'composer_text_not_synced') {
        return '发送失败：文本未写入输入框（send_not_confirmed: composer_text_not_synced）';
      }

      if (baseReason === 'no_send_progress_after_actions') {
        return '发送失败：已尝试点击/快捷键/真实 Enter，但页面没有发送进展';
      }

      if (normalized) {
        return `发送失败：${normalized}`;
      }

      return '发送失败：unknown';
    }

    function resetUploadSendUiState(reason, runId, options = {}) {
      const preserveCancelRequested = options && options.preserveCancelRequested === true;

      if (state.waitingSendAbortController) {
        try {
          state.waitingSendAbortController.abort();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] resetUploadSendUiState abort failed', {
            error_type: err && err.name ? err.name : 'Error',
            error: errText,
            stack: err && err.stack ? err.stack : '',
          });
          ToolboxShell.appendLog(
            `[SEND_UI][abort-error] reason=${String(reason || '-')} error=${errText}`,
          );
        }
        state.waitingSendAbortController = null;
      }

      if (state.waitingSendTimer) {
        clearTimeout(state.waitingSendTimer);
        state.waitingSendTimer = null;
      }

      if (state.waitingSendInterval) {
        clearInterval(state.waitingSendInterval);
        state.waitingSendInterval = null;
      }

      stopWaitingReplyCheck();
      waitingReplyIdleStreak = 0;
      state.replyWaitSawBusy = false;
      state.replyWaitAssistantCountBefore = 0;

      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.messageSending = false;
      if (!preserveCancelRequested) {
        state.cancelWaitingSend = false;
        state.messageSendCancelRequested = false;
      }
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      state.waitingRealSendButton = false;
      lastWaitRealSendButtonLogAt = 0;
      state.waitingReply = false;
      state.waitingReplyRunId = null;
      state.waitingReplyTimer = null;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;

      if (!String(reason || '').startsWith('send-message-not-sent:')) {
        state.uploadSendFailureHint = '';
        state.uploadSendFailureHintAt = 0;
      }

      logUploadSendUiState('reset', reason, runId);

      setSendButtonState('idle', reason || 'reset');

      if (preserveCancelRequested) {
        ToolboxShell.appendLog(
          `[UPLOAD][FINISH] reason=${reason || '-'} preserveCancel=1`,
        );
      }
    }

    function finishUploadSendFlow(reason, options = {}) {
      const preserveCancelRequested = options && options.preserveCancelRequested === true;

      if (state.uploadAbortController && !preserveCancelRequested) {
        try {
          state.uploadAbortController.abort();
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[UPLOAD][ABORT_FAILED]', {
            error_type: error && error.name ? error.name : 'Error',
            error: errText,
            stack: error && error.stack ? error.stack : '',
          });
          ToolboxShell.appendLog(`[UPLOAD][ABORT_FAILED] ${errText}`);
        }
        state.uploadAbortController = null;
      }

      resetUploadSendUiState(reason, state.autoSendRunId, { preserveCancelRequested });
      scheduleRenderUpload(`upload-send-flow:finish:${reason || '-'}`);

      ToolboxShell.appendLog(
        `[UPLOAD][FINISH] reason=${reason || '-'} preserveCancel=${preserveCancelRequested ? '1' : '0'}`,
      );
    }

    function resetUploadSendButtonState(reason = 'send_failed_or_timeout', runId) {
      ToolboxShell.appendLog(
        `[SEND_UI][RESET] reason=${String(reason || 'send_failed_or_timeout')} runId=${runId == null ? '-' : runId}`,
      );
      resetUploadSendUiState(reason, runId);
    }

    function healStaleSendUiStateIfNeeded(context) {
      if (!isWaitingSendActive()) return false;
      if (state.waitingReply) return false;

      if (state.waitingRealSendButton) {
        ToolboxShell.appendLog(
          `[UPLOAD_SEND_UI][HEAL_SKIP] reason=waiting-real-send-button context=${String(context || '-')}`,
        );
        return false;
      }

      if (uploadSendTaskStartedAt <= 0) return false;
      const elapsed = Date.now() - uploadSendTaskStartedAt;
      if (elapsed < 8000) return false;

      try {
        const hasPendingComposerPayload = !!(
          (
            typeof ComposerApi.getExistingComposerPayloadSnapshot === 'function'
            && ComposerApi.getExistingComposerPayloadSnapshot().hasPayload
          )
          || (
            typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload()
          )
          || (
            typeof ComposerApi.isAttachmentStillUploading === 'function'
            && ComposerApi.isAttachmentStillUploading()
          )
        );

        if (hasPendingComposerPayload) {
          ToolboxShell.appendLog(
            `[SEND_UI][HEAL_STALE_SKIP] reason=${String(context || '-scheduled')} runningMs=${elapsed} cause=pending_composer_payload`,
          );
          return false;
        }

        const cap = getUploadPageCapability();
        const pageIdle = !cap.isResponding && cap.response_state !== 'generating';
        const noStopButton = !hasRealStopButtonForCopy();

        if (pageIdle && noStopButton) {
          ToolboxShell.appendLog(
            `[SEND_UI][HEAL_STALE] reason=${String(context || '-scheduled')} runningMs=${elapsed} isResponding=${cap.isResponding ? '1' : '0'} responseState=${cap.response_state || '-'} stopButton=${noStopButton ? '0' : '1'}`
          );
          resetUploadSendUiState('stale-send-ui:' + (context || '-scheduled'), state.autoSendRunId);
          scheduleRenderUpload('heal-stale-send-ui');
          return true;
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] healStaleSendUiStateIfNeeded error', err);
        ToolboxShell.appendLog(`[SEND_UI][HEAL_STALE_ERROR] error=${errText}`);
      }
      return false;
    }

    function healStaleWaitingReplyStateIfNeeded(context) {
      if (!state.waitingReply) {
        return false;
      }

      if (state.messageSending || isWaitingSendActive()) {
        return false;
      }

      if (state.pendingSendAfterReply) {
        return false;
      }

      const startedAt = Number(state.waitingReplyCheckedAt || 0);
      const elapsed = startedAt > 0 ? Date.now() - startedAt : 0;

      // 刚进入等待回复时不要立刻清理，避免刚发送后还没开始生成就被误判。
      if (elapsed > 0 && elapsed < 2500) {
        return false;
      }

      let capability = null;
      try {
        capability = getPageCapability('heal-stale-waiting-reply');
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] healStaleWaitingReplyStateIfNeeded getPageCapability failed', error);
        ToolboxShell.appendLog(`[SEND_UI][HEAL_WAITING_REPLY_ERROR] stage=capability error=${errText}`);
        return false;
      }

      const generatingState = isReplyGeneratingState(capability && capability.response_state);
      const stopVisible = hasRealStopButtonForCopy();

      const assistantBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      if (
        stopVisible
        || assistantBusy
        || generatingState
        || (capability && capability.is_responding)
      ) {
        return false;
      }

      let composerReady = false;
      try {
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.findSendButton === 'function') {
          const sendButton = ComposerApi.findSendButton();
          composerReady = !!(sendButton && !sendButton.disabled);
        } else if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.isSendButtonReady === 'function') {
          composerReady = !!ComposerApi.isSendButtonReady();
        } else {
          const btn = document.querySelector('button#composer-submit-button, button[data-testid="send-button"]');
          composerReady = !!(btn && !btn.disabled);
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] healStaleWaitingReplyStateIfNeeded composer check failed', error);
        ToolboxShell.appendLog(`[SEND_UI][HEAL_WAITING_REPLY_ERROR] stage=composer error=${errText}`);
        return false;
      }

      if (!composerReady) {
        return false;
      }

      const latestAssistantTextLen = getLatestAssistantTextForCopyCheck().length;

      if (latestAssistantTextLen <= 0) {
        return false;
      }

      ToolboxShell.appendLog(
        `[SEND_UI][HEAL_WAITING_REPLY] reason=composer-ready context=${String(context || '-')} `
        + `elapsed=${elapsed} textLen=${latestAssistantTextLen} `
        + `sawBusy=${state.replyWaitSawBusy ? 1 : 0}`,
      );

      finishWaitingReply('reply_done');
      return true;
    }

    function buildUploadSkipResult(reason, extra = {}) {
      return {
        success: 0,
        failed: 0,
        cancelled: false,
        total: 0,
        skipped: true,
        reason: String(reason || 'unknown'),
        ...extra,
      };
    }

    function buildUploadResult(success, failed, cancelled, total, extra = {}) {
      return {
        success: Number(success) || 0,
        failed: Number(failed) || 0,
        cancelled: !!cancelled,
        total: Number(total) || 0,
        skipped: false,
        ...extra,
      };
    }

    function buildQueueUploadResult({
      ok = false,
      uploadedCount = 0,
      failedCount = 0,
      skippedCount = 0,
      reason = '',
      cancelled = false,
    } = {}) {
      return {
        ok: !!ok,
        uploadedCount: Number(uploadedCount) || 0,
        failedCount: Number(failedCount) || 0,
        skippedCount: Number(skippedCount) || 0,
        reason: String(reason || ''),
        cancelled: !!cancelled,
      };
    }

    function isNoFilesUploadReason(reason) {
      const normalized = String(reason || '').trim();
      return (
        normalized === 'no-files'
        || normalized === 'no-pending-files'
        || normalized === 'empty-queue'
      );
    }

    function toLegacyUploadResult(queueResult) {
      const result = queueResult && typeof queueResult === 'object' ? queueResult : {};
      const uploadedCount = Number(result.uploadedCount) || 0;
      const failedCount = Number(result.failedCount) || 0;
      const skippedCount = Number(result.skippedCount) || 0;
      const reason = String(result.reason || '');
      const cancelled = !!result.cancelled || reason === 'cancelled';

      if (cancelled) {
        return buildUploadResult(uploadedCount, failedCount, true, uploadedCount + failedCount + skippedCount, {
          skipped: false,
          reason: 'cancelled',
        });
      }

      if (isNoFilesUploadReason(reason)) {
        return buildUploadSkipResult('no-pending-files', {
          total: 0,
          failed: 0,
        });
      }

      if (result.ok) {
        return buildUploadResult(uploadedCount, failedCount, false, uploadedCount + failedCount + skippedCount, {
          skipped: skippedCount > 0,
          reason: reason || 'unified-file-input',
        });
      }

      return buildUploadResult(uploadedCount, failedCount, false, uploadedCount + failedCount + skippedCount, {
        skipped: false,
        reason: reason || 'upload-failed',
      });
    }

    function cancelCurrentUploadRun(context) {
      const ctx = String(context || '-');
      ToolboxShell.appendLog(`[UPLOAD_DIAG][cancel-upload-run] ctx=${ctx} runId=${state.runId}`);

      state.cancelled = true;
      state.runId += 1;

      if (state.uploadAbortController) {
        state.uploadAbortController.abort();
        state.uploadAbortController = null;
      }

      if (state.activeId) {
        updateItem(state.activeId, {
          state: UploadState.CANCELLED,
          message: '上传已中断以便重新开始',
        });
      }

      state.running = false;
      state.activeId = '';
    }

    function setWaitingSendActive(active) {
      const on = !!active;
      state.waitingSend = on;
      state.autoSendWaiting = on;
    }

    function setWaitingRealSendButton(active) {
      state.waitingRealSendButton = !!active;
    }

    function isWaitSendCancelled(runId) {
      if (state.cancelWaitingSend || state.messageSendCancelRequested) {
        return true;
      }

      if (runId != null && Number(runId) > 0 && state.autoSendRunId !== runId) {
        return true;
      }

      return shouldStopForeverSend(runId);
    }

    async function sleepWithWaitSendCancel(ms, runId) {
      const totalMs = Math.max(0, Number(ms) || 0);
      const stepMs = Math.min(WAIT_REAL_SEND_BUTTON_POLL_MS, totalMs || WAIT_REAL_SEND_BUTTON_POLL_MS);
      let elapsed = 0;

      while (elapsed < totalMs) {
        if (isWaitSendCancelled(runId)) {
          return false;
        }

        const chunk = Math.min(stepMs, totalMs - elapsed);
        await sleep(chunk);
        elapsed += chunk;
      }

      return !isWaitSendCancelled(runId);
    }

    function findRealComposerSendButton() {
      if (typeof ComposerApi.findRealComposerSendButton === 'function') {
        return ComposerApi.findRealComposerSendButton({ silent: true });
      }

      if (typeof ComposerApi.findSendButton === 'function') {
        return ComposerApi.findSendButton({ silent: true });
      }

      return null;
    }

    function findUploadComposerSendButton() {
      return findRealComposerSendButton();
    }

    function hasVoiceOrDictationButtonOnly() {
      if (typeof hasVoiceComposerButtonOnly === 'function') {
        return hasVoiceComposerButtonOnly();
      }

      const submitBtn = document.querySelector('#composer-submit-button');
      if (
        submitBtn instanceof HTMLButtonElement
        && typeof ComposerApi.isVoiceButton === 'function'
        && ComposerApi.isVoiceButton(submitBtn)
      ) {
        return true;
      }

      return false;
    }

    function resolveUploadSendWaitStatus(capability = {}) {
      const cap = capability && typeof capability === 'object' ? capability : {};
      const responseReason = String(cap.response_state_reason || cap.responseStateReason || '').trim();
      const responseState = String(cap.response_state || '').trim();
      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const textLen = composerText.length;
      const hasAttachment = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
        ? ComposerApi.hasComposerAttachmentUnified()
        : (
          typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
          && ComposerApi.hasVisibleComposerAttachmentPayload()
        );
      const sendButton = findUploadComposerSendButton();
      const realSendButtonEnabled = sendButton instanceof HTMLButtonElement
        && typeof ComposerApi.isSendButtonReady === 'function'
        && ComposerApi.isSendButtonReady(sendButton);

      if (textLen <= 0 && !hasAttachment && !realSendButtonEnabled) {
        return {
          text: '输入框为空，未发送',
          kind: 'empty-composer',
        };
      }

      if (textLen <= 0 && hasAttachment) {
        const stillUploading = typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading();
        if (!stillUploading || realSendButtonEnabled) {
          return {
            text: '附件已就绪，正在发送附件',
            kind: 'attachment-only-send',
          };
        }
      }

      if (
        responseReason === 'attachment_processing'
        || responseState === 'attachment_processing'
        || (
          typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading()
        )
      ) {
        return {
          text: '等待附件处理完成后发送',
          kind: 'attachment-processing',
        };
      }

      if (
        hasVoiceOrDictationButtonOnly()
        || responseReason === 'attachment_ready_but_send_button_missing'
        || responseReason === 'payload_ready_but_send_button_missing'
      ) {
        return {
          text: '等待真实发送按钮：当前只有语音/听写按钮，未发送',
          kind: 'voice-only',
        };
      }

      return {
        text: '正在等待发送按钮就绪...',
        kind: 'waiting-button',
      };
    }

    function logWaitRealSendButtonIfDue(runId, source, capability) {
      const now = Date.now();
      if (now - lastWaitRealSendButtonLogAt < WAIT_REAL_SEND_BUTTON_LOG_INTERVAL_MS) {
        return;
      }

      lastWaitRealSendButtonLogAt = now;
      const cap = capability && typeof capability === 'object' ? capability : {};
      const waitStatus = resolveUploadSendWaitStatus(cap);

      ToolboxShell.appendLog(
        `[UPLOAD][WAIT_REAL_SEND_BUTTON] runId=${runId == null ? '-' : runId} source=${String(source || '-')} `
        + `kind=${waitStatus.kind} responseState=${cap.response_state || '-'} `
        + `responseReason=${cap.response_state_reason || '-'} waitingRealSendButton=${state.waitingRealSendButton ? '1' : '0'}`,
      );
      setStatus(waitStatus.text, 'running');
    }

    function isSendActuallyConfirmed() {
      try {
        const composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasPendingPayload = detectPendingComposerPayloadForSend();

        if (composerText || hasPendingPayload) {
          return false;
        }

        if (typeof ComposerApi.isAssistantLikelyBusy === 'function' && ComposerApi.isAssistantLikelyBusy()) {
          return true;
        }

        const cap = getUploadPageCapability({ heavy: false });
        return !!(
          cap.isResponding
          || cap.response_state === 'generating'
          || cap.response_state === 'streaming'
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] isSendActuallyConfirmed failed', err);
        ToolboxShell.appendLog(`[SEND][CONFIRM_CHECK_ERROR] error=${errText}`);
        return false;
      }
    }

    function isWaitingSendActive() {
      return !!(state.waitingSend || state.autoSendWaiting || uploadSendShortcutRunning);
    }

    function clearStaleBusySendStateOnHomeReady(reason) {
      if (typeof isHomeNewChatReadyToSendNow !== 'function' || !isHomeNewChatReadyToSendNow()) {
        return false;
      }

      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.messageSending = false;
      state.waitingRealSendButton = false;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      lastWaitRealSendButtonLogAt = 0;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;

      setSendButtonState('idle', reason || 'home-ready');
      ToolboxShell.appendLog(`[SEND][CLEAR_STALE_BUSY_STATE] reason=${reason || 'home-ready'}`);
      return true;
    }

    async function stopChatGPTGeneratingIfPossible() {
      if (typeof clickRealChatGPTStopGeneratingButton === 'function') {
        const result = clickRealChatGPTStopGeneratingButton('upload-stop-generating');
        if (result && result.clicked) {
          ToolboxShell.appendLog(
            `[UPLOAD][STOP_GENERATING_CLICKED] selector=${result.selector || '-'} method=${result.method || '-'}`,
          );
          return true;
        }
        ToolboxShell.appendLog('[UPLOAD][STOP_GENERATING_NOT_FOUND]');
        return false;
      }

      console.error('[UPLOAD] clickRealChatGPTStopGeneratingButton missing');
      ToolboxShell.appendLog('[UPLOAD][STOP_GENERATING_NOT_FOUND] reason=helper_missing');
      return false;
    }

    let currentUploadSendFlowRun = null;

    function createUploadSendRun(source = 'upload-send') {
      if (typeof FlowRuntime === 'undefined' || typeof FlowRuntime.createFlowRun !== 'function') {
        const legacyRun = {
          id: `upload-send-legacy-${Date.now()}`,
          kind: 'upload-send',
          source: String(source || 'upload-send'),
          startedAt: Date.now(),
          controller: state.uploadAbortController || new AbortController(),
          cancelled: false,
        };
        currentUploadSendFlowRun = legacyRun;
        state.uploadAbortController = legacyRun.controller;
        return legacyRun;
      }

      const flowResult = FlowRuntime.createFlowRun('upload-send');
      if (!flowResult.ok || !flowResult.run) {
        ToolboxShell.appendLog(
          `[UPLOAD][SEND_BLOCKED] reason=flow-locked source=${String(source || 'upload-send')}`,
        );
        return null;
      }

      const run = flowResult.run;
      run.source = String(source || 'upload-send');
      currentUploadSendFlowRun = run;
      state.uploadAbortController = run.controller;
      return run;
    }

    function isCurrentUploadSendRun(run) {
      if (!run) {
        return false;
      }
      if (typeof FlowRuntime !== 'undefined' && typeof FlowRuntime.isCurrentFlowRun === 'function') {
        return FlowRuntime.isCurrentFlowRun(run);
      }
      return currentUploadSendFlowRun === run && !run.cancelled;
    }

    function cancelUploadSendRun(reason = 'manual') {
      if (typeof FlowRuntime !== 'undefined' && typeof FlowRuntime.cancelFlowRun === 'function') {
        FlowRuntime.cancelFlowRun('upload-send', reason);
      }
      if (currentUploadSendFlowRun) {
        currentUploadSendFlowRun.cancelled = true;
        try {
          currentUploadSendFlowRun.controller.abort();
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox] cancelUploadSendRun abort failed', error);
          ToolboxShell.appendLog(`[UPLOAD][ABORT_FAILED] reason=${reason} error=${errText}`);
        }
      }
      if (state.uploadAbortController) {
        try {
          state.uploadAbortController.abort();
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox] cancelUploadSendRun state abort failed', error);
          ToolboxShell.appendLog(`[UPLOAD][ABORT_FAILED] reason=${reason} error=${errText}`);
        }
      }
      currentUploadSendFlowRun = null;
    }

    function finishUploadSendRun(run, reason = 'done') {
      if (run && typeof FlowRuntime !== 'undefined' && typeof FlowRuntime.finishFlowRun === 'function') {
        FlowRuntime.finishFlowRun(run, reason);
      }
      if (currentUploadSendFlowRun === run) {
        currentUploadSendFlowRun = null;
      }
      if (!currentUploadSendFlowRun) {
        state.uploadAbortController = null;
      }
    }

    function assertUploadSendFlowAlive(run, stage) {
      if (!run) {
        return true;
      }
      if (typeof FlowRuntime !== 'undefined' && typeof FlowRuntime.assertFlowAlive === 'function') {
        return FlowRuntime.assertFlowAlive(run, stage);
      }
      return isCurrentUploadSendRun(run);
    }

    function cancelCurrentUploadSend(reason) {
      const sendReason = String(reason || 'manual').trim() || 'manual';

      state.messageSendCancelRequested = true;
      state.cancelWaitingSend = true;

      cancelUploadSendRun(sendReason);

      ToolboxShell.appendLog(
        `[UPLOAD][SEND_CANCEL_REQUEST] reason=${sendReason} uploadRunning=${state.running ? 1 : 0}`,
      );
      void stopChatGPTGeneratingIfPossible();
      setStatus('已请求取消发送，正在等待当前发送流程退出', 'warning');

      finishUploadSendFlow('cancel-requested', { preserveCancelRequested: true });

      return true;
    }

    let replyWaitAssistantCountCache = null;

    function invalidateReplyWaitAssistantCountCache() {
      replyWaitAssistantCountCache = null;
    }

    function countVisibleAssistantMessagesForReplyWait(forceRefresh) {
      const now = Date.now();
      const cacheTtlMs = PRE_SEND_OPPORTUNITY_POLL_MS;
      if (
        !forceRefresh
        && replyWaitAssistantCountCache
        && (now - replyWaitAssistantCountCache.at) < cacheTtlMs
      ) {
        return replyWaitAssistantCountCache.count;
      }

      let count = 0;
      try {
        if (typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
        ) {
          const tail = ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false }) || [];
          for (let i = 0; i < tail.length; i += 1) {
            const rec = tail[i];
            if (!rec || rec.role !== 'assistant') continue;
            const text = String(rec.text || '').trim();
            if (!text) continue;
            count += 1;
          }
        } else if (typeof getValidAssistantTextsFromDom === 'function') {
          count = getValidAssistantTextsFromDom().length;
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] countVisibleAssistantMessagesForReplyWait failed', err);
        count = replyWaitAssistantCountCache ? replyWaitAssistantCountCache.count : 0;
      }

      replyWaitAssistantCountCache = { count, at: now };
      return count;
    }

    function isReplyGeneratingState(responseState) {
      const normalized = String(responseState || '').toLowerCase();
      return normalized === 'generating'
        || normalized === 'streaming'
        || normalized === 'responding'
        || normalized === 'submitted';
    }

    async function startManualUploadOnlyFlow(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const source = String(opts.source || 'button').trim() || 'button';

      const healedOnly = healStaleUploadRunningLockIfNeeded('startManualUploadOnlyFlow:before-running-check');
      ToolboxShell.appendLog(
        `[UPLOAD_MANUAL][HEAL_STALE_RUNNING] healed=${healedOnly ? 1 : 0} source=${source}`,
      );

      if (state.running) {
        ToolboxShell.appendLog(`[UPLOAD_MANUAL][START][SKIP] reason=already-running source=${source}`);
        return {
          ok: false,
          reason: 'already-running',
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const uploadLock = claimUploadActionLock('start-upload', { timeoutMs: 120000 });
      if (!uploadLock.ok) {
        ToolboxShell.appendLog(
          `[UPLOAD_MANUAL][START][SKIP] reason=${uploadLock.reason} runningMs=${uploadLock.runningMs || 0} source=${source}`,
        );
        return {
          ok: false,
          reason: uploadLock.reason || 'upload-action-lock',
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      ToolboxShell.appendLog(`[UPLOAD_MANUAL][START] source=${source}`);
      setStatus('正在上传文件...', 'running');
      scheduleRenderUpload(`upload-manual:start:${source}`);

      try {
        const uploadOpts = {
          source: `upload-manual:${source}`,
          shouldStop: typeof opts.shouldStop === 'function' ? opts.shouldStop : undefined,
          parentTask: opts.parentTask,
          cycleIndex: opts.cycleIndex,
        };

        const uploadResult = await startUploadFromCurrentQueue(uploadOpts);

        const result = uploadResult && typeof uploadResult === 'object'
          ? uploadResult
          : {
              ok: !!uploadResult,
              reason: uploadResult ? 'done' : 'upload-failed',
              uploadedCount: 0,
              failedCount: 0,
              skippedCount: 0,
            };

        if (result.cancelled) {
          setStatus('上传已取消', 'warning');
          ToolboxShell.appendLog(`[UPLOAD_MANUAL][DONE] reason=cancelled source=${source}`);
          return result;
        }

        if (!result.ok && result.reason !== 'no-files') {
          setStatus(`上传失败：${result.reason || 'unknown'}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_MANUAL][DONE] reason=${result.reason || 'failed'} source=${source}`);
          return result;
        }

        if (result.reason === 'no-files') {
          setStatus('没有可上传文件', 'warning');
          ToolboxShell.appendLog(`[UPLOAD_MANUAL][DONE] reason=no-files source=${source}`);
          return result;
        }

        setStatus('文件已上传到输入框', 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_MANUAL][DONE] source=${source} uploaded=${result.uploadedCount || 0} failed=${result.failedCount || 0} skipped=${result.skippedCount || 0}`,
        );
        scheduleRenderUpload(`upload-manual:done:${source}`);

        return result;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] startManualUploadOnlyFlow failed', err);
        ToolboxShell.appendLog(`[UPLOAD_MANUAL][FAILED] source=${source} error=${errText}`);
        setStatus(`上传失败：${errText}`, 'error');

        return {
          ok: false,
          reason: errText,
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      } finally {
        releaseUploadActionLock('start-upload');
      }
    }

    async function startUploadOnlyFlow(options = {}) {
      const result = await startManualUploadOnlyFlow(options);

      if (result && result.cancelled) {
        return false;
      }

      if (result && result.ok) {
        return true;
      }

      return false;
    }

    async function triggerSendFromToolbox(source) {
      const src = String(source || 'button').trim() || 'button';

      ToolboxShell.appendLog(`[SEND_MESSAGE][CLICK] source=${src}`);
      ToolboxShell.appendLog(`[MESSAGE_SEND][CLICK] source=${src}`);

      clearStaleBusySendStateOnHomeReady('trigger-send');

      syncSendTaskPhase();
      const sendPhase = getSendTaskPhase();
      if (sendPhase !== 'idle') {
        ToolboxShell.appendLog(
          `[UPLOAD][TRIGGER_SEND][SKIP] reason=send-task-active phase=${sendPhase} source=${src}`,
        );
        return false;
      }

      if (state.waitingReply) {
        if (detectPendingComposerPayloadForSend()) {
          state.pendingSendAfterReply = true;
          state.pendingSendAfterReplySource = src;
          state.pendingSendRetrying = false;
          setStatus('助手正在回复，已加入等待发送', 'running');
          startWaitingReplyCheck(state.autoSendRunId || Date.now(), Date.now());
          scheduleRenderUpload('send-message:queued-after-reply');
          ToolboxShell.appendLog(
            `[UPLOAD][TRIGGER_SEND][QUEUE] reason=waiting-reply source=${src}`,
          );
          return true;
        }

        setStatus('助手正在回复，但当前输入框没有待发送内容', 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD][TRIGGER_SEND][SKIP] reason=waiting-reply-no-payload source=${src}`,
        );
        return false;
      }

      if (isWaitingSendActive()) {
        ToolboxShell.appendLog(`[UPLOAD][TRIGGER_SEND][SKIP] reason=already-waiting-send source=${src}`);
        return false;
      }

      const sendLock = claimUploadActionLock('send-message', { timeoutMs: 120000 });
      if (!sendLock.ok) {
        ToolboxShell.appendLog(
          `[UPLOAD][TRIGGER_SEND][SKIP] reason=send-action-lock source=${src} detail=${sendLock.reason || '-'}`,
        );
        return false;
      }

      const flowRun = createUploadSendRun(src);
      if (!flowRun) {
        releaseUploadActionLock('send-message');
        ToolboxShell.appendLog(`[UPLOAD][TRIGGER_SEND][SKIP] reason=upload-send-flow-locked source=${src}`);
        return false;
      }

      ToolboxShell.appendLog(`[UPLOAD][TRIGGER_SEND] source=${src} flowId=${flowRun.id}`);
      const runId = claimWaitingSendRun(src, Date.now());

      try {
        return await sendCurrentMessageFromUploadPanel(src, runId, flowRun);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] triggerSendFromToolbox failed', err);
        ToolboxShell.appendLog(`[UPLOAD][TRIGGER_SEND][FAILED] source=${src} error=${errText}`);
        setStatus(`发送消息失败：${errText}`, 'error');
        resetUploadSendUiState('trigger-send-error', runId);
        return false;
      } finally {
        finishUploadSendRun(flowRun, 'trigger-send-finally');
        releaseUploadActionLock('send-message');
        scheduleRenderUpload(`trigger-send-finally:${src}`);
      }
    }

    async function startSendMessageFlow(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const source = String(opts.source || 'button').trim() || 'button';
      return triggerSendFromToolbox(source);
    }

    function cancelWaitingSend(reason = 'user-click') {
      if (!isWaitingSendActive() && !state.waitingReply) {
        return false;
      }

      const cancelRunId = state.autoSendRunId;
      state.cancelWaitingSend = true;
      state.autoSendRunId += 1;
      resetUploadSendUiState('cancel:' + reason, cancelRunId);
      ToolboxShell.appendLog(`[UPLOAD][WAIT_SEND][CANCEL] reason=${reason}`);
      if (typeof logButtonStateCancel === 'function') {
        const sendBtn = rootElRef ? qs(UploadSelectors.sendMessageBtn, rootElRef) : null;
        logButtonStateCancel(sendBtn, reason, state.sendTask.phase);
      }
      state.sendTask.cancelRequested = true;
      setStatus('已取消等待发送', 'warning');
      scheduleRenderUpload('wait-send:cancel');
      return true;
    }

    function claimWaitingSendRun(source, runId) {
      const id = Number(runId) || Date.now();

      state.cancelWaitingSend = false;
      state.uploadCancelRequested = false;
      state.messageSendCancelRequested = false;
      state.autoSendRunId = id;
      state.messageSending = false;
      setWaitingSendActive(true);
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();
      scheduleRenderUpload(`wait-send:claim:${source || '-'}`);
      logUploadSendUiState('claim', `wait-send:claim:${source || '-'}`, id);

      setSendButtonState('waiting', `wait-send:claim:${source || '-'}`);

      return id;
    }

    function mapForeverSendFailureMessage(reason) {
      const normalized = String(reason || '').trim();
      if (normalized === 'assistant_busy') {
        return '助手正在回复，暂不可发送';
      }
      if (normalized === 'cancelled') {
        return '已取消发送';
      }
      if (normalized === 'composer_not_found') {
        return '长时间未找到 ChatGPT 输入框，已停止发送';
      }
      if (normalized === 'composer_empty' || normalized === 'empty_text_and_no_attachment') {
        return '输入框为空，未发送';
      }
      if (normalized === 'composer_text_not_ready') {
        return '附件已就绪，正在发送附件';
      }
      if (normalized === 'attachment_only_send') {
        return '附件已发送';
      }
      if (normalized === 'send_button_not_found' || normalized === 'send_button_disabled') {
        return '发送按钮未就绪，已超时';
      }
      if (normalized === 'attachment_not_ready') {
        return '附件仍在处理，已超时';
      }
      if (normalized === 'send_not_confirmed' || normalized.startsWith('send_not_confirmed')) {
        return '发送未确认，请查看日志';
      }
      if (normalized === 'page_offline') {
        return '当前页面离线，已停止发送';
      }
      if (normalized === 'send_exception') {
        return '发送过程发生异常，请查看日志';
      }
      return '';
    }

    function enterUploadWaitingReplyAfterSend(runId, source) {
      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.waitingRealSendButton = false;
      state.messageSending = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      lastWaitRealSendButtonLogAt = 0;
      state.cancelWaitingSend = false;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;
      state.uploadSendFailureHint = '';
      state.uploadSendFailureHintAt = 0;
      state.waitingReply = true;
      setStatus('已发送信息');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} source=${source || '-'}`,
      );
      recordMessageSentAfterConfirmed();
      logUploadSendUiState('sent', 'waiting-reply', runId);
      updateChatInputStateBadge();
      startWaitingReplyCheck(runId, Date.now());
      scheduleRenderUpload('send-message:sent-waiting-reply');
    }

    function enterUploadWaitingReplyBlocked(runId, source) {
      clearStaleBusySendStateOnHomeReady('wait-reply-blocked');
      if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
        ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_skip_wait_reply_blocked');
        return;
      }

      state.waitingSend = true;
      state.autoSendWaiting = true;
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();

      state.waitingReply = true;
      state.pendingSendAfterReply = true;
      state.pendingSendAfterReplySource = String(source || 'button');
      state.pendingSendRetrying = false;

      setStatus('助手正在回复，持续等待可发送机会...', 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:wait-reply] source=${source || '-'} reason=assistant_busy action=retry_after_reply runId=${runId}`,
      );

      logUploadSendUiState('waiting-reply', 'assistant-busy-retry-after-reply', runId);
      updateChatInputStateBadge();
      startWaitingReplyCheck(runId, Date.now());
      scheduleRenderUpload('send-message:blocked-waiting-reply-retry');
    }

    function shouldStopForeverSend(runId) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return true;
      }
      if (state.cancelWaitingSend) {
        return true;
      }
      if (state.autoSendRunId !== runId) {
        return true;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return true;
      }
      return false;
    }

    function detectPendingComposerPayloadForSend() {
      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '')
        : '';
      const hasAttachment = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
        ? ComposerApi.hasComposerAttachmentUnified()
        : false;
      const sendButton = findUploadComposerSendButton();
      const realSendButtonEnabled = sendButton instanceof HTMLButtonElement
        && typeof ComposerApi.isSendButtonReady === 'function'
        && ComposerApi.isSendButtonReady(sendButton);

      return !!(
        String(composerText || '').trim()
        || hasAttachment
        || realSendButtonEnabled
        || (
          typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading()
        )
      );
    }

    function shouldRetryForeverSendReason(failReason) {
      const normalized = String(failReason || '').trim();
      if (!normalized) {
        return false;
      }

      if (normalized === 'empty_text_and_no_attachment') {
        return false;
      }

      if (
        normalized === 'composer_text_not_ready'
        || normalized === 'composer_empty'
      ) {
        if (typeof evaluateComposerSendability === 'function') {
          const sendability = evaluateComposerSendability(findUploadComposerSendButton());
          return !!(sendability.hasAttachment || sendability.realSendButtonEnabled);
        }
        return detectPendingComposerPayloadForSend();
      }

      return isForeverRetryableSendReason(normalized);
    }

    function isForeverRetryableSendReason(reason) {
      const normalized = String(reason || '').trim();

      if (!normalized) {
        return false;
      }

      if (normalized === 'cancelled' || normalized === 'page_navigating') {
        return false;
      }

      if (normalized === 'assistant_busy') {
        return true;
      }

      if (normalized === 'send_not_confirmed' || normalized.startsWith('send_not_confirmed:')) {
        return true;
      }

      return [
        'composer_empty',
        'composer_text_not_synced',
        'composer_not_ready',

        'send_button_not_found',
        'send_button_disabled',
        'send_button_wait_timeout',
        'send_button_unavailable',
        'send_button_not_ready_after_text',
        'send_button_not_found_enter_fallback_failed',

        'voice_button_only',
        'attachment_not_ready',
        'attachment_ready_but_send_button_missing',
        'attachment_ready_waiting_text',
        'payload_ready_but_send_button_missing',
        'composer_text_lost',
        'composer_text_lost_after_attachment',
        'composer_text_lost_after_rewrite',

        'click_send_failed',
        'send_click_exception',
        'send_click_not_confirmed',
        'no_send_progress_after_actions',
        'stable_send_timeout',

        'background-throttled',
      ].includes(normalized);
    }

    function stopUploadSendTask(source) {
      const reason = String(source || 'page-navigation');
      copyHotkeyContinueLoopStopRequested = true;
      copyLastMessageWaitRunId += 1;
      cancelWaitingSend(reason);
      stopWaitingReplyCheck();
      state.autoSendRunId += 1;
      resetUploadSendUiState(`nav-cleanup:${reason}`, state.autoSendRunId);
      uploadTimers.clearAll();
      ToolboxShell.appendLog(`[UPLOAD][STOP_SEND_TASK] source=${reason}`);
    }

    function stopUploadTask(source) {
      const reason = String(source || 'page-navigation');
      copyHotkeyContinueLoopStopRequested = true;
      if (state.running || state.activeId || state.uploadAbortController) {
        cancelCurrentUploadRun(reason);
      }
      stopDuplicateWatcher(0);
      uploadTimers.clearAll();
      ToolboxShell.appendLog(`[UPLOAD][STOP_UPLOAD_TASK] source=${reason}`);
    }

    function clearUploadTransientFileRefs(source) {
      try {
        ToolboxShell.appendLog(
          `[UPLOAD_CLEANUP][TRANSIENT_FILES] source=${source || '-'}`,
        );

        const releaseItemRefs = (item) => {
          if (!item) return;
          releaseUploadPayload(item, `nav-cleanup:${source || '-'}`);
          if (item.rawFile) {
            item.rawFile = null;
          }
        };

        if (Array.isArray(state.queue)) {
          state.queue.forEach(releaseItemRefs);
        }

        if (Array.isArray(UploadGroupAppState.uploadItems)) {
          UploadGroupAppState.uploadItems.forEach(releaseItemRefs);
        }

        getActiveGroupFiles().forEach(releaseItemRefs);
      } catch (err) {
        console.error('[ChatGPT toolbox] clearUploadTransientFileRefs failed', err);

        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);

        ToolboxShell.appendLog(
          `[UPLOAD_CLEANUP][TRANSIENT_FILES_ERROR] source=${source || '-'} type=${errName} error=${errText}`,
        );
      }
    }

    function classifyUploadComposerSendGate(options = {}) {
      const source = String(options.triggerSource || '').trim();
      const composerEmpty = !options.hasAnythingToSend;
      const nativeSendDisabled = !options.realSendButtonEnabled && !options.canSendNow;
      const assistantBusy = !!options.assistantBusy;
      const isUserSendTrigger = /^(button|shortcut|send-message|manual-send-message)/i.test(source)
        || source.includes('shortcut');
      const workflowCanStart = !!(
        options.activeFlowRun
        || state.pendingSendAfterReply
        || state.autoSendWaiting
        || isUserSendTrigger
        || /^(auto-queue|batch|bridge|retry-after-reply|quick-prompt|copy-and-continue|manual-send-message)/i.test(source)
      );

      return {
        composer_empty: composerEmpty,
        native_send_disabled: nativeSendDisabled,
        assistant_busy: assistantBusy,
        workflow_can_start: workflowCanStart,
      };
    }

    async function sendCurrentMessageFromUploadPanel(triggerSource, presetRunId, flowRun = null) {
      const source = triggerSource || 'button';
      const usePresetRunId = presetRunId != null && Number(presetRunId) > 0;
      const activeFlowRun = flowRun || currentUploadSendFlowRun;

      const runId = usePresetRunId
        ? Number(presetRunId)
        : claimWaitingSendRun(source, Date.now());

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:click] source=${source} runId=${runId} queue=${state.queue.length} running=${state.running}`
      );

      logUploadSendUiState('click', 'send-message-start', runId);
      setSendButtonState('sending', 'send-message-start');
      clearStaleBusySendStateOnHomeReady('send-panel-click');

      let sendFailureHandled = false;

      function uploadSendFlowCancelCheck(stage) {
        const stageText = String(stage || '-');

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=page_navigating runId=${runId}`,
          );
          logUploadSendUiState('send-aborted', `page-navigating:${stageText}`, runId);
          resetUploadSendUiState(`send-message:page-navigating:${stageText}`, runId);
          return true;
        }

        if (state.autoSendRunId !== runId) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=runId_changed runId=${runId} current=${state.autoSendRunId}`,
          );
          logUploadSendUiState('send-aborted', `runId-changed:${stageText}`, runId);
          return true;
        }

        if (state.cancelWaitingSend || state.messageSendCancelRequested) {
          ToolboxShell.appendLog(
            `[UPLOAD][CANCELLED] stage=${stageText}`,
          );
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=user_cancel runId=${runId} cancelWaitingSend=${state.cancelWaitingSend ? 1 : 0} messageSendCancelRequested=${state.messageSendCancelRequested ? 1 : 0}`,
          );
          logUploadSendUiState('send-aborted', `user-cancel:${stageText}`, runId);
          finishUploadSendFlow('cancelled', { preserveCancelRequested: false });
          return true;
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=offline runId=${runId}`,
          );
          setStatus('网络离线，已暂停发送', 'warn');
          logUploadSendUiState('send-aborted', `offline:${stageText}`, runId);
          resetUploadSendUiState(`send-message:offline:${stageText}`, runId);
          return true;
        }

        return false;
      }

      try {
        if (!assertUploadSendFlowAlive(activeFlowRun, 'enter-send-panel')) {
          sendFailureHandled = true;
          return false;
        }

        if (uploadSendFlowCancelCheck('enter-send-panel')) {
          sendFailureHandled = true;
          return false;
        }

        const rateLimitResult = await waitChatRateLimitBeforeSend();
        if (!assertUploadSendFlowAlive(activeFlowRun, 'after-rate-limit')) {
          sendFailureHandled = true;
          return false;
        }
        if (!rateLimitResult.ok) {
          const waitText = formatDurationMsForButton(rateLimitResult.delayMs || 0);
          setStatus(`消息额度已满，约 ${waitText} 后可发送`, 'warn');
          resetUploadSendUiState('send-message:rate-limit', runId);
          sendFailureHandled = true;
          return false;
        }

        const cadenceResult = await prepareUploadByCadenceIfNeeded();
        if (!assertUploadSendFlowAlive(activeFlowRun, 'after-cadence')) {
          sendFailureHandled = true;
          return false;
        }
        if (cadenceResult && cadenceResult.ok === false && !cadenceResult.skipped) {
          setStatus('按节奏自动上传失败，已停止发送', 'warn');
          resetUploadSendUiState('send-message:cadence-upload-failed', runId);
          sendFailureHandled = true;
          return false;
        }

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          resetUploadSendUiState('send-message:page-navigating', runId);
          return false;
        }

        clearStaleBusySendStateOnHomeReady('send-panel-before-capability');
        const capability = getUploadPageCapability({ heavy: true });
        const homeReadyToSend = typeof isHomeNewChatReadyToSendNow === 'function'
          && isHomeNewChatReadyToSendNow();

        const sendAttachmentState = getComposerAttachmentState();
        const hasPendingComposerPayload = !!(
          capability.hasComposerPayload
          || capability.has_composer_payload
          || Number(capability.attachmentCount || 0) > 0
          || sendAttachmentState.hasComposerPayload
          || sendAttachmentState.has_composer_payload
          || sendAttachmentState.hasAttachment
          || sendAttachmentState.attachmentCount > 0
          || sendAttachmentState.attachmentUploading
        );

        if (capability.isResponding && !homeReadyToSend) {
          enterUploadWaitingReplyBlocked(runId, source);
          sendFailureHandled = true;
          return false;
        }

        if (capability.isResponding && homeReadyToSend) {
          ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_ready_to_send');
        }

        const composerTextNow = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasAnythingToSend = !!(
          hasPendingComposerPayload
          || composerTextNow
        );

        let realSendButtonEnabled = !!capability.canSendNow;
        if (typeof evaluateComposerSendability === 'function') {
          const sendability = evaluateComposerSendability(findUploadComposerSendButton());
          realSendButtonEnabled = !!(
            sendability.realSendButtonEnabled
            || capability.canSendNow
          );
        }

        const attachmentCount = Number(
          sendAttachmentState.attachmentCount
          || capability.attachmentCount
          || 0,
        );
        const textLen = composerTextNow.length;
        const sendGate = classifyUploadComposerSendGate({
          triggerSource: source,
          hasAnythingToSend,
          realSendButtonEnabled,
          canSendNow: capability.canSendNow,
          assistantBusy: !!(capability.isResponding && !homeReadyToSend),
          activeFlowRun,
        });

        if (capability.hasComposer && !hasAnythingToSend) {
          if (!realSendButtonEnabled) {
            if (sendGate.workflow_can_start) {
              ToolboxShell.appendLog(
                `[SEND_MESSAGE][WAIT_PAYLOAD] reason=empty_but_workflow_started composer_empty=1 native_send_disabled=1 workflow_can_start=1 textLen=${textLen} attachmentCount=${attachmentCount} source=${source}`,
              );
              setStatus('等待注入内容后发送', 'running');
            } else {
              ToolboxShell.appendLog(
                `[SEND_MESSAGE][SKIP_EMPTY] reason=composer_empty native_send_disabled=1 workflow_can_start=0 textLen=${textLen} attachmentCount=${attachmentCount} source=${source}`,
              );
              setStatus('输入框为空，请先填写内容或选择 Prompt', 'warn');
              resetUploadSendUiState('send-message:composer-empty', runId);
              sendFailureHandled = true;
              return false;
            }
          } else {
            ToolboxShell.appendLog(
              `[SEND_MESSAGE][EMPTY_BUT_NATIVE_SEND] textLen=${textLen} attachmentCount=${attachmentCount} realSendButtonEnabled=1`,
            );
          }
        }

        if (!capability.hasComposer && !hasAnythingToSend) {
          const blockReason = 'no-composer';
          const blockMessage = '未找到 ChatGPT 输入框';
          setStatus(blockMessage, 'warn');
          ToolboxShell.appendLog(
            `[SEND_MESSAGE][FAILED] currentUrl=${location.href} composerFound=0 composerTextLength=${composerTextNow.length} sendButtonFound=${capability.canSendNow ? 1 : 0} activeTab=upload`,
          );
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
          );
          resetUploadSendUiState(`send-message-blocked:${blockReason}`, runId);
          scheduleRenderUpload('send-message:blocked');
          sendFailureHandled = true;
          return false;
        }

        if (!hasAnythingToSend && !realSendButtonEnabled) {
          if (sendGate.workflow_can_start) {
            ToolboxShell.appendLog(
              `[SEND_MESSAGE][WAIT_PAYLOAD] reason=empty_but_workflow_started composer_empty=1 native_send_disabled=1 workflow_can_start=1 textLen=${textLen} attachmentCount=${attachmentCount} source=${source}`,
            );
            setStatus('等待注入内容后发送', 'running');
          } else {
            const blockReason = 'composer-empty';
            setStatus('输入框为空，请先填写内容或选择 Prompt', 'warn');
            ToolboxShell.appendLog(
              `[SEND_MESSAGE][SKIP_EMPTY] reason=${blockReason} composer_empty=1 native_send_disabled=1 workflow_can_start=0 textLen=${textLen} attachmentCount=${attachmentCount} source=${source}`,
            );
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
            );
            resetUploadSendUiState(`send-message-blocked:${blockReason}`, runId);
            scheduleRenderUpload('send-message:blocked');
            sendFailureHandled = true;
            return false;
          }
        }

        if (!capability.canSendNow && hasPendingComposerPayload) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:wait-payload] source=${source} reason=payload_exists_but_send_not_ready attachmentCount=${Number(capability.attachmentCount || 0)} responseState=${capability.response_state || '-'}`,
          );
        }

        if (!capability.canSendNow) {
          setWaitingRealSendButton(true);
          const waitStatus = resolveUploadSendWaitStatus(capability);
          setStatus(waitStatus.text, 'running');
          logWaitRealSendButtonIfDue(runId, source, capability);
        } else {
          setWaitingRealSendButton(false);
          setStatus('正在发送...', 'running');
        }
        scheduleRenderUpload('send-message:start');

        if (uploadSendFlowCancelCheck('before-click-send-button-inner')) {
          sendFailureHandled = true;
          return false;
        }

        const hasAttachmentBeforeSend = detectPendingComposerPayloadForSend();
        if (hasAttachmentBeforeSend) {
          const attachmentReady = await waitComposerAttachmentReady({
            timeoutMs: 120000,
          });

          if (!attachmentReady.ok) {
            ToolboxShell.appendLog(
              `[UPLOAD][ATTACHMENT_NOT_READY] reason=${attachmentReady.reason || 'attachment-not-ready'}`,
            );
            setStatus('附件尚未就绪，已暂停发送', 'warn');
            sendFailureHandled = true;
            resetUploadSendUiState(`send-message:${attachmentReady.reason || 'attachment-not-ready'}`, runId);
            return false;
          }
        }

        const stableSendSource = source === 'button' || source === 'shortcut'
          ? 'manual-send-message-button'
          : (
            source === 'quick-prompt-click'
            || source.startsWith('quick-prompt')
              ? source
              : `manual-send-message-${source}`
          );

        if (typeof stableSendMessage !== 'function') {
          console.error('[ChatGPT toolbox] stableSendMessage is not available');
          setStatus('发送模块未就绪，请刷新页面后重试', 'error');
          return false;
        }

        ToolboxShell.appendLog(`[SEND_MESSAGE][ACTION] mode=composer_click source=${source}`);

        let sendResult = null;
        let outerAttempt = 0;

        while (state.autoSendRunId === runId && !shouldStopForeverSend(runId)) {
          outerAttempt += 1;

          if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
            logUploadSendUiState('send-aborted', 'page-navigating', runId);
            resetUploadSendUiState('send-message:page-navigating', runId);
            return false;
          }

          const capabilityNow = getUploadPageCapability({ heavy: true });
          const homeReadyNow = typeof isHomeNewChatReadyToSendNow === 'function'
            && isHomeNewChatReadyToSendNow();
          if (capabilityNow.isResponding && !homeReadyNow) {
            enterUploadWaitingReplyBlocked(runId, source);
            sendFailureHandled = true;
            return false;
          }
          if (capabilityNow.isResponding && homeReadyNow) {
            ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_ready_to_send');
          }

          if (uploadSendFlowCancelCheck('before-stable-send-attempt')) {
            sendFailureHandled = true;
            return false;
          }

          if (!assertUploadSendFlowAlive(activeFlowRun, 'before-stable-send')) {
            ToolboxShell.appendLog(`[UPLOAD][SEND_ABORT] reason=stale-run run=${runId}`);
            sendFailureHandled = true;
            return false;
          }

          sendResult = await stableSendMessage({
            source: stableSendSource,
            sendExistingComposer: true,
            maxAttempts: SEND_STABLE_RETRY_LIMIT,
            intervalMs: SEND_STABLE_RETRY_INTERVAL_MS,
            blockWhenResponding: true,
            timeoutMs: SEND_WAIT_TIMEOUT_MS,
            shouldStop: () => shouldStopForeverSend(runId)
              || !assertUploadSendFlowAlive(activeFlowRun, 'stable-send-loop'),
          });

          if (!assertUploadSendFlowAlive(activeFlowRun, 'after-stable-send')) {
            ToolboxShell.appendLog(`[UPLOAD][SEND_ABORT] reason=stale-run run=${runId}`);
            sendFailureHandled = true;
            return false;
          }

          if (state.autoSendRunId !== runId) {
            ToolboxShell.appendLog(`[UPLOAD][SEND_ABORT] reason=stale-run-id run=${runId} current=${state.autoSendRunId}`);
            logUploadSendUiState('send-aborted', 'runId-changed', runId);
            return false;
          }

          if (sendResult && sendResult.ok) {
            state.messageSending = true;
            ToolboxShell.appendLog(
              `[UPLOAD][SEND_FOREVER_OK] run=${runId} attempt=${outerAttempt} reason=${sendResult.reason || '-'}`,
            );
            break;
          }

          const failReason = String((sendResult && sendResult.reason) || 'unknown');

          if (sendResult && sendResult.wait_reply) {
            enterUploadWaitingReplyBlocked(runId, source);
            sendFailureHandled = true;
            return false;
          }

          if (failReason === 'page_navigating' || failReason === 'cancelled') {
            break;
          }

          const retryableByResult = !!(sendResult && sendResult.retryable === true);
          const retryableByReason = shouldRetryForeverSendReason(failReason);

          if (!(retryableByResult || retryableByReason)) {
            break;
          }

          if (outerAttempt % 10 === 0) {
            ToolboxShell.appendLog(
              `[UPLOAD][SEND_FOREVER_STILL_TRYING] run=${runId} attempt=${outerAttempt} reason=${failReason}`,
            );
          }

          setWaitingRealSendButton(true);
          logWaitRealSendButtonIfDue(runId, source, capabilityNow);
          const waitStatus = resolveUploadSendWaitStatus(capabilityNow);
          setStatus(waitStatus.text, 'running');
          state.waitingSend = true;
          state.autoSendWaiting = true;
          uploadSendShortcutRunning = true;
          uploadSendTaskStartedAt = Date.now();
          scheduleRenderUpload('send-message:retry-transient');
          const slept = await sleepWithWaitSendCancel(800, runId);
          if (!slept) {
            break;
          }
        }

        if (state.autoSendRunId !== runId) {
          logUploadSendUiState('send-aborted', 'runId-changed', runId);
          return false;
        }

        if (sendResult && sendResult.ok) {
          ToolboxShell.appendLog(
            `[SEND_MESSAGE][DONE] ok=1 source=${source} reason=${sendResult.reason || '-'}`,
          );
          state.uploadSendSuccessHint = '已发送';
          state.uploadSendSuccessHintAt = Date.now();
          enterUploadWaitingReplyAfterSend(runId, sendResult.reason || source);
          return true;
        }

        const failReason = String((sendResult && sendResult.reason) || 'unknown');
        const composerTextAfterFail = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';
        const attachmentCountAfterFail = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;

        const failMessage = mapForeverSendFailureMessage(failReason)
          || mapUploadSendFailureMessage(failReason);

        ToolboxShell.appendLog(
          `[UPLOAD][SEND_FOREVER_FAILED] run=${runId} attempt=${outerAttempt} reason=${failReason}`,
        );
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] reason=${failReason} textLen=${composerTextAfterFail.length} attachmentCount=${attachmentCountAfterFail} runId=${runId} autoSendRunId=${state.autoSendRunId}`,
        );

        if (failReason === 'cancelled' || failReason === 'page_navigating') {
          logUploadSendUiState('cancelled', failReason, runId);
          return false;
        }

        console.error(
          '[ChatGPT toolbox] send message not sent',
          failReason,
          `textLen=${composerTextAfterFail.length}`,
          `attachmentCount=${attachmentCountAfterFail}`,
        );

        state.waitingSend = false;
        state.autoSendWaiting = false;
        state.messageSending = false;
        state.waitingRealSendButton = false;
        uploadSendShortcutRunning = false;
        uploadSendTaskStartedAt = 0;
        resetUploadSendButtonState('send_failed_or_timeout', runId);

        if (state.autoSendRunId === runId) {
          const hintText = failMessage || '发送失败';
          setStatus(hintText, 'warn');
          state.uploadSendFailureHint = hintText;
          state.uploadSendFailureHintAt = Date.now();
        }

        scheduleRenderUpload('send-message:not-sent-reset');
        logUploadSendUiState('not-sent', failReason, runId);
        sendFailureHandled = true;
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send current message failed', err);
        const failMessage = `发送失败：${errText}`;
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:failed] runId=${runId} error=${errText}`);
        logUploadSendUiState('error', errText, runId);
        resetUploadSendButtonState('send_failed_or_timeout', runId);
        if (state.autoSendRunId === runId) {
          setStatus(failMessage, 'warn');
          state.uploadSendFailureHint = failMessage;
          state.uploadSendFailureHintAt = Date.now();
        }
        scheduleRenderUpload('send-message:exception-reset');
        sendFailureHandled = true;
        return false;
      } finally {
        if (!state.waitingReply && !isWaitingSendActive()) {
          state.waitingSend = false;
          state.autoSendWaiting = false;
          uploadSendShortcutRunning = false;
          uploadSendTaskStartedAt = 0;
        }

        if (!state.waitingReply && !sendFailureHandled && !isWaitingSendActive()) {
          state.uploadSendFailureHint = '';
          state.uploadSendFailureHintAt = 0;
          resetUploadSendUiState(
            state.autoSendRunId === runId ? 'send-message-finally' : 'send-message-finally-runid-changed',
            runId,
          );
          scheduleRenderUpload(
            state.autoSendRunId === runId ? 'send-message:finally' : 'send-message:finally-runid-changed',
          );
        }
      }
    }

    function shouldIgnoreToolboxShortcutTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;
      const inToolbox = !!el.closest(`#${APP.rootId}`);
      if (!inToolbox) {
        return false;
      }
      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(','));
    }

    function isChatGPTComposerEditableTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return false;
      }

      return !!el.closest([
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        '[data-testid="composer-root"]',
        'main form [contenteditable="true"]',
        'main form textarea',
        'main [role="textbox"]',
      ].join(','));
    }

    function isImeComposingEvent(e) {
      return !!(
        e
        && (
          e.isComposing
          || e.keyCode === 229
          || e.which === 229
        )
      );
    }

    function isPlainEnterSendEvent(e) {
      if (!e) return false;

      const key = String(e.key || '').toLowerCase();
      const code = String(e.code || '').toLowerCase();

      const isEnter = key === 'enter' || code === 'enter' || code === 'numpadenter';
      if (!isEnter) return false;

      if (e.shiftKey) return false;
      if (e.ctrlKey) return false;
      if (e.altKey) return false;
      if (e.metaKey) return false;

      return true;
    }

    function isGlobalSendShortcutItem(item) {
      if (typeof isPlainEnterShortcutItem === 'function') {
        return !!item && !isPlainEnterShortcutItem(item);
      }
      return !!item;
    }

    function isVisibleToolboxModalOpen() {
      const overlays = document.querySelectorAll('.cgpt-modal-overlay');

      for (const overlay of overlays) {
        if (!overlay || overlay.hidden) {
          continue;
        }

        const style = window.getComputedStyle(overlay);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }

        return true;
      }

      return false;
    }

    function isGlobalEditableTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return false;
      }

      const tagName = String(el.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return true;
      }

      if (el.isContentEditable === true) {
        return true;
      }

      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ].join(','));
    }

    function logSendHotkey(stage, extra) {
      ToolboxShell.appendLog(`[SEND_HOTKEY][${stage}]${extra ? ` ${extra}` : ''}`);
    }

    function formatSendHotkeyKey(e) {
      if (typeof formatShortcutFromEvent === 'function') {
        return formatShortcutFromEvent(e);
      }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      parts.push(e.key || e.code || 'Enter');
      return parts.join('+');
    }

    function getSendHotkeySkipReason(e) {
      if (!e) {
        return 'no-event';
      }

      if (isImeComposingEvent(e)) {
        return 'ime-composing';
      }

      if (e.repeat) {
        return 'repeat';
      }

      const cfg = getShortcutConfig();
      const sendItem = cfg && cfg.sendMessage ? cfg.sendMessage : null;
      const usesPlainEnterShortcut = isPlainEnterShortcutItem(sendItem) || isPlainEnterSendEvent(e);

      if (usesPlainEnterShortcut) {
        if (isChatGPTComposerEditableTarget(e.target)) {
          return 'plain-enter-native-composer';
        }
        return '';
      }

      if (!isGlobalSendShortcutItem(sendItem)) {
        return 'shortcut-not-configured';
      }

      const targetEl = e.target instanceof Element ? e.target : null;
      if (targetEl && targetEl.closest('button[data-enter-keep-native="1"]')) {
        return 'button-native-enter';
      }

      if (isGlobalEditableTarget(e.target) && !isChatGPTComposerEditableTarget(e.target)) {
        return 'editable-target';
      }

      const activeEl = document.activeElement;
      if (
        activeEl
        && activeEl !== e.target
        && isGlobalEditableTarget(activeEl)
        && !isChatGPTComposerEditableTarget(activeEl)
      ) {
        return 'active-editable';
      }

      if (typeof shouldSkipGlobalShortcutForToolboxEditing === 'function'
        && shouldSkipGlobalShortcutForToolboxEditing(e.target)) {
        return 'toolbox-editing';
      }

      if (isVisibleToolboxModalOpen()) {
        return 'modal-open';
      }

      if (targetEl) {
        const inToolbox = !!targetEl.closest(`#${APP.rootId}, #${APP.panelId}`);
        if (inToolbox) {
          const editable = targetEl.closest([
            'input',
            'textarea',
            'select',
            '[contenteditable="true"]',
            '[role="textbox"]',
            '[role="combobox"]',
            '[role="searchbox"]',
          ].join(','));

          if (editable && !editable.hasAttribute('data-enter-send')) {
            return 'toolbox-editable';
          }

          if (targetEl.closest('button[data-enter-keep-native="1"]')) {
            return 'toolbox-button-native-enter';
          }
        }
      }

      return '';
    }

    function getSendHotkeyPreDispatchBlockReason() {
      if (uploadSendShortcutRunning && !isWaitingSendActive() && !state.waitingReply) {
        return 'sending-in-progress';
      }

      if (!detectPendingComposerPayloadForSend()) {
        return 'no-pending-content';
      }

      let canSendNow = false;
      try {
        const capability = getUploadPageCapability({ heavy: false });
        canSendNow = !!(
          capability.canSendNow
          || capability.can_send_now
          || (
            typeof ComposerApi !== 'undefined'
            && typeof ComposerApi.canSendNowLight === 'function'
            && ComposerApi.canSendNowLight()
          )
          || (
            typeof ComposerApi !== 'undefined'
            && typeof ComposerApi.canSendNow === 'function'
            && ComposerApi.canSendNow({ maxAgeMs: 450 })
          )
        );
      } catch (capErr) {
        console.error('[SEND_HOTKEY][DISPATCH_BLOCKED] getUploadPageCapability failed', capErr);
        return 'capability-check-failed';
      }

      return '';
    }

    function shouldIgnoreSendShortcutTarget(eventOrTarget) {
      const event = eventOrTarget && eventOrTarget.target ? eventOrTarget : null;
      if (!event) {
        return true;
      }

      const skipReason = getSendHotkeySkipReason(event);
      if (skipReason) {
        logSendHotkeySkip(skipReason, event, 'shouldIgnoreSendShortcutTarget');
        logUploadShortcutDebug(event, 'send-ignore', skipReason);
        return true;
      }

      return false;
    }

    function getShortcutTargetText(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return '-';
      }
      const parts = [el.tagName.toLowerCase()];
      if (el.id) {
        parts.push(`#${el.id}`);
      }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (cls) {
          parts.push(`.${cls}`);
        }
      }
      return parts.join('');
    }

    function logUploadShortcutDebug(e, stage, extra) {
      const now = Date.now();
      if (now - uploadShortcutDebugLastAt < 120) {
        return;
      }
      uploadShortcutDebugLastAt = now;
      ToolboxShell.appendLog(
        `[SHORTCUT][${stage}] key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? '1' : '0'} alt=${e.altKey ? '1' : '0'} shift=${e.shiftKey ? '1' : '0'} meta=${e.metaKey ? '1' : '0'} repeat=${e.repeat ? '1' : '0'} target=${getShortcutTargetText(e.target)} extra=${extra || '-'}`
      );
    }

    function isUploadSendShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.sendMessage);
    }

    function resetUploadSendShortcutState(reason, runId) {
      resetUploadSendUiState(reason, runId);
      scheduleRenderUpload(`send-shortcut-reset:${reason || '-'}`);
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:state-reset] reason=${reason || '-'} runId=${runId || '-'} autoSendRunId=${state.autoSendRunId || '-'} waitingSend=${state.waitingSend ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} waitingReply=${state.waitingReply ? '1' : '0'} shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'}`
      );
    }

    function shouldIgnoreDuplicateShortcutEvent(e) {
      const now = Date.now();
      const eventKey = [
        e && e.key ? e.key : '',
        e && e.code ? e.code : '',
        Math.floor(Number(e && e.timeStamp ? e.timeStamp : 0)),
      ].join('|');

      if (
        eventKey === lastUploadSendShortcutEventKey
        && now - lastUploadSendShortcutEventAt < 500
      ) {
        return true;
      }

      lastUploadSendShortcutEventKey = eventKey;
      lastUploadSendShortcutEventAt = now;
      return false;
    }

    function logSendHotkeySkip(reason, e, source) {
      const key = formatSendHotkeyKey(e);
      const target = getShortcutTargetText(e && e.target);
      ToolboxShell.appendLog(
        `[SEND_HOTKEY][SKIP] reason=${reason} key=${key} target=${target} source=${source || '-'}`,
      );
      logSendHotkey('SKIP', `reason=${reason} key=${key} target=${target}`);
    }

    function dispatchSendMessageShortcut(shortcutSource, event) {
      const src = `shortcut:${String(shortcutSource || 'document').trim() || 'document'}`;

      ToolboxShell.appendLog(`[SEND_HOTKEY][TRIGGER_SEND] source=${src}`);

      const sendBtn = rootElRef ? qs(UploadSelectors.sendMessageBtn, rootElRef) : null;

      if (sendBtn) {
        runUploadUiAction('send-message', sendBtn, src, event);
        return true;
      }

      void triggerSendFromToolbox(src)
        .then((ok) => {
          if (ok) {
            logSendHotkey('DISPATCH_OK', `source=${src}`);
          } else {
            logSendHotkey('DISPATCH_BLOCKED', `reason=send-flow-returned-false source=${src}`);
          }
        })
        .catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] shortcut trigger send failed', err);
          ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] source=${src} error=${errText}`);
          setStatus(`快捷键发送失败：${errText}`, 'error');
          resetUploadSendShortcutState('shortcut-catch', state.autoSendRunId);
          logSendHotkey('DISPATCH_BLOCKED', `reason=exception source=${src} detail=${errText}`);
        });

      return true;
    }

    function handleUploadSendShortcutKeydown(e, source) {
      if (!isUploadSendShortcutEvent(e)) {
        return false;
      }

      const shortcutSource = source || 'document';
      const keyLabel = formatSendHotkeyKey(e);
      ToolboxShell.appendLog(
        `[SEND_HOTKEY][MATCH] source=${shortcutSource} key=${keyLabel}`,
      );

      logUploadShortcutDebug(e, 'send-match', shortcutSource);

      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'repeat');
        return true;
      }

      if (shouldIgnoreSendShortcutTarget(e)) {
        return false;
      }

      if (shouldIgnoreDuplicateShortcutEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        ToolboxShell.appendLog(
          '[UPLOAD_DIAG][send-shortcut:ignored] reason=duplicate-keydown-event',
        );
        return true;
      }

      if (isPlainEnterSendEvent(e)) {
        const sendPhase = getSendTaskPhase();
        if (sendPhase !== 'idle') {
          e.preventDefault();
          e.stopPropagation();
          ToolboxShell.appendLog(
            `[TOOLBOX_HOTKEY][enter-send-skip] reason=send-task-active phase=${sendPhase}`,
          );
          logSendHotkey('SKIP', `reason=send-task-active phase=${sendPhase} key=${formatSendHotkeyKey(e)}`);
          return true;
        }

        if (!canSendNowForEnterHotkey()) {
          const blockReason = getSendHotkeyPreDispatchBlockReason() || 'not-ready';
          ToolboxShell.appendLog(
            `[TOOLBOX_HOTKEY][enter-send-skip] reason=send-not-ready detail=${blockReason}`,
          );
          logSendHotkey('SKIP', `reason=send-not-ready detail=${blockReason} key=${formatSendHotkeyKey(e)}`);
          return false;
        }
      }

      if (
        typeof FlowRuntime !== 'undefined'
        && typeof FlowRuntime.getActiveFlowRun === 'function'
        && FlowRuntime.getActiveFlowRun('upload-send')
      ) {
        e.preventDefault();
        e.stopPropagation();
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-shortcut:ignored] reason=upload-send-active source=${source || '-'}`,
        );
        return true;
      }

      const now = Date.now();
      if (now - uploadSendShortcutLastAt < 500) {
        e.preventDefault();
        e.stopPropagation();
        logSendHotkey('SKIP', `reason=too-fast key=${formatSendHotkeyKey(e)}`);
        return true;
      }

      if (isWaitingSendActive()) {
        if (isChatGPTComposerEditableTarget(e.target)) {
          logSendHotkey('SKIP', `reason=chatgpt-composer-waiting-send key=${formatSendHotkeyKey(e)}`);
          return false;
        }

        const runningMs = uploadSendTaskStartedAt ? Date.now() - uploadSendTaskStartedAt : 0;
        if (runningMs > 30000 && !ComposerApi.isAssistantLikelyBusy()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-shortcut:stale-reset] runningMs=${runningMs} waiting=${state.autoSendWaiting ? '1' : '0'}`
          );
          resetUploadSendShortcutState('stale-shortcut-auto-reset', state.autoSendRunId);
        } else {
          e.preventDefault();
          e.stopPropagation();
          cancelWaitingSend('shortcut-click');
          logSendHotkey('DISPATCH_OK', 'action=cancel-waiting-send');
          return true;
        }
      }

      if (isPlainEnterSendEvent(e)) {
        const blockReason = getSendHotkeyPreDispatchBlockReason();
        if (blockReason) {
          logSendHotkey('DISPATCH_BLOCKED', `reason=${blockReason} key=${formatSendHotkeyKey(e)}`);
          return false;
        }
      }

      uploadSendShortcutLastAt = now;
      e.preventDefault();
      e.stopPropagation();

      if (isPlainEnterSendEvent(e)) {
        const enterNow = Date.now();
        if (enterSendDispatchInFlight && enterNow - enterSendDispatchLastAt < 400) {
          e.preventDefault();
          e.stopPropagation();
          ToolboxShell.appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=enter-send-lock');
          return true;
        }
        enterSendDispatchInFlight = true;
        enterSendDispatchLastAt = enterNow;

        const releaseEnterSendLock = () => {
          window.setTimeout(() => {
            enterSendDispatchInFlight = false;
          }, 350);
        };

        const enterSource = 'enter-hotkey';
        ToolboxShell.appendLog(
          `[TOOLBOX_HOTKEY][enter-send] trigger=enter source=${enterSource}`,
        );
        logSendHotkey('TRIGGER', `key=${formatSendHotkeyKey(e)} scope=enter source=${shortcutSource}`);
        ToolboxShell.appendLog(`[SEND_HOTKEY][TRIGGER_SEND] source=${enterSource}`);

        const sendBtn = rootElRef ? qs(UploadSelectors.sendMessageBtn, rootElRef) : null;
        if (sendBtn) {
          runUploadUiAction('send-message', sendBtn, enterSource, e);
          releaseEnterSendLock();
          return true;
        }

        void triggerSendFromToolbox(enterSource)
          .then((ok) => {
            if (ok) {
              logSendHotkey('DISPATCH_OK', `source=${enterSource}`);
            } else {
              logSendHotkey('DISPATCH_BLOCKED', `reason=send-flow-returned-false key=${formatSendHotkeyKey(e)}`);
            }
          })
          .catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] enter-hotkey trigger send failed', err);
            ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] error=${errText}`);
            setStatus(`快捷键发送失败：${errText}`, 'error');
            resetUploadSendShortcutState('enter-hotkey-catch', state.autoSendRunId);
            logSendHotkey('DISPATCH_BLOCKED', `reason=exception detail=${errText}`);
          })
          .finally(releaseEnterSendLock);

        return true;
      }

      logSendHotkey('TRIGGER', `key=${formatSendHotkeyKey(e)} scope=global source=${shortcutSource}`);

      return dispatchSendMessageShortcut(shortcutSource, e);
    }

    async function triggerSendHotkeyOnce() {
      const targetLabel = typeof getCopyThenShortcutTargetLabel === 'function'
        ? getCopyThenShortcutTargetLabel()
        : '';
      const combo = typeof getCopyThenShortcutTargetCombo === 'function'
        ? getCopyThenShortcutTargetCombo()
        : '';

      if (!combo) {
        setStatus('复制后目标快捷键未设置', 'error');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][REQUEST] reason=empty-target');
        return false;
      }

      setStatus(`正在请求 GUI 发送 ${targetLabel || combo}`, 'running');
      ToolboxShell.appendLog(`[SYSTEM_HOTKEY][REQUEST] combo=${combo}`);

      try {
        const result = await BridgeModule.sendSystemHotkey(combo);
        setStatus(`已请求 GUI 发送 ${targetLabel || combo}`, 'success');
        ToolboxShell.appendLog(
          `[SYSTEM_HOTKEY][DONE] combo=${combo} result=${JSON.stringify(result).slice(0, 200)}`,
        );
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[SYSTEM_HOTKEY][FAILED]', {
          error_type: err && err.name,
          error: errText,
          stack: err && err.stack,
        });
        setStatus(`GUI 快捷键失败：${errText}`, 'error');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][FAILED] error=' + errText);
        return false;
      }
    }

    function bindUploadSendShortcut() {
      if (uploadSendShortcutBound) {
        return;
      }
      uploadSendShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'document');
      }, true);
      window.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'window');
      }, true);
      const cfg = getShortcutConfig();
      const sendItem = cfg && cfg.sendMessage ? cfg.sendMessage : null;
      const sendLabel = sendItem && sendItem.label ? String(sendItem.label) : '-';
      const sendCtrl = sendItem && sendItem.ctrl ? '1' : '0';
      ToolboxShell.appendLog(
        `[SHORTCUT][bind] send=configurable Enter|Ctrl+Enter label=${sendLabel} ctrl=${sendCtrl}`,
      );
    }

    let uploadStartShortcutBound = false;
    let uploadStartShortcutLastAt = 0;

    function isUploadStartShortcutEvent(e) {
      const cfg = getShortcutConfig();
      const item = cfg && cfg.startUpload ? cfg.startUpload : null;

      if (typeof isShortcutConfigEventMatched === 'function') {
        return isShortcutConfigEventMatched(e, item);
      }

      return isShortcutEventMatched(e, item);
    }

    function shouldIgnoreUploadStartShortcutTarget(target) {
      if (typeof shouldSkipGlobalShortcutForToolboxEditing === 'function') {
        return shouldSkipGlobalShortcutForToolboxEditing(target);
      }

      const el = target instanceof Element ? target : null;
      if (!el) return false;

      const inToolbox = !!el.closest(`#${APP.rootId}, #${APP.panelId}`);
      if (!inToolbox) {
        return false;
      }

      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ].join(','));
    }

    function handleUploadStartShortcutKeydown(e, source = 'document') {
      if (!isUploadStartShortcutEvent(e)) {
        return;
      }

      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (shouldIgnoreUploadStartShortcutTarget(e.target)) {
        ToolboxShell.appendLog('[SHORTCUT][UPLOAD_START_SKIP] reason=toolbox-editing');
        return;
      }

      const now = Date.now();
      if (now - uploadStartShortcutLastAt < 800) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      uploadStartShortcutLastAt = now;

      e.preventDefault();
      e.stopPropagation();

      ToolboxShell.appendLog('[SHORTCUT][UPLOAD_START_TRIGGER]');

      void startUploadFromCurrentQueue({ source: 'shortcut' }).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] upload start shortcut failed', err);
        ToolboxShell.appendLog(`[SHORTCUT][UPLOAD_START_FAILED] error=${errText}`);
      });
    }

    function bindUploadStartShortcut() {
      if (uploadStartShortcutBound) {
        return;
      }

      uploadStartShortcutBound = true;

      document.addEventListener('keydown', (e) => {
        handleUploadStartShortcutKeydown(e, 'document');
      }, true);

      window.addEventListener('keydown', (e) => {
        handleUploadStartShortcutKeydown(e, 'window');
      }, true);

      ToolboxShell.appendLog('[SHORTCUT][bind] upload-start=configurable');
    }

    async function startUpload(options = {}) {
      const opts = options || {};
      const forceRestart = !!opts.forceRestart;
      const uploadReason = opts.reason || 'default';
      let finalResult = null;

      healStaleUploadRunningLockIfNeeded('startUpload');

      if (state.running) {
        if (forceRestart) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart] reason=${uploadReason} runId=${state.runId}`
          );
          cancelCurrentUploadRun(`startUpload-force-restart:${uploadReason}`);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart-wait-old-run] reason=${uploadReason} runId=${state.runId}`
          );
          await sleep(120);
          state.cancelled = false;
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-already-running]');
          return buildUploadSkipResult('already-running');
        }
      }

      if (!ensureActiveUploadGroupIdValid('start-upload')) {
        if (!state.groups.length) {
          setStatus('请先选择文件组');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-groups]');
          appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'no-groups' });
          return buildUploadSkipResult('no-active-group');
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-active-group]');
        appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return buildUploadSkipResult('no-active-group');
      }

      const activeFiles = getActiveGroupFiles();
      appendUploadGroupLog('START_UPLOAD', { phase: 'plan' });

      if (!activeFiles.length) {
        setStatus('当前项目没有文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-empty-queue]');
        return buildUploadSkipResult('empty-queue');
      }

      refreshQueueReadableState();
      await reconcileFailedItems();
      scheduleRenderUpload('startUpload:after-refresh');
      persistQueueThrottled('startUpload:after-refresh');

      logUploadQueueSnapshot('startUpload:after-refresh');

      const attachedCount = activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length;
      const uploadablePlan = activeFiles.filter((q) => {
        return q &&
          q.state !== UploadState.ATTACHED &&
          q.state !== UploadState.CANCELLED;
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][startUpload:plan] group=${getActiveGroupId() || '-'} total=${activeFiles.length} attached=${attachedCount} uploadable=${uploadablePlan.length}`
      );

      const uploadableTargets = activeFiles.filter(isUploadItemUploadable);
      const missingTargets = activeFiles.filter(isUploadItemMissingSource);

      uploadableTargets.forEach((q) => {
        logUploadItemSource('startUpload:uploadable', q);
      });

      missingTargets.forEach((q) => {
        logUploadItemSource('startUpload:missing', q, {
          reason: 'not readable before upload',
        });
      });

      if (!uploadableTargets.length) {
        const totalCount = activeFiles.filter(Boolean).length;

        if (totalCount > 0 && attachedCount === totalCount) {
          setStatus(`当前分组文件已全部绑定：${attachedCount}/${totalCount}；再次点击「开始上传」将再次绑定`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-all-attached] attached=${attachedCount} total=${totalCount}`,
          );
          return buildUploadResult(attachedCount, 0, false, totalCount, {
            skipped: true,
            reason: 'all-attached',
          });
        }

        scheduleRenderUpload('startUpload:skip-no-targets');
        setStatus(`当前没有可上传文件，缺少 ${missingTargets.length} 个，请重新绑定或重新拖入`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:skip-no-targets] missing=${missingTargets.length}`,
        );
        return buildUploadSkipResult('no-uploadable-targets', {
          failed: missingTargets.length,
          total: totalCount,
        });
      }

      const missingChanged = markMissingLocalFiles([
        ...uploadableTargets,
        ...missingTargets,
      ]);

      if (missingChanged) {
        scheduleRenderUpload('startUpload:missing-marked');
        persistQueueThrottled('startUpload:missing-marked');
      }

      if (missingTargets.length) {
        ToolboxShell.appendLog(
          `本次跳过 ${missingTargets.length} 个缺少文件项，继续上传 ${uploadableTargets.length} 个可上传文件`
        );
      }

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      const runId = state.runId;
      state.uploadAbortController = new AbortController();
      setUploadButtonState('uploading', 'start-upload');

      scheduleRenderUpload('startUpload:before-loop');

      ToolboxShell.appendLog(`开始批量上传：当前：${getActiveGroupName()}，文件数 ${uploadableTargets.length}`);

      uploadableTargets.forEach((q) => {
        if (
          q.state === UploadState.CANCELLED ||
          q.state === UploadState.FAILED
        ) {
          q.state = UploadState.IDLE;
          q.message = '';
          q.uploadName = '';
        }
      });

      persistQueueThrottled('startUpload:before-upload');

      const total = uploadableTargets.length;

      try {
        for (let i = 0; i < uploadableTargets.length; i += 1) {
          if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
            state.cancelled = true;
            break;
          }

          if (state.cancelled || runId !== state.runId) {
            break;
          }

          const q = uploadableTargets[i];
          state.activeId = q.id;

          setStatus(`正在上传 ${getActiveGroupName()} ${i + 1}/${total}：${q.name}`);
          ToolboxShell.appendLog(`批量上传 ${i + 1}/${total} 个：${q.name}`);

          await uploadOne(q, i + 1, total, {
            runId,
            signal: state.uploadAbortController.signal,
          });

          if (state.cancelled || runId !== state.runId) {
            break;
          }
        }

        let settledTargets = resolveUploadTargets(uploadableTargets);

        settledTargets.forEach((item) => {
          if (isUploadUnfinishedState(item.state)) {
            updateItem(item.id, {
              state: UploadState.FAILED,
              message: '上传流程结束时仍未完成',
            });
          }
        });

        await reconcileFailedItems();

        settledTargets = resolveUploadTargets(uploadableTargets);

        const result = countUploadResult([...settledTargets, ...missingTargets]);

        if (areAllUploadTargetsSettled(settledTargets)) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:all-targets-settled] success=${result.success} failed=${result.failed}`
          );
        }

        const finalTargets = [...settledTargets, ...missingTargets];
        const allAttached = finalTargets.every((q) => q && q.state === UploadState.ATTACHED);

        if (!allAttached) {
          await waitUntilComposerUploadIdle({
            runId,
            signal: state.uploadAbortController && state.uploadAbortController.signal,
            timeoutMs: 3000,
          });
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-idle-wait] 所有文件已确认 ATTACHED，跳过长时间空闲等待');
        }
      } finally {
        stopDuplicateWatcher(3000);

        if (runId === state.runId || state.cancelled) {
          const stillRunningItems = state.queue.filter((item) => {
            return item && isUploadUnfinishedState(item.state);
          });

          if (stillRunningItems.length) {
            stillRunningItems.forEach((item) => {
              item.state = UploadState.FAILED;
              item.message = '上传流程超时或未正常结束，请重新点击上传';
            });

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][startUpload:force-clear-running-items] count=${stillRunningItems.length}`
            );
          }

          state.running = false;
          state.activeId = '';
          state.uploadAbortController = null;
          setUploadButtonState('idle', 'upload-finished-or-reset');

          const settledTargets = resolveUploadTargets(uploadableTargets);
          const result = countUploadResult([...settledTargets, ...missingTargets]);

          renderUploadButtonsOnly();
          render();

          const uploadStatusType = state.cancelled
            ? 'warn'
            : result.failed > 0
              ? 'error'
              : 'success';
          const uploadStatusText = state.cancelled
            ? `已停止上传：成功 ${result.success}，失败 ${result.failed}`
            : result.failed > 0
              ? `上传未全部完成：成功 ${result.success}，失败 ${result.failed}`
              : `上传完成：成功 ${result.success}，失败 0`;
          setStatus(uploadStatusText, uploadStatusType);

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:finalize] success=${result.success} failed=${result.failed} running=${state.running} groupId=${state.activeGroupId || '-'}`,
          );

          persistQueueInBackground('startUpload:finalize');

          finalResult = buildUploadResult(
            result.success,
            result.failed,
            state.cancelled,
            uploadableTargets.length + missingTargets.length,
          );
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-finalize-run-mismatch] runId=${runId} currentRunId=${state.runId} cancelled=${state.cancelled ? 1 : 0}`
          );
        }

        window.setTimeout(() => {
          const healed = healStaleUploadRunningLockIfNeeded(`startUpload:finally:${uploadReason}`);

          if (healed) {
            render();
            persistQueueInBackground(`startUpload:finally-healed:${uploadReason}`);
          }
        }, 300);
      }

      return finalResult || buildUploadSkipResult('upload-not-finalized');
    }

    function isQueueItemAlreadyUploaded(q) {
      if (!q) return true;
      if (q.status === 'uploaded') return true;
      return q.state === UploadState.ATTACHED;
    }

    function isFlaskLocalDirectItem(item) {
      if (!item) return false;
      const source = String(
        item.source || item.origin || item.kind || item.sourceKind || '',
      ).trim();
      return (
        source === 'local_direct'
        || source === 'flask'
        || source === 'flask_local_direct'
        || item.local_direct === true
        || item.flask_local_direct === true
        || !!item.file_id
        || !!item.download_url
      );
    }

    function normalizeFlaskFilesFromBridge(list) {
      const rows = Array.isArray(list) ? list : [];
      return rows
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          ...item,
          source: 'flask_local_direct',
          status: item.status || 'pending',
        }));
    }

    function applyBridgeUploadFiles(patch) {
      const payload = patch && typeof patch === 'object' ? patch : {};
      if (!Object.prototype.hasOwnProperty.call(payload, 'upload_files')) {
        return;
      }
      const incoming = normalizeFlaskFilesFromBridge(payload.upload_files);
      state.flaskFiles = incoming;
      ToolboxShell.appendLog(
        `[UPLOAD][FLASK_SYNC] count=${incoming.length} names=${incoming.map((f) => f.name || '-').join('|')}`,
      );
      scheduleRenderUpload('bridge-upload-files-sync');
    }

    function getPendingUploadItems() {
      const items = [];
      const seen = new Set();

      const pushItem = (item, source) => {
        if (!item) return;
        const key = [
          source,
          item.id || item.file_id || '',
          item.name || item.filename || '',
          item.download_url || '',
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          ...item,
          source: source || item.source || 'browser_file',
        });
      };

      for (const item of state.queue || []) {
        if (!item) continue;

        if (isQueueItemAlreadyUploaded(item)) {
          continue;
        }

        const attemptable = hasAttemptableUploadSource(item);
        const flaskDirect = isFlaskLocalDirectItem(item);

        if (!attemptable && !flaskDirect) {
          ToolboxShell.appendLog(
            `[UPLOAD][PENDING_FILTERED] name=${item.name || item.filename || '-'} state=${item.state || '-'} source=${item.source || '-'} reason=no-attemptable-source`,
          );
          continue;
        }

        pushItem(item, item.source || 'browser_file');
      }

      for (const item of state.flaskFiles || []) {
        if (!item) continue;
        if (item.status === 'uploaded') continue;
        if (!isFlaskLocalDirectItem(item)) continue;
        pushItem(item, 'flask_local_direct');
      }

      return items;
    }

    function getUploadCountStats() {
      const localFiles = (state.flaskFiles || []).filter(
        (item) => item && item.status !== 'uploaded',
      );
      const pendingItems = getPendingUploadItems();
      const uploadingCount = state.running
        ? pendingItems.length
        : 0;

      return {
        localFileCount: localFiles.length,
        pendingCount: pendingItems.length,
        uploadingCount,
      };
    }

    async function resolveUploadFileObject(item) {
      if (!item) {
        throw new Error('空文件项，无法解析上传对象');
      }

      if (item.file instanceof File) {
        return item.file;
      }

      if (item.blob instanceof Blob) {
        return new File(
          [item.blob],
          item.name || item.filename || 'upload.bin',
          { type: item.mime_type || item.type || 'application/octet-stream' },
        );
      }

      if (item.id && (item.fileHandle || item.file || item.blob)) {
        const fresh = await readFreshFile(item);
        const normalized = normalizeToNativeFile(fresh, item.name || 'upload.bin');
        if (normalized) {
          return normalized;
        }
        if (fresh instanceof Blob) {
          return new File(
            [fresh],
            item.name || 'upload.bin',
            { type: item.mime_type || item.type || 'application/octet-stream' },
          );
        }
        return fresh;
      }

      const fileName = item.name || item.filename || 'upload.bin';
      const downloadUrl = String(
        item.download_url || item.url || item.file_url || '',
      ).trim();

      if (!downloadUrl) {
        throw new Error(`文件缺少 download_url，无法从 Flask 获取内容：${fileName}`);
      }

      const response = await fetch(downloadUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(
          `下载文件失败：${response.status} ${response.statusText} ${fileName}`,
        );
      }

      const blob = await response.blob();

      return new File(
        [blob],
        fileName,
        { type: item.mime_type || blob.type || 'application/octet-stream' },
      );
    }

    function findChatGPTFileInput() {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (inputs.length > 0) {
        return inputs[0];
      }

      const attachButtons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      ).filter((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        return (
          text.includes('添加')
          || text.includes('上传')
          || text.includes('Attach')
          || text.includes('Upload')
          || aria.includes('Attach')
          || aria.includes('Upload')
          || aria.includes('添加')
          || aria.includes('上传')
          || title.includes('Attach')
          || title.includes('Upload')
        );
      });

      if (attachButtons.length > 0) {
        attachButtons[0].click();
      }

      return document.querySelector('input[type="file"]');
    }

    async function uploadFilesToChatGPT(files, options = {}) {
      const cleanFiles = (files || []).filter(Boolean);
      if (!cleanFiles.length) {
        ToolboxShell.showToast('没有待上传文件', 'warn', 1800);
        return false;
      }

      const opts = options && typeof options === 'object' ? options : {};
      const signal = opts.signal || null;
      const isCancelled = typeof opts.isCancelled === 'function'
        ? opts.isCancelled
        : () => !!(signal && signal.aborted);

      if (isCancelled()) {
        throw new Error('upload-cancelled');
      }

      if (
        typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.attachFilesByFileInput === 'function'
      ) {
        const uploadResult = await ComposerApi.attachFilesByFileInput(cleanFiles, 12000, {
          signal,
          isCancelled,
        });
        if (uploadResult && uploadResult.ok) {
          return true;
        }
        const reason = (uploadResult && uploadResult.reason)
          ? uploadResult.reason
          : 'attachFilesByFileInput 未成功';
        throw new Error(reason);
      }

      const input = findChatGPTFileInput();
      if (!input) {
        throw new Error('未找到 ChatGPT 文件输入框 input[type=file]');
      }

      const dataTransfer = new DataTransfer();
      for (const file of cleanFiles) {
        dataTransfer.items.add(file);
      }

      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    }

    function releaseUploadPayload(item, reason) {
      if (!item) return;
      const name = item.name || '-';
      const id = item.id || item.file_id || '-';
      let released = false;

      if (item.file) {
        item.file = null;
        released = true;
      }

      if (item.blob) {
        item.blob = null;
        released = true;
      }

      if (item.arrayBuffer) {
        item.arrayBuffer = null;
        released = true;
      }

      if (item.objectUrl) {
        try {
          URL.revokeObjectURL(item.objectUrl);
        } catch (revokeErr) {
          const errText = revokeErr && revokeErr.message ? revokeErr.message : String(revokeErr);
          console.error('[ChatGPT toolbox] releaseUploadPayload revokeObjectURL failed', revokeErr);
          ToolboxShell.appendLog(`[UPLOAD][RELEASE_LARGE_OBJECTS][revoke-failed] name=${name} error=${errText}`);
        }
        item.objectUrl = '';
        released = true;
      }

      if (released) {
        ToolboxShell.appendLog(
          `[UPLOAD][RELEASE_LARGE_OBJECTS] name=${name} reason=${reason || 'uploaded'}`,
        );
      }
    }

    function markPendingItemsUploaded(pendingItems) {
      const flaskIds = [];

      for (const item of pendingItems || []) {
        if (!item) continue;

        if (item.source === 'flask_local_direct' || item.file_id) {
          item.status = 'uploaded';
          if (item.file_id) {
            flaskIds.push(item.file_id);
          }
          releaseUploadPayload(item, 'flask-uploaded');
          continue;
        }

        if (item.id) {
          updateItem(item.id, {
            state: UploadState.ATTACHED,
            message: '已绑定到输入框',
          });
          releaseUploadPayload(item, 'attached-to-input');
        }
      }

      if (flaskIds.length) {
        state.flaskFiles = (state.flaskFiles || []).map((row) => {
          if (!row || !row.file_id) return row;
          if (!flaskIds.includes(row.file_id)) return row;
          return {
            ...row,
            status: 'uploaded',
          };
        });
      }
    }

    function detectComposerHasUploadPayload() {
      let composerHasUploadPayload = false;

      if (typeof ComposerApi !== 'undefined') {
        if (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function') {
          composerHasUploadPayload = composerHasUploadPayload
            || !!ComposerApi.hasVisibleComposerAttachmentPayload();
        }

        if (typeof ComposerApi.countAttachmentChips === 'function') {
          composerHasUploadPayload = composerHasUploadPayload
            || ComposerApi.countAttachmentChips() > 0;
        }
      }

      return composerHasUploadPayload;
    }

    async function startUploadForAutoQueue(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const uploadSource = String(opts.source || 'autoq').trim() || 'autoq';
      const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
      const forceReupload = opts.forceReupload === true;
      const maxFilesRaw = Number(opts.maxFiles);
      const maxFiles = Number.isFinite(maxFilesRaw) && maxFilesRaw > 0
        ? Math.floor(maxFilesRaw)
        : 0;

      ToolboxShell.appendLog(
        `[UPLOAD][AUTOQ_START] source=${uploadSource} forceReupload=${forceReupload ? 1 : 0} maxFiles=${maxFiles || '-'}`,
      );

      if (!forceReupload) {
        // 兼容旧行为：仅重置已绑定，避免影响其它入口调用
        resetQueueItemsForUpload({
          forceResetAttached: true,
          reason: uploadSource,
        });
        resetFlaskFilesForUpload(`startUploadForAutoQueue:${uploadSource}`);

        const pendingItems = getPendingUploadItems();
        const pendingCount = Array.isArray(pendingItems) ? pendingItems.length : 0;

        if (pendingCount > 0) {
          return startUploadFromCurrentQueue({
            source: uploadSource,
            shouldStop,
            maxFiles,
          });
        }

        if (detectComposerHasUploadPayload()) {
          ToolboxShell.appendLog(
            `[UPLOAD][AUTOQ_SKIP] source=${uploadSource} reason=composer-already-has-file`,
          );

          return buildQueueUploadResult({
            ok: true,
            reason: 'composer-already-has-file',
          });
        }

        ToolboxShell.appendLog(
          `[UPLOAD][AUTOQ_SKIP] source=${uploadSource} reason=no-files pending=0 composer=0`,
        );

        return buildQueueUploadResult({
          ok: true,
          reason: 'no-files',
        });
      }

      if (forceReupload) {
        const resetCount = Number(resetQueueItemsForUpload({
          forceResetAttached: true,
          forceResetUploaded: true,
          forceResetDone: true,
          reason: uploadSource,
        })) || 0;

        const activeGroupResetCount = Number(
          forceResetActiveGroupFilesForUpload(uploadSource),
        ) || 0;

        let flaskResetCount = 0;
        try {
          if (typeof resetFlaskFilesForUpload === 'function') {
            flaskResetCount = resetFlaskFilesForUpload(`startUploadForAutoQueue:${uploadSource}`) ? 1 : 0;
          }
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox] resetFlaskFilesForUpload failed', error);
          ToolboxShell.appendLog(`[UPLOAD][AUTOQ_FORCE_RESET][FLASK_FAILED] source=${uploadSource} error=${errText}`);
        }

        ToolboxShell.appendLog(
          `[UPLOAD][AUTOQ_FORCE_RESET] source=${uploadSource} resetCount=${resetCount} activeGroupResetCount=${activeGroupResetCount} flaskReset=${flaskResetCount}`,
        );
      }

      const pendingItems = getPendingUploadItems();
      const pendingCount = Array.isArray(pendingItems) ? pendingItems.length : 0;

      ToolboxShell.appendLog(
        `[UPLOAD][AUTOQ_PENDING_AFTER_RESET] source=${uploadSource} pendingUploadCount=${pendingCount}`,
      );

      if (pendingCount <= 0) {
        ToolboxShell.appendLog(
          `[UPLOAD][AUTOQ_NO_FILES_AFTER_RESET] source=${uploadSource} reason=no-readable-files-after-force-reset`,
        );

        return buildQueueUploadResult({
          ok: true,
          skipped: true,
          reason: 'no-readable-files-after-force-reset',
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        });
      }

      return startUploadFromCurrentQueue({
        source: uploadSource,
        shouldStop,
        maxFiles,
      });
    }

    async function startUploadFromCurrentQueue(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const uploadSource = String(opts.source || 'button').trim() || 'button';
      const parentTask = String(opts.parentTask || '').trim();
      const cycleIndex = Number(opts.cycleIndex) || 0;
      const isChildUpload = parentTask.length > 0;
      const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : null;
      const maxFilesRaw = Number(opts.maxFiles);
      const maxFiles = Number.isFinite(maxFilesRaw) && maxFilesRaw > 0
        ? Math.floor(maxFilesRaw)
        : 0;

      const checkShouldStop = () => {
        if (shouldStop && shouldStop()) {
          if (isChildUpload) {
            ToolboxShell.appendLog('[UPLOAD_CHILD][STOP_CHECK] reason=shouldStop');
          }
          return true;
        }

        if (isChildUpload) {
          const task = state.uploadTask;
          const cancelRequested = !!(task && task.cancelRequested);
          const aborted = !!(
            task
            && task.abortController
            && task.abortController.signal
            && task.abortController.signal.aborted
          );

          if (cancelRequested) {
            ToolboxShell.appendLog('[UPLOAD_CHILD][STOP_CHECK] reason=cancelRequested');
            return true;
          }
          if (aborted) {
            ToolboxShell.appendLog('[UPLOAD_CHILD][STOP_CHECK] reason=aborted');
            return true;
          }

          // 明确：child upload 不读取全局取消状态
          if (state.uploadCancelRequested || state.uploadAbortController) {
            ToolboxShell.appendLog('[UPLOAD_CHILD][STOP_CHECK] reason=globalIgnored');
          }
          return false;
        }

        if (state.uploadCancelRequested) {
          return true;
        }
        if (
          state.uploadAbortController
          && state.uploadAbortController.signal
          && state.uploadAbortController.signal.aborted
        ) {
          return true;
        }

        return false;
      };

      if (!isChildUpload && state.running) {
        setStatus('正在上传中，请稍候', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=already-running`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'already-running',
        });
      }

      if (isChildUpload && !state.uploadTask) {
        state.uploadTask = {
          phase: 'idle',
          runId: '',
          cancelRequested: false,
          abortController: null,
        };
      }

      const childUploadRunId = isChildUpload ? createUploadTaskRunId('upload_child') : '';
      if (isChildUpload) {
        state.uploadTask.phase = 'uploading';
        state.uploadTask.runId = childUploadRunId;
        state.uploadTask.parentTask = parentTask;
        state.uploadTask.source = uploadSource;
        state.uploadTask.cycleIndex = cycleIndex;
        state.uploadTask.cancelRequested = false;
        state.uploadTask.abortController = new AbortController();
        scheduleRenderUpload(`startUpload:child:${uploadSource}`);
      }

      if (checkShouldStop()) {
        ToolboxShell.appendLog(
          `[UPLOAD][CANCELLED] source=${uploadSource}`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'cancelled',
          cancelled: true,
        });
      }

      // 重置已绑定的文件，允许再次上传
      resetQueueItemsForUpload({ forceResetAttached: true });
      resetFlaskFilesForUpload(`startUploadFromCurrentQueue:${uploadSource}`);

      const allPendingItems = getPendingUploadItems();
      const pendingItems = maxFiles > 0
        ? allPendingItems.slice(0, maxFiles)
        : allPendingItems;

      const skippedByMaxFiles = Math.max(0, allPendingItems.length - pendingItems.length);

      if (!pendingItems.length) {
        const stats = getUploadCountStats();
        const hint = '没有待上传文件：当前油猴上传队列为空，且没有可下载的 Flask 本地文件。';
        ToolboxShell.showToast(hint, 'warn', 2600);
        console.warn('[UPLOAD][NO_PENDING_FILES]', {
          uploadQueue: state.queue,
          flaskFiles: state.flaskFiles,
          stats,
        });
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=no-files queue=${(state.queue || []).length} flask=${(state.flaskFiles || []).length}`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'no-files',
        });
      }

      if (!isChildUpload) {
        state.uploadCancelRequested = false;
        state.uploadAbortController = new AbortController();
        state.running = true;
        setUploadButtonState('uploading', 'start-upload');
        scheduleRenderUpload('startUploadFromCurrentQueue:start');
      }

      const resolveUploadAbortSignal = () => {
        if (isChildUpload) {
          return state.uploadTask && state.uploadTask.abortController
            ? state.uploadTask.abortController.signal
            : null;
        }
        return state.uploadAbortController
          ? state.uploadAbortController.signal
          : null;
      };

      try {
        const statusText = isChildUpload && cycleIndex > 0
          ? `第 ${cycleIndex} 轮：正在自动上传…`
          : '正在上传…';
        setStatus(statusText, 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START] source=${uploadSource} parentTask=${parentTask || '-'} pending=${pendingItems.length} allPending=${allPendingItems.length} maxFiles=${maxFiles || '-'} skippedByMaxFiles=${skippedByMaxFiles}`,
        );

        const files = [];
        for (const item of pendingItems) {
          if (checkShouldStop()) {
            ToolboxShell.appendLog(
              `[UPLOAD][CANCELLED] source=${uploadSource}`,
            );
            return buildQueueUploadResult({
              ok: false,
              reason: 'cancelled',
              cancelled: true,
            });
          }

          const file = await resolveUploadFileObject(item);
          files.push(file);
        }

        if (checkShouldStop()) {
          ToolboxShell.appendLog(
            `[UPLOAD][CANCELLED] source=${uploadSource}`,
          );
          return buildQueueUploadResult({
            ok: false,
            reason: 'cancelled',
            cancelled: true,
          });
        }

        const uploadSignal = resolveUploadAbortSignal();
        await uploadFilesToChatGPT(files, {
          signal: uploadSignal,
          isCancelled: () => checkShouldStop(),
        });
        markPendingItemsUploaded(pendingItems);

        if (!isChildUpload) {
          scheduleRenderUpload('startUploadFromCurrentQueue:done');
        }
        persistQueueThrottled('startUploadFromCurrentQueue:done');

        if (!isChildUpload) {
          ToolboxShell.showToast(
            `已提交 ${files.length} 个文件到 ChatGPT 上传框`,
            'success',
            2200,
          );
        }
        console.log('[UPLOAD][DONE]', files.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })));
        const doneStatus = isChildUpload && cycleIndex > 0
          ? `第 ${cycleIndex} 轮自动上传：已提交 ${files.length} 个文件`
          : `已提交 ${files.length} 个文件到 ChatGPT`;
        setStatus(doneStatus, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD][DONE] source=${uploadSource} parentTask=${parentTask || '-'} uploaded=${files.length} failed=0 skipped=${skippedByMaxFiles}`,
        );
        if (!isChildUpload) {
          recordUploadSuccess(files.length);
        }

        return buildQueueUploadResult({
          ok: true,
          uploadedCount: files.length,
          failedCount: 0,
          skippedCount: skippedByMaxFiles,
          reason: '',
        });
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        if (checkShouldStop() || errText === 'upload-cancelled') {
          ToolboxShell.appendLog(
            `[UPLOAD][CANCELLED] source=${uploadSource}`,
          );
          return buildQueueUploadResult({
            ok: false,
            reason: 'cancelled',
            cancelled: true,
          });
        }

        console.error('[UPLOAD][FAILED]', {
          source: uploadSource,
          error_type: errName,
          error: errText,
          stack: errStack,
        });
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=${errText}`,
        );
        if (!isChildUpload) {
          ToolboxShell.showToast(`上传失败：${errText}`, 'error', 3200);
        }
        setStatus(
          isChildUpload && cycleIndex > 0
            ? `第 ${cycleIndex} 轮自动上传失败：${errText}`
            : `上传失败：${errText}`,
          'error',
        );

        return buildQueueUploadResult({
          ok: false,
          uploadedCount: 0,
          failedCount: pendingItems.length,
          skippedCount: 0,
          reason: errText,
        });
      } finally {
        if (isChildUpload) {
          if (state.uploadTask && state.uploadTask.runId === childUploadRunId) {
            state.uploadTask.phase = 'idle';
            state.uploadTask.parentTask = '';
            state.uploadTask.source = '';
            state.uploadTask.cycleIndex = 0;
            state.uploadTask.runId = '';
            state.uploadTask.cancelRequested = false;
          }
          scheduleRenderUpload(`startUploadFromCurrentQueue:child-finally:${uploadSource}`);
        } else {
          state.running = false;
          state.uploadCancelRequested = false;
          if (state.uploadAbortController) {
            state.uploadAbortController = null;
          }
          setUploadButtonState('idle', 'upload-finished-or-reset');
          scheduleRenderUpload('startUploadFromCurrentQueue:finally');
        }
      }
    }

    async function handleStartUploadClick(source = 'button') {
      const queueResult = await startUploadFromCurrentQueue({ source });
      return toLegacyUploadResult(queueResult);
    }

    async function triggerStartUpload(source = 'button') {
      return await handleStartUploadClick(source);
    }

    function getLatestAssistantTextForCopyCheck() {
      try {
        if (typeof getLatestAssistantMessageForCopy === 'function') {
          const cachedPick = getLatestAssistantMessageForCopy({ forceRefresh: false });
          if (cachedPick && cachedPick.ok && cachedPick.text) {
            return String(cachedPick.text).trim();
          }
        }

        const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
          ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
          : ChatMessageExtractor.buildRecords({
            includeEmpty: false,
          });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

        if (!picked.ok || !picked.record) {
          return '';
        }

        return ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        const stack = err && err.stack ? String(err.stack).slice(0, 400) : '';
        console.error('[ChatGPT toolbox] getLatestAssistantTextForCopyCheck failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:assistant-text-check-failed] error=${errText} stack=${stack}`);
        return '';
      }
    }

    function hasRealStopButtonForCopy() {
      if (typeof hasRealChatGPTStopGeneratingButton === 'function') {
        return hasRealChatGPTStopGeneratingButton();
      }

      if (typeof findRealChatGPTStopGeneratingButton === 'function') {
        return !!findRealChatGPTStopGeneratingButton();
      }

      return false;
    }

    function normalizeUploadUiAction(action) {
      const key = String(action || '').trim();
      const aliases = {
        'copy-last-message': 'copy-only',
        'copy-continue': 'copy-and-continue',
        'copy-hotkey-once': 'copy-and-hotkey',
        'toggle-upload-manage': 'toggle-upload-group-manage',
        'cancel-send': 'send-message',
        'cancel-wait-reply': 'send-message',
        'send': 'send-message',
        'send-once': 'send-message',
      };
      return aliases[key] || key;
    }

    function runUploadUiAction(action, button, source, event) {
      const src = source || 'unknown';
      const normalizedAction = normalizeUploadUiAction(action);

      if (!action || !button) {
        return false;
      }

      try {
        let phase = '-';
        let legacyRunning = '-';
        if (normalizedAction === 'start-upload') {
          syncUploadTaskFromLegacyState();
          phase = state.uploadTask ? String(state.uploadTask.phase || 'idle') : 'idle';
          legacyRunning = state.running ? '1' : '0';
        } else if (normalizedAction === 'send-message') {
          syncSendTaskFromLegacyState();
          phase = state.sendTask ? String(state.sendTask.phase || 'idle') : 'idle';
          legacyRunning = uploadSendShortcutRunning ? '1' : '0';
        } else if (normalizedAction === 'copy-only') {
          syncCopyTaskFromLegacyState();
          phase = state.copyTask ? String(state.copyTask.phase || 'idle') : 'idle';
          legacyRunning = (copyLastReplyTaskRunning || copyLastMessageTaskRunning) ? '1' : '0';
        } else if (normalizedAction === 'copy-and-continue') {
          syncCopyContinueTaskFromLegacyState();
          phase = state.copyContinueTask ? String(state.copyContinueTask.phase || 'idle') : 'idle';
          legacyRunning = copyContinueTaskRunning ? '1' : '0';
        } else if (normalizedAction === 'copy-and-hotkey') {
          phase = copyHotkeyOnceTaskRunning ? 'running' : 'idle';
          legacyRunning = copyHotkeyOnceTaskRunning ? '1' : '0';
        } else if (normalizedAction === 'copy-hotkey-continue') {
          phase = state.copyHotkeyContinueTask ? String(state.copyHotkeyContinueTask.phase || 'idle') : 'idle';
          legacyRunning = copyHotkeyContinueTaskRunning ? '1' : '0';
        } else if (normalizedAction === 'loop-copy-hotkey-continue') {
          phase = state.copyHotkeyContinueLoopTask ? String(state.copyHotkeyContinueLoopTask.phase || 'idle') : 'idle';
          legacyRunning = copyHotkeyContinueLoopRunning ? '1' : '0';
        } else if (normalizedAction === 'loop-copy-hotkey-continue-upload-verify') {
          phase = state.copyHotkeyUploadVerifyLoopTask ? String(state.copyHotkeyUploadVerifyLoopTask.phase || 'idle') : 'idle';
          legacyRunning = copyHotkeyUploadVerifyLoopRunning ? '1' : '0';
        }

        const finalText = String(button.textContent || '').trim() || '-';
        ToolboxShell.appendLog(
          `[BUTTON_STATE][SOURCE] action=${normalizedAction} taskPhase=${phase} legacyRunning=${legacyRunning} finalText=${finalText}`,
        );
      } catch (err) {
        console.error('[BUTTON_STATE][SOURCE] failed', err);
      }

      if (event) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      if (typeof button.blur === 'function') {
        button.blur();
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][hit] action=${normalizedAction} raw=${action} source=${src} disabled=${button.disabled ? '1' : '0'}`,
      );

      if (typeof ToolboxShell.suspendEdgeAutoHide === 'function') {
        ToolboxShell.suspendEdgeAutoHide(`run-action:${action}:${src}`, 3000);
      }

      if (normalizedAction === 'toggle-upload-group-manage') {
        const ok = toggleGroupManagePanel(src);
        if (!ok) {
          setStatus('文件组管理面板打开失败，请查看日志', 'error');
        }
        return true;
      }

      if (normalizedAction === 'create-upload-group') {
        runUploadActionPromise(createGroupInline(), '新建分组');
        return true;
      }

      if (normalizedAction === 'rename-upload-group') {
        runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        return true;
      }

      if (normalizedAction === 'clear-upload-group') {
        runUploadActionPromise(clearActiveGroupQueueInline(button), '清空当前分组');
        return true;
      }

      if (normalizedAction === 'delete-upload-group') {
        runUploadActionPromise(deleteActiveGroupInline(button), '删除当前分组');
        return true;
      }

      if (normalizedAction === 'send-message') {
        syncSendTaskPhase();
        const activeSendPhase = getSendTaskPhase();
        const btnRawAction = button instanceof HTMLElement
          ? String(button.dataset.action || '').trim()
          : '';
        const btnSendState = button instanceof HTMLElement
          ? String(button.dataset.sendState || '').trim()
          : '';

        ToolboxShell.appendLog(
          `[SEND_MESSAGE][BUTTON_HIT] source=${src} action=${btnRawAction} phase=${activeSendPhase} waitingReply=${state.waitingReply ? 1 : 0} waitingSend=${isWaitingSendActive() ? 1 : 0}`,
        );

        const isCancelIntent = (
          btnRawAction === 'cancel-send'
          || btnRawAction === 'cancel-wait-reply'
          || btnSendState === 'waiting-reply'
          || btnSendState === 'sending'
        );

        if (isCancelIntent) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][send-message:cancel] source=${src} phase=${activeSendPhase} action=${btnRawAction}`,
          );
          ToolboxShell.appendLog(`[SEND_MESSAGE][BUTTON_CANCEL] source=${src}`);
          cancelWaitingSend(src);
          return true;
        }

        if (activeSendPhase !== 'idle' && !state.waitingReply) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][send-message:skip] source=${src} phase=${activeSendPhase}`,
          );
          return true;
        }
      }

      if (normalizedAction === 'start-upload') {
        syncUploadTaskFromLegacyState();

        const uploadPhase = state.uploadTask
          ? String(state.uploadTask.phase || 'idle')
          : 'idle';

        const uploadCancellable = state.running
          || uploadPhase === 'uploading'
          || uploadPhase === 'cancelling';

        if (uploadCancellable) {
          cancelUploadFlow('button-click:start-upload');
          return true;
        }
      }

      const copyHotkeyContinueTaskForDebounce = ensureCopyHotkeyContinueTask();
      const copyHotkeyLoopTaskForDebounce = ensureCopyHotkeyContinueLoopTask();
      const copyHotkeyUploadVerifyLoopTaskForDebounce = ensureCopyHotkeyUploadVerifyLoopTask();
      const skipActionDebounce = (
        normalizedAction === 'copy-hotkey-continue'
        && COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES.has(copyHotkeyContinueTaskForDebounce.phase)
      ) || (
        normalizedAction === 'loop-copy-hotkey-continue'
        && (
          COPY_HOTKEY_LOOP_STOP_PHASES.has(copyHotkeyLoopTaskForDebounce.phase)
          || copyHotkeyContinueLoopRunning
        )
      ) || (
        normalizedAction === 'loop-copy-hotkey-continue-upload-verify'
        && (
          COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES.has(copyHotkeyUploadVerifyLoopTaskForDebounce.phase)
          || copyHotkeyUploadVerifyLoopRunning
        )
      );

      if (!skipActionDebounce) {
        const actionDebounceKey = resolveUploadActionDebounceKey(normalizedAction, src);
        if (actionDebounceKey && shouldSkipAction(actionDebounceKey, 300)) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][skip] action=${actionDebounceKey} raw=${normalizedAction} source=${src} reason=action-debounce`,
          );
          return true;
        }
      }

      if (shouldSkipUploadUiAction(normalizedAction, src, 350)) {
        return true;
      }

      if (normalizedAction === 'copy-and-continue') {
        const busyState = clearStaleUploadButtonBusy(button, {
          action: 'copy-continue',
          source: src,
        });
        if (busyState.skipped) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][skip] action=copy-and-continue source=${src} reason=button-busy busyMs=${busyState.busyMs}`,
          );
          return true;
        }
      }

      const copyHotkeyContinueTask = ensureCopyHotkeyContinueTask();
      const copyHotkeyLoopTask = ensureCopyHotkeyContinueLoopTask();
      const copyHotkeyContinueCancellable = normalizedAction === 'copy-hotkey-continue'
        && COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES.has(copyHotkeyContinueTask.phase);
      const copyHotkeyLoopCancellable = normalizedAction === 'loop-copy-hotkey-continue'
        && (
          COPY_HOTKEY_LOOP_STOP_PHASES.has(copyHotkeyLoopTask.phase)
          || copyHotkeyContinueLoopRunning
        );
      const copyHotkeyUploadVerifyLoopCancellable = normalizedAction === 'loop-copy-hotkey-continue-upload-verify'
        && (
          COPY_HOTKEY_UPLOAD_VERIFY_LOOP_STOP_PHASES.has(copyHotkeyUploadVerifyLoopTaskForDebounce.phase)
          || copyHotkeyUploadVerifyLoopRunning
        );

      if (
        button.disabled
        && normalizedAction !== 'copy-only'
        && normalizedAction !== 'copy-and-continue'
        && normalizedAction !== 'send-message'
        && !copyHotkeyContinueCancellable
        && !copyHotkeyLoopCancellable
        && !copyHotkeyUploadVerifyLoopCancellable
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][ignored] action=${normalizedAction} source=${src} reason=button-disabled`
        );
        return true;
      }

      if (normalizedAction === 'copy-only') {
        void runCopyAction('copy-only', { source: src }).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][copy-only:failed]', err);
          setStatus(`复制最后回复失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-only:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'send-message') {
        const triggerPhase = getSendTaskPhase();
        const triggerAction = button instanceof HTMLElement
          ? String(button.dataset.action || '').trim()
          : '';
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][send-message:trigger] source=${src} phase=${triggerPhase} action=${triggerAction}`,
        );
        ToolboxShell.appendLog(`[SEND_MESSAGE][BUTTON_TRIGGER] source=${src}`);
        ToolboxShell.appendLog(`[MESSAGE_SEND][CLICK] source=${src}`);
        void triggerSendFromToolbox(src).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] send message UI action failed', err);
          setStatus(`发送信息失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-message:failed] source=${src} error=${errText}`);
        });

        return true;
      }

      if (normalizedAction === 'copy-and-continue') {
        void runCopyAction('copy-and-continue', { source: src || 'runUploadUiAction' }).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][copy-and-continue:failed]', err);
          setStatus(`复制并继续失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-and-continue:failed] source=${src} error=${errText}`);
        });

        return true;
      }

      if (normalizedAction === 'copy-and-hotkey') {
        void runCopyHotkeyOnce(src, event).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[ChatGPT toolbox] copy hotkey once failed', err);
          setStatus(`复制+快捷键失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-and-hotkey:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'copy-hotkey-continue') {
        const copyHotkeyContinueTaskForClick = ensureCopyHotkeyContinueTask();
        if (COPY_HOTKEY_CONTINUE_CANCELLABLE_PHASES.has(copyHotkeyContinueTaskForClick.phase)) {
          void cancelCopyHotkeyContinue(src).catch((err) => {
            const errText = formatToolboxError(err);
            console.error('[UPLOAD_UI_ACTION][copy-hotkey-continue:cancel-failed]', err);
            ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-hotkey-continue:cancel-failed] source=${src} error=${errText}`);
          });
          return true;
        }
        if (copyHotkeyContinueTaskForClick.phase === 'cancelling') {
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][click-ignore] source=${src} phase=cancelling`);
          return true;
        }
        void runCopyHotkeyContinueOnce(src).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][copy-hotkey-continue:failed]', err);
          setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-hotkey-continue:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'loop-copy-hotkey-continue') {
        void handleCopyHotkeyContinueLoopClick(src);
        return true;
      }

      if (normalizedAction === 'loop-copy-hotkey-continue-upload-verify') {
        void handleCopyHotkeyUploadVerifyLoopClick(src);
        return true;
      }

      if (normalizedAction === 'send-hotkey') {
        void runSendHotkeyOnce(src).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[ChatGPT toolbox] send hotkey once failed', err);
          setStatus(`发送 Ctrl+Alt+I 失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-hotkey:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'auto-continue') {
        void runAutoContinueOnce(src).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][auto-continue:failed]', err);
          setStatus(`自动继续失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][auto-continue:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'auto-continue-until-done') {
        void runAutoContinueUntilDone(src).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][auto-continue-until-done:failed]', err);
          setStatus(`自动继续直到完成失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][auto-continue-until-done:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'click-new-chat') {
        void runJumpHome(src).catch((err) => {
          const errText = formatToolboxError(err);
          console.error('[UPLOAD_UI_ACTION][jump-home:failed]', err);
          setStatus(`回到首页失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][click-new-chat:failed] source=${src} error=${errText}`);
        });
        return true;
      }

      if (normalizedAction === 'start-upload') {
        syncButtonTasksFromModuleState('click:start-upload');
        const uploadTask = typeof ButtonTasks !== 'undefined' && ButtonTasks.getButtonTask
          ? ButtonTasks.getButtonTask('upload')
          : state.uploadTask;
        if (uploadTask && uploadTask.phase === 'cancelling') {
          ToolboxShell.appendLog('[UPLOAD_BUTTON][CLICK_IGNORED] cancelling');
          return true;
        }
        if (typeof ButtonTasks !== 'undefined' && typeof ButtonTasks.logButtonTaskClick === 'function') {
          ButtonTasks.logButtonTaskClick('start-upload', 'upload', uploadTask.phase, uploadTask.runId);
        }
        ToolboxShell.appendLog('[UPLOAD][START_CLICK]');
        void startUploadOnlyFlow({ source: 'upload-tab' }).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] start upload UI action failed', err);
          setStatus(`上传失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][start-upload:failed] error=${errText}`);
        });

        return true;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][unknown] action=${normalizedAction} raw=${action} source=${src}`,
      );
      setStatus(`未知操作：${normalizedAction}`, 'warn');
      return false;
    }

    function applyHomeButtonState(homeBtn, phase, options = {}) {
      if (!homeBtn || typeof setToolboxButtonState !== 'function') {
        return;
      }

      const idleText = options.idleText || '回到首页';
      if (phase === 'running') {
        setButtonRunning(homeBtn, options.text || '跳转中', {
          title: '正在跳转到 ChatGPT 首页',
          disabled: true,
          reason: options.reason || 'home-running',
        });
        return;
      }
      if (phase === 'success') {
        setButtonSuccess(homeBtn, options.text || '已跳转', {
          title: '已跳转到新聊天',
          reason: options.reason || 'home-success',
        });
        return;
      }
      if (phase === 'failed') {
        setButtonFailed(homeBtn, options.text || '跳转失败', {
          title: '跳转失败',
          reason: options.reason || 'home-failed',
        });
        return;
      }
      setButtonIdle(homeBtn, idleText, {
        title: '跳转到 ChatGPT 主页',
        reason: options.reason || 'home-idle',
      });
    }

    async function goHomeByClickNewChat(source) {
      try {
        const src = source || '-';
        const canSwitch = typeof switchToNewChatUnified === 'function';

        if (!canSwitch) {
          ToolboxShell.appendLog('[HOME][NEW_CHAT_SWITCH_UNAVAILABLE]');
          setStatus('新聊天切换功能不可用', 'error');
          return {
            ok: false,
            reason: 'new-chat-switch-unified-unavailable',
          };
        }

        setStatus('正在打开新聊天...', 'running');
        const switchResult = await switchToNewChatUnified(`go-home:${src}`, {
          statusOnReady: '新聊天已就绪',
          statusOnTimeout: null,
        });

        if (switchResult && switchResult.ok === true) {
          ToolboxShell.appendLog('[HOME][NEW_CHAT_CLICKED]');
          ToolboxShell.appendLog(
            `[TOOLBOX][GO_HOME] source=${src} clicked=1 method=${switchResult.method || '-'}`,
          );
          setStatus('已点击新聊天', 'ok');
          return {
            ok: true,
            reason: 'clicked_new_chat',
            method: switchResult.method || '-',
            beforeKey: switchResult.beforeKey || '',
            afterKey: switchResult.afterKey || '',
          };
        }

        const failReason = switchResult && switchResult.reason
          ? String(switchResult.reason)
          : 'new_chat_switch_failed';
        const beforeKey = switchResult && switchResult.beforeKey ? String(switchResult.beforeKey) : '-';
        const afterKey = switchResult && switchResult.afterKey ? String(switchResult.afterKey) : '-';

        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${src} clicked=0 reason=${failReason} before=${beforeKey} after=${afterKey}`,
        );

        if (switchResult && switchResult.sawButtonDuringAttempts === false) {
          console.warn('[TOOLBOX][GO_HOME] 未找到新聊天按钮，回退到 /');
          ToolboxShell.appendLog('[HOME][NEW_CHAT_BUTTON_MISSING]');
          setStatus('未找到新聊天按钮，已尝试回到首页', 'warn');
          if (typeof location !== 'undefined' && typeof location.assign === 'function') {
            location.assign('/');
          }
          return {
            ok: false,
            reason: 'new_chat_button_not_found',
            beforeKey,
            afterKey,
          };
        }

        setStatus('打开新聊天失败', 'error');
        return {
          ok: false,
          reason: failReason,
          beforeKey,
          afterKey,
        };
      } catch (err) {
        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);
        console.error('[UPLOAD_UI_ACTION][jump-home:failed]', err);
        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${source || '-'} type=${errName} error=${errText}`,
        );
        setStatus(`打开新聊天失败：${errText}`, 'error');
        throw err;
      }
    }

    const UPLOAD_UI_ACTIONS = Object.freeze([
      {
        selector: UploadSelectors.startBtn,
        action: 'start-upload',
        label: '开始上传',
      },
      {
        selector: UploadSelectors.copyLastMessageBtn,
        action: 'copy-only',
        label: '复制最后回复',
      },
      {
        selector: UploadSelectors.copyContinueBtn,
        action: 'copy-and-continue',
        label: '复制并继续',
      },
      {
        selector: UploadSelectors.sendMessageBtn,
        action: 'send-message',
        label: '发送消息',
      },
      {
        selector: HomeActionSelectors.homeBtn,
        action: 'click-new-chat',
        label: '回到首页',
      },
      {
        selector: UploadSelectors.autoContinueBtn,
        action: 'auto-continue',
        label: '自动继续',
      },
      {
        selector: UploadSelectors.copyHotkeyOnceBtn,
        action: 'copy-and-hotkey',
        label: '复制+快捷键',
      },
      {
        selector: UploadSelectors.copyHotkeyContinueOnceBtn,
        action: 'copy-hotkey-continue',
        label: '复制+快捷键+继续',
      },
      {
        selector: UploadSelectors.copyHotkeyContinueLoopBtn,
        action: 'loop-copy-hotkey-continue',
        label: '连续复制+快捷键+继续',
      },
      {
        selector: UploadSelectors.copyHotkeyContinueLoopUploadVerifyBtn,
        action: 'loop-copy-hotkey-continue-upload-verify',
        label: '闭环继续+每5轮上传',
      },
      {
        selector: '#cgpt-upload-group-manage',
        action: 'toggle-upload-group-manage',
        label: '文件组管理',
      },
    ]);

    async function handleUploadQuickPromptClick(target, event, source = 'delegated-click') {
      if (!(target instanceof Element)) {
        return false;
      }

      const categoryBtn = target.closest('[data-upload-quick-prompt-category]');
      if (categoryBtn) {
        event.preventDefault();
        event.stopPropagation();

        const category = normalizeQuickPromptCategoryName(
          categoryBtn.getAttribute('data-upload-quick-prompt-category') || '全部',
        );

        saveQuickPromptActiveCategory(category, {
          reason: 'quick-category-click',
        });

        ToolboxShell.appendLog(`[PROMPT][CATEGORY_CLICK] source=${source} category=${category}`);

        renderUploadQuickPrompts();
        return true;
      }

      const promptBtn = target.closest('[data-upload-quick-prompt-id]');
      if (!promptBtn) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();

      const id = promptBtn.getAttribute('data-upload-quick-prompt-id');
      const prompts = typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPrompts === 'function'
        ? PromptManagerModule.getPrompts()
        : [];

      const prompt = prompts.find((p) => p && p.id === id);

      if (!prompt) {
        setStatus('未找到对应 Prompt', 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SKIP] source=${source} reason=prompt_not_found id=${id || '-'}`);
        return true;
      }

      ToolboxShell.appendLog(
        `[PROMPT][CLICK_EVENT] source=${source} id=${id || '-'} title=${String(prompt.title || '未命名')} text_len=${String(prompt.content || '').length}`,
      );

      await sendOrFillQuickPrompt(prompt, {
        source: 'quick-prompt-click',
        send: true,
      });

      return true;
    }

    async function handleUploadDelegatedActionClick(event) {
      const target = event && event.target;
      if (!(target instanceof Element)) {
        return;
      }

      try {
        if (await handleUploadQuickPromptClick(target, event, 'root-delegated-click')) {
          return;
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] quick prompt delegated click failed', err);
        ToolboxShell.appendLog(`[PROMPT][CLICK][FAILED] source=root-delegated-click error=${errText}`);
        setStatus(`Prompt 发送失败：${errText}`, 'error');
        return;
      }

      const removeBtn = target.closest('[data-upload-remove-id]');

      if (removeBtn) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }

        const id = removeBtn.getAttribute('data-upload-remove-id');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:click] source=root-delegated id=${id || '-'}`,
        );

        void removeFileFromCurrentGroup(id).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] root delegated remove file failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][remove-file:root-delegated-failed] id=${id || '-'} error=${errText}`,
          );
        });

        return;
      }

      for (const def of UPLOAD_UI_ACTIONS) {
        const button = target.closest(def.selector);
        if (!button) {
          continue;
        }

        if (def.action === 'toggle-upload-group-manage') {
          ToolboxShell.appendLog(
            '[UPLOAD_GROUP_MANAGE][CLICK] source=delegated action=toggle-upload-group-manage',
          );
        }

        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][event] source=delegated-click action=${def.action}`,
        );
        runUploadUiAction(def.action, button, 'delegated-click', event);
        return;
      }

      const actionBtn = target.closest('[data-action]');
      if (!(actionBtn instanceof HTMLElement)) {
        return;
      }

      const action = String(actionBtn.dataset.action || '').trim();
      if (!action) {
        return;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][event] source=delegated-click action=${action}`,
      );
      runUploadUiAction(action, actionBtn, 'delegated-click', event);
    }

    function bindUploadDelegatedClick(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        ToolboxShell.appendLog('[UPLOAD_UI_ACTION][bind-skip] reason=root-missing');
        return;
      }

      if (rootEl.dataset.uploadDelegatedClickBound === '1') {
        return;
      }

      rootEl.dataset.uploadDelegatedClickBound = '1';

      bindOnce(rootEl, 'click', handleUploadDelegatedActionClick, {
        key: 'upload-delegated-click',
        moduleName: 'UploadModule',
        listenerOptions: true,
      });
    }

    function requireUploadElement(rootEl, selector, name) {
      return DomUtil.byId(rootEl, selector, `UPLOAD:${name}`);
    }

    function verifyUploadRequiredDom(rootEl) {
      const required = [
        [UploadSelectors.startBtn, 'startBtn'],
        [UploadSelectors.copyContinueBtn, 'copyContinueBtn'],
        [UploadSelectors.copyLastMessageBtn, 'copyLastMessageBtn'],
        [UploadSelectors.groupList, 'groupList'],
        [UploadSelectors.quickPrompts, 'quickPrompts'],
      ];

      const refs = {};

      required.forEach(([selector, name]) => {
        refs[name] = requireUploadElement(rootEl, selector, name);
      });

      return refs;
    }

    function ensureUploadManageActionButtons(rootEl) {
      const root = rootEl || rootElRef || qs('#cgpt-upload-module', document);
      if (!root) return;

      const actionMap = [
        ['#cgpt-upload-group-manage', 'toggle-upload-group-manage'],
        ['#cgpt-upload-group-add-inline', 'create-upload-group'],
        ['#cgpt-upload-group-rename-inline', 'rename-upload-group'],
        ['#cgpt-upload-group-clear-inline', 'clear-upload-group'],
        ['#cgpt-upload-group-delete-inline', 'delete-upload-group'],
      ];

      actionMap.forEach(([selector, action]) => {
        const btn = qs(selector, root);
        if (!btn) return;
        btn.dataset.action = action;
        btn.dataset.uploadUiAction = action;
      });
    }

    function runUploadActionPromise(promise, actionName) {
      Promise.resolve(promise).catch((err) => {
        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);

        console.error(`[ChatGPT toolbox] upload action failed: ${actionName}`, err);

        setStatus(`${actionName}失败：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_ACTION][FAILED] action=${actionName} type=${errName} error=${errText}`,
        );
      });
    }

    function bindEvents(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      if (rootEl.dataset.uploadEventsBound === '1') {
        ensureUploadActionButtons(rootEl);
        ensureUploadManageActionButtons(rootEl);

        const reboundGroupManageBtn = qs('#cgpt-upload-group-manage', rootEl);
        if (reboundGroupManageBtn) {
          reboundGroupManageBtn.dataset.action = 'toggle-upload-group-manage';
          // 动作按钮统一由 bindUploadDelegatedClick + runUploadUiAction 分发，避免 direct-click 与委托双触发。
          reboundGroupManageBtn.dataset.groupManageClickBound = 'delegated-only';
        }

        bindUploadDropTargets(rootEl);
        bindUploadSendShortcut();
        bindUploadStartShortcut();
        bindCopyAndHotkeyShortcut();
        bindUploadDelegatedClick(rootEl);
        bindUploadCompactActionButtons(rootEl);
        applyUploadShortcutButtonTitles(rootEl);
        return;
      }

      rootEl.dataset.uploadEventsBound = '1';

      const refs = verifyUploadRequiredDom(rootEl);
      ensureUploadManageActionButtons(rootEl);

      const groupManageBtn = qs('#cgpt-upload-group-manage', rootEl);
      if (!groupManageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-manage');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-manage-btn]');
      } else {
        groupManageBtn.dataset.action = 'toggle-upload-group-manage';
        // 动作按钮统一由 bindUploadDelegatedClick + runUploadUiAction 分发，避免 direct-click 与委托双触发。
        groupManageBtn.dataset.groupManageClickBound = 'delegated-only';
      }

      if (groupNameInputEl) {
        groupNameInputEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });

        groupNameInputEl.addEventListener('blur', () => {
          const text = String(groupNameInputEl.value || '').trim();

          if (!text) return;
          if (text === lastGroupNameInputValue) return;

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });
      }

            // Blob persistence binding removed - disabled

      groupListEl.addEventListener('click', async (e) => {
        const btn = e.target instanceof HTMLElement
          ? e.target.closest('.cgpt-upload-group-chip[data-group-id]')
          : null;

        if (!btn) return;

        const groupId = btn.getAttribute('data-group-id');
        if (!groupId) return;

        try {
          await switchGroup(groupId, {
            source: 'user',
            saveGlobalFallback: true,
            savePageState: true,
            saveLastManual: true,
            reason: 'user-switch-upload-group',
          });
        } catch (err) {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);

          console.error('[ChatGPT toolbox] group chip switch failed', err);

          setStatus(`切换分组失败：${errText}`, 'error');

          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][chip-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
          );
        }
      });

      if (manageGroupListEl) {
        manageGroupListEl.addEventListener('click', async (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-upload-manage-group-item[data-group-id]')
            : null;

          if (!btn) return;

          const groupId = btn.getAttribute('data-group-id');
          if (!groupId) return;

          try {
            const currentText = groupNameInputEl ? String(groupNameInputEl.value || '').trim() : '';
            const currentGroup = getActiveGroup();

            if (currentGroup && currentText && currentText !== currentGroup.name) {
              await renameActiveGroupInline();
            }

            await switchGroup(groupId, {
              source: 'user',
              saveGlobalFallback: true,
              savePageState: true,
              saveLastManual: true,
              reason: 'user-switch-upload-group',
            });
            syncGroupManagePanel({
              force: true,
            });
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] manage group switch failed', err);

            setStatus(`管理列表切换分组失败：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][manage-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
            );
          }
        });
      }

      listEl.addEventListener('click', async (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;

        const removeBtn = target.closest('[data-upload-remove-id]');

        if (removeBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = removeBtn.getAttribute('data-upload-remove-id');

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][remove-file:click] source=list id=${id || '-'}`,
          );

          try {
            await removeFileFromCurrentGroup(id);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] remove file from current group failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][remove-file:failed] id=${id || '-'} error=${errText}`,
            );
            setStatus(`移除文件失败：${errText}`, 'error');
          }

          return;
        }

        const rebindBtn = target.closest('[data-upload-rebind-id]');

        if (rebindBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = rebindBtn.getAttribute('data-upload-rebind-id');
          if (!id) return;

          try {
            await rebindUploadFile(id);
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] rebind upload file failed', err);

            setStatus(`上传队列保存失败或超时：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} type=${errName} error=${errText}`,
            );
          }

          return;
        }

        const itemEl = target.closest('.cgpt-upload-item[data-id]');

        if (!itemEl) return;
        if (itemEl.classList.contains('empty')) return;

        const id = itemEl.getAttribute('data-id');
        if (!id) return;

        const q = getActiveGroupFiles().find((item) => item && item.id === id);
        if (!q) {
          setStatus('未找到对应文件');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][upload-list-click:missing-item] id=${id || '-'} group=${getActiveGroupId() || '-'}`);
          return;
        }

        setSelectedFileIdForActiveGroup(id, { reason: 'upload-list-click' });
        renderUploadListOnly();
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-list-click:select] id=${id || '-'} name=${q.name || '-'} group=${getActiveGroupId() || '-'}`,
        );
      });

      const quickPromptBox = qs('#cgpt-upload-quick-prompts', rootEl);
      if (quickPromptBox) {
        quickPromptBox.dataset.quickPromptClickMode = 'root-delegated';
      }

      bindUploadDropTargets(rootEl);
      bindUploadSendShortcut();
      bindUploadStartShortcut();
      bindCopyAndHotkeyShortcut();
      bindUploadDelegatedClick(rootEl);
      bindUploadCompactActionButtons(rootEl);
      applyUploadShortcutButtonTitles(rootEl);
    }

    function buildUploadActionToolbarInnerHtml() {
      return `
          <div class="cgpt-row cgpt-upload-action-row cgpt-upload-main-action-row" data-action-row="main">
            <button
              type="button"
              class="cgpt-btn cgpt-btn-upload cgpt-btn-idle"
              id="cgpt-upload-start"
              data-action="start-upload"
              data-button-role="upload-start"
              title="只上传/绑定文件到 ChatGPT 输入框，不自动发送"
            >开始上传</button>
            <button
              type="button"
              class="cgpt-btn purple"
              id="cgpt-copy-hotkey-once"
              data-action="copy-and-hotkey"
              title="复制最后回复，并发送配置的目标快捷键"
            >复制+快捷键</button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" data-action="copy-and-continue" title="先复制最后回复，再发送“继续”">复制并继续</button>
            <button
              type="button"
              class="cgpt-btn danger"
              id="cgpt-send-message-once"
              data-action="send-message"
              title="发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）"
            >发送消息</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-open-chatgpt-home" data-action="click-new-chat" title="点击左侧新聊天">回到首页</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once" data-action="auto-continue">自动继续</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-until-done" data-action="auto-continue-until-done" title="循环发送强约束继续指令；只有检测到严格完成信号才停止">自动继续直到完成</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom" data-action="copy-only">复制最后回复</button>
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" data-action="copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> 目标快捷键 -> 发送继续指令">复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" data-action="loop-copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> 目标快捷键 -> 发送继续指令">连续复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop-upload-verify" data-action="loop-copy-hotkey-continue-upload-verify" title="等待回复完成 -> 复制最后回复 -> 判断终止信号 -> 目标快捷键 -> 发送继续指令；每 5 轮自动上传一次代码">闭环继续+每5轮上传</button>
          </div>
      `;
    }

    function logUploadActionRowLayout(rootEl, reason = '') {
      const row = rootEl && rootEl.querySelector
        ? rootEl.querySelector('.cgpt-upload-main-action-row')
        : null;

      if (!row) {
        ToolboxShell.appendLog(`[UPLOAD_UI][LAYOUT_CHECK] reason=${reason} result=missing-main-row`);
        return;
      }

      const style = window.getComputedStyle(row);
      ToolboxShell.appendLog(
        `[UPLOAD_UI][LAYOUT_CHECK] reason=${reason} flexWrap=${style.flexWrap} overflowX=${style.overflowX} childCount=${row.children.length}`,
      );
    }

    function needsUploadActionToolbarMigration(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return false;
      }

      const toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
      if (!toolbar) {
        return false;
      }

      if (toolbar.querySelector(UploadSelectors.legacyStartSendBtn)) {
        return true;
      }

      if (toolbar.querySelector('.cgpt-upload-extra-action-row')) {
        return true;
      }

      if (toolbar.querySelector('.cgpt-upload-file-action-row')) {
        return true;
      }

      if (toolbar.querySelector('.cgpt-chat-send-action-row')) {
        return true;
      }

      const mainRow = toolbar.querySelector('.cgpt-upload-main-action-row');
      if (!mainRow) {
        return true;
      }

      const requiredButtons = [
        UploadSelectors.startBtn,
        UploadSelectors.sendMessageBtn,
        UploadSelectors.copyContinueBtn,
        HomeActionSelectors.homeBtn,
        UploadSelectors.autoContinueBtn,
        UploadSelectors.autoContinueUntilDoneBtn,
        UploadSelectors.copyLastMessageBtn,
        UploadSelectors.copyHotkeyOnceBtn,
        UploadSelectors.copyHotkeyContinueOnceBtn,
        UploadSelectors.copyHotkeyContinueLoopBtn,
        UploadSelectors.copyHotkeyContinueLoopUploadVerifyBtn,
      ];

      return requiredButtons.some((selector) => !mainRow.querySelector(selector));
    }

    function migrateUploadActionToolbarLayout(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      cleanupLegacyCoupledButtons(rootEl);

      if (!needsUploadActionToolbarMigration(rootEl)) {
        return;
      }

      const toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
      if (!toolbar) {
        return;
      }

      toolbar.innerHTML = buildUploadActionToolbarInnerHtml();
      ToolboxShell.appendLog('[UPLOAD_UI][ACTION_TOOLBAR_MIGRATED] all-actions-wrap-row');
      logUploadActionRowLayout(rootEl, 'migrate-upload-action-toolbar');
    }

    function buildUploadActionToolbarHtml() {
      return `
        <div class="cgpt-upload-action-toolbar">
          ${buildUploadActionToolbarInnerHtml()}
        </div>
      `;
    }

    function ensureUploadActionToolbar(rootEl) {
      if (!rootEl) {
        return;
      }

      const uploadSection = rootEl.querySelector('.cgpt-section');
      let toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
      let actionRow = rootEl.querySelector('.cgpt-upload-action-row');

      if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'cgpt-upload-action-toolbar';
        toolbar.innerHTML = buildUploadActionToolbarInnerHtml();

        if (actionRow && actionRow.parentElement && actionRow.parentElement !== toolbar) {
          actionRow.remove();
        }

        if (uploadSection) {
          rootEl.insertBefore(toolbar, uploadSection);
        } else {
          rootEl.insertBefore(toolbar, rootEl.firstChild);
        }

        ToolboxShell.appendLog('[UPLOAD_UI][ACTION_TOOLBAR_INSERTED]');
        logUploadActionRowLayout(rootEl, 'ensure-upload-action-toolbar-inserted');
      } else {
        migrateUploadActionToolbarLayout(rootEl);
        logUploadActionRowLayout(rootEl, 'ensure-upload-action-toolbar-migrated');
      }

      if (uploadSection && toolbar.nextElementSibling !== uploadSection) {
        rootEl.insertBefore(toolbar, uploadSection);
      } else if (!uploadSection && rootEl.firstElementChild !== toolbar) {
        rootEl.insertBefore(toolbar, rootEl.firstChild);
      }
    }

    function buildUploadGroupManagePanelHtml() {
      return `
        <div class="cgpt-upload-manage-panel cgpt-toolbox-hidden" id="cgpt-upload-manage-panel">
          <div class="cgpt-upload-manage-title">文件组管理</div>

          <div class="cgpt-upload-manage-layout">
            <div class="cgpt-upload-manage-left">
              <div class="cgpt-upload-manage-subtitle-row">
                <span>全部分组</span>
                <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline" data-action="create-upload-group">新建</button>
              </div>
              <div class="cgpt-upload-manage-group-list" id="cgpt-upload-manage-group-list"></div>
            </div>

            <div class="cgpt-upload-manage-right">
              <div class="cgpt-upload-manage-subtitle">当前分组</div>

              <div class="cgpt-upload-manage-row">
                <input class="cgpt-input" id="cgpt-upload-group-name-input" placeholder="当前分组名称">
                <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline" data-action="rename-upload-group">保存名称</button>
              </div>

              <div class="cgpt-upload-manage-row">
                <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline" data-action="clear-upload-group">清空当前组</button>
                <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline" data-action="delete-upload-group">删除当前组</button>
              </div>

              <div class="cgpt-hint">这里只管理当前文件组，不会自动上传到 ChatGPT。</div>
            </div>
          </div>

          <div class="cgpt-upload-common-settings">
            <div class="cgpt-upload-manage-subtitle">公共上传设置</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
              上传时加时间戳/序号（仅内存，例：file_20260523_200319_01.zip）
            </label>

            <div class="cgpt-hint">这些设置对所有文件组生效。</div>
          </div>
        </div>
      `;
    }

    function ensureUploadGroupSection(rootEl) {
      if (!rootEl) {
        return;
      }

      ensureUploadActionToolbar(rootEl);

      let groupsHead = rootEl.querySelector('.cgpt-upload-groups-head');
      let groupList = rootEl.querySelector('#cgpt-upload-group-list');

      if (!(groupsHead && groupList)) {
        const uploadSection = rootEl.querySelector('.cgpt-section');
        if (uploadSection) {
          uploadSection.classList.add('toolbox-upload-drop-zone');
        }
        const sectionTitle = uploadSection
          ? uploadSection.querySelector('.cgpt-section-title')
          : null;

        groupsHead = document.createElement('div');
        groupsHead.className = 'cgpt-upload-groups-head';
        groupsHead.id = 'cgpt-toolbox-project-stats-row';
        groupsHead.innerHTML = `
          <div class="cgpt-upload-group-bar">
            <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
            <button type="button"
              class="cgpt-toolbox-small-btn"
              id="cgpt-upload-group-manage"
              data-action="toggle-upload-group-manage"
              title="打开/关闭文件组管理面板">管理</button>
          </div>
        `;

        if (sectionTitle && sectionTitle.parentNode) {
          sectionTitle.insertAdjacentElement('afterend', groupsHead);
        } else if (uploadSection) {
          uploadSection.insertBefore(groupsHead, uploadSection.firstChild);
        } else {
          const toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
          if (toolbar && toolbar.nextSibling) {
            rootEl.insertBefore(groupsHead, toolbar.nextSibling);
          } else {
            rootEl.insertBefore(groupsHead, rootEl.firstChild);
          }
        }

        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][ENSURE_GROUP_SECTION_INSERTED]');
      } else {
        groupsHead.id = 'cgpt-toolbox-project-stats-row';
      }

      const managePanel = rootEl.querySelector('#cgpt-upload-manage-panel');
      groupsHead = groupsHead || rootEl.querySelector('.cgpt-upload-groups-head');
      if (!managePanel && groupsHead && groupsHead.parentElement) {
        groupsHead.insertAdjacentHTML('afterend', buildUploadGroupManagePanelHtml());
        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][ENSURE_MANAGE_PANEL_INSERTED]');
      }

      ensureUploadManageActionButtons(rootEl);
      refreshUploadGroupDomRefs(rootEl);
    }

    function ensureToolboxPageStatusRow(rootEl) {
      if (rootEl) {
        const legacyRows = rootEl.querySelectorAll(
          '#cgpt-toolbox-page-status-row, .cgpt-toolbox-top-status-row, .cgpt-toolbox-page-status-row',
        );
        legacyRows.forEach((row) => {
          if (!row.closest('.cgpt-toolbox-header')) {
            row.remove();
          }
        });

        const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);
        if (legacyStatusCounts) {
          legacyStatusCounts.remove();
        }

        const groupsHead = qs('.cgpt-upload-groups-head', rootEl);
        if (groupsHead && !groupsHead.id) {
          groupsHead.id = 'cgpt-toolbox-project-stats-row';
        }
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.ensureToolboxHeaderPageStatusRow === 'function'
      ) {
        ToolboxShell.ensureToolboxHeaderPageStatusRow();
      }
    }

    function ensureUploadActionButtons(rootEl) {
      cleanupLegacyCoupledButtons(rootEl);
      migrateUploadActionToolbarLayout(rootEl);

      const actionRow = qs('.cgpt-upload-main-action-row', rootEl)
        || qs('.cgpt-upload-action-row', rootEl);

      if (!actionRow) {
        console.error('[ChatGPT toolbox] ensureUploadActionButtons: 缺少主操作行 .cgpt-upload-main-action-row');
        ToolboxShell.appendLog('[UPLOAD_UI][missing-main-action-row]');
        return;
      }

      let copyLastBtn = qs(UploadSelectors.copyLastMessageBtn, actionRow);
      if (!copyLastBtn) {
        console.error('[ChatGPT toolbox] ensureUploadActionButtons: 缺少复制最后回复按钮');
        ToolboxShell.appendLog('[UPLOAD_UI][missing-copy-last-button]');
        copyLastBtn = document.createElement('button');
        copyLastBtn.type = 'button';
        copyLastBtn.className = 'cgpt-btn';
        copyLastBtn.id = 'cgpt-copy-last-message-scroll-bottom';
        copyLastBtn.dataset.action = 'copy-only';
        copyLastBtn.textContent = '复制最后回复';
        copyLastBtn.title = '等待最后一条 assistant 回复稳定后复制到剪贴板';
        ToolboxShell.appendLog('[UPLOAD_UI][HEAL_CREATE] button=cgpt-copy-last-message-scroll-bottom');
        actionRow.appendChild(copyLastBtn);
      }

      const uploadStartBtn = qs(UploadSelectors.startBtn, actionRow);
      if (uploadStartBtn) {
        uploadStartBtn.title = '只上传/绑定文件到 ChatGPT 输入框，不自动发送';
        uploadStartBtn.dataset.action = 'start-upload';
        uploadStartBtn.dataset.buttonRole = 'upload-start';
      }

      let sendMessageBtn = qs(UploadSelectors.sendMessageBtn, actionRow);
      if (!sendMessageBtn) {
        sendMessageBtn = document.createElement('button');
        sendMessageBtn.type = 'button';
        sendMessageBtn.className = 'cgpt-btn danger';
        sendMessageBtn.id = 'cgpt-send-message-once';
        sendMessageBtn.dataset.action = 'send-message';
        sendMessageBtn.textContent = '发送消息';
        sendMessageBtn.title = '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）';
        ToolboxShell.appendLog('[UPLOAD_UI][HEAL_CREATE] button=cgpt-send-message-once');
      } else {
        sendMessageBtn.dataset.action = 'send-message';
      }

      const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);
      if (legacyUploadAndSendBtn) {
        legacyUploadAndSendBtn.remove();
        ToolboxShell.appendLog('[UPLOAD_UI][REMOVED_LEGACY] button=cgpt-upload-start-and-send');
      }

      const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, actionRow);
      if (copyContinueBtn) {
        copyContinueBtn.dataset.action = 'copy-and-continue';
      }

      copyLastBtn.dataset.action = 'copy-only';

      const legacySendHotkeyBtn = qs(UploadSelectors.legacySendHotkeyBtn, actionRow);
      if (legacySendHotkeyBtn) {
        legacySendHotkeyBtn.remove();
        ToolboxShell.appendLog('[UPLOAD_UI][REMOVED_LEGACY] button=cgpt-send-hotkey-once');
      }

      let homeBtn = qs(HomeActionSelectors.homeBtn, actionRow);
      if (!homeBtn) {
        homeBtn = document.createElement('button');
        homeBtn.type = 'button';
        homeBtn.className = 'cgpt-btn primary';
        homeBtn.id = 'cgpt-open-chatgpt-home';
        homeBtn.dataset.action = 'click-new-chat';
        homeBtn.textContent = '回到首页';
        homeBtn.title = '点击左侧新聊天';
      } else {
        homeBtn.dataset.action = 'click-new-chat';
      }

      let autoContinueBtn = qs(UploadSelectors.autoContinueBtn, actionRow);
      if (!autoContinueBtn) {
        autoContinueBtn = document.createElement('button');
        autoContinueBtn.type = 'button';
        autoContinueBtn.className = 'cgpt-btn teal';
        autoContinueBtn.id = 'cgpt-auto-continue-once';
        autoContinueBtn.dataset.action = 'auto-continue';
        autoContinueBtn.textContent = '自动继续';
      } else {
        autoContinueBtn.dataset.action = 'auto-continue';
      }

      let autoContinueUntilDoneBtn = qs(UploadSelectors.autoContinueUntilDoneBtn, actionRow);
      if (!autoContinueUntilDoneBtn) {
        autoContinueUntilDoneBtn = document.createElement('button');
        autoContinueUntilDoneBtn.type = 'button';
        autoContinueUntilDoneBtn.className = 'cgpt-btn teal';
        autoContinueUntilDoneBtn.id = 'cgpt-auto-continue-until-done';
        autoContinueUntilDoneBtn.dataset.action = 'auto-continue-until-done';
        autoContinueUntilDoneBtn.textContent = '自动继续直到完成';
        autoContinueUntilDoneBtn.title = '循环发送强约束继续指令；只有检测到严格完成信号才停止';
      } else {
        autoContinueUntilDoneBtn.dataset.action = 'auto-continue-until-done';
      }

      let copyHotkeyOnceBtn = qs(UploadSelectors.copyHotkeyOnceBtn, actionRow);
      if (!copyHotkeyOnceBtn) {
        copyHotkeyOnceBtn = document.createElement('button');
        copyHotkeyOnceBtn.type = 'button';
        copyHotkeyOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyOnceBtn.id = 'cgpt-copy-hotkey-once';
        copyHotkeyOnceBtn.dataset.action = 'copy-and-hotkey';
        copyHotkeyOnceBtn.textContent = typeof getCopyAndHotkeyButtonLabel === 'function'
          ? getCopyAndHotkeyButtonLabel()
          : '复制+快捷键';
      }
      copyHotkeyOnceBtn.dataset.action = 'copy-and-hotkey';
      copyHotkeyOnceBtn.title = getCopyAndHotkeyButtonTitle();

      let copyHotkeyContinueOnceBtn = qs(UploadSelectors.copyHotkeyContinueOnceBtn, actionRow);
      if (!copyHotkeyContinueOnceBtn) {
        copyHotkeyContinueOnceBtn = document.createElement('button');
        copyHotkeyContinueOnceBtn.type = 'button';
        copyHotkeyContinueOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyContinueOnceBtn.id = 'cgpt-copy-hotkey-continue-once';
        copyHotkeyContinueOnceBtn.dataset.action = 'copy-hotkey-continue';
        copyHotkeyContinueOnceBtn.textContent = '复制+快捷键+继续';
      } else {
        copyHotkeyContinueOnceBtn.dataset.action = 'copy-hotkey-continue';
      }

      let copyHotkeyContinueLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopBtn, actionRow);
      if (!copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn = document.createElement('button');
        copyHotkeyContinueLoopBtn.type = 'button';
        copyHotkeyContinueLoopBtn.className = 'cgpt-btn cyan';
        copyHotkeyContinueLoopBtn.id = 'cgpt-copy-hotkey-continue-loop';
        copyHotkeyContinueLoopBtn.dataset.action = 'loop-copy-hotkey-continue';
        copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';
        copyHotkeyContinueLoopBtn.title = '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令';
      } else {
        copyHotkeyContinueLoopBtn.dataset.action = 'loop-copy-hotkey-continue';
      }

      let copyHotkeyUploadVerifyLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopUploadVerifyBtn, actionRow);
      if (!copyHotkeyUploadVerifyLoopBtn) {
        copyHotkeyUploadVerifyLoopBtn = document.createElement('button');
        copyHotkeyUploadVerifyLoopBtn.type = 'button';
        copyHotkeyUploadVerifyLoopBtn.className = 'cgpt-btn cyan';
        copyHotkeyUploadVerifyLoopBtn.id = 'cgpt-copy-hotkey-continue-loop-upload-verify';
        copyHotkeyUploadVerifyLoopBtn.dataset.action = 'loop-copy-hotkey-continue-upload-verify';
        copyHotkeyUploadVerifyLoopBtn.textContent = '闭环继续+每5轮上传';
        copyHotkeyUploadVerifyLoopBtn.title = '等待回复完成 -> 复制最后回复 -> 判断终止信号 -> Ctrl+Alt+I -> 发送继续指令；每 5 轮自动上传一次代码';
      } else {
        copyHotkeyUploadVerifyLoopBtn.dataset.action = 'loop-copy-hotkey-continue-upload-verify';
      }

      const orderedButtons = [
        uploadStartBtn,
        copyHotkeyOnceBtn,
        copyContinueBtn,
        sendMessageBtn,
        homeBtn,
        autoContinueBtn,
        autoContinueUntilDoneBtn,
        copyLastBtn,
        copyHotkeyContinueOnceBtn,
        copyHotkeyContinueLoopBtn,
        copyHotkeyUploadVerifyLoopBtn,
      ].filter(Boolean);

      orderedButtons.forEach((btn) => {
        actionRow.appendChild(btn);
      });

      logUploadActionRowLayout(rootEl, 'ensure-upload-action-buttons');
    }

    function bindUploadCompactActionButtons(rootEl) {
      // 动作按钮统一由 bindUploadDelegatedClick + runUploadUiAction 分发，避免重复绑定。
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      const actionButtons = rootEl.querySelectorAll('[data-action]');
      actionButtons.forEach((btn) => {
        if (!(btn instanceof HTMLElement)) {
          return;
        }
        const action = String(btn.dataset.action || '').trim();
        if (action) {
          btn.dataset.uploadUiAction = action;
        }
      });
    }

    function validateUploadDomStructure(rootEl) {
      validateDomRules(rootEl, [
        {
          type: 'required',
          selector: '#cgpt-copy-last-message-scroll-bottom',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-last-message-scroll-bottom',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制最后回复按钮被错误放进管理面板',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-start',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-module',
          child: '#cgpt-upload-start-send',
          message: '旧发送按钮 #cgpt-upload-start-send 不应继续存在',
          invalidLog: '[UPLOAD_DOM][invalid] legacy #cgpt-upload-start-send still exists',
        },
        {
          type: 'contains',
          parent: '.cgpt-upload-main-action-row',
          child: '#cgpt-send-message-once',
          message: '发送消息按钮必须位于主操作行',
          invalidLog: '[UPLOAD_DOM][invalid] send message button not in main action row',
        },
        {
          type: 'required',
          selector: '#cgpt-send-message-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-send-message-once',
        },
        {
          type: 'contains',
          parent: '.cgpt-upload-main-action-row',
          child: '#cgpt-upload-start',
          message: '开始上传按钮必须位于主操作行',
          invalidLog: '[UPLOAD_DOM][invalid] upload start button not in main action row',
        },
        {
          type: 'contains',
          parent: '.cgpt-upload-main-action-row',
          child: '#cgpt-copy-hotkey-once',
          message: '复制+快捷键按钮必须位于主操作行',
          invalidLog: '[UPLOAD_DOM][invalid] copy hotkey button not in main action row',
        },
        {
          type: 'contains',
          parent: '.cgpt-upload-main-action-row',
          child: '#cgpt-upload-continue-once',
          message: '复制并继续按钮必须位于主操作行',
          invalidLog: '[UPLOAD_DOM][invalid] copy continue button not in main action row',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-module',
          child: '.cgpt-upload-extra-action-row',
          message: '不应再存在额外操作行，所有操作按钮应放在主操作行',
          invalidLog: '[UPLOAD_DOM][invalid] extra action row should not exist',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-continue-once',
        },
        {
          type: 'required',
          selector: HomeActionSelectors.homeBtn,
          missingLog: '[UPLOAD_DOM][missing] #cgpt-open-chatgpt-home',
        },
        {
          type: 'required',
          selector: '#cgpt-auto-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-auto-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-auto-continue-until-done',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-auto-continue-until-done',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-list',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-group-list',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-group-list',
        },
        {
          type: 'required',
          selector: '.cgpt-upload-action-toolbar',
          missingLog: '[UPLOAD_DOM][missing] .cgpt-upload-action-toolbar',
        },
        {
          type: 'order',
          before: '.cgpt-upload-action-toolbar',
          after: '.cgpt-section',
          message: '上传快捷操作工具栏应位于多文件上传卡片之前',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-group-list',
          message: '文件组标签应位于上传快捷操作工具栏之后',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start',
          message: '上传按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-continue-once',
          message: '复制并继续按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制最后回复按钮被错误放进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-open-chatgpt-home',
          message: '回到首页按钮被错误包进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 回到首页按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-list',
          message: '上传列表被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 被错误包进管理面板',
        },
        {
          type: 'order',
          before: '#cgpt-upload-group-list',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于文件组标签之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于上传快捷操作工具栏之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-list',
          after: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 应位于上传文件列表之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-copy-hotkey-once',
          message: '复制+快捷键按钮应位于开始上传按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-once',
          after: '#cgpt-upload-continue-once',
          message: '复制并继续按钮应位于复制+快捷键按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-continue-once',
          after: '#cgpt-send-message-once',
          message: '发送消息按钮应位于复制并继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-send-message-once',
          after: '#cgpt-open-chatgpt-home',
          message: '回到首页按钮应位于发送消息按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-open-chatgpt-home',
          after: '#cgpt-auto-continue-once',
          message: '自动继续按钮应位于回到首页按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-once',
          after: '#cgpt-auto-continue-until-done',
          message: '自动继续直到完成按钮应位于自动继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-until-done',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮应位于自动继续直到完成按钮之后',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-once',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-loop',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-loop',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-loop-upload-verify',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-loop-upload-verify',
        },
        {
          type: 'order',
          before: '#cgpt-copy-last-message-scroll-bottom',
          after: '#cgpt-copy-hotkey-continue-once',
          message: '复制+快捷键+继续按钮应位于复制最后回复按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-continue-once',
          after: '#cgpt-copy-hotkey-continue-loop',
          message: '连续复制+快捷键+继续按钮应位于复制+快捷键+继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-continue-loop',
          after: '#cgpt-copy-hotkey-continue-loop-upload-verify',
          message: '闭环继续按钮应位于连续复制+快捷键+继续按钮之后',
        },
        {
          type: 'notContains',
          parent: '.cgpt-upload-main-action-row',
          child: '#cgpt-send-hotkey-once',
          message: '旧发送快捷键按钮不应继续渲染',
          invalidLog: '[UPLOAD_DOM][invalid] legacy #cgpt-send-hotkey-once still exists',
        },
      ], {
        moduleName: 'UPLOAD',
      });
    }

    async function applyToolboxPageState(pageState, reason = '') {
      if (!pageState || typeof pageState !== 'object') {
        return;
      }

      const shouldApplyDefaults = reason === 'init' || reason === 'route-key-changed';
      const shouldRestoreUploadGroup =
        shouldApplyDefaults || reason === 'upload-groups-ready';
      const toolboxRouteKey = getToolboxRouteKey();
      const reasonText = reason || '-';

      let targetGroupId = '';
      let source = '';

      if (shouldRestoreUploadGroup) {
        const savedSelection = getMultiUploadLastSelection();
        const skipManualNewer = (
          (reason === 'init' || reason === 'upload-groups-ready')
          && lastManualUploadGroupAt > 0
          && savedSelection.updatedAt > 0
          && lastManualUploadGroupAt >= savedSelection.updatedAt
          && isValidUploadGroupId(state.activeGroupId)
        );

        if (skipManualNewer) {
          ToolboxShell.appendLog(
            `[UPLOAD][PAGE_STATE][APPLY_SKIP_MANUAL_NEWER] reason=${reasonText} activeGroupId=${state.activeGroupId || '-'} manualAt=${lastManualUploadGroupAt} savedAt=${savedSelection.updatedAt}`,
          );
          targetGroupId = state.activeGroupId;
          source = 'manual-newer';
        } else {
          const resolved = resolveUploadGroupSelection({
            pageState,
            reason,
          });
          targetGroupId = resolved.resolvedGroupId;
          source = resolved.reason;

          const pageGroupId = resolved.pageGroupId;
          if (pageGroupId && !targetGroupId) {
            ToolboxShell.appendLog(
              `[UPLOAD_PAGE_STATE][restore-group-missing] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${pageGroupId}`,
            );
          }
        }
      } else {
        targetGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();

        if (targetGroupId && state.groups.some((g) => g.id === targetGroupId)) {
          source = 'page-state';
        } else {
          targetGroupId = '';
          source = '';
        }
      }

      if (!targetGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group-skip] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} noTarget=1`,
        );
      } else if (targetGroupId === state.activeGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD][PAGE_STATE][APPLY_SKIP_SAME_GROUP] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
        );
      } else if (source !== 'manual-newer') {
        await switchGroup(targetGroupId, {
          savePageState: source !== 'page-state',
          saveLastManual: false,
          saveGlobalFallback: false,
          reason: `restore-page-state:${source}`,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
        );

        if (source === 'last-manual' || source === 'first-group') {
          saveCurrentToolboxBaseState(`restore-upload-group:${source}`);
        }
      }

      const categoryRaw = String(
        readToolboxStateField(pageState, 'quickPromptCategory', ''),
      ).trim();

      if (categoryRaw) {
        saveQuickPromptActiveCategory(categoryRaw, {
          savePageState: false,
          reason: 'restore-page-state',
        });
        renderUploadQuickPrompts();
      } else if (shouldApplyDefaults) {
        saveQuickPromptActiveCategory('全部', {
          savePageState: false,
          reason: 'restore-page-state-default',
        });
        renderUploadQuickPrompts();
      }
    }

    function restoreUploadDomRefs(rootEl) {
      ensureUploadActionToolbar(rootEl);
      ensureUploadGroupSection(rootEl);

      host = host || (rootEl && rootEl.parentElement) || null;
      rootElRef = rootEl;
      panelDropEl = document.getElementById(APP.panelId);
      listEl = qs(UploadSelectors.list, rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);
      refreshUploadGroupDomRefs(rootEl);
      ensureUploadManageActionButtons(rootEl);
    }

    function runUploadModuleInitPipeline(rootEl, reason = 'mount') {
      safeAppendLog('[UPLOAD_UI][ADD_FILE_BUTTON_REMOVED] \u624b\u52a8\u6dfb\u52a0\u6587\u4ef6\u6309\u94ae\u5df2\u4ece\u4e3b\u754c\u9762\u79fb\u9664\uff0c\u5f00\u59cb\u4e0a\u4f20\u5c06\u4f7f\u7528\u73b0\u6709\u6587\u4ef6\u8bb0\u5f55\u3002');
      uploadGroupsInitResolved = false;
      cleanupLegacyCoupledButtons(rootEl);
      ensureToolboxPageStatusRow(rootEl);
      ensureUploadActionToolbar(rootEl);
      ensureUploadGroupSection(rootEl);
      ensureUploadManageActionButtons(rootEl);
      ensureUploadActionButtons(rootEl);
      validateUploadDomStructure(rootEl);
      logUploadActionRowLayout(rootEl, 'init-pipeline');
      bindEvents(rootEl);
      logUploadButtonSplitDom();

      
return clearPersistedUploadBlobs('startup-disable-blob-cache')
        .catch((e) => {
          console.warn('[ChatGPT toolbox] startup clearPersistedUploadBlobs failed', e);
        })
        .then(() => loadGroups())
        .then(() => refreshUploadGroupCounts())
        .then(() => loadQueueForActiveGroup())
        .then(() => render())
        .then(() => applyToolboxPageState(getToolboxPageState(), 'upload-groups-ready'))
        .then(() => {
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-complete');
          syncUploadGroupAppState();
                ToolboxShell.appendLog('[UPLOAD_DIAG][blob-cache-disabled] upload blob persistence disabled');
      appendUploadGroupLog('INIT', { stage: 'pipeline-complete', reason: reason || '-' });
        })
        .catch((err) => {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);
          const errStack = err && err.stack ? err.stack : errText;
          console.error('[ChatGPT toolbox] init upload groups failed', err);
          setStatus(`上传队列初始化失败：${errText}`, 'error');
          ToolboxShell.appendLog(
            `[UPLOAD_INIT][FAILED] reason=${reason || '-'} stage=loadGroups-refreshCounts-loadQueue-render type=${errName} error=${errStack}`,
          );
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-failed');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'pipeline-failed', reason: reason || '-' });
          render();
          throw err;
        });
    }

    function mount(targetHost) {
      if (!targetHost) {
        console.error('[ChatGPT toolbox] UploadModule.mount: targetHost 为空');
        ToolboxShell.appendLog('[UPLOAD][mount-failed] targetHost empty');
        uploadModuleInitPromise = Promise.resolve();
        return uploadModuleInitPromise;
      }

      const existed = targetHost.querySelector('#cgpt-upload-module');
      if (existed) {
        host = targetHost;
        restoreUploadDomRefs(existed);
        ToolboxShell.appendLog('[UPLOAD][mount-reuse-dom] rebind refs and reinit groups');
        uploadModuleInitPromise = runUploadModuleInitPipeline(existed, 'mount-reuse-dom');
        return uploadModuleInitPromise;
      }

      host = targetHost;

      const rootEl = document.createElement('div');
      rootEl.id = 'cgpt-upload-module';
      rootEl.innerHTML = `
        ${buildUploadActionToolbarHtml()}
        <div class="cgpt-section toolbox-upload-drop-zone">
          <div class="cgpt-section-title">多文件上传</div>
          <div class="cgpt-upload-groups-head" id="cgpt-toolbox-project-stats-row">
            <div class="cgpt-upload-group-bar">
              <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
              <button type="button"
                class="cgpt-toolbox-small-btn"
                id="cgpt-upload-group-manage"
                data-action="toggle-upload-group-manage"
                title="打开/关闭文件组管理面板">管理</button>
            </div>
          </div>
          <div class="cgpt-upload-manage-panel cgpt-toolbox-hidden" id="cgpt-upload-manage-panel">
            <div class="cgpt-upload-manage-title">文件组管理</div>

            <div class="cgpt-upload-manage-layout">
              <div class="cgpt-upload-manage-left">
                <div class="cgpt-upload-manage-subtitle-row">
                  <span>全部分组</span>
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline" data-action="create-upload-group">新建</button>
                </div>
                <div class="cgpt-upload-manage-group-list" id="cgpt-upload-manage-group-list"></div>
              </div>

              <div class="cgpt-upload-manage-right">
                <div class="cgpt-upload-manage-subtitle">当前分组</div>

                <div class="cgpt-upload-manage-row">
                  <input class="cgpt-input" id="cgpt-upload-group-name-input" placeholder="当前分组名称">
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline" data-action="rename-upload-group">保存名称</button>
                </div>

                <div class="cgpt-upload-manage-row">
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline" data-action="clear-upload-group">清空当前组</button>
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline" data-action="delete-upload-group">删除当前组</button>
                </div>

                <div class="cgpt-hint">这里只管理当前文件组，不会自动上传到 ChatGPT。</div>
              </div>
            </div>

            <div class="cgpt-upload-common-settings">
              <div class="cgpt-upload-manage-subtitle">公共上传设置</div>

              <!-- Blob persistence disabled - file content no longer saved to IndexedDB -->

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                上传时加时间戳/序号（仅内存，例：file_20260523_200319_01.zip）
              </label>

              <div class="cgpt-hint">这些设置对所有文件组生效。</div>
            </div>
          </div>

          <div class="cgpt-upload-list toolbox-upload-file-list" id="cgpt-upload-list"></div>

          <div id="cgpt-upload-quick-prompts" class="cgpt-upload-quick-prompts">
            <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>
            <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups"></div>
            <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list"></div>
          </div>
        </div>
      `;

      targetHost.appendChild(rootEl);

      rootElRef = rootEl;

      panelDropEl = document.getElementById(APP.panelId);

      listEl = qs(UploadSelectors.list, rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);
      refreshUploadGroupDomRefs(rootEl);

      uploadModuleInitPromise = runUploadModuleInitPipeline(rootEl, 'mount-new-dom');

      return uploadModuleInitPromise;
    }

    async function trySendPendingAfterReplyOpportunity(runId) {
      if (!state.pendingSendAfterReply || state.pendingSendRetrying) {
        return false;
      }

      if (state.autoSendRunId !== runId) {
        return false;
      }

      if (shouldStopForeverSend(runId)) {
        resetUploadSendUiState('pending-send-after-reply:stopped', runId);
        scheduleRenderUpload('pending-send-after-reply:stopped');
        return true;
      }

      if (!detectPendingComposerPayloadForSend()) {
        resetUploadSendUiState('pending-send-after-reply:no-payload', runId);
        setStatus('待发送内容已不存在，停止等待发送', 'warn');
        scheduleRenderUpload('pending-send-after-reply:no-payload');
        return true;
      }

      const capability = getUploadPageCapability({ heavy: false });

      const canSendNow = !!(
        capability.canSendNow
        || capability.can_send_now
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.canSendNowLight === 'function'
          && ComposerApi.canSendNowLight()
        )
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.canSendNow === 'function'
          && ComposerApi.canSendNow({ maxAgeMs: 450 })
        )
      );

      const isResponding = !!(capability.isResponding || capability.is_responding);

      if (isResponding || !canSendNow) {
        return false;
      }

      state.pendingSendRetrying = true;
      state.waitingReply = false;
      state.waitingSend = true;
      state.autoSendWaiting = true;
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();

      setStatus('检测到可发送，正在自动发送...', 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:opportunity-send] runId=${runId} source=${state.pendingSendAfterReplySource || '-'}`,
      );

      scheduleRenderUpload('pending-send-after-reply:opportunity');
      stopWaitingReplyCheck();

      try {
        await sendCurrentMessageFromUploadPanel(
          state.pendingSendAfterReplySource || 'retry-after-reply',
          runId,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] pending send after reply failed', err);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:opportunity-send-error] runId=${runId} error=${errText}`,
        );
      } finally {
        if (state.pendingSendRetrying && state.pendingSendAfterReply) {
          state.pendingSendRetrying = false;
          state.waitingReply = true;
          startWaitingReplyCheck(runId, Date.now());
        }
      }

      return true;
    }

    function startWaitingReplyCheck(runId, sendStartedAt) {
      stopWaitingReplyCheck();
      invalidateReplyWaitAssistantCountCache();
      waitingReplyIdleStreak = 0;
      state.replyWaitSawBusy = false;
      state.replyWaitAssistantCountBefore = countVisibleAssistantMessagesForReplyWait(true);
      state.waitingReplyRunId = runId;
      state.waitingReplyCheckedAt = Date.now();
      logUploadSendUiState('waiting-reply-start', `runId=${runId}`, runId);

      setSendButtonState('waiting-reply', 'send-message-sent-waiting-reply');

      state.waitingReplyTimer = setInterval(function () {
        void (async function tickWaitingReplyOrSendOpportunity() {
          try {
            if (!state.waitingReply) {
              stopWaitingReplyCheck();
              return;
            }

            if (await trySendPendingAfterReplyOpportunity(runId)) {
              return;
            }

            var elapsed = Date.now() - state.waitingReplyCheckedAt;

            if (elapsed > 120000 && !state.pendingSendAfterReply) {
              logUploadSendUiState('timeout', 'waiting-reply', runId);
              finishWaitingReply('timeout');
              return;
            }

            var capability = getPageCapability('waiting-reply');
            var assistantCountNow = countVisibleAssistantMessagesForReplyWait();
            var assistantCountIncreased = assistantCountNow > state.replyWaitAssistantCountBefore;
            var stopVisible = hasRealStopButtonForCopy();

            var assistantBusy = typeof ComposerApi !== 'undefined'
              && typeof ComposerApi.isAssistantLikelyBusy === 'function'
              && ComposerApi.isAssistantLikelyBusy();

            var generatingState = isReplyGeneratingState(capability.response_state);

            if (stopVisible || assistantBusy || generatingState || assistantCountIncreased) {
              state.replyWaitSawBusy = true;
            }

            if (!capability.is_responding && !generatingState) {
              waitingReplyIdleStreak += 1;

              if (waitingReplyIdleStreak >= 2) {
                var latestAssistantTextLen = getLatestAssistantTextForCopyCheck().length;
                var hasReplyEvidence = state.replyWaitSawBusy || assistantCountIncreased;

                if (!hasReplyEvidence || latestAssistantTextLen <= 0) {
                  if (healStaleWaitingReplyStateIfNeeded('reply-done-skip')) {
                    return;
                  }

                  ToolboxShell.appendLog(
                    `[SEND_UI][reply_done_skip] runId=${runId} sawBusy=${state.replyWaitSawBusy ? 1 : 0} `
                    + `assistantIncreased=${assistantCountIncreased ? 1 : 0} textLen=${latestAssistantTextLen}`,
                  );
                  return;
                }

                if (state.pendingSendAfterReply) {
                  return;
                }

                logUploadSendUiState('reply_done', `idleStreak=${waitingReplyIdleStreak}`, runId);
                finishWaitingReply('reply_done');
              }
            } else {
              waitingReplyIdleStreak = 0;
            }
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] waiting reply check error', err);
            ToolboxShell.appendLog(`[SEND_UI][waiting-reply-check-error] error=${errText}`);
          }
        })();
      }, PRE_SEND_OPPORTUNITY_POLL_MS);
      state.waitingReplyTimerRef = state.waitingReplyTimer;
    }

    function stopWaitingReplyCheck() {
      if (state.waitingReplyTimer) {
        clearInterval(state.waitingReplyTimer);
        state.waitingReplyTimer = null;
      }
    }

    function finishWaitingReply(reason) {
      const runId = state.waitingReplyRunId;

      if (reason === 'reply_done') {
        setStatus('回复完成');

        if (
          typeof TitlePrefixModule !== 'undefined'
          && typeof TitlePrefixModule.startReplyDoneFlash === 'function'
        ) {
          const titleFlashReason = 'upload-waiting-reply-done';
          const titleFlashOptions = { intervalMs: 600, autoStopMs: 0 };
          TitlePrefixModule.startReplyDoneFlash(titleFlashReason, titleFlashOptions);

          if (typeof ToolboxShell !== 'undefined'
            && typeof ToolboxShell.flashHeaderTitleOnce === 'function') {
            ToolboxShell.flashHeaderTitleOnce('回复完成', titleFlashOptions);
          }
        }
      } else if (reason === 'timeout') {
        setStatus('等待回复超时', 'warn');
      } else if (reason === 'cancel') {
        setStatus('已取消等待回复');
      }

      resetUploadSendUiState(`waiting-reply:${reason}`, runId);
      scheduleRenderUpload(`waiting-reply:${reason || 'done'}`);
    }

    function getUploadStatus() {
      const activeFiles = getActiveGroupFiles();

      return {
        groupCount: state.groups.length,
        activeGroupId: state.activeGroupId,
        activeGroupName: getActiveGroupName(),
        selectedFileId: getSelectedFileIdForActiveGroup(),
        total: activeFiles.length,
        attached: activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length,
        failed: activeFiles.filter(isUploadFailedState).length,
        missing: activeFiles.filter((q) => q && q.state === UploadState.MISSING_FILE).length,
        running: state.running,
      };
    }

    function getUploadInitPromise() {
      return uploadModuleInitPromise || Promise.resolve();
    }

    let didLogUploadQueueLegacyFields = false;

    async function scanQueueRowsForLegacyFields() {
      if (didLogUploadQueueLegacyFields) {
        return;
      }
      didLogUploadQueueLegacyFields = true;

      if (!APP || !APP.uploadStore) {
        return;
      }

      const missingGroupIds = [];
      const legacyRowFields = [];

      try {
        const db = await openDb();
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();
          req.onerror = () => {
            reject(req.error || new Error('IndexedDB uploadStore getAll failed'));
          };
          req.onsuccess = () => {
            resolve(Array.isArray(req.result) ? req.result : []);
          };
        });

        rows.forEach((row, index) => {
          if (!row || typeof row !== 'object') {
            return;
          }
          if (!String(row.groupId || '').trim()) {
            missingGroupIds.push(`queue[${index}].groupId`);
          }
          if (Object.prototype.hasOwnProperty.call(row, 'upload_active_group_id')) {
            legacyRowFields.push(`queue[${index}].upload_active_group_id`);
          }
        });
      } catch (error) {
        console.error('[ChatGPT toolbox] scanQueueRowsForLegacyFields failed', error);
        return;
      }

      if (missingGroupIds.length) {
        const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${missingGroupIds.join(',')}`;
        console.warn(line);
        ToolboxShell.appendLog(line);
      }
      if (legacyRowFields.length) {
        const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${legacyRowFields.join(',')}`;
        console.warn(line);
        ToolboxShell.appendLog(line);
      }
    }

    async function startUploadFromBridge(payload = {}) {
      const source = String(payload.source || 'bridge_command').trim() || 'bridge_command';
      const queueResult = await startUploadFromCurrentQueue({ source });
      const result = toLegacyUploadResult(queueResult);
      const status = getUploadStatus();
      const finalResult = {
        ...(result || {}),
        upload_status: status,
        queue_result: queueResult,
      };

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][DONE] source=${source} success=${Number(finalResult.success) || 0} failed=${Number(finalResult.failed) || 0} cancelled=${finalResult.cancelled ? 1 : 0} skipped=${finalResult.skipped ? 1 : 0} total=${Number(finalResult.total) || 0} attached=${Number(status.attached) || 0}`
      );

      return finalResult;
    }

    return {
      mount,
      applyToolboxPageState,
      getStatus: getUploadStatus,
      getQuickPromptActiveCategory,
      getUploadInitPromise,
      scanQueueRowsForLegacyFields,
      refresh: () => {
        render();
        syncGlobalDocumentDropBinding();
      },
      isWaitingForReply: () => !!(
        state.waitingReply
        || state.waitingSend
        || state.autoSendWaiting
      ),
      isWaitingReplyOnly: () => !!state.waitingReply,
      isWaitingSendActive,
      refreshToolboxTopStatus: (reason = '', mode = 'heavy') => {
        const runRefresh = () => {
          const heavy = mode !== 'light';
          if (heavy) {
            ensureActiveUploadGroupIdValid('refreshToolboxTopStatus');
          }
          renderToolboxTopStatus({ heavy });
          if (heavy) {
            syncUploadGroupAppState();
          }

          if (reason && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            let turnCount = 0;
            try {
              if (typeof getLightConversationStatsForHeader === 'function') {
                const lightStats = getLightConversationStatsForHeader();
                turnCount = Number(lightStats && lightStats.dom_estimated_round_count) || 0;
              }
            } catch (statsErr) {
              const errText = statsErr && statsErr.message ? statsErr.message : String(statsErr);
              console.error('[ChatGPT toolbox] refreshToolboxTopStatus light stats failed', statsErr);
              ToolboxShell.appendLog(`[TOOLBOX_TOP_STATUS][LIGHT_STATS_FAILED] error=${errText}`);
            }
            ToolboxShell.appendLog(
              `[TOOLBOX_TOP_STATUS][refresh] reason=${reason} mode=${heavy ? 'heavy' : 'light'} `
              + `page_display_id=${getBridgePageDisplayIdText()} turn_count=${turnCount}`,
            );
          }
        };

        Promise.resolve(uploadModuleInitPromise)
          .then(runRefresh)
          .catch((err) => {
            console.error('[ChatGPT toolbox] refreshToolboxTopStatus after init failed', err);
            runRefresh();
          });
      },
      refreshToolboxTurnStatus: (reason = '', mode = 'light') => {
        const runRefresh = () => {
          const heavy = mode === 'heavy';
          if (heavy) {
            ensureActiveUploadGroupIdValid('refreshToolboxTurnStatus');
            renderToolboxTopStatus({ heavy: true });
            syncUploadGroupAppState();
            renderUploadButtonsOnly({ heavy: true });
            return;
          }

          renderToolboxPageStatusRow();
          updateChatInputStateBadge();
        };

        Promise.resolve(uploadModuleInitPromise)
          .then(runRefresh)
          .catch((err) => {
            console.error('[ChatGPT toolbox] refreshToolboxTurnStatus after init failed', err);
            runRefresh();
          });
      },
      renderUploadButtonsOnly,
      renderAllButtonStates,
      findAutoContinueButton,
      resolveAutoContinueButton,
      findAutoContinueUntilDoneButton,
      resolveAutoContinueUntilDoneButton,
      getAutoContinueButtonView,
      refreshUploadAutoContinueButton,
      refreshUploadAutoContinueUntilDoneButton,
      applyAutoContinueButtonState,
      applyAutoContinueUntilDoneButtonState,
      syncCopyContinueTaskPhase: syncCopyContinueTaskFromLegacyState,
      syncButtonTasksFromModuleState,
      applyStartUploadButtonState,
      applySendMessageButtonState,
      setUploadButtonState,
      setSendButtonState,
      cleanupLegacyCoupledButtons,
      syncUploadTaskPhase,
      syncSendTaskPhase,
      getSendTaskPhase,
      getSendTaskState,
      syncCopyTaskPhase,
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      resumeAfterForeground: async (reason = '-') => {
        const tag = String(reason || '-').trim() || '-';
        clearStaleBusySendStateOnHomeReady(`foreground-resume:${tag}`);
        healStaleSendUiStateIfNeeded('foreground-resume');
        healStaleWaitingReplyStateIfNeeded('foreground-resume');
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[UPLOAD][FOREGROUND_RESUME] reason=${tag}`);
        }
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
        scheduleRenderUpload(`foreground-resume:${tag}`);
        ensureActiveUploadGroupIdValid(`foreground-resume:${tag}`);
        renderToolboxTopStatus();
        syncUploadGroupAppState();
        if (state.running) {
          ToolboxShell.appendLog(
            `[UPLOAD][FOREGROUND_RESUME] upload_running=1 waitingReply=${state.waitingReply ? 1 : 0} waitingSend=${state.waitingSend ? 1 : 0}`,
          );
        }
      },
      startUploadFromBridge,
      startUploadFromCurrentQueue,
      startUploadForAutoQueue,
      detectComposerHasUploadPayload,
      triggerStartUpload,
      handleStartUploadClick,
      startUploadOnlyFlow,
      startManualUploadOnlyFlow,
      startSendMessageFlow,
      triggerSendFromToolbox,
      clearStaleBusySendStateOnHomeReady,
      cancelCurrentUploadSend,
      cancelUploadFlow,
      applyBridgeUploadFiles,
      getPendingUploadItems,
      getUploadCountStats,
      runCopyHotkeyContinueOnceForTaskQueue,
      stopUploadSendTask,
      stopUploadTask,
      clearUploadTransientFileRefs,
      getUploadQuotaState,
      getMessageQuotaState,
      clearUploadQuotaRecords,
      clearMessageQuotaRecords,
      recordUploadSuccess,
      recordMessageSent,
      canStartNextTaskByQuota,
      renderToolboxTopStatus,
      scheduleRenderUpload,
    };
  })();

  function stopUploadSendTask(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadSendTask === 'function') {
      UploadModule.stopUploadSendTask(source);
    }
  }

  function stopUploadTask(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadTask === 'function') {
      UploadModule.stopUploadTask(source);
    }
  }

  function clearUploadTransientFileRefs(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.clearUploadTransientFileRefs === 'function') {
      UploadModule.clearUploadTransientFileRefs(source);
    }
  }
