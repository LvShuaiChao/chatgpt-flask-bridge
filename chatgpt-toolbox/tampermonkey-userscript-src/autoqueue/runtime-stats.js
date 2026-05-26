  /********************************************************************
   * RuntimeStatsModule：批量任务组运行计时统计
   ********************************************************************/

  const RuntimeStatsModule = (() => {
    const runtimeStats = {
      appStartedAt: 0,

      batchStartedAt: 0,
      batchEndedAt: 0,

      currentTaskStartedAt: 0,
      currentTaskId: '',
      currentTaskTitle: '',

      lastTaskDurationMs: 0,
      completedTaskDurationsMs: [],
      completedTaskCount: 0,

      totalTaskCount: 0,
      running: false,
      successRuns: 0,
      failedRuns: 0,

      currentPhase: '等待发送',
    };

    let statsLine1El = null;
    let statsLine2El = null;
    let phaseLineEl = null;
    let refreshTimer = null;
    let lastRenderKey = '';
    let lastStatsLogKey = '';

    const REFRESH_INTERVAL_OPTIONS = [1000, 2000, 5000];

    function getTaskQueueSettings() {
      if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.getConfig === 'function') {
        const cfg = AutoQueueModule.getConfig();
        if (cfg && cfg.taskQueueSettings && typeof cfg.taskQueueSettings === 'object') {
          return cfg.taskQueueSettings;
        }
      }
      if (typeof createDefaultTaskQueueSettings === 'function') {
        return createDefaultTaskQueueSettings();
      }
      return {
        showRuntimeStats: true,
        preserveRuntimeStatsAverage: false,
        runtimeStatsRefreshIntervalMs: 1000,
      };
    }

    function normalizeRefreshIntervalMs(value) {
      const n = Number(value);
      if (REFRESH_INTERVAL_OPTIONS.includes(n)) {
        return n;
      }
      return 1000;
    }

    function isShowRuntimeStatsEnabled() {
      const settings = getTaskQueueSettings();
      return settings.showRuntimeStats !== false;
    }

    function logRuntime(event, payload = {}) {
      const parts = [
        `[RUN_TIME][${event}]`,
        `taskId=${payload.taskId || '-'}`,
        `taskTitle=${payload.taskTitle || '-'}`,
        `durationMs=${payload.durationMs != null ? payload.durationMs : '-'}`,
        `completedTaskCount=${payload.completedTaskCount != null ? payload.completedTaskCount : runtimeStats.completedTaskCount}`,
        `totalTaskCount=${payload.totalTaskCount != null ? payload.totalTaskCount : runtimeStats.totalTaskCount}`,
        `averageDurationMs=${payload.averageDurationMs != null ? payload.averageDurationMs : getAverageDurationMs()}`,
        `estimatedRemainingMs=${payload.estimatedRemainingMs != null ? payload.estimatedRemainingMs : getEstimatedRemainingMs()}`,
      ];

      if (payload.reason) {
        parts.push(`reason=${payload.reason}`);
      }

      const line = parts.join(' ');

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.log(line);
      }
    }

    const CGPT_TIME_EMPTY_PLACEHOLDER = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0';

    function formatTimeTextForUi(value) {
      if (value === null || value === undefined) {
        return CGPT_TIME_EMPTY_PLACEHOLDER;
      }
      const text = String(value).trim();
      if (!text) {
        return CGPT_TIME_EMPTY_PLACEHOLDER;
      }
      if (text === '-' || text === '--' || text === '--:--' || text === '--:--:--') {
        return CGPT_TIME_EMPTY_PLACEHOLDER;
      }
      if (text === 'null' || text === 'undefined' || text === 'NaN' || text === 'NaN:NaN:NaN') {
        return CGPT_TIME_EMPTY_PLACEHOLDER;
      }
      return text;
    }

    function formatDurationMs(ms) {
      const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      if (minutes <= 0) {
        return `${seconds}s`;
      }

      return `${minutes}m ${seconds}s`;
    }

    function formatDuration(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n < 0) {
        return '00:00:00';
      }
      const totalSec = Math.floor(n / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatDurationDisplay(ms, options = {}) {
      if (options.notStarted || options.pending) {
        return '';
      }
      return formatDuration(ms);
    }

    function getAverageDurationMs() {
      const count = runtimeStats.completedTaskCount;
      if (!count) {
        return 0;
      }
      const total = runtimeStats.completedTaskDurationsMs.reduce((sum, item) => sum + item, 0);
      return Math.round(total / count);
    }

    function getEstimatedRemainingMs() {
      const avg = getAverageDurationMs();
      if (!avg || !runtimeStats.totalTaskCount) {
        return 0;
      }
      const remaining = Math.max(0, runtimeStats.totalTaskCount - runtimeStats.completedTaskCount);
      return avg * remaining;
    }

    function resolveTaskPhase(stepKey, context = {}) {
      const step = String(stepKey || 'idle');
      const verifying = !!(context.doneSignalVerificationRunning || step.startsWith('verify'));
      const waitingReply = !!context.waitingReply;
      const sendingNow = !!context.sendingNow;
      const running = context.running !== false;
      const stopReason = String(context.stopReason || '').trim();
      const sendRetryReason = String(context.sendRetryReason || '').trim();

      if (step === 'all-done' || step === 'next-task' || context.taskStatus === 'completed') {
        return '已完成';
      }
      if (step === 'send-wait-retry' || step === 'send-initial-wait-retry') {
        return sendRetryReason
          ? `发送重试中：${sendRetryReason}`
          : '发送重试中';
      }
      if (step === 'stopped') {
        if (!running) {
          return stopReason ? `已停止：${stopReason}` : '已停止';
        }
        return '已停止';
      }
      if (verifying) {
        return '复核中';
      }
      if (step === 'check-done-signal' || step === 'initial-reply-done') {
        return '等待终止判断';
      }
      if (
        step === 'wait-reply'
        || step === 'wait-next-reply'
        || step === 'wait-verify-reply'
        || (waitingReply && (step.includes('reply') || step.includes('wait')))
      ) {
        return '回答中';
      }
      if (
        step === 'wait-initial-reply'
        || step === 'wait-current-reply'
        || (waitingReply && !step.includes('verify'))
      ) {
        return '已发送等待回答';
      }
      if (sendingNow || step.includes('send') || step.includes('write') || step.includes('copy')
        || step.includes('upload') || step.includes('rate-limit') || step.includes('new-chat')
        || step === 'auto-upload-before-send' || step === 'idle') {
        return '等待发送';
      }
      return '等待发送';
    }

    function bindDom(hostEl) {
      if (!hostEl) {
        return;
      }
      statsLine1El = hostEl.querySelector('#cgpt-autoq-runtime-stats-line-1');
      statsLine2El = hostEl.querySelector('#cgpt-autoq-runtime-stats-line-2');
      phaseLineEl = hostEl.querySelector('#cgpt-autoq-runtime-phase-line');
      syncStatsVisibility();
    }

    function syncStatsVisibility() {
      const show = isShowRuntimeStatsEnabled();
      [statsLine1El, statsLine2El, phaseLineEl].forEach((el) => {
        if (!el) return;
        el.classList.toggle('cgpt-toolbox-hidden', !show);
      });
    }

    function buildRenderKey(now, includeTick = true) {
      const parts = [
        runtimeStats.batchStartedAt,
        runtimeStats.batchEndedAt,
        runtimeStats.running ? 1 : 0,
        runtimeStats.currentTaskStartedAt,
        runtimeStats.lastTaskDurationMs,
        runtimeStats.completedTaskCount,
        runtimeStats.totalTaskCount,
        runtimeStats.currentPhase,
        isShowRuntimeStatsEnabled() ? 1 : 0,
      ];
      if (includeTick) {
        parts.push(Math.floor(now / 1000));
      }
      return parts.join('|');
    }

    function renderRuntimeStats(force = false) {
      syncStatsVisibility();

      if (!isShowRuntimeStatsEnabled()) {
        return;
      }

      const now = Date.now();
      const renderKey = buildRenderKey(now, true);
      if (!force && renderKey === lastRenderKey) {
        return;
      }
      lastRenderKey = renderKey;

      const appMs = runtimeStats.appStartedAt > 0 ? now - runtimeStats.appStartedAt : 0;
      const batchMs = runtimeStats.batchStartedAt > 0
        ? (runtimeStats.running
          ? now - runtimeStats.batchStartedAt
          : (runtimeStats.batchEndedAt > runtimeStats.batchStartedAt
            ? runtimeStats.batchEndedAt - runtimeStats.batchStartedAt
            : 0))
        : 0;
      const currentMs = runtimeStats.currentTaskStartedAt > 0
        ? now - runtimeStats.currentTaskStartedAt
        : 0;
      const avgMs = getAverageDurationMs();
      const etaMs = getEstimatedRemainingMs();

      const line1 = `计时：运行 ${formatTimeTextForUi(formatDuration(appMs))}｜批量 ${formatTimeTextForUi(formatDurationDisplay(batchMs, { notStarted: !runtimeStats.batchStartedAt }))}｜当前 ${formatTimeTextForUi(formatDurationDisplay(currentMs, { pending: !runtimeStats.currentTaskStartedAt }))}`;
      const line2 = `耗时：上次 ${formatTimeTextForUi(formatDurationDisplay(runtimeStats.lastTaskDurationMs, { pending: !runtimeStats.lastTaskDurationMs }))}｜平均 ${formatTimeTextForUi(formatDurationDisplay(avgMs, { pending: !runtimeStats.completedTaskCount }))}｜预计剩余 ${formatTimeTextForUi(formatDurationDisplay(etaMs, { pending: !runtimeStats.completedTaskCount }))}｜完成 ${runtimeStats.completedTaskCount}/${runtimeStats.totalTaskCount || 0}`;
      const phaseLine = `当前任务阶段：${runtimeStats.currentPhase || '等待发送'}`;

      if (statsLine1El) {
        statsLine1El.textContent = line1;
      }
      if (statsLine2El) {
        statsLine2El.textContent = line2;
      }
      if (phaseLineEl) {
        phaseLineEl.textContent = phaseLine;
      }

      const statsLogKey = buildRenderKey(now, false);
      if (force || statsLogKey !== lastStatsLogKey) {
        lastStatsLogKey = statsLogKey;
        logRuntime('STATS_RENDER', {
          durationMs: currentMs,
          averageDurationMs: avgMs,
          estimatedRemainingMs: etaMs,
        });
      }
    }

    function restartRefreshTimer() {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }

      const intervalMs = normalizeRefreshIntervalMs(getTaskQueueSettings().runtimeStatsRefreshIntervalMs);
      refreshTimer = window.setInterval(() => {
        renderRuntimeStats(false);
      }, intervalMs);
    }

    function onAppStart() {
      if (!runtimeStats.appStartedAt) {
        runtimeStats.appStartedAt = Date.now();
        logRuntime('APP_START', {});
      }
      restartRefreshTimer();
      renderRuntimeStats(true);
    }

    function resetBatchTimingFields(options = {}) {
      const preserveAverage = options.preserveAverage === true
        || getTaskQueueSettings().preserveRuntimeStatsAverage === true;

      runtimeStats.batchStartedAt = 0;
      runtimeStats.batchEndedAt = 0;
      runtimeStats.currentTaskStartedAt = 0;
      runtimeStats.currentTaskId = '';
      runtimeStats.currentTaskTitle = '';
      runtimeStats.lastTaskDurationMs = 0;
      runtimeStats.totalTaskCount = 0;
      runtimeStats.running = false;
      runtimeStats.currentPhase = '等待发送';

      if (!preserveAverage) {
        runtimeStats.completedTaskDurationsMs = [];
        runtimeStats.completedTaskCount = 0;
        runtimeStats.successRuns = 0;
        runtimeStats.failedRuns = 0;
      }
    }

    function onBatchStart(totalTaskCount) {
      const settings = getTaskQueueSettings();
      if (!settings.preserveRuntimeStatsAverage) {
        runtimeStats.completedTaskDurationsMs = [];
        runtimeStats.completedTaskCount = 0;
        runtimeStats.lastTaskDurationMs = 0;
        runtimeStats.successRuns = 0;
        runtimeStats.failedRuns = 0;
      }

      runtimeStats.batchStartedAt = Date.now();
      runtimeStats.batchEndedAt = 0;
      runtimeStats.running = true;
      runtimeStats.totalTaskCount = Math.max(0, Number(totalTaskCount) || 0);
      runtimeStats.currentTaskStartedAt = 0;
      runtimeStats.currentTaskId = '';
      runtimeStats.currentTaskTitle = '';
      runtimeStats.currentPhase = '等待发送';

      logRuntime('BATCH_START', {
        totalTaskCount: runtimeStats.totalTaskCount,
      });
      renderRuntimeStats(true);
    }

    function onBatchStop(reason = '') {
      if (runtimeStats.running && runtimeStats.batchStartedAt > 0) {
        runtimeStats.batchEndedAt = Date.now();
      }
      runtimeStats.running = false;

      if (runtimeStats.currentTaskStartedAt > 0) {
        logRuntime('TASK_FAIL', {
          taskId: runtimeStats.currentTaskId,
          taskTitle: runtimeStats.currentTaskTitle,
          reason: reason || 'batch-stopped',
          durationMs: Date.now() - runtimeStats.currentTaskStartedAt,
        });
        runtimeStats.currentTaskStartedAt = 0;
        runtimeStats.currentTaskId = '';
        runtimeStats.currentTaskTitle = '';
      }

      logRuntime('BATCH_STOP', { reason: reason || '-' });
      renderRuntimeStats(true);
    }

    function onTaskSendSuccess(taskId, taskTitle, kind = '') {
      if (runtimeStats.currentTaskStartedAt > 0) {
        return;
      }

      runtimeStats.currentTaskStartedAt = Date.now();
      runtimeStats.currentTaskId = String(taskId || '');
      runtimeStats.currentTaskTitle = String(taskTitle || '');
      runtimeStats.currentPhase = '已发送等待回答';

      logRuntime('TASK_START', {
        taskId: runtimeStats.currentTaskId,
        taskTitle: runtimeStats.currentTaskTitle,
        reason: kind || '-',
      });
      renderRuntimeStats(true);
    }

    function onTaskSendFail(taskId, taskTitle, reason = '') {
      if (runtimeStats.currentTaskStartedAt > 0) {
        const durationMs = Date.now() - runtimeStats.currentTaskStartedAt;
        runtimeStats.lastTaskDurationMs = durationMs;
        runtimeStats.completedTaskDurationsMs.push(durationMs);
        runtimeStats.completedTaskCount += 1;
        runtimeStats.failedRuns += 1;
        runtimeStats.currentTaskStartedAt = 0;
        runtimeStats.currentTaskId = '';
        runtimeStats.currentTaskTitle = '';
      } else {
        runtimeStats.failedRuns += 1;
      }

      logRuntime('TASK_FAIL', {
        taskId,
        taskTitle,
        reason: reason || 'send-failed',
        durationMs: runtimeStats.lastTaskDurationMs,
      });
      renderRuntimeStats(true);
    }

    function onTaskComplete(taskId, taskTitle) {
      if (!runtimeStats.currentTaskStartedAt) {
        return;
      }

      const durationMs = Date.now() - runtimeStats.currentTaskStartedAt;
      runtimeStats.lastTaskDurationMs = durationMs;
      runtimeStats.completedTaskDurationsMs.push(durationMs);
      runtimeStats.completedTaskCount += 1;
      runtimeStats.successRuns += 1;
      runtimeStats.currentTaskStartedAt = 0;
      runtimeStats.currentTaskId = '';
      runtimeStats.currentTaskTitle = '';
      runtimeStats.currentPhase = '已完成';

      logRuntime('TASK_DONE', {
        taskId,
        taskTitle,
        durationMs,
      });
      renderRuntimeStats(true);
    }

    function toViewModel() {
      const now = Date.now();
      const currentMs = runtimeStats.currentTaskStartedAt > 0
        ? now - runtimeStats.currentTaskStartedAt
        : 0;
      const avgMs = getAverageDurationMs();

      return {
        currentDurationText: formatDurationMs(currentMs),
        lastDurationText: formatDurationMs(runtimeStats.lastTaskDurationMs),
        averageDurationText: formatDurationMs(avgMs),
        totalRuns: runtimeStats.completedTaskCount,
        successRuns: runtimeStats.successRuns,
        failedRuns: runtimeStats.failedRuns,
      };
    }

    function updateTaskPhase(stepKey, context = {}) {
      runtimeStats.currentPhase = resolveTaskPhase(stepKey, context);
      renderRuntimeStats(false);
    }

    function resetUserStats() {
      resetBatchTimingFields({ preserveAverage: false });
      logRuntime('RESET', {});
      renderRuntimeStats(true);
    }

    function onSettingsChanged() {
      syncStatsVisibility();
      restartRefreshTimer();
      renderRuntimeStats(true);
    }

    return {
      getStats: () => Object.assign({}, runtimeStats, {
        completedTaskDurationsMs: runtimeStats.completedTaskDurationsMs.slice(),
      }),
      formatTimeTextForUi,
      formatDuration,
      formatDurationMs,
      formatDurationDisplay,
      toViewModel,
      bindDom,
      renderRuntimeStats,
      onAppStart,
      onBatchStart,
      onBatchStop,
      onTaskSendSuccess,
      onTaskSendFail,
      onTaskComplete,
      updateTaskPhase,
      resetUserStats,
      onSettingsChanged,
      restartRefreshTimer,
    };
  })();
