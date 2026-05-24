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
        config.listPromptsText = DEFAULT_AUTO_CONFIG.listPromptsText;
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
      if (typeof getDefaultContinuePromptText === 'function') {
        return getDefaultContinuePromptText();
      }
      return '继续';
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
          text: String(config.listPromptsText || DEFAULT_AUTO_CONFIG.listPromptsText),
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
      'next-task': '进入下一个任务',
      'all-done': '已完成',
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

    function setTaskBatchStep(step, task, options = {}) {
      const run = state.taskRun || {};
      run.currentStep = String(step || 'idle');
      if (options.log !== false) {
        const title = task ? task.title : (getCurrentRunningTask() ? getCurrentRunningTask().title : '-');
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][STEP] task=${title} step=${run.currentStep}`);
      }
      updateStatus();
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
          stopBatchOnTaskSendFailure: rawTaskQueue.stopBatchOnTaskSendFailure === true,
          defaultMaxContinueRoundsMigratedToUnlimited:
            rawTaskQueue.defaultMaxContinueRoundsMigratedToUnlimited === true,
          verifyAfterDoneSignal: rawTaskQueue.verifyAfterDoneSignal !== false,
          verifyAfterDoneSignalUploadFile: rawTaskQueue.verifyAfterDoneSignalUploadFile !== false,
          verifyAfterDoneSignalPrompt: String(
            rawTaskQueue.verifyAfterDoneSignalPrompt
            || taskQueueDefaults.verifyAfterDoneSignalPrompt
            || '',
          ),
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
        renderBatchModeSubTabs();
        renderBatchSubTabPanels();
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
        ToolboxShell.setStatus('已切换到批量任务组模式');
      } else {
        ToolboxShell.setStatus('已切换到继续模式');
      }
    }

    const state = {
      running: false,
      waitingReply: false,
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
      lastBackgroundThrottleLogAt: 0,
    };

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

    function renderBatchModeSubTabs() {
      if (!batchSubTabsEl) return;

      batchSubTabsEl.innerHTML = BATCH_SUB_TABS.map((tab) => {
        const active = tab.id === batchModeActiveSubTab ? ' active' : '';

        return `<button type="button" class="cgpt-autoq-batch-subtab${active}" data-batch-subtab="${tab.id}">${escapeHtml(tab.label)}</button>`;
      }).join('');
    }

    function renderBatchSubTabPanels() {
      if (!batchSubTabContentEl) return;

      qsa('[data-batch-tab-panel]', batchSubTabContentEl).forEach((panel) => {
        const tabId = panel.getAttribute('data-batch-tab-panel');
        const visible = tabId === batchModeActiveSubTab;

        panel.classList.toggle('cgpt-toolbox-hidden', !visible);
      });
    }

    function switchBatchSubTab(tabId) {
      const next = String(tabId || '').trim();

      if (!BATCH_SUB_TABS.some((item) => item.id === next)) {
        return;
      }

      if (batchModeActiveSubTab === 'current' || next === 'current') {
        readTaskEditorIntoSelected();
      }

      if (batchModeActiveSubTab === 'rules' || next === 'rules') {
        readTaskProfileDefaultsIntoActive();
      }

      batchModeActiveSubTab = next;
      renderBatchModeSubTabs();
      renderBatchSubTabPanels();

      if (next === 'current') {
        renderTaskEditor();
      } else if (next === 'rules') {
        renderTaskProfileDefaults();
      } else if (next === 'tasks') {
        renderTaskList();
      }
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
        const btn = e.target instanceof HTMLElement
          ? e.target.closest('[data-batch-subtab]')
          : null;

        if (!btn) return;

        switchBatchSubTab(btn.getAttribute('data-batch-subtab'));
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

    function formatTaskSourceMeta(task) {
      if (!task || task.sourceType !== 'prompt-manager') {
        return '';
      }

      if (task.promptId) {
        const result = findPromptForLinkedTask(task);
        const prompt = result.prompt;
        if (prompt) {
          const category = typeof PromptManagerModule.getPromptCategoryName === 'function'
            ? PromptManagerModule.getPromptCategoryName(prompt)
            : String(prompt.category || '默认');
          const relinkHint = result.relinked ? '（已重新关联）' : '';
          return `来源：Prompt 管理 / 分类：${category}${relinkHint}`;
        }
        return '来源：Prompt 管理 / 原 Prompt 已删除，使用快照';
      }

      return '来源：Prompt 管理';
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
      if (m === 'task') return '批量任务组模式';
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
      };
    }

    function getLastAssistantReplyText() {
      try {
        if (
          typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.buildRecords === 'function'
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
        ) {
          const records = ChatMessageExtractor.buildRecords({ includeEmpty: false });
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

          if (picked && picked.ok && picked.record) {
            const recordText = String(picked.record.text || '').trim();

            if (recordText) {
              return recordText;
            }
          }
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getLastAssistantReplyText extractor failed', err);
        log(`读取回复失败：${errText}`);
      }

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

    function isTaskDoneSignalMatched(replyText, doneSignal) {
      if (typeof analyzeDoneSignalText === 'function') {
        const result = analyzeDoneSignalText(replyText, { doneSignal });
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

      const signal = String(doneSignal || TASK_DONE_SIGNAL).trim();
      if (typeof hasAssistantDoneSignalInText === 'function') {
        return {
          matched: hasAssistantDoneSignalInText(replyText, { doneSignal: signal }),
          corrupted: false,
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

    function getCurrentRunningTask() {
      const run = state.taskRun || {};
      const profile = getActiveTaskProfile();

      if (!profile || !Array.isArray(run.enabledTaskIds) || run.currentIndex < 0) {
        return null;
      }

      const taskId = run.enabledTaskIds[run.currentIndex];

      return profile.tasks.find((item) => item.id === taskId) || null;
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

    function moveToNextTask() {
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

      run.currentIndex = nextIndex;
      run.pendingSendKind = 'initial';
      const nextTask = getCurrentRunningTask();
      setTaskBatchStep('send-initial', nextTask);
      state.nextSendAt = Date.now() + getRandomDelayMs();
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

    function handleTaskInitialSendFailure(reason) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');
      const taskName = task ? task.title : '-';
      const taskId = task ? task.id : '-';

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

      if (shouldStopBatchOnTaskSendFailure()) {
        ToolboxShell.setStatus(`批量任务组已停止：${reasonText}`);
        stop({ reason: reasonText, finalStep: 'stopped', markCurrent: false, logStop: false });
        return;
      }

      ToolboxShell.setStatus(`任务发送失败，继续下一个：${reasonText}`);
      if (!moveToNextTask()) {
        ToolboxShell.setStatus('批量任务组：无可继续的任务');
      }
    }

    function failCurrentTask(reason) {
      const task = getCurrentRunningTask();
      const reasonText = String(reason || 'failed');

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
      stop({ reason: reasonText, finalStep: 'stopped', markCurrent: false, logStop: false });
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

      state.taskRun.doneSignalVerificationRunning = true;
      state.taskRun.pendingSendKind = 'verification';

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
          state.taskRun.doneSignalVerificationRunning = false;
          failCurrentTask(reason);
          return { ok: false, reason };
        }

        setTaskBatchStep('verify-upload-file', task);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_START] task=${task.title}`);

        state.uploadingFromAutoQueue = true;
        updateStatus('verify-upload-start');

        const uploadResult = await UploadModule.startUploadFromCurrentQueue({
          source: `autoq-task-verify-${task.id}`,
          shouldStop: () => !state.running,
        });

        state.uploadingFromAutoQueue = false;
        updateStatus('verify-upload-done');

        const uploadedCount = Number(uploadResult && uploadResult.uploadedCount) || 0;
        const failedCount = Number(uploadResult && uploadResult.failedCount) || 0;
        const uploadReason = String(uploadResult && uploadResult.reason || '').trim();

        if (!uploadResult || uploadResult.ok !== true) {
          const reason = uploadReason || 'verify-upload-failed';
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][VERIFY_UPLOAD_FAILED] task=${task.title} uploaded=${uploadedCount} failed=${failedCount} reason=${reason}`,
          );
          state.taskRun.doneSignalVerificationRunning = false;
          failCurrentTask(reason);
          return { ok: false, reason };
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

      const sendResult = await sendTaskPrompt(
        verifyPrompt,
        '[AUTOQ][TASK_BATCH][VERIFY_SEND_PROMPT]',
      );

      if (!sendResult || sendResult.ok !== true) {
        const reason = String((sendResult && sendResult.reason) || 'verify-send-failed');
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][VERIFY_SEND_FAILED] task=${task.title} reason=${reason}`);
        state.taskRun.doneSignalVerificationRunning = false;
        failCurrentTask(reason);
        return { ok: false, reason };
      }

      setTaskBatchStep('verify-wait-reply', task);
      state.waitingReply = true;
      updateStatus('verify-wait-reply');

      return { ok: true };
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
          state.taskRun.pendingSendKind = 'initial';
          setTaskBatchStep('next-task', task, { log: false });
          moveToNextTask();
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
            state.taskRun.pendingSendKind = 'initial';
            setTaskBatchStep('next-task', task, { log: false });
            moveToNextTask();
            return;
          }

          if (!result || !result.ok) {
            failCurrentTask(failReason || 'verify-continue-failed');
            return;
          }

          state.waitingReply = true;
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
        state.taskRun.pendingSendKind = 'initial';
        setTaskBatchStep('next-task', task, { log: false });
        moveToNextTask();
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
          state.taskRun.pendingSendKind = 'initial';
          setTaskBatchStep('next-task', task, { log: false });
          moveToNextTask();
          return;
        }

        if (!result.ok) {
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][FAILED] task=${task.title} reason=${failReason || 'copy-hotkey-continue-failed'}`);
          failCurrentTask(failReason || 'copy-hotkey-continue-failed');
          return;
        }

        if (result.continueSent) {
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

    function getPromptsTextByMode(mode) {
      if (mode === 'continue') {
        const stored = String(config.continuePromptsText || '').trim();
        return stored || getDefaultContinuePromptTextForUi();
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
          button.textContent = '再次点击删除';
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
        button.textContent = '删除列表';
      }

      renderListProfiles();
      saveConfig();
      updateStatus();

      ToolboxShell.setStatus(`已删除列表：${deletedName}`);
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
        const statusText = String(task.status || 'pending');
        const resolved = resolveTaskContinueSettings(task, profile);
        const maxRounds = normalizeContinueRoundLimit(
          resolved.actualMaxContinueRounds,
          UNLIMITED_CONTINUE_ROUNDS,
        );
        const maxRoundsText = formatContinueRoundLimit(maxRounds);
        const sourceMeta = formatTaskSourceMeta(task);

        return `
      <div class="cgpt-autoq-task-item${selected}" data-task-id="${escapeHtml(task.id)}">
        <div class="cgpt-autoq-task-item-main">
          <span class="cgpt-autoq-task-item-title">${escapeHtml(task.title)}${escapeHtml(enabledMark)}</span>
          <span class="cgpt-autoq-task-item-meta">${escapeHtml(statusText)} · 继续 ${Number(task.continueCount) || 0}/${maxRoundsText}</span>
          ${sourceMeta ? `<span class="cgpt-autoq-task-item-source">${escapeHtml(sourceMeta)}</span>` : ''}
        </div>
        <div class="cgpt-autoq-task-item-actions">
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

        if (titleEl) task.title = String(titleEl.value || '').trim() || '未命名任务';
        if (initialEl) task.initialPrompt = String(initialEl.value || '');
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
      const isPromptTask = task.sourceType === 'prompt-manager' && task.promptId;
      const initialFieldValue = isPromptTask
        ? resolvedInitial.initialPrompt
        : task.initialPrompt;
      const initialReadonly = isPromptTask ? ' readonly' : '';

      taskEditorEl.innerHTML = `
        <div class="cgpt-autoq-task-editor-grid">
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label for="cgpt-autoq-task-title">任务名称</label>
            <input class="cgpt-input" id="cgpt-autoq-task-title" value="${escapeHtml(resolvedInitial.title || task.title)}">
          </div>
          <div class="cgpt-kv cgpt-autoq-task-editor-full">
            <label for="cgpt-autoq-task-initial">初始指令${isPromptTask ? '（来自 Prompt 管理，运行前自动同步）' : ''}</label>
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
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-save">保存任务</button>
        </div>`;

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
      if (status === 'no-files') {
        return '无文件';
      }
      return '未上传';
    }

    async function handleAutoQueueStartUpload() {
      if (state.uploadingFromAutoQueue) {
        return;
      }
      if (state.running && config.promptMode === 'task') {
        return;
      }

      if (
        typeof UploadModule === 'undefined'
        || typeof UploadModule.startUploadFromCurrentQueue !== 'function'
      ) {
        const reason = 'UploadModule.startUploadFromCurrentQueue 不存在';
        console.error('[AUTOQ][UPLOAD][FAILED]', reason);
        log(`[AUTOQ][UPLOAD][FAILED] reason=${reason}`);
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
      log('[AUTOQ][UPLOAD][START]');

      try {
        const result = await UploadModule.startUploadFromCurrentQueue({
          source: 'autoqueue-start-upload-button',
          shouldStop: () => !state.running && !state.uploadingFromAutoQueue,
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
          log('[AUTOQ][UPLOAD][NO_FILES]');
          state.autoQueueUploadStatus = 'no-files';
        } else if (reason === 'cancelled' || (result && result.cancelled)) {
          log('[AUTOQ][UPLOAD][CANCELLED]');
          state.autoQueueUploadStatus = 'idle';
        } else if (result && result.ok) {
          log(`[AUTOQ][UPLOAD][DONE] uploaded=${uploadedCount} failed=${failedCount} skipped=${skippedCount}`);
          state.autoQueueUploadStatus = 'done';
        } else {
          log(`[AUTOQ][UPLOAD][FAILED] reason=${reason || 'upload-failed'}`);
          state.autoQueueUploadStatus = 'failed';
        }
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[AUTOQ][UPLOAD][FAILED]', error);
        log(`[AUTOQ][UPLOAD][FAILED] reason=${errText}`);
        state.autoQueueUploadStatus = 'failed';
        state.autoQueueUploadStats = {
          uploaded: 0,
          failed: 0,
          skipped: 0,
          reason: errText,
        };
      } finally {
        state.uploadingFromAutoQueue = false;
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

      return {
        continueCount,
        maxText,
        maxRaw,
        display: `${continueCount}/${maxText}`,
      };
    }

    function buildProgressStatusSnapshot() {
      const taskMode = config.promptMode === 'task';
      const taskInfo = taskMode ? getCurrentTaskRunInfo() : null;
      const taskProgress = taskInfo && taskInfo.total
        ? `${Math.min(taskInfo.doneCount, taskInfo.total)}/${taskInfo.total}`
        : '-';
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
      const taskStepText = taskMode ? getTaskRunStepLabel(taskStepKey) : '-';

      return {
        taskMode,
        taskInfo,
        taskProgress,
        pageTurn,
        pageTurnText,
        continueStatus,
        taskStepKey,
        taskStepText,
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
        ? Math.min(snapshot.taskInfo.doneCount, snapshot.taskInfo.total)
        : 0;
      const taskTotal = snapshot.taskInfo ? snapshot.taskInfo.total : 0;
      const maxContinueLog = isUnlimitedMaxContinueRounds(snapshot.continueStatus.maxRaw)
        ? 'unlimited'
        : String(snapshot.continueStatus.maxRaw);

      console.log(
        `[AUTOQ][PROGRESS_STATUS] task_index=${taskIndex} task_total=${taskTotal} page_turn=${snapshot.pageTurn === null ? '-' : snapshot.pageTurn} continue_round=${snapshot.continueStatus.continueCount} max_continue=${maxContinueLog} step=${snapshot.taskStepText}${reason ? ` reason=${reason}` : ''}`,
      );
    }

    function updateStatus(refreshReason = '') {
      const running = !!state.running;
      const modeText = getModeDisplayText(config.promptMode);
      const listName = config.promptMode === 'list' ? getActiveListProfileName() : '';
      const progressSnapshot = buildProgressStatusSnapshot();
      logAutoqProgressStatusIfChanged(progressSnapshot, refreshReason);

      const taskInfo = progressSnapshot.taskInfo;
      const taskProgress = progressSnapshot.taskProgress;
      const pageTurnText = progressSnapshot.pageTurnText;
      const continueDisplay = progressSnapshot.continueStatus.display;
      const taskName = taskInfo && taskInfo.currentTask
        ? taskInfo.currentTask.title
        : (taskInfo && taskInfo.total ? '（等待）' : '-');
      const taskStepText = progressSnapshot.taskStepText;
      const runStateText = running
        ? (state.waitingReply ? '等待回复' : '发送中')
        : '已停止';
      const uploadStatusText = getAutoQueueUploadStatusText();
      const uploading = !!state.uploadingFromAutoQueue;

      const liteHtml = config.promptMode === 'task'
        ? `
    <div class="cgpt-autoq-status-grid cgpt-autoq-main-lite-grid">
      <div>模式：${escapeHtml(modeText)}</div>
      <div>任务进度：${escapeHtml(taskProgress)}</div>
      <div>任务：${escapeHtml(taskName)}</div>
      <div>页面轮次：${escapeHtml(pageTurnText)}</div>
      <div>状态：${escapeHtml(runStateText)}</div>
      <div>当前任务继续：${escapeHtml(continueDisplay)}</div>
      <div>上传状态：${escapeHtml(uploadStatusText)}</div>
      <div>当前步骤：${escapeHtml(taskStepText)}</div>
    </div>`
        : `
    <div class="cgpt-autoq-status-grid cgpt-autoq-main-lite-grid">
      <div>模式：${escapeHtml(modeText)}</div>
      <div>页面轮次：${escapeHtml(pageTurnText)}</div>
      <div>列表：${escapeHtml(listName || '-')}</div>
      <div>当前任务继续：-</div>
      <div>状态：${escapeHtml(running ? '运行中' : '已停止')}</div>
      <div>当前步骤：-</div>
    </div>`;

      if (mainLiteEl) {
        mainLiteEl.innerHTML = liteHtml;
      }

      if (startBtn) {
        startBtn.disabled = running || uploading;
        if (config.promptMode === 'task') {
          startBtn.textContent = running ? '批量任务组运行中' : '开始批量任务组';
        } else {
          startBtn.textContent = running ? '运行中' : '开始';
        }
      }

      if (startUploadBtn) {
        startUploadBtn.classList.toggle('cgpt-toolbox-hidden', config.promptMode !== 'task');
        startUploadBtn.disabled = running || uploading;
        startUploadBtn.textContent = uploading ? '上传中...' : '开始上传';
      }

      if (stopBtn) {
        stopBtn.disabled = !running;
        if (config.promptMode === 'task') {
          stopBtn.textContent = '停止批量任务组';
        } else {
          stopBtn.textContent = '停止';
        }
      }

      const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;
      if (sendOnceBtn) {
        sendOnceBtn.textContent = config.promptMode === 'task'
          ? '只发送初始指令一次'
          : '发送一次';
      }
    }

    function prepareQueue() {
      readPanelConfig(config.promptMode);

      if (config.promptMode === 'task') {
        return prepareTaskQueue();
      }

      const text = getPromptsTextByMode(config.promptMode);
      const prompts = splitPrompts(text);

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
      if (!prepareQueue()) return;

      state.running = true;

      if (config.promptMode === 'task') {
        const run = state.taskRun || {};
        const total = Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0;
        const profile = getActiveTaskProfile();
        const task = getCurrentRunningTask();
        log(`开始运行批量任务组，共 ${total} 条`);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][START] total=${total}`);
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH_START_CLICK] mode=task group_id=${profile ? profile.id : '-'} `
          + `task_id=${task ? task.id : '-'} task_title=${task ? task.title : '-'}`,
        );
        ToolboxShell.setStatus('批量任务组模式已启动');
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

      state.running = false;
      state.waitingReply = false;
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

          if (config.promptMode === 'task') {
            void handleTaskReplyReady();
          } else {
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
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;

        if (config.promptMode === 'task') {
          void handleTaskReplyReady();
        } else {
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

      const okSet = typeof ComposerApi.setComposerValue === 'function'
        && ComposerApi.setComposerValue(text);
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
      const maxDisabledWaitMs = Math.max(
        intervalMs,
        Number(options.maxDisabledWaitMs || BATCH_SEND_BUTTON_WAIT_MS),
      );
      const startedAt = Date.now();

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState();
          if (responseState.is_responding) {
            return { ok: false, reason: 'assistant_busy', wait: true };
          }
        }

        const sendBtn = typeof ComposerApi.findSendButton === 'function'
          ? ComposerApi.findSendButton({ silent: true })
          : null;
        const composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasComposerText = !!composerText;
        const found = sendBtn ? 1 : 0;
        let disabledFlag = '-';
        let buttonReady = false;

        if (sendBtn) {
          if (typeof ComposerApi.isSendButtonReady === 'function') {
            buttonReady = ComposerApi.isSendButtonReady(sendBtn);
            disabledFlag = buttonReady ? 0 : 1;
          } else {
            disabledFlag = sendBtn.disabled ? 1 : 0;
            buttonReady = !sendBtn.disabled;
          }
        }

        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} found=${found} disabled=${disabledFlag} `
          + `hasText=${hasComposerText ? 1 : 0}`,
        );

        if (sendBtn && buttonReady) {
          return { ok: true, reason: 'send_button_ready' };
        }

        if (
          allowDisabledWithText
          && sendBtn
          && hasComposerText
          && Date.now() - startedAt >= maxDisabledWaitMs
        ) {
          return {
            ok: true,
            reason: 'send_button_disabled_use_enter_fallback',
            useEnterFallback: true,
          };
        }

        if (!sendBtn && Date.now() - startedAt >= maxDisabledWaitMs) {
          break;
        }

        await sleepMs(intervalMs);
      }

      if (allowDisabledWithText) {
        const composerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        if (composerText) {
          return {
            ok: true,
            reason: 'send_button_missing_use_enter_fallback',
            useEnterFallback: true,
          };
        }
      }

      return { ok: false, reason: 'send_button_not_found' };
    }

    async function sendBatchTextViaUnifiedPipeline(text, sourceTag) {
      const prompt = String(text || '').trim();
      const source = String(sourceTag || 'batch-task-group-initial-instruction');
      const { taskName, taskId } = getBatchSendTaskMeta();

      if (!prompt) {
        return { ok: false, reason: 'empty-prompt' };
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
          return { ok: false, reason: 'composer_not_ready' };
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
        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH][TEXT_SYNC_FAILED] reason=${lastSyncReason} prompt_len=${prompt.length} `
          + `retries=${BATCH_COMPOSER_SYNC_MAX_RETRIES} task=${taskName}`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][SEND_GIVE_UP] phase=composer_sync task=${taskName} taskId=${taskId} reason=${lastSyncReason}`,
        );
        return { ok: false, reason: lastSyncReason, retriesExhausted: true };
      }

      setTaskBatchStep('send-initial', getCurrentRunningTask(), { log: false });
      ToolboxShell.setStatus('正在发送初始指令…');
      ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');

      const buttonWait = await waitBatchSendButtonReady(source, {
        maxAttempts: 12,
        intervalMs: 250,
        allowDisabledWithText: true,
        maxDisabledWaitMs: BATCH_SEND_BUTTON_WAIT_MS,
      });

      if (!buttonWait.ok) {
        if (buttonWait.wait) {
          return { ok: false, reason: 'assistant_busy', wait: true };
        }
        const failReason = buttonWait.reason || 'send_button_not_found';
        ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${failReason}`);
        return { ok: false, reason: failReason };
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
        shouldStop: () => !state.running,
      });

      ToolboxShell.appendLog(
        `[AUTOQ][SEND_VERIFY] task=${taskName} ok=${sendResult && sendResult.ok ? 1 : 0} `
        + `reason=${sendResult && sendResult.reason ? sendResult.reason : 'unknown'}`,
      );

      if (sendResult && sendResult.ok) {
        ToolboxShell.appendLog(`[AUTOQ][SEND_SUCCESS] task=${taskName} method=${sendResult.reason || '-'}`);
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');
        return sendResult;
      }

      const reason = String((sendResult && sendResult.reason) || 'unknown');
      ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);
      ToolboxShell.appendLog(
        `[AUTOQ][SEND_GIVE_UP] phase=send task=${taskName} taskId=${taskId} reason=${reason}`,
      );
      return sendResult || { ok: false, reason };
    }

    async function sendTaskPrompt(content, logTag) {
      const prompt = String(content || '').trim();
      const source = 'batch-task-group-initial-instruction';

      if (!prompt) {
        log('任务指令为空，跳过发送');
        return { ok: false, reason: 'empty-prompt' };
      }

      const run = state.taskRun || {};
      run.pendingSendKind = 'processing';
      state.sendingNow = true;

      try {
        const sendResult = await sendBatchTextViaUnifiedPipeline(prompt, source);

        if (sendResult && sendResult.wait && sendResult.reason === 'assistant_busy') {
          run.pendingSendKind = 'initial';
          setTaskBatchStep('wait-current-reply', getCurrentRunningTask(), { log: false });
          log('ChatGPT 正在回答，等待结束后再发送初始指令');
          return sendResult;
        }

        if (!sendResult || sendResult.ok !== true) {
          const reason = String((sendResult && sendResult.reason) || 'unknown');
          run.pendingSendKind = 'initial';
          const failLabel = reason === 'send_button_not_found'
            ? '发送失败：找不到可用发送按钮'
            : `发送失败：${reason}`;
          log(failLabel);
          ToolboxShell.appendLog(`${logTag} failed reason=${reason}`);
          ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);
          return sendResult || { ok: false, reason };
        }

        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_SEND_DONE]');
        ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_WAIT_REPLY_START]');
        state.batchInitialWaitLoggedAt = 0;

        state.sentCount += 1;
        state.waitingReply = true;
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
        run.pendingSendKind = 'initial';
        setTaskBatchStep('send-initial-failed', getCurrentRunningTask(), { log: false });
        log(`发送异常：${errText}`);
        ToolboxShell.setStatus(`发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`${logTag} error=${errText}`);
        ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${errText}`);
        return { ok: false, reason: errText };
      } finally {
        state.sendingNow = false;
        if (run.pendingSendKind === 'processing') {
          run.pendingSendKind = 'initial';
        }
      }
    }

    function maybeSendNextTask() {
      if (!state.running || state.waitingReply) return;
      if (guardAutoQueueBackgroundThrottle('send-next-task')) {
        return;
      }
      if (state.taskBatchStepRunning) return;
      if (Date.now() < state.nextSendAt) return;
      if (state.sendingNow) return;

      const run = state.taskRun || {};
      if (run.pendingSendKind === 'processing') return;

      if (ComposerApi.isAssistantLikelyBusy()) {
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
        if (!moveToNextTask()) {
          return;
        }
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
          moveToNextTask();
          return;
        }

        if (!initial) {
          log(`任务「${currentTask.title}」缺少初始指令，跳过`);
          markTaskStatus(currentTask, 'skipped');
          moveToNextTask();
          return;
        }

        if (resolvedInitial.title && resolvedInitial.title !== currentTask.title) {
          currentTask.title = resolvedInitial.title;
        }

        ToolboxShell.appendLog(
          `[AUTO_QUEUE][BATCH_INITIAL_PROMPT_PICKED] text_len=${initial.length} task_title=${currentTask.title}`,
        );

        void sendTaskPrompt(initial, '[AUTOQ][TASK_BATCH][SEND_INITIAL]').then((sendResult) => {
          if (sendResult && sendResult.wait) {
            return;
          }

          if (!sendResult || sendResult.ok !== true) {
            const reason = String((sendResult && sendResult.reason) || 'unknown');
            const runState = state.taskRun || {};
            runState.pendingSendKind = 'initial';
            ToolboxShell.appendLog(
              `[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} reason=${reason}`,
            );
            ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${reason}`);
            log(`批量任务组初始指令发送失败：${reason}`);
            handleTaskInitialSendFailure(reason);
            return;
          }

          ToolboxShell.appendLog(`[AUTOQ][TASK][SEND_INITIAL] task=${currentTask.title}`);
        }).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] [AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial', {
            error_type: err && err.name ? err.name : 'Error',
            error: errText,
            stack: err && err.stack ? err.stack : '',
          });
          const runState = state.taskRun || {};
          runState.pendingSendKind = 'initial';
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} reason=${errText}`,
          );
          ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${errText}`);
          handleTaskInitialSendFailure(errText);
        });
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

      void sendContentViaComposer({
        source: 'auto-queue',
        content: prompt,
        allowReplaceDraft: true,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
      }).then((sendResult) => {
        if (!sendResult.ok) {
          log(`发送失败：${sendResult.reason || 'unknown'}`);
          return;
        }

        state.sentCount += 1;
        state.waitingReply = true;
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

    async function triggerContinueOnce() {
      readPanelConfig();

      if (config.promptMode === 'task') {
        return sendTaskInitialOnce();
      }

      const prompts = splitPrompts(getPromptsTextByMode(config.promptMode));
      const prompt = prompts[0] || '继续';

      if (!ComposerApi.setComposerValue(prompt)) {
        log('写入输入框失败');
        return false;
      }

      return new Promise((resolve) => {
        window.setTimeout(() => {
          if (ComposerApi.clickSend()) {
            log(`手动发送：${prompt.slice(0, 80)}`);
            resolve(true);
          } else {
            log('手动发送失败');
            resolve(false);
          }
        }, 200);
      });
    }

    function bindEvents() {
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
          start();
        }, 'autoq-start');
      }

      if (startUploadBtn) {
        bindOnce(startUploadBtn, 'click', () => {
          void handleAutoQueueStartUpload();
        });
      }

      if (stopBtn) {
        bindOnce(stopBtn, 'click', () => {
          stop({ reason: 'manual', finalStep: 'stopped' });
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
      btn.className = 'cgpt-btn success';
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
        renderTaskPanelVisibility();
        syncBatchSubTabRefs();
        refreshBatchTaskPanelRefs();
        bindEvents();
        bindTaskPanelEvents();
        renderTaskProfiles();
        renderTaskList();
        renderTaskEditor();
        renderTaskProfileDefaults();
        updateStatus();
        return;
      }

      normalizeAutoConfig(config);
      const uiModeSettings = getModeSettings(config.promptMode);

      root = document.createElement('div');
      root.id = 'cgpt-autoq-module';
      root.innerHTML = `
        <div class="cgpt-section cgpt-autoq-section">
          <div class="cgpt-section-title">自动指令队列</div>

          <div class="cgpt-autoq-mode-tabs">
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'continue' ? ' active' : ''}" data-autoq-mode="continue">继续模式</button>
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'list' ? ' active' : ''}" data-autoq-mode="list">列表模式</button>
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'task' ? ' active' : ''}" data-autoq-mode="task">批量任务组模式</button>
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
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-delete">删除列表</button>
            </div>
          </div>

          <div class="cgpt-autoq-task-panel${config.promptMode === 'task' ? '' : ' cgpt-toolbox-hidden'}" id="cgpt-autoq-task-panel">
            <div class="cgpt-autoq-batch-subtabs" id="cgpt-autoq-batch-subtabs"></div>
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
            <button type="button" class="cgpt-btn success" id="cgpt-autoq-start-upload">开始上传</button>
            <button type="button" class="cgpt-btn success" id="cgpt-autoq-start">开始</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">发送一次</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-autoq-stop" disabled>停止</button>
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

      if (!state.running && !state.waitingReply) {
        return;
      }

      state.lastBackgroundThrottleLogAt = 0;
      ensureTicker();
      updateStatus(`foreground-resume:${tag}`);
      if (typeof updateChatInputStateBadge === 'function') {
        updateChatInputStateBadge();
      }
      tick();
    }

    return {
      mount,
      stop,
      stopAutoContinue: stop,
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
      getState: () => Object.assign({}, state, {
        queue: state.queue.slice(),
      }),
      applyConfig,
      addPromptBatchTask,
      removePromptBatchTask,
      isPromptBatchTaskSelected,
      resolveTaskInitialPrompt,
      refreshPromptLinkedTasks,
      onPromptManagerChanged: refreshPromptLinkedTasks,
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
