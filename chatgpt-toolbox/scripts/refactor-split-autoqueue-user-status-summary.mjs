import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const USER_STATUS_SUMMARY_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-user-status-summary.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueUserStatusSummary：自动队列用户状态摘要卡片
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责用户状态提示、当前任务摘要、耗时摘要、状态卡片 HTML。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态流转。
   ********************************************************************/
  const AutoQueueUserStatusSummary = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const escapeHtml = deps.escapeHtml;
      const shouldShowIdleState = deps.shouldShowIdleState;
      const shouldShowStoppedState = deps.shouldShowStoppedState;
      const getCurrentBatchTaskInfo = deps.getCurrentBatchTaskInfo;
      const getEditedTaskId = deps.getEditedTaskId;
      const buildAutoQueueDebugEntryStatusState = deps.buildAutoQueueDebugEntryStatusState;
      const RuntimeStatsModuleRef = deps.RuntimeStatsModuleRef
        || (typeof RuntimeStatsModule !== 'undefined' ? RuntimeStatsModule : null);
      const ListModeRunnerRef = deps.ListModeRunnerRef
        || (typeof globalThis !== 'undefined' ? globalThis.ListModeRunner : null);
      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      function shouldShowIdleStateSafe() {
        if (typeof shouldShowIdleState === 'function') {
          return shouldShowIdleState();
        }
        return false;
      }
      function shouldShowStoppedStateSafe() {
        if (typeof shouldShowStoppedState === 'function') {
          return shouldShowStoppedState();
        }
        return false;
      }
      function getCurrentBatchTaskInfoSafe(source) {
        if (typeof getCurrentBatchTaskInfo === 'function') {
          return getCurrentBatchTaskInfo(source);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][DEPENDENCY_MISSING]', {
          name: 'getCurrentBatchTaskInfo',
          source,
        });
        return {
          total: 0,
          displayIndex: '-',
          title: '-',
          taskId: '-',
          phase: '-',
          step: '-',
          taskStatus: '-',
          sentCount: 0,
          continueCount: 0,
          businessSentCount: 0,
          currentTaskInitialSent: false,
          currentTaskContinueCount: 0,
          batchTotalSentCount: 0,
          verifySentCount: 0,
          waitingReply: false,
          replyWaitText: '-',
          batchRunning: false,
        };
      }
      function getEditedTaskIdSafe() {
        if (typeof getEditedTaskId === 'function') {
          return getEditedTaskId();
        }
        return '';
      }
      function buildAutoQueueDebugEntryStatusStateSafe(input) {
        if (typeof buildAutoQueueDebugEntryStatusState === 'function') {
          return buildAutoQueueDebugEntryStatusState(input);
        }
        console.error('[AUTOQ_USER_STATUS_SUMMARY][DEPENDENCY_MISSING]', {
          name: 'buildAutoQueueDebugEntryStatusState',
        });
        return input && typeof input === 'object' ? input : {};
      }
${extractedBlock
  .replaceAll('escapeHtml(', 'escapeHtmlSafe(')
  .replaceAll('shouldShowIdleState()', 'shouldShowIdleStateSafe()')
  .replaceAll('shouldShowStoppedState()', 'shouldShowStoppedStateSafe()')
  .replaceAll('RuntimeStatsModule', 'RuntimeStatsModuleRef')
  .replaceAll('typeof ListModeRunner !== \'undefined\'', 'typeof ListModeRunnerRef !== \'undefined\'')
  .replaceAll('ListModeRunner.', 'ListModeRunnerRef.')
  .replaceAll('getCurrentBatchTaskInfo(', 'getCurrentBatchTaskInfoSafe(')
  .replaceAll('getEditedTaskId()', 'getEditedTaskIdSafe()')
  .replaceAll('buildAutoQueueDebugEntryStatusState(', 'buildAutoQueueDebugEntryStatusStateSafe(')
}
      return Object.freeze({
        getAutoQueueUserActionHint,
        buildAutoQueueTimingSummaryText,
        renderAutoQueueUserStatusRow,
        buildCurrentListTaskSummaryHtml,
        buildCurrentBatchTaskSummaryHtml,
        buildWatchdogSkipHintHtml,
        buildRunningEditingMismatchHintHtml,
        buildAutoQueueUserStatusSummaryHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueUserStatusSummary = AutoQueueUserStatusSummary;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueUserStatusSummaryApi = null;
    function ensureAutoQueueUserStatusSummaryApi() {
      if (autoQueueUserStatusSummaryApi) {
        return autoQueueUserStatusSummaryApi;
      }
      if (
        typeof AutoQueueUserStatusSummary === 'undefined'
        || !AutoQueueUserStatusSummary
        || typeof AutoQueueUserStatusSummary.create !== 'function'
      ) {
        console.error('[AUTOQ_USER_STATUS_SUMMARY][MISSING] AutoQueueUserStatusSummary.create is not available');
        return null;
      }
      autoQueueUserStatusSummaryApi = AutoQueueUserStatusSummary.create({
        state,
        config,
        escapeHtml,
        shouldShowIdleState,
        shouldShowStoppedState,
        getCurrentBatchTaskInfo,
        getEditedTaskId,
        buildAutoQueueDebugEntryStatusState,
        RuntimeStatsModuleRef: typeof RuntimeStatsModule !== 'undefined' ? RuntimeStatsModule : null,
        ListModeRunnerRef: typeof globalThis !== 'undefined' ? globalThis.ListModeRunner : null,
      });
      return autoQueueUserStatusSummaryApi;
    }
    function requireAutoQueueUserStatusSummaryApi(methodName) {
      const api = ensureAutoQueueUserStatusSummaryApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_USER_STATUS_SUMMARY][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function getAutoQueueUserActionHint(statusState = {}) {
      return requireAutoQueueUserStatusSummaryApi('getAutoQueueUserActionHint')(
        statusState,
      );
    }
    function buildAutoQueueTimingSummaryText() {
      return requireAutoQueueUserStatusSummaryApi('buildAutoQueueTimingSummaryText')();
    }
    function renderAutoQueueUserStatusRow(label, value, options = {}) {
      return requireAutoQueueUserStatusSummaryApi('renderAutoQueueUserStatusRow')(
        label,
        value,
        options,
      );
    }
    function buildCurrentListTaskSummaryHtml() {
      return requireAutoQueueUserStatusSummaryApi('buildCurrentListTaskSummaryHtml')();
    }
    function buildCurrentBatchTaskSummaryHtml(source = 'render-batch-status-card') {
      return requireAutoQueueUserStatusSummaryApi('buildCurrentBatchTaskSummaryHtml')(
        source,
      );
    }
    function buildWatchdogSkipHintHtml() {
      return requireAutoQueueUserStatusSummaryApi('buildWatchdogSkipHintHtml')();
    }
    function buildRunningEditingMismatchHintHtml() {
      return requireAutoQueueUserStatusSummaryApi('buildRunningEditingMismatchHintHtml')();
    }
    function buildAutoQueueUserStatusSummaryHtml(options = {}) {
      return requireAutoQueueUserStatusSummaryApi('buildAutoQueueUserStatusSummaryHtml')(
        options,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function getAutoQueueUserActionHint(statusState = {}) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    let autoQueueAdvancedDebugPanelApi = null;', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueUserStatusSummaryApi = null;')) {
    throw new Error('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][ALREADY_PATCHED] autoQueueUserStatusSummaryApi already exists');
  }
  const startMarker = '    function getAutoQueueUserActionHint(statusState = {}) {';
  const endMarker = '    let autoQueueAdvancedDebugPanelApi = null;';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function getAutoQueueUserActionHint',
    'function buildAutoQueueTimingSummaryText',
    'function renderAutoQueueUserStatusRow',
    'function buildCurrentListTaskSummaryHtml',
    'function buildCurrentBatchTaskSummaryHtml',
    'function buildWatchdogSkipHintHtml',
    'function buildRunningEditingMismatchHintHtml',
    'function buildAutoQueueUserStatusSummaryHtml',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(USER_STATUS_SUMMARY_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-user-status-summary.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const batchMainButtonVmIndex = parts.indexOf('autoqueue/auto-queue-batch-main-button-vm.js');
  const advancedDebugControllerIndex = parts.indexOf('autoqueue/auto-queue-advanced-debug-controller.js');
  if (batchMainButtonVmIndex >= 0) {
    insertIndex = batchMainButtonVmIndex + 1;
  } else if (advancedDebugControllerIndex >= 0) {
    insertIndex = advancedDebugControllerIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-user-status-summary.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][BUILD_ORDER_OK]', {
    userStatusSummaryIndex: parts.indexOf('autoqueue/auto-queue-user-status-summary.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(USER_STATUS_SUMMARY_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueUserStatusSummaryApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueUserStatusSummaryApi facade');
  }
  if (!core.includes("requireAutoQueueUserStatusSummaryApi('buildAutoQueueUserStatusSummaryHtml')")) {
    failures.push('auto-queue-core.js buildAutoQueueUserStatusSummaryHtml is not delegated');
  }
  if (
    core.includes('function buildAutoQueueUserStatusSummaryHtml(options = {})')
    && core.includes('cgpt-autoq-user-summary')
  ) {
    failures.push('auto-queue-core.js still contains full user status summary implementation');
  }
  if (!core.includes('let autoQueueAdvancedDebugPanelApi = null;')) {
    failures.push('auto-queue-core.js lost autoQueueAdvancedDebugPanelApi');
  }
  if (!moduleText.includes('const AutoQueueUserStatusSummary = (() => {')) {
    failures.push('auto-queue-user-status-summary.js missing module');
  }
  [
    'function getAutoQueueUserActionHint',
    'function buildAutoQueueTimingSummaryText',
    'function renderAutoQueueUserStatusRow',
    'function buildCurrentListTaskSummaryHtml',
    'function buildCurrentBatchTaskSummaryHtml',
    'function buildWatchdogSkipHintHtml',
    'function buildRunningEditingMismatchHintHtml',
    'function buildAutoQueueUserStatusSummaryHtml',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-user-status-summary.js missing ${marker}`);
    }
  });
  if (!moduleText.includes('cgpt-autoq-user-summary')) {
    failures.push('auto-queue-user-status-summary.js must preserve cgpt-autoq-user-summary markup');
  }
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const summaryIndex = order.parts.indexOf('autoqueue/auto-queue-user-status-summary.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (summaryIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-user-status-summary.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(summaryIndex >= 0 && coreIndex >= 0 && summaryIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-user-status-summary.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_USER_STATUS_SUMMARY_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_USER_STATUS_SUMMARY_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
