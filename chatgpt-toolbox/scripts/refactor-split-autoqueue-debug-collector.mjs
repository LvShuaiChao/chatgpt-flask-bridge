import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const DEBUG_COLLECTOR_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-debug-collector.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueDebugCollector：自动队列高级调试基础状态采集
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责页面/输入区/按钮/任务/上传基础调试快照采集。
   * 3. 不负责回复等待判定、不负责发送、不负责上传执行、不负责闭环、不负责按钮绑定。
   ********************************************************************/
  const AutoQueueDebugCollector = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const appendLog = deps.appendLog;
      const resolveAutoQueueAttachmentSnapshot = deps.resolveAutoQueueAttachmentSnapshot;
      const getPanelMessageQuotaState = deps.getPanelMessageQuotaState;
      const getPanelUploadQuotaState = deps.getPanelUploadQuotaState;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const getEnabledTasksFromProfile = deps.getEnabledTasksFromProfile;
      const getTaskBatchFailureDisplayText = deps.getTaskBatchFailureDisplayText;
      const getBridgePageDisplayIdText = deps.getBridgePageDisplayIdText;

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

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DEBUG_COLLECTOR][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function resolveAutoQueueAttachmentSnapshotSafe(options) {
        return requireFn(
          'resolveAutoQueueAttachmentSnapshot',
          resolveAutoQueueAttachmentSnapshot,
        )(options);
      }

      function getPanelMessageQuotaStateSafe(options) {
        return requireFn('getPanelMessageQuotaState', getPanelMessageQuotaState)(options);
      }

      function getPanelUploadQuotaStateSafe(options) {
        return requireFn('getPanelUploadQuotaState', getPanelUploadQuotaState)(options);
      }

      function getActiveTaskProfileSafe() {
        return requireFn('getActiveTaskProfile', getActiveTaskProfile)();
      }

      function getEnabledTasksFromProfileSafe(profile) {
        return requireFn('getEnabledTasksFromProfile', getEnabledTasksFromProfile)(profile);
      }

      function getTaskBatchFailureDisplayTextSafe() {
        return requireFn(
          'getTaskBatchFailureDisplayText',
          getTaskBatchFailureDisplayText,
        )();
      }

      function getBridgePageDisplayIdTextSafe() {
        if (typeof getBridgePageDisplayIdText === 'function') {
          return getBridgePageDisplayIdText();
        }
        if (typeof globalThis !== 'undefined' && typeof globalThis.getBridgePageDisplayIdText === 'function') {
          return globalThis.getBridgePageDisplayIdText();
        }
        return '';
      }

${extractedBlock
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
  .replaceAll('resolveAutoQueueAttachmentSnapshot(', 'resolveAutoQueueAttachmentSnapshotSafe(')
  .replaceAll('getPanelMessageQuotaState(', 'getPanelMessageQuotaStateSafe(')
  .replaceAll('getPanelUploadQuotaState(', 'getPanelUploadQuotaStateSafe(')
  .replaceAll('getActiveTaskProfile()', 'getActiveTaskProfileSafe()')
  .replaceAll('getEnabledTasksFromProfile(', 'getEnabledTasksFromProfileSafe(')
  .replaceAll('getTaskBatchFailureDisplayText()', 'getTaskBatchFailureDisplayTextSafe()')
  .replaceAll('getBridgePageDisplayIdText()', 'getBridgePageDisplayIdTextSafe()')
}

      return Object.freeze({
        collectSectionSafe,
        extractConversationIdFromUrl,
        describeElementSafe,
        findComposerElementSafe,
        getComposerTextSafe,
        getComposerAttachmentSnapshotSafe,
        isComposerDisabledSafe,
        detectCanSendSafe,
        detectIsGeneratingSafe,
        findSendButtonSafe,
        findStopButtonSafe,
        findContinueButtonSafe,
        findAttachButtonSafe,
        findFileInputSafe,
        findRegenerateButtonSafe,
        findVoiceButtonSafe,
        getLastAssistantReplyTextSafe,
        collectPageDebugState,
        collectComposerDebugState,
        collectButtonDebugState,
        collectAutoQueueDebugState,
        collectUploadDebugState,
        runPendingUploadCountSafe,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDebugCollector = AutoQueueDebugCollector;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueDebugCollectorApi = null;

    function ensureAutoQueueDebugCollectorApi() {
      if (autoQueueDebugCollectorApi) {
        return autoQueueDebugCollectorApi;
      }
      if (
        typeof AutoQueueDebugCollector === 'undefined'
        || !AutoQueueDebugCollector
        || typeof AutoQueueDebugCollector.create !== 'function'
      ) {
        console.error('[AUTOQ_DEBUG_COLLECTOR][MISSING] AutoQueueDebugCollector.create is not available');
        return null;
      }
      autoQueueDebugCollectorApi = AutoQueueDebugCollector.create({
        state,
        config,
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
        resolveAutoQueueAttachmentSnapshot,
        getPanelMessageQuotaState,
        getPanelUploadQuotaState,
        getActiveTaskProfile,
        getEnabledTasksFromProfile,
        getTaskBatchFailureDisplayText,
        getBridgePageDisplayIdText: typeof getBridgePageDisplayIdText === 'function'
          ? getBridgePageDisplayIdText
          : null,
      });
      return autoQueueDebugCollectorApi;
    }

    function requireAutoQueueDebugCollectorApi(methodName) {
      const api = ensureAutoQueueDebugCollectorApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_DEBUG_COLLECTOR][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function collectSectionSafe(sectionName, collector) {
      return requireAutoQueueDebugCollectorApi('collectSectionSafe')(
        sectionName,
        collector,
      );
    }

    function extractConversationIdFromUrl() {
      return requireAutoQueueDebugCollectorApi('extractConversationIdFromUrl')();
    }

    function describeElementSafe(el) {
      return requireAutoQueueDebugCollectorApi('describeElementSafe')(el);
    }

    function findComposerElementSafe() {
      return requireAutoQueueDebugCollectorApi('findComposerElementSafe')();
    }

    function getComposerTextSafe(composer) {
      return requireAutoQueueDebugCollectorApi('getComposerTextSafe')(composer);
    }

    function getComposerAttachmentSnapshotSafe() {
      return requireAutoQueueDebugCollectorApi('getComposerAttachmentSnapshotSafe')();
    }

    function isComposerDisabledSafe(composer) {
      return requireAutoQueueDebugCollectorApi('isComposerDisabledSafe')(composer);
    }

    function detectCanSendSafe() {
      return requireAutoQueueDebugCollectorApi('detectCanSendSafe')();
    }

    function detectIsGeneratingSafe() {
      return requireAutoQueueDebugCollectorApi('detectIsGeneratingSafe')();
    }

    function findSendButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findSendButtonSafe')();
    }

    function findStopButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findStopButtonSafe')();
    }

    function findContinueButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findContinueButtonSafe')();
    }

    function findAttachButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findAttachButtonSafe')();
    }

    function findFileInputSafe() {
      return requireAutoQueueDebugCollectorApi('findFileInputSafe')();
    }

    function findRegenerateButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findRegenerateButtonSafe')();
    }

    function findVoiceButtonSafe() {
      return requireAutoQueueDebugCollectorApi('findVoiceButtonSafe')();
    }

    function getLastAssistantReplyTextSafe() {
      return requireAutoQueueDebugCollectorApi('getLastAssistantReplyTextSafe')();
    }

    function collectPageDebugState() {
      return requireAutoQueueDebugCollectorApi('collectPageDebugState')();
    }

    function collectComposerDebugState() {
      return requireAutoQueueDebugCollectorApi('collectComposerDebugState')();
    }

    function collectButtonDebugState() {
      return requireAutoQueueDebugCollectorApi('collectButtonDebugState')();
    }

    function collectAutoQueueDebugState() {
      return requireAutoQueueDebugCollectorApi('collectAutoQueueDebugState')();
    }

    function collectUploadDebugState() {
      return requireAutoQueueDebugCollectorApi('collectUploadDebugState')();
    }

    function runPendingUploadCountSafe() {
      return requireAutoQueueDebugCollectorApi('runPendingUploadCountSafe')();
    }

`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function collectSectionSafe(sectionName, collector) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    const NORMAL_REPLY_SETTLE_STABLE_MS = 800;', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueDebugCollectorApi = null;')) {
    throw new Error('[AUTOQ_DEBUG_COLLECTOR_SPLIT][ALREADY_PATCHED] autoQueueDebugCollectorApi already exists');
  }

  const startMarker = '    function collectSectionSafe(sectionName, collector) {';
  const endMarker = '    const NORMAL_REPLY_SETTLE_STABLE_MS = 800;';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_DEBUG_COLLECTOR_SPLIT][RANGE_INVALID]');
  }

  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function collectSectionSafe',
    'function extractConversationIdFromUrl',
    'function describeElementSafe',
    'function findComposerElementSafe',
    'function collectPageDebugState',
    'function collectComposerDebugState',
    'function collectButtonDebugState',
    'function collectAutoQueueDebugState',
    'function collectUploadDebugState',
    'function runPendingUploadCountSafe',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(DEBUG_COLLECTOR_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_DEBUG_COLLECTOR_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_DEBUG_COLLECTOR_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-debug-collector.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_DEBUG_COLLECTOR_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const advancedDebugPanelIndex = parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js');
  const batchStatusPanelIndex = parts.indexOf('autoqueue/auto-queue-batch-status-panel.js');
  if (advancedDebugPanelIndex >= 0) {
    insertIndex = advancedDebugPanelIndex + 1;
  } else if (batchStatusPanelIndex >= 0) {
    insertIndex = batchStatusPanelIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-debug-collector.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_DEBUG_COLLECTOR_SPLIT][BUILD_ORDER_OK]', {
    debugCollectorIndex: parts.indexOf('autoqueue/auto-queue-debug-collector.js'),
    advancedDebugPanelIndex: parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(DEBUG_COLLECTOR_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueDebugCollectorApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueDebugCollectorApi facade');
  }
  if (!core.includes("requireAutoQueueDebugCollectorApi('collectAutoQueueDebugState')")) {
    failures.push('auto-queue-core.js collectAutoQueueDebugState is not delegated');
  }
  if (
    core.includes('function collectUploadDebugState()')
    && core.includes('queueTotal:')
  ) {
    failures.push('auto-queue-core.js still contains full collectUploadDebugState implementation');
  }
  if (!core.includes('const NORMAL_REPLY_SETTLE_STABLE_MS = 800;')) {
    failures.push('auto-queue-core.js lost NORMAL_REPLY_SETTLE_STABLE_MS');
  }
  if (!moduleText.includes('const AutoQueueDebugCollector = (() => {')) {
    failures.push('auto-queue-debug-collector.js missing AutoQueueDebugCollector module');
  }
  [
    'function collectSectionSafe',
    'function extractConversationIdFromUrl',
    'function describeElementSafe',
    'function findComposerElementSafe',
    'function collectPageDebugState',
    'function collectComposerDebugState',
    'function collectButtonDebugState',
    'function collectAutoQueueDebugState',
    'function collectUploadDebugState',
    'function runPendingUploadCountSafe',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-debug-collector.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const collectorIndex = order.parts.indexOf('autoqueue/auto-queue-debug-collector.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (collectorIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-debug-collector.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(collectorIndex >= 0 && coreIndex >= 0 && collectorIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-debug-collector.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_DEBUG_COLLECTOR_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_DEBUG_COLLECTOR_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_DEBUG_COLLECTOR_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_DEBUG_COLLECTOR_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
