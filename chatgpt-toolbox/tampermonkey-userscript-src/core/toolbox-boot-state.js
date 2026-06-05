/********************************************************************
 * 统一模块启动状态：恢复/渲染失败不得永久阻塞工具箱
 ********************************************************************/

const TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS = 8000;
const XZ_TOOLBOX_BOOT_TIMEOUT_MS = TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS;

const XZ_TOOLBOX_BOOT = window.__XZ_TOOLBOX_BOOT__ || {
  modules: {
    UploadModule: {
      ready: false,
      failed: false,
      degraded: false,
      recovering: true,
      error: '',
      updatedAt: Date.now(),
    },
    AutoQueueModule: {
      ready: false,
      failed: false,
      degraded: false,
      recovering: true,
      error: '',
      updatedAt: Date.now(),
    },
  },
};

window.__XZ_TOOLBOX_BOOT__ = XZ_TOOLBOX_BOOT;

if (
  typeof globalThis !== 'undefined'
  && typeof globalThis.__CGPT_TOOLBOX_BOOT_RUNTIME_READY__ === 'undefined'
) {
  globalThis.__CGPT_TOOLBOX_BOOT_RUNTIME_READY__ = false;
}

function toolboxLogError(tag, error, extra) {
  const payload = extra || {};
  const message = error && error.message ? error.message : String(error);
  const stack = error && error.stack ? error.stack : '';
  console.error(`[${tag}] ${message}`, payload, stack);
}

function toolboxTimeoutPromise(ms, label) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve({
        ok: false,
        timeout: true,
        label,
        error: new Error(`${label} timeout after ${ms}ms`),
      });
    }, ms);
  });
}

async function toolboxRunWithTimeout(label, fn, timeoutMs) {
  const taskPromise = Promise.resolve()
    .then(fn)
    .then((value) => {
      return {
        ok: true,
        timeout: false,
        label,
        value,
      };
    })
    .catch((error) => {
      toolboxLogError('TOOLBOX_MODULE_RUN_ERROR', error, { label });
      return {
        ok: false,
        timeout: false,
        label,
        error,
      };
    });

  return Promise.race([
    taskPromise,
    toolboxTimeoutPromise(timeoutMs, label),
  ]);
}

function toolboxResolveShell(shell) {
  if (shell) {
    return shell;
  }
  if (typeof ToolboxShell !== 'undefined') {
    return ToolboxShell;
  }
  return null;
}

function toolboxEnsureModuleStateStore(shell) {
  const resolvedShell = toolboxResolveShell(shell);
  if (resolvedShell) {
    if (!resolvedShell.__moduleStates) {
      resolvedShell.__moduleStates = window.__XZ_TOOLBOX_MODULE_STATES__ || {};
    }
    window.__XZ_TOOLBOX_MODULE_STATES__ = resolvedShell.__moduleStates;
    return resolvedShell.__moduleStates;
  }
  if (!window.__XZ_TOOLBOX_MODULE_STATES__) {
    window.__XZ_TOOLBOX_MODULE_STATES__ = {};
  }
  return window.__XZ_TOOLBOX_MODULE_STATES__;
}

function toolboxSyncLegacyBootModule(moduleName, patch) {
  const name = String(moduleName || '').trim();
  if (!name) {
    return;
  }
  if (!XZ_TOOLBOX_BOOT.modules[name]) {
    XZ_TOOLBOX_BOOT.modules[name] = {
      ready: false,
      failed: false,
      degraded: false,
      recovering: false,
      error: '',
      updatedAt: Date.now(),
    };
  }
  Object.assign(XZ_TOOLBOX_BOOT.modules[name], patch, { updatedAt: Date.now() });
}

function toolboxRefreshTopStatus(shell) {
  if (shell && typeof shell.refreshTopStatus === 'function') {
    shell.refreshTopStatus();
  }
  if (shell && typeof shell.renderTopStatus === 'function') {
    shell.renderTopStatus();
  }
  if (shell && typeof shell.updateTopStatus === 'function') {
    shell.updateTopStatus();
  }
  if (typeof renderToolboxTopStatus === 'function') {
    renderToolboxTopStatus({ heavy: false });
  }
}

function toolboxCanApplyBootPhaseStatus() {
  return !!(
    typeof globalThis !== 'undefined'
    && globalThis.__CGPT_TOOLBOX_BOOT_RUNTIME_READY__ === true
    && typeof applyBootPhaseStatus === 'function'
  );
}

function toolboxApplyBootPhaseStatusSafe(reason, context = {}) {
  const normalizedReason = String(reason || '-').trim() || '-';
  if (!toolboxCanApplyBootPhaseStatus()) {
    console.info('[TOOLBOX_MODULE_STATE][BOOT_PHASE_STATUS_DEFERRED]', {
      reason: normalizedReason,
      context: context || {},
      bootRuntimeReady:
        typeof globalThis !== 'undefined'
          ? globalThis.__CGPT_TOOLBOX_BOOT_RUNTIME_READY__ === true
          : false,
    });
    return false;
  }
  try {
    applyBootPhaseStatus(normalizedReason);
    return true;
  } catch (error) {
    console.error('[TOOLBOX_MODULE_STATE][APPLY_BOOT_PHASE_STATUS_FAILED]', {
      reason: normalizedReason,
      context: context || {},
      errorMessage: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : '',
    });
    return false;
  }
}

function toolboxSetModuleState(shell, moduleName, state, reason) {
  const store = toolboxEnsureModuleStateStore(shell);
  const name = String(moduleName || '').trim();
  if (!name) {
    return;
  }

  store[name] = {
    name,
    state,
    reason: reason || '',
    updatedAt: Date.now(),
  };

  console.warn('[TOOLBOX_MODULE_STATE]', {
    moduleName: name,
    state,
    reason: reason || '',
    updatedAt: store[name].updatedAt,
  });

  if (state === 'ready') {
    toolboxSyncLegacyBootModule(name, {
      ready: true,
      failed: false,
      degraded: false,
      recovering: false,
      error: '',
    });
  } else if (state === 'degraded') {
    toolboxSyncLegacyBootModule(name, {
      ready: true,
      failed: false,
      degraded: true,
      recovering: false,
      error: reason || '',
    });
  } else if (state === 'failed') {
    toolboxSyncLegacyBootModule(name, {
      ready: true,
      failed: true,
      degraded: false,
      recovering: false,
      error: reason || '',
    });
  } else if (state === 'restoring') {
    toolboxSyncLegacyBootModule(name, {
      ready: false,
      failed: false,
      degraded: false,
      recovering: true,
      error: '',
    });
  }

  toolboxRefreshTopStatus(shell);
  toolboxApplyBootPhaseStatusSafe(`module-state:${name}:${state}`, {
    moduleName: name,
    state,
    reason: reason || '',
  });
}

function toolboxGetRestoringModules(shell) {
  const store = toolboxEnsureModuleStateStore(shell);
  return Object.keys(store).filter((name) => {
    const item = store[name];
    return item && item.state === 'restoring';
  });
}

function toolboxGetDegradedModules(shell) {
  const store = toolboxEnsureModuleStateStore(shell);
  return Object.keys(store).filter((name) => {
    const item = store[name];
    return item && item.state === 'degraded';
  });
}

async function mountToolboxModuleDegraded(shell, moduleName, mountFn, timeoutMs, contextReason) {
  const name = String(moduleName || '').trim();
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS;

  const mountCancelToken = {
    cancelled: false,
    moduleName: name,
  };

  toolboxSetModuleState(shell, name, 'restoring', `module init started (${contextReason || '-'})`);

  const wrappedMountFn = () => {
    if (typeof mountFn === 'function' && mountFn.length > 0) {
      return mountFn({ cancelToken: mountCancelToken });
    }
    return mountFn();
  };

  const taskPromise = Promise.resolve()
    .then(wrappedMountFn)
    .then((value) => {
      return {
        ok: true,
        timeout: false,
        label: `init:${name}`,
        value,
      };
    })
    .catch((error) => {
      toolboxLogError('TOOLBOX_MODULE_RUN_ERROR', error, { label: `init:${name}` });
      return {
        ok: false,
        timeout: false,
        label: `init:${name}`,
        error,
      };
    });

  const result = await Promise.race([
    taskPromise,
    new Promise((resolve) => {
      window.setTimeout(() => {
        mountCancelToken.cancelled = true;
        console.warn('[TOOLBOX_MODULE_MOUNT][TIMEOUT_CANCELLED]', {
          moduleName: name,
          timeoutMs: timeout,
        });
        resolve({
          ok: false,
          timeout: true,
          label: `init:${name}`,
          error: new Error(`init:${name} timeout after ${timeout}ms`),
        });
      }, timeout);
    }),
  ]);

  if (result.ok) {
    toolboxSetModuleState(shell, name, 'ready', 'module init finished');
    return { moduleName: name, ok: true };
  }

  const degradeReason = result.timeout
    ? 'module init timeout, degraded instead of blocking shell'
    : 'module init failed, degraded instead of blocking shell';

  toolboxSetModuleState(shell, name, 'degraded', degradeReason);

  const moduleObject = name === 'UploadModule' && typeof UploadModule !== 'undefined'
    ? UploadModule
    : null;

  if (moduleObject && typeof moduleObject.renderFallbackPanel === 'function') {
    const fallbackResult = await toolboxRunWithTimeout(
      `fallback:${name}`,
      async () => {
        moduleObject.renderFallbackPanel(
          '队列恢复后界面渲染失败，已进入降级模式。可以继续使用发送、复制、快捷键和无限继续。',
        );
      },
      3000,
    );
    if (!fallbackResult.ok) {
      toolboxLogError('TOOLBOX_MODULE_FALLBACK_FAILED', fallbackResult.error, { moduleName: name });
    }
  }

  if (name === 'UploadModule' && moduleObject && typeof moduleObject.ensureGlobalActionInfrastructure === 'function') {
    moduleObject.ensureGlobalActionInfrastructure(`mount-degraded:${contextReason || '-'}`);
  }

  return {
    moduleName: name,
    ok: false,
    degraded: true,
    error: result.error,
  };
}

function buildToolboxModuleStatusText(shell) {
  const store = toolboxEnsureModuleStateStore(shell);
  const restoring = [];
  const degraded = [];
  const failed = [];

  Object.keys(store).forEach((name) => {
    const item = store[name];
    if (!item) {
      return;
    }
    if (item.state === 'restoring') {
      restoring.push(name);
    } else if (item.state === 'degraded') {
      degraded.push(name);
    } else if (item.state === 'failed') {
      failed.push(name);
    }
  });

  if (restoring.length > 0) {
    return `工具箱已加载，部分模块恢复中: ${restoring.join(', ')}`;
  }
  if (failed.length > 0) {
    return `工具箱已加载，部分模块失败: ${failed.join(', ')}`;
  }
  if (degraded.length > 0) {
    return `工具箱已加载，部分模块降级: ${degraded.join(', ')}`;
  }
  return '工具箱已加载';
}

function xzToolboxSetModuleReady(moduleName) {
  const name = String(moduleName || '').trim();
  if (!name) {
    return;
  }

  toolboxSetModuleState(null, name, 'ready', 'module ready');
  console.info('[TOOLBOX_BOOT][MODULE_READY]', name, XZ_TOOLBOX_BOOT.modules[name]);

  toolboxApplyBootPhaseStatusSafe(`module-ready:${name}`, {
    moduleName: name,
    state: 'ready',
  });
}

function xzToolboxSetModuleDegraded(moduleName, reason, error) {
  const name = String(moduleName || '').trim();
  const msg = error && error.stack ? error.stack : String(error || reason || 'degraded');
  toolboxSetModuleState(null, name, 'degraded', reason || msg);
  console.error('[TOOLBOX_BOOT][MODULE_DEGRADED]', name, { reason: reason || '', error });
  toolboxApplyBootPhaseStatusSafe(`module-degraded:${name}`, {
    moduleName: name,
    state: 'degraded',
    reason: reason || '',
  });
}

function xzToolboxSetModuleFailed(moduleName, error) {
  const name = String(moduleName || '').trim();
  const msg = error && error.stack ? error.stack : String(error || 'unknown error');
  xzToolboxSetModuleDegraded(name, msg, error);
  console.error('[TOOLBOX_BOOT][MODULE_FAILED]', name, error);
  toolboxApplyBootPhaseStatusSafe(`module-failed:${name}`, {
    moduleName: name,
    state: 'failed',
    errorMessage: error && error.message ? error.message : String(error || ''),
  });
}

function xzToolboxGetPendingModules() {
  return Object.entries(XZ_TOOLBOX_BOOT.modules)
    .filter(([, state]) => state && state.recovering && !state.ready)
    .map(([name]) => name);
}

function xzToolboxGetDegradedModules() {
  const store = toolboxEnsureModuleStateStore(null);
  return Object.keys(store).filter((name) => {
    const item = store[name];
    return item && item.state === 'degraded';
  });
}

function xzToolboxGetFailedModules() {
  const store = toolboxEnsureModuleStateStore(null);
  const fromStore = Object.keys(store).filter((name) => {
    const item = store[name];
    return item && item.state === 'failed';
  });
  if (fromStore.length > 0) {
    return fromStore;
  }
  return Object.entries(XZ_TOOLBOX_BOOT.modules)
    .filter(([, state]) => state && state.failed)
    .map(([name]) => name);
}

function xzToolboxBootAllReadyOrFailed() {
  return Object.values(XZ_TOOLBOX_BOOT.modules).every((state) => {
    return state && state.ready === true && state.recovering !== true;
  });
}

function getToolboxBootStatusText() {
  const store = toolboxEnsureModuleStateStore(null);
  const hasStoreEntries = Object.keys(store).length > 0;
  const text = buildToolboxModuleStatusText(null);
  if (text !== '工具箱已加载') {
    return text;
  }

  if (hasStoreEntries) {
    return '工具箱已加载';
  }

  const pending = xzToolboxGetPendingModules();
  const failed = xzToolboxGetFailedModules();
  const degraded = xzToolboxGetDegradedModules();

  if (pending.length > 0) {
    return `工具箱已加载，部分模块恢复中: ${pending.join(', ')}`;
  }
  if (failed.length > 0) {
    return `工具箱已加载，部分模块失败: ${failed.join(', ')}`;
  }
  if (degraded.length > 0) {
    return `工具箱已加载，部分模块降级: ${degraded.join(', ')}`;
  }
  return '工具箱已加载';
}

function xzToolboxForceReleaseRestoringModules(shell, reason) {
  const restoringModules = toolboxGetRestoringModules(shell);
  if (restoringModules.length <= 0) {
    return [];
  }
  restoringModules.forEach((moduleName) => {
    toolboxSetModuleState(
      shell,
      moduleName,
      'degraded',
      reason || 'forced degraded because module stayed restoring',
    );
  });
  return restoringModules;
}

function startToolboxModuleWatchdog(shell) {
  const resolvedShell = shell || window.__XZ_TOOLBOX_SHELL__ || null;
  if (resolvedShell && resolvedShell.__moduleWatchdogStarted === true) {
    console.warn('[TOOLBOX_MODULE_WATCHDOG][SKIP_ALREADY_STARTED_ON_SHELL]');
    return;
  }
  if (resolvedShell) {
    resolvedShell.__moduleWatchdogStarted = true;
  }
  window.__XZ_TOOLBOX_MODULE_WATCHDOG_STARTED_AT__ = Date.now();
  console.warn('[TOOLBOX_MODULE_WATCHDOG][START]', {
    timeoutMs: TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS + 1000,
    hasShell: !!resolvedShell,
  });

  window.setTimeout(() => {
    const latestShell = window.__XZ_TOOLBOX_SHELL__ || resolvedShell || null;
    const restoringModules = toolboxGetRestoringModules(latestShell);
    const legacyPending = xzToolboxGetPendingModules();
    const modulesToRelease = restoringModules.length > 0
      ? restoringModules
      : legacyPending;

    if (modulesToRelease.length === 0) {
      console.warn('[TOOLBOX_MODULE_WATCHDOG][NO_RESTORING]');
      toolboxApplyBootPhaseStatusSafe('watchdog-no-restoring', {
        source: 'module-watchdog',
      });
      return;
    }

    console.error('[TOOLBOX_MODULE_WATCHDOG][FORCE_DEGRADED]', {
      restoringModules,
      legacyPending,
      modulesToRelease,
    });

    modulesToRelease.forEach((moduleName) => {
      toolboxSetModuleState(
        latestShell,
        moduleName,
        'degraded',
        'watchdog forced degraded because module stayed restoring too long',
      );
    });

    if (latestShell && typeof latestShell.bindGlobalButtons === 'function') {
      latestShell.bindGlobalButtons('watchdog-force-degraded');
    }
    if (latestShell && typeof latestShell.enableGlobalButtons === 'function') {
      latestShell.enableGlobalButtons('watchdog-force-degraded');
    }
    toolboxApplyBootPhaseStatusSafe('watchdog-force-degraded', {
      source: 'module-watchdog',
      modulesToRelease,
    });
    toolboxRefreshTopStatus(latestShell);
  }, TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS + 1000);
}

function xzToolboxInstallBootTimeout() {
  window.setTimeout(() => {
    const pending = xzToolboxGetPendingModules();
    if (pending.length <= 0) {
      return;
    }

    console.error('[TOOLBOX_BOOT][TIMEOUT_RELEASED]', {
      pending,
      timeoutMs: XZ_TOOLBOX_BOOT_TIMEOUT_MS,
      boot: XZ_TOOLBOX_BOOT,
    });

    pending.forEach((name) => {
      toolboxSetModuleState(
        null,
        name,
        'degraded',
        `module boot timeout after ${XZ_TOOLBOX_BOOT_TIMEOUT_MS}ms`,
      );
    });
  }, XZ_TOOLBOX_BOOT_TIMEOUT_MS);
}

async function xzToolboxWaitModuleReady(moduleName, timeoutMs = XZ_TOOLBOX_BOOT_TIMEOUT_MS) {
  const name = String(moduleName || '').trim();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = XZ_TOOLBOX_BOOT.modules[name];
    const storeState = (window.__XZ_TOOLBOX_MODULE_STATES__ || {})[name];
    if (storeState && (storeState.state === 'ready' || storeState.state === 'degraded' || storeState.state === 'failed')) {
      return {
        ok: storeState.state === 'ready',
        failed: storeState.state === 'failed',
        degraded: storeState.state === 'degraded',
        error: storeState.reason || '',
      };
    }
    if (state && state.ready === true) {
      return {
        ok: !state.failed && !state.degraded,
        failed: !!state.failed,
        degraded: !!state.degraded,
        error: state.error || '',
      };
    }

    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  xzToolboxSetModuleFailed(
    name,
    new Error(`wait module ready timeout: ${name}, timeoutMs=${timeoutMs}`),
  );

  return {
    ok: false,
    failed: true,
    degraded: true,
    error: `wait module ready timeout: ${name}`,
  };
}

xzToolboxInstallBootTimeout();

function initToolboxModuleStatesOnBoot() {
  const store = toolboxEnsureModuleStateStore(null);
  ['UploadModule', 'AutoQueueModule'].forEach((moduleName) => {
    if (!store[moduleName]) {
      toolboxSetModuleState(null, moduleName, 'restoring', 'boot init');
    }
  });
}

initToolboxModuleStatesOnBoot();

if (typeof globalThis !== 'undefined') {
  globalThis.TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS = TOOLBOX_MODULE_RECOVERY_TIMEOUT_MS;
  globalThis.toolboxLogError = toolboxLogError;
  globalThis.toolboxTimeoutPromise = toolboxTimeoutPromise;
  globalThis.toolboxRunWithTimeout = toolboxRunWithTimeout;
  globalThis.toolboxEnsureModuleStateStore = toolboxEnsureModuleStateStore;
  globalThis.toolboxSetModuleState = toolboxSetModuleState;
  globalThis.toolboxRefreshTopStatus = toolboxRefreshTopStatus;
  globalThis.toolboxGetRestoringModules = toolboxGetRestoringModules;
  globalThis.buildToolboxModuleStatusText = buildToolboxModuleStatusText;
  globalThis.startToolboxModuleWatchdog = startToolboxModuleWatchdog;
  globalThis.xzToolboxSetModuleReady = xzToolboxSetModuleReady;
  globalThis.xzToolboxSetModuleDegraded = xzToolboxSetModuleDegraded;
  globalThis.xzToolboxSetModuleFailed = xzToolboxSetModuleFailed;
  globalThis.xzToolboxWaitModuleReady = xzToolboxWaitModuleReady;
  globalThis.getToolboxBootStatusText = getToolboxBootStatusText;
  globalThis.xzToolboxGetPendingModules = xzToolboxGetPendingModules;
  globalThis.xzToolboxGetFailedModules = xzToolboxGetFailedModules;
  globalThis.xzToolboxGetDegradedModules = xzToolboxGetDegradedModules;
  globalThis.xzToolboxBootAllReadyOrFailed = xzToolboxBootAllReadyOrFailed;
  globalThis.xzToolboxForceReleaseRestoringModules = xzToolboxForceReleaseRestoringModules;
  globalThis.toolboxGetDegradedModules = toolboxGetDegradedModules;
  globalThis.mountToolboxModuleDegraded = mountToolboxModuleDegraded;
}
