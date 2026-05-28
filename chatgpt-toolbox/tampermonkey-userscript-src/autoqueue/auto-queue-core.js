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
      'wait-task-verify': '等待答案验证',
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
      'quota-wait': '等待额度恢复',
      'rate-limit-wait': '发送限速等待',
      'upload-rate-limit-wait': '上传限速等待',
      'task-rate-limit-wait': '等待消息额度恢复',
      'task-upload-rate-limit-wait': '等待上传额度恢复',
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

    function buildTaskPageRotateProgressText(progressSnapshot) {
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
        ? `首次已上传；下次第 ${progressSnapshot.taskAutoUploadNextAt} 轮（已计入 ${progressSnapshot.autoUploadCount} 次）；${strategy.summary}`
        : (strategy ? strategy.summary : '未启用');

      const rotateProgressText = buildTaskPageRotateProgressText(progressSnapshot);

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
        { label: '回首页进度', value: rotateProgressText, className: 'full' },
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
        manualInitialSentAt: 0,
        lastManualContinueAt: 0,
        createdAt: ts,
        updatedAt: ts,
      };

      return Object.assign(base, overrides && typeof overrides === 'object' ? overrides : {});
    }

    const DEFAULT_SINGLE_QUESTION_STEP_TASK_PROMPT = `做下面题目，一次只回答一道题，分多次回答。

硬性规则：
1. 本次回复只回答当前尚未回答的第一道题。
2. 禁止一次性回答多道题。
3. 禁止把所有题目一次性列出答案。
4. 禁止输出解释、分析、总结、寒暄。
5. 回答格式固定为：原题=答案
6. 回答完当前这一道题后立刻停止，等待下一次继续指令。
7. 下一次收到继续指令时，再回答下一道尚未回答的题。
8. 只有当下面所有题目都已经逐题回答完成后，才允许回复终止信号。

题目：
1+1=
2+2=
3+3=
4+4=
5+5=
6+6=`;

    const DEFAULT_SINGLE_QUESTION_STEP_CONTINUE_PROMPT = `请继续完成上一个“分轮答题”任务。

你必须先回顾上文已经回答过哪些题目，然后只回答当前尚未回答的第一道题。

继续规则：
1. 本次回复只回答一道题。
2. 禁止一次性回答多道题。
3. 禁止重复已经回答过的题。
4. 禁止输出解释、分析、总结、寒暄。
5. 回答格式固定为：原题=答案
6. 如果 1+1、2+2、3+3、4+4、5+5、6+6 已经全部回答完成，只输出下面这一行：
{{DONE_SIGNAL}}

如果还有题目没有回答，不要输出终止信号，只回答下一道尚未回答的题。`;

    function createDefaultExampleTasks() {
      return [
        createDefaultTaskItem({
          title: '示例：分轮答题测试',
          initialPrompt: DEFAULT_SINGLE_QUESTION_STEP_PROMPT,
          continuePromptTemplate: DEFAULT_SINGLE_QUESTION_STEP_CONTINUE_PROMPT,
        }),
      ];
    }

    function isLegacyDefaultExampleTaskList(tasks) {
      if (!Array.isArray(tasks) || tasks.length !== 2) {
        return false;
      }

      const first = tasks[0] || {};
      const second = tasks[1] || {};

      return (
        String(first.title || '') === '示例：自我介绍'
        && String(first.initialPrompt || '') === '请用三句话介绍你自己。'
        && String(second.title || '') === '示例：总结能力'
        && String(second.initialPrompt || '') === '请列出你最擅长的 3 项能力。'
      );
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
        manualInitialSentAt: Math.max(0, Number(raw.manualInitialSentAt) || 0),
        lastManualContinueAt: Math.max(0, Number(raw.lastManualContinueAt) || 0),
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

          if (isLegacyDefaultExampleTaskList(tasks)) {
            tasks.splice(0, tasks.length, ...createDefaultExampleTasks());
            repairChanged = true;
            migrateNotes.push(`profile-${base.id}:replace-legacy-example-tasks-with-single-question-step-task`);
          }

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

        if (
          !rawTaskQueue.taskAutoUploadCountModeMigratedToMessage
          && rawTaskQueue.taskAutoUploadCountMode === 'taskItem'
        ) {
          rawTaskQueue.taskAutoUploadCountMode = 'message';
          rawTaskQueue.taskAutoUploadCountModeMigratedToMessage = true;
          repairChanged = true;
          ToolboxShell.appendLog(
            '[AUTOQ][TASK_AUTO_UPLOAD][MIGRATE_COUNT_MODE] from=taskItem to=message reason=user-expects-every-5-sends',
          );
        }

        const oldVerifyPrompt = String(rawTaskQueue.verifyAfterDoneSignalPrompt || '');
        const shouldMigrateVerifyPrompt = (
          oldVerifyPrompt.includes('当前任务内容：')
          || oldVerifyPrompt.includes('{{taskContent}}')
          || oldVerifyPrompt.includes('请根据我刚才上传的代码文件和当前任务要求')
        );
        if (shouldMigrateVerifyPrompt) {
          repairChanged = true;
          ToolboxShell.appendLog(
            '[AUTOQ][VERIFY_PROMPT][MIGRATE] reason=avoid-reanswering-full-task',
          );
        }

        config.taskQueueSettings = {
          ...taskQueueDefaults,
          ...rawTaskQueue,
          stopOnMaxContinueRounds: rawTaskQueue.stopOnMaxContinueRounds !== false,
          switchNewChatBetweenTasks: rawTaskQueue.switchNewChatBetweenTasks !== false,
          switchNewChatAfterAllDone: rawTaskQueue.switchNewChatAfterAllDone === true,
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
            rawTaskQueue.taskAutoUploadCountVerifyPrompt === true,

          taskAutoUploadCountMode:
            normalizeTaskAutoUploadCountMode(
              rawTaskQueue.taskAutoUploadCountMode
              || taskQueueDefaults.taskAutoUploadCountMode
              || 'message',
            ),

          taskAutoUploadCountModeMigratedToMessage:
            rawTaskQueue.taskAutoUploadCountModeMigratedToMessage === true,

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

          verifyAfterDoneSignalPrompt: shouldMigrateVerifyPrompt
            ? taskQueueDefaults.verifyAfterDoneSignalPrompt
            : String(
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
        logAutoQueueActionButtonDomState('switchPromptMode-same');
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

      logAutoQueueActionButtonDomState('switchPromptMode');
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
      tickIntervalMs: 0,
      tickerStartedAt: 0,
      replyBecameBusy: false,
      idleSince: 0,
      waitingStartedAt: 0,
      waitingNoBusyTimeoutMs: 45000,
      sendingNow: false,
      uploadingFromAutoQueue: false,
      autoQueueUploadCancelRequested: false,
      autoQueueUploadStatus: 'idle',
      autoQueueUploadStats: {
        uploaded: 0,
        failed: 0,
        skipped: 0,
        reason: '',
      },
      batchStartupGuardUntilMs: 0,
      taskRun: {
        enabledTaskIds: [],
        currentIndex: -1,
        pendingSendKind: null,
        pendingSendStartedAt: 0,
        lastPendingSendKindBeforeProcessing: null,
        doneSignalVerificationRunning: false,
        currentStep: 'idle',
        currentQuestionText: '',
        currentExpectedAnswer: '',
        currentReplyText: '',
        currentReplyStable: false,
        currentAnswerVerified: false,
        currentVerifyError: '',
        currentVerifyAttempt: 0,
        currentTaskQuestion: '',
        currentTaskQuestionText: '',
        currentTaskExpectedAnswer: '',
        currentTaskReplyText: '',
        currentTaskReplyStable: false,
        currentTaskAnswerVerified: false,
        currentTaskVerifyError: '',
        currentTaskVerifyAttempt: 0,
        lastVerifiedTaskIndex: -1,
        lastCompletedAnswerTaskIndex: -1,
        currentTaskRetryCount: 0,
        currentTaskReplyHash: '',
        currentTaskReplyHashStableCount: 0,
        currentTaskReplyMessageId: '',
        verifyReplyTextForResend: '',
        assistantReplyCountForUpload: 0,
        lastAssistantReplyCountedHash: '',
        lastAutoUploadAtAssistantReplyCount: 0,
      },
      taskBatchStepRunning: false,
      batchInitialWaitLoggedAt: 0,
      batchTask: {
        phase: 'idle',
        currentTaskIndex: -1,
        batchStep: '',
        stopRequested: false,
        forceStopRequested: false,
        stopFinalUploadRunning: false,
        abortController: null,
        displayState: 'idle',
        lastActiveAt: 0,
        watchdogRecoverStreak: 0,
        watchdogRecoverStreakPerTaskIndex: {},
        scheduledTimerId: null,
        scheduledTimerAction: '',
        scheduledTimerRunId: '',
      },
      lastBackgroundThrottleLogAt: 0,
      taskRateLimitLastLogAt: 0,
      taskUploadRateLimitLastLogAt: 0,
      lastSendNextBlockedLogAt: 0,
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

    const BATCH_TASK_GROUP_RECOVER_DELAY_MS = 5000;
    const BATCH_TASK_GROUP_WATCHDOG_STALL_MS = 60000;
    const BATCH_TASK_GROUP_MAX_TASK_FAIL_RETRIES = 3;
    const BATCH_TASK_GROUP_MAX_WATCHDOG_RECOVER_STREAK = 3;
    const BATCH_TASK_STARTUP_GUARD_MS = 1200;
    const TASK_REPLY_STABLE_HASH_ROUNDS = 2;

    const BATCH_TASK_GROUP_DISPLAY_STATE_LABELS = Object.freeze({
      starting_upload: '启动中（自动上传初始附件）',
      running: '运行中',
      waiting_reply: '等待回复',
      stopping: '正在停止',
      waiting_composer_idle: '等待输入框空闲',
      uploading: '上传中',
      recovering: '失败恢复中',
      paused: '已暂停',
      stopped: '已停止',
      completed: '已完成',
      failed: '调度异常',
    });

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
      reply_ready: new Set(['done', 'preparing', 'failed', 'cancelled', 'waiting_reply']),
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
      if (typeof findUploadGroupById === 'function') {
        return findUploadGroupById(groupId);
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

      reply.isStreaming = isChatGPTActuallyBusyForTaskQueue();

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
        ToolboxShell.appendLog('[AUTO_QUEUE][REPLY_WAIT] reason=reply is still streaming');
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
      state.autoQueueUploadCancelRequested = false;
      state.manualUploadRunning = false;
      state.batchAutoUploading = false;
      state.batchTaskRunning = false;
      logUploadBatchState('invalidate-auto-queue-run');
      if (state.batchTask) {
        state.batchTask.stopRequested = false;
        abortBatchTaskGroupScheduledTimer('invalidate-auto-queue-run');
      }
      if (state.tickTimer) {
        window.clearInterval(state.tickTimer);
        state.tickTimer = null;
        state.tickIntervalMs = 0;
      }
    }

    let root = null;
    let promptsEl = null;
    let logEl = null;
    let startBtn = null;
    let startUploadBtn = null;
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

    let _lastUserScrollAt = 0;
    const _USER_SCROLL_PROTECT_MS = 10 * 60 * 1000;
    let _scrollProtectListenersAttached = false;

    function _attachScrollProtectListeners() {
      if (_scrollProtectListenersAttached) return;
      _scrollProtectListenersAttached = true;
      const toolboxContainer = getToolboxScrollContainer();
      if (toolboxContainer && toolboxContainer.addEventListener) {
        toolboxContainer.addEventListener('scroll', () => {
          _lastUserScrollAt = Date.now();
        }, { passive: true });
      }
      if (root && root.addEventListener) {
        root.addEventListener('scroll', () => {
          _lastUserScrollAt = Date.now();
        }, { passive: true, capture: true });
      }
    }

    function _isUserScrollProtected() {
      return _lastUserScrollAt > 0 && (Date.now() - _lastUserScrollAt) < _USER_SCROLL_PROTECT_MS;
    }

    function snapshotBatchScrollState() {
      _attachScrollProtectListeners();
      const toolboxScroll = getToolboxScrollContainer();
      const bodyScroll = document.scrollingElement || document.documentElement;
      const contentScroll = root
        ? root.querySelector('.cgpt-autoq-batch-subtab-content')
        : null;
      const taskListScroll = root
        ? root.querySelector('.cgpt-autoq-task-list, [data-cgpt-task-list]')
        : null;
      const logScroll = root
        ? root.querySelector('.cgpt-autoq-log-content, .cgpt-log-panel, [data-cgpt-log-panel]')
        : null;

      return {
        toolboxScroll,
        toolboxTop: toolboxScroll ? toolboxScroll.scrollTop : 0,
        bodyScroll,
        bodyTop: bodyScroll ? bodyScroll.scrollTop : 0,
        contentScroll,
        contentTop: contentScroll ? contentScroll.scrollTop : 0,
        taskListScroll,
        taskListTop: taskListScroll ? taskListScroll.scrollTop : 0,
        logScroll,
        logTop: logScroll ? logScroll.scrollTop : 0,
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

    function restoreBatchScrollState(snapshot, reason = '', opts = {}) {
      if (!snapshot || typeof snapshot !== 'object') {
        return;
      }

      const isAutoRefresh = opts.isAutoRefresh !== false;
      if (isAutoRefresh && _isUserScrollProtected()) {
        const lastUserScrollAgo = Date.now() - _lastUserScrollAt;
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX_SCROLL][SKIP_AUTO_SCROLL] reason=${reason || '-'} lastUserScrollAgo=${lastUserScrollAgo}ms`,
          );
        }
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

        if (snapshot.taskListScroll) {
          snapshot.taskListScroll.scrollTop = snapshot.taskListTop;
        }

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX_SCROLL][RESTORE] reason=${reason || '-'} main=${snapshot.toolboxTop} autoq=${snapshot.contentTop} taskList=${snapshot.taskListTop}`,
          );
        }
      });
    }

    function saveAndRestoreScrollAroundRender(reason, renderFn, opts = {}) {
      const snapshot = snapshotBatchScrollState();
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[TOOLBOX_SCROLL][SAVE] reason=${reason || '-'} main=${snapshot.toolboxTop} autoq=${snapshot.contentTop} taskList=${snapshot.taskListTop}`,
        );
      }
      try {
        renderFn();
      } catch (err) {
        console.error('[AutoQueue] saveAndRestoreScrollAroundRender renderFn failed', err);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[TOOLBOX_SCROLL][RENDER_ERROR] reason=${reason} error=${err && err.message ? err.message : String(err)}`);
        }
      }
      restoreBatchScrollState(snapshot, reason, opts);
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
        currentQuestionText: '',
        currentExpectedAnswer: '',
        currentReplyText: '',
        currentReplyStable: false,
        currentAnswerVerified: false,
        currentVerifyError: '',
        currentVerifyAttempt: 0,
        currentTaskQuestion: '',
        currentTaskQuestionText: '',
        currentTaskExpectedAnswer: '',
        currentTaskReplyText: '',
        currentTaskReplyStable: false,
        currentTaskAnswerVerified: false,
        currentTaskVerifyError: '',
        currentTaskVerifyAttempt: 0,
        lastVerifiedTaskIndex: -1,
        lastCompletedAnswerTaskIndex: -1,
        currentTaskRetryCount: 0,
        currentTaskReplyHash: '',
        currentTaskReplyHashStableCount: 0,
        currentTaskReplyMessageId: '',
        verifyReplyTextForResend: '',

        // 当前批量任务组本次运行中，实际成功发送到 ChatGPT 的总对话次数。
        totalSentDialogueCount: 0,

        // 自动上传节奏计数。这个值用于“每 N 次对话自动上传”，不要当作总发送次数展示。
        sentMessageCount: 0,
        completedAnswerCount: 0,
        assistantReplyCountForUpload: 0,
        lastAssistantReplyCountedHash: '',
        lastAutoUploadAtAssistantReplyCount: 0,

        lastAutoUploadAtMessageCount: 0,

        sentInCurrentChatCount: 0,
        lastNewChatRotationAtTotalSentDialogueCount: 0,
        lastNewChatRotationAt: 0,
        newChatRotationCount: 0,
        forceUploadBeforeNextSend: false,
        lastRotatedConversationKey: '',
        visibleDoneSignalText: '',
        visibleDoneSignalSeenAt: 0,
        currentTaskFailCount: 0,
      };
    }

    function formatTaskRunErrorContext(run, task) {
      return `taskIndex=${Number(run && run.currentIndex) + 1} `
        + `taskId=${task && task.id ? task.id : '-'} `
        + `batchRunId=${getBatchTaskGroupRunId() || '-'}`;
    }

    function logTaskRunError(scope, error, taskOverride = null) {
      const run = state.taskRun || {};
      const task = taskOverride || getCurrentRunningTask();
      const name = error && error.name ? String(error.name) : 'Error';
      const message = error && error.message ? String(error.message) : String(error);
      const stack = error && error.stack ? String(error.stack) : '';
      const context = formatTaskRunErrorContext(run, task);
      console.error(scope, {
        error_type: name,
        error: message,
        stack,
        taskIndex: Number(run.currentIndex) + 1,
        taskId: task && task.id ? task.id : '-',
        batchRunId: getBatchTaskGroupRunId() || '-',
      });
      ToolboxShell.appendLog(
        `${scope} error.name=${name} error.message=${message} error.stack=${stack || '-'} ${context}`,
      );
    }

    function ensureTaskRunVerificationFields(run) {
      const target = run && typeof run === 'object'
        ? run
        : (state.taskRun && typeof state.taskRun === 'object' ? state.taskRun : {});
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskQuestion')) target.currentTaskQuestion = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskQuestionText')) target.currentTaskQuestionText = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskExpectedAnswer')) target.currentTaskExpectedAnswer = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskReplyText')) target.currentTaskReplyText = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskReplyStable')) target.currentTaskReplyStable = false;
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskAnswerVerified')) target.currentTaskAnswerVerified = false;
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskVerifyError')) target.currentTaskVerifyError = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskVerifyAttempt')) target.currentTaskVerifyAttempt = 0;
      if (!Object.prototype.hasOwnProperty.call(target, 'lastVerifiedTaskIndex')) target.lastVerifiedTaskIndex = -1;
      if (!Object.prototype.hasOwnProperty.call(target, 'lastCompletedAnswerTaskIndex')) target.lastCompletedAnswerTaskIndex = -1;
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskRetryCount')) target.currentTaskRetryCount = 0;
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskReplyHash')) target.currentTaskReplyHash = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskReplyHashStableCount')) target.currentTaskReplyHashStableCount = 0;
      if (!Object.prototype.hasOwnProperty.call(target, 'currentTaskReplyMessageId')) target.currentTaskReplyMessageId = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'verifyReplyTextForResend')) target.verifyReplyTextForResend = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'assistantReplyCountForUpload')) target.assistantReplyCountForUpload = 0;
      if (!Object.prototype.hasOwnProperty.call(target, 'lastAssistantReplyCountedHash')) target.lastAssistantReplyCountedHash = '';
      if (!Object.prototype.hasOwnProperty.call(target, 'lastAutoUploadAtAssistantReplyCount')) target.lastAutoUploadAtAssistantReplyCount = 0;
      return target;
    }

    function resetCurrentTaskVerificationState(run, options = {}) {
      const target = ensureTaskRunVerificationFields(run);
      target.currentTaskQuestionText = '';
      target.currentTaskExpectedAnswer = '';
      target.currentTaskReplyText = '';
      target.currentTaskReplyStable = false;
      target.currentTaskAnswerVerified = false;
      target.currentTaskVerifyError = '';
      target.currentTaskVerifyAttempt = 0;
      target.currentTaskReplyHash = '';
      target.currentTaskReplyHashStableCount = 0;
      target.currentTaskReplyMessageId = '';
      target.verifyReplyTextForResend = '';
      if (options.keepRetryCount === true) {
        target.currentTaskRetryCount = Math.max(0, Number(target.currentTaskRetryCount) || 0);
      } else {
        target.currentTaskRetryCount = 0;
      }
      return target;
    }

    function getTaskQuestionText(task) {
      const resolvedInitial = resolveTaskInitialPrompt(task, { log: false });
      return String(
        resolvedInitial && resolvedInitial.initialPrompt
          ? resolvedInitial.initialPrompt
          : (
            task && (task.prompt || task.content || task.initialPrompt || task.title || '')
          ),
      ).trim();
    }

    function normalizeTaskQuestionForVerify(question) {
      return String(question || '')
        .replace(/\s+/g, '')
        .trim();
    }

    function computeSimpleTextHash(text) {
      const input = String(text || '');
      let hash = 2166136261;
      for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    }

    function deriveMathExpectedAnswerFromQuestion(question) {
      const compact = normalizeTaskQuestionForVerify(question);
      const match = compact.match(/(-?\d+(?:\.\d+)?)\+(-?\d+(?:\.\d+)?)=/);
      if (!match) {
        return {
          supported: false,
          expected: '',
          reason: 'unsupported_question_pattern',
        };
      }
      const left = Number(match[1]);
      const right = Number(match[2]);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return {
          supported: false,
          expected: '',
          reason: 'invalid_math_operands',
        };
      }
      const expectedValue = left + right;
      return {
        supported: true,
        expected: String(expectedValue),
        reason: 'math_sum',
      };
    }

    function extractNumbersFromAssistantReply(text) {
      const matches = String(text || '').match(/-?\d+(?:\.\d+)?/g);
      return Array.isArray(matches) ? matches : [];
    }

    function verifyCurrentTaskAnswer(question, replyText, expectedAnswer) {
      const expectedText = String(expectedAnswer || '').trim();
      const actualText = String(replyText || '').trim();
      if (!actualText) {
        return {
          ok: false,
          reason: 'reply_empty',
          actualText,
          expected: expectedText,
          supported: true,
        };
      }
      const derived = deriveMathExpectedAnswerFromQuestion(question);
      if (!expectedText && !derived.supported) {
        return {
          ok: true,
          reason: 'no_verifier_available',
          actualText,
          expected: '',
          supported: false,
        };
      }
      const finalExpected = expectedText || String(derived.expected || '').trim();
      if (!finalExpected) {
        return {
          ok: false,
          reason: 'expected_answer_empty',
          actualText,
          expected: '',
          supported: derived.supported,
        };
      }
      const numbers = extractNumbersFromAssistantReply(actualText);
      const passed = numbers.includes(finalExpected)
        || actualText.includes(finalExpected);
      return {
        ok: passed,
        reason: passed ? 'answer_match' : 'answer_mismatch',
        actualText,
        expected: finalExpected,
        supported: true,
      };
    }

    function syncCurrentTaskVerificationContext(task, options = {}) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const question = getTaskQuestionText(task);
      const expected = deriveMathExpectedAnswerFromQuestion(question);
      const previousQuestion = String(run.currentTaskQuestion || '');
      const questionChanged = previousQuestion !== question;
      run.currentTaskQuestion = question;
      run.currentTaskQuestionText = question;
      run.currentTaskExpectedAnswer = expected.supported ? String(expected.expected || '').trim() : '';
      if (questionChanged || options.resetState === true) {
        resetCurrentTaskVerificationState(run, {
          keepRetryCount: options.keepRetryCount === true,
        });
        run.currentTaskQuestionText = question;
        run.currentTaskExpectedAnswer = expected.supported ? String(expected.expected || '').trim() : '';
      }
      state.taskRun = run;
      return run;
    }

    const VISIBLE_DONE_SIGNAL_STABLE_MS = 1200;

    const WAIT_REPLY_REPAIR_STEPS = new Set([
      'wait-current-reply',
      'send-initial',
      'wait-initial-reply',
      'wait-next-reply',
      'check-done-signal',
    ]);

    const autoQueuePollLogThrottle = new Map();

    function appendAutoQueuePollLogThrottled(key, text) {
      const debugMode = !!(config && config.debugMode);
      const intervalMs = debugMode ? 1000 : 3000;
      const now = Date.now();
      const last = Number(autoQueuePollLogThrottle.get(key) || 0);
      if (now - last < intervalMs) {
        return;
      }
      autoQueuePollLogThrottle.set(key, now);
      ToolboxShell.appendLog(text);
    }

    function isChatGPTActuallyBusyForTaskQueue() {
      const assistantBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      const hasStopButton = typeof hasRealChatGPTStopGeneratingButton === 'function'
        && hasRealChatGPTStopGeneratingButton();

      let bridgeGenerating = false;
      let bridgeAssistantBusy = false;
      let detectBusy = false;
      let responseStateText = '-';
      let responseReasonText = '-';

      if (typeof BridgeState !== 'undefined' && BridgeState) {
        responseStateText = String(BridgeState.response_state || '-');
        responseReasonText = String(BridgeState.response_state_reason || '-');
        bridgeGenerating = BridgeState.response_state === 'generating'
          || BridgeState.response_state === 'streaming';
        bridgeAssistantBusy = BridgeState.response_state_reason === 'assistant_busy';
      }

      if (typeof detectComposerResponseState === 'function') {
        try {
          const responseState = detectComposerResponseState({ light: true });
          responseStateText = String(responseState.response_state || responseStateText);
          responseReasonText = String(responseState.response_state_reason || responseReasonText);
          detectBusy = Boolean(
            responseState.is_responding === true
            || responseState.response_state === 'generating'
            || responseState.response_state === 'streaming'
            || responseState.response_state_reason === 'assistant_busy'
          );
        } catch (error) {
          console.error('[AUTOQ][BUSY_CHECK][detectComposerResponseState]', error);
          appendAutoQueuePollLogThrottled(
            'busy-check-detect-error',
            `[AUTOQ][BUSY_CHECK][detectComposerResponseState] error=${error && error.message ? error.message : String(error)}`,
          );
        }
      }

      const composerSendButtonWait = isComposerSendButtonWaitBlocking();

      const busy = Boolean(
        assistantBusy
        || hasStopButton
        || bridgeGenerating
        || bridgeAssistantBusy
        || detectBusy
        || composerSendButtonWait
      );

      appendAutoQueuePollLogThrottled(
        'busy-check',
        `[AUTOQ][BUSY_CHECK] assistantBusy=${assistantBusy ? 1 : 0} `
        + `stopButton=${hasStopButton ? 1 : 0} `
        + `bridgeGenerating=${bridgeGenerating ? 1 : 0} `
        + `bridgeAssistantBusy=${bridgeAssistantBusy ? 1 : 0} `
        + `detectBusy=${detectBusy ? 1 : 0} `
        + `composerSendButtonWait=${composerSendButtonWait ? 1 : 0} `
        + `response_state=${responseStateText} reason=${responseReasonText}`,
      );

      return busy;
    }

    const SEND_BUTTON_WAIT_RETRY_REASONS = new Set([
      'send_button_not_ready',
      'send_button_not_ready_after_text',
      'send_button_not_ready_with_attachment',
      'waiting_attachment_upload_done',
      'enter_fallback_blocked_with_attachment',
      'payload_ready_but_send_button_missing',
      'attachment_ready_but_send_button_missing',
      'attachment_processing',
      'send_button_disabled_with_payload',
      'send_button_not_found',
      'send_button_disabled',
      'send_button_wait_timeout',
    ]);

    const ILLEGAL_WAITING_REPLY_PENDING_SEND_KINDS = new Set([
      'initial',
      'verification',
      'processing',
    ]);

    function getComposerPayloadEvidenceForAutoQueue() {
      const snapshot = typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
        ? ComposerApi.getComposerRuntimeSnapshotLight(500)
        : null;
      const composerText = snapshot
        ? String(snapshot.composerTextTrimmed || '')
        : (
          typeof ComposerApi.getComposerText === 'function'
            ? String(ComposerApi.getComposerText() || '').trim()
            : ''
        );
      const textLen = composerText.length;
      const hasAttachment = snapshot
        ? Number(snapshot.attachmentCount || 0) > 0
        : (
          typeof ComposerApi.countAttachmentChipsFast === 'function'
            ? ComposerApi.countAttachmentChipsFast() > 0
            : (
              typeof ComposerApi.countAttachmentChips === 'function'
                ? ComposerApi.countAttachmentChips() > 0
                : false
            )
        );
      return { composerText, textLen, hasAttachment };
    }

    function isComposerSendButtonWaitBlocking() {
      if (typeof detectComposerResponseState !== 'function') {
        return false;
      }

      let responseState;
      try {
        responseState = detectComposerResponseState({ light: true });
      } catch (error) {
        console.error('[AUTOQ][SEND_BUTTON_WAIT_CHECK]', error);
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_BUTTON_WAIT_CHECK] error=${error && error.message ? error.message : String(error)}`,
        );
        return false;
      }

      const reason = String(responseState.response_state_reason || '').trim();
      const responseStateName = String(responseState.response_state || '').trim();
      const reasonBlocks = typeof isSendButtonWaitResponseState === 'function'
        ? isSendButtonWaitResponseState(responseState)
        : (
          SEND_BUTTON_WAIT_RETRY_REASONS.has(reason)
          || responseStateName === 'attachment_processing'
          || (
            responseStateName === 'not_ready'
            && /send_button|attachment_ready|payload_ready/.test(reason)
          )
          || (
            responseStateName === 'composing'
            && responseState.can_send_now === false
            && responseState.has_composer_payload === true
          )
        );

      if (!reasonBlocks) {
        return false;
      }

      // When send_button_not_found but input is still available (can_accept_input=1),
      // do not block the task group. The send pipeline will fill text and re-check.
      // This prevents background-tab zero-rect button checks from stalling the batch.
      if (reason === 'send_button_not_found' || reason === 'send_button_disabled') {
        const canInput = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.canAcceptInput === 'function'
          && ComposerApi.canAcceptInput();
        const assistantNotBusy = !isChatGPTActuallyBusyForTaskQueue();
        if (canInput && assistantNotBusy) {
          // NOTE: actual sendable re-check happens after we write the next prompt into composer
          // (see writeAndVerifyComposerForBatch). Do not block here.
          return false;
        }
      }

      const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
        ? getComposerSendButtonSnapshot({ silent: true })
        : { ready: false };
      if (sendSnap.ready === true) {
        return false;
      }

      const evidence = getComposerPayloadEvidenceForAutoQueue();
      return evidence.textLen > 0 || evidence.hasAttachment;
    }

    function holdTaskUntilSendButtonReady(task, reason) {
      const currentTask = task || getCurrentRunningTask();
      setTaskBatchStep('send-wait-button', currentTask, { log: false });
      const delayMs = 1500;
      state.nextSendAt = Date.now() + delayMs;
      const run = state.taskRun || {};
      run.nextSendRetryAt = state.nextSendAt;
      state.taskRun = run;
      ToolboxShell.appendLog(
        `[AUTOQ][SEND_BUTTON_WAIT] reason=${String(reason || '-')} nextSendAt=${state.nextSendAt} `
        + `task=${currentTask ? currentTask.title : '-'}`,
      );
      updateStatus('send-button-not-ready-wait');
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }
    }

    function isRawAssistantBusyForStateRepair() {
      const assistantBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();
      const hasStopButton = typeof hasRealChatGPTStopGeneratingButton === 'function'
        && hasRealChatGPTStopGeneratingButton();
      let bridgeGenerating = false;
      if (typeof BridgeState !== 'undefined' && BridgeState) {
        bridgeGenerating = BridgeState.response_state === 'generating'
          || BridgeState.response_state === 'streaming';
      }
      return Boolean(assistantBusy || hasStopButton || bridgeGenerating);
    }

    function repairIllegalWaitingReplyPendingSendState(reason) {
      if (config.promptMode !== 'task' || !state.running) {
        return false;
      }

      if (!state.waitingReply) {
        return false;
      }

      const run = state.taskRun || {};
      const pendingKind = String(run.pendingSendKind || '');
      if (!ILLEGAL_WAITING_REPLY_PENDING_SEND_KINDS.has(pendingKind)) {
        return false;
      }

      if (isRawAssistantBusyForStateRepair()) {
        return false;
      }

      const evidence = getComposerPayloadEvidenceForAutoQueue();
      if (!evidence.hasAttachment && evidence.textLen <= 0) {
        return false;
      }

      const preservedKind = pendingKind || 'initial';
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.sendingNow = false;
      state.taskBatchStepRunning = false;
      state.nextSendAt = Date.now() + 1500;
      run.pendingSendKind = preservedKind;
      run.nextSendRetryAt = state.nextSendAt;
      state.taskRun = run;

      const task = getCurrentRunningTask();
      setTaskBatchStep('send-wait-button', task, { log: false });

      ToolboxShell.appendLog(
        `[AUTOQ][STATE_REPAIR][WAITING_REPLY_WITH_PENDING_SEND] reason=${String(reason || '-')} `
        + `pendingSendKind=${preservedKind} hasAttachment=${evidence.hasAttachment ? 1 : 0} `
        + `textLen=${evidence.textLen} action=back-to-send-wait`,
      );

      updateStatus('waiting-reply-pending-send-repair');
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }
      return true;
    }

    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.isChatGPTActuallyBusyForTaskQueue = isChatGPTActuallyBusyForTaskQueue;
      }
    } catch (exposeErr) {
      console.error('[AUTOQ][EXPOSE_BUSY_CHECK_FAILED]', exposeErr);
    }

    function repairWaitingReplyForAssistantBusy(reason) {
      if (config.promptMode !== 'task' || !state.running) {
        return false;
      }

      if (!isChatGPTActuallyBusyForTaskQueue()) {
        return false;
      }

      const task = getCurrentRunningTask();
      const run = state.taskRun;

      if (!task || !run) {
        return false;
      }

      const forceBackToWaiting = state.phase === AUTO_QUEUE_PHASES.REPLY_READY;
      const runStep = String(run.currentStep || '');

      if (!forceBackToWaiting && !WAIT_REPLY_REPAIR_STEPS.has(runStep)) {
        return false;
      }

      if (
        state.waitingReply
        && state.phase === AUTO_QUEUE_PHASES.WAITING_REPLY
        && !forceBackToWaiting
      ) {
        return false;
      }

      state.waitingReply = true;
      state.replyBecameBusy = true;
      state.waitingStartedAt = state.waitingStartedAt || Date.now();
      setTaskBatchStep('wait-current-reply', task, { log: false });
      setAutoQueuePhase(
        AUTO_QUEUE_PHASES.WAITING_REPLY,
        'await-assistant',
        { force: forceBackToWaiting },
      );

      if (forceBackToWaiting) {
        ToolboxShell.appendLog(
          `[AUTOQ][PHASE_REPAIR][REPLY_READY_TO_WAITING] task=${task.title} reason=assistant-still-busy force=1`,
        );
      }

      ToolboxShell.appendLog(
        `[AUTOQ][WAITING_REPLY_REPAIR] task=${task.title} step=${runStep} `
        + `pendingSendKind=${run.pendingSendKind || '-'} reason=${reason}`,
      );

      updateStatus('waiting-reply-repair');
      updateChatInputStateBadge();
      return true;
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

      if (isChatGPTActuallyBusyForTaskQueue()) {
        return;
      }

      const task = getCurrentRunningTask();

      if (!task) {
        return;
      }

      let replyText = '';

      try {
        const snapshot = buildAssistantReplySnapshot();
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

      const profile = getActiveTaskProfile();
      const resolved = resolveTaskContinueSettings(task, profile, { log: false });
      const doneCheck = isTaskDoneSignalMatched(replyText, resolved.actualDoneSignal);

      if (doneCheck.corrupted) {
        clearVisibleDoneSignalTracking();
        failCurrentTask('corrupted-assistant-signal');
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
        ToolboxShell.appendLog(
          `[AUTOQ][VISIBLE_DONE_SIGNAL][SEEN] task=${task.title} stableMs=0 trigger=${triggerReason || '-'}`,
        );
        return;
      }

      const stableMs = Math.max(0, now - prevSeenAt);

      ToolboxShell.appendLog(
        `[AUTOQ][VISIBLE_DONE_SIGNAL][SEEN] task=${task.title} stableMs=${stableMs} trigger=${triggerReason || '-'}`,
      );

      if (stableMs < VISIBLE_DONE_SIGNAL_STABLE_MS) {
        return;
      }

      clearVisibleDoneSignalTracking();
      ToolboxShell.appendLog(
        `[AUTOQ][VISIBLE_DONE_SIGNAL][SETTLE] task=${task.title} reason=visible-done-signal-while-busy`,
      );
      void onAssistantReplySettled(replyText, { reason: 'visible-done-signal-while-busy' });
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
          const resolved = resolveTaskInitialPrompt(task, { log: false });
          if (resolved && String(resolved.initialPrompt || '').trim()) {
            return String(resolved.initialPrompt || '').trim();
          }
        }
      } catch (error) {
        logTaskRunError('[TASK_VERIFY][QUESTION_RESOLVE_ERROR]', error, task);
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
        ToolboxShell.appendLog(
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
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
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
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
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

      const replyHash = computeSimpleTextHash(reply);

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
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0);
      const source = String(meta && meta.source ? meta.source : '-');
      const reply = getCurrentTaskReplyTextForVerify(task, replyText);
      const questionText = String(run.currentTaskQuestionText || getTaskQuestionTextForVerify(task) || '').trim();
      const responseState = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState({ light: true })
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

      ToolboxShell.appendLog(
        `[TASK_VERIFY][START] taskIndex=${taskIndex + 1} question=${JSON.stringify(questionText)}`,
      );

      ToolboxShell.appendLog(
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
        ToolboxShell.appendLog(
          `[TASK_VERIFY][EXPECTED] expected=-`,
        );
        ToolboxShell.appendLog(
          `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
        );
        ToolboxShell.appendLog(
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
          ToolboxShell.appendLog(
            `[TASK_VERIFY][EXPECTED] expected=-`,
          );
          ToolboxShell.appendLog(
            `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
          );
          ToolboxShell.appendLog(
            `[TASK_VERIFY][FAIL] taskIndex=${taskIndex + 1} reason=${result.reason || 'no-verifier'} strict=1`,
          );
          return {
            ok: false,
            reason: result.reason || 'no-verifier',
          };
        }

        run.currentTaskAnswerVerified = true;
        run.currentTaskVerifyError = '';
        run.lastVerifiedTaskIndex = taskIndex;
        run.currentAnswerVerified = true;
        run.currentVerifyError = '';

        ToolboxShell.appendLog(
          `[TASK_VERIFY][EXPECTED] expected=-`,
        );
        ToolboxShell.appendLog(
          `[TASK_VERIFY][ACTUAL] actual=- replyText=${JSON.stringify(reply)}`,
        );
        ToolboxShell.appendLog(
          `[TASK_VERIFY][SKIP] taskIndex=${taskIndex + 1} reason=${result.reason || 'no-verifier'} strict=0`,
        );

        return {
          ok: true,
          skipped: true,
          reason: result.reason || 'no-verifier',
        };
      }

      ToolboxShell.appendLog(
        `[TASK_VERIFY][EXPECTED] expected=${result.expected || '-'}`,
      );

      ToolboxShell.appendLog(
        `[TASK_VERIFY][ACTUAL] actual=${result.actual || '-'} replyText=${JSON.stringify(reply)}`,
      );

      if (!result.ok) {
        run.currentTaskAnswerVerified = false;
        run.currentTaskVerifyError = result.reason || 'answer-mismatch';
        run.currentAnswerVerified = false;
        run.currentVerifyError = result.reason || 'answer-mismatch';

        ToolboxShell.appendLog(
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

      ToolboxShell.appendLog(
        `[TASK_VERIFY][PASS] taskIndex=${taskIndex + 1} expected=${result.expected || '-'} actual=${result.actual || '-'}`,
      );

      return {
        ok: true,
        reason: 'verified',
        expected: result.expected,
        actual: result.actual,
      };
    }

    function canAdvanceToNextTaskAfterVerify(task, replyText, meta = {}) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const source = String(meta && meta.source ? meta.source : '-');
      const taskIndex = Number(run.currentIndex || 0);
      const ctx = meta && typeof meta === 'object' ? meta : {};
      const responseStateText = String(
        ctx.responseState != null
          ? ctx.responseState
          : (
            typeof detectComposerResponseState === 'function'
              ? ((detectComposerResponseState({ light: true }) || {}).response_state || '')
              : ''
          ),
      ).trim().toLowerCase();
      const running = ctx.running != null ? !!ctx.running : !!state.running;
      const waitingReply = ctx.waitingReply != null ? !!ctx.waitingReply : !!state.waitingReply;
      const finalReplyText = getCurrentTaskReplyTextForVerify(task, replyText, {
        preferOriginalTaskReply: ctx.preferOriginalTaskReply === true,
      });
      const stableState = updateCurrentTaskReplyStableState(finalReplyText);

      run.currentReplyText = finalReplyText;
      run.currentReplyStable = !!stableState.stable;
      run.currentQuestionText = String(run.currentTaskQuestionText || getTaskQuestionTextForVerify(task) || '').trim();
      run.currentExpectedAnswer = String(run.currentTaskExpectedAnswer || '').trim();
      run.currentVerifyAttempt = Math.max(
        Number(run.currentVerifyAttempt) || 0,
        Number(run.currentTaskVerifyAttempt) || 0,
      );

      if (!running) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'not-running';
        ToolboxShell.appendLog(
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
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=waiting-reply source=${source}`,
        );
        return {
          ok: false,
          reason: 'waiting-reply',
        };
      }

      if (responseStateText === 'generating') {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'assistant-still-busy';
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=assistant-still-busy source=${source}`,
        );
        return {
          ok: false,
          reason: 'assistant-still-busy',
        };
      }

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = 'assistant-still-busy';
        ToolboxShell.appendLog(
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
        ToolboxShell.appendLog(
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
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=reply-not-stable `
          + `stableCount=${stableState.stableCount}/${stableState.required || TASK_REPLY_STABLE_HASH_ROUNDS} source=${source}`,
        );
        return {
          ok: false,
          reason: 'reply-not-stable',
        };
      }

      const verify = verifyCurrentTaskAnswerBeforeAdvance(task, finalReplyText, {
        source,
      });

      if (!verify.ok) {
        run.currentAnswerVerified = false;
        run.currentVerifyError = String(verify.reason || 'not-verified');
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex + 1} reason=${verify.reason || 'not-verified'} source=${source}`,
        );
        return verify;
      }

      run.currentAnswerVerified = true;
      run.currentVerifyError = '';
      ToolboxShell.appendLog(
        `[TASK_ADVANCE][ALLOW] taskIndex=${taskIndex + 1} reason=answer-verified source=${source}`,
      );

      return {
        ok: true,
        reason: 'answer-verified',
      };
    }

    function recordCurrentTaskAnswerCompletedOnce(task, source = '-') {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0);

      if (Number(run.lastCompletedAnswerTaskIndex) === taskIndex) {
        ToolboxShell.appendLog(
          `[TASK_VERIFY][ANSWER_COUNT_SKIP] taskIndex=${taskIndex + 1} reason=already-counted source=${source}`,
        );
        return;
      }

      run.completedAnswerCount = Math.max(
        0,
        Number(run.completedAnswerCount) || 0,
      ) + 1;

      run.lastCompletedAnswerTaskIndex = taskIndex;

      ToolboxShell.appendLog(
        `[TASK_VERIFY][ANSWER_COUNT] taskIndex=${taskIndex + 1} completedAnswerCount=${run.completedAnswerCount} `
        + `task=${task && task.title ? task.title : '-'} source=${source}`,
      );
    }

    function recordAssistantReplyForUploadCounter(replyText, source = '-', doneSignal = TASK_DONE_SIGNAL) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const text = normalizeReplyText(replyText);

      if (!text) {
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][REPLY_COUNT_SKIP_EMPTY] source=${source}`);
        return false;
      }

      if (isChatGPTActuallyBusyForTaskQueue()) {
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][REPLY_COUNT_SKIP_BUSY] source=${source}`);
        return false;
      }

      const doneCheck = isTaskDoneSignalMatched(text, doneSignal);
      if (doneCheck.corrupted) {
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][REPLY_COUNT_SKIP_CORRUPTED] source=${source}`);
        return false;
      }

      if (doneCheck.matched) {
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][REPLY_COUNT_SKIP_DONE] source=${source}`);
        return false;
      }

      const replyHash = computeSimpleTextHash(text);
      if (!replyHash) {
        return false;
      }

      if (String(run.lastAssistantReplyCountedHash || '') === replyHash) {
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][REPLY_COUNT_SKIP_DUPLICATE] source=${source} hash=${replyHash}`);
        return false;
      }

      run.assistantReplyCountForUpload = Math.max(
        0,
        Number(run.assistantReplyCountForUpload) || 0,
      ) + 1;
      run.lastAssistantReplyCountedHash = replyHash;

      ToolboxShell.appendLog(
        `[AUTOQ][CLOSED_LOOP][REPLY_COUNT] count=${run.assistantReplyCountForUpload} source=${source} hash=${replyHash}`,
      );

      return true;
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

      recordTaskBatchStopReason(stopReason, {
        sendReason: decision.reason,
        replyClassifyStatus: decision.status,
      });
      skipCurrentTaskWithFailure(stopReason, { replyClassifyStatus: decision.status });
      updateStatus('reply-classify-skip-task');
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

      recordTaskBatchStopReason(stopReason, {
        sendReason: classifyReason,
        replyClassifyStatus: status,
      });
      skipCurrentTaskWithFailure(stopReason, { replyClassifyStatus: status });
      updateStatus('copy-hotkey-terminal-skip-task');
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
      recoverBatchTaskGroup(getBatchTaskGroupRunId(), errText || 'move-next-task-failed', {
        action: 'recover',
        clearStepRunning: true,
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
        currentQuestionText: '',
        currentExpectedAnswer: '',
        currentReplyText: '',
        currentReplyStable: false,
        currentAnswerVerified: false,
        currentVerifyError: '',
        currentVerifyAttempt: 0,
        currentTaskQuestion: '',
        currentTaskQuestionText: '',
        currentTaskExpectedAnswer: '',
        currentTaskReplyText: '',
        currentTaskReplyStable: false,
        currentTaskAnswerVerified: false,
        currentTaskVerifyError: '',
        currentTaskVerifyAttempt: 0,
        lastVerifiedTaskIndex: -1,
        lastCompletedAnswerTaskIndex: -1,
        currentTaskRetryCount: 0,
        currentTaskReplyHash: '',
        currentTaskReplyHashStableCount: 0,
        currentTaskReplyMessageId: '',

        // 当前批量任务组本次运行中，实际成功发送到 ChatGPT 的总对话次数。
        totalSentDialogueCount: 0,

        // 自动上传节奏计数。
        sentMessageCount: 0,
        completedAnswerCount: 0,
        assistantReplyCountForUpload: 0,
        lastAssistantReplyCountedHash: '',
        lastAutoUploadAtAssistantReplyCount: 0,

        lastAutoUploadAtMessageCount: 0,

        sentInCurrentChatCount: 0,
        lastNewChatRotationAtTotalSentDialogueCount: 0,
        lastNewChatRotationAt: 0,
        newChatRotationCount: 0,
        forceUploadBeforeNextSend: false,
        lastRotatedConversationKey: '',
        visibleDoneSignalText: '',
        visibleDoneSignalSeenAt: 0,
        currentTaskFailCount: 0,
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
      ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][START] total=${runnable.length} profile=${profile ? profile.name : '-'}`);
      log(`批量任务组任务开始，共 ${runnable.length} 个任务`);
      syncCurrentTaskVerificationContext(runnable[0] || null, { resetState: true });
      setTaskBatchStep('send-initial', runnable[0] || null);
      touchBatchTaskGroupActivity('prepare-queue');
      setBatchTaskGroupDisplayState('running', 'prepare-queue');

      return true;
    }

    async function moveToNextTask(reason = 'move-to-next-task', options = {}) {
      if (options.skipGate !== true) {
        const advanceResult = await maybeAdvanceToNextTask(reason, {
          task: getCurrentRunningTask(),
        });
        return !!(advanceResult && advanceResult.advanced);
      }

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        repairWaitingReplyForAssistantBusy('move-next-blocked-assistant-busy');
        return false;
      }

      const run = state.taskRun || {};
      const nextIndex = Number(run.currentIndex) + 1;
      const fromReason = String(reason || 'move-to-next-task');

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][TASK_ADVANCE] from=${Number(run.currentIndex || 0)} to=${nextIndex} `
        + `reason=${fromReason} total=${Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0}`,
      );

      if (!Array.isArray(run.enabledTaskIds) || nextIndex >= run.enabledTaskIds.length) {
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][ALL_DONE]');
        ToolboxShell.appendLog('[BATCH_TASK_GROUP][DONE] reason=all-tasks-finished');
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][STEP] task=- step=all-done');
        ToolboxShell.appendLog('[AUTOQ][TASK][ALL_DONE]');
        log('全部任务完成');
        setBatchTaskGroupDisplayState('completed', 'all-done');
        abortBatchTaskGroupScheduledTimer('all-done');
        if (config.taskQueueSettings && config.taskQueueSettings.switchNewChatAfterAllDone === true) {
          const switchResult = await clickChatGPTNewChatInPage('all-done-home');
          if (!switchResult || switchResult.ok !== true) {
            const switchReason = String((switchResult && switchResult.reason) || 'all-done-home-failed');
            console.error('[ChatGPT toolbox] all done new chat failed', switchResult);
            ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][ALL_DONE_NEW_CHAT_FAILED] reason=${switchReason}`);
          } else {
            ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][ALL_DONE_NEW_CHAT_OK]');
          }
        }
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
            run.forceUploadBeforeNextSend = true;
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_SWITCH_NEW_CHAT][FORCE_UPLOAD_NEXT] from=${currentTask ? currentTask.id : '-'} `
              + `to=${nextTask ? nextTask.id : '-'} reason=new-chat-between-tasks`,
            );
          }

          if (typeof updateChatInputStateBadge === 'function') {
            updateChatInputStateBadge();
          }
          updateStatus('new-chat-ready');
        } finally {
          state.taskBatchStepRunning = false;
        }
      }

      clearVisibleDoneSignalTracking();

      // Reset per-task recovery tracking when advancing to a new task
      if (state.batchTask && state.batchTask.watchdogRecoverStreakPerTaskIndex) {
        state.batchTask.watchdogRecoverStreakPerTaskIndex = {};
      }
      syncCurrentTaskVerificationContext(nextTask, { resetState: true });
      run.currentIndex = nextIndex;
      run.currentTaskFailCount = 0;
      run.currentQuestionText = '';
      run.currentExpectedAnswer = '';
      run.currentReplyText = '';
      run.currentReplyStable = false;
      run.currentAnswerVerified = false;
      run.currentVerifyError = '';
      run.currentVerifyAttempt = 0;
      run.currentTaskQuestionText = '';
      run.currentTaskExpectedAnswer = '';
      run.currentTaskReplyText = '';
      run.currentTaskReplyStable = false;
      run.currentTaskAnswerVerified = false;
      run.currentTaskVerifyError = '';
      run.currentTaskVerifyAttempt = 0;
      run.verifyReplyTextForResend = '';
      run.assistantReplyCountForUpload = 0;
      run.lastAssistantReplyCountedHash = '';
      run.lastAutoUploadAtAssistantReplyCount = 0;
      run.lastAutoUploadAtMessageCount = 0;
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
      touchBatchTaskGroupActivity('next-task');
      renderTaskList();
      updateStatus('next-task');
      scheduleNextBatchTaskStep('continue-after-next-task', 0, { reason: 'next-task' });
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
      const missing = 'send_pipeline_normalizer_missing';
      console.error('[ChatGPT toolbox] normalizeSendFailureReason missing sendPipelineNormalizeFailureReason', { reason });
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_REASON_NORMALIZER_MISSING] reason=${String(reason || '-')}`,
        );
      }
      return { raw: String(reason || '').trim(), normalized: missing };
    }

    function isRetryableSendFailureReason(reason) {
      const { raw, normalized } = normalizeSendFailureReason(reason);
      const detail = arguments.length > 1 ? String(arguments[1] || '').trim() : '';
      let retryable = false;

      if (
        normalized === 'waiting_payload'
        || raw === 'waiting_payload'
        || detail === 'waiting_payload'
        || String(raw || '').includes('waiting_payload')
      ) {
        retryable = true;
      }

      if (!retryable && typeof sendPipelineIsRetryableReason === 'function') {
        retryable = sendPipelineIsRetryableReason(normalized) || sendPipelineIsRetryableReason(raw);
      } else if (!retryable) {
        console.error('[ChatGPT toolbox] isRetryableSendFailureReason: sendPipelineIsRetryableReason missing');
      }

      ToolboxShell.appendLog(
        `[AUTOQ][RETRYABLE_REASON_CHECK] rawReason=${raw || '-'} normalizedReason=${normalized || '-'} detail=${detail || '-'} retryable=${retryable ? 1 : 0} reason=${retryable && (detail === 'waiting_payload' || normalized === 'waiting_payload' || raw === 'waiting_payload' || String(raw || '').includes('waiting_payload')) ? 'waiting_payload' : (normalized || raw || '-')}`,
      );

      return retryable;
    }

    function logSendFailureClassified(phase, task, reason, sendResult) {
      const detail = sendResult && sendResult.detail ? String(sendResult.detail) : '';
      const normalizedReason = normalizeSendFailureReason(reason).normalized;
      const isWaitingPayloadFailure = normalizedReason === 'waiting_payload'
        || String(reason || '').trim() === 'waiting_payload'
        || detail === 'waiting_payload'
        || (
          normalizedReason === 'continue-send-failed'
          && detail === 'waiting_payload'
        )
        || String(reason || '').includes('waiting_payload');
      const retryable = isRetryableSendFailureReason(reason, detail)
        || (sendResult && sendResult.retryable === true)
        || (sendResult && sendResult.wait === true);
      let action = 'stop';

      if (isWaitingPayloadFailure || normalizedReason === 'continue-send-failed') {
        const scheduled = phase === 'send-once'
          ? true
          : scheduleRelentlessSendRetry(reason, phase, task);
        action = scheduled ? 'wait-and-retry' : 'retry-schedule-failed';
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][SEND_BLOCKED] reason=${isWaitingPayloadFailure ? 'waiting_payload' : (detail || normalizedReason || reason || '-')} action=${action}`,
        );
      } else if (retryable) {
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
        + `reason=${reason || '-'} detail=${detail || '-'} retryable=${retryable ? 1 : 0} action=${action}`,
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

      const { normalized: normalizedRetryReason } = normalizeSendFailureReason(reason);
      const reasonText = String(reason || '').trim();
      const isButtonWaitReason = SEND_BUTTON_WAIT_RETRY_REASONS.has(reasonText)
        || SEND_BUTTON_WAIT_RETRY_REASONS.has(normalizedRetryReason);

      if (isButtonWaitReason) {
        delayMs = Math.max(delayMs, 5000);
      }

      run.pendingSendKind = phase === 'verification'
        ? 'verification'
        : (phase === 'continue' ? 'continue' : 'initial');
      run.lastSendRetryReason = String(reason || 'unknown');
      run.lastSendRetryAt = Date.now();
      run.nextSendRetryAt = Date.now() + delayMs;

      state.taskRun = run;
      state.nextSendAt = run.nextSendRetryAt;

      if (isButtonWaitReason) {
        setTaskBatchStep('send-wait-button', task || getCurrentRunningTask(), { log: false });
      } else {
        setTaskBatchStep('send-wait-retry', task || getCurrentRunningTask(), { log: false });
      }

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][SEND_WAIT_RETRY] phase=${phase} reason=${reason} retryCount=${retryCount} delayMs=${delayMs} `
        + `buttonWait=${isButtonWaitReason ? 1 : 0} task=${task ? task.title : '-'}`,
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

      if (isComposerSendButtonWaitBlocking()) {
        const buttonWaitDelayMs = 5000;
        run.nextSendRetryAt = Date.now() + buttonWaitDelayMs;
        state.nextSendAt = run.nextSendRetryAt;
        state.taskRun = run;
        setTaskBatchStep('send-wait-button', getCurrentRunningTask(), { log: false });
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][SEND_RETRY_DEFER] reason=send-button-not-ready delayMs=${buttonWaitDelayMs}`,
        );
        updateStatus('send-button-not-ready-wait');
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
        stopEntireBatchTaskGroup(reasonText, {
          sendReason: reasonText,
          markCurrent: false,
          logStop: false,
          forceStopBatch: true,
        });
        return;
      }

      failCurrentTask(reasonText);
    }

    function getBatchTaskGroupRunId() {
      return String(state.currentRunId || '').trim();
    }

    function setBatchTaskGroupDisplayState(displayState, reason = '') {
      if (!state.batchTask) {
        return;
      }
      const next = String(displayState || 'idle');
      if (state.batchTask.displayState !== next) {
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][DISPLAY_STATE] from=${state.batchTask.displayState || '-'} `
          + `to=${next} reason=${reason || '-'}`,
        );
      }
      state.batchTask.displayState = next;
      syncBatchTaskPhase();
    }

    function touchBatchTaskGroupActivity(reason = '') {
      if (config.promptMode !== 'task' || !state.batchTask) {
        return;
      }
      state.batchTask.lastActiveAt = Date.now();
      state.batchTask.watchdogRecoverStreak = 0;
      if (reason) {
        ToolboxShell.appendLog(`[BATCH_TASK_GROUP][ACTIVITY] reason=${reason}`);
      }
    }

    function getBatchTaskGroupQuotaSnapshot() {
      const messageQuota = getTaskSendRateLimitStatus();
      const uploadQuota = getTaskUploadRateLimitStatus();
      return {
        messageRemaining: Math.max(0, Number(messageQuota.remaining) || 0),
        uploadRemaining: Math.max(0, Number(uploadQuota.remaining) || 0),
        messageCanSend: messageQuota.canSend !== false && (Number(messageQuota.remaining) || 0) > 0,
        uploadCanUpload: uploadQuota.canUpload !== false && (Number(uploadQuota.remaining) || 0) > 0,
      };
    }

    function logBatchTaskGroupStepBegin(context = {}) {
      const run = state.taskRun || {};
      const task = getCurrentRunningTask();
      const quota = getBatchTaskGroupQuotaSnapshot();
      const subtask = String(context.subtask || run.currentStep || state.batchTask.batchStep || '-');
      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][STEP_BEGIN] runId=${getBatchTaskGroupRunId() || '-'} `
        + `taskIndex=${Number(run.currentIndex) + 1} taskTotal=${Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0} `
        + `taskId=${task ? task.id : '-'} sentCount=${Number(run.totalSentDialogueCount) || 0} `
        + `messageQuotaRemaining=${quota.messageRemaining} uploadQuotaRemaining=${quota.uploadRemaining} `
        + `state=${state.batchTask.displayState || '-'} subtask=${subtask}`,
      );
      void context;
    }

    function logBatchTaskGroupStepEnd(result, nextAction, nextDelayMs, extra = {}) {
      const run = state.taskRun || {};
      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][STEP_END] runId=${getBatchTaskGroupRunId() || '-'} `
        + `taskIndex=${Number(run.currentIndex) + 1} result=${String(result || '-')} `
        + `nextAction=${String(nextAction || '-')} nextDelayMs=${Math.max(0, Number(nextDelayMs) || 0)} `
        + `extra=${extra && typeof extra === 'object' ? JSON.stringify(extra) : '-'}`,
      );
    }

    function abortBatchTaskGroupScheduledTimer(reason = '') {
      const timerId = state.batchTask && state.batchTask.scheduledTimerId;
      if (!timerId) {
        return false;
      }
      window.clearTimeout(timerId);
      state.batchTask.scheduledTimerId = null;
      state.batchTask.scheduledTimerAction = '';
      state.batchTask.scheduledTimerRunId = '';
      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][TIMER_ABORT] reason=${reason || '-'} runId=${getBatchTaskGroupRunId() || '-'}`,
      );
      return true;
    }

    function runBatchTaskGroupScheduledAction(action, meta = {}) {
      if (config.promptMode !== 'task') {
        return;
      }
      if (!state.running && !state.waitingReply && !state.batchTaskRunning) {
        logBatchTaskGroupStepEnd('aborted', action, 0, { reason: 'not-running' });
        return;
      }

      logBatchTaskGroupStepBegin({ subtask: `timer:${action}` });
      touchBatchTaskGroupActivity(`timer-fire:${action}`);

      if (state.batchTask.stopRequested) {
        logBatchTaskGroupStepEnd('aborted', action, 0, { reason: 'stop-requested' });
        return;
      }

      state.taskBatchStepRunning = false;

      if (meta.clearWaiting === true) {
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = 0;
      }

      ensureTicker();

      if (action === 'wait-reply-recover') {
        const currentTask = getCurrentRunningTask();
        if (meta.fromWatchdog === true && state.waitingReply) {
          ToolboxShell.appendLog(
            `[TASK_ADVANCE][BLOCKED] reason=watchdog-recover-not-verified waitingReply=${state.waitingReply ? 1 : 0}`,
          );
          setBatchTaskGroupDisplayState('recovering', 'wait-reply-recover-pending');
          logBatchTaskGroupStepEnd(
            'pending',
            'wait-reply-recover',
            0,
            {
              reason: 'watchdog-recover-not-verified',
              fromWatchdog: true,
              clearWaiting: false,
              advanceTask: false,
            },
          );
          updateStatus('batch-wait-reply-recover-pending');
          return;
        }
        const evaluation = evaluateCurrentTaskAdvanceState({
          task: currentTask,
          source: meta.fromWatchdog === true ? 'watchdog-wait-reply-recover' : 'wait-reply-recover',
        });
        logTaskVerifyState(currentTask, evaluation);
        if (state.waitingReply || evaluation.generating || !evaluation.stable) {
          const blockedReason = evaluation.generating ? 'still-generating' : (evaluation.blockedReason || 'wait-reply-recover');
          if (evaluation.generating) {
            ToolboxShell.appendLog('[TASK_ADVANCE][BLOCKED] reason=still-generating action=wait-reply-recover');
          }
          setBatchTaskGroupDisplayState('recovering', 'wait-reply-recover-pending');
          logBatchTaskGroupStepEnd(
            'pending',
            'wait-reply-recover',
            0,
            {
              reason: blockedReason,
              fromWatchdog: meta.fromWatchdog === true,
              clearWaiting: false,
              advanceTask: false,
            },
          );
          updateStatus('batch-wait-reply-recover-pending');
          return;
        }
        if (evaluation.answerVerified) {
          void handleTaskReplyReady().catch((error) => {
            logTaskRunError('[AUTOQ][WAIT_REPLY_RECOVER][HANDLE_REPLY_READY_FAILED]', error, currentTask);
            recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'wait-reply-recover-handle-failed', {
              action: 'wait-reply-recover',
              clearStepRunning: true,
            });
          });
          logBatchTaskGroupStepEnd('recovering', 'wait-reply-recover', 0, {
            reason: 'reply-ready-detected',
            fromWatchdog: meta.fromWatchdog === true,
            clearWaiting: false,
            advanceTask: false,
          });
          updateStatus('batch-wait-reply-recover-detected');
          return;
        }
        setBatchTaskGroupDisplayState('recovering', 'wait-reply-recover-answer-mismatch');
        if (meta.fromWatchdog === true) {
          ToolboxShell.appendLog('[TASK_ADVANCE][BLOCKED] reason=watchdog-recover-not-verified');
        }
        logBatchTaskGroupStepEnd(
          'pending',
          'wait-reply-recover',
          0,
          {
            reason: evaluation.blockedReason || 'not_verified',
            fromWatchdog: meta.fromWatchdog === true,
            clearWaiting: false,
            advanceTask: false,
          },
        );
        updateStatus('batch-wait-reply-recover-blocked');
        return;
      }

      let progressed = false;
      if (maybeResumeRelentlessSendRetry()) {
        progressed = true;
      } else if (action === 'reply-ready-retry') {
        void handleTaskReplyReady();
        progressed = true;
      } else if (state.waitingReply) {
        maybeUpdateWaitingState();
        progressed = true;
      } else {
        maybeSendNextTask();
        progressed = true;
      }

      if (state.batchTask.displayState === 'recovering') {
        setBatchTaskGroupDisplayState(
          state.waitingReply ? 'waiting_reply' : 'running',
          'recover-timer-fired',
        );
      }

      if (meta.fromWatchdog === true && state.waitingReply) {
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] reason=watchdog-recover-not-verified waitingReply=${state.waitingReply ? 1 : 0}`,
        );
        logBatchTaskGroupStepEnd('pending', action, 0, Object.assign({}, meta, {
          clearWaiting: false,
          advanceTask: false,
          reason: 'watchdog-recover-not-verified',
        }));
      } else if (action === 'wait-reply-recover') {
        logBatchTaskGroupStepEnd('pending', action, 0, Object.assign({}, meta, {
          clearWaiting: false,
          advanceTask: false,
          reason: 'wait-reply-recover-pending',
        }));
      } else {
        logBatchTaskGroupStepEnd(progressed ? 'ok' : 'noop', action, 0, meta);
      }
      updateStatus(`batch-timer-${action}`);
    }

    function scheduleNextBatchTaskStep(action, delayMs, meta = {}) {
      if (config.promptMode !== 'task') {
        return false;
      }

      const runId = getBatchTaskGroupRunId();
      const safeAction = String(action || 'recover');
      const safeDelayMs = Math.max(0, Number(delayMs) || BATCH_TASK_GROUP_RECOVER_DELAY_MS);
      const run = state.taskRun || {};
      const task = getCurrentRunningTask();

      abortBatchTaskGroupScheduledTimer('reschedule');

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][SCHEDULE_NEXT] runId=${runId || '-'} action=${safeAction} delayMs=${safeDelayMs} `
        + `taskIndex=${Number(run.currentIndex) + 1} taskId=${task ? task.id : '-'} reason=${meta.reason || '-'}`,
      );

      state.batchTask.scheduledTimerAction = safeAction;
      state.batchTask.scheduledTimerRunId = runId;

      state.batchTask.scheduledTimerId = window.setTimeout(() => {
        state.batchTask.scheduledTimerId = null;
        const scheduledRunId = String(state.batchTask.scheduledTimerRunId || '');
        const scheduledAction = String(state.batchTask.scheduledTimerAction || safeAction);
        state.batchTask.scheduledTimerAction = '';
        state.batchTask.scheduledTimerRunId = '';

        if (!scheduledRunId || scheduledRunId !== getBatchTaskGroupRunId()) {
          ToolboxShell.appendLog(
            `[BATCH_TASK_GROUP][TIMER_ABORT] reason=stale-run scheduledRunId=${scheduledRunId || '-'} `
            + `currentRunId=${getBatchTaskGroupRunId() || '-'}`,
          );
          return;
        }

        if (!state.running && !state.waitingReply && !state.batchTaskRunning) {
          ToolboxShell.appendLog('[BATCH_TASK_GROUP][TIMER_ABORT] reason=not-running');
          return;
        }

        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][TIMER_FIRE] runId=${scheduledRunId} action=${scheduledAction}`,
        );
        runBatchTaskGroupScheduledAction(scheduledAction, meta);
      }, safeDelayMs);

      return true;
    }

    function finishCurrentTaskAndAdvance(reason) {
      const run = state.taskRun || {};
      const from = Number(run.currentIndex || 0);
      const to = from + 1;
      const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;
      const reasonText = String(reason || '-') || '-';

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][TASK_ADVANCE] from=${from} to=${to} reason=${reasonText} total=${total}`,
      );

      const task = getCurrentRunningTask();
      const replyText = getCurrentTaskReplyTextForVerify(task, getLastAssistantReplyText(), {
        preferOriginalTaskReply: true,
      });
      const advanceGate = canAdvanceToNextTaskAfterVerify(task, replyText, {
        source: `finish-current:${reasonText}`,
        preferOriginalTaskReply: true,
      });

      if (!advanceGate.ok) {
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] from=${from} to=${to} reason=${advanceGate.reason || 'not-verified'} source=finishCurrentTaskAndAdvance`,
        );

        if (advanceGate.reason === 'answer-mismatch') {
          failCurrentTask('answer-mismatch', {
            stopEntireBatch: true,
          });
          return;
        }

        recoverBatchTaskGroup(getBatchTaskGroupRunId(), advanceGate.reason || 'not-verified', {
          action: 'wait-reply-recover',
          clearStepRunning: true,
          clearWaiting: false,
        });
        return;
      }

      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.taskBatchStepRunning = false;

      recordCurrentTaskAnswerCompletedOnce(task, `finish-current:${reasonText}`);

      if (task) {
        markTaskStatus(task, 'completed');
        notifyRuntimeTaskComplete(task);
      }

      setTaskBatchStep('next-task', task, { log: false });

      void moveToNextTask(reasonText, {
        skipGate: true,
      }).then((moved) => {
        if (!moved) {
          setBatchTaskGroupDisplayState('completed', 'all-tasks-done');
          return;
        }
        touchBatchTaskGroupActivity('moved-to-next-after-finish');
      }).catch(handleMoveToNextTaskError);
    }

    function shouldStopEntireBatchForReason(reason, options = {}) {
      if (options && options.forceStopBatch === true) {
        return true;
      }
      const reasonText = String(reason || '').trim().toLowerCase();
      if (!reasonText) {
        return false;
      }
      // 避免 quota 等待超时后仍被当成“正常等待中”继续尝试下一步。
      if (reasonText.includes('quota-wait-timeout')) {
        return true;
      }
      if (reasonText.includes('wait-timeout')) {
        return true;
      }
      // stop_on_limit 模式：额度/限速没法继续时需要立即终止批量任务组。
      if (reasonText.includes('stop-on-limit') || reasonText.includes('stop_on_limit') || reasonText.includes('quota-stop-on-limit')) {
        return true;
      }
      if (
        reasonText === 'cancelled'
        || reasonText === 'stopped'
        || reasonText === 'user-stop'
        || reasonText === 'start-button-toggle'
      ) {
        return true;
      }
      if (
        reasonText.includes('no-upload-quota')
        || reasonText.includes('no-message-quota')
        || reasonText === 'quota-exhausted'
        || reasonText === 'message-quota-exhausted'
        || reasonText === 'upload-quota-exhausted'
      ) {
        return true;
      }
      if (reasonText.includes('quota') && !reasonText.includes('quota-wait')) {
        const quota = getBatchTaskGroupQuotaSnapshot();
        if (!quota.messageCanSend || !quota.uploadCanUpload) {
          return true;
        }
      }
      return false;
    }

    function stopEntireBatchTaskGroup(reason, options = {}) {
      const reasonText = String(reason || 'stopped');
      const quota = getBatchTaskGroupQuotaSnapshot();
      if (!quota.messageCanSend) {
        setBatchTaskGroupDisplayState('stopped', 'message-quota-exhausted');
        ToolboxShell.setStatus('批量任务组已停止：消息额度不足');
      } else if (!quota.uploadCanUpload && reasonText.includes('upload')) {
        setBatchTaskGroupDisplayState('stopped', 'upload-quota-exhausted');
        ToolboxShell.setStatus('批量任务组已停止：上传额度不足');
      } else {
        setBatchTaskGroupDisplayState('stopped', reasonText);
        ToolboxShell.setStatus(`批量任务组已停止：${reasonText}`);
      }
      abortBatchTaskGroupScheduledTimer('stop-entire-batch');
      stop({
        reason: reasonText,
        sendReason: options.sendReason || reasonText,
        finalStep: 'stopped',
        markCurrent: options.markCurrent !== false,
        logStop: options.logStop !== false,
      });
    }

    function skipCurrentTaskWithFailure(reason, options = {}) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');
      const run = state.taskRun || {};
      run.currentTaskFailCount = 0;
      state.taskRun = run;
      state.taskBatchStepRunning = false;

      if (task) {
        markTaskStatus(task, reasonText === 'timeout' ? 'timeout' : 'failed');
        setTaskBatchStep('task-failed-skip-next', task, { log: false });
      }

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][SKIP_TASK] task=${task ? task.title : '-'} reason=${reasonText} `
        + `taskIndex=${Number(run.currentIndex) + 1}`,
      );
      log(`任务失败，跳过并继续下一个：${task ? task.title : '-'} (${reasonText})`);
      ToolboxShell.setStatus(`任务失败，继续下一个：${reasonText}`);

      logBatchTaskGroupStepEnd('skip-task', 'move-next', 0, { reason: reasonText });

      void moveToNextTask(reasonText, { skipGate: true }).then((moved) => {
        if (!moved) {
          setBatchTaskGroupDisplayState('completed', 'all-tasks-done');
          return;
        }
        touchBatchTaskGroupActivity('moved-to-next-after-skip');
        scheduleNextBatchTaskStep('continue-after-skip', 0, { reason: reasonText });
      }).catch(handleMoveToNextTaskError);
      void options;
    }

    function recoverBatchTaskGroup(runId, reason, options = {}) {
      if (config.promptMode !== 'task') {
        return false;
      }

      const expectedRunId = String(runId || getBatchTaskGroupRunId() || '').trim();
      const currentRunId = getBatchTaskGroupRunId();

      if (expectedRunId && currentRunId && expectedRunId !== currentRunId) {
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][RECOVER_SCHEDULE] skipped reason=stale-run `
          + `expected=${expectedRunId} current=${currentRunId}`,
        );
        return false;
      }

      if (state.batchTask.stopRequested) {
        ToolboxShell.appendLog('[BATCH_TASK_GROUP][RECOVER_SCHEDULE] skipped reason=stop-requested');
        return false;
      }

      if (!state.running && !state.waitingReply && !state.batchTaskRunning) {
        ToolboxShell.appendLog('[BATCH_TASK_GROUP][RECOVER_SCHEDULE] skipped reason=not-active');
        return false;
      }

      const run = state.taskRun || {};
      const task = getCurrentRunningTask();
      const fromWatchdog = options.fromWatchdog === true;
      const reasonText = String(reason || '').trim();
      const watchdogReason = fromWatchdog || reasonText.includes('watchdog-stall');
      const delayMs = Math.max(0, Number(options.delayMs) || BATCH_TASK_GROUP_RECOVER_DELAY_MS);
      ensureTaskRunVerificationFields(run);
      run.currentTaskRetryCount = Math.max(0, Number(run.currentTaskRetryCount) || 0) + 1;
      state.taskRun = run;

      state.batchTask.watchdogRecoverStreak = Math.max(
        0,
        Number(state.batchTask.watchdogRecoverStreak) || 0,
      ) + (fromWatchdog ? 1 : 0);

      if (
        fromWatchdog
        && state.batchTask.watchdogRecoverStreak > BATCH_TASK_GROUP_MAX_WATCHDOG_RECOVER_STREAK
      ) {
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][RECOVER_LIMIT_REACHED] taskIndex=${Number(run.currentIndex || 0)} `
          + `action=stop-batch reason=${reason || 'watchdog-stall'} streak=${state.batchTask.watchdogRecoverStreak}`,
        );
        state.batchTask.watchdogRecoverStreak = 0;
        state.taskBatchStepRunning = false;
        failCurrentTask(`recover-limit-reached:${reason || 'watchdog-stall'}`, {
          stopEntireBatch: true,
        });
        return true;
      }

      // Per-taskIndex recovery limit: track recovery count per task and force-advance
      // when the same taskIndex exceeds BATCH_TASK_GROUP_MAX_WATCHDOG_RECOVER_STREAK.
      const runForRecover = state.taskRun || {};
      const recoverTaskIndex = Number(runForRecover.currentIndex || 0);
      if (!state.batchTask.watchdogRecoverStreakPerTaskIndex) {
        state.batchTask.watchdogRecoverStreakPerTaskIndex = {};
      }
      const perTaskCount = Math.max(0, Number(state.batchTask.watchdogRecoverStreakPerTaskIndex[recoverTaskIndex]) || 0) + 1;
      state.batchTask.watchdogRecoverStreakPerTaskIndex[recoverTaskIndex] = perTaskCount;
      if (perTaskCount > BATCH_TASK_GROUP_MAX_WATCHDOG_RECOVER_STREAK) {
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][RECOVER_LIMIT_REACHED] taskIndex=${recoverTaskIndex} action=stop-batch reason=${reason || 'recover'}`,
        );
        state.batchTask.watchdogRecoverStreakPerTaskIndex = {};
        state.batchTask.watchdogRecoverStreak = 0;
        state.taskBatchStepRunning = false;
        failCurrentTask(`recover-limit-reached:${reason || 'recover'}`, {
          stopEntireBatch: true,
        });
        return true;
      }

      if (!state.running) {
        syncLegacyRunFlagsFromPhase();
        if (!state.running && (state.waitingReply || state.batchTaskRunning)) {
          transitionAutoQueuePhase(AUTO_QUEUE_PHASES.PREPARING, 'recover-resume', { force: true });
          state.running = true;
          state.batchTaskRunning = true;
        }
      }

      setBatchTaskGroupDisplayState('recovering', String(reason || 'recover'));

      if (options.clearStepRunning === true) {
        state.taskBatchStepRunning = false;
      }

      if (watchdogReason && state.waitingReply) {
        ToolboxShell.appendLog(
          `[TASK_ADVANCE][BLOCKED] reason=watchdog-recover-not-verified waitingReply=${state.waitingReply ? 1 : 0}`,
        );
        scheduleNextBatchTaskStep('wait-reply-recover', delayMs, {
          reason: reasonText || 'watchdog-recover-not-verified',
          clearWaiting: false,
          fromWatchdog: true,
        });
        ensureTicker();
        updateStatus('batch-recover-scheduled');
        return true;
      }

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][RECOVER_SCHEDULE] runId=${currentRunId || '-'} reason=${reason || '-'} `
        + `taskIndex=${Number(run.currentIndex) + 1} taskId=${task ? task.id : '-'} `
        + `round=${Number(task && task.continueCount) || 0} delayMs=${delayMs} `
        + `watchdogStreak=${state.batchTask.watchdogRecoverStreak} retryCount=${run.currentTaskRetryCount}`,
      );

      const timerAction = String(options.action || (
        state.waitingReply ? 'wait-reply-recover' : 'recover'
      ));

      scheduleNextBatchTaskStep(timerAction, delayMs, {
        reason: reasonText || 'recover',
        clearWaiting: watchdogReason ? false : (options.clearWaiting === true),
        fromWatchdog: watchdogReason,
      });

      ensureTicker();
      updateStatus('batch-recover-scheduled');
      return true;
    }

    function checkBatchTaskGroupWatchdog() {
      if (config.promptMode !== 'task') {
        return false;
      }
      if (!state.running && !state.waitingReply && !state.batchTaskRunning) {
        return false;
      }
      if (state.batchTask.stopRequested) {
        return false;
      }

      // quota-wait / rate-limit-wait 期间不允许触发 watchdog 恢复。
      // 这些等待是“正常等待额度恢复”，不应该被误判为卡死。
      const currentStep = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';
      const waitingSteps = new Set([
        'quota-wait',
        'rate-limit-wait',
        'upload-rate-limit-wait',
        'task-rate-limit-wait',
        'task-upload-rate-limit-wait',
      ]);
      if (waitingSteps.has(String(currentStep || '').trim())) {
        return false;
      }

      const lastActiveAt = Number(state.batchTask.lastActiveAt) || Number(state.startedAt) || 0;
      if (!lastActiveAt) {
        return false;
      }

      const stallMs = Date.now() - lastActiveAt;
      if (stallMs < BATCH_TASK_GROUP_WATCHDOG_STALL_MS) {
        return false;
      }

      if (state.batchTask.displayState === 'recovering' && state.batchTask.scheduledTimerId) {
        return false;
      }

      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][WATCHDOG] stallMs=${stallMs} step=${state.taskRun && state.taskRun.currentStep ? state.taskRun.currentStep : '-'} `
        + `waitingReply=${state.waitingReply ? 1 : 0} taskBatchStepRunning=${state.taskBatchStepRunning ? 1 : 0}`,
      );

      if (
        currentStep === 'wait-initial-reply'
        && state.waitingReply === true
        && isChatGPTActuallyBusyForTaskQueue()
      ) {
        ToolboxShell.appendLog('[TASK_ADVANCE][BLOCKED] reason=watchdog-recover-not-verified');
        return recoverBatchTaskGroup(getBatchTaskGroupRunId(), `watchdog-stall-${Math.round(stallMs / 1000)}s`, {
          fromWatchdog: true,
          clearStepRunning: true,
          clearWaiting: false,
          delayMs: BATCH_TASK_GROUP_RECOVER_DELAY_MS,
          action: 'wait-reply-recover',
        });
      }

      // Force-advance when copy-last-reply is stalled (step set but no async operation running,
      // no reply being waited for). This prevents the common infinite-loop scenario where
      // the batch stays on the same taskIndex forever.
      if (
        currentStep === 'copy-last-reply'
        && !state.waitingReply
        && !state.taskBatchStepRunning
      ) {
        if (stallMs < 15000) {
          return false;
        }
        const task = getCurrentRunningTask();
        const runRef = state.taskRun || {};
        const currentIdx = Number(runRef.currentIndex || 0);
        const nextIdx = currentIdx + 1;
        const replyText = getCurrentTaskReplyTextForVerify(task, getLastAssistantReplyText());

        const advanceGate = canAdvanceToNextTaskAfterVerify(task, replyText, {
          source: 'watchdog-copy-last-reply-stall',
        });

        if (!advanceGate.ok) {
          ToolboxShell.appendLog(
            `[BATCH_TASK_GROUP][WATCHDOG_ADVANCE_BLOCKED] reason=${advanceGate.reason || 'not-verified'} `
            + `taskIndex=${currentIdx + 1} nextIndex=${nextIdx}`,
          );

          return recoverBatchTaskGroup(
            getBatchTaskGroupRunId(),
            advanceGate.reason || 'watchdog-not-verified',
            {
              fromWatchdog: true,
              clearStepRunning: true,
              clearWaiting: false,
              delayMs: BATCH_TASK_GROUP_RECOVER_DELAY_MS,
              action: 'wait-reply-recover',
            },
          );
        }

        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][WATCHDOG_ADVANCE_BLOCKED] reason=watchdog-recover-not-verified taskIndex=${currentIdx + 1} nextIndex=${nextIdx + 1}`,
        );
        return recoverBatchTaskGroup(
          getBatchTaskGroupRunId(),
          'watchdog-recover-not-verified',
          {
            fromWatchdog: true,
            clearStepRunning: true,
            clearWaiting: false,
            delayMs: BATCH_TASK_GROUP_RECOVER_DELAY_MS,
            action: 'wait-reply-recover',
          },
        );
      }

      return recoverBatchTaskGroup(getBatchTaskGroupRunId(), `watchdog-stall-${Math.round(stallMs / 1000)}s`, {
        fromWatchdog: true,
        clearStepRunning: true,
        delayMs: BATCH_TASK_GROUP_RECOVER_DELAY_MS,
      });
    }

    function failCurrentTask(reason, options = {}) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');
      const detailText = String(options && options.detail ? options.detail : '').trim();

      if (shouldStopEntireBatchForReason(reasonText, options)) {
        if (task) {
          markTaskStatus(task, 'stopped');
          setTaskBatchStep('stopped', task, { log: false });
        }
        stopEntireBatchTaskGroup(reasonText, options);
        return;
      }

      const pendingSendKind = state.taskRun && state.taskRun.pendingSendKind
        ? String(state.taskRun.pendingSendKind)
        : '';
      const lastPendingSendKind = state.taskRun && state.taskRun.lastPendingSendKindBeforeProcessing
        ? String(state.taskRun.lastPendingSendKindBeforeProcessing)
        : '';
      const effectivePendingSendKind = pendingSendKind === 'processing'
        ? lastPendingSendKind
        : pendingSendKind;
      const failPhase = effectivePendingSendKind === 'verification'
        ? 'verification'
        : (effectivePendingSendKind === 'continue' ? 'continue' : 'initial');
      const classified = logSendFailureClassified(failPhase, task, reasonText, {
        detail: detailText,
        retryable: options && options.retryable === true,
        wait: options && options.wait === true,
      });
      if (state.running && (classified.action === 'retry' || classified.action === 'wait-and-retry')) {
        return;
      }

      const run = state.taskRun || {};
      run.currentTaskFailCount = Math.max(0, Number(run.currentTaskFailCount) || 0) + 1;
      state.taskRun = run;

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

      ToolboxShell.appendLog(
        `[AUTOQ][TASK][FAILED] task=${task ? task.title : '-'} reason=${reasonText} `
        + `failCount=${run.currentTaskFailCount}/${BATCH_TASK_GROUP_MAX_TASK_FAIL_RETRIES}`,
      );
      log(`任务失败：${task ? task.title : '-'} (${reasonText})`);

      if (run.currentTaskFailCount < BATCH_TASK_GROUP_MAX_TASK_FAIL_RETRIES) {
        ToolboxShell.setStatus(
          `任务失败，${BATCH_TASK_GROUP_RECOVER_DELAY_MS / 1000} 秒后重试 `
          + `(${run.currentTaskFailCount}/${BATCH_TASK_GROUP_MAX_TASK_FAIL_RETRIES})：${reasonText}`,
        );
        recoverBatchTaskGroup(getBatchTaskGroupRunId(), reasonText, {
          action: failPhase === 'continue' || failPhase === 'verification'
            ? 'reply-ready-retry'
            : 'recover',
          clearStepRunning: true,
        });
        return;
      }

      if (
        reasonText === 'continue-send-failed'
        || detailText === 'waiting_payload'
        || String(reasonText || '').includes('waiting_payload')
      ) {
        ToolboxShell.appendLog(`[BATCH_TASK_GROUP][STOP_ON_SEND_FAILED] reason=${reasonText}`);
        stopEntireBatchTaskGroup(reasonText, {
          sendReason: detailText || reasonText,
          markCurrent: true,
          logStop: true,
        });
        return;
      }

      skipCurrentTaskWithFailure(reasonText, options);
    }

    function handleTaskQueueRateLimitFailure(rateLimitResult, task, context = '') {
      const reason = String(
        (rateLimitResult && rateLimitResult.reason) || 'rate-limit-cancelled',
      );
      ToolboxShell.appendLog(
        `[BATCH_TASK_GROUP][RATE_LIMIT_BLOCKED] context=${context || '-'} reason=${reason}`,
      );
      if (shouldStopEntireBatchForReason(reason)) {
        if (task) {
          markTaskStatus(task, 'stopped');
          setTaskBatchStep('stopped', task, { log: false });
        }
        recordTaskBatchStopReason(reason, { sendReason: reason });
        stopEntireBatchTaskGroup(reason, { sendReason: reason, markCurrent: false, logStop: false });
        return true;
      }
      failCurrentTask(reason);
      return true;
    }

    function getDefaultVerifyAfterDoneSignalPrompt() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {};
      if (String(defaults.verifyAfterDoneSignalPrompt || '').trim()) {
        return String(defaults.verifyAfterDoneSignalPrompt || '').trim();
      }
      if (typeof getDefaultVerifyAfterDoneSignalPromptTemplate === 'function') {
        return getDefaultVerifyAfterDoneSignalPromptTemplate();
      }
      return '';
    }

    function buildTaskBriefForDoneVerify(task) {
      const raw = String(
        (task && (task.title || task.name)) || '',
      ).trim();

      if (raw) {
        return raw.slice(0, 120);
      }

      const content = String(
        (task && (task.content || task.prompt || task.initialPrompt)) || '',
      ).trim();

      if (!content) {
        return '当前批量任务';
      }

      const oneLine = content
        .replace(/\s+/g, ' ')
        .trim();

      return oneLine.length > 120
        ? `${oneLine.slice(0, 120)}...`
        : oneLine;
    }

    function buildTaskFullContentForDoneVerify(task) {
      const resolved = resolveTaskInitialPrompt(task, { log: false });
      const initialPrompt = String(resolved && resolved.initialPrompt ? resolved.initialPrompt : '').trim();

      if (initialPrompt) {
        return initialPrompt;
      }

      const fallback = String(
        (task && (task.content || task.prompt || task.initialPrompt || task.title || task.name)) || '',
      ).trim();

      return fallback || '当前任务内容为空，请结合刚刚重新上传的文件/附件进行完成状态确认。';
    }

    function buildVerifyAfterDoneSignalPrompt(task, resolved, replyText) {
      const settings = config.taskQueueSettings || {};
      const doneSignal = resolved && resolved.actualDoneSignal
        ? resolved.actualDoneSignal
        : TASK_DONE_SIGNAL;
      const taskBrief = buildTaskBriefForDoneVerify(task);
      const taskContent = buildTaskFullContentForDoneVerify(task);
      const template = String(
        settings.verifyAfterDoneSignalPrompt || getDefaultVerifyAfterDoneSignalPrompt(),
      );

      return template
        .replace(/\{\{taskTitle\}\}/g, String(task.title || ''))
        .replace(/\{\{taskBrief\}\}/g, taskBrief)
        .replace(/\{\{taskContent\}\}/g, taskContent)
        .replace(/\{\{doneSignal\}\}/g, String(doneSignal || TASK_DONE_SIGNAL))
        .replace(/\{\{lastReply\}\}/g, String(replyText || ''));
    }

    function evaluateCurrentTaskAdvanceState(options = {}) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const task = options.task || getCurrentRunningTask();
      const snapshot = options.replySnapshot && typeof options.replySnapshot === 'object'
        ? options.replySnapshot
        : buildAssistantReplySnapshot();
      const replyText = getCurrentTaskReplyTextForVerify(
        task,
        options.replyText != null ? options.replyText : (snapshot && snapshot.text ? snapshot.text : ''),
        {
          preferOriginalTaskReply: options.preferOriginalTaskReply === true,
        },
      );
      const messageId = String(snapshot && snapshot.messageId ? snapshot.messageId : '').trim();
      const busy = isChatGPTActuallyBusyForTaskQueue();
      const waitingReply = !!state.waitingReply;

      run.currentTaskReplyMessageId = messageId;
      run.currentTaskReplyText = replyText;
      state.taskRun = run;

      const gate = canAdvanceToNextTaskAfterVerify(task, replyText, {
        source: String(options.source || 'evaluate-current-task'),
        preferOriginalTaskReply: options.preferOriginalTaskReply === true,
      });
      const verifyResult = {
        ok: !!gate.ok,
        reason: gate.reason || (gate.ok ? 'verified' : 'not-verified'),
      };
      const hasReply = !!replyText;
      const canAdvance = !!gate.ok;
      const blockedReason = gate.ok
        ? ''
        : (
          busy
            ? 'assistant-still-busy'
            : (
              waitingReply
                ? 'waiting-reply'
                : (gate.reason || 'not-verified')
            )
        );

      return {
        canAdvance,
        blockedReason,
        generating: busy,
        waitingReply,
        hasReply,
        stable: !!run.currentTaskReplyStable,
        answerVerified: !!run.currentTaskAnswerVerified,
        verifyResult,
        replyText,
        replyHash: computeSimpleTextHash(replyText),
        replyHashStableCount: Number(run.currentTaskReplyHashStableCount) || 0,
      };
    }

    function logTaskVerifyState(task, evaluation) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0) + 1;
      ToolboxShell.appendLog(
        `[TASK_VERIFY][START] taskIndex=${taskIndex} question=${JSON.stringify(String(run.currentTaskQuestionText || getTaskQuestionTextForVerify(task) || ''))}`,
      );
      ToolboxShell.appendLog(
        `[TASK_VERIFY][REPLY_STATE] generating=${evaluation.generating ? 1 : 0} waitingReply=${evaluation.waitingReply ? 1 : 0} `
        + `stable=${evaluation.stable ? 1 : 0} textLen=${String(evaluation.replyText || '').length} `
        + `stableCount=${evaluation.replyHashStableCount}/${TASK_REPLY_STABLE_HASH_ROUNDS}`,
      );
      ToolboxShell.appendLog(
        `[TASK_VERIFY][EXPECTED] expected=${String(run.currentTaskExpectedAnswer || '-') || '-'}`,
      );
      ToolboxShell.appendLog(
        `[TASK_VERIFY][ACTUAL] actualText=${JSON.stringify(String(evaluation.replyText || ''))}`,
      );
      if (evaluation.answerVerified) {
        ToolboxShell.appendLog(`[TASK_VERIFY][PASS] taskIndex=${taskIndex}`);
      } else if (evaluation.verifyResult && evaluation.verifyResult.reason === 'no-math-expectation') {
        ToolboxShell.appendLog(`[TASK_VERIFY][SKIP] taskIndex=${taskIndex} reason=no-math-expectation`);
      } else {
        ToolboxShell.appendLog(
          `[TASK_VERIFY][FAIL] taskIndex=${taskIndex} reason=${evaluation.blockedReason || evaluation.verifyResult.reason || 'not_verified'}`,
        );
      }
    }

    function canAdvanceToNextTask(taskRunState) {
      return !!(
        taskRunState
        && taskRunState.canAdvance === true
      );
    }

    function logTaskAdvanceBlocked(reason) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const taskIndex = Number(run.currentIndex || 0) + 1;
      ToolboxShell.appendLog(`[TASK_ADVANCE][BLOCKED] taskIndex=${taskIndex} reason=${String(reason || 'not_verified')}`);
    }

    async function maybeAdvanceToNextTask(reason, options = {}) {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const task = options.task || getCurrentRunningTask();
      const evaluation = evaluateCurrentTaskAdvanceState({
        task,
        replyText: options.replyText,
        replySnapshot: options.replySnapshot,
        source: String(reason || 'maybe-advance'),
      });
      logTaskVerifyState(task, evaluation);

      if (!evaluation.canAdvance) {
        logTaskAdvanceBlocked(evaluation.blockedReason || 'not-verified');
        if (
          task
          && !evaluation.generating
          && !evaluation.waitingReply
        ) {
          run.pendingSendKind = 'verification_hold';
          state.taskRun = run;
          setTaskBatchStep('wait-task-verify', task, { log: false });
          recoverBatchTaskGroup(getBatchTaskGroupRunId(), evaluation.blockedReason || 'task-advance-blocked', {
            action: 'wait-reply-recover',
            clearStepRunning: true,
            clearWaiting: false,
          });
        }
        return {
          ok: false,
          advanced: false,
          reason: evaluation.blockedReason || 'not-verified',
          evaluation,
        };
      }

      recordCurrentTaskAnswerCompletedOnce(task, String(reason || 'maybe-advance'));
      const from = Number(run.currentIndex || 0);
      const to = from + 1;
      ToolboxShell.appendLog(`[TASK_ADVANCE][NEXT] fromIndex=${from} toIndex=${to}`);
      const moved = await moveToNextTask(reason, {
        skipGate: true,
      });
      return {
        ok: !!moved,
        advanced: !!moved,
        reason: moved ? 'advanced' : 'move-next-failed',
        evaluation,
      };
    }

    async function handleTaskDoneSignal(task, profile, resolved, replyText, source = 'unknown') {
      if (!task) {
        ToolboxShell.appendLog(`[AUTOQ][TASK_DONE][SKIP] source=${source} reason=missing-task`);
        return false;
      }

      if (!state.taskRun || typeof state.taskRun !== 'object') {
        ToolboxShell.appendLog(`[AUTOQ][TASK_DONE][SKIP] source=${source} reason=missing-task-run`);
        return false;
      }

      const settings = config.taskQueueSettings || {};
      const verifyEnabled = settings.verifyAfterDoneSignal !== false;
      const verificationAlreadyStarted = !!(
        state.taskRun.doneSignalVerificationRunning
        || String(state.taskRun.verifyReplyTextForResend || '').trim()
      );

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_DONE][ENTER] source=${source} task=${task.title || '-'} `
        + `verifyEnabled=${verifyEnabled ? 1 : 0} verifyRunning=${state.taskRun.doneSignalVerificationRunning ? 1 : 0} `
        + `verificationAlreadyStarted=${verificationAlreadyStarted ? 1 : 0} running=${state.running ? 1 : 0}`,
      );
      syncCurrentTaskVerificationContext(task, { resetState: false, keepRetryCount: true });

      if (verifyEnabled && !verificationAlreadyStarted) {
        await runDoneSignalVerification(task, profile, resolved, replyText);
        return true;
      }

      const answerReplyText = getCurrentTaskReplyTextForVerify(task, replyText, {
        preferOriginalTaskReply: true,
      });
      const advanceGate = canAdvanceToNextTaskAfterVerify(task, answerReplyText, {
        source: `task-done:${source}`,
        preferOriginalTaskReply: true,
      });

      if (!advanceGate.ok) {
        const reason = advanceGate.reason || 'answer-not-verified';

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_DONE][BLOCKED] source=${source} task=${task.title || '-'} reason=${reason}`,
        );

        if (reason === 'answer-mismatch') {
          failCurrentTask(reason, {
            stopEntireBatch: true,
          });
          return false;
        }

        recoverBatchTaskGroup(getBatchTaskGroupRunId(), reason, {
          action: 'wait-reply-recover',
          clearStepRunning: true,
          clearWaiting: false,
        });
        return false;
      }

      recordCurrentTaskAnswerCompletedOnce(task, source);

      if (state.taskRun) {
        state.taskRun.verifyReplyTextForResend = '';
        state.taskRun.doneSignalVerificationRunning = false;
      }

      ToolboxShell.appendLog(`[AUTOQ][TASK_DONE][COMPLETE] source=${source} task=${task.title || '-'}`);
      ToolboxShell.appendLog(`[AUTOQ][TASK][COMPLETE] task=${task.title}`);
      touchBatchTaskGroupActivity(`task-complete:${task.id || '-'}`);

      markTaskStatus(task, 'completed');
      notifyRuntimeTaskComplete(task);

      if (state.taskRun) {
        state.taskRun.pendingSendKind = 'initial';
        state.taskRun.doneSignalVerificationRunning = false;
        state.taskRun.verifyReplyTextForResend = '';
      }

      setTaskBatchStep('next-task', task, { log: false });
      void moveToNextTask(`task-done:${source}`, {
        skipGate: true,
      }).catch(handleMoveToNextTaskError);
      return true;
    }

    async function runDoneSignalVerification(task, profile, resolved, replyText) {
      void profile;

      if (!task) {
        return { ok: false, reason: 'missing-task' };
      }

      if (!state.running) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][VERIFY_SKIP] task=${task.title || '-'} reason=cancelled-not-running running=0`,
        );
        return { ok: false, reason: 'cancelled' };
      }

      const run = state.taskRun || {};
      run.doneSignalVerificationRunning = true;
      run.pendingSendKind = 'verification';
      run.verifyReplyTextForResend = getCurrentTaskReplyTextForVerify(task, replyText);
      state.taskRun = run;

      ToolboxShell.appendLog(
        `[AUTOQ][VERIFY_STATE] start=1 task=${task.title || '-'} pendingSendKind=verification`,
      );
      ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][DONE_FIRST_SEEN] task=${task.title || '-'}`);

      let verificationPromptSent = false;

      try {
        setTaskBatchStep('verify-after-done-signal', task);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_START] task=${task.title}`);

        const settings = config.taskQueueSettings || {};
        const shouldUploadFile = settings.verifyAfterDoneSignalUploadFile !== false;
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_VERIFY][UPLOAD_POLICY] enabled=${shouldUploadFile ? 1 : 0} source=verify-after-done-signal`,
        );

        if (shouldUploadFile) {
          if (
            typeof UploadModule === 'undefined'
            || (
              typeof UploadModule.startUploadForAutoQueue !== 'function'
              && typeof UploadModule.startUploadFromCurrentQueue !== 'function'
            )
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
          ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][VERIFY_UPLOAD_START] task=${task.title || '-'}`);

          state.batchAutoUploading = true;
          state.uploadingFromAutoQueue = false;
          logUploadBatchState('batch-verify-auto-upload-start');
          setAutoQueuePhase('uploading', 'upload-start');
          updateStatus('verify-upload-start');
          ToolboxShell.appendLog('[BATCH_AUTO_UPLOAD][START] manualUploadRunning=0 batchTaskRunning=1 batchAutoUploading=1');
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_VERIFY][UPLOAD_BEFORE_CONFIRM_START] task=${task.title || '-'} source=autoq-task-verify-${task.id}`,
          );

          let uploadResult = null;

          try {
            const uploadRateLimitResult = await waitForTaskUploadRateLimit('verify-upload', {
              shouldStop: () => !state.running,
            });

            if (!uploadRateLimitResult || uploadRateLimitResult.ok !== true) {
              const reason = uploadRateLimitResult && uploadRateLimitResult.reason
                ? uploadRateLimitResult.reason
                : 'upload-rate-limit-blocked';
              uploadResult = {
                ok: false,
                reason,
                uploadedCount: 0,
                failedCount: 0,
                skippedCount: 0,
              };
            } else if (typeof UploadModule.startUploadForAutoQueue === 'function') {
              const uploadRateStatus = getTaskUploadRateLimitStatus(1);
              const maxFilesForThisUpload = uploadRateStatus.enabled
                ? Math.max(0, Number(uploadRateStatus.remaining) || 0)
                : 0;

              if (uploadRateStatus.enabled && maxFilesForThisUpload <= 0) {
                uploadResult = {
                  ok: false,
                  reason: 'no-upload-quota',
                  uploadedCount: 0,
                  failedCount: 0,
                  skippedCount: 0,
                };
              } else {
                uploadResult = await UploadModule.startUploadForAutoQueue({
                  source: `autoq-task-verify-${task.id}`,
                  forceReupload: true,
                  shouldStop: () => !state.running,
                  maxFiles: maxFilesForThisUpload,
                });
              }
            } else {
              uploadResult = await startUploadFromCurrentQueueWithTaskUploadRateLimit({
                source: `autoq-task-verify-${task.id}`,
                kind: 'verify-upload',
                shouldStop: () => !state.running,
              });
            }
          } finally {
            state.batchAutoUploading = false;
            state.uploadingFromAutoQueue = false;
            logUploadBatchState('batch-verify-auto-upload-done');
            ToolboxShell.appendLog('[BATCH_AUTO_UPLOAD][DONE] manualUploadRunning=0 batchTaskRunning=1 batchAutoUploading=0');
            updateStatus('verify-upload-done');
          }

          const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
          const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
          const skippedCount = Number(uploadResult && uploadResult.skippedCount) || 0;
          const uploadReason = String(uploadResult && uploadResult.reason || '').trim();
          const uploadOk = !!(uploadResult && uploadResult.ok === true);

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_VERIFY][UPLOAD_BEFORE_CONFIRM_DONE] task=${task.title || '-'} ok=${uploadOk ? 1 : 0} uploaded=${uploadedCount} skipped=${skippedCount} reason=${uploadReason || '-'}`,
          );

          if (!uploadResult || uploadResult.ok !== true) {
            const reason = uploadReason || 'verify-upload-failed';

            if (reason === 'no-files') {
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_SKIPPED] task=${task.title} reason=no-files`,
              );
              ToolboxShell.appendLog(`[AUTOQ][TASK_VERIFY][NO_FILES] task=${task.title}`);
              ToolboxShell.appendLog(`[AUTOQ][TASK_VERIFY][UPLOAD_SKIPPED_NO_FILES] task=${task.title}`);
            } else if (reason === 'composer-already-has-file') {
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_SKIPPED] task=${task.title} reason=composer-already-has-file`,
              );
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
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][VERIFY_PROMPT_SEND] task=${task.title || '-'}`);

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
          taskAutoUploadCountVerifyPrompt: false,
          taskAutoUploadCountMode: 'assistantAnswer',
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
        countVerifyPrompt: raw.taskAutoUploadCountVerifyPrompt === true,
        countMode: normalizeTaskAutoUploadCountMode(
          raw.taskAutoUploadCountMode || defaults.taskAutoUploadCountMode || 'message',
        ),
      };
    }

    function normalizeTaskAutoUploadCountMode(mode) {
      const raw = String(mode || '').trim();
      if (raw === 'message' || raw === 'assistantAnswer' || raw === 'taskItem') {
        return raw;
      }
      return 'message';
    }

    function getCurrentTaskAutoUploadSlotNo(kind) {
      void kind;
      const settings = getTaskAutoUploadSettings();
      const countMode = normalizeTaskAutoUploadCountMode(settings.countMode);

      if (!state.taskRun) {
        return 1;
      }

      if (countMode === 'message') {
        return Math.max(0, Number(state.taskRun.sentMessageCount) || 0) + 1;
      }

      if (countMode === 'assistantAnswer') {
        return Math.max(0, Number(state.taskRun.assistantReplyCountForUpload) || 0) + 1;
      }

      return Math.max(0, Number(state.taskRun.currentIndex) || 0) + 1;
    }

    function getTaskAutoUploadCountModeLabel(mode) {
      if (mode === 'message') return '发送消息';
      if (mode === 'assistantAnswer') return '助手回答';
      return '任务项';
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
      touchBatchTaskGroupActivity(`message-sent:${safeKind}`);

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
          + `autoUploadMessageCount=${Number(run.sentMessageCount) || 0} autoUploadCounted=0`,
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
        + `autoUploadMessageCount=${run.sentMessageCount} autoUploadCounted=1`,
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
        if (uploadResult && uploadResult.retryable === true) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][PREPARE_WAIT] kind=${String(kind || '-')} `
            + `reason=${uploadResult.reason || 'upload-wait'}`,
          );
          return {
            ok: false,
            rotated: !!rotateResult.rotated,
            reason: uploadResult.reason || 'upload-wait',
            wait: true,
            retryable: true,
          };
        }

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
      const countMode = normalizeTaskAutoUploadCountMode(settings.countMode);
      const countModeLabel = getTaskAutoUploadCountModeLabel(countMode);
      const unitText = countMode === 'taskItem'
        ? '个任务项'
        : (countMode === 'assistantAnswer' ? '次助手回答' : '条发送消息');

      if (!settings.enabled) {
        return {
          interval,
          countMode,
          countModeLabel,
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
        countMode,
        countModeLabel,
        enabled: true,
        summary: `上传规则：首次上传，之后每 ${interval}${unitText}再次上传；当前策略：第 ${patternText}${unitText}发送前强制重传（计数口径：${countModeLabel}）`,
        patternText,
      };
    }

    function shouldUploadFileForTaskMessageNo(messageNo, interval) {
      const everyN = Math.max(1, Number(interval) || 1);
      const no = Math.max(1, Number(messageNo) || 1);
      return (no - 1) % everyN === 0;
    }

    function getExpectedAutoUploadSlotNo(currentCount, interval) {
      const everyN = Math.max(1, Number(interval) || 1);
      const count = Math.max(0, Number(currentCount) || 0);

      if (count <= 0) {
        return 1;
      }

      const zeroBased = Math.floor((count - 1) / everyN) * everyN;
      return zeroBased + 1;
    }

    function getTaskAutoUploadDecision(kind) {
      const settings = getTaskAutoUploadSettings();
      const force = !!(state.taskRun && state.taskRun.forceUploadBeforeNextSend === true);
      const countMode = normalizeTaskAutoUploadCountMode(settings.countMode);
      const normalizedKind = String(kind || '').trim().toLowerCase();
      const currentCount = (() => {
        if (!state.taskRun) {
          return 0;
        }
        if (countMode === 'message') {
          return Math.max(0, Number(state.taskRun.sentMessageCount) || 0);
        }
        if (countMode === 'assistantAnswer') {
          return Math.max(0, Number(state.taskRun.assistantReplyCountForUpload) || 0);
        }
        return Math.max(0, Number(state.taskRun.currentIndex) || 0);
      })();
      const interval = Math.max(1, Number(settings.interval) || 5);
      const nextMessageNo = currentCount + 1;
      const lastAutoUploadAt = state.taskRun
        ? (
          countMode === 'assistantAnswer'
            ? Math.max(0, Number(state.taskRun.lastAutoUploadAtAssistantReplyCount) || 0)
            : Math.max(0, Number(state.taskRun.lastAutoUploadAtMessageCount) || 0)
        )
        : 0;
      const shouldUploadInitial = normalizedKind === 'initial';
      const shouldUploadByInterval = (
        !shouldUploadInitial
        && countMode !== 'assistantAnswer'
        && shouldUploadFileForTaskMessageNo(nextMessageNo, interval)
      );
      const shouldUploadByReplyGap = (
        !shouldUploadInitial
        && countMode === 'assistantAnswer'
        && normalizedKind !== 'verification'
        && currentCount - lastAutoUploadAt >= interval
      );
      const dueSlotNo = (
        countMode === 'assistantAnswer'
          ? currentCount
          : getExpectedAutoUploadSlotNo(currentCount, interval)
      );
      const missedDueSlot = (
        !shouldUploadInitial
        && countMode !== 'assistantAnswer'
        && dueSlotNo > 0
        && currentCount >= dueSlotNo
        && lastAutoUploadAt < dueSlotNo
      );
      const shouldUploadByMissedSlot = missedDueSlot;
      const uploadSlotNo = shouldUploadInitial
        ? currentCount
        : (shouldUploadByReplyGap ? currentCount : (shouldUploadByInterval ? nextMessageNo : dueSlotNo));

      const pendingItems = typeof UploadModule !== 'undefined'
        && typeof UploadModule.getPendingUploadItems === 'function'
        ? UploadModule.getPendingUploadItems()
        : [];
      const pendingFiles = Array.isArray(pendingItems) ? pendingItems.length : 0;

      let skipReason = '';

      if (!state.running) {
        skipReason = 'not-running';
      } else if (!state.taskRun) {
        skipReason = 'no-task-run';
      } else if (shouldUploadInitial) {
        skipReason = 'initial-upload';
      } else if (force) {
        skipReason = 'force-upload';
      } else if (!settings.enabled) {
        skipReason = 'disabled';
      } else if (!shouldCountTaskSendKindForAutoUpload(kind)) {
        skipReason = 'kind-not-counted';
      } else if (!shouldUploadByInterval && !shouldUploadByMissedSlot && !shouldUploadByReplyGap) {
        skipReason = 'interval-not-hit';
      } else if (lastAutoUploadAt === uploadSlotNo) {
        skipReason = 'already-uploaded-for-message';
      } else if (shouldUploadByMissedSlot) {
        skipReason = 'missed-slot-upload';
      } else if (shouldUploadByReplyGap) {
        skipReason = 'reply-gap-upload';
      } else {
        skipReason = 'should-upload';
      }

      // 关键：pendingFiles=0 只能说明内部队列没有 pending 状态文件，不能阻止命中上传间隔时的强制重传策略
      const shouldUpload = (
        skipReason === 'initial-upload'
        || skipReason === 'force-upload'
        || skipReason === 'should-upload'
        || skipReason === 'missed-slot-upload'
        || skipReason === 'reply-gap-upload'
      );

      if (shouldUploadByReplyGap) {
        ToolboxShell.appendLog(
          `[AUTOQ][CLOSED_LOOP][UPLOAD_BY_5_REPLIES] replyCount=${currentCount} lastUploadAt=${lastAutoUploadAt}`,
        );
      }

      return {
        enabled: settings.enabled,
        force,
        kind: String(kind || '-'),
        normalizedKind,
        countMode,
        currentCount,
        nextMessageNo,
        interval,
        shouldUploadInitial,
        shouldUploadByInterval,
        shouldUploadByReplyGap,
        shouldUploadByMissedSlot,
        uploadSlotNo,
        lastAutoUploadAt,
        pendingFiles,
        shouldUpload,
        skipReason,
      };
    }

    function logTaskAutoUploadDecision(kind) {
      const decision = getTaskAutoUploadDecision(kind);

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_AUTO_UPLOAD][DECISION] enabled=${decision.enabled ? 1 : 0} force=${decision.force ? 1 : 0} `
        + `kind=${decision.kind} countMode=${decision.countMode} currentCount=${decision.currentCount} nextMessageNo=${decision.nextMessageNo} `
        + `interval=${decision.interval} shouldUploadByInterval=${decision.shouldUploadByInterval ? 1 : 0} `
        + `shouldUploadByReplyGap=${decision.shouldUploadByReplyGap ? 1 : 0} shouldUploadByMissedSlot=${decision.shouldUploadByMissedSlot ? 1 : 0} uploadSlotNo=${decision.uploadSlotNo} `
        + `lastAutoUploadAt=${decision.lastAutoUploadAt} pendingFiles=${decision.pendingFiles} `
        + `shouldUpload=${decision.shouldUpload ? 1 : 0} skipReason=${decision.skipReason}`,
      );

      return decision;
    }

    async function runTaskAutoUploadBeforeNextSend(kind, task) {
      const decision = logTaskAutoUploadDecision(kind);
      const normalizedKind = String(kind || '').trim().toLowerCase();
      const isInitialSend = normalizedKind === 'initial';

      if (!decision.shouldUpload) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][SKIP] kind=${decision.kind} `
          + `countMode=${decision.countMode} currentCount=${decision.currentCount} `
          + `nextMessageNo=${decision.nextMessageNo} interval=${decision.interval} `
          + `shouldUploadByInterval=${decision.shouldUploadByInterval ? 1 : 0} `
          + `lastAutoUploadAt=${decision.lastAutoUploadAt} pendingFiles=${decision.pendingFiles} `
          + `reason=${decision.skipReason || 'not-needed'}`,
        );

        return {
          ok: true,
          skipped: true,
          reason: decision.skipReason || 'not-needed',
        };
      }

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.startUploadForAutoQueue !== 'function'
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
      const currentCount = Math.max(0, Number(decision.currentCount) || 0);
      const nextMessageNo = Math.max(1, Number(decision.nextMessageNo) || 1);
      const uploadSlotNo = Math.max(
        1,
        Number(decision.uploadSlotNo || decision.nextMessageNo) || decision.nextMessageNo,
      );

      let composerHasUploadPayload = false;

      if (typeof UploadModule.detectComposerHasUploadPayload === 'function') {
        composerHasUploadPayload = !!UploadModule.detectComposerHasUploadPayload();
      } else if (typeof ComposerApi !== 'undefined') {
        if (typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function') {
          composerHasUploadPayload = composerHasUploadPayload
            || !!ComposerApi.hasVisibleComposerAttachmentPayload();
        }

        if (typeof ComposerApi.countAttachmentChipsFast === 'function') {
          composerHasUploadPayload = composerHasUploadPayload
            || ComposerApi.countAttachmentChipsFast() > 0;
        } else if (typeof ComposerApi.countAttachmentChips === 'function') {
          composerHasUploadPayload = composerHasUploadPayload
            || ComposerApi.countAttachmentChips() > 0;
        }
      }

      const pendingItems = typeof UploadModule.getPendingUploadItems === 'function'
        ? UploadModule.getPendingUploadItems()
        : [];

      const pendingUploadCount = Array.isArray(pendingItems) ? pendingItems.length : 0;

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_AUTO_UPLOAD][PRECHECK] force=${forceUpload ? 1 : 0} pendingUploadCount=${pendingUploadCount} composerHasPayload=${composerHasUploadPayload ? 1 : 0} nextMessageNo=${nextMessageNo}`,
      );

      if (forceUpload && composerHasUploadPayload) {
        if (state.taskRun) {
          if (decision.countMode === 'assistantAnswer') {
            state.taskRun.lastAutoUploadAtAssistantReplyCount = currentCount;
          } else {
            state.taskRun.lastAutoUploadAtMessageCount = uploadSlotNo;
          }
          state.taskRun.lastAutoUploadDoneAt = Date.now();
          state.taskRun.forceUploadBeforeNextSend = false;
        }

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][FORCE_REUPLOAD_DONE] kind=${kind || '-'} nextMessageNo=${nextMessageNo} `
          + `uploadSlotNo=${uploadSlotNo} ok=1 uploaded=0 failed=0 skipped=0 reason=composer-already-has-upload-payload`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][MARK_SLOT_DONE] uploadSlotNo=${uploadSlotNo} `
          + `countMode=${decision.countMode} `
          + `lastAutoUploadAtMessageCount=${state.taskRun ? Number(state.taskRun.lastAutoUploadAtMessageCount) || 0 : 0} `
          + `lastAutoUploadAtAssistantReplyCount=${state.taskRun ? Number(state.taskRun.lastAutoUploadAtAssistantReplyCount) || 0 : 0} `
          + `uploaded=0 reason=composer-already-has-upload-payload`,
        );

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][COMPOSER_HAS_FILE_CONTINUE] force=1 nextMessageNo=${nextMessageNo} uploadSlotNo=${uploadSlotNo} reason=composer-already-has-upload-payload`,
        );

        return {
          ok: true,
          skipped: true,
          reason: 'composer-already-has-upload-payload',
        };
      }

      setTaskBatchStep('auto-upload-before-send', task || getCurrentRunningTask(), { log: true });
      if (isInitialSend) {
        ToolboxShell.appendLog('[AUTOQ][CLOSED_LOOP][INITIAL_UPLOAD]');
        ToolboxShell.setStatus('批量任务：正在上传初始附件，上传完成后发送初始指令');
      } else {
        ToolboxShell.setStatus(`批量任务组：第 ${uploadSlotNo} 次发送前自动上传文件`);
      }
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_AUTO_UPLOAD][START] kind=${kind || '-'} countMode=${decision.countMode} currentCount=${currentCount} forceUpload=${forceUpload ? 1 : 0}`,
      );
      ToolboxShell.appendLog(
        `[AUTOQ][TASK_AUTO_UPLOAD][BEFORE_NEXT_SEND] completedSendCount=${currentCount} nextMessageNo=${nextMessageNo} uploadSlotNo=${uploadSlotNo} action=upload-then-send`,
      );
      if (isInitialSend) {
        ToolboxShell.appendLog('[AUTOQ][TASK_AUTO_UPLOAD][START_BEFORE_INITIAL_SEND]');
      }

      state.batchAutoUploading = true;
      state.uploadingFromAutoQueue = false;
      if (isInitialSend) {
        setBatchTaskGroupDisplayState('starting_upload', 'initial-auto-upload-start');
      }
      logUploadBatchState('batch-auto-upload-start');
      ToolboxShell.appendLog('[BATCH_AUTO_UPLOAD][START] manualUploadRunning=0 batchTaskRunning=1 batchAutoUploading=1');
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
          ? Math.max(0, Number(uploadRateStatus.remaining) || 0)
          : 0;

        if (uploadRateStatus.enabled && maxFilesForThisUpload <= 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][BLOCKED] sentMessageCount=${currentCount} reason=no-upload-quota`,
          );

          return {
            ok: false,
            reason: 'no-upload-quota',
          };
        }

        if (uploadRateStatus.enabled && maxFilesForThisUpload > 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][RATE_LIMIT] sentMessageCount=${currentCount} preResetPending=${pendingUploadCount} `
            + `allowed=${maxFilesForThisUpload} reason=upload-rate-limit`,
          );
        }

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][FORCE_REUPLOAD_START] kind=${kind || '-'} nextMessageNo=${nextMessageNo} uploadSlotNo=${uploadSlotNo} interval=${decision.interval} force=${forceUpload ? 1 : 0}`,
        );

        const uploadResult = await UploadModule.startUploadForAutoQueue({
          source: `autoq-task-${String(kind || '-').trim() || '-'}-${uploadSlotNo}`,
          forceReupload: true,
          shouldStop: () => !state.running,
          maxFiles: maxFilesForThisUpload,
        });

        const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
        const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
        const skippedCount = Number(uploadResult && uploadResult.skippedCount) || 0;
        const reason = String(uploadResult && uploadResult.reason || '').trim();

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][FORCE_REUPLOAD_DONE] kind=${kind || '-'} nextMessageNo=${nextMessageNo} `
          + `uploadSlotNo=${uploadSlotNo} ok=${uploadResult && uploadResult.ok ? 1 : 0} `
          + `uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} reason=${reason || '-'}`,
        );

        if (!uploadResult || uploadResult.ok !== true) {
          if (
            isInitialSend
            && reason === 'cancelled'
            && state.batchTask
            && state.batchTask.stopRequested
          ) {
            ToolboxShell.appendLog('[AUTOQ][TASK_AUTO_UPLOAD][CANCELLED_BY_START_BUTTON_TOGGLE]');
          }
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][FAILED] sentMessageCount=${currentCount} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} reason=${reason || 'upload-failed'}`,
          );

          return {
            ok: false,
            reason: reason || 'upload-failed',
          };
        }

        const composerPayloadAccepted = (
          reason === 'composer-already-has-file'
          || reason === 'composer-already-has-upload-payload'
        );

        if (uploadedCount <= 0 && !composerPayloadAccepted) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_AUTO_UPLOAD][FAILED] sentMessageCount=${currentCount} uploaded=0 reason=no-uploaded-files markSlot=0`,
          );

          return {
            ok: false,
            reason: reason || 'no-uploaded-files',
          };
        }

        if (state.taskRun) {
          if (decision.countMode === 'assistantAnswer') {
            state.taskRun.lastAutoUploadAtAssistantReplyCount = currentCount;
          } else {
            state.taskRun.lastAutoUploadAtMessageCount = uploadSlotNo;
          }
          state.taskRun.lastAutoUploadDoneAt = Date.now();
        }

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][MARK_SLOT_DONE] uploadSlotNo=${uploadSlotNo} `
          + `countMode=${decision.countMode} `
          + `lastAutoUploadAtMessageCount=${state.taskRun ? Number(state.taskRun.lastAutoUploadAtMessageCount) || 0 : 0} `
          + `lastAutoUploadAtAssistantReplyCount=${state.taskRun ? Number(state.taskRun.lastAutoUploadAtAssistantReplyCount) || 0 : 0} `
          + `uploaded=${uploadedCount} reason=${reason || '-'}`,
        );

        if (uploadedCount <= 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][NOT_RECORDED] source=auto-upload sentMessageCount=${currentCount} uploaded=0 reason=no-uploaded-files`,
          );
        }

        ToolboxShell.appendLog(
          `[AUTOQ][TASK_AUTO_UPLOAD][DONE] sentMessageCount=${currentCount} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount}`,
        );
        if (isInitialSend) {
          ToolboxShell.appendLog('[AUTOQ][TASK_AUTO_UPLOAD][DONE_BEFORE_INITIAL_SEND]');
        }

        if (forceUpload && state.taskRun) {
          state.taskRun.forceUploadBeforeNextSend = false;
        }

        return {
          ok: true,
          skipped: uploadedCount <= 0,
          reason: uploadedCount > 0 ? 'uploaded' : (reason || 'composer-payload-ready'),
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
        state.batchAutoUploading = false;
        state.uploadingFromAutoQueue = false;
        logUploadBatchState('batch-auto-upload-done');
        ToolboxShell.appendLog('[BATCH_AUTO_UPLOAD][DONE] manualUploadRunning=0 batchTaskRunning=1 batchAutoUploading=0');
        updateStatus('task-auto-upload-done');
      }
    }

    async function onAssistantReplySettled(replyText, meta = {}) {
      if (!state.running || !state.taskRun) {
        return;
      }

      const task = getCurrentRunningTask();
      const title = task && task.title ? task.title : '-';
      syncCurrentTaskVerificationContext(task, { resetState: false, keepRetryCount: true });
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

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        ToolboxShell.appendLog('[AUTOQ][REPLY_READY_BLOCKED_BUSY] reason=assistant-still-busy');
        repairWaitingReplyForAssistantBusy('reply-ready-blocked-busy');
        return;
      }

      setAutoQueuePhase(AUTO_QUEUE_PHASES.REPLY_READY, 'assistant reply ready');

      if (state.waitingReply) {
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = 0;
        ToolboxShell.appendLog('[AUTOQ][WAITING_REPLY_CLEAR]');
      }

      clearVisibleDoneSignalTracking();
      touchBatchTaskGroupActivity(`reply-settled:${meta && meta.reason ? meta.reason : 'unknown'}`);

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

      syncCurrentTaskVerificationContext(task, { resetState: false, keepRetryCount: true });
      setTaskBatchStep('wait-reply', task, { log: false });

      let replyText = '';

      try {
        replyText = getLastAssistantReplyText();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] handleTaskReplyReady get reply failed', err);
        log(`读取回复异常：${errText}`);
        recoverBatchTaskGroup(getBatchTaskGroupRunId(), errText || 'get-reply-failed', {
          action: 'reply-ready-retry',
          clearStepRunning: true,
        });
        return;
      }

      const profile = getActiveTaskProfile();
      const resolved = resolveTaskContinueSettings(task, profile, { log: true });

      if (!replyText) {
        const skipTaskIndex = state.taskRun ? Number(state.taskRun.currentIndex || 0) : 0;
        ToolboxShell.appendLog(
          `[BATCH_TASK_GROUP][COPY_REPLY_SKIP] reason=no-reply-found taskIndex=${skipTaskIndex + 1}`,
        );

        recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'empty-reply', {
          action: 'wait-reply-recover',
          clearStepRunning: true,
          clearWaiting: false,
        });
        return;
      }

      if (tryStopBatchOnReplyClassify(replyText, task)) {
        return;
      }

      recordAssistantReplyForUploadCounter(
        replyText,
        state.taskRun && state.taskRun.doneSignalVerificationRunning ? 'verification-reply' : 'reply-ready',
        resolved.actualDoneSignal,
      );

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
          ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][VERIFY_DONE_CONFIRMED] task=${task.title}`);
          ToolboxShell.appendLog('[AUTOQ][CONTINUE_NEXT] reason=verify-complete');

          void handleTaskDoneSignal(task, profile, resolved, replyText, 'verify-reply-complete').catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] [AUTOQ][TASK_DONE][FAILED]', err);
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_DONE][FAILED] source=verify-reply-complete task=${task.title || '-'} reason=${errText}`,
            );
            failCurrentTask(errText || 'done-signal-handler-failed');
          });
          return;
        }

        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_CONTINUE_REQUIRED] task=${task.title}`);
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][VERIFY_CONTINUE_REQUIRED] task=${task.title}`);
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
              handleTaskQueueRateLimitFailure(rateLimitResult, task, 'verify-continue-page-rotate');
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
            handleTaskQueueRateLimitFailure(rateLimitResult, task, 'verify-continue');
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
            ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][DONE_SIGNAL] task=${task.title}`);
            ToolboxShell.appendLog(`[AUTOQ][TASK][DONE_SIGNAL] task=${task.title}`);

            void handleTaskDoneSignal(task, profile, resolved, replyText, 'verify-continue-done-signal').catch((err) => {
              const errText = err && err.message ? err.message : String(err);
              console.error('[ChatGPT toolbox] [AUTOQ][TASK_DONE][FAILED]', err);
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_DONE][FAILED] source=verify-continue-done-signal task=${task.title || '-'} reason=${errText}`,
              );
              failCurrentTask(errText || 'done-signal-handler-failed');
            });
            return;
          }

          if (!result || !result.ok) {
            failCurrentTask(failReason || 'verify-continue-failed', {
              detail: result && result.detail ? result.detail : '',
              retryable: !!(result && result.retryable === true),
              wait: !!(result && result.wait === true),
            });
            return;
          }

          if (result.continueSent) {
            if (result.quotaRecorded !== true) {
              recordTaskSendRateLimitHit('verify-continue');
            } else {
              ToolboxShell.appendLog('[MESSAGE_QUOTA][RECORD_SKIP_ALREADY_RECORDED] source=verify-continue');
            }
            recordTaskBatchMessageSent('verify-continue');
            ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][CONTINUE_SEND] task=${task.title} kind=verify-continue round=${task.continueCount}`);
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
          if (state.taskRun && state.taskRun.pendingSendKind === 'processing') {
            state.taskRun.pendingSendKind = null;
          }
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
        ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][DONE_FIRST_SEEN] task=${task.title}`);

        void handleTaskDoneSignal(task, profile, resolved, replyText, 'normal-done-check').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] [AUTOQ][TASK_DONE][FAILED]', err);
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_DONE][FAILED] source=normal-done-check task=${task.title || '-'} reason=${errText}`,
          );
          failCurrentTask(errText || 'done-signal-handler-failed');
        });
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
            handleTaskQueueRateLimitFailure(rateLimitResult, task, 'continue-page-rotate');
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
          handleTaskQueueRateLimitFailure(rateLimitResult, task, 'continue');
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
          const copyDoneTaskIndex = state.taskRun ? Number(state.taskRun.currentIndex || 0) : 0;
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][COPY_DONE] task=${task.title} chars=${copiedChars}`);
          ToolboxShell.appendLog(`[BATCH_TASK_GROUP][COPY_REPLY_DONE] taskIndex=${copyDoneTaskIndex} length=${copiedChars}`);
        } else if (!result.assistantDoneSignal) {
          const copyFailTaskIndex = state.taskRun ? Number(state.taskRun.currentIndex || 0) : 0;
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][COPY_NOT_DONE] task=${task.title} reason=${failReason || 'copy-failed'}`,
          );
          ToolboxShell.appendLog(`[BATCH_TASK_GROUP][COPY_REPLY_FAIL] reason=${failReason || 'copy-failed'} taskIndex=${copyFailTaskIndex}`);
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
          ToolboxShell.appendLog(`[AUTOQ][TASK][DONE_SIGNAL] task=${task.title}`);

          void handleTaskDoneSignal(task, profile, resolved, replyText, 'copy-hotkey-done-signal').catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] [AUTOQ][TASK_DONE][FAILED]', err);
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_DONE][FAILED] source=copy-hotkey-done-signal task=${task.title || '-'} reason=${errText}`,
            );
            failCurrentTask(errText || 'done-signal-handler-failed');
          });
          return;
        }

        if (!result.ok) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][FAILED] task=${task.title} reason=${failReason || 'copy-hotkey-continue-failed'}`);
          failCurrentTask(failReason || 'copy-hotkey-continue-failed', {
            detail: result && result.detail ? result.detail : '',
            retryable: !!(result && result.retryable === true),
            wait: !!(result && result.wait === true),
          });
          return;
        }

        if (result.continueSent) {
          if (result.quotaRecorded !== true) {
            recordTaskSendRateLimitHit('continue');
          } else {
            ToolboxShell.appendLog('[MESSAGE_QUOTA][RECORD_SKIP_ALREADY_RECORDED] source=continue');
          }
          recordTaskBatchMessageSent('continue');
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][SEND_CONTINUE] task=${task.title} round=${round}`);
          ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][CONTINUE_SEND] task=${task.title} kind=continue round=${round}`);
        } else {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][CONTINUE_NOT_SENT] task=${task.title} reason=${failReason || 'continue-not-sent'}`,
          );
        }

        if (!(result.copied && result.hotkeySent && result.continueSent)) {
          failCurrentTask(failReason || 'batch-step-incomplete', {
            detail: result && result.detail ? result.detail : '',
            retryable: !!(result && result.retryable === true),
            wait: !!(result && result.wait === true),
          });
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
        state.taskRun.pendingSendKind = null;
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
            setButtonDanger(button, '再次点击删除', { reason: 'list-delete-confirm', permanentDanger: true });
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

      const quotaWaitModeEl = qs('#cgpt-autoq-task-quota-wait-mode', taskProfileDefaultsEl);
      const quotaMaxWaitMinutesEl = qs('#cgpt-autoq-task-quota-max-wait-minutes', taskProfileDefaultsEl);
      if (quotaWaitModeEl) {
        config.taskQueueSettings.taskQuotaWaitMode = normalizeTaskQuotaWaitMode(quotaWaitModeEl.value);
      }
      if (quotaMaxWaitMinutesEl) {
        config.taskQueueSettings.taskQuotaMaxWaitMinutes = Math.max(
          1,
          Math.floor(Number(quotaMaxWaitMinutesEl.value) || 30),
        );
      }

      const autoUploadEnabledEl = qs('#cgpt-autoq-task-auto-upload-enabled', taskProfileDefaultsEl);
      const autoUploadIntervalEl = qs('#cgpt-autoq-task-auto-upload-interval', taskProfileDefaultsEl);
      const autoUploadCountModeEl = qs('#cgpt-autoq-task-auto-upload-count-mode', taskProfileDefaultsEl);

      if (autoUploadEnabledEl) {
        config.taskQueueSettings.taskAutoUploadEveryNMessagesEnabled = autoUploadEnabledEl.checked === true;
      }

      if (autoUploadIntervalEl) {
        config.taskQueueSettings.taskAutoUploadEveryNMessages = Math.max(
          1,
          Math.floor(Number(autoUploadIntervalEl.value) || 5),
        );
      }

      if (autoUploadCountModeEl) {
        config.taskQueueSettings.taskAutoUploadCountMode = normalizeTaskAutoUploadCountMode(
          autoUploadCountModeEl.value,
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
            <label for="cgpt-autoq-task-quota-wait-mode">额度等待策略（额度/限速不足时）</label>
            <select class="cgpt-input" id="cgpt-autoq-task-quota-wait-mode">
              ${(() => {
    const currentMode = normalizeTaskQuotaWaitMode(
      config.taskQueueSettings && config.taskQueueSettings.taskQuotaWaitMode,
    );
    const options = [
      { value: 'wait_until_available', label: '一直等待直到额度恢复（推荐）' },
      { value: 'stop_on_limit', label: '额度满立即停止本次批量任务组' },
      { value: 'wait_max_then_stop', label: '最多等待指定时间后停止' },
    ];
    return options.map((option) => `<option value="${option.value}" ${currentMode === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
  })()}
            </select>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-quota-max-wait-minutes">最多等待时间（分钟）</label>
            <input class="cgpt-input" id="cgpt-autoq-task-quota-max-wait-minutes" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskQuotaMaxWaitMinutes) || 30))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>额度等待说明</label>
            <div class="cgpt-hint">当上传额度或消息额度不足时，批量任务会进入等待状态并每 30 秒检测一次；当模式为“最多等待后停止”会自动超时终止。</div>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-auto-upload-enabled">每 N 次自动上传</label>
            <label class="cgpt-checkbox-row">
              <input id="cgpt-autoq-task-auto-upload-enabled" type="checkbox" ${(config.taskQueueSettings && config.taskQueueSettings.taskAutoUploadEveryNMessagesEnabled !== false) ? 'checked' : ''}>
              启用
            </label>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-auto-upload-count-mode">自动上传计数口径</label>
            <select class="cgpt-input" id="cgpt-autoq-task-auto-upload-count-mode">
              ${(() => {
    const currentCountMode = normalizeTaskAutoUploadCountMode(
      config.taskQueueSettings && config.taskQueueSettings.taskAutoUploadCountMode,
    );
    const options = [
      { value: 'message', label: '按发送 Prompt 次数（推荐）' },
      { value: 'taskItem', label: '按任务项序号' },
      { value: 'assistantAnswer', label: '按助手回答次数' },
    ];
    return options.map((option) => `<option value="${option.value}" ${currentCountMode === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
  })()}
            </select>
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label for="cgpt-autoq-task-auto-upload-interval">自动上传间隔</label>
            <input class="cgpt-input" id="cgpt-autoq-task-auto-upload-interval" type="number" data-no-wheel-number="1" min="1" value="${escapeHtml(String((config.taskQueueSettings && config.taskQueueSettings.taskAutoUploadEveryNMessages) || 5))}">
          </div>
          <div class="cgpt-kv cgpt-autoq-batch-rules-inline-row">
            <label>自动上传说明</label>
            <div class="cgpt-hint">默认每 5 次发送 Prompt 前上传一次文件，策略为第 1、6、11... 次发送前强制重传。可切换为按任务项序号或按助手回答次数计数。</div>
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

      const prevScrollTop = taskListEl.scrollTop;

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

      window.requestAnimationFrame(() => {
        if (taskListEl && !_isUserScrollProtected()) {
          taskListEl.scrollTop = prevScrollTop;
        }
      });
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

    function resolveAutoQueueAttachmentSnapshot(options = {}) {
      const needDetailed = options.detailed === true;
      if (
        !needDetailed
        && typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.getComposerAttachmentSnapshotFast === 'function'
      ) {
        return ComposerApi.getComposerAttachmentSnapshotFast('autoq-status');
      }
      if (
        typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.getComposerAttachmentSnapshot === 'function'
      ) {
        return ComposerApi.getComposerAttachmentSnapshot('autoq-status');
      }
      return null;
    }

    function getAutoQueueUploadStatusText() {
      const status = String(state.autoQueueUploadStatus || 'idle');
      const stats = state.autoQueueUploadStats || {};

      if (status === 'uploading') {
        const attachSnap = resolveAutoQueueAttachmentSnapshot();
        if (attachSnap && attachSnap.uploadingCount > 0) {
          return `上传中 ${attachSnap.uploadingCount} 个`;
        }
        return '上传中';
      }
      if (status === 'done') {
        const attachSnap = resolveAutoQueueAttachmentSnapshot();
        if (attachSnap && !attachSnap.hasAnyAttachment) {
          return `上传完成，成功 ${Number(stats.uploaded) || 0} 个，失败 ${Number(stats.failed) || 0} 个（本轮未检测到附件）`;
        }
        if (attachSnap && attachSnap.hasReadyAttachment) {
          return `已加入输入框 ${attachSnap.readyCount} 个`;
        }
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

      if (status === 'idle' || status === 'cancelled') {
        const attachSnap = resolveAutoQueueAttachmentSnapshot();
        if (attachSnap && attachSnap.hasReadyAttachment) {
          return `已加入输入框 ${attachSnap.readyCount} 个`;
        }
        if (attachSnap && !attachSnap.hasAnyAttachment && (state.running || state.batchTaskRunning)) {
          return '本轮未检测到附件';
        }
      }

      return '未上传';
    }

    function resolveAutoQueueUploadTaskState() {
      if (typeof UploadModule === 'undefined') {
        return null;
      }

      if (typeof UploadModule.getUploadTaskState === 'function') {
        const task = UploadModule.getUploadTaskState();
        if (task && typeof task === 'object') {
          return task;
        }
      }

      if (typeof UploadModule.getUnifiedRuntimeStatus === 'function') {
        const runtime = UploadModule.getUnifiedRuntimeStatus('autoq:upload-task-state');
        if (runtime && runtime.uploadTask && typeof runtime.uploadTask === 'object') {
          return runtime.uploadTask;
        }
      }

      return null;
    }

    function logUploadEntry(tag, details = {}) {
      const safeTag = String(tag || 'UNKNOWN').trim() || 'UNKNOWN';
      const safeSource = String(details.source || '-').trim() || '-';
      const buttonId = String(details.buttonId || 'cgpt-autoq-start-upload').trim() || 'cgpt-autoq-start-upload';
      const phase = resolveAutoQueueUploadButtonPhase();
      const extraReason = details.reason ? ` reason=${String(details.reason)}` : '';
      const extraRoute = details.route ? ` route=${String(details.route)}` : '';

      ToolboxShell.appendLog(
        `[UPLOAD_ENTRY][${safeTag}] source=${safeSource} buttonId=${buttonId} phase=${phase}`
        + ` manualUploadRunning=${state.manualUploadRunning ? 1 : 0}`
        + ` uploadingFromAutoQueue=${state.uploadingFromAutoQueue ? 1 : 0}`
        + ` autoQueueUploadStatus=${String(state.autoQueueUploadStatus || '-')}`
        + extraReason
        + extraRoute,
      );
    }

    function restoreAutoQueueUploadIdleAfterBlocked(source, blockReason) {
      const safeSource = String(source || 'unknown').trim() || 'unknown';
      const safeReason = String(blockReason || 'blocked').trim() || 'blocked';

      state.manualUploadRunning = false;
      state.uploadingFromAutoQueue = false;
      state.autoQueueUploadCancelRequested = false;
      state.autoQueueUploadStatus = 'idle';
      logUploadEntry('RESTORE_IDLE', { source: safeSource, reason: safeReason });
      updateStatus(`start-upload-blocked-${safeReason}`);
    }

    function resolveAutoQueueUploadButtonPhase() {
      const uploadTask = resolveAutoQueueUploadTaskState();
      const taskPhase = uploadTask && uploadTask.phase
        ? String(uploadTask.phase || 'idle').trim().toLowerCase()
        : '';
      const taskOwner = uploadTask && uploadTask.owner
        ? String(uploadTask.owner || '').trim().toLowerCase()
        : '';
      if (taskPhase) {
        if (state.manualUploadRunning !== (taskPhase === 'uploading' && taskOwner !== 'batch-initial')) {
          ToolboxShell.appendLog(
            `[UPLOAD_STATE][MISMATCH] manualUploadRunning=${state.manualUploadRunning ? 1 : 0} uploadPhase=${taskPhase} owner=${taskOwner || '-'}`,
          );
        }
        if (taskPhase === 'uploading' || taskPhase === 'cancelling' || taskPhase === 'failed') {
          return taskPhase;
        }
      }

      if (state.manualUploadRunning) {
        return 'uploading';
      }

      const status = String(state.autoQueueUploadStatus || 'idle').trim().toLowerCase();
      if (status === 'uploading' || status === 'cancelling') {
        return status;
      }
      if (status === 'failed') {
        return 'failed';
      }

      if (typeof ButtonTasks !== 'undefined' && typeof ButtonTasks.getButtonTask === 'function') {
        const uploadTask = ButtonTasks.getButtonTask('upload');
        if (uploadTask && uploadTask.phase) {
          const taskPhase = String(uploadTask.phase || 'idle').trim().toLowerCase();
          if (taskPhase === 'failed') {
            return 'failed';
          }
        }
      }

      return 'idle';
    }

    function resolveActiveUploadFileCountForLog() {
      if (typeof UploadGroupAppState !== 'undefined' && Array.isArray(UploadGroupAppState.uploadItems)) {
        return UploadGroupAppState.uploadItems.filter(Boolean).length;
      }
      return null;
    }

    function logUploadBatchState(reason = '') {
      const safeReason = String(reason || '-');

      try {
        const activeFiles = resolveActiveUploadFileCountForLog();

        const phase = String(state.phase || '-');
        const uploadStatus = String(state.autoQueueUploadStatus || '-');

        const stats = state.autoQueueUploadStats && typeof state.autoQueueUploadStats === 'object'
          ? state.autoQueueUploadStats
          : {};

        const uploaded = Number(stats.uploaded || 0);
        const failed = Number(stats.failed || 0);
        const skipped = Number(stats.skipped || 0);
        const statReason = String(stats.reason || '-');

        ToolboxShell.appendLog(
          `[AUTOQ][UPLOAD_BATCH_STATE] reason=${safeReason} `
          + `phase=${phase} `
          + `running=${state.running ? 1 : 0} `
          + `manualUploadRunning=${state.manualUploadRunning ? 1 : 0} `
          + `uploadingFromAutoQueue=${state.uploadingFromAutoQueue ? 1 : 0} `
          + `batchTaskRunning=${state.batchTaskRunning ? 1 : 0} `
          + `batchAutoUploading=${state.batchAutoUploading ? 1 : 0} `
          + `uploadStatus=${uploadStatus} `
          + `activeFiles=${activeFiles == null ? '-' : activeFiles} `
          + `uploaded=${uploaded} failed=${failed} skipped=${skipped} `
          + `statReason=${statReason}`,
        );
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        console.error('[AUTOQ][UPLOAD_BATCH_STATE][ERROR]', error);
        ToolboxShell.appendLog(
          `[AUTOQ][UPLOAD_BATCH_STATE][ERROR] reason=${safeReason} error=${message}`,
        );
      }
    }

    async function runAutoQueueStartUploadFromButton(button, source, event) {
      const safeSource = String(source || 'unknown').trim() || 'unknown';
      const normalizedAction = normalizeAutoQueueStartUploadAction(
        button && button.dataset ? button.dataset.action : 'start-upload',
      );

      if (event) {
        if (typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      logUploadEntry('CLICK', { source: safeSource, buttonId: 'cgpt-autoq-start-upload' });
      ToolboxShell.appendLog(
        `[AUTOQUEUE][START_UPLOAD][CLICK] source=${safeSource} action=${normalizedAction}`,
      );

      if (normalizedAction !== 'start-upload') {
        ToolboxShell.appendLog(
          `[AUTOQUEUE][START_UPLOAD][SKIP] reason=unknown-action action=${normalizedAction}`,
        );
        return;
      }

      if (autoQueueStartUploadRunning) {
        ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=running');
        return;
      }

      const now = Date.now();
      if (now - autoQueueStartUploadLastTs < AUTO_QUEUE_START_UPLOAD_DEBOUNCE_MS) {
        ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=debounce');
        return;
      }
      autoQueueStartUploadLastTs = now;
      autoQueueStartUploadRunning = true;

      const uploadBtn = syncAutoQueueStartUploadButtonMeta(
        button || startUploadBtn || (root ? qs('#cgpt-autoq-start-upload', root) : null),
      );
      if (uploadBtn) {
        startUploadBtn = uploadBtn;
      }

      const uploadTaskBeforeClick = resolveAutoQueueUploadTaskState();
      const moduleUploadPhase = uploadTaskBeforeClick
        ? String(uploadTaskBeforeClick.phase || 'idle').trim().toLowerCase()
        : '';
      if (moduleUploadPhase === 'cancelling' || moduleUploadPhase === 'uploading') {
        ToolboxShell.appendLog(
          `[AUTOQUEUE][START_UPLOAD][SKIP] reason=upload-phase phase=${moduleUploadPhase}`,
        );
        return;
      }

      const wasUploadingFromAutoQueue = !!state.uploadingFromAutoQueue;
      state.autoQueueUploadCancelRequested = false;
      state.manualUploadRunning = true;
      state.uploadingFromAutoQueue = true;
      state.autoQueueUploadStatus = 'uploading';
      logUploadEntry('IMMEDIATE_BUSY', { source: safeSource, buttonId: 'cgpt-autoq-start-upload' });
      if (uploadBtn && typeof setButtonDanger === 'function') {
        setButtonDanger(uploadBtn, '上传中', {
          title: '上传中',
          allowCancel: true,
          reason: 'manual-upload-click-immediate',
        });
      }
      updateStatus('manual-upload-click-immediate');

      try {
        if (isAutoQueueStartUploadButtonDisabled(uploadBtn)) {
          ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=button-disabled');
          restoreAutoQueueUploadIdleAfterBlocked(safeSource, 'button-disabled');
          return;
        }

        const activeFilesForLog = resolveActiveUploadFileCountForLog();
        logUploadBatchState('manual-upload-click-before-start');

        const hasManualUpload = (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.runStartUploadButtonCore === 'function'
        );
        if (!hasManualUpload) {
          const reason = 'upload-module-missing';
          console.error('[AUTOQUEUE][START_UPLOAD][ERROR]', reason);
          ToolboxShell.appendLog(`[AUTOQUEUE][START_UPLOAD][ERROR] error=${reason}`);
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

        if (wasUploadingFromAutoQueue) {
          ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=uploading-from-autoqueue');
          restoreAutoQueueUploadIdleAfterBlocked(safeSource, 'uploading-from-autoqueue');
          return;
        }

        if (state.batchAutoUploading) {
          ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=batch-auto-uploading');
          state.autoQueueUploadStatus = 'failed';
          state.autoQueueUploadStats = {
            uploaded: 0,
            failed: 0,
            skipped: 0,
            reason: 'batch-auto-uploading',
          };
          updateStatus('start-upload-blocked-batch-auto-uploading');
          return;
        }

        if (activeFilesForLog === 0) {
          ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][SKIP] reason=no-files');
          state.autoQueueUploadStatus = 'no-files';
          state.autoQueueUploadStats = {
            uploaded: 0,
            failed: 0,
            skipped: 0,
            reason: 'no-files',
          };
          updateStatus('start-upload-blocked-no-files');
          return;
        }

        logUploadBatchState('manual-upload-start');

        const uploadRoute = 'UploadModule.runStartUploadButtonCore';
        logUploadEntry('ROUTE', {
          source: safeSource,
          buttonId: 'cgpt-autoq-start-upload',
          route: uploadRoute,
        });
        ToolboxShell.appendLog(`[AUTOQUEUE][START_UPLOAD][ROUTE] target=${uploadRoute}`);

        const result = await UploadModule.runStartUploadButtonCore({
          source: `autoqueue-start-upload:${safeSource}`,
          preserveAttached: true,
          shouldStop: () => state.autoQueueUploadCancelRequested === true,
        });

        const uploadedCount = Number(result && result.uploadedCount) || 0;
        const failedCount = Number(result && result.failedCount) || 0;
        const skippedCount = Number(result && result.skippedCount) || 0;
        const reason = String(result && result.reason || '').trim();
        const localPendingFiles = activeFilesForLog == null ? '-' : activeFilesForLog;
        const pageUploadedFiles = uploadedCount;
        const failedFiles = failedCount;
        const preservedUploadedFiles = Math.max(0, uploadedCount - failedCount);

        ToolboxShell.appendLog(
          `[AUTOQUEUE][START_UPLOAD][FILES] local_pending_files=${localPendingFiles} `
          + `page_uploaded_files=${pageUploadedFiles} failed_files=${failedFiles} `
          + `preserved_uploaded_files=${preservedUploadedFiles} skipped=${skippedCount}`,
        );

        state.autoQueueUploadStats = {
          uploaded: uploadedCount,
          failed: failedCount,
          skipped: skippedCount,
          reason,
        };

        if (reason === 'no-files') {
          state.autoQueueUploadStatus = 'no-files';
        } else if (reason === 'cancelled' || (result && result.cancelled)) {
          state.autoQueueUploadStatus = 'idle';
        } else if (result && result.ok) {
          state.autoQueueUploadStatus = 'done';
        } else {
          state.autoQueueUploadStatus = 'failed';
        }

        logUploadEntry('DONE', {
          source: safeSource,
          buttonId: 'cgpt-autoq-start-upload',
          reason: reason || (result && result.ok ? 'ok' : 'failed'),
        });
        ToolboxShell.appendLog('[AUTOQUEUE][START_UPLOAD][DONE]');
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[AUTOQUEUE][START_UPLOAD][ERROR]', error);
        ToolboxShell.appendLog(`[AUTOQUEUE][START_UPLOAD][ERROR] error=${errText}`);
        state.autoQueueUploadStatus = 'failed';
        state.autoQueueUploadStats = {
          uploaded: 0,
          failed: 0,
          skipped: 0,
          reason: errText,
        };
      } finally {
        autoQueueStartUploadRunning = false;
        state.manualUploadRunning = false;
        state.uploadingFromAutoQueue = false;
        state.autoQueueUploadCancelRequested = false;
        logUploadBatchState('manual-upload-finally');
        updateStatus();
      }
    }

    let lastAutoqProgressStatusLogKey = '';

    // Status-panel throttling (reduce long-run UI/DOM re-render + log overhead)
    let lastStatusRenderKey = '';
    let lastStatusRenderAt = 0;
    let lastButtonHitTestAt = 0;
    let lastButtonDomStateLogAt = 0;
    let lastStatusPanelLogAt = 0;

    // Delegated event binding throttling (avoid repeated remove/add listeners)
    let delegatedBoundRoot = null;

    let autoQueueStartUploadRunning = false;
    let autoQueueStartUploadLastTs = 0;
    const AUTO_QUEUE_START_UPLOAD_DEBOUNCE_MS = 500;

    function normalizeAutoQueueStartUploadAction(action) {
      const key = String(action || '').trim().toLowerCase();
      const aliases = {
        'autoq-start-upload': 'start-upload',
        'autoqueue-start-upload': 'start-upload',
        startupload: 'start-upload',
        'auto-start-upload': 'start-upload',
        'autoqueue-upload': 'start-upload',
        'upload-start': 'start-upload',
      };
      if (aliases[key]) {
        return aliases[key];
      }
      return key === 'start-upload' ? 'start-upload' : key;
    }

    function syncAutoQueueStartUploadButtonMeta(button) {
      if (!button) {
        return null;
      }
      button.dataset.action = 'start-upload';
      button.dataset.buttonRole = 'start-upload';
      return button;
    }

    function isAutoQueueStartUploadButtonDisabled(button) {
      if (!button) {
        return true;
      }
      if (button.disabled) {
        return true;
      }
      if (String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        return true;
      }
      if (String(button.dataset.running || button.dataset.dataRunning || '').trim() === '1') {
        return true;
      }
      return false;
    }

    function readPageTurnCount() {
      const uploadCritical = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );

      if (uploadCritical) {
        const cached = typeof getCachedConversationStatsForHeader === 'function'
          ? getCachedConversationStatsForHeader()
          : null;
        const round = Number(cached && cached.round_count) || 0;
        return round > 0 ? Math.floor(round) : null;
      }

      if (typeof getLightConversationStatsForHeader === 'function') {
        const stats = getLightConversationStatsForHeader({ preferCache: true });
        const round = Math.max(
          Number(stats && stats.round_count) || 0,
          Number(stats && stats.dom_estimated_round_count) || 0,
        );
        if (round > 0) {
          return Math.floor(round);
        }
      }

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

      // 等待额度恢复时：避免“运行中但像卡死”，在当前步骤里给出明确预计恢复时间与策略模式。
      if (taskMode) {
        const waitingSteps = new Set([
          'quota-wait',
          'rate-limit-wait',
          'upload-rate-limit-wait',
          'task-rate-limit-wait',
          'task-upload-rate-limit-wait',
        ]);

        if (waitingSteps.has(taskStepKey)) {
          const quotaModeCfg = getTaskQuotaWaitModeConfig();
          const quotaModeLabel = String(quotaModeCfg && quotaModeCfg.mode ? quotaModeCfg.mode : 'wait_until_available');
          const now = Date.now();

          let waitMs = 0;
          let waitKindText = '';
          let reasonText = '';

          if (taskStepKey === 'quota-wait' && typeof UploadModule !== 'undefined' && typeof UploadModule.canStartNextTaskByQuota === 'function') {
            const currentTask = typeof getCurrentRunningTask === 'function' ? getCurrentRunningTask() : null;
            const quotaCheck = UploadModule.canStartNextTaskByQuota(currentTask);
            reasonText = String(quotaCheck && quotaCheck.reason ? quotaCheck.reason : '-');

            if (quotaCheck && quotaCheck.ok === false && quotaCheck.reason === 'upload-quota-exceeded') {
              waitKindText = '上传额度';
              const uploadQuota = getPanelUploadQuotaState({ logSnapshot: false });
              const needed = Math.max(1, Number(quotaCheck.fileCount) || 1);
              const nextReleaseAt = computeNextReleaseAtForQuotaState(uploadQuota, needed);
              waitMs = Math.max(0, nextReleaseAt - now);
            } else if (quotaCheck && quotaCheck.ok === false && quotaCheck.reason === 'message-quota-exceeded') {
              waitKindText = '消息额度';
              const messageQuota = getPanelMessageQuotaState({ logSnapshot: false });
              const needed = 1;
              const nextReleaseAt = computeNextReleaseAtForQuotaState(messageQuota, needed);
              waitMs = Math.max(0, nextReleaseAt - now);
            }
          } else if (taskStepKey === 'rate-limit-wait') {
            waitKindText = '消息额度';
            waitMs = Math.max(0, Number(messageRateLimitStatus && messageRateLimitStatus.waitMs) || 0);
          } else if (taskStepKey === 'upload-rate-limit-wait') {
            waitKindText = '上传额度';
            waitMs = Math.max(0, Number(uploadRateLimitStatus && uploadRateLimitStatus.waitMs) || 0);
          } else if (taskStepKey === 'task-rate-limit-wait') {
            waitKindText = '消息额度';
            waitMs = Math.max(0, Number(messageRateLimitStatus && messageRateLimitStatus.waitMs) || 0);
          } else if (taskStepKey === 'task-upload-rate-limit-wait') {
            waitKindText = '上传额度';
            waitMs = Math.max(0, Number(uploadRateLimitStatus && uploadRateLimitStatus.waitMs) || 0);
          }

          const waitText = formatDurationForTaskRateLimit(waitMs);
          const modePart = quotaModeLabel ? `（模式：${quotaModeLabel}）` : '';
          if (waitKindText) {
            taskStepText = `批量任务暂停：等待${waitKindText}恢复，预计 ${waitText} 后可继续 ${modePart}`.trim();
          } else {
            taskStepText = `批量任务暂停：等待额度恢复（模式：${quotaModeLabel}）`;
          }
          void reasonText;
        }
      }
      const rateLimitStatus = messageRateLimitStatus;
      const autoUploadSettings = taskMode ? getTaskAutoUploadSettings() : null;
      const autoUploadStrategy = taskMode ? getTaskAutoUploadStrategyDisplay() : null;
      const autoUploadMessageCount = state.taskRun && state.taskRun.sentMessageCount != null
        ? Number(state.taskRun.sentMessageCount) || 0
        : 0;
      const autoUploadTaskItemCount = state.taskRun && state.taskRun.currentIndex != null
        ? Math.max(0, Number(state.taskRun.currentIndex) || 0) + 1
        : 0;
      const autoUploadAssistantAnswerCount = state.taskRun && state.taskRun.assistantReplyCountForUpload != null
        ? Number(state.taskRun.assistantReplyCountForUpload) || 0
        : 0;
      const autoUploadCountMode = autoUploadSettings
        ? normalizeTaskAutoUploadCountMode(autoUploadSettings.countMode)
        : 'message';
      const autoUploadCount = autoUploadCountMode === 'message'
        ? autoUploadMessageCount
        : (autoUploadCountMode === 'assistantAnswer' ? autoUploadAssistantAnswerCount : autoUploadTaskItemCount);
      const taskTotalSentDialogueCount = state.taskRun && state.taskRun.totalSentDialogueCount != null
        ? Number(state.taskRun.totalSentDialogueCount) || 0
        : 0;
      const taskAutoUploadNextAt = autoUploadSettings && autoUploadSettings.enabled
        ? (() => {
          const interval = Math.max(1, Number(autoUploadSettings.interval) || 5);
          if (autoUploadCountMode === 'assistantAnswer') {
            const lastUploadAt = state.taskRun && state.taskRun.lastAutoUploadAtAssistantReplyCount != null
              ? Number(state.taskRun.lastAutoUploadAtAssistantReplyCount) || 0
              : 0;
            return Math.max(lastUploadAt, autoUploadCount) + interval;
          }
          const nextNo = autoUploadCount + 1;
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
        autoUploadCount,
        autoUploadCountMode,
        autoUploadMessageCount,
        autoUploadTaskItemCount,
        autoUploadAssistantAnswerCount,
        taskSentMessageCount: autoUploadMessageCount,
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

    function buildStatusRenderKey(snapshot, refreshReason = '') {
      const taskInfo = snapshot && snapshot.taskInfo ? snapshot.taskInfo : null;
      const continueStatus = snapshot && snapshot.continueStatus ? snapshot.continueStatus : {};
      const messageRateLimit = snapshot && (snapshot.messageRateLimitStatus || snapshot.rateLimitStatus);
      const uploadRateLimit = snapshot && snapshot.uploadRateLimitStatus;
      return [
        config.promptMode || '-',
        state.phase || '-',
        state.phaseReason || '-',
        state.running ? '1' : '0',
        state.waitingReply ? '1' : '0',
        state.batchAutoUploading ? '1' : '0',
        state.uploadingFromAutoQueue ? '1' : '0',
        state.manualUploadRunning ? '1' : '0',
        state.batchTask && state.batchTask.displayState ? state.batchTask.displayState : '-',
        state.batchTask && state.batchTask.stopRequested ? 'stop=1' : 'stop=0',
        taskInfo ? taskInfo.progressIndex : '-',
        taskInfo ? taskInfo.total : '-',
        taskInfo ? taskInfo.doneCount : '-',
        snapshot ? snapshot.pageTurnText : '-',
        continueStatus.continueCount || 0,
        continueStatus.maxText || '-',
        continueStatus.classifyStatus || '-',
        continueStatus.classifyReason || '-',
        messageRateLimit ? messageRateLimit.display : '-',
        uploadRateLimit ? uploadRateLimit.display : '-',
        state.taskRun && state.taskRun.currentStep ? state.taskRun.currentStep : '-',
        refreshReason || '-',
      ].join('|');
    }

    function shouldSkipAutoqUnrelatedButtonRefresh(refreshReason = '') {
      const refreshReasonText = String(refreshReason || '').trim();
      const forceRefreshReasons = new Set([
        'batch-start',
        'batch-stop',
        'stop-final-upload-start',
        'stop-final-upload-done',
        'batch-start-error',
        'start-upload-click-handler-error',
        'manual-upload-click-immediate',
      ]);
      if (forceRefreshReasons.has(refreshReasonText)) {
        return false;
      }

      const uploadCriticalNow = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );
      if (uploadCriticalNow) {
        return true;
      }

      const autoqActive = !!(state.running || state.batchTaskRunning);
      if (autoqActive) {
        return false;
      }

      const uploadTask = typeof resolveAutoQueueUploadTaskState === 'function'
        ? resolveAutoQueueUploadTaskState()
        : null;
      const uploadTaskPhase = uploadTask
        ? String(uploadTask.phase || 'idle').trim().toLowerCase()
        : 'idle';
      const uploadTaskBusy = uploadTaskPhase === 'uploading' || uploadTaskPhase === 'cancelling';

      const fullyIdle = !(
        state.running
        || state.batchTaskRunning
        || state.waitingReply
        || state.uploadingFromAutoQueue
        || state.batchAutoUploading
        || state.manualUploadRunning
        || uploadTaskBusy
      );

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.getSendTaskPhase !== 'function'
      ) {
        return fullyIdle;
      }

      const sendPhase = String(UploadModule.getSendTaskPhase() || 'idle').trim().toLowerCase();
      const uploadSendBusy = sendPhase === 'waiting_reply'
        || sendPhase === 'sending'
        || sendPhase === 'waiting_send'
        || sendPhase === 'cancelling';

      if (fullyIdle && !uploadSendBusy) {
        return true;
      }

      if (!uploadSendBusy) {
        return false;
      }

      ToolboxShell.appendLog(
        `[AUTOQ_BUTTON][SKIP_REFRESH_PAGE_BUSY_ONLY] reason=${refreshReasonText || '-'} sendPhase=${sendPhase}`,
      );
      return true;
    }

    function updateStatus(refreshReason = '') {
      ensureTicker();
      syncLegacyRunFlagsFromPhase();
      const running = !!state.running;
      const phase = String(state.phase || 'idle');
      const modeText = getModeDisplayText(config.promptMode);
      const listName = config.promptMode === 'list' ? getActiveListProfileName() : '';
      const progressSnapshot = buildProgressStatusSnapshot();
      logAutoqProgressStatusIfChanged(progressSnapshot, refreshReason);

      const now = Date.now();
      const renderKey = buildStatusRenderKey(progressSnapshot, refreshReason);
      const activeNow = !!(
        running
        || state.waitingReply
        || state.uploadingFromAutoQueue
        || state.batchAutoUploading
      );
      const forceRenderReasons = new Set([
        'batch-start',
        'batch-stop',
        'stop-final-upload-start',
        'stop-final-upload-done',
        'batch-start-error',
        'start-upload-click-handler-error',
      ]);
      const shouldForceRender = forceRenderReasons.has(String(refreshReason || ''));
      const shouldRenderStatus =
        shouldForceRender
        || renderKey !== lastStatusRenderKey
        || now - lastStatusRenderAt >= 1500;

      if (!shouldRenderStatus) {
        if (activeNow && !shouldSkipAutoqUnrelatedButtonRefresh(refreshReason)) {
          if (
            typeof UploadModule !== 'undefined'
            && typeof UploadModule.refreshUploadAutoContinueButton === 'function'
          ) {
            UploadModule.refreshUploadAutoContinueButton(refreshReason || 'autoq-status-skip');
          }
          if (
            typeof UploadModule !== 'undefined'
            && typeof UploadModule.refreshUploadAutoContinueUntilDoneButton === 'function'
          ) {
            UploadModule.refreshUploadAutoContinueUntilDoneButton(refreshReason || 'autoq-status-skip');
          }
        }
        return;
      }

      lastStatusRenderKey = renderKey;
      lastStatusRenderAt = now;

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
      const batchDisplayState = config.promptMode === 'task' && state.batchTask
        ? String(state.batchTask.displayState || '')
        : '';
      let runStateText;

      if (config.promptMode === 'task' && batchDisplayState) {
        runStateText = BATCH_TASK_GROUP_DISPLAY_STATE_LABELS[batchDisplayState]
          || batchDisplayState;
      } else if (phase === AUTO_QUEUE_PHASES.DONE) {
        runStateText = '已完成';
      } else if (phase === AUTO_QUEUE_PHASES.FAILED) {
        runStateText = '调度异常';
      } else if (phase === 'uploading' || state.uploadingFromAutoQueue || state.batchAutoUploading) {
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

      if (config.promptMode === 'task' && running) {
        const waitingSteps = new Set([
          'quota-wait',
          'rate-limit-wait',
          'upload-rate-limit-wait',
          'task-rate-limit-wait',
          'task-upload-rate-limit-wait',
        ]);
        if (waitingSteps.has(taskStepKeyForStatus)) {
          runStateText = '等待额度恢复';
        } else if (phase === 'uploading' || state.uploadingFromAutoQueue || state.batchAutoUploading) {
          if (taskStepKeyForStatus === 'auto-upload-before-send' && state.batchAutoUploading) {
            setBatchTaskGroupDisplayState('starting_upload', 'phase-initial-auto-uploading');
            runStateText = BATCH_TASK_GROUP_DISPLAY_STATE_LABELS.starting_upload;
            ToolboxShell.setStatus('批量任务：正在上传初始附件，上传完成后发送初始指令');
          } else {
            setBatchTaskGroupDisplayState('uploading', 'phase-uploading');
            runStateText = BATCH_TASK_GROUP_DISPLAY_STATE_LABELS.uploading;
          }
        } else if (state.waitingReply || phase === 'waiting_reply' || phase === 'reply_ready') {
          if (
            batchDisplayState !== 'recovering'
            && batchDisplayState !== 'stopping'
            && batchDisplayState !== 'waiting_composer_idle'
          ) {
            setBatchTaskGroupDisplayState('waiting_reply', 'phase-waiting-reply');
            runStateText = BATCH_TASK_GROUP_DISPLAY_STATE_LABELS.waiting_reply;
          }
        } else if (batchDisplayState !== 'recovering') {
          setBatchTaskGroupDisplayState('running', 'phase-running');
          runStateText = BATCH_TASK_GROUP_DISPLAY_STATE_LABELS.running;
        }
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

      const shouldLogStatusPanel = now - lastStatusPanelLogAt >= 3000 || shouldForceRender;
      if (shouldLogStatusPanel) {
        lastStatusPanelLogAt = now;
        ToolboxShell.appendLog(
          `[STATUS][PANEL_RENDER] messageUsed=${messageUsed} uploadUsed=${uploadUsed} `
          + `pageTurn=${pageTurnText} totalSentDialogueCount=${taskTotalSentDialogueCount} `
          + `autoUploadCountMode=${progressSnapshot.autoUploadCountMode || 'taskItem'} `
          + `autoUploadCount=${Number(progressSnapshot.autoUploadCount) || 0} `
          + `autoUploadMessageCount=${Number(progressSnapshot.autoUploadMessageCount) || 0} `
          + `reason=${refreshReason || '-'}`,
        );
        ToolboxShell.appendLog(
          `[STATUS][TOP_RENDER] messageUsed=${messageUsed} uploadUsed=${uploadUsed} reason=${refreshReason || '-'}`,
        );
      }

      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.renderRuntimeStats === 'function') {
        RuntimeStatsModule.renderRuntimeStats(false);
      }

      saveAndRestoreScrollAroundRender(
        `update-status:${refreshReason || 'poll'}`,
        () => {
          if (!shouldSkipAutoqUnrelatedButtonRefresh(refreshReason)) {
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
          }
        },
        { isAutoRefresh: true },
      );

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
          task.displayState = 'completed';
        } else if (phaseName === AUTO_QUEUE_PHASES.FAILED) {
          task.phase = 'failed';
          task.displayState = 'failed';
        } else if (phaseName === AUTO_QUEUE_PHASES.CANCELLED) {
          task.phase = 'cancelled';
          task.displayState = 'stopped';
        } else {
          task.phase = 'idle';
        }
        return task.phase;
      }

      if (task.displayState === 'recovering') {
        task.phase = 'recovering';
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

    function getAutoQueueSendOnceIdleText() {
      if (config.promptMode !== 'task') {
        return '发送一次';
      }

      const profile = getActiveTaskProfile();
      const task = getSelectedTask(profile);

      return shouldSendTaskContinueFromSendOnce(task, { allowDomProbe: false })
        ? '继续当前任务一次'
        : '只发送初始指令一次';
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
      const idleText = getAutoQueueSendOnceIdleText();

      sendOnceBtn.dataset.cgptIdleText = idleText;

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
        setButtonIdle(sendOnceBtn, idleText, {
          title: '发送一次已完成',
          disabled: false,
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
          || getAutoQueueSendOnceIdleText();
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

    function getAutoQueueMainButtonVisualState({
      text = '',
      running = false,
      waitingReply = false,
      pendingSendKind = '',
      stopping = false,
    } = {}) {
      const label = String(text || '');
      const stopLike = (
        !!running
        || !!waitingReply
        || !!pendingSendKind
        || !!stopping
      );
      return stopLike ? 'danger' : 'idle';
    }

    function renderQueueActionButtons(context = {}) {
      refreshAutoQueueActionButtonRefs();

      const debugEnabled = !!(
        config
        && config.taskQueueSettings
        && config.taskQueueSettings.debugMode
      );

      if (typeof setToolboxButtonState !== 'function') {
        if (debugEnabled) {
          const now = Date.now();
          if (now - lastButtonDomStateLogAt >= 5000) {
            lastButtonDomStateLogAt = now;
            logAutoQueueActionButtonDomState('renderQueueActionButtons-skip');
          }
        }
        return;
      }

      syncBatchButtonTask(context.refreshReason || 'renderQueueActionButtons');

      const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
      const phaseStatusText = String(state.phaseReason || context.phase || phase || '').trim()
        || phase;
      const uploadTask = resolveAutoQueueUploadTaskState() || {};
      const uploadTaskPhase = String(uploadTask.phase || 'idle').trim().toLowerCase();
      const uploading = !!context.uploading
        || uploadTaskPhase === 'uploading'
        || uploadTaskPhase === 'cancelling'
        || !!state.batchAutoUploading;
      const reason = String(context.refreshReason || 'update-status');
      const batchRunning = state.batchTaskRunning || state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase);
      const stopRequested = !!(state.batchTask && state.batchTask.stopRequested);
      const idleStartText = getAutoQueueStartIdleText();
      const taskStep = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';
      const inStartupUpload = !!state.batchAutoUploading && taskStep === 'auto-upload-before-send';
      const inStartupGuard = inStartupUpload && Date.now() < Number(state.batchStartupGuardUntilMs || 0);
      if (state.batchAutoUploading) {
        const batchBtnRole = inStartupUpload ? 'cancel-startup-upload' : 'stop-batch-auto-upload';
        ToolboxShell.appendLog(
          `[AUTOQ][BUTTON_DECOUPLE] batchAutoUploading=1 uploadButton=disabled batchButton=${batchBtnRole}`,
        );
      }

      if (startBtn) {
        startBtn.classList.remove('cgpt-task-running-indicator');

        // 仅手动上传（uploadingFromAutoQueue）时，批量按钮保持空闲态，不与上传按钮重复「上传中」
        if (!batchRunning) {
          const assistantBusyForStart = config.promptMode === 'task'
            && isChatGPTActuallyBusyForTaskQueue();

          if (phase === AUTO_QUEUE_PHASES.FAILED) {
            setButtonFailed(startBtn, idleStartText, {
              title: `失败：${phaseStatusText}`,
              disabled: false,
              reason,
            });
          } else if (phase === AUTO_QUEUE_PHASES.DONE) {
            setButtonIdle(startBtn, idleStartText, { title: '已完成', reason });
          } else {
            setButtonIdle(startBtn, idleStartText, {
              title: assistantBusyForStart
                ? '当前可能仍在回答；按钮保持可点击，点击后由启动逻辑判断是否等待或拦截'
                : '点击开始自动指令队列',
              disabled: false,
              reason,
            });

            if (assistantBusyForStart) {
              ToolboxShell.appendLog('[BUTTON_ENABLED][AUTOQ_START] disabled=0 reason=assistant-busy-but-clickable');
            }
          }
        } else {
          if (stopRequested || phase === AUTO_QUEUE_PHASES.CANCELLED) {
            setButtonDanger(startBtn, '正在停止', {
              title: '停止请求已提交，可再次点击强制停止',
              allowCancel: true,
              disabled: false,
              reason,
            });
          } else if (inStartupUpload) {
            if (inStartupGuard) {
              setButtonWaiting(startBtn, '正在启动/自动上传…', {
                title: '正在上传初始附件，短暂防抖以避免误触停止',
                allowCancel: false,
                disabled: true,
                reason,
              });
            } else {
              setButtonWaiting(startBtn, '上传初始附件', {
                title: '当前处于启动阶段，可取消启动与自动上传',
                allowCancel: true,
                disabled: false,
                reason,
              });
            }
          } else if ([
            'quota-wait',
            'rate-limit-wait',
            'upload-rate-limit-wait',
            'task-rate-limit-wait',
            'task-upload-rate-limit-wait',
          ].includes(String(taskStep || '').trim().toLowerCase())) {
            const modeLabel = getTaskQuotaWaitModeLabel();
            setButtonWaiting(startBtn, '额度等待中', {
              title: `${phaseStatusText}（模式：${modeLabel}）`,
              allowCancel: true,
              disabled: false,
              reason,
            });
          } else if (phase === AUTO_QUEUE_PHASES.WAITING_REPLY || state.waitingReply) {
            const waitingReplyText = '等待回复';
            const waitingReplyPhase = getAutoQueueMainButtonVisualState({
              text: waitingReplyText,
              running: !!state.running,
              waitingReply: true,
              pendingSendKind: state.taskRun && state.taskRun.pendingSendKind,
              stopping: false,
            });
            if (waitingReplyPhase === 'danger') {
              setButtonDanger(startBtn, waitingReplyText, {
                title: `阶段：${phaseStatusText}`,
                allowCancel: true,
                disabled: false,
                reason,
              });
            } else {
              setButtonWaiting(startBtn, waitingReplyText, {
                title: `阶段：${phaseStatusText}`,
                allowCancel: true,
                disabled: false,
                reason,
              });
            }
          } else if (isAutoQueueWaitingDelay()) {
            const waitDelayText = '等待下次发送';
            const waitDelayPhase = getAutoQueueMainButtonVisualState({
              text: waitDelayText,
              running: !!state.running,
              waitingReply: !!state.waitingReply,
              pendingSendKind: state.taskRun && state.taskRun.pendingSendKind,
              stopping: false,
            });
            if (waitDelayPhase === 'danger') {
              setButtonDanger(startBtn, waitDelayText, {
                title: `下次发送：${new Date(state.nextSendAt).toLocaleTimeString()}`,
                allowCancel: true,
                disabled: false,
                reason,
              });
            } else {
              setButtonWaiting(startBtn, waitDelayText, {
                title: `下次发送：${new Date(state.nextSendAt).toLocaleTimeString()}`,
                allowCancel: true,
                disabled: false,
                reason,
              });
            }
          } else if (
            phase === AUTO_QUEUE_PHASES.SENDING
            || phase === AUTO_QUEUE_PHASES.SENT
          ) {
            setButtonSending(startBtn, '发送中', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              disabled: false,
              reason,
            });
          } else {
            setButtonDanger(startBtn, '停止批量任务组', {
              title: `阶段：${phaseStatusText}`,
              allowCancel: true,
              disabled: false,
              reason,
            });
          }

          startBtn.dataset.cgptTaskPhase = String(state.batchTask.phase || phase);
        }
      }

      if (startUploadBtn) {
        startUploadBtn.classList.toggle('cgpt-toolbox-hidden', config.promptMode !== 'task');
        startUploadBtn.classList.remove('cgpt-task-running-indicator');

        if (state.batchAutoUploading) {
          setToolboxButtonState(startUploadBtn, {
            phase: ButtonState.Phase.DISABLED,
            text: '批量上传中',
            title: '批量任务正在自动上传初始附件，普通上传按钮暂不可用',
            disabled: true,
            allowCancel: false,
            ariaBusy: false,
            reason: `batch-auto-upload:${reason}`,
          });
        } else if (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyStartUploadButtonState === 'function'
        ) {
          UploadModule.applyStartUploadButtonState(startUploadBtn, {
            reason: `autoq-upload-button:${reason}`,
            ignoreAutoQueueRunning: true,
          });
        } else {
          setButtonIdle(startUploadBtn, '开始上传', {
            title: '只上传/绑定文件，不自动发送',
            reason,
          });
        }
      }

      const uploadBtnText = startUploadBtn ? String(startUploadBtn.textContent || '').trim() : '';
      const batchBtnText = startBtn ? String(startBtn.textContent || '').trim() : '';
      const uploadBtnPhase = startUploadBtn ? String(startUploadBtn.dataset.cgptButtonPhase || '').trim() : '';
      const batchBtnPhase = startBtn ? String(startBtn.dataset.cgptButtonPhase || '').trim() : '';
      const uploadBtnAriaBusy = startUploadBtn ? String(startUploadBtn.getAttribute('aria-busy') || '').trim() : '';
      const uploadBtnDisabled = startUploadBtn ? (startUploadBtn.disabled ? '1' : '0') : '-';
      const batchBtnAriaBusy = startBtn ? String(startBtn.getAttribute('aria-busy') || '').trim() : '';

      if (debugEnabled) {
        ToolboxShell.appendLog(
          `[AUTOQ][BUTTON_STATE_FINAL] uploadBtnText=${uploadBtnText || '-'} uploadBtnPhase=${uploadBtnPhase || '-'} uploadBtnDisabled=${uploadBtnDisabled} uploadBtnAriaBusy=${uploadBtnAriaBusy || '-'} uploadTaskPhase=${uploadTaskPhase || '-'} uploadTaskOwner=${String(uploadTask.owner || '-')} batchBtnText=${batchBtnText || '-'} batchBtnPhase=${batchBtnPhase || '-'} batchBtnAriaBusy=${batchBtnAriaBusy || '-'}`,
        );
        ToolboxShell.appendLog(
          `[BUTTON_RENDER][UPLOAD] text=${uploadBtnText || '-'} manualUploadRunning=${state.manualUploadRunning ? 1 : 0}`,
        );
        ToolboxShell.appendLog(
          `[BUTTON_RENDER][BATCH_TASK] text=${batchBtnText || '-'} batchTaskRunning=${batchRunning ? 1 : 0} batchAutoUploading=${state.batchAutoUploading ? 1 : 0}`,
        );
      }
      if (startUploadBtn && uploadBtnText.includes('批量任务运行中')) {
        console.error('[BUTTON_COUPLING][UPLOAD_TEXT_POLLUTED]', {
          uploadBtnText,
          batchBtnText,
          phase,
          running: !!state.running,
          reason,
        });
        ToolboxShell.appendLog(
          `[BUTTON_COUPLING][UPLOAD_TEXT_POLLUTED] uploadText=${uploadBtnText} batchText=${batchBtnText} phase=${phase} running=${state.running ? 1 : 0}`,
        );
      }

      renderSendOnceButton(context);

      if (root && debugEnabled) {
        const uploadButtons = root.querySelectorAll('#cgpt-autoq-start-upload');
        if (uploadButtons.length !== 1) {
          console.error('[UPLOAD_BUTTON][DUPLICATED_DOM]', {
            count: uploadButtons.length,
          });
          ToolboxShell.appendLog(`[UPLOAD_BUTTON][DUPLICATED_DOM] count=${uploadButtons.length}`);
        }

        const uploadStopLikeButtons = Array.from(root.querySelectorAll('button'))
          .filter((btn) => {
            const text = String(btn.textContent || '');
            return text.includes('上传中') && !text.includes('自动上传中');
          });

        if (uploadStopLikeButtons.length > 1) {
          console.error('[UPLOAD_BUTTON][DUPLICATED_RUNNING_BUTTON]', {
            count: uploadStopLikeButtons.length,
          });
          ToolboxShell.appendLog(
            `[UPLOAD_BUTTON][DUPLICATED_RUNNING_BUTTON] count=${uploadStopLikeButtons.length}`,
          );
        }
      }

      bindAutoQueueDelegatedActions('renderQueueActionButtons');
      bindDirectAutoQueueActionButtons('renderQueueActionButtons');

      logAutoQueueUploadButtonReady('after-renderQueueActionButtons');

      const now = Date.now();
      if (debugEnabled && now - lastButtonHitTestAt >= 5000) {
        lastButtonHitTestAt = now;
        logButtonHitTestState('after-renderQueueActionButtons');
      }
      if (debugEnabled && now - lastButtonDomStateLogAt >= 5000) {
        lastButtonDomStateLogAt = now;
        logAutoQueueActionButtonDomState('renderQueueActionButtons');
      }
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

    function resolveStartBlockedReasonAfterPrepareFailure() {
      if (config.promptMode === 'task') {
        const profile = getActiveTaskProfile();
        const enabled = getEnabledTasksFromProfile(profile);
        if (!enabled.length) {
          return 'no-enabled-tasks';
        }
        const runnable = enabled.filter((task) => task && task.status !== 'failed');
        if (!runnable.length) {
          return 'no-runnable-tasks';
        }
        const currentTask = typeof getCurrentRunningTask === 'function'
          ? getCurrentRunningTask()
          : null;
        if (!currentTask) {
          return 'current-task-missing';
        }
        if (currentTask.enabled === false) {
          return 'current-task-disabled';
        }
        return 'prepare-queue-failed';
      }

      const prompts = buildQueuePromptsByMode(config.promptMode);
      if (!prompts.length) {
        return 'empty-prompts';
      }
      return 'prepare-queue-failed';
    }

    function start() {
      ToolboxShell.appendLog(
        `[AUTOQ][START_ENTER] running=${state.running ? 1 : 0} `
        + `phase=${state.phase || '-'} `
        + `uploadingFromAutoQueue=${state.uploadingFromAutoQueue ? 1 : 0} `
        + `batchTaskRunning=${state.batchTaskRunning ? 1 : 0} `
        + `batchAutoUploading=${state.batchAutoUploading ? 1 : 0} `
        + `manualUploadRunning=${state.manualUploadRunning ? 1 : 0} `
        + `promptMode=${config.promptMode || '-'}`,
      );

      if (state.running) {
        ToolboxShell.appendLog('[AUTOQ][START_BLOCKED] reason=state-running');
        updateStatus('start-blocked-state-running');
        return;
      }

      if (state.uploadingFromAutoQueue) {
        ToolboxShell.appendLog('[AUTOQ][START_BLOCKED] reason=uploading-from-autoqueue');
        updateStatus('start-blocked-uploading-from-autoqueue');
        return;
      }

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        ToolboxShell.appendLog('[AUTOQ][START_BLOCKED] reason=assistant-busy');
        ToolboxShell.setStatus('当前 ChatGPT 仍在回答，请等待上一条回答结束后再开始批量任务', 'warning');
        updateStatus('start-blocked-assistant-busy');
        return;
      }

      if (AUTO_QUEUE_TERMINAL_PHASES.has(state.phase)) {
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][RESET_TERMINAL_BEFORE_START] from=${state.phase || '-'}`,
        );
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.IDLE, 'reset-before-start', { force: true });
      }

      const frozenGroupId = config.promptMode === 'task' ? resolveRunGroupIdBeforeStart() : '';
      if (config.promptMode === 'task' && !frozenGroupId) {
        ToolboxShell.appendLog('[AUTOQ][START_BLOCKED] reason=active-upload-group-missing');
        transitionAutoQueuePhase(AUTO_QUEUE_PHASES.FAILED, 'active upload group missing', { force: true });
        updateStatus('start-reject-group');
        return;
      }

      const task = config.promptMode === 'task' && typeof getCurrentRunningTask === 'function'
        ? getCurrentRunningTask()
        : null;
      createAutoQueueRunContext(task, frozenGroupId);
      state.batchTask.stopRequested = false;
      state.batchTask.forceStopRequested = false;
      state.batchTask.stopFinalUploadRunning = false;

      if (!transitionAutoQueuePhase(AUTO_QUEUE_PHASES.PREPARING, 'batch-start')) {
        ToolboxShell.appendLog('[AUTOQ][START_BLOCKED] reason=phase-transition-failed');
        invalidateAutoQueueRun('phase-transition-failed');
        updateStatus('start-blocked-phase-transition-failed');
        return;
      }

      if (!prepareQueue()) {
        const blockReason = resolveStartBlockedReasonAfterPrepareFailure();
        ToolboxShell.appendLog(`[AUTOQ][START_BLOCKED] reason=${blockReason}`);
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
        state.batchTaskRunning = true;
        state.batchTask.lastActiveAt = Date.now();
        state.batchTask.watchdogRecoverStreak = 0;
        abortBatchTaskGroupScheduledTimer('batch-start-reset');
        setBatchTaskGroupDisplayState('running', 'batch-start');
        logBatchTaskGroupStepBegin({ subtask: 'batch-start' });
        logUploadBatchState('batch-task-start');
        ToolboxShell.appendLog(
          `[BATCH_TASK_STATE][SET] batchTaskRunning=1 manualUploadRunning=${state.manualUploadRunning ? 1 : 0} batchAutoUploading=${state.batchAutoUploading ? 1 : 0}`,
        );
      } else {
        log(`开始运行，队列 ${state.queue.length} 条`);
        ToolboxShell.setStatus('自动指令队列已开启');
      }

      ensureTicker();
      updateStatus('batch-start');
      tick();
    }

    function forceStopTaskBatch(reason = 'force-stop') {
      const stopReason = String(reason || 'force-stop');
      if (!state.batchTask || typeof state.batchTask !== 'object') {
        state.batchTask = {};
      }

      state.batchTask.stopRequested = true;
      state.batchTask.forceStopRequested = true;
      state.batchTask.stopFinalUploadRunning = false;

      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][FORCE_STOP] reason=${stopReason}`);
      abortBatchTaskGroupScheduledTimer(`force-stop:${stopReason}`);

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.cancelUploadFlow === 'function'
      ) {
        try {
          UploadModule.cancelUploadFlow(`batch-force-stop:${stopReason}`);
        } catch (error) {
          const errText = error && error.stack ? error.stack : String(error);
          console.error('[AUTOQ][TASK_BATCH][FORCE_STOP_UPLOAD_CANCEL_ERROR]', error);
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][FORCE_STOP_UPLOAD_CANCEL_ERROR] ${errText}`,
          );
        }
      }

      stop({
        reason: stopReason,
        finalStep: 'stopped',
        markCurrent: true,
        logStop: true,
      });
    }

    async function stopTaskBatchWithFinalUpload(reason = 'user-stop') {
      const stopReason = String(reason || 'user-stop');

      if (state.batchTask && state.batchTask.stopFinalUploadRunning) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_FORCE] reason=already-stopping stopReason=${stopReason}`,
        );
        forceStopTaskBatch('second-click-while-final-upload');
        return;
      }

      if (!state.running || config.promptMode !== 'task') {
        stop({ reason: stopReason, finalStep: 'stopped', logStop: true });
        return;
      }

      if (state.batchAutoUploading || state.manualUploadRunning) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_SKIP] reason=upload-already-running stopReason=${stopReason}`,
        );
        stop({ reason: stopReason, finalStep: 'stopped', logStop: true });
        return;
      }

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_START] reason=${stopReason}`,
      );

      state.batchTask.stopRequested = true;
      state.batchTask.forceStopRequested = false;
      state.batchTask.stopFinalUploadRunning = true;
      // 不允许在 composer 仍忙（assistant 正在回答）时立刻触发 uploading。
      // 先进入 stopping -> waiting_composer_idle，等 composer ready 后才进入 uploading。
      state.batchAutoUploading = false;
      setBatchTaskGroupDisplayState('stopping', 'stop-final-upload-start');
      updateStatus('stop-final-upload-start');

      try {
        if (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.startUploadForAutoQueue === 'function'
        ) {
          // 等待 composer 空闲：避免旧版 input change 路径抢时机 + 误判 native-upload-failed
          if (typeof UploadModule.waitChatGPTComposerReadyForUpload === 'function') {
            setBatchTaskGroupDisplayState(
              'waiting_composer_idle',
              `stop-final-upload-wait-composer-idle:${stopReason}`,
            );
            updateStatus('stop-final-upload-wait-composer-idle');

            const ready = await UploadModule.waitChatGPTComposerReadyForUpload({
              timeoutMs: 120000,
              stableMs: 1500,
            });

            if (!ready.ok) {
              ToolboxShell.appendLog(
                `[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_BLOCKED] reason=${ready.reason || 'final-upload-blocked-composer-not-ready'}`,
              );
              setBatchTaskGroupDisplayState(
                'stopped',
                `final-upload-blocked-composer-not-ready:${ready.reason || '-'}`,
              );
              updateStatus('stop-final-upload-blocked-composer-not-ready');
              return;
            }
          }

          state.batchAutoUploading = true;
          setBatchTaskGroupDisplayState('uploading', 'stop-final-upload-composer-ready');
          updateStatus('stop-final-upload-composer-ready');

          const uploadResult = await UploadModule.startUploadForAutoQueue({
            source: `autoq-stop-final-upload-${stopReason}`,
            forceReupload: true,
            shouldStop: () => !state.running || !!(state.batchTask && state.batchTask.forceStopRequested),
          });

          const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
          const skippedCount = Number(uploadResult && uploadResult.skippedCount) || 0;
          const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
          const uploadReason = String(uploadResult && uploadResult.reason || '').trim();

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_DONE] ok=${uploadResult && uploadResult.ok ? 1 : 0} uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount} reason=${uploadReason || '-'}`,
          );
        } else {
          ToolboxShell.appendLog(
            '[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_SKIP] reason=upload-module-missing',
          );
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_ERROR]', error);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][STOP_FINAL_UPLOAD_ERROR] reason=${errText}`);
      } finally {
        if (state.batchTask) {
          state.batchTask.stopFinalUploadRunning = false;
        }
        state.batchAutoUploading = false;
        updateStatus('stop-final-upload-done');
        if (!(state.batchTask && state.batchTask.forceStopRequested)) {
          stop({ reason: stopReason, finalStep: 'stopped', logStop: true });
        }
      }
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
      if (config.promptMode === 'task') {
        abortBatchTaskGroupScheduledTimer('stop');
        if (finalStep === 'all-done' || stopReason === 'all-done') {
          setBatchTaskGroupDisplayState('completed', 'all-done');
        } else if (wasRunning || state.batchTaskRunning) {
          setBatchTaskGroupDisplayState('stopped', stopReason);
        }
      }
      if (state.batchAutoUploading && typeof UploadModule !== 'undefined' && typeof UploadModule.cancelUploadFlow === 'function') {
        UploadModule.cancelUploadFlow(`batch-stop:${stopReason || 'user-stop'}`);
      }
      invalidateAutoQueueRun(stopReason);
      state.continueUntilDoneStrict = false;
      state.batchTask.stopRequested = true;
      state.batchTask.forceStopRequested = true;
      state.batchTask.stopFinalUploadRunning = false;
      state.batchTaskRunning = false;
      state.batchAutoUploading = false;
      state.batchStartupGuardUntilMs = 0;
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
        state.tickIntervalMs = 0;
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

      // Stop clears throttling state so the final UI transition always renders promptly.
      lastStatusRenderKey = '';
      lastStatusRenderAt = 0;
      lastButtonHitTestAt = 0;
      lastButtonDomStateLogAt = 0;
      lastStatusPanelLogAt = 0;

      updateStatus('batch-stop');
      logUploadBatchState('batch-task-stop');
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
      if (
        typeof document !== 'undefined'
        && document.hidden === false
        && document.visibilityState === 'visible'
        && typeof document.hasFocus === 'function'
        && document.hasFocus() === true
      ) {
        return false;
      }
      if (typeof BrowserRuntimeHealth === 'undefined' || !BrowserRuntimeHealth.isProbablyThrottled()) {
        return false;
      }

      const now = Date.now();
      const actionName = String(action || 'wait-visible').trim() || 'wait-visible';
      if (
        typeof document !== 'undefined'
        && document.hidden === false
        && document.visibilityState === 'visible'
        && typeof document.hasFocus === 'function'
        && document.hasFocus() === true
      ) {
        if (!state.lastBackgroundThrottleLogAt || now - state.lastBackgroundThrottleLogAt > 5000) {
          state.lastBackgroundThrottleLogAt = now;
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[AUTO_QUEUE][BACKGROUND_THROTTLED_CLEAR] reason=visible-focused hidden=0 visibility=visible focus=1`,
            );
          }
        }
        return false;
      }
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

    let processingStaleRecoveryInFlight = false;

    function normalizeComposerTextForCompare(text) {
      return String(text || '')
        .trim()
        .replace(/\s+/g, ' ');
    }

    function isComposerTextMatchingExpectedPrompt(actualText, expectedText) {
      const a = normalizeComposerTextForCompare(actualText);
      const e = normalizeComposerTextForCompare(expectedText);
      if (!a || !e) return false;
      if (a === e) return true;
      const eProbe = e.slice(0, Math.min(80, e.length));
      return a.includes(eProbe);
    }

    function getComposerEvidenceForProcessingStaleRecovery() {
      const snapshot = typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
        ? ComposerApi.getComposerRuntimeSnapshotLight(500)
        : null;
      const composerText = snapshot
        ? String(snapshot.composerTextTrimmed || '')
        : (
          typeof ComposerApi.getComposerText === 'function'
            ? String(ComposerApi.getComposerText() || '').trim()
            : ''
        );
      const textLen = composerText.length;

      const attachmentCount = snapshot
        ? Number(snapshot.attachmentCount || 0)
        : (
          typeof ComposerApi.countAttachmentChipsFast === 'function'
            ? Number(ComposerApi.countAttachmentChipsFast() || 0)
            : 0
        );
      const hasAttachment = attachmentCount > 0;

      const sendButton = snapshot && snapshot.sendButton
        ? snapshot.sendButton
        : (
          typeof ComposerApi.findSendButton === 'function'
            ? ComposerApi.findSendButton({ silent: true })
            : null
        );
      const sendButtonDisabled = !(sendButton instanceof HTMLButtonElement)
        ? true
        : !!sendButton.disabled;
      const sendButtonEnabled = !!(
        sendButton instanceof HTMLButtonElement
        && !sendButton.disabled
        && (typeof ComposerApi.isSendButtonReady === 'function'
          ? ComposerApi.isSendButtonReady(sendButton)
          : true)
      );

      return {
        composerText,
        textLen,
        hasAttachment,
        attachmentCount,
        sendButtonDisabled,
        sendButtonEnabled,
      };
    }

    function maybeRecoverPendingSendProcessingStale(options = {}) {
      const run = state.taskRun || {};
      if (run.pendingSendKind !== 'processing') {
        return false;
      }
      if (state.waitingReply) {
        return false;
      }
      if (processingStaleRecoveryInFlight) {
        return false;
      }

      const pendingStartedAt = Number(run.pendingSendStartedAt || 0);
      if (!pendingStartedAt && !options.force) {
        return false;
      }

      const task = getCurrentRunningTask();
      if (!task) {
        return false;
      }

      const hardTimeoutMs = getAutoQueueSendHardTimeoutMs();
      const pendingMs = options.force
        ? hardTimeoutMs + 1
        : (Date.now() - pendingStartedAt);

      const currentStep = run.currentStep ? String(run.currentStep) : '-';

      const assistantBusy = typeof ComposerApi.isAssistantLikelyBusy === 'function'
        ? !!ComposerApi.isAssistantLikelyBusy()
        : false;

      const evidence = getComposerEvidenceForProcessingStaleRecovery();
      const hasPayload = evidence.hasAttachment || evidence.textLen > 0;
      if (!hasPayload) {
        return false;
      }

      // 10 秒内未开始 stable send：强制触发恢复。
      if (!options.force && pendingMs >= 10000 && pendingMs < hardTimeoutMs) {
        const sendInProgress = typeof ChatInputStateRuntime !== 'undefined'
          && !!ChatInputStateRuntime
          && !!ChatInputStateRuntime.sendInProgress;
        if (!sendInProgress) {
          const kind = String(run.lastPendingSendKindBeforeProcessing || 'initial');
          ToolboxShell.appendLog(
            `[AUTOQ][POST_UPLOAD_SEND_NOT_STARTED] task=${task.title || '-'} kind=${kind} pendingSendKind=${run.pendingSendKind} `
            + `currentStep=${currentStep} hasAttachment=${evidence.hasAttachment ? 1 : 0} textLen=${evidence.textLen} `
            + `sendButtonDisabled=${evidence.sendButtonDisabled ? 1 : 0} action=force-retry-send`,
          );

          run.pendingSendKind = 'initial';
          run.pendingSendStartedAt = 0;
          run.lastPendingSendKindBeforeProcessing = 'initial';
          state.taskRun = run;

          state.sendingNow = false;
          state.waitingReply = false;
          state.replyBecameBusy = false;
          state.idleSince = 0;
          state.waitingStartedAt = 0;
          state.taskBatchStepRunning = false;
          state.nextSendAt = 0;

          updateStatus('processing-post-upload-force-retry');
          if (typeof updateChatInputStateBadge === 'function') {
            updateChatInputStateBadge();
          }
          return false;
        }
      }

      // 到达硬超时：执行 processing 卡死恢复。
      if (pendingMs < hardTimeoutMs) {
        return false;
      }
      if (assistantBusy) {
        return false;
      }

      ToolboxShell.appendLog(
        `[AUTOQ][PROCESSING_STALE_DETECTED] pendingMs=${pendingMs} hasAttachment=${evidence.hasAttachment ? 1 : 0} `
        + `textLen=${evidence.textLen} currentStep=${currentStep} action=processing-timeout-recover`,
      );

      const expectedInitial = (() => {
        if (typeof resolveTaskInitialPrompt !== 'function') return '';
        const resolved = resolveTaskInitialPrompt(task, { log: false });
        return String(resolved && resolved.initialPrompt ? resolved.initialPrompt : '').trim();
      })();

      const hasExpectedPrompt = evidence.textLen > 0
        && expectedInitial
        && isComposerTextMatchingExpectedPrompt(evidence.composerText, expectedInitial);

      // 只有附件、没有本轮 prompt：回到 initial 并重写 prompt。
      if (evidence.hasAttachment && evidence.textLen <= 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][PROCESSING_STALE_RECOVER_RETRY] kind=initial task=${task.title || '-'} pendingMs=${pendingMs} `
          + `currentStep=${currentStep} action=rewrite-prompt`,
        );

        ToolboxShell.appendLog(
          `[AUTOQ][POST_UPLOAD_PROMPT_MISSING] task=${task.title || '-'} kind=initial attachment=1 textLen=0 action=rewrite-prompt`,
        );

        run.pendingSendKind = 'initial';
        run.pendingSendStartedAt = 0;
        run.lastPendingSendKindBeforeProcessing = 'initial';
        state.taskRun = run;

        state.sendingNow = false;
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = 0;
        state.taskBatchStepRunning = false;
        state.nextSendAt = 0;

        updateStatus('processing-stale-rewrite-prompt');
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
        return false;
      }

      // 附件 + 本轮 prompt，且发送按钮可用：直接用 sendExistingComposer 发送。
      if (evidence.hasAttachment && hasExpectedPrompt && evidence.sendButtonEnabled) {
        ToolboxShell.appendLog(
          `[AUTOQ][PROCESSING_STALE_RECOVER_RETRY] kind=initial task=${task.title || '-'} pendingMs=${pendingMs} `
          + `currentStep=${currentStep} action=send-existing-composer`,
        );

        processingStaleRecoveryInFlight = true;
        const expectedTextForSend = expectedInitial;

        void (async () => {
          try {
            const sendUnifiedResult = await sendUnifiedMessage({
              source: 'autoq-processing-stale-existing-composer',
              mode: 'autoqueue-batch-send',
              text: expectedTextForSend,
              sendExistingComposer: true,
              waitForReplyIdle: true,
              waitForAttachmentReady: false,
              allowEnterFallback: false,
              maxAttempts: 4,
              shouldStop: () => !state.running,
            });

            const mapped = {
              ok: !!(sendUnifiedResult && sendUnifiedResult.ok === true),
              reason: String((sendUnifiedResult && sendUnifiedResult.reason) || 'unknown'),
              retryable: !!(sendUnifiedResult && sendUnifiedResult.retryable === true),
              wait_reply: !!(sendUnifiedResult && sendUnifiedResult.wait_reply === true),
            };

            ToolboxShell.appendLog(
              `[AUTOQ][SEND_UNIFIED_RESULT] task=${task.title || '-'} ok=${mapped.ok ? 1 : 0} `
              + `reason=${mapped.reason} retryable=${mapped.retryable ? 1 : 0} wait=${mapped.wait_reply ? 1 : 0}`,
            );

            if (mapped.ok) {
              recordTaskBatchMessageSent('initial');

              state.sentCount = Math.max(0, Number(state.sentCount) || 0) + 1;
              state.currentMessageId = String(state.currentMessageId || '').trim();

              run.pendingSendKind = null;
              run.pendingSendStartedAt = 0;
              state.taskRun = run;

              setAutoQueuePhase(AUTO_QUEUE_PHASES.SENT, 'message accepted');
              state.waitingReply = true;
              setAutoQueuePhase(AUTO_QUEUE_PHASES.WAITING_REPLY, 'await-assistant');
              state.replyBecameBusy = false;
              state.idleSince = 0;
              state.waitingStartedAt = Date.now();

              setTaskBatchStep('wait-initial-reply', task, { log: false });
              ToolboxShell.appendLog('[AUTOQ][TASK][WAIT_REPLY]');
              updateStatus('processing-stale-sent-existing-composer');
              if (typeof updateChatInputStateBadge === 'function') {
                updateChatInputStateBadge();
              }
            } else {
              // 发送失败：回到 initial，交给正常写入链路重试。
              run.pendingSendKind = 'initial';
              run.pendingSendStartedAt = 0;
              run.lastPendingSendKindBeforeProcessing = 'initial';
              state.taskRun = run;

              state.sendingNow = false;
              state.waitingReply = false;
              state.replyBecameBusy = false;
              state.idleSince = 0;
              state.waitingStartedAt = 0;
              state.taskBatchStepRunning = false;
              state.nextSendAt = 0;

              updateStatus('processing-stale-retry-failed');
              if (typeof updateChatInputStateBadge === 'function') {
                updateChatInputStateBadge();
              }
            }
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            const errStack = err && err.stack ? String(err.stack) : '';
            console.error('[AUTOQ][PROCESSING_STALE_RECOVER_ERROR]', err);
            ToolboxShell.appendLog(
              `[AUTOQ][PROCESSING_STALE_RECOVER_ERROR] error=${errText} stack=${errStack}`,
            );

            run.pendingSendKind = 'initial';
            run.pendingSendStartedAt = 0;
            run.lastPendingSendKindBeforeProcessing = 'initial';
            state.taskRun = run;

            state.sendingNow = false;
            state.waitingReply = false;
            state.replyBecameBusy = false;
            state.idleSince = 0;
            state.waitingStartedAt = 0;
            state.taskBatchStepRunning = false;
            state.nextSendAt = 0;
          } finally {
            processingStaleRecoveryInFlight = false;
          }
        })();

        return true;
      }

      // payload 残留/非当前 prompt：回到 initial 重写 prompt。
      ToolboxShell.appendLog(
        `[AUTOQ][PROCESSING_STALE_RECOVER_RETRY] kind=initial task=${task.title || '-'} pendingMs=${pendingMs} `
        + `currentStep=${currentStep} action=replace-prompt`,
      );

      run.pendingSendKind = 'initial';
      run.pendingSendStartedAt = 0;
      run.lastPendingSendKindBeforeProcessing = 'initial';
      state.taskRun = run;

      state.sendingNow = false;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.taskBatchStepRunning = false;
      state.nextSendAt = 0;

      updateStatus('processing-stale-replace-prompt');
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }

      return false;
    }

    function maybeUpdateWaitingState() {
      if (repairIllegalWaitingReplyPendingSendState('maybe-update-waiting')) {
        return;
      }

      if (isComposerSendButtonWaitBlocking()) {
        holdTaskUntilSendButtonReady(getCurrentRunningTask(), 'composer-send-button-wait');
        return;
      }

      if (
        config.promptMode === 'task'
        && state.phase === AUTO_QUEUE_PHASES.REPLY_READY
        && isChatGPTActuallyBusyForTaskQueue()
      ) {
        repairWaitingReplyForAssistantBusy('reply-ready-phase-busy');
        return;
      }

      if (!state.waitingReply) return;

      if (guardAutoQueueBackgroundThrottle('wait-reply')) {
        return;
      }

      const busy = isChatGPTActuallyBusyForTaskQueue();
      const waitedMs = Date.now() - Number(state.waitingStartedAt || 0);
      const maxWaitMs = Number(state.waitingNoBusyTimeoutMs) || 60000;

      if (busy) {
        state.replyBecameBusy = true;
        state.idleSince = 0;
        ChatInputStateRuntime.waitingForReply = false;
        if (config.promptMode === 'task') {
          maybeSettleTaskReplyByVisibleDoneSignal('wait-reply-busy');
        }
        updateStatus();
        updateChatInputStateBadge();
        return;
      }

      if (!state.replyBecameBusy) {
        if (waitedMs >= 1200) {
          const replySnapshot = buildAssistantReplySnapshot();
          const validation = validateAssistantReplyForRun(
            { runId: state.currentRunId },
            replySnapshot,
          );

          if (validation.ok) {
            ToolboxShell.appendLog(
              `[AUTO_QUEUE][REPLY_SETTLED_FAST] reason=no-busy-observed waitedMs=${waitedMs}`,
            );

            if (config.promptMode === 'task') {
              void onAssistantReplySettled(validation.reply.text, {
                reason: 'fast-reply-detected',
              });
            } else {
              if (tryStopNonTaskAutoQueueOnTerminalReply(validation.reply.text, 'fast-reply-detected')) {
                return;
              }
              setAutoQueuePhase(AUTO_QUEUE_PHASES.REPLY_READY, 'assistant reply ready');
              state.waitingReply = false;
              state.replyBecameBusy = false;
              state.idleSince = 0;
              state.waitingStartedAt = 0;
              setAutoQueuePhase(AUTO_QUEUE_PHASES.DONE, 'reply ready');
              advanceAfterSend();
            }

            updateStatus();
            updateChatInputStateBadge();
            return;
          }
        }

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

    function normalizeTaskQuotaWaitMode(raw) {
      const mode = String(raw || '').trim();
      if (mode === 'wait_until_available' || mode === 'stop_on_limit' || mode === 'wait_max_then_stop') {
        return mode;
      }
      return 'wait_until_available';
    }

    function getTaskQuotaWaitModeConfig() {
      const defaults = typeof createDefaultTaskQueueSettings === 'function'
        ? createDefaultTaskQueueSettings()
        : {};

      const raw = config.taskQueueSettings || {};
      const mode = normalizeTaskQuotaWaitMode(raw.taskQuotaWaitMode);
      const maxWaitMinutesRaw = raw.taskQuotaMaxWaitMinutes;
      const maxWaitMinutes = Math.max(
        1,
        Math.floor(Number(maxWaitMinutesRaw) || defaults.taskQuotaMaxWaitMinutes || 30),
      );

      const modeMaxWaitMs = mode === 'wait_max_then_stop'
        ? maxWaitMinutes * 60 * 1000
        : (mode === 'wait_until_available' ? Number.POSITIVE_INFINITY : 0);

      return {
        mode,
        maxWaitMinutes,
        maxWaitMs: modeMaxWaitMs,
      };
    }

    function getTaskQuotaWaitModeLabel() {
      const cfg = getTaskQuotaWaitModeConfig();
      if (cfg.mode === 'wait_until_available') {
        return 'wait_until_available（一直等待）';
      }
      if (cfg.mode === 'stop_on_limit') {
        return 'stop_on_limit（额度满立即停止）';
      }
      if (cfg.mode === 'wait_max_then_stop') {
        return `wait_max_then_stop（最多${cfg.maxWaitMinutes}分钟后停止）`;
      }
      return `wait_until_available（一直等待）`;
    }

    function computeNextReleaseAtForQuotaState(quotaState, neededCount = 1) {
      // quotaState.records 里每条记录一般包含 ts/tsMs 和 count（count=上传文件数或1）
      const quota = quotaState || {};
      const records = Array.isArray(quota.records) ? quota.records.slice() : [];
      const windowMs = Math.max(0, Number(quota.windowMs) || 0);
      if (!windowMs || !records.length) {
        return 0;
      }

      const remaining = Math.max(0, Number(quota.remaining) || 0);
      const needed = Math.max(1, Math.floor(Number(neededCount) || 1));
      if (remaining >= needed) {
        return Date.now();
      }

      const deficit = needed - remaining;
      records.sort((a, b) => Number(a && a.ts) - Number(b && b.ts));

      let removed = 0;
      for (const r of records) {
        const count = Math.max(1, Number(r && r.count) || 1);
        removed += count;
        if (removed >= deficit) {
          return Number(r.ts) + windowMs;
        }
      }

      // 理论上不会走到这里，但兜底返回 0 表示无法估算
      return 0;
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
      const waitStartAt = Date.now();
      const quotaModeCfg = getTaskQuotaWaitModeConfig();
      const mode = quotaModeCfg.mode;
      const maxWaitMs = quotaModeCfg.maxWaitMs;

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

        const now = Date.now();
        const waitedMs = Math.max(0, now - waitStartAt);

        const quotaCheck = UploadModule.canStartNextTaskByQuota(task);
        if (quotaCheck.ok) {
          return quotaCheck;
        }

        const uploadRemaining = quotaCheck.uploadRemaining ?? '-';
        const messageRemaining = quotaCheck.messageRemaining ?? '-';

        // 估算：下一次能满足“当前任务所需额度”的释放时间点。
        let nextReleaseAt = 0;
        let waitText = '-';
        if (quotaCheck.reason === 'upload-quota-exceeded') {
          const uploadQuota = getPanelUploadQuotaState({ logSnapshot: false });
          const needed = Math.max(1, Number(quotaCheck.fileCount) || 1);
          nextReleaseAt = computeNextReleaseAtForQuotaState(uploadQuota, needed);
          waitText = formatDurationForTaskRateLimit(Math.max(0, nextReleaseAt - now));
        } else if (quotaCheck.reason === 'message-quota-exceeded') {
          const messageQuota = getPanelMessageQuotaState({ logSnapshot: false });
          nextReleaseAt = computeNextReleaseAtForQuotaState(messageQuota, 1);
          waitText = formatDurationForTaskRateLimit(Math.max(0, nextReleaseAt - now));
        }

        ToolboxShell.appendLog(
          `[AUTOQ][QUOTA_WAIT] reason=${quotaCheck.reason || '-'} kind=${kind} `
          + `uploadRemaining=${uploadRemaining} messageRemaining=${messageRemaining} `
          + `waitedMs=${waitedMs} maxWaitMs=${maxWaitMs} nextReleaseAt=${nextReleaseAt} waitText=${waitText} `
          + `mode=${mode}`,
        );

        // stop_on_limit：直接停止，不进入等待循环
        if (mode === 'stop_on_limit') {
          setTaskBatchStep('quota-wait', task || getCurrentRunningTask(), { log: false });
          updateStatus('quota-wait');
          touchBatchTaskGroupActivity('quota-wait-stop-on-limit');
          return {
            ok: false,
            reason: 'quota-stop-on-limit',
          };
        }

        if (mode === 'wait_max_then_stop' && waitedMs >= maxWaitMs) {
          setTaskBatchStep('quota-wait', task || getCurrentRunningTask(), { log: false });
          updateStatus('quota-wait');
          touchBatchTaskGroupActivity('quota-wait-timeout');
          return {
            ok: false,
            reason: 'quota-wait-timeout',
          };
        }

        setTaskBatchStep('quota-wait', task || getCurrentRunningTask(), { log: false });
        updateStatus('quota-wait');
        touchBatchTaskGroupActivity('quota-wait');

        const remainingMs = Number.isFinite(maxWaitMs)
          ? Math.max(0, maxWaitMs - waitedMs)
          : 30000;
        await sleepMs(Math.min(30000, remainingMs || 30000));
      }
    }

    async function waitForTaskSendRateLimit(kind = 'task-message', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function'
        ? options.shouldStop
        : null;
      const quotaModeCfg = getTaskQuotaWaitModeConfig();
      const mode = quotaModeCfg.mode;
      const maxWaitMs = quotaModeCfg.maxWaitMs;
      const waitStartAt = Date.now();

      while (true) {
        if (shouldStop && shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const now = Date.now();
        const waitedMs = Math.max(0, now - waitStartAt);
        if (mode === 'wait_max_then_stop' && waitedMs >= maxWaitMs) {
          touchBatchTaskGroupActivity('rate-limit-wait-timeout');
          return {
            ok: false,
            reason: 'rate-limit-wait-timeout',
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
        const nextReleaseAt = now + waitMs;
        const waitText = formatDurationForTaskRateLimit(waitMs);

        // stop_on_limit：额度/限速到不了就直接停，不继续等待
        if (mode === 'stop_on_limit') {
          touchBatchTaskGroupActivity('rate-limit-stop-on-limit');
          return {
            ok: false,
            reason: 'rate-limit-stop-on-limit',
          };
        }

        setTaskBatchStep('rate-limit-wait', getCurrentRunningTask(), { log: false });
        ToolboxShell.setStatus(`批量任务组发送限速中：${status.display}`);

        state.taskRateLimitLastLogAt = now;
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SEND_RATE_LIMIT][WAIT] kind=${kind} used=${status.used}/${status.max} `
          + `windowMinutes=${status.windowMinutes} waitMs=${waitMs} `
          + `waitedMs=${waitedMs} maxWaitMs=${maxWaitMs} nextReleaseAt=${nextReleaseAt} `
          + `waitText=${waitText} mode=${mode}`,
        );

        updateStatus('task-rate-limit-wait');

        touchBatchTaskGroupActivity('task-send-rate-limit-wait');
        const remainingGlobalMs = mode === 'wait_max_then_stop'
          ? Math.max(0, maxWaitMs - waitedMs)
          : Number.POSITIVE_INFINITY;
        const sleepMsValue = Math.min(waitMs, 30000, remainingGlobalMs);
        await sleepMs(Math.max(0, sleepMsValue));
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
      const quotaModeCfg = getTaskQuotaWaitModeConfig();
      const mode = quotaModeCfg.mode;
      const maxWaitMs = quotaModeCfg.maxWaitMs;
      const waitStartAt = Date.now();

      while (true) {
        if (shouldStop && shouldStop()) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const now = Date.now();
        const waitedMs = Math.max(0, now - waitStartAt);
        if (mode === 'wait_max_then_stop' && waitedMs >= maxWaitMs) {
          touchBatchTaskGroupActivity('task-upload-rate-limit-wait-timeout');
          return {
            ok: false,
            reason: 'rate-limit-wait-timeout',
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
        const nextReleaseAt = now + waitMs;
        const waitText = formatDurationForTaskRateLimit(waitMs);

        // stop_on_limit：额度/限速到不了就直接停，不继续等待
        if (mode === 'stop_on_limit') {
          touchBatchTaskGroupActivity('task-upload-rate-limit-stop-on-limit');
          return {
            ok: false,
            reason: 'rate-limit-stop-on-limit',
          };
        }

        setTaskBatchStep('upload-rate-limit-wait', getCurrentRunningTask(), { log: false });
        ToolboxShell.setStatus(`批量任务组上传限速中：${status.display}`);

        state.taskUploadRateLimitLastLogAt = now;
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_UPLOAD_RATE_LIMIT][WAIT] kind=${kind} used=${status.used}/${status.max} `
          + `windowMinutes=${status.windowMinutes} waitMs=${waitMs} waitedMs=${waitedMs} `
          + `maxWaitMs=${maxWaitMs} nextReleaseAt=${nextReleaseAt} waitText=${waitText} mode=${mode}`,
        );

        updateStatus('task-upload-rate-limit-wait');

        touchBatchTaskGroupActivity('task-upload-rate-limit-wait');
        const remainingGlobalMs = mode === 'wait_max_then_stop'
          ? Math.max(0, maxWaitMs - waitedMs)
          : Number.POSITIVE_INFINITY;
        const sleepMsValue = Math.min(waitMs, 30000, remainingGlobalMs);
        await sleepMs(Math.max(0, sleepMsValue));
      }
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
      const beforeSendable = typeof ComposerApi.canSendNow === 'function'
        ? (ComposerApi.canSendNow() ? 1 : 0)
        : 0;

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

      const afterSendable = typeof ComposerApi.canSendNow === 'function'
        ? (ComposerApi.canSendNow() ? 1 : 0)
        : 0;
      ToolboxShell.appendLog(
        `[AUTOQ][SENDABLE_RECHECK_AFTER_INPUT] before=${beforeSendable} after=${afterSendable} taskIndex=${
          state.taskRun ? Number(state.taskRun.currentIndex || 0) + 1 : '?'
        } source=${String(source || '-')} retryIndex=${Number(retryIndex || 0)}`,
      );

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
      let sawDisabledAfterUpload = false;

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
          if (Number(disabledFlag) === 1 && hasAttachment) {
            sawDisabledAfterUpload = true;
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
          if (hasAttachment) {
            ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][SEND_BLOCKED] reason=send-button-disabled-after-upload');
            return {
              ok: false,
              reason: 'send-button-disabled-after-upload',
              wait: true,
              retryable: true,
            };
          }
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

      if (allowDisabledWithText && finalHasText && !finalHasAttachment) {
        return {
          ok: true,
          reason: 'send_button_missing_use_enter_fallback',
          useEnterFallback: true,
        };
      }
      if (sawDisabledAfterUpload || finalHasAttachment) {
        ToolboxShell.appendLog('[AUTOQ][TASK_BATCH][SEND_BLOCKED] reason=send-button-disabled-after-upload');
        return {
          ok: false,
          reason: 'send-button-disabled-after-upload',
          wait: true,
          retryable: true,
        };
      }

      if (typeof hasVoiceComposerButtonOnly === 'function' && hasVoiceComposerButtonOnly()) {
        return { ok: false, reason: 'voice_button_only', wait: true, retryable: true };
      }

      if (typeof detectComposerResponseState === 'function') {
        const responseState = detectComposerResponseState();
        const responseReason = String(responseState.response_state_reason || '').trim();
        if (
          responseReason === 'payload_ready_but_send_button_missing'
          || responseReason === 'attachment_ready_but_send_button_missing'
        ) {
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

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        const busyTask = getCurrentRunningTask();
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_BLOCKED_ASSISTANT_BUSY] kind=batch-pipeline task=${busyTask ? busyTask.title : '-'}`,
        );
        repairWaitingReplyForAssistantBusy('send-blocked-assistant-busy');
        return { ok: false, reason: 'assistant_busy', wait: true };
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

      if (typeof sendUnifiedMessage !== 'function') {
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=sendUnifiedMessage_unavailable');
        if (typeof sendContentViaComposer === 'function') {
          const legacy = await sendContentViaComposer({
            source,
            content: prompt,
            allowReplaceDraft: true,
            waitUntilSendable: true,
            timeoutMs: 60000,
            blockWhenResponding: true,
            shouldStop: () => !state.running,
          });
          return {
            ok: legacy && legacy.ok === true,
            reason: String((legacy && legacy.reason) || 'send_pipeline_unavailable'),
            retryable: true,
            wait: true,
          };
        }
        return { ok: false, reason: 'send_pipeline_unavailable', retryable: true, wait: true };
      }

      setTaskBatchStep('send-initial', getCurrentRunningTask(), { log: false });
      ToolboxShell.setStatus('正在发送初始指令…');
      ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');

      {
        const attachSnap = resolveAutoQueueAttachmentSnapshot({ detailed: true });
        if (attachSnap) {
          const filenameList = Array.isArray(attachSnap.filenames)
            ? attachSnap.filenames.join(',')
            : ((attachSnap.items || []).map((x) => x && x.name ? x.name : '').filter(Boolean).join(',') || '-');
          const logLine = `[AUTOQ][SEND_WITH_ATTACHMENT_SNAPSHOT] ready=${attachSnap.readyCount} uploading=${attachSnap.uploadingCount} fileCount=${attachSnap.fileCount} filenames=${filenameList || '-'}`;
          ToolboxShell.appendLog(logLine);
          if (attachSnap.readyCount === 0 && attachSnap.fileCount === 0) {
            ToolboxShell.appendLog(`[AUTOQ][SEND_WITHOUT_ATTACHMENT][WARN] taskId=${taskId} reason=no-ready-attachment`);
          }
          if (attachSnap.uploadingCount > 0) {
            ToolboxShell.appendLog(`[AUTOQ][SEND_BLOCKED_ATTACHMENT_UPLOADING] taskId=${taskId} uploadingCount=${attachSnap.uploadingCount}`);
            return { ok: false, reason: 'attachment_still_uploading', wait: true, retryable: true };
          }
        }
      }

      const uploadDoneAt = state.taskRun && state.taskRun.lastAutoUploadDoneAt
        ? Number(state.taskRun.lastAutoUploadDoneAt) || 0
        : 0;
      if (uploadDoneAt > 0) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_BATCH][UPLOAD_TO_PROMPT_GAP_BEFORE_SEND] gapMs=${Date.now() - uploadDoneAt}`,
        );
      }

      const sendUnifiedResult = await sendUnifiedMessage({
        source,
        mode: 'autoqueue-batch-send',
        text: prompt,
        sendExistingComposer: false,
        waitForReplyIdle: true,
        waitForAttachmentReady: true,
        writeTextBeforeAttachmentWait: true,
        allowEnterFallback: false,
        maxAttempts: 8,
        buttonMaxAttempts: 20,
        buttonIntervalMs: 150,
        buttonMaxDisabledWaitMs: 2500,
        shouldStop: () => !state.running,
      });

      const mapped = {
        ok: sendUnifiedResult && sendUnifiedResult.ok === true,
        reason: String((sendUnifiedResult && sendUnifiedResult.reason) || 'unknown'),
        retryable: sendUnifiedResult && sendUnifiedResult.retryable === true,
        wait: sendUnifiedResult && (
          sendUnifiedResult.wait_reply === true
          || sendUnifiedResult.wait_send === true
        ),
        wait_send: sendUnifiedResult && sendUnifiedResult.wait_send === true,
        wait_reply: sendUnifiedResult && sendUnifiedResult.wait_reply === true,
      };

      ToolboxShell.appendLog(
        `[AUTOQ][SEND_UNIFIED_RESULT] task=${taskName} ok=${mapped.ok ? 1 : 0} `
        + `reason=${mapped.reason} retryable=${mapped.retryable ? 1 : 0} wait=${mapped.wait ? 1 : 0}`,
      );

      if (mapped.ok) {
        const runAfterSend = state.taskRun || {};
        if (Number(runAfterSend.sendRetryCount) > 0) {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_RETRY_SUCCESS] task=${taskName} retryCount=${runAfterSend.sendRetryCount}`,
          );
        }
        clearRelentlessSendRetryState();
        recordTaskSendRateLimitHit(source);
        ToolboxShell.appendLog(`[AUTOQ][SEND_SUCCESS] task=${taskName} method=${mapped.reason || '-'}`);
        const runningTask = getCurrentRunningTask();
        notifyRuntimeTaskSendSuccess(runningTask, source || 'batch-send');
        state.currentMessageId = String(state.currentMessageId || '').trim();
        setAutoQueuePhase(AUTO_QUEUE_PHASES.SENT, 'message accepted');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');
        return mapped;
      }

      const classified = logSendFailureClassified('initial', getCurrentRunningTask(), mapped.reason, mapped);
      if (classified.action === 'retry') {
        return {
          ok: false,
          reason: mapped.reason,
          wait: true,
          retryable: true,
          relentlessRetry: true,
        };
      }

      ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${mapped.reason}`);
      ToolboxShell.appendLog(
        `[AUTOQ][SEND_GIVE_UP] phase=send task=${taskName} taskId=${taskId} reason=${mapped.reason}`,
      );
      return mapped;
    }

    function getAutoQueueSendHardTimeoutMs() {
      const settings = config.taskQueueSettings || {};
      return Math.max(15000, Number(settings.taskSendHardTimeoutMs) || 45000);
    }

    function withAutoQueueSendTimeout(promise, timeoutMs, meta = {}) {
      let timerId = null;
      const timeoutPromise = new Promise((resolve) => {
        timerId = window.setTimeout(() => {
          const task = meta.task || getCurrentRunningTask();
          ToolboxShell.appendLog(
            `[AUTOQ][SEND_TIMEOUT] phase=${meta.phase || '-'} task=${task ? task.title : '-'} timeoutMs=${timeoutMs}`,
          );
          resolve({
            ok: false,
            reason: 'send_hard_timeout',
            retryable: true,
            wait: true,
          });
        }, timeoutMs);
      });
      return Promise.race([
        Promise.resolve(promise),
        timeoutPromise,
      ]).finally(() => {
        if (timerId) {
          window.clearTimeout(timerId);
        }
      });
    }

    async function sendTaskPrompt(content, logTag, sendKind = 'initial') {
      const prompt = String(content || '').trim();
      const source = 'batch-task-group-initial-instruction';
      const safeSendKind = String(sendKind || 'initial');

      if (!prompt) {
        log('任务指令为空，跳过发送');
        return { ok: false, reason: 'empty-prompt' };
      }

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        const busyTask = getCurrentRunningTask();
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_BLOCKED_ASSISTANT_BUSY] kind=${safeSendKind} task=${busyTask ? busyTask.title : '-'}`,
        );
        repairWaitingReplyForAssistantBusy('send-blocked-assistant-busy');
        return { ok: false, reason: 'assistant_busy', wait: true };
      }

      const run = state.taskRun || {};
      run.lastPendingSendKindBeforeProcessing = safeSendKind;
      run.pendingSendKind = 'processing';
      run.pendingSendStartedAt = Date.now();
      state.taskRun = run;
      state.sendingNow = true;

      try {
        // 自动上传后的关键顺序校验：
        // 1) 输入框若只有附件（textLen=0），必须记录并确保后续流程重写 prompt + 发送。
        // 2) 上传后附件若仍在 processing，则先 waitAttachmentsStableForSend，再进入 unified 发送链路。
        const task = getCurrentRunningTask();
        const taskTitle = task && task.title ? task.title : '-';
        const composerTextTrimmed = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasAttachmentPayload = typeof ComposerApi.getComposerRuntimeSnapshotLight === 'function'
          ? Number(ComposerApi.getComposerRuntimeSnapshotLight(500).attachmentCount || 0) > 0
          : (
            typeof ComposerApi.countAttachmentChipsFast === 'function'
              ? ComposerApi.countAttachmentChipsFast() > 0
              : (
                typeof ComposerApi.countAttachmentChips === 'function'
                  ? ComposerApi.countAttachmentChips() > 0
                  : false
              )
          );
        if (hasAttachmentPayload && !composerTextTrimmed) {
          const textLen = 0;
          ToolboxShell.appendLog(
            `[AUTOQ][POST_UPLOAD_PROMPT_MISSING] task=${taskTitle} kind=${safeSendKind} attachment=1 textLen=${textLen} action=rewrite-prompt`,
          );
        }

        if (
          typeof waitAttachmentsStableForSend === 'function'
          && hasAttachmentPayload
        ) {
          await waitAttachmentsStableForSend(
            typeof MAX_ATTACHMENT_SEND_WAIT_MS === 'number' ? MAX_ATTACHMENT_SEND_WAIT_MS : 120000,
            () => !state.running,
            { source: `autoq-pre-send-attach-stable:${safeSendKind}` },
          );
        }

        const hasUnifiedAfterStableWait = typeof ComposerApi.hasComposerAttachmentUnified === 'function'
          ? !!ComposerApi.hasComposerAttachmentUnified()
          : hasAttachmentPayload;

        if (!hasUnifiedAfterStableWait) {
          ToolboxShell.appendLog(
            `[AUTOQ][POST_UPLOAD_ATTACHMENT_UNIFIED_FALSE] task=${taskTitle} kind=${safeSendKind} action=continue-send`,
          );
        }

        const sendResult = await withAutoQueueSendTimeout(
          sendBatchTextViaUnifiedPipeline(prompt, source),
          getAutoQueueSendHardTimeoutMs(),
          {
            phase: safeSendKind,
            task: getCurrentRunningTask(),
            source,
          },
        );

        if (sendResult && sendResult.ok === true && isComposerSendButtonWaitBlocking()) {
          const sendSnap = typeof getComposerSendButtonSnapshot === 'function'
            ? getComposerSendButtonSnapshot({ silent: true })
            : { ready: false };
          if (sendSnap.ready !== true) {
            ToolboxShell.appendLog(
              `[AUTOQ][SEND_FALSE_SUCCESS_GUARD] kind=${safeSendKind} task=${taskTitle} `
              + `action=treat-as-not-sent reason=send_button_still_not_ready sendButtonReady=0`,
            );
            sendResult.ok = false;
            sendResult.reason = 'waiting_attachment_upload_done';
            sendResult.retryable = true;
            sendResult.wait = true;
          }
        }

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
        run.pendingSendStartedAt = 0;
        run.lastPendingSendKindBeforeProcessing = null;
        state.taskRun = run;
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

      if (isChatGPTActuallyBusyForTaskQueue()) {
        return false;
      }

      return hasRemainingBatchTasks();
    }

    function logBatchPendingCheck(decision) {
      const run = state.taskRun || {};
      const current = Number(run.currentIndex || 0);
      const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;
      const assistantBusy = isChatGPTActuallyBusyForTaskQueue() ? 1 : 0;
      const phase = String(state.phase || '-');
      const step = run && run.currentStep ? String(run.currentStep) : '-';
      let finalDecision = String(decision || '-');

      if (assistantBusy && finalDecision === 'continue') {
        finalDecision = 'wait-assistant';
      }

      ToolboxShell.appendLog(
        `[AUTOQ][BATCH_PENDING_CHECK] current=${current} total=${total} `
        + `waitingReply=${state.waitingReply ? '1' : '0'} assistantBusy=${assistantBusy} `
        + `phase=${phase} step=${step} decision=${finalDecision}`,
      );
    }

    function maybeSendNextTask() {
      if (repairIllegalWaitingReplyPendingSendState('maybe-send-next')) {
        return;
      }

      if (isComposerSendButtonWaitBlocking()) {
        holdTaskUntilSendButtonReady(getCurrentRunningTask(), 'send-button-wait-before-send');
        return;
      }

      if (config.promptMode === 'task' && isChatGPTActuallyBusyForTaskQueue()) {
        repairWaitingReplyForAssistantBusy('assistant-busy-hard-block');
        const busyWaitTask = getCurrentRunningTask();
        if (busyWaitTask) {
          setTaskBatchStep('wait-current-reply', busyWaitTask, { log: false });
        }
        updateStatus('assistant-busy-hard-block');
        logBatchPendingCheck('wait-assistant');
        return;
      }

      if (config.promptMode === 'task') {
        logBatchPendingCheck(shouldContinueBatch() ? 'continue' : 'stop');
      }

      const runStep = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';

      // Pending action: reply is ready but still stuck at copy-last-reply.
      // In this state, we must finish copy and advance immediately (do not just log decision=continue).
      if (
        state.running === true
        && !state.waitingReply
        && !isChatGPTActuallyBusyForTaskQueue()
        && String(state.phase || '') === 'reply_ready'
        && runStep === 'copy-last-reply'
      ) {
        const run = state.taskRun || {};
        const current = Number(run.currentIndex || 0);
        const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;

        let replyText = '';
        let copyErr = null;
        try {
          replyText = getLastAssistantReplyText();
        } catch (e) {
          copyErr = e;
        }

        const taskIndex = current;
        const trimmed = String(replyText || '').trim();
        if (copyErr) {
          ToolboxShell.appendLog(
            `[AUTOQ][BATCH_PENDING_ACTION] action=wait-reply-recover current=${current} total=${total}`,
          );
          const errText = copyErr && copyErr.message ? copyErr.message : String(copyErr);
          ToolboxShell.appendLog(
            `[BATCH_TASK_GROUP][COPY_REPLY_FAIL] reason=${errText || 'copy-failed'} taskIndex=${taskIndex}`,
          );
          const allowFailContinue = !(
            config.taskQueueSettings
            && config.taskQueueSettings.copyLastReplyFailureContinue === false
          );
          if (allowFailContinue) {
            recoverBatchTaskGroup(getBatchTaskGroupRunId(), errText || 'copy-last-reply-failed', {
              action: 'wait-reply-recover',
              clearStepRunning: true,
              clearWaiting: false,
            });
          }
        } else if (trimmed) {
          const currentTask = getCurrentRunningTask();
          if (state.taskRun) {
            const run = syncCurrentTaskVerificationContext(currentTask, { resetState: false, keepRetryCount: true });
            run.currentTaskReplyText = trimmed;
            const stableState = updateCurrentTaskReplyStableState(trimmed);
            state.taskRun = run;
            if (!stableState.stable) {
              ToolboxShell.appendLog(
                `[COPY_REPLY][WAIT_STABLE] stable=${stableState.stableCount}/${stableState.required || TASK_REPLY_STABLE_HASH_ROUNDS} chars=${trimmed.length}`,
              );
              ToolboxShell.appendLog(
                `[AUTOQ][BATCH_PENDING_ACTION] action=wait-reply-recover current=${current} total=${total}`,
              );
              recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'reply-not-stable', {
                action: 'wait-reply-recover',
                clearStepRunning: true,
                clearWaiting: false,
              });
              return;
            }
          }
          ToolboxShell.appendLog(
            `[AUTOQ][BATCH_PENDING_ACTION] action=finish-copy-and-advance current=${current} total=${total}`,
          );
          ToolboxShell.appendLog(
            `[BATCH_TASK_GROUP][COPY_REPLY_DONE] taskIndex=${taskIndex} length=${trimmed.length}`,
          );
          void handleTaskReplyReady().catch((error) => {
            logTaskRunError('[AUTOQ][COPY_REPLY_DONE][HANDLE_REPLY_READY_FAILED]', error, currentTask);
            recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'copy-last-reply-done-handle-failed', {
              action: 'wait-reply-recover',
              clearStepRunning: true,
              clearWaiting: false,
            });
          });
        } else {
          ToolboxShell.appendLog(
            `[AUTOQ][BATCH_PENDING_ACTION] action=wait-reply-recover current=${current} total=${total}`,
          );
          ToolboxShell.appendLog(
            `[BATCH_TASK_GROUP][COPY_REPLY_SKIP] reason=no-reply-found-but-page-idle taskIndex=${taskIndex}`,
          );
          recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'copy-last-reply-empty', {
            action: 'wait-reply-recover',
            clearStepRunning: true,
            clearWaiting: false,
          });
        }
        return;
      }

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

      state.batchInitialWaitLoggedAt = 0;

      const task = getCurrentRunningTask();

      if (!task) {
        void moveToNextTask('missing-current-task', { skipGate: true }).then((moved) => {
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
          void moveToNextTask('prompt-missing-initial', { skipGate: true }).catch(handleMoveToNextTaskError);
          return;
        }

        if (!initial) {
          log(`任务「${currentTask.title}」缺少初始指令，跳过`);
          markTaskStatus(currentTask, 'skipped');
          void moveToNextTask('initial-empty-skip', { skipGate: true }).catch(handleMoveToNextTaskError);
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

              if (prepareResult && prepareResult.retryable === true) {
                scheduleRelentlessSendRetry(prepareReason, 'initial', currentTask);
                return;
              }

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
            ToolboxShell.appendLog(`[AUTOQ][CLOSED_LOOP][INITIAL_SENT] task=${currentTask.title}`);
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
        if (
          state.tickerStartedAt > 0
          && Date.now() - state.tickerStartedAt < 1500
          && !state.running
          && !state.waitingReply
        ) {
          return;
        }

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          if (config.promptMode === 'task' && (state.running || state.waitingReply || state.batchTaskRunning)) {
            recoverBatchTaskGroup(getBatchTaskGroupRunId(), 'page-navigation', {
              delayMs: BATCH_TASK_GROUP_RECOVER_DELAY_MS,
              clearStepRunning: true,
            });
            return;
          }
          if (state.running || state.waitingReply) {
            stop({
              reason: 'page-navigation',
              logStop: false,
              markCurrent: false,
            });
          }
          return;
        }

        if (
          !state.running
          && !state.waitingReply
          && !state.uploadingFromAutoQueue
          && !state.batchAutoUploading
        ) {
          ensureTicker();
          return;
        }

        if (config.promptMode === 'task') {
          checkBatchTaskGroupWatchdog();
          repairIllegalWaitingReplyPendingSendState('tick');
        }

        if (maybeResumeRelentlessSendRetry()) {
          updateStatus('send-wait-retry-tick');
          return;
        }

        const shortCircuit = maybeRecoverPendingSendProcessingStale();
        if (shortCircuit) {
          updateStatus('processing-stale-recover-short-circuit');
          if (typeof updateChatInputStateBadge === 'function') {
            updateChatInputStateBadge();
          }
          return;
        }

        maybeUpdateWaitingState();
        maybeSendNext();
        updateStatus();
      } catch (e) {
        console.warn('[ChatGPT toolbox] auto queue tick failed', e);
        log(`运行异常：${e && e.message ? e.message : String(e)}`);
        if (config.promptMode === 'task' && (state.running || state.waitingReply)) {
          recoverBatchTaskGroup(getBatchTaskGroupRunId(), `tick-error:${e && e.message ? e.message : String(e)}`, {
            clearStepRunning: true,
          });
        }
      }
    }

    function resolveTickerIntervalMs() {
      const active = !!(
        state.running
        || state.waitingReply
        || state.uploadingFromAutoQueue
        || state.batchAutoUploading
      );
      if (!active) {
        return 0;
      }
      return document.hidden ? 3000 : 1000;
    }

    function ensureTicker() {
      const nextIntervalMs = resolveTickerIntervalMs();
      if (nextIntervalMs <= 0) {
        if (state.tickTimer) {
          window.clearInterval(state.tickTimer);
          state.tickTimer = null;
          state.tickIntervalMs = 0;
        }
        return;
      }

      if (state.tickTimer && Number(state.tickIntervalMs || 0) === nextIntervalMs) {
        return;
      }

      if (state.tickTimer) {
        window.clearInterval(state.tickTimer);
        state.tickTimer = null;
      }

      state.tickerStartedAt = Date.now();
      state.tickIntervalMs = nextIntervalMs;
      state.tickTimer = window.setInterval(tick, nextIntervalMs);
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

        const sentAt = nowMs();
        task.status = 'running';
        task.manualInitialSentAt = sentAt;
        task.updatedAt = sentAt;
        saveConfig();
        renderTaskList();
        renderTaskEditor();
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SINGLE][INITIAL_MARK_SENT] task=${task.title} manualInitialSentAt=${task.manualInitialSentAt}`,
        );

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

    function hasCurrentAssistantReplyForTaskContinue() {
      if (typeof getLastAssistantReplyText !== 'function') {
        return false;
      }

      let text = '';

      try {
        text = String(getLastAssistantReplyText() || '').trim();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[AUTOQ][TASK_SINGLE][CHECK_REPLY_FAILED]', err);
        ToolboxShell.appendLog(`[AUTOQ][TASK_SINGLE][CHECK_REPLY_FAILED] error=${errText}`);
        return false;
      }

      if (!text) {
        return false;
      }

      if (
        typeof isInvalidAssistantReplyText === 'function'
        && isInvalidAssistantReplyText(text)
      ) {
        return false;
      }

      return true;
    }

    function shouldSendTaskContinueFromSendOnce(task, options = {}) {
      if (!task) {
        return false;
      }

      const allowDomProbe = !!(options && options.allowDomProbe === true);

      if (Number(task.manualInitialSentAt || 0) > 0) {
        return true;
      }

      if (String(task.status || '').trim().toLowerCase() === 'running') {
        return true;
      }

      if (Number(task.continueCount || 0) > 0) {
        return true;
      }

      if (allowDomProbe && hasCurrentAssistantReplyForTaskContinue()) {
        return true;
      }

      return false;
    }

    function buildManualTaskContinuePrompt(task, profile) {
      const resolved = resolveTaskContinueSettings(task, profile, { log: true });

      const actualDoneSignal = typeof normalizeDoneSignal === 'function'
        ? normalizeDoneSignal(resolved.actualDoneSignal)
        : resolved.actualDoneSignal;

      const actualContinuePrompt = typeof renderContinuePromptTemplate === 'function'
        ? renderContinuePromptTemplate(
          resolved.actualContinuePromptTemplate,
          actualDoneSignal,
        )
        : String(resolved.actualContinuePromptTemplate || '');

      return {
        prompt: String(actualContinuePrompt || '').trim(),
        doneSignal: actualDoneSignal,
        resolved,
      };
    }

    async function sendTaskContinueOnce() {
      if (state.running) {
        log('批量任务组运行中，请先停止再手动发送继续指令');
        return false;
      }

      readPanelConfig('task');

      const profile = getActiveTaskProfile();
      const task = getSelectedTask(profile);

      if (!task) {
        log('请先选择任务');
        return false;
      }

      const built = buildManualTaskContinuePrompt(task, profile);
      const prompt = String(built.prompt || '').trim();

      if (!prompt) {
        log('继续指令为空，无法发送');
        ToolboxShell.appendLog(`[AUTOQ][TASK_SINGLE][SEND_CONTINUE_ONLY][FAILED] task=${task.title} reason=empty-continue-prompt`);
        return false;
      }

      if (state.sendingNow) {
        log('正在发送中，请稍候');
        return false;
      }

      state.sendingNow = true;

      ToolboxShell.appendLog(
        `[AUTOQ][TASK_SINGLE][SEND_CONTINUE_ONLY] task=${task.title} prompt_len=${prompt.length}`,
      );

      try {
        const sendResult = await sendOnceWithRelentlessRetry(
          prompt,
          'auto-queue-task-manual-continue',
        );

        if (!sendResult || sendResult.ok !== true) {
          const reason = String((sendResult && sendResult.reason) || 'unknown');
          log(`发送继续指令失败：${reason}`);
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SINGLE][SEND_CONTINUE_ONLY][FAILED] task=${task.title} reason=${reason}`,
          );
          return false;
        }

        const continuedAt = nowMs();
        task.status = 'running';
        task.continueCount = Math.max(0, Number(task.continueCount) || 0) + 1;
        task.lastManualContinueAt = continuedAt;
        task.updatedAt = continuedAt;

        saveConfig();
        renderTaskList();
        renderTaskEditor();

        log(`已发送继续指令（仅一次）：${prompt.slice(0, 80)}`);
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SINGLE][SEND_CONTINUE_ONLY][DONE] task=${task.title} continueCount=${task.continueCount}`,
        );

        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send task continue once failed', err);
        log(`发送继续指令异常：${errText}`);
        ToolboxShell.appendLog(
          `[AUTOQ][TASK_SINGLE][SEND_CONTINUE_ONLY][ERROR] task=${task.title} error=${errText}`,
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
          readPanelConfig('task');

          const profile = getActiveTaskProfile();
          const task = getSelectedTask(profile);

          const shouldContinue = shouldSendTaskContinueFromSendOnce(task, {
            allowDomProbe: true,
          });

          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SINGLE][SEND_ONCE_DECIDE] task=${task ? task.title : '-'} action=${shouldContinue ? 'continue' : 'initial'}`,
          );

          const ok = shouldContinue
            ? await sendTaskContinueOnce()
            : await sendTaskInitialOnce();
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

    function logAutoQueueActionButtonDomState(reason) {
      if (!root) return;

      const uploadButtons = root.querySelectorAll('#cgpt-autoq-start-upload');
      const batchButtons = root.querySelectorAll('#cgpt-autoq-start');

      ToolboxShell.appendLog(
        `[AUTOQ][ACTION_BUTTON_DOM] reason=${reason || '-'} `
        + `uploadCount=${uploadButtons.length} `
        + `batchCount=${batchButtons.length} `
        + `delegatedBound=${root.dataset.autoqDelegatedActionsBound === '1' ? 1 : 0} `
        + `rootConnected=${root.isConnected ? 1 : 0}`,
      );
    }

    function logButtonHitTestState(reason) {
      const ids = ['cgpt-autoq-start-upload', 'cgpt-autoq-start', 'cgpt-autoq-send-once'];

      ids.forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) {
          ToolboxShell.appendLog(`[AUTOQ][HIT_TEST] reason=${reason || '-'} id=${id} found=0`);
          return;
        }

        const rect = btn.getBoundingClientRect();
        const x = Math.floor(rect.left + rect.width / 2);
        const y = Math.floor(rect.top + rect.height / 2);
        const topEl = document.elementFromPoint(x, y);
        const zeroRect = rect.width <= 0 || rect.height <= 0;

        ToolboxShell.appendLog(
          `[AUTOQ][HIT_TEST] reason=${reason || '-'} id=${id} found=1 `
          + `disabled=${btn.disabled ? 1 : 0} `
          + `pointerEvents=${getComputedStyle(btn).pointerEvents} `
          + `rect=${Math.floor(rect.left)}/${Math.floor(rect.top)}/${Math.floor(rect.width)}/${Math.floor(rect.height)} `
          + `visible=${zeroRect ? 0 : 1} `
          + `${zeroRect ? 'reason=zero-rect ' : ''}`
          + `topId=${topEl ? topEl.id || '-' : '-'} `
          + `topTag=${topEl ? topEl.tagName : '-'} `
          + `topClass=${topEl ? String(topEl.className || '').slice(0, 80) : '-'}`,
        );

        const blocked = topEl && topEl !== btn && !btn.contains(topEl);
        if (blocked) {
          ToolboxShell.appendLog(
            `[AUTOQ][HIT_TEST_BLOCKED] id=${id} topId=${topEl.id || '-'} topTag=${topEl.tagName || '-'} topClass=${String(topEl.className || '').slice(0, 120)}`,
          );
        }
      });
    }

    function logAutoQueueUploadButtonReady(reason = '') {
      const why = String(reason || '-');
      const btn = root ? qs('#cgpt-autoq-start-upload', root) : null;
      if (!btn) {
        ToolboxShell.appendLog(`[AUTOQ][UPLOAD_BUTTON_READY] reason=${why} found=0`);
        return;
      }

      const rect = btn.getBoundingClientRect();
      const w = Math.floor(rect.width || 0);
      const h = Math.floor(rect.height || 0);
      const zeroRect = w <= 0 || h <= 0;

      let topEl = null;
      let blocked = false;
      if (!zeroRect) {
        const x = Math.floor(rect.left + rect.width / 2);
        const y = Math.floor(rect.top + rect.height / 2);
        topEl = document.elementFromPoint(x, y);
        blocked = !!(topEl && topEl !== btn && !btn.contains(topEl));
      }

      ToolboxShell.appendLog(
        `[AUTOQ][UPLOAD_BUTTON_READY] reason=${why} found=1 disabled=${btn.disabled ? 1 : 0} `
        + `rect.width=${w} rect.height=${h} `
        + `topTag=${topEl ? topEl.tagName || '-' : '-'} topId=${topEl ? topEl.id || '-' : '-'} `
        + `blocked=${blocked ? 1 : 0}`,
      );

      if (zeroRect) {
        const isIntentionallyHidden = btn.classList.contains('cgpt-toolbox-hidden');
        if (!isIntentionallyHidden) {
          ToolboxShell.appendLog('[AUTOQ][UPLOAD_BUTTON_READY][WARN] reason=zero-rect');
        }
      }
    }

    function syncAutoQueueRootFromActionButton(btn) {
      if (!btn) {
        return false;
      }

      const moduleEl = btn.closest('#cgpt-autoq-module');
      if (!moduleEl || !moduleEl.isConnected) {
        return false;
      }

      if (moduleEl !== root) {
        root = moduleEl;
        refreshAutoQueueActionButtonRefs();
        ToolboxShell.appendLog('[AUTOQ][ROOT_RESYNC] reason=action-button-click');
      }

      return true;
    }

    function refreshAutoQueueActionButtonRefs() {
      if (!root) return;
      startBtn = qs('#cgpt-autoq-start', root);
      startUploadBtn = qs('#cgpt-autoq-start-upload', root);
    }

    function callBatchTaskStartFromButton(source) {
      try {
        ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][START_CALL_BEFORE] source=${source || '-'}`);
        start();
        state.batchStartupGuardUntilMs = Date.now() + BATCH_TASK_STARTUP_GUARD_MS;
        ToolboxShell.appendLog(
          `[BATCH_TASK_BUTTON][START_CALL_AFTER] source=${source || '-'} `
          + `running=${state.running ? 1 : 0} `
          + `phase=${state.phase || '-'} `
          + `batchTaskRunning=${state.batchTaskRunning ? 1 : 0}`,
        );
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        console.error('[BATCH_TASK_BUTTON][START_CALL_ERROR]', error);
        ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][START_CALL_ERROR] ${message}`);
        if (typeof ToolboxShell.setStatus === 'function') {
          ToolboxShell.setStatus('启动批量任务失败，请查看日志', 'error');
        }
        updateStatus('batch-start-error');
      }
    }

    function isBatchTaskStartupUploadPhase() {
      if (!state.running || !state.batchAutoUploading) {
        return false;
      }
      const step = state.taskRun && state.taskRun.currentStep
        ? String(state.taskRun.currentStep)
        : '';
      if (step === 'auto-upload-before-send') {
        return true;
      }
      return !state.waitingReply && Math.max(0, Number(state.sentCount) || 0) <= 0;
    }

    function cancelBatchStartupUploadFromStartButton(reason = 'start-button-toggle') {
      const cancelReason = String(reason || 'start-button-toggle');
      ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][CANCEL_STARTUP_UPLOAD] reason=${cancelReason}`);
      ToolboxShell.appendLog('[AUTOQ][TASK_AUTO_UPLOAD][CANCELLED_BY_START_BUTTON_TOGGLE]');
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.cancelUploadFlow === 'function'
      ) {
        try {
          UploadModule.cancelUploadFlow(`batch-cancel-startup-upload:${cancelReason}`);
        } catch (error) {
          const errText = error && error.stack ? error.stack : String(error);
          console.error('[AUTOQ][TASK_BATCH][CANCEL_STARTUP_UPLOAD_ERROR]', error);
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][CANCEL_STARTUP_UPLOAD_ERROR] ${errText}`);
        }
      }
      stop({
        reason: 'cancel-startup-upload',
        finalStep: 'stopped',
        markCurrent: true,
        logStop: true,
      });
    }

    function handleAutoQueueStartBatchButtonClick(source = 'unknown') {
      try {
        syncLegacyRunFlagsFromPhase();

        const phase = String(state.phase || AUTO_QUEUE_PHASES.IDLE);
        const active = state.running || AUTO_QUEUE_ACTIVE_PHASES.has(phase);
        const startupUpload = isBatchTaskStartupUploadPhase();

        if (active) {
          const alreadyStopping = !!(state.batchTask && state.batchTask.stopRequested);
          if (alreadyStopping) {
            ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][CLICK_${source}] action=force-stop`);
            forceStopTaskBatch('start-button-force-stop');
            return;
          }
          if (startupUpload) {
            ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][CLICK_${source}] action=cancel-startup-upload`);
            cancelBatchStartupUploadFromStartButton(`start-button-toggle:${source}`);
            return;
          }

          ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][CLICK_${source}] action=stop-with-final-upload`);
          void stopTaskBatchWithFinalUpload('start-button-toggle').catch((error) => {
            const errText = error && error.stack ? error.stack : String(error);
            console.error('[AUTOQ][TASK_BATCH][STOP_WITH_FINAL_UPLOAD_ERROR]', error);
            ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][STOP_WITH_FINAL_UPLOAD_ERROR] ${errText}`);
            forceStopTaskBatch('stop-with-final-upload-error');
          });
          return;
        }

        ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][CLICK_${source}] action=start`);
        logUploadBatchState(`batch-task-click-start-${source}`);
        callBatchTaskStartFromButton(source);
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        console.error('[BATCH_TASK_BUTTON][CLICK_HANDLER_ERROR]', error);
        ToolboxShell.appendLog(`[BATCH_TASK_BUTTON][CLICK_HANDLER_ERROR] source=${source || '-'} error=${message}`);
        if (typeof ToolboxShell.setStatus === 'function') {
          ToolboxShell.setStatus('启动批量任务失败，请查看日志', 'error');
        }
        updateStatus('batch-task-click-handler-error');
      }
    }

    function bindDirectAutoQueueActionButtons(reason = '') {
      refreshAutoQueueActionButtonRefs();

      const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;

      const bindDirect = (btn, action, handler) => {
        if (!btn) return;

        const bindKey = `autoqDirectBound${action.replace(/[^a-zA-Z0-9]/g, '')}`;
        if (btn.dataset[bindKey] === '1') {
          return;
        }

        btn.dataset[bindKey] = '1';

        btn.addEventListener('click', (event) => {
          if (event && event.autoqDelegatedHandled) {
            return;
          }

          if (event) {
            event.autoqDirectHandled = true;
            event.preventDefault();
            event.stopPropagation();
          }

          ToolboxShell.appendLog(
            `[AUTOQ][DIRECT_CLICK] action=${action} id=${btn.id || '-'} disabled=${btn.disabled ? 1 : 0} reason=${reason || '-'}`,
          );

          if (btn.disabled) {
            ToolboxShell.appendLog(`[AUTOQ][DIRECT_CLICK_BLOCKED] action=${action} reason=disabled`);
            return;
          }

          handler();
        }, true);
      };

      bindDirect(startBtn, 'start-batch', () => {
        handleAutoQueueStartBatchButtonClick('direct');
      });

      bindDirect(sendOnceBtn, 'send-once', () => {
        ToolboxShell.appendLog('[AUTOQ][SEND_ONCE][CLICK_DIRECT]');
        void triggerContinueOnce();
      });
    }

    function handleAutoQueueDelegatedClick(event) {
      if (event && event.autoqDelegatedHandled) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      ToolboxShell.appendLog(
        `[AUTOQ][DELEGATED_CLICK_ENTER] `
        + `target=${target ? target.tagName : '-'} `
        + `id=${target ? target.id || '-' : '-'} `
        + `class=${target ? String(target.className || '').slice(0, 80) : '-'}`,
      );

      if (!target) return;

      const uploadBtn = target.closest('#cgpt-autoq-start-upload');
      if (uploadBtn && syncAutoQueueRootFromActionButton(uploadBtn)) {
        if (event) {
          event.autoqDelegatedHandled = true;
          if (typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
          }
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
        }
        void runAutoQueueStartUploadFromButton(uploadBtn, 'root-delegated', event);
        return;
      }

      const batchBtn = target.closest('#cgpt-autoq-start');
      if (batchBtn && syncAutoQueueRootFromActionButton(batchBtn)) {
        event.autoqDelegatedHandled = true;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }

        handleAutoQueueStartBatchButtonClick('delegated');
        return;
      }

      const sendOnceBtn = target.closest('#cgpt-autoq-send-once');
      if (sendOnceBtn && syncAutoQueueRootFromActionButton(sendOnceBtn)) {
        event.autoqDelegatedHandled = true;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }

        ToolboxShell.appendLog('[AUTOQ][SEND_ONCE][CLICK_DELEGATED]');
        void triggerContinueOnce();
      }
    }

    function bindAutoQueueDelegatedActions(reason = '') {
      if (!root) {
        ToolboxShell.appendLog(`[AUTOQ][DELEGATED_BIND_SKIP] reason=${reason || 'root-missing'}`);
        return false;
      }

      if (delegatedBoundRoot !== root) {
        if (delegatedBoundRoot) {
          delegatedBoundRoot.removeEventListener('click', handleAutoQueueDelegatedClick, true);
        }
        root.addEventListener('click', handleAutoQueueDelegatedClick, true);
        root.dataset.autoqDelegatedActionsBound = '1';
        delegatedBoundRoot = root;
        ToolboxShell.appendLog(
          `[AUTOQ][DELEGATED_BIND_ROOT_OK] reason=${reason || '-'} `
          + `rootConnected=${root.isConnected ? 1 : 0}`,
        );
      }

      bindDirectAutoQueueActionButtons(reason || 'bind-delegated');
      return true;
    }

    function bindEvents() {
      bindAutoQueueDelegatedActions('bindEvents');
      refreshAutoQueueActionButtonRefs();

      if (root && root.dataset.autoqEventsBound === '1') {
        console.info('[AUTOQ][BIND_EVENTS][SKIP_ALREADY_BOUND]');
        return;
      }
      if (root) {
        root.dataset.autoqEventsBound = '1';
      }
      console.info('[AUTOQ][BIND_EVENTS][BOUND]');

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

      logAutoQueueActionButtonDomState('bindEvents');
    }

    function ensureAutoQueueStartUploadButton() {
      if (!root) {
        return null;
      }

      let btn = qs('#cgpt-autoq-start-upload', root);
      if (btn) {
        return syncAutoQueueStartUploadButtonMeta(btn);
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
      syncAutoQueueStartUploadButtonMeta(btn);
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
        bindAutoQueueDelegatedActions('mount');
        bindEvents();
        bindTaskPanelEvents();
        renderTaskProfiles();
        renderTaskList();
        renderTaskEditor();
        renderTaskProfileDefaults();
        ensureMainLiteStructure();
        updateStatus();
        logAutoQueueActionButtonDomState('mount-existed');
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
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-start-upload" data-action="start-upload" data-button-role="start-upload">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-start">${getAutoQueueStartIdleText()}</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">${getAutoQueueSendOnceIdleText()}</button>
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

      bindAutoQueueDelegatedActions('mount');
      bindEvents();
      bindTaskPanelEvents();
      ensureMainLiteStructure();
      updateStatus();
      logAutoQueueActionButtonDomState('mount-new');
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
      bindAutoQueueDelegatedActions('foreground-resume');
      updateStatus(`foreground-resume:${tag}`);
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }

      repairIllegalWaitingReplyPendingSendState('foreground-resume');

      ToolboxShell.appendLog(
        `[AUTOQ][VERIFY_STATE] foreground=1 running=${state.running ? 1 : 0} waitingReply=${state.waitingReply ? 1 : 0} pendingSendKind=${state.taskRun && state.taskRun.pendingSendKind ? state.taskRun.pendingSendKind : '-'}`,
      );
    }

    function clearAutoQueueMojibakeCache(reason = 'manual-clear-mojibake-cache') {
      const keys = [
        'autoQueueConfig',
        'autoqueueActiveSubtab',
      ];

      for (const key of keys) {
        const fullKey = `${APP.storagePrefix}${key}`;

        if (typeof GM_deleteValue === 'function') {
          GM_deleteValue(fullKey);
        }

        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(fullKey);
        }
      }

      ToolboxShell.appendLog(`[ENCODING][CACHE_CLEAR] reason=${reason} keys=${keys.join(',')}`);
    }

    return {
      mount,
      stop,
      clearAutoQueueMojibakeCache,
      stopAutoContinue: stop,
      toggleContinueLoopFromUpload,
      startContinueUntilDoneFromUpload,
      triggerContinueOnce,
      refreshProgressStatus,
      resumeAfterForeground,
      forceRecoverPendingSendProcessingStale: () => maybeRecoverPendingSendProcessingStale({ force: true }),
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
      isChatGPTActuallyBusyForTaskQueue,
      bindDelegatedActions: bindAutoQueueDelegatedActions,
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
