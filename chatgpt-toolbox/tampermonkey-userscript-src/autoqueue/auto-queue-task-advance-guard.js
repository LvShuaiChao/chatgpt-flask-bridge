  /********************************************************************
   * AutoQueueTaskAdvanceGuard：任务推进保护
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 负责判断当前任务回复是否允许推进到下一题。
   * 3. 不负责发送执行、不负责上传执行、不负责终止符最终验证、不负责任务运行器主循环。
   ********************************************************************/
  const AutoQueueTaskAdvanceGuard = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const TASK_REPLY_STABLE_HASH_ROUNDS = deps.TASK_REPLY_STABLE_HASH_ROUNDS;
      const TASK_DONE_SIGNAL = deps.TASK_DONE_SIGNAL;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const isTaskDoneSignalMatched = deps.isTaskDoneSignalMatched;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const failCurrentTask = deps.failCurrentTask;
      const isFailureSkipReason = deps.isFailureSkipReason;
      const markTaskBatchStepRunning = deps.markTaskBatchStepRunning;
      const setTaskBatchStep = deps.setTaskBatchStep;
      const scheduleNextBatchTaskStep = deps.scheduleNextBatchTaskStep;
      const detectComposerResponseState = deps.detectComposerResponseState;
      const getCurrentTaskReplyTextForVerify = deps.getCurrentTaskReplyTextForVerify;
      const updateCurrentTaskReplyStableState = deps.updateCurrentTaskReplyStableState;
      const getTaskQuestionTextForVerify = deps.getTaskQuestionTextForVerify;
      const detectStrictTerminalSignal = deps.detectStrictTerminalSignal;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const verifyCurrentTaskAnswerBeforeAdvance = deps.verifyCurrentTaskAnswerBeforeAdvance;
      const shouldAllowTaskAdvanceAfterVerify = deps.shouldAllowTaskAdvanceAfterVerify;
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

      function getActiveTaskProfileSafe() {
        if (typeof getActiveTaskProfile === 'function') {
          return getActiveTaskProfile();
        }
        return null;
      }

      function resolveTaskContinueSettingsSafe(task, profile, options = {}) {
        if (typeof resolveTaskContinueSettings === 'function') {
          return resolveTaskContinueSettings(task, profile, options);
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'resolveTaskContinueSettings',
          taskTitle: task && task.title ? task.title : '-',
        });
        return {
          actualDoneSignal: '',
        };
      }

      function isTaskDoneSignalMatchedSafe(text, doneSignal) {
        if (typeof isTaskDoneSignalMatched === 'function') {
          return isTaskDoneSignalMatched(text, doneSignal);
        }
        return {
          matched: String(text || '').trim() === String(doneSignal || '').trim(),
          corrupted: false,
        };
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        if (typeof ensureTaskRunVerificationFields === 'function') {
          return ensureTaskRunVerificationFields(run);
        }
        return run && typeof run === 'object' ? run : {};
      }

      function failCurrentTaskSafe(reason) {
        if (typeof failCurrentTask === 'function') {
          failCurrentTask(reason);
          return;
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'failCurrentTask',
          reason,
        });
      }

      function isFailureSkipReasonSafe(reason) {
        if (typeof isFailureSkipReason === 'function') {
          return !!isFailureSkipReason(reason);
        }
        return false;
      }

      function markTaskBatchStepRunningSafe(running) {
        if (typeof markTaskBatchStepRunning === 'function') {
          markTaskBatchStepRunning(running);
        }
      }

      function setTaskBatchStepSafe(step, task, options = {}) {
        if (typeof setTaskBatchStep === 'function') {
          setTaskBatchStep(step, task, options);
        }
      }

      function scheduleNextBatchTaskStepSafe(source, delayMs, options = {}) {
        if (typeof scheduleNextBatchTaskStep === 'function') {
          scheduleNextBatchTaskStep(source, delayMs, options);
          return;
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'scheduleNextBatchTaskStep',
          source,
          delayMs,
          reason: options && options.reason ? options.reason : '-',
        });
      }

      function detectComposerResponseStateSafe(options) {
        if (typeof detectComposerResponseState === 'function') {
          return detectComposerResponseState(options);
        }
        return null;
      }

      function getCurrentTaskReplyTextForVerifySafe(task, replyText, options = {}) {
        if (typeof getCurrentTaskReplyTextForVerify === 'function') {
          return getCurrentTaskReplyTextForVerify(task, replyText, options);
        }
        return String(replyText || '');
      }

      function updateCurrentTaskReplyStableStateSafe(replyText) {
        if (typeof updateCurrentTaskReplyStableState === 'function') {
          return updateCurrentTaskReplyStableState(replyText);
        }
        return {
          stable: true,
          stableCount: TASK_REPLY_STABLE_HASH_ROUNDS || 1,
          required: TASK_REPLY_STABLE_HASH_ROUNDS || 1,
        };
      }

      function getTaskQuestionTextForVerifySafe(task) {
        if (typeof getTaskQuestionTextForVerify === 'function') {
          return getTaskQuestionTextForVerify(task);
        }
        return String(
          (task && (task.initialPrompt || task.prompt || task.content || task.title))
          || '',
        );
      }

      function detectStrictTerminalSignalSafe(replyText, options = {}) {
        if (typeof detectStrictTerminalSignal === 'function') {
          return detectStrictTerminalSignal(replyText, options);
        }
        return {
          matched: false,
          corrupted: false,
          reason: 'missing-detectStrictTerminalSignal',
        };
      }

      function isChatGPTActuallyBusyForTaskQueueSafe() {
        if (typeof isChatGPTActuallyBusyForTaskQueue === 'function') {
          return !!isChatGPTActuallyBusyForTaskQueue();
        }
        return false;
      }

      function tryScheduleTerminalBusyOverrideSafe(reason) {
        if (typeof tryScheduleTerminalBusyOverride === 'function') {
          return !!tryScheduleTerminalBusyOverride(reason);
        }
        return false;
      }

      function verifyCurrentTaskAnswerBeforeAdvanceSafe(task, replyText, meta = {}) {
        if (typeof verifyCurrentTaskAnswerBeforeAdvance === 'function') {
          return verifyCurrentTaskAnswerBeforeAdvance(task, replyText, meta);
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'verifyCurrentTaskAnswerBeforeAdvance',
          taskTitle: task && task.title ? task.title : '-',
          source: meta && meta.source ? meta.source : '-',
        });
        return {
          ok: false,
          reason: 'verify-function-missing',
        };
      }

      function shouldAllowTaskAdvanceAfterVerifySafe(verify) {
        if (typeof shouldAllowTaskAdvanceAfterVerify === 'function') {
          return !!shouldAllowTaskAdvanceAfterVerify(verify);
        }
        return !!(verify && verify.ok);
      }

    function getTaskDoneSignalForAdvanceGuard(task) {
      const profile = getActiveTaskProfileSafe();
      const resolved = task
        ? resolveTaskContinueSettingsSafe(task, profile, { log: false })
        : null;

      if (resolved && resolved.actualDoneSignal) {
        return String(resolved.actualDoneSignal || '').trim();
      }

      if (typeof TASK_DONE_SIGNAL !== 'undefined' && TASK_DONE_SIGNAL) {
        return String(TASK_DONE_SIGNAL || '').trim();
      }

      return '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
    }

    function evaluateTaskTerminalSignalForAdvance(task, replyText, source = '-') {
      const text = String(replyText || '').replace(/\r\n/g, '\n').trim();
      const doneSignal = getTaskDoneSignalForAdvanceGuard(task);

      const result = {
        terminal: false,
        corrupted: false,
        reason: 'no-terminal-signal',
        doneSignal,
        source: String(source || '-'),
        textLen: text.length,
      };

      if (!text) {
        result.reason = 'empty-reply';
        return result;
      }

      const doneCheck = isTaskDoneSignalMatchedSafe(text, doneSignal);

      if (doneCheck && doneCheck.corrupted) {
        result.corrupted = true;
        result.reason = 'corrupted-terminal-signal';
        return result;
      }

      if (doneCheck && doneCheck.matched) {
        result.terminal = true;
        result.reason = 'done-signal-matched';
        return result;
      }

      result.reason = 'reply-without-done-signal';
      return result;
    }

    function blockTaskAdvanceForNonTerminalReply(task, replyText, source = '-') {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0);
      const terminal = evaluateTaskTerminalSignalForAdvance(task, replyText, source);

      if (terminal.corrupted) {
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED_TERMINAL_CORRUPTED] taskIndex=${taskIndex + 1} task=${task && task.title ? task.title : '-'} source=${source || '-'} textLen=${terminal.textLen}`,
        );

        failCurrentTaskSafe('corrupted-assistant-signal');
        return {
          blocked: true,
          fatal: true,
          reason: 'corrupted-assistant-signal',
          terminal,
        };
      }

      if (terminal.terminal) {
        return {
          blocked: false,
          fatal: false,
          reason: 'done-signal-matched',
          terminal,
        };
      }

      appendLogSafe(
        `[TASK_ADVANCE][BLOCKED_NON_TERMINAL] taskIndex=${taskIndex + 1} task=${task && task.title ? task.title : '-'} source=${source || '-'} reason=${terminal.reason} textLen=${terminal.textLen} action=continue-current-task`,
      );

      return {
        blocked: true,
        fatal: false,
        reason: terminal.reason || 'reply-without-done-signal',
        terminal,
      };
    }

    function scheduleContinueCurrentTaskAfterBlockedAdvance(task, source = '-') {
      if (isFailureSkipReasonSafe(source)) {
        appendLogSafe(
          `[TASK_ADVANCE][CONTINUE_CURRENT_TASK_SKIPPED] task=${task && task.title ? task.title : '-'} `
          + `source=${source || '-'} reason=failure-skip-not-retriable`,
        );
        return;
      }

      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});

      run.pendingSendKind = null;
      run.pendingReplyKind = null;
      state.taskRun = run;

      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;

      markTaskBatchStepRunningSafe(false);
      setTaskBatchStepSafe('check-done-signal', task, { log: false });

      appendLogSafe(
        `[TASK_ADVANCE][CONTINUE_CURRENT_TASK_SCHEDULED] task=${task && task.title ? task.title : '-'} source=${source || '-'} action=reply-ready-retry`,
      );

      scheduleNextBatchTaskStepSafe('reply-ready-retry', 0, {
        reason: 'non-terminal-reply-needs-continue',
        clearWaiting: false,
        advanceTask: false,
      });
    }

    function canAdvanceToNextTaskAfterVerify(task, replyText, meta = {}) {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const source = String(meta && meta.source ? meta.source : '-');
      const taskIndex = Number(run.currentIndex || 0);
      const ctx = meta && typeof meta === 'object' ? meta : {};
      const responseStateText = String(
        ctx.responseState != null
          ? ctx.responseState
          : (
            typeof detectComposerResponseState === 'function'
              ? ((detectComposerResponseStateSafe({ light: true }) || {}).response_state || '')
              : ''
          ),
      ).trim().toLowerCase();
      const running = ctx.running != null ? !!ctx.running : !!state.running;
      const waitingReply = ctx.waitingReply != null ? !!ctx.waitingReply : !!state.waitingReply;
      const finalReplyText = getCurrentTaskReplyTextForVerifySafe(task, replyText, {
        preferOriginalTaskReply: ctx.preferOriginalTaskReply === true,
      });
      const stableState = updateCurrentTaskReplyStableStateSafe(finalReplyText);

      run.currentReplyText = finalReplyText;
      run.currentReplyStable = !!stableState.stable;
      run.currentQuestionText = String(run.currentTaskQuestionText || getTaskQuestionTextForVerifySafe(task) || '').trim();
      run.currentExpectedAnswer = String(run.currentTaskExpectedAnswer || '').trim();
      run.currentVerifyAttempt = Math.max(
        Number(run.currentVerifyAttempt) || 0,
        Number(run.currentTaskVerifyAttempt) || 0,
      );

      if (!running) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'not-running';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=not-running source=${source}`,
        );
        return {
          ok: false,
          reason: 'not-running',
        };
      }

      if (waitingReply) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'waiting-reply';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=waiting-reply source=${source}`,
        );
        return {
          ok: false,
          reason: 'waiting-reply',
        };
      }

      if (run.afterTerminalConfirmWaitingVerify || run.doneSignalVerificationRunning) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'terminal-final-verify-pending';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=terminal-final-verify-pending source=${source}`,
        );
        return {
          ok: false,
          reason: 'terminal-final-verify-pending',
        };
      }

      const strictTerminal = detectStrictTerminalSignalSafe(finalReplyText, { source });
      const terminalVerified = !!state.terminalConfirmPassed;

      if (
        !terminalVerified
        && strictTerminal.matched
        && (responseStateText === 'generating' || isChatGPTActuallyBusyForTaskQueueSafe())
      ) {
        tryScheduleTerminalBusyOverrideSafe(`can-advance-busy:${source}`);
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'terminal-verify-pending';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=terminal-verify-pending source=${source}`,
        );
        return {
          ok: false,
          reason: 'terminal-verify-pending',
        };
      }

      if (!terminalVerified && responseStateText === 'generating') {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'assistant-still-busy';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=assistant-still-busy source=${source}`,
        );
        return {
          ok: false,
          reason: 'assistant-still-busy',
        };
      }

      if (!terminalVerified && config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueueSafe()) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'assistant-still-busy';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=assistant-still-busy source=${source}`,
        );
        return {
          ok: false,
          reason: 'assistant-still-busy',
        };
      }

      if (!finalReplyText) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'empty-reply';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=empty-reply source=${source}`,
        );
        return {
          ok: false,
          reason: 'empty-reply',
        };
      }

      if (!stableState.stable) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'reply-not-stable';
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=reply-not-stable `
          + `stableCount=${stableState.stableCount}/${stableState.required || TASK_REPLY_STABLE_HASH_ROUNDS} source=${source}`,
        );
        return {
          ok: false,
          reason: 'reply-not-stable',
        };
      }

      const verify = verifyCurrentTaskAnswerBeforeAdvanceSafe(task, finalReplyText, {
        source,
      });

      if (!shouldAllowTaskAdvanceAfterVerifySafe(verify)) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = String(verify.reason || 'not-verified');
        appendLogSafe(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=${verify.reason || 'not-verified'} source=${source}`,
        );
        return verify;
      }

      run.currentAnswerVerified = true;
      run.currentVerifyError = '';
      const advanceReason = verify.reason === 'no-math-expectation' || verify.terminalConfirmed
        ? 'terminal-confirm-passed'
        : 'answer-verified';
      appendLogSafe(
        `[TASK_ADVANCE][ALLOW] taskIndex=${taskIndex + 1} reason=${advanceReason} source=${source}`,
      );

      return {
        ok: true,
        reason: advanceReason,
      };
    }


      return Object.freeze({
        getTaskDoneSignalForAdvanceGuard,
        evaluateTaskTerminalSignalForAdvance,
        blockTaskAdvanceForNonTerminalReply,
        scheduleContinueCurrentTaskAfterBlockedAdvance,
        canAdvanceToNextTaskAfterVerify,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueTaskAdvanceGuard = AutoQueueTaskAdvanceGuard;


