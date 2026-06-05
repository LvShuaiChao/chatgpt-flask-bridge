import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const TASK_ADVANCE_GUARD_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-task-advance-guard.js',
);

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueTaskAdvanceGuard：任务推进保护
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 负责判断当前任务回复是否允许推进到下一题。
   * 3. 不负责发送执行、不负责上传执行、不负责终止符最终验证、不负责任务运行器主循环。
   ********************************************************************/
  const AutoQueueTaskAdvanceGuard = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const TASK_REPLY_STABLE_HASH_ROUNDS = deps.TASK_REPLY_STABLE_HASH_ROUNDS;
      const TASK_DONE_SIGNAL = deps.TASK_DONE_SIGNAL;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const resolveTaskContinueSettings = deps.resolveTaskContinueSettings;
      const isTaskDoneSignalMatched = deps.isTaskDoneSignalMatched;
      const ensureTaskRunVerificationFields = deps.ensureTaskRunVerificationFields;
      const failCurrentTask = deps.failCurrentTask;
      const isFailureSkipReason = deps.isFailureSkipReason;
      const markTaskBatchStepRunning = deps.markTaskBatchStepRunning;
      const setTaskBatchStep = deps.setTaskBatchStep;
      const scheduleNextBatchTaskStep = deps.scheduleNextBatchTaskStep;
      const detectComposerResponseState = deps.detectComposerResponseState;
      const getCurrentTaskReplyTextForVerify = deps.getCurrentTaskReplyTextForVerify;
      const updateCurrentTaskReplyStableState = deps.updateCurrentTaskReplyStableState;
      const getTaskQuestionTextForVerify = deps.getTaskQuestionTextForVerify;
      const detectStrictTerminalSignal = deps.detectStrictTerminalSignal;
      const isChatGPTActuallyBusyForTaskQueue = deps.isChatGPTActuallyBusyForTaskQueue;
      const tryScheduleTerminalBusyOverride = deps.tryScheduleTerminalBusyOverride;
      const verifyCurrentTaskAnswerBeforeAdvance = deps.verifyCurrentTaskAnswerBeforeAdvance;
      const shouldAllowTaskAdvanceAfterVerify = deps.shouldAllowTaskAdvanceAfterVerify;
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

      function getActiveTaskProfileSafe() {
        if (typeof getActiveTaskProfile === 'function') {
          return getActiveTaskProfile();
        }
        return null;
      }

      function resolveTaskContinueSettingsSafe(task, profile, options = {}) {
        if (typeof resolveTaskContinueSettings === 'function') {
          return resolveTaskContinueSettings(task, profile, options);
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'resolveTaskContinueSettings',
          taskTitle: task && task.title ? task.title : '-',
        });
        return {
          actualDoneSignal: '',
        };
      }

      function isTaskDoneSignalMatchedSafe(text, doneSignal) {
        if (typeof isTaskDoneSignalMatched === 'function') {
          return isTaskDoneSignalMatched(text, doneSignal);
        }
        return {
          matched: String(text || '').trim() === String(doneSignal || '').trim(),
          corrupted: false,
        };
      }

      function ensureTaskRunVerificationFieldsSafe(run) {
        if (typeof ensureTaskRunVerificationFields === 'function') {
          return ensureTaskRunVerificationFields(run);
        }
        return run && typeof run === 'object' ? run : {};
      }

      function failCurrentTaskSafe(reason) {
        if (typeof failCurrentTask === 'function') {
          failCurrentTask(reason);
          return;
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'failCurrentTask',
          reason,
        });
      }

      function isFailureSkipReasonSafe(reason) {
        if (typeof isFailureSkipReason === 'function') {
          return !!isFailureSkipReason(reason);
        }
        return false;
      }

      function markTaskBatchStepRunningSafe(running) {
        if (typeof markTaskBatchStepRunning === 'function') {
          markTaskBatchStepRunning(running);
        }
      }

      function setTaskBatchStepSafe(step, task, options = {}) {
        if (typeof setTaskBatchStep === 'function') {
          setTaskBatchStep(step, task, options);
        }
      }

      function scheduleNextBatchTaskStepSafe(source, delayMs, options = {}) {
        if (typeof scheduleNextBatchTaskStep === 'function') {
          scheduleNextBatchTaskStep(source, delayMs, options);
          return;
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'scheduleNextBatchTaskStep',
          source,
          delayMs,
          reason: options && options.reason ? options.reason : '-',
        });
      }

      function detectComposerResponseStateSafe(options) {
        if (typeof detectComposerResponseState === 'function') {
          return detectComposerResponseState(options);
        }
        return null;
      }

      function getCurrentTaskReplyTextForVerifySafe(task, replyText, options = {}) {
        if (typeof getCurrentTaskReplyTextForVerify === 'function') {
          return getCurrentTaskReplyTextForVerify(task, replyText, options);
        }
        return String(replyText || '');
      }

      function updateCurrentTaskReplyStableStateSafe(replyText) {
        if (typeof updateCurrentTaskReplyStableState === 'function') {
          return updateCurrentTaskReplyStableState(replyText);
        }
        return {
          stable: true,
          stableCount: TASK_REPLY_STABLE_HASH_ROUNDS || 1,
          required: TASK_REPLY_STABLE_HASH_ROUNDS || 1,
        };
      }

      function getTaskQuestionTextForVerifySafe(task) {
        if (typeof getTaskQuestionTextForVerify === 'function') {
          return getTaskQuestionTextForVerify(task);
        }
        return String(
          (task && (task.initialPrompt || task.prompt || task.content || task.title))
          || '',
        );
      }

      function detectStrictTerminalSignalSafe(replyText, options = {}) {
        if (typeof detectStrictTerminalSignal === 'function') {
          return detectStrictTerminalSignal(replyText, options);
        }
        return {
          matched: false,
          corrupted: false,
          reason: 'missing-detectStrictTerminalSignal',
        };
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

      function verifyCurrentTaskAnswerBeforeAdvanceSafe(task, replyText, meta = {}) {
        if (typeof verifyCurrentTaskAnswerBeforeAdvance === 'function') {
          return verifyCurrentTaskAnswerBeforeAdvance(task, replyText, meta);
        }
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][DEPENDENCY_MISSING]', {
          name: 'verifyCurrentTaskAnswerBeforeAdvance',
          taskTitle: task && task.title ? task.title : '-',
          source: meta && meta.source ? meta.source : '-',
        });
        return {
          ok: false,
          reason: 'verify-function-missing',
        };
      }

      function shouldAllowTaskAdvanceAfterVerifySafe(verify) {
        if (typeof shouldAllowTaskAdvanceAfterVerify === 'function') {
          return !!shouldAllowTaskAdvanceAfterVerify(verify);
        }
        return !!(verify && verify.ok);
      }

${extractedBlock
  .replaceAll('getActiveTaskProfile()', 'getActiveTaskProfileSafe()')
  .replaceAll('resolveTaskContinueSettings(', 'resolveTaskContinueSettingsSafe(')
  .replaceAll('isTaskDoneSignalMatched(', 'isTaskDoneSignalMatchedSafe(')
  .replaceAll('ensureTaskRunVerificationFields(', 'ensureTaskRunVerificationFieldsSafe(')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
  .replaceAll('failCurrentTask(', 'failCurrentTaskSafe(')
  .replaceAll('isFailureSkipReason(', 'isFailureSkipReasonSafe(')
  .replaceAll('markTaskBatchStepRunning(', 'markTaskBatchStepRunningSafe(')
  .replaceAll('setTaskBatchStep(', 'setTaskBatchStepSafe(')
  .replaceAll('scheduleNextBatchTaskStep(', 'scheduleNextBatchTaskStepSafe(')
  .replaceAll('detectComposerResponseState(', 'detectComposerResponseStateSafe(')
  .replaceAll('getCurrentTaskReplyTextForVerify(', 'getCurrentTaskReplyTextForVerifySafe(')
  .replaceAll('updateCurrentTaskReplyStableState(', 'updateCurrentTaskReplyStableStateSafe(')
  .replaceAll('getTaskQuestionTextForVerify(', 'getTaskQuestionTextForVerifySafe(')
  .replaceAll('detectStrictTerminalSignal(', 'detectStrictTerminalSignalSafe(')
  .replaceAll('isChatGPTActuallyBusyForTaskQueue()', 'isChatGPTActuallyBusyForTaskQueueSafe()')
  .replaceAll('tryScheduleTerminalBusyOverride(', 'tryScheduleTerminalBusyOverrideSafe(')
  .replaceAll('verifyCurrentTaskAnswerBeforeAdvance(', 'verifyCurrentTaskAnswerBeforeAdvanceSafe(')
  .replaceAll('shouldAllowTaskAdvanceAfterVerify(', 'shouldAllowTaskAdvanceAfterVerifySafe(')
}

      return Object.freeze({
        getTaskDoneSignalForAdvanceGuard,
        evaluateTaskTerminalSignalForAdvance,
        blockTaskAdvanceForNonTerminalReply,
        scheduleContinueCurrentTaskAfterBlockedAdvance,
        canAdvanceToNextTaskAfterVerify,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueTaskAdvanceGuard = AutoQueueTaskAdvanceGuard;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueTaskAdvanceGuardApi = null;

    function ensureAutoQueueTaskAdvanceGuardApi() {
      if (autoQueueTaskAdvanceGuardApi) {
        return autoQueueTaskAdvanceGuardApi;
      }
      if (
        typeof AutoQueueTaskAdvanceGuard === 'undefined'
        || !AutoQueueTaskAdvanceGuard
        || typeof AutoQueueTaskAdvanceGuard.create !== 'function'
      ) {
        console.error('[AUTOQ_TASK_ADVANCE_GUARD][MISSING] AutoQueueTaskAdvanceGuard.create is not available');
        return null;
      }
      autoQueueTaskAdvanceGuardApi = AutoQueueTaskAdvanceGuard.create({
        state,
        config,
        TASK_REPLY_STABLE_HASH_ROUNDS,
        TASK_DONE_SIGNAL: typeof TASK_DONE_SIGNAL !== 'undefined' ? TASK_DONE_SIGNAL : '',
        getActiveTaskProfile,
        resolveTaskContinueSettings,
        isTaskDoneSignalMatched,
        ensureTaskRunVerificationFields,
        failCurrentTask,
        isFailureSkipReason,
        markTaskBatchStepRunning,
        setTaskBatchStep,
        scheduleNextBatchTaskStep,
        detectComposerResponseState: typeof detectComposerResponseState === 'function'
          ? detectComposerResponseState
          : null,
        getCurrentTaskReplyTextForVerify,
        updateCurrentTaskReplyStableState,
        getTaskQuestionTextForVerify,
        detectStrictTerminalSignal,
        isChatGPTActuallyBusyForTaskQueue,
        tryScheduleTerminalBusyOverride,
        verifyCurrentTaskAnswerBeforeAdvance,
        shouldAllowTaskAdvanceAfterVerify,
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
      return autoQueueTaskAdvanceGuardApi;
    }

    function requireAutoQueueTaskAdvanceGuardApi(methodName) {
      const api = ensureAutoQueueTaskAdvanceGuardApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_TASK_ADVANCE_GUARD][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function getTaskDoneSignalForAdvanceGuard(task) {
      return requireAutoQueueTaskAdvanceGuardApi('getTaskDoneSignalForAdvanceGuard')(
        task,
      );
    }

    function evaluateTaskTerminalSignalForAdvance(task, replyText, source = '-') {
      return requireAutoQueueTaskAdvanceGuardApi('evaluateTaskTerminalSignalForAdvance')(
        task,
        replyText,
        source,
      );
    }

    function blockTaskAdvanceForNonTerminalReply(task, replyText, source = '-') {
      return requireAutoQueueTaskAdvanceGuardApi('blockTaskAdvanceForNonTerminalReply')(
        task,
        replyText,
        source,
      );
    }

    function scheduleContinueCurrentTaskAfterBlockedAdvance(task, source = '-') {
      return requireAutoQueueTaskAdvanceGuardApi('scheduleContinueCurrentTaskAfterBlockedAdvance')(
        task,
        source,
      );
    }

    function canAdvanceToNextTaskAfterVerify(task, replyText, meta = {}) {
      return requireAutoQueueTaskAdvanceGuardApi('canAdvanceToNextTaskAfterVerify')(
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
  assertContains(source, '    function getTaskDoneSignalForAdvanceGuard(task) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function recordCurrentTaskAnswerCompletedOnce(task, source = \'-\') {', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueTaskAdvanceGuardApi = null;')) {
    throw new Error('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][ALREADY_PATCHED] autoQueueTaskAdvanceGuardApi already exists');
  }

  const startMarker = '    function getTaskDoneSignalForAdvanceGuard(task) {';
  const endMarker = '    function recordCurrentTaskAnswerCompletedOnce(task, source = \'-\') {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][RANGE_INVALID]');
  }

  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function getTaskDoneSignalForAdvanceGuard',
    'function evaluateTaskTerminalSignalForAdvance',
    'function blockTaskAdvanceForNonTerminalReply',
    'function scheduleContinueCurrentTaskAfterBlockedAdvance',
    'function canAdvanceToNextTaskAfterVerify',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(TASK_ADVANCE_GUARD_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);

  console.log('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-task-advance-guard.js');

  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  let insertIndex = coreIndex;
  const visibleVerifyIndex = parts.indexOf('autoqueue/auto-queue-visible-done-and-task-verify.js');
  const waitingRepairIndex = parts.indexOf('autoqueue/auto-queue-waiting-reply-repair.js');
  if (visibleVerifyIndex >= 0) {
    insertIndex = visibleVerifyIndex + 1;
  } else if (waitingRepairIndex >= 0) {
    insertIndex = waitingRepairIndex + 1;
  }

  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-task-advance-guard.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][BUILD_ORDER_OK]', {
    taskAdvanceGuardIndex: parts.indexOf('autoqueue/auto-queue-task-advance-guard.js'),
    visibleVerifyIndex: parts.indexOf('autoqueue/auto-queue-visible-done-and-task-verify.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(TASK_ADVANCE_GUARD_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueTaskAdvanceGuardApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueTaskAdvanceGuardApi facade');
  }
  if (!core.includes("requireAutoQueueTaskAdvanceGuardApi('canAdvanceToNextTaskAfterVerify')")) {
    failures.push('auto-queue-core.js canAdvanceToNextTaskAfterVerify is not delegated');
  }
  if (
    core.includes('function canAdvanceToNextTaskAfterVerify(task, replyText, meta = {})')
    && core.includes('[TASK_ADVANCE][ALLOW]')
  ) {
    failures.push('auto-queue-core.js still contains full task advance guard implementation');
  }
  if (!core.includes('function recordCurrentTaskAnswerCompletedOnce(task, source = \'-\')')) {
    failures.push('auto-queue-core.js lost recordCurrentTaskAnswerCompletedOnce');
  }
  if (!moduleText.includes('const AutoQueueTaskAdvanceGuard = (() => {')) {
    failures.push('auto-queue-task-advance-guard.js missing module');
  }
  [
    'function getTaskDoneSignalForAdvanceGuard',
    'function evaluateTaskTerminalSignalForAdvance',
    'function blockTaskAdvanceForNonTerminalReply',
    'function scheduleContinueCurrentTaskAfterBlockedAdvance',
    'function canAdvanceToNextTaskAfterVerify',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-task-advance-guard.js missing ${marker}`);
    }
  });
  if (!moduleText.includes('[TASK_ADVANCE][ALLOW]')) {
    failures.push('auto-queue-task-advance-guard.js must preserve TASK_ADVANCE allow log');
  }
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const guardIndex = order.parts.indexOf('autoqueue/auto-queue-task-advance-guard.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (guardIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-task-advance-guard.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(guardIndex >= 0 && coreIndex >= 0 && guardIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-task-advance-guard.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_TASK_ADVANCE_GUARD_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
