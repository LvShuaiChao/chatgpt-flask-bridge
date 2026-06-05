import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const SNAPSHOT_SECTIONS_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-debug-snapshot-sections.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_DEBUG_SECTIONS_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_DEBUG_SECTIONS_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_DEBUG_SECTIONS_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueDebugSnapshotSections：高级调试快照辅助分区采集
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 reply / terminal / quota / timer 调试分区。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责完整快照组装。
   ********************************************************************/
  const AutoQueueDebugSnapshotSections = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const DEFAULT_BATCH_DONE_SIGNAL = deps.DEFAULT_BATCH_DONE_SIGNAL;
      const DEFAULT_BATCH_BLOCKED_SIGNAL = deps.DEFAULT_BATCH_BLOCKED_SIGNAL;
      const DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL = deps.DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const getLastAssistantReplyTextSafe = deps.getLastAssistantReplyTextSafe;
      const isRawAssistantGeneratingSignals = deps.isRawAssistantGeneratingSignals;
      const classifyReplyState = deps.classifyReplyState;
      const classifyBatchReply = deps.classifyBatchReply;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const getReplyStateNextAction = deps.getReplyStateNextAction;
      const isExactSingleLineBatchSignalText = deps.isExactSingleLineBatchSignalText;
      const getPanelMessageQuotaState = deps.getPanelMessageQuotaState;
      const getPanelUploadQuotaState = deps.getPanelUploadQuotaState;
      const readPageTurnCount = deps.readPageTurnCount;
      const getBridgePageDisplayIdText = deps.getBridgePageDisplayIdText;
      const RuntimeStatsModuleRef = deps.RuntimeStatsModuleRef;

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DEBUG_SECTIONS][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        return requireFn(
          'ensureTaskRunVerificationFields',
          ensureTaskRunVerificationFields,
        )(run);
      }

      function getLastAssistantReplyTextSafeSafe() {
        return requireFn('getLastAssistantReplyTextSafe', getLastAssistantReplyTextSafe)();
      }

      function isRawAssistantGeneratingSignalsSafe() {
        return requireFn('isRawAssistantGeneratingSignals', isRawAssistantGeneratingSignals)();
      }

      function classifyReplyStateSafe(replyText, isGenerating) {
        if (typeof classifyReplyState !== 'function') {
          return null;
        }
        return classifyReplyState(replyText, isGenerating);
      }

      function classifyBatchReplySafe(replyText, options) {
        if (typeof classifyBatchReply !== 'function') {
          return null;
        }
        return classifyBatchReply(replyText, options);
      }

      function getBatchReplyStableSnapshotSafe(source) {
        return requireFn('getBatchReplyStableSnapshot', getBatchReplyStableSnapshot)(source);
      }

      function getReplyStateNextActionSafe(replyState, options) {
        return requireFn('getReplyStateNextAction', getReplyStateNextAction)(replyState, options);
      }

      function isExactSingleLineBatchSignalTextSafe(text, signal) {
        if (typeof isExactSingleLineBatchSignalText !== 'function') {
          return false;
        }
        return isExactSingleLineBatchSignalText(text, signal);
      }

      function getPanelMessageQuotaStateSafe(options) {
        return requireFn('getPanelMessageQuotaState', getPanelMessageQuotaState)(options);
      }

      function getPanelUploadQuotaStateSafe(options) {
        return requireFn('getPanelUploadQuotaState', getPanelUploadQuotaState)(options);
      }

      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount !== 'function') {
          return null;
        }
        return readPageTurnCount();
      }

      function getBridgePageDisplayIdTextSafe() {
        if (typeof getBridgePageDisplayIdText !== 'function') {
          return '';
        }
        return getBridgePageDisplayIdText();
      }

${extractedBlock
  .replaceAll('ensureTaskRunVerificationFields(', 'ensureTaskRunVerificationFieldsSafe(')
  .replaceAll('getLastAssistantReplyTextSafe()', 'getLastAssistantReplyTextSafeSafe()')
  .replaceAll('isRawAssistantGeneratingSignals()', 'isRawAssistantGeneratingSignalsSafe()')
  .replaceAll('classifyReplyState(', 'classifyReplyStateSafe(')
  .replaceAll('classifyBatchReply(', 'classifyBatchReplySafe(')
  .replaceAll('getBatchReplyStableSnapshot(', 'getBatchReplyStableSnapshotSafe(')
  .replaceAll('getReplyStateNextAction(', 'getReplyStateNextActionSafe(')
  .replaceAll('isExactSingleLineBatchSignalText(', 'isExactSingleLineBatchSignalTextSafe(')
  .replaceAll('getPanelMessageQuotaState(', 'getPanelMessageQuotaStateSafe(')
  .replaceAll('getPanelUploadQuotaState(', 'getPanelUploadQuotaStateSafe(')
  .replaceAll('readPageTurnCount()', 'readPageTurnCountSafe()')
  .replaceAll('getBridgePageDisplayIdText()', 'getBridgePageDisplayIdTextSafe()')
  .replaceAll('RuntimeStatsModule', 'RuntimeStatsModuleRef')
}

      return Object.freeze({
        collectReplyDebugState,
        collectTerminalDebugState,
        collectQuotaDebugState,
        collectTimerDebugState,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDebugSnapshotSections = AutoQueueDebugSnapshotSections;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueDebugSnapshotSectionsApi = null;

    function ensureAutoQueueDebugSnapshotSectionsApi() {
      if (autoQueueDebugSnapshotSectionsApi) {
        return autoQueueDebugSnapshotSectionsApi;
      }
      if (
        typeof AutoQueueDebugSnapshotSections === 'undefined'
        || !AutoQueueDebugSnapshotSections
        || typeof AutoQueueDebugSnapshotSections.create !== 'function'
      ) {
        console.error('[AUTOQ_DEBUG_SECTIONS][MISSING] AutoQueueDebugSnapshotSections.create is not available');
        return null;
      }
      autoQueueDebugSnapshotSectionsApi = AutoQueueDebugSnapshotSections.create({
        state,
        config,
        AUTO_QUEUE_PHASES,
        DEFAULT_BATCH_DONE_SIGNAL,
        DEFAULT_BATCH_BLOCKED_SIGNAL,
        DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL,
        ensureTaskRunVerificationFields,
        getLastAssistantReplyTextSafe,
        isRawAssistantGeneratingSignals,
        classifyReplyState: typeof classifyReplyState === 'function' ? classifyReplyState : null,
        classifyBatchReply: typeof classifyBatchReply === 'function' ? classifyBatchReply : null,
        getBatchReplyStableSnapshot,
        getReplyStateNextAction,
        isExactSingleLineBatchSignalText: typeof isExactSingleLineBatchSignalText === 'function'
          ? isExactSingleLineBatchSignalText
          : null,
        getPanelMessageQuotaState,
        getPanelUploadQuotaState,
        readPageTurnCount: typeof readPageTurnCount === 'function' ? readPageTurnCount : null,
        getBridgePageDisplayIdText: typeof getBridgePageDisplayIdText === 'function'
          ? getBridgePageDisplayIdText
          : null,
        RuntimeStatsModuleRef: typeof RuntimeStatsModule !== 'undefined'
          ? RuntimeStatsModule
          : null,
      });
      return autoQueueDebugSnapshotSectionsApi;
    }

    function requireAutoQueueDebugSnapshotSectionsApi(methodName) {
      const api = ensureAutoQueueDebugSnapshotSectionsApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_DEBUG_SECTIONS][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function collectReplyDebugState(options = {}) {
      return requireAutoQueueDebugSnapshotSectionsApi('collectReplyDebugState')(options);
    }

    function collectTerminalDebugState() {
      return requireAutoQueueDebugSnapshotSectionsApi('collectTerminalDebugState')();
    }

    function collectQuotaDebugState() {
      return requireAutoQueueDebugSnapshotSectionsApi('collectQuotaDebugState')();
    }

    function collectTimerDebugState() {
      return requireAutoQueueDebugSnapshotSectionsApi('collectTimerDebugState')();
    }

`;
}

function resolveAdvancedDebugSnapshotMarker(source) {
  const candidates = [
    '    function collectAdvancedDebugSnapshot(source = \'manual\', options = {}) {',
    '    function collectAdvancedDebugSnapshot(options = {}) {',
  ];
  for (const marker of candidates) {
    if (source.includes(marker)) {
      return marker;
    }
  }
  return null;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function collectReplyDebugState(options = {}) {', AUTOQUEUE_CORE_FILE);

  const endMarker = resolveAdvancedDebugSnapshotMarker(source);
  if (!endMarker) {
    throw new Error('[AUTOQ_DEBUG_SECTIONS_SPLIT][MARKER_NOT_FOUND] file=' + AUTOQUEUE_CORE_FILE + ' marker=collectAdvancedDebugSnapshot');
  }

  if (source.includes('let autoQueueDebugSnapshotSectionsApi = null;')) {
    throw new Error('[AUTOQ_DEBUG_SECTIONS_SPLIT][ALREADY_PATCHED] autoQueueDebugSnapshotSectionsApi already exists');
  }

  const startMarker = '    function collectReplyDebugState(options = {}) {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_DEBUG_SECTIONS_SPLIT][RANGE_INVALID]');
  }

  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function collectReplyDebugState',
    'function collectTerminalDebugState',
    'function collectQuotaDebugState',
    'function collectTimerDebugState',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_DEBUG_SECTIONS_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(SNAPSHOT_SECTIONS_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);

  console.log('[AUTOQ_DEBUG_SECTIONS_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_DEBUG_SECTIONS_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-debug-snapshot-sections.js');

  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_DEBUG_SECTIONS_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  let insertIndex = coreIndex;
  const debugCollectorIndex = parts.indexOf('autoqueue/auto-queue-debug-collector.js');
  const advancedDebugPanelIndex = parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js');
  if (debugCollectorIndex >= 0) {
    insertIndex = debugCollectorIndex + 1;
  } else if (advancedDebugPanelIndex >= 0) {
    insertIndex = advancedDebugPanelIndex + 1;
  }

  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-debug-snapshot-sections.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_DEBUG_SECTIONS_SPLIT][BUILD_ORDER_OK]', {
    debugSectionsIndex: parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js'),
    debugCollectorIndex: parts.indexOf('autoqueue/auto-queue-debug-collector.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(SNAPSHOT_SECTIONS_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueDebugSnapshotSectionsApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueDebugSnapshotSectionsApi facade');
  }
  if (!core.includes("requireAutoQueueDebugSnapshotSectionsApi('collectReplyDebugState')")) {
    failures.push('auto-queue-core.js collectReplyDebugState is not delegated');
  }
  if (
    core.includes('function collectTimerDebugState()')
    && core.includes('batchElapsedMs:')
  ) {
    failures.push('auto-queue-core.js still contains full collectTimerDebugState implementation');
  }
  if (!core.includes('function collectAdvancedDebugSnapshot(')) {
    failures.push('auto-queue-core.js lost collectAdvancedDebugSnapshot');
  }
  if (!moduleText.includes('const AutoQueueDebugSnapshotSections = (() => {')) {
    failures.push('auto-queue-debug-snapshot-sections.js missing module');
  }

  [
    'function collectReplyDebugState',
    'function collectTerminalDebugState',
    'function collectQuotaDebugState',
    'function collectTimerDebugState',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-debug-snapshot-sections.js missing ${marker}`);
    }
  });

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const sectionsIndex = order.parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (sectionsIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-debug-snapshot-sections.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(sectionsIndex >= 0 && coreIndex >= 0 && sectionsIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-debug-snapshot-sections.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_DEBUG_SECTIONS_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_DEBUG_SECTIONS_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_DEBUG_SECTIONS_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_DEBUG_SECTIONS_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_DEBUG_SECTIONS_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_DEBUG_SECTIONS_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
