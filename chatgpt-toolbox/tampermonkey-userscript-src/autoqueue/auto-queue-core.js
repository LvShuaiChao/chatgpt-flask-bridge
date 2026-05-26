  /********************************************************************
   * 4. AutoQueueModule：自动指令队列模块
   ********************************************************************/

const AutoQueueModule = (() => {
    const config = Object.assign(
      createDefaultAutoConfig(),
      MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, null) || {},
    );

    function repairAutoQueuePromptConfigIfNeeded() {
      const continueText = String(config.continuePromptsText || '').trim();
      const listText = String(config.listPromptsText || '').trim();

      if (continueText === '继续' && listText === '继续') {
        config.listPromptsText = getDefaultAutoListPromptsText();
        saveConfig();
        ToolboxShell.appendLog('[自动指令] 已修复被污染的列表模式默认指令');
      }

      if (typeof migrateContinuePromptTextIfNeeded === 'function') {
        const migration = migrateContinuePromptTextIfNeeded(
          continueText,
          (line) => ToolboxShell.appendLog(line),
        );
        if (migration.migrated) {
          config.continuePromptsText = migration.value;
          saveConfig();
        }
      }
    }

    function getDefaultContinuePromptTextForUi() {
      const template = typeof getDefaultContinuePromptText === 'function'
        ? getDefaultContinuePromptText()
        : '继续';

      if (typeof renderContinuePromptTemplate === 'function') {
        return renderContinuePromptTemplate(template, TASK_DONE_SIGNAL);
      }

      return String(template || '继续')
        .replaceAll('{{DONE_SIGNAL}}', TASK_DONE_SIGNAL)
        .replaceAll('{{BLOCKED_SIGNAL}}', DEFAULT_BATCH_BLOCKED_SIGNAL)
        .replaceAll('{{NO_MORE_CONTENT_SIGNAL}}', DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL);
    }

    function getDefaultTaskContinuePromptTextForUi() {
      if (typeof getDefaultTaskContinuePromptText === 'function') {
        return getDefaultTaskContinuePromptText();
      }
      return '请继续完成上一个任务。';
    }

    function normalizeListProfiles() {
      if (!Array.isArray(config.listProfiles)) {
        config.listProfiles = [];
      }

      config.listProfiles = config.listProfiles
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const base = normalizeNamedEntity(item, {
            prefix: 'autoq_list',
            fallbackName: '未命名列表',
            maxNameLength: 24,
          });

          return {
            ...base,
            text: String(item.text || ''),
          };
        });

      if (!config.listProfiles.length) {
        config.listProfiles.push({
          ...normalizeNamedEntity(null, {
            prefix: 'autoq_list',
            fallbackName: '默认列表',
            maxNameLength: 24,
          }),
          text: String(config.listPromptsText || getDefaultAutoListPromptsText()),
        });
      }

      const exists = config.listProfiles.some((item) => item.id === config.activeListProfileId);

      if (!exists) {
        config.activeListProfileId = config.listProfiles[0].id;
      }

      const active = config.listProfiles.find((item) => item.id === config.activeListProfileId)
        || config.listProfiles[0]
        || null;

      if (active) {
        config.listPromptsText = active.text;
      }
    }

    function getActiveListProfile() {
      normalizeListProfiles();

      return config.listProfiles.find((item) => item.id === config.activeListProfileId) || config.listProfiles[0] || null;
    }

    function buildAutoQueueListName() {
      const d = new Date();
      const base = `列表_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

      const names = new Set(config.listProfiles.map((item) => item.name));

      return buildUniqueName(base, names);
    }

    const TASK_DONE_SIGNAL = (typeof DEFAULT_BATCH_DONE_SIGNAL === 'string' && DEFAULT_BATCH_DONE_SIGNAL)
      ? DEFAULT_BATCH_DONE_SIGNAL
      : ((typeof DEFAULT_TASK_DONE_SIGNAL === 'string' && DEFAULT_TASK_DONE_SIGNAL)
        ? DEFAULT_TASK_DONE_SIGNAL
        : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>');

    const BATCH_CONTINUE_TEMPLATE = (typeof DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE === 'string'
      && DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE)
      ? DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE
      : getDefaultTaskContinuePromptTextForUi();

    const LEGACY_TASK_DONE_SIGNALS = Object.freeze([
      'CHATGPT_TOOLBOX_DONE',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ]);

    function taskRepairLog(line) {
      ToolboxShell.appendLog(line);
    }

    function isExampleTask(task) {
      const title = String(task && task.title || '');
      return title.startsWith('示例：') || title.startsWith('示例:');
    }

    function isOnlyExampleTasks(tasks) {
      if (!Array.isArray(tasks) || !tasks.length) {
        return false;
      }
      return tasks.every((item) => isExampleTask(item));
    }

    function clearExampleTasksFromProfile(profile) {
      if (!profile || !Array.isArray(profile.tasks)) {
        return false;
      }

      const before = profile.tasks.length;
      profile.tasks = profile.tasks.filter((item) => !isExampleTask(item));

      if (profile.tasks.length < before) {
        ToolboxShell.appendLog('[AUTOQ][TASK_EXAMPLE][CLEAR_ON_PROMPT_IMPORT]');
        return true;
      }

      return false;
    }

    function findPromptTaskInProfile(profile, promptId) {
      if (!profile || !Array.isArray(profile.tasks)) {
        return null;
      }

      return profile.tasks.find(
        (item) => item.sourceType === 'prompt-manager' && String(item.promptId) === String(promptId),
      ) || null;
    }

    function resolveTaskInitialPrompt(task, options = {}) {
      const shouldLog = !!(options && options.log);

      if (task && task.sourceType === 'prompt-manager' && task.promptId) {
        const result = findPromptForLinkedTask(task);
        const prompt = result.prompt;

        if (prompt) {
          if (shouldLog) {
            const relinkNote = result.relinked ? ' relinked=true' : '';
            ToolboxShell.appendLog(
              `[AUTOQ][PROMPT_TASK][RESOLVE] promptId=${prompt.id} title=${prompt.title}${relinkNote}`,
            );
          }
          return {
            title: String(prompt.title || task.title || '未命名任务'),
            initialPrompt: String(prompt.content || task.initialPrompt || ''),
          };
        }

        if (shouldLog) {
          ToolboxShell.appendLog(
            `[AUTOQ][PROMPT_TASK][MISSING_USE_SNAPSHOT] promptId=${task.promptId} task=${task.title || task.id}`,
          );
        }
        return {
          title: String(task.title || '未命名任务'),
          initialPrompt: String(task.initialPrompt || ''),
        };
      }

      return {
        title: task ? String(task.title || '未命名任务') : '',
        initialPrompt: task ? String(task.initialPrompt || '') : '',
      };
    }

    const TASK_RUN_STEP_LABELS = Object.freeze({
      idle: '待开始',
      'write-initial': '正在写入初始指令',
      'composer-sync-retry': '正在同步输入框',
      'send-retry': '正在重试发送',
      'send-initial': '正在发送初始指令',
      'send-initial-wait-retry': '等待发送重试',
      'send-wait-retry': '等待发送重试',
      'send-initial-failed': '发送初始指令失败',
      'wait-initial-reply': '等待初始回复',
      'initial-reply-done': '初始回复完成',
      'wait-current-reply': '等待当前回复结束',
      'wait-reply': '等待回复完成',
      'check-done-signal': '检查终止信号',
      'copy-last-reply': '复制最后回复',
      'send-hotkey': '发送 Ctrl+Alt+I',
      'send-continue': '发送继续指令',
      'wait-next-reply': '等待下一轮回复',
      'verify-upload': '正在上传校验文件',
      'verify-send': '正在发送校验指令',
      'wait-verify-reply': '等待校验回复',
      'verify-reply-done': '校验回复完成',
      'verify-after-done-signal': '终止信号后二次校验',
      'verify-upload-file': '重新上传文件校验',
      'verify-send-prompt': '发送完成校验',
      'verify-wait-reply': '等待校验回复',
      'new-chat-switch': '正在切换到新聊天',
      'new-chat-wait': '等待新聊天页面就绪',
      'new-chat-ready': '新聊天已就绪',
      'next-task': '进入下一个任务',
      'all-done': '已完成',
      'rate-limit-wait': '发送限速等待',
      'upload-rate-limit-wait': '上传限速等待',
      'auto-upload-before-send': '发送前自动上传',
      'new-chat-rotate': '页面轮次达上限，切换新聊天',
      'page-rotate-reentry-sent': '换页后已重发任务内容',
      stopped: '已停止',
    });

    function migrateTaskDoneSignalForAutoQueue(value) {
      if (typeof migrateTaskDoneSignalValue === 'function') {
        return migrateTaskDoneSignalValue(
          value,
          (line) => ToolboxShell.appendLog(line),
        );
      }
      const trimmed = String(value || '').trim();
      if (!trimmed) {
        return '';
      }
      return trimmed;
    }

    function getTaskRunStepLabel(stepKey) {
      const key = String(stepKey || 'idle');
      return TASK_RUN_STEP_LABELS[key] || key;
    }

    function renderTaskPanel(refreshReason = '') {
      updateStatus(refreshReason || 'task-panel-render');
      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.renderRuntimeStats === 'function') {
        RuntimeStatsModule.renderRuntimeStats(false);
      }
    }

    function setTaskBatchStep(step, task, options = {}) {
      if (!state.taskRun || typeof state.taskRun !== 'object') {
        state.taskRun = {};
      }

      const run = state.taskRun;
      run.currentStep = String(step || 'idle');
      run.currentTaskTitle = task && task.title ? String(task.title) : '';
      run.updatedAt = Date.now();

      if (options.extra && typeof options.extra === 'object') {
        run.extra = Object.assign({}, run.extra || {}, options.extra);
      }

      if (options.log !== false) {
        const title = task && task.title
          ? task.title
          : (run.currentTaskTitle || (getCurrentRunningTask() ? getCurrentRunningTask().title : '-'));
        ToolboxShell.appendLog(`[AUTOQ][TASK_STEP] step=${run.currentStep} task=${title}`);
      }

      renderTaskPanel(`step:${run.currentStep}`);
      syncRuntimeTaskPhase();
    }

    function notifyRuntimeTaskSendSuccess(task, kind) {
      if (typeof RuntimeStatsModule === 'undefined' || typeof RuntimeStatsModule.onTaskSendSuccess !== 'function') {
        return;
      }
      RuntimeStatsModule.onTaskSendSuccess(
        task ? task.id : '',
        task ? task.title : '',
        kind || '',
      );
    }

    function notifyRuntimeTaskComplete(task) {
      if (typeof RuntimeStatsModule === 'undefined' || typeof RuntimeStatsModule.onTaskComplete !== 'function') {
        return;
      }
      if (!task) {
        return;
      }
      RuntimeStatsModule.onTaskComplete(task.id, task.title);
    }

    function notifyRuntimeTaskSendFail(task, reason) {
      if (typeof RuntimeStatsModule === 'undefined' || typeof RuntimeStatsModule.onTaskSendFail !== 'function') {
        return;
      }
      RuntimeStatsModule.onTaskSendFail(
        task ? task.id : '',
        task ? task.title : '',
        reason || '',
      );
    }

    function syncRuntimeTaskPhase() {
      if (typeof RuntimeStatsModule === 'undefined' || typeof RuntimeStatsModule.updateTaskPhase !== 'function') {
        return;
      }
      const task = getCurrentRunningTask();
      const run = state.taskRun || {};
      RuntimeStatsModule.updateTaskPhase(
        run.currentStep ? run.currentStep : 'idle',
        {
          waitingReply: state.waitingReply,
          sendingNow: state.sendingNow,
          running: state.running,
          doneSignalVerificationRunning: !!run.doneSignalVerificationRunning,
          taskStatus: task ? task.status : '',
          stopReason: state.lastTaskBatchStopReason
            ? String(state.lastTaskBatchStopReason.reason || '')
            : '',
          sendRetryReason: String(run.lastSendRetryReason || ''),
        },
      );
    }

    function ensureMainLiteStructure() {
      if (!mainLiteEl) {
        return;
      }

      let panelRoot = qs('#cgpt-autoq-status-panel-content', mainLiteEl);
      if (!panelRoot) {
        mainLiteEl.innerHTML = `
          <div class="cgpt-autoq-status-grid cgpt-autoq-main-lite-grid" id="cgpt-autoq-status-panel-content"></div>
          <div id="cgpt-autoq-runtime-stats-line-1" class="cgpt-autoq-runtime-stats-line cgpt-toolbox-hidden" aria-hidden="true"></div>
          <div id="cgpt-autoq-runtime-stats-line-2" class="cgpt-autoq-runtime-stats-line cgpt-toolbox-hidden" aria-hidden="true"></div>
          <div id="cgpt-autoq-runtime-phase-line" class="cgpt-autoq-runtime-stats-line cgpt-autoq-runtime-stats-phase cgpt-toolbox-hidden" aria-hidden="true"></div>
        `;
        if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.bindDom === 'function') {
          RuntimeStatsModule.bindDom(mainLiteEl);
        }
      }
    }

    function formatStatusFraction(numerator, denominator) {
      if (denominator == null || denominator === '' || Number.isNaN(Number(denominator))) {
        return '-';
      }
      return `${Number(numerator) || 0} / ${Number(denominator) || 0}`;
    }

    function formatQuotaDisplayText(display) {
      if (!display || display === '-') {
        return '-';
      }
      return String(display).replace(/(\d+)\s*\/\s*(\d+)/, '$1 / $2');
    }

    function resolveAutoqStatusValueTone(value, options = {}) {
      if (options.tone) {
        return options.tone;
      }
      if (options.muted) {
        return 'is-muted';
      }

      const text = String(value || '');
      const lower = text.toLowerCase();

      if (!text || text === '-') {
        return '';
      }
      if (/可发送|可上传|已完成|成功/.test(text)) {
        return 'is-ok';
      }
      if (/failed|失败|clipboard_read_verify_failed|missing|error|blocked|no-more-content/.test(lower)) {
        return 'is-error';
      }
      if (/等待发送|运行中|等待回复|发送中|上传中|回答中|复核中|发送重试|等待终止|已发送等待/.test(text)) {
        return 'is-warn';
      }
      if (/已停止|停止/.test(text) && options.allowStopWarn) {
        return 'is-warn';
      }
      return '';
    }

    function renderAutoqStatusItem(label, value, options = {}) {
      const safeLabel = escapeHtml(label);
      const safeValue = escapeHtml(value == null || value === '' ? '-' : String(value));
      const rawValue = value == null || value === '' ? '-' : String(value);
      const tone = resolveAutoqStatusValueTone(rawValue, options);
      const valueClass = tone
        ? `cgpt-autoq-status-value ${tone}`
        : 'cgpt-autoq-status-value';
      const valueId = options.id ? ` id="${options.id}"` : '';
      const extraClass = options.className || options.extraClass || '';
      const itemClass = extraClass
        ? `cgpt-autoq-status-item ${extraClass}`
        : 'cgpt-autoq-status-item';

      return `
        <div class="${itemClass}" title="${safeLabel}：${safeValue}">
          <span class="cgpt-autoq-status-label">${safeLabel}</span>
          <span class="${valueClass}"${valueId}>${safeValue}</span>
        </div>`;
    }

    function renderAutoqStatusItems(items) {
      return items.map((item) => renderAutoqStatusItem(
        item.label,
        item.value,
        {
          className: item.className || '',
          tone: item.tone,
          muted: item.muted,
          allowStopWarn: item.allowStopWarn,
          id: item.id,
        },
      )).join('');
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
        rateLimitDisplay,
        uploadRateLimitDisplay,
        progressSnapshot,
        taskName,
      } = options;

      const strategy = progressSnapshot.autoUploadStrategy;
      const autoUploadText = strategy && strategy.enabled
        ? `已计入 ${progressSnapshot.autoUploadDialogueCount} 次，下次第 ${progressSnapshot.taskAutoUploadNextAt} 次；${strategy.summary}`
        : (strategy ? strategy.summary : '未启用');

      const rotationSettings = progressSnapshot.rotationSettings;
      const rotationText = rotationSettings && rotationSettings.enabled
        ? `当前页 ${progressSnapshot.currentPageDialogueCount}/${rotationSettings.threshold}，已切换 ${progressSnapshot.rotationCount} 次`
        : '未启用';

      const replyClassifyText = replyClassifyReason && replyClassifyReason !== '-'
        ? `${replyClassifyStatus}（${replyClassifyReason}）`
        : replyClassifyStatus;

      const stopReasonValue = lastStopReasonText !== '-'
        ? `${lastStopReasonText}${lastStopClassifyHint || ''}`
        : '-';

      return renderAutoqStatusItems([
        { label: '任务进度', value: taskProgress },
        { label: '页面轮次', value: pageTurnText },
        { label: '状态', value: runStateText, allowStopWarn: true },
        { label: '已发送', value: taskSentDialogueDisplay },

        { label: '发送额度', value: formatQuotaDisplayText(rateLimitDisplay), className: 'wide' },
        { label: '上传额度', value: formatQuotaDisplayText(uploadRateLimitDisplay), className: 'wide' },

        { label: '任务', value: taskName, className: 'wide' },
        { label: '上传', value: uploadStatusText },
        { label: '追问', value: continueDisplay },

        { label: '当前步骤', value: taskStepText, className: 'wide' },
        {
          label: '终态识别',
          value: replyClassifyText,
          className: 'wide',
          tone: replyClassifyText !== '-' ? resolveAutoqStatusValueTone(replyClassifyText) : '',
        },

        { label: '自动上传', value: autoUploadText, className: 'full' },
        { label: '自动换页', value: rotationText, className: 'full' },
        {
          label: '停止原因',
          value: stopReasonValue,
          className: 'full',
          tone: stopReasonValue !== '-' ? 'is-error' : '',
        },
      ]);
    }

    function buildLiteStatusPanelHtml(options) {
      const {
        modeText,
        pageTurnText,
        listName,
        running,
      } = options;

      return renderAutoqStatusItems([
        { label: '模式', value: modeText },
        { label: '页面轮次', value: pageTurnText },
        { label: '列表', value: listName || '-' },
        { label: '状态', value: running ? '运行中' : '已停止', allowStopWarn: true },
        { label: '追问', value: '-' },
        { label: '当前步骤', value: '-' },
      ]);
    }

    function createTaskId() {
      return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    const UNLIMITED_CONTINUE_ROUNDS = 0;
    const LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS = 10;

    function normalizeContinueRoundLimit(value, fallback = UNLIMITED_CONTINUE_ROUNDS) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return fallback;
      }
      return Math.max(0, Math.floor(n));
    }

    function isUnlimitedMaxContinueRounds(value) {
      if (value === null || value === undefined) {
        return true;
      }
      if (value === Infinity || value === -Infinity) {
        return true;
      }
      const n = Number(value);
      return !Number.isFinite(n) || n <= 0;
    }

    function formatContinueRoundLimit(value) {
      if (isUnlimitedMaxContinueRounds(value)) {
        return '无限';
      }
      const n = normalizeContinueRoundLimit(value, UNLIMITED_CONTINUE_ROUNDS);
      return n > 0 ? String(n) : '无限';
    }

    function formatMaxContinueRoundsForStatus(value) {
      if (isUnlimitedMaxContinueRounds(value)) {
        return '无限';
      }
      return String(Math.max(0, Math.floor(Number(value))));
    }

    function createDefaultTaskProfileDefaults() {
      return {
        continuePromptTemplate: BATCH_CONTINUE_TEMPLATE,
        defaultDoneSignal: TASK_DONE_SIGNAL,
        defaultMaxContinueRounds: UNLIMITED_CONTINUE_ROUNDS,
        defaultMaxContinueRoundsMigratedToUnlimited: true,
      };
    }

    function createDefaultTaskItem(overrides = {}) {
      const ts = nowMs();
      const base = {
        id: createTaskId(),
        title: '新任务',
        enabled: true,
        initialPrompt: '',
        continuePromptTemplate: '',
        doneSignal: '',
        maxContinueRounds: 0,
        sourceType: 'manual',
        promptId: '',
        status: 'pending',
        continueCount: 0,
        createdAt: ts,
        updatedAt: ts,
      };

      return Object.assign(base, overrides && typeof overrides === 'object' ? overrides : {});
    }

    function createDefaultExampleTasks() {
      return [
        createDefaultTaskItem({
          title: '示例：自我介绍',
          initialPrompt: '请用三句话介绍你自己。',
        }),
        createDefaultTaskItem({
          title: '示例：总结能力',
          initialPrompt: '请列出你最擅长的 3 项能力。',
        }),
      ];
    }

    function normalizeTaskItem(item, options = {}) {
      const ts = nowMs();
      const raw = item && typeof item === 'object' ? item : {};
      const forceNewId = !!(options && options.forceNewId);
      const id = forceNewId
        ? createTaskId()
        : String(raw.id || '').trim() || createTaskId();

      const legacyTemplate = String(
        raw.continuePromptTemplate
        || raw.continuePrompt
        || raw.defaultContinuePrompt
        || '',
      );

      return {
        id,
        title: String(raw.title || '未命名任务').trim() || '未命名任务',
        enabled: raw.enabled !== false,
        initialPrompt: String(raw.initialPrompt || ''),
        continuePromptTemplate: String(legacyTemplate || ''),
        doneSignal: String(raw.doneSignal || '').trim(),
        maxContinueRounds: normalizeContinueRoundLimit(raw.maxContinueRounds, UNLIMITED_CONTINUE_ROUNDS),
        sourceType: String(raw.sourceType || 'manual'),
        promptId: String(raw.promptId || ''),
        status: String(raw.status || 'pending'),
        continueCount: Math.max(0, Number(raw.continueCount) || 0),
        createdAt: normalizeTimestamp(raw.createdAt, ts),
        updatedAt: normalizeTimestamp(raw.updatedAt, ts),
      };
    }

    function normalizeProfileTasks(rawTasks) {
      if (!Array.isArray(rawTasks)) {
        return [];
      }

      const seen = new Set();
      const result = [];

      rawTasks.forEach((item) => {
        if (!item || typeof item !== 'object') {
          return;
        }

        let task = normalizeTaskItem(item);

        if (seen.has(task.id)) {
          const duplicateId = task.id;
          task = normalizeTaskItem(item, { forceNewId: true });
          console.warn('[AUTOQ][TASK][DEDUPE_ID] duplicate task id replaced', duplicateId, '->', task.id);
          ToolboxShell.appendLog(`[AUTOQ][TASK][DEDUPE_ID] ${duplicateId} -> ${task.id}`);
        }

        seen.add(task.id);
        result.push(task);
      });

      return result;
    }

    function resolveTaskContinueSettings(task, profile, options = {}) {
      const shouldLog = !!(options && options.log);
      const taskTemplate = String(task && task.continuePromptTemplate || '').trim();
      const profileTemplate = String(
        profile && profile.continuePromptTemplate || '',
      ).trim();
      const systemDefault = BATCH_CONTINUE_TEMPLATE;

      let actualContinuePromptTemplate;
      let continueSource;

      if (taskTemplate) {
        actualContinuePromptTemplate = taskTemplate;
        continueSource = 'task';
        if (shouldLog) {
          ToolboxShell.appendLog('[AUTOQ][TASK][USE_TASK_CONTINUE]');
        }
      } else if (profileTemplate) {
        actualContinuePromptTemplate = profileTemplate;
        continueSource = 'profile';
        if (shouldLog) {
          ToolboxShell.appendLog('[AUTOQ][TASK][USE_PROFILE_CONTINUE]');
        }
      } else {
        actualContinuePromptTemplate = systemDefault;
        continueSource = 'default';
        if (shouldLog) {
          ToolboxShell.appendLog('[AUTOQ][TASK][USE_DEFAULT_CONTINUE]');
        }
      }

      const taskDone = String(task && task.doneSignal || '').trim();
      const profileDone = String(profile && profile.defaultDoneSignal || '').trim();
      const actualDoneSignal = typeof normalizeDoneSignal === 'function'
        ? normalizeDoneSignal(taskDone || profileDone || TASK_DONE_SIGNAL)
        : (taskDone || profileDone || TASK_DONE_SIGNAL);

      const taskMax = normalizeContinueRoundLimit(
        task && task.maxContinueRounds,
        UNLIMITED_CONTINUE_ROUNDS,
      );
      const profileMax = normalizeContinueRoundLimit(
        profile && profile.defaultMaxContinueRounds,
        UNLIMITED_CONTINUE_ROUNDS,
      );
      const actualMaxContinueRounds = taskMax > 0 ? taskMax : profileMax;

      if (shouldLog) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK][RESOLVE_CONTINUE_PROMPT] source=${continueSource} chars=${actualContinuePromptTemplate.length}`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][TASK][MAX_CONTINUE_RESOLVE] task=${taskMax > 0 ? taskMax : 'inherit'} profile=${formatContinueRoundLimit(profileMax)} actual=${formatContinueRoundLimit(actualMaxContinueRounds)}`,
        );
      }

      return {
        actualContinuePromptTemplate,
        actualDoneSignal,
        actualMaxContinueRounds,
        continueSource,
      };
    }

    let didLogTaskMigrateSummary = false;
    let taskProfileRepairPersisted = false;

    function repairTaskProfileEntity(profile, profileDefaults) {
      let changed = false;
      const oldDone = String(profile.defaultDoneSignal || '');
      const repairedDone = typeof repairCorruptedDoneSignalText === 'function'
        ? repairCorruptedDoneSignalText(oldDone, taskRepairLog)
        : oldDone || profileDefaults.defaultDoneSignal;

      if (repairedDone !== oldDone) {
        changed = true;
      }
      profile.defaultDoneSignal = repairedDone || profileDefaults.defaultDoneSignal;

      const rawTemplate = String(
        profile.continuePromptTemplate
        || profile.defaultContinuePrompt
        || profile.continuePrompt
        || '',
      ).trim();
      const repairedTemplate = typeof repairCorruptedContinuePromptTemplate === 'function'
        ? repairCorruptedContinuePromptTemplate(
          rawTemplate || profileDefaults.continuePromptTemplate,
          taskRepairLog,
          'profile.continuePromptTemplate',
        )
        : (rawTemplate || profileDefaults.continuePromptTemplate);

      if (repairedTemplate !== rawTemplate) {
        changed = true;
      }
      profile.continuePromptTemplate = repairedTemplate || profileDefaults.continuePromptTemplate;

      delete profile.defaultContinuePrompt;
      delete profile.continuePrompt;

      return changed;
    }

    function repairTaskItemEntity(task) {
      let changed = false;
      const oldDone = String(task.doneSignal || '').trim();

      if (oldDone) {
        const repairedDone = typeof repairCorruptedDoneSignalText === 'function'
          ? repairCorruptedDoneSignalText(oldDone, taskRepairLog)
          : oldDone;

        if (repairedDone !== oldDone) {
          changed = true;
          task.doneSignal = repairedDone;
        }
      } else {
        if (task.doneSignal !== '') {
          changed = true;
        }
        task.doneSignal = '';
      }

      const rawTemplate = String(task.continuePromptTemplate || task.continuePrompt || '');

      if (rawTemplate.trim()) {
        const repairedTemplate = typeof repairCorruptedContinuePromptTemplate === 'function'
          ? repairCorruptedContinuePromptTemplate(
            rawTemplate,
            taskRepairLog,
            'task.continuePromptTemplate',
          )
          : rawTemplate;

        if (repairedTemplate !== rawTemplate) {
          changed = true;
        }

        task.continuePromptTemplate = repairedTemplate;
      } else {
        if (task.continuePromptTemplate !== '') {
          changed = true;
        }

        task.continuePromptTemplate = '';
      }

      delete task.continuePrompt;

      return changed;
    }

    function normalizeTaskProfiles() {
      const migrateNotes = [];
      const hadProfilesArray = Array.isArray(config.taskProfiles);

      if (!hadProfilesArray) {
        config.taskProfiles = [];
        migrateNotes.push('init-taskProfiles-array');
      }

      const profileDefaults = createDefaultTaskProfileDefaults();
      let repairChanged = false;

      config.taskProfiles = config.taskProfiles
        .filter((item) => item && typeof item === 'object')
        .map((profile) => {
          const base = normalizeNamedEntity(profile, {
            prefix: 'autoq_task_profile',
            fallbackName: '默认任务组',
            maxNameLength: 24,
          });

          if (!Array.isArray(profile.tasks)) {
            migrateNotes.push(`profile-${base.id}:init-tasks-array`);
          }

          const tasks = normalizeProfileTasks(profile.tasks).map((task) => {
            const normalized = { ...task };

            if (normalized.doneSignal) {
              normalized.doneSignal = migrateTaskDoneSignalForAutoQueue(normalized.doneSignal);
            }

            if (repairTaskItemEntity(normalized)) {
              repairChanged = true;
            }
            return normalized;
          });

          let defaultMaxContinueRounds = normalizeContinueRoundLimit(
            profile.defaultMaxContinueRounds,
            profileDefaults.defaultMaxContinueRounds,
          );
          let profileMigrated = !!(profile.defaultMaxContinueRoundsMigratedToUnlimited);

          if (!profileMigrated) {
            const rawMax = Number(profile.defaultMaxContinueRounds);
            if (Number.isFinite(rawMax) && rawMax === LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS) {
              defaultMaxContinueRounds = UNLIMITED_CONTINUE_ROUNDS;
              profileMigrated = true;
              migrateNotes.push(`profile-${base.id}:migrate-max-continue-unlimited`);
              repairChanged = true;
            }
          }

          const nextProfile = {
            ...base,
            continuePromptTemplate: String(
              profile.continuePromptTemplate
              || profile.defaultContinuePrompt
              || profileDefaults.continuePromptTemplate,
            ),
            defaultDoneSignal: String(profile.defaultDoneSignal || '').trim()
              || profileDefaults.defaultDoneSignal,
            defaultMaxContinueRounds,
            defaultMaxContinueRoundsMigratedToUnlimited: profileMigrated,
            tasks,
          };

          if (repairTaskProfileEntity(nextProfile, profileDefaults)) {
            repairChanged = true;
            migrateNotes.push(`profile-${base.id}:repair-template`);
          }

          return nextProfile;
        });

      if (!config.taskProfiles.length) {
        const ts = nowMs();
        const profileId = createId('autoq_task_profile');

        config.taskProfiles.push({
          id: profileId,
          name: '默认任务组',
          ...createDefaultTaskProfileDefaults(),
          tasks: createDefaultExampleTasks(),
          createdAt: ts,
          updatedAt: ts,
        });
        migrateNotes.push('seed-default-profile-with-example-tasks');
      }

      if (!didLogTaskMigrateSummary) {
        didLogTaskMigrateSummary = true;
        const summary = migrateNotes.includes('seed-default-profile-with-example-tasks')
          ? 'createdDefaultTasks=true preservedUserTasks=false'
          : `createdDefaultTasks=false preservedUserTasks=true profileCount=${config.taskProfiles.length}`;
        const detail = migrateNotes.length ? `${migrateNotes.join('; ')}; ` : '';
        ToolboxShell.appendLog(`[AUTOQ][TASK][MIGRATE] ${detail}${summary}`);
      } else if (migrateNotes.length) {
        ToolboxShell.appendLog(`[AUTOQ][TASK][MIGRATE] ${migrateNotes.join('; ')}`);
      }

      const exists = config.taskProfiles.some((item) => item.id === config.activeTaskProfileId);

      if (!exists) {
        config.activeTaskProfileId = config.taskProfiles[0].id;
      }

      if (!config.taskQueueSettings || typeof config.taskQueueSettings !== 'object') {
        config.taskQueueSettings = createDefaultTaskQueueSettings();
      } else {
        const taskQueueDefaults = createDefaultTaskQueueSettings();
        const rawTaskQueue = config.taskQueueSettings;
        config.taskQueueSettings = {
          ...taskQueueDefaults,
          ...rawTaskQueue,
          stopOnMaxContinueRounds: rawTaskQueue.stopOnMaxContinueRounds !== false,
          switchNewChatBetweenTasks: rawTaskQueue.switchNewChatBetweenTasks !== false,
          stopBatchOnTaskSendFailure: rawTaskQueue.stopBatchOnTaskSendFailure === true,
          defaultMaxContinueRoundsMigratedToUnlimited:
            rawTaskQueue.defaultMaxContinueRoundsMigratedToUnlimited === true,
          verifyAfterDoneSignal: rawTaskQueue.verifyAfterDoneSignal !== false,
          verifyAfterDoneSignalUploadFile: rawTaskQueue.verifyAfterDoneSignalUploadFile !== false,

          taskSendRateLimitEnabled: rawTaskQueue.taskSendRateLimitEnabled !== false,
          taskSendRateLimitWindowMinutes: Math.max(
            1,
            Math.floor(Number(rawTaskQueue.taskSendRateLimitWindowMinutes) || taskQueueDefaults.taskSendRateLimitWindowMinutes || 180),
          ),
          taskSendRateLimitMaxMessages: Math.max(
            1,
            Math.floor(Number(rawTaskQueue.taskSendRateLimitMaxMessages) || taskQueueDefaults.taskSendRateLimitMaxMessages || 150),
          ),

          taskUploadRateLimitEnabled:
            rawTaskQueue.taskUploadRateLimitEnabled !== false,

          taskUploadRateLimitWindowMinutes: Math.max(
            1,
            Math.floor(
              Number(rawTaskQueue.taskUploadRateLimitWindowMinutes)
              || taskQueueDefaults.taskUploadRateLimitWindowMinutes
              || 180,
            ),
          ),

          taskUploadRateLimitMaxFiles: Math.max(
            1,
            Math.floor(
              Number(rawTaskQueue.taskUploadRateLimitMaxFiles)
              || taskQueueDefaults.taskUploadRateLimitMaxFiles
              || 80,
            ),
          ),

          taskAutoUploadEveryNMessagesEnabled:
            rawTaskQueue.taskAutoUploadEveryNMessagesEnabled !== false,

          taskAutoUploadEveryNMessages: Math.max(
            1,
            Math.floor(
              Number(rawTaskQueue.taskAutoUploadEveryNMessages)
              || taskQueueDefaults.taskAutoUploadEveryNMessages
              || 5,
            ),
          ),

          taskAutoUploadCountInitialPrompt:
            rawTaskQueue.taskAutoUploadCountInitialPrompt !== false,

          taskAutoUploadCountContinuePrompt:
            rawTaskQueue.taskAutoUploadCountContinuePrompt !== false,

          taskAutoUploadCountVerifyPrompt:
            rawTaskQueue.taskAutoUploadCountVerifyPrompt !== false,

          taskRotateNewChatByPageTurnEnabled:
            rawTaskQueue.taskRotateNewChatByPageTurnEnabled !== false,

          taskRotateNewChatPageTurnThreshold: Math.max(
            1,
            Math.floor(
              Number(rawTaskQueue.taskRotateNewChatPageTurnThreshold)
              || taskQueueDefaults.taskRotateNewChatPageTurnThreshold
              || 30,
            ),
          ),

          taskRotateForceUploadAfterNewChat:
            rawTaskQueue.taskRotateForceUploadAfterNewChat !== false,

          maxConversationRoundsPerPage: Math.max(
            1,
            Math.floor(
              Number(rawTaskQueue.maxConversationRoundsPerPage)
              || taskQueueDefaults.maxConversationRoundsPerPage
              || 30,
            ),
          ),

          enableAutoNewChatWhenRoundLimitReached:
            rawTaskQueue.enableAutoNewChatWhenRoundLimitReached !== false,

          verifyAfterDoneSignalPrompt: String(
            rawTaskQueue.verifyAfterDoneSignalPrompt
            || taskQueueDefaults.verifyAfterDoneSignalPrompt
            || '',
          ),

          showRuntimeStats: rawTaskQueue.showRuntimeStats !== false,
          preserveRuntimeStatsAverage: rawTaskQueue.preserveRuntimeStatsAverage === true,
          runtimeStatsRefreshIntervalMs: (() => {
            const allowed = [1000, 2000, 5000];
            const n = Number(rawTaskQueue.runtimeStatsRefreshIntervalMs);
            return allowed.includes(n) ? n : (taskQueueDefaults.runtimeStatsRefreshIntervalMs || 1000);
          })(),

          taskRelentlessSendRetryEnabled:
            rawTaskQueue.taskRelentlessSendRetryEnabled !== false,

          taskRelentlessSendRetryIntervalMs: Math.max(
            300,
            Math.floor(
              Number(rawTaskQueue.taskRelentlessSendRetryIntervalMs)
              || taskQueueDefaults.taskRelentlessSendRetryIntervalMs
              || 1500,
            ),
          ),

          taskRelentlessSendRetryMaxIntervalMs: Math.max(
            1000,
            Math.floor(
              Number(rawTaskQueue.taskRelentlessSendRetryMaxIntervalMs)
              || taskQueueDefaults.taskRelentlessSendRetryMaxIntervalMs
              || 10000,
            ),
          ),

          taskRelentlessSendRetryBackoffEnabled:
            rawTaskQueue.taskRelentlessSendRetryBackoffEnabled !== false,
        };
      }

      if (!taskProfileRepairPersisted && repairChanged) {
        taskProfileRepairPersisted = true;
        try {
          MemoryManager.set(
            MemoryManager.KEYS.autoQueueConfig,
            clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][repair-save]'),
          );
        } catch (repairSaveError) {
          console.warn('[AUTOQ][repair-save] failed', repairSaveError);
        }
      }
    }

    function getActiveTaskProfile() {
      normalizeTaskProfiles();

      return config.taskProfiles.find((item) => item.id === config.activeTaskProfileId)
        || config.taskProfiles[0]
        || null;
    }

    function buildAutoQueueTaskProfileName() {
      const d = new Date();
      const base = `任务组_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
      const names = new Set(config.taskProfiles.map((item) => item.name));

      return buildUniqueName(base, names);
    }

    function getEnabledTasksFromProfile(profile) {
      if (!profile || !Array.isArray(profile.tasks)) {
        return [];
      }

      return profile.tasks.filter((task) => task && task.enabled);
    }

    function normalizeAutoMode(mode) {
      if (mode === 'list') return 'list';
      if (mode === 'task') return 'task';
      return 'continue';
    }

    function ensureModeSettings(cfg = config) {
      const base = cloneDefaultModeSettings();
      const raw = cfg && typeof cfg.modeSettings === 'object'
        ? cfg.modeSettings
        : {};

      return {
        continue: cloneModeSettingItem(Object.assign({}, base.continue, raw.continue || {})),
        list: cloneModeSettingItem(Object.assign({}, base.list, raw.list || {})),
        task: cloneModeSettingItem(Object.assign({}, base.task, raw.task || {})),
      };
    }

    function normalizeAutoConfig(cfg = config) {
      cfg.modeSettings = ensureModeSettings(cfg);
      cfg.promptMode = normalizeAutoMode(cfg.promptMode);
      return cfg;
    }

    normalizeAutoConfig(config);
    normalizeListProfiles();
    normalizeTaskProfiles();

    function getModeSettings(mode) {
      const m = normalizeAutoMode(mode);
      config.modeSettings = ensureModeSettings(config);
      return config.modeSettings[m];
    }

    function patchModeSettings(mode, patch) {
      const m = normalizeAutoMode(mode);
      config.modeSettings = ensureModeSettings(config);

      const target = config.modeSettings[m];
      const safePatch = patch && typeof patch === 'object' ? patch : {};

      if (Object.prototype.hasOwnProperty.call(safePatch, 'loopMode')) {
        target.loopMode = !!safePatch.loopMode;
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMinSec')) {
        target.randomMinSec = Math.max(1, Number(safePatch.randomMinSec) || 1);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMaxSec')) {
        target.randomMaxSec = Math.max(target.randomMinSec, Number(safePatch.randomMaxSec) || target.randomMinSec);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'maxLoopCount')) {
        target.maxLoopCount = Math.max(0, Number(safePatch.maxLoopCount) || 0);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'logPinned')) {
        target.logPinned = !!safePatch.logPinned;
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'autoScrollPanel')) {
        target.autoScrollPanel = !!safePatch.autoScrollPanel;
      }
    }

    function readCurrentModeSettingsFromUi(mode) {
      if (!root) return;

      const m = normalizeAutoMode(mode);
      const loopEl = qs('#cgpt-autoq-loop', root);
      const minEl = qs('#cgpt-autoq-min-sec', root);
      const maxEl = qs('#cgpt-autoq-max-sec', root);
      const maxLoopEl = qs('#cgpt-autoq-max-loop', root);
      const logPinnedEl = qs('#cgpt-autoq-log-pinned', root);
      const autoScrollEl = qs('#cgpt-autoq-auto-scroll', root);
      const minSec = Math.max(1, Number(minEl && minEl.value) || 3);

      patchModeSettings(m, {
        loopMode: !!(loopEl && loopEl.checked),
        randomMinSec: minSec,
        randomMaxSec: Math.max(minSec, Number(maxEl && maxEl.value) || minSec),
        maxLoopCount: Math.max(0, Number(maxLoopEl && maxLoopEl.value) || 0),
        logPinned: !!(logPinnedEl && logPinnedEl.checked),
        autoScrollPanel: !!(autoScrollEl && autoScrollEl.checked),
      });
    }

    function applyModeSettingsToUi(mode) {
      if (!root) return;

      const settings = getModeSettings(mode);
      const loopEl = qs('#cgpt-autoq-loop', root);
      const minEl = qs('#cgpt-autoq-min-sec', root);
      const maxEl = qs('#cgpt-autoq-max-sec', root);
      const maxLoopEl = qs('#cgpt-autoq-max-loop', root);
      const logPinnedEl = qs('#cgpt-autoq-log-pinned', root);
      const autoScrollEl = qs('#cgpt-autoq-auto-scroll', root);

      if (loopEl) loopEl.checked = !!settings.loopMode;
      if (minEl) minEl.value = String(Number(settings.randomMinSec) || 3);
      if (maxEl) maxEl.value = String(Number(settings.randomMaxSec) || 20);
      if (maxLoopEl) maxLoopEl.value = String(Number(settings.maxLoopCount) || 0);
      if (logPinnedEl) logPinnedEl.checked = !!settings.logPinned;
      if (autoScrollEl) autoScrollEl.checked = !!settings.autoScrollPanel;
    }

    function refreshPromptTextareaForMode(mode) {
      if (!promptsEl) return;

      const m = normalizeAutoMode(mode);

      if (m === 'task') {
        return;
      }

      if (m === 'list') {
        const active = getActiveListProfile();
        promptsEl.value = active ? String(active.text || '') : '';
        return;
      }

      const storedContinue = String(config.continuePromptsText || '').trim();
      promptsEl.value = storedContinue || getDefaultContinuePromptTextForUi();
    }

    function renderTaskPanelVisibility() {
      const isTask = config.promptMode === 'task';

      if (taskPanelEl) {
        taskPanelEl.classList.toggle('cgpt-toolbox-hidden', !isTask);
      }

      const editorBlock = root ? qs('.cgpt-autoq-editor-block', root) : null;

      if (editorBlock) {
        editorBlock.classList.toggle('cgpt-toolbox-hidden', isTask);
      }

      if (isTask) {
        ensureBatchSubTabShell();
        renderBatchSubtabsOnly('task-panel-visibility');
        reparentBatchModeUiBlocks();
      } else {
        restoreBatchModeUiBlocks();
      }

      const settingsEl = root ? qs('.cgpt-autoq-settings-section', root) : null;

      if (settingsEl && settingsEl.parentElement && !settingsEl.closest('#cgpt-autoq-batch-settings-slot')) {
        settingsEl.classList.toggle('cgpt-toolbox-hidden', isTask);
      }
    }

    function switchPromptMode(nextMode) {
      const prevMode = normalizeAutoMode(config.promptMode);
      const normalizedNext = normalizeAutoMode(nextMode);

      if (prevMode === normalizedNext) {
        updateModeTabs();
        renderListPanelVisibility();
        renderTaskPanelVisibility();
        renderListProfiles();
        renderTaskProfiles();
        renderTaskList();
        renderTaskEditor();
        updateStatus();
        return;
      }

      readPanelConfig(prevMode);
      log(`已保：${prevMode} 模式设置`);

      config.promptMode = normalizedNext;
      normalizeAutoConfig(config);

      refreshPromptTextareaForMode(normalizedNext);
      applyModeSettingsToUi(normalizedNext);
      updateModeTabs();
      renderListPanelVisibility();
      renderTaskPanelVisibility();
      renderListProfiles();
      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();

      log(`已切换到 ${normalizedNext} 模式`);
      log(`已恢：${normalizedNext} 模式设置`);

      if (normalizedNext === 'list') {
        ToolboxShell.setStatus('已切换到列表模式');
      } else if (normalizedNext === 'task') {
        ToolboxShell.setStatus('已切换到批量任务');
      } else {
        ToolboxShell.setStatus('已切换到继续模式');
      }
    }

    const state = {
      phase: 'idle',
      phaseReason: '',
      currentRunId: '',
      autoQueueRun: null,
      currentGroupId: '',
      currentTaskId: '',
      currentMessageId: '',
      startedAt: 0,
      updatedAt: 0,
      running: false,
      waitingReply: false,
      continueUntilDoneStrict: false,
      queue: [],
      idx: 0,
      sentCount: 0,
      nextSendAt: 0,
      completedLoops: 0,
      tickTimer: null,
      replyBecameBusy: false,
      idleSince: 0,
      waitingStartedAt: 0,
      waitingNoBusyTimeoutMs: 45000,
      sendingNow: false,
      uploadingFromAutoQueue: false,
      autoQueueUploadStatus: 'idle',
      autoQueueUploadStats: {
        uploaded: 0,
        failed: 0,
        skipped: 0,
        reason: '',
      },
      taskRun: {
        enabledTaskIds: [],
        currentIndex: -1,
        pendingSendKind: null,
        doneSignalVerificationRunning: false,
        currentStep: 'idle',
      },
      taskBatchStepRunning: false,
      batchInitialWaitLoggedAt: 0,
      batchTask: {
        phase: 'idle',
        currentTaskIndex: -1,
        batchStep: '',
        stopRequested: false,
        abortController: null,
      },
      lastBackgroundThrottleLogAt: 0,
      taskRateLimitLastLogAt: 0,
      taskUploadRateLimitLastLogAt: 0,
      lastTaskBatchStopReason: null,
      sendOnceTask: {
        phase: 'idle',
        runId: '',
        lastError: null,
      },
    };

    const AUTO_QUEUE_PHASES = Object.freeze({
      IDLE: 'idle',
      PREPARING: 'preparing',
      UPLOADING: 'uploading',
      UPLOAD_ATTACHED: 'upload_attached',
      SENDING: 'sending',
      SENT: 'sent',
      WAITING_REPLY: 'waiting_reply',
      REPLY_READY: 'reply_ready',
      DONE: 'done',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    });

    const AUTO_QUEUE_TERMINAL_PHASES = new Set([
      AUTO_QUEUE_PHASES.DONE,
      AUTO_QUEUE_PHASES.FAILED,
      AUTO_QUEUE_PHASES.CANCELLED,
    ]);

    const AUTO_QUEUE_ACTIVE_PHASES = new Set([
      AUTO_QUEUE_PHASES.PREPARING,
      AUTO_QUEUE_PHASES.UPLOADING,
      AUTO_QUEUE_PHASES.UPLOAD_ATTACHED,
      AUTO_QUEUE_PHASES.SENDING,
      AUTO_QUEUE_PHASES.SENT,
      AUTO_QUEUE_PHASES.WAITING_REPLY,
      AUTO_QUEUE_PHASES.REPLY_READY,
    ]);

    const AUTO_QUEUE_PHASE_TRANSITIONS = Object.freeze({
      idle: new Set(['preparing', 'uploading']),
      preparing: new Set([
        'uploading',
        'sending',
        'sent',
        'waiting_reply',
        'failed',
        'cancelled',
      ]),
      uploading: new Set([
        'upload_attached',
        'sending',
        'waiting_reply',
        'idle',
        'failed',
        'cancelled',
      ]),
      upload_attached: new Set(['sending', 'waiting_reply', 'failed', 'cancelled']),
      sending: new Set(['sent', 'waiting_reply', 'failed', 'cancelled']),
      sent: new Set(['waiting_reply', 'failed', 'cancelled']),
      waiting_reply: new Set([
        'reply_ready',
        'uploading',
        'sending',
        'done',
        'failed',
        'cancelled',
      ]),
      reply_ready: new Set(['done', 'preparing', 'failed', 'cancelled']),
      done: new Set(['idle']),
      failed: new Set(['idle']),
      cancelled: new Set(['idle']),
    });

    function syncLegacyRunFlagsFromPhase() {
      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      state.running = (
        !AUTO_QUEUE_TERMINAL_PHASES.has(phase)
        && phase !== AUTO_QUEUE_PHASES.IDLE
      );
      state.waitingReply = phase === AUTO_QUEUE_PHASES.WAITING_REPLY;
    }

    function getUploadGroupById(groupId) {
      const gid = String(groupId || '').trim();
      if (!gid) {
        return null;
      }
      if (typeof UploadGroupAppState !== 'undefined' && Array.isArray(UploadGroupAppState.uploadGroups)) {
        return UploadGroupAppState.uploadGroups.find((group) => group && group.id === gid) || null;
      }
      return null;
    }

    const TASK_ATTACHMENT_MODES = Object.freeze({
      REQUIRED: 'required',
      OPTIONAL: 'optional',
      NONE: 'none',
    });

    function resolveTaskAttachmentMode(task) {
      if (task && task.attachmentMode) {
        return String(task.attachmentMode).trim().toLowerCase();
      }
      if (task && task.requiresUpload === true) {
        return TASK_ATTACHMENT_MODES.REQUIRED;
      }
      if (task && task.allowNoFiles === true) {
        return TASK_ATTACHMENT_MODES.OPTIONAL;
      }
      if (task && task.attachmentMode === TASK_ATTACHMENT_MODES.NONE) {
        return TASK_ATTACHMENT_MODES.NONE;
      }
      return TASK_ATTACHMENT_MODES.OPTIONAL;
    }

    function getUploadGroupFiles(group) {
      if (!group) {
        return [];
      }
      if (Array.isArray(group.files)) {
        return group.files;
      }
      if (Array.isArray(group.queue)) {
        return group.queue;
      }
      return [];
    }

    function precheckUploadGroupForRun(run, task) {
      const mode = resolveTaskAttachmentMode(task);
      const groupId = String((run && run.groupId) || state.currentGroupId || '').trim();
      const group = getUploadGroupById(groupId);

      if (!group) {
        return {
          ok: false,
          shouldUpload: false,
          reason: 'upload group missing',
          mode,
        };
      }

      const files = getUploadGroupFiles(group);

      if (files.length === 0 && mode === TASK_ATTACHMENT_MODES.REQUIRED) {
        return {
          ok: false,
          shouldUpload: false,
          reason: 'upload files required but group is empty',
          mode,
        };
      }

      if (files.length === 0 && mode !== TASK_ATTACHMENT_MODES.REQUIRED) {
        return {
          ok: true,
          shouldUpload: false,
          reason: 'no files, skip upload',
          mode,
        };
      }

      return {
        ok: true,
        shouldUpload: true,
        reason: 'files ready',
        mode,
      };
    }

    function buildAssistantReplySnapshot() {
      const reply = {
        text: '',
        messageId: '',
        parentMessageId: '',
        isStreaming: false,
      };

      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.isAssistantLikelyBusy === 'function') {
        reply.isStreaming = !!ComposerApi.isAssistantLikelyBusy();
      }

      if (
        typeof ChatMessageExtractor !== 'undefined'
        && typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
      ) {
        try {
          const records = ChatMessageExtractor.getFastTailMessageRecords();
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
          if (picked && picked.ok && picked.record) {
            reply.text = String(picked.record.text || '').trim();
            reply.messageId = String(picked.record.turn_id || picked.record.turnId || '').trim();
            if (picked.latestUser) {
              reply.parentMessageId = String(
                picked.latestUser.turn_id || picked.latestUser.turnId || '',
              ).trim();
            }
          }
        } catch (error) {
          console.error('[AUTO_QUEUE][REPLY_SNAPSHOT_FAILED]', error);
        }
      }

      if (!reply.text) {
        try {
          reply.text = String(getLastAssistantReplyText() || '').trim();
        } catch (error) {
          console.error('[AUTO_QUEUE][REPLY_TEXT_FALLBACK_FAILED]', error);
        }
      }

      return reply;
    }

    function validateAssistantReplyForRun(run, reply) {
      const snapshot = reply && typeof reply === 'object' ? reply : buildAssistantReplySnapshot();

      if (!snapshot || !String(snapshot.text || '').trim()) {
        return { ok: false, reason: 'reply text is empty', reply: snapshot };
      }

      if (snapshot.isStreaming) {
        return { ok: false, reason: 'reply is still streaming', reply: snapshot };
      }

      const currentMessageId = String(state.currentMessageId || '').trim();
      if (
        snapshot.parentMessageId
        && currentMessageId
        && snapshot.parentMessageId !== currentMessageId
      ) {
        return {
          ok: false,
          reason: 'reply parent message mismatch',
          reply: snapshot,
        };
      }

      return { ok: true, reason: 'reply valid', reply: snapshot };
    }

    function resolveRunGroupIdBeforeStart() {
      let groupId = '';
      if (typeof UploadGroupAppState !== 'undefined') {
        groupId = String(UploadGroupAppState.activeUploadGroupId || '').trim();
      }
      if (!groupId && typeof UploadModule !== 'undefined' && typeof UploadModule.getActiveGroupId === 'function') {
        groupId = String(UploadModule.getActiveGroupId() || '').trim();
      }
      if (!groupId) {
        ToolboxShell.appendLog('[AUTO_QUEUE][START_REJECT_NO_ACTIVE_GROUP] activeGroupId=-');
        return '';
      }
      if (!getUploadGroupById(groupId)) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][START_REJECT_ACTIVE_GROUP_MISSING] activeGroupId=${groupId}`,
        );
        return '';
      }
      return groupId;
    }

    function transitionAutoQueuePhase(nextPhase, reason = '', options = {}) {
      const force = !!(options && options.force);
      const currentPhase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      const normalizedNext = String(nextPhase || AUTO_QUEUE_PHASES.IDLE);

      if (currentPhase === normalizedNext) {
        state.phaseReason = String(reason || '');
        state.updatedAt = Date.now();
        syncLegacyRunFlagsFromPhase();
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][PHASE_REFRESH] phase=${normalizedNext} reason=${reason || '-'} `
          + `runId=${state.currentRunId || '-'}`,
        );
        return true;
      }

      const allowedNext = AUTO_QUEUE_PHASE_TRANSITIONS[currentPhase];
      if (!force && (!allowedNext || !allowedNext.has(normalizedNext))) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][INVALID_PHASE_TRANSITION] from=${currentPhase} to=${normalizedNext} `
          + `reason=${reason || '-'} runId=${state.currentRunId || '-'}`,
        );
        return false;
      }

      state.phase = normalizedNext;
      state.phaseReason = String(reason || '');
      state.updatedAt = Date.now();
      syncLegacyRunFlagsFromPhase();
      ToolboxShell.appendLog(
        `[AUTO_QUEUE][PHASE] from=${currentPhase} to=${normalizedNext} `
        + `reason=${reason || '-'} runId=${state.currentRunId || '-'} `
        + `groupId=${state.currentGroupId || '-'} taskId=${state.currentTaskId || '-'}`,
      );
      return true;
    }

    function setAutoQueuePhase(nextPhase, reason = '', options = {}) {
      return transitionAutoQueuePhase(nextPhase, reason, options);
    }

    function captureAutoQueueRunId() {
      return String(state.currentRunId || '').trim();
    }

    function isCurrentAutoQueueRun(runId) {
      return Boolean(runId) && String(runId) === String(state.currentRunId || '');
    }

    function isStaleAutoQueueRun(runId, tag = '') {
      const stale = !isCurrentAutoQueueRun(runId);
      if (stale && tag) {
        ignoreStaleAutoQueueEvent(tag, runId);
      }
      return stale;
    }

    function ignoreStaleAutoQueueEvent(eventName, runId, extra) {
      const payload = {
        eventName: eventName || '-',
        eventRunId: runId || '-',
        currentRunId: state.currentRunId || '-',
        phase: state.phase || '-',
        ...(extra && typeof extra === 'object' ? extra : {}),
      };
      ToolboxShell.appendLog(
        `[AUTO_QUEUE][STALE_EVENT_IGNORED] ${JSON.stringify(payload)}`,
      );
    }

    function createAutoQueueRunContext(task, groupId) {
      const frozenGroupId = String(groupId || '').trim();
      const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      state.currentRunId = runId;
      state.startedAt = Date.now();
      state.updatedAt = state.startedAt;
      state.phaseReason = '';
      state.currentMessageId = '';
      state.currentGroupId = frozenGroupId;
      const runningTask = task || (
        typeof getCurrentRunningTask === 'function' ? getCurrentRunningTask() : null
      );
      state.currentTaskId = runningTask ? String(runningTask.id || '') : '';
      const run = {
        runId,
        taskId: state.currentTaskId,
        groupId: state.currentGroupId,
        startedAt: state.startedAt,
      };
      state.autoQueueRun = run;
      ToolboxShell.appendLog(
        `[AUTO_QUEUE][RUN_CREATE] runId=${runId} `
        + `groupId=${state.currentGroupId || '-'} taskId=${state.currentTaskId || '-'}`,
      );
      return run;
    }

    function freezeAutoQueueRunContext(task, groupId) {
      const frozenGroupId = String(groupId || resolveRunGroupIdBeforeStart() || '').trim();
      if (!frozenGroupId || !getUploadGroupById(frozenGroupId)) {
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'active upload group missing', { force: true });
        return false;
      }
      createAutoQueueRunContext(
        task || (typeof getCurrentRunningTask === 'function' ? getCurrentRunningTask() : null),
        frozenGroupId,
      );
      return true;
    }

    function invalidateAutoQueueRun(reason = 'cancelled') {
      const previousRunId = state.currentRunId || '-';
      state.currentRunId = '';
      state.currentMessageId = '';
      state.autoQueueRun = null;
      const terminalPhase = reason === 'all-done'
        ? AUTO_QUEUE_PHASES.DONE
        : AUTO_QUEUE_PHASES.CANCELLED;
      transitionAutoQueuePhase(terminalPhase, reason, { force: true });
      ToolboxShell.appendLog(
        `[AUTO_QUEUE][RUN_CANCEL] previousRunId=${previousRunId} reason=${reason || '-'}`,
      );
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.sendingNow = false;
      state.uploadingFromAutoQueue = false;
      if (state.batchTask) {
        state.batchTask.stopRequested = false;
      }
      if (state.tickTimer) {
        window.clearInterval(state.tickTimer);
        state.tickTimer = null;
      }
    }

    function getAutoQueueButtonViewModel() {
      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      const reason = String(state.phaseReason || '').trim();

      if (phase === AUTO_QUEUE_PHASES.IDLE) {
        return { text: '开始', enabled: true, action: 'start', statusText: '空闲' };
      }
      if (phase === AUTO_QUEUE_PHASES.DONE) {
        return { text: '开始', enabled: true, action: 'start', statusText: '已完成' };
      }
      if (phase === AUTO_QUEUE_PHASES.FAILED) {
        return {
          text: '开始',
          enabled: true,
          action: 'start',
          statusText: reason ? `失败：${reason}` : '失败',
        };
      }
      if (phase === AUTO_QUEUE_PHASES.CANCELLED) {
        return { text: '开始', enabled: true, action: 'start', statusText: '已停止' };
      }
      if (phase === AUTO_QUEUE_PHASES.PREPARING) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '准备中' };
      }
      if (phase === AUTO_QUEUE_PHASES.UPLOADING) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '上传中' };
      }
      if (phase === AUTO_QUEUE_PHASES.UPLOAD_ATTACHED) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '上传完成' };
      }
      if (phase === AUTO_QUEUE_PHASES.SENDING) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '发送中' };
      }
      if (phase === AUTO_QUEUE_PHASES.SENT) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '已发送' };
      }
      if (phase === AUTO_QUEUE_PHASES.WAITING_REPLY) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '等待回复中' };
      }
      if (phase === AUTO_QUEUE_PHASES.REPLY_READY) {
        return { text: '停止', enabled: true, action: 'cancel', statusText: '回复就绪' };
      }
      return { text: '停止', enabled: true, action: 'cancel', statusText: phase };
    }

    function getActiveUploadGroupIdForRun() {
      if (state.running || AUTO_QUEUE_ACTIVE_PHASES.has(state.phase)) {
        const frozenGroupId = String(state.currentGroupId || '').trim();
        if (!frozenGroupId) {
          transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'run group missing', { force: true });
          return '';
        }
        if (!getUploadGroupById(frozenGroupId)) {
          transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'run group no longer exists', { force: true });
          return '';
        }
        return frozenGroupId;
      }
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.getActiveGroupId === 'function') {
        return String(UploadModule.getActiveGroupId() || '').trim();
      }
      return '';
    }

    let root = null;
    let promptsEl = null;
    let logEl = null;
    let startBtn = null;
    let startUploadBtn = null;
    let stopBtn = null;
    let listPanelEl = null;
    let listProfilesEl = null;
    let listProfileNameEl = null;
    let listProfileDeleteConfirmUntil = 0;
    let taskPanelEl = null;
    let taskProfilesEl = null;
    let taskProfileNameEl = null;
    let taskListEl = null;
    let taskEditorEl = null;
    let taskProfileDefaultsEl = null;
    let mainLiteEl = null;
    let selectedTaskId = '';
    let taskProfileDeleteConfirmUntil = 0;
    let promptPickerOverlay = null;
    let promptPickerSelectedIds = new Set();
    let promptPickerFilterSearch = '';
    let promptPickerFilterCategory = '';
    const PROMPT_PICKER_MODAL_POSITION_KEY = 'cgpt_autoq_prompt_picker_modal_position';
    const promptPickerPosition = createPersistedPanelPositionController({
      key: PROMPT_PICKER_MODAL_POSITION_KEY,
      defaultWidth: 620,
      defaultHeight: 460,
      logPrefix: 'AUTOQ][PROMPT_PICKER_MODAL',
      memory: MemoryManager,
      appendLog: (line) => {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(line);
        }
      },
    });
    let promptPickerResizeBound = false;
    let batchModeActiveSubTab = 'tasks';
    let batchSubTabsEl = null;
    let batchSubTabContentEl = null;

    const BATCH_SUB_TABS = [
      { id: 'tasks', label: '任务列表' },
      { id: 'current', label: '当前任务编辑' },
      { id: 'rules', label: '默认规则' },
      { id: 'settings', label: '执行设置' },
    ];

    function normalizeBatchSubtab(value) {
      const raw = String(value || '').trim();

      if (
        raw === 'task-list'
        || raw === 'tasks'
        || raw === 'list'
      ) {
        return 'tasks';
      }

      if (
        raw === 'current-task'
        || raw === 'current'
        || raw === 'task-edit'
        || raw === 'edit'
      ) {
        return 'current';
      }

      if (
        raw === 'default-rules'
        || raw === 'rules'
        || raw === 'default'
      ) {
        return 'rules';
      }

      if (
        raw === 'execution-settings'
        || raw === 'settings'
        || raw === 'execute-settings'
      ) {
        return 'settings';
      }

      return 'tasks';
    }

    function getToolboxScrollContainer() {
      if (root && root.closest) {
        const panel = root.closest('.cgpt-toolbox-panel, .cgpt-panel, #cgpt-toolbox-root');

        if (panel) {
          return panel;
        }
      }

      return document.scrollingElement || document.documentElement;
    }

    function snapshotBatchScrollState() {
      const toolboxScroll = getToolboxScrollContainer();
      const bodyScroll = document.scrollingElement || document.documentElement;
      const contentScroll = root
        ? root.querySelector('.cgpt-autoq-batch-subtab-content')
        : null;

      return {
        toolboxScroll,
        toolboxTop: toolboxScroll ? toolboxScroll.scrollTop : 0,
        bodyScroll,
        bodyTop: bodyScroll ? bodyScroll.scrollTop : 0,
        contentScroll,
        contentTop: contentScroll ? contentScroll.scrollTop : 0,
      };
    }

    function restoreBatchModeActiveSubtabFromMemory() {
      if (typeof MemoryManager === 'undefined' || !MemoryManager.KEYS || !MemoryManager.KEYS.autoqueueActiveSubtab) {
        return;
      }

      const stored = MemoryManager.get(MemoryManager.KEYS.autoqueueActiveSubtab, '');

      if (stored) {
        batchModeActiveSubTab = normalizeBatchSubtab(stored);
      }
    }

    function restoreBatchScrollState(snapshot, reason = '') {
      if (!snapshot || typeof snapshot !== 'object') {
        return;
      }

      window.requestAnimationFrame(() => {
        if (snapshot.toolboxScroll) {
          snapshot.toolboxScroll.scrollTop = snapshot.toolboxTop;
        }

        if (snapshot.bodyScroll) {
          snapshot.bodyScroll.scrollTop = snapshot.bodyTop;
        }

        if (snapshot.contentScroll) {
          snapshot.contentScroll.scrollTop = snapshot.contentTop;
        }

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[AUTOQUEUE_UI][RESTORE_SCROLL] reason=${reason || '-'} toolboxTop=${snapshot.toolboxTop} bodyTop=${snapshot.bodyTop} contentTop=${snapshot.contentTop}`,
          );
        }
      });
    }

    function ensureBatchSubtabButtons() {
      refreshBatchTaskPanelRefs();

      if (!batchSubTabsEl) {
        return;
      }

      if (batchSubTabsEl.querySelector('[data-batch-subtab]')) {
        return;
      }

      batchSubTabsEl.innerHTML = BATCH_SUB_TABS.map((tab) => {
        const active = tab.id === batchModeActiveSubTab ? ' active' : '';

        return `<button type="button" class="cgpt-autoq-batch-subtab${active}" data-batch-subtab="${tab.id}" aria-selected="${tab.id === batchModeActiveSubTab ? 'true' : 'false'}">${escapeHtml(tab.label)}</button>`;
      }).join('');
    }

    function renderBatchSubtabsOnly(reason = '') {
      refreshBatchTaskPanelRefs();
      ensureBatchSubtabButtons();

      const active = normalizeBatchSubtab(batchModeActiveSubTab);
      batchModeActiveSubTab = active;

      if (batchSubTabsEl) {
        qsa('[data-batch-subtab]', batchSubTabsEl).forEach((btn) => {
          const key = normalizeBatchSubtab(btn.getAttribute('data-batch-subtab'));
          const isActive = key === active;

          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
      }

      if (batchSubTabContentEl) {
        qsa('[data-batch-tab-panel]', batchSubTabContentEl).forEach((panel) => {
          const key = normalizeBatchSubtab(panel.getAttribute('data-batch-tab-panel'));
          const isActive = key === active;

          panel.hidden = !isActive;
          panel.classList.toggle('cgpt-toolbox-hidden', !isActive);
          panel.style.display = isActive ? '' : 'none';
        });
      }

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[AUTOQUEUE_UI][SUBTAB_RENDER_ONLY] reason=${reason || '-'} active=${active}`,
        );
      }
    }

    const batchUiRestore = {
      actionsParent: null,
      actionsNext: null,
      settingsParent: null,
      settingsNext: null,
    };

    function syncBatchSubTabRefs() {
      if (!root) {
        return;
      }

      batchSubTabContentEl = qs('#cgpt-autoq-batch-subtab-content', root);
      taskListEl = qs('#cgpt-autoq-task-list', root);
      taskEditorEl = qs('#cgpt-autoq-task-editor', root);
      taskProfileDefaultsEl = qs('#cgpt-autoq-task-profile-defaults', root);
    }

    function refreshBatchTaskPanelRefs() {
      if (!taskPanelEl) return;

      batchSubTabsEl = qs('#cgpt-autoq-batch-subtabs', taskPanelEl);
      batchSubTabContentEl = qs('#cgpt-autoq-batch-subtab-content', taskPanelEl);
      taskProfilesEl = qs('#cgpt-autoq-task-profile-chips', taskPanelEl);
      taskProfileNameEl = qs('#cgpt-autoq-task-profile-name', taskPanelEl);
      taskListEl = qs('#cgpt-autoq-task-list', taskPanelEl);
      taskEditorEl = qs('#cgpt-autoq-task-editor', taskPanelEl);
      taskProfileDefaultsEl = qs('#cgpt-autoq-task-profile-defaults', taskPanelEl);
    }

    function ensureBatchSubTabShell() {
      if (!taskPanelEl) return;

      refreshBatchTaskPanelRefs();

      if (!batchSubTabContentEl) return;

      if (batchSubTabContentEl.dataset.batchShellReady === '1') {
        return;
      }

      const legacyHeader = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-header');
      const legacyNameRow = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-name-row');
      const legacyList = qs('#cgpt-autoq-task-list', taskPanelEl);
      const legacyEditor = qs('#cgpt-autoq-task-editor', taskPanelEl);
      const legacyDefaults = qs('#cgpt-autoq-task-profile-defaults', taskPanelEl);

      batchSubTabContentEl.innerHTML = `
        <div class="cgpt-autoq-batch-tab-panel" data-batch-tab-panel="tasks">
          <div class="cgpt-autoq-batch-tab-panel-scroll">
            <div class="cgpt-autoq-list-header cgpt-autoq-batch-tasks-profile-header">
              <div class="cgpt-autoq-list-profile-chips cgpt-autoq-task-profile-chips" id="cgpt-autoq-task-profile-chips"></div>
              <button type="button" class="cgpt-toolbox-small-btn cgpt-autoq-import-prompt-btn" id="cgpt-autoq-task-import-prompts-top">导入 Prompt</button>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-new">新建任务组</button>
            </div>
            <div class="cgpt-autoq-list-name-row">
              <input class="cgpt-input" id="cgpt-autoq-task-profile-name" placeholder="任务组名称">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-save-name">保存名称</button>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-delete">删除任务组</button>
            </div>
            <div class="cgpt-autoq-task-list-toolbar">
              <span class="cgpt-autoq-label">任务列表</span>
              <div class="cgpt-autoq-task-list-toolbar-actions">
                <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-add">新增任务</button>
                <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-pick-prompts">从 Prompt 导入</button>
                <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-clear-examples">清空示例任务</button>
              </div>
            </div>
            <div class="cgpt-autoq-task-list" id="cgpt-autoq-task-list"></div>
          </div>
        </div>
        <div class="cgpt-autoq-batch-tab-panel cgpt-toolbox-hidden" data-batch-tab-panel="current">
          <div class="cgpt-autoq-batch-tab-panel-scroll">
            <div class="cgpt-autoq-task-editor" id="cgpt-autoq-task-editor"></div>
          </div>
        </div>
        <div class="cgpt-autoq-batch-tab-panel cgpt-toolbox-hidden" data-batch-tab-panel="rules">
          <div class="cgpt-autoq-batch-tab-panel-scroll">
            <div class="cgpt-autoq-task-profile-defaults" id="cgpt-autoq-task-profile-defaults"></div>
          </div>
        </div>
        <div class="cgpt-autoq-batch-tab-panel cgpt-toolbox-hidden" data-batch-tab-panel="settings">
          <div class="cgpt-autoq-batch-tab-panel-scroll">
            <div class="cgpt-autoq-batch-settings-slot" id="cgpt-autoq-batch-settings-slot"></div>
          </div>
        </div>`;

      const tasksPanel = qs('[data-batch-tab-panel="tasks"]', batchSubTabContentEl);

      if (legacyHeader && tasksPanel) {
        const shellHeader = qs('.cgpt-autoq-batch-tasks-profile-header', tasksPanel);

        if (shellHeader) {
          shellHeader.replaceWith(legacyHeader);
        }
      }

      if (legacyNameRow && tasksPanel) {
        const shellNameRow = qs('.cgpt-autoq-list-name-row', tasksPanel);

        if (shellNameRow && shellNameRow !== legacyNameRow) {
          shellNameRow.replaceWith(legacyNameRow);
        }
      }

      if (legacyList && tasksPanel) {
        const shellList = qs('#cgpt-autoq-task-list', tasksPanel);

        if (shellList && shellList !== legacyList) {
          shellList.replaceWith(legacyList);
        }
      }

      const currentPanel = qs('[data-batch-tab-panel="current"]', batchSubTabContentEl);

      if (legacyEditor && currentPanel) {
        const shellEditor = qs('#cgpt-autoq-task-editor', currentPanel);

        if (shellEditor && shellEditor !== legacyEditor) {
          shellEditor.replaceWith(legacyEditor);
        }
      }

      const rulesPanel = qs('[data-batch-tab-panel="rules"]', batchSubTabContentEl);

      if (legacyDefaults && rulesPanel) {
        const shellDefaults = qs('#cgpt-autoq-task-profile-defaults', rulesPanel);

        if (shellDefaults && shellDefaults !== legacyDefaults) {
          shellDefaults.replaceWith(legacyDefaults);
        }
      }

      if (legacyHeader && legacyHeader.parentElement === taskPanelEl) {
        legacyHeader.remove();
      }

      if (legacyNameRow && legacyNameRow.parentElement === taskPanelEl) {
        legacyNameRow.remove();
      }

      batchSubTabContentEl.dataset.batchShellReady = '1';
      refreshBatchTaskPanelRefs();
      ensureBatchSubtabButtons();
      renderBatchSubtabsOnly('batch-shell-ready');
      bindBatchSubTabEvents();
      bindTaskPanelEvents();
    }

    function reparentBatchModeUiBlocks() {
      if (!root || config.promptMode !== 'task') return;

      const actionsEl = qs('.cgpt-autoq-actions', root);
      const settingsEl = qs('.cgpt-autoq-settings-section', root);
      const settingsSlot = qs('#cgpt-autoq-batch-settings-slot', root);

      refreshBatchTaskPanelRefs();
      const subtabsEl = batchSubTabsEl || (taskPanelEl ? qs('#cgpt-autoq-batch-subtabs', taskPanelEl) : null);

      if (actionsEl && taskPanelEl && subtabsEl) {
        if (!batchUiRestore.actionsParent) {
          batchUiRestore.actionsParent = actionsEl.parentElement;
          batchUiRestore.actionsNext = actionsEl.nextSibling;
        }

        actionsEl.classList.add('cgpt-autoq-top-action-bar');
        actionsEl.id = 'cgpt-autoq-top-action-bar';

        if (actionsEl.parentElement !== taskPanelEl || actionsEl.nextElementSibling !== subtabsEl) {
          taskPanelEl.insertBefore(actionsEl, subtabsEl);
        }
      }

      if (settingsEl && settingsSlot && settingsEl.parentElement !== settingsSlot) {
        if (!batchUiRestore.settingsParent) {
          batchUiRestore.settingsParent = settingsEl.parentElement;
          batchUiRestore.settingsNext = settingsEl.nextSibling;
        }

        settingsSlot.appendChild(settingsEl);
        settingsEl.classList.remove('cgpt-toolbox-hidden');
      }
    }

    function restoreBatchModeUiBlocks() {
      if (!root) return;

      const actionsEl = qs('.cgpt-autoq-actions', root) || qs('#cgpt-autoq-top-action-bar', root);
      const settingsEl = qs('.cgpt-autoq-settings-section', root);

      if (actionsEl) {
        actionsEl.classList.remove('cgpt-autoq-top-action-bar');
        if (actionsEl.id === 'cgpt-autoq-top-action-bar') {
          actionsEl.removeAttribute('id');
        }
      }

      if (actionsEl && batchUiRestore.actionsParent) {
        if (batchUiRestore.actionsNext) {
          batchUiRestore.actionsParent.insertBefore(actionsEl, batchUiRestore.actionsNext);
        } else {
          batchUiRestore.actionsParent.appendChild(actionsEl);
        }
      }

      if (settingsEl && batchUiRestore.settingsParent) {
        if (batchUiRestore.settingsNext) {
          batchUiRestore.settingsParent.insertBefore(settingsEl, batchUiRestore.settingsNext);
        } else {
          batchUiRestore.settingsParent.appendChild(settingsEl);
        }
      }
    }

    function switchBatchSubTab(tabId, reason = '') {
      const next = normalizeBatchSubtab(tabId);

      if (!next) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[AUTOQUEUE_UI][SUBTAB_SKIP] reason=${reason || '-'} detail=empty-subtab`);
        }

        return;
      }

      const prev = normalizeBatchSubtab(batchModeActiveSubTab);

      if (prev === next) {
        return;
      }

      if (prev === 'current' || next === 'current') {
        readTaskEditorIntoSelected();
      }

      if (prev === 'rules' || next === 'rules') {
        readTaskProfileDefaultsIntoActive();
      }

      const scrollSnapshot = snapshotBatchScrollState();

      batchModeActiveSubTab = next;

      if (typeof MemoryManager !== 'undefined' && MemoryManager.KEYS && MemoryManager.KEYS.autoqueueActiveSubtab) {
        MemoryManager.set(MemoryManager.KEYS.autoqueueActiveSubtab, batchModeActiveSubTab);
      }

      renderBatchSubtabsOnly(reason || 'switch-subtab');
      restoreBatchScrollState(scrollSnapshot, reason || 'switch-subtab');
    }

    function renderBatchTaskGroupContent() {
      if (config.promptMode !== 'task') return;

      renderTaskList();
      renderTaskEditor();
      renderTaskProfileDefaults();
    }

    function bindBatchSubTabEvents() {
      if (!batchSubTabsEl) return;

      bindOnce(batchSubTabsEl, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const btn = e.target instanceof HTMLElement
          ? e.target.closest('[data-batch-subtab]')
          : null;

        if (!btn) return;

        const nextSubtab = String(btn.getAttribute('data-batch-subtab') || '').trim();
        switchBatchSubTab(nextSubtab, 'subtab-click');
      }, 'autoq-batch-subtabs-click');
    }

    function bindTaskPanelEvents() {
      if (!root) return;

      refreshBatchTaskPanelRefs();

      if (taskProfilesEl) {
        bindOnce(taskProfilesEl, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-autoq-task-chip[data-task-profile-id]')
            : null;

          if (!btn) return;

          const id = btn.getAttribute('data-task-profile-id');

          if (!id) {
            console.warn('[ChatGPT toolbox] task profile chip clicked without id');
            return;
          }

          switchTaskProfile(id);
        }, 'autoq-task-profiles-click');
      }

      const newTaskProfileBtn = qs('#cgpt-autoq-task-profile-new', root);
      if (newTaskProfileBtn) {
        bindOnce(newTaskProfileBtn, 'click', () => {
          createTaskProfileInline();
        }, 'autoq-task-profile-new');
      }

      const saveTaskProfileNameBtn = qs('#cgpt-autoq-task-profile-save-name', root);
      if (saveTaskProfileNameBtn) {
        bindOnce(saveTaskProfileNameBtn, 'click', () => {
          renameActiveTaskProfileInline();
        }, 'autoq-task-profile-save-name');
      }

      const deleteTaskProfileBtn = qs('#cgpt-autoq-task-profile-delete', root);
      if (deleteTaskProfileBtn) {
        bindOnce(deleteTaskProfileBtn, 'click', (e) => {
          deleteActiveTaskProfileInline(e.currentTarget);
        }, 'autoq-task-profile-delete');
      }

      if (taskProfileNameEl) {
        bindOnce(taskProfileNameEl, 'keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          renameActiveTaskProfileInline();
        }, 'autoq-task-profile-name-keydown');

        bindOnce(taskProfileNameEl, 'blur', () => {
          const active = getActiveTaskProfile();
          const text = String(taskProfileNameEl.value || '').trim();
          if (!active) return;
          if (!text) return;
          if (text === active.name) return;
          renameActiveTaskProfileInline();
        }, 'autoq-task-profile-name-blur');
      }

      const addTaskBtn = qs('#cgpt-autoq-task-add', root);
      if (addTaskBtn) {
        bindOnce(addTaskBtn, 'click', () => {
          addTaskInline();
        }, 'autoq-task-add');
      }

      const pickPromptsBtn = qs('#cgpt-autoq-task-pick-prompts', root);
      if (pickPromptsBtn) {
        bindOnce(pickPromptsBtn, 'click', (event) => {
          if (event && typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          openPromptPickerModal(event);
        }, 'autoq-task-pick-prompts');
      }

      const importPromptsTopBtn = qs('#cgpt-autoq-task-import-prompts-top', root);
      if (importPromptsTopBtn) {
        bindOnce(importPromptsTopBtn, 'click', (event) => {
          if (event && typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          openPromptPickerModal(event);
        }, 'autoq-task-import-prompts-top');
      }

      const clearExamplesBtn = qs('#cgpt-autoq-task-clear-examples', root);
      if (clearExamplesBtn) {
        bindOnce(clearExamplesBtn, 'click', () => {
          clearExampleTasksInline();
        }, 'autoq-task-clear-examples');
      }

      if (taskListEl) {
        bindOnce(taskListEl, 'click', handleTaskListAction, 'autoq-task-list-click');
      }
    }

    function isPromptBatchTaskSelected(promptId) {
      const profile = getActiveTaskProfile();
      if (!profile) {
        return false;
      }

      return !!findPromptTaskInProfile(profile, promptId);
    }

    function findPromptForLinkedTask(task) {
      if (
        !task
        || task.sourceType !== 'prompt-manager'
        || !task.promptId
        || typeof PromptManagerModule === 'undefined'
        || typeof PromptManagerModule.getPromptById !== 'function'
      ) {
        return { prompt: null, relinked: false };
      }

      const byId = PromptManagerModule.getPromptById(task.promptId);
      if (byId) {
        return { prompt: byId, relinked: false };
      }

      if (typeof PromptManagerModule.getPrompts !== 'function') {
        return { prompt: null, relinked: false };
      }

      const list = PromptManagerModule.getPrompts();
      const taskTitle = String(task.title || '').trim();
      const taskContent = String(task.initialPrompt || '').trim();

      const exact = list.find((item) => {
        return String(item.title || '').trim() === taskTitle
          && String(item.content || '').trim() === taskContent;
      });

      if (exact) {
        return { prompt: exact, relinked: true };
      }

      const byTitle = list.find((item) => {
        return String(item.title || '').trim() === taskTitle;
      });

      if (byTitle) {
        return { prompt: byTitle, relinked: true };
      }

      return { prompt: null, relinked: false };
    }

    function getPromptTaskLinkState(task) {
      if (!task || task.sourceType !== 'prompt-manager' || !task.promptId) {
        return {
          isPromptTask: false,
          linked: false,
          missing: false,
          prompt: null,
        };
      }

      const result = findPromptForLinkedTask(task);
      const prompt = result && result.prompt ? result.prompt : null;

      return {
        isPromptTask: true,
        linked: !!prompt,
        missing: !prompt,
        prompt,
        relinked: !!(result && result.relinked),
      };
    }

    function detachPromptTaskFromPromptManager(task, reason = '-') {
      if (!task) {
        return {
          ok: false,
          reason: 'missing_task',
        };
      }

      const resolved = resolveTaskInitialPrompt(task, { log: false });

      task.title = String(resolved.title || task.title || '未命名任务');
      task.initialPrompt = String(resolved.initialPrompt || task.initialPrompt || '');
      task.sourceType = 'manual';
      delete task.promptId;
      delete task.promptMissing;
      task.updatedAt = nowMs();

      ToolboxShell.appendLog(
        `[AUTOQ][PROMPT_TASK][DETACH] taskId=${task.id || '-'} title=${task.title || '-'} reason=${reason}`,
      );

      return {
        ok: true,
      };
    }

    function refreshPromptLinkedTasks(reason = '') {
      let changed = false;
      let relinkedCount = 0;
      let missingCount = 0;

      normalizeTaskProfiles();

      config.taskProfiles.forEach((profile) => {
        if (!profile || !Array.isArray(profile.tasks)) {
          return;
        }

        profile.tasks.forEach((task) => {
          if (!task || task.sourceType !== 'prompt-manager' || !task.promptId) {
            return;
          }

          const result = findPromptForLinkedTask(task);
          const prompt = result.prompt;

          if (!prompt) {
            task.promptMissing = true;
            missingCount += 1;
            return;
          }

          const nextPromptId = String(prompt.id || task.promptId);
          const nextTitle = String(prompt.title || task.title || '未命名任务');
          const nextInitialPrompt = String(prompt.content || task.initialPrompt || '');

          let taskChanged = false;

          if (task.promptId !== nextPromptId) {
            task.promptId = nextPromptId;
            relinkedCount += 1;
            taskChanged = true;
          }

          if (task.title !== nextTitle) {
            task.title = nextTitle;
            taskChanged = true;
          }

          if (task.initialPrompt !== nextInitialPrompt) {
            task.initialPrompt = nextInitialPrompt;
            taskChanged = true;
          }

          if (task.promptMissing) {
            task.promptMissing = false;
            taskChanged = true;
          }

          if (taskChanged) {
            task.updatedAt = nowMs();
            changed = true;
          }
        });
      });

      if (changed) {
        saveConfig();
      }

      if (promptPickerOverlay && promptPickerOverlay.style.display !== 'none') {
        refreshPromptPickerModalList();
      }

      renderTaskList();
      renderTaskEditor();
      renderTaskProfileDefaults();
      updateStatus(`prompt-manager-refresh:${reason || '-'}`);

      ToolboxShell.appendLog(
        `[AUTOQ][PROMPT_TASK][REFRESH] reason=${reason || '-'} changed=${changed} relinked=${relinkedCount} missing=${missingCount}`,
      );
    }

    function getPromptPickerCategories(promptList) {
      const categories = new Set();
      (Array.isArray(promptList) ? promptList : []).forEach((prompt) => {
        categories.add(String(prompt && prompt.category ? prompt.category : '默认'));
      });
      return Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }

    function filterPromptsForPicker(promptList, searchText, category) {
      const list = Array.isArray(promptList) ? promptList : [];
      const query = String(searchText || '').trim().toLowerCase();
      const categoryFilter = String(category || '').trim();

      return list.filter((prompt) => {
        const title = String(prompt && prompt.title ? prompt.title : '');
        const content = String(prompt && prompt.content ? prompt.content : '');
        const cat = String(prompt && prompt.category ? prompt.category : '默认');

        if (categoryFilter && categoryFilter !== '__all__' && cat !== categoryFilter) {
          return false;
        }

        if (!query) {
          return true;
        }

        return (
          title.toLowerCase().includes(query)
          || cat.toLowerCase().includes(query)
          || content.toLowerCase().includes(query)
        );
      });
    }

    function formatTaskListSourceText(task) {
      if (!task) return '来源：手动';
      if (task.sourceType === 'prompt-manager') {
        return '来源：Prompt 管理';
      }
      return '来源：手动';
    }

    function formatTaskListCategoryText(task) {
      if (!task) return '分类：默认';
      if (task.sourceType !== 'prompt-manager') {
        return '分类：默认';
      }
      if (task.promptId) {
        const result = findPromptForLinkedTask(task);
        const prompt = result.prompt;
        if (prompt) {
          const category = typeof PromptManagerModule.getPromptCategoryName === 'function'
            ? PromptManagerModule.getPromptCategoryName(prompt)
            : String(prompt.category || '默认');
          const relinkHint = result.relinked ? '（已重新关联）' : '';
          return `分类：${category}${relinkHint}`;
        }
        return '分类：原 Prompt 已删除，使用快照';
      }
      return '分类：默认';
    }

    function addPromptBatchTask(promptId) {
      if (
        typeof PromptManagerModule === 'undefined'
        || typeof PromptManagerModule.getPromptById !== 'function'
      ) {
        ToolboxShell.setStatus('Prompt 管理模块未就绪');
        return false;
      }

      const prompt = PromptManagerModule.getPromptById(promptId);

      if (!prompt) {
        ToolboxShell.appendLog(`[AUTOQ][PROMPT_TASK][MISSING] promptId=${promptId}`);
        ToolboxShell.setStatus('Prompt 不存在');
        return false;
      }

      readTaskEditorIntoSelected();
      normalizeTaskProfiles();

      const profile = getActiveTaskProfile();

      if (!profile) {
        return false;
      }

      if (isOnlyExampleTasks(profile.tasks)) {
        clearExampleTasksFromProfile(profile);
      }

      let task = findPromptTaskInProfile(profile, promptId);

      const isUpdate = !!task;

      if (task) {
        task.enabled = true;
        task.title = String(prompt.title || task.title || '未命名任务');
        task.initialPrompt = String(prompt.content || task.initialPrompt || '');
        task.sourceType = 'prompt-manager';
        task.promptId = String(prompt.id || promptId);
        task.updatedAt = nowMs();
      } else {
        task = createDefaultTaskItem({
          title: prompt.title,
          initialPrompt: prompt.content,
          promptId: prompt.id,
          sourceType: 'prompt-manager',
          continuePromptTemplate: '',
          doneSignal: '',
          maxContinueRounds: 0,
        });
        profile.tasks.push(task);
      }

      profile.updatedAt = nowMs();
      selectedTaskId = task.id;
      const logTag = isUpdate ? 'UPDATE' : 'ADD';
      ToolboxShell.appendLog(`[AUTOQ][PROMPT_TASK][${logTag}] promptId=${promptId} title=${prompt.title}`);
      saveConfig();
      renderTaskList();
      renderTaskEditor();
      renderTaskProfileDefaults();
      updateStatus();
      ToolboxShell.setStatus(`${isUpdate ? '已更新' : '已导入'}批量任务：${prompt.title}`);
      return true;
    }

    function removePromptBatchTask(promptId) {
      readTaskEditorIntoSelected();
      const profile = getActiveTaskProfile();

      if (!profile) {
        return false;
      }

      const task = findPromptTaskInProfile(profile, promptId);

      if (!task) {
        return false;
      }

      profile.tasks = profile.tasks.filter((item) => item.id !== task.id);
      profile.updatedAt = nowMs();

      if (selectedTaskId === task.id) {
        selectedTaskId = profile.tasks[0] ? profile.tasks[0].id : '';
      }

      ToolboxShell.appendLog(`[AUTOQ][PROMPT_TASK][REMOVE] promptId=${promptId}`);
      saveConfig();
      renderTaskList();
      renderTaskEditor();
      return true;
    }

    function renderAutoqPromptPickerCheckboxes(promptList, selectedIds) {
      const list = Array.isArray(promptList) ? promptList : [];
      const selected = new Set(
        Array.isArray(selectedIds)
          ? selectedIds.map((id) => String(id))
          : [],
      );

      if (!list.length) {
        return '<div class="cgpt-log-empty">暂无 Prompt，请先在 Prompt 管理中添加</div>';
      }

      return list.map((prompt) => {
        const id = String(prompt && prompt.id ? prompt.id : '');
        const title = String(prompt && prompt.title ? prompt.title : '未命名');
        const category = String(prompt && prompt.category ? prompt.category : '默认');
        const contentPreview = String(prompt && prompt.content ? prompt.content : '')
          .replace(/\s+/g, ' ')
          .slice(0, 80);
        const checked = selected.has(id) ? ' checked' : '';

        return `
      <label class="cgpt-setting-prompt-checkbox cgpt-autoq-prompt-picker-item">
        <input type="checkbox" data-autoq-prompt-pick-id="${escapeHtml(id)}"${checked}>
        <span class="cgpt-autoq-prompt-picker-item-title">${escapeHtml(title)}</span>
        <small class="cgpt-autoq-prompt-picker-item-meta">${escapeHtml(category)}${contentPreview ? ` · ${escapeHtml(contentPreview)}` : ''}</small>
      </label>
    `;
      }).join('');
    }

    function syncPromptPickerSelectionFromDom() {
      if (!promptPickerOverlay) {
        return;
      }

      const listHost = qs('#cgpt-autoq-prompt-picker-list', promptPickerOverlay);
      if (!listHost) {
        return;
      }

      qsa('input[data-autoq-prompt-pick-id]', listHost).forEach((el) => {
        const id = String(el.getAttribute('data-autoq-prompt-pick-id') || '');
        if (!id) {
          return;
        }
        if (el.checked) {
          promptPickerSelectedIds.add(id);
        } else {
          promptPickerSelectedIds.delete(id);
        }
      });
    }

    function refreshPromptPickerModalList() {
      if (
        typeof PromptManagerModule === 'undefined'
        || typeof PromptManagerModule.getPrompts !== 'function'
      ) {
        return;
      }

      const overlay = ensurePromptPickerOverlay();
      const listHost = qs('#cgpt-autoq-prompt-picker-list', overlay);
      const categoryEl = qs('#cgpt-autoq-prompt-picker-category', overlay);
      const searchEl = qs('#cgpt-autoq-prompt-picker-search', overlay);
      const promptList = PromptManagerModule.getPrompts();

      if (searchEl && document.activeElement !== searchEl) {
        searchEl.value = promptPickerFilterSearch;
      }
      if (categoryEl && document.activeElement !== categoryEl) {
        categoryEl.value = promptPickerFilterCategory || '__all__';
      }

      if (categoryEl) {
        const categories = getPromptPickerCategories(promptList);
        const current = promptPickerFilterCategory || '__all__';
        categoryEl.innerHTML = [
          '<option value="__all__">全部分类</option>',
          ...categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`),
        ].join('');
        categoryEl.value = categories.includes(current) || current === '__all__'
          ? current
          : '__all__';
        promptPickerFilterCategory = categoryEl.value;
      }

      const filtered = filterPromptsForPicker(
        promptList,
        promptPickerFilterSearch,
        promptPickerFilterCategory,
      );

      if (listHost) {
        listHost.innerHTML = renderAutoqPromptPickerCheckboxes(
          filtered,
          Array.from(promptPickerSelectedIds),
        );

        qsa('input[data-autoq-prompt-pick-id]', listHost).forEach((el) => {
          el.addEventListener('change', () => {
            syncPromptPickerSelectionFromDom();
          });
        });
      }
    }

    function clampPromptPickerModalPosition(left, top, modal) {
      return promptPickerPosition.clampPosition(left, top, modal);
    }

    function applyPromptPickerModalPosition(modal, left, top, reason = '') {
      return promptPickerPosition.applyPosition(modal, left, top, reason);
    }

    function restorePromptPickerModalPosition(modal, reason = '') {
      return promptPickerPosition.restorePosition(modal, reason);
    }

    function bindPromptPickerModalDrag(overlay) {
      bindDraggablePanel({
        overlay,
        modalSelector: '.cgpt-autoq-prompt-picker-modal',
        headerSelector: '.cgpt-modal-header',
        dragBoundDataset: 'promptPickerDragBound',
        position: promptPickerPosition,
        logPrefix: 'AUTOQ][PROMPT_PICKER_MODAL',
        consoleLabel: 'prompt picker',
        appendLog: (line) => {
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(line);
          }
        },
      });
    }

    function bindPromptPickerModalResize() {
      if (promptPickerResizeBound) {
        return;
      }

      promptPickerResizeBound = true;

      window.addEventListener('resize', () => {
        if (!promptPickerOverlay) {
          return;
        }

        const modal = promptPickerOverlay.querySelector('.cgpt-autoq-prompt-picker-modal');

        if (!modal || promptPickerOverlay.style.display === 'none' || promptPickerOverlay.hidden) {
          return;
        }

        const rect = modal.getBoundingClientRect();
        const pos = clampPromptPickerModalPosition(rect.left, rect.top, modal);
        applyPromptPickerModalPosition(modal, pos.left, pos.top, 'window-resize');
      }, { passive: true });
    }

    function cleanupPromptPickerOverlays(reason = '') {
      const overlays = Array.from(
        document.querySelectorAll('#cgpt-autoq-prompt-picker-overlay'),
      );

      if (!overlays.length) {
        return;
      }

      overlays.forEach((node, index) => {
        if (promptPickerOverlay && node === promptPickerOverlay) {
          return;
        }

        node.remove();

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[AUTOQ][PROMPT_PICKER_MODAL][CLEAN_DUPLICATE] reason=${reason || '-'} index=${index}`,
          );
        }
      });
    }

    function ensurePromptPickerOverlay() {
      cleanupPromptPickerOverlays('before-ensure');

      if (promptPickerOverlay && document.documentElement.contains(promptPickerOverlay)) {
        return promptPickerOverlay;
      }

      promptPickerOverlay = null;

      promptPickerOverlay = document.createElement('div');
      promptPickerOverlay.id = 'cgpt-autoq-prompt-picker-overlay';
      promptPickerOverlay.className = 'cgpt-modal-overlay';
      promptPickerOverlay.style.display = 'none';
      promptPickerOverlay.innerHTML = `
        <div class="cgpt-modal cgpt-autoq-prompt-picker-modal">
          <div class="cgpt-modal-header">
            <div class="cgpt-modal-title">从 Prompt 管理导入 Prompt</div>
            <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-close">关闭</button>
          </div>
          <div class="cgpt-modal-body">
            <div class="cgpt-hint">勾选 Prompt 后点击「导入到当前任务组」，每个 Prompt 会生成一个任务组内的任务。已存在的 Prompt 任务会更新标题和内容快照，不会重复创建。</div>
            <div class="cgpt-autoq-prompt-picker-toolbar">
              <input class="cgpt-input" id="cgpt-autoq-prompt-picker-search" type="search" placeholder="搜索标题、分类、内容…">
              <select class="cgpt-input" id="cgpt-autoq-prompt-picker-category">
                <option value="__all__">全部分类</option>
              </select>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-select-visible">全选当前显示</button>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-clear-visible">取消全选当前显示</button>
            </div>
            <div class="cgpt-autoq-prompt-picker-list" id="cgpt-autoq-prompt-picker-list"></div>
          </div>
          <div class="cgpt-modal-footer cgpt-row">
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-prompt-picker-apply">导入到当前任务组</button>
          </div>
        </div>`;

      const closeBtn = qs('#cgpt-autoq-prompt-picker-close', promptPickerOverlay);
      const applyBtn = qs('#cgpt-autoq-prompt-picker-apply', promptPickerOverlay);

      if (closeBtn) {
        bindOnce(closeBtn, 'click', () => {
          promptPickerOverlay.style.display = 'none';
        });
      }

      const searchEl = qs('#cgpt-autoq-prompt-picker-search', promptPickerOverlay);
      const categoryEl = qs('#cgpt-autoq-prompt-picker-category', promptPickerOverlay);
      const selectVisibleBtn = qs('#cgpt-autoq-prompt-picker-select-visible', promptPickerOverlay);
      const clearVisibleBtn = qs('#cgpt-autoq-prompt-picker-clear-visible', promptPickerOverlay);

      if (searchEl) {
        bindOnce(searchEl, 'input', () => {
          promptPickerFilterSearch = String(searchEl.value || '');
          syncPromptPickerSelectionFromDom();
          refreshPromptPickerModalList();
        });
      }

      if (categoryEl) {
        bindOnce(categoryEl, 'change', () => {
          promptPickerFilterCategory = String(categoryEl.value || '__all__');
          syncPromptPickerSelectionFromDom();
          refreshPromptPickerModalList();
        });
      }

      if (selectVisibleBtn) {
        bindOnce(selectVisibleBtn, 'click', () => {
          const listHost = qs('#cgpt-autoq-prompt-picker-list', promptPickerOverlay);
          if (!listHost) {
            return;
          }
          qsa('input[data-autoq-prompt-pick-id]', listHost).forEach((el) => {
            const id = String(el.getAttribute('data-autoq-prompt-pick-id') || '');
            if (!id) {
              return;
            }
            el.checked = true;
            promptPickerSelectedIds.add(id);
          });
        });
      }

      if (clearVisibleBtn) {
        bindOnce(clearVisibleBtn, 'click', () => {
          const listHost = qs('#cgpt-autoq-prompt-picker-list', promptPickerOverlay);
          if (!listHost) {
            return;
          }
          qsa('input[data-autoq-prompt-pick-id]', listHost).forEach((el) => {
            const id = String(el.getAttribute('data-autoq-prompt-pick-id') || '');
            if (!id) {
              return;
            }
            el.checked = false;
            promptPickerSelectedIds.delete(id);
          });
        });
      }

      if (applyBtn) {
        bindOnce(applyBtn, 'click', () => {
          const listHost = qs('#cgpt-autoq-prompt-picker-list', promptPickerOverlay);

          if (!listHost) {
            return;
          }

          syncPromptPickerSelectionFromDom();

          const selectedIds = Array.from(promptPickerSelectedIds);
          let importCount = 0;

          selectedIds.forEach((promptId) => {
            if (addPromptBatchTask(promptId)) {
              importCount += 1;
            }
          });

          promptPickerOverlay.style.display = 'none';
          ToolboxShell.setStatus(`已导入 ${importCount} 个 Prompt 到当前任务组`);
        });
      }

      promptPickerOverlay.addEventListener('click', (event) => {
        if (event.target === promptPickerOverlay) {
          promptPickerOverlay.style.display = 'none';
        }
      });

      document.body.appendChild(promptPickerOverlay);

      bindPromptPickerModalDrag(promptPickerOverlay);
      bindPromptPickerModalResize();

      requestAnimationFrame(() => {
        const modal = promptPickerOverlay.querySelector('.cgpt-autoq-prompt-picker-modal');
        restorePromptPickerModalPosition(modal, 'create-prompt-picker-overlay');
      });

      return promptPickerOverlay;
    }

    function openPromptPickerModal(event) {
      if (event && typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      cleanupPromptPickerOverlays('before-open');

      if (
        typeof PromptManagerModule === 'undefined'
        || typeof PromptManagerModule.getPrompts !== 'function'
      ) {
        ToolboxShell.setStatus('Prompt 管理模块未就绪');
        return;
      }

      const overlay = ensurePromptPickerOverlay();
      const promptList = PromptManagerModule.getPrompts();

      promptPickerSelectedIds = new Set(
        promptList
          .filter((item) => isPromptBatchTaskSelected(item.id))
          .map((item) => String(item.id)),
      );
      promptPickerFilterSearch = '';
      promptPickerFilterCategory = '__all__';

      const searchEl = qs('#cgpt-autoq-prompt-picker-search', overlay);
      if (searchEl) {
        searchEl.value = '';
      }

      refreshPromptPickerModalList();
      overlay.style.display = 'flex';

      requestAnimationFrame(() => {
        const modal = overlay.querySelector('.cgpt-autoq-prompt-picker-modal');
        restorePromptPickerModalPosition(modal, 'open-prompt-picker-modal');
      });
    }

    function clearExampleTasksInline() {
      readTaskEditorIntoSelected();
      const profile = getActiveTaskProfile();

      if (!profile) {
        ToolboxShell.setStatus('当前没有任务组');
        return;
      }

      if (clearExampleTasksFromProfile(profile)) {
        selectedTaskId = profile.tasks[0] ? profile.tasks[0].id : '';
        profile.updatedAt = nowMs();
        saveConfig();
        renderTaskList();
        renderTaskEditor();
        ToolboxShell.setStatus('已清空示例任务');
        return;
      }

      ToolboxShell.setStatus('当前没有示例任务');
    }

    function saveConfig() {
      try {
        normalizeListProfiles();
        normalizeTaskProfiles();
        config.modeSettings = ensureModeSettings(config);

        const active = getActiveListProfile();

        if (active) {
          config.listPromptsText = active.text;
        }

        MemoryManager.set(
          MemoryManager.KEYS.autoQueueConfig,
          clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][saveConfig]'),
        );
      } catch (error) {
        const errText = getErrorText(error);
        console.error('[AUTOQ][saveConfig]', error);
        ToolboxShell.appendLog(`[AUTOQ][saveConfig] error=${errText}`);
        throw error;
      }
    }

    const debouncedSaveConfig = debounceSave(saveConfig, 300);

    function applyConfig(next) {
      const incoming = next && typeof next === 'object'
        ? clonePlainObject(next, {}, '[AUTOQ][applyConfig]')
        : {};

      Object.keys(config).forEach((key) => {
        delete config[key];
      });

      Object.assign(config, createDefaultAutoConfig(), incoming);

      if (!config.modeSettings || typeof config.modeSettings !== 'object') {
        config.modeSettings = createDefaultModeSettings();
      } else {
        config.modeSettings = clonePlainObject(
          config.modeSettings,
          createDefaultModeSettings(),
          '[AUTOQ][modeSettings]',
        );
      }

      normalizeAutoConfig(config);
      normalizeListProfiles();
      normalizeTaskProfiles();

      if (!root) return;

      applyModeSettingsToUi(config.promptMode);
      refreshPromptTextareaForMode(config.promptMode);
      updateModeTabs();
      renderListPanelVisibility();
      renderTaskPanelVisibility();
      renderListProfiles();
      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      renderTaskProfileDefaults();
      updateStatus();

      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onSettingsChanged === 'function') {
        RuntimeStatsModule.onSettingsChanged();
      }
    }

    function getActiveListProfileName() {
      const active = getActiveListProfile();
      return active ? String(active.name || '') : '';
    }

    function updateModeTabs() {
      if (!root) return;

      qsa('.cgpt-autoq-mode-tab', root).forEach((btn) => {
        const mode = btn.getAttribute('data-autoq-mode');
        btn.classList.toggle('active', mode === config.promptMode);
      });
    }

    function renderListPanelVisibility() {
      if (!listPanelEl) return;
      listPanelEl.classList.toggle('cgpt-toolbox-hidden', config.promptMode !== 'list');
    }

    function getAutoQueueModeLabel(mode) {
      const m = normalizeAutoMode(mode);

      if (m === 'list') return '列表模式';
      if (m === 'task') return '批量任务';
      return '继续模式';
    }

    function getModeDisplayText(mode) {
      return getAutoQueueModeLabel(mode);
    }

    function getCurrentTaskRunInfo() {
      const profile = getActiveTaskProfile();
      const enabled = getEnabledTasksFromProfile(profile);
      const total = enabled.length;
      const run = state.taskRun || {};
      const currentId = run.enabledTaskIds && run.currentIndex >= 0
        ? run.enabledTaskIds[run.currentIndex]
        : '';
      const currentTask = profile && currentId
        ? profile.tasks.find((item) => item.id === currentId)
        : null;
      const doneCount = enabled.filter((item) => item.status === 'completed').length;
      const progressIndex = currentTask
        ? enabled.findIndex((item) => item.id === currentTask.id) + 1
        : (state.running ? doneCount + 1 : doneCount);

      return {
        profile,
        enabled,
        total,
        currentTask,
        progressIndex: Math.max(0, progressIndex),
        doneCount,
      };
    }

    function resetTaskRunState() {
      state.taskRun = {
        enabledTaskIds: [],
        currentIndex: -1,
        pendingSendKind: null,
        pendingReplyKind: null,
        doneSignalVerificationRunning: false,
        currentStep: 'idle',

        // 当前批量任务组本次运行中，实际成功发送到 ChatGPT 的总对话次数。
        totalSentDialogueCount: 0,

        // 自动上传节奏计数。这个值用于“每 N 次对话自动上传”，不要当作总发送次数展示。
        sentMessageCount: 0,

        lastAutoUploadAtMessageCount: 0,

        sentInCurrentChatCount: 0,
        lastNewChatRotationAtTotalSentDialogueCount: 0,
        lastNewChatRotationAt: 0,
        newChatRotationCount: 0,
        forceUploadBeforeNextSend: false,
        lastRotatedConversationKey: '',
      };
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

    function isTaskDoneSignalMatched(replyText, doneSignal) {
      const signal = String(doneSignal || TASK_DONE_SIGNAL).trim();

      if (typeof analyzeAssistantDoneSignalText === 'function') {
        const analysis = analyzeAssistantDoneSignalText(replyText, { doneSignal: signal });
        if (analysis.corrupted) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SIGNAL][CORRUPTED_ASSISTANT_SIGNAL] length=${String(replyText || '').length}`,
          );
        }
        return {
          matched: !!analysis.matched,
          corrupted: !!analysis.corrupted,
        };
      }

      if (typeof analyzeDoneSignalText === 'function') {
        const result = analyzeDoneSignalText(replyText, { doneSignal: signal });
        if (result.corrupted) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SIGNAL][CORRUPTED_ASSISTANT_SIGNAL] length=${String(replyText || '').length}`,
          );
        }
        return {
          matched: !!result.matched,
          corrupted: !!result.corrupted,
        };
      }

      const checked = String(replyText || '').replace(/\r\n/g, '\n').trim();
      const lines = checked
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      return {
        matched: lines.length === 1 && lines[0] === signal,
        corrupted: false,
      };
    }

    function recordReplyClassifyDecision(decision) {
      if (!state.taskRun || !decision) {
        return;
      }
      state.taskRun.lastReplyClassifyStatus = String(decision.status || '-');
      state.taskRun.lastReplyClassifyReason = String(decision.reason || '-');
      state.taskRun.lastReplyClassifyShouldStop = decision.shouldStop ? 1 : 0;
    }

    function tryStopBatchOnReplyClassify(replyText, task) {
      if (typeof classifyBatchReply !== 'function') {
        return false;
      }

      const decision = classifyBatchReply(replyText);
      recordReplyClassifyDecision(decision);

      ToolboxShell.appendLog(
        `[BATCH][REPLY_CLASSIFY] shouldStop=${decision.shouldStop ? 1 : 0} `
        + `status=${decision.status} reason=${decision.reason}`,
      );

      if (!decision.shouldStop) {
        return false;
      }

      if (decision.status === 'done') {
        return false;
      }

      const stopReason = decision.status === 'no_more_content'
        ? 'reply-classify-no-more-content'
        : 'reply-classify-blocked';

      ToolboxShell.appendLog(
        `[BATCH][STOP] status=${decision.status} reason=${decision.reason} stopReason=${stopReason}`,
      );

      markTaskStatus(task, 'stopped');
      setTaskBatchStep('stopped', task, { log: false });
      recordTaskBatchStopReason(stopReason, {
        sendReason: decision.reason,
        replyClassifyStatus: decision.status,
      });
      stop({
        reason: stopReason,
        markCurrent: false,
        finalStep: 'stopped',
        sendReason: decision.reason,
      });
      updateStatus('reply-classify-stop');
      return true;
    }

    function tryStopBatchOnCopyHotkeyTerminalResult(result, task) {
      if (!result || result.assistantBatchTerminalStop !== true) {
        return false;
      }

      const status = String(result.batchReplyClassifyStatus || 'blocked');
      const classifyReason = String(result.batchReplyClassifyReason || result.reason || '-');
      recordReplyClassifyDecision({
        shouldStop: true,
        status,
        reason: classifyReason,
      });

      const stopReason = status === 'no_more_content'
        ? 'reply-classify-no-more-content'
        : 'reply-classify-blocked';

      ToolboxShell.appendLog(
        `[BATCH][STOP] status=${status} reason=${classifyReason} stopReason=${stopReason} source=copy-hotkey`,
      );

      markTaskStatus(task, 'stopped');
      setTaskBatchStep('stopped', task, { log: false });
      recordTaskBatchStopReason(stopReason, {
        sendReason: classifyReason,
        replyClassifyStatus: status,
      });
      stop({
        reason: stopReason,
        markCurrent: false,
        finalStep: 'stopped',
        sendReason: classifyReason,
      });
      updateStatus('copy-hotkey-terminal-stop');
      return true;
    }

    function tryStopNonTaskAutoQueueOnTerminalReply(replyText, source = 'reply-settled') {
      const mode = normalizeAutoMode(config.promptMode);

      if (mode === 'task') {
        return false;
      }

      const text = String(replyText || '').trim();
      if (!text) {
        return false;
      }

      if (state.continueUntilDoneStrict === true) {
        const doneCheck = isTaskDoneSignalMatched(text, TASK_DONE_SIGNAL);

        ToolboxShell.appendLog(
          `[AUTOQ][UNTIL_DONE_TERMINAL_CHECK] matched=${doneCheck && doneCheck.matched ? 1 : 0} source=${source || '-'}`,
        );

        if (!doneCheck || !doneCheck.matched) {
          return false;
        }

        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = 0;
        state.continueUntilDoneStrict = false;

        stop({
          reason: 'all-done',
          finalStep: 'all-done',
          markCurrent: false,
          logStop: false,
          sendReason: 'strict-done-signal',
        });

        ToolboxShell.setStatus('自动继续直到完成：检测到完成信号，已停止', 'success');
        updateStatus('until-done-terminal-stop');
        updateChatInputStateBadge();
        return true;
      }

      let decision = null;
      if (typeof classifyBatchReply === 'function') {
        decision = classifyBatchReply(text);
      }

      if (!decision || typeof decision !== 'object') {
        const doneCheck = isTaskDoneSignalMatched(text, TASK_DONE_SIGNAL);
        decision = {
          shouldStop: !!doneCheck.matched,
          status: doneCheck.matched ? 'done' : 'continue',
          reason: doneCheck.matched ? 'done-signal-detected' : 'no-terminal-state-detected',
        };
      }

      ToolboxShell.appendLog(
        `[AUTOQ][CONTINUE_TERMINAL_CHECK] mode=${mode} shouldStop=${decision.shouldStop ? 1 : 0} `
        + `status=${decision.status || '-'} reason=${decision.reason || '-'} source=${source || '-'}`,
      );

      if (!decision.shouldStop) {
        return false;
      }

      const status = String(decision.status || 'blocked');
      const classifyReason = String(decision.reason || '-');
      const stopReason = status === 'done'
        ? 'all-done'
        : (status === 'no_more_content' ? 'reply-classify-no-more-content' : 'reply-classify-blocked');
      const finalStep = stopReason === 'all-done' ? 'all-done' : 'stopped';
      const statusText = status === 'done'
        ? '自动继续已完成'
        : (status === 'no_more_content' ? '自动继续已停止：没有可继续输出内容' : '自动继续已停止：需要人工处理');

      recordReplyClassifyDecision({
        shouldStop: true,
        status,
        reason: classifyReason,
      });
      ToolboxShell.appendLog(
        `[AUTOQ][CONTINUE_TERMINAL_STOP] mode=${mode} status=${status} reason=${classifyReason} stopReason=${stopReason}`,
      );

      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;

      stop({
        reason: stopReason,
        finalStep,
        markCurrent: false,
        logStop: false,
        sendReason: classifyReason,
      });
      ToolboxShell.setStatus(statusText, stopReason === 'all-done' ? 'success' : 'warning');
      updateStatus('continue-terminal-stop');
      updateChatInputStateBadge();
      return true;
    }

    function getCurrentRunningTask() {
      const run = state.taskRun || {};
      const profile = getActiveTaskProfile();

      if (!profile || !Array.isArray(run.enabledTaskIds) || run.currentIndex < 0) {
        return null;
      }

      const taskId = run.enabledTaskIds[run.currentIndex];

      return profile.tasks.find((item) => item.id === taskId) || null;
    }

    function getTaskById(taskId) {
      const profile = getActiveTaskProfile();
      if (!profile || !Array.isArray(profile.tasks) || !taskId) {
        return null;
      }
      return profile.tasks.find((item) => item && item.id === taskId) || null;
    }

    function getCurrentConversationKey() {
      if (typeof getCurrentConversationKeyUnified === 'function') {
        return getCurrentConversationKeyUnified();
      }
      return '';
    }

    async function clickChatGPTNewChatInPage(reason) {
      const reasonText = reason || 'autoq-next-task';

      if (typeof switchToNewChatUnified === 'function') {
        return switchToNewChatUnified(reasonText, {
          statusOnReady: '新聊天已就绪，准备发送下一个任务',
          statusOnTimeout: '切换新聊天超时，已停止批量任务组',
        });
      }

      return {
        ok: false,
        reason: 'new-chat-switch-unified-unavailable',
      };
    }

    function handleMoveToNextTaskError(err) {
      const errText = err && err.message ? err.message : String(err);
      console.error('[ChatGPT toolbox] moveToNextTask failed', err);
      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][MOVE_NEXT_FAILED] error=${errText}`);
      ToolboxShell.setStatus(`批量任务组已停止：${errText}`);
      stop({
        reason: errText || 'move-next-task-failed',
        finalStep: 'stopped',
        markCurrent: false,
        logStop: false,
      });
    }

    function markTaskStatus(task, status) {
      if (!task) return;

      task.status = String(status || 'pending');
      task.updatedAt = nowMs();
      saveConfig();
      renderTaskList();
      renderTaskEditor();
      updateStatus();
    }

    function prepareTaskQueue() {
      readPanelConfig(config.promptMode);

      const profile = getActiveTaskProfile();
      const enabled = getEnabledTasksFromProfile(profile);

      if (!enabled.length) {
        log('没有已启用的任务，无法开始');
        ToolboxShell.appendLog('[AUTOQ][TASK][FAILED] reason=no-enabled-tasks');
        return false;
      }

      enabled.forEach((task) => {
        task.status = 'pending';
        task.continueCount = 0;
        task.updatedAt = nowMs();

        if (task.sourceType === 'prompt-manager' && task.promptId) {
          const resolved = resolveTaskInitialPrompt(task, { log: true });

          if (!String(resolved.initialPrompt || '').trim()) {
            task.status = 'failed';
          } else if (resolved.title) {
            task.title = resolved.title;
          }
        }
      });

      const runnable = enabled.filter((task) => task.status !== 'failed');

      if (!runnable.length) {
        log('没有可运行的任务（Prompt 缺失或内容为空）');
        ToolboxShell.appendLog('[AUTOQ][TASK][FAILED] reason=no-runnable-tasks');
        saveConfig();
        renderTaskList();
        return false;
      }

      state.taskRun = {
        enabledTaskIds: runnable.map((item) => item.id),
        currentIndex: 0,
        pendingSendKind: 'initial',
        pendingReplyKind: null,
        doneSignalVerificationRunning: false,
        currentStep: 'send-initial',

        // 当前批量任务组本次运行中，实际成功发送到 ChatGPT 的总对话次数。
        totalSentDialogueCount: 0,

        // 自动上传节奏计数。
        sentMessageCount: 0,

        lastAutoUploadAtMessageCount: 0,

        sentInCurrentChatCount: 0,
        lastNewChatRotationAtTotalSentDialogueCount: 0,
        lastNewChatRotationAt: 0,
        newChatRotationCount: 0,
        forceUploadBeforeNextSend: false,
        lastRotatedConversationKey: '',
      };
      state.queue = [];
      state.idx = 0;
      state.sentCount = 0;
      state.completedLoops = 0;
      state.nextSendAt = 0;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.sendingNow = false;

      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][START] total=${runnable.length} profile=${profile ? profile.name : '-'}`);
      ToolboxShell.appendLog(`[AUTOQ][TASK][START] profile=${profile ? profile.name : '-'} tasks=${runnable.length}`);
      log(`批量任务组任务开始，共 ${runnable.length} 个任务`);
      setTaskBatchStep('send-initial', runnable[0] || null);

      return true;
    }

    async function moveToNextTask() {
      const run = state.taskRun || {};
      const nextIndex = Number(run.currentIndex) + 1;

      if (!Array.isArray(run.enabledTaskIds) || nextIndex >= run.enabledTaskIds.length) {
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][ALL_DONE]');
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][STEP] task=- step=all-done');
        ToolboxShell.appendLog('[AUTOQ][TASK][ALL_DONE]');
        log('全部任务完成');
        stop({
          reason: 'all-done',
          finalStep: 'all-done',
          markCurrent: false,
          logStop: false,
        });
        return false;
      }

      const currentTask = getCurrentRunningTask();
      const nextTaskId = run.enabledTaskIds[nextIndex];
      const nextTask = getTaskById(nextTaskId);

      const shouldSwitchNewChat = !(
        config.taskQueueSettings
        && config.taskQueueSettings.switchNewChatBetweenTasks === false
      );

      if (shouldSwitchNewChat) {
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][NEXT_TASK_PENDING]');
        setTaskBatchStep('new-chat-switch', currentTask || nextTask);

        state.taskBatchStepRunning = true;
        try {
          const switchReason = `task-${currentTask ? currentTask.id : 'unknown'}-to-${nextTask ? nextTask.id : 'unknown'}`;
          const switchResult = await clickChatGPTNewChatInPage(switchReason);

          if (!switchResult || switchResult.ok !== true) {
            const failReason = switchResult && switchResult.reason
              ? switchResult.reason
              : 'unknown';
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_BATCH][NEW_CHAT_FAILED_CONTINUE_CURRENT] reason=${failReason}`,
            );
            ToolboxShell.setStatus('切换新聊天失败，继续在当前对话发送下一个任务');
          } else {
            setTaskBatchStep('new-chat-ready', nextTask, { log: false });
          }

          if (typeof updateChatInputStateBadge === 'function') {
            updateChatInputStateBadge();
          }
          updateStatus('new-chat-ready');
        } finally {
          state.taskBatchStepRunning = false;
        }
      }

      run.currentIndex = nextIndex;
      run.pendingSendKind = 'initial';
      run.pendingReplyKind = null;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;

      const activeNextTask = getCurrentRunningTask();
      setTaskBatchStep('send-initial', activeNextTask);
      state.nextSendAt = Date.now() + getRandomDelayMs();
      ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][NEXT_TASK_START]');
      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][NEXT_TASK] index=${nextIndex + 1} total=${run.enabledTaskIds.length}`);
      ToolboxShell.appendLog(`[AUTOQ][TASK][NEXT] index=${nextIndex + 1}/${run.enabledTaskIds.length}`);
      log(`进入下一个任务 (${nextIndex + 1}/${run.enabledTaskIds.length})`);
      renderTaskList();
      updateStatus('next-task');
      return true;
    }

    function shouldStopBatchOnTaskSendFailure() {
      return !!(config.taskQueueSettings && config.taskQueueSettings.stopBatchOnTaskSendFailure === true);
    }

    function recordTaskBatchStopReason(reason, extra = {}) {
      const task = getCurrentRunningTask();
      const run = state.taskRun || {};

      const payload = {
        reason: String(reason || 'unknown'),
        at: Date.now(),
        taskTitle: task ? String(task.title || '-') : '-',
        taskId: task ? String(task.id || '-') : '-',
        step: String(run.currentStep || '-'),
        pendingSendKind: String(run.pendingSendKind || '-'),
        sendReason: String(extra.sendReason || '-'),
        runningBefore: state.running ? 1 : 0,
      };

      state.lastTaskBatchStopReason = payload;

      ToolboxShell.appendLog(
        `[AUTOQ][STOP_REASON] reason=${payload.reason} task=${payload.taskTitle} `
        + `taskId=${payload.taskId} step=${payload.step} pendingSendKind=${payload.pendingSendKind} `
        + `sendReason=${payload.sendReason} runningBefore=${payload.runningBefore}`,
      );
    }

    function normalizeSendFailureReason(reason) {
      if (typeof sendPipelineNormalizeFailureReason === 'function') {
        return sendPipelineNormalizeFailureReason(reason);
      }
      const raw = String(reason || '').trim();
      if (!raw) {
        return { raw: '', normalized: '' };
      }
      if (raw.startsWith('send_not_confirmed:')) {
        const sub = raw.slice('send_not_confirmed:'.length).trim();
        return { raw, normalized: sub || 'send_not_confirmed' };
      }
      if (raw === 'voice_button') {
        return { raw, normalized: 'voice_button_only' };
      }
      return { raw, normalized: raw };
    }

    function isRetryableSendFailureReason(reason) {
      const { raw, normalized } = normalizeSendFailureReason(reason);
      let retryable = false;

      if (typeof sendPipelineIsRetryableReason === 'function') {
        retryable = sendPipelineIsRetryableReason(normalized) || sendPipelineIsRetryableReason(raw);
      } else {
        console.error('[ChatGPT toolbox] isRetryableSendFailureReason: sendPipelineIsRetryableReason missing');
      }

      ToolboxShell.appendLog(
        `[AUTOQ][RETRYABLE_REASON_CHECK] rawReason=${raw || '-'} normalizedReason=${normalized || '-'} retryable=${retryable ? 1 : 0}`,
      );

      return retryable;
    }

    function logSendFailureClassified(phase, task, reason, sendResult) {
      const retryable = isRetryableSendFailureReason(reason)
        || (sendResult && sendResult.retryable === true)
        || (sendResult && sendResult.wait === true);
      let action = 'stop';

      if (retryable) {
        if (phase === 'send-once') {
          action = 'retry';
        } else {
          action = scheduleRelentlessSendRetry(reason, phase, task) ? 'retry' : 'retry-schedule-failed';
        }
      } else if (shouldStopBatchOnTaskSendFailure()) {
        action = 'stop';
      } else {
        action = 'skip-next';
      }

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][SEND_FAILURE_CLASSIFIED] phase=${phase} task=${task ? task.title : '-'} `
        + `reason=${reason || '-'} retryable=${retryable ? 1 : 0} action=${action}`,
      );

      return { retryable, action };
    }

    function scheduleRelentlessSendRetry(reason, phase = 'initial', task = null) {
      const settings = config.taskQueueSettings || {};
      const enabled = settings.taskRelentlessSendRetryEnabled !== false;

      if (!enabled) {
        return false;
      }

      const run = state.taskRun || {};
      const retryCount = Math.max(0, Number(run.sendRetryCount) || 0) + 1;
      run.sendRetryCount = retryCount;

      const baseMs = Math.max(300, Number(settings.taskRelentlessSendRetryIntervalMs) || 1500);
      const maxMs = Math.max(baseMs, Number(settings.taskRelentlessSendRetryMaxIntervalMs) || 10000);

      let delayMs = baseMs;

      if (settings.taskRelentlessSendRetryBackoffEnabled !== false) {
        delayMs = Math.min(maxMs, baseMs * Math.max(1, Math.ceil(retryCount / 5)));
      }

      run.pendingSendKind = phase === 'verification'
        ? 'verification'
        : (phase === 'continue' ? 'continue' : 'initial');
      run.lastSendRetryReason = String(reason || 'unknown');
      run.lastSendRetryAt = Date.now();
      run.nextSendRetryAt = Date.now() + delayMs;

      state.taskRun = run;
      state.nextSendAt = run.nextSendRetryAt;

      setTaskBatchStep('send-wait-retry', task || getCurrentRunningTask(), { log: false });

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][SEND_WAIT_RETRY] phase=${phase} reason=${reason} retryCount=${retryCount} delayMs=${delayMs} task=${task ? task.title : '-'}`,
      );

      ToolboxShell.setStatus(`发送暂不可用，继续重试：${reason}`);

      updateStatus('send-wait-retry');

      return true;
    }

    function clearRelentlessSendRetryState() {
      const run = state.taskRun || {};
      run.sendRetryCount = 0;
      run.lastSendRetryReason = '';
      run.lastSendRetryAt = 0;
      run.nextSendRetryAt = 0;
      state.taskRun = run;
    }

    async function sendCurrentTaskContinuePrompt() {
      const task = getCurrentRunningTask();
      const run = state.taskRun || {};

      if (!task || !state.running) {
        return false;
      }

      if (run.pendingSendKind === 'verification' && run.doneSignalVerificationRunning) {
        const profile = getActiveTaskProfile();
        const resolved = resolveTaskContinueSettings(task, profile, { log: false });
        const replyText = String(run.verifyReplyTextForResend || '');
        const verifyPrompt = buildVerifyAfterDoneSignalPrompt(task, resolved, replyText);

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][SEND_RETRY_FIRE] pendingSendKind=verification task=${task.title}`,
        );

        const sendResult = await sendTaskPrompt(
          verifyPrompt,
          '[AUTOQ][TASK_BATCH][VERIFY_SEND_PROMPT_RETRY]',
          'verification',
        );

        if (sendResult && sendResult.ok === true) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_RETRY_SUCCESS] phase=verification task=${task.title}`,
          );
          clearRelentlessSendRetryState();
          return true;
        }

        const reason = String((sendResult && sendResult.reason) || 'unknown');
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][SEND_RETRY_STILL_FAILED] phase=verification task=${task.title} reason=${reason}`,
        );
        return false;
      }

      if (run.pendingSendKind === 'continue') {
        void handleTaskReplyReady();
        return true;
      }

      maybeSendNextTask();
      return true;
    }

    function maybeResumeRelentlessSendRetry() {
      const run = state.taskRun || {};

      if (!state.running) {
        return false;
      }

      const step = String(run.currentStep || '');
      if (step !== 'send-wait-retry' && step !== 'send-initial-wait-retry') {
        return false;
      }

      const nextAt = Number(run.nextSendRetryAt) || 0;

      if (nextAt > 0 && Date.now() < nextAt) {
        return true;
      }

      if (state.sendingNow || state.taskBatchStepRunning) {
        return true;
      }

      const oldStep = step;
      const pendingSendKind = run.pendingSendKind || 'initial';
      const reason = run.lastSendRetryReason || '-';
      const retryCount = run.sendRetryCount || 0;
      const newStep = 'send-initial';

      run.currentStep = newStep;
      state.taskRun = run;
      state.nextSendAt = 0;

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][SEND_RETRY_RESUME] pendingSendKind=${pendingSendKind} oldStep=${oldStep} `
        + `newStep=${newStep} reason=${reason} retryCount=${retryCount} nextSendRetryAt=${nextAt} now=${Date.now()}`,
      );

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][SEND_RETRY_FIRE] pendingSendKind=${pendingSendKind} `
        + `reason=${reason} retryCount=${retryCount}`,
      );

      if (pendingSendKind === 'continue' || pendingSendKind === 'verification') {
        void sendCurrentTaskContinuePrompt();
      } else {
        maybeSendNextTask();
      }

      return true;
    }

    function handleTaskInitialSendFailure(reason) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');
      const taskName = task ? task.title : '-';
      const taskId = task ? task.id : '-';

      const classified = logSendFailureClassified('initial', task, reasonText);
      if (state.running && classified.action === 'retry') {
        return;
      }

      if (task) {
        markTaskStatus(task, 'failed');
      }

      const run = state.taskRun || {};
      run.pendingSendKind = 'initial';
      setTaskBatchStep('send-initial-failed', task, { log: false });

      ToolboxShell.appendLog(
        `[AUTOQ][SEND_GIVE_UP] task=${taskName} taskId=${taskId} reason=${reasonText}`,
      );
      ToolboxShell.appendLog(`[AUTOQ][TASK][FAILED] task=${taskName} reason=${reasonText}`);
      log(`任务发送失败：${taskName} (${reasonText})`);
      notifyRuntimeTaskSendFail(task, reasonText);

      if (shouldStopBatchOnTaskSendFailure()) {
        ToolboxShell.setStatus(`批量任务组已停止：${reasonText}`);
        stop({
          reason: reasonText,
          sendReason: reasonText,
          finalStep: 'stopped',
          markCurrent: false,
          logStop: false,
        });
        return;
      }

      ToolboxShell.setStatus(`任务发送失败，继续下一个：${reasonText}`);
      void moveToNextTask().then((moved) => {
        if (!moved) {
          ToolboxShell.setStatus('批量任务组：无可继续的任务');
        }
      }).catch(handleMoveToNextTaskError);
    }

    function failCurrentTask(reason) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');

      const failPhase = state.taskRun && state.taskRun.pendingSendKind === 'verification'
        ? 'verification'
        : (state.taskRun && state.taskRun.pendingSendKind === 'continue' ? 'continue' : 'initial');
      const classified = logSendFailureClassified(failPhase, task, reasonText);
      if (state.running && classified.action === 'retry') {
        return;
      }

      if (task) {
        if (reasonText === 'cancelled' || reasonText === 'stopped') {
          markTaskStatus(task, 'stopped');
          setTaskBatchStep('stopped', task, { log: false });
        } else {
          markTaskStatus(task, reasonText === 'timeout' ? 'timeout' : 'failed');
        }
      }

      if (reasonText === 'upload-module-missing') {
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][FAILED] reason=upload-module-missing');
      }

      ToolboxShell.appendLog(`[AUTOQ][TASK][FAILED] task=${task ? task.title : '-'} reason=${reasonText}`);
      log(`任务失败：${task ? task.title : '-'} (${reasonText})`);
      ToolboxShell.setStatus(`批量任务组已停止：${reasonText}`);
      stop({
        reason: reasonText,
        sendReason: reasonText,
        finalStep: 'stopped',
        markCurrent: false,
        logStop: false,
      });
    }

    function getDefaultVerifyAfterDoneSignalPrompt() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {};
      return String(defaults.verifyAfterDoneSignalPrompt || '').trim() || [
        '请根据我刚才上传的代码文件和当前任务要求，检查任务是否已经完整完成。',
        '',
        '当前任务标题：{{taskTitle}}',
        '当前任务内容：',
        '{{taskContent}}',
        '',
        '如果确实完成，只回复：{{doneSignal}}',
        '如果没有完成，请继续输出剩余内容，不要回复终止信号。',
      ].join('\n');
    }

    function buildVerifyAfterDoneSignalPrompt(task, resolved, replyText) {
      const settings = config.taskQueueSettings || {};
      const doneSignal = resolved && resolved.actualDoneSignal
        ? resolved.actualDoneSignal
        : TASK_DONE_SIGNAL;
      const taskContent = String(
        task.content || task.prompt || task.initialPrompt || '',
      );
      const template = String(
        settings.verifyAfterDoneSignalPrompt || getDefaultVerifyAfterDoneSignalPrompt(),
      );

      return template
        .replace(/\{\{taskTitle\}\}/g, String(task.title || ''))
        .replace(/\{\{taskContent\}\}/g, taskContent)
        .replace(/\{\{doneSignal\}\}/g, String(doneSignal || TASK_DONE_SIGNAL))
        .replace(/\{\{lastReply\}\}/g, String(replyText || ''));
    }

    async function runDoneSignalVerification(task, profile, resolved, replyText) {
      void profile;

      if (!task) {
        return { ok: false, reason: 'missing-task' };
      }

      if (!state.running) {
        return { ok: false, reason: 'cancelled' };
      }

      const run = state.taskRun || {};
      run.doneSignalVerificationRunning = true;
      run.pendingSendKind = 'verification';
      run.verifyReplyTextForResend = String(replyText || '');
      state.taskRun = run;

      ToolboxShell.appendLog(
        `[AUTOQ][VERIFY_STATE] start=1 task=${task.title || '-'} pendingSendKind=verification`,
      );

      let verificationPromptSent = false;

      try {
        setTaskBatchStep('verify-after-done-signal', task);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_START] task=${task.title}`);

        const settings = config.taskQueueSettings || {};
        const shouldUploadFile = settings.verifyAfterDoneSignalUploadFile !== false;

        if (shouldUploadFile) {
          if (
            typeof UploadModule === 'undefined'
            || typeof UploadModule.startUploadFromCurrentQueue !== 'function'
          ) {
            const reason = 'upload-module-missing';
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_FAILED] task=${task.title} reason=${reason}`,
            );
            failCurrentTask(reason);
            return { ok: false, reason };
          }

          setTaskBatchStep('verify-upload-file', task);
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_START] task=${task.title}`);

          state.uploadingFromAutoQueue = true;
          setAutoQueuePhase('uploading', 'upload-start');
          updateStatus('verify-upload-start');

          let uploadResult = null;

          try {
            uploadResult = await startUploadFromCurrentQueueWithTaskUploadRateLimit({
              source: `autoq-task-verify-${task.id}`,
              kind: 'verify-upload',
              shouldStop: () => !state.running,
            });
          } finally {
            state.uploadingFromAutoQueue = false;
            updateStatus('verify-upload-done');
          }

          const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
          const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
          const uploadReason = String(uploadResult && uploadResult.reason || '').trim();

          if (!uploadResult || uploadResult.ok !== true) {
            const reason = uploadReason || 'verify-upload-failed';

            if (reason === 'no-files') {
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_SKIPPED] task=${task.title} reason=no-files`,
              );
              ToolboxShell.appendLog(`[AUTOQ][TASK_VERIFY][NO_FILES] task=${task.title}`);
            } else if (reason === 'cancelled' || uploadResult.cancelled === true) {
              if (!state.running) {
                return { ok: false, reason: 'cancelled' };
              }
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_CANCELLED] task=${task.title}`,
              );
              return { ok: false, reason: 'cancelled' };
            } else {
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_FAILED] task=${task.title} uploaded=${uploadedCount} failed=${failedCount} reason=${reason}`,
              );
              failCurrentTask(reason);
              return { ok: false, reason };
            }
          }

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_DONE] task=${task.title} uploaded=${uploadedCount} failed=${failedCount}`,
          );
        }

        const verifyPrompt = buildVerifyAfterDoneSignalPrompt(task, resolved, replyText);

        setTaskBatchStep('verify-send-prompt', task);
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][VERIFY_SEND] task=${task.title} text_len=${verifyPrompt.length}`,
        );

        const prepareResult = await prepareTaskPageBeforeNextSend('verification', task);

        if (!prepareResult || prepareResult.ok !== true) {
          const reason = prepareResult && prepareResult.reason
            ? prepareResult.reason
            : 'prepare-before-verification-failed';

          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_SEND_BLOCKED] task=${task.title} reason=${reason}`);
          failCurrentTask(reason);
          return { ok: false, reason };
        }

        const sendResult = await sendTaskPrompt(
          verifyPrompt,
          '[AUTOQ][TASK_BATCH][VERIFY_SEND_PROMPT]',
          'verification',
        );

        if (!sendResult || sendResult.ok !== true) {
          const reason = String((sendResult && sendResult.reason) || 'verify-send-failed');

          run.pendingSendKind = 'verification';
          const classified = logSendFailureClassified('verification', task, reason, sendResult);

          if (classified.action === 'retry') {
            return { ok: false, reason, wait: true, retryable: true };
          }

          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_SEND_FAILED] task=${task.title} reason=${reason}`);
          failCurrentTask(reason);
          return { ok: false, reason };
        }

        verificationPromptSent = true;
        recordTaskBatchMessageSent('verification');

        setTaskBatchStep('verify-wait-reply', task);
        state.waitingReply = true;
        setAutoQueuePhase('waiting_reply', 'await-assistant');
        updateStatus('verify-wait-reply');

        return { ok: true };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);

        console.error('[AUTOQ][TASK_BATCH][VERIFY_FAILED]', {
          error_type: error && error.name ? error.name : 'Error',
          error: errText,
          stack: error && error.stack ? error.stack : '',
        });

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][VERIFY_FAILED] task=${task.title || '-'} reason=${errText}`,
        );

        failCurrentTask(errText || 'done-signal-verification-failed');

        return {
          ok: false,
          reason: errText || 'done-signal-verification-failed',
        };
      } finally {
        state.uploadingFromAutoQueue = false;

        if (!verificationPromptSent && state.taskRun) {
          state.taskRun.doneSignalVerificationRunning = false;
          state.taskRun.pendingSendKind = 'initial';
        }
      }
    }

    function getTaskAutoUploadSettings() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {
          taskAutoUploadEveryNMessagesEnabled: true,
          taskAutoUploadEveryNMessages: 5,
          taskAutoUploadCountInitialPrompt: true,
          taskAutoUploadCountContinuePrompt: true,
          taskAutoUploadCountVerifyPrompt: true,
        };

      const raw = config.taskQueueSettings && typeof config.taskQueueSettings === 'object'
        ? config.taskQueueSettings
        : {};

      return {
        enabled: raw.taskAutoUploadEveryNMessagesEnabled !== false,
        interval: Math.max(
          1,
          Math.floor(Number(raw.taskAutoUploadEveryNMessages) || defaults.taskAutoUploadEveryNMessages || 5),
        ),
        countInitialPrompt: raw.taskAutoUploadCountInitialPrompt !== false,
        countContinuePrompt: raw.taskAutoUploadCountContinuePrompt !== false,
        countVerifyPrompt: raw.taskAutoUploadCountVerifyPrompt !== false,
      };
    }

    function shouldCountTaskSendKindForAutoUpload(kind) {
      const settings = getTaskAutoUploadSettings();
      const sendKind = String(kind || '').trim();

      if (sendKind === 'initial') {
        return settings.countInitialPrompt;
      }

      if (sendKind === 'continue' || sendKind === 'verify-continue') {
        return settings.countContinuePrompt;
      }

      if (sendKind === 'verification') {
        return settings.countVerifyPrompt;
      }

      return true;
    }

    function recordTaskBatchMessageSent(kind) {
      if (!state.taskRun || typeof state.taskRun !== 'object') {
        return;
      }

      const run = state.taskRun;
      const safeKind = String(kind || '-');

      run.totalSentDialogueCount = Math.max(
        0,
        Number(run.totalSentDialogueCount) || 0,
      ) + 1;

      run.sentInCurrentChatCount = Math.max(
        0,
        Number(run.sentInCurrentChatCount) || 0,
      ) + 1;

      if (!shouldCountTaskSendKindForAutoUpload(kind)) {
        ToolboxShell.appendLog(
          `[TASK_RUN][SENT_COUNT] kind=${safeKind} totalSentDialogueCount=${run.totalSentDialogueCount} `
          + `sentInCurrentChatCount=${run.sentInCurrentChatCount} `
          + `autoUploadDialogueCount=${Number(run.sentMessageCount) || 0} autoUploadCounted=0`,
        );
        updateStatus('task-total-sent-count');
        return;
      }

      run.sentMessageCount = Math.max(
        0,
        Number(run.sentMessageCount) || 0,
      ) + 1;

      ToolboxShell.appendLog(
        `[TASK_RUN][SENT_COUNT] kind=${safeKind} totalSentDialogueCount=${run.totalSentDialogueCount} `
        + `sentInCurrentChatCount=${run.sentInCurrentChatCount} `
        + `autoUploadDialogueCount=${run.sentMessageCount} autoUploadCounted=1`,
      );

      updateStatus('task-total-sent-count');
    }

    function getTaskNewChatRotationSettings() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {
          taskRotateNewChatByPageTurnEnabled: true,
          taskRotateNewChatPageTurnThreshold: 30,
          taskRotateForceUploadAfterNewChat: true,
        };

      const raw = config.taskQueueSettings && typeof config.taskQueueSettings === 'object'
        ? config.taskQueueSettings
        : {};

      const enabled = raw.enableAutoNewChatWhenRoundLimitReached !== false
        && raw.taskRotateNewChatByPageTurnEnabled !== false;

      return {
        enabled,
        threshold: Math.max(
          1,
          Math.floor(
            Number(raw.taskRotateNewChatPageTurnThreshold)
            || Number(raw.maxConversationRoundsPerPage)
            || defaults.taskRotateNewChatPageTurnThreshold
            || defaults.maxConversationRoundsPerPage
            || 30,
          ),
        ),
        forceUploadAfterRotate: raw.taskRotateForceUploadAfterNewChat !== false,
      };
    }

    function getTaskCurrentPageDialogueCount() {
      const live = readPageTurnCount();

      if (live !== null && Number.isFinite(Number(live))) {
        return Math.max(0, Math.floor(Number(live) || 0));
      }

      const run = state.taskRun || {};
      return Math.max(0, Math.floor(Number(run.sentInCurrentChatCount) || 0));
    }

    function shouldRotateTaskNewChatBeforeNextSend(kind) {
      void kind;

      if (!state.running) {
        return false;
      }

      if (config.promptMode !== 'task') {
        return false;
      }

      if (!state.taskRun || typeof state.taskRun !== 'object') {
        return false;
      }

      const settings = getTaskNewChatRotationSettings();
      const threshold = Math.max(1, Number(settings.threshold) || 30);
      const pageCount = getTaskCurrentPageDialogueCount();
      const isBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      ToolboxShell.appendLog(
        `[PAGE_ROTATE][CHECK] kind=${String(kind || '-')} enabled=${settings.enabled ? 1 : 0} `
        + `pageTurn=${pageCount} threshold=${threshold} busy=${isBusy ? 1 : 0}`,
      );

      if (!settings.enabled) {
        return false;
      }

      if (isBusy) {
        return false;
      }

      if (pageCount < threshold) {
        return false;
      }

      const run = state.taskRun;
      const totalSent = Math.max(0, Number(run.totalSentDialogueCount) || 0);
      const lastRotateAtTotal = Math.max(
        0,
        Number(run.lastNewChatRotationAtTotalSentDialogueCount) || 0,
      );

      if (lastRotateAtTotal === totalSent) {
        return false;
      }

      return true;
    }

    async function rotateTaskNewChatBeforeNextSendIfNeeded(kind, task) {
      if (!shouldRotateTaskNewChatBeforeNextSend(kind)) {
        return {
          ok: true,
          skipped: true,
          rotated: false,
          reason: 'not-needed',
        };
      }

      const settings = getTaskNewChatRotationSettings();
      const beforePageCount = getTaskCurrentPageDialogueCount();
      const beforeTotalSent = state.taskRun
        ? Math.max(0, Number(state.taskRun.totalSentDialogueCount) || 0)
        : 0;
      const beforeKey = typeof getCurrentConversationKey === 'function'
        ? getCurrentConversationKey()
        : '';

      setTaskBatchStep('new-chat-rotate', task || getCurrentRunningTask(), { log: true });

      ToolboxShell.appendLog(
        `[PAGE_ROTATE][TRIGGER] kind=${String(kind || '-')} pageTurn=${beforePageCount} `
        + `threshold=${settings.threshold} totalSent=${beforeTotalSent}`,
      );
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_PAGE_ROTATE][START] kind=${String(kind || '-')} `
        + `pageTurn=${beforePageCount} threshold=${settings.threshold} `
        + `totalSent=${beforeTotalSent} before=${beforeKey || '-'}`,
      );
      ToolboxShell.appendLog(
        `[PAGE_ROTATE][WAIT_READY] kind=${String(kind || '-')} before=${beforeKey || '-'}`,
      );

      const switchResult = await clickChatGPTNewChatInPage(
        `task-page-turn-${beforePageCount}-before-${String(kind || 'send')}`,
      );

      if (!switchResult || switchResult.ok !== true) {
        const reason = switchResult && switchResult.reason
          ? String(switchResult.reason)
          : 'new-chat-rotate-failed';

        ToolboxShell.appendLog(
          `[PAGE_ROTATE][FAILED] kind=${String(kind || '-')} pageTurn=${beforePageCount} reason=${reason}`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_PAGE_ROTATE][FAILED] kind=${String(kind || '-')} `
          + `pageTurn=${beforePageCount} reason=${reason}`,
        );

        return {
          ok: false,
          rotated: false,
          reason,
        };
      }

      const run = state.taskRun || {};
      run.sentInCurrentChatCount = 0;
      run.lastNewChatRotationAtTotalSentDialogueCount = beforeTotalSent;
      run.lastNewChatRotationAt = Date.now();
      run.newChatRotationCount = Math.max(0, Number(run.newChatRotationCount) || 0) + 1;
      run.lastRotatedConversationKey = String(switchResult.afterKey || '');

      if (settings.forceUploadAfterRotate) {
        run.forceUploadBeforeNextSend = true;
      }

      state.taskRun = run;

      ToolboxShell.appendLog(
        `[PAGE_ROTATE][DONE] kind=${String(kind || '-')} after=${String(switchResult.afterKey || '-')} `
        + `rotationCount=${run.newChatRotationCount}`,
      );
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_PAGE_ROTATE][DONE] kind=${String(kind || '-')} `
        + `before=${beforeKey || '-'} after=${String(switchResult.afterKey || '-')} `
        + `rotationCount=${run.newChatRotationCount} forceUpload=${run.forceUploadBeforeNextSend ? 1 : 0}`,
      );

      updateStatus('task-page-rotate-done');

      return {
        ok: true,
        skipped: false,
        rotated: true,
        reason: 'rotated',
      };
    }

    async function prepareTaskPageBeforeNextSend(kind, task) {
      const rotateResult = await rotateTaskNewChatBeforeNextSendIfNeeded(kind, task);

      if (!rotateResult || rotateResult.ok !== true) {
        if (!rotateResult || rotateResult.skipped !== true) {
          ToolboxShell.appendLog(
            `[PAGE_ROTATE][FAILED] kind=${String(kind || '-')} phase=rotate `
            + `reason=${rotateResult && rotateResult.reason ? rotateResult.reason : 'new-chat-rotate-failed'}`,
          );
        }
        return rotateResult || {
          ok: false,
          rotated: false,
          reason: 'new-chat-rotate-failed',
        };
      }

      if (rotateResult.rotated) {
        ToolboxShell.appendLog(
          `[PAGE_ROTATE][UPLOAD_FIRST] kind=${String(kind || '-')} task=${task && task.title ? task.title : '-'}`,
        );
      }

      const uploadResult = await runTaskAutoUploadBeforeNextSend(kind, task);

      if (!uploadResult || uploadResult.ok !== true) {
        ToolboxShell.appendLog(
          `[PAGE_ROTATE][FAILED] kind=${String(kind || '-')} phase=upload `
          + `reason=${uploadResult && uploadResult.reason ? uploadResult.reason : 'auto-upload-failed'}`,
        );
        return {
          ok: false,
          rotated: !!rotateResult.rotated,
          reason: uploadResult && uploadResult.reason
            ? uploadResult.reason
            : 'auto-upload-failed',
        };
      }

      if (rotateResult.rotated) {
        ToolboxShell.appendLog(
          `[PAGE_ROTATE][SEND_AFTER_UPLOAD] kind=${String(kind || '-')} task=${task && task.title ? task.title : '-'}`,
        );
      }

      return {
        ok: true,
        rotated: !!rotateResult.rotated,
        uploadResult,
        reason: rotateResult.rotated ? 'rotated-and-uploaded' : 'ready',
      };
    }

    function buildTaskReentryPromptAfterPageRotate(task, resolved, kind) {
      const initialResolved = resolveTaskInitialPrompt(task, { log: false });
      const initialPrompt = String(initialResolved.initialPrompt || '').trim();
      const actualDoneSignal = typeof normalizeDoneSignal === 'function'
        ? normalizeDoneSignal(resolved && resolved.actualDoneSignal)
        : String(resolved && resolved.actualDoneSignal || TASK_DONE_SIGNAL);

      const continuePrompt = typeof renderContinuePromptTemplate === 'function'
        ? renderContinuePromptTemplate(
          resolved && resolved.actualContinuePromptTemplate
            ? resolved.actualContinuePromptTemplate
            : DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE,
          actualDoneSignal,
        )
        : String(
          resolved && resolved.actualContinuePromptTemplate
            ? resolved.actualContinuePromptTemplate
            : DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE,
        );

      return [
        '当前批量任务组因为原 ChatGPT 页面对话轮次达到上限，已经自动切换到新聊天。',
        '请基于本页面刚刚上传的代码文件，继续完成同一个任务。',
        '',
        `任务标题：${task && task.title ? task.title : '-'}`,
        '',
        '任务内容：',
        initialPrompt || '当前任务内容为空，请根据刚上传的代码文件继续完成当前批量任务组任务。',
        '',
        '继续规则：',
        continuePrompt,
        '',
        `本次发送来源：page-rotate-${String(kind || 'send')}`,
      ].join('\n');
    }

    function getTaskAutoUploadStrategyDisplay() {
      const settings = getTaskAutoUploadSettings();
      const interval = Math.max(1, Number(settings.interval) || 5);

      if (!settings.enabled) {
        return {
          interval,
          enabled: false,
          summary: '未启用',
          patternText: '-',
        };
      }

      const examples = [];
      for (let messageNo = 1; messageNo <= Math.max(interval * 3, interval + 1); messageNo += 1) {
        if ((messageNo - 1) % interval === 0) {
          examples.push(messageNo);
        }
        if (examples.length >= 4) {
          break;
        }
      }

      const patternText = examples.length
        ? `${examples.join('、')}...`
        : `每 ${interval} 次`;

      return {
        interval,
        enabled: true,
        summary: `文件上传频率：每 ${interval} 次对话上传一次；当前策略：第 ${patternText} 次上传`,
        patternText,
      };
    }

    function shouldUploadFileForTaskMessageNo(messageNo, interval) {
      const everyN = Math.max(1, Number(interval) || 1);
      const no = Math.max(1, Number(messageNo) || 1);
      return (no - 1) % everyN === 0;
    }

    function shouldRunTaskAutoUploadBeforeNextSend(kind) {
      if (!state.running) {
        return false;
      }

      if (!state.taskRun || typeof state.taskRun !== 'object') {
        return false;
      }

      if (state.taskRun.forceUploadBeforeNextSend === true) {
        return true;
      }

      const settings = getTaskAutoUploadSettings();

      if (!settings.enabled) {
        return false;
      }

      if (!shouldCountTaskSendKindForAutoUpload(kind)) {
        return false;
      }

      const currentCount = Math.max(0, Number(state.taskRun.sentMessageCount) || 0);
      const interval = Math.max(1, Number(settings.interval) || 5);
      const nextMessageNo = currentCount + 1;

      if (!shouldUploadFileForTaskMessageNo(nextMessageNo, interval)) {
        return false;
      }

      const lastAutoUploadAt = Math.max(
        0,
        Number(state.taskRun.lastAutoUploadAtMessageCount) || 0,
      );

      return lastAutoUploadAt !== nextMessageNo;
    }

    async function runTaskAutoUploadBeforeNextSend(kind, task) {
      if (!shouldRunTaskAutoUploadBeforeNextSend(kind)) {
        return {
          ok: true,
          skipped: true,
          reason: 'not-needed',
        };
      }

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.startUploadFromCurrentQueue !== 'function'
      ) {
        const reason = 'upload-module-missing';

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][FAILED] kind=${kind || '-'} reason=${reason}`,
        );

        return {
          ok: false,
          reason,
        };
      }

      const forceUpload = !!(state.taskRun && state.taskRun.forceUploadBeforeNextSend === true);
      const currentCount = Math.max(0, Number(state.taskRun.sentMessageCount) || 0);
      const nextMessageNo = currentCount + 1;

      const pendingItems = typeof UploadModule.getPendingUploadItems === 'function'
        ? UploadModule.getPendingUploadItems()
        : [];

      const pendingUploadCount = Array.isArray(pendingItems) ? pendingItems.length : 0;

      if (pendingUploadCount <= 0) {
        if (forceUpload && state.taskRun) {
          state.taskRun.forceUploadBeforeNextSend = false;
        }
        state.taskRun.lastAutoUploadAtMessageCount = nextMessageNo;
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][SKIPPED] sentMessageCount=${currentCount} nextMessageNo=${nextMessageNo} reason=no-files-before-upload`,
        );

        return {
          ok: true,
          skipped: true,
          reason: 'no-files',
        };
      }

      setTaskBatchStep('auto-upload-before-send', task || getCurrentRunningTask(), { log: true });
      ToolboxShell.setStatus(`批量任务组：第 ${currentCount} 次对话后自动上传文件`);
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_AUTO_UPLOAD][START] kind=${kind || '-'} sentMessageCount=${currentCount} forceUpload=${forceUpload ? 1 : 0}`,
      );

      state.uploadingFromAutoQueue = true;
      setAutoQueuePhase('uploading', 'upload-start');
      updateStatus('task-auto-upload-start');

      try {
        const uploadRateLimitResult = await waitForTaskUploadRateLimit(kind || 'auto-upload', {
          shouldStop: () => !state.running,
        });

        if (!uploadRateLimitResult || uploadRateLimitResult.ok !== true) {
          const blockedReason = uploadRateLimitResult && uploadRateLimitResult.reason
            ? uploadRateLimitResult.reason
            : 'upload-rate-limit-cancelled';

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][BLOCKED] sentMessageCount=${currentCount} reason=${blockedReason}`,
          );

          return {
            ok: false,
            reason: blockedReason,
          };
        }

        const uploadRateStatus = getTaskUploadRateLimitStatus(1);
        const maxFilesForThisUpload = uploadRateStatus.enabled
          ? Math.max(0, Math.min(pendingUploadCount, Number(uploadRateStatus.remaining) || 0))
          : pendingUploadCount;

        if (maxFilesForThisUpload <= 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][BLOCKED] sentMessageCount=${currentCount} reason=no-upload-quota`,
          );

          return {
            ok: false,
            reason: 'no-upload-quota',
          };
        }

        if (maxFilesForThisUpload < pendingUploadCount) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][PARTIAL] sentMessageCount=${currentCount} pending=${pendingUploadCount} `
            + `allowed=${maxFilesForThisUpload} reason=upload-rate-limit`,
          );
        }

        const uploadResult = await UploadModule.startUploadFromCurrentQueue({
          source: `autoq-task-auto-upload-${currentCount}`,
          shouldStop: () => !state.running,
          maxFiles: maxFilesForThisUpload,
        });

        const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
        const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
        const skippedCount = Number(uploadResult && uploadResult.skippedCount) || 0;
        const reason = String(uploadResult && uploadResult.reason || '').trim();

        state.taskRun.lastAutoUploadAtMessageCount = nextMessageNo;

        if (!uploadResult || uploadResult.ok !== true) {
          if (reason === 'no-files') {
            if (forceUpload && state.taskRun) {
              state.taskRun.forceUploadBeforeNextSend = false;
            }
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_AUTO_UPLOAD][SKIPPED] sentMessageCount=${currentCount} reason=no-files`,
            );

            return {
              ok: true,
              skipped: true,
              reason: 'no-files',
            };
          }

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][FAILED] sentMessageCount=${currentCount} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} reason=${reason || 'upload-failed'}`,
          );

          return {
            ok: false,
            reason: reason || 'upload-failed',
          };
        }

        if (uploadedCount <= 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][NOT_RECORDED] source=auto-upload sentMessageCount=${currentCount} uploaded=0 reason=no-uploaded-files`,
          );
        }

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][DONE] sentMessageCount=${currentCount} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount}`,
        );

        if (forceUpload && state.taskRun) {
          state.taskRun.forceUploadBeforeNextSend = false;
        }

        return {
          ok: true,
          skipped: false,
          reason: 'uploaded',
          uploadResult,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        console.error('[AUTOQ][TASK_AUTO_UPLOAD][ERROR]', {
          kind,
          sentMessageCount: currentCount,
          forceUpload,
          error_type: error && error.name,
          error: errText,
          stack: errStack,
        });

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][ERROR] sentMessageCount=${currentCount} error=${errText}`,
        );

        return {
          ok: false,
          reason: errText || 'auto-upload-error',
        };
      } finally {
        state.uploadingFromAutoQueue = false;
        updateStatus('task-auto-upload-done');
      }
    }

    async function onAssistantReplySettled(replyText, meta = {}) {
      if (!state.running || !state.taskRun) {
        return;
      }

      const task = getCurrentRunningTask();
      const title = task && task.title ? task.title : '-';
      const replySnapshot = buildAssistantReplySnapshot();
      const mergedText = String(replyText || replySnapshot.text || '').trim();
      const validation = validateAssistantReplyForRun(
        { runId: state.currentRunId },
        { ...replySnapshot, text: mergedText },
      );

      if (!validation.ok) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][REPLY_INVALID] task=${title} reason=${validation.reason}`,
        );
        if (config.promptMode === 'task') {
          failCurrentTask(validation.reason || 'reply-invalid');
        } else {
          setAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, validation.reason || 'reply-invalid');
          state.waitingReply = false;
          state.running = false;
        }
        updateStatus();
        return;
      }

      const chars = mergedText.length;

      ToolboxShell.appendLog(
        `[AUTOQ][REPLY_SETTLED] task=${title} chars=${chars} reason=${meta && meta.reason ? meta.reason : '-'}`,
      );

      setAutoQueuePhase(AUTO_QUEUE_PHASES.REPLY_READY, 'assistant reply ready');

      if (state.waitingReply) {
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = 0;
        ToolboxShell.appendLog('[AUTOQ][WAITING_REPLY_CLEAR]');
      }

      await handleTaskReplyReady();
    }

    async function handleTaskReplyReady() {
      if (state.taskBatchStepRunning) {
        return;
      }

      const task = getCurrentRunningTask();

      if (!task) {
        console.error('[ChatGPT toolbox] handleTaskReplyReady: no current task');
        log('当前无运行中任务');
        return;
      }

      if (!state.running) {
        return;
      }

      setTaskBatchStep('wait-reply', task, { log: false });

      let replyText = '';

      try {
        replyText = getLastAssistantReplyText();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] handleTaskReplyReady get reply failed', err);
        log(`读取回复异常：${errText}`);
        return;
      }

      const profile = getActiveTaskProfile();
      const resolved = resolveTaskContinueSettings(task, profile, { log: true });

      if (tryStopBatchOnReplyClassify(replyText, task)) {
        return;
      }

      if (state.taskRun && state.taskRun.doneSignalVerificationRunning) {
        const doneCheck = isTaskDoneSignalMatched(replyText, resolved.actualDoneSignal);

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][VERIFY_REPLY_READY] task=${task.title} matched=${doneCheck.matched ? 1 : 0}`,
        );

        state.taskRun.doneSignalVerificationRunning = false;

        if (doneCheck.corrupted) {
          failCurrentTask('corrupted-verification-signal');
          return;
        }

        if (doneCheck.matched) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_COMPLETE] task=${task.title}`);
          ToolboxShell.appendLog(`[AUTOQ][TASK][COMPLETE] task=${task.title}`);
          markTaskStatus(task, 'completed');
          notifyRuntimeTaskComplete(task);
          state.taskRun.pendingSendKind = 'initial';
          setTaskBatchStep('next-task', task, { log: false });
          ToolboxShell.appendLog('[AUTOQ][CONTINUE_NEXT] reason=verify-complete');
          void moveToNextTask().catch(handleMoveToNextTaskError);
          return;
        }

        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_CONTINUE_REQUIRED] task=${task.title}`);
        task.continueCount = Number(task.continueCount || 0) + 1;
        saveConfig();
        renderTaskList();

        state.taskRun.pendingSendKind = 'processing';
        setTaskBatchStep('copy-last-reply', task, { log: false });
        state.taskBatchStepRunning = true;

        try {
          const maxRounds = normalizeContinueRoundLimit(
            resolved.actualMaxContinueRounds,
            UNLIMITED_CONTINUE_ROUNDS,
          );
          const stopOnMax = config.taskQueueSettings
            && config.taskQueueSettings.stopOnMaxContinueRounds !== false;

          if (stopOnMax && maxRounds > 0 && task.continueCount >= maxRounds) {
            failCurrentTask('timeout');
            return;
          }

          if (
            typeof UploadModule === 'undefined'
            || typeof UploadModule.runCopyHotkeyContinueOnceForTaskQueue !== 'function'
          ) {
            failCurrentTask('upload-module-missing');
            return;
          }

          const round = Number(task.continueCount) || 0;
          const actualDoneSignal = typeof normalizeDoneSignal === 'function'
            ? normalizeDoneSignal(resolved.actualDoneSignal)
            : resolved.actualDoneSignal;
          const actualContinuePrompt = typeof renderContinuePromptTemplate === 'function'
            ? renderContinuePromptTemplate(
              resolved.actualContinuePromptTemplate,
              actualDoneSignal,
            )
            : resolved.actualContinuePromptTemplate;

          const prepareResult = await prepareTaskPageBeforeNextSend('verify-continue', task);

          if (!prepareResult || prepareResult.ok !== true) {
            failCurrentTask(prepareResult && prepareResult.reason ? prepareResult.reason : 'prepare-before-send-failed');
            return;
          }

          if (prepareResult.rotated === true) {
            const reentryPrompt = buildTaskReentryPromptAfterPageRotate(task, resolved, 'verify-continue');

            const rateLimitResult = await waitForTaskSendRateLimit('verify-continue', {
              shouldStop: () => !state.running,
            });

            if (!rateLimitResult.ok) {
              markTaskStatus(task, 'stopped');
              setTaskBatchStep('stopped', task, { log: false });
              recordTaskBatchStopReason(
                rateLimitResult.reason || 'rate-limit-cancelled',
                { sendReason: rateLimitResult.reason || 'rate-limit-cancelled' },
              );
              return;
            }

            const sendResult = await sendTaskPrompt(
              reentryPrompt,
              '[AUTOQ][TASK_BATCH][SEND_REENTRY_AFTER_PAGE_ROTATE]',
              'continue',
            );

            if (!sendResult || sendResult.ok !== true) {
              const reason = String((sendResult && sendResult.reason) || 'page-rotate-reentry-send-failed');
              failCurrentTask(reason);
              return;
            }

            recordTaskSendRateLimitHit('verify-continue');
            recordTaskBatchMessageSent('verify-continue');

            task.continueCount = Number(task.continueCount || 0) + 1;
            task.updatedAt = nowMs();
            saveConfig();
            renderTaskList();
            renderTaskEditor();

            state.waitingReply = true;
            setAutoQueuePhase('waiting_reply', 'await-assistant');
            state.replyBecameBusy = false;
            state.idleSince = 0;
            state.waitingStartedAt = Date.now();
            state.taskRun.pendingSendKind = null;
            setTaskBatchStep('wait-next-reply', task);
            updateStatus('page-rotate-reentry-sent');
            updateChatInputStateBadge();
            return;
          }

          const rateLimitResult = await waitForTaskSendRateLimit('verify-continue', {
            shouldStop: () => !state.running,
          });

          if (!rateLimitResult.ok) {
            markTaskStatus(task, 'stopped');
            setTaskBatchStep('stopped', task, { log: false });
            recordTaskBatchStopReason(
              rateLimitResult.reason || 'rate-limit-cancelled',
              { sendReason: rateLimitResult.reason || 'rate-limit-cancelled' },
            );
            return;
          }

          const result = await UploadModule.runCopyHotkeyContinueOnceForTaskQueue({
            source: `autoq-task-verify-continue-${task.id}-${round}`,
            continuePrompt: actualContinuePrompt,
            doneSignal: actualDoneSignal,
            shouldStop: () => !state.running,
          });

          const failReason = result && result.reason ? String(result.reason) : '';

          if (!state.running || failReason === 'cancelled') {
            markTaskStatus(task, 'stopped');
            setTaskBatchStep('stopped', task, { log: false });
            recordTaskBatchStopReason('cancelled', { sendReason: failReason || 'cancelled' });
            return;
          }

          if (tryStopBatchOnCopyHotkeyTerminalResult(result, task)) {
            return;
          }

          if (result && result.assistantDoneSignal) {
            const settings = config.taskQueueSettings || {};
            const verifyEnabled = settings.verifyAfterDoneSignal !== false;

            if (verifyEnabled) {
              void runDoneSignalVerification(task, profile, resolved, replyText).catch((err) => {
                const errText = err && err.message ? err.message : String(err);
                console.error('[ChatGPT toolbox] [AUTOQ][TASK_BATCH][VERIFY_FAILED]', err);
                ToolboxShell.appendLog(
                  `[AUTOQ][TASK_BATCH][VERIFY_FAILED] task=${task.title} reason=${errText}`,
                );
                failCurrentTask(errText || 'done-signal-verification-failed');
              });
              return;
            }

            ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_COMPLETE] task=${task.title}`);
            ToolboxShell.appendLog(`[AUTOQ][TASK][COMPLETE] task=${task.title}`);
            markTaskStatus(task, 'completed');
            notifyRuntimeTaskComplete(task);
            state.taskRun.pendingSendKind = 'initial';
            setTaskBatchStep('next-task', task, { log: false });
            void moveToNextTask().catch(handleMoveToNextTaskError);
            return;
          }

          if (!result || !result.ok) {
            failCurrentTask(failReason || 'verify-continue-failed');
            return;
          }

          if (result.continueSent) {
            recordTaskSendRateLimitHit('verify-continue');
            recordTaskBatchMessageSent('verify-continue');
          }

          state.waitingReply = true;
          setAutoQueuePhase('waiting_reply', 'await-assistant');
          state.replyBecameBusy = false;
          state.idleSince = 0;
          state.waitingStartedAt = Date.now();
          state.taskRun.pendingSendKind = null;
          setTaskBatchStep('wait-next-reply', task);
          updateStatus('verify-continue-sent');
          updateChatInputStateBadge();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] verify continue step failed', err);
          failCurrentTask(errText);
        } finally {
          state.taskBatchStepRunning = false;
        }

        return;
      }
      setTaskBatchStep('initial-reply-done', task, { log: false });
      ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_REPLY_DONE]');
      setTaskBatchStep('check-done-signal', task);
      const doneCheck = isTaskDoneSignalMatched(replyText, resolved.actualDoneSignal);

      if (doneCheck.corrupted) {
        failCurrentTask('corrupted-assistant-signal');
        return;
      }

      const matched = doneCheck.matched;

      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][REPLY_READY] task=${task.title}`);
      ToolboxShell.appendLog(
        `[AUTOQ][TASK][DONE_SIGNAL_CHECK] matched=${matched ? 1 : 0} signal=${resolved.actualDoneSignal}`,
      );

      if (matched) {
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][DONE_SIGNAL] task=${task.title}`);
        ToolboxShell.appendLog(`[AUTOQ][TASK][DONE_SIGNAL] task=${task.title}`);

        const settings = config.taskQueueSettings || {};
        const verifyEnabled = settings.verifyAfterDoneSignal !== false;

        if (verifyEnabled && !state.taskRun.doneSignalVerificationRunning) {
          void runDoneSignalVerification(task, profile, resolved, replyText).catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] [AUTOQ][TASK_BATCH][VERIFY_FAILED]', err);
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_BATCH][VERIFY_FAILED] task=${task.title} reason=${errText}`,
            );
            failCurrentTask(errText || 'done-signal-verification-failed');
          });
          return;
        }

        ToolboxShell.appendLog(`[AUTOQ][TASK][COMPLETE] task=${task.title}`);
        markTaskStatus(task, 'completed');
        notifyRuntimeTaskComplete(task);
        state.taskRun.pendingSendKind = 'initial';
        setTaskBatchStep('next-task', task, { log: false });
        void moveToNextTask().catch(handleMoveToNextTaskError);
        return;
      }

      const maxRounds = normalizeContinueRoundLimit(
        resolved.actualMaxContinueRounds,
        UNLIMITED_CONTINUE_ROUNDS,
      );
      const stopOnMax = config.taskQueueSettings && config.taskQueueSettings.stopOnMaxContinueRounds !== false;

      if (stopOnMax && maxRounds > 0 && task.continueCount >= maxRounds) {
        failCurrentTask('timeout');
        return;
      }

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.runCopyHotkeyContinueOnceForTaskQueue !== 'function'
      ) {
        failCurrentTask('upload-module-missing');
        return;
      }

      state.taskBatchStepRunning = true;
      state.taskRun.pendingSendKind = 'processing';

      try {
        const round = Number(task.continueCount) + 1;

        const actualDoneSignal = typeof normalizeDoneSignal === 'function'
          ? normalizeDoneSignal(resolved.actualDoneSignal)
          : resolved.actualDoneSignal;
        const actualContinuePrompt = typeof renderContinuePromptTemplate === 'function'
          ? renderContinuePromptTemplate(
            resolved.actualContinuePromptTemplate,
            actualDoneSignal,
          )
          : resolved.actualContinuePromptTemplate;

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_PROMPT][RENDER] task=${task.title} doneSignal=${actualDoneSignal}`,
        );

        if (typeof isCorruptedBatchSignalText === 'function' && isCorruptedBatchSignalText(actualContinuePrompt)) {
          ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][FAILED] reason=corrupted-continue-prompt');
          failCurrentTask('corrupted-continue-prompt');
          return;
        }

        setTaskBatchStep('copy-last-reply', task, { log: false });
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][COPY_PREPARE] task=${task.title}`);

        const prepareResult = await prepareTaskPageBeforeNextSend('continue', task);

        if (!prepareResult || prepareResult.ok !== true) {
          failCurrentTask(prepareResult && prepareResult.reason ? prepareResult.reason : 'prepare-before-send-failed');
          return;
        }

        if (prepareResult.rotated === true) {
          const reentryPrompt = buildTaskReentryPromptAfterPageRotate(task, resolved, 'continue');

          const rateLimitResult = await waitForTaskSendRateLimit('continue', {
            shouldStop: () => !state.running,
          });

          if (!rateLimitResult.ok) {
            markTaskStatus(task, 'stopped');
            setTaskBatchStep('stopped', task, { log: false });
            recordTaskBatchStopReason(
              rateLimitResult.reason || 'rate-limit-cancelled',
              { sendReason: rateLimitResult.reason || 'rate-limit-cancelled' },
            );
            return;
          }

          const sendResult = await sendTaskPrompt(
            reentryPrompt,
            '[AUTOQ][TASK_BATCH][SEND_REENTRY_AFTER_PAGE_ROTATE]',
            'continue',
          );

          if (!sendResult || sendResult.ok !== true) {
            const reason = String((sendResult && sendResult.reason) || 'page-rotate-reentry-send-failed');
            failCurrentTask(reason);
            return;
          }

          recordTaskSendRateLimitHit('continue');
          recordTaskBatchMessageSent('continue');

          task.continueCount = round;
          task.updatedAt = nowMs();
          saveConfig();
          renderTaskList();
          renderTaskEditor();

          state.waitingReply = true;
          setAutoQueuePhase('waiting_reply', 'await-assistant');
          state.replyBecameBusy = false;
          state.idleSince = 0;
          state.waitingStartedAt = Date.now();
          state.taskRun.pendingSendKind = null;
          setTaskBatchStep('wait-next-reply', task);
          updateStatus('page-rotate-reentry-sent');
          updateChatInputStateBadge();
          return;
        }

        const rateLimitResult = await waitForTaskSendRateLimit('continue', {
          shouldStop: () => !state.running,
        });

        if (!rateLimitResult.ok) {
          markTaskStatus(task, 'stopped');
          setTaskBatchStep('stopped', task, { log: false });
          ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][STOPPED] reason=rate-limit-cancelled');
          recordTaskBatchStopReason(
            rateLimitResult.reason || 'rate-limit-cancelled',
            { sendReason: rateLimitResult.reason || 'rate-limit-cancelled' },
          );
          return;
        }

        const result = await UploadModule.runCopyHotkeyContinueOnceForTaskQueue({
          source: `autoq-task-${task.id}-${round}`,
          continuePrompt: actualContinuePrompt,
          doneSignal: actualDoneSignal,
          shouldStop: () => !state.running,
        });

        const failReason = result && result.reason ? String(result.reason) : '';

        if (!state.running || failReason === 'cancelled') {
          markTaskStatus(task, 'stopped');
          setTaskBatchStep('stopped', task, { log: false });
          ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][STOPPED] reason=cancelled');
          recordTaskBatchStopReason('cancelled', { sendReason: failReason || 'cancelled' });
          return;
        }

        if (tryStopBatchOnCopyHotkeyTerminalResult(result, task)) {
          return;
        }

        if (result.copied) {
          const copiedChars = String(
            (result && result.copied_text) || replyText || '',
          ).length;
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][COPY_DONE] task=${task.title} chars=${copiedChars}`);
        } else if (!result.assistantDoneSignal) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][COPY_NOT_DONE] task=${task.title} reason=${failReason || 'copy-failed'}`,
          );
        }

        if (result.hotkeySent) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][HOTKEY_DONE] task=${task.title}`);
        } else if (!result.assistantDoneSignal) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][HOTKEY_NOT_DONE] task=${task.title} reason=${failReason || 'hotkey-failed'}`,
          );
        }

        if (result.assistantDoneSignal) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][DONE_SIGNAL] task=${task.title}`);
          markTaskStatus(task, 'completed');
          notifyRuntimeTaskComplete(task);
          state.taskRun.pendingSendKind = 'initial';
          setTaskBatchStep('next-task', task, { log: false });
          void moveToNextTask().catch(handleMoveToNextTaskError);
          return;
        }

        if (!result.ok) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][FAILED] task=${task.title} reason=${failReason || 'copy-hotkey-continue-failed'}`);
          failCurrentTask(failReason || 'copy-hotkey-continue-failed');
          return;
        }

        if (result.continueSent) {
          recordTaskSendRateLimitHit('continue');
          recordTaskBatchMessageSent('continue');
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][SEND_CONTINUE] task=${task.title} round=${round}`);
        } else {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][CONTINUE_NOT_SENT] task=${task.title} reason=${failReason || 'continue-not-sent'}`,
          );
        }

        if (!(result.copied && result.hotkeySent && result.continueSent)) {
          failCurrentTask(failReason || 'batch-step-incomplete');
          return;
        }

        task.continueCount = round;
        task.updatedAt = nowMs();
        saveConfig();
        renderTaskList();
        renderTaskEditor();

        state.waitingReply = true;
        setAutoQueuePhase('waiting_reply', 'await-assistant');
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = Date.now();
        state.taskRun.pendingSendKind = null;
        setTaskBatchStep('wait-next-reply', task);
        log(`已执行复制+快捷键+继续，等待下一轮回复 (${task.continueCount}/${formatContinueRoundLimit(maxRounds)})`);
        updateStatus('continue-sent');
        updateChatInputStateBadge();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] handleTaskReplyReady batch step failed', err);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][FAILED] task=${task.title} error=${errText}`);
        failCurrentTask(errText);
      } finally {
        state.taskBatchStepRunning = false;
        if (!state.running) {
          state.taskRun.pendingSendKind = null;
        }
        updateStatus('task-reply-ready');
      }
    }

    function splitPrompts(text) {
      return String(text || '')
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }

    function renderPromptTextForSendByMode(mode, text) {
      const m = normalizeAutoMode(mode);
      const raw = String(text || '');

      if (m !== 'continue') {
        return raw;
      }

      if (typeof renderContinuePromptTemplate === 'function') {
        return renderContinuePromptTemplate(raw, TASK_DONE_SIGNAL);
      }

      return raw
        .replaceAll('{{DONE_SIGNAL}}', TASK_DONE_SIGNAL)
        .replaceAll('{{BLOCKED_SIGNAL}}', DEFAULT_BATCH_BLOCKED_SIGNAL)
        .replaceAll('{{NO_MORE_CONTENT_SIGNAL}}', DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL);
    }

    function buildQueuePromptsByMode(mode) {
      const m = normalizeAutoMode(mode);
      const text = getPromptsTextByMode(m);

      if (m === 'continue') {
        const prompt = String(text || '').trim();
        return prompt ? [prompt] : [];
      }

      return splitPrompts(text);
    }

    function getPromptsTextByMode(mode) {
      if (mode === 'continue') {
        const stored = String(config.continuePromptsText || '').trim();
        return renderPromptTextForSendByMode(
          'continue',
          stored || getDefaultContinuePromptTextForUi(),
        );
      }

      normalizeListProfiles();

      const active = getActiveListProfile();
      return active ? String(active.text || '') : '';
    }

    function setPromptsTextByMode(mode, text) {
      let value = String(text || '');

      if (mode === 'continue') {
        const trimmed = value.trim();
        if (trimmed === getDefaultContinuePromptTextForUi()) {
          value = '';
        }
        config.continuePromptsText = value;
        return;
      }

      normalizeListProfiles();

      const active = getActiveListProfile();

      if (active) {
        active.text = value;
        active.updatedAt = nowMs();
      }

      config.listPromptsText = value;
    }

    function getRandomDelayMs() {
      const modeSettings = getModeSettings(config.promptMode);
      const minSec = Number(modeSettings.randomMinSec);
      const maxSec = Number(modeSettings.randomMaxSec);

      const safeMin = Number.isFinite(minSec) ? Math.max(1, minSec) : 3;
      const safeMax = Number.isFinite(maxSec) ? Math.max(safeMin, maxSec) : 20;

      const sec = safeMin + Math.random() * (safeMax - safeMin);
      return Math.round(sec * 1000);
    }

    function log(text) {
      ToolboxShell.appendLog(`[自动指令] ${text}`);
      const modeSettings = getModeSettings(config.promptMode);

      if (modeSettings.autoScrollPanel && root) {
        const page = root.closest('.cgpt-toolbox-page');

        if (page) {
          page.scrollTop = page.scrollHeight;
        }
      }

      updateStatus();
    }

    function readAdvancedConfigOnly() {
      readCurrentModeSettingsFromUi(config.promptMode);
      debouncedSaveConfig();
    }

    function readPanelConfig(mode = config.promptMode) {
      const m = normalizeAutoMode(mode);
      const currentMode = normalizeAutoMode(config.promptMode);

      if (m === 'task' && currentMode === 'task') {
        readTaskProfileDefaultsIntoActive();
        readTaskEditorIntoSelected();
      } else if (promptsEl && m === currentMode) {
        setPromptsTextByMode(m, promptsEl.value);
      }

      readCurrentModeSettingsFromUi(currentMode);
      normalizeListProfiles();
      normalizeTaskProfiles();
      saveConfig();
    }

    function renderListProfiles() {
      if (!listProfilesEl) return;

      normalizeListProfiles();
      renderListPanelVisibility();

      listProfilesEl.innerHTML = config.listProfiles.map((item) => {
        const active = item.id === config.activeListProfileId ? ' active' : '';

        return `
      <button type="button"
        class="cgpt-chip-btn cgpt-autoq-list-chip${active}"
        data-list-id="${escapeHtml(item.id)}"
        title="${escapeHtml(item.name)}">
        ${escapeHtml(item.name)}
      </button>
    `;
      }).join('');

      const active = getActiveListProfile();

      if (listProfileNameEl && active && document.activeElement !== listProfileNameEl) {
        listProfileNameEl.value = active.name;
      }
    }

    function switchListProfile(profileId) {
      normalizeListProfiles();

      const target = config.listProfiles.find((item) => item.id === profileId);

      if (!target) {
        console.warn('[ChatGPT toolbox] switchListProfile: profile not found', profileId);
        ToolboxShell.setStatus('列表模板不存在');
        return;
      }

      readPanelConfig(config.promptMode);

      config.activeListProfileId = target.id;
      config.listPromptsText = String(target.text || '');

      if (config.promptMode === 'list') {
        refreshPromptTextareaForMode('list');
      }
      renderListProfiles();
      saveConfig();
      updateStatus();

      ToolboxShell.setStatus(`已切换列表：${target.name}`);
      ToolboxShell.appendLog(`[自动指令] 已切换列表模板：${target.name}`);
    }

    function createListProfileInline() {
      readPanelConfig(config.promptMode);
      normalizeListProfiles();

      const profile = {
        id: createId('autoq_list'),
        name: buildAutoQueueListName(),
        text: '',
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };

      config.listProfiles.push(profile);
      config.activeListProfileId = profile.id;
      config.listPromptsText = '';

      if (config.promptMode !== 'list') {
        switchPromptMode('list');
      } else {
        refreshPromptTextareaForMode('list');
      }
      renderListProfiles();
      saveConfig();
      updateStatus();

      if (listProfileNameEl) {
        listProfileNameEl.focus();
        listProfileNameEl.select();
      }

      ToolboxShell.setStatus(`已新建列表：${profile.name}`);
      ToolboxShell.appendLog(`[自动指令] 已新建列表：${profile.name}`);
    }

    function renameActiveListProfileInline() {
      normalizeListProfiles();

      const active = getActiveListProfile();

      if (!active) {
        ToolboxShell.setStatus('当前没有可重命名的列表');
        return;
      }

      const text = String(listProfileNameEl ? listProfileNameEl.value : '').trim();

      if (!text) {
        ToolboxShell.setStatus('列表名称不能为空');
        console.warn('[ChatGPT toolbox] renameActiveListProfileInline: empty name');
        return;
      }

      const nextName = text.slice(0, 24);

      if (config.listProfiles.some((item) => item.id !== active.id && item.name === nextName)) {
        ToolboxShell.setStatus('列表名称已存在');
        return;
      }

      active.name = nextName;
      active.updatedAt = nowMs();

      renderListProfiles();
      saveConfig();

      ToolboxShell.setStatus(`已保存列表名称：${active.name}`);
    }

    function deleteActiveListProfileInline(button) {
      try {
        readPanelConfig(config.promptMode);
        normalizeListProfiles();

        if (config.listProfiles.length <= 1) {
          ToolboxShell.setStatus('至少保留一个列表');
          return;
        }

        const active = getActiveListProfile();

        if (!active) {
          ToolboxShell.setStatus('当前没有可删除的列表');
          return;
        }

        const now = Date.now();

        if (now > listProfileDeleteConfirmUntil) {
          listProfileDeleteConfirmUntil = now + 3000;

          if (button) {
            setButtonDanger(button, '再次点击删除', { reason: 'list-delete-confirm' });
          }

          ToolboxShell.setStatus('再次点击确认删除当前列表');
          return;
        }

        listProfileDeleteConfirmUntil = 0;

        const deletedName = active.name;

        config.listProfiles = config.listProfiles.filter((item) => item.id !== active.id);
        config.activeListProfileId = config.listProfiles[0].id;

        const next = getActiveListProfile();

        if (next) {
          config.listPromptsText = String(next.text || '');
        }

        refreshPromptTextareaForMode('list');

        if (button) {
          setButtonIdle(button, '删除列表', { reason: 'list-delete-done' });
        }

        renderListProfiles();
        saveConfig();
        updateStatus();

        ToolboxShell.setStatus(`已删除列表：${deletedName}`);
      } catch (error) {
        console.error('[AUTOQ][LIST_DELETE_FAILED]', error);
        if (button) {
          setButtonFailed(button, '删除失败', { reason: 'list-delete-failed' });
          window.setTimeout(() => {
            if (button.isConnected) {
              setButtonIdle(button, '删除列表', { reason: 'list-delete-restore' });
            }
          }, 1200);
        }
        ToolboxShell.setStatus('删除列表失败', 'error');
      }
    }

    function ensureSelectedTaskId(profile) {
      if (!profile || !Array.isArray(profile.tasks) || !profile.tasks.length) {
        selectedTaskId = '';
        return;
      }

      const exists = profile.tasks.some((item) => item.id === selectedTaskId);

      if (!exists) {
        selectedTaskId = profile.tasks[0].id;
      }
    }

    function getSelectedTask(profile) {
      if (!profile) return null;

      ensureSelectedTaskId(profile);

      return profile.tasks.find((item) => item.id === selectedTaskId) || null;
    }

    function renderTaskProfiles() {
      normalizeTaskProfiles();
      renderTaskPanelVisibility();
      refreshBatchTaskPanelRefs();

      if (!taskProfilesEl) return;

      taskProfilesEl.innerHTML = config.taskProfiles.map((item) => {
        const active = item.id === config.activeTaskProfileId ? ' active' : '';

        return `
      <button type="button"
        class="cgpt-chip-btn cgpt-autoq-task-chip${active}"
        data-task-profile-id="${escapeHtml(item.id)}"
        title="${escapeHtml(item.name)}">
        ${escapeHtml(item.name)}
      </button>
    `;
      }).join('');

      const active = getActiveTaskProfile();

      if (taskProfileNameEl && active && document.activeElement !== taskProfileNameEl) {
        taskProfileNameEl.value = active.name;
      }

      if (config.promptMode === 'task') {
        renderBatchTaskGroupContent();
      }
    }

    function resolveProfileContinuePreviewDoneSignal(profile, doneEl) {
      const raw = doneEl
        ? String(doneEl.value || '').trim()
        : String(profile && profile.defaultDoneSignal || '').trim();
      return typeof normalizeDoneSignal === 'function'
        ? normalizeDoneSignal(raw || TASK_DONE_SIGNAL)
        : (raw || TASK_DONE_SIGNAL);
    }

    function readTaskProfileDefaultsIntoActive() {
      if (!taskProfileDefaultsEl) return;

      const profile = getActiveTaskProfile();

      if (!profile) return;

      const continueEl = qs('#cgpt-autoq-profile-default-continue', taskProfileDefaultsEl);
      const doneEl = qs('#cgpt-autoq-profile-default-done-signal', taskProfileDefaultsEl);
      const maxEl = qs('#cgpt-autoq-profile-default-max-rounds', taskProfileDefaultsEl);

      if (continueEl) {
        const rawTemplate = String(continueEl.value || '');
        profile.continuePromptTemplate = typeof getContinuePromptTemplateForDisplay === 'function'
          ? getContinuePromptTemplateForDisplay(
            rawTemplate,
            null,
            'profile.continuePromptTemplate',
          )
          : rawTemplate;
        delete profile.defaultContinuePrompt;
        delete profile.continuePrompt;
      }
      if (doneEl) {
        const nextDone = String(doneEl.value || '').trim();
        profile.defaultDoneSignal = typeof normalizeDoneSignal === 'function'
          ? normalizeDoneSignal(nextDone || TASK_DONE_SIGNAL)
          : (nextDone || TASK_DONE_SIGNAL);
      }
      if (maxEl) {
        profile.defaultMaxContinueRounds = normalizeContinueRoundLimit(
          maxEl.value,
          UNLIMITED_CONTINUE_ROUNDS,
        );
        profile.defaultMaxContinueRoundsMigratedToUnlimited = true;
      }

      const rateEnabledEl = qs('#cgpt-autoq-task-rate-limit-enabled', taskProfileDefaultsEl);
      const rateWindowEl = qs('#cgpt-autoq-task-rate-limit-window-minutes', taskProfileDefaultsEl);
      const rateMaxEl = qs('#cgpt-autoq-task-rate-limit-max-messages', taskProfileDefaultsEl);

      if (!config.taskQueueSettings || typeof config.taskQueueSettings !== 'object') {
        config.taskQueueSettings = createDefaultTaskQueueSettings();
      }

      if (rateEnabledEl) {
        config.taskQueueSettings.taskSendRateLimitEnabled = rateEnabledEl.checked === true;
      }

      if (rateWindowEl) {
        config.taskQueueSettings.taskSendRateLimitWindowMinutes = Math.max(
          1,
          Math.floor(Number(rateWindowEl.value) || 180),
        );
      }

      if (rateMaxEl) {
        config.taskQueueSettings.taskSendRateLimitMaxMessages = Math.max(
          1,
          Math.floor(Number(rateMaxEl.value) || 150),
        );
      }

      const uploadRateEnabledEl = qs('#cgpt-autoq-task-upload-rate-limit-enabled', taskProfileDefaultsEl);
      const uploadRateWindowEl = qs('#cgpt-autoq-task-upload-rate-limit-window-minutes', taskProfileDefaultsEl);
      const uploadRateMaxEl = qs('#cgpt-autoq-task-upload-rate-limit-max-files', taskProfileDefaultsEl);

      if (uploadRateEnabledEl) {
        config.taskQueueSettings.taskUploadRateLimitEnabled = uploadRateEnabledEl.checked === true;
      }

      if (uploadRateWindowEl) {
        config.taskQueueSettings.taskUploadRateLimitWindowMinutes = Math.max(
          1,
          Math.floor(Number(uploadRateWindowEl.value) || 180),
        );
      }

      if (uploadRateMaxEl) {
        config.taskQueueSettings.taskUploadRateLimitMaxFiles = Math.max(
          1,
          Math.floor(Number(uploadRateMaxEl.value) || 80),
        );
      }

      const autoUploadEnabledEl = qs('#cgpt-autoq-task-auto-upload-enabled', taskProfileDefaultsEl);
      const autoUploadIntervalEl = qs('#cgpt-autoq-task-auto-upload-interval', taskProfileDefaultsEl);

      if (autoUploadEnabledEl) {
        config.taskQueueSettings.taskAutoUploadEveryNMessagesEnabled = autoUploadEnabledEl.checked === true;
      }

      if (autoUploadIntervalEl) {
        config.taskQueueSettings.taskAutoUploadEveryNMessages = Math.max(
          1,
          Math.floor(Number(autoUploadIntervalEl.value) || 5),
        );
      }

      const rotateEnabledEl = qs('#cgpt-autoq-task-rotate-new-chat-enabled', taskProfileDefaultsEl);
      const rotateThresholdEl = qs('#cgpt-autoq-task-rotate-new-chat-threshold', taskProfileDefaultsEl);
      const rotateForceUploadEl = qs('#cgpt-autoq-task-rotate-force-upload', taskProfileDefaultsEl);

      if (rotateEnabledEl) {
        config.taskQueueSettings.taskRotateNewChatByPageTurnEnabled = rotateEnabledEl.checked === true;
      }

      if (rotateThresholdEl) {
        config.taskQueueSettings.taskRotateNewChatPageTurnThreshold = Math.max(
          1,
          Math.floor(Number(rotateThresholdEl.value) || 30),
        );
      }

      if (rotateForceUploadEl) {
        config.taskQueueSettings.taskRotateForceUploadAfterNewChat = rotateForceUploadEl.checked === true;
      }

      profile.updatedAt = nowMs();
      saveConfig();
    }

    const debouncedReadTaskProfileDefaults = debounceSave(readTaskProfileDefaultsIntoActive, 400);

    function updateTaskProfileContinuePreview() {
      if (!taskProfileDefaultsEl) return;

      const profile = getActiveTaskProfile();
      const previewEl = qs('#cgpt-autoq-profile-continue-preview', taskProfileDefaultsEl);
      const continueEl = qs('#cgpt-autoq-profile-default-continue', taskProfileDefaultsEl);
      const doneEl = qs('#cgpt-autoq-profile-default-done-signal', taskProfileDefaultsEl);

      if (!profile || !previewEl) return;

      const rawTemplate = continueEl
        ? String(continueEl.value || '')
        : String(profile.continuePromptTemplate || BATCH_CONTINUE_TEMPLATE);
      const template = typeof getContinuePromptTemplateForDisplay === 'function'
        ? getContinuePromptTemplateForDisplay(
          rawTemplate,
          null,
          'profile.continuePromptTemplate',
        )
        : rawTemplate;
      const doneSignal = resolveProfileContinuePreviewDoneSignal(profile, doneEl);
      const previewText = typeof renderContinuePromptTemplate === 'function'
        ? renderContinuePromptTemplate(template, doneSignal)
        : template;

      previewEl.textContent = previewText;
    }

    function renderTaskProfileDefaults() {
      if (!taskProfileDefaultsEl) return;

      const profile = getActiveTaskProfile();

      if (!profile) {
        taskProfileDefaultsEl.innerHTML = '<div class="cgpt-hint">暂无任务组</div>';
        return;
      }

      const activeContinueEl = document.activeElement;
      const activeContinueId = activeContinueEl && activeContinueEl.id
        ? activeContinueEl.id
        : '';
      const rawTemplateText = String(
        profile.continuePromptTemplate || BATCH_CONTINUE_TEMPLATE,
      );
      const templateText = typeof getContinuePromptTemplateForDisplay === 'function'
        ? getContinuePromptTemplateForDisplay(
          rawTemplateText,
          null,
          'profile.continuePromptTemplate',
        )
        : rawTemplateText;
      const displayDoneSignal = typeof repairCorruptedDoneSignalText === 'function'
        ? repairCorruptedDoneSignalText(profile.defaultDoneSignal, null)
        : (profile.defaultDoneSignal || TASK_DONE_SIGNAL);
      const previewDoneSignal = typeof normalizeDoneSignal === 'function'
        ? normalizeDoneSignal(displayDoneSignal)
        : displayDoneSignal;
      const previewText = typeof renderContinuePromptTemplate === 'function'
        ? renderContinuePromptTemplate(templateText, previewDoneSignal)
        : templateText;

      taskProfileDefaultsEl.innerHTML = `
        <div class="cgpt-hint cgpt-autoq-task-batch-hint">统一继续指令与默认终止信号将应用于本任务组内所有任务（除非任务单独覆盖）。</div>
        <div class="cgpt-autoq-task-profile-defaults-grid">
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label for="cgpt-autoq-profile-default-continue">统一继续指令（模板，使用 {{DONE_SIGNAL}} 占位符）</label>
            <textarea class="cgpt-textarea cgpt-autoq-batch-rules-continue" id="cgpt-autoq-profile-default-continue" rows="5">${escapeHtml(templateText)}</textarea>
          </div>
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label>实际发送预览</label>
            <pre class="cgpt-autoq-continue-preview cgpt-autoq-batch-rules-preview" id="cgpt-autoq-profile-continue-preview">${escapeHtml(previewText)}</pre>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-profile-default-done-signal">默认终止信号</label>
            <input class="cgpt-input" id="cgpt-autoq-profile-default-done-signal" value="${escapeHtml(displayDoneSignal)}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-profile-default-max-rounds">默认最大继续次数（0 表示无限）</label>
            <input class="cgpt-input" id="cgpt-autoq-profile-default-max-rounds" type="number" data-no-wheel-number="1" min="0" value="${normalizeContinueRoundLimit(profile.defaultMaxContinueRounds, UNLIMITED_CONTINUE_ROUNDS)}" placeholder="0 = 无限">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rate-limit-enabled">批量发送限速</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-rate-limit-enabled" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskSendRateLimitEnabled !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rate-limit-window-minutes">限速窗口（分钟）</label>
            <input class="cgpt-input" id="cgpt-autoq-task-rate-limit-window-minutes" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskSendRateLimitWindowMinutes) || 180))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rate-limit-max-messages">窗口内最多发送条数</label>
            <input class="cgpt-input" id="cgpt-autoq-task-rate-limit-max-messages" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskSendRateLimitMaxMessages) || 150))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>限速说明</label>
            <div class="cgpt-hint">默认 180 分钟最多 150 条，平均约 72 秒/条，低于 3 小时 160 条上限。</div>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-upload-rate-limit-enabled">批量上传限速</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-upload-rate-limit-enabled" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskUploadRateLimitEnabled !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-upload-rate-limit-window-minutes">上传限速窗口（分钟）</label>
            <input class="cgpt-input" id="cgpt-autoq-task-upload-rate-limit-window-minutes" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskUploadRateLimitWindowMinutes) || 180))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-upload-rate-limit-max-files">窗口内最多上传文件数</label>
            <input class="cgpt-input" id="cgpt-autoq-task-upload-rate-limit-max-files" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskUploadRateLimitMaxFiles) || 80))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>上传限速说明</label>
            <div class="cgpt-hint">默认 180 分钟最多 80 个文件，平均约 135 秒/文件。自动上传会按剩余额度拆分上传队列。</div>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-auto-upload-enabled">每 N 次对话自动上传</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-auto-upload-enabled" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskAutoUploadEveryNMessagesEnabled !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-auto-upload-interval">自动上传间隔</label>
            <input class="cgpt-input" id="cgpt-autoq-task-auto-upload-interval" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskAutoUploadEveryNMessages) || 5))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>自动上传说明</label>
            <div class="cgpt-hint">默认每 5 次批量任务组对话上传一次文件。达到次数后，会在下一次发送前先上传文件。</div>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rotate-new-chat-enabled">页面过长自动换新聊天</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-rotate-new-chat-enabled" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskRotateNewChatByPageTurnEnabled !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rotate-new-chat-threshold">换新聊天阈值</label>
            <input class="cgpt-input" id="cgpt-autoq-task-rotate-new-chat-threshold" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskRotateNewChatPageTurnThreshold) || 30))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-rotate-force-upload">换新聊天后先上传</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-rotate-force-upload" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskRotateForceUploadAfterNewChat !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>换新聊天说明</label>
            <div class="cgpt-hint">默认当前页面达到 30 轮后，下一次发送前自动切到新聊天，先上传文件，再重新发送当前任务问题，避免长页面卡顿。</div>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>限速记录</label>
            <button type="button" class="cgpt-btn cgpt-btn-secondary" id="cgpt-autoq-task-rate-limit-clear">清空发送限速记录</button>
            <button type="button" class="cgpt-btn cgpt-btn-secondary" id="cgpt-autoq-task-upload-rate-limit-clear">清空上传限速记录</button>
          </div>
        </div>`;

      const continueEl = qs('#cgpt-autoq-profile-default-continue', taskProfileDefaultsEl);

      if (continueEl) {
        continueEl.addEventListener('input', () => {
          updateTaskProfileContinuePreview();
        });
      }

      const doneSignalEl = qs('#cgpt-autoq-profile-default-done-signal', taskProfileDefaultsEl);
      if (doneSignalEl) {
        doneSignalEl.addEventListener('input', () => {
          updateTaskProfileContinuePreview();
          debouncedReadTaskProfileDefaults();
        });
        doneSignalEl.addEventListener('change', () => {
          readTaskProfileDefaultsIntoActive();
          updateTaskProfileContinuePreview();
        });
      }

      qsa('input, textarea', taskProfileDefaultsEl).forEach((el) => {
        if (el.id === 'cgpt-autoq-profile-default-continue'
          || el.id === 'cgpt-autoq-profile-default-done-signal') {
          return;
        }

        el.addEventListener('change', () => {
          readTaskProfileDefaultsIntoActive();
          updateTaskProfileContinuePreview();
          renderTaskList();
        });
      });

      if (continueEl) {
        continueEl.addEventListener('change', () => {
          readTaskProfileDefaultsIntoActive();
          updateTaskProfileContinuePreview();
          renderTaskList();
        });
      }

      const clearRateLimitBtn = qs('#cgpt-autoq-task-rate-limit-clear', taskProfileDefaultsEl);
      if (clearRateLimitBtn) {
        clearRateLimitBtn.addEventListener('click', () => {
          if (
            typeof UploadModule !== 'undefined'
            && typeof UploadModule.clearMessageQuotaRecords === 'function'
          ) {
            UploadModule.clearMessageQuotaRecords('manual-button');
          } else {
            clearTaskSendRateHistory('manual-button');
          }
          updateStatus('task-rate-limit-clear');
        });
      }

      const clearUploadRateLimitBtn = qs('#cgpt-autoq-task-upload-rate-limit-clear', taskProfileDefaultsEl);
      if (clearUploadRateLimitBtn) {
        clearUploadRateLimitBtn.addEventListener('click', () => {
          if (
            typeof UploadModule !== 'undefined'
            && typeof UploadModule.clearUploadQuotaRecords === 'function'
          ) {
            UploadModule.clearUploadQuotaRecords('manual-button');
          } else {
            clearTaskUploadRateHistory('manual-button');
          }
          updateStatus('task-upload-rate-limit-clear');
        });
      }

      if (activeContinueId) {
        const restoreEl = qs(`#${activeContinueId}`, taskProfileDefaultsEl);

        if (restoreEl && typeof restoreEl.focus === 'function') {
          restoreEl.focus();
        }
      }
    }

    function renderTaskList() {
      if (!taskListEl) return;

      const profile = getActiveTaskProfile();

      if (!profile) {
        taskListEl.innerHTML = '<div class="cgpt-hint">暂无任务组</div>';
        return;
      }

      ensureSelectedTaskId(profile);

      if (!profile.tasks.length) {
        taskListEl.innerHTML = '<div class="cgpt-hint">暂无任务，请点击「新增任务」</div>';
        return;
      }

      taskListEl.innerHTML = profile.tasks.map((task, index) => {
        const selected = task.id === selectedTaskId ? ' active' : '';
        const enabledMark = task.enabled ? '' : '（禁用）';
        const titleText = `${String(task.title || '未命名任务')}${enabledMark}`;
        const statusLabel = String(task.status || 'pending');
        const resolved = resolveTaskContinueSettings(task, profile);
        const maxRounds = normalizeContinueRoundLimit(
          resolved.actualMaxContinueRounds,
          UNLIMITED_CONTINUE_ROUNDS,
        );
        const maxRoundsText = formatContinueRoundLimit(maxRounds);
        const metaText = `${statusLabel} · 继续 ${Number(task.continueCount) || 0}/${maxRoundsText}`;
        const sourceText = formatTaskListSourceText(task);
        const categoryText = formatTaskListCategoryText(task);

        return `
      <div class="cgpt-autoq-task-item${selected}" data-task-id="${escapeHtml(task.id)}">
        <div class="cgpt-autoq-task-item-main cgpt-autoq-task-item-main-inline">
          <span class="cgpt-autoq-task-item-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</span>
          <span class="cgpt-autoq-task-item-meta">${escapeHtml(metaText)}</span>
          <span class="cgpt-autoq-task-item-source">${escapeHtml(sourceText)}</span>
          <span class="cgpt-autoq-task-item-category">${escapeHtml(categoryText)}</span>
        </div>
        <div class="cgpt-autoq-task-item-actions">
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">编辑</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="top" data-task-id="${escapeHtml(task.id)}" ${index === 0 ? 'disabled' : ''}>置顶</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="up" data-task-id="${escapeHtml(task.id)}" ${index === 0 ? 'disabled' : ''}>上移</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="down" data-task-id="${escapeHtml(task.id)}" ${index === profile.tasks.length - 1 ? 'disabled' : ''}>下移</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="bottom" data-task-id="${escapeHtml(task.id)}" ${index === profile.tasks.length - 1 ? 'disabled' : ''}>置底</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="toggle" data-task-id="${escapeHtml(task.id)}">${task.enabled ? '禁用' : '启用'}</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="delete" data-task-id="${escapeHtml(task.id)}">删除</button>
        </div>
      </div>`;
      }).join('');
    }

    function readTaskEditorIntoSelected() {
      if (!taskEditorEl) return;

      try {
        const profile = getActiveTaskProfile();
        const task = getSelectedTask(profile);

        if (!task) return;

        const titleEl = qs('#cgpt-autoq-task-title', taskEditorEl);
        const initialEl = qs('#cgpt-autoq-task-initial', taskEditorEl);
        const continueOverrideEl = qs('#cgpt-autoq-task-continue-override', taskEditorEl);
        const continueEl = qs('#cgpt-autoq-task-continue', taskEditorEl);
        const doneEl = qs('#cgpt-autoq-task-done-signal', taskEditorEl);
        const maxEl = qs('#cgpt-autoq-task-max-rounds', taskEditorEl);
        const enabledEl = qs('#cgpt-autoq-task-enabled', taskEditorEl);

        const promptLinkState = getPromptTaskLinkState(task);
        const isPromptLinkedTask = promptLinkState.isPromptTask && promptLinkState.linked;

        if (titleEl) task.title = String(titleEl.value || '').trim() || '未命名任务';
        if (initialEl && !isPromptLinkedTask) {
          task.initialPrompt = String(initialEl.value || '');
        }
        if (continueOverrideEl && continueOverrideEl.checked) {
          if (continueEl) {
            task.continuePromptTemplate = String(continueEl.value || '');
          }
        } else {
          task.continuePromptTemplate = '';
        }
        delete task.continuePrompt;
        if (doneEl) {
          task.doneSignal = String(doneEl.value || '').trim();
        }
        if (maxEl) {
          task.maxContinueRounds = normalizeContinueRoundLimit(maxEl.value, UNLIMITED_CONTINUE_ROUNDS);
        }
        if (enabledEl) task.enabled = !!enabledEl.checked;
        task.updatedAt = nowMs();
        saveConfig();
        renderTaskList();
      } catch (error) {
        const errText = getErrorText(error);
        console.error('[AUTOQ][TASK][SAVE_EDITOR]', error);
        ToolboxShell.appendLog(`[AUTOQ][TASK][SAVE_EDITOR] error=${errText}`);
        ToolboxShell.setStatus(`保存任务失败：${errText}`);
      }
    }

    function renderTaskEditor() {
      if (!taskEditorEl) return;

      const profile = getActiveTaskProfile();
      const task = getSelectedTask(profile);

      if (!task) {
        taskEditorEl.innerHTML = '<div class="cgpt-hint">请先在任务列表中选择一个任务</div>';
        return;
      }

      const hasContinueOverride = String(task.continuePromptTemplate || '').trim().length > 0;
      const profileDoneSignal = typeof repairCorruptedDoneSignalText === 'function'
        ? repairCorruptedDoneSignalText(profile && profile.defaultDoneSignal, null)
        : String(profile && profile.defaultDoneSignal || TASK_DONE_SIGNAL);
      const profileMaxRounds = formatContinueRoundLimit(
        profile && profile.defaultMaxContinueRounds,
      );
      const resolvedInitial = resolveTaskInitialPrompt(task, { log: false });
      const promptLinkState = getPromptTaskLinkState(task);

      const isPromptLinkedTask = promptLinkState.isPromptTask && promptLinkState.linked;
      const isPromptSnapshotTask = promptLinkState.isPromptTask && promptLinkState.missing;

      const initialFieldValue = isPromptLinkedTask
        ? resolvedInitial.initialPrompt
        : String(task.initialPrompt || resolvedInitial.initialPrompt || '');

      const initialReadonly = isPromptLinkedTask ? ' readonly' : '';

      const initialLabelSuffix = isPromptLinkedTask
        ? '（来自 Prompt 管理，运行前自动同步；如需修改，请到 Prompt 管理中编辑，或先转为独立任务）'
        : (isPromptSnapshotTask
          ? '（原 Prompt 已删除，当前为快照，可直接编辑）'
          : '');

      const detachBtnHtml = (isPromptLinkedTask || isPromptSnapshotTask)
        ? `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-detach-prompt">${isPromptLinkedTask ? '转为独立任务' : '解除失效关联'}</button>`
        : '';

      taskEditorEl.innerHTML = `
        <div class="cgpt-autoq-task-editor-grid">
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label for="cgpt-autoq-task-title">任务名称</label>
            <input class="cgpt-input" id="cgpt-autoq-task-title" value="${escapeHtml(resolvedInitial.title || task.title)}">
          </div>
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label for="cgpt-autoq-task-initial">初始指令${escapeHtml(initialLabelSuffix)}</label>
            <textarea class="cgpt-textarea cgpt-autoq-task-initial-field" id="cgpt-autoq-task-initial" rows="6"${initialReadonly}>${escapeHtml(initialFieldValue)}</textarea>
          </div>
          <label class="cgpt-checkbox-line cgpt-autoq-task-editor-full">
            <input type="checkbox" id="cgpt-autoq-task-enabled" ${task.enabled ? 'checked' : ''}>
            启用此任务
          </label>
          <details class="cgpt-autoq-task-advanced cgpt-autoq-task-editor-full" open>
            <summary class="cgpt-autoq-task-advanced-summary">高级设置</summary>
            <div class="cgpt-autoq-task-advanced-body">
              <label class="cgpt-checkbox-line cgpt-autoq-task-editor-full">
                <input type="checkbox" id="cgpt-autoq-task-continue-override" ${hasContinueOverride ? 'checked' : ''}>
                为此任务单独设置继续指令
              </label>
              <div class="cgpt-kv cgpt-autoq-task-editor-full cgpt-autoq-task-continue-wrap${hasContinueOverride ? '' : ' cgpt-toolbox-hidden'}">
                <label for="cgpt-autoq-task-continue">任务级继续指令</label>
                <textarea class="cgpt-textarea" id="cgpt-autoq-task-continue" rows="4">${escapeHtml(task.continuePromptTemplate || '')}</textarea>
              </div>
              <div class="cgpt-kv">
                <label for="cgpt-autoq-task-done-signal">单独终止信号（留空继承任务组：${escapeHtml(profileDoneSignal)}）</label>
                <input class="cgpt-input" id="cgpt-autoq-task-done-signal" value="${escapeHtml(task.doneSignal)}" placeholder="留空继承任务组：${escapeHtml(profileDoneSignal)}">
              </div>
              <div class="cgpt-kv">
                <label for="cgpt-autoq-task-max-rounds">单独最大继续次数（0 继承任务组：${profileMaxRounds}）</label>
                <input class="cgpt-input" id="cgpt-autoq-task-max-rounds" type="number" data-no-wheel-number="1" min="0" value="${Number(task.maxContinueRounds) || 0}">
              </div>
            </div>
          </details>
        </div>
        <div class="cgpt-row cgpt-autoq-task-editor-actions">
          ${detachBtnHtml}
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-save">保存任务</button>
        </div>`;

      const detachBtn = qs('#cgpt-autoq-task-detach-prompt', taskEditorEl);

      if (detachBtn) {
        bindOnce(detachBtn, 'click', () => {
          const activeProfile = getActiveTaskProfile();
          const currentTask = getSelectedTask(activeProfile);

          const result = detachPromptTaskFromPromptManager(currentTask, 'editor-button');

          if (!result || !result.ok) {
            const reason = result && result.reason ? result.reason : 'unknown';
            ToolboxShell.appendLog(`[AUTOQ][PROMPT_TASK][DETACH_FAILED] reason=${reason}`);
            ToolboxShell.setStatus(`解除关联失败：${reason}`);
            return;
          }

          saveConfig();
          renderTaskList();
          renderTaskEditor();
          updateStatus();
          ToolboxShell.setStatus('已转为独立任务，可以直接编辑');
        });
      }

      const continueOverrideEl = qs('#cgpt-autoq-task-continue-override', taskEditorEl);
      const continueWrapEl = qs('.cgpt-autoq-task-continue-wrap', taskEditorEl);

      if (continueOverrideEl && continueWrapEl) {
        bindOnce(continueOverrideEl, 'change', () => {
          continueWrapEl.classList.toggle('cgpt-toolbox-hidden', !continueOverrideEl.checked);

          if (!continueOverrideEl.checked) {
            const continueEl = qs('#cgpt-autoq-task-continue', taskEditorEl);

            if (continueEl) {
              continueEl.value = '';
            }
          }

          readTaskEditorIntoSelected();
        });
      }

      qsa('input, textarea', taskEditorEl).forEach((el) => {
        if (el.id === 'cgpt-autoq-task-continue-override') {
          return;
        }

        el.addEventListener('change', () => {
          readTaskEditorIntoSelected();
        });
      });

      const saveBtn = qs('#cgpt-autoq-task-save', taskEditorEl);

      if (saveBtn) {
        bindOnce(saveBtn, 'click', () => {
          readTaskEditorIntoSelected();
          log(`已保存任务：${task.title}`);
          ToolboxShell.setStatus(`已保存任务：${task.title}`);
        });
      }
    }

    function switchTaskProfile(profileId) {
      normalizeTaskProfiles();

      const target = config.taskProfiles.find((item) => item.id === profileId);

      if (!target) {
        console.warn('[ChatGPT toolbox] switchTaskProfile: profile not found', profileId);
        ToolboxShell.setStatus('任务组不存在');
        return;
      }

      readTaskEditorIntoSelected();
      readTaskProfileDefaultsIntoActive();
      config.activeTaskProfileId = target.id;
      selectedTaskId = '';
      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();
      ToolboxShell.setStatus(`已切换任务组：${target.name}`);
    }

    function createTaskProfileInline() {
      readTaskEditorIntoSelected();
      readTaskProfileDefaultsIntoActive();
      normalizeTaskProfiles();

      const ts = nowMs();
      const profile = {
        id: createId('autoq_task_profile'),
        name: buildAutoQueueTaskProfileName(),
        ...createDefaultTaskProfileDefaults(),
        tasks: createDefaultExampleTasks(),
        createdAt: ts,
        updatedAt: ts,
      };

      config.taskProfiles.push(profile);
      config.activeTaskProfileId = profile.id;
      selectedTaskId = profile.tasks[0] ? profile.tasks[0].id : '';
      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();
      ToolboxShell.setStatus(`已新建任务组：${profile.name}`);
    }

    function renameActiveTaskProfileInline() {
      normalizeTaskProfiles();
      const active = getActiveTaskProfile();

      if (!active || !taskProfileNameEl) {
        ToolboxShell.setStatus('当前没有可保存的任务组');
        return;
      }

      const nextName = String(taskProfileNameEl.value || '').trim();

      if (!nextName) {
        ToolboxShell.setStatus('任务组名称不能为空');
        return;
      }

      if (config.taskProfiles.some((item) => item.id !== active.id && item.name === nextName)) {
        ToolboxShell.setStatus('任务组名称已存在');
        return;
      }

      active.name = nextName;
      active.updatedAt = nowMs();
      renderTaskProfiles();
      saveConfig();
      updateStatus();
      ToolboxShell.setStatus(`已保存任务组名称：${active.name}`);
    }

    function deleteActiveTaskProfileInline(button) {
      readTaskEditorIntoSelected();
      normalizeTaskProfiles();

      if (config.taskProfiles.length <= 1) {
        ToolboxShell.setStatus('至少保留一个任务组');
        return;
      }

      const active = getActiveTaskProfile();

      if (!active) {
        ToolboxShell.setStatus('当前没有可删除的任务组');
        return;
      }

      const now = Date.now();

      if (now > taskProfileDeleteConfirmUntil) {
        taskProfileDeleteConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击删除';
        }

        ToolboxShell.setStatus('再次点击确认删除当前任务组');
        return;
      }

      taskProfileDeleteConfirmUntil = 0;
      const deletedName = active.name;

      config.taskProfiles = config.taskProfiles.filter((item) => item.id !== active.id);
      config.activeTaskProfileId = config.taskProfiles[0].id;
      selectedTaskId = '';

      if (button) {
        button.textContent = '删除任务组';
      }

      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();
      ToolboxShell.setStatus(`已删除任务组：${deletedName}`);
    }

    function addTaskInline() {
      try {
        readTaskEditorIntoSelected();

        const profile = getActiveTaskProfile();

        if (!profile) {
          ToolboxShell.appendLog('[AUTOQ][TASK][ADD] failed: no active profile');
          ToolboxShell.setStatus('新增任务失败：未找到当前任务组');
          return;
        }

        const beforeCount = profile.tasks.length;
        const task = createDefaultTaskItem({
          id: createTaskId(),
          title: `任务 ${beforeCount + 1}`,
        });

        profile.tasks.push(task);
        profile.updatedAt = nowMs();
        selectedTaskId = task.id;
        renderTaskList();
        renderTaskEditor();
        saveConfig();
        updateStatus();

        const afterCount = profile.tasks.length;
        ToolboxShell.appendLog(
          `[AUTOQ][TASK][ADD] profileId=${profile.id} taskId=${task.id} taskTitle=${task.title} beforeCount=${beforeCount} afterCount=${afterCount}`,
        );
        ToolboxShell.setStatus(`已新增任务：${task.title}`);
      } catch (error) {
        const errText = getErrorText(error);
        console.error('[AUTOQ][TASK][ADD]', error);
        ToolboxShell.appendLog(`[AUTOQ][TASK][ADD] error=${errText}`);
        ToolboxShell.setStatus(`新增任务失败：${errText}`);
      }
    }

    function deleteTaskById(taskId) {
      const profile = getActiveTaskProfile();

      if (!profile) return;

      const target = profile.tasks.find((item) => item.id === taskId);

      if (!target) return;

      profile.tasks = profile.tasks.filter((item) => item.id !== taskId);
      profile.updatedAt = nowMs();

      if (selectedTaskId === taskId) {
        selectedTaskId = profile.tasks[0] ? profile.tasks[0].id : '';
      }

      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();
      ToolboxShell.setStatus(`已删除任务：${target.title}`);
    }

    function getCurrentTaskGroupTasks() {
      const profile = getActiveTaskProfile();
      return profile ? profile.tasks : null;
    }

    function getTaskListScrollContainer() {
      if (taskListEl instanceof HTMLElement) {
        return taskListEl;
      }

      return document.querySelector('#cgpt-autoq-task-list')
        || document.querySelector('.cgpt-autoq-task-list')
        || document.querySelector('#cgpt-toolbox-panel')
        || document.scrollingElement;
    }

    function moveTaskById(taskId, direction) {
      const tasks = getCurrentTaskGroupTasks();

      if (!tasks) {
        return {
          ok: false,
          reason: 'no_profile',
        };
      }

      const index = tasks.findIndex((task) => String(task.id) === String(taskId));

      if (index < 0) {
        return {
          ok: false,
          reason: 'task_not_found',
        };
      }

      if (direction === 'up') {
        if (index === 0) {
          return {
            ok: false,
            reason: 'already_first',
          };
        }

        const temp = tasks[index - 1];
        tasks[index - 1] = tasks[index];
        tasks[index] = temp;

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_MOVE_UP] task_id=${taskId} from=${index} to=${index - 1}`,
        );

        return {
          ok: true,
          from: index,
          to: index - 1,
        };
      }

      if (direction === 'down') {
        if (index >= tasks.length - 1) {
          return {
            ok: false,
            reason: 'already_last',
          };
        }

        const temp = tasks[index + 1];
        tasks[index + 1] = tasks[index];
        tasks[index] = temp;

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_MOVE_DOWN] task_id=${taskId} from=${index} to=${index + 1}`,
        );

        return {
          ok: true,
          from: index,
          to: index + 1,
        };
      }

      return {
        ok: false,
        reason: 'unknown_direction',
      };
    }

    function moveTaskToEdgeById(taskId, edge) {
      const tasks = getCurrentTaskGroupTasks();

      if (!tasks) {
        return {
          ok: false,
          reason: 'no_profile',
        };
      }

      const index = tasks.findIndex((task) => String(task.id) === String(taskId));

      if (index < 0) {
        return {
          ok: false,
          reason: 'task_not_found',
        };
      }

      if (edge === 'top') {
        if (index === 0) {
          return {
            ok: false,
            reason: 'already_first',
          };
        }

        const [task] = tasks.splice(index, 1);
        tasks.unshift(task);

        return {
          ok: true,
          from: index,
          to: 0,
        };
      }

      if (edge === 'bottom') {
        if (index >= tasks.length - 1) {
          return {
            ok: false,
            reason: 'already_last',
          };
        }

        const [task] = tasks.splice(index, 1);
        tasks.push(task);

        return {
          ok: true,
          from: index,
          to: tasks.length - 1,
        };
      }

      return {
        ok: false,
        reason: 'unknown_edge',
      };
    }

    function restoreMovedTaskButtonPosition(options) {
      const taskId = options.taskId;
      const direction = options.direction;
      const listEl = options.listEl;
      const beforeButtonRect = options.beforeButtonRect;

      if (!taskId || !listEl || !beforeButtonRect) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=missing_context task_id=${taskId || '-'} direction=${direction || '-'}`,
        );
        return;
      }

      const actionName = String(direction || '').trim();
      const selector = `button[data-task-action="${CSS.escape(actionName)}"][data-task-id="${CSS.escape(String(taskId))}"]`;
      const newButton = listEl.querySelector(selector) || document.querySelector(selector);

      if (!(newButton instanceof HTMLElement)) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=button_not_found task_id=${taskId} direction=${actionName} selector=${selector}`,
        );
        return;
      }

      const afterButtonRect = newButton.getBoundingClientRect();
      const deltaY = afterButtonRect.top - beforeButtonRect.top;

      if (Math.abs(deltaY) > 1) {
        listEl.scrollTop += deltaY;
      }

      if (typeof newButton.focus === 'function') {
        newButton.focus({
          preventScroll: true,
        });
      }

      ToolboxShell.appendLog(
        `[AUTO_QUEUE][TASK_MOVE][RESTORE_OK] task_id=${taskId} direction=${actionName} delta_y=${Math.round(deltaY)} scroll_top=${Math.round(listEl.scrollTop)}`,
      );
    }

    async function handleMoveTask(taskId, direction, event, buttonEl) {
      const button = buttonEl instanceof HTMLElement
        ? buttonEl
        : (event && event.target instanceof HTMLElement
          ? event.target.closest('[data-task-action]')
          : null);

      const listEl = getTaskListScrollContainer();

      const beforeButtonRect = button
        ? button.getBoundingClientRect()
        : null;

      const beforeListScrollTop = listEl
        ? listEl.scrollTop
        : 0;

      ToolboxShell.appendLog(
        `[AUTO_QUEUE][TASK_MOVE][START] task_id=${taskId} direction=${direction} before_scroll_top=${beforeListScrollTop}`,
      );

      const moveResult = direction === 'top' || direction === 'bottom'
        ? moveTaskToEdgeById(taskId, direction)
        : moveTaskById(taskId, direction);

      if (!moveResult || !moveResult.ok) {
        const reason = moveResult && moveResult.reason ? moveResult.reason : 'unknown';
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][TASK_MOVE][SKIP] task_id=${taskId} direction=${direction} reason=${reason}`,
        );
        return;
      }

      const profile = getActiveTaskProfile();

      if (profile) {
        profile.updatedAt = nowMs();
      }

      saveConfig();
      renderTaskList();

      requestAnimationFrame(() => {
        restoreMovedTaskButtonPosition({
          taskId,
          direction,
          listEl,
          beforeButtonRect,
        });
      });
    }

    function toggleTaskEnabled(taskId) {
      const profile = getActiveTaskProfile();

      if (!profile) return;

      const task = profile.tasks.find((item) => item.id === taskId);

      if (!task) return;

      task.enabled = !task.enabled;
      task.updatedAt = nowMs();
      renderTaskList();
      renderTaskEditor();
      saveConfig();
      updateStatus();
    }

    function handleTaskListAction(e) {
      const row = e.target instanceof HTMLElement
        ? e.target.closest('.cgpt-autoq-task-item[data-task-id]')
        : null;
      const actionBtn = e.target instanceof HTMLElement
        ? e.target.closest('[data-task-action]')
        : null;

      if (row && !actionBtn) {
        const selectId = row.getAttribute('data-task-id');

        if (selectId) {
          readTaskEditorIntoSelected();
          selectedTaskId = selectId;
          renderTaskList();
          renderTaskEditor();
        }

        return;
      }

      if (!actionBtn) return;

      const taskId = actionBtn.getAttribute('data-task-id');
      const action = actionBtn.getAttribute('data-task-action');

      if (!taskId || !action) return;

      if (action === 'edit') {
        readTaskEditorIntoSelected();
        selectedTaskId = taskId;
        renderTaskList();
        renderTaskEditor();
        switchBatchSubTab('current');
        ToolboxShell.setStatus('已打开任务编辑');
        return;
      }

      if (action === 'delete') {
        deleteTaskById(taskId);
        return;
      }

      if (action === 'toggle') {
        toggleTaskEnabled(taskId);
        return;
      }

      if (action === 'up' || action === 'down' || action === 'top' || action === 'bottom') {
        if (actionBtn.hasAttribute('disabled')) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        void handleMoveTask(taskId, action, e, actionBtn);
      }
    }

    function getAutoQueueUploadStatusText() {
      const status = String(state.autoQueueUploadStatus || 'idle');
      const stats = state.autoQueueUploadStats || {};

      if (status === 'uploading') {
        return '上传中';
      }
      if (status === 'done') {
        return `上传完成，成功 ${Number(stats.uploaded) || 0} 个，失败 ${Number(stats.failed) || 0} 个`;
      }
      if (status === 'failed') {
        const reason = String(stats.reason || '').trim();
        return reason ? `上传失败：${reason}` : '上传失败';
      }
      if (status === 'blocked') {
        const reason = String(stats.reason || '').trim();
        return reason ? `暂不可上传：${reason}` : '暂不可上传';
      }
      if (status === 'no-files') {
        return '无文件';
      }
      return '未上传';
    }

    async function handleAutoQueueStartUpload() {
      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);

      if (state.uploadingFromAutoQueue) {
        const reason = 'already-uploading';
        ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][CLICK_IGNORED] reason=${reason} phase=${phase}`);
        log(`[AUTOQ][MANUAL_UPLOAD][CLICK_IGNORED] reason=${reason}`);
        state.autoQueueUploadStatus = 'uploading';
        updateStatus('start-upload-click-already-uploading');
        return;
      }

      if (state.running && config.promptMode === 'task') {
        const reason = 'batch-task-running';
        ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][CLICK_IGNORED] reason=${reason} phase=${phase}`);
        log(`[AUTOQ][MANUAL_UPLOAD][CLICK_IGNORED] reason=${reason} phase=${phase}`);

        state.autoQueueUploadStatus = 'blocked';
        state.autoQueueUploadStats = {
          uploaded: 0,
          failed: 0,
          skipped: 0,
          reason: '批量任务运行中，不能手动开始上传',
        };

        updateStatus('start-upload-click-blocked-running-task');
        return;
      }

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.startManualUploadOnlyFlow !== 'function'
      ) {
        const reason = 'UploadModule.startManualUploadOnlyFlow 不存在';
        console.error('[AUTOQ][MANUAL_UPLOAD][FAILED]', reason);
        ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${reason}`);
        log(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${reason}`);
        state.autoQueueUploadStatus = 'failed';
        state.autoQueueUploadStats = {
          uploaded: 0,
          failed: 0,
          skipped: 0,
          reason,
        };
        updateStatus();
        return;
      }

      state.uploadingFromAutoQueue = true;
      state.autoQueueUploadStatus = 'uploading';
      updateStatus();
      ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][START] phase=${phase}`);
      log(`[AUTOQ][MANUAL_UPLOAD][START] phase=${phase}`);

      try {
        const result = await UploadModule.startManualUploadOnlyFlow({
          source: 'autoqueue-start-upload-button',
          shouldStop: () => !state.uploadingFromAutoQueue,
        });

        const uploadedCount = Number(result && result.uploadedCount) || 0;
        const failedCount = Number(result && result.failedCount) || 0;
        const skippedCount = Number(result && result.skippedCount) || 0;
        const reason = String(result && result.reason || '').trim();

        state.autoQueueUploadStats = {
          uploaded: uploadedCount,
          failed: failedCount,
          skipped: skippedCount,
          reason,
        };

        if (reason === 'no-files') {
          log('[AUTOQ][MANUAL_UPLOAD][NO_FILES]');
          state.autoQueueUploadStatus = 'no-files';
        } else if (reason === 'cancelled' || (result && result.cancelled)) {
          log('[AUTOQ][MANUAL_UPLOAD][CANCELLED]');
          state.autoQueueUploadStatus = 'idle';
        } else if (result && result.ok) {
          log(`[AUTOQ][MANUAL_UPLOAD][DONE] uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount}`);
          ToolboxShell.appendLog(
            `[AUTOQ][MANUAL_UPLOAD][DONE] uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount}`,
          );
          state.autoQueueUploadStatus = 'done';
        } else {
          log(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${reason || 'upload-failed'}`);
          ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${reason || 'upload-failed'}`);
          state.autoQueueUploadStatus = 'failed';
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[AUTOQ][MANUAL_UPLOAD][FAILED]', error);
        ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${errText}`);
        log(`[AUTOQ][MANUAL_UPLOAD][FAILED] reason=${errText}`);
        state.autoQueueUploadStatus = 'failed';
        state.autoQueueUploadStats = {
          uploaded: 0,
          failed: 0,
          skipped: 0,
          reason: errText,
        };
      } finally {
        state.uploadingFromAutoQueue = false;
        const phaseAfter = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
        ToolboxShell.appendLog(`[AUTOQ][MANUAL_UPLOAD][PHASE_UNCHANGED] phase=${phaseAfter}`);
        log(`[AUTOQ][MANUAL_UPLOAD][PHASE_UNCHANGED] phase=${phaseAfter}`);
        updateStatus();
      }
    }

    let lastAutoqProgressStatusLogKey = '';

    function readPageTurnCount() {
      if (typeof getCurrentPageTurnCount === 'function') {
        return getCurrentPageTurnCount();
      }
      if (typeof getConversationTurnCount === 'function') {
        const live = Number(getConversationTurnCount());
        return Number.isFinite(live) && live > 0 ? Math.floor(live) : null;
      }
      return null;
    }

    function getTaskContinueStatusDisplay(task, profile) {
      const continueCount = task ? Math.max(0, Number(task.continueCount) || 0) : 0;
      let maxRaw = null;

      if (task) {
        const resolved = resolveTaskContinueSettings(task, profile, { log: false });
        maxRaw = resolved ? resolved.actualMaxContinueRounds : null;
      }

      const maxText = formatMaxContinueRoundsForStatus(maxRaw);

      const classifyStatus = state.taskRun && state.taskRun.lastReplyClassifyStatus
        ? String(state.taskRun.lastReplyClassifyStatus)
        : '-';
      const classifyReason = state.taskRun && state.taskRun.lastReplyClassifyReason
        ? String(state.taskRun.lastReplyClassifyReason)
        : '-';

      return {
        continueCount,
        maxText,
        maxRaw,
        classifyStatus,
        classifyReason,
        display: `${continueCount}/${maxText} · 终态 ${classifyStatus}`,
      };
    }

    function buildProgressStatusSnapshot() {
      const taskMode = config.promptMode === 'task';
      const taskInfo = taskMode ? getCurrentTaskRunInfo() : null;

      let taskProgress = '-';
      let taskCurrentIndex = 0;
      let taskDoneCount = 0;
      let taskTotal = 0;

      if (taskInfo && taskInfo.total) {
        taskTotal = Math.max(0, Number(taskInfo.total) || 0);
        taskDoneCount = Math.min(
          taskTotal,
          Math.max(0, Number(taskInfo.doneCount) || 0),
        );

        if (state.running) {
          taskCurrentIndex = Math.min(
            taskTotal,
            Math.max(1, Number(taskInfo.progressIndex) || taskDoneCount + 1),
          );

          taskProgress = `${taskCurrentIndex}/${taskTotal}（已完成 ${taskDoneCount}）`;
        } else {
          taskCurrentIndex = taskDoneCount;
          taskProgress = `${taskDoneCount}/${taskTotal}`;
        }
      }

      const pageTurn = readPageTurnCount();
      const pageTurnText = pageTurn === null ? '-' : String(pageTurn);
      const profile = getActiveTaskProfile();
      const displayTask = state.running
        ? getCurrentRunningTask()
        : (taskMode ? getSelectedTask(profile) : null);

      const continueStatus = taskMode
        ? getTaskContinueStatusDisplay(displayTask, profile)
        : {
          continueCount: 0,
          maxText: '-',
          maxRaw: null,
          display: '-',
        };

      const taskStepKey = state.taskRun && state.taskRun.currentStep
        ? state.taskRun.currentStep
        : 'idle';
      let taskStepText = taskMode ? getTaskRunStepLabel(taskStepKey) : '-';
      const sendRetryStepKeys = new Set(['send-wait-retry', 'send-initial-wait-retry']);
      if (taskMode && sendRetryStepKeys.has(taskStepKey) && state.taskRun) {
        const retryCount = Math.max(0, Number(state.taskRun.sendRetryCount) || 0);
        const retryReason = String(state.taskRun.lastSendRetryReason || '-');
        const nextAt = Number(state.taskRun.nextSendRetryAt) || 0;
        const secsLeft = nextAt > 0 ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : 0;
        taskStepText = `${taskStepText}；发送重试：第 ${retryCount} 次，原因 ${retryReason}，下次重试 ${secsLeft} 秒后`;
      }
      const messageRateLimitStatus = taskMode ? getTaskSendRateLimitStatus({ logSnapshot: true }) : null;
      const uploadRateLimitStatus = taskMode ? getTaskUploadRateLimitStatus(1, { logSnapshot: true }) : null;
      const rateLimitStatus = messageRateLimitStatus;
      const autoUploadSettings = taskMode ? getTaskAutoUploadSettings() : null;
      const autoUploadStrategy = taskMode ? getTaskAutoUploadStrategyDisplay() : null;
      const autoUploadDialogueCount = state.taskRun && state.taskRun.sentMessageCount != null
        ? Number(state.taskRun.sentMessageCount) || 0
        : 0;
      const taskTotalSentDialogueCount = state.taskRun && state.taskRun.totalSentDialogueCount != null
        ? Number(state.taskRun.totalSentDialogueCount) || 0
        : 0;
      const taskAutoUploadNextAt = autoUploadSettings && autoUploadSettings.enabled
        ? (() => {
          const interval = Math.max(1, Number(autoUploadSettings.interval) || 5);
          const nextNo = autoUploadDialogueCount + 1;
          if (shouldUploadFileForTaskMessageNo(nextNo, interval)) {
            return nextNo;
          }
          const offset = (interval - ((nextNo - 1) % interval)) % interval;
          return nextNo + (offset || interval);
        })()
        : 0;

      const rotationSettings = taskMode ? getTaskNewChatRotationSettings() : null;
      const currentPageDialogueCount = taskMode ? getTaskCurrentPageDialogueCount() : 0;
      const rotationCount = state.taskRun && state.taskRun.newChatRotationCount != null
        ? Number(state.taskRun.newChatRotationCount) || 0
        : 0;

      return {
        taskMode,
        taskInfo,
        taskProgress,
        taskCurrentIndex,
        taskDoneCount,
        taskTotal,
        pageTurn,
        pageTurnText,
        continueStatus,
        taskStepKey,
        taskStepText,
        messageRateLimitStatus,
        uploadRateLimitStatus,
        rateLimitStatus,
        autoUploadSettings,
        autoUploadStrategy,
        taskTotalSentDialogueCount,
        autoUploadDialogueCount,
        taskSentMessageCount: autoUploadDialogueCount,
        taskAutoUploadNextAt,
        rotationSettings,
        currentPageDialogueCount,
        rotationCount,
      };
    }

    function logAutoqProgressStatusIfChanged(snapshot, reason = '') {
      const key = [
        snapshot.taskProgress,
        snapshot.pageTurnText,
        snapshot.continueStatus.display,
        snapshot.taskStepKey,
      ].join('|');

      if (key === lastAutoqProgressStatusLogKey) {
        return;
      }

      lastAutoqProgressStatusLogKey = key;

      if (snapshot.pageTurn === null) {
        console.log('[AUTOQ][PROGRESS_STATUS][NO_PAGE_TURN]', {
          reason: reason || '-',
          step: snapshot.taskStepText,
        });
      }

      const taskIndex = snapshot.taskInfo && snapshot.taskInfo.total
        ? Math.min(
          Math.max(0, Number(snapshot.taskCurrentIndex) || 0),
          Number(snapshot.taskTotal) || Number(snapshot.taskInfo.total) || 0,
        )
        : 0;
      const taskTotal = snapshot.taskInfo
        ? Math.max(0, Number(snapshot.taskTotal) || Number(snapshot.taskInfo.total) || 0)
        : 0;
      const taskDoneCount = snapshot.taskInfo
        ? Math.min(taskTotal, Math.max(0, Number(snapshot.taskDoneCount) || 0))
        : 0;
      const maxContinueLog = isUnlimitedMaxContinueRounds(snapshot.continueStatus.maxRaw)
        ? 'unlimited'
        : String(snapshot.continueStatus.maxRaw);

      console.log(
        `[AUTOQ][PROGRESS_STATUS] task_index=${taskIndex} task_total=${taskTotal} task_done=${taskDoneCount} page_turn=${snapshot.pageTurn === null ? '-' : snapshot.pageTurn} continue_round=${snapshot.continueStatus.continueCount} max_continue=${maxContinueLog} step=${snapshot.taskStepText}${reason ? ` reason=${reason}` : ''}`,
      );
    }

    function updateStatus(refreshReason = '') {
      syncLegacyRunFlagsFromPhase();
      const running = !!state.running;
      const phase = String(state.phase || 'idle');
      const modeText = getModeDisplayText(config.promptMode);
      const listName = config.promptMode === 'list' ? getActiveListProfileName() : '';
      const progressSnapshot = buildProgressStatusSnapshot();
      logAutoqProgressStatusIfChanged(progressSnapshot, refreshReason);

      const taskInfo = progressSnapshot.taskInfo;
      const taskProgressRaw = progressSnapshot.taskProgress;
      const pageTurnText = progressSnapshot.pageTurnText;
      const continueStatus = progressSnapshot.continueStatus;
      const continueDisplay = formatStatusFraction(continueStatus.continueCount, continueStatus.maxText);
      const replyClassifyStatus = continueStatus.classifyStatus || '-';
      const replyClassifyReason = continueStatus.classifyReason || '-';
      const lastStopReasonText = state.lastTaskBatchStopReason
        ? String(state.lastTaskBatchStopReason.reason || '-')
        : '-';
      const lastStopClassifyHint = (
        lastStopReasonText === 'reply-classify-blocked'
        || lastStopReasonText === 'reply-classify-no-more-content'
      )
        ? `（终态 ${replyClassifyStatus}）`
        : '';
      const taskStepText = progressSnapshot.taskStepText;
      const messageRateLimit = progressSnapshot.messageRateLimitStatus
        || progressSnapshot.rateLimitStatus;
      const uploadRateLimit = progressSnapshot.uploadRateLimitStatus;
      const rateLimitDisplay = messageRateLimit
        ? messageRateLimit.display
        : '-';
      const uploadRateLimitDisplay = uploadRateLimit
        ? uploadRateLimit.display
        : '-';
      const taskTotalSentDialogueCount = Math.max(
        0,
        Number(progressSnapshot.taskTotalSentDialogueCount) || 0,
      );
      const taskSentDialogueDisplay = `${taskTotalSentDialogueCount} 次`;
      const sendRetryStepKeys = new Set(['send-wait-retry', 'send-initial-wait-retry']);
      const taskStepKeyForStatus = progressSnapshot.taskStepKey || 'idle';
      const inSendRetry = running && sendRetryStepKeys.has(taskStepKeyForStatus);
      let runStateText;

      if (phase === 'uploading') {
        runStateText = '上传中';
      } else if (phase === 'waiting_reply' || phase === 'reply_ready') {
        runStateText = '等待回复';
      } else if (phase === 'sending' || phase === 'sent') {
        runStateText = '发送中';
      } else if (running) {
        if (inSendRetry) {
          runStateText = '发送重试中';
        } else if (state.waitingReply) {
          runStateText = '等待回复';
        } else {
          runStateText = '运行中';
        }
      } else {
        runStateText = '已停止';
      }

      let taskProgress = '-';
      if (taskInfo && taskInfo.total) {
        const taskTotal = Math.max(0, Number(taskInfo.total) || 0);
        const taskDoneCount = Math.min(
          taskTotal,
          Math.max(0, Number(taskInfo.doneCount) || 0),
        );
        if (running) {
          const taskCurrentIndex = Math.min(
            taskTotal,
            Math.max(1, Number(taskInfo.progressIndex) || taskDoneCount + 1),
          );
          taskProgress = formatStatusFraction(taskCurrentIndex, taskTotal);
        } else {
          taskProgress = formatStatusFraction(taskDoneCount, taskTotal);
        }
      } else if (taskProgressRaw && taskProgressRaw !== '-') {
        taskProgress = formatQuotaDisplayText(taskProgressRaw);
      }

      const uploadStatusText = getAutoQueueUploadStatusText();
      const uploading = !!state.uploadingFromAutoQueue;
      const currentTask = typeof getCurrentRunningTask === 'function'
        ? getCurrentRunningTask()
        : null;
      const taskName = currentTask ? String(currentTask.title || '-') : '-';

      ensureMainLiteStructure();
      const panelContentEl = mainLiteEl ? qs('#cgpt-autoq-status-panel-content', mainLiteEl) : null;

      const panelHtml = config.promptMode === 'task'
        ? buildBatchTaskStatusPanelHtml({
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
          rateLimitDisplay,
          uploadRateLimitDisplay,
          progressSnapshot,
          taskName,
        })
        : buildLiteStatusPanelHtml({
          modeText,
          pageTurnText,
          listName,
          running,
        });

      if (panelContentEl) {
        panelContentEl.innerHTML = panelHtml;
      } else if (mainLiteEl) {
        mainLiteEl.innerHTML = '';
        ensureMainLiteStructure();
        const contentEl = qs('#cgpt-autoq-status-panel-content', mainLiteEl);
        if (contentEl) {
          contentEl.innerHTML = panelHtml;
        }
      }

      syncRuntimeTaskPhase();
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
        UploadModule.renderToolboxTopStatus();
      }

      const messageUsed = messageRateLimit ? Number(messageRateLimit.used) || 0 : '-';
      const uploadUsed = uploadRateLimit ? Number(uploadRateLimit.used) || 0 : '-';
      ToolboxShell.appendLog(
        `[STATUS][PANEL_RENDER] messageUsed=${messageUsed} uploadUsed=${uploadUsed} `
        + `pageTurn=${pageTurnText} totalSentDialogueCount=${taskTotalSentDialogueCount} `
        + `autoUploadDialogueCount=${Number(progressSnapshot.autoUploadDialogueCount) || 0} reason=${refreshReason || '-'}`,
      );
      ToolboxShell.appendLog(
        `[STATUS][TOP_RENDER] messageUsed=${messageUsed} uploadUsed=${uploadUsed} reason=${refreshReason || '-'}`,
      );

      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.renderRuntimeStats === 'function') {
        RuntimeStatsModule.renderRuntimeStats(false);
      }

      renderQueueActionButtons({ refreshReason, phase, running, uploading });

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.refreshUploadAutoContinueButton === 'function'
      ) {
        UploadModule.refreshUploadAutoContinueButton(refreshReason || 'autoq-update-status');
      }

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.refreshUploadAutoContinueUntilDoneButton === 'function'
      ) {
        UploadModule.refreshUploadAutoContinueUntilDoneButton(refreshReason || 'autoq-update-status');
      }

      renderSendOnceButton({ refreshReason });
    }

    function syncBatchTaskPhase() {
      const task = state.batchTask;
      const phaseName = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      task.currentTaskIndex = state.taskRun && Number.isFinite(state.taskRun.currentIndex)
        ? state.taskRun.currentIndex
        : -1;
      task.batchStep = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';
      task.stopRequested = !!state.batchTask.stopRequested;

      if (!state.running) {
        if (phaseName === AUTO_QUEUE_PHASES.DONE) {
          task.phase = 'completed';
        } else if (phaseName === AUTO_QUEUE_PHASES.FAILED) {
          task.phase = 'failed';
        } else if (phaseName === AUTO_QUEUE_PHASES.CANCELLED) {
          task.phase = 'cancelled';
        } else {
          task.phase = 'idle';
        }
        return task.phase;
      }

      if (task.stopRequested) {
        task.phase = 'cancelling';
        return task.phase;
      }

      if (phaseName === AUTO_QUEUE_PHASES.UPLOADING || state.uploadingFromAutoQueue) {
        task.phase = 'running';
        return task.phase;
      }

      if (phaseName === AUTO_QUEUE_PHASES.WAITING_REPLY || state.waitingReply) {
        task.phase = 'waiting_reply';
        return task.phase;
      }

      if (phaseName === AUTO_QUEUE_PHASES.SENDING) {
        task.phase = 'waiting_send';
        return task.phase;
      }

      task.phase = 'running';
      return task.phase;
    }

    function syncBatchButtonTask(reason = '') {
      syncBatchTaskPhase();

      if (typeof ButtonTasks === 'undefined' || typeof ButtonTasks.mirrorTaskSnapshot !== 'function') {
        return state.batchTask.phase;
      }

      const task = state.batchTask;
      const run = state.taskRun || {};
      const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;

      ButtonTasks.mirrorTaskSnapshot('batch', {
        phase: task.phase,
        runId: String(state.runId || state.autoQueueRunId || ''),
        cancelRequested: !!task.stopRequested,
        stopRequested: !!task.stopRequested,
        abortController: task.abortController || null,
        currentIndex: Number(task.currentTaskIndex),
        total,
        lastError: state.lastTaskBatchStopReason
          ? String(state.lastTaskBatchStopReason.reason || '')
          : null,
      });

      void reason;
      return task.phase;
    }

    function renderBatchControlButtons(context = {}) {
      renderQueueActionButtons(context);
    }

    function getAutoQueueStartIdleText() {
      return config.promptMode === 'task' ? '开始批量任务组' : '开始';
    }

    function isAutoQueueWaitingDelay() {
      const nextAt = Number(state.nextSendAt) || 0;
      return !!state.running
        && nextAt > Date.now()
        && String(state.phase || '') !== AUTO_QUEUE_PHASES.WAITING_REPLY
        && !state.waitingReply;
    }

    function renderSendOnceButton(context = {}) {
      const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;
      if (!sendOnceBtn || typeof setToolboxButtonState !== 'function') {
        return;
      }

      const task = state.sendOnceTask || { phase: 'idle' };
      const phase = String(task.phase || 'idle');
      const reason = String(context.refreshReason || 'update-status');
      const idleText = config.promptMode === 'task' ? '只发送初始指令一次' : '发送一次';

      if (!sendOnceBtn.dataset.cgptIdleText) {
        sendOnceBtn.dataset.cgptIdleText = idleText;
      }

      if (phase === 'sending') {
        setButtonSending(sendOnceBtn, '发送中...', {
          title: '正在发送一次，请勿重复点击',
          allowCancel: false,
          disabled: true,
          reason,
        });
        return;
      }

      if (phase === 'waiting_reply') {
        setButtonWaiting(sendOnceBtn, '等待回复', {
          title: '已发送，等待助手回复',
          allowCancel: false,
          disabled: true,
          reason,
        });
        return;
      }

      if (phase === 'success') {
        setButtonSuccess(sendOnceBtn, '已发送', {
          title: '发送一次已完成',
          disabled: true,
          reason,
        });
        return;
      }

      if (phase === 'failed') {
        const errHint = task.lastError ? String(task.lastError).slice(0, 40) : '';
        setButtonFailed(sendOnceBtn, errHint ? `失败：${errHint}` : '发送失败', {
          title: '发送一次失败',
          disabled: false,
          reason,
        });
        return;
      }

      setButtonIdle(sendOnceBtn, idleText, {
        title: '发送当前模式的第一条指令一次',
        reason,
      });
    }

    function setSendOnceTaskPhase(nextPhase, extra = {}) {
      if (!state.sendOnceTask || typeof state.sendOnceTask !== 'object') {
        state.sendOnceTask = { phase: 'idle', runId: '', lastError: null };
      }

      const normalized = String(nextPhase || 'idle');
      state.sendOnceTask.phase = normalized;

      if (normalized === 'sending') {
        state.sendOnceTask.runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        state.sendOnceTask.lastError = null;
      } else if (normalized === 'idle') {
        state.sendOnceTask.runId = '';
        if (extra.clearError !== false) {
          state.sendOnceTask.lastError = null;
        }
      } else if (extra.lastError != null) {
        state.sendOnceTask.lastError = String(extra.lastError);
      }

      renderSendOnceButton(extra);
    }

    function flashSendOnceThenIdle(flashPhase, flashText, delayMs = 1200) {
      setSendOnceTaskPhase(flashPhase);
      const flashRunId = state.sendOnceTask ? String(state.sendOnceTask.runId || '') : '';
      const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;
      if (sendOnceBtn && typeof ButtonState !== 'undefined' && typeof ButtonState.flashButtonThenIdle === 'function') {
        const idleText = sendOnceBtn.dataset.cgptIdleText
          || (config.promptMode === 'task' ? '只发送初始指令一次' : '发送一次');
        const flashFn = flashPhase === 'success' ? setButtonSuccess : setButtonFailed;
        ButtonState.flashButtonThenIdle(sendOnceBtn, flashFn, flashText, idleText, delayMs, {
          expectedRunId: flashRunId,
          getCurrentRunId: () => (state.sendOnceTask && state.sendOnceTask.runId) || '',
          getCurrentPhase: () => (state.sendOnceTask && state.sendOnceTask.phase) || 'idle',
        });
      }
      window.setTimeout(() => {
        const currentPhase = String(state.sendOnceTask && state.sendOnceTask.phase || 'idle')
          .trim()
          .toLowerCase();
        const flashNormalized = String(flashPhase || '').trim().toLowerCase();
        if (currentPhase === flashNormalized || currentPhase === 'success' || currentPhase === 'failed') {
          setSendOnceTaskPhase('idle');
        }
      }, delayMs);
    }

    function hideAutoQueueStopButton() {
      if (!stopBtn) {
        return;
      }
      stopBtn.classList.add('cgpt-toolbox-hidden');
      stopBtn.disabled = true;
      stopBtn.setAttribute('aria-hidden', 'true');
    }

    function showAutoQueueStopButton() {
      if (!stopBtn) {
        return;
      }
      stopBtn.classList.remove('cgpt-toolbox-hidden');
      stopBtn.disabled = false;
      stopBtn.removeAttribute('aria-hidden');
    }

    function applyAutoQueueBatchRunningStopButton(opts) {
      if (!stopBtn) {
        return;
      }

      const {
        stopRequested,
        phase,
        phaseStatusText,
        uploading,
        reason,
      } = opts;

      showAutoQueueStopButton();

      if (stopRequested || phase === AUTO_QUEUE_PHASES.CANCELLED) {
        setButtonCancelled(stopBtn, '停止任务', {
          title: '停止请求已提交，正在等待队列退出',
          allowCancel: false,
          disabled: true,
          reason,
        });
      } else if (phase === AUTO_QUEUE_PHASES.WAITING_REPLY || state.waitingReply) {
        setButtonWaiting(stopBtn, '等待回复，点击停止', {
          title: `阶段：${phaseStatusText}`,
          allowCancel: true,
          reason,
        });
      } else if (isAutoQueueWaitingDelay()) {
        setButtonWaiting(stopBtn, '等待下次发送，点击停止', {
          title: `下次发送：${new Date(state.nextSendAt).toLocaleTimeString()}`,
          allowCancel: true,
          reason,
        });
      } else if (
        phase === AUTO_QUEUE_PHASES.SENDING
        || phase === AUTO_QUEUE_PHASES.SENT
      ) {
        setButtonSending(stopBtn, '发送中，点击停止', {
          title: `阶段：${phaseStatusText}`,
          allowCancel: true,
          reason,
        });
      } else if (
        phase === AUTO_QUEUE_PHASES.UPLOADING
        || phase === AUTO_QUEUE_PHASES.UPLOAD_ATTACHED
        || uploading
      ) {
        setButtonRunning(stopBtn, '上传中，点击停止', {
          title: `阶段：${phaseStatusText}`,
          allowCancel: true,
          reason,
        });
      } else {
        setButtonDanger(stopBtn, '运行中，点击停止', {
          title: `阶段：${phaseStatusText}`,
          allowCancel: true,
          reason,
        });
      }

      stopBtn.dataset.cgptTaskPhase = String(state.batchTask.phase || phase);
    }

    function applyAutoQueueTaskModeRunningStartIndicator(reason) {
      if (!startBtn) {
        return;
      }

      startBtn.classList.add('cgpt-task-running-indicator');
      setToolboxButtonState(startBtn, {
        phase: 'disabled',
        text: '批量任务运行中',
        title: '批量任务正在运行，不能重复启动；需要停止请点击右侧停止按钮',
        disabled: true,
        reason,
      });
      startBtn.dataset.cgptTaskPhase = String(state.batchTask.phase || state.phase || '');
    }

    function renderQueueActionButtons(context = {}) {
      if (typeof setToolboxButtonState !== 'function') {
        return;
      }

      syncBatchButtonTask(context.refreshReason || 'renderQueueActionButtons');

      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      const phaseStatusText = String(state.phaseReason || context.phase || phase || '').trim()
        || phase;
      const uploading = !!context.uploading || !!state.uploadingFromAutoQueue;
      const reason = String(context.refreshReason || 'update-status');
      const batchRunning = state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase);
      const stopRequested = !!(state.batchTask && state.batchTask.stopRequested);
      const idleStartText = getAutoQueueStartIdleText();
      const taskMode = config.promptMode === 'task';
      const useSplitBatchControls = taskMode && (batchRunning || uploading);

      if (startBtn) {
        startBtn.classList.remove('cgpt-task-running-indicator');

        if (!batchRunning && !uploading) {
          hideAutoQueueStopButton();

          if (phase === AUTO_QUEUE_PHASES.FAILED) {
            setButtonFailed(startBtn, idleStartText, {
              title: `失败：${phaseStatusText}`,
              disabled: false,
              reason,
            });
          } else if (phase === AUTO_QUEUE_PHASES.DONE) {
            if (typeof ButtonState !== 'undefined' && typeof ButtonState.flashButtonThenIdle === 'function') {
              ButtonState.flashButtonThenIdle(
                startBtn,
                setButtonSuccess,
                '已完成',
                idleStartText,
                900,
                {
                  getCurrentPhase: () => String(state.phase || AUTO_QUEUE_PHASES.IDLE).trim().toLowerCase(),
                },
              );
            } else {
              setButtonIdle(startBtn, idleStartText, { title: '已完成', reason });
            }
          } else {
            setButtonIdle(startBtn, idleStartText, {
              title: '点击开始自动指令队列',
              reason,
            });
          }
        } else if (useSplitBatchControls) {
          applyAutoQueueTaskModeRunningStartIndicator(reason);
          applyAutoQueueBatchRunningStopButton({
            stopRequested,
            phase,
            phaseStatusText,
            uploading,
            reason,
          });
        } else {
          hideAutoQueueStopButton();

          if (stopRequested || phase === AUTO_QUEUE_PHASES.CANCELLED) {
            setButtonCancelled(startBtn, idleStartText, {
              title: '停止请求已提交，正在等待队列退出',
              allowCancel: false,
              disabled: true,
              reason,
            });
          } else if (phase === AUTO_QUEUE_PHASES.WAITING_REPLY || state.waitingReply) {
            setButtonWaiting(startBtn, '等待回复，点击停止', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              reason,
            });
          } else if (isAutoQueueWaitingDelay()) {
            setButtonWaiting(startBtn, '等待下次发送，点击停止', {
              title: `下次发送：${new Date(state.nextSendAt).toLocaleTimeString()}`,
              allowCancel: true,
              reason,
            });
          } else if (
            phase === AUTO_QUEUE_PHASES.SENDING
            || phase === AUTO_QUEUE_PHASES.SENT
          ) {
            setButtonSending(startBtn, '发送中，点击停止', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              reason,
            });
          } else if (
            phase === AUTO_QUEUE_PHASES.UPLOADING
            || phase === AUTO_QUEUE_PHASES.UPLOAD_ATTACHED
            || uploading
          ) {
            setButtonRunning(startBtn, '上传中，点击停止', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              reason,
            });
          } else {
            setButtonDanger(startBtn, '运行中，点击停止', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              reason,
            });
          }
          startBtn.dataset.cgptTaskPhase = String(state.batchTask.phase || phase);
        }
      } else {
        hideAutoQueueStopButton();
      }

      if (startUploadBtn) {
        startUploadBtn.classList.toggle('cgpt-toolbox-hidden', config.promptMode !== 'task');

        const taskModeRunning = config.promptMode === 'task'
          && (state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase))
          && !state.uploadingFromAutoQueue;

        if (taskModeRunning && typeof setToolboxButtonState === 'function') {
          setToolboxButtonState(startUploadBtn, {
            phase: 'disabled',
            text: '批量任务运行中',
            title: '批量任务正在运行，不能重复启动；需要停止请点击右侧停止按钮',
            disabled: true,
            reason: `autoq:${reason || 'task-running'}`,
          });
          startUploadBtn.classList.add('cgpt-task-running-indicator');
        } else if (state.uploadingFromAutoQueue && typeof setToolboxButtonState === 'function') {
          startUploadBtn.classList.remove('cgpt-task-running-indicator');
          setToolboxButtonState(startUploadBtn, {
            phase: ButtonState.Phase.DANGER,
            text: '上传中',
            title: '正在上传文件，请等待上传结束',
            disabled: true,
            allowCancel: false,
            reason: `autoq:${reason || 'uploading'}`,
          });
        } else if (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyStartUploadButtonState === 'function'
        ) {
          startUploadBtn.classList.remove('cgpt-task-running-indicator');
          UploadModule.applyStartUploadButtonState(startUploadBtn, { reason: `autoq:${reason}` });
        } else {
          startUploadBtn.classList.remove('cgpt-task-running-indicator');
          setButtonIdle(startUploadBtn, '开始上传', {
            title: '只上传/绑定文件，不自动发送',
            reason,
          });
        }
      }

      renderSendOnceButton(context);
    }

    function prepareQueue() {
      readPanelConfig(config.promptMode);

      if (config.promptMode === 'task') {
        return prepareTaskQueue();
      }

      const prompts = buildQueuePromptsByMode(config.promptMode);

      if (!prompts.length) {
        log('指令为空，无法开始');
        return false;
      }

      resetTaskRunState();
      state.queue = prompts;
      state.idx = 0;
      state.sentCount = 0;
      state.completedLoops = 0;
      state.nextSendAt = 0;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.sendingNow = false;

      return true;
    }

    function start() {
      if (state.running) return;
      if (state.uploadingFromAutoQueue) return;

      if (AUTO_QUEUE_TERMINAL_PHASES.has(state.phase)) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][RESET_TERMINAL_BEFORE_START] from=${state.phase || '-'}`,
        );
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.IDLE, 'reset-before-start', { force: true });
      }

      const frozenGroupId = config.promptMode === 'task' ? resolveRunGroupIdBeforeStart() : '';
      if (config.promptMode === 'task' && !frozenGroupId) {
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'active upload group missing', { force: true });
        updateStatus('start-reject-group');
        return;
      }

      const task = config.promptMode === 'task' && typeof getCurrentRunningTask === 'function'
        ? getCurrentRunningTask()
        : null;
      createAutoQueueRunContext(task, frozenGroupId);
      state.batchTask.stopRequested = false;

      if (!transitionAutoQueuePhase(AUTO_QUEUE_PHASES.PREPARING, 'batch-start')) {
        invalidateAutoQueueRun('phase-transition-failed');
        return;
      }

      if (!prepareQueue()) {
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'prepare queue failed', { force: true });
        invalidateAutoQueueRun('prepare-queue-failed');
        updateStatus('prepare-failed');
        return;
      }

      if (config.promptMode === 'task') {
        const run = state.taskRun || {};
        const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;
        const profile = getActiveTaskProfile();
        const task = getCurrentRunningTask();
        if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onBatchStart === 'function') {
          RuntimeStatsModule.onBatchStart(total);
        }
        log(`开始运行批量任务组，共 ${total} 条`);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][START] total=${total}`);
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH_START_CLICK] mode=task group_id=${profile ? profile.id : '-'} `
          + `task_id=${task ? task.id : '-'} task_title=${task ? task.title : '-'}`,
        );
        ToolboxShell.setStatus('批量任务已启动');
      } else {
        log(`开始运行，队列 ${state.queue.length} 条`);
        ToolboxShell.setStatus('自动指令队列已开启');
      }

      ensureTicker();
      updateStatus('batch-start');
      tick();
    }

    function stop(options = {}) {
      const wasRunning = !!state.running;
      const isTaskMode = config.promptMode === 'task';
      const opts = options && typeof options === 'object' ? options : {};
      const reason = String(opts.reason || '').trim();
      const markCurrent = opts.markCurrent !== false;
      const logStop = opts.logStop !== false;
      const hasFinalStep = opts.finalStep !== undefined && opts.finalStep !== null;
      const finalStep = hasFinalStep
        ? String(opts.finalStep)
        : (reason === 'all-done' ? 'all-done' : 'stopped');

      if (wasRunning && isTaskMode) {
        const stopReasonKey = reason || (finalStep === 'all-done' ? 'all-done' : 'user-stop');
        recordTaskBatchStopReason(stopReasonKey, {
          sendReason: opts.sendReason || reason || '-',
        });

        if (reason !== 'all-done') {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][STOP_REQUESTED] reason=${reason || 'unknown'}`);
        }

        if (markCurrent && finalStep === 'stopped') {
          const task = getCurrentRunningTask();
          const terminalStatus = new Set(['completed', 'failed', 'timeout']);
          if (task && !terminalStatus.has(String(task.status || ''))) {
            markTaskStatus(task, 'stopped');
          }
          setTaskBatchStep('stopped', task, { log: false });
        }
      }

      const stopReason = reason || (finalStep === 'all-done' ? 'all-done' : 'user-stop');
      invalidateAutoQueueRun(stopReason);
      state.continueUntilDoneStrict = false;
      state.batchTask.stopRequested = true;
      state.nextSendAt = 0;
      state.taskBatchStepRunning = false;
      state.batchInitialWaitLoggedAt = 0;
      if (state.taskRun) {
        state.taskRun.pendingSendKind = null;
        state.taskRun.pendingReplyKind = null;
      }

      if (state.tickTimer) {
        window.clearInterval(state.tickTimer);
        state.tickTimer = null;
      }

      if (logStop) {
        log('已停止');
      }

      if (wasRunning && isTaskMode) {
        if (reason === 'all-done') {
          ToolboxShell.setStatus('全部任务组任务完成');
        } else {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][STOPPED] reason=${reason || 'user-stop'}`);
          ToolboxShell.setStatus('批量任务组已停止');
        }
      } else if (wasRunning) {
        ToolboxShell.setStatus('自动指令队列已停止');
      }

      if (isTaskMode && state.taskRun && (wasRunning || hasFinalStep)) {
        state.taskRun.currentStep = finalStep;
      }

      if (wasRunning && isTaskMode && typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onBatchStop === 'function') {
        RuntimeStatsModule.onBatchStop(reason || (finalStep === 'all-done' ? 'all-done' : 'stopped'));
      }

      updateStatus('batch-stop');
    }

    function shouldFinishAllLoops() {
      const modeSettings = getModeSettings(config.promptMode);

      if (!modeSettings.loopMode) return state.idx >= state.queue.length;

      const max = Number(modeSettings.maxLoopCount) || 0;

      if (max <= 0) return false;

      return state.completedLoops >= max;
    }

    function advanceAfterSend() {
      const modeSettings = getModeSettings(config.promptMode);

      state.idx += 1;

      if (state.idx >= state.queue.length) {
        state.completedLoops += 1;

        if (modeSettings.loopMode && !shouldFinishAllLoops()) {
          state.idx = 0;
        }
      }

      if (shouldFinishAllLoops()) {
        log('队列已全部完成');
        stop();
        return;
      }

      state.nextSendAt = Date.now() + getRandomDelayMs();
    }

    function guardAutoQueueBackgroundThrottle(action) {
      if (typeof BrowserRuntimeHealth === 'undefined' || !BrowserRuntimeHealth.isProbablyThrottled()) {
        return false;
      }

      const now = Date.now();
      const actionName = String(action || 'wait-visible').trim() || 'wait-visible';
      if (!state.lastBackgroundThrottleLogAt || now - state.lastBackgroundThrottleLogAt > 5000) {
        state.lastBackgroundThrottleLogAt = now;
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[AUTO_QUEUE][BACKGROUND_THROTTLED] action=${actionName}`);
        }
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.setStatus) {
          ToolboxShell.setStatus('页面后台限速中，等待恢复可见后继续', 'warning');
        }
      }
      return true;
    }

    function maybeUpdateWaitingState() {
      if (!state.waitingReply) return;

      if (guardAutoQueueBackgroundThrottle('wait-reply')) {
        return;
      }

      const busy = ComposerApi.isAssistantLikelyBusy();
      const waitedMs = Date.now() - Number(state.waitingStartedAt || 0);
      const maxWaitMs = Number(state.waitingNoBusyTimeoutMs) || 60000;

      if (busy) {
        state.replyBecameBusy = true;
        state.idleSince = 0;
        ChatInputStateRuntime.waitingForReply = false;
        updateStatus();
        updateChatInputStateBadge();
        return;
      }

      if (!state.replyBecameBusy) {
        if (state.waitingStartedAt && waitedMs >= maxWaitMs) {
          log(`等待回复超时，继续下一条：${Math.round(waitedMs / 1000)}s`);
          state.waitingReply = false;
          state.replyBecameBusy = false;
          state.idleSince = 0;
          state.waitingStartedAt = 0;

          let replyText = '';
          try {
            replyText = getLastAssistantReplyText();
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] maybeUpdateWaitingState get reply failed', err);
            ToolboxShell.appendLog(`[AUTOQ][REPLY_SETTLED][READ_FAILED] ${errText}`);
          }

          if (config.promptMode === 'task') {
            void onAssistantReplySettled(replyText, { reason: 'wait-timeout' });
          } else {
            if (tryStopNonTaskAutoQueueOnTerminalReply(replyText, 'wait-timeout')) {
              return;
            }
            advanceAfterSend();
          }

          updateStatus();
          updateChatInputStateBadge();
        }
        return;
      }

      if (!state.idleSince) {
        state.idleSince = Date.now();
        return;
      }

      if (Date.now() - state.idleSince >= 1600) {
        const replySnapshot = buildAssistantReplySnapshot();
        const validation = validateAssistantReplyForRun(
          { runId: state.currentRunId },
          replySnapshot,
        );

        if (!validation.ok) {
          ToolboxShell.appendLog(
            `[AUTO_QUEUE][REPLY_WAIT] reason=${validation.reason} phase=${state.phase || '-'}`,
          );
          state.idleSince = 0;
          updateStatus();
          updateChatInputStateBadge();
          return;
        }

        if (config.promptMode === 'task') {
          void onAssistantReplySettled(validation.reply.text, { reason: 'idle-detected' });
        } else {
          if (tryStopNonTaskAutoQueueOnTerminalReply(validation.reply.text, 'idle-detected')) {
            return;
          }
          setAutoQueuePhase(AUTO_QUEUE_PHASES.REPLY_READY, 'assistant reply ready');
          state.waitingReply = false;
          state.replyBecameBusy = false;
          state.idleSince = 0;
          setAutoQueuePhase(AUTO_QUEUE_PHASES.DONE, 'reply ready');
          advanceAfterSend();
        }

        updateStatus();
        updateChatInputStateBadge();
      }
    }

    function sleepMs(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });
    }

    const TASK_SEND_RATE_HISTORY_STORAGE_KEY = 'autoQueueTaskSendRateHistoryV1';
    const TASK_UPLOAD_RATE_HISTORY_STORAGE_KEY = 'autoQueueTaskUploadRateHistoryV1';

    function normalizeTaskSendRateLimitSettings() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {
          taskSendRateLimitEnabled: true,
          taskSendRateLimitWindowMinutes: 180,
          taskSendRateLimitMaxMessages: 150,
        };

      const raw = config.taskQueueSettings && typeof config.taskQueueSettings === 'object'
        ? config.taskQueueSettings
        : {};

      return {
        enabled: raw.taskSendRateLimitEnabled !== false,
        windowMinutes: Math.max(
          1,
          Math.floor(Number(raw.taskSendRateLimitWindowMinutes) || defaults.taskSendRateLimitWindowMinutes || 180),
        ),
        maxMessages: Math.max(
          1,
          Math.floor(Number(raw.taskSendRateLimitMaxMessages) || defaults.taskSendRateLimitMaxMessages || 150),
        ),
      };
    }

    function isTaskSendRateHistoryEntryStale(item, now, windowMs) {
      if (typeof item === 'number') {
        return item <= 0 || now - item >= windowMs;
      }

      if (!item || typeof item !== 'object') {
        return true;
      }

      const ts = Number(item.ts) || 0;
      return ts <= 0 || now - ts >= windowMs;
    }

    function readTaskSendRateHistory(now = Date.now(), shouldPersist = true) {
      const settings = normalizeTaskSendRateLimitSettings();
      const windowMs = settings.windowMinutes * 60 * 1000;
      const raw = MemoryManager.get(TASK_SEND_RATE_HISTORY_STORAGE_KEY, []);
      const list = Array.isArray(raw) ? raw : [];
      const before = list.length;
      const hadStaleEntries = list.some((item) => isTaskSendRateHistoryEntryStale(item, now, windowMs));

      const cleaned = list
        .map((item) => {
          if (typeof item === 'number') {
            return {
              ts: item,
              kind: 'legacy',
            };
          }

          if (item && typeof item === 'object') {
            return {
              ts: Number(item.ts) || 0,
              kind: String(item.kind || 'task'),
              taskId: String(item.taskId || ''),
            };
          }

          return null;
        })
        .filter((item) => item && item.ts > 0 && now - item.ts < windowMs)
        .sort((a, b) => a.ts - b.ts);

      const after = cleaned.length;
      const removed = Math.max(0, before - after);

      if (removed > 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SEND_RATE_LIMIT][CLEANUP] before=${before} after=${after} `
          + `removed=${removed} windowMinutes=${settings.windowMinutes}`,
        );
      }

      if (shouldPersist && (removed > 0 || hadStaleEntries || after !== before)) {
        MemoryManager.set(TASK_SEND_RATE_HISTORY_STORAGE_KEY, cleaned);
      }

      return cleaned;
    }

    function saveTaskSendRateHistory(history) {
      MemoryManager.set(TASK_SEND_RATE_HISTORY_STORAGE_KEY, Array.isArray(history) ? history : []);
    }

    function clearTaskSendRateHistory(reason = 'manual') {
      MemoryManager.set(TASK_SEND_RATE_HISTORY_STORAGE_KEY, []);
      ToolboxShell.appendLog(`[AUTOQ][TASK_SEND_RATE_LIMIT][CLEAR] reason=${reason}`);
    }

    function formatDurationForTaskRateLimit(ms) {
      const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}小时${minutes}分${seconds}秒`;
      }

      if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
      }

      return `${seconds}秒`;
    }

    function getPanelMessageQuotaState(options = {}) {
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getMessageQuotaState === 'function'
      ) {
        return UploadModule.getMessageQuotaState(options);
      }

      const fallbackLimit = typeof getMessageQuotaLimit === 'function'
        ? getMessageQuotaLimit()
        : (
          typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function'
            ? Number(SettingsModule.getConfig().messageQuotaMaxMessages) || 150
            : 150
        );

      return {
        used: 0,
        limit: fallbackLimit,
        maxMessages: fallbackLimit,
        remaining: fallbackLimit,
        canSend: true,
        records: [],
        windowMs: 0,
        nextReleaseAt: 0,
        source: 'message-quota-unavailable',
      };
    }

    function getPanelUploadQuotaState(options = {}) {
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getUploadQuotaState === 'function'
      ) {
        return UploadModule.getUploadQuotaState(options);
      }

      const fallbackLimit = typeof getUploadQuotaLimit === 'function'
        ? getUploadQuotaLimit()
        : (
          typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function'
            ? Number(SettingsModule.getConfig().uploadQuotaMaxFiles) || 80
            : 80
        );

      return {
        used: 0,
        limit: fallbackLimit,
        maxFiles: fallbackLimit,
        remaining: fallbackLimit,
        canUpload: true,
        records: [],
        windowMs: 0,
        nextReleaseAt: 0,
        source: 'upload-quota-unavailable',
      };
    }

    function getTaskSendRateLimitStatus(options = {}) {
      const settings = normalizeTaskSendRateLimitSettings();
      const quota = getPanelMessageQuotaState({
        logSnapshot: !!(options && options.logSnapshot),
      });
      const used = Math.max(0, Number(quota.used) || 0);
      const max = Math.max(1, Number(quota.limit || quota.maxMessages) || settings.maxMessages);
      const remaining = Math.max(0, Number(quota.remaining) || 0);
      const canSend = quota.canSend !== false && remaining > 0;
      const records = Array.isArray(quota.records) ? quota.records : [];

      if (!settings.enabled) {
        const sendDisplay = `${used}/${max}，可发送`;

        return {
          enabled: false,
          allowed: true,
          used,
          limit: max,
          max,
          remaining,
          canSend: true,
          waitMs: 0,
          records,
          source: quota.source || 'message-quota',
          display: sendDisplay,
        };
      }

      if (canSend) {
        const sendDisplay = `${used}/${max}，可发送`;

        return {
          enabled: true,
          allowed: true,
          used,
          limit: max,
          max,
          remaining,
          canSend: true,
          waitMs: 0,
          windowMinutes: settings.windowMinutes,
          records,
          source: quota.source || 'message-quota',
          display: sendDisplay,
        };
      }

      const now = Date.now();
      const windowMs = Math.max(1000, Number(quota.windowMs) || settings.windowMinutes * 60 * 1000);
      const oldest = records.length ? Number(records[0].ts) || now : now;
      const waitMs = Math.max(1000, oldest + windowMs - now);

      return {
        enabled: true,
        allowed: false,
        used,
        limit: max,
        max,
        remaining: 0,
        canSend: false,
        waitMs,
        windowMinutes: settings.windowMinutes,
        records,
        source: quota.source || 'message-quota',
        display: `${used}/${max}，等待 ${formatDurationForTaskRateLimit(waitMs)}`,
      };
    }

    async function waitUntilPanelQuotaAvailable(task, kind = 'task', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;

      while (true) {
        if (shouldStop && shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        if (
          typeof UploadModule === 'undefined'
          || typeof UploadModule.canStartNextTaskByQuota !== 'function'
        ) {
          return { ok: true };
        }

        const quotaCheck = UploadModule.canStartNextTaskByQuota(task);
        if (quotaCheck.ok) {
          return quotaCheck;
        }

        ToolboxShell.appendLog(
          `[AUTOQ][QUOTA_WAIT] reason=${quotaCheck.reason || '-'} kind=${kind} `
          + `uploadRemaining=${quotaCheck.uploadRemaining ?? '-'} messageRemaining=${quotaCheck.messageRemaining ?? '-'}`,
        );
        setTaskBatchStep('quota-wait', task || getCurrentRunningTask(), { log: false });
        updateStatus('quota-wait');
        await sleepMs(30000);
      }
    }

    async function waitForTaskSendRateLimit(kind = 'task-message', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function'
        ? options.shouldStop
        : null;

      while (true) {
        if (shouldStop && shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const panelQuota = await waitUntilPanelQuotaAvailable(getCurrentRunningTask(), kind, { shouldStop });
        if (!panelQuota.ok) {
          return {
            ok: false,
            reason: panelQuota.reason || 'quota-wait-cancelled',
          };
        }

        const status = getTaskSendRateLimitStatus();

        if (!status.enabled || status.allowed) {
          return {
            ok: true,
            reason: 'rate-limit-ok',
            status,
          };
        }

        const waitMs = Math.max(1000, Number(status.waitMs) || 1000);
        const now = Date.now();

        setTaskBatchStep('rate-limit-wait', getCurrentRunningTask(), { log: false });
        ToolboxShell.setStatus(`批量任务组发送限速中：${status.display}`);

        if (!state.taskRateLimitLastLogAt || now - state.taskRateLimitLastLogAt >= 30000) {
          state.taskRateLimitLastLogAt = now;
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SEND_RATE_LIMIT][WAIT] kind=${kind} used=${status.used}/${status.max} `
            + `windowMinutes=${status.windowMinutes} waitMs=${waitMs}`,
          );
        }

        updateStatus('task-rate-limit-wait');

        await sleepMs(Math.min(waitMs, 30000));
      }
    }

    function recordTaskSendRateLimitHit(kind = 'task-message') {
      const safeKind = String(kind || 'task-message');

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.recordMessageSent === 'function'
      ) {
        UploadModule.recordMessageSent();
      }

      const status = getTaskSendRateLimitStatus({ logSnapshot: true });
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_SEND_RATE_LIMIT][RECORD] kind=${safeKind} used=${status.used}/${status.max} `
        + `remaining=${status.remaining} source=${status.source || 'message-quota'}`,
      );
    }

    function normalizeTaskUploadRateLimitSettings() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {
          taskUploadRateLimitEnabled: true,
          taskUploadRateLimitWindowMinutes: 180,
          taskUploadRateLimitMaxFiles: 80,
        };

      const raw = config.taskQueueSettings && typeof config.taskQueueSettings === 'object'
        ? config.taskQueueSettings
        : {};

      return {
        enabled: raw.taskUploadRateLimitEnabled !== false,
        windowMinutes: Math.max(
          1,
          Math.floor(Number(raw.taskUploadRateLimitWindowMinutes) || defaults.taskUploadRateLimitWindowMinutes || 180),
        ),
        maxFiles: Math.max(
          1,
          Math.floor(Number(raw.taskUploadRateLimitMaxFiles) || defaults.taskUploadRateLimitMaxFiles || 80),
        ),
      };
    }

    function isTaskUploadRateHistoryEntryStale(item, now, windowMs) {
      if (typeof item === 'number') {
        return item <= 0 || now - item >= windowMs;
      }

      if (!item || typeof item !== 'object') {
        return true;
      }

      const ts = Number(item.ts) || 0;
      return ts <= 0 || now - ts >= windowMs;
    }

    function readTaskUploadRateHistory(now = Date.now(), shouldPersist = true) {
      const settings = normalizeTaskUploadRateLimitSettings();
      const windowMs = settings.windowMinutes * 60 * 1000;
      const raw = MemoryManager.get(TASK_UPLOAD_RATE_HISTORY_STORAGE_KEY, []);
      const list = Array.isArray(raw) ? raw : [];
      const before = list.length;
      const hadStaleEntries = list.some((item) => isTaskUploadRateHistoryEntryStale(item, now, windowMs));

      const cleaned = list
        .map((item) => {
          if (typeof item === 'number') {
            return {
              ts: item,
              count: 1,
              kind: 'legacy',
            };
          }

          if (item && typeof item === 'object') {
            return {
              ts: Number(item.ts) || 0,
              count: Math.max(1, Math.floor(Number(item.count) || 1)),
              kind: String(item.kind || 'upload'),
              taskId: String(item.taskId || ''),
            };
          }

          return null;
        })
        .filter((item) => item && item.ts > 0 && now - item.ts < windowMs)
        .sort((a, b) => a.ts - b.ts);

      const after = cleaned.length;
      const removed = Math.max(0, before - after);

      if (removed > 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][CLEANUP] before=${before} after=${after} `
          + `removed=${removed} windowMinutes=${settings.windowMinutes}`,
        );
      }

      if (shouldPersist && (removed > 0 || hadStaleEntries || after !== before)) {
        MemoryManager.set(TASK_UPLOAD_RATE_HISTORY_STORAGE_KEY, cleaned);
      }

      return cleaned;
    }

    function saveTaskUploadRateHistory(history) {
      MemoryManager.set(TASK_UPLOAD_RATE_HISTORY_STORAGE_KEY, Array.isArray(history) ? history : []);
    }

    function clearTaskUploadRateHistory(reason = 'manual') {
      MemoryManager.set(TASK_UPLOAD_RATE_HISTORY_STORAGE_KEY, []);
      ToolboxShell.appendLog(`[AUTOQ][TASK_UPLOAD_RATE_LIMIT][CLEAR] reason=${reason}`);
    }

    function getTaskUploadRateLimitStatus(neededCount = 1, options = {}) {
      const settings = normalizeTaskUploadRateLimitSettings();
      const quota = getPanelUploadQuotaState({
        logSnapshot: !!(options && options.logSnapshot),
      });
      const used = Math.max(0, Number(quota.used) || 0);
      const max = Math.max(1, Number(quota.limit || quota.maxFiles) || settings.maxFiles);
      const remaining = Math.max(0, Number(quota.remaining) || 0);
      const canUpload = quota.canUpload !== false && remaining > 0;
      const records = Array.isArray(quota.records) ? quota.records : [];
      const need = Math.max(1, Math.floor(Number(neededCount) || 1));

      if (!settings.enabled) {
        const uploadDisplay = `${used}/${max}，可上传 ${remaining} 个`;

        return {
          enabled: false,
          allowed: true,
          fullAllowed: true,
          used,
          limit: max,
          max,
          remaining,
          canUpload: true,
          waitMs: 0,
          records,
          source: quota.source || 'upload-quota',
          display: uploadDisplay,
        };
      }

      if (canUpload) {
        const uploadDisplay = `${used}/${max}，可上传 ${remaining} 个`;

        return {
          enabled: true,
          allowed: true,
          fullAllowed: remaining >= need,
          used,
          limit: max,
          max,
          remaining,
          canUpload: true,
          waitMs: 0,
          windowMinutes: settings.windowMinutes,
          records,
          source: quota.source || 'upload-quota',
          display: uploadDisplay,
        };
      }

      const now = Date.now();
      const windowMs = Math.max(1000, Number(quota.windowMs) || settings.windowMinutes * 60 * 1000);
      const oldest = records.length ? Number(records[0].ts) || now : now;
      const waitMs = Math.max(1000, oldest + windowMs - now);

      return {
        enabled: true,
        allowed: false,
        fullAllowed: false,
        used,
        limit: max,
        max,
        remaining: 0,
        canUpload: false,
        waitMs,
        windowMinutes: settings.windowMinutes,
        records,
        source: quota.source || 'upload-quota',
        display: `${used}/${max}，等待 ${formatDurationForTaskRateLimit(waitMs)}`,
      };
    }

    async function waitForTaskUploadRateLimit(kind = 'task-upload', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function'
        ? options.shouldStop
        : null;

      while (true) {
        if (shouldStop && shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const status = getTaskUploadRateLimitStatus(1);

        if (!status.enabled || status.allowed) {
          return {
            ok: true,
            reason: 'upload-rate-limit-ok',
            status,
          };
        }

        const waitMs = Math.max(1000, Number(status.waitMs) || 1000);
        const now = Date.now();

        setTaskBatchStep('upload-rate-limit-wait', getCurrentRunningTask(), { log: false });
        ToolboxShell.setStatus(`批量任务组上传限速中：${status.display}`);

        if (!state.taskUploadRateLimitLastLogAt || now - state.taskUploadRateLimitLastLogAt >= 30000) {
          state.taskUploadRateLimitLastLogAt = now;
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][WAIT] kind=${kind} used=${status.used}/${status.max} `
            + `windowMinutes=${status.windowMinutes} waitMs=${waitMs}`,
          );
        }

        updateStatus('task-upload-rate-limit-wait');

        await sleepMs(Math.min(waitMs, 30000));
      }
    }

    function recordTaskUploadRateLimitHit(uploadedCount, kind = 'task-upload') {
      const count = Math.max(0, Math.floor(Number(uploadedCount) || 0));
      const safeKind = String(kind || 'task-upload');

      if (count <= 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][SKIP] kind=${safeKind} uploaded=0 reason=no-uploaded-files`,
        );
        return;
      }

      const status = getTaskUploadRateLimitStatus(1, { logSnapshot: true });
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][RECORD] kind=${safeKind} uploaded=${count} `
        + `used=${status.used}/${status.max} remaining=${status.remaining} `
        + `source=${status.source || 'upload-quota'} note=recorded-by-upload-module`,
      );
    }

    async function startUploadFromCurrentQueueWithTaskUploadRateLimit(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const source = String(opts.source || 'autoq-upload-rate-guarded').trim() || 'autoq-upload-rate-guarded';
      const kind = String(opts.kind || 'task-upload').trim() || 'task-upload';
      const shouldStop = typeof opts.shouldStop === 'function'
        ? opts.shouldStop
        : () => false;

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.startUploadFromCurrentQueue !== 'function'
      ) {
        const reason = 'upload-module-missing';
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][FAILED] source=${source} kind=${kind} reason=${reason}`,
        );

        return {
          ok: false,
          reason,
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const pendingItems = typeof UploadModule.getPendingUploadItems === 'function'
        ? UploadModule.getPendingUploadItems()
        : [];

      const pendingUploadCount = Array.isArray(pendingItems) ? pendingItems.length : 0;

      if (pendingUploadCount <= 0) {
        const runningTask = typeof getCurrentRunningTask === 'function'
          ? getCurrentRunningTask()
          : null;
        const attachmentMode = resolveTaskAttachmentMode(runningTask);
        if (attachmentMode === TASK_ATTACHMENT_MODES.REQUIRED) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][FAILED] source=${source} kind=${kind} reason=upload-required-but-empty`,
          );
          return {
            ok: false,
            reason: 'upload files required but group is empty',
            uploadedCount: 0,
            failedCount: 0,
            skippedCount: 0,
          };
        }
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][SKIP] source=${source} kind=${kind} reason=no-files`,
        );

        return {
          ok: true,
          skipped: true,
          reason: 'no-files',
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const waitResult = await waitForTaskUploadRateLimit(kind, {
        shouldStop,
      });

      if (!waitResult || waitResult.ok !== true) {
        const reason = waitResult && waitResult.reason
          ? waitResult.reason
          : 'upload-rate-limit-blocked';

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][BLOCKED] source=${source} kind=${kind} reason=${reason}`,
        );

        return {
          ok: false,
          reason,
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: 0,
        };
      }

      const status = getTaskUploadRateLimitStatus(pendingUploadCount);
      const maxFilesForThisUpload = status.enabled
        ? Math.max(0, Math.min(pendingUploadCount, Number(status.remaining) || 0))
        : pendingUploadCount;

      if (maxFilesForThisUpload <= 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][BLOCKED] source=${source} kind=${kind} reason=no-upload-quota used=${status.used}/${status.max}`,
        );

        return {
          ok: false,
          reason: 'no-upload-quota',
          uploadedCount: 0,
          failedCount: 0,
          skippedCount: pendingUploadCount,
        };
      }

      if (maxFilesForThisUpload < pendingUploadCount) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][PARTIAL] source=${source} kind=${kind} pending=${pendingUploadCount} allowed=${maxFilesForThisUpload} used=${status.used}/${status.max}`,
        );
      }

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][UPLOAD_START] source=${source} kind=${kind} pending=${pendingUploadCount} maxFiles=${maxFilesForThisUpload}`,
      );

      const result = await UploadModule.startUploadFromCurrentQueue({
        source,
        shouldStop,
        maxFiles: maxFilesForThisUpload,
      });

      const uploadedCount = Number(result && result.uploadedCount) || 0;
      const failedCount = Number(result && result.failedCount) || 0;
      const skippedCount = Number(result && result.skippedCount) || 0;
      const reason = String(result && result.reason || '').trim();

      if (result && result.ok === true && uploadedCount > 0) {
        updateStatus(`task-upload-rate-limit-record:${kind}`);

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][RECORDED] source=${source} kind=${kind} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} source=upload-module`,
        );
      } else {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][NOT_RECORDED] source=${source} kind=${kind} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} reason=${reason || 'upload-not-ok'}`,
        );
      }

      return result;
    }

    const BATCH_COMPOSER_SYNC_RETRY_DELAYS_MS = [300, 600, 1000, 1500, 2000];
    const BATCH_COMPOSER_SYNC_MAX_RETRIES = 5;
    const BATCH_SEND_BUTTON_WAIT_MS = 3000;

    function previewComposerLogText(text, maxLen = 80) {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLen);
    }

    function getBatchSendTaskMeta() {
      const task = getCurrentRunningTask();
      return {
        taskName: task ? String(task.title || '-') : '-',
        taskId: task ? String(task.id || '-') : '-',
      };
    }

    function logBatchComposerSendFailure(reason, extra = {}) {
      const { taskName, taskId } = getBatchSendTaskMeta();
      const promptLen = Number(extra.promptLen) || 0;
      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '')
        : '';
      const actualTextLen = composerText.trim().length;
      const hasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
      const sendBtn = typeof ComposerApi.findSendButton === 'function'
        ? ComposerApi.findSendButton({ silent: true })
        : null;
      const hasSubmitButton = typeof ComposerApi.hasRealSubmitButton === 'function'
        ? ComposerApi.hasRealSubmitButton()
        : false;
      const run = state.taskRun || {};
      const step = String(run.batchStep || run.step || '-');
      const retryCount = Number(extra.retryCount) || 0;

      ToolboxShell.appendLog(
        `[AUTO_QUEUE][BATCH][COMPOSER_FAIL] reason=${reason} task=${taskName} taskId=${taskId} `
        + `promptLen=${promptLen} actualTextLen=${actualTextLen} hasAttachment=${hasAttachment ? 1 : 0} `
        + `sendButtonFound=${sendBtn ? 1 : 0} hasSubmitButton=${hasSubmitButton ? 1 : 0} `
        + `buttonAria=${sendBtn ? String(sendBtn.getAttribute('aria-label') || '-') : '-'} `
        + `step=${step} retryCount=${retryCount}`,
      );
    }

    async function writeAndVerifyComposerForBatch(prompt, source, retryIndex) {
      const { taskName, taskId } = getBatchSendTaskMeta();
      const text = String(prompt || '');

      if (typeof ComposerApi.clearComposerValue === 'function') {
        ComposerApi.clearComposerValue();
      } else if (typeof ComposerApi.setComposerValue === 'function') {
        ComposerApi.setComposerValue('');
      } else {
        return { ok: false, reason: 'composer_api_unavailable' };
      }

      await sleepMs(120);

      ToolboxShell.appendLog('[COMPOSER][TEXT_FILL_START]');
      const okSet = typeof ComposerApi.setComposerValue === 'function'
        && ComposerApi.setComposerValue(text);
      ToolboxShell.appendLog(
        `[COMPOSER][TEXT_FILL_DONE] ok=${okSet ? 1 : 0} expectedLen=${text.length}`,
      );
      if (!okSet) {
        ToolboxShell.appendLog(
          `[AUTOQ][COMPOSER_SYNC_CHECK] retryIndex=${retryIndex} task=${taskName} taskId=${taskId} `
          + 'ok=0 reason=composer_set_failed expectedLen=- actualLen=-',
        );
        return { ok: false, reason: 'composer_set_failed' };
      }

      const settleMs = retryIndex === 0
        ? 400
        : (BATCH_COMPOSER_SYNC_RETRY_DELAYS_MS[retryIndex - 1] || 2000);
      await sleepMs(settleMs);

      const check = typeof ComposerApi.checkComposerTextSyncDetailed === 'function'
        ? ComposerApi.checkComposerTextSyncDetailed(text)
        : {
          ok: typeof ComposerApi.isComposerTextSynced === 'function'
            && ComposerApi.isComposerTextSynced(text),
          reason: 'composer_text_not_synced',
          expectedLen: text.length,
          actualLen: typeof ComposerApi.getComposerText === 'function'
            ? String(ComposerApi.getComposerText() || '').length
            : 0,
          expectedPreview: previewComposerLogText(text),
          actualPreview: previewComposerLogText(
            typeof ComposerApi.getComposerText === 'function' ? ComposerApi.getComposerText() : '',
          ),
        };

      ToolboxShell.appendLog(
        `[AUTOQ][COMPOSER_SYNC_CHECK] retryIndex=${retryIndex} task=${taskName} taskId=${taskId} `
        + `ok=${check.ok ? 1 : 0} expectedLen=${check.expectedLen} actualLen=${check.actualLen} `
        + `expectedPreview=${previewComposerLogText(check.expectedPreview)} `
        + `actualPreview=${previewComposerLogText(check.actualPreview)} `
        + `reason=${check.reason || '-'}`,
      );

      return check;
    }

    async function waitBatchSendButtonReady(sourceTag, options = {}) {
      const maxAttempts = Math.max(1, Number(options.maxAttempts || 30));
      const intervalMs = Math.max(50, Number(options.intervalMs || 300));
      const allowDisabledWithText = options.allowDisabledWithText === true;
      const requireText = options.requireText === true;
      const maxDisabledWaitMs = Math.max(
        intervalMs,
        Number(options.maxDisabledWaitMs || BATCH_SEND_BUTTON_WAIT_MS),
      );
      const startedAt = Date.now();

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState();
          if (responseState.is_responding) {
            return { ok: false, reason: 'assistant_busy', wait: true, retryable: true };
          }
        }

        const sendBtn = typeof ComposerApi.findSendButton === 'function'
          ? ComposerApi.findSendButton({ silent: true })
          : null;
        const composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const textLen = composerText.length;
        const hasComposerText = typeof ComposerApi.hasRealComposerText === 'function'
          ? ComposerApi.hasRealComposerText()
          : textLen > 0;
        const hasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();
        const hasSubmitButton = typeof ComposerApi.hasRealSubmitButton === 'function'
          ? ComposerApi.hasRealSubmitButton()
          : false;
        const found = sendBtn ? 1 : 0;

        if (requireText && !hasComposerText) {
          const lostReason = hasAttachment
            ? 'composer_text_lost_after_attachment'
            : 'composer_text_lost';
          ToolboxShell.appendLog(
            `[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} hasText=0 textLen=${textLen} `
            + `hasAttachment=${hasAttachment ? 1 : 0} found=${found} hasSubmitButton=${hasSubmitButton ? 1 : 0} `
            + `buttonAria=${sendBtn ? String(sendBtn.getAttribute('aria-label') || '-') : '-'} `
            + `reason=${lostReason}`,
          );
          return {
            ok: false,
            reason: lostReason,
            wait: true,
            retryable: true,
            needRewriteText: true,
          };
        }

        let disabledFlag = '-';
        let buttonReady = hasSubmitButton;
        let waitReason = 'waiting_send_button';

        if (sendBtn) {
          if (typeof ComposerApi.isSendButtonReady === 'function') {
            buttonReady = ComposerApi.isSendButtonReady(sendBtn) && hasComposerText;
            disabledFlag = buttonReady ? 0 : 1;
          } else {
            disabledFlag = sendBtn.disabled ? 1 : 0;
            buttonReady = !sendBtn.disabled && hasComposerText;
          }
        } else if (hasComposerText && Date.now() - startedAt >= maxDisabledWaitMs) {
          waitReason = 'send_button_missing_use_enter_fallback';
        }

        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} hasText=${hasComposerText ? 1 : 0} `
          + `textLen=${textLen} hasAttachment=${hasAttachment ? 1 : 0} found=${found} `
          + `hasSubmitButton=${hasSubmitButton ? 1 : 0} disabled=${disabledFlag} `
          + `buttonAria=${sendBtn ? String(sendBtn.getAttribute('aria-label') || '-') : '-'} `
          + `reason=${waitReason}`,
        );

        if (hasComposerText && hasSubmitButton && sendBtn && buttonReady) {
          ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_READY]');
          return { ok: true, reason: 'send_button_ready' };
        }

        if (
          allowDisabledWithText
          && hasComposerText
          && sendBtn
          && Date.now() - startedAt >= maxDisabledWaitMs
        ) {
          return {
            ok: true,
            reason: 'send_button_disabled_use_enter_fallback',
            useEnterFallback: true,
          };
        }

        if (hasComposerText && !sendBtn && Date.now() - startedAt >= maxDisabledWaitMs) {
          break;
        }

        await sleepMs(intervalMs);
      }

      const finalComposerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const finalTextLen = finalComposerText.length;
      const finalHasText = typeof ComposerApi.hasRealComposerText === 'function'
        ? ComposerApi.hasRealComposerText()
        : finalTextLen > 0;
      const finalHasAttachment = typeof hasComposerAttachment === 'function' && hasComposerAttachment();

      if (requireText && !finalHasText) {
        const lostReason = finalHasAttachment
          ? 'composer_text_lost_after_attachment'
          : 'composer_text_lost';
        return {
          ok: false,
          reason: lostReason,
          wait: true,
          retryable: true,
          needRewriteText: true,
        };
      }

      if (allowDisabledWithText && finalHasText) {
        return {
          ok: true,
          reason: 'send_button_missing_use_enter_fallback',
          useEnterFallback: true,
        };
      }

      if (typeof hasVoiceComposerButtonOnly === 'function' && hasVoiceComposerButtonOnly()) {
        return { ok: false, reason: 'voice_button_only', wait: true, retryable: true };
      }

      if (typeof detectComposerResponseState === 'function') {
        const responseState = detectComposerResponseState();
        const responseReason = String(responseState.response_state_reason || '').trim();
        if (responseReason === 'payload_ready_but_send_button_missing') {
          return {
            ok: false,
            reason: responseReason,
            wait: true,
            retryable: true,
          };
        }
      }

      return { ok: false, reason: 'send_button_not_found', wait: true, retryable: true };
    }

    async function sendBatchTextViaUnifiedPipeline(text, sourceTag) {
      const prompt = String(text || '').trim();
      const source = String(sourceTag || 'batch-task-group-initial-instruction');
      const { taskName, taskId } = getBatchSendTaskMeta();

      if (!prompt) {
        return { ok: false, reason: 'empty-prompt' };
      }

      const wasRunningWhenStarted = state.running === true;
      const rateLimitResult = await waitForTaskSendRateLimit(source, {
        shouldStop: () => wasRunningWhenStarted && !state.running,
      });

      if (!rateLimitResult.ok) {
        return {
          ok: false,
          reason: rateLimitResult.reason || 'rate-limit-cancelled',
        };
      }

      if (guardAutoQueueBackgroundThrottle('send-batch')) {
        return { ok: false, reason: 'background-throttled', wait: true };
      }

      if (typeof stableSendMessage !== 'function') {
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=stableSendMessage_unavailable');
        if (typeof sendContentViaComposer === 'function') {
          return sendContentViaComposer({
            source,
            content: prompt,
            allowReplaceDraft: true,
            waitUntilSendable: true,
            timeoutMs: 60000,
            blockWhenResponding: true,
          });
        }
        return { ok: false, reason: 'send_pipeline_unavailable' };
      }

      if (typeof waitUntilComposerReady === 'function') {
        const ready = await waitUntilComposerReady({
          timeoutMs: 10000,
          intervalMs: 200,
          source,
        });
        if (!ready) {
          return {
            ok: false,
            reason: 'composer_not_ready',
            wait: true,
            retryable: true,
          };
        }
      }

      if (typeof detectComposerResponseState === 'function') {
        const responseState = detectComposerResponseState();
        if (responseState.is_responding) {
          return { ok: false, reason: 'assistant_busy', wait: true };
        }
      }

      let syncOk = false;
      let lastSyncReason = 'composer_text_not_synced';

      for (let retryIndex = 0; retryIndex < BATCH_COMPOSER_SYNC_MAX_RETRIES; retryIndex += 1) {
        if (!state.running) {
          return { ok: false, reason: 'cancelled' };
        }

        if (retryIndex === 0) {
          setTaskBatchStep('write-initial', getCurrentRunningTask(), { log: false });
          ToolboxShell.setStatus('正在写入初始指令…');
        } else {
          setTaskBatchStep('composer-sync-retry', getCurrentRunningTask(), { log: false });
          ToolboxShell.setStatus(`正在同步输入框（第 ${retryIndex + 1}/${BATCH_COMPOSER_SYNC_MAX_RETRIES} 次）…`);
          ToolboxShell.appendLog(
            `[AUTOQ][COMPOSER_SYNC_RETRY] retryIndex=${retryIndex} task=${taskName} taskId=${taskId} `
            + `delayMs=${BATCH_COMPOSER_SYNC_RETRY_DELAYS_MS[retryIndex - 1] || 2000}`,
          );
        }

        const syncCheck = await writeAndVerifyComposerForBatch(prompt, source, retryIndex);
        if (syncCheck.ok) {
          syncOk = true;
          ToolboxShell.appendLog(
            `[AUTO_QUEUE][BATCH][TEXT_SYNC_OK] retryIndex=${retryIndex} prompt_len=${prompt.length} `
            + `task=${taskName}`,
          );
          break;
        }

        lastSyncReason = String(syncCheck.reason || 'composer_text_not_synced');
        if (retryIndex < BATCH_COMPOSER_SYNC_MAX_RETRIES - 1) {
          ToolboxShell.appendLog(
            `[AUTOQ][SEND_RETRY] phase=composer_sync retryIndex=${retryIndex + 1} `
            + `task=${taskName} reason=${lastSyncReason}`,
          );
        }
      }

      if (!syncOk) {
        const syncFailReason = lastSyncReason === 'composer_text_not_synced'
          ? 'composer_text_not_ready'
          : lastSyncReason;
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH][TEXT_SYNC_FAILED] reason=${syncFailReason} prompt_len=${prompt.length} `
          + `retries=${BATCH_COMPOSER_SYNC_MAX_RETRIES} task=${taskName}`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][SEND_WAIT_RETRY] phase=composer_sync task=${taskName} reason=${syncFailReason}`,
        );
        return {
          ok: false,
          reason: syncFailReason,
          wait: true,
          retryable: true,
        };
      }

      setTaskBatchStep('send-initial', getCurrentRunningTask(), { log: false });
      ToolboxShell.setStatus('正在发送初始指令…');
      ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');

      ToolboxShell.appendLog('[COMPOSER][SEND_BUTTON_WAIT]');
      const buttonWaitOptions = {
        maxAttempts: 40,
        intervalMs: 200,
        allowDisabledWithText: true,
        maxDisabledWaitMs: 8000,
        expectedText: prompt,
        requireText: true,
      };
      const BATCH_TEXT_REWRITE_MAX = 3;
      let buttonWait = await waitBatchSendButtonReady(source, buttonWaitOptions);

      if (buttonWait.needRewriteText) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH][TEXT_REWRITE_START] reason=${buttonWait.reason || '-'} `
          + `task=${taskName} prompt_len=${prompt.length}`,
        );
        let rewriteOk = false;
        for (let rewriteIndex = 0; rewriteIndex < BATCH_TEXT_REWRITE_MAX; rewriteIndex += 1) {
          if (!state.running) {
            return { ok: false, reason: 'cancelled' };
          }
          const syncCheck = await writeAndVerifyComposerForBatch(
            prompt,
            source,
            BATCH_COMPOSER_SYNC_MAX_RETRIES + rewriteIndex,
          );
          if (syncCheck.ok) {
            rewriteOk = true;
            ToolboxShell.appendLog(
              `[AUTO_QUEUE][BATCH][TEXT_SYNC_OK] phase=text_rewrite retryIndex=${rewriteIndex} `
              + `prompt_len=${prompt.length} task=${taskName}`,
            );
            break;
          }
          await sleepMs(BATCH_COMPOSER_SYNC_RETRY_DELAYS_MS[rewriteIndex] || 500);
        }
        if (!rewriteOk) {
          logBatchComposerSendFailure('composer_text_lost_after_rewrite', {
            promptLen: prompt.length,
            retryCount: BATCH_TEXT_REWRITE_MAX,
          });
          return {
            ok: false,
            reason: 'composer_text_lost_after_rewrite',
            wait: true,
            retryable: true,
          };
        }
        buttonWait = await waitBatchSendButtonReady(source, buttonWaitOptions);
      }

      if (!buttonWait.ok) {
        if (buttonWait.needRewriteText) {
          const lostReason = String(buttonWait.reason || 'composer_text_lost');
          logBatchComposerSendFailure(lostReason, {
            promptLen: prompt.length,
            retryCount: 0,
          });
          return {
            ok: false,
            reason: lostReason,
            wait: true,
            retryable: true,
          };
        }
        if (buttonWait.wait) {
          const waitReason = String(buttonWait.reason || 'assistant_busy');
          if (waitReason === 'assistant_busy') {
            return { ok: false, reason: waitReason, wait: true, retryable: true };
          }
          logBatchComposerSendFailure(waitReason, {
            promptLen: prompt.length,
            retryCount: 0,
          });
          const retryReason = waitReason === 'send_button_not_found'
            ? 'send_button_not_ready_after_text'
            : waitReason;
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_WAIT_RETRY] phase=send_button task=${taskName} reason=${retryReason}`,
          );
          ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${retryReason}`);
          return {
            ok: false,
            reason: retryReason,
            wait: true,
            retryable: true,
          };
        }
        const failReason = buttonWait.reason || 'send_button_not_found';
        const retryReason = failReason === 'send_button_not_found'
          ? 'send_button_not_ready_after_text'
          : failReason;
        logBatchComposerSendFailure(retryReason, {
          promptLen: prompt.length,
          retryCount: 0,
        });
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][SEND_WAIT_RETRY] phase=send_button task=${taskName} reason=${retryReason}`,
        );
        ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${retryReason}`);
        return {
          ok: false,
          reason: retryReason,
          wait: true,
          retryable: true,
        };
      }

      const finalComposerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      if (!finalComposerText) {
        logBatchComposerSendFailure('composer_text_lost', {
          promptLen: prompt.length,
          retryCount: 0,
        });
        return {
          ok: false,
          reason: 'composer_text_lost',
          wait: true,
          retryable: true,
        };
      }

      if (buttonWait.useEnterFallback) {
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_CLICK] task=${taskName} note=button_disabled_will_use_enter_fallback `
          + `reason=${buttonWait.reason || '-'}`,
        );
      } else {
        ToolboxShell.appendLog(`[AUTOQ][SEND_CLICK] task=${taskName} reason=send_button_ready`);
      }

      const sendResult = await stableSendMessage({
        source,
        sendExistingComposer: true,
        maxAttempts: 8,
        intervalMs: 300,
        blockWhenResponding: true,
        allowEnterFallbackWhenNoButton: buttonWait && buttonWait.useEnterFallback === true,
        shouldStop: () => !state.running,
      });

      ToolboxShell.appendLog(
        `[AUTOQ][SEND_VERIFY] task=${taskName} ok=${sendResult && sendResult.ok ? 1 : 0} `
        + `reason=${sendResult && sendResult.reason ? sendResult.reason : 'unknown'}`,
      );

      if (sendResult && sendResult.ok) {
        const runAfterSend = state.taskRun || {};
        if (Number(runAfterSend.sendRetryCount) > 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_RETRY_SUCCESS] task=${taskName} retryCount=${runAfterSend.sendRetryCount}`,
          );
        }
        clearRelentlessSendRetryState();
        recordTaskSendRateLimitHit(source);
        ToolboxShell.appendLog(`[AUTOQ][SEND_SUCCESS] task=${taskName} method=${sendResult.reason || '-'}`);
        const runningTask = getCurrentRunningTask();
        notifyRuntimeTaskSendSuccess(runningTask, source || 'batch-send');
        state.currentMessageId = String(sendResult.messageId || state.currentMessageId || '').trim();
        setAutoQueuePhase(AUTO_QUEUE_PHASES.SENT, 'message accepted');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');
        return sendResult;
      }

      const reason = String((sendResult && sendResult.reason) || 'unknown');
      const classified = logSendFailureClassified('initial', getCurrentRunningTask(), reason, sendResult);

      if (classified.action === 'retry') {
        return {
          ok: false,
          reason,
          wait: true,
          retryable: true,
          relentlessRetry: true,
        };
      }

      ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);
      ToolboxShell.appendLog(
        `[AUTOQ][SEND_GIVE_UP] phase=send task=${taskName} taskId=${taskId} reason=${reason}`,
      );
      return sendResult || { ok: false, reason };
    }

    async function sendTaskPrompt(content, logTag, sendKind = 'initial') {
      const prompt = String(content || '').trim();
      const source = 'batch-task-group-initial-instruction';
      const safeSendKind = String(sendKind || 'initial');

      if (!prompt) {
        log('任务指令为空，跳过发送');
        return { ok: false, reason: 'empty-prompt' };
      }

      const run = state.taskRun || {};
      run.pendingSendKind = 'processing';
      state.sendingNow = true;

      try {
        const sendResult = await sendBatchTextViaUnifiedPipeline(prompt, source);

        if (!sendResult || sendResult.ok !== true) {
          const reason = String((sendResult && sendResult.reason) || 'unknown');
          run.pendingSendKind = safeSendKind === 'verification' ? 'verification' : 'initial';

          const classified = logSendFailureClassified(safeSendKind, getCurrentRunningTask(), reason, sendResult);

          if (classified.action === 'retry') {
            return {
              ok: false,
              wait: true,
              retryable: true,
              relentlessRetry: true,
              reason,
            };
          }

          const failLabel = reason === 'send_button_not_found'
            ? '发送失败：找不到可用发送按钮'
            : `发送失败：${reason}`;
          log(failLabel);
          ToolboxShell.appendLog(`${logTag} failed reason=${reason}`);
          ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);
          return sendResult || { ok: false, reason };
        }

        if (Number(run.sendRetryCount) > 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_RETRY_SUCCESS] task=${getCurrentRunningTask() ? getCurrentRunningTask().title : '-'} `
            + `retryCount=${run.sendRetryCount}`,
          );
        }
        clearRelentlessSendRetryState();

        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_SEND_DONE]');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_WAIT_REPLY_START]');
        state.batchInitialWaitLoggedAt = 0;

        state.sentCount += 1;
        state.currentMessageId = String(
          (sendResult && sendResult.messageId) || state.currentMessageId || '',
        ).trim();
        setAutoQueuePhase(AUTO_QUEUE_PHASES.SENT, 'message accepted');
        state.waitingReply = true;
        setAutoQueuePhase(AUTO_QUEUE_PHASES.WAITING_REPLY, 'await-assistant');
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = Date.now();
        run.pendingSendKind = null;
        const runningTask = getCurrentRunningTask();
        setTaskBatchStep('wait-initial-reply', runningTask, { log: false });
        ToolboxShell.appendLog(`${logTag} task=${runningTask ? runningTask.title : '-'}`);
        ToolboxShell.appendLog('[AUTOQ][TASK][WAIT_REPLY]');
        log(`已发送：${prompt.slice(0, 80)}`);
        updateStatus();
        updateChatInputStateBadge();
        return sendResult;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] auto queue task send failed', {
          error_type: err && err.name ? err.name : 'Error',
          error: errText,
          stack: err && err.stack ? err.stack : '',
        });
        run.pendingSendKind = safeSendKind === 'verification'
          ? 'verification'
          : (safeSendKind === 'continue' ? null : 'initial');
        setTaskBatchStep('send-initial-failed', getCurrentRunningTask(), { log: false });
        log(`发送异常：${errText}`);
        ToolboxShell.setStatus(`发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`${logTag} error=${errText}`);
        ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${errText}`);
        return { ok: false, reason: errText };
      } finally {
        state.sendingNow = false;
        if (run.pendingSendKind === 'processing') {
          run.pendingSendKind = safeSendKind === 'verification'
            ? 'verification'
            : (safeSendKind === 'continue' ? null : 'initial');
        }
      }
    }

    function hasRemainingBatchTasks() {
      const run = state.taskRun;

      if (!run || !Array.isArray(run.enabledTaskIds)) {
        return false;
      }

      const index = Number(run.currentIndex || 0);

      return index >= 0 && index < run.enabledTaskIds.length;
    }

    function shouldContinueBatch() {
      if (!state.running) {
        return false;
      }

      if (state.waitingReply) {
        return false;
      }

      return hasRemainingBatchTasks();
    }

    function logBatchPendingCheck(decision) {
      const run = state.taskRun || {};
      const current = Number(run.currentIndex || 0);
      const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;

      ToolboxShell.appendLog(
        `[AUTOQ][BATCH_PENDING_CHECK] current=${current} total=${total} waitingReply=${state.waitingReply ? '1' : '0'} decision=${decision || '-'}`,
      );
    }

    function maybeSendNextTask() {
      if (config.promptMode === 'task') {
        logBatchPendingCheck(shouldContinueBatch() ? 'continue' : 'stop');
      }

      const runStep = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';
      if (runStep === 'send-wait-retry' || runStep === 'send-initial-wait-retry') {
        return;
      }

      if (!state.running || state.waitingReply) return;
      if (guardAutoQueueBackgroundThrottle('send-next-task')) {
        return;
      }
      if (state.taskBatchStepRunning) return;
      if (Date.now() < state.nextSendAt) return;
      if (state.sendingNow) return;

      const run = state.taskRun || {};
      if (run.pendingSendKind === 'processing') return;

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.clearStaleBusySendStateOnHomeReady === 'function'
      ) {
        UploadModule.clearStaleBusySendStateOnHomeReady('maybe-send-next-task');
      }

      const homeReadyToSend = typeof isHomeNewChatReadyToSendNow === 'function'
        && isHomeNewChatReadyToSendNow();
      if (ComposerApi.isAssistantLikelyBusy() && !homeReadyToSend) {
        if ((run.pendingSendKind || 'initial') === 'initial') {
          const now = Date.now();
          if (!state.batchInitialWaitLoggedAt || now - state.batchInitialWaitLoggedAt > 5000) {
            state.batchInitialWaitLoggedAt = now;
            ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');
          }
          setTaskBatchStep('wait-current-reply', getCurrentRunningTask(), { log: false });
        }
        return;
      }

      state.batchInitialWaitLoggedAt = 0;

      const task = getCurrentRunningTask();

      if (!task) {
        void moveToNextTask().then((moved) => {
          if (!moved) {
            return;
          }
          maybeSendNextTask();
        }).catch(handleMoveToNextTaskError);
        return;
      }

      const currentTask = getCurrentRunningTask();

      if (!currentTask) {
        console.error('[ChatGPT toolbox] maybeSendNextTask: current task missing');
        failCurrentTask('missing-task');
        return;
      }

      const kind = run.pendingSendKind || 'initial';

      if (kind === 'initial') {
        const resolvedInitial = resolveTaskInitialPrompt(currentTask, { log: true });
        const initial = String(resolvedInitial.initialPrompt || '').trim();

        if (currentTask.sourceType === 'prompt-manager' && currentTask.promptId && !initial) {
          log(`任务「${currentTask.title}」关联的 Prompt 不存在或内容为空`);
          markTaskStatus(currentTask, 'failed');
          void moveToNextTask().catch(handleMoveToNextTaskError);
          return;
        }

        if (!initial) {
          log(`任务「${currentTask.title}」缺少初始指令，跳过`);
          markTaskStatus(currentTask, 'skipped');
          void moveToNextTask().catch(handleMoveToNextTaskError);
          return;
        }

        if (resolvedInitial.title && resolvedInitial.title !== currentTask.title) {
          currentTask.title = resolvedInitial.title;
        }

        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH_INITIAL_PROMPT_PICKED] text_len=${initial.length} task_title=${currentTask.title}`,
        );

        const uploadPrecheck = precheckUploadGroupForRun(
          { groupId: state.currentGroupId, runId: state.currentRunId },
          currentTask,
        );

        if (!uploadPrecheck.ok) {
          ToolboxShell.appendLog(
            `[AUTO_QUEUE][UPLOAD_PRECHECK_FAILED] task=${currentTask.title} reason=${uploadPrecheck.reason}`,
          );
          setAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, uploadPrecheck.reason);
          failCurrentTask(uploadPrecheck.reason || 'upload-precheck-failed');
          return;
        }

        if (!uploadPrecheck.shouldUpload) {
          ToolboxShell.appendLog(
            `[AUTO_QUEUE][UPLOAD_SKIP] task=${currentTask.title} reason=${uploadPrecheck.reason}`,
          );
        }

        state.taskBatchStepRunning = true;
        void (async () => {
          try {
            const prepareResult = await prepareTaskPageBeforeNextSend('initial', currentTask);

            if (!prepareResult || prepareResult.ok !== true) {
              const prepareReason = prepareResult && prepareResult.reason
                ? prepareResult.reason
                : 'prepare-before-send-failed';
              handleTaskInitialSendFailure(prepareReason);
              return;
            }

            const sendResult = await sendTaskPrompt(
              initial,
              '[AUTOQ][TASK_BATCH][SEND_INITIAL]',
              'initial',
            );

            if (sendResult && sendResult.wait && sendResult.retryable !== true) {
              return;
            }

            if (!sendResult || sendResult.ok !== true) {
              const reason = String((sendResult && sendResult.reason) || 'unknown');

              const classified = logSendFailureClassified('initial', currentTask, reason, sendResult);

              if (classified.action === 'retry') {
                return;
              }

              const runState = state.taskRun || {};
              runState.pendingSendKind = 'initial';

              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][SEND_RETRY_STILL_FAILED] phase=initial task=${currentTask.title} reason=${reason} retryable=${classified.retryable ? 1 : 0}`,
              );
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} reason=${reason}`,
              );
              ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${reason}`);
              log(`批量任务组初始指令发送失败：${reason}`);
              handleTaskInitialSendFailure(reason);
              return;
            }

            ToolboxShell.appendLog(`[AUTOQ][TASK][SEND_INITIAL] task=${currentTask.title}`);
            recordTaskBatchMessageSent('initial');
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] [AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial', {
              error_type: err && err.name ? err.name : 'Error',
              error: errText,
              stack: err && err.stack ? err.stack : '',
            });
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} error=${errText}`,
            );
            ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${errText}`);
            const runState = state.taskRun || {};
            runState.pendingSendKind = 'initial';
            handleTaskInitialSendFailure(errText);
          } finally {
            state.taskBatchStepRunning = false;
          }
        })();
        return;
      }
    }

    function maybeSendNext() {
      if (!state.running || state.waitingReply) return;

      if (config.promptMode === 'task') {
        maybeSendNextTask();
        return;
      }

      if (guardAutoQueueBackgroundThrottle('send-next')) {
        return;
      }

      if (!state.queue.length) return;
      if (Date.now() < state.nextSendAt) return;
      if (ComposerApi.isAssistantLikelyBusy()) return;

      const prompt = state.queue[state.idx];

      if (!prompt) {
        advanceAfterSend();
        updateStatus();
        return;
      }

      if (state.sendingNow) {
        return;
      }

      state.sendingNow = true;

      const runId = captureAutoQueueRunId();
      setAutoQueuePhase('sending', 'send-next');
      void sendContentViaComposer({
        source: 'auto-queue',
        content: prompt,
        allowReplaceDraft: true,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
      }).then((sendResult) => {
        if (isStaleAutoQueueRun(runId, 'send-next')) {
          return;
        }
        if (!sendResult.ok) {
          log(`发送失败：${sendResult.reason || 'unknown'}`);
          setAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, sendResult.reason || 'send-failed');
          return;
        }

        state.currentMessageId = String(sendResult.messageId || state.currentMessageId || '').trim();
        setAutoQueuePhase(AUTO_QUEUE_PHASES.SENT, 'message accepted');
        state.sentCount += 1;
        state.waitingReply = true;
        setAutoQueuePhase(AUTO_QUEUE_PHASES.WAITING_REPLY, 'await-assistant');
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = Date.now();
        log(`已发送：${prompt.slice(0, 80)} reason=${sendResult.reason || '-'}`);
        updateStatus();
        updateChatInputStateBadge();
      }).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] auto queue send failed', err);
        log(`发送异常：${errText}`);
      }).finally(() => {
        state.sendingNow = false;
      });
    }

    function tick() {
      try {
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          if (state.running || state.waitingReply) {
            stop({
              reason: 'page-navigation',
              logStop: false,
              markCurrent: false,
            });
          }
          return;
        }

        if (!state.running && !state.waitingReply) {
          return;
        }

        if (maybeResumeRelentlessSendRetry()) {
          updateStatus('send-wait-retry-tick');
          return;
        }

        maybeUpdateWaitingState();
        maybeSendNext();
        updateStatus();
      } catch (e) {
        console.warn('[ChatGPT toolbox] auto queue tick failed', e);
        log(`运行异常：${e && e.message ? e.message : String(e)}`);
      }
    }

    function ensureTicker() {
      if (state.tickTimer) return;

      state.tickTimer = window.setInterval(tick, 500);
    }

    async function sendTaskInitialOnce() {
      if (state.running) {
        log('批量任务组运行中，请先停止再使用「只发送初始指令一次」');
        return false;
      }

      readPanelConfig('task');

      const profile = getActiveTaskProfile();
      const task = getSelectedTask(profile);

      if (!task) {
        log('请先选择任务');
        return false;
      }

      const resolvedInitial = resolveTaskInitialPrompt(task, { log: true });
      const initial = String(resolvedInitial.initialPrompt || '').trim();

      if (task.sourceType === 'prompt-manager' && task.promptId && !initial) {
        log('关联的 Prompt 不存在或内容为空，无法发送');
        return false;
      }

      if (!initial) {
        log('初始指令为空，无法发送');
        return false;
      }

      if (state.sendingNow) {
        return false;
      }

      state.sendingNow = true;
      ToolboxShell.appendLog(`[AUTOQ][TASK_SINGLE][SEND_INITIAL_ONLY] task=${task.title}`);

      try {
        const sendResult = await sendBatchTextViaUnifiedPipeline(
          initial,
          'auto-queue-task-single',
        );

        if (!sendResult.ok) {
          log(`发送失败：${sendResult.reason || 'unknown'}`);
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SINGLE][SEND_INITIAL_ONLY] failed task=${task.title} reason=${sendResult.reason || 'unknown'}`,
          );
          return false;
        }

        log(`已发送初始指令（仅一次）：${initial.slice(0, 80)}`);
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send task initial once failed', err);
        log(`发送异常：${errText}`);
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SINGLE][SEND_INITIAL_ONLY] error task=${task.title} error=${errText}`,
        );
        return false;
      } finally {
        state.sendingNow = false;
      }
    }

    async function sendOnceViaUnifiedPipeline(prompt, sourceTag) {
      const source = String(sourceTag || 'auto-queue-send-once');
      const text = String(prompt || '').trim();

      if (!text) {
        return { ok: false, reason: 'empty-prompt', source };
      }

      if (typeof sendContentViaComposer !== 'function') {
        ToolboxShell.appendLog('[AUTOQ][SEND_ONCE][FAILED] reason=send_pipeline_unavailable');
        return { ok: false, reason: 'send_pipeline_unavailable', source };
      }

      return sendContentViaComposer({
        source,
        content: text,
        allowReplaceDraft: true,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
        shouldStop: () => !state.sendingNow,
      });
    }

    async function sendOnceWithRelentlessRetry(prompt, source) {
      const settings = config.taskQueueSettings || {};
      const enabled = settings.taskRelentlessSendRetryEnabled !== false;
      const baseMs = Math.max(300, Number(settings.taskRelentlessSendRetryIntervalMs) || 1500);
      const maxMs = Math.max(baseMs, Number(settings.taskRelentlessSendRetryMaxIntervalMs) || 10000);
      let retryCount = 0;

      while (true) {
        if (!state.sendingNow) {
          return { ok: false, reason: 'cancelled' };
        }

        const sendResult = await sendOnceViaUnifiedPipeline(prompt, source);

        if (sendResult && sendResult.ok === true) {
          if (retryCount > 0) {
            ToolboxShell.appendLog(
              `[AUTOQ][SEND_ONCE][RETRY_SUCCESS] retryCount=${retryCount} reason=${sendResult.reason || '-'}`,
            );
          }
          return sendResult;
        }

        const reason = String((sendResult && sendResult.reason) || 'unknown');
        const classified = logSendFailureClassified('send-once', null, reason, sendResult);

        if (classified.action !== 'retry' || !enabled) {
          return sendResult || { ok: false, reason };
        }

        retryCount += 1;
        let delayMs = baseMs;

        if (settings.taskRelentlessSendRetryBackoffEnabled !== false) {
          delayMs = Math.min(maxMs, baseMs * Math.max(1, Math.ceil(retryCount / 5)));
        }

        ToolboxShell.appendLog(
          `[AUTOQ][SEND_ONCE][WAIT_RETRY] reason=${reason} retryCount=${retryCount} delayMs=${delayMs}`,
        );
        ToolboxShell.setStatus(`发送暂不可用，继续重试：${reason}`);

        await sleepMs(delayMs);
      }
    }

    function buildAutoContinueUiState() {
      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      const stopRequested = !!(state.batchTask && state.batchTask.stopRequested);
      const active = state.running || state.waitingReply || AUTO_QUEUE_ACTIVE_PHASES.has(phase);

      return {
        phase,
        phaseReason: String(state.phaseReason || '').trim(),
        running: !!state.running,
        waitingReply: !!state.waitingReply,
        stopRequested,
        cancelling: stopRequested && active,
        failed: phase === AUTO_QUEUE_PHASES.FAILED,
        stopped: !active && (
          phase === AUTO_QUEUE_PHASES.CANCELLED
          || phase === AUTO_QUEUE_PHASES.IDLE
          || phase === AUTO_QUEUE_PHASES.DONE
        ),
      };
    }

    function getContinueUntilDonePromptText() {
      return [
        '请继续完成上一个任务。',
        '',
        '你现在必须和“最开始的任务要求”进行对照判断。',
        '',
        '停止规则：',
        '1. 只有当你能明确确认最开始的任务目标已经完整完成，所有要求都已经覆盖，没有剩余内容、遗漏检查项、遗漏代码、遗漏结论、遗漏 Cursor 指令时，才允许停止。',
        '2. 如果已经完整完成，只能回复下面这一行，不能有任何其他文字：',
        '{{DONE_SIGNAL}}',
        '',
        '继续规则：',
        '1. 如果还有任何未完成、未覆盖、未输出完、被截断、代码块未闭合、列表未完成、编号未结束的内容，必须继续输出。',
        '2. 如果不确定是否已经完整完成，必须继续输出，不能回复终止信号。',
        '3. 不要重复已经输出过的内容。',
        '4. 不要重新开始整个任务。',
        '5. 不要扩展到新任务。',
        '6. 只补充当前任务尚未完成、尚未输出、尚未覆盖的部分。',
        '',
        '请直接继续输出剩余内容。',
      ].join('\n');
    }

    function toggleContinueLoopFromUpload(source = 'upload-button') {
      state.continueUntilDoneStrict = false;
      readPanelConfig();
      const tag = String(source || 'upload-button').trim() || 'upload-button';
      const uiBefore = buildAutoContinueUiState();

      if (uiBefore.running || uiBefore.waitingReply || AUTO_QUEUE_ACTIVE_PHASES.has(uiBefore.phase)) {
        state.batchTask.stopRequested = true;
        stop({ reason: tag, logStop: true });
        const uiAfter = buildAutoContinueUiState();
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE][toggle-stop] source=${tag} phase=${uiAfter.phase}`,
        );
        return Object.assign({ ok: true, toggled: 'stop' }, uiAfter);
      }

      if (config.promptMode !== 'continue') {
        switchPromptMode('continue');
        readPanelConfig();
      }

      const continueModeSettings = getModeSettings('continue');
      const continuePatch = { loopMode: true };

      if ((Number(continueModeSettings.maxLoopCount) || 0) <= 0) {
        continuePatch.maxLoopCount = 50;
      }

      patchModeSettings('continue', continuePatch);
      saveConfig();

      if (state.running || state.uploadingFromAutoQueue) {
        const blocked = buildAutoContinueUiState();
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE][toggle-blocked] source=${tag} reason=already-active phase=${blocked.phase}`,
        );
        return Object.assign({ ok: false, toggled: 'blocked', reason: 'already-active' }, blocked);
      }

      start();
      const uiAfter = buildAutoContinueUiState();
      ToolboxShell.appendLog(
        `[UPLOAD_AUTO_CONTINUE][toggle-start] source=${tag} phase=${uiAfter.phase} loop=1`,
      );
      return Object.assign({ ok: true, toggled: 'start' }, uiAfter);
    }

    function startContinueUntilDoneFromUpload(source = 'upload-until-done-button') {
      readPanelConfig();

      const tag = String(source || 'upload-until-done-button').trim() || 'upload-until-done-button';
      const uiBefore = buildAutoContinueUiState();

      if (uiBefore.running || uiBefore.waitingReply || AUTO_QUEUE_ACTIVE_PHASES.has(uiBefore.phase)) {
        state.batchTask.stopRequested = true;
        state.continueUntilDoneStrict = false;
        stop({ reason: tag, logStop: true });

        const uiAfter = buildAutoContinueUiState();
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-stop] source=${tag} phase=${uiAfter.phase}`,
        );

        return Object.assign({ ok: true, toggled: 'stop' }, uiAfter);
      }

      if (config.promptMode !== 'continue') {
        switchPromptMode('continue');
        readPanelConfig();
      }

      const promptText = typeof renderContinuePromptTemplate === 'function'
        ? renderContinuePromptTemplate(getContinueUntilDonePromptText(), TASK_DONE_SIGNAL)
        : getContinueUntilDonePromptText().replaceAll('{{DONE_SIGNAL}}', TASK_DONE_SIGNAL);

      config.promptMode = 'continue';
      config.continuePromptsText = promptText;
      state.continueUntilDoneStrict = true;

      patchModeSettings('continue', {
        loopMode: true,
        maxLoopCount: 0,
        randomMinSec: 3,
        randomMaxSec: 20,
        logPinned: true,
        autoScrollPanel: true,
      });

      if (promptsEl) {
        promptsEl.value = promptText;
      }

      applyModeSettingsToUi('continue');
      saveConfig();

      if (state.running || state.uploadingFromAutoQueue) {
        const blocked = buildAutoContinueUiState();
        ToolboxShell.appendLog(
          `[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-blocked] source=${tag} reason=already-active phase=${blocked.phase}`,
        );
        return Object.assign({ ok: false, toggled: 'blocked', reason: 'already-active' }, blocked);
      }

      start();

      const uiAfter = buildAutoContinueUiState();
      ToolboxShell.appendLog(
        `[UPLOAD_AUTO_CONTINUE_UNTIL_DONE][toggle-start] source=${tag} phase=${uiAfter.phase} loop=1 maxLoop=unlimited strictDone=1`,
      );

      ToolboxShell.setStatus('自动继续直到完成已开启，检测到严格终止信号后停止', 'success');

      return Object.assign({ ok: true, toggled: 'start', strictDone: true }, uiAfter);
    }

    async function triggerContinueOnce() {
      readPanelConfig();

      if (state.sendOnceTask && state.sendOnceTask.phase !== 'idle') {
        log('发送一次正在执行，请稍候');
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_ONCE][IGNORED] phase=${state.sendOnceTask.phase}`,
        );
        return false;
      }

      if (config.promptMode === 'task') {
        setSendOnceTaskPhase('sending');
        try {
          const ok = await sendTaskInitialOnce();
          if (ok) {
            flashSendOnceThenIdle('success', '已发送');
          } else {
            flashSendOnceThenIdle('failed', '发送失败', 1400);
          }
          return ok;
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[AUTOQ][SEND_ONCE][TASK_FAILED]', err);
          setSendOnceTaskPhase('failed', { lastError: errText });
          flashSendOnceThenIdle('failed', '发送失败', 1400);
          return false;
        }
      }

      const prompts = buildQueuePromptsByMode(config.promptMode);
      const prompt = prompts[0] || '继续';
      const source = 'auto-queue-send-once';

      if (state.sendingNow) {
        log('正在发送中，请稍候');
        return false;
      }

      state.sendingNow = true;
      setSendOnceTaskPhase('sending');
      ToolboxShell.appendLog(
        `[AUTOQ][SEND_ONCE][START] mode=${config.promptMode} prompt_len=${String(prompt).length}`,
      );

      try {
        const sendResult = await sendOnceWithRelentlessRetry(prompt, source);

        if (sendResult && sendResult.ok === true) {
          const doneReason = String(sendResult.reason || 'ok');
          log(`手动发送成功：${prompt.slice(0, 80)}`);
          ToolboxShell.appendLog(`[AUTOQ][SEND_ONCE][DONE] reason=${doneReason}`);
          flashSendOnceThenIdle('success', '已发送');
          return true;
        }

        const failReason = String((sendResult && sendResult.reason) || 'unknown');
        log(`手动发送失败：${failReason}`);
        ToolboxShell.appendLog(`[AUTOQ][SEND_ONCE][FAILED] reason=${failReason}`);
        setSendOnceTaskPhase('failed', { lastError: failReason });
        flashSendOnceThenIdle('failed', '发送失败', 1400);
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] triggerContinueOnce failed', err);
        ToolboxShell.appendLog(`[AUTOQ][SEND_ONCE][FAILED] reason=exception error=${errText}`);
        log(`发送异常：${errText}`);
        setSendOnceTaskPhase('failed', { lastError: errText });
        flashSendOnceThenIdle('failed', '发送失败', 1400);
        return false;
      } finally {
        state.sendingNow = false;
      }
    }

    function bindAutoQueueStartUploadButton() {
      if (!startUploadBtn) {
        ToolboxShell.appendLog('[AUTOQ][UPLOAD][BIND_SKIP] reason=startUploadBtn-missing');
        return false;
      }

      return bindOnce(startUploadBtn, 'click', () => {
        ToolboxShell.appendLog('[AUTOQ][UPLOAD][CLICK]');
        void handleAutoQueueStartUpload();
      }, 'autoq-start-upload');
    }

    function bindEvents() {
      bindAutoQueueStartUploadButton();

      if (root && root.dataset.autoqEventsBound === '1') {
        console.info('[AUTOQ][BIND_EVENTS][SKIP_ALREADY_BOUND]');
        return;
      }
      if (root) {
        root.dataset.autoqEventsBound = '1';
      }
      console.info('[AUTOQ][BIND_EVENTS][BOUND]');

      if (startBtn) {
        bindOnce(startBtn, 'click', () => {
          syncLegacyRunFlagsFromPhase();
          const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
          const active = state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase);
          if (active) {
            state.batchTask.stopRequested = true;
            stop({ reason: 'start-button-toggle', finalStep: 'stopped', logStop: true });
            return;
          }
          start();
        }, 'autoq-start');
      }

      if (stopBtn) {
        bindOnce(stopBtn, 'click', () => {
          syncLegacyRunFlagsFromPhase();
          const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
          const active = state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase);
          if (active) {
            state.batchTask.stopRequested = true;
          }
          stop({ reason: 'stop-button', finalStep: 'stopped', logStop: true });
        }, 'autoq-stop');
      }

      qsa('.cgpt-autoq-mode-tab', root).forEach((btn) => {
        bindOnce(btn, 'click', () => {
          const mode = btn.getAttribute('data-autoq-mode');
          switchPromptMode(mode === 'list' ? 'list' : (mode === 'task' ? 'task' : 'continue'));
        }, `autoq-mode-tab:${btn.getAttribute('data-autoq-mode') || 'unknown'}`);
      });

      qsa('input', root).forEach((el) => {
        bindOnce(el, 'change', () => {
          readAdvancedConfigOnly();
          updateStatus();
        }, `autoq-input-change:${el.id || el.name || 'unknown'}`);
      });

      if (promptsEl) {
        bindOnce(promptsEl, 'input', () => {
          setPromptsTextByMode(config.promptMode, promptsEl.value);
          renderListProfiles();
          debouncedSaveConfig();
        }, 'autoq-prompts-input');
      }

      const resetContinuePromptBtn = qs('#cgpt-autoq-continue-prompt-reset', root);
      if (resetContinuePromptBtn) {
        bindOnce(resetContinuePromptBtn, 'click', () => {
          if (config.promptMode !== 'continue') {
            switchPromptMode('continue');
          }
          config.continuePromptsText = '';
          saveConfig();
          refreshPromptTextareaForMode('continue');
          log('已恢复默认继续指令');
          ToolboxShell.appendLog('[AUTOQ][continue-prompt-reset-defaults]');
        });
      }

      const sendOnceBtn = qs('#cgpt-autoq-send-once', root);
      if (sendOnceBtn) {
        bindOnce(sendOnceBtn, 'click', () => {
          void triggerContinueOnce();
        }, 'autoq-send-once');
      }

      if (listProfilesEl) {
        bindOnce(listProfilesEl, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-autoq-list-chip[data-list-id]')
            : null;

          if (!btn) return;

          const id = btn.getAttribute('data-list-id');

          if (!id) {
            console.warn('[ChatGPT toolbox] list chip clicked without id');
            return;
          }

          switchListProfile(id);
        }, 'autoq-list-profiles-click');
      }

      const newListBtn = qs('#cgpt-autoq-list-new', root);
      if (newListBtn) {
        bindOnce(newListBtn, 'click', () => {
          createListProfileInline();
        });
      }

      const saveNameBtn = qs('#cgpt-autoq-list-save-name', root);
      if (saveNameBtn) {
        bindOnce(saveNameBtn, 'click', () => {
          renameActiveListProfileInline();
        });
      }

      const deleteListBtn = qs('#cgpt-autoq-list-delete', root);
      if (deleteListBtn) {
        bindOnce(deleteListBtn, 'click', (e) => {
          deleteActiveListProfileInline(e.currentTarget);
        });
      }

      if (listProfileNameEl) {
        bindOnce(listProfileNameEl, 'keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          renameActiveListProfileInline();
        });

        bindOnce(listProfileNameEl, 'blur', () => {
          const active = getActiveListProfile();
          const text = String(listProfileNameEl.value || '').trim();

          if (!active) return;
          if (!text) return;
          if (text === active.name) return;

          renameActiveListProfileInline();
        });
      }

    }

    function ensureAutoQueueStartUploadButton() {
      if (!root) {
        return null;
      }

      let btn = qs('#cgpt-autoq-start-upload', root);
      if (btn) {
        return btn;
      }

      const actionsEl = qs('.cgpt-autoq-actions', root);
      const batchStartBtn = qs('#cgpt-autoq-start', root);
      if (!actionsEl || !batchStartBtn) {
        return null;
      }

      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cgpt-btn cgpt-btn-idle';
      btn.id = 'cgpt-autoq-start-upload';
      btn.textContent = '开始上传';
      actionsEl.insertBefore(btn, batchStartBtn);
      return btn;
    }

    function mount(targetHost) {
      if (!targetHost) {
        console.error('[ChatGPT toolbox] AutoQueueModule.mount: targetHost 为空');
        ToolboxShell.appendLog('[AUTOQ][mount-failed] targetHost empty');
        return;
      }

      const existed = targetHost.querySelector('#cgpt-autoq-module');
      if (existed) {
        root = existed;
        promptsEl = qs('#cgpt-autoq-prompts', root);
        logEl = null;
        startBtn = qs('#cgpt-autoq-start', root);
        stopBtn = qs('#cgpt-autoq-stop', root);
        listPanelEl = qs('#cgpt-autoq-list-panel', root);
        listProfilesEl = qs('#cgpt-autoq-list-profile-chips', root);
        listProfileNameEl = qs('#cgpt-autoq-list-name', root);
        taskPanelEl = qs('#cgpt-autoq-task-panel', root);
        mainLiteEl = qs('#cgpt-autoq-main-lite', root);
        startUploadBtn = ensureAutoQueueStartUploadButton();
        normalizeAutoConfig(config);
        restoreBatchModeActiveSubtabFromMemory();
        renderTaskPanelVisibility();
        syncBatchSubTabRefs();
        refreshBatchTaskPanelRefs();
        bindEvents();
        bindTaskPanelEvents();
        renderTaskProfiles();
        renderTaskList();
        renderTaskEditor();
        renderTaskProfileDefaults();
        ensureMainLiteStructure();
        updateStatus();
        return;
      }

      normalizeAutoConfig(config);
      const uiModeSettings = getModeSettings(config.promptMode);

      root = document.createElement('div');
      root.id = 'cgpt-autoq-module';
      root.innerHTML = `
        <div class="cgpt-section cgpt-autoq-section">
          <div class="cgpt-autoq-mode-tabs">
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'continue' ? ' active' : ''}" data-autoq-mode="continue">继续模式</button>
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'list' ? ' active' : ''}" data-autoq-mode="list">列表模式</button>
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'task' ? ' active' : ''}" data-autoq-mode="task">批量任务</button>
          </div>

          <div class="cgpt-autoq-main-lite" id="cgpt-autoq-main-lite"></div>

          <div class="cgpt-autoq-list-panel${config.promptMode === 'list' ? '' : ' cgpt-toolbox-hidden'}" id="cgpt-autoq-list-panel">
            <div class="cgpt-autoq-list-header">
              <div class="cgpt-autoq-list-profile-chips" id="cgpt-autoq-list-profile-chips"></div>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-new">新建列表</button>
            </div>

            <div class="cgpt-autoq-list-name-row">
              <input class="cgpt-input" id="cgpt-autoq-list-name" placeholder="列表名称">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-save-name">保存名称</button>
              <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-autoq-list-delete">删除列表</button>
            </div>
          </div>

          <div class="cgpt-autoq-task-panel${config.promptMode === 'task' ? '' : ' cgpt-toolbox-hidden'}" id="cgpt-autoq-task-panel">
            <div class="cgpt-autoq-batch-subtabs" id="cgpt-autoq-batch-subtabs">
              <button type="button" class="cgpt-autoq-batch-subtab active" data-batch-subtab="tasks" aria-selected="true">任务列表</button>
              <button type="button" class="cgpt-autoq-batch-subtab" data-batch-subtab="current" aria-selected="false">当前任务编辑</button>
              <button type="button" class="cgpt-autoq-batch-subtab" data-batch-subtab="rules" aria-selected="false">默认规则</button>
              <button type="button" class="cgpt-autoq-batch-subtab" data-batch-subtab="settings" aria-selected="false">执行设置</button>
            </div>
            <div class="cgpt-autoq-batch-subtab-content" id="cgpt-autoq-batch-subtab-content"></div>
          </div>

          <div class="cgpt-autoq-editor-block">
            <label class="cgpt-autoq-label" for="cgpt-autoq-prompts">指令内容</label>
            <textarea class="cgpt-textarea" id="cgpt-autoq-prompts" placeholder="继续模式留空则使用内置默认继续指令。"></textarea>
            <div class="cgpt-row" style="margin-top: 6px;">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-continue-prompt-reset">恢复默认继续指令</button>
            </div>
          </div>

          <div class="cgpt-autoq-actions">
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-start-upload">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-start">开始</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">发送一次</button>
            <button type="button" class="cgpt-btn danger cgpt-toolbox-hidden" id="cgpt-autoq-stop" disabled aria-hidden="true">停止</button>
          </div>
        </div>

        <div class="cgpt-section cgpt-autoq-settings-section">
          <div class="cgpt-section-title">执行设置</div>

          <div class="cgpt-autoq-settings-grid">
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-loop" ${uiModeSettings.loopMode ? 'checked' : ''}>
              循环模式
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-min-sec">最小间隔（秒）</label>
              <input class="cgpt-input" id="cgpt-autoq-min-sec" type="number" data-no-wheel-number="1" min="1" value="${Number(uiModeSettings.randomMinSec) || 3}">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-max-sec">最大间隔（秒）</label>
              <input class="cgpt-input" id="cgpt-autoq-max-sec" type="number" data-no-wheel-number="1" min="1" value="${Number(uiModeSettings.randomMaxSec) || 20}">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-max-loop">最大循环次数</label>
              <input class="cgpt-input" id="cgpt-autoq-max-loop" type="number" data-no-wheel-number="1" min="0" value="${Number(uiModeSettings.maxLoopCount) || 0}">
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-auto-scroll" ${uiModeSettings.autoScrollPanel ? 'checked' : ''}>
              自动滚动面板
            </label>
          </div>

          <div class="cgpt-hint">最大循环次数为 0 表示不限制。</div>
        </div>
      `

      targetHost.appendChild(root);

      promptsEl = qs('#cgpt-autoq-prompts', root);
      logEl = null;
      startBtn = qs('#cgpt-autoq-start', root);
      startUploadBtn = qs('#cgpt-autoq-start-upload', root);
      stopBtn = qs('#cgpt-autoq-stop', root);
      listPanelEl = qs('#cgpt-autoq-list-panel', root);
      listProfilesEl = qs('#cgpt-autoq-list-profile-chips', root);
      listProfileNameEl = qs('#cgpt-autoq-list-name', root);
      taskPanelEl = qs('#cgpt-autoq-task-panel', root);
      mainLiteEl = qs('#cgpt-autoq-main-lite', root);

      repairAutoQueuePromptConfigIfNeeded();

      restoreBatchModeActiveSubtabFromMemory();
      normalizeAutoConfig(config);
      normalizeListProfiles();
      normalizeTaskProfiles();
      applyModeSettingsToUi(config.promptMode);
      refreshPromptTextareaForMode(config.promptMode);
      updateModeTabs();
      renderListPanelVisibility();
      renderTaskPanelVisibility();
      syncBatchSubTabRefs();
      refreshBatchTaskPanelRefs();
      renderListProfiles();
      renderTaskProfiles();
      renderTaskList();
      renderTaskEditor();
      renderTaskProfileDefaults();

      bindEvents();
      bindTaskPanelEvents();
      ensureMainLiteStructure();
      updateStatus();
    }

    function snapshotConfig() {
      normalizeListProfiles();
      normalizeTaskProfiles();
      const snapshot = clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][snapshotConfig]');
      snapshot.modeSettings = ensureModeSettings(snapshot);
      return snapshot;
    }

    function exportConfig() {
      return snapshotConfig();
    }

    function refreshProgressStatus(reason = '') {
      updateStatus(reason || 'refresh');
    }

    async function resumeAfterForeground(reason = '-') {
      const tag = String(reason || '-').trim() || '-';
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[AUTO_QUEUE][FOREGROUND_RESUME] reason=${tag}`);
      }

      if (typeof BrowserRuntimeHealth !== 'undefined' && BrowserRuntimeHealth.isProbablyThrottled()) {
        return;
      }

      state.lastBackgroundThrottleLogAt = 0;
      ensureTicker();
      updateStatus(`foreground-resume:${tag}`);
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }

      ToolboxShell.appendLog(
        `[AUTOQ][VERIFY_STATE] foreground=1 running=${state.running ? 1 : 0} waitingReply=${state.waitingReply ? 1 : 0} pendingSendKind=${state.taskRun && state.taskRun.pendingSendKind ? state.taskRun.pendingSendKind : '-'}`,
      );
    }

    return {
      mount,
      stop,
      stopAutoContinue: stop,
      toggleContinueLoopFromUpload,
      startContinueUntilDoneFromUpload,
      triggerContinueOnce,
      refreshProgressStatus,
      resumeAfterForeground,
      getModeLabel: getAutoQueueModeLabel,
      getConfig: () => {
        config.modeSettings = ensureModeSettings(config);
        return clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][getConfig]');
      },
      exportConfig,
      snapshotConfig,
      getState: () => Object.assign({}, state, buildAutoContinueUiState(), {
        queue: state.queue.slice(),
      }),
      applyConfig,
      addPromptBatchTask,
      removePromptBatchTask,
      isPromptBatchTaskSelected,
      resolveTaskInitialPrompt,
      refreshPromptLinkedTasks,
      onPromptManagerChanged: refreshPromptLinkedTasks,
      hasRemainingBatchTasks,
      shouldContinueBatch,
      renderQueueActionButtons,
      renderBatchControlButtons,
      syncBatchTaskPhase,
      syncBatchButtonTask,
    };
  })();

  function renderPromptCategoryChips(categoryNames, activeName, countGetter, dataAttrName) {
    const names = Array.isArray(categoryNames) ? categoryNames : [];
    const current = String(activeName || '全部').trim() || '全部';
    const attrName = String(dataAttrName || 'data-prompt-category').trim() || 'data-prompt-category';
    const getCount = typeof countGetter === 'function'
      ? countGetter
      : () => 0;

    return names.map((name) => {
      const text = String(name || '').trim() || '默认';
      const count = Number(getCount(text)) || 0;
      const activeClass = text === current ? ' active' : '';

      return [
        `<button type="button" class="cgpt-prompt-category-chip${activeClass}" ${attrName}="${escapeHtml(text)}">`,
        `${escapeHtml(text)} ${count}`,
        '</button>',
      ].join('');
    }).join('');
  }
