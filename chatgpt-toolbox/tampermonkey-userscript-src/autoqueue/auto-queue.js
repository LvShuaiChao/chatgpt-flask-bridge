  /********************************************************************
   * 4. AutoQueueModule：自动指令队列模块
   ********************************************************************/

const AutoQueueModule = (() => {
    const config = Object.assign(
      createDefaultAutoConfig(),
      MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, null) || {},
    );

    function createNumberInput(options = {}) {
      const input = document.createElement('input');
      input.type = 'number';
      input.setAttribute('data-no-wheel-number', '1');

      if (options.value !== undefined) input.value = String(options.value);
      if (options.min !== undefined) input.min = String(options.min);
      if (options.max !== undefined) input.max = String(options.max);
      if (options.step !== undefined) input.step = String(options.step);
      if (options.placeholder) input.placeholder = options.placeholder;
      if (options.className) input.className = options.className;
      if (options.id) input.id = options.id;

      input.addEventListener('wheel', (event) => {
        event.preventDefault();
        if (document.activeElement === input) {
          input.blur();
        }
      }, { passive: false });

      return input;
    }

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
        if (
          typeof PromptManagerModule !== 'undefined'
          && typeof PromptManagerModule.getPromptById === 'function'
        ) {
          const prompt = PromptManagerModule.getPromptById(task.promptId);

          if (prompt) {
            if (shouldLog) {
              ToolboxShell.appendLog(
                `[AUTOQ][PROMPT_TASK][RESOLVE] promptId=${task.promptId} title=${prompt.title}`,
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
      }

      return {
        title: task ? String(task.title || '未命名任务') : '',
        initialPrompt: task ? String(task.initialPrompt || '') : '',
      };
    }

    const TASK_RUN_STEP_LABELS = Object.freeze({
      idle: '待开始',
      'send-initial': '发送初始指令',
      'wait-reply': '等待回复完成',
      'check-done-signal': '检查终止信号',
      'copy-last-reply': '复制最后回复',
      'send-hotkey': '发送 Ctrl+Alt+I',
      'send-continue': '发送继续指令',
      'wait-next-reply': '等待下一轮回复',
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
        profile && (profile.continuePromptTemplate || profile.defaultContinuePrompt) || '',
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
        config.taskQueueSettings = {
          stopOnMaxContinueRounds: config.taskQueueSettings.stopOnMaxContinueRounds !== false,
          defaultMaxContinueRoundsMigratedToUnlimited:
            config.taskQueueSettings.defaultMaxContinueRoundsMigratedToUnlimited === true,
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
        currentStep: 'idle',
      },
      taskBatchStepRunning: false,
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
            <div class="cgpt-autoq-batch-actions-slot" id="cgpt-autoq-batch-actions-slot"></div>
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
      const actionsSlot = qs('#cgpt-autoq-batch-actions-slot', root);
      const settingsSlot = qs('#cgpt-autoq-batch-settings-slot', root);

      if (actionsEl && actionsSlot && actionsEl.parentElement !== actionsSlot) {
        if (!batchUiRestore.actionsParent) {
          batchUiRestore.actionsParent = actionsEl.parentElement;
          batchUiRestore.actionsNext = actionsEl.nextSibling;
        }

        actionsSlot.appendChild(actionsEl);
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

      const actionsEl = qs('.cgpt-autoq-actions', root);
      const settingsEl = qs('.cgpt-autoq-settings-section', root);

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

    function renderBatchTaskGroupMode() {
      if (config.promptMode !== 'task') return;

      ensureBatchSubTabShell();
      renderBatchModeSubTabs();
      renderBatchSubTabPanels();
      reparentBatchModeUiBlocks();
      renderBatchTaskGroupContent();
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
        bindOnce(pickPromptsBtn, 'click', () => {
          openPromptPickerModal();
        }, 'autoq-task-pick-prompts');
      }

      const importPromptsTopBtn = qs('#cgpt-autoq-task-import-prompts-top', root);
      if (importPromptsTopBtn) {
        bindOnce(importPromptsTopBtn, 'click', () => {
          openPromptPickerModal();
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

      if (
        task.promptId
        && typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPromptById === 'function'
      ) {
        const prompt = PromptManagerModule.getPromptById(task.promptId);
        if (prompt) {
          const category = typeof PromptManagerModule.getPromptCategoryName === 'function'
            ? PromptManagerModule.getPromptCategoryName(prompt)
            : String(prompt.category || '默认');
          return `来源：Prompt 管理 / 分类：${category}`;
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

    function ensurePromptPickerOverlay() {
      if (promptPickerOverlay) {
        return promptPickerOverlay;
      }

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
      return promptPickerOverlay;
    }

    function openPromptPickerModal() {
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
      const line = `[${nowTimeText()}] ${String(text || '')}`;
      const modeSettings = getModeSettings(config.promptMode);

      if (logEl) {
        logEl.textContent = `${line}\n${logEl.textContent || ''}`.slice(0, 6000);

        if (modeSettings.logPinned) {
          logEl.scrollTop = 0;
        }

        if (modeSettings.autoScrollPanel && root) {
          const page = root.closest('.cgpt-toolbox-page');

          if (page) {
            page.scrollTop = page.scrollHeight;
          }
        }
      }

      ToolboxShell.appendLog(`[自动指令] ${text}`);
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
        profile.continuePromptTemplate
        || profile.defaultContinuePrompt
        || BATCH_CONTINUE_TEMPLATE,
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
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="up" data-task-id="${escapeHtml(task.id)}" ${index === 0 ? 'disabled' : ''}>上移</button>
          <button type="button" class="cgpt-toolbox-small-btn" data-task-action="down" data-task-id="${escapeHtml(task.id)}" ${index === profile.tasks.length - 1 ? 'disabled' : ''}>下移</button>
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

      const hasContinueOverride = String(task.continuePromptTemplate || task.continuePrompt || '').trim().length > 0;
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
                <textarea class="cgpt-textarea" id="cgpt-autoq-task-continue" rows="4">${escapeHtml(task.continuePromptTemplate || task.continuePrompt || '')}</textarea>
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

    function moveTaskById(taskId, direction) {
      const profile = getActiveTaskProfile();

      if (!profile) return;

      const index = profile.tasks.findIndex((item) => item.id === taskId);

      if (index < 0) return;

      const nextIndex = direction === 'up' ? index - 1 : index + 1;

      if (nextIndex < 0 || nextIndex >= profile.tasks.length) return;

      const copy = profile.tasks.slice();
      const tmp = copy[index];
      copy[index] = copy[nextIndex];
      copy[nextIndex] = tmp;
      profile.tasks = copy;
      profile.updatedAt = nowMs();
      renderTaskList();
      saveConfig();
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

      if (action === 'up') {
        moveTaskById(taskId, 'up');
        return;
      }

      if (action === 'down') {
        moveTaskById(taskId, 'down');
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

      const recentLog = logEl
        ? String(logEl.textContent || '').split('\n').map((x) => x.trim()).find(Boolean) || ''
        : '';

      if (mainLiteEl) {
        mainLiteEl.innerHTML = `${liteHtml}
    <div class="cgpt-autoq-status-recent" title="${escapeHtml(recentLog)}">最近：${escapeHtml(recentLog || '-')}</div>`;
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
        log(`开始运行批量任务组，共 ${total} 条`);
        ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][START] total=${total}`);
        ToolboxShell.setStatus('批量任务组模式已启动');
      } else {
        log(`开始运行，队列 ${state.queue.length} 条`);
        ToolboxShell.setStatus('自动指令队列已开启');
      }

      ensureTicker();
      updateStatus('batch-start');
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
      if (state.taskRun) {
        state.taskRun.pendingSendKind = null;
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

    function maybeUpdateWaitingState() {
      if (!state.waitingReply) return;

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

    function sendTaskPrompt(content, logTag) {
      const prompt = String(content || '').trim();

      if (!prompt) {
        log('任务指令为空，跳过发送');
        return Promise.resolve({ ok: false, reason: 'empty-prompt' });
      }

      state.sendingNow = true;

      return sendContentViaComposer({
        source: 'auto-queue-task',
        content: prompt,
        allowReplaceDraft: true,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
      }).then((sendResult) => {
        if (!sendResult.ok) {
          log(`发送失败：${sendResult.reason || 'unknown'}`);
          ToolboxShell.appendLog(`${logTag} failed reason=${sendResult.reason || 'unknown'}`);
          return sendResult;
        }

        state.sentCount += 1;
        state.waitingReply = true;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = Date.now();
        state.taskRun.pendingSendKind = null;
        const runningTask = getCurrentRunningTask();
        setTaskBatchStep('wait-reply', runningTask, { log: false });
        ToolboxShell.appendLog(`${logTag} task=${runningTask ? runningTask.title : '-'}`);
        ToolboxShell.appendLog('[AUTOQ][TASK][WAIT_REPLY]');
        log(`已发送：${prompt.slice(0, 80)}`);
        updateStatus();
        updateChatInputStateBadge();
        return sendResult;
      }).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] auto queue task send failed', err);
        log(`发送异常：${errText}`);
        ToolboxShell.appendLog(`${logTag} error=${errText}`);
        return { ok: false, reason: errText };
      }).finally(() => {
        state.sendingNow = false;
      });
    }

    function maybeSendNextTask() {
      if (!state.running || state.waitingReply) return;
      if (state.taskBatchStepRunning) return;
      if (Date.now() < state.nextSendAt) return;
      if (ComposerApi.isAssistantLikelyBusy()) return;
      if (state.sendingNow) return;

      const run = state.taskRun || {};
      if (run.pendingSendKind === 'processing') return;

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

        run.pendingSendKind = 'processing';
        sendTaskPrompt(initial, '[AUTOQ][TASK_BATCH][SEND_INITIAL]').then((sendResult) => {
          if (!sendResult || sendResult.ok !== true) {
            const reason = String((sendResult && sendResult.reason) || 'unknown');
            ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} reason=${reason}`);
            markTaskStatus(currentTask, 'failed');
            moveToNextTask();
            return;
          }
          ToolboxShell.appendLog(`[AUTOQ][TASK][SEND_INITIAL] task=${currentTask.title}`);
        }).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] [AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial', err);
          ToolboxShell.appendLog(`[AUTOQ][TASK_BATCH][SEND_FAILED] phase=initial task=${currentTask.title} reason=${errText}`);
          markTaskStatus(currentTask, 'failed');
          moveToNextTask();
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
        const sendResult = await sendContentViaComposer({
          source: 'auto-queue-task-single',
          content: initial,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: 60000,
          blockWhenResponding: true,
        });

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

      const clearLogBtn = qs('#cgpt-autoq-clear-log', root);
      if (clearLogBtn) {
        bindOnce(clearLogBtn, 'click', () => {
          if (logEl) logEl.textContent = '';
          updateStatus();
        }, 'autoq-clear-log');
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
        logEl = qs('#cgpt-autoq-log', root);
        startBtn = qs('#cgpt-autoq-start', root);
        stopBtn = qs('#cgpt-autoq-stop', root);
        listPanelEl = qs('#cgpt-autoq-list-panel', root);
        listProfilesEl = qs('#cgpt-autoq-list-profile-chips', root);
        listProfileNameEl = qs('#cgpt-autoq-list-name', root);
        taskPanelEl = qs('#cgpt-autoq-task-panel', root);
        mainLiteEl = qs('#cgpt-autoq-main-lite', root);
        startUploadBtn = ensureAutoQueueStartUploadButton();
        normalizeAutoConfig(config);
        ensureBatchSubTabShell();
        refreshBatchTaskPanelRefs();
        bindEvents();
        bindTaskPanelEvents();
        renderTaskPanelVisibility();
        renderTaskProfiles();
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
            <button type="button" class="cgpt-btn" id="cgpt-autoq-clear-log">清空日志</button>
          </div>
        </div>

        <div class="cgpt-section cgpt-autoq-settings-section">
          <div class="cgpt-section-title">执行设置</div>

          <div class="cgpt-autoq-settings-grid">
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-loop" ${uiModeSettings.loopMode ? 'checked' : ''}>
              循环模式
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-log-pinned" ${uiModeSettings.logPinned ? 'checked' : ''}>
              日志置顶
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

        <div class="cgpt-section cgpt-autoq-log-section">
          <div class="cgpt-section-title">日志</div>
          <div id="cgpt-autoq-log" class="cgpt-autoq-log"></div>
        </div>
      `

      targetHost.appendChild(root);

      promptsEl = qs('#cgpt-autoq-prompts', root);
      logEl = qs('#cgpt-autoq-log', root);
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
      ensureBatchSubTabShell();
      refreshBatchTaskPanelRefs();

      bindEvents();
      bindTaskPanelEvents();
      renderListPanelVisibility();
      renderTaskPanelVisibility();
      renderListProfiles();
      renderTaskProfiles();
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

    return {
      mount,
      triggerContinueOnce,
      refreshProgressStatus,
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

  /********************************************************************
   * 5. PromptManagerModule：Prompt 管理模块
   ********************************************************************/

  const PromptManagerModule = (() => {
    const STORAGE_KEY = MemoryManager.KEYS.promptManagerData;

    let root = null;
    let listEl = null;
    let searchEl = null;
    let statusEl = null;

    const promptStatus = createModuleStatus('PROMPT', {
      getLocalEl: () => statusEl,
      useGlobal: false,
      useLog: false,
    });
    let importFileEl = null;
    let modalOverlay = null;

    const PROMPT_EDITOR_MODAL_POSITION_KEY = 'promptEditorModalPosition';

    let promptEditorDragState = null;
    let promptEditorResizeBound = false;

    let prompts = [];
    let categories = [];
    let searchKeyword = '';
    let activeCategory = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveCategory,
      '全部',
    );
    let activePromptSubtab = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveSubtab,
      'list',
    );
    let editingPromptId = null;
    let sendLock = false;

    function getPromptCategoryName(item) {
      return normalizePromptCategoryName(item, '默认');
    }

    function createPromptCategory(name, order) {
      const cleanName = normalizePromptCategoryName(name);

      return {
        id: createId('cat'),
        name: cleanName,
        order: Number.isFinite(Number(order)) ? Number(order) : Date.now(),
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };
    }

    function deriveCategoriesFromPrompts(promptList) {
      const map = new Map();

      DEFAULT_PROMPT_CATEGORIES.forEach((cat) => {
        map.set(cat.name, {
          id: cat.id,
          name: cat.name,
          order: cat.order,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      });

      (promptList || []).forEach((p) => {
        const name = normalizePromptCategoryName(p.category);

        if (!map.has(name)) {
          map.set(name, createPromptCategory(name, map.size));
        }
      });

      return Array.from(map.values());
    }

    function normalizePromptItem(item) {
      if (!item) return null;

      const title = String(item.title || '').trim();
      const content = String(item.content || '');

      if (!title || !content.trim()) return null;

      return {
        id: String(item.id || createId('prompt')),
        title,
        category: normalizePromptCategoryName(item.category),
        content,
        createdAt: Number(item.createdAt || nowMs()),
        updatedAt: Number(item.updatedAt || nowMs()),
      };
    }

    function buildNormalizedDefaultPrompts() {
      return createDefaultPrompts().map((item) => normalizePromptItem({
        id: createId('prompt'),
        title: item.title,
        category: item.category || '默认',
        content: item.content,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })).filter(Boolean);
    }

    function normalizePromptManagerData(raw) {
      let nextPrompts = [];
      let nextCategories = [];

      if (Array.isArray(raw)) {
        nextPrompts = raw;
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      } else if (raw && typeof raw === 'object') {
        nextPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
        nextCategories = Array.isArray(raw.categories) ? raw.categories : [];
      }

      nextPrompts = nextPrompts
        .map((item) => normalizePromptItem(item))
        .filter(Boolean);

      if (!nextPrompts.length) {
        nextPrompts = buildNormalizedDefaultPrompts();
      }

      if (!nextCategories.length) {
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      }

      const categoryNames = new Set();

      nextCategories = nextCategories
        .map((cat, index) => {
          const name = normalizePromptCategoryName(cat.name);

          return {
            id: String(cat.id || createId('cat')),
            name,
            order: Number.isFinite(Number(cat.order)) ? Number(cat.order) : index,
            createdAt: Number(cat.createdAt) || nowMs(),
            updatedAt: Number(cat.updatedAt) || nowMs(),
          };
        })
        .filter((cat) => {
          if (categoryNames.has(cat.name)) return false;
          categoryNames.add(cat.name);
          return true;
        });

      deriveCategoriesFromPrompts(nextPrompts).forEach((cat) => {
        if (!categoryNames.has(cat.name)) {
          nextCategories.push(cat);
          categoryNames.add(cat.name);
        }
      });

      nextCategories.sort((a, b) => Number(a.order) - Number(b.order));

      nextPrompts.forEach((p) => {
        p.category = normalizePromptCategoryName(p.category);
      });

      return {
        prompts: nextPrompts,
        categories: nextCategories,
      };
    }

    function applyPromptManagerData(data) {
      const normalized = normalizePromptManagerData(data);
      prompts = normalized.prompts;
      categories = normalized.categories;
    }

    function loadPromptManagerData() {
      const raw = MemoryManager.get(STORAGE_KEY, null);

      if (!raw) {
        const defaults = normalizePromptManagerData(null);
        savePromptManagerData(defaults);
        return defaults;
      }

      const normalized = normalizePromptManagerData(raw);

      if (Array.isArray(raw) || (raw && typeof raw === 'object' && !Array.isArray(raw.categories))) {
        savePromptManagerData(normalized);
      }

      return normalized;
    }

    function savePromptManagerData(data) {
      const payload = data || { prompts, categories };

      const ok = MemoryManager.set(STORAGE_KEY, {
        prompts: payload.prompts || prompts,
        categories: payload.categories || categories,
      });

      if (!ok) {
        console.error('[ChatGPT toolbox] savePromptManagerData failed');
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[Prompt 管理] 保存失败：浏览器存储写入失败');
        }
      }

      return ok;
    }

    function savePrompts() {
      return savePromptManagerData({ prompts, categories });
    }

    function getPromptCategoryCount(categoryName) {
      const normalized = normalizePromptCategoryName(categoryName);
      return prompts.filter((item) => getPromptCategoryName(item) === normalized).length;
    }

    function getPromptCategoriesForFilter() {
      return [
        { id: '__all__', name: '全部' },
        ...categories.map((cat) => ({ id: cat.id, name: cat.name })),
      ];
    }

    function getPromptCategoriesFromList(list) {
      const names = categories.map((cat) => cat.name);

      (list || []).forEach((item) => {
        const name = getPromptCategoryName(item);

        if (!names.includes(name)) {
          names.push(name);
        }
      });

      return ['全部', ...names];
    }

    function normalizeActiveCategory() {
      const filterNames = getPromptCategoriesForFilter().map((cat) => cat.name);

      if (!filterNames.includes(activeCategory)) {
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      return activeCategory;
    }

    function ensureCategoryExists(name) {
      const cleanName = normalizePromptCategoryName(name);
      const exists = categories.some((cat) => cat.name === cleanName);

      if (!exists) {
        categories.push(createPromptCategory(cleanName, categories.length));
        categories.sort((a, b) => Number(a.order) - Number(b.order));
      }

      return cleanName;
    }

    function renderCategoryDatalist() {
      const list = document.getElementById('cgpt-prompt-category-options');

      if (!list) return;

      list.innerHTML = categories.map((cat) => `
        <option value="${escapeHtml(cat.name)}"></option>
      `).join('');
    }

    function renderCategoryManager() {
      const listEl = qs('#cgpt-prompt-category-manage-list', root);

      if (!listEl) return;

      if (!categories.length) {
        listEl.innerHTML = renderEmptyState('暂无类别', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      listEl.innerHTML = categories.map((cat) => {
        const count = getPromptCategoryCount(cat.name);
        const locked = cat.name === '默认';

        return `
      <div class="cgpt-prompt-category-manage-item" data-category-id="${escapeHtml(cat.id)}">
        <div class="cgpt-prompt-category-manage-main">
          <div class="cgpt-prompt-category-manage-name">${escapeHtml(cat.name)}</div>
          <div class="cgpt-prompt-category-manage-meta">${count} Prompt</div>
        </div>

        <button type="button"
          class="cgpt-toolbox-small-btn"
          data-category-rename="${escapeHtml(cat.id)}">
          重命名
        </button>

        <button type="button"
          class="cgpt-toolbox-small-btn"
          data-category-delete="${escapeHtml(cat.id)}"
          ${locked ? 'disabled' : ''}>
          删除
        </button>
      </div>
    `;
      }).join('');
    }

    function addPromptCategory() {
      const input = qs('#cgpt-prompt-category-name', root);
      const name = normalizePromptCategoryName(input && input.value);

      if (!name) {
        setStatus('类别名称不能为空');
        return;
      }

      if (categories.some((cat) => cat.name === name)) {
        setStatus(`类别已存在：${name}`);
        return;
      }

      categories.push(createPromptCategory(name, categories.length));
      categories.sort((a, b) => Number(a.order) - Number(b.order));

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      if (input) input.value = '';

      render();

      setStatus(`已新建类别：${name}`);
      notifyUploadQuickPromptsRefresh();
    }

    function renamePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      const oldName = cat.name;
      const nextName = normalizePromptCategoryName(
        window.prompt('工具箱名称', oldName),
      );

      if (!nextName) {
        setStatus('类别名称不能为空');
        return;
      }

      if (nextName !== oldName && categories.some((x) => x.name === nextName)) {
        setStatus(`类别已存在：${nextName}`);
        return;
      }

      cat.name = nextName;
      cat.updatedAt = nowMs();

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === oldName) {
          p.category = nextName;
          p.updatedAt = nowMs();
        }
      });

      if (activeCategory === oldName) {
        activeCategory = nextName;
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();

      setStatus(`已重命名类别：${oldName} -> ${nextName}`);
    }

    function deletePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      if (cat.name === '默认') {
        setStatus('默认类别不能删除');
        return;
      }

      const count = getPromptCategoryCount(cat.name);

      const ok = window.confirm(
        `确定删除类别：${cat.name}”吗？该类别：${count} Prompt 会移动到“默认”。`,
      );

      if (!ok) return;

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === cat.name) {
          p.category = '默认';
          p.updatedAt = nowMs();
        }
      });

      categories = categories.filter((x) => x.id !== categoryId);

      if (!categories.some((x) => x.name === '默认')) {
        categories.unshift({
          id: 'default',
          name: '默认',
          order: 0,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      }

      if (activeCategory === cat.name) {
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      render();
      notifyUploadQuickPromptsRefresh();

      setStatus(`已删除类别：${cat.name}，相关 Prompt 已移动到默认`);
    }

    applyPromptManagerData(loadPromptManagerData());

    function notifyUploadQuickPromptsRefresh() {
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }
    }

    function commitPromptManagerChange(message, options = {}) {
      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();

      if (options.closeEditor) {
        closeEditor();
      }

      if (message) {
        setStatus(message);
      }
    }

    function deletePromptById(promptId, options = {}) {
      const item = prompts.find((prompt) => prompt.id === promptId);

      if (!item) {
        setStatus('Prompt 不存在');
        return false;
      }

      if (options.confirm !== false) {
        const ok = window.confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
        if (!ok) return false;
      }

      prompts = prompts.filter((prompt) => prompt.id !== promptId);
      commitPromptManagerChange(promptDeletedMessage(item.title), {
        closeEditor: options.closeEditor === true,
      });
      return true;
    }

    function reloadFromStorage() {
      applyPromptManagerData(loadPromptManagerData());
      searchKeyword = '';
      render();
      notifyUploadQuickPromptsRefresh();
    }

    function clearPromptStatus() {
      promptStatus.clear();
    }

    function setStatus(message, timeout) {
      const text = String(message || '').trim();

      if (/^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(text)) {
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-local-stat-status');
        }

        return;
      }

      const ms = timeout == null ? 1800 : timeout;

      if (ms > 0) {
        promptStatus.set(text, 'info', { timeoutMs: ms });
      } else {
        promptStatus.set(text, 'info');
      }
    }

    function filteredPrompts() {
      const category = normalizeActiveCategory();
      const kw = searchKeyword.trim().toLowerCase();

      let list = prompts.slice();

      if (category !== '全部') {
        list = list.filter((item) => getPromptCategoryName(item) === category);
      }

      if (!kw) {
        return list;
      }

      return list.filter((item) => {
        const haystack = [
          item.title || '',
          item.category || '',
          item.content || '',
        ].join('\n').toLowerCase();

        return haystack.includes(kw);
      });
    }

    function renderCategoryBar() {
      if (!root) return;

      const bar = qs('#cgpt-prompt-category-bar', root);
      if (!bar) return;

      const filterCategories = getPromptCategoriesForFilter();
      const current = normalizeActiveCategory();

      bar.innerHTML = renderPromptCategoryChips(
        filterCategories.map((cat) => cat.name),
        current,
        (name) => getPromptCategoryCount(name),
        'data-prompt-category',
      );
    }

    function renderPromptSubtabs() {
      const tabs = qsa('[data-prompt-subtab]', root);
      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-prompt-subtab');
        btn.classList.toggle('active', name === activePromptSubtab);
      });

      const listPanel = qs('#cgpt-prompt-list-panel', root);
      const categoryPanel = qs('#cgpt-prompt-category-panel', root);

      if (listPanel) {
        listPanel.style.display = activePromptSubtab === 'list' ? '' : 'none';
      }

      if (categoryPanel) {
        categoryPanel.style.display = activePromptSubtab === 'category' ? '' : 'none';
      }
    }

    function render() {
      if (!listEl) return;

      renderPromptSubtabs();

      if (activePromptSubtab === 'list') {
        renderCategoryBar();
      }

      if (activePromptSubtab === 'category') {
        renderCategoryManager();
        renderCategoryDatalist();
      }

      const items = filteredPrompts();
      listEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-hint';
        empty.style.padding = '16px 8px';
        empty.style.textAlign = 'center';
        empty.textContent = '没有匹配Prompt';
        listEl.appendChild(empty);
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-render-empty');
        }

        return;
      }

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'cgpt-prompt-item';
        row.dataset.id = item.id;

        const title = document.createElement('div');
        title.className = 'cgpt-prompt-title';
        title.textContent = item.title;

        const meta = document.createElement('div');
        meta.className = 'cgpt-prompt-meta';
        meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;

        const preview = document.createElement('div');
        preview.className = 'cgpt-prompt-preview';
        preview.textContent = item.content.replace(/\s+/g, ' ').slice(0, 140);

        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(preview);

        const actions = document.createElement('div');
        actions.className = 'cgpt-prompt-actions';

        const batchLabel = document.createElement('label');
        batchLabel.className = 'cgpt-checkbox-line cgpt-prompt-batch-task-check';
        batchLabel.title = '加入批量任务';
        const batchCheck = document.createElement('input');
        batchCheck.type = 'checkbox';
        batchCheck.checked = (
          typeof AutoQueueModule !== 'undefined'
          && typeof AutoQueueModule.isPromptBatchTaskSelected === 'function'
          && AutoQueueModule.isPromptBatchTaskSelected(item.id)
        );
        batchCheck.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        batchCheck.addEventListener('change', (e) => {
          e.stopPropagation();
          if (
            typeof AutoQueueModule === 'undefined'
            || typeof AutoQueueModule.addPromptBatchTask !== 'function'
            || typeof AutoQueueModule.removePromptBatchTask !== 'function'
          ) {
            batchCheck.checked = false;
            return;
          }

          if (batchCheck.checked) {
            AutoQueueModule.addPromptBatchTask(item.id);
          } else {
            AutoQueueModule.removePromptBatchTask(item.id);
          }
          render();
        });
        const batchText = document.createElement('span');
        batchText.textContent = '加入批量任务';
        batchLabel.appendChild(batchCheck);
        batchLabel.appendChild(batchText);
        actions.appendChild(batchLabel);

        const fillBtn = createActionButton('填入');
        fillBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendPrompt(item.content, false);
        });

        const sendBtn = createActionButton('发送', 'primary');
        sendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void sendPrompt(item.content, true);
        });

        const copyBtn = createActionButton('复制');
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await copyTextToClipboard(item.content);
          if (ok) {
            setStatus(`已复制：${item.title}`);
          } else {
            setStatus('复制失败，请手动复制', 'error');
          }
        });

        const editBtn = createActionButton('编辑');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(item.id);
        });

        const deleteBtn = createActionButton('删除');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deletePromptById(item.id);
        });

        const upBtn = createActionButton('↑');
        upBtn.title = '上移';
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, -1);
        });

        const downBtn = createActionButton('↓');
        downBtn.title = '下移';
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, 1);
        });

        actions.appendChild(fillBtn);
        actions.appendChild(sendBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        actions.appendChild(upBtn);
        actions.appendChild(downBtn);

        row.appendChild(actions);

        listEl.appendChild(row);
      }

      clearPromptStatus();

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
        ToolboxShell.purgeForbiddenStatusBadge('prompt-render-end');
      }
    }

    function createActionButton(text, type) {
      return createToolboxButton(text, {
        variant: type === 'primary' ? 'primary' : '',
        height: '28px',
        padding: '0 8px',
      });
    }

    function movePrompt(id, direction) {
      const index = prompts.findIndex((item) => item.id === id);
      if (index < 0) return;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prompts.length) return;

      const temp = prompts[index];
      prompts[index] = prompts[nextIndex];
      prompts[nextIndex] = temp;

      savePrompts();
      render();
      notifyUploadQuickPromptsRefresh();
      setStatus('已调整排序');
    }

    function openEditor(id) {
      editingPromptId = id;

      const item = prompts.find((prompt) => prompt.id === id) || null;
      const modalTitle = qs('#cgpt-prompt-editor-title', modalOverlay);
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);
      const deleteBtn = qs('#cgpt-prompt-delete-btn', modalOverlay);
      const duplicateBtn = qs('#cgpt-prompt-duplicate-btn', modalOverlay);

      if (item) {
        modalTitle.textContent = '编辑 Prompt';
        titleInput.value = item.title;
        categoryInput.value = item.category || '默认';
        contentInput.value = item.content;
        deleteBtn.style.display = '';
        duplicateBtn.style.display = '';
      } else {
        modalTitle.textContent = '新建 Prompt';
        titleInput.value = '';
        categoryInput.value = '默认';
        contentInput.value = '';
        deleteBtn.style.display = 'none';
        duplicateBtn.style.display = 'none';
      }

      renderCategoryDatalist();
      modalOverlay.style.display = 'flex';

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'open-editor-modal');

      window.setTimeout(() => {
        titleInput.focus();
      }, 50);
    }

    function closeEditor() {
      if (modalOverlay) {
        modalOverlay.style.display = 'none';
      }

      editingPromptId = null;
    }

    function saveEditor() {
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

      const title = String(titleInput.value || '').trim();
      const category = ensureCategoryExists(categoryInput.value);
      const content = String(contentInput.value || '');

      if (!title) {
        alert('标题不能为空');
        return;
      }

      if (!content.trim()) {
        alert('Prompt 内容不能为空');
        return;
      }

      const existing = prompts.find((item) => item.id === editingPromptId);

      if (existing) {
        existing.title = title;
        existing.category = category;
        existing.content = content;
        existing.updatedAt = nowMs();
      } else {
        prompts.unshift({
          id: createId('prompt'),
          title,
          category,
          content,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      }

      commitPromptManagerChange(
        existing ? '已保存修改' : UiMessages.promptCreated,
        { closeEditor: true },
      );
    }

    function deleteCurrentPrompt() {
      if (!editingPromptId) return;
      deletePromptById(editingPromptId, { closeEditor: true });
    }

    function duplicateCurrentPrompt() {
      const item = prompts.find((prompt) => prompt.id === editingPromptId);
      if (!item) return;

      prompts.unshift({
        id: createId('prompt'),
        title: `${item.title} - 副本`,
        category: ensureCategoryExists(item.category),
        content: item.content,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      });

      commitPromptManagerChange(UiMessages.promptDuplicated, {
        closeEditor: true,
      });
    }

    function exportPrompts() {
      const data = {
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      };

      downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
      setStatus(UiMessages.promptExported);
    }

    async function importPrompts(event) {
      try {
        const data = await readJsonFileFromInput(event, {
          tag: '[PROMPT_IMPORT]',
        });

        if (!data) return;

        const importedData = normalizePromptManagerData(data);

        if (!importedData.prompts.length) {
          alert('导入失败：文件中没有有效 Prompt');
          return;
        }

        const replace = confirm(
          `读取 ${importedData.prompts.length} Prompt。\n\n点击“确定”：覆盖当前列表。\n点击“取消”：追加到当前列表。`,
        );

        if (replace) {
          prompts = importedData.prompts.map((item) => ({
            ...item,
            id: createId('prompt'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));
          categories = importedData.categories.map((cat) => ({
            ...cat,
            id: createId('cat'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));
        } else {
          const appended = importedData.prompts.map((item) => ({
            ...item,
            id: createId('prompt'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));

          prompts = [...appended, ...prompts];

          importedData.categories.forEach((cat) => {
            if (!categories.some((x) => x.name === cat.name)) {
              categories.push({
                ...cat,
                id: createId('cat'),
                createdAt: nowMs(),
                updatedAt: nowMs(),
              });
            }
          });
        }

        prompts.forEach((p) => {
          p.category = ensureCategoryExists(p.category);
        });

        categories.sort((a, b) => Number(a.order) - Number(b.order));
        savePromptManagerData();
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
        render();
        notifyUploadQuickPromptsRefresh();
        setStatus('导入完成');
      } catch (e) {
        const errText = getErrorText(e);
        console.error('[ChatGPT toolbox] Prompt import failed', e);
        alert(`导入失败：${errText}`);
      }
    }

    function resetDefaultPrompts() {
      const ok = confirm('确定重置为默认 Prompt 吗？当前所有自定义 Prompt 会被覆盖。');
      if (!ok) return;

      const defaults = normalizePromptManagerData(null);
      prompts = defaults.prompts;
      categories = defaults.categories;
      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();
      setStatus('已重置为默认 Prompt');
    }

    async function sendPrompt(content, autoSend) {
      if (autoSend && sendLock) {
        setStatus('正在发送中，请勿重复点击');
        return;
      }

      const text = String(content || '').trim();

      if (!text) {
        setStatus('Prompt 内容为空', 'warn');
        return;
      }

      const existingText = ComposerApi.getComposerText();

      const compactCfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      if (existingText && existingText !== text && compactCfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖？`,
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[Prompt 管理] 已阻止覆盖草稿 existing=${existingText.length} new=${text.length}`,
          );
          return;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[Prompt 管理] 自动覆盖草稿 existing=${existingText.length} new=${text.length}`,
        );
      }

      if (!autoSend) {
        const okSet = ComposerApi.setComposerValue(text);

        if (!okSet) {
          console.error('[ChatGPT toolbox] Prompt fill failed: composer not found');
          ToolboxShell.appendLog('[Prompt 管理] 填入失败：未找到输入框');
          alert('没有找到 ChatGPT 输入框。请确认当前页面是 ChatGPT 对话页面');
          return;
        }

        setStatus('已填入输入框，未自动发送');
        return;
      }

      sendLock = true;
      setStatus('正在发送 Prompt…');

      try {
        const sendResult = await sendContentViaComposer({
          source: 'prompt-manager',
          content: text,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: 60000,
          blockWhenResponding: true,
        });

        if (!sendResult.ok) {
          setStatus(`Prompt 发送失败：${sendResult.reason || 'unknown'}`, 'warn');
          ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${sendResult.reason || 'unknown'}`);
          return;
        }

        setStatus(`已发送 Prompt：${sendResult.reason}`, 'success');
        ToolboxShell.appendLog(`[Prompt 管理] 已发送 Prompt reason=${sendResult.reason}`);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] Prompt send failed', err);
        setStatus(`Prompt 发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${errText}`);
      } finally {
        sendLock = false;
      }
    }

    function repairPromptEditorCategoryField(editorRoot) {
      if (!editorRoot) return;

      const categoryInput = qs('#cgpt-prompt-edit-category', editorRoot);
      if (!(categoryInput instanceof HTMLInputElement)) return;

      const brokenPlaceholder = String(categoryInput.getAttribute('placeholder') || '');
      if (!brokenPlaceholder.includes('论>') && categoryInput.list === 'cgpt-prompt-category-options') {
        return;
      }

      categoryInput.setAttribute('placeholder', '例如：代码、Cursor、论文');
      categoryInput.setAttribute('list', 'cgpt-prompt-category-options');

      let datalist = qs('#cgpt-prompt-category-options', editorRoot);
      if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'cgpt-prompt-category-options';
        categoryInput.insertAdjacentElement('afterend', datalist);
      }
    }

    function readPromptEditorModalPosition() {
      const pos = MemoryManager.get(PROMPT_EDITOR_MODAL_POSITION_KEY, null);

      if (!pos || typeof pos !== 'object') {
        return null;
      }

      const left = Number(pos.left);
      const top = Number(pos.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
      };
    }

    function savePromptEditorModalPosition(left, top, reason = '') {
      const next = {
        left: Math.round(Number(left) || 0),
        top: Math.round(Number(top) || 0),
        updatedAt: Date.now(),
      };

      MemoryManager.set(PROMPT_EDITOR_MODAL_POSITION_KEY, next);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[PROMPT_EDITOR_MODAL][position-save] reason=${reason || '-'} left=${next.left} top=${next.top}`,
        );
      }
    }

    function clampPromptEditorModalPosition(left, top, modal) {
      const margin = 8;
      const rect = modal && typeof modal.getBoundingClientRect === 'function'
        ? modal.getBoundingClientRect()
        : null;

      const width = rect && rect.width > 0 ? rect.width : 520;
      const height = rect && rect.height > 0 ? rect.height : 420;

      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);

      return {
        left: Math.max(margin, Math.min(Number(left) || margin, maxLeft)),
        top: Math.max(margin, Math.min(Number(top) || margin, maxTop)),
      };
    }

    function applyPromptEditorModalPosition(modal, left, top, reason = '') {
      if (!modal) {
        return;
      }

      const pos = clampPromptEditorModalPosition(left, top, modal);

      modal.style.position = 'fixed';
      modal.style.left = `${Math.round(pos.left)}px`;
      modal.style.top = `${Math.round(pos.top)}px`;
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.margin = '0';
      modal.style.transform = 'none';

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[PROMPT_EDITOR_MODAL][position-apply] reason=${reason || '-'} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
        );
      }
    }

    function restorePromptEditorModalPosition(modal, reason = '') {
      if (!modal) {
        return;
      }

      const saved = readPromptEditorModalPosition();

      if (saved) {
        applyPromptEditorModalPosition(modal, saved.left, saved.top, reason || 'restore-saved');
        return;
      }

      const rect = modal.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : 520;
      const height = rect && rect.height > 0 ? rect.height : 420;

      const left = Math.max(8, Math.round((window.innerWidth - width) / 2));
      const top = Math.max(8, Math.round((window.innerHeight - height) / 2));

      applyPromptEditorModalPosition(modal, left, top, reason || 'restore-center');
    }

    function bindPromptEditorModalDrag(modalOverlayEl) {
      const overlay = modalOverlayEl || modalOverlay;
      if (!overlay) {
        return;
      }

      const modal = overlay.querySelector('.cgpt-modal');
      const header = overlay.querySelector('.cgpt-modal-header');

      if (!modal || !header) {
        console.error('[ChatGPT toolbox] Prompt editor modal drag bind failed: missing modal/header');

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[PROMPT_EDITOR_MODAL][drag-bind-failed] missing modal/header');
        }

        return;
      }

      if (header.dataset.promptEditorDragBound === '1') {
        return;
      }

      header.dataset.promptEditorDragBound = '1';

      header.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) {
          return;
        }

        const target = event.target instanceof HTMLElement ? event.target : null;

        if (
          target
          && target.closest('button,input,textarea,select,a,[contenteditable="true"]')
        ) {
          return;
        }

        const rect = modal.getBoundingClientRect();

        promptEditorDragState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false,
        };

        try {
          header.setPointerCapture(event.pointerId);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] prompt editor setPointerCapture failed', error);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[PROMPT_EDITOR_MODAL][drag-capture-failed] error=${errText}`,
            );
          }
        }

        modal.classList.add('cgpt-modal-dragging');

        event.preventDefault();
        event.stopPropagation();
      });

      header.addEventListener('pointermove', (event) => {
        if (!promptEditorDragState) {
          return;
        }

        if (event.pointerId !== promptEditorDragState.pointerId) {
          return;
        }

        const dx = event.clientX - promptEditorDragState.startClientX;
        const dy = event.clientY - promptEditorDragState.startClientY;

        if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) {
          promptEditorDragState.moved = true;
        }

        if (!promptEditorDragState.moved) {
          return;
        }

        const nextLeft = promptEditorDragState.startLeft + dx;
        const nextTop = promptEditorDragState.startTop + dy;

        applyPromptEditorModalPosition(
          modal,
          nextLeft,
          nextTop,
          'dragging',
        );

        event.preventDefault();
        event.stopPropagation();
      });

      function finishDrag(event, reason) {
        if (!promptEditorDragState) {
          return;
        }

        const state = promptEditorDragState;
        promptEditorDragState = null;

        try {
          header.releasePointerCapture(state.pointerId);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] prompt editor releasePointerCapture failed', error);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[PROMPT_EDITOR_MODAL][drag-release-failed] reason=${reason || '-'} error=${errText}`,
            );
          }
        }

        modal.classList.remove('cgpt-modal-dragging');

        if (state.moved) {
          const rect = modal.getBoundingClientRect();
          const pos = clampPromptEditorModalPosition(rect.left, rect.top, modal);

          applyPromptEditorModalPosition(modal, pos.left, pos.top, reason || 'drag-end');
          savePromptEditorModalPosition(pos.left, pos.top, reason || 'drag-end');

          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }

      header.addEventListener('pointerup', (event) => {
        finishDrag(event, 'pointerup');
      });

      header.addEventListener('pointercancel', (event) => {
        finishDrag(event, 'pointercancel');
      });
    }

    function bindPromptEditorModalResize() {
      if (promptEditorResizeBound) {
        return;
      }

      promptEditorResizeBound = true;

      window.addEventListener('resize', () => {
        if (!modalOverlay) {
          return;
        }

        const modal = modalOverlay.querySelector('.cgpt-modal');

        if (!modal || modalOverlay.style.display === 'none' || modalOverlay.hidden) {
          return;
        }

        const rect = modal.getBoundingClientRect();
        const pos = clampPromptEditorModalPosition(rect.left, rect.top, modal);
        applyPromptEditorModalPosition(modal, pos.left, pos.top, 'window-resize');
      }, { passive: true });
    }

    function createEditorModal() {
      if (document.getElementById('cgpt-prompt-editor-overlay')) {
        modalOverlay = document.getElementById('cgpt-prompt-editor-overlay');
        repairPromptEditorCategoryField(modalOverlay);
        bindPromptEditorModalDrag(modalOverlay);
        restorePromptEditorModalPosition(
          modalOverlay.querySelector('.cgpt-modal'),
          'create-editor-modal-existing',
        );
        return;
      }

      modalOverlay = document.createElement('div');
      modalOverlay.id = 'cgpt-prompt-editor-overlay';
      modalOverlay.className = 'cgpt-modal-overlay';
      modalOverlay.innerHTML = `
        <div class="cgpt-modal">
          <div class="cgpt-modal-header">
            <div id="cgpt-prompt-editor-title">编辑 Prompt</div>
            <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-prompt-editor-close">关闭</button>
          </div>

          <div class="cgpt-modal-body">
            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-title">标题 / 按钮名称</label>
              <input class="cgpt-input" id="cgpt-prompt-edit-title" placeholder="例如：找 bug">
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-category">分类</label>
              <input class="cgpt-input" id="cgpt-prompt-edit-category" list="cgpt-prompt-category-options" placeholder="例如：代码、Cursor、论文">
              <datalist id="cgpt-prompt-category-options"></datalist>
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-content">Prompt 内容</label>
              <textarea class="cgpt-textarea" id="cgpt-prompt-edit-content" style="min-height:300px;" placeholder="请输入完Prompt..."></textarea>
            </div>
          </div>

          <div class="cgpt-modal-actions">
            <div class="cgpt-modal-actions-left">
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-delete-btn">删除</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-duplicate-btn">复制一份</button>
            </div>
            <div class="cgpt-modal-actions-right">
              <button type="button" class="cgpt-btn" id="cgpt-prompt-cancel-btn">取消</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-save-btn">保存</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modalOverlay);

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'create-editor-modal');
      bindPromptEditorModalDrag(modalOverlay);

      qs('#cgpt-prompt-editor-close', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-cancel-btn', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-save-btn', modalOverlay).addEventListener('click', saveEditor);
      qs('#cgpt-prompt-delete-btn', modalOverlay).addEventListener('click', deleteCurrentPrompt);
      qs('#cgpt-prompt-duplicate-btn', modalOverlay).addEventListener('click', duplicateCurrentPrompt);

      modalOverlay.addEventListener('mousedown', (event) => {
        if (event.target === modalOverlay) {
          closeEditor();
        }
      });
    }

    function bindEvents() {
      bindClick(root, '#cgpt-prompt-new-quick-btn', () => openEditor(null), {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-new-quick-btn',
      });
      bindClick(root, '#cgpt-prompt-export-btn', exportPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-export-btn',
      });
      bindClick(root, '#cgpt-prompt-import-btn', () => {
        if (importFileEl) importFileEl.click();
      }, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-import-btn',
      });
      bindClick(root, '#cgpt-prompt-reset-btn', resetDefaultPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-reset-btn',
      });

      if (importFileEl) {
        bindOnce(importFileEl, 'change', importPrompts);
      }

      if (searchEl) {
        bindOnce(searchEl, 'input', (event) => {
          searchKeyword = String(event.target.value || '').trim().toLowerCase();
          render();
        });
      }

      const categoryBar = qs('#cgpt-prompt-category-bar', root);
      if (categoryBar) {
        DomUtil.bindOnce(categoryBar, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-category]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeCategory = btn.getAttribute('data-prompt-category') || '全部';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveCategory,
            activeCategory,
          );

          render();
          setStatus(`已切换分类：${activeCategory}`);
        }, 'bound_prompt_category_bar_click');
      }

      const categoryAddBtn = qs('#cgpt-prompt-category-add', root);

      if (categoryAddBtn) {
        categoryAddBtn.addEventListener('click', () => {
          addPromptCategory();
        });
      }

      const categoryNameInput = qs('#cgpt-prompt-category-name', root);

      if (categoryNameInput) {
        categoryNameInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          addPromptCategory();
        });
      }

      const categoryManageList = qs('#cgpt-prompt-category-manage-list', root);

      if (categoryManageList) {
        categoryManageList.addEventListener('click', (e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;

          if (!target) return;

          const renameBtn = target.closest('[data-category-rename]');

          if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            renamePromptCategory(renameBtn.getAttribute('data-category-rename'));
            return;
          }

          const deleteBtn = target.closest('[data-category-delete]');

          if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            deletePromptCategory(deleteBtn.getAttribute('data-category-delete'));
          }
        });
      }

      const subtabBar = qs('#cgpt-prompt-subtabs', root);
      if (subtabBar) {
        subtabBar.addEventListener('click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activePromptSubtab = btn.getAttribute('data-prompt-subtab') || 'list';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            activePromptSubtab,
          );

          renderPromptSubtabs();

          if (activePromptSubtab === 'category') {
            renderCategoryManager();
            renderCategoryDatalist();
          }

          if (activePromptSubtab === 'list') {
            renderCategoryBar();
          }
        });
      }
    }

    const PROMPT_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">Prompt 管理</div>
          <div id="cgpt-prompt-manage-tools" class="cgpt-grid-4" style="margin-top:8px;">
            <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
          </div>

          <div id="cgpt-prompt-subtabs" class="cgpt-prompt-subtabs">
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="list">Prompt 列表</button>
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="category">类别管理</button>
          </div>

          <div id="cgpt-prompt-list-panel" class="cgpt-prompt-panel">
            <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar"></div>
            <input id="cgpt-prompt-search" class="cgpt-input" placeholder="搜索标题、分类或内容..." style="margin-top:8px;">
            <div id="cgpt-prompt-list" class="cgpt-prompt-list" style="margin-top:8px;"></div>
            <div id="cgpt-prompt-status" class="cgpt-hint" style="margin-top:8px; display:none;"></div>
          </div>

          <div id="cgpt-prompt-category-panel" class="cgpt-prompt-panel" style="display:none;">
            <div class="cgpt-section" id="cgpt-prompt-category-manager" style="padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-prompt-category-edit-row">
                <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入类别名称，例如：论文">
                <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>
              </div>

              <div id="cgpt-prompt-category-manage-list" class="cgpt-prompt-category-manage-list"></div>
            </div>
          </div>

          <input id="cgpt-prompt-import-file" type="file" accept="application/json,.json" style="display:none;">
        </div>
      `;

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-prompt-module',
        moduleName: 'PROMPT',
        html: PROMPT_MODULE_HTML,
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          listEl = qs('#cgpt-prompt-list', root);
          searchEl = qs('#cgpt-prompt-search', root);
          statusEl = qs('#cgpt-prompt-status', root);
          importFileEl = qs('#cgpt-prompt-import-file', root);
        },
        onBind: () => {
          createEditorModal();
          bindPromptEditorModalResize();
          bindEvents();
        },
        onRender: () => {
          activePromptSubtab = MemoryManager.get(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            'list',
          );
          render();
        },
      });
    }

    function getPromptById(promptId) {
      return prompts.find((item) => String(item.id) === String(promptId)) || null;
    }

    return {
      mount,
      getPrompts: () => prompts.slice(),
      getPromptById,
      reloadFromStorage,
      getPromptCategoryName,
      getPromptCategoriesFromList,
      exportData: () => ({
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      }),
    };
  })();

  /********************************************************************
   * 5b. SettingsModule：精简模式与工具箱设置
   ********************************************************************/

  function renderPromptCheckboxList(promptList, selectedIds) {
    const list = Array.isArray(promptList) ? promptList : [];
    const selected = new Set(
      Array.isArray(selectedIds)
        ? selectedIds.map((id) => String(id))
        : [],
    );

    if (!list.length) {
      return '<div class="cgpt-log-empty">暂无 Prompt</div>';
    }

    return list.map((prompt) => {
      const id = String(prompt && prompt.id ? prompt.id : '');
      const title = String(prompt && prompt.title ? prompt.title : '未命名');
      const category = String(prompt && prompt.category ? prompt.category : '默认');
      const checked = selected.has(id) ? ' checked' : '';

      return `
      <label class="cgpt-setting-prompt-checkbox">
        <input
          type="checkbox"
          data-compact-prompt-id="${escapeHtml(id)}"
          ${checked}
        >
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(category)}</small>
      </label>
    `;
    }).join('');
  }

  const SettingsModule = (() => {
    let host = null;
    let root = null;
    let activeSettingsSubtab = 'basic';
    let continuePromptMigrationChecked = false;

    function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {
      if (!cfg || typeof cfg !== 'object') {
        return cfg;
      }
      if (typeof migrateContinuePromptTextIfNeeded !== 'function') {
        return cfg;
      }

      const stored = String(cfg.copyHotkeyContinuePromptText || '').trim();
      const logFn = options.log === false
        ? null
        : (line) => ToolboxShell.appendLog(line);
      const migration = migrateContinuePromptTextIfNeeded(stored, logFn);

      if (migration.migrated) {
        cfg.copyHotkeyContinuePromptText = migration.value;
      }

      return cfg;
    }

    function getConfig() {
      const saved = MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};
      let cfg = normalizeCompactUiConfig(saved);

      if (saved && !saved.quickPromptActionVersion && saved.quickPromptClickAction === 'fill') {
        cfg.quickPromptClickAction = 'send';
        cfg.quickPromptActionVersion = 1;
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
        cfg = normalizeCompactUiConfig(cfg);
      }

      if (!continuePromptMigrationChecked) {
        continuePromptMigrationChecked = true;
        const before = String(cfg.copyHotkeyContinuePromptText || '').trim();
        cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });
        const after = String(cfg.copyHotkeyContinuePromptText || '').trim();
        if (before !== after) {
          MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
        }
      }

      return cfg;
    }

    function saveConfig(next) {
      const cfg = migrateCompactContinuePromptIfNeeded(
        normalizeCompactUiConfig(next || {}),
        { log: false },
      );
      cfg.quickPromptActionVersion = 1;
      MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);

      ToolboxShell.appendLog(
        `[SETTINGS][quickPrompt] upload=${cfg.showUploadQuickPrompts !== false} compact=${cfg.showCompactQuickPrompts !== false} confirmOverwrite=${cfg.confirmPromptDraftOverwrite ? 1 : 0} selected=${(cfg.quickPromptIds || []).length}`,
      );

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }
    }

    function readFromUi() {
      const current = getConfig();

      const quickPromptIds = qsa('[data-compact-prompt-id]', root)
        .filter((x) => x.checked)
        .map((x) => x.getAttribute('data-compact-prompt-id'))
        .filter(Boolean);

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      const compactQuickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);

      const showUploadQuickPrompts = uploadQuickEl
        ? !!uploadQuickEl.checked
        : current.showUploadQuickPrompts !== false;

      const showCompactQuickPrompts = compactQuickEl
        ? !!compactQuickEl.checked
        : current.showCompactQuickPrompts !== false;

      return {
        showUploadStartButton: !!qs(SettingsSelectors.showUploadStart, root)?.checked,
        showUploadFileList: !!qs(SettingsSelectors.showFileList, root)?.checked,
        showUploadQuickPrompts,
        showCompactQuickPrompts,
        quickPromptClickAction: qs('#cgpt-setting-compact-prompt-action', root)?.value || 'send',
        confirmPromptDraftOverwrite: !!qs('#cgpt-setting-confirm-prompt-draft-overwrite', root)?.checked,
        quickPromptActiveCategory: current.quickPromptActiveCategory || '全部',
        quickPromptIds,
        globalDropCaptureEnabled: !!qs('#cgpt-setting-global-drop-capture', root)?.checked,
        restoreScrollAfterCopyLastMessage: !!qs('#cgpt-setting-restore-scroll-after-copy', root)?.checked,
        copyHotkeyLoopAutoUploadEnabled: !!qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root)?.checked,
        copyHotkeyLoopAutoUploadInterval: Number(qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root)?.value || current.copyHotkeyLoopAutoUploadInterval || 5),
        copyHotkeyLoopHomeNavEnabled: !!qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root)?.checked,
        copyHotkeyLoopHomeNavInterval: Number(qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root)?.value || current.copyHotkeyLoopHomeNavInterval || 20),
        copyHotkeyLoopHomeNavUrl: String(
          qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root)?.value
          || current.copyHotkeyLoopHomeNavUrl
          || 'https://chatgpt.com/'
        ).trim(),
        copyHotkeyContinuePromptText: (() => {
          const raw = String(qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root)?.value || '').trim();
          const defaultText = typeof getDefaultContinuePromptText === 'function'
            ? getDefaultContinuePromptText()
            : '';
          if (defaultText && raw === defaultText) {
            return '';
          }
          return raw;
        })(),
        copyHotkeyContinueStopSignal: String(qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root)?.value || '').trim() || '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>',
      };
    }

    function renderSettingsSubtabs() {
      if (!root) return;

      const tabs = qsa('[data-settings-subtab]', root);
      const panels = qsa('[data-settings-panel]', root);

      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-settings-subtab') || 'basic';
        btn.classList.toggle('active', name === activeSettingsSubtab);
      });

      panels.forEach((panelEl) => {
        const name = panelEl.getAttribute('data-settings-panel') || 'basic';
        panelEl.style.display = name === activeSettingsSubtab ? '' : 'none';
      });
    }

    function render() {
      if (!root) return;

      renderSettingsSubtabs();

      const cfg = getConfig();

      const startEl = qs('#cgpt-setting-compact-show-upload-start', root);
      if (startEl) startEl.checked = !!cfg.showUploadStartButton;

      const fileListEl = qs('#cgpt-setting-compact-show-file-list', root);
      if (fileListEl) fileListEl.checked = !!cfg.showUploadFileList;

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      if (uploadQuickEl) {
        uploadQuickEl.checked = cfg.showUploadQuickPrompts !== false;
      }

      const quickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);
      if (quickEl) {
        quickEl.checked = cfg.showCompactQuickPrompts !== false;
      }

      const actionEl = qs('#cgpt-setting-compact-prompt-action', root);
      if (actionEl) actionEl.value = cfg.quickPromptClickAction || 'send';

      const confirmPromptDraftOverwriteEl = qs('#cgpt-setting-confirm-prompt-draft-overwrite', root);
      if (confirmPromptDraftOverwriteEl) {
        confirmPromptDraftOverwriteEl.checked = cfg.confirmPromptDraftOverwrite === true;
      }

      const globalDropEl = qs('#cgpt-setting-global-drop-capture', root);
      if (globalDropEl) globalDropEl.checked = !!cfg.globalDropCaptureEnabled;

      const restoreScrollEl = qs('#cgpt-setting-restore-scroll-after-copy', root);
      if (restoreScrollEl) {
        restoreScrollEl.checked = cfg.restoreScrollAfterCopyLastMessage === true;
      }

      const loopAutoUploadEnabledEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root);
      if (loopAutoUploadEnabledEl) {
        loopAutoUploadEnabledEl.checked = cfg.copyHotkeyLoopAutoUploadEnabled !== false;
      }

      const loopAutoUploadIntervalEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root);
      if (loopAutoUploadIntervalEl) {
        loopAutoUploadIntervalEl.value = String(cfg.copyHotkeyLoopAutoUploadInterval || 5);
      }

      const loopHomeNavEnabledEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root);
      if (loopHomeNavEnabledEl) {
        loopHomeNavEnabledEl.checked = cfg.copyHotkeyLoopHomeNavEnabled !== false;
      }

      const loopHomeNavIntervalEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root);
      if (loopHomeNavIntervalEl) {
        loopHomeNavIntervalEl.value = String(cfg.copyHotkeyLoopHomeNavInterval || 20);
      }

      const loopHomeNavUrlEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root);
      if (loopHomeNavUrlEl) {
        loopHomeNavUrlEl.value = cfg.copyHotkeyLoopHomeNavUrl || 'https://chatgpt.com/';
      }

      const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
      if (stopSignalEl) {
        stopSignalEl.value = cfg.copyHotkeyContinueStopSignal || '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
      }

      const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
      if (promptTextEl) {
        promptTextEl.value = String(cfg.copyHotkeyContinuePromptText || '').trim();
        promptTextEl.placeholder = '留空则使用内置默认继续指令（完成时仅回复 <<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>）。';
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);
      if (edgeAutoHideEl) {
        edgeAutoHideEl.checked = MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
      }

      const beepCfg = getBeepConfig();
      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      if (beepCopySuccessEl) {
        beepCopySuccessEl.checked = beepCfg.copySuccessEnabled !== false;
      }

      const beepVolumeEl = qs('#cgpt-setting-beep-volume', root);
      if (beepVolumeEl) {
        beepVolumeEl.value = String(beepCfg.volume);
      }

      const beepDurationEl = qs('#cgpt-setting-beep-duration', root);
      if (beepDurationEl) {
        beepDurationEl.value = String(beepCfg.durationMs);
      }

      const beepFrequencyEl = qs('#cgpt-setting-beep-frequency', root);
      if (beepFrequencyEl) {
        beepFrequencyEl.value = String(beepCfg.frequency);
      }

      const promptListEl = qs('#cgpt-setting-compact-prompt-list', root);

      if (promptListEl) {
        const promptList = typeof PromptManagerModule !== 'undefined'
          && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts()
          : [];

        promptListEl.innerHTML = renderPromptCheckboxList(
          promptList,
          cfg.quickPromptIds || [],
        );
      }
    }

    function renderShortcutSettings() {
      if (!host) {
        return;
      }

      const cfg = getShortcutConfig();

      const map = [
        {
          action: 'sendMessage',
          enabledId: 'cgpt-shortcut-send-enabled',
          labelId: 'cgpt-shortcut-send-label',
        },
        {
          action: 'copyLastMessage',
          enabledId: 'cgpt-shortcut-copy-enabled',
          labelId: 'cgpt-shortcut-copy-label',
        },
        {
          action: 'startUpload',
          enabledId: 'cgpt-shortcut-upload-enabled',
          labelId: 'cgpt-shortcut-upload-label',
        },
      ];

      map.forEach((item) => {
        const data = cfg[item.action];
        const enabledEl = qs(`#${item.enabledId}`, host);
        const labelEl = qs(`#${item.labelId}`, host);

        if (enabledEl) {
          enabledEl.checked = data.enabled !== false;
        }

        if (labelEl) {
          labelEl.value = data.label || '未设置';
        }
      });
    }

    function bindEvents() {
      function updateShortcutAction(action, patch) {
        const cfg = getShortcutConfig();
        const oldActionConfig = cloneShortcutItem(
          cfg[action],
          DEFAULT_SHORTCUT_CONFIG[action],
        );

        cfg[action] = Object.assign(
          {},
          cfg[action] || {},
          patch || {},
        );

        const conflict = findShortcutConflict(cfg, action);

        if (conflict) {
          cfg[action] = oldActionConfig;

          renderShortcutSettings();
          applyUploadShortcutButtonTitles();

          ToolboxShell.appendLog(
            `[SETTINGS][shortcut-conflict-blocked] action=${action} conflict=${conflict}`,
          );
          ToolboxShell.setStatus(
            `快捷键冲突，已取消保存：${oldActionConfig.label || cfg[action].label || ''}`,
            'warn',
            {
              persist: true,
              shortText: '冲突',
            },
          );
          return;
        }

        saveShortcutConfig(cfg);
        renderShortcutSettings();
        applyUploadShortcutButtonTitles();

        ToolboxShell.appendLog(
          `[SETTINGS][shortcut] action=${action} label=${cfg[action].label || '-'} enabled=${cfg[action].enabled !== false ? '1' : '0'}`
        );
      }

      function bindShortcutEnabled(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('change', () => {
          updateShortcutAction(action, {
            enabled: !!el.checked,
          });
        });
      }

      function bindShortcutClear(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          updateShortcutAction(action, {
            enabled: false,
            label: '',
            key: '',
            code: '',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          });
        });
      }

      function bindShortcutRecord(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          const oldText = el.textContent;
          el.textContent = '按下快捷键...';
          let recordTimer = 0;

          const cleanupRecordListener = () => {
            if (recordTimer) {
              window.clearTimeout(recordTimer);
              recordTimer = 0;
            }

            document.removeEventListener('keydown', onKeyDown, true);
          };

          const onKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
              cleanupRecordListener();
              el.textContent = oldText || '录制';
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:cancel] action=${action}`);
              return;
            }

            const next = shortcutItemFromEvent(e);

            if (next.pureModifier) {
              ToolboxShell.appendLog(
                `[SETTINGS][shortcut-record:wait-main-key] action=${action} key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? 1 : 0} alt=${e.altKey ? 1 : 0} shift=${e.shiftKey ? 1 : 0} meta=${e.metaKey ? 1 : 0}`,
              );
              el.textContent = '继续按主键...';
              return;
            }

            if (!next.key && !next.code) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-key`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            if (!next.label) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-label`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            cleanupRecordListener();

            const shortcutData = {
              enabled: next.enabled,
              label: next.label,
              key: next.key,
              code: next.code,
              ctrl: next.ctrl,
              alt: next.alt,
              shift: next.shift,
              meta: next.meta,
            };

            updateShortcutAction(action, shortcutData);

            ToolboxShell.appendLog(
              `[SETTINGS][shortcut-record:ok] action=${action} label=${next.label}`,
            );

            el.textContent = oldText || '录制';
          };

          recordTimer = window.setTimeout(() => {
            recordTimer = 0;
            el.textContent = oldText || '录制';
            document.removeEventListener('keydown', onKeyDown, true);
            ToolboxShell.appendLog(`[SETTINGS][shortcut-record:timeout] action=${action}`);
          }, 8000);

          document.addEventListener('keydown', onKeyDown, true);
        });
      }

      bindShortcutEnabled('cgpt-shortcut-send-enabled', 'sendMessage');
      bindShortcutEnabled('cgpt-shortcut-copy-enabled', 'copyLastMessage');
      bindShortcutEnabled('cgpt-shortcut-upload-enabled', 'startUpload');

      bindShortcutRecord('cgpt-shortcut-send-record', 'sendMessage');
      bindShortcutRecord('cgpt-shortcut-copy-record', 'copyLastMessage');
      bindShortcutRecord('cgpt-shortcut-upload-record', 'startUpload');

      bindShortcutClear('cgpt-shortcut-send-clear', 'sendMessage');
      bindShortcutClear('cgpt-shortcut-copy-clear', 'copyLastMessage');
      bindShortcutClear('cgpt-shortcut-upload-clear', 'startUpload');

      const resetShortcutBtn = qs('#cgpt-shortcut-reset-defaults', root);
      if (resetShortcutBtn) {
        resetShortcutBtn.addEventListener('click', () => {
          resetShortcutConfig();
          renderShortcutSettings();
          applyUploadShortcutButtonTitles();
          ToolboxShell.appendLog('[SETTINGS][shortcut-reset-defaults]');
        });
      }

      const resetContinuePromptBtn = qs('#cgpt-setting-copy-hotkey-continue-prompt-reset', root);
      if (resetContinuePromptBtn) {
        resetContinuePromptBtn.addEventListener('click', () => {
          const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
          const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
          const defaultStop = typeof DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL === 'string'
            ? DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL
            : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';

          if (promptTextEl) {
            promptTextEl.value = '';
          }
          if (stopSignalEl) {
            stopSignalEl.value = defaultStop;
          }

          const cfg = readFromUi();
          cfg.copyHotkeyContinuePromptText = '';
          cfg.copyHotkeyContinueStopSignal = defaultStop;
          saveConfig(cfg);
          render();
          ToolboxShell.appendLog('[SETTINGS][continue-prompt-reset-defaults]');
        });
      }

      const onCompactSettingChange = () => {
        const cfg = readFromUi();
        saveConfig(cfg);
        render();
      };

      [
        '#cgpt-setting-compact-show-upload-start',
        '#cgpt-setting-compact-show-file-list',
        '#cgpt-setting-upload-show-quick-prompts',
        '#cgpt-setting-compact-show-quick-prompts',
        '#cgpt-setting-global-drop-capture',
        '#cgpt-setting-restore-scroll-after-copy',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-enabled',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-interval',
        '#cgpt-setting-copy-hotkey-loop-home-nav-enabled',
        '#cgpt-setting-copy-hotkey-loop-home-nav-interval',
        '#cgpt-setting-copy-hotkey-loop-home-nav-url',
        '#cgpt-setting-copy-hotkey-continue-stop-signal',
        '#cgpt-setting-copy-hotkey-continue-prompt-text',
        '#cgpt-setting-compact-prompt-action',
        '#cgpt-setting-confirm-prompt-draft-overwrite',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onCompactSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      const listEl = qs('#cgpt-setting-compact-prompt-list', root);
      if (listEl) {
        listEl.addEventListener('change', (e) => {
          const target = e.target;
          if (!(target instanceof HTMLInputElement)) return;
          if (!target.matches('[data-compact-prompt-id]')) return;

          const cfg = readFromUi();
          saveConfig(cfg);
          render();
        });
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);

      if (edgeAutoHideEl) {
        edgeAutoHideEl.addEventListener('change', () => {
          const enabled = !!edgeAutoHideEl.checked;

          if (typeof ToolboxShell.setEdgeAutoHideEnabled === 'function') {
            ToolboxShell.setEdgeAutoHideEnabled(enabled);
          } else {
            MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, enabled);
            ToolboxShell.appendLog(
              `[SETTINGS][edgeAutoHide] ${enabled ? '已开启' : '已关闭'}，但 ToolboxShell.setEdgeAutoHideEnabled 不存在`,
            );
          }

          render();
        });
      }

      const resetPosBtn = qs('#cgpt-setting-reset-toolbox-position', root);
      if (resetPosBtn) {
        resetPosBtn.addEventListener('click', () => {
          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          } else {
            ToolboxShell.appendLog('[SETTINGS][reset-position] ToolboxShell.resetToolboxPosition 不存在');
          }
        });
      }

      const forceShowBtn = qs('#cgpt-setting-force-show-toolbox', root);
      bindOnce(forceShowBtn, 'click', () => {
          if (typeof ToolboxShell.restoreToolboxFromHiddenState === 'function') {
            ToolboxShell.restoreToolboxFromHiddenState('settings-force-show');
          } else if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.__cgptToolboxShow === 'function') {
            unsafeWindow.__cgptToolboxShow();
          } else if (typeof window.__cgptToolboxShow === 'function') {
            window.__cgptToolboxShow();
          } else {
            ToolboxShell.appendLog('[SETTINGS][force-show-toolbox] restoreToolboxFromHiddenState 不存在');
          }

          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          }

          ToolboxShell.appendLog('[SETTINGS][force-show-toolbox]');
      });

      function readBeepFromUi() {
        const volumeEl = qs('#cgpt-setting-beep-volume', root);
        const durationEl = qs('#cgpt-setting-beep-duration', root);
        const frequencyEl = qs('#cgpt-setting-beep-frequency', root);
        const current = getBeepConfig();

        return normalizeBeepConfig({
          ...current,
          volume: volumeEl ? Number(volumeEl.value) : current.volume,
          durationMs: durationEl ? Number(durationEl.value) : current.durationMs,
          frequency: frequencyEl ? Number(frequencyEl.value) : current.frequency,
          type: current.type,
        });
      }

      function bindBeepSettingInput(id) {
        const el = qs(`#${id}`, root);
        bindOnce(el, 'change', () => {
          const cfg = readBeepFromUi();
          saveBeepConfig(cfg);
          ToolboxShell.appendLog(
            `[SETTINGS][beep] volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );
        });
      }

      bindBeepSettingInput('cgpt-setting-beep-volume');
      bindBeepSettingInput('cgpt-setting-beep-duration');
      bindBeepSettingInput('cgpt-setting-beep-frequency');

      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      bindOnce(beepCopySuccessEl, 'change', () => {
        const current = getBeepConfig();
        const cfg = saveBeepConfig({
          ...current,
          copySuccessEnabled: beepCopySuccessEl.checked !== false,
        });

        ToolboxShell.appendLog(
          `[SETTINGS][beep-copy-success] enabled=${cfg.copySuccessEnabled !== false ? '1' : '0'}`,
        );
      }, {
        key: 'change:beep-copy-success-enabled',
        moduleName: 'SETTINGS',
      });

      const settingsBeepRefs = collectDomRefs(root, {
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        testTitleFlash: {
          selector: '#cgpt-setting-test-title-flash',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      bindOnce(settingsBeepRefs.testBeep, 'click', async () => {
          const statusEl = settingsBeepRefs.beepStatus;

          if (statusEl) {
            statusEl.textContent = '正在测试...';
          }

          const cfg = saveBeepConfig(readBeepFromUi());

          ToolboxShell.appendLog(
            `[SETTINGS][beep-test] start volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );

          const unlocked = await unlockToolboxAudio('settings-test');

          if (!unlocked) {
            if (statusEl) {
              statusEl.textContent = '测试失败：浏览器音频未解锁';
            }

            ToolboxShell.appendLog('[SETTINGS][beep-test] failed reason=unlock-failed');
            return;
          }

          const ok = await playToolboxBeep('settings-test', {
            volume: cfg.volume,
            durationMs: cfg.durationMs,
            frequency: cfg.frequency,
            type: cfg.type,
          });

          if (statusEl) {
            statusEl.textContent = ok
              ? '已播放测试蜂鸣'
              : '测试失败，请查看日志';
          }

          ToolboxShell.appendLog(`[SETTINGS][beep-test] result=${ok ? 'ok' : 'failed'}`);
      });

      bindOnce(settingsBeepRefs.testTitleFlash, 'click', () => {
        const statusEl = settingsBeepRefs.beepStatus;

        if (
          typeof TitlePrefixModule !== 'undefined'
          && typeof TitlePrefixModule.startReplyDoneFlash === 'function'
        ) {
          TitlePrefixModule.startReplyDoneFlash('settings-test');

          if (statusEl) {
            statusEl.textContent = '已开始测试标题闪烁';
          }

          ToolboxShell.appendLog('[SETTINGS][title-flash-test] start');
          return;
        }

        if (statusEl) {
          statusEl.textContent = '测试失败：标题闪烁模块不可用';
        }

        ToolboxShell.appendLog('[SETTINGS][title-flash-test] failed reason=module-missing');
      });

      const settingsSubtabs = qs('#cgpt-settings-subtabs', root);
      bindOnce(settingsSubtabs, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-settings-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeSettingsSubtab = btn.getAttribute('data-settings-subtab') || 'basic';
          MemoryManager.set('settingsActiveSubtab', activeSettingsSubtab);
          renderSettingsSubtabs();

          ToolboxShell.appendLog(`[SETTINGS][subtab] active=${activeSettingsSubtab}`);
      });
    }

    function mount(target) {
      host = target;
      if (!host) return;

      host.innerHTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">设置</div>

          <div class="cgpt-settings-subtabs" id="cgpt-settings-subtabs">
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="basic">基础</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="shortcut">快捷键</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="ui">界面</button>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="basic">
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-edge-auto-hide">
              工具箱贴边自动隐藏
            </label>
            <div class="cgpt-hint">开启后，拖动工具箱贴住浏览器右边缘后自动收起，只保留边缘把手；只是靠近边缘不会隐藏。关闭后只保留普通拖拽，不自动隐藏。</div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position">重置工具箱位置</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-force-show-toolbox">强制显示工具箱</button>
            </div>
            <div class="cgpt-hint">当工具箱跑出屏幕、贴边状态异常或隐藏后找不到入口时，可先点「强制显示工具箱」，再按需重置位置。</div>

            <div class="cgpt-section-title" style="margin-top: 12px;">蜂鸣器</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-beep-copy-success-enabled">
              复制成功后播放蜂鸣器
            </label>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-volume">音量</label>
              <input type="range" class="cgpt-input" id="cgpt-setting-beep-volume" min="0.05" max="1" step="0.05">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-duration">时长 (毫秒)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-duration" data-no-wheel-number="1" min="30" max="10000" step="10">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-frequency">频率 (Hz)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-frequency" data-no-wheel-number="1" min="80" max="6000" step="10">
            </div>
            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-test-beep">测试蜂鸣器</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-test-title-flash">测试标题闪烁</button>
              <span class="cgpt-hint" id="cgpt-setting-beep-status">未测试</span>
            </div>
            <div class="cgpt-hint">蜂鸣器用于复制成功提醒；浏览器可能要求先点击页面或工具箱一次后才允许播放声音。</div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="shortcut">
            <div class="cgpt-hint">
              点击录制后，按下完整快捷键。例如：Ctrl+Alt+C。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。
            </div>

            <div class="cgpt-shortcut-settings">
              <div class="cgpt-shortcut-row" data-shortcut-action="sendMessage">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-send-enabled">
                  启用发送信息快捷键
                </label>
                <input id="cgpt-shortcut-send-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="copyLastMessage">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-copy-enabled">
                  启用复制最后回复快捷键
                </label>
                <input id="cgpt-shortcut-copy-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="startUpload">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-upload-enabled">
                  启用开始上传快捷键
                </label>
                <input id="cgpt-shortcut-upload-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-clear">清空</button>
              </div>

              <div class="cgpt-row">
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-reset-defaults">
                  恢复默认快捷键
                </button>
              </div>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="ui">
            <div class="cgpt-section-title" style="margin-top: 4px;">精简模式显示内容</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-start">
              显示上传按钮
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-file-list">
              显示上传文件列表
            </label>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-upload-show-quick-prompts">
              上传页显示常用 Prompt 快捷区
            </label>
            <div class="cgpt-hint">开启后，在多文件上传页显示常用 Prompt 快捷按钮。</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-quick-prompts">
              精简模式显示常用 Prompt 快捷区
            </label>

            <div class="cgpt-kv">
              <label>Prompt 动作</label>
              <select class="cgpt-select" id="cgpt-setting-compact-prompt-action">
                <option value="send">填入并发送</option>
                <option value="fill">只填入输入框</option>
              </select>
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-confirm-prompt-draft-overwrite">
              覆盖输入框草稿前弹窗确认
            </label>
            <div class="cgpt-hint">关闭时，点击常用 Prompt 或 Prompt 管理发送会直接覆盖输入框已有内容，不再弹出浏览器确认框。</div>

            <div class="cgpt-section-title" style="margin-top: 10px;">常用 Prompt 快捷区</div>
            <div class="cgpt-hint">选择要显示在上传页快捷区域的 Prompt。点击后默认填入并发送到 ChatGPT，也可改为只填入输入框。</div>
            <div id="cgpt-setting-compact-prompt-list" class="cgpt-settings-prompt-list"></div>

            <div class="cgpt-section-title" style="margin-top: 10px;">拖拽上传</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-global-drop-capture">
              页面空白处拖入文件时加入工具箱队列
            </label>
            <div class="cgpt-hint">拖到 ChatGPT 输入框仍由 ChatGPT 原生处理；拖到工具箱面板内始终加入队列。</div>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制回复</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-restore-scroll-after-copy">
              复制最后消息后恢复原滚动位置
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">连续复制+快捷键+继续（循环附加）</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-copy-hotkey-loop-auto-upload-enabled">
              每隔指定轮数自动重新上传当前分组文件
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-auto-upload-interval">上传间隔轮数</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-auto-upload-interval" data-no-wheel-number="1" min="1" max="999" step="1">
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-copy-hotkey-loop-home-nav-enabled">
              每隔指定轮数页内跳转到 ChatGPT 主页
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-home-nav-interval">跳转间隔轮数</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-home-nav-interval" data-no-wheel-number="1" min="1" max="999" step="1">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-home-nav-url">跳转地址</label>
              <input type="text" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-home-nav-url">
            </div>

            <div class="cgpt-hint">
              默认每 5 轮重新上传一次文件，每 20 轮页内跳转到 https://chatgpt.com/。如果同一轮同时命中上传和跳转，优先跳转，避免旧页面重复上传。
            </div>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制+快捷键+继续</div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-continue-stop-signal">终止信号</label>
              <input
                type="text"
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-stop-signal"
                placeholder="<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>"
              >
            </div>

            <div class="cgpt-kv cgpt-kv-vertical">
              <label for="cgpt-setting-copy-hotkey-continue-prompt-text">继续指令</label>
              <textarea
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-prompt-text"
                rows="12"
                style="width: 100%; resize: vertical;"
                placeholder="留空则使用内置默认继续指令（完成时仅回复 <<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>）。"
              ></textarea>
            </div>

            <div class="cgpt-row">
              <button type="button" class="cgpt-btn" id="cgpt-setting-copy-hotkey-continue-prompt-reset">
                恢复默认继续指令
              </button>
            </div>

            <div class="cgpt-hint">
              单次或连续「复制+快捷键+继续」会发送上面的继续指令。若 ChatGPT 仅回复终止信号（整段回复只有这一行），将停止复制、快捷键与继续发送。
            </div>
          </div>
        </div>
      `;

      root = host;

      collectDomRefs(root, {
        subtabs: '#cgpt-settings-subtabs',
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      activeSettingsSubtab = MemoryManager.get('settingsActiveSubtab', 'basic');
      bindEvents();
      render();
      renderShortcutSettings();
      renderSettingsSubtabs();
    }

    return {
      mount,
      getConfig,
      saveConfig,
    };
  })();

  /********************************************************************
   * 6. BridgeModule：浏览器桥接模   ********************************************************************/

  const BridgeModule = (() => {
    const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:5000';
    const DEFAULT_BRIDGE_PATH = '/api/bridge';
    const SOURCE = 'tampermonkey';
    const SCRIPT_VERSION = 'merged-bridge-1.0.0';
    const CLIENT_ID_KEY = 'tm_bridge_client_id';
    const PAGE_INSTANCE_ID = getToolboxPageInstanceId();

    const state = {
      root: null,
      timerId: 0,
      bridgeRunId: 0,
      polling: false,
      handlingMessageId: null,
      lastBusyHeartbeatAt: 0,
      lastIdentityKey: '',
      lastIdentityLogKey: '',
      pendingIdentityOldKey: '',
      pendingIdentityReason: '',
      pageIdentityListenersInstalled: false,
      lastErrorLogAt: 0,
      lastErrorText: '',
      uploadBlockNextChatReason: '',
      uploadBlockNextChatAt: 0,
      uploadBlockNextChatSourceMessageId: '',
      pendingReplyContext: null,
      lastReplyWatchResponding: false,
      bridgeChatQueue: [],
      advancedCapabilityExpanded: false,
    };

    const bridgeTimers = createTimerRegistry('BRIDGE');

    const bridgeStatus = createModuleStatus('BRIDGE', {
      getLocalEl: () => (state.root ? qs('#cgpt-bridge-status', state.root) : null),
      useGlobal: false,
      useLog: false,
    });

    const CLIENT_ID = (() => {
      try {
        const saved = sessionStorage.getItem(CLIENT_ID_KEY);
        if (saved) return saved;
        const created = `tm-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(CLIENT_ID_KEY, created);
        return created;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const tempId = `tm-${Math.random().toString(36).slice(2, 10)}`;

        console.error('[BridgeModule] 无法使用 sessionStorage，使用临时 CLIENT_ID:', error);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][CLIENT_ID][TEMP] type=${errName} client_id=${tempId} error=${errText}`,
          );
        }

        return tempId;
      }
    })();

    function buildVisibilityPayload() {
      const visibilityState = document.visibilityState || 'unknown';
      const hasFocus = document.hasFocus();

      return {
        visibility_state: visibilityState,
        has_focus: hasFocus,
      };
    }

    function getConfig() {
      return {
        bridgeEnabled: true,
        bridgeBaseUrl: normalizeBridgeBaseUrl(MemoryManager.get('bridgeBaseUrl', DEFAULT_BRIDGE_BASE_URL)),
        bridgePath: normalizeBridgePath(MemoryManager.get('bridgePath', DEFAULT_BRIDGE_PATH)),
        bridgeApiToken: String(MemoryManager.get('bridgeApiToken', '') || '').trim(),
        bridgeDebugEnabled: !!MemoryManager.get('bridgeDebugEnabled', false),
        bridgeRequestTimeoutMs: Number(MemoryManager.get('bridgeRequestTimeoutMs', 30000)) || 30000,
        bridgePollIntervalMs: Number(MemoryManager.get('bridgePollIntervalMs', 1000)) || 1000,
      };
    }

    function saveConfig(patch) {
      Object.keys(patch || {}).forEach((key) => {
        if (key === 'bridgeEnabled') {
          return;
        }
        MemoryManager.set(key, patch[key]);
      });
      MemoryManager.set('bridgeEnabled', true);
    }

    function normalizeBridgeBaseUrl(value) {
      let text = String(value || '').trim();
      if (!text) return DEFAULT_BRIDGE_BASE_URL;
      text = text.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(text)) {
        text = `http://${text}`;
      }
      return text;
    }

    function normalizeBridgePath(value) {
      const text = String(value || DEFAULT_BRIDGE_PATH).trim();
      return text.startsWith('/') ? text : `/${text}`;
    }

    function getBridgeUrl() {
      const cfg = getConfig();
      return `${cfg.bridgeBaseUrl}${cfg.bridgePath}`;
    }

    function logBridgeError(text, errorObj) {
      const now = Date.now();
      const content = String(text || 'unknown_error');
      const shouldLog = content !== state.lastErrorText || (now - state.lastErrorLogAt) >= 5000;
      if (!shouldLog) return;
      state.lastErrorText = content;
      state.lastErrorLogAt = now;
      if (errorObj) {
        console.error('[BridgeModule]', content, errorObj);
      } else {
        console.error('[BridgeModule]', content);
      }
      ToolboxShell.appendLog(`[BRIDGE][ERROR] ${content}`);
    }

    function debugLog(text) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;
      ToolboxShell.appendLog(`[BRIDGE][DEBUG] ${String(text || '')}`);
    }

    function buildBridgeHeaders() {
      const cfg = getConfig();
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Source': SOURCE,
      };
      if (cfg.bridgeApiToken) {
        headers.Authorization = `Bearer ${cfg.bridgeApiToken}`;
        headers['X-API-Key'] = cfg.bridgeApiToken;
      }
      return headers;
    }

    function detectResponseState() {
      return detectComposerResponseState();
    }

    function bridgeUrlFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      return String(obj.url || '').trim();
    }

    function bridgeContentFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      return String(obj.content || '').trim();
    }

    function normalizeBridgePollMessage(raw) {
      if (!raw || typeof raw !== 'object') {
        return raw;
      }
      const messageId = String(raw.message_id || '').trim();
      const content = bridgeContentFrom(raw);
      const url = bridgeUrlFrom(raw);
      const normalized = {
        ...raw,
        message_id: messageId,
        content,
      };
      if (url) {
        normalized.url = url;
      }
      return normalized;
    }

    function withBridgeUrlFields(fields) {
      const patch = fields && typeof fields === 'object' ? { ...fields } : {};
      const url = bridgeUrlFrom(patch) || location.href;
      patch.url = url;
      return patch;
    }

    const BIND_TOKEN_META_KEY = 'xz_bind_token_meta';
    const BIND_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;

    function clearStoredBindRequestToken(reason = '') {
      try {
        sessionStorage.removeItem('xz_bind_token');
        sessionStorage.removeItem(BIND_TOKEN_META_KEY);
        const conversationId = parseConversationIdFromPath(location.pathname || '') || '';
        ToolboxShell.appendLog(
          `[BRIDGE][BIND_TOKEN][CLEAR] reason=${reason || '-'} `
            + `client_id=${CLIENT_ID} `
            + `page_instance_id=${PAGE_INSTANCE_ID} `
            + `conversation_id=${conversationId || '-'}`,
        );
      } catch (error) {
        logBridgeError(
          `clearStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function saveStoredBindRequestToken(token) {
      const value = String(token || '').trim();
      if (!value) {
        return;
      }

      const meta = {
        token: value,
        client_id: CLIENT_ID,
        page_instance_id: PAGE_INSTANCE_ID,
        savedAt: Date.now(),
      };

      sessionStorage.setItem('xz_bind_token', value);
      sessionStorage.setItem(BIND_TOKEN_META_KEY, JSON.stringify(meta));
      ToolboxShell.appendLog(
        `[BRIDGE][BIND_TOKEN][SAVE] client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
      );
    }

    function clearBindRequestTokenFromLocation(reason = '') {
      try {
        const url = new URL(location.href);
        let changed = false;

        if (url.searchParams.has('xz_bind_token')) {
          url.searchParams.delete('xz_bind_token');
          changed = true;
        }

        const hash = String(url.hash || '');
        if (hash.includes('xz_bind_token=')) {
          const parts = hash.slice(1).split('&').filter((part) => part && !part.startsWith('xz_bind_token='));
          url.hash = parts.length ? `#${parts.join('&')}` : '';
          changed = true;
        }

        if (changed) {
          history.replaceState(history.state, document.title, url.toString());
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][URL_CLEAN] reason=${reason || '-'} client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
          );
        }
      } catch (error) {
        logBridgeError(
          `clearBindRequestTokenFromLocation failed: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function readStoredBindRequestToken() {
      try {
        const rawMeta = sessionStorage.getItem(BIND_TOKEN_META_KEY);
        if (!rawMeta) {
          const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();
          if (legacy) {
            clearStoredBindRequestToken('legacy-without-meta');
          }
          return '';
        }

        const meta = JSON.parse(rawMeta);
        const token = String(meta && meta.token ? meta.token : '').trim();
        const savedAt = Number(meta && meta.savedAt ? meta.savedAt : 0);
        const metaClientId = String(meta && meta.client_id ? meta.client_id : '').trim();
        const metaPageInstanceId = String(meta && meta.page_instance_id ? meta.page_instance_id : '').trim();
        if (!token) {
          clearStoredBindRequestToken('empty-token');
          return '';
        }

        if (!savedAt || Date.now() - savedAt > BIND_TOKEN_MAX_AGE_MS) {
          clearStoredBindRequestToken('expired');
          return '';
        }

        if (!metaPageInstanceId) {
          clearStoredBindRequestToken('missing-page-instance-id');
          return '';
        }

        if (metaPageInstanceId !== PAGE_INSTANCE_ID) {
          clearStoredBindRequestToken('page-instance-mismatch');
          return '';
        }

        if (metaClientId && metaClientId !== CLIENT_ID) {
          clearStoredBindRequestToken('client-id-mismatch');
          return '';
        }

        return token;
      } catch (error) {
        clearStoredBindRequestToken('read-meta-failed');
        logBridgeError(
          `readStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
        return '';
      }
    }

    function getBindRequestToken() {
      try {
        const url = new URL(location.href);
        const fromQuery = url.searchParams.get('xz_bind_token');
        if (fromQuery) {
          saveStoredBindRequestToken(fromQuery);
          clearBindRequestTokenFromLocation('query');
          return fromQuery;
        }
        const hash = String(location.hash || '');
        const match = hash.match(/xz_bind_token=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          saveStoredBindRequestToken(match[1]);
          clearBindRequestTokenFromLocation('hash');
          return match[1];
        }
        return readStoredBindRequestToken();
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);

        logBridgeError(
          `[getBindRequestToken][failed] type=${errName} url=${location.href} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][FAILED] type=${errName} url=${location.href} error=${errText}`,
          );
        }

        if (typeof updateStatus === 'function') {
          updateStatus(`绑定 token 获取失败：${errText}`);
        }

        return '';
      }
    }

    function logIdentityThrottled(identity) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;

      const key = [
        identity.page_type || '',
        identity.conversation_id || '',
        identity.pathname || '',
        identity.visibility_state || '',
        identity.has_focus ? 'focus' : 'blur',
      ].join('|');

      const now = Date.now();

      if (key === state.lastIdentityLogKey && now - Number(state.lastIdentityLogAt || 0) < 5000) {
        return;
      }

      state.lastIdentityLogKey = key;
      state.lastIdentityLogAt = now;

      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY] page_type=${identity.page_type || '-'} conversation_id=${identity.conversation_id || '-'} pathname=${identity.pathname || '-'}`,
      );
    }

    function getCurrentBridgePageDisplayId() {
      try {
        if (typeof getBridgePageDisplayIdText === 'function') {
          const value = String(getBridgePageDisplayIdText() || '').trim();
          if (value && value !== '-') return value;
        }
      } catch (error) {
        console.error('[BRIDGE][PAGE_ID][READ_FAILED]', error);
      }

      try {
        if (typeof BRIDGE_STATE !== 'undefined' && BRIDGE_STATE) {
          const value = String(
            BRIDGE_STATE.page_display_id
            || BRIDGE_STATE.page_no
            || '',
          ).trim();

          if (value && value !== '-') return value;
        }
      } catch (error) {
        console.error('[BRIDGE][PAGE_ID][STATE_READ_FAILED]', error);
      }

      return '';
    }

    function getPageIdentity() {
      try {
        const url = new URL(location.href);
        const path = url.pathname || '';

        let pageType = 'unknown';
        const conversationId = parseConversationIdFromPath(path);
        const bindToken = getBindRequestToken();
        const hasBindTokenInUrl = Boolean(
          url.searchParams.get('xz_bind_token')
          || (url.hash && url.hash.includes('xz_bind_token=')),
        );
        if (conversationId) {
          pageType = 'conversation';
        } else if (path === '/' || path === '' || hasBindTokenInUrl) {
          pageType = 'home';
        } else if (path.startsWith('/backend-api/') || path.includes('/sentinel/')) {
          pageType = 'ignored';
        } else {
          pageType = 'other';
        }

        const responseState = detectResponseState();
        const visibilityPayload = buildVisibilityPayload();
        const pageDisplayId = getCurrentBridgePageDisplayId();
        const identity = {
          client_id: CLIENT_ID,
          page_instance_id: PAGE_INSTANCE_ID,
          page_display_id: pageDisplayId,
          page_no: pageDisplayId,
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          url: location.href,
          page_title: document.title || '',
          page_type: pageType,
          conversation_id: conversationId,
          bind_request_id: bindToken,
          is_top_frame: window.top === window.self,

          ...visibilityPayload,

          heartbeat_alive: true,
          pathname: location.pathname,
          last_seen: Date.now() / 1000,
          is_responding: Boolean(responseState.is_responding),
          response_state: responseState.response_state || 'unknown',
          response_state_reason: responseState.response_state_reason || '',
          response_state_at: responseState.response_state_at || Date.now(),
          can_accept_input: Boolean(responseState.can_accept_input),
          can_send_now: Boolean(responseState.can_send_now),
        };
        logIdentityThrottled(identity);
        logPageCapability(getPageCapability('getPageIdentity'), '[BRIDGE][IDENTITY]');

        return identity;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const fallbackPathname = location && location.pathname ? location.pathname : '';
        const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);

        logBridgeError(
          `[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,
          );
        }

        const fallbackPageDisplayId = getCurrentBridgePageDisplayId();
        return {
          client_id: CLIENT_ID,
          page_instance_id: PAGE_INSTANCE_ID,
          page_display_id: fallbackPageDisplayId,
          page_no: fallbackPageDisplayId,
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          url: location.href,
          page_title: document.title || '',
          page_type: fallbackConversationId ? 'conversation' : 'unknown',
          conversation_id: fallbackConversationId || '',
          bind_request_id: '',
          is_top_frame: window.top === window.self,
          ...buildVisibilityPayload(),
          heartbeat_alive: true,
          pathname: fallbackPathname,
          last_seen: Date.now() / 1000,
          is_responding: false,
          response_state: 'unknown',
          response_state_reason: `identity_exception:${errName}`,
          response_state_at: Date.now(),
          can_accept_input: false,
          can_send_now: false,
          identity_error: errText,
        };
      }
    }

    const DEBUG_FULL_BRIDGE_JSON = true;

    const BRIDGE_JSON_QUIET_REPORT_EVENTS = new Set([
      'focus_state',
      'page_heartbeat',
      'heartbeat',
      'heartbeat_busy',
      'status_timer',
    ]);

    function buildBridgeRequestPayload(body) {
      return {
        ...getPageIdentity(),
        ...(body || {}),
      };
    }

    function stringifyFullBridgeJsonForLog(obj) {
      try {
        return JSON.stringify(obj, null, 0);
      } catch (error) {
        console.error('[BRIDGE][JSON][STRINGIFY_FAILED]', {
          error_type: error && error.name ? error.name : 'Error',
          error: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
        return String(obj);
      }
    }

    function shouldLogFullBridgeJson(payload) {
      if (!DEBUG_FULL_BRIDGE_JSON || !payload) {
        return false;
      }
      const action = String(payload.action || '').trim();
      const event = String(payload.event || '').trim();
      if (
        action === 'poll'
        || action === 'ack'
        || action === 'hello'
        || action === 'register'
        || action === 'assistant_reply'
      ) {
        return true;
      }
      if (action === 'report') {
        if (BRIDGE_JSON_QUIET_REPORT_EVENTS.has(event)) {
          return false;
        }
        return true;
      }
      return false;
    }

    function appendBridgeJsonToolboxLog(line) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(line);
      }
    }

    function logTmToServerFull(payload) {
      const jsonText = stringifyFullBridgeJsonForLog(payload);
      console.log('[BRIDGE][JSON][TM_TO_SERVER_FULL]', {
        action: payload && payload.action,
        event: payload && payload.event,
        client_id: payload && payload.client_id,
        page_instance_id: payload && payload.page_instance_id,
        conversation_id: payload && payload.conversation_id,
        message_id: payload && payload.message_id,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][TM_TO_SERVER_FULL] action=${payload.action || '-'} event=${payload.event || '-'} `
        + `client_id=${payload.client_id || '-'} page_instance_id=${payload.page_instance_id || '-'} `
        + `conversation_id=${payload.conversation_id || '-'} message_id=${payload.message_id || '-'} `
        + `json=${jsonText}`,
      );
    }

    function logServerToTmFull(requestPayload, responseJson) {
      const jsonText = stringifyFullBridgeJsonForLog(responseJson);
      console.log('[BRIDGE][JSON][SERVER_TO_TM_FULL]', {
        action: requestPayload && requestPayload.action,
        event: requestPayload && requestPayload.event,
        request_message_id: requestPayload && requestPayload.message_id,
        response_message_id: responseJson && responseJson.message_id,
        ok: responseJson && responseJson.ok,
        has_message: responseJson && responseJson.has_message,
        type: responseJson && responseJson.type,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][SERVER_TO_TM_FULL] action=${requestPayload.action || '-'} event=${requestPayload.event || '-'} `
        + `ok=${responseJson && responseJson.ok} has_message=${responseJson && responseJson.has_message} `
        + `type=${responseJson && responseJson.type || '-'} json=${jsonText}`,
      );
    }

    function logAssistantReplyReportFull(reportPayload, messageId) {
      const payload = reportPayload || {};
      const jsonText = stringifyFullBridgeJsonForLog(payload);
      console.log('[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL]', {
        message_id: messageId || payload.message_id,
        session_id: payload.session_id,
        turn_id: payload.turn_id,
        client_id: payload.client_id,
        page_instance_id: payload.page_instance_id,
        conversation_id: payload.conversation_id,
        response_state: payload.response_state,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL] message_id=${messageId || payload.message_id || '-'} `
        + `session_id=${payload.session_id || '-'} turn_id=${payload.turn_id || '-'} `
        + `client_id=${payload.client_id || '-'} json=${jsonText}`,
      );
    }

    function apiRequest(body) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          const error = new Error('GM_xmlhttpRequest 不可用，请检查油猴 @grant 和 @connect 权限');
          logBridgeError(error.message, error);
          reject(error);
          return;
        }

        const cfg = getConfig();
        const reqUrl = getBridgeUrl();
        const payload = buildBridgeRequestPayload(body);
        if (shouldLogFullBridgeJson(payload)) {
          logTmToServerFull(payload);
        }
        GM_xmlhttpRequest({
          method: 'POST',
          url: reqUrl,
          headers: buildBridgeHeaders(),
          data: JSON.stringify(payload),
          timeout: cfg.bridgeRequestTimeoutMs,
          onload(response) {
            const action = body && body.action ? body.action : '-';
            const responseText = String(response.responseText || '');
            const responsePreview = responseText.slice(0, 500).replace(/\s+/g, ' ');

            if (response.status < 200 || response.status >= 300) {
              const error = new Error(
                `HTTP ${response.status} action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][http-failed] action=${action} url=${reqUrl} status=${response.status} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(error);
              return;
            }
            try {
              const responseJson = JSON.parse(response.responseText);
              if (shouldLogFullBridgeJson(payload)) {
                logServerToTmFull(payload, responseJson);
              }
              resolve(responseJson);
            } catch (error) {
              const parseError = new Error(
                `响应解析失败 action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][json-parse-failed] action=${action} url=${reqUrl} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(parseError);
            }
          },
          onerror(error) {
            logBridgeError(`请求失败: ${error && error.message ? error.message : String(error)}`, error);
            reject(error);
          },
          ontimeout() {
            const error = new Error(`请求超时 (${cfg.bridgeRequestTimeoutMs}ms): ${reqUrl}`);
            logBridgeError(error.message, error);
            reject(error);
          },
        });
      });
    }

    async function ack(messageId, success, detail) {
      const result = await apiRequest({
        action: 'ack',
        message_id: messageId,
        success,
        detail: detail || '',
      });
      updateChatInputStateBadge();
      return result;
    }

    async function report(event, payload, messageId, options = {}) {
      try {
        await apiRequest({
          action: 'report',
          event,
          payload: payload || {},
          message_id: messageId || null,
        });
        return { ok: true };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[REPORT] ${errText}`, error);

        if (options.throwOnError === true) {
          throw error;
        }

        return { ok: false, error: errText };
      }
    }

    async function reportStrict(event, payload, messageId) {
      return report(event, payload, messageId, { throwOnError: true });
    }

    async function reportBestEffort(event, payload, messageId) {
      return report(event, payload, messageId);
    }

    function reportFocusState(reason) {
      void reportBestEffort('focus_state', {
        reason: reason || '-',
        has_focus: document.hasFocus(),
        visibility_state: document.visibilityState,
        url: location.href,
        page_title: document.title || '',
        event_at: Date.now(),
      });
    }

    function installFocusStateListeners() {
      if (state.focusStateListenersInstalled) {
        return;
      }
      state.focusStateListenersInstalled = true;
      state.onWindowFocus = () => reportFocusState('window_focus');
      state.onWindowBlur = () => reportFocusState('window_blur');
      state.onVisibilityChange = () => reportFocusState('visibilitychange');
      window.addEventListener('focus', state.onWindowFocus, true);
      window.addEventListener('blur', state.onWindowBlur, true);
      document.addEventListener('visibilitychange', state.onVisibilityChange, true);
    }

    function removeFocusStateListeners() {
      if (!state.focusStateListenersInstalled) {
        return;
      }
      if (state.onWindowFocus) {
        window.removeEventListener('focus', state.onWindowFocus, true);
      }
      if (state.onWindowBlur) {
        window.removeEventListener('blur', state.onWindowBlur, true);
      }
      if (state.onVisibilityChange) {
        document.removeEventListener('visibilitychange', state.onVisibilityChange, true);
      }
      state.onWindowFocus = null;
      state.onWindowBlur = null;
      state.onVisibilityChange = null;
      state.focusStateListenersInstalled = false;
    }

    function shouldBridgeWaitReplyAfterBusyFailure(reason) {
      const normalized = String(reason || '').trim().toLowerCase();
      if (!normalized.includes('assistant_busy')) {
        return false;
      }
      return normalized.includes('send_not_confirmed')
        || normalized === 'assistant_busy';
    }

    const LEGACY_PENDING_REPLY_CONTEXT_KEY = 'cgpt_pending_reply_context';

    function getPendingReplyContextKey(pageInstanceId = PAGE_INSTANCE_ID) {
      const safeId = String(pageInstanceId || CLIENT_ID || 'default').trim() || 'default';
      return `cgpt_pending_reply_context:${safeId}`;
    }

    function getConversationIdFromLocation() {
      return parseConversationIdFromPath(location.pathname || '') || '';
    }

    function hasAnyPendingReplyContextIdentity(ctx) {
      return !!(
        String(ctx && ctx.page_instance_id || '').trim()
        || String(ctx && ctx.client_id || '').trim()
        || String(ctx && ctx.conversation_id || '').trim()
      );
    }

    function isPendingReplyContextForCurrentPage(ctx) {
      if (!ctx || typeof ctx !== 'object') {
        return false;
      }

      if (!hasAnyPendingReplyContextIdentity(ctx)) {
        return false;
      }

      const identity = getPageIdentity();
      const currentPageInstanceId = String(
        identity.page_instance_id || PAGE_INSTANCE_ID || '',
      ).trim();
      const currentClientId = String(identity.client_id || CLIENT_ID || '').trim();
      const currentConversationId = getConversationIdFromLocation();

      const ctxPageInstanceId = String(ctx.page_instance_id || '').trim();
      const ctxClientId = String(ctx.client_id || '').trim();
      const ctxConversationId = String(ctx.conversation_id || '').trim();

      if (ctxPageInstanceId && currentPageInstanceId && ctxPageInstanceId !== currentPageInstanceId) {
        return false;
      }

      if (ctxClientId && currentClientId && ctxClientId !== currentClientId) {
        return false;
      }

      if (ctxConversationId) {
        if (!currentConversationId) {
          return false;
        }
        if (ctxConversationId !== currentConversationId) {
          return false;
        }
      }

      return true;
    }

    function logIgnoredForeignPendingReplyContext(ctx, phase) {
      console.info('[AUTOQ][PENDING_REPLY][IGNORE_FOREIGN_CONTEXT]', {
        phase: phase || '-',
        ctx_page_instance_id: ctx && ctx.page_instance_id,
        ctx_client_id: ctx && ctx.client_id,
        ctx_conversation_id: ctx && ctx.conversation_id,
        current_page_instance_id: PAGE_INSTANCE_ID,
        current_client_id: CLIENT_ID,
        current_conversation_id: getConversationIdFromLocation(),
      });
    }

    function parsePendingReplyContextRaw(raw) {
      if (!raw) {
        return null;
      }

      const ctx = JSON.parse(raw);
      if (!ctx || !ctx.message_id || ctx.reply_reported) {
        return null;
      }

      return ctx;
    }

    function savePendingReplyContext(message) {
      if (!message || !message.message_id) {
        return;
      }

      const identity = getPageIdentity();
      const replyBaseline = typeof getBridgeReplyBaseline === 'function'
        ? getBridgeReplyBaseline()
        : null;
      const ctx = {
        message_id: String(message.message_id || '').trim(),
        session_id: String(message.session_id || '').trim(),
        turn_id: String(message.turn_id || '').trim(),
        client_id: String(message.client_id || identity.client_id || CLIENT_ID || '').trim(),
        page_instance_id: String(
          message.page_instance_id || identity.page_instance_id || PAGE_INSTANCE_ID || '',
        ).trim(),
        conversation_id: String(
          message.conversation_id || identity.conversation_id || '',
        ).trim(),
        url: String(message.url || location.href || '').trim(),
        sent_content: String(message.content || '').trim(),
        sent_at: Date.now(),
        reply_reported: false,
        reply_baseline: replyBaseline,
      };

      state.pendingReplyContext = ctx;

      try {
        const pageKey = getPendingReplyContextKey();
        localStorage.setItem(pageKey, JSON.stringify(ctx));

        const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';
        if (legacyRaw) {
          let legacyCtx = null;
          try {
            legacyCtx = JSON.parse(legacyRaw);
          } catch (legacyParseError) {
            console.error('[REPLY_CONTEXT][LEGACY_PARSE_FAILED]', {
              error_type: legacyParseError && legacyParseError.name,
              error: legacyParseError && legacyParseError.message,
              stack: legacyParseError && legacyParseError.stack,
            });
          }

          if (!legacyCtx || isPendingReplyContextForCurrentPage(legacyCtx)) {
            localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
          }
        }
      } catch (error) {
        console.error('[REPLY_CONTEXT][SAVE_FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
      }

      console.log('[REPLY_CONTEXT][SAVE]', ctx);
    }

    function loadPendingReplyContext() {
      if (state.pendingReplyContext && !state.pendingReplyContext.reply_reported) {
        if (isPendingReplyContextForCurrentPage(state.pendingReplyContext)) {
          return state.pendingReplyContext;
        }

        logIgnoredForeignPendingReplyContext(state.pendingReplyContext, 'memory-cache');
        state.pendingReplyContext = null;
      }

      try {
        const pageKey = getPendingReplyContextKey();
        let raw = localStorage.getItem(pageKey) || '';

        if (!raw) {
          const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';
          if (!legacyRaw) {
            return null;
          }

          const legacyCtx = parsePendingReplyContextRaw(legacyRaw);
          if (!legacyCtx) {
            return null;
          }

          if (!hasAnyPendingReplyContextIdentity(legacyCtx)) {
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog('[AUTOQ][PENDING_REPLY][IGNORE_LEGACY_CONTEXT_WITHOUT_IDENTITY]');
            }
            console.info('[AUTOQ][PENDING_REPLY][IGNORE_LEGACY_CONTEXT_WITHOUT_IDENTITY]');
            localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
            return null;
          }

          if (!isPendingReplyContextForCurrentPage(legacyCtx)) {
            logIgnoredForeignPendingReplyContext(legacyCtx, 'legacy-load');
            return null;
          }

          localStorage.setItem(pageKey, legacyRaw);
          localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
          raw = legacyRaw;
        }

        const ctx = parsePendingReplyContextRaw(raw);
        if (!ctx) {
          return null;
        }

        if (!isPendingReplyContextForCurrentPage(ctx)) {
          logIgnoredForeignPendingReplyContext(ctx, 'page-key-load');
          return null;
        }

        state.pendingReplyContext = ctx;
        return ctx;
      } catch (error) {
        console.error('[REPLY_CONTEXT][LOAD_FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return null;
      }
    }

    function extractLatestAssistantMessageText() {
      let text = '';
      const ctx = loadPendingReplyContext();
      if (ctx && typeof extractBridgeAssistantReplyText === 'function') {
        try {
          text = extractBridgeAssistantReplyText(ctx.reply_baseline || null);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[REPLY_REPORT][EXTRACT_BASELINE_FAILED] error=${errText}`, error);
        }
      }

      if (!text && typeof getLatestAssistantTextFromDomDirect === 'function') {
        text = getLatestAssistantTextFromDomDirect();
      }

      if (!text) {
        const nodes = [];

        document
          .querySelectorAll('[data-message-author-role="assistant"]')
          .forEach((node) => nodes.push(node));

        if (!nodes.length) {
          document.querySelectorAll('article').forEach((node) => {
            const articleText = (node.innerText || node.textContent || '').trim();
            if (!articleText) {
              return;
            }
            if (articleText.includes('你说：') || articleText.includes('You said:')) {
              return;
            }
            nodes.push(node);
          });
        }

        if (nodes.length) {
          text = (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || '').trim();
        }
      }

      text = String(text || '')
        .replace(/ChatGPT 也可能会犯错。请核查重要信息。/g, '')
        .replace(/已思考\s*\d+\s*秒\s*›?/g, '')
        .replace(/已思考若干秒\s*›?/g, '')
        .trim();

      const pageTitle = String(document.title || '').trim();
      if (!text || text === pageTitle || text === '回复完成') {
        return '';
      }

      const sentContent = ctx ? String(ctx.sent_content || '').trim() : '';
      if (sentContent && text === sentContent) {
        return '';
      }

      return text;
    }

    function isInvalidAssistantReplyText(text) {
      const value = String(text || '').trim();
      if (!value) {
        return true;
      }

      const invalidTexts = new Set([
        '正在思考',
        '正在生成',
        '思考中',
        '回复完成',
      ]);

      if (invalidTexts.has(value)) {
        return true;
      }

      if (/^已思考\s*\d+\s*秒\s*›?$/.test(value)) {
        return true;
      }

      return false;
    }

    function isPageStillGeneratingForReplyReport() {
      const cap = getPageCapability ? getPageCapability('assistant-reply-report') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const reason = String((cap && cap.response_state_reason) || '').toLowerCase();

      return !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
          || reason === 'assistant_busy'
        )
      );
    }

    function watchReplyCompletionAndReport() {
      const ctx = loadPendingReplyContext();
      if (!ctx || ctx.reply_reported) {
        return;
      }

      const cap = getPageCapability ? getPageCapability('reply-complete-watch') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const isResponding = !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
        )
      );

      const wasResponding = state.lastReplyWatchResponding === true;
      state.lastReplyWatchResponding = isResponding;

      if (isResponding) {
        return;
      }

      const ageMs = Date.now() - Number(ctx.sent_at || 0);
      if (ageMs < 1000) {
        return;
      }

      if (wasResponding || responseState === 'idle') {
        window.setTimeout(() => {
          void tryReportAssistantReplyFromCurrentPage('response_idle_after_generation');
        }, 600);
      }
    }

    async function reportAssistantReply(ctx, content, reason) {
      if (isPageStillGeneratingForReplyReport()) {
        console.warn('[REPLY_REPORT][SKIP_GENERATING]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      if (isInvalidAssistantReplyText(content)) {
        console.warn('[REPLY_REPORT][SKIP_INVALID_TEXT]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      const payload = withBridgeUrlFields({
        action: 'assistant_reply',
        event: 'assistant_reply',
        client_id: ctx.client_id,
        page_instance_id: ctx.page_instance_id,
        conversation_id: ctx.conversation_id,
        url: ctx.url || location.href,
        message_id: ctx.message_id,
        session_id: ctx.session_id,
        turn_id: ctx.turn_id,
        role: 'assistant',
        content,
        content_len: content.length,
        reason: reason || '',
        page_title: document.title || '',
        response_state: 'idle',
        created_at: Date.now() / 1000,
      });

      try {
        const result = await apiRequest(payload);
        logAssistantReplyReportFull(payload, ctx.message_id);

        ctx.reply_reported = true;
        state.pendingReplyContext = ctx;

        try {
          localStorage.setItem(getPendingReplyContextKey(), JSON.stringify(ctx));
        } catch (storageError) {
          console.error('[REPLY_CONTEXT][MARK_REPORTED_FAILED]', {
            error_type: storageError && storageError.name,
            error: storageError && storageError.message,
            stack: storageError && storageError.stack,
          });
        }

        console.log('[REPLY_REPORT][DONE]', {
          message_id: ctx.message_id,
          session_id: ctx.session_id,
          turn_id: ctx.turn_id,
          content_len: content.length,
          reason,
          result,
        });

        ToolboxShell.appendLog('[CHAT_REPLY][APPLY] mode=update_placeholder'
          + ` message_id=${String(ctx.message_id || '').slice(0, 8)}`
          + ` session_id=${ctx.session_id || '-'}`
          + ` turn_id=${ctx.turn_id || '-'}`
          + ` text_len=${content.length}`);
        ToolboxShell.appendLog('[REPLY][APPLIED] updated=true'
          + ` message_id=${String(ctx.message_id || '').slice(0, 8)}`
          + ` session_id=${ctx.session_id || '-'}`
          + ` turn_id=${ctx.turn_id || '-'}`);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.setStatus) {
          ToolboxShell.setStatus('回复已回传 GUI', 'ok');
        }

        return true;
      } catch (error) {
        console.error('[REPLY_REPORT][FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
          payload,
        });
        return false;
      }
    }

    async function tryReportAssistantReplyFromCurrentPage(reason) {
      const ctx = loadPendingReplyContext();
      if (!ctx || ctx.reply_reported) {
        return false;
      }

      if (!isPendingReplyContextForCurrentPage(ctx)) {
        logIgnoredForeignPendingReplyContext(ctx, 'try-report');
        return false;
      }

      const cap = getPageCapability ? getPageCapability('reply-report') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const isResponding = !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
        )
      );

      if (isResponding) {
        return false;
      }

      const ageMs = Date.now() - Number(ctx.sent_at || 0);
      if (ageMs < 800) {
        return false;
      }

      const content = extractLatestAssistantMessageText();

      if (isInvalidAssistantReplyText(content)) {
        console.warn('[REPLY_REPORT][SKIP_INVALID_TEXT]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      if (!content) {
        console.warn('[REPLY_REPORT][SKIP_EMPTY]', {
          reason,
          age_ms: ageMs,
          response_state: responseState,
          title: document.title,
          article_count: document.querySelectorAll('article').length,
          assistant_count: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        });
        return false;
      }

      await reportAssistantReply(ctx, content, reason);
      return true;
    }

    async function waitForBridgeAssistantReply(messageId, result, replyBaseline = null) {
      const sessionId = String(result.session_id || '').trim();
      const turnId = String(result.turn_id || '').trim();
      const identity = getPageIdentity();
      const timeoutMs = 10 * 60 * 1000;
      const noBusyGraceMs = 15000;
      const stableTextMs = 1500;
      const pollMs = 800;
      const checkLogIntervalMs = 3000;
      const startedAt = Date.now();
      let idleSince = 0;
      let sawBusy = false;
      let lastAssistantText = '';
      let lastCheckLogAt = 0;

      const safeCheckAssistantBusy = () => {
        try {
          return typeof ComposerApi.isAssistantLikelyBusy === 'function'
            ? ComposerApi.isAssistantLikelyBusy()
            : false;
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] busy-check-failed error=${errText}`, error);
          return false;
        }
      };

      ToolboxShell.appendLog(
        `[BRIDGE][REPLY_WAIT][START] messageId=${String(messageId || '').slice(0, 8)} `
        + `session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
      );

      ChatInputStateRuntime.waitingForReply = true;
      updateChatInputStateBadge();

      while (Date.now() - startedAt < timeoutMs) {
        const busy = safeCheckAssistantBusy();

        if (busy) {
          sawBusy = true;
          idleSince = 0;
        }
        ChatInputStateRuntime.waitingForReply = true;
        updateChatInputStateBadge();

        let text = '';
        try {
          text = extractBridgeAssistantReplyText(replyBaseline);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] extract-failed error=${errText}`, error);
        }

        const now = Date.now();
        if (now - lastCheckLogAt >= checkLogIntervalMs) {
          lastCheckLogAt = now;
          const idleMs = idleSince ? now - idleSince : 0;
          ToolboxShell.appendLog(
            `[BRIDGE][REPLY_WAIT][CHECK] busy=${busy ? 'true' : 'false'} `
            + `text_len=${text.length} same_as_last=${text && text === lastAssistantText ? 'true' : 'false'} `
            + `idle_ms=${idleMs} saw_busy=${sawBusy ? 'true' : 'false'}`
          );
        }

        if (text && !busy && !isInvalidAssistantReplyText(text)) {
          if (text === lastAssistantText) {
            if (!idleSince) {
              idleSince = Date.now();
            }

            const stableMs = Date.now() - idleSince;
            const stableEnough = stableMs >= stableTextMs;

            if (stableEnough) {
              const ctx = loadPendingReplyContext();
              if (ctx && ctx.message_id === messageId) {
                const reported = await reportAssistantReply(
                  ctx,
                  text,
                  'reply_wait_idle_stable',
                );
                if (reported) {
                  ToolboxShell.appendLog(
                    `[BRIDGE][REPLY_WAIT][REPORT] messageId=${String(messageId || '').slice(0, 8)} `
                    + `text_len=${text.length}`
                  );
                  ToolboxShell.appendLog(
                    `[CHAT][WAITING_END] messageId=${String(messageId || '').slice(0, 8)}`
                    + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
                    + ` text_len=${text.length}`
                  );
                  ChatInputStateRuntime.waitingForReply = false;
                  updateChatInputStateBadge();
                  return true;
                }
              }
            }
          } else {
            lastAssistantText = text;
            idleSince = Date.now();
          }
        }

        if (!sawBusy && Date.now() - startedAt >= noBusyGraceMs && !lastAssistantText) {
          const emptyReason = 'no-busy-observed-and-no-assistant-after-latest-user';
          ToolboxShell.appendLog(
            `[BRIDGE][REPLY_WAIT][EMPTY] reason=${emptyReason} messageId=${String(messageId || '').slice(0, 8)}`
          );
          await report(
            'assistant_reply_empty',
            withBridgeUrlFields({
              session_id: sessionId,
              turn_id: turnId,
              client_id: identity.client_id || CLIENT_ID,
              page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
              conversation_id: identity.conversation_id || '',
              reason: emptyReason,
            }),
            messageId,
          );
          ChatInputStateRuntime.waitingForReply = false;
          updateChatInputStateBadge();
          return false;
        }

        updateChatInputStateBadge();
        await sleep(pollMs);
      }

      const timeoutReason = 'reply-wait-timeout';
      ToolboxShell.appendLog(
        `[BRIDGE][REPLY_WAIT][EMPTY] reason=${timeoutReason} messageId=${String(messageId || '').slice(0, 8)}`
      );
      await report(
        'assistant_reply_empty',
        withBridgeUrlFields({
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          reason: timeoutReason,
        }),
        messageId,
      );
      ChatInputStateRuntime.waitingForReply = false;
      updateChatInputStateBadge();
      return false;
    }

    async function sendTextToChatGPT(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const content = bridgeContentFrom(normalized);
      const sessionId = String(normalized.session_id || '').trim();
      const turnId = String(normalized.turn_id || '').trim();
      savePendingReplyContext(normalized);
      const identity = getPageIdentity();
      const targetUrl = bridgeUrlFrom(normalized);
      const allowReplaceDraft = normalized.allow_replace_draft === true
        || normalized.payload?.allow_replace_draft === true;

      const blockReason = String(state.uploadBlockNextChatReason || '');
      const blockAt = Number(state.uploadBlockNextChatAt || 0);
      const blockFresh = blockReason && Date.now() - blockAt <= 60000;

      if (blockReason && blockFresh) {
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';

        await ack(messageId, false, blockReason);
        await report('send_failed', {
          reason: 'upload_before_send_failed',
          detail: blockReason,
          text_len: content.length,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT] messageId=${String(messageId || '').slice(0, 8)} reason=${blockReason}`
        );

        return false;
      }

      if (blockReason && !blockFresh) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT_EXPIRED] age=${Date.now() - blockAt} reason=${blockReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      if (!content.trim()) {
        await ack(messageId, false, '消息内容为空');
        await reportBestEffort('send_failed', withBridgeUrlFields({
          reason: 'empty_content',
          text_len: 0,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);
        return false;
      }

      const replyBaseline = getBridgeReplyBaseline();

      if (typeof updateQueuedEntryStatus === 'function') {
        updateQueuedEntryStatus(messageId, MESSAGE_STATUS.DISPATCHING);
      }
      ChatInputStateRuntime.pendingTurnId = turnId;
      ChatInputStateRuntime.pendingRequestId = normalized.request_id || messageId;

      ToolboxShell.appendLog(
        `[SEND][DISPATCH] message_id=${String(messageId || '').slice(0, 8)}`
        + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        + ` content_len=${content.length}`
      );

      const sendResult = await sendContentViaComposer({
        source: 'bridge',
        content,
        allowReplaceDraft,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: false,
      });

      if (!sendResult.ok) {
        const reason = sendResult.reason || 'send_failed';
        if (shouldBridgeWaitReplyAfterBusyFailure(reason)) {
          await ack(
            messageId,
            true,
            `已发送到 ChatGPT：assistant_busy（等待回复） detail=${reason}`,
          );
          ToolboxShell.appendLog(
            `[BRIDGE][SEND][BUSY_WAIT] messageId=${String(messageId || '').slice(0, 8)} `
            + `reason=${reason}`,
          );
          try {
            await waitForBridgeAssistantReply(messageId, normalized, replyBaseline);
          } catch (error) {
            const errText = error && error.message ? error.message : String(error);
            logBridgeError(`[BRIDGE][REPLY_WAIT] failed error=${errText}`, error);
            await report(
              'assistant_reply_failed',
              withBridgeUrlFields({
                session_id: sessionId,
                turn_id: turnId,
                client_id: identity.client_id || CLIENT_ID,
                page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
                conversation_id: identity.conversation_id || '',
                reason: errText,
              }),
              messageId,
            );
          }
          if (typeof releasePendingReplyState === 'function') {
            releasePendingReplyState('reply_applied', messageId, normalized);
          }
          window.setTimeout(() => {
            void processBridgeChatQueue();
          }, 200);
          return true;
        }

        const ackMessages = {
          assistant_busy: 'ChatGPT 正在生成回复，暂不能发送',
          composer_has_existing_text: 'ChatGPT 输入框已有内容，已拒绝覆盖草稿',
          composer_not_found: '没有找到 ChatGPT 输入框',
          send_button_unavailable: '输入成功，但发送按钮不可用',
          send_button_wait_timeout: '发送失败：等待发送按钮超时',
          click_send_failed: '点击发送失败',
        };
        const ackText = ackMessages[reason]
          || (reason.startsWith('send_not_confirmed')
            ? `点击发送后未确认成功：${reason}`
            : `发送失败：${reason}`);

        await ack(messageId, false, ackText);
        await report('send_failed', withBridgeUrlFields({
          reason,
          text_len: content.length,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][SEND][FAILED] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`,
        );
        logBridgeError(`发送失败 reason=${reason}`);
        return false;
      }

      const nonSuccessReasons = new Set([
        'assistant_busy',
        'composer_has_existing_text',
        'composer_not_found',
        'composer_empty',
        'send_button_unavailable',
        'send_button_wait_timeout',
        'click_send_failed',
        'empty_content',
        'cannot_accept_input',
      ]);
      if (!sendResult.ok || nonSuccessReasons.has(sendResult.reason)) {
        const reason = sendResult.reason || 'send_failed';
        await ack(messageId, false, reason);
        await report('send_failed', withBridgeUrlFields({
          reason,
          text_len: content.length,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);
        ToolboxShell.appendLog(
          `[BRIDGE][SEND][FAILED] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`,
        );
        logBridgeError(`发送失败 reason=${reason}`);
        return false;
      }

      await ack(messageId, true, `已发送到 ChatGPT：${sendResult.reason}`);
      if (typeof updateQueuedEntryStatus === 'function') {
        updateQueuedEntryStatus(messageId, MESSAGE_STATUS.BROWSER_SENT);
      }
      ToolboxShell.appendLog(
        `[SEND][ACK] message_id=${String(messageId || '').slice(0, 8)}`
        + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        + ` reason=${sendResult.reason}`
      );
      await report('send_success', withBridgeUrlFields({
        reason: sendResult.reason,
        message_status: sendResult.reason,
        text_len: content.length,
        session_id: sessionId,
        turn_id: turnId,
        client_id: identity.client_id || CLIENT_ID,
        page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
        conversation_id: identity.conversation_id || '',
        url: targetUrl,
        ok: true,
      }), messageId);

      try {
        await waitForBridgeAssistantReply(messageId, normalized);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[BRIDGE][REPLY_WAIT] failed error=${errText}`, error);
        await report(
          'assistant_reply_failed',
          withBridgeUrlFields({
            session_id: sessionId,
            turn_id: turnId,
            client_id: identity.client_id || CLIENT_ID,
            page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
            conversation_id: identity.conversation_id || '',
            reason: errText,
          }),
          messageId,
        );
      }

      if (typeof releasePendingReplyState === 'function') {
        releasePendingReplyState('reply_applied', messageId, normalized);
      }
      window.setTimeout(() => {
        void processBridgeChatQueue();
      }, 200);
      return true;
    }

    async function closeCurrentPageCommand(messageId) {
      await report('close_page_requested', withBridgeUrlFields({}), messageId);
      await ack(messageId, true, '已发起关闭当前页面请求');

      window.setTimeout(() => {
        try {
          window.open('', '_self');
          window.close();
        } catch (error) {
          logBridgeError(`window.close 失败: ${error && error.message ? error.message : String(error)}`, error);
        }

        window.setTimeout(() => {
          report('close_page_still_alive', withBridgeUrlFields({
            page_title: document.title || '',
            event_at: Date.now(),
          }), messageId);
        }, 1000);
      }, 200);
      return true;
    }

    async function openUrlCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const url = bridgeUrlFrom(normalized);
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          await ack(messageId, false, `不允许打开非 http/https 地址: ${url}`);
          return false;
        }
        if (typeof GM_openInTab === 'function') {
          GM_openInTab(parsed.href, {
            active: result.active !== false,
            insert: true,
            setParent: true,
          });
        } else {
          window.open(parsed.href, '_blank', 'noopener,noreferrer');
        }

        await report('open_url_requested', withBridgeUrlFields({
          url: parsed.href,
          active: result.active !== false,
        }), messageId);

        await ack(messageId, true, `已发起打开请求: ${parsed.href}`);
        return true;
      } catch (error) {
        logBridgeError(`open_url 失败: ${error && error.message ? error.message : String(error)}`, error);
        await ack(messageId, false, `打开网页失败: ${error && error.message ? error.message : String(error)}`);
        return false;
      }
    }

    function setUploadBlockReason(reason, sourceMessageId) {
      state.uploadBlockNextChatReason = String(reason || '');
      state.uploadBlockNextChatAt = Date.now();
      state.uploadBlockNextChatSourceMessageId = String(sourceMessageId || '');
    }

    function base64ToUint8Array(base64) {
      const binary = atob(String(base64 || ''));
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    async function uploadCurrentFileCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const fileInfo = payload.file && typeof payload.file === 'object' ? payload.file : {};
      const requestId = String(payload.request_id || '').trim();

      await report('command_received', {
        command: 'upload_current_file',
        request_id: requestId,
      }, messageId);

      if (!fileInfo.content_base64) {
        const reason = '上传命令缺少文件内容';
        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason,
        }, messageId);
        await ack(messageId, false, reason);
        return false;
      }

      try {
        const bytes = base64ToUint8Array(fileInfo.content_base64);
        const mime = fileInfo.mime || 'application/octet-stream';
        const name = fileInfo.name || 'upload.bin';
        const blob = new Blob([bytes], { type: mime });
        const file = new File([blob], name, {
          type: mime,
          lastModified: Date.now(),
        });

        if (!ComposerApi || typeof ComposerApi.attachFilesByFileInput !== 'function') {
          throw new Error('ComposerApi.attachFilesByFileInput 不可用');
        }

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][START] request_id=${requestId || '-'} `
          + `name=${name} size=${file.size}`,
        );

        const uploadResult = await ComposerApi.attachFilesByFileInput([file], 12000, {});

        if (!uploadResult || !uploadResult.ok) {
          const reason = (uploadResult && uploadResult.reason)
            ? uploadResult.reason
            : '未找到 ChatGPT 文件上传 input 或设置 input.files 失败';

          await report('control_done', {
            command: 'upload_current_file',
            request_id: requestId,
            ok: false,
            message: reason,
            detail: { file_name: name },
            result: uploadResult || {},
          }, messageId);

          await report('command_failed', {
            command: 'upload_current_file',
            request_id: requestId,
            reason,
          }, messageId);

          await ack(messageId, false, reason);
          return false;
        }

        const detail = {
          file_name: name,
          size: file.size,
        };

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: true,
          message: '文件已提交到上传控件',
          detail,
          result: uploadResult,
        }, messageId);

        await ack(messageId, true, `文件已提交：${name}`);
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][OK] request_id=${requestId || '-'} name=${name}`,
        );
        return true;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `上传当前文件失败：${errText}`;

        console.error('[ChatGPT toolbox] upload_current_file command failed', error);
        ToolboxShell.appendLog(`[BRIDGE][UPLOAD_CURRENT_FILE][FAILED] ${reason}`);

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: false,
          message: reason,
          result: { reason: errText },
        }, messageId);

        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason: errText,
        }, messageId);

        await ack(messageId, false, reason);
        return false;
      }
    }

    async function startUploadCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const bridgeSource = 'bridge_command';

      const isNoFilesBridgeReason = (reason) => {
        const normalizedReason = String(reason || '').trim();
        return (
          normalizedReason === 'no-files'
          || normalizedReason === 'no-pending-files'
          || normalizedReason === 'empty-queue'
        );
      };

      const setUploadBlockOnFailed = (reason) => {
        if (payload.block_next_chat_on_failed !== false) {
          setUploadBlockReason(reason, messageId);
        }
      };

      if (!UploadModule || typeof UploadModule.startUploadFromCurrentQueue !== 'function') {
        const reason = 'UploadModule.startUploadFromCurrentQueue 不存在，无法执行油猴上传';
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
        }, messageId);

        return false;
      }

      let uploadResult = null;
      let queueResult = null;

      try {
        ToolboxShell.appendLog(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );
        console.log(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );

        await report('command_received', {
          command: 'start_upload',
        }, messageId);

        queueResult = await UploadModule.startUploadFromCurrentQueue({
          source: bridgeSource,
        });
        const uploadStatus = UploadModule.getStatus
          ? UploadModule.getStatus()
          : {};
        uploadResult = {
          success: queueResult && queueResult.ok ? Number(queueResult.uploadedCount) || 0 : 0,
          failed: Number(queueResult && queueResult.failedCount) || 0,
          cancelled: !!(queueResult && (queueResult.cancelled || queueResult.reason === 'cancelled')),
          total: (Number(queueResult && queueResult.uploadedCount) || 0)
            + (Number(queueResult && queueResult.failedCount) || 0)
            + (Number(queueResult && queueResult.skippedCount) || 0),
          skipped: !!(queueResult && !queueResult.ok && isNoFilesBridgeReason(queueResult.reason)),
          reason: String(queueResult && queueResult.reason || ''),
          upload_status: uploadStatus,
          queue_result: queueResult,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `发送前上传失败：${errText}`;

        console.error('[ChatGPT toolbox] start_upload command failed', error);
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason: errText,
        }, messageId);

        return false;
      }

      const uploadStatus = uploadResult && uploadResult.upload_status
        ? uploadResult.upload_status
        : {};

      const success = Number(uploadResult && uploadResult.success) || 0;
      const failed = Number(uploadResult && uploadResult.failed) || 0;
      const attached = Number(uploadStatus.attached) || 0;
      const cancelled = Boolean(uploadResult && uploadResult.cancelled);
      const skipped = Boolean(uploadResult && uploadResult.skipped);
      const requireAllSuccess = payload.require_all_success !== false;

      let ok = true;
      let reason = '';

      if (cancelled) {
        ok = false;
        reason = '发送前上传已取消';
      } else if (requireAllSuccess && failed > 0) {
        ok = false;
        reason = `发送前上传存在失败文件：failed=${failed}`;
      } else if (success <= 0 && attached <= 0) {
        ok = false;
        reason = skipped
          ? `发送前上传跳过：${uploadResult.reason || '没有可上传文件'}`
          : '发送前上传没有成功文件';
      }

      if (!ok) {
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
          result: uploadResult,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][FAILED] reason=${reason} success=${success} failed=${failed} attached=${attached}`
        );

        return false;
      }

      if (state.uploadBlockNextChatReason) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][CLEAR_OLD_BLOCK] reason=${state.uploadBlockNextChatReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      await report('control_done', {
        command: 'start_upload',
        result: uploadResult,
      }, messageId);

      await ack(
        messageId,
        true,
        `上传完成：success=${success}, failed=${failed}, attached=${attached}`,
      );

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][OK] success=${success} failed=${failed} attached=${attached}`
      );

      return true;
    }

    async function handleCommandMessage(result) {
      const normalized = normalizeBridgePollMessage(result);
      const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const command = String(
        normalized.command
        || cmdPayload.command
        || normalized.action
        || ''
      ).trim();
      const messageId = normalized.message_id || normalized.id;
      if (command === 'close_self') {
        return await closeCurrentPageCommand(messageId);
      }
      if (command === 'open_url') {
        return await openUrlCommand(normalized);
      }
      if (command === 'sync_conversation') {
        if (!messageId) {
          ToolboxShell.appendLog('[BRIDGE][SYNC_CONVERSATION][FAILED] reason=missing_message_id');
          return false;
        }
        try {
          const responseState = detectResponseState();
          const capability = getPageCapability('sync_conversation');
          const snapshot = buildConversationSnapshotForBridge(getPageIdentity);
          const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
            ? normalized.payload
            : {};
          const identity = getPageIdentity();
          const snapshotUrl = bridgeUrlFrom(cmdPayload)
            || bridgeUrlFrom(snapshot.page)
            || bridgeUrlFrom(identity)
            || location.href;
          const reportPayload = {
            request_id: cmdPayload.request_id || snapshot.request_id || '',
            session_id: cmdPayload.session_id || snapshot.session_id || '',
            conversation_id: cmdPayload.conversation_id || snapshot.conversation_id || identity.conversation_id || '',
            client_id: cmdPayload.client_id || snapshot.client_id || identity.client_id || CLIENT_ID,
            page_instance_id: cmdPayload.page_instance_id || snapshot.page_instance_id || identity.page_instance_id || PAGE_INSTANCE_ID,
            url: snapshotUrl,
            messages: snapshot.messages || [],
            message_count: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0,
            mode: cmdPayload.mode || snapshot.mode || 'merge',
            ok: true,
            command_type: cmdPayload.command_type || 'read_snapshot',
            capability,
            syncable: (capability.url && capability.conversation_id),
            conversation_syncable: capability.conversation_syncable,
            can_accept_input: Boolean(responseState.can_accept_input),
            can_send_now: Boolean(responseState.can_send_now),
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            response_state_reason: responseState.response_state_reason || '',
          };

          logPageCapability(capability, '[SYNC][BRIDGE]');
          ToolboxShell.appendLog(
            `[BRIDGE][SYNC_CONVERSATION][report] message_id=${String(messageId).slice(0, 8)} `
            + `messages=${reportPayload.message_count} `
            + `session_id=${reportPayload.session_id || '-'} `
            + `request_id=${reportPayload.request_id || '-'}`,
          );

          const reportResult = await reportStrict(
            'conversation_snapshot',
            reportPayload,
            messageId,
          );
          if (!reportResult || reportResult.ok === false) {
            const reportErr = (reportResult && reportResult.error) ? reportResult.error : 'report_failed';
            throw new Error(`conversation_snapshot report failed: ${reportErr}`);
          }

          const ackResult = await ack(messageId, true, '已回传当前页面快照');
          if (ackResult && ackResult.ok === false) {
            ToolboxShell.appendLog(
              `[BRIDGE][SYNC_CONVERSATION][ack-rejected] message_id=${String(messageId).slice(0, 8)} `
              + `error=${ackResult.error || 'unknown'}`,
            );
          }
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          const errStack = error && error.stack ? error.stack : errText;
          console.error('[ChatGPT toolbox] sync_conversation report failed', error);
          ToolboxShell.appendLog(`[BRIDGE][SYNC_CONVERSATION][report-failed] error=${errStack}`);
          await ack(messageId, false, `同步对话失败：${errText}`);
          return false;
        }
        return true;
      }
      if (command === 'start_upload') {
        return await startUploadCommand(normalized);
      }
      if (command === 'upload_current_file') {
        return await uploadCurrentFileCommand(normalized);
      }
      await ack(messageId, false, `未知命令: ${command || '-'}`);
      return false;
    }

    async function processBridgeChatQueue() {
      if (typeof CHAT_QUEUE === 'undefined' || !Array.isArray(CHAT_QUEUE)) {
        return;
      }

      while (CHAT_QUEUE.length > 0) {
        if (state.handlingMessageId) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][WAIT] reason=handling_in_progress queue_size=${CHAT_QUEUE.length}`
          );
          return;
        }

        if (typeof hasPendingReply === 'function' && hasPendingReply('')) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][WAIT] reason=pending_reply queue_size=${CHAT_QUEUE.length}`
          );
          return;
        }

        const entry = CHAT_QUEUE[0];
        if (!entry || !entry.message_id || entry.status !== MESSAGE_STATUS.QUEUED) {
          CHAT_QUEUE.shift();
          continue;
        }

        CHAT_QUEUE.shift();
        const sessionId = String(entry.session_id || '').trim();
        const turnId = String(entry.turn_id || '').trim();

        ToolboxShell.appendLog(
          `[CHAT_QUEUE][PROCESS] queued_message_id=${String(entry.message_id || '').slice(0, 8)}`
          + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        );

        updateQueuedEntryStatus(entry.message_id, MESSAGE_STATUS.DISPATCHING);

        let ok = false;
        try {
          state.handlingMessageId = entry.message_id;
          ok = await sendTextToChatGPT(entry);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          const errName = error && error.name ? error.name : 'Error';
          console.error('[CHAT_QUEUE][PROCESS_FAILED]', {
            error_type: errName,
            error: errText,
            stack: error && error.stack,
          });
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][PROCESS_FAILED] message_id=${String(entry.message_id || '').slice(0, 8)}`
            + ` type=${errName} error=${errText}`
          );
          updateQueuedEntryStatus(entry.message_id, MESSAGE_STATUS.FAILED, {
            error: errText,
            error_type: errName,
          });
        } finally {
          if (state.handlingMessageId === entry.message_id) {
            state.handlingMessageId = null;
          }
        }

        if (!ok) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][SEND_FAILED] message_id=${String(entry.message_id || '').slice(0, 8)}`
          );
        }
      }
    }

    async function handleOutboundMessage(result) {
      if (!result || !result.has_message) {
        return {
          handled: false,
          ok: true,
          reason: 'no-message',
        };
      }

      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;

      if (!messageId) {
        logBridgeError('服务端消息缺少 message_id');
        return {
          handled: false,
          ok: false,
          reason: 'missing-message-id',
        };
      }

      // ── Pending reply check: queue instead of dropping ──
      const sessionId = String(normalized.session_id || '').trim();
      const turnId = String(normalized.turn_id || '').trim();
      const content = bridgeContentFrom(normalized);

      if (typeof hasPendingReply === 'function' && hasPendingReply(sessionId)) {
        const queuedEntry = createQueuedMessageEntry(normalized);
        CHAT_QUEUE.push(queuedEntry);

        ToolboxShell.appendLog(
          `[SEND][BLOCK] reason=pending_reply message_id=${String(messageId || '').slice(0, 8)}`
          + ` session_id=${sessionId || '-'} queue_size=${CHAT_QUEUE.length}`
        );
        ToolboxShell.appendLog(
          `[CHAT_QUEUE][ENQUEUE] queue_size=${CHAT_QUEUE.length} message_id=${String(messageId || '').slice(0, 8)}`
        );

        await report('queued_pending_reply', {
          message_id: messageId,
          session_id: sessionId,
          turn_id: turnId,
          reason: 'pending_reply',
          queue_size: CHAT_QUEUE.length,
        }, messageId);

        return {
          handled: true,
          ok: true,
          reason: 'queued-pending-reply',
        };
      }

      if (state.handlingMessageId && state.handlingMessageId !== messageId) {
        const busyEntry = createQueuedMessageEntry(normalized);
        CHAT_QUEUE.push(busyEntry);

        ToolboxShell.appendLog(
          `[SEND][BLOCK] reason=handling_other_message current=${String(state.handlingMessageId || '').slice(0, 8)} incoming=${String(messageId || '').slice(0, 8)}`
          + ` queue_size=${CHAT_QUEUE.length}`
        );
        ToolboxShell.appendLog(
          `[CHAT_QUEUE][ENQUEUE] queue_size=${CHAT_QUEUE.length} message_id=${String(messageId || '').slice(0, 8)}`
        );

        await report('queued_handling_other', {
          current_message_id: state.handlingMessageId,
          ignored_message_id: messageId,
          reason: 'handling_other_message',
          queue_size: CHAT_QUEUE.length,
        }, messageId);

        return {
          handled: true,
          ok: true,
          reason: 'queued-handling-other',
        };
      }

      if (state.handlingMessageId === messageId && !normalized.retry) {
        return {
          handled: false,
          ok: true,
          reason: 'duplicate',
        };
      }

      state.handlingMessageId = messageId;

      try {
        let ok = false;

        if (normalized.type === 'command') {
          ok = await handleCommandMessage(normalized);
        } else {
          const content = bridgeContentFrom(normalized);
          ToolboxShell.appendLog(
            `[BRIDGE][POLL][CHAT] message_id=${String(messageId).slice(0, 8)} `
            + `content_len=${content.length} url=${bridgeUrlFrom(normalized) || '-'}`,
          );
          ok = await sendTextToChatGPT(normalized);
        }

        return {
          handled: true,
          ok: ok === true,
          reason: ok === true ? 'ok' : 'message-handler-returned-false',
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`handleOutboundMessage 失败: ${errText}`, error);
        await ack(messageId, false, errText);

        return {
          handled: true,
          ok: false,
          reason: errText,
        };
      } finally {
        if (state.handlingMessageId === messageId) {
          state.handlingMessageId = null;
        }

        window.setTimeout(() => {
          void processBridgeChatQueue();
        }, 100);
      }
    }

    function formatBridgeStatusReasonSuffix(capability) {
      const reason = String(
        capability && capability.response_state_reason
          ? capability.response_state_reason
          : '',
      ).trim();
      return reason ? ` (${reason})` : '';
    }

    function getBridgePollStatusPresentation() {
      const capability = getPageCapability('bridge-poll');
      logPageCapability(capability, '[BRIDGE][POLL]');

      const reasonSuffix = formatBridgeStatusReasonSuffix(capability);

      if (!capability.bridge_connected) {
        const pollError = capability.last_poll_error || 'bridge_unreachable';
        return {
          text: `Bridge 离线：${pollError}`,
          type: 'offline',
          shortText: '离线',
        };
      }

      if (capability.is_responding || capability.responding) {
        return {
          text: `Bridge 已连接 · 回答中${reasonSuffix}`,
          type: 'danger',
          shortText: '回答中',
        };
      }

      if (capability.can_send_now) {
        return {
          text: `Bridge 已连接 · 可发送${reasonSuffix}`,
          type: 'online',
          shortText: '可发送',
        };
      }

      if (capability.can_accept_input) {
        return {
          text: `Bridge 已连接 · 待输入${reasonSuffix}`,
          type: 'online',
          shortText: '待输入',
        };
      }

      return {
        text: `Bridge 已连接 · 页面异常${reasonSuffix}`,
        type: 'warn',
        shortText: '页面异常',
      };
    }

    /* ===== bridge core: heartbeat / poll / report / control claim ===== */
    async function pollBridge() {
      const cfg = getConfig();

      if (!cfg.bridgeEnabled || state.polling) {
        return;
      }

      if (state.handlingMessageId) {
        const now = Date.now();

        if (now - Number(state.lastBusyHeartbeatAt || 0) >= 3000) {
          state.lastBusyHeartbeatAt = now;
          const identity = getPageIdentity();
          const responseState = detectResponseState();

          await report('heartbeat_busy', {
            ...identity,
            busy: true,
            handling_message_id: state.handlingMessageId,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            can_accept_input: Boolean(responseState.can_accept_input),
          }, state.handlingMessageId);
        }

        return;
      }

      const runId = state.bridgeRunId;
      state.polling = true;
      try {
        const result = await apiRequest({ action: 'poll' });

        if (runId !== state.bridgeRunId || !state.timerId) {
          ToolboxShell.appendLog('[BRIDGE][POLL][STALE_RESULT_IGNORED]');
          return;
        }

        applyBridgeStateFromPollResult(result, 'poll');

        watchReplyCompletionAndReport();

        if (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyBridgeUploadFiles === 'function'
          && Array.isArray(result.upload_files)
        ) {
          UploadModule.applyBridgeUploadFiles(result);
        }

        const handled = await handleOutboundMessage(result);

        if (runId === state.bridgeRunId && state.timerId) {
          markBridgePollSuccess();
          if (!handled || handled.handled !== true || handled.ok === true) {
            const pres = getBridgePollStatusPresentation();
            updateStatus(pres.text);
            ToolboxShell.setStatus(pres.text, pres.type, {
              persist: true,
              shortText: pres.shortText,
            });
            renderBridgeCapabilityPanel(getPageCapability('bridge-poll'));
            updateChatInputStateBadge();
          } else {
            const failReason = handled.reason || '-';
            updateStatus(`消息处理失败：${failReason}`);
            ToolboxShell.setStatus(`消息处理失败：${failReason}`, 'error', { persist: true });
            updateChatInputStateBadge();
          }
        }
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const bridgeUrl = getBridgeUrl();

        markBridgePollFailure(errText);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        ToolboxShell.setStatus(pres.text, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-poll-offline'));
        updateChatInputStateBadge();

        logBridgeError(
          `[pollBridge][failed] action=poll url=${bridgeUrl} type=${errName} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][POLL][FAILED] url=${bridgeUrl} type=${errName} error=${errText}`,
          );
        }
      } finally {
        if (runId === state.bridgeRunId) {
          state.polling = false;
        }
      }
    }

    function identityKey(identity) {
      if (!identity || typeof identity !== 'object') {
        return '';
      }

      return [
        String(identity.client_id || '').trim(),
        String(identity.page_instance_id || '').trim(),
        String(identity.page_type || '').trim(),
        String(identity.conversation_id || '').trim(),
        String(identity.pathname || '').trim(),
      ].join('|');
    }

    async function reportIdentityChanged(identity, oldKey, newKey, reason) {
      const eventAt = Date.now();
      const payload = withBridgeUrlFields({
        client_id: identity.client_id,
        page_instance_id: identity.page_instance_id,
        page_title: identity.page_title,
        page_type: identity.page_type,
        conversation_id: identity.conversation_id,
        pathname: identity.pathname,
        url: bridgeUrlFrom(identity) || location.href,
        visibility_state: identity.visibility_state,
        has_focus: identity.has_focus,
        old_identity_key: oldKey || '',
        new_identity_key: newKey || '',
        reason: reason || 'identity_change',
        event_at: eventAt,
      });
      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY_CHANGE] reason=${payload.reason} `
          + `client_id=${payload.client_id || '-'} `
          + `page_instance_id=${payload.page_instance_id || '-'} `
          + `page_type=${payload.page_type || '-'} `
          + `conversation_id=${payload.conversation_id || '-'} `
          + `pathname=${payload.pathname || '-'} `
          + `old_identity_key=${payload.old_identity_key || '-'} `
          + `new_identity_key=${payload.new_identity_key || '-'} `
          + `url=${payload.url || '-'}`,
      );
      try {
        await reportStrict('identity_change', payload);
      } catch (error) {
        logBridgeError(
          `[IDENTITY_CHANGE][report-failed] reason=${reason || '-'} `
            + `error=${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function flushIdentityChangeReport() {
      bridgeTimers.clearTimeout('identity-report-debounce');
      const latest = getPageIdentity();
      const newKey = identityKey(latest);
      const oldKey = state.pendingIdentityOldKey || '';
      const reason = state.pendingIdentityReason || 'identity_change';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      state.lastIdentityKey = newKey;
      if (!oldKey || oldKey === newKey) {
        return;
      }
      reportIdentityChanged(latest, oldKey, newKey, reason);
      const becameConversation = (
        (latest.page_type || '') === 'conversation'
        && Boolean((latest.conversation_id || '').trim())
      );
      if (becameConversation) {
        ToolboxShell.appendLog(
          '[BRIDGE][IDENTITY_CHANGE] conversation_ready immediate_poll',
        );
        pollBridge();
      }
    }

    function checkPageIdentityChange(reason) {
      const identity = getPageIdentity();
      const key = identityKey(identity);
      if (key === state.lastIdentityKey) {
        return;
      }
      const oldKey = state.lastIdentityKey || '';
      if (!state.pendingIdentityOldKey && oldKey) {
        state.pendingIdentityOldKey = oldKey;
      }
      state.pendingIdentityReason = reason || state.pendingIdentityReason || 'identity_change';
      debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);
      bridgeTimers.timeout('identity-report-debounce', () => {
        flushIdentityChangeReport();
      }, 200);
    }

    async function handleRouteChange(reason = '') {
      const identity = getPageIdentity();
      const key = identityKey(identity);

      if (key === state.lastIdentityKey) {
        refreshToolboxPageStatusDisplay(`route-change:${reason || '-'}`);
        return;
      }

      const oldKey = state.lastIdentityKey || '';
      state.pendingIdentityOldKey = oldKey;
      state.pendingIdentityReason = reason || 'route_change';
      state.lastIdentityKey = key;
      bridgeTimers.clearTimeout('identity-report-debounce');
      debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);
      flushIdentityChangeReport();
      refreshToolboxPageStatusDisplay(`route-change:${reason || '-'}`);
    }

    function installPageIdentityListeners() {
      if (state.pageIdentityListenersInstalled) {
        return;
      }

      state.pageIdentityListenersInstalled = true;
    }

    function removePageIdentityListeners() {
      state.pageIdentityListenersInstalled = false;
    }

    function start() {
      stop();
      const cfg = getConfig();
      if (!cfg.bridgeEnabled) {
        resetBridgePollRuntime('bridge_disabled');
        updateStatus('未启用');
        return;
      }
      state.bridgeRunId += 1;
      state.lastIdentityKey = identityKey(getPageIdentity());
      state.lastIdentityLogKey = '';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      installFocusStateListeners();
      installPageIdentityListeners();
      reportFocusState('bridge_start');
      pollBridge();
      state.timerId = window.setInterval(() => {
        checkPageIdentityChange();
        pollBridge();
      }, cfg.bridgePollIntervalMs);
      updateStatus(`已启动：${getBridgeUrl()}`);
      ToolboxShell.appendLog(`[BRIDGE][START] ${getBridgeUrl()}`);
    }

    function stop() {
      state.bridgeRunId += 1;
      if (state.timerId) {
        window.clearInterval(state.timerId);
        state.timerId = 0;
      }
      bridgeTimers.clearTimeout('identity-report-debounce');
      removeFocusStateListeners();
      removePageIdentityListeners();
      state.polling = false;
      resetBridgePollRuntime('bridge_stopped');
      updateStatus('已停止');
    }

    async function testConnection() {
      updateStatus('正在测试连接...');
      try {
        const result = await apiRequest({
          action: 'poll',
          source: SOURCE,
          test_connection: true,
        });
        applyBridgeStateFromPollResult(result, 'test-connection');
        markBridgePollSuccess();
        const pres = getBridgePollStatusPresentation();
        updateStatus(`连接测试成功 · ${pres.shortText}`);
        ToolboxShell.setStatus(`连接测试成功 · ${pres.text}`, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][OK] ${JSON.stringify(result).slice(0, 300)}`);
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        markBridgePollFailure(text);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        ToolboxShell.setStatus(pres.text, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test-failed'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][ERROR] ${text}`);
      }
    }

    function updateStatus(text) {
      bridgeStatus.set(String(text || ''), 'info');
    }

    const BRIDGE_FIELD_MAP = Object.freeze([
      {
        key: 'bridgeEnabled',
        selector: '#cgpt-bridge-enabled',
        type: 'checked',
        defaultValue: true,
      },
      {
        key: 'bridgeBaseUrl',
        selector: '#cgpt-bridge-base-url',
        type: 'value',
        normalize: normalizeBridgeBaseUrl,
        defaultValue: DEFAULT_BRIDGE_BASE_URL,
      },
      {
        key: 'bridgePath',
        selector: '#cgpt-bridge-path',
        type: 'value',
        normalize: normalizeBridgePath,
        defaultValue: DEFAULT_BRIDGE_PATH,
      },
      {
        key: 'bridgeApiToken',
        selector: '#cgpt-bridge-token',
        type: 'value',
        normalize: (value) => String(value || '').trim(),
        defaultValue: '',
      },
      {
        key: 'bridgeDebugEnabled',
        selector: '#cgpt-bridge-debug',
        type: 'checked',
        defaultValue: false,
      },
      {
        key: 'bridgeRequestTimeoutMs',
        selector: '#cgpt-bridge-timeout',
        type: 'number',
        defaultValue: 30000,
      },
      {
        key: 'bridgePollIntervalMs',
        selector: '#cgpt-bridge-interval',
        type: 'number',
        defaultValue: 1000,
      },
    ]);

    const NORMAL_CAPABILITY_REASONS = new Set([
      'composer_has_attachment',
      'empty_composer',
      'native_send_ready',
      'assistant_busy',
    ]);

    const RESPONSE_STATE_LABELS = Object.freeze({
      attachment_ready: '附件已就绪',
      generating: '回复中',
      composing: '输入中',
      no_composer: '无输入框',
      idle: '',
      unknown: '',
    });

    function formatYesNo(value) {
      return value ? 'yes' : 'no';
    }

    function isEmptyDiagnosticValue(value) {
      const text = String(value ?? '').trim();
      return !text || text === '-';
    }

    function normalizeBridgeCapabilityRecord(capability) {
      const cap = capability && typeof capability === 'object'
        ? capability
        : getPageCapability('bridge-panel');
      const identity = getPageIdentity();

      const conversationId = String(cap.conversation_id || identity.conversation_id || '').trim();
      const url = String(cap.url || identity.url || location.href || '').trim();
      const inputable = Boolean(
        cap.inputable !== undefined ? cap.inputable : cap.can_accept_input,
      );
      const sendable = Boolean(
        cap.sendable !== undefined ? cap.sendable : cap.can_send_now,
      );
      const isResponding = Boolean(
        cap.is_responding !== undefined ? cap.is_responding : cap.responding,
      );
      const responding = Boolean(
        cap.responding !== undefined ? cap.responding : cap.is_responding,
      );
      const syncable = cap.syncable !== undefined
        ? Boolean(cap.syncable)
        : Boolean(conversationId);
      const conversationSyncable = cap.conversation_syncable !== undefined
        ? Boolean(cap.conversation_syncable)
        : Boolean(url && conversationId);

      return {
        client_id: String(cap.client_id || identity.client_id || '').trim() || '-',
        page_instance_id: String(cap.page_instance_id || identity.page_instance_id || '').trim() || '-',
        conversation_id: conversationId || '-',
        url: url || '-',
        page_type: String(cap.page_type || identity.page_type || '-').trim() || '-',
        online: cap.online !== false,
        inputable,
        sendable,
        response_state: String(cap.response_state || '-').trim() || '-',
        response_state_reason: String(cap.response_state_reason || '').trim() || '-',
        bridge_connected: Boolean(cap.bridge_connected),
        last_poll_ok: cap.last_poll_ok === null || cap.last_poll_ok === undefined
          ? null
          : Boolean(cap.last_poll_ok),
        last_poll_error: String(cap.last_poll_error || '').trim(),
        last_poll_at: Number(cap.last_poll_at || 0),
        syncable,
        conversation_syncable: conversationSyncable,
        is_responding: isResponding,
        responding,
        visibility_state: String(
          cap.visibility_state || document.visibilityState || '-',
        ).trim() || '-',
        has_focus: Boolean(
          cap.has_focus !== undefined ? cap.has_focus : document.hasFocus(),
        ),
      };
    }

    function formatOnlineStatus(value) {
      return value === false ? '离线' : '在线';
    }

    function formatInputSendStatus(inputable, sendable) {
      if (!inputable) {
        return '不可输入';
      }

      if (!sendable) {
        return '不可发送';
      }

      return '可输入，可发送';
    }

    function formatBridgeStatus(bridgeConnected, lastPollOk, lastPollError) {
      const pollError = isEmptyDiagnosticValue(lastPollError) ? '' : String(lastPollError).trim();

      if (!bridgeConnected) {
        return {
          text: 'Bridge 未连接',
          reason: pollError,
        };
      }

      if (lastPollOk === false) {
        return {
          text: '轮询异常',
          reason: pollError,
        };
      }

      if (lastPollOk === true) {
        return {
          text: 'Bridge 正常，轮询正常',
          reason: '',
        };
      }

      return {
        text: 'Bridge 正常，轮询未开始',
        reason: '',
      };
    }

    function formatResponseStateLabel(responseState) {
      const key = String(responseState || '').trim();
      return RESPONSE_STATE_LABELS[key] || '';
    }

    function shouldShowResponseStateReason(reason) {
      const text = String(reason || '').trim();
      if (!text || text === '-') {
        return false;
      }

      return !NORMAL_CAPABILITY_REASONS.has(text);
    }

    function formatRespondingStatus(isResponding, responding, responseState) {
      const busy = Boolean(isResponding || responding);
      if (busy) {
        return '回复中';
      }

      const stateLabel = formatResponseStateLabel(responseState);
      if (stateLabel && stateLabel !== '未回复中') {
        return `未回复中 · ${stateLabel}`;
      }

      return '未回复中';
    }

    function formatPollTimeSummary(lastPollAt) {
      const ts = Number(lastPollAt || 0);
      if (!ts || ts <= 0) {
        return '-';
      }

      const date = new Date(ts);
      const now = new Date();
      const isToday = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();

      if (isToday) {
        return date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      }

      return date.toLocaleString();
    }

    function formatBridgeCapabilitySummaryText(record) {
      const lines = [];
      const bridgeStatus = formatBridgeStatus(
        record.bridge_connected,
        record.last_poll_ok,
        record.last_poll_error,
      );

      lines.push(`连接状态：${bridgeStatus.text}`);
      if (bridgeStatus.reason) {
        lines.push(`原因：${bridgeStatus.reason}`);
      }

      lines.push(`输入发送：${formatInputSendStatus(record.inputable, record.sendable)}`);
      lines.push(
        `回复状态：${formatRespondingStatus(
          record.is_responding,
          record.responding,
          record.response_state,
        )}`,
      );
      lines.push(`页面状态：${formatOnlineStatus(record.online)}`);
      lines.push(`最近轮询：${formatPollTimeSummary(record.last_poll_at)}`);

      const pageType = String(record.page_type || '').trim();
      if (pageType && pageType !== 'conversation') {
        lines.push(`页面类型：${pageType}`);
      }

      const visibility = String(record.visibility_state || '').trim();
      if (visibility && visibility !== 'visible') {
        lines.push(`页面可见性：${visibility}`);
      }

      const pollError = String(record.last_poll_error || '').trim();
      if (pollError && pollError !== '-' && !bridgeStatus.reason) {
        lines.push(`轮询错误：${pollError}`);
      }

      if (shouldShowResponseStateReason(record.response_state_reason)) {
        lines.push(`状态原因：${record.response_state_reason}`);
      }

      return lines.join('\n');
    }

    function formatBridgeCapabilityDiagnosticText(record) {
      const pollAtText = record.last_poll_at > 0
        ? new Date(record.last_poll_at).toLocaleString()
        : '-';

      return [
        '[TOOLBOX_PAGE_CAPABILITY]',
        `client_id: ${record.client_id}`,
        `page_instance_id: ${record.page_instance_id}`,
        `conversation_id: ${record.conversation_id}`,
        `url: ${record.url}`,
        `page_type: ${record.page_type}`,
        `online: ${formatYesNo(record.online)}`,
        `inputable: ${formatYesNo(record.inputable)}`,
        `sendable: ${formatYesNo(record.sendable)}`,
        `response_state: ${record.response_state}`,
        `response_state_reason: ${record.response_state_reason}`,
        `bridge_connected: ${formatYesNo(record.bridge_connected)}`,
        `last_poll_ok: ${record.last_poll_ok === null || record.last_poll_ok === undefined ? '-' : formatYesNo(record.last_poll_ok)}`,
        `last_poll_error: ${record.last_poll_error || '-'}`,
        `last_poll_at: ${pollAtText}`,
        `syncable: ${formatYesNo(record.syncable)}`,
        `conversation_syncable: ${formatYesNo(record.conversation_syncable)}`,
        `is_responding: ${formatYesNo(record.is_responding)}`,
        `responding: ${formatYesNo(record.responding)}`,
        `visibility_state: ${record.visibility_state}`,
        `has_focus: ${formatYesNo(record.has_focus)}`,
      ].join('\n');
    }

    function applyBridgeCapabilityAdvancedVisibility() {
      if (!state.root) {
        return;
      }

      const panel = qs('#cgpt-bridge-capability-advanced', state.root);
      const toggleBtn = qs('#cgpt-bridge-toggle-advanced', state.root);

      if (panel) {
        panel.style.display = state.advancedCapabilityExpanded ? 'block' : 'none';
      }

      if (toggleBtn) {
        toggleBtn.textContent = state.advancedCapabilityExpanded
          ? '隐藏高级字段'
          : '显示高级字段';
      }
    }

    function renderBridgeCapabilityPanel(capability) {
      if (!state.root) {
        return;
      }

      const summaryEl = qs('#cgpt-bridge-capability-summary', state.root);
      const textEl = qs('#cgpt-bridge-capability-text', state.root);
      const record = normalizeBridgeCapabilityRecord(capability);

      if (summaryEl) {
        summaryEl.textContent = formatBridgeCapabilitySummaryText(record);
      }

      if (textEl) {
        textEl.textContent = formatBridgeCapabilityDiagnosticText(record);
      }

      applyBridgeCapabilityAdvancedVisibility();
      updateChatInputStateBadge();
    }

    function renderBridgeConfigToUi() {
      if (!state.root) return;

      const cfg = getConfig();

      BRIDGE_FIELD_MAP.forEach((field) => {
        if (field.type === 'checked') {
          DomUtil.setChecked(state.root, field.selector, cfg[field.key], 'BRIDGE');
          return;
        }

        DomUtil.setValue(state.root, field.selector, cfg[field.key], 'BRIDGE');
      });

      DomUtil.setText(state.root, '#cgpt-bridge-url', getBridgeUrl(), 'BRIDGE');
      renderBridgeCapabilityPanel();
    }

    function readBridgeConfigFromUi() {
      if (!state.root) return {};

      const patch = {};

      BRIDGE_FIELD_MAP.forEach((field) => {
        let value;

        if (field.type === 'checked') {
          value = DomUtil.getChecked(state.root, field.selector, field.defaultValue, 'BRIDGE');
        } else if (field.type === 'number') {
          value = Number(DomUtil.getValue(state.root, field.selector, field.defaultValue, 'BRIDGE')) || field.defaultValue;
        } else {
          value = DomUtil.getValue(state.root, field.selector, field.defaultValue, 'BRIDGE');
        }

        patch[field.key] = typeof field.normalize === 'function'
          ? field.normalize(value)
          : value;
      });

      return patch;
    }

    function renderConfigToUi() {
      renderBridgeConfigToUi();
    }

    function saveConfigFromUi() {
      if (!state.root) return;

      saveConfig(readBridgeConfigFromUi());
      renderConfigToUi();
      start();
    }

    function bindBridgeEvents(mountRoot) {
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-save', saveConfigFromUi, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-test', () => {
        testConnection();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-stop', () => {
        stop();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-url', () => {
        void copyWithStatus({
          text: getBridgeUrl(),
          successText: '已复制 Bridge 地址',
          failedPrefix: '复制 Bridge 地址失败',
          logPrefix: 'BRIDGE_COPY_URL',
        });
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-toggle-advanced', () => {
        state.advancedCapabilityExpanded = !state.advancedCapabilityExpanded;
        applyBridgeCapabilityAdvancedVisibility();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-diag', () => {
        const record = normalizeBridgeCapabilityRecord(
          getPageCapability('bridge-copy-diag'),
        );
        void copyWithStatus({
          text: formatBridgeCapabilityDiagnosticText(record),
          successText: '已复制诊断信息',
          failedPrefix: '复制诊断信息失败',
          logPrefix: 'BRIDGE_COPY_DIAG',
        }).catch((error) => {
          console.error('[BridgeModule] 复制诊断信息失败', error);
        });
      }, 'BRIDGE');
    }

    const BRIDGE_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">浏览器桥接</div>
          <div class="cgpt-hint">用于连接本地 Python Flask Bridge，实现页面绑定、消息下发、回复回传、刷新、关闭、同步当前对话等能力。</div>

          <label class="cgpt-checkbox-line">
            <input type="checkbox" id="cgpt-bridge-enabled">
            启用桥接轮询
          </label>

          <div class="cgpt-form-grid">
            <label>服务地址</label>
            <input class="cgpt-input" id="cgpt-bridge-base-url" placeholder="http://127.0.0.1:5000">

            <label>接口路径</label>
            <input class="cgpt-input" id="cgpt-bridge-path" placeholder="/api/bridge">

            <label>API Token</label>
            <input class="cgpt-input" id="cgpt-bridge-token" placeholder="可留空">

            <label>请求超时 ms</label>
            <input class="cgpt-input" id="cgpt-bridge-timeout" type="number" data-no-wheel-number="1" min="1000">

            <label>轮询间隔 ms</label>
            <input class="cgpt-input" id="cgpt-bridge-interval" type="number" data-no-wheel-number="1" min="500">
          </div>

          <label class="cgpt-checkbox-line" style="margin-top:8px;">
            <input type="checkbox" id="cgpt-bridge-debug">
            开启调试日志
          </label>

          <div class="cgpt-row" style="margin-top:10px; flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-bridge-save">保存并重启桥接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-test">测试连接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-stop">停止轮询</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-copy-url">复制地址</button>
          </div>

          <div class="cgpt-hint" style="margin-top:10px;">
            当前地址：<span id="cgpt-bridge-url"></span>
          </div>

          <div class="cgpt-hint" style="margin-top:6px;">
            状态：<span id="cgpt-bridge-status">未启动</span>
          </div>

          <div class="cgpt-hint" style="margin-top:10px; font-weight:600;">
            页面能力（当前标签页，仅展示不拦截同步）
          </div>
          <div id="cgpt-bridge-capability-summary" class="cgpt-hint" style="margin:4px 0 0; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-size:12px; line-height:1.6; white-space:pre-wrap;">
            -
          </div>
          <div class="cgpt-row" style="margin-top:6px; flex-wrap:wrap; gap:4px;">
            <button type="button" class="cgpt-btn" id="cgpt-bridge-toggle-advanced" style="font-size:11px; padding:2px 8px;">显示高级字段</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-copy-diag" style="font-size:11px; padding:2px 8px;">复制诊断信息</button>
          </div>
          <div id="cgpt-bridge-capability-advanced" style="display:none; margin-top:6px;">
            <pre id="cgpt-bridge-capability-text" class="cgpt-hint" style="margin:0; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:11px; line-height:1.45; max-height:260px; overflow-y:auto;">-</pre>
          </div>
        </div>
      `;

    function mount(targetHost) {
      if (!targetHost) {
        logBridgeError('mount 失败: targetHost 为空');
        return;
      }

      const mountedRoot = mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-bridge-module',
        moduleName: 'BRIDGE',
        html: BRIDGE_MODULE_HTML,
        onRefs: (rootEl) => {
          state.root = rootEl;
          state.mounted = true;
        },
        onBind: (rootEl) => {
          bindBridgeEvents(rootEl);
        },
        onRender: () => {
          renderConfigToUi();
        },
        onAfterMount: () => {
          start();
        },
      });

      if (!mountedRoot) {
        logBridgeError('mount 失败: mountSingletonModule 返回空');
      }
    }

    async function sendSystemHotkey(combo = 'ctrl+alt+i') {
      const normalizedCombo = String(combo || '').trim().toLowerCase() || 'ctrl+alt+i';
      const result = await apiRequest({
        action: 'system_hotkey',
        combo: normalizedCombo,
      });

      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || 'GUI 执行快捷键失败');
      }

      return result;
    }

    return {
      mount,
      handleRouteChange,
      sendSystemHotkey,
    };
  })();

  /********************************************************************
   * 7. ExportModule：导出统计模   ********************************************************************/

  const ExportModule = (() => {
    let root = null;
    let statsLineEl = null;
    let settingsImportFileEl = null;

    const REVIEW_JSON_MARKER = '<<<REVIEW_JSON>>>';

    function getExportMessageRole(el) {
      return getMessageRole(el);
    }

    function roleLabelForExport(role) {
      if (role === 'user') return '用户';
      if (role === 'assistant') return '助手';
      if (role === 'system') return '系统';

      return role || '消息';
    }

    function insertReviewJsonMarkerForAssistant(text) {
      if (!text || text === '（空）') return text;

      const full = text;
      const wsMatch = full.match(/^\s*/);
      const wsLen = wsMatch ? wsMatch[0].length : 0;
      const rest = full.slice(wsLen);

      if (rest.startsWith('{') || rest.startsWith('[')) {
        return `${full.slice(0, wsLen)}${REVIEW_JSON_MARKER}\n${rest}`;
      }

      const j = rest.search(/[\{\[]/);
      if (j === -1) return text;

      const jsonPart = rest.slice(j).trimStart();
      if (!jsonPart.startsWith('{') && !jsonPart.startsWith('[')) return text;

      const before = rest.slice(0, j).trimEnd();
      const prefix = full.slice(0, wsLen);

      if (before) {
        return `${prefix}${before}\n\n${REVIEW_JSON_MARKER}\n${jsonPart}`;
      }

      return `${prefix}${REVIEW_JSON_MARKER}\n${jsonPart}`;
    }

    function buildChatExportText() {
      const header = `=== ChatGPT 对话全文 ===\n导出时间${new Date().toLocaleString()}\n`;

      try {
        const records = ChatMessageExtractor.buildRecords({
          includeEmpty: true,
          includeHidden: true,
        });

        if (records.length > 0) {
          const blocks = records.map((rec, i) => {
            const label = roleLabelForExport(rec.role || '');
            let text = String(rec.text || '').trim();

            if (!text) text = '（空）';

            if (rec.role === 'assistant') {
              text = insertReviewJsonMarkerForAssistant(text);
            }

            return `--- ${label} ${i + 1} ---\n${text}`;
          });

          return `${header}\n${blocks.join('\n\n')}`;
        }
      } catch (exportErr) {
        const exportErrText = exportErr && exportErr.message ? exportErr.message : String(exportErr);
        console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);
        ToolboxShell.appendLog(`[EXPORT][chat-records-failed] error=${exportErrText}`);
      }

      const nodes = ComposerApi.getChatMessageElementsInOrder();

      if (nodes.length > 0) {
        const blocks = nodes.map((el, i) => {
          const role = getExportMessageRole(el);
          const label = roleLabelForExport(role);

          let text = getVisibleTextFromElement(el);

          if (!text) text = '（空）';

          if (role === 'assistant') {
            text = insertReviewJsonMarkerForAssistant(text);
          }

          return `--- ${label} ${i + 1} ---\n${text}`;
        });

        return `${header}\n${blocks.join('\n\n')}`;
      }

      const main = qs('main');

      if (main) {
        const text = String(main.innerText || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

        if (text) {
          return `${header}\n（未识别到标准消息节点，已用 main 文本兜底）\n\n${text}`;
        }
      }

      return `${header}\n未找到对话内容。`;
    }

    function buildPanelExportText() {
      const autoCfg = AutoQueueModule.getConfig();
      const autoState = AutoQueueModule.getState();
      const uploadStatus = UploadModule.getStatus();
      const promptCount = PromptManagerModule.getPrompts().length;

      const continueLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.continue &&
        autoCfg.modeSettings.continue.loopMode;
      const listLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.list &&
        autoCfg.modeSettings.list.loopMode;
      const continueMin = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMinSec
        : 3;
      const continueMax = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMaxSec
        : 20;
      const listMin = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMinSec
        : 3;
      const listMax = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMaxSec
        : 20;

      return `=== ChatGPT 工具箱配置导出 ===
导出时间：${new Date().toLocaleString()}

【自动指令】
模式：${typeof AutoQueueModule.getModeLabel === 'function' ? AutoQueueModule.getModeLabel(autoCfg.promptMode) : (autoCfg.promptMode === 'task' ? '批量任务组模式' : (autoCfg.promptMode === 'list' ? '列表模式' : '继续模式'))}
继续模式循环：${continueLoop ? '是' : '否'}
继续模式间隔：${continueMin} ~ ${continueMax} 秒
列表模式循环：${listLoop ? '是' : '否'}
列表模式间隔：${listMin} ~ ${listMax} 秒
运行状态：${autoState.running ? '运行中' : '已停止'}
已发送：${autoState.sentCount}

【继续模式指令】
${autoCfg.continuePromptsText || '（空）'}

【列表模式指令】
${autoCfg.listPromptsText || '（空）'}

【Prompt 管理】
Prompt 总数：${promptCount}

【上传队列】
分组数：${uploadStatus.groupCount}
当前分组：${uploadStatus.activeGroupName}（${uploadStatus.activeGroupId}）
当前组队列数量：${uploadStatus.total}
已挂载：${uploadStatus.attached}
失败：${uploadStatus.failed}
运行状态：${uploadStatus.running ? '运行中' : '已停止'}
`;
    }
    function stripMarkdownCodeFences(text) {
      return String(text || '').replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
    }

    function extractJsonObjectsFromText(raw) {
      const text = stripMarkdownCodeFences(raw);
      const out = [];
      let i = 0;

      while (i < text.length) {
        const start = text.indexOf('{', i);

        if (start === -1) break;

        let depth = 0;
        let inStr = false;
        let esc = false;
        let closed = false;

        for (let j = start; j < text.length; j += 1) {
          const c = text[j];

          if (inStr) {
            if (esc) {
              esc = false;
            } else if (c === '\\') {
              esc = true;
            } else if (c === '"') {
              inStr = false;
            }

            continue;
          }

          if (c === '"') {
            inStr = true;
            continue;
          }

          if (c === '{') {
            depth += 1;
          } else if (c === '}') {
            depth -= 1;

            if (depth === 0) {
              const slice = text.slice(start, j + 1);

              try {
                out.push(JSON.parse(slice));
              } catch (e) {
                console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);
              }

              i = j + 1;
              closed = true;
              break;
            }
          }
        }

        if (!closed) {
          i = start + 1;
        }
      }

      return dedupeParsedObjects(out);
    }

    function dedupeParsedObjects(objs) {
      const seen = new Set();
      const out = [];

      for (const o of objs) {
        try {
          const k = JSON.stringify(o);

          if (seen.has(k)) continue;

          seen.add(k);
          out.push(o);
        } catch (e) {
          console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);
          out.push(o);
        }
      }

      return out;
    }

    function isReviewPayload(obj) {
      return !!(obj && typeof obj === 'object' && Array.isArray(obj.issues));
    }

    function getAssistantMessageFullText(el) {
      if (!el) return '';

      const z = (s) => String(s || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
      const chunks = [];

      qsa('pre, code', el).forEach((node) => {
        if (isInToolbox(node)) return;

        const t = z(node.textContent);
        if (t) chunks.push(t);
      });

      chunks.push(z(el.innerText));
      chunks.push(z(el.textContent));

      return [...new Set(chunks.filter(Boolean))].join('\n\n');
    }

    function scanReviewIssueStats() {
      const assistantEls = ComposerApi.getChatMessageElementsInOrder()
        .filter((el) => (el.getAttribute('data-message-author-role') || '') === 'assistant');

      let jsonBlocks = 0;
      let issueTotal = 0;
      let metaSumDeclared = 0;
      const items = [];

      assistantEls.forEach((el, idx) => {
        const raw = getAssistantMessageFullText(el);
        const payloads = extractJsonObjectsFromText(raw).filter(isReviewPayload);

        payloads.forEach((obj) => {
          jsonBlocks += 1;

          const n = obj.issues.length;
          issueTotal += n;

          const metaCount = obj.meta && typeof obj.meta.issue_count === 'number'
            ? obj.meta.issue_count
            : null;

          if (metaCount != null) {
            metaSumDeclared += metaCount;
          }

          items.push({
            msgIndex: idx + 1,
            qid: obj.qid || '',
            issueCount: n,
            metaIssueCount: metaCount,
          });
        });
      });

      return {
        assistantWithRoleCount: assistantEls.length,
        jsonBlocks,
        issueTotal,
        metaSumDeclared,
        items,
      };
    }

    function applyIssueTotalToTabTitle(issueTotal) {
      TitlePrefixModule.applyIssueTotalToTitle(issueTotal);
    }

    function renderStats() {
      const s = scanReviewIssueStats();

      if (statsLineEl) {
        statsLineEl.textContent =
          `issues 总数：${s.issueTotal} 条；JSON 块：${s.jsonBlocks}；助手消息：${s.assistantWithRoleCount}`;
      }

      applyIssueTotalToTabTitle(s.issueTotal);

      return s;
    }

    const EXPORT_ACTIONS = Object.freeze([
      {
        selector: '#cgpt-export-copy-chat',
        name: 'copy-chat',
        handler: () => copyWithStatus({
          text: buildChatExportText(),
          successText: '已复制完整对话',
          failedPrefix: '复制完整对话失败',
          logPrefix: 'EXPORT_COPY_CHAT',
        }),
      },
      {
        selector: '#cgpt-export-copy-panel',
        name: 'copy-panel',
        handler: () => copyWithStatus({
          text: buildPanelExportText(),
          successText: '已复制工具箱配置',
          failedPrefix: '复制工具箱配置失败',
          logPrefix: 'EXPORT_COPY_PANEL',
        }),
      },
      {
        selector: '#cgpt-export-refresh-stats',
        name: 'refresh-stats',
        handler: () => {
          const s = renderStats();
          ToolboxShell.appendLog(`issues 统计刷新：${s.issueTotal} 条`);
        },
      },
      {
        selector: '#cgpt-export-copy-stats',
        name: 'copy-stats',
        handler: () => {
          const s = renderStats();
          return copyWithStatus({
            text: JSON.stringify(s, null, 2),
            successText: '已复制 issues 统计 JSON',
            failedPrefix: '复制 issues 统计失败',
            logPrefix: 'EXPORT_COPY_STATS',
          });
        },
      },
    ]);

    function bindEvents() {
      EXPORT_ACTIONS.forEach((action) => {
        DomUtil.bindClick(root, action.selector, () => {
          void Promise.resolve(action.handler()).catch((error) => {
            const errText = error && error.message ? error.message : String(error);
            console.error(`[ChatGPT toolbox] Export action failed: ${action.name}`, error);
            ToolboxShell.appendLog(`[EXPORT][${action.name}][failed] error=${errText}`);
          });
        }, 'EXPORT');
      });

      DomUtil.bindClick(root, '#cgpt-export-prompts', () => {
        const data = PromptManagerModule.exportData();
        downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
        ToolboxShell.appendLog('已导出 Prompt 管理数据');
        ToolboxShell.setStatus('已导出 Prompt 管理数据');
      }, 'EXPORT');

      bindClick(root, '#cgpt-export-settings', () => {
        void (async () => {
          try {
            const payload = await buildSettingsExportPayload();
            downloadJsonFile(`chatgpt-toolbox-settings-${buildDateTimeStamp()}.json`, payload);
            ToolboxShell.appendLog('已导出工具箱设置');
            ToolboxShell.setStatus('已导出工具箱设置');
          } catch (e) {
            const errText = logError('[EXPORT][settings-export]', e);
            ToolboxShell.setStatus(`导出设置失败：${errText}`);
          }
        })();
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings',
      });

      settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);

      bindClick(root, '#cgpt-export-settings-import', () => {
        if (settingsImportFileEl) {
          settingsImportFileEl.click();
        }
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',
      });

      if (settingsImportFileEl) {
        bindOnce(settingsImportFileEl, 'change', async (event) => {
          try {
            const payload = await readJsonFileFromInput(event, {
              tag: '[SETTINGS_IMPORT]',
            });

            if (!payload) return;

            const ok = await importSettingsPayload(payload);

            if (ok) {
              ToolboxShell.appendLog('已导入工具箱设置');
              ToolboxShell.setStatus('已导入工具箱设置');
            } else {
              ToolboxShell.setStatus('导入失败：文件格式无效');
            }
          } catch (e) {
            const errText = logError('[EXPORT][settings-import]', e);
            ToolboxShell.setStatus(`导入失败：${errText}`);
          }
        });
      }
    }

    async function buildSettingsExportPayload() {
      const uploadGroups = await UploadModule.exportGroupsAndQueueMeta();

      return {
        version: APP.storagePrefix,
        schemaVersion: 4,
        exportedAt: new Date().toISOString(),
        toolbox: MemoryManager.getToolboxState(),
        autoQueueConfig: AutoQueueModule.snapshotConfig(),
        prompts: MemoryManager.get(MemoryManager.KEYS.promptManagerData, []),
        uploadGroups,
      };
    }

    async function importSettingsPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        console.warn('[ChatGPT toolbox] importSettingsPayload: invalid payload', payload);
        return false;
      }

      if (payload.toolbox && typeof payload.toolbox === 'object') {
        MemoryManager.saveToolboxPatch(payload.toolbox);
        ToolboxShell.applyToolboxUiState({
          restoreTab: false,
        });
      }

      if (payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object') {
        MemoryManager.set(MemoryManager.KEYS.autoQueueConfig, payload.autoQueueConfig);
        AutoQueueModule.applyConfig(payload.autoQueueConfig);
      }

      if (payload.prompts != null) {
        MemoryManager.set(MemoryManager.KEYS.promptManagerData, payload.prompts);
        PromptManagerModule.reloadFromStorage();
      }

      if (payload.uploadGroups && typeof payload.uploadGroups === 'object') {
        await UploadModule.importGroupsAndQueueMeta(payload.uploadGroups);
      }

      ToolboxShell.switchTab('upload');

      const autoCfgForUi = payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object'
        ? payload.autoQueueConfig
        : MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, createDefaultAutoConfig());
      AutoQueueModule.applyConfig(autoCfgForUi);
      PromptManagerModule.reloadFromStorage();

      if (typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      return true;
    }

    function buildExportChatSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">对话导出</div>
          <div class="cgpt-hint">复制当前页面对话全文，适合保存审稿、代码审查和长对话上下文。</div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>
          </div>
        </div>
      `;
    }

    function buildExportStatsSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">issues 统计</div>
          <div class="cgpt-hint">
            会扫描助手回复中的 JSON 对象，统计形如 {"issues": [...]} 的结果数量，并同步到浏览器标题。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>
          </div>
          <div id="cgpt-export-stats-line" class="cgpt-hint" style="margin-top:8px;">issues 总数：-</div>
        </div>
      `;
    }

    function buildExportSettingsBackupSectionHtml() {
      return `
        <div class="cgpt-section cgpt-export-advanced">
          <div class="cgpt-section-title">设置备份</div>
          <div class="cgpt-hint">
            导出/导入工具 UI 状态、自动指令、Prompt、文件组与队列元数据（默认不含真实文件 Blob）。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>
            <input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">
          </div>
        </div>
      `;
    }

    function buildExportModuleHtml() {
      return `
        ${buildExportChatSectionHtml()}
        ${buildExportStatsSectionHtml()}
        ${buildExportSettingsBackupSectionHtml()}
      `;
    }

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-export-module',
        moduleName: 'EXPORT',
        html: buildExportModuleHtml(),
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          statsLineEl = qs('#cgpt-export-stats-line', root);
          settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
        },
        onBind: () => {
          bindEvents();
        },
        onRender: () => {
          renderStats();
        },
      });
    }

    return {
      mount,
    };
  })();

  /********************************************************************
   * 6. LogModule：工具箱日志
   *
   * 设计原则：
   * - 记录日志与显示日志解耦
   * - 默认不渲染到 DOM，避免长任务时刷屏卡顿
   * - 日志写入内存环形缓冲区，用户主动查看时才渲染
   * - 复制功能从内存读取，不依赖 DOM
   ********************************************************************/

  const LogModule = (() => {
    // 环形缓冲区上限
    const MAX_LOG_BUFFER_LINES = 3000;
    // 默认显示条数
    const DEFAULT_LOG_RENDER_LIMIT = 200;
    // 持久化存储上限
    const PERSIST_MAX_LINES = 1000;

    const state = {
      lines: [],
      visible: false,
      renderLimit: DEFAULT_LOG_RENDER_LIMIT,
    };

    let mounted = false;
    let listEl = null;
    let hintEl = null;
    let toggleBtnEl = null;
    const logBuffer = [];
    const logTimers = createTimerRegistry('LOG');
    let logDomDirty = false;
    let renderScheduled = false;

    function isLogPersistEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.logPersistEnabled, false);
    }

    function persistLogLines() {
      if (!isLogPersistEnabled()) return;

      MemoryManager.set(MemoryManager.KEYS.logPersistLines, state.lines.slice(0, PERSIST_MAX_LINES));
    }

    function loadPersistedLogLines() {
      if (!isLogPersistEnabled()) return;

      const lines = MemoryManager.get(MemoryManager.KEYS.logPersistLines, []);

      if (Array.isArray(lines)) {
        state.lines = lines.slice(0, PERSIST_MAX_LINES);
      }
    }

    function bindLogPersist(root) {
      const persistEl = qs('#cgpt-log-persist', root);
      if (!persistEl) return;

      bindOnce(persistEl, 'change', () => {
        MemoryManager.set(MemoryManager.KEYS.logPersistEnabled, !!persistEl.checked);

        if (!persistEl.checked) {
          MemoryManager.remove(MemoryManager.KEYS.logPersistLines);
        } else {
          persistLogLines();
        }
      });
    }

    function bindLogCopy(root) {
      bindClick(root, '#cgpt-log-copy', () => {
        flushLogBufferSync();

        const text = state.lines.length > 0
          ? state.lines.join('\n')
          : '暂无日志。';

        void copyWithStatus({
          text,
          successText: `已复制日志（${state.lines.length} 条）`,
          failedPrefix: '复制日志失败',
          logPrefix: 'LOG_COPY',
          emptyText: '暂无日志',
          playSuccessBeep: false,
        });
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-copy',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-copy',
      });
    }

    function bindLogClear(root) {
      bindClick(root, '#cgpt-log-clear', () => {
        logBuffer.length = 0;
        logTimers.clearTimeout('log-flush');

        state.lines = [];
        logDomDirty = false;
        render();
        persistLogLines();
        ToolboxShell.setStatus('已清空日志');
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-clear',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-clear',
      });
    }

    function bindLogToggle(root) {
      toggleBtnEl = qs('#cgpt-log-toggle', root);
      if (!toggleBtnEl) return;

      bindOnce(toggleBtnEl, 'click', () => {
        state.visible = !state.visible;
        updateToggleBtn();
        render();
      });
    }

    function updateToggleBtn() {
      if (!toggleBtnEl) return;

      toggleBtnEl.textContent = state.visible ? '隐藏日志' : '显示最近日志';
    }

    function bindLogCopyErrors(root) {
      bindClick(root, '#cgpt-log-copy-errors', () => {
        flushLogBufferSync();

        const errorKeywords = [
          'error', 'warn', 'failed', 'fail', 'exception', 'traceback',
          '失败', '错误', '异常', '超时', 'timeout', 'unauthorized',
          'forbidden', 'not found', 'undefined', 'null',
        ];

        const errorLines = state.lines.filter((line) => {
          const lower = String(line || '').toLowerCase();
          return errorKeywords.some((kw) => lower.includes(kw));
        });

        const text = errorLines.length > 0
          ? errorLines.join('\n')
          : '未发现错误日志。';

        void copyWithStatus({
          text,
          successText: `已复制错误日志（${errorLines.length} 条）`,
          failedPrefix: '复制错误日志失败',
          logPrefix: 'LOG_COPY_ERRORS',
          emptyText: '未发现错误日志',
          playSuccessBeep: false,
        });
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-copy-errors',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-copy-errors',
      });
    }

    function bindEvents(root) {
      bindLogPersist(root);
      bindLogCopy(root);
      bindLogClear(root);
      bindLogToggle(root);
      bindLogCopyErrors(root);
    }

    const LOG_MODULE_HTML = `
        <div class="cgpt-log-panel">
          <div class="cgpt-log-actions">
            <button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-log-clear">清空日志</button>
            <button type="button" class="cgpt-btn" id="cgpt-log-toggle">显示最近日志</button>
            <button type="button" class="cgpt-btn" id="cgpt-log-copy-errors">复制错误日志</button>
          </div>
          <label class="cgpt-checkbox-line cgpt-log-advanced" style="margin:6px 0 0;">
            <input type="checkbox" id="cgpt-log-persist">
            刷新后保留日志（默认关闭）
          </label>
          <div class="cgpt-log-hint" id="cgpt-log-hint" style="padding:12px 8px;color:#94a3b8;font-size:12px;line-height:1.6;">
            日志已在后台记录，默认不实时显示以避免卡顿。需要查看时点击"显示最近日志"，需要排查时点击"复制日志"。
          </div>
          <div class="cgpt-log-list" id="cgpt-log-list" style="display:none;"></div>
        </div>
      `;

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-log-module',
        moduleName: 'LOG',
        html: LOG_MODULE_HTML,
        onRefs: (mountedRoot) => {
          mounted = true;
          const logRefs = collectDomRefs(mountedRoot, {
            list: '#cgpt-log-list',
            hint: '#cgpt-log-hint',
            toggle: '#cgpt-log-toggle',
            persist: {
              selector: '#cgpt-log-persist',
              required: false,
            },
          }, {
            moduleName: 'LOG',
          });
          listEl = logRefs.list;
          hintEl = logRefs.hint;
          toggleBtnEl = logRefs.toggle;
          if (logRefs.persist) {
            logRefs.persist.checked = isLogPersistEnabled();
          }
          loadPersistedLogLines();
          updateToggleBtn();
        },
        onBind: (mountedRoot) => {
          bindEvents(mountedRoot);
        },
        onRender: () => {
          // 初始化时不渲染日志内容，只显示提示
          render();
        },
      });
    }

    function isLogTabVisible() {
      return typeof ToolboxShell.getActiveTab === 'function'
        && ToolboxShell.getActiveTab() === 'log';
    }

    function flushLogBufferSync() {
      logTimers.clearTimeout('log-flush');

      if (!logBuffer.length) {
        return;
      }

      const batch = logBuffer.splice(0, logBuffer.length);

      batch.forEach((text) => {
        const line = `[${nowTimeText()}] ${String(text || '')}`;
        state.lines.unshift(line);
      });

      // 环形缓冲区裁剪
      if (state.lines.length > MAX_LOG_BUFFER_LINES) {
        state.lines.length = MAX_LOG_BUFFER_LINES;
      }

      logDomDirty = true;
      persistLogLines();
    }

    function flushLogBuffer() {
      flushLogBufferSync();

      if (mounted && state.visible && isLogTabVisible()) {
        scheduleRender();
      }
    }

    function scheduleRender() {
      if (renderScheduled) return;

      renderScheduled = true;
      logTimers.timeout('render', () => {
        renderScheduled = false;
        render();
      }, 400);
    }

    function flushDomIfNeeded() {
      if (!logDomDirty || !mounted) {
        return;
      }

      if (logTimers.has('log-flush')) {
        return;
      }

      if (state.visible) {
        scheduleRender();
      }
    }

    function add(text) {
      logBuffer.push(String(text || ''));

      if (!logTimers.has('log-flush')) {
        logTimers.timeout('log-flush', flushLogBuffer, 200);
      }
    }

    function render() {
      if (!listEl || !hintEl) return;

      // 隐藏状态：只显示提示，不渲染日志内容
      if (!state.visible) {
        listEl.style.display = 'none';
        hintEl.style.display = 'block';
        return;
      }

      // 显示状态：渲染最近 N 条日志
      hintEl.style.display = 'none';
      listEl.style.display = 'block';

      if (!state.lines.length) {
        listEl.innerHTML = renderEmptyState('暂无日志', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      const recentLines = state.lines.slice(0, state.renderLimit);
      listEl.innerHTML = recentLines
        .map((line) => `<div class="cgpt-log-line">${escapeHtml(line)}</div>`)
        .join('');

      logDomDirty = false;
    }

    return {
      mount,
      add,
      flushDomIfNeeded,
    };
  })();