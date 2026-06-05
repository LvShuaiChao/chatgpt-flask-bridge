import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const BATCH_MAIN_BUTTON_VM_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-batch-main-button-vm.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueBatchMainButtonVm：批量任务主按钮视图状态
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 cgpt-autoq-start 的 label、viewState、data-role、owner 同步。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责回复等待。
   ********************************************************************/
  const AutoQueueBatchMainButtonVm = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const hasCurrentRunStarted = deps.hasCurrentRunStarted;
      const shouldShowStoppedState = deps.shouldShowStoppedState;
      const getAutoQueueDisplayStateForPanel = deps.getAutoQueueDisplayStateForPanel;
      const appendLog = deps.appendLog;
      function appendLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendLog === 'function') {
          appendLog(text);
          return;
        }
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(text);
          return;
        }
        console.log(text);
      }
      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }
      function hasCurrentRunStartedSafe() {
        if (typeof hasCurrentRunStarted === 'function') {
          return hasCurrentRunStarted();
        }
        return false;
      }
      function shouldShowStoppedStateSafe() {
        if (typeof shouldShowStoppedState === 'function') {
          return shouldShowStoppedState();
        }
        return false;
      }
      function getAutoQueueDisplayStateForPanelSafe(modeName = '-', runStateTextOverride = '') {
        if (typeof getAutoQueueDisplayStateForPanel === 'function') {
          return getAutoQueueDisplayStateForPanel(modeName, runStateTextOverride);
        }
        return {
          status: 'idle',
          statusText: '未开始',
          tone: 'muted',
        };
      }
      const ListModeRunnerRef = typeof globalThis !== 'undefined'
        ? globalThis.ListModeRunner
        : undefined;
${extractedBlock
  .replaceAll('typeof getCurrentRunningTask === \'function\'\n        ? getCurrentRunningTask()\n        : null', 'getCurrentRunningTaskSafe()')
  .replaceAll('hasCurrentRunStarted()', 'hasCurrentRunStartedSafe()')
  .replaceAll('shouldShowStoppedState()', 'shouldShowStoppedStateSafe()')
  .replaceAll('getAutoQueueDisplayStateForPanel(', 'getAutoQueueDisplayStateForPanelSafe(')
  .replaceAll('typeof ListModeRunner !== \'undefined\'', 'typeof ListModeRunnerRef !== \'undefined\'')
  .replaceAll('ListModeRunner.', 'ListModeRunnerRef.')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
}
      return Object.freeze({
        isBatchTaskGroupOwnerMode,
        buildBatchTaskGroupButtonStateInput,
        isBatchTaskGroupRunning,
        isBatchTaskGroupStopping,
        getBatchTaskGroupButtonViewState,
        logBatchTaskGroupButtonState,
        applyBatchTaskGroupButtonViewState,
        getStartButtonTextByDisplayState,
        isBatchTaskMainButton,
        syncBatchTaskMainButtonOwnership,
        getBatchTaskMainButtonLabel,
        updateBatchTaskMainButton,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueBatchMainButtonVm = AutoQueueBatchMainButtonVm;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueBatchMainButtonVmApi = null;
    function ensureAutoQueueBatchMainButtonVmApi() {
      if (autoQueueBatchMainButtonVmApi) {
        return autoQueueBatchMainButtonVmApi;
      }
      if (
        typeof AutoQueueBatchMainButtonVm === 'undefined'
        || !AutoQueueBatchMainButtonVm
        || typeof AutoQueueBatchMainButtonVm.create !== 'function'
      ) {
        console.error('[AUTOQ_BATCH_MAIN_BUTTON_VM][MISSING] AutoQueueBatchMainButtonVm.create is not available');
        return null;
      }
      autoQueueBatchMainButtonVmApi = AutoQueueBatchMainButtonVm.create({
        state,
        config,
        getCurrentRunningTask: typeof getCurrentRunningTask === 'function'
          ? getCurrentRunningTask
          : null,
        hasCurrentRunStarted,
        shouldShowStoppedState,
        getAutoQueueDisplayStateForPanel,
        appendLog: (line) => {
          if (
            typeof ToolboxShell !== 'undefined'
            && ToolboxShell
            && typeof ToolboxShell.appendLog === 'function'
          ) {
            ToolboxShell.appendLog(line);
            return;
          }
          console.log(line);
        },
      });
      return autoQueueBatchMainButtonVmApi;
    }
    function requireAutoQueueBatchMainButtonVmApi(methodName) {
      const api = ensureAutoQueueBatchMainButtonVmApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_BATCH_MAIN_BUTTON_VM][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function isBatchTaskGroupOwnerMode() {
      return requireAutoQueueBatchMainButtonVmApi('isBatchTaskGroupOwnerMode')();
    }
    function buildBatchTaskGroupButtonStateInput() {
      return requireAutoQueueBatchMainButtonVmApi('buildBatchTaskGroupButtonStateInput')();
    }
    function isBatchTaskGroupRunning(stateInput = null) {
      return requireAutoQueueBatchMainButtonVmApi('isBatchTaskGroupRunning')(
        stateInput,
      );
    }
    function isBatchTaskGroupStopping(stateInput = null) {
      return requireAutoQueueBatchMainButtonVmApi('isBatchTaskGroupStopping')(
        stateInput,
      );
    }
    function getBatchTaskGroupButtonViewState(stateInput = null) {
      return requireAutoQueueBatchMainButtonVmApi('getBatchTaskGroupButtonViewState')(
        stateInput,
      );
    }
    function logBatchTaskGroupButtonState(btn, viewState, reason = '-') {
      return requireAutoQueueBatchMainButtonVmApi('logBatchTaskGroupButtonState')(
        btn,
        viewState,
        reason,
      );
    }
    function applyBatchTaskGroupButtonViewState(btn, viewState, reason = '-') {
      return requireAutoQueueBatchMainButtonVmApi('applyBatchTaskGroupButtonViewState')(
        btn,
        viewState,
        reason,
      );
    }
    function getStartButtonTextByDisplayState(modeName = '-') {
      return requireAutoQueueBatchMainButtonVmApi('getStartButtonTextByDisplayState')(
        modeName,
      );
    }
    function isBatchTaskMainButton(btn) {
      return requireAutoQueueBatchMainButtonVmApi('isBatchTaskMainButton')(btn);
    }
    function syncBatchTaskMainButtonOwnership(btn, reason = '-') {
      return requireAutoQueueBatchMainButtonVmApi('syncBatchTaskMainButtonOwnership')(
        btn,
        reason,
      );
    }
    function getBatchTaskMainButtonLabel(btn) {
      return requireAutoQueueBatchMainButtonVmApi('getBatchTaskMainButtonLabel')(
        btn,
      );
    }
    function updateBatchTaskMainButton(reason) {
      return requireAutoQueueBatchMainButtonVmApi('updateBatchTaskMainButton')(
        reason,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function isBatchTaskGroupOwnerMode() {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function getAutoQueueUserActionHint(statusState = {}) {', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueBatchMainButtonVmApi = null;')) {
    throw new Error('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][ALREADY_PATCHED] autoQueueBatchMainButtonVmApi already exists');
  }
  const startMarker = '    function isBatchTaskGroupOwnerMode() {';
  const endMarker = '    function getAutoQueueUserActionHint(statusState = {}) {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function isBatchTaskGroupOwnerMode',
    'function buildBatchTaskGroupButtonStateInput',
    'function isBatchTaskGroupRunning',
    'function isBatchTaskGroupStopping',
    'function getBatchTaskGroupButtonViewState',
    'function logBatchTaskGroupButtonState',
    'function applyBatchTaskGroupButtonViewState',
    'function getStartButtonTextByDisplayState',
    'function isBatchTaskMainButton',
    'function syncBatchTaskMainButtonOwnership',
    'function getBatchTaskMainButtonLabel',
    'function updateBatchTaskMainButton',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(BATCH_MAIN_BUTTON_VM_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-batch-main-button-vm.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const advancedDebugControllerIndex = parts.indexOf('autoqueue/auto-queue-advanced-debug-controller.js');
  const displayStateIndex = parts.indexOf('autoqueue/auto-queue-display-state.js');
  if (advancedDebugControllerIndex >= 0) {
    insertIndex = advancedDebugControllerIndex + 1;
  } else if (displayStateIndex >= 0) {
    insertIndex = displayStateIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-batch-main-button-vm.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][BUILD_ORDER_OK]', {
    batchMainButtonVmIndex: parts.indexOf('autoqueue/auto-queue-batch-main-button-vm.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(BATCH_MAIN_BUTTON_VM_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueBatchMainButtonVmApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueBatchMainButtonVmApi facade');
  }
  if (!core.includes("requireAutoQueueBatchMainButtonVmApi('updateBatchTaskMainButton')")) {
    failures.push('auto-queue-core.js updateBatchTaskMainButton is not delegated');
  }
  if (
    core.includes('function buildBatchTaskGroupButtonStateInput()')
    && core.includes('batchTaskRunning: state.batchTaskRunning === true')
  ) {
    failures.push('auto-queue-core.js still contains full batch main button state input implementation');
  }
  if (!core.includes('function getAutoQueueUserActionHint(statusState = {})')) {
    failures.push('auto-queue-core.js lost getAutoQueueUserActionHint');
  }
  if (!moduleText.includes('const AutoQueueBatchMainButtonVm = (() => {')) {
    failures.push('auto-queue-batch-main-button-vm.js missing module');
  }
  [
    'function isBatchTaskGroupOwnerMode',
    'function buildBatchTaskGroupButtonStateInput',
    'function getBatchTaskGroupButtonViewState',
    'function applyBatchTaskGroupButtonViewState',
    'function syncBatchTaskMainButtonOwnership',
    'function updateBatchTaskMainButton',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-batch-main-button-vm.js missing ${marker}`);
    }
  });
  if (!moduleText.includes('batch-task-group')) {
    failures.push('auto-queue-batch-main-button-vm.js must preserve batch-task-group owner/action');
  }
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const vmIndex = order.parts.indexOf('autoqueue/auto-queue-batch-main-button-vm.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (vmIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-batch-main-button-vm.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(vmIndex >= 0 && coreIndex >= 0 && vmIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-batch-main-button-vm.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_BATCH_MAIN_BUTTON_VM_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
