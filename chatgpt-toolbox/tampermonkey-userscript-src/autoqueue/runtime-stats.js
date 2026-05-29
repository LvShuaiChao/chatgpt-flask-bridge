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
      failedTaskCount: 0,
      stoppedTaskCount: 0,

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
        `failedTaskCount=${payload.failedTaskCount != null ? payload.failedTaskCount : runtimeStats.failedTaskCount}`,
        `stoppedTaskCount=${payload.stoppedTaskCount != null ? payload.stoppedTaskCount : runtimeStats.stoppedTaskCount}`,
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

    function formatTimeTextForUi(value, fallback = '00:00:00') {
      if (value === null || value === undefined) {
        return fallback;
      }
      const text = String(value).trim();
      if (!text) {
        return fallback;
      }
      if (
        text === '-'
        || text === '--'
        || text === '--:--'
        || text === '--:--:--'
        || text === 'null'
        || text === 'undefined'
        || text === 'NaN'
        || text === 'NaN:NaN:NaN'
      ) {
        return fallback;
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
      if (options.notStarted) {
        return '00:00:00';
      }
      if (options.pending) {
        return options.pendingText || '00:00:00';
      }
      return formatDuration(ms);
    }

    function normalizeAutoQueueDurationSeconds(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return null;
      }
      return Math.floor(n / 1000);
    }

    function isAutoQueueDurationMsActive(ms) {
      const seconds = normalizeAutoQueueDurationSeconds(ms);
      return seconds != null && seconds > 0;
    }

    /** 当前任务耗时：仅在 currentTaskStartedAt 有效且计时进行中显示时钟，否则 "-" */
    function formatCurrentTaskElapsedForPanel(currentMs, isTaskTimerActive) {
      if (!isTaskTimerActive || !isAutoQueueDurationMsActive(currentMs)) {
        return '-';
      }
      return formatDuration(currentMs);
    }

    /** 本次回复耗时：进行中用 currentMs，已结束则回退 lastTaskDurationMs */
    function formatCurrentReplyElapsedForPanel(currentMs, lastTaskDurationMs, isTaskTimerActive) {
      if (isTaskTimerActive && isAutoQueueDurationMsActive(currentMs)) {
        return formatDuration(currentMs);
      }
      if (isAutoQueueDurationMsActive(lastTaskDurationMs)) {
        return formatDuration(lastTaskDurationMs);
      }
      return '-';
    }

    function formatLastReplyDurationForPanel(lastTaskDurationMs) {
      if (!isAutoQueueDurationMsActive(lastTaskDurationMs)) {
        return '-';
      }
      return formatDuration(lastTaskDurationMs);
    }

    function formatAverageReplyForPanel(avgMs, hasCompletedTask) {
      if (!hasCompletedTask) {
        return '统计中';
      }
      return formatDuration(avgMs);
    }

    function formatEstimatedRemainingForPanel(etaMs, hasCompletedTask) {
      if (!hasCompletedTask) {
        return '统计中';
      }
      return formatDuration(etaMs);
    }

    function applyCalculatedBatchCountsFromAutoQueue() {
      if (
        typeof AutoQueueModule === 'undefined'
        || typeof AutoQueueModule.calculateBatchRuntimeStats !== 'function'
      ) {
        return null;
      }

      const calculated = AutoQueueModule.calculateBatchRuntimeStats();
      if (!calculated || typeof calculated !== 'object') {
        return null;
      }

      const completedBefore = runtimeStats.completedTaskCount;
      const failedBefore = runtimeStats.failedTaskCount;
      const stoppedBefore = runtimeStats.stoppedTaskCount;
      const total = Number(calculated.totalTaskCount || 0);

      runtimeStats.completedTaskCount = Number(
        calculated.finishedTaskCount != null
          ? calculated.finishedTaskCount
          : calculated.completedTaskCount || 0,
      );
      runtimeStats.failedTaskCount = Number(calculated.failedTaskCount || 0);
      runtimeStats.stoppedTaskCount = Number(calculated.stoppedTaskCount || 0);

      if (total > 0 && runtimeStats.running) {
        const autoState = typeof AutoQueueModule.getState === 'function'
          ? AutoQueueModule.getState() || {}
          : {};
        const phase = String(autoState.phase || '');
        const step = String((autoState.taskRun && autoState.taskRun.currentStep) || '');
        const stillRunning = !!(
          autoState.running
          || autoState.waitingReply
          || autoState.batchTaskRunning
          || phase === 'running'
          || phase === 'waiting_reply'
          || phase === 'terminal_confirming'
          || step === 'wait-current-reply'
          || step === 'reply-ready'
          || step === 'check-done-signal'
          || step === 'send-continue'
          || step === 'verify-upload-file'
          || step === 'verify-send-prompt'
          || step === 'verify-wait-reply'
          || step === 'verify-after-done-signal'
          || step === 'terminal-confirm-second-read'
        );

        if (stillRunning && runtimeStats.completedTaskCount >= total && total > 0) {
          const cappedCompleted = Math.max(0, total - 1);
          if (runtimeStats.completedTaskCount > cappedCompleted) {
            const completedAfterCap = cappedCompleted;
            logRuntime('STATS_CORRECTED_RUNNING_TASK', {
              completedBefore: runtimeStats.completedTaskCount,
              completedAfter: completedAfterCap,
              failedBefore,
              failedAfter: runtimeStats.failedTaskCount,
              stoppedBefore,
              stoppedAfter: runtimeStats.stoppedTaskCount,
              totalTaskCount: total,
              phase,
              currentStep: step,
              reason: 'cap-while-current-task-active',
            });
            runtimeStats.completedTaskCount = completedAfterCap;
          } else if (
            completedBefore !== runtimeStats.completedTaskCount
            || failedBefore !== runtimeStats.failedTaskCount
            || stoppedBefore !== runtimeStats.stoppedTaskCount
          ) {
            logRuntime('STATS_CORRECTED_RUNNING_TASK', {
              completedBefore,
              completedAfter: runtimeStats.completedTaskCount,
              failedBefore,
              failedAfter: runtimeStats.failedTaskCount,
              stoppedBefore,
              stoppedAfter: runtimeStats.stoppedTaskCount,
              totalTaskCount: total,
              phase,
              currentStep: step,
              reason: 'running-task-still-active',
            });
          }
        }
      }

      return calculated;
    }

    function getAverageDurationMs() {
      const count = runtimeStats.completedTaskCount;
      if (!count) {
        return 0;
      }
      const total = runtimeStats.completedTaskDurationsMs.reduce((sum, item) => sum + item, 0);
      return Math.round(total / count);
    }

    function resolveDisplayTotalTaskCount() {
      if (runtimeStats.totalTaskCount > 0) {
        return runtimeStats.totalTaskCount;
      }
      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.getState === 'function'
      ) {
        const autoState = AutoQueueModule.getState() || {};
        const run = autoState.taskRun || {};
        if (Array.isArray(run.enabledTaskIds) && run.enabledTaskIds.length > 0) {
          return run.enabledTaskIds.length;
        }
        const currentTask = autoState.currentTask || null;
        if (
          currentTask
          && Array.isArray(autoState.taskRun && autoState.taskRun.enabledTaskIds)
          && autoState.taskRun.enabledTaskIds.length > 0
        ) {
          return autoState.taskRun.enabledTaskIds.length;
        }
      }
      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.getConfig === 'function'
      ) {
        const cfg = AutoQueueModule.getConfig() || {};
        const profiles = Array.isArray(cfg.taskProfiles) ? cfg.taskProfiles : [];
        const activeProfileId = String(cfg.activeTaskProfileId || '');
        const profile = profiles.find((item) => String(item.id || '') === activeProfileId) || profiles[0];
        if (profile && Array.isArray(profile.tasks)) {
          return profile.tasks.filter((task) => {
            if (!task) return false;
            if (task.enabled === false) return false;
            if (task.disabled === true) return false;
            const title = String(task.title || '');
            if (title.startsWith('示例：') || title.startsWith('示例:')) return false;
            return true;
          }).length;
        }
      }
      return 0;
    }

    function getEstimatedRemainingMs() {
      const avg = getAverageDurationMs();
      const total = resolveDisplayTotalTaskCount();
      if (!avg || !total) {
        return 0;
      }
      const remaining = Math.max(0, total - runtimeStats.completedTaskCount);
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
        resolveDisplayTotalTaskCount(),
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

      applyCalculatedBatchCountsFromAutoQueue();

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

      const isCurrentTaskTimerActive = runtimeStats.currentTaskStartedAt > 0;
      const totalRunText = formatTimeTextForUi(formatDuration(appMs));
      const batchRunText = formatTimeTextForUi(formatDurationDisplay(batchMs, { notStarted: !runtimeStats.batchStartedAt }));
      const currentTaskText = formatCurrentTaskElapsedForPanel(currentMs, isCurrentTaskTimerActive);
      const currentReplyText = formatCurrentReplyElapsedForPanel(
        currentMs,
        runtimeStats.lastTaskDurationMs,
        isCurrentTaskTimerActive,
      );
      const line1 = `耗时：总运行 ${totalRunText} | 本轮批量 ${batchRunText} | 当前任务 ${currentTaskText} | 本次回复 ${currentReplyText}`;

      const hasCompletedTask = runtimeStats.completedTaskCount > 0;
      const lastReplyText = formatLastReplyDurationForPanel(runtimeStats.lastTaskDurationMs);
      const averageReplyText = formatAverageReplyForPanel(avgMs, hasCompletedTask);
      const etaText = formatEstimatedRemainingForPanel(etaMs, hasCompletedTask);
      const displayTotalTaskCount = resolveDisplayTotalTaskCount();
      const line2 = `统计：上次回复 ${lastReplyText} | 平均回复 ${averageReplyText} | 预计剩余 ${etaText}`;
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
          completedTaskCount: runtimeStats.completedTaskCount,
          totalTaskCount: displayTotalTaskCount,
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
        runtimeStats.failedTaskCount = 0;
        runtimeStats.stoppedTaskCount = 0;
        runtimeStats.successRuns = 0;
        runtimeStats.failedRuns = 0;
      }
    }

    function onBatchStart(totalTaskCount) {
      const settings = getTaskQueueSettings();
      if (!settings.preserveRuntimeStatsAverage) {
        runtimeStats.completedTaskDurationsMs = [];
        runtimeStats.completedTaskCount = 0;
        runtimeStats.failedTaskCount = 0;
        runtimeStats.stoppedTaskCount = 0;
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
      const stopReason = String(reason || 'batch-stopped');
      if (runtimeStats.running && runtimeStats.batchStartedAt > 0) {
        runtimeStats.batchEndedAt = Date.now();
      }
      runtimeStats.running = false;

      if (runtimeStats.currentTaskStartedAt > 0) {
        const durationMs = Date.now() - runtimeStats.currentTaskStartedAt;
        runtimeStats.lastTaskDurationMs = durationMs;
        if (stopReason === 'all-done' || stopReason === 'all-tasks-done') {
          runtimeStats.failedRuns += 0;
        } else if (
          stopReason === 'reply-classify-no-more-content'
          || stopReason.includes('no-more-content')
          || stopReason === 'reply-classify-blocked'
          || stopReason.includes('need-input')
          || stopReason.includes('stop')
          || stopReason.includes('cancel')
        ) {
          runtimeStats.stoppedTaskCount += 1;
        } else {
          runtimeStats.failedTaskCount += 1;
          runtimeStats.failedRuns += 1;
        }
        logRuntime(stopReason.includes('stop') || stopReason.includes('cancel') ? 'TASK_STOP' : 'TASK_FAIL', {
          taskId: runtimeStats.currentTaskId,
          taskTitle: runtimeStats.currentTaskTitle,
          reason: stopReason,
          durationMs,
        });
        runtimeStats.currentTaskStartedAt = 0;
        runtimeStats.currentTaskId = '';
        runtimeStats.currentTaskTitle = '';
      }

      logRuntime('BATCH_STOP', { reason: stopReason || '-' });
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
        runtimeStats.failedTaskCount += 1;
        runtimeStats.failedRuns += 1;
        runtimeStats.currentTaskStartedAt = 0;
        runtimeStats.currentTaskId = '';
        runtimeStats.currentTaskTitle = '';
      } else {
        runtimeStats.failedTaskCount += 1;
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
        logRuntime('TASK_DONE_SKIP', {
          taskId,
          taskTitle,
          reason: 'no-active-task-timer',
        });
        return false;
      }

      const expectedTaskId = String(runtimeStats.currentTaskId || '').trim();
      const incomingTaskId = String(taskId || '').trim();
      if (expectedTaskId && incomingTaskId && expectedTaskId !== incomingTaskId) {
        logRuntime('TASK_DONE_SKIP', {
          taskId: incomingTaskId,
          taskTitle,
          reason: 'task-id-mismatch',
          expectedTaskId,
        });
        return false;
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
      applyCalculatedBatchCountsFromAutoQueue();
      renderRuntimeStats(true);
      return true;
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
        failedTaskCount: runtimeStats.failedTaskCount,
        stoppedTaskCount: runtimeStats.stoppedTaskCount,
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
