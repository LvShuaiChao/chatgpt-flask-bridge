import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const REPLY_STATE_SETTLER_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-reply-state-settler.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueReplyStateSettler：回复状态评估与等待回复收口
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 replyState -> nextAction 评估，以及 waitingReply 的稳定收口。
   * 3. 不负责发送、不负责上传、不负责按钮渲染、不负责闭环等待倒计时。
   ********************************************************************/
  const AutoQueueReplyStateSettler = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const isAutoQueueWaitingReply = deps.isAutoQueueWaitingReply;
      const isChatGptHomePageNow = deps.isChatGptHomePageNow;
      const getCurrentConversationIdSafe = deps.getCurrentConversationIdSafe;
      const recordReplyClassifyDecision = deps.recordReplyClassifyDecision;
      const readPageTurnCount = deps.readPageTurnCount;
      const appendLog = deps.appendLog;
      const getLatestAssistantReplyTextForBatchSafe = deps.getLatestAssistantReplyTextForBatchSafe;
      const isRawAssistantGeneratingSignals = deps.isRawAssistantGeneratingSignals;
      const classifyReplyState = deps.classifyReplyState;
      const shouldPauseWaitingReplyForInvalidPageContext = deps.shouldPauseWaitingReplyForInvalidPageContext;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const validateAssistantReplyForRun = deps.validateAssistantReplyForRun;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
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
      function isAutoQueueWaitingReplySafe() {
        if (typeof isAutoQueueWaitingReply === 'function') {
          return isAutoQueueWaitingReply();
        }
        return !!(state && state.waitingReply);
      }
      function isChatGptHomePageNowSafe() {
        if (typeof isChatGptHomePageNow === 'function') {
          return isChatGptHomePageNow();
        }
        return false;
      }
      function getCurrentConversationIdSafeSafe() {
        if (typeof getCurrentConversationIdSafe === 'function') {
          return getCurrentConversationIdSafe();
        }
        return '';
      }
      function recordReplyClassifyDecisionSafe(payload) {
        if (typeof recordReplyClassifyDecision === 'function') {
          recordReplyClassifyDecision(payload);
          return;
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'recordReplyClassifyDecision',
          payload,
        });
      }
      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount === 'function') {
          return readPageTurnCount();
        }
        return null;
      }
      function getLatestAssistantReplyTextForBatchSafeSafe(source) {
        if (typeof getLatestAssistantReplyTextForBatchSafe === 'function') {
          return getLatestAssistantReplyTextForBatchSafe(source);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'getLatestAssistantReplyTextForBatchSafe',
          source,
        });
        return '';
      }
      function isRawAssistantGeneratingSignalsSafe() {
        if (typeof isRawAssistantGeneratingSignals === 'function') {
          return isRawAssistantGeneratingSignals();
        }
        return false;
      }
      function classifyReplyStateSafe(replyText, isGenerating) {
        if (typeof classifyReplyState === 'function') {
          return classifyReplyState(replyText, isGenerating);
        }
        return null;
      }
      function shouldPauseWaitingReplyForInvalidPageContextSafe(reason) {
        if (typeof shouldPauseWaitingReplyForInvalidPageContext === 'function') {
          return shouldPauseWaitingReplyForInvalidPageContext(reason);
        }
        appendLogSafe(
          '[AUTOQ_REPLY_STATE_SETTLER][PAUSE_CONTEXT_FALLBACK] reason=' + String(reason || '-'),
        );
        return false;
      }
      function getBatchReplyStableSnapshotSafe(source) {
        if (typeof getBatchReplyStableSnapshot === 'function') {
          return getBatchReplyStableSnapshot(source);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'getBatchReplyStableSnapshot',
          source,
        });
        return {
          text: '',
          stableMs: 0,
          count: 0,
        };
      }
      function validateAssistantReplyForRunSafe(runMeta, replyMeta) {
        if (typeof validateAssistantReplyForRun === 'function') {
          return validateAssistantReplyForRun(runMeta, replyMeta);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'validateAssistantReplyForRun',
        });
        return {
          ok: true,
          reason: 'validation-missing-fallback-ok',
        };
      }
      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'onAssistantReplySettled',
          textLength: String(text || '').length,
          reason: options && options.reason ? options.reason : '-',
        });
        return null;
      }
      function updateStatusSafe(reason) {
        if (typeof updateStatus === 'function') {
          updateStatus(reason);
          return;
        }
        console.error('[AUTOQ_REPLY_STATE_SETTLER][DEPENDENCY_MISSING]', {
          name: 'updateStatus',
          reason,
        });
      }
      function updateChatInputStateBadgeSafe() {
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
      }
${extractedBlock
  .replaceAll('isAutoQueueWaitingReply()', 'isAutoQueueWaitingReplySafe()')
  .replaceAll('isChatGptHomePageNow()', 'isChatGptHomePageNowSafe()')
  .replaceAll('getCurrentConversationIdSafe()', 'getCurrentConversationIdSafeSafe()')
  .replaceAll('recordReplyClassifyDecision(', 'recordReplyClassifyDecisionSafe(')
  .replaceAll('readPageTurnCount()', 'readPageTurnCountSafe()')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
  .replaceAll('getLatestAssistantReplyTextForBatchSafe(', 'getLatestAssistantReplyTextForBatchSafeSafe(')
  .replaceAll('isRawAssistantGeneratingSignals()', 'isRawAssistantGeneratingSignalsSafe()')
  .replaceAll('classifyReplyState(', 'classifyReplyStateSafe(')
  .replaceAll("typeof classifyReplyState !== 'function'", "typeof classifyReplyState !== 'function'")
  .replaceAll('shouldPauseWaitingReplyForInvalidPageContext(', 'shouldPauseWaitingReplyForInvalidPageContextSafe(')
  .replaceAll('getBatchReplyStableSnapshot(', 'getBatchReplyStableSnapshotSafe(')
  .replaceAll('validateAssistantReplyForRun(', 'validateAssistantReplyForRunSafe(')
  .replaceAll('onAssistantReplySettled(', 'onAssistantReplySettledSafe(')
  .replaceAll('updateStatus(', 'updateStatusSafe(')
  .replaceAll('updateChatInputStateBadge()', 'updateChatInputStateBadgeSafe()')
}
      return Object.freeze({
        getReplyStateNextAction,
        recordReplyClassifyFromReplyState,
        logReplyStateDecision,
        evaluateWaitingReplyState,
        trySettleWaitingReplyByReplyState,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueReplyStateSettler = AutoQueueReplyStateSettler;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueReplyStateSettlerApi = null;
    function ensureAutoQueueReplyStateSettlerApi() {
      if (autoQueueReplyStateSettlerApi) {
        return autoQueueReplyStateSettlerApi;
      }
      if (
        typeof AutoQueueReplyStateSettler === 'undefined'
        || !AutoQueueReplyStateSettler
        || typeof AutoQueueReplyStateSettler.create !== 'function'
      ) {
        console.error('[AUTOQ_REPLY_STATE_SETTLER][MISSING] AutoQueueReplyStateSettler.create is not available');
        return null;
      }
      autoQueueReplyStateSettlerApi = AutoQueueReplyStateSettler.create({
        state,
        config,
        isAutoQueueWaitingReply,
        isChatGptHomePageNow,
        getCurrentConversationIdSafe,
        recordReplyClassifyDecision,
        readPageTurnCount: typeof readPageTurnCount === 'function' ? readPageTurnCount : null,
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
        getLatestAssistantReplyTextForBatchSafe,
        isRawAssistantGeneratingSignals,
        classifyReplyState: typeof classifyReplyState === 'function' ? classifyReplyState : null,
        shouldPauseWaitingReplyForInvalidPageContext,
        getBatchReplyStableSnapshot,
        validateAssistantReplyForRun,
        onAssistantReplySettled,
        updateStatus,
        updateChatInputStateBadge,
      });
      return autoQueueReplyStateSettlerApi;
    }
    function requireAutoQueueReplyStateSettlerApi(methodName) {
      const api = ensureAutoQueueReplyStateSettlerApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_REPLY_STATE_SETTLER][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function getReplyStateNextAction(replyState, options = {}) {
      return requireAutoQueueReplyStateSettlerApi('getReplyStateNextAction')(
        replyState,
        options,
      );
    }
    function recordReplyClassifyFromReplyState(replyState) {
      return requireAutoQueueReplyStateSettlerApi('recordReplyClassifyFromReplyState')(
        replyState,
      );
    }
    function logReplyStateDecision(source, payload = {}) {
      return requireAutoQueueReplyStateSettlerApi('logReplyStateDecision')(
        source,
        payload,
      );
    }
    function evaluateWaitingReplyState(source) {
      return requireAutoQueueReplyStateSettlerApi('evaluateWaitingReplyState')(
        source,
      );
    }
    function trySettleWaitingReplyByReplyState(source) {
      return requireAutoQueueReplyStateSettlerApi('trySettleWaitingReplyByReplyState')(
        source,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    const NORMAL_REPLY_SETTLE_STABLE_MS = 800;', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    let autoQueueDebugSnapshotSectionsApi = null;', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueReplyStateSettlerApi = null;')) {
    throw new Error('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][ALREADY_PATCHED] autoQueueReplyStateSettlerApi already exists');
  }
  const startMarker = '    const NORMAL_REPLY_SETTLE_STABLE_MS = 800;';
  const endMarker = '    let autoQueueDebugSnapshotSectionsApi = null;';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'const NORMAL_REPLY_SETTLE_STABLE_MS',
    'const NORMAL_REPLY_SETTLE_MIN_COUNT',
    'function getReplyStateNextAction',
    'function recordReplyClassifyFromReplyState',
    'function logReplyStateDecision',
    'function evaluateWaitingReplyState',
    'function trySettleWaitingReplyByReplyState',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(REPLY_STATE_SETTLER_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-reply-state-settler.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const debugSectionsIndex = parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js');
  const debugCollectorIndex = parts.indexOf('autoqueue/auto-queue-debug-collector.js');
  if (debugSectionsIndex >= 0) {
    insertIndex = debugSectionsIndex;
  } else if (debugCollectorIndex >= 0) {
    insertIndex = debugCollectorIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-reply-state-settler.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][BUILD_ORDER_OK]', {
    replyStateSettlerIndex: parts.indexOf('autoqueue/auto-queue-reply-state-settler.js'),
    debugSectionsIndex: parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(REPLY_STATE_SETTLER_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueReplyStateSettlerApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueReplyStateSettlerApi facade');
  }
  if (!core.includes("requireAutoQueueReplyStateSettlerApi('trySettleWaitingReplyByReplyState')")) {
    failures.push('auto-queue-core.js trySettleWaitingReplyByReplyState is not delegated');
  }
  if (core.includes('const NORMAL_REPLY_SETTLE_STABLE_MS = 800;')) {
    failures.push('auto-queue-core.js still contains full reply state settler implementation');
  }
  if (!core.includes('let autoQueueDebugSnapshotSectionsApi = null;')) {
    failures.push('auto-queue-core.js lost autoQueueDebugSnapshotSectionsApi');
  }
  if (!moduleText.includes('const AutoQueueReplyStateSettler = (() => {')) {
    failures.push('auto-queue-reply-state-settler.js missing module');
  }
  [
    'const NORMAL_REPLY_SETTLE_STABLE_MS = 800',
    'const NORMAL_REPLY_SETTLE_MIN_COUNT = 2',
    'function getReplyStateNextAction',
    'function recordReplyClassifyFromReplyState',
    'function logReplyStateDecision',
    'function evaluateWaitingReplyState',
    'function trySettleWaitingReplyByReplyState',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-reply-state-settler.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const settlerIndex = order.parts.indexOf('autoqueue/auto-queue-reply-state-settler.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (settlerIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-reply-state-settler.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(settlerIndex >= 0 && coreIndex >= 0 && settlerIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-reply-state-settler.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_REPLY_STATE_SETTLER_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_REPLY_STATE_SETTLER_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
