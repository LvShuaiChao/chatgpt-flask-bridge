  /********************************************************************
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
    function collectAdvancedDebugSnapshot(source = 'manual', options = {}) {
      const full = options.full === true;
      const now = Date.now();
      const snapshot = {
        source,
        time: new Date(now).toLocaleString(),
        url: location.href,
        title: document.title,
        page: collectSectionSafeSafe('page', collectPageDebugStateSafe),
        autoQueue: collectSectionSafeSafe('autoQueue', collectAutoQueueDebugStateSafe),
        upload: collectSectionSafeSafe('upload', collectUploadDebugStateSafe),
        terminal: collectSectionSafeSafe('terminal', collectTerminalDebugStateSafe),
        quota: collectSectionSafeSafe('quota', collectQuotaDebugStateSafe),
        timers: collectSectionSafeSafe('timers', collectTimerDebugStateSafe),
      };
      snapshot.layout = collectSectionSafeSafe('layout', () => {
        if (
          typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.collectLayoutDebugInfo === 'function'
        ) {
          return ToolboxShell.collectLayoutDebugInfo();
        }
        return { error: 'ToolboxShell.collectLayoutDebugInfo unavailable' };
      });

      if (full) {
        snapshot.composer = collectSectionSafeSafe('composer', collectComposerDebugStateSafe);
        snapshot.buttons = collectSectionSafeSafe('buttons', collectButtonDebugStateSafe);
        snapshot.reply = collectSectionSafeSafe('reply', () => collectReplyDebugStateSafe({ full: true }));
      } else {
        snapshot.composer = { skipped: true, reason: 'light-mode' };
        snapshot.buttons = { skipped: true, reason: 'light-mode' };
        snapshot.reply = collectSectionSafeSafe('reply', () => collectReplyDebugStateSafe({ full: false }));
      }
      state.advancedDebugLastSnapshot = snapshot;
      state.advancedDebugLastUpdatedAt = now;
      return snapshot;
    }

    function formatAdvancedDebugSnapshot(snapshot) {
      return [
        `更新时间：${snapshot.time}`,
        `来源：${snapshot.source}`,
        `URL：${snapshot.url}`,
        '',
        '【布局诊断】',
        JSON.stringify(snapshot.layout, null, 2),
        '',
        '【页面状态】',
        JSON.stringify(snapshot.page, null, 2),
        '',
        '【Composer 状态】',
        JSON.stringify(snapshot.composer, null, 2),
        '',
        '【按钮检测】',
        JSON.stringify(snapshot.buttons, null, 2),
        '',
        '【批量任务状态】',
        JSON.stringify(snapshot.autoQueue, null, 2),
        '',
        '【上传状态】',
        JSON.stringify(snapshot.upload, null, 2),
        '',
        '【回复识别】',
        JSON.stringify(snapshot.reply, null, 2),
        '',
        '【终止/二次验证状态】',
        JSON.stringify(snapshot.terminal, null, 2),
        '',
        '【限额状态】',
        JSON.stringify(snapshot.quota, null, 2),
        '',
        '【定时器状态】',
        JSON.stringify(snapshot.timers, null, 2),
      ].join('\n');
    }

    function refreshAdvancedDebugPanel(source = 'manual', options = {}) {
      const panel = document.querySelector('#xz-autoq-advanced-debug-panel');
      const content = panel ? panel.querySelector('.xz-autoq-advanced-debug-content') : null;
      if (!panel || !content) {
        return;
      }
      try {
        const snapshot = collectAdvancedDebugSnapshot(source, options);
        content.innerHTML = buildGroupedAdvancedDebugPanelHtmlSafe(snapshot);
        syncAdvancedDebugAutoRefreshButton();
        if (source !== 'status-render') {
          appendLogSafe(`[AUTOQ][ADV_DEBUG][REFRESH] source=${source}`);
        }
      } catch (error) {
        const errText = error && error.stack ? error.stack : String(error);
        console.error('[ChatGPT toolbox] advanced debug render failed', error);
        appendLogSafe(`[AUTOQ][ADV_DEBUG][RENDER_FAILED] error=${errText}`);
      }
    }

    function maybeRefreshAdvancedDebugPanel(source = 'render') {
      if (!state.advancedDebugVisible) {
        return;
      }
      const settings = config && config.taskQueueSettings ? config.taskQueueSettings : {};
      const autoRefresh = settings.advancedDebugAutoRefresh === true;
      if (!autoRefresh) {
        return;
      }
      const now = Date.now();
      const intervalMs = Math.max(
        1000,
        Math.min(2000, Number(settings.advancedDebugRefreshIntervalMs || 1500) || 1500),
      );
      if (now - Number(state.advancedDebugLastUpdatedAt || 0) < intervalMs) {
        return;
      }
      refreshAdvancedDebugPanel(source);
    }

    function syncAdvancedDebugAutoRefreshButton() {
      const btn = document.querySelector('#xz-autoq-advanced-debug-auto-refresh-btn');
      if (!btn) {
        return;
      }
      const settings = config && config.taskQueueSettings ? config.taskQueueSettings : {};
      const enabled = settings.advancedDebugAutoRefresh === true;
      btn.textContent = enabled ? '自动刷新：开' : '自动刷新：关';
      btn.classList.toggle('active', enabled);
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    function toggleAdvancedDebugAutoRefresh() {
      if (!config.taskQueueSettings || typeof config.taskQueueSettings !== 'object') {
        config.taskQueueSettings = createDefaultTaskQueueSettingsSafe();
      }
      config.taskQueueSettings.advancedDebugAutoRefresh = !config.taskQueueSettings.advancedDebugAutoRefresh;
      saveConfigSafe();
      syncAdvancedDebugAutoRefreshButton();
      appendLogSafe(
        `[ADV_DEBUG][AUTO_REFRESH_TOGGLE] enabled=${config.taskQueueSettings.advancedDebugAutoRefresh ? 1 : 0}`,
      );
    }

    function toggleAdvancedDebugPanel() {
      state.advancedDebugVisible = !state.advancedDebugVisible;
      const host = getAdvancedDebugHostElementSafe();
      if (host) {
        ensureAdvancedDebugPanelDomSafe(host);
      } else {
        appendLogSafe('[ADV_DEBUG][TOGGLE_WARN] reason=debug-host-missing');
      }
      const resolvedPanel = document.querySelector('#xz-autoq-advanced-debug-panel');
      if (resolvedPanel) {
        resolvedPanel.style.display = state.advancedDebugVisible ? 'block' : 'none';
      } else {
        appendLogSafe('[ADV_DEBUG][TOGGLE_WARN] reason=panel-missing-after-ensure');
      }
      ensureAdvancedDebugToggleButtonDomSafe(buildAutoQueueDebugEntryStatusStateSafe());
      syncAdvancedDebugToggleButtonSafe(buildAutoQueueDebugEntryStatusStateSafe());
      appendLogSafe(`[AUTOQ][ADV_DEBUG][TOGGLE] source=autoq-action-bar visible=${state.advancedDebugVisible ? 1 : 0}`);
      if (state.advancedDebugVisible) {
        refreshAdvancedDebugPanel('toggle-open', { full: true });
      }
    }

    async function copyAdvancedDebugPanelState() {
      const snapshot = collectAdvancedDebugSnapshot('copy', { full: true });
      const text = formatAdvancedDebugSnapshot(snapshot);
      try {
        if (typeof copyWithStatus === 'function') {
          const ok = await copyWithStatusSafe({
            text,
            successText: '已复制高级状态',
            failedPrefix: '复制高级状态失败',
            logPrefix: 'ADV_DEBUG_COPY',
            playSuccessBeep: false,
            statusOwner: 'autoq-adv-debug',
          });
          appendLogSafe(`[ADV_DEBUG][COPY] ok=${ok ? 1 : 0} length=${text.length}`);
          return ok;
        }
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
          throw new Error('clipboard API unavailable');
        }
        await navigator.clipboard.writeText(text);
        appendLogSafe(`[ADV_DEBUG][COPY] ok=1 length=${text.length}`);
        return true;
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        appendLogSafe(`[ADV_DEBUG][COPY_ERROR] error=${message}`);
        console.error('[ADV_DEBUG][COPY_ERROR]', error);
        return false;
      }
    }

    function handleAdvancedDebugPanelAction(action) {
      if (action === 'refresh') {
        refreshAdvancedDebugPanel('manual-refresh', { full: false });
        return;
      }
      if (action === 'snapshot') {
        refreshAdvancedDebugPanel('diagnostic-snapshot', { full: true });
        return;
      }
      if (action === 'toggle-auto-refresh') {
        toggleAdvancedDebugAutoRefresh();
        return;
      }
      if (action === 'copy') {
        void copyAdvancedDebugPanelState();
      }
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


