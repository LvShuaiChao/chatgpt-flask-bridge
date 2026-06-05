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

const TOOLBOX_BOOT_FEATURE_DEFAULTS = Object.freeze({
  uploadModule: true,
  autoQueueModule: true,
  promptManagerModule: true,
  bridgeModule: false,
  exportModule: false,
  logModule: true,
  settingsModule: true,
  runtimeStatsModule: false,
  browserRuntimeHealth: false,
  advancedDebug: false,
});

function readToolboxBootFeatureFlag(name, fallbackValue) {
  const key = String(name || '').trim();
  if (!key) {
    return fallbackValue === true;
  }

  try {
    if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
      const stored = MemoryManager.get(`bootFeature.${key}`, null);
      if (stored === true || stored === false) {
        return stored;
      }
    }
  } catch (error) {
    console.error('[TOOLBOX_BOOT_FEATURE][MEMORY_READ_FAILED]', {
      name: key,
      error,
    });
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`xzToolbox.bootFeature.${key}`);
      if (raw === '1' || raw === 'true') {
        return true;
      }
      if (raw === '0' || raw === 'false') {
        return false;
      }
    }
  } catch (error) {
    console.error('[TOOLBOX_BOOT_FEATURE][LOCAL_STORAGE_READ_FAILED]', {
      name: key,
      error,
    });
  }

  return fallbackValue === true;
}

function isToolboxBootFeatureEnabled(name) {
  const key = String(name || '').trim();
  const fallbackValue = Object.prototype.hasOwnProperty.call(TOOLBOX_BOOT_FEATURE_DEFAULTS, key)
    ? TOOLBOX_BOOT_FEATURE_DEFAULTS[key]
    : false;
  return readToolboxBootFeatureFlag(key, fallbackValue);
}

function runToolboxAfterFirstPaint(fn, reason = '') {
  const run = () => {
    window.setTimeout(() => {
      try {
        fn();
      } catch (error) {
        console.error('[TOOLBOX_BOOT][AFTER_FIRST_PAINT_FAILED]', {
          reason,
          error,
        });
      }
    }, 0);
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    run();
  }
}

function runToolboxDelayed(fn, delayMs, reason = '') {
  const safeDelayMs = Math.max(0, Number(delayMs) || 0);
  window.setTimeout(() => {
    try {
      fn();
    } catch (error) {
      console.error('[TOOLBOX_BOOT][DELAYED_TASK_FAILED]', {
        reason,
        delayMs: safeDelayMs,
        error,
      });
    }
  }, safeDelayMs);
}

function markOptionalModuleSkipped(moduleName, reason = '') {
  const name = String(moduleName || '').trim();
  if (!name) {
    return;
  }

  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][SKIPPED] module=${name} reason=${reason || '-'}`);
  }

  if (typeof updateModuleHealth === 'function') {
    updateModuleHealth(name, {
      ok: true,
      reason: `skipped:${reason || '-'}`,
    });
  }
}

async function safeMountOptionalModule(moduleName, hostName, mountFn, reason = '') {
  const name = String(moduleName || '').trim();
  const host = String(hostName || '').trim();

  if (!name || typeof mountFn !== 'function') {
    console.error('[TOOLBOX_MODULES][OPTIONAL_MOUNT_INVALID]', {
      moduleName,
      hostName,
      reason,
    });
    return false;
  }

  try {
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][OPTIONAL_MOUNT_START] module=${name} reason=${reason || '-'}`);
    }

    const hostEl = typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.getHost === 'function'
      ? ToolboxShell.getHost(host)
      : null;

    const result = mountFn(hostEl);

    if (result && typeof result.then === 'function') {
      await result;
    }

    updateModuleHealth(name, {
      ok: true,
      reason: `optional-mount:${reason || '-'}`,
    });

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][OPTIONAL_MOUNT_OK] module=${name} reason=${reason || '-'}`);
    }

    return true;
  } catch (error) {
    console.error('[TOOLBOX_MODULES][OPTIONAL_MOUNT_FAILED]', {
      moduleName: name,
      hostName: host,
      reason,
      error,
    });

    updateModuleHealth(name, {
      ok: false,
      error: error && error.message ? error.message : String(error),
      reason: `optional-mount-failed:${reason || '-'}`,
    });

    return false;
  }
}

const ToolboxBootRuntime = {
  bootStartedAt: 0,
  bootCompleteToastShown: false,
  bootCompleteAt: 0,
  moduleHealth: {},
};
if (typeof globalThis !== 'undefined') {
  globalThis.__CGPT_TOOLBOX_BOOT_RUNTIME_READY__ = true;
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
  const bootPending = typeof toolboxGetRestoringModules === 'function'
    ? toolboxGetRestoringModules(ToolboxShell)
    : (typeof xzToolboxGetPendingModules === 'function' ? xzToolboxGetPendingModules() : []);
  const bootReleased = typeof xzToolboxBootAllReadyOrFailed === 'function'
    ? xzToolboxBootAllReadyOrFailed()
    : bootPending.length === 0;

  if (bootReleased && bootPending.length === 0 && !hasPersistentModuleFailure()) {
    if (typeof ToolboxShell.clearStatus === 'function') {
      ToolboxShell.clearStatus('system');
      ToolboxShell.clearStatus('module-health');
    }
    if (isBootGrace) {
      ToolboxShell.setStatus('初始化中', 'running', {
        owner: 'system',
        shortText: '初始化中',
        persistent: true,
        reason: reason || 'boot-grace',
      });
    }
    return;
  }

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

  if (bootPending.length > 0) {
    ToolboxShell.setStatus('模块恢复中', 'warning', {
      owner: 'system',
      shortText: '恢复中',
      persistent: true,
      title: typeof buildToolboxModuleStatusText === 'function'
        ? buildToolboxModuleStatusText(ToolboxShell)
        : `模块恢复中：${bootPending.join(', ')}`,
      reason: reason || 'module-boot-restoring',
    });
    return;
  }

  if (hasAnyTransientModuleFailure()) {
    const degraded = typeof toolboxGetDegradedModules === 'function'
      ? toolboxGetDegradedModules(ToolboxShell)
      : [];
    if (degraded.length > 0) {
      ToolboxShell.setStatus('部分模块降级', 'warning', {
        owner: 'system',
        shortText: '降级',
        persistent: false,
        title: typeof buildToolboxModuleStatusText === 'function'
          ? buildToolboxModuleStatusText(ToolboxShell)
          : `降级模块：${degraded.join(', ')}`,
        reason: reason || 'module-degraded',
      });
      return;
    }
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

  if (window.__XZ_TOOLBOX_MODULE_WATCHDOG_STARTED__) {
    console.warn('[TOOLBOX_INSTANCE_GUARD][CLEAR_LEGACY_WATCHDOG_FLAG]', {
      reason,
    });
    delete window.__XZ_TOOLBOX_MODULE_WATCHDOG_STARTED__;
  }
  window.__XZ_TOOLBOX_MODULE_WATCHDOG_STARTED_AT__ = 0;
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

function runAfterFirstPaint(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      window.setTimeout(() => {
        Promise.resolve()
          .then(fn)
          .then(resolve)
          .catch((error) => {
            console.error('[TOOLBOX_BOOT][DEFERRED_MOUNT_FAILED]', error);
            reject(error);
          });
      }, 0);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      run();
    }
  });
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

  if (typeof startToolboxModuleWatchdog === 'function') {
    startToolboxModuleWatchdog(ToolboxShell);
  }

  if (typeof cleanupRuntimeHandles === 'function') {
    cleanupRuntimeHandles(`mount:${reason}`);
  }

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT] reason=${reason}`);
  }

  const failedNames = [];
  const recoveryTimeout = typeof TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS === 'number'
    ? TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS
    : 8000;

  const coreMountTasks = [];

  if (
    isToolboxBootFeatureEnabled('uploadModule')
    && typeof UploadModule !== 'undefined'
    && typeof mountToolboxModuleDegraded === 'function'
  ) {
    coreMountTasks.push(
      new Promise((resolve) => {
        runToolboxAfterFirstPaint(() => {
          void mountToolboxModuleDegraded(
            ToolboxShell,
            'UploadModule',
            async ({ cancelToken }) => {
              const initPromise = UploadModule.mount(ToolboxShell.getHost('upload'), {
                cancelToken,
              });
              if (initPromise && typeof initPromise.then === 'function') {
                await initPromise;
              }
            },
            recoveryTimeout,
            `after-first-paint:${reason}`,
          )
            .then(resolve)
            .catch((error) => {
              console.error('[TOOLBOX_BOOT][UPLOAD_MODULE_DELAYED_MOUNT_FAILED]', error);
              resolve({
                ok: false,
                moduleName: 'UploadModule',
                error,
              });
            });
        }, `UploadModule.after-first-paint:${reason}`);
      }),
    );
  } else {
    markOptionalModuleSkipped('UploadModule', `feature-disabled-or-missing:${reason}`);
  }

  if (
    isToolboxBootFeatureEnabled('autoQueueModule')
    && typeof AutoQueueModule !== 'undefined'
    && typeof mountToolboxModuleDegraded === 'function'
  ) {
    coreMountTasks.push(
      new Promise((resolve) => {
        runToolboxAfterFirstPaint(() => {
          void mountToolboxModuleDegraded(
            ToolboxShell,
            'AutoQueueModule',
            async ({ cancelToken }) => {
              const uploadState = ToolboxShell.__moduleStates
                && ToolboxShell.__moduleStates.UploadModule
                ? ToolboxShell.__moduleStates.UploadModule.state
                : '';

              console.warn('[AUTO_QUEUE_INIT]', { uploadState });

              if (cancelToken && cancelToken.cancelled) {
                return;
              }

              if (uploadState === 'restoring') {
                console.warn('[AUTO_QUEUE_INIT] UploadModule still restoring, continue without upload dependency');
              }

              if (uploadState === 'degraded' || uploadState === 'failed') {
                console.warn(
                  '[AUTO_QUEUE_INIT] UploadModule unavailable, upload-related queue actions disabled but auto queue continues',
                  { uploadState },
                );
              }

              const autoQueueMountResult = AutoQueueModule.mount(ToolboxShell.getHost('autoq'));
              if (autoQueueMountResult && typeof autoQueueMountResult.then === 'function') {
                await autoQueueMountResult;
              }
            },
            5000,
            `after-first-paint:${reason}`,
          )
            .then(resolve)
            .catch((error) => {
              console.error('[TOOLBOX_BOOT][AUTO_QUEUE_MODULE_DELAYED_MOUNT_FAILED]', error);
              resolve({
                ok: false,
                moduleName: 'AutoQueueModule',
                error,
              });
            });
        }, `AutoQueueModule.after-first-paint:${reason}`);
      }),
    );
  } else {
    markOptionalModuleSkipped('AutoQueueModule', `feature-disabled-or-missing:${reason}`);
  }

  if (coreMountTasks.length === 0) {
    console.error('[TOOLBOX_BOOT][CORE_MOUNT_FALLBACK] mountToolboxModuleDegraded missing, using legacy sequential mount');
    if (typeof UploadModule !== 'undefined') {
      try {
        const initPromise = UploadModule.mount(ToolboxShell.getHost('upload'));
        if (initPromise && typeof initPromise.then === 'function') {
          await Promise.race([
            initPromise,
            new Promise((resolve) => window.setTimeout(resolve, recoveryTimeout)),
          ]);
        }
      } catch (uploadMountError) {
        console.error('[TOOLBOX_BOOT][UploadModule.mount][FALLBACK]', uploadMountError);
        if (typeof xzToolboxSetModuleFailed === 'function') {
          xzToolboxSetModuleFailed('UploadModule', uploadMountError);
        }
        failedNames.push('UploadModule');
      }
    }
    if (typeof AutoQueueModule !== 'undefined') {
      try {
        AutoQueueModule.mount(ToolboxShell.getHost('autoq'));
        if (typeof xzToolboxSetModuleReady === 'function') {
          xzToolboxSetModuleReady('AutoQueueModule');
        }
      } catch (autoqMountError) {
        console.error('[TOOLBOX_BOOT][AutoQueueModule.mount][FALLBACK]', autoqMountError);
        if (typeof xzToolboxSetModuleFailed === 'function') {
          xzToolboxSetModuleFailed('AutoQueueModule', autoqMountError);
        }
        failedNames.push('AutoQueueModule');
      }
    }
  }

  const coreResults = await Promise.allSettled(coreMountTasks);
  coreResults.forEach((settled, index) => {
    if (settled.status === 'rejected') {
      console.error('[TOOLBOX_MODULE_INIT_ALL_SETTLED_FAILED]', settled.reason, { index });
      return;
    }
    const item = settled.value;
    if (!item || item.ok !== true) {
      failedNames.push(item && item.moduleName ? item.moduleName : 'unknown-core-module');
      const moduleName = item && item.moduleName ? item.moduleName : '';
      if (moduleName) {
        updateModuleHealth(moduleName, {
          ok: true,
          reason: 'degraded-ready',
        });
      }
    } else if (item.moduleName) {
      updateModuleHealth(item.moduleName, {
        ok: true,
        reason: `mount:${reason}`,
      });
    }
  });

  const restoringAfterCore = typeof toolboxGetRestoringModules === 'function'
    ? toolboxGetRestoringModules(ToolboxShell)
    : [];
  restoringAfterCore.forEach((moduleName) => {
    if (typeof toolboxSetModuleState === 'function') {
      toolboxSetModuleState(
        ToolboxShell,
        moduleName,
        'degraded',
        'forced degraded because module stayed restoring after init allSettled',
      );
    }
    if (typeof xzToolboxSetModuleFailed === 'function') {
      xzToolboxSetModuleFailed(
        moduleName,
        new Error('forced degraded after core allSettled'),
      );
    }
    failedNames.push(moduleName);
  });

  if (typeof ToolboxShell.bindGlobalButtons === 'function') {
    ToolboxShell.bindGlobalButtons(`after-core-mount:${reason}`);
  }
  if (typeof ToolboxShell.enableGlobalButtons === 'function') {
    ToolboxShell.enableGlobalButtons(`after-core-mount:${reason}`);
  }

  runToolboxDelayed(() => {
    if (!isToolboxBootFeatureEnabled('promptManagerModule')) {
      markOptionalModuleSkipped('PromptManagerModule', `feature-disabled:${reason}`);
      return;
    }

    void safeMountOptionalModule(
      'PromptManagerModule',
      'prompt',
      (hostEl) => {
        if (typeof PromptManagerModule === 'undefined' || typeof PromptManagerModule.mount !== 'function') {
          throw new Error('PromptManagerModule.mount is not available');
        }
        return PromptManagerModule.mount(hostEl);
      },
      `delayed:${reason}`,
    );
  }, 300, `PromptManagerModule.delayed:${reason}`);

  runToolboxDelayed(() => {
    if (!isToolboxBootFeatureEnabled('BridgeModule') && !isToolboxBootFeatureEnabled('bridgeModule')) {
      markOptionalModuleSkipped('BridgeModule', `feature-disabled:${reason}`);
      return;
    }

    void safeMountOptionalModule(
      'BridgeModule',
      'bridge',
      (hostEl) => {
        if (typeof BridgeModule === 'undefined' || typeof BridgeModule.mount !== 'function') {
          throw new Error('BridgeModule.mount is not available');
        }
        return BridgeModule.mount(hostEl);
      },
      `delayed:${reason}`,
    );
  }, 600, `BridgeModule.delayed:${reason}`);

  runToolboxDelayed(() => {
    if (!isToolboxBootFeatureEnabled('exportModule')) {
      markOptionalModuleSkipped('ExportModule', `feature-disabled:${reason}`);
      return;
    }

    void safeMountOptionalModule(
      'ExportModule',
      'export',
      (hostEl) => {
        if (typeof ExportModule === 'undefined' || typeof ExportModule.mount !== 'function') {
          throw new Error('ExportModule.mount is not available');
        }
        return ExportModule.mount(hostEl);
      },
      `delayed:${reason}`,
    );
  }, 900, `ExportModule.delayed:${reason}`);

  runToolboxDelayed(() => {
    if (!isToolboxBootFeatureEnabled('logModule')) {
      markOptionalModuleSkipped('LogModule', `feature-disabled:${reason}`);
      return;
    }

    void safeMountOptionalModule(
      'LogModule',
      'log',
      (hostEl) => {
        if (typeof LogModule === 'undefined' || typeof LogModule.mount !== 'function') {
          throw new Error('LogModule.mount is not available');
        }
        return LogModule.mount(hostEl);
      },
      `delayed:${reason}`,
    );
  }, 1200, `LogModule.delayed:${reason}`);

  runToolboxDelayed(() => {
    if (!isToolboxBootFeatureEnabled('settingsModule')) {
      markOptionalModuleSkipped('SettingsModule', `feature-disabled:${reason}`);
      return;
    }

    void safeMountOptionalModule(
      'SettingsModule',
      'settings',
      (hostEl) => {
        if (typeof SettingsModule === 'undefined' || typeof SettingsModule.mount !== 'function') {
          throw new Error('SettingsModule.mount is not available');
        }
        return SettingsModule.mount(hostEl);
      },
      `delayed:${reason}`,
    );
  }, 1500, `SettingsModule.delayed:${reason}`);

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

  const restoringBeforeDone = typeof toolboxGetRestoringModules === 'function'
    ? toolboxGetRestoringModules(ToolboxShell)
    : [];
  if (restoringBeforeDone.length > 0) {
    console.error('[TOOLBOX_MODULES_INIT][RESTORING_BEFORE_DONE_FORCE_DEGRADED]', {
      restoringBeforeDone,
    });
    restoringBeforeDone.forEach((moduleName) => {
      if (typeof toolboxSetModuleState === 'function') {
        toolboxSetModuleState(
          ToolboxShell,
          moduleName,
          'degraded',
          'forced degraded before mountAllModules done',
        );
      }
    });
  }
  if (typeof applyBootPhaseStatus === 'function') {
    applyBootPhaseStatus(`mount-done:${reason}`);
  }
  if (typeof toolboxRefreshTopStatus === 'function') {
    toolboxRefreshTopStatus(ToolboxShell);
  } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.refreshTopStatus === 'function') {
    ToolboxShell.refreshTopStatus(`mount-done:${reason}`);
  }

  console.warn('[TOOLBOX_MODULES_INIT][DONE]', {
    restoringAfterDone: typeof toolboxGetRestoringModules === 'function'
      ? toolboxGetRestoringModules(ToolboxShell)
      : [],
  });
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

    window.__XZ_TOOLBOX_SHELL__ = ToolboxShell;
    if (ToolboxShell) {
      ToolboxShell.tabsRoot = document.querySelector('.cgpt-toolbox-tabs');
      ToolboxShell.contentRoot = document.querySelector('.cgpt-toolbox-content');
    }

    if (typeof renderToolboxTabs === 'function' && ToolboxShell) {
      renderToolboxTabs(ToolboxShell, ToolboxShell.tabsRoot);
    }
    if (typeof renderToolboxActiveTab === 'function' && ToolboxShell) {
      const earlyTabId = typeof getStoredToolboxActiveTabId === 'function'
        ? getStoredToolboxActiveTabId()
        : 'upload';
      renderToolboxActiveTab(ToolboxShell, earlyTabId, {
        save: false,
        reason: 'shell-create-early',
      });
    } else if (typeof ToolboxShell.restoreActiveTab === 'function') {
      ToolboxShell.restoreActiveTab();
    }

    if (typeof ToolboxShell.bindGlobalButtons === 'function') {
      ToolboxShell.bindGlobalButtons('shell-create-early');
    }
    if (typeof ToolboxShell.enableGlobalButtons === 'function') {
      ToolboxShell.enableGlobalButtons('shell-create-early');
    }
    if (
      typeof UploadModule !== 'undefined'
      && typeof UploadModule.ensureGlobalActionInfrastructure === 'function'
    ) {
      UploadModule.ensureGlobalActionInfrastructure('shell-create-early');
    }
    if (typeof startToolboxModuleWatchdog === 'function') {
      startToolboxModuleWatchdog(ToolboxShell);
    }
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

  if (typeof renderToolboxTabs === 'function' && typeof ToolboxShell !== 'undefined') {
    ToolboxShell.tabsRoot = document.querySelector('.cgpt-toolbox-tabs');
    ToolboxShell.contentRoot = document.querySelector('.cgpt-toolbox-content');
    renderToolboxTabs(ToolboxShell, ToolboxShell.tabsRoot);
  }
  if (typeof renderToolboxActiveTab === 'function' && typeof ToolboxShell !== 'undefined') {
    const activeTabId = typeof getStoredToolboxActiveTabId === 'function'
      ? getStoredToolboxActiveTabId()
      : (typeof ToolboxShell.getActiveTab === 'function' ? ToolboxShell.getActiveTab() : 'upload');
    renderToolboxActiveTab(ToolboxShell, activeTabId, {
      reason: 'post-module-mount',
    });
  }
  if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.refreshTopStatus === 'function') {
    ToolboxShell.refreshTopStatus('post-module-mount');
  }

  await safeInitStep('GlobalUsageStore.initGlobalUsageSync', () => {
    if (typeof GlobalUsageStore !== 'undefined' && typeof GlobalUsageStore.initGlobalUsageSync === 'function') {
      GlobalUsageStore.initGlobalUsageSync();
    }
  });

  await safeInitStep('BrowserRuntimeHealth.start', () => {
    if (!isToolboxBootFeatureEnabled('browserRuntimeHealth')) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[TOOLBOX_MODULES][SKIPPED] module=BrowserRuntimeHealth reason=feature-disabled');
      }
      return;
    }

    if (typeof BrowserRuntimeHealth !== 'undefined' && typeof BrowserRuntimeHealth.start === 'function') {
      BrowserRuntimeHealth.start();
    }
  });

  await safeInitStep('bindConversationTurnCountObserver', () => {
    bindConversationTurnCountObserver();
  });

  await safeInitStep('ToolboxShell.applyPageState', async () => {
    ToolboxShell.applyToolboxPageState('init');
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.getUploadInitPromise === 'function') {
      void UploadModule.getUploadInitPromise()
        .catch((waitError) => {
          console.error('[TOOLBOX_BOOT][UPLOAD_INIT_PROMISE_FAILED]', waitError);
        });
    }
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
    if (!isToolboxBootFeatureEnabled('runtimeStatsModule')) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[TOOLBOX_MODULES][SKIPPED] module=RuntimeStatsModule reason=feature-disabled');
      }
      return;
    }

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

    const bootStatusText = typeof buildToolboxModuleStatusText === 'function'
      ? buildToolboxModuleStatusText(ToolboxShell)
      : (typeof getToolboxBootStatusText === 'function' ? getToolboxBootStatusText() : '工具箱已加载');
    const bootPending = typeof toolboxGetRestoringModules === 'function'
      ? toolboxGetRestoringModules(ToolboxShell)
      : [];
    const bootDegraded = typeof toolboxGetDegradedModules === 'function'
      ? toolboxGetDegradedModules(ToolboxShell)
      : [];

    if (bootPending.length > 0) {
      ToolboxShell.showToast(bootStatusText, 'warn', 3200);
      ToolboxShell.appendLog(`[TOOLBOX_BOOT][TOAST] pending=${bootPending.join('|')}`);
      return;
    }

    if (bootDegraded.length > 0) {
      ToolboxShell.showToast(bootStatusText, 'warn', 3600);
      ToolboxShell.appendLog(`[TOOLBOX_BOOT][TOAST] degraded=${bootDegraded.join('|')}`);
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

