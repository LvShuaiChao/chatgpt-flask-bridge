  function msToSecondsForUi(ms, fallbackSec = 0) {
    const n = Number(ms);
    if (!Number.isFinite(n)) {
      return fallbackSec;
    }
    return n / 1000;
  }

  function secondsToMsForStore(sec, fallbackSec = 0, minSec = 0, maxSec = 600) {
    let n = Number(sec);
    if (!Number.isFinite(n)) {
      n = fallbackSec;
    }
    n = Math.max(minSec, Math.min(maxSec, n));
    return Math.round(n * 1000);
  }

  /********************************************************************
   * 5b. SettingsModule：精简模式与工具箱设置
   ********************************************************************/

  const SettingsModule = (() => {
    let host = null;
    let root = null;
    let activeSettingsSubtab = 'toolbox';
    let continuePromptMigrationChecked = false;

    function setSettingsStatus(text, type, options = {}) {
      if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.setStatus !== 'function') {
        return;
      }
      ToolboxShell.setStatus(text, type, {
        ...options,
        owner: options.owner || 'settings',
      });
    }

    function renderDefaultContinuePromptForSettings(stopSignal) {
      const template = typeof getDefaultContinuePromptText === 'function'
        ? getDefaultContinuePromptText()
        : (typeof getDefaultBatchContinuePromptText === 'function'
          ? getDefaultBatchContinuePromptText()
          : '');
      const signal = String(stopSignal || '').trim()
        || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '');
      if (typeof renderContinuePromptTemplate === 'function') {
        return renderContinuePromptTemplate(template, signal);
      }
      return String(template || '').trim();
    }

    function getContinuePromptTextForSettingsDisplay(cfg) {
      const stored = String(cfg && cfg.copyHotkeyContinuePromptText || '').trim();
      if (stored) {
        return stored;
      }
      const signal = String(cfg && cfg.copyHotkeyContinueStopSignal || '').trim()
        || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '');
      return renderDefaultContinuePromptForSettings(signal);
    }

    function isSettingsContinuePromptUsingBuiltinDefault(rawText, stopSignal) {
      const trimmed = String(rawText || '').trim();
      if (!trimmed) {
        return true;
      }
      const defaultRendered = renderDefaultContinuePromptForSettings(stopSignal);
      if (trimmed === defaultRendered) {
        return true;
      }
      const defaultTemplate = typeof getDefaultContinuePromptText === 'function'
        ? getDefaultContinuePromptText()
        : '';
      return !!defaultTemplate && trimmed === String(defaultTemplate || '').trim();
    }

    function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {
      if (!cfg || typeof cfg !== 'object') {
        return cfg;
      }
      if (typeof migrateContinuePromptTextIfNeeded !== 'function') {
        return cfg;
      }

      const stored = String(cfg.copyHotkeyContinuePromptText || '').trim();
      const logFn = options.log === false
        ? null
        : (line) => ToolboxShell.appendLog(line);
      const migration = migrateContinuePromptTextIfNeeded(stored, logFn);

      if (migration.migrated) {
        cfg.copyHotkeyContinuePromptText = migration.value;
      }

      return cfg;
    }

    function getConfig() {
      const saved = typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.get === 'function'
        ? CompactUiConfigStore.get()
        : normalizeCompactUiConfig(MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {});
      let cfg = normalizeCompactUiConfig(saved);

      if (saved && !saved.quickPromptActionVersion && saved.quickPromptClickAction === 'fill') {
        cfg.quickPromptClickAction = 'send';
        cfg.quickPromptActionVersion = 1;
        if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
          CompactUiConfigStore.save(cfg);
        } else {
          MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
        }
        cfg = normalizeCompactUiConfig(cfg);
      }

      if (!continuePromptMigrationChecked) {
        continuePromptMigrationChecked = true;
        const before = String(cfg.copyHotkeyContinuePromptText || '').trim();
        cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });
        const after = String(cfg.copyHotkeyContinuePromptText || '').trim();
        if (before !== after) {
          if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
            CompactUiConfigStore.save(cfg);
          } else {
            MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
          }
        }
      }

      return cfg;
    }

    function getAutoQueueTaskQueueSettings() {
      if (typeof AutoQueueModule === 'undefined' || typeof AutoQueueModule.getConfig !== 'function') {
        return typeof createDefaultTaskQueueSettings === 'function'
          ? createDefaultTaskQueueSettings()
          : {};
      }
      const autoCfg = AutoQueueModule.getConfig();
      return autoCfg && autoCfg.taskQueueSettings && typeof autoCfg.taskQueueSettings === 'object'
        ? autoCfg.taskQueueSettings
        : (typeof createDefaultTaskQueueSettings === 'function' ? createDefaultTaskQueueSettings() : {});
    }

    function saveAutoQueueTaskQueueSettings(patch) {
      if (typeof AutoQueueModule === 'undefined' || typeof AutoQueueModule.getConfig !== 'function' || typeof AutoQueueModule.applyConfig !== 'function') {
        return;
      }
      const autoCfg = AutoQueueModule.getConfig();
      autoCfg.taskQueueSettings = Object.assign({}, autoCfg.taskQueueSettings || {}, patch || {});
      AutoQueueModule.applyConfig(autoCfg);
      if (typeof MemoryManager !== 'undefined' && MemoryManager.KEYS && MemoryManager.KEYS.autoQueueConfig) {
        MemoryManager.set(MemoryManager.KEYS.autoQueueConfig, autoCfg);
      }
      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onSettingsChanged === 'function') {
        RuntimeStatsModule.onSettingsChanged();
      }
    }

    function readRuntimeStatsSettingsFromUi() {
      const showEl = qs('#cgpt-setting-runtime-stats-show', root);
      const preserveEl = qs('#cgpt-setting-runtime-stats-preserve-average', root);
      const intervalEl = qs('#cgpt-setting-runtime-stats-refresh-interval', root);
      const debugTraceEl = qs('#cgpt-setting-autoq-trace-debug', root);
      const intervalMs = Number(intervalEl && intervalEl.value ? intervalEl.value : 1000);
      const allowed = [1000, 2000, 5000];

      return {
        showRuntimeStats: showEl ? !!showEl.checked : true,
        preserveRuntimeStatsAverage: preserveEl ? !!preserveEl.checked : false,
        runtimeStatsRefreshIntervalMs: allowed.includes(intervalMs) ? intervalMs : 1000,
        debugAutoQueueTrace: debugTraceEl ? !!debugTraceEl.checked : false,
      };
    }

    function saveRuntimeStatsSettingsFromUi() {
      const patch = readRuntimeStatsSettingsFromUi();
      saveAutoQueueTaskQueueSettings(patch);
      ToolboxShell.appendLog(
        `[SETTINGS][runtime-stats] show=${patch.showRuntimeStats ? 1 : 0} preserveAverage=${patch.preserveRuntimeStatsAverage ? 1 : 0} intervalMs=${patch.runtimeStatsRefreshIntervalMs} autoqTrace=${patch.debugAutoQueueTrace ? 1 : 0}`,
      );
    }

    function saveConfig(next) {
      const cfg = migrateCompactContinuePromptIfNeeded(
        normalizeCompactUiConfig(next || {}),
        { log: false },
      );
      cfg.quickPromptActionVersion = 1;
      cfg.quickPromptClickAction = 'send';
      if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
        CompactUiConfigStore.save(cfg);
      } else {
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
      }

      ToolboxShell.appendLog(
        `[SETTINGS][quickPrompt] upload=${cfg.showUploadQuickPrompts !== false} compact=${cfg.showCompactQuickPrompts !== false} confirmOverwrite=${cfg.confirmPromptDraftOverwrite ? 1 : 0} selected=${(cfg.quickPromptIds || []).length}`,
      );

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
        UploadModule.renderToolboxTopStatus();
      }
    }

    function parseQuotaLimitInput(raw) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return Math.min(10000, Math.floor(n));
    }

    function readQuotaLimitsFromUi() {
      const current = getConfig();
      const uploadEl = qs('#cgpt-setting-upload-quota-limit', root);
      const messageEl = qs('#cgpt-setting-message-quota-limit', root);

      const uploadLimit = parseQuotaLimitInput(uploadEl && uploadEl.value);
      const messageLimit = parseQuotaLimitInput(messageEl && messageEl.value);

      return {
        uploadQuotaMaxFiles: uploadLimit != null ? uploadLimit : current.uploadQuotaMaxFiles,
        messageQuotaMaxMessages: messageLimit != null ? messageLimit : current.messageQuotaMaxMessages,
      };
    }

    function saveQuotaSettingsFromUi() {
      const limits = readQuotaLimitsFromUi();
      const uploadEl = qs('#cgpt-setting-upload-quota-limit', root);
      const messageEl = qs('#cgpt-setting-message-quota-limit', root);

      if (
        parseQuotaLimitInput(uploadEl && uploadEl.value) == null
        || parseQuotaLimitInput(messageEl && messageEl.value) == null
      ) {
        setSettingsStatus('额度上限必须是大于 0 的整数', 'warn');
        return false;
      }

      const current = getConfig();
      const next = Object.assign({}, current, limits);
      saveConfig(next);
      render();

      ToolboxShell.appendLog(
        `[SETTINGS][QUOTA_SAVE] uploadLimit=${limits.uploadQuotaMaxFiles} messageLimit=${limits.messageQuotaMaxMessages}`,
      );
      setSettingsStatus('额度设置已保存', 'ok');
      return true;
    }

    function resetQuotaStatsFromUi() {
      const uploadBefore = (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getUploadQuotaState === 'function'
      )
        ? UploadModule.getUploadQuotaState()
        : { used: 0 };
      const messageBefore = (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getMessageQuotaState === 'function'
      )
        ? UploadModule.getMessageQuotaState()
        : { used: 0 };

      const confirmed = window.confirm(
        '确定要重置今日上传额度和消息额度统计吗？这只会重置工具箱内部统计，不会影响 ChatGPT 官方额度。',
      );
      if (!confirmed) {
        return;
      }

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.clearUploadQuotaRecords === 'function'
      ) {
        UploadModule.clearUploadQuotaRecords('settings-quota-reset');
      }
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.clearMessageQuotaRecords === 'function'
      ) {
        UploadModule.clearMessageQuotaRecords('settings-quota-reset');
      }

      ToolboxShell.appendLog(
        `[SETTINGS][QUOTA_RESET] uploadUsedBefore=${uploadBefore.used} messageUsedBefore=${messageBefore.used}`,
      );
      setSettingsStatus('今日额度统计已重置', 'ok');
    }

    function readFromUi() {
      const current = getConfig();

      const quickPromptInputs = qsa('[data-compact-prompt-id]', root);
      const quickPromptIds = quickPromptInputs.length
        ? quickPromptInputs
            .filter((x) => x.checked)
            .map((x) => x.getAttribute('data-compact-prompt-id'))
            .filter(Boolean)
        : Array.isArray(current.quickPromptIds)
          ? current.quickPromptIds.slice()
          : [];

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      const compactQuickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);
      const promptActionEl = qs('#cgpt-setting-compact-prompt-action', root);
      const confirmOverwriteEl = qs('#cgpt-setting-confirm-prompt-draft-overwrite', root);

      const showUploadQuickPrompts = uploadQuickEl
        ? !!uploadQuickEl.checked
        : current.showUploadQuickPrompts !== false;

      const showCompactQuickPrompts = compactQuickEl
        ? !!compactQuickEl.checked
        : current.showCompactQuickPrompts !== false;

      // 多文件上传页常用 Prompt 固定填入并发送；不再从设置项读取 fill。
      const quickPromptClickAction = 'send';
      if (promptActionEl) {
        promptActionEl.value = 'send';
      }

      const confirmPromptDraftOverwrite = confirmOverwriteEl
        ? !!confirmOverwriteEl.checked
        : current.confirmPromptDraftOverwrite === true;

      return {
        showUploadGroups: !!qs(SettingsSelectors.showUploadGroups, root)?.checked,
        showUploadStartButton: !!qs(SettingsSelectors.showUploadStart, root)?.checked,
        showUploadFileList: !!qs(SettingsSelectors.showFileList, root)?.checked,
        showUploadQuickPrompts,
        showCompactQuickPrompts,
        quickPromptClickAction,
        confirmPromptDraftOverwrite,
        quickPromptActiveCategory: current.quickPromptActiveCategory || '全部',
        quickPromptIds,
        globalDropCaptureEnabled: !!qs('#cgpt-setting-global-drop-capture', root)?.checked,
        restoreScrollAfterCopyLastMessage: !!qs('#cgpt-setting-restore-scroll-after-copy', root)?.checked,
        continueAutomation: (() => {
          const minEl = qs('#cgpt-setting-closed-loop-next-delay-min-sec', root);
          const maxEl = qs('#cgpt-setting-closed-loop-next-delay-max-sec', root);
          const rawMinSec = minEl ? String(minEl.value).trim() : '';
          const rawMaxSec = maxEl ? String(maxEl.value).trim() : '';
          const fallbackMinMs = Number(current.continueAutomation?.closedLoopNextDelayMinMs);
          const fallbackMaxMs = Number(current.continueAutomation?.closedLoopNextDelayMaxMs);
          const fallbackMinSec = Number.isFinite(fallbackMinMs) ? fallbackMinMs / 1000 : 40;
          const fallbackMaxSec = Number.isFinite(fallbackMaxMs) ? fallbackMaxMs / 1000 : 60;
          let minSec = rawMinSec === '' ? fallbackMinSec : Number(rawMinSec);
          let maxSec = rawMaxSec === '' ? fallbackMaxSec : Number(rawMaxSec);
          const minMsSaved = secondsToMsForStore(minSec, 40, 1, 600);
          const maxMsSaved = secondsToMsForStore(maxSec, 60, 1, 600);
          minSec = Math.round(minMsSaved / 1000);
          maxSec = Math.round(maxMsSaved / 1000);
          if (minMsSaved > maxMsSaved) {
            ToolboxShell.appendLog(
              `[CLOSED_LOOP][NEXT_DELAY_CONFIG_SAVE_SWAPPED] minSec=${minSec} maxSec=${maxSec} correctedMinMs=${maxMsSaved} correctedMaxMs=${minMsSaved}`,
            );
          }
          const minMsFinal = Math.min(minMsSaved, maxMsSaved);
          const maxMsFinal = Math.max(minMsSaved, maxMsSaved);
          ToolboxShell.appendLog(
            `[SETTINGS][closed-loop-next-delay-save] minSec=${Math.round(minMsFinal / 1000)} maxSec=${Math.round(maxMsFinal / 1000)} minMs=${minMsFinal} maxMs=${maxMsFinal}`,
          );
          return {
          autoUploadEnabled: !!qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root)?.checked,
          autoUploadInterval: Number(
            qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root)?.value
            || current.continueAutomation?.autoUploadInterval
            || 5,
          ),
          closedLoopNextDelayMinMs: minMsFinal,
          closedLoopNextDelayMaxMs: maxMsFinal,
          closedLoopNextDelayMs: minMsFinal,
          homeNavEnabled: !!(
            qs('#cgpt-setting-unified-continue-home-nav-enabled', root)
            || qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root)
          )?.checked,
          homeNavInterval: Number(
            qs('#cgpt-setting-unified-continue-home-nav-interval', root)?.value
            || qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root)?.value
            || current.continueAutomation?.homeNavInterval
            || 20,
          ),
          homeNavUrl: String(
            qs('#cgpt-setting-unified-continue-home-nav-url', root)?.value
            || qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root)?.value
            || current.continueAutomation?.homeNavUrl
            || 'https://chatgpt.com/',
          ).trim(),
          };
        })(),
        copyHotkeyContinuePromptText: (() => {
          const raw = String(qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root)?.value || '').trim();
          const stopSignal = String(qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root)?.value || '').trim()
            || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>');
          if (isSettingsContinuePromptUsingBuiltinDefault(raw, stopSignal)) {
            return '';
          }
          return raw;
        })(),
        copyHotkeyContinueStopSignal: String(qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root)?.value || '').trim()
          || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>'),
      };
    }

    function normalizeSettingsSubtabName(name) {
      const raw = String(name || '').trim();
      const alias = {
        basic: 'toolbox',
        ui: 'continue-task',
        'batch-timing': 'stats-debug',
      };
      const normalized = alias[raw] || raw;
      const allowed = new Set([
        'toolbox',
        'shortcut',
        'continue-task',
        'quota-notify',
        'stats-debug',
      ]);
      return allowed.has(normalized) ? normalized : 'toolbox';
    }

    function renderSettingsSubtabs() {
      if (!root) return;
      activeSettingsSubtab = normalizeSettingsSubtabName(activeSettingsSubtab);

      const tabs = qsa('[data-settings-subtab]', root);
      const panels = qsa('[data-settings-panel]', root);

      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-settings-subtab') || 'toolbox';
        btn.classList.toggle('active', name === activeSettingsSubtab);
      });

      panels.forEach((panelEl) => {
        const name = panelEl.getAttribute('data-settings-panel') || 'toolbox';
        panelEl.style.display = name === activeSettingsSubtab ? '' : 'none';
      });
    }

    function render() {
      if (!root) return;

      renderSettingsSubtabs();

      const cfg = getConfig();

      const groupsEl = qs(SettingsSelectors.showUploadGroups, root);
      if (groupsEl) {
        groupsEl.checked = cfg.showUploadGroups !== false;
        groupsEl.disabled = false;
      }

      const startEl = qs(SettingsSelectors.showUploadStart, root);
      if (startEl) {
        startEl.checked = !!cfg.showUploadStartButton;
        startEl.disabled = false;
      }

      const fileListEl = qs(SettingsSelectors.showFileList, root);
      if (fileListEl) {
        fileListEl.checked = !!cfg.showUploadFileList;
        fileListEl.disabled = false;
      }

      const globalDropEl = qs('#cgpt-setting-global-drop-capture', root);
      if (globalDropEl) globalDropEl.checked = !!cfg.globalDropCaptureEnabled;

      const restoreScrollEl = qs('#cgpt-setting-restore-scroll-after-copy', root);
      if (restoreScrollEl) {
        restoreScrollEl.checked = cfg.restoreScrollAfterCopyLastMessage === true;
      }

      const loopAutoUploadEnabledEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root);
      if (loopAutoUploadEnabledEl) {
        loopAutoUploadEnabledEl.checked = cfg.continueAutomation?.autoUploadEnabled !== false;
      }

      const loopAutoUploadIntervalEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root);
      if (loopAutoUploadIntervalEl) {
        loopAutoUploadIntervalEl.value = String(cfg.continueAutomation?.autoUploadInterval || 5);
      }

      const closedLoopNextDelayMinEl = qs('#cgpt-setting-closed-loop-next-delay-min-sec', root);
      const closedLoopNextDelayMaxEl = qs('#cgpt-setting-closed-loop-next-delay-max-sec', root);
      if (closedLoopNextDelayMinEl || closedLoopNextDelayMaxEl) {
        const continueCfg = cfg.continueAutomation && typeof cfg.continueAutomation === 'object'
          ? cfg.continueAutomation
          : {};
        const minMs = Number(continueCfg.closedLoopNextDelayMinMs || 40000);
        const maxMs = Number(continueCfg.closedLoopNextDelayMaxMs || 60000);
        const minSec = Math.max(1, Math.round(msToSecondsForUi(minMs, 40)));
        const maxSec = Math.max(1, Math.round(msToSecondsForUi(maxMs, 60)));
        if (closedLoopNextDelayMinEl) {
          closedLoopNextDelayMinEl.value = String(minSec);
        }
        if (closedLoopNextDelayMaxEl) {
          closedLoopNextDelayMaxEl.value = String(maxSec);
        }
        ToolboxShell.appendLog(
          `[SETTINGS][closed-loop-delay-render] minMs=${minMs} maxMs=${maxMs} minSec=${minSec} maxSec=${maxSec} uiUnit=sec`,
        );
      }

      const unifiedHomeNavEnabled = cfg.continueAutomation?.homeNavEnabled !== false;
      const unifiedHomeNavInterval = Number(cfg.continueAutomation?.homeNavInterval || 20);
      const unifiedHomeNavUrl = cfg.continueAutomation?.homeNavUrl || 'https://chatgpt.com/';

      const loopHomeNavEnabledEl = qs('#cgpt-setting-unified-continue-home-nav-enabled', root)
        || qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root);
      if (loopHomeNavEnabledEl) {
        loopHomeNavEnabledEl.checked = unifiedHomeNavEnabled;
      }

      const loopHomeNavIntervalEl = qs('#cgpt-setting-unified-continue-home-nav-interval', root)
        || qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root);
      if (loopHomeNavIntervalEl) {
        loopHomeNavIntervalEl.value = String(unifiedHomeNavInterval);
      }

      const loopHomeNavUrlEl = qs('#cgpt-setting-unified-continue-home-nav-url', root)
        || qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root);
      if (loopHomeNavUrlEl) {
        loopHomeNavUrlEl.value = unifiedHomeNavUrl;
      }

      const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
      if (stopSignalEl) {
        stopSignalEl.value = cfg.copyHotkeyContinueStopSignal
          || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>');
      }

      const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
      if (promptTextEl) {
        const stopSignalForDisplay = cfg.copyHotkeyContinueStopSignal
          || (typeof getDefaultDoneSignal === 'function' ? getDefaultDoneSignal() : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>');
        promptTextEl.value = getContinuePromptTextForSettingsDisplay(cfg);
        promptTextEl.placeholder = `留空则使用内置默认继续指令。默认继续指令会要求：若任务涉及代码修改/修复/重构/Bug 定位/UI 状态/闭环控制/上传逻辑/日志排查，必须输出详细 Cursor / Claude Code 修改指令，并列出文件路径、函数名、关键代码、日志和验证步骤。完成时仅回复 ${stopSignalForDisplay}。默认继续指令已包含详细 Cursor / Claude Code 修改要求。`;
      }

      const runtimeStatsCfg = getAutoQueueTaskQueueSettings();
      const runtimeStatsShowEl = qs('#cgpt-setting-runtime-stats-show', root);
      if (runtimeStatsShowEl) {
        runtimeStatsShowEl.checked = runtimeStatsCfg.showRuntimeStats !== false;
      }
      const runtimeStatsPreserveEl = qs('#cgpt-setting-runtime-stats-preserve-average', root);
      if (runtimeStatsPreserveEl) {
        runtimeStatsPreserveEl.checked = runtimeStatsCfg.preserveRuntimeStatsAverage === true;
      }
      const runtimeStatsIntervalEl = qs('#cgpt-setting-runtime-stats-refresh-interval', root);
      if (runtimeStatsIntervalEl) {
        runtimeStatsIntervalEl.value = String(runtimeStatsCfg.runtimeStatsRefreshIntervalMs || 1000);
      }
      const debugTraceEl = qs('#cgpt-setting-autoq-trace-debug', root);
      if (debugTraceEl) {
        debugTraceEl.checked = runtimeStatsCfg.debugAutoQueueTrace === true;
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);
      if (edgeAutoHideEl) {
        edgeAutoHideEl.checked = MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
      }

      const beepCfg = getBeepConfig();
      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      if (beepCopySuccessEl) {
        beepCopySuccessEl.checked = beepCfg.copySuccessEnabled !== false;
      }

      const beepVolumeEl = qs('#cgpt-setting-beep-volume', root);
      if (beepVolumeEl) {
        beepVolumeEl.value = String(beepCfg.volume);
      }

      const beepDurationEl = qs('#cgpt-setting-beep-duration', root);
      if (beepDurationEl) {
        const beepSec = msToSecondsForUi(beepCfg.durationMs, 1);
        beepDurationEl.value = String(Math.round(beepSec * 100) / 100);
      }

      const beepFrequencyEl = qs('#cgpt-setting-beep-frequency', root);
      if (beepFrequencyEl) {
        beepFrequencyEl.value = String(beepCfg.frequency);
      }

      const uploadQuotaLimitEl = qs('#cgpt-setting-upload-quota-limit', root);
      if (uploadQuotaLimitEl) {
        uploadQuotaLimitEl.value = String(cfg.uploadQuotaMaxFiles || 80);
      }

      const messageQuotaLimitEl = qs('#cgpt-setting-message-quota-limit', root);
      if (messageQuotaLimitEl) {
        messageQuotaLimitEl.value = String(cfg.messageQuotaMaxMessages || 150);
      }

    }

    function renderShortcutSettings() {
      if (!host) {
        return;
      }

      const cfg = getShortcutConfig();

      const map = [
        {
          action: 'sendMessage',
          enabledId: 'cgpt-shortcut-send-enabled',
          labelId: 'cgpt-shortcut-send-label',
        },
        {
          action: 'sendCopyAndHotkeyOnce',
          enabledId: 'cgpt-shortcut-send-copy-hotkey-enabled',
          labelId: 'cgpt-shortcut-send-copy-hotkey-label',
        },
        {
          action: 'copyAndHotkeyOnce',
          enabledId: 'cgpt-shortcut-copy-hotkey-enabled',
          labelId: 'cgpt-shortcut-copy-hotkey-label',
        },
        {
          action: 'startUpload',
          enabledId: 'cgpt-shortcut-upload-enabled',
          labelId: 'cgpt-shortcut-upload-label',
        },
      ];

      map.forEach((item) => {
        const data = cfg[item.action];
        const enabledEl = qs(`#${item.enabledId}`, host);
        const labelEl = qs(`#${item.labelId}`, host);

        if (enabledEl) {
          enabledEl.checked = data.enabled !== false;
        }

        if (labelEl) {
          labelEl.value = (data.label && String(data.label).trim()) ? data.label : '未设置';
        }
      });
    }

    function bindEvents() {
      function updateShortcutAction(action, patch) {
        const cfg = getShortcutConfig();
        const oldActionConfig = cloneShortcutItem(
          cfg[action],
          DEFAULT_SHORTCUT_CONFIG[action],
        );

        cfg[action] = Object.assign(
          {},
          cfg[action] || {},
          patch || {},
        );

        const conflict = findShortcutConflict(cfg, action);

        if (conflict) {
          cfg[action] = oldActionConfig;

          renderShortcutSettings();
          applyUploadShortcutButtonTitles();

          ToolboxShell.appendLog(
            `[SETTINGS][shortcut-conflict-blocked] action=${action} conflict=${conflict}`,
          );
          setSettingsStatus(
            `快捷键冲突，已取消保存：${oldActionConfig.label || cfg[action].label || ''}`,
            'warn',
            {
              persist: true,
              shortText: '冲突',
            },
          );
          return;
        }

        saveShortcutConfig(cfg);
        renderShortcutSettings();
        applyUploadShortcutButtonTitles();
        logShortcutTargetWarnings(cfg);

        ToolboxShell.appendLog(
          `[SETTINGS][shortcut] action=${action} label=${cfg[action].label || '-'} enabled=${cfg[action].enabled !== false ? '1' : '0'}`
        );
      }

      function bindShortcutEnabled(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('change', () => {
          updateShortcutAction(action, {
            enabled: !!el.checked,
          });
        });
      }

      function bindShortcutClear(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          updateShortcutAction(action, {
            enabled: false,
            label: '',
            key: '',
            code: '',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          });
        });
      }

      function bindShortcutRecord(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          const oldText = el.textContent;
          el.textContent = '按下快捷键...';
          let recordTimer = 0;

          const cleanupRecordListener = () => {
            if (recordTimer) {
              window.clearTimeout(recordTimer);
              recordTimer = 0;
            }

            document.removeEventListener('keydown', onKeyDown, true);
          };

          const onKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
              cleanupRecordListener();
              el.textContent = oldText || '录制';
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:cancel] action=${action}`);
              return;
            }

            const next = shortcutItemFromEvent(e);

            if (next.pureModifier) {
              ToolboxShell.appendLog(
                `[SETTINGS][shortcut-record:wait-main-key] action=${action} key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? 1 : 0} alt=${e.altKey ? 1 : 0} shift=${e.shiftKey ? 1 : 0} meta=${e.metaKey ? 1 : 0}`,
              );
              el.textContent = '继续按主键...';
              return;
            }

            if (!next.key && !next.code) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-key`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            if (!next.label) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-label`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            cleanupRecordListener();

            const shortcutData = {
              enabled: next.enabled,
              label: next.label,
              key: next.key,
              code: next.code,
              ctrl: next.ctrl,
              alt: next.alt,
              shift: next.shift,
              meta: next.meta,
            };

            updateShortcutAction(action, shortcutData);

            ToolboxShell.appendLog(
              `[SETTINGS][shortcut-record:ok] action=${action} label=${next.label}`,
            );

            el.textContent = oldText || '录制';
          };

          recordTimer = window.setTimeout(() => {
            recordTimer = 0;
            el.textContent = oldText || '录制';
            document.removeEventListener('keydown', onKeyDown, true);
            ToolboxShell.appendLog(`[SETTINGS][shortcut-record:timeout] action=${action}`);
          }, 8000);

          document.addEventListener('keydown', onKeyDown, true);
        });
      }

      bindShortcutEnabled('cgpt-shortcut-send-enabled', 'sendMessage');
      bindShortcutEnabled('cgpt-shortcut-send-copy-hotkey-enabled', 'sendCopyAndHotkeyOnce');
      bindShortcutEnabled('cgpt-shortcut-copy-hotkey-enabled', 'copyAndHotkeyOnce');
      bindShortcutEnabled('cgpt-shortcut-upload-enabled', 'startUpload');

      bindShortcutRecord('cgpt-shortcut-send-record', 'sendMessage');
      bindShortcutRecord('cgpt-shortcut-send-copy-hotkey-record', 'sendCopyAndHotkeyOnce');
      bindShortcutRecord('cgpt-shortcut-copy-hotkey-record', 'copyAndHotkeyOnce');
      bindShortcutRecord('cgpt-shortcut-upload-record', 'startUpload');

      bindShortcutClear('cgpt-shortcut-send-clear', 'sendMessage');
      bindShortcutClear('cgpt-shortcut-send-copy-hotkey-clear', 'sendCopyAndHotkeyOnce');
      bindShortcutClear('cgpt-shortcut-copy-hotkey-clear', 'copyAndHotkeyOnce');
      bindShortcutClear('cgpt-shortcut-upload-clear', 'startUpload');

      const resetShortcutBtn = qs('#cgpt-shortcut-reset-defaults', root);
      if (resetShortcutBtn) {
        resetShortcutBtn.addEventListener('click', () => {
          resetShortcutConfig();
          renderShortcutSettings();
          applyUploadShortcutButtonTitles();
          ToolboxShell.appendLog('[SETTINGS][shortcut-reset-defaults]');
        });
      }

      const resetContinuePromptBtn = qs('#cgpt-setting-copy-hotkey-continue-prompt-reset', root);
      if (resetContinuePromptBtn) {
        resetContinuePromptBtn.addEventListener('click', () => {
          const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
          const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
          const defaultStop = typeof getDefaultDoneSignal === 'function'
            ? getDefaultDoneSignal()
            : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>';

          if (promptTextEl) {
            promptTextEl.value = renderDefaultContinuePromptForSettings(defaultStop);
          }
          if (stopSignalEl) {
            stopSignalEl.value = defaultStop;
          }

          const cfg = readFromUi();
          cfg.copyHotkeyContinuePromptText = '';
          cfg.copyHotkeyContinueStopSignal = defaultStop;
          saveConfig(cfg);
          render();
          ToolboxShell.appendLog('[SETTINGS][continue-prompt-reset-defaults]');
          const resetPreview = renderDefaultContinuePromptForSettings(defaultStop);
          if (typeof logPromptDetailCursorBlock === 'function') {
            logPromptDetailCursorBlock('settings-continue-prompt-reset', resetPreview);
          } else {
            const hasDetailed = typeof hasDetailedCursorInstructionBlock === 'function'
              ? hasDetailedCursorInstructionBlock(resetPreview)
              : resetPreview.includes('Cursor / Claude Code 修改指令');
            ToolboxShell.appendLog(
              `[PROMPT][DETAIL_CURSOR_BLOCK] source=settings-continue-prompt-reset hasDetailed=${hasDetailed ? 1 : 0} len=${resetPreview.length}`,
            );
          }
        });
      }

      const onCompactSettingChange = () => {
        const cfg = readFromUi();
        saveConfig(cfg);
        const continueCfg = cfg.continueAutomation || {};
        ToolboxShell.appendLog(
          `[UNIFIED_CONTINUE_HOME][CONFIG] mode=settings-save enabled=${continueCfg.homeNavEnabled !== false ? 1 : 0} interval=${continueCfg.homeNavInterval || 20} url=${continueCfg.homeNavUrl || 'https://chatgpt.com/'} closedLoopNextDelayMinSec=${Math.round((continueCfg.closedLoopNextDelayMinMs ?? 40000) / 1000)} closedLoopNextDelayMaxSec=${Math.round((continueCfg.closedLoopNextDelayMaxMs ?? 60000) / 1000)}`,
        );
        ToolboxShell.appendLog(
          `[CLOSED_LOOP][NEXT_DELAY_CONFIG_SAVE] minSec=${Math.round((continueCfg.closedLoopNextDelayMinMs ?? 40000) / 1000)} maxSec=${Math.round((continueCfg.closedLoopNextDelayMaxMs ?? 60000) / 1000)} minMs=${continueCfg.closedLoopNextDelayMinMs ?? 40000} maxMs=${continueCfg.closedLoopNextDelayMaxMs ?? 60000}`,
        );
        render();
      };

      const onRuntimeStatsSettingChange = () => {
        saveRuntimeStatsSettingsFromUi();
        render();
      };

      [
        '#cgpt-setting-runtime-stats-show',
        '#cgpt-setting-runtime-stats-preserve-average',
        '#cgpt-setting-runtime-stats-refresh-interval',
        '#cgpt-setting-autoq-trace-debug',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onRuntimeStatsSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      const resetRuntimeStatsBtn = qs('#cgpt-setting-runtime-stats-reset', root);
      if (resetRuntimeStatsBtn) {
        resetRuntimeStatsBtn.addEventListener('click', () => {
          if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.resetUserStats === 'function') {
            RuntimeStatsModule.resetUserStats();
          }
          ToolboxShell.appendLog('[SETTINGS][runtime-stats-reset]');
          setSettingsStatus('已重置批量任务计时统计（程序运行时长保留）');
        });
      }

      const saveQuotaBtn = qs('#cgpt-setting-quota-save', root);
      if (saveQuotaBtn) {
        saveQuotaBtn.addEventListener('click', () => {
          saveQuotaSettingsFromUi();
        });
      }

      const resetQuotaStatsBtn = qs('#cgpt-setting-quota-reset-stats', root);
      if (resetQuotaStatsBtn) {
        resetQuotaStatsBtn.addEventListener('click', () => {
          resetQuotaStatsFromUi();
        });
      }

      [
        SettingsSelectors.showUploadGroups,
        SettingsSelectors.showUploadStart,
        SettingsSelectors.showFileList,
        '#cgpt-setting-global-drop-capture',
        '#cgpt-setting-restore-scroll-after-copy',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-enabled',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-interval',
        '#cgpt-setting-closed-loop-next-delay-min-sec',
        '#cgpt-setting-closed-loop-next-delay-max-sec',
        '#cgpt-setting-unified-continue-home-nav-enabled',
        '#cgpt-setting-unified-continue-home-nav-interval',
        '#cgpt-setting-unified-continue-home-nav-url',
        '#cgpt-setting-copy-hotkey-loop-home-nav-enabled',
        '#cgpt-setting-copy-hotkey-loop-home-nav-interval',
        '#cgpt-setting-copy-hotkey-loop-home-nav-url',
        '#cgpt-setting-copy-hotkey-continue-stop-signal',
        '#cgpt-setting-copy-hotkey-continue-prompt-text',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onCompactSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      [
        '#cgpt-setting-closed-loop-next-delay-min-sec',
        '#cgpt-setting-closed-loop-next-delay-max-sec',
      ].forEach((selector) => {
        const closedLoopDelaySecEl = qs(selector, root);
        if (closedLoopDelaySecEl && typeof debounceSave === 'function') {
          const onClosedLoopDelayInput = debounceSave(onCompactSettingChange, 300);
          closedLoopDelaySecEl.addEventListener('input', onClosedLoopDelayInput);
        }
      });

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);

      if (edgeAutoHideEl) {
        edgeAutoHideEl.addEventListener('change', () => {
          const enabled = !!edgeAutoHideEl.checked;

          if (typeof ToolboxShell.setEdgeAutoHideEnabled === 'function') {
            ToolboxShell.setEdgeAutoHideEnabled(enabled);
          } else {
            MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, enabled);
            ToolboxShell.appendLog(
              `[SETTINGS][edgeAutoHide] ${enabled ? '已开启' : '已关闭'}，但 ToolboxShell.setEdgeAutoHideEnabled 不存在`,
            );
          }

          render();
        });
      }

      const resetPosBtn = qs('#cgpt-setting-reset-toolbox-position', root);
      if (resetPosBtn) {
        resetPosBtn.addEventListener('click', () => {
          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          } else {
            ToolboxShell.appendLog('[SETTINGS][reset-position] ToolboxShell.resetToolboxPosition 不存在');
          }
        });
      }

      const clearAutoQueueMojibakeBtn = qs('#cgpt-setting-clear-autoqueue-mojibake-cache', root);
      bindOnce(clearAutoQueueMojibakeBtn, 'click', () => {
        const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('将清除自动指令配置缓存（不含 Prompt 数据）。清理后需要刷新页面，是否继续？')
          : true;

        if (!confirmed) {
          ToolboxShell.appendLog('[SETTINGS][clear-autoqueue-mojibake-cache] cancelled');
          return;
        }

        if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.clearAutoQueueMojibakeCache === 'function') {
          AutoQueueModule.clearAutoQueueMojibakeCache('settings-manual-clear');
        } else {
          ToolboxShell.appendLog('[SETTINGS][clear-autoqueue-mojibake-cache] AutoQueueModule.clearAutoQueueMojibakeCache 不存在');
          return;
        }

        setSettingsStatus('已清理自动指令缓存，请刷新页面', 'ok', { ttlMs: 8000 });
        ToolboxShell.appendLog('[SETTINGS][clear-autoqueue-mojibake-cache] done — refresh page recommended');
      });

      const forceShowBtn = qs('#cgpt-setting-force-show-toolbox', root);
      bindOnce(forceShowBtn, 'click', () => {
          if (typeof ToolboxShell.restoreToolboxFromHiddenState === 'function') {
            ToolboxShell.restoreToolboxFromHiddenState('settings-force-show');
          } else if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.__cgptToolboxShow === 'function') {
            unsafeWindow.__cgptToolboxShow();
          } else if (typeof window.__cgptToolboxShow === 'function') {
            window.__cgptToolboxShow();
          } else {
            ToolboxShell.appendLog('[SETTINGS][force-show-toolbox] restoreToolboxFromHiddenState 不存在');
          }

          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          }

          ToolboxShell.appendLog('[SETTINGS][force-show-toolbox]');
      });

      function readBeepFromUi() {
        const volumeEl = qs('#cgpt-setting-beep-volume', root);
        const durationEl = qs('#cgpt-setting-beep-duration', root);
        const frequencyEl = qs('#cgpt-setting-beep-frequency', root);
        const current = getBeepConfig();

        const rawBeepSec = durationEl ? String(durationEl.value).trim() : '';
        const fallbackBeepSec = msToSecondsForUi(current.durationMs, 1);
        const durationMs = durationEl
          ? secondsToMsForStore(
            rawBeepSec === '' ? fallbackBeepSec : Number(rawBeepSec),
            1,
            0.03,
            10,
          )
          : current.durationMs;

        return normalizeBeepConfig({
          ...current,
          volume: volumeEl ? Number(volumeEl.value) : current.volume,
          durationMs,
          frequency: frequencyEl ? Number(frequencyEl.value) : current.frequency,
          type: current.type,
        });
      }

      function bindBeepSettingInput(id) {
        const el = qs(`#${id}`, root);
        bindOnce(el, 'change', () => {
          const cfg = readBeepFromUi();
          saveBeepConfig(cfg);
          ToolboxShell.appendLog(
            `[SETTINGS][beep] volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );
        });
      }

      bindBeepSettingInput('cgpt-setting-beep-volume');
      bindBeepSettingInput('cgpt-setting-beep-duration');
      bindBeepSettingInput('cgpt-setting-beep-frequency');

      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      bindOnce(beepCopySuccessEl, 'change', () => {
        const current = getBeepConfig();
        const cfg = saveBeepConfig({
          ...current,
          copySuccessEnabled: beepCopySuccessEl.checked !== false,
        });

        ToolboxShell.appendLog(
          `[SETTINGS][beep-copy-success] enabled=${cfg.copySuccessEnabled !== false ? '1' : '0'}`,
        );
      }, {
        key: 'change:beep-copy-success-enabled',
        moduleName: 'SETTINGS',
      });

      const settingsBeepRefs = collectDomRefs(root, {
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        testTitleFlash: {
          selector: '#cgpt-setting-test-title-flash',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      bindOnce(settingsBeepRefs.testBeep, 'click', async () => {
          const statusEl = settingsBeepRefs.beepStatus;

          if (statusEl) {
            statusEl.textContent = '正在测试...';
          }

          const cfg = saveBeepConfig(readBeepFromUi());

          ToolboxShell.appendLog(
            `[SETTINGS][beep-test] start volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );

          const unlocked = await unlockToolboxAudio('settings-test');

          if (!unlocked) {
            if (statusEl) {
              statusEl.textContent = '测试失败：浏览器音频未解锁';
            }

            ToolboxShell.appendLog('[SETTINGS][beep-test] failed reason=unlock-failed');
            return;
          }

          const ok = await playToolboxBeep('settings-test', {
            volume: cfg.volume,
            durationMs: cfg.durationMs,
            frequency: cfg.frequency,
            type: cfg.type,
          });

          if (statusEl) {
            statusEl.textContent = ok
              ? '已播放测试蜂鸣'
              : '测试失败，请查看日志';
          }

          ToolboxShell.appendLog(`[SETTINGS][beep-test] result=${ok ? 'ok' : 'failed'}`);
      });

      bindOnce(settingsBeepRefs.testTitleFlash, 'click', () => {
        const statusEl = settingsBeepRefs.beepStatus;

        if (
          typeof ResponseDoneNotifyModule !== 'undefined'
          && typeof ResponseDoneNotifyModule.startResponseDoneNotify === 'function'
        ) {
          ResponseDoneNotifyModule.startResponseDoneNotify('settings-test');

          if (statusEl) {
            statusEl.textContent = '已开始测试标签页标题与 favicon 提示（🔴 [回复完成]）；点击页面或切回标签可清除';
          }

          ToolboxShell.appendLog('[SETTINGS][title-flash-test] start');
          return;
        }

        if (
          typeof TitlePrefixModule !== 'undefined'
          && (
            typeof TitlePrefixModule.setToolboxTabTitleState === 'function'
            || typeof TitlePrefixModule.startReplyDoneFlash === 'function'
          )
        ) {
          if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
            TitlePrefixModule.setToolboxTabTitleState('reply_done', 'settings-test');
          } else {
            TitlePrefixModule.startReplyDoneFlash('settings-test', {
              intervalMs: 600,
              autoStopMs: 0,
            });
          }

          if (
            typeof ToolboxShell !== 'undefined'
            && typeof ToolboxShell.flashHeaderTitleOnce === 'function'
          ) {
            ToolboxShell.flashHeaderTitleOnce('回复完成', {});
          }

          if (statusEl) {
            statusEl.textContent = '已开始测试标签页标题与 favicon 提示（🔴 [回复完成]）';
          }

          ToolboxShell.appendLog('[SETTINGS][title-flash-test] start');
          return;
        }

        if (statusEl) {
          statusEl.textContent = '测试失败：标题闪烁模块不可用';
        }

        ToolboxShell.appendLog('[SETTINGS][title-flash-test] failed reason=module-missing');
      });

      const settingsSubtabs = qs('#cgpt-settings-subtabs', root);
      bindOnce(settingsSubtabs, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-settings-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeSettingsSubtab = normalizeSettingsSubtabName(
            btn.getAttribute('data-settings-subtab') || 'toolbox',
          );
          MemoryManager.set('settingsActiveSubtab', activeSettingsSubtab);
          renderSettingsSubtabs();

          ToolboxShell.appendLog(`[SETTINGS][subtab] active=${activeSettingsSubtab}`);
      });
    }

    function mount(target) {
      host = target;
      if (!host) return;

      host.innerHTML = `
        <div class="cgpt-section cgpt-settings-module" id="cgpt-settings-module">
          <div class="cgpt-settings-subtabs" id="cgpt-settings-subtabs">
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="toolbox">工具箱</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="shortcut">快捷键</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="continue-task">自动续写</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="quota-notify">额度提醒</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="stats-debug">统计调试</button>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="toolbox">
            <div class="cgpt-section-title" style="margin-top: 4px;">工具箱显示与位置</div>

            <label class="cgpt-checkbox-line" title="开启后，拖动工具箱贴住浏览器右边缘后自动收起，只保留边缘把手；只是靠近边缘不会隐藏。关闭后只保留普通拖拽，不自动隐藏。">
              <input type="checkbox" id="cgpt-setting-edge-auto-hide">
              工具箱贴边自动隐藏
            </label>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position" title="重置工具箱在页面中的位置">重置工具箱位置</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-force-show-toolbox" title="当工具箱跑出屏幕、贴边状态异常或隐藏后找不到入口时，可先强制显示，再按需重置位置。">强制显示工具箱</button>
            </div>

            <div class="cgpt-section-title" style="margin-top: 12px;">精简模式显示内容</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-groups">
              显示项目分组栏
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-start">
              显示上传按钮
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-file-list">
              显示上传文件列表
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">拖拽上传</div>
            <label class="cgpt-checkbox-line" title="拖到 ChatGPT 输入框仍由 ChatGPT 原生处理；拖到工具箱面板内始终加入队列。">
              <input type="checkbox" id="cgpt-setting-global-drop-capture">
              页面空白处拖入文件时加入工具箱队列
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制回复</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-restore-scroll-after-copy">
              复制最后消息后恢复原滚动位置
            </label>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="shortcut">
            <div class="cgpt-shortcut-settings">
              <div class="cgpt-hotkey-setting-row" data-shortcut-action="sendMessage">
                <label class="cgpt-hotkey-setting-label" title="按下该快捷键后执行发送消息。">
                  <input type="checkbox" class="cgpt-hotkey-setting-checkbox" id="cgpt-shortcut-send-enabled">
                  <span class="cgpt-hotkey-setting-label-text">发送消息</span>
                </label>
                <input id="cgpt-shortcut-send-label" class="cgpt-hotkey-setting-input" readonly>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-send-record" title="默认 Ctrl+Alt+S。录制时请按完整组合键；仅按 Ctrl/Alt/Shift 不会保存，需再按主键。按 Esc 取消。">录制</button>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-send-clear">清空</button>
              </div>

              <div class="cgpt-hotkey-setting-row" data-shortcut-action="sendCopyAndHotkeyOnce">
                <label class="cgpt-hotkey-setting-label" title="按下该快捷键后执行：发送消息 -> 等待回复完成 -> 复制最后回复 -> 触发目标快捷键。这里设置的是触发按钮本身的快捷键，不是复制后发送给 GUI 的目标快捷键。">
                  <input type="checkbox" class="cgpt-hotkey-setting-checkbox" id="cgpt-shortcut-send-copy-hotkey-enabled">
                  <span class="cgpt-hotkey-setting-label-text">发送+复制+快捷键</span>
                </label>
                <input id="cgpt-shortcut-send-copy-hotkey-label" class="cgpt-hotkey-setting-input" readonly>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-send-copy-hotkey-record" title="默认 Ctrl+Alt+J。录制的是触发「发送+复制+快捷键」按钮本身的快捷键；不是复制后发送给 GUI 的目标快捷键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-send-copy-hotkey-clear">清空</button>
              </div>

              <div class="cgpt-hotkey-setting-row" data-shortcut-action="copyAndHotkeyOnce">
                <label class="cgpt-hotkey-setting-label" title="按下该快捷键后复制最后一条回复，并执行后续触发逻辑。">
                  <input type="checkbox" class="cgpt-hotkey-setting-checkbox" id="cgpt-shortcut-copy-hotkey-enabled">
                  <span class="cgpt-hotkey-setting-label-text">复制最后回复并触发</span>
                </label>
                <input id="cgpt-shortcut-copy-hotkey-label" class="cgpt-hotkey-setting-input" readonly>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-copy-hotkey-record" title="点击录制后按下完整快捷键。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-copy-hotkey-clear">清空</button>
              </div>

              <div class="cgpt-hotkey-setting-row" data-shortcut-action="startUpload">
                <label class="cgpt-hotkey-setting-label" title="按下该快捷键后开始上传当前文件队列。">
                  <input type="checkbox" class="cgpt-hotkey-setting-checkbox" id="cgpt-shortcut-upload-enabled">
                  <span class="cgpt-hotkey-setting-label-text">开始上传</span>
                </label>
                <input id="cgpt-shortcut-upload-label" class="cgpt-hotkey-setting-input" readonly>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-upload-record" title="点击录制后按下完整快捷键。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-hotkey-setting-btn" id="cgpt-shortcut-upload-clear">清空</button>
              </div>

              <div class="cgpt-row">
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-reset-defaults">
                  恢复默认快捷键
                </button>
              </div>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="continue-task">
            <div class="cgpt-section-title" style="margin-top: 4px;">连续复制+快捷键+继续（循环附加）</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-copy-hotkey-loop-auto-upload-enabled">
              每隔指定轮数自动重新上传当前分组文件
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-auto-upload-interval">上传间隔轮数</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-auto-upload-interval" data-no-wheel-number="1" min="1" max="999" step="1">
            </div>

            <div class="cgpt-kv">
              <label
                for="cgpt-setting-closed-loop-next-delay-min-sec"
                title="闭环每轮回复完成后，进入下一轮之前的最短等待秒数。默认 40 秒。"
              >闭环最短等待（秒）</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-closed-loop-next-delay-min-sec"
                data-no-wheel-number="1"
                min="1"
                max="600"
                step="1"
                placeholder="40"
                title="单位：秒。默认 40 秒。"
              >
            </div>

            <div class="cgpt-kv">
              <label
                for="cgpt-setting-closed-loop-next-delay-max-sec"
                title="闭环每轮回复完成后，进入下一轮之前的最长等待秒数。默认 60 秒。"
              >闭环最长等待（秒）</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-closed-loop-next-delay-max-sec"
                data-no-wheel-number="1"
                min="1"
                max="600"
                step="1"
                placeholder="60"
                title="单位：秒。默认 60 秒。"
              >
            </div>

            <div class="cgpt-section-title" style="margin-top: 10px;">无限继续统一回首页</div>
            <div class="cgpt-hint" style="margin-bottom: 8px;">适用于连续复制+快捷键+继续、闭环继续、自动继续、自动继续直到完成等所有无限继续模式。</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-unified-continue-home-nav-enabled">
              启用定期回首页
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-unified-continue-home-nav-interval" title="所有无限继续模式共用此间隔">无限继续每 N 轮回首页</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-unified-continue-home-nav-interval" data-no-wheel-number="1" min="1" max="999" step="1" title="所有无限继续模式共用此间隔">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-unified-continue-home-nav-url" title="默认每 5 轮重新上传一次文件（仅连续复制+快捷键+继续/闭环）。回首页间隔由上方统一参数控制。">回首页地址</label>
              <input type="text" class="cgpt-input" id="cgpt-setting-unified-continue-home-nav-url" title="默认每 5 轮重新上传一次文件（仅连续复制+快捷键+继续/闭环）。回首页间隔由上方统一参数控制。">
            </div>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制+快捷键+继续</div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-continue-stop-signal">终止信号</label>
              <input
                type="text"
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-stop-signal"
                placeholder="<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>"
              >
            </div>

            <div class="cgpt-kv cgpt-kv-vertical">
              <label for="cgpt-setting-copy-hotkey-continue-prompt-text">继续指令</label>
              <textarea
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-prompt-text"
                rows="12"
                style="width: 100%; resize: vertical;"
                placeholder="留空则使用内置默认继续指令。默认继续指令会要求：若任务涉及代码修改/修复/重构/Bug 定位/UI 状态/闭环控制/上传逻辑/日志排查，必须输出详细 Cursor / Claude Code 修改指令，并列出文件路径、函数名、关键代码、日志和验证步骤。"
              ></textarea>
            </div>

            <div class="cgpt-row">
              <button type="button" class="cgpt-btn" id="cgpt-setting-copy-hotkey-continue-prompt-reset" title="恢复内置默认继续指令。默认模板会强制要求涉及代码修改时输出详细 Cursor / Claude Code 修改指令。">
                恢复默认继续指令
              </button>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="quota-notify">
            <div class="cgpt-section-title" style="margin-top: 4px;">额度设置</div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-upload-quota-limit" title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。">上传额度上限</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-upload-quota-limit"
                data-no-wheel-number="1"
                min="1"
                max="10000"
                step="1"
                title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。"
              >
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-message-quota-limit" title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。">消息额度上限</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-message-quota-limit"
                data-no-wheel-number="1"
                min="1"
                max="10000"
                step="1"
                title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。"
              >
            </div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-quota-save" title="修改上限后顶部「上传额度 / 消息额度」的分母会立即更新。">保存额度设置</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-quota-reset-stats" title="只清空工具箱内部已用计数，不会改动上限配置。">重置今日统计</button>
            </div>

            <div class="cgpt-section-title" style="margin-top: 12px;">蜂鸣器 / 标题提醒</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-beep-copy-success-enabled">
              复制成功后播放蜂鸣器
            </label>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-volume">音量</label>
              <input type="range" class="cgpt-input" id="cgpt-setting-beep-volume" min="0.05" max="1" step="0.05">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-duration" title="单位：秒。内部仍按毫秒保存与播放。">蜂鸣时长（秒）</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-duration" data-no-wheel-number="1" min="0.03" max="10" step="0.1" title="单位：秒。默认 1 秒。">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-frequency">频率 (Hz)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-frequency" data-no-wheel-number="1" min="80" max="6000" step="10">
            </div>
            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-test-beep" title="蜂鸣器用于复制成功提醒；浏览器可能要求先点击页面或工具箱一次后才允许播放声音。">测试蜂鸣器</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-test-title-flash">测试标题闪烁</button>
              <span id="cgpt-setting-beep-status">未测试</span>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="stats-debug">
            <div class="cgpt-section-title" style="margin-top: 4px;">批量任务计时统计</div>

            <label class="cgpt-checkbox-line" title="在「自动指令 → 批量任务组模式」状态区显示运行/批量/当前任务耗时、平均耗时与预计剩余时间。当前任务耗时仅在消息真正发送成功后开始计时。">
              <input type="checkbox" id="cgpt-setting-runtime-stats-show">
              显示计时统计
            </label>

            <label class="cgpt-checkbox-line" title="开启后，开始新的批量任务组时仍沿用上一轮已完成任务的平均耗时；关闭则每轮批量重新开始统计。">
              <input type="checkbox" id="cgpt-setting-runtime-stats-preserve-average">
              保留历史平均耗时
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-runtime-stats-refresh-interval" title="单位：秒。内部仍按毫秒保存。">计时刷新间隔（秒）</label>
              <select
                class="cgpt-select"
                id="cgpt-setting-runtime-stats-refresh-interval"
                title="单位：秒。内部仍按毫秒保存。"
              >
                <option value="1000">1 秒</option>
                <option value="2000">2 秒</option>
                <option value="5000">5 秒</option>
              </select>
            </div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-runtime-stats-reset" title="重置会清空批量/任务计时与平均耗时，但不会重置「程序运行时长」。">重置计时统计</button>
            </div>

            <div class="cgpt-section-title" style="margin-top: 12px;">调试日志</div>
            <label class="cgpt-checkbox-line" title="开启后输出 AUTOQ_TRACE 多步骤闭环状态机日志，便于排查为什么没有继续、没有验收或为什么提前停止。">
              <input type="checkbox" id="cgpt-setting-autoq-trace-debug">
              开启 AUTOQ_TRACE 调试日志
            </label>

            <div class="cgpt-section-title" style="margin-top: 12px;">维护清理</div>
            <div class="cgpt-row" style="margin-top: 8px;">
              <button
                type="button"
                class="cgpt-btn"
                id="cgpt-setting-clear-autoqueue-mojibake-cache"
                title="仅清除自动指令相关缓存（autoQueueConfig、autoqueueActiveSubtab），不会删除 Prompt 管理器数据。清理后请刷新页面。"
              >清理自动指令乱码缓存</button>
            </div>
          </div>
        </div>
      `;

      root = host;

      collectDomRefs(root, {
        subtabs: '#cgpt-settings-subtabs',
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      activeSettingsSubtab = normalizeSettingsSubtabName(
        MemoryManager.get('settingsActiveSubtab', 'toolbox'),
      );
      bindEvents();
      render();
      renderShortcutSettings();
      renderSettingsSubtabs();
    }

    return {
      mount,
      getConfig,
      saveConfig,
    };
  })();
