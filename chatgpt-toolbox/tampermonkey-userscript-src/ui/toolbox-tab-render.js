/********************************************************************
 * 工具箱 Tab 渲染：统一 Tab 定义、错误边界、首页兜底
 ********************************************************************/

const TOOLBOX_TABS = [
  { id: 'upload', title: '首页', renderName: 'renderHomePanel', hostId: 'cgpt-upload-tab-host', moduleName: 'UploadModule' },
  { id: 'autoq', title: '自动指令', renderName: 'renderAutoQueuePanel', hostId: 'cgpt-autoq-tab-host', moduleName: 'AutoQueueModule' },
  { id: 'prompt', title: 'Prompt 管理', renderName: 'renderPromptManagerPanel', hostId: 'cgpt-prompt-tab-host', moduleName: 'PromptManagerModule' },
  { id: 'bridge', title: '浏览器桥接', renderName: 'renderBrowserBridgePanel', hostId: 'cgpt-bridge-tab-host', moduleName: 'BridgeModule' },
  { id: 'export', title: '导出统计', renderName: 'renderExportStatsPanel', hostId: 'cgpt-export-tab-host', moduleName: 'ExportModule' },
  { id: 'log', title: '日志', renderName: 'renderLogsPanel', hostId: 'cgpt-log-tab-host', moduleName: 'LogModule' },
  { id: 'settings', title: '设置', renderName: 'renderSettingsPanel', hostId: 'cgpt-settings-tab-host', moduleName: 'SettingsModule' },
];

const TOOLBOX_DEFAULT_TAB_ID = 'upload';
const TOOLBOX_ACTIVE_TAB_STORAGE_KEY = 'xz_toolbox_active_tab_id';

const TOOLBOX_TAB_LEGACY_ALIASES = Object.freeze({
  home: 'upload',
  multi_upload: 'upload',
  upload_tab: 'upload',
  auto_queue: 'autoq',
  auto_continue: 'autoq',
  autoq_tab: 'autoq',
  prompt_manager: 'prompt',
  browser_bridge: 'bridge',
  export_stats: 'export',
  logs: 'log',
  log_tab: 'log',
});

function getValidToolboxTabId(tabId) {
  const raw = String(tabId || '').trim();
  const aliased = TOOLBOX_TAB_LEGACY_ALIASES[raw] || raw;
  const found = TOOLBOX_TABS.find((tab) => tab.id === aliased);
  if (found) {
    return found.id;
  }
  console.warn('[TOOLBOX_TAB][INVALID_ACTIVE_TAB]', {
    input: raw,
    fallback: TOOLBOX_DEFAULT_TAB_ID,
  });
  return TOOLBOX_DEFAULT_TAB_ID;
}

function getStoredToolboxActiveTabId() {
  let stored = '';
  try {
    stored = localStorage.getItem(TOOLBOX_ACTIVE_TAB_STORAGE_KEY) || '';
  } catch (error) {
    console.error('[TOOLBOX_TAB][STORAGE_READ_ERROR]', error);
  }
  if (!stored && typeof getToolboxPageState === 'function') {
    const pageState = getToolboxPageState();
    if (pageState && typeof pageState === 'object' && pageState.activeTab) {
      stored = String(pageState.activeTab || '');
    }
  }
  return getValidToolboxTabId(stored || TOOLBOX_DEFAULT_TAB_ID);
}

function setStoredToolboxActiveTabId(tabId) {
  const validTabId = getValidToolboxTabId(tabId);
  try {
    localStorage.setItem(TOOLBOX_ACTIVE_TAB_STORAGE_KEY, validTabId);
  } catch (error) {
    console.error('[TOOLBOX_TAB][STORAGE_WRITE_ERROR]', error);
  }
  return validTabId;
}

function toolboxTabResolveShell(shell) {
  if (shell) {
    return shell;
  }
  if (typeof ToolboxShell !== 'undefined') {
    return ToolboxShell;
  }
  return window.__XZ_TOOLBOX_SHELL__ || {};
}

function ensureToolboxContentRoot(shell) {
  const resolvedShell = toolboxTabResolveShell(shell);
  if (resolvedShell.contentRoot && document.body.contains(resolvedShell.contentRoot)) {
    return resolvedShell.contentRoot;
  }

  let root = document.querySelector('[data-toolbox-content-root]');
  if (!root) {
    root = document.querySelector('.cgpt-toolbox-content');
  }
  if (root) {
    root.setAttribute('data-toolbox-content-root', '1');
    resolvedShell.contentRoot = root;
    return root;
  }

  const shellRoot = resolvedShell.root
    || document.querySelector('[data-xz-toolbox-root]')
    || document.querySelector('#cgpt-toolbox-root')
    || document.querySelector('.cgpt-toolbox-root')
    || document.querySelector('[data-cgpt-toolbox-root="1"]');

  if (!shellRoot) {
    console.error('[TOOLBOX_CONTENT_ROOT][SHELL_ROOT_MISSING]');
    return null;
  }

  const panel = shellRoot.querySelector('#cgpt-toolbox-panel')
    || shellRoot.querySelector('.cgpt-toolbox-panel');

  root = document.createElement('div');
  root.className = 'cgpt-toolbox-content';
  root.setAttribute('data-toolbox-content-root', '1');
  root.style.minHeight = '260px';
  root.style.padding = '10px';
  root.style.overflow = 'auto';
  root.style.borderTop = '1px solid rgba(255,255,255,0.12)';
  root.style.color = '#e5e7eb';

  if (panel) {
    panel.appendChild(root);
  } else {
    shellRoot.appendChild(root);
  }

  resolvedShell.contentRoot = root;
  console.warn('[TOOLBOX_CONTENT_ROOT][RECREATED]');
  return root;
}

function ensureToolboxTabHost(tabId, shell) {
  const tab = TOOLBOX_TABS.find((item) => item.id === tabId);
  if (!tab) {
    return null;
  }
  ensureToolboxContentRoot(shell);
  let host = document.getElementById(tab.hostId);
  if (host) {
    return host;
  }

  const contentRoot = ensureToolboxContentRoot(shell);
  if (!contentRoot) {
    return null;
  }

  let page = contentRoot.querySelector(`.cgpt-toolbox-page[data-page="${tabId}"]`);
  if (!page) {
    page = document.createElement('div');
    page.className = 'cgpt-toolbox-page';
    page.setAttribute('data-page', tabId);
    contentRoot.appendChild(page);
    console.warn('[TOOLBOX_TAB_HOST][PAGE_RECREATED]', { tabId });
  }

  host = document.createElement('div');
  host.id = tab.hostId;
  page.appendChild(host);
  console.warn('[TOOLBOX_TAB_HOST][RECREATED]', { tabId, hostId: tab.hostId });
  return host;
}

function dispatchToolboxHomeAction(action, source) {
  if (typeof ToolboxActionDispatch !== 'undefined'
    && ToolboxActionDispatch
    && typeof ToolboxActionDispatch.dispatchToolboxAction === 'function') {
    ToolboxActionDispatch.dispatchToolboxAction(action, { source: source || 'toolbox-home-fallback' });
    return true;
  }
  if (typeof UploadModule !== 'undefined' && typeof UploadModule.handleAction === 'function') {
    UploadModule.handleAction(action, { source: source || 'toolbox-home-fallback' });
    return true;
  }
  console.error('[TOOLBOX_ACTION_MISSING]', { action });
  return false;
}

function renderToolboxTabErrorPanel(root, tabId, error) {
  if (!root) {
    console.error('[TOOLBOX_TAB_ERROR_PANEL][ROOT_MISSING]', { tabId });
    return;
  }

  root.innerHTML = '';

  const box = document.createElement('div');
  box.style.border = '1px solid rgba(248,113,113,0.55)';
  box.style.background = 'rgba(127,29,29,0.28)';
  box.style.color = '#fee2e2';
  box.style.borderRadius = '10px';
  box.style.padding = '10px';
  box.style.lineHeight = '1.6';

  const title = document.createElement('div');
  title.textContent = '当前面板渲染失败，已进入兜底模式';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';

  const detail = document.createElement('pre');
  detail.style.whiteSpace = 'pre-wrap';
  detail.style.fontSize = '12px';
  detail.style.margin = '0 0 8px 0';
  detail.textContent = [
    `tabId: ${tabId}`,
    `error: ${error && error.message ? error.message : String(error)}`,
    error && error.stack ? error.stack : '',
  ].join('\n');

  const homeBtn = document.createElement('button');
  homeBtn.textContent = '回到首页';
  homeBtn.style.padding = '5px 10px';
  homeBtn.style.borderRadius = '8px';
  homeBtn.style.border = '1px solid rgba(255,255,255,0.25)';
  homeBtn.style.cursor = 'pointer';
  homeBtn.addEventListener('click', () => {
    const shellRef = window.__XZ_TOOLBOX_SHELL__ || (typeof ToolboxShell !== 'undefined' ? ToolboxShell : {});
    setStoredToolboxActiveTabId('upload');
    renderToolboxActiveTab(shellRef, 'upload');
  });

  box.appendChild(title);
  box.appendChild(detail);
  box.appendChild(homeBtn);
  root.appendChild(box);
}

function renderToolboxEmptyFallbackPanel(root, tabId) {
  if (!root) {
    console.error('[TOOLBOX_EMPTY_FALLBACK][ROOT_MISSING]', { tabId });
    return;
  }

  root.innerHTML = '';

  const box = document.createElement('div');
  box.style.border = '1px solid rgba(250,204,21,0.55)';
  box.style.background = 'rgba(113,63,18,0.25)';
  box.style.color = '#fef3c7';
  box.style.borderRadius = '10px';
  box.style.padding = '10px';
  box.style.lineHeight = '1.6';

  const title = document.createElement('div');
  title.textContent = '当前面板没有输出内容';
  title.style.fontWeight = '700';
  title.style.marginBottom = '6px';

  const desc = document.createElement('div');
  desc.textContent = `tabId=${tabId} 的渲染函数执行后没有生成任何 DOM。请检查该 Tab 的 render 函数是否遗漏 appendChild / innerHTML。`;
  desc.style.fontSize = '12px';

  box.appendChild(title);
  box.appendChild(desc);
  root.appendChild(box);
}

const TOOLBOX_HOME_BUTTON_DEFS = [
  { text: '开始上传', toolboxAction: 'upload_start', action: 'start-upload', id: 'cgpt-upload-start', color: '#16a34a' },
  { text: '发送消息', toolboxAction: 'send', action: 'send-message', id: 'cgpt-send-message-once', color: '#16a34a' },
  { text: '发送+复制+快捷键', toolboxAction: 'combo_send_copy_hotkey', action: 'send-copy-hotkey', id: 'cgpt-send-copy-hotkey-once', color: '#7c3aed' },
  { text: '复制+快捷键', toolboxAction: 'copy_hotkey', action: 'copy-hotkey-once', id: 'cgpt-copy-hotkey-once', color: '#2563eb' },
  { text: '复制并继续', toolboxAction: 'copy_continue', action: 'copy-and-continue', id: 'cgpt-upload-continue-once', color: '#7c3aed' },
  { text: '无限继续', toolboxAction: 'infinite_continue', action: 'auto-continue', id: 'cgpt-auto-continue-once', color: '#0891b2' },
  { text: '无限继续直到完成', toolboxAction: 'infinite_continue_to_done', action: 'auto-continue-until-done', id: 'cgpt-auto-continue-until-done', color: '#0891b2' },
  { text: '复制最后回复', toolboxAction: 'copy_last_reply', action: 'copy-only', id: 'cgpt-copy-last-message-scroll-bottom', color: '#2563eb' },
  { text: '复制日志', toolboxAction: 'copy_log', action: 'copy-log', id: 'cgpt-copy-toolbox-log', color: '#2563eb' },
  { text: '回到首页', toolboxAction: 'back_home', action: 'click-new-chat', id: 'cgpt-open-chatgpt-home', color: '#ea580c' },
  { text: '复制+快捷键+继续', toolboxAction: 'copy_hotkey_continue', action: 'copy-hotkey-continue', id: 'cgpt-copy-hotkey-continue-once', color: '#7c3aed' },
  { text: '无限该条复制+快捷键+继续', toolboxAction: 'infinite_copy_hotkey_continue', action: 'loop-copy-hotkey-continue', id: 'cgpt-copy-hotkey-continue-loop', color: '#0891b2' },
  { text: '闭环-快捷键+每1轮上传', toolboxAction: 'closed_loop_1_upload', action: 'closed-loop-with-hotkey-upload-every-round', id: 'cgpt-closed-loop-upload-every-round-hotkey-btn', closedLoopMode: 'with_hotkey_every_round', color: '#0891b2' },
  { text: '闭环-快捷键+每5轮上传', toolboxAction: 'closed_loop_5_upload', action: 'closed-loop-with-hotkey', id: 'cgpt-closed-loop-upload-every5-hotkey-btn', closedLoopMode: 'with_hotkey', color: '#0891b2' },
  { text: '闭环-仅对话+每5轮上传', toolboxAction: 'closed_loop_dialog_5_upload', action: 'closed-loop-without-hotkey', id: 'cgpt-closed-loop-upload-every5-btn', closedLoopMode: 'without_hotkey', color: '#0891b2' },
];

function renderHomePanel(root, shell) {
  const safeShell = shell || window.__XZ_TOOLBOX_SHELL__ || (typeof ToolboxShell !== 'undefined' ? ToolboxShell : {});

  if (!root) {
    console.error('[HOME_PANEL][ROOT_MISSING]');
    return;
  }

  const uploadModuleRoot = root.querySelector('#cgpt-upload-module');
  if (
    uploadModuleRoot
    && uploadModuleRoot.querySelector('[data-toolbox-home-panel]')
    && uploadModuleRoot.querySelector('.cgpt-section.toolbox-upload-drop-zone')
  ) {
    console.warn('[HOME_PANEL][SKIP_ALREADY_READY]');
    return;
  }

  root.innerHTML = '';
  console.warn('[HOME_PANEL][RENDER_START]');

  const panel = document.createElement('div');
  panel.id = 'cgpt-upload-module';
  panel.setAttribute('data-toolbox-home-panel', '1');
  panel.setAttribute('data-toolbox-home-fallback', '1');

  const actions = document.createElement('div');
  actions.setAttribute('data-toolbox-home-actions', '1');
  actions.style.display = 'flex';
  actions.style.flexWrap = 'wrap';
  actions.style.gap = '6px';
  actions.style.marginBottom = '10px';

  TOOLBOX_HOME_BUTTON_DEFS.forEach((def) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.text;
    btn.setAttribute('data-toolbox-action', def.toolboxAction);
    btn.setAttribute('data-action', def.action);
    if (def.closedLoopMode) {
      btn.setAttribute('data-closed-loop-mode', def.closedLoopMode);
    }
    if (def.id) {
      btn.id = def.id;
    }
    btn.className = 'cgpt-btn';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid rgba(255,255,255,0.18)';
    btn.style.cursor = 'pointer';
    btn.style.color = '#ffffff';
    btn.style.background = def.color;
    actions.appendChild(btn);
  });

  panel.appendChild(actions);

  const uploadButtonsRoot = document.createElement('div');
  uploadButtonsRoot.setAttribute('data-toolbox-upload-buttons-root', '1');
  uploadButtonsRoot.style.display = 'none';
  panel.appendChild(uploadButtonsRoot);
  safeShell.uploadButtonsRoot = uploadButtonsRoot;

  const info = document.createElement('div');
  info.setAttribute('data-toolbox-home-info', '1');
  info.style.border = '1px solid rgba(255,255,255,0.12)';
  info.style.borderRadius = '10px';
  info.style.padding = '10px';
  info.style.color = '#d1d5db';
  info.style.lineHeight = '1.5';
  info.textContent = '首页已加载。上传模块、自动队列模块即使降级，也不应阻塞发送、复制、快捷键和继续按钮。';
  panel.appendChild(info);

  root.appendChild(panel);

  if (typeof safeShell.bindGlobalButtons === 'function') {
    try {
      safeShell.bindGlobalButtons('render-home-panel');
    } catch (error) {
      console.error('[HOME_PANEL][BIND_GLOBAL_BUTTONS_ERROR]', {
        errorMessage: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : '',
      });
    }
  }
  if (typeof safeShell.enableGlobalButtons === 'function') {
    try {
      safeShell.enableGlobalButtons('render-home-panel');
    } catch (error) {
      console.error('[HOME_PANEL][ENABLE_GLOBAL_BUTTONS_ERROR]', {
        errorMessage: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : '',
      });
    }
  }

  console.warn('[HOME_PANEL][RENDER_DONE]', {
    actionCount: actions.querySelectorAll('[data-toolbox-action]').length,
  });
}

function getToolboxTabRenderer(shell, tab) {
  if (!tab) {
    return null;
  }
  if (tab.renderName === 'renderHomePanel') {
    return renderHomePanel;
  }
  if (shell && typeof shell[tab.renderName] === 'function') {
    return shell[tab.renderName];
  }
  if (typeof window[tab.renderName] === 'function') {
    return window[tab.renderName];
  }
  return function renderGenericTabPanel(root, shellRef) {
    const moduleRef = typeof window[tab.moduleName] !== 'undefined' ? window[tab.moduleName] : null;
    if (!moduleRef || typeof moduleRef.mount !== 'function') {
      throw new Error(`tab renderer missing: ${tab.renderName} (${tab.moduleName})`);
    }
    if (root.childNodes.length > 0) {
      return;
    }
    moduleRef.mount(root);
  };
}

function syncToolboxTabButtons(shell, tabsRoot, activeTabId) {
  const scope = tabsRoot
    || (shell && shell.tabsRoot)
    || document.querySelector('[data-toolbox-tabs-root]')
    || document.querySelector('.cgpt-toolbox-tabs');

  if (!scope) {
    console.error('[TOOLBOX_TABS][ROOT_MISSING]');
    return;
  }

  const activeId = getValidToolboxTabId(activeTabId || getStoredToolboxActiveTabId());
  scope.querySelectorAll('.cgpt-toolbox-tab, [data-toolbox-tab-id], [data-tab]').forEach((btn) => {
    const tabId = btn.getAttribute('data-toolbox-tab-id')
      || btn.getAttribute('data-tab')
      || '';
    const isActive = getValidToolboxTabId(tabId) === activeId;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.style.background = '#2563eb';
      btn.style.color = '#ffffff';
    } else {
      btn.style.background = 'rgba(15,23,42,0.85)';
      btn.style.color = '#d1d5db';
    }
  });
}

function renderToolboxTabs(shell, tabsRoot) {
  syncToolboxTabButtons(shell, tabsRoot, getStoredToolboxActiveTabId());
}

function renderToolboxActiveTab(shell, requestedTabId, options = {}) {
  const resolvedShell = toolboxTabResolveShell(shell);
  const tabId = setStoredToolboxActiveTabId(requestedTabId || getStoredToolboxActiveTabId());
  const host = ensureToolboxTabHost(tabId, resolvedShell);

  if (!host) {
    console.error('[TOOLBOX_TAB_RENDER][CONTENT_ROOT_MISSING]', { tabId });
    return;
  }

  const tab = TOOLBOX_TABS.find((item) => item.id === tabId);
  if (!tab) {
    console.error('[TOOLBOX_TAB_RENDER][TAB_NOT_FOUND]', { tabId });
    renderToolboxTabErrorPanel(host, tabId, new Error('tab not found'));
    return;
  }

  if (typeof resolvedShell.__applySwitchTabChrome === 'function') {
    resolvedShell.__applySwitchTabChrome(tabId, options);
  } else if (typeof resolvedShell.switchTab === 'function') {
    resolvedShell.switchTab(tabId, { ...options, _skipRender: true });
  }

  syncToolboxTabButtons(resolvedShell, null, tabId);

  console.warn('[TOOLBOX_TAB_RENDER][START]', {
    tabId,
    title: tab.title,
    renderName: tab.renderName,
  });

  const beforeChildCount = host.childNodes.length;

  try {
    const renderer = getToolboxTabRenderer(resolvedShell, tab);
    if (typeof renderer !== 'function') {
      throw new Error(`tab renderer missing: ${tab.renderName}`);
    }

    const result = renderer.call(resolvedShell, host, resolvedShell);

    if (result instanceof Promise) {
      result
        .then(() => {
          if (host.childNodes.length === 0 && beforeChildCount === 0) {
            console.error('[TOOLBOX_TAB_RENDER][EMPTY_AFTER_ASYNC]', {
              tabId,
              renderName: tab.renderName,
            });
            renderToolboxEmptyFallbackPanel(host, tabId);
          }
          console.warn('[TOOLBOX_TAB_RENDER][ASYNC_DONE]', {
            tabId,
            childCount: host.childNodes.length,
          });
        })
        .catch((error) => {
          console.error('[TOOLBOX_TAB_RENDER][ASYNC_ERROR]', {
            tabId,
            renderName: tab.renderName,
            errorMessage: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : '',
          });
          renderToolboxTabErrorPanel(host, tabId, error);
        });
      return;
    }

    if (host.childNodes.length === 0 && beforeChildCount === 0) {
      console.error('[TOOLBOX_TAB_RENDER][EMPTY_AFTER_SYNC]', {
        tabId,
        renderName: tab.renderName,
      });
      renderToolboxEmptyFallbackPanel(host, tabId);
      return;
    }

    console.warn('[TOOLBOX_TAB_RENDER][DONE]', {
      tabId,
      childCount: host.childNodes.length,
    });
  } catch (error) {
    console.error('[TOOLBOX_TAB_RENDER][SYNC_ERROR]', {
      tabId,
      renderName: tab.renderName,
      errorMessage: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : '',
    });
    renderToolboxTabErrorPanel(host, tabId, error);
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.TOOLBOX_TABS = TOOLBOX_TABS;
  globalThis.TOOLBOX_DEFAULT_TAB_ID = TOOLBOX_DEFAULT_TAB_ID;
  globalThis.TOOLBOX_ACTIVE_TAB_STORAGE_KEY = TOOLBOX_ACTIVE_TAB_STORAGE_KEY;
  globalThis.getValidToolboxTabId = getValidToolboxTabId;
  globalThis.getStoredToolboxActiveTabId = getStoredToolboxActiveTabId;
  globalThis.setStoredToolboxActiveTabId = setStoredToolboxActiveTabId;
  globalThis.ensureToolboxContentRoot = ensureToolboxContentRoot;
  globalThis.ensureToolboxTabHost = ensureToolboxTabHost;
  globalThis.renderToolboxTabErrorPanel = renderToolboxTabErrorPanel;
  globalThis.renderToolboxEmptyFallbackPanel = renderToolboxEmptyFallbackPanel;
  globalThis.renderHomePanel = renderHomePanel;
  globalThis.renderToolboxTabs = renderToolboxTabs;
  globalThis.syncToolboxTabButtons = syncToolboxTabButtons;
  globalThis.renderToolboxActiveTab = renderToolboxActiveTab;
}
