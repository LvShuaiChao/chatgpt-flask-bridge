import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const UPLOAD_MODULE_FILE = path.join(SRC_DIR, 'upload', 'upload-module.js');
const UPLOAD_SAFE_ADAPTERS_FILE = path.join(SRC_DIR, 'upload', 'upload-safe-adapters.js');
const UPLOAD_SEND_TASK_STATE_FILE = path.join(SRC_DIR, 'upload', 'upload-send-task-state.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[UPLOAD_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[UPLOAD_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[UPLOAD_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function findMatchingFunctionEnd(text, functionStartIndex) {
  const firstBrace = text.indexOf('{', functionStartIndex);
  if (firstBrace < 0) {
    throw new Error(`[UPLOAD_SPLIT][FUNCTION_BRACE_NOT_FOUND] index=${functionStartIndex}`);
  }
  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = firstBrace; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1] || '';
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString || inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inString && ch === stringQuote) {
        inString = false;
        stringQuote = '';
        continue;
      }
      if (inTemplate && ch === '`') {
        inTemplate = false;
        continue;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  throw new Error(`[UPLOAD_SPLIT][FUNCTION_END_NOT_FOUND] index=${functionStartIndex}`);
}

function extractSafeAdapters() {
  const source = readText(UPLOAD_MODULE_FILE);
  const startMarker = '    function formatUploadErrorStack(error) {';
  const endFunctionMarker = '    function auditUploadModuleDependencies(source = \'\') {';
  assertContains(source, startMarker, UPLOAD_MODULE_FILE);
  assertContains(source, endFunctionMarker, UPLOAD_MODULE_FILE);
  const startIndex = source.indexOf(startMarker);
  const endFunctionIndex = source.indexOf(endFunctionMarker, startIndex);
  const endIndex = findMatchingFunctionEnd(source, endFunctionIndex);
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const extracted = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const after = source.slice(endIndex).replace(/^\s*/, '\n');
  const requiredNames = [
    'function formatUploadErrorStack',
    'function getStableButtonText',
    'function markUploadActionButtonStableLabel',
    'function safeFormatFileSize',
    'function safeDownloadJson',
    'function safeReadJsonFile',
    'function auditUploadModuleDependencies',
  ];
  const missing = requiredNames.filter((name) => !extracted.includes(name));
  if (missing.length > 0) {
    throw new Error(`[UPLOAD_SPLIT][SAFE_ADAPTERS_INVALID] missing=${missing.join(',')}`);
  }
  const newModule = [
    '  /********************************************************************',
    '   * UploadSafeAdapters：UploadModule 通用安全适配器',
    '   *',
    '   * 说明：',
    '   * 1. 从 upload-module.js 拆出。',
    '   * 2. 保留原函数名，避免改动调用方。',
    '   * 3. 本文件只放通用工具适配，不放上传流程、不放闭环、不放按钮状态机。',
    '   ********************************************************************/',
    '',
    extracted,
  ].join('\n');
  backupFile(UPLOAD_MODULE_FILE);
  writeText(UPLOAD_SAFE_ADAPTERS_FILE, newModule);
  writeText(UPLOAD_MODULE_FILE, before + after);
  console.log(`[UPLOAD_SPLIT][SAFE_ADAPTERS_OK] chars=${extracted.length}`);
}

function writeUploadSendTaskStateModule() {
  const moduleText = `  /********************************************************************
   * UploadSendTaskState：发送任务 canonical state 纯函数
   *
   * 说明：
   * 1. 从 upload-module.js 拆出。
   * 2. 只负责 phase/subPhase 归一化和 canonical task 快照构造。
   * 3. 不读写 DOM，不读写按钮，不读写上传队列，不修改闭环状态。
   ********************************************************************/
  const UploadSendTaskState = (() => {
    const CANONICAL_SEND_PHASES = Object.freeze({
      IDLE: 'idle',
      WAITING_SEND: 'waiting_send',
      SENDING: 'sending',
      WAITING_REPLY: 'waiting_reply',
      SUCCESS: 'success',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    });

    function nowForTaskState() {
      return Date.now();
    }

    function createIdleCanonicalSendTask(extra = {}) {
      const ts = nowForTaskState();
      return {
        running: false,
        phase: CANONICAL_SEND_PHASES.IDLE,
        subPhase: '',
        action: '',
        ownerButtonId: '',
        runId: '',
        reason: '',
        error: '',
        cancelRequested: false,
        abortController: null,
        startedAt: 0,
        updatedAt: ts,
        finishedAt: 0,
        ...extra,
      };
    }

    function normalizeCanonicalSendPhase(phase) {
      const value = String(phase || '').trim().toLowerCase();
      if (
        value === CANONICAL_SEND_PHASES.IDLE
        || value === CANONICAL_SEND_PHASES.WAITING_SEND
        || value === CANONICAL_SEND_PHASES.SENDING
        || value === CANONICAL_SEND_PHASES.WAITING_REPLY
        || value === CANONICAL_SEND_PHASES.SUCCESS
        || value === CANONICAL_SEND_PHASES.FAILED
        || value === CANONICAL_SEND_PHASES.CANCELLED
      ) {
        return value;
      }
      if (
        value === 'waiting'
        || value === 'waiting_input'
        || value === 'waiting_attachment'
        || value === 'waiting_page_reply_to_send'
        || value === 'ready_to_click'
        || value === 'waiting_composer'
        || value === 'writing_text'
        || value === 'preparing'
        || value === 'checking_composer'
      ) {
        return CANONICAL_SEND_PHASES.WAITING_SEND;
      }
      if (
        value === 'clicking_send'
        || value === 'sending_hotkey'
        || value === 'sending_continue'
        || value === 'confirming_clipboard'
        || value === 'copying'
        || value === 'running'
      ) {
        return CANONICAL_SEND_PHASES.SENDING;
      }
      if (
        value === 'sent_waiting_response'
        || value === 'waiting_reply'
        || value === 'stopping_response'
      ) {
        return CANONICAL_SEND_PHASES.WAITING_REPLY;
      }
      if (value === 'success' || value === 'done' || value === 'completed') {
        return CANONICAL_SEND_PHASES.SUCCESS;
      }
      if (value === 'fail' || value === 'failed' || value === 'error') {
        return CANONICAL_SEND_PHASES.FAILED;
      }
      if (value === 'cancel' || value === 'cancelled' || value === 'canceled') {
        return CANONICAL_SEND_PHASES.CANCELLED;
      }
      return CANONICAL_SEND_PHASES.IDLE;
    }

    function normalizeCanonicalSendSubPhase(phase, subPhase) {
      const rawSubPhase = String(subPhase || '').trim();
      if (rawSubPhase) {
        return rawSubPhase;
      }
      const rawPhase = String(phase || '').trim().toLowerCase();
      if (!rawPhase) {
        return '';
      }
      const normalizedPhase = normalizeCanonicalSendPhase(rawPhase);
      if (rawPhase !== normalizedPhase) {
        return rawPhase;
      }
      return '';
    }

    function isCanonicalSendTaskRunning(task) {
      if (!task || typeof task !== 'object') {
        return false;
      }
      const phase = normalizeCanonicalSendPhase(task.phase);
      if (phase === CANONICAL_SEND_PHASES.IDLE) {
        return false;
      }
      if (
        phase === CANONICAL_SEND_PHASES.SUCCESS
        || phase === CANONICAL_SEND_PHASES.FAILED
        || phase === CANONICAL_SEND_PHASES.CANCELLED
      ) {
        return false;
      }
      return task.running === true;
    }

    function buildCanonicalSendTaskFromRaw(rawTask = {}, extra = {}) {
      const ts = nowForTaskState();
      const source = rawTask && typeof rawTask === 'object' ? rawTask : {};
      const rawPhase = source.phase;
      const rawSubPhase = source.subPhase;
      const phase = normalizeCanonicalSendPhase(rawPhase);
      const subPhase = normalizeCanonicalSendSubPhase(rawPhase, rawSubPhase);
      const running = (
        source.running === true
        || (
          phase !== CANONICAL_SEND_PHASES.IDLE
          && phase !== CANONICAL_SEND_PHASES.SUCCESS
          && phase !== CANONICAL_SEND_PHASES.FAILED
          && phase !== CANONICAL_SEND_PHASES.CANCELLED
        )
      );
      return {
        running,
        phase,
        subPhase,
        action: String(source.action || extra.action || ''),
        ownerButtonId: String(source.ownerButtonId || extra.ownerButtonId || ''),
        runId: String(source.runId || extra.runId || ''),
        reason: String(source.reason || extra.reason || ''),
        error: String(source.error || extra.error || ''),
        cancelRequested: source.cancelRequested === true || extra.cancelRequested === true,
        abortController: source.abortController || extra.abortController || null,
        startedAt: Number(source.startedAt || extra.startedAt || 0),
        updatedAt: Number(source.updatedAt || extra.updatedAt || ts),
        finishedAt: Number(source.finishedAt || extra.finishedAt || 0),
      };
    }

    return Object.freeze({
      CANONICAL_SEND_PHASES,
      nowForTaskState,
      createIdleCanonicalSendTask,
      normalizeCanonicalSendPhase,
      normalizeCanonicalSendSubPhase,
      isCanonicalSendTaskRunning,
      buildCanonicalSendTaskFromRaw,
    });
  })();

  globalThis.UploadSendTaskState = UploadSendTaskState;
`;
  writeText(UPLOAD_SEND_TASK_STATE_FILE, moduleText);
  console.log('[UPLOAD_SPLIT][SEND_TASK_STATE_MODULE_OK]');
}

function replaceCanonicalSendTaskPureLogic() {
  const source = readText(UPLOAD_MODULE_FILE);
  const startMarker = '    const CANONICAL_SEND_PHASES = Object.freeze({';
  const endMarker = '    function getCanonicalSendTaskState() {';
  assertContains(source, startMarker, UPLOAD_MODULE_FILE);
  assertContains(source, endMarker, UPLOAD_MODULE_FILE);
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (endIndex <= startIndex) {
    throw new Error('[UPLOAD_SPLIT][CANONICAL_BLOCK_INVALID_ORDER]');
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const removed = source.slice(startIndex, endIndex);
  const after = source.slice(endIndex);
  const required = [
    'const CANONICAL_SEND_PHASES',
    'function nowForTaskState',
    'function createIdleCanonicalSendTask',
    'function normalizeCanonicalSendPhase',
    'function normalizeCanonicalSendSubPhase',
    'function isCanonicalSendTaskRunning',
    'function buildCanonicalSendTaskFromRaw',
  ];
  const missing = required.filter((item) => !removed.includes(item));
  if (missing.length > 0) {
    throw new Error(`[UPLOAD_SPLIT][CANONICAL_BLOCK_INVALID] missing=${missing.join(',')}`);
  }
  const replacement = `    const uploadSendTaskStateApi = (() => {
      const api = typeof globalThis !== 'undefined' ? globalThis.UploadSendTaskState : null;
      if (!api || typeof api !== 'object') {
        console.error('[UPLOAD_SEND_TASK_STATE][MISSING]', {
          reason: 'UploadSendTaskState module is not loaded before upload-module.js',
        });
        return null;
      }
      return api;
    })();
    const CANONICAL_SEND_PHASES = uploadSendTaskStateApi && uploadSendTaskStateApi.CANONICAL_SEND_PHASES
      ? uploadSendTaskStateApi.CANONICAL_SEND_PHASES
      : Object.freeze({
          IDLE: 'idle',
          WAITING_SEND: 'waiting_send',
          SENDING: 'sending',
          WAITING_REPLY: 'waiting_reply',
          SUCCESS: 'success',
          FAILED: 'failed',
          CANCELLED: 'cancelled',
        });
    function requireUploadSendTaskStateApi(methodName) {
      const api = uploadSendTaskStateApi;
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[UPLOAD_SEND_TASK_STATE][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function nowForTaskState() {
      return requireUploadSendTaskStateApi('nowForTaskState')();
    }
    function createIdleCanonicalSendTask(extra = {}) {
      return requireUploadSendTaskStateApi('createIdleCanonicalSendTask')(extra);
    }
    function normalizeCanonicalSendPhase(phase) {
      return requireUploadSendTaskStateApi('normalizeCanonicalSendPhase')(phase);
    }
    function normalizeCanonicalSendSubPhase(phase, subPhase) {
      return requireUploadSendTaskStateApi('normalizeCanonicalSendSubPhase')(phase, subPhase);
    }
    function isCanonicalSendTaskRunning(task) {
      return requireUploadSendTaskStateApi('isCanonicalSendTaskRunning')(task);
    }
    function buildCanonicalSendTaskFromRaw(rawTask = {}, extra = {}) {
      return requireUploadSendTaskStateApi('buildCanonicalSendTaskFromRaw')(rawTask, extra);
    }
`;
  writeText(UPLOAD_MODULE_FILE, before + replacement + after);
  console.log(`[UPLOAD_SPLIT][CANONICAL_SEND_TASK_STATE_OK] removedChars=${removed.length}`);
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[UPLOAD_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  if (!parts.includes('upload/upload-module.js')) {
    throw new Error('[UPLOAD_SPLIT][BUILD_ORDER_INVALID] missing upload/upload-module.js');
  }
  parts = parts.filter((item) => (
    item !== 'upload/upload-safe-adapters.js'
    && item !== 'upload/upload-send-task-state.js'
  ));
  const uploadModuleIndex = parts.indexOf('upload/upload-module.js');
  parts.splice(
    uploadModuleIndex,
    0,
    'upload/upload-safe-adapters.js',
    'upload/upload-send-task-state.js',
  );
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[UPLOAD_SPLIT][BUILD_ORDER_OK]');
}

function verifyResult() {
  const uploadModule = readText(UPLOAD_MODULE_FILE);
  const safeAdapters = readText(UPLOAD_SAFE_ADAPTERS_FILE);
  const sendTaskState = readText(UPLOAD_SEND_TASK_STATE_FILE);
  const buildOrder = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  [
    'function formatUploadErrorStack',
    'function safeFormatFileSize',
    'function safeDownloadJson',
    'function safeReadJsonFile',
    'function auditUploadModuleDependencies',
  ].forEach((name) => {
    if (uploadModule.includes(name)) {
      failures.push(`upload-module.js still contains ${name}`);
    }
    if (!safeAdapters.includes(name)) {
      failures.push(`upload-safe-adapters.js missing ${name}`);
    }
  });
  if (!sendTaskState.includes('const UploadSendTaskState = (() => {')) {
    failures.push('upload-send-task-state.js missing UploadSendTaskState module');
  }
  if (!uploadModule.includes('const uploadSendTaskStateApi = (() => {')) {
    failures.push('upload-module.js missing uploadSendTaskStateApi facade');
  }
  if (!uploadModule.includes("requireUploadSendTaskStateApi('normalizeCanonicalSendPhase')")) {
    failures.push('upload-module.js normalizeCanonicalSendPhase is not delegated');
  }
  if (!Array.isArray(buildOrder.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const parts = buildOrder.parts;
    const safeIndex = parts.indexOf('upload/upload-safe-adapters.js');
    const stateIndex = parts.indexOf('upload/upload-send-task-state.js');
    const moduleIndex = parts.indexOf('upload/upload-module.js');
    if (safeIndex < 0) {
      failures.push('.build-order.json missing upload/upload-safe-adapters.js');
    }
    if (stateIndex < 0) {
      failures.push('.build-order.json missing upload/upload-send-task-state.js');
    }
    if (moduleIndex < 0) {
      failures.push('.build-order.json missing upload/upload-module.js');
    }
    if (!(safeIndex >= 0 && safeIndex < moduleIndex)) {
      failures.push('upload/upload-safe-adapters.js must be before upload/upload-module.js');
    }
    if (!(stateIndex >= 0 && stateIndex < moduleIndex)) {
      failures.push('upload/upload-send-task-state.js must be before upload/upload-module.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[UPLOAD_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[UPLOAD_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[UPLOAD_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[UPLOAD_SPLIT][START] root=${ROOT_DIR}`);
  extractSafeAdapters();
  writeUploadSendTaskStateModule();
  replaceCanonicalSendTaskPureLogic();
  updateBuildOrder();
  verifyResult();
  console.log('[UPLOAD_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[UPLOAD_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
