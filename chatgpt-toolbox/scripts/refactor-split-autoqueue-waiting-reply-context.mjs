import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const WAITING_REPLY_CONTEXT_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-waiting-reply-context.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueWaitingReplyContext：等待回复上下文与进入等待确认
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 负责 waiting_reply 上下文、发送提交确认、回复稳定快照、等待状态展示。
   * 3. 不负责发送执行、不负责上传执行、不负责终止符验证、不负责 watchdog repair。
   ********************************************************************/
  const AutoQueueWaitingReplyContext = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const appendAutoQueueLog = deps.appendAutoQueueLog;
      const saveConfig = deps.saveConfig;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const getAutoQueueConversationIdSafe = deps.getAutoQueueConversationIdSafe;
      const isChatGptHomeOrNewChatPage = deps.isChatGptHomeOrNewChatPage;
      const restoreConversationById = deps.restoreConversationById;
      const getAutoQueueBridgeConversationSnapshot = deps.getAutoQueueBridgeConversationSnapshot;
      const readPageTurnCount = deps.readPageTurnCount;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isBatchWaitReplyPageStillAnswering = deps.isBatchWaitReplyPageStillAnswering;
      const logBatchWaitReplyContinueThrottled = deps.logBatchWaitReplyContinueThrottled;
      const isAssistantBusy = deps.isAssistantBusy;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const getAutoQueueComposerAttachmentEvidence = deps.getAutoQueueComposerAttachmentEvidence;
      const isUploadInProgressForAutoQueue = deps.isUploadInProgressForAutoQueue;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;
      const formatBatchTaskGroupSourceTag = deps.formatBatchTaskGroupSourceTag;
      const clearRelentlessSendRetryState = deps.clearRelentlessSendRetryState;
      function appendAutoQueueLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendAutoQueueLog === 'function') {
          appendAutoQueueLog(text);
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
      function saveConfigSafe() {
        if (typeof saveConfig === 'function') {
          saveConfig();
        }
      }
      function updateStatusSafe(reason) {
        if (typeof updateStatus === 'function') {
          updateStatus(reason);
          return;
        }
        appendAutoQueueLogSafe('[AUTOQ_WAITING_REPLY_CONTEXT][DEPENDENCY_MISSING] name=updateStatus reason=' + String(reason || '-'));
      }
      function updateChatInputStateBadgeSafe() {
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
      }
      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }
      function getAutoQueueConversationIdSafeSafe() {
        if (typeof getAutoQueueConversationIdSafe === 'function') {
          return getAutoQueueConversationIdSafe();
        }
        return '';
      }
      function isChatGptHomeOrNewChatPageSafe(url, conversationId) {
        if (typeof isChatGptHomeOrNewChatPage === 'function') {
          return isChatGptHomeOrNewChatPage(url, conversationId);
        }
        return false;
      }
      function restoreConversationByIdSafe(conversationId, reason) {
        if (typeof restoreConversationById === 'function') {
          return restoreConversationById(conversationId, reason);
        }
        return false;
      }
      function getAutoQueueBridgeConversationSnapshotSafe() {
        if (typeof getAutoQueueBridgeConversationSnapshot === 'function') {
          return getAutoQueueBridgeConversationSnapshot();
        }
        return {
          conversationId: '',
          turnCount: 0,
          messageRecordCount: 0,
        };
      }
      function readPageTurnCountSafe() {
        if (typeof readPageTurnCount === 'function') {
          return readPageTurnCount();
        }
        return null;
      }
      function getLatestAssistantSnapshotForAutoQueueBoundarySafe(source) {
        if (typeof getLatestAssistantSnapshotForAutoQueueBoundary === 'function') {
          return getLatestAssistantSnapshotForAutoQueueBoundary(source);
        }
        appendAutoQueueLogSafe(
          '[AUTOQ_WAITING_REPLY_CONTEXT][DEPENDENCY_MISSING] name=getLatestAssistantSnapshotForAutoQueueBoundary source='
          + String(source || '-'),
        );
        return {
          text: '',
          source: 'missing-dependency',
          messageId: '',
          conversationId: '',
        };
      }
      function isBatchWaitReplyPageStillAnsweringSafe(source) {
        if (typeof isBatchWaitReplyPageStillAnswering === 'function') {
          return isBatchWaitReplyPageStillAnswering(source);
        }
        return false;
      }
      function logBatchWaitReplyContinueThrottledSafe(source) {
        if (typeof logBatchWaitReplyContinueThrottled === 'function') {
          logBatchWaitReplyContinueThrottled(source);
        }
      }
      function isAssistantBusySafe() {
        if (typeof isAssistantBusy === 'function') {
          return !!isAssistantBusy();
        }
        if (typeof isChatGPTActuallyBusyForTaskQueue === 'function') {
          return !!isChatGPTActuallyBusyForTaskQueue();
        }
        return false;
      }
      function getAutoQueueComposerAttachmentEvidenceSafe(source) {
        if (typeof getAutoQueueComposerAttachmentEvidence === 'function') {
          return getAutoQueueComposerAttachmentEvidence(source);
        }
        return null;
      }
      function isUploadInProgressForAutoQueueSafe() {
        if (typeof isUploadInProgressForAutoQueue === 'function') {
          return !!isUploadInProgressForAutoQueue();
        }
        return false;
      }
      function getAutoQueueComposerPayloadStateSafe(source) {
        if (typeof getAutoQueueComposerPayloadState === 'function') {
          return getAutoQueueComposerPayloadState(source);
        }
        return null;
      }
      function formatBatchTaskGroupSourceTagSafe(source) {
        if (typeof formatBatchTaskGroupSourceTag === 'function') {
          return formatBatchTaskGroupSourceTag(source);
        }
        return String(source || '-');
      }
      function clearRelentlessSendRetryStateSafe(reason) {
        if (typeof clearRelentlessSendRetryState === 'function') {
          clearRelentlessSendRetryState(reason);
        }
      }
${extractedBlock
  .replaceAll('appendAutoQueueLog(', 'appendAutoQueueLogSafe(')
  .replaceAll('saveConfig()', 'saveConfigSafe()')
  .replaceAll('updateStatus(', 'updateStatusSafe(')
  .replaceAll('updateChatInputStateBadge()', 'updateChatInputStateBadgeSafe()')
  .replaceAll('getCurrentRunningTask()', 'getCurrentRunningTaskSafe()')
  .replaceAll('getAutoQueueConversationIdSafe()', 'getAutoQueueConversationIdSafeSafe()')
  .replaceAll('isChatGptHomeOrNewChatPage(', 'isChatGptHomeOrNewChatPageSafe(')
  .replaceAll('restoreConversationById(', 'restoreConversationByIdSafe(')
  .replaceAll('getAutoQueueBridgeConversationSnapshot()', 'getAutoQueueBridgeConversationSnapshotSafe()')
  .replaceAll('readPageTurnCount()', 'readPageTurnCountSafe()')
  .replaceAll('getLatestAssistantSnapshotForAutoQueueBoundary(', 'getLatestAssistantSnapshotForAutoQueueBoundarySafe(')
  .replaceAll('isBatchWaitReplyPageStillAnswering(', 'isBatchWaitReplyPageStillAnsweringSafe(')
  .replaceAll('logBatchWaitReplyContinueThrottled(', 'logBatchWaitReplyContinueThrottledSafe(')
  .replaceAll('typeof isAssistantBusy === \'function\'\n        ? !!isAssistantBusy()\n        : isChatGPTActuallyBusyForTaskQueue()', 'isAssistantBusySafe()')
  .replaceAll('isChatGPTActuallyBusyForTaskQueue()', 'isAssistantBusySafe()')
  .replaceAll('getAutoQueueComposerAttachmentEvidence(', 'getAutoQueueComposerAttachmentEvidenceSafe(')
  .replaceAll('isUploadInProgressForAutoQueue()', 'isUploadInProgressForAutoQueueSafe()')
  .replaceAll('getAutoQueueComposerPayloadState(', 'getAutoQueueComposerPayloadStateSafe(')
  .replaceAll('formatBatchTaskGroupSourceTag(', 'formatBatchTaskGroupSourceTagSafe(')
  .replaceAll('clearRelentlessSendRetryState(', 'clearRelentlessSendRetryStateSafe(')
}
      return Object.freeze({
        getCurrentAutoQueueRunSafe,
        getAutoQueuePhaseSafe,
        isAutoQueueWaitingReply,
        isAutoQueueRunningNow,
        getCurrentConversationIdSafe,
        isChatGptHomePageNow,
        saveWaitingReplyContext,
        detectWaitingReplyOnHomeMismatch,
        pauseAutoQueueBecauseWaitingReplyContextLost,
        restoreWaitingReplyConversation,
        shouldPauseWaitingReplyForInvalidPageContext,
        blockNavigationDuringWaitingReply,
        evaluateAutoQueueSendSuccessEvidence,
        canEnterAutoQueueWaitingReply,
        confirmAutoQueueCanEnterWaitingReply,
        confirmAutoQueueMessageSubmittedForWaitingReply,
        blockAutoQueueWaitingReplyNotSubmitted,
        enterAutoQueueWaitingReplyAfterConfirm,
        isAutoQueueFalseWaitingReplyState,
        getAutoQueueWaitingReplyDisplayText,
        canAutoQueueWatchdogRecoverWaitingReply,
        getAutoQueueBatchStepKey,
        isAutoQueueWaitingReplyStepStale,
        getLatestAssistantReplyTextForBatchSafe,
        getBatchReplyStableSnapshot,
        isBatchAssistantActuallyIdleForSettle,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueWaitingReplyContext = AutoQueueWaitingReplyContext;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueWaitingReplyContextApi = null;
    function ensureAutoQueueWaitingReplyContextApi() {
      if (autoQueueWaitingReplyContextApi) {
        return autoQueueWaitingReplyContextApi;
      }
      if (
        typeof AutoQueueWaitingReplyContext === 'undefined'
        || !AutoQueueWaitingReplyContext
        || typeof AutoQueueWaitingReplyContext.create !== 'function'
      ) {
        console.error('[AUTOQ_WAITING_REPLY_CONTEXT][MISSING] AutoQueueWaitingReplyContext.create is not available');
        return null;
      }
      autoQueueWaitingReplyContextApi = AutoQueueWaitingReplyContext.create({
        state,
        config,
        AUTO_QUEUE_PHASES,
        appendAutoQueueLog,
        saveConfig,
        updateStatus,
        updateChatInputStateBadge,
        getCurrentRunningTask,
        getAutoQueueConversationIdSafe,
        isChatGptHomeOrNewChatPage: typeof isChatGptHomeOrNewChatPage === 'function'
          ? isChatGptHomeOrNewChatPage
          : null,
        restoreConversationById: typeof restoreConversationById === 'function'
          ? restoreConversationById
          : null,
        getAutoQueueBridgeConversationSnapshot,
        readPageTurnCount: typeof readPageTurnCount === 'function'
          ? readPageTurnCount
          : null,
        getLatestAssistantSnapshotForAutoQueueBoundary,
        isBatchWaitReplyPageStillAnswering,
        logBatchWaitReplyContinueThrottled,
        isAssistantBusy: typeof isAssistantBusy === 'function' ? isAssistantBusy : null,
        isChatGPTActuallyBusyForTaskQueue,
        getAutoQueueComposerAttachmentEvidence,
        isUploadInProgressForAutoQueue: typeof isUploadInProgressForAutoQueue === 'function'
          ? isUploadInProgressForAutoQueue
          : null,
        getAutoQueueComposerPayloadState,
        formatBatchTaskGroupSourceTag,
        clearRelentlessSendRetryState,
      });
      return autoQueueWaitingReplyContextApi;
    }
    function requireAutoQueueWaitingReplyContextApi(methodName) {
      const api = ensureAutoQueueWaitingReplyContextApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_WAITING_REPLY_CONTEXT][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function getCurrentAutoQueueRunSafe() {
      return requireAutoQueueWaitingReplyContextApi('getCurrentAutoQueueRunSafe')();
    }
    function getAutoQueuePhaseSafe() {
      return requireAutoQueueWaitingReplyContextApi('getAutoQueuePhaseSafe')();
    }
    function isAutoQueueWaitingReply() {
      return requireAutoQueueWaitingReplyContextApi('isAutoQueueWaitingReply')();
    }
    function isAutoQueueRunningNow() {
      return requireAutoQueueWaitingReplyContextApi('isAutoQueueRunningNow')();
    }
    function getCurrentConversationIdSafe() {
      return requireAutoQueueWaitingReplyContextApi('getCurrentConversationIdSafe')();
    }
    function isChatGptHomePageNow() {
      return requireAutoQueueWaitingReplyContextApi('isChatGptHomePageNow')();
    }
    function saveWaitingReplyContext(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('saveWaitingReplyContext')(reason);
    }
    function detectWaitingReplyOnHomeMismatch(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('detectWaitingReplyOnHomeMismatch')(
        reason,
      );
    }
    function pauseAutoQueueBecauseWaitingReplyContextLost(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('pauseAutoQueueBecauseWaitingReplyContextLost')(
        reason,
      );
    }
    function restoreWaitingReplyConversation(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('restoreWaitingReplyConversation')(
        reason,
      );
    }
    function shouldPauseWaitingReplyForInvalidPageContext(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('shouldPauseWaitingReplyForInvalidPageContext')(
        reason,
      );
    }
    function blockNavigationDuringWaitingReply(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('blockNavigationDuringWaitingReply')(
        reason,
      );
    }
    function evaluateAutoQueueSendSuccessEvidence(options = {}) {
      return requireAutoQueueWaitingReplyContextApi('evaluateAutoQueueSendSuccessEvidence')(
        options,
      );
    }
    function canEnterAutoQueueWaitingReply(options = {}) {
      return requireAutoQueueWaitingReplyContextApi('canEnterAutoQueueWaitingReply')(
        options,
      );
    }
    function confirmAutoQueueCanEnterWaitingReply(source = '-') {
      return requireAutoQueueWaitingReplyContextApi('confirmAutoQueueCanEnterWaitingReply')(
        source,
      );
    }
    async function confirmAutoQueueMessageSubmittedForWaitingReply(source, prompt, options = {}) {
      return requireAutoQueueWaitingReplyContextApi('confirmAutoQueueMessageSubmittedForWaitingReply')(
        source,
        prompt,
        options,
      );
    }
    function blockAutoQueueWaitingReplyNotSubmitted(sendKind, task, taskTitle, submitted, evidence = {}) {
      return requireAutoQueueWaitingReplyContextApi('blockAutoQueueWaitingReplyNotSubmitted')(
        sendKind,
        task,
        taskTitle,
        submitted,
        evidence,
      );
    }
    async function enterAutoQueueWaitingReplyAfterConfirm(options = {}) {
      return requireAutoQueueWaitingReplyContextApi('enterAutoQueueWaitingReplyAfterConfirm')(
        options,
      );
    }
    function isAutoQueueFalseWaitingReplyState(reason = '-') {
      return requireAutoQueueWaitingReplyContextApi('isAutoQueueFalseWaitingReplyState')(
        reason,
      );
    }
    function getAutoQueueWaitingReplyDisplayText() {
      return requireAutoQueueWaitingReplyContextApi('getAutoQueueWaitingReplyDisplayText')();
    }
    function canAutoQueueWatchdogRecoverWaitingReply() {
      return requireAutoQueueWaitingReplyContextApi('canAutoQueueWatchdogRecoverWaitingReply')();
    }
    function getAutoQueueBatchStepKey() {
      return requireAutoQueueWaitingReplyContextApi('getAutoQueueBatchStepKey')();
    }
    function isAutoQueueWaitingReplyStepStale() {
      return requireAutoQueueWaitingReplyContextApi('isAutoQueueWaitingReplyStepStale')();
    }
    function getLatestAssistantReplyTextForBatchSafe(source) {
      return requireAutoQueueWaitingReplyContextApi('getLatestAssistantReplyTextForBatchSafe')(
        source,
      );
    }
    function getBatchReplyStableSnapshot(source) {
      return requireAutoQueueWaitingReplyContextApi('getBatchReplyStableSnapshot')(
        source,
      );
    }
    function isBatchAssistantActuallyIdleForSettle(source, replySnapshot) {
      return requireAutoQueueWaitingReplyContextApi('isBatchAssistantActuallyIdleForSettle')(
        source,
        replySnapshot,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function getCurrentAutoQueueRunSafe() {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    async function maybeRepairStaleBatchWaitingReply', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueWaitingReplyContextApi = null;')) {
    throw new Error('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][ALREADY_PATCHED] autoQueueWaitingReplyContextApi already exists');
  }
  const startMarker = '    function getCurrentAutoQueueRunSafe() {';
  const endMarker = '    async function maybeRepairStaleBatchWaitingReply';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function getCurrentAutoQueueRunSafe',
    'function isAutoQueueWaitingReply',
    'function saveWaitingReplyContext',
    'function confirmAutoQueueMessageSubmittedForWaitingReply',
    'function enterAutoQueueWaitingReplyAfterConfirm',
    'function getBatchReplyStableSnapshot',
    'function isBatchAssistantActuallyIdleForSettle',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(WAITING_REPLY_CONTEXT_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-waiting-reply-context.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const replySettlerIndex = parts.indexOf('autoqueue/auto-queue-reply-state-settler.js');
  const debugSectionsIndex = parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js');
  if (replySettlerIndex >= 0) {
    insertIndex = replySettlerIndex;
  } else if (debugSectionsIndex >= 0) {
    insertIndex = debugSectionsIndex;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-waiting-reply-context.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][BUILD_ORDER_OK]', {
    waitingReplyContextIndex: parts.indexOf('autoqueue/auto-queue-waiting-reply-context.js'),
    replySettlerIndex: parts.indexOf('autoqueue/auto-queue-reply-state-settler.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(WAITING_REPLY_CONTEXT_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueWaitingReplyContextApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueWaitingReplyContextApi facade');
  }
  if (!core.includes("requireAutoQueueWaitingReplyContextApi('enterAutoQueueWaitingReplyAfterConfirm')")) {
    failures.push('auto-queue-core.js enterAutoQueueWaitingReplyAfterConfirm is not delegated');
  }
  if (
    core.includes('function saveWaitingReplyContext(reason =')
    && core.includes('WAITING_REPLY_CONTEXT_SAVED')
  ) {
    failures.push('auto-queue-core.js still contains full waiting reply context implementation');
  }
  if (!core.includes('async function maybeRepairStaleBatchWaitingReply')) {
    failures.push('auto-queue-core.js lost maybeRepairStaleBatchWaitingReply');
  }
  if (!moduleText.includes('const AutoQueueWaitingReplyContext = (() => {')) {
    failures.push('auto-queue-waiting-reply-context.js missing module');
  }
  [
    'function getCurrentAutoQueueRunSafe',
    'function isAutoQueueWaitingReply',
    'function saveWaitingReplyContext',
    'function confirmAutoQueueMessageSubmittedForWaitingReply',
    'function enterAutoQueueWaitingReplyAfterConfirm',
    'function getBatchReplyStableSnapshot',
    'function isBatchAssistantActuallyIdleForSettle',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-waiting-reply-context.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const contextIndex = order.parts.indexOf('autoqueue/auto-queue-waiting-reply-context.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (contextIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-waiting-reply-context.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(contextIndex >= 0 && coreIndex >= 0 && contextIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-waiting-reply-context.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_WAITING_REPLY_CONTEXT_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
