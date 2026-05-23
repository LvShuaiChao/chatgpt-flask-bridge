/********************************************************************
 * 初始化入口：创建工具箱壳并挂载各功能模块
 ********************************************************************/

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

  if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
    ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_DONE] reason=${reason}`);
  }
}

async function initToolbox() {
  await safeInitStep('ToolboxShell.create', () => {
    ToolboxShell.create();
  });

  await safeInitStep('TitlePrefixModule.start', () => {
    TitlePrefixModule.start();
  });

  await safeInitStep('ReplyDoneTitleFlashWatcher.start', () => {
    ReplyDoneTitleFlashWatcher.start();
  });

  await mountAllModules('init');

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
