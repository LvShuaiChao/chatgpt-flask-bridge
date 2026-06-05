import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const DISPLAY_STATE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-display-state.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_DISPLAY_STATE_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_DISPLAY_STATE_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_DISPLAY_STATE_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueDisplayState：自动队列面板运行状态判定
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责判断面板应显示 idle / running / waiting_reply / stopped 等状态。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责持久化。
   ********************************************************************/
  const AutoQueueDisplayState = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const AUTO_QUEUE_PRE_SEND_STEPS = deps.AUTO_QUEUE_PRE_SEND_STEPS;
      const TASK_RUN_STEP_LABELS = deps.TASK_RUN_STEP_LABELS;
      const getModeDisplayText = deps.getModeDisplayText;
      const getListModeTimeoutSettings = deps.getListModeTimeoutSettings;
      const isChatGPTActivelyReplyingForListMode = deps.isChatGPTActivelyReplyingForListMode;
      const getCurrentBatchTaskInfo = deps.getCurrentBatchTaskInfo;
      const getBatchTaskSuggestion = deps.getBatchTaskSuggestion;
      const getBatchTaskPanelStatusText = deps.getBatchTaskPanelStatusText;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DISPLAY_STATE][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function getModeDisplayTextSafe(mode) {
        return requireFn('getModeDisplayText', getModeDisplayText)(mode);
      }

      function getListModeTimeoutSettingsSafe() {
        return requireFn('getListModeTimeoutSettings', getListModeTimeoutSettings)();
      }

      function isChatGPTActivelyReplyingForListModeSafe(source) {
        return requireFn(
          'isChatGPTActivelyReplyingForListMode',
          isChatGPTActivelyReplyingForListMode,
        )(source);
      }

      function getCurrentBatchTaskInfoSafe(source) {
        return requireFn('getCurrentBatchTaskInfo', getCurrentBatchTaskInfo)(source);
      }

      function getBatchTaskSuggestionSafe(info, run, runtimeState) {
        return requireFn('getBatchTaskSuggestion', getBatchTaskSuggestion)(info, run, runtimeState);
      }

      function getBatchTaskPanelStatusTextSafe(info, run, runtimeState, modeLabel, runStateTextOverride) {
        return requireFn(
          'getBatchTaskPanelStatusText',
          getBatchTaskPanelStatusText,
        )(info, run, runtimeState, modeLabel, runStateTextOverride);
      }

      function getAutoQueueComposerPayloadStateSafe(source) {
        return requireFn('getAutoQueueComposerPayloadState', getAutoQueueComposerPayloadState)(source);
      }

      const ListModeRunner = typeof globalThis !== 'undefined'
        ? globalThis.ListModeRunner
        : undefined;

${extractedBlock
  .replaceAll('getModeDisplayText(', 'getModeDisplayTextSafe(')
  .replaceAll('getListModeTimeoutSettings()', 'getListModeTimeoutSettingsSafe()')
  .replaceAll('isChatGPTActivelyReplyingForListMode(', 'isChatGPTActivelyReplyingForListModeSafe(')
  .replaceAll('getCurrentBatchTaskInfo(', 'getCurrentBatchTaskInfoSafe(')
  .replaceAll('getBatchTaskSuggestion(', 'getBatchTaskSuggestionSafe(')
  .replaceAll('getBatchTaskPanelStatusText(', 'getBatchTaskPanelStatusTextSafe(')
  .replaceAll('getAutoQueueComposerPayloadState(', 'getAutoQueueComposerPayloadStateSafe(')
}

      return Object.freeze({
        hasCurrentRunStarted,
        isAutoQueueActuallyRunning,
        shouldShowIdleState,
        shouldShowStoppedState,
        getAutoQueueDisplayStateForPanel,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDisplayState = AutoQueueDisplayState;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueDisplayStateApi = null;

    function ensureAutoQueueDisplayStateApi() {
      if (autoQueueDisplayStateApi) {
        return autoQueueDisplayStateApi;
      }
      if (
        typeof AutoQueueDisplayState === 'undefined'
        || !AutoQueueDisplayState
        || typeof AutoQueueDisplayState.create !== 'function'
      ) {
        console.error('[AUTOQ_DISPLAY_STATE][MISSING] AutoQueueDisplayState.create is not available');
        return null;
      }
      autoQueueDisplayStateApi = AutoQueueDisplayState.create({
        state,
        config,
        AUTO_QUEUE_PHASES,
        AUTO_QUEUE_PRE_SEND_STEPS,
        TASK_RUN_STEP_LABELS,
        getModeDisplayText,
        getListModeTimeoutSettings,
        isChatGPTActivelyReplyingForListMode,
        getCurrentBatchTaskInfo,
        getBatchTaskSuggestion,
        getBatchTaskPanelStatusText,
        getAutoQueueComposerPayloadState,
      });
      return autoQueueDisplayStateApi;
    }

    function requireAutoQueueDisplayStateApi(methodName) {
      const api = ensureAutoQueueDisplayStateApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_DISPLAY_STATE][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function hasCurrentRunStarted() {
      return requireAutoQueueDisplayStateApi('hasCurrentRunStarted')();
    }

    function isAutoQueueActuallyRunning() {
      return requireAutoQueueDisplayStateApi('isAutoQueueActuallyRunning')();
    }

    function shouldShowIdleState() {
      return requireAutoQueueDisplayStateApi('shouldShowIdleState')();
    }

    function shouldShowStoppedState() {
      return requireAutoQueueDisplayStateApi('shouldShowStoppedState')();
    }

    function getAutoQueueDisplayStateForPanel(modeName = '-', runStateTextOverride = '') {
      return requireAutoQueueDisplayStateApi('getAutoQueueDisplayStateForPanel')(
        modeName,
        runStateTextOverride,
      );
    }

`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function hasCurrentRunStarted() {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function clearStaleStopAdviceForIdleMode(reason =', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueDisplayStateApi = null;')) {
    throw new Error('[AUTOQ_DISPLAY_STATE_SPLIT][ALREADY_PATCHED] autoQueueDisplayStateApi already exists');
  }

  const startMarker = '    function hasCurrentRunStarted() {';
  const endMarker = '    function clearStaleStopAdviceForIdleMode(reason =';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_DISPLAY_STATE_SPLIT][RANGE_INVALID]');
  }

  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function hasCurrentRunStarted',
    'function isAutoQueueActuallyRunning',
    'function shouldShowIdleState',
    'function shouldShowStoppedState',
    'function getAutoQueueDisplayStateForPanel',
  ];
  const missing = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missing.length > 0) {
    throw new Error(`[AUTOQ_DISPLAY_STATE_SPLIT][RANGE_MISSING] missing=${missing.join(',')}`);
  }

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(DISPLAY_STATE_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);

  console.log('[AUTOQ_DISPLAY_STATE_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_DISPLAY_STATE_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-display-state.js');

  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_DISPLAY_STATE_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  let insertIndex = coreIndex;
  const modeSettingsIndex = parts.indexOf('autoqueue/auto-queue-mode-settings.js');
  const taskProfileIndex = parts.indexOf('autoqueue/auto-queue-task-profile-config.js');
  const listProfileIndex = parts.indexOf('autoqueue/auto-queue-list-profile-config.js');
  if (modeSettingsIndex >= 0) {
    insertIndex = modeSettingsIndex + 1;
  } else if (taskProfileIndex >= 0) {
    insertIndex = taskProfileIndex + 1;
  } else if (listProfileIndex >= 0) {
    insertIndex = listProfileIndex + 1;
  }

  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-display-state.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_DISPLAY_STATE_SPLIT][BUILD_ORDER_OK]', {
    displayStateIndex: parts.indexOf('autoqueue/auto-queue-display-state.js'),
    modeSettingsIndex: parts.indexOf('autoqueue/auto-queue-mode-settings.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(DISPLAY_STATE_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueDisplayStateApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueDisplayStateApi facade');
  }
  if (!core.includes("requireAutoQueueDisplayStateApi('getAutoQueueDisplayStateForPanel')")) {
    failures.push('auto-queue-core.js getAutoQueueDisplayStateForPanel is not delegated');
  }
  if (
    core.includes('function hasCurrentRunStarted()')
    && core.includes('run.started === true')
  ) {
    failures.push('auto-queue-core.js still contains full hasCurrentRunStarted implementation');
  }
  if (!core.includes('function clearStaleStopAdviceForIdleMode(reason =')) {
    failures.push('auto-queue-core.js lost clearStaleStopAdviceForIdleMode');
  }
  if (!moduleText.includes('const AutoQueueDisplayState = (() => {')) {
    failures.push('auto-queue-display-state.js missing AutoQueueDisplayState module');
  }

  [
    'function hasCurrentRunStarted',
    'function isAutoQueueActuallyRunning',
    'function shouldShowIdleState',
    'function shouldShowStoppedState',
    'function getAutoQueueDisplayStateForPanel',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-display-state.js missing ${marker}`);
    }
  });

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const displayStateIndex = order.parts.indexOf('autoqueue/auto-queue-display-state.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (displayStateIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-display-state.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(displayStateIndex >= 0 && coreIndex >= 0 && displayStateIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-display-state.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_DISPLAY_STATE_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_DISPLAY_STATE_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_DISPLAY_STATE_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_DISPLAY_STATE_SPLIT][START] root=${ROOT_DIR}`);
  if (process.argv.includes('--verify-only')) {
    verifyResult();
    console.log('[AUTOQ_DISPLAY_STATE_SPLIT][DONE] verify-only');
    return;
  }
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_DISPLAY_STATE_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_DISPLAY_STATE_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
