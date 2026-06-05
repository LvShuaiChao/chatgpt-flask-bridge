  /********************************************************************
   * AutoQueueVisibleDoneAndTaskVerify：可见终止符检测与任务答案验证
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责可见 done signal 稳定确认、数学答案校验、当前任务回复稳定性判断。
   * 3. 不负责 task advance guard、不负责发送执行、不负责上传执行、不负责按钮渲染。
   ********************************************************************/
  const AutoQueueVisibleDoneAndTaskVerify = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const VISIBLE_DONE_SIGNAL_STABLE_MS = deps.VISIBLE_DONE_SIGNAL_STABLE_MS;
      const TASK_REPLY_STABLE_HASH_ROUNDS = deps.TASK_REPLY_STABLE_HASH_ROUNDS;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const buildAssistantReplySnapshot = deps.buildAssistantReplySnapshot;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const isExactBatchDoneSignalText = deps.isExactBatchDoneSignalText;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isAssistantSnapshotBelongsToCurrentTask = deps.isAssistantSnapshotBelongsToCurrentTask;
      const handleTaskDoneSignal = deps.handleTaskDoneSignal;
      const failCurrentTask = deps.failCurrentTask;
      const isTaskDoneSignalMatched = deps.isTaskDoneSignalMatched;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const resolveTaskInitialPrompt = deps.resolveTaskInitialPrompt;
      const logTaskRunError = deps.logTaskRunError;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const computeSimpleTextHash = deps.computeSimpleTextHash;
      const detectComposerResponseState = deps.detectComposerResponseState;
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

      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }

      function buildAssistantReplySnapshotSafe() {
        if (typeof buildAssistantReplySnapshot === 'function') {
          return buildAssistantReplySnapshot();
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'buildAssistantReplySnapshot',
        });
        return {
          text: '',
        };
      }

      function getActiveTaskProfileSafe() {
        if (typeof getActiveTaskProfile === 'function') {
          return getActiveTaskProfile();
        }
        return null;
      }

      function resolveTaskContinueSettingsSafe(task, profile, options) {
        if (typeof resolveTaskContinueSettings === 'function') {
          return resolveTaskContinueSettings(task, profile, options);
        }
        return null;
      }

      function isExactBatchDoneSignalTextSafe(replyText, doneSignal) {
        if (typeof isExactBatchDoneSignalText === 'function') {
          return !!isExactBatchDoneSignalText(replyText, doneSignal);
        }
        return false;
      }

      function getLatestAssistantSnapshotForAutoQueueBoundarySafe(source) {
        if (typeof getLatestAssistantSnapshotForAutoQueueBoundary === 'function') {
          return getLatestAssistantSnapshotForAutoQueueBoundary(source);
        }
        return null;
      }

      function isAssistantSnapshotBelongsToCurrentTaskSafe(snapshot, source) {
        if (typeof isAssistantSnapshotBelongsToCurrentTask === 'function') {
          return !!isAssistantSnapshotBelongsToCurrentTask(snapshot, source);
        }
        return false;
      }

      function handleTaskDoneSignalSafe(task, profile, resolved, replyText, source) {
        if (typeof handleTaskDoneSignal === 'function') {
          return handleTaskDoneSignal(task, profile, resolved, replyText, source);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'handleTaskDoneSignal',
          source,
        });
        return Promise.resolve(null);
      }

      function failCurrentTaskSafe(reason, options) {
        if (typeof failCurrentTask === 'function') {
          return failCurrentTask(reason, options);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'failCurrentTask',
          reason,
        });
        return null;
      }

      function isTaskDoneSignalMatchedSafe(replyText, doneSignal) {
        if (typeof isTaskDoneSignalMatched === 'function') {
          return isTaskDoneSignalMatched(replyText, doneSignal);
        }
        return {
          matched: false,
          corrupted: false,
        };
      }

      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'onAssistantReplySettled',
          textLength: String(text || '').length,
          reason: options && options.reason ? options.reason : '-',
        });
        return null;
      }

      function resolveTaskInitialPromptSafe(task, options) {
        if (typeof resolveTaskInitialPrompt === 'function') {
          return resolveTaskInitialPrompt(task, options);
        }
        return null;
      }

      function logTaskRunErrorSafe(scope, error, taskOverride) {
        if (typeof logTaskRunError === 'function') {
          return logTaskRunError(scope, error, taskOverride);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'logTaskRunError',
          scope,
          error,
        });
        return null;
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        if (typeof ensureTaskRunVerificationFields === 'function') {
          return ensureTaskRunVerificationFields(run);
        }
        return run || {};
      }

      function computeSimpleTextHashSafe(text) {
        if (typeof computeSimpleTextHash === 'function') {
          return computeSimpleTextHash(text);
        }
        return String(text || '');
      }

      function detectComposerResponseStateSafe(options) {
        if (typeof detectComposerResponseState === 'function') {
          return detectComposerResponseState(options);
        }
        return null;
      }

    function clearVisibleDoneSignalTracking() {
      if (!state.taskRun) {
        return;
      }
      state.taskRun.visibleDoneSignalText = '';
      state.taskRun.visibleDoneSignalSeenAt = 0;
    }

    function maybeSettleTaskReplyByVisibleDoneSignal(triggerReason) {
      if (config.promptMode !== 'task' || !state.running || !state.taskRun) {
        return;
      }

      if (isChatGPTActuallyBusyForTaskQueueSafe()) {
        if (tryScheduleTerminalBusyOverrideSafe(`visible-done:${triggerReason || '-'}`)) {
          return;
        }
        return;
      }

      const task = getCurrentRunningTaskSafe();

      if (!task) {
        return;
      }

      let replyText = '';

      try {
        const snapshot = buildAssistantReplySnapshotSafe();
        replyText = String(snapshot && snapshot.text ? snapshot.text : '').trim();
      } catch (err) {
        console.error('[ChatGPT toolbox] maybeSettleTaskReplyByVisibleDoneSignal snapshot failed', err);
      }

      if (!replyText) {
        try {
          replyText = String(getLastAssistantReplyText() || '').trim();
        } catch (err) {
          console.error('[ChatGPT toolbox] maybeSettleTaskReplyByVisibleDoneSignal fallback failed', err);
        }
      }

      if (!replyText) {
        return;
      }

      const profile = getActiveTaskProfileSafe();
      const resolved = resolveTaskContinueSettingsSafe(task, profile, { log: false });

      if (isExactBatchDoneSignalTextSafe(replyText, resolved && resolved.actualDoneSignal)) {
        const visibleSnapshot = getLatestAssistantSnapshotForAutoQueueBoundarySafe(`visible-done:${triggerReason || '-'}`);
        if (!isAssistantSnapshotBelongsToCurrentTaskSafe(visibleSnapshot, `visible-done:${triggerReason || '-'}`)) {
          appendLogSafe(
            `[BATCH_FLOW][VISIBLE_DONE_SIGNAL_STALE_REJECT] source=${triggerReason || '-'} task=${task.title || '-'}`,
          );
          return;
        }

        appendLogSafe(
          `[BATCH_FLOW][VISIBLE_DONE_SIGNAL_REQUIRE_VERIFY] source=${triggerReason || '-'} task=${task.title || '-'}`,
        );

        clearVisibleDoneSignalTracking();

        void handleTaskDoneSignalSafe(
          task,
          profile,
          resolved,
          replyText,
          `visible-done:${triggerReason || '-'}`,
        ).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[AUTOQ][VISIBLE_DONE_SIGNAL_VERIFY_FAILED]', err);
          appendLogSafe(
            `[AUTOQ][VISIBLE_DONE_SIGNAL_VERIFY_FAILED] task=${task.title || '-'} reason=${errText}`,
          );
          failCurrentTaskSafe(errText || 'visible-done-signal-verify-failed');
        });

        return;
      }
      const doneCheck = isTaskDoneSignalMatchedSafe(replyText, resolved.actualDoneSignal);

      if (doneCheck.corrupted) {
        clearVisibleDoneSignalTracking();
        failCurrentTaskSafe('corrupted-assistant-signal');
        return;
      }

      if (!doneCheck.matched) {
        if (
          state.taskRun.visibleDoneSignalText
          && state.taskRun.visibleDoneSignalText !== replyText
        ) {
          clearVisibleDoneSignalTracking();
        }
        return;
      }

      const run = state.taskRun;
      const now = Date.now();
      const prevText = String(run.visibleDoneSignalText || '');
      const prevSeenAt = Number(run.visibleDoneSignalSeenAt) || 0;

      if (prevText !== replyText) {
        run.visibleDoneSignalText = replyText;
        run.visibleDoneSignalSeenAt = now;
        appendLogSafe(
          `[AUTOQ][VISIBLE_DONE_SIGNAL][SEEN] task=${task.title} stableMs=0 trigger=${triggerReason || '-'}`,
        );
        return;
      }

      const stableMs = Math.max(0, now - prevSeenAt);

      appendLogSafe(
        `[AUTOQ][VISIBLE_DONE_SIGNAL][SEEN] task=${task.title} stableMs=${stableMs} trigger=${triggerReason || '-'}`,
      );

      if (stableMs < VISIBLE_DONE_SIGNAL_STABLE_MS) {
        return;
      }

      clearVisibleDoneSignalTracking();
      appendLogSafe(
        `[AUTOQ][VISIBLE_DONE_SIGNAL][SETTLE] task=${task.title} reason=visible-done-signal-while-busy`,
      );
      void onAssistantReplySettledSafe(replyText, { reason: 'visible-done-signal-while-busy' });
    }

    function getLastAssistantReplyText() {
      if (
        typeof CopyPipeline !== 'undefined'
        && typeof CopyPipeline.getLatestAssistantReplyText === 'function'
      ) {
        const picked = CopyPipeline.getLatestAssistantReplyText({
          label: 'autoqueue-get-last-assistant',
          forceRefresh: true,
        });
        return picked && picked.ok ? String(picked.text || '').trim() : '';
      }

      console.error('[ChatGPT toolbox] getLastAssistantReplyText: CopyPipeline missing');
      return '';
    }

    function escapeRegExpForTaskVerify(text) {
      return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getTaskQuestionTextForVerify(task) {
      if (!task) {
        return '';
      }

      try {
        if (typeof resolveTaskInitialPrompt === 'function') {
          const resolved = resolveTaskInitialPromptSafe(task, { log: false });
          if (resolved && String(resolved.initialPrompt || '').trim()) {
            return String(resolved.initialPrompt || '').trim();
          }
        }
      } catch (error) {
        logTaskRunErrorSafe('[TASK_VERIFY][QUESTION_RESOLVE_ERROR]', error, task);
      }

      return String(
        task.initialPrompt
        || task.prompt
        || task.content
        || task.title
        || ''
      ).trim();
    }

    function extractMathExpectationsFromText(text) {
      const source = String(text || '');
      const results = [];
      const re = /(^|[\n\r\s])(-?\d+)\s*\+\s*(-?\d+)\s*=/g;
      let match = null;

      while ((match = re.exec(source)) !== null) {
        const left = Number(match[2]);
        const right = Number(match[3]);

        if (!Number.isFinite(left) || !Number.isFinite(right)) {
          continue;
        }

        const expected = left + right;
        results.push({
          expression: `${match[2]}+${match[3]}=`,
          expected,
          expectedText: String(expected),
          left,
          right,
        });
      }

      return results;
    }

    function extractNumberTokensForTaskVerify(text) {
      const source = String(text || '');
      const matches = source.match(/-?\d+(?:\.\d+)?/g);
      return Array.isArray(matches) ? matches : [];
    }

    function verifyMathAnswerForTask(task, replyText) {
      const questionText = getTaskQuestionTextForVerify(task);
      return verifyMathAnswer(questionText, replyText);
    }

    function verifyMathAnswer(questionText, replyText) {
      const normalizedQuestionText = String(questionText || '').trim();
      const expectations = extractMathExpectationsFromText(normalizedQuestionText);
      const reply = String(replyText || '').trim();

      if (!expectations.length) {
        return {
          ok: true,
          skipped: true,
          reason: 'no-math-expectation',
          questionText: normalizedQuestionText,
          expected: '',
          actual: '',
          replyText: reply,
        };
      }

      if (expectations.length > 1) {
        appendLogSafe(
          `[TASK_VERIFY][MULTI_MATH_WARN] count=${expectations.length} `
          + 'reason=multiple-equations-in-one-task-only-first-is-verified',
        );
      }

      const target = expectations[0];
      const numbers = extractNumberTokensForTaskVerify(reply);
      const expectedNumber = Number(target.expected);

      const numberMatched = numbers.some((item) => {
        const n = Number(item);
        return Number.isFinite(n) && n === expectedNumber;
      });

      const boundaryRe = new RegExp(
        `(^|[^0-9.-])${escapeRegExpForTaskVerify(target.expectedText)}([^0-9.]|$)`,
      );
      const textMatched = boundaryRe.test(reply);

      const ok = numberMatched || textMatched;

      return {
        ok,
        skipped: false,
        reason: ok ? 'math-answer-ok' : 'answer-mismatch',
        questionText: normalizedQuestionText,
        expression: target.expression,
        expected: target.expectedText,
        actual: numbers.join(','),
        replyText: reply,
      };
    }

    function getCurrentTaskReplyTextForVerify(task, replyText, options = {}) {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const directReply = String(replyText || '').trim();
      const savedOriginalReply = String(run.verifyReplyTextForResend || '').trim();

      if (options.preferOriginalTaskReply === true && savedOriginalReply) {
        return savedOriginalReply;
      }

      if (run.doneSignalVerificationRunning && savedOriginalReply) {
        return savedOriginalReply;
      }

      if (directReply) {
        return directReply;
      }

      if (String(run.currentTaskReplyText || '').trim()) {
        return String(run.currentTaskReplyText || '').trim();
      }

      return String(getLastAssistantReplyText() || '').trim();
    }

    function updateCurrentTaskReplyStableState(replyText) {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const reply = String(replyText || '').trim();

      if (!reply) {
        run.currentTaskReplyHash = '';
        run.currentTaskReplyHashStableCount = 0;
        run.currentTaskReplyStable = false;
        run.currentReplyStable = false;
        state.taskRun = run;
        return {
          stable: false,
          stableCount: 0,
          required: Math.max(1, Number(TASK_REPLY_STABLE_HASH_ROUNDS) || 2),
          reason: 'empty-reply',
        };
      }

      const replyHash = computeSimpleTextHashSafe(reply);

      if (run.currentTaskReplyHash === replyHash) {
        run.currentTaskReplyHashStableCount = Math.max(
          1,
          Number(run.currentTaskReplyHashStableCount) || 0,
        ) + 1;
      } else {
        run.currentTaskReplyHash = replyHash;
        run.currentTaskReplyHashStableCount = 1;
      }

      const stableCount = Number(run.currentTaskReplyHashStableCount) || 0;
      const required = Math.max(1, Number(TASK_REPLY_STABLE_HASH_ROUNDS) || 2);

      run.currentTaskReplyStable = stableCount >= required;
      run.currentTaskReplyText = reply;
      run.currentReplyText = reply;
      run.currentReplyStable = run.currentTaskReplyStable;
      state.taskRun = run;

      return {
        stable: run.currentTaskReplyStable,
        stableCount,
        required,
        reason: run.currentTaskReplyStable ? 'reply-stable' : 'reply-not-stable',
      };
    }

    function verifyCurrentTaskAnswerBeforeAdvance(task, replyText, meta = {}) {
      const run = ensureTaskRunVerificationFieldsSafe(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0);
      const source = String(meta && meta.source ? meta.source : '-');
      const reply = getCurrentTaskReplyTextForVerify(task, replyText);
      const questionText = String(run.currentTaskQuestionText || getTaskQuestionTextForVerify(task) || '').trim();
      const responseState = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseStateSafe({ light: true })
        : null;
      const responseStateText = String(
        responseState && responseState.response_state ? responseState.response_state : '',
      ).trim().toLowerCase();

      run.currentTaskVerifyAttempt = Math.max(0, Number(run.currentTaskVerifyAttempt) || 0) + 1;
      run.currentTaskReplyText = reply;
      run.currentReplyText = reply;
      run.currentQuestionText = questionText;
      run.currentExpectedAnswer = String(run.currentTaskExpectedAnswer || '').trim();
      run.currentReplyStable = !!run.currentTaskReplyStable;
      run.currentVerifyAttempt = run.currentTaskVerifyAttempt;
      run.currentAnswerVerified = !!run.currentTaskAnswerVerified;
      run.currentVerifyError = String(run.currentTaskVerifyError || '').trim();

      appendLogSafe(
        `[TASK_VERIFY][START] taskIndex=${taskIndex + 1} question=${JSON.stringify(questionText)}`,
      );

      appendLogSafe(
        `[TASK_VERIFY][REPLY_STATE] generating=${responseStateText === 'generating' ? 1 : 0} `
        + `waitingReply=${state.waitingReply ? 1 : 0} stable=${run.currentTaskReplyStable ? 1 : 0} `
        + `textLen=${reply.length}`,
      );

      if (!reply) {
        run.currentTaskQuestionText = questionText;
        run.currentTaskExpectedAnswer = '';
        run.currentTaskAnswerVerified = false;
        run.currentTaskVerifyError = 'empty-reply';
        run.currentExpectedAnswer = '';
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'empty-reply';
        appendLogSafe(
          `[TASK_VERIFY][EXPECTED] expected=-`,
        );
        appendLogSafe(
          `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
        );
        appendLogSafe(
          `[TASK_VERIFY][FAIL] taskIndex=${taskIndex + 1} reason=empty-reply`,
        );
        return {
          ok: false,
          reason: 'empty-reply',
        };
      }

      const result = verifyMathAnswerForTask(task, reply);

      run.currentTaskQuestion = String(result.questionText || '');
      run.currentTaskQuestionText = String(result.questionText || '');
      run.currentTaskExpectedAnswer = String(result.expected || '');
      run.currentTaskReplyText = reply;
      run.currentQuestionText = String(result.questionText || '');
      run.currentExpectedAnswer = String(result.expected || '');
      run.currentReplyText = reply;

      if (result.skipped) {
        const strictVerifyEnabled = !!(
          config.taskQueueSettings
          && config.taskQueueSettings.requireAnswerVerification === true
        );

        if (strictVerifyEnabled) {
          run.currentTaskAnswerVerified = false;
          run.currentTaskVerifyError = result.reason || 'no-verifier';
          run.currentAnswerVerified = false;
          run.currentVerifyError = result.reason || 'no-verifier';
          appendLogSafe(
            `[TASK_VERIFY][EXPECTED] expected=-`,
          );
          appendLogSafe(
            `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
          );
          appendLogSafe(
            `[TASK_VERIFY][FAIL] taskIndex=${taskIndex + 1} reason=${result.reason || 'no-verifier'} strict=1`,
          );
          return {
            ok: false,
            reason: result.reason || 'no-verifier',
          };
        }

        const terminalConfirmed = !!state.terminalConfirmPassed;
        run.currentTaskAnswerVerified = terminalConfirmed;
        run.currentTaskVerifyError = terminalConfirmed ? '' : 'terminal-not-confirmed';
        if (terminalConfirmed) {
          run.lastVerifiedTaskIndex = taskIndex;
        }
        run.currentAnswerVerified = terminalConfirmed;
        run.currentVerifyError = terminalConfirmed ? '' : 'terminal-not-confirmed';

        appendLogSafe(
          `[TASK_VERIFY][EXPECTED] expected=-`,
        );
        appendLogSafe(
          `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
        );
        appendLogSafe(
          `[TASK_VERIFY][SKIP] taskIndex=${taskIndex + 1} reason=${result.reason || 'no-verifier'} strict=0 `
          + `advance=${terminalConfirmed ? 1 : 0} terminalConfirmed=${terminalConfirmed ? 1 : 0}`,
        );

        if (!terminalConfirmed) {
          appendLogSafe(
            `[TASK_VERIFY][ADVANCE_BLOCKED] taskIndex=${taskIndex + 1} reason=${result.reason || 'no-math-expectation'} `
            + `terminalConfirmed=0 source=${source}`,
          );
          return {
            ok: false,
            skipped: true,
            reason: result.reason || 'no-math-expectation',
            terminalConfirmed: false,
            passed: false,
            strict: false,
          };
        }

        return {
          ok: true,
          skipped: true,
          reason: result.reason || 'no-verifier',
          terminalConfirmed: true,
          passed: true,
          strict: false,
        };
      }

      appendLogSafe(
        `[TASK_VERIFY][EXPECTED] expected=${result.expected || '-'}`,
      );

      appendLogSafe(
        `[TASK_VERIFY][ACTUAL] actual=${result.actual || '-'} replyText=${JSON.stringify(reply)}`,
      );

      if (!result.ok) {
        run.currentTaskAnswerVerified = false;
        run.currentTaskVerifyError = result.reason || 'answer-mismatch';
        run.currentAnswerVerified = false;
        run.currentVerifyError = result.reason || 'answer-mismatch';

        appendLogSafe(
          `[TASK_VERIFY][FAIL] taskIndex=${taskIndex + 1} reason=${result.reason || 'answer-mismatch'} `
          + `expected=${result.expected || '-'} actual=${result.actual || '-'}`,
        );

        return {
          ok: false,
          reason: result.reason || 'answer-mismatch',
          expected: result.expected,
          actual: result.actual,
        };
      }

      run.currentTaskAnswerVerified = true;
      run.currentTaskVerifyError = '';
      run.lastVerifiedTaskIndex = taskIndex;
      run.currentAnswerVerified = true;
      run.currentVerifyError = '';

      appendLogSafe(
        `[TASK_VERIFY][PASS] taskIndex=${taskIndex + 1} expected=${result.expected || '-'} actual=${result.actual || '-'}`,
      );

      return {
        ok: true,
        reason: 'verified',
        expected: result.expected,
        actual: result.actual,
      };
    }


      return Object.freeze({
        clearVisibleDoneSignalTracking,
        maybeSettleTaskReplyByVisibleDoneSignal,
        getLastAssistantReplyText,
        escapeRegExpForTaskVerify,
        getTaskQuestionTextForVerify,
        extractMathExpectationsFromText,
        extractNumberTokensForTaskVerify,
        verifyMathAnswerForTask,
        verifyMathAnswer,
        getCurrentTaskReplyTextForVerify,
        updateCurrentTaskReplyStableState,
        verifyCurrentTaskAnswerBeforeAdvance,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueVisibleDoneAndTaskVerify = AutoQueueVisibleDoneAndTaskVerify;


