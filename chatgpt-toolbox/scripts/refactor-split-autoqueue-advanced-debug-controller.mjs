import fs from 'node:fs';
import path from 'node:path';
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const ADVANCED_DEBUG_CONTROLLER_FILE = path.join(
  SRC_DIR,
  'autoqueue',
  'auto-queue-advanced-debug-controller.js',
);
function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][MISSING_FILE] file=${filePath}`);
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
  console.log(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}
function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}
function buildModuleText(extractedBlock) {
  return `  /********************************************************************
   * AutoQueueAdvancedDebugController：高级调试面板控制器
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 负责高级调试快照组装、刷新、复制、自动刷新开关、面板 action 分发。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮状态权威判定。
   ********************************************************************/
  const AutoQueueAdvancedDebugController = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const collectSectionSafe = deps.collectSectionSafe;
      const collectPageDebugState = deps.collectPageDebugState;
      const collectAutoQueueDebugState = deps.collectAutoQueueDebugState;
      const collectUploadDebugState = deps.collectUploadDebugState;
      const collectTerminalDebugState = deps.collectTerminalDebugState;
      const collectQuotaDebugState = deps.collectQuotaDebugState;
      const collectTimerDebugState = deps.collectTimerDebugState;
      const collectComposerDebugState = deps.collectComposerDebugState;
      const collectButtonDebugState = deps.collectButtonDebugState;
      const collectReplyDebugState = deps.collectReplyDebugState;
      const buildGroupedAdvancedDebugPanelHtml = deps.buildGroupedAdvancedDebugPanelHtml;
      const createDefaultTaskQueueSettings = deps.createDefaultTaskQueueSettings;
      const saveConfig = deps.saveConfig;
      const getAdvancedDebugHostElement = deps.getAdvancedDebugHostElement;
      const ensureAdvancedDebugPanelDom = deps.ensureAdvancedDebugPanelDom;
      const ensureAdvancedDebugToggleButtonDom = deps.ensureAdvancedDebugToggleButtonDom;
      const syncAdvancedDebugToggleButton = deps.syncAdvancedDebugToggleButton;
      const buildAutoQueueDebugEntryStatusState = deps.buildAutoQueueDebugEntryStatusState;
      const copyWithStatus = deps.copyWithStatus;
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
      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_ADV_DEBUG_CONTROLLER][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }
      function collectSectionSafeSafe(sectionName, collector) {
        return requireFn('collectSectionSafe', collectSectionSafe)(sectionName, collector);
      }
      function collectPageDebugStateSafe() {
        return requireFn('collectPageDebugState', collectPageDebugState)();
      }
      function collectAutoQueueDebugStateSafe() {
        return requireFn('collectAutoQueueDebugState', collectAutoQueueDebugState)();
      }
      function collectUploadDebugStateSafe() {
        return requireFn('collectUploadDebugState', collectUploadDebugState)();
      }
      function collectTerminalDebugStateSafe() {
        return requireFn('collectTerminalDebugState', collectTerminalDebugState)();
      }
      function collectQuotaDebugStateSafe() {
        return requireFn('collectQuotaDebugState', collectQuotaDebugState)();
      }
      function collectTimerDebugStateSafe() {
        return requireFn('collectTimerDebugState', collectTimerDebugState)();
      }
      function collectComposerDebugStateSafe() {
        return requireFn('collectComposerDebugState', collectComposerDebugState)();
      }
      function collectButtonDebugStateSafe() {
        return requireFn('collectButtonDebugState', collectButtonDebugState)();
      }
      function collectReplyDebugStateSafe(options = {}) {
        return requireFn('collectReplyDebugState', collectReplyDebugState)(options);
      }
      function buildGroupedAdvancedDebugPanelHtmlSafe(snapshot) {
        return requireFn(
          'buildGroupedAdvancedDebugPanelHtml',
          buildGroupedAdvancedDebugPanelHtml,
        )(snapshot);
      }
      function createDefaultTaskQueueSettingsSafe() {
        return requireFn(
          'createDefaultTaskQueueSettings',
          createDefaultTaskQueueSettings,
        )();
      }
      function saveConfigSafe() {
        return requireFn('saveConfig', saveConfig)();
      }
      function getAdvancedDebugHostElementSafe() {
        return requireFn('getAdvancedDebugHostElement', getAdvancedDebugHostElement)();
      }
      function ensureAdvancedDebugPanelDomSafe(host) {
        return requireFn('ensureAdvancedDebugPanelDom', ensureAdvancedDebugPanelDom)(host);
      }
      function ensureAdvancedDebugToggleButtonDomSafe(statusState = {}) {
        return requireFn(
          'ensureAdvancedDebugToggleButtonDom',
          ensureAdvancedDebugToggleButtonDom,
        )(statusState);
      }
      function syncAdvancedDebugToggleButtonSafe(statusState = {}) {
        return requireFn(
          'syncAdvancedDebugToggleButton',
          syncAdvancedDebugToggleButton,
        )(statusState);
      }
      function buildAutoQueueDebugEntryStatusStateSafe() {
        return requireFn(
          'buildAutoQueueDebugEntryStatusState',
          buildAutoQueueDebugEntryStatusState,
        )();
      }
      async function copyWithStatusSafe(payload) {
        if (typeof copyWithStatus === 'function') {
          return copyWithStatus(payload);
        }
        if (
          typeof navigator !== 'undefined'
          && navigator.clipboard
          && typeof navigator.clipboard.writeText === 'function'
        ) {
          await navigator.clipboard.writeText(payload && payload.text ? payload.text : '');
          return true;
        }
        throw new Error('clipboard API unavailable');
      }
${extractedBlock
  .replaceAll('collectSectionSafe(', 'collectSectionSafeSafe(')
  .replaceAll('collectPageDebugState', 'collectPageDebugStateSafe')
  .replaceAll('collectAutoQueueDebugState', 'collectAutoQueueDebugStateSafe')
  .replaceAll('collectUploadDebugState', 'collectUploadDebugStateSafe')
  .replaceAll('collectTerminalDebugState', 'collectTerminalDebugStateSafe')
  .replaceAll('collectQuotaDebugState', 'collectQuotaDebugStateSafe')
  .replaceAll('collectTimerDebugState', 'collectTimerDebugStateSafe')
  .replaceAll('collectComposerDebugState', 'collectComposerDebugStateSafe')
  .replaceAll('collectButtonDebugState', 'collectButtonDebugStateSafe')
  .replaceAll('collectReplyDebugState(', 'collectReplyDebugStateSafe(')
  .replaceAll('buildGroupedAdvancedDebugPanelHtml(', 'buildGroupedAdvancedDebugPanelHtmlSafe(')
  .replaceAll('createDefaultTaskQueueSettings()', 'createDefaultTaskQueueSettingsSafe()')
  .replaceAll('saveConfig()', 'saveConfigSafe()')
  .replaceAll('getAdvancedDebugHostElement()', 'getAdvancedDebugHostElementSafe()')
  .replaceAll('ensureAdvancedDebugPanelDom(', 'ensureAdvancedDebugPanelDomSafe(')
  .replaceAll('ensureAdvancedDebugToggleButtonDom(', 'ensureAdvancedDebugToggleButtonDomSafe(')
  .replaceAll('syncAdvancedDebugToggleButton(', 'syncAdvancedDebugToggleButtonSafe(')
  .replaceAll('buildAutoQueueDebugEntryStatusState()', 'buildAutoQueueDebugEntryStatusStateSafe()')
  .replaceAll('typeof copyWithStatus === \'function\'', 'typeof copyWithStatus === \'function\'')
  .replaceAll('copyWithStatus({', 'copyWithStatusSafe({')
  .replaceAll('ToolboxShell.appendLog(', 'appendLogSafe(')
}
      return Object.freeze({
        collectAdvancedDebugSnapshot,
        formatAdvancedDebugSnapshot,
        refreshAdvancedDebugPanel,
        maybeRefreshAdvancedDebugPanel,
        syncAdvancedDebugAutoRefreshButton,
        toggleAdvancedDebugAutoRefresh,
        toggleAdvancedDebugPanel,
        copyAdvancedDebugPanelState,
        handleAdvancedDebugPanelAction,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueAdvancedDebugController = AutoQueueAdvancedDebugController;
`;
}
function buildFacadeBlock() {
  return `    let autoQueueAdvancedDebugControllerApi = null;
    function ensureAutoQueueAdvancedDebugControllerApi() {
      if (autoQueueAdvancedDebugControllerApi) {
        return autoQueueAdvancedDebugControllerApi;
      }
      if (
        typeof AutoQueueAdvancedDebugController === 'undefined'
        || !AutoQueueAdvancedDebugController
        || typeof AutoQueueAdvancedDebugController.create !== 'function'
      ) {
        console.error('[AUTOQ_ADV_DEBUG_CONTROLLER][MISSING] AutoQueueAdvancedDebugController.create is not available');
        return null;
      }
      autoQueueAdvancedDebugControllerApi = AutoQueueAdvancedDebugController.create({
        state,
        config,
        collectSectionSafe,
        collectPageDebugState,
        collectAutoQueueDebugState,
        collectUploadDebugState,
        collectTerminalDebugState,
        collectQuotaDebugState,
        collectTimerDebugState,
        collectComposerDebugState,
        collectButtonDebugState,
        collectReplyDebugState,
        buildGroupedAdvancedDebugPanelHtml,
        createDefaultTaskQueueSettings,
        saveConfig,
        getAdvancedDebugHostElement,
        ensureAdvancedDebugPanelDom,
        ensureAdvancedDebugToggleButtonDom,
        syncAdvancedDebugToggleButton,
        buildAutoQueueDebugEntryStatusState,
        copyWithStatus: typeof copyWithStatus === 'function' ? copyWithStatus : null,
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
      return autoQueueAdvancedDebugControllerApi;
    }
    function requireAutoQueueAdvancedDebugControllerApi(methodName) {
      const api = ensureAutoQueueAdvancedDebugControllerApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_ADV_DEBUG_CONTROLLER][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function collectAdvancedDebugSnapshot(source = 'manual', options = {}) {
      return requireAutoQueueAdvancedDebugControllerApi('collectAdvancedDebugSnapshot')(
        source,
        options,
      );
    }
    function formatAdvancedDebugSnapshot(snapshot) {
      return requireAutoQueueAdvancedDebugControllerApi('formatAdvancedDebugSnapshot')(
        snapshot,
      );
    }
    function refreshAdvancedDebugPanel(source = 'manual', options = {}) {
      return requireAutoQueueAdvancedDebugControllerApi('refreshAdvancedDebugPanel')(
        source,
        options,
      );
    }
    function maybeRefreshAdvancedDebugPanel(source = 'render') {
      return requireAutoQueueAdvancedDebugControllerApi('maybeRefreshAdvancedDebugPanel')(
        source,
      );
    }
    function syncAdvancedDebugAutoRefreshButton() {
      return requireAutoQueueAdvancedDebugControllerApi('syncAdvancedDebugAutoRefreshButton')();
    }
    function toggleAdvancedDebugAutoRefresh() {
      return requireAutoQueueAdvancedDebugControllerApi('toggleAdvancedDebugAutoRefresh')();
    }
    function toggleAdvancedDebugPanel() {
      return requireAutoQueueAdvancedDebugControllerApi('toggleAdvancedDebugPanel')();
    }
    async function copyAdvancedDebugPanelState() {
      return requireAutoQueueAdvancedDebugControllerApi('copyAdvancedDebugPanelState')();
    }
    function handleAdvancedDebugPanelAction(action) {
      return requireAutoQueueAdvancedDebugControllerApi('handleAdvancedDebugPanelAction')(
        action,
      );
    }
`;
}
function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);
  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function collectAdvancedDebugSnapshot(source = \'manual\', options = {}) {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    let autoQueueStatusRendererApi = null;', AUTOQUEUE_CORE_FILE);
  if (source.includes('let autoQueueAdvancedDebugControllerApi = null;')) {
    throw new Error('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][ALREADY_PATCHED] autoQueueAdvancedDebugControllerApi already exists');
  }
  const startMarker = '    function collectAdvancedDebugSnapshot(source = \'manual\', options = {}) {';
  const endMarker = '    let autoQueueStatusRendererApi = null;';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][RANGE_INVALID]');
  }
  const extractedBlock = source.slice(startIndex, endIndex).trimEnd() + '\n';
  const requiredMarkers = [
    'function collectAdvancedDebugSnapshot',
    'function formatAdvancedDebugSnapshot',
    'function refreshAdvancedDebugPanel',
    'function maybeRefreshAdvancedDebugPanel',
    'function syncAdvancedDebugAutoRefreshButton',
    'function toggleAdvancedDebugAutoRefresh',
    'function toggleAdvancedDebugPanel',
    'async function copyAdvancedDebugPanelState',
    'function handleAdvancedDebugPanelAction',
  ];
  const missingMarkers = requiredMarkers.filter((marker) => !extractedBlock.includes(marker));
  if (missingMarkers.length > 0) {
    throw new Error(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][RANGE_MISSING] missing=${missingMarkers.join(',')}`);
  }
  const before = source.slice(0, startIndex).replace(/\s*$/, '\n\n');
  const after = source.slice(endIndex);
  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(ADVANCED_DEBUG_CONTROLLER_FILE, buildModuleText(extractedBlock));
  writeText(AUTOQUEUE_CORE_FILE, before + buildFacadeBlock() + after);
  console.log('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][CORE_PATCHED]', {
    removedChars: extractedBlock.length,
  });
}
function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }
  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-advanced-debug-controller.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }
  let insertIndex = coreIndex;
  const debugSectionsIndex = parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js');
  const debugCollectorIndex = parts.indexOf('autoqueue/auto-queue-debug-collector.js');
  const advancedDebugPanelIndex = parts.indexOf('autoqueue/auto-queue-advanced-debug-panel.js');
  if (debugSectionsIndex >= 0) {
    insertIndex = debugSectionsIndex + 1;
  } else if (debugCollectorIndex >= 0) {
    insertIndex = debugCollectorIndex + 1;
  } else if (advancedDebugPanelIndex >= 0) {
    insertIndex = advancedDebugPanelIndex + 1;
  }
  parts.splice(insertIndex, 0, 'autoqueue/auto-queue-advanced-debug-controller.js');
  config.parts = parts;
  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][BUILD_ORDER_OK]', {
    advancedDebugControllerIndex: parts.indexOf('autoqueue/auto-queue-advanced-debug-controller.js'),
    debugSectionsIndex: parts.indexOf('autoqueue/auto-queue-debug-snapshot-sections.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}
function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(ADVANCED_DEBUG_CONTROLLER_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];
  if (!core.includes('let autoQueueAdvancedDebugControllerApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueAdvancedDebugControllerApi facade');
  }
  if (!core.includes("requireAutoQueueAdvancedDebugControllerApi('refreshAdvancedDebugPanel')")) {
    failures.push('auto-queue-core.js refreshAdvancedDebugPanel is not delegated');
  }
  if (core.includes('state.advancedDebugLastSnapshot = snapshot')) {
    failures.push('auto-queue-core.js still contains full collectAdvancedDebugSnapshot implementation');
  }
  if (!core.includes('let autoQueueStatusRendererApi = null;')) {
    failures.push('auto-queue-core.js lost autoQueueStatusRendererApi');
  }
  if (!moduleText.includes('const AutoQueueAdvancedDebugController = (() => {')) {
    failures.push('auto-queue-advanced-debug-controller.js missing module');
  }
  [
    'function collectAdvancedDebugSnapshot',
    'function formatAdvancedDebugSnapshot',
    'function refreshAdvancedDebugPanel',
    'function maybeRefreshAdvancedDebugPanel',
    'function syncAdvancedDebugAutoRefreshButton',
    'function toggleAdvancedDebugAutoRefresh',
    'function toggleAdvancedDebugPanel',
    'async function copyAdvancedDebugPanelState',
    'function handleAdvancedDebugPanelAction',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-advanced-debug-controller.js missing ${marker}`);
    }
  });
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const controllerIndex = order.parts.indexOf('autoqueue/auto-queue-advanced-debug-controller.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (controllerIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-advanced-debug-controller.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(controllerIndex >= 0 && coreIndex >= 0 && controllerIndex < coreIndex)) {
      failures.push('autoqueue/auto-queue-advanced-debug-controller.js must be before autoqueue/auto-queue-core.js');
    }
  }
  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }
  console.log('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][VERIFY_OK]');
}
function main() {
  console.log(`[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][START] root=${ROOT_DIR}`);
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][DONE]');
}
try {
  main();
} catch (error) {
  console.error('[AUTOQ_ADV_DEBUG_CONTROLLER_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
