import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const VISIBLE_DONE_VERIFY_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-visible-done-and-task-verify.js',
);

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
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
   * AutoQueueVisibleDoneAndTaskVerify：可见终止符检测与任务答案验证
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责可见 done signal 稳定确认、数学答案校验、当前任务回复稳定性判断。
   * 3. 不负责 task advance guard、不负责发送执行、不负责上传执行、不负责按钮渲染。
   ********************************************************************/
  const AutoQueueVisibleDoneAndTaskVerify = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const VISIBLE_DONE_SIGNAL_STABLE_MS = deps.VISIBLE_DONE_SIGNAL_STABLE_MS;
      const TASK_REPLY_STABLE_HASH_ROUNDS = deps.TASK_REPLY_STABLE_HASH_ROUNDS;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const getCurrentRunningTask = deps.getCurrentRunningTask;
      const buildAssistantReplySnapshot = deps.buildAssistantReplySnapshot;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const isExactBatchDoneSignalText = deps.isExactBatchDoneSignalText;
      const getLatestAssistantSnapshotForAutoQueueBoundary = deps.getLatestAssistantSnapshotForAutoQueueBoundary;
      const isAssistantSnapshotBelongsToCurrentTask = deps.isAssistantSnapshotBelongsToCurrentTask;
      const handleTaskDoneSignal = deps.handleTaskDoneSignal;
      const failCurrentTask = deps.failCurrentTask;
      const isTaskDoneSignalMatched = deps.isTaskDoneSignalMatched;
      const onAssistantReplySettled = deps.onAssistantReplySettled;
      const resolveTaskInitialPrompt = deps.resolveTaskInitialPrompt;
      const logTaskRunError = deps.logTaskRunError;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const computeSimpleTextHash = deps.computeSimpleTextHash;
      const detectComposerResponseState = deps.detectComposerResponseState;
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

      function getCurrentRunningTaskSafe() {
        if (typeof getCurrentRunningTask === 'function') {
          return getCurrentRunningTask();
        }
        return null;
      }

      function buildAssistantReplySnapshotSafe() {
        if (typeof buildAssistantReplySnapshot === 'function') {
          return buildAssistantReplySnapshot();
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'buildAssistantReplySnapshot',
        });
        return {
          text: '',
        };
      }

      function getActiveTaskProfileSafe() {
        if (typeof getActiveTaskProfile === 'function') {
          return getActiveTaskProfile();
        }
        return null;
      }

      function resolveTaskContinueSettingsSafe(task, profile, options) {
        if (typeof resolveTaskContinueSettings === 'function') {
          return resolveTaskContinueSettings(task, profile, options);
        }
        return null;
      }

      function isExactBatchDoneSignalTextSafe(replyText, doneSignal) {
        if (typeof isExactBatchDoneSignalText === 'function') {
          return !!isExactBatchDoneSignalText(replyText, doneSignal);
        }
        return false;
      }

      function getLatestAssistantSnapshotForAutoQueueBoundarySafe(source) {
        if (typeof getLatestAssistantSnapshotForAutoQueueBoundary === 'function') {
          return getLatestAssistantSnapshotForAutoQueueBoundary(source);
        }
        return null;
      }

      function isAssistantSnapshotBelongsToCurrentTaskSafe(snapshot, source) {
        if (typeof isAssistantSnapshotBelongsToCurrentTask === 'function') {
          return !!isAssistantSnapshotBelongsToCurrentTask(snapshot, source);
        }
        return false;
      }

      function handleTaskDoneSignalSafe(task, profile, resolved, replyText, source) {
        if (typeof handleTaskDoneSignal === 'function') {
          return handleTaskDoneSignal(task, profile, resolved, replyText, source);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'handleTaskDoneSignal',
          source,
        });
        return Promise.resolve(null);
      }

      function failCurrentTaskSafe(reason, options) {
        if (typeof failCurrentTask === 'function') {
          return failCurrentTask(reason, options);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'failCurrentTask',
          reason,
        });
        return null;
      }

      function isTaskDoneSignalMatchedSafe(replyText, doneSignal) {
        if (typeof isTaskDoneSignalMatched === 'function') {
          return isTaskDoneSignalMatched(replyText, doneSignal);
        }
        return {
          matched: false,
          corrupted: false,
        };
      }

      function onAssistantReplySettledSafe(text, options) {
        if (typeof onAssistantReplySettled === 'function') {
          return onAssistantReplySettled(text, options);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'onAssistantReplySettled',
          textLength: String(text || '').length,
          reason: options && options.reason ? options.reason : '-',
        });
        return null;
      }

      function resolveTaskInitialPromptSafe(task, options) {
        if (typeof resolveTaskInitialPrompt === 'function') {
          return resolveTaskInitialPrompt(task, options);
        }
        return null;
      }

      function logTaskRunErrorSafe(scope, error, taskOverride) {
        if (typeof logTaskRunError === 'function') {
          return logTaskRunError(scope, error, taskOverride);
        }
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][DEPENDENCY_MISSING]', {
          name: 'logTaskRunError',
          scope,
          error,
        });
        return null;
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        if (typeof ensureTaskRunVerificationFields === 'function') {
          return ensureTaskRunVerificationFields(run);
        }
        return run || {};
      }

      function computeSimpleTextHashSafe(text) {
        if (typeof computeSimpleTextHash === 'function') {
          return computeSimpleTextHash(text);
        }
        return String(text || '');
      }

      function detectComposerResponseStateSafe(options) {
        if (typeof detectComposerResponseState === 'function') {
          return detectComposerResponseState(options);
        }
        return null;
      }

${extractedBlock
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
  .replaceAll('isChatGPTActuallyBusyForTaskQueue()', 'isChatGPTActuallyBusyForTaskQueueSafe()')
  .replaceAll('tryScheduleTerminalBusyOverride(', 'tryScheduleTerminalBusyOverrideSafe(')
  .replaceAll('getCurrentRunningTask()', 'getCurrentRunningTaskSafe()')
  .replaceAll('buildAssistantReplySnapshot()', 'buildAssistantReplySnapshotSafe()')
  .replaceAll('getActiveTaskProfile()', 'getActiveTaskProfileSafe()')
  .replaceAll('resolveTaskContinueSettings(', 'resolveTaskContinueSettingsSafe(')
  .replaceAll('isExactBatchDoneSignalText(', 'isExactBatchDoneSignalTextSafe(')
  .replaceAll('getLatestAssistantSnapshotForAutoQueueBoundary(', 'getLatestAssistantSnapshotForAutoQueueBoundarySafe(')
  .replaceAll('isAssistantSnapshotBelongsToCurrentTask(', 'isAssistantSnapshotBelongsToCurrentTaskSafe(')
  .replaceAll('handleTaskDoneSignal(', 'handleTaskDoneSignalSafe(')
  .replaceAll('failCurrentTask(', 'failCurrentTaskSafe(')
  .replaceAll('isTaskDoneSignalMatched(', 'isTaskDoneSignalMatchedSafe(')
  .replaceAll('onAssistantReplySettled(', 'onAssistantReplySettledSafe(')
  .replaceAll('resolveTaskInitialPrompt(', 'resolveTaskInitialPromptSafe(')
  .replaceAll('logTaskRunError(', 'logTaskRunErrorSafe(')
  .replaceAll('ensureTaskRunVerificationFields(', 'ensureTaskRunVerificationFieldsSafe(')
  .replaceAll('computeSimpleTextHash(', 'computeSimpleTextHashSafe(')
  .replaceAll('detectComposerResponseState(', 'detectComposerResponseStateSafe(')
}

      return Object.freeze({
        clearVisibleDoneSignalTracking,
        maybeSettleTaskReplyByVisibleDoneSignal,
        getLastAssistantReplyText,
        escapeRegExpForTaskVerify,
        getTaskQuestionTextForVerify,
        extractMathExpectationsFromText,
        extractNumberTokensForTaskVerify,
        verifyMathAnswerForTask,
        verifyMathAnswer,
        getCurrentTaskReplyTextForVerify,
        updateCurrentTaskReplyStableState,
        verifyCurrentTaskAnswerBeforeAdvance,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueVisibleDoneAndTaskVerify = AutoQueueVisibleDoneAndTaskVerify;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueVisibleDoneAndTaskVerifyApi = null;
    function ensureAutoQueueVisibleDoneAndTaskVerifyApi() {
      if (autoQueueVisibleDoneAndTaskVerifyApi) {
        return autoQueueVisibleDoneAndTaskVerifyApi;
      }
      if (
        typeof AutoQueueVisibleDoneAndTaskVerify === 'undefined'
        || !AutoQueueVisibleDoneAndTaskVerify
        || typeof AutoQueueVisibleDoneAndTaskVerify.create !== 'function'
      ) {
        console.error('[AUTOQ_VISIBLE_DONE_VERIFY][MISSING] AutoQueueVisibleDoneAndTaskVerify.create is not available');
        return null;
      }
      autoQueueVisibleDoneAndTaskVerifyApi = AutoQueueVisibleDoneAndTaskVerify.create({
        state,
        config,
        VISIBLE_DONE_SIGNAL_STABLE_MS,
        TASK_REPLY_STABLE_HASH_ROUNDS,
        isChatGPTActuallyBusyForTaskQueue,
        tryScheduleTerminalBusyOverride,
        getCurrentRunningTask,
        buildAssistantReplySnapshot,
        getActiveTaskProfile,
        resolveTaskContinueSettings,
        isExactBatchDoneSignalText,
        getLatestAssistantSnapshotForAutoQueueBoundary,
        isAssistantSnapshotBelongsToCurrentTask,
        handleTaskDoneSignal,
        failCurrentTask,
        isTaskDoneSignalMatched,
        onAssistantReplySettled,
        resolveTaskInitialPrompt,
        logTaskRunError,
        ensureTaskRunVerificationFields,
        computeSimpleTextHash,
        detectComposerResponseState,
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
      return autoQueueVisibleDoneAndTaskVerifyApi;
    }
    function requireAutoQueueVisibleDoneAndTaskVerifyApi(methodName) {
      const api = ensureAutoQueueVisibleDoneAndTaskVerifyApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_VISIBLE_DONE_VERIFY][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function clearVisibleDoneSignalTracking() {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('clearVisibleDoneSignalTracking')();
    }
    function maybeSettleTaskReplyByVisibleDoneSignal(triggerReason) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('maybeSettleTaskReplyByVisibleDoneSignal')(
        triggerReason,
      );
    }
    function getLastAssistantReplyText() {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('getLastAssistantReplyText')();
    }
    function escapeRegExpForTaskVerify(text) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('escapeRegExpForTaskVerify')(
        text,
      );
    }
    function getTaskQuestionTextForVerify(task) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('getTaskQuestionTextForVerify')(
        task,
      );
    }
    function extractMathExpectationsFromText(text) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('extractMathExpectationsFromText')(
        text,
      );
    }
    function extractNumberTokensForTaskVerify(text) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('extractNumberTokensForTaskVerify')(
        text,
      );
    }
    function verifyMathAnswerForTask(task, replyText) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('verifyMathAnswerForTask')(
        task,
        replyText,
      );
    }
    function verifyMathAnswer(questionText, replyText) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('verifyMathAnswer')(
        questionText,
        replyText,
      );
    }
    function getCurrentTaskReplyTextForVerify(task, replyText, options = {}) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('getCurrentTaskReplyTextForVerify')(
        task,
        replyText,
        options,
      );
    }
    function updateCurrentTaskReplyStableState(replyText) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('updateCurrentTaskReplyStableState')(
        replyText,
      );
    }
    function verifyCurrentTaskAnswerBeforeAdvance(task, replyText, meta = {}) {
      return requireAutoQueueVisibleDoneAndTaskVerifyApi('verifyCurrentTaskAnswerBeforeAdvance')(
        task,
        replyText,
        meta,
      );
    }
`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, 'function clearVisibleDoneSignalTracking()', AUTOQUEUE_CORE_FILE);
  assertContains(source, 'function verifyCurrentTaskAnswerBeforeAdvance(task, replyText, meta = {})', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueVisibleDoneAndTaskVerifyApi = null;')) {
    throw new Error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][ALREADY_PATCHED] autoQueueVisibleDoneAndTaskVerifyApi already exists');
  }

  const startResult = findFirstExistingIndex(source, [
    '    function clearVisibleDoneSignalTracking() {',
  ]);
  if (startResult.idx < 0) {
    throw new Error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][START_MARKER_NOT_FOUND] clearVisibleDoneSignalTracking');
  }

  const endResult = findFirstExistingIndex(source, [
    '    function getTaskDoneSignalForAdvanceGuard(task, profile) {',
    '    function getTaskDoneSignalForAdvanceGuard(task) {',
  ], startResult.idx);
  if (endResult.idx < 0 || endResult.idx <= startResult.idx) {
    throw new Error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][END_MARKER_NOT_FOUND] getTaskDoneSignalForAdvanceGuard');
  }

  const extractedBlock = source.slice(startResult.idx, endResult.idx).trimEnd() + '\n';
  const requiredMarkers = [
    'function clearVisibleDoneSignalTracking',
    'function maybeSettleTaskReplyByVisibleDoneSignal',
    'function getLastAssistantReplyText',
    'function escapeRegExpForTaskVerify',
    'function getTaskQuestionTextForVerify',
    'function extractMathExpectationsFromText',
    'function extractNumberTokensForTaskVerify',
    'function verifyMathAnswerForTask',
    'function verifyMathAnswer',
    'function getCurrentTaskReplyTextForVerify',
    'function updateCurrentTaskReplyStableState',
    'function verifyCurrentTaskAnswerBeforeAdvance',
    '[TASK_VERIFY][START]',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, startResult.idx).replace(/\s*$/, '\n\n');
  const after = source.slice(endResult.idx);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(VISIBLE_DONE_VERIFY_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
    startMarker: startResult.marker,
    endMarker: endResult.marker,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-visible-done-and-task-verify.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const waitingRepairIndex = parts.indexOf('autoqueue/auto-queue-waiting-reply-repair.js');
  const replySettlerIndex = parts.indexOf('autoqueue/auto-queue-reply-state-settler.js');
  if (waitingRepairIndex >= 0) {
    insertIndex = waitingRepairIndex + 1;
  } else if (replySettlerIndex >= 0) {
    insertIndex = replySettlerIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-visible-done-and-task-verify.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][BUILD_ORDER_OK]', {
    visibleDoneVerifyIndex: parts.indexOf('autoqueue/auto-queue-visible-done-and-task-verify.js'),
    waitingRepairIndex: parts.indexOf('autoqueue/auto-queue-waiting-reply-repair.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(VISIBLE_DONE_VERIFY_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueVisibleDoneAndTaskVerifyApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueVisibleDoneAndTaskVerifyApi facade');
  }
  if (!core.includes("requireAutoQueueVisibleDoneAndTaskVerifyApi('verifyCurrentTaskAnswerBeforeAdvance')")) {
    failures.push('auto-queue-core.js verifyCurrentTaskAnswerBeforeAdvance is not delegated');
  }
  if (core.includes('taskIndex=${taskIndex + 1} question=${JSON.stringify(questionText)}')) {
    failures.push('auto-queue-core.js still contains full verifyCurrentTaskAnswerBeforeAdvance implementation');
  }
  if (!core.includes('function getTaskDoneSignalForAdvanceGuard(task)')) {
    failures.push('auto-queue-core.js lost getTaskDoneSignalForAdvanceGuard');
  }
  if (!moduleText.includes('const AutoQueueVisibleDoneAndTaskVerify = (() => {')) {
    failures.push('auto-queue-visible-done-and-task-verify.js missing module');
  }
  [
    'function clearVisibleDoneSignalTracking',
    'function maybeSettleTaskReplyByVisibleDoneSignal',
    'function getLastAssistantReplyText',
    'function verifyMathAnswer',
    'function verifyCurrentTaskAnswerBeforeAdvance',
    '[TASK_VERIFY][START]',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-visible-done-and-task-verify.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const verifyIndex = order.parts.indexOf('autoqueue/auto-queue-visible-done-and-task-verify.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (verifyIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-visible-done-and-task-verify.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(verifyIndex >= 0 && coreIndex >= 0 && verifyIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-visible-done-and-task-verify.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_VISIBLE_DONE_VERIFY_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
