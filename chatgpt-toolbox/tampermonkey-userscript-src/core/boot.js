/********************************************************************
 * 初始化入口：创建工具箱壳并挂载各功能模块
 ********************************************************************/

const CGPT_TOOLBOX_INSTANCE_KEY = '__cgpt_toolbox_active_instance__';
const TOOLBOX_SCRIPT_VERSION = '3.6.7';
const BOOT_ERROR_GRACE_MS = 2000;
const MODULE_FAIL_THRESHOLD = 3;
const MODULE_RECOVER_THRESHOLD = 2;

const MODULE_NAMES = Object.freeze([
  'UploadModule',
  'AutoQueueModule',
  'PromptManagerModule',
  'BridgeModule',
  'ExportModule',
  'LogModule',
  'SettingsModule',
]);

const ToolboxBootRuntime = {
  bootStartedAt: 0,
  bootCompleteToastShown: false,
  bootCompleteAt: 0,
  moduleHealth: {},
};
if (typeof globalThis !== 'undefined') {
  globalThis.__CGPT_TOOLBOX_MODULE_HEALTH__ = ToolboxBootRuntime.moduleHealth;
  globalThis.__CGPT_TOOLBOX_VERSION__ = TOOLBOX_SCRIPT_VERSION;
  globalThis.__CGPT_TOOLBOX_DIAG__ = () => {
    const instance = (typeof window !== 'undefined' && window[CGPT_TOOLBOX_INSTANCE_KEY])
      ? window[CGPT_TOOLBOX_INSTANCE_KEY]
      : null;
    const bootStartedAt = Number(ToolboxBootRuntime.bootStartedAt || 0);
    const bootCompleteAt = Number(ToolboxBootRuntime.bootCompleteAt || 0);
    return {
      version: TOOLBOX_SCRIPT_VERSION,
      instanceId: instance && instance.instanceId ? instance.instanceId : '',
      startedAt: instance && instance.startedAt ? instance.startedAt : 0,
      bootStartedAt,
      bootCompleteAt,
      bootStartedAtIso: bootStartedAt > 0 ? new Date(bootStartedAt).toISOString() : '',
      bootCompleteAtIso: bootCompleteAt > 0 ? new Date(bootCompleteAt).toISOString() : '',
    };
  };
}

function ensureModuleHealthRecord(moduleName) {
  const key = String(moduleName || '').trim();
  if (!key) {
    return null;
  }

  if (!ToolboxBootRuntime.moduleHealth[key]) {
    ToolboxBootRuntime.moduleHealth[key] = {
      ok: true,
      lastError: '',
      failCount: 0,
      successCount: 0,
      lastOkAt: 0,
      lastFailAt: 0,
    };
  }

  return ToolboxBootRuntime.moduleHealth[key];
}

function getModuleNameFromInitStepName(stepName) {
  const moduleMatch = String(stepName || '').match(/^(\w+)\.mount:/);
  return moduleMatch ? moduleMatch[1] : '';
}

function shouldTreatModuleErrorAsTransient(now = Date.now()) {
  if (!(ToolboxBootRuntime.bootStartedAt > 0)) {
    return false;
  }
  return now - ToolboxBootRuntime.bootStartedAt < BOOT_ERROR_GRACE_MS;
}

function getModuleHealthSummary() {
  return MODULE_NAMES
    .map((name) => {
      const item = ensureModuleHealthRecord(name);
      if (!item) {
        return `${name}:na`;
      }
      return `${name}:ok=${item.ok ? 1 : 0},fail=${item.failCount},succ=${item.successCount}`;
    })
    .join('|');
}

function logModuleHealth(reason = '') {
  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
    ToolboxShell.appendLog(
      `[TOOLBOX_MODULES][HEALTH_UPDATE] reason=${String(reason || '-')} state=${getModuleHealthSummary()}`,
    );
  }
}

function isModuleHealthDebugEnabled() {
  try {
    if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
      if (MemoryManager.get('moduleHealthDebugEnabled', false)) {
        return true;
      }
      if (MemoryManager.get('bridgeDebugEnabled', false)) {
        return true;
      }
    }
  } catch (error) {
    console.error('[TOOLBOX_MODULES][DEBUG_FLAG_READ_FAILED]', error);
  }
  return false;
}

function hasPersistentModuleFailure() {
  return MODULE_NAMES.some((name) => {
    const item = ensureModuleHealthRecord(name);
    return !!(item && item.failCount >= MODULE_FAIL_THRESHOLD);
  });
}

function hasAnyTransientModuleFailure() {
  return MODULE_NAMES.some((name) => {
    const item = ensureModuleHealthRecord(name);
    return !!(item && item.failCount > 0);
  });
}

function applyBootPhaseStatus(reason = '') {
  if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.setStatus !== 'function') {
    return;
  }

  const isBootGrace = shouldTreatModuleErrorAsTransient();

  if (hasPersistentModuleFailure() && !isBootGrace) {
    ToolboxShell.setStatus('模块失败（持续异常）', 'error', {
      owner: 'system',
      shortText: '模块失败',
      persistent: true,
      title: `存在连续失败模块：${getModuleHealthSummary()}`,
      reason: reason || 'module-health-persistent-failure',
    });
    return;
  }

  if (hasAnyTransientModuleFailure()) {
    ToolboxShell.setStatus('模块恢复中', 'warning', {
      owner: 'system',
      shortText: '恢复中',
      persistent: true,
      title: `模块临时异常，等待恢复：${getModuleHealthSummary()}`,
      reason: reason || 'module-health-transient',
    });
    return;
  }

  if (isBootGrace) {
    ToolboxShell.setStatus('初始化中', 'running', {
      owner: 'system',
      shortText: '初始化中',
      persistent: true,
      reason: reason || 'boot-grace',
    });
  }
}

function updateModuleHealth(moduleName, payload = {}) {
  const item = ensureModuleHealthRecord(moduleName);
  if (!item) {
    return;
  }

  const now = Date.now();
  const nextOk = payload.ok === true;
  const prevOk = item.ok === true;
  const prevFailCount = Number(item.failCount || 0);

  let recoveredLogged = false;

  if (nextOk) {
    item.ok = true;
    item.lastError = '';
    item.successCount += 1;
    item.lastOkAt = now;
    const shouldClearFailCount = item.successCount >= MODULE_RECOVER_THRESHOLD;
    if (item.successCount >= MODULE_RECOVER_THRESHOLD) {
      item.failCount = 0;
    }
    const didRecover = (prevFailCount > 0 || !prevOk)
      && shouldClearFailCount
      && Number(item.failCount || 0) === 0;
    if (didRecover && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      recoveredLogged = true;
      ToolboxShell.appendLog(
        `[TOOLBOX_MODULES][RECOVERED] module=${moduleName} success_count=${item.successCount} fail_count=${item.failCount}`,
      );
    }
  } else {
    const errText = String(payload.error || '').trim() || 'unknown';
    item.ok = false;
    item.lastError = errText;
    item.lastFailAt = now;
    item.failCount += 1;
    item.successCount = 0;
    const transient = shouldTreatModuleErrorAsTransient(now) || item.failCount < MODULE_FAIL_THRESHOLD;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(
        transient
          ? `[TOOLBOX_MODULES][TRANSIENT_ERROR] module=${moduleName} fail_count=${item.failCount} error=${errText}`
          : `[TOOLBOX_MODULES][MOUNT_FAILED] module=${moduleName} fail_count=${item.failCount} error=${errText}`,
      );
    }
  }

  const debugEnabled = isModuleHealthDebugEnabled();
  if (!nextOk || recoveredLogged || debugEnabled) {
    logModuleHealth(payload.reason || '-');
  }
  applyBootPhaseStatus(payload.reason || '-');
}

const ToolboxModuleHealth = {
  report(moduleName, payload = {}) {
    updateModuleHealth(moduleName, payload);
  },
  getSummary() {
    return getModuleHealthSummary();
  },
};

if (typeof globalThis !== 'undefined') {
  globalThis.ToolboxModuleHealth = ToolboxModuleHealth;
}

function cleanupStaleToolboxDomBeforeInit(reason = '') {
  const selectors = [
    '#cgpt-toolbox-root',
    '#cgpt-toolbox-toggle',
    '#cgpt-toolbox-panel',
    '#cgpt-toolbox-edge-hotzone',
    '#cgpt-toolbox-restore-hotzone',
    '#cgpt-toolbox-restore-handle',
    '#cgpt-autoq-prompt-picker-overlay',
    '#cgpt-prompt-editor-overlay',
    '#cgpt-prompt-editor-close-confirm',
    '.cgpt-modal-overlay',
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node, index) => {
      node.remove();
      console.info(
        `[TOOLBOX][STALE_DOM_REMOVED] reason=${reason || '-'} selector=${selector} index=${index}`,
      );
    });
  });

  document.documentElement.classList.remove('cgpt-toolbox-global-dragging');
  document.body.classList.remove('cgpt-toolbox-global-dragging');
}

function installToolboxInstanceGuard() {
  const now = Date.now();
  const instanceId = `cgpt_toolbox_${now}_${Math.random().toString(36).slice(2)}`;

  const previous = window[CGPT_TOOLBOX_INSTANCE_KEY];

  if (previous && previous.instanceId) {
    console.warn(
      '[TOOLBOX][INSTANCE_GUARD][PREVIOUS_FOUND]',
      previous,
      'newInstanceId=',
      instanceId,
    );
    cleanupStaleToolboxDomBeforeInit('replace-previous-instance');
  }

  window[CGPT_TOOLBOX_INSTANCE_KEY] = {
    instanceId,
    startedAt: now,
    version: TOOLBOX_SCRIPT_VERSION,
  };

  return instanceId;
}

async function safeInitStep(name, fn) {
  try {
    await fn();
    const moduleName = getModuleNameFromInitStepName(name);
    if (moduleName) {
      updateModuleHealth(moduleName, {
        ok: true,
        reason: `safeInitStep:${name}`,
      });
    }
    return true;
  } catch (e) {
    const errText = logError(`[INIT][${name}]`, e);
    const moduleName = getModuleNameFromInitStepName(name);
    if (moduleName) {
      console.error('[TOOLBOX_MODULES][MOUNT_ERROR]', { moduleName, errText, error: e });
      updateModuleHealth(moduleName, {
        ok: false,
        error: errText,
        reason: `safeInitStep:${name}`,
      });
    }

    return false;
  }
}

async function mountAllModules(reason = 'init') {
  console.info('[TOOLBOX][MODULE_MOUNT_START]', { reason });
  if (reason === 'init' && !(ToolboxBootRuntime.bootStartedAt > 0)) {
    ToolboxBootRuntime.bootStartedAt = Date.now();
  }
  MODULE_NAMES.forEach((name) => {
    ensureModuleHealthRecord(name);
  });
  applyBootPhaseStatus(`mount-start:${reason}`);

  if (typeof cleanupRuntimeHandles === 'function') {
    cleanupRuntimeHandles(`mount:${reason}`);
  }

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT] reason=${reason}`);
  }

  const failedNames = [];

  if (!await safeInitStep(`UploadModule.mount:${reason}`, async () => {
    const initPromise = UploadModule.mount(ToolboxShell.getHost('upload'));
    if (initPromise && typeof initPromise.then === 'function') {
      await initPromise;
    }
  })) {
    failedNames.push('UploadModule');
  }

  if (!await safeInitStep(`AutoQueueModule.mount:${reason}`, () => {
    AutoQueueModule.mount(ToolboxShell.getHost('autoq'));
  })) {
    failedNames.push('AutoQueueModule');
  }

  if (!await safeInitStep(`PromptManagerModule.mount:${reason}`, () => {
    PromptManagerModule.mount(ToolboxShell.getHost('prompt'));
  })) {
    failedNames.push('PromptManagerModule');
  }

  if (!await safeInitStep(`BridgeModule.mount:${reason}`, () => {
    BridgeModule.mount(ToolboxShell.getHost('bridge'));
  })) {
    failedNames.push('BridgeModule');
  }

  if (!await safeInitStep(`ExportModule.mount:${reason}`, () => {
    ExportModule.mount(ToolboxShell.getHost('export'));
  })) {
    failedNames.push('ExportModule');
  }

  if (!await safeInitStep(`LogModule.mount:${reason}`, () => {
    LogModule.mount(ToolboxShell.getHost('log'));
  })) {
    failedNames.push('LogModule');
  }

  if (!await safeInitStep(`SettingsModule.mount:${reason}`, () => {
    SettingsModule.mount(ToolboxShell.getHost('settings'));
  })) {
    failedNames.push('SettingsModule');
  }

  if (failedNames.length && typeof ToolboxShell !== 'undefined') {
    if (ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_SUMMARY] failed=${failedNames.join('|')}`);
    }
    applyBootPhaseStatus(`mount-summary:${reason}`);
  }

  if (typeof bindConversationTurnCountObserver === 'function') {
    bindConversationTurnCountObserver();
  }

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_DONE] reason=${reason}`);
  }
  applyBootPhaseStatus(`mount-done:${reason}`);

  console.info('[TOOLBOX][MODULE_MOUNT_DONE]', { reason, failed: failedNames });
}

async function initToolbox() {
  console.log('[TOOLBOX][INIT][START]');
  console.log('[TOOLBOX][ENV]', {
    href: location.href,
    userAgent: navigator.userAgent,
    tampermonkey: typeof GM_info !== 'undefined' ? GM_info.scriptHandler : 'unknown',
    scriptName: typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.name : 'unknown',
    scriptVersion: typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : 'unknown',
    hasAutoQueueModule: typeof AutoQueueModule !== 'undefined',
  });
  console.info('[TOOLBOX][BOOT_START] initToolbox called');
  console.info(`[TOOLBOX][VERSION] ${TOOLBOX_SCRIPT_VERSION}`);
  console.info('[BOOTSTRAP][START]');

  installToolboxInstanceGuard();
  cleanupStaleToolboxDomBeforeInit('init-start');

  try {
    console.info('[SHELL][DEFINE_READY]');
    console.info('[SHELL][MOUNT_START]');
    ToolboxShell.create();
    const rootEl = document.querySelector('#cgpt-toolbox-root');
    if (!rootEl) {
      const msg = 'ToolboxShell.create() completed but #cgpt-toolbox-root is missing';
      console.error('[TOOLBOX][SHELL_CREATE_FAILED]', msg);
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TOOLBOX][SHELL_CREATE_FAILED] ${msg}`);
      }
      return;
    }
    console.info('[SHELL][MOUNT_OK]');
    console.log('[TOOLBOX][PANEL][MOUNTED]', {
      root: !!rootEl,
      panel: !!document.querySelector('#cgpt-toolbox-panel'),
    });
    console.info('[TOOLBOX][SHELL_CREATED] root created', {
      root: !!rootEl,
      panel: !!document.querySelector('#cgpt-toolbox-panel'),
    });
  } catch (e) {
    const errText = e && e.message ? e.message : String(e);
    const errStack = e && e.stack ? e.stack : '(no stack)';
    console.error(
      `[TOOLBOX][SHELL_CREATE_FAILED] stage=initToolbox module=tampermonkey-userscript-src/core/boot.js message=${errText}`,
    );
    console.error(
      `[TOOLBOX][SHELL_CREATE_FAILED][STACK] stage=initToolbox module=tampermonkey-userscript-src/core/boot.js\n${errStack}`,
    );
    console.error('[TOOLBOX][SHELL_CREATE_FAILED][ERROR_OBJECT]', e);
    logError('[INIT][ToolboxShell.create]', e);
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX][SHELL_CREATE_FAILED] ${errText}\n${errStack}`);
    }
    return;
  }

  await safeInitStep('validateCanonicalFieldsOnStartup', () => {
    if (typeof validateCanonicalFieldsOnStartup === 'function') {
      validateCanonicalFieldsOnStartup();
    }
  });

  await safeInitStep('TitlePrefixModule.start', () => {
    TitlePrefixModule.start();
  });

  await safeInitStep('ResponseDoneNotifyModule.init', () => {
    if (typeof ResponseDoneNotifyModule !== 'undefined'
      && typeof ResponseDoneNotifyModule.init === 'function') {
      ResponseDoneNotifyModule.init();
    }
  });

  await safeInitStep('ReplyDoneTitleFlashWatcher.start', () => {
    ReplyDoneTitleFlashWatcher.start();
  });

  await safeInitStep('AutoQueueModule.taskProfiles', () => {
    if (typeof AutoQueueModule === 'undefined') {
      console.error('[TOOLBOX][TASK_PROFILE][INIT_FAILED]', {
        message: 'AutoQueueModule is not defined',
        stack: '',
      });
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog('[TOOLBOX][TASK_PROFILE][INIT_FAILED] AutoQueueModule is not defined');
      }
      return;
    }

    if (typeof AutoQueueModule.getConfig !== 'function') {
      console.error('[TOOLBOX][TASK_PROFILE][INIT_FAILED]', {
        message: 'AutoQueueModule.getConfig is not a function',
        stack: '',
      });
      return;
    }

    const cfg = AutoQueueModule.getConfig() || {};
    const profileCount = Array.isArray(cfg.taskProfiles) ? cfg.taskProfiles.length : 0;
    console.log('[TOOLBOX][TASK_PROFILE][READY]', { count: profileCount });
  });

  await mountAllModules('init');

  await safeInitStep('GlobalUsageStore.initGlobalUsageSync', () => {
    if (typeof GlobalUsageStore !== 'undefined' && typeof GlobalUsageStore.initGlobalUsageSync === 'function') {
      GlobalUsageStore.initGlobalUsageSync();
    }
  });

  await safeInitStep('BrowserRuntimeHealth.start', () => {
    if (typeof BrowserRuntimeHealth !== 'undefined' && typeof BrowserRuntimeHealth.start === 'function') {
      BrowserRuntimeHealth.start();
    }
  });

  await safeInitStep('bindConversationTurnCountObserver', () => {
    bindConversationTurnCountObserver();
  });

  await safeInitStep('ToolboxShell.applyPageState', async () => {
    const waitUpload = typeof UploadModule !== 'undefined'
      && typeof UploadModule.getUploadInitPromise === 'function'
      ? UploadModule.getUploadInitPromise()
      : Promise.resolve();

    await waitUpload;
    ToolboxShell.applyToolboxPageState('init');
  });

  await safeInitStep('registerRuntimeDebugApis', () => {
    console.info('[DEBUG_API][REGISTER_START]');
    if (typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog('[DEBUG_API][REGISTER_START]');
    }
    try {
      registerRuntimeDebugApi({
        ToolboxShell,
        shell: ToolboxShell,
        runtimeState: ToolboxBootRuntime,
      });
      console.info('[DEBUG_API][REGISTER_OK]');
      if (typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[DEBUG_API][REGISTER_OK]');
      }
    } catch (error) {
      console.error('[DEBUG_API][REGISTER_FAILED]', error);
      if (typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[DEBUG_API][REGISTER_FAILED]');
      }
    }
  });

  await safeInitStep('ToolboxShell.appendLog', () => {
    ToolboxShell.appendLog('工具箱初始化完成');
    ToolboxShell.appendLog(`[TOOLBOX][VERSION] ${TOOLBOX_SCRIPT_VERSION}`);
  });

  await safeInitStep('RuntimeStatsModule.onAppStart', () => {
    if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onAppStart === 'function') {
      RuntimeStatsModule.onAppStart();
    }
  });

  await safeInitStep('ToolboxShell.showBootCompleteToast', () => {
    if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.showToast !== 'function') {
      return;
    }
    if (ToolboxBootRuntime.bootCompleteToastShown) {
      return;
    }

    ToolboxBootRuntime.bootCompleteToastShown = true;
    ToolboxBootRuntime.bootCompleteAt = Date.now();

    const moduleHealth = ToolboxBootRuntime.moduleHealth || {};
    const failedNames = Object.keys(moduleHealth).filter((name) => {
      const item = moduleHealth[name];
      return item && item.ok === false && Number(item.failCount || 0) >= 1;
    });

    if (failedNames.length > 0) {
      ToolboxShell.showToast(`工具箱已加载，部分模块恢复中：${failedNames.join('、')}`, 'warn', 3200);
      ToolboxShell.appendLog(`[TOOLBOX_BOOT][TOAST] partial=${failedNames.join('|')}`);
      return;
    }

    ToolboxShell.showToast('工具箱加载完成', 'boot-ready', 2200);
    ToolboxShell.appendLog('[TOOLBOX_BOOT][TOAST] loaded');
  });

  console.info('[TOOLBOX][BOOT_DONE] initToolbox completed');
  console.log('[TOOLBOX][INIT][DONE]');
  console.info(`[TOOLBOX][VERSION_OK] ${TOOLBOX_SCRIPT_VERSION}`);
}

function showBootFatalOverlay(error) {
  try {
    const msg = (error && error.message) ? error.message : String(error);
    console.error('[CGPT_TOOLBOX][BOOT_FAILED]', error);

    const box = document.createElement('div');
    box.textContent = `[CGPT_TOOLBOX][BOOT_FAILED] ${msg}`;
    box.style.cssText = [
      'position:fixed',
      'right:20px',
      'top:20px',
      'z-index:2147483647',
      'background:#7f1d1d',
      'color:#fff',
      'padding:10px 12px',
      'border-radius:8px',
      'font-size:13px',
      'max-width:420px',
      'white-space:pre-wrap',
      'word-break:break-word',
    ].join(';');
    document.documentElement.appendChild(box);
  } catch (overlayError) {
    console.error('[CGPT_TOOLBOX][BOOT_FAILED_OVERLAY_FAILED]', overlayError);
  }
}

async function boot() {
  try {
    await initToolbox();
    console.info('[TOOLBOX][BOOT_DONE] boot completed');
  } catch (error) {
    showBootFatalOverlay(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void boot();
  }, {
    once: true,
  });
} else {
  void boot();
}
