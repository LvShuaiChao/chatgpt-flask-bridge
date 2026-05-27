/********************************************************************
 * 初始化入口：创建工具箱壳并挂载各功能模块
 ********************************************************************/

const CGPT_TOOLBOX_INSTANCE_KEY = '__cgpt_toolbox_active_instance__';

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
    version: '3.6.6',
  };

  return instanceId;
}

async function safeInitStep(name, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    const errText = logError(`[INIT][${name}]`, e);

    const moduleMatch = String(name || '').match(/^(\w+)\.mount:/);
    if (moduleMatch && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_FAILED] module=${moduleMatch[1]} error=${errText}`);
      if (typeof ToolboxShell.setStatus === 'function') {
        ToolboxShell.setStatus(`模块初始化失败：${moduleMatch[1]}：${errText}`, 'error');
      }
    }

    return false;
  }
}

async function mountAllModules(reason = 'init') {
  console.info('[TOOLBOX][MODULE_MOUNT_START]', { reason });

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
    if (typeof ToolboxShell.setStatus === 'function') {
      ToolboxShell.setStatus(`部分模块初始化失败：${failedNames.join('、')}`, 'error');
    }
  }

  if (typeof bindConversationTurnCountObserver === 'function') {
    bindConversationTurnCountObserver();
  }

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_DONE] reason=${reason}`);
  }

  console.info('[TOOLBOX][MODULE_MOUNT_DONE]', { reason, failed: failedNames });
}

async function initToolbox() {
  console.info('[TOOLBOX][BOOT_START] initToolbox called');

  installToolboxInstanceGuard();
  cleanupStaleToolboxDomBeforeInit('init-start');

  try {
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
    console.info('[TOOLBOX][SHELL_CREATED] root created', {
      root: !!rootEl,
      panel: !!document.querySelector('#cgpt-toolbox-panel'),
    });
  } catch (e) {
    const errText = e && e.message ? e.message : String(e);
    console.error('[TOOLBOX][SHELL_CREATE_FAILED]', e);
    logError('[INIT][ToolboxShell.create]', e);
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX][SHELL_CREATE_FAILED] ${errText}`);
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

  await safeInitStep('ReplyDoneTitleFlashWatcher.start', () => {
    ReplyDoneTitleFlashWatcher.start();
  });

  await mountAllModules('init');

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

  await safeInitStep('ToolboxShell.appendLog', () => {
    ToolboxShell.appendLog('工具箱初始化完成');
  });

  await safeInitStep('RuntimeStatsModule.onAppStart', () => {
    if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onAppStart === 'function') {
      RuntimeStatsModule.onAppStart();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initToolbox();
  }, {
    once: true,
  });
} else {
  void initToolbox();
}
