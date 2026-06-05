  /********************************************************************
   * AutoQueueBatchStatusPanel：批量任务状态面板 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责批量任务状态面板文本与 HTML 拼接。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态流转。
   ********************************************************************/
  const AutoQueueBatchStatusPanel = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const TASK_TERMINAL_KIND = deps.TASK_TERMINAL_KIND;
      const isTerminalConfirmOrVerificationActive = deps.isTerminalConfirmOrVerificationActive;
      const buildAutoQueueDebugEntryStatusState = deps.buildAutoQueueDebugEntryStatusState;
      const getAutoQueueDisplayStateForPanel = deps.getAutoQueueDisplayStateForPanel;
      const getModeDisplayText = deps.getModeDisplayText;
      const buildAutoQueueUserStatusSummaryHtml = deps.buildAutoQueueUserStatusSummaryHtml;
      const formatQuotaDisplayText = deps.formatQuotaDisplayText;
      const resolveAutoqStatusValueTone = deps.resolveAutoqStatusValueTone;
      const renderAutoqStatusItems = deps.renderAutoqStatusItems;
      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_BATCH_STATUS_PANEL][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }
      function isTerminalConfirmOrVerificationActiveSafe() {
        return requireFn(
          'isTerminalConfirmOrVerificationActive',
          isTerminalConfirmOrVerificationActive,
        )();
      }
      function buildAutoQueueDebugEntryStatusStateSafe(input) {
        return requireFn(
          'buildAutoQueueDebugEntryStatusState',
          buildAutoQueueDebugEntryStatusState,
        )(input);
      }
      function getAutoQueueDisplayStateForPanelSafe(modeName = '-', runStateTextOverride = '') {
        return requireFn(
          'getAutoQueueDisplayStateForPanel',
          getAutoQueueDisplayStateForPanel,
        )(modeName, runStateTextOverride);
      }
      function getModeDisplayTextSafe(mode) {
        return requireFn('getModeDisplayText', getModeDisplayText)(mode);
      }
      function buildAutoQueueUserStatusSummaryHtmlSafe(input) {
        return requireFn(
          'buildAutoQueueUserStatusSummaryHtml',
          buildAutoQueueUserStatusSummaryHtml,
        )(input);
      }
      function formatQuotaDisplayTextSafe(value) {
        return requireFn('formatQuotaDisplayText', formatQuotaDisplayText)(value);
      }
      function resolveAutoqStatusValueToneSafe(value, options = {}) {
        return requireFn(
          'resolveAutoqStatusValueTone',
          resolveAutoqStatusValueTone,
        )(value, options);
      }
      function renderAutoqStatusItemsSafe(items) {
        return requireFn('renderAutoqStatusItems', renderAutoqStatusItems)(items);
      }
      const RuntimeStatsModuleRef = typeof RuntimeStatsModule !== 'undefined'
        ? RuntimeStatsModule
        : null;
    function buildTaskPageRotateProgressText(progressSnapshot) {
      const settings = config && config.taskQueueSettings ? config.taskQueueSettings : {};
      if (settings.forceHomeBeforeEachBatchTask !== false && config.promptMode === 'task') {
        return '每个任务开始前进入主页';
      }

      const rotationSettings = progressSnapshot && progressSnapshot.rotationSettings
        ? progressSnapshot.rotationSettings
        : null;

      if (!rotationSettings || !rotationSettings.enabled) {
        return '未启用';
      }

      const threshold = Math.max(1, Number(rotationSettings.threshold) || 20);
      const current = Math.max(0, Number(progressSnapshot.currentPageDialogueCount) || 0);
      const displayCurrent = Math.min(current, threshold);

      if (current >= threshold) {
        return `当前 ${displayCurrent}/${threshold}｜下次发送前进入主页`;
      }

      return `当前 ${displayCurrent}/${threshold}｜达到 ${threshold} 次后进入主页`;
    }

    function resolveBatchStopDisplayMeta(stopReason) {
      const reason = String(stopReason || '').trim();

      if (
        reason === 'reply-classify-no-more-content'
        || reason === 'no-more-content'
        || reason === 'terminal-no-more-content'
      ) {
        return {
          displayReason: 'no-more-content',
          finalStep: 'stopped',
          batchDisplayState: 'stopped',
          statusMessage: '批量任务已停止：当前任务无更多可输出内容',
          countsAsAllDone: false,
          terminalKind: TASK_TERMINAL_KIND.NO_MORE_CONTENT,
        };
      }

      if (
        reason === 'reply-classify-blocked'
        || reason === 'blocked-need-input'
        || reason === 'need-input'
      ) {
        return {
          displayReason: 'need-input',
          finalStep: 'stopped',
          batchDisplayState: 'stopped',
          statusMessage: '批量任务已停止：需要人工处理',
          countsAsAllDone: false,
          terminalKind: TASK_TERMINAL_KIND.BLOCKED_NEED_INPUT,
        };
      }

      if (
        reason === 'all-done'
        || reason === 'all-tasks-confirmed-after-verify'
        || reason === 'all-tasks-done'
        || reason === 'batch-done-signal-confirmed'
        || reason === 'done-signal'
      ) {
        return {
          displayReason: 'all-done',
          finalStep: 'all-done',
          batchDisplayState: 'completed',
          statusMessage: '全部任务组任务完成',
          countsAsAllDone: true,
          terminalKind: TASK_TERMINAL_KIND.DONE,
        };
      }

      if (reason === 'all-done-after-failures') {
        return {
          displayReason: 'all-done-after-failures',
          finalStep: 'all-done',
          batchDisplayState: 'completed',
          statusMessage: '全部任务组任务完成（存在失败/跳过）',
          countsAsAllDone: true,
          terminalKind: TASK_TERMINAL_KIND.DONE,
        };
      }

      return {
        displayReason: reason || 'stopped',
        finalStep: 'stopped',
        batchDisplayState: 'stopped',
        statusMessage: '批量任务组已停止',
        countsAsAllDone: false,
        terminalKind: '',
      };
    }

    function normalizeBatchStopReasonForDisplay(status) {
      const snapshot = status && typeof status === 'object' ? status : {};
      const stats = typeof RuntimeStatsModuleRef !== 'undefined' && typeof RuntimeStatsModuleRef.getStats === 'function'
        ? RuntimeStatsModuleRef.getStats()
        : {};
      const completed = Number(snapshot.completedTaskCount != null ? snapshot.completedTaskCount : stats.completedTaskCount) || 0;
      const failed = Number(snapshot.failedTaskCount != null ? snapshot.failedTaskCount : stats.failedTaskCount) || 0;
      const stopped = Number(snapshot.stoppedTaskCount != null ? snapshot.stoppedTaskCount : stats.stoppedTaskCount) || 0;
      const reason = String(snapshot.stopReason || snapshot.reason || '').trim();
      const phase = String(snapshot.phase || state.phase || '');
      const currentStep = String(snapshot.currentStep || (state.taskRun && state.taskRun.currentStep) || '');

      if (
        reason === 'all-done-after-failures'
        && failed <= 0
        && stopped <= 0
      ) {
        return 'all-done';
      }

      if (
        phase === 'terminal_confirming'
        || currentStep === 'verify-upload-file'
        || currentStep === 'verify-send-prompt'
        || currentStep === 'verify-after-done-signal'
        || currentStep === 'verify-wait-reply'
        || currentStep === 'terminal-confirm-second-read'
        || isTerminalConfirmOrVerificationActiveSafe()
      ) {
        return 'terminal-confirming';
      }

      void completed;
      return reason;
    }

    function buildBatchTaskStatusPanelHtml(options) {
      const {
        taskProgress,
        pageTurnText,
        taskSentDialogueDisplay,
        runStateText,
        continueDisplay,
        replyClassifyStatus,
        replyClassifyReason,
        uploadStatusText,
        taskStepText,
        lastStopReasonText,
        lastStopClassifyHint,
        lastFailureReasonText,
        batchDisplayReasonText,
        rateLimitDisplay,
        uploadRateLimitDisplay,
        progressSnapshot,
        taskName,
      } = options;

      const strategy = progressSnapshot.autoUploadStrategy;
      const businessCount = progressSnapshot.businessMessageCount != null
        ? Number(progressSnapshot.businessMessageCount) || 0
        : 0;
      const autoUploadText = strategy && strategy.enabled
        ? (
          progressSnapshot.autoUploadCountMode === 'message'
            ? `首次已上传；业务消息 ${businessCount} 条；下次：第 ${progressSnapshot.taskAutoUploadNextAt} 条回复完成后上传；${strategy.summary}`
            : `首次已上传；下次第 ${progressSnapshot.taskAutoUploadNextAt} 轮（已计入 ${progressSnapshot.autoUploadCount} 次）；${strategy.summary}`
        )
        : (strategy ? strategy.summary : '未启用');

      const rotateProgressText = buildTaskPageRotateProgressText(progressSnapshot);

      const replyClassifyText = replyClassifyReason && replyClassifyReason !== '-'
        ? `${replyClassifyStatus}（${replyClassifyReason}）`
        : replyClassifyStatus;

      const stopReasonValue = lastStopReasonText !== '-'
        ? `${lastStopReasonText}${lastStopClassifyHint || ''}`
        : '-';

      const items = [
        { label: '任务进度', value: taskProgress },
        { label: '页面轮次', value: pageTurnText },
        { label: '状态', value: runStateText, allowStopWarn: true },
        { label: '批次累计发送', value: taskSentDialogueDisplay },

        { label: '发送额度', value: formatQuotaDisplayTextSafe(rateLimitDisplay), className: 'wide' },
        { label: '上传额度', value: formatQuotaDisplayTextSafe(uploadRateLimitDisplay), className: 'wide' },

        { label: '任务', value: taskName, className: 'wide' },
        { label: '上传', value: uploadStatusText },
        { label: '追问', value: continueDisplay },

        { label: '当前步骤', value: taskStepText, className: 'wide' },
        {
          label: '终态识别',
          value: replyClassifyText,
          className: 'wide',
          tone: replyClassifyText !== '-' ? resolveAutoqStatusValueToneSafe(replyClassifyText) : '',
        },
      ];

      const shouldShowFailureReason = (
        lastFailureReasonText
        && lastFailureReasonText !== '-'
        && (
          /失败|异常|恢复|停止/.test(String(runStateText || ''))
          || String(state.phase || '') === AUTO_QUEUE_PHASES.FAILED
          || (state.batchTask && ['failed', 'recovering', 'next_task_upload_failed', 'stopped'].includes(String(state.batchTask.displayState || '')))
        )
      );

      const debugModeEnabled = !!(config && config.taskQueueSettings && config.taskQueueSettings.debugMode);
      const statusState = buildAutoQueueDebugEntryStatusStateSafe({
        statusText: runStateText,
        failReason: shouldShowFailureReason ? lastFailureReasonText : '',
        failureReason: shouldShowFailureReason ? lastFailureReasonText : '',
      });

      const display = getAutoQueueDisplayStateForPanelSafe(getModeDisplayTextSafe('task'), runStateText);

      const summaryHtml = buildAutoQueueUserStatusSummaryHtmlSafe({
        runStateText: display.statusText,
        lastFailureReasonText,
        shouldShowFailureReason,
        statusState,
        displayState: display,
      });

      if (!debugModeEnabled) {
        return summaryHtml;
      }

      if (shouldShowFailureReason) {
        items.push({
          label: '失败原因',
          value: lastFailureReasonText,
          className: 'full',
          tone: 'is-error',
        });
      }

      if (batchDisplayReasonText && batchDisplayReasonText !== '-') {
        items.push({
          label: '状态原因',
          value: batchDisplayReasonText,
          className: 'full',
          tone: shouldShowFailureReason ? 'is-warning' : '',
        });
      }

      const homeStrategyLabel = (
        config.taskQueueSettings
        && config.taskQueueSettings.forceHomeBeforeEachBatchTask !== false
      )
        ? '回首页策略'
        : '回首页进度';

      items.push(
        { label: '自动上传', value: autoUploadText, className: 'full' },
        { label: homeStrategyLabel, value: rotateProgressText, className: 'full' },
        {
          label: '停止原因',
          value: stopReasonValue,
          className: 'full',
          tone: stopReasonValue !== '-' ? 'is-error' : '',
        },
      );

      return `${summaryHtml}<div class="cgpt-autoq-status-grid cgpt-autoq-debug-detail-grid">${renderAutoqStatusItemsSafe(items)}</div>`;
    }

    function buildLiteStatusPanelHtml(options) {
      const {
        modeText,
        pageTurnText,
        listName,
      } = options;

      const display = getAutoQueueDisplayStateForPanelSafe(modeText);
      const debugModeEnabled = !!(config && config.taskQueueSettings && config.taskQueueSettings.debugMode);
      const summaryHtml = buildAutoQueueUserStatusSummaryHtmlSafe({
        runStateText: display.statusText,
        lastFailureReasonText: '-',
        shouldShowFailureReason: false,
        statusState: buildAutoQueueDebugEntryStatusStateSafe({ statusText: display.statusText }),
        displayState: display,
      });

      if (!debugModeEnabled) {
        return summaryHtml;
      }

      const runStateText = display.state === 'running'
        ? '运行中'
        : (display.state === 'stopped' ? '已停止' : '未开始');

      return `${summaryHtml}<div class="cgpt-autoq-status-grid cgpt-autoq-debug-detail-grid">${renderAutoqStatusItemsSafe([
        { label: '模式', value: modeText },
        { label: '页面轮次', value: pageTurnText },
        { label: '列表', value: listName || '-' },
        { label: '状态', value: runStateText, allowStopWarn: true },
        { label: '追问', value: '-' },
        { label: '当前步骤', value: '-' },
      ])}</div>`;
    }

      return Object.freeze({
        buildTaskPageRotateProgressText,
        resolveBatchStopDisplayMeta,
        normalizeBatchStopReasonForDisplay,
        buildBatchTaskStatusPanelHtml,
        buildLiteStatusPanelHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueBatchStatusPanel = AutoQueueBatchStatusPanel;


