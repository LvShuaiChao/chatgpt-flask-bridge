  /********************************************************************
   * AutoQueueDisplayState：自动队列面板运行状态判定
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责判断面板应显示 idle / running / waiting_reply / stopped 等状态。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责持久化。
   ********************************************************************/
  const AutoQueueDisplayState = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const AUTO_QUEUE_PRE_SEND_STEPS = deps.AUTO_QUEUE_PRE_SEND_STEPS;
      const TASK_RUN_STEP_LABELS = deps.TASK_RUN_STEP_LABELS;
      const getModeDisplayText = deps.getModeDisplayText;
      const getListModeTimeoutSettings = deps.getListModeTimeoutSettings;
      const isChatGPTActivelyReplyingForListMode = deps.isChatGPTActivelyReplyingForListMode;
      const getCurrentBatchTaskInfo = deps.getCurrentBatchTaskInfo;
      const getBatchTaskSuggestion = deps.getBatchTaskSuggestion;
      const getBatchTaskPanelStatusText = deps.getBatchTaskPanelStatusText;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DISPLAY_STATE][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function getModeDisplayTextSafe(mode) {
        return requireFn('getModeDisplayText', getModeDisplayText)(mode);
      }

      function getListModeTimeoutSettingsSafe() {
        return requireFn('getListModeTimeoutSettings', getListModeTimeoutSettings)();
      }

      function isChatGPTActivelyReplyingForListModeSafe(source) {
        return requireFn(
          'isChatGPTActivelyReplyingForListMode',
          isChatGPTActivelyReplyingForListMode,
        )(source);
      }

      function getCurrentBatchTaskInfoSafe(source) {
        return requireFn('getCurrentBatchTaskInfo', getCurrentBatchTaskInfo)(source);
      }

      function getBatchTaskSuggestionSafe(info, run, runtimeState) {
        return requireFn('getBatchTaskSuggestion', getBatchTaskSuggestion)(info, run, runtimeState);
      }

      function getBatchTaskPanelStatusTextSafe(info, run, runtimeState, modeLabel, runStateTextOverride) {
        return requireFn(
          'getBatchTaskPanelStatusText',
          getBatchTaskPanelStatusText,
        )(info, run, runtimeState, modeLabel, runStateTextOverride);
      }

      function getAutoQueueComposerPayloadStateSafe(source) {
        return requireFn('getAutoQueueComposerPayloadState', getAutoQueueComposerPayloadState)(source);
      }

      const ListModeRunner = typeof globalThis !== 'undefined'
        ? globalThis.ListModeRunner
        : undefined;

    function hasCurrentRunStarted() {
      const run = state.taskRun || {};
      return Boolean(
        state.running === true
        || state.batchTaskRunning === true
        || state.uploadingFromAutoQueue === true
        || state.batchAutoUploading === true
        || run.started === true
        || Number(run.startedAt || 0) > 0
        || Number(run.stoppedAt || 0) > 0
        || String(state.currentRunId || '').trim()
      );
    }

    function isAutoQueueActuallyRunning() {
      const phase = String(state.phase || '');
      const run = state.taskRun || {};
      return Boolean(
        state.running === true
        || state.batchTaskRunning === true
        || phase === AUTO_QUEUE_PHASES.PREPARING
        || phase === 'uploading'
        || phase === AUTO_QUEUE_PHASES.UPLOAD_ATTACHED
        || phase === AUTO_QUEUE_PHASES.SENDING
        || phase === AUTO_QUEUE_PHASES.SENT
        || phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        || phase === 'waiting_reply'
        || phase === AUTO_QUEUE_PHASES.REPLY_READY
        || phase === 'reply_ready'
        || phase === 'running'
        || state.waitingReply === true
        || state.sendingNow === true
        || run.sendingNow === true
      );
    }

    function shouldShowIdleState() {
      return Boolean(
        !hasCurrentRunStarted()
        && !isAutoQueueActuallyRunning()
      );
    }

    function shouldShowStoppedState() {
      if (isAutoQueueActuallyRunning()) {
        return false;
      }
      const phase = String(state.phase || '');
      const run = state.taskRun || {};
      const stopReason = state.lastTaskBatchStopReason
        ? String(state.lastTaskBatchStopReason.reason || '')
        : '';
      const batchDisplayState = state.batchTask
        ? String(state.batchTask.displayState || '')
        : '';
      return Boolean(
        (hasCurrentRunStarted() || Number(run.stoppedAt || 0) > 0 || stopReason)
        && (
          phase === AUTO_QUEUE_PHASES.CANCELLED
          || phase === 'cancelled'
          || phase === 'stopped'
          || phase === AUTO_QUEUE_PHASES.DONE
          || batchDisplayState === 'stopped'
          || batchDisplayState === 'completed'
          || run.stopReason
          || stopReason
          || Number(run.stoppedAt || 0) > 0
        )
      );
    }

    function getAutoQueueDisplayStateForPanel(modeName = '-', runStateTextOverride = '') {
      const modeLabel = String(modeName || getModeDisplayTextSafe(config.promptMode));
      const isListMode = config.promptMode === 'list';
      const isTaskMode = config.promptMode === 'task';

      if (shouldShowIdleState()) {
        return {
          state: 'idle',
          statusText: `${modeLabel} · 未开始`,
          adviceText: isListMode
            ? '请选择任务列表后，点击"开始批量任务组"。'
            : (isTaskMode
              ? '请选择任务后，点击"开始批量任务组"。'
              : '请确认指令内容后，点击"开始"。'),
          severity: 'normal',
        };
      }

      if (isAutoQueueActuallyRunning()) {
        if (isListMode) {
          const listSnap = typeof ListModeRunner !== 'undefined'
            && typeof ListModeRunner.getListModeProgressSnapshot === 'function'
            ? ListModeRunner.getListModeProgressSnapshot()
            : null;
          const listStep = listSnap ? String(listSnap.step || '') : '';
          const waitingReply = state.waitingReply
            || String(state.phase || '') === AUTO_QUEUE_PHASES.WAITING_REPLY
            || String(state.phase || '') === 'waiting_reply'
            || listStep === 'waiting-reply';
          if (waitingReply) {
            const track = state.listModeWaitTrack || {};
            const noProgressMs = track.lastProgressAt
              ? Date.now() - Number(track.lastProgressAt)
              : 0;
            const noProgressLimit = getListModeTimeoutSettingsSafe().noProgressTimeoutMs;
            const suspectNoProgress = noProgressLimit > 0 && noProgressMs >= noProgressLimit
              && !isChatGPTActivelyReplyingForListModeSafe('display-panel');
            const taskProgress = listSnap && listSnap.taskProgress ? listSnap.taskProgress : '-';
            return {
              state: 'waiting_reply',
              statusText: `列表模式 · 等待回复 · 第 ${taskProgress}`,
              adviceText: suspectNoProgress
                ? '当前任务疑似无进展，正在尝试恢复；恢复失败后将继续下一个任务。'
                : 'ChatGPT 正在回复，继续等待。不会因长回复自动停止。',
              severity: 'normal',
            };
          }
          const activeLabel = String(
            runStateTextOverride || (listSnap && listSnap.displayMessage) || '',
          ).trim() || '运行中';
          return {
            state: 'running',
            statusText: `列表模式 · ${activeLabel}`,
            adviceText: listStep === 'retry-current-send'
              ? '发送未成功，正在自动重试当前任务。'
              : (listStep === 'next-task'
                ? '上一任务已完成，准备发送下一个。'
                : '列表任务正在执行。'),
            severity: 'normal',
          };
        }
        if (isTaskMode) {
          const info = getCurrentBatchTaskInfoSafe('display-panel');
          const run = state.taskRun || {};
          const suggestion = getBatchTaskSuggestionSafe(info, run, state);
          const statusText = getBatchTaskPanelStatusTextSafe(info, run, state, modeLabel, runStateTextOverride);
          const panelState = (
            info.waitingReply
            || String(info.phase || '') === 'waiting_reply'
            || String(info.step || '') === 'wait-reply'
            || String(info.step || '') === 'wait-current-reply'
          )
            ? 'waiting_reply'
            : 'running';
          return {
            state: panelState,
            statusText,
            adviceText: suggestion,
            severity: 'normal',
          };
        }
        const phase = String(state.phase || '');
        const preSendStep = String((state.taskRun || {}).currentStep || '').trim();
        if (AUTO_QUEUE_PRE_SEND_STEPS.has(preSendStep)) {
          let preSendLabel = TASK_RUN_STEP_LABELS[preSendStep] || preSendStep;
          if (preSendStep === 'send-wait-button') {
            const evidence = getAutoQueueComposerPayloadStateSafe('display-pre-send-step');
            if (evidence.hasAttachment && evidence.textLen > 0) {
              preSendLabel = '附件已上传，等待发送';
            }
          } else if (preSendStep === 'auto-upload-before-send') {
            preSendLabel = state.batchAutoUploading ? '正在上传附件' : '准备上传初始附件';
          }
          return {
            state: 'running',
            statusText: `${modeLabel} · ${preSendLabel}`,
            adviceText: preSendStep === 'send-wait-button'
              ? '附件或指令已就绪，正在等待 ChatGPT 发送按钮出现。'
              : '任务正在运行。',
            severity: 'normal',
          };
        }
        if (
          phase === AUTO_QUEUE_PHASES.WAITING_REPLY
          || phase === 'waiting_reply'
          || state.waitingReply
        ) {
          return {
            state: 'waiting_reply',
            statusText: `${modeLabel} · 等待回复`,
            adviceText: isListMode
              ? 'ChatGPT 正在回复，继续等待。不会因长回复自动停止。'
              : '正在等待 ChatGPT 回复，请不要重复点击开始。',
            severity: 'normal',
          };
        }
        const activeLabel = String(runStateTextOverride || '').trim() || '运行中';
        return {
          state: 'running',
          statusText: `${modeLabel} · ${activeLabel}`,
          adviceText: '任务正在运行。',
          severity: 'normal',
        };
      }

      if (shouldShowStoppedState()) {
        const stopReason = String(
          (state.lastTaskBatchStopReason && state.lastTaskBatchStopReason.reason)
          || (state.taskRun && state.taskRun.stopReason)
          || '-',
        );
        const manualStop = stopReason === 'manual-stop' || stopReason === 'user-stop';
        return {
          state: 'stopped',
          statusText: `${modeLabel} · 已停止`,
          adviceText: manualStop
            ? '任务已手动停止。'
            : '任务已停止，如果不是主动停止，请查看失败原因并复制错误日志排查。',
          severity: manualStop ? 'normal' : 'warning',
        };
      }

      return {
        state: 'idle',
        statusText: `${modeLabel} · 未开始`,
        adviceText: isListMode
          ? '请选择任务列表后，点击"开始批量任务组"。'
          : (isTaskMode
            ? '请选择任务后，点击"开始批量任务组"。'
            : '请确认指令内容后，点击"开始"。'),
        severity: 'normal',
      };
    }


      return Object.freeze({
        hasCurrentRunStarted,
        isAutoQueueActuallyRunning,
        shouldShowIdleState,
        shouldShowStoppedState,
        getAutoQueueDisplayStateForPanel,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDisplayState = AutoQueueDisplayState;


