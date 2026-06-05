  /********************************************************************
   * AutoQueueTaskProfileConfig：自动队列任务组 / 任务项配置归一化
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 taskProfiles / taskQueueSettings / 默认示例任务 / 任务项字段修复。
   * 3. 不负责发送、不负责等待回复、不负责闭环、不负责上传、不负责按钮渲染。
   ********************************************************************/
  const AutoQueueTaskProfileConfig = (() => {
    function create(deps = {}) {
      const config = deps.config;
      const BATCH_CONTINUE_TEMPLATE = deps.BATCH_CONTINUE_TEMPLATE;
      const TASK_DONE_SIGNAL = deps.TASK_DONE_SIGNAL;
      const UNLIMITED_CONTINUE_ROUNDS = deps.UNLIMITED_CONTINUE_ROUNDS;
      const LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS = deps.LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS;
      const createTaskId = deps.createTaskId;
      const normalizeContinueRoundLimit = deps.normalizeContinueRoundLimit;
      const migrateTaskDoneSignalForAutoQueue = deps.migrateTaskDoneSignalForAutoQueue;
      const taskRepairLog = deps.taskRepairLog;
      const formatContinueRoundLimit = deps.formatContinueRoundLimit;
      const createDefaultTaskQueueSettings = deps.createDefaultTaskQueueSettings;
      const clonePlainObject = deps.clonePlainObject;
      const createDefaultAutoConfig = deps.createDefaultAutoConfig;
      const nowMs = deps.nowMs;
      const createId = deps.createId;
      const pad2 = deps.pad2;
      const buildUniqueName = deps.buildUniqueName;
      const normalizeNamedEntity = deps.normalizeNamedEntity;
      const normalizeTaskAutoUploadCountModeDep = deps.normalizeTaskAutoUploadCountMode;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][CREATE_FAILED] missing config');
      }

      function requireDep(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_TASK_PROFILE_CONFIG][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function nowMsSafe() {
        if (typeof nowMs === 'function') {
          return nowMs();
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][NOW_FALLBACK] nowMs missing');
        return Date.now();
      }

      function createIdSafe(prefix) {
        if (typeof createId === 'function') {
          return createId(prefix);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][CREATE_ID_FALLBACK] createId missing', { prefix });
        return String(prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      }

      function createTaskIdSafe() {
        if (typeof createTaskId === 'function') {
          return createTaskId();
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][CREATE_TASK_ID_FALLBACK] createTaskId missing');
        return createIdSafe('task');
      }

      function pad2Safe(value) {
        if (typeof pad2 === 'function') {
          return pad2(value);
        }
        return String(value).padStart(2, '0');
      }

      function buildUniqueNameSafe(base, names) {
        if (typeof buildUniqueName === 'function') {
          return buildUniqueName(base, names);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][UNIQUE_NAME_FALLBACK] buildUniqueName missing', {
          base,
          count: names && typeof names.size === 'number' ? names.size : -1,
        });
        let name = String(base || '任务组');
        let index = 2;
        while (names && typeof names.has === 'function' && names.has(name)) {
          name = String(base || '任务组') + '_' + index;
          index += 1;
        }
        return name;
      }

      function normalizeTaskAutoUploadCountModeSafe(mode) {
        if (typeof normalizeTaskAutoUploadCountModeDep === 'function') {
          return normalizeTaskAutoUploadCountModeDep(mode);
        }
        const raw = String(mode || '').trim();
        if (raw === 'message' || raw === 'assistantAnswer' || raw === 'taskItem') {
          return raw;
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][COUNT_MODE_FALLBACK] normalizeTaskAutoUploadCountMode missing', {
          mode,
        });
        return 'message';
      }

      function normalizeNamedEntitySafe(item, options) {
        if (typeof normalizeNamedEntity === 'function') {
          return normalizeNamedEntity(item, options);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][NORMALIZE_ENTITY_FALLBACK] normalizeNamedEntity missing', {
          item,
          options,
        });
        const now = nowMsSafe();
        const raw = item && typeof item === 'object' ? item : {};
        const fallbackName = options && options.fallbackName ? options.fallbackName : '未命名任务组';
        const prefix = options && options.prefix ? options.prefix : 'autoq_task_profile';
        return {
          id: String(raw.id || '').trim() || createIdSafe(prefix),
          name: String(raw.name || '').trim() || fallbackName,
          createdAt: Number(raw.createdAt || now),
          updatedAt: Number(raw.updatedAt || now),
        };
      }

      function normalizeContinueRoundLimitSafe(value, fallback) {
        if (typeof normalizeContinueRoundLimit === 'function') {
          return normalizeContinueRoundLimit(value, fallback);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][ROUND_LIMIT_FALLBACK] normalizeContinueRoundLimit missing', {
          value,
          fallback,
        });
        const n = Number(value);
        if (!Number.isFinite(n)) {
          return fallback;
        }
        return Math.max(0, Math.floor(n));
      }

      function migrateTaskDoneSignalForAutoQueueSafe(value) {
        if (typeof migrateTaskDoneSignalForAutoQueue === 'function') {
          return migrateTaskDoneSignalForAutoQueue(value);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][DONE_SIGNAL_MIGRATE_FALLBACK] migrateTaskDoneSignalForAutoQueue missing');
        return String(value || '').trim();
      }

      function formatContinueRoundLimitSafe(value) {
        if (typeof formatContinueRoundLimit === 'function') {
          return formatContinueRoundLimit(value);
        }
        if (Number(value) <= 0) {
          return '无限';
        }
        return String(Math.max(0, Math.floor(Number(value) || 0)));
      }

      function createDefaultTaskQueueSettingsSafe() {
        return requireDep('createDefaultTaskQueueSettings', createDefaultTaskQueueSettings)();
      }

      function clonePlainObjectSafe(value, fallback, label) {
        if (typeof clonePlainObject === 'function') {
          return clonePlainObject(value, fallback, label);
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][CLONE_FALLBACK] clonePlainObject missing', { label });
        try {
          return JSON.parse(JSON.stringify(value || fallback || {}));
        } catch (error) {
          console.error('[AUTOQ_TASK_PROFILE_CONFIG][CLONE_FALLBACK_FAILED]', {
            message: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : '',
          });
          return fallback || {};
        }
      }

      function createDefaultAutoConfigSafe() {
        if (typeof createDefaultAutoConfig === 'function') {
          return createDefaultAutoConfig();
        }
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][AUTO_CONFIG_FALLBACK] createDefaultAutoConfig missing');
        return {};
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
      const ts = nowMsSafe();
      const base = {
        id: createTaskIdSafe(),
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

    const DEFAULT_SINGLE_QUESTION_STEP_PROMPT = DEFAULT_SINGLE_QUESTION_STEP_TASK_PROMPT;

    function getSafeDefaultPrompt(value, fallback, name) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      console.warn('[TOOLBOX][TASK_PROFILE][DEFAULT_PROMPT_FALLBACK]', {
        name,
        reason: 'missing_or_empty_default_prompt',
        fallback_len: String(fallback || '').length,
      });
      return String(fallback || '').trim();
    }

    function createDefaultExampleTasks() {
      const initialPrompt = getSafeDefaultPrompt(
        typeof DEFAULT_SINGLE_QUESTION_STEP_PROMPT !== 'undefined' ? DEFAULT_SINGLE_QUESTION_STEP_PROMPT : '',
        typeof DEFAULT_SINGLE_QUESTION_STEP_TASK_PROMPT !== 'undefined' ? DEFAULT_SINGLE_QUESTION_STEP_TASK_PROMPT : '',
        'DEFAULT_SINGLE_QUESTION_STEP_PROMPT',
      );
      const continuePromptFallback = typeof getDefaultBatchContinuePromptText === 'function'
        ? getDefaultBatchContinuePromptText()
        : (typeof appendDetailedCursorInstructionBlock === 'function'
          ? appendDetailedCursorInstructionBlock('请继续完成当前任务。')
          : [
            '请继续完成当前任务。',
            '',
            '如果任务涉及代码修改、修复、重构、Bug 定位、UI 行为、状态同步、上传逻辑、闭环控制或日志排查，必须输出详细 Cursor / Claude Code 修改指令，列出文件路径、函数名、关键代码、日志要求和验证步骤。',
          ].join('\n'));
      const continuePrompt = getSafeDefaultPrompt(
        typeof DEFAULT_SINGLE_QUESTION_STEP_CONTINUE_PROMPT !== 'undefined' ? DEFAULT_SINGLE_QUESTION_STEP_CONTINUE_PROMPT : '',
        continuePromptFallback,
        'DEFAULT_SINGLE_QUESTION_STEP_CONTINUE_PROMPT',
      );

      return [
        createDefaultTaskItem({
          title: '示例：分轮答题测试',
          initialPrompt,
          continuePromptTemplate: continuePrompt,
        }),
      ];
    }

    function createDefaultExampleTasksSafe() {
      try {
        const defaultTasks = createDefaultExampleTasks();

        if (!Array.isArray(defaultTasks)) {
          console.error('[TOOLBOX][TASK_PROFILE][DEFAULT_TASKS_INVALID]', {
            type: typeof defaultTasks,
            value: defaultTasks,
          });
          return [];
        }

        return defaultTasks;
      } catch (error) {
        console.error('[TOOLBOX][TASK_PROFILE][DEFAULT_TASKS_CREATE_FAILED]', {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
        return [];
      }
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
      const ts = nowMsSafe();
      const raw = item && typeof item === 'object' ? item : {};
      const forceNewId = !!(options && options.forceNewId);
      const id = forceNewId
        ? createTaskIdSafe()
        : String(raw.id || '').trim() || createTaskIdSafe();

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
        maxContinueRounds: normalizeContinueRoundLimitSafe(raw.maxContinueRounds, UNLIMITED_CONTINUE_ROUNDS),
        sourceType: String(raw.sourceType || 'manual'),
        promptId: String(raw.promptId || ''),
        status: String(raw.status || 'pending'),
        continueCount: Math.max(0, Number(raw.continueCount) || 0),
        initialSent: raw.initialSent === true,
        singleInitialSent: raw.singleInitialSent === true,
        initialSentAt: Math.max(0, Number(raw.initialSentAt) || 0),
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

      const taskMax = normalizeContinueRoundLimitSafe(
        task && task.maxContinueRounds,
        UNLIMITED_CONTINUE_ROUNDS,
      );
      const profileMax = normalizeContinueRoundLimitSafe(
        profile && profile.defaultMaxContinueRounds,
        UNLIMITED_CONTINUE_ROUNDS,
      );
      const actualMaxContinueRounds = taskMax > 0 ? taskMax : profileMax;

      if (shouldLog) {
        ToolboxShell.appendLog(
          `[AUTOQ][TASK][RESOLVE_CONTINUE_PROMPT] source=${continueSource} chars=${actualContinuePromptTemplate.length}`,
        );
        ToolboxShell.appendLog(
          `[AUTOQ][TASK][MAX_CONTINUE_RESOLVE] task=${taskMax > 0 ? taskMax : 'inherit'} profile=${formatContinueRoundLimitSafe(profileMax)} actual=${formatContinueRoundLimitSafe(actualMaxContinueRounds)}`,
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
      try {
        normalizeTaskProfilesCore();
      } catch (error) {
        console.error('[TOOLBOX][TASK_PROFILE][NORMALIZE_FAILED]', {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });

        if (!Array.isArray(config.taskProfiles)) {
          config.taskProfiles = [];
        }

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX][TASK_PROFILE][NORMALIZE_FAILED] ${error && error.message ? error.message : String(error)}`,
          );
        }
      }
    }

    function normalizeTaskProfilesCore() {
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
          const base = normalizeNamedEntitySafe(profile, {
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
              normalized.doneSignal = migrateTaskDoneSignalForAutoQueueSafe(normalized.doneSignal);
            }

            if (repairTaskItemEntity(normalized)) {
              repairChanged = true;
            }
            return normalized;
          });

          if (isLegacyDefaultExampleTaskList(tasks)) {
            tasks.splice(0, tasks.length, ...createDefaultExampleTasksSafe());
            repairChanged = true;
            migrateNotes.push(`profile-${base.id}:replace-legacy-example-tasks-with-single-question-step-task`);
          }

          let defaultMaxContinueRounds = normalizeContinueRoundLimitSafe(
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
        const ts = nowMsSafe();
        const profileId = createId('autoq_task_profile');

        config.taskProfiles.push({
          id: profileId,
          name: '默认任务组',
          ...createDefaultTaskProfileDefaults(),
          tasks: createDefaultExampleTasksSafe(),
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
        config.taskQueueSettings = createDefaultTaskQueueSettingsSafe();
      } else {
        const taskQueueDefaults = createDefaultTaskQueueSettingsSafe();
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
        const verifyPromptAlreadyMigrated = rawTaskQueue.verifyAfterDoneSignalPromptMigratedFromFullTask === true;
        const shouldMigrateVerifyPrompt = !verifyPromptAlreadyMigrated && (
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
          forceHomeBeforeEachBatchTask: rawTaskQueue.forceHomeBeforeEachBatchTask !== false,
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
            normalizeTaskAutoUploadCountModeSafe(
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

          verifyAfterDoneSignalPromptMigratedFromFullTask:
            verifyPromptAlreadyMigrated || shouldMigrateVerifyPrompt,

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
            clonePlainObjectSafe(config, createDefaultAutoConfigSafe(), '[AUTOQ][repair-save]'),
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
      const base = `任务组_${d.getFullYear()}${pad2Safe(d.getMonth() + 1)}${pad2Safe(d.getDate())}_${pad2Safe(d.getHours())}${pad2Safe(d.getMinutes())}${pad2Safe(d.getSeconds())}`;
      const names = new Set(config.taskProfiles.map((item) => item.name));

      return buildUniqueNameSafe(base, names);
    }

    function getEnabledTasksFromProfile(profile) {
      if (!profile || !Array.isArray(profile.tasks)) {
        return [];
      }

      return profile.tasks.filter((task) => task && task.enabled);
    }


      return Object.freeze({
        DEFAULT_SINGLE_QUESTION_STEP_PROMPT,
        createDefaultTaskProfileDefaults,
        createDefaultTaskItem,
        createDefaultExampleTasksSafe,
        normalizeTaskItem,
        normalizeProfileTasks,
        resolveTaskContinueSettings,
        normalizeTaskProfiles,
        normalizeTaskProfilesCore,
        getActiveTaskProfile,
        buildAutoQueueTaskProfileName,
        getEnabledTasksFromProfile,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueTaskProfileConfig = AutoQueueTaskProfileConfig;


