import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const ADVANCED_DEBUG_PANEL_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-advanced-debug-panel.js');
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueAdvancedDebugPanel：自动队列高级调试面板 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责高级调试面板的分组、行渲染、JSON 展示。
   * 3. 不负责按钮插入、不负责按钮绑定、不负责状态采集、不负责发送/上传/闭环。
   ********************************************************************/
  const AutoQueueAdvancedDebugPanel = (() => {
    function create(deps = {}) {
      const escapeHtml = deps.escapeHtml;
      const appendLog = deps.appendLog;
      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_ADV_DEBUG_PANEL][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
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
${extractedBlock
  .replaceAll('escapeHtml(', 'escapeHtmlSafe(')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
}
      return Object.freeze({
        renderAutoQueueAdvancedDebugSection,
        describeElementDebugRow,
        buildGroupedAdvancedDebugPanelHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueAdvancedDebugPanel = AutoQueueAdvancedDebugPanel;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueAdvancedDebugPanelApi = null;
    function ensureAutoQueueAdvancedDebugPanelApi() {
      if (autoQueueAdvancedDebugPanelApi) {
        return autoQueueAdvancedDebugPanelApi;
      }
      if (
        typeof AutoQueueAdvancedDebugPanel === 'undefined'
        || !AutoQueueAdvancedDebugPanel
        || typeof AutoQueueAdvancedDebugPanel.create !== 'function'
      ) {
        console.error('[AUTOQ_ADV_DEBUG_PANEL][MISSING] AutoQueueAdvancedDebugPanel.create is not available');
        return null;
      }
      autoQueueAdvancedDebugPanelApi = AutoQueueAdvancedDebugPanel.create({
        escapeHtml,
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
      return autoQueueAdvancedDebugPanelApi;
    }
    function requireAutoQueueAdvancedDebugPanelApi(methodName) {
      const api = ensureAutoQueueAdvancedDebugPanelApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_ADV_DEBUG_PANEL][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function renderAutoQueueAdvancedDebugSection(title, rows) {
      return requireAutoQueueAdvancedDebugPanelApi('renderAutoQueueAdvancedDebugSection')(
        title,
        rows,
      );
    }
    function describeElementDebugRow(prefix, info) {
      return requireAutoQueueAdvancedDebugPanelApi('describeElementDebugRow')(
        prefix,
        info,
      );
    }
    function buildGroupedAdvancedDebugPanelHtml(snapshot) {
      return requireAutoQueueAdvancedDebugPanelApi('buildGroupedAdvancedDebugPanelHtml')(
        snapshot,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function renderAutoQueueAdvancedDebugSection(title, rows) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function ensureAdvancedDebugToggleButtonDom(statusState = {}) {', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueAdvancedDebugPanelApi = null;')) {
    throw new Error('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][ALREADY_PATCHED] autoQueueAdvancedDebugPanelApi already exists');
  }
  const startMarker = '    function renderAutoQueueAdvancedDebugSection(title, rows) {';
  const endMarker = '    function ensureAdvancedDebugToggleButtonDom(statusState = {}) {';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function renderAutoQueueAdvancedDebugSection',
    'function describeElementDebugRow',
    'function buildGroupedAdvancedDebugPanelHtml',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(ADVANCED_DEBUG_PANEL_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-advanced-debug-panel.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const batchStatusPanelIndex = parts.indexOf('autoqueue/auto-queue-batch-status-panel.js');
  const statusRendererIndex = parts.indexOf('autoqueue/auto-queue-status-renderer.js');
  const displayStateIndex = parts.indexOf('autoqueue/auto-queue-display-state.js');
  if (batchStatusPanelIndex >= 0) {
    insertIndex = batchStatusPanelIndex + 1;
  } else if (statusRendererIndex >= 0) {
    insertIndex = statusRendererIndex + 1;
  } else if (displayStateIndex >= 0) {
    insertIndex = displayStateIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-advanced-debug-panel.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][BUILD_ORDER_OK]', {
    advancedDebugPanelIndex: parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js'),
    batchStatusPanelIndex: parts.indexOf('autoqueue/auto-queue-batch-status-panel.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(ADVANCED_DEBUG_PANEL_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueAdvancedDebugPanelApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueAdvancedDebugPanelApi facade');
  }
  if (!core.includes("requireAutoQueueAdvancedDebugPanelApi('buildGroupedAdvancedDebugPanelHtml')")) {
    failures.push('auto-queue-core.js buildGroupedAdvancedDebugPanelHtml is not delegated');
  }
  if (
    core.includes('function buildGroupedAdvancedDebugPanelHtml(snapshot)')
    && core.includes('xz-autoq-debug-section')
  ) {
    failures.push('auto-queue-core.js still contains full grouped advanced debug panel implementation');
  }
  if (!core.includes('function ensureAdvancedDebugToggleButtonDom(statusState = {})')) {
    failures.push('auto-queue-core.js lost ensureAdvancedDebugToggleButtonDom');
  }
  if (!moduleText.includes('const AutoQueueAdvancedDebugPanel = (() => {')) {
    failures.push('auto-queue-advanced-debug-panel.js missing AutoQueueAdvancedDebugPanel module');
  }
  [
    'function renderAutoQueueAdvancedDebugSection',
    'function describeElementDebugRow',
    'function buildGroupedAdvancedDebugPanelHtml',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-advanced-debug-panel.js missing ${marker}`);
    }
  });
  if (!moduleText.includes('escapeHtmlSafe(')) {
    failures.push('auto-queue-advanced-debug-panel.js must use escapeHtmlSafe');
  }
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const panelIndex = order.parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (panelIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-advanced-debug-panel.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(panelIndex >= 0 && coreIndex >= 0 && panelIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-advanced-debug-panel.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_ADV_DEBUG_PANEL_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_ADV_DEBUG_PANEL_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
