import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const BATCH_STATUS_PANEL_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-batch-status-panel.js');
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueBatchStatusPanel：批量任务状态面板 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责批量任务状态面板文本与 HTML 拼接。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态流转。
   ********************************************************************/
  const AutoQueueBatchStatusPanel = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const TASK_TERMINAL_KIND = deps.TASK_TERMINAL_KIND;
      const isTerminalConfirmOrVerificationActive = deps.isTerminalConfirmOrVerificationActive;
      const buildAutoQueueDebugEntryStatusState = deps.buildAutoQueueDebugEntryStatusState;
      const getAutoQueueDisplayStateForPanel = deps.getAutoQueueDisplayStateForPanel;
      const getModeDisplayText = deps.getModeDisplayText;
      const buildAutoQueueUserStatusSummaryHtml = deps.buildAutoQueueUserStatusSummaryHtml;
      const formatQuotaDisplayText = deps.formatQuotaDisplayText;
      const resolveAutoqStatusValueTone = deps.resolveAutoqStatusValueTone;
      const renderAutoqStatusItems = deps.renderAutoqStatusItems;
      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_BATCH_STATUS_PANEL][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }
      function isTerminalConfirmOrVerificationActiveSafe() {
        return requireFn(
          'isTerminalConfirmOrVerificationActive',
          isTerminalConfirmOrVerificationActive,
        )();
      }
      function buildAutoQueueDebugEntryStatusStateSafe(input) {
        return requireFn(
          'buildAutoQueueDebugEntryStatusState',
          buildAutoQueueDebugEntryStatusState,
        )(input);
      }
      function getAutoQueueDisplayStateForPanelSafe(modeName = '-', runStateTextOverride = '') {
        return requireFn(
          'getAutoQueueDisplayStateForPanel',
          getAutoQueueDisplayStateForPanel,
        )(modeName, runStateTextOverride);
      }
      function getModeDisplayTextSafe(mode) {
        return requireFn('getModeDisplayText', getModeDisplayText)(mode);
      }
      function buildAutoQueueUserStatusSummaryHtmlSafe(input) {
        return requireFn(
          'buildAutoQueueUserStatusSummaryHtml',
          buildAutoQueueUserStatusSummaryHtml,
        )(input);
      }
      function formatQuotaDisplayTextSafe(value) {
        return requireFn('formatQuotaDisplayText', formatQuotaDisplayText)(value);
      }
      function resolveAutoqStatusValueToneSafe(value, options = {}) {
        return requireFn(
          'resolveAutoqStatusValueTone',
          resolveAutoqStatusValueTone,
        )(value, options);
      }
      function renderAutoqStatusItemsSafe(items) {
        return requireFn('renderAutoqStatusItems', renderAutoqStatusItems)(items);
      }
      const RuntimeStatsModuleRef = typeof RuntimeStatsModule !== 'undefined'
        ? RuntimeStatsModule
        : null;
${extractedBlock
  .replaceAll('RuntimeStatsModule', 'RuntimeStatsModuleRef')
  .replaceAll('isTerminalConfirmOrVerificationActive()', 'isTerminalConfirmOrVerificationActiveSafe()')
  .replaceAll('buildAutoQueueDebugEntryStatusState(', 'buildAutoQueueDebugEntryStatusStateSafe(')
  .replaceAll('getAutoQueueDisplayStateForPanel(', 'getAutoQueueDisplayStateForPanelSafe(')
  .replaceAll('getModeDisplayText(', 'getModeDisplayTextSafe(')
  .replaceAll('buildAutoQueueUserStatusSummaryHtml(', 'buildAutoQueueUserStatusSummaryHtmlSafe(')
  .replaceAll('formatQuotaDisplayText(', 'formatQuotaDisplayTextSafe(')
  .replaceAll('resolveAutoqStatusValueTone(', 'resolveAutoqStatusValueToneSafe(')
  .replaceAll('renderAutoqStatusItems(', 'renderAutoqStatusItemsSafe(')
}
      return Object.freeze({
        buildTaskPageRotateProgressText,
        resolveBatchStopDisplayMeta,
        normalizeBatchStopReasonForDisplay,
        buildBatchTaskStatusPanelHtml,
        buildLiteStatusPanelHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueBatchStatusPanel = AutoQueueBatchStatusPanel;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueBatchStatusPanelApi = null;
    function ensureAutoQueueBatchStatusPanelApi() {
      if (autoQueueBatchStatusPanelApi) {
        return autoQueueBatchStatusPanelApi;
      }
      if (
        typeof AutoQueueBatchStatusPanel === 'undefined'
        || !AutoQueueBatchStatusPanel
        || typeof AutoQueueBatchStatusPanel.create !== 'function'
      ) {
        console.error('[AUTOQ_BATCH_STATUS_PANEL][MISSING] AutoQueueBatchStatusPanel.create is not available');
        return null;
      }
      autoQueueBatchStatusPanelApi = AutoQueueBatchStatusPanel.create({
        state,
        config,
        AUTO_QUEUE_PHASES,
        TASK_TERMINAL_KIND,
        isTerminalConfirmOrVerificationActive,
        buildAutoQueueDebugEntryStatusState,
        getAutoQueueDisplayStateForPanel,
        getModeDisplayText,
        buildAutoQueueUserStatusSummaryHtml,
        formatQuotaDisplayText,
        resolveAutoqStatusValueTone,
        renderAutoqStatusItems,
      });
      return autoQueueBatchStatusPanelApi;
    }
    function requireAutoQueueBatchStatusPanelApi(methodName) {
      const api = ensureAutoQueueBatchStatusPanelApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_BATCH_STATUS_PANEL][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function buildTaskPageRotateProgressText(progressSnapshot) {
      return requireAutoQueueBatchStatusPanelApi('buildTaskPageRotateProgressText')(
        progressSnapshot,
      );
    }
    function resolveBatchStopDisplayMeta(stopReason) {
      return requireAutoQueueBatchStatusPanelApi('resolveBatchStopDisplayMeta')(
        stopReason,
      );
    }
    function normalizeBatchStopReasonForDisplay(status) {
      return requireAutoQueueBatchStatusPanelApi('normalizeBatchStopReasonForDisplay')(
        status,
      );
    }
    function buildBatchTaskStatusPanelHtml(options) {
      return requireAutoQueueBatchStatusPanelApi('buildBatchTaskStatusPanelHtml')(
        options,
      );
    }
    function buildLiteStatusPanelHtml(options) {
      return requireAutoQueueBatchStatusPanelApi('buildLiteStatusPanelHtml')(
        options,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function buildTaskPageRotateProgressText(progressSnapshot) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function createTaskId() {', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueBatchStatusPanelApi = null;')) {
    throw new Error('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][ALREADY_PATCHED] autoQueueBatchStatusPanelApi already exists');
  }
  const startMarker = '    function buildTaskPageRotateProgressText(progressSnapshot) {';
  const endMarker = '    function createTaskId() {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function buildTaskPageRotateProgressText',
    'function resolveBatchStopDisplayMeta',
    'function normalizeBatchStopReasonForDisplay',
    'function buildBatchTaskStatusPanelHtml',
    'function buildLiteStatusPanelHtml',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(BATCH_STATUS_PANEL_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-batch-status-panel.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const statusRendererIndex = parts.indexOf('autoqueue/auto-queue-status-renderer.js');
  const displayStateIndex = parts.indexOf('autoqueue/auto-queue-display-state.js');
  if (statusRendererIndex >= 0) {
    insertIndex = statusRendererIndex + 1;
  } else if (displayStateIndex >= 0) {
    insertIndex = displayStateIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-batch-status-panel.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][BUILD_ORDER_OK]', {
    batchStatusPanelIndex: parts.indexOf('autoqueue/auto-queue-batch-status-panel.js'),
    statusRendererIndex: parts.indexOf('autoqueue/auto-queue-status-renderer.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(BATCH_STATUS_PANEL_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueBatchStatusPanelApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueBatchStatusPanelApi facade');
  }
  if (!core.includes("requireAutoQueueBatchStatusPanelApi('buildBatchTaskStatusPanelHtml')")) {
    failures.push('auto-queue-core.js buildBatchTaskStatusPanelHtml is not delegated');
  }
  if (
    core.includes('function buildTaskPageRotateProgressText(progressSnapshot)')
    && core.includes('当前 ${displayCurrent}/${threshold}')
  ) {
    failures.push('auto-queue-core.js still contains full buildTaskPageRotateProgressText implementation');
  }
  if (!core.includes('function createTaskId()')) {
    failures.push('auto-queue-core.js lost createTaskId');
  }
  if (!moduleText.includes('const AutoQueueBatchStatusPanel = (() => {')) {
    failures.push('auto-queue-batch-status-panel.js missing AutoQueueBatchStatusPanel module');
  }
  [
    'function buildTaskPageRotateProgressText',
    'function resolveBatchStopDisplayMeta',
    'function normalizeBatchStopReasonForDisplay',
    'function buildBatchTaskStatusPanelHtml',
    'function buildLiteStatusPanelHtml',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-batch-status-panel.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const panelIndex = order.parts.indexOf('autoqueue/auto-queue-batch-status-panel.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (panelIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-batch-status-panel.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(panelIndex >= 0 && coreIndex >= 0 && panelIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-batch-status-panel.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_BATCH_STATUS_PANEL_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_BATCH_STATUS_PANEL_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
