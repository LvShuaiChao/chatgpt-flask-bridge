import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const WAITING_REPLY_REPAIR_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-waiting-reply-repair.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function findFirstExistingIndex(source, markers, startAt = 0) {
  for (const marker of markers) {
    const idx = source.indexOf(marker, startAt);
    if (idx >= 0) {
      return {
        idx,
        marker,
      };
    }
  }
  return {
    idx: -1,
    marker: '',
  };
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueWaitingReplyRepair：waiting_reply 修复与 watchdog 恢复
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 stale waiting_reply、false waiting_reply、assistant busy 等修复逻辑。
   * 3. 不负责发送执行、不负责上传执行、不负责 replyState 收口、不负责任务推进校验。
   ********************************************************************/
  const AutoQueueWaitingReplyRepair = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const AUTO_QUEUE_PHASES = deps.AUTO_QUEUE_PHASES;
      const shouldBlockWatchdogRecoverBecauseAssistantBusy = deps.shouldBlockWatchdogRecoverBecauseAssistantBusy;
      const shouldPauseWaitingReplyForInvalidPageContext = deps.shouldPauseWaitingReplyForInvalidPageContext;
      const canAutoQueueWatchdogRecoverWaitingReply = deps.canAutoQueueWatchdogRecoverWaitingReply;
      const isAutoQueueWaitingReplyStepStale = deps.isAutoQueueWaitingReplyStepStale;
      const getBatchReplyStableSnapshot = deps.getBatchReplyStableSnapshot;
      const trySettleWaitingReplyByReplyState = deps.trySettleWaitingReplyByReplyState;
      const getLatestAssistantReplyTextForBatchSafe = deps.getLatestAssistantReplyTextForBatchSafe;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const updateStatus = deps.updateStatus;
      const updateChatInputStateBadge = deps.updateChatInputStateBadge;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const isAutoQueueFalseWaitingReplyState = deps.isAutoQueueFalseWaitingReplyState;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const appendLog = deps.appendLog;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const isNextTaskTransitionPhase = deps.isNextTaskTransitionPhase;
      const repairWaitingReplyState = deps.repairWaitingReplyState;
      const isBatchAssistantActuallyIdleForSettle = deps.isBatchAssistantActuallyIdleForSettle;
      const REPLY_COMPLETE_STABLE_MS = deps.REPLY_COMPLETE_STABLE_MS;
      const REPLY_COMPLETE_STABLE_MIN_COUNT = deps.REPLY_COMPLETE_STABLE_MIN_COUNT;
      const getAutoQueueBatchStepKey = deps.getAutoQueueBatchStepKey;
      const setTaskBatchStep = deps.setTaskBatchStep;
      const ensureBatchRunState = deps.ensureBatchRunState;
      const isExactBatchDoneSignalText = deps.isExactBatchDoneSignalText;
      const getTaskDoneSignalForAdvanceGuard = deps.getTaskDoneSignalForAdvanceGuard;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isAssistantSnapshotBelongsToCurrentTask = deps.isAssistantSnapshotBelongsToCurrentTask;
      const handleTaskDoneSignal = deps.handleTaskDoneSignal;
      const handleTaskReplyReady = deps.handleTaskReplyReady;
      const getAutoQueueComposerPayloadState = deps.getAutoQueueComposerPayloadState;
      const getAutoQueueConversationEvidence = deps.getAutoQueueConversationEvidence;
      const markTaskBatchStepRunning = deps.markTaskBatchStepRunning;
      const setAutoQueuePhase = deps.setAutoQueuePhase;
      const setBatchTaskGroupDisplayState = deps.setBatchTaskGroupDisplayState;
      const WAIT_REPLY_REPAIR_STEPS = deps.WAIT_REPLY_REPAIR_STEPS;
      const syncWaitingReplyFlagFromPhase = deps.syncWaitingReplyFlagFromPhase;
      const getAutoQueueBridgeConversationSnapshot = deps.getAutoQueueBridgeConversationSnapshot;
      const repairWaitingReplyStateOnce = deps.repairWaitingReplyStateOnce;
      const isCurrentRunFirstMessage = deps.isCurrentRunFirstMessage;
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
      function shouldBlockWatchdogRecoverBecauseAssistantBusySafe(reason) {
        if (typeof shouldBlockWatchdogRecoverBecauseAssistantBusy === 'function') {
          return !!shouldBlockWatchdogRecoverBecauseAssistantBusy(reason);
        }
        return false;
      }
      function shouldPauseWaitingReplyForInvalidPageContextSafe(reason) {
        if (typeof shouldPauseWaitingReplyForInvalidPageContext === 'function') {
          return !!shouldPauseWaitingReplyForInvalidPageContext(reason);
        }
        return false;
      }
      function canAutoQueueWatchdogRecoverWaitingReplySafe() {
        if (typeof canAutoQueueWatchdogRecoverWaitingReply === 'function') {
          return !!canAutoQueueWatchdogRecoverWaitingReply();
        }
        return false;
      }
      function isAutoQueueWaitingReplyStepStaleSafe() {
        if (typeof isAutoQueueWaitingReplyStepStale === 'function') {
          return !!isAutoQueueWaitingReplyStepStale();
        }
        return false;
      }
      function getBatchReplyStableSnapshotSafe(source) {
        if (typeof getBatchReplyStableSnapshot === 'function') {
          return getBatchReplyStableSnapshot(source);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'getBatchReplyStableSnapshot',
          source,
        });
        return {
          text: '',
          stableMs: 0,
          count: 0,
        };
      }
      function trySettleWaitingReplyByReplyStateSafe(source) {
        if (typeof trySettleWaitingReplyByReplyState === 'function') {
          return !!trySettleWaitingReplyByReplyState(source);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'trySettleWaitingReplyByReplyState',
          source,
        });
        return false;
      }
      function getLatestAssistantReplyTextForBatchSafeSafe(source) {
        if (typeof getLatestAssistantReplyTextForBatchSafe === 'function') {
          return getLatestAssistantReplyTextForBatchSafe(source);
        }
        return '';
      }
      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
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
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][DEPENDENCY_MISSING]', {
          name: 'updateStatus',
          reason,
        });
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
      function isAutoQueueFalseWaitingReplyStateSafe(reason) {
        if (typeof isAutoQueueFalseWaitingReplyState === 'function') {
          return !!isAutoQueueFalseWaitingReplyState(reason);
        }
        return false;
      }
      function isChatGPTActuallyBusyForTaskQueueSafe() {
        if (typeof isChatGPTActuallyBusyForTaskQueue === 'function') {
          return !!isChatGPTActuallyBusyForTaskQueue();
        }
        return false;
      }
      function tryScheduleTerminalBusyOverrideSafe(reason) {
        if (typeof tryScheduleTerminalBusyOverride === 'function') {
          return !!tryScheduleTerminalBusyOverride(reason);
        }
        return false;
      }
${extractedBlock
  .replaceAll('shouldBlockWatchdogRecoverBecauseAssistantBusy(', 'shouldBlockWatchdogRecoverBecauseAssistantBusySafe(')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
  .replaceAll('shouldPauseWaitingReplyForInvalidPageContext(', 'shouldPauseWaitingReplyForInvalidPageContextSafe(')
  .replaceAll('canAutoQueueWatchdogRecoverWaitingReply()', 'canAutoQueueWatchdogRecoverWaitingReplySafe()')
  .replaceAll('isAutoQueueWaitingReplyStepStale()', 'isAutoQueueWaitingReplyStepStaleSafe()')
  .replaceAll('getBatchReplyStableSnapshot(', 'getBatchReplyStableSnapshotSafe(')
  .replaceAll('trySettleWaitingReplyByReplyState(', 'trySettleWaitingReplyByReplyStateSafe(')
  .replaceAll('getLatestAssistantReplyTextForBatchSafe(', 'getLatestAssistantReplyTextForBatchSafeSafe(')
  .replaceAll('onAssistantReplySettled(', 'onAssistantReplySettledSafe(')
  .replaceAll('updateStatus(', 'updateStatusSafe(')
  .replaceAll('updateChatInputStateBadge()', 'updateChatInputStateBadgeSafe()')
  .replaceAll('getCurrentRunningTask()', 'getCurrentRunningTaskSafe()')
  .replaceAll('isAutoQueueFalseWaitingReplyState()', 'isAutoQueueFalseWaitingReplyStateSafe()')
  .replaceAll('isChatGPTActuallyBusyForTaskQueue()', 'isChatGPTActuallyBusyForTaskQueueSafe()')
  .replaceAll('tryScheduleTerminalBusyOverride(', 'tryScheduleTerminalBusyOverrideSafe(')
}
      return Object.freeze({
        maybeRepairStaleBatchWaitingReply,
        repairAutoQueueFalseWaitingReply,
        repairFalseWaitingReplyWithComposerPayload,
        repairWaitingReplyForAssistantBusy,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueWaitingReplyRepair = AutoQueueWaitingReplyRepair;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueWaitingReplyRepairApi = null;
    function ensureAutoQueueWaitingReplyRepairApi() {
      if (autoQueueWaitingReplyRepairApi) {
        return autoQueueWaitingReplyRepairApi;
      }
      if (
        typeof AutoQueueWaitingReplyRepair === 'undefined'
        || !AutoQueueWaitingReplyRepair
        || typeof AutoQueueWaitingReplyRepair.create !== 'function'
      ) {
        console.error('[AUTOQ_WAITING_REPLY_REPAIR][MISSING] AutoQueueWaitingReplyRepair.create is not available');
        return null;
      }
      autoQueueWaitingReplyRepairApi = AutoQueueWaitingReplyRepair.create({
        state,
        config,
        AUTO_QUEUE_PHASES,
        shouldBlockWatchdogRecoverBecauseAssistantBusy,
        shouldPauseWaitingReplyForInvalidPageContext,
        canAutoQueueWatchdogRecoverWaitingReply,
        isAutoQueueWaitingReplyStepStale,
        getBatchReplyStableSnapshot,
        trySettleWaitingReplyByReplyState,
        getLatestAssistantReplyTextForBatchSafe,
        onAssistantReplySettled,
        updateStatus,
        updateChatInputStateBadge,
        getCurrentRunningTask,
        isAutoQueueFalseWaitingReplyState,
        isChatGPTActuallyBusyForTaskQueue,
        tryScheduleTerminalBusyOverride,
        ensureTaskRunVerificationFields,
        isNextTaskTransitionPhase,
        repairWaitingReplyState,
        isBatchAssistantActuallyIdleForSettle,
        REPLY_COMPLETE_STABLE_MS,
        REPLY_COMPLETE_STABLE_MIN_COUNT,
        getAutoQueueBatchStepKey,
        setTaskBatchStep,
        ensureBatchRunState,
        isExactBatchDoneSignalText,
        getTaskDoneSignalForAdvanceGuard,
        getActiveTaskProfile,
        resolveTaskContinueSettings,
        getLatestAssistantSnapshotForAutoQueueBoundary,
        isAssistantSnapshotBelongsToCurrentTask,
        handleTaskDoneSignal,
        handleTaskReplyReady: typeof handleTaskReplyReady === 'function' ? handleTaskReplyReady : null,
        getAutoQueueComposerPayloadState,
        getAutoQueueConversationEvidence,
        markTaskBatchStepRunning,
        setAutoQueuePhase,
        setBatchTaskGroupDisplayState,
        WAIT_REPLY_REPAIR_STEPS,
        syncWaitingReplyFlagFromPhase,
        getAutoQueueBridgeConversationSnapshot,
        repairWaitingReplyStateOnce,
        isCurrentRunFirstMessage,
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
      return autoQueueWaitingReplyRepairApi;
    }
    function requireAutoQueueWaitingReplyRepairApi(methodName) {
      const api = ensureAutoQueueWaitingReplyRepairApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_WAITING_REPLY_REPAIR][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function maybeRepairStaleBatchWaitingReply(source) {
      return requireAutoQueueWaitingReplyRepairApi('maybeRepairStaleBatchWaitingReply')(
        source,
      );
    }
    function repairAutoQueueFalseWaitingReply(reason = 'autoq-false-waiting-reply') {
      return requireAutoQueueWaitingReplyRepairApi('repairAutoQueueFalseWaitingReply')(
        reason,
      );
    }
    function repairFalseWaitingReplyWithComposerPayload(reason = 'autoq-false-waiting-reply') {
      return requireAutoQueueWaitingReplyRepairApi('repairFalseWaitingReplyWithComposerPayload')(
        reason,
      );
    }
    function repairWaitingReplyForAssistantBusy(reason) {
      return requireAutoQueueWaitingReplyRepairApi('repairWaitingReplyForAssistantBusy')(
        reason,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, 'function clearVisibleDoneSignalTracking()', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueWaitingReplyRepairApi = null;')) {
    throw new Error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][ALREADY_PATCHED] autoQueueWaitingReplyRepairApi already exists');
  }
  const startResult = findFirstExistingIndex(source, [
    '    async function maybeRepairStaleBatchWaitingReply(source) {',
    '    function maybeRepairStaleBatchWaitingReply(source) {',
  ]);
  if (startResult.idx < 0) {
    throw new Error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][START_MARKER_NOT_FOUND] maybeRepairStaleBatchWaitingReply');
  }
  const endMarker = '    function clearVisibleDoneSignalTracking() {';
  const endIndex = source.indexOf(endMarker, startResult.idx);
  if (endIndex < 0 || endIndex <= startResult.idx) {
    throw new Error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][END_MARKER_NOT_FOUND] clearVisibleDoneSignalTracking');
  }
  const extractedBlock = source.slice(startResult.idx, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function maybeRepairStaleBatchWaitingReply',
    'function repairAutoQueueFalseWaitingReply',
    'function repairFalseWaitingReplyWithComposerPayload',
    'function repairWaitingReplyForAssistantBusy',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startResult.idx).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(WAITING_REPLY_REPAIR_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
    startMarker: startResult.marker,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-waiting-reply-repair.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const waitingContextIndex = parts.indexOf('autoqueue/auto-queue-waiting-reply-context.js');
  const replySettlerIndex = parts.indexOf('autoqueue/auto-queue-reply-state-settler.js');
  if (waitingContextIndex >= 0) {
    insertIndex = waitingContextIndex + 1;
  } else if (replySettlerIndex >= 0) {
    insertIndex = replySettlerIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-waiting-reply-repair.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][BUILD_ORDER_OK]', {
    waitingReplyRepairIndex: parts.indexOf('autoqueue/auto-queue-waiting-reply-repair.js'),
    waitingContextIndex: parts.indexOf('autoqueue/auto-queue-waiting-reply-context.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(WAITING_REPLY_REPAIR_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueWaitingReplyRepairApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueWaitingReplyRepairApi facade');
  }
  if (!core.includes("requireAutoQueueWaitingReplyRepairApi('repairWaitingReplyForAssistantBusy')")) {
    failures.push('auto-queue-core.js repairWaitingReplyForAssistantBusy is not delegated');
  }
  if (
    core.includes('function maybeRepairStaleBatchWaitingReply(source)')
    && core.includes('WAIT_REPLY_REPAIR_SKIP_AUTHORITY_BUSY')
  ) {
    failures.push('auto-queue-core.js still contains full waiting reply repair implementation');
  }
  if (!core.includes('function clearVisibleDoneSignalTracking()')) {
    failures.push('auto-queue-core.js lost clearVisibleDoneSignalTracking');
  }
  if (!moduleText.includes('const AutoQueueWaitingReplyRepair = (() => {')) {
    failures.push('auto-queue-waiting-reply-repair.js missing module');
  }
  [
    'function maybeRepairStaleBatchWaitingReply',
    'function repairAutoQueueFalseWaitingReply',
    'function repairFalseWaitingReplyWithComposerPayload',
    'function repairWaitingReplyForAssistantBusy',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-waiting-reply-repair.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const repairIndex = order.parts.indexOf('autoqueue/auto-queue-waiting-reply-repair.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (repairIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-waiting-reply-repair.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(repairIndex >= 0 && coreIndex >= 0 && repairIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-waiting-reply-repair.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_WAITING_REPLY_REPAIR_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
