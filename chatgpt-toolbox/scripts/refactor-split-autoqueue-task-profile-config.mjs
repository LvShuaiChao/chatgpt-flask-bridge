import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const TASK_PROFILE_CONFIG_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-task-profile-config.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_TASK_PROFILE_SPLIT][MISSING_FILE] file=${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(text || ''), 'utf8');
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const backupPath = `${filePath}.bak.${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`[AUTOQ_TASK_PROFILE_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_TASK_PROFILE_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModuleText(extractedBlock) {
  return `  /********************************************************************
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
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][DEFAULT_AUTO_CONFIG_FALLBACK] createDefaultAutoConfig missing');
        return {};
      }

${extractedBlock
  .replaceAll('nowMs()', 'nowMsSafe()')
  .replaceAll('createTaskId()', 'createTaskIdSafe()')
  .replaceAll('normalizeContinueRoundLimit(', 'normalizeContinueRoundLimitSafe(')
  .replaceAll('migrateTaskDoneSignalForAutoQueue(', 'migrateTaskDoneSignalForAutoQueueSafe(')
  .replaceAll('formatContinueRoundLimit(', 'formatContinueRoundLimitSafe(')
  .replaceAll('createDefaultTaskQueueSettings()', 'createDefaultTaskQueueSettingsSafe()')
  .replaceAll('clonePlainObject(', 'clonePlainObjectSafe(')
  .replaceAll('createDefaultAutoConfig()', 'createDefaultAutoConfigSafe()')
  .replaceAll('pad2(', 'pad2Safe(')
  .replaceAll('buildUniqueName(', 'buildUniqueNameSafe(')
  .replaceAll('normalizeNamedEntity(', 'normalizeNamedEntitySafe(')
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
`;
}

function buildFacadeBlock() {
  return `    let autoQueueTaskProfileConfigApi = null;

    function ensureAutoQueueTaskProfileConfigApi() {
      if (autoQueueTaskProfileConfigApi) {
        return autoQueueTaskProfileConfigApi;
      }
      if (
        typeof AutoQueueTaskProfileConfig === 'undefined'
        || !AutoQueueTaskProfileConfig
        || typeof AutoQueueTaskProfileConfig.create !== 'function'
      ) {
        console.error('[AUTOQ_TASK_PROFILE_CONFIG][MISSING] AutoQueueTaskProfileConfig.create is not available');
        return null;
      }
      autoQueueTaskProfileConfigApi = AutoQueueTaskProfileConfig.create({
        config,
        BATCH_CONTINUE_TEMPLATE,
        TASK_DONE_SIGNAL,
        UNLIMITED_CONTINUE_ROUNDS,
        LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS,
        createTaskId,
        normalizeContinueRoundLimit,
        migrateTaskDoneSignalForAutoQueue,
        taskRepairLog,
        formatContinueRoundLimit,
        createDefaultTaskQueueSettings,
        clonePlainObject,
        createDefaultAutoConfig,
        nowMs,
        createId,
        pad2,
        buildUniqueName,
        normalizeNamedEntity,
      });
      return autoQueueTaskProfileConfigApi;
    }

    function requireAutoQueueTaskProfileConfigApi(methodName) {
      const api = ensureAutoQueueTaskProfileConfigApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_TASK_PROFILE_CONFIG][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    const DEFAULT_SINGLE_QUESTION_STEP_PROMPT = (() => {
      const api = ensureAutoQueueTaskProfileConfigApi();
      return api && typeof api.DEFAULT_SINGLE_QUESTION_STEP_PROMPT === 'string'
        ? api.DEFAULT_SINGLE_QUESTION_STEP_PROMPT
        : '';
    })();

    function createDefaultTaskProfileDefaults() {
      return requireAutoQueueTaskProfileConfigApi('createDefaultTaskProfileDefaults')();
    }

    function createDefaultTaskItem(overrides = {}) {
      return requireAutoQueueTaskProfileConfigApi('createDefaultTaskItem')(overrides);
    }

    function createDefaultExampleTasksSafe() {
      return requireAutoQueueTaskProfileConfigApi('createDefaultExampleTasksSafe')();
    }

    function normalizeTaskItem(item, options = {}) {
      return requireAutoQueueTaskProfileConfigApi('normalizeTaskItem')(item, options);
    }

    function normalizeProfileTasks(tasks) {
      return requireAutoQueueTaskProfileConfigApi('normalizeProfileTasks')(tasks);
    }

    function resolveTaskContinueSettings(task, profile) {
      return requireAutoQueueTaskProfileConfigApi('resolveTaskContinueSettings')(task, profile);
    }

    function normalizeTaskProfiles() {
      return requireAutoQueueTaskProfileConfigApi('normalizeTaskProfiles')();
    }

    function normalizeTaskProfilesCore() {
      return requireAutoQueueTaskProfileConfigApi('normalizeTaskProfilesCore')();
    }

    function getActiveTaskProfile() {
      return requireAutoQueueTaskProfileConfigApi('getActiveTaskProfile')();
    }

    function buildAutoQueueTaskProfileName() {
      return requireAutoQueueTaskProfileConfigApi('buildAutoQueueTaskProfileName')();
    }

    function getEnabledTasksFromProfile(profile) {
      return requireAutoQueueTaskProfileConfigApi('getEnabledTasksFromProfile')(profile);
    }

`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function createDefaultTaskProfileDefaults() {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function normalizeAutoMode(mode) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    const LEGACY_DEFAULT_MAX_CONTINUE_ROUNDS = 10;', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueTaskProfileConfigApi = null;')) {
    throw new Error('[AUTOQ_TASK_PROFILE_SPLIT][ALREADY_PATCHED] autoQueueTaskProfileConfigApi already exists');
  }

  const removeStartMarker = '    function createDefaultTaskProfileDefaults() {';
  const removeEndMarker = '    function normalizeAutoMode(mode) {';
  const removeStart = source.indexOf(removeStartMarker);
  const removeEnd = source.indexOf(removeEndMarker, removeStart);
  if (removeStart < 0 || removeEnd < 0 || removeEnd <= removeStart) {
    throw new Error('[AUTOQ_TASK_PROFILE_SPLIT][REMOVE_RANGE_INVALID]');
  }

  const extractedBlock = source.slice(removeStart, removeEnd).trimEnd() + '\n';
  const requiredExtractedMarkers = [
    'function createDefaultTaskProfileDefaults',
    'function createDefaultTaskItem',
    'DEFAULT_SINGLE_QUESTION_STEP_PROMPT',
    'function createDefaultExampleTasksSafe',
    'function normalizeTaskItem',
    'function normalizeProfileTasks',
    'function resolveTaskContinueSettings',
    'function normalizeTaskProfiles',
    'function normalizeTaskProfilesCore',
    'function getActiveTaskProfile',
    'function buildAutoQueueTaskProfileName',
    'function getEnabledTasksFromProfile',
  ];
  const missingMarkers = requiredExtractedMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_TASK_PROFILE_SPLIT][EXTRACT_RANGE_INVALID] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, removeStart).replace(/\s*$/, '\n\n');
  const after = source.slice(removeEnd);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(TASK_PROFILE_CONFIG_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);

  console.log('[AUTOQ_TASK_PROFILE_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_TASK_PROFILE_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-task-profile-config.js');

  const listProfileConfigIndex = parts.indexOf('autoqueue/auto-queue-list-profile-config.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (listProfileConfigIndex < 0) {
    throw new Error('[AUTOQ_TASK_PROFILE_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-list-profile-config.js');
  }
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_TASK_PROFILE_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  parts.splice(listProfileConfigIndex + 1, 0, 'autoqueue/auto-queue-task-profile-config.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_TASK_PROFILE_SPLIT][BUILD_ORDER_OK]', {
    taskProfileIndex: parts.indexOf('autoqueue/auto-queue-task-profile-config.js'),
    listProfileIndex: parts.indexOf('autoqueue/auto-queue-list-profile-config.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(TASK_PROFILE_CONFIG_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueTaskProfileConfigApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueTaskProfileConfigApi facade');
  }
  if (!core.includes("requireAutoQueueTaskProfileConfigApi('normalizeTaskProfiles')")) {
    failures.push('auto-queue-core.js normalizeTaskProfiles is not delegated');
  }
  if (
    core.includes('const DEFAULT_SINGLE_QUESTION_STEP_TASK_PROMPT = `')
    || core.includes('function createDefaultExampleTasks()')
  ) {
    failures.push('auto-queue-core.js still contains default task prompt/example implementation');
  }
  if (!moduleText.includes('const AutoQueueTaskProfileConfig = (() => {')) {
    failures.push('auto-queue-task-profile-config.js missing AutoQueueTaskProfileConfig module');
  }

  [
    'function createDefaultTaskProfileDefaults',
    'function createDefaultTaskItem',
    'DEFAULT_SINGLE_QUESTION_STEP_PROMPT',
    'function createDefaultExampleTasksSafe',
    'function normalizeTaskItem',
    'function normalizeTaskProfiles',
    'function normalizeTaskProfilesCore',
    'function getActiveTaskProfile',
    'function buildAutoQueueTaskProfileName',
    'function getEnabledTasksFromProfile',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-task-profile-config.js missing ${marker}`);
    }
  });

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const taskProfileIndex = order.parts.indexOf('autoqueue/auto-queue-task-profile-config.js');
    const listProfileIndex = order.parts.indexOf('autoqueue/auto-queue-list-profile-config.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (taskProfileIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-task-profile-config.js');
    }
    if (listProfileIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-list-profile-config.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(listProfileIndex >= 0 && taskProfileIndex > listProfileIndex)) {
      failures.push('auto-queue-task-profile-config.js must be after auto-queue-list-profile-config.js');
    }
    if (!(taskProfileIndex >= 0 && coreIndex >= 0 && taskProfileIndex < coreIndex)) {
      failures.push('auto-queue-task-profile-config.js must be before auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_TASK_PROFILE_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_TASK_PROFILE_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_TASK_PROFILE_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_TASK_PROFILE_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_TASK_PROFILE_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_TASK_PROFILE_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
