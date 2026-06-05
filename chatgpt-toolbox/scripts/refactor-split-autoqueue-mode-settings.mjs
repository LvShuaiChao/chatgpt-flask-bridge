import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const MODE_SETTINGS_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-mode-settings.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_MODE_SETTINGS_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_MODE_SETTINGS_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_MODE_SETTINGS_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModeSettingsModuleText() {
  const moduleText = `  /********************************************************************
   * AutoQueueModeSettings：自动队列模式设置归一化
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 promptMode / modeSettings 的配置归一化和 patch。
   * 3. 不负责 UI 读取，不负责发送，不负责等待回复，不负责闭环，不负责上传。
   ********************************************************************/
  const AutoQueueModeSettings = (() => {
    function create(deps = {}) {
      const config = deps.config;
      const cloneDefaultModeSettings = deps.cloneDefaultModeSettings;
      const cloneModeSettingItem = deps.cloneModeSettingItem;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_MODE_SETTINGS][CREATE_FAILED] missing config');
      }

      function cloneDefaultModeSettingsSafe() {
        if (typeof cloneDefaultModeSettings === 'function') {
          return cloneDefaultModeSettings();
        }
        console.error('[AUTOQ_MODE_SETTINGS][DEFAULTS_FALLBACK] cloneDefaultModeSettings missing');
        return {
          continue: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
          list: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
          task: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
        };
      }

      function cloneModeSettingItemSafe(value) {
        if (typeof cloneModeSettingItem === 'function') {
          return cloneModeSettingItem(value);
        }
        console.error('[AUTOQ_MODE_SETTINGS][ITEM_CLONE_FALLBACK] cloneModeSettingItem missing', {
          value,
        });
        const raw = value && typeof value === 'object' ? value : {};
        return {
          loopMode: !!raw.loopMode,
          randomMinSec: Math.max(1, Number(raw.randomMinSec) || 3),
          randomMaxSec: Math.max(
            Math.max(1, Number(raw.randomMinSec) || 3),
            Number(raw.randomMaxSec) || 20,
          ),
          maxLoopCount: Math.max(0, Number(raw.maxLoopCount) || 0),
          logPinned: !!raw.logPinned,
          autoScrollPanel: raw.autoScrollPanel !== false,
        };
      }

      function normalizeAutoMode(mode) {
        if (mode === 'list') return 'list';
        if (mode === 'task') return 'task';
        if (mode === 'closed-loop') return 'closed-loop';
        return 'continue';
      }

      function ensureModeSettings(cfg = config) {
        const base = cloneDefaultModeSettingsSafe();
        const raw = cfg && typeof cfg.modeSettings === 'object'
          ? cfg.modeSettings
          : {};

        return {
          continue: cloneModeSettingItemSafe(Object.assign({}, base.continue, raw.continue || {})),
          list: cloneModeSettingItemSafe(Object.assign({}, base.list, raw.list || {})),
          task: cloneModeSettingItemSafe(Object.assign({}, base.task, raw.task || {})),
          'closed-loop': cloneModeSettingItemSafe(Object.assign({}, base.continue, raw['closed-loop'] || {})),
        };
      }

      function normalizeAutoConfig(cfg = config) {
        if (!cfg || typeof cfg !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][NORMALIZE_CONFIG_FAILED] invalid cfg');
          return cfg;
        }
        cfg.modeSettings = ensureModeSettings(cfg);
        cfg.promptMode = normalizeAutoMode(cfg.promptMode);
        return cfg;
      }

      function getModeSettings(mode) {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][GET_FAILED] missing config', { mode });
          return cloneModeSettingItemSafe({});
        }
        const m = normalizeAutoMode(mode);
        config.modeSettings = ensureModeSettings(config);
        return config.modeSettings[m];
      }

      function patchModeSettings(mode, patch) {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][PATCH_FAILED] missing config', { mode, patch });
          return;
        }
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
          target.randomMaxSec = Math.max(
            target.randomMinSec,
            Number(safePatch.randomMaxSec) || target.randomMinSec,
          );
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

      return Object.freeze({
        normalizeAutoMode,
        ensureModeSettings,
        normalizeAutoConfig,
        getModeSettings,
        patchModeSettings,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueModeSettings = AutoQueueModeSettings;
`;
  writeText(MODE_SETTINGS_FILE, moduleText);
  console.log('[AUTOQ_MODE_SETTINGS_SPLIT][MODULE_WRITTEN] file=autoqueue/auto-queue-mode-settings.js');
}

function buildFacadeAndInitBlock(originalInitBlock) {
  return `    let autoQueueModeSettingsApi = null;

    function ensureAutoQueueModeSettingsApi() {
      if (autoQueueModeSettingsApi) {
        return autoQueueModeSettingsApi;
      }
      if (
        typeof AutoQueueModeSettings === 'undefined'
        || !AutoQueueModeSettings
        || typeof AutoQueueModeSettings.create !== 'function'
      ) {
        console.error('[AUTOQ_MODE_SETTINGS][MISSING] AutoQueueModeSettings.create is not available');
        return null;
      }
      autoQueueModeSettingsApi = AutoQueueModeSettings.create({
        config,
        cloneDefaultModeSettings,
        cloneModeSettingItem,
      });
      return autoQueueModeSettingsApi;
    }

    function requireAutoQueueModeSettingsApi(methodName) {
      const api = ensureAutoQueueModeSettingsApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_MODE_SETTINGS][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function normalizeAutoMode(mode) {
      return requireAutoQueueModeSettingsApi('normalizeAutoMode')(mode);
    }

    function ensureModeSettings(cfg = config) {
      return requireAutoQueueModeSettingsApi('ensureModeSettings')(cfg);
    }

    function normalizeAutoConfig(cfg = config) {
      return requireAutoQueueModeSettingsApi('normalizeAutoConfig')(cfg);
    }

${originalInitBlock}
    function getModeSettings(mode) {
      return requireAutoQueueModeSettingsApi('getModeSettings')(mode);
    }

    function patchModeSettings(mode, patch) {
      return requireAutoQueueModeSettingsApi('patchModeSettings')(mode, patch);
    }
`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);

  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function normalizeAutoMode(mode) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function readCurrentModeSettingsFromUi(mode) {', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueModeSettingsApi = null;')) {
    throw new Error('[AUTOQ_MODE_SETTINGS_SPLIT][ALREADY_PATCHED] autoQueueModeSettingsApi already exists');
  }

  const startMarker = '    function normalizeAutoMode(mode) {';
  const endMarker = '    function readCurrentModeSettingsFromUi(mode) {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_MODE_SETTINGS_SPLIT][RANGE_INVALID]');
  }

  const block = source.slice(startIndex, endIndex);

  const requiredMarkers = [
    'function normalizeAutoMode',
    'function ensureModeSettings',
    'function normalizeAutoConfig',
    'normalizeAutoConfig(config);',
    'normalizeListProfiles();',
    'normalizeTaskProfiles();',
    'function getModeSettings',
    'function patchModeSettings',
  ];
  const missing = requiredMarkers.filter((marker) => !block.includes(marker));
  if (missing.length > 0) {
    throw new Error(`[AUTOQ_MODE_SETTINGS_SPLIT][RANGE_MISSING] missing=${missing.join(',')}`);
  }

  const initStartMarker = '    normalizeAutoConfig(config);';
  const initEndMarker = '    function getModeSettings(mode) {';
  const initStart = block.indexOf(initStartMarker);
  const initEnd = block.indexOf(initEndMarker, initStart);

  if (initStart < 0 || initEnd < 0 || initEnd <= initStart) {
    throw new Error('[AUTOQ_MODE_SETTINGS_SPLIT][INIT_RANGE_INVALID]');
  }

  const originalInitBlock = block.slice(initStart, initEnd).trimEnd() + '\n';

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeAndInitBlock(originalInitBlock) + after);

  console.log('[AUTOQ_MODE_SETTINGS_SPLIT][CORE_PATCHED]', {
    removedChars: block.length,
    initChars: originalInitBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);

  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_MODE_SETTINGS_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-mode-settings.js');

  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_MODE_SETTINGS_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  let insertIndex = coreIndex;
  const taskProfileIndex = parts.indexOf('autoqueue/auto-queue-task-profile-config.js');
  const listProfileIndex = parts.indexOf('autoqueue/auto-queue-list-profile-config.js');
  const listSyncIndex = parts.indexOf('autoqueue/auto-queue-list-profile-sync.js');

  if (taskProfileIndex >= 0) {
    insertIndex = taskProfileIndex + 1;
  } else if (listProfileIndex >= 0) {
    insertIndex = listProfileIndex + 1;
  } else if (listSyncIndex >= 0) {
    insertIndex = listSyncIndex;
  }

  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-mode-settings.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_MODE_SETTINGS_SPLIT][BUILD_ORDER_OK]', {
    modeSettingsIndex: parts.indexOf('autoqueue/auto-queue-mode-settings.js'),
    taskProfileIndex: parts.indexOf('autoqueue/auto-queue-task-profile-config.js'),
    listProfileIndex: parts.indexOf('autoqueue/auto-queue-list-profile-config.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(MODE_SETTINGS_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));

  const failures = [];

  if (!core.includes('let autoQueueModeSettingsApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueModeSettingsApi facade');
  }
  if (!core.includes("requireAutoQueueModeSettingsApi('normalizeAutoMode')")) {
    failures.push('auto-queue-core.js normalizeAutoMode is not delegated');
  }
  if (!core.includes('normalizeAutoConfig(config);')) {
    failures.push('auto-queue-core.js lost normalizeAutoConfig(config) init call');
  }
  if (!core.includes('normalizeListProfiles();')) {
    failures.push('auto-queue-core.js lost normalizeListProfiles() init call');
  }
  if (!core.includes('normalizeTaskProfiles();')) {
    failures.push('auto-queue-core.js lost normalizeTaskProfiles() init call');
  }
  if (
    core.includes("if (mode === 'list') return 'list';")
    && core.includes('function normalizeAutoMode(mode)')
  ) {
    failures.push('auto-queue-core.js still contains full normalizeAutoMode implementation');
  }
  if (!moduleText.includes('const AutoQueueModeSettings = (() => {')) {
    failures.push('auto-queue-mode-settings.js missing AutoQueueModeSettings module');
  }

  [
    'function normalizeAutoMode',
    'function ensureModeSettings',
    'function normalizeAutoConfig',
    'function getModeSettings',
    'function patchModeSettings',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-mode-settings.js missing ${marker}`);
    }
  });

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const modeIndex = order.parts.indexOf('autoqueue/auto-queue-mode-settings.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (modeIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-mode-settings.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(modeIndex >= 0 && coreIndex >= 0 && modeIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-mode-settings.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_MODE_SETTINGS_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_MODE_SETTINGS_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_MODE_SETTINGS_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_MODE_SETTINGS_SPLIT][START] root=${ROOT_DIR}`);
  buildModeSettingsModuleText();
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_MODE_SETTINGS_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_MODE_SETTINGS_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
