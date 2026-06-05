  /********************************************************************
   * AutoQueueUserStatusSummary：自动队列用户状态摘要卡片
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责用户状态提示、当前任务摘要、耗时摘要、状态卡片 HTML。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态流转。
   ********************************************************************/
  const AutoQueueUserStatusSummary = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const escapeHtml = deps.escapeHtml;
      const shouldShowIdleState = deps.shouldShowIdleState;
      const shouldShowStoppedState = deps.shouldShowStoppedState;
      const getCurrentBatchTaskInfo = deps.getCurrentBatchTaskInfo;
      const getEditedTaskId = deps.getEditedTaskId;
      const buildAutoQueueDebugEntryStatusState = deps.buildAutoQueueDebugEntryStatusState;
      const RuntimeStatsModuleRef = deps.RuntimeStatsModuleRef
        || (typeof RuntimeStatsModule !== 'undefined' ? RuntimeStatsModule : null);
      const ListModeRunnerRef = deps.ListModeRunnerRef
        || (typeof globalThis !== 'undefined' ? globalThis.ListModeRunner : null);
      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
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
      function getCurrentBatchTaskInfoSafe(source) {
        if (typeof getCurrentBatchTaskInfo === 'function') {
          return getCurrentBatchTaskInfo(source);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][DEPENDENCY_MISSING]', {
          name: 'getCurrentBatchTaskInfo',
          source,
        });
        return {
          total: 0,
          displayIndex: '-',
          title: '-',
          taskId: '-',
          phase: '-',
          step: '-',
          taskStatus: '-',
          sentCount: 0,
          continueCount: 0,
          businessSentCount: 0,
          currentTaskInitialSent: false,
          currentTaskContinueCount: 0,
          batchTotalSentCount: 0,
          verifySentCount: 0,
          waitingReply: false,
          replyWaitText: '-',
          batchRunning: false,
        };
      }
      function getEditedTaskIdSafe() {
        if (typeof getEditedTaskId === 'function') {
          return getEditedTaskId();
        }
        return '';
      }
      function buildAutoQueueDebugEntryStatusStateSafe(input) {
        if (typeof buildAutoQueueDebugEntryStatusState === 'function') {
          return buildAutoQueueDebugEntryStatusState(input);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][DEPENDENCY_MISSING]', {
          name: 'buildAutoQueueDebugEntryStatusState',
        });
        return input && typeof input === 'object' ? input : {};
      }
    function getAutoQueueUserActionHint(statusState = {}) {
      if (shouldShowIdleStateSafe()) {
        return '';
      }
      const text = [
        statusState.status,
        statusState.statusText,
        statusState.failReason,
        statusState.failureReason,
        statusState.uploadStatus,
        statusState.error,
        statusState.lastError,
      ].filter(Boolean).join(' ');
      if (/Maximum call stack size exceeded|call stack/i.test(text)) {
        return '检测到脚本递归或重复触发异常，建议复制错误日志后刷新页面，并检查是否重复绑定事件。';
      }
      if (/initial_pay|上传失败|upload failed|attachments|附件/i.test(text)) {
        return '检测到上传或附件状态异常，建议先复制错误日志，再重新上传文件；如果连续失败，请刷新页面后重试。';
      }
      if (/timeout|超时|等待/i.test(text)) {
        return '检测到等待超时，建议确认 ChatGPT 是否还在生成回复，必要时停止当前任务后继续下一条。';
      }
      if (/cancelled|canceled|用户取消|已停止/i.test(text)) {
        if (!shouldShowStoppedStateSafe()) {
          return '';
        }
        return '任务已停止；如果不是主动停止，请查看失败原因并复制错误日志排查。';
      }
      if (/not found|找不到|按钮|selector|input/i.test(text)) {
        return '检测到页面元素识别异常，建议刷新页面后重试；如果仍失败，请打开诊断详情检查按钮和输入框状态。';
      }
      if (/失败|异常|错误|failed|error|exception/i.test(text)) {
        return '检测到异常，建议复制错误日志并查看诊断详情。';
      }
      return '';
    }

    function buildAutoQueueTimingSummaryText() {
      if (typeof RuntimeStatsModuleRef === 'undefined' || typeof RuntimeStatsModuleRef.getStats !== 'function') {
        return '-';
      }
      const stats = RuntimeStatsModuleRef.getStats();
      const now = Date.now();
      const formatDuration = typeof RuntimeStatsModuleRef.formatDuration === 'function'
        ? RuntimeStatsModuleRef.formatDuration.bind(RuntimeStatsModuleRef)
        : (ms) => String(ms || 0);
      const formatDurationDisplay = typeof RuntimeStatsModuleRef.formatDurationDisplay === 'function'
        ? RuntimeStatsModuleRef.formatDurationDisplay.bind(RuntimeStatsModuleRef)
        : formatDuration;
      const formatTimeTextForUi = typeof RuntimeStatsModuleRef.formatTimeTextForUi === 'function'
        ? RuntimeStatsModuleRef.formatTimeTextForUi.bind(RuntimeStatsModuleRef)
        : (value) => String(value || '-');

      const appMs = stats.appStartedAt > 0 ? now - stats.appStartedAt : 0;
      const batchMs = stats.batchStartedAt > 0
        ? (stats.running
          ? now - stats.batchStartedAt
          : (stats.batchEndedAt > stats.batchStartedAt
            ? stats.batchEndedAt - stats.batchStartedAt
            : 0))
        : 0;
      const currentMs = stats.currentTaskStartedAt > 0 ? now - stats.currentTaskStartedAt : 0;
      const totalRunText = formatTimeTextForUi(formatDuration(appMs));
      const batchRunText = formatTimeTextForUi(formatDurationDisplay(batchMs, { notStarted: !stats.batchStartedAt }));
      const replyText = formatTimeTextForUi(formatDuration(currentMs));
      return `总运行 ${totalRunText} | 本轮批量 ${batchRunText} | 本次回复 ${replyText}`;
    }

    function renderAutoQueueUserStatusRow(label, value, options = {}) {
      const safeLabel = escapeHtmlSafe(label);
      const safeValue = escapeHtmlSafe(value == null || value === '' ? '-' : String(value));
      const extraClass = options.className ? ` ${options.className}` : '';
      const valueClassExtra = options.valueClassName ? ` ${escapeHtmlSafe(options.valueClassName)}` : '';
      const valueTitle = options.valueTitle
        ? ` title="${escapeHtmlSafe(String(options.valueTitle))}"`
        : '';
      return `
        <div class="cgpt-autoq-status-row cgpt-batch-status-row${extraClass}">
          <span class="cgpt-autoq-status-label cgpt-batch-status-label">${safeLabel}</span>
          <span class="cgpt-autoq-status-value cgpt-batch-status-value${valueClassExtra}"${valueTitle}>${safeValue}</span>
        </div>`;
    }

    function buildCurrentListTaskSummaryHtml() {
      if (config.promptMode !== 'list') {
        return '';
      }
      const listSnap = typeof ListModeRunnerRef !== 'undefined'
        ? ListModeRunnerRef.getListModeProgressSnapshot()
        : null;
      if (!listSnap) {
        return '';
      }
      const indexText = listSnap.total > 0
        ? `第 ${listSnap.currentIndex} / ${listSnap.total} 个`
        : '第 - / - 个';
      const titleText = listSnap.currentTaskTitle || '-';
      const taskLineValue = `${indexText} | ${titleText}`;
      return renderAutoQueueUserStatusRow('当前任务', taskLineValue, {
        className: 'cgpt-current-task-row',
        valueClassName: 'cgpt-current-task-value',
      });
    }

    function buildCurrentBatchTaskSummaryHtml(source = 'render-batch-status-card') {
      if (config.promptMode !== 'task') {
        return '';
      }
      const info = getCurrentBatchTaskInfoSafe(source);
      const indexText = info.total > 0
        ? `第 ${info.displayIndex} / ${info.total} 个`
        : '第 - / - 个';
      const titleText = info.title || '-';
      const taskLineValue = `${indexText} | ${titleText}`;
      const tooltip = [
        `任务：${titleText}`,
        `taskId：${info.taskId}`,
        `phase：${info.phase}`,
        `step：${info.step}`,
        `status：${info.taskStatus}`,
        `sentCount：${info.sentCount}`,
        `continueCount：${info.continueCount}`,
      ].join('\n');
      const businessSent = Math.max(0, Number(info.businessSentCount || info.sentCount || 0));
      let sendRoundValue = `业务发送 ${businessSent} 次`;
      if (!info.currentTaskInitialSent) {
        sendRoundValue += ' | 当前任务尚未发送';
      } else if ((info.currentTaskContinueCount || 0) <= 0) {
        sendRoundValue += ' | 当前任务初始已发送 | 当前任务继续 0 次';
      } else {
        sendRoundValue += ` | 当前任务继续 ${info.currentTaskContinueCount || 0} 次`;
      }
      if (info.batchTotalSentCount > 0) {
        sendRoundValue += ` | 本批次累计 ${info.batchTotalSentCount} 次`;
      }
      if (info.verifySentCount > 0) {
        sendRoundValue += ` | 校验 ${info.verifySentCount} 次`;
      }
      if (info.waitingReply && info.replyWaitText !== '-') {
        sendRoundValue += ` | 当前回复 ${info.replyWaitText}`;
      }

      let html = renderAutoQueueUserStatusRow('当前任务', taskLineValue, {
        className: 'cgpt-current-task-row',
        valueClassName: 'cgpt-current-task-value',
        valueTitle: tooltip,
      });
      if (info.batchRunning) {
        html += renderAutoQueueUserStatusRow('发送轮次', sendRoundValue, {
          className: 'cgpt-current-task-meta-row',
          valueClassName: 'cgpt-current-task-meta-value',
        });
      }
      return html;
    }

    function buildWatchdogSkipHintHtml() {
      if (config.promptMode !== 'task') {
        return '';
      }
      const skipInfo = state.batchTask && state.batchTask.lastWatchdogSkippedTask;
      if (!skipInfo || typeof skipInfo !== 'object') {
        return '';
      }
      const skippedAt = Number(skipInfo.at || 0);
      if (!skippedAt || Date.now() - skippedAt > 10 * 60 * 1000) {
        return '';
      }
      const title = String(skipInfo.title || '-');
      const reason = String(skipInfo.reason || 'watchdog-stall');
      const indexText = Number.isFinite(Number(skipInfo.taskIndex))
        ? `第 ${Number(skipInfo.taskIndex) + 1} 个`
        : '';
      return `<div class="cgpt-task-watchdog-skip-hint">提示：上一任务${indexText ? `（${indexText} | ${escapeHtmlSafe(title)}）` : `（${escapeHtmlSafe(title)}）`}因 watchdog 恢复失败已跳过（${escapeHtmlSafe(reason)}），并非正常完成。</div>`;
    }

    function buildRunningEditingMismatchHintHtml() {
      if (config.promptMode !== 'task') {
        return '';
      }
      const info = getCurrentBatchTaskInfoSafe('edit-mismatch-check');
      const editedTaskId = getEditedTaskIdSafe();
      if (!info.batchRunning || !editedTaskId || editedTaskId === info.taskId || info.taskId === '-') {
        return '';
      }
      return `<div class="cgpt-task-edit-mismatch-hint">提示：当前编辑的任务不是正在运行的任务。正在运行：第 ${info.displayIndex}/${info.total} 个 | ${escapeHtmlSafe(info.title)}</div>`;
    }

    function buildAutoQueueUserStatusSummaryHtml(options = {}) {
      const {
        runStateText = '-',
        lastFailureReasonText = '-',
        shouldShowFailureReason = false,
        statusState = {},
        displayState = null,
      } = options;
      const resolvedState = Object.assign(
        buildAutoQueueDebugEntryStatusStateSafe({ statusText: runStateText }),
        statusState,
      );
      const panelDisplay = displayState && typeof displayState === 'object'
        ? displayState
        : null;
      const userActionHint = panelDisplay && panelDisplay.adviceText
        ? String(panelDisplay.adviceText)
        : getAutoQueueUserActionHint(resolvedState);
      const failureText = shouldShowFailureReason && lastFailureReasonText && lastFailureReasonText !== '-'
        ? lastFailureReasonText
        : '';
      const timingText = buildAutoQueueTimingSummaryText();
      const cardStateAttr = panelDisplay && panelDisplay.state
        ? ` data-state="${escapeHtmlSafe(String(panelDisplay.state))}"`
        : '';
      const cardSeverityAttr = panelDisplay && panelDisplay.severity
        ? ` data-severity="${escapeHtmlSafe(String(panelDisplay.severity))}"`
        : '';
      const statusRowValue = panelDisplay && panelDisplay.statusText
        ? panelDisplay.statusText
        : (runStateText || (state.running ? '运行中' : (shouldShowIdleStateSafe() ? '未开始' : '已停止')));

      let html = `
        <div class="cgpt-autoq-user-summary cgpt-autoq-status-card cgpt-batch-status-card cgpt-status-card"${cardStateAttr}${cardSeverityAttr}>
          ${renderAutoQueueUserStatusRow('当前状态', statusRowValue)}`;
      html += buildCurrentBatchTaskSummaryHtml('render-batch-status-card');
      html += buildCurrentListTaskSummaryHtml();
      html += buildWatchdogSkipHintHtml();
      html += buildRunningEditingMismatchHintHtml();

      if (failureText) {
        html += renderAutoQueueUserStatusRow('失败原因', failureText, { className: 'cgpt-autoq-failure-row' });
      }

      if (userActionHint) {
        html += `
          <div class="cgpt-autoq-status-row cgpt-batch-status-row cgpt-autoq-user-hint-row">
            <span class="cgpt-autoq-status-label cgpt-batch-status-label">建议处理</span>
            <span class="cgpt-autoq-status-value cgpt-batch-status-value cgpt-autoq-user-hint">${escapeHtmlSafe(userActionHint)}</span>
          </div>`;
      }

      html += renderAutoQueueUserStatusRow('任务耗时', timingText);
      html += '</div>';
      return html;
    }

      return Object.freeze({
        getAutoQueueUserActionHint,
        buildAutoQueueTimingSummaryText,
        renderAutoQueueUserStatusRow,
        buildCurrentListTaskSummaryHtml,
        buildCurrentBatchTaskSummaryHtml,
        buildWatchdogSkipHintHtml,
        buildRunningEditingMismatchHintHtml,
        buildAutoQueueUserStatusSummaryHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueUserStatusSummary = AutoQueueUserStatusSummary;


