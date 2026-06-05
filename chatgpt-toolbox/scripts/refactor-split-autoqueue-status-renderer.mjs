import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const STATUS_RENDERER_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-status-renderer.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_STATUS_RENDERER_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_STATUS_RENDERER_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_STATUS_RENDERER_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function buildStatusRendererModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueStatusRenderer：自动队列状态项格式化与 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责状态项数值格式化、tone 判断、状态项 HTML 拼接。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态判定。
   ********************************************************************/
  const AutoQueueStatusRenderer = (() => {
    function create(deps = {}) {
      const escapeHtml = deps.escapeHtml;

      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_STATUS_RENDERER][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

${extractedBlock.replaceAll('escapeHtml(', 'escapeHtmlSafe(')}

      return Object.freeze({
        formatStatusFraction,
        formatQuotaDisplayText,
        resolveAutoqStatusValueTone,
        renderAutoqStatusItem,
        renderAutoqStatusItems,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueStatusRenderer = AutoQueueStatusRenderer;
`;
}

function buildFacadeBlock() {
  return `    let autoQueueStatusRendererApi = null;

    function ensureAutoQueueStatusRendererApi() {
      if (autoQueueStatusRendererApi) {
        return autoQueueStatusRendererApi;
      }
      if (
        typeof AutoQueueStatusRenderer === 'undefined'
        || !AutoQueueStatusRenderer
        || typeof AutoQueueStatusRenderer.create !== 'function'
      ) {
        console.error('[AUTOQ_STATUS_RENDERER][MISSING] AutoQueueStatusRenderer.create is not available');
        return null;
      }
      autoQueueStatusRendererApi = AutoQueueStatusRenderer.create({
        escapeHtml,
      });
      return autoQueueStatusRendererApi;
    }

    function requireAutoQueueStatusRendererApi(methodName) {
      const api = ensureAutoQueueStatusRendererApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_STATUS_RENDERER][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }

    function formatStatusFraction(numerator, denominator) {
      return requireAutoQueueStatusRendererApi('formatStatusFraction')(
        numerator,
        denominator,
      );
    }

    function formatQuotaDisplayText(display) {
      return requireAutoQueueStatusRendererApi('formatQuotaDisplayText')(display);
    }

    function resolveAutoqStatusValueTone(value, options = {}) {
      return requireAutoQueueStatusRendererApi('resolveAutoqStatusValueTone')(
        value,
        options,
      );
    }

    function renderAutoqStatusItem(label, value, options = {}) {
      return requireAutoQueueStatusRendererApi('renderAutoqStatusItem')(
        label,
        value,
        options,
      );
    }

    function renderAutoqStatusItems(items) {
      return requireAutoQueueStatusRendererApi('renderAutoqStatusItems')(items);
    }

`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function formatStatusFraction(numerator, denominator) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function buildTaskPageRotateProgressText(progressSnapshot) {', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueStatusRendererApi = null;')) {
    throw new Error('[AUTOQ_STATUS_RENDERER_SPLIT][ALREADY_PATCHED] autoQueueStatusRendererApi already exists');
  }

  const startMarker = '    function formatStatusFraction(numerator, denominator) {';
  const endMarker = '    function buildTaskPageRotateProgressText(progressSnapshot) {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_STATUS_RENDERER_SPLIT][RANGE_INVALID]');
  }

  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';

  const requiredMarkers = [
    'function formatStatusFraction',
    'function formatQuotaDisplayText',
    'function resolveAutoqStatusValueTone',
    'function renderAutoqStatusItem',
    'function renderAutoqStatusItems',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_STATUS_RENDERER_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }

  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(STATUS_RENDERER_FILE, buildStatusRendererModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);

  console.log('[AUTOQ_STATUS_RENDERER_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_STATUS_RENDERER_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-status-renderer.js');

  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_STATUS_RENDERER_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  let insertIndex = coreIndex;
  const displayStateIndex = parts.indexOf('autoqueue/auto-queue-display-state.js');
  const modeSettingsIndex = parts.indexOf('autoqueue/auto-queue-mode-settings.js');
  const taskProfileIndex = parts.indexOf('autoqueue/auto-queue-task-profile-config.js');
  if (displayStateIndex >= 0) {
    insertIndex = displayStateIndex + 1;
  } else if (modeSettingsIndex >= 0) {
    insertIndex = modeSettingsIndex + 1;
  } else if (taskProfileIndex >= 0) {
    insertIndex = taskProfileIndex + 1;
  }

  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-status-renderer.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log('[AUTOQ_STATUS_RENDERER_SPLIT][BUILD_ORDER_OK]', {
    statusRendererIndex: parts.indexOf('autoqueue/auto-queue-status-renderer.js'),
    displayStateIndex: parts.indexOf('autoqueue/auto-queue-display-state.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(STATUS_RENDERER_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueStatusRendererApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueStatusRendererApi facade');
  }
  if (!core.includes("requireAutoQueueStatusRendererApi('renderAutoqStatusItem')")) {
    failures.push('auto-queue-core.js renderAutoqStatusItem is not delegated');
  }
  if (
    core.includes('function formatStatusFraction(numerator, denominator)')
    && core.includes('Number(numerator) || 0')
  ) {
    failures.push('auto-queue-core.js still contains full formatStatusFraction implementation');
  }
  if (!core.includes('function buildTaskPageRotateProgressText(progressSnapshot)')) {
    failures.push('auto-queue-core.js lost buildTaskPageRotateProgressText');
  }
  if (!moduleText.includes('const AutoQueueStatusRenderer = (() => {')) {
    failures.push('auto-queue-status-renderer.js missing AutoQueueStatusRenderer module');
  }
  [
    'function formatStatusFraction',
    'function formatQuotaDisplayText',
    'function resolveAutoqStatusValueTone',
    'function renderAutoqStatusItem',
    'function renderAutoqStatusItems',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-status-renderer.js missing ${marker}`);
    }
  });
  if (!moduleText.includes('escapeHtmlSafe(')) {
    failures.push('auto-queue-status-renderer.js must use escapeHtmlSafe');
  }

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const statusRendererIndex = order.parts.indexOf('autoqueue/auto-queue-status-renderer.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (statusRendererIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-status-renderer.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(statusRendererIndex >= 0 && coreIndex >= 0 && statusRendererIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-status-renderer.js must be before autoqueue/auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_STATUS_RENDERER_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_STATUS_RENDERER_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_STATUS_RENDERER_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_STATUS_RENDERER_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_STATUS_RENDERER_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_STATUS_RENDERER_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
